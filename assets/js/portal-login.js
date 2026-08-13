/**
 * MATEX Dallas — Member Portal Login
 * =====================================
 * Handles both login methods on portal-login.html:
 *   - Magic link (passwordless): supabase.auth.signInWithOtp
 *   - Email + password: supabase.auth.signInWithPassword / signUp
 *
 * On any successful sign-in, redirects to portal.html. Magic link and
 * new-account sign-up both require the member to click a link emailed
 * to them before they're actually signed in.
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

  function showMessage(state, text) {
    messageEl.dataset.state = state;
    messageEl.textContent = text;
    messageEl.hidden = false;
  }

  // If already signed in, skip straight to the portal.
  window.matexSupabase.auth.getSession().then(function (res) {
    if (res.data && res.data.session) {
      window.location.href = "portal.html";
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
        options: { emailRedirectTo: window.location.origin + "/portal.html" }
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
          options: { emailRedirectTo: window.location.origin + "/portal.html" }
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
        window.location.href = "portal.html";
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
