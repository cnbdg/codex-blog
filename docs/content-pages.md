# 独立内容页面

博客文章和社区帖子现在使用可直接分享、可刷新访问的独立 HTML 页面：

- 本地更新文章：`articles/<permalink>.html`
- 数据库文章：`articles/post-<id>.html`
- 社区帖子：`threads/<id>.html`
- 尚未生成静态文件的新内容：`article.html?key=post-<id>` 或 `thread.html?id=<id>`

## 发帖后立即进入独立页面

帖子保存成功后，直接使用数据库返回的 ID 跳转到独立阅读页，不再等待社区列表刷新，也不会受列表筛选或条数限制影响。新帖使用 `thread.html?id=<id>`，同样具有独立布局、回复区域和分享链接，可以刷新、收藏或直接发送给朋友。

这不是原来的弹窗：手机端是独立单栏阅读页，电脑端是正文加阅读工具栏。后续生成 `threads/<id>.html` 只是补充文件入口；此前分享的 `thread.html?id=<id>` 仍然有效。即使定时构建延迟，新帖也不需要等它完成。

## 为什么线上仍是旧界面？

本地修改和构建完成不等于线上已部署。如果线上 `thread.html` 仍然返回 404，说明独立阅读入口尚未上线，不是靠反复刷新能解决的问题。首次需要把本次源码、构建产物和工作流一起提交并推送到 `main`，等待 Pages 部署成功；之后发新帖无需再次提交或手动构建。

## 自动发布

仓库中的 `.github/workflows/sync-content-pages.yml` 会：

1. 每 10 分钟检查一次 Supabase 的公开文章与帖子 ID。
2. 发现新增、删除或改变发布状态的内容后，自动生成独立页面并保存生成结果。
3. 直接部署新的 GitHub Pages 静态文件；普通代码推送也会立即构建和部署。
4. 没有内容变化时结束检查，不产生提交，也不重复部署。

第一次启用时，只需要在 GitHub 仓库进入 `Settings → Pages`，把 `Build and deployment → Source` 改成 `GitHub Actions`。这是一次性设置，以后不再需要手动运行 npm 命令。

也可以用 Git Bash 运行 `bash tools/enable-automatic-pages.sh`，由一次性向导自动打开正确页面并逐步提示。

新版首次部署成功后，新内容的通用分享入口立即工作；专属 HTML 文件由每 10 分钟一次的计划任务补充生成。GitHub 计划任务可能延迟，不保证完成时间，但不影响新内容即时打开和分享。

## 本地开发

需要在本机立即同步公开内容时，仍可选择运行：

```powershell
npm run build:pages
```

自动任务和本地命令都只使用 Supabase 的公开 Publishable Key 读取已公开内容的 ID，更新 `content-pages.json`，生成页面，再构建前端资源。它们不会读取私密内容，也不会修改数据库。

若只是离线修改样式或脚本，可运行：

```powershell
npm run build
```

构建生成的 `articles/`、`threads/`、`article.html`、`thread.html`、`content-index.js`、`content-pages.json`、`app.min.js`、`style.min.css` 和 `index.html` 都需要随源码一起提交。

## 永久链接

在 `update-log.js` 中给本地文章设置唯一的 `permalink`，发布后不要修改它。页面注册表会保留文章原有的评论 ID，因此以后在日志顶部新增文章，不会让旧评论移动到其他文章下。

数据库文章和帖子按数据库 ID 生成入口。独立页面打开时仍会向 Supabase 检查最新公开记录，所以删除、封禁或隐藏内容后，不会留下带正文的静态副本。
