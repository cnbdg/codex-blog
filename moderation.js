(() => {
  "use strict";
  const $ = selector => document.querySelector(selector);
  let tab = "reports";

  const escapeText = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[char]);
  const time = value => new Date(value).toLocaleString("zh-CN", { hour12: false });
  const notice = message => {
    const target = $("#moderationNotice");
    target.textContent = message || "";
    target.hidden = !message;
  };

  function openReport(type, id) {
    if (!window.blogAuth?.user) return window.blogAuth?.openAuth("login");
    const form = $("#reportForm");
    form.reset();
    form.elements.target_type.value = type;
    form.elements.target_id.value = id;
    $("#reportError").hidden = true;
    $("#reportDialog").showModal();
    setTimeout(() => form.elements.reason.focus(), 40);
  }

  async function submitReport(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.checkValidity()) return form.reportValidity();
    const data = new FormData(form);
    const button = form.querySelector(".primary-btn");
    button.disabled = true;
    button.textContent = "正在提交…";
    const ok = await window.blogAuth.reportContent(
      data.get("target_type"), data.get("target_id"), data.get("reason")
    );
    button.disabled = false;
    button.textContent = "提交举报";
    if (!ok) return;
    window.closeDialog?.($("#reportDialog")) || $("#reportDialog").close();
    window.toast?.("举报已提交，感谢你的反馈");
  }

  function openBan(userId, username) {
    const form = $("#banForm");
    form.reset();
    form.elements.user_id.value = userId;
    $("#banDialogTitle").textContent = `限制用户：${username || "社区用户"}`;
    $("#banError").hidden = true;
    $("#banDialog").showModal();
  }

  function untilFromDuration(duration) {
    if (duration === "permanent") return null;
    const hours = { "1h": 1, "1d": 24, "7d": 24 * 7, "30d": 24 * 30 }[duration] || 24;
    return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  }

  async function submitBan(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.checkValidity()) return form.reportValidity();
    const data = new FormData(form);
    const button = form.querySelector(".danger-button");
    button.disabled = true;
    const ok = await window.blogAuth.setUserBan(
      data.get("user_id"), untilFromDuration(data.get("duration")), data.get("reason")
    );
    button.disabled = false;
    if (!ok) return;
    window.closeDialog?.($("#banDialog")) || $("#banDialog").close();
    window.toast?.("用户发言权限已限制");
    loadTab();
  }

  async function loadReports() {
    const result = await window.blogAuth.listModerationReports();
    if (!result?.rows) { notice(`举报列表读取失败：${result?.error || "未知错误"}`); return false; }
    const rows = result.rows;
    $("#moderationList").innerHTML = rows.length ? rows.map(row => `<article class="moderation-item ${row.status}">
      <div class="moderation-item-top"><span class="moderation-status ${row.status}">${row.status === "pending" ? "待处理" : row.status === "resolved" ? "已处理" : "已驳回"}</span><time>${time(row.created_at)}</time></div>
      <h3>${escapeText(row.target_type === "forum_post" ? "社区话题" : row.target_type === "forum_reply" ? "社区回复" : "博客评论")} · ${escapeText(row.target_author_name || "内容已删除")}</h3>
      <p class="moderation-excerpt">${escapeText(row.content_excerpt)}</p><p class="moderation-reason">举报原因：${escapeText(row.reason)} · 举报人：${escapeText(row.reporter_name)}</p>
      ${row.status === "pending" ? `<div class="moderation-actions"><button class="danger-button" data-moderate="delete" data-report-id="${row.report_id}">删除内容</button><button class="secondary-btn" data-moderate="dismiss" data-report-id="${row.report_id}">驳回举报</button>${row.target_author_id ? `<button class="secondary-btn" data-ban-user="${row.target_author_id}" data-ban-name="${escapeText(row.target_author_name)}">限制作者</button>` : ""}</div>` : ""}
    </article>`).join("") : `<div class="forum-empty"><span>✓</span><h2>暂无举报记录</h2><p>社区目前很平静。</p></div>`;
    return true;
  }

  async function loadUsers() {
    const result = await window.blogAuth.listModerationUsers();
    if (!result?.rows) { notice(`用户列表读取失败：${result?.error || "未知错误"}`); return false; }
    const rows = result.rows;
    $("#moderationList").innerHTML = rows.map(row => `<article class="moderation-user">
      <div><strong>${escapeText(row.username)}</strong><small>注册于 ${time(row.created_at)}</small><span>${row.forum_post_count} 个话题 · ${row.forum_reply_count} 条回复</span></div>
      <div class="moderation-user-actions">${row.banned ? `<span class="moderation-status banned">${row.banned_until ? `限制至 ${time(row.banned_until)}` : "永久限制"}</span><button class="secondary-btn" data-unban-user="${row.user_id}">解除限制</button>` : `<span class="moderation-status normal">正常</span><button class="secondary-btn" data-ban-user="${row.user_id}" data-ban-name="${escapeText(row.username)}">限制发言</button>`}</div>
    </article>`).join("") || `<div class="forum-empty">暂无用户数据。</div>`;
    return true;
  }

  async function loadActions() {
    const result = await window.blogAuth.listModerationActions();
    if (!result?.rows) { notice(`操作日志读取失败：${result?.error || "未知错误"}`); return false; }
    const rows = result.rows;
    $("#moderationList").innerHTML = rows.length ? rows.map(row => `<article class="moderation-action"><strong>${escapeText(row.actor?.username || "管理员")}</strong><span>${escapeText(row.action)}</span><time>${time(row.created_at)}</time><small>${escapeText(JSON.stringify(row.details || {}))}</small></article>`).join("") : `<div class="forum-empty">暂无审核操作记录。</div>`;
    return true;
  }

  async function loadTab() {
    if (!window.blogAuth?.isAdmin) return;
    notice();
    $("#moderationList").innerHTML = `<p class="forum-empty">正在加载审核数据…</p>`;
    const loaded = tab === "reports" ? await loadReports() : tab === "users" ? await loadUsers() : await loadActions();
    if (!loaded && !$("#moderationNotice").textContent) notice("审核数据库尚未启用，请先在 Supabase SQL Editor 中执行 moderation.sql（需要先执行 community.sql）。");
  }

  function setAccess() {
    const visible = Boolean(window.blogAuth?.isAdmin);
    $("#moderationPanel").hidden = !visible;
    if (visible) loadTab();
  }

  function init() {
    $("#reportForm").addEventListener("submit", submitReport);
    $("#banForm").addEventListener("submit", submitBan);
    $("#refreshModerationBtn").addEventListener("click", loadTab);
    $(".moderation-tabs").addEventListener("click", event => {
      const button = event.target.closest("[data-moderation-tab]");
      if (!button) return;
      tab = button.dataset.moderationTab;
      document.querySelectorAll("[data-moderation-tab]").forEach(item => item.classList.toggle("active", item === button));
      loadTab();
    });
    $("#moderationList").addEventListener("click", async event => {
      const moderate = event.target.closest("[data-moderate]");
      const ban = event.target.closest("[data-ban-user]");
      const unban = event.target.closest("[data-unban-user]");
      if (moderate) {
        const action = moderate.dataset.moderate;
        if (!confirm(action === "delete" ? "确认删除被举报内容吗？此操作不可恢复。" : "确认驳回这条举报吗？")) return;
        if (await window.blogAuth.moderateReport(moderate.dataset.reportId, action)) { window.toast?.("审核处理完成"); loadTab(); }
      } else if (ban) openBan(ban.dataset.banUser, ban.dataset.banName);
      else if (unban && confirm("确认解除该用户的发言限制吗？")) {
        if (await window.blogAuth.clearUserBan(unban.dataset.unbanUser)) { window.toast?.("已解除用户限制"); loadTab(); }
      }
    });
    document.addEventListener("click", event => {
      const report = event.target.closest("[data-report-type]");
      if (report) openReport(report.dataset.reportType, report.dataset.reportId);
    });
    window.addEventListener("blog-auth-change", setAccess);
    setAccess();
  }

  document.addEventListener("DOMContentLoaded", init, { once: true });
  window.openReportDialog = openReport;
})();
