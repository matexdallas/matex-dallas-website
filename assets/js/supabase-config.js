/**
 * MATEX Dallas — Supabase Client Configuration
 * =============================================
 * Central place where the Supabase client is created. Other scripts
 * (member lookup, member portal, admin portal, dues/payment tracking,
 * etc.) should reuse `window.matexSupabase` instead of creating their
 * own client, so the whole site shares one connection and one config.
 *
 * KEY SAFETY
 * ----------
 * Only the PUBLISHABLE key (starts with "sb_publishable_") belongs in
 * this file. It is designed to be public/frontend-safe — access is
 * controlled by Row Level Security (RLS) policies on the database,
 * not by keeping this key secret.
 *
 * NEVER put the "secret" / "service_role" key here or in any other
 * file that ships to the browser. That key bypasses RLS entirely and
 * must only ever live in a trusted server environment.
 *
 * Load order on any page that needs Supabase:
 *   1. <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   2. <script src="assets/js/supabase-config.js" defer></script>
 *   3. (feature scripts that use window.matexSupabase)
 */
(function () {
  "use strict";

  var SUPABASE_URL = "https://tjqfnmxsoushfkjkqygl.supabase.co";

  // Safe to expose in frontend code — do NOT put the secret/service_role key here.
  var SUPABASE_PUBLISHABLE_KEY = "sb_publishable_AxAUOmeZSu4JRkVqgHanEA_T4zWOZtv";

  if (typeof supabase === "undefined" || !supabase.createClient) {
    console.error(
      "[MATEX Supabase] supabase-js did not load. Check that the CDN <script> tag " +
      "(https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2) is included before this file."
    );
    return;
  }

  if (!SUPABASE_PUBLISHABLE_KEY || SUPABASE_PUBLISHABLE_KEY.indexOf("PASTE_") === 0) {
    console.warn(
      "[MATEX Supabase] No publishable key configured yet. " +
      "Edit assets/js/supabase-config.js and set SUPABASE_PUBLISHABLE_KEY."
    );
  }

  // Shared client, available to any script loaded after this one.
  window.matexSupabase = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
})();
