(() => {
  "use strict";

  const state = { page: "home", overlay: null, menuOpen: false, navigationId: 0 };
  const $ = selector => document.querySelector(selector);
  const validPage = value => document.getElementById(value)?.classList.contains("page");

  function emit(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  function closeMenu() {
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

  function openDialog(dialog) {
    if (!dialog || dialog.open) return;
    document.querySelectorAll("dialog[open]").forEach(node => {
      if (node !== dialog) node.close();
    });
    dialog.showModal();
    state.overlay = dialog.id;
    emit("blog-overlay-change", { id: dialog.id, open: true });
  }

  function closeDialog(dialog) {
    if (!dialog?.open) return;
    if (window.blogMotion?.closeDialog) window.blogMotion.closeDialog(dialog);
    else dialog.close();
    if (state.overlay === dialog.id) state.overlay = null;
    emit("blog-overlay-change", { id: dialog.id, open: false });
  }

  function init() {
    const initial = location.hash.slice(1);
    navigate(validPage(initial) ? initial : "home", { history: false, animate: false });

    window.addEventListener("popstate", () => navigate(location.hash.slice(1) || "home", { history: false }));
    window.addEventListener("hashchange", () => navigate(location.hash.slice(1) || "home", { history: false }));

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
