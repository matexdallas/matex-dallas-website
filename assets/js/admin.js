/**
 * MATEX Dallas — Admin Portal
 * ==============================
 * On load:
 *   1. If not signed in, redirect to portal-login.html.
 *   2. Check `admins` for a row matching auth.uid() (RLS lets a user
 *      read only their own admin row — see 003_admin_portal.sql). No
 *      row → "access denied", nothing else is fetched.
 *   3. If admin: load pending membership_applications (public "apply
 *      to join" submissions from join.html — see
 *      004_membership_applications.sql). Approve shows a suggested
 *      next member number (editable) and, on confirm, creates the
 *      real members row + marks the application approved. Deny just
 *      marks it declined.
 *   4. Load pending portal_access_requests (RLS grants admins full
 *      read/update on this table) and try to match each one to a
 *      members row by member_number, so the admin can approve (link +
 *      mark approved) or deny in one click.
 *   5. Also load the full members list (RLS grants admins full read,
 *      update, and insert) for browsing/search, with inline editing
 *      of names only (first/middle/last). Other fields — status,
 *      contact info, dues — are still read-only here, reserved for a
 *      future "membership status" build.
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
  var editingMemberId = null;

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
  function nameCellHtml(m) {
    if (m.id !== editingMemberId) {
      return escapeHtml(fullName(m));
    }
    return (
      '<div class="name-edit">' +
      '<input type="text" data-field="first_name" placeholder="First" value="' + escapeHtml(m.first_name) + '">' +
      '<input type="text" data-field="middle_name" placeholder="Middle" value="' + escapeHtml(m.middle_name) + '">' +
      '<input type="text" data-field="last_name" placeholder="Last" value="' + escapeHtml(m.last_name) + '">' +
      "</div>"
    );
  }

  function actionsCellHtml(m) {
    if (m.id !== editingMemberId) {
      return '<button type="button" class="btn btn-outline-navy btn-sm" data-action="edit-name">Edit</button>';
    }
    return (
      '<div class="row-actions">' +
      '<button type="button" class="btn btn-primary btn-sm" data-action="save-name">Save</button>' +
      '<button type="button" class="btn btn-deny btn-sm" data-action="cancel-name">Cancel</button>' +
      "</div>"
    );
  }

  function renderMembers(members) {
    var tbody = document.getElementById("members-tbody");
    tbody.innerHTML = members
      .map(function (m) {
        return (
          '<tr data-member-id="' + m.id + '">' +
          "<td>" + escapeHtml(m.member_number) + "</td>" +
          "<td>" + nameCellHtml(m) + "</td>" +
          "<td>" + escapeHtml(m.email) + "</td>" +
          "<td>" + escapeHtml(m.phone) + "</td>" +
          "<td>" + escapeHtml(m.status) + "</td>" +
          "<td>" + escapeHtml(m.joined_date) + "</td>" +
          "<td>" + (m.auth_user_id ? "Yes" : "&mdash;") + "</td>" +
          "<td>" + actionsCellHtml(m) + "</td>" +
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

  document.getElementById("members-tbody").addEventListener("click", function (event) {
    var btn = event.target.closest("button[data-action]");
    if (!btn) return;
    var row = btn.closest("tr");
    var memberId = row.getAttribute("data-member-id");
    var action = btn.getAttribute("data-action");

    if (action === "edit-name") {
      editingMemberId = memberId;
      renderMembers(allMembers);
      return;
    }

    if (action === "cancel-name") {
      editingMemberId = null;
      renderMembers(allMembers);
      return;
    }

    if (action === "save-name") {
      var inputs = row.querySelectorAll(".name-edit input");
      var updates = {};
      inputs.forEach(function (input) {
        updates[input.getAttribute("data-field")] = input.value.trim() || null;
      });
      if (!updates.first_name || !updates.last_name) {
        return; // first/last are required — leave the fields open for correction
      }

      btn.disabled = true;
      btn.textContent = "Saving…";

      sb.from("members")
        .update(updates)
        .eq("id", memberId)
        .then(function (res) {
          if (res.error) {
            console.error("[MATEX Supabase] members name update error:", res.error.message);
            btn.disabled = false;
            btn.textContent = "Save";
            return;
          }
          editingMemberId = null;
          return loadMembers();
        })
        .catch(function (err) {
          console.error("[MATEX Supabase] members name update threw:", err);
          btn.disabled = false;
          btn.textContent = "Save";
        });
    }
  });

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
  // New member applications
  // ---------------------------------------------------------------
  var editingApprovalId = null;

  function suggestNextMemberNumber() {
    var maxN = 0;
    var width = 4;
    allMembers.forEach(function (m) {
      var match = /^MATEX-(\d+)$/i.exec((m.member_number || "").trim());
      if (match) {
        var n = parseInt(match[1], 10);
        if (n > maxN) maxN = n;
        width = Math.max(width, match[1].length);
      }
    });
    var next = String(maxN + 1);
    while (next.length < width) next = "0" + next;
    return "MATEX-" + next;
  }

  function applicantName(a) {
    return [a.first_name, a.middle_name, a.last_name].filter(Boolean).join(" ");
  }

  function applicationActionsHtml(a) {
    if (a.id !== editingApprovalId) {
      return (
        '<div class="req-actions">' +
        '<button type="button" class="btn btn-primary btn-sm" data-action="start-approve">Approve</button>' +
        '<button type="button" class="btn btn-deny btn-sm" data-action="deny-application">Deny</button>' +
        "</div>"
      );
    }
    return (
      '<div class="approve-edit">' +
      '<input type="text" data-field="member_number" value="' + escapeHtml(suggestNextMemberNumber()) + '">' +
      '<button type="button" class="btn btn-primary btn-sm" data-action="confirm-approve">Confirm</button>' +
      '<button type="button" class="btn btn-deny btn-sm" data-action="cancel-approve">Cancel</button>' +
      "</div>"
    );
  }

  function renderApplications(applications) {
    var wrap = document.getElementById("applications-table-wrap");
    var empty = document.getElementById("applications-empty");
    var tbody = document.getElementById("applications-tbody");

    if (!applications.length) {
      wrap.hidden = true;
      empty.hidden = false;
      return;
    }
    wrap.hidden = false;
    empty.hidden = true;

    tbody.innerHTML = applications
      .map(function (a) {
        return (
          '<tr data-application-id="' + a.id + '">' +
          "<td>" + escapeHtml(new Date(a.created_at).toLocaleDateString()) + "</td>" +
          "<td>" + escapeHtml(applicantName(a)) + "</td>" +
          "<td>" + escapeHtml(a.email) + "</td>" +
          "<td>" + escapeHtml(a.phone) + "</td>" +
          "<td>" + escapeHtml(a.membership_type) + "</td>" +
          "<td>" + escapeHtml(a.message) + "</td>" +
          "<td>" + applicationActionsHtml(a) + "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function loadApplications() {
    return sb
      .from("membership_applications")
      .select("id, first_name, middle_name, last_name, email, phone, address_line1, address_line2, city, state, postal_code, membership_type, message, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .then(function (res) {
        if (res.error) {
          console.error("[MATEX Supabase] admin applications select error:", res.error.message);
          return;
        }
        renderApplications(res.data || []);
      });
  }

  document.getElementById("applications-tbody").addEventListener("click", function (event) {
    var btn = event.target.closest("button[data-action]");
    if (!btn) return;
    var row = btn.closest("tr");
    var applicationId = row.getAttribute("data-application-id");
    var action = btn.getAttribute("data-action");

    if (action === "start-approve") {
      editingApprovalId = applicationId;
      loadApplications();
      return;
    }

    if (action === "cancel-approve") {
      editingApprovalId = null;
      loadApplications();
      return;
    }

    if (action === "deny-application") {
      row.querySelectorAll("button").forEach(function (b) { b.disabled = true; });
      sb.from("membership_applications")
        .update({
          status: "denied",
          reviewed_at: new Date().toISOString(),
          reviewed_by: (currentUser && currentUser.email) || "admin"
        })
        .eq("id", applicationId)
        .then(function (res) {
          if (res.error) throw res.error;
          return loadApplications();
        })
        .catch(function (err) {
          console.error("[MATEX Supabase] application deny error:", err && err.message ? err.message : err);
          row.querySelectorAll("button").forEach(function (b) { b.disabled = false; });
        });
      return;
    }

    if (action === "confirm-approve") {
      var memberNumberInput = row.querySelector('.approve-edit input[data-field="member_number"]');
      var memberNumber = memberNumberInput.value.trim();
      if (!memberNumber) return;

      row.querySelectorAll("button, input").forEach(function (el) { el.disabled = true; });

      sb.from("membership_applications")
        .select("first_name, middle_name, last_name, email, phone, address_line1, address_line2, city, state, postal_code")
        .eq("id", applicationId)
        .single()
        .then(function (res) {
          if (res.error || !res.data) throw res.error || new Error("Application not found");
          var a = res.data;
          return sb
            .from("members")
            .insert({
              member_number: memberNumber,
              first_name: a.first_name,
              middle_name: a.middle_name,
              last_name: a.last_name,
              email: a.email,
              phone: a.phone,
              address_line1: a.address_line1,
              address_line2: a.address_line2,
              city: a.city,
              state: a.state,
              postal_code: a.postal_code,
              status: "active",
              joined_date: new Date().toISOString().slice(0, 10)
            })
            .select("id")
            .single();
        })
        .then(function (res) {
          if (res.error) throw res.error;
          return sb
            .from("membership_applications")
            .update({
              status: "approved",
              reviewed_at: new Date().toISOString(),
              reviewed_by: (currentUser && currentUser.email) || "admin",
              created_member_id: res.data.id
            })
            .eq("id", applicationId);
        })
        .then(function (res) {
          if (res && res.error) throw res.error;
          editingApprovalId = null;
          return loadMembers().then(function () {
            return Promise.all([loadApplications(), loadRequests()]);
          });
        })
        .catch(function (err) {
          console.error("[MATEX Supabase] application approve error:", err && err.message ? err.message : err);
          row.querySelectorAll("button, input").forEach(function (el) { el.disabled = false; });
        });
    }
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
      return loadMembers().then(function () {
        return Promise.all([loadRequests(), loadApplications()]);
      });
    })
    .catch(function (err) {
      console.error("[MATEX Supabase] admin boot threw:", err);
      showState("error");
    });
})();
