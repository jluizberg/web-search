# Storage

Persists articles to PostgreSQL.

## Usage

```js
const { saveArticle, markEmbeddingStatus, getPendingUrls } = require('./storage');
const config = require('../../lib/config').loadConfig();

const articleId = await saveArticle(config, article);
await markEmbeddingStatus(config, articleId, 'pending');
const pending = await getPendingUrls(config);
```

## Functions

### `saveArticle(config, article) -> id`

- `INSERT ... ON CONFLICT (url) DO UPDATE`
- Sets `embedding_status = 'pending'` on conflict
- Returns the article UUID

### `markEmbeddingStatus(config, id, status)`

- Updates `embedding_status` to `pending`, `done`, or `failed`

### `getPendingUrls(config) -> rows`

- Returns articles where `title IS NULL OR content IS NULL OR title = ''`
- Used by the scraper to find articles needing content

## Database

Requires the `articles` table defined in the parent module README.

## Error handling

Database errors are thrown to the caller. The orchestrator logs them without stopping the pipeline.
