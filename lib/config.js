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
    scraper: { manualMode: false, usePuppeteerSites: [] }
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
    USE_PUPPETEER_SITES
  };
}

module.exports = { loadConfig };
