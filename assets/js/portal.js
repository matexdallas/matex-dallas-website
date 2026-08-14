/**
 * MATEX Dallas — Member Portal Dashboard
 * ==========================================
 * On load:
 *   1. If not signed in, redirect to portal-login.html.
 *   2. If signed in, try to read the member's own row from `members`.
 *      RLS restricts this to `auth_user_id = auth.uid()`, so this call
 *      can only ever return the caller's own row (or none, if an admin
 *      hasn't linked their account yet).
 *   3. If no row: check for an existing portal_access_requests row.
 *      - none yet → show the "request access" form
 *      - pending  → show a waiting message
 *      - denied   → show a denial message
 *   4. If a row exists: render profile fields (name, email, phone,
 *      address, status, joined date). The `notes` column is never
 *      requested or shown here.
 *
 * Requires assets/js/supabase-config.js to run first.
 */
(function () {
  "use strict";

  if (!window.matexSupabase) {
    document.getElementById("state-loading").hidden = true;
    document.getElementById("state-error").hidden = false;
    return;
  }

  var sb = window.matexSupabase;

  var states = {
    loading: document.getElementById("state-loading"),
    signedOut: document.getElementById("state-signed-out"),
    requestAccess: document.getElementById("state-request-access"),
    requestStatus: document.getElementById("state-request-status"),
    profile: document.getElementById("state-profile"),
    error: document.getElementById("state-error")
  };

  function showState(name) {
    Object.keys(states).forEach(function (key) {
      states[key].hidden = key !== name;
    });
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function fieldRow(label, value) {
    return (
      '<li><span class="k">' + escapeHtml(label) + '</span><span class="v">' +
      (value ? escapeHtml(value) : "&mdash;") + "</span></li>"
    );
  }

  document.getElementById("sign-out-btn").addEventListener("click", function () {
    sb.auth.signOut().then(function () {
      window.location.href = "portal-login.html";
    });
  });

  function loadRequestStatus(userId) {
    sb.from("portal_access_requests")
      .select("status, created_at")
      // Explicit filter, not just reliance on RLS — same reasoning as the
      // .eq() on the members query below: if this table's RLS grants
      // admins (or anyone else) broader read access, an unfiltered
      // order+limit(1) here could return someone else's request instead
      // of the signed-in user's own.
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .then(function (res) {
        if (res.error) {
          console.error("[MATEX Supabase] portal_access_requests select error:", res.error.message);
          showState("error");
          return;
        }
        var row = res.data && res.data[0];
        if (!row) {
          showState("requestAccess");
          return;
        }
        var msgEl = document.getElementById("request-status-message");
        if (row.status === "pending") {
          msgEl.dataset.state = "pending";
          msgEl.textContent = "Your access request is pending review. We'll let you know once it's approved.";
        } else if (row.status === "denied") {
          msgEl.dataset.state = "denied";
          msgEl.textContent = "We couldn't verify your access request. Please contact us at matexdallas@gmail.com.";
        } else {
          // approved, but members row still didn't come back — treat as transient/error
          msgEl.dataset.state = "error";
          msgEl.textContent = "Your request was approved, but we couldn't load your profile. Please refresh or contact us.";
        }
        showState("requestStatus");
      })
      .catch(function (err) {
        console.error("[MATEX Supabase] portal_access_requests select threw:", err);
        showState("error");
      });
  }

  function loadProfile(user) {
    sb.from("members")
      .select("first_name, middle_name, last_name, email, phone, address_line1, address_line2, city, state, postal_code, status, joined_date")
      // Explicit filter, not just reliance on RLS: an admin's own RLS
      // policy grants access to ALL rows (not just their own), so
      // without this .eq() an admin who is also a linked member would
      // match every row and .maybeSingle() would error.
      .eq("auth_user_id", user.id)
      .maybeSingle()
      .then(function (res) {
        if (res.error) {
          console.error("[MATEX Supabase] members select error:", res.error.message);
          showState("error");
          return;
        }
        if (!res.data) {
          loadRequestStatus(user.id);
          return;
        }
        var m = res.data;
        var fullName = [m.first_name, m.middle_name, m.last_name].filter(Boolean).join(" ");
        var address = [m.address_line1, m.address_line2, [m.city, m.state, m.postal_code].filter(Boolean).join(", ")]
          .filter(Boolean)
          .join(", ");

        var list = document.getElementById("profile-list");
        list.innerHTML =
          fieldRow("Name", fullName) +
          fieldRow("Email", m.email) +
          fieldRow("Phone", m.phone) +
          fieldRow("Address", address) +
          fieldRow("Status", m.status) +
          fieldRow("Joined", m.joined_date);

        showState("profile");
      })
      .catch(function (err) {
        console.error("[MATEX Supabase] members select threw:", err);
        showState("error");
      });
  }

  var requestForm = document.getElementById("access-request-form");
  requestForm.addEventListener("submit", function (event) {
    event.preventDefault();

    sb.auth.getSession().then(function (sessionRes) {
      var user = sessionRes.data && sessionRes.data.session && sessionRes.data.session.user;
      if (!user) {
        window.location.href = "portal-login.html";
        return;
      }

      var btn = requestForm.querySelector("button[type='submit']");
      btn.disabled = true;
      btn.textContent = "Submitting…";

      sb.from("portal_access_requests")
        .insert({
          user_id: user.id,
          requester_email: user.email || null,
          claimed_full_name: requestForm.full_name.value.trim(),
          claimed_member_number: requestForm.member_number.value.trim(),
          claimed_phone_last4: requestForm.phone_last4.value.trim() || null
        })
        .then(function (res) {
          if (res.error) {
            console.error("[MATEX Supabase] portal_access_requests insert error:", res.error.message);
            btn.disabled = false;
            btn.textContent = "Request Access";
            return;
          }
          loadRequestStatus(user.id);
        })
        .catch(function (err) {
          console.error("[MATEX Supabase] portal_access_requests insert threw:", err);
          btn.disabled = false;
          btn.textContent = "Request Access";
        });
    });
  });

  // ---------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------
  sb.auth.getSession().then(function (res) {
    var session = res.data && res.data.session;
    if (!session) {
      showState("signedOut");
      window.location.href = "portal-login.html";
      return;
    }
    document.getElementById("portal-email").textContent = session.user.email || "";
    loadProfile(session.user);
  }).catch(function (err) {
    console.error("[MATEX Supabase] getSession threw:", err);
    showState("error");
  });
})();
