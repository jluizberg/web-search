const { query } = require('../../lib/db');
const { pipeline } = require('@huggingface/transformers');
const { getClient } = require('../../lib/qdrant');

const VECTOR_SIZE = 1024;
let extractor = null;

function vectorSize(config) {
  return config?.EMBEDDING_VECTOR_SIZE || VECTOR_SIZE;
}

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
  return slug;
}

function stakeholderCollectionName(config) {
  return config?.STAKEHOLDER_COLLECTION || 'stakeholders';
}

async function embedText(config, text) {
  const model = await getExtractor(config);
  const output = await model(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

async function ensureCollection(config, name) {
  const client = getClient(config);
  const collections = await client.getCollections();
  if (collections.collections.some(collection => collection.name === name)) return;
  await client.createCollection(name, {
    vectors: { size: vectorSize(config), distance: 'Cosine' }
  });
}

async function getArticleRelations(config, articleId) {
  const [authors, stakeholders] = await Promise.all([
    query(config, `
      SELECT s.id AS stakeholder_id, s.canonical_name, s.stakeholder_type
      FROM stakeholder_relationships sr
      JOIN stakeholders s ON s.id = sr.source_stakeholder_id
      WHERE sr.target_article_id = $1
        AND sr.target_stakeholder_id IS NULL
        AND sr.relationship_definition_id = $2
      ORDER BY s.canonical_name
    `, [articleId, config.AUTHOR_RELATIONSHIP_ID]),
    query(config, `
      SELECT s.id AS stakeholder_id, s.canonical_name, s.stakeholder_type, ast.mention, ast.confidence
      FROM article_stakeholders ast
      JOIN stakeholders s ON s.id = ast.stakeholder_id
      WHERE ast.article_id = $1
      ORDER BY s.canonical_name
    `, [articleId])
  ]);
  return {
    authors: authors.rows,
    stakeholders: stakeholders.rows
  };
}

async function indexArticle(config, article, matches) {
  const vector = await embedText(config, `${article.title}\n\n${article.content}`);
  if (vector.length !== vectorSize(config)) {
    throw new Error(`Embedding model returned ${vector.length} dimensions; expected ${vectorSize(config)}`);
  }

  let relations = { authors: [], stakeholders: [] };
  try {
    relations = await getArticleRelations(config, article.id);
  } catch (error) {
    console.warn(`Unable to load authors/stakeholders for ${article.url}:`, error.message);
  }

  const client = getClient(config);
  for (const match of matches) {
    const collection = collectionName(match.topic);
    await ensureCollection(config, collection);
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
          content: article.content,
          authors: relations.authors,
          stakeholders: relations.stakeholders
        }
      }]
    });
    console.log(`[embed] ${article.url} -> upserted vector (${vector.length} dims) into collection "${collection}" with ${relations.authors.length} author(s), ${relations.stakeholders.length} stakeholder(s)`);
  }
  return matches.length;
}

async function indexStakeholderProfile(config, stakeholder, profile, webResults) {
  const profileText = [
    stakeholder.canonical_name,
    stakeholder.stakeholder_type,
    profile.summary,
    ...(profile.roles || []),
    ...(profile.aliases || [])
  ].filter(Boolean).join('\n');
  const vector = await embedText(config, profileText);
  const client = getClient(config);
  const collection = stakeholderCollectionName(config);
  await ensureCollection(config, collection);
  await client.upsert(collection, {
    wait: true,
    points: [{
      id: stakeholder.id,
      vector,
      payload: {
        stakeholder_id: stakeholder.id,
        canonical_name: stakeholder.canonical_name,
        stakeholder_type: stakeholder.stakeholder_type,
        profile,
        web_sources: webResults
      }
    }]
  });
}

async function getStakeholderProfile(config, stakeholderId) {
  try {
    const points = await getClient(config).retrieve(stakeholderCollectionName(config), {
      ids: [stakeholderId],
      with_payload: true
    });
    return points[0]?.payload?.profile || null;
  } catch (error) {
    if (error.status === 404 || /not found/i.test(error.message || '')) return null;
    throw error;
  }
}

module.exports = { EmbeddingModelError, collectionName, embedText, getArticleRelations, getStakeholderProfile, indexArticle, indexStakeholderProfile, stakeholderCollectionName };