(() => {
  "use strict";

  const query = window.matchMedia("(max-width: 1023px)");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const $ = selector => document.querySelector(selector);
  let trackedPointer = null;
  let drawerDrag = {
    active: false,
    startX: 0,
    lastX: 0,
    lastTime: 0,
    velocity: 0,
    width: 0,
    open: false,
    history: []
  };
  const dockState = {
    action: "",
    x: 0,
    width: 0,
    moves: 0,
    minimized: false,
    lastScrollY: 0,
    scrollTravel: 0,
    scrollDirection: 0,
    scrollFrame: 0,
    lightFrame: 0,
    syncFrame: 0,
    layoutFrame: 0,
    layoutFlushes: 0,
    animation: null
  };

  function isMobile() { return query.matches; }
  function nav() { return $("#mainNav"); }
  function isDialogOpen() { return Boolean(document.querySelector("dialog[open]")); }

  function drawerWidth() {
    return Math.min(window.innerWidth * .82, 336);
  }

  function drawerOpenProgress() {
    const drawer = nav();
    if (!drawer) return 0;
    const width = drawerWidth();
    const rect = drawer.getBoundingClientRect();
    // Drawer is anchored left (translateX(-105%) closed, 0 open).
    return Math.max(0, Math.min(1, 1 + rect.left / width));
  }

  function setDrawerProgress(progress) {
    const drawer = nav();
    if (!drawer) return;
    const width = drawerWidth();
    // The closed drawer style uses transform !important, so the drag
    // transform must be set with !important too to win the cascade.
    drawer.style.setProperty("transform", `translate3d(${(-(1 - progress) * width * 1.05).toFixed(2)}px, 0, 0)`, "important");
    document.body.style.setProperty("--drawer-progress", progress.toFixed(3));
    const backdrop = $("#navBackdrop");
    if (backdrop) {
      backdrop.style.opacity = String(progress * .6);
      backdrop.style.visibility = progress > .02 ? "visible" : "hidden";
    }
  }

  function clearDrawerProgress() {
    const drawer = nav();
    if (!drawer) return;
    drawer.style.removeProperty("transform");
    const backdrop = $("#navBackdrop");
    if (backdrop) {
      backdrop.style.removeProperty("opacity");
      backdrop.style.removeProperty("visibility");
    }
    document.body.style.removeProperty("--drawer-progress");
  }

  function snapDrawer(open, velocity = 0) {
    const drawer = nav();
    if (!drawer) return;
    const width = drawerWidth();
    const progress = drawerOpenProgress();
    // Apple momentum projection: decide by velocity first, distance second.
    const projected = progress + (velocity * 0.18) / width;
    const shouldOpen = projected > .42 || (Math.abs(velocity) < .05 && progress > .5);
    if (open === undefined) open = shouldOpen;
    clearDrawerProgress();
    setDrawer(open);
  }

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
      <i class="liquid-glass-indicator" aria-hidden="true"></i>
      <button type="button" data-mobile-action="home" aria-label="首页"><span><svg class="ui-icon"><use href="#icon-home"/></svg></span><small>首页</small></button>
      <button type="button" data-mobile-action="forum" aria-label="社区"><span><svg class="ui-icon"><use href="#icon-community"/></svg></span><small>社区</small></button>
      <button type="button" data-mobile-action="messages" aria-label="私信"><span><svg class="ui-icon"><use href="#icon-message"/></svg></span><small>私信</small></button>
      <button type="button" data-mobile-action="notifications" aria-label="通知"><span><svg class="ui-icon"><use href="#icon-bell"/></svg></span><small>通知</small></button>
      <button type="button" data-mobile-action="account" aria-label="我的"><span><svg class="ui-icon"><use href="#icon-user"/></svg></span><small>我的</small></button>`;
    document.body.append(dock);
  }

  function pageAction(page) {
    return page === "profile" ? "account" : page;
  }

  function setDockMinimized(minimized) {
    const next = Boolean(minimized && isMobile() && !isDialogOpen() && !document.body.classList.contains("nav-open"));
    const dock = $("#mobileDock");
    dockState.minimized = next;
    dock?.classList.toggle("is-minimized", next);
    document.body.classList.toggle("liquid-dock-minimized", next);
  }

  function syncLiquidIndicator(button, { instant = false } = {}) {
    const dock = $("#mobileDock");
    const indicator = dock?.querySelector(".liquid-glass-indicator");
    if (!dock || !indicator || !button || !isMobile()) return;

    const dockRect = dock.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const x = Math.round((buttonRect.left - dockRect.left + 2) * 100) / 100;
    const width = Math.max(44, Math.round((buttonRect.width - 4) * 100) / 100);
    const previousX = dockState.x;
    const previousWidth = dockState.width || width;

    dock.style.setProperty("--liquid-x", `${x}px`);
    dock.style.setProperty("--liquid-width", `${width}px`);
    dockState.x = x;
    dockState.width = width;

    dockState.animation?.cancel?.();
    if (instant || reduceMotion.matches || !indicator.animate || previousWidth === 0 || Math.abs(x - previousX) < 1) return;

    const distance = x - previousX;
    const direction = Math.sign(distance) || 1;
    const stretch = Math.min(1.28, 1 + Math.abs(distance) / 420);
    indicator.style.transformOrigin = direction > 0 ? "right center" : "left center";
    dockState.animation = indicator.animate([
      { transform: `translate3d(${previousX}px, 0, 0) scaleX(${previousWidth / width})` },
      { transform: `translate3d(${x - direction * 5}px, 0, 0) scaleX(${stretch}) scaleY(.9)`, offset: .56 },
      { transform: `translate3d(${x + direction * 2}px, 0, 0) scaleX(.985) scaleY(1.015)`, offset: .82 },
      { transform: `translate3d(${x}px, 0, 0) scale(1)` }
    ], {
      duration: 520,
      easing: "cubic-bezier(.2, .82, .22, 1)"
    });
    dockState.animation.finished.catch(() => {}).finally(() => {
      if (dockState.animation?.playState === "finished") dockState.animation = null;
    });
    dockState.moves += 1;
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
    const activeAction = pageAction(page);
    let activeButton = null;
    dock.querySelectorAll("button").forEach(button => {
      const active = button.dataset.mobileAction === activeAction;
      button.classList.toggle("active", active);
      if (active) activeButton = button;
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    dock.classList.toggle("has-active", Boolean(activeButton));
    dock.dataset.activeAction = activeAction;
    const changed = dockState.action !== activeAction;
    dockState.action = activeAction;
    cancelAnimationFrame(dockState.syncFrame);
    dockState.syncFrame = requestAnimationFrame(() => {
      dockState.syncFrame = 0;
      syncLiquidIndicator(activeButton, { instant: !changed || dockState.width === 0 });
    });
  }

  function scheduleDockLayout() {
    cancelAnimationFrame(dockState.layoutFrame);
    dockState.layoutFrame = requestAnimationFrame(() => {
      dockState.layoutFrame = 0;
      dockState.layoutFlushes += 1;
      const active = $("#mobileDock")?.querySelector("button.active");
      syncLiquidIndicator(active, { instant: true });
    });
  }

  function openSearch() {
    window.blogUI?.openDialog?.($("#searchDialog"));
    $("#searchInput").value = "";
    window.search?.("");
    setTimeout(() => $("#searchInput")?.focus(), 0);
  }

  function handleAction(action) {
    const currentPage = window.blogUI?.state?.page || location.hash.slice(1) || "home";
    if (pageAction(currentPage) === action) {
      setDockMinimized(false);
      window.scrollTo({ top: 0, behavior: reduceMotion.matches ? "auto" : "smooth" });
      return;
    }
    setDockMinimized(false);
    if (action === "home" || action === "forum") return window.blogUI?.navigate(action);
    if (action === "search") return openSearch();
    if (action === "messages") return window.openMessages?.();
    if (action === "notifications") return window.openNotifications?.();
    // “我的”已有独立页面。未登录时由页面提供登录/注册入口，避免再次退回旧弹窗。
    if (action === "account") return window.blogUI?.navigate("profile");
  }

  function updateLiquidLight(event) {
    const dock = $("#mobileDock");
    if (!dock || !isMobile()) return;
    const rect = dock.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100));
    cancelAnimationFrame(dockState.lightFrame);
    dockState.lightFrame = requestAnimationFrame(() => {
      dock.style.setProperty("--liquid-light-x", `${x}%`);
      dock.style.setProperty("--liquid-light-y", `${y}%`);
    });
  }

  function handleScroll() {
    if (!isMobile()) return;
    cancelAnimationFrame(dockState.scrollFrame);
    dockState.scrollFrame = requestAnimationFrame(() => {
      const current = Math.max(0, window.scrollY || document.documentElement.scrollTop || 0);
      const delta = current - dockState.lastScrollY;
      const direction = Math.sign(delta);

      if (direction && direction !== dockState.scrollDirection) dockState.scrollTravel = 0;
      if (Math.abs(delta) < 72) dockState.scrollTravel += delta;
      else dockState.scrollTravel = delta;
      dockState.scrollDirection = direction || dockState.scrollDirection;
      dockState.lastScrollY = current;

      if (current < 72 || dockState.scrollTravel < -28) {
        setDockMinimized(false);
        dockState.scrollTravel = 0;
      } else if (current > 150 && dockState.scrollTravel > 38 && !isDialogOpen()) {
        setDockMinimized(true);
        dockState.scrollTravel = 0;
      }
    });
  }

  function init() {
    makeDock();
    makeComposeButton();
    syncDock();
    dockState.lastScrollY = Math.max(0, window.scrollY || 0);
    setDrawer(false);
    query.addEventListener?.("change", () => {
      setDrawer(false);
      setDockMinimized(false);
      syncDock();
    });
    window.addEventListener("blog-page-change", syncDock);

    const dock = $("#mobileDock");
    dock?.addEventListener("pointermove", updateLiquidLight, { passive: true });
    dock?.addEventListener("pointerdown", event => {
      updateLiquidLight(event);
      dock.classList.add("is-pressing");
      setDockMinimized(false);
    }, { passive: true });
    ["pointerup", "pointercancel", "pointerleave"].forEach(type => {
      dock?.addEventListener(type, () => dock.classList.remove("is-pressing"), { passive: true });
    });
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", scheduleDockLayout, { passive: true });
    window.visualViewport?.addEventListener("resize", scheduleDockLayout, { passive: true });

    $("#menuBtn")?.addEventListener("click", event => {
      if (!isMobile()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const opening = !nav()?.classList.contains("open");
      setDrawer(opening);
      if (opening) setDockMinimized(false);
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
      const drawer = nav();
      const edgeStart = event.clientX <= 34;
      const insideDrawer = drawer?.classList.contains("open") && event.clientX <= drawerWidth() + 8;
      if (!edgeStart && !insideDrawer) return;
      trackedPointer = event.pointerId;
      drawerDrag.active = true;
      drawerDrag.startX = event.clientX;
      drawerDrag.lastX = event.clientX;
      drawerDrag.lastTime = performance.now();
      drawerDrag.velocity = 0;
      drawerDrag.width = drawerWidth();
      drawerDrag.open = Boolean(drawer?.classList.contains("open"));
      drawerDrag.history = [];
      drawer?.classList.add("is-dragging");
      try { drawer?.setPointerCapture?.(event.pointerId); } catch { /* synthetic or released pointer */ }
    }, { passive: true });
    document.addEventListener("pointermove", event => {
      if (!drawerDrag.active || trackedPointer !== event.pointerId) return;
      const drawer = nav();
      if (!drawer) return;
      const now = performance.now();
      const dt = Math.max(1, now - drawerDrag.lastTime);
      const dx = event.clientX - drawerDrag.lastX;
      drawerDrag.velocity = .7 * (dx / dt) + .3 * drawerDrag.velocity;
      drawerDrag.history.push({ x: event.clientX, t: now });
      if (drawerDrag.history.length > 8) drawerDrag.history.shift();
      drawerDrag.lastX = event.clientX;
      drawerDrag.lastTime = now;

      const travel = event.clientX - drawerDrag.startX;
      const width = drawerDrag.width;
      // Closed drawer dragged right opens; open drawer dragged left closes.
      let progress;
      if (drawerDrag.open) progress = 1 + travel / width;
      else progress = travel / width;
      // Rubber-band at the far edge: resist past the boundary.
      if (progress > 1) progress = 1 + (progress - 1) * .18;
      if (progress < 0) progress = progress * .25;
      setDrawerProgress(Math.max(0, Math.min(1, progress)));
      if (event.pointerType === "touch") event.preventDefault();
    }, { passive: false });
    document.addEventListener("pointerup", event => {
      if (trackedPointer !== event.pointerId) return;
      trackedPointer = null;
      if (!isMobile() || event.pointerType === "mouse" || isDialogOpen()) return;
      if (!drawerDrag.active) return;
      drawerDrag.active = false;
      const drawer = nav();
      drawer?.classList.remove("is-dragging");
      try { drawer?.releasePointerCapture?.(event.pointerId); } catch { /* synthetic or released pointer */ }
      // Velocity from the last ~90ms window, Apple-style handoff.
      const history = drawerDrag.history;
      let velocity = 0;
      if (history.length >= 2) {
        const tail = history[history.length - 1];
        const head = history[0];
        const elapsed = Math.max(1, tail.t - head.t);
        velocity = (tail.x - head.x) / elapsed;
      }
      snapDrawer(undefined, velocity);
      drawerDrag.history = [];
    }, { passive: true });
    document.addEventListener("pointercancel", () => {
      if (!drawerDrag.active) return;
      drawerDrag.active = false;
      trackedPointer = null;
      nav()?.classList.remove("is-dragging");
      snapDrawer(drawerDrag.open);
    }, { passive: true });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && nav()?.classList.contains("open")) setDrawer(false);
    });
  }

  window.blogMobileShell = { state: dockState, syncDock, setDockMinimized, setDrawer };

  document.addEventListener("DOMContentLoaded", init, { once: true });
})();
