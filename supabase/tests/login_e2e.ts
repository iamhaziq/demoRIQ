// Magic-link sign-in on the LOCAL stack, the way src/screens/Login.jsx does it.
//   npx supabase start
//   deno run -A --config supabase/functions/deno.json supabase/tests/login_e2e.ts
// Requests a link, reads it from Mailpit, follows it, and checks the session lands on the app URL
// with a shop created for the new owner.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { createClient } from 'npm:@supabase/supabase-js@2'

const APP = 'http://localhost:5173'
const status = JSON.parse(new TextDecoder().decode((await new Deno.Command(
  Deno.build.os === 'windows' ? 'npx.cmd' : 'npx', { args: ['supabase', 'status', '-o', 'json'], stderr: 'null' },
).output()).stdout))
if (!String(status.API_URL).includes('127.0.0.1')) throw new Error('local stack only')
const mailpit = status.MAILPIT_URL ?? status.INBUCKET_URL

const email = `login-${crypto.randomUUID().slice(0, 8)}@test.my`
const db = createClient(status.API_URL, status.ANON_KEY ?? status.PUBLISHABLE_KEY, { auth: { persistSession: false } })
const { error } = await db.auth.signInWithOtp({ email, options: { emailRedirectTo: APP } })
if (error) throw error

// Find the email in Mailpit and pull the verify link out of it.
let link: string | undefined
for (let i = 0; i < 20 && !link; i++) {
  await new Promise((r) => setTimeout(r, 500))
  const list = await (await fetch(`${mailpit}/api/v1/search?query=to:${encodeURIComponent(email)}`)).json()
  const id = list.messages?.[0]?.ID
  if (!id) continue
  const msg = await (await fetch(`${mailpit}/api/v1/message/${id}`)).json()
  link = (msg.HTML ?? msg.Text).match(/https?:\/\/[^"'\s<>]+\/auth\/v1\/verify[^"'\s<>]*/)?.[0]?.replaceAll('&amp;', '&')
}
assert(link, 'magic link email arrived')

// Following the link redirects to the app with a session in the URL fragment.
const res = await fetch(link!, { redirect: 'manual' })
const location = res.headers.get('location') ?? ''
assert(location.startsWith(APP), `redirects to the app, got ${location.slice(0, 80)}`)
const token = new URLSearchParams(location.split('#')[1]).get('access_token')
assert(token, 'session token in the redirect')

// With that session the owner sees exactly one shop: theirs, created on first sign-in.
const user = createClient(status.API_URL, status.ANON_KEY ?? status.PUBLISHABLE_KEY, {
  global: { headers: { Authorization: `Bearer ${token}` } },
  auth: { persistSession: false },
})
const { data: shops } = await user.from('shops').select('id, name')
assertEquals(shops?.length, 1)
assertEquals(shops![0].name, 'My shop')
console.log('LOGIN E2E PASS', email)
