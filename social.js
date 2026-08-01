(() => {
  "use strict";

  const $ = selector => document.querySelector(selector);
  let timer = null;
  let stopNotificationSync = null;
  let bubbleTimer = null;
  let badgeRequest = 0;
  let notificationRequest = 0;
  let friendsRequest = 0;

  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[char]);
  const nameOf = row => row.actor_username || row.username || row.payload?.sender_name || "社区用户";
  const isActivePage = page => document.getElementById(page)?.classList.contains("active");
  const time = value => new Date(value).toLocaleString("zh-CN", {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"
  });

  function safeAvatarUrl(value) {
    try {
      const url = new URL(value || "");
      return /^https?:$/.test(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  }

  function avatarOf(row) {
    return safeAvatarUrl(row.actor_avatar_url || row.avatar_url || row.payload?.sender_avatar_url);
  }

  function avatarMarkup(row, className = "social-avatar") {
    const url = avatarOf(row);
    const id = row.actor_id || row.id || "";
    const name = nameOf(row);
    const face = `${url ? "has-image" : ""}`;
    const style = url ? ` style="background-image:url(&quot;${esc(url)}&quot;)"` : "";
    if (!id) return `<span class="${className} ${face}"${style}>${esc(name[0]?.toUpperCase() || "U")}</span>`;
    return `<button type="button" class="${className} ${face}" data-user-profile="${esc(id)}" aria-label="查看 ${esc(name)} 的资料"${style}>${esc(name[0]?.toUpperCase() || "U")}</button>`;
  }

  function navigate(page) {
    if (window.blogUI?.navigate) return window.blogUI.navigate(page);
    if (typeof window.showPage === "function") {
      window.showPage(page, true);
      return true;
    }
    location.hash = `#${page}`;
    return true;
  }

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

  function setDockUnread(action, count) {
    const button = document.querySelector(`#mobileDock [data-mobile-action="${action}"]`);
    if (!button) return;
    if (count > 0) {
      button.dataset.unread = count > 99 ? "99+" : String(count);
    } else {
      button.removeAttribute("data-unread");
    }
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
      const userId = bubble.dataset.chatUser;
      const name = bubble.dataset.chatName;
      bubble.classList.remove("show");
      bubble.hidden = true;
      if (userId) window.openChat?.(userId, name);
      else openMessages();
    });
    return bubble;
  }

  function showIncomingMessageBubble(row) {
    if (!window.blogAuth?.user || row.kind !== "direct_message" || document.hidden) return;
    const bubble = ensureMessageBubble();
    const name = nameOf(row);
    const preview = String(row.payload?.preview || "给你发来一条新消息").trim();
    const avatarUrl = avatarOf(row);
    bubble.dataset.chatUser = row.actor_id || "";
    bubble.dataset.chatName = name;
    bubble.innerHTML = `${avatarUrl
      ? `<span class="incoming-message-avatar has-image" style="background-image:url(&quot;${esc(avatarUrl)}&quot;)"></span>`
      : `<span class="incoming-message-avatar">${esc(name[0]?.toUpperCase() || "U")}</span>`}
      <span><strong>${esc(name)}</strong><small>${esc(preview)}</small></span><b aria-hidden="true">›</b>`;
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
    const request = ++badgeRequest;
    const currentUser = window.blogAuth?.user;
    if (!currentUser) {
      setBadge(notificationBadge, 0, "0 条未读通知");
      setBadge(messageBadge, 0, "0 条未读私信");
      setDockUnread("notifications", 0);
      setDockUnread("messages", 0);
      return;
    }
    const rows = await window.blogAuth.listNotifications();
    if (request !== badgeRequest || window.blogAuth?.user?.id !== currentUser.id) return;
    const unread = rows.filter(row => !row.read_at);
    const unreadMessages = unread.filter(row => row.kind === "direct_message");
    setBadge(notificationBadge, unread.length, "{count} 条未读通知");
    setBadge(messageBadge, unreadMessages.length, "{count} 条未读私信");
    setDockUnread("notifications", unread.length);
    setDockUnread("messages", unreadMessages.length);
  }

  function notificationMarkup(row) {
    const direct = row.kind === "direct_message";
    const forumPost = row.kind === "forum_reply" || (row.kind === "forum_like" && row.target_type === "post");
    const name = nameOf(row);
    const preview = String(row.payload?.preview || "").trim();
    const message = direct
      ? `给你发来私信${preview ? `：${preview}` : ""}`
      : (row.payload?.message || "有一条新的互动");
    const action = direct && row.actor_id
      ? `<button type="button" class="notification-open" data-chat-user="${esc(row.actor_id)}" data-chat-name="${esc(name)}">查看私信 <span aria-hidden="true">›</span></button>`
      : forumPost && row.target_id
        ? `<button type="button" class="notification-open" data-open-forum-thread="${Number(row.target_id)}">查看帖子 <span aria-hidden="true">›</span></button>`
        : "";
    return `<article class="notification-item ${row.read_at ? "read" : "unread"}${direct ? " notification-direct" : ""}">
      ${avatarMarkup(row)}
      <div class="notification-copy"><p><strong>${esc(name)}</strong> ${esc(message)}</p><time>${time(row.created_at)}</time></div>
      ${action}
    </article>`;
  }

  async function renderNotifications() {
    const list = $("#standaloneNotificationList");
    if (!list) return;
    const request = ++notificationRequest;
    const currentUser = window.blogAuth?.user;
    if (!currentUser) {
      list.innerHTML = `<p class="social-empty">登录后即可查看你的通知。</p>`;
      return;
    }
    list.setAttribute("aria-busy", "true");
    const rows = await window.blogAuth.listNotifications();
    if (request !== notificationRequest || window.blogAuth?.user?.id !== currentUser.id) return;
    list.innerHTML = rows.length
      ? rows.map(notificationMarkup).join("")
      : `<p class="social-empty">还没有新的通知。</p>`;
    list.removeAttribute("aria-busy");
  }

  async function renderFriends() {
    const list = $("#messageFriendList");
    if (!list) return;
    const request = ++friendsRequest;
    const currentUser = window.blogAuth?.user;
    if (!currentUser) {
      list.innerHTML = `<p class="social-empty">登录后，互相关注的用户会出现在这里。</p>`;
      return;
    }
    list.setAttribute("aria-busy", "true");
    const rows = await window.blogAuth.listFriends();
    if (request !== friendsRequest || window.blogAuth?.user?.id !== currentUser.id) return;
    list.innerHTML = rows.length ? rows.map(row => {
      const name = row.username || "社区用户";
      const active = window.blogMessages?.peer === row.id;
      const avatarUrl = safeAvatarUrl(row.avatar_url);
      const avatar = avatarUrl
        ? `<button type="button" class="social-avatar has-image" data-user-profile="${esc(row.id)}" aria-label="查看 ${esc(name)} 的资料" style="background-image:url(&quot;${esc(avatarUrl)}&quot;)"></button>`
        : `<button type="button" class="social-avatar" data-user-profile="${esc(row.id)}" aria-label="查看 ${esc(name)} 的资料">${esc(name[0].toUpperCase())}</button>`;
      return `<article class="message-friend-item${active ? " active" : ""}">
        ${avatar}
        <button type="button" class="message-friend-main" data-chat-user="${esc(row.id)}" data-chat-name="${esc(name)}"${active ? " aria-current=\"true\"" : ""}>
          <strong>${esc(name)}</strong><small>${esc(row.display_title || "社区成员")} · UID ${esc(row.user_uid)}</small>
        </button>
        <button type="button" class="message-friend-profile" data-user-profile="${esc(row.id)}" aria-label="查看 ${esc(name)} 的资料">⋯</button>
      </article>`;
    }).join("") : `<p class="social-empty">还没有可以私信的朋友。互相关注后会自动出现在这里。</p>`;
    list.removeAttribute("aria-busy");
  }

  async function loadNotifications({ markRead = false } = {}) {
    await renderNotifications();
    if (!markRead || !window.blogAuth?.user) return;
    await window.blogAuth.markNotificationsRead?.();
    await Promise.all([renderNotifications(), refreshBadge()]);
  }

  function openNotifications() {
    const wasActive = isActivePage("notifications");
    navigate("notifications");
    if (wasActive) return loadNotifications({ markRead: true });
    return Promise.resolve();
  }

  function openMessages() {
    const wasActive = isActivePage("messages");
    navigate("messages");
    if (wasActive) {
      renderFriends();
      window.blogMessages?.activate?.();
    }
  }

  function syncNotifications() {
    refreshBadge();
    if (isActivePage("notifications")) renderNotifications();
    if (isActivePage("messages")) renderFriends();
  }

  function renameMessageEntry() {
    const button = $("#friendsBtn");
    if (!button) return;
    button.setAttribute("aria-label", "私信");
    button.querySelector("em")?.replaceChildren("私信");
    button.querySelector("span")?.replaceChildren("✉");
  }

  function init() {
    renameMessageEntry();
    $("#notificationBtn")?.addEventListener("click", () => openNotifications());
    $("#friendsBtn")?.addEventListener("click", () => openMessages());
    $("#markNotificationsReadBtn")?.addEventListener("click", () => loadNotifications({ markRead: true }));
    $("#refreshMessageFriendsBtn")?.addEventListener("click", renderFriends);
    document.addEventListener("click", event => {
      const forum = event.target.closest("[data-open-forum-thread]");
      if (forum) {
        window.openForumThreadById?.(forum.dataset.openForumThread);
        return;
      }
      const quick = event.target.closest("[data-open-social]");
      if (!quick) return;
      if (quick.dataset.openSocial === "friends") openMessages();
      else openNotifications();
    });
    window.addEventListener("blog-page-change", event => {
      const page = event.detail?.page;
      if (page === "notifications") loadNotifications({ markRead: true });
      if (page === "messages") {
        renderFriends();
        window.blogMessages?.activate?.();
      }
    });
    window.addEventListener("blog-notifications-change", syncNotifications);
    window.addEventListener("blog-auth-change", () => {
      stopNotificationSync?.();
      stopNotificationSync = null;
      const bubble = $("#incomingMessageBubble");
      window.clearTimeout(bubbleTimer);
      if (bubble) {
        bubble.classList.remove("show");
        bubble.hidden = true;
        delete bubble.dataset.chatUser;
        delete bubble.dataset.chatName;
      }
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

  window.openSocial = tab => tab === "friends" ? openMessages() : openNotifications();
  window.openNotifications = openNotifications;
  window.openMessages = openMessages;
  window.renderMessageFriends = renderFriends;
  document.addEventListener("DOMContentLoaded", init, { once: true });
})();
