const axios = require('axios');
const { query } = require('../../../lib/db');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getGlobalKeywords(config) {
  const result = await query(config, 'SELECT keyword FROM search_keywords ORDER BY id');
  return result.rows.map(row => row.keyword).filter(Boolean);
}

async function getInspectedUrls(config, site) {
  const result = await query(config, 'SELECT url FROM inspected_pages WHERE site = $1', [site]);
  return new Set(result.rows.map(row => row.url));
}

async function claimPage(config, site, url) {
  const result = await query(
    config,
    `INSERT INTO inspected_pages (url, site)
     VALUES ($1, $2)
     ON CONFLICT (url) DO NOTHING
     RETURNING url`,
    [url, site]
  );
  return result.rowCount > 0;
}

async function finishPage(config, url, status, matched, statusCode, error) {
  await query(
    config,
    `UPDATE inspected_pages
     SET inspected_at = NOW(), status = $2, matched = $3, status_code = $4, error = $5
     WHERE url = $1`,
    [url, status, matched, statusCode || null, error || null]
  );
}

async function searchGdelt(target) {
  const keywords = target.keywords.join(' ');
  const params = {
    query: `${keywords} domain:${target.site}`,
    mode: 'artlist',
    format: 'json',
    maxrecords: 10,
    sort: 'datedesc',
    timespan: '1year'
  };

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await axios.get('https://api.gdeltproject.org/api/v2/doc/doc', {
        params,
        timeout: 30000
      });
      return response.data.articles?.map(article => article.url).filter(Boolean) || [];
    } catch (err) {
      if (err.response?.status !== 429 || attempt === 2) {
        throw err;
      }
      console.warn('GDELT rate limit reached; waiting 15 seconds before retrying...');
      await delay(15000);
    }
  }
}

async function searchDuckDuckGo(target) {
  const cheerio = require('cheerio');
  const urls = [];
  const site = target.site.replace(/^www\./i, '');
  const keywordQuery = target.keywords.join(' ');
  const searchTerms = [`"${keywordQuery}"`, keywordQuery];

  for (const terms of searchTerms) {
    const response = await axios.get('https://html.duckduckgo.com/html/', {
      params: { q: `${terms} site:${site}` },
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ArticleExtractor/1.0)' },
      timeout: 30000
    });
    const $ = cheerio.load(response.data);

    $('.result__a').each((index, element) => {
      const href = $(element).attr('href');
      if (!href) return;
      try {
        const parsed = new URL(href, 'https://html.duckduckgo.com');
        const targetUrl = parsed.searchParams.get('uddg') || parsed.href;
        if (targetUrl.startsWith('http')) urls.push(targetUrl);
      } catch (err) {
        return;
      }
    });

    await delay(2000);
  }

  return [...new Set(urls)];
}

async function getSitemapUrls(site) {
  const base = `https://${site.replace(/^www\./i, '')}`;
  const robots = await axios.get(`${base}/robots.txt`, { timeout: 30000 });
  const sitemapUrls = [...robots.data.matchAll(/^sitemap:\s*(\S+)/gim)].map(match => match[1]);
  if (sitemapUrls.length === 0) sitemapUrls.push(`${base}/sitemap.xml`);

  const urls = [];
  const pending = sitemapUrls.slice(0, 5);
  while (pending.length > 0 && urls.length < 100) {
    const sitemapUrl = pending.shift();
    const response = await axios.get(sitemapUrl, { timeout: 30000 });
    const cheerio = require('cheerio');
    const $ = cheerio.load(response.data, { xmlMode: true });
    const locations = $('loc').map((index, element) => $(element).text().trim()).get();

    if ($('sitemapindex').length > 0) {
      pending.push(...locations.filter(url => url.endsWith('.xml')).slice(0, 5));
    } else {
      urls.push(...locations.filter(url => {
        try {
          return new URL(url).hostname.replace(/^www\./i, '') === site.replace(/^www\./i, '');
        } catch (err) {
          return false;
        }
      }));
    }
  }

  return [...new Set(urls)].slice(0, 100);
}

async function searchSitemap(target) {
  const cheerio = require('cheerio');
  const candidates = await getSitemapUrls(target.site);
  return candidates;
}

