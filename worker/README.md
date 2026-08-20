# Worker

Scheduled job runner for modules.

## Status

Planned — not yet implemented.

## Planned jobs

- Article extraction pipeline (discovery -> scrape -> classify -> store)
- Embedding generation
- Relationship extraction
- RAG index refresh

## Planned scheduling

Uses `node-cron` or system cron. Intervals defined in `config.json`:
- `scheduler.discoveryInterval`
- `scheduler.scrapingInterval`
- `scheduler.embeddingInterval`

## Running

```bash
node worker/index.js
```
