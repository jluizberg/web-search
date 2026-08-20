# Discovery

Finds article URLs from configured search targets using search APIs.

## Usage

```js
const { discoverUrls } = require('./discovery');
const config = require('../../lib/config').loadConfig();

await discoverUrls(config);
```

## How it works

1. Reads global keywords from `search_keywords` and sites from `search_targets`
2. For each target, calls the configured homepage crawler, sitemap crawler, DuckDuckGo, GDELT, Tavily, or Google Custom Search
3. Inserts every discovered URL into `articles` with `topic` unset and `embedding_status='pending'`
4. Skips URLs already present (unique constraint on `articles.url`)

## Configuration

- `discovery.provider` — `homepage` (free and keyless), `sitemap`, `duckduckgo`, `gdelt`, `tavily`, or `google`
- `discovery.tavilyApiKey` — required when using Tavily
- `discovery.googleApiKey` + `discovery.googleCx` — required when using Google

The homepage provider is the default and requires no API key. It reads links
from the site's main page and captures every same-site candidate; topic
classification happens after scraping. The sitemap provider
is useful for sites with large or incomplete homepages. DuckDuckGo and GDELT
are also keyless alternatives.

## Output

Inserts into `articles`:
- `id` — generated UUID
- `url` — discovered URL
- `site` — from search target
- `topic` — from search target
- `embedding_status` — `pending`

## Error handling

Failed targets are logged but do not stop the job. Network timeouts are 30s.
