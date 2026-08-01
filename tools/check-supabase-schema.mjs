import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceFiles = ["auth.js", "forum.js", "moderation.js", "admin.js"];
const config = await readFile(resolve(root, "config.js"), "utf8");
const supabaseUrl = config.match(/supabaseUrl:\s*"([^"]+)"/)?.[1];
const publishableKey = config.match(/supabasePublishableKey:\s*"([^"]+)"/)?.[1];

if (!supabaseUrl || !publishableKey) {
  throw new Error("config.js 缺少 Supabase 公开配置");
}

const referenced = new Set();
for (const file of sourceFiles) {
  const source = await readFile(resolve(root, file), "utf8");
  for (const match of source.matchAll(/\.rpc\(\s*["']([^"']+)/g)) referenced.add(match[1]);
}

const names = [...referenced].sort();
const signatures = new Map();
const sqlFiles = (await readdir(root)).filter(file => file.endsWith(".sql"));

function splitParameters(source) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "(") depth += 1;
    else if (source[index] === ")") depth -= 1;
    else if (source[index] === "," && depth === 0) {
      parts.push(source.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(source.slice(start));
  return parts.map(part => part.trim()).filter(Boolean);
}

function valueFor(declaration) {
  const lower = declaration.toLowerCase();
  if (/\b(uuid|text|bigint|integer)\[\]/.test(lower)) return [];
  if (/\buuid\b/.test(lower)) return "00000000-0000-0000-0000-000000000000";
  if (/\b(boolean|bool)\b/.test(lower)) return false;
  if (/\b(bigint|integer|smallint|numeric|real|double precision)\b/.test(lower)) return 0;
  if (/\b(json|jsonb)\b/.test(lower)) return {};
  if (/\b(timestamp|timestamptz|date)\b/.test(lower)) return new Date(0).toISOString();
  return "x";
}

for (const file of sqlFiles) {
  const source = await readFile(resolve(root, file), "utf8");
  const pattern = /create(?:\s+or\s+replace)?\s+function\s+public\.(\w+)\s*\(([\s\S]*?)\)\s*returns\b/gi;
  for (const match of source.matchAll(pattern)) {
    const body = {};
    for (const declaration of splitParameters(match[2])) {
      const tokens = declaration.replace(/\s+/g, " ").split(" ");
      const name = tokens[0].toLowerCase() === "in" ? tokens[1] : tokens[0];
      if (name) body[name] = valueFor(declaration);
    }
    const key = JSON.stringify(body);
    if (!signatures.has(match[1])) signatures.set(match[1], new Map());
    signatures.get(match[1]).set(key, body);
  }
}

async function probe(name) {
  const candidates = [...(signatures.get(name)?.values() || [])];
  if (!candidates.length) return { name, reason: "本地 SQL 中没有函数定义" };
  let lastError;
  for (const body of candidates) {
    let response;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
          method: "POST",
          headers: {
            apikey: publishableKey,
            authorization: `Bearer ${publishableKey}`,
            "content-type": "application/json"
          },
          body: JSON.stringify(body)
        });
        break;
      } catch (error) {
        if (attempt === 2) return { name, reason: `网络请求失败：${error.cause?.code || error.message}` };
        await new Promise(resolveDelay => setTimeout(resolveDelay, 350 * (attempt + 1)));
      }
    }
    const text = await response.text();
    let detail = {};
    try { detail = JSON.parse(text); } catch {}
    if (detail.code !== "PGRST202") return null;
    lastError = { status: response.status, code: detail.code, message: detail.message, parameters: Object.keys(body) };
  }
  return { name, ...lastError };
}

const probeResults = new Array(names.length);
let cursor = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (cursor < names.length) {
    const index = cursor++;
    probeResults[index] = await probe(names[index]);
  }
}));
const failures = probeResults.filter(Boolean);

console.log(JSON.stringify({
  status: failures.length ? "FAIL" : "PASS",
  referenced: names.length,
  localDefinitions: signatures.size,
  failures
}, null, 2));
if (failures.length) process.exitCode = 1;
