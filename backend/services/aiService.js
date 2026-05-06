const { ChatGroq } = require('@langchain/groq');
const { ChatPromptTemplate } = require('@langchain/core/prompts');
const { StringOutputParser } = require('@langchain/core/output_parsers');

const SYSTEM_PROMPT = `You are an expert PostgreSQL data analyst and dashboard generator.
Given a PostgreSQL schema and column statistics, generate 5-7 meaningful business insights.

STRICT SQL RULES:
- Only SELECT queries. No INSERT, UPDATE, DELETE, DROP.
- NEVER nest aggregate functions. COUNT(DISTINCT CASE WHEN COUNT(...) ...) is FORBIDDEN.
- For any metric requiring two levels of aggregation (e.g. retention, repeat customers),
  always use a CTE (WITH clause) to pre-aggregate first, then aggregate in the outer query.
  Example:
    WITH base AS (
      SELECT customer_id, COUNT(*) AS order_count
      FROM {dbSchema}.orders GROUP BY customer_id
    )
    SELECT COUNT(*) AS total, COUNT(CASE WHEN order_count > 1 THEN 1 END) AS retained
    FROM base;
- Use date_trunc() for time-series grouping.
- Always qualify table names with the schema prefix: {dbSchema}.tablename

CHART RULES:
- Line chart → time-series data
- Bar chart  → comparisons and rankings
- Pie chart  → distributions and proportions
- Keep xAxis.data and series[].data as empty arrays [].
- For pie charts omit xAxis entirely.
- echartsConfig must be complete and valid.

OUTPUT FORMAT — return ONLY this JSON array, no markdown, no explanation:
[
  {{
    "title": "Insight title",
    "description": "2-3 sentence business explanation",
    "sql": "WITH ... SELECT ... or SELECT ...",
    "chartType": "bar | line | pie",
    "echartsConfig": {{
      "title": {{ "text": "Chart Title", "left": "center" }},
      "tooltip": {{ "trigger": "axis" }},
      "grid": {{ "left": "5%", "right": "5%", "bottom": "15%", "containLabel": true }},
      "xAxis": {{ "type": "category", "data": [], "axisLabel": {{ "rotate": 30 }} }},
      "yAxis": {{ "type": "value" }},
      "series": [{{ "type": "bar", "data": [], "smooth": true }}]
    }}
  }}
]`;

const USER_PROMPT = `DATABASE SCHEMA NAME: {dbSchema}
SCHEMA (keys: t=table,c=column,d=type):
{schema}

STATS (keys: t=table,c=column,nd=n_distinct,nf=null_frac):
{profile}

IMPORTANT: All SQL queries MUST prefix every table with the schema name "{dbSchema}".
Example: SELECT * FROM {dbSchema}.orders  — NOT just: SELECT * FROM orders

Generate 5-7 insights. Return ONLY the JSON array.`;

function extractJSON(text) {
  // Strip markdown code fences if present
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();

  // Find first [ and last ] to extract JSON array
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('No JSON array found in AI response.');

  return cleaned.slice(start, end + 1);
}

