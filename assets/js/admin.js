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
 *      next member number (editable) and, on confirm, calls the
 *      approve_membership_application RPC (see
 *      008_approve_application_rpc.sql) to create the real members
 *      row and mark the application approved as one atomic
 *      transaction. Deny just marks it declined.
 *   4. Load pending portal_access_requests (RLS grants admins full
 *      read/update on this table) and try to match each one to a
 *      members row by member_number, so the admin can approve (link +
 *      mark approved) or deny in one click.
 *   5. Also load the full members list (RLS grants admins full read,
 *      update, and insert) for browsing/search, plus a manual
 *      "+ Add Member" form for entering someone directly (not via a
 *      join.html application).
 *
 *      Editing an existing member is permission-gated (see
 *      012_admin_permission_tiers.sql): every admin can edit name
 *      fields inline. An admin whose `admins` row has
 *      can_edit_all_fields = true instead gets a full edit panel
 *      (email, phone, address, status, membership type, member
 *      number, joined date) — enforced by a DB trigger, not just
 *      hidden in the UI, so a limited admin's attempt to change a
 *      non-name field via a direct API call is rejected the same way.
 *      Deleting a member (and removing a logged dues payment) is
 *      similarly gated on can_delete and hidden from the UI entirely
 *      for admins who don't have it.
 *   6. Load all contact_messages (public Contact page submissions —
 *      see 005_contact_messages.sql), newest first, with a status
 *      cycle (new → read → archived). This does not send email;
 *      there's no email service wired up.
 *   7. Load all dues_payments (see 006_dues_payments.sql) — a manual
 *      ledger, not a payment processor. Actual money still moves via
 *      donate.html's PayPal/Zelle; this just records "member X paid
 *      $Y toward year N's dues" so the roster can show paid/owed per
 *      member. Each member row expands into a per-member panel: set
 *      membership_type (drives the owed amount, $85 single/$170
 *      couple), see payment history (any year), log a new payment,
 *      or remove a mis-entered one. Entirely admin-only — no public
 *      access to this table at all.
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
  var allDuesPayments = [];
  var expandedDuesMemberId = null;
  var DUES_YEAR = new Date().getFullYear();
  // Matches the pricing on membership.html — update both places if it changes.
  var DUES_AMOUNTS = { single: 85, couple: 170 };
  var editingMemberId = null;
  // Set during boot from this admin's own `admins` row (012_admin_permission_tiers.sql).
  // Both default to false until boot resolves, so nothing destructive/
  // broad-scope renders before we actually know this admin's capabilities.
  var currentAdminCanEditAllFields = false;
  var currentAdminCanDelete = false;

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
  // Contact messages
  // ---------------------------------------------------------------
  var CONTACT_NEXT_STATUS = { new: "read", read: "archived" };
  var CONTACT_BUTTON_LABEL = { new: "Mark Read", read: "Archive" };

  function contactActionsHtml(c) {
    var next = CONTACT_NEXT_STATUS[c.status];
    if (!next) return "&mdash;"; // archived — no further action
    return (
      '<button type="button" class="btn btn-outline-navy btn-sm" data-action="advance-status" data-next="' +
      next + '">' + CONTACT_BUTTON_LABEL[c.status] + "</button>"
    );
  }

  function renderContactMessages(messages) {
    var wrap = document.getElementById("contact-table-wrap");
    var empty = document.getElementById("contact-empty");
    var tbody = document.getElementById("contact-tbody");

    if (!messages.length) {
      wrap.hidden = true;
      empty.hidden = false;
      return;
    }
    wrap.hidden = false;
    empty.hidden = true;

    tbody.innerHTML = messages
      .map(function (c) {
        return (
          '<tr data-message-id="' + escapeHtml(c.id) + '">' +
          "<td>" + escapeHtml(new Date(c.created_at).toLocaleDateString()) + "</td>" +
          "<td>" + escapeHtml(c.name) + "</td>" +
          "<td>" + escapeHtml(c.email) + "</td>" +
          "<td>" + escapeHtml(c.reason) + "</td>" +
          "<td>" + escapeHtml(c.message) + "</td>" +
          "<td>" + escapeHtml(c.status) + "</td>" +
          "<td>" + contactActionsHtml(c) + "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function loadContactMessages() {
    return sb
      .from("contact_messages")
      .select("id, name, email, reason, message, status, created_at")
      .order("created_at", { ascending: false })
      .then(function (res) {
        if (res.error) {
          console.error("[MATEX Supabase] admin contact_messages select error:", res.error.message);
          return;
        }
        renderContactMessages(res.data || []);
      });
  }

  document.getElementById("contact-tbody").addEventListener("click", function (event) {
    var btn = event.target.closest("button[data-action='advance-status']");
    if (!btn) return;
    var row = btn.closest("tr");
    var messageId = row.getAttribute("data-message-id");
    var nextStatus = btn.getAttribute("data-next");

    btn.disabled = true;
    sb.from("contact_messages")
      .update({ status: nextStatus })
      .eq("id", messageId)
      .then(function (res) {
        if (res.error) throw res.error;
        return loadContactMessages();
      })
      .catch(function (err) {
        console.error("[MATEX Supabase] contact message status update error:", err && err.message ? err.message : err);
        btn.disabled = false;
      });
  });

  // ---------------------------------------------------------------
  // Members table
  // ---------------------------------------------------------------
  function nameCellHtml(m) {
    // Full-access admins edit via the panel (memberEditPanelHtml) below
    // the row instead of inline here, since the panel also covers
    // fields (address, etc.) that have no table column to edit inline.
    if (m.id !== editingMemberId || currentAdminCanEditAllFields) {
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
      var html = '<div class="row-actions">' +
        '<button type="button" class="btn btn-outline-navy btn-sm" data-action="edit-name">Edit</button>';
      if (currentAdminCanDelete) {
        html += '<button type="button" class="btn btn-deny btn-sm" data-action="delete-member">Delete</button>';
      }
      return html + "</div>";
    }
    if (currentAdminCanEditAllFields) {
      // Save lives inside the panel's own form (memberEditPanelHtml) —
      // this button just closes it without saving.
      return '<button type="button" class="btn btn-deny btn-sm" data-action="cancel-name">Close</button>';
    }
    return (
      '<div class="row-actions">' +
      '<button type="button" class="btn btn-primary btn-sm" data-action="save-name">Save</button>' +
      '<button type="button" class="btn btn-deny btn-sm" data-action="cancel-name">Cancel</button>' +
      "</div>"
    );
  }

  function memberEditPanelHtml(m) {
    function field(label, name, value, type) {
      return (
        '<div class="form-row"><label>' + escapeHtml(label) + "</label>" +
        '<input type="' + (type || "text") + '" data-field="' + name + '" value="' + escapeHtml(value) + '"></div>'
      );
    }
    return (
      '<tr class="member-edit-panel-row" data-member-id="' + escapeHtml(m.id) + '"><td colspan="9"><div class="dues-panel">' +
      '<form class="form-grid member-edit-form">' +
      '<div class="form-2col">' +
      field("First name", "first_name", m.first_name) +
      field("Last name", "last_name", m.last_name) +
      "</div>" +
      field("Middle name", "middle_name", m.middle_name) +
      '<div class="form-2col">' +
      field("Email", "email", m.email, "email") +
      field("Phone", "phone", m.phone, "tel") +
      "</div>" +
      '<div class="form-2col">' +
      field("Member number", "member_number", m.member_number) +
      field("Status", "status", m.status) +
      "</div>" +
      field("Address line 1", "address_line1", m.address_line1) +
      field("Address line 2", "address_line2", m.address_line2) +
      '<div class="form-2col">' +
      field("City", "city", m.city) +
      field("State", "state", m.state) +
      "</div>" +
      '<div class="form-2col">' +
      field("ZIP code", "postal_code", m.postal_code) +
      field("Joined date", "joined_date", m.joined_date, "date") +
      "</div>" +
      '<div class="form-row" style="max-width:240px;">' +
      '<label>Membership type</label>' +
      '<select data-field="membership_type">' +
      '<option value=""' + (!m.membership_type ? " selected" : "") + ">Not set</option>" +
      '<option value="single"' + (m.membership_type === "single" ? " selected" : "") + ">Single — $85/yr</option>" +
      '<option value="couple"' + (m.membership_type === "couple" ? " selected" : "") + ">Couple — $170/yr</option>" +
      "</select></div>" +
      '<button type="submit" class="btn btn-primary btn-sm">Save</button>' +
      "</form>" +
      "</div></td></tr>"
    );
  }

  function duesPaidThisYear(memberId) {
    return allDuesPayments
      .filter(function (p) { return p.member_id === memberId && p.dues_year === DUES_YEAR; })
      .reduce(function (sum, p) { return sum + Number(p.amount); }, 0);
  }

  function duesCellHtml(m) {
    var owed = m.membership_type ? DUES_AMOUNTS[m.membership_type] : null;
    var summary;
    if (owed == null) {
      summary = '<span style="color:var(--muted);">Type not set</span>';
    } else {
      var paid = duesPaidThisYear(m.id);
      var balance = owed - paid;
      var balanceClass = balance <= 0 ? "dues-balance-ok" : "dues-balance-due";
      var balanceText = balance <= 0 ? "Paid" : "$" + balance.toFixed(2) + " due";
      summary =
        "$" + paid.toFixed(2) + " / $" + owed.toFixed(2) +
        ' <span class="' + balanceClass + '">(' + balanceText + ")</span>";
    }
    return (
      '<div class="dues-summary">' + summary +
      '<button type="button" class="btn btn-outline-navy btn-sm" data-action="toggle-dues">' +
      (m.id === expandedDuesMemberId ? "Hide" : "Manage") + "</button></div>"
    );
  }

  function duesPanelRowHtml(m) {
    var payments = allDuesPayments.filter(function (p) { return p.member_id === m.id; });

    var typeSelectHtml =
      '<select class="dues-type-select" data-field="membership_type">' +
      '<option value=""' + (!m.membership_type ? " selected" : "") + ">Not set</option>" +
      '<option value="single"' + (m.membership_type === "single" ? " selected" : "") + ">Single — $85/yr</option>" +
      '<option value="couple"' + (m.membership_type === "couple" ? " selected" : "") + ">Couple — $170/yr</option>" +
      "</select>";

    var historyRows = payments.length
      ? payments
          .map(function (p) {
            var removeCell = currentAdminCanDelete
              ? '<button type="button" class="btn btn-deny btn-sm" data-action="remove-payment" data-payment-id="' +
                escapeHtml(p.id) + '">Remove</button>'
              : "&mdash;";
            return (
              "<tr>" +
              "<td>" + escapeHtml(p.payment_date) + "</td>" +
              "<td>" + escapeHtml(p.dues_year) + "</td>" +
              "<td>$" + Number(p.amount).toFixed(2) + "</td>" +
              "<td>" + escapeHtml(p.payment_method) + "</td>" +
              "<td>" + escapeHtml(p.note) + "</td>" +
              "<td>" + removeCell + "</td>" +
              "</tr>"
            );
          })
          .join("")
      : '<tr><td colspan="6" style="color:var(--muted);">No payments logged yet.</td></tr>';

    var today = new Date().toISOString().slice(0, 10);

    return (
      '<tr class="dues-panel-row" data-member-id="' + escapeHtml(m.id) + '"><td colspan="9"><div class="dues-panel">' +
      '<div class="form-row" style="max-width:240px; margin-bottom: var(--space-4);">' +
      "<label>Membership type</label>" + typeSelectHtml +
      "</div>" +
      '<table class="dues-history-table"><thead><tr><th>Date</th><th>Year</th><th>Amount</th><th>Method</th><th>Note</th><th></th></tr></thead>' +
      "<tbody>" + historyRows + "</tbody></table>" +
      '<form class="dues-add-form">' +
      '<div class="form-row"><label>Amount</label><input type="number" step="0.01" min="0.01" name="amount" required style="width:90px;"></div>' +
      '<div class="form-row"><label>Method</label><select name="payment_method">' +
      '<option value="paypal">PayPal</option><option value="zelle">Zelle</option><option value="cash">Cash</option>' +
      '<option value="check">Check</option><option value="other">Other</option></select></div>' +
      '<div class="form-row"><label>Date</label><input type="date" name="payment_date" value="' + today + '"></div>' +
      '<div class="form-row"><label>Year</label><input type="number" name="dues_year" value="' + DUES_YEAR + '" style="width:75px;"></div>' +
      '<div class="form-row"><label>Note</label><input type="text" name="note" style="width:130px;"></div>' +
      '<button type="submit" class="btn btn-primary btn-sm">Log Payment</button>' +
      "</form>" +
      "</div></td></tr>"
    );
  }

  function renderMembers(members) {
    var tbody = document.getElementById("members-tbody");
    tbody.innerHTML = members
      .map(function (m) {
        var row =
          '<tr data-member-id="' + escapeHtml(m.id) + '">' +
          "<td>" + escapeHtml(m.member_number) + "</td>" +
          "<td>" + nameCellHtml(m) + "</td>" +
          "<td>" + escapeHtml(m.email) + "</td>" +
          "<td>" + escapeHtml(m.phone) + "</td>" +
          "<td>" + escapeHtml(m.status) + "</td>" +
          "<td>" + duesCellHtml(m) + "</td>" +
          "<td>" + escapeHtml(m.joined_date) + "</td>" +
          "<td>" + (m.auth_user_id ? "Yes" : "&mdash;") + "</td>" +
          "<td>" + actionsCellHtml(m) + "</td>" +
          "</tr>";
        if (m.id === expandedDuesMemberId) row += duesPanelRowHtml(m);
        if (m.id === editingMemberId && currentAdminCanEditAllFields) row += memberEditPanelHtml(m);
        return row;
      })
      .join("");
  }

  function getFilteredMembers() {
    var q = document.getElementById("member-search").value.trim().toLowerCase();
    if (!q) return allMembers;
    return allMembers.filter(function (m) {
      return (
        (m.member_number && m.member_number.toLowerCase().indexOf(q) !== -1) ||
        (m.email && m.email.toLowerCase().indexOf(q) !== -1) ||
        fullName(m).toLowerCase().indexOf(q) !== -1
      );
    });
  }

  function refreshMembersTable() {
    renderMembers(getFilteredMembers());
  }

  function loadMembers() {
    return sb
      .from("members")
      .select("id, member_number, first_name, middle_name, last_name, email, phone, status, joined_date, auth_user_id, membership_type, address_line1, address_line2, city, state, postal_code")
      .order("last_name", { ascending: true })
      .then(function (res) {
        if (res.error) {
          console.error("[MATEX Supabase] admin members select error:", res.error.message);
          return;
        }
        allMembers = res.data || [];
        refreshMembersTable();
      });
  }

  function loadDuesPayments() {
    return sb
      .from("dues_payments")
      .select("id, member_id, dues_year, amount, payment_method, payment_date, note")
      .order("payment_date", { ascending: false })
      .then(function (res) {
        if (res.error) {
          console.error("[MATEX Supabase] dues_payments select error:", res.error.message);
          return;
        }
        allDuesPayments = res.data || [];
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
      refreshMembersTable();
      return;
    }

    if (action === "cancel-name") {
      editingMemberId = null;
      refreshMembersTable();
      return;
    }

    if (action === "toggle-dues") {
      expandedDuesMemberId = expandedDuesMemberId === memberId ? null : memberId;
      refreshMembersTable();
      return;
    }

    if (action === "delete-member") {
      var member = allMembers.find(function (mm) { return mm.id === memberId; });
      var confirmName = member ? fullName(member) : "this member";
      // A confirm() prompt here is a deliberate exception to the rest of
      // this file's no-confirm-dialog style (see dues payment "Remove",
      // which has none) — deleting a member is a lot harder to shrug off
      // than removing one payment row, and it also cascades to that
      // member's whole dues payment history (see
      // 010_members_delete_admin.sql).
      if (!window.confirm("Delete " + confirmName + "? This also deletes their logged dues payment history. This cannot be undone.")) {
        return;
      }

      btn.disabled = true;
      sb.from("members")
        .delete()
        .eq("id", memberId)
        .then(function (res) {
          if (res.error) throw res.error;
          if (expandedDuesMemberId === memberId) expandedDuesMemberId = null;
          return loadMembers();
        })
        .catch(function (err) {
          var message = err && err.message ? err.message : String(err);
          console.error("[MATEX Supabase] members delete error:", message);
          // A failed delete (e.g. blocked by a foreign key, or an RLS/
          // permissions issue) previously failed silently — nothing
          // told the admin it didn't work short of opening DevTools.
          window.alert("Couldn't delete " + confirmName + " — " + message);
          btn.disabled = false;
        });
      return;
    }

    if (action === "remove-payment") {
      var paymentId = btn.getAttribute("data-payment-id");
      btn.disabled = true;
      sb.from("dues_payments")
        .delete()
        .eq("id", paymentId)
        .then(function (res) {
          if (res.error) throw res.error;
          return loadDuesPayments().then(refreshMembersTable);
        })
        .catch(function (err) {
          var message = err && err.message ? err.message : String(err);
          console.error("[MATEX Supabase] dues_payments delete error:", message);
          window.alert("Couldn't remove that payment — " + message);
          btn.disabled = false;
        });
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

  document.getElementById("members-tbody").addEventListener("change", function (event) {
    var select = event.target.closest(".dues-type-select");
    if (!select) return;
    var row = select.closest("tr");
    var memberId = row.getAttribute("data-member-id");

    select.disabled = true;
    sb.from("members")
      .update({ membership_type: select.value || null })
      .eq("id", memberId)
      .then(function (res) {
        if (res.error) throw res.error;
        return loadMembers();
      })
      .catch(function (err) {
        var message = err && err.message ? err.message : String(err);
        console.error("[MATEX Supabase] membership_type update error:", message);
        window.alert("Couldn't update membership type — " + message);
        select.disabled = false;
      });
  });

  document.getElementById("members-tbody").addEventListener("submit", function (event) {
    var editForm = event.target.closest(".member-edit-form");
    if (editForm) {
      event.preventDefault();
      var editMemberId = editForm.closest("tr").getAttribute("data-member-id");
      var updates = {};
      editForm.querySelectorAll("[data-field]").forEach(function (input) {
        updates[input.getAttribute("data-field")] = input.value.trim() || null;
      });
      if (!updates.first_name || !updates.last_name) {
        window.alert("First and last name are required.");
        return;
      }

      var editSubmitBtn = editForm.querySelector("button[type='submit']");
      editSubmitBtn.disabled = true;
      editSubmitBtn.textContent = "Saving…";

      sb.from("members")
        .update(updates)
        .eq("id", editMemberId)
        .then(function (res) {
          if (res.error) throw res.error;
          editingMemberId = null;
          return loadMembers();
        })
        .catch(function (err) {
          var message = err && err.message ? err.message : String(err);
          console.error("[MATEX Supabase] member edit error:", message);
          window.alert("Couldn't save changes — " + message);
        })
        .finally(function () {
          editSubmitBtn.disabled = false;
          editSubmitBtn.textContent = "Save";
        });
      return;
    }

    var form = event.target.closest(".dues-add-form");
    if (!form) return;
    event.preventDefault();

    var memberId = form.closest("tr").getAttribute("data-member-id");
    var amount = parseFloat(form.amount.value);
    if (!amount || amount <= 0) return;
    var duesYear = parseInt(form.dues_year.value, 10) || DUES_YEAR;

    var submitBtn = form.querySelector("button[type='submit']");
    submitBtn.disabled = true;
    submitBtn.textContent = "Logging…";

    sb.from("dues_payments")
      .insert({
        member_id: memberId,
        dues_year: duesYear,
        amount: amount,
        payment_method: form.payment_method.value || null,
        payment_date: form.payment_date.value || new Date().toISOString().slice(0, 10),
        note: form.note.value.trim() || null,
        recorded_by: (currentUser && currentUser.email) || "admin"
      })
      .then(function (res) {
        if (res.error) throw res.error;
        return loadDuesPayments().then(refreshMembersTable);
      })
      .catch(function (err) {
        console.error("[MATEX Supabase] dues_payments insert error:", err && err.message ? err.message : err);
      })
      .finally(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = "Log Payment";
      });
  });

  document.getElementById("member-search").addEventListener("input", refreshMembersTable);

  // ---------------------------------------------------------------
  // Add member (manual entry, not via a join.html application)
  // ---------------------------------------------------------------
  var addMemberToggle = document.getElementById("add-member-toggle");
  var addMemberForm = document.getElementById("add-member-form");
  var addMemberCancel = document.getElementById("add-member-cancel");
  var addMemberMessage = document.getElementById("add-member-message");

  function openAddMemberForm() {
    addMemberForm.hidden = false;
    addMemberToggle.hidden = true;
    addMemberMessage.hidden = true;
    if (!addMemberForm.member_number.value) {
      addMemberForm.member_number.value = suggestNextMemberNumber();
    }
    if (!addMemberForm.joined_date.value) {
      addMemberForm.joined_date.value = new Date().toISOString().slice(0, 10);
    }
  }

  function closeAddMemberForm() {
    addMemberForm.hidden = true;
    addMemberToggle.hidden = false;
    addMemberForm.reset();
    addMemberMessage.hidden = true;
  }

  addMemberToggle.addEventListener("click", openAddMemberForm);
  addMemberCancel.addEventListener("click", closeAddMemberForm);

  addMemberForm.addEventListener("submit", function (event) {
    event.preventDefault();

    function val(name) {
      var v = addMemberForm[name].value.trim();
      return v || null;
    }

    if (!val("member_number") || !val("first_name") || !val("last_name")) {
      addMemberMessage.hidden = false;
      addMemberMessage.textContent = "Member number, first name, and last name are required.";
      return;
    }

    var submitBtn = addMemberForm.querySelector("button[type='submit']");
    submitBtn.disabled = true;
    submitBtn.textContent = "Adding…";
    addMemberMessage.hidden = true;

    sb.from("members")
      .insert({
        member_number: val("member_number"),
        first_name: val("first_name"),
        middle_name: val("middle_name"),
        last_name: val("last_name"),
        email: val("email"),
        phone: val("phone"),
        address_line1: val("address_line1"),
        address_line2: val("address_line2"),
        city: val("city"),
        state: val("state"),
        postal_code: val("postal_code"),
        status: val("status") || "active",
        joined_date: val("joined_date"),
        membership_type: val("membership_type")
      })
      .then(function (res) {
        if (res.error) {
          console.error("[MATEX Supabase] add member error:", res.error.message);
          addMemberMessage.hidden = false;
          addMemberMessage.textContent = "Couldn't add that member — " + res.error.message;
          return;
        }
        closeAddMemberForm();
        return loadMembers();
      })
      .catch(function (err) {
        console.error("[MATEX Supabase] add member threw:", err);
        addMemberMessage.hidden = false;
        addMemberMessage.textContent = "Something went wrong. Please try again.";
      })
      .finally(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = "Add Member";
      });
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
          '<tr data-application-id="' + escapeHtml(a.id) + '">' +
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

      // Single atomic call (see supabase/sql/008_approve_application_rpc.sql):
      // reads the application, inserts the member, and marks the
      // application approved all in one Postgres transaction, instead of
      // three separate network calls that could partially fail and leave
      // a member inserted but the application still "pending" — which
      // used to let a retry create a duplicate member row.
      sb.rpc("approve_membership_application", {
        p_application_id: applicationId,
        p_member_number: memberNumber
      })
        .then(function (res) {
          if (res.error) throw res.error;
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
          "<tr data-request-id=\"" + escapeHtml(r.id) + "\" data-member-id=\"" + (match ? escapeHtml(match.id) : "") + "\">" +
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
        window.location.href = "portal-login.html?redirect=admin.html";
        return;
      }
      currentUser = session.user;
      document.getElementById("admin-email").textContent = currentUser.email || "";

      return sb.from("admins").select("id, can_edit_all_fields, can_delete").eq("id", currentUser.id).maybeSingle();
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
      currentAdminCanEditAllFields = !!res.data.can_edit_all_fields;
      currentAdminCanDelete = !!res.data.can_delete;
      showState("admin");
      document.getElementById("dues-year-label").textContent = DUES_YEAR;
      // Dues payments must load before members, since the roster's Dues
      // column renders from allDuesPayments. loadRequests() matches
      // against allMembers, so it (and everything else) comes after.
      return loadDuesPayments()
        .then(loadMembers)
        .then(function () {
          return Promise.all([loadRequests(), loadApplications(), loadContactMessages()]);
        });
    })
    .catch(function (err) {
      console.error("[MATEX Supabase] admin boot threw:", err);
      showState("error");
    });
})();
