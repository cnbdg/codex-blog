(() => {
  "use strict";
  const $ = selector => document.querySelector(selector);
  let timer = null;
  let stopNotificationSync = null;
  let bubbleTimer = null;
  let badgeRequest = 0;

  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[char]);
  const nameOf = row => row.actor_username || row.username || row.payload?.sender_name || "社区用户";
  const safeAvatarUrl = value => {
    try {
      const url = new URL(value || "");
      return /^https?:$/.test(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  };
  const avatarOf = row => safeAvatarUrl(row.actor_avatar_url || row.avatar_url || row.payload?.sender_avatar_url);
  const avatarMarkup = row => {
    const url = avatarOf(row);
    const id = row.actor_id || row.id || "";
    const name = nameOf(row);
    return `<button type="button" class="social-avatar ${url ? "has-image" : ""}" data-user-profile="${esc(id)}" aria-label="查看用户资料"${url ? ` style="background-image:url(&quot;${esc(url)}&quot;)"` : ""}>${esc(name[0]?.toUpperCase() || "U")}</button>`;
  };
  const time = value => new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

  function ensureBadge(buttonId, className) {
    const button = $(buttonId);
    if (!button) return null;
    let badge = button.querySelector(`.${className}`);
    if (!badge) {
      badge = document.createElement("span");
      badge.className = `notification-badge ${className}`;
      badge.hidden = true;
      button.append(badge);
    }
    return badge;
  }

  function setBadge(badge, count, label) {
    if (!badge) return;
    badge.hidden = count === 0;
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.setAttribute("aria-label", label.replace("{count}", String(count)));
  }

  function ensureMessageBubble() {
    let bubble = $("#incomingMessageBubble");
    if (bubble) return bubble;
    bubble = document.createElement("button");
    bubble.type = "button";
    bubble.id = "incomingMessageBubble";
    bubble.className = "incoming-message-bubble";
    bubble.hidden = true;
    document.body.append(bubble);
    bubble.addEventListener("click", () => {
      bubble.classList.remove("show");
      bubble.hidden = true;
    });
    return bubble;
  }

  function showIncomingMessageBubble(row) {
    if (row.kind !== "direct_message" || document.hidden) return;
    const bubble = ensureMessageBubble();
    const name = nameOf(row);
    const preview = String(row.payload?.preview || "给你发来了一条新消息").trim();
    const avatarUrl = avatarOf(row);
    bubble.dataset.chatUser = row.actor_id || "";
    bubble.dataset.chatName = name;
    bubble.innerHTML = `${avatarUrl ? `<span class="incoming-message-avatar has-image" style="background-image:url(&quot;${esc(avatarUrl)}&quot;)"></span>` : `<span class="incoming-message-avatar">${esc(name[0]?.toUpperCase() || "U")}</span>`}<span><strong>${esc(name)}</strong><small>${esc(preview)}</small></span><b aria-hidden="true">›</b>`;
    bubble.hidden = false;
    window.requestAnimationFrame(() => bubble.classList.add("show"));
    window.clearTimeout(bubbleTimer);
    bubbleTimer = window.setTimeout(() => {
      bubble.classList.remove("show");
      window.setTimeout(() => { if (!bubble.classList.contains("show")) bubble.hidden = true; }, 240);
    }, 6500);
  }

  async function refreshBadge() {
    const notificationBadge = ensureBadge("#notificationBtn", "notification-count-badge");
    const messageBadge = ensureBadge("#friendsBtn", "message-count-badge");
    const mobile = document.querySelector('#mobileDock [data-mobile-action="notifications"]');
    if (!window.blogAuth?.user) {
      setBadge(notificationBadge, 0, "0 条未读通知");
      setBadge(messageBadge, 0, "0 条未读私信");
      mobile?.removeAttribute("data-unread");
      return;
    }
    const request = ++badgeRequest;
    const rows = await window.blogAuth.listNotifications();
    if (request !== badgeRequest) return;
    const unread = rows.filter(row => !row.read_at);
    const unreadMessages = unread.filter(row => row.kind === "direct_message");
    setBadge(notificationBadge, unread.length, "{count} 条未读通知");
    setBadge(messageBadge, unreadMessages.length, "{count} 条未读私信");
    if (mobile) {
      mobile.toggleAttribute("data-unread", unread.length > 0);
      mobile.dataset.unread = unread.length > 99 ? "99+" : String(unread.length);
    }
  }

  function notificationMarkup(row) {
    const direct = row.kind === "direct_message";
    const name = nameOf(row);
    const preview = String(row.payload?.preview || "").trim();
    const message = direct
      ? `给你发来私信${preview ? `：${preview}` : ""}`
      : (row.payload?.message || "有一条新动态");
    const tag = direct && row.actor_id ? "button" : "article";
    const directAttributes = tag === "button" ? ` type="button" data-chat-user="${esc(row.actor_id)}" data-chat-name="${esc(name)}" aria-label="打开与 ${esc(name)} 的私聊"` : "";
    return `<${tag}${directAttributes} class="notification-item ${row.read_at ? "read" : "unread"}${direct ? " notification-direct" : ""}">${avatarMarkup(row)}<div><p><strong>${esc(name)}</strong> ${esc(message)}</p><time>${time(row.created_at)}</time></div>${direct ? `<b class="notification-arrow" aria-hidden="true">›</b>` : ""}</${tag}>`;
  }

  async function renderNotifications() {
    const list = $("#notificationList");
    if (!list) return;
    if (!window.blogAuth?.user) {
      list.innerHTML = `<p class="social-empty">登录后即可查看通知。</p>`;
      return;
    }
    const rows = await window.blogAuth.listNotifications();
    list.innerHTML = rows.length ? rows.map(notificationMarkup).join("") : `<p class="social-empty">还没有新的通知。</p>`;
  }

  async function renderFriends() {
    const list = $("#friendList");
    if (!list) return;
    if (!window.blogAuth?.user) {
      list.innerHTML = `<p class="social-empty">登录后，互相关注的用户会出现在这里。</p>`;
      return;
    }
    const rows = await window.blogAuth.listFriends();
    list.innerHTML = rows.length ? rows.map(row => {
      const avatarUrl = safeAvatarUrl(row.avatar_url);
      return `<button type="button" class="friend-item" data-user-profile="${esc(row.id)}">${avatarUrl ? `<span class="social-avatar has-image" style="background-image:url(&quot;${esc(avatarUrl)}&quot;)"></span>` : `<span class="social-avatar">${esc((row.username || "U")[0].toUpperCase())}</span>`}<span class="friend-copy"><strong>${esc(row.username)}</strong><small>${esc(row.display_title || "社区成员")} · UID ${esc(row.user_uid)}</small></span><i class="online-dot" title="好友"></i></button>`;
    }).join("") : `<p class="social-empty">还没有好友。互相关注后会自动出现在这里。</p>`;
  }

  async function openSocial(tab = "notifications") {
    const dialog = $("#socialDialog");
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    document.querySelectorAll("[data-social-tab]").forEach(button => button.classList.toggle("active", button.dataset.socialTab === tab));
    $("#notificationPanel").hidden = tab !== "notifications";
    $("#friendsPanel").hidden = tab !== "friends";
    if (tab === "notifications") {
      await renderNotifications();
      await window.blogAuth?.markNotificationsRead?.();
      await Promise.all([renderNotifications(), refreshBadge()]);
    } else {
      await renderFriends();
    }
  }

  function syncNotifications() {
    refreshBadge();
    if ($("#socialDialog")?.open) {
      renderNotifications();
      renderFriends();
    }
  }

  function init() {
    $("#notificationBtn")?.addEventListener("click", () => openSocial("notifications"));
    $("#friendsBtn")?.addEventListener("click", () => openSocial("friends"));
    $("#refreshFriendsBtn")?.addEventListener("click", renderFriends);
    document.addEventListener("click", event => {
      const tab = event.target.closest("[data-social-tab]");
      if (tab) openSocial(tab.dataset.socialTab);
    });
    document.addEventListener("click", event => {
      const quick = event.target.closest("[data-open-social]");
      if (quick) openSocial(quick.dataset.openSocial);
    });
    window.addEventListener("blog-notifications-change", syncNotifications);
    window.addEventListener("blog-auth-change", () => {
      stopNotificationSync?.();
      stopNotificationSync = null;
      if (window.blogAuth?.user) {
        stopNotificationSync = window.blogAuth.subscribeNotifications?.(row => {
          if (row.kind === "direct_message") showIncomingMessageBubble(row);
          else window.toast?.(`收到新通知：${row.payload?.message || "有人与你互动"}`);
          syncNotifications();
        });
      }
      syncNotifications();
    });
    timer = window.setInterval(() => {
      if (!document.hidden) syncNotifications();
    }, 5000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) syncNotifications(); });
    window.setTimeout(refreshBadge, 800);
  }

  window.openSocial = openSocial;
  document.addEventListener("DOMContentLoaded", init, { once: true });
})();
