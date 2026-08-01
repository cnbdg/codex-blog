(() => {
  "use strict";
  const $ = selector => document.querySelector(selector);
  let records = [];
  let activeId = null;
  let selectedMember = null;

  function adminError(message = "") {
    const target = $("#memberAdminError");
    if (!target) return;
    target.textContent = message;
    target.hidden = !message;
  }

  function renderMemberPreview(member) {
    const target = $("#adminMemberPreview");
    selectedMember = member || null;
    target.hidden = !member;
    if (!member) { target.innerHTML = ""; return; }
    const name = escapeText(member.username || "社区用户");
    const restricted = Boolean(member.restricted ?? member.banned);
    target.innerHTML = `<div class="owner-preview-avatar">${name.charAt(0).toUpperCase()}</div><div><strong>${name}</strong><span>UID ${member.user_uid || "—"} · ${escapeText(member.display_title || "社区成员")}</span><small>${member.is_admin ? "管理员" : "普通用户"}${restricted ? " · 当前受限" : " · 状态正常"}${member.strike_count != null ? ` · ${member.strike_count} 条违规记录` : ""}</small></div>`;
    const form = $("#memberAdminForm");
    form.elements.title.value = member.display_title || "社区成员";
    form.elements.role_action.value = "keep";
  }

  async function lookupMember() {
    const form = $("#memberAdminForm");
    const uid = Number(form.elements.uid.value);
    if (!Number.isInteger(uid) || uid < 1) return adminError("请输入有效的用户 UID");
    const button = $("#memberLookupBtn");
    button.disabled = true;
    button.textContent = "读取中…";
    adminError();
    const result = await window.blogAuth.getAdminMemberByUid(uid);
    button.disabled = false;
    button.textContent = "读取用户";
    if (!result.member) { renderMemberPreview(null); return adminError(result.error || "找不到这个 UID 对应的用户"); }
    renderMemberPreview(result.member);
  }

  async function loadOwnerHealth() {
    const target = $("#ownerHealthSummary");
    if (!target) return;
    target.innerHTML = `<p>正在检查治理系统…</p>`;
    const result = await window.blogAuth.getGovernanceOverview();
    if (!result.data) {
      target.innerHTML = `<p class="owner-health-error">${escapeText(result.error || "治理系统尚未启用")}</p><small>请在 Supabase SQL Editor 执行 governance.sql。</small>`;
      return;
    }
    const row = result.data;
    target.innerHTML = `<div><strong>${row.pending_reports}</strong><span>待处理举报</span></div><div><strong>${row.restricted_users}</strong><span>受限用户</span></div><div><strong>${row.pending_appeals}</strong><span>待处理申诉</span></div><div><strong>${row.actions_today}</strong><span>今日操作</span></div>`;
  }

  function openMemberAdmin(uid = "") {
    if (!window.blogAuth?.isAdmin) return window.blogAuth?.openAuth();
    const form = $("#memberAdminForm");
    form.reset();
    selectedMember = null;
    renderMemberPreview(null);
    adminError();
    if (uid) form.elements.uid.value = uid;
    $("#memberAdminDialog").showModal();
    window.blogAuth.prepareAdminCaptcha?.();
    loadOwnerHealth();
    if (uid) lookupMember();
    else setTimeout(() => form.elements.uid.focus(), 40);
  }

  function init() {
    $("#adminMemberBtn")?.addEventListener("click", () => openMemberAdmin());
    $("#memberLookupBtn")?.addEventListener("click", lookupMember);
    $("#memberAdminForm")?.elements.uid.addEventListener("change", () => { selectedMember = null; renderMemberPreview(null); });
    $("#memberAdminForm")?.addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const password = form.elements.password.value;
      const uid = Number(form.elements.uid.value);
      const title = form.elements.title.value.trim();
      const roleAction = form.elements.role_action.value;
      if (!selectedMember || Number(selectedMember.user_uid) !== uid) { await lookupMember(); if (!selectedMember) return; }
      if (roleAction === "demote" && !confirm(`确认将 ${selectedMember.username} 降为普通用户吗？该用户将立即失去全部管理权限。`)) return;
      if (!window.blogAuth.adminCaptchaReady) return adminError("请先完成管理员人机验证");
      const button = form.querySelector("button[type=submit]");
      button.disabled = true;
      button.textContent = "正在验证并保存…";
      if (!await window.blogAuth.confirmAdminPassword(password)) { button.disabled = false; button.textContent = "保存身份设置"; return adminError("密码验证失败，未执行任何操作"); }
      const ok = await window.blogAuth.adminManageMember(selectedMember.user_id || selectedMember.id, title, roleAction);
      button.disabled = false;
      button.textContent = "保存身份设置";
      if (!ok) return;
      window.toast?.("用户身份与头衔已更新");
      await lookupMember();
      await loadOwnerHealth();
    });
    $("#ownerOpenModerationBtn")?.addEventListener("click", () => {
      $("#memberAdminDialog").close();
      window.showPage?.("admin", true);
      setTimeout(() => $("#moderationPanel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
    });
    $("#governanceCleanupBtn")?.addEventListener("click", async () => {
      const form = $("#memberAdminForm");
      if (!form.elements.password.value) return adminError("执行维护前请输入管理员密码");
      if (!window.blogAuth.adminCaptchaReady) return adminError("请先完成管理员人机验证");
      if (!confirm("确认关闭所有已经到期的用户限制吗？该操作不会删除历史记录。")) return;
      const button = $("#governanceCleanupBtn");
      button.disabled = true;
      button.textContent = "维护中…";
      if (!await window.blogAuth.confirmAdminPassword(form.elements.password.value)) {
        button.disabled = false; button.textContent = "清理过期限制"; return adminError("密码验证失败，未执行维护");
      }
      const result = await window.blogAuth.runGovernanceMaintenance();
      button.disabled = false;
      button.textContent = "清理过期限制";
      if (!result.data) return adminError(result.error || "治理维护失败");
      window.toast?.(`维护完成：关闭 ${result.data.expired_restrictions_closed} 条过期限制`);
      adminError();
      await loadOwnerHealth();
      window.refreshGovernance?.();
    });
    $("#newPostBtn").addEventListener("click", () => {
      if (!window.blogAuth?.isAdmin) return window.blogAuth?.openAuth();
      resetEditor();
      $("#postEditor input[name=title]").focus();
    });
    $("#adminGateAction").addEventListener("click", async () => {
      if (!window.blogAuth?.user) return window.blogAuth?.openAuth();
      $("#adminGateAction").disabled = true;
      $("#adminGateAction").textContent = "正在检查…";
      await window.blogAuth.refreshProfile();
      $("#adminGateAction").disabled = false;
      $("#adminGateAction").textContent = window.blogAuth.isAdmin ? "权限已确认" : "重新检查权限";
      if (!window.blogAuth.isAdmin) window.toast("当前账号没有管理员权限，请确认登录的是“博客主”账号");
    });
    $("#refreshPostsBtn").addEventListener("click", loadPosts);
    $("#importPostsBtn").addEventListener("click", importLegacyPosts);
    $("#cancelEditBtn").addEventListener("click", resetEditor);
    $("#deletePostBtn").addEventListener("click", removePost);
    $("#postEditor").addEventListener("submit", savePost);
    $("#postBody").addEventListener("input", renderPreview);
    $(".markdown-toolbar").addEventListener("click", handleMarkdownTool);
    $("#adminPostList").addEventListener("click", event => {
      const item = event.target.closest("[data-admin-id]");
      if (item) editPost(Number(item.dataset.adminId));
    });
    window.addEventListener("blog-auth-change", updateAccess);
    updateAccess();
    resetEditor();
  }

  async function importLegacyPosts() {
    if (!window.blogAuth?.isAdmin) return window.blogAuth?.openAuth();
    const source = Array.isArray(window.LEGACY_POSTS) ? window.LEGACY_POSTS : [];
    if (!source.length) return window.toast("旧博客迁移包没有加载成功，请刷新后重试");
    const latestRecords = await window.blogAuth.listAllPosts();
    const existing = new Set(latestRecords.map(post => `${post.published_at}::${post.title.trim().toLowerCase()}`));
    const pending = source.filter(post => !existing.has(`${post.published_at}::${post.title.trim().toLowerCase()}`));
    if (!pending.length) return window.toast("18 篇旧文章都已经导入，无需重复操作");
    if (!confirm(`将导入 ${pending.length} 篇旧博客文章并立即发布。已存在的同名同日期文章会自动跳过，是否继续？`)) return;

    const button = $("#importPostsBtn");
    button.disabled = true;
    button.textContent = `正在导入 ${pending.length} 篇…`;
    const imported = await window.blogAuth.importPosts(pending);
    button.disabled = false;
    button.textContent = "⇣ 导入旧博客（18）";
    if (!imported) return;

    window.toast(`成功导入 ${imported.length} 篇旧文章`);
    await loadPosts();
    await window.refreshRemotePosts?.();
  }

  function renderPreview() {
    const source = $("#postBody").value;
    $("#markdownPreview").innerHTML = source
      ? window.blogMarkdown.render(source)
      : `<p class="preview-empty">预览会随着输入实时更新。</p>`;
  }

  function handleMarkdownTool(event) {
    const button = event.target.closest("button");
    if (!button) return;
    const editor = $("#postBody");
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selected = editor.value.slice(start, end);
    let replacement = selected;
    if (button.dataset.mdPrefix) {
      replacement = selected
        ? selected.split("\n").map(line => button.dataset.mdPrefix + line).join("\n")
        : button.dataset.mdPrefix;
    } else if (button.dataset.mdWrap) {
      replacement = `${button.dataset.mdWrap}${selected || "文字"}${button.dataset.mdWrap}`;
    } else if (button.hasAttribute("data-md-code")) {
      replacement = `\`\`\`\n${selected || "代码"}\n\`\`\``;
    } else if (button.hasAttribute("data-md-link")) {
      replacement = `[${selected || "链接文字"}](https://)`;
    }
    editor.setRangeText(replacement, start, end, "select");
    editor.focus();
    renderPreview();
  }

  async function updateAccess() {
    const admin = Boolean(window.blogAuth?.isAdmin);
    $("#adminGate").hidden = admin;
    $("#adminWorkspace").hidden = !admin;
    $("#newPostBtn").hidden = !admin;
    $("#importPostsBtn").hidden = !admin;
    if (!admin) {
      const signedIn = Boolean(window.blogAuth?.user);
      $("#adminGateTitle").textContent = signedIn ? "尚未识别管理员权限" : "仅管理员可访问";
      $("#adminGateText").textContent = signedIn ? "当前账号已登录，可以重新读取一次权限。" : "请先使用“博客主”管理员账号登录。";
      $("#adminGateAction").textContent = signedIn ? "重新检查权限" : "登录";
    }
    if (admin) await loadPosts();
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
    renderPreview();
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
    renderPreview();
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
  window.openMemberAdmin = openMemberAdmin;
})();
