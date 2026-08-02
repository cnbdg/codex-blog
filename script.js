const seedPosts=[{title:"社区更新：图片上传与桌面布局优化",description:"本次更新增加社区图片上传、优化桌面三栏布局，并持续完善社区互动体验。",type:"更新日志",tags:["更新","社区","功能"],read_time:"1 分钟",lead:"感谢大家使用 cnbdg 博客。本次更新重点改善社区发布和桌面端浏览体验。",body:"## 本次更新\n\n- 社区发帖支持上传图片。\n- 桌面端右侧区域重新规划。\n- 统一窗口、按钮和内容卡片风格。\n- 持续修复移动端体验。",status:"published",published_at:"2026-07-31"}];
const localUpdatePosts=()=>Array.from(window.LOCAL_UPDATE_POSTS||[],(post,index)=>({...post,id:9000000+index,desc:post.description,date:post.published_at,read:post.read_time}));
let posts=localUpdatePosts();if(!posts.length)posts=[...seedPosts];
let filter="全部",page=1;const perPage=4,$=s=>document.querySelector(s);
const reduceMotion=matchMedia("(prefers-reduced-motion: reduce)");
const compactPagination=matchMedia("(max-width: 520px)");
const postTimeFormatter=new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});

function normalizePostTimestamp(value){
 const text=String(value||"").trim();
 if(/^\d{4}-\d{2}-\d{2}$/.test(text))return `${text}T00:00:00+08:00`;
 if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(text))return `${text.length===16?text+":00":text}+08:00`;
 return text;
}
function postDate(value){return new Date(normalizePostTimestamp(value))}
function postTimeParts(value){
 const date=postDate(value);if(Number.isNaN(date.getTime()))return null;
 return Object.fromEntries(postTimeFormatter.formatToParts(date).filter(part=>part.type!=="literal").map(part=>[part.type,part.value]));
}
function formatPostTime(value){
 const parts=postTimeParts(value);if(!parts)return String(value||"未知时间");
 return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
function postTimeAttribute(value){const date=postDate(value);return Number.isNaN(date.getTime())?"":date.toISOString()}
function postTimeEditorValue(value=new Date()){
 const parts=postTimeParts(value);return parts?`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`:"";
}
window.blogPostTime={format:formatPostTime,toAttribute:postTimeAttribute,toEditor:postTimeEditorValue,toStorage:normalizePostTimestamp};

function paginationTokens(current,total,compact=compactPagination.matches){
 if(total<=1)return [];
 const directLimit=compact?5:7;
 if(total<=directLimit)return Array.from({length:total},(_,index)=>index+1);
 const radius=compact?0:1,keep=new Set([1,total,current]);
 for(let offset=1;offset<=radius;offset++){keep.add(current-offset);keep.add(current+offset)}
 if(compact&&current<=2)keep.add(2);
 if(compact&&current>=total-1)keep.add(total-1);
 const numbers=[...keep].filter(number=>number>=1&&number<=total).sort((a,b)=>a-b),tokens=[];
 numbers.forEach((number,index)=>{if(index&&number-numbers[index-1]>1)tokens.push("ellipsis");tokens.push(number)});
 return tokens;
}

function renderPagination(totalItems){
 const target=$("#pagination"),totalPages=Math.ceil(totalItems/perPage);
 page=Math.max(1,Math.min(page,totalPages||1));
 target.hidden=totalPages<=1;
 target.setAttribute("aria-label",`博客文章分页，共 ${totalPages} 页`);
 if(totalPages<=1){target.innerHTML="";return}
 let ellipsisIndex=0;
 const numbers=paginationTokens(page,totalPages).map(token=>token==="ellipsis"
  ?`<span class="pagination-ellipsis" aria-hidden="true" data-ellipsis="${++ellipsisIndex}">…</span>`
  :`<button type="button" class="pagination-page${token===page?" active":""}" data-page-num="${token}" aria-label="第 ${token} 页"${token===page?' aria-current="page"':''}>${token}</button>`).join("");
 target.innerHTML=`<div class="pagination-track"><button type="button" class="pagination-nav pagination-prev" data-page-num="${Math.max(1,page-1)}" aria-label="上一页"${page===1?" disabled":""}><span aria-hidden="true">←</span><span class="pagination-nav-label">上一页</span></button><div class="pagination-pages">${numbers}</div><button type="button" class="pagination-nav pagination-next" data-page-num="${Math.min(totalPages,page+1)}" aria-label="下一页"${page===totalPages?" disabled":""}><span class="pagination-nav-label">下一页</span><span aria-hidden="true">→</span></button></div><span class="pagination-summary" aria-live="polite">第 <b>${page}</b> / ${totalPages} 页 · 共 ${totalItems} 篇</span>`;
}

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
 if(window.blogMotion?.closeDialog)return window.blogMotion.closeDialog(dialog);
 if(dialog.classList.contains("dialog-closing"))return;
 if(reduceMotion.matches){dialog.close();return}
 dialog.classList.add("dialog-closing");
 let closed=false;
 const finish=()=>{if(closed)return;closed=true;dialog.removeEventListener("animationend",onEnd);dialog.classList.remove("dialog-closing");dialog.close()};
 const onEnd=event=>{if(event.target===dialog&&!event.pseudoElement)finish()};
 dialog.addEventListener("animationend",onEnd);
 setTimeout(finish,260);
}
window.closeDialog=closeDialogAnimated;
function openDialogManaged(dialog){
 if(!dialog)return false;
 if(window.blogUI?.openDialog)return window.blogUI.openDialog(dialog);
 if(dialog.open)return true;
 dialog.showModal();return true;
}
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
 const list=filtered(),totalPages=Math.ceil(list.length/perPage);page=Math.max(1,Math.min(page,totalPages||1));const start=(page-1)*perPage;
 $("#postList").innerHTML=list.slice(start,start+perPage).map(p=>`<article class="post-item" data-id="${p.id}" tabindex="0"><div class="post-top"><span class="type">${esc(p.type)}</span><span>·</span><span>${esc(p.read)}</span></div><h2><a>${esc(p.title)}</a></h2><p>${esc(p.desc)}</p><div class="post-bottom"><div class="tags">${(p.tags||[]).map(t=>`<span>#${esc(t)}</span>`).join("")}</div><time datetime="${esc(postTimeAttribute(p.date))}" title="北京时间">${esc(formatPostTime(p.date))}</time></div></article>`).join("")||`<article class="empty-post"><span>✦</span><h2>新的内容正在整理中</h2><p>这里不再展示模板示例文章。你可以先去<a href="https://xsf.indevs.in/" target="_blank" rel="noopener">旧博客</a>看看以前的记录。</p></article>`;
 renderPagination(list.length);
 gridAnimate();
}
function gridAnimate(){if(reduceMotion.matches)return;$("#postList").classList.remove("is-refreshing");requestAnimationFrame(()=>$("#postList").classList.add("is-refreshing"))}
render();
async function refreshRemotePosts(){
 const localLogs=localUpdatePosts();
 if(!window.blogAuth?.listPublishedPosts){posts=localLogs.length?localLogs:[...seedPosts];page=1;render();return}
 const rows=await window.blogAuth.listPublishedPosts();
 if(rows===null){posts=localLogs.length?localLogs:[...seedPosts];page=1;render();return}
 const remote=rows.map(p=>({id:1000000+Number(p.id),dbId:p.id,title:p.title,desc:p.description,date:p.published_at,type:p.type,tags:p.tags||[],read:p.read_time||"5 分钟",lead:p.lead,body:p.body}));
 posts=[...localLogs,...remote];page=1;render();
}
window.refreshRemotePosts=refreshRemotePosts;
window.addEventListener("blog-auth-change",refreshRemotePosts);
setTimeout(refreshRemotePosts,0);
document.addEventListener("click",e=>{
 const nav=e.target.closest("[data-page]");if(nav&&!e.defaultPrevented){e.preventDefault();showPage(nav.dataset.page,true)}
 const post=e.target.closest(".post-item,.search-result");if(post?.dataset.id)openArticle(Number(post.dataset.id));
 const close=e.target.closest("[data-close]");if(close)closeDialogAnimated(document.getElementById(close.dataset.close));
 const p=e.target.closest("[data-page-num]");if(p&&!p.disabled){const nextPage=Number(p.dataset.pageNum);if(nextPage===page)return;page=nextPage;render();const top=Math.max(0,$("#postList").getBoundingClientRect().top+scrollY-(document.querySelector(".topbar")?.offsetHeight||0)-16);scrollTo({top,behavior:reduceMotion.matches?"auto":"smooth"});requestAnimationFrame(()=>$("#pagination .pagination-page[aria-current=page]")?.focus({preventScroll:true}))}
});
compactPagination.addEventListener?.("change",()=>renderPagination(filtered().length));
document.addEventListener("keydown",e=>{if(e.key==="Enter"&&e.target.matches(".post-item"))openArticle(Number(e.target.dataset.id))});
function closeMenu(){if(window.blogMobileShell?.setDrawer&&matchMedia("(max-width:1023px)").matches){window.blogMobileShell.setDrawer(false);return}document.querySelector("nav").classList.remove("open");document.body.classList.remove("nav-open");$("#menuBtn").textContent="☰";$("#menuBtn").setAttribute("aria-expanded","false")}
function showPage(id,push=false){
 if(window.blogUI?.navigate)return window.blogUI.navigate(id,{history:push});
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
document.querySelector(".tag-cloud").onclick=e=>{const b=e.target.closest("[data-tag]");if(!b)return;filter=b.dataset.tag;page=1;document.querySelectorAll("#filters button").forEach(x=>x.classList.remove("active"));render();scrollTo({top:280,behavior:reduceMotion.matches?"auto":"smooth"})};
$("#menuBtn").setAttribute("aria-expanded","false");$("#menuBtn").onclick=()=>{const open=!document.querySelector("nav").classList.contains("open");document.querySelector("nav").classList.toggle("open",open);document.body.classList.toggle("nav-open",open);$("#menuBtn").textContent=open?"×":"☰";$("#menuBtn").setAttribute("aria-expanded",String(open))};$("#navBackdrop").onclick=closeMenu;
let navTouchX=0;document.addEventListener("touchstart",e=>{navTouchX=e.touches[0]?.clientX||0},{passive:true});document.addEventListener("touchend",e=>{const end=e.changedTouches[0]?.clientX||0;if(navTouchX<24&&end-navTouchX>70){if(window.blogMobileShell?.setDrawer)window.blogMobileShell.setDrawer(true);else{document.querySelector("nav")?.classList.add("open");document.body.classList.add("nav-open");$("#menuBtn").textContent="×"}}else if(document.querySelector("nav")?.classList.contains("open")&&navTouchX<330&&navTouchX-end>70)closeMenu()},{passive:true});
const setTheme=d=>{document.body.classList.toggle("dark",d);document.querySelector('meta[name="theme-color"]').content=d?"#080b0e":"#f4f7fa";localStorage.setItem("yu-theme",d?"dark":"light")};setTheme(localStorage.getItem("yu-theme")==="dark"||(!localStorage.getItem("yu-theme")&&matchMedia("(prefers-color-scheme:dark)").matches));$("#themeBtn").onclick=e=>animateThemeChange(!document.body.classList.contains("dark"),e);
$("#searchBtn").onclick=()=>{openDialogManaged($("#searchDialog"));$("#searchInput").value="";search("");setTimeout(()=>$("#searchInput").focus(),50)};$("#searchInput").oninput=e=>search(e.target.value);
async function search(q){let l=q?posts.filter(p=>(p.title+p.desc+p.tags).toLowerCase().includes(q.toLowerCase())):posts.slice(0,4);$("#searchResults").innerHTML=l.map(p=>`<div class="search-result" data-id="${p.id}"><small>${esc(formatPostTime(p.date))} · ${p.tags.map(esc).join(" / ")}</small><div>${esc(p.title)}</div></div>`).join("")||`<p class="search-hint">${posts.length?"没有找到相关文章":"暂时还没有发布文章"}</p>`;const users=q?await window.blogAuth?.searchUsers?.(q):[];$("#userSearchResults").innerHTML=users?.length?`<div class="user-search-heading">社区用户</div>`+users.map(user=>`<div class="user-search-item"><div><strong>${esc(user.username)}</strong><span>UID ${esc(user.user_uid)} · ${esc(user.display_title||"社区成员")}</span></div><div><button type="button" class="follow-button" data-follow-user="${esc(user.id)}">关注</button><button type="button" class="chat-button" data-chat-user="${esc(user.id)}" data-chat-name="${esc(user.username)}">私聊</button></div></div>`).join(""):q?`<p class="search-hint">没有找到用户</p>`:"";document.querySelectorAll("#userSearchResults [data-follow-user]").forEach(button=>window.hydrateFollowButton?.(button))}
window.onscroll=()=>$("#toTop").classList.toggle("show",scrollY>500);$("#toTop").onclick=()=>scrollTo({top:0,behavior:reduceMotion.matches?"auto":"smooth"});
let currentPost;
function openArticle(id){currentPost=posts.find(p=>p.id===id);if(!currentPost)return;window.currentPost=currentPost;const body=window.blogMarkdown?window.blogMarkdown.render(currentPost.body):esc(currentPost.body);$("#articleContent").innerHTML=`<div class="article-body"><div class="article-meta">${esc(currentPost.type)} · <time datetime="${esc(postTimeAttribute(currentPost.date))}">${esc(formatPostTime(currentPost.date))}</time> · ${esc(currentPost.read)}</div><h1>${esc(currentPost.title)}</h1><p class="lead">${esc(currentPost.lead)}</p><div class="article-text">${body}<p>感谢你读到这里。如果这篇文章对你有帮助，欢迎在评论区留下想法。</p></div></div>`;openDialogManaged($("#articleDialog"));$("#articleDialog").scrollTop=0;renderComments()}
function getComments(){return JSON.parse(localStorage.getItem(`yu-comments-${currentPost.id}`)||"null")||[]}function saveComments(v){localStorage.setItem(`yu-comments-${currentPost.id}`,JSON.stringify(v))}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
async function renderComments(){let l;if(window.blogAuth?.configured){$("#commentList").innerHTML=`<p class="search-hint">正在加载评论…</p>`;l=await window.blogAuth.listComments(currentPost.id)}else{l=getComments()}$("#commentCount").textContent=l.length;$("#commentList").innerHTML=l.length?l.map(c=>`<article class="comment"><div class="avatar">${esc(c.name[0].toUpperCase())}</div><div><div class="comment-head"><strong>${esc(c.name)}</strong><time>${c.time}</time></div><p>${esc(c.text)}</p><button class="like-btn" data-like="${c.id}" data-likes="${c.likes||0}">♡ ${c.likes||0}</button>${c.own?`<button class="comment-delete" data-delete="${c.id}">删除</button>`:""}<button class="comment-report" data-report-type="blog_comment" data-report-id="${c.id}">举报</button></div></article>`).join(""):`<p class="search-hint">还没有评论，来留下第一条吧。</p>`}
window.renderComments=renderComments;
$("#commentForm textarea").oninput=e=>$("#charCount").textContent=e.target.value.length;
$("#commentForm").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),content=f.get("content").trim();if(window.blogAuth?.configured){const ok=await window.blogAuth.addComment(currentPost.id,content);if(!ok)return}else{const l=getComments();l.unshift({id:Date.now(),name:"本地访客",text:content,time:new Date().toLocaleString("zh-CN",{hour12:false}),likes:0});saveComments(l)}e.target.reset();$("#charCount").textContent=0;await renderComments();toast("评论发表成功")};
$("#commentList").onclick=async e=>{const like=e.target.closest("[data-like]"),del=e.target.closest("[data-delete]");if(del){if(window.blogAuth?.configured&&await window.blogAuth.deleteComment(Number(del.dataset.delete))){await renderComments();toast("评论已删除")}return}if(!like)return;if(window.blogAuth?.configured){if(await window.blogAuth.likeComment(Number(like.dataset.like),Number(like.dataset.likes)))await renderComments()}else{const l=getComments(),c=l.find(x=>x.id===Number(like.dataset.like));c.likes++;saveComments(l);renderComments()}};
function toast(t){const target=$("#toast");target.textContent=t;target.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>target.classList.remove("show"),1800)}window.toast=toast;
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeMenu()});
window.addEventListener("popstate",()=>{if(!window.blogUI?.navigate)showPage(location.hash.slice(1)||"home")});
if(location.hash&&document.querySelector(location.hash+".page"))showPage(location.hash.slice(1));else history.replaceState({page:"home"},"","#home");
requestAnimationFrame(()=>document.body.classList.add("motion-ready"));
