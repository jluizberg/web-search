const { Pool } = require('pg');

let pool = null;

function getPool(config) {
  if (!pool) {
    pool = new Pool({ connectionString: config.POSTGRES_URL });
  }
  return pool;
}

async function query(config, sql, params) {
  const pool = getPool(config);
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result;
  } finally {
    client.release();
  }
}

module.exports = { getPool, query };
