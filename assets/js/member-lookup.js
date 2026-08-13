/**
 * MATEX Dallas — Member Lookup
 * ===============================
 * Lets a member check their own status using Email + Member Number.
 * Calls the `lookup_member_status` Postgres RPC function — it never
 * queries the members table directly, and the function only ever
 * returns {full_name, status} for an exact two-factor match. No other
 * member fields (phone, address, DOB, notes, etc.) are requested or
 * displayed.
 *
 * Requires, in this order:
 *   1. https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2
 *   2. assets/js/supabase-config.js  (creates window.matexSupabase)
 *   3. this file
 */
(function () {
  "use strict";

  var form = document.getElementById("member-lookup-form");
  if (!form) return;

  var resultEl = document.getElementById("lookup-result");
  var submitBtn = form.querySelector("button[type='submit']");
  var attempts = 0;
  var MAX_ATTEMPTS = 5;

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function showResult(state, html) {
    resultEl.dataset.state = state;
    resultEl.innerHTML = html;
    resultEl.hidden = false;
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    if (!window.matexSupabase) {
      showResult("error", "Member lookup is temporarily unavailable. Please try again later or contact us.");
      return;
    }

    if (attempts >= MAX_ATTEMPTS) {
      showResult(
        "error",
        "Too many attempts. Please email <a href=\"mailto:matexdallas@gmail.com\">matexdallas@gmail.com</a> for help."
      );
      return;
    }

    var email = form.email.value.trim();
    var memberNumber = form.member_number.value.trim();

    if (!email || !memberNumber) {
      showResult("error", "Please enter both your email and member number.");
      return;
    }

    attempts += 1;
    submitBtn.disabled = true;
    submitBtn.textContent = "Checking…";
    showResult("pending", "Checking membership status…");

    window.matexSupabase
      .rpc("lookup_member_status", { p_email: email, p_member_number: memberNumber })
      .then(function (res) {
        if (res.error) {
          console.error("[MATEX Supabase] lookup_member_status error:", res.error.message);
          showResult("error", "Something went wrong. Please try again, or contact us if it keeps happening.");
          return;
        }
        var row = Array.isArray(res.data) ? res.data[0] : res.data;
        if (!row) {
          showResult(
            "not-found",
            "No membership found matching that email and member number. Double-check both fields, or contact us if you believe this is an error."
          );
          return;
        }
        showResult(
          "found",
          "<strong>" + escapeHtml(row.full_name) + "</strong> &mdash; Membership status: <strong>" +
            escapeHtml(row.status) + "</strong>"
        );
      })
      .catch(function (err) {
        console.error("[MATEX Supabase] lookup_member_status threw:", err);
        showResult("error", "Something went wrong. Please try again, or contact us if it keeps happening.");
      })
      .finally(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = "Check Status";
      });
  });
})();
