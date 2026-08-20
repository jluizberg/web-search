# API Service

Express.js REST API for managing authors, targets, topics, and articles.

## Status

Planned — not yet implemented.

## Planned endpoints

- `POST /authors`, `GET /authors`, `PUT /authors/:id`, `DELETE /authors/:id`
- `POST /targets`, `GET /targets`, `PUT /targets/:id`, `DELETE /targets/:id`
- `POST /topics`, `GET /topics`
- `GET /articles`, `GET /articles/:id`
- `POST /rag/ask` — RAG Q&A endpoint (planned)

## Configuration

Reads from `config.json` at the project root via `lib/config.js`.

## Running

```bash
node services/api/index.js
```
