const { query, pool } = require('../../db');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const gcpKms = require('../kms/gcp');

/**
 * Convert a GCP KMS Ed25519 public key PEM to a Solana-compatible base58 address.
 * Ed25519 SubjectPublicKeyInfo DER = 12-byte header + 32-byte raw key.
 * Solana addresses are base58-encoded 32-byte Ed25519 public keys.
 */
function pemToSolanaAddress(pem) {
  if (!pem) return null;
  try {
    const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
    const der = Buffer.from(b64, 'base64');
    const rawKey = der.slice(-32); // last 32 bytes = raw Ed25519 pubkey

    // Base58 encoding (Bitcoin/Solana alphabet)
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let num = BigInt('0x' + rawKey.toString('hex'));
    let encoded = '';
    while (num > 0n) {
      encoded = ALPHABET[Number(num % 58n)] + encoded;
      num = num / 58n;
    }
    // Leading zero bytes → leading '1's
    for (const byte of rawKey) {
      if (byte !== 0) break;
      encoded = '1' + encoded;
    }
    return encoded;
  } catch {
    return null;
  }
}

// Ensure uploads directory exists
const UPLOADS_DIR = process.env.UPLOAD_DIR || './uploads/receipts';
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// ============================================
// DEPOSIT REQUEST MANAGEMENT (Checker only)
// ============================================

/**
 * Get all deposit requests (for checker)
 * GET /api/admin/deposit-requests
 * Query params: status (pending|approved|rejected), limit, offset
 */
module.exports.getDepositRequestsCtrl = async (req, res) => {
  try {
    const status = req.query.status || 'pending';
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const result = await query(
      `SELECT 
        dr.id,
        dr.amount_usd,
        dr.receipt_path,
        dr.status,
        dr.notes,
        dr.rejection_reason,
        dr.created_at,
        dr.reviewed_at,
        u.id as user_id,
        u.email as user_email,
        u.wallet_address as user_wallet,
        reviewer.email as reviewed_by_email
       FROM deposit_requests dr
       JOIN users u ON dr.user_id = u.id
       LEFT JOIN users reviewer ON dr.reviewed_by = reviewer.id
       WHERE dr.status = $1
       ORDER BY dr.created_at DESC
       LIMIT $2 OFFSET $3`,
      [status, limit, offset]
    );

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) as total FROM deposit_requests WHERE status = $1`,
      [status]
    );

    res.json({
      requests: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit,
      offset,
    });
  } catch (err) {
    console.error('[ADMIN] Error getting deposit requests:', err);
    res.status(500).json({ error: 'Failed to get deposit requests', message: err.message });
  }
};

/**
 * Approve a deposit request (Checker only)
 * POST /api/admin/deposit-requests/:id/approve
 * Body: { notes? }
 */
module.exports.approveDepositRequestCtrl = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const checkerId = req.user.id;

    await client.query('BEGIN');

    // Get deposit request
    const requestResult = await client.query(
      `SELECT dr.*, u.id as user_id, u.available_balance 
       FROM deposit_requests dr
       JOIN users u ON dr.user_id = u.id
       WHERE dr.id = $1 AND dr.status = 'pending'`,
      [id]
    );

    if (requestResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Deposit request not found or already processed' });
    }

    const request = requestResult.rows[0];
    const amountUsd = parseFloat(request.amount_usd);

    // Update deposit request status
    await client.query(
      `UPDATE deposit_requests 
       SET status = 'approved', 
           notes = $1,
           reviewed_by = $2, 
           reviewed_at = NOW()
       WHERE id = $3`,
      [notes || null, checkerId, id]
    );

    // Increase user's available balance
    await client.query(
      `UPDATE users 
       SET available_balance = available_balance + $1,
           updated_at = NOW()
       WHERE id = $2`,
      [amountUsd, request.user_id]
    );

    // Record the deposit transaction
    await client.query(
      `INSERT INTO user_transactions 
       (user_id, transaction_type, amount_usd, status, notes)
       VALUES ($1, 'DEPOSIT', $2, 'COMPLETED', $3)`,
      [request.user_id, amountUsd, `Deposit approved by admin`]
    );

    await client.query('COMMIT');

    res.json({ 
      success: true, 
      message: 'Deposit approved successfully',
      amount: amountUsd 
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[ADMIN] Error approving deposit:', err);
    res.status(500).json({ error: 'Failed to approve deposit', message: err.message });
  } finally {
    client.release();
  }
};

/**
 * Reject a deposit request (Checker only)
 * POST /api/admin/deposit-requests/:id/reject
 * Body: { reason }
 */
module.exports.rejectDepositRequestCtrl = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const checkerId = req.user.id;

    if (!reason) {
      return res.status(400).json({ error: 'Rejection reason is required' });
    }

    const result = await query(
      `UPDATE deposit_requests 
       SET status = 'rejected', 
           rejection_reason = $1,
           reviewed_by = $2, 
           reviewed_at = NOW()
       WHERE id = $3 AND status = 'pending'
       RETURNING *`,
      [reason, checkerId, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Deposit request not found or already processed' });
    }

    res.json({ 
      success: true, 
      message: 'Deposit rejected',
      reason 
    });
  } catch (err) {
    console.error('[ADMIN] Error rejecting deposit:', err);
    res.status(500).json({ error: 'Failed to reject deposit', message: err.message });
  }
};

// ============================================
// ASSET/SITE MANAGEMENT
// ============================================

/**
 * Get all asset requests (pending sites) - Checker only
 * GET /api/admin/asset-requests
 */
module.exports.getAssetRequestsCtrl = async (req, res) => {
  try {
    const status = req.query.status || 'pending';
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const result = await query(
      `SELECT 
        s.id,
        s.name,
        s.location,
        s.timezone,
        s.category,
        s.sites_valuation,
        s.status,
        s.created_at,
        o.name as organization_name,
        creator.email as created_by_email,
        creator.wallet_address as created_by_wallet
       FROM sites s
       LEFT JOIN organizations o ON s.organization_id = o.id
       LEFT JOIN users creator ON s.created_by = creator.id
       WHERE s.status = $1
       ORDER BY s.created_at DESC
       LIMIT $2 OFFSET $3`,
      [status, limit, offset]
    );

    const countResult = await query(
      `SELECT COUNT(*) as total FROM sites WHERE status = $1`,
      [status]
    );

    res.json({
      assets: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit,
      offset,
    });
  } catch (err) {
    console.error('[ADMIN] Error getting asset requests:', err);
    res.status(500).json({ error: 'Failed to get asset requests', message: err.message });
  }
};

/**
 * Get all assets (for management) - Checker only
 * GET /api/admin/assets
 */
module.exports.getAllAssetsCtrl = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;

    const result = await query(
      `SELECT 
        s.id,
        s.name,
        s.location,
        s.timezone,
        s.category,
        s.sites_valuation,
        s.status,
        s.created_at,
        o.name as organization_name,
        creator.email as created_by_email
       FROM sites s
       LEFT JOIN organizations o ON s.organization_id = o.id
       LEFT JOIN users creator ON s.created_by = creator.id
       ORDER BY s.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await query(`SELECT COUNT(*) as total FROM sites`);

    res.json({
      assets: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit,
      offset,
    });
  } catch (err) {
    console.error('[ADMIN] Error getting all assets:', err);
    res.status(500).json({ error: 'Failed to get assets', message: err.message });
  }
};

/**
 * Create asset request (Maker) - creates site with status 'pending'
 * POST /api/admin/assets/request
 * Body: { name, location, timezone, category, valuation, organizationId?, ...extended fields }
 */
