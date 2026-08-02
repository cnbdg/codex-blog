(() => {
  "use strict";
  const desktop = window.matchMedia("(min-width: 1024px)");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const $ = selector => document.querySelector(selector);
  let pendingGo = false;
  let lastKeyAt = 0;
  let sidebarFrame = 0;
  const state = { sidebarMoves: 0, selectionReady: false };

  function enabled() { return desktop.matches; }
  function editable(target) { return target?.matches?.("input, textarea, select, [contenteditable=true]"); }

  function ensureSidebarSelection() {
    const nav = $(".topbar nav");
    if (!nav) return null;
    let indicator = nav.querySelector(".macos-sidebar-selection");
    if (!indicator) {
      indicator = document.createElement("i");
      indicator.className = "macos-sidebar-selection";
      indicator.setAttribute("aria-hidden", "true");
      nav.append(indicator);
    }
    return indicator;
  }

  function syncSidebarSelection({ instant = false } = {}) {
    cancelAnimationFrame(sidebarFrame);
    const nav = $(".topbar nav");
    const indicator = ensureSidebarSelection();
    if (!nav || !indicator || !enabled()) {
      nav?.classList.remove("macos-selection-ready");
      state.selectionReady = false;
      return;
    }
    const active = nav.querySelector("a.active");
    if (!active) {
      nav.classList.remove("macos-selection-ready");
      state.selectionReady = false;
      return;
    }
    const navRect = nav.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const x = Math.round(activeRect.left - navRect.left + nav.scrollLeft);
    const y = Math.round(activeRect.top - navRect.top + nav.scrollTop);
    const previousY = Number.parseFloat(indicator.dataset.y || String(y));
    if (instant || reduceMotion.matches) indicator.style.transition = "none";
    nav.style.setProperty("--mac-sidebar-x", `${x}px`);
    nav.style.setProperty("--mac-sidebar-y", `${y}px`);
    nav.style.setProperty("--mac-sidebar-width", `${Math.round(activeRect.width)}px`);
    nav.style.setProperty("--mac-sidebar-height", `${Math.round(activeRect.height)}px`);
    indicator.dataset.y = String(y);
    nav.classList.add("macos-selection-ready");
    if (state.selectionReady && Math.abs(previousY - y) > 1) state.sidebarMoves += 1;
    state.selectionReady = true;
    if (indicator.style.transition === "none") sidebarFrame = requestAnimationFrame(() => indicator.style.removeProperty("transition"));
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
      <button type="button" class="desktop-context-search" data-desktop-search><svg class="ui-icon" aria-hidden="true"><use href="#icon-search"/></svg><span>搜索博客、用户和 UID</span><kbd>Ctrl K</kbd></button>
      <section id="desktopProfileContext" class="desktop-context-card desktop-context-profile" hidden></section>
      <section class="desktop-context-card desktop-context-trends">
        <h2>快捷入口</h2>
        <button type="button" data-page="forum"><svg class="ui-icon" aria-hidden="true"><use href="#icon-community"/></svg><small>社区</small><strong>看看大家正在讨论什么</strong><span>›</span></button>
        <button type="button" data-desktop-compose><svg class="ui-icon" aria-hidden="true"><use href="#icon-pen"/></svg><small>发布</small><strong>写下你的新想法</strong><span>›</span></button>
        <button type="button" data-page="profile"><svg class="ui-icon" aria-hidden="true"><use href="#icon-user"/></svg><small>个人</small><strong>管理资料与账号</strong><span>›</span></button>
      </section>
      <section class="desktop-context-card desktop-context-about">
        <div><span class="status-dot"></span><strong>社区开放中</strong></div>
        <p>尊重他人、保护隐私，让每一次交流都有意义。</p>
        <div class="desktop-shortcuts"><span>快速搜索</span><kbd>/</kbd><span>发布话题</span><kbd>N</kbd><span>页面跳转</span><kbd>G</kbd></div>
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
    document.body.classList.toggle("desktop-utility-page", enabled() && ["notifications", "messages", "profile"].includes(page));
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
    syncSidebarSelection({ instant: true });
    window.addEventListener("blog-page-change", event => {
      syncContext(event.detail);
      syncSidebarSelection();
    });
    document.addEventListener("keydown", onKeydown);
    window.addEventListener("resize", () => syncSidebarSelection({ instant: true }), { passive: true });
    desktop.addEventListener?.("change", () => {
      pendingGo = false;
      syncContext();
      syncSidebarSelection({ instant: true });
    });
  }

  window.blogDesktop = { state, openSearch, openComposer, navigate, setProfileContext, clearProfileContext, syncSidebarSelection };
  document.addEventListener("DOMContentLoaded", init, { once: true });
})();
