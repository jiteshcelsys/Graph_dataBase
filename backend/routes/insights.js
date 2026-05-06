const express = require('express');
const router = express.Router();
const { listSchemas, getSchema, getProfile, runQuery } = require('../services/dbService');
const { generateInsights, generateKPIs } = require('../services/aiService');

// POST /api/schemas — list available non-system schemas
router.post('/schemas', async (req, res) => {
  const { connectionString } = req.body;
  if (!connectionString) return res.status(400).json({ error: 'connectionString is required.' });
  try {
    const schemas = await listSchemas(connectionString);
    res.json({ schemas });
  } catch (err) {
    console.error('[/schemas]', err.message);
    res.status(500).json({ error: `Could not list schemas: ${err.message}` });
  }
});

// POST /api/connect — extract schema and column profile
router.post('/connect', async (req, res) => {
  const { connectionString, dbSchema = 'public' } = req.body;
  if (!connectionString) {
    return res.status(400).json({ error: 'connectionString is required.' });
  }

  try {
    const [schema, profile] = await Promise.all([
      getSchema(connectionString, dbSchema),
      getProfile(connectionString, dbSchema),
    ]);
    console.log(`[/connect] schema="${dbSchema}" tables=${[...new Set(schema.map(r => r.table_name))].length} columns=${schema.length}`);
    res.json({ schema, profile });
  } catch (err) {
    console.error('[/connect]', err.message);
    res.status(500).json({ error: `Database connection failed: ${err.message}` });
  }
});