module.exports.createAssetRequestCtrl = async (req, res) => {
  try {
    const {
      name, location, timezone, category, valuation, organizationId,
      latitude, longitude,
      // Extended fields
      description, imageUrl, imageUrls, assetType, portfolioToken, tokenPrice,
      revenueModel, estimatedAnnualIncome, contractTerm, contractDueDate,
      installationType, technologyType, numPanels, peakPowerKw,
      peakSunHours, expectedAnnualOutput,
      tariffRate, tariffCurrency, tariffEscalation,
      yieldInvestorPct, yieldMaintenancePct, yieldPlatformPct, yieldTreasuryPct
    } = req.body;
    const creatorId = req.user.id;

    if (!name || !location || !category) {
      return res.status(400).json({
        error: 'Name, location, and category are required'
      });
    }

    // Validate category
    const validCategories = ['SOLAR', 'EV', 'EE'];
    if (!validCategories.includes(category.toUpperCase())) {
      return res.status(400).json({
        error: 'Invalid category. Must be SOLAR, EV, or EE'
      });
    }

    const urls = Array.isArray(imageUrls) && imageUrls.length > 0
      ? imageUrls.filter(Boolean)
      : (imageUrl ? [imageUrl] : []);
    const primaryImage = urls[0] || imageUrl || null;
    const imageUrlsJson = JSON.stringify(urls);

    // If maker is checker, create as active and show in console; otherwise pending
    const isChecker = req.user.user_type === 'checker';
    const status = isChecker ? 'active' : 'pending';
    const siteId = uuidv4();

    const result = await query(
      `INSERT INTO sites
       (id, name, location, timezone, category, sites_valuation, organization_id, status, created_by, created_at,
        description, image_url, image_urls, asset_type, portfolio_token, token_price,
        revenue_model, estimated_annual_income, contract_term, contract_due_date,
        installation_type, technology_type, num_panels, peak_power_kw, peak_sun_hours, expected_annual_output,
        tariff_rate, tariff_currency, tariff_escalation,
        yield_investor_pct, yield_maintenance_pct, yield_platform_pct, yield_treasury_pct,
        show_in_invest, show_in_console, latitude, longitude)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(),
        $10, $11, $12::jsonb, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36)
       RETURNING *`,
      [
        siteId, name, location, timezone || 'UTC', category.toUpperCase(),
        valuation || 0, organizationId || null, status, creatorId,
        description || null, primaryImage, imageUrlsJson, assetType || null, portfolioToken || null, tokenPrice || 1,
        revenueModel || null, estimatedAnnualIncome || null, contractTerm || null, contractDueDate || null,
        installationType || null, technologyType || null, numPanels || null, peakPowerKw || null,
        peakSunHours || 4.5, expectedAnnualOutput || null,
        tariffRate || null, tariffCurrency || 'USD', tariffEscalation || null,
        yieldInvestorPct || 60, yieldMaintenancePct || 10, yieldPlatformPct || 10, yieldTreasuryPct || 20,
        false, isChecker, latitude || null, longitude || null
      ]
    );

    res.status(201).json({
      success: true,
      message: status === 'active' ? 'Asset created' : 'Asset request submitted for approval',
      asset: result.rows[0]
    });
  } catch (err) {
    console.error('[ADMIN] Error creating asset request:', err);
    res.status(500).json({ error: 'Failed to create asset request', message: err.message });
  }
};

/**
 * Create asset directly (Checker only) - creates site with status 'active'
 * POST /api/admin/assets
 * Body: { name, location, timezone, category, valuation, organizationId?, ...extended fields }
 */
module.exports.createAssetCtrl = async (req, res) => {
  try {
    const {
      name, location, timezone, category, valuation, organizationId,
      latitude, longitude,
      // Extended fields
      description, imageUrl, imageUrls, assetType, portfolioToken, tokenPrice,
      revenueModel, estimatedAnnualIncome, contractTerm, contractDueDate,
      installationType, technologyType, numPanels, peakPowerKw,
      peakSunHours, expectedAnnualOutput,
      tariffRate, tariffCurrency, tariffEscalation,
      yieldInvestorPct, yieldMaintenancePct, yieldPlatformPct, yieldTreasuryPct
    } = req.body;
    const creatorId = req.user.id;

    if (!name || !location || !category) {
      return res.status(400).json({
        error: 'Name, location, and category are required'
      });
    }

    // Validate category
    const validCategories = ['SOLAR', 'EV', 'EE'];
    if (!validCategories.includes(category.toUpperCase())) {
      return res.status(400).json({
        error: 'Invalid category. Must be SOLAR, EV, or EE'
      });
    }

    const urls = Array.isArray(imageUrls) && imageUrls.length > 0
      ? imageUrls.filter(Boolean)
      : (imageUrl ? [imageUrl] : []);
    const primaryImage = urls[0] || imageUrl || null;
    const imageUrlsJson = JSON.stringify(urls);

    const siteId = uuidv4();

    // Checker direct-create: active + visible in console, not in invest
    const result = await query(
      `INSERT INTO sites
       (id, name, location, timezone, category, sites_valuation, organization_id, status, created_by, created_at,
        description, image_url, image_urls, asset_type, portfolio_token, token_price,
        revenue_model, estimated_annual_income, contract_term, contract_due_date,
        installation_type, technology_type, num_panels, peak_power_kw, peak_sun_hours, expected_annual_output,
        tariff_rate, tariff_currency, tariff_escalation,
        yield_investor_pct, yield_maintenance_pct, yield_platform_pct, yield_treasury_pct,
        show_in_invest, show_in_console, latitude, longitude)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, NOW(),
        $9, $10, $11::jsonb, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35)
       RETURNING *`,
      [
        siteId, name, location, timezone || 'UTC', category.toUpperCase(),
        valuation || 0, organizationId || null, creatorId,
        description || null, primaryImage, imageUrlsJson, assetType || null, portfolioToken || null, tokenPrice || 1,
        revenueModel || null, estimatedAnnualIncome || null, contractTerm || null, contractDueDate || null,
        installationType || null, technologyType || null, numPanels || null, peakPowerKw || null,
        peakSunHours || 4.5, expectedAnnualOutput || null,
        tariffRate || null, tariffCurrency || 'USD', tariffEscalation || null,
        yieldInvestorPct || 60, yieldMaintenancePct || 10, yieldPlatformPct || 10, yieldTreasuryPct || 20,
        false, true, latitude || null, longitude || null
      ]
    );

    res.status(201).json({ 
      success: true, 
      message: 'Asset created successfully',
      asset: result.rows[0] 
    });
  } catch (err) {
    console.error('[ADMIN] Error creating asset:', err);
    res.status(500).json({ error: 'Failed to create asset', message: err.message });
  }
};

/**
 * Approve asset request (Checker only)
 * POST /api/admin/assets/:siteId/approve
 */
