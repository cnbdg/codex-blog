import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const source = await readFile(new URL('auth.js', root), 'utf8');
const row = { id: 19, title: '跨设备发布测试', body: '其他设备也应该读取到云端正文', status: 'published' };
function device({ sdk = true, response = [row], status = 200, hung = false } = {}) {
  const requests = [];
  const locked = { select() { return this; }, eq() { return this; }, order() { return this; }, maybeSingle() { return new Promise(() => {}); }, then() {} };
  const window = {
    BLOG_CONFIG: { supabaseUrl: 'https://public-read.test', supabasePublishableKey: 'sb_publishable_test' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    ...(sdk ? { supabase: { createClient: () => ({ from: () => locked }) } } : {})
  };
  const context = {
    window, document: { addEventListener() {} }, URL, URLSearchParams, AbortController,
    setTimeout: (callback, ms) => setTimeout(callback, ms === 12000 ? 25 : ms), clearTimeout, console,
    fetch: async (url, options) => {
      requests.push({ url: String(url), ...options });
      if (hung) return new Promise(() => {});
      return { ok: status >= 200 && status < 300, status, json: async () => response };
    }
  };
  runInNewContext(source, context);
  return { api: window.blogAuth, requests };
}
async function promptly(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('公开文章仍在等待登录会话，其他设备一直加载')), 500); })]); }
  finally { clearTimeout(timer); }
}

const fresh = device();
const result = await promptly(fresh.api.getPublishedPost(19));
assert.equal(result.row?.body, row.body, 'fresh device must read the published cloud body');
const noSdk = device({ sdk: false });
assert.equal((await promptly(noSdk.api.getPublishedPost(19))).row?.id, 19, 'public reading must not require the login SDK');
const list = await promptly(fresh.api.listPublishedPosts());
assert.equal(list?.[0]?.id, 19, 'feed must also read without waiting for auth');
for (const request of [...fresh.requests, ...noSdk.requests]) {
  const url = new URL(request.url);
  assert.equal(url.searchParams.get('status'), 'eq.published', 'never request drafts through the public reader');
  assert.equal(request.credentials, 'omit', 'public reads never send device cookies');
  assert(!Object.keys(request.headers).some(key => key.toLowerCase() === 'authorization'), 'public reads must not use the publisher session');
}
const denied = device({ status: 403, response: { message: 'permission denied' } });
const blocked = await promptly(denied.api.getPublishedPost(19));
assert(!blocked.row && blocked.error, 'permission errors must be explicit, not infinite loading');
const deleted = device({ response: [] });
assert.equal((await promptly(deleted.api.getPublishedPost(19))).row, null, 'deleted or unpublished content must not be served from device cache');
const offline = device({ hung: true });
const timeout = await promptly(offline.api.getPublishedPost(19));
assert(!timeout.row && timeout.error.includes('超时'), 'even an unresponsive fetch must yield a retryable timeout');
assert(offline.requests[0].signal.aborted, 'timed-out network request is aborted');
console.log('Public article reads PASS: fresh device, missing SDK, blocked auth, denied access, unpublished content, request timeout.');
