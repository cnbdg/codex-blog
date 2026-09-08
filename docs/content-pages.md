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

## 跨设备阅读与发布检查

公开文章通过带公开 Publishable Key 的匿名请求读取，只查询 `status=published`，不依赖登录恢复、不发送登录令牌或 Cookie。请求 12 秒后结束等待并提供重试反馈；数据库权限保持不变，草稿不公开。排查时已确认线上第 19 篇文章可以匿名读取，因此没有将问题当作本机保存或放开数据库权限来处理。

后台保存成功后会显示文章链接，并另行检查匿名请求能否读取当前标题与正文。绿色表示本次公开读取通过；警告表示已经保存，但公开读取尚未确认，可以重新检查，不要因此重复新建文章。该检查不能保证所有设备、地区和运营商的网络条件。

Supabase SDK 改为锁定版本、同站点托管（参见 [官方安装说明](https://supabase.com/docs/reference/javascript/installing)）。构建会生成 `vendor/supabase.js` 和许可证，**必须把整个 `vendor/` 目录一起部署**；自动发布工作流已包含它。缺少此目录会影响登录功能。此次无需执行 SQL。

`npm test` 新增三个隔离浏览器的发布与读取回归测试：后台发布、未登录桌面读取、未登录手机读取。测试使用本地模拟云端服务，且检查重复提交、保存失败保留内容、草稿不可见、登录会话阻塞和公开请求超时，不向线上写入测试文章。

## 永久链接

在 `update-log.js` 中给本地文章设置唯一的 `permalink`，发布后不要修改它。页面注册表会保留文章原有的评论 ID，因此以后在日志顶部新增文章，不会让旧评论移动到其他文章下。

数据库文章和帖子按数据库 ID 生成入口。独立页面打开时仍会向 Supabase 检查最新公开记录，所以删除、封禁或隐藏内容后，不会留下带正文的静态副本。

## 阅读界面与自检

电脑端提供固定于视口的目录卡片、当前章节和浏览进度；手机端提供目录、回复或评论、分享、外观四个快捷入口。所有阅读页共享 `reader.css` 与 `reader.js`，页面结构在 `tools/build-content-pages.mjs` 中统一生成，不要单独编辑生成的 HTML。

运行 `npm test` 可检查独立页发布流程、320/390px 窄屏、深浅色、长目录、长昵称与多层楼中楼。阅读页测试使用模拟数据，且禁用远程数据库连接。调试这些离线样例时，可以运行 `node tools/browser-self-check.mjs --preview`，打开输出的本地地址。
