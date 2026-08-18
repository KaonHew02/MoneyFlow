/**
 * MoneyFlow — connection settings.
 *
 * Both values here are safe to publish. The anon key is designed to be visible
 * in the browser; it grants nothing on its own, because every table is
 * protected by Row Level Security and only ever returns rows belonging to the
 * session asking for them — which this app obtains anonymously, with no login
 * screen and no password to keep anywhere.
 *
 * The one value that must NEVER go in here is the `service_role` key. That one
 * bypasses every policy. It belongs on a server, and this app has none. If you
 * ever paste it here, rotate it in Supabase immediately.
 */

const MF_CONFIG = {
    url: 'https://uqzpufrxrxutpiucvcro.supabase.co',

    // Supabase → Project Settings → API Keys → anon / public. Paste it here.
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxenB1ZnJ4cnh1dHBpdWN2Y3JvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5OTg2MTEsImV4cCI6MjEwMjU3NDYxMX0.H2YzTDOylr4vrRu4GOH_LiS_Fz8TBHnQvLsa0MHyFYI',
};
