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

## User Preferences

- Keep the existing script structure — do not rewrite `extract.js` unless it errors
