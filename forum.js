(() => {
  "use strict";

  const $ = selector => document.querySelector(selector);
  let threads = [];
  let currentThread = null;

  function escapeText(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    })[character]);
  }

  function formatTime(value) {
    const date = new Date(value);
    const now = new Date();
    const options = date.getFullYear() === now.getFullYear()
      ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
      : { year: "numeric", month: "short", day: "numeric" };
    return date.toLocaleString("zh-CN", { ...options, hour12: false });
  }

  function authorName(record) {
    return record.profiles?.username || "社区用户";
  }

  function canManage(record) {
    return Boolean(window.blogAuth?.user && (
      window.blogAuth.user.id === record.author_id || window.blogAuth.isAdmin
    ));
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
    const name = escapeText(authorName(record));
    return `<span class="social-actions"><button type="button" class="follow-button" data-follow-user="${id}">关注</button><button type="button" class="chat-button" data-chat-user="${id}" data-chat-name="${name}">私聊</button></span>`;
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

  function setNotice(message = "") {
    const notice = $("#forumNotice");
    notice.textContent = message;
    notice.hidden = !message;
  }

  async function loadThreads() {
    ensureAsideWorkspace();
    const list = $("#threadList");
    list.innerHTML = `<p class="forum-empty">正在加载社区内容…</p>`;
    setNotice();
    const result = await window.blogAuth?.listForumThreads?.();
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
    renderThreads();
  }

  function ensureAsideWorkspace() {
    const aside = $(".forum-aside");
    if (!aside || aside.querySelector(".forum-space-card")) return;
    const card = document.createElement("section");
    card.className = "side-card forum-space-card";
    card.innerHTML = `<h3>社区空间</h3><p>这里是你的社区控制台，可以快速查看通知、好友和个人资料。</p><div class="forum-space-actions"><button type="button" class="secondary-btn" data-open-social="notifications">通知中心</button><button type="button" class="secondary-btn" data-open-social="friends">好友列表</button></div>`;
    aside.append(card);
  }

  function renderThreads() {
    $("#threadList").innerHTML = threads.length
      ? threads.map(thread => {
          const replies = thread.forum_replies?.[0]?.count || 0;
          const excerpt = thread.content.replace(/[#>*_`\[\]()~-]/g, "").trim();
          return `<article class="thread-card" data-thread-id="${thread.id}" tabindex="0">
            ${avatarMarkup(thread)}
            <div class="thread-main">
              <div class="thread-author"><strong>${escapeText(authorName(thread))}</strong>${titleMarkup(thread)}<time>${formatTime(thread.created_at)}</time></div>
              <h2>${escapeText(thread.title)}</h2>
              <p>${escapeText(excerpt)}</p>
              <div class="thread-meta"><span>💬 ${replies} 条回复</span><span>♡ ${thread.likes || 0} 个赞</span>${thread.profiles?.user_uid ? `<span>UID ${thread.profiles.user_uid}</span>` : ""}${canManage(thread) ? `<span class="thread-owner">可管理</span>` : ""}</div>
            </div>
          </article>`;
        }).join("")
      : `<div class="forum-empty"><span>☁</span><h2>还没有话题</h2><p>登录后发布社区里的第一个话题吧。</p></div>`;
  }

  function openEditor(thread = null) {
    if (!window.blogAuth?.user) return window.blogAuth?.openAuth("login");
    const form = $("#threadForm");
    form.reset();
    form.elements.id.value = thread?.id || "";
    form.elements.title.value = thread?.title || "";
    form.elements.content.value = thread?.content || "";
    $("#threadEditorTitle").textContent = thread ? "编辑话题" : "发布话题";
    $("#saveThreadBtn").textContent = thread ? "保存修改" : "发布话题";
    $("#threadFormError").hidden = true;
    renderPreview();
    if (!$("#threadEditorDialog").open) $("#threadEditorDialog").showModal();
  }

  function renderPreview() {
    const content = $("#threadForm").elements.content.value.trim();
    $("#threadPreview").innerHTML = content
      ? window.blogMarkdown.render(content)
      : `<p class="forum-empty">在上方输入后，这里会显示 Markdown 预览。</p>`;
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
    if (image?.size) {
      button.textContent = "正在上传图片…";
      const url = await window.blogAuth.uploadCommunityImage?.(image);
      if (!url) { button.disabled = false; button.textContent = id ? "保存修改" : "发布话题"; return; }
      content += `\n\n![社区图片](${url})`;
    }
    const saved = await window.blogAuth.saveForumThread({
      title: data.get("title"),
      content
    }, id);
    button.disabled = false;
    button.textContent = id ? "保存修改" : "发布话题";
    if (!saved) return;
    if (window.closeDialog) window.closeDialog($("#threadEditorDialog")); else $("#threadEditorDialog").close();
    window.toast(id ? "话题已更新" : "话题发布成功");
    await loadThreads();
    const fresh = threads.find(thread => thread.id === saved.id);
    if (fresh) openThread(fresh);
  }

  async function openThread(thread) {
    currentThread = thread;
    const actions = `<div class="thread-actions">${canManage(thread) ? `<button type="button" data-edit-thread="${thread.id}">编辑</button><button type="button" class="danger-link" data-delete-thread="${thread.id}">删除</button>` : ""}<button type="button" data-report-type="forum_post" data-report-id="${thread.id}">举报</button></div>`;
    $("#threadContent").innerHTML = `<div class="article-body forum-thread-body">
      <div class="thread-floor-mark">1楼</div>
      <div class="thread-detail-author">${avatarMarkup(thread)}<div><span><strong>${escapeText(authorName(thread))}</strong>${titleMarkup(thread, true)}</span><time>${formatTime(thread.created_at)}</time></div>${socialMarkup(thread)}</div>
      <h1>${escapeText(thread.title)}</h1>
      <div class="article-text">${window.blogMarkdown.render(thread.content)}</div><div class="thread-engagement"><button class="like-button" data-like-type="post" data-like-id="${thread.id}">♡ <span>${thread.likes || 0}</span></button></div>${actions}
    </div>`;
    updateReplyAccess();
    if (!$("#threadDialog").open) $("#threadDialog").showModal();
    $("#threadDialog").scrollTop = 0;
    await renderReplies();
  }

  async function renderReplies() {
    if (!currentThread) return;
    $("#replyList").innerHTML = `<p class="forum-empty">正在加载回复…</p>`;
    const replies = await window.blogAuth.listForumReplies(currentThread.id);
    $("#replyCount").textContent = replies.length;
    const children = new Map();
    replies.forEach(reply => {
      const parent = Number(reply.parent_id) || 0;
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(reply);
    });
    const renderNode = reply => {
      const nested = children.get(reply.id) || [];
      const nestedMarkup = nested.length ? `<button type="button" class="reply-toggle" data-toggle-replies="${reply.id}">收起 ${nested.length} 条回复</button><div class="nested-replies" data-replies-for="${reply.id}">${nested.map(renderNode).join("")}</div>` : "";
      return `<article class="comment forum-reply" data-reply-id="${reply.id}">
          ${avatarMarkup(reply)}
          <div><div class="comment-head"><span class="reply-author"><strong>${escapeText(authorName(reply))}</strong>${titleMarkup(reply, true)}</span><span class="reply-floor"><b>${reply.floor_number || ""}楼</b><time>${formatTime(reply.created_at)}</time></span></div>
          <div class="reply-content">${window.blogMarkdown.render(reply.content)}</div>
          <div class="reply-tools"><button class="reply-to-button" type="button" data-reply-to="${reply.id}" data-reply-name="${escapeText(authorName(reply))}">回复</button><button class="like-button small" type="button" data-like-type="reply" data-like-id="${reply.id}">♡ <span>${reply.likes || 0}</span></button>${socialMarkup(reply)}${canManage(reply) ? `<button class="comment-delete" type="button" data-delete-reply="${reply.id}">删除</button>` : ""}<button class="comment-report" type="button" data-report-type="forum_reply" data-report-id="${reply.id}">举报</button></div>${nestedMarkup}</div>
        </article>`;
    };
    const topLevel = children.get(0) || [];
    $("#replyList").innerHTML = replies.length
      ? topLevel.map(renderNode).join("")
      : `<p class="forum-empty">还没有回复，来参与讨论吧。</p>`;
    document.querySelectorAll("[data-follow-user]").forEach(button => window.hydrateFollowButton?.(button));
  }

  function updateReplyAccess() {
    const signedIn = Boolean(window.blogAuth?.user);
    $("#replyLoginTip").hidden = signedIn;
    $("#replyForm").hidden = !signedIn;
    if (threads.length) renderThreads();
  }

  async function addReply(event) {
    event.preventDefault();
    if (!currentThread) return;
    const form = event.currentTarget;
    const content = form.elements.content.value.trim();
    if (!content) return;
    const button = form.querySelector("button:not([type=button])");
    button.disabled = true;
    button.textContent = "正在发表…";
    const added = await window.blogAuth.addForumReply(currentThread.id, content, form.elements.parent_id.value || null);
    button.disabled = false;
    button.textContent = "发表回复";
    if (!added) return;
    form.reset();
    resetReplyTarget();
    $("#replyCharCount").textContent = "0";
    window.toast("回复发表成功");
    await renderReplies();
    await loadThreads();
    currentThread = threads.find(thread => thread.id === currentThread.id) || currentThread;
  }

  async function deleteThread(id) {
    const thread = threads.find(item => item.id === id) || currentThread;
    if (!thread || !confirm(`确定删除《${thread.title}》吗？其全部回复也会删除。`)) return;
    if (!await window.blogAuth.deleteForumThread(id)) return;
    if ($("#threadDialog").open) {
      if (window.closeDialog) window.closeDialog($("#threadDialog")); else $("#threadDialog").close();
    }
    currentThread = null;
    window.toast("话题已删除");
    await loadThreads();
  }

  async function deleteReply(id) {
    if (!confirm("确定删除这条回复吗？")) return;
    if (!await window.blogAuth.deleteForumReply(id)) return;
    window.toast("回复已删除");
    await renderReplies();
    await loadThreads();
  }

  function resetReplyTarget() {
    const form = $("#replyForm");
    form.elements.parent_id.value = "";
    $("#replyTarget").hidden = true;
    $("#replyTarget").textContent = "";
    $("#cancelReplyBtn").hidden = true;
  }

  function prepareReply(id, name) {
    if (!window.blogAuth?.user) return window.blogAuth?.openAuth("login");
    const form = $("#replyForm");
    form.elements.parent_id.value = id;
    $("#replyTarget").hidden = false;
    $("#replyTarget").textContent = `正在回复 @${name}`;
    $("#cancelReplyBtn").hidden = false;
    form.elements.content.focus();
  }

  async function toggleLike(type, id) {
    const result = await window.blogAuth.toggleForumLike(type, id);
    if (!result) return;
    const button = document.querySelector(`[data-like-type="${type}"][data-like-id="${id}"]`);
    if (button) {
      button.classList.toggle("liked", result.liked);
      button.querySelector("span").textContent = result.likes;
    }
  }

  function init() {
    $("#newThreadBtn").addEventListener("click", () => openEditor());
    $("#refreshThreadsBtn").addEventListener("click", loadThreads);
    $("#threadForm").addEventListener("submit", saveThread);
    $("#threadForm").elements.content.addEventListener("input", renderPreview);
    $("#replyForm").addEventListener("submit", addReply);
    $("#cancelReplyBtn").addEventListener("click", resetReplyTarget);
    $("#replyForm").elements.content.addEventListener("input", event => {
      $("#replyCharCount").textContent = event.target.value.length;
    });
    $("#threadList").addEventListener("click", event => {
      const card = event.target.closest("[data-thread-id]");
      if (card) openThread(threads.find(thread => thread.id === Number(card.dataset.threadId)));
    });
    $("#threadList").addEventListener("keydown", event => {
      if (event.key === "Enter" && event.target.matches("[data-thread-id]")) {
        openThread(threads.find(thread => thread.id === Number(event.target.dataset.threadId)));
      }
    });
    $("#threadContent").addEventListener("click", event => {
      const edit = event.target.closest("[data-edit-thread]");
      const remove = event.target.closest("[data-delete-thread]");
      if (edit) openEditor(threads.find(thread => thread.id === Number(edit.dataset.editThread)));
      if (remove) deleteThread(Number(remove.dataset.deleteThread));
    });
    $("#replyList").addEventListener("click", event => {
      const remove = event.target.closest("[data-delete-reply]");
      if (remove) deleteReply(Number(remove.dataset.deleteReply));
      const replyTo = event.target.closest("[data-reply-to]");
      if (replyTo) prepareReply(Number(replyTo.dataset.replyTo), replyTo.dataset.replyName);
      const toggle = event.target.closest("[data-toggle-replies]");
      if (toggle) {
        const container = event.currentTarget.querySelector(`[data-replies-for="${toggle.dataset.toggleReplies}"]`);
        const collapsed = container.classList.toggle("collapsed");
        toggle.textContent = collapsed ? `展开回复` : `收起回复`;
      }
      const like = event.target.closest("[data-like-type]");
      if (like) toggleLike(like.dataset.likeType, Number(like.dataset.likeId));
    });
    $("#threadContent").addEventListener("click", event => {
      const like = event.target.closest("[data-like-type]");
      if (like) toggleLike(like.dataset.likeType, Number(like.dataset.likeId));
    });
    window.addEventListener("blog-auth-change", updateReplyAccess);
    loadThreads();
    updateReplyAccess();
  }

  document.addEventListener("DOMContentLoaded", init, { once: true });
})();
