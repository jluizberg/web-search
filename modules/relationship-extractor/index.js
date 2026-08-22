const { query } = require('../../lib/db');
const { jsonrepair } = require('jsonrepair');
const axios = require('axios');
const cheerio = require('cheerio');
const { getStakeholderProfile, indexStakeholderProfile } = require('../rag/embeddings');

const SYSTEM_PROMPT = `You identify stakeholders mentioned in an article according to the single user-defined stakeholder definition.
A stakeholder may be a person, public organization, private organization, company, institution, government, or other named entity.
Return JSON only in this exact shape:
{"stakeholders":[{"canonical_name":"English name","original_name":"name as written in the article","stakeholder_type":"person|public_organization|private_organization|other","mention":"string","context":"string","confidence":0.0}]}
Only include entities that are actually mentioned in the article and satisfy the definition. Do not infer unnamed entities.`;

const RELATIONSHIP_SYSTEM_PROMPT = `You identify directed relationships between the supplied stakeholders using the supplied relationship definitions.
Return JSON only in this exact shape:
{"relationships":[{"definition_id":"uuid","source_stakeholder_id":"uuid","target_stakeholder_id":"uuid","rationale":"string","confidence":0.0,"spectrum":"string","impact_polarity":"string","temporal_dimension":"string","non_human_stakeholder":"string","salience_dynamics":"string"}]}
For every relationship, classify these five dimensions as strings based only on the article:
- spectrum: explicit or latent, or another precise string when appropriate
- impact_polarity: positive, negative, mixed, neutral, or another precise string
- temporal_dimension: past, present, future, or another precise string
- non_human_stakeholder: describe whether and how a non-human stakeholder is involved; use "none" when not applicable
- salience_dynamics: describe power, legitimacy, and urgency as a concise string
Only return relationships explicitly supported by the article. Do not infer a relationship merely because two stakeholders appear in the same article. The rationale must quote or closely summarize the supporting article context.`;

function parseJson(content) {
  const normalized = content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/gi, '');
  try {
    return JSON.parse(normalized);
  } catch (error) {
    return JSON.parse(jsonrepair(normalized));
  }
}

async function getDefinitions(config) {
  const result = await query(config, `
    SELECT id, definition
    FROM stakeholder_definitions
    WHERE active = TRUE AND singleton_key = TRUE
    ORDER BY updated_at DESC
    LIMIT 1
  `);
  return result.rows;
}

async function getRelationshipDefinitions(config) {
  const result = await query(config, `
    SELECT id, name, definition
    FROM relationship_definitions
    WHERE active = TRUE
    ORDER BY name
  `);
  return result.rows;
}

async function getAuthorRelationshipDefinition(config) {
  if (!config.AUTHOR_RELATIONSHIP_ID) return null;
  const result = await query(config, `
    SELECT id, name, definition
    FROM relationship_definitions
    WHERE id = $1 AND active = TRUE
  `, [config.AUTHOR_RELATIONSHIP_ID]);
  return result.rows[0] || null;
}

async function enrichAuthorStakeholder(config, author) {
  const canonicalName = String(author.author || author.canonical_name || '').trim();
  if (!canonicalName) return null;
  const aliases = [canonicalName, ...(author.variations || [])].filter(Boolean);

  const insertResult = await query(config, `
    INSERT INTO stakeholders (canonical_name, stakeholder_type, aliases)
    VALUES ($1, 'person', $2)
    ON CONFLICT (canonical_name) DO NOTHING
    RETURNING id
  `, [canonicalName, aliases]);
  let stakeholderId = insertResult.rows[0]?.id;
  if (!stakeholderId) {
    const existing = await query(config, 'SELECT id FROM stakeholders WHERE canonical_name = $1', [canonicalName]);
    stakeholderId = existing.rows[0].id;
    await query(config, `UPDATE stakeholders SET aliases = ARRAY(SELECT DISTINCT unnest(aliases || $2::text[])), updated_at = NOW() WHERE id = $1`, [stakeholderId, aliases]);
  }

  try {
    if (!await getStakeholderProfile(config, stakeholderId)) {
      const webResults = await searchWeb(canonicalName, 'author biography profile');
      const profile = await consolidateStakeholder(config, { canonical_name: canonicalName, stakeholder_type: 'person', biography: author.biography || null }, webResults);
      profile.aliases = [...new Set([...(profile.aliases || []), ...aliases].filter(Boolean))];
      await query(config, `UPDATE stakeholders SET aliases = ARRAY(SELECT DISTINCT unnest(aliases || $2::text[])), updated_at = NOW() WHERE id = $1`, [stakeholderId, profile.aliases]);
      await indexStakeholderProfile(config, { id: stakeholderId, canonical_name: canonicalName, stakeholder_type: 'person' }, profile, webResults);
      console.log(`[stakeholder] enriched author "${canonicalName}" as stakeholder (${webResults.length} web sources)`);
    } else {
      console.log(`[stakeholder] author profile already available: ${canonicalName}`);
    }
  } catch (error) {
    console.error(`Author enrichment failed: ${canonicalName}:`, error.message);
  }
  return stakeholderId;
}

