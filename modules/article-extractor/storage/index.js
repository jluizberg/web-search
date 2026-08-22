const { query } = require('../../../lib/db');

async function saveArticle(config, article) {
  const sql = `
    INSERT INTO articles (id, url, site, title, content, language, published_at)
    VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
    ON CONFLICT (url) DO UPDATE SET
      title = EXCLUDED.title,
      content = EXCLUDED.content,
      language = EXCLUDED.language,
      published_at = EXCLUDED.published_at,
      stakeholder_status = 'pending',
      relationship_status = 'pending'
    RETURNING id
  `;
  const values = [
    article.url, article.site, article.title,
    article.content, article.language, article.published_at
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
    "SELECT id, url, site FROM articles WHERE title IS NULL OR content IS NULL OR title = ''"
  );
  return result.rows;
}

module.exports = { saveArticle, markEmbeddingStatus, getPendingUrls };
