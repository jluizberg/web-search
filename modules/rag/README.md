# RAG Module

Retrieval-augmented Q&A over stored articles using vector search and an LLM.

## Status

Planned — not yet implemented.

## Planned structure

```
rag/
  retriever/       # Qdrant vector search
  generator/       # LLM prompt assembly + inference
  api/             # REST endpoints for questions
  index.js         # orchestrator
```

## Planned inputs

- User question (text)
- Qdrant collection per topic
- LLM endpoint (Ollama or API)

## Planned outputs

- Answer text with citations
- Source articles used

## Dependencies (planned)

- `@qdrant/js-client-rest`
- Ollama client or OpenRouter client
