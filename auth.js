(() => {
  "use strict";

  const config = window.BLOG_CONFIG || {};
  const configured = Boolean(config.supabaseUrl && config.supabasePublishableKey);
  const client = configured && window.supabase
    ? window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      })
    : null;
  const $ = selector => document.querySelector(selector);
  let user = null;
  let mode = "login";
  let recovering = false;
  let initialized = false;

  const messages = [
    [/invalid login credentials/i, "邮箱或密码不正确"],
    [/email not confirmed/i, "请先点击验证邮件中的链接，再登录"],
    [/user already registered/i, "这个邮箱已经注册，请直接登录"],
    [/password should be at least|weak password/i, "密码强度不足，请至少使用 8 个字符"],
    [/email rate limit|rate limit/i, "操作太频繁，请稍后再试"],
    [/unable to validate email/i, "邮箱格式不正确"],
    [/failed to fetch|network/i, "网络连接失败，请检查网络后重试"],
    [/signup is disabled/i, "网站暂时关闭了新用户注册"]
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
    $("#authTitle").textContent = signup ? "创建账户" : "登录";
    $("#authSubmit").textContent = signup ? "注册" : "登录";
    $("#authForm input[name=password]").autocomplete = signup ? "new-password" : "current-password";
    setMessage($("#authError"));
  }

  function updateAuthUI() {
    const signedIn = Boolean(user);
    $("#authGuest").hidden = signedIn || recovering;
    $("#authRecovery").hidden = !recovering;
    $("#authUser").hidden = !signedIn || recovering;
    $("#authBtn").classList.toggle("logged-in", signedIn);
    $("#authBtn").querySelector("em").textContent =
      signedIn ? (user.user_metadata?.username || "账户") : "登录";
    $("#authBtn").querySelector("span").textContent =
      signedIn ? displayName()[0].toUpperCase() : "♙";
    $(".comments")?.classList.toggle("login-required", configured && !signedIn);
    if ($("#commentLoginTip")) $("#commentLoginTip").hidden = !configured || signedIn;
    if (signedIn) {
      $("#userName").textContent = displayName();
      $("#userEmail").textContent = user.email || "";
      $("#userAvatar").textContent = displayName()[0].toUpperCase();
    }
  }

  function displayName() {
    return user?.user_metadata?.username || user?.email?.split("@")[0] || "用户";
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

    client.auth.onAuthStateChange((event, session) => {
      user = session?.user || null;
      if (event === "PASSWORD_RECOVERY") {
        recovering = true;
        $("#authTitle").textContent = "设置新密码";
        openAuth();
      } else if (event === "SIGNED_OUT") {
        recovering = false;
      }
      updateAuthUI();
      if (window.renderComments && window.currentPost) window.renderComments();
    });

    const { data, error } = await client.auth.getSession();
    if (error) notify(friendlyError(error, "登录状态读取失败"));
    user = data?.session?.user || null;
    initialized = true;
    updateAuthUI();
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
    $("#resetPasswordBtn").addEventListener("click", resetPassword);
    $("#logoutBtn").addEventListener("click", logout);
    $("#authDialog").addEventListener("click", event => {
      if (event.target === $("#authDialog")) $("#authDialog").close();
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
    const username = String(data.get("username") || "").trim();

    setMessage($("#authError"));
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    if (mode === "signup" && (username.length < 2 || username.length > 20)) {
      return setMessage($("#authError"), "昵称需要包含 2–20 个字符");
    }

    const button = $("#authSubmit");
    setBusy(button, true, "请稍候…", mode === "signup" ? "注册" : "登录");
    try {
      const result = mode === "signup"
        ? await client.auth.signUp({
            email, password,
            options: {
              data: { username },
              emailRedirectTo: new URL(location.pathname, location.origin).href
            }
          })
        : await client.auth.signInWithPassword({ email, password });

      if (result.error) return setMessage($("#authError"), friendlyError(result.error));
      form.reset();
      if (mode === "signup" && !result.data.session) {
        setMessage($("#authError"), "验证邮件已发送，请打开邮箱完成验证后再登录", "success");
      } else {
        $("#authDialog").close();
        notify(mode === "signup" ? "账户创建成功" : "登录成功");
      }
    } catch (error) {
      setMessage($("#authError"), friendlyError(error));
    } finally {
      setBusy(button, false, "", mode === "signup" ? "注册" : "登录");
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
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: new URL(location.pathname, location.origin).href
      });
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
      const { error } = await client.auth.updateUser({ password });
      if (error) return setMessage($("#recoveryError"), friendlyError(error));
      recovering = false;
      form.reset();
      updateAuthUI();
      $("#authDialog").close();
      notify("密码已更新，请妥善保管");
    } catch (error) {
      setMessage($("#recoveryError"), friendlyError(error));
    } finally {
      setBusy(button, false, "", "更新密码");
    }
  }

  async function logout() {
    $("#logoutBtn").disabled = true;
    try {
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) return notify(friendlyError(error, "退出失败"));
      $("#authDialog").close();
      notify("已退出登录");
    } finally {
      $("#logoutBtn").disabled = false;
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

  window.blogAuth = {
    init, configured, openAuth, listComments, addComment, likeComment, deleteComment,
    get user() { return user; },
    get initialized() { return initialized; }
  };
  document.addEventListener("DOMContentLoaded", init, { once: true });
})();
