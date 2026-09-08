// CNBDG static asset builder.
// Merges and minifies the JS/CSS files referenced by index.html in their
// declared order, then rewrites index.html to point at the bundled output.
//
// Usage:  node tools/build-assets.mjs
// Source files stay untouched; edit them, rebuild, and commit the output.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { prepareContentIndex, buildContentPages } from "./build-content-pages.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const htmlPath = join(root, "index.html");
const html = await readFile(htmlPath, "utf8");
const content = await prepareContentIndex(root, { refresh: process.argv.includes("--refresh-content") });

// Keep the login SDK on the same origin as the app. Cold devices must not
// wait for a third-party CDN before the public reader can even initialize.
const sdk = await build({
  stdin: { contents: 'export * from "@supabase/supabase-js";', resolveDir: root, loader: "js" },
  bundle: true, platform: "browser", format: "iife", globalName: "supabase",
  minify: true, legalComments: "eof", write: false, target: ["es2020"]
});
const sdkSource = sdk.outputFiles[0].text;
const sdkVersion = createHash("sha256").update(sdkSource).digest("hex").slice(0, 12);
await mkdir(join(root, "vendor"), { recursive: true });
await writeFile(join(root, "vendor", "supabase.js"), sdkSource);
await writeFile(join(root, "vendor", "SUPABASE-LICENSE.txt"), await readFile(join(root, "node_modules", "@supabase", "supabase-js", "LICENSE")));

// Source order is load-order sensitive (files talk through window.* globals).
// Keep this list in the same order index.html loads the scripts.
const jsSources = [
  "markdown.js",
  "legacy-posts.js",
  "config.js",
  "auth.js",
  "update-log.js",
  "content-index.js",
  "content-links.js",
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
  "desktop-shell.js",
  "reader.js"
];
const cssSources = ["style.css", "design-system.css", "motion-system.css", "reader.css", "admin-editor.css"];
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

let jsVersion;
let cssVersion;
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
  jsVersion = createHash("sha256").update(out).digest("hex").slice(0, 12);
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
  cssVersion = createHash("sha256").update(out).digest("hex").slice(0, 12);
  await writeFile(join(root, "style.min.css"), out);
  console.log(`style.min.css  ${(out.length / 1024).toFixed(1)} KB (from ${(cssSource.length / 1024).toFixed(1)} KB source)`);
});

// Content hashes also invalidate caches for multiple deployments on one day.
const nextHtml = html
  .replace(/<script src="(?:https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2|vendor\/supabase\.js[^\"]*)"><\/script>/g,
    `<script src="vendor/supabase.js?v=${sdkVersion}"></script>`)
  // Collapse every run of local scripts (anything not on a CDN) into one
  // reference to the bundled output; keep CDN tags untouched.
  .replace(/(?:<script src="(?!https:\/\/|vendor\/)[^"]+\.js[^"]*"><\/script>\s*)+/g,
    `<script src="app.min.js?v=${jsVersion}"></script>`)
  // Same for local stylesheets.
  .replace(/(?:<link rel="stylesheet" href="(?!https:\/\/)[^"]+\.css[^"]*">\s*)+/g,
    `<link rel="stylesheet" href="style.min.css?v=${cssVersion}">`);

await writeFile(htmlPath, nextHtml);
await buildContentPages(root, nextHtml, content);
console.log(`index.html rewritten -> app.min.js (${jsVersion}) + style.min.css (${cssVersion})`);
console.log("Remember to commit the built assets along with source changes.");