async function searchWeb(name, suffix = '') {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await axios.get('https://html.duckduckgo.com/html/', {
        params: { q: [`"${name}"`, suffix].filter(Boolean).join(' ') },
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StakeholderResearch/1.0)' },
        timeout: 10000
      });
      const $ = cheerio.load(response.data);
      const results = [];
      $('.result').slice(0, 5).each((index, element) => {
        const link = $(element).find('.result__a').first();
        const url = link.attr('href');
        const title = link.text().trim();
        const snippet = $(element).find('.result__snippet').text().trim();
        if (url && title) results.push({ title, url, snippet });
      });
      return results;
    } catch (error) {
      if (error.response?.status === 429 && attempt < 3) {
        const waitMs = attempt * 10000;
        console.warn(`Web search rate limited for ${name}; retrying in ${waitMs / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
        continue;
      }
      if (attempt === 3) console.warn(`Web search unavailable for ${name}; continuing without web results: ${error.message}`);
    }
  }
  return [];
}

async function consolidateStakeholder(config, stakeholder, webResults) {
  const response = await fetch(config.DEEPSEEK_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.DEEPSEEK_API_KEY}` },
    body: JSON.stringify({
      model: config.DEEPSEEK_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Consolidate reliable public information about a stakeholder from web search results and any supplied biography. Return JSON only: {"summary":"string","roles":["string"],"aliases":["string"],"official_urls":["string"],"confidence":0.0}. Do not invent facts and distinguish uncertainty in the summary.' },
        { role: 'user', content: JSON.stringify({ stakeholder, web_results: webResults }) }
      ]
    })
  });
  if (!response.ok) throw new Error(`DeepSeek stakeholder enrichment failed with HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error('DeepSeek returned no stakeholder enrichment');
  return parseJson(content);
}

async function getPendingArticles(config) {
  const result = await query(config, `
    SELECT id, url, site, title, content, language, stakeholder_status, relationship_status
    FROM articles
    WHERE (stakeholder_status IN ('pending', 'error') OR relationship_status IN ('pending', 'error'))
      AND title IS NOT NULL AND title <> ''
      AND content IS NOT NULL AND content <> ''
    ORDER BY ingested_at
  `);
  return result.rows;
}

async function translateStakeholderName(config, name, language) {
  if (!name || !config.TRANSLATION_ENABLED || !language || language === 'eng') return name;
  try {
    const response = await axios.post(config.TRANSLATION_ENDPOINT, {
      q: name,
      source: 'auto',
      target: config.TRANSLATION_TARGET_LANGUAGE,
      format: 'text',
      ...(config.TRANSLATION_API_KEY ? { api_key: config.TRANSLATION_API_KEY } : {})
    }, { timeout: 60000 });
    return response.data.translatedText || name;
  } catch (error) {
    console.warn(`Stakeholder name translation failed for ${name}:`, error.message);
    return name;
  }
}

async function extractForDefinition(config, article, definition) {
  const response = await fetch(config.DEEPSEEK_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: config.DEEPSEEK_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify({ definition, article: { title: article.title, site: article.site, url: article.url, content: article.content, language: article.language } }) }
      ]
    })
  });
  if (!response.ok) throw new Error(`DeepSeek stakeholder request failed with HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error('DeepSeek returned no stakeholder analysis');
  const result = parseJson(content);
  return Array.isArray(result.stakeholders) ? result.stakeholders : [];
}

