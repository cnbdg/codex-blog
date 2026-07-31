(() => {
  const config = window.BLOG_CONFIG || {};
  const configured = Boolean(config.supabaseUrl && config.supabasePublishableKey);
  const client = configured && window.supabase
    ? window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey)
    : null;
  let user = null;
  const $ = s => document.querySelector(s);
  const notify = message => window.toast ? window.toast(message) : alert(message);

  function openAuth() {
    if (!configured) {
      notify("登录服务尚未配置，请先填写 Supabase 项目信息");
      return;
    }
    updateAuthUI();
    $("#authDialog").showModal();
  }

  function updateAuthUI() {
    const signedIn = Boolean(user);
    $("#authGuest").hidden = signedIn;
    $("#authUser").hidden = !signedIn;
    $("#authBtn").classList.toggle("logged-in", signedIn);
    $("#authBtn").querySelector("em").textContent = signedIn ? (user.user_metadata?.username || "账户") : "登录";
    $("#authBtn").querySelector("span").textContent = signedIn ? (user.user_metadata?.username || user.email)[0].toUpperCase() : "♙";
    $(".comments")?.classList.toggle("login-required", configured && !signedIn);
    if ($("#commentLoginTip")) $("#commentLoginTip").hidden = !configured || signedIn;
    if (signedIn) {
      const name = user.user_metadata?.username || user.email.split("@")[0];
      $("#userName").textContent = name;
      $("#userEmail").textContent = user.email;
      $("#userAvatar").textContent = name[0].toUpperCase();
    }
  }

  async function init() {
    $("#authBtn").addEventListener("click", openAuth);
    document.addEventListener("click", e => {
      if (e.target.closest("[data-open-auth]")) openAuth();
    });
    document.querySelector(".auth-tabs").addEventListener("click", e => {
      const tab = e.target.closest("[data-auth-tab]");
      if (!tab) return;
      document.querySelectorAll("[data-auth-tab]").forEach(x => x.classList.toggle("active", x === tab));
      const signup = tab.dataset.authTab === "signup";
      $("#usernameField").hidden = !signup;
      $("#usernameField input").required = signup;
      $("#authTitle").textContent = signup ? "创建账户" : "登录";
      $("#authSubmit").textContent = signup ? "注册" : "登录";
      $("#authForm input[name=password]").autocomplete = signup ? "new-password" : "current-password";
    });
    $("#authForm").addEventListener("submit", handleAuth);
    $("#logoutBtn").addEventListener("click", async () => {
      await client.auth.signOut();
      $("#authDialog").close();
      notify("已退出登录");
    });
    $("#resetPasswordBtn").addEventListener("click", resetPassword);
    if (!client) {
      updateAuthUI();
      return;
    }
    const { data } = await client.auth.getSession();
    user = data.session?.user || null;
    updateAuthUI();
    client.auth.onAuthStateChange((_event, session) => {
      user = session?.user || null;
      updateAuthUI();
      if (window.renderComments && window.currentPost) window.renderComments();
    });
  }

  async function handleAuth(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const signup = document.querySelector("[data-auth-tab=signup]").classList.contains("active");
    const button = $("#authSubmit");
    button.disabled = true;
    button.textContent = "请稍候…";
    const credentials = { email: data.get("email").trim(), password: data.get("password") };
    let result;
    if (signup) {
      result = await client.auth.signUp({
        ...credentials,
        options: {
          data: { username: data.get("username").trim() },
          emailRedirectTo: location.origin + location.pathname
        }
      });
    } else {
      result = await client.auth.signInWithPassword(credentials);
    }
    button.disabled = false;
    button.textContent = signup ? "注册" : "登录";
    if (result.error) return notify(result.error.message);
    form.reset();
    if (signup && !result.data.session) {
      notify("注册成功，请检查邮箱并完成验证");
    } else {
      $("#authDialog").close();
      notify(signup ? "账户创建成功" : "登录成功");
    }
  }

  async function resetPassword() {
    const email = $("#authForm input[name=email]").value.trim();
    if (!email) return notify("请先填写邮箱地址");
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: location.origin + location.pathname
    });
    notify(error ? error.message : "密码重置邮件已发送");
  }

  async function listComments(postId) {
    if (!client) return null;
    const { data, error } = await client.from("comments")
      .select("id,content,likes,created_at,author_id,profiles(username)")
      .eq("post_id", postId).order("created_at", { ascending: false });
    if (error) { notify("评论加载失败：" + error.message); return []; }
    return data.map(c => ({
      id: c.id, name: c.profiles?.username || "博客读者", text: c.content,
      time: new Date(c.created_at).toLocaleString("zh-CN", { hour12: false }),
      likes: c.likes, own: user?.id === c.author_id
    }));
  }

  async function addComment(postId, content) {
    if (!client || !user) { openAuth(); return false; }
    const { error } = await client.from("comments").insert({
      post_id: postId, author_id: user.id, content
    });
    if (error) { notify("评论发表失败：" + error.message); return false; }
    return true;
  }

  async function likeComment(id) {
    if (!client || !user) { openAuth(); return false; }
    const { error } = await client.rpc("increment_comment_likes", { comment_id: id });
    if (error) notify("点赞失败：" + error.message);
    return !error;
  }

  async function deleteComment(id) {
    if (!client || !user) return false;
    const { error } = await client.from("comments").delete().eq("id", id);
    if (error) notify("删除失败：" + error.message);
    return !error;
  }

  window.blogAuth = { init, configured, get user() { return user; }, openAuth, listComments, addComment, likeComment, deleteComment };
  document.addEventListener("DOMContentLoaded", init);
})();
