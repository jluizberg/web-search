const { loadConfig } = require('../../lib/config');
const { processPendingArticles } = require('./processor');

async function run() {
  const result = await processPendingArticles(loadConfig());
  console.log(`Processing completed: ${result.processed} articles processed, ${result.matched} topic matches, ${result.stakeholders} stakeholder mentions, ${result.authors} authorships, ${result.relationships} relationships`);
}

module.exports = { run };

if (require.main === module) {
  run().catch(error => {
    console.error('Reasoning pipeline failed:', error.message);
    process.exitCode = 1;
  });
}