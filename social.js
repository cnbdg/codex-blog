(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  let timer = null;
  let stopNotificationSync = null;
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;", "'":"&#039;"}[c]));
  const avatar = (row) => row.actor_avatar_url || row.avatar_url;
  const avatarMarkup = (row) => { const url = avatar(row); const id = row.actor_id || row.id || ""; return `<button type="button" class="social-avatar ${url ? "has-image" : ""}" data-user-profile="${esc(id)}" aria-label="查看用户资料"${url ? ` style="background-image:url('${esc(url)}')"` : ""}>${esc((row.actor_username || row.username || "U")[0].toUpperCase())}</button>`; };
  function time(v) { return new Date(v).toLocaleString("zh-CN", { month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit" }); }
  function ensureBadge() {
    const button = $("#notificationBtn");
    if (!button) return null;
    let badge = button.querySelector(".notification-badge");
    if (!badge) { badge = document.createElement("span"); badge.className = "notification-badge"; badge.hidden = true; button.append(badge); }
    return badge;
  }
  async function refreshBadge() {
    const badge = ensureBadge();
    if (!badge) return;
    if (!window.blogAuth?.user) { badge.hidden = true; return; }
    const rows = await window.blogAuth.listNotifications();
    const unread = rows.filter(row => !row.read_at).length;
    badge.hidden = unread === 0;
    badge.textContent = unread > 99 ? "99+" : String(unread);
    badge.setAttribute("aria-label", `${unread} 条未读通知`);
    const mobile = document.querySelector('#mobileDock [data-mobile-action="notifications"]');
    if (mobile) {
      mobile.toggleAttribute("data-unread", unread > 0);
      mobile.dataset.unread = unread > 99 ? "99+" : String(unread);
    }
  }
  async function renderNotifications() {
    const list = $("#notificationList"); if (!list) return;
    if (!window.blogAuth?.user) { list.innerHTML = `<p class="social-empty">登录后即可查看通知。</p>`; return; }
    const rows = await window.blogAuth.listNotifications();
    list.innerHTML = rows.length ? rows.map(row => `<article class="notification-item ${row.read_at ? "read" : "unread"}">${avatarMarkup(row)}<div><p><strong>${esc(row.actor_username || "社区用户")}</strong> ${esc(row.payload?.message || "有一条新动态")}</p><time>${time(row.created_at)}</time></div></article>`).join("") : `<p class="social-empty">还没有新的通知。</p>`;
  }
  async function renderFriends() {
    const list = $("#friendList"); if (!list) return;
    if (!window.blogAuth?.user) { list.innerHTML = `<p class="social-empty">登录后，互相关注的用户会出现在这里。</p>`; return; }
    const rows = await window.blogAuth.listFriends();
    list.innerHTML = rows.length ? rows.map(row => `<button type="button" class="friend-item" data-user-profile="${esc(row.id)}">${row.avatar_url ? `<span class="social-avatar has-image" style="background-image:url('${esc(row.avatar_url)}')"></span>` : `<span class="social-avatar">${esc((row.username || "U")[0].toUpperCase())}</span>`}<span class="friend-copy"><strong>${esc(row.username)}</strong><small>${esc(row.display_title || "社区成员")} · UID ${esc(row.user_uid)}</small></span><i class="online-dot" title="好友"></i></button>`).join("") : `<p class="social-empty">还没有好友。互相关注后会自动出现在这里。</p>`;
  }
  async function openSocial(tab = "notifications") {
    const dialog = $("#socialDialog"); if (!dialog) return;
    dialog.showModal();
    document.querySelectorAll("[data-social-tab]").forEach(b => b.classList.toggle("active", b.dataset.socialTab === tab));
    $("#notificationPanel").hidden = tab !== "notifications"; $("#friendsPanel").hidden = tab !== "friends";
    if (tab === "notifications") { await renderNotifications(); await window.blogAuth?.markNotificationsRead?.(); await refreshBadge(); }
    else await renderFriends();
  }
  function init() {
    $("#notificationBtn")?.addEventListener("click", () => openSocial("notifications"));
    $("#friendsBtn")?.addEventListener("click", () => openSocial("friends"));
    $("#refreshFriendsBtn")?.addEventListener("click", renderFriends);
    document.addEventListener("click", e => { const tab = e.target.closest("[data-social-tab]"); if (tab) openSocial(tab.dataset.socialTab); });
    document.addEventListener("click", e => { const quick = e.target.closest("[data-open-social]"); if (quick) openSocial(quick.dataset.openSocial); });
    window.addEventListener("blog-auth-change", () => {
      stopNotificationSync?.(); stopNotificationSync = null;
      if (window.blogAuth?.user) {
        stopNotificationSync = window.blogAuth.subscribeNotifications?.(row => {
          window.toast?.(`收到新通知：${row.payload?.message || "有人与你互动"}`);
          renderNotifications(); refreshBadge();
        });
      }
      renderFriends(); renderNotifications(); refreshBadge();
    });
    timer = setInterval(() => { if (!document.hidden) { refreshBadge(); if ($("#socialDialog")?.open) { renderFriends(); renderNotifications(); } } }, 30000);
    setTimeout(refreshBadge, 800);
  }
  window.openSocial = openSocial;
  document.addEventListener("DOMContentLoaded", init, { once: true });
})();
