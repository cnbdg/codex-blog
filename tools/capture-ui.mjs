import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, ".ui-check");
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
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

function startServer() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (url.pathname === "/__wallpaper.svg") {
        const body = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#18355f"/><stop offset=".48" stop-color="#6d55a8"/><stop offset="1" stop-color="#e7809b"/></linearGradient><radialGradient id="r"><stop stop-color="#7fe5ef" stop-opacity=".8"/><stop offset="1" stop-color="#7fe5ef" stop-opacity="0"/></radialGradient></defs><rect width="1600" height="1000" fill="url(#g)"/><circle cx="1250" cy="160" r="430" fill="url(#r)"/><circle cx="280" cy="840" r="520" fill="url(#r)" opacity=".42"/><path d="M0 720 Q400 520 800 760 T1600 650 V1000 H0Z" fill="#091b36" opacity=".42"/></svg>`;
        response.writeHead(200, { "cache-control": "no-store", "content-type": "image/svg+xml" });
        response.end(body);
        return;
      }
      if (url.pathname === "/__capture.html") {
        const width = Math.max(320, Math.min(480, Number(url.searchParams.get("width")) || 390));
        const height = Math.max(640, Math.min(1000, Number(url.searchParams.get("height")) || 844));
        const page = String(url.searchParams.get("page") || "home").replace(/[^a-z-]/g, "");
        const body = `<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{height:100%;margin:0}body{display:grid;place-items:start center;background:#dfe7ec}iframe{width:${width}px;height:${height}px;border:0;background:#fff;box-shadow:0 0 0 1px #c8d2d9,0 20px 60px #28384522}</style><iframe src="/#${page}" title="${page}"></iframe>`;
        response.writeHead(200, { "cache-control": "no-store", "content-type": "text/html; charset=utf-8" });
        response.end(body);
        return;
      }
      const relative = decodeURIComponent(url.pathname === "/" ? "index.html" : url.pathname)
        .replace(/^[/\\]+/, "");
      const target = normalize(join(root, relative));
      if (!target.startsWith(root)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      if (relative === "index.html") {
        const source = await readFile(target, "utf8");
        let body = source
          .replace(/<link\b[^>]*href="https:\/\/fonts\.[^"]+"[^>]*>/g, "")
          .replace(/<script\s+src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"><\/script>/, "");
        if (process.env.UI_CAPTURE_THEME === "dark") {
          body = body.replace("</head>", `<script>localStorage.setItem("yu-theme","dark")</script></head>`);
        }
        if (process.env.UI_CAPTURE_WALLPAPER === "mock") {
          body = body.replace(/(<script src="config\.js[^>]*><\/script>)/, `$1<script>if(window.BLOG_CONFIG?.wallpaperSettings){BLOG_CONFIG.wallpaperSettings.desktop=[];BLOG_CONFIG.wallpaperSettings.mobile=[];BLOG_CONFIG.wallpaperSettings.desktopDefault="/__wallpaper.svg";BLOG_CONFIG.wallpaperSettings.mobileDefault="/__wallpaper.svg"}</script>`);
        } else if (process.env.UI_CAPTURE_WALLPAPER !== "1") {
          body = body.replace(/(<script src="config\.js[^>]*><\/script>)/, `$1<script>if(window.BLOG_CONFIG?.wallpaperSettings){BLOG_CONFIG.wallpaperSettings.desktop=[];BLOG_CONFIG.wallpaperSettings.mobile=[];BLOG_CONFIG.wallpaperSettings.desktopDefault="";BLOG_CONFIG.wallpaperSettings.mobileDefault=""}</script>`);
        }
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "text/html; charset=utf-8"
        });
        response.end(body);
        return;
      }
      const body = await readFile(target);
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": mime.get(extname(target).toLowerCase()) || "application/octet-stream"
      });
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

function terminateTree(pid) {
  return new Promise(resolveExit => {
    const killer = spawn("C:\\Windows\\System32\\taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true
    });
    killer.once("exit", resolveExit);
    killer.once("error", resolveExit);
  });
}

async function capture(origin, page, viewport) {
  const profile = await mkdtemp(join(tmpdir(), "codex-blog-ui-"));
  const variants = [
    process.env.UI_CAPTURE_THEME === "dark" ? "dark" : "",
    ["1", "mock"].includes(process.env.UI_CAPTURE_WALLPAPER || "") ? "wallpaper" : ""
  ].filter(Boolean);
  const suffix = variants.length ? `-${variants.join("-")}` : "";
  const screenshot = join(output, `${viewport.name}-${page}${suffix}.png`);
  await rm(screenshot, { force: true });
  const framedMobile = viewport.name === "mobile";
  const browserWidth = framedMobile ? 540 : viewport.width;
  const browserHeight = framedMobile ? 1000 : viewport.height;
  const targetUrl = framedMobile
    ? `${origin}/__capture.html?width=${viewport.width}&height=${viewport.height}&page=${page}`
    : `${origin}/#${page}`;
  const chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-breakpad",
    "--disable-crash-reporter",
    "--disable-background-networking",
    "--hide-scrollbars",
    `--window-size=${browserWidth},${browserHeight}`,
    "--virtual-time-budget=3000",
    `--user-data-dir=${profile}`,
    `--screenshot=${screenshot}`,
    targetUrl
  ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });

  let errorOutput = "";
  chrome.stderr.setEncoding("utf8").on("data", chunk => { errorOutput += chunk; });
  let launchError;
  chrome.once("error", error => { launchError = error; });

  const waitForScreenshot = new Promise((resolveScreenshot, rejectScreenshot) => {
    const startedAt = Date.now();
    const timeoutMs = process.env.UI_CAPTURE_WALLPAPER === "1" ? 45000 : 20000;
    const check = async () => {
      if (launchError) {
        rejectScreenshot(launchError);
        return;
      }
      try {
        const first = await stat(screenshot);
        if (first.size > 0) {
          setTimeout(async () => {
            try {
              const second = await stat(screenshot);
              if (second.size === first.size) resolveScreenshot();
              else setTimeout(check, 250);
            } catch {
              setTimeout(check, 250);
            }
          }, 250);
          return;
        }
      } catch {
        // The browser has not written the screenshot yet.
      }
      if (Date.now() - startedAt >= timeoutMs) {
        rejectScreenshot(new Error(`截图超时：${viewport.name}-${page}`));
        return;
      }
      setTimeout(check, 250);
    };
    check();
  });

  try {
    await waitForScreenshot;
    return `${viewport.name}-${page}${suffix}.png`;
  } catch (error) {
    throw new Error(`${error.message}\n${errorOutput.slice(-500)}`);
  } finally {
    if (chrome.exitCode === null) await terminateTree(chrome.pid);
    try {
      await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 });
    } catch {
      // Chrome may briefly retain a Crashpad file after the screenshot is ready.
    }
  }
}

async function main() {
  await mkdir(output, { recursive: true });
  const server = await startServer();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const pages = ["home", "forum", "messages", "notifications", "profile"];
  const viewports = [
    { name: "desktop", width: 1440, height: 1000 },
    { name: "mobile", width: 430, height: 932 }
  ].filter(viewport => !process.argv[2] || viewport.name === process.argv[2]);

  if (!viewports.length) throw new Error("视口参数只能是 desktop 或 mobile");

  try {
    const completed = [];
    for (const viewport of viewports) {
      completed.push(...await Promise.all(pages.map(page => capture(origin, page, viewport))));
    }
    console.log(`UI_CAPTURE_PASS (${completed.length})`);
    completed.forEach(file => console.log(file));
  } finally {
    await new Promise(resolveClose => {
      server.close(resolveClose);
      server.closeAllConnections?.();
    });
  }
}

main().catch(error => {
  console.error(`UI_CAPTURE_FAILED: ${error.stack || error.message || String(error)}`);
  process.exitCode = 1;
});
