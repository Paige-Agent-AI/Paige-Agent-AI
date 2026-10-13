/**
 * Paige embed loader — public/embed.js (booking calendars and lead forms)
 *
 * A tenant drops one tag onto their site and Paige handles the rest:
 *
 *   <script src="https://app.paigeagent.ai/embed.js" data-slug="discovery-call" async></script>
 *   <script src="https://app.paigeagent.ai/embed.js" data-form="<form id>" async></script>
 *
 * A form (Experience 03) frames the published form at /form/<id>?embed=1. Answers go through Paige's
 * own intake from Paige's own origin, so the host page never handles them. The host page's campaign
 * tags (utm_*, gclid, fbclid) ride along on the frame's address, so a visit from a tagged link is
 * credited to its campaign exactly as on the hosted form.
 *
 * Inline mode (default): injects the booking iframe where the tag sits and
 * auto-sizes its height to the content — no inner scrollbar, responsive width.
 * Popup mode (data-mode="popup"): renders a button that opens the booking page
 * in a centered modal overlay.
 *
 * Self-contained: no external dependencies, no globals leaked. The height
 * listener validates every message (source + shape + origin) and ignores
 * anything that isn't our height event.
 *
 * Attributes:
 *   data-slug   the calendar's public slug          (one of data-slug / data-form)
 *   data-form   the published form's id
 *   data-title  the frame's accessible name        (default "Book a time" / "Form")
 *   data-theme  a form's look: light | dark | auto (default "light"; auto follows the visitor)
 *   data-mode   inline | popup            (default "inline")
 *   data-button the popup button label    (default "Book a time")
 *   data-height starting height in px      (default 720, before auto-size)
 *   data-target CSS selector to mount into (inline; default: in place)
 */
