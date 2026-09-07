import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const index = JSON.parse(await readFile(join(root, "content-pages.json"), "utf8"));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const readPage = async file => parseHTML(await readFile(join(root, file), "utf8")).document;

assert(index.version === 1, "content page registry version is invalid");
assert(Object.keys(index.local).length > 0, "no local article pages are registered");
assert(new Set(Object.values(index.local).map(item => item.commentId)).size === Object.keys(index.local).length, "local article comment IDs must be unique");
assert(index.local["independent-content-pages"], "current release article has no permanent link");

const expected = [
  ["article.html", "article", false],
  ["thread.html", "thread", false],
  ...Object.keys(index.local).map(key => [`articles/${key}.html`, "article", true]),
  ...index.articles.map(id => [`articles/post-${id}.html`, "article", true]),
  ...index.threads.map(id => [`threads/${id}.html`, "thread", true])
];

for (const [file, kind, nested] of expected) {
  const document = await readPage(file);
  const targetId = kind === "article" ? "articleDialog" : "threadDialog";
  assert(document.body.dataset.readerKind === kind, `${file}: incorrect reader kind`);
  assert(document.querySelector("#app")?.getAttribute("aria-hidden") === "true", `${file}: app shell is not hidden from assistive technology`);
  assert(document.querySelector(`#${targetId}[data-reader-inline]`)?.tagName === "SECTION", `${file}: content was not converted to an inline reader section`);
  assert(!document.querySelector(`dialog#${targetId}`), `${file}: target content still uses modal semantics`);
  assert(document.querySelector('link[rel="canonical"]')?.href?.startsWith("https://cnbdg.co/"), `${file}: canonical URL is missing`);
  const script = [...document.querySelectorAll("script[src]")].find(node => node.getAttribute("src").includes("app.min.js"));
  const style = [...document.querySelectorAll("link[href]")].find(node => node.getAttribute("href").includes("style.min.css"));
  assert(script?.getAttribute("src").startsWith(nested ? "../" : "./"), `${file}: script path is incorrect`);
  assert(style?.getAttribute("href").startsWith(nested ? "../" : "./"), `${file}: stylesheet path is incorrect`);
}

for (const id of index.articles) {
  const document = await readPage(`articles/post-${id}.html`);
  assert(!document.querySelector("#articleContent")?.textContent.trim(), `articles/post-${id}.html: database body must not be embedded in Git`);
}

const articleFiles = (await readdir(join(root, "articles"))).filter(file => file.endsWith(".html"));
const threadFiles = (await readdir(join(root, "threads"))).filter(file => file.endsWith(".html"));
assert(articleFiles.length >= Object.keys(index.local).length + index.articles.length, "article page generation is incomplete");
assert(threadFiles.length >= index.threads.length, "thread page generation is incomplete");

const joinedShells = await Promise.all(["article.html", "thread.html", ...index.articles.map(id => `articles/post-${id}.html`)].map(file => readFile(join(root, file), "utf8")));
assert(!joinedShells.some(value => /service_role|sb_secret_/i.test(value)), "generated pages contain a privileged database key");

const workflow = await readFile(join(root, ".github", "workflows", "sync-content-pages.yml"), "utf8");
assert(/schedule:[\s\S]*cron:\s*"3-59\/10 \* \* \* \*"/.test(workflow), "automatic content schedule is missing");
assert(/contents:\s*write/.test(workflow) && /pages:\s*write/.test(workflow) && /id-token:\s*write/.test(workflow), "workflow permissions are incomplete");
assert(workflow.includes("npm run build:pages") && workflow.includes("actions/deploy-pages@v4"), "workflow does not build and deploy Pages");
assert(workflow.includes("path: _site") && workflow.includes("touch _site/.nojekyll"), "workflow artifact is not isolated");
assert(!/sb_secret_|service_role/i.test(workflow), "workflow must not contain a privileged database key");

console.log(`Content pages PASS: ${articleFiles.length} articles, ${threadFiles.length} threads, 2 fallbacks, automatic deployment.`);
