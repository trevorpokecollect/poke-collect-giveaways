/* Daily giveaway popup: floating launcher + dialog around the giveaway widget (giveaway.js). */
(function () {
  "use strict";

  function store(k, v) {
    try {
      if (v === undefined) return window.localStorage.getItem(k);
      window.localStorage.setItem(k, v);
    } catch (e) {
      return null;
    }
  }

  var PV_KEY = "pcg:pop:views";
  function isPhone() { return window.matchMedia("(max-width: 749px)").matches; }

  function left(drawAt) {
    var s = Math.max(0, Math.floor((new Date(drawAt).getTime() - Date.now()) / 1000));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    return h > 0 ? h + "h " + m + "m" : m > 0 ? m + "m" : "under a minute";
  }

  function setup(pop) {
    if (pop.__pcgPop) return;
    pop.__pcgPop = true;
    var launcher = pop.querySelector(".pcg-pop__launcher");
    var tab = pop.querySelector(".pcg-pop__tab");
    var thumb = pop.querySelector(".pcg-pop__thumb");
    var sub = pop.querySelector("[data-pcg-pop-sub]");
    var dialog = pop.querySelector(".pcg-pop__dialog");
    var widget = pop.querySelector("[data-pcg]");
    var slug = (widget.getAttribute("data-slug") || "").trim();
    var data = null;
    var timer = null;
    var autoTimer = null;
    var seenKey = function () {
      return "pcg:pop:" + slug + ":" + (data && data.daily ? data.daily.drawAt : new Date().toDateString());
    };

    function open() {
      window.clearTimeout(autoTimer);
      if (dialog.open) return;
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      store(seenKey(), "1");
    }
    function close() {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }

    function updateSub() {
      var d = data && data.daily;
      var entries = d && d.yourEntries;
      if (d) {
        sub.textContent = entries ? "You're in · drawn in " + left(d.drawAt) : "Drawn in " + left(d.drawAt);
      }
    }

    function onLoaded(d) {
      data = d || {};
      var p = data.daily && data.daily.prize;
      if (p && p.imageUrl) {
        thumb.src = p.imageUrl;
        thumb.hidden = false;
      }
      launcher.hidden = false;
      if (tab) tab.hidden = false;
      updateSub();
      window.clearInterval(timer);
      timer = window.setInterval(updateSub, 30000);

      var designMode = window.Shopify && window.Shopify.designMode;
      var enteredToday = data.daily ? data.daily.yourEntries > 0 : !!data.entrant;
      pop.classList.toggle("pcg-pop--entered", enteredToday);
      if (pop.getAttribute("data-auto") === "true" && !designMode && !enteredToday && !store(seenKey()) && !autoTimer) {
        var delay = Number(pop.getAttribute("data-delay") || 6) * 1000;
        if (!isPhone() || pageViews >= 2) autoTimer = window.setTimeout(open, delay);
        else whenScrolledHalfway(function () { if (!store(seenKey())) autoTimer = window.setTimeout(open, 800); });
      }
    }

    // Phones: wait for real interest (a second page view this visit, or reading half a page) before
    // opening by itself, since the screen is already shared with other widgets.
    var pageViews = 1;
    try {
      pageViews = Number(window.sessionStorage.getItem(PV_KEY) || 0) + 1;
      window.sessionStorage.setItem(PV_KEY, String(pageViews));
    } catch (e) { /* storage blocked: treat as a first view */ }
    function whenScrolledHalfway(fn) {
      var onScroll = function () {
        var max = document.documentElement.scrollHeight - window.innerHeight;
        if (max > 0 && window.scrollY / max < 0.5) return;
        window.removeEventListener("scroll", onScroll);
        fn();
      };
      window.addEventListener("scroll", onScroll, { passive: true });
    }

    // Any link to #daily-giveaway (announcement bar, menu, header icon) opens the popup.
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest('a[href$="#daily-giveaway"]');
      if (!a) return;
      e.preventDefault();
      open();
    });
    if (window.location.hash === "#daily-giveaway") window.setTimeout(open, 300);
    widget.addEventListener("pcg:loaded", function (e) { onLoaded(e.detail); });
    // The widget may have loaded before this script ran.
    if (widget.__pcg && widget.__pcg.data && widget.__pcg.data.campaign) onLoaded(widget.__pcg.data);

    launcher.addEventListener("click", open);
    if (tab) tab.addEventListener("click", open);
    pop.querySelector(".pcg-pop__close").addEventListener("click", close);
    // A click on the backdrop (outside the dialog box) closes it.
    dialog.addEventListener("click", function (e) {
      if (e.target === dialog) close();
    });
  }

  function boot() {
    document.querySelectorAll("[data-pcg-pop]").forEach(setup);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  document.addEventListener("shopify:section:load", boot);
})();
