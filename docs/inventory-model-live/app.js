/* ============================================================
   亚马逊运营工作台 - 主应用控制器
   模块一：市场调研（榜单分析 / 热搜词分析 / 竞品分析）
   模块二：Listing 编辑（规划中）
   模块三：广告智研舱
   ============================================================ */

(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  /* ---------- 工具 ---------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtSize(bytes) {
    if (bytes == null) return "-";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1024 / 1024).toFixed(2) + " MB";
  }

  function fmtNum(n, d) {
    if (n == null || isNaN(n)) return "-";
    return Number(n).toLocaleString("zh-CN", { maximumFractionDigits: d == null ? 2 : d });
  }

  function toast(msg, type) {
    const root = $("#toast-root");
    const el = document.createElement("div");
    el.className = "toast" + (type ? " " + type : "");
    const icon = type === "success" ? "check-circle" : type === "error" ? "alert-circle" : "info";
    el.innerHTML = `<i data-lucide="${icon}"></i><span>${esc(msg)}</span>`;
    root.appendChild(el);
    if (window.lucide) lucide.createIcons();
    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transition = "opacity 0.3s";
      setTimeout(() => el.remove(), 300);
    }, 3000);
  }

  let inventorySnapshotPromise = null;

  async function loadInventorySnapshot() {
    if (!inventorySnapshotPromise) {
      inventorySnapshotPromise = (async () => {
        const response = await fetch(new URL("snapshot-data.json.gz?v=20261103-compact-2", location.href));
        if (!response.ok) throw new Error("库存快照数据读取失败");
        const buffer = await response.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let stream = new Blob([bytes]).stream();
        if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
          stream = stream.pipeThrough(new DecompressionStream("gzip"));
        }
        return JSON.parse(await new Response(stream).text());
      })().catch((error) => {
        inventorySnapshotPromise = null;
        throw error;
      });
    }
    return inventorySnapshotPromise;
  }

  async function api(path, options) {
    if (window.__INVENTORY_SNAPSHOT_MODE__) {
      if (path === "/api/inventory-monitor" || path.startsWith("/api/inventory-monitor?")) {
        return loadInventorySnapshot();
      }
      if (path === "/api/inventory-monitor-fba-lead") return { ok: true };
      if (path === "/api/workspace") return { workspace: "团队展示快照", exists: true };
      if (path === "/api/inventory-monitor-sync" || path === "/api/inventory-monitor-sync-status") {
        return { ok: false, needLogin: false, message: "团队展示快照为只读" };
      }
    }
    const resp = await fetch(path, options);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || "请求失败");
    return data;
  }

  function initIcons(root) {
    if (window.lucide) lucide.createIcons({ root: root || document });
  }

  function tableMatrix(table, options = {}) {
    if (!table) return { headers: [], rows: [] };
    const headerRows = Array.from(table.tHead?.rows || []);
    const headerGrid = [];
    headerRows.forEach((row, rowIndex) => {
      headerGrid[rowIndex] ||= [];
      let columnIndex = 0;
      Array.from(row.cells).forEach((cell) => {
        while (headerGrid[rowIndex][columnIndex] != null) columnIndex += 1;
        const rowSpan = Math.max(1, cell.rowSpan || 1);
        const colSpan = Math.max(1, cell.colSpan || 1);
        const label = String(cell.innerText || cell.textContent || "").trim().replace(/\s+/g, " ");
        for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
          const targetRow = rowIndex + rowOffset;
          headerGrid[targetRow] ||= [];
          for (let columnOffset = 0; columnOffset < colSpan; columnOffset += 1) {
            headerGrid[targetRow][columnIndex + columnOffset] = label;
          }
        }
        columnIndex += colSpan;
      });
    });
    const columnCount = Math.max(
      0,
      ...headerGrid.map((row) => row.length),
      ...Array.from(table.tBodies || []).flatMap((body) => Array.from(body.rows).map((row) => row.cells.length)),
    );
    const allHeaders = Array.from({ length: columnCount }, (_, columnIndex) => {
      const labels = [];
      headerGrid.forEach((row) => {
        const label = row[columnIndex];
        if (label && labels[labels.length - 1] !== label) labels.push(label);
      });
      return labels.join(" · ") || `列${columnIndex + 1}`;
    });
    const columns = Array.from({ length: columnCount }, (_, index) => index)
      .filter((index) => !options.columnFilter || options.columnFilter(allHeaders[index], index));
    const headers = columns.map((index) => allHeaders[index]);

    const cellText = (cell) => {
      if (!cell || cell.hidden) return "";
      if (options.ignore?.(cell)) return "";
      const notePreview = cell.querySelector?.(".pf-note-preview-text");
      if (notePreview) {
        const text = String(notePreview.textContent || "").trim();
        return text === "点击填写" ? "" : text;
      }
      const editor = cell.querySelector?.("input, select, textarea");
      if (editor) {
        if (editor instanceof HTMLInputElement && editor.type === "checkbox") return editor.checked ? "是" : "";
        if (editor instanceof HTMLSelectElement) return editor.selectedOptions?.[0]?.textContent?.trim() || editor.value || "";
        return String(editor.value || "").trim();
      }
      return String(cell.innerText || cell.textContent || "").trim();
    };

    const bodyRows = options.bodySelector
      ? Array.from(table.querySelectorAll(options.bodySelector))
      : Array.from(table.tBodies || []).flatMap((body) => Array.from(body.rows));
    const rows = bodyRows
      .filter((row) => !options.rowFilter || options.rowFilter(row))
      .map((row) => {
        const cells = Array.from(row.cells);
        return columns.map((index) => cellText(cells[index]));
      });
    return { headers, rows };
  }

  function downloadTableCsv(table, filename, options = {}) {
    const matrix = tableMatrix(table, options);
    if (!matrix.rows.length) return false;
    const lines = [
      matrix.headers.map(csvCell),
      ...matrix.rows.map((row) => row.slice(0, matrix.headers.length).map(csvCell)),
    ];
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
    return true;
  }

  function csvCell(value) {
    return `"${String(value == null ? "" : value).replace(/"/g, '""')}"`;
  }

  function openAdsBuilder(account, site, model) {
    try {
      sessionStorage.setItem("wb.adsProductContext", JSON.stringify({ account, site, model }));
    } catch (e) { /* 无会话存储时仍可进入广告搭建 */ }
    switchView("adsbuilder");
  }

  /* ---------- 视图注册 ---------- */
  const views = {};
  window.Workbench = {
    $, $$, esc, fmtSize, fmtNum, toast, api, initIcons, tableMatrix, downloadTableCsv, views,
    switchView, openAdsBuilder, sites: window.WorkbenchSites,
  };

  /* ---------- 服务状态 ---------- */
  let lastStatusHtml = "";
  let healthCache = { at: 0, data: null };
  async function refreshServiceStatus() {
    const box = $("#svc-status");
    if (!box) return;
    try {
      const now = Date.now();
      let data = healthCache.data;
      if (!data || now - healthCache.at > 10000) {
        data = await api("/api/health");
        healthCache = { at: now, data };
      }
      let html = "";
      Object.keys(data).forEach((key) => {
        const s = data[key];
        html += `<div class="svc-item"><span class="svc-dot ${s.alive ? "on" : "off"}"></span>${esc(s.name)}${s.alive ? "" : " · 未启动"}</div>`;
      });
      if (html !== lastStatusHtml) {
        box.innerHTML = html;
        lastStatusHtml = html;
      }
    } catch (e) {
      /* 忽略 */
    }
  }

  async function refreshWorkspacePath() {
    const el = $("#workspace-path");
    if (!el) return;
    try {
      const data = await api("/api/workspace");
      el.textContent = data.workspace || "未知";
      el.title = data.exists ? "工作区已就绪" : "工作区目录不存在";
    } catch (e) {
      el.textContent = "~/Desktop/AMZ- auto";
    }
  }

  /* ---------- 视图切换 ---------- */
  const VIEW_ALIASES = {
    "promotion-daily": "promotion-overview",
  };

  async function switchView(name) {
    name = VIEW_ALIASES[name] || name;
    if (!views[name] && !VIEW_MODULES[name]) return;
    try {
      await ensureViewModule(name);
    } catch (e) {
      toast(e.message || "模块加载失败", "error");
      return;
    }
    if (!views[name]) return;
    $$(".nav-item").forEach((b) => {
      const active = b.dataset.view === name;
      b.classList.toggle("is-active", active);
      if (active) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    if (location.hash !== "#" + name) {
      try { history.replaceState(null, "", "#" + name); } catch (e) { /* 忽略 */ }
    }
    const root = $("#view-root");
    const view = views[name];
    try {
      view.render(root);
    } catch (e) {
      root.innerHTML = `<div class="empty-state"><p>渲染失败: ${esc(e.message)}</p></div>`;
      console.error(e);
    }
    initIcons(root);
    if (view.afterRender) view.afterRender();
  }

  /* ---------- 模块加载 ---------- */
  /* cache-busting：文件名后拼构建时间戳，确保每次会话强刷拉取最新模块，
     避免浏览器/服务端缓存导致「代码已改、页面仍跑旧逻辑」。 */
  const BUILD_TS = Date.now();
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src + (src.indexOf("?") >= 0 ? "&" : "?") + "t=" + BUILD_TS;
      s.onload = resolve;
      s.onerror = () => reject(new Error("加载失败: " + src));
      document.head.appendChild(s);
    });
  }

  /* 视图 → 依赖脚本；只在进入对应页面时加载 */
  const VIEW_MODULES = {
    knowledge: ["modules/xlsx-reader.js", "data/amz-knowledge.js", "data/amz-knowledge-sop.js", "modules/knowledge.js"],
    products: ["modules/xlsx-reader.js", "modules/xlsx-builder.js", "modules/product-archive.js", "modules/products.js"],
    "listing-mapping": ["modules/xlsx-reader.js", "modules/xlsx-builder.js", "modules/product-archive.js", "modules/listing-mapping.js"],
    category: ["modules/xlsx-reader.js", "modules/xlsx-builder.js", "modules/category.js", "vendor/echarts.min.js", "modules/category-compare.js"],
    keywords: ["modules/keywords.js"],
    competitor: ["modules/xlsx-reader.js", "modules/xlsx-builder.js", "vendor/echarts.min.js", "modules/keyword-v3.js", "modules/competitor.js"],
    returns: ["modules/xlsx-reader.js", "modules/xlsx-builder.js", "modules/returns.js"],
    profit: ["modules/xlsx-reader.js", "modules/xlsx-builder.js", "modules/profit.js"],
    listing: ["modules/xlsx-reader.js", "modules/xlsx-builder.js", "modules/product-archive.js", "modules/listing.js"],
    tmblacklist: ["modules/xlsx-reader.js", "modules/listing.js"],
    title: ["modules/listing.js"],
    bullets: ["modules/listing.js"],
    description: ["modules/listing.js"],
    searchterms: ["modules/listing.js"],
    emails: ["modules/listing.js"],
    "promotion-overview": ["vendor/echarts.min.js", "modules/xlsx-reader.js", "modules/promotion-followup.js"],
    "promotion-daily-detail": ["vendor/echarts.min.js", "modules/xlsx-reader.js", "modules/xlsx-builder.js", "modules/promotion-followup.js"],
    "promotion-sku-detail": ["modules/xlsx-reader.js", "modules/promotion-sku-detail.js"],
    "promotion-daily-followup": ["vendor/echarts.min.js", "modules/xlsx-reader.js", "modules/promotion-followup.js"],
    "promotion-daily-compare": ["vendor/echarts.min.js", "modules/xlsx-reader.js", "modules/promotion-followup.js"],
    "promotion-daily": ["vendor/echarts.min.js", "modules/xlsx-reader.js", "modules/promotion-followup.js"],
    adsbuilder: ["modules/ads.js"],
    adsdiagnosis: ["modules/ads.js"],
    adsdiagnosissop: ["modules/ads.js"],
    adsknowledge: ["modules/ads.js"],
    "inventory-model": ["modules/inventory-monitor.js"],
    "inventory-color": ["modules/inventory-monitor.js"],
    "inventory-sku": ["modules/inventory-monitor.js"],
    mcpapi: ["modules/mcpapi.js"],
  };
  const loadedScripts = new Set();
  const scriptLoads = {};

  async function ensureViewModule(name) {
    const deps = VIEW_MODULES[name];
    if (!deps) return;
    const missing = deps.filter((src) => !loadedScripts.has(src));
    for (const src of missing) {
      if (!scriptLoads[src]) {
        scriptLoads[src] = loadScript(src)
          .then(() => loadedScripts.add(src))
          .catch((e) => {
            delete scriptLoads[src];
            throw e;
          });
      }
      await scriptLoads[src];
    }
  }

  /* ---------- 初始化 ---------- */
  async function init() {
    $$(".nav-item").forEach((b) => {
      b.addEventListener("click", () => switchView(b.dataset.view));
    });

    // 一次性渲染静态侧边栏图标
    initIcons();

    // 导航分组折叠/展开（记忆展开状态）
    initNavGroups();

    // 侧边栏收起/展开（记忆状态）
    initSidebar();

    // hash 路由：支持直接访问 #category / #keywords / #competitor / #returns / #listing / #ads
    window.addEventListener("hashchange", () => {
      const requested = location.hash.replace("#", "");
      const name = VIEW_ALIASES[requested] || requested;
      if (views[name] || VIEW_MODULES[name]) switchView(name);
    });

    const requestedInitial = location.hash.replace("#", "");
    const initial = requestedInitial
      ? (VIEW_ALIASES[requestedInitial] || requestedInitial)
      : "inventory-model";
    await switchView(views[initial] || VIEW_MODULES[initial] ? initial : "category");
    refreshServiceStatus();
    refreshWorkspacePath();
    setInterval(refreshServiceStatus, 15000);
  }

  /* 侧边栏收起/展开，状态存 localStorage */
  function initSidebar() {
    const shell = document.querySelector(".app-shell");
    const sidebar = document.querySelector("#sidebar");
    const collapseBtn = document.querySelector("#sidebar-collapse-btn");
    const expandBtn = document.querySelector("#sidebar-expand-btn");
    const overlay = document.querySelector("#sidebar-overlay");
    const resizer = document.querySelector("#sidebar-resizer");
    if (!shell || !collapseBtn || !expandBtn) return;

    const mq = window.matchMedia("(max-width: 760px)");
    const MIN_WIDTH = 200;
    const MAX_WIDTH = 280;
    const DEFAULT_WIDTH = 280;

    const clampWidth = (v) => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, v));

    function getSavedWidth() {
      try {
        const v = parseInt(localStorage.getItem("wb.sidebarWidth"), 10);
        if (Number.isFinite(v)) return clampWidth(v);
      } catch (e) { /* 忽略 */ }
      return DEFAULT_WIDTH;
    }

    function applyWidth() {
      if (!sidebar) return;
      if (mq.matches || shell.classList.contains("sidebar-collapsed")) {
        sidebar.style.width = "";
      } else {
        sidebar.style.width = getSavedWidth() + "px";
      }
    }

    const apply = (collapsed) => {
      shell.classList.toggle("sidebar-collapsed", collapsed);
      if (mq.matches) {
        // 小屏使用抽屉：默认收起，展开按钮常驻
        shell.classList.toggle("sidebar-open", !collapsed);
        collapseBtn.hidden = false;
        expandBtn.hidden = false;
        if (overlay) overlay.hidden = collapsed;
      } else {
        shell.classList.remove("sidebar-open");
        collapseBtn.hidden = collapsed;
        expandBtn.hidden = !collapsed;
        if (overlay) overlay.hidden = true;
        try {
          localStorage.setItem("wb.sidebar", collapsed ? "1" : "0");
        } catch (e) { /* 忽略 */ }
      }
      applyWidth();
    };

    if (resizer) {
      let startX = 0;
      let startWidth = 0;
      const onMove = (e) => {
        if (!sidebar) return;
        const next = clampWidth(startWidth + (e.clientX - startX));
        sidebar.style.width = next + "px";
      };
      const onUp = () => {
        document.body.classList.remove("sidebar-resizing");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        try {
          const current = sidebar ? parseInt(sidebar.style.width, 10) : 0;
          localStorage.setItem("wb.sidebarWidth", String(Number.isFinite(current) ? clampWidth(current) : DEFAULT_WIDTH));
        } catch (e) { /* 忽略 */ }
        applyWidth();
      };
      resizer.addEventListener("pointerdown", (e) => {
        if (mq.matches || shell.classList.contains("sidebar-collapsed")) return;
        e.preventDefault();
        startX = e.clientX;
        startWidth = sidebar ? sidebar.getBoundingClientRect().width : DEFAULT_WIDTH;
        document.body.classList.add("sidebar-resizing");
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
      });
      resizer.addEventListener("keydown", (e) => {
        if (mq.matches || shell.classList.contains("sidebar-collapsed")) return;
        const saved = getSavedWidth();
        let next = null;
        if (e.key === "ArrowLeft") next = saved - 16;
        else if (e.key === "ArrowRight") next = saved + 16;
        else if (e.key === "Home") next = MIN_WIDTH;
        else if (e.key === "End") next = MAX_WIDTH;
        if (next == null) return;
        e.preventDefault();
        next = clampWidth(next);
        if (sidebar) sidebar.style.width = next + "px";
        try {
          localStorage.setItem("wb.sidebarWidth", String(next));
        } catch (err) { /* 忽略 */ }
      });
    }

    // 恢复上次状态
    let saved = "0";
    try {
      saved = localStorage.getItem("wb.sidebar") || "0";
    } catch (e) { /* 忽略 */ }
    apply(mq.matches ? true : saved === "1");

    collapseBtn.addEventListener("click", () => apply(true));
    expandBtn.addEventListener("click", () => apply(false));
    if (overlay) overlay.addEventListener("click", () => apply(true));
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", (e) => apply(e.matches ? true : saved === "1"));
    }
  }

  /* 导航分组折叠/展开，状态存 localStorage */
  function initNavGroups() {
    const groups = $$(".nav-group");
    if (!groups.length) return;
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem("wb.navGroups") || "{}");
    } catch (e) {
      saved = {};
    }
    groups.forEach((g) => {
      const key = g.dataset.group;
      // 默认展开；仅当用户明确折叠过才收起
      const collapsed = saved[key] === false;
      g.setAttribute("aria-expanded", collapsed ? "false" : "true");
      g.addEventListener("click", () => {
        const isOpen = g.getAttribute("aria-expanded") === "true";
        g.setAttribute("aria-expanded", isOpen ? "false" : "true");
        saved[key] = !isOpen;
        try {
          localStorage.setItem("wb.navGroups", JSON.stringify(saved));
        } catch (e) { /* 忽略 */ }
      });
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
