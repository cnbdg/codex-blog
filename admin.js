(() => {
  "use strict";
  const $ = selector => document.querySelector(selector);
  let records = [];
  let activeId = null;
  let selectedMember = null;
  let publicationRequest = 0;
  let listRequest = 0;
  let savedPublication = null;
  let saving = false;
  let dirty = false;
  let recoveryTimer = 0;
  const recoveryPrefix = "cnbdg-admin-draft-v2";
  const postDateKey = value => (window.blogPostTime?.format?.(value) || String(value || "")).slice(0, 10);

  function recoveryKey() {
    return `${recoveryPrefix}:${window.blogAuth?.user?.id || "admin"}`;
  }

  function setCloudState(state, message) {
    const target = $("#adminCloudState");
    if (!target) return;
    target.dataset.state = state;
    const copy = target.querySelector("span");
    if (copy) copy.textContent = message;
  }

  function setAdminView(view = "content", { focus = false } = {}) {
    const workspace = $("#adminWorkspace");
    if (!workspace || !window.blogAuth?.isAdmin) return;
    const next = view === "governance" ? "governance" : "content";
    workspace.dataset.adminView = next;
    $("#adminContentArea").hidden = next !== "content";
    $("#moderationPanel").hidden = next !== "governance";
    document.querySelectorAll(".admin-quick-actions [data-admin-jump]").forEach(button => {
      const selected = button.dataset.adminJump === (next === "content" ? "adminContentArea" : "moderationPanel");
      if (selected) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    if (next === "governance") window.refreshGovernance?.();
    if (focus) (next === "content" ? $("#adminContentArea") : $("#moderationPanel"))?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function setEditorPane(pane = "write") {
    const workspace = $("#adminWorkspace");
    if (!workspace) return;
    workspace.dataset.editorPane = pane === "preview" ? "preview" : "write";
    document.querySelectorAll(".editor-pane-switch [data-editor-pane]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.editorPane === workspace.dataset.editorPane)));
  }

  function updateEditorInsights() {
    const source = $("#postBody")?.value || "";
    const readable = source.replace(/```[\s\S]*?```/g, " ").replace(/[`*_>#\[\]()!~-]/g, " ").replace(/https?:\/\/\S+/g, " ");
    const characters = [...readable].filter(char => !/\s/.test(char)).length;
    if ($("#editorCharacterCount")) $("#editorCharacterCount").textContent = characters.toLocaleString("zh-CN");
    if ($("#editorReadingTime")) $("#editorReadingTime").textContent = Math.max(1, Math.ceil(characters / 400));
  }

  function captureRecovery() {
    const form = $("#postEditor");
    if (!form) return null;
    const fields = {};
    ["id", "title", "published_at", "description", "type", "tags", "read_time", "lead", "body", "status"].forEach(name => { fields[name] = form.elements[name]?.value || ""; });
    if (!fields.title.trim() && !fields.body.trim() && !fields.description.trim()) return null;
    return { version: 2, activeId, savedAt: Date.now(), fields };
  }

  function saveRecovery() {
    if (!dirty || !window.blogAuth?.isAdmin) return;
    const snapshot = captureRecovery();
    try {
      if (snapshot) localStorage.setItem(recoveryKey(), JSON.stringify(snapshot));
    } catch {}
  }

  function scheduleRecovery() {
    clearTimeout(recoveryTimer);
    recoveryTimer = setTimeout(saveRecovery, 450);
  }

  function readRecovery() {
    try {
      const snapshot = JSON.parse(localStorage.getItem(recoveryKey()) || "null");
      return snapshot?.version === 2 && snapshot.fields ? snapshot : null;
    } catch { return null; }
  }

  function clearRecovery() {
    clearTimeout(recoveryTimer);
    try { localStorage.removeItem(recoveryKey()); } catch {}
    $("#adminDraftRecovery")?.setAttribute("hidden", "");
  }

  function updateRecoveryBanner() {
    const panel = $("#adminDraftRecovery");
    const snapshot = readRecovery();
    if (!panel) return;
    panel.hidden = !snapshot;
    if (!snapshot) return;
    const stamp = formatTime(snapshot.savedAt);
    $("#adminDraftRecoveryTime").textContent = `${stamp} 自动保存在这台设备，可恢复后继续编辑。`;
  }

  function restoreRecovery() {
    const snapshot = readRecovery();
    if (!snapshot) return updateRecoveryBanner();
    const form = $("#postEditor");
    Object.entries(snapshot.fields).forEach(([name, value]) => { if (form.elements[name]) form.elements[name].value = value; });
    activeId = snapshot.activeId == null ? null : Number(snapshot.activeId);
    const cloudPost = records.find(post => Number(post.id) === activeId);
    $("#editorMode").textContent = "RECOVERED DRAFT";
    $("#editorTitle").textContent = activeId ? "恢复编辑内容" : "恢复未发布内容";
    $("#deletePostBtn").hidden = !cloudPost;
    $("#saveState").textContent = "已恢复本机内容，尚未保存到云端";
    panelHide("#adminDraftRecovery");
    dirty = true;
    renderPreview();
    showPublication(cloudPost || null);
    ++publicationRequest;
    publicationState("warning", "已恢复本机版本", "恢复的修改尚未保存到云端；确认内容后请保存，其他设备才会看到新版本。");
    updateSaveButton();
    setEditorPane("write");
    form.elements.title.focus();
  }

  function panelHide(selector) {
    const node = $(selector);
    if (node) node.hidden = true;
  }

  function markEditorChanged() {
    dirty = true;
    $("#saveState").textContent = "有未保存修改 · 已在本机备份";
    if (savedPublication) {
      ++publicationRequest;
      publicationState("warning", "当前修改尚未保存", "云端仍是上一次保存的版本。完成编辑后请保存，再检查公开访问。");
    }
    updateSaveButton();
    updateEditorInsights();
    scheduleRecovery();
  }

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
    const form = $("#memberAdminForm");
    const roleSelect = form?.elements.role_action;
    const titleInput = form?.elements.title;
    const submitButton = form?.querySelector(".dialog-actions .primary-btn");
    const roleHint = $("#ownerRoleHint");
    if (!member) {
      target.innerHTML = "";
      target.classList.remove("is-owner");
      if (roleSelect) { roleSelect.disabled = false; roleSelect.value = "keep"; }
      if (titleInput) titleInput.disabled = false;
      if (submitButton) submitButton.disabled = false;
      if (roleHint) roleHint.textContent = "保持角色不会意外降级；选择“降为普通用户”时会再次确认。";
      return;
    }
    const name = escapeText(member.username || "社区用户");
    const restricted = Boolean(member.restricted ?? member.banned);
    const permanentOwner = Boolean(member.is_owner);
    const ownOwnerAccount = permanentOwner && member.user_id === window.blogAuth?.user?.id;
    target.classList.toggle("is-owner", permanentOwner);
    target.innerHTML = `<div class="owner-preview-avatar">${name.charAt(0).toUpperCase()}</div><div><div class="owner-preview-name"><strong>${name}</strong>${permanentOwner ? '<b>永久站长</b>' : member.is_admin ? '<b class="admin">管理员</b>' : ""}</div><span>UID ${member.user_uid || "—"} · ${escapeText(member.display_title || "社区成员")}</span><small>${permanentOwner ? "数据库永久保护" : member.is_admin ? "管理员" : "普通用户"}${restricted ? " · 当前受限" : " · 状态正常"}${member.strike_count != null ? ` · ${member.strike_count} 条违规记录` : ""}</small></div>`;
    form.elements.title.value = member.display_title || "社区成员";
    form.elements.role_action.value = "keep";
    roleSelect.disabled = permanentOwner;
    titleInput.disabled = permanentOwner && !ownOwnerAccount;
    if (submitButton) submitButton.disabled = permanentOwner && !ownOwnerAccount;
    if (roleHint) roleHint.textContent = permanentOwner
      ? ownOwnerAccount
        ? "这是你的永久站长账号：管理员角色已锁定，只能保持；仍可修改自己的展示头衔。"
        : "该账号是永久站长，不能由其他管理员降级、删除或修改身份。"
      : "保持角色不会意外降级；选择“降为普通用户”时会再次确认。";
  }

  function syncOwnerProtectionUI() {
    const currentProfile = window.blogAuth?.profile;
    const isOwner = Boolean(window.blogAuth?.isOwner);
    const name = currentProfile?.username || window.blogAuth?.user?.user_metadata?.username || "管理员";
    if ($("#adminIdentityName")) $("#adminIdentityName").textContent = name;
    if ($("#adminIdentityRole")) {
      $("#adminIdentityRole").textContent = isOwner ? "永久站长" : "管理员";
      $("#adminIdentityRole").classList.toggle("is-owner", isOwner);
    }
    if ($("#adminOwnerStatus")) $("#adminOwnerStatus").textContent = isOwner
      ? "身份已由数据库永久锁定，其他管理员无法降级或删除。"
      : "当前拥有管理权限，但尚未检测到永久站长保护。";
    if ($("#adminProtectionState")) {
      $("#adminProtectionState").textContent = isOwner ? "已锁定" : "待启用";
      $("#adminProtectionState").classList.toggle("is-owner", isOwner);
    }
    const banner = $("#ownerProtectionBanner");
    if (banner) banner.dataset.state = isOwner ? "protected" : "pending";
    if ($("#ownerProtectionTitle")) $("#ownerProtectionTitle").textContent = isOwner ? "永久站长保护已启用" : "永久站长保护尚未启用";
    if ($("#ownerProtectionText")) $("#ownerProtectionText").textContent = isOwner
      ? "你的账号已绑定不可变用户 UUID，其他管理员无法降级、删除或修改你的身份。"
      : "请在 Supabase SQL Editor 执行 permanent-owner.sql，完成数据库级身份锁定。";
    if ($("#ownerProtectionBadge")) $("#ownerProtectionBadge").textContent = isOwner ? "受保护" : "待升级";
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
    syncOwnerProtectionUI();
    if (window.blogUI?.openDialog) window.blogUI.openDialog($("#memberAdminDialog"));
    else $("#memberAdminDialog").showModal();
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
      if (selectedMember.is_owner && selectedMember.user_id !== window.blogAuth?.user?.id) return adminError("永久站长账号不能由其他管理员修改");
      if (selectedMember.is_owner && roleAction !== "keep") return adminError("永久站长角色已锁定，不能降级或重新分配");
      if (roleAction === "demote" && !confirm(`确认将 ${selectedMember.username} 降为普通用户吗？该用户将立即失去全部管理权限。`)) return;
      if (!window.blogAuth.adminCaptchaReady) return adminError("请先完成管理员人机验证");
      const button = form.querySelector("button[type=submit], .dialog-actions .primary-btn");
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
      if (window.blogUI?.closeDialog) window.blogUI.closeDialog($("#memberAdminDialog"));
      else $("#memberAdminDialog").close();
      window.showPage?.("admin", true);
      setTimeout(() => $("#moderationPanel")?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
    });
    $(".admin-quick-actions")?.addEventListener("click", event => {
      const button = event.target.closest("[data-admin-jump]");
      if (!button) return;
      if (button.dataset.adminJump === "member") return openMemberAdmin();
      setAdminView(button.dataset.adminJump === "moderationPanel" ? "governance" : "content", { focus: true });
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
      setAdminView("content");
      resetEditor(true);
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
    $("#adminPostSearch").addEventListener("input", renderList);
    $("#adminPostFilter").addEventListener("change", renderList);
    $("#checkPublishedPostBtn").addEventListener("click", () => verifyPublication(savedPublication));
    $("#copyPublishedPostBtn").addEventListener("click", async () => {
      const input = $("#publishedPostUrl");
      try { await navigator.clipboard.writeText(input.value); window.toast?.("文章链接已复制，可发到其他设备打开"); }
      catch { input.focus(); input.select(); window.toast?.("请复制已选中的文章地址"); }
    });
    $("#importPostsBtn").addEventListener("click", importLegacyPosts);
    $("#cancelEditBtn").addEventListener("click", () => resetEditor(true));
    $("#restoreAdminDraftBtn").addEventListener("click", restoreRecovery);
    $("#discardAdminDraftBtn").addEventListener("click", () => { clearRecovery(); window.toast?.("已放弃这台设备上的备份"); });
    $("#deletePostBtn").addEventListener("click", removePost);
    $("#postEditor").addEventListener("submit", savePost);
    $("#postEditor").addEventListener("input", event => {
      if (event.target.closest("#postPublicationStatus")) return;
      markEditorChanged();
    });
    $("#postEditor").elements.status.addEventListener("change", markEditorChanged);
    $("#postBody").addEventListener("input", renderPreview);
    $(".editor-pane-switch").addEventListener("click", event => {
      const button = event.target.closest("[data-editor-pane]");
      if (button) setEditorPane(button.dataset.editorPane);
    });
    $(".markdown-toolbar").addEventListener("click", handleMarkdownTool);
    $("#adminPostList").addEventListener("click", event => {
      const item = event.target.closest("[data-admin-id]");
      if (item) editPost(Number(item.dataset.adminId));
    });
    window.addEventListener("blog-auth-change", updateAccess);
    window.addEventListener("keydown", event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && $("#admin")?.classList.contains("active")) {
        event.preventDefault();
        if (!saving) $("#postEditor").requestSubmit();
      }
    });
    window.addEventListener("beforeunload", event => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    });
    resetEditor(false);
    updateAccess();
  }

  async function importLegacyPosts() {
    if (!window.blogAuth?.isAdmin) return window.blogAuth?.openAuth();
    const source = Array.isArray(window.LEGACY_POSTS) ? window.LEGACY_POSTS : [];
    if (!source.length) return window.toast("旧博客迁移包没有加载成功，请刷新后重试");
    const latestRecords = await window.blogAuth.listAllPosts();
    const existing = new Set(latestRecords.map(post => `${postDateKey(post.published_at)}::${post.title.trim().toLowerCase()}`));
    const pending = source.filter(post => !existing.has(`${postDateKey(post.published_at)}::${post.title.trim().toLowerCase()}`));
    if (!pending.length) return window.toast("18 篇旧文章都已经导入，无需重复操作");
    if (!confirm(`将导入 ${pending.length} 篇旧博客文章并立即发布。已存在的同名同日期文章会自动跳过，是否继续？`)) return;

    const button = $("#importPostsBtn");
    button.disabled = true;
    button.textContent = `正在导入 ${pending.length} 篇…`;
    const imported = await window.blogAuth.importPosts(pending.map(post => ({ ...post, published_at: window.blogPostTime?.toStorage?.(post.published_at) || post.published_at })));
    button.disabled = false;
    button.textContent = "导入旧文章";
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
    updateEditorInsights();
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
    markEditorChanged();
  }

  async function updateAccess() {
    const admin = Boolean(window.blogAuth?.isAdmin);
    $("#adminGate").hidden = admin;
    $("#adminWorkspace").hidden = !admin;
    $("#newPostBtn").hidden = !admin;
    $("#importPostsBtn").hidden = !admin;
    $("#adminMemberBtn").hidden = !admin;
    if (admin) {
      syncOwnerProtectionUI();
      updateRecoveryBanner();
      setAdminView($("#adminWorkspace").dataset.adminView || "content");
      setCloudState("syncing", "正在同步云端");
    }
    if (!admin) {
      const signedIn = Boolean(window.blogAuth?.user);
      $("#adminGateTitle").textContent = signedIn ? "尚未识别管理员权限" : "仅管理员可访问";
      $("#adminGateText").textContent = signedIn ? "当前账号已登录，可以重新读取一次权限。" : "请先使用“博客主”管理员账号登录。";
      $("#adminGateAction").textContent = signedIn ? "重新检查权限" : "登录";
      setCloudState("idle", signedIn ? "等待权限确认" : "尚未登录");
    }
    if (admin) await loadPosts();
  }

  async function loadPosts() {
    if (!window.blogAuth?.isAdmin) return;
    const request = ++listRequest;
    setCloudState("syncing", "正在同步文章");
    $("#adminPostList").innerHTML = `<p class="search-hint">正在加载…</p>`;
    try {
      const rows = await window.blogAuth.listAllPosts();
      if (request !== listRequest) return;
      if (window.blogAuth.lastAdminPostsError) throw new Error(window.blogAuth.lastAdminPostsError);
      records = rows || [];
      renderList();
      setCloudState("online", "云端已连接");
    } catch (error) {
      if (request === listRequest) {
        $("#adminPostList").innerHTML = `<p class="search-hint">${escapeText(error?.message || "文章列表加载失败")}。请点击刷新重试，编辑中的内容不会清空。</p>`;
        setCloudState("error", "同步失败，可重试");
      }
    }
  }

  function renderList() {
    const query = $("#adminPostSearch").value.trim().toLocaleLowerCase("zh-CN");
    const status = $("#adminPostFilter").value;
    const rows = records.filter(post => (status === "all" || post.status === status)
      && `${post.title} ${post.type}`.toLocaleLowerCase("zh-CN").includes(query));
    const published = records.filter(post => post.status === "published").length;
    if ($("#adminPostCount")) $("#adminPostCount").textContent = records.length;
    if ($("#adminPublishedCount")) $("#adminPublishedCount").textContent = published;
    if ($("#adminDraftCount")) $("#adminDraftCount").textContent = records.length - published;
    $("#adminListSummary").textContent = `${published} 篇已发布 · ${records.length - published} 篇草稿 · 当前 ${rows.length} 篇`;
    $("#adminPostList").innerHTML = rows.length
      ? rows.map(post => `<button type="button" class="admin-list-item ${activeId===post.id?"active":""}" data-admin-id="${post.id}"${activeId===post.id?' aria-current="true"':""}><strong>${escapeText(post.title)}</strong><span class="admin-item-meta"><span class="status-badge ${post.status === "published" ? "published" : "draft"}">${post.status==="published"?"已发布":"草稿"}</span><time datetime="${escapeText(window.blogPostTime?.toAttribute?.(post.published_at) || post.published_at)}">${escapeText(window.blogPostTime?.format?.(post.published_at) || post.published_at)}</time></span></button>`).join("")
      : `<p class="search-hint">${records.length ? "没有匹配的文章，可以清空搜索或切换状态。" : "还没有云端文章，点击“新建文章”开始写作。"}</p>`;
  }

  function editPost(id) {
    if (saving) return;
    const post = records.find(item => item.id === id);
    if (!post) return;
    activeId = id;
    const form = $("#postEditor");
    form.elements.id.value = post.id;
    form.elements.title.value = post.title;
    form.elements.published_at.value = window.blogPostTime?.toEditor?.(post.published_at) || String(post.published_at).slice(0, 16);
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
    dirty = false;
    renderList();
    renderPreview();
    showPublication(post);
    updateSaveButton();
    updateRecoveryBanner();
    if (innerWidth < 900) form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function resetEditor(clearLocal = false) {
    if (saving) return;
    if (clearLocal) clearRecovery();
    activeId = null;
    dirty = false;
    const form = $("#postEditor");
    form.reset();
    form.elements.id.value = "";
    form.elements.published_at.value = window.blogPostTime?.toEditor?.(new Date()) || new Date().toISOString().slice(0, 19);
    form.elements.read_time.value = "5 分钟";
    $("#editorMode").textContent = "NEW POST";
    $("#editorTitle").textContent = "新建文章";
    $("#deletePostBtn").hidden = true;
    $("#saveState").textContent = "";
    showPublication(null);
    updateSaveButton();
    renderList();
    renderPreview();
    setEditorPane("write");
    if (!clearLocal) updateRecoveryBanner();
  }

  async function savePost(event) {
    event.preventDefault();
    if (saving || !window.blogAuth?.isAdmin) return;
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
      published_at: window.blogPostTime?.toStorage?.(data.get("published_at")) || data.get("published_at")
    };
    const button = $("#savePostBtn");
    saving = true;
    setCloudState("syncing", "正在保存到云端");
    const controls = [...form.querySelectorAll("input, textarea, select, button")].map(control => [control, control.disabled]);
    controls.forEach(([control]) => { control.disabled = true; });
    form.setAttribute("aria-busy", "true");
    button.textContent = "正在保存…";
    let saved;
    try {
      saved = await window.blogAuth.savePost(payload, activeId);
      if (!saved) { $("#saveState").textContent = "保存未成功，编辑内容已保留"; setCloudState("error", "保存失败，可重试"); return; }
    } catch {
      $("#saveState").textContent = "保存失败，请检查网络。编辑内容已保留。";
      setCloudState("error", "保存失败，可重试");
      return;
    } finally {
      saving = false;
      controls.forEach(([control, disabled]) => { control.disabled = disabled; });
      form.removeAttribute("aria-busy");
      updateSaveButton();
    }
    // Use the confirmed database row immediately. A slow list refresh must not
    // hide a successful save or prevent sharing the new article.
    ++listRequest;
    records = [saved, ...records.filter(post => Number(post.id) !== Number(saved.id))];
    dirty = false;
    clearRecovery();
    setCloudState("online", saved.status === "published" ? "文章已发布" : "草稿已保存");
    window.toast(saved.status === "published" ? "文章已发布" : "草稿已保存");
    editPost(saved.id);
    Promise.resolve().then(() => window.refreshRemotePosts?.({
      revealId: saved.status === "published" ? saved.id : null
    })).catch(() => {});
  }

  function updateSaveButton() {
    if (saving) return;
    $("#savePostBtn").textContent = $("#postEditor").elements.status.value === "published"
      ? (activeId ? "保存并更新文章" : "发布文章") : "保存草稿";
  }

  function publicationState(state, title, description) {
    $("#postPublicationStatus").dataset.state = state;
    $("#publicationTitle").textContent = title;
    $("#publicationDescription").textContent = description;
  }

  function showPublication(post) {
    ++publicationRequest;
    savedPublication = post;
    $("#publicationTools").hidden = !post || post.status !== "published";
    $("#checkPublishedPostBtn").disabled = false;
    if (!post) return publicationState("new", "新文章尚未保存", "编辑内容尚未写入云端，其他设备暂时无法查看。");
    if (post.status !== "published") return publicationState("draft", "草稿已保存到云端", "草稿仅管理员可见。选择公开发布并保存后，其他设备才可以阅读。");
    const url = window.blogContentLinks.article({ dbId: post.id });
    $("#publishedPostUrl").value = url;
    $("#viewPublishedPost").href = url;
    verifyPublication(post);
  }

  async function verifyPublication(post) {
    if (!post || post.status !== "published") return;
    const request = ++publicationRequest;
    $("#checkPublishedPostBtn").disabled = true;
    publicationState("checking", "文章已保存到云端", "正在以未登录身份检查公开正文，不使用这台设备的登录信息…");
    try {
      const result = await window.blogAuth.getPublishedPost(post.id);
      if (request !== publicationRequest) return;
      if (result?.row && result.row.body === post.body && result.row.title === post.title) {
        publicationState("public", "公开访问检查通过", "未登录访客可读取当前正文。可以复制链接到其他设备打开，无需重新构建。");
      } else {
        publicationState("warning", "已保存，公开访问仍需检查", result?.error || "暂未读取到当前公开版本。请检查发布状态或稍后重新检查，不要重复新建文章。");
      }
    } catch {
      if (request === publicationRequest) publicationState("warning", "已保存，暂时无法验证公开访问", "请检查网络后重新检查；这不代表云端保存失败，无需重复发布。");
    } finally {
      if (request === publicationRequest) $("#checkPublishedPostBtn").disabled = false;
    }
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
    resetEditor(true);
    setCloudState("online", "文章已删除");
    await loadPosts();
    await window.refreshRemotePosts?.();
  }

  function formatTime(value) {
    return window.blogPostTime?.format?.(value) || new Date(value).toLocaleString("zh-CN", { hour12: false });
  }

  function escapeText(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    })[char]);
  }

  document.addEventListener("DOMContentLoaded", init, { once: true });
  window.openMemberAdmin = openMemberAdmin;
})();
