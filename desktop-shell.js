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

  function contextEntries(page) {
    const entries = {
      messages: {
        title: "私信工具",
        items: [
          ["forum", "发现朋友", "去社区认识更多人"],
          ["notifications", "消息", "查看关注、点赞与回复"],
          ["profile", "个人", "管理资料与账号"]
        ]
      },
      notifications: {
        title: "通知工具",
        items: [
          ["messages", "私信", "和互相关注的朋友聊天"],
          ["forum", "社区", "看看大家正在讨论什么"],
          ["profile", "个人", "管理资料与账号"]
        ]
      },
      profile: {
        title: "账号工具",
        items: [
          ["messages", "私信", "回到你的好友会话"],
          ["forum", "社区", "发布或浏览讨论"],
          ["compose", "发布", "写下你的新想法"]
        ]
      }
    };
    return entries[page] || {
      title: "快捷入口",
      items: [
        ["forum", "社区", "看看大家正在讨论什么"],
        ["compose", "发布", "写下你的新想法"],
        ["profile", "个人", "管理资料与账号"]
      ]
    };
  }

  function syncContextRail(page) {
    const title = $("#desktopContextHeading");
    const actions = $("#desktopContextActions");
    if (!title || !actions) return;
    const context = contextEntries(page);
    title.textContent = context.title;
    actions.innerHTML = context.items.map(([action, eyebrow, label]) => action === "compose"
      ? `<button type="button" data-desktop-compose><small>${eyebrow}</small><strong>${label}</strong><span>›</span></button>`
      : `<button type="button" data-page="${action}"><small>${eyebrow}</small><strong>${label}</strong><span>›</span></button>`
    ).join("");
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
        <h2 id="desktopContextHeading">快捷入口</h2>
        <div id="desktopContextActions"></div>
      </section>`;
    document.body.append(rail);
    syncContextRail(window.blogUI?.state?.page || "home");
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
    syncContextRail(page);
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
