/**
 * MATEX Dallas — Member Portal Login
 * =====================================
 * Handles both login methods on portal-login.html:
 *   - Magic link (passwordless): supabase.auth.signInWithOtp
 *   - Email + password: supabase.auth.signInWithPassword / signUp
 *
 * On any successful sign-in, redirects to portal.html by default, or to
 * admin.html when reached as portal-login.html?redirect=admin.html (see
 * admin.js's auth-guard redirect). The redirect param is whitelisted, not
 * passed through raw, so it can't be used to send anyone off-site. Magic
 * link and new-account sign-up both require the member to click a link
 * emailed to them before they're actually signed in — the redirect target
 * survives that round trip via emailRedirectTo.
 *
 * Requires assets/js/supabase-config.js to run first.
 */
(function () {
  "use strict";

  if (!window.matexSupabase) {
    console.error("[MATEX Supabase] Client not initialized — check supabase-config.js");
    return;
  }

  var messageEl = document.getElementById("auth-message");

  // Where to send the member/admin after a successful sign-in. Pages that
  // bounce here for an auth check (e.g. admin.html) pass ?redirect=admin.html
  // so we return them to where they were headed instead of always dropping
  // everyone on the member portal. Whitelisted, not passed through raw, so
  // this query param can't be used to redirect off-site.
  var REDIRECT_TARGETS = { "admin.html": "admin.html" };
  var redirectTarget = REDIRECT_TARGETS[new URLSearchParams(window.location.search).get("redirect")] || "portal.html";

  function showMessage(state, text) {
    messageEl.dataset.state = state;
    messageEl.textContent = text;
    messageEl.hidden = false;
  }

  // If already signed in, skip straight to the intended destination.
  window.matexSupabase.auth.getSession().then(function (res) {
    if (res.data && res.data.session) {
      window.location.href = redirectTarget;
    }
  });

  // ---------------------------------------------------------------
  // Tabs: Email Link vs Email & Password
  // ---------------------------------------------------------------
  var tabLink = document.getElementById("tab-link");
  var tabPassword = document.getElementById("tab-password");
  var panelLink = document.getElementById("panel-link");
  var panelPassword = document.getElementById("panel-password");

  function selectTab(tab) {
    var showLink = tab === "link";
    tabLink.setAttribute("aria-selected", String(showLink));
    tabPassword.setAttribute("aria-selected", String(!showLink));
    panelLink.hidden = !showLink;
    panelPassword.hidden = showLink;
  }

  tabLink.addEventListener("click", function () { selectTab("link"); });
  tabPassword.addEventListener("click", function () { selectTab("password"); });

  // ---------------------------------------------------------------
  // Magic link
  // ---------------------------------------------------------------
  var magicLinkForm = document.getElementById("magic-link-form");
  magicLinkForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var email = magicLinkForm.email.value.trim();
    if (!email) return;

    var btn = magicLinkForm.querySelector("button[type='submit']");
    btn.disabled = true;
    btn.textContent = "Sending…";

    window.matexSupabase.auth
      .signInWithOtp({
        email: email,
        options: { emailRedirectTo: window.location.origin + "/" + redirectTarget }
      })
      .then(function (res) {
        if (res.error) {
          console.error("[MATEX Supabase] signInWithOtp error:", res.error.message);
          showMessage("error", "Couldn't send the login link. Please try again.");
          return;
        }
        showMessage("ok", "Check your email for a login link. It may take a minute to arrive.");
        magicLinkForm.reset();
      })
      .catch(function (err) {
        console.error("[MATEX Supabase] signInWithOtp threw:", err);
        showMessage("error", "Couldn't send the login link. Please try again.");
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = "Send Login Link";
      });
  });

  // ---------------------------------------------------------------
  // Email + password (sign in / sign up toggle)
  // ---------------------------------------------------------------
  var passwordForm = document.getElementById("password-form");
  var passwordSubmitBtn = document.getElementById("password-submit-btn");
  var modeIntro = document.getElementById("password-mode-intro");
  var switchPrompt = document.getElementById("password-switch-prompt");
  var modeSwitchBtn = document.getElementById("password-mode-switch");
  var isSignUpMode = false;

  function applyPasswordMode() {
    if (isSignUpMode) {
      modeIntro.textContent = "Create an account with an email and password (at least 8 characters).";
      passwordSubmitBtn.textContent = "Create Account";
      switchPrompt.textContent = "Already have an account?";
      modeSwitchBtn.textContent = "Sign in instead";
    } else {
      modeIntro.textContent = "Sign in with your email and password.";
      passwordSubmitBtn.textContent = "Sign In";
      switchPrompt.textContent = "New here?";
      modeSwitchBtn.textContent = "Create an account";
    }
  }

  modeSwitchBtn.addEventListener("click", function () {
    isSignUpMode = !isSignUpMode;
    applyPasswordMode();
  });

  passwordForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var email = passwordForm.email.value.trim();
    var password = passwordForm.password.value;
    if (!email || !password) return;

    passwordSubmitBtn.disabled = true;
    passwordSubmitBtn.textContent = isSignUpMode ? "Creating…" : "Signing in…";

    var authCall = isSignUpMode
      ? window.matexSupabase.auth.signUp({
          email: email,
          password: password,
          options: { emailRedirectTo: window.location.origin + "/" + redirectTarget }
        })
      : window.matexSupabase.auth.signInWithPassword({ email: email, password: password });

    authCall
      .then(function (res) {
        if (res.error) {
          console.error("[MATEX Supabase] password auth error:", res.error.message);
          showMessage("error", res.error.message || "Something went wrong. Please try again.");
          return;
        }
        if (isSignUpMode) {
          showMessage("ok", "Account created. Check your email to confirm it, then sign in.");
          passwordForm.reset();
          isSignUpMode = false;
          applyPasswordMode();
          return;
        }
        // Signed in.
        window.location.href = redirectTarget;
      })
      .catch(function (err) {
        console.error("[MATEX Supabase] password auth threw:", err);
        showMessage("error", "Something went wrong. Please try again.");
      })
      .finally(function () {
        passwordSubmitBtn.disabled = false;
        applyPasswordMode();
      });
  });

  applyPasswordMode();
})();
