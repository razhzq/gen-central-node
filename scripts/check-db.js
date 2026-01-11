const path = require('path');
const envPath = path.resolve(__dirname, '../.env');
require('dotenv').config({ path: envPath });
const { query } = require('../db');

async function checkDatabase() {
  try {
    console.log('\n🔍 Checking database contents...\n');

    // Check sites
    const sitesRes = await query('SELECT id, name, location FROM sites');
    console.log(`📍 Sites: ${sitesRes.rowCount}`);
    if (sitesRes.rows.length > 0) {
      sitesRes.rows.forEach((site) => {
        console.log(`   - ${site.name} (${site.location}) - ID: ${site.id}`);
      });
    } else {
      console.log('   ⚠️  No sites found');
    }

    // Check meters
    const metersRes = await query('SELECT id, meter_identifier, site_id, active FROM meters');
    console.log(`\n🔌 Meters: ${metersRes.rowCount}`);
    if (metersRes.rows.length > 0) {
      metersRes.rows.forEach((meter) => {
        console.log(`   - ${meter.meter_identifier} (Active: ${meter.active}) - ID: ${meter.id}`);
      });
    } else {
      console.log('   ⚠️  No meters found');
    }

    // Check telemetry batches
    const batchesRes = await query(`
      SELECT 
        COUNT(*) as total,
        COUNT(DISTINCT meter_id) as meters_with_data,
        MIN(interval_start) as earliest,
        MAX(interval_end) as latest
      FROM telemetry_batches
    `);
    console.log(`\n📊 Telemetry Batches: ${batchesRes.rows[0].total}`);
    if (batchesRes.rows[0].total > 0) {
      console.log(`   - Meters with data: ${batchesRes.rows[0].meters_with_data}`);
      console.log(`   - Earliest: ${batchesRes.rows[0].earliest}`);
      console.log(`   - Latest: ${batchesRes.rows[0].latest}`);
    } else {
      console.log('   ⚠️  No telemetry batches found');
    }

    // Check recent batches
    const recentBatchesRes = await query(`
      SELECT 
        tb.id,
        tb.interval_start,
        tb.interval_end,
        tb.status,
        m.meter_identifier
      FROM telemetry_batches tb
      JOIN meters m ON tb.meter_id = m.id
      ORDER BY tb.interval_start DESC
      LIMIT 5
    `);
    if (recentBatchesRes.rows.length > 0) {
      console.log(`\n📅 Recent Batches (last 5):`);
      recentBatchesRes.rows.forEach((batch) => {
        console.log(`   - ${batch.meter_identifier}: ${batch.interval_start} to ${batch.interval_end} (${batch.status})`);
      });
    }

    // Check telemetry raw data
    const rawRes = await query('SELECT COUNT(*) as total FROM telemetry_raw');
    console.log(`\n💾 Raw Telemetry Data: ${rawRes.rows[0].total} records`);

    // Check telemetry metrics
    const metricsRes = await query('SELECT COUNT(*) as total FROM telemetry_metrics');
    console.log(`📈 Telemetry Metrics: ${metricsRes.rows[0].total} records`);

    console.log('\n✅ Database check complete\n');
  } catch (err) {
    console.error('\n❌ Error checking database:', err.message);
    console.error(err);
    process.exit(1);
  }
}

checkDatabase()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

