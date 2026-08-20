const { discoverUrls } = require('./discovery');
const { scrapeArticle } = require('./scraper');
const { saveArticle, getPendingUrls, markEmbeddingStatus } = require('./storage');
const { loadConfig } = require('../../lib/config');

async function run() {
  const config = loadConfig();

  console.log('Starting article extractor pipeline...');

  // Step 1: Discovery - find new URLs from search targets
  await discoverUrls(config);

  // Step 2: Scrape pending URLs
  const pending = await getPendingUrls(config);
  console.log(`Found ${pending.length} pending articles to scrape`);

  for (const row of pending) {
    try {
      console.log(`Scraping ${row.url}`);
      const article = await scrapeArticle(row.url);
      article.topic = row.topic || article.topic;
      const id = await saveArticle(config, article);
      await markEmbeddingStatus(config, id, 'pending');
      console.log(`Saved article: ${article.title}`);
    } catch (err) {
      console.error(`Error processing ${row.url}:`, err.message);
    }
  }

  console.log('Article extractor pipeline completed');
}

module.exports = { run };

if (require.main === module) {
  run().catch(err => {
    console.error('Article extractor pipeline failed:', err.message);
    process.exitCode = 1;
  });
}
