const { query, pool } = require('../../db');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

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
      // Extended fields
      description, imageUrl, imageUrls, assetType, portfolioToken, tokenPrice,
      revenueModel, estimatedAnnualIncome, contractTerm, contractDueDate,
      installationType, technologyType, numPanels, peakPowerKw, 
      peakSunHours, expectedAnnualOutput,
      tariffRate, tariffCurrency, tariffEscalation,
      yieldInvestorPct, yieldMaintenancePct, yieldPlatformPct, yieldTreasuryPct,
      showInInvest, showInConsole
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

    // If maker is checker, create as active; otherwise pending
    const status = req.user.user_type === 'checker' ? 'active' : 'pending';
    const siteId = uuidv4();

    const result = await query(
      `INSERT INTO sites 
       (id, name, location, timezone, category, sites_valuation, organization_id, status, created_by, created_at,
        description, image_url, image_urls, asset_type, portfolio_token, token_price,
        revenue_model, estimated_annual_income, contract_term, contract_due_date,
        installation_type, technology_type, num_panels, peak_power_kw, peak_sun_hours, expected_annual_output,
        tariff_rate, tariff_currency, tariff_escalation,
        yield_investor_pct, yield_maintenance_pct, yield_platform_pct, yield_treasury_pct,
        show_in_invest, show_in_console)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(),
        $10, $11, $12::jsonb, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34)
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
        showInInvest !== false, showInConsole === true
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
      // Extended fields
      description, imageUrl, imageUrls, assetType, portfolioToken, tokenPrice,
      revenueModel, estimatedAnnualIncome, contractTerm, contractDueDate,
      installationType, technologyType, numPanels, peakPowerKw, 
      peakSunHours, expectedAnnualOutput,
      tariffRate, tariffCurrency, tariffEscalation,
      yieldInvestorPct, yieldMaintenancePct, yieldPlatformPct, yieldTreasuryPct,
      showInInvest, showInConsole
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

    const result = await query(
      `INSERT INTO sites 
       (id, name, location, timezone, category, sites_valuation, organization_id, status, created_by, created_at,
        description, image_url, image_urls, asset_type, portfolio_token, token_price,
        revenue_model, estimated_annual_income, contract_term, contract_due_date,
        installation_type, technology_type, num_panels, peak_power_kw, peak_sun_hours, expected_annual_output,
        tariff_rate, tariff_currency, tariff_escalation,
        yield_investor_pct, yield_maintenance_pct, yield_platform_pct, yield_treasury_pct,
        show_in_invest, show_in_console)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, NOW(),
        $9, $10, $11::jsonb, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33)
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
        showInInvest !== false, showInConsole === true
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
       SET status = 'active'
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [siteId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Asset not found or already processed' });
    }

    res.json({ 
      success: true, 
      message: 'Asset approved and now active',
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

    res.json({
      meters: result.rows,
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
    ] = await Promise.all([
      query(`SELECT COUNT(*) as count FROM deposit_requests WHERE status = 'pending'`),
      query(`SELECT COUNT(*) as count FROM sites WHERE status = 'pending'`),
      query(`SELECT COUNT(*) as count FROM users`),
      query(`SELECT COUNT(*) as count FROM sites WHERE status = 'active'`),
    ]);

    res.json({
      pendingDeposits: parseInt(pendingDeposits.rows[0].count),
      pendingAssets: parseInt(pendingAssets.rows[0].count),
      totalUsers: parseInt(totalUsers.rows[0].count),
      activeAssets: parseInt(activeAssets.rows[0].count),
    });
  } catch (err) {
    console.error('[ADMIN] Error getting stats:', err);
    res.status(500).json({ error: 'Failed to get stats', message: err.message });
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
