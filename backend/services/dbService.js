const { Pool } = require('pg');

function createPool(connectionString) {
  return new Pool({
    connectionString,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: 5,
    ssl: connectionString.includes('sslmode=require')
      ? { rejectUnauthorized: false }
      : false,
  });
}

async function listSchemas(connectionString) {
  const pool = createPool(connectionString);
  try {
    const result = await pool.query(`
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name NOT IN ('pg_catalog','information_schema','pg_toast','pg_temp_1','pg_toast_temp_1')
        AND schema_name NOT LIKE 'pg_%'
      ORDER BY schema_name
    `);
    return result.rows.map((r) => r.schema_name);
  } finally {
    await pool.end();
  }
}

async function getSchema(connectionString, dbSchema = 'public') {
  const pool = createPool(connectionString);
  try {
    const result = await pool.query(
      `SELECT
        c.table_name,
        c.column_name,
        c.data_type
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_name = c.table_name
       AND t.table_schema = c.table_schema
      WHERE c.table_schema = $1
        AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name, c.ordinal_position`,
      [dbSchema]
    );
    return result.rows;
  } finally {
    await pool.end();
  }
}

async function getProfile(connectionString, dbSchema = 'public') {
  const pool = createPool(connectionString);
  try {
    const result = await pool.query(
      `SELECT
        s.tablename,
        s.attname AS column_name,
        s.n_distinct,
        s.null_frac
      FROM pg_stats s
      JOIN information_schema.tables t
        ON t.table_name = s.tablename
       AND t.table_schema = s.schemaname
      WHERE s.schemaname = $1
        AND t.table_type = 'BASE TABLE'
      ORDER BY s.tablename, s.attname`,
      [dbSchema]
    );
    return result.rows;
  } finally {
    await pool.end();
  }
}

async function runQuery(connectionString, sql, dbSchema = 'public') {
  // Safety: only allow SELECT / CTE (WITH ... SELECT) statements
  const normalized = sql.trim().toLowerCase();
  if (!normalized.startsWith('select') && !normalized.startsWith('with')) {
    throw new Error('Only SELECT queries are permitted.');
  }

  const pool = createPool(connectionString);
  const client = await pool.connect();
  try {
    // Set search_path so unqualified table names resolve to the correct schema
    await client.query(`SET search_path TO ${dbSchema}, public`);
    const result = await client.query(sql);
    return result.rows;
  } finally {
    client.release();
    await pool.end();
  }
}

module.exports = { listSchemas, getSchema, getProfile, runQuery };
