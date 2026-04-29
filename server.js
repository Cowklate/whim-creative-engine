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

app.get('/api/kb/:client', async (req, res) => {
  const kb = await loadKB(req.params.client);
  res.json({ kb });
});

// ── STAGE 1: RESEARCH ──
app.post('/api/research', async (req, res) => {
  const { brief } = req.body;

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

    send({ type: 'search', count: 1, query: 'analyzing brief' });

    const prompt = `SEA gaming market researcher for WHIM. Return research digest as JSON.

BRIEF:
- Client: ${brief.client}
- Project: ${brief.projectType}
- Game: ${brief.game}
- Regions: ${(brief.regions || []).join(', ')}
- Moment: ${brief.moment || 'N/A'}
- Genre: ${brief.genre || 'N/A'}
- Objective: ${brief.objective || 'N/A'}

Return ONLY valid JSON:
{
  "competitorData": "string",
  "audienceInsights": "string",
  "contentTrends": "string",
  "kols": { "TH": [], "ID": [], "MY": [] },
  "culturalContext": "string",
  "viralFormats": "string"
}

Be specific — name real KOLs, real games, real numbers.`;

    send({ type: 'search', count: 2, query: 'building digest' });

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: 'SEA gaming market researcher. Return ONLY valid JSON, no markdown.',
      messages: [{ role: 'user', content: prompt }]
    });

    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const digest = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw: text };

    send({ type: 'done', digest });
  } catch (err) {
    console.error('Research error:', err.message);
    send({ type: 'error', message: err.message });
  }
  res.end();
});

async function buildSystemPrompt(brief, kb) {
  const regionStr = Array.isArray(brief.regions) ? brief.regions.join(', ') : 'SEA';
  const outputSpec = getOutputSpec(brief.projectType);

  return `You are the WHIM Creative Engine — AI brain of WHIM, a leading SEA gaming marketing agency (part of ATTN Group).

You generate proposals matching WHIM's proprietary format. Deep knowledge of SEA gaming markets, KOL ecosystems, cultural moments across Indonesia, Thailand, Malaysia, Vietnam, Philippines.

━━━ CLIENT KNOWLEDGE BASE ━━━
${kb}
━━━ END CLIENT KB ━━━

━━━ TARGET REGIONS ━━━
${regionStr}

━━━ OUTPUT FORMAT ━━━
Generate exactly ${outputSpec.sections.length} sections.
Each MUST be prefixed: ===SECTION_[N]_[CODE]===

${outputSpec.sections.map((s, i) => `===SECTION_${i + 1}_${s.code}===\n${s.instructions}`).join('\n\n')}

CRITICAL RULES:
1. ALL KOL names must be real, verifiable people in specified regions
2. Apply CLIENT KB vocabulary exactly
3. Multi-country: per-country specifics, not generic SEA
4. Budget uses correct currency for client (check KB)
5. KEY VISUAL section LAST
6. Real numbers, real platforms, real cultural references
7. Start with ===SECTION_1_ immediately. NO preamble.`;
}