module.exports.approveAssetCtrl = async (req, res) => {
  try {
    const { siteId } = req.params;

    const result = await query(
      `UPDATE sites
       SET status = 'active', show_in_console = true, show_in_invest = false
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [siteId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Asset not found or already processed' });
    }

    res.json({
      success: true,
      message: 'Asset approved — now visible in console as Pilot',
      asset: result.rows[0]
    });
  } catch (err) {
    console.error('[ADMIN] Error approving asset:', err);
    res.status(500).json({ error: 'Failed to approve asset', message: err.message });
  }
};

/**
 * Reject asset request (Checker only)
 * POST /api/admin/assets/:siteId/reject
 */
module.exports.rejectAssetCtrl = async (req, res) => {
  try {
    const { siteId } = req.params;

    const result = await query(
      `UPDATE sites 
       SET status = 'inactive'
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [siteId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Asset not found or already processed' });
    }

    res.json({ 
      success: true, 
      message: 'Asset request rejected',
      asset: result.rows[0] 
    });
  } catch (err) {
    console.error('[ADMIN] Error rejecting asset:', err);
    res.status(500).json({ error: 'Failed to reject asset', message: err.message });
  }
};

/**
 * Update asset status (Checker only)
 * PUT /api/admin/assets/:siteId/status
 * Body: { status: 'active' | 'inactive' }
 */
module.exports.updateAssetStatusCtrl = async (req, res) => {
  try {
    const { siteId } = req.params;
    const { status } = req.body;

    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({ error: 'Status must be active or inactive' });
    }

    const result = await query(
      `UPDATE sites 
       SET status = $1
       WHERE id = $2
       RETURNING *`,
      [status, siteId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    res.json({ 
      success: true, 
      message: `Asset status updated to ${status}`,
      asset: result.rows[0] 
    });
  } catch (err) {
    console.error('[ADMIN] Error updating asset status:', err);
    res.status(500).json({ error: 'Failed to update asset status', message: err.message });
  }
};

/**
 * Get single asset by ID (Checker only)
 * GET /api/admin/assets/:siteId
 */
module.exports.getAssetByIdCtrl = async (req, res) => {
  try {
    const { siteId } = req.params;

    const result = await query(
      `SELECT
        s.id,
        s.name,
        s.location,
        s.timezone,
        s.category,
        s.sites_valuation,
        s.status,
        s.created_at,
        s.description,
        s.image_url,
        s.image_urls,
        s.asset_type,
        s.portfolio_token,
        s.token_price,
        s.revenue_model,
        s.estimated_annual_income,
        s.contract_term,
        s.contract_due_date,
        s.installation_type,
        s.technology_type,
        s.num_panels,
        s.peak_power_kw,
        s.peak_sun_hours,
        s.expected_annual_output,
        s.tariff_rate,
        s.tariff_currency,
        s.tariff_escalation,
        s.yield_investor_pct,
        s.yield_maintenance_pct,
        s.yield_platform_pct,
        s.yield_treasury_pct,
        s.show_in_invest,
        s.show_in_console,
        o.name as organization_name,
        creator.email as created_by_email,
        creator.wallet_address as created_by_wallet
       FROM sites s
       LEFT JOIN organizations o ON s.organization_id = o.id
       LEFT JOIN users creator ON s.created_by = creator.id
       WHERE s.id = $1`,
      [siteId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    res.json({ asset: result.rows[0] });
  } catch (err) {
    console.error('[ADMIN] Error getting asset:', err);
    res.status(500).json({ error: 'Failed to get asset', message: err.message });
  }
};

/**
 * Update asset details (Checker only)
 * PUT /api/admin/assets/:siteId
 * Body: { name?, location?, timezone?, category?, valuation?, ...extended fields }
 */
module.exports.updateAssetCtrl = async (req, res) => {
  try {
    const { siteId } = req.params;
    const {
      name, location, timezone, category, valuation,
      latitude, longitude,
      description, imageUrl, imageUrls, assetType, portfolioToken, tokenPrice,
      revenueModel, estimatedAnnualIncome, contractTerm, contractDueDate,
      installationType, technologyType, numPanels, peakPowerKw,
      peakSunHours, expectedAnnualOutput,
      tariffRate, tariffCurrency, tariffEscalation,
      yieldInvestorPct, yieldMaintenancePct, yieldPlatformPct, yieldTreasuryPct,
      showInInvest, showInConsole
    } = req.body;

    // Build dynamic update query
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
    }
    if (location !== undefined) {
      updates.push(`location = $${paramIndex++}`);
      values.push(location);
    }
    if (timezone !== undefined) {
      updates.push(`timezone = $${paramIndex++}`);
      values.push(timezone);
    }
    if (category !== undefined) {
      const validCategories = ['SOLAR', 'EV', 'EE'];
      if (!validCategories.includes(category.toUpperCase())) {
        return res.status(400).json({ error: 'Invalid category. Must be SOLAR, EV, or EE' });
      }
      updates.push(`category = $${paramIndex++}`);
      values.push(category.toUpperCase());
    }
    if (valuation !== undefined) {
      updates.push(`sites_valuation = $${paramIndex++}`);
      values.push(valuation);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(description || null);
    }
    if (imageUrls !== undefined) {
      const urls = Array.isArray(imageUrls) ? imageUrls.filter(Boolean) : [];
      updates.push(`image_urls = $${paramIndex++}::jsonb`);
      values.push(JSON.stringify(urls));
      updates.push(`image_url = $${paramIndex++}`);
      values.push(urls.length > 0 ? urls[0] : null);
    } else if (imageUrl !== undefined) {
      updates.push(`image_url = $${paramIndex++}`);
      values.push(imageUrl || null);
    }
    if (assetType !== undefined) {
      updates.push(`asset_type = $${paramIndex++}`);
      values.push(assetType || null);
    }
    if (portfolioToken !== undefined) {
      updates.push(`portfolio_token = $${paramIndex++}`);
      values.push(portfolioToken || null);
    }
    if (tokenPrice !== undefined) {
      updates.push(`token_price = $${paramIndex++}`);
      values.push(tokenPrice);
    }
    if (revenueModel !== undefined) {
      updates.push(`revenue_model = $${paramIndex++}`);
      values.push(revenueModel || null);
    }
    if (estimatedAnnualIncome !== undefined) {
      updates.push(`estimated_annual_income = $${paramIndex++}`);
      values.push(estimatedAnnualIncome || null);
    }
    if (contractTerm !== undefined) {
      updates.push(`contract_term = $${paramIndex++}`);
      values.push(contractTerm || null);
    }
    if (contractDueDate !== undefined) {
      updates.push(`contract_due_date = $${paramIndex++}`);
      values.push(contractDueDate || null);
    }
    if (installationType !== undefined) {
      updates.push(`installation_type = $${paramIndex++}`);
      values.push(installationType || null);
    }
    if (technologyType !== undefined) {
      updates.push(`technology_type = $${paramIndex++}`);
      values.push(technologyType || null);
    }
    if (numPanels !== undefined) {
      updates.push(`num_panels = $${paramIndex++}`);
      values.push(numPanels || null);
    }
    if (peakPowerKw !== undefined) {
      updates.push(`peak_power_kw = $${paramIndex++}`);
      values.push(peakPowerKw || null);
    }
    if (peakSunHours !== undefined) {
      updates.push(`peak_sun_hours = $${paramIndex++}`);
      values.push(peakSunHours || null);
    }
    if (expectedAnnualOutput !== undefined) {
      updates.push(`expected_annual_output = $${paramIndex++}`);
      values.push(expectedAnnualOutput || null);
    }
    if (tariffRate !== undefined) {
      updates.push(`tariff_rate = $${paramIndex++}`);
      values.push(tariffRate || null);
    }
    if (tariffCurrency !== undefined) {
      updates.push(`tariff_currency = $${paramIndex++}`);
      values.push(tariffCurrency || 'MYR');
    }
    if (tariffEscalation !== undefined) {
      updates.push(`tariff_escalation = $${paramIndex++}`);
      values.push(tariffEscalation || null);
    }
    if (yieldInvestorPct !== undefined) {
      updates.push(`yield_investor_pct = $${paramIndex++}`);
      values.push(yieldInvestorPct);
    }
    if (yieldMaintenancePct !== undefined) {
      updates.push(`yield_maintenance_pct = $${paramIndex++}`);
      values.push(yieldMaintenancePct);
    }
    if (yieldPlatformPct !== undefined) {
      updates.push(`yield_platform_pct = $${paramIndex++}`);
      values.push(yieldPlatformPct);
    }
    if (yieldTreasuryPct !== undefined) {
      updates.push(`yield_treasury_pct = $${paramIndex++}`);
      values.push(yieldTreasuryPct);
    }
    if (showInInvest !== undefined) {
      updates.push(`show_in_invest = $${paramIndex++}`);
      values.push(showInInvest);
    }
    if (latitude !== undefined) {
      updates.push(`latitude = $${paramIndex++}`);
      values.push(latitude !== null ? parseFloat(latitude) : null);
    }
    if (longitude !== undefined) {
      updates.push(`longitude = $${paramIndex++}`);
      values.push(longitude !== null ? parseFloat(longitude) : null);
    }
    if (showInConsole !== undefined) {
      updates.push(`show_in_console = $${paramIndex++}`);
      values.push(showInConsole);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(siteId);

    const result = await query(
      `UPDATE sites
       SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${paramIndex}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    res.json({
      success: true,
      message: 'Asset updated successfully',
      asset: result.rows[0]
    });
  } catch (err) {
    console.error('[ADMIN] Error updating asset:', err);
    res.status(500).json({ error: 'Failed to update asset', message: err.message });
  }
};

/**
 * Update asset visibility (Checker only)
 * PUT /api/admin/assets/:siteId/visibility
 * Body: { showInInvest?: boolean, showInConsole?: boolean }
 */
module.exports.updateAssetVisibilityCtrl = async (req, res) => {
  try {
    const { siteId } = req.params;
    const { showInInvest, showInConsole } = req.body;

    // Build dynamic update query
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (typeof showInInvest === 'boolean') {
      updates.push(`show_in_invest = $${paramIndex++}`);
      values.push(showInInvest);
    }

    if (typeof showInConsole === 'boolean') {
      updates.push(`show_in_console = $${paramIndex++}`);
      values.push(showInConsole);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No visibility fields provided' });
    }

    values.push(siteId);

    const result = await query(
      `UPDATE sites 
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    res.json({ 
      success: true, 
      message: 'Asset visibility updated',
      asset: result.rows[0] 
    });
  } catch (err) {
    console.error('[ADMIN] Error updating asset visibility:', err);
    res.status(500).json({ error: 'Failed to update asset visibility', message: err.message });
  }
};

/**
 * Get all registered meters (Checker only) - for linking to sites in admin UI
 * GET /api/admin/meters
 * Query: limit, offset, unlinkedOnly (true to show only meters with no site)
 */
module.exports.getMetersCtrl = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;
    const unlinkedOnly = req.query.unlinkedOnly === 'true';

    const whereClause = unlinkedOnly ? ' WHERE m.site_id IS NULL' : '';

    const result = await query(
      `SELECT
        m.id,
        m.site_id,
        m.meter_identifier,
        m.iot_pubkey,
        m.asset_type,
        m.firmware_version,
        m.active,
        m.installed_at,
        m.gcp_key_id,
        m.gcp_public_key,
        m.key_status,
        s.name as site_name,
        s.location as site_location
       FROM meters m
       LEFT JOIN sites s ON m.site_id = s.id
       ${whereClause}
       ORDER BY m.installed_at DESC NULLS LAST, m.meter_identifier
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await query(
      `SELECT COUNT(*) as total FROM meters m ${whereClause}`,
      []
    );
    const total = parseInt(countResult.rows[0]?.total || '0', 10);

    const meters = result.rows.map(m => ({
      ...m,
      solana_address: pemToSolanaAddress(m.gcp_public_key),
    }));

    res.json({
      meters,
      total,
      limit,
      offset,
    });
  } catch (err) {
    console.error('[ADMIN] Error getting meters:', err);
    res.status(500).json({ error: 'Failed to get meters', message: err.message });
  }
};

/**
 * Link a meter to a site (Checker only)
 * PUT /api/admin/meters/:meterId/site
 * Body: { site_id: UUID } or { site_id: null } to unlink
 */
module.exports.linkMeterToSiteCtrl = async (req, res) => {
  try {
    const { meterId } = req.params;
    const { site_id: siteId } = req.body;

    if (siteId !== undefined && siteId !== null) {
      const siteRes = await query('SELECT id FROM sites WHERE id = $1', [siteId]);
      if (siteRes.rowCount === 0) {
        return res.status(400).json({ error: 'Site does not exist' });
      }
    }

    const result = await query(
      `UPDATE meters SET site_id = $1 WHERE id = $2 RETURNING id, site_id, meter_identifier`,
      [siteId || null, meterId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Meter not found' });
    }

    res.json({
      success: true,
      message: siteId ? 'Meter linked to site' : 'Meter unlinked',
      meter: result.rows[0],
    });
  } catch (err) {
    console.error('[ADMIN] Error linking meter to site:', err);
    res.status(500).json({ error: 'Failed to link meter', message: err.message });
  }
};

/**
 * Create a GCP KMS Ed25519 signing key for a meter (Checker only)
 * POST /api/admin/meters/:meterId/signing-key
 */
module.exports.createMeterSigningKeyCtrl = async (req, res) => {
  try {
    const { meterId } = req.params;

    // Check meter exists
    const meterRes = await query(
      'SELECT id, key_status, gcp_key_id FROM meters WHERE id = $1',
      [meterId]
    );
    if (meterRes.rowCount === 0) {
      return res.status(404).json({ error: 'Meter not found' });
    }

    const meter = meterRes.rows[0];
    if (meter.key_status === 'authorized') {
      return res.status(409).json({ error: 'Meter already has an active signing key. Revoke it first.' });
    }

    // Create key in GCP KMS
    const { keyVersionName, publicKeyPem } = await gcpKms.createMeterKey(meterId);

    // Persist in DB
    const result = await query(
      `UPDATE meters
       SET gcp_key_id = $1, gcp_public_key = $2, key_status = 'authorized'
       WHERE id = $3
       RETURNING id, meter_identifier, gcp_key_id, gcp_public_key, key_status`,
      [keyVersionName, publicKeyPem, meterId]
    );

    res.status(201).json({
      success: true,
      message: 'Signing key created and authorized',
      meter: result.rows[0],
    });
  } catch (err) {
    console.error('[ADMIN] Error creating meter signing key:', err);
    res.status(500).json({ error: 'Failed to create signing key', message: err.message });
  }
};

/**
 * Revoke a meter's GCP KMS signing key (Checker only)
 * DELETE /api/admin/meters/:meterId/signing-key
 */
module.exports.revokeMeterSigningKeyCtrl = async (req, res) => {
  try {
    const { meterId } = req.params;

    const meterRes = await query(
      'SELECT id, gcp_key_id, key_status FROM meters WHERE id = $1',
      [meterId]
    );
    if (meterRes.rowCount === 0) {
      return res.status(404).json({ error: 'Meter not found' });
    }

    const meter = meterRes.rows[0];
    if (meter.key_status !== 'authorized' || !meter.gcp_key_id) {
      return res.status(400).json({ error: 'No active signing key to revoke' });
    }

    // Destroy key version in GCP KMS
    await gcpKms.revokeMeterKey(meter.gcp_key_id);

    // Update DB
    const result = await query(
      `UPDATE meters
       SET key_status = 'revoked'
       WHERE id = $1
       RETURNING id, meter_identifier, gcp_key_id, key_status`,
      [meterId]
    );

    res.json({
      success: true,
      message: 'Signing key revoked. The key will be destroyed after the GCP grace period.',
      meter: result.rows[0],
    });
  } catch (err) {
    console.error('[ADMIN] Error revoking meter signing key:', err);
    res.status(500).json({ error: 'Failed to revoke signing key', message: err.message });
  }
};

/**
 * Get maker's own asset requests
 * GET /api/admin/my-requests
 */
module.exports.getMyAssetRequestsCtrl = async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const result = await query(
      `SELECT 
        s.id,
        s.name,
        s.location,
        s.timezone,
        s.category,
        s.sites_valuation,
        s.status,
        s.created_at,
        o.name as organization_name
       FROM sites s
       LEFT JOIN organizations o ON s.organization_id = o.id
       WHERE s.created_by = $1
       ORDER BY s.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    res.json({
      assets: result.rows,
    });
  } catch (err) {
    console.error('[ADMIN] Error getting my requests:', err);
    res.status(500).json({ error: 'Failed to get requests', message: err.message });
  }
};

// ============================================
// USER MANAGEMENT (Checker only)
// ============================================

/**
 * Get all users (Checker only)
 * GET /api/admin/users
 */
module.exports.getAllUsersCtrl = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const result = await query(
      `SELECT 
        id, email, wallet_address, user_type, kyc_status, 
        available_balance, created_at, updated_at
       FROM users
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await query(`SELECT COUNT(*) as total FROM users`);

    res.json({
      users: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit,
      offset,
    });
  } catch (err) {
    console.error('[ADMIN] Error getting users:', err);
    res.status(500).json({ error: 'Failed to get users', message: err.message });
  }
};

/**
 * Update user type (Checker only)
 * PUT /api/admin/users/:userId/type
 * Body: { userType: 'user' | 'maker' | 'checker' }
 */
module.exports.updateUserTypeCtrl = async (req, res) => {
  try {
    const { userId } = req.params;
    const { userType } = req.body;

    if (!['user', 'maker', 'checker'].includes(userType)) {
      return res.status(400).json({ error: 'Invalid user type' });
    }

    const result = await query(
      `UPDATE users 
       SET user_type = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, email, wallet_address, user_type`,
      [userType, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ 
      success: true, 
      message: `User type updated to ${userType}`,
      user: result.rows[0] 
    });
  } catch (err) {
    console.error('[ADMIN] Error updating user type:', err);
    res.status(500).json({ error: 'Failed to update user type', message: err.message });
  }
};

/**
 * Manually adjust user balance (Checker only)
 * POST /api/admin/users/:userId/balance
 * Body: { amount, operation: 'add' | 'subtract', reason }
 */
module.exports.adjustUserBalanceCtrl = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { userId } = req.params;
    const { amount, operation, reason } = req.body;

    if (!amount || !operation || !reason) {
      return res.status(400).json({ 
        error: 'Amount, operation, and reason are required' 
      });
    }

    if (!['add', 'subtract'].includes(operation)) {
      return res.status(400).json({ error: 'Operation must be add or subtract' });
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive number' });
    }

    await client.query('BEGIN');

    // Update balance
    const operator = operation === 'add' ? '+' : '-';
    const result = await client.query(
      `UPDATE users 
       SET available_balance = available_balance ${operator} $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING id, email, wallet_address, available_balance`,
      [amountNum, userId]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }

    // Record the transaction
    const txType = operation === 'add' ? 'DEPOSIT' : 'WITHDRAW';
    await client.query(
      `INSERT INTO user_transactions 
       (user_id, transaction_type, amount_usd, status, notes)
       VALUES ($1, $2, $3, 'COMPLETED', $4)`,
      [userId, txType, amountNum, `Admin adjustment: ${reason}`]
    );

    await client.query('COMMIT');

    res.json({ 
      success: true, 
      message: `Balance ${operation === 'add' ? 'increased' : 'decreased'} by ${amountNum}`,
      user: result.rows[0] 
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[ADMIN] Error adjusting balance:', err);
    res.status(500).json({ error: 'Failed to adjust balance', message: err.message });
  } finally {
    client.release();
  }
};

// ============================================
// DASHBOARD STATS (Checker only)
// ============================================

/**
 * Get admin dashboard stats
 * GET /api/admin/stats
 */
module.exports.getAdminStatsCtrl = async (req, res) => {
  try {
    // Parallel queries for dashboard stats
    const [
      pendingDeposits,
      pendingAssets,
      totalUsers,
      activeAssets,
      pendingAssetOwners,
      pendingDeviceOrders,
      pendingMeterLinks,
    ] = await Promise.all([
      query(`SELECT COUNT(*) as count FROM deposit_requests WHERE status = 'pending'`),
      query(`SELECT COUNT(*) as count FROM sites WHERE status = 'pending'`),
      query(`SELECT COUNT(*) as count FROM users`),
      query(`SELECT COUNT(*) as count FROM sites WHERE status = 'active'`),
      query(`SELECT COUNT(*) as count FROM asset_owner_requests WHERE status = 'pending'`),
      query(`SELECT COUNT(*) as count FROM device_orders WHERE status = 'pending_approval'`),
      query(`SELECT COUNT(*) as count FROM meter_link_requests WHERE status = 'pending'`),
    ]);

    res.json({
      pendingDeposits: parseInt(pendingDeposits.rows[0].count),
      pendingAssets: parseInt(pendingAssets.rows[0].count),
      totalUsers: parseInt(totalUsers.rows[0].count),
      activeAssets: parseInt(activeAssets.rows[0].count),
      pendingAssetOwners: parseInt(pendingAssetOwners.rows[0].count),
      pendingDeviceOrders: parseInt(pendingDeviceOrders.rows[0].count),
      pendingMeterLinks: parseInt(pendingMeterLinks.rows[0].count),
    });
  } catch (err) {
    console.error('[ADMIN] Error getting stats:', err);
    res.status(500).json({ error: 'Failed to get stats', message: err.message });
  }
};

// ============================================
// ASSET OWNER REQUEST MANAGEMENT (Checker only)
// ============================================

/**
 * Get all asset owner requests (for checker)
 * GET /api/admin/asset-owner-requests
 * Query params: status (pending|approved|rejected), limit, offset
 */
module.exports.getAssetOwnerRequestsCtrl = async (req, res) => {
  try {
    const status = req.query.status || 'pending';
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const result = await query(
      `SELECT
        aor.id,
        aor.company_name,
        aor.contact_email,
        aor.message,
        aor.status,
        aor.rejection_reason,
        aor.created_at,
        aor.reviewed_at,
        u.id as user_id,
        u.email as user_email,
        u.wallet_address as user_wallet,
        u.user_type as current_role,
        reviewer.email as reviewed_by_email
       FROM asset_owner_requests aor
       JOIN users u ON aor.user_id = u.id
       LEFT JOIN users reviewer ON aor.reviewed_by = reviewer.id
       WHERE aor.status = $1
       ORDER BY aor.created_at DESC
       LIMIT $2 OFFSET $3`,
      [status, limit, offset]
    );

    const countResult = await query(
      `SELECT COUNT(*) as total FROM asset_owner_requests WHERE status = $1`,
      [status]
    );

    res.json({
      requests: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit,
      offset,
    });
  } catch (err) {
    console.error('[ADMIN] Error getting asset owner requests:', err);
    res.status(500).json({ error: 'Failed to get asset owner requests', message: err.message });
  }
};

/**
 * Approve asset owner request (Checker only)
 * POST /api/admin/asset-owner-requests/:id/approve
 * On approval: upgrades user to 'maker' role
 */
module.exports.approveAssetOwnerRequestCtrl = async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const checkerId = req.user.id;

    await client.query('BEGIN');

    // Get the request
    const requestResult = await client.query(
      `SELECT aor.*, u.id as user_id, u.user_type
       FROM asset_owner_requests aor
       JOIN users u ON aor.user_id = u.id
       WHERE aor.id = $1 AND aor.status = 'pending'`,
      [id]
    );

    if (requestResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Request not found or already processed' });
    }

    const request = requestResult.rows[0];

    // Update request status
    await client.query(
      `UPDATE asset_owner_requests
       SET status = 'approved',
           reviewed_by = $1,
           reviewed_at = NOW()
       WHERE id = $2`,
      [checkerId, id]
    );

    // Create organization for the maker (they set up branding later via admin portal)
    const orgId = uuidv4();
    await client.query(
      `INSERT INTO organizations (id, name, org_type, created_at)
       VALUES ($1, $2, 'ASSET_OWNER', NOW())`,
      [orgId, request.contact_email]
    );

    // Upgrade user to maker role and link to organization
    await client.query(
      `UPDATE users
       SET user_type = 'maker',
           organization_id = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [orgId, request.user_id]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Asset owner request approved. User upgraded to maker role with organization created.',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[ADMIN] Error approving asset owner request:', err);
    res.status(500).json({ error: 'Failed to approve request', message: err.message });
  } finally {
    client.release();
  }
};

/**
 * Reject asset owner request (Checker only)
 * POST /api/admin/asset-owner-requests/:id/reject
 * Body: { reason }
 */
module.exports.rejectAssetOwnerRequestCtrl = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const checkerId = req.user.id;

    if (!reason) {
      return res.status(400).json({ error: 'Rejection reason is required' });
    }

    const result = await query(
      `UPDATE asset_owner_requests
       SET status = 'rejected',
           rejection_reason = $1,
           reviewed_by = $2,
           reviewed_at = NOW()
       WHERE id = $3 AND status = 'pending'
       RETURNING *`,
      [reason, checkerId, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found or already processed' });
    }

    res.json({
      success: true,
      message: 'Asset owner request rejected',
      reason,
    });
  } catch (err) {
    console.error('[ADMIN] Error rejecting asset owner request:', err);
    res.status(500).json({ error: 'Failed to reject request', message: err.message });
  }
};

/**
 * Get GEN bank details for deposit
 * GET /api/admin/bank-details
 */
module.exports.getBankDetailsCtrl = async (req, res) => {
  res.json({
    bankName: process.env.GEN_BANK_NAME || 'GEN Bank',
    accountNumber: process.env.GEN_BANK_ACCOUNT_NUMBER || '1234567890',
    routingNumber: process.env.GEN_BANK_ROUTING_NUMBER || '021000021',
    swiftCode: process.env.GEN_BANK_SWIFT_CODE || 'GENBANK01',
    accountName: process.env.GEN_BANK_ACCOUNT_NAME || 'GEN Investment Platform',
  });
};

// ============================================
// TOKENIZATION (Maker-Checker Pattern)
// ============================================

/**
 * Request tokenization for a live asset (Maker or Checker)
 * POST /api/admin/assets/:siteId/tokenize-request
 * If caller is checker, auto-approves immediately.
 */
module.exports.requestTokenizationCtrl = async (req, res) => {
  try {
    const { siteId } = req.params;

    const siteResult = await query(
      `SELECT s.id, s.status, s.is_tokenized, s.tokenization_status,
              (SELECT COUNT(*) FROM meters m WHERE m.site_id = s.id) as meter_count
       FROM sites s WHERE s.id = $1`,
      [siteId]
    );

    if (siteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    const site = siteResult.rows[0];

    if (site.status !== 'active') {
      return res.status(400).json({ error: 'Asset must be approved (active) before tokenization' });
    }

    if (parseInt(site.meter_count) === 0) {
      return res.status(400).json({ error: 'Asset must have at least one linked meter (be Live) before tokenization' });
    }

    if (site.is_tokenized) {
      return res.status(400).json({ error: 'Asset is already tokenized' });
    }

    if (site.tokenization_status === 'pending') {
      return res.status(400).json({ error: 'Tokenization request already pending' });
    }

    // If checker, auto-approve: tokenize immediately
    if (req.user.user_type === 'checker') {
      const result = await query(
        `UPDATE sites
         SET is_tokenized = true, tokenized_at = NOW(), show_in_invest = true, tokenization_status = 'approved'
         WHERE id = $1
         RETURNING *`,
        [siteId]
      );

      return res.json({
        success: true,
        message: 'Asset tokenized and now visible in invest portal',
        asset: result.rows[0],
      });
    }

    // Maker: submit request for checker approval
    const result = await query(
      `UPDATE sites
       SET tokenization_status = 'pending'
       WHERE id = $1
       RETURNING *`,
      [siteId]
    );

    res.json({
      success: true,
      message: 'Tokenization request submitted for approval',
      asset: result.rows[0],
    });
  } catch (err) {
    console.error('[ADMIN] Error requesting tokenization:', err);
    res.status(500).json({ error: 'Failed to request tokenization', message: err.message });
  }
};

/**
 * Approve tokenization request (Checker only)
 * POST /api/admin/assets/:siteId/tokenize-approve
 */
module.exports.approveTokenizationCtrl = async (req, res) => {
  try {
    const { siteId } = req.params;

    const result = await query(
      `UPDATE sites
       SET is_tokenized = true, tokenized_at = NOW(), show_in_invest = true, tokenization_status = 'approved'
       WHERE id = $1 AND tokenization_status = 'pending'
       RETURNING *`,
      [siteId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No pending tokenization request found for this asset' });
    }

    res.json({
      success: true,
      message: 'Tokenization approved — asset now visible in invest portal',
      asset: result.rows[0],
    });
  } catch (err) {
    console.error('[ADMIN] Error approving tokenization:', err);
    res.status(500).json({ error: 'Failed to approve tokenization', message: err.message });
  }
};

/**
 * Reject tokenization request (Checker only)
 * POST /api/admin/assets/:siteId/tokenize-reject
 */
module.exports.rejectTokenizationCtrl = async (req, res) => {
  try {
    const { siteId } = req.params;

    const result = await query(
      `UPDATE sites
       SET tokenization_status = 'rejected'
       WHERE id = $1 AND tokenization_status = 'pending'
       RETURNING *`,
      [siteId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No pending tokenization request found for this asset' });
    }

    res.json({
      success: true,
      message: 'Tokenization request rejected',
      asset: result.rows[0],
    });
  } catch (err) {
    console.error('[ADMIN] Error rejecting tokenization:', err);
    res.status(500).json({ error: 'Failed to reject tokenization', message: err.message });
  }
};

/**
 * Check tokenization eligibility (Maker or Checker)
 * GET /api/admin/assets/:siteId/tokenize-check
 */
module.exports.checkTokenizationEligibilityCtrl = async (req, res) => {
  try {
    const { siteId } = req.params;

    const result = await query(
      `SELECT s.status, s.is_tokenized, s.tokenization_status, s.show_in_console, s.show_in_invest,
              (SELECT COUNT(*) FROM meters m WHERE m.site_id = s.id) as meter_count
       FROM sites s WHERE s.id = $1`,
      [siteId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    const site = result.rows[0];
    const meterCount = parseInt(site.meter_count);
    const eligible = site.status === 'active' && meterCount > 0 && !site.is_tokenized && site.tokenization_status !== 'pending';

    const reasons = [];
    if (site.status !== 'active') reasons.push('Asset must be approved (active)');
    if (meterCount === 0) reasons.push('Asset must have at least one linked meter');
    if (site.is_tokenized) reasons.push('Asset is already tokenized');
    if (site.tokenization_status === 'pending') reasons.push('Tokenization request already pending');

    res.json({
      eligible,
      status: site.status,
      meterCount,
      isTokenized: site.is_tokenized,
      tokenizationStatus: site.tokenization_status,
      showInConsole: site.show_in_console,
      showInInvest: site.show_in_invest,
      reasons,
    });
  } catch (err) {
    console.error('[ADMIN] Error checking tokenization eligibility:', err);
    res.status(500).json({ error: 'Failed to check eligibility', message: err.message });
  }
};

// ============================================
// MAKER BRANDING
// ============================================

/**
 * Get maker's organization branding
 * GET /api/admin/my-branding
 */
module.exports.getMyBrandingCtrl = async (req, res) => {
  try {
    const userId = req.user.id;

    const userResult = await query(
      `SELECT u.organization_id FROM users u WHERE u.id = $1`,
      [userId]
    );

    if (!userResult.rows[0]?.organization_id) {
      return res.json({ branding: null, message: 'No organization linked to this account' });
    }

    const orgResult = await query(
      `SELECT id, name, company_name, logo_url, org_type, theme_colors FROM organizations WHERE id = $1`,
      [userResult.rows[0].organization_id]
    );

    res.json({ branding: orgResult.rows[0] || null });
  } catch (err) {
    console.error('[ADMIN] Error getting branding:', err);
    res.status(500).json({ error: 'Failed to get branding', message: err.message });
  }
};

/**
 * Update maker's organization branding (logo + company name)
 * PUT /api/admin/my-branding
 * Body: { companyName?, logoUrl? }
 */
module.exports.updateMyBrandingCtrl = async (req, res) => {
  try {
    const userId = req.user.id;
    const { companyName, logoUrl, themeColors } = req.body;

    const userResult = await query(
      `SELECT u.organization_id FROM users u WHERE u.id = $1`,
      [userId]
    );

    const orgId = userResult.rows[0]?.organization_id;

    if (!orgId) {
      return res.status(400).json({ error: 'No organization linked to this account. Contact admin.' });
    }

    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (companyName !== undefined) {
      updates.push(`company_name = $${paramIndex++}`);
      values.push(companyName);
    }
    if (logoUrl !== undefined) {
      updates.push(`logo_url = $${paramIndex++}`);
      values.push(logoUrl);
    }
    if (themeColors !== undefined) {
      updates.push(`theme_colors = $${paramIndex++}`);
      values.push(JSON.stringify(themeColors));
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = NOW()`);
    values.push(orgId);

    const result = await query(
      `UPDATE organizations SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    res.json({ success: true, branding: result.rows[0] });
  } catch (err) {
    console.error('[ADMIN] Error updating branding:', err);
    res.status(500).json({ error: 'Failed to update branding', message: err.message });
  }
};

/**
 * Get organization branding by org ID (public, no auth required)
 * GET /api/org/:orgId/branding
 */
module.exports.getOrgBrandingCtrl = async (req, res) => {
  try {
    const { orgId } = req.params;

    const result = await query(
      `SELECT id, company_name, logo_url, org_type, theme_colors FROM organizations WHERE id = $1`,
      [orgId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    res.json({ branding: result.rows[0] });
  } catch (err) {
    console.error('[ADMIN] Error getting org branding:', err);
    res.status(500).json({ error: 'Failed to get org branding', message: err.message });
  }
};

// ============================================
// ASSET EDIT REQUESTS (Maker-Checker Pattern)
// ============================================

// Map camelCase body keys to snake_case DB columns
const editFieldMap = {
  name: 'name',
  location: 'location',
  timezone: 'timezone',
  category: 'category',
  valuation: 'sites_valuation',
  latitude: 'latitude',
  longitude: 'longitude',
  description: 'description',
  imageUrl: 'image_url',
  imageUrls: 'image_urls',
  assetType: 'asset_type',
  portfolioToken: 'portfolio_token',
  tokenPrice: 'token_price',
  revenueModel: 'revenue_model',
  estimatedAnnualIncome: 'estimated_annual_income',
  contractTerm: 'contract_term',
  contractDueDate: 'contract_due_date',
  installationType: 'installation_type',
  technologyType: 'technology_type',
  numPanels: 'num_panels',
  peakPowerKw: 'peak_power_kw',
  peakSunHours: 'peak_sun_hours',
  expectedAnnualOutput: 'expected_annual_output',
  tariffRate: 'tariff_rate',
  tariffCurrency: 'tariff_currency',
  tariffEscalation: 'tariff_escalation',
  yieldInvestorPct: 'yield_investor_pct',
  yieldMaintenancePct: 'yield_maintenance_pct',
  yieldPlatformPct: 'yield_platform_pct',
  yieldTreasuryPct: 'yield_treasury_pct',
  showInInvest: 'show_in_invest',
  showInConsole: 'show_in_console',
};

/**
 * Create asset edit request (Maker or Checker)
 * POST /api/admin/assets/:siteId/edit-request
 * If checker: auto-approve and apply changes directly.
 */
module.exports.createAssetEditRequestCtrl = async (req, res) => {
  try {
    const { siteId } = req.params;
    const walletAddress = req.user.wallet_address;

    // Fetch current asset values
    const siteResult = await query(`SELECT * FROM sites WHERE id = $1`, [siteId]);
    if (siteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Asset not found' });
    }
    const site = siteResult.rows[0];

    // Compute proposed_changes and original_values (only changed fields)
    const proposedChanges = {};
    const originalValues = {};

    for (const [bodyKey, dbCol] of Object.entries(editFieldMap)) {
      if (req.body[bodyKey] !== undefined) {
        const newVal = req.body[bodyKey];
        const oldVal = site[dbCol];

        // Normalize for comparison
        const normalizedNew = JSON.stringify(newVal);
        const normalizedOld = JSON.stringify(oldVal);

        if (normalizedNew !== normalizedOld) {
          proposedChanges[bodyKey] = newVal;
          originalValues[bodyKey] = oldVal;
        }
      }
    }

    if (Object.keys(proposedChanges).length === 0) {
      return res.status(400).json({ error: 'No changes detected' });
    }

    // If checker, auto-approve: apply changes directly
    if (req.user.user_type === 'checker') {
      // Use the existing updateAsset logic
      const updates = [];
      const values = [];
      let paramIndex = 1;

      for (const [bodyKey, newVal] of Object.entries(proposedChanges)) {
        const dbCol = editFieldMap[bodyKey];
        if (dbCol === 'image_urls') {
          const urls = Array.isArray(newVal) ? newVal.filter(Boolean) : [];
          updates.push(`image_urls = $${paramIndex++}::jsonb`);
          values.push(JSON.stringify(urls));
          updates.push(`image_url = $${paramIndex++}`);
          values.push(urls.length > 0 ? urls[0] : null);
        } else {
          updates.push(`${dbCol} = $${paramIndex++}`);
          values.push(newVal);
        }
      }

      values.push(siteId);
      await query(
        `UPDATE sites SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramIndex}`,
        values
      );

      // Also record the edit request as auto-approved
      await query(
        `INSERT INTO asset_edit_requests (site_id, requested_by, status, proposed_changes, original_values, reviewed_by)
         VALUES ($1, $2, 'approved', $3, $4, $5)`,
        [siteId, walletAddress, JSON.stringify(proposedChanges), JSON.stringify(originalValues), walletAddress]
      );

      return res.json({
        success: true,
        message: 'Changes applied directly (checker auto-approved)',
      });
    }

    // Maker: create pending edit request
    const result = await query(
      `INSERT INTO asset_edit_requests (site_id, requested_by, status, proposed_changes, original_values)
       VALUES ($1, $2, 'pending', $3, $4)
       RETURNING *`,
      [siteId, walletAddress, JSON.stringify(proposedChanges), JSON.stringify(originalValues)]
    );

    res.json({
      success: true,
      message: 'Edit request submitted for approval',
      editRequest: result.rows[0],
    });
  } catch (err) {
    console.error('[ADMIN] Error creating asset edit request:', err);
    res.status(500).json({ error: 'Failed to create edit request', message: err.message });
  }
};

/**
 * Get all asset edit requests (Checker only)
 * GET /api/admin/asset-edit-requests?status=pending
 */
module.exports.getAssetEditRequestsCtrl = async (req, res) => {
  try {
    const status = req.query.status || 'pending';
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const result = await query(
      `SELECT
        aer.id,
        aer.site_id,
        aer.requested_by,
        aer.status,
        aer.proposed_changes,
        aer.original_values,
        aer.reviewed_by,
        aer.review_note,
        aer.created_at,
        aer.updated_at,
        s.name as asset_name,
        s.category as asset_category
       FROM asset_edit_requests aer
       JOIN sites s ON aer.site_id = s.id
       WHERE aer.status = $1
       ORDER BY aer.created_at DESC
       LIMIT $2 OFFSET $3`,
      [status, limit, offset]
    );

    const countResult = await query(
      `SELECT COUNT(*) as total FROM asset_edit_requests WHERE status = $1`,
      [status]
    );

    res.json({
      requests: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit,
      offset,
    });
  } catch (err) {
    console.error('[ADMIN] Error getting asset edit requests:', err);
    res.status(500).json({ error: 'Failed to get edit requests', message: err.message });
  }
};

/**
 * Get maker's own edit requests
 * GET /api/admin/my-edit-requests
 */
module.exports.getMyAssetEditRequestsCtrl = async (req, res) => {
  try {
    const walletAddress = req.user.wallet_address;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const result = await query(
      `SELECT
        aer.id,
        aer.site_id,
        aer.requested_by,
        aer.status,
        aer.proposed_changes,
        aer.original_values,
        aer.reviewed_by,
        aer.review_note,
        aer.created_at,
        aer.updated_at,
        s.name as asset_name,
        s.category as asset_category
       FROM asset_edit_requests aer
       JOIN sites s ON aer.site_id = s.id
       WHERE aer.requested_by = $1
       ORDER BY aer.created_at DESC
       LIMIT $2 OFFSET $3`,
      [walletAddress, limit, offset]
    );

    res.json({ requests: result.rows });
  } catch (err) {
    console.error('[ADMIN] Error getting my edit requests:', err);
    res.status(500).json({ error: 'Failed to get edit requests', message: err.message });
  }
};

/**
 * Approve asset edit request (Checker only)
 * POST /api/admin/asset-edit-requests/:requestId/approve
 */
module.exports.approveAssetEditRequestCtrl = async (req, res) => {
  const client = await pool.connect();

  try {
    const { requestId } = req.params;
    const reviewerWallet = req.user.wallet_address;
    const { note } = req.body;

    await client.query('BEGIN');

    // Get the pending request
    const requestResult = await client.query(
      `SELECT * FROM asset_edit_requests WHERE id = $1 AND status = 'pending'`,
      [requestId]
    );

    if (requestResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Edit request not found or already processed' });
    }

    const editRequest = requestResult.rows[0];
    const proposedChanges = editRequest.proposed_changes;

    // Apply proposed_changes to the sites table
    const updates = [];
    const values = [];
    let paramIndex = 1;

    for (const [bodyKey, newVal] of Object.entries(proposedChanges)) {
      const dbCol = editFieldMap[bodyKey];
      if (!dbCol) continue;
      if (dbCol === 'image_urls') {
        const urls = Array.isArray(newVal) ? newVal.filter(Boolean) : [];
        updates.push(`image_urls = $${paramIndex++}::jsonb`);
        values.push(JSON.stringify(urls));
        updates.push(`image_url = $${paramIndex++}`);
        values.push(urls.length > 0 ? urls[0] : null);
      } else {
        updates.push(`${dbCol} = $${paramIndex++}`);
        values.push(newVal);
      }
    }

    if (updates.length > 0) {
      values.push(editRequest.site_id);
      await client.query(
        `UPDATE sites SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramIndex}`,
        values
      );
    }

    // Mark request as approved
    await client.query(
      `UPDATE asset_edit_requests
       SET status = 'approved', reviewed_by = $1, review_note = $2, updated_at = NOW()
       WHERE id = $3`,
      [reviewerWallet, note || null, requestId]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Edit request approved and changes applied',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[ADMIN] Error approving asset edit request:', err);
    res.status(500).json({ error: 'Failed to approve edit request', message: err.message });
  } finally {
    client.release();
  }
};

/**
 * Reject asset edit request (Checker only)
 * POST /api/admin/asset-edit-requests/:requestId/reject
 * Body: { note }
 */
module.exports.rejectAssetEditRequestCtrl = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { note } = req.body;
    const reviewerWallet = req.user.wallet_address;

    const result = await query(
      `UPDATE asset_edit_requests
       SET status = 'rejected', reviewed_by = $1, review_note = $2, updated_at = NOW()
       WHERE id = $3 AND status = 'pending'
       RETURNING *`,
      [reviewerWallet, note || null, requestId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Edit request not found or already processed' });
    }

    res.json({
      success: true,
      message: 'Edit request rejected',
    });
  } catch (err) {
    console.error('[ADMIN] Error rejecting asset edit request:', err);
    res.status(500).json({ error: 'Failed to reject edit request', message: err.message });
  }
};

// ============================================
// DEVICE PURCHASE ORDERS
// ============================================

/**
 * Get all device orders (Checker only)
 * GET /api/admin/device-orders?status=pending_payment&limit=50&offset=0
 */
module.exports.getDeviceOrdersCtrl = async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;

    let whereClause = '';
    const params = [];

    if (status) {
      params.push(status);
      whereClause = `WHERE dor.status = $${params.length}`;
    }

    params.push(parseInt(limit), parseInt(offset));

    const countResult = await query(
      `SELECT COUNT(*) FROM device_orders dor ${whereClause}`,
      status ? [status] : []
    );

    const result = await query(
      `SELECT dor.*, u.email as user_email, u.wallet_address as user_wallet,
              r.email as reviewed_by_email
       FROM device_orders dor
       JOIN users u ON dor.user_id = u.id
       LEFT JOIN users r ON dor.reviewed_by = r.id
       ${whereClause}
       ORDER BY dor.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      orders: result.rows,
      total: parseInt(countResult.rows[0].count),
    });
  } catch (err) {
    console.error('[ADMIN] Error fetching device orders:', err);
    res.status(500).json({ error: 'Failed to fetch device orders', message: err.message });
  }
};

/**
 * Get maker's own device orders
 * GET /api/admin/my-device-orders
 */
module.exports.getMyDeviceOrdersCtrl = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 50, offset = 0 } = req.query;

    const result = await query(
      `SELECT dor.*, r.email as reviewed_by_email
       FROM device_orders dor
       LEFT JOIN users r ON dor.reviewed_by = r.id
       WHERE dor.user_id = $1
       ORDER BY dor.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, parseInt(limit), parseInt(offset)]
    );

    res.json({ orders: result.rows });
  } catch (err) {
    console.error('[ADMIN] Error fetching my device orders:', err);
    res.status(500).json({ error: 'Failed to fetch orders', message: err.message });
  }
};

/**
 * Create a device order (Maker or Checker)
 * POST /api/admin/device-orders
 * Body: { quantity, deliveryAddress }
 */
module.exports.createDeviceOrderCtrl = async (req, res) => {
  try {
    const userId = req.user.id;
    const { quantity, deliveryAddress } = req.body;

    if (!quantity || quantity < 1) {
      return res.status(400).json({ error: 'Quantity must be at least 1' });
    }
    if (!deliveryAddress || !deliveryAddress.trim()) {
      return res.status(400).json({ error: 'Delivery address is required' });
    }

    // Get the current unit price
    const priceResult = await query(
      `SELECT value FROM platform_settings WHERE key = 'gen_core_unit_price'`
    );

    const unitPrice = priceResult.rows.length > 0
      ? parseFloat(priceResult.rows[0].value.amount)
      : 0;

    const totalAmount = unitPrice * quantity;

    const result = await query(
      `INSERT INTO device_orders (user_id, quantity, unit_price, total_amount, delivery_address, status)
       VALUES ($1, $2, $3, $4, $5, 'pending_payment')
       RETURNING *`,
      [userId, quantity, unitPrice, totalAmount, deliveryAddress.trim()]
    );

    res.json({
      success: true,
      message: 'Device order created',
      order: result.rows[0],
    });
  } catch (err) {
    console.error('[ADMIN] Error creating device order:', err);
    res.status(500).json({ error: 'Failed to create device order', message: err.message });
  }
};

/**
 * Upload payment receipt for a device order (Maker or Checker)
 * POST /api/admin/device-orders/:id/receipt
 * Multipart form with 'receipt' file
 */
module.exports.uploadDeviceOrderReceiptCtrl = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    if (!req.file) {
      return res.status(400).json({ error: 'Receipt file is required' });
    }

    // Verify the order belongs to this user and is in pending_payment status
    const orderResult = await query(
      `SELECT * FROM device_orders WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (orderResult.rows[0].status !== 'pending_payment') {
      return res.status(400).json({ error: 'Receipt can only be uploaded for orders pending payment' });
    }

    const receiptPath = req.file.filename;

    const result = await query(
      `UPDATE device_orders
       SET receipt_path = $1, status = 'pending_approval', updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [receiptPath, id]
    );

    res.json({
      success: true,
      message: 'Receipt uploaded successfully',
      order: result.rows[0],
    });
  } catch (err) {
    console.error('[ADMIN] Error uploading device order receipt:', err);
    res.status(500).json({ error: 'Failed to upload receipt', message: err.message });
  }
};

/**
 * Approve a device order (Checker only)
 * POST /api/admin/device-orders/:id/approve
 * Body: { notes }
 */
module.exports.approveDeviceOrderCtrl = async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const reviewerId = req.user.id;

    const result = await query(
      `UPDATE device_orders
       SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(), notes = $2, updated_at = NOW()
       WHERE id = $3 AND status = 'pending_approval'
       RETURNING *`,
      [reviewerId, notes || null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found or not pending approval' });
    }

    res.json({
      success: true,
      message: 'Device order approved',
      order: result.rows[0],
    });
  } catch (err) {
    console.error('[ADMIN] Error approving device order:', err);
    res.status(500).json({ error: 'Failed to approve device order', message: err.message });
  }
};

/**
 * Reject a device order (Checker only)
 * POST /api/admin/device-orders/:id/reject
 * Body: { reason }
 */
module.exports.rejectDeviceOrderCtrl = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const reviewerId = req.user.id;

    if (!reason) {
      return res.status(400).json({ error: 'Rejection reason is required' });
    }

    const result = await query(
      `UPDATE device_orders
       SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(), rejection_reason = $2, updated_at = NOW()
       WHERE id = $3 AND status = 'pending_approval'
       RETURNING *`,
      [reviewerId, reason, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found or not pending approval' });
    }

    res.json({
      success: true,
      message: 'Device order rejected',
      order: result.rows[0],
    });
  } catch (err) {
    console.error('[ADMIN] Error rejecting device order:', err);
    res.status(500).json({ error: 'Failed to reject device order', message: err.message });
  }
};

/**
 * Update device order status to shipped/delivered (Checker only)
 * PUT /api/admin/device-orders/:id/status
 * Body: { status }
 */
module.exports.updateDeviceOrderStatusCtrl = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['shipped', 'delivered'].includes(status)) {
      return res.status(400).json({ error: 'Status must be shipped or delivered' });
    }

    const result = await query(
      `UPDATE device_orders
       SET status = $1, updated_at = NOW()
       WHERE id = $2 AND status IN ('approved', 'shipped')
       RETURNING *`,
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found or cannot update status' });
    }

    res.json({
      success: true,
      message: `Order status updated to ${status}`,
      order: result.rows[0],
    });
  } catch (err) {
    console.error('[ADMIN] Error updating device order status:', err);
    res.status(500).json({ error: 'Failed to update order status', message: err.message });
  }
};

