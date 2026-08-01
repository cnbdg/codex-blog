import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const reports = new Map();
const mime = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"]
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (url.pathname === "/__self-check-report" && request.method === "POST") {
        let body = "";
        for await (const chunk of request) body += chunk;
        let report;
        try { report = JSON.parse(body); } catch { report = { status: "fail", detail: { error: "测试报告格式错误" } }; }
        reports.get(url.searchParams.get("run"))?.(report);
        reports.delete(url.searchParams.get("run"));
        response.writeHead(204).end();
        return;
      }
      const relative = decodeURIComponent(url.pathname === "/" ? "index.html" : url.pathname)
        .replace(/^[/\\]+/, "");
      if (relative === "__self-check-index.html") {
        const source = await readFile(resolve(root, "index.html"), "utf8");
        let body = source
          .replace(/<link\b[^>]*href="https:\/\/fonts\.[^"]+"[^>]*>/g, "")
          .replace(/<script\s+src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"><\/script>/, "")
          .replace(/(<script src="config\.js[^>]*><\/script>)/, `$1<script>if(window.BLOG_CONFIG?.wallpaperSettings){BLOG_CONFIG.wallpaperSettings.desktop=[];BLOG_CONFIG.wallpaperSettings.mobile=[];BLOG_CONFIG.wallpaperSettings.desktopDefault="";BLOG_CONFIG.wallpaperSettings.mobileDefault=""}</script>`);
        if (process.env.SELF_CHECK_THEME === "dark") {
          body = body.replace("</head>", `<script>localStorage.setItem("yu-theme","dark")</script></head>`);
        }
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(body);
        return;
      }
      const target = normalize(join(root, relative));
      if (!target.startsWith(root)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      const body = await readFile(target);
      response.writeHead(200, { "content-type": mime.get(extname(target).toLowerCase()) || "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  return new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveServer(server));
  });
}

async function terminateTree(pid) {
  await new Promise(resolveExit => {
    const killer = spawn("C:\\Windows\\System32\\taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true
    });
    killer.once("exit", resolveExit);
    killer.once("error", resolveExit);
  });
}

async function runChrome(url, width, height, scale = 1) {
  const runId = randomUUID();
  const testUrl = new URL(url);
  testUrl.searchParams.set("run", runId);
  const profile = await mkdtemp(join(tmpdir(), "codex-blog-self-check-"));
  const chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    `--window-size=${width},${height}`,
    `--force-device-scale-factor=${scale}`,
    `--user-data-dir=${profile}`,
    testUrl.href
  ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  if (process.env.SELF_CHECK_DEBUG) console.error(`SELF_CHECK_CHROME pid=${chrome.pid} url=${testUrl.href}`);
  let errorOutput = "";
  chrome.stdout.resume();
  chrome.stderr.setEncoding("utf8").on("data", chunk => { errorOutput += chunk; });
  let reportResolver;
  const report = new Promise(resolveReport => { reportResolver = resolveReport; });
  reports.set(runId, reportResolver);
  const exit = new Promise((resolveExit, reject) => {
    chrome.once("error", reject);
    chrome.once("exit", code => resolveExit({ status: "browser-exit", code }));
  });
  let timeoutId;
  const timeout = new Promise(resolveTimeout => { timeoutId = setTimeout(() => resolveTimeout({ status: "timeout" }), 25000); });
  const outcome = await Promise.race([report, exit, timeout]);
  clearTimeout(timeoutId);
  reports.delete(runId);
  try {
    assert(outcome?.status !== "timeout", `Chrome 页面测试超时：${errorOutput.slice(-500)}`);
    assert(outcome?.status !== "browser-exit", `Chrome 提前退出（${outcome?.code}）：${errorOutput.slice(-300)}`);
    assert(outcome?.status === "pass", JSON.stringify(outcome?.detail || { error: "浏览器交互测试失败" }));
    return outcome.detail;
  } finally {
    chrome.kill();
    await terminateTree(chrome.pid);
    await Promise.race([exit, new Promise(resolveWait => setTimeout(resolveWait, 1500))]);
    await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
  }
}

async function main() {
  const server = await startStaticServer();
  const origin = `http://127.0.0.1:${server.address().port}`;
  if (process.env.SELF_CHECK_DEBUG) console.error(`SELF_CHECK_SERVER ${origin}`);
  try {
    const desktop = await runChrome(`${origin}/tools/browser-self-check.html?mode=desktop`, 1440, 900);
    const mobile = await runChrome(`${origin}/tools/browser-self-check.html?mode=mobile`, 500, 980);
    console.log(JSON.stringify({ status: "PASS", desktop, mobile }, null, 2));
  } finally {
    await new Promise(resolveClose => {
      server.close(resolveClose);
      server.closeAllConnections?.();
    });
  }
}

main().catch(error => {
  console.error(`SELF_CHECK_FAILED: ${error.stack || error.message || String(error)}`);
  process.exitCode = 1;
});
