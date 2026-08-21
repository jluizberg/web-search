const express = require('express');
const path = require('path');
const { loadConfig } = require('../../lib/config');
const { ask, listTopics } = require('../../modules/rag/ask');

const app = express();
const config = loadConfig();
const port = Number(process.env.PORT || 4000);
const host = process.env.HOST || '0.0.0.0';

app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, '../dashboard')));

app.get('/api/health', (request, response) => response.json({ status: 'ok' }));

app.get('/api/rag/topics', async (request, response) => {
  try {
    response.json({ topics: await listTopics(config) });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.post('/api/rag/ask', async (request, response) => {
  const question = typeof request.body?.question === 'string' ? request.body.question.trim() : '';
  if (!question) return response.status(400).json({ error: 'question is required' });
  try {
    response.json(await ask(config, question, {
      topics: request.body.topics,
      limit: request.body.limit
    }));
  } catch (error) {
    console.error('RAG ask failed:', error.message);
    response.status(502).json({ error: error.message });
  }
});

app.listen(port, host, () => console.log(`Web Search API listening on http://${host}:${port}`));
