/**
 * Run GEN_013 migration - User Investment Tables
 * Usage: node scripts/run-migration-013.js
 */

const fs = require('fs');
const path = require('path');
const { query } = require('../db');

async function runMigration() {
  console.log('🚀 Running GEN_013 migration...\n');

  try {
    // Read migration file
    const migrationPath = path.join(__dirname, '../db/migrations/GEN_013.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('📄 Migration file loaded');
    console.log('📊 Creating user investment tables...\n');

    // Execute migration
    await query(migrationSQL);

    console.log('✅ Migration GEN_013 completed successfully!\n');
    console.log('Created tables:');
    console.log('  - users');
    console.log('  - user_investments');
    console.log('  - user_transactions');
    console.log('  - user_yield_history');
    console.log('\nCreated enums:');
    console.log('  - transaction_type_enum');
    console.log('  - transaction_status_enum');
    console.log('\nCreated indexes and triggers');
    console.log('\n🎉 Ready to use!');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

runMigration()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
