(() => {
  "use strict";

  const $ = selector => document.querySelector(selector);
  let targetUser = null;
  let targetGroup = null;
  let targetGroupMeta = null;
  let targetName = "社区用户";
  let profileRequest = 0;
  let stopMessageSync = null;
  let messagePoll = null;
  let renderedMessageKey = null;
  let renderedMessageCount = 0;
  let hasRenderedMessages = false;
  let chatOwner = null;
  let selectedImageFile = null;
  let selectedImagePreviewUrl = "";
  let signedImageRefreshAt = 0;

  const messageMediaTypes = new Set([
    "image/jpeg", "image/png", "image/gif", "image/webp", "image/avif",
    "video/mp4", "video/webm", "video/quicktime"
  ]);
  const mediaLimit = file => file?.type?.startsWith("video/") ? 30 * 1024 * 1024 : 10 * 1024 * 1024;
  const mediaKind = (path = "", fileType = "") => {
    if (fileType.startsWith("video/") || /\.(?:mp4|webm|mov)(?:$|\?)/i.test(path)) return "video";
    if (fileType === "image/gif" || /\.gif(?:$|\?)/i.test(path)) return "gif";
    return "image";
  };

  const escapeText = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[char]);
  const isMessagesPage = () => document.getElementById("messages")?.classList.contains("active");
  const isChatVisible = () => Boolean((targetUser || targetGroup) && isMessagesPage() && !$("#messageThread")?.hidden);
  const currentChatKey = () => targetGroup ? `group:${targetGroup}` : targetUser ? `direct:${targetUser}` : "";

  function announceMessage(message = "") {
    const announcer = $("#messageAnnouncement");
    if (!announcer) return;
    announcer.textContent = "";
    const update = () => { announcer.textContent = message; };
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(update);
    else update();
  }

  function clearImageSelection() {
    if (selectedImagePreviewUrl && globalThis.URL?.revokeObjectURL) {
      globalThis.URL.revokeObjectURL(selectedImagePreviewUrl);
    }
    selectedImageFile = null;
    selectedImagePreviewUrl = "";
    const input = $("#messageImageInput");
    const preview = $("#messageImagePreview");
    const previewVisual = $("#messageMediaPreviewVisual");
    if (input) input.value = "";
    if (previewVisual) previewVisual.replaceChildren();
    if (preview) preview.hidden = true;
  }

  function selectMessageImage(event) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (!messageMediaTypes.has(file.type) || file.size > mediaLimit(file)) {
      clearImageSelection();
      window.toast?.("请选择 JPG、PNG、GIF、WebP、AVIF、MP4、WebM 或 MOV；图片/GIF 不超过 10MB，视频不超过 30MB。");
      return;
    }
    if (selectedImagePreviewUrl && globalThis.URL?.revokeObjectURL) {
      globalThis.URL.revokeObjectURL(selectedImagePreviewUrl);
    }
    selectedImageFile = file;
    selectedImagePreviewUrl = globalThis.URL?.createObjectURL?.(file) || "";
    const preview = $("#messageImagePreview");
    const previewVisual = $("#messageMediaPreviewVisual");
    const previewName = $("#messageImagePreviewName");
    if (previewVisual) {
      const visual = document.createElement(file.type.startsWith("video/") ? "video" : "img");
      visual.src = selectedImagePreviewUrl;
      if (visual.tagName === "VIDEO") {
        visual.muted = true;
        visual.playsInline = true;
        visual.preload = "metadata";
      } else visual.alt = "待发送媒体预览";
      previewVisual.replaceChildren(visual);
    }
    if (previewName) previewName.textContent = file.name;
    if (preview) preview.hidden = false;
  }

  function setFollowButton(button, state) {
    button.classList.toggle("following", Boolean(state?.following));
    button.textContent = state?.following ? (state?.mutual ? "互相关注" : "已关注") : "关注";
    button.title = state?.mutual ? "可以私信" : state?.following ? "等待对方回关后可以私信" : "关注后等待对方回关";
  }

  function safeAvatarUrl(value) {
    try {
      const parsed = new URL(value || "");
      return /^https?:$/.test(parsed.protocol) ? parsed.href : "";
    } catch {
      return "";
    }
  }

  function setConversationAvatar(name, avatarUrl = "", group = false) {
    const avatar = $("#messagePeerAvatar");
    if (!avatar) return;
    const safeUrl = safeAvatarUrl(avatarUrl);
    avatar.classList.toggle("has-image", Boolean(safeUrl));
    avatar.classList.toggle("group-avatar", group);
    avatar.style.backgroundImage = safeUrl ? `url("${safeUrl.replace(/["\\]/g, "\\$&")}")` : "";
    avatar.textContent = safeUrl ? "" : String(name || (group ? "群" : "U")).slice(0, 1).toUpperCase();
  }

  function setConversationMode(group = false) {
    const form = $("#messageForm");
    form?.classList.toggle("group-mode", group);
    const info = $("#messageInfoBtn");
    if (info) info.hidden = !group;
    const context = $("#messageContextLabel");
    if (context) context.innerHTML = group
      ? `群组 <span>消息仅对当前群成员可见</span>`
      : `今天 <span>消息仅对你们双方可见</span>`;
    const hint = $("#messageComposerHint");
    if (hint) hint.textContent = "Enter 发送 · 图片/GIF ≤ 10MB · 视频 ≤ 30MB";
  }

  function renderMessageMedia(path, url, label = "聊天媒体") {
    if (!path) return "";
    if (!url) return `<p class="dm-image-unavailable">媒体暂时无法加载</p>`;
    const safeUrl = escapeText(url);
    if (mediaKind(path) === "video") {
      return `<div class="dm-media-card"><video src="${safeUrl}" controls preload="metadata" playsinline aria-label="${escapeText(label)}">你的浏览器不支持视频播放。</video><a href="${safeUrl}" target="_blank" rel="noopener">在新窗口打开视频</a></div>`;
    }
    return `<a class="dm-image-link" href="${safeUrl}" target="_blank" rel="noopener"><img src="${safeUrl}" alt="${escapeText(mediaKind(path) === "gif" ? "聊天 GIF" : label)}" loading="lazy" decoding="async"></a>`;
  }

  function formatJoinDate(value) {
    if (!value) return "暂未记录";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "暂未记录";
    return date.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
  }

  function syncProfileSidebar() {
    const aside = document.querySelector(".forum-aside");
    const dialogContent = $("#publicProfileContent");
    if (!dialogContent || window.innerWidth < 1024) return;
    if (window.blogDesktop?.setProfileContext) {
      window.blogDesktop.setProfileContext(dialogContent.innerHTML);
      return;
    }
    if (!aside) return;
    let panel = aside.querySelector(".profile-sidebar-card");
    if (!panel) {
      panel = document.createElement("section");
      panel.className = "side-card profile-sidebar-card";
      aside.prepend(panel);
    }
    panel.hidden = false;
    panel.innerHTML = dialogContent.innerHTML;
  }

  function setChatStatus(message, state = "ready") {
    const status = $("#messageStatus");
    if (!status) return;
    status.dataset.state = state;
    status.innerHTML = `<i aria-hidden="true"></i>${escapeText(message)}`;
  }

  function notifyInboxChanged() {
    window.dispatchEvent(new Event("blog-notifications-change"));
  }

  async function markCurrentChatRead(peer = targetUser, group = targetGroup) {
    if (!peer && !group) return;
    const marked = group
      ? await window.blogAuth?.markGroupChatRead?.(group)
      : await window.blogAuth?.markDirectMessagesRead?.(peer);
    if (marked) notifyInboxChanged();
  }

  function showMessageThread(show) {
    const page = $("#messages");
    const empty = $("#messageEmpty");
    const thread = $("#messageThread");
    document.body.classList.toggle("message-thread-open", show);
    page?.classList.toggle("chat-open", show);
    if (empty) empty.hidden = show;
    if (thread) thread.hidden = !show;
  }

  function stopChatSync() {
    stopMessageSync?.();
    stopMessageSync = null;
    if (messagePoll) window.clearInterval(messagePoll);
    messagePoll = null;
  }

  function startChatSync() {
    const peer = targetUser;
    const group = targetGroup;
    const conversationKey = currentChatKey();
    const viewer = chatOwner || window.blogAuth?.user?.id;
    if ((!peer && !group) || !viewer || !isChatVisible()) return;
    stopChatSync();
    let connected = false;
    const subscribe = group
      ? window.blogAuth?.subscribeGroupChatMessages?.bind(window.blogAuth, group)
      : window.blogAuth?.subscribeDirectMessages?.bind(window.blogAuth, peer);
    stopMessageSync = subscribe?.(async row => {
      if (currentChatKey() !== conversationKey || window.blogAuth?.user?.id !== viewer || !isChatVisible()) return;
      await renderMessages({ forceScroll: true });
      if (row.sender_id !== viewer) await markCurrentChatRead(peer, group);
    }, status => {
      if (currentChatKey() !== conversationKey || window.blogAuth?.user?.id !== viewer || !isChatVisible()) return;
      if (status === "SUBSCRIBED") {
        connected = true;
        setChatStatus(group
          ? `${Number(targetGroupMeta?.member_count) || "多位"}成员 · 实时群聊已连接`
          : "实时聊天已连接", "connected");
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setChatStatus("实时连接重试中 · 自动同步已开启", "fallback");
      } else if (status === "CLOSED" && !connected) {
        setChatStatus("正在自动同步消息", "fallback");
      }
    }) || (() => {});

    // Realtime 短暂不可用时仍通过短轮询保证消息会出现。
    messagePoll = window.setInterval(() => {
      if (document.hidden || currentChatKey() !== conversationKey || window.blogAuth?.user?.id !== viewer || !isChatVisible()) return;
      renderMessages();
    }, 2000);
  }

  async function hydrateFollowButton(button) {
    if (!window.blogAuth?.user) return setFollowButton(button, null);
    const userId = button.dataset.followUser;
    if (!userId) return;
    const state = await window.blogAuth.getFollowState(userId);
    if (state) setFollowButton(button, state);
  }

  async function toggleFollow(button) {
    if (!window.blogAuth?.user) return window.blogAuth?.openAuth("login");
    button.disabled = true;
    const userId = button.dataset.followUser;
    if (!userId) { button.disabled = false; return; }
    const state = await window.blogAuth.toggleFollow(userId);
    button.disabled = false;
    if (!state) return;
    setFollowButton(button, state);
    document.querySelectorAll(`[data-follow-user="${userId}"]`).forEach(item => setFollowButton(item, state));
    document.querySelectorAll(`[data-profile-chat="${userId}"]`).forEach(item => {
      item.classList.toggle("available", Boolean(state.mutual));
      item.title = state.mutual ? "发送私信" : "互相关注后即可私信";
    });
    window.renderMessageFriends?.();
    window.toast?.(state.mutual ? "已互相关注，现在可以私聊了" : state.following ? "已关注，等待对方回关" : "已取消关注");
  }

  async function openPublicProfile(userId) {
    if (!userId) return;
    const dialog = $("#publicProfileDialog");
    const content = $("#publicProfileContent");
    if (!dialog || !content) return;
    const request = ++profileRequest;
    content.innerHTML = `<div class="profile-loading"><span></span><p>正在加载用户资料…</p></div>`;
    openDialog(dialog);

    const publicProfile = await window.blogAuth?.getPublicProfile?.(userId);
    if (request !== profileRequest || !dialog.open) return;
    if (!publicProfile) {
      content.innerHTML = `<div class="profile-loading profile-error"><b>未能找到这位用户</b><p>资料可能已被删除，或暂时无法访问。</p></div>`;
      return;
    }

    const ownProfile = window.blogAuth?.user?.id === publicProfile.id;
    const name = publicProfile.username || "社区用户";
    const title = publicProfile.display_title || (publicProfile.is_admin ? "站长" : "社区成员");
    const avatarUrl = safeAvatarUrl(publicProfile.avatar_url);
    const avatarStyle = avatarUrl ? ` style="background-image:url(&quot;${escapeText(avatarUrl)}&quot;)"` : "";
    const state = ownProfile ? null : await window.blogAuth?.getFollowState?.(publicProfile.id);
    if (request !== profileRequest || !dialog.open) return;

    content.innerHTML = `
      <div class="profile-cover"><span></span><span></span><span></span></div>
      <div class="profile-identity">
        <div class="profile-avatar-large ${avatarUrl ? "has-image" : ""}"${avatarStyle}>${escapeText(name[0]?.toUpperCase() || "U")}</div>
        <div class="profile-name-row"><div><h2>${escapeText(name)}</h2><span class="user-title">${escapeText(title)}</span>${publicProfile.is_admin ? `<span class="user-title admin">管理员</span>` : ""}</div><span class="profile-uid">UID ${publicProfile.user_uid || "—"}</span></div>
      </div>
      <div class="profile-facts">
        <div><small>社区身份</small><strong>${escapeText(title)}</strong></div>
        <div><small>加入时间</small><strong>${escapeText(formatJoinDate(publicProfile.created_at))}</strong></div>
        <div><small>账户状态</small><strong>${publicProfile.is_admin ? "社区管理员" : "正常使用中"}</strong></div>
      </div>
      <p class="profile-privacy-note">这里仅展示公开社区资料，不会显示邮箱等隐私信息。</p>
      <div class="profile-actions">
        ${ownProfile
          ? `<button type="button" class="profile-edit-button" data-open-own-profile>编辑我的资料</button>`
          : `<button type="button" class="follow-button profile-follow ${state?.following ? "following" : ""}" data-follow-user="${escapeText(publicProfile.id)}">${state?.following ? (state?.mutual ? "互相关注" : "已关注") : "＋ 关注"}</button>
             <button type="button" class="chat-button profile-chat ${state?.mutual ? "available" : ""}" data-chat-user="${escapeText(publicProfile.id)}" data-chat-name="${escapeText(name)}" data-profile-chat="${escapeText(publicProfile.id)}" title="${state?.mutual ? "发送私信" : "互相关注后即可私信"}">✉ 私信</button>`}
      </div>`;
    syncProfileSidebar();
  }

  async function openChat(userId, name) {
    if (!window.blogAuth?.user) return window.blogAuth?.openAuth("login");
    if (!userId) return;
    const viewer = window.blogAuth.user.id;
    window.setMessageInboxTab?.("direct");
    const state = await window.blogAuth.getFollowState(userId);
    if (viewer !== window.blogAuth?.user?.id) return;
    if (!state?.mutual) return window.toast?.("只有互相关注后才能私聊");

    stopChatSync();
    closeDialog($("#groupChatInfoDialog"));
    targetGroup = null;
    targetGroupMeta = null;
    targetUser = userId;
    targetName = name || "社区用户";
    chatOwner = viewer;
    renderedMessageKey = null;
    renderedMessageCount = 0;
    hasRenderedMessages = false;
    signedImageRefreshAt = 0;
    $("#messageForm")?.reset();
    clearImageSelection();
    setConversationMode(false);
    $("#messageTitle").textContent = targetName;
    setConversationAvatar(targetName);
    $("#messageList").innerHTML = `<p class="forum-empty">正在加载消息…</p>`;
    window.renderMessageFriends?.();
    if ($("#publicProfileDialog")?.open) {
      if (window.blogUI?.closeDialog) window.blogUI.closeDialog($("#publicProfileDialog"));
      else $("#publicProfileDialog").close();
    }
    if (window.blogUI?.navigate) window.blogUI.navigate("messages");
    else if (typeof window.showPage === "function") window.showPage("messages", true);
    showMessageThread(true);
    setChatStatus("正在连接实时聊天…", "connecting");
    startChatSync();
    await Promise.all([renderMessages({ forceScroll: true }), markCurrentChatRead()]);
  }

  async function openGroupChat(groupId, name = "群聊", metadata = null) {
    if (!window.blogAuth?.user) return window.blogAuth?.openAuth("login");
    if (!groupId) return;
    const viewer = window.blogAuth.user.id;
    window.setMessageInboxTab?.("groups");
    stopChatSync();
    targetUser = null;
    targetGroup = groupId;
    targetName = name || "群聊";
    targetGroupMeta = metadata || null;
    chatOwner = viewer;
    renderedMessageKey = null;
    renderedMessageCount = 0;
    hasRenderedMessages = false;
    signedImageRefreshAt = 0;
    $("#messageForm")?.reset();
    clearImageSelection();
    closeDialog($("#groupChatInfoDialog"));
    if (!targetGroupMeta) {
      const groups = await window.blogAuth.listGroupChats();
      if (targetGroup !== groupId || viewer !== window.blogAuth?.user?.id) return;
      targetGroupMeta = (groups || []).find(group => group.group_id === groupId) || null;
      if (targetGroupMeta?.group_name) targetName = targetGroupMeta.group_name;
    }
    setConversationMode(true);
    $("#messageTitle").textContent = targetName;
    setConversationAvatar(targetName, targetGroupMeta?.group_avatar_url, true);
    $("#messageList").innerHTML = `<p class="forum-empty">正在加载群消息…</p>`;
    window.renderMessageGroups?.();
    if (window.blogUI?.navigate) window.blogUI.navigate("messages");
    else if (typeof window.showPage === "function") window.showPage("messages", true);
    showMessageThread(true);
    setChatStatus("正在连接实时群聊…", "connecting");
    startChatSync();
    await Promise.all([renderMessages({ forceScroll: true }), markCurrentChatRead(null, groupId)]);
    window.renderMessageGroups?.();
  }

  function closeChat() {
    stopChatSync();
    targetUser = null;
    targetGroup = null;
    targetGroupMeta = null;
    targetName = "社区用户";
    chatOwner = null;
    renderedMessageKey = null;
    renderedMessageCount = 0;
    hasRenderedMessages = false;
    signedImageRefreshAt = 0;
    $("#messageForm")?.reset();
    clearImageSelection();
    setConversationMode(false);
    showMessageThread(false);
    $("#messageList").replaceChildren();
    announceMessage();
    if (isMessagesPage()) {
      window.renderMessageFriends?.();
      window.renderMessageGroups?.();
    }
  }

  function activateMessages() {
    if (!isMessagesPage() || (!targetUser && !targetGroup)) return;
    showMessageThread(true);
    if (!stopMessageSync) startChatSync();
    renderMessages({ forceScroll: !hasRenderedMessages });
  }

  async function renderMessages({ forceScroll = false } = {}) {
    const viewer = chatOwner || window.blogAuth?.user?.id;
    const peer = targetUser;
    const group = targetGroup;
    const conversationKey = currentChatKey();
    if ((!peer && !group) || !viewer || viewer !== window.blogAuth?.user?.id || !isChatVisible()) return;
    const messages = group
      ? await window.blogAuth.listGroupChatMessages(group)
      : await window.blogAuth.listDirectMessages(peer);
    if (!messages || conversationKey !== currentChatKey() || viewer !== window.blogAuth?.user?.id || !isChatVisible()) return;
    const key = messages.length ? messages.map(message => `${message.id}:${message.created_at}:${message.media_path || message.image_path || ""}`).join("|") : "empty";
    const imagePaths = messages.map(message => group ? message.media_path : message.image_path).filter(Boolean);
    const shouldRefreshImages = imagePaths.length && Date.now() >= signedImageRefreshAt;
    if (hasRenderedMessages && key === renderedMessageKey && !shouldRefreshImages) return;
    const list = $("#messageList");
    const isNearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 72;
    const imageUrls = imagePaths.length
      ? (group
        ? (await window.blogAuth?.getGroupChatMediaUrls?.(imagePaths)) || new Map()
        : (await window.blogAuth?.getDirectMessageImageUrls?.(imagePaths)) || new Map())
      : new Map();
    if (conversationKey !== currentChatKey() || viewer !== window.blogAuth?.user?.id || !isChatVisible()) return;
    const wasRendered = hasRenderedMessages;
    const previousCount = renderedMessageCount;
    list.innerHTML = messages.length ? messages.map(message => {
      const own = message.sender_id === window.blogAuth.user?.id;
      const content = String(message.content || "").trim();
      if (group) {
        const senderName = message.sender_username || "社区用户";
        const senderAvatar = safeAvatarUrl(message.sender_avatar_url);
        const avatarStyle = senderAvatar ? ` style="background-image:url(&quot;${escapeText(senderAvatar)}&quot;)"` : "";
        const time = new Date(message.created_at).toLocaleString("zh-CN", { hour12: false });
        const media = renderMessageMedia(message.media_path, imageUrls.get(message.media_path), "群聊媒体");
        if (own) return `<article class="dm-message own group-message">${media}${content ? `<p>${escapeText(content)}</p>` : ""}<time>${escapeText(time)}</time></article>`;
        return `<article class="group-message-row">
          <button type="button" class="group-message-avatar ${senderAvatar ? "has-image" : ""}" data-user-profile="${escapeText(message.sender_id)}" aria-label="查看 ${escapeText(senderName)} 的资料"${avatarStyle}>${escapeText(senderName[0]?.toUpperCase() || "U")}</button>
          <div class="dm-message other group-message"><button type="button" class="group-message-sender" data-user-profile="${escapeText(message.sender_id)}">${escapeText(senderName)} <small>UID ${escapeText(message.sender_uid || "—")}</small></button>${media}${content ? `<p>${escapeText(content)}</p>` : ""}<time>${escapeText(time)}</time></div>
        </article>`;
      }
      const imageUrl = message.image_path ? imageUrls.get(message.image_path) : "";
      const image = renderMessageMedia(message.image_path, imageUrl, "私信媒体");
      return `<article class="dm-message ${own ? "own" : "other"}">${image}${content ? `<p>${escapeText(content)}</p>` : ""}<time>${new Date(message.created_at).toLocaleString("zh-CN", { hour12: false })}</time></article>`;
    }).join("") : `<p class="forum-empty">还没有消息，打个招呼吧。</p>`;
    renderedMessageKey = key;
    renderedMessageCount = messages.length;
    hasRenderedMessages = true;
    signedImageRefreshAt = imagePaths.length
      ? Date.now() + (imagePaths.every(path => imageUrls.has(path)) ? 45 * 60 * 1000 : 60 * 1000)
      : 0;
    if (wasRendered && messages.length > previousCount) {
      const incoming = messages.slice(previousCount).filter(message => group
        ? message.sender_id !== viewer
        : message.sender_id === peer);
      if (incoming.length) {
        announceMessage(group
          ? `${targetName} 有 ${incoming.length} 条新消息`
          : `收到 ${incoming.length} 条来自 ${targetName} 的新私信`);
        if (group) markCurrentChatRead(null, group);
      }
    }
    if (forceScroll || isNearBottom) list.scrollTop = list.scrollHeight;
  }

  async function sendMessage(event) {
    event.preventDefault();
    const recipient = targetUser;
    const group = targetGroup;
    const conversationKey = currentChatKey();
    if (!recipient && !group) return;
    const sender = chatOwner || window.blogAuth?.user?.id;
    if (!sender || sender !== window.blogAuth?.user?.id) return;
    const form = event.currentTarget;
    const content = form.elements.content.value.trim();
    const image = selectedImageFile;
    if (!content && !image) return;
    const button = form.querySelector("[data-send-message]");
    if (!button) return;
    if (form.dataset.sending === "true") return;
    const normalText = button.textContent;
    const contentInput = form.elements.content;
    const imageInput = $("#messageImageInput");
    let imagePath = null;
    form.dataset.sending = "true";
    form.setAttribute("aria-busy", "true");
    button.disabled = true;
    if (contentInput) contentInput.disabled = true;
    if (imageInput) imageInput.disabled = true;
    form.classList.add("is-uploading");
    try {
      if (image && recipient) {
        button.textContent = "…";
        imagePath = await window.blogAuth.uploadDirectMessageImage(recipient, image);
        if (!imagePath) return;
      } else if (image && group) {
        button.textContent = "…";
        imagePath = await window.blogAuth.uploadGroupChatMedia(group, image);
        if (!imagePath) return;
      }
      if (currentChatKey() !== conversationKey || sender !== window.blogAuth?.user?.id) {
        if (imagePath) await (group
          ? window.blogAuth.deleteGroupChatMedia(imagePath)
          : window.blogAuth.deleteDirectMessageImage(imagePath));
        return;
      }
      button.textContent = "…";
      const ok = group
        ? await window.blogAuth.sendGroupChatMessage(group, content, imagePath)
        : await window.blogAuth.sendDirectMessage(recipient, content, imagePath);
      if (!ok) {
        if (imagePath) await (group
          ? window.blogAuth.deleteGroupChatMedia(imagePath)
          : window.blogAuth.deleteDirectMessageImage(imagePath));
        return;
      }
      form.reset();
      clearImageSelection();
      signedImageRefreshAt = 0;
      await renderMessages({ forceScroll: true });
    } finally {
      delete form.dataset.sending;
      form.removeAttribute("aria-busy");
      button.disabled = false;
      if (contentInput) contentInput.disabled = false;
      if (imageInput) imageInput.disabled = false;
      button.textContent = normalText;
      form.classList.remove("is-uploading");
    }
  }

  function setGroupFormMessage(element, message = "") {
    if (!element) return;
    element.textContent = message;
    element.hidden = !message;
  }

  function openDialog(dialog) {
    if (!dialog || dialog.open) return;
    if (window.blogUI?.openDialog) window.blogUI.openDialog(dialog);
    else dialog.showModal();
  }

  function closeDialog(dialog) {
    if (!dialog?.open) return;
    if (window.blogUI?.closeDialog) window.blogUI.closeDialog(dialog);
    else dialog.close();
  }

  function friendPickerMarkup(friend, checked = false) {
    const name = friend.username || "社区用户";
    const avatarUrl = safeAvatarUrl(friend.avatar_url);
    const style = avatarUrl ? ` style="background-image:url(&quot;${escapeText(avatarUrl)}&quot;)"` : "";
    return `<label class="group-friend-option">
      <input type="checkbox" name="member_id" value="${escapeText(friend.id)}"${checked ? " checked" : ""}>
      <span class="group-picker-avatar ${avatarUrl ? "has-image" : ""}"${style}>${escapeText(name[0]?.toUpperCase() || "U")}</span>
      <span><strong>${escapeText(name)}</strong><small>${escapeText(friend.display_title || "社区成员")} · UID ${escapeText(friend.user_uid || "—")}</small></span><i aria-hidden="true">✓</i>
    </label>`;
  }

  async function renderGroupFriendPicker(container, excluded = new Set()) {
    if (!container) return [];
    container.innerHTML = `<p class="social-empty">正在加载好友…</p>`;
    const friends = await window.blogAuth?.listFriends?.() || [];
    const available = friends.filter(friend => !excluded.has(friend.id));
    container.innerHTML = available.length
      ? available.map(friend => friendPickerMarkup(friend)).join("")
      : `<p class="social-empty">没有可添加的好友。需要先与对方互相关注。</p>`;
    return available;
  }

  async function openCreateGroupDialog() {
    if (!window.blogAuth?.user) return window.blogAuth?.openAuth?.("login");
    const dialog = $("#createGroupChatDialog");
    const form = $("#createGroupChatForm");
    form?.reset();
    setGroupFormMessage($("#createGroupChatError"));
    openDialog(dialog);
    await renderGroupFriendPicker($("#createGroupFriendPicker"));
  }

  async function submitCreateGroup(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const error = $("#createGroupChatError");
    setGroupFormMessage(error);
    if (!form.checkValidity()) return form.reportValidity();
    const selected = [...form.querySelectorAll('input[name="member_id"]:checked')].map(input => input.value);
    if (!selected.length) return setGroupFormMessage(error, "请至少选择一位互相关注的好友");
    const data = new FormData(form);
    const button = form.querySelector(".primary-btn");
    const normalText = button.textContent;
    button.disabled = true;
    button.textContent = "正在创建…";
    try {
      const groupId = await window.blogAuth.createGroupChat(
        data.get("name"), data.get("description"), data.get("avatar_url"), selected
      );
      if (!groupId) return setGroupFormMessage(error, "创建失败，请检查数据库配置或稍后重试");
      const name = String(data.get("name") || "群聊").trim();
      const meta = {
        group_id: groupId,
        group_name: name,
        group_description: String(data.get("description") || "").trim(),
        group_avatar_url: String(data.get("avatar_url") || "").trim(),
        group_role: "owner",
        member_count: selected.length + 1,
        unread_count: 0
      };
      closeDialog($("#createGroupChatDialog"));
      window.toast?.("群聊已创建");
      window.renderMessageGroups?.();
      await openGroupChat(groupId, name, meta);
    } finally {
      button.disabled = false;
      button.textContent = normalText;
    }
  }

  function groupAvatarMarkup(meta, className = "group-info-avatar") {
    const name = meta?.group_name || targetName || "群聊";
    const avatarUrl = safeAvatarUrl(meta?.group_avatar_url);
    const style = avatarUrl ? ` style="background-image:url(&quot;${escapeText(avatarUrl)}&quot;)"` : "";
    return `<span class="${className} ${avatarUrl ? "has-image" : ""}"${style}>${escapeText(name[0]?.toUpperCase() || "群")}</span>`;
  }

  async function loadGroupInfo() {
    if (!targetGroup) return;
    const groupId = targetGroup;
    const hero = $("#groupChatInfoHero");
    const memberList = $("#groupChatMemberList");
    if (hero) hero.innerHTML = `<p class="social-empty">正在加载群资料…</p>`;
    if (memberList) memberList.innerHTML = `<p class="social-empty">正在加载群成员…</p>`;
    const [groups, members] = await Promise.all([
      window.blogAuth.listGroupChats(),
      window.blogAuth.listGroupChatMembers(groupId)
    ]);
    if (groupId !== targetGroup) return;
    const meta = (groups || []).find(group => group.group_id === groupId) || targetGroupMeta || {
      group_id: groupId, group_name: targetName, group_role: "member", member_count: members.length
    };
    targetGroupMeta = meta;
    targetName = meta.group_name || targetName;
    const canManage = meta.group_role === "owner" || meta.group_role === "admin";
    if (hero) hero.innerHTML = `${groupAvatarMarkup(meta)}<div><h3>${escapeText(targetName)}</h3><p>${escapeText(meta.group_description || "这个群还没有简介。")}</p><small>${Number(meta.member_count || members.length)} 位成员 · ${meta.group_role === "owner" ? "群主" : meta.group_role === "admin" ? "管理员" : "成员"}</small></div>`;
    const form = $("#groupChatInfoForm");
    if (form) {
      form.hidden = !canManage;
      form.elements.name.value = targetName;
      form.elements.description.value = meta.group_description || "";
      form.elements.avatar_url.value = meta.group_avatar_url || "";
    }
    const addButton = $("#toggleAddGroupMembersBtn");
    if (addButton) addButton.hidden = !canManage;
    $("#groupAddMembersPanel").hidden = true;
    $("#groupMemberCount").textContent = `${members.length} 人`;
    const viewer = window.blogAuth?.user?.id;
    if (memberList) memberList.innerHTML = members.length ? members.map(member => {
      const name = member.username || "社区用户";
      const avatarUrl = safeAvatarUrl(member.avatar_url);
      const style = avatarUrl ? ` style="background-image:url(&quot;${escapeText(avatarUrl)}&quot;)"` : "";
      const removable = canManage && member.user_id !== viewer && member.member_role !== "owner"
        && (meta.group_role === "owner" || member.member_role === "member");
      return `<article class="group-member-item">
        <button type="button" class="group-member-avatar ${avatarUrl ? "has-image" : ""}" data-user-profile="${escapeText(member.user_id)}"${style}>${escapeText(name[0]?.toUpperCase() || "U")}</button>
        <button type="button" class="group-member-profile" data-user-profile="${escapeText(member.user_id)}"><strong>${escapeText(name)}</strong><small>${escapeText(member.display_title || "社区成员")} · UID ${escapeText(member.user_uid || "—")}</small></button>
        <span class="group-role ${escapeText(member.member_role)}">${member.member_role === "owner" ? "群主" : member.member_role === "admin" ? "管理员" : "成员"}</span>
        ${removable ? `<button type="button" class="group-member-remove" data-remove-group-member="${escapeText(member.user_id)}" data-remove-group-name="${escapeText(name)}" aria-label="移除 ${escapeText(name)}">×</button>` : ""}
      </article>`;
    }).join("") : `<p class="social-empty">暂时无法读取群成员。</p>`;
    $("#messageTitle").textContent = targetName;
    setConversationAvatar(targetName, meta.group_avatar_url, true);
    setChatStatus(`${Number(meta.member_count || members.length)} 位成员 · 实时群聊`, "connected");
  }

  async function openGroupInfo() {
    if (!targetGroup) return;
    openDialog($("#groupChatInfoDialog"));
    await loadGroupInfo();
  }

  async function saveGroupInfo(event) {
    event.preventDefault();
    if (!targetGroup) return;
    const form = event.currentTarget;
    if (!form.checkValidity()) return form.reportValidity();
    const data = new FormData(form);
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const ok = await window.blogAuth.updateGroupChat(targetGroup, data.get("name"), data.get("description"), data.get("avatar_url"));
      if (!ok) return;
      window.toast?.("群资料已保存");
      await loadGroupInfo();
      window.renderMessageGroups?.();
    } finally {
      button.disabled = false;
    }
  }

  async function toggleAddGroupMembers() {
    if (!targetGroup) return;
    const panel = $("#groupAddMembersPanel");
    panel.hidden = !panel.hidden;
    if (panel.hidden) return;
    const members = await window.blogAuth.listGroupChatMembers(targetGroup);
    await renderGroupFriendPicker($("#groupAddFriendPicker"), new Set(members.map(member => member.user_id)));
  }

  async function confirmAddGroupMembers() {
    if (!targetGroup) return;
    const panel = $("#groupAddMembersPanel");
    const selected = [...panel.querySelectorAll('input[name="member_id"]:checked')].map(input => input.value);
    if (!selected.length) return window.toast?.("请先选择要添加的好友");
    const button = $("#confirmAddGroupMembersBtn");
    button.disabled = true;
    try {
      const count = await window.blogAuth.addGroupChatMembers(targetGroup, selected);
      if (!count) return;
      window.toast?.(`已添加 ${count} 位群成员`);
      await loadGroupInfo();
      window.renderMessageGroups?.();
    } finally {
      button.disabled = false;
    }
  }

  async function removeGroupMember(button) {
    if (!targetGroup) return;
    const name = button.dataset.removeGroupName || "这位成员";
    if (!window.confirm(`确定将 ${name} 移出群聊吗？`)) return;
    button.disabled = true;
    const ok = await window.blogAuth.removeGroupChatMember(targetGroup, button.dataset.removeGroupMember);
    if (ok) {
      window.toast?.("成员已移出群聊");
      await loadGroupInfo();
      window.renderMessageGroups?.();
    } else button.disabled = false;
  }

  async function leaveActiveGroup() {
    if (!targetGroup || !window.confirm("确定退出这个群聊吗？退出后将无法查看群消息。")) return;
    const groupId = targetGroup;
    const button = $("#leaveGroupChatBtn");
    button.disabled = true;
    try {
      const ok = await window.blogAuth.leaveGroupChat(groupId);
      if (!ok) return;
      closeDialog($("#groupChatInfoDialog"));
      closeChat();
      window.toast?.("已退出群聊");
      window.renderMessageGroups?.();
    } finally {
      button.disabled = false;
    }
  }

  function init() {
    $("#messageForm")?.addEventListener("submit", sendMessage);
    $("#messageImageInput")?.addEventListener("change", selectMessageImage);
    $("#removeMessageImageBtn")?.addEventListener("click", clearImageSelection);
    $("#messageForm textarea")?.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        $("#messageForm").requestSubmit();
      }
    });
    $("#messageBackBtn")?.addEventListener("click", closeChat);
    $("#messageInfoBtn")?.addEventListener("click", openGroupInfo);
    $("#createGroupChatBtn")?.addEventListener("click", openCreateGroupDialog);
    $("#createGroupChatForm")?.addEventListener("submit", submitCreateGroup);
    $("#groupChatInfoForm")?.addEventListener("submit", saveGroupInfo);
    $("#toggleAddGroupMembersBtn")?.addEventListener("click", toggleAddGroupMembers);
    $("#confirmAddGroupMembersBtn")?.addEventListener("click", confirmAddGroupMembers);
    $("#leaveGroupChatBtn")?.addEventListener("click", leaveActiveGroup);
    window.addEventListener("blog-page-change", event => {
      if (event.detail?.page === "messages") activateMessages();
      else {
        stopChatSync();
        document.body.classList.remove("message-thread-open");
      }
    });
    window.addEventListener("blog-auth-change", () => {
      const currentUserId = window.blogAuth?.user?.id || null;
      if (!currentUserId || (chatOwner && chatOwner !== currentUserId)) {
        closeChat();
        return;
      }
      if (isMessagesPage()) window.renderMessageFriends?.();
    });
    document.addEventListener("click", event => {
      const follow = event.target.closest("[data-follow-user]");
      const chat = event.target.closest("[data-chat-user]");
      const groupChat = event.target.closest("[data-group-chat]");
      const removeMember = event.target.closest("[data-remove-group-member]");
      const profileLink = event.target.closest("[data-user-profile]");
      const ownProfile = event.target.closest("[data-open-own-profile]");
      if (follow) {
        event.stopPropagation();
        toggleFollow(follow);
        return;
      }
      if (chat) {
        event.stopPropagation();
        openChat(chat.dataset.chatUser, chat.dataset.chatName);
        return;
      }
      if (groupChat) {
        event.stopPropagation();
        openGroupChat(groupChat.dataset.groupChat, groupChat.dataset.groupName, {
          group_id: groupChat.dataset.groupChat,
          group_name: groupChat.dataset.groupName,
          group_description: groupChat.dataset.groupDescription || "",
          group_avatar_url: groupChat.dataset.groupAvatar || "",
          group_role: groupChat.dataset.groupRole || "member",
          member_count: Number(groupChat.dataset.groupMembers || 0),
          unread_count: Number(groupChat.dataset.groupUnread || 0)
        });
        return;
      }
      if (removeMember) {
        event.stopPropagation();
        removeGroupMember(removeMember);
        return;
      }
      if (profileLink) {
        event.stopPropagation();
        openPublicProfile(profileLink.dataset.userProfile);
        return;
      }
      if (ownProfile) {
        event.stopPropagation();
        if ($("#publicProfileDialog")?.open) {
          if (window.blogUI?.closeDialog) window.blogUI.closeDialog($("#publicProfileDialog"));
          else $("#publicProfileDialog").close();
        }
        if (window.blogUI?.navigate) window.blogUI.navigate("profile", { focus: true });
        else window.blogAuth?.openAuth?.();
      }
    });
  }

  window.hydrateFollowButton = hydrateFollowButton;
  window.openPublicProfile = openPublicProfile;
  window.openChat = openChat;
  window.openGroupChat = openGroupChat;
  window.openCreateGroupChat = openCreateGroupDialog;
  window.blogMessages = {
    activate: activateMessages,
    close: closeChat,
    get peer() { return targetUser; },
    get group() { return targetGroup; },
    get type() { return targetGroup ? "group" : targetUser ? "direct" : null; }
  };
  document.addEventListener("DOMContentLoaded", init, { once: true });
})();
