# 注册人机验证启用指南

网站已经接入 Cloudflare Turnstile，并会把验证令牌交给 Supabase Auth 在服务端校验。还需要站长完成下面的密钥配置，注册入口才会开放。

## 1. 创建 Turnstile Widget

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)，进入 **Turnstile**。
2. 点击 **Add widget**，名称可填写 `cnbdg-blog-signup`。
3. Hostname 添加 `blog.hh2z.ndjp.net`。如果还会直接使用 GitHub Pages 地址，再添加 `cnbdg.github.io`。
4. Widget Mode 推荐选择 **Managed**，保存后复制 **Site Key** 和 **Secret Key**。

## 2. 填写前端 Site Key

打开 `config.js`，把公开的 Site Key 填入：

```js
turnstileSiteKey: "这里填写 Site Key",
captchaRequiredForSignup: true,
```

Site Key 本来就是公开值，可以提交到 GitHub。不要把 Secret Key 写入 `config.js`、其他前端文件或 GitHub 仓库。

## 3. 在 Supabase 开启服务端校验

1. 打开 Supabase 项目后台。
2. 进入 **Authentication → Bot and Abuse Protection**。
3. 开启 **CAPTCHA protection**，Provider 选择 **Cloudflare Turnstile**。
4. 在后台提供的密钥输入框中粘贴 **Secret Key**，然后保存。

Supabase 开启保护后，没有有效 Turnstile 令牌的注册请求会被服务端拒绝，不能只靠修改浏览器前端绕过。

## 4. 验证效果

1. 等待 GitHub Pages 部署完成，使用无痕窗口打开 `https://blog.hh2z.ndjp.net/`。
2. 进入注册页，确认“安全验证”可以正常加载。
3. 未完成验证时注册按钮应保持禁用；验证完成后按钮会启用。
4. 尝试注册一个测试账号，确认 Supabase Authentication 的 Users 列表出现该用户。

本地测试需要把 `localhost` 加入 Turnstile Hostname，或使用 Cloudflare 官方测试密钥；生产环境不要长期使用测试密钥。
