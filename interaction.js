(() => {
  "use strict";

  const state = { page: "home", overlay: null, menuOpen: false, navigationId: 0 };
  const $ = selector => document.querySelector(selector);
  const validPage = value => document.getElementById(value)?.classList.contains("page");

  function emit(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  function closeMenu() {
    if (window.blogMobileShell?.setDrawer && window.matchMedia("(max-width: 1023px)").matches) {
      window.blogMobileShell.setDrawer(false);
      state.menuOpen = false;
      return;
    }
    const nav = $("#mainNav");
    nav?.classList.remove("open");
    document.body.classList.remove("nav-open");
    state.menuOpen = false;
    $("#menuBtn")?.setAttribute("aria-expanded", "false");
  }

  function navigate(page, { history = true, focus = false, animate = true } = {}) {
    if (!validPage(page)) return false;
    const previous = state.page;
    const changed = previous !== page;
    const navigationId = changed ? ++state.navigationId : state.navigationId;
    if (changed) state.page = page;
    closeMenu();
    if (history && location.hash !== `#${page}`) window.history.pushState({ page }, "", `#${page}`);
    const update = () => {
      if (navigationId !== state.navigationId || state.page !== page) return;
      document.querySelectorAll(".page").forEach(node => node.classList.toggle("active", node.id === page));
      document.querySelectorAll("#mainNav [data-page]").forEach(node => {
        const active = node.dataset.page === page;
        node.classList.toggle("active", active);
        if (active) node.setAttribute("aria-current", "page");
        else node.removeAttribute("aria-current");
      });
      window.scrollTo({ top: 0, behavior: "instant" });
      if (changed) emit("blog-page-change", { page, previous });
      if (focus) document.getElementById(page)?.focus?.({ preventScroll: true });
    };
    if (changed && animate && window.blogMotion?.transitionPage) {
      window.blogMotion.transitionPage({ from: previous, to: page, update });
    } else update();
    return true;
  }

  function syncDialogClosed(dialog) {
    dialog?.classList.remove("motion-dialog-settled");
    if (!dialog || state.overlay !== dialog.id) return;
    state.overlay = null;
    emit("blog-overlay-change", { id: dialog.id, open: false });
  }

  function openDialog(dialog) {
    if (!(dialog instanceof HTMLDialogElement) || !dialog.isConnected) return false;
    closeMenu();
    dialog.classList.remove("motion-dialog-settled");
    if (dialog.open) {
      state.overlay = dialog.id;
      return true;
    }
    document.querySelectorAll("dialog[open]").forEach(node => {
      if (node === dialog) return;
      node.close();
      syncDialogClosed(node);
    });
    try {
      dialog.showModal();
    } catch (error) {
      console.error("Dialog open failed", error);
      return false;
    }
    state.overlay = dialog.id;
    emit("blog-overlay-change", { id: dialog.id, open: true });
    return true;
  }

  function closeDialog(dialog) {
    if (!dialog?.open) return Promise.resolve();
    if (window.blogMotion?.closeDialog) return window.blogMotion.closeDialog(dialog).then(() => syncDialogClosed(dialog));
    dialog.close();
    syncDialogClosed(dialog);
    return Promise.resolve();
  }

  function init() {
    const initial = location.hash.slice(1);
    navigate(validPage(initial) ? initial : "home", { history: false, animate: false });

    window.addEventListener("popstate", () => navigate(location.hash.slice(1) || "home", { history: false }));
    window.addEventListener("hashchange", () => navigate(location.hash.slice(1) || "home", { history: false }));

    document.querySelectorAll("dialog").forEach(dialog => {
      dialog.addEventListener("close", () => syncDialogClosed(dialog));
    });

    document.addEventListener("click", event => {
      const pageLink = event.target.closest("[data-page]");
      if (pageLink && validPage(pageLink.dataset.page)) {
        event.preventDefault();
        navigate(pageLink.dataset.page);
      }
      const close = event.target.closest("[data-close]");
      if (close) {
        event.preventDefault();
        event.stopPropagation();
        closeDialog(document.getElementById(close.dataset.close));
      }
    }, true);

    document.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        const open = document.querySelector("dialog[open]");
        if (open) closeDialog(open); else closeMenu();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openDialog($("#searchDialog"));
        setTimeout(() => $("#searchInput")?.focus(), 0);
      }
    });
  }

  window.blogUI = { state, navigate, openDialog, closeDialog, closeMenu };
  document.addEventListener("DOMContentLoaded", init, { once: true });
})();
