const express = require('express');
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
} = require('../components/controller/user.controller');
const {
  checkAndMintUSDCCtrl,
  getUSDCBalanceCtrl,
} = require('../components/controller/usdc.controller');

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

// Node registration
coreRouter.post('/node/register', 
    (...args) => registerNodeCtrl(...args)
)

module.exports = coreRouter;