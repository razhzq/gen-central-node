const { query } = require('../../db');

/**
 * Get all locations with their meters
 */
module.exports.getLocationsCtrl = async (req, res) => {
  try {
    const result = await query(
      `SELECT 
        s.id as site_id,
        s.name as site_name,
        s.location,
        m.id as meter_id,
        m.meter_identifier,
        m.iot_pubkey,
        m.active,
        COUNT(DISTINCT tb.id) as batch_count
      FROM sites s
      LEFT JOIN meters m ON s.id = m.site_id AND m.active = true
      LEFT JOIN telemetry_batches tb ON m.id = tb.meter_id
      GROUP BY s.id, s.name, s.location, m.id, m.meter_identifier, m.iot_pubkey, m.active
      ORDER BY s.name, m.meter_identifier`
    );

    // Group by site
    const locationsMap = {};
    result.rows.forEach((row) => {
      if (!locationsMap[row.site_id]) {
        locationsMap[row.site_id] = {
          id: row.site_id,
          name: row.site_name,
          location: row.location,
          meters: [],
        };
      }
      if (row.meter_id) {
        locationsMap[row.site_id].meters.push({
          id: row.meter_id,
          meter_identifier: row.meter_identifier,
          iot_pubkey: row.iot_pubkey,
          active: row.active,
          batch_count: parseInt(row.batch_count) || 0,
        });
      }
    });

    const locations = Object.values(locationsMap);
    res.json(locations);
  } catch (err) {
    console.error('[API] Error getting locations:', err);
    res.status(500).json({ error: 'Failed to fetch locations', message: err.message });
  }
};

/**
 * Get all locations with their metrics (peak power, total energy, devices, IoT pubkey)
 */
module.exports.getAllLocationsMetricsCtrl = async (req, res) => {
  try {
    // Get all sites with their active meters, including category and organization
    const sitesRes = await query(
      `SELECT 
        s.id,
        s.name,
        s.location,
        s.category,
        o.name as organization_name,
        m.id as meter_id,
        m.iot_pubkey
       FROM sites s
       LEFT JOIN organizations o ON s.organization_id = o.id
       LEFT JOIN meters m ON s.id = m.site_id AND m.active = true
       ORDER BY s.name, m.id`
    );

    // Group by site and collect meter IDs and IoT pubkeys
    const sitesMap = {};
    sitesRes.rows.forEach((row) => {
      if (!sitesMap[row.id]) {
        sitesMap[row.id] = {
          site_id: row.id,
          site_name: row.name,
          location: row.location,
          category: row.category,
          organization_name: row.organization_name,
          meter_ids: [],
          iot_pubkey: null, // Will use first active meter's pubkey
        };
      }
      if (row.meter_id) {
        sitesMap[row.id].meter_ids.push(row.meter_id);
        // Use first active meter's IoT pubkey (1 site = 1 pubkey)
        if (!sitesMap[row.id].iot_pubkey && row.iot_pubkey) {
          sitesMap[row.id].iot_pubkey = row.iot_pubkey;
        }
      }
    });

    const sites = Object.values(sitesMap);
    const results = [];

    // Get metrics for each site
    for (const site of sites) {
      if (site.meter_ids.length === 0) {
        results.push({
          site_id: site.site_id,
          site_name: site.site_name,
          location: site.location,
          category: site.category,
          organization_name: site.organization_name,
          peak_power_kw: 0,
          total_energy_kwh: 0,
          devices: 0,
          iot_pubkey: site.iot_pubkey,
        });
        continue;
      }

      // Get peak power (max power_total_w from latest batches)
      const peakPowerRes = await query(
        `SELECT MAX(tr.power_total_w) as peak_power_w
         FROM telemetry_raw tr
         JOIN telemetry_batches tb ON tr.batch_id = tb.id
         WHERE tb.meter_id = ANY($1::uuid[])
         AND tb.status = 'VALIDATED'`,
        [site.meter_ids]
      );

      // Get total energy (latest energy_total_wh)
      const totalEnergyRes = await query(
        `SELECT tr.energy_total_wh
         FROM telemetry_raw tr
         JOIN telemetry_batches tb ON tr.batch_id = tb.id
         WHERE tb.meter_id = ANY($1::uuid[])
         ORDER BY tb.interval_end DESC
         LIMIT 1`,
        [site.meter_ids]
      );

      const peakPowerKw = (peakPowerRes.rows[0]?.peak_power_w || 0) / 1000;
      const totalEnergyKwh = (totalEnergyRes.rows[0]?.energy_total_wh || 0) / 1000;

      results.push({
        site_id: site.site_id,
        site_name: site.site_name,
        location: site.location,
        category: site.category,
        organization_name: site.organization_name,
        peak_power_kw: parseFloat(peakPowerKw.toFixed(2)),
        total_energy_kwh: parseFloat(totalEnergyKwh.toFixed(2)),
        devices: site.meter_ids.length,
        iot_pubkey: site.iot_pubkey,
      });
    }

    res.json(results);
  } catch (err) {
    console.error('[API] Error getting all locations metrics:', err);
    res.status(500).json({ error: 'Failed to fetch all locations metrics', message: err.message });
  }
};

