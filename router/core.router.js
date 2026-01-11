const express = require('express');
const { registerNodeCtrl } = require('../components/controller/node.controller');
const { receiveHourlyTelemetryCtrl } = require('../components/controller/telemetry.controller');
const {
  getLocationsCtrl,
  getLocationMetricsCtrl,
  getPowerDataCtrl,
  getNetFlowCtrl,
  getDailyEnergyCtrl,
  getEfficiencyCtrl,
  getNetworkStatsCtrl,
  getNetworkGrowthCtrl,
} = require('../components/controller/api.controller');

const coreRouter = express.Router();

// Health check endpoint
coreRouter.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Central Node API is running' });
});

// Telemetry endpoints
coreRouter.post('/api/telemetry/hourly', receiveHourlyTelemetryCtrl);

// Frontend API endpoints
coreRouter.get('/api/locations', getLocationsCtrl);
coreRouter.get('/api/locations/:locationId/metrics', getLocationMetricsCtrl);
coreRouter.get('/api/locations/:locationId/power', getPowerDataCtrl);
coreRouter.get('/api/locations/:locationId/net-flow', getNetFlowCtrl);
coreRouter.get('/api/locations/:locationId/daily', getDailyEnergyCtrl);
coreRouter.get('/api/locations/:locationId/efficiency', getEfficiencyCtrl);

// Network-wide statistics endpoints
coreRouter.get('/api/network/stats', getNetworkStatsCtrl);
coreRouter.get('/api/network/growth', getNetworkGrowthCtrl);

// Node registration
coreRouter.post('/node/register', 
    (...args) => registerNodeCtrl(...args)
)

module.exports = coreRouter;