(function () {
  "use strict";

  // Each widget accepts only its own page's height message.
  var BOOKING_HEIGHT_EVENT = "paige-booking-height";
  var FORM_HEIGHT_EVENT = "paige-form-height";
  // A form whose success action is "go to this page" asks the loader to move the visitor's whole page.
  var FORM_REDIRECT_EVENT = "paige-form-redirect";
  // The campaign tags a visit carries (the same keys the hosted form reads, src/lib/growth.ts readUtm).
  // Not "ref": inside the frame Paige reads ?ref= as its own referral code, so a host page's ref would be
  // mistaken for one.
  var TAG_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "fbclid"];
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // The tag currently executing. Captured synchronously so each copy of the
  // tag on a page manages its own widget (document.currentScript is null once
  // async work resumes, so we grab it now).
  var script =
    document.currentScript ||
    (function () {
      var all = document.getElementsByTagName("script");
      return all[all.length - 1];
    })();
  if (!script) return;

  var slug = (script.getAttribute("data-slug") || "").trim();
  var formId = (script.getAttribute("data-form") || "").trim();
  var isForm = !slug && !!formId;
  if (!slug && !formId) {
    // Fail loud in the console, quiet on the page — never render a broken frame.
    if (window.console) console.error("[Paige embed] Missing data-slug or data-form on the embed script tag.");
    return;
  }
  if (isForm && !UUID_RE.test(formId)) {
    if (window.console) console.error("[Paige embed] data-form is not a form id. Copy the embed code from Paige again.");
    return;
  }
  var HEIGHT_EVENT = isForm ? FORM_HEIGHT_EVENT : BOOKING_HEIGHT_EVENT;
  var frameTitle = script.getAttribute("data-title") || (isForm ? "Form" : "Book a time");
  var formTheme = (script.getAttribute("data-theme") || "light").toLowerCase();
  if (formTheme !== "dark" && formTheme !== "auto") formTheme = "light";

  var mode = (script.getAttribute("data-mode") || "inline").toLowerCase();
  var startHeight = parseInt(script.getAttribute("data-height") || "", 10);
  if (!isFinite(startHeight) || startHeight <= 0) startHeight = 720;
  var buttonLabel = script.getAttribute("data-button") || (isForm ? "Open the form" : "Book a time");
  var targetSel = script.getAttribute("data-target") || "";

  // The booking app's origin is wherever this script was served from — the src
  // is absolute on the tenant's page. We only accept height messages coming
  // from that exact origin.
  var appOrigin;
  var bookingUrl;
  try {
    var u = new URL(script.src, window.location.href);
    appOrigin = u.origin;
    if (isForm) {
      var tags = new URLSearchParams();
      tags.set("embed", "1");
      if (formTheme !== "light") tags.set("theme", formTheme);
      var here = new URLSearchParams(window.location.search);
      for (var i = 0; i < TAG_KEYS.length; i++) {
        var v = here.get(TAG_KEYS[i]);
        if (v) tags.set(TAG_KEYS[i], v.slice(0, 200));
      }
      bookingUrl = appOrigin + "/form/" + encodeURIComponent(formId) + "?" + tags.toString();
    } else {
      bookingUrl = appOrigin + "/book/" + encodeURIComponent(slug);
    }
  } catch (e) {
    if (window.console) console.error("[Paige embed] Could not resolve the embed source URL.", e);
    return;
  }

  // --- build the iframe -----------------------------------------------------
  function makeIframe(initialHeight) {
    var iframe = document.createElement("iframe");
    iframe.src = bookingUrl;
    iframe.title = frameTitle;
    iframe.loading = "lazy";
    // camelCase is ignored by some browsers for iframe; set both attr + prop.
    iframe.setAttribute("allow", "clipboard-write; web-share");
    iframe.style.width = "100%";
    iframe.style.border = "0";
    iframe.style.display = "block";
    iframe.style.height = initialHeight + "px";
    iframe.style.transition = "height 120ms ease";
    // The frame's colour scheme matches the page inside it, or the browser paints an opaque box behind a
    // transparent page. A booking page and a light form are "normal"; a dark form is dark; auto follows the visitor.
    iframe.style.colorScheme = !isForm || formTheme === "light" ? "normal" : formTheme === "dark" ? "dark" : "light dark";
    return iframe;
  }

  // Only trust a height message that (a) comes from our booking origin,
  // (b) originates from THIS iframe's window, and (c) has the exact shape.
  function heightListener(iframe, opts) {
    return function (event) {
      if (event.origin !== appOrigin) return;
      if (iframe.contentWindow && event.source !== iframe.contentWindow) return;
      var data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type !== HEIGHT_EVENT) return;
      var h = data.height;
      if (typeof h !== "number" || !isFinite(h) || h <= 0) return;
      // Clamp to something sane so a bad value can't blow out the page.
      h = Math.min(Math.max(Math.round(h), 120), 20000);
      if (opts && opts.maxHeight) h = Math.min(h, opts.maxHeight);
      iframe.style.height = h + "px";
    };
  }

  // Only from our origin, only from THIS frame, only an http(s) address: never script, never another frame.
  function redirectListener(iframe) {
    return function (event) {
      if (event.origin !== appOrigin) return;
      if (iframe.contentWindow && event.source !== iframe.contentWindow) return;
      var data = event.data;
      if (!data || typeof data !== "object" || data.type !== FORM_REDIRECT_EVENT || typeof data.url !== "string") return;
      var next;
      try { next = new URL(data.url, window.location.href); } catch (e) { return; }
      if (next.protocol !== "https:" && next.protocol !== "http:") return;
      window.location.assign(next.href);
    };
  }

  // --- inline mode ----------------------------------------------------------
  function mountInline() {
    var iframe = makeIframe(startHeight);
    window.addEventListener("message", heightListener(iframe, null));
    if (isForm) window.addEventListener("message", redirectListener(iframe));

    var mount = null;
    if (targetSel) {
      try { mount = document.querySelector(targetSel); } catch (e) { mount = null; }
    }
    if (mount) {
      mount.appendChild(iframe);
    } else if (script.parentNode) {
      // Drop the frame exactly where the tag sits.
      script.parentNode.insertBefore(iframe, script);
    } else {
      document.body.appendChild(iframe);
    }
  }

  // --- popup mode -----------------------------------------------------------
  function mountPopup() {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = buttonLabel;
    btn.setAttribute("aria-haspopup", "dialog");
    btn.style.cssText =
      "display:inline-flex;align-items:center;justify-content:center;gap:.5rem;" +
      "padding:.65rem 1.15rem;border-radius:.65rem;border:0;cursor:pointer;" +
      "font:600 15px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;" +
      "background:#1B1230;color:#fff;";

    var overlay, frameWrap, iframe, removeListener;

    function close() {
      if (!overlay) return;
      document.removeEventListener("keydown", onKey, true);
      if (removeListener) removeListener();
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      overlay = null;
      btn.focus();
    }

    function onKey(e) {
      if (e.key === "Escape") { e.stopPropagation(); close(); }
    }

    function open() {
      if (overlay) return;
      overlay = document.createElement("div");
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-label", frameTitle);
      overlay.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;display:flex;" +
        "align-items:center;justify-content:center;padding:24px;" +
        "background:rgba(16,18,26,.55);";
      overlay.addEventListener("click", function (e) {
        if (e.target === overlay) close();
      });

      frameWrap = document.createElement("div");
      frameWrap.style.cssText =
        "position:relative;width:100%;max-width:900px;max-height:90vh;overflow:auto;" +
        "border-radius:16px;background:transparent;box-shadow:0 24px 60px rgba(0,0,0,.4);" +
        "-webkit-overflow-scrolling:touch;";

      var closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.setAttribute("aria-label", "Close");
      closeBtn.innerHTML = "&times;";
      closeBtn.style.cssText =
        "position:absolute;top:8px;right:12px;z-index:1;width:32px;height:32px;" +
        "border:0;border-radius:999px;cursor:pointer;font:400 22px/1 system-ui;" +
        "background:rgba(0,0,0,.45);color:#fff;";
      closeBtn.addEventListener("click", close);

      iframe = makeIframe(Math.min(startHeight, Math.round(window.innerHeight * 0.9)));
      iframe.style.borderRadius = "16px";
      var listener = heightListener(iframe, { maxHeight: Math.round(window.innerHeight * 0.9) });
      var onRedirect = isForm ? redirectListener(iframe) : null;
      window.addEventListener("message", listener);
      if (onRedirect) window.addEventListener("message", onRedirect);
      removeListener = function () { window.removeEventListener("message", listener); if (onRedirect) window.removeEventListener("message", onRedirect); };

      frameWrap.appendChild(closeBtn);
      frameWrap.appendChild(iframe);
      overlay.appendChild(frameWrap);
      document.body.appendChild(overlay);
      document.addEventListener("keydown", onKey, true);
      closeBtn.focus();
    }

    btn.addEventListener("click", open);
    if (script.parentNode) script.parentNode.insertBefore(btn, script);
    else document.body.appendChild(btn);
  }

  function boot() {
    if (mode === "popup") mountPopup();
    else mountInline();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
