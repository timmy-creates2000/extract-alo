// ============================================================================
//  ALOC → Supabase extractor  (STANDALONE — for Replit / any cloud Node runner)
// ============================================================================
//  This single file has ZERO local imports. It only needs two npm packages:
//      npm i @supabase/supabase-js
//  (node-fetch NOT needed — Node 18+ has global fetch. Replit uses Node 20.)
//
//  It extracts JAMB UTME past questions from the ALOC v2 API and idempotently
//  upserts them into Supabase. Safe to stop/restart — it never duplicates
//  (upserts are keyed on ALOC's own question id -> `source_ref`, which is UNIQUE).
//
//  RUN:   node extract.js
//  GAP-FILL ONLY (skip subject/years that already have questions):
//         GAPS_ONLY=1 node extract.js
// ============================================================================

const { createClient } = require('@supabase/supabase-js')

// ── SECRETS (set these in Replit "Secrets" tab, NOT hard-coded) ─────────────
const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY // server-only master key
const ALOC_API_KEY = process.env.ALOC_API_KEY
const ALOC_BASE = 'https://questions.aloc.com.ng/api/v2'

if (!SUPABASE_URL || !SERVICE_KEY || !ALOC_API_KEY) {
  console.error('❌ Missing env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ALOC_API_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

// ── Config ──────────────────────────────────────────────────────────────────
// ALOC's 17 supported UTME subjects (official slugs — do NOT change spellings).
const SUBJECT_SLUGS = [
  'english', 'mathematics', 'physics', 'chemistry', 'biology', 'englishlit',
  'government', 'economics', 'commerce', 'accounting', 'geography', 'crk',
  'irk', 'civiledu', 'currentaffairs', 'insurance', 'history',
]
// Years to sweep. 2026 not released by ALOC yet — add it later when available.
const YEARS = Array.from({ length: 2025 - 2001 + 1 }, (_, i) => 2001 + i) // 2001..2025

const CONCURRENCY = 4        // parallel (subject,year) scopes. 4 is safe; higher => 429s.
const BATCH_DELAY_MS = 300   // pause between polls to the same scope
const DRY_STOP = 3           // stop a scope after N batches with 0 NEW questions
const MAX_FAIL_STREAK = 6    // give up a scope after N consecutive network failures
const GAPS_ONLY = process.env.GAPS_ONLY === '1'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const stats = { added: 0, updated: 0, skipped: 0, incomplete: [], errors: 0 }

// ── ALOC fetch: distinguishes a REAL empty year from a network failure ───────
async function fetchBatch(subject, year, attempt = 0) {
  const url = `${ALOC_BASE}/m?subject=${encodeURIComponent(subject)}&year=${year}&type=utme`
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 25000)
    let res
    try {
      res = await fetch(url, {
        headers: { AccessToken: ALOC_API_KEY, Accept: 'application/json' },
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 6) return { ok: false, data: [] }
      await sleep(BATCH_DELAY_MS * 2 ** attempt)
      return fetchBatch(subject, year, attempt + 1)
    }
    if (!res.ok) return { ok: false, data: [] } // 4xx (e.g. bad slug) — treated as no-data-but-not-network
    const body = await res.text()
    if (!body.trim()) {
      // Empty HTTP-200 body is an ALOC transient bug — retry, don't record as "no questions".
      if (attempt < 6) {
        await sleep(BATCH_DELAY_MS * 2 ** attempt)
        return fetchBatch(subject, year, attempt + 1)
      }
      return { ok: false, data: [] }
    }
    let json
    try {
      json = JSON.parse(body)
    } catch {
      if (attempt < 6) {
        await sleep(BATCH_DELAY_MS * 2 ** attempt)
        return fetchBatch(subject, year, attempt + 1)
      }
      return { ok: false, data: [] }
    }
    const data = Array.isArray(json.data) ? json.data : json.data ? [json.data] : []
    return { ok: true, data }
  } catch {
    if (attempt < 6) {
      await sleep(BATCH_DELAY_MS * 2 ** attempt)
      return fetchBatch(subject, year, attempt + 1)
    }
    return { ok: false, data: [] }
  }
}

// ── Normalize one raw ALOC question into our schema (a-d -> A-D, drop empties) ─
function clean(v) {
  const s = (v == null ? '' : String(v)).trim()
  return s.length ? s : null
}
function normalize(raw, fallbackYear) {
  const sourceRef = raw.id != null ? String(raw.id) : ''
  if (!sourceRef) return null
  const text = clean(raw.question)
  if (!text) return null

  const map = raw.option || {}
  const correct = (clean(raw.answer) || '').toUpperCase()
  const options = ['A', 'B', 'C', 'D']
    .map((label) => {
      const t = clean(map[label.toLowerCase()] ?? map[label])
      if (t == null) return null
      return { label, text: t, is_correct: label === correct }
    })
    .filter(Boolean)

  if (options.length < 4) return null
  if (options.filter((o) => o.is_correct).length !== 1) return null

  const year = raw.examyear != null ? Number(raw.examyear) || fallbackYear : fallbackYear
  return {
    question: {
      year,
      topic: clean(raw.category),
      text,
      passage: clean(raw.section),
      image_key: clean(raw.image), // NOTE: stores ALOC's original image URL for now (re-host later)
      explanation: clean(raw.solution),
      source_ref: sourceRef,
    },
    options,
  }
}

// ── Idempotent upsert (safe to re-run; keyed on source_ref UNIQUE) ───────────
async function upsertQuestion(subjectId, norm) {
  const { data: row, error } = await supabase
    .from('question')
    .upsert({ subject_id: subjectId, ...norm.question }, { onConflict: 'source_ref' })
    .select('id')
    .single()
  if (error) throw error

  await supabase.from('question_option').delete().eq('question_id', row.id)
  const { error: optErr } = await supabase
    .from('question_option')
    .insert(norm.options.map((o) => ({ question_id: row.id, ...o })))
  if (optErr) throw optErr
}

// ── Extract one (subject, year) scope until dry or network-starved ───────────
async function extractScope(subjectId, slug, year) {
  const seen = new Set()
  let dry = 0
  let fails = 0
  let count = 0
  let hadSuccess = false

  while (dry < DRY_STOP && fails < MAX_FAIL_STREAK) {
    const { ok, data } = await fetchBatch(slug, year)
    if (!ok) {
      fails++
      await sleep(BATCH_DELAY_MS)
      continue
    }
    fails = 0
    hadSuccess = true

    let fresh = 0
    for (const raw of data) {
      const ref = raw.id != null ? String(raw.id) : ''
      if (!ref || seen.has(ref)) continue
      seen.add(ref)
      const norm = normalize(raw, year)
      if (!norm) {
        stats.skipped++
        continue
      }
      try {
        await upsertQuestion(subjectId, norm)
        stats.added++ // note: "added" here counts every upsert; source_ref UNIQUE prevents dupes
        count++
        fresh++
      } catch (e) {
        stats.errors++
      }
    }
    dry = fresh === 0 ? dry + 1 : 0
    await sleep(BATCH_DELAY_MS)
  }

  const status = count > 0 ? 'complete' : hadSuccess ? 'empty' : 'INCOMPLETE'
  if (status === 'INCOMPLETE') stats.incomplete.push(`${slug} ${year}`)
  console.log(`  ${status === 'INCOMPLETE' ? '⚠' : '✓'} ${slug} ${year}: ${count}${status === 'INCOMPLETE' ? ' (network — rerun)' : ''}`)
}

async function main() {
  console.log('📥 ALOC → Supabase extraction' + (GAPS_ONLY ? '  [GAPS_ONLY]' : ''))

  // Load our subjects (must be seeded already — see setup instructions).
  const { data: subjects, error } = await supabase.from('subject').select('id, slug')
  if (error) throw error
  const bySlug = new Map((subjects || []).map((s) => [s.slug, s.id]))
  const missing = SUBJECT_SLUGS.filter((s) => !bySlug.has(s))
  if (missing.length) {
    console.error('❌ These subjects are not seeded in the DB:', missing.join(', '))
    console.error('   Seed them first (see instructions), then re-run.')
    process.exit(1)
  }

  // Gap-fill: find which (subject,year) already have questions, skip them.
  let populated = new Set()
  if (GAPS_ONLY) {
    const idToSlug = new Map((subjects || []).map((s) => [s.id, s.slug]))
    const { data: rows } = await supabase.from('question').select('subject_id, year')
    for (const r of rows || []) {
      const slug = idToSlug.get(r.subject_id)
      if (slug) populated.add(`${slug} ${r.year}`)
    }
    console.log(`Gap-fill: ${populated.size} scopes already populated — skipping them.`)
  }

  // Build work queue.
  const jobs = []
  for (const slug of SUBJECT_SLUGS) {
    for (const year of YEARS) {
      if (GAPS_ONLY && populated.has(`${slug} ${year}`)) continue
      jobs.push({ subjectId: bySlug.get(slug), slug, year })
    }
  }
  console.log(`Scopes to process: ${jobs.length} | concurrency ${CONCURRENCY} | delay ${BATCH_DELAY_MS}ms\n`)

  let cursor = 0
  let done = 0
  async function worker() {
    while (cursor < jobs.length) {
      const job = jobs[cursor++]
      if (!job) break
      try {
        await extractScope(job.subjectId, job.slug, job.year)
      } catch (e) {
        stats.errors++
        console.error(`  ✗ ${job.slug} ${job.year}: ${e.message}`)
      }
      done++
      if (done % 10 === 0 || done === jobs.length) {
        console.log(`  … ${done}/${jobs.length} scopes | rows upserted ${stats.added} | skipped ${stats.skipped} | errors ${stats.errors}`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, () => worker()))

  console.log(`\n✅ DONE. Upserts ${stats.added}, skipped ${stats.skipped}, errors ${stats.errors}`)
  if (stats.incomplete.length) {
    console.log(`\n⚠ ${stats.incomplete.length} scope(s) INCOMPLETE (network) — rerun to finish:\n  ${stats.incomplete.join(', ')}`)
  }
}

main().catch((e) => {
  console.error('❌ Fatal:', e)
  process.exit(1)
})
