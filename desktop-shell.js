(() => {
  "use strict";
  const desktop = window.matchMedia("(min-width: 1024px)");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const $ = selector => document.querySelector(selector);
  let pendingGo = false;
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

  function contextRail() {
    return $("#desktopContext");
  }

  function clearProfileContext() {
    const panel = $("#desktopProfileContext");
    if (!panel) return;
    panel.hidden = true;
    panel.innerHTML = "";
  }

  function setProfileContext(content) {
    if (!enabled()) return;
    const panel = $("#desktopProfileContext");
    if (!panel || !content) return;
    panel.hidden = false;
    panel.innerHTML = `<header class="desktop-context-card-head"><span>用户资料</span><button type="button" data-desktop-context-close aria-label="收起用户资料">×</button></header>${content}`;
  }

  function buildContextRail() {
    if (contextRail()) return;
    const rail = document.createElement("aside");
    rail.id = "desktopContext";
    rail.className = "desktop-context";
    rail.setAttribute("aria-label", "桌面端快捷信息栏");
    rail.innerHTML = `
      <button type="button" class="desktop-context-search" data-desktop-search><span>⌕</span><span>搜索博客、用户和 UID</span></button>
      <section id="desktopProfileContext" class="desktop-context-card desktop-context-profile" hidden></section>
      <section class="desktop-context-card desktop-context-trends">
        <h2>快捷入口</h2>
        <button type="button" data-page="forum"><small>社区</small><strong>看看大家正在讨论什么</strong><span>›</span></button>
        <button type="button" data-desktop-compose><small>发布</small><strong>写下你的新想法</strong><span>›</span></button>
        <button type="button" data-page="profile"><small>个人</small><strong>管理资料与账号</strong><span>›</span></button>
      </section>
      <section class="desktop-context-card desktop-context-tips">
        <h2>使用技巧</h2>
        <p><kbd>/</kbd> 搜索　<kbd>N</kbd> 发布话题</p>
        <p><kbd>G</kbd> + <kbd>H / C / N / M / P</kbd> 快速导航</p>
      </section>`;
    document.body.append(rail);
    rail.addEventListener("click", event => {
      if (event.target.closest("[data-desktop-search]")) openSearch();
      if (event.target.closest("[data-desktop-compose]")) openComposer();
      if (event.target.closest("[data-desktop-context-close]")) clearProfileContext();
    });
  }

  function syncContext(detail = {}) {
    const page = detail.page || window.blogUI?.state?.page || "home";
    document.body.dataset.desktopPage = page;
  }

  function onKeydown(event) {
    if (!enabled() || editable(event.target) || event.altKey || document.querySelector("dialog[open]")) return;
    if (pendingGo && Date.now() - lastKeyAt < 900) {
      const key = event.key.toLowerCase();
      const pages = { h: "home", c: "forum", n: "notifications", m: "messages", p: "profile", a: "about" };
      pendingGo = false;
      if (pages[key]) {
        event.preventDefault();
        navigate(pages[key]);
      }
      return;
    }
    pendingGo = false;
    if (event.key === "/") { event.preventDefault(); openSearch(); return; }
    if (event.key.toLowerCase() === "n" && !event.ctrlKey && !event.metaKey) { event.preventDefault(); openComposer(); return; }
    if (event.key.toLowerCase() === "g") { pendingGo = true; lastKeyAt = Date.now(); return; }
  }

  function init() {
    buildContextRail();
    syncContext();
    window.addEventListener("blog-page-change", event => {
      animatePageChange();
      syncContext(event.detail);
    });
    document.addEventListener("keydown", onKeydown);
    desktop.addEventListener?.("change", () => { pendingGo = false; syncContext(); });
  }

  window.blogDesktop = { openSearch, openComposer, navigate, setProfileContext, clearProfileContext };
  document.addEventListener("DOMContentLoaded", init, { once: true });
})();
