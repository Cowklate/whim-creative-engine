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

app.use('/api', (req, res, next) => {
  const pwd = req.headers['x-auth'];
  if (process.env.AUTH_PASSWORD && pwd !== process.env.AUTH_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// ── CLIENT BRAND CONFIG ──
const CLIENT_BRAND = {
  mihoyo: { primary: '#7C5BBF', secondary: '#F4C95D', bg: '#0F0B1F', text: '#F5F1FF', accent: '#E8C77E', mood: 'midnight blue, gold accents, anime cinematic' },
  riot: { primary: '#D32226', secondary: '#0B3A5B', bg: '#0A1929', text: '#F0F4F8', accent: '#1FB8DB', mood: 'navy, red, esports corporate' },
  tencent: { primary: '#F39C12', secondary: '#2980B9', bg: '#FAFAF7', text: '#1A1A1A', accent: '#E74C3C', mood: 'white, gold, premium event' },
  netease: { primary: '#27AE60', secondary: '#2C3E50', bg: '#FFFFFF', text: '#1A1A1A', accent: '#3498DB', mood: 'white, data-heavy, analytical' }
};

// ── OUTPUT SPEC PER PROJECT TYPE ──
function getOutputSpec(projectType) {
  const specs = {
    new_launch: [
      { code: 'COVER', name: 'Cover', slides: 1 },
      { code: 'TOC', name: 'Table of Contents', slides: 1 },
      { code: 'COMPETITOR_MAP', name: 'Competitor Mapping', slides: 2 },
      { code: 'CONTENT_TREND', name: 'Content Trends by Country', slides: 1 },
      { code: 'VIRAL_FORMATS', name: 'What\'s Viral Per Country', slides: 1 },
      { code: 'COMM_STRATEGY', name: 'Communication Strategy', slides: 1 },
      { code: 'ROADMAP', name: 'Campaign Roadmap', slides: 1 },
      { code: 'CONTENT_DIRECTION', name: 'Content Direction', slides: 1 },
      { code: 'KOL_PLAN', name: 'KOL Plan', slides: 2 },
      { code: 'ADDITIONAL_RESOURCES', name: 'Additional Resources', slides: 1 },
      { code: 'BUDGET', name: 'Budget', slides: 1 },
      { code: 'KEY_VISUAL', name: 'Key Visual & Video Prompts', slides: 2 }
    ],
    seasonal: [
      { code: 'COVER', name: 'Cover', slides: 1 },
      { code: 'AUDIENCE_OVERVIEW', name: 'Audience Overview', slides: 2 },
      { code: 'MOMENT_INSIGHT', name: 'Moment Insight', slides: 2 },
      { code: 'POPULAR_CONTENT', name: 'Popular Content', slides: 1 },
      { code: 'CAMPAIGN_OVERVIEW', name: 'Campaign Overview', slides: 1 },
      { code: 'COMM_STRATEGY', name: 'Communication Strategy', slides: 1 },
      { code: 'ROADMAP', name: 'Campaign Roadmap', slides: 1 },
      { code: 'KOL_MARATHON', name: 'KOL Stream Marathon', slides: 2 },
      { code: 'SHOW_DETAIL', name: 'Pre-recorded Show', slides: 1 },
      { code: 'UGC_DETAIL', name: 'UGC Challenge', slides: 1 },
      { code: 'BUDGET', name: 'Budget', slides: 1 },
      { code: 'KEY_VISUAL', name: 'Key Visual & Video Prompts', slides: 2 }
    ],
    update_collab: [
      { code: 'COVER', name: 'Cover', slides: 1 },
      { code: 'UPDATE_OVERVIEW', name: 'Update / Collab Overview', slides: 1 },
      { code: 'COMMUNITY_INSIGHT', name: 'Community Insight', slides: 1 },
      { code: 'CAMPAIGN_OVERVIEW', name: 'Campaign Overview', slides: 1 },
      { code: 'COMM_STRATEGY', name: 'Communication Strategy', slides: 1 },
      { code: 'ROADMAP', name: 'Campaign Roadmap', slides: 1 },
      { code: 'CONTENT_IDEATION', name: 'Content Ideation', slides: 1 },
      { code: 'KOL_PLAN', name: 'KOL Plan', slides: 1 },
      { code: 'BUDGET', name: 'Budget', slides: 1 },
      { code: 'KEY_VISUAL', name: 'Key Visual & Video Prompts', slides: 1 }
    ],
    retainer: [
      { code: 'COVER', name: 'Cover', slides: 1 },
      { code: 'TOC', name: 'Table of Contents', slides: 1 },
      { code: 'THE_ASK', name: 'The Ask', slides: 2 },
      { code: 'COMMUNITY_VOICE', name: 'Community Voice', slides: 2 },
      { code: 'THE_PROBLEMS', name: 'The Problems', slides: 1 },
      { code: 'OUR_SOLUTION', name: 'Our Solution', slides: 1 },
      { code: 'CONTENT_PILLARS', name: 'Content Pillars', slides: 2 },
      { code: 'CONTENT_CALENDAR', name: 'Content Calendar', slides: 1 },
      { code: 'SOW_DELIVERABLES', name: 'SOW + Deliverables', slides: 1 },
      { code: 'KPIS', name: 'KPIs', slides: 1 },
      { code: 'WORKFLOW', name: 'Workflow', slides: 1 },
      { code: 'TEAM_COMPOSITION', name: 'Team Composition', slides: 1 },
      { code: 'BUDGET', name: 'Budget', slides: 1 }
    ],
    event: [
      { code: 'COVER', name: 'Cover', slides: 1 },
      { code: 'PROJECT_BACKGROUND', name: 'Project Background & Insights', slides: 2 },
      { code: 'CAMPAIGN_OVERVIEW', name: 'Campaign Overview', slides: 1 },
      { code: 'OOH_DETAIL', name: 'OOH Detail', slides: 2 },
      { code: 'BOOTH_ACTIVITIES', name: 'Booth Activities', slides: 1 },
      { code: 'ON_STAGE_ACTIVITY', name: 'On-Stage Activity', slides: 1 },
      { code: 'VENUE', name: 'Venue', slides: 1 },
      { code: 'EVENT_OVERVIEW', name: 'Event Overview', slides: 1 },
      { code: 'STAGE_RUNDOWN', name: 'Stage Rundown', slides: 1 },
      { code: 'KOL_SHOWMATCH_ROSTER', name: 'KOL Showmatch Roster', slides: 2 },
      { code: 'KOC_TOURNAMENT', name: 'KOC Tournament', slides: 1 },
      { code: 'BUDGET', name: 'Budget', slides: 1 },
      { code: 'KEY_VISUAL', name: 'Key Visual & Video Prompts', slides: 2 }
    ],
    multi_kol: [
      { code: 'COVER', name: 'Cover', slides: 1 },
      { code: 'TOC', name: 'Table of Contents', slides: 1 },
      { code: 'COMPETITOR_MAP', name: 'Competitor Mapping', slides: 2 },
      { code: 'CONTENT_TREND', name: 'Content Trend', slides: 1 },
      { code: 'VIRAL_FORMATS', name: 'What\'s Viral Per Country', slides: 1 },
      { code: 'COMM_STRATEGY', name: 'Communication Strategy', slides: 1 },
      { code: 'ROADMAP', name: 'Campaign Roadmap (5-phase)', slides: 1 },
      { code: 'CONTENT_DIRECTION', name: 'Content Direction', slides: 1 },
      { code: 'KOL_PLAN', name: 'KOL Plan Per Country', slides: 2 },
      { code: 'ADDITIONAL_RESOURCES', name: 'Additional Resources', slides: 1 },
      { code: 'BUDGET', name: 'Budget', slides: 1 },
      { code: 'KEY_VISUAL', name: 'Key Visual & Video Prompts', slides: 2 }
    ]
  };
  return specs[projectType] || specs.seasonal;
}

// ── SECTION INSTRUCTIONS ──
function getSectionInstructions(code) {
  const inst = {
    COVER: 'Cover slide. Output JSON: { "title": "campaign title", "subtitle": "client + project type + region", "tagline": "1 punchy line capturing the campaign essence" }',
    TOC: 'Table of contents. Output JSON: { "sections": ["section name 1", "section name 2", ...] } — list the main sections in order',
    COMPETITOR_MAP: 'JSON: { "headline": "1-line market positioning", "tier1": [{ "name": "X", "publisher": "Y", "country": "country flag emoji + name" }], "tier2": [...], "matrix": [{ "name": "Game", "launch": "date", "positioning": "...", "visual": "...", "multiplayer": "yes/no", "strength": "...", "weakness": "...", "appSize": "..." }] }',
    CONTENT_TREND: 'JSON: { "headline": "1-line cross-country insight", "countries": [{ "code": "TH/ID/MY", "name": "Thailand", "flag": "🇹🇭", "quote": "content culture summary in 1 sentence", "examples": [{ "title": "video title", "creator": "name", "views": "X views", "platform": "YouTube/TikTok" }] }] }',
    VIRAL_FORMATS: 'JSON: { "headline": "headline insight", "countries": [{ "code": "TH", "name": "Thailand", "flag": "🇹🇭", "format": "BL pairs / 5 Kages / 7GL", "creators": [{ "name": "...", "followers": "...", "platform": "..." }], "viralExample": { "title": "...", "views": "...", "context": "..." } }] }',
    COMM_STRATEGY: 'JSON: { "hashtag": "#CampaignTag", "positioning": "1-sentence game positioning", "audiences": [{ "segment": "Former Player / Current / New", "theme": "Companionship / Inspiration / Joy", "message": "1-sentence message", "activity": "what they do" }] }',
    ROADMAP: 'JSON: { "headline": "campaign timeline summary", "phases": [{ "phase": "Phase 1: Pre-Heat", "dates": "Date range", "activities": ["activity 1", "activity 2"], "deliverables": "what gets shipped" }] }',
    CONTENT_DIRECTION: 'JSON: { "headline": "1-line direction summary", "countries": [{ "code": "TH", "name": "Thailand", "flag": "🇹🇭", "kolArchetype": "BL + Gaming", "contentFocus": "educational/tutorial", "tone": "humor / heartfelt / etc", "exampleIdeas": ["idea 1", "idea 2"] }] }',
    KOL_PLAN: 'JSON: { "headline": "roster summary", "tiers": { "mega": "1+ KOLs", "macro": "2 KOLs", "micro": "4 KOLs", "nano": "2 KOLs" }, "kols": [{ "name": "Real Name", "tier": "Mega/Macro/Micro/Nano", "followers": "X.XM", "platform": "YouTube/TikTok/IG", "country": "TH", "style": "1-line content style", "phase": "Phase 1-2" }] }',
    ADDITIONAL_RESOURCES: 'JSON: { "headline": "scope-extending creative ideas", "ideas": [{ "title": "Idea name", "rationale": "why it works", "estimatedImpact": "expected outcome" }] }',
    BUDGET: 'JSON: { "headline": "budget summary", "currency": "USD/IDR/THB", "lineItems": [{ "category": "KOL Marketing", "item": "Mega KOL fee", "remark": "1 KOL × $X", "impressions": "5M", "cost": 25000, "cpm": 5 }], "subtotal": 100000, "vat": 9000, "total": 109000 }',
    KEY_VISUAL: 'JSON: { "direction": { "aesthetic": "tone description", "palette": ["#color1", "#color2"], "characters": "which game characters/mascots", "typography": "font direction", "heroConcept": "1-paragraph hero image description" }, "videoPrompts": [{ "pillar": "Pillar name", "platform": "TikTok vertical 8s / YouTube horizontal 30s", "prompt": "Full Veo/Seedance prompt with opening shot, transitions, text overlay, color grade, music mood, ending frame, style, camera movement, no dialogue" }] }',
    AUDIENCE_OVERVIEW: 'JSON: { "headline": "audience profile", "demographics": { "gender": "X% male", "age": "Y range", "veteran": "Z% playing 3+ years" }, "contentPref": [{ "format": "Cooking IRL", "percent": 40 }], "timePref": [{ "window": "Ngabuburit 16:00-18:00", "percent": 65 }], "kolPref": ["KOL 1", "KOL 2"] }',
    MOMENT_INSIGHT: 'JSON: { "headline": "1-line cultural moment finding", "stats": [{ "value": "84%", "label": "search food during Ramadan", "source": "Google Trends" }], "weeklyCurve": [{ "week": "Week 1", "intensity": "low/peak/etc", "behavior": "what people do" }], "trendExamples": [{ "title": "...", "platform": "TikTok", "views": "12M" }], "insight": "2-sentence strategic implication" }',
    POPULAR_CONTENT: 'JSON: { "headline": "what content wins", "gameContent": [{ "title": "...", "platform": "...", "views": "...", "mapsTo": "Pillar name" }], "socialContent": [{ "title": "...", "platform": "...", "views": "...", "format": "format type" }] }',
    CAMPAIGN_OVERVIEW: 'JSON: { "hashtag": "#TagName", "mission": "1-paragraph campaign mission", "metrics": { "impressions": "46M", "budget": "$150K", "cpm": "$3.18" }, "pillars": [{ "name": "Pillar 1", "description": "what it is", "color": "#hex" }] }',
    KOL_MARATHON: 'JSON: { "headline": "stream marathon overview", "format": "8 KOLs × 14 days × 1 hour", "themes": [{ "theme": "Theme 1", "description": "..." }], "kols": [{ "name": "...", "category": "Macro/Micro/Nano", "followers": "...", "totalLiveViews": "...", "platform": "..." }] }',
    SHOW_DETAIL: 'JSON: { "title": "Show name", "format": "45-min, 2-segment", "kols": [{ "name": "...", "role": "Mega gaming KOL / Cosplayer", "followers": "..." }], "segments": [{ "name": "Segment 1", "description": "..." }], "irlElements": ["food item recreated", "..."] }',
    UGC_DETAIL: 'JSON: { "mechanic": "AR filter / hashtag challenge name", "estimatedParticipants": 3000, "flow": ["Step 1", "Step 2", "Step 3", "Step 4", "Step 5"], "kols": [{ "name": "...", "category": "Entertainment/Beauty", "followers": "..." }], "winnerMechanic": "how winners are selected" }',
    UPDATE_OVERVIEW: 'JSON: { "name": "Update/Collab name", "whatNew": ["new feature 1", "new feature 2"], "rationale": "why this matters to the community", "anniversaryContext": "if applicable" }',
    COMMUNITY_INSIGHT: 'JSON: { "headline": "community insight", "responsePatterns": [{ "type": "Past update reception", "data": "..." }], "platformData": "platform-specific data", "opportunities": ["opp 1", "opp 2"] }',
    CONTENT_IDEATION: 'JSON: { "headline": "content directions for this update", "ideas": [{ "pillar": "Pillar name", "title": "Content idea", "platform": "...", "format": "..." }] }',
    THE_ASK: 'JSON: { "headline": "diagnosis summary", "diagnosis": [{ "game": "VALORANT", "dimension": "Content / Visual / Communication / Approach", "issue": "what is broken", "working": "what is working" }] }',
    COMMUNITY_VOICE: 'JSON: { "headline": "what players are saying", "quotes": [{ "name": "Real first name", "city": "Jakarta", "type": "Dominator/Social Player", "game": "VALORANT", "quote": "real-sounding player quote" }] }',
    THE_PROBLEMS: 'JSON: { "headline": "problem framework", "perGame": [{ "game": "VALORANT", "problems": ["Hyperlocal Content", "Rigid Visuals", "Two-way communication"] }] }',
    OUR_SOLUTION: 'JSON: { "headline": "solution framework", "perGame": [{ "game": "VALORANT", "solutions": [{ "problem": "...", "solution": "...", "contentIP": "VALOSOPHY (named series)" }] }] }',
    CONTENT_PILLARS: 'JSON: { "headline": "pillar framework", "perGame": [{ "game": "VALORANT", "pillars": [{ "name": "Promotion", "objective": "...", "bigIdeas": ["idea 1"], "outputs": ["TikTok Short Video", "IG Posts"] }] }] }',
    CONTENT_CALENDAR: 'JSON: { "headline": "monthly plan", "perGame": [{ "game": "VALORANT", "weeks": [{ "week": 1, "posts": [{ "day": "Mon", "pillar": "Promotion", "content": "..." }] }] }] }',
    SOW_DELIVERABLES: 'JSON: { "scope": ["Content Strategy & Creation", "Content Scheduling", "..."], "deliverables": [{ "channel": "TikTok", "game": "VALORANT", "whimOriginal": 8, "globalAdapted": 4, "preHeatStory": 12 }] }',
    KPIS: 'JSON: { "headline": "growth trajectory", "platforms": [{ "platform": "Instagram", "month1": "+5%", "month2": "+10%", "month3": "+15%" }], "metrics": ["follower growth", "engagement rate", "reach"] }',
    WORKFLOW: 'JSON: { "steps": [{ "day": "Day -10", "action": "Ideation", "owner": "Strategist" }, { "day": "Day -8", "action": "Approval", "owner": "Client" }] }',
    TEAM_COMPOSITION: 'JSON: { "team": [{ "role": "Project Manager", "count": 1, "responsibility": "Single PIC" }, { "role": "Strategist", "count": 1, "responsibility": "Content Strategy" }] }',
    PROJECT_BACKGROUND: 'JSON: { "headline": "campaign rationale", "insights": [{ "title": "Insight 1", "dataPoint": "stat", "implication": "what it means for strategy" }], "coreStrategy": "1-paragraph strategy summary" }',
    OOH_DETAIL: 'JSON: { "movingTruck": { "concept": "...", "alternatives": [{ "mechanic": "...", "reasoning": "..." }] }, "trainWrap": { "city": "Bangkok BTS", "stations": 60, "screens": 768, "dailyReach": "2.4M users" } }',
    BOOTH_ACTIVITIES: 'JSON: { "zones": [{ "name": "Main Stage", "description": "..." }], "sessions": [{ "name": "Exhibition Match", "description": "..." }] }',
    ON_STAGE_ACTIVITY: 'JSON: { "name": "Activity name (e.g. Angbao Session)", "mechanic": "step-by-step", "prizePool": { "usd": 5000, "local": "₿180,000 THB" }, "terms": ["term 1", "term 2"] }',
    VENUE: 'JSON: { "name": "Icon Siam 7th Floor", "address": "Bangkok address", "dates": "Dec 27-29 2025", "footfall": "expected attendance", "pros": ["..."], "cons": ["..."] }',
    EVENT_OVERVIEW: 'JSON: { "activities": [{ "name": "KOL & Celeb Showmatch", "icon": "🎮", "description": "..." }, { "name": "KOC Tournament", "icon": "🏆", "description": "..." }] }',
    STAGE_RUNDOWN: 'JSON: { "days": [{ "day": "Day 1: BL Battle", "schedule": [{ "start": "14:00", "end": "15:00", "duration": "1h", "activity": "..." }] }] }',
    KOL_SHOWMATCH_ROSTER: 'JSON: { "headline": "roster overview", "days": [{ "day": "Day 1 BL Battle", "format": "groups of 4 BL actors", "kols": [{ "name": "...", "handle": "@...", "platform": "...", "followers": "..." }] }] }',
    KOC_TOURNAMENT: 'JSON: { "format": "32→16→8 over 3 days", "points": [{ "place": "1st", "points": 8 }], "fees": { "mega": 1900, "macro": 1000, "micro": 700, "nano": 500 } }'
  };
  return inst[code] || 'JSON: { "content": "section content as structured data" }';
}

// ── SYSTEM PROMPT ──
async function buildSystemPrompt(brief, kb, sectionsToGenerate) {
  const regionStr = Array.isArray(brief.regions) ? brief.regions.join(', ') : 'SEA';

  return `You are the WHIM Creative Engine — AI brain of WHIM, a leading SEA gaming marketing agency (part of ATTN Group: EVOS Esports + Noctua Games).

Generate proposals matching WHIM's proprietary format. Deep knowledge of SEA gaming markets (Indonesia, Thailand, Malaysia, Vietnam, Philippines), KOL ecosystems, cultural moments, and gaming community behavior.

━━━ CLIENT KNOWLEDGE BASE ━━━
${kb}
━━━ END CLIENT KB ━━━

━━━ TARGET REGIONS ━━━
${regionStr}

━━━ OUTPUT FORMAT — STRICT JSON ━━━
You MUST output a single JSON object with this exact structure:
{
  "sections": [
    {
      "code": "SECTION_CODE",
      "name": "Section Name",
      "data": { /* structured data per section spec */ }
    }
  ]
}

Generate these ${sectionsToGenerate.length} sections IN ORDER:

${sectionsToGenerate.map((s, i) => `${i + 1}. ${s.code} — ${s.name}\n   ${getSectionInstructions(s.code)}`).join('\n\n')}

CRITICAL RULES:
1. Output ONLY valid JSON. NO markdown, NO commentary, NO ===SECTION=== markers
2. ALL KOL names must be real, verifiable people in specified regions
3. Apply CLIENT KB vocabulary exactly
4. Multi-country: per-country specifics, not generic SEA
5. Real numbers, real platforms, real cultural references
6. Be specific, structured, data-rich. NO long prose paragraphs
7. Start with { immediately. NO preamble`;
}

// ── USER PROMPT ──
function buildUserPrompt(brief, pdfContext) {
  let p = `Generate WHIM proposal as JSON.\n\nBRIEF:\n`;
  if (brief.game) p += `- Game: ${brief.game}\n`;
  if (brief.projectType) p += `- Project: ${brief.projectType.replace(/_/g, ' ')}\n`;
  if (brief.regions?.length) p += `- Regions: ${brief.regions.join(', ')}\n`;
  if (brief.moment) p += `- Cultural Moment: ${brief.moment}\n`;
  if (brief.genre) p += `- Genre: ${brief.genre}\n`;
  if (brief.budget) p += `- Budget: $${Number(brief.budget).toLocaleString()} USD\n`;
  if (brief.objective) p += `- Objective: ${brief.objective}\n`;
  if (brief.hashtag) p += `- Hashtag idea: ${brief.hashtag}\n`;
  if (brief.updateName) p += `- Update/Collab: ${brief.updateName}\n`;
  if (brief.collabPartner) p += `- Collab IP: ${brief.collabPartner}\n`;
  if (brief.eventType) p += `- Event Type: ${brief.eventType}\n`;
  if (brief.venueCity) p += `- Venue City: ${brief.venueCity}\n`;
  if (brief.eventDates) p += `- Event Dates: ${brief.eventDates}\n`;
  if (brief.usp) p += `- USP: ${brief.usp}\n`;
  if (brief.competitors) p += `- Competitors: ${brief.competitors}\n`;

  if (pdfContext) p += `\nCLIENT BRIEF (from PDF):\n${pdfContext.slice(0, 6000)}\n`;

  p += `\nReturn JSON ONLY. Start with { immediately.`;
  return p;
}

// ── /api/generate (returns structured JSON) ──
app.post('/api/generate', async (req, res) => {
  const { brief, pdfContext } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      send({ type: 'error', message: 'ANTHROPIC_API_KEY not set' });
      return res.end();
    }

    const kb = await loadKB(brief.client || 'mihoyo');
    const allSections = getOutputSpec(brief.projectType);

    console.log(`[GEN] ${brief.client} / ${brief.projectType} / ${brief.game} — ${allSections.length} sections`);

    // Split into 2 calls if too many sections
    const splitPoint = allSections.length > 8 ? Math.ceil(allSections.length / 2) : allSections.length;
    const batches = allSections.length > 8
      ? [allSections.slice(0, splitPoint), allSections.slice(splitPoint)]
      : [allSections];

    let allResults = [];
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      send({ type: 'progress', message: `Generating batch ${i + 1}/${batches.length} (${batch.length} sections)`, percent: 10 + (i * 40) });

      const systemPrompt = await buildSystemPrompt(brief, kb, batch);
      const userPrompt = buildUserPrompt(brief, pdfContext);

      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      });

      const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in response');
      const parsed = JSON.parse(jsonMatch[0]);
      allResults.push(...(parsed.sections || []));

      send({ type: 'batch-done', batchNumber: i + 1, sections: parsed.sections, percent: 50 + (i * 40) });
    }

    send({ type: 'done', sections: allResults, percent: 100 });
  } catch (err) {
    console.error('[GEN ERROR]', err.message);
    if (err.error) console.error('[ERR DETAIL]', JSON.stringify(err.error));
    send({ type: 'error', message: err.message });
  }
  res.end();
});

