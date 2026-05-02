import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('FATAL: ANTHROPIC_API_KEY not set');
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-5-20250929';

app.use(express.json({ limit: '25mb' }));
app.use(express.static(join(__dirname, 'public')));

// ── KB ──
const kbCache = {};
async function loadKB(client) {
  if (kbCache[client]) return kbCache[client];
  try {
    const text = await readFile(join(__dirname, 'kb', `${client}.md`), 'utf-8');
    kbCache[client] = text;
    return text;
  } catch (err) {
    console.error(`KB load failed for ${client}:`, err.message);
    return '';
  }
}

// ── AUTH ──
app.use('/api', (req, res, next) => {
  const pwd = req.headers['x-auth'];
  if (process.env.AUTH_PASSWORD && pwd !== process.env.AUTH_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// ── CLIENT BRAND ──
const CLIENT_BRAND = {
  mihoyo:  { primary: '#7C5BBF', secondary: '#F4C95D', bg: '#0F0B1F', text: '#F5F1FF', accent: '#E8C77E' },
  riot:    { primary: '#D32226', secondary: '#0B3A5B', bg: '#0A1929', text: '#F0F4F8', accent: '#1FB8DB' },
  tencent: { primary: '#F39C12', secondary: '#2980B9', bg: '#FAFAF7', text: '#1A1A1A', accent: '#E74C3C' },
  netease: { primary: '#27AE60', secondary: '#2C3E50', bg: '#FFFFFF', text: '#1A1A1A', accent: '#3498DB' }
};

// ── OPTION C: Sections that use search-then-generate (two API calls) ──
// These sections benefit most from recency: viral formats, KOL data, content trends
const SEARCH_THEN_GENERATE = new Set([
  'VIRAL_FORMATS',
  'KOL_PLAN',
  'CONTENT_TREND',
  'MOMENT_INSIGHT',
  'KOL_SHOWMATCH_ROSTER',
  'KOL_MARATHON'
]);

// ── OUTPUT SPEC ──
function getOutputSpec(projectType) {
  const specs = {
    new_launch: [
      { code: 'COVER',               name: 'Cover' },
      { code: 'TOC',                 name: 'Table of Contents' },
      { code: 'COMPETITOR_MAP',      name: 'Competitor Mapping' },
      { code: 'CONTENT_TREND',       name: 'Content Trends by Country' },
      { code: 'VIRAL_FORMATS',       name: "What's Viral Per Country" },
      { code: 'COMM_STRATEGY',       name: 'Communication Strategy' },
      { code: 'ROADMAP',             name: 'Campaign Roadmap' },
      { code: 'CONTENT_DIRECTION',   name: 'Content Direction' },
      { code: 'KOL_PLAN',            name: 'KOL Plan' },
      { code: 'ADDITIONAL_RESOURCES',name: 'Additional Resources' },
      { code: 'BUDGET',              name: 'Budget' },
    ],
    seasonal: [
      { code: 'COVER',            name: 'Cover' },
      { code: 'AUDIENCE_OVERVIEW',name: 'Audience Overview' },
      { code: 'MOMENT_INSIGHT',   name: 'Moment Insight' },
      { code: 'POPULAR_CONTENT',  name: 'Popular Content' },
      { code: 'CAMPAIGN_OVERVIEW',name: 'Campaign Overview' },
      { code: 'COMM_STRATEGY',    name: 'Communication Strategy' },
      { code: 'ROADMAP',          name: 'Campaign Roadmap' },
      { code: 'KOL_MARATHON',     name: 'KOL Stream Marathon' },
      { code: 'SHOW_DETAIL',      name: 'Pre-recorded Show' },
      { code: 'UGC_DETAIL',       name: 'UGC Challenge' },
      { code: 'BUDGET',           name: 'Budget' },
    ],
    update_collab: [
      { code: 'COVER',            name: 'Cover' },
      { code: 'UPDATE_OVERVIEW',  name: 'Update / Collab Overview' },
      { code: 'COMMUNITY_INSIGHT',name: 'Community Insight' },
      { code: 'CAMPAIGN_OVERVIEW',name: 'Campaign Overview' },
      { code: 'COMM_STRATEGY',    name: 'Communication Strategy' },
      { code: 'ROADMAP',          name: 'Campaign Roadmap' },
      { code: 'CONTENT_IDEATION', name: 'Content Ideation' },
      { code: 'KOL_PLAN',         name: 'KOL Plan' },
      { code: 'BUDGET',           name: 'Budget' },
    ],
    retainer: [
      { code: 'COVER',            name: 'Cover' },
      { code: 'TOC',              name: 'Table of Contents' },
      { code: 'THE_ASK',          name: 'The Ask' },
      { code: 'COMMUNITY_VOICE',  name: 'Community Voice' },
      { code: 'THE_PROBLEMS',     name: 'The Problems' },
      { code: 'OUR_SOLUTION',     name: 'Our Solution' },
      { code: 'CONTENT_PILLARS',  name: 'Content Pillars' },
      { code: 'CONTENT_CALENDAR', name: 'Content Calendar' },
      { code: 'SOW_DELIVERABLES', name: 'SOW + Deliverables' },
      { code: 'KPIS',             name: 'KPIs' },
      { code: 'WORKFLOW',         name: 'Workflow' },
      { code: 'TEAM_COMPOSITION', name: 'Team Composition' },
      { code: 'BUDGET',           name: 'Budget' },
    ],
    event: [
      { code: 'COVER',               name: 'Cover' },
      { code: 'PROJECT_BACKGROUND',  name: 'Project Background & Insights' },
      { code: 'CAMPAIGN_OVERVIEW',   name: 'Campaign Overview' },
      { code: 'OOH_DETAIL',          name: 'OOH Detail' },
      { code: 'BOOTH_ACTIVITIES',    name: 'Booth Activities' },
      { code: 'ON_STAGE_ACTIVITY',   name: 'On-Stage Activity' },
      { code: 'VENUE',               name: 'Venue' },
      { code: 'EVENT_OVERVIEW',      name: 'Event Overview' },
      { code: 'STAGE_RUNDOWN',       name: 'Stage Rundown' },
      { code: 'KOL_SHOWMATCH_ROSTER',name: 'KOL Showmatch Roster' },
      { code: 'KOC_TOURNAMENT',      name: 'KOC Tournament' },
      { code: 'BUDGET',              name: 'Budget' },
    ],
    multi_kol: [
      { code: 'COVER',               name: 'Cover' },
      { code: 'TOC',                 name: 'Table of Contents' },
      { code: 'COMPETITOR_MAP',      name: 'Competitor Mapping' },
      { code: 'CONTENT_TREND',       name: 'Content Trend' },
      { code: 'VIRAL_FORMATS',       name: "What's Viral Per Country" },
      { code: 'COMM_STRATEGY',       name: 'Communication Strategy' },
      { code: 'ROADMAP',             name: 'Campaign Roadmap' },
      { code: 'CONTENT_DIRECTION',   name: 'Content Direction' },
      { code: 'KOL_PLAN',            name: 'KOL Plan Per Country' },
      { code: 'ADDITIONAL_RESOURCES',name: 'Additional Resources' },
      { code: 'BUDGET',              name: 'Budget' },
    ]
  };
  return specs[projectType] || specs.seasonal;
}

// ── SECTION INSTRUCTIONS ──
function getSectionInstructions(code) {
  const inst = {
    COVER: 'JSON: { "title": "campaign title", "subtitle": "client + project type + region", "tagline": "1 punchy line capturing campaign essence" }',
    TOC: 'JSON: { "sections": ["section name 1", "section name 2", ...] }',
    COMPETITOR_MAP: 'JSON: { "headline": "1-line market positioning", "tier1": [{ "name": "X", "publisher": "Y", "country": "🇹🇭 Thailand" }], "tier2": [...], "matrix": [{ "name": "Game", "launch": "date", "positioning": "...", "strength": "...", "weakness": "...", "appSize": "..." }] }',
    CONTENT_TREND: 'JSON: { "headline": "1-line cross-country insight", "countries": [{ "code": "TH", "name": "Thailand", "flag": "🇹🇭", "quote": "content culture in 1 sentence", "examples": [{ "title": "video title", "creator": "name", "views": "X views", "platform": "YouTube/TikTok" }] }] }',
    VIRAL_FORMATS: 'JSON: { "headline": "insight", "countries": [{ "code": "TH", "name": "Thailand", "flag": "🇹🇭", "format": "BL pairs / 5 Kages / 7GL", "creators": [{ "name": "...", "followers": "...", "platform": "..." }], "viralExample": { "title": "...", "views": "...", "context": "..." } }] }',
    COMM_STRATEGY: 'JSON: { "hashtag": "#CampaignTag", "positioning": "1-sentence game positioning", "audiences": [{ "segment": "Former/Current/New Player", "theme": "Companionship/Inspiration/Joy", "message": "1-sentence message", "activity": "what they do" }] }',
    ROADMAP: 'JSON: { "headline": "campaign timeline summary", "phases": [{ "phase": "Phase 1: Pre-Heat", "dates": "Date range", "activities": ["activity 1", "activity 2"], "deliverables": "what gets shipped" }] }',
    CONTENT_DIRECTION: 'JSON: { "headline": "1-line direction summary", "countries": [{ "code": "TH", "name": "Thailand", "flag": "🇹🇭", "kolArchetype": "BL + Gaming", "contentFocus": "educational/tutorial", "tone": "humor/heartfelt/etc", "exampleIdeas": ["idea 1", "idea 2"] }] }',
    KOL_PLAN: 'JSON: { "headline": "roster summary", "tiers": { "mega": "X KOLs", "macro": "X KOLs", "micro": "X KOLs", "nano": "X KOLs" }, "kols": [{ "name": "Real Name", "tier": "Mega/Macro/Micro/Nano", "followers": "X.XM", "platform": "YouTube/TikTok/IG", "country": "TH", "style": "1-line content style", "phase": "Phase 1-2" }] }',
    ADDITIONAL_RESOURCES: 'JSON: { "headline": "scope-extending ideas", "ideas": [{ "title": "Idea name", "rationale": "why it works", "estimatedImpact": "expected outcome" }] }',
    BUDGET: 'JSON: { "headline": "budget summary", "currency": "USD", "lineItems": [{ "category": "KOL Marketing", "item": "Mega KOL fee", "remark": "1 KOL × $X", "impressions": "5M", "cost": 25000, "cpm": 5 }], "subtotal": 100000, "vat": 9000, "total": 109000 }',
    KEY_VISUAL: 'JSON: { "direction": { "aesthetic": "tone", "palette": ["#hex1","#hex2"], "characters": "which game characters/mascots", "typography": "font direction", "heroConcept": "hero image description" }, "videoPrompts": [{ "pillar": "Pillar name", "platform": "TikTok vertical 8s", "prompt": "Full Veo/Seedance prompt: opening shot, transitions, text overlay, color grade, music mood, ending frame, style, camera movement, no dialogue" }] }',
    AUDIENCE_OVERVIEW: 'JSON: { "headline": "audience profile", "demographics": { "gender": "X% male", "age": "Y-Z", "veteran": "X% playing 3+ years" }, "contentPref": [{ "format": "format name", "percent": 40 }], "timePref": [{ "window": "Ngabuburit 16:00-18:00", "percent": 65 }], "kolPref": ["KOL 1", "KOL 2", "KOL 3"] }',
    MOMENT_INSIGHT: 'JSON: { "headline": "cultural moment finding", "stats": [{ "value": "84%", "label": "stat label", "source": "source" }], "weeklyCurve": [{ "week": "Week 1", "intensity": "low/peak/high", "behavior": "what people do" }], "trendExamples": [{ "title": "content title", "platform": "TikTok", "views": "12M" }], "insight": "2-sentence strategic implication" }',
    POPULAR_CONTENT: 'JSON: { "headline": "what content wins", "gameContent": [{ "title": "...", "platform": "...", "views": "...", "mapsTo": "Pillar name" }], "socialContent": [{ "title": "...", "platform": "...", "views": "...", "format": "format type" }] }',
    CAMPAIGN_OVERVIEW: 'JSON: { "hashtag": "#TagName", "mission": "1-paragraph campaign mission", "metrics": { "impressions": "46M", "budget": "$150K", "cpm": "$3.18" }, "pillars": [{ "name": "Pillar 1", "description": "what it is", "color": "#hex" }] }',
    KOL_MARATHON: 'JSON: { "headline": "stream marathon overview", "format": "8 KOLs × 14 days × 1 hour", "themes": [{ "theme": "Theme name", "description": "..." }], "kols": [{ "name": "...", "category": "Macro/Micro/Nano", "followers": "...", "totalLiveViews": "...", "platform": "..." }] }',
    SHOW_DETAIL: 'JSON: { "title": "Show name", "format": "45-min 2-segment", "kols": [{ "name": "...", "role": "Mega gaming KOL", "followers": "..." }], "segments": [{ "name": "Segment 1", "description": "..." }], "irlElements": ["game food recreated IRL"] }',
    UGC_DETAIL: 'JSON: { "mechanic": "AR filter / hashtag challenge", "estimatedParticipants": 3000, "flow": ["Step 1","Step 2","Step 3","Step 4","Step 5"], "kols": [{ "name": "...", "category": "Entertainment", "followers": "..." }], "winnerMechanic": "how winners selected" }',
    UPDATE_OVERVIEW: 'JSON: { "name": "Update/Collab name", "whatNew": ["new feature 1","new feature 2"], "rationale": "why this matters to community", "anniversaryContext": "if applicable" }',
    COMMUNITY_INSIGHT: 'JSON: { "headline": "community insight", "responsePatterns": [{ "type": "Past update reception", "data": "..." }], "platformData": "platform insight", "opportunities": ["opp 1","opp 2"] }',
    CONTENT_IDEATION: 'JSON: { "headline": "content directions", "ideas": [{ "pillar": "Pillar name", "title": "Content idea", "platform": "...", "format": "..." }] }',
    THE_ASK: 'JSON: { "headline": "diagnosis summary", "diagnosis": [{ "game": "VALORANT", "dimension": "Content/Visual/Communication/Approach", "issue": "what is broken", "working": "what is working" }] }',
    COMMUNITY_VOICE: 'JSON: { "headline": "what players are saying", "quotes": [{ "name": "First name", "city": "Jakarta", "type": "Dominator/Social Player", "game": "VALORANT", "quote": "player quote" }] }',
    THE_PROBLEMS: 'JSON: { "headline": "problem framework", "perGame": [{ "game": "VALORANT", "problems": ["Hyperlocal Content","Rigid Visuals","Two-way communication"] }] }',
    OUR_SOLUTION: 'JSON: { "headline": "solution framework", "perGame": [{ "game": "VALORANT", "solutions": [{ "problem": "...", "solution": "...", "contentIP": "VALOSOPHY" }] }] }',
    CONTENT_PILLARS: 'JSON: { "headline": "pillar framework", "perGame": [{ "game": "VALORANT", "pillars": [{ "name": "Promotion", "objective": "...", "bigIdeas": ["idea 1"], "outputs": ["TikTok Short Video","IG Posts"] }] }] }',
    CONTENT_CALENDAR: 'JSON: { "headline": "monthly plan", "perGame": [{ "game": "VALORANT", "weeks": [{ "week": 1, "posts": [{ "day": "Mon", "pillar": "Promotion", "content": "..." }] }] }] }',
    SOW_DELIVERABLES: 'JSON: { "scope": ["Content Strategy & Creation","Content Scheduling","Report & Insight"], "deliverables": [{ "channel": "TikTok", "game": "VALORANT", "whimOriginal": 8, "globalAdapted": 4, "preHeatStory": 12 }] }',
    KPIS: 'JSON: { "headline": "growth trajectory", "platforms": [{ "platform": "Instagram", "month1": ">5%", "month2": ">10%", "month3": "10-15%" }], "metrics": ["follower growth","engagement rate","reach"] }',
    WORKFLOW: 'JSON: { "steps": [{ "day": "Day -10", "action": "Ideation", "owner": "Strategist" },{ "day": "Day -8", "action": "Approval", "owner": "Client" },{ "day": "Day -7 to -4", "action": "Production", "owner": "Creative" },{ "day": "Day -3 to -2", "action": "Review", "owner": "Client" },{ "day": "Day 0", "action": "Post", "owner": "Social Team" }] }',
    TEAM_COMPOSITION: 'JSON: { "team": [{ "role": "Project Manager", "count": 1, "responsibility": "Single PIC" },{ "role": "Strategist", "count": 1, "responsibility": "Content Strategy" },{ "role": "Designer", "count": 2, "responsibility": "Visual production" }] }',
    PROJECT_BACKGROUND: 'JSON: { "headline": "campaign rationale", "insights": [{ "title": "Insight title", "dataPoint": "stat with source", "implication": "what it means for strategy" }], "coreStrategy": "1-paragraph strategy summary" }',
    OOH_DETAIL: 'JSON: { "movingTruck": { "concept": "description", "alternatives": [{ "mechanic": "...", "reasoning": "..." }] }, "trainWrap": { "city": "Bangkok BTS", "stations": 60, "screens": 768, "dailyReach": "2.4M users" } }',
    BOOTH_ACTIVITIES: 'JSON: { "zones": [{ "name": "Main Stage", "description": "..." }], "sessions": [{ "name": "Exhibition Match", "description": "..." }] }',
    ON_STAGE_ACTIVITY: 'JSON: { "name": "Angbao Session", "mechanic": "step-by-step how it works", "prizePool": { "usd": 5000, "local": "180,000 THB" }, "terms": ["term 1","term 2"] }',
    VENUE: 'JSON: { "name": "Icon Siam 7th Floor", "address": "full address", "dates": "Dec 27-29 2025", "footfall": "expected attendance per day", "pros": ["pro 1"], "cons": ["con 1"] }',
    EVENT_OVERVIEW: 'JSON: { "activities": [{ "name": "KOL & Celeb Showmatch", "icon": "🎮", "description": "..." },{ "name": "KOC Tournament", "icon": "🏆", "description": "..." },{ "name": "Booth Experience", "icon": "🎪", "description": "..." },{ "name": "Drone Show", "icon": "✨", "description": "..." }] }',
    STAGE_RUNDOWN: 'JSON: { "days": [{ "day": "Day 1: BL Battle", "schedule": [{ "start": "14:00", "end": "15:00", "duration": "1h", "activity": "activity name" }] }] }',
    KOL_SHOWMATCH_ROSTER: 'JSON: { "headline": "roster overview", "days": [{ "day": "Day 1 BL Battle", "format": "4 BL actors per team", "kols": [{ "name": "...", "handle": "@...", "platform": "IG/TikTok", "followers": "..." }] }] }',
    KOC_TOURNAMENT: 'JSON: { "format": "32 to 16 to 8 over 3 days", "points": [{ "place": "1st", "points": 8 }], "fees": { "mega": 1900, "macro": 1000, "micro": 700, "nano": 500 } }'
  };
  return inst[code] || 'JSON: { "content": "section content as structured data" }';
}

// ── SEARCH QUERIES PER SECTION ──
function getSearchQuery(code, brief) {
  const game = brief.game || 'gaming';
  const regions = (brief.regions || []).join(' ');
  const queries = {
    VIRAL_FORMATS: `top viral gaming KOL ${regions} 2025 2026 trending format`,
    KOL_PLAN: `top gaming influencer KOL ${regions} ${game} 2025 2026 followers`,
    CONTENT_TREND: `${game} gaming content trend ${regions} YouTube TikTok 2025 2026`,
    MOMENT_INSIGHT: `${brief.moment || 'gaming'} digital behavior ${regions} statistics 2025 2026`,
    KOL_MARATHON: `top gaming streamer ${regions} live stream 2025 2026`,
    KOL_SHOWMATCH_ROSTER: `Boys Love KOL Thailand gaming 2025 GMMTV top BL actor`
  };
  return queries[code] || `${game} gaming ${regions} 2025`;
}

// ── USER PROMPT ──
function buildUserPrompt(brief, pdfContext) {
  let p = `Generate this WHIM proposal section as JSON.\n\nBRIEF:\n`;
  if (brief.game)          p += `- Game: ${brief.game}\n`;
  if (brief.projectType)   p += `- Project: ${brief.projectType.replace(/_/g,' ')}\n`;
  if (brief.regions?.length) p += `- Regions: ${brief.regions.join(', ')}\n`;
  if (brief.moment)        p += `- Cultural Moment: ${brief.moment}\n`;
  if (brief.genre)         p += `- Genre: ${brief.genre}\n`;
  if (brief.budget)        p += `- Budget: $${Number(brief.budget).toLocaleString()} USD\n`;
  if (brief.objective)     p += `- Objective: ${brief.objective}\n`;
  if (brief.hashtag)       p += `- Hashtag: ${brief.hashtag}\n`;
  if (brief.updateName)    p += `- Update/Collab: ${brief.updateName}\n`;
  if (brief.collabPartner) p += `- Collab IP: ${brief.collabPartner}\n`;
  if (brief.eventType)     p += `- Event Type: ${brief.eventType}\n`;
  if (brief.venueCity)     p += `- Venue City: ${brief.venueCity}\n`;
  if (brief.eventDates)    p += `- Dates: ${brief.eventDates}\n`;
  if (brief.usp)           p += `- USP: ${brief.usp}\n`;
  if (brief.competitors)   p += `- Competitors: ${brief.competitors}\n`;
  if (pdfContext)          p += `\nCLIENT BRIEF (PDF):\n${pdfContext.slice(0, 5000)}\n`;
  p += `\nReturn JSON ONLY. Start with { immediately. No markdown, no commentary.`;
  return p;
}

// ── EXTRACT SECTION DATA FROM RESPONSE TEXT ──
// Finds all balanced JSON objects in text, picks the largest valid one with real content
function extractSectionData(text) {
  const candidates = [];
  let depth = 0, start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        candidates.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  // Sort largest first — the main JSON object is almost always the biggest
  candidates.sort((a, b) => b.length - a.length);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (Object.keys(parsed).length === 0) continue;
      // Unwrap known wrapper formats
      if (parsed.sections?.[0]?.data) return parsed.sections[0].data;
      if (parsed.data && typeof parsed.data === 'object' && Object.keys(parsed.data).length > 0) return parsed.data;
      // Accept directly if it has real content (not just code/name shell)
      const keys = Object.keys(parsed);
      if (keys.length > 0 && !(keys.length <= 2 && keys.every(k => ['code','name'].includes(k)))) {
        return parsed;
      }
    } catch { continue; }
  }
  return null;
}

// ── /api/sections ──
app.post('/api/sections', (req, res) => {
  const { projectType } = req.body;
  res.json({ sections: getOutputSpec(projectType) });
});

// ── /api/generate-section ──
// Option C implementation:
// - SEARCH_THEN_GENERATE sections: Call 1 searches → research summary → Call 2 generates JSON
// - All other sections: single call, training knowledge, full token budget for JSON
app.post('/api/generate-section', async (req, res) => {
  const { brief, pdfContext, sectionCode, sectionName } = req.body;

  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
    }

    const kb = await loadKB(brief.client || 'mihoyo');
    const regionStr = Array.isArray(brief.regions) ? brief.regions.join(', ') : 'SEA';

    const systemBase = `You are the WHIM Creative Engine — AI brain of WHIM, a leading SEA gaming marketing agency (part of ATTN Group: EVOS Esports + Noctua Games).

Deep knowledge of SEA gaming markets (Indonesia, Thailand, Malaysia, Vietnam, Philippines), KOL ecosystems, cultural moments, and gaming community behavior.

━━━ CLIENT KNOWLEDGE BASE ━━━
${kb}
━━━ END CLIENT KB ━━━

TARGET REGIONS: ${regionStr}`;

    const userPrompt = buildUserPrompt(brief, pdfContext);

    console.log(`[GEN] ${sectionCode} — generating`);

    const systemPrompt = `${systemBase}

OUTPUT: Return ONLY a single JSON object. Start with { immediately.

SECTION: ${sectionCode} — ${sectionName}
SPEC: ${getSectionInstructions(sectionCode)}

RULES:
- Real KOL names, real verifiable people in specified regions
- Real numbers, real platforms, real cultural references  
- Apply CLIENT KB vocabulary exactly
- Multi-country: per-country specifics, not generic SEA
- Populate ALL arrays fully — never return empty arrays
- No prose, no markdown. JSON only.`;

    // Retry once on rate limit (429)
    let response;
    try {
      response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 3000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      });
    } catch (rateLimitErr) {
      if (rateLimitErr.status === 429) {
        console.warn(`[GEN] ${sectionCode} — rate limited, waiting 15s then retrying`);
        await new Promise(r => setTimeout(r, 15000));
        response = await anthropic.messages.create({
          model: MODEL,
          max_tokens: 3000,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }]
        });
      } else {
        throw rateLimitErr;
      }
    }

    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    console.log(`[GEN] ${sectionCode} — textLen:${text.length}`);

    const sectionData = extractSectionData(text);

    if (!sectionData) {
      console.error(`[GEN] ${sectionCode} — no valid JSON. Raw: ${text.slice(0, 200)}`);
      return res.json({ section: { code: sectionCode, name: sectionName, data: { error: 'Generation failed', raw: text.slice(0, 150) } } });
    }

    console.log(`[GEN] ${sectionCode} done — keys: ${Object.keys(sectionData).join(',')}`);
    res.json({ section: { code: sectionCode, name: sectionName, data: sectionData } });

  } catch (err) {
    console.error(`[GEN ERROR] ${sectionCode}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── /api/regenerate-slide ──
// Web search enabled — when team gives feedback, Claude can search for current references
app.post('/api/regenerate-slide', async (req, res) => {
  const { brief, sectionCode, sectionName, currentData, feedback } = req.body;

  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
    }

    const kb = await loadKB(brief.client || 'mihoyo');

    const systemPrompt = `You are the WHIM Creative Engine. Regenerate a proposal section based on team feedback.

━━━ CLIENT KB ━━━
${kb}
━━━ END KB ━━━

Output ONLY a JSON object with this exact structure:
{ "code": "${sectionCode}", "name": "${sectionName || sectionCode}", "data": { ... section data ... } }

Section spec: ${getSectionInstructions(sectionCode)}

Apply feedback while keeping the JSON structure. Real names, real numbers. JSON only.`;

    const userPrompt = `BRIEF:\n${JSON.stringify(brief, null, 2)}\n\nCURRENT DATA:\n${JSON.stringify(currentData, null, 2)}\n\nTEAM FEEDBACK: "${feedback}"\n\nRegenerate applying the feedback. JSON only.`;

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    console.log(`[REGEN] ${sectionCode} textLen:${text.length}`);

    const parsed = extractSectionData(text);
    if (!parsed) throw new Error('No valid JSON in response');

    // Normalise response: always return { section: { code, name, data } }
    let sectionData;
    if (parsed.data && typeof parsed.data === 'object' && Object.keys(parsed.data).length > 0) {
      sectionData = parsed.data;
    } else if (parsed.code || parsed.name) {
      const { code: _c, name: _n, data: _d, ...rest } = parsed;
      sectionData = _d || rest;
    } else {
      sectionData = parsed;
    }

    res.json({
      section: {
        code: sectionCode,
        name: sectionName || sectionCode,
        data: sectionData
      }
    });

  } catch (err) {
    console.error('[REGEN ERROR]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── /api/brand ──
app.get('/api/brand/:client', (req, res) => {
  res.json(CLIENT_BRAND[req.params.client] || CLIENT_BRAND.mihoyo);
});

// ── /api/kb ──
app.get('/api/kb/:client', async (req, res) => {
  const kb = await loadKB(req.params.client);
  res.json({ kb });
});

// ── HEALTH ──
app.get('/health', (_, res) => res.json({
  ok: true, service: 'WHIM Creative Engine', version: '4.2',
  hasKey: !!process.env.ANTHROPIC_API_KEY,
  hasAuth: !!process.env.AUTH_PASSWORD,
  model: MODEL
}));

app.get('*', (_, res) => res.sendFile(join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✦ WHIM Creative Engine v4.2 → Port ${PORT}`);
  console.log(`✦ ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? 'SET ✓' : 'MISSING ✗'}`);
  console.log(`✦ AUTH_PASSWORD: ${process.env.AUTH_PASSWORD ? 'SET ✓' : 'MISSING'}`);
  console.log(`✦ Model: ${MODEL}`);
});
