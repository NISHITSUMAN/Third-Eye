import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
const configured = Boolean(supabaseUrl && supabasePublishableKey);
let client: SupabaseClient | null = null;

/** Browser Supabase client for existing authenticated features; no sign-in UI or OAuth flow is exposed. */
export function getSupabaseClient(): SupabaseClient | null {
  if (!configured || !supabaseUrl || !supabasePublishableKey) return null;
  client ??= createClient(supabaseUrl, supabasePublishableKey, {
    auth: { autoRefreshToken: true, detectSessionInUrl: false, persistSession: true },
  });
  return client;
}
