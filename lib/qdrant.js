const { QdrantClient } = require('@qdrant/js-client-rest');

let client = null;

function getClient(config) {
  if (!client) {
    const endpoint = new URL(config.QDRANT_URL);
    client = new QdrantClient({
      host: endpoint.hostname,
      port: Number(endpoint.port) || (endpoint.protocol === 'https:' ? 443 : 6333),
      https: endpoint.protocol === 'https:',
      apiKey: config.QDRANT_API_KEY || undefined,
      checkCompatibility: false
    });
  }
  return client;
}

module.exports = { getClient };