// ── /api/regenerate-slide (for per-slide feedback iteration) ──
app.post('/api/regenerate-slide', async (req, res) => {
  const { brief, sectionCode, currentData, feedback } = req.body;

  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
    }

    const kb = await loadKB(brief.client || 'mihoyo');

    const systemPrompt = `You are the WHIM Creative Engine. Regenerate a single section based on feedback.

━━━ CLIENT KB ━━━
${kb}
━━━ END KB ━━━

Output ONLY a JSON object: { "code": "SECTION_CODE", "name": "Section Name", "data": { /* updated structured data */ } }

Section spec:
${getSectionInstructions(sectionCode)}

Apply the feedback while preserving structure. Real names, real numbers.`;

    const userPrompt = `BRIEF:\n${JSON.stringify(brief, null, 2)}\n\nCURRENT SECTION DATA:\n${JSON.stringify(currentData, null, 2)}\n\nFEEDBACK FROM TEAM:\n"${feedback}"\n\nRegenerate this section applying the feedback. Output JSON only.`;

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    const updated = JSON.parse(jsonMatch[0]);

    res.json({ section: updated });
  } catch (err) {
    console.error('[REGEN ERROR]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── /api/brand (returns brand colors per client) ──
app.get('/api/brand/:client', (req, res) => {
  res.json(CLIENT_BRAND[req.params.client] || CLIENT_BRAND.mihoyo);
});

app.get('/api/kb/:client', async (req, res) => {
  const kb = await loadKB(req.params.client);
  res.json({ kb });
});

app.get('/health', (_, res) => res.json({
  ok: true, service: 'WHIM Creative Engine', version: '4.0',
  hasKey: !!process.env.ANTHROPIC_API_KEY,
  hasAuth: !!process.env.AUTH_PASSWORD,
  model: MODEL
}));

app.get('*', (_, res) => res.sendFile(join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✦ WHIM Creative Engine v4.0 → Port ${PORT}`);
  console.log(`✦ ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? 'SET ✓' : 'MISSING ✗'}`);
  console.log(`✦ AUTH_PASSWORD: ${process.env.AUTH_PASSWORD ? 'SET ✓' : 'MISSING'}`);
  console.log(`✦ Model: ${MODEL}`);
});
