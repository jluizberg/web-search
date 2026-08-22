const { query: dbQuery } = require('../../lib/db');
const { getClient } = require('../../lib/qdrant');
const { collectionName, embedText, stakeholderCollectionName } = require('./embeddings');
const { jsonrepair } = require('jsonrepair');

const ASK_SYSTEM_PROMPT = `You answer questions using retrieved article sources.
Return JSON only in this shape:
{"answer":"string","considerations":["string"],"source_numbers":[1,2]}
Answer only from the supplied sources. The considerations field must add useful caveats, disagreements, missing context, or follow-up angles grounded in the sources. Do not invent facts. source_numbers must contain the source numbers that support the answer.`;

function parseModelJson(content) {
  const normalized = content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/gi, '');
  try {
    return JSON.parse(normalized);
  } catch (error) {
    return JSON.parse(jsonrepair(normalized));
  }
}

async function getTopicCollections(config, topics) {
  if (topics.length) return [...new Set(topics.map(collectionName))];
  const collections = await getClient(config).getCollections();
  const stakeholder = stakeholderCollectionName(config);
  return collections.collections
    .map(collection => collection.name)
    .filter(name => name !== stakeholder);
}

async function retrieveSources(config, question, topics, limit) {
  const vector = await embedText(config, question);
  const client = getClient(config);
  const collections = await getTopicCollections(config, topics);
  const searches = await Promise.all(collections.map(async collection => {
    const result = await client.query(collection, {
      query: vector,
      limit,
      with_payload: true
    });
    return result.points.map(point => ({ ...point, collection }));
  }));

  const unique = new Map();
  for (const point of searches.flat()) {
    const articleId = point.payload?.article_id || point.id;
    const existing = unique.get(String(articleId));
    if (!existing || point.score > existing.score) unique.set(String(articleId), point);
  }
  return [...unique.values()].sort((left, right) => right.score - left.score).slice(0, limit);
}

