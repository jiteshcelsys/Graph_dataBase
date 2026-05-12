const express = require('express');
const router = express.Router();
const { listSchemas, getSchema, getProfile, runQuery } = require('../services/dbService');
const { generateInsights, generateKPIs, correctSQL } = require('../services/aiService');

// Collapse pie chart rows beyond maxSlices into a single "Others" slice
function normalizePieData(rows, labelKey, valueKey, maxSlices = 8) {
  if (rows.length <= maxSlices) return rows;
  const sorted      = [...rows].sort((a, b) => Number(b[valueKey]) - Number(a[valueKey]));
  const top         = sorted.slice(0, maxSlices);
  const othersValue = sorted.slice(maxSlices).reduce((sum, r) => sum + Number(r[valueKey]), 0);
  return [...top, { [labelKey]: 'Others', [valueKey]: othersValue }];
}

// Validate alias.column references in a SQL query against the known schema.
// Returns an array of error strings (empty = valid).
function validateColumnRefs(sql, schema) {
  // Build { table_name → Set<column_name> } from schema
  const columnMap = {};
  for (const row of schema) {
    const t = row.table_name.toLowerCase();
    if (!columnMap[t]) columnMap[t] = new Set();
    columnMap[t].add(row.column_name.toLowerCase());
  }

  // Collect CTE alias names so we skip them during validation
  const cteNames = new Set();
  const cteRe = /\b(\w+)\s+AS\s*\(/gi;
  let m;
  while ((m = cteRe.exec(sql)) !== null) {
    const w = m[1].toLowerCase();
    if (w !== 'with') cteNames.add(w);
  }

  // Build alias → real table name from FROM/JOIN clauses
  const SQL_KEYWORDS = new Set([
    'where','on','group','order','having','limit','offset',
    'inner','left','right','full','cross','join','select',
    'from','as','set','with','union','case','when','then','else','end',
  ]);
  const aliasMap = {};
  const fromJoinRe = /\b(?:FROM|JOIN)\s+(?:\w+\.)?(\w+)\s+(?:AS\s+)?(\w+)?/gi;
  while ((m = fromJoinRe.exec(sql)) !== null) {
    const tableName = m[1].toLowerCase();
    const alias     = m[2] ? m[2].toLowerCase() : null;
    if (cteNames.has(tableName)) continue;
    aliasMap[tableName] = tableName;
    if (alias && !SQL_KEYWORDS.has(alias)) aliasMap[alias] = tableName;
  }

  // Scan for alias.column patterns and check against schema
  const SCHEMA_PREFIXES = new Set(['public', 'pg_catalog', 'information_schema']);
  const colRefRe = /\b(\w+)\.(\w+)\b/g;
  const errors = [];
  while ((m = colRefRe.exec(sql)) !== null) {
    const prefix = m[1].toLowerCase();
    const col    = m[2].toLowerCase();
    if (SCHEMA_PREFIXES.has(prefix)) continue;
    const tableName = aliasMap[prefix];
    if (!tableName || cteNames.has(tableName)) continue;
    const cols = columnMap[tableName];
    if (!cols) continue;
    if (!cols.has(col)) {
      errors.push(`column ${prefix}.${col} does not exist on table "${tableName}" (available: ${[...cols].join(', ')})`);
    }
  }

  return errors;
}

const MAX_BAR  = 20;
const MAX_LINE = 50;

function normalizeSeriesData(rows, labelKey, valueKey, chartType) {
  if (chartType === 'bar') {
    if (rows.length <= MAX_BAR) return rows;
    return [...rows]
      .sort((a, b) => Number(b[valueKey]) - Number(a[valueKey]))
      .slice(0, MAX_BAR);
  }
  if (chartType === 'line') {
    return rows.length > MAX_LINE ? rows.slice(0, MAX_LINE) : rows;
  }
  return rows;
}

// Build populated echartsConfig from query rows — shared by both routes and correction retry
function buildChartConfig(rows, insight) {
  const keys      = Object.keys(rows[0]);
  const isNumeric = (v) => v !== null && v !== undefined && !isNaN(Number(v));
  const labelKey  = keys[0];
  const valueKey  = [...keys].reverse().find(k => rows.some(r => isNumeric(r[k]))) || keys[keys.length - 1];
  const config    = JSON.parse(JSON.stringify(insight.echartsConfig));
  const chartType = config.series?.[0]?.type || insight.chartType || 'bar';

  if (chartType === 'pie') {
    const pieRows = normalizePieData(rows, labelKey, valueKey, 8);
    config.series[0].data = pieRows.map(row => ({ name: String(row[labelKey]), value: Number(row[valueKey]) }));
    config.xAxis   = undefined;
    config.grid    = undefined;
    config.tooltip = { trigger: 'item', formatter: '{b}: {c} ({d}%)' };
  } else {
    const cappedRows = normalizeSeriesData(rows, labelKey, valueKey, chartType);
    config.xAxis      = config.xAxis || {};
    config.xAxis.data = cappedRows.map(row => {
      const val = row[labelKey];
      return val instanceof Date ? val.toISOString().slice(0, 7) : String(val);
    });
    config.series[0].data = cappedRows.map(row => Number(row[valueKey]));
  }
  return config;
}

// One-shot LLM correction + retry — called when a query fails validation or execution.
// Returns an enriched insight on success, throws on failure (so caller can fall back to error).
async function tryCorrectAndRun(insight, failedSQL, errorMsg, connectionString, schema, dbSchema) {
  console.log(`[correction] "${insight.title}" — ${errorMsg.slice(0, 120)}`);
  const correctedSQL = await correctSQL(failedSQL, errorMsg, schema, dbSchema);

  const corrColErrors = validateColumnRefs(correctedSQL, schema);
  if (corrColErrors.length > 0) throw new Error(corrColErrors[0]);

  const rows = await runQuery(connectionString, correctedSQL, dbSchema);
  if (!rows || rows.length === 0) return { ...insight, sql: correctedSQL, noData: true };

  const config = buildChartConfig(rows, insight);
  return { ...insight, sql: correctedSQL, echartsConfig: config, rowCount: rows.length, corrected: true };
}

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
  // Only targets table names directly after FROM/JOIN keywords to avoid
  // accidentally qualifying column names that share a name with a table
  // (common with views, e.g. a "country" column in customer_list view
  // when "country" is also a base table in the schema).
  function qualifySQL(sql) {
    const cteAliases = new Set();
    const ctePattern = /\bWITH\b([\s\S]+?)\bSELECT\b/i;
    const cteBlock = sql.match(ctePattern);
    if (cteBlock) {
      const aliasMatches = cteBlock[1].matchAll(/\b(\w+)\s+AS\s*\(/gi);
      for (const m of aliasMatches) cteAliases.add(m[1].toLowerCase());
    }

    let result = sql;
    for (const table of tableNames) {
      if (cteAliases.has(table.toLowerCase())) continue;
      // Only qualify when table name appears directly after FROM or JOIN,
      // and is not already schema-qualified (no preceding dot).
      const re = new RegExp(
        `(\\b(?:FROM|JOIN)\\s+)(?!${dbSchema}\\.)\\b(${table})\\b`,
        'gi'
      );
      result = result.replace(re, `$1${dbSchema}.$2`);
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

          // Pre-flight: validate column references — attempt LLM correction on failure
          const colErrors = validateColumnRefs(qualifiedSQL, schema);
          if (colErrors.length > 0) {
            console.warn(`[col validation] "${insight.title}": ${colErrors[0]}`);
            try {
              return await tryCorrectAndRun(insight, qualifiedSQL, colErrors[0], connectionString, schema, dbSchema);
            } catch (corrErr) {
              console.error(`[correction failed] "${insight.title}":`, corrErr.message);
              return { ...insight, queryError: colErrors[0] };
            }
          }

          // Execute query — nested aggregate gets one deterministic retry before LLM correction
          let rows;
          try {
            rows = await runQuery(connectionString, qualifiedSQL, dbSchema);
          } catch (firstErr) {
            if (/nested/i.test(firstErr.message)) {
              const retried = fixNestedAggregates(qualifiedSQL);
              if (retried !== qualifiedSQL) {
                console.log(`[SQL retry] "${insight.title}" retrying after nested aggregate error`);
                rows = await runQuery(connectionString, retried, dbSchema);
                qualifiedSQL = retried;
              } else throw firstErr;
            } else throw firstErr;
          }

          if (!rows || rows.length === 0) return { ...insight, noData: true };

          const config = buildChartConfig(rows, insight);
          return { ...insight, sql: qualifiedSQL, echartsConfig: config, rowCount: rows.length };

        } catch (queryErr) {
          console.error(`[query error] ${insight.title}:`, queryErr.message);
          // One-shot LLM correction attempt before giving up
          try {
            return await tryCorrectAndRun(insight, insight.sql, queryErr.message, connectionString, schema, dbSchema);
          } catch (corrErr) {
            console.error(`[correction failed] "${insight.title}":`, corrErr.message);
            return { ...insight, queryError: queryErr.message };
          }
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

// POST /api/refresh-insights — re-execute stored SQL templates without calling the LLM
router.post('/refresh-insights', async (req, res) => {
  const { connectionString, dbSchema = 'public', insights: templates, kpiDefs } = req.body;
  if (!connectionString || !Array.isArray(templates) || !Array.isArray(kpiDefs)) {
    return res.status(400).json({ error: 'connectionString, insights, and kpiDefs are required.' });
  }

  const isNumeric = (v) => v !== null && v !== undefined && !isNaN(Number(v));

  try {
    const enriched = await Promise.all(
      templates.map(async (insight) => {
        try {
          const rows = await runQuery(connectionString, insight.sql, dbSchema);
          if (!rows || rows.length === 0) return { ...insight, noData: true };

          const keys = Object.keys(rows[0]);
          const labelKey = keys[0];
          const valueKey = [...keys].reverse().find((k) => rows.some((r) => isNumeric(r[k]))) || keys[keys.length - 1];

          const config = JSON.parse(JSON.stringify(insight.echartsConfig));
          const chartType = config.series?.[0]?.type || insight.chartType || 'bar';

          if (chartType === 'pie') {
            const pieRows = normalizePieData(rows, labelKey, valueKey, 8);
            config.series[0].data = pieRows.map((row) => ({ name: String(row[labelKey]), value: Number(row[valueKey]) }));
            config.xAxis = undefined;
            config.grid = undefined;
            config.tooltip = { trigger: 'item', formatter: '{b}: {c} ({d}%)' };
          } else {
            const cappedRows = normalizeSeriesData(rows, labelKey, valueKey, chartType);
            config.xAxis = config.xAxis || {};
            config.xAxis.data = cappedRows.map((row) => {
              const val = row[labelKey];
              return val instanceof Date ? val.toISOString().slice(0, 7) : String(val);
            });
            config.series[0].data = cappedRows.map((row) => Number(row[valueKey]));
          }

          return { ...insight, echartsConfig: config, rowCount: rows.length };
        } catch (queryErr) {
          console.error(`[refresh query error] ${insight.title}:`, queryErr.message);
          return { ...insight, queryError: queryErr.message };
        }
      })
    );

    const kpis = await Promise.all(
      kpiDefs.map(async (kpi) => {
        try {
          const rows = await runQuery(connectionString, kpi.sql, dbSchema);
          const raw = rows?.[0]?.value ?? rows?.[0]?.[Object.keys(rows[0])[0]] ?? null;
          const num = Number(raw);
          return { ...kpi, value: isNaN(num) ? raw : num };
        } catch (e) {
          console.warn(`[refresh KPI] "${kpi.label}" failed:`, e.message);
          return { ...kpi, value: null };
        }
      })
    );

    res.json({ insights: enriched, kpis });
  } catch (err) {
    console.error('[/refresh-insights]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
