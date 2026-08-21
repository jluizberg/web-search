const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const { franc } = require('franc-min');
const { loadConfig } = require('../../../lib/config');
const { getPendingUrls, saveArticle } = require('../storage');
const { classifyTopic } = require('../classifier');

let config = null;

function getConfig() {
  if (!config) {
    config = loadConfig();
  }
  return config;
}

const languageMap = {
  ara: 'ar', ces: 'cs', deu: 'de', ell: 'el', eng: 'en', fra: 'fr',
  ita: 'it', jpn: 'ja', kor: 'ko', nld: 'nl', pol: 'pl', por: 'pt',
  ron: 'ro', rus: 'ru', spa: 'es', swe: 'sv', tur: 'tr', ukr: 'uk',
  zho: 'zh'
};

function detectLanguage(text) {
  if (!text || text.trim().length < 20) return 'und';
  return franc(text.slice(0, 10000));
}

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

async function translateText(cfg, text, sourceLanguage) {
  if (!cfg.TRANSLATION_ENABLED || !text || sourceLanguage === 'eng') return text;
  const source = languageMap[sourceLanguage] || 'auto';
  const response = await axios.post(cfg.TRANSLATION_ENDPOINT, {
    q: text,
    source,
    target: cfg.TRANSLATION_TARGET_LANGUAGE,
    format: 'text',
    ...(cfg.TRANSLATION_API_KEY ? { api_key: cfg.TRANSLATION_API_KEY } : {})
  }, { timeout: 60000 });
  return response.data.translatedText || text;
}

async function translateArticle(cfg, article) {
  const language = detectLanguage(article.content);
  if (!cfg.TRANSLATION_ENABLED || language === 'eng' || language === 'und') {
    return { ...article, language, original_title: article.title, original_content: article.content };
  }

  try {
    const [title, content] = await Promise.all([
      translateText(cfg, article.title, language),
      translateText(cfg, article.content, language)
    ]);
    console.log(`Translated ${article.url} from ${language} to ${cfg.TRANSLATION_TARGET_LANGUAGE}`);
    return {
      ...article,
      title,
      content,
      language,
      original_title: article.title,
      original_content: article.content
    };
  } catch (err) {
    console.warn(`Translation failed for ${article.url}; keeping original text:`, err.message);
    return { ...article, language, original_title: article.title, original_content: article.content };
  }
}

async function scrapeWithAxios(url) {
  const response = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ArticleScraper/1.0)' },
    timeout: 30000
  });
  const html = response.data;
  const $ = cheerio.load(html);

  const jsonLdAuthors = [];
  $('script[type="application/ld+json"]').each((index, element) => {
    try {
      const data = JSON.parse($(element).contents().text());
      const entries = Array.isArray(data) ? data : [data];
      for (const entry of entries) {
        const authors = Array.isArray(entry.author) ? entry.author : [entry.author];
        for (const author of authors) {
          const name = typeof author === 'string' ? author : author?.name;
          if (name) jsonLdAuthors.push(name.trim());
        }
      }
    } catch (err) {
      // Ignore malformed JSON-LD and continue with HTML metadata.
    }
  });

  $('script, style, nav, header, footer, aside, iframe, noscript').remove();

  const title = $('h1').first().text().trim() || $('title').text().trim();
  const content = $('article, main, .post-content, .entry-content, .content').first().text().trim()
    || $('body').text().trim().slice(0, 50000);

  const author = jsonLdAuthors[0]
    || $('meta[name="author"], meta[property="article:author"]').first().attr('content')
    || $('[rel="author"], .author, .byline, [itemprop="author"]').first().text().trim();
  const publishedAt = $('meta[property="article:published_time"], meta[name="published"], time[datetime]').first().attr('content')
    || $('time').first().attr('datetime');

  return { title, content, author, published_at: publishedAt };
}

async function scrapeWithPuppeteer(url) {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (compatible; ArticleScraper/1.0)');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    await page.waitForTimeout(2000);

    const data = await page.evaluate(() => {
      const jsonLdAuthors = [];
      document.querySelectorAll('script[type="application/ld+json"]').forEach(element => {
        try {
          const parsed = JSON.parse(element.textContent);
          const entries = Array.isArray(parsed) ? parsed : [parsed];
          entries.forEach(entry => {
            const authors = Array.isArray(entry.author) ? entry.author : [entry.author];
            authors.forEach(author => {
              const name = typeof author === 'string' ? author : author?.name;
              if (name) jsonLdAuthors.push(name.trim());
            });
          });
        } catch (err) {
          // Ignore malformed JSON-LD and continue with HTML metadata.
        }
      });
      document.querySelectorAll('script, style, nav, header, footer, aside, iframe, noscript').forEach(el => el.remove());
      const title = document.querySelector('h1')?.textContent?.trim() || document.title;
      const content = document.querySelector('article, main, .post-content, .entry-content, .content')?.textContent?.trim()
        || document.body.textContent.trim().slice(0, 50000);
      const author = jsonLdAuthors[0]
        || document.querySelector('meta[name="author"], meta[property="article:author"]')?.getAttribute('content')
        || document.querySelector('[rel="author"], .author, .byline, [itemprop="author"]')?.textContent?.trim()
        || '';
      const publishedAt = document.querySelector('meta[property="article:published_time"], meta[name="published"], time[datetime]')?.getAttribute('content')
        || document.querySelector('time')?.getAttribute('datetime') || '';
      return { title, content, author, publishedAt };
    });

    return data;
  } finally {
    await browser.close();
  }
}

async function scrapeArticle(url) {
  const cfg = getConfig();
  const site = new URL(url).hostname.replace(/^www\./, '');
  const usePuppeteer = cfg.USE_PUPPETEER_SITES.some(s => site.includes(s));

  let result;
  try {
    if (usePuppeteer) {
      result = await scrapeWithPuppeteer(url);
    } else {
      result = await scrapeWithAxios(url);
    }
  } catch (err) {
    console.error(`Failed to scrape ${url}:`, err.message);
    throw err;
  }

  if (countWords(result.content || '') <= 50) {
    throw new Error(`Article text has ${countWords(result.content || '')} words; at least 51 are required`);
  }

  const translated = await translateArticle(cfg, { ...result, url, site });
  const topic = classifyTopic(translated.title, translated.content, site);

  return {
    url,
    site,
    title: translated.title,
    content: translated.content,
    original_title: translated.original_title,
    original_content: translated.original_content,
    language: translated.language,
    author: translated.author || null,
    topic,
    published_at: (result.publishedAt || result.published_at) ? new Date(result.publishedAt || result.published_at) : null,
  };
}

async function scrapePending() {
  const cfg = getConfig();
  const pending = await getPendingUrls(cfg);
  const results = [];

  for (const row of pending) {
    try {
      console.log(`Scraping ${row.url}`);
      const article = await scrapeArticle(row.url);
      article.topic = row.topic || article.topic;
      const id = await saveArticle(cfg, article);
      results.push({ url: row.url, id, title: article.title });
      console.log(`Saved article: ${article.title}`);
    } catch (err) {
      console.error(`Scraping error for ${row.url}:`, err.message);
    }
  }

  return results;
}

module.exports = { scrapeArticle, scrapePending };
