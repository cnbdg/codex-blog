(() => {
  "use strict";

  const allowedTags = new Set([
    "P", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "UL", "OL", "LI",
    "STRONG", "EM", "DEL", "A", "IMG", "VIDEO", "CODE", "PRE", "BR", "HR", "TABLE",
    "THEAD", "TBODY", "TR", "TH", "TD", "DIV", "SPAN"
  ]);

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    })[char]);
  }

  function safeUrl(value, image = false) {
    const url = String(value || "").trim();
    if (!url) return "";
    if (/^(https?:|mailto:)/i.test(url) || /^(\/|\.\/|\.\.\/|#)/.test(url)) return url;
    if (image && /^data:image\/(?:png|gif|jpe?g|webp);base64,/i.test(url)) return url;
    return "";
  }

  function safeMediaUrl(value) {
    const url = safeUrl(value);
    return /^(?:https?:|\/|\.\/|\.\.\/)/i.test(url) ? url : "";
  }

  function sanitize(html) {
    const template = document.createElement("template");
    template.innerHTML = String(html || "");
    template.content.querySelectorAll("script,style,iframe,object,embed,form,svg,math").forEach(node => node.remove());
    [...template.content.querySelectorAll("*")].forEach(node => {
      if (!allowedTags.has(node.tagName)) {
        node.replaceWith(...node.childNodes);
        return;
      }
      const hrefValue = node.getAttribute("href");
      const srcValue = node.getAttribute("src");
      const altValue = node.getAttribute("alt");
      const legacyCode = node.tagName === "DIV" && node.classList.contains("code");
      [...node.attributes].forEach(attribute => node.removeAttribute(attribute.name));
      if (node.tagName === "A") {
        const href = safeUrl(hrefValue);
        if (href) node.setAttribute("href", href);
        if (/^https?:/i.test(href)) {
          node.setAttribute("target", "_blank");
          node.setAttribute("rel", "noopener noreferrer");
        }
      }
      if (node.tagName === "IMG") {
        const src = safeUrl(srcValue, true);
        if (!src) return node.remove();
        node.setAttribute("src", src);
        node.setAttribute("alt", altValue || "");
        node.setAttribute("loading", "lazy");
        node.setAttribute("decoding", "async");
      }
      if (node.tagName === "VIDEO") {
        const src = safeMediaUrl(srcValue);
        if (!src) return node.remove();
        node.setAttribute("src", src);
        node.setAttribute("controls", "");
        node.setAttribute("preload", "metadata");
        node.setAttribute("playsinline", "");
      }
      if (legacyCode) node.className = "code";
    });
    return template.innerHTML;
  }

  function inline(source) {
    const tokens = [];
    let text = String(source || "").replace(/`([^`\n]+)`/g, (_, code) => {
      tokens.push(`<code>${escapeHtml(code)}</code>`);
      return `\u0000${tokens.length - 1}\u0000`;
    });
    text = escapeHtml(text)
      .replace(/@\[(?:视频|video)\]\((\S+?)(?:\s+["'].*?["'])?\)/gi, (_, url) => {
        const src = safeMediaUrl(url);
        return src ? `<video src="${escapeHtml(src)}" controls preload="metadata" playsinline>你的浏览器不支持视频播放。</video>` : "[视频地址无效]";
      })
      .replace(/!\[([^\]]*)\]\((\S+?)(?:\s+["'].*?["'])?\)/g, (_, alt, url) => {
        const src = safeUrl(url, true);
        return src ? `<img src="${escapeHtml(src)}" alt="${alt}" loading="lazy" decoding="async">` : alt;
      })
      .replace(/\[([^\]]+)\]\((\S+?)(?:\s+["'].*?["'])?\)/g, (_, label, url) => {
        const href = safeUrl(url);
        if (!href) return label;
        const external = /^https?:/i.test(href) ? ` target="_blank" rel="noopener noreferrer"` : "";
        return `<a href="${escapeHtml(href)}"${external}>${label}</a>`;
      })
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
      .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
      .replace(/(^|[^\w])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(/(^|[^\w])_([^_\n]+)_/g, "$1<em>$2</em>")
      .replace(/  \n/g, "<br>\n");
    return text.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)]);
  }

  function renderBlocks(markdown) {
    const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
    const output = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) {
        index++;
        continue;
      }

      const fence = line.match(/^\s*```([\w-]*)\s*$/);
      if (fence) {
        const code = [];
        index++;
        while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) code.push(lines[index++]);
        if (index < lines.length) index++;
        const language = fence[1] ? ` class="language-${escapeHtml(fence[1])}"` : "";
        output.push(`<pre><code${language}>${escapeHtml(code.join("\n"))}</code></pre>`);
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        const level = heading[1].length;
        output.push(`<h${level}>${inline(heading[2])}</h${level}>`);
        index++;
        continue;
      }

      if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
        output.push("<hr>");
        index++;
        continue;
      }

      if (/^\s*>\s?/.test(line)) {
        const quote = [];
        while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
          quote.push(lines[index++].replace(/^\s*>\s?/, ""));
        }
        output.push(`<blockquote>${renderBlocks(quote.join("\n"))}</blockquote>`);
        continue;
      }

      const listMatch = line.match(/^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/);
      if (listMatch) {
        const ordered = Boolean(listMatch[2]);
        const tag = ordered ? "ol" : "ul";
        const items = [];
        while (index < lines.length) {
          const match = lines[index].match(/^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/);
          if (!match || Boolean(match[2]) !== ordered) break;
          items.push(`<li>${inline(match[3])}</li>`);
          index++;
        }
        output.push(`<${tag}>${items.join("")}</${tag}>`);
        continue;
      }

      if (index + 1 < lines.length && /\|/.test(line) && /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(lines[index + 1])) {
        const split = value => value.trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim());
        const headers = split(line);
        index += 2;
        const rows = [];
        while (index < lines.length && /\|/.test(lines[index]) && lines[index].trim()) rows.push(split(lines[index++]));
        output.push(`<table><thead><tr>${headers.map(cell => `<th>${inline(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${headers.map((_, cell) => `<td>${inline(row[cell] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
        continue;
      }

      const paragraph = [line.trim()];
      index++;
      while (index < lines.length && lines[index].trim() &&
        !/^(#{1,6})\s+|^\s*```|^\s*>|^\s*(?:[-+*]|\d+\.)\s+|^\s*(?:---+|\*\*\*+|___+)\s*$/.test(lines[index])) {
        paragraph.push(lines[index].trim());
        index++;
      }
      output.push(`<p>${inline(paragraph.join("\n"))}</p>`);
    }
    return output.join("");
  }

  function render(source) {
    const value = String(source || "").trim();
    if (!value) return "";
    const legacyHtml = /<(?:p|h[1-6]|div|pre|blockquote|ul|ol|table)\b/i.test(value);
    return sanitize(legacyHtml ? value : renderBlocks(value));
  }

  window.blogMarkdown = { render, sanitize, escapeHtml };
})();