async function generateInsights(schema, profile, dbSchema = 'public') {
  const model = new ChatGroq({
    apiKey: process.env.GROQ_API_KEY,
    model: 'llama-3.3-70b-versatile',
    temperature: 0.2,
    maxTokens: 4096,
  });

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', SYSTEM_PROMPT],
    ['human', USER_PROMPT],
  ]);

  // Compact schema: only table_name, column_name, data_type — no whitespace
  const compactSchema = schema.map(({ table_name, column_name, data_type }) => ({
    t: table_name, c: column_name, d: data_type,
  }));
  const schemaStr = JSON.stringify(compactSchema);

  // Compact profile: only key stats, top 20 rows, drop heavy fields
  const compactProfile = profile.slice(0, 20).map(({ tablename, column_name, n_distinct, null_frac }) => ({
    t: tablename, c: column_name, nd: n_distinct, nf: null_frac,
  }));
  const profileStr = JSON.stringify(compactProfile);

  // Invoke model directly (not via StringOutputParser) to retain usage metadata
  const messages = await prompt.formatMessages({ schema: schemaStr, profile: profileStr, dbSchema });

  console.log('[AI] Sending request to Groq...');
  console.log(`[AI] Schema rows: ${schema.length} | Profile rows: ${compactProfile.length}`);
  console.log(`[AI] Payload size: ~${Math.round((schemaStr.length + profileStr.length) / 1024 * 4)} tokens (est.)`);

  const TIMEOUT_MS = 60000;
  const response = await Promise.race([
    model.invoke(messages),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Groq API timeout after 60s — try again or reduce schema size.')), TIMEOUT_MS)
    ),
  ]);

  console.log('[AI] Response received.');

  const usage = response.usage_metadata || {};
  const inputTokens  = usage.input_tokens  ?? '—';
  const outputTokens = usage.output_tokens ?? '—';
  const totalTokens  = usage.total_tokens  ?? '—';

  console.log('┌─────────────────────────────────────');
  console.log(`│ 🤖  Groq / llama-3.3-70b-versatile`);
  console.log(`│ 📥  Input tokens  : ${inputTokens}`);
  console.log(`│ 📤  Output tokens : ${outputTokens}`);
  console.log(`│ 🔢  Total tokens  : ${totalTokens}`);
  console.log('└─────────────────────────────────────');

  const raw = typeof response.content === 'string' ? response.content : String(response.content);

  const jsonStr = extractJSON(raw);

  let insights;
  try {
    insights = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(`AI returned invalid JSON: ${err.message}\n\nRaw: ${raw.slice(0, 500)}`);
  }

  if (!Array.isArray(insights)) throw new Error('AI response is not a JSON array.');

  return insights;
}

const KPI_SYSTEM = `You are a PostgreSQL data analyst. Given a database schema, generate exactly 4 KPI metrics.
Each KPI must be a single aggregate SELECT query returning ONE row with ONE numeric value.
Return ONLY a valid JSON array. No markdown. No explanation.

OUTPUT FORMAT:
[
  {{ "label": "Total Orders", "icon": "🛒", "prefix": "", "suffix": "", "sql": "SELECT COUNT(*) AS value FROM schema.orders" }},
  {{ "label": "Total Revenue", "icon": "💰", "prefix": "$", "suffix": "", "sql": "SELECT ROUND(SUM(total_amount)::numeric, 2) AS value FROM schema.orders" }},
  {{ "label": "Total Customers", "icon": "👥", "prefix": "", "suffix": "", "sql": "SELECT COUNT(DISTINCT customer_id) AS value FROM schema.orders" }},
  {{ "label": "Avg Order Value", "icon": "📈", "prefix": "$", "suffix": "", "sql": "SELECT ROUND(AVG(total_amount)::numeric, 2) AS value FROM schema.orders" }}
]

RULES:
- Always alias the result column as "value"
- Always qualify table names with the schema prefix
- Use ROUND(...::numeric, 2) for decimal values
- Pick the 4 most meaningful metrics given the schema
- Icons must be emojis`;

const KPI_USER = `SCHEMA NAME: {dbSchema}
TABLES: {schema}
Generate 4 KPI metrics. Return ONLY the JSON array.`;

async function generateKPIs(schema, dbSchema = 'public') {
  const model = new ChatGroq({
    apiKey: process.env.GROQ_API_KEY,
    model: 'llama-3.3-70b-versatile',
    temperature: 0.1,
    maxTokens: 1024,
  });

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', KPI_SYSTEM],
    ['human', KPI_USER],
  ]);

  const tableList = [...new Set(
    schema.map((r) => {
      const cols = schema
        .filter((c) => c.table_name === r.table_name)
        .map((c) => `${c.column_name}:${c.data_type}`)
        .join(',');
      return `${r.table_name}(${cols})`;
    })
  )].join(' | ');

  const messages = await prompt.formatMessages({ dbSchema, schema: tableList });

  console.log('[KPI] Generating KPI queries...');
  const response = await Promise.race([
    model.invoke(messages),
    new Promise((_, reject) => setTimeout(() => reject(new Error('KPI timeout')), 30000)),
  ]);

  const raw = typeof response.content === 'string' ? response.content : String(response.content);
  const jsonStr = extractJSON(raw);

  try {
    const kpis = JSON.parse(jsonStr);
    console.log(`[KPI] Generated ${kpis.length} KPI queries`);
    return Array.isArray(kpis) ? kpis : [];
  } catch {
    console.warn('[KPI] Failed to parse KPI response, skipping.');
    return [];
  }
}

module.exports = { generateInsights, generateKPIs };
