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
  const animations = new Map();

  // Retarget from the presentation value, not the previous destination. A
  // cancelled controller resolves false; its obsolete completion cannot close UI.
  function animateTo(element, destination, { from, duration = 220 } = {}) {
    const previous = animations.get(element);
    const style = getComputedStyle(element);
    const start = previous || !from
      ? { opacity: style.opacity, transform: style.transform }
      : from;
    previous?.cancel();
    if (reduceMotion.matches || !element.animate) {
      return { finished: Promise.resolve(true), cancel() {} };
    }
    element.style.willChange = "transform, opacity";
    const animation = element.animate([start, destination], {
      duration, easing: "cubic-bezier(.2, .82, .22, 1)", fill: "both"
    });
    const controller = {
      cancel: () => animation.cancel(),
      finish: () => animation.finish(),
      finished: animation.finished.then(() => true, () => false).then(completed => {
        if (animations.get(element) === controller) {
          animations.delete(element);
          element.style.removeProperty("will-change");
          animation.cancel();
        }
        return completed;
      })
    };
    animations.set(element, controller);
    return controller;
  }

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
    const animation = animateTo(target, { opacity: 1, transform: "none" }, {
      from: { opacity: .7, transform: `translate3d(${sign * 8}px, 0, 0)` }, duration: 210
    });
    return {
      finished: animation.finished,
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
    const animation = animateTo(target, { opacity: 1, transform: "none" }, {
      from: { opacity: .72, transform: `translate3d(${sign * 6}px, 0, 0)` }, duration: 180
    });
    return {
      finished: animation.finished,
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
    state.activeTransition?.skipTransition?.();
    state.activeTransition = null;
    clearDirection();
    if (from === to) {
      update();
      return Promise.resolve();
    }
    if (reduceMotion.matches) {
      update();
      state.lastStrategy = "reduced-instant";
      return Promise.resolve();
    }

    const direction = directionFor(from, to);
    setDirection(direction);
    state.pageTransitions += 1;

    if (isMobile()) return activateTransition(iosPageTransition(update, direction));

    // Commit navigation synchronously. There is only one live page, never a
    // screenshot overlay swallowing clicks or a deferred update winning a race.
    return activateTransition(macosPageTransition(update, direction));
  }

  function cancelDialog(dialog) {
    animations.get(dialog)?.cancel();
    dialog.classList.remove(
      "platform-dialog-closing",
      "macos-panel-closing",
      "ios-sheet-closing",
      "ios-dialog-closing",
      "dialog-closing"
    );
    delete dialog.dataset.motionClosing;
    delete dialog.__motionClosePromise;
  }

  function openDialog(dialog) {
    const reversing = dialog.dataset.motionClosing === "true";
    if (dialog.open && !reversing) return;
    dialog.dataset.motionManaged = "true";
    delete dialog.dataset.motionClosing;
    delete dialog.__motionClosePromise;
    if (!dialog.open) dialog.showModal();
    const controller = animateTo(dialog, { opacity: 1, transform: "none" }, {
      from: { opacity: 0, transform: isMobile() ? "translate3d(0, 24px, 0)" : "translate3d(0, 10px, 0) scale(.98)" },
      duration: isMobile() ? 260 : 220
    });
    controller.finished.then(completed => {
      if (completed && dialog.open && dialog.dataset.motionClosing !== "true") dialog.classList.add("motion-dialog-settled");
    });
  }

  function closeDialog(dialog) {
    if (!dialog?.open) return Promise.resolve();
    if (dialog.dataset.motionClosing === "true") return dialog.__motionClosePromise || Promise.resolve();
    if (reduceMotion.matches) {
      cancelDialog(dialog);
      dialog.close();
      return Promise.resolve();
    }

    const mobile = isMobile();
    state.lastDialogStrategy = mobile ? "ios-sheet" : "macos-panel";
    dialog.dataset.motionClosing = "true";
    dialog.dataset.motionManaged = "true";
    state.dialogTransitions += 1;
    const controller = animateTo(dialog, {
      opacity: 0, transform: mobile ? "translate3d(0, 24px, 0)" : "translate3d(0, 8px, 0) scale(.985)"
    }, { duration: mobile ? 190 : 150 });
    dialog.__motionClosePromise = controller.finished.then(completed => {
      if (!completed || dialog.dataset.motionClosing !== "true") return;
      cancelDialog(dialog);
      if (dialog.open) dialog.close();
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
      animations.forEach(controller => controller.finish());
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
    document.addEventListener("animationend", event => {
      const dialog = event.target;
      if (event.pseudoElement || !(dialog instanceof HTMLDialogElement) || !dialog.open || dialog.dataset.motionClosing === "true") return;
      dialog.classList.add("motion-dialog-settled");
    });
    document.querySelectorAll("dialog").forEach(dialog => {
      dialog.addEventListener("close", () => {
        if (dialog.open) return;
        cancelDialog(dialog);
        dialog.classList.remove("motion-dialog-settled");
      });
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) return;
      animations.forEach(controller => controller.finish());
      state.activeTransition?.skipTransition?.();
      clearDirection();
      clearMacPointerTarget();
    });
  }

  window.blogMotion = {
    state,
    transitionPage,
    animateTo,
    openDialog,
    cancelDialog,
    closeDialog,
    reveal,
    reduceMotion
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
