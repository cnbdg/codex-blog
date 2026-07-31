(() => {
  "use strict";
  const $ = selector => document.querySelector(selector);
  let records = [];
  let activeId = null;

  function init() {
    $("#newPostBtn").addEventListener("click", () => {
      if (!window.blogAuth?.isAdmin) return window.blogAuth?.openAuth();
      resetEditor();
      $("#postEditor input[name=title]").focus();
    });
    $("#refreshPostsBtn").addEventListener("click", loadPosts);
    $("#cancelEditBtn").addEventListener("click", resetEditor);
    $("#deletePostBtn").addEventListener("click", removePost);
    $("#postEditor").addEventListener("submit", savePost);
    $("#adminPostList").addEventListener("click", event => {
      const item = event.target.closest("[data-admin-id]");
      if (item) editPost(Number(item.dataset.adminId));
    });
    window.addEventListener("blog-auth-change", updateAccess);
    updateAccess();
    resetEditor();
  }

  async function updateAccess() {
    const admin = Boolean(window.blogAuth?.isAdmin);
    $("#adminGate").hidden = admin;
    $("#adminWorkspace").hidden = !admin;
    $("#newPostBtn").hidden = !admin;
    if (admin) await loadPosts();
    else if (location.hash === "#admin") showPage("home");
  }

  async function loadPosts() {
    if (!window.blogAuth?.isAdmin) return;
    $("#adminPostList").innerHTML = `<p class="search-hint">正在加载…</p>`;
    records = await window.blogAuth.listAllPosts();
    renderList();
  }

  function renderList() {
    $("#adminPostList").innerHTML = records.length
      ? records.map(post => `<article class="admin-list-item ${activeId===post.id?"active":""}" data-admin-id="${post.id}"><strong>${escapeText(post.title)}</strong><div><span class="status-badge ${post.status}">${post.status==="published"?"已发布":"草稿"}</span><time>${post.published_at}</time></div></article>`).join("")
      : `<p class="search-hint">还没有云端文章，点击“新建文章”开始写作。</p>`;
  }

  function editPost(id) {
    const post = records.find(item => item.id === id);
    if (!post) return;
    activeId = id;
    const form = $("#postEditor");
    form.elements.id.value = post.id;
    form.elements.title.value = post.title;
    form.elements.published_at.value = post.published_at;
    form.elements.description.value = post.description;
    form.elements.type.value = post.type;
    form.elements.tags.value = (post.tags || []).join(", ");
    form.elements.read_time.value = post.read_time || "";
    form.elements.lead.value = post.lead;
    form.elements.body.value = post.body;
    form.elements.status.value = post.status;
    $("#editorMode").textContent = "EDIT POST";
    $("#editorTitle").textContent = "编辑文章";
    $("#deletePostBtn").hidden = false;
    $("#saveState").textContent = post.updated_at ? `上次保存 ${formatTime(post.updated_at)}` : "";
    renderList();
    if (innerWidth < 900) form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function resetEditor() {
    activeId = null;
    const form = $("#postEditor");
    form.reset();
    form.elements.id.value = "";
    form.elements.published_at.value = new Date().toISOString().slice(0, 10);
    form.elements.read_time.value = "5 分钟";
    $("#editorMode").textContent = "NEW POST";
    $("#editorTitle").textContent = "新建文章";
    $("#deletePostBtn").hidden = true;
    $("#saveState").textContent = "";
    renderList();
  }

  async function savePost(event) {
    event.preventDefault();
    if (!window.blogAuth?.isAdmin) return;
    const form = event.currentTarget;
    if (!form.checkValidity()) return form.reportValidity();
    const data = new FormData(form);
    const payload = {
      title: data.get("title").trim(),
      description: data.get("description").trim(),
      type: data.get("type").trim(),
      tags: data.get("tags").split(/[,，]/).map(tag => tag.trim()).filter(Boolean),
      read_time: data.get("read_time").trim() || "5 分钟",
      lead: data.get("lead").trim(),
      body: data.get("body").trim(),
      status: data.get("status"),
      published_at: data.get("published_at")
    };
    const button = $("#savePostBtn");
    button.disabled = true;
    button.textContent = "正在保存…";
    const saved = await window.blogAuth.savePost(payload, activeId);
    button.disabled = false;
    button.textContent = "保存文章";
    if (!saved) return;
    activeId = saved.id;
    window.toast(saved.status === "published" ? "文章已发布" : "草稿已保存");
    await loadPosts();
    editPost(saved.id);
    await window.refreshRemotePosts?.();
  }

  async function removePost() {
    if (!activeId) return;
    const post = records.find(item => item.id === activeId);
    if (!confirm(`确定删除《${post?.title || "这篇文章"}》吗？此操作无法恢复。`)) return;
    const button = $("#deletePostBtn");
    button.disabled = true;
    const removed = await window.blogAuth.deletePost(activeId);
    button.disabled = false;
    if (!removed) return;
    window.toast("文章已删除");
    resetEditor();
    await loadPosts();
    await window.refreshRemotePosts?.();
  }

  function formatTime(value) {
    return new Date(value).toLocaleString("zh-CN", { hour12: false });
  }

  function escapeText(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    })[char]);
  }

  document.addEventListener("DOMContentLoaded", init, { once: true });
})();
