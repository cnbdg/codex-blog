(() => {
  "use strict";

  const config = window.BLOG_CONFIG || {};
  const configured = Boolean(config.supabaseUrl && config.supabasePublishableKey);
  const client = configured && window.supabase
    ? window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: "pkce"
        }
      })
    : null;
  const $ = selector => document.querySelector(selector);
  let user = null;
  let profile = null;
  let mode = "login";
  let recovering = false;
  let initialized = false;
  let profileRequest = 0;
  let pendingEmail = localStorage.getItem("yu-pending-email") || "";

  const messages = [
    [/invalid login credentials/i, "邮箱或密码不正确"],
    [/email not confirmed/i, "请先点击验证邮件中的链接，再登录"],
    [/user already registered/i, "这个邮箱已经注册，请直接登录"],
    [/password should be at least|weak password/i, "密码强度不足，请至少使用 8 个字符"],
    [/email rate limit|rate limit/i, "操作太频繁，请稍后再试"],
    [/unable to validate email/i, "邮箱格式不正确"],
    [/failed to fetch|network/i, "网络连接失败，请检查网络后重试"],
    [/signup is disabled/i, "网站暂时关闭了新用户注册"],
    [/same password/i, "新密码不能与当前密码相同"],
    [/session.*missing|refresh token/i, "登录状态已过期，请重新登录"]
    ,[/ACCOUNT_RESTRICTED/i, "当前账号暂时不能发言"]
    ,[/ALREADY_REPORTED/i, "你已经举报过这条内容"]
    ,[/ADMIN_REQUIRED/i, "当前账号没有审核权限"]
    ,[/CANNOT_BAN_ADMIN/i, "不能限制其他管理员账号"]
  ];

  function friendlyError(error, fallback = "操作失败，请稍后重试") {
    if (!error) return fallback;
    const raw = error.message || String(error);
    return messages.find(([pattern]) => pattern.test(raw))?.[1] || raw || fallback;
  }

  function notify(message) {
    if (window.toast) window.toast(message);
    else console.info(message);
  }

  function authRedirectUrl() {
    const fallback = new URL(location.pathname, location.origin).href;
    try {
      return new URL(config.siteUrl || fallback).href;
    } catch {
      return fallback;
    }
  }

  function clearAuthTokensFromUrl() {
    if (!/access_token=|refresh_token=|error_description=|type=/.test(location.hash) && !/[?&]code=/.test(location.search)) return;
    history.replaceState(null, document.title, location.pathname);
  }

  function callbackError() {
    const hash = new URLSearchParams(location.hash.slice(1));
    const query = new URLSearchParams(location.search);
    const message = hash.get("error_description") || query.get("error_description");
    return message ? message.replace(/\+/g, " ") : "";
  }

  function withTimeout(promise, milliseconds = 15000) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("network timeout")), milliseconds))
    ]);
  }

  function setMessage(target, message = "", kind = "error") {
    target.textContent = message;
    target.hidden = !message;
    target.classList.toggle("error", kind === "error");
    target.classList.toggle("success", kind === "success");
  }

  function setBusy(button, busy, busyText, normalText) {
    button.disabled = busy;
    button.setAttribute("aria-busy", String(busy));
    button.textContent = busy ? busyText : normalText;
  }

  function setMode(nextMode) {
    mode = nextMode;
    const signup = mode === "signup";
    document.querySelectorAll("[data-auth-tab]").forEach(button => {
      button.classList.toggle("active", button.dataset.authTab === mode);
      button.setAttribute("aria-selected", String(button.dataset.authTab === mode));
    });
    $("#usernameField").hidden = !signup;
    $("#usernameField input").required = signup;
    $("#confirmPasswordField").hidden = !signup;
    $("#confirmPasswordField input").required = signup;
    $("#passwordStrength").hidden = !signup;
    $("#authTitle").textContent = signup ? "创建账户" : "登录";
    $("#authSubmit").textContent = signup ? "注册" : "登录";
    $("#authForm input[name=password]").autocomplete = signup ? "new-password" : "current-password";
    $("#resetPasswordBtn").hidden = signup;
    if (!signup) $("#resendEmailBtn").hidden = !pendingEmail;
    updatePasswordStrength();
    setMessage($("#authError"));
  }

  function updateAuthUI() {
    const signedIn = Boolean(user);
    $("#authGuest").hidden = signedIn || recovering;
    $("#authRecovery").hidden = !recovering;
    $("#authUser").hidden = !signedIn || recovering;
    $("#authBtn").classList.toggle("logged-in", signedIn);
    $("#authBtn").querySelector("em").textContent =
      signedIn ? (profile?.username || user.user_metadata?.username || "账户") : "登录";
    $("#authBtn").querySelector("span").textContent =
      signedIn ? displayName()[0].toUpperCase() : "♙";
    $(".comments")?.classList.toggle("login-required", configured && !signedIn);
    if ($("#commentLoginTip")) $("#commentLoginTip").hidden = !configured || signedIn;
    if (signedIn) {
      $("#userName").textContent = displayName();
      $("#userEmail").textContent = user.email || "";
      $("#userAvatar").textContent = displayName()[0].toUpperCase();
      $("#userAvatar").style.backgroundImage = profile?.avatar_url ? `url("${profile.avatar_url.replace(/["\\]/g, "")}")` : "";
      $("#userAvatar").classList.toggle("has-image", Boolean(profile?.avatar_url));
      $("#userRole").textContent = profile?.is_admin ? "管理员 · 邮箱已验证" : "邮箱已验证";
      const profileForm = $("#profileForm");
      if (profileForm && !profileForm.contains(document.activeElement)) {
        profileForm.elements.username.value = displayName();
        profileForm.elements.avatar_url.value = profile?.avatar_url || "";
        profileForm.elements.display_title.value = profile?.display_title || "社区成员";
      }
    }
  }

  function displayName() {
    return profile?.username || user?.user_metadata?.username || user?.email?.split("@")[0] || "用户";
  }

  async function refreshProfile() {
    const request = ++profileRequest;
    if (!client || !user) {
      profile = null;
      updateAuthUI();
      window.dispatchEvent(new CustomEvent("blog-auth-change", { detail: { user, profile } }));
      return;
    }
    let result = await client.from("profiles")
      .select("username,avatar_url,display_title,is_admin")
      .eq("id", user.id)
      .maybeSingle();
    if (result.error) {
      await new Promise(resolve => setTimeout(resolve, 350));
      result = await client.from("profiles")
        .select("username,avatar_url,display_title,is_admin")
        .eq("id", user.id)
        .maybeSingle();
    }
    if (request !== profileRequest) return;
    if (result.error) notify("用户资料读取失败，请稍后重试");
    profile = result.data || { username: user.user_metadata?.username, is_admin: false };
    updateAuthUI();
    window.dispatchEvent(new CustomEvent("blog-auth-change", { detail: { user, profile } }));
  }

  function openAuth(nextMode = "login") {
    if (!configured) return notify("登录服务尚未配置");
    if (!client) return notify("登录组件加载失败，请刷新页面后重试");
    if (!user && !recovering) setMode(nextMode);
    updateAuthUI();
    if (!$("#authDialog").open) $("#authDialog").showModal();
  }

  async function init() {
    bindEvents();
    updateAuthUI();
    if (!client) {
      initialized = true;
      return;
    }

    const returnError = callbackError();
    if (returnError) {
      clearAuthTokensFromUrl();
      setMode("login");
      setMessage($("#authError"), friendlyError(returnError));
      openAuth();
    }

    client.auth.onAuthStateChange((event, session) => {
      user = session?.user || null;
      if (event === "SIGNED_IN" || event === "PASSWORD_RECOVERY") {
        clearAuthTokensFromUrl();
      }
      if (event === "PASSWORD_RECOVERY") {
        recovering = true;
        $("#authTitle").textContent = "设置新密码";
        openAuth();
      } else if (event === "SIGNED_OUT") {
        recovering = false;
      }
      updateAuthUI();
      setTimeout(async () => {
        await refreshProfile();
        if (window.renderComments && window.currentPost) window.renderComments();
      }, 0);
    });

    try {
      const { data, error } = await withTimeout(client.auth.getSession());
      if (error) notify(friendlyError(error, "登录状态读取失败"));
      user = data?.session?.user || null;
    } catch (error) {
      user = null;
      notify(friendlyError(error, "登录状态读取超时，请检查网络"));
    }
    initialized = true;
    await refreshProfile();
  }

  function bindEvents() {
    $("#authBtn").addEventListener("click", () => openAuth());
    document.addEventListener("click", event => {
      if (event.target.closest("[data-open-auth]")) openAuth();
      const toggle = event.target.closest("[data-toggle-password]");
      if (toggle) togglePassword(toggle);
    });
    $(".auth-tabs").addEventListener("click", event => {
      const tab = event.target.closest("[data-auth-tab]");
      if (tab) setMode(tab.dataset.authTab);
    });
    $("#authForm").addEventListener("submit", handleAuth);
    $("#newPasswordForm").addEventListener("submit", updatePassword);
    $("#profileForm").addEventListener("submit", updateProfile);
    $("#accountPasswordForm").addEventListener("submit", updateAccountPassword);
    $("#resetPasswordBtn").addEventListener("click", resetPassword);
    $("#resendEmailBtn").addEventListener("click", resendVerification);
    $("#logoutBtn").addEventListener("click", () => logout("local"));
    $("#logoutAllBtn").addEventListener("click", () => logout("global"));
    $("#authForm input[name=password]").addEventListener("input", updatePasswordStrength);
    $("#authDialog").addEventListener("click", event => {
      if (event.target === $("#authDialog")) {
        if (window.closeDialog) window.closeDialog($("#authDialog")); else $("#authDialog").close();
      }
    });
  }

  function togglePassword(button) {
    const input = button.parentElement.querySelector("input");
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    button.textContent = show ? "隐藏" : "显示";
    button.setAttribute("aria-label", show ? "隐藏密码" : "显示密码");
  }

  async function handleAuth(event) {
    event.preventDefault();
    if (!client) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email")).trim().toLowerCase();
    const password = String(data.get("password"));
    const confirmation = String(data.get("confirmPassword") || "");
    const username = String(data.get("username") || "").trim();

    setMessage($("#authError"));
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    if (mode === "signup" && (username.length < 2 || username.length > 20)) {
      return setMessage($("#authError"), "昵称需要包含 2–20 个字符");
    }
    if (mode === "signup" && password !== confirmation) {
      return setMessage($("#authError"), "两次输入的密码不一致");
    }

    const button = $("#authSubmit");
    setBusy(button, true, "请稍候…", mode === "signup" ? "注册" : "登录");
    try {
      const result = mode === "signup"
        ? await withTimeout(client.auth.signUp({
            email, password,
            options: {
              data: { username },
              emailRedirectTo: authRedirectUrl()
            }
          }))
        : await withTimeout(client.auth.signInWithPassword({ email, password }));

      if (result.error) {
        if (/email not confirmed/i.test(result.error.message || "")) {
          pendingEmail = email;
          localStorage.setItem("yu-pending-email", email);
          $("#resendEmailBtn").hidden = false;
        }
        return setMessage($("#authError"), friendlyError(result.error));
      }
      if (mode === "signup" && !result.data.session) {
        pendingEmail = email;
        localStorage.setItem("yu-pending-email", email);
        $("#resendEmailBtn").hidden = false;
        setMessage($("#authError"), "验证邮件已发送，请打开邮箱完成验证后再登录", "success");
      } else {
        pendingEmail = "";
        localStorage.removeItem("yu-pending-email");
        form.reset();
        if (window.closeDialog) window.closeDialog($("#authDialog")); else $("#authDialog").close();
        notify(mode === "signup" ? "账户创建成功" : "登录成功");
      }
    } catch (error) {
      setMessage($("#authError"), friendlyError(error));
    } finally {
      setBusy(button, false, "", mode === "signup" ? "注册" : "登录");
    }
  }

  async function resendVerification() {
    const email = $("#authForm input[name=email]").value.trim().toLowerCase() || pendingEmail;
    if (!email) return setMessage($("#authError"), "请先填写注册邮箱");
    const button = $("#resendEmailBtn");
    setBusy(button, true, "正在发送…", "重新发送验证邮件");
    try {
      const { error } = await withTimeout(client.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: authRedirectUrl() }
      }));
      if (error) return setMessage($("#authError"), friendlyError(error));
      setMessage($("#authError"), "验证邮件已重新发送，请检查收件箱和垃圾邮件", "success");
    } catch (error) {
      setMessage($("#authError"), friendlyError(error));
    } finally {
      setBusy(button, false, "", "重新发送验证邮件");
    }
  }

  async function resetPassword() {
    const emailInput = $("#authForm input[name=email]");
    const email = emailInput.value.trim().toLowerCase();
    setMessage($("#authError"));
    if (!email || !emailInput.checkValidity()) {
      emailInput.reportValidity();
      return setMessage($("#authError"), "请先填写正确的邮箱地址");
    }
    $("#resetPasswordBtn").disabled = true;
    $("#resetPasswordBtn").textContent = "正在发送…";
    try {
      const { error } = await withTimeout(client.auth.resetPasswordForEmail(email, {
        redirectTo: authRedirectUrl()
      }));
      if (error) return setMessage($("#authError"), friendlyError(error));
      setMessage($("#authError"), "重置邮件已发送，请检查收件箱和垃圾邮件", "success");
    } catch (error) {
      setMessage($("#authError"), friendlyError(error));
    } finally {
      $("#resetPasswordBtn").disabled = false;
      $("#resetPasswordBtn").textContent = "忘记密码？";
    }
  }

  async function updatePassword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const password = String(data.get("password"));
    const confirmation = String(data.get("confirmPassword"));
    setMessage($("#recoveryError"));
    if (!form.checkValidity()) return form.reportValidity();
    if (password !== confirmation) {
      return setMessage($("#recoveryError"), "两次输入的密码不一致");
    }
    const button = form.querySelector(".primary-btn");
    setBusy(button, true, "正在更新…", "更新密码");
    try {
      const { error } = await withTimeout(client.auth.updateUser({ password }));
      if (error) return setMessage($("#recoveryError"), friendlyError(error));
      recovering = false;
      form.reset();
      updateAuthUI();
      if (window.closeDialog) window.closeDialog($("#authDialog")); else $("#authDialog").close();
      notify("密码已更新，请妥善保管");
    } catch (error) {
      setMessage($("#recoveryError"), friendlyError(error));
    } finally {
      setBusy(button, false, "", "更新密码");
    }
  }

  async function logout(scope = "local") {
    const button = scope === "global" ? $("#logoutAllBtn") : $("#logoutBtn");
    button.disabled = true;
    try {
      const { error } = await withTimeout(client.auth.signOut({ scope }));
      if (error) return notify(friendlyError(error, "退出失败"));
      if (window.closeDialog) window.closeDialog($("#authDialog")); else $("#authDialog").close();
      notify("已退出登录");
    } finally {
      button.disabled = false;
    }
  }

  async function listComments(postId) {
    if (!client) return null;
    const { data, error } = await client.from("comments")
      .select("id,content,likes,created_at,author_id,profiles(username)")
      .eq("post_id", postId)
      .order("created_at", { ascending: false });
    if (error) {
      notify("评论加载失败：" + friendlyError(error));
      return [];
    }
    return (data || []).map(comment => ({
      id: comment.id,
      name: comment.profiles?.username || "博客读者",
      text: comment.content,
      time: new Date(comment.created_at).toLocaleString("zh-CN", { hour12: false }),
      likes: comment.likes,
      own: user?.id === comment.author_id
    }));
  }

  async function addComment(postId, content) {
    if (!client || !user) {
      openAuth();
      return false;
    }
    const cleanContent = String(content).trim();
    if (!cleanContent || cleanContent.length > 500) return false;
    const { error } = await client.from("comments").insert({
      post_id: postId, author_id: user.id, content: cleanContent
    });
    if (error) notify("评论发表失败：" + friendlyError(error));
    return !error;
  }

  async function likeComment(id) {
    if (!client || !user) {
      openAuth();
      return false;
    }
    const { error } = await client.rpc("increment_comment_likes", { comment_id: id });
    if (error) notify("点赞失败：" + friendlyError(error));
    return !error;
  }

  async function deleteComment(id) {
    if (!client || !user) return false;
    const { error } = await client.from("comments").delete().eq("id", id);
    if (error) notify("删除失败：" + friendlyError(error));
    return !error;
  }

  async function updateProfile(event) {
    event.preventDefault();
    if (!client || !user) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const username = String(data.get("username") || "").trim();
    const avatarUrl = String(data.get("avatar_url") || "").trim();
    const displayTitle = String(data.get("display_title") || "社区成员");
    const allowedTitles = ["社区成员", "新人报到", "活跃成员", "技术爱好者", "游戏玩家", "内容创作者"];
    setMessage($("#profileError"));
    if (!form.checkValidity()) return form.reportValidity();
    if (username.length < 2 || username.length > 20) {
      return setMessage($("#profileError"), "昵称需要包含 2–20 个字符");
    }
    if (!allowedTitles.includes(displayTitle)) {
      return setMessage($("#profileError"), "请选择有效的社区称号");
    }
    if (avatarUrl) {
      try {
        if (!/^https?:$/.test(new URL(avatarUrl).protocol)) throw new Error();
      } catch {
        return setMessage($("#profileError"), "头像地址必须是有效的 HTTP 或 HTTPS 图片链接");
      }
    }
    const button = form.querySelector(".primary-btn");
    setBusy(button, true, "正在保存…", "保存个人资料");
    try {
      const { error } = await client.from("profiles")
        .update({ username, avatar_url: avatarUrl || null, display_title: displayTitle })
        .eq("id", user.id);
      if (error) return setMessage($("#profileError"), friendlyError(error));
      await client.auth.updateUser({ data: { username } });
      await refreshProfile();
      setMessage($("#profileError"), "个人资料已保存", "success");
    } catch (error) {
      setMessage($("#profileError"), friendlyError(error));
    } finally {
      setBusy(button, false, "", "保存个人资料");
    }
  }

  async function updateAccountPassword(event) {
    event.preventDefault();
    if (!client || !user) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const password = String(data.get("password") || "");
    const confirmation = String(data.get("confirmPassword") || "");
    setMessage($("#accountPasswordError"));
    if (!form.checkValidity()) return form.reportValidity();
    if (password !== confirmation) {
      return setMessage($("#accountPasswordError"), "两次输入的密码不一致");
    }
    const button = form.querySelector(".primary-btn");
    setBusy(button, true, "正在更新…", "更新密码");
    try {
      const { error } = await withTimeout(client.auth.updateUser({ password }));
      if (error) return setMessage($("#accountPasswordError"), friendlyError(error));
      form.reset();
      setMessage($("#accountPasswordError"), "密码已更新，请使用新密码登录", "success");
    } catch (error) {
      setMessage($("#accountPasswordError"), friendlyError(error));
    } finally {
      setBusy(button, false, "", "更新密码");
    }
  }

  function updatePasswordStrength() {
    const meter = $("#passwordStrength");
    if (!meter || mode !== "signup") return;
    const password = $("#authForm input[name=password]").value;
    let score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
    if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;
    const levels = [
      ["0%", "#bd3f49", "请输入密码"],
      ["25%", "#d85f4b", "较弱"],
      ["50%", "#d39a35", "一般"],
      ["75%", "#5d9f66", "良好"],
      ["100%", "#2f9f65", "很强"]
    ];
    meter.style.setProperty("--strength", levels[score][0]);
    meter.style.setProperty("--strength-color", levels[score][1]);
    meter.querySelector("em").textContent = levels[score][2];
  }

  async function listPublishedPosts() {
    if (!client) return null;
    const { data, error } = await client.from("posts")
      .select("id,title,description,type,tags,read_time,lead,body,published_at")
      .eq("status", "published")
      .order("published_at", { ascending: false });
    if (error) return null;
    return data || [];
  }

  async function listAllPosts() {
    if (!client || !profile?.is_admin) return [];
    const { data, error } = await client.from("posts")
      .select("id,title,description,type,tags,read_time,lead,body,status,published_at,updated_at")
      .order("updated_at", { ascending: false });
    if (error) {
      notify("文章加载失败：" + friendlyError(error));
      return [];
    }
    return data || [];
  }

  async function savePost(post, id = null) {
    if (!client || !user || !profile?.is_admin) {
      notify("只有管理员可以保存文章");
      return null;
    }
    const payload = { ...post, author_id: user.id, updated_at: new Date().toISOString() };
    const query = id
      ? client.from("posts").update(payload).eq("id", id)
      : client.from("posts").insert(payload);
    const { data, error } = await query.select().single();
    if (error) {
      notify("保存失败：" + friendlyError(error));
      return null;
    }
    return data;
  }

  async function importPosts(posts) {
    if (!client || !user || !profile?.is_admin || !Array.isArray(posts) || !posts.length) {
      notify("没有可导入的文章，或当前账号没有管理员权限");
      return null;
    }
    const updatedAt = new Date().toISOString();
    const payload = posts.map(post => ({
      title: post.title,
      description: post.description,
      type: post.type,
      tags: post.tags,
      read_time: post.read_time,
      lead: post.lead,
      body: post.body,
      status: post.status,
      published_at: post.published_at,
      author_id: user.id,
      updated_at: updatedAt
    }));
    const { data, error } = await client.from("posts").insert(payload).select();
    if (error) {
      notify("批量导入失败：" + friendlyError(error));
      return null;
    }
    return data || [];
  }

  async function deletePost(id) {
    if (!client || !profile?.is_admin) return false;
    const { error } = await client.from("posts").delete().eq("id", id);
    if (error) notify("删除失败：" + friendlyError(error));
    return !error;
  }

  async function listForumThreads() {
    if (!client) return null;
    const { data, error } = await client.from("forum_posts")
      .select("id,title,content,created_at,updated_at,author_id,profiles(username,avatar_url,display_title,is_admin),forum_replies(count)")
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) return { error: friendlyError(error), rows: [] };
    return { rows: data || [] };
  }

  async function saveForumThread(thread, id = null) {
    if (!client || !user) {
      openAuth();
      return null;
    }
    const payload = {
      title: String(thread.title || "").trim(),
      content: String(thread.content || "").trim(),
      updated_at: new Date().toISOString()
    };
    if (!id) payload.author_id = user.id;
    const query = id
      ? client.from("forum_posts").update(payload).eq("id", id)
      : client.from("forum_posts").insert(payload);
    const { data, error } = await query.select().single();
    if (error) {
      notify("话题保存失败：" + friendlyError(error));
      return null;
    }
    return data;
  }

  async function deleteForumThread(id) {
    if (!client || !user) return false;
    const { error } = await client.from("forum_posts").delete().eq("id", id);
    if (error) notify("话题删除失败：" + friendlyError(error));
    return !error;
  }

  async function listForumReplies(threadId) {
    if (!client) return [];
    const { data, error } = await client.from("forum_replies")
      .select("id,content,floor_number,created_at,author_id,profiles(username,avatar_url,display_title,is_admin)")
      .eq("post_id", threadId)
      .order("created_at", { ascending: true });
    if (error) {
      notify("回复加载失败：" + friendlyError(error));
      return [];
    }
    return data || [];
  }

  async function addForumReply(threadId, content) {
    if (!client || !user) {
      openAuth();
      return false;
    }
    const cleanContent = String(content || "").trim();
    if (cleanContent.length < 1 || cleanContent.length > 2000) return false;
    const { error } = await client.from("forum_replies")
      .insert({ post_id: threadId, author_id: user.id, content: cleanContent });
    if (error) notify("回复发表失败：" + friendlyError(error));
    return !error;
  }

  async function deleteForumReply(id) {
    if (!client || !user) return false;
    const { error } = await client.from("forum_replies").delete().eq("id", id);
    if (error) notify("回复删除失败：" + friendlyError(error));
    return !error;
  }

  async function reportContent(targetType, targetId, reason) {
    if (!client || !user) {
      openAuth();
      return false;
    }
    const { error } = await client.rpc("report_content", {
      report_target_type: targetType,
      report_target_id: Number(targetId),
      report_reason: String(reason || "").trim()
    });
    if (error) notify("举报提交失败：" + friendlyError(error));
    return !error;
  }

  async function getMyModeration() {
    if (!client || !user) return null;
    const { data, error } = await client.rpc("get_my_moderation");
    if (error) return null;
    return data?.[0] || { banned: false };
  }

  async function listModerationUsers() {
    if (!client || !profile?.is_admin) return null;
    const { data, error } = await client.rpc("list_moderation_users");
    if (error) { notify("用户列表加载失败：" + friendlyError(error)); return null; }
    return data || [];
  }

  async function listModerationReports() {
    if (!client || !profile?.is_admin) return null;
    const { data, error } = await client.rpc("list_moderation_reports");
    if (error) { notify("举报列表加载失败：" + friendlyError(error)); return null; }
    return data || [];
  }

  async function listModerationActions() {
    if (!client || !profile?.is_admin) return null;
    const { data, error } = await client.from("moderation_actions")
      .select("id,action,target_user_id,report_id,details,created_at,profiles(username)")
      .order("created_at", { ascending: false }).limit(100);
    if (error) { notify("操作日志加载失败：" + friendlyError(error)); return null; }
    return data || [];
  }

  async function setUserBan(userId, until, reason) {
    if (!client || !profile?.is_admin) return false;
    const { error } = await client.rpc("set_user_ban", {
      target_user: userId, ban_until: until, ban_reason: String(reason || "").trim()
    });
    if (error) notify("限制用户失败：" + friendlyError(error));
    return !error;
  }

  async function clearUserBan(userId) {
    if (!client || !profile?.is_admin) return false;
    const { error } = await client.rpc("clear_user_ban", { target_user: userId });
    if (error) notify("解除限制失败：" + friendlyError(error));
    return !error;
  }

  async function moderateReport(reportId, decision) {
    if (!client || !profile?.is_admin) return false;
    const { error } = await client.rpc("moderate_report", {
      target_report_id: Number(reportId), decision
    });
    if (error) notify("审核处理失败：" + friendlyError(error));
    return !error;
  }

  window.blogAuth = {
    init, configured, openAuth, listComments, addComment, likeComment, deleteComment,
    listPublishedPosts, listAllPosts, savePost, importPosts, deletePost, refreshProfile,
    listForumThreads, saveForumThread, deleteForumThread,
    listForumReplies, addForumReply, deleteForumReply,
    reportContent, getMyModeration, listModerationUsers, listModerationReports,
    listModerationActions, setUserBan, clearUserBan, moderateReport,
    get user() { return user; },
    get profile() { return profile; },
    get isAdmin() { return Boolean(profile?.is_admin); },
    get initialized() { return initialized; }
  };
  document.addEventListener("DOMContentLoaded", init, { once: true });
})();
