# Classifier

Assigns a topic label to an article based on its title, content, and source site.

## Usage

```js
const { classifyTopic } = require('./classifier');

const topic = classifyTopic(title, content, site);
// => 'geopolitics' | 'it_security' | 'ai' | 'technology' | 'business' | 'general'
```

## Current implementation (rule-based)

1. **Site whitelist** — known sites are mapped directly:
   - `reuters.com`, `apnews.com`, `bbc.com`, `cnn.com`, `nytimes.com`, `washingtonpost.com`, `theguardian.com`, `aljazeera.com`, `foreignpolicy.com`, `foreignaffairs.com` → `geopolitics`
   - `krebsonsecurity.com`, `schneier.com`, `darkreading.com`, `threatpost.com`, `bleepingcomputer.com`, `cisa.gov`, `mitre.org` → `it_security`
   - `openai.com`, `anthropic.com`, `deepmind.google`, `arxiv.org`, `huggingface.co` → `ai`

2. **Keyword scoring** — counts keyword hits in `title + content` for each topic

3. **Fallback** — `general` if no topic scores above 0

## Planned: ML classifier

- Replace keyword scoring with a local transformer classifier
- Keep site whitelist as pre-filter
- Output same topic strings for backward compatibility
- Configurable model path in `config.json`

## Supported topics

| Topic | Example keywords |
|-------|------------------|
| geopolitics | war, conflict, treaty, sanctions, diplomat, election, military |
| it_security | malware, ransomware, vulnerability, exploit, cve, hack, breach |
| ai | machine learning, deep learning, llm, gpt, transformer, generative ai |
| technology | software, hardware, startup, saas, cloud, api, database |
| business | stock, market, revenue, ipo, merger, acquisition, ceo |
| general | default fallback |

## Extending

Add new topics by updating the `keywords` object in `classifier/index.js`. For ML-based classification, update the model loading logic.
