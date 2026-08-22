const axios = require('axios');
const { query } = require('../../../lib/db');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseStringCollection(value) {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(item => String(item).trim()).filter(Boolean);
    } catch (err) {
      return value.split(',').map(item => item.trim()).filter(Boolean);
    }
  }
  return [];
}

async function getTopicSearchTerms(config) {
  const result = await query(config, `
    SELECT topic, search_names, search_keywords
    FROM topic_reasonings
    WHERE active = TRUE
    ORDER BY topic
  `);
  const names = [];
  const keywords = [];
  const seenNames = new Set();
  const seenKeywords = new Set();
  for (const row of result.rows) {
    for (const name of parseStringCollection(row.search_names)) {
      if (!seenNames.has(name)) {
        seenNames.add(name);
        names.push(name);
      }
    }
    for (const keyword of parseStringCollection(row.search_keywords)) {
      if (!seenKeywords.has(keyword)) {
        seenKeywords.add(keyword);
        keywords.push(keyword);
      }
    }
  }
  return { names, keywords };
}

async function getGlobalAuthors(config) {
  const result = await query(config, 'SELECT id, author, variations FROM search_authors ORDER BY id');
  return result.rows;
}

async function enrichAuthorProfiles(config, authors) {
  const { enrichAuthorStakeholder } = require('../../relationship-extractor');
  for (let index = 0; index < authors.length; index += 1) {
    const author = authors[index];
    console.log(`[discovery] Enriching author ${index + 1}/${authors.length}: ${author.author}`);
    try {
      const wikipedia = await fetchWikipediaSummary(author.author);
      if (wikipedia) {
        await query(
          config,
          `UPDATE search_authors
           SET profile_url = COALESCE(NULLIF(profile_url, ''), $2),
               metadata = metadata || $3::jsonb
           WHERE id = $1`,
          [author.id, wikipedia.profileUrl || null, JSON.stringify({ wikipedia })]
        );
        console.log(`[discovery]   wikipedia summary found for ${author.author}`);
      }
      const stakeholderId = await enrichAuthorStakeholder(config, { ...author, biography: wikipedia?.summary });
      if (stakeholderId) {
        await query(config, `UPDATE search_authors SET metadata = metadata || $2::jsonb WHERE id = $1`, [author.id, JSON.stringify({ stakeholder_id: stakeholderId })]);
      }
    } catch (err) {
      console.warn(`Unable to enrich author ${author.author}:`, err.message);
    }
    await delay(2000);
  }
}

async function fetchWikipediaSummary(name) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const searchResponse = await axios.get('https://en.wikipedia.org/w/api.php', {
        params: { action: 'query', list: 'search', srsearch: name, srlimit: 1, format: 'json' },
        headers: { 'User-Agent': 'ArticleExtractor/1.0' },
        timeout: 15000
      });
      const title = searchResponse.data.query?.search?.[0]?.title;
      const normalizeName = value => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (!title || normalizeName(title) !== normalizeName(name)) return null;
      const response = await axios.get(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
        { headers: { 'User-Agent': 'ArticleExtractor/1.0' }, timeout: 15000 }
      );
      const summary = response.data.extract;
      const profileUrl = response.data.content_urls?.desktop?.page;
      if (!summary && !profileUrl) return null;
      return { title, summary, profileUrl };
    } catch (err) {
      if (err.response?.status === 429 && attempt < 3) {
        console.warn(`Wikipedia rate limited for "${name}"; retrying in ${attempt * 10} seconds...`);
        await delay(attempt * 10000);
        continue;
      }
      throw err;
    }
  }
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

function targetSearchTerms(target) {
  return [
    ...target.names.map(name => `"${name}"`),
    ...target.keywords
  ];
}

