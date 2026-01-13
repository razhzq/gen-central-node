const fs = require('fs');
const path = require('path');
const { query, pool } = require('../db');

async function runMigration() {
  try {
    console.log('🔄 Running migration GEN_011...');
    
    const migrationPath = path.join(__dirname, '../db/migrations/GEN_011.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    // Execute the migration
    await query(migrationSQL);
    
    console.log('✅ Migration GEN_011 completed successfully');
    console.log('   - Added site_category_enum type');
    console.log('   - Added category column to sites table');
    console.log('   - Updated Puchong site to SOLAR category');
    
    // Verify the migration
    const result = await query('SELECT id, name, category FROM sites');
    console.log('\n📊 Current sites:');
    result.rows.forEach(site => {
      console.log(`   - ${site.name}: ${site.category || 'NULL'}`);
    });
    
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    throw err;
  } finally {
    await pool.end();
  }
}

runMigration();
