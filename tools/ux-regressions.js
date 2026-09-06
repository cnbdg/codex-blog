// Browser-only regression suite. All social APIs below are local doubles: this
// file never creates users, sends messages or changes the production database.
window.runUxRegressions = async function (w, mode) {
  const d = w.document;
  const $ = selector => d.querySelector(selector);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const checks = [];
  const assert = (ok, name) => { if (!ok) throw new Error(name); checks.push(name); };
  const until = async (predicate, name, timeout = 1800) => {
    const start = Date.now();
    while (!predicate() && Date.now() - start < timeout) await wait(20);
    assert(predicate(), name);
  };
  const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
  const frame = () => new Promise(resolve => w.requestAnimationFrame(resolve));
  await until(() => Boolean(w.blogUI && w.blogMotion), "modules ready");

  const dialog = $("#searchDialog");
  w.blogUI.openDialog(dialog);
  await wait(60);
  const closing = w.blogUI.closeDialog(dialog);
  await wait(30);
  const presentation = w.getComputedStyle(dialog).opacity;
  w.blogUI.openDialog(dialog);
  assert(Math.abs(Number(presentation) - Number(w.getComputedStyle(dialog).opacity)) < .15 || w.blogMotion.reduceMotion.matches, "dialog reverses from presentation");
  await closing;
  await wait(280);
  assert(dialog.open && w.blogUI.state.overlay === dialog.id, "cancelled close cannot dismiss reopened dialog");
  const replaced = w.blogUI.closeDialog(dialog);
  w.blogUI.openDialog($("#wallpaperDialog"));
  await replaced;
  assert(!dialog.open && $("#wallpaperDialog").open && w.blogUI.state.overlay === "wallpaperDialog", "old overlay completion cannot clear new overlay");
  await w.blogUI.closeDialog($("#wallpaperDialog"));
  assert(!d.querySelector("dialog[open]") && w.blogUI.state.overlay === null, "overlay cleanup");

  for (const page of ["home", "forum", "profile", "home", "forum"]) w.blogUI.navigate(page, { history: false });
  w.blogUI.navigate("home", { history: false, animate: false, restoreScroll: false });
  assert($(".page.active").id === "home" && d.querySelectorAll(".page.active").length === 1, "latest navigation commits synchronously");
  await wait(260);
  assert(!w.blogMotion.state.activeTransition && !d.documentElement.classList.contains("motion-view-transition"), "interrupted navigation leaves no ghost layers");
  w.scrollTo({ top: 350, behavior: "instant" });
  const readingPosition = w.scrollY;
  w.blogUI.navigate("forum", { history: false, animate: false });
  w.blogUI.navigate("home", { history: false, animate: false });
  assert(Math.abs(w.scrollY - readingPosition) < 3 && readingPosition > 100, "return restores reading position");
  w.blogUI.navigate("home", { history: false });
  assert(Math.abs(w.scrollY - readingPosition) < 3, "same-page navigation preserves reading position");

  const viewer = { id: "ux-viewer" };
  const a = { id: "ux-friend-a", username: "测试好友甲", user_uid: 11 };
  const b = { id: "ux-friend-b", username: "测试好友乙", user_uid: 12 };
  const searchA = deferred();
  const searchB = deferred();
  const originalAuth = w.blogAuth;
  let syncMessage;
  let rows = Array.from({ length: 32 }, (_, index) => ({
    id: index + 1, sender_id: a.id, content: `这是第 ${index + 1} 条测试消息`,
    created_at: "2026-09-06T08:00:00Z", image_path: index === 0 ? "test.mp4" : null
  }));
  let signedCalls = 0;
  w.blogAuth = {
    user: viewer, profile: { username: "测试用户", user_uid: 10 },
    getFollowState: async () => ({ mutual: true, following: true }),
    searchUsers: q => q === "甲" ? searchA.promise : searchB.promise,
    listFriends: async () => [a, b], listGroupChats: async () => [],
    listNotifications: async () => [], markNotificationsRead: async () => true,
    listDirectMessages: async peer => peer === a.id ? rows.map(row => ({ ...row })) : [],
    getDirectMessageImageUrls: async paths => { signedCalls++; return new Map(paths.map(path => [path, "data:video/mp4;base64,"])); },
    markDirectMessagesRead: async () => true,
    subscribeDirectMessages(peer, callback) { syncMessage = callback; return () => {}; },
    sendDirectMessage: async () => false,
    openAuth() {}
  };
  w.blogUI.openDialog(dialog);
  const firstSearch = w.search("甲");
  const secondSearch = w.search("乙");
  searchB.resolve([b]); await secondSearch;
  searchA.resolve([a]); await firstSearch;
  assert($("#userSearchResults").textContent.includes(b.username) && !$("#userSearchResults").textContent.includes(a.username), "stale user search is discarded");
  assert($("#userSearchResults [data-user-profile]")?.tagName === "BUTTON", "search results have keyboard profile actions");
  let searchCalls = 0;
  w.blogAuth.searchUsers = async () => { searchCalls++; return [a]; };
  await Promise.all([w.search("a", { delay: 50 }), w.search("ab", { delay: 50 }), w.search("abc", { delay: 50 })]);
  assert(searchCalls === 1, "search burst is debounced");
  await w.search("拼音", { composing: true });
  await w.search("");
  assert(searchCalls === 1 && !$("#userSearchResults").textContent, "IME and clear do not request stale users");
  await w.blogUI.closeDialog(dialog);

  const slowFollow = deferred();
  w.blogAuth.getFollowState = peer => peer === a.id ? slowFollow.promise : Promise.resolve({ mutual: true });
  const firstChat = w.openChat(a.id, a.username);
  await w.openChat(b.id, b.username);
  slowFollow.resolve({ mutual: true }); await firstChat;
  assert(w.blogMessages.peer === b.id, "last conversation selection wins");
  w.blogAuth.getFollowState = async () => ({ mutual: true });
  await w.openChat(a.id, a.username);
  await until(() => $("#messageList").querySelectorAll(".dm-message").length === 32, "message history rendered");
  const input = $("#messageForm textarea");
  const type = value => { input.value = value; input.dispatchEvent(new w.Event("input", { bubbles: true })); };
  type("甲的未发送草稿");
  await w.openChat(b.id, b.username);
  assert(input.value === "", "drafts are isolated by conversation");
  type("乙的未发送草稿");
  await w.openChat(a.id, a.username);
  assert(input.value === "甲的未发送草稿" && !$("#messageDraftStatus").hidden, "draft restored with status");

  const pendingSend = deferred();
  w.blogAuth.sendDirectMessage = () => pendingSend.promise;
  $("#messageForm").requestSubmit();
  await w.openChat(b.id, b.username);
  type("发送过程中另一个会话的新草稿");
  pendingSend.resolve(true);
  await wait(50);
  assert(input.value === "发送过程中另一个会话的新草稿" && !input.disabled, "late send cannot reset another composer");
  await w.openChat(a.id, a.username);
  assert(input.value === "", "successful send clears only original draft");
  w.blogAuth.sendDirectMessage = async () => false;
  type("失败后应保留"); $("#messageForm").requestSubmit();
  await until(() => $("#messageForm").dataset.sending === "false", "failed send unlocks composer");
  assert(input.value === "失败后应保留", "failed send preserves draft");
  const editedSend = deferred();
  w.blogAuth.sendDirectMessage = () => editedSend.promise;
  $("#messageForm").requestSubmit();
  assert(!input.disabled, "sending does not dismiss the keyboard");
  type("请求期间继续编辑的文字");
  editedSend.resolve(true);
  await until(() => $("#messageForm").dataset.sending === "false", "edited send completes");
  assert(input.value === "请求期间继续编辑的文字", "successful send preserves newer input");
  const enter = new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  if (mode === "mobile") {
    input.dispatchEvent(enter);
    assert(!enter.defaultPrevented, "mobile Enter remains a newline");
  }

  const list = $("#messageList");
  const video = list.querySelector("video");
  const bubble = list.querySelector("[data-message-id='2']");
  const priorSignedCalls = signedCalls;
  list.scrollTop = 0;
  list.dispatchEvent(new w.Event("scroll"));
  rows.push({ id: 33, sender_id: a.id, content: "一条新的测试私信", created_at: "2026-09-06T09:00:00Z" });
  await syncMessage(rows[32]);
  assert(list.querySelector("video") === video && list.querySelector("[data-message-id='2']") === bubble, "new messages preserve media and existing DOM");
  assert(signedCalls === priorSignedCalls, "new text does not re-sign unchanged media");
  assert(list.scrollTop < 5 && !$("#messageLatestBtn").hidden && $("#messageLatestBtn").textContent.includes("1 条"), "incoming message does not interrupt history reading");
  $("#messageLatestBtn").click();
  assert(list.scrollHeight - list.scrollTop - list.clientHeight < 5 && $("#messageLatestBtn").hidden, "jump to latest clears in-view badge");

  const slowList = deferred();
  const fastList = deferred();
  let calls = 0;
  w.blogAuth.listDirectMessages = () => (++calls === 1 ? slowList.promise : fastList.promise);
  const slowRender = syncMessage({ sender_id: a.id });
  const fastRender = syncMessage({ sender_id: a.id });
  fastList.resolve([{ id: 80, sender_id: a.id, content: "较新的结果", created_at: "2026-09-06T09:00:00Z" }]);
  await fastRender;
  slowList.resolve([{ id: 79, sender_id: a.id, content: "已过时的结果", created_at: "2026-09-06T09:00:00Z" }]);
  await slowRender;
  assert(list.textContent.includes("较新的结果") && !list.textContent.includes("已过时的结果"), "out-of-order refresh cannot roll history back");
  assert(d.documentElement.scrollWidth <= w.innerWidth + 1, "chat fits viewport");
  assert($("#messageForm").getBoundingClientRect().bottom <= w.innerHeight + 2, "composer remains within viewport");

  const group = { group_id: "ux-group", group_name: "测试群聊", member_count: 2 };
  w.blogAuth.listGroupChats = async () => [group];
  w.blogAuth.listGroupChatMessages = async () => [];
  w.blogAuth.markGroupChatRead = async () => true;
  w.blogAuth.subscribeGroupChatMessages = () => () => {};
  await w.openGroupChat(group.group_id, group.group_name, group);
  assert(input.value === "", "group draft is separate from private chat");
  type("群聊中未完成的文字");
  w.blogMessages.close();
  await w.openGroupChat(group.group_id, group.group_name, group);
  assert(input.value === "群聊中未完成的文字", "group draft survives closing conversation");

  w.blogAuth.user = null;
  w.dispatchEvent(new w.Event("blog-auth-change"));
  assert(!w.blogMessages.peer && !w.sessionStorage.getItem("cnbdg-chat-drafts-v1").includes("ux-viewer"), "logout clears private drafts");
  w.blogAuth = originalAuth;

  if (mode === "mobile") {
    w.blogUI.navigate("home", { history: false, animate: false, restoreScroll: false });
    w.blogMobileShell.setDrawer(true);
    await wait(380);
    const nav = $("#mainNav");
    const button = nav.querySelector("[data-page='forum']");
    const rect = button.getBoundingClientRect();
    button.dispatchEvent(new w.PointerEvent("pointerdown", { bubbles: true, pointerType: "touch", pointerId: 44, isPrimary: true, clientX: rect.x + 20, clientY: rect.y + 20 }));
    assert(!nav.classList.contains("is-dragging"), "drawer does not capture ordinary taps");
    button.dispatchEvent(new w.PointerEvent("pointerup", { bubbles: true, pointerType: "touch", pointerId: 44, isPrimary: true }));
    button.click();
    assert(w.blogUI.state.page === "forum" && nav.inert, "drawer links remain interactive and close accessibly");
    w.blogUI.navigate("home", { history: false }); await frame(); await wait(70);
    const indicator = $(".liquid-glass-indicator");
    const before = new w.DOMMatrix(w.getComputedStyle(indicator).transform).m41;
    w.blogUI.navigate("notifications", { history: false }); await frame();
    const after = new w.DOMMatrix(w.getComputedStyle(indicator).transform).m41;
    assert(Math.abs(after - before) < 8 || w.blogMotion.reduceMotion.matches, "dock retargets from its visible position");
  }
  return { mode, count: checks.length, checks };
};
