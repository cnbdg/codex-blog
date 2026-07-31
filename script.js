const seedPosts=[];
let posts=[...seedPosts];
let filter="全部",page=1;const perPage=4,$=s=>document.querySelector(s);
const reduceMotion=matchMedia("(prefers-reduced-motion: reduce)");

function setBlogWallpaper(url=""){
 const clean=String(url||"").trim();
 document.body.classList.toggle("has-wallpaper",Boolean(clean));
 if(clean)document.documentElement.style.setProperty("--wallpaper",`url("${clean.replace(/["\\\n\r]/g,"")}")`);
 else document.documentElement.style.removeProperty("--wallpaper");
}
window.setBlogWallpaper=setBlogWallpaper;
setBlogWallpaper(window.BLOG_CONFIG?.backgroundImageUrl);

function closeDialogAnimated(dialog){
 if(!dialog?.open)return;
 if(dialog.classList.contains("dialog-closing"))return;
 if(reduceMotion.matches){dialog.close();return}
 dialog.classList.add("dialog-closing");
 let closed=false;
 const finish=()=>{if(closed)return;closed=true;dialog.removeEventListener("animationend",onEnd);dialog.classList.remove("dialog-closing");dialog.close()};
 const onEnd=event=>{if(event.target===dialog)finish()};
 dialog.addEventListener("animationend",onEnd);
 setTimeout(finish,260);
}
window.closeDialog=closeDialogAnimated;
document.querySelectorAll("dialog").forEach(dialog=>{
 dialog.addEventListener("cancel",event=>{event.preventDefault();closeDialogAnimated(dialog)});
 if(dialog.id!=="authDialog")dialog.addEventListener("click",event=>{if(event.target===dialog)closeDialogAnimated(dialog)});
});

