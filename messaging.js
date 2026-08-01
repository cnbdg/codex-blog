(() => {
  "use strict";

  const $ = selector => document.querySelector(selector);
  let targetUser = null;
  let targetName = "社区用户";
  let profileRequest = 0;
  let stopMessageSync = null;
  let messagePoll = null;
  let renderedMessageKey = null;
  let hasRenderedMessages = false;
  let selectedImageFile = null;
  let selectedImagePreviewUrl = "";
  let signedImageRefreshAt = 0;

  const messageImageTypes = new Set([
    "image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"
  ]);

  const escapeText = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[char]);
  const isMessagesPage = () => document.getElementById("messages")?.classList.contains("active");
  const isChatVisible = () => Boolean(targetUser && isMessagesPage() && !$("#messageThread")?.hidden);

  function clearImageSelection() {
    if (selectedImagePreviewUrl && globalThis.URL?.revokeObjectURL) {
      globalThis.URL.revokeObjectURL(selectedImagePreviewUrl);
    }
    selectedImageFile = null;
    selectedImagePreviewUrl = "";
    const input = $("#messageImageInput");
    const preview = $("#messageImagePreview");
    const previewImage = $("#messageImagePreview img");
    if (input) input.value = "";
    if (previewImage) previewImage.removeAttribute("src");
    if (preview) preview.hidden = true;
  }

  function selectMessageImage(event) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (!messageImageTypes.has(file.type) || file.size > 5 * 1024 * 1024) {
      clearImageSelection();
      window.toast?.("私信图片需为 JPG、PNG、GIF、WebP 或 AVIF，且不超过 5MB。");
      return;
    }
    if (selectedImagePreviewUrl && globalThis.URL?.revokeObjectURL) {
      globalThis.URL.revokeObjectURL(selectedImagePreviewUrl);
    }
    selectedImageFile = file;
    selectedImagePreviewUrl = globalThis.URL?.createObjectURL?.(file) || "";
    const preview = $("#messageImagePreview");
    const previewImage = $("#messageImagePreview img");
    const previewName = $("#messageImagePreviewName");
    if (previewImage) previewImage.src = selectedImagePreviewUrl;
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
    status.innerHTML = `<i></i>${escapeText(message)}`;
  }

  function notifyInboxChanged() {
    window.dispatchEvent(new Event("blog-notifications-change"));
  }

  async function markCurrentChatRead(peer = targetUser) {
    if (!peer) return;
    const marked = await window.blogAuth?.markDirectMessagesRead?.(peer);
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
    if (!peer || !isChatVisible()) return;
    stopChatSync();
    let connected = false;
    stopMessageSync = window.blogAuth?.subscribeDirectMessages?.(peer, async row => {
      if (targetUser !== peer || !isChatVisible()) return;
      await renderMessages({ forceScroll: true });
      if (row.sender_id === peer) await markCurrentChatRead(peer);
    }, status => {
      if (targetUser !== peer || !isChatVisible()) return;
      if (status === "SUBSCRIBED") {
        connected = true;
        setChatStatus("实时聊天已连接", "connected");
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setChatStatus("实时连接重试中 · 自动同步已开启", "fallback");
      } else if (status === "CLOSED" && !connected) {
        setChatStatus("正在自动同步消息", "fallback");
      }
    }) || (() => {});

    // Realtime 短暂不可用时仍通过短轮询保证消息会出现。
    messagePoll = window.setInterval(() => {
      if (document.hidden || targetUser !== peer || !isChatVisible()) return;
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
    if (!dialog.open) dialog.showModal();

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
    const state = await window.blogAuth.getFollowState(userId);
    if (!state?.mutual) return window.toast?.("只有互相关注后才能私聊");

    targetUser = userId;
    targetName = name || "社区用户";
    renderedMessageKey = null;
    hasRenderedMessages = false;
    signedImageRefreshAt = 0;
    $("#messageForm")?.reset();
    clearImageSelection();
    $("#messageTitle").textContent = targetName;
    $("#messagePeerAvatar").textContent = targetName.slice(0, 1).toUpperCase();
    $("#messageList").innerHTML = `<p class="forum-empty">正在加载消息…</p>`;
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

  function closeChat() {
    stopChatSync();
    targetUser = null;
    renderedMessageKey = null;
    hasRenderedMessages = false;
    signedImageRefreshAt = 0;
    $("#messageForm")?.reset();
    clearImageSelection();
    showMessageThread(false);
    $("#messageList").replaceChildren();
  }

  function activateMessages() {
    if (!isMessagesPage() || !targetUser) return;
    showMessageThread(true);
    if (!stopMessageSync) startChatSync();
    renderMessages({ forceScroll: !hasRenderedMessages });
  }

  async function renderMessages({ forceScroll = false } = {}) {
    if (!targetUser || !isChatVisible()) return;
    const peer = targetUser;
    const messages = await window.blogAuth.listDirectMessages(peer);
    if (!messages || peer !== targetUser || !isChatVisible()) return;
    const key = messages.length ? messages.map(message => `${message.id}:${message.created_at}:${message.image_path || ""}`).join("|") : "empty";
    const imagePaths = messages.map(message => message.image_path).filter(Boolean);
    const shouldRefreshImages = imagePaths.length && Date.now() >= signedImageRefreshAt;
    if (hasRenderedMessages && key === renderedMessageKey && !shouldRefreshImages) return;
    const list = $("#messageList");
    const isNearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 72;
    const imageUrls = imagePaths.length
      ? (await window.blogAuth?.getDirectMessageImageUrls?.(imagePaths)) || new Map()
      : new Map();
    if (peer !== targetUser || !isChatVisible()) return;
    list.innerHTML = messages.length ? messages.map(message => {
      const own = message.sender_id === window.blogAuth.user?.id;
      const content = String(message.content || "").trim();
      const imageUrl = message.image_path ? imageUrls.get(message.image_path) : "";
      const image = message.image_path
        ? (imageUrl
          ? `<a class="dm-image-link" href="${escapeText(imageUrl)}" target="_blank" rel="noopener"><img src="${escapeText(imageUrl)}" alt="私信图片" loading="lazy"></a>`
          : `<p class="dm-image-unavailable">图片暂时无法加载</p>`)
        : "";
      return `<article class="dm-message ${own ? "own" : "other"}">${image}${content ? `<p>${escapeText(content)}</p>` : ""}<time>${new Date(message.created_at).toLocaleString("zh-CN", { hour12: false })}</time></article>`;
    }).join("") : `<p class="forum-empty">还没有消息，打个招呼吧。</p>`;
    renderedMessageKey = key;
    hasRenderedMessages = true;
    signedImageRefreshAt = imagePaths.length
      ? Date.now() + (imagePaths.every(path => imageUrls.has(path)) ? 45 * 60 * 1000 : 60 * 1000)
      : 0;
    if (forceScroll || isNearBottom) list.scrollTop = list.scrollHeight;
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (!targetUser) return;
    const recipient = targetUser;
    const form = event.currentTarget;
    const content = form.elements.content.value.trim();
    const image = selectedImageFile;
    if (!content && !image) return;
    const button = form.querySelector("[data-send-message]");
    if (!button) return;
    const normalText = button.textContent;
    let imagePath = null;
    button.disabled = true;
    form.classList.add("is-uploading");
    try {
      if (image) {
        button.textContent = "…";
        imagePath = await window.blogAuth.uploadDirectMessageImage(recipient, image);
        if (!imagePath) return;
      }
      if (targetUser !== recipient) {
        if (imagePath) await window.blogAuth.deleteDirectMessageImage(imagePath);
        return;
      }
      button.textContent = "…";
      const ok = await window.blogAuth.sendDirectMessage(recipient, content, imagePath);
      if (!ok) {
        if (imagePath) await window.blogAuth.deleteDirectMessageImage(imagePath);
        return;
      }
      form.reset();
      clearImageSelection();
      signedImageRefreshAt = 0;
      await renderMessages({ forceScroll: true });
    } finally {
      button.disabled = false;
      button.textContent = normalText;
      form.classList.remove("is-uploading");
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
    window.addEventListener("blog-page-change", event => {
      if (event.detail?.page === "messages") activateMessages();
      else {
        stopChatSync();
        document.body.classList.remove("message-thread-open");
      }
    });
    document.addEventListener("click", event => {
      const follow = event.target.closest("[data-follow-user]");
      const chat = event.target.closest("[data-chat-user]");
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
      if (profileLink) {
        event.stopPropagation();
        openPublicProfile(profileLink.dataset.userProfile);
        return;
      }
      if (ownProfile) {
        event.stopPropagation();
        if ($("#publicProfileDialog")?.open) $("#publicProfileDialog").close();
        window.blogAuth?.openAuth?.();
      }
    });
  }

  window.hydrateFollowButton = hydrateFollowButton;
  window.openPublicProfile = openPublicProfile;
  window.openChat = openChat;
  window.blogMessages = { activate: activateMessages, close: closeChat, get peer() { return targetUser; } };
  document.addEventListener("DOMContentLoaded", init, { once: true });
})();
