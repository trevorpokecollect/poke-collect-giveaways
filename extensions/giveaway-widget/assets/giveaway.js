/* Poke-Collect Giveaways storefront widget. No dependencies; talks to /apps/giveaways/<slug>. */
(function () {
  "use strict";

  var TOKEN_KEY = "pcg:token:";
  var DEVICE_KEY = "pcg:device";

  function store(k, v) {
    try {
      if (v === undefined) return window.localStorage.getItem(k);
      if (v === null) window.localStorage.removeItem(k);
      else window.localStorage.setItem(k, v);
    } catch (e) {
      return null;
    }
  }

  // A persistent random device id (also mirrored in a cookie) used only for duplicate detection.
  function deviceId() {
    var id = store(DEVICE_KEY);
    var m = document.cookie.match(/(?:^|; )pcg_device=([^;]+)/);
    if (!id && m) id = m[1];
    if (!id) {
      var bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      id = Array.prototype.map.call(bytes, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
    }
    store(DEVICE_KEY, id);
    document.cookie = "pcg_device=" + id + "; path=/; max-age=31536000; SameSite=Lax";
    return id;
  }

  function utm() {
    var p = new URLSearchParams(window.location.search);
    var out = {};
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach(function (k) {
      if (p.get(k)) out[k] = p.get(k);
    });
    if (document.referrer) out.referrer = document.referrer.slice(0, 200);
    return out;
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") node.textContent = attrs[k];
      else if (k.indexOf("on") === 0) node.addEventListener(k.slice(2), attrs[k]);
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function Widget(root) {
    this.root = root;
    this.slug = root.getAttribute("data-slug");
    this.base = root.getAttribute("data-proxy") + "/" + encodeURIComponent(this.slug);
    this.tokenKey = TOKEN_KEY + this.slug;
    this.ref = new URLSearchParams(window.location.search).get("ref") || "";
    this.renderedAt = Date.now();
  }

  Widget.prototype.request = function (method, body) {
    var headers = { "Content-Type": "application/json" };
    var token = store(this.tokenKey);
    if (token) headers["x-entrant-token"] = token;
    return fetch(this.base, {
      method: method,
      headers: headers,
      credentials: "same-origin",
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
        return data;
      });
    });
  };

  Widget.prototype.load = function () {
    var self = this;
    if (!this.slug) return this.message("Set the giveaway link name in the theme editor.");
    this.request("GET")
      .then(function (data) {
        self.data = data;
        if (data.entrant && data.entrant.state === "active") self.renderEntrant(data.entrant);
        else if (data.entrant && data.entrant.state === "held") self.renderHeld();
        else self.renderSignup();
      })
      .catch(function (err) { self.message(err.message); });
  };

  Widget.prototype.message = function (text) {
    this.root.replaceChildren(el("p", { class: "pcg__note", text: text }));
  };

  Widget.prototype.header = function () {
    var c = this.data.campaign;
    var nodes = [];
    if (c.imageUrl) nodes.push(el("img", { class: "pcg__image", src: c.imageUrl, alt: c.prize || c.title, loading: "lazy" }));
    nodes.push(el("div", { class: "pcg__hero" }, [
      el("span", { class: "pcg__badge", text: "Giveaway" }),
      el("h2", { class: "pcg__title", text: c.title }),
      c.prize ? el("p", { class: "pcg__prize", text: c.prize }) : null,
      c.endsAt ? this.countdown(new Date(c.endsAt)) : null,
    ]));
    if (c.description) nodes.push(el("p", { class: "pcg__meta", text: c.description }));
    return nodes;
  };

  // Days / hours / minutes / seconds until the giveaway ends, ticking once a second.
  Widget.prototype.countdown = function (endsAt) {
    var units = [["d", 86400], ["h", 3600], ["m", 60], ["s", 1]];
    var labels = { d: "Days", h: "Hours", m: "Mins", s: "Secs" };
    var cells = {};
    var box = el("div", { class: "pcg__timer", "aria-label": "Ends " + endsAt.toLocaleString() }, units.map(function (u) {
      cells[u[0]] = el("b", { text: "0" });
      return el("div", {}, [cells[u[0]], el("span", { text: labels[u[0]] })]);
    }));
    function tick() {
      var left = Math.max(0, Math.floor((endsAt.getTime() - Date.now()) / 1000));
      units.forEach(function (u) {
        var v = Math.floor(left / u[1]);
        left -= v * u[1];
        cells[u[0]].textContent = u[0] === "d" ? String(v) : ("0" + v).slice(-2);
      });
    }
    tick();
    window.clearInterval(this.timer);
    this.timer = window.setInterval(tick, 1000);
    return box;
  };

  Widget.prototype.footer = function () {
    var c = this.data.campaign;
    return c.rulesText ? el("details", { class: "pcg__rules" }, [el("summary", { text: "Official rules" }), el("p", { text: c.rulesText })]) : null;
  };

  Widget.prototype.renderSignup = function (error) {
    var self = this;
    var email = el("input", { class: "pcg__input", type: "email", name: "email", required: "", autocomplete: "email", placeholder: "Email address" });
    var name = el("input", { class: "pcg__input", type: "text", name: "name", autocomplete: "name", placeholder: "Name (optional)" });
    var honeypot = el("input", { type: "text", name: "website", tabindex: "-1", autocomplete: "off" });
    var consent = el("input", { type: "checkbox", name: "consent" });
    var turnstileBox = el("div");
    var err = el("p", { class: "pcg__error", role: "alert", text: error || "" });
    var button = el("button", { class: "pcg__btn", type: "submit", text: "Enter giveaway" });
    var turnstileToken = "";

    var form = el("form", {
      class: "pcg__form",
      novalidate: "",
      onsubmit: function (e) {
        e.preventDefault();
        if (!email.value) { err.textContent = "Please enter your email."; return; }
        button.disabled = true;
        self.email = email.value;
        self.request("POST", {
          intent: "signup",
          email: email.value,
          name: name.value,
          website: honeypot.value,
          consent: consent.checked,
          ref: self.ref,
          turnstileToken: turnstileToken,
          elapsedMs: Date.now() - self.renderedAt,
          deviceId: deviceId(),
          utm: utm(),
        })
          .then(function (res) { self.handleResult(res); })
          .catch(function (e2) {
            err.textContent = e2.message;
            button.disabled = false;
            if (window.turnstile && self.turnstileId !== undefined) window.turnstile.reset(self.turnstileId);
          });
      },
    }, [
      email,
      name,
      el("div", { class: "pcg__hp", "aria-hidden": "true" }, [el("label", { text: "Website" }), honeypot]),
      el("label", { class: "pcg__check" }, [consent, el("span", { text: "Send me news and drops by email." })]),
      turnstileBox,
      err,
      button,
    ]);

    this.root.replaceChildren.apply(this.root, this.header().concat([form, this.footer()]).filter(Boolean));

    var siteKey = this.data.turnstileSiteKey;
    if (siteKey) {
      var mount = function () {
        if (!window.turnstile) return window.setTimeout(mount, 200);
        self.turnstileId = window.turnstile.render(turnstileBox, {
          sitekey: siteKey,
          appearance: "interaction-only",
          callback: function (t) { turnstileToken = t; },
          "expired-callback": function () { turnstileToken = ""; },
        });
      };
      mount();
    }
  };

  Widget.prototype.handleResult = function (res) {
    if (res.token) store(this.tokenKey, res.token);
    if (res.state === "active") return this.load();
    if (res.state === "held") return this.renderHeld();
    this.renderVerify();
  };

  Widget.prototype.renderVerify = function (error) {
    var self = this;
    var code = el("input", { class: "pcg__input", inputmode: "numeric", autocomplete: "one-time-code", maxlength: "6", placeholder: "6-digit code" });
    var err = el("p", { class: "pcg__error", role: "alert", text: error || "" });
    var button = el("button", { class: "pcg__btn", type: "submit", text: "Confirm entry" });
    var form = el("form", {
      class: "pcg__form",
      onsubmit: function (e) {
        e.preventDefault();
        button.disabled = true;
        self.request("POST", { intent: "verify", email: self.email, code: code.value })
          .then(function (res) { self.handleResult(res); })
          .catch(function (e2) { err.textContent = e2.message; button.disabled = false; });
      },
    }, [
      el("p", { class: "pcg__note", text: "We sent a code to " + (self.email || "your email") + ". Enter it to confirm your entry." }),
      code,
      err,
      button,
      el("button", { class: "pcg__btn pcg__btn--ghost", type: "button", text: "Use a different email", onclick: function () { self.renderSignup(); } }),
    ]);
    this.root.replaceChildren.apply(this.root, this.header().concat([form]));
    code.focus();
  };

  Widget.prototype.renderHeld = function () {
    this.root.replaceChildren.apply(this.root, this.header().concat([
      el("p", { class: "pcg__note", text: "Thanks! Your entry is being reviewed and will count once it's approved." }),
    ]));
  };

  Widget.prototype.renderEntrant = function (entrant) {
    var self = this;
    var done = {};
    (entrant.completedActionIds || []).forEach(function (id) { done[id] = true; });

    var list = el("ul", { class: "pcg__actions" });
    this.data.campaign.actions.forEach(function (a) {
      if (a.type === "REFERRAL" || a.type === "ALTERNATE_ENTRY") return;
      var isDone = done[a.id] && a.type !== "DAILY_CHECKIN";
      var pill = el("span", { class: "pcg__pill", text: "+" + a.entries });
      var input = a.type === "SECRET_CODE" && !isDone ? el("input", { class: "pcg__input", placeholder: "Code" }) : null;
      var btn = isDone ? null : el("button", {
        class: "pcg__btn",
        type: "button",
        text: a.type === "DAILY_CHECKIN" ? "Check in" : a.url ? "Go" : "Submit",
        onclick: function () {
          if (a.url) window.open(a.url, "_blank", "noopener");
          btn.disabled = true;
          self.request("POST", { intent: "action", actionId: a.id, code: input ? input.value : undefined })
            .then(function () { self.load(); })
            .catch(function (e2) { btn.disabled = false; window.alert(e2.message); });
        },
      });
      if (btn) btn.className = "pcg__btn pcg__btn--small";
      list.appendChild(el("li", { class: "pcg__action" + (isDone ? " pcg__action--done" : "") }, [
        el("span", { class: "pcg__action-label", text: a.label }), input, pill, btn,
      ]));
    });

    var nodes = this.header().concat([
      el("div", { class: "pcg__count" }, [
        el("span", { text: entrant.entries === 1 ? "Your entry" : "Your entries" }),
        el("b", { text: String(entrant.entries) }),
      ]),
    ]);
    if (list.children.length) nodes.push(el("h3", { class: "pcg__subheading", text: "Earn more entries" }), list);

    var referral = this.data.campaign.actions.filter(function (a) { return a.type === "REFERRAL"; })[0];
    if (referral && entrant.referralCode) {
      var link = window.location.origin + window.location.pathname + "?ref=" + encodeURIComponent(entrant.referralCode);
      var input = el("input", { class: "pcg__input", readonly: "", value: link });
      nodes.push(el("div", { class: "pcg__ref" }, [
        el("p", { class: "pcg__note", text: "Get +" + referral.entries + " entries for every friend who enters with your link." }),
        el("div", { class: "pcg__ref-row" }, [input, el("button", {
          class: "pcg__btn pcg__btn--small", type: "button", text: "Copy",
          onclick: function (e) {
            var b = e.currentTarget;
            (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(
              function () { b.textContent = "Copied"; },
              function () { input.select(); }
            );
          },
        })]),
      ]));
    }
    nodes.push(this.footer());
    this.root.replaceChildren.apply(this.root, nodes.filter(Boolean));
  };

  function boot() {
    document.querySelectorAll("[data-pcg]").forEach(function (root) {
      if (root.__pcg) return;
      root.__pcg = new Widget(root);
      root.__pcg.load();
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  // Re-run when the block is added in the theme editor.
  document.addEventListener("shopify:section:load", boot);
})();