// POST /api/insights — generate AI insights and execute queries
router.post('/insights', async (req, res) => {
  const { connectionString, schema, profile, dbSchema = 'public' } = req.body;
  if (!connectionString || !schema || !profile) {
    return res.status(400).json({ error: 'connectionString, schema, and profile are required.' });
  }

  // Build set of real table names from schema for SQL patching
  const tableNames = [...new Set(schema.map((r) => r.table_name))];

  // Prefix any unqualified table reference with dbSchema.
  // Skips names that are CTE aliases (defined in WITH clauses).
  function qualifySQL(sql) {
    // Collect CTE alias names so we don't accidentally qualify them
    const cteAliases = new Set();
    const ctePattern = /\bWITH\b([\s\S]+?)\bSELECT\b/i;
    const cteBlock = sql.match(ctePattern);
    if (cteBlock) {
      const aliasMatches = cteBlock[1].matchAll(/\b(\w+)\s+AS\s*\(/gi);
      for (const m of aliasMatches) cteAliases.add(m[1].toLowerCase());
    }

    let result = sql;
    for (const table of tableNames) {
      if (cteAliases.has(table.toLowerCase())) continue; // skip CTE aliases
      // Only qualify if not already preceded by a dot (schema already set)
      const re = new RegExp(`(?<![\\w.])\\b${table}\\b(?![\\w(])`, 'gi');
      result = result.replace(re, `${dbSchema}.${table}`);
    }
    return result;
  }

  // Rewrite nested aggregate queries using a CTE.
  // Handles: COUNT(DISTINCT CASE WHEN COUNT(...) > n THEN col END)
  // PostgreSQL forbids aggregating inside an aggregate in a single query level.
  function fixNestedAggregates(sql) {
    if (!/COUNT\s*\(\s*DISTINCT\s+CASE\s+WHEN\s+COUNT/i.test(sql)) return sql;

    const fromMatch  = sql.match(/\bFROM\s+([\w."]+)/i);
    const groupMatch = sql.match(/\bGROUP\s+BY\s+([\w."]+)/i);
    if (!fromMatch || !groupMatch) return sql;

    const table    = fromMatch[1];
    const groupCol = groupMatch[1].trim();

    // Extract the count threshold (e.g. > 1) if present, default to 1
    const thresholdMatch = sql.match(/COUNT\s*\([^)]+\)\s*([><=!]+\s*\d+)/i);
    const threshold = thresholdMatch ? thresholdMatch[1].trim() : '> 1';

    const fixed =
`WITH _customer_counts AS (
  SELECT ${groupCol}, COUNT(*) AS order_count
  FROM ${table}
  GROUP BY ${groupCol}
)
SELECT
  COUNT(DISTINCT ${groupCol}) AS num_customers,
  COUNT(DISTINCT CASE WHEN order_count ${threshold} THEN ${groupCol} END) AS num_retained_customers,
  ROUND(100.0 * COUNT(DISTINCT CASE WHEN order_count ${threshold} THEN ${groupCol} END)
    / NULLIF(COUNT(DISTINCT ${groupCol}), 0), 2) AS retention_rate_pct
FROM _customer_counts`;

    console.log(`[SQL fix] nested aggregate → CTE for ${table} grouped by ${groupCol}`);
    return fixed;
  }

  try {
    // 1. Generate KPIs and insights in parallel
    const [kpiDefs, insights] = await Promise.all([
      generateKPIs(schema, dbSchema),
      generateInsights(schema, profile, dbSchema),
    ]);

    // 2. Execute each SQL query and inject real data into echartsConfig
    const enriched = await Promise.all(
      insights.map(async (insight) => {
        try {
          let qualifiedSQL = qualifySQL(insight.sql);
          qualifiedSQL = fixNestedAggregates(qualifiedSQL);
          if (qualifiedSQL !== insight.sql) {
            console.log(`[SQL patch] "${insight.title}"\n  After : ${qualifiedSQL}`);
          }
          let rows;
          try {
            rows = await runQuery(connectionString, qualifiedSQL, dbSchema);
          } catch (firstErr) {
            if (/nested/i.test(firstErr.message)) {
              // Last-resort retry: rewrite as subquery and try once more
              const retried = fixNestedAggregates(qualifiedSQL);
              if (retried !== qualifiedSQL) {
                console.log(`[SQL retry] "${insight.title}" retrying after nested aggregate error`);
                rows = await runQuery(connectionString, retried, dbSchema);
                qualifiedSQL = retried;
              } else throw firstErr;
            } else throw firstErr;
          }

          if (!rows || rows.length === 0) {
            return { ...insight, noData: true };
          }

          const keys = Object.keys(rows[0]);

          // Find the best label key: first string/date column
          // Find the best value key: last column whose values are numeric
          const isNumeric = (v) => v !== null && v !== undefined && !isNaN(Number(v));
          const labelKey = keys[0];
          const valueKey = [...keys].reverse().find((k) =>
            rows.some((r) => isNumeric(r[k]))
          ) || keys[keys.length - 1];

          const config = JSON.parse(JSON.stringify(insight.echartsConfig)); // deep clone

          const chartType =
            config.series?.[0]?.type ||
            insight.chartType ||
            'bar';

          if (chartType === 'pie') {
            // Pie charts use {name, value} format
            config.series[0].data = rows.map((row) => ({
              name: String(row[labelKey]),
              value: Number(row[valueKey]),
            }));
            // Pie charts don't use xAxis
            config.xAxis = undefined;
            config.grid = undefined;
            config.tooltip = { trigger: 'item', formatter: '{b}: {c} ({d}%)' };
          } else {
            // Bar / Line
            config.xAxis = config.xAxis || {};
            config.xAxis.data = rows.map((row) => {
              const val = row[labelKey];
              // Format timestamps nicely
              if (val instanceof Date) {
                return val.toISOString().slice(0, 7); // YYYY-MM
              }
              return String(val);
            });
            config.series[0].data = rows.map((row) => Number(row[valueKey]));
          }

          return { ...insight, sql: qualifiedSQL, echartsConfig: config, rowCount: rows.length };
        } catch (queryErr) {
          console.error(`[query error] ${insight.title}:`, queryErr.message);
          return { ...insight, queryError: queryErr.message };
        }
      })
    );

    // Run KPI queries and attach real values
    const kpis = await Promise.all(
      kpiDefs.map(async (kpi) => {
        try {
          const sql = qualifySQL(kpi.sql);
          const rows = await runQuery(connectionString, sql, dbSchema);
          const raw = rows?.[0]?.value ?? rows?.[0]?.[Object.keys(rows[0])[0]] ?? null;
          const num = Number(raw);
          return { ...kpi, value: isNaN(num) ? raw : num };
        } catch (e) {
          console.warn(`[KPI] "${kpi.label}" failed:`, e.message);
          return { ...kpi, value: null };
        }
      })
    );

    res.json({ insights: enriched, kpis });
  } catch (err) {
    console.error('[/insights]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
