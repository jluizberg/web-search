const crypto = require('crypto');
const { pipeline } = require('@huggingface/transformers');
const { getClient } = require('../../lib/qdrant');

const VECTOR_SIZE = 1024;
let extractor = null;

class EmbeddingModelError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EmbeddingModelError';
  }
}

async function getExtractor(config) {
  if (!extractor) {
    try {
      extractor = await pipeline('feature-extraction', config.EMBEDDING_MODEL, { dtype: 'fp32' });
    } catch (error) {
      throw new EmbeddingModelError(`Unable to initialize ${config.EMBEDDING_MODEL}: ${error.message}`);
    }
  }
  return extractor;
}

function collectionName(topic) {
  const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'general';
  const hash = crypto.createHash('sha1').update(topic).digest('hex').slice(0, 10);
  return `topic-${slug}-${hash}`;
}

async function embedText(config, text) {
  const model = await getExtractor(config);
  const output = await model(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

async function ensureCollection(client, name) {
  const collections = await client.getCollections();
  if (collections.collections.some(collection => collection.name === name)) return;
  await client.createCollection(name, {
    vectors: { size: VECTOR_SIZE, distance: 'Cosine' }
  });
}

async function indexArticle(config, article, matches) {
  const vector = await embedText(config, `${article.title}\n\n${article.content}`);
  if (vector.length !== VECTOR_SIZE) {
    throw new Error(`Embedding model returned ${vector.length} dimensions; expected ${VECTOR_SIZE}`);
  }

  const client = getClient(config);
  for (const match of matches) {
    const collection = collectionName(match.topic);
    await ensureCollection(client, collection);
    await client.upsert(collection, {
      wait: true,
      points: [{
        id: article.id,
        vector,
        payload: {
          article_id: article.id,
          topic: match.topic,
          reasoning_id: match.reasoning_id,
          reasoning_explanation: match.explanation || null,
          url: article.url,
          site: article.site,
          title: article.title,
          content: article.content
        }
      }]
    });
  }
  return matches.length;
}

module.exports = { EmbeddingModelError, collectionName, embedText, indexArticle };