/**
 * Get location metrics (peak power, total energy, devices)
 */
module.exports.getLocationMetricsCtrl = async (req, res) => {
  try {
    const { locationId } = req.params;

    // Get site info with category and organization
    const siteRes = await query(
      `SELECT s.id, s.name, s.location, s.category, o.name AS organization_name
       FROM sites s
       LEFT JOIN organizations o ON s.organization_id = o.id
       WHERE s.id = $1`,
      [locationId]
    );
    if (siteRes.rowCount === 0) {
      return res.status(404).json({ error: 'Location not found' });
    }

    const site = siteRes.rows[0];

    // Get meters for this site
    const metersRes = await query(
      'SELECT id, meter_identifier FROM meters WHERE site_id = $1 AND active = true',
      [locationId]
    );

    const meterIds = metersRes.rows.map((m) => m.id);
    if (meterIds.length === 0) {
      return res.json({
        site_id: site.id,
        site_name: site.name,
        location: site.location,
        category: site.category,
        organization_name: site.organization_name,
        peak_power_kw: 0,
        total_energy_kwh: 0,
        devices: 0,
      });
    }

    // Get peak power (max power_total_w from latest batches)
    const peakPowerRes = await query(
      `SELECT MAX(tr.power_total_w) as peak_power_w
       FROM telemetry_raw tr
       JOIN telemetry_batches tb ON tr.batch_id = tb.id
       WHERE tb.meter_id = ANY($1::uuid[])
       AND tb.status = 'VALIDATED'`,
      [meterIds]
    );

    // Get total energy (latest energy_total_wh)
    const totalEnergyRes = await query(
      `SELECT tr.energy_total_wh
       FROM telemetry_raw tr
       JOIN telemetry_batches tb ON tr.batch_id = tb.id
       WHERE tb.meter_id = ANY($1::uuid[])
       ORDER BY tb.interval_end DESC
       LIMIT 1`,
      [meterIds]
    );

    const peakPowerKw = (peakPowerRes.rows[0]?.peak_power_w || 0) / 1000;
    const totalEnergyKwh = (totalEnergyRes.rows[0]?.energy_total_wh || 0) / 1000;

    res.json({
      site_id: site.id,
      site_name: site.name,
      location: site.location,
      category: site.category,
      organization_name: site.organization_name,
      peak_power_kw: parseFloat(peakPowerKw.toFixed(2)),
      total_energy_kwh: parseFloat(totalEnergyKwh.toFixed(2)),
      devices: meterIds.length,
    });
  } catch (err) {
    console.error('[API] Error getting location metrics:', err);
    res.status(500).json({ error: 'Failed to fetch location metrics', message: err.message });
  }
};