async function extractAuthors(config, article, definition) {
  const response = await fetch(config.DEEPSEEK_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.DEEPSEEK_API_KEY}` },
    body: JSON.stringify({
      model: config.DEEPSEEK_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `Identify the author or authors of the article using the supplied authorship relationship definition. Use explicit page author metadata, tags, bylines, JSON-LD, and article text. If the author is not directly identified, use the supplied article context to make a cautious identification only when supported. Return JSON only: {"authors":[{"canonical_name":"English name","original_name":"name as written","mention":"string","context":"string","confidence":0.0}]}. Do not identify the publisher as the author unless the article explicitly attributes authorship to it. Relationship definition: ${definition.definition}` },
        { role: 'user', content: JSON.stringify({ relationship_definition: definition, article: { title: article.title, content: article.content, url: article.url, language: article.language } }) }
      ]
    })
  });
  if (!response.ok) throw new Error(`DeepSeek author request failed with HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error('DeepSeek returned no author analysis');
  const result = parseJson(content);
  return Array.isArray(result.authors) ? result.authors : [];
}

async function saveStakeholders(config, article, definition, extracted) {
  for (const item of extracted) {
    const originalName = String(item.original_name || item.mention || item.canonical_name || '').trim();
    const canonicalName = (await translateStakeholderName(config, originalName, article.language) || String(item.canonical_name || '')).trim();
    const mention = String(item.mention || '').trim();
    const type = String(item.stakeholder_type || 'other').trim();
    if (!canonicalName || !mention) continue;
    const stakeholder = await query(config, `
      INSERT INTO stakeholders (canonical_name, stakeholder_type, aliases)
      VALUES ($1, $2, ARRAY[$3, $4])
      ON CONFLICT (canonical_name) DO NOTHING
      RETURNING id
    `, [canonicalName, type, originalName, mention]);
    let stakeholderId;
    if (stakeholder.rowCount) {
      stakeholderId = stakeholder.rows[0].id;
    } else {
      const existing = await query(config, 'SELECT id FROM stakeholders WHERE canonical_name = $1', [canonicalName]);
      stakeholderId = existing.rows[0].id;
      await query(config, `UPDATE stakeholders SET aliases = ARRAY(SELECT DISTINCT unnest(aliases || $2::text[])), updated_at = NOW() WHERE id = $1`, [stakeholderId, [originalName, mention]]);
    }
    try {
      const existingProfile = await getStakeholderProfile(config, stakeholderId);
      if (!existingProfile) {
        console.log(`Enriching stakeholder: ${canonicalName}`);
        const webResults = await searchWeb(canonicalName);
        const profile = await consolidateStakeholder(config, { canonical_name: canonicalName, stakeholder_type: type }, webResults);
        const consolidatedProfile = {
          ...profile,
          aliases: [...new Set([...(profile.aliases || []), originalName, mention].filter(Boolean))]
        };
        await query(config, `
          UPDATE stakeholders
          SET aliases = ARRAY(SELECT DISTINCT unnest(aliases || $2::text[])),
              updated_at = NOW()
          WHERE id = $1
        `, [stakeholderId, consolidatedProfile.aliases]);
        await indexStakeholderProfile(config, { id: stakeholderId, canonical_name: canonicalName, stakeholder_type: type }, consolidatedProfile, webResults);
        console.log(`Stakeholder enrichment succeeded: ${canonicalName} (${webResults.length} web sources)`);
      } else {
        console.log(`Stakeholder profile already available: ${canonicalName}`);
      }
    } catch (error) {
      console.error(`Stakeholder enrichment failed: ${canonicalName}:`, error.message);
    }
    await query(config, `
      INSERT INTO article_stakeholders (article_id, stakeholder_id, definition_id, mention, context, confidence, extraction)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (article_id, stakeholder_id, definition_id) DO UPDATE
      SET mention = EXCLUDED.mention, context = EXCLUDED.context,
          confidence = EXCLUDED.confidence, extraction = EXCLUDED.extraction
    `, [article.id, stakeholderId, definition.id, mention, item.context || null, item.confidence || null, item]);
    console.log(`[stakeholder]   saved stakeholder "${canonicalName}" (${type}) for ${article.url}`);
  }
}

