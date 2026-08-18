/**
 * MoneyFlow — connection settings.
 *
 * Copy this file to `config.js` and paste in your own two values from
 * Supabase → Project Settings → Data API. See docs/LAUNCH.md, step 4.
 *
 * Both values are safe to publish. The anon key is designed to be visible in
 * the browser; it grants nothing on its own, because every table is protected
 * by Row Level Security and only ever returns rows belonging to the session
 * asking for them. There is no password anywhere in this app.
 *
 * The one value that must NEVER go in this file is the `service_role` key.
 * That one bypasses every policy. It belongs on a server, and this app has
 * none. If you ever paste it here, rotate it in Supabase immediately.
 */

const MF_CONFIG = {
    url: 'https://YOUR-PROJECT.supabase.co',
    anonKey: 'YOUR-ANON-KEY',
};
