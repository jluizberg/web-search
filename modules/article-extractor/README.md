# Article Extractor Module

Discovers, scrapes, classifies, and stores web articles into PostgreSQL and Qdrant.

## Sub-modules

| Sub-module | Responsibility |
|------------|----------------|
| [discovery](discovery/README.md) | Find article URLs from search targets |
| [scraper](scraper/README.md) | Fetch and parse article content |
| [classifier](classifier/README.md) | Topic classification (rule-based -> ML) |
| [storage](storage/README.md) | Postgres inserts/updates |
| index.js | Orchestrator: runs discovery -> scrape -> classify -> store |

## Data Flow

```
search_keywords and search_targets (Postgres)
        |
        v
  discovery: find URLs
        |
        v
  articles (Postgres) with embedding_status='pending'
        |
        v
  scraper: fetch + parse content
        |
        v
  classifier: assign topic
        |
        v
  storage: save article
        |
        v
  embedding (separate job): vector -> Qdrant
```

## Usage

### As a standalone module

```bash
node modules/article-extractor/index.js
```

### Scheduled via cron

```bash
# Every 30 minutes
*/30 * * * * node /path/to/modules/article-extractor/index.js
```

### Programmatic

```js
const { run } = require('./modules/article-extractor');
await run();
```

## Configuration

Reads from `config.json` at the project root. Key settings:

- `discovery.tavilyApiKey` — Tavily search API key
- `discovery.googleApiKey` / `discovery.googleCx` — Google Custom Search
- `scheduler.scrapingInterval` — cron expression for scraping
- `scraper.usePuppeteerSites` — list of domains requiring headless browser
- `translation.enabled` — detect and translate non-English articles
- `translation.endpoint` — LibreTranslate `/translate` endpoint
- `translation.targetLanguage` — target language, usually `en`
- `search_keywords` — global discovery keywords shared by every site
- `search_targets` — sites to scan; topics are assigned after scraping/classification

## Dependencies

- `axios` — HTTP requests
- `cheerio` — HTML parsing
- `puppeteer` — JS-heavy site rendering
- `pg` — PostgreSQL client
- `@qdrant/js-client-rest` — Qdrant client
- `node-cron` — scheduling

## Database Schema

Requires these tables in PostgreSQL:

```sql
CREATE TABLE search_keywords (
      id BIGSERIAL PRIMARY KEY,
      keyword TEXT NOT NULL UNIQUE,
      created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE search_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site TEXT NOT NULL,
  frequency_minutes INT DEFAULT 60,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT UNIQUE NOT NULL,
  site TEXT NOT NULL,
  author TEXT,
  title TEXT,
  content TEXT,
  raw_html TEXT,
      topic TEXT,
  published_at TIMESTAMP,
  ingested_at TIMESTAMP DEFAULT NOW(),
  embedding_status TEXT DEFAULT 'pending'
);

CREATE INDEX idx_articles_topic ON articles(topic);
CREATE INDEX idx_articles_site ON articles(site);

CREATE TABLE inspected_pages (
      url TEXT PRIMARY KEY,
      site TEXT NOT NULL,
      inspected_at TIMESTAMP DEFAULT NOW(),
      status TEXT DEFAULT 'in_progress',
      matched BOOLEAN DEFAULT FALSE,
      status_code INT,
      error TEXT
);

CREATE INDEX idx_inspected_pages_site ON inspected_pages(site);
```

The homepage discovery provider records every inspected URL in
`inspected_pages` and skips it on later runs.

### Translation setup

Install the new dependency after pulling the change:

```bash
npm install
```

Run LibreTranslate locally, for example with Docker:

```bash
docker run --rm -p 5000:5000 libretranslate/libretranslate
```

The scraper detects the source language with `franc-min`. When it is not
English, it sends the title and content to LibreTranslate, stores the English
translation in `title` and `content`, and preserves the source text in
`original_title` and `original_content`.

## Testing

```bash
# Run discovery only
node -e "require('./modules/article-extractor/discovery').discoverUrls(require('../lib/config').loadConfig())"

# Run scraper on a single URL
node -e "require('./modules/article-extractor/scraper').scrapeArticle('https://example.com/article')"
```
