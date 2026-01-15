const { query } = require('../../db');

/**
 * Create or update user profile
 * POST /api/users
 * Body: { email, walletAddress }
 */
module.exports.createOrUpdateUserCtrl = async (req, res) => {
  try {
    const { email, walletAddress } = req.body;

    if (!email || !walletAddress) {
      return res.status(400).json({ error: 'Email and wallet address are required' });
    }

    // Use UPSERT (INSERT ... ON CONFLICT DO UPDATE)
    // This handles both creation and updates atomically
    const user = await query(
      `INSERT INTO users (email, wallet_address, available_balance, created_at, updated_at)
       VALUES ($1, $2, 0.00, now(), now())
       ON CONFLICT (email) 
       DO UPDATE SET 
         wallet_address = EXCLUDED.wallet_address,
         updated_at = now()
       RETURNING *`,
      [email, walletAddress]
    );

    res.json({ 
      success: true, 
      user: user.rows[0],
      message: 'User profile saved'
    });
  } catch (err) {
    console.error('[USER] Error creating/updating user:', err);
    res.status(500).json({ error: 'Failed to create/update user', message: err.message });
  }
};

/**
 * Get user profile by wallet address
 * GET /api/users/:walletAddress
 */
module.exports.getUserProfileCtrl = async (req, res) => {
  try {
    const { walletAddress } = req.params;

    const result = await query(
      `SELECT * FROM users WHERE wallet_address = $1`,
      [walletAddress]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[USER] Error getting user profile:', err);
    res.status(500).json({ error: 'Failed to get user profile', message: err.message });
  }
};

/**
 * Get user portfolio summary
 * GET /api/users/:walletAddress/portfolio
 */
module.exports.getUserPortfolioCtrl = async (req, res) => {
  try {
    const { walletAddress } = req.params;

    // Get user
    const userResult = await query(
      `SELECT id, available_balance FROM users WHERE wallet_address = $1`,
      [walletAddress]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userId = userResult.rows[0].id;
    const availableBalance = parseFloat(userResult.rows[0].available_balance) || 0;

    // Get total holdings
    const holdingsResult = await query(
      `SELECT 
        COALESCE(SUM(amount_usd), 0) as total_holdings
       FROM user_investments
       WHERE user_id = $1`,
      [userId]
    );

    const totalHoldings = parseFloat(holdingsResult.rows[0].total_holdings) || 0;

    // Get accumulated yield
    const yieldResult = await query(
      `SELECT 
        COALESCE(SUM(yield_amount_usd), 0) as accumulated_yield
       FROM user_yield_history
       WHERE user_id = $1`,
      [userId]
    );

    const accumulatedYield = parseFloat(yieldResult.rows[0].accumulated_yield) || 0;

    // Calculate average APY
    const apyResult = await query(
      `SELECT 
        COALESCE(AVG(apy_rate), 0) as average_apy
       FROM user_yield_history
       WHERE user_id = $1 AND apy_rate IS NOT NULL`,
      [userId]
    );

    const averageYield = parseFloat(apyResult.rows[0].average_apy) || 0;

    res.json({
      availableBalance,
      totalHoldings,
      accumulatedYield,
      averageYield: Math.round(averageYield * 100) / 100, // Round to 2 decimals
    });
  } catch (err) {
    console.error('[USER] Error getting user portfolio:', err);
    res.status(500).json({ error: 'Failed to get user portfolio', message: err.message });
  }
};

/**
 * Get user holdings by asset
 * GET /api/users/:walletAddress/holdings
 */
module.exports.getUserHoldingsCtrl = async (req, res) => {
  try {
    const { walletAddress } = req.params;

    // Get user
    const userResult = await query(
      `SELECT id FROM users WHERE wallet_address = $1`,
      [walletAddress]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userId = userResult.rows[0].id;

    // Get holdings with asset details
    const holdingsResult = await query(
      `SELECT 
        ui.id,
        ui.asset_category,
        s.name as site_name,
        ui.amount_usd as holdings,
        ui.purchase_date,
        COALESCE(yh.total_yield, 0) as accumulated_yield,
        COALESCE(yh.avg_apy, 0) as realized_apy
       FROM user_investments ui
       LEFT JOIN sites s ON ui.site_id = s.id
       LEFT JOIN (
         SELECT 
           investment_id,
           SUM(yield_amount_usd) as total_yield,
           AVG(apy_rate) as avg_apy
         FROM user_yield_history
         GROUP BY investment_id
       ) yh ON yh.investment_id = ui.id
       WHERE ui.user_id = $1
       ORDER BY ui.amount_usd DESC`,
      [userId]
    );

    // Calculate total for ratios
    const total = holdingsResult.rows.reduce((sum, row) => sum + parseFloat(row.holdings || 0), 0);

    // Format response
    const holdings = holdingsResult.rows.map((row) => ({
      id: row.id,
      name: `GENX-${row.asset_category}`,
      category: row.asset_category,
      siteName: row.site_name,
      holdings: parseFloat(row.holdings) || 0,
      ratio: total > 0 ? Math.round((parseFloat(row.holdings) / total) * 100) : 0,
      realizedAPY: Math.round((parseFloat(row.realized_apy) || 0) * 100) / 100,
      accumulatedYield: Math.round((parseFloat(row.accumulated_yield) || 0) * 100) / 100,
      purchaseDate: row.purchase_date,
    }));

    res.json(holdings);
  } catch (err) {
    console.error('[USER] Error getting user holdings:', err);
    res.status(500).json({ error: 'Failed to get user holdings', message: err.message });
  }
};

/**
 * Get user transaction history
 * GET /api/users/:walletAddress/transactions
 */
module.exports.getUserTransactionsCtrl = async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    // Get user
    const userResult = await query(
      `SELECT id FROM users WHERE wallet_address = $1`,
      [walletAddress]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userId = userResult.rows[0].id;

    // Get transactions
    const transactionsResult = await query(
      `SELECT 
        id,
        transaction_type as type,
        asset_category,
        amount_usd as amount,
        status,
        tx_hash,
        notes,
        created_at as date
       FROM user_transactions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    // Format transactions
    const transactions = transactionsResult.rows.map((row) => ({
      id: row.id,
      date: row.date,
      type: row.type,
      amount: parseFloat(row.amount),
      asset: row.asset_category ? `GENX-${row.asset_category}` : 'USD',
      status: row.status,
      tx: row.tx_hash || null,
      notes: row.notes,
    }));

    res.json(transactions);
  } catch (err) {
    console.error('[USER] Error getting user transactions:', err);
    res.status(500).json({ error: 'Failed to get user transactions', message: err.message });
  }
};

/**
 * Get user yield history over time
 * GET /api/users/:walletAddress/yield-history
 */
module.exports.getUserYieldHistoryCtrl = async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const months = parseInt(req.query.months) || 12;

    // Get user
    const userResult = await query(
      `SELECT id FROM users WHERE wallet_address = $1`,
      [walletAddress]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userId = userResult.rows[0].id;

    // Get yield history grouped by month
    const yieldResult = await query(
      `SELECT 
        DATE_TRUNC('month', calculated_at) as month,
        SUM(yield_amount_usd) as yield_amount,
        AVG(apy_rate) as avg_apy
       FROM user_yield_history
       WHERE user_id = $1
         AND calculated_at >= NOW() - INTERVAL '${months} months'
       GROUP BY DATE_TRUNC('month', calculated_at)
       ORDER BY month ASC`,
      [userId]
    );

    const yieldHistory = yieldResult.rows.map((row) => ({
      month: row.month,
      yield: Math.round(parseFloat(row.yield_amount) * 100) / 100,
      apy: Math.round(parseFloat(row.avg_apy) * 100) / 100,
    }));

    res.json(yieldHistory);
  } catch (err) {
    console.error('[USER] Error getting yield history:', err);
    res.status(500).json({ error: 'Failed to get yield history', message: err.message });
  }
};

/**
 * Record investment transaction
 * POST /api/users/:walletAddress/investments
 * Body: { category, amountUsd, tokenAmount, txHash }
 */
module.exports.recordInvestmentCtrl = async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const { category, amountUsd, tokenAmount, txHash } = req.body;

    if (!category || !amountUsd || !txHash) {
      return res.status(400).json({ 
        error: 'Category, amountUsd, and txHash are required' 
      });
    }

    // Get or create user
    let user = await query(
      `SELECT id FROM users WHERE wallet_address = $1`,
      [walletAddress]
    );

    if (user.rows.length === 0) {
      // Create user if doesn't exist
      user = await query(
        `INSERT INTO users (wallet_address, email, kyc_status)
         VALUES ($1, $2, 'unverified')
         RETURNING id`,
        [walletAddress, `${walletAddress.substring(0, 8)}@temp.com`]
      );
    }

    const userId = user.rows[0].id;

    // Get site_id for the category (assuming first site of category)
    const siteResult = await query(
      `SELECT id FROM sites WHERE category = $1 LIMIT 1`,
      [category]
    );

    const siteId = siteResult.rows.length > 0 ? siteResult.rows[0].id : null;

    // Start transaction
    await query('BEGIN');

    try {
      // 1. Insert transaction record
      await query(
        `INSERT INTO user_transactions 
         (user_id, transaction_type, asset_category, amount_usd, status, tx_hash)
         VALUES ($1, 'BUY', $2, $3, 'COMPLETED', $4)`,
        [userId, category, amountUsd, txHash]
      );

      // 2. Update or insert user_investments
      if (siteId) {
        await query(
          `INSERT INTO user_investments 
           (user_id, asset_category, site_id, amount_usd, token_amount)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (user_id, site_id) 
           DO UPDATE SET 
             amount_usd = user_investments.amount_usd + $4,
             token_amount = COALESCE(user_investments.token_amount, 0) + $5`,
          [userId, category, siteId, amountUsd, tokenAmount || amountUsd]
        );
      } else {
        // If no site found, create a generic investment record
        await query(
          `INSERT INTO user_investments 
           (user_id, asset_category, amount_usd, token_amount)
           VALUES ($1, $2, $3, $4)`,
          [userId, category, amountUsd, tokenAmount || amountUsd]
        );
      }

      await query('COMMIT');

      res.json({ 
        success: true, 
        message: 'Investment recorded successfully',
        txHash 
      });
    } catch (err) {
      await query('ROLLBACK');
      throw err;
    }
  } catch (err) {
    console.error('[USER] Error recording investment:', err);
    res.status(500).json({ 
      error: 'Failed to record investment', 
      message: err.message 
    });
  }
};
