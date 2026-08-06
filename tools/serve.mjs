// Local static dev server for CNBDG.
// Usage: node tools/serve.mjs [port]   (default 8123)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.argv[2] || 8123);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".sql": "text/plain; charset=utf-8"
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const relative = decodeURIComponent(url.pathname === "/" ? "index.html" : url.pathname)
      .replace(/^[/\\]+/, "");
    const target = normalize(join(root, relative));
    if (!target.startsWith(root)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    const body = await readFile(target);
    res.writeHead(200, {
      "content-type": mime[extname(target).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`CNBDG dev server: http://127.0.0.1:${port}/`));
