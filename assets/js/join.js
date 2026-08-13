/**
 * MATEX Dallas — Membership Application
 * =========================================
 * Public "apply to join" form (join.html). No login required — inserts
 * directly into membership_applications, which anon/authenticated can
 * insert into but not read back (see 004_membership_applications.sql).
 * An admin reviews and approves/denies from admin.html, which is what
 * actually creates the real members row.
 *
 * Requires assets/js/supabase-config.js to run first.
 */
(function () {
  "use strict";

  var form = document.getElementById("join-form");
  if (!form) return;

  var resultEl = document.getElementById("join-result");
  var submitBtn = form.querySelector("button[type='submit']");

  function showResult(state, text) {
    resultEl.dataset.state = state;
    resultEl.textContent = text;
    resultEl.hidden = false;
  }

  function fieldValue(name) {
    var el = form.elements[name];
    if (!el) return null;
    var v = el.value.trim();
    return v || null;
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    if (!window.matexSupabase) {
      showResult("error", "This form is temporarily unavailable. Please try again later or contact us.");
      return;
    }

    if (!fieldValue("first_name") || !fieldValue("last_name") || !fieldValue("email")) {
      showResult("error", "Please fill in your first name, last name, and email.");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";

    window.matexSupabase
      .from("membership_applications")
      .insert({
        first_name: fieldValue("first_name"),
        middle_name: fieldValue("middle_name"),
        last_name: fieldValue("last_name"),
        email: fieldValue("email"),
        phone: fieldValue("phone"),
        address_line1: fieldValue("address_line1"),
        address_line2: fieldValue("address_line2"),
        city: fieldValue("city"),
        state: fieldValue("state"),
        postal_code: fieldValue("postal_code"),
        membership_type: fieldValue("membership_type"),
        message: fieldValue("message")
      })
      .then(function (res) {
        if (res.error) {
          console.error("[MATEX Supabase] membership_applications insert error:", res.error.message);
          showResult("error", "Something went wrong submitting your application. Please try again, or contact us directly.");
          return;
        }
        showResult("ok", "Thank you! Your application has been submitted. We'll follow up by email or phone about next steps.");
        form.reset();
        form.hidden = true;
      })
      .catch(function (err) {
        console.error("[MATEX Supabase] membership_applications insert threw:", err);
        showResult("error", "Something went wrong submitting your application. Please try again, or contact us directly.");
      })
      .finally(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit Application";
      });
  });
})();
