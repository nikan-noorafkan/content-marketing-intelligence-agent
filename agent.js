// Content Marketing Intelligence: a Druve agent ported by hand from the n8n
// template "Automated content marketing intelligence with OpenAI, Ahrefs &
// multi-platform integration" by Nikan Noorafkan (https://n8n.io/workflows/5979).
// Draft for Nikan to check. Nothing is published.
//
// What it keeps, unchanged: the "Prepare AI Prompt" text word for word (the
// three data blocks, the five recommendation areas, "Format as JSON with clear
// action items"), the Configuration fields (competitor_domains, target_regions,
// seed_keywords, timeframe_days), the Ahrefs site-explorer overview call, the
// SEMrush domain_organic call (display_limit 50, same export columns), the
// Reddit hot-posts pull (limit 25) and the three "Process" steps that shape the
// data (competitor intelligence, keyword opportunities, audience insights).
// What changes:
//   - Druve agents may call at most 3 data hosts, so it fetches Ahrefs,
//     SEMrush and Reddit (public JSON, no OAuth needed). BuzzSumo, Google
//     Trends and AnswerThePublic results can be pasted in as "extra" data
//     (and Reddit's hot.json too, if Reddit refuses the buyer's network).
//   - The placeholder values in the Process steps (random search volumes,
//     the sample fashion topics and regional preferences) are left out, so the
//     model only reasons over real data.
//   - Instead of saving to Airtable/Notion and posting to Slack, it returns
//     the recommendations and the data behind them.
//
// Input (JSON):
//   {"competitor_domains": "etoro.com", "seed_keywords": "forex trading",
//    "target_regions": "US,UK,DE,FR,JP", "timeframe_days": 30,
//    "ahrefs_api_key": "...", "semrush_api_key": "...",
//    "extra": {"buzzsumo": [...], "google_trends": {...}, "answerthepublic": [...], "reddit": {...hot.json}}}
// Every key is optional; a source without a key is skipped.
// Or plain text: a seed keyword (Reddit only).
//
// Data-fetch hosts to declare when publishing: api.ahrefs.com, api.semrush.com, www.reddit.com
//
// To publish it under your name on druve.ai:
//   1. Put this file in a GitHub repo (private is fine) and copy the file's link.
//   2. Go to druve.ai/build/new and sign up. Fill in the short steps (name, what it
//      does, price or free), paste the link into "Agent code", declare the three
//      hosts above, and publish.
//   It runs on each buyer's own model and API keys, so it costs you nothing to run.

import { getModelClient } from '@druve/cli/providers';

// Configuration Settings node defaults.
const CONFIG = {
  competitor_domains: 'opofinance.com,etoro.com',
  target_regions: 'US,UK,DE,FR,JP',
  seed_keywords: 'forex trading,social trade,how to trade',
  timeframe_days: '30',
};

// Author's prompt, verbatim (n8n node "Prepare AI Prompt").
const USER_PROMPT = "Based on this data:\n\nCompetitor Intelligence: {{ $('🔄 Process Competitor Data').first().json }}\n\nKeyword Opportunities: {{ $('📈 Process Keyword Trends').first().json }}\n\nAudience Insights: {{ $('👥 Process Audience Insights').first().json }}\n\nProvide specific recommendations for:\n1. Content topics to prioritize\n2. Content formats by region\n3. Publishing schedule\n4. Competitive advantages to leverage\n5. Audience pain points to address\n\nFormat as JSON with clear action items.";

function readInput(input) {
  const raw = String(input || '').trim();
  let p = null;
  try { p = JSON.parse(raw); } catch { /* plain text */ }
  if (!p || typeof p !== 'object') p = raw ? { seed_keywords: raw } : {};
  return {
    cfg: {
      competitor_domains: String(p.competitor_domains || CONFIG.competitor_domains),
      target_regions: String(p.target_regions || CONFIG.target_regions),
      seed_keywords: String(p.seed_keywords || CONFIG.seed_keywords),
      timeframe_days: String(p.timeframe_days || CONFIG.timeframe_days),
    },
    keys: { ahrefs: p.ahrefs_api_key || '', semrush: p.semrush_api_key || '' },
    extra: p.extra && typeof p.extra === 'object' ? p.extra : {},
  };
}

async function getJson(url, opts, errors, label) {
  try {
    const res = await fetch(url, opts);
    if (!res.ok) { errors.push(`${label}: HTTP ${res.status}`); return null; }
    const text = await res.text();
    try { return JSON.parse(text); } catch { return text; }
  } catch (e) { errors.push(`${label}: ${e.message}`); return null; }
}

// SEMrush returns semicolon-separated text: header row, then one keyword per row.
function parseSemrush(text) {
  if (typeof text !== 'string' || !text.includes(';')) return [];
  const [head, ...rows] = text.trim().split(/\r?\n/);
  const cols = head.split(';');
  return rows.map((r) => Object.fromEntries(r.split(';').map((v, i) => [cols[i], v])));
}

