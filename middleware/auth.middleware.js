const { query } = require('../db');

/**
 * Get user by wallet address
 * @param {string} walletAddress - User's wallet address
 * @returns {Promise<Object|null>} User object or null
 */
async function getUserByWallet(walletAddress) {
  try {
    const result = await query(
      `SELECT id, email, wallet_address, user_type, kyc_status 
       FROM users WHERE wallet_address = $1`,
      [walletAddress]
    );
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (err) {
    console.error('[AUTH] Error getting user by wallet:', err);
    return null;
  }
}

/**
 * Middleware factory to require specific user types
 * Reads wallet address from x-wallet-address header
 * @param {...string} allowedTypes - User types allowed to access the route
 * @returns {Function} Express middleware function
 */
const requireUserType = (...allowedTypes) => async (req, res, next) => {
  try {
    const walletAddress = req.headers['x-wallet-address'];

    if (!walletAddress) {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'Wallet address header is required' 
      });
    }

    const user = await getUserByWallet(walletAddress);

    if (!user) {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'User not found' 
      });
    }

    if (!allowedTypes.includes(user.user_type)) {
      return res.status(403).json({ 
        error: 'Forbidden', 
        message: `Access denied. Required role: ${allowedTypes.join(' or ')}` 
      });
    }

    // Attach user to request for downstream handlers
    req.user = user;
    next();
  } catch (err) {
    console.error('[AUTH] Middleware error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Middleware to optionally attach user if wallet address is provided
 * Does not block request if no wallet address
 */
const optionalAuth = async (req, res, next) => {
  try {
    const walletAddress = req.headers['x-wallet-address'];

    if (walletAddress) {
      const user = await getUserByWallet(walletAddress);
      if (user) {
        req.user = user;
      }
    }

    next();
  } catch (err) {
    console.error('[AUTH] Optional auth error:', err);
    next(); // Continue anyway for optional auth
  }
};

/**
 * Middleware to require checker role
 */
const requireChecker = requireUserType('checker');

/**
 * Middleware to require maker or checker role
 */
const requireMakerOrChecker = requireUserType('maker', 'checker');

module.exports = {
  getUserByWallet,
  requireUserType,
  optionalAuth,
  requireChecker,
  requireMakerOrChecker,
};
