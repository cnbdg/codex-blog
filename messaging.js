(() => {
  "use strict";
  const $ = selector => document.querySelector(selector);
  let targetUser = null;
  let targetName = "社区用户";
  let profileRequest = 0;
  let stopMessageSync = null;

  const escapeText = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[char]);

  function setFollowButton(button, state) {
    button.classList.toggle("following", Boolean(state?.following));
    button.textContent = state?.following ? (state?.mutual ? "互相关注" : "已关注") : "关注";
    button.title = state?.mutual ? "可以私聊" : state?.following ? "等待对方回关后可私聊" : "关注后等待对方回关";
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
    return date.toLocaleDateString("zh-CN", {
      year: "numeric", month: "long", day: "numeric"
    });
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
    window.toast?.(state.mutual ? "已互相关注，现在可以私聊了" : state.following ? "已关注，等待对方回关" : "已取消关注");
  }

  async function openPublicProfile(userId) {
    if (!userId) return;
    const dialog = $("#publicProfileDialog");
    const content = $("#publicProfileContent");
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
    const title = publicProfile.is_admin ? "站长" : (publicProfile.display_title || "社区成员");
    const avatarUrl = safeAvatarUrl(publicProfile.avatar_url);
    const avatarStyle = avatarUrl ? ` style="background-image:url(&quot;${escapeText(avatarUrl)}&quot;)"` : "";
    const state = ownProfile ? null : await window.blogAuth?.getFollowState?.(publicProfile.id);
    if (request !== profileRequest || !dialog.open) return;

    content.innerHTML = `
      <div class="profile-cover"><span></span><span></span><span></span></div>
      <div class="profile-identity">
        <div class="profile-avatar-large ${avatarUrl ? "has-image" : ""}"${avatarStyle}>${escapeText(name[0]?.toUpperCase() || "U")}</div>
        <div class="profile-name-row"><div><h2>${escapeText(name)}</h2><span class="user-title ${publicProfile.is_admin ? "admin" : ""}">${escapeText(title)}</span></div><span class="profile-uid">UID ${publicProfile.user_uid || "—"}</span></div>
      </div>
      <div class="profile-facts">
        <div><small>社区身份</small><strong>${escapeText(title)}</strong></div>
        <div><small>加入时间</small><strong>${escapeText(formatJoinDate(publicProfile.created_at))}</strong></div>
        <div><small>账户状态</small><strong>${publicProfile.is_admin ? "社区管理员" : "正常使用中"}</strong></div>
      </div>
      <p class="profile-privacy-note">这里只展示公开社区资料，不会显示邮箱等隐私信息。</p>
      <div class="profile-actions">
        ${ownProfile
          ? `<button type="button" class="profile-edit-button" data-open-own-profile>编辑我的资料</button>`
          : `<button type="button" class="follow-button profile-follow ${state?.following ? "following" : ""}" data-follow-user="${escapeText(publicProfile.id)}">${state?.following ? (state?.mutual ? "互相关注" : "已关注") : "＋ 关注"}</button>
             <button type="button" class="chat-button profile-chat ${state?.mutual ? "available" : ""}" data-chat-user="${escapeText(publicProfile.id)}" data-chat-name="${escapeText(name)}" data-profile-chat="${escapeText(publicProfile.id)}" title="${state?.mutual ? "发送私信" : "互相关注后即可私信"}">✉ 私信</button>`}
      </div>`;
  }

  async function openChat(userId, name) {
    if (!window.blogAuth?.user) return window.blogAuth?.openAuth("login");
    const state = await window.blogAuth.getFollowState(userId);
    if (!state?.mutual) return window.toast?.("只有互相关注后才能私聊");
    targetUser = userId;
    targetName = name || "社区用户";
    $("#dmTitle").textContent = targetName;
    $("#dmPeerAvatar").textContent = targetName.slice(0, 1).toUpperCase();
    $("#dmList").innerHTML = `<p class="forum-empty">正在加载消息…</p>`;
    $("#dmDialog").showModal();
    stopMessageSync?.();
    stopMessageSync = window.blogAuth.subscribeDirectMessages?.(targetUser, () => renderMessages());
    await renderMessages();
  }

  async function renderMessages() {
    if (!targetUser) return;
    const messages = await window.blogAuth.listDirectMessages(targetUser);
    if (!messages) return;
    $("#dmList").innerHTML = messages.length ? messages.map(message => {
      const own = message.sender_id === window.blogAuth.user?.id;
      return `<article class="dm-message ${own ? "own" : "other"}"><p>${escapeText(message.content)}</p><time>${new Date(message.created_at).toLocaleString("zh-CN", { hour12: false })}</time></article>`;
    }).join("") : `<p class="forum-empty">还没有消息，打个招呼吧。</p>`;
    const list = $("#dmList");
    list.scrollTop = list.scrollHeight;
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (!targetUser) return;
    const form = event.currentTarget;
    const content = form.elements.content.value.trim();
    if (!content) return;
    const button = form.querySelector("button");
    button.disabled = true;
    const ok = await window.blogAuth.sendDirectMessage(targetUser, content);
    button.disabled = false;
    if (!ok) return;
    form.reset();
    await renderMessages();
  }

  function init() {
    $("#dmForm").addEventListener("submit", sendMessage);
    $("#dmForm textarea")?.addEventListener("keydown", event => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        $("#dmForm").requestSubmit();
      }
    });
    $("#dmDialog")?.addEventListener("close", () => { stopMessageSync?.(); stopMessageSync = null; targetUser = null; });
    document.addEventListener("click", event => {
      const follow = event.target.closest("[data-follow-user]");
      const chat = event.target.closest("[data-chat-user]");
      const profileLink = event.target.closest("[data-user-profile]");
      const ownProfile = event.target.closest("[data-open-own-profile]");
      if (follow) { event.stopPropagation(); toggleFollow(follow); }
      if (chat) { event.stopPropagation(); openChat(chat.dataset.chatUser, chat.dataset.chatName); }
      if (profileLink) { event.stopPropagation(); openPublicProfile(profileLink.dataset.userProfile); }
      if (ownProfile) {
        event.stopPropagation();
        if ($("#publicProfileDialog").open) $("#publicProfileDialog").close();
        window.blogAuth?.openAuth?.();
      }
    });
  }

  window.hydrateFollowButton = hydrateFollowButton;
  window.openPublicProfile = openPublicProfile;
  document.addEventListener("DOMContentLoaded", init, { once: true });
})();
