import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

/**
 * False when the deployment is missing its Supabase configuration. The app
 * renders a configuration notice instead of a blank screen in that case
 * (see main.tsx) rather than crashing at module load.
 */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = createClient(
  isSupabaseConfigured ? supabaseUrl : 'https://unconfigured.invalid',
  isSupabaseConfigured ? supabaseAnonKey : 'unconfigured',
);
