// Seeds the 17 JAMB/ALOC subjects (idempotent — safe to run repeatedly).
// Only needed if the Supabase project does NOT already have subjects.
// Run: node seed-subjects.js
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const elective = { defaultQuestionCount: 40, defaultTimeLimitMinutes: 30, isCompulsory: false }

const SUBJECTS = [
  { name: 'English Language', slug: 'english', config: { defaultQuestionCount: 60, defaultTimeLimitMinutes: 40, isCompulsory: true } },
  { name: 'Mathematics', slug: 'mathematics', config: elective },
  { name: 'Physics', slug: 'physics', config: elective },
  { name: 'Chemistry', slug: 'chemistry', config: elective },
  { name: 'Biology', slug: 'biology', config: elective },
  { name: 'Literature in English', slug: 'englishlit', config: elective },
  { name: 'Government', slug: 'government', config: elective },
  { name: 'Economics', slug: 'economics', config: elective },
  { name: 'Commerce', slug: 'commerce', config: elective },
  { name: 'Accounting', slug: 'accounting', config: elective },
  { name: 'Geography', slug: 'geography', config: elective },
  { name: 'Christian Religious Studies', slug: 'crk', config: elective },
  { name: 'Islamic Religious Studies', slug: 'irk', config: elective },
  { name: 'History', slug: 'history', config: elective },
  { name: 'Civic Education', slug: 'civiledu', config: elective },
  { name: 'Current Affairs', slug: 'currentaffairs', config: elective },
  { name: 'Insurance', slug: 'insurance', config: elective },
]

async function main() {
  const { data, error } = await supabase
    .from('subject')
    .upsert(SUBJECTS, { onConflict: 'slug' })
    .select('slug')
  if (error) throw error
  console.log(`✅ Upserted ${data.length} subjects:`, data.map((d) => d.slug).join(', '))
}

main().catch((e) => {
  console.error('❌', e)
  process.exit(1)
})
