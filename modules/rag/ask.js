const { query: dbQuery } = require('../../lib/db');
const { getClient } = require('../../lib/qdrant');
const { collectionName, embedText } = require('./embeddings');
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
  return collections.collections
    .map(collection => collection.name)
    .filter(name => name.startsWith('topic-'));
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

async function ask(config, question, options = {}) {
  const topics = Array.isArray(options.topics) ? options.topics.filter(Boolean) : [];
  const limit = Math.min(Math.max(Number(options.limit) || 8, 1), 20);
  const sources = await retrieveSources(config, question, topics, limit);
  if (!sources.length) {
    return { answer: 'No indexed articles were found for this question.', considerations: [], sources: [] };
  }
  const generated = await generateAnswer(config, question, sources);
  return {
    question,
    answer: generated.answer,
    considerations: generated.considerations,
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

module.exports = { ask, listTopics, retrieveSources };