/**
 * Get real-time power data for a location
 */
module.exports.getPowerDataCtrl = async (req, res) => {
  try {
    const { locationId } = req.params;
    const { interval = '15min', hours = 8 } = req.query;

    // Get meters for this site
    const metersRes = await query(
      'SELECT id FROM meters WHERE site_id = $1 AND active = true',
      [locationId]
    );

    const meterIds = metersRes.rows.map((m) => m.id);
    if (meterIds.length === 0) {
      return res.json([]);
    }

    // Calculate time range based on interval
    const hoursBack = parseInt(hours) || 8;
    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - hoursBack);

    const result = await query(
      `SELECT 
        tb.interval_start as timestamp,
        tr.power_total_w / 1000.0 as power_kw
       FROM telemetry_raw tr
       JOIN telemetry_batches tb ON tr.batch_id = tb.id
       WHERE tb.meter_id = ANY($1::uuid[])
       AND tb.interval_start >= $2
       AND tb.status = 'VALIDATED'
       ORDER BY tb.interval_start ASC`,
      [meterIds, cutoffTime]
    );

    const data = result.rows.map((row) => ({
      timestamp: row.timestamp.toISOString(),
      powerKw: parseFloat(row.power_kw),
    }));

    res.json(data);
  } catch (err) {
    console.error('[API] Error getting power data:', err);
    res.status(500).json({ error: 'Failed to fetch power data', message: err.message });
  }
};

/**
 * Get net energy flow for a location
 */
module.exports.getNetFlowCtrl = async (req, res) => {
  try {
    const { locationId } = req.params;

    // Get meters for this site
    const metersRes = await query(
      'SELECT id FROM meters WHERE site_id = $1 AND active = true',
      [locationId]
    );

    const meterIds = metersRes.rows.map((m) => m.id);
    if (meterIds.length === 0) {
      return res.json({
        netPowerKw: 0,
        direction: 'import',
        timestamp: new Date().toISOString(),
      });
    }

    // Get latest batch data
    const result = await query(
      `SELECT 
        tr.energy_imp_l1_wh + tr.energy_imp_l2_wh + tr.energy_imp_l3_wh as energy_imp_wh,
        tr.energy_exp_l1_wh + tr.energy_exp_l2_wh + tr.energy_exp_l3_wh as energy_exp_wh,
        tr.power_total_w,
        tb.interval_end as timestamp
       FROM telemetry_raw tr
       JOIN telemetry_batches tb ON tr.batch_id = tb.id
       WHERE tb.meter_id = ANY($1::uuid[])
       AND tb.status = 'VALIDATED'
       ORDER BY tb.interval_end DESC
       LIMIT 1`,
      [meterIds]
    );

    if (result.rows.length === 0) {
      return res.json({
        netPowerKw: 0,
        direction: 'import',
        timestamp: new Date().toISOString(),
      });
    }

    const row = result.rows[0];
    const netEnergyWh = (row.energy_exp_wh || 0) - (row.energy_imp_wh || 0);
    const netPowerKw = (row.power_total_w || 0) / 1000;
    const direction = netPowerKw > 0 ? 'export' : 'import';

    res.json({
      netPowerKw: parseFloat(Math.abs(netPowerKw).toFixed(2)),
      direction,
      timestamp: row.timestamp.toISOString(),
    });
  } catch (err) {
    console.error('[API] Error getting net flow:', err);
    res.status(500).json({ error: 'Failed to fetch net flow', message: err.message });
  }
};

/**
 * Get daily energy generation vs consumption
 */
