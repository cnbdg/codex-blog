(() => {
  "use strict";

  const config = window.BLOG_CONFIG?.wallpaperSettings || {};
  const storage = {
    choice: "cnbdg-wallpaper-choice",
    custom: "cnbdg-wallpaper-custom",
    brightness: "cnbdg-wallpaper-brightness",
    blur: "cnbdg-wallpaper-blur",
    panelOpacity: "cnbdg-panel-opacity"
  };
  const $ = selector => document.querySelector(selector);
  const mobileQuery = matchMedia("(max-width: 800px)");
  let choice = localStorage.getItem(storage.choice) || "auto";
  let customUrl = localStorage.getItem(storage.custom) || "";

  function safeUrl(value) {
    try {
      const input = String(value || "").trim();
      if (!input) return "";
      const parsed = new URL(input, location.href);
      return /^https?:$/.test(parsed.protocol) ? parsed.href : "";
    } catch {
      return "";
    }
  }

  function automaticUrl() {
    return mobileQuery.matches ? config.mobileDefault : config.desktopDefault;
  }

  function selectedUrl() {
    if (choice === "auto") return safeUrl(automaticUrl());
    if (choice === "custom") return safeUrl(customUrl);
    return safeUrl(choice) || safeUrl(automaticUrl());
  }

  function readNumber(key, fallback, minimum, maximum) {
    const stored = Number(localStorage.getItem(key));
    return Number.isFinite(stored) && stored >= minimum && stored <= maximum
      ? stored
      : fallback;
  }

  function applyDisplaySettings() {
    const brightness = readNumber(storage.brightness, Number(config.brightness) || 85, 35, 120);
    const blur = readNumber(storage.blur, Number(config.blur) || 5, 0, 20);
    const panelOpacity = readNumber(storage.panelOpacity, Number(config.panelOpacity) || 52, 20, 100);
    document.documentElement.style.setProperty("--wallpaper-brightness", `${brightness}%`);
    document.documentElement.style.setProperty("--wallpaper-blur", `${blur}px`);
    document.documentElement.style.setProperty("--panel-opacity", `${panelOpacity}%`);
    $("#wallpaperBrightness").value = brightness;
    $("#wallpaperBlur").value = blur;
    $("#panelOpacity").value = panelOpacity;
    $("#brightnessValue").textContent = `${brightness}%`;
    $("#blurValue").textContent = `${blur}px`;
    $("#panelOpacityValue").textContent = `${panelOpacity}%`;
  }

  function applyWallpaper(showMessage = false) {
    const url = selectedUrl();
    window.setBlogWallpaper?.(url);
    document.body.dataset.wallpaperMode = choice;
    const status = $("#wallpaperStatus");
    if (status) {
      status.textContent = choice === "auto"
        ? `当前：跟随${mobileQuery.matches ? "手机" : "桌面"}默认`
        : choice === "custom" ? "当前：自定义壁纸" : "当前：精选壁纸";
    }
    renderActiveState();
    if (showMessage) window.toast?.("壁纸已更换");
  }

  function makeCard(item, group) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "wallpaper-card";
    button.dataset.wallpaperUrl = item.url;
    button.title = `切换为${item.title}`;
    const image = document.createElement("img");
    image.src = item.preview || item.url;
    image.alt = "";
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => button.classList.add("image-error"));
    const text = document.createElement("span");
    text.textContent = item.title;
    const badge = document.createElement("small");
    badge.textContent = group === "mobile" ? "手机" : "桌面";
    button.append(image, text, badge);
    return button;
  }

  function renderGrid() {
    const grid = $("#wallpaperGrid");
    const auto = document.createElement("button");
    auto.type = "button";
    auto.className = "wallpaper-card auto-card";
    auto.dataset.wallpaperUrl = "auto";
    auto.innerHTML = `<span class="auto-icon">◐</span><span>跟随设备</span><small>自动</small>`;
    grid.replaceChildren(auto);
    for (const item of config.desktop || []) grid.append(makeCard(item, "desktop"));
    for (const item of config.mobile || []) grid.append(makeCard(item, "mobile"));
    renderActiveState();
  }

  function renderActiveState() {
    document.querySelectorAll("[data-wallpaper-url]").forEach(button => {
      button.classList.toggle("active", button.dataset.wallpaperUrl === choice);
    });
  }

  function selectWallpaper(value) {
    choice = value;
    localStorage.setItem(storage.choice, value);
    applyWallpaper(true);
  }

  function applyCustom(event) {
    event.preventDefault();
    const input = event.currentTarget.elements.url;
    const url = safeUrl(input.value);
    if (!url) {
      input.setCustomValidity("请输入有效的 HTTP 或 HTTPS 图片地址");
      input.reportValidity();
      return;
    }
    input.setCustomValidity("");
    customUrl = url;
    choice = "custom";
    localStorage.setItem(storage.custom, customUrl);
    localStorage.setItem(storage.choice, choice);
    applyWallpaper(true);
  }

  function bindRange(input, output, key, cssProperty, unit) {
    input.addEventListener("input", () => {
      const value = Number(input.value);
      localStorage.setItem(key, String(value));
      document.documentElement.style.setProperty(cssProperty, `${value}${unit}`);
      output.textContent = `${value}${unit}`;
    });
  }

  function startTypewriter() {
    const target = $("#typewriterLine");
    const lines = window.BLOG_CONFIG?.typeWriterStrings || [];
    if (!target || !lines.length) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      target.textContent = lines[0];
      return;
    }
    let lineIndex = 0;
    let characterIndex = 0;
    let removing = false;
    const tick = () => {
      const line = lines[lineIndex];
      characterIndex += removing ? -1 : 1;
      target.textContent = line.slice(0, Math.max(0, characterIndex));
      let delay = removing ? 35 : 70;
      if (!removing && characterIndex >= line.length) {
        removing = true;
        delay = 1900;
      } else if (removing && characterIndex <= 0) {
        removing = false;
        lineIndex = (lineIndex + 1) % lines.length;
        delay = 380;
      }
      setTimeout(tick, delay);
    };
    tick();
  }

  function init() {
    renderGrid();
    applyDisplaySettings();
    applyWallpaper();
    startTypewriter();
    $("#wallpaperBtn").addEventListener("click", () => {
      if (!$("#wallpaperDialog").open) $("#wallpaperDialog").showModal();
    });
    document.querySelector("[data-open-wallpaper]")?.addEventListener("click", event => {
      event.preventDefault();
      document.querySelector("nav")?.classList.remove("open");
      document.body.classList.remove("nav-open");
      if (!$("#wallpaperDialog").open) $("#wallpaperDialog").showModal();
    });
    $("#wallpaperGrid").addEventListener("click", event => {
      const card = event.target.closest("[data-wallpaper-url]");
      if (card) selectWallpaper(card.dataset.wallpaperUrl);
    });
    $("#customWallpaperForm").addEventListener("submit", applyCustom);
    $("#resetWallpaperBtn").addEventListener("click", () => selectWallpaper("auto"));
    bindRange($("#wallpaperBrightness"), $("#brightnessValue"), storage.brightness, "--wallpaper-brightness", "%");
    bindRange($("#wallpaperBlur"), $("#blurValue"), storage.blur, "--wallpaper-blur", "px");
    bindRange($("#panelOpacity"), $("#panelOpacityValue"), storage.panelOpacity, "--panel-opacity", "%");
    mobileQuery.addEventListener?.("change", () => {
      if (choice === "auto") applyWallpaper();
    });
  }

  init();
})();
