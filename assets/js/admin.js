/**
 * MATEX Dallas — Admin Portal
 * ==============================
 * On load:
 *   1. If not signed in, redirect to portal-login.html.
 *   2. Check `admins` for a row matching auth.uid() (RLS lets a user
 *      read only their own admin row — see 003_admin_portal.sql). No
 *      row → "access denied", nothing else is fetched.
 *   3. If admin: load pending portal_access_requests (RLS grants
 *      admins full read/update on this table) and try to match each
 *      one to a members row by member_number, so the admin can
 *      approve (link + mark approved) or deny in one click.
 *   4. Also load the full members list (RLS grants admins full read)
 *      for browsing/search. Read-only — no editing here yet; that's
 *      reserved for a future "membership status" build.
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
  var currentUser = null;
  var allMembers = [];

  var states = {
    loading: document.getElementById("state-loading"),
    denied: document.getElementById("state-denied"),
    error: document.getElementById("state-error"),
    admin: document.getElementById("state-admin")
  };

  function showState(name) {
    Object.keys(states).forEach(function (key) {
      states[key].hidden = key !== name;
    });
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function fullName(m) {
    return [m.first_name, m.middle_name, m.last_name].filter(Boolean).join(" ");
  }

  document.getElementById("sign-out-btn").addEventListener("click", function () {
    sb.auth.signOut().then(function () {
      window.location.href = "portal-login.html";
    });
  });

  // ---------------------------------------------------------------
  // Members table
  // ---------------------------------------------------------------
  function renderMembers(members) {
    var tbody = document.getElementById("members-tbody");
    tbody.innerHTML = members
      .map(function (m) {
        return (
          "<tr>" +
          "<td>" + escapeHtml(m.member_number) + "</td>" +
          "<td>" + escapeHtml(fullName(m)) + "</td>" +
          "<td>" + escapeHtml(m.email) + "</td>" +
          "<td>" + escapeHtml(m.phone) + "</td>" +
          "<td>" + escapeHtml(m.status) + "</td>" +
          "<td>" + escapeHtml(m.joined_date) + "</td>" +
          "<td>" + (m.auth_user_id ? "Yes" : "&mdash;") + "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function loadMembers() {
    return sb
      .from("members")
      .select("id, member_number, first_name, middle_name, last_name, email, phone, status, joined_date, auth_user_id")
      .order("last_name", { ascending: true })
      .then(function (res) {
        if (res.error) {
          console.error("[MATEX Supabase] admin members select error:", res.error.message);
          return;
        }
        allMembers = res.data || [];
        renderMembers(allMembers);
      });
  }

  document.getElementById("member-search").addEventListener("input", function (event) {
    var q = event.target.value.trim().toLowerCase();
    if (!q) {
      renderMembers(allMembers);
      return;
    }
    renderMembers(
      allMembers.filter(function (m) {
        return (
          (m.member_number && m.member_number.toLowerCase().indexOf(q) !== -1) ||
          (m.email && m.email.toLowerCase().indexOf(q) !== -1) ||
          fullName(m).toLowerCase().indexOf(q) !== -1
        );
      })
    );
  });

  // ---------------------------------------------------------------
  // Access requests
  // ---------------------------------------------------------------
  function findMatch(memberNumber) {
    var target = (memberNumber || "").trim();
    return allMembers.find(function (m) {
      return (m.member_number || "").trim() === target;
    });
  }

  function renderRequests(requests) {
    var wrap = document.getElementById("requests-table-wrap");
    var empty = document.getElementById("requests-empty");
    var tbody = document.getElementById("requests-tbody");

    if (!requests.length) {
      wrap.hidden = true;
      empty.hidden = false;
      return;
    }
    wrap.hidden = false;
    empty.hidden = true;

    tbody.innerHTML = requests
      .map(function (r) {
        var match = findMatch(r.claimed_member_number);
        var matchCell = match
          ? '<span class="match-ok">' + escapeHtml(fullName(match)) + "</span>"
          : '<span class="match-none">No match</span>';
        return (
          "<tr data-request-id=\"" + r.id + "\" data-member-id=\"" + (match ? match.id : "") + "\">" +
          "<td>" + escapeHtml(new Date(r.created_at).toLocaleDateString()) + "</td>" +
          "<td>" + escapeHtml(r.requester_email) + "</td>" +
          "<td>" + escapeHtml(r.claimed_full_name) + "</td>" +
          "<td>" + escapeHtml(r.claimed_member_number) + "</td>" +
          "<td>" + escapeHtml(r.claimed_phone_last4) + "</td>" +
          "<td>" + matchCell + "</td>" +
          '<td class="req-actions">' +
          '<button type="button" class="btn btn-primary btn-sm" data-action="approve"' +
          (match ? "" : " disabled") +
          ">Approve</button>" +
          '<button type="button" class="btn btn-deny btn-sm" data-action="deny">Deny</button>' +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function loadRequests() {
    return sb
      .from("portal_access_requests")
      .select("id, user_id, requester_email, claimed_full_name, claimed_member_number, claimed_phone_last4, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .then(function (res) {
        if (res.error) {
          console.error("[MATEX Supabase] admin requests select error:", res.error.message);
          return;
        }
        renderRequests(res.data || []);
      });
  }

  document.getElementById("requests-tbody").addEventListener("click", function (event) {
    var btn = event.target.closest("button[data-action]");
    if (!btn) return;
    var row = btn.closest("tr");
    var requestId = row.getAttribute("data-request-id");
    var memberId = row.getAttribute("data-member-id");
    var action = btn.getAttribute("data-action");

    row.querySelectorAll("button").forEach(function (b) { b.disabled = true; });

    var reviewFields = {
      reviewed_at: new Date().toISOString(),
      reviewed_by: (currentUser && currentUser.email) || "admin"
    };

    var chain;
    if (action === "approve") {
      if (!memberId) return; // shouldn't happen, button is disabled without a match
      // auth_user_id lives on the request row, not in the DOM — fetch it,
      // then link the member, then mark the request approved.
      chain = sb
        .from("portal_access_requests")
        .select("user_id")
        .eq("id", requestId)
        .single()
        .then(function (res) {
          if (res.error || !res.data) throw res.error || new Error("Request not found");
          return sb.from("members").update({ auth_user_id: res.data.user_id }).eq("id", memberId);
        })
        .then(function (res) {
          if (res.error) throw res.error;
          return sb
            .from("portal_access_requests")
            .update(Object.assign({ status: "approved" }, reviewFields))
            .eq("id", requestId);
        });
    } else {
      chain = sb
        .from("portal_access_requests")
        .update(Object.assign({ status: "denied" }, reviewFields))
        .eq("id", requestId);
    }

    chain
      .then(function (res) {
        if (res && res.error) throw res.error;
        // Refresh members first — loadRequests() re-matches against
        // allMembers, so it must run after allMembers is up to date.
        return loadMembers().then(loadRequests);
      })
      .catch(function (err) {
        console.error("[MATEX Supabase] request review error:", err && err.message ? err.message : err);
        row.querySelectorAll("button").forEach(function (b) { b.disabled = false; });
      });
  });

  // ---------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------
  sb.auth
    .getSession()
    .then(function (res) {
      var session = res.data && res.data.session;
      if (!session) {
        window.location.href = "portal-login.html";
        return;
      }
      currentUser = session.user;
      document.getElementById("admin-email").textContent = currentUser.email || "";

      return sb.from("admins").select("id").eq("id", currentUser.id).maybeSingle();
    })
    .then(function (res) {
      if (!res) return; // already redirected
      if (res.error) {
        console.error("[MATEX Supabase] admins select error:", res.error.message);
        showState("error");
        return;
      }
      if (!res.data) {
        showState("denied");
        return;
      }
      showState("admin");
      // loadRequests() matches against allMembers, so members must load first.
      return loadMembers().then(loadRequests);
    })
    .catch(function (err) {
      console.error("[MATEX Supabase] admin boot threw:", err);
      showState("error");
    });
})();
