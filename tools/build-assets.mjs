// CNBDG static asset builder.
// Merges and minifies the JS/CSS files referenced by index.html in their
// declared order, then rewrites index.html to point at the bundled output.
//
// Usage:  node tools/build-assets.mjs
// Source files stay untouched; edit them, rebuild, and commit the output.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const htmlPath = join(root, "index.html");
const html = await readFile(htmlPath, "utf8");

// Source order is load-order sensitive (files talk through window.* globals).
// Keep this list in the same order index.html loads the scripts.
const jsSources = [
  "markdown.js",
  "legacy-posts.js",
  "config.js",
  "auth.js",
  "update-log.js",
  "script.js",
  "wallpaper.js",
  "forum.js",
  "messaging.js",
  "social.js",
  "moderation.js",
  "admin.js",
  "motion-system.js",
  "interaction.js",
  "mobile-shell.js",
  "desktop-shell.js"
];
const cssSources = ["style.css", "design-system.css", "motion-system.css"];
const localJs = jsSources.map(name => join(root, name));
const localCss = cssSources.map(name => join(root, name));

if (!localJs.length || !localCss.length) {
  console.error("No local assets found; refusing to rewrite index.html");
  process.exit(1);
}

// Concatenate in declared order. Every file is a standalone IIFE that talks to
// siblings via window.* globals, so plain concatenation preserves semantics.
const jsSource = (await Promise.all(localJs.map(file => readFile(file, "utf8")))).join("\n;\n");
const cssSource = (await Promise.all(localCss.map(file => readFile(file, "utf8")))).join("\n");

await build({
  stdin: { contents: jsSource, sourcefile: "app.js", loader: "js" },
  bundle: false,
  format: "iife",
  minify: true,
  legalComments: "none",
  write: false,
  target: ["es2020"]
}).then(async result => {
  const out = result.outputFiles[0].text;
  await writeFile(join(root, "app.min.js"), out);
  console.log(`app.min.js  ${(out.length / 1024).toFixed(1)} KB (from ${(jsSource.length / 1024).toFixed(1)} KB source)`);
});

await build({
  stdin: { contents: cssSource, sourcefile: "app.css", loader: "css" },
  bundle: false,
  minify: true,
  legalComments: "none",
  write: false,
  target: ["es2020"]
}).then(async result => {
  const out = result.outputFiles[0].text;
  await writeFile(join(root, "style.min.css"), out);
  console.log(`style.min.css  ${(out.length / 1024).toFixed(1)} KB (from ${(cssSource.length / 1024).toFixed(1)} KB source)`);
});

// Cache-busting version uses Beijing time (Asia/Shanghai), matching the site's
// own publishing timezone, so a same-day UTC date never collides across days.
const version = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
}).format(new Date()).replace(/-/g, "");
const nextHtml = html
  // Collapse every run of local scripts (anything not on a CDN) into one
  // reference to the bundled output; keep CDN tags untouched.
  .replace(/(?:<script src="(?!https:\/\/)[^"]+\.js[^"]*"><\/script>\s*)+/g,
    `<script src="app.min.js?v=${version}"></script>`)
  // Same for local stylesheets.
  .replace(/(?:<link rel="stylesheet" href="(?!https:\/\/)[^"]+\.css[^"]*">\s*)+/g,
    `<link rel="stylesheet" href="style.min.css?v=${version}">`);

await writeFile(htmlPath, nextHtml);
console.log(`index.html rewritten -> app.min.js + style.min.css (v${version})`);
console.log("Remember to commit the built assets along with source changes.");