async function searchGdelt(target) {
  const query = targetSearchTerms(target).join(' ');
  const params = {
    query: `${query} domain:${target.site}`,
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
  const searchTerms = targetSearchTerms(target);

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

async function searchAuthors(authors, names, keywords) {
  const cheerio = require('cheerio');
  const urls = [];
  const searchTerms = [
    ...names.map(name => `"${name}"`),
    ...keywords
  ].filter(Boolean);
  const fallback = searchTerms.length > 0 ? searchTerms : [''];

  for (const author of authors) {
    for (const keyword of fallback) {
      const queryText = [`"${author}"`, keyword].filter(Boolean).join(' ');
      const response = await axios.get('https://html.duckduckgo.com/html/', {
        params: { q: queryText },
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
  }

  return [...new Set(urls)];
}

async function searchAuthorsGdelt(authors, names, keywords) {
  const urls = [];
  const queries = [
    ...names.map(name => `"${name}"`),
    ...keywords
  ].filter(Boolean);
  const fallback = queries.length > 0 ? queries : [''];
  for (const author of authors) {
    for (const keyword of fallback) {
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          const response = await axios.get('https://api.gdeltproject.org/api/v2/doc/doc', {
            params: {
              query: [`"${author}"`, keyword].filter(Boolean).join(' '),
              mode: 'artlist',
              format: 'json',
              maxrecords: 50,
              sort: 'datedesc',
              timespan: '5years'
            },
            timeout: 30000
          });
          urls.push(...(response.data.articles || []).map(article => article.url).filter(Boolean));
          break;
        } catch (err) {
          if (err.response?.status === 429 && attempt === 1) {
            console.warn(`GDELT rate limit for ${author}; retrying in 15 seconds...`);
            await delay(15000);
            continue;
          }
          console.warn(`Unable to search GDELT for ${author}:`, err.message);
          break;
        }
      }
    }
  }
  return [...new Set(urls)];
}

function getSiteFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch (err) {
    return null;
  }
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
  console.log(`[discovery] ${target.site}: found ${uniqueCandidates.length} link(s), ${pendingCandidates.length} new to inspect`);

  for (const url of pendingCandidates) {
    if (!await claimPage(config, target.site, url)) continue;
    try {
      const page = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ArticleExtractor/1.0)' },
        timeout: 30000,
        maxContentLength: 5 * 1024 * 1024
      });
      await finishPage(config, url, 'completed', true, page.status);
      console.log(`  [discovery] inspected (${page.status}) ${url}`);
    } catch (err) {
      console.warn(`  [discovery] failed (${err.response?.status || 'ERR'}) ${url}:`, err.message);
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

  const [targetResult, searchTerms, authors] = await Promise.all([
    query(config, 'SELECT id, site FROM search_targets ORDER BY site'),
    getTopicSearchTerms(config),
    getGlobalAuthors(config)
  ]);
  const { names, keywords } = searchTerms;
  const targets = targetResult.rows.map(target => ({ ...target, names, keywords }));
  await enrichAuthorProfiles(config, authors);
  const authorNames = authors.flatMap(author => [author.author, ...(author.variations || [])]).filter(Boolean);
  console.log(`Found ${targets.length} search target(s)`);
  console.log(`Topic search terms: ${names.length} exact name(s), ${keywords.length} partial keyword(s)`);
  if (targets.length === 0) {
    console.warn('No search targets configured. Add sites to search_targets first.');
  }

  if (authorNames.length > 0) {
    try {
      let authorUrls = await searchAuthors(authorNames, names, keywords);
      if (authorUrls.length === 0) {
        console.warn('DuckDuckGo returned no author results; trying GDELT.');
        authorUrls = await searchAuthorsGdelt(authorNames, names, keywords);
      }
      for (const url of authorUrls) {
        const site = getSiteFromUrl(url);
        if (!site) continue;
        await query(
          config,
          `INSERT INTO articles (id, url, site) VALUES (gen_random_uuid(), $1, $2) ON CONFLICT (url) DO NOTHING`,
          [url, site]
        );
      }
      console.log(`Discovered ${authorUrls.length} URLs from ${authorNames.length} author name variation(s)`);
    } catch (err) {
      console.error(`Author discovery error: ${err.message}`);
    }
  }

  if (targets.length === 0) return;

  let totalDiscovered = 0;
  for (const target of targets) {
    console.log(`\n[discovery] Target ${target.id} | site: ${target.site} | provider: ${provider}`);
    try {
      let urls = [];
      if (provider === 'gdelt') urls = await searchGdelt(target);
      else if (provider === 'duckduckgo') urls = await searchDuckDuckGo(target);
      else if (provider === 'sitemap') urls = await searchSitemap(target);
      else if (provider === 'homepage') urls = await searchHomepage(config, target);
      else if (provider === 'tavily') {
        const response = await axios.post('https://api.tavily.com/search', {
          api_key: config.TAVILY_API_KEY,
          query: targetSearchTerms(target).join(' '),
          search_depth: 'advanced',
          max_results: 10,
          include_domains: [target.site]
        }, { timeout: 30000 });
        urls = response.data.results.map(result => result.url);
      } else if (provider === 'google') {
        const response = await axios.get('https://www.googleapis.com/customsearch/v1', {
          params: { key: config.GOOGLE_API_KEY, cx: config.GOOGLE_CX, q: `${targetSearchTerms(target).join(' ')} site:${target.site}` }
        });
        urls = response.data.items?.map(item => item.link) || [];
      }

      let inserted = 0;
      for (const url of urls) {
        const result = await query(
          config,
          `INSERT INTO articles (id, url, site) VALUES (gen_random_uuid(), $1, $2) ON CONFLICT (url) DO NOTHING`,
          [url, target.site]
        );
        if (result.rowCount > 0) inserted += 1;
      }
      totalDiscovered += inserted;
      console.log(`[discovery] ${target.site} -> ${inserted} new URL(s) queued (${urls.length} total candidate(s))`);
      if (['gdelt', 'duckduckgo', 'sitemap', 'homepage'].includes(provider)) await delay(5000);
    } catch (err) {
      const status = err.response?.status;
      const suffix = status === 429 ? ` ${provider} is rate-limiting requests; wait before retrying.` : '';
      console.error(`[discovery] Error for target ${target.id} (${target.site}):`, `${err.message}.${suffix}`);
    }
  }
  console.log(`\n[discovery] Pipeline complete: ${targets.length} target(s) processed, ${totalDiscovered} new URL(s) queued in total`);
}

module.exports = { discoverUrls };
