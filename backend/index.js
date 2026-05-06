require('dotenv').config();
const express = require('express');
const cors = require('cors');
const insightsRouter = require('./routes/insights');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: ['http://localhost:3000', 'http://127.0.0.1:3000'] }));
app.use(express.json({ limit: '10mb' }));

app.use('/api', insightsRouter);

app.get('/health', (_, res) => res.json({ status: 'ok' }));

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error.' });
});

const server = app.listen(PORT, () => {
  console.log(`Dashboard AI backend running on http://localhost:${PORT}`);
});

// Allow up to 90s for AI + query execution
server.setTimeout(90000);
