function classifyTopic(title, content, site) {
  const text = `${title} ${content}`.toLowerCase();
  const siteLower = (site || '').toLowerCase();

  const geopoliticalSites = ['reuters.com', 'apnews.com', 'bbc.com', 'cnn.com', 'nytimes.com', 'washingtonpost.com', 'theguardian.com', 'aljazeera.com', 'foreignpolicy.com', 'foreignaffairs.com'];
  const itSecuritySites = ['krebsonsecurity.com', 'schneier.com', 'darkreading.com', 'threatpost.com', 'bleepingcomputer.com', 'cisa.gov', 'mitre.org'];
  const aiSites = ['openai.com', 'anthropic.com', 'deepmind.google', 'arxiv.org', 'huggingface.co', 'techcrunch.com/category/artificial-intelligence'];

  if (geopoliticalSites.some(s => siteLower.includes(s))) return 'geopolitics';
  if (itSecuritySites.some(s => siteLower.includes(s))) return 'it_security';
  if (aiSites.some(s => siteLower.includes(s))) return 'ai';

  const keywords = {
    geopolitics: ['war', 'conflict', 'treaty', 'sanctions', 'diplomat', 'government', 'election', 'military', 'un', 'nato', 'putin', 'biden', 'xi jinping', 'foreign policy', 'border', 'sovereignty'],
    it_security: ['malware', 'ransomware', 'vulnerability', 'exploit', 'cve', 'hack', 'breach', 'phishing', 'zero-day', 'security patch', 'cyber', 'apt', 'siem', 'firewall'],
    ai: ['machine learning', 'deep learning', 'neural network', 'llm', 'gpt', 'transformer', 'artificial intelligence', 'generative ai', 'diffusion', 'reinforcement learning', 'openai', 'anthropic'],
    technology: ['software', 'hardware', 'startup', 'saas', 'cloud', 'api', 'database', 'javascript', 'python', 'programming'],
    business: ['stock', 'market', 'revenue', 'ipo', 'merger', 'acquisition', 'ceo', 'earnings', 'economy', 'inflation']
  };

  let bestTopic = 'general';
  let bestScore = 0;

  for (const [topic, words] of Object.entries(keywords)) {
    let score = 0;
    for (const word of words) {
      if (text.includes(word)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestTopic = topic;
    }
  }

  return bestTopic;
}

module.exports = { classifyTopic };