async function saveAuthors(config, article, stakeholderDefinition, authorDefinition, authors) {
  let saved = 0;
  for (const item of authors) {
    const originalName = String(item.original_name || item.mention || item.canonical_name || '').trim();
    const canonicalName = (await translateStakeholderName(config, originalName, article.language) || String(item.canonical_name || '')).trim();
    const mention = String(item.mention || originalName).trim();
    if (!canonicalName || !mention) continue;
    const stakeholderResult = await query(config, `
      INSERT INTO stakeholders (canonical_name, stakeholder_type, aliases)
      VALUES ($1, 'person', ARRAY[$2, $3])
      ON CONFLICT (canonical_name) DO NOTHING
      RETURNING id
    `, [canonicalName, originalName, mention]);
    let stakeholderId = stakeholderResult.rows[0]?.id;
    if (!stakeholderId) {
      const existing = await query(config, 'SELECT id FROM stakeholders WHERE canonical_name = $1', [canonicalName]);
      stakeholderId = existing.rows[0].id;
      await query(config, `UPDATE stakeholders SET aliases = ARRAY(SELECT DISTINCT unnest(aliases || $2::text[])), updated_at = NOW() WHERE id = $1`, [stakeholderId, [originalName, mention]]);
    }
    try {
      if (!await getStakeholderProfile(config, stakeholderId)) {
        const webResults = await searchWeb(canonicalName, 'author biography profile');
        const profile = await consolidateStakeholder(config, { canonical_name: canonicalName, stakeholder_type: 'person' }, webResults);
        profile.aliases = [...new Set([...(profile.aliases || []), originalName, mention].filter(Boolean))];
        await query(config, `UPDATE stakeholders SET aliases = ARRAY(SELECT DISTINCT unnest(aliases || $2::text[])), updated_at = NOW() WHERE id = $1`, [stakeholderId, profile.aliases]);
        await indexStakeholderProfile(config, { id: stakeholderId, canonical_name: canonicalName, stakeholder_type: 'person' }, profile, webResults);
      }
    } catch (error) {
      console.error(`Author enrichment failed: ${canonicalName}:`, error.message);
    }
    await query(config, `
      INSERT INTO article_stakeholders (article_id, stakeholder_id, definition_id, mention, context, confidence, extraction)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (article_id, stakeholder_id, definition_id) DO UPDATE
      SET mention = EXCLUDED.mention, context = EXCLUDED.context, confidence = EXCLUDED.confidence, extraction = EXCLUDED.extraction
    `, [article.id, stakeholderId, stakeholderDefinition.id, mention, item.context || null, item.confidence || null, item]);
    await query(config, 'DELETE FROM stakeholder_relationships WHERE article_id = $1 AND relationship_definition_id = $2 AND source_stakeholder_id = $3 AND target_article_id = $1', [article.id, authorDefinition.id, stakeholderId]);
    await query(config, `
      INSERT INTO stakeholder_relationships
        (article_id, relationship_definition_id, source_stakeholder_id, target_article_id, rationale, confidence, evidence)
      VALUES ($1, $2, $3, $1, $4, $5, $6)
    `, [article.id, authorDefinition.id, stakeholderId, item.context || 'The article identifies this stakeholder as an author.', item.confidence || null, item]);
    saved += 1;
    console.log(`[stakeholder]   saved author "${canonicalName}" for ${article.url}`);
  }
  return saved;
}

async function getArticleStakeholders(config, articleId) {
  const result = await query(config, `
    SELECT s.id, s.canonical_name, s.stakeholder_type
    FROM article_stakeholders ast
    JOIN stakeholders s ON s.id = ast.stakeholder_id
    WHERE ast.article_id = $1
    ORDER BY s.canonical_name
  `, [articleId]);
  return result.rows;
}

async function extractRelationships(config, article, stakeholders, definitions) {
  const response = await fetch(config.DEEPSEEK_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.DEEPSEEK_API_KEY}` },
    body: JSON.stringify({
      model: config.DEEPSEEK_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: RELATIONSHIP_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify({ article: { title: article.title, url: article.url, content: article.content }, stakeholders, relationship_definitions: definitions }) }
      ]
    })
  });
  if (!response.ok) throw new Error(`DeepSeek relationship request failed with HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error('DeepSeek returned no relationship analysis');
  const result = parseJson(content);
  return Array.isArray(result.relationships) ? result.relationships : [];
}