module.exports.getDailyEnergyCtrl = async (req, res) => {
  try {
    const { locationId } = req.params;
    const { days = 7 } = req.query;

    // Get meters for this site
    const metersRes = await query(
      'SELECT id FROM meters WHERE site_id = $1 AND active = true',
      [locationId]
    );

    const meterIds = metersRes.rows.map((m) => m.id);
    if (meterIds.length === 0) {
      return res.json([]);
    }

    const daysBack = parseInt(days) || 7;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);
    cutoffDate.setHours(0, 0, 0, 0);

    // Get daily aggregated data
    // Note: energy_imp and energy_exp are cumulative meter readings
    // We need to calculate the delta (max - min) for each day
    const result = await query(
      `SELECT 
        DATE(tb.interval_start) as date,
        (MAX(tr.energy_exp_l1_wh + tr.energy_exp_l2_wh + tr.energy_exp_l3_wh) - 
         MIN(tr.energy_exp_l1_wh + tr.energy_exp_l2_wh + tr.energy_exp_l3_wh)) / 1000.0 as generation_kwh,
        (MAX(tr.energy_imp_l1_wh + tr.energy_imp_l2_wh + tr.energy_imp_l3_wh) - 
         MIN(tr.energy_imp_l1_wh + tr.energy_imp_l2_wh + tr.energy_imp_l3_wh)) / 1000.0 as consumption_kwh
       FROM telemetry_raw tr
       JOIN telemetry_batches tb ON tr.batch_id = tb.id
       WHERE tb.meter_id = ANY($1::uuid[])
       AND tb.interval_start >= $2
       AND tb.status = 'VALIDATED'
       GROUP BY DATE(tb.interval_start)
       ORDER BY DATE(tb.interval_start) ASC`,
      [meterIds, cutoffDate]
    );

    const data = result.rows.map((row) => ({
      date: row.date.toISOString().split('T')[0],
      generationKwh: parseFloat(row.generation_kwh || 0),
      consumptionKwh: parseFloat(row.consumption_kwh || 0),
    }));

    res.json(data);
  } catch (err) {
    console.error('[API] Error getting daily energy:', err);
    res.status(500).json({ error: 'Failed to fetch daily energy', message: err.message });
  }
};

/**
 * Get efficiency/performance ratio
 */
