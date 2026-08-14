/* MATEX Dallas — shared behavior (mobile nav toggle, footer year) */
(function () {
  "use strict";

  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("main-nav");

  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!open));
      nav.classList.toggle("open", !open);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
        toggle.setAttribute("aria-expanded", "false");
        nav.classList.remove("open");
        toggle.focus();
      }
    });

    // Close the mobile menu if the viewport grows back past the breakpoint.
    window.addEventListener("resize", function () {
      if (window.innerWidth > 860 && nav.classList.contains("open")) {
        toggle.setAttribute("aria-expanded", "false");
        nav.classList.remove("open");
      }
    });
  }

  var yearEl = document.querySelector("[data-current-year]");
  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }

  // ---------- Scroll-triggered reveal ----------
  // Progressive enhancement: elements only go opacity:0 once we're also
  // certain we can bring them back via IntersectionObserver, so a no-JS
  // visitor (or a browser without IntersectionObserver) sees everything
  // in place from the start.
  if ("IntersectionObserver" in window) {
    var revealSelector = [
      ".section-head", ".icon-card", ".stat-tile", ".card", ".tier-card",
      ".step", ".payment-card", ".about-preview", ".leader-spotlight",
      ".leader-card", ".gallery-masonry a", ".cta-band", ".founded-badge",
      ".event-feature", ".value-chip", ".notice-box", ".impact-video",
      ".filter-gallery .thumb", ".contact-grid > div", ".info-list li"
    ].join(", ");

    var revealItems = document.querySelectorAll(revealSelector);
    var staggerCounts = new Map();

    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });

    revealItems.forEach(function (el) {
      // Stagger siblings within the same grid/list (capped so a long
      // gallery doesn't queue up an ever-growing delay).
      var parent = el.parentElement;
      var count = staggerCounts.get(parent) || 0;
      staggerCounts.set(parent, count + 1);
      el.style.setProperty("--reveal-delay", (Math.min(count, 6) * 0.07) + "s");
      el.classList.add("reveal");
      revealObserver.observe(el);
    });
  }

  // ---------- Header shadow + back-to-top ----------
  var header = document.querySelector(".site-header");

  var backToTop = document.createElement("button");
  backToTop.type = "button";
  backToTop.className = "back-to-top";
  backToTop.setAttribute("aria-label", "Back to top");
  backToTop.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  document.body.appendChild(backToTop);
  backToTop.addEventListener("click", function () {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  var onScroll = function () {
    var scrolled = window.scrollY > 8;
    if (header) header.classList.toggle("is-scrolled", scrolled);
    backToTop.classList.toggle("is-visible", window.scrollY > 480);
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
})();
