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

Railway builds from the `Dockerfile` (see `railway.json`). The runtime image includes
`poppler-utils`, which CPI uses to read scanned / encoded-font PDFs as images.

1. **New Project → Deploy from GitHub repo → `fundngo/CPI`.**
2. In **Variables** add `ANTHROPIC_API_KEY` and `DATABASE_PATH=/data/data.db`
   (optional: `CLAUDE_MODEL`).
3. In **Settings → Volumes** attach a volume at `/data` so client data survives redeploys.
   Don't add a `VOLUME` line to the Dockerfile — Railway rejects it.
4. In **Settings → Networking** click **Generate Domain**.

Every push to `main` redeploys. The health check is `GET /api/clients`.
The **Settings** page in the app shows whether the API key, PDF image support, and the
persistent volume are set up correctly.

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

| Var                 | Required | Notes                                                                 |
| ------------------- | -------- | --------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` | yes      | PDF credit-report / bank-statement extraction (Claude).               |
| `CLAUDE_MODEL`      | no       | Defaults to `claude-sonnet-4-5`.                                      |
| `PORT`              | no       | Defaults to 5000. Railway sets this automatically.                    |
| `DATABASE_PATH`     | no       | Defaults to `./data.db`. Set to `/data/data.db` on Railway.           |
| `SEED_DEMO_DATA`    | no       | Demo clients are seeded into an empty DB in development only. Set `true` to seed in production, `false` to skip in development. |

------------------- | -------- | ---------------------------------------------------------------- |
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
