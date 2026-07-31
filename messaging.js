(() => {
  "use strict";
  const $ = selector => document.querySelector(selector);
  let targetUser = null;
  let targetName = "社区用户";

  const escapeText = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[char]);

  function setFollowButton(button, state) {
    button.classList.toggle("following", Boolean(state?.following));
    button.textContent = state?.following ? (state?.mutual ? "互相关注" : "已关注") : "关注";
    button.title = state?.mutual ? "可以私聊" : state?.following ? "等待对方回关后可私聊" : "关注后等待对方回关";
  }

  async function hydrateFollowButton(button) {
    if (!window.blogAuth?.user) return setFollowButton(button, null);
    const state = await window.blogAuth.getFollowState(button.dataset.userId);
    if (state) setFollowButton(button, state);
  }

  async function toggleFollow(button) {
    if (!window.blogAuth?.user) return window.blogAuth?.openAuth("login");
    button.disabled = true;
    const state = await window.blogAuth.toggleFollow(button.dataset.userId);
    button.disabled = false;
    if (!state) return;
    setFollowButton(button, state);
    document.querySelectorAll(`[data-follow-user="${button.dataset.userId}"]`).forEach(item => setFollowButton(item, state));
    window.toast?.(state.mutual ? "已互相关注，现在可以私聊了" : state.following ? "已关注，等待对方回关" : "已取消关注");
  }

  async function openChat(userId, name) {
    if (!window.blogAuth?.user) return window.blogAuth?.openAuth("login");
    const state = await window.blogAuth.getFollowState(userId);
    if (!state?.mutual) return window.toast?.("只有互相关注后才能私聊");
    targetUser = userId;
    targetName = name || "社区用户";
    $("#dmTitle").textContent = `与 ${targetName} 私聊`;
    $("#dmList").innerHTML = `<p class="forum-empty">正在加载消息…</p>`;
    $("#dmDialog").showModal();
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
    document.addEventListener("click", event => {
      const follow = event.target.closest("[data-follow-user]");
      const chat = event.target.closest("[data-chat-user]");
      if (follow) { event.stopPropagation(); toggleFollow(follow); }
      if (chat) { event.stopPropagation(); openChat(chat.dataset.chatUser, chat.dataset.chatName); }
    });
  }

  window.hydrateFollowButton = hydrateFollowButton;
  document.addEventListener("DOMContentLoaded", init, { once: true });
})();