function getOutputSpec(projectType) {
  const specs = {
    new_launch: {
      sections: [
        { code: 'COMPETITOR_MAP', instructions: 'Tier 1 vs Tier 2 by revenue and active users. Per-country data. Matrix: Launch | Positioning | Visual | Multiplayer | Strength | Weakness | App Size.' },
        { code: 'CONTENT_TREND', instructions: '3-column per country. Content culture quote + 3 real viral content examples.' },
        { code: 'VIRAL_FORMATS', instructions: 'TH: BL pairs. ID: 5 Kages (Windah, DeanKT, Luthfi, Reza, Miawaug). MY: 7GL (Soloz, Feekz, Ombong, XK Penjaath).' },
        { code: 'COMM_STRATEGY', instructions: 'Game positioning. Per-audience message. Per-country campaign angle. Hashtag.' },
        { code: 'ROADMAP', instructions: '5-phase KOL roadmap. PHASE | DATES | ACTIVITIES | KOL DELIVERABLES.' },
        { code: 'CONTENT_DIRECTION', instructions: 'COUNTRY | KOL ARCHETYPE | CONTENT FOCUS | TONE | EXAMPLE IDEA.' },
        { code: 'KOL_PLAN', instructions: 'NAME | TIER | FOLLOWERS | PLATFORM | CONTENT STYLE | PHASE. 5-8 KOLs each.' },
        { code: 'ADDITIONAL_RESOURCES', instructions: '3-5 ideas outside scope with rationale.' },
        { code: 'BUDGET', instructions: 'PHASE | COUNTRY | ITEM | COST. USD. Totals + grand total.' },
        { code: 'KEY_VISUAL', instructions: 'VISUAL DIRECTION (aesthetic, palette, characters, hero concept). Then VIDEO PROMPTS — one per pillar/phase. Format: PILLAR: [name]\\nPLATFORM: [platform]\\nVEO/SEEDANCE PROMPT:\\n[8-15s prompt with opening shot, transitions, text overlay, color grade, music mood, ending frame, style, camera movement, no dialogue]' }
      ]
    },
    seasonal: {
      sections: [
        { code: 'AUDIENCE_OVERVIEW', instructions: 'Demographics. 3-column: Content Preference (4 formats with %) | Time Preference | KOL Preference (8 names). Headline insight.' },
        { code: 'MOMENT_INSIGHT', instructions: 'Cultural moment data. 4 large-number stats. Weekly curve. 3 trend examples. Strategic insight.' },
        { code: 'POPULAR_CONTENT', instructions: 'TITLE | PLATFORM | EST VIEWS | MAPS TO PILLAR. 4 game + 4 social media examples.' },
        { code: 'CAMPAIGN_OVERVIEW', instructions: 'Hero hashtag. Mission. 3 metrics: IMPRESSIONS | BUDGET | CPM. 3 pillar names.' },
        { code: 'COMM_STRATEGY', instructions: '3-col matrix: Former | Current | New Player. Theme + Message + Activity.' },
        { code: 'ROADMAP', instructions: 'TRACK | DATE RANGE | ACTIVITY | MILESTONE.' },
        { code: 'KOL_MARATHON', instructions: '8 KOLs × 14 days × 1 hour. NAME | CATEGORY | FOLLOWERS | TOTAL LIVE VIEWS. 2 Macro + 4 Micro + 2 Nano.' },
        { code: 'SHOW_DETAIL', instructions: '45-min, 2-segment. 1 Mega gaming KOL + 1 Macro cosplayer. Game items recreated IRL.' },
        { code: 'UGC_DETAIL', instructions: 'Filter mechanic. 5-step flow. 2 promoter KOLs. Winner mechanic.' },
        { code: 'BUDGET', instructions: 'Category | Item | Remark | Impressions | Budget | CPM. VAT 9%.' },
        { code: 'KEY_VISUAL', instructions: 'VISUAL DIRECTION + VIDEO PROMPTS (1 per pillar). Format: PILLAR: [name]\\nPLATFORM: [platform]\\nVEO/SEEDANCE PROMPT:\\n[full prompt]' }
      ]
    },
    update_collab: {
      sections: [
        { code: 'UPDATE_OVERVIEW', instructions: 'What is new. Why it matters. Collab rationale.' },
        { code: 'COMMUNITY_INSIGHT', instructions: 'Community response patterns. Content opportunities.' },
        { code: 'CAMPAIGN_OVERVIEW', instructions: 'Hashtag + mission + 3 metrics + pillars.' },
        { code: 'COMM_STRATEGY', instructions: 'Audience × message × activity matrix.' },
        { code: 'ROADMAP', instructions: 'Timeline adapted to update.' },
        { code: 'CONTENT_IDEATION', instructions: 'Update-specific content per pillar.' },
        { code: 'KOL_PLAN', instructions: 'NAME | TIER | FOLLOWERS | PLATFORM | CONTENT ANGLE.' },
        { code: 'BUDGET', instructions: 'Per pillar with impressions/CPM. Total + VAT.' },
        { code: 'KEY_VISUAL', instructions: 'VISUAL DIRECTION + VIDEO PROMPTS (1 per pillar).' }
      ]
    },
    retainer: {
      sections: [
        { code: 'THE_ASK', instructions: 'GAME | DIMENSION | ISSUE | WHAT IS WORKING.' },
        { code: 'COMMUNITY_VOICE', instructions: 'Real player quotes. Dominators vs Social Players. Name + city + quote.' },
        { code: 'THE_PROBLEMS', instructions: 'GAME | PROBLEM NODES.' },
        { code: 'OUR_SOLUTION', instructions: 'GAME | PROBLEM → SOLUTION | CONTENT IP NAME.' },
        { code: 'CONTENT_PILLARS', instructions: '4-col: PROMOTION | INTERACTIVE | EDUCATION | ENTERTAINMENT.' },
        { code: 'CONTENT_CALENDAR', instructions: '4-week grid per game.' },
        { code: 'SOW_DELIVERABLES', instructions: 'SOW + content counts.' },
        { code: 'KPIS', instructions: 'Per-platform targets. Month 1 → 2 → 3 progression.' },
        { code: 'WORKFLOW', instructions: '5-step Day -10 to Day 0.' },
        { code: 'TEAM_COMPOSITION', instructions: 'Org chart, named roles + counts.' },
        { code: 'BUDGET', instructions: 'Item | Remarks | Duration | Price/Month | Total. VAT 11% Riot, 9% others.' },
        { code: 'KEY_VISUAL', instructions: 'VISUAL DIRECTION + VIDEO PROMPTS (1 per game).' }
      ]
    },
    event: {
      sections: [
        { code: 'PROJECT_BACKGROUND', instructions: 'Cultural moment statistics. INSIGHT TITLE | DATA POINT | STRATEGIC IMPLICATION.' },
        { code: 'CAMPAIGN_OVERVIEW', instructions: '3-phase activation matrix. OOH / Offline Event / KOL Marketing × Pre-Heat | Build-Up | Event.' },
        { code: 'OOH_DETAIL', instructions: 'Truck + 3 social mechanic alternatives. Train Wrap. Bangkok BTS = 60 stations, 768 screens, 2.4M daily.' },
        { code: 'BOOTH_ACTIVITIES', instructions: 'Zones + Sessions.' },
        { code: 'ON_STAGE_ACTIVITY', instructions: 'Game-specific mechanic. Prize pool USD + local.' },
        { code: 'VENUE', instructions: 'Specific venue + address + dates + footfall.' },
        { code: 'MERCHANDISE', instructions: 'Item | Design concept | Reference type.' },
        { code: 'EVENT_OVERVIEW', instructions: '4 activities: KOL Showmatch | KOC Tournament | Booth | Drone Show.' },
        { code: 'STAGE_RUNDOWN', instructions: 'Hour-by-hour. START | END | DURATION | ACTIVITY. Day 1 BL Battle / Day 2 Girls / Day 3 Top Gaming.' },
        { code: 'MARKETING_PLAN', instructions: '3-phase timeline + hashtags + reach.' },
        { code: 'KOL_PROMOTION_PLAN', instructions: 'Category × Phase. Boys Love (TH only) / KOL Gaming / Vlog KOL.' },
        { code: 'KOL_SHOWMATCH_ROSTER', instructions: 'NAME | HANDLE | PLATFORM | FOLLOWERS. By day + battle format.' },
        { code: 'KOC_TOURNAMENT', instructions: '32→16→8. Fees Mega $1900 / Macro $1000 / Micro $700 / Nano $500.' },
        { code: 'BUDGET', instructions: 'OOH + Event production + KOL + Prize/Merch. USD + local.' },
        { code: 'KEY_VISUAL', instructions: 'VISUAL DIRECTION + VIDEO PROMPTS (1 per phase). Format: PILLAR: [name]\\nPLATFORM: [platform]\\nVEO/SEEDANCE PROMPT:\\n[full prompt]' }
      ]
    },
    multi_kol: {
      sections: [
        { code: 'COMPETITOR_MAP', instructions: 'Tier 1 vs Tier 2 per country.' },
        { code: 'CONTENT_TREND', instructions: 'Per-country content trend.' },
        { code: 'VIRAL_FORMATS', instructions: 'TH: BL. ID: 5 Kages. MY: 7GL.' },
        { code: 'COMM_STRATEGY', instructions: 'Positioning + per-country angle + hashtag.' },
        { code: 'ROADMAP', instructions: '5-phase. PHASE | DATES | TH | ID | MY ACTIVITY.' },
        { code: 'CONTENT_DIRECTION', instructions: 'COUNTRY | KOL ARCHETYPE | CONTENT FOCUS | TONE | EXAMPLES.' },
        { code: 'KOL_PLAN', instructions: '5-8 KOLs per country.' },
        { code: 'ADDITIONAL_RESOURCES', instructions: '3-5 bonus suggestions.' },
        { code: 'BUDGET', instructions: 'PHASE | COUNTRY | ITEM | COST. USD.' },
        { code: 'KEY_VISUAL', instructions: 'VISUAL DIRECTION + VIDEO PROMPTS (1 per country).' }
      ]
    }
  };
  return specs[projectType] || specs.seasonal;
}

