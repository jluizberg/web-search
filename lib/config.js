const fs = require('fs');
const path = require('path');

function loadConfig() {
  const configPath = path.join(__dirname, '..', 'config.json');
  const defaults = {
    postgres: { host: 'localhost', port: 5432, user: 'postgres', password: 'postgres', database: 'websearch' },
    qdrant: { url: 'http://qdrant:6333', apiKey: '' },
    discovery: { provider: 'homepage', tavilyApiKey: '', googleApiKey: '', googleCx: '' },
    translation: { enabled: true, endpoint: 'https://translator.intra.jbdesign.com.br/translate', targetLanguage: 'en', apiKey: '' },
    scheduler: { discoveryInterval: '0 */6 * * *', scrapingInterval: '*/30 * * * *', embeddingInterval: '*/30 * * * *' },
    scraper: { manualMode: false, usePuppeteerSites: [] },
    reasoning: { enabled: false, endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat', apiKey: '' },
    embedding: { model: 'BAAI/bge-m3', vectorSize: 1024 },
    stakeholder: { authorRelationshipId: '', collectionName: 'stakeholders' }
  };

  let fileConfig = {};
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    fileConfig = JSON.parse(raw);
  } catch (err) {
    console.warn('config.json not found, using defaults and env vars');
  }

  const env = process.env;
  const pgCfg = fileConfig.postgres || defaults.postgres;
  const qdrantCfg = fileConfig.qdrant || defaults.qdrant;
  const discovery = { ...defaults.discovery, ...(fileConfig.discovery || {}) };
  const translation = { ...defaults.translation, ...(fileConfig.translation || {}) };
  const scheduler = { ...defaults.scheduler, ...(fileConfig.scheduler || {}) };
  const scraper = { ...defaults.scraper, ...(fileConfig.scraper || {}) };
  const reasoning = { ...defaults.reasoning, ...(fileConfig.reasoning || {}) };
  const embedding = { ...defaults.embedding, ...(fileConfig.embedding || {}) };
  const stakeholder = { ...defaults.stakeholder, ...(fileConfig.stakeholder || {}) };

  const POSTGRES_URL = env.POSTGRES_URL ||
    `postgres://${encodeURIComponent(env.POSTGRES_USER || pgCfg.user)}:${encodeURIComponent(env.POSTGRES_PASSWORD || pgCfg.password)}@${env.POSTGRES_HOST || pgCfg.host}:${env.POSTGRES_PORT || pgCfg.port}/${env.POSTGRES_DB || pgCfg.database}`;
  const QDRANT_URL = env.QDRANT_URL || qdrantCfg.url;
  const QDRANT_API_KEY = env.QDRANT_API_KEY || qdrantCfg.apiKey;
  const TAVILY_API_KEY = env.TAVILY_API_KEY || discovery.tavilyApiKey;
  const GOOGLE_API_KEY = env.GOOGLE_API_KEY || discovery.googleApiKey;
  const GOOGLE_CX = env.GOOGLE_CX || discovery.googleCx;
  const DISCOVERY_PROVIDER = String(env.DISCOVERY_PROVIDER || discovery.provider || 'homepage').toLowerCase();
  const TRANSLATION_ENABLED = String(env.TRANSLATION_ENABLED ?? translation.enabled).toLowerCase() === 'true';
  const TRANSLATION_ENDPOINT = env.TRANSLATION_ENDPOINT || translation.endpoint;
  const TRANSLATION_TARGET_LANGUAGE = env.TRANSLATION_TARGET_LANGUAGE || translation.targetLanguage;
  const TRANSLATION_API_KEY = env.TRANSLATION_API_KEY || translation.apiKey || '';
  const DISCOVERY_INTERVAL = env.DISCOVERY_INTERVAL || scheduler.discoveryInterval;
  const SCRAPING_INTERVAL = env.SCRAPING_INTERVAL || scheduler.scrapingInterval;
  const EMBEDDING_INTERVAL = env.EMBEDDING_INTERVAL || scheduler.embeddingInterval;
  const MANUAL_MODE = String(env.MANUAL_MODE ?? scraper.manualMode).toLowerCase() === 'true';
  const USE_PUPPETEER_SITES = Array.isArray(scraper.usePuppeteerSites) ? scraper.usePuppeteerSites : [];
  const REASONING_ENABLED = String(env.REASONING_ENABLED ?? reasoning.enabled).toLowerCase() === 'true';
  const DEEPSEEK_ENDPOINT = env.DEEPSEEK_ENDPOINT || reasoning.endpoint;
  const DEEPSEEK_MODEL = env.DEEPSEEK_MODEL || reasoning.model;
  const DEEPSEEK_API_KEY = env.DEEPSEEK_API_KEY || reasoning.apiKey || '';
  const EMBEDDING_MODEL = env.EMBEDDING_MODEL || embedding.model;
  const EMBEDDING_VECTOR_SIZE = Number(env.EMBEDDING_VECTOR_SIZE || embedding.vectorSize || 1024);
  const AUTHOR_RELATIONSHIP_ID = env.AUTHOR_RELATIONSHIP_ID || stakeholder.authorRelationshipId;
  const STAKEHOLDER_COLLECTION = env.STAKEHOLDER_COLLECTION || stakeholder.collectionName || 'stakeholders';

  return {
    POSTGRES_URL,
    QDRANT_URL,
    QDRANT_API_KEY,
    TAVILY_API_KEY,
    GOOGLE_API_KEY,
    GOOGLE_CX,
    DISCOVERY_PROVIDER,
    TRANSLATION_ENABLED,
    TRANSLATION_ENDPOINT,
    TRANSLATION_TARGET_LANGUAGE,
    TRANSLATION_API_KEY,
    DISCOVERY_INTERVAL,
    SCRAPING_INTERVAL,
    EMBEDDING_INTERVAL,
    MANUAL_MODE,
    USE_PUPPETEER_SITES,
    REASONING_ENABLED,
    DEEPSEEK_ENDPOINT,
    DEEPSEEK_MODEL,
    DEEPSEEK_API_KEY,
    EMBEDDING_MODEL,
    EMBEDDING_VECTOR_SIZE,
    AUTHOR_RELATIONSHIP_ID,
    STAKEHOLDER_COLLECTION
  };
}

module.exports = { loadConfig };