async function saveRelationships(config, article, relationships, stakeholders, definitions) {
  const stakeholderIds = new Set(stakeholders.map(item => String(item.id)));
  const definitionIds = new Set(definitions.map(item => String(item.id)));
  let saved = 0;
  for (const item of relationships) {
    const sourceId = String(item.source_stakeholder_id || '');
    const targetId = String(item.target_stakeholder_id || '');
    const definitionId = String(item.definition_id || '');
    const rationale = String(item.rationale || '').trim();
    if (!stakeholderIds.has(sourceId) || !stakeholderIds.has(targetId) || !definitionIds.has(definitionId) || sourceId === targetId || !rationale) continue;
    await query(config, `
      INSERT INTO stakeholder_relationships
        (article_id, relationship_definition_id, source_stakeholder_id, target_stakeholder_id, rationale, confidence, spectrum, impact_polarity, temporal_dimension, non_human_stakeholder, salience_dynamics, evidence)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (article_id, relationship_definition_id, source_stakeholder_id, target_stakeholder_id) DO UPDATE
      SET rationale = EXCLUDED.rationale,
          confidence = EXCLUDED.confidence,
          spectrum = EXCLUDED.spectrum,
          impact_polarity = EXCLUDED.impact_polarity,
          temporal_dimension = EXCLUDED.temporal_dimension,
          non_human_stakeholder = EXCLUDED.non_human_stakeholder,
          salience_dynamics = EXCLUDED.salience_dynamics,
          evidence = EXCLUDED.evidence
    `, [article.id, definitionId, sourceId, targetId, rationale, item.confidence || null,
      item.spectrum || null, item.impact_polarity || null, item.temporal_dimension || null,
      item.non_human_stakeholder || null, item.salience_dynamics || null, item]);
    saved += 1;
    console.log(`[stakeholder]   saved relationship ${sourceId} -> ${targetId} (definition ${definitionId}) for ${article.url}`);
  }
  return saved;
}

async function processPendingStakeholders(config) {
  if (!config.REASONING_ENABLED) return { processed: 0, extracted: 0, relationships: 0, authors: 0 };
  if (!config.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY is required when stakeholder extraction is enabled');
  const definitions = await getDefinitions(config);
  if (!definitions.length) return { processed: 0, extracted: 0, relationships: 0, authors: 0 };
    const relationshipDefinitions = await getRelationshipDefinitions(config);
  const authorDefinition = await getAuthorRelationshipDefinition(config);
  const articles = await getPendingArticles(config);
  let extracted = 0;
  let relationshipsExtracted = 0;
  let authorsExtracted = 0;
  console.log(`[stakeholder] pipeline start: ${articles.length} article(s) pending, ${definitions.length} stakeholder definition(s), ${relationshipDefinitions.length} relationship definition(s), ${authorDefinition ? 'author extraction ON' : 'author extraction OFF'}`);
  for (const article of articles) {
    try {
      if (article.stakeholder_status !== 'analyzed') {
        const definition = definitions[0];
        console.log(`[stakeholder] Extracting stakeholders from ${article.url}`);
        const matches = await extractForDefinition(config, article, definition);
        await saveStakeholders(config, article, definition, matches);
        extracted += matches.length;
        await query(config, `UPDATE articles SET stakeholder_status = 'analyzed' WHERE id = $1`, [article.id]);
        console.log(`[stakeholder] ${article.url} -> ${matches.length} stakeholder(s), stakeholder_status=analyzed`);
      }
      if (authorDefinition) {
        console.log(`[stakeholder] Extracting authors from ${article.url}`);
        const authors = await extractAuthors(config, article, authorDefinition);
        const savedAuthors = await saveAuthors(config, article, definitions[0], authorDefinition, authors);
        authorsExtracted += savedAuthors;
        console.log(`[stakeholder] ${article.url} -> ${savedAuthors} author relationship(s) saved`);
      }
      if (relationshipDefinitions.length) {
        const articleStakeholders = await getArticleStakeholders(config, article.id);
        if (articleStakeholders.length) {
          console.log(`[stakeholder] Extracting relationships from ${article.url} (${articleStakeholders.length} stakeholders)`);
          const relationships = await extractRelationships(config, article, articleStakeholders, relationshipDefinitions);
          const savedRelationships = await saveRelationships(config, article, relationships, articleStakeholders, relationshipDefinitions);
          relationshipsExtracted += savedRelationships;
          console.log(`[stakeholder] ${article.url} -> ${savedRelationships} relationship(s) saved`);
        }
      }
      await query(config, `UPDATE articles SET relationship_status = 'analyzed' WHERE id = $1`, [article.id]);
      console.log(`[stakeholder] ${article.url} -> pipeline complete, relationship_status=analyzed`);
    } catch (error) {
      await query(config, `UPDATE articles SET stakeholder_status = 'error', relationship_status = 'error' WHERE id = $1`, [article.id]);
      console.error(`Stakeholder extraction failed for ${article.url}:`, error.message);
    }
  }
  console.log(`[stakeholder] pipeline complete: ${articles.length} article(s), ${extracted} stakeholder(s), ${authorsExtracted} author(s), ${relationshipsExtracted} relationship(s)`);
  return { processed: articles.length, extracted, relationships: relationshipsExtracted, authors: authorsExtracted };
}

module.exports = { enrichAuthorStakeholder, getDefinitions, processPendingStakeholders };