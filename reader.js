(() => {
  "use strict";

  const kind = document.body.dataset.readerKind;
  const active = kind === "article" || kind === "thread";
  if (!active) return;

  const $ = selector => document.querySelector(selector);
  const state = { ready: false, request: 0, title: "", description: "" };
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const expectedId = kind === "thread" ? "threadDialog" : "articleDialog";
  const prefix = document.querySelector('script[src*="app.min.js"]')?.src
    ? new URL("./", document.querySelector('script[src*="app.min.js"]').src)
    : new URL("./", location.href);

  function owns(node) { return Boolean(node?.matches?.(`#${expectedId}[data-reader-inline]`)); }
  function mount(node) {
    if (!owns(node)) return false;
    node.hidden = false;
    $("#readerState").hidden = true;
    return true;
  }

  function rootPage(page = kind === "thread" ? "forum" : "home") {
    const target = new URL("index.html", prefix);
    target.hash = page;
    return target.href;
  }

  function navigate(page) {
    const target = new URL(rootPage(page));
    if (page === "messages") {
      const peer = window.blogMessages?.peer;
      const group = window.blogMessages?.group;
      if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(peer || "")) target.searchParams.set("chat", peer);
      else if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(group || "")) target.searchParams.set("group", group);
    }
    location.assign(target.href);
    return true;
  }

  function validArticleKey(value) { return /^(?:post-\d+|[a-z0-9]+(?:-[a-z0-9]+)*)$/.test(value || ""); }
  function readKey() {
    if (kind === "article") return document.body.dataset.readerKey || new URLSearchParams(location.search).get("key") || "";
    return document.body.dataset.readerKey || new URLSearchParams(location.search).get("id") || "";
  }

  function setMeta(title, description) {
    state.title = title;
    state.description = description || "在 cnbdg 的博客阅读内容并参与讨论。";
    document.title = `${title} · cnbdg的博客`;
    const values = [
      ['meta[name="description"]', state.description],
      ['meta[property="og:title"]', title],
      ['meta[property="og:description"]', state.description],
      ['meta[property="og:url"]', location.href]
    ];
    values.forEach(([selector, value]) => $(selector)?.setAttribute("content", value));
  }

  function slug(value, index) {
    const clean = String(value || "").trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
    return clean || `section-${index + 1}`;
  }

  function decodeHash() {
    try { return decodeURIComponent(location.hash.slice(1)); }
    catch { return ""; }
  }

  function buildToc() {
    const content = $(kind === "thread" ? "#threadContent" : "#articleContent");
    const headings = [...(content?.querySelectorAll("h2,h3") || [])];
    const used = new Set();
    headings.forEach((heading, index) => {
      let id = heading.id || slug(heading.textContent, index);
      const base = id;
      let suffix = 2;
      while (used.has(id) || (document.getElementById(id) && document.getElementById(id) !== heading)) id = `${base}-${suffix++}`;
      used.add(id);
      heading.id = id;
    });
    const toc = $("#readerToc");
    toc.innerHTML = headings.length
      ? headings.map(heading => `<a class="reader-toc-${heading.tagName.toLowerCase()}" href="#${encodeURIComponent(heading.id)}">${escapeHtml(heading.textContent)}</a>`).join("")
      : `<span>这篇内容适合顺序阅读</span>`;
    toc.querySelectorAll("a").forEach(link => link.addEventListener("click", event => {
      const target = document.getElementById(decodeURIComponent(link.hash.slice(1)));
      if (!target) return;
      event.preventDefault();
      history.replaceState(history.state, "", link.hash);
      target.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "start" });
    }));
  }

  function normalizeContentUrls() {
    const content = $(`#${expectedId}`);
    if (!content) return;
    for (const [selector, attribute] of [["a[href]", "href"], ["img[src]", "src"], ["video[src]", "src"], ["source[src]", "src"]]) {
      content.querySelectorAll(selector).forEach(node => {
        const value = node.getAttribute(attribute);
        if (!value || /^(?:#|[a-z]+:|\/\/|\/)/i.test(value)) return;
        node.setAttribute(attribute, new URL(value, prefix).href);
      });
    }
  }

  function contentReady({ title, description = "" }) {
    const target = $(`#${expectedId}`);
    mount(target);
    setMeta(title, description);
    $("#readerSummary").textContent = description || (kind === "thread" ? "看看大家的观点，也可以在楼层中继续交流。" : "沉浸阅读，也欢迎在评论区留下想法。");
    normalizeContentUrls();
    buildToc();
    document.body.classList.add("reader-ready");
    state.ready = true;
    requestAnimationFrame(() => {
      const hashTarget = document.getElementById(decodeHash());
      if (hashTarget) {
        hashTarget.scrollIntoView({ block: "start" });
      } else $("#readerMain")?.focus({ preventScroll: true });
    });
  }

  function fail(title, message, retry = true) {
    const panel = $("#readerState");
    $(`#${expectedId}`).hidden = true;
    panel.hidden = false;
    panel.innerHTML = `<span class="reader-eyebrow">${kind === "thread" ? "COMMUNITY" : "CNBDG JOURNAL"}</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${retry ? '<button type="button" data-reader-retry>重新加载</button>' : `<a href="${rootPage()}">返回${kind === "thread" ? "社区" : "文章列表"}</a>`}`;
    state.ready = true;
    document.body.classList.add("reader-ready");
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  function shareUrl() {
    // Keep only the content identifier. Auth callbacks and other transient
    // query/hash values must never be copied into a public share link.
    const url = new URL(location.href);
    url.search = "";
    url.hash = "";
    if (!document.body.dataset.readerKey) url.searchParams.set(kind === "thread" ? "id" : "key", readKey());
    return url.href;
  }

  async function share() {
    const data = { title: state.title || document.title, text: state.description, url: shareUrl() };
    try {
      if (navigator.share) { await navigator.share(data); return; }
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(data.url); window.toast?.("分享链接已复制"); return; }
    } catch (error) { if (error?.name === "AbortError") return; }
    const fallback = $("#readerShareFallback");
    $("#readerShareInput").value = data.url;
    fallback.hidden = false;
    requestAnimationFrame(() => $("#readerShareInput").select());
  }

  function updateProgress() {
    updateProgress.frame = 0;
    const max = document.documentElement.scrollHeight - innerHeight;
    const progress = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 1;
    $("#readerProgress").style.transform = `scaleX(${progress})`;
  }

  function syncAccount() {
    const button = $("[data-reader-account]");
    if (!button) return;
    button.textContent = window.blogAuth?.user ? (window.blogAuth.profile?.username || "我的主页") : "登录 / 注册";
  }

  async function load() {
    const loadId = ++state.request;
    $("#readerState").hidden = false;
    try {
      await loadContent(loadId);
    } catch (error) {
      if (loadId !== state.request) return;
      console.warn("Reader content request failed", error);
      fail("内容暂时加载失败", "请检查网络后重试，无需重新发布内容。");
    }
  }

  async function loadContent(loadId) {
    const key = readKey();
    if (kind === "article") {
      if (!validArticleKey(key)) return fail("文章链接无效", "请检查分享链接是否完整。", false);
      const local = window.blogArticles.localPosts().find(post => window.blogContentLinks.localKey(post) === key);
      if (local) {
        window.blogArticles.render(local);
        return contentReady({ title: local.title, description: local.description || local.desc });
      }
      const match = /^post-(\d+)$/.exec(key);
      if (!match || !window.blogContentLinks.positiveId(match[1])) return fail("文章没有找到", "它可能已经移动、撤下或尚未发布。", false);
      const result = await window.blogAuth.getPublishedPost(Number(match[1]));
      if (loadId !== state.request) return;
      if (!result?.row) return fail("文章暂时打不开", result?.error || "它可能已经撤下，或者当前网络不可用。", Boolean(result?.error));
      const post = result.row;
      const view = { id: 1000000 + Number(post.id), dbId: post.id, title: post.title, desc: post.description, description: post.description, date: post.published_at, type: post.type, tags: post.tags || [], read: post.read_time || "5 分钟", lead: post.lead, body: post.body };
      window.blogArticles.render(view);
      return contentReady({ title: view.title, description: view.description });
    }
    if (!window.blogContentLinks.positiveId(key)) return fail("帖子链接无效", "请检查分享链接是否完整。", false);
    const result = await window.openForumThreadById(Number(key), { inline: true, updateUrl: false, isCurrent: () => loadId === state.request });
    if (loadId !== state.request) return;
    if (!result?.row) fail("帖子暂时打不开", result?.error || "帖子可能已经被删除或隐藏。", Boolean(result?.error));
  }

  function init() {
    document.addEventListener("click", event => {
      if (event.target.closest("[data-reader-share]")) share();
      if (event.target.closest("[data-reader-comments]")) $("#readerDiscussion")?.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth" });
      if (event.target.closest("[data-reader-display]")) window.blogUI?.openDialog($("#wallpaperDialog"));
      if (event.target.closest("[data-reader-theme]")) $("#themeBtn")?.click();
      if (event.target.closest("[data-reader-account]")) window.blogAuth?.user ? navigate("profile") : window.blogAuth?.openAuth("login");
      if (event.target.closest("[data-reader-share-close]")) $("#readerShareFallback").hidden = true;
      if (event.target.closest("[data-reader-retry]")) load();
    });
    addEventListener("scroll", () => {
      if (!updateProgress.frame) updateProgress.frame = requestAnimationFrame(updateProgress);
    }, { passive: true });
    addEventListener("resize", updateProgress, { passive: true });
    addEventListener("blog-auth-change", syncAccount);
    syncAccount();
    updateProgress();
    load();
  }

  window.blogReader = {
    active,
    get ready() { return state.ready; },
    owns,
    mount,
    navigate,
    contentReady,
    fail,
    share,
    reload: load
  };
  document.addEventListener("DOMContentLoaded", init, { once: true });
})();
