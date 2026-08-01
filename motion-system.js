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

  const state = {
    enabled: !reduceMotion.matches,
    pageTransitions: 0,
    dialogTransitions: 0,
    mobileTransitions: 0,
    revealCount: 0,
    lastDirection: "none",
    lastStrategy: "none",
    activeTransition: null
  };

  let revealObserver = null;
  let mutationObserver = null;
  let heroFrame = 0;

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

  function fallbackPageTransition(update, direction) {
    update();
    const target = document.querySelector(".page.active");
    if (!target?.animate) return { finished: Promise.resolve(), skipTransition() {} };
    const sign = direction === "forward" ? 1 : -1;
    const animation = target.animate([
      { opacity: 0, transform: `translate3d(${sign * 64}px, 0, 0) scale(.982)` },
      { opacity: 1, transform: `translate3d(${sign * -3}px, 0, 0) scale(1.002)`, offset: .72 },
      { opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" }
    ], {
      duration: window.innerWidth < 1024 ? 480 : 520,
      easing: "cubic-bezier(.16, 1, .3, 1)"
    });
    return {
      finished: animation.finished.catch(() => {}),
      skipTransition: () => animation.cancel()
    };
  }

  function mobilePageTransition(update, direction) {
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

    if (mobileViewport.matches) {
      return activateTransition(mobilePageTransition(update, direction));
    }

    root.classList.add("motion-view-transition");
    state.lastStrategy = "desktop-view-transition";

    if (typeof document.startViewTransition !== "function") {
      state.lastStrategy = "desktop-fallback";
      return activateTransition(fallbackPageTransition(update, direction));
    }

    let transition;
    try {
      transition = document.startViewTransition(() => update());
    } catch {
      state.lastStrategy = "desktop-fallback";
      return activateTransition(fallbackPageTransition(update, direction));
    }
    return activateTransition({
      finished: transition.finished.catch(() => {}),
      skipTransition: () => transition.skipTransition()
    });
  }

  function finishDialogClose(dialog, resolve) {
    if (dialog.open) dialog.close();
    dialog.classList.remove("ios-dialog-closing", "dialog-closing");
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

    dialog.dataset.motionClosing = "true";
    dialog.classList.remove("dialog-closing");
    dialog.classList.add("ios-dialog-closing");
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
      window.setTimeout(complete, window.innerWidth < 1024 ? 380 : 290);
    });
    return dialog.__motionClosePromise;
  }

  function reveal(nodes = document.querySelectorAll(revealSelector)) {
    if (reduceMotion.matches || !revealObserver) return;
    const list = [...nodes].filter(node => node instanceof Element && node.matches(revealSelector) && !node.classList.contains("motion-reveal"));
    list.forEach((node, index) => {
      node.classList.add("motion-reveal");
      node.style.setProperty("--motion-stagger", `${Math.min(index % 7, 6) * 42}ms`);
      revealObserver.observe(node);
      state.revealCount += 1;
    });
  }

  function initReveal() {
    if (reduceMotion.matches || !("IntersectionObserver" in window)) return;
    revealObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        window.setTimeout(() => entry.target.classList.add("motion-settled"), 760);
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

  function initHeroDepth() {
    const hero = document.querySelector(".social-hero");
    if (!hero || !finePointer.matches || reduceMotion.matches) return;
    hero.addEventListener("pointermove", event => {
      const rect = hero.getBoundingClientRect();
      const x = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width - .5) * 2));
      const y = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height - .5) * 2));
      cancelAnimationFrame(heroFrame);
      heroFrame = requestAnimationFrame(() => {
        hero.classList.add("is-pointer-active");
        hero.style.setProperty("--motion-hero-x", `${x * 8}px`);
        hero.style.setProperty("--motion-hero-y", `${y * 6}px`);
        hero.style.setProperty("--motion-hero-rx", `${y * -2.4}deg`);
        hero.style.setProperty("--motion-hero-ry", `${x * 3.2}deg`);
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
      document.querySelectorAll(".motion-reveal").forEach(node => node.classList.add("is-visible"));
    }
  }

  function init() {
    syncMotionPreference();
    initReveal();
    initHeroDepth();
    window.addEventListener("blog-page-change", () => {
      requestAnimationFrame(() => reveal(document.querySelectorAll(".page.active " + revealSelector.replaceAll(",", ",.page.active "))));
    });
    reduceMotion.addEventListener?.("change", syncMotionPreference);
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
