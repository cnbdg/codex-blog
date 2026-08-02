(() => {
  "use strict";

  const root = document.documentElement;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const mobileViewport = window.matchMedia("(max-width: 1023px)");
  const pageOrder = ["home", "forum", "notifications", "messages", "profile", "projects", "about", "friends", "admin"];
  const revealSelector = [
    ".post-item",
    ".thread-card",
    ".side-card",
    ".friendship-card",
    ".project-grid article",
    ".friend-grid > a",
    ".notification-item",
    ".message-friend-item",
    ".message-group-item",
    ".governance-card"
  ].join(",");
  const macPointerSelector = [
    ".topbar nav a",
    ".actions button",
    ".desktop-context-search",
    ".desktop-context-trends > button",
    ".primary-btn",
    ".secondary-btn",
    ".follow-button",
    ".chat-button"
  ].join(",");

  const state = {
    enabled: !reduceMotion.matches,
    platform: mobileViewport.matches ? "ios" : "macos",
    pageTransitions: 0,
    desktopTransitions: 0,
    mobileTransitions: 0,
    dialogTransitions: 0,
    desktopPointerResponses: 0,
    revealCount: 0,
    lastDirection: "none",
    lastStrategy: "none",
    lastDialogStrategy: "none",
    activeTransition: null
  };

  let revealObserver = null;
  let mutationObserver = null;
  let heroFrame = 0;
  let pointerFrame = 0;
  let activePointerTarget = null;

  function isMobile() {
    return mobileViewport.matches;
  }

  function syncPlatform() {
    state.platform = isMobile() ? "ios" : "macos";
    root.dataset.motionPlatform = state.platform;
    root.classList.toggle("motion-platform-ios", state.platform === "ios");
    root.classList.toggle("motion-platform-macos", state.platform === "macos");
    if (state.platform !== "macos") clearMacPointerTarget();
  }

  function directionFor(from, to) {
    const fromIndex = pageOrder.indexOf(from);
    const toIndex = pageOrder.indexOf(to);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return "forward";
    return toIndex > fromIndex ? "forward" : "backward";
  }

  function setDirection(direction) {
    root.classList.remove("motion-forward", "motion-backward");
    root.classList.add(`motion-${direction}`);
    state.lastDirection = direction;
  }

  function clearDirection() {
    root.classList.remove("motion-forward", "motion-backward", "motion-view-transition");
  }

  function macosPageTransition(update, direction) {
    update();
    state.desktopTransitions += 1;
    state.lastStrategy = "macos-fallback";
    const target = document.querySelector(".page.active");
    if (!target?.animate) return { finished: Promise.resolve(), skipTransition() {} };
    const sign = direction === "forward" ? 1 : -1;
    const animation = target.animate([
      { opacity: .46, transform: `translate3d(${sign * 11}px, 5px, 0) scale(.992)` },
      { opacity: 1, transform: `translate3d(${sign * -1}px, 0, 0) scale(1.001)`, offset: .78 },
      { opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" }
    ], {
      duration: 360,
      easing: "cubic-bezier(.16, 1, .3, 1)"
    });
    return {
      finished: animation.finished.catch(() => {}),
      skipTransition: () => animation.cancel()
    };
  }

  function iosPageTransition(update, direction) {
    update();
    const page = document.querySelector(".page.active");
    const target = page?.querySelector(":scope > .page-title, :scope > .forum-hero, :scope > .inner-title, :scope > .standalone-page-header, :scope > .profile-page-hero, :scope > .profile-page-guest") || null;
    state.mobileTransitions += 1;
    state.lastStrategy = "mobile-lightweight";
    if (!target?.animate) return { finished: Promise.resolve(), skipTransition() {} };
    const sign = direction === "forward" ? 1 : -1;
    const animation = target.animate([
      { opacity: .62, transform: `translate3d(${sign * 8}px, 3px, 0) scale(.992)` },
      { opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" }
    ], {
      duration: 230,
      easing: "cubic-bezier(.2, .82, .22, 1)"
    });
    return {
      finished: animation.finished.catch(() => {}),
      skipTransition: () => animation.cancel()
    };
  }

  function activateTransition(controller) {
    state.activeTransition = controller;
    controller.finished.finally(() => {
      if (state.activeTransition !== controller) return;
      state.activeTransition = null;
      clearDirection();
    });
    return controller.finished;
  }

  function transitionPage({ from = "home", to = "home", update }) {
    if (typeof update !== "function") return Promise.resolve();
    if (from === to) {
      update();
      return Promise.resolve();
    }
    if (reduceMotion.matches) {
      update();
      state.lastStrategy = "reduced-dissolve";
      const target = document.querySelector(".page.active");
      if (!target?.animate) return Promise.resolve();
      return target.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 120,
        easing: "ease-out"
      }).finished.catch(() => {});
    }

    state.activeTransition?.skipTransition?.();
    const direction = directionFor(from, to);
    setDirection(direction);
    state.pageTransitions += 1;

    if (isMobile()) return activateTransition(iosPageTransition(update, direction));

    root.classList.add("motion-view-transition");
    state.desktopTransitions += 1;
    state.lastStrategy = "macos-view-transition";

    if (typeof document.startViewTransition !== "function") {
      state.desktopTransitions -= 1;
      return activateTransition(macosPageTransition(update, direction));
    }

    let transition;
    try {
      transition = document.startViewTransition(() => update());
    } catch {
      state.desktopTransitions -= 1;
      return activateTransition(macosPageTransition(update, direction));
    }
    return activateTransition({
      finished: transition.finished.catch(() => {}),
      skipTransition: () => transition.skipTransition()
    });
  }

  function finishDialogClose(dialog, resolve) {
    if (dialog.open) dialog.close();
    dialog.classList.remove(
      "platform-dialog-closing",
      "macos-panel-closing",
      "ios-sheet-closing",
      "ios-dialog-closing",
      "dialog-closing"
    );
    delete dialog.dataset.motionClosing;
    resolve?.();
  }

  function closeDialog(dialog) {
    if (!dialog?.open) return Promise.resolve();
    if (dialog.dataset.motionClosing === "true") return dialog.__motionClosePromise || Promise.resolve();
    if (reduceMotion.matches) {
      dialog.close();
      return Promise.resolve();
    }

    const mobile = isMobile();
    const closingClass = mobile ? "ios-sheet-closing" : "macos-panel-closing";
    state.lastDialogStrategy = mobile ? "ios-sheet" : "macos-panel";
    dialog.dataset.motionClosing = "true";
    dialog.classList.remove("dialog-closing", "ios-dialog-closing");
    dialog.classList.add("platform-dialog-closing", closingClass);
    state.dialogTransitions += 1;
    dialog.__motionClosePromise = new Promise(resolve => {
      let finished = false;
      const complete = () => {
        if (finished) return;
        finished = true;
        dialog.removeEventListener("animationend", onAnimationEnd);
        finishDialogClose(dialog, resolve);
      };
      const onAnimationEnd = event => {
        if (event.target === dialog) complete();
      };
      dialog.addEventListener("animationend", onAnimationEnd);
      window.setTimeout(complete, mobile ? 390 : 270);
    });
    return dialog.__motionClosePromise;
  }

  function reveal(nodes = document.querySelectorAll(revealSelector)) {
    if (reduceMotion.matches || !revealObserver) return;
    const list = [...nodes].filter(node => node instanceof Element && node.matches(revealSelector) && !node.classList.contains("motion-reveal"));
    const interval = isMobile() ? 28 : 34;
    list.forEach((node, index) => {
      node.classList.add("motion-reveal");
      node.style.setProperty("--motion-stagger", `${Math.min(index % 7, 6) * interval}ms`);
      revealObserver.observe(node);
      state.revealCount += 1;
    });
  }

  function initReveal() {
    if (reduceMotion.matches || !("IntersectionObserver" in window) || revealObserver) return;
    revealObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        window.setTimeout(() => entry.target.classList.add("motion-settled"), isMobile() ? 620 : 480);
        revealObserver.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -7%", threshold: .04 });
    reveal();
    mutationObserver = new MutationObserver(records => {
      records.forEach(record => record.addedNodes.forEach(node => {
        if (!(node instanceof Element)) return;
        if (node.matches(revealSelector)) reveal([node]);
        reveal(node.querySelectorAll(revealSelector));
      }));
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });
  }

  function clearMacPointerTarget() {
    cancelAnimationFrame(pointerFrame);
    if (!activePointerTarget) return;
    activePointerTarget.classList.remove("mac-pointer-active", "mac-pointer-pressing");
    activePointerTarget.style.removeProperty("--mac-pointer-x");
    activePointerTarget.style.removeProperty("--mac-pointer-y");
    activePointerTarget = null;
  }

  function findMacPointerTarget(target) {
    if (!(target instanceof Element)) return null;
    return target.closest(macPointerSelector);
  }

  function initMacPointer() {
    document.addEventListener("pointermove", event => {
      if (state.platform !== "macos" || !finePointer.matches || reduceMotion.matches) return;
      const target = findMacPointerTarget(event.target);
      if (!target) {
        clearMacPointerTarget();
        return;
      }
      if (activePointerTarget && activePointerTarget !== target) clearMacPointerTarget();
      activePointerTarget = target;
      const rect = target.getBoundingClientRect();
      const x = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / Math.max(rect.width, 1) - .5) * 2));
      const y = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / Math.max(rect.height, 1) - .5) * 2));
      cancelAnimationFrame(pointerFrame);
      pointerFrame = requestAnimationFrame(() => {
        target.classList.add("mac-pointer-active");
        target.style.setProperty("--mac-pointer-x", `${(x * 1.7).toFixed(2)}px`);
        target.style.setProperty("--mac-pointer-y", `${(y * 1.2).toFixed(2)}px`);
        state.desktopPointerResponses += 1;
      });
    }, { passive: true });
    document.addEventListener("pointerout", event => {
      if (!activePointerTarget || activePointerTarget.contains(event.relatedTarget)) return;
      clearMacPointerTarget();
    }, { passive: true });
    document.addEventListener("pointerdown", event => {
      const target = findMacPointerTarget(event.target);
      if (state.platform === "macos" && target) target.classList.add("mac-pointer-pressing");
    }, { passive: true });
    document.addEventListener("pointerup", () => activePointerTarget?.classList.remove("mac-pointer-pressing"), { passive: true });
    document.addEventListener("pointercancel", clearMacPointerTarget, { passive: true });
  }

  function initHeroDepth() {
    const hero = document.querySelector(".social-hero");
    if (!hero) return;
    hero.addEventListener("pointermove", event => {
      if (state.platform !== "macos" || !finePointer.matches || reduceMotion.matches) return;
      const rect = hero.getBoundingClientRect();
      const x = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width - .5) * 2));
      const y = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height - .5) * 2));
      cancelAnimationFrame(heroFrame);
      heroFrame = requestAnimationFrame(() => {
        hero.classList.add("is-pointer-active");
        hero.style.setProperty("--motion-hero-x", `${x * 4}px`);
        hero.style.setProperty("--motion-hero-y", `${y * 3}px`);
        hero.style.setProperty("--motion-hero-rx", `${y * -1.1}deg`);
        hero.style.setProperty("--motion-hero-ry", `${x * 1.5}deg`);
      });
    }, { passive: true });
    hero.addEventListener("pointerleave", () => {
      hero.classList.remove("is-pointer-active");
      hero.style.removeProperty("--motion-hero-x");
      hero.style.removeProperty("--motion-hero-y");
      hero.style.removeProperty("--motion-hero-rx");
      hero.style.removeProperty("--motion-hero-ry");
    }, { passive: true });
  }

  function syncMotionPreference() {
    state.enabled = !reduceMotion.matches;
    root.classList.toggle("motion-enabled", state.enabled);
    root.classList.toggle("motion-reduced", !state.enabled);
    if (!state.enabled) {
      state.activeTransition?.skipTransition?.();
      clearDirection();
      clearMacPointerTarget();
      document.querySelectorAll(".motion-reveal").forEach(node => node.classList.add("is-visible"));
    } else {
      initReveal();
    }
  }

  function init() {
    syncPlatform();
    syncMotionPreference();
    initReveal();
    initMacPointer();
    initHeroDepth();
    window.addEventListener("blog-page-change", () => {
      requestAnimationFrame(() => reveal(document.querySelectorAll(".page.active " + revealSelector.replaceAll(",", ",.page.active "))));
    });
    reduceMotion.addEventListener?.("change", syncMotionPreference);
    mobileViewport.addEventListener?.("change", () => {
      state.activeTransition?.skipTransition?.();
      clearDirection();
      syncPlatform();
    });
  }

  window.blogMotion = {
    state,
    transitionPage,
    closeDialog,
    reveal,
    reduceMotion
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