// "Process Competitor Data", same fields, placeholders removed.
function competitorData(cfg, ahrefs, semrushRows, extra) {
  const buzz = Array.isArray(extra.buzzsumo) ? extra.buzzsumo : extra.buzzsumo?.results;
  return {
    timestamp: new Date().toISOString(),
    domain: ahrefs?.target || cfg.competitor_domains.split(',')[0].trim() || 'N/A',
    traffic_estimate: ahrefs?.traffic?.organic?.value ?? ahrefs?.metrics?.org_traffic ?? 0,
    backlinks: ahrefs?.backlinks?.total ?? ahrefs?.metrics?.backlinks ?? 0,
    top_keywords: semrushRows.slice(0, 10),
    viral_content: Array.isArray(buzz) ? buzz.slice(0, 5) : [],
  };
}

// "Process Keyword Trends", same fields, random numbers and sample topics removed.
function keywordTrends(extra) {
  const t = extra.google_trends;
  const q = extra.answerthepublic;
  const qs = Array.isArray(q) ? q : q?.questions;
  return {
    timestamp: new Date().toISOString(),
    trending_keywords: (t?.default?.timelineData || []).slice(0, 10).map((item) => ({
      keyword: item.formattedValue || 'Unknown', trend_velocity: item.value?.[0] || 0, region: 'US',
    })),
    long_tail_questions: (Array.isArray(qs) ? qs : []).slice(0, 15).map((x) => ({ question: x.question || x })),
  };
}

// "Process Audience Insights", same filters, sample regional preferences removed.
function audienceInsights(reddit) {
  const posts = reddit?.data?.children || [];
  return {
    timestamp: new Date().toISOString(),
    top_pain_points: posts
      .filter((post) => post.data.title.includes('problem') || post.data.title.includes('issue'))
      .slice(0, 10)
      .map((post) => ({ pain_point: post.data.title, upvotes: post.data.ups || 0, comments: post.data.num_comments || 0, source: 'reddit' })),
    common_questions: posts
      .filter((post) => post.data.title.includes('?') || post.data.title.toLowerCase().includes('how'))
      .slice(0, 10)
      .map((post) => ({ question: post.data.title, engagement_score: (post.data.ups || 0) + (post.data.num_comments || 0), category: 'general' })),
    engagement_topics: [...posts]
      .sort((a, b) => (b.data.ups || 0) - (a.data.ups || 0))
      .slice(0, 5)
      .map((post) => ({ topic: post.data.title, engagement_score: post.data.ups || 0, discussion_level: post.data.num_comments || 0 })),
  };
}

function parseJson(text) {
  const s = String(text);
  const a = s.search(/[[{]/);
  const b = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  if (a === -1 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

export async function handleMessage(input, providerConfig) {
  const { cfg, keys, extra } = readInput(input);
  const errors = [];
  const domain = cfg.competitor_domains.split(',')[0].trim();
  const keyword = cfg.seed_keywords.split(',')[0].trim();

  const ahrefs = keys.ahrefs
    ? await getJson(`https://api.ahrefs.com/v3/site-explorer/overview?target=${encodeURIComponent(domain)}&mode=domain&output=json`,
      { headers: { Authorization: `Bearer ${keys.ahrefs}` } }, errors, 'ahrefs')
    : null;
  const semrush = keys.semrush
    ? await getJson(`https://api.semrush.com/?type=domain_organic&key=${encodeURIComponent(keys.semrush)}&domain=${encodeURIComponent(domain)}&display_limit=50&export_columns=Ph,Po,Pp,Pd,Nq,Cp,Ur,Tr,Tc,Co,Nr,Td`,
      {}, errors, 'semrush')
    : null;
  const reddit = keyword
    ? await getJson(`https://www.reddit.com/r/${encodeURIComponent(keyword.replace(' ', ''))}/hot.json?limit=25&t=month`,
      { headers: { 'User-Agent': 'druve-content-intelligence/1.0' } }, errors, 'reddit')
    : null;

  const comp = competitorData(cfg, ahrefs && typeof ahrefs === 'object' ? ahrefs : null, parseSemrush(semrush), extra);
  const kw = keywordTrends(extra);
  const aud = audienceInsights(reddit && typeof reddit === 'object' ? reddit : extra.reddit); // pasted hot.json if Reddit refuses the request

  // Same data-quality gate as the template: no competitor data, no report.
  if (comp.domain === 'N/A') return JSON.stringify({ error: 'Add a competitor domain.', errors });

  const prompt = USER_PROMPT
    .replace("{{ $('🔄 Process Competitor Data').first().json }}", JSON.stringify(comp))
    .replace("{{ $('📈 Process Keyword Trends').first().json }}", JSON.stringify(kw))
    .replace("{{ $('👥 Process Audience Insights').first().json }}", JSON.stringify(aud))
    + `\n\nTarget regions: ${cfg.target_regions}. Timeframe: last ${cfg.timeframe_days} days.`;

  const out = await getModelClient(providerConfig).complete(prompt);
  return JSON.stringify({
    recommendations: parseJson(out) ?? String(out).trim(),
    data: { competitor_intelligence: comp, keyword_opportunities: kw, audience_insights: aud },
    errors,
  });
}
