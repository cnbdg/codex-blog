import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chromeCandidates = [
  process.env.SELF_CHECK_CHROME,
  join(process.env.USERPROFILE || "", ".agent-browser", "browsers", "chrome-win64", "chrome.exe"),
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
].filter(Boolean);
const chromePath = chromeCandidates.find(candidate => existsSync(candidate));
if (!chromePath) {
  console.error("No Chrome/Chromium found. Set SELF_CHECK_CHROME to a chrome.exe path.");
  process.exit(1);
}
if (process.env.SELF_CHECK_DEBUG) console.error(`SELF_CHECK_CHROME=${chromePath}`);
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

// Chrome child processes (renderer/gpu/utility) can outlive the main PID and
// keep the profile directory locked. Kill every process whose command line
// references the profile, then wait for the handles to be released.
async function killProfileProcesses(profile) {
  // Like-based match avoids regex-escaping pitfalls with backslashes.
  const script =
    `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | ` +
    `Where-Object { $_.CommandLine -like '*${profile}*' } | ` +
    `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  await new Promise(resolveExit => {
    const killer = spawn("powershell.exe", ["-NoProfile", "-Command", script], {
      stdio: "ignore",
      windowsHide: true
    });
    const timer = setTimeout(() => resolveExit("timeout"), 6000);
    killer.once("exit", () => { clearTimeout(timer); resolveExit("exit"); });
    killer.once("error", resolveExit);
  });
  // Wait for file handles to be released before the caller deletes the dir.
  await new Promise(resolveWait => setTimeout(resolveWait, 800));
}

async function runChrome(url, width, height, scale = 1) {
  const runId = randomUUID();
  const testUrl = new URL(url);
  testUrl.searchParams.set("run", runId);
  const profile = await mkdtemp(join(tmpdir(), "codex-blog-self-check-"));
  if (process.env.SELF_CHECK_DEBUG) console.error(`SELF_CHECK_PROFILE ${profile}`);
  const chromeArgs = [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-breakpad",
    "--disable-crash-reporter",
    `--window-size=${width},${height}`,
    `--force-device-scale-factor=${scale}`,
    `--user-data-dir=${profile}`,
    testUrl.href
  ];
  if (process.env.SELF_CHECK_REDUCED_MOTION === "1") chromeArgs.splice(1, 0, "--force-prefers-reduced-motion=reduce");
  // Chrome for Testing on this machine exits immediately (code 0) when spawned
  // with pipe stdio. Detached + ignored stdio keeps it running like a normal
  // headless instance; cleanup still happens via taskkill on the process tree.
  const chrome = spawn(chromePath, chromeArgs, { windowsHide: true, stdio: "ignore", detached: true });
  chrome.unref();
  if (process.env.SELF_CHECK_DEBUG) console.error(`SELF_CHECK_CHROME pid=${chrome.pid} url=${testUrl.href}`);
  let errorOutput = "";
  let reportResolver;
  const report = new Promise(resolveReport => { reportResolver = resolveReport; });
  reports.set(runId, reportResolver);
  const exit = new Promise((resolveExit, reject) => {
    chrome.once("error", reject);
    chrome.once("exit", code => resolveExit({ status: "browser-exit", code }));
  });
  let timeoutId;
  const timeout = new Promise(resolveTimeout => { timeoutId = setTimeout(() => resolveTimeout({ status: "timeout" }), 25000); });
  // Chrome for Testing on Windows spawns a launcher process that exits with
  // code 0 right after handing off to the real browser process. Treating that
  // as "Chrome exited early" aborts every run, so the page report is the only
  // success signal; the timeout remains the failure signal. The exit promise
  // is kept for cleanup but must not participate in the race.
  const outcome = await Promise.race([report, timeout]);
  if (process.env.SELF_CHECK_DEBUG) console.error(`SELF_CHECK_OUTCOME ${JSON.stringify(outcome)}`);
  clearTimeout(timeoutId);
  reports.delete(runId);
  try {
    assert(outcome?.status !== "timeout", `Chrome 页面测试超时：${errorOutput.slice(-500)}`);
    assert(outcome?.status !== "browser-exit" || errorOutput.length, `Chrome 提前退出（${outcome?.code}）且未收到页面报告`);
    assert(outcome?.status === "pass", JSON.stringify(outcome?.detail || { error: "浏览器交互测试失败" }));
    return outcome.detail;
  } finally {
    if (process.env.SELF_CHECK_DEBUG) console.error("SELF_CHECK_CLEANUP_START");
    // Kill the process tree FIRST while the main PID is still alive; taskkill
    // /T cannot find a tree rooted at an already-dead PID, which used to leave
    // renderer/gpu/utility children holding the profile directory open.
    await terminateTree(chrome.pid);
    if (process.env.SELF_CHECK_DEBUG) console.error("SELF_CHECK_CLEANUP_TASKKILL_DONE");
    chrome.kill();
    await Promise.race([exit, new Promise(resolveWait => setTimeout(resolveWait, 1500))]);
    await killProfileProcesses(profile);
    if (process.env.SELF_CHECK_DEBUG) console.error("SELF_CHECK_CLEANUP_KILLPROFILE_DONE");
    await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
    if (process.env.SELF_CHECK_DEBUG) console.error("SELF_CHECK_CLEANUP_RM_DONE");
  }
}

async function main() {
  const ownerMigration = await readFile(resolve(root, "permanent-owner.sql"), "utf8");
  const ownerSecurity = {
    transaction: /\bbegin;[\s\S]*commit;\s*$/i.test(ownerMigration.trim()),
    immutableRole: /add column if not exists is_owner[\s\S]*protect_permanent_owner_trigger/i.test(ownerMigration),
    updateAndDeleteGuard: /before update or delete on public\.profiles/i.test(ownerMigration),
    moderationGuard: /before insert or update on public\.user_moderation/i.test(ownerMigration),
    rpcGuard: /admin_manage_member[\s\S]*OWNER_PROTECTED/i.test(ownerMigration),
    compatibleLookup: /admin_get_member_by_uid_v2/i.test(ownerMigration) && !/drop function if exists public\.admin_get_member_by_uid\(bigint\)/i.test(ownerMigration),
    schemaReload: /notify pgrst,\s*'reload schema'/i.test(ownerMigration),
    privateEmailAbsent: !/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(ownerMigration)
  };
  assert(Object.values(ownerSecurity).every(Boolean), `永久站长数据库保护脚本不完整：${JSON.stringify(ownerSecurity)}`);
  const server = await startStaticServer();
  const origin = `http://127.0.0.1:${server.address().port}`;
  if (process.env.SELF_CHECK_DEBUG) console.error(`SELF_CHECK_SERVER ${origin}`);
  try {
    const desktop = await runChrome(`${origin}/tools/browser-self-check.html?mode=desktop`, 1440, 900);
    const mobile = await runChrome(`${origin}/tools/browser-self-check.html?mode=mobile`, 500, 980);
    const authentication = await runChrome(`${origin}/tools/auth-self-check.html`, 1100, 800);
    console.log(JSON.stringify({ status: "PASS", ownerSecurity, desktop, mobile, authentication }, null, 2));
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
