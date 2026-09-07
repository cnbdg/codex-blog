(() => {
  "use strict";
  const hash = value => {
    let result = 2166136261;
    for (const char of String(value)) { result ^= char.codePointAt(0); result = Math.imul(result, 16777619); }
    return (result >>> 0).toString(36);
  };
  const localKey = post => post.permalink || `log-${String(post.published_at || post.date).replace(/\D/g, "").slice(0, 14)}-${hash(`${post.published_at || post.date}\n${post.title}`)}`;
  const positiveId = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
  const records = () => window.BLOG_CONTENT_INDEX || { local: {}, articles: [], threads: [] };
  function rootUrl() {
    const script = [...document.scripts].find(node => /(?:^|\/)app\.min\.js(?:\?|$)/.test(node.src));
    return new URL("./", script?.src || new URL("./", location.href));
  }
  function article(post) {
    if (post.dbId && positiveId(post.dbId)) return articleByKey(`post-${post.dbId}`);
    return articleByKey(post.key || localKey(post));
  }
  function articleByKey(key) {
    const remoteId = /^post-(\d+)$/.exec(key)?.[1];
    const built = remoteId ? records().articles.includes(Number(remoteId)) : Boolean(records().local[key]);
    return new URL(built ? `articles/${key}.html` : `article.html?key=${encodeURIComponent(key)}`, rootUrl()).href;
  }
  function thread(id) {
    if (!positiveId(id)) return new URL("#forum", rootUrl()).href;
    return new URL(records().threads.includes(Number(id)) ? `threads/${Number(id)}.html` : `thread.html?id=${Number(id)}`, rootUrl()).href;
  }
  const localId = (post, fallback) => records().local[localKey(post)]?.commentId ?? fallback;
  window.blogContentLinks = { localKey, localId, article, articleByKey, thread, rootUrl, positiveId, hash };
})();
