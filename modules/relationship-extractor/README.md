# Relationship Extractor Module

Extracts entities and relationships from article text using LLM-based analysis guided by user-defined relationship rules.

## Status

Planned — not yet implemented.

## Planned structure

```
relationship-extractor/
  rules/           # CRUD for relationship type definitions
  extractor/       # LLM prompt + JSON parsing
  storage/         # entity + relationship persistence
  index.js         # orchestrator
```

## Planned inputs

- `entity_types` table — categories like `person`, `organization`, `location`
- `relationship_types` table — user-defined rules with direction and description
- `articles` with `content` ready for analysis

## Planned outputs

- `entities` — extracted mentions with article/source context
- `relationships` — extracted links between entities

## Dependencies (planned)

- Ollama or OpenRouter client for LLM inference
- JSON schema validation for structured extraction
