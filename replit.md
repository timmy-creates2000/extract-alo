# ALOC → Supabase JAMB Question Extractor

Extracts JAMB UTME past questions from the [ALOC v2 API](https://questions.aloc.com.ng) and idempotently upserts them into a Supabase database.

## Stack

- **Runtime:** Node.js 18+
- **Dependencies:** `@supabase/supabase-js`
- **Target DB:** Supabase (Postgres)

## Required Secrets

Set these in the Replit Secrets tab:

| Key | Description |
|-----|-------------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (bypasses RLS — keep private) |
| `ALOC_API_KEY` | ALOC AccessToken from your ALOC dashboard |

## How to Run

```bash
npm install          # first time only
npm run extract      # full extraction (all 17 subjects × 2001–2025)
npm run gaps         # gap-fill only — skips subject/years that already have questions
npm run seed         # seed the subject table (only needed if it's empty)
```

The `"Run extraction"` workflow runs `npm run extract` automatically.

## How It Works

- Polls ALOC's `/api/v2/m` endpoint for each (subject, year) combination
- **17 subjects × 25 years = 425 scopes**, 4 running in parallel
- Stops a scope after 3 consecutive batches with no new questions
- **Idempotent:** upserts on `source_ref` (UNIQUE) — safe to stop and rerun, never duplicates
- Prints `✅ DONE` when finished; any `⚠ INCOMPLETE` scopes should be rerun

## Troubleshooting

- `❌ Missing env` → a secret is not set
- `❌ subjects not seeded` → run `npm run seed` first
- `429 Too Many Requests` → script backs off automatically; lower `CONCURRENCY` to 2 in `extract.js` if persistent
- Incomplete scopes at the end → just rerun `npm run extract` (safe)

## Deploying to Render

A `render.yaml` is included. Steps:
1. Push this repo to GitHub.
2. In [Render](https://render.com), create a new **Background Worker** from the repo — it will pick up `render.yaml` automatically.
3. In the Render service's **Environment** settings, add the two secret values:
   - `SUPABASE_SERVICE_ROLE_KEY` — from Supabase Dashboard → Project Settings → API
   - `ALOC_API_KEY` — from your ALOC dashboard
4. Deploy. The worker runs `npm run extract` and exits with `✅ DONE` when finished.
5. If there are `⚠ INCOMPLETE` scopes at the end, trigger another deploy (it's idempotent — no duplicates).

To run gap-fill only (skip subject/years that already have questions), change `startCommand` in `render.yaml` to `npm run gaps`.

## User Preferences

- Keep the existing script structure — do not rewrite `extract.js` unless it errors
