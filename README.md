# CPI — Client Profile Intake

Internal app for **Get You Right Consulting / Fund & Go**. Tracks credit and funding readiness for clients: banking, business structure, credit cards, and an extracted credit-report analysis (charge-offs, collections, late payments, repossessions, public records).

Built with Express + Vite + React + Tailwind + Drizzle (SQLite) + Anthropic Claude for PDF extraction.

---

## Local development

```bash
npm install
cp .env.example .env
# edit .env and set ANTHROPIC_API_KEY=sk-ant-...
npm run dev
```

Visit http://localhost:5000.

---

## Deploy to Railway

1. Push this repo to GitHub.
2. In Railway: **New Project → Deploy from GitHub repo → pick this repo**. Railway auto-detects Node and runs `npm ci && npm run build`, then `npm start`.
3. In **Variables** add:
   - `ANTHROPIC_API_KEY` — your Anthropic API key (required for PDF extraction)
   - `NODE_ENV` — `production`
   - `DATABASE_PATH` — `/data/data.db`
4. In **Settings → Volumes** create a volume mounted at `/data`. This makes client data survive redeploys.
5. In **Settings → Networking** click **Generate Domain** to get a public URL.

That's it. Railway rebuilds automatically on every push to `main`.

---

## Project layout

```
client/   React frontend (Vite, Tailwind, shadcn/ui)
server/   Express backend
shared/   Drizzle schema shared between frontend and backend
script/   Build pipeline
```

Frontend and backend are served from the same Express process on `process.env.PORT` (default 5000).

---

## Environment variables

See [`.env.example`](./.env.example).

| Var                 | Required | Notes                                                            |
| ------------------- | -------- | ---------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` | yes      | PDF credit-report auto-extraction (Claude).                      |
| `PORT`              | no       | Defaults to 5000. Railway sets this automatically.               |
| `DATABASE_PATH`     | no       | Defaults to `./data.db`. Set to `/data/data.db` on Railway.      |
| `NODE_ENV`          | no       | Set to `production` on Railway.                                  |
| `CLAUDE_MODEL`      | no       | Extraction model. Defaults to `claude-opus-5-5`.                 |
| `CLAUDE_EFFORT`     | no       | `low`–`max`. Blank = model default.                              |
| `VISION_MAX_PAGES`  | no       | Pages read in image mode (default 40, max 100).                  |
| `SEED_SAMPLE_DATA`  | no       | Sample clients: on in local dev, never in production unless `true`. |

---

## Scripts

- `npm run dev` — development server with hot reload
- `npm run build` — production build (client to `dist/public`, server to `dist/index.cjs`)
- `npm start` — run production build
- `npm run check` — TypeScript check
- `npm test` — unit tests for scoring and credit-report logic

## Scoring notes

- **Funding Readiness** = average of personal banking, business banking, utilization and revenue scores, minus 5 per missing document (max 20). A client can't reach **Funding Ready (80+)** while their mid credit score is under 680 or the report shows charge-offs, collections, repossessions, public records, or late payments in the last 12 months; the score is capped at 79 and each reason appears as a red flag and a next step. A manual override still wins.
- **Late payments** are bucketed by the reported date of the most recent late (within 12 / 12–24 / over 24 months). Items with no usable date are shown separately as "Date not reported" instead of being guessed.
- **Utilization** and all totals count open cards only; Closed and Charged Off cards are listed but excluded.
