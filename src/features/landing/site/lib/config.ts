const env = import.meta.env;

export const appConfig = {
  supabaseUrl: env.VITE_SUPABASE_URL?.trim() ?? '',
  supabasePublishableKey: env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '',
  repositoryUrl: env.VITE_PROJECT_REPOSITORY_URL?.trim() || 'https://github.com/NISHITSUMAN/Third-Eye',
};

export const isSupabaseConfigured = Boolean(
  appConfig.supabaseUrl && appConfig.supabasePublishableKey,
);
