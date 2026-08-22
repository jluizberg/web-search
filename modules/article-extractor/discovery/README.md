# Discovery

Finds article URLs from configured search targets using search APIs.

## Usage

```js
const { discoverUrls } = require('./discovery');
const config = require('../../lib/config').loadConfig();

await discoverUrls(config);
```

## How it works

1. Reads search terms from `topic_reasonings`, authors from `search_authors`, and sites from `search_targets`
2. Each active `topic_reasonings` row contributes two collections of double-quoted strings (space separated):
   - `search_names` — matched exactly as written (searched as quoted phrases)
   - `search_keywords` — partial matches allowed (searched as plain terms)
3. For each target, calls the configured homepage crawler, sitemap crawler, DuckDuckGo, GDELT, Tavily, or Google Custom Search
4. Inserts every discovered URL into `articles` with `topic` unset and `embedding_status='pending'`

Author searches are broad and site-independent. Each canonical author name and
each value in `search_authors.variations` is searched separately with every
search term. Matching result URLs are queued using their hostname as the
article site. DuckDuckGo is tried first, with GDELT as a fallback.
5. Skips URLs already present (unique constraint on `articles.url`)

## Configuration

- `discovery.provider` — `homepage` (free and keyless), `sitemap`, `duckduckgo`, `gdelt`, `tavily`, or `google`
- `discovery.tavilyApiKey` — required when using Tavily
- `discovery.googleApiKey` + `discovery.googleCx` — required when using Google

The homepage provider is the default and requires no API key. It reads links
from the site's main page and captures every same-site candidate; topic
classification happens after scraping. The sitemap provider
is useful for sites with large or incomplete homepages. DuckDuckGo and GDELT
are also keyless alternatives.

## Search terms format

In `topic_reasonings`, both `search_names` and `search_keywords` are JSON arrays
of strings:

```sql
-- exact name matches
UPDATE topic_reasonings
SET search_names = '["European Central Bank", "Federal Reserve"]'::jsonb
WHERE topic = 'Geopolitics';

-- partial keyword matches (e.g. "climate finance" also matches "climate finances")
UPDATE topic_reasonings
SET search_keywords = '["climate finance", "green bonds"]'::jsonb
WHERE topic = 'Geopolitics';
```

## Output

Inserts into `articles`:
- `id` — generated UUID
- `url` — discovered URL
- `site` — from search target
- `topic` — from search target
- `embedding_status` — `pending`

## Error handling

Failed targets are logged but do not stop the job. Network timeouts are 30s.
