const { query } = require('../../lib/db');
const { EmbeddingModelError, indexArticle } = require('./embeddings');
const { jsonrepair } = require('jsonrepair');

class DeepSeekAccessError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'DeepSeekAccessError';
    this.status = status;
  }
}

const SYSTEM_PROMPT = `You classify news articles against user-authored topic reasoning.
Return JSON only, with this exact shape:
{"matches":[{"topic":"string","reasoning_id":"uuid","matches":true,"explanation":"string"}]}
Include one item for every supplied reasoning. Set matches to true only when the article materially matches the reasoning, not merely because it contains a related keyword.`;

function buildPrompt(article, reasonings) {
  return `${SYSTEM_PROMPT}\nThe title and content below are the canonical English version prepared by the extractor.\n\nREASONINGS:\n${JSON.stringify(reasonings)}\n\nARTICLE:\n${JSON.stringify({
    title: article.title,
    site: article.site,
    url: article.url,
    content: article.content
  })}`;
}

async function analyzeArticle(config, article, reasonings) {
  const response = await fetch(config.DEEPSEEK_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: config.DEEPSEEK_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildPrompt(article, reasonings) }
      ]
    })
  });

  if (!response.ok) {
    const responseText = await response.text();
    let providerMessage = responseText;
    try {
      providerMessage = JSON.parse(responseText).error?.message || responseText;
    } catch (error) {
      // Keep the raw response when the provider does not return JSON.
    }
    const message = `DeepSeek request failed with HTTP ${response.status}: ${providerMessage}`;
    if ([401, 402, 403].includes(response.status)) {
      throw new DeepSeekAccessError(response.status, message);
    }
    throw new Error(message);
  }
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error('DeepSeek returned no analysis');
  const normalizedContent = content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/gi, '');
  try {
    return JSON.parse(normalizedContent);
  } catch (error) {
    try {
      return JSON.parse(jsonrepair(normalizedContent));
    } catch (repairError) {
      throw new Error(`DeepSeek returned invalid analysis JSON: ${repairError.message}`);
    }
  }
}

async function getActiveReasonings(config) {
  const result = await query(config, `
    SELECT id, topic, reasoning
    FROM topic_reasonings
    WHERE active = TRUE
    ORDER BY topic
  `);
  return result.rows;
}

async function getPendingArticles(config) {
  const result = await query(config, `
    SELECT id, url, site, title, content
    FROM articles
    WHERE reasoning_status IN ('pending', 'error')
      AND title IS NOT NULL AND title <> ''
      AND content IS NOT NULL AND content <> ''
    ORDER BY ingested_at
  `);
  return result.rows;
}

async function saveAnalysis(config, article, analysis, reasonings) {
  const reasoningsById = new Map(reasonings.map(reasoning => [String(reasoning.id), reasoning]));
  const matches = (analysis.matches || [])
    .filter(item => item.matches === true && reasoningsById.has(String(item.reasoning_id)))
    .map(item => ({
      ...item,
      reasoning_id: String(item.reasoning_id),
      topic: reasoningsById.get(String(item.reasoning_id)).topic
    }));
  const reasoningIds = matches.map(item => item.reasoning_id);
  await query(config, `
    UPDATE articles
    SET reasoning_status = 'analyzed',
        matched_reasoning_ids = $1,
        reasoning_result = $2
    WHERE id = $3
  `, [reasoningIds, analysis, article.id]);
  return matches;
}

async function markEmbeddingStatus(config, articleId, status) {
  await query(config, 'UPDATE articles SET embedding_status = $1 WHERE id = $2', [status, articleId]);
}

async function processPendingArticles(config) {
  if (!config.REASONING_ENABLED) return { processed: 0, matched: 0 };
  if (!config.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY is required when reasoning is enabled');

  const reasonings = await getActiveReasonings(config);
  if (!reasonings.length) return { processed: 0, matched: 0 };

  const articles = await getPendingArticles(config);
  let matched = 0;
  for (const article of articles) {
    try {
      const analysis = await analyzeArticle(config, article, reasonings);
      const matches = await saveAnalysis(config, article, analysis, reasonings);
      if (!matches.length) {
        await markEmbeddingStatus(config, article.id, 'skipped');
        continue;
      }
      matched += await indexArticle(config, article, matches);
      await markEmbeddingStatus(config, article.id, 'done');
    } catch (error) {
      if (error instanceof DeepSeekAccessError) {
        console.error(error.message);
        throw error;
      }
      if (error instanceof EmbeddingModelError) {
        console.error(error.message);
        throw error;
      }
      await query(config, `UPDATE articles SET reasoning_status = 'error', embedding_status = 'failed', reasoning_result = $1 WHERE id = $2`, [{ error: error.message }, article.id]);
      console.error(`Reasoning failed for ${article.url}:`, error.message);
    }
  }
  return { processed: articles.length, matched };
}

module.exports = { analyzeArticle, processPendingArticles };