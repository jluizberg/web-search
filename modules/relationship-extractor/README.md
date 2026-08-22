# Relationship Extractor Module

Extracts stakeholders from article text using one user-defined definition, then enriches each new stakeholder from web search with DeepSeek.

## Status

Implemented in `index.js`. The `stakeholder_definitions` table is a singleton
configuration table. Its one active definition is sent to DeepSeek with each
eligible article. New entities are inserted into `stakeholders`, researched
through web search, and consolidated profile information is embedded and saved
as a payload in the Qdrant `stakeholders` collection, keyed by stakeholder ID.
For non-English articles, the stakeholder name is translated to English for
the canonical record and vector profile; the original-language name is kept in
the stakeholder aliases.
Every article relationship is stored in
`article_stakeholders`, including mention, context, and confidence.

Relationship definitions are maintained in `relationship_definitions`. Each
active definition is evaluated after stakeholder extraction. Valid directed
relationships are stored in `stakeholder_relationships` with source and target
stakeholder IDs, article ID, rationale, confidence, and five AI-classified text
dimensions:

- `spectrum` — explicit, latent, or another precise classification
- `impact_polarity` — positive, negative, mixed, neutral, or another precise classification
- `temporal_dimension` — past, present, future, or another precise classification
- `non_human_stakeholder` — non-human involvement, or `none`
- `salience_dynamics` — power, legitimacy, and urgency as one concise string

All five dimensions are extracted from and supported by the article.

Example relationship definition:

```json
{
  "name": "funds",
  "definition": "Stakeholder A provides financial resources to stakeholder B."
}
```

Create a definition through the API:

```http
POST /api/stakeholder-definitions
Content-Type: application/json
```

```json
{
  "definition": "A stakeholder is any person or private or public organization involved in, affected by, influencing, or mentioned in the article."
}
```

The endpoint replaces the single configured definition; it does not create a
second definition record.

Run extraction with the normal RAG command:

```bash
node modules/rag/index.js
```

## Planned structure

```
relationship-extractor/
  rules/           # CRUD for relationship type definitions
  extractor/       # LLM prompt + JSON parsing
  storage/         # entity + relationship persistence
  index.js         # orchestrator
```

## Planned inputs

- `stakeholder_definitions` — user-defined identification rules
- `articles` with translated `content` ready for analysis

## Planned outputs

- `stakeholders` — deduplicated people and organizations
- `article_stakeholders` — mentions, context, confidence, and source links

## Dependencies (planned)

- Ollama or OpenRouter client for LLM inference
- JSON schema validation for structured extraction
