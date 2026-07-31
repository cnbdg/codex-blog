(() => {
  "use strict";
  const query = window.matchMedia("(max-width: 1023px)");
  const $ = selector => document.querySelector(selector);
  let startX = 0;
  let startY = 0;

  function isMobile() { return query.matches; }
  function nav() { return $("#mainNav"); }
  function isDialogOpen() { return Boolean(document.querySelector("dialog[open]")); }

  function setDrawer(open) {
    if (!isMobile() || isDialogOpen()) return;
    nav()?.classList.toggle("open", open);
    document.body.classList.toggle("nav-open", open);
    $("#menuBtn")?.setAttribute("aria-expanded", String(open));
    $("#navBackdrop")?.toggleAttribute("data-visible", open);
  }

  function makeDock() {
    if ($("#mobileDock")) return;
    const dock = document.createElement("nav");
    dock.id = "mobileDock";
    dock.setAttribute("aria-label", "移动端快捷导航");
    dock.innerHTML = `
      <button type="button" data-mobile-action="home" aria-label="首页"><span>⌂</span><small>首页</small></button>
      <button type="button" data-mobile-action="forum" aria-label="社区"><span>◌</span><small>社区</small></button>
      <button type="button" data-mobile-action="search" aria-label="搜索"><span>⌕</span><small>搜索</small></button>
      <button type="button" data-mobile-action="notifications" aria-label="通知"><span>✦</span><small>通知</small></button>
      <button type="button" data-mobile-action="account" aria-label="我的"><span>◉</span><small>我的</small></button>`;
    document.body.append(dock);
  }

  function syncDock() {
    const dock = $("#mobileDock");
    if (!dock) return;
    const page = window.blogUI?.state?.page || location.hash.slice(1) || "home";
    dock.querySelectorAll("button").forEach(button => {
      const action = button.dataset.mobileAction;
      button.classList.toggle("active", action === page);
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
    if (action === "notifications") return window.openSocial?.("notifications");
    if (action === "account") return window.blogAuth?.openAuth?.();
  }

  function init() {
    makeDock();
    syncDock();
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
      if (action) { event.preventDefault(); handleAction(action); }
      if (isMobile() && event.target.closest("#mainNav [data-page]")) setDrawer(false);
    });

    document.addEventListener("pointerdown", event => {
      if (!isMobile() || event.pointerType === "mouse" || isDialogOpen()) return;
      startX = event.clientX; startY = event.clientY;
    }, { passive: true });
    document.addEventListener("pointerup", event => {
      if (!isMobile() || event.pointerType === "mouse" || isDialogOpen()) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (Math.abs(dy) > 70 || Math.abs(dx) < 70) return;
      if (startX <= 28 && dx > 70) setDrawer(true);
      if (nav()?.classList.contains("open") && startX < 360 && dx < -70) setDrawer(false);
    }, { passive: true });
  }

  document.addEventListener("DOMContentLoaded", init, { once: true });
})();
