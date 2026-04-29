# WHIM Creative Engine v3.0

SEA gaming campaign proposal generator. Internal tool for Account Managers, Creative Strategists, and Business Development.

## Setup

```bash
git clone https://github.com/WHIM-agency/creative-engine
cd creative-engine
npm install
cp .env.example .env  # fill in your keys
npm run dev
```

## Deploy to Railway

1. Push to GitHub (private repo)
2. Railway → New Project → Deploy from GitHub
3. Add environment variables in Railway dashboard
4. Auto-deploys on every push to `main`

## Environment Variables

```
ANTHROPIC_API_KEY=sk-ant-...
AUTH_PASSWORD=your-internal-code
PORT=3000
```

## File Structure

```
server.js          → Express API server (auth, research, generation, KB serving)
public/index.html  → Complete SPA frontend
package.json       → Dependencies
kb/
  mihoyo.md        → miHoYo/HoYoverse client knowledge base
  riot.md          → Riot Games client knowledge base
  tencent.md       → Tencent Games client knowledge base
  netease.md       → NetEase Games client knowledge base
```

## Updating Client Knowledge

Edit the KB files directly in GitHub and push. The server loads them fresh on each request — no code changes needed.

## The 6 Project Types

| Type | Primary Client | Output |
|---|---|---|
| New Game Launch | NetEase, Tencent | Competitor map + per-country KOL plan |
| Seasonal Campaign | miHoYo, Tencent | 3-pillar: KOL/Show/UGC |
| Game Update/Collab | miHoYo, NetEase | Update overview + content ideation |
| Social Media Retainer | Riot (primary) | Problem audit + content pillars + calendar |
| Event Management | Tencent (primary) | OOH + booth + stage rundown |
| Multi-Region KOL | NetEase, Tencent | 5-phase per-country KOL seeding |

## Visual Direction + Video Prompts

Every proposal ends with:
- **Visual Direction** — campaign aesthetic, colors, character usage, hero image concept
- **Veo/Seedance Prompts** — one prompt per campaign pillar, ready to copy-paste into AI video generators

## Two-Stage Generation

1. **Stage 1 (Research)** — fires web searches tailored to client × project type, builds a research digest
2. **Stage 2 (Generation)** — uses CLIENT_KB + research digest + PDF brief to generate the proposal

## Adding Retainer Types

When new retainer reference decks are uploaded, update `kb/[client].md` with the new pitch structure and regenerate. The retainer project type is built — the KB for non-Riot retainer patterns will be filled in as decks are added.