// ============================================
// GEN CORE PRICE MANAGEMENT
// ============================================

/**
 * Get current GEN CORE unit price
 * GET /api/admin/gen-core-price
 */
module.exports.getGenCorePriceCtrl = async (req, res) => {
  try {
    const result = await query(
      `SELECT ps.*, u.email as updated_by_email
       FROM platform_settings ps
       LEFT JOIN users u ON ps.updated_by = u.id
       WHERE ps.key = 'gen_core_unit_price'`
    );

    if (result.rows.length === 0) {
      return res.json({ price: { amount: 0, currency: 'MYR' }, updatedBy: null, updatedAt: null });
    }

    const row = result.rows[0];
    res.json({
      price: row.value,
      updatedBy: row.updated_by_email || null,
      updatedAt: row.updated_at,
    });
  } catch (err) {
    console.error('[ADMIN] Error fetching GEN CORE price:', err);
    res.status(500).json({ error: 'Failed to fetch price', message: err.message });
  }
};

/**
 * Set GEN CORE unit price (Checker only)
 * PUT /api/admin/gen-core-price
 * Body: { amount, currency }
 */
module.exports.setGenCorePriceCtrl = async (req, res) => {
  try {
    const { amount, currency = 'MYR' } = req.body;
    const userId = req.user.id;

    if (amount == null || amount < 0) {
      return res.status(400).json({ error: 'Amount must be a non-negative number' });
    }

    await query(
      `INSERT INTO platform_settings (key, value, updated_by, updated_at)
       VALUES ('gen_core_unit_price', $1, $2, NOW())
       ON CONFLICT (key) DO UPDATE
       SET value = $1, updated_by = $2, updated_at = NOW()`,
      [JSON.stringify({ amount: parseFloat(amount), currency }), userId]
    );

    res.json({
      success: true,
      message: 'GEN CORE unit price updated',
      price: { amount: parseFloat(amount), currency },
    });
  } catch (err) {
    console.error('[ADMIN] Error setting GEN CORE price:', err);
    res.status(500).json({ error: 'Failed to update price', message: err.message });
  }
};

