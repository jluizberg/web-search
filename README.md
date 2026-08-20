# Web Search

A modular Docker-based system for discovering, scraping, storing, and analyzing web articles with vector search and relationship extraction.

## Architecture

The project is organized into independent modules that can be developed and tested separately, then combined into a single Docker image.

```
lib/                    # Shared utilities
  config.js             # Configuration loader (config.json + env overrides)
  db.js                 # PostgreSQL connection pool
  qdrant.js             # Qdrant client singleton

modules/
  article-extractor/    # Part 1: discover, scrape, classify, store articles
    discovery/          # Find article URLs from search targets
    scraper/            # Fetch and parse article content
    classifier/         # Topic classification (rule-based -> ML)
    storage/            # Postgres inserts/updates
    index.js            # Orchestrator pipeline
  relationship-extractor/ # Entity/relationship extraction via LLM
  rag/                  # Retrieval-augmented Q&A

services/
  api/                  # Express REST API
  dashboard/            # React + Vite admin UI

worker/                 # Scheduled job runner
entrypoints/            # Single-container entrypoints
```

## Modules

| Module | Description | Status |
|--------|-------------|--------|
| [article-extractor](modules/article-extractor/README.md) | Discover, scrape, classify, and store articles | In development |
| [relationship-extractor](modules/relationship-extractor/README.md) | Entity and relationship extraction from articles | Planned |
| [rag](modules/rag/README.md) | Retrieval-augmented Q&A over stored articles | Planned |

## Quick Start

```bash
# Build the single container image
docker compose build

# Start all services
docker compose up -d

# Access points
# Dashboard: http://localhost:3000
# API: http://localhost:3000/api
```

## Configuration

Edit `config.json` at the project root. See [lib/config.js](lib/config.js) for all available options.

Key sections:
- `postgres` — database connection
- `qdrant` — vector database connection
- `discovery` — search API keys
- `scheduler` — cron intervals
- `scraper` — scraping behavior

## Database Setup

After creating the PostgreSQL database and configuring the connection, run the
schema script once:

```bash
psql "$POSTGRES_URL" -v ON_ERROR_STOP=1 -f scripts/database.sql
```

The script creates the `search_targets` and `articles` tables, the required
`pgcrypto` extension, and the article indexes. It is safe to run again.

Qdrant is configured separately in `config.json`; this script does not create
a Qdrant collection.

## Development

Each module can be developed independently:

```bash
# Install shared dependencies used by lib/
npm install

# Install article-extractor dependencies
cd modules/article-extractor
npm install
cd ../..

# Test article extractor
node modules/article-extractor/index.js

# Run API locally
node services/api/index.js
```

## License

MIT
