const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { registerNodeCtrl } = require('../components/controller/node.controller');
const { receiveHourlyTelemetryCtrl } = require('../components/controller/telemetry.controller');
const { runMigrationCtrl, databaseHealthCtrl } = require('../components/controller/core.controller');
const {
  getLocationsCtrl,
  getAllLocationsMetricsCtrl,
  getLocationMetricsCtrl,
  getPowerDataCtrl,
  getNetFlowCtrl,
  getDailyEnergyCtrl,
  getEfficiencyCtrl,
  getNetworkStatsCtrl,
  getNetworkGrowthCtrl,
  getInvestmentCategoriesCtrl,
  getInvestmentAssetsByCategoryCtrl,
  getInvestmentAssetDetailsCtrl,
} = require('../components/controller/api.controller');
const {
  createOrUpdateUserCtrl,
  getUserProfileCtrl,
  getUserPortfolioCtrl,
  getUserHoldingsCtrl,
  getUserTransactionsCtrl,
  getUserYieldHistoryCtrl,
  getAssetActivityCtrl,
  recordInvestmentCtrl,
  submitDepositRequestCtrl,
  getDepositRequestsCtrl: getUserDepositRequestsCtrl,
} = require('../components/controller/user.controller');
const {
  checkAndMintUSDCCtrl,
  getUSDCBalanceCtrl,
} = require('../components/controller/usdc.controller');
const {
  getDepositRequestsCtrl,
  approveDepositRequestCtrl,
  rejectDepositRequestCtrl,
  getAssetRequestsCtrl,
  getAllAssetsCtrl,
  createAssetRequestCtrl,
  createAssetCtrl,
  approveAssetCtrl,
  rejectAssetCtrl,
  updateAssetStatusCtrl,
  updateAssetVisibilityCtrl,
  getMyAssetRequestsCtrl,
  getAllUsersCtrl,
  updateUserTypeCtrl,
  adjustUserBalanceCtrl,
  getAdminStatsCtrl,
  getBankDetailsCtrl,
} = require('../components/controller/admin.controller');
const {
  requireChecker,
  requireMakerOrChecker,
} = require('../middleware/auth.middleware');

// Setup multer for file uploads
const UPLOADS_DIR = process.env.UPLOAD_DIR || './uploads/receipts';
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Only image files (jpeg, jpg, png, gif) and PDF are allowed'));
  }
});

const coreRouter = express.Router();

// Health check endpoints
coreRouter.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Central Node API is running' });
});
coreRouter.get('/api/health/database', databaseHealthCtrl);

// Migration endpoint (for development/admin use)
coreRouter.post('/api/admin/migrate/:migrationNumber', runMigrationCtrl);

// Telemetry endpoints
coreRouter.post('/api/telemetry/hourly', receiveHourlyTelemetryCtrl);

// Frontend API endpoints
coreRouter.get('/api/locations', getLocationsCtrl);
coreRouter.get('/api/locations/metrics', getAllLocationsMetricsCtrl);
coreRouter.get('/api/locations/:locationId/metrics', getLocationMetricsCtrl);
coreRouter.get('/api/locations/:locationId/power', getPowerDataCtrl);
coreRouter.get('/api/locations/:locationId/net-flow', getNetFlowCtrl);
coreRouter.get('/api/locations/:locationId/daily', getDailyEnergyCtrl);
coreRouter.get('/api/locations/:locationId/efficiency', getEfficiencyCtrl);

// Network-wide statistics endpoints
coreRouter.get('/api/network/stats', getNetworkStatsCtrl);
coreRouter.get('/api/network/growth', getNetworkGrowthCtrl);

// Investment API endpoints
coreRouter.get('/api/invest/categories', getInvestmentCategoriesCtrl);
coreRouter.get('/api/invest/categories/:category/assets', getInvestmentAssetsByCategoryCtrl);
coreRouter.get('/api/invest/assets/:assetId', getInvestmentAssetDetailsCtrl);

// User/Profile API endpoints
coreRouter.post('/api/users', createOrUpdateUserCtrl);
coreRouter.get('/api/users/:walletAddress', getUserProfileCtrl);
coreRouter.get('/api/users/:walletAddress/portfolio', getUserPortfolioCtrl);
coreRouter.get('/api/users/:walletAddress/holdings', getUserHoldingsCtrl);
coreRouter.get('/api/users/:walletAddress/transactions', getUserTransactionsCtrl);
coreRouter.get('/api/users/:walletAddress/yield-history', getUserYieldHistoryCtrl);
coreRouter.get('/api/users/:walletAddress/asset-activity/:assetSymbol', getAssetActivityCtrl);
coreRouter.post('/api/users/:walletAddress/investments', recordInvestmentCtrl);

// USDC endpoints
coreRouter.post('/api/usdc/:walletAddress/check-and-mint', checkAndMintUSDCCtrl);
coreRouter.get('/api/usdc/:walletAddress/balance', getUSDCBalanceCtrl);

// User deposit request endpoints
coreRouter.post('/api/users/:walletAddress/deposit-request', upload.single('receipt'), submitDepositRequestCtrl);
coreRouter.get('/api/users/:walletAddress/deposit-requests', getUserDepositRequestsCtrl);

// Bank details (public - shows GEN bank account info for deposits)
coreRouter.get('/api/bank-details', getBankDetailsCtrl);

// ============================================
// ADMIN ROUTES
// ============================================

// Admin dashboard stats (Checker only)
coreRouter.get('/api/admin/stats', requireChecker, getAdminStatsCtrl);

// Deposit request management (Checker only)
coreRouter.get('/api/admin/deposit-requests', requireChecker, getDepositRequestsCtrl);
coreRouter.post('/api/admin/deposit-requests/:id/approve', requireChecker, approveDepositRequestCtrl);
coreRouter.post('/api/admin/deposit-requests/:id/reject', requireChecker, rejectDepositRequestCtrl);

// Asset request management (Checker only)
coreRouter.get('/api/admin/asset-requests', requireChecker, getAssetRequestsCtrl);
coreRouter.post('/api/admin/assets/:siteId/approve', requireChecker, approveAssetCtrl);
coreRouter.post('/api/admin/assets/:siteId/reject', requireChecker, rejectAssetCtrl);

// Asset management (Checker only)
coreRouter.get('/api/admin/assets', requireChecker, getAllAssetsCtrl);
coreRouter.post('/api/admin/assets', requireChecker, createAssetCtrl);
coreRouter.put('/api/admin/assets/:siteId/status', requireChecker, updateAssetStatusCtrl);
coreRouter.put('/api/admin/assets/:siteId/visibility', requireChecker, updateAssetVisibilityCtrl);

// Asset request creation (Maker or Checker)
coreRouter.post('/api/admin/assets/request', requireMakerOrChecker, createAssetRequestCtrl);
coreRouter.get('/api/admin/my-requests', requireMakerOrChecker, getMyAssetRequestsCtrl);

// User management (Checker only)
coreRouter.get('/api/admin/users', requireChecker, getAllUsersCtrl);
coreRouter.put('/api/admin/users/:userId/type', requireChecker, updateUserTypeCtrl);
coreRouter.post('/api/admin/users/:userId/balance', requireChecker, adjustUserBalanceCtrl);

// Node registration
coreRouter.post('/node/register', 
    (...args) => registerNodeCtrl(...args)
)

module.exports = coreRouter;