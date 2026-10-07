import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/** True when VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set (.env.local locally, Netlify env in production). */
export const configured = Boolean(url && anonKey)

// The anon key is public by design: Row Level Security limits every query to the signed-in shop.
export const supabase = configured ? createClient(url, anonKey) : null
