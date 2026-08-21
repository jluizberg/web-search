# Scraper

Fetches article pages and extracts title, content, author, and publish date.

## Usage

```js
const { scrapeArticle } = require('./scraper');

const article = await scrapeArticle('https://example.com/article');
// => { url, site, title, content, author, topic, published_at }
```

## Strategy

1. **Static sites**: Axios + Cheerio
   - Removes `<script>`, `<style>`, `<nav>`, `<header>`, `<footer>`, `<aside>`, `<iframe>`, `<noscript>`
   - Extracts title from `<h1>` or `<title>`
   - Extracts content from `<article>`, `<main>`, or common content classes
   - Extracts author from `[rel="author"]`, `.author`, `.byline`, `[itemprop="author"]`
   - Extracts published date from Open Graph meta tags or `<time datetime>`

2. **JS-heavy sites**: Puppeteer
   - Triggered when `site` matches `config.USE_PUPPETEER_SITES`
   - Same extraction logic via DOM evaluation
   - Adds `--no-sandbox` and `--disable-setuid-sandbox`

## Output

Returns an object:
- `url` — input URL
- `site` — hostname without `www.`
- `title` — string
- `content` — plain text, max 50000 chars
- `content` — extracted article text; articles with 50 words or fewer are rejected
- `author` — string or null
- `topic` — classified topic string
- `published_at` — Date or null

## Dependencies

- `axios` — HTTP GET
- `cheerio` — HTML parsing
- `puppeteer` — headless Chromium

## Configuration

- `scraper.usePuppeteerSites` — array of domain substrings that require Puppeteer

## Error handling

Throws on network failure or empty content. Caller should catch and log.
