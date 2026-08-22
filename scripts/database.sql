CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP TABLE IF EXISTS search_keywords;

CREATE TABLE IF NOT EXISTS search_authors (
  id BIGSERIAL PRIMARY KEY,
  author TEXT NOT NULL UNIQUE,
  variations TEXT[] NOT NULL DEFAULT '{}',
  profile_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE search_authors ADD COLUMN IF NOT EXISTS variations TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE search_authors ADD COLUMN IF NOT EXISTS profile_url TEXT;
ALTER TABLE search_authors ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE search_authors DROP COLUMN IF EXISTS biography;

CREATE TABLE IF NOT EXISTS search_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site TEXT NOT NULL,
  frequency_minutes INT NOT NULL DEFAULT 60,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

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
  title TEXT,
  content TEXT,
  language TEXT,
  published_at TIMESTAMP,
  ingested_at TIMESTAMP NOT NULL DEFAULT NOW(),
  embedding_status TEXT NOT NULL DEFAULT 'pending'
);

ALTER TABLE articles ADD COLUMN IF NOT EXISTS language TEXT;
ALTER TABLE articles DROP COLUMN IF EXISTS topic;
ALTER TABLE articles DROP COLUMN IF EXISTS original_title;
ALTER TABLE articles DROP COLUMN IF EXISTS original_content;
ALTER TABLE articles DROP COLUMN IF EXISTS author;
ALTER TABLE articles DROP COLUMN IF EXISTS raw_html;

CREATE INDEX IF NOT EXISTS idx_articles_site ON articles(site);

CREATE TABLE IF NOT EXISTS topic_reasonings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic TEXT NOT NULL UNIQUE,
  reasoning TEXT NOT NULL,
  search_names JSONB NOT NULL DEFAULT '[]'::jsonb,
  search_keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE topic_reasonings ADD COLUMN IF NOT EXISTS search_names JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE topic_reasonings ADD COLUMN IF NOT EXISTS search_keywords JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS article_reasoning (
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  reasoning_id UUID NOT NULL REFERENCES topic_reasonings(id) ON DELETE CASCADE,
  reasoning_status TEXT NOT NULL DEFAULT 'pending',
  reasoning_result JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (article_id, reasoning_id)
);

ALTER TABLE articles DROP COLUMN IF EXISTS reasoning_status;
ALTER TABLE articles DROP COLUMN IF EXISTS matched_reasoning_ids;
ALTER TABLE articles DROP COLUMN IF EXISTS reasoning_result;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS stakeholder_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE articles ADD COLUMN IF NOT EXISTS relationship_status TEXT NOT NULL DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS idx_article_reasoning_status ON article_reasoning(reasoning_status);
CREATE INDEX IF NOT EXISTS idx_topic_reasonings_active ON topic_reasonings(active);
CREATE INDEX IF NOT EXISTS idx_articles_stakeholder_status ON articles(stakeholder_status);
CREATE INDEX IF NOT EXISTS idx_articles_relationship_status ON articles(relationship_status);

CREATE TABLE IF NOT EXISTS stakeholder_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  definition TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  singleton_key BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE stakeholder_definitions ADD COLUMN IF NOT EXISTS singleton_key BOOLEAN NOT NULL DEFAULT TRUE;
DO $$
BEGIN
  DELETE FROM stakeholder_definitions older
  USING stakeholder_definitions newer
  WHERE older.singleton_key = TRUE
    AND newer.singleton_key = TRUE
    AND older.created_at > newer.created_at;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_stakeholder_definitions_singleton ON stakeholder_definitions(singleton_key);

CREATE TABLE IF NOT EXISTS stakeholders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name TEXT NOT NULL UNIQUE,
  stakeholder_type TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE stakeholders DROP COLUMN IF EXISTS metadata;

CREATE TABLE IF NOT EXISTS article_stakeholders (
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  stakeholder_id UUID NOT NULL REFERENCES stakeholders(id) ON DELETE CASCADE,
  definition_id UUID NOT NULL REFERENCES stakeholder_definitions(id) ON DELETE RESTRICT,
  mention TEXT NOT NULL,
  context TEXT,
  confidence NUMERIC(5, 4),
  extraction JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (article_id, stakeholder_id, definition_id)
);

CREATE INDEX IF NOT EXISTS idx_article_stakeholders_stakeholder ON article_stakeholders(stakeholder_id);
CREATE INDEX IF NOT EXISTS idx_article_stakeholders_definition ON article_stakeholders(definition_id);

CREATE TABLE IF NOT EXISTS relationship_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  definition TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stakeholder_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  relationship_definition_id UUID NOT NULL REFERENCES relationship_definitions(id) ON DELETE RESTRICT,
  source_stakeholder_id UUID NOT NULL REFERENCES stakeholders(id) ON DELETE CASCADE,
  target_stakeholder_id UUID REFERENCES stakeholders(id) ON DELETE CASCADE,
  target_article_id UUID REFERENCES articles(id) ON DELETE CASCADE,
  rationale TEXT NOT NULL,
  confidence NUMERIC(5, 4),
  spectrum TEXT,
  impact_polarity TEXT,
  temporal_dimension TEXT,
  non_human_stakeholder TEXT,
  salience_dynamics TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (article_id, relationship_definition_id, source_stakeholder_id, target_stakeholder_id)
);

ALTER TABLE stakeholder_relationships ALTER COLUMN target_stakeholder_id DROP NOT NULL;
ALTER TABLE stakeholder_relationships ADD COLUMN IF NOT EXISTS target_article_id UUID REFERENCES articles(id) ON DELETE CASCADE;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stakeholder_relationships_one_target'
  ) THEN
    ALTER TABLE stakeholder_relationships
      ADD CONSTRAINT stakeholder_relationships_one_target
      CHECK ((target_stakeholder_id IS NOT NULL) <> (target_article_id IS NOT NULL));
  END IF;
END $$;

ALTER TABLE stakeholder_relationships ADD COLUMN IF NOT EXISTS spectrum TEXT;
ALTER TABLE stakeholder_relationships ADD COLUMN IF NOT EXISTS impact_polarity TEXT;
ALTER TABLE stakeholder_relationships ADD COLUMN IF NOT EXISTS temporal_dimension TEXT;
ALTER TABLE stakeholder_relationships ADD COLUMN IF NOT EXISTS non_human_stakeholder TEXT;
ALTER TABLE stakeholder_relationships ADD COLUMN IF NOT EXISTS salience_dynamics TEXT;

CREATE INDEX IF NOT EXISTS idx_stakeholder_relationships_source ON stakeholder_relationships(source_stakeholder_id);
CREATE INDEX IF NOT EXISTS idx_stakeholder_relationships_target ON stakeholder_relationships(target_stakeholder_id);
CREATE INDEX IF NOT EXISTS idx_stakeholder_relationships_definition ON stakeholder_relationships(relationship_definition_id);

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

GRANT SELECT ON TABLE search_authors, search_targets TO websearch;
GRANT SELECT, INSERT, UPDATE ON TABLE articles TO websearch;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE topic_reasonings TO websearch;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE article_reasoning TO websearch;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE stakeholder_definitions, stakeholders, article_stakeholders TO websearch;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE relationship_definitions, stakeholder_relationships TO websearch;
GRANT SELECT, INSERT, UPDATE ON TABLE inspected_pages TO websearch;
