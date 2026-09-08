import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

const root = new URL('../', import.meta.url);
const source = await readFile(new URL('script.js', root), 'utf8');
const html = await readFile(new URL('index.html', root), 'utf8');
const updateSource = await readFile(new URL('update-log.js', root), 'utf8');
const cloudPost = { id: 900019, title: '后台刚发布的文章', description: '应出现在首页',
  body: '公开正文', published_at: '2099-01-01T12:00:00+08:00', type: '随笔', tags: [] };

function homepage() {
  const { document } = parseHTML(html);
  const listeners = new Map();
  const timers = [];
  const window = {
    BLOG_CONFIG: {},
    blogContentLinks: { article: p => `article.html?key=post-${p.dbId || p.id}`,
      localId: (p, id) => id, localKey: p => p.permalink },
    blogAuth: { listPublishedPosts: async () => [cloudPost] },
    addEventListener(name, callback) {
      const list = listeners.get(name) || [];
      list.push(callback); listeners.set(name, list);
    }
  };
  const context = { window, document, console, Intl, Date,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    localStorage: { getItem: () => null, setItem() {} },
    requestAnimationFrame() {}, setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {},
    location: { hash: '#home' }, history: { replaceState() {}, pushState() {} }, scrollTo() {}, scrollY: 0
  };
  runInNewContext(updateSource, context);
  runInNewContext(source, context);
  return { window, document, context, timers,
    async emit(name, detail) { await Promise.all((listeners.get(name) || []).map(fn => fn({ detail }))); }
  };
}

const home = homepage();
await home.window.refreshRemotePosts();
assert.equal(home.document.querySelector('#postList h2').textContent, cloudPost.title,
  'a newly published cloud article must be visible first, ahead of older bundled update logs');
assert(home.document.querySelector('#postList h2 a').getAttribute('href').includes('post-900019'),
  'the home card must link to the saved database article');
// Ordinary background reads preserve the reader's page and category.
runInNewContext('filter="更新日志";page=2;render()', home.context);
await home.window.refreshRemotePosts();
assert.equal(runInNewContext('page', home.context), 2);
assert.equal(runInNewContext('filter', home.context), '更新日志');
// The publication callback must reveal the confirmed row even when unchanged.
await home.window.refreshRemotePosts({ revealId: cloudPost.id });
assert.equal(runInNewContext('page', home.context), 1);
assert.equal(runInNewContext('filter', home.context), '全部');
assert.equal(home.document.querySelector('#postList h2').textContent, cloudPost.title);

const newer = { ...cloudPost, id: 900021, title: '另一设备刚发布的文章', published_at: '2099-01-02T00:00:00Z' };
home.window.blogAuth.listPublishedPosts = async () => [cloudPost, newer];
await home.emit('blog-page-change', { page: 'home', previous: 'admin' });
assert.equal(home.document.querySelector('#postList h2').textContent, newer.title,
  'returning home fetches and sorts newly published remote articles');
const visible = home.document.querySelector('#postList').innerHTML;
home.window.blogAuth.listPublishedPosts = async () => { throw Error('offline'); };
await home.window.refreshRemotePosts();
assert.equal(home.document.querySelector('#postList').innerHTML, visible, 'a failed fetch preserves the current feed');
assert(!home.document.querySelector('#postFeedStatus').hidden, 'failed cloud reads explain that the feed is incomplete');
assert(home.document.querySelector('[data-retry-posts]'), 'network failures have a retry action');
home.window.blogAuth.listPublishedPosts = async () => [cloudPost];
await home.emit('online');
assert(home.document.querySelector('#postFeedStatus').hidden, 'reconnecting clears the error after a successful fetch');
assert.equal(home.document.querySelector('#postList h2').textContent, cloudPost.title,
  'articles no longer public disappear from the next successful snapshot');

let finishOld;
home.window.blogAuth.listPublishedPosts = () => new Promise(resolve => { finishOld = resolve; });
const oldRequest = home.window.refreshRemotePosts();
home.window.blogAuth.listPublishedPosts = async () => [newer, cloudPost];
await home.window.refreshRemotePosts();
finishOld([]); await oldRequest;
assert.equal(home.document.querySelector('#postList h2').textContent, newer.title,
  'a late older request cannot remove a newly published article');
const freshDevice = homepage();
await freshDevice.window.refreshRemotePosts();
assert.equal(freshDevice.document.querySelector('#postList h2').textContent, cloudPost.title,
  'new devices need no publisher storage to see the article on home');
console.log('Home feed PASS: chronology, publication reveal, background pagination, home return, offline recovery, stale responses, new devices.');
