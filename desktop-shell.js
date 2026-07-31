(() => {
  "use strict";
  const desktop = window.matchMedia("(min-width: 1024px)");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const $ = selector => document.querySelector(selector);
  let pendingGo = false;
  let lastKey = "";
  let lastKeyAt = 0;

  function enabled() { return desktop.matches; }
  function editable(target) { return target?.matches?.("input, textarea, select, [contenteditable=true]"); }

  function animatePageChange() {
    if (!enabled() || reduceMotion.matches) return;
    const app = $("#app");
    if (!app) return;
    app.classList.remove("desktop-page-enter");
    requestAnimationFrame(() => app.classList.add("desktop-page-enter"));
  }

  function openSearch() {
    window.blogUI?.openDialog?.($("#searchDialog"));
    const input = $("#searchInput");
    if (input) { input.value = ""; window.search?.(""); setTimeout(() => input.focus(), 0); }
  }

  function openComposer() {
    if (!window.blogAuth?.user) return window.blogAuth?.openAuth?.("login");
    window.blogUI?.navigate("forum");
    setTimeout(() => $("#newThreadBtn")?.click(), 80);
  }

  function navigate(page) {
    window.blogUI?.navigate(page);
  }

  function onKeydown(event) {
    if (!enabled() || editable(event.target) || event.altKey || document.querySelector("dialog[open]")) return;
    if (event.key === "/") { event.preventDefault(); openSearch(); return; }
    if (event.key.toLowerCase() === "n" && !event.ctrlKey && !event.metaKey) { event.preventDefault(); openComposer(); return; }
    if (event.key.toLowerCase() === "g") { pendingGo = true; lastKeyAt = Date.now(); return; }
    if (pendingGo && Date.now() - lastKeyAt < 900) {
      const key = event.key.toLowerCase();
      if (key === "h") navigate("home");
      if (key === "c") navigate("forum");
      if (key === "a") navigate("about");
      pendingGo = false;
      return;
    }
    lastKey = event.key;
  }

  function init() {
    window.addEventListener("blog-page-change", animatePageChange);
    document.addEventListener("keydown", onKeydown);
    desktop.addEventListener?.("change", () => { pendingGo = false; });
  }

  window.blogDesktop = { openSearch, openComposer, navigate };
  document.addEventListener("DOMContentLoaded", init, { once: true });
})();
