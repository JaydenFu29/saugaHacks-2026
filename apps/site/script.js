/* =========================================================================
   AidLive — presentation site interactions
   Vanilla JS, no dependencies. Mirrors the reference site's motion:
   scroll reveals, a pinned media column, count-up stats, and a nav that
   inverts over the hero.
   ========================================================================= */
(function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── Stagger delays: data-delay="2" → 2 × 110ms ──────────────────────── */
  document.querySelectorAll("[data-anim], .hero__title .line").forEach(function (el) {
    var d = el.getAttribute("data-delay");
    if (d) el.style.setProperty("--d", d);
  });

  /* ── Scroll reveals ──────────────────────────────────────────────────── */
  var revealTargets = document.querySelectorAll("[data-anim]");

  if (reduced || !("IntersectionObserver" in window)) {
    revealTargets.forEach(function (el) { el.classList.add("is-in"); });
  } else {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        revealObserver.unobserve(entry.target);
      });
    }, { threshold: 0.15, rootMargin: "0px 0px -8% 0px" });

    revealTargets.forEach(function (el) { revealObserver.observe(el); });
  }

  /* ── Hero lines animate on load (they're above the fold) ─────────────── */
  var heroLines = document.querySelectorAll(".hero__title .line");
  requestAnimationFrame(function () {
    heroLines.forEach(function (line) { line.classList.add("is-in"); });
  });

  /* ── Nav: invert colour + fade in the blur veil once past the hero ───── */
  var nav = document.getElementById("nav");
  var topBlur = document.querySelector(".top-blur");
  var hero = document.querySelector(".hero");

  function syncNav() {
    var threshold = hero ? hero.offsetHeight - 90 : 400;
    var scrolled = window.scrollY > threshold;
    nav.classList.toggle("is-scrolled", scrolled);
    if (topBlur) topBlur.classList.toggle("is-on", window.scrollY > 24);
  }
  syncNav();
  window.addEventListener("scroll", syncNav, { passive: true });
  window.addEventListener("resize", syncNav);

  /* ── Count-up stats (the reference animates these from 0) ────────────── */
  var stats = document.querySelectorAll("[data-count]");

  function countUp(el) {
    var target = parseInt(el.getAttribute("data-count"), 10) || 0;
    var suffix = el.getAttribute("data-suffix") || "";

    if (reduced) {
      el.textContent = target + suffix;
      return;
    }

    var duration = 1500;
    var start = null;

    function frame(now) {
      if (start === null) start = now;
      var p = Math.min((now - start) / duration, 1);
      var eased = 1 - Math.pow(1 - p, 3);           // easeOutCubic
      el.textContent = Math.round(target * eased) + suffix;
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  if (!("IntersectionObserver" in window)) {
    stats.forEach(countUp);
  } else {
    var statObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        countUp(entry.target);
        statObserver.unobserve(entry.target);
      });
    }, { threshold: 0.6 });

    stats.forEach(function (el) { statObserver.observe(el); });
  }

  /* ── How It Works: highlight the active step, swap the pinned image ──── */
  var steps = document.querySelectorAll(".step");
  var stepImages = document.querySelectorAll(".how__img");

  function activateStep(n) {
    steps.forEach(function (s) {
      s.classList.toggle("is-active", s.getAttribute("data-step") === n);
    });
    stepImages.forEach(function (img) {
      img.classList.toggle("is-active", img.getAttribute("data-step") === n);
    });
  }

  if (steps.length && "IntersectionObserver" in window) {
    var stepObserver = new IntersectionObserver(function (entries) {
      // Pick whichever tracked step is currently most visible.
      var best = null;
      entries.forEach(function (entry) {
        if (entry.isIntersecting && (!best || entry.intersectionRatio > best.intersectionRatio)) {
          best = entry;
        }
      });
      if (best) activateStep(best.target.getAttribute("data-step"));
    }, { threshold: [0.25, 0.5, 0.75], rootMargin: "-20% 0px -35% 0px" });

    steps.forEach(function (s) { stepObserver.observe(s); });
  } else {
    activateStep("1");
  }

  /* ── Nav link underline follows the section in view ──────────────────── */
  var navLinks = document.querySelectorAll(".nav__link");
  var sectionIds = ["top", "how-it-works", "contact"];
  var watched = sectionIds
    .map(function (id) { return document.getElementById(id); })
    .filter(Boolean);

  if (watched.length && "IntersectionObserver" in window) {
    var sectionObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var id = entry.target.id;
        navLinks.forEach(function (link) {
          link.classList.toggle("is-current", link.getAttribute("href") === "#" + id);
        });
      });
    }, { rootMargin: "-45% 0px -50% 0px" });

    watched.forEach(function (el) { sectionObserver.observe(el); });
  }

  /* ── Mobile menu ─────────────────────────────────────────────────────── */
  var toggle = document.querySelector(".nav__toggle");
  var mobileMenu = document.getElementById("nav-mobile");

  if (toggle && mobileMenu) {
    function setMenu(open) {
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      mobileMenu.hidden = !open;
    }
    setMenu(false);

    toggle.addEventListener("click", function () {
      setMenu(toggle.getAttribute("aria-expanded") !== "true");
    });

    mobileMenu.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () { setMenu(false); });
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
        setMenu(false);
        toggle.focus();
      }
    });
  }

  /* ── Contact form — front-end only, no backend yet ───────────────────── */
  var form = document.querySelector(".form");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var status = form.querySelector(".form__status");
      var valid = form.checkValidity();
      if (!status) return;
      status.textContent = valid
        ? "Thanks — this form is a placeholder and isn't sending yet."
        : "Please fill in every field before sending.";
      status.style.color = valid ? "var(--teal-deep)" : "var(--red)";
    });
  }
})();