// ============================================
// METER LINK REQUESTS
// ============================================

/**
 * Create a meter link request (Maker or Checker)
 * POST /api/admin/meter-link-requests
 * Body: { meterId, siteId }
 */
module.exports.createMeterLinkRequestCtrl = async (req, res) => {
  try {
    const userId = req.user.id;
    const { meterId, siteId } = req.body;

    if (!meterId || !siteId) {
      return res.status(400).json({ error: 'Meter ID and Site ID are required' });
    }

    // Verify meter exists
    const meterResult = await query(`SELECT * FROM meters WHERE id = $1`, [meterId]);
    if (meterResult.rows.length === 0) {
      return res.status(404).json({ error: 'Meter not found' });
    }

    // Verify site exists
    const siteResult = await query(`SELECT * FROM sites WHERE id = $1`, [siteId]);
    if (siteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Site not found' });
    }

    // Check for existing pending request for this meter+site
    const existingResult = await query(
      `SELECT * FROM meter_link_requests WHERE meter_id = $1 AND site_id = $2 AND status = 'pending'`,
      [meterId, siteId]
    );
    if (existingResult.rows.length > 0) {
      return res.status(409).json({ error: 'A pending link request already exists for this meter and site' });
    }

    const result = await query(
      `INSERT INTO meter_link_requests (meter_id, site_id, requested_by)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [meterId, siteId, userId]
    );

    res.json({
      success: true,
      message: 'Meter link request created',
      request: result.rows[0],
    });
  } catch (err) {
    console.error('[ADMIN] Error creating meter link request:', err);
    res.status(500).json({ error: 'Failed to create link request', message: err.message });
  }
};

/**
 * Get all meter link requests (Checker only)
 * GET /api/admin/meter-link-requests?status=pending&limit=50&offset=0
 */
module.exports.getMeterLinkRequestsCtrl = async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;

    let whereClause = '';
    const params = [];

    if (status) {
      params.push(status);
      whereClause = `WHERE mlr.status = $${params.length}`;
    }

    params.push(parseInt(limit), parseInt(offset));

    const countResult = await query(
      `SELECT COUNT(*) FROM meter_link_requests mlr ${whereClause}`,
      status ? [status] : []
    );

    const result = await query(
      `SELECT mlr.*,
              m.meter_identifier, m.iot_pubkey,
              s.name as site_name, s.location as site_location,
              u.email as requested_by_email, u.wallet_address as requested_by_wallet,
              r.email as reviewed_by_email
       FROM meter_link_requests mlr
       JOIN meters m ON mlr.meter_id = m.id
       JOIN sites s ON mlr.site_id = s.id
       JOIN users u ON mlr.requested_by = u.id
       LEFT JOIN users r ON mlr.reviewed_by = r.id
       ${whereClause}
       ORDER BY mlr.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      requests: result.rows,
      total: parseInt(countResult.rows[0].count),
    });
  } catch (err) {
    console.error('[ADMIN] Error fetching meter link requests:', err);
    res.status(500).json({ error: 'Failed to fetch link requests', message: err.message });
  }
};

