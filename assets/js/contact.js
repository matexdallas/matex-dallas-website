/**
 * MATEX Dallas — Contact Form
 * ==============================
 * Public form, no login required. Inserts into contact_messages
 * (see 005_contact_messages.sql) — anon/authenticated can insert but
 * not read back; only an admin can read/review submissions, in
 * admin.html. This does NOT send email — there's no email service
 * wired up yet.
 *
 * Requires assets/js/supabase-config.js to run first.
 */
(function () {
  "use strict";

  var form = document.getElementById("contact-form");
  if (!form) return;

  var resultEl = document.getElementById("contact-result");
  var submitBtn = form.querySelector("button[type='submit']");

  function showResult(state, text) {
    resultEl.dataset.state = state;
    resultEl.textContent = text;
    resultEl.hidden = false;
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    if (!window.matexSupabase) {
      showResult("error", "This form is temporarily unavailable. Please email us directly at matexdallas@gmail.com.");
      return;
    }

    var name = form.name.value.trim();
    var email = form.email.value.trim();
    var message = form.message.value.trim();

    if (!name || !email || !message) {
      showResult("error", "Please fill in your name, email, and message.");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";

    window.matexSupabase
      .from("contact_messages")
      .insert({
        name: name,
        email: email,
        reason: form.reason.value || null,
        message: message
      })
      .then(function (res) {
        if (res.error) {
          console.error("[MATEX Supabase] contact_messages insert error:", res.error.message);
          showResult("error", "Something went wrong sending your message. Please try again, or email us directly.");
          return;
        }
        showResult("ok", "Thank you! Your message has been sent. We'll get back to you soon.");
        form.reset();
        form.hidden = true;
      })
      .catch(function (err) {
        console.error("[MATEX Supabase] contact_messages insert threw:", err);
        showResult("error", "Something went wrong sending your message. Please try again, or email us directly.");
      })
      .finally(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = "Send Message";
      });
  });
})();