module.exports.getEfficiencyCtrl = async (req, res) => {
  try {
    const { locationId } = req.params;
    const { period = 'YTD' } = req.query;

    // Get meters for this site
    const metersRes = await query(
      'SELECT id FROM meters WHERE site_id = $1 AND active = true',
      [locationId]
    );

    const meterIds = metersRes.rows.map((m) => m.id);
    if (meterIds.length === 0) {
      return res.json({
        performanceRatio: 0,
        period: 'YTD',
        timestamp: new Date().toISOString(),
      });
    }

    // Calculate period dates
    const now = new Date();
    let periodStart;
    if (period === 'YTD') {
      periodStart = new Date(now.getFullYear(), 0, 1);
    } else if (period === 'MTD') {
      periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    } else {
      periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // WTD
    }

    // Get actual vs theoretical (simplified calculation)
    // In production, this would use actual capacity data
    const result = await query(
      `SELECT 
        SUM(tr.energy_exp_l1_wh + tr.energy_exp_l2_wh + tr.energy_exp_l3_wh) / 1000.0 as actual_kwh,
        COUNT(*) * 12.4 as theoretical_kwh
       FROM telemetry_raw tr
       JOIN telemetry_batches tb ON tr.batch_id = tb.id
       WHERE tb.meter_id = ANY($1::uuid[])
       AND tb.interval_start >= $2
       AND tb.status = 'VALIDATED'`,
      [meterIds, periodStart]
    );

    const actualKwh = result.rows[0]?.actual_kwh || 0;
    const theoreticalKwh = result.rows[0]?.theoretical_kwh || 1;
    const performanceRatio = (actualKwh / theoreticalKwh) * 100;

    res.json({
      performanceRatio: parseFloat(Math.min(100, Math.max(0, performanceRatio)).toFixed(1)),
      period,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[API] Error getting efficiency:', err);
    res.status(500).json({ error: 'Failed to fetch efficiency', message: err.message });
  }
};

/**
 * Get network-wide statistics (all sites combined)
 */
module.exports.getNetworkStatsCtrl = async (req, res) => {
  try {
    // Malaysia Peninsular grid emission factor (kg CO2 per kWh)
    const EMISSION_FACTOR = 0.71;

    // Get peak power across all meters
    const peakPowerRes = await query(
      `SELECT MAX(tr.power_total_w) / 1000.0 as peak_power_kw
       FROM telemetry_raw tr
       JOIN telemetry_batches tb ON tr.batch_id = tb.id
       WHERE tb.status = 'VALIDATED'`
    );

    // Get total energy generated (exported) across all meters
    const totalEnergyRes = await query(
      `SELECT 
        SUM(tr.energy_exp_l1_wh + tr.energy_exp_l2_wh + tr.energy_exp_l3_wh) / 1000.0 as total_energy_kwh
       FROM telemetry_raw tr
       JOIN telemetry_batches tb ON tr.batch_id = tb.id
       WHERE tb.status = 'VALIDATED'`
    );

    // Get active sites count
    const activeSitesRes = await query(
      `SELECT COUNT(DISTINCT s.id) as active_sites
       FROM sites s
       JOIN meters m ON s.id = m.site_id
       WHERE m.active = true`
    );

    // Get active meters count
    const activeMetersRes = await query(
      `SELECT COUNT(*) as active_meters
       FROM meters
       WHERE active = true`
    );

    // Get total validated data points
    const dataPointsRes = await query(
      `SELECT COUNT(*) as data_points
       FROM telemetry_batches
       WHERE status = 'VALIDATED'`
    );

    const peakPowerKw = parseFloat(peakPowerRes.rows[0]?.peak_power_kw) || 0;
    const totalEnergyKwh = parseFloat(totalEnergyRes.rows[0]?.total_energy_kwh) || 0;
    const co2OffsetKg = totalEnergyKwh * EMISSION_FACTOR;
    const co2OffsetTons = co2OffsetKg / 1000;

    res.json({
      peakPowerKw: parseFloat(peakPowerKw.toFixed(2)),
      totalEnergyKwh: parseFloat(totalEnergyKwh.toFixed(2)),
      totalEnergyMwh: parseFloat((totalEnergyKwh / 1000).toFixed(2)),
      co2OffsetKg: parseFloat(co2OffsetKg.toFixed(2)),
      co2OffsetTons: parseFloat(co2OffsetTons.toFixed(2)),
      activeSites: parseInt(activeSitesRes.rows[0]?.active_sites) || 0,
      activeMeters: parseInt(activeMetersRes.rows[0]?.active_meters) || 0,
      dataPoints: parseInt(dataPointsRes.rows[0]?.data_points) || 0,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[API] Error getting network stats:', err);
    res.status(500).json({ error: 'Failed to fetch network stats', message: err.message });
  }
};

/**
 * Get network growth data over time
 */
module.exports.getNetworkGrowthCtrl = async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const EMISSION_FACTOR = 0.71;

    const daysBack = parseInt(days) || 7;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);
    cutoffDate.setHours(0, 0, 0, 0);

    // Get daily peak power and cumulative energy
    const result = await query(
      `SELECT 
        DATE(tb.interval_start) as date,
        MAX(tr.power_total_w) / 1000.0 as peak_power_kw,
        SUM(tr.energy_exp_l1_wh + tr.energy_exp_l2_wh + tr.energy_exp_l3_wh) / 1000.0 as daily_energy_kwh
       FROM telemetry_raw tr
       JOIN telemetry_batches tb ON tr.batch_id = tb.id
       WHERE tb.interval_start >= $1
       AND tb.status = 'VALIDATED'
       GROUP BY DATE(tb.interval_start)
       ORDER BY DATE(tb.interval_start) ASC`,
      [cutoffDate]
    );

    // Calculate cumulative values
    let cumulativeEnergy = 0;
    let cumulativeCo2 = 0;

    const data = result.rows.map((row) => {
      cumulativeEnergy += parseFloat(row.daily_energy_kwh || 0);
      cumulativeCo2 = (cumulativeEnergy * EMISSION_FACTOR) / 1000; // in tons

      return {
        date: row.date.toISOString().split('T')[0],
        peakPowerKw: parseFloat(row.peak_power_kw || 0),
        dailyEnergyKwh: parseFloat(row.daily_energy_kwh || 0),
        cumulativeEnergyKwh: parseFloat(cumulativeEnergy.toFixed(2)),
        cumulativeEnergyMwh: parseFloat((cumulativeEnergy / 1000).toFixed(2)),
        cumulativeCo2Tons: parseFloat(cumulativeCo2.toFixed(2)),
      };
    });

    res.json(data);
  } catch (err) {
    console.error('[API] Error getting network growth:', err);
    res.status(500).json({ error: 'Failed to fetch network growth', message: err.message });
  }
};

/**
 * Get investment categories summary
 */
module.exports.getInvestmentCategoriesCtrl = async (req, res) => {
  try {
    const EMISSION_FACTOR = 0.71;

    // Get category summaries with total valuation (only active sites shown in invest)
    const result = await query(
      `SELECT 
        s.category,
        COUNT(DISTINCT s.id) as site_count,
        COUNT(DISTINCT m.id) as meter_count,
        COALESCE(SUM(latest_energy.total_energy_kwh), 0) as total_energy_kwh,
        COALESCE(SUM(s.sites_valuation), 0) as total_valuation
       FROM sites s
       LEFT JOIN meters m ON s.id = m.site_id AND m.active = true
       LEFT JOIN LATERAL (
         SELECT 
           (MAX(tr.energy_exp_l1_wh + tr.energy_exp_l2_wh + tr.energy_exp_l3_wh) / 1000.0) as total_energy_kwh
         FROM telemetry_raw tr
         JOIN telemetry_batches tb ON tr.batch_id = tb.id
         WHERE tb.meter_id = m.id AND tb.status = 'VALIDATED'
       ) latest_energy ON true
       WHERE s.category IS NOT NULL
         AND s.status = 'active'
         AND COALESCE(s.show_in_invest, true) = true
       GROUP BY s.category`
    );

    const categories = result.rows.map((row) => {
      const totalEnergyKwh = parseFloat(row.total_energy_kwh) || 0;
      const co2OffsetTons = (totalEnergyKwh * EMISSION_FACTOR) / 1000;
      const totalValuation = parseFloat(row.total_valuation) || 0;
      
      return {
        category: row.category.toLowerCase(),
        liveAssets: parseInt(row.site_count) || 0,
        totalEnergyKwh: parseFloat(totalEnergyKwh.toFixed(2)),
        co2OffsetTons: parseFloat(co2OffsetTons.toFixed(2)),
        activeMeters: parseInt(row.meter_count) || 0,
        totalValuation: parseFloat(totalValuation.toFixed(2)),
      };
    });

    res.json(categories);
  } catch (err) {
    console.error('[API] Error getting investment categories:', err);
    res.status(500).json({ error: 'Failed to fetch investment categories', message: err.message });
  }
};

/**
 * Get investment assets by category
 */
module.exports.getInvestmentAssetsByCategoryCtrl = async (req, res) => {
  try {
    const { category } = req.params;
    const EMISSION_FACTOR = 0.71;

    // Validate category
    const validCategories = ['solar', 'ev', 'ee'];
    if (!validCategories.includes(category.toLowerCase())) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    // Get sites for this category with their metrics (only active, show_in_invest)
    const result = await query(
      `SELECT 
        s.id,
        s.name,
        s.location,
        s.category,
        s.sites_valuation,
        COUNT(DISTINCT m.id) as meter_count,
        COALESCE(MAX(latest_data.peak_power_w), 0) as peak_power_w,
        COALESCE(MAX(latest_data.total_energy_kwh), 0) as total_energy_kwh,
        COALESCE(MAX(latest_data.latest_timestamp), now()) as latest_timestamp
       FROM sites s
       LEFT JOIN meters m ON s.id = m.site_id AND m.active = true
       LEFT JOIN LATERAL (
         SELECT 
           MAX(tr.power_total_w) as peak_power_w,
           (MAX(tr.energy_exp_l1_wh + tr.energy_exp_l2_wh + tr.energy_exp_l3_wh) / 1000.0) as total_energy_kwh,
           MAX(tb.interval_end) as latest_timestamp
         FROM telemetry_raw tr
         JOIN telemetry_batches tb ON tr.batch_id = tb.id
         WHERE tb.meter_id = m.id AND tb.status = 'VALIDATED'
       ) latest_data ON true
       WHERE UPPER(s.category::text) = UPPER($1)
         AND s.status = 'active'
         AND COALESCE(s.show_in_invest, true) = true
       GROUP BY s.id, s.name, s.location, s.category, s.sites_valuation
       ORDER BY s.name`,
      [category]
    );

    const assets = result.rows.map((row) => {
      const totalEnergyKwh = parseFloat(row.total_energy_kwh) || 0;
      const peakPowerKw = (parseFloat(row.peak_power_w) || 0) / 1000;
      const co2OffsetTons = (totalEnergyKwh * EMISSION_FACTOR) / 1000;
      
      // Use sites_valuation from database, fallback to calculated if null
      const valuation = parseFloat(row.sites_valuation) || Math.round(totalEnergyKwh * 0.5);
      
      // Calculate APY based on category (placeholder values)
      const apyRanges = {
        solar: { min: 10, max: 12 },
        ev: { min: 6, max: 20 },
        ee: { min: 8, max: 15 }
      };
      const apyRange = apyRanges[category.toLowerCase()] || { min: 8, max: 12 };
      const apy = (apyRange.min + apyRange.max) / 2;

      return {
        id: row.id,
        name: row.name,
        location: row.location,
        category: row.category.toLowerCase(),
        valuation: valuation,
        status: parseInt(row.meter_count) > 0 ? 'Live' : 'Pilot',
        apy: apy,
        peakPowerKw: parseFloat(peakPowerKw.toFixed(2)),
        totalEnergyKwh: parseFloat(totalEnergyKwh.toFixed(2)),
        co2OffsetTons: parseFloat(co2OffsetTons.toFixed(2)),
        activeMeters: parseInt(row.meter_count) || 0,
        lastUpdated: row.latest_timestamp,
      };
    });

    res.json(assets);
  } catch (err) {
    console.error('[API] Error getting investment assets by category:', err);
    res.status(500).json({ error: 'Failed to fetch investment assets', message: err.message });
  }
};

/**
 * Get single investment asset details
 */
module.exports.getInvestmentAssetDetailsCtrl = async (req, res) => {
  try {
    const { assetId } = req.params;
    const EMISSION_FACTOR = 0.71;

    // Get site details with IoT pubkey, images, and status for visibility check
    const siteRes = await query(
      `SELECT 
        s.id,
        s.name,
        s.location,
        s.category,
        s.timezone,
        s.sites_valuation,
        s.image_url,
        s.image_urls,
        s.status,
        s.show_in_invest,
        COUNT(DISTINCT m.id) as meter_count,
        MAX(m.iot_pubkey) as iot_pubkey
       FROM sites s
       LEFT JOIN meters m ON s.id = m.site_id AND m.active = true
       WHERE s.id = $1
       GROUP BY s.id, s.name, s.location, s.category, s.timezone, s.sites_valuation, s.image_url, s.image_urls, s.status, s.show_in_invest`,
      [assetId]
    );

    if (siteRes.rowCount === 0) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    const site = siteRes.rows[0];
    if (site.status !== 'active' || site.show_in_invest === false) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    // Get energy metrics
    const metricsRes = await query(
      `SELECT 
         MAX(tr.power_total_w) as peak_power_w,
         (MAX(tr.energy_exp_l1_wh + tr.energy_exp_l2_wh + tr.energy_exp_l3_wh) / 1000.0) as total_energy_kwh,
         MAX(tb.interval_end) as latest_timestamp
       FROM telemetry_raw tr
       JOIN telemetry_batches tb ON tr.batch_id = tb.id
       JOIN meters m ON tb.meter_id = m.id
       WHERE m.site_id = $1 AND tb.status = 'VALIDATED'`,
      [assetId]
    );

    const metrics = metricsRes.rows[0] || {};
    const totalEnergyKwh = parseFloat(metrics.total_energy_kwh) || 0;
    const peakPowerKw = (parseFloat(metrics.peak_power_w) || 0) / 1000;
    const co2OffsetTons = (totalEnergyKwh * EMISSION_FACTOR) / 1000;
    
    // Use sites_valuation from database, fallback to calculated value if null
    const valuation = parseFloat(site.sites_valuation) || Math.round(totalEnergyKwh * 0.5);

    // Get recent daily performance (last 30 days)
    const performanceRes = await query(
      `SELECT 
        DATE(tb.interval_start) as date,
        (MAX(tr.energy_exp_l1_wh + tr.energy_exp_l2_wh + tr.energy_exp_l3_wh) - 
         MIN(tr.energy_exp_l1_wh + tr.energy_exp_l2_wh + tr.energy_exp_l3_wh)) / 1000.0 as daily_energy_kwh
       FROM telemetry_raw tr
       JOIN telemetry_batches tb ON tr.batch_id = tb.id
       JOIN meters m ON tb.meter_id = m.id
       WHERE m.site_id = $1 
       AND tb.interval_start >= NOW() - INTERVAL '30 days'
       AND tb.status = 'VALIDATED'
       GROUP BY DATE(tb.interval_start)
       ORDER BY DATE(tb.interval_start) DESC
       LIMIT 30`,
      [assetId]
    );

    const dailyPerformance = performanceRes.rows.map((row) => ({
      date: row.date.toISOString().split('T')[0],
      energyKwh: parseFloat(row.daily_energy_kwh || 0),
    }));

    // Calculate APY based on category
    const apyRanges = {
      SOLAR: { min: 10, max: 12 },
      EV: { min: 6, max: 20 },
      EE: { min: 8, max: 15 }
    };
    const apyRange = apyRanges[site.category] || { min: 8, max: 12 };
    const apy = (apyRange.min + apyRange.max) / 2;

    const imageUrls = Array.isArray(site.image_urls) ? site.image_urls : [];
    const imageUrl = site.image_url || (imageUrls.length > 0 ? imageUrls[0] : null);

    res.json({
      id: site.id,
      name: site.name,
      location: site.location,
      category: site.category.toLowerCase(),
      timezone: site.timezone,
      valuation: valuation,
      status: parseInt(site.meter_count) > 0 ? 'Live' : 'Pilot',
      apy: apy,
      peakPowerKw: parseFloat(peakPowerKw.toFixed(2)),
      totalEnergyKwh: parseFloat(totalEnergyKwh.toFixed(2)),
      totalEnergyMwh: parseFloat((totalEnergyKwh / 1000).toFixed(2)),
      co2OffsetTons: parseFloat(co2OffsetTons.toFixed(2)),
      activeMeters: parseInt(site.meter_count) || 0,
      iotPubkey: site.iot_pubkey || null,
      lastUpdated: metrics.latest_timestamp || new Date().toISOString(),
      dailyPerformance: dailyPerformance,
      imageUrl: imageUrl,
      imageUrls: imageUrls.length > 0 ? imageUrls : (imageUrl ? [imageUrl] : []),
    });
  } catch (err) {
    console.error('[API] Error getting investment asset details:', err);
    res.status(500).json({ error: 'Failed to fetch asset details', message: err.message });
  }
};
