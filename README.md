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

---

## Scripts

- `npm run dev` — development server with hot reload
- `npm run build` — production build (client to `dist/public`, server to `dist/index.cjs`)
- `npm start` — run production build
- `npm run check` — TypeScript check
