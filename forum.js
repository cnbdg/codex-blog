(() => {
  "use strict";

  const $ = selector => document.querySelector(selector);
  const DRAFT_KEY = "cnbdg-forum-thread-draft-v2";
  const LEGACY_DRAFT_KEY = "cnbdg-forum-thread-draft-v1";
  const HISTORY_KEY = "cnbdg-forum-history-v1";
  const VIEWER_KEY = "cnbdg-forum-viewer-v1";
  const typeLabels = { discussion: "交流", question: "提问", share: "分享", guide: "教程" };
  const sortLabels = { activity: "按最新互动排序", newest: "按发布时间排序", hot: "按近期热度排序", featured: "只显示精品帖子" };
  let threads = [];
  let currentThread = null;
  let currentReplies = [];
  let threadState = { bookmarked: false, post_liked: false, liked_reply_ids: [] };
  let previewUrl = "";
  let deepLinkHandled = false;
  let searchTimer = 0;
  const feed = { sort: "activity", type: "all", search: "", bookmarksOnly: false, bookmarkIds: new Set(), upgraded: true, onlyOwner: false };

  const escapeText = value => String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[character]);

  function viewerKey() {
    try {
      let value = localStorage.getItem(VIEWER_KEY);
      if (!value) {
        value = globalThis.crypto?.randomUUID?.() || `guest_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
        localStorage.setItem(VIEWER_KEY, value);
      }
      return value;
    } catch {
      return `guest_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
    }
  }

  function clearImagePreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = "";
    const holder = $("#threadImagePreview");
    if (holder) { holder.hidden = true; holder.innerHTML = ""; }
  }

  function showImagePreview(file) {
    clearImagePreview();
    if (!file?.size || !file.type.startsWith("image/")) return;
    previewUrl = URL.createObjectURL(file);
    const holder = $("#threadImagePreview");
    if (!holder) return;
    holder.hidden = false;
    holder.innerHTML = `<img src="${previewUrl}" alt="待上传图片预览"><span>${escapeText(file.name)}</span><button type="button" data-clear-thread-image aria-label="移除图片">×</button>`;
  }

  function saveDraft() {
    const form = $("#threadForm");
    if (!form || form.elements.id.value) return;
    const title = form.elements.title.value.trim();
    const content = form.elements.content.value.trim();
    if (!title && !content) return localStorage.removeItem(DRAFT_KEY);
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      title, content, topic_type: form.elements.topic_type.value, savedAt: Date.now()
    }));
  }

  function restoreDraft(form) {
    try {
      const raw = localStorage.getItem(DRAFT_KEY) || localStorage.getItem(LEGACY_DRAFT_KEY);
      const draft = JSON.parse(raw || "null");
      if (!draft || (!draft.title && !draft.content)) return;
      form.elements.title.value = draft.title || "";
      form.elements.content.value = draft.content || "";
      form.elements.topic_type.value = draft.topic_type || "discussion";
      if (!localStorage.getItem(DRAFT_KEY)) {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, topic_type: draft.topic_type || "discussion" }));
        localStorage.removeItem(LEGACY_DRAFT_KEY);
      }
      window.toast?.("已恢复未发布的话题草稿");
    } catch {
      localStorage.removeItem(DRAFT_KEY);
      localStorage.removeItem(LEGACY_DRAFT_KEY);
    }
  }

  function formatTime(value) {
    const date = new Date(value);
    const now = new Date();
    const options = date.getFullYear() === now.getFullYear()
      ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
      : { year: "numeric", month: "short", day: "numeric" };
    return date.toLocaleString("zh-CN", { ...options, hour12: false });
  }

  function authorName(record) { return record.profiles?.username || "社区用户"; }
  function replyCount(thread) { return Number(thread.forum_replies?.[0]?.count || 0); }
  function canManage(record) {
    return Boolean(window.blogAuth?.user && (window.blogAuth.user.id === record.author_id || window.blogAuth.isAdmin));
  }

  function titleMarkup(record, showOwner = false) {
    const admin = Boolean(record.profiles?.is_admin);
    const title = record.profiles?.display_title || (admin ? "站长" : "社区成员");
    const owner = showOwner && currentThread && record.author_id === currentThread.author_id;
    return `<span class="user-title">${escapeText(title)}</span>${admin ? `<span class="user-title admin">管理员</span>` : ""}${owner ? `<span class="user-title owner">楼主</span>` : ""}`;
  }

  function socialMarkup(record) {
    if (window.blogAuth?.user?.id === record.author_id) return "";
    const id = escapeText(record.author_id);
    return `<span class="social-actions"><button type="button" class="follow-button" data-follow-user="${id}">关注</button><button type="button" class="chat-button" data-chat-user="${id}" data-chat-name="${escapeText(authorName(record))}">私聊</button></span>`;
  }

  function hydrateForumSocial(scope = document) {
    scope?.querySelectorAll?.("[data-follow-user]").forEach(button => window.hydrateFollowButton?.(button));
  }

  function avatarMarkup(record) {
    const name = authorName(record);
    const userId = escapeText(record.author_id);
    let url = "";
    try {
      const parsed = new URL(record.profiles?.avatar_url || "");
      if (/^https?:$/.test(parsed.protocol)) url = parsed.href;
    } catch {}
    const style = url ? ` style="background-image:url(&quot;${escapeText(url)}&quot;)"` : "";
    return `<button type="button" class="forum-avatar profile-avatar ${url ? "has-image" : ""}" data-user-profile="${userId}" aria-label="查看 ${escapeText(name)} 的资料"${style}>${escapeText(name[0]?.toUpperCase() || "U")}</button>`;
  }

  function threadBadges(thread) {
    return `<span class="thread-type type-${escapeText(thread.topic_type || "discussion")}">${escapeText(typeLabels[thread.topic_type] || "交流")}</span>${thread.is_pinned ? `<span class="thread-flag pinned">置顶</span>` : ""}${thread.is_featured ? `<span class="thread-flag featured">精品</span>` : ""}`;
  }

  function setNotice(message = "") {
    const notice = $("#forumNotice");
    if (!notice) return;
    notice.textContent = message;
    notice.hidden = !message;
  }

  function setThreadFormError(message = "") {
    const target = $("#threadFormError");
    if (!target) return;
    target.textContent = message;
    target.hidden = !message;
  }

  function historyRows() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); }
    catch { return []; }
  }

  function rememberThread(thread) {
    try {
      const next = [{ id: thread.id, title: thread.title, author: authorName(thread), viewedAt: Date.now() },
        ...historyRows().filter(row => Number(row.id) !== Number(thread.id))].slice(0, 6);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    } catch {}
    renderHistory();
  }

  function renderHistory() {
    const target = $("#forumHistoryList");
    if (!target) return;
    const rows = historyRows();
    target.innerHTML = rows.length ? rows.map(row => `<button type="button" data-history-thread="${Number(row.id)}"><strong>${escapeText(row.title)}</strong><small>${escapeText(row.author || "社区用户")} · ${formatTime(row.viewedAt)}</small></button>`).join("") : `<p>浏览帖子后会保存在当前设备。</p>`;
  }

  function ensureAsideWorkspace() {
    const aside = $(".forum-aside");
    if (!aside) return;
    if (!aside.querySelector(".forum-history-card")) {
      const history = document.createElement("section");
      history.className = "side-card forum-history-card";
      history.innerHTML = `<div class="forum-side-heading"><h3>最近浏览</h3><button type="button" id="clearForumHistoryBtn">清空</button></div><div id="forumHistoryList" class="forum-history-list"></div>`;
      aside.append(history);
    }
    if (!aside.querySelector(".forum-space-card")) {
      const card = document.createElement("section");
      card.className = "side-card forum-space-card";
      card.innerHTML = `<h3>社区空间</h3><p>一个社区，一条持续更新的信息流。收藏帖子、查看通知，也可以从好友列表继续交流。</p><div class="forum-space-actions"><button type="button" class="secondary-btn" data-open-social="notifications">通知中心</button><button type="button" class="secondary-btn" data-open-social="friends">好友列表</button></div>`;
      aside.append(card);
    }
    renderHistory();
  }

  async function refreshBookmarks() {
    const rows = await window.blogAuth?.listForumBookmarks?.() || [];
    feed.bookmarkIds = new Set(rows.map(row => Number(row.post_id)));
  }

  async function loadThreads({ followDeepLink = true } = {}) {
    ensureAsideWorkspace();
    const list = $("#threadList");
    list.innerHTML = `<div class="forum-feed-loading"><span></span><p>正在加载社区帖子…</p></div>`;
    setNotice();
    const [result] = await Promise.all([window.blogAuth?.listForumThreads?.(), refreshBookmarks()]);
    if (!result) {
      list.innerHTML = `<p class="forum-empty">社区服务暂时不可用。</p>`;
      return;
    }
    if (result.error) {
      list.innerHTML = "";
      setNotice(/forum_posts|schema cache|could not find/i.test(result.error)
        ? "社区数据库还未启用。请先在 Supabase SQL Editor 中运行 community.sql。"
        : `社区加载失败：${result.error}`);
      return;
    }
    threads = result.rows;
    feed.upgraded = result.upgraded !== false;
    if (!feed.upgraded) setNotice("社区正在使用兼容模式。执行 forum-upgrade.sql 后可启用收藏、浏览量、精品、置顶与回复通知。");
    renderThreads();
    if (followDeepLink && !deepLinkHandled) {
      deepLinkHandled = true;
      const id = Number(new URL(location.href).searchParams.get("thread"));
      if (id) openThreadById(id, { updateUrl: false });
    }
  }

  function sortedThreads() {
    const query = feed.search.toLocaleLowerCase("zh-CN");
    let rows = threads.filter(thread => {
      if (feed.type !== "all" && thread.topic_type !== feed.type) return false;
      if (feed.bookmarksOnly && !feed.bookmarkIds.has(Number(thread.id))) return false;
      if (feed.sort === "featured" && !thread.is_featured) return false;
      if (!query) return true;
      return `${thread.title} ${thread.content} ${authorName(thread)}`.toLocaleLowerCase("zh-CN").includes(query);
    });
    const pinned = (a, b) => Number(Boolean(b.is_pinned)) - Number(Boolean(a.is_pinned));
    if (feed.sort === "newest") rows.sort((a, b) => pinned(a, b) || new Date(b.created_at) - new Date(a.created_at));
    else if (feed.sort === "hot") rows.sort((a, b) => {
      const score = thread => (Number(thread.likes) * 4) + (replyCount(thread) * 3) + (Math.sqrt(Number(thread.view_count) || 0) * 2) - ((Date.now() - new Date(thread.updated_at)) / 86400000);
      return pinned(a, b) || score(b) - score(a);
    });
    else rows.sort((a, b) => pinned(a, b) || new Date(b.updated_at) - new Date(a.updated_at));
    return rows;
  }

  function renderThreads() {
    const rows = sortedThreads();
    const summary = $("#forumThreadSummary");
    if (summary) summary.textContent = `${sortLabels[feed.sort]} · ${rows.length} 帖${feed.bookmarksOnly ? " · 我的收藏" : ""}`;
    const bookmarkButton = $("#forumBookmarksBtn");
    if (bookmarkButton) {
      bookmarkButton.classList.toggle("active", feed.bookmarksOnly);
      bookmarkButton.setAttribute("aria-pressed", String(feed.bookmarksOnly));
      bookmarkButton.textContent = feed.bookmarksOnly ? "★ 我的收藏" : "☆ 我的收藏";
    }
    $("#threadList").innerHTML = rows.length ? rows.map(thread => {
      const replies = replyCount(thread);
      const excerpt = thread.content.replace(/[#>*_`\[\]()~-]/g, "").trim();
      const activeAt = new Date(thread.updated_at) - new Date(thread.created_at) > 60000
        ? `最后回复 ${formatTime(thread.updated_at)}` : `发布于 ${formatTime(thread.created_at)}`;
      return `<article class="thread-card${thread.is_pinned ? " is-pinned" : ""}${thread.is_featured ? " is-featured" : ""}" data-thread-id="${thread.id}" tabindex="0">
        ${avatarMarkup(thread)}
        <div class="thread-main"><div class="thread-card-kicker"><span>${threadBadges(thread)}</span><time>${activeAt}</time></div>
          <div class="thread-author"><strong>${escapeText(authorName(thread))}</strong>${titleMarkup(thread)}</div>
          <h2>${escapeText(thread.title)}${feed.bookmarkIds.has(Number(thread.id)) ? `<span class="bookmarked-mark" title="已收藏">★</span>` : ""}</h2>
          <p>${escapeText(excerpt)}</p>
          <div class="thread-meta"><span>💬 ${replies} 回复</span><span>♡ ${thread.likes || 0} 赞</span><span>◉ ${thread.view_count || 0} 浏览</span>${thread.profiles?.user_uid ? `<span>UID ${thread.profiles.user_uid}</span>` : ""}</div>
        </div></article>`;
    }).join("") : `<div class="forum-empty"><span>${feed.bookmarksOnly ? "☆" : "⌕"}</span><h2>${feed.bookmarksOnly ? "还没有收藏帖子" : "没有找到相关帖子"}</h2><p>${feed.bookmarksOnly ? "打开帖子后点击收藏，就能在这里快速找到。" : "尝试更换排序、类型或搜索词。"}</p></div>`;
  }

  function openEditor(thread = null) {
    if (!window.blogAuth?.user) return window.blogAuth?.openAuth("login");
    const form = $("#threadForm");
    form.reset();
    form.elements.id.value = thread?.id || "";
    form.elements.topic_type.value = thread?.topic_type || "discussion";
    form.elements.title.value = thread?.title || "";
    form.elements.content.value = thread?.content || "";
    clearImagePreview();
    if (!thread) restoreDraft(form);
    $("#threadEditorTitle").textContent = thread ? "编辑帖子" : "发布帖子";
    $("#saveThreadBtn").textContent = thread ? "保存修改" : "发布帖子";
    setThreadFormError();
    renderPreview();
    if (!$("#threadEditorDialog").open) $("#threadEditorDialog").showModal();
  }

  function renderPreview() {
    const content = $("#threadForm").elements.content.value.trim();
    $("#threadPreview").innerHTML = content ? window.blogMarkdown.render(content) : `<p class="forum-empty">在上方输入后，这里会显示 Markdown 预览。</p>`;
  }

  async function saveThread(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.checkValidity()) return form.reportValidity();
    const data = new FormData(form);
    const id = Number(data.get("id")) || null;
    const button = $("#saveThreadBtn");
    button.disabled = true;
    button.textContent = id ? "正在保存…" : "正在发布…";
    let content = String(data.get("content") || "").trim();
    const image = data.get("image");
    setThreadFormError();
    try {
      if (image?.size) {
        button.textContent = "正在上传图片…";
        const url = await window.blogAuth.uploadCommunityImage?.(image);
        if (!url) return setThreadFormError("图片未能上传。首次启用图片功能时，请在 Supabase SQL Editor 执行 community-media.sql 后重试。");
        content += `\n\n![社区图片](${url})`;
      }
      const saved = await window.blogAuth.saveForumThread({
        title: data.get("title"), content, topic_type: data.get("topic_type")
      }, id);
      if (!saved) return;
      localStorage.removeItem(DRAFT_KEY);
      localStorage.removeItem(LEGACY_DRAFT_KEY);
      clearImagePreview();
      if (window.closeDialog) window.closeDialog($("#threadEditorDialog")); else $("#threadEditorDialog").close();
      window.toast(id ? "帖子已更新" : "帖子发布成功");
      await loadThreads({ followDeepLink: false });
      const fresh = threads.find(thread => Number(thread.id) === Number(saved.id));
      if (fresh) openThread(fresh);
    } catch (error) {
      console.error("Forum image or post save failed", error);
      setThreadFormError("发布失败，请检查网络或图片存储配置后重试。");
    } finally {
      button.disabled = false;
      button.textContent = id ? "保存修改" : "发布帖子";
    }
  }

  function syncThreadUrl(id = null) {
    const url = new URL(location.href);
    if (id) { url.searchParams.set("thread", id); url.hash = "forum"; }
    else url.searchParams.delete("thread");
    history.replaceState(history.state, "", url);
  }

  function renderThreadDetail(thread) {
    const adminActions = window.blogAuth?.isAdmin ? `<button type="button" data-thread-status="pin">${thread.is_pinned ? "取消置顶" : "置顶"}</button><button type="button" data-thread-status="feature">${thread.is_featured ? "取消精品" : "设为精品"}</button>` : "";
    const actions = `<div class="thread-actions">${canManage(thread) ? `<button type="button" data-edit-thread="${thread.id}">编辑</button><button type="button" class="danger-link" data-delete-thread="${thread.id}">删除</button>` : ""}${adminActions}<button type="button" data-report-type="forum_post" data-report-id="${thread.id}">举报</button></div>`;
    $("#threadContent").innerHTML = `<div class="article-body forum-thread-body" data-floor="1">
      <div class="thread-floor-mark">1楼</div><div class="thread-detail-flags">${threadBadges(thread)}</div>
      <div class="thread-detail-author">${avatarMarkup(thread)}<div><span><strong>${escapeText(authorName(thread))}</strong>${titleMarkup(thread, true)}</span><time>${formatTime(thread.created_at)}</time></div>${socialMarkup(thread)}</div>
      <h1>${escapeText(thread.title)}</h1><div class="article-text">${window.blogMarkdown.render(thread.content)}</div>
      <div class="thread-engagement"><button class="like-button${threadState.post_liked ? " liked" : ""}" data-like-type="post" data-like-id="${thread.id}">♡ <span>${thread.likes || 0}</span></button><button class="thread-bookmark-button${threadState.bookmarked ? " active" : ""}" data-bookmark-thread="${thread.id}">${threadState.bookmarked ? "★ 已收藏" : "☆ 收藏"}</button><button class="thread-share-button" data-share-thread="${thread.id}">↗ 分享</button><span class="thread-view-total">◉ <b>${thread.view_count || 0}</b> 次浏览</span></div>${actions}
    </div>`;
  }

  async function openThread(thread, { updateUrl = true } = {}) {
    if (!thread) return;
    currentThread = thread;
    currentReplies = [];
    feed.onlyOwner = false;
    threadState = { bookmarked: feed.bookmarkIds.has(Number(thread.id)), post_liked: false, liked_reply_ids: [] };
    $("#onlyOwnerRepliesBtn").classList.remove("active");
    $("#onlyOwnerRepliesBtn").setAttribute("aria-pressed", "false");
    $("#onlyOwnerRepliesBtn").textContent = "只看楼主";
    $("#threadFloorInput").value = "";
    renderThreadDetail(thread);
    hydrateForumSocial($("#threadContent"));
    updateReplyAccess();
    if (!$("#threadDialog").open) $("#threadDialog").showModal();
    $("#threadDialog").scrollTop = 0;
    if (updateUrl) syncThreadUrl(thread.id);
    rememberThread(thread);
    const openedId = thread.id;
    const [views, state] = await Promise.all([
      window.blogAuth.recordForumView?.(thread.id, viewerKey()),
      window.blogAuth.getForumThreadState?.(thread.id),
      renderReplies(true)
    ]);
    if (!currentThread || Number(currentThread.id) !== Number(openedId)) return;
    if (views != null) {
      currentThread.view_count = views;
      const source = threads.find(row => Number(row.id) === Number(openedId));
      if (source) source.view_count = views;
    }
    if (state) {
      threadState = state;
      threadState.liked_reply_ids = (state.liked_reply_ids || []).map(Number);
      if (state.bookmarked) feed.bookmarkIds.add(Number(openedId));
    }
    renderThreadDetail(currentThread);
    renderReplies(false);
    renderThreads();
    hydrateForumSocial($("#threadDialog"));
  }

  async function openThreadById(id, options = {}) {
    const numericId = Number(id);
    if (!numericId) return;
    window.showPage?.("forum", true);
    if (!threads.length) await loadThreads({ followDeepLink: false });
    const thread = threads.find(row => Number(row.id) === numericId);
    if (!thread) return window.toast?.("帖子不存在或已经被删除");
    return openThread(thread, options);
  }

  async function renderReplies(fetch = true) {
    if (!currentThread) return;
    if (fetch) {
      $("#replyList").innerHTML = `<p class="forum-empty">正在加载回复…</p>`;
      currentReplies = await window.blogAuth.listForumReplies(currentThread.id);
    }
    const all = currentReplies;
    const liked = new Set((threadState.liked_reply_ids || []).map(Number));
    const byId = new Map(all.map(reply => [Number(reply.id), reply]));
    const children = new Map();
    all.forEach(reply => {
      const parent = Number(reply.parent_id) || 0;
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(reply);
    });
    const renderNode = (reply, nested = false) => {
      const ownReply = reply.author_id === currentThread.author_id;
      const parent = byId.get(Number(reply.parent_id));
      const nestedRows = children.get(Number(reply.id)) || [];
      const context = parent ? `<small class="reply-context">回复 @${escapeText(authorName(parent))} · ${parent.floor_number}楼</small>` : "";
      const nestedMarkup = !feed.onlyOwner && nestedRows.length ? `<button type="button" class="reply-toggle" data-toggle-replies="${reply.id}">展开 ${nestedRows.length} 条楼中楼</button><div class="nested-replies collapsed" data-replies-for="${reply.id}">${nestedRows.map(row => renderNode(row, true)).join("")}</div>` : "";
      return `<article class="comment forum-reply${ownReply ? " reply-by-owner" : ""}${nested ? " is-nested" : ""}" id="floor-${reply.floor_number}" data-reply-id="${reply.id}" data-floor="${reply.floor_number}">
        ${avatarMarkup(reply)}<div><div class="comment-head"><span class="reply-author"><strong>${escapeText(authorName(reply))}</strong>${titleMarkup(reply, true)}</span><span class="reply-floor"><b>${reply.floor_number || ""}楼</b><time>${formatTime(reply.created_at)}</time></span></div>${context}
        <div class="reply-content">${window.blogMarkdown.render(reply.content)}</div>
        <div class="reply-tools"><button class="reply-to-button" type="button" data-reply-to="${reply.id}" data-reply-name="${escapeText(authorName(reply))}" data-reply-floor="${reply.floor_number}">回复</button><button class="like-button small${liked.has(Number(reply.id)) ? " liked" : ""}" type="button" data-like-type="reply" data-like-id="${reply.id}">♡ <span>${reply.likes || 0}</span></button>${socialMarkup(reply)}${canManage(reply) ? `<button class="comment-delete" type="button" data-delete-reply="${reply.id}">删除</button>` : ""}<button class="comment-report" type="button" data-report-type="forum_reply" data-report-id="${reply.id}">举报</button></div>${nestedMarkup}</div></article>`;
    };
    const visible = feed.onlyOwner ? all.filter(reply => reply.author_id === currentThread.author_id) : (children.get(0) || []);
    $("#replyCount").textContent = feed.onlyOwner ? `${visible.length}/${all.length}` : all.length;
    $("#replyList").innerHTML = visible.length ? visible.map(reply => renderNode(reply)).join("") : `<div class="forum-empty"><span>☁</span><h2>${feed.onlyOwner ? "楼主还没有回复" : "还没有回复"}</h2><p>${feed.onlyOwner ? "点击“查看全部回复”返回。" : "来参与讨论吧。"}</p></div>`;
    hydrateForumSocial($("#replyList"));
  }

  function updateReplyAccess() {
    const signedIn = Boolean(window.blogAuth?.user);
    $("#replyLoginTip").hidden = signedIn;
    $("#replyForm").hidden = !signedIn;
  }

  async function addReply(event) {
    event.preventDefault();
    if (!currentThread) return;
    const form = event.currentTarget;
    const threadId = Number(currentThread.id);
    const content = form.elements.content.value.trim();
    if (!content) return;
    const button = form.querySelector("button:not([type=button])");
    button.disabled = true;
    button.textContent = "正在发表…";
    const added = await window.blogAuth.addForumReply(threadId, content, form.elements.parent_id.value || null);
    button.disabled = false;
    button.textContent = "发表回复";
    if (!added) return;
    form.reset();
    resetReplyTarget();
    $("#replyCharCount").textContent = "0";
    window.toast?.("回复发表成功");
    await renderReplies(true);
    await loadThreads({ followDeepLink: false });
    if (currentThread && Number(currentThread.id) === threadId) {
      currentThread = threads.find(thread => Number(thread.id) === threadId) || currentThread;
    }
  }

  async function deleteThread(id) {
    const thread = threads.find(item => Number(item.id) === Number(id)) || currentThread;
    if (!thread || !confirm(`确定删除《${thread.title}》吗？其全部回复也会删除。`)) return;
    if (!await window.blogAuth.deleteForumThread(id)) return;
    if ($("#threadDialog").open) window.closeDialog ? window.closeDialog($("#threadDialog")) : $("#threadDialog").close();
    currentThread = null;
    syncThreadUrl();
    window.toast?.("帖子已删除");
    await loadThreads({ followDeepLink: false });
  }

  async function deleteReply(id) {
    if (!confirm("确定删除这条回复吗？")) return;
    if (!await window.blogAuth.deleteForumReply(id)) return;
    window.toast?.("回复已删除");
    await renderReplies(true);
    await loadThreads({ followDeepLink: false });
  }

  function resetReplyTarget() {
    const form = $("#replyForm");
    form.elements.parent_id.value = "";
    $("#replyTarget").hidden = true;
    $("#replyTarget").textContent = "";
    $("#cancelReplyBtn").hidden = true;
  }

  function prepareReply(id, name, floor) {
    if (!window.blogAuth?.user) return window.blogAuth?.openAuth("login");
    const form = $("#replyForm");
    form.elements.parent_id.value = id;
    $("#replyTarget").hidden = false;
    $("#replyTarget").textContent = `正在回复 @${name}${floor ? ` · ${floor}楼` : ""}`;
    $("#cancelReplyBtn").hidden = false;
    form.elements.content.focus();
  }

  async function toggleLike(type, id) {
    const result = await window.blogAuth.toggleForumLike(type, id);
    if (!result) return;
    document.querySelectorAll(`[data-like-type="${type}"][data-like-id="${id}"]`).forEach(button => {
      button.classList.toggle("liked", result.liked);
      button.querySelector("span").textContent = result.likes;
    });
    if (type === "post" && currentThread) { currentThread.likes = result.likes; threadState.post_liked = result.liked; }
    if (type === "reply") {
      const reply = currentReplies.find(row => Number(row.id) === Number(id));
      if (reply) reply.likes = result.likes;
      const liked = new Set((threadState.liked_reply_ids || []).map(Number));
      result.liked ? liked.add(Number(id)) : liked.delete(Number(id));
      threadState.liked_reply_ids = [...liked];
    }
  }

  async function toggleBookmark(id) {
    const saved = await window.blogAuth.toggleForumBookmark(id);
    if (saved === null) return;
    threadState.bookmarked = saved;
    saved ? feed.bookmarkIds.add(Number(id)) : feed.bookmarkIds.delete(Number(id));
    if (currentThread && Number(currentThread.id) === Number(id)) {
      renderThreadDetail(currentThread);
      hydrateForumSocial($("#threadContent"));
    }
    renderThreads();
    window.toast?.(saved ? "帖子已收藏" : "已取消收藏");
  }

  async function manageThreadStatus(kind) {
    if (!currentThread || !window.blogAuth?.isAdmin) return;
    const pinned = kind === "pin" ? !currentThread.is_pinned : currentThread.is_pinned;
    const featured = kind === "feature" ? !currentThread.is_featured : currentThread.is_featured;
    if (!await window.blogAuth.adminSetForumPostStatus(currentThread.id, pinned, featured)) return;
    currentThread.is_pinned = pinned;
    currentThread.is_featured = featured;
    const source = threads.find(row => Number(row.id) === Number(currentThread.id));
    if (source) { source.is_pinned = pinned; source.is_featured = featured; }
    renderThreadDetail(currentThread);
    hydrateForumSocial($("#threadContent"));
    renderThreads();
    window.toast?.(kind === "pin" ? (pinned ? "帖子已置顶" : "已取消置顶") : (featured ? "帖子已设为精品" : "已取消精品"));
  }

  async function shareThread(id) {
    const thread = threads.find(row => Number(row.id) === Number(id)) || currentThread;
    const url = new URL(location.href);
    url.searchParams.set("thread", id);
    url.hash = "forum";
    try {
      if (navigator.share) await navigator.share({ title: thread?.title || "社区帖子", url: url.href });
      else { await navigator.clipboard.writeText(url.href); window.toast?.("帖子链接已复制"); }
    } catch (error) {
      if (error?.name !== "AbortError") window.toast?.("分享失败，请复制浏览器地址");
    }
  }

  function toggleOnlyOwner() {
    feed.onlyOwner = !feed.onlyOwner;
    const button = $("#onlyOwnerRepliesBtn");
    button.classList.toggle("active", feed.onlyOwner);
    button.setAttribute("aria-pressed", String(feed.onlyOwner));
    button.textContent = feed.onlyOwner ? "查看全部回复" : "只看楼主";
    renderReplies(false);
  }

  function jumpToFloor() {
    if (!currentThread) return;
    const floor = Number($("#threadFloorInput").value);
    if (!Number.isInteger(floor) || floor < 1) return window.toast?.("请输入有效楼层");
    const target = floor === 1 ? $("#threadContent [data-floor='1']") : $("#replyList [data-floor='" + floor + "']");
    if (!target) return window.toast?.(feed.onlyOwner ? "该楼层不是楼主回复，请先查看全部回复" : "没有找到这个楼层");
    let collapsed = target.closest(".nested-replies.collapsed");
    while (collapsed) {
      collapsed.classList.remove("collapsed");
      const toggle = collapsed.previousElementSibling;
      if (toggle?.matches("[data-toggle-replies]")) toggle.textContent = "收起楼中楼";
      collapsed = collapsed.parentElement?.closest(".nested-replies.collapsed");
    }
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("floor-highlight");
    setTimeout(() => target.classList.remove("floor-highlight"), 1500);
  }

  async function syncAuthState() {
    updateReplyAccess();
    await refreshBookmarks();
    if (!window.blogAuth?.user) feed.bookmarksOnly = false;
    renderThreads();
    if (currentThread) {
      const state = await window.blogAuth.getForumThreadState?.(currentThread.id);
      if (state) {
        threadState = state;
        renderThreadDetail(currentThread);
        renderReplies(false);
        hydrateForumSocial($("#threadDialog"));
      }
    }
  }

  function init() {
    $("#newThreadBtn").addEventListener("click", () => openEditor());
    $("#refreshThreadsBtn").addEventListener("click", () => loadThreads({ followDeepLink: false }));
    $("#threadForm").addEventListener("submit", saveThread);
    $("#threadForm").elements.content.addEventListener("input", () => { renderPreview(); saveDraft(); });
    $("#threadForm").elements.title.addEventListener("input", saveDraft);
    $("#threadForm").elements.topic_type.addEventListener("change", saveDraft);
    $("#threadForm").elements.image.addEventListener("change", event => showImagePreview(event.target.files?.[0]));
    $("#threadForm").addEventListener("click", event => {
      if (!event.target.closest("[data-clear-thread-image]")) return;
      $("#threadForm").elements.image.value = "";
      clearImagePreview();
    });
    $(".forum-sort-tabs").addEventListener("click", event => {
      const button = event.target.closest("[data-forum-sort]");
      if (!button) return;
      feed.sort = button.dataset.forumSort;
      document.querySelectorAll("[data-forum-sort]").forEach(item => item.classList.toggle("active", item === button));
      renderThreads();
    });
    $("#forumTypeFilter").addEventListener("change", event => { feed.type = event.target.value; renderThreads(); });
    $("#forumThreadSearch").addEventListener("input", event => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { feed.search = event.target.value.trim(); renderThreads(); }, 180);
    });
    $("#forumBookmarksBtn").addEventListener("click", () => {
      if (!window.blogAuth?.user) return window.blogAuth?.openAuth("login");
      feed.bookmarksOnly = !feed.bookmarksOnly;
      renderThreads();
    });
    $("#threadList").addEventListener("click", event => {
      if (event.target.closest("button,a")) return;
      const card = event.target.closest("[data-thread-id]");
      if (card) openThread(threads.find(thread => Number(thread.id) === Number(card.dataset.threadId)));
    });
    $("#threadList").addEventListener("keydown", event => {
      if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-thread-id]")) {
        event.preventDefault();
        openThread(threads.find(thread => Number(thread.id) === Number(event.target.dataset.threadId)));
      }
    });
    $("#threadContent").addEventListener("click", event => {
      const edit = event.target.closest("[data-edit-thread]");
      const remove = event.target.closest("[data-delete-thread]");
      const like = event.target.closest("[data-like-type]");
      const bookmark = event.target.closest("[data-bookmark-thread]");
      const share = event.target.closest("[data-share-thread]");
      const status = event.target.closest("[data-thread-status]");
      if (edit) openEditor(currentThread);
      else if (remove) deleteThread(Number(remove.dataset.deleteThread));
      else if (like) toggleLike(like.dataset.likeType, Number(like.dataset.likeId));
      else if (bookmark) toggleBookmark(Number(bookmark.dataset.bookmarkThread));
      else if (share) shareThread(Number(share.dataset.shareThread));
      else if (status) manageThreadStatus(status.dataset.threadStatus);
    });
    $("#replyForm").addEventListener("submit", addReply);
    $("#cancelReplyBtn").addEventListener("click", resetReplyTarget);
    $("#replyForm").elements.content.addEventListener("input", event => { $("#replyCharCount").textContent = event.target.value.length; });
    $("#replyList").addEventListener("click", event => {
      const remove = event.target.closest("[data-delete-reply]");
      const replyTo = event.target.closest("[data-reply-to]");
      const toggle = event.target.closest("[data-toggle-replies]");
      const like = event.target.closest("[data-like-type]");
      if (remove) deleteReply(Number(remove.dataset.deleteReply));
      else if (replyTo) prepareReply(Number(replyTo.dataset.replyTo), replyTo.dataset.replyName, replyTo.dataset.replyFloor);
      else if (toggle) {
        const container = event.currentTarget.querySelector(`[data-replies-for="${toggle.dataset.toggleReplies}"]`);
        const collapsed = container.classList.toggle("collapsed");
        const count = container.children.length;
        toggle.textContent = collapsed ? `展开 ${count} 条楼中楼` : "收起楼中楼";
      } else if (like) toggleLike(like.dataset.likeType, Number(like.dataset.likeId));
    });
    $("#onlyOwnerRepliesBtn").addEventListener("click", toggleOnlyOwner);
    $("#jumpToFloorBtn").addEventListener("click", jumpToFloor);
    $("#threadFloorInput").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); jumpToFloor(); } });
    $("#threadDialog").addEventListener("close", () => { currentThread = null; currentReplies = []; syncThreadUrl(); });
    document.addEventListener("click", event => {
      const history = event.target.closest("[data-history-thread]");
      const clear = event.target.closest("#clearForumHistoryBtn");
      if (history) openThreadById(history.dataset.historyThread);
      if (clear) { localStorage.removeItem(HISTORY_KEY); renderHistory(); }
    });
    window.addEventListener("blog-auth-change", syncAuthState);
    loadThreads();
    updateReplyAccess();
  }

  document.addEventListener("DOMContentLoaded", init, { once: true });
  window.openForumThreadById = openThreadById;
})();
