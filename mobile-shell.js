(() => {
  "use strict";

  const query = window.matchMedia("(max-width: 1023px)");
  const $ = selector => document.querySelector(selector);
  let startX = 0;
  let startY = 0;
  let trackedPointer = null;

  function isMobile() { return query.matches; }
  function nav() { return $("#mainNav"); }
  function isDialogOpen() { return Boolean(document.querySelector("dialog[open]")); }

  function setDrawer(open) {
    const drawer = nav();
    const mobile = isMobile();
    const nextOpen = Boolean(open && mobile && !isDialogOpen());
    if (!drawer) return;

    drawer.classList.toggle("open", nextOpen);
    document.body.classList.toggle("nav-open", nextOpen);
    $("#menuBtn")?.setAttribute("aria-expanded", String(nextOpen));
    const backdrop = $("#navBackdrop");
    backdrop?.toggleAttribute("data-visible", nextOpen);
    backdrop?.setAttribute("aria-hidden", String(!nextOpen));

    if (mobile) {
      drawer.toggleAttribute("inert", !nextOpen);
      drawer.setAttribute("aria-hidden", String(!nextOpen));
    } else {
      drawer.removeAttribute("inert");
      drawer.removeAttribute("aria-hidden");
    }
  }

  function makeDock() {
    if ($("#mobileDock")) return;
    const dock = document.createElement("nav");
    dock.id = "mobileDock";
    dock.setAttribute("aria-label", "移动端快捷导航");
    dock.innerHTML = `
      <button type="button" data-mobile-action="home" aria-label="首页"><span><svg class="ui-icon"><use href="#icon-home"/></svg></span><small>首页</small></button>
      <button type="button" data-mobile-action="forum" aria-label="社区"><span><svg class="ui-icon"><use href="#icon-community"/></svg></span><small>社区</small></button>
      <button type="button" data-mobile-action="messages" aria-label="私信"><span><svg class="ui-icon"><use href="#icon-message"/></svg></span><small>私信</small></button>
      <button type="button" data-mobile-action="notifications" aria-label="通知"><span><svg class="ui-icon"><use href="#icon-bell"/></svg></span><small>通知</small></button>
      <button type="button" data-mobile-action="account" aria-label="我的"><span><svg class="ui-icon"><use href="#icon-user"/></svg></span><small>我的</small></button>`;
    document.body.append(dock);
  }

  function openComposer() {
    if (!window.blogAuth?.user) return window.blogAuth?.openAuth?.("login");
    window.blogUI?.navigate("forum");
    window.setTimeout(() => $("#newThreadBtn")?.click(), 80);
  }

  function makeComposeButton() {
    if ($("#mobileComposeFab")) return;
    const button = document.createElement("button");
    button.id = "mobileComposeFab";
    button.type = "button";
    button.setAttribute("aria-label", "发布社区话题");
    button.innerHTML = `<svg class="ui-icon" aria-hidden="true"><use href="#icon-plus"/></svg>`;
    button.addEventListener("click", openComposer);
    document.body.append(button);
  }

  function syncDock() {
    const dock = $("#mobileDock");
    const page = window.blogUI?.state?.page || location.hash.slice(1) || "home";
    if (isMobile()) document.body.dataset.mobilePage = page;
    else delete document.body.dataset.mobilePage;
    if (!dock) return;
    const activeAction = page === "profile" ? "account" : page;
    dock.querySelectorAll("button").forEach(button => {
      const active = button.dataset.mobileAction === activeAction;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
  }

  function openSearch() {
    window.blogUI?.openDialog?.($("#searchDialog"));
    $("#searchInput").value = "";
    window.search?.("");
    setTimeout(() => $("#searchInput")?.focus(), 0);
  }

  function handleAction(action) {
    if (action === "home" || action === "forum") return window.blogUI?.navigate(action);
    if (action === "search") return openSearch();
    if (action === "messages") return window.openMessages?.();
    if (action === "notifications") return window.openNotifications?.();
    // “我的”已有独立页面。未登录时由页面提供登录/注册入口，避免再次退回旧弹窗。
    if (action === "account") return window.blogUI?.navigate("profile");
  }

  function init() {
    makeDock();
    makeComposeButton();
    syncDock();
    setDrawer(false);
    query.addEventListener?.("change", () => { setDrawer(false); syncDock(); });
    window.addEventListener("blog-page-change", syncDock);

    $("#menuBtn")?.addEventListener("click", event => {
      if (!isMobile()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setDrawer(!nav()?.classList.contains("open"));
    }, true);
    $("#navBackdrop")?.addEventListener("click", () => setDrawer(false));

    document.addEventListener("click", event => {
      const action = event.target.closest("[data-mobile-action]")?.dataset.mobileAction;
      if (action) {
        event.preventDefault();
        handleAction(action);
      }
      if (isMobile() && event.target.closest("#mainNav a, #mainNav button")) setDrawer(false);
    });

    document.addEventListener("pointerdown", event => {
      trackedPointer = null;
      if (!isMobile() || event.pointerType === "mouse" || isDialogOpen()) return;
      trackedPointer = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
    }, { passive: true });
    document.addEventListener("pointerup", event => {
      if (trackedPointer !== event.pointerId) return;
      trackedPointer = null;
      if (!isMobile() || event.pointerType === "mouse" || isDialogOpen()) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (Math.abs(dy) > 70 || Math.abs(dx) < 70) return;
      if (startX <= 28 && dx > 70) setDrawer(true);
      const drawerWidth = Math.min(window.innerWidth * 0.82, 336);
      if (nav()?.classList.contains("open") && startX <= drawerWidth && dx < -70) setDrawer(false);
    }, { passive: true });
    document.addEventListener("pointercancel", () => { trackedPointer = null; }, { passive: true });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && nav()?.classList.contains("open")) setDrawer(false);
    });
  }

  document.addEventListener("DOMContentLoaded", init, { once: true });
})();