function buildUserPrompt(brief, pdfContext, researchDigest) {
  let p = `Generate complete WHIM proposal.\n\n━━━ BRIEF ━━━\n`;
  if (brief.game) p += `GAME: ${brief.game}\n`;
  if (brief.projectType) p += `PROJECT TYPE: ${brief.projectType.replace(/_/g, ' ').toUpperCase()}\n`;
  if (brief.regions?.length) p += `REGIONS: ${brief.regions.join(', ')}\n`;
  if (brief.moment) p += `MOMENT: ${brief.moment}\n`;
  if (brief.genre) p += `GENRE: ${brief.genre}\n`;
  if (brief.budget) p += `BUDGET: $${Number(brief.budget).toLocaleString()} USD\n`;
  if (brief.objective) p += `OBJECTIVES: ${brief.objective}\n`;
  if (brief.hashtag) p += `HASHTAG: ${brief.hashtag}\n`;
  if (brief.updateName) p += `UPDATE: ${brief.updateName}\n`;
  if (brief.collabPartner) p += `COLLAB IP: ${brief.collabPartner}\n`;
  if (brief.eventType) p += `EVENT TYPE: ${brief.eventType}\n`;
  if (brief.venueCity) p += `VENUE CITY: ${brief.venueCity}\n`;
  if (brief.eventDates) p += `DATES: ${brief.eventDates}\n`;
  if (brief.usp) p += `USP: ${brief.usp}\n`;
  if (brief.competitors) p += `COMPETITORS: ${brief.competitors}\n`;

  if (pdfContext) p += `\n━━━ PDF BRIEF ━━━\n${pdfContext.slice(0, 7000)}\n━━━ END PDF ━━━\n`;
  if (researchDigest) p += `\n━━━ RESEARCH ━━━\n${typeof researchDigest === 'object' ? JSON.stringify(researchDigest, null, 2) : researchDigest}\n━━━ END RESEARCH ━━━\n`;
  p += `\nGenerate ALL sections with ===SECTION_N_CODE=== prefixes. Real names, real numbers. Start now.`;
  return p;
}

