// Supabase 项目的公开配置。Publishable key 可以安全地出现在浏览器前端。
// 不要在这里填写 service_role key。
window.BLOG_CONFIG = {
  siteUrl: "https://cnbdg.co/",
  supabaseUrl: "https://kwewqbkyrsvvwywhzguy.supabase.co",
  supabasePublishableKey: "sb_publishable_SIa_X98kBnD-dMos6JMTpA_H7LDdjg1",
  // Cloudflare Turnstile 的公开 Site Key。不要把 Secret Key 写进前端或提交到仓库。
  // 留空时会暂停登录、注册和密码找回，避免出现“界面有验证、后端却未保护”的假安全状态。
  turnstileSiteKey: "0x4AAAAAAEDjOIKU5uNL9-Ml",
  captchaRequiredForAuth: true,
  // 把壁纸直链填在这里；留空时使用原来的纯色背景。
  backgroundImageUrl: "",
  wallpaperSettings: {
    brightness: 85,
    blur: 5,
    panelOpacity: 52,
    desktopDefault: "https://s21.ax1x.com/2025/07/23/pVGlmDO.jpg",
    mobileDefault: "https://home.cnbdg0826.dpdns.org/img/wallpaper/static-mobile/0001/image.png",
    desktop: [
      { title: "导航页默认", preview: "https://s21.ax1x.com/2025/07/23/pVGlmDO.md.jpg", url: "https://s21.ax1x.com/2025/07/23/pVGlmDO.jpg" },
      { title: "海洋女孩", preview: "https://home.cnbdg0826.dpdns.org/img/wallpaper/static/海洋女孩/image.png", url: "https://home.cnbdg0826.dpdns.org/img/wallpaper/static/海洋女孩/image.png" },
      { title: "书房夜晚", preview: "https://home.cnbdg0826.dpdns.org/img/wallpaper/static/书房夜晚/image-pre.webp", url: "https://home.cnbdg0826.dpdns.org/img/wallpaper/static/书房夜晚/image.png" },
      { title: "精选 01", preview: "https://s21.ax1x.com/2025/07/23/pVGli59.md.jpg", url: "https://s21.ax1x.com/2025/07/23/pVGli59.jpg" },
      { title: "精选 02", preview: "https://s21.ax1x.com/2025/07/23/pVGlNqS.md.jpg", url: "https://s21.ax1x.com/2025/07/23/pVGlNqS.jpg" },
      { title: "精选 03", preview: "https://s21.ax1x.com/2025/07/23/pVGlfIJ.md.jpg", url: "https://s21.ax1x.com/2025/07/23/pVGlfIJ.jpg" },
      { title: "精选 04", preview: "https://s21.ax1x.com/2025/07/23/pVGlEgx.md.webp", url: "https://s21.ax1x.com/2025/07/23/pVGlEgx.webp" },
      { title: "精选 05", preview: "https://s21.ax1x.com/2025/07/23/pVGldaQ.md.jpg", url: "https://s21.ax1x.com/2025/07/23/pVGldaQ.jpg" },
      { title: "精选 06", preview: "https://s21.ax1x.com/2025/07/23/pVGl82t.md.jpg", url: "https://s21.ax1x.com/2025/07/23/pVGl82t.jpg" },
      { title: "精选 07", preview: "https://s21.ax1x.com/2025/07/23/pVGlaVg.md.jpg", url: "https://s21.ax1x.com/2025/07/23/pVGlaVg.jpg" }
    ],
    mobile: [
      { title: "手机 0001", preview: "https://home.cnbdg0826.dpdns.org/img/wallpaper/static-mobile/0001/image-pre.webp", url: "https://home.cnbdg0826.dpdns.org/img/wallpaper/static-mobile/0001/image.png" },
      { title: "手机 0002", preview: "https://home.cnbdg0826.dpdns.org/img/wallpaper/static-mobile/0002/image.png", url: "https://home.cnbdg0826.dpdns.org/img/wallpaper/static-mobile/0002/image.png" },
      { title: "手机 0003", preview: "https://home.cnbdg0826.dpdns.org/img/wallpaper/static-mobile/0003/image.png", url: "https://home.cnbdg0826.dpdns.org/img/wallpaper/static-mobile/0003/image.png" },
      { title: "手机 0004", preview: "https://home.cnbdg0826.dpdns.org/img/wallpaper/static-mobile/0004/image.png", url: "https://home.cnbdg0826.dpdns.org/img/wallpaper/static-mobile/0004/image.png" },
      { title: "手机精选 01", preview: "https://s21.ax1x.com/2025/07/23/pVG1uQ0.md.jpg", url: "https://s21.ax1x.com/2025/07/23/pVG1uQ0.jpg" },
      { title: "手机精选 02", preview: "https://s21.ax1x.com/2025/07/23/pVG1Vij.md.jpg", url: "https://s21.ax1x.com/2025/07/23/pVG1Vij.jpg" },
      { title: "手机精选 03", preview: "https://s21.ax1x.com/2025/07/23/pVGlIR1.md.jpg", url: "https://s21.ax1x.com/2025/07/23/pVGlIR1.jpg" }
    ]
  },
  typeWriterStrings: [
    "Ciallo～(∠・ω< )⌒★",
    "如果你看到了这行字，说明我已经成功吸引到了你的注意力。",
    "咕咕嘎嘎！保持好奇，继续向前。",
    "心简单，世界就简单，幸福才会生长。",
    "生命太短，没有时间留给遗憾。"
  ]
};
