/**
 * MATEX Dallas — Supabase Connection Test (internal use only)
 * =============================================================
 * Confirms window.matexSupabase initialized and can reach the
 * project. It does NOT query the members table or any other data
 * table, and it never renders member information — it only calls
 * auth.getSession(), which is safe even with no one logged in and
 * with no public SELECT policies defined.
 *
 * Used by supabase-test.html (a non-indexed, unlinked internal page).
 * Not loaded on any public-facing page.
 */
(function () {
  "use strict";

  function report(status, message) {
    console[status === "ok" ? "log" : "error"]("[MATEX Supabase] " + message);
    var el = document.getElementById("supabase-test-result");
    if (el) {
      el.textContent = message;
      el.dataset.status = status;
    }
  }

  if (!window.matexSupabase) {
    report("error", "Client not initialized — check assets/js/supabase-config.js.");
    return;
  }

  window.matexSupabase.auth.getSession()
    .then(function (result) {
      if (result.error) {
        report("error", "Connection test failed: " + result.error.message);
      } else {
        report("ok", "Supabase client initialized and reachable.");
      }
    })
    .catch(function (err) {
      report("error", "Connection test threw an error: " + (err && err.message ? err.message : err));
    });
})();
