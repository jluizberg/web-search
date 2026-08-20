CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS search_keywords (
  id BIGSERIAL PRIMARY KEY,
  keyword TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS search_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site TEXT NOT NULL,
  frequency_minutes INT NOT NULL DEFAULT 60,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'search_targets' AND column_name = 'query_pattern'
  ) THEN
    INSERT INTO search_keywords (keyword)
    SELECT DISTINCT query_pattern
    FROM search_targets
    WHERE query_pattern IS NOT NULL
    ON CONFLICT (keyword) DO NOTHING;
  END IF;
END $$;

ALTER TABLE search_targets DROP COLUMN IF EXISTS query_pattern;
ALTER TABLE search_targets DROP COLUMN IF EXISTS topic;
DELETE FROM search_targets older
USING search_targets newer
WHERE older.site = newer.site AND older.ctid > newer.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS idx_search_targets_site ON search_targets(site);

CREATE TABLE IF NOT EXISTS articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT UNIQUE NOT NULL,
  site TEXT NOT NULL,
  author TEXT,
  title TEXT,
  content TEXT,
  original_title TEXT,
  original_content TEXT,
  language TEXT,
  raw_html TEXT,
  topic TEXT,
  published_at TIMESTAMP,
  ingested_at TIMESTAMP NOT NULL DEFAULT NOW(),
  embedding_status TEXT NOT NULL DEFAULT 'pending'
);

ALTER TABLE articles ADD COLUMN IF NOT EXISTS original_title TEXT;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS original_content TEXT;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS language TEXT;
ALTER TABLE articles ALTER COLUMN topic DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_articles_topic ON articles(topic);
CREATE INDEX IF NOT EXISTS idx_articles_site ON articles(site);

CREATE TABLE IF NOT EXISTS inspected_pages (
  url TEXT PRIMARY KEY,
  site TEXT NOT NULL,
  inspected_at TIMESTAMP NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'in_progress',
  matched BOOLEAN NOT NULL DEFAULT FALSE,
  status_code INT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_inspected_pages_site ON inspected_pages(site);

GRANT CONNECT ON DATABASE websearch TO websearch;
GRANT USAGE ON SCHEMA public TO websearch;

GRANT SELECT ON TABLE search_keywords, search_targets TO websearch;
GRANT SELECT, INSERT, UPDATE ON TABLE articles TO websearch;
GRANT SELECT, INSERT, UPDATE ON TABLE inspected_pages TO websearch;
