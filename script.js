const seedPosts=[
{id:1,title:"在旧笔记本上搭建一台安静的家庭服务器",desc:"把闲置的 ThinkPad 变成低功耗 Homelab：从系统选择、磁盘规划到容器服务的完整记录。",date:"2026-07-26",type:"折腾记录",tags:["技术","Linux","Homelab"],read:"10 分钟",lead:"一台被遗忘在抽屉里的旧电脑，也可以成为数字生活里最可靠的角落。",body:`家里的旧笔记本已经闲置很久。它性能不强，但低功耗、自带 UPS，还有一块状态不错的固态硬盘——几乎是天然的家庭服务器。<h2>选择一个稳定的底座</h2>我最终选择 Debian。它不追逐最新版本，却足够可靠，社区资料也很完整。安装完成后，第一件事是配置固定地址与 SSH。<div class="code">sudo apt update<br>sudo apt install docker.io docker-compose-plugin<br>sudo systemctl enable --now docker</div><h2>服务要少而精</h2>现在它运行文件同步、RSS 阅读器和状态监控。比起塞进所有服务，我更关心每个服务是否真的会长期使用。`},
{id:2,title:"用 CSS 做一个有呼吸感的深色模式",desc:"深色模式并非简单地把白色换成黑色。记录一套更自然的颜色与层级处理方法。",date:"2026-07-19",type:"简单教程",tags:["教程","前端","CSS"],read:"7 分钟",lead:"舒服的深色界面不是更暗，而是光线关系更准确。",body:`深色模式最常见的问题，是使用纯黑背景配纯白文字。过高的对比度会让眼睛更快疲劳，也会让界面显得生硬。<h2>从表面层级开始</h2>我习惯先定义三个表面：页面背景、内容卡片和浮层。它们的亮度只需要有细微差异。<div class="code">--bg: #131517;<br>--surface: #1c1f22;<br>--text: #e9ebed;</div><h2>别忘记系统偏好</h2>第一次访问时读取 prefers-color-scheme，之后再记住用户的主动选择。`},
{id:3,title:"我的 2026 开源软件日用清单",desc:"浏览器、笔记、密码管理与影音工具：那些真正留在电脑里的开源应用。",date:"2026-07-08",type:"软件推荐",tags:["开源","日常","Linux"],read:"8 分钟",lead:"软件不需要很多，重要的是它们可靠、透明，并且尊重使用者。",body:`我每年都会整理一次正在使用的软件。标准很简单：足够稳定、数据可迁移、没有强迫性的订阅。<h2>写作与知识管理</h2>纯文本仍然是最可靠的格式。编辑器可以改变，文件永远属于自己。<h2>选择软件也是选择价值观</h2>开源不天然等于好用，但可审查、可修改和可迁移，让用户始终保有最后的决定权。`},
{id:4,title:"从零部署一个静态博客：域名、HTTPS 与自动发布",desc:"面向第一次建站的完整流程，不需要复杂的服务器运维经验。",date:"2026-06-22",type:"简单教程",tags:["教程","前端","博客"],read:"12 分钟",lead:"拥有一块独立的网络空间，仍然是一件很浪漫的事。",body:`静态博客不依赖数据库，成本低、速度快，也更容易长期保存。你只需要一个域名和可以托管文件的平台。<h2>建立发布流程</h2>每次推送代码后自动构建与部署，能显著减少写作之外的摩擦。<div class="code">git add .<br>git commit -m "new post"<br>git push</div><h2>内容永远是核心</h2>不要等到主题完全满意才开始写。设计会变化，但真诚的内容会留下。`},
{id:5,title:"给机械键盘换轴之后，我又用回了薄膜键盘",desc:"工具的价值不在参数，而在它是否让你忘记工具本身。",date:"2026-06-10",type:"一些日常",tags:["日常","硬件"],read:"5 分钟",lead:"折腾的终点有时不是更高级，而是更适合。",body:`我花了一个周末润轴、调卫星轴，又试了几套键帽。它确实变得很好听，但工作时我反而开始在意每一次敲击。<h2>参数之外</h2>最后换回那把普通薄膜键盘，注意力重新回到文字上。好的工具，也许就是让人忘记它的存在。`},
{id:6,title:"Docker 容器备份：别等硬盘坏了才想起来",desc:"一套足够简单、可以定期验证的个人服务器备份方案。",date:"2026-05-27",type:"简单技术",tags:["技术","Docker","教程"],read:"9 分钟",lead:"没有经过恢复测试的备份，只是一份美好的愿望。",body:`容器本身随时可以重新创建，真正要备份的是配置、挂载卷和数据库。<h2>遵循 3-2-1 原则</h2>保留三份数据，使用两种介质，其中一份放在异地。对个人服务来说，可以是本地硬盘、移动硬盘和加密云存储。<h2>定期恢复</h2>每隔几个月抽取一份备份，在隔离环境里执行恢复。只有成功打开数据，备份才算真正有效。`}
];
let posts=[...seedPosts];
let filter="全部",page=1;const perPage=4,$=s=>document.querySelector(s);
function filtered(){return posts.filter(p=>filter==="全部"||p.tags.includes(filter))}
function render(){
 const list=filtered(),start=(page-1)*perPage;
 $("#postList").innerHTML=list.slice(start,start+perPage).map(p=>`<article class="post-item" data-id="${p.id}" tabindex="0"><div class="post-top"><span class="type">${esc(p.type)}</span><span>·</span><span>${esc(p.read)}</span></div><h2><a>${esc(p.title)}</a></h2><p>${esc(p.desc)}</p><div class="post-bottom"><div class="tags">${p.tags.map(t=>`<span>#${esc(t)}</span>`).join("")}</div><time>${esc(p.date)}</time></div></article>`).join("")||`<article class="post-item"><p>这个分类还没有文章。</p></article>`;
 const pages=Math.ceil(list.length/perPage);$("#pagination").innerHTML=pages>1?Array.from({length:pages},(_,i)=>`<button class="${page===i+1?"active":""}" data-page-num="${i+1}">${i+1}</button>`).join(""):"";
}
render();
async function refreshRemotePosts(){
 if(!window.blogAuth?.listPublishedPosts)return;
 const rows=await window.blogAuth.listPublishedPosts();
 if(rows===null)return;
 const remote=rows.map(p=>({id:1000000+Number(p.id),dbId:p.id,title:p.title,desc:p.description,date:p.published_at,type:p.type,tags:p.tags||[],read:p.read_time||"5 分钟",lead:p.lead,body:p.body}));
 posts=[...remote,...seedPosts];page=1;render();
}
window.refreshRemotePosts=refreshRemotePosts;
window.addEventListener("blog-auth-change",refreshRemotePosts);
setTimeout(refreshRemotePosts,0);
document.addEventListener("click",e=>{
 const nav=e.target.closest("[data-page]");if(nav){e.preventDefault();showPage(nav.dataset.page)}
 const post=e.target.closest(".post-item,.search-result");if(post?.dataset.id)openArticle(Number(post.dataset.id));
 const close=e.target.closest("[data-close]");if(close)document.getElementById(close.dataset.close).close();
 const p=e.target.closest("[data-page-num]");if(p){page=Number(p.dataset.pageNum);render();scrollTo({top:250,behavior:"smooth"})}
});
document.addEventListener("keydown",e=>{if(e.key==="Enter"&&e.target.matches(".post-item"))openArticle(Number(e.target.dataset.id))});
function closeMenu(){document.querySelector("nav").classList.remove("open");document.body.classList.remove("nav-open");$("#menuBtn").textContent="☰";$("#menuBtn").setAttribute("aria-expanded","false")}
function showPage(id){document.querySelectorAll(".page").forEach(x=>x.classList.toggle("active",x.id===id));document.querySelectorAll("nav a").forEach(x=>x.classList.toggle("active",x.dataset.page===id));closeMenu();history.replaceState(null,"","#"+id);scrollTo({top:0,behavior:"smooth"})}
$("#filters").onclick=e=>{const b=e.target.closest("[data-filter]");if(!b)return;filter=b.dataset.filter;page=1;$("#filters .active").classList.remove("active");b.classList.add("active");render()};
document.querySelector(".tag-cloud").onclick=e=>{const b=e.target.closest("[data-tag]");if(!b)return;filter=b.dataset.tag;page=1;document.querySelectorAll("#filters button").forEach(x=>x.classList.remove("active"));render();scrollTo({top:280,behavior:"smooth"})};
$("#menuBtn").setAttribute("aria-expanded","false");$("#menuBtn").onclick=()=>{const open=!document.querySelector("nav").classList.contains("open");document.querySelector("nav").classList.toggle("open",open);document.body.classList.toggle("nav-open",open);$("#menuBtn").textContent=open?"×":"☰";$("#menuBtn").setAttribute("aria-expanded",String(open))};$("#navBackdrop").onclick=closeMenu;
const setTheme=d=>{document.body.classList.toggle("dark",d);document.querySelector('meta[name="theme-color"]').content=d?"#131517":"#f7f8fa";localStorage.setItem("yu-theme",d?"dark":"light")};setTheme(localStorage.getItem("yu-theme")==="dark"||(!localStorage.getItem("yu-theme")&&matchMedia("(prefers-color-scheme:dark)").matches));$("#themeBtn").onclick=()=>setTheme(!document.body.classList.contains("dark"));
$("#searchBtn").onclick=()=>{$("#searchDialog").showModal();$("#searchInput").value="";search("");setTimeout(()=>$("#searchInput").focus(),50)};$("#searchInput").oninput=e=>search(e.target.value);
function search(q){let l=q?posts.filter(p=>(p.title+p.desc+p.tags).toLowerCase().includes(q.toLowerCase())):posts.slice(0,4);$("#searchResults").innerHTML=l.map(p=>`<div class="search-result" data-id="${p.id}"><small>${esc(p.date)} · ${p.tags.map(esc).join(" / ")}</small><div>${esc(p.title)}</div></div>`).join("")||`<p class="search-hint">没有找到相关文章</p>`}
window.onscroll=()=>$("#toTop").classList.toggle("show",scrollY>500);$("#toTop").onclick=()=>scrollTo({top:0,behavior:"smooth"});
let currentPost;
function openArticle(id){currentPost=posts.find(p=>p.id===id);window.currentPost=currentPost;$("#articleContent").innerHTML=`<div class="article-body"><div class="article-meta">${esc(currentPost.type)} · ${esc(currentPost.date)} · ${esc(currentPost.read)}</div><h1>${esc(currentPost.title)}</h1><p class="lead">${esc(currentPost.lead)}</p><div class="article-text">${currentPost.body}<p>感谢你读到这里。如果这篇文章对你有帮助，欢迎在评论区留下想法。</p></div></div>`;$("#searchDialog").close();$("#articleDialog").showModal();$("#articleDialog").scrollTop=0;renderComments()}
const defaults=[{id:101,name:"小满",text:"写得很实用，尤其喜欢“服务要少而精”这句话。折腾到最后，稳定真的比数量重要。",time:"2026-07-28 09:42",likes:6},{id:102,name:"North",text:"旧笔记本自带 UPS 这个角度确实没想到，周末准备试试看。",time:"2026-07-28 14:18",likes:2}];
function getComments(){return JSON.parse(localStorage.getItem(`yu-comments-${currentPost.id}`)||"null")||(currentPost.id===1?defaults:[])}function saveComments(v){localStorage.setItem(`yu-comments-${currentPost.id}`,JSON.stringify(v))}
function esc(s){return s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
async function renderComments(){let l;if(window.blogAuth?.configured){$("#commentList").innerHTML=`<p class="search-hint">正在加载评论…</p>`;l=await window.blogAuth.listComments(currentPost.id)}else{l=getComments()}$("#commentCount").textContent=l.length;$("#commentList").innerHTML=l.length?l.map(c=>`<article class="comment"><div class="avatar">${esc(c.name[0].toUpperCase())}</div><div><div class="comment-head"><strong>${esc(c.name)}</strong><time>${c.time}</time></div><p>${esc(c.text)}</p><button class="like-btn" data-like="${c.id}" data-likes="${c.likes||0}">♡ ${c.likes||0}</button>${c.own?`<button class="comment-delete" data-delete="${c.id}">删除</button>`:""}</div></article>`).join(""):`<p class="search-hint">还没有评论，来留下第一条吧。</p>`}
window.renderComments=renderComments;
$("#commentForm textarea").oninput=e=>$("#charCount").textContent=e.target.value.length;
$("#commentForm").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),content=f.get("content").trim();if(window.blogAuth?.configured){const ok=await window.blogAuth.addComment(currentPost.id,content);if(!ok)return}else{const l=getComments();l.unshift({id:Date.now(),name:"本地访客",text:content,time:new Date().toLocaleString("zh-CN",{hour12:false}),likes:0});saveComments(l)}e.target.reset();$("#charCount").textContent=0;await renderComments();toast("评论发表成功")};
$("#commentList").onclick=async e=>{const like=e.target.closest("[data-like]"),del=e.target.closest("[data-delete]");if(del){if(window.blogAuth?.configured&&await window.blogAuth.deleteComment(Number(del.dataset.delete))){await renderComments();toast("评论已删除")}return}if(!like)return;if(window.blogAuth?.configured){if(await window.blogAuth.likeComment(Number(like.dataset.like),Number(like.dataset.likes)))await renderComments()}else{const l=getComments(),c=l.find(x=>x.id===Number(like.dataset.like));c.likes++;saveComments(l);renderComments()}};
function toast(t){$("#toast").textContent=t;$("#toast").classList.add("show");setTimeout(()=>$("#toast").classList.remove("show"),1800)}window.toast=toast;
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeMenu()});
if(location.hash&&document.querySelector(location.hash+".page"))showPage(location.hash.slice(1));
