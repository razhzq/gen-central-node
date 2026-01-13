const { query } = require('../../db');
const fs = require('fs');
const path = require('path');

/**
 * Run a specific migration
 */
module.exports.runMigrationCtrl = async (req, res) => {
  try {
    const { migrationNumber } = req.params;
    
    const migrationPath = path.join(__dirname, `../../db/migrations/GEN_${migrationNumber.padStart(3, '0')}.sql`);
    
    if (!fs.existsSync(migrationPath)) {
      return res.status(404).json({ error: 'Migration file not found' });
    }
    
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    // Execute the migration
    await query(migrationSQL);
    
    res.json({ 
      success: true, 
      message: `Migration GEN_${migrationNumber.padStart(3, '0')} executed successfully` 
    });
  } catch (err) {
    console.error('[MIGRATION] Error:', err);
    res.status(500).json({ 
      error: 'Migration failed', 
      message: err.message 
    });
  }
};

/**
 * Database health check
 */
module.exports.databaseHealthCtrl = async (req, res) => {
  try {
    const result = await query('SELECT NOW() as current_time, version() as pg_version');
    res.json({
      status: 'healthy',
      timestamp: result.rows[0].current_time,
      version: result.rows[0].pg_version,
    });
  } catch (err) {
    console.error('[HEALTH] Database check failed:', err);
    res.status(500).json({
      status: 'unhealthy',
      error: err.message,
    });
  }
};
