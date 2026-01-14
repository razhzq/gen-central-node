/**
 * Seed demo user data for testing
 * Run with: node scripts/seed-demo-users.js
 */

const { query } = require('../db');

async function seedDemoUsers() {
  console.log('🌱 Seeding demo user data...\n');

  try {
    // Demo user 1
    const demoEmail = 'demo@genexample.com';
    const demoWallet = '0x1234567890abcdef1234567890abcdef12345678';

    console.log('Creating demo user...');
    const userResult = await query(
      `INSERT INTO users (email, wallet_address, available_balance, kyc_status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (wallet_address) DO UPDATE 
       SET email = EXCLUDED.email
       RETURNING *`,
      [demoEmail, demoWallet, 1360.45, 'unverified']
    );

    const userId = userResult.rows[0].id;
    console.log(`✅ User created: ${userResult.rows[0].email}`);

    // Get existing sites
    const sitesResult = await query(`SELECT id, name, category FROM sites WHERE category IS NOT NULL`);
    
    if (sitesResult.rows.length === 0) {
      console.log('⚠️  No sites with categories found. Please run migrations and add sites first.');
      return;
    }

    console.log(`\nFound ${sitesResult.rows.length} sites`);

    // Create investments for each category
    const investments = [
      { category: 'SOLAR', amount: 6000, tokenAmount: 6000 },
      { category: 'EV', amount: 3000, tokenAmount: 3000 },
      { category: 'EE', amount: 1000, tokenAmount: 1000 },
    ];

    console.log('\nCreating investments...');
    for (const investment of investments) {
      const site = sitesResult.rows.find(s => s.category === investment.category);
      
      if (site) {
        await query(
          `INSERT INTO user_investments (user_id, asset_category, site_id, amount_usd, token_amount)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (user_id, site_id) DO UPDATE
           SET amount_usd = EXCLUDED.amount_usd, token_amount = EXCLUDED.token_amount`,
          [userId, investment.category, site.id, investment.amount, investment.tokenAmount]
        );
        console.log(`  ✅ ${investment.category}: $${investment.amount}`);
      }
    }

    // Create demo transactions
    console.log('\nCreating demo transactions...');
    const transactions = [
      {
        type: 'DEPOSIT',
        category: null,
        amount: 10000,
        status: 'COMPLETED',
        date: new Date('2026-01-10'),
      },
      {
        type: 'BUY',
        category: 'SOLAR',
        amount: 6000,
        status: 'COMPLETED',
        date: new Date('2026-01-11'),
      },
      {
        type: 'BUY',
        category: 'EV',
        amount: 3000,
        status: 'COMPLETED',
        date: new Date('2026-01-12'),
      },
      {
        type: 'BUY',
        category: 'EE',
        amount: 1000,
        status: 'COMPLETED',
        date: new Date('2026-01-13'),
      },
      {
        type: 'WITHDRAW',
        category: null,
        amount: 100,
        status: 'COMPLETED',
        date: new Date('2026-03-02'),
      },
    ];

    for (const tx of transactions) {
      await query(
        `INSERT INTO user_transactions (user_id, transaction_type, asset_category, amount_usd, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, tx.type, tx.category, tx.amount, tx.status, tx.date]
      );
      console.log(`  ✅ ${tx.type}: $${tx.amount}`);
    }

    // Create yield history
    console.log('\nCreating yield history...');
    const investmentIds = await query(
      `SELECT id, asset_category FROM user_investments WHERE user_id = $1`,
      [userId]
    );

    const monthsBack = 5;
    for (let i = monthsBack; i >= 1; i--) {
      const monthDate = new Date();
      monthDate.setMonth(monthDate.getMonth() - i);
      const periodStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
      const periodEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);

      for (const inv of investmentIds.rows) {
        const apy = inv.asset_category === 'SOLAR' ? 12.7 : inv.asset_category === 'EV' ? 15.2 : 18.5;
        const monthlyYield = Math.round((apy / 12) * Math.random() * 20 * 100) / 100;

        await query(
          `INSERT INTO user_yield_history (user_id, investment_id, asset_category, yield_amount_usd, apy_rate, period_start, period_end)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [userId, inv.id, inv.asset_category, monthlyYield, apy, periodStart, periodEnd]
        );
      }
      console.log(`  ✅ Month ${i} ago: yields generated`);
    }

    console.log('\n✨ Demo data seeded successfully!\n');
    console.log('Demo user credentials:');
    console.log(`  Email: ${demoEmail}`);
    console.log(`  Wallet: ${demoWallet}`);
    console.log('\nYou can now test the profile page with this user data.');

  } catch (error) {
    console.error('❌ Error seeding demo data:', error);
    throw error;
  }
}

// Run the seeder
seedDemoUsers()
  .then(() => {
    console.log('\n✅ Seeding complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Seeding failed:', error);
    process.exit(1);
  });
