const path = require('path');
const envPath = path.resolve(__dirname, '../.env');
require('dotenv').config({
    path: envPath
});
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT),
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
  ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 10,              // max connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Optional: connection test
pool.on('connect', () => {
  console.log('PostgreSQL connected');
});

pool.on('error', (err) => {
  console.error('Unexpected PG error', err);
  process.exit(1);
});

/**
 * Simple query wrapper
 */
async function query(text, params = []) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    return res;
  } finally {
    const duration = Date.now() - start;
    if (process.env.NODE_ENV !== 'production') {
      console.log('PG query', { text, duration });
    }
  }
}

module.exports = {
  query,
  pool, // export if you need transactions
};
