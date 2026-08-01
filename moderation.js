(() => {
  "use strict";

  const $ = selector => document.querySelector(selector);
  const state = { tab: "reports", status: "all", search: "", reports: new Map(), appeals: new Map(), request: 0, overviewReady: null };
  let searchTimer = 0;

  const escapeText = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[char]);
  const dateTime = value => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
  const avatarStyle = url => url ? ` style="background-image:url('${escapeText(String(url).replace(/[\\']/g, ""))}')"` : "";
  const labels = {
    harassment: "攻击骚扰", privacy: "隐私泄露", spam: "广告刷屏", illegal: "违法危险",
    misinformation: "虚假误导", other: "其他", pending: "待处理", resolved: "已处理",
    dismissed: "已驳回", approved: "已通过", rejected: "已驳回", normal: "正常",
    warn: "警告", delete: "删除内容", delete_penalty: "删除并处罚", dismiss: "举报不成立"
  };
  const targetLabels = { forum_post: "社区话题", forum_reply: "社区回复", blog_comment: "博客评论" };
  const actionLabels = {
    resolve_report: "完成举报复核", restrict_user: "限制用户", ban_user: "限制用户",
    unrestrict_user: "解除限制", unban_user: "解除限制", review_appeal: "复核申诉",
    manage_member: "调整用户身份", governance_maintenance: "执行治理维护",
    delete_report: "删除举报内容", dismiss_report: "驳回举报"
  };

  function notice(message = "") {
    const target = $("#moderationNotice");
    if (!target) return;
    target.textContent = message;
    target.hidden = !message;
  }

  function closeDialog(dialog) {
    if (!dialog?.open) return;
    if (window.blogUI?.closeDialog) window.blogUI.closeDialog(dialog);
    else if (window.closeDialog) window.closeDialog(dialog);
    else dialog.close();
  }

  function setFormError(id, message = "") {
    const target = $(id);
    if (!target) return;
    target.textContent = message;
    target.hidden = !message;
  }

  function openReport(type, id) {
    if (!window.blogAuth?.user) return window.blogAuth?.openAuth("login");
    const form = $("#reportForm");
    form.reset();
    form.elements.target_type.value = type;
    form.elements.target_id.value = id;
    setFormError("#reportError");
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
      data.get("target_type"), data.get("target_id"), data.get("reason"), data.get("category")
    );
    button.disabled = false;
    button.textContent = "提交举报";
    if (!ok) return;
    closeDialog($("#reportDialog"));
    window.toast?.("举报已进入复核队列");
  }

  function openBan(userId, username, category = "other") {
    const form = $("#banForm");
    form.reset();
    form.elements.user_id.value = userId;
    form.elements.category.value = category || "other";
    $("#banDialogTitle").textContent = `限制用户：${username || "社区用户"}`;
    setFormError("#banError");
    $("#banDialog").showModal();
  }

  async function submitBan(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.checkValidity()) return form.reportValidity();
    const data = new FormData(form);
    const button = form.querySelector(".danger-button");
    button.disabled = true;
    button.textContent = "正在限制…";
    const ok = await window.blogAuth.setUserRestriction(
      data.get("user_id"), data.get("duration"), data.get("category"), data.get("reason")
    );
    button.disabled = false;
    button.textContent = "确认限制";
    if (!ok) return;
    closeDialog($("#banDialog"));
    window.toast?.("用户限制已生效并记录日志");
    await refreshGovernance();
  }

  function openDecision(reportId) {
    const row = state.reports.get(String(reportId));
    if (!row) return;
    const form = $("#moderationDecisionForm");
    form.reset();
    form.elements.report_id.value = row.report_id;
    form.elements.category.value = row.category || "other";
    form.elements.decision.value = "dismiss";
    $("#moderationPenaltyField").hidden = true;
    $("#moderationDecisionSummary").innerHTML = `<span>${escapeText(targetLabels[row.target_type] || row.target_type)}</span><strong>${escapeText(row.target_author_name || "作者未知")}${row.target_author_uid ? ` · UID ${row.target_author_uid}` : ""}</strong><p>${escapeText(row.content_excerpt || "[内容已删除]")}</p><small>举报说明：${escapeText(row.reason)}</small>`;
    setFormError("#moderationDecisionError");
    $("#moderationDecisionDialog").showModal();
  }

  async function submitDecision(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.checkValidity()) return form.reportValidity();
    const data = new FormData(form);
    const decision = data.get("decision");
    const destructive = decision === "delete" || decision === "delete_penalty";
    if (destructive && !confirm("确认删除被举报内容吗？内容删除后无法恢复，但复核记录会保留。")) return;
    const button = form.querySelector(".primary-btn");
    button.disabled = true;
    button.textContent = "正在处理…";
    const result = await window.blogAuth.resolveModerationCase(
      data.get("report_id"), decision, data.get("category"),
      decision === "delete_penalty" ? data.get("penalty") : "none", data.get("note")
    );
    button.disabled = false;
    button.textContent = "确认处理";
    if (!result) return;
    closeDialog($("#moderationDecisionDialog"));
    window.toast?.("举报复核已完成，处理过程已留痕");
    await refreshGovernance();
  }

  function openAppealReview(appealId) {
    const row = state.appeals.get(String(appealId));
    if (!row) return;
    const form = $("#appealReviewForm");
    form.reset();
    form.elements.appeal_id.value = row.appeal_id;
    $("#appealReviewSummary").innerHTML = `<span>UID ${escapeText(row.user_uid || "—")}</span><strong>${escapeText(row.username || "社区用户")}</strong><p>${escapeText(row.reason)}</p><small>原处罚：${escapeText(row.restriction_reason || "未记录")}</small>`;
    setFormError("#appealReviewError");
    $("#appealReviewDialog").showModal();
  }

  async function submitAppealReview(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.checkValidity()) return form.reportValidity();
    const data = new FormData(form);
    const button = form.querySelector(".primary-btn");
    button.disabled = true;
    const ok = await window.blogAuth.reviewModerationAppeal(data.get("appeal_id"), data.get("decision"), data.get("note"));
    button.disabled = false;
    if (!ok) return;
    closeDialog($("#appealReviewDialog"));
    window.toast?.("申诉复核已完成");
    await refreshGovernance();
  }

  async function submitOwnAppeal(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.checkValidity()) return form.reportValidity();
    const button = form.querySelector(".primary-btn");
    button.disabled = true;
    const ok = await window.blogAuth.submitModerationAppeal(form.elements.reason.value);
    button.disabled = false;
    if (!ok) return;
    closeDialog($("#moderationAppealDialog"));
    window.toast?.("申诉已提交，请等待管理员复核");
    await window.blogAuth.refreshProfile();
  }

  function statusOptions() {
    const options = {
      reports: [["all", "全部"], ["pending", "待处理"], ["resolved", "已处理"], ["dismissed", "已驳回"]],
      users: [["all", "全部"], ["normal", "正常用户"], ["restricted", "受限用户"], ["admin", "管理员"]],
      appeals: [["all", "全部"], ["pending", "待复核"], ["approved", "已通过"], ["rejected", "已驳回"]],
      actions: [["all", "全部日志"]]
    }[state.tab];
    const select = $("#moderationStatusFilter");
    select.innerHTML = options.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
    state.status = "all";
    select.value = "all";
    select.closest("label").hidden = state.tab === "actions";
  }

  async function loadOverview() {
    const result = await window.blogAuth.getGovernanceOverview();
    state.overviewReady = !result.error;
    const values = result.data || {};
    $("#governancePendingReports").textContent = values.pending_reports ?? "—";
    $("#governanceRestrictedUsers").textContent = values.restricted_users ?? "—";
    $("#governancePendingAppeals").textContent = values.pending_appeals ?? "—";
    $("#governanceActionsToday").textContent = values.actions_today ?? "—";
    return !result.error;
  }

  function renderReports(rows) {
    state.reports = new Map(rows.map(row => [String(row.report_id), row]));
    $("#moderationList").innerHTML = rows.length ? rows.map(row => `<article class="governance-card report-card priority-${escapeText(row.priority || "normal")}">
      <div class="governance-card-head"><div><span class="governance-badge ${escapeText(row.status)}">${escapeText(labels[row.status] || row.status)}</span><span class="governance-badge category">${escapeText(labels[row.category] || "未分类")}</span>${row.priority && row.priority !== "normal" ? `<span class="governance-badge priority">${row.priority === "urgent" ? "紧急" : "高优先级"}</span>` : ""}</div><time>${dateTime(row.created_at)}</time></div>
      <div class="governance-content"><small>${escapeText(targetLabels[row.target_type] || row.target_type)} · 举报 #${row.report_id}</small><h3>${escapeText(row.target_author_name || "内容作者未知")}${row.target_author_uid ? `<em>UID ${row.target_author_uid}</em>` : ""}</h3><p>${escapeText(row.content_excerpt || "[内容已删除]")}</p><blockquote>举报说明：${escapeText(row.reason)}</blockquote></div>
      ${row.review_note ? `<div class="governance-review"><b>${escapeText(labels[row.decision] || "复核结论")}</b><span>${escapeText(row.review_note)}</span><small>${escapeText(row.reviewer_name || "管理员")} · ${dateTime(row.reviewed_at)}</small></div>` : ""}
      <div class="governance-card-actions">${row.target_author_id ? `<button type="button" class="secondary-btn" data-user-profile="${row.target_author_id}">查看用户</button>` : ""}${row.status === "pending" ? `<button type="button" class="primary-btn" data-review-report="${row.report_id}">复核处理</button>` : ""}</div>
    </article>`).join("") : emptyState("当前筛选条件下没有举报", "所有举报均已得到妥善处理。", "✓");
  }

  function renderUsers(rows) {
    $("#moderationList").innerHTML = rows.length ? rows.map(row => {
      const restricted = Boolean(row.restricted ?? row.banned);
      const until = row.restricted_until ?? row.banned_until;
      return `<article class="governance-card user-governance-card">
        <button type="button" class="governance-avatar profile-avatar${row.avatar_url ? " has-image" : ""}" data-user-profile="${row.user_id}"${avatarStyle(row.avatar_url)}>${escapeText((row.username || "用")[0])}</button>
        <div class="governance-user-main"><div class="governance-user-title"><h3>${escapeText(row.username || "社区用户")}</h3><span>UID ${escapeText(row.user_uid || "—")}</span>${row.is_admin ? `<b class="governance-badge admin">管理员</b>` : ""}</div><p>${escapeText(row.display_title || "社区成员")}</p><div class="governance-user-metrics"><span><b>${row.strike_count ?? 0}</b> 违规记录</span><span><b>${row.forum_post_count ?? 0}</b> 话题</span><span><b>${row.forum_reply_count ?? 0}</b> 回复</span><span><b>${row.report_count ?? 0}</b> 被举报</span></div>${restricted ? `<small class="restriction-copy">${until ? `限制至 ${dateTime(until)}` : "永久限制"} · ${escapeText(row.restriction_reason || row.ban_reason || "违反社区规范")}</small>` : ""}</div>
        <div class="governance-card-actions vertical"><span class="governance-badge ${restricted ? "restricted" : "normal"}">${restricted ? "受限" : "正常"}</span><button type="button" class="secondary-btn" data-manage-uid="${escapeText(row.user_uid || "")}">身份与头衔</button>${restricted ? `<button type="button" class="secondary-btn" data-unban-user="${row.user_id}">解除限制</button>` : !row.is_admin ? `<button type="button" class="danger-button subtle" data-ban-user="${row.user_id}" data-ban-name="${escapeText(row.username)}">限制发言</button>` : ""}</div>
      </article>`;
    }).join("") : emptyState("没有找到用户", "可以尝试更换状态或搜索词。", "⌕");
  }

  function renderAppeals(rows) {
    state.appeals = new Map(rows.map(row => [String(row.appeal_id), row]));
    $("#moderationList").innerHTML = rows.length ? rows.map(row => `<article class="governance-card appeal-card">
      <div class="governance-card-head"><div><span class="governance-badge ${escapeText(row.status)}">${escapeText(labels[row.status] || row.status)}</span><span class="governance-badge category">UID ${escapeText(row.user_uid || "—")}</span></div><time>${dateTime(row.created_at)}</time></div>
      <div class="governance-content"><h3>${escapeText(row.username || "社区用户")}<em>${escapeText(row.display_title || "社区成员")}</em></h3><p>${escapeText(row.reason)}</p><blockquote>原处罚：${escapeText(row.restriction_reason || "未记录")}${row.restricted_until ? ` · 至 ${dateTime(row.restricted_until)}` : ""}</blockquote></div>
      ${row.review_note ? `<div class="governance-review"><b>${escapeText(labels[row.status] || row.status)}</b><span>${escapeText(row.review_note)}</span><small>${escapeText(row.reviewer_name || "管理员")} · ${dateTime(row.reviewed_at)}</small></div>` : ""}
      <div class="governance-card-actions"><button type="button" class="secondary-btn" data-user-profile="${row.user_id}">查看用户</button>${row.status === "pending" ? `<button type="button" class="primary-btn" data-review-appeal="${row.appeal_id}">复核申诉</button>` : ""}</div>
    </article>`).join("") : emptyState("当前没有申诉", "待处理申诉会出现在这里。", "✓");
  }

  function readableDetails(row) {
    const details = row.details || {};
    const parts = [];
    if (details.decision) parts.push(`结论：${labels[details.decision] || details.decision}`);
    if (details.penalty && details.penalty !== "none") parts.push(`处罚：${details.penalty}`);
    if (details.category) parts.push(`类型：${labels[details.category] || details.category}`);
    if (details.role_action) parts.push(`角色：${{ keep: "保持", promote: "提拔管理员", demote: "降为普通用户" }[details.role_action] || details.role_action}`);
    if (details.note || details.reason) parts.push(`说明：${details.note || details.reason}`);
    if (details.expired_restrictions_closed != null) parts.push(`关闭 ${details.expired_restrictions_closed} 条过期限制`);
    return parts.join(" · ") || "该操作没有附加说明";
  }

  function renderActions(rows) {
    $("#moderationList").innerHTML = rows.length ? `<div class="governance-timeline">${rows.map(row => `<article class="governance-action"><span class="action-dot"></span><div><div><strong>${escapeText(actionLabels[row.action] || row.action)}</strong><time>${dateTime(row.created_at)}</time></div><p>${escapeText(row.actor_name || row.actor?.username || "管理员")}${row.target_user_name ? ` → ${escapeText(row.target_user_name)}（UID ${escapeText(row.target_user_uid || "—")}）` : ""}</p><small>${escapeText(readableDetails(row))}</small></div></article>`).join("")}</div>` : emptyState("暂无操作日志", "治理操作会自动记录在这里。", "◷");
  }

  function emptyState(title, text, icon) {
    return `<div class="governance-empty"><span>${icon}</span><h3>${title}</h3><p>${text}</p></div>`;
  }

  async function loadTab() {
    if (!window.blogAuth?.isAdmin) return false;
    const request = ++state.request;
    notice();
    $("#moderationList").innerHTML = `<div class="governance-loading"><span></span><p>正在读取治理数据…</p></div>`;
    const options = { status: state.status, search: state.search, limit: 150 };
    const result = state.tab === "reports" ? await window.blogAuth.listModerationReports(options)
      : state.tab === "users" ? await window.blogAuth.listModerationUsers(options)
      : state.tab === "appeals" ? await window.blogAuth.listModerationAppeals(options)
      : await window.blogAuth.listModerationActions(options);
    if (request !== state.request) return false;
    if (!result?.rows) {
      notice(result?.error || "治理数据读取失败。请确认已执行 moderation.sql 和 governance.sql。");
      $("#moderationList").innerHTML = emptyState("治理模块尚未就绪", "请检查数据库脚本与管理员权限。", "!");
      return false;
    }
    if (state.tab === "reports") renderReports(result.rows);
    else if (state.tab === "users") renderUsers(result.rows);
    else if (state.tab === "appeals") renderAppeals(result.rows);
    else renderActions(result.rows);
    if (state.overviewReady === false) notice("当前正在使用基础审核兼容模式；执行 governance.sql 后可启用分级处罚、申诉和治理统计。");
    return true;
  }

  async function refreshGovernance() {
    if (!window.blogAuth?.isAdmin) return;
    const [overviewReady, listReady] = await Promise.all([loadOverview(), loadTab()]);
    if (!overviewReady && listReady) notice("当前正在使用基础审核兼容模式；执行 governance.sql 后可启用分级处罚、申诉和治理统计。");
  }

  function setAccess() {
    const visible = Boolean(window.blogAuth?.isAdmin);
    const panel = $("#moderationPanel");
    if (!panel) return;
    panel.hidden = !visible;
    if (visible) refreshGovernance();
  }

  function init() {
    $("#reportForm")?.addEventListener("submit", submitReport);
    $("#banForm")?.addEventListener("submit", submitBan);
    $("#moderationDecisionForm")?.addEventListener("submit", submitDecision);
    $("#moderationAppealForm")?.addEventListener("submit", submitOwnAppeal);
    $("#appealReviewForm")?.addEventListener("submit", submitAppealReview);
    $("#moderationDecisionForm")?.elements.decision.addEventListener("change", event => {
      $("#moderationPenaltyField").hidden = event.target.value !== "delete_penalty";
    });
    $("#refreshModerationBtn")?.addEventListener("click", refreshGovernance);
    $(".moderation-tabs")?.addEventListener("click", event => {
      const button = event.target.closest("[data-moderation-tab]");
      if (!button) return;
      state.tab = button.dataset.moderationTab;
      document.querySelectorAll("[data-moderation-tab]").forEach(item => item.classList.toggle("active", item === button));
      statusOptions();
      loadTab();
    });
    $("#moderationStatusFilter")?.addEventListener("change", event => { state.status = event.target.value; loadTab(); });
    $("#moderationSearch")?.addEventListener("input", event => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.search = event.target.value.trim(); loadTab(); }, 260);
    });
    $("#moderationList")?.addEventListener("click", async event => {
      const review = event.target.closest("[data-review-report]");
      const appeal = event.target.closest("[data-review-appeal]");
      const ban = event.target.closest("[data-ban-user]");
      const unban = event.target.closest("[data-unban-user]");
      const profile = event.target.closest("[data-user-profile]");
      const manage = event.target.closest("[data-manage-uid]");
      if (review) openDecision(review.dataset.reviewReport);
      else if (appeal) openAppealReview(appeal.dataset.reviewAppeal);
      else if (ban) openBan(ban.dataset.banUser, ban.dataset.banName);
      else if (unban && confirm("确认解除该用户的发言限制吗？处罚历史和日志仍会保留。")) {
        if (await window.blogAuth.clearUserBan(unban.dataset.unbanUser)) { window.toast?.("已解除用户限制"); refreshGovernance(); }
      } else if (manage) window.openMemberAdmin?.(manage.dataset.manageUid);
      else if (profile) window.openPublicProfile?.(profile.dataset.userProfile);
    });
    $("#profileAppealBtn")?.addEventListener("click", () => {
      $("#moderationAppealForm").reset();
      setFormError("#moderationAppealError");
      $("#moderationAppealDialog").showModal();
    });
    document.addEventListener("click", event => {
      const report = event.target.closest("[data-report-type]");
      if (report) openReport(report.dataset.reportType, report.dataset.reportId);
    });
    window.addEventListener("blog-auth-change", setAccess);
    statusOptions();
    setAccess();
  }

  document.addEventListener("DOMContentLoaded", init, { once: true });
  window.openReportDialog = openReport;
  window.refreshGovernance = refreshGovernance;
})();
