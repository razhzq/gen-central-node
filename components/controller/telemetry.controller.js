const { v4: uuidv4 } = require('uuid');
const { query } = require('../../db');
const crypto = require('crypto');

/**
 * Receive hourly telemetry data from IoT node
 */
module.exports.receiveHourlyTelemetryCtrl = async (req, res) => {
  try {
    const {
      meter_identifier,
      datetimestamp,
      intPowerL1,
      intPowerL2,
      intPowerL3,
      intPowerTotal,
      intEnergyImpL1,
      intEnergyImpL2,
      intEnergyImpL3,
      intEnergyExpL1,
      intEnergyExpL2,
      intEnergyExpL3,
      intEnergyTotal,
    } = req.body;

    // Validate required fields
    if (!meter_identifier || !datetimestamp) {
      return res.status(400).json({
        error: 'Missing required fields: meter_identifier and datetimestamp are required',
      });
    }

    // Parse timestamp (format: "2025-12-31 11:00:00 PM")
    let deviceTimestamp;
    try {
      // Handle format like "2025-12-31 11:00:00 PM"
      const [datePart, timePart, meridiem] = datetimestamp.split(' ');
      if (meridiem) {
        const [hour, min, sec] = timePart.split(':').map(Number);
        let h = hour;
        if (meridiem === 'PM' && hour !== 12) h += 12;
        if (meridiem === 'AM' && hour === 12) h = 0;
        const isoString = `${datePart}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
        deviceTimestamp = new Date(isoString);
      } else {
        deviceTimestamp = new Date(datetimestamp);
      }
      
      if (isNaN(deviceTimestamp.getTime())) {
        return res.status(400).json({ 
          error: 'Invalid datetimestamp format',
          received: datetimestamp,
          parsed: deviceTimestamp ? deviceTimestamp.toString() : 'N/A'
        });
      }
    } catch (err) {
      return res.status(400).json({ 
        error: 'Invalid datetimestamp format', 
        details: err.message,
        received: datetimestamp 
      });
    }

    // Calculate interval (hourly data)
    const intervalStart = new Date(deviceTimestamp);
    intervalStart.setMinutes(0, 0, 0);
    const intervalEnd = new Date(intervalStart);
    intervalEnd.setHours(intervalEnd.getHours() + 1);

    // Find meter by identifier
    const meterRes = await query(
      'SELECT id FROM meters WHERE meter_identifier = $1 AND active = true',
      [meter_identifier]
    );

    if (meterRes.rowCount === 0) {
      return res.status(404).json({ error: 'Meter not found or inactive' });
    }

    const meterId = meterRes.rows[0].id;

    // Check if batch already exists (idempotency)
    const existingBatch = await query(
      `SELECT id FROM telemetry_batches 
       WHERE meter_id = $1 
       AND batch_type = 'HOURLY' 
       AND interval_start = $2 
       AND interval_end = $3`,
      [meterId, intervalStart, intervalEnd]
    );

    let batchId;
    if (existingBatch.rowCount > 0) {
      batchId = existingBatch.rows[0].id;
      console.log(`[Telemetry] Batch already exists for ${meter_identifier} at ${intervalStart.toISOString()}`);
    } else {
      // Create new batch
      batchId = uuidv4();
      const payloadHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(req.body))
        .digest('hex');

      await query(
        `INSERT INTO telemetry_batches (
          id, meter_id, batch_type, interval_start, interval_end,
          device_timestamp, payload_hash, signature, status
        ) VALUES ($1, $2, 'HOURLY', $3, $4, $5, $6, $7, 'VALIDATED')`,
        [
          batchId,
          meterId,
          intervalStart,
          intervalEnd,
          deviceTimestamp,
          payloadHash,
          req.body.signature || 'N/A', // Add signature if provided
        ]
      );

      // Insert raw telemetry data
      await query(
        `INSERT INTO telemetry_raw (
          batch_id, power_l1_w, power_l2_w, power_l3_w, power_total_w,
          energy_imp_l1_wh, energy_imp_l2_wh, energy_imp_l3_wh,
          energy_exp_l1_wh, energy_exp_l2_wh, energy_exp_l3_wh,
          energy_total_wh
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          batchId,
          intPowerL1 || 0,
          intPowerL2 || 0,
          intPowerL3 || 0,
          intPowerTotal || 0,
          intEnergyImpL1 || 0,
          intEnergyImpL2 || 0,
          intEnergyImpL3 || 0,
          intEnergyExpL1 || 0,
          intEnergyExpL2 || 0,
          intEnergyExpL3 || 0,
          intEnergyTotal || 0,
        ]
      );

      // Insert metrics for easy querying
      const metrics = [
        { metric: 'power_l1_w', value: intPowerL1 || 0, unit: 'W' },
        { metric: 'power_l2_w', value: intPowerL2 || 0, unit: 'W' },
        { metric: 'power_l3_w', value: intPowerL3 || 0, unit: 'W' },
        { metric: 'power_total_w', value: intPowerTotal || 0, unit: 'W' },
        { metric: 'energy_imp_total_wh', value: (intEnergyImpL1 || 0) + (intEnergyImpL2 || 0) + (intEnergyImpL3 || 0), unit: 'Wh' },
        { metric: 'energy_exp_total_wh', value: (intEnergyExpL1 || 0) + (intEnergyExpL2 || 0) + (intEnergyExpL3 || 0), unit: 'Wh' },
        { metric: 'energy_net_wh', value: intEnergyTotal || 0, unit: 'Wh' },
      ];

      for (const m of metrics) {
        await query(
          `INSERT INTO telemetry_metrics (
            meter_id, batch_id, metric, value, unit, recorded_at
          ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [meterId, batchId, m.metric, m.value, m.unit, deviceTimestamp]
        );
      }

      console.log(`[Telemetry] Saved hourly data for meter ${meter_identifier} at ${intervalStart.toISOString()}`);
    }

    res.status(200).json({
      success: true,
      batch_id: batchId,
      message: 'Telemetry data received',
    });
  } catch (err) {
    console.error('[Telemetry] Error receiving hourly data:', err);
    res.status(500).json({
      error: 'Failed to process telemetry data',
      message: err.message,
    });
  }
};