function animateThemeChange(dark,event){
 document.body.classList.add("theme-switching");
 setTheme(dark);
 clearTimeout(animateThemeChange.timer);
 animateThemeChange.timer=setTimeout(()=>document.body.classList.remove("theme-switching"),240);
}
function syncBlogMeta(){
 const tags=[...new Set(posts.flatMap(post=>post.tags||[]))];
 const types=[...new Set(posts.map(post=>post.type).filter(Boolean))];
 const choices=[...types,...tags];
 if(filter!=="全部"&&!choices.includes(filter))filter="全部";
 $("#postStat").textContent=posts.length;
 $("#tagStat").textContent=tags.length;
 $("#filters").innerHTML=["全部",...types.slice(0,3)].map(item=>`<button class="${filter===item?"active":""}" data-filter="${esc(item)}">${esc(item)}</button>`).join("");
 document.querySelector(".tag-cloud").innerHTML=tags.length
  ?tags.slice(0,10).map(tag=>`<button data-tag="${esc(tag)}"># ${esc(tag)}</button>`).join("")
  :`<span class="tag-empty">发布文章后会显示在这里</span>`;
}
function filtered(){return posts.filter(p=>filter==="全部"||p.type===filter||p.tags.includes(filter))}
function render(){
 syncBlogMeta();
 const list=filtered(),start=(page-1)*perPage;
 $("#postList").innerHTML=list.slice(start,start+perPage).map(p=>`<article class="post-item" data-id="${p.id}" tabindex="0"><div class="post-top"><span class="type">${esc(p.type)}</span><span>·</span><span>${esc(p.read)}</span></div><h2><a>${esc(p.title)}</a></h2><p>${esc(p.desc)}</p><div class="post-bottom"><div class="tags">${p.tags.map(t=>`<span>#${esc(t)}</span>`).join("")}</div><time>${esc(p.date)}</time></div></article>`).join("")||`<article class="empty-post"><span>✦</span><h2>新的内容正在整理中</h2><p>这里不再展示模板示例文章。你可以先去<a href="https://xsf.indevs.in/" target="_blank" rel="noopener">旧博客</a>看看以前的记录。</p></article>`;
 const pages=Math.ceil(list.length/perPage);$("#pagination").innerHTML=pages>1?Array.from({length:pages},(_,i)=>`<button class="${page===i+1?"active":""}" data-page-num="${i+1}">${i+1}</button>`).join(""):"";
 gridAnimate();
}
function gridAnimate(){if(reduceMotion.matches)return;$("#postList").classList.remove("is-refreshing");requestAnimationFrame(()=>$("#postList").classList.add("is-refreshing"))}
render();
async function refreshRemotePosts(){
 if(!window.blogAuth?.listPublishedPosts)return;
 const rows=await window.blogAuth.listPublishedPosts();
 if(rows===null)return;
 const remote=rows.map(p=>({id:1000000+Number(p.id),dbId:p.id,title:p.title,desc:p.description,date:p.published_at,type:p.type,tags:p.tags||[],read:p.read_time||"5 分钟",lead:p.lead,body:p.body}));
 posts=remote;page=1;render();
}
window.refreshRemotePosts=refreshRemotePosts;
window.addEventListener("blog-auth-change",refreshRemotePosts);
setTimeout(refreshRemotePosts,0);
document.addEventListener("click",e=>{
 const nav=e.target.closest("[data-page]");if(nav){e.preventDefault();showPage(nav.dataset.page,true)}
 const post=e.target.closest(".post-item,.search-result");if(post?.dataset.id)openArticle(Number(post.dataset.id));
 const close=e.target.closest("[data-close]");if(close)closeDialogAnimated(document.getElementById(close.dataset.close));
 const p=e.target.closest("[data-page-num]");if(p){page=Number(p.dataset.pageNum);render();scrollTo({top:250,behavior:"smooth"})}
});
document.addEventListener("keydown",e=>{if(e.key==="Enter"&&e.target.matches(".post-item"))openArticle(Number(e.target.dataset.id))});
function closeMenu(){document.querySelector("nav").classList.remove("open");document.body.classList.remove("nav-open");$("#menuBtn").textContent="☰";$("#menuBtn").setAttribute("aria-expanded","false")}
function showPage(id,push=false){
 const target=document.getElementById(id);
 if(!target?.classList.contains("page"))return;
 const current=document.querySelector(".page.active");
 closeMenu();
 if(current===target)return;
 const update=()=>{
  document.querySelectorAll(".page").forEach(x=>x.classList.toggle("active",x===target));
  document.querySelectorAll("nav a").forEach(x=>x.classList.toggle("active",x.dataset.page===id));
 };
 update();
 if(push)history.pushState({page:id},"","#"+id);else history.replaceState({page:id},"","#"+id);
 scrollTo({top:0,behavior:"auto"});
}
window.showPage=showPage;
$("#filters").onclick=e=>{const b=e.target.closest("[data-filter]");if(!b)return;filter=b.dataset.filter;page=1;$("#filters .active").classList.remove("active");b.classList.add("active");render()};
document.querySelector(".tag-cloud").onclick=e=>{const b=e.target.closest("[data-tag]");if(!b)return;filter=b.dataset.tag;page=1;document.querySelectorAll("#filters button").forEach(x=>x.classList.remove("active"));render();scrollTo({top:280,behavior:"smooth"})};
$("#menuBtn").setAttribute("aria-expanded","false");$("#menuBtn").onclick=()=>{const open=!document.querySelector("nav").classList.contains("open");document.querySelector("nav").classList.toggle("open",open);document.body.classList.toggle("nav-open",open);$("#menuBtn").textContent=open?"×":"☰";$("#menuBtn").setAttribute("aria-expanded",String(open))};$("#navBackdrop").onclick=closeMenu;
const setTheme=d=>{document.body.classList.toggle("dark",d);document.querySelector('meta[name="theme-color"]').content=d?"#131517":"#f7f8fa";localStorage.setItem("yu-theme",d?"dark":"light")};setTheme(localStorage.getItem("yu-theme")==="dark"||(!localStorage.getItem("yu-theme")&&matchMedia("(prefers-color-scheme:dark)").matches));$("#themeBtn").onclick=e=>animateThemeChange(!document.body.classList.contains("dark"),e);
$("#searchBtn").onclick=()=>{$("#searchDialog").showModal();$("#searchInput").value="";search("");setTimeout(()=>$("#searchInput").focus(),50)};$("#searchInput").oninput=e=>search(e.target.value);
function search(q){let l=q?posts.filter(p=>(p.title+p.desc+p.tags).toLowerCase().includes(q.toLowerCase())):posts.slice(0,4);$("#searchResults").innerHTML=l.map(p=>`<div class="search-result" data-id="${p.id}"><small>${esc(p.date)} · ${p.tags.map(esc).join(" / ")}</small><div>${esc(p.title)}</div></div>`).join("")||`<p class="search-hint">${posts.length?"没有找到相关文章":"暂时还没有发布文章"}</p>`}
window.onscroll=()=>$("#toTop").classList.toggle("show",scrollY>500);$("#toTop").onclick=()=>scrollTo({top:0,behavior:"smooth"});
let currentPost;
function openArticle(id){currentPost=posts.find(p=>p.id===id);if(!currentPost)return;window.currentPost=currentPost;const body=window.blogMarkdown?window.blogMarkdown.render(currentPost.body):esc(currentPost.body);$("#articleContent").innerHTML=`<div class="article-body"><div class="article-meta">${esc(currentPost.type)} · ${esc(currentPost.date)} · ${esc(currentPost.read)}</div><h1>${esc(currentPost.title)}</h1><p class="lead">${esc(currentPost.lead)}</p><div class="article-text">${body}<p>感谢你读到这里。如果这篇文章对你有帮助，欢迎在评论区留下想法。</p></div></div>`;if($("#searchDialog").open)$("#searchDialog").close();$("#articleDialog").showModal();$("#articleDialog").scrollTop=0;renderComments()}
function getComments(){return JSON.parse(localStorage.getItem(`yu-comments-${currentPost.id}`)||"null")||[]}function saveComments(v){localStorage.setItem(`yu-comments-${currentPost.id}`,JSON.stringify(v))}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
async function renderComments(){let l;if(window.blogAuth?.configured){$("#commentList").innerHTML=`<p class="search-hint">正在加载评论…</p>`;l=await window.blogAuth.listComments(currentPost.id)}else{l=getComments()}$("#commentCount").textContent=l.length;$("#commentList").innerHTML=l.length?l.map(c=>`<article class="comment"><div class="avatar">${esc(c.name[0].toUpperCase())}</div><div><div class="comment-head"><strong>${esc(c.name)}</strong><time>${c.time}</time></div><p>${esc(c.text)}</p><button class="like-btn" data-like="${c.id}" data-likes="${c.likes||0}">♡ ${c.likes||0}</button>${c.own?`<button class="comment-delete" data-delete="${c.id}">删除</button>`:""}</div></article>`).join(""):`<p class="search-hint">还没有评论，来留下第一条吧。</p>`}
window.renderComments=renderComments;
$("#commentForm textarea").oninput=e=>$("#charCount").textContent=e.target.value.length;
$("#commentForm").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),content=f.get("content").trim();if(window.blogAuth?.configured){const ok=await window.blogAuth.addComment(currentPost.id,content);if(!ok)return}else{const l=getComments();l.unshift({id:Date.now(),name:"本地访客",text:content,time:new Date().toLocaleString("zh-CN",{hour12:false}),likes:0});saveComments(l)}e.target.reset();$("#charCount").textContent=0;await renderComments();toast("评论发表成功")};
$("#commentList").onclick=async e=>{const like=e.target.closest("[data-like]"),del=e.target.closest("[data-delete]");if(del){if(window.blogAuth?.configured&&await window.blogAuth.deleteComment(Number(del.dataset.delete))){await renderComments();toast("评论已删除")}return}if(!like)return;if(window.blogAuth?.configured){if(await window.blogAuth.likeComment(Number(like.dataset.like),Number(like.dataset.likes)))await renderComments()}else{const l=getComments(),c=l.find(x=>x.id===Number(like.dataset.like));c.likes++;saveComments(l);renderComments()}};
function toast(t){$("#toast").textContent=t;$("#toast").classList.add("show");setTimeout(()=>$("#toast").classList.remove("show"),1800)}window.toast=toast;
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeMenu()});
window.addEventListener("popstate",()=>showPage(location.hash.slice(1)||"home"));
if(location.hash&&document.querySelector(location.hash+".page"))showPage(location.hash.slice(1));else history.replaceState({page:"home"},"","#home");
requestAnimationFrame(()=>document.body.classList.add("motion-ready"));