// ── STAGE 2: STREAMING (using async iteration — the working pattern) ──
app.post('/api/generate', async (req, res) => {
  const { brief, pdfContext, researchDigest } = req.body;

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
    const systemPrompt = await buildSystemPrompt(brief, kb);
    const userPrompt = buildUserPrompt(brief, pdfContext, researchDigest);

    console.log(`[GEN START] ${brief.client} / ${brief.projectType} / ${brief.game}`);
    console.log(`[GEN] System prompt length: ${systemPrompt.length} chars`);
    console.log(`[GEN] User prompt length: ${userPrompt.length} chars`);

    // Use messages.create with stream:true and async iteration
    const stream = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      stream: true,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    let totalText = 0;
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        totalText += event.delta.text.length;
        send({ type: 'text', text: event.delta.text });
      } else if (event.type === 'message_stop') {
        console.log(`[GEN END] Total text: ${totalText} chars`);
        send({ type: 'done' });
      }
    }
    res.end();
  } catch (err) {
    console.error('[GEN ERROR]', err.message);
    console.error('[GEN ERROR STACK]', err.stack);
    if (err.error) console.error('[GEN ERROR DETAIL]', JSON.stringify(err.error));
    if (err.status) console.error('[GEN ERROR STATUS]', err.status);
    send({ type: 'error', message: err.message + (err.status ? ` (${err.status})` : '') });
    res.end();
  }
});

app.get('/health', (_, res) => res.json({
  ok: true,
  service: 'WHIM Creative Engine',
  version: '3.0',
  hasKey: !!process.env.ANTHROPIC_API_KEY,
  hasAuth: !!process.env.AUTH_PASSWORD,
  model: MODEL
}));

app.get('*', (_, res) => res.sendFile(join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✦ WHIM Creative Engine v3.0 → Port ${PORT}`);
  console.log(`✦ ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? 'SET ✓' : 'MISSING ✗'}`);
  console.log(`✦ AUTH_PASSWORD: ${process.env.AUTH_PASSWORD ? 'SET ✓' : 'MISSING'}`);
  console.log(`✦ Model: ${MODEL}`);
});
