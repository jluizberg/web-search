const { QdrantClient } = require('@qdrant/js-client-rest');

let client = null;

function getClient(config) {
  if (!client) {
    client = new QdrantClient({
      url: config.QDRANT_URL,
      apiKey: config.QDRANT_API_KEY || undefined
    });
  }
  return client;
}

module.exports = { getClient };
