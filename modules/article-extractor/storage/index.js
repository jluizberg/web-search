const { query } = require('../../../lib/db');

async function saveArticle(config, article) {
  const sql = `
    INSERT INTO articles (id, url, site, author, title, content, original_title, original_content, language, raw_html, topic, published_at)
    VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (url) DO UPDATE SET
      title = EXCLUDED.title,
      content = EXCLUDED.content,
      original_title = EXCLUDED.original_title,
      original_content = EXCLUDED.original_content,
      language = EXCLUDED.language,
      raw_html = EXCLUDED.raw_html,
      topic = EXCLUDED.topic,
      published_at = EXCLUDED.published_at
    RETURNING id
  `;
  const values = [
    article.url, article.site, article.author, article.title,
    article.content, article.original_title, article.original_content,
    article.language, article.raw_html, article.topic, article.published_at
  ];
  const result = await query(config, sql, values);
  return result.rows[0].id;
}

async function markEmbeddingStatus(config, id, status) {
  await query(config, 'UPDATE articles SET embedding_status = $1 WHERE id = $2', [status, id]);
}

async function getPendingUrls(config) {
  const result = await query(
    config,
    "SELECT id, url, site, topic FROM articles WHERE title IS NULL OR content IS NULL OR title = ''"
  );
  return result.rows;
}

module.exports = { saveArticle, markEmbeddingStatus, getPendingUrls };