async function generateAnswer(config, question, sources) {
  const numberedSources = sources.map((source, index) => ({
    number: index + 1,
    title: source.payload.title,
    url: source.payload.url,
    site: source.payload.site,
    content: source.payload.content
  }));
  const response = await fetch(config.DEEPSEEK_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: config.DEEPSEEK_MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: ASK_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify({ question, sources: numberedSources }) }
      ]
    })
  });
  if (!response.ok) throw new Error(`DeepSeek request failed with HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error('DeepSeek returned no answer');
  const generated = parseModelJson(content);
  return {
    answer: generated.answer || 'The sources do not provide enough information to answer this question.',
    considerations: Array.isArray(generated.considerations) ? generated.considerations : [],
    sourceNumbers: Array.isArray(generated.source_numbers) ? generated.source_numbers : []
  };
}

async function getStakeholderInvolvement(config, sources) {
  const articleIds = [...new Set(sources.map(source => source.payload?.article_id).filter(Boolean))];
  if (!articleIds.length) return { authors: [], stakeholders: [] };

  let authorKeys = new Set();
  try {
    const authorResult = await dbQuery(config, `
      SELECT source_stakeholder_id, target_article_id
      FROM stakeholder_relationships
      WHERE relationship_definition_id = $1
        AND target_article_id = ANY($2::uuid[])
        AND target_stakeholder_id IS NULL
    `, [config.AUTHOR_RELATIONSHIP_ID, articleIds]);
    authorKeys = new Set(authorResult.rows.map(row => `${row.source_stakeholder_id}|${row.target_article_id}`));
  } catch (error) {
    console.warn('Unable to identify article authors:', error.message);
  }

  const result = await dbQuery(config, `
    SELECT
      s.id,
      s.canonical_name,
      s.stakeholder_type,
      s.aliases,
      a.id AS article_id,
      a.title AS article_title,
      a.url AS article_url,
      ast.mention,
      ast.context,
      ast.confidence AS stakeholder_confidence,
      sr.rationale,
      sr.confidence AS relationship_confidence,
      sr.spectrum,
      sr.impact_polarity,
      sr.temporal_dimension,
      sr.non_human_stakeholder,
      sr.salience_dynamics,
      rd.name AS relationship
    FROM article_stakeholders ast
    JOIN stakeholders s ON s.id = ast.stakeholder_id
    JOIN articles a ON a.id = ast.article_id
    LEFT JOIN stakeholder_relationships sr
      ON sr.article_id = ast.article_id
     AND (sr.source_stakeholder_id = ast.stakeholder_id OR sr.target_stakeholder_id = ast.stakeholder_id)
    LEFT JOIN relationship_definitions rd ON rd.id = sr.relationship_definition_id
    WHERE ast.article_id = ANY($1::uuid[])
    ORDER BY s.canonical_name, a.published_at DESC NULLS LAST
  `, [articleIds]);

  const stakeholderIds = [...new Set(result.rows.map(row => row.id))];
  let profiles = [];
  try {
    profiles = await getClient(config).retrieve(stakeholderCollectionName(config), {
      ids: stakeholderIds,
      with_payload: true
    });
  } catch (error) {
    console.warn('Unable to retrieve stakeholder profiles from Qdrant:', error.message);
  }
  const profilesById = new Map(profiles.map(point => [String(point.payload?.stakeholder_id || point.id), point.payload?.profile || {}]));

  const authors = new Map();
  const stakeholders = new Map();
  for (const row of result.rows) {
    const isAuthor = authorKeys.has(`${row.id}|${row.article_id}`);
    const bucket = isAuthor ? authors : stakeholders;
    if (!bucket.has(row.id)) {
      bucket.set(row.id, {
        id: row.id,
        name: row.canonical_name,
        type: row.stakeholder_type,
        aliases: row.aliases || [],
        details: profilesById.get(String(row.id)) || {},
        involvements: []
      });
    }
    bucket.get(row.id).involvements.push({
      articleId: row.article_id,
      articleTitle: row.article_title,
      articleUrl: row.article_url,
      mention: row.mention,
      context: row.context,
      stakeholderConfidence: row.stakeholder_confidence,
      relationship: row.relationship,
      rationale: row.rationale,
      relationshipConfidence: row.relationship_confidence,
      spectrum: row.spectrum,
      impactPolarity: row.impact_polarity,
      temporalDimension: row.temporal_dimension,
      nonHumanStakeholder: row.non_human_stakeholder,
      salienceDynamics: row.salience_dynamics
    });
  }
  return { authors: [...authors.values()], stakeholders: [...stakeholders.values()] };
}

async function ask(config, question, options = {}) {
  const topics = Array.isArray(options.topics) ? options.topics.filter(Boolean) : [];
  const limit = Math.min(Math.max(Number(options.limit) || 8, 1), 20);
  const sources = await retrieveSources(config, question, topics, limit);
  if (!sources.length) {
    return { answer: 'No indexed articles were found for this question.', considerations: [], authors: [], stakeholders: [], sources: [] };
  }
  const generated = await generateAnswer(config, question, sources);
  const { authors, stakeholders } = await getStakeholderInvolvement(config, sources);
  return {
    question,
    answer: generated.answer,
    considerations: generated.considerations,
    authors,
    stakeholders,
    sources: sources.map((source, index) => ({
      number: index + 1,
      title: source.payload.title,
      url: source.payload.url,
      site: source.payload.site,
      score: Number(source.score?.toFixed?.(4) || source.score),
      cited: generated.sourceNumbers.includes(index + 1)
    }))
  };
}

async function listTopics(config) {
  const result = await dbQuery(config, 'SELECT topic FROM topic_reasonings WHERE active = TRUE ORDER BY topic');
  return result.rows.map(row => row.topic);
}

module.exports = { ask, getStakeholderInvolvement, listTopics, retrieveSources };
