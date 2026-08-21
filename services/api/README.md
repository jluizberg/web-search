# API Service

Express.js REST API for managing authors, targets, topics, and articles.

## Status

The RAG question endpoint is implemented and serves the dashboard UI.

## Planned endpoints

- `POST /authors`, `GET /authors`, `PUT /authors/:id`, `DELETE /authors/:id`
- `POST /targets`, `GET /targets`, `PUT /targets/:id`, `DELETE /targets/:id`
- `POST /topics`, `GET /topics`
- `GET /articles`, `GET /articles/:id`
- `GET /api/rag/topics` — list active topic filters
- `POST /api/rag/ask` — retrieve Qdrant sources and generate a grounded answer

## Configuration

Reads from `config.json` at the project root via `lib/config.js`.

## Running

```bash
node services/api/index.js
```

The API binds to `0.0.0.0` by default for remote access. Set `HOST` to a
specific interface when binding to all interfaces is not appropriate.

The `POST /api/rag/ask` response contains `answer`, `considerations`, and
numbered `sources`. The browser renders citations and references; all data
access and model calls remain behind the API.
