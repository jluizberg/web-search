# RAG Module

Retrieval-augmented Q&A over stored articles using vector search and an LLM.

## Processing status

The first processing stage is implemented in `processor.js`. It reads active
reasonings from `topic_reasonings`, sends the translated English article text
to DeepSeek for classification, and stores the decision in
`articles.reasoning_result`.

Run it with:

```bash
node modules/rag/index.js
```

Each matched topic gets its own Qdrant collection. The article is embedded
once with local `BAAI/bge-m3` and upserted into every matched collection.
Collection names are deterministic, so reprocessing updates the same points.

The first BGE-M3 run downloads the model from Hugging Face and may take time.

## Asking questions

The API endpoint `POST /api/rag/ask` embeds the question, searches all topic
collections by default, deduplicates articles, and asks DeepSeek for a grounded
answer plus additional considerations. The response includes numbered sources.
The dashboard at the API root renders linked citations and supports browser
print-to-PDF. The UI does not access Qdrant or DeepSeek directly.

Add a reasoning with SQL:

```sql
INSERT INTO topic_reasonings (topic, reasoning)
VALUES ('critical infrastructure', 'Investigate reporting about ...')
ON CONFLICT (topic) DO UPDATE
SET reasoning = EXCLUDED.reasoning, active = TRUE, updated_at = NOW();
```

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
- LLM endpoint (DeepSeek API)
- Local embedding model (`BAAI/bge-m3`)

## Planned outputs

- Answer text with citations
- Source articles used

## Dependencies (planned)

- `@qdrant/js-client-rest`
- `@huggingface/transformers`
