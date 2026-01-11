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
 * Get location metrics (peak power, total energy, devices)
 */
module.exports.getLocationMetricsCtrl = async (req, res) => {
  try {
    const { locationId } = req.params;

    // Get site info
    const siteRes = await query('SELECT id, name, location FROM sites WHERE id = $1', [locationId]);
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