async function searchHomepage(config, target) {
  const cheerio = require('cheerio');
  const site = target.site.replace(/^www\./i, '');
  const homepage = `https://${site}/`;
  const response = await axios.get(homepage, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ArticleExtractor/1.0)' },
    timeout: 30000,
    maxContentLength: 5 * 1024 * 1024
  });
  const $ = cheerio.load(response.data);
  const candidates = [];
  $('a[href]').each((index, element) => {
    try {
      const url = new URL($(element).attr('href'), homepage);
      const host = url.hostname.replace(/^www\./i, '');
      const isAsset = /\.(css|gif|ico|jpe?g|js|json|png|svg|webp|xml|zip)$/i.test(url.pathname);
      if ((url.protocol === 'http:' || url.protocol === 'https:') && host === site && url.pathname !== '/' && !isAsset) {
        url.hash = '';
        candidates.push(url.href);
      }
    } catch (err) {
      return;
    }
  });

  const uniqueCandidates = [...new Set(candidates)].slice(0, 200);
  const inspectedUrls = await getInspectedUrls(config, target.site);
  const pendingCandidates = uniqueCandidates.filter(url => !inspectedUrls.has(url));
  console.log(`Inspecting ${pendingCandidates.length} new homepage link(s) for ${target.site}; skipped ${uniqueCandidates.length - pendingCandidates.length}`);

  for (const url of pendingCandidates) {
    if (!await claimPage(config, target.site, url)) continue;
    try {
      const page = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ArticleExtractor/1.0)' },
        timeout: 30000,
        maxContentLength: 5 * 1024 * 1024
      });
      await finishPage(config, url, 'completed', true, page.status);
    } catch (err) {
      console.warn(`Unable to inspect ${url}:`, err.message);
      await finishPage(config, url, 'failed', false, err.response?.status, err.message);
    }
    await delay(250);
  }

  return pendingCandidates;
}

async function discoverUrls(config) {
  console.log('Running discovery job...');
  const provider = config.DISCOVERY_PROVIDER || 'homepage';
  if (!['homepage', 'sitemap', 'duckduckgo', 'gdelt', 'tavily', 'google'].includes(provider)) {
    throw new Error(`Unsupported discovery provider: ${provider}`);
  }
  if (provider === 'tavily' && !config.TAVILY_API_KEY) {
    throw new Error('Tavily provider selected but TAVILY_API_KEY is empty.');
  }
  if (provider === 'google' && !(config.GOOGLE_API_KEY && config.GOOGLE_CX)) {
    throw new Error('Google provider selected but GOOGLE_API_KEY or GOOGLE_CX is empty.');
  }

  const [targetResult, keywords] = await Promise.all([
    query(config, 'SELECT id, site FROM search_targets ORDER BY site'),
    getGlobalKeywords(config)
  ]);
  const targets = targetResult.rows.map(target => ({ ...target, keywords }));
  console.log(`Found ${targets.length} search target(s)`);
  if (targets.length === 0) {
    console.warn('No search targets configured. Add sites to search_targets first.');
    return;
  }

  for (const target of targets) {
    try {
      let urls = [];
      if (provider === 'gdelt') urls = await searchGdelt(target);
      else if (provider === 'duckduckgo') urls = await searchDuckDuckGo(target);
      else if (provider === 'sitemap') urls = await searchSitemap(target);
      else if (provider === 'homepage') urls = await searchHomepage(config, target);
      else if (provider === 'tavily') {
        const response = await axios.post('https://api.tavily.com/search', {
          api_key: config.TAVILY_API_KEY,
          query: target.keywords.join(' '),
          search_depth: 'advanced',
          max_results: 10,
          include_domains: [target.site]
        }, { timeout: 30000 });
        urls = response.data.results.map(result => result.url);
      } else if (provider === 'google') {
        const response = await axios.get('https://www.googleapis.com/customsearch/v1', {
          params: { key: config.GOOGLE_API_KEY, cx: config.GOOGLE_CX, q: `${target.keywords.join(' ')} site:${target.site}` }
        });
        urls = response.data.items?.map(item => item.link) || [];
      }

      for (const url of urls) {
        await query(
          config,
          `INSERT INTO articles (id, url, site) VALUES (gen_random_uuid(), $1, $2) ON CONFLICT (url) DO NOTHING`,
          [url, target.site]
        );
      }
      console.log(`Discovered ${urls.length} URLs for ${target.site}`);
      if (['gdelt', 'duckduckgo', 'sitemap', 'homepage'].includes(provider)) await delay(5000);
    } catch (err) {
      const status = err.response?.status;
      const suffix = status === 429 ? ` ${provider} is rate-limiting requests; wait before retrying.` : '';
      console.error(`Discovery error for target ${target.id}:`, `${err.message}.${suffix}`);
    }
  }
}

module.exports = { discoverUrls };
