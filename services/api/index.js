const express = require('express');
const path = require('path');
const { loadConfig } = require('../../lib/config');
const { ask, listTopics } = require('../../modules/rag/ask');
const { query } = require('../../lib/db');

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

app.get('/api/stakeholder-definitions', async (request, response) => {
  try {
    const result = await query(config, 'SELECT id, definition, active, created_at, updated_at FROM stakeholder_definitions WHERE singleton_key = TRUE ORDER BY updated_at DESC LIMIT 1');
    response.json({ definition: result.rows[0] || null });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.post('/api/stakeholder-definitions', async (request, response) => {
  const definition = typeof request.body?.definition === 'string' ? request.body.definition.trim() : '';
  if (!definition) return response.status(400).json({ error: 'definition is required' });
  try {
    const result = await query(config, `
      INSERT INTO stakeholder_definitions (name, definition, singleton_key)
      VALUES ('default', $1, TRUE)
      ON CONFLICT (singleton_key) DO UPDATE SET definition = EXCLUDED.definition, active = TRUE, updated_at = NOW()
      RETURNING id, definition, active, created_at, updated_at
    `, [definition]);
    await query(config, `
      UPDATE articles
      SET stakeholder_status = 'pending', relationship_status = 'pending'
      WHERE title IS NOT NULL AND title <> '' AND content IS NOT NULL AND content <> ''
    `);
    response.status(201).json(result.rows[0]);
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.get('/api/stakeholders', async (request, response) => {
  try {
    const result = await query(config, `
      SELECT id, canonical_name, stakeholder_type, aliases, created_at, updated_at
      FROM stakeholders
      ORDER BY canonical_name
    `);
    response.json({ stakeholders: result.rows });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.get('/api/stakeholders/:id/articles', async (request, response) => {
  try {
    const result = await query(config, `
      SELECT a.id, a.title, a.url, a.site, a.published_at,
             ast.mention, ast.context, ast.confidence, ast.definition_id
      FROM article_stakeholders ast
      JOIN articles a ON a.id = ast.article_id
      WHERE ast.stakeholder_id = $1
      ORDER BY a.published_at DESC NULLS LAST, a.ingested_at DESC
    `, [request.params.id]);
    response.json({ articles: result.rows });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.get('/api/relationship-definitions', async (request, response) => {
  try {
    const result = await query(config, 'SELECT id, name, definition, active, created_at, updated_at FROM relationship_definitions ORDER BY name');
    response.json({ definitions: result.rows });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.post('/api/relationship-definitions', async (request, response) => {
  const name = typeof request.body?.name === 'string' ? request.body.name.trim() : '';
  const definition = typeof request.body?.definition === 'string' ? request.body.definition.trim() : '';
  if (!name || !definition) return response.status(400).json({ error: 'name and definition are required' });
  try {
    const result = await query(config, `
      INSERT INTO relationship_definitions (name, definition)
      VALUES ($1, $2)
      ON CONFLICT (name) DO UPDATE SET definition = EXCLUDED.definition, active = TRUE, updated_at = NOW()
      RETURNING id, name, definition, active, created_at, updated_at
    `, [name, definition]);
    await query(config, `UPDATE articles SET relationship_status = 'pending' WHERE title IS NOT NULL AND title <> '' AND content IS NOT NULL AND content <> ''`);
    response.status(201).json(result.rows[0]);
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});

app.get('/api/stakeholder-relationships', async (request, response) => {
  try {
    const result = await query(config, `
      SELECT sr.id, rd.name AS relationship, rd.definition,
             source.canonical_name AS source_stakeholder,
             target.canonical_name AS target_stakeholder,
             sr.rationale, sr.confidence, sr.spectrum, sr.impact_polarity,
             sr.temporal_dimension, sr.non_human_stakeholder,
             sr.salience_dynamics, sr.target_article_id, sr.article_id, a.title, a.url
      FROM stakeholder_relationships sr
      JOIN relationship_definitions rd ON rd.id = sr.relationship_definition_id
      JOIN stakeholders source ON source.id = sr.source_stakeholder_id
      JOIN stakeholders target ON target.id = sr.target_stakeholder_id
      JOIN articles a ON a.id = sr.article_id
      ORDER BY a.published_at DESC NULLS LAST, sr.created_at DESC
    `);
    response.json({ relationships: result.rows });
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
