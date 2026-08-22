const { getClient } = require('../lib/qdrant');
const { loadConfig } = require('../lib/config');
const { query } = require('../lib/db');
const { getArticleRelations } = require('../modules/rag/embeddings');

const config = loadConfig();
const client = getClient(config);
const COLLECTION = 'geopolitics';

(async () => {
  let offset = null;
  let updated = 0;
  do {
    const page = await client.scroll(COLLECTION, {
      limit: 100,
      offset: offset ?? undefined,
      with_payload: true,
      with_vector: false
    });
    const points = page.points;
    for (const point of points) {
      const articleId = point.payload?.article_id;
      if (!articleId) continue;
      const relations = await getArticleRelations(config, articleId);
      await client.setPayload(COLLECTION, {
        payload: {
          authors: relations.authors,
          stakeholders: relations.stakeholders
        },
        points: [point.id]
      });
      updated += 1;
      console.log(`updated ${point.id} (${relations.authors.length} authors, ${relations.stakeholders.length} stakeholders)`);
    }
    offset = page.next_page_offset ?? null;
    if (!points.length) break;
  } while (offset !== null);
  console.log(`Backfill complete: ${updated} points updated`);
  process.exit(0);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