/**
 * Get maker's own meter link requests
 * GET /api/admin/my-meter-link-requests
 */
module.exports.getMyMeterLinkRequestsCtrl = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 50, offset = 0 } = req.query;

    const result = await query(
      `SELECT mlr.*,
              m.meter_identifier, m.iot_pubkey,
              s.name as site_name, s.location as site_location,
              r.email as reviewed_by_email
       FROM meter_link_requests mlr
       JOIN meters m ON mlr.meter_id = m.id
       JOIN sites s ON mlr.site_id = s.id
       LEFT JOIN users r ON mlr.reviewed_by = r.id
       WHERE mlr.requested_by = $1
       ORDER BY mlr.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, parseInt(limit), parseInt(offset)]
    );

    res.json({ requests: result.rows });
  } catch (err) {
    console.error('[ADMIN] Error fetching my meter link requests:', err);
    res.status(500).json({ error: 'Failed to fetch link requests', message: err.message });
  }
};

/**
 * Approve a meter link request (Checker only) — actually links the meter to the site
 * POST /api/admin/meter-link-requests/:id/approve
 */
module.exports.approveMeterLinkRequestCtrl = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const reviewerId = req.user.id;

    await client.query('BEGIN');

    // Get the request
    const reqResult = await client.query(
      `SELECT * FROM meter_link_requests WHERE id = $1 AND status = 'pending'`,
      [id]
    );

    if (reqResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Link request not found or already processed' });
    }

    const linkReq = reqResult.rows[0];

    // Actually link the meter to the site
    await client.query(
      `UPDATE meters SET site_id = $1 WHERE id = $2`,
      [linkReq.site_id, linkReq.meter_id]
    );

    // Mark request as approved
    await client.query(
      `UPDATE meter_link_requests
       SET status = 'approved', reviewed_by = $1, reviewed_at = NOW()
       WHERE id = $2`,
      [reviewerId, id]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Meter link request approved and meter linked to site',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[ADMIN] Error approving meter link request:', err);
    res.status(500).json({ error: 'Failed to approve link request', message: err.message });
  } finally {
    client.release();
  }
};

/**
 * Reject a meter link request (Checker only)
 * POST /api/admin/meter-link-requests/:id/reject
 * Body: { reason }
 */
module.exports.rejectMeterLinkRequestCtrl = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const reviewerId = req.user.id;

    if (!reason) {
      return res.status(400).json({ error: 'Rejection reason is required' });
    }

    const result = await query(
      `UPDATE meter_link_requests
       SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(), rejection_reason = $2
       WHERE id = $3 AND status = 'pending'
       RETURNING *`,
      [reviewerId, reason, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Link request not found or already processed' });
    }

    res.json({
      success: true,
      message: 'Meter link request rejected',
    });
  } catch (err) {
    console.error('[ADMIN] Error rejecting meter link request:', err);
    res.status(500).json({ error: 'Failed to reject link request', message: err.message });
  }
};
