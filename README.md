# AI Dashboard Generator

An AI-powered full-stack dashboard that connects to any PostgreSQL database, extracts the schema, generates business insights using LLaMA 3 (via Groq), executes the SQL queries, and renders interactive ECharts visualizations.

## Stack

| Layer     | Technology                          |
|-----------|-------------------------------------|
| Backend   | Node.js + Express                   |
| AI        | LangChain + Groq (llama3-70b-8192)  |
| Database  | PostgreSQL (any DB via conn string) |
| Frontend  | React + ECharts                     |

## Prerequisites

- Node.js 18+
- A PostgreSQL database
- Free Groq API key → https://console.groq.com

## Setup

### 1. Backend

```bash
cd dashboard-ai/backend
npm install
```

Edit `.env`:
```
GROQ_API_KEY=your_key_from_console.groq.com
PORT=5000
```

```bash
npm run dev       # development (nodemon)
# or
npm start         # production
```

### 2. Frontend

```bash
cd dashboard-ai/frontend
npm install
npm start         # runs on http://localhost:3000
```

## Usage

1. Open `http://localhost:3000`
2. Paste your PostgreSQL connection string:
   ```
   postgresql://user:password@localhost:5432/mydb
   ```
3. Click **Generate Dashboard**
4. Wait 15–30 seconds while the AI:
   - Reads your schema from `information_schema.columns`
   - Reads column stats from `pg_stats`
   - Calls LLaMA 3 to generate 5–7 insights + SQL + ECharts configs
   - Executes each SELECT query against your database
   - Injects real data into charts
5. Explore your interactive dashboard

## API Endpoints

### `POST /api/connect`
```json
{ "connectionString": "postgresql://..." }
```
Returns `{ schema, profile }`.

### `POST /api/insights`
```json
{ "connectionString": "...", "schema": [...], "profile": [...] }
```
Returns `{ insights: [...] }` — each with `title`, `description`, `sql`, `echartsConfig` (with real data injected).

## Security

- Only `SELECT` queries are permitted — enforced in `dbService.runQuery()`
- Connection strings are never stored (in-memory per request only)
- CORS restricted to `localhost:3000`

## Project Structure

```
dashboard-ai/
├── backend/
│   ├── index.js                  # Express app entry
│   ├── routes/insights.js        # /connect and /insights endpoints
│   ├── services/
│   │   ├── dbService.js          # PostgreSQL schema/profile/query helpers
│   │   └── aiService.js          # LangChain + Groq chain
│   ├── .env                      # GROQ_API_KEY, PORT
│   └── package.json
└── frontend/
    ├── public/index.html
    └── src/
        ├── App.jsx
        ├── index.js
        ├── components/
        │   ├── ConnectionForm.jsx # DB connection input UI
        │   ├── ChartCard.jsx      # ECharts chart renderer
        │   └── Loader.jsx         # Animated progress overlay
        └── pages/
            └── Dashboard.jsx      # Orchestrates fetch + renders grid
```
