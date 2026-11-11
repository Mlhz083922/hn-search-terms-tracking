const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const state = {
  db: null,
  weekId: null,
  year: null,
  view: "overview",
  libraryPage: 1,
  filter: { q: "", categories: [], tags: [], brands: [], rankMin: "", rankMax: "", rankCustom: false, weeklyNew: false },
  sort: { key: "", dir: 1 },
  overviewBrands: [],
  overviewCategories: [],
  overviewTags: [],
  volFromWeek: null,
  volToWeek: null,
  moverBaseWeek: null,
  moverCurWeek: null,
  moverSort: { key: "ratio", dir: -1 },
  draft: null,
  reviewTab: "include",
  reviewLimit: 250,
  xiyouWeekId: null,
  modal: null,
};

function weekIds() {
  return Object.keys(state.db.weeks).sort();
}

function prevWeekId(wid) {
  const ids = weekIds();
  const idx = ids.indexOf(wid);
  return idx > 0 ? ids[idx - 1] : null;
}

function weekLabel(wid) {
  return state.db.weeks[wid]?.label || wid;
}

function weekOptionLabel(wid) {
  if (!wid) return "";
  return `${wid.slice(0, 4)}年 · ${weekLabel(wid)}`;
}

function focusBrandSet() {
  return new Set(
    (state.db.settings?.focusBrands || []).map((b) => String(b).toLowerCase().trim())
  );
}

function brandMatches(k, brands) {
  const bl = String(k.brand || "").toLowerCase().trim();
  if (!brands || !brands.length) return true;
  return brands.some((b) => bl === String(b).toLowerCase().trim());
}

function multiFilterHtml(label, options, selected, target) {
  const n = (selected || []).length;
  const items = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  return `
    <div class="multi-filter" data-multi data-target="${target}">
      <button class="btn" type="button" data-multi-toggle>
        <i data-lucide="filter"></i><span>${label}</span>
        ${n ? `<span class="multi-count">${n}</span>` : ""}
      </button>
      <div class="multi-pop" hidden>
        <div class="multi-pop-head">
          <span class="muted sm">仅展示所选值</span>
          <span class="hstack">
            <button class="btn ghost sm" type="button" data-multi-all>全选</button>
            <button class="btn ghost sm" type="button" data-multi-none>清空</button>
          </span>
        </div>
        <div class="multi-list">
          ${items.map((b) => `
            <label class="multi-item">
              <input type="checkbox" value="${esc(b.value)}" ${(selected || []).includes(b.value) ? "checked" : ""}>
              <span>${esc(b.label)}</span>
            </label>`).join("")}
        </div>
        <div class="multi-pop-foot">
          <button class="btn primary sm" type="button" data-multi-apply>确定</button>
        </div>
      </div>
    </div>`;
}

function exactMatches(value, selected) {
  if (!selected || !selected.length) return true;
  return selected.includes(value || "");
}

const TAG_DIMS = ["版型", "图案", "花色", "功能", "码段", "面料", "风格", "细节", "场景"];
const TAG_SUGGESTIONS = {
  "版型": ["高腰", "中腰", "低腰", "挂脖", "无肩带", "抹胸", "一字肩", "深V", "镂空", "运动背心", "交叉背", "平角裤", "丁字裤", "高叉", "全覆盖", "抽褶", "褶皱", "三角", "修身", "两件式", "长袖", "高领", "单肩", "Cheeky", "String", "Micro", "长身版"],
  "图案": ["纯色", "碎花", "条纹", "波点", "豹纹", "动物纹", "佩斯利", "几何", "抽象", "扎染", "格纹", "撞色", "印花", "国旗"],
  "花色": ["黑色", "白色", "红色", "蓝色", "粉色", "紫色", "绿色", "黄色", "橙色", "灰色", "海军蓝", "酒红", "米色", "卡其", "金色", "银色", "红白蓝", "多彩"],
  "功能": ["收腹", "显瘦", "聚拢", "支撑", "钢圈", "防晒", "速干", "耐氯", "胸垫", "可拆卸胸垫", "可调节肩带", "无钢圈", "内衬", "保守", "防滑", "吸湿排汗", "无痕"],
  "码段": ["大码", "孕妇", "小码", "青少年", "高个子", "标准码"],
  "面料": ["棉", "网纱", "尼龙", "氨纶", "涤纶", "莱卡", "再生", "环保", "罗纹", "哑光", "光泽", "钩织"],
  "风格": ["复古", "性感", "运动", "潮流", "极简", "波西米亚", "柔美", "经典", "优雅", "年轻感"],
  "细节": ["侧系带", "蝴蝶结", "蕾丝", "荷叶边", "流苏", "拉链", "抽绳", "透视", "链条", "圆环", "多带", "撞色滚边", "前系带"],
  "场景": ["沙滩", "泳池", "度假", "派对", "蜜月", "亲子", "温泉", "日常", "音乐节", "独立日"],
};

function tagEntries(kw) {
  const out = [];
  for (const dim of TAG_DIMS) {
    const vals = (kw && kw.tags && kw.tags[dim]) || [];
    for (const v of vals) if (v) out.push({ dim, value: String(v) });
  }
  return out;
}

function tagsChipsHtml(kw) {
  const entries = tagEntries(kw);
  if (!entries.length) return '<span class="muted">—</span>';
  return `<span class="tag-chips">${entries.map((e) => `<span class="chip" title="${esc(e.dim)}">${esc(e.dim)}:${esc(e.value)}</span>`).join("")}</span>`;
}

function tagsMatch(kw, selected) {
  if (!selected || !selected.length) return true;
  const entries = tagEntries(kw);
  if (selected.includes("__empty__") && entries.length === 0) return true;
  const vals = new Set(entries.map((e) => e.value));
  return selected.some((v) => v !== "__empty__" && vals.has(v));
}

function tagsText(kw) {
  return tagEntries(kw).map((e) => `${e.dim}${e.value}`).join(" ");
}

function tagValuesFrom(kws) {
  const counts = new Map();
  let empty = 0;
  for (const k of kws) {
    const entries = tagEntries(k);
    if (!entries.length) {
      empty++;
      continue;
    }
    for (const e of entries) {
      counts.set(e.value, (counts.get(e.value) || 0) + 1);
    }
  }
  const out = [...counts.entries()]
    .map(([value, count]) => ({ value, label: `${value} (${count})`, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "zh-CN"));
  out.push({ value: "__empty__", label: `空值 (${empty})`, count: empty });
  return out;
}

function sortCategories(list) {
  return [...list].sort((a, b) => {
    if (a === "General") return 1;
    if (b === "General") return -1;
    return a.localeCompare(b, "zh-CN");
  });
}

function tagInputsHtml(kw) {
  return TAG_DIMS.map((dim) => {
    const cur = ((kw && kw.tags && kw.tags[dim]) || []).join(", ");
    return `<div class="field"><label>${esc(dim)}</label>
      <input data-tag-dim="${esc(dim)}" list="tag-list-${esc(dim)}" value="${esc(cur)}" placeholder="多值用逗号分隔">
      <datalist id="tag-list-${esc(dim)}">${(TAG_SUGGESTIONS[dim] || []).map((v) => `<option value="${esc(v)}">`).join("")}</datalist>
    </div>`;
  }).join("");
}

function readTagInputs(root) {
  const tags = {};
  root.querySelectorAll("[data-tag-dim]").forEach((input) => {
    const dim = input.dataset.tagDim;
    const vals = input.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    if (vals.length) tags[dim] = [...new Set(vals)];
  });
  return tags;
}

function rankOf(kid, wid) {
  return state.db.rankings[kid]?.[wid] ?? null;
}

function volOf(kid, wid) {
  return state.db.volumes[kid]?.[wid] ?? null;
}

function isNewVsPrevWeek(kw, wid) {
  const prev = prevWeekId(wid);
  return rankOf(kw.id, wid) != null && (prev == null || rankOf(kw.id, prev) == null);
}

function metaOf(kid, wid) {
  return state.db.xiyou[kid]?.[wid] || null;
}

function fmt(n) {
  if (n == null || n === "") return "—";
  return Number(n).toLocaleString("en-US");
}

function fmtCompact(n) {
  if (n == null) return "—";
  const v = Number(n);
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(Math.round(v));
}

function rankBadge(rank) {
  if (rank == null) return '<span class="muted">未上榜</span>';
  const cls = rank <= 9999 ? "rank-num green" : "rank-num";
  return `<span class="${cls}">#${fmt(rank)}</span>`;
}

function deltaHtml(prev, cur) {
  if (prev == null || cur == null) return '<span class="muted">—</span>';
  const diff = prev - cur;
  if (diff === 0) return '<span class="badge flat">持平</span>';
  if (diff > 0) return `<span class="badge up">▲ ${fmt(diff)}</span>`;
  return `<span class="badge down">▼ ${fmt(-diff)}</span>`;
}

function volumeDeltaHtml(prev, cur) {
  if (prev == null || cur == null || prev === 0) return '<span class="muted">—</span>';
  const pct = ((cur - prev) / prev) * 100;
  const s = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
  if (pct >= 0) return `<span class="badge up">${s}</span>`;
  return `<span class="badge down">${s}</span>`;
}

function toast(msg, type = "info") {
  const root = $("#toast-root");
  const icon = type === "error" ? "alert-circle" : type === "success" ? "check-circle" : "info";
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<i data-lucide="${icon}"></i><span>${esc(msg)}</span>`;
  root.appendChild(el);
  lucide.createIcons({ attrs: { class: [] } }, el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity .25s";
    setTimeout(() => el.remove(), 260);
  }, 3200);
}

async function api(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  if (method !== "GET" || path !== "/api/state") {
    throw new Error("只读版本：此操作已禁用，仅提供查看");
  }
  return fetchStateWithProgress();
}

const STATE_KEY = "hnStateCache-7d6bff5f7985";

function openStateDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("hnSearchTerms", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("state");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function stateCacheGet() {
  try {
    const db = await openStateDb();
    return await new Promise((resolve) => {
      const tx = db.transaction("state", "readonly");
      const req = tx.objectStore("state").get(STATE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function stateCacheSet(value) {
  try {
    const db = await openStateDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("state", "readwrite");
      tx.objectStore("state").put(value, STATE_KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}

function showLoadProgress(text) {
  const el = document.querySelector("#load-status");
  if (!el) return;
  el.hidden = false;
  el.textContent = text;
}

async function fetchStateWithProgress() {
  const resp = await fetch("./data/state.json.gz");
  if (!resp.ok) throw new Error(`数据快照加载失败 ${resp.status}`);
  const enc = (resp.headers.get("Content-Encoding") || "").toLowerCase();
  if (enc.includes("gzip")) return resp.json();
  const total = Number(resp.headers.get("Content-Length") || 0);
  const reader = resp.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total) {
      const pct = Math.min(100, Math.round((received / total) * 100));
      showLoadProgress(`数据加载中 ${pct}%，约 ${(received / 1048576).toFixed(1)} MB / ${(total / 1048576).toFixed(1)} MB`);
    }
  }
  const buf = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.length;
  }
  const stream = new Response(buf).body.pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).json();
}

async function uploadFile(path, file, fields = {}) {
  const headers = {
    "content-type": "application/octet-stream",
    "x-file-name": encodeURIComponent(file.name || "upload.xlsx"),
  };
  for (const [key, value] of Object.entries(fields)) {
    headers[`x-${key.replace(/[A-Z]/g, (ch) => "-" + ch.toLowerCase())}`] = encodeURIComponent(String(value));
  }
  const resp = await fetch(apiUrl(path), { method: "POST", headers, body: file });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `请求失败 ${resp.status}`);
  return data;
}

async function loadDB() {
  const cached = await stateCacheGet();
  if (cached && cached.db) {
    state.db = cached.db;
    applyDefaults();
    refreshStateInBackground();
    return;
  }
  state.db = await fetchStateWithProgress();
  applyDefaults();
  await stateCacheSet({ db: state.db, ts: Date.now() });
}

function applyDefaults() {
  if (!state.weekId || !state.db.weeks[state.weekId]) {
    state.weekId = weekIds().at(-1);
  }
  if (!state.xiyouWeekId) state.xiyouWeekId = state.weekId;
}

async function refreshStateInBackground() {
  try {
    const fresh = await fetchStateWithProgress();
    await stateCacheSet({ db: fresh, ts: Date.now() });
    state.db = fresh;
    applyDefaults();
    render();
    const loadEl = document.querySelector("#load-status");
    if (loadEl) loadEl.hidden = true;
  } catch {}
}

function initIcons(root = document) {
  if (window.lucide) lucide.createIcons({ attrs: { class: [] } }, root);
}

async function initXiyouStatus() {
  const el = document.querySelector("#xiyou-status");
  if (!el) return;
  try {
    const resp = await fetch("/api/xiyou/tools");
    if (!resp.ok) {
      el.hidden = true;
      return;
    }
    const r = await resp.json().catch(() => ({}));
    if (r.ok && r.configured) {
      el.className = "xiyou-status green";
      el.innerHTML = '<i data-lucide="Wifi"></i>西柚MCP已接入';
    } else {
      el.className = "xiyou-status amber";
      el.innerHTML = '<i data-lucide="WifiOff"></i>西柚MCP未配置';
    }
    el.hidden = false;
    initIcons(el);
  } catch (e) {
    el.hidden = true;
  }
}

function render() {
  if (!state.db) return;
  // 重渲染前记录当前聚焦的输入框与光标位置，渲染后恢复，避免输入被打断
  const activeEl = document.activeElement;
  const focusInfo =
    activeEl && activeEl.id && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")
      ? { id: activeEl.id, start: activeEl.selectionStart, end: activeEl.selectionEnd }
      : null;
  const years = [...new Set(weekIds().map((wid) => wid.slice(0, 4)))].sort();
  const yearSel = $("#year-select");
  if (yearSel) {
    yearSel.innerHTML = years.map((y) => `<option value="${y}">${y}年</option>`).join("");
    if (!state.year || !years.includes(state.year)) state.year = years.at(-1);
    yearSel.value = state.year;
  }
  const yearWeeks = weekIds().filter((wid) => !state.year || wid.startsWith(state.year));
  if (!state.weekId || !yearWeeks.includes(state.weekId)) state.weekId = yearWeeks.at(-1);
  const select = $("#week-select");
  select.innerHTML = yearWeeks
    .map((wid) => {
      const w = state.db.weeks[wid];
      const vol = w.volumeSource ? " · 有搜索量" : "";
      return `<option value="${wid}" ${wid === state.weekId ? "selected" : ""}>${esc(w.label)}${vol}</option>`;
    })
    .join("");
  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.view === state.view);
  });
  document.querySelector('[data-view="update"]')?.remove();
  document.querySelector('[data-view="xiyou"]')?.remove();
  const root = $("#view-root");
  if (state.view === "overview") root.innerHTML = viewOverview();
  else if (state.view === "library") root.innerHTML = viewLibrary();
  else if (state.view === "update") root.innerHTML = viewUpdate();
  else if (state.view === "xiyou") root.innerHTML = viewXiyou();
  bindViewEvents(root);
  initIcons(root);
  if (focusInfo) {
    const el = document.getElementById(focusInfo.id);
    if (el) {
      el.focus();
      try { el.setSelectionRange(focusInfo.start, focusInfo.end); } catch (e) { /* number 等输入不支持 selection */ }
    }
  }
}

function viewOverview() {
  const wid = state.weekId;
  const prev = prevWeekId(wid);
  const active = state.db.keywords.filter((k) => k.active !== false);
  const focusSet = new Set(
    (state.db.settings?.focusBrands || []).map((b) => String(b).toLowerCase().trim())
  );
  const focusBrands = state.db.settings?.focusBrands || [];
  const cats = sortCategories([...new Set(active.map((k) => k.categoryWord).filter(Boolean))]);
  const tagVals = tagValuesFrom(active);
  const filtered = active.filter((k) =>
    brandMatches(k, state.overviewBrands) &&
    exactMatches(k.categoryWord, state.overviewCategories) &&
    tagsMatch(k, state.overviewTags)
  );
  const focusCount = filtered.filter((k) => focusSet.has(String(k.brand || "").toLowerCase().trim())).length;
  const ranked = filtered.filter((k) => rankOf(k.id, wid) != null);
  const rankedPrev = prev ? filtered.filter((k) => rankOf(k.id, prev) != null).length : null;
  const volMatched = filtered.filter((k) => volOf(k.id, wid) != null).length;
  const weekHasVol = volMatched > 0;
  const newlyAdded = filtered.filter((k) => isNewVsPrevWeek(k, wid)).length;
  const newWeeks = Object.keys(state.db.weeks).filter((x) => x > wid).length;

  const topAll = ranked
    .map((k) => ({ k, rank: rankOf(k.id, wid) }))
    .filter((x) => x.rank <= 9999)
    .sort((a, b) => a.rank - b.rank);
  const topRows = topAll.slice(0, 500);
  const moverBase = state.moverBaseWeek && state.db.weeks[state.moverBaseWeek]
    ? state.moverBaseWeek
    : prev;
  const moverCur = state.moverCurWeek && state.db.weeks[state.moverCurWeek]
    ? state.moverCurWeek
    : wid;
  const movers = filtered
    .map((k) => {
      const r = rankOf(k.id, moverCur);
      const p = rankOf(k.id, moverBase);
      return { k, r, p, ratio: r != null && p != null && r > 0 && p > r ? p / r : null };
    })
    .filter((x) => x.ratio != null && x.r <= 250000);
  const moverSortKey = state.moverSort?.key || "ratio";
  const moverSortDir = state.moverSort?.dir || (moverSortKey === "ratio" ? -1 : 1);
  movers.sort((a, b) => {
    if (moverSortKey === "baseRank") {
      return moverSortDir * ((a.p ?? Number.MAX_SAFE_INTEGER) - (b.p ?? Number.MAX_SAFE_INTEGER));
    }
    if (moverSortKey === "curRank") {
      return moverSortDir * ((a.r ?? Number.MAX_SAFE_INTEGER) - (b.r ?? Number.MAX_SAFE_INTEGER));
    }
    return moverSortDir * ((a.ratio ?? 0) - (b.ratio ?? 0));
  });

  const volWeeks = weekIds().filter((x) => filtered.some((k) => volOf(k.id, x) != null));
  let volRangeStart = state.volFromWeek || volWeeks.slice(-12)[0] || volWeeks[0];
  let volRangeEnd = state.volToWeek || volWeeks.at(-1);
  if (volRangeStart && volRangeEnd && volRangeStart > volRangeEnd) {
    volRangeEnd = volRangeStart;
  }
  const volRange = volWeeks.filter((x) => x >= volRangeStart && x <= volRangeEnd);
  const volSums = volRange
    .map((x) => ({ wid: x, sum: filtered.reduce((a, k) => a + (volOf(k.id, x) || 0), 0) }));

  const stats = [
    { label: "词库词数", value: fmt(filtered.length), icon: "database", extra: `共 ${state.db.keywords.length} 条词库 · 白名单品牌 ${focusCount} 词` },
    { label: "当周上榜", value: fmt(ranked.length), icon: "trending-up", extra: rankedPrev == null ? "" : ranked.length - rankedPrev > 0 ? `<span class="up">+${ranked.length - rankedPrev}</span> 较上周变化` : ranked.length - rankedPrev < 0 ? `<span class="down">${ranked.length - rankedPrev}</span> 较上周变化` : "与上周持平" },
    { label: "搜索量已匹配", value: fmt(volMatched), icon: "search", extra: weekHasVol ? `覆盖率 ${filtered.length ? Math.round((volMatched / filtered.length) * 100) : 0}%` : "西柚数据待更新（预计周三）" },
    { label: "本周新增", value: fmt(newlyAdded), icon: "plus-circle", extra: "当周有排名、上周无排名" },
  ];

  return `
    <section class="view">
      <div class="view-head">
        <div>
          <h2>总览 <span class="muted" style="font-size:14px">· ${esc(weekLabel(wid))}</span></h2>
          <p>女装泳装类目周度 ABA 排名与搜索量变化 · 白名单品牌 ${fmt(focusCount)} 词 · ${state.db.weeks[wid]?.volumeSource === "xiyou" ? "搜索量来自西柚" : weekHasVol ? "搜索量来自人工登记" : "搜索量待西柚更新"}</p>
        </div>
        <div class="view-actions">
          ${multiFilterHtml("品牌", focusBrands, state.overviewBrands, "overview-brands")}
          ${multiFilterHtml("类目词", cats, state.overviewCategories, "overview-cats")}
          ${multiFilterHtml("属性标签", tagVals, state.overviewTags, "overview-tags")}
        </div>
      </div>
      <div class="grid-stats">
        ${stats.map((s) => `
          <div class="stat">
            <div class="k"><i data-lucide="${s.icon}"></i>${esc(s.label)}</div>
            <div class="v">${s.value}</div>
            <div class="d">${s.extra || ""}</div>
          </div>`).join("")}
      </div>

      <div class="panel">
          <div class="panel-head">
            <h3>当周 ABA 排名 TOP（1 万以内）</h3>
            <span class="sub">${topAll.length > topRows.length ? `显示 ${fmt(topRows.length)} / 共 ${fmt(topAll.length)} 词` : `共 ${fmt(topRows.length)} 词`} · 点击行查看历史趋势</span>
          </div>
          <div class="table-wrap">
            <table class="data">
              <thead><tr>
                <th>排名</th><th>关键词</th><th>类目词</th><th>属性标签</th>
                <th class="num">当周搜索量</th><th class="num">搜索量环比</th><th class="num">排名变动</th><th>近12周趋势</th>
              </tr></thead>
              <tbody>
                ${topRows.map(({ k, rank }) => {
                  const p = rankOf(k.id, prev);
                  const v = volOf(k.id, wid);
                  const pv = prev ? volOf(k.id, prev) : null;
                  return `<tr class="clickable" data-action="open-keyword" data-id="${k.id}">
                    <td>${rankBadge(rank)}</td>
                    <td class="kw-cell"><div class="main">${esc(k.keyword)}</div><div class="sub">${esc(k.translation)}${k.source === "weekly" ? '<span class="tag">周度导入</span>' : ""}</div></td>
                    <td>${esc(k.categoryWord || "—")}</td>
                    <td>${tagsChipsHtml(k)}</td>
                    <td class="num"><strong>${fmt(v)}</strong></td>
                    <td class="num">${volumeDeltaHtml(pv, v)}</td>
                    <td class="num">${deltaHtml(p, rank)}</td>
                    <td>${sparklineHtml(k.id)}</td>
                  </tr>`;
                }).join("") || emptyRow(8, "当周还没有上榜数据，去“周度更新”导入亚马逊后台下载的服装类目词")}
              </tbody>
            </table>
          </div>
      </div>
      <div class="sub-grid" style="margin-top:16px">
        <div class="panel">
          <div class="panel-head">
            <h3>自定义周度对比</h3>
            <span class="sub">上升词全部展示 · 当前周排名 25 万以内</span>
          </div>
          <div class="panel-head" style="border-bottom:0;padding-top:8px;flex-wrap:wrap">
            <span class="hstack" style="gap:6px">
              <span class="muted sm">对比周</span>
              <select class="select" id="mover-base">
                ${weekIds().map((x) => `<option value="${x}" ${x === moverBase ? "selected" : ""}>${esc(weekOptionLabel(x))}</option>`).join("")}
              </select>
              <span class="muted">→</span>
              <select class="select" id="mover-cur">
                ${weekIds().map((x) => `<option value="${x}" ${x === moverCur ? "selected" : ""}>${esc(weekOptionLabel(x))}</option>`).join("")}
              </select>
              <span class="muted sm">当前周</span>
            </span>
          </div>
          <div class="panel-body">
            ${movers.length ? `
              <div class="mover-list">
                <div class="mover-head">
                  <span>关键词</span>
                  ${moverSortButton("baseRank", "对比周")}
                  ${moverSortButton("curRank", "当前周")}
                  ${moverSortButton("ratio", "上升幅度")}
                </div>
                ${movers.map(({ k, r, p, ratio }) => `
                  <div class="mover-row clickable" data-action="open-keyword" data-id="${k.id}" title="点击查看历史趋势">
                    <span class="label" title="${esc(k.keyword)}">${esc(k.keyword)}</span>
                    <span class="ranks"><b>#${fmt(p)}</b></span>
                    <span class="ranks"><b class="cur">#${fmt(r)}</b></span>
                    <span class="badge up">▲ ${ratio.toFixed(2)}x</span>
                  </div>`).join("")}
              </div>
            ` : '<div class="empty">当前周排名 25 万内暂无上升词</div>'}
          </div>
        </div>
        <div class="panel">
          <div class="panel-head"><h3>周度搜索量合计</h3><span class="sub">按当前筛选 · 自定义区间</span></div>
          <div class="panel-head" style="border-bottom:0;padding-top:8px;flex-wrap:wrap">
            <span class="hstack" style="gap:6px">
              <span class="muted sm">起始周</span>
              <select class="select" id="vol-from">
                ${volWeeks.map((x) => `<option value="${x}" ${x === volRangeStart ? "selected" : ""}>${esc(weekOptionLabel(x))}</option>`).join("")}
              </select>
              <span class="muted">→</span>
              <select class="select" id="vol-to">
                ${volWeeks.map((x) => `<option value="${x}" ${x === volRangeEnd ? "selected" : ""}>${esc(weekOptionLabel(x))}</option>`).join("")}
              </select>
              <span class="muted sm">结束周</span>
            </span>
          </div>
          <div class="panel-body">${volumeTrendSvg(volSums)}</div>
        </div>
      </div>
    </section>`;
}

function volumeTrendSvg(volSums) {
  if (volSums.length < 2) {
    return `<div class="empty">累计至少两个周期后显示趋势</div>`;
  }
  const max = Math.max(1, ...volSums.map((x) => x.sum));
  const n = volSums.length;
  const w = Math.max(660, 90 + n * 14);
  const h = 230;
  const padL = 58;
  const padR = 24;
  const padB = 52;
  const padT = 34;
  const slot = (w - padL - padR) / n;
  const bw = Math.min(24, Math.max(5, slot * 0.62));
  const xAt = (i) => padL + slot * (i + 0.5);
  const yAt = (value) => h - padB - (value / max) * (h - padT - padB);
  const dateLabel = (wid) => {
    const [year, month, day] = wid.split("-").map(Number);
    return `${year}/${month}/${day}`;
  };
  const grid = [0, 0.5, 1]
    .map((ratio) => {
      const y = yAt(max * ratio);
      return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}" y2="${y.toFixed(1)}" stroke="#e9edf1" stroke-width="1"></line>
        <text x="${padL - 8}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#7c8591">${fmtCompact(max * ratio)}</text>`;
    })
    .join("");
  const labelCount = Math.min(7, n);
  const labelIndexes = [...new Set(Array.from({ length: labelCount }, (_, i) =>
    Math.round((i * (n - 1)) / Math.max(1, labelCount - 1))
  ))];
  const xLabels = labelIndexes
    .map((i) => `<text x="${xAt(i).toFixed(1)}" y="${h - 16}" text-anchor="middle" font-size="9" fill="#667085">${dateLabel(volSums[i].wid)}</text>`)
    .join("");
  const maxIndex = volSums.reduce((best, item, index) => item.sum > volSums[best].sum ? index : best, 0);
  const valueIndexes = [...new Set([maxIndex, n - 1])];
  const bars = volSums
    .map((x, i) => {
      const y = yAt(x.sum);
      const isLatest = i === n - 1;
      const fill = isLatest ? "#ff9900" : "#2b9a99";
      const valueText = valueIndexes.includes(i)
        ? `<text x="${xAt(i).toFixed(1)}" y="${Math.max(padT - 8, y - 6).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="650" fill="#24313f" paint-order="stroke" stroke="#fff" stroke-width="3" stroke-linejoin="round">${fmtCompact(x.sum)}</text>`
        : "";
      return `<rect class="volume-bar ${isLatest ? "latest selected" : ""}" data-wid="${x.wid}" data-date="${dateLabel(x.wid)}" data-value="${x.sum}" tabindex="0" role="button" aria-label="${dateLabel(x.wid)} 搜索量合计 ${fmt(x.sum)}" x="${(xAt(i) - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, h - padB - y).toFixed(1)}" rx="2.5" fill="${fill}" opacity="${isLatest ? "1" : "0.82"}"></rect>${valueText}`;
    })
    .join("");
  const latest = volSums.at(-1);
  return `<div class="volume-chart-scroll">
    <svg class="svg-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="周度搜索量合计">
      ${grid}<line x1="${padL}" y1="${h - padB}" x2="${w - padR}" y2="${h - padB}" stroke="#d9dde3" stroke-width="1"></line>
      ${bars}${xLabels}
      <text x="${padL}" y="16" font-size="9" fill="#8a929c">周期起始日期</text>
    </svg>
  </div>
  <div class="volume-chart-readout" id="volume-chart-readout">
    <strong>${dateLabel(latest.wid)}</strong><span>搜索量合计 ${fmt(latest.sum)}</span>
  </div>`;
}

function sparklineHtml(kid) {
  const ids = weekIds().slice(-12);
  const pts = ids.map((w, i) => ({ w, i, v: rankOf(kid, w) }));
  const vals = pts.filter((p) => p.v != null).map((p) => p.v);
  if (vals.length < 2) return '<span class="muted">—</span>';
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = Math.max(1, max - min);
  const W = 80;
  const H = 30;
  const P = 3;
  let path = "";
  let pen = false;
  for (const p of pts) {
    const x = P + (p.i * (W - P * 2)) / Math.max(1, ids.length - 1);
    if (p.v == null) {
      pen = false;
      continue;
    }
    const y = P + ((p.v - min) / span) * (H - P * 2);
    path += `${pen ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    pen = true;
  }
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <path d="${path}" fill="none" stroke="#0e7f82" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"></path>
  </svg>`;
}

function emptyRow(cols, text) {
  return `<tr><td colspan="${cols}"><div class="empty">${esc(text)}</div></td></tr>`;
}

function sortValue(k, key) {
  const wid = state.weekId;
  const pw = prevWeekId(wid);
  switch (key) {
    case "keyword": return String(k.keyword || "").toLowerCase();
    case "brand": return String(k.brand || "").toLowerCase();
    case "category": return k.categoryWord || "";
    case "rank": {
      const v = rankOf(k.id, wid);
      return v == null ? null : v;
    }
    case "rankChange": {
      const c = rankOf(k.id, wid);
      const p = pw ? rankOf(k.id, pw) : null;
      return c == null || p == null ? null : p - c;
    }
    case "volume": {
      const v = volOf(k.id, wid);
      return v == null ? null : v;
    }
    case "volChange": {
      const c = volOf(k.id, wid);
      const p = pw ? volOf(k.id, pw) : null;
      return c == null || p == null || p === 0 ? null : (c - p) / p;
    }
    default: return String(k.keyword || "").toLowerCase();
  }
}

function sortableTh(key, label, num = false) {
  const active = state.sort.key === key;
  const arrow = active ? (state.sort.dir === 1 ? " ▲" : " ▼") : "";
  return `<th class="${num ? "num " : ""}sortable" data-sort="${key}" title="点击排序">${label}${arrow}</th>`;
}

function moverSortButton(key, label) {
  const active = state.moverSort?.key === key;
  const arrow = active ? (state.moverSort.dir === 1 ? " ▲" : " ▼") : "";
  return `<button class="mover-sort-btn ${active ? "active" : ""}" type="button" data-mover-sort="${key}">${label}${arrow}</button>`;
}

function viewLibrary() {
  const f = state.filter;
  const cats = sortCategories([...new Set(state.db.keywords.map((k) => k.categoryWord).filter(Boolean))]);
  const tagVals = tagValuesFrom(state.db.keywords);
  const focusBrands = state.db.settings?.focusBrands || [];
  const focusSet = new Set(focusBrands.map((b) => String(b).toLowerCase().trim()));
  const q = f.q.toLowerCase();
  const rows = state.db.keywords.filter((k) => {
    if (!exactMatches(k.categoryWord, f.categories)) return false;
    if (!tagsMatch(k, f.tags)) return false;
    if (f.weeklyNew && !isNewVsPrevWeek(k, state.weekId)) return false;
    if (!brandMatches(k, f.brands)) return false;
    const rmin = f.rankMin === "" || f.rankMin == null ? null : Number(f.rankMin);
    const rmax = f.rankMax === "" || f.rankMax == null ? null : Number(f.rankMax);
    if (rmin != null || rmax != null) {
      const r = rankOf(k.id, state.weekId);
      if (r == null) return false;
      if (rmin != null && r < rmin) return false;
      if (rmax != null && r > rmax) return false;
    }
    if (!q) return true;
    return [k.keyword, k.translation, k.brand, k.categoryWord, tagsText(k)].some((s) => String(s || "").toLowerCase().includes(q));
  });
  if (state.sort.key) {
    rows.sort((a, b) => {
      const va = sortValue(a, state.sort.key);
      const vb = sortValue(b, state.sort.key);
      const na = va == null;
      const nb = vb == null;
      if (na && nb) return 0;
      if (na) return 1;
      if (nb) return -1;
      if (typeof va === "string" || typeof vb === "string") {
        return state.sort.dir * String(va).localeCompare(String(vb), "en");
      }
      return state.sort.dir * (va - vb);
    });
  }
  const pageSize = 100;
  const shown = rows.slice(0, state.libraryPage * pageSize);
  const presetMatch =
    f.rankMin === "1" && [10000, 100000, 250000, 500000, 1000000].includes(Number(f.rankMax))
      ? String(f.rankMax)
      : "";
  const customRank = f.rankCustom || (!presetMatch && (f.rankMin !== "" || f.rankMax !== ""));
  const presetVal = customRank ? "custom" : presetMatch;
  return `
    <section class="view">
      <div class="view-head">
        <div>
          <h2>关键词库</h2>
          <p>${fmt(state.db.keywords.length)} 个女装泳装词 · 点击行查看周度历史（只读快照）</p>
        </div>
        <div class="view-actions">
          <button class="btn ${f.weeklyNew ? "active" : ""}" data-action="toggle-library-weekly-new" title="仅显示当周有排名、上周无排名的新增词">
            <i data-lucide="filter"></i>周度新增
          </button>
        </div>
      </div>
      <div class="panel">
        <div class="toolbar">
          <div class="search"><i data-lucide="search"></i><input id="lib-q" placeholder="搜索关键词、翻译、品牌..." value="${esc(f.q)}"></div>
          ${multiFilterHtml("类目词", cats, f.categories, "library-cats")}
          ${multiFilterHtml("属性标签", tagVals, f.tags, "library-tags")}
          ${multiFilterHtml("品牌", state.db.settings?.focusBrands || [], f.brands, "library")}
          <div class="rank-filter" title="按当周 ABA 排名区间筛选">
            <select class="select" id="lib-rank-preset">
              <option value="">全部排名</option>
              <option value="10000" ${presetVal === "10000" ? "selected" : ""}>1万以内</option>
              <option value="100000" ${presetVal === "100000" ? "selected" : ""}>10万以内</option>
              <option value="250000" ${presetVal === "250000" ? "selected" : ""}>25万以内</option>
              <option value="500000" ${presetVal === "500000" ? "selected" : ""}>50万以内</option>
              <option value="1000000" ${presetVal === "1000000" ? "selected" : ""}>100万以内</option>
              <option value="custom" ${presetVal === "custom" ? "selected" : ""}>自定义</option>
            </select>
            <span class="rank-custom" id="lib-rank-custom" ${customRank ? "" : "hidden"}>
              <input type="number" id="lib-rank-min" min="1" step="1" placeholder="最小" value="${esc(f.rankMin)}">
              <span class="muted">—</span>
              <input type="number" id="lib-rank-max" min="1" step="1" placeholder="最大" value="${esc(f.rankMax)}">
            </span>
          </div>
          <div class="spacer"></div>
          <button class="btn" data-action="reset-filters"><i data-lucide="x"></i>清空</button>
        </div>
        <div class="table-wrap">
          <table class="data library-table">
            <thead><tr>
              ${sortableTh("keyword", "关键词")}${sortableTh("brand", "品牌")}${sortableTh("category", "类目词")}<th>属性标签</th>
              ${sortableTh("rank", "当周排名", true)}${sortableTh("rankChange", "排名变动", true)}${sortableTh("volume", "当周搜索量", true)}${sortableTh("volChange", "搜索量环比", true)}
              <th>操作</th>
            </tr></thead>
            <tbody>
              ${shown.map((k) => {
                const r = rankOf(k.id, state.weekId);
                const pw = prevWeekId(state.weekId);
                const p = pw ? rankOf(k.id, pw) : null;
                const v = volOf(k.id, state.weekId);
                const pv = pw ? volOf(k.id, pw) : null;
                const bl = String(k.brand || "").toLowerCase().trim();
                const focus = focusSet.has(bl);
                return `<tr class="clickable" data-action="open-keyword" data-id="${k.id}">
                  <td class="kw-cell"><div class="main">${esc(k.keyword)}</div><div class="sub">${esc(k.translation)}</div></td>
                  <td title="${esc(k.brand || "")}">${esc(k.brand || "—")}${focus ? ' <span class="badge new">重点</span>' : ""}</td>
                  <td>${esc(k.categoryWord || "—")}</td>
                  <td>${tagsChipsHtml(k)}</td>
                  <td class="num">${rankBadge(r)}</td>
                  <td class="num">${deltaHtml(p, r)}</td>
                  <td class="num">${fmt(v)}</td>
                  <td class="num">${volumeDeltaHtml(pv, v)}</td>
                  <td>
                    <div class="hstack" style="gap:4px">
                      <button class="icon-btn" title="复制关键词" data-action="copy-keyword" data-id="${k.id}"><i data-lucide="copy"></i></button>
                    </div>
                  </td>
                </tr>`;
              }).join("") || emptyRow(9, "没有匹配的关键词")}
            </tbody>
          </table>
        </div>
        <div class="pager">
          <span class="info">显示 ${shown.length} / ${rows.length} 条</span>
          ${shown.length < rows.length ? `<button class="btn" data-action="load-more"><i data-lucide="chevron-down"></i>加载更多</button>` : ""}
        </div>
      </div>
    </section>`;
}

function viewUpdate() {
  const d = state.draft;
  if (!d) {
    const lastWid = weekIds().at(-1);
    const last = state.db.weeks[lastWid];
    const nextStart = last && last.endDate ? addDays(last.endDate, 1) : todayStr();
    const nextEnd = addDays(nextStart, 6);
    return `
      <section class="view">
        <div class="view-head">
          <div>
            <h2>周度更新</h2>
            <p>上传亚马逊品牌分析「热门搜索词」服装类目周度文件，自动筛选女装泳装词</p>
          </div>
        </div>
        <div class="steps">
          <span class="step active"><span class="n">1</span>上传文件</span>
          <span class="step"><span class="n">2</span>筛选确认</span>
          <span class="step"><span class="n">3</span>西柚匹配搜索量</span>
          <span class="step"><span class="n">4</span>提交更新</span>
        </div>
        <div class="panel">
          <div class="panel-head"><h3>上传周度搜索词文件</h3><span class="sub">支持 CSV / XLSX</span></div>
          <div class="panel-body">
            <div class="dropzone" id="dropzone">
              <i data-lucide="upload-cloud"></i>
              <div><strong>拖拽文件到这里</strong> 或 <button class="btn" data-action="pick-file" type="button">选择文件</button></div>
              <div class="hint" id="file-name">亚马逊后台下载的服装类目词文件（自动识别中英文表头）</div>
              <input type="file" id="file-input" accept=".csv,.xlsx" hidden>
            </div>
            <div class="form-grid">
              <div class="field">
                <label>周起始日期</label>
                <input type="date" id="week-start" value="${nextStart}">
              </div>
              <div class="field">
                <label>周结束日期</label>
                <input type="date" id="week-end" value="${nextEnd}">
              </div>
              <div class="field">
                <label>新词处理</label>
                <select id="add-new">
                  <option value="true">收录文件中的新女装泳装词</option>
                  <option value="false">仅更新已有词库</option>
                </select>
              </div>
            </div>
            <div class="hstack" style="margin-top:16px">
              <button class="btn primary" data-action="parse-file"><i data-lucide="file-search"></i>解析并自动筛选</button>
            </div>
            <p class="kbd-hint" style="margin-top:10px">提示：文件应包含「搜索词 / Search Term」和「搜索频率排名 / Search Frequency Rank」列。</p>
          </div>
        </div>
      </section>`;
  }

  const inc = d.rows.filter((r) => r.status === "include");
  const cand = d.rows.filter((r) => r.status === "candidate");
  const exc = d.rows.filter((r) => r.status === "exclude");
  const tab = state.reviewTab;
  const list = tab === "include" ? inc : tab === "candidate" ? cand : exc;
  const shownList = list.slice(0, state.reviewLimit);
  return `
    <section class="view">
      <div class="view-head">
        <div>
          <h2>周度更新 <span class="muted" style="font-size:14px">· ${esc(d.weekLabel)}</span></h2>
          <p>文件：${esc(d.fileName)} · 共 ${fmt(d.rows.length)} 个搜索词</p>
        </div>
        <div class="view-actions">
          <button class="btn danger" data-action="discard-draft"><i data-lucide="trash-2"></i>放弃本次更新</button>
        </div>
      </div>
      <div class="steps">
        <span class="step done"><span class="n">1</span>上传文件</span>
        <span class="step active"><span class="n">2</span>筛选确认</span>
        <span class="step"><span class="n">3</span>西柚匹配搜索量</span>
        <span class="step"><span class="n">4</span>提交更新</span>
      </div>

      <div class="chip-row">
        <span class="chip green"><b>${fmt(inc.length)}</b> 收录</span>
        <span class="chip amber"><b>${fmt(cand.length)}</b> 待确认</span>
        <span class="chip red"><b>${fmt(exc.length)}</b> 排除</span>
        ${d.rows.some((r) => r.status === "exclude" && r.excludedFromMemory)
          ? `<span class="chip"><b>${fmt(d.rows.filter((r) => r.status === "exclude" && r.excludedFromMemory).length)}</b> 历史排除记忆</span>`
          : ""}
        <span class="chip"><b>${fmt(d.stats.trackedHits)}</b> 命中已有词库</span>
        <span class="chip"><b>${fmt(d.stats.newKeywords)}</b> 新增词</span>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div class="review-tabs">
            <button class="review-tab ${tab === "include" ? "active" : ""}" data-action="review-tab" data-tab="include">已收录 ${inc.length}</button>
            <button class="review-tab ${tab === "candidate" ? "active" : ""}" data-action="review-tab" data-tab="candidate">待确认 ${cand.length}</button>
            <button class="review-tab ${tab === "exclude" ? "active" : ""}" data-action="review-tab" data-tab="exclude">已排除 ${exc.length}</button>
          </div>
          <div class="hstack">
            ${tab === "candidate" ? `<button class="btn" data-action="bulk-candidate-include"><i data-lucide="check"></i>候选全部收录</button>` : ""}
            ${tab === "candidate" ? `<button class="btn danger" data-action="bulk-candidate-exclude"><i data-lucide="x-circle"></i>候选全部排除</button>` : ""}
            ${tab === "exclude" ? `<button class="btn" data-action="bulk-exclude-candidate"><i data-lucide="rotate-ccw"></i>转回待确认</button>` : ""}
            <button class="btn" data-action="save-review"><i data-lucide="save"></i>保存筛选结果</button>
          </div>
        </div>
        <div class="table-wrap" style="max-height:480px">
          <table class="data">
            <thead><tr>
              <th>搜索词</th><th>匹配情况</th><th class="num">ABA排名</th><th class="num">点击份额</th><th class="num">转化份额</th><th>判定</th>
            </tr></thead>
            <tbody>
              ${shownList.map((r) => `
                <tr>
                  <td class="kw-cell">
                    <div class="main">${esc(r.searchTerm)}${r.isNew ? '<span class="tag">新词</span>' : ""}</div>
                    <div class="sub">${esc((r.reasons || []).join("；"))}</div>
                  </td>
                  <td>${r.matchedPhrase ? `<span class="badge up">命中词库</span> <span class="muted">${esc(r.matchedPhrase)}</span>` : '<span class="muted">未收录</span>'}</td>
                  <td class="num">${fmt(r.rank)}</td>
                  <td class="num">${esc(r.clickShare || "—")}</td>
                  <td class="num">${esc(r.conversionShare || "—")}</td>
                  <td>
                    <div class="seg">
                      <button class="green ${r.status === "include" ? "on" : ""}" data-action="set-status" data-term="${esc(r.searchTerm)}" data-status="include">收录</button>
                      <button class="amber ${r.status === "candidate" ? "on" : ""}" data-action="set-status" data-term="${esc(r.searchTerm)}" data-status="candidate">待确认</button>
                      <button class="red ${r.status === "exclude" ? "on" : ""}" data-action="set-status" data-term="${esc(r.searchTerm)}" data-status="exclude">排除</button>
                    </div>
                  </td>
                </tr>`).join("") || emptyRow(6, "该分类下没有词")}
              ${list.length > shownList.length ? `<tr><td colspan="6" class="num"><button class="btn" data-action="review-more"><i data-lucide="chevron-down"></i>显示更多（共 ${fmt(list.length)} 条，已显示 ${fmt(shownList.length)} 条）</button></td></tr>` : ""}
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel" style="margin-top:16px">
        <div class="panel-head">
          <h3>西柚洞察：匹配当周搜索量</h3>
          <span class="sub">可一键自动查询并导入，也可导出待匹配词手动处理</span>
        </div>
        <div class="panel-body">
          <div class="auto-match-box">
            <div class="hstack">
              <button class="btn primary" data-action="xiyou-auto-match" data-week="${d.weekId}"><i data-lucide="zap"></i>一键自动匹配搜索量</button>
              <span class="kbd-hint">网站直接调用西柚洞察 MCP，自动跳过已有搜索量的词</span>
            </div>
            <div id="xiyou-auto-status"></div>
          </div>
          <div class="hstack">
            <button class="btn" data-action="xiyou-export" data-week="${d.weekId}"><i data-lucide="download"></i>导出全部待匹配词</button>
            <span class="kbd-hint">一次性导出当前周期全部待匹配关键词</span>
          </div>
        </div>
      </div>

      <div class="panel" style="margin-top:16px">
        <div class="panel-head">
          <h3>提交周度更新</h3>
          <span class="sub">将 ${fmt(inc.length)} 个词的 ABA 排名写入 ${esc(d.weekLabel)}</span>
        </div>
        <div class="panel-body">
          <div class="hstack">
            <button class="btn primary" data-action="commit-draft"><i data-lucide="check-circle"></i>提交本周更新</button>
            <span class="kbd-hint">提交后仍可到「西柚匹配」页补导入搜索量</span>
          </div>
        </div>
      </div>
    </section>`;
}

function viewXiyou() {
  const wid = state.xiyouWeekId || state.weekId;
  const active = state.db.keywords.filter((k) => k.active !== false);
  const ranked = active.filter((k) => rankOf(k.id, wid) != null);
  const volMatched = ranked.filter((k) => volOf(k.id, wid) != null).length;
  const noVolume = ranked.filter((k) => volOf(k.id, wid) == null && metaOf(k.id, wid) != null).length;
  const pending = Math.max(0, ranked.length - volMatched - noVolume);
  const w = state.db.weeks[wid];
  return `
    <section class="view">
      <div class="view-head">
        <div>
          <h2>西柚洞察匹配</h2>
          <p>批量查询当周关键词搜索量</p>
        </div>
        <div class="view-actions">
          <button class="btn" data-action="xiyou-export" data-week="${wid}"><i data-lucide="download"></i>导出全部待匹配词</button>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head">
          <h3>选择周期</h3>
          <span class="sub">${w?.volumeSource === "xiyou" ? "该周期已有西柚搜索量" : w?.volumeSource === "manual" ? "该周期已有手动导入搜索量" : "该周期尚未匹配搜索量"}</span>
        </div>
        <div class="panel-body">
          <div class="chip-row" style="margin-top:0">
            <select class="select" id="xiyou-week">
              ${weekIds().map((x) => `<option value="${x}" ${x === wid ? "selected" : ""}>${esc(weekLabel(x))}</option>`).join("")}
            </select>
            <span class="chip"><b>${fmt(ranked.length)}</b> 当周上榜词</span>
            <span class="chip green"><b>${fmt(volMatched)}</b> 已有搜索量</span>
            <button class="chip amber chip-toggle" type="button" data-action="xiyou-pending" data-week="${wid}" aria-expanded="false"><b>${fmt(pending)}</b> 待匹配 <i data-lucide="chevron-down"></i></button>
            ${noVolume ? `<span class="chip" title="西柚已返回该词记录，但 abaReport 为空，无法取得周搜索量"><b>${fmt(noVolume)}</b> 西柚无搜索量</span>` : ""}
          </div>
          <div id="xiyou-pending-list"></div>
          <div class="auto-match-box">
            <div class="hstack">
              <button class="btn primary" data-action="xiyou-auto-match" data-week="${wid}"><i data-lucide="zap"></i>一键自动匹配搜索量</button>
              <span class="kbd-hint">自动查询所有尚未响应的上榜词；西柚已确认无数据的词不会重复消耗积分</span>
            </div>
            <div id="xiyou-auto-status"></div>
          </div>
        </div>
      </div>

      <div class="panel" style="margin-top:16px">
        <div class="panel-head">
          <h3>手动导入周度搜索量</h3>
          <span class="sub">粘贴“关键词,搜索量”文本，或上传包含关键词与搜索量两列的 CSV / Excel</span>
        </div>
        <div class="panel-body">
          <div class="form-grid" style="grid-template-columns:1fr">
            <div class="field">
              <label>粘贴当周关键词与搜索量（每行一个词，逗号或 Tab 分隔）</label>
              <textarea id="manual-volume-paste" placeholder="swimsuit for women,15800&#10;one piece swimsuit,9200"></textarea>
            </div>
          </div>
          <div class="hstack" style="margin-top:10px">
            <button class="btn" type="button" data-action="manual-volume-pick"><i data-lucide="upload"></i>选择 CSV / Excel 文件</button>
            <input type="file" id="manual-volume-file" accept=".csv,.xlsx,text/csv" hidden>
            <span class="kbd-hint" id="manual-volume-file-name">未选择文件（列需为：关键词、搜索量）</span>
          </div>
          <div class="hstack" style="margin-top:10px">
            <button class="btn primary" data-action="manual-volume-import" data-week="${wid}"><i data-lucide="file-input"></i>手动导入当周搜索量</button>
            <span class="kbd-hint">只匹配词库中已有的关键词，未命中的词会列出</span>
          </div>
          <div id="manual-volume-result"></div>
        </div>
      </div>
    </section>`;
}

function bindViewEvents(root) {
  root.querySelectorAll(".tab").forEach(() => {});
  root.querySelectorAll("[data-view]").forEach(() => {});
  root.querySelectorAll("[data-action]").forEach((el) => {
    el.addEventListener("click", (e) => {
      const action = el.dataset.action;
      const id = el.dataset.id;
      const week = el.dataset.week;
      const tab = el.dataset.tab;
      const term = el.dataset.term;
      const status = el.dataset.status;
      if (action === "open-keyword") openKeywordModal(id);
      else if (action === "copy-keyword") { e.stopPropagation(); copyKeyword(id); }
      else if (action === "edit-keyword") { e.stopPropagation(); openKeywordModal(id); }
      else if (action === "delete-keyword") { e.stopPropagation(); deleteKeyword(id); }
      else if (action === "add-keyword") openKeywordModal();
      else if (action === "goto-update") { state.view = "update"; render(); }
      else if (action === "goto-xiyou") { state.view = "xiyou"; render(); }
      else if (action === "toggle-library-weekly-new") {
        state.filter.weeklyNew = !state.filter.weeklyNew;
        if (state.filter.weeklyNew) state.filter.source = "";
        state.libraryPage = 1;
        render();
      }
      else if (action === "load-more") { state.libraryPage += 1; render(); }
      else if (action === "reset-filters") { state.filter = { q: "", categories: [], tags: [], brands: [], rankMin: "", rankMax: "", rankCustom: false, weeklyNew: false }; state.libraryPage = 1; render(); }
      else if (action === "pick-file") $("#file-input").click();
      else if (action === "parse-file") parseFile();
      else if (action === "review-tab") { state.reviewTab = tab; render(); }
      else if (action === "review-more") { state.reviewLimit += 500; render(); }
      else if (action === "set-status") setRowStatus(term, status);
      else if (action === "bulk-candidate-include") bulkStatus("candidate", "include");
      else if (action === "bulk-candidate-exclude") bulkCandidateExclude();
      else if (action === "bulk-exclude-candidate") bulkStatus("exclude", "candidate");
      else if (action === "save-review") saveReview();
      else if (action === "discard-draft") discardDraft();
      else if (action === "commit-draft") commitDraft();
      else if (action === "xiyou-export") xiyouExport(week);
      else if (action === "xiyou-auto-match") xiyouAutoMatch(week);
      else if (action === "xiyou-pending") xiyouPendingToggle(week);
      else if (action === "manual-volume-pick") $("#manual-volume-file")?.click();
      else if (action === "manual-volume-import") manualVolumeImport(week);
    });
  });

  root.querySelectorAll("th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (state.sort.key === key) {
        state.sort.dir = state.sort.dir === 1 ? -1 : 1;
      } else {
        state.sort = { key, dir: 1 };
      }
      state.libraryPage = 1;
      render();
    });
  });

  root.querySelectorAll("[data-mover-sort]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.moverSort;
      if (state.moverSort.key === key) {
        state.moverSort.dir *= -1;
      } else {
        state.moverSort = { key, dir: key === "ratio" ? -1 : 1 };
      }
      render();
    });
  });

  root.querySelectorAll("[data-multi-toggle]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const wrap = btn.closest("[data-multi]");
      const pop = wrap?.querySelector(".multi-pop");
      if (pop) pop.hidden = !pop.hidden;
    });
  });
  root.querySelectorAll("[data-multi-all]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const wrap = btn.closest("[data-multi]");
      wrap?.querySelectorAll("input[type=checkbox]").forEach((c) => (c.checked = true));
    });
  });
  root.querySelectorAll("[data-multi-none]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const wrap = btn.closest("[data-multi]");
      wrap?.querySelectorAll("input[type=checkbox]").forEach((c) => (c.checked = false));
    });
  });
  root.querySelectorAll("[data-multi-apply]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const wrap = btn.closest("[data-multi]");
      if (!wrap) return;
      const vals = [...wrap.querySelectorAll("input[type=checkbox]:checked")].map((c) => c.value);
      if (wrap.dataset.target === "overview-brands") state.overviewBrands = vals;
      else if (wrap.dataset.target === "overview-cats") state.overviewCategories = vals;
      else if (wrap.dataset.target === "overview-tags") state.overviewTags = vals;
      else if (wrap.dataset.target === "library-cats") state.filter.categories = vals;
      else if (wrap.dataset.target === "library-tags") state.filter.tags = vals;
      else state.filter.brands = vals;
      state.libraryPage = 1;
      render();
    });
  });

  const moverBase = root.querySelector("#mover-base");
  const moverCur = root.querySelector("#mover-cur");
  if (moverBase) moverBase.addEventListener("change", () => {
    const ids = weekIds();
    const baseIdx = ids.indexOf(moverBase.value);
    const curIdx = ids.indexOf(state.moverCurWeek || state.weekId);
    state.moverBaseWeek = moverBase.value;
    if (baseIdx >= curIdx) state.moverCurWeek = ids[baseIdx + 1] || moverBase.value;
    render();
  });
  if (moverCur) moverCur.addEventListener("change", () => {
    const ids = weekIds();
    const curIdx = ids.indexOf(moverCur.value);
    const baseIdx = ids.indexOf(state.moverBaseWeek || prevWeekId(state.weekId));
    state.moverCurWeek = moverCur.value;
    if (baseIdx >= curIdx) state.moverBaseWeek = ids[Math.max(0, curIdx - 1)] || moverCur.value;
    render();
  });

  const volFrom = root.querySelector("#vol-from");
  const volTo = root.querySelector("#vol-to");
  const volumeBars = root.querySelectorAll(".volume-bar");
  const volumeReadout = root.querySelector("#volume-chart-readout");
  const selectVolumeBar = (bar) => {
    if (!volumeReadout) return;
    volumeBars.forEach((item) => item.classList.toggle("selected", item === bar));
    volumeReadout.innerHTML = `<strong>${esc(bar.dataset.date || "")}</strong><span>搜索量合计 ${fmt(bar.dataset.value)}</span>`;
  };
  volumeBars.forEach((bar) => {
    bar.addEventListener("click", () => selectVolumeBar(bar));
    bar.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectVolumeBar(bar);
    });
  });
  if (volFrom) volFrom.addEventListener("change", () => {
    state.volFromWeek = volFrom.value;
    if (state.volToWeek && state.volToWeek < state.volFromWeek) state.volToWeek = state.volFromWeek;
    render();
  });
  if (volTo) volTo.addEventListener("change", () => {
    state.volToWeek = volTo.value;
    if (state.volFromWeek && state.volToWeek < state.volFromWeek) state.volFromWeek = state.volToWeek;
    render();
  });

  const q = root.querySelector("#lib-q");
  if (q) {
    // 输入法组词期间不触发重渲染（否则拼音缓冲会被销毁，中文无法正常输入）
    let composing = false;
    const runSearch = debounce(() => {
      if (!q.isConnected) return; // 输入框已被重渲染替换，交给新元素的处理
      state.filter.q = q.value;
      state.libraryPage = 1;
      render();
    }, 220);
    q.addEventListener("compositionstart", () => { composing = true; });
    q.addEventListener("compositionend", () => {
      composing = false;
      runSearch();
    });
    q.addEventListener("input", (e) => {
      if (composing || e.isComposing) return;
      runSearch();
    });
  }
  const rankMinEl = root.querySelector("#lib-rank-min");
  const rankMaxEl = root.querySelector("#lib-rank-max");
  const rankPresetEl = root.querySelector("#lib-rank-preset");
  const applyRank = () => {
    state.filter.rankMin = rankMinEl?.value ?? "";
    state.filter.rankMax = rankMaxEl?.value ?? "";
    state.filter.rankCustom = true;
    state.libraryPage = 1;
    render(); // render() 会保留输入框焦点与光标
  };
  const bindRankInput = (el) => {
    if (!el) return;
    let composing = false;
    el.addEventListener("compositionstart", () => { composing = true; });
    el.addEventListener("compositionend", () => { composing = false; });
    el.addEventListener("input", (e) => {
      if (composing || e.isComposing) return;
      debouncedApplyRank();
    });
  };
  const debouncedApplyRank = debounce(applyRank, 220);
  bindRankInput(rankMinEl);
  bindRankInput(rankMaxEl);  if (rankPresetEl) {
    rankPresetEl.addEventListener("change", () => {
      const v = rankPresetEl.value;
      if (v === "custom") {
        state.filter.rankCustom = true;
        state.libraryPage = 1;
        render();
        return;
      }
      state.filter.rankCustom = false;
      state.filter.rankMin = v ? "1" : "";
      state.filter.rankMax = v;
      state.libraryPage = 1;
      render();
    });
  }

  const yearSel = $("#year-select");
  if (yearSel) {
    yearSel.onchange = () => {
      state.year = yearSel.value;
      const wids = weekIds().filter((w) => w.startsWith(state.year));
      state.weekId = wids.at(-1);
      state.moverBaseWeek = null;
      state.moverCurWeek = null;
      render();
    };
  }

  const weekSel = $("#week-select");
  if (weekSel) {
    weekSel.onchange = () => {
      state.weekId = weekSel.value;
      state.moverBaseWeek = null;
      state.moverCurWeek = null;
      render();
    };
  }

  const xw = root.querySelector("#xiyou-week");
  if (xw) {
    xw.onchange = () => {
      state.xiyouWeekId = xw.value;
      render();
    };
  }

  const dz = root.querySelector("#dropzone");
  if (dz) {
    dz.addEventListener("dragover", (e) => {
      e.preventDefault();
      dz.classList.add("dragover");
    });
    dz.addEventListener("dragleave", () => dz.classList.remove("dragover"));
    dz.addEventListener("drop", (e) => {
      e.preventDefault();
      dz.classList.remove("dragover");
      if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });
    const fi = root.querySelector("#file-input");
    if (fi) fi.addEventListener("change", () => fi.files.length && handleFile(fi.files[0]));
  }

  const mvfi = root.querySelector("#manual-volume-file");
  if (mvfi) mvfi.addEventListener("change", () => mvfi.files.length && handleManualVolumeFile(mvfi.files[0]));
}

let pendingFile = null;
function handleFile(file) {
  pendingFile = file;
  const el = $("#file-name");
  if (el) el.textContent = `已选择：${file.name}（${(file.size / 1024).toFixed(0)} KB）`;
}

let manualVolumeFile = null;
function handleManualVolumeFile(file) {
  manualVolumeFile = file;
  const el = $("#manual-volume-file-name");
  if (el) el.textContent = `已选择：${file.name}（${(file.size / 1024).toFixed(0)} KB）`;
}

async function parseFile() {
  if (!pendingFile) {
    toast("请先选择周度搜索词文件", "error");
    return;
  }
  const start = $("#week-start").value;
  const end = $("#week-end").value;
  if (!start || !end) {
    toast("请填写周起始和结束日期", "error");
    return;
  }
  const addNew = $("#add-new").value === "true";
  const btn = document.querySelector('[data-action="parse-file"]');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2"></i>解析中...';
    initIcons(btn);
  }
  try {
    const draft = await uploadFile("/api/import/aba", pendingFile, {
      weekStart: start,
      weekEnd: end,
      addNewKeywords: addNew,
    });
    state.draft = draft;
    state.reviewTab = "include";
    state.reviewLimit = 250;
    state.xiyouWeekId = draft.weekId;
    pendingFile = null;
    toast(`解析完成：收录 ${draft.stats.include} / 待确认 ${draft.stats.candidate} / 排除 ${draft.stats.exclude}`, "success");
    render();
  } catch (err) {
    toast(err.message, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="file-search"></i>解析并自动筛选';
      initIcons(btn);
    }
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",")[1]);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

function setRowStatus(term, status) {
  const d = state.draft;
  const row = d.rows.find((r) => r.searchTerm === term);
  if (row) {
    row.status = status;
    if (status !== "exclude") row.excludedFromMemory = false;
  }
  render();
}

function bulkStatus(from, to) {
  const d = state.draft;
  for (const r of d.rows) {
    if (r.status !== from) continue;
    r.status = to;
    if (to !== "exclude") r.excludedFromMemory = false;
  }
  render();
}

function bulkCandidateExclude() {
  const d = state.draft;
  const n = d.rows.filter((r) => r.status === "candidate").length;
  if (!n) return;
  if (!confirm(`确认将 ${n} 个待确认词全部排除？可在「已排除」页一键转回待确认。`)) return;
  bulkStatus("candidate", "exclude");
  toast(`已将 ${n} 个待确认词移入排除`, "success");
}

const TEAM_LINK_URL = "https://Mlhz083922.github.io/hn-search-terms-tracking/";

function ensureTeamProgress() {
  let box = $("#team-update-progress");
  if (!box) {
    box = document.createElement("div");
    box.id = "team-update-progress";
    box.className = "team-update-progress";
    box.hidden = true;
    box.innerHTML = `
      <div class="hstack">
        <span id="team-update-label">准备更新...</span>
        <span id="team-update-pct">0%</span>
      </div>
      <div class="progress"><i id="team-update-bar" style="width:0%"></i></div>`;
    const header = document.querySelector("header");
    if (header && header.nextSibling) header.parentNode.insertBefore(box, header.nextSibling);
    else document.body.prepend(box);
  }
  return box;
}

function setTeamProgress(pct, message) {
  const bar = $("#team-update-bar");
  const pctEl = $("#team-update-pct");
  const label = $("#team-update-label");
  if (bar) bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  if (pctEl) pctEl.textContent = `${Math.round(pct)}%`;
  if (label && message) label.textContent = message;
}

async function pollTeamJob(jobId) {
  const box = ensureTeamProgress();
  box.hidden = false;
  for (;;) {
    const job = await api("/api/team-link/status");
    if (!job || job.id !== jobId) {
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    setTeamProgress(job.progress || 0, job.message || job.stage || "更新中...");
    if (job.done) {
      if (!job.ok) throw new Error(job.error || "更新失败");
      return job;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function updateTeamLink() {
  const btn = $("#btn-update-team-link");
  const box = ensureTeamProgress();
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2"></i><span>更新中...</span>';
    initIcons(btn);
  }
  box.hidden = false;
  setTeamProgress(0, "正在创建更新任务...");
  try {
    const res = await api("/api/team-link/update", { method: "POST", body: "{}" });
    const jobId = res.jobId || (res.job && res.job.id);
    if (!jobId) throw new Error(res.error || "无法获取更新任务");
    const job = await pollTeamJob(jobId);
    setTeamProgress(100, job.message || "更新完成");
    toast(job.message || "团队链接已更新", "success");
    showTeamLinkModal({ ...job, link: TEAM_LINK_URL });
  } catch (err) {
    toast(err.message, "error");
  } finally {
    setTimeout(() => { box.hidden = true; }, 1200);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="link-2"></i><span>更新团队链接</span>';
      initIcons(btn);
    }
  }
}

function showTeamLinkModal(res) {
  const link = res.link || TEAM_LINK_URL;
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <div class="modal" style="width:min(560px,100%)">
      <div class="modal-head">
        <h3>团队链接</h3>
        <button class="icon-btn" data-close title="关闭"><i data-lucide="x"></i></button>
      </div>
      <div class="modal-body">
        <p class="muted">${esc(res.message || "")}</p>
        <p><a href="${esc(link)}" target="_blank" rel="noopener">${esc(link)}</a></p>
        ${res.log?.length ? `<details class="publish-details">
          <summary>查看更新日志</summary>
          <pre class="publish-log">${esc(res.log.join("\n\n"))}</pre>
        </details>` : ""}
      </div>
      <div class="modal-foot">
        <button class="btn" data-action="copy-team-link"><i data-lucide="copy"></i>复制链接</button>
        <button class="btn primary" data-action="open-team-link"><i data-lucide="external-link"></i>打开链接</button>
        <button class="btn" data-close>关闭</button>
      </div>
    </div>`;
  $("#modal-root").appendChild(modal);
  initIcons(modal);
  modal.querySelectorAll("input, select").forEach((el) => (el.disabled = true));
  const readOnlySave = modal.querySelector("#save-keyword");
  if (readOnlySave) readOnlySave.hidden = true;
  modal.querySelector('[data-action="copy-team-link"]')?.addEventListener("click", () => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(link)
        .then(() => toast("团队链接已复制", "success"))
        .catch(() => toast("复制失败，请手动复制", "error"));
    } else {
      toast("当前浏览器不支持自动复制，请手动复制", "error");
    }
  });
  modal.querySelector('[data-action="open-team-link"]')?.addEventListener("click", () => {
    window.open(link, "_blank", "noopener");
  });
  modal.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", () => modal.remove()));
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });
}

async function saveReview() {
  if (!state.draft) return;
  try {
    const updates = state.draft.rows.map((r) => ({ searchTerm: r.searchTerm, status: r.status }));
    const draft = await api(`/api/drafts/${state.draft.id}/update`, {
      method: "POST",
      body: JSON.stringify({ rows: updates }),
    });
    state.draft = draft;
    toast("筛选结果已保存", "success");
    render();
  } catch (err) {
    toast(err.message, "error");
  }
}

async function discardDraft() {
  if (!state.draft) return;
  if (!confirm("确认放弃本次周度更新？")) return;
  try {
    await api(`/api/drafts/${state.draft.id}`, { method: "DELETE" });
    state.draft = null;
    toast("已放弃本次更新", "success");
    render();
  } catch (err) {
    toast(err.message, "error");
  }
}

async function commitDraft() {
  if (!state.draft) return;
  if (!confirm("确认提交本周 ABA 排名更新？")) return;
  const btn = document.querySelector('[data-action="commit-draft"]');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2"></i>提交中...';
    initIcons(btn);
  }
  try {
    const rows = state.draft.rows.map((r) => ({ searchTerm: r.searchTerm, status: r.status }));
    const res = await api(`/api/drafts/${state.draft.id}/commit`, {
      method: "POST",
      body: JSON.stringify({ rows }),
    });
    state.draft = null;
    await loadDB();
    state.weekId = res.weekId;
    toast(`已提交：更新 ${res.updated} 个词，新增 ${res.added} 个词`, "success");
    render();
  } catch (err) {
    toast(err.message, "error");
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="check-circle"></i>提交本周更新';
      initIcons(btn);
    }
  }
}

async function xiyouExport(week) {
  if (!week) week = state.xiyouWeekId || state.weekId;
  try {
    const data = await api(`/api/xiyou/pending?weekId=${week}&all=1&missingOnly=1`);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `xiyou_week_${week}_all.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast(`已一次性导出全部 ${data.total} 个待匹配词`, "success");
    render();
  } catch (err) {
    toast(err.message, "error");
  }
}

function xiyouPendingToggle(week) {
  const box = document.querySelector("#xiyou-pending-list");
  const chip = document.querySelector('[data-action="xiyou-pending"]');
  if (!box) return;
  if (box.dataset.open === "1") {
    box.dataset.open = "0";
    box.innerHTML = "";
    chip?.setAttribute("aria-expanded", "false");
    return;
  }
  const active = state.db.keywords.filter((k) => k.active !== false);
  const pending = active
    .map((k) => ({ k, rank: rankOf(k.id, week) }))
    .filter((x) => x.rank != null && volOf(x.k.id, week) == null && metaOf(x.k.id, week) == null)
    .sort((a, b) => a.rank - b.rank);
  box.dataset.open = "1";
  chip?.setAttribute("aria-expanded", "true");
  box.innerHTML = pending.length
    ? `<div class="panel" style="margin-top:12px">
        <div class="panel-head">
          <h3>待匹配关键词</h3>
          <span class="sub">有当周 ABA 排名，但尚未向西柚发起查询</span>
        </div>
        <div class="table-wrap" style="max-height:420px">
          <table class="data">
            <thead><tr><th>搜索词</th><th class="num">ABA 排名</th></tr></thead>
            <tbody>${pending.map(({ k, rank }) => `<tr><td class="kw-cell">${esc(k.keyword)}</td><td class="num">${rankBadge(rank)}</td></tr>`).join("")}</tbody>
          </table>
        </div>
      </div>`
    : `<div class="chip-row" style="margin-top:12px"><span class="chip green"><b>0</b> 待匹配词</span></div>`;
}

async function manualVolumeImport(week) {
  const weekId = week || $("#xiyou-week")?.value || state.xiyouWeekId || state.weekId;
  const text = document.querySelector("#manual-volume-paste")?.value?.trim() || "";
  if (!text && !manualVolumeFile) {
    toast("请先粘贴关键词与搜索量，或选择 CSV / Excel 文件", "error");
    return;
  }
  const btn = document.querySelector('[data-action="manual-volume-import"]');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2"></i>导入中...';
    initIcons(btn);
  }
  try {
    const body = { weekId };
    if (manualVolumeFile) {
      body.fileName = manualVolumeFile.name;
      body.fileData = await fileToBase64(manualVolumeFile);
    } else {
      body.text = text;
    }
    const res = await api("/api/xiyou/volume-import", {
      method: "POST",
      body: JSON.stringify(body),
    });
    await loadDB();
    render();
    const box = $("#manual-volume-result");
    if (box) {
      box.innerHTML = `<div class="chip-row" style="margin-top:14px">
        <span class="chip green"><b>${fmt(res.matched)}</b> 已写入当周搜索量</span>
        <span class="chip red"><b>${fmt(res.notFound.length)}</b> 未匹配词库</span>
      </div>
      ${res.notFound.length ? `<div class="panel" style="margin-top:10px"><div class="panel-body"><div class="kbd-hint">未匹配词：${esc(res.notFound.slice(0, 20).join("、"))}${res.notFound.length > 20 ? " 等" : ""}</div></div></div>` : ""}`;
    }
    toast(`手动导入完成：${res.matched} 个词已写入`, "success");
  } catch (err) {
    toast(err.message, "error");
  } finally {
    manualVolumeFile = null;
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="file-input"></i>手动导入当周搜索量';
      initIcons(btn);
    }
  }
}

async function xiyouAutoMatch(week) {
  const weekId = week || $("#xiyou-week")?.value || state.xiyouWeekId || state.weekId;
  const getButton = () => document.querySelector('[data-action="xiyou-auto-match"]');
  const getStatusBox = () => document.querySelector("#xiyou-auto-status");
  let box = getStatusBox();
  if (!box) return;
  const restore = () => {
    const btn = getButton();
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="zap"></i>一键自动匹配搜索量';
      initIcons(btn);
    }
  };
  let btn = getButton();
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2"></i>自动匹配中...';
    initIcons(btn);
  }
  box.innerHTML = '<div class="kbd-hint">正在准备待匹配词...</div>';
  let job;
  try {
    job = await api("/api/xiyou/auto-match", {
      method: "POST",
      body: JSON.stringify({ weekId }),
    });
  } catch (err) {
    box.innerHTML = `<div class="chip red"><b>启动失败</b> ${esc(err.message)}</div>`;
    restore();
    return;
  }
  const tick = async () => {
    const cur = await api(`/api/xiyou/jobs/${job.id}`);
    const pct = cur.total ? Math.round((cur.done / cur.total) * 100) : 100;
    box = getStatusBox();
    if (box) {
      box.innerHTML = `
        <div class="chip"><b>${fmt(cur.done)}/${fmt(cur.total)}</b> 词 · 已获取搜索量 ${fmt(cur.matched)} · 无搜索量 ${fmt(cur.noVolumeCount || 0)} · 消耗 ${fmt(cur.costCredits)} 积分</div>
        <div class="progress"><i style="width:${pct}%"></i></div>`;
    }
    return cur;
  };
  try {
    let cur = await tick();
    while (cur.status === "running") {
      await new Promise((r) => setTimeout(r, 1500));
      cur = await tick();
    }
    if (cur.status === "done") {
      await loadDB();
      render();
      box = getStatusBox();
      if (!box) return;
      box.innerHTML = `
        <div class="chip-row" style="margin-top:6px">
          <span class="chip ${cur.stopped === "credits" ? "amber" : "green"}"><b>${cur.stopped === "credits" ? "已暂停" : "匹配完成"}</b></span>
          <span class="chip green"><b>${fmt(cur.matched)}</b> 已获取搜索量</span>
          ${cur.noVolumeCount ? `<span class="chip"><b>${fmt(cur.noVolumeCount)}</b> 西柚无搜索量</span>` : ""}
          ${cur.stopped === "credits" ? '<span class="chip red">西柚积分不足</span>' : ""}
          <span class="chip"><b>${fmt(cur.costCredits)}</b> 积分</span>
        </div>
        ${cur.noVolume?.length ? `<div class="kbd-hint">西柚已返回记录但无搜索量：${esc(cur.noVolume.slice(0, 10).join("、"))}${cur.noVolumeCount > 10 ? " 等" : ""}</div>` : ""}
        ${cur.notFound.length ? `<div class="kbd-hint">词库未命中：${esc(cur.notFound.slice(0, 10).join("、"))}${cur.notFound.length > 10 ? " 等" : ""}</div>` : ""}`;
      toast(
        cur.stopped === "credits"
          ? `自动匹配暂停：积分不足，已匹配 ${cur.matched} 词`
          : `自动匹配完成：${cur.matched} 词有搜索量，${cur.noVolumeCount || 0} 词西柚无数据`,
        "success"
      );
    } else {
      box = getStatusBox();
      if (box) box.innerHTML = `<div class="chip red"><b>任务失败</b> ${esc(cur.error || "未知错误")}</div>`;
    }
  } catch (err) {
    box = getStatusBox();
    if (box) box.innerHTML = `<div class="chip red"><b>查询失败</b> ${esc(err.message)}</div>`;
  } finally {
    restore();
  }
}

async function deleteKeyword(id) {
  const kw = state.db.keywords.find((k) => k.id === id);
  if (!kw) return;
  if (!confirm(`确认删除关键词「${kw.keyword}」？将同时删除其全部周度排名与搜索量。`)) return;
  try {
    await api(`/api/keywords/${id}`, { method: "DELETE" });
    await loadDB();
    toast("关键词已删除", "success");
    render();
  } catch (err) {
    toast(err.message, "error");
  }
}

async function copyKeyword(id) {
  const kw = state.db.keywords.find((k) => k.id === id);
  if (!kw) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(kw.keyword);
    } else {
      const input = document.createElement("textarea");
      input.value = kw.keyword;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      const copied = document.execCommand("copy");
      input.remove();
      if (!copied) throw new Error("复制失败");
    }
    toast(`已复制：${kw.keyword}`, "success");
  } catch (err) {
    toast("复制失败，请打开详情后手动复制", "error");
  }
}

function keywordHistoryTableHtml(kw, ids) {
  const rows = ids
    .map((wid) => {
      const rank = rankOf(kw.id, wid);
      const volume = volOf(kw.id, wid);
      const prev = prevWeekId(wid);
      return {
        wid,
        rank,
        volume,
        prevRank: prev ? rankOf(kw.id, prev) : null,
        prevVolume: prev ? volOf(kw.id, prev) : null,
      };
    })
    .filter((row) => row.rank != null || row.volume != null)
    .reverse();
  return `<div class="table-wrap detail-history-table">
    <table class="data">
      <thead><tr><th>周期</th><th class="num">ABA 排名</th><th class="num">排名变化</th><th class="num">搜索量</th><th class="num">搜索量环比</th></tr></thead>
      <tbody>${rows.map((row, index) => `
        <tr>
          <td>${esc(weekOptionLabel(row.wid))}${index === 0 ? ' <span class="badge new">最新</span>' : ""}</td>
          <td class="num">${rankBadge(row.rank)}</td>
          <td class="num">${deltaHtml(row.prevRank, row.rank)}</td>
          <td class="num">${fmt(row.volume)}</td>
          <td class="num">${volumeDeltaHtml(row.prevVolume, row.volume)}</td>
        </tr>`).join("") || emptyRow(5, "暂无周度历史数据")}
      </tbody>
    </table>
  </div>`;
}

function keywordTrendKpisHtml(kw) {
  const wid = state.weekId;
  const prev = prevWeekId(wid);
  const rank = rankOf(kw.id, wid);
  const prevRank = prev ? rankOf(kw.id, prev) : null;
  const volume = volOf(kw.id, wid);
  const prevVolume = prev ? volOf(kw.id, prev) : null;
  const observed = weekIds().filter((w) => rankOf(kw.id, w) != null || volOf(kw.id, w) != null);
  const first = observed[0];
  const last = observed.at(-1);
  return `<div class="detail-kpis">
    <div class="detail-kpi">
      <span>当周 ABA 排名</span>
      <strong>${rank == null ? "未上榜" : `#${fmt(rank)}`}</strong>
      <small>${rank == null ? "当前周期暂无排名" : deltaHtml(prevRank, rank)}</small>
    </div>
    <div class="detail-kpi">
      <span>当周搜索量</span>
      <strong>${fmt(volume)}</strong>
      <small>${volumeDeltaHtml(prevVolume, volume)}</small>
    </div>
    <div class="detail-kpi">
      <span>有数据周期</span>
      <strong>${fmt(observed.length)}</strong>
      <small>${first && last ? `${esc(weekOptionLabel(first))} 至 ${esc(weekOptionLabel(last))}` : "暂无历史数据"}</small>
    </div>
  </div>`;
}

function openKeywordModal(kid) {
  const kw = kid ? state.db.keywords.find((k) => k.id === kid) : null;
  const ids = weekIds();
  const focusBrands = state.db.settings?.focusBrands || [];
  const cats = sortCategories([...new Set(state.db.keywords.map((k) => k.categoryWord).filter(Boolean))]);
  for (const c of ["Bikini", "One Piece", "Tankini", "Tankini Top"]) if (!cats.includes(c)) cats.push(c);
  state.modal = {
    kind: kw ? "edit" : "add",
    kid: kw ? kw.id : null,
  };
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <h3>${kw ? `关键词详情 · ${esc(kw.keyword)}` : "手动添加关键词"}</h3>
        <button class="icon-btn" data-close><i data-lucide="x"></i></button>
      </div>
      <div class="modal-body">
        ${kw ? `
          <section class="detail-section detail-trends">
            <div class="detail-section-head">
              <div>
                <span class="detail-eyebrow">周度表现</span>
                <h4>排名与搜索量趋势</h4>
              </div>
              <span class="detail-section-note">点击曲线圆点查看对应周期</span>
            </div>
            ${keywordTrendKpisHtml(kw)}
            ${trendChartsHtml(kw.id)}
            <div class="detail-subhead">
              <h4>周度历史数据</h4>
              <span>按最新周期倒序 · 共 ${fmt(ids.filter((w) => rankOf(kw.id, w) != null || volOf(kw.id, w) != null).length)} 条记录</span>
            </div>
            ${keywordHistoryTableHtml(kw, ids)}
          </section>` : ""}
        <section class="detail-section detail-properties">
          <div class="detail-section-head">
            <div>
              <span class="detail-eyebrow">基础信息</span>
              <h4>品牌、分类与属性标签</h4>
            </div>
          </div>
          <div class="form-grid detail-form-grid">
            <div class="field"><label>品牌</label><input id="edit-brand" list="brand-list" value="${esc(kw?.brand || "")}" placeholder="从白名单选择"></div>
            <div class="field"><label>类目词</label>
              <select id="edit-category">
                <option value="">—</option>
                ${cats.map((c) => `<option ${kw?.categoryWord === c ? "selected" : ""}>${esc(c)}</option>`).join("")}
              </select>
            </div>
            ${tagInputsHtml(kw)}
            <div class="field"><label>关键词</label><input id="edit-keyword" value="${esc(kw?.keyword || "")}" ${kw ? "disabled" : ""}></div>
            <div class="field"><label>关键词翻译</label><input id="edit-translation" value="${esc(kw?.translation || "")}"></div>
            <div class="field"><label>备注</label><input id="edit-notes" value="${esc(kw?.notes || "")}"></div>
          </div>
        </section>
        <datalist id="brand-list">${focusBrands.map((b) => `<option value="${esc(b)}">`).join("")}</datalist>
      </div>
      <div class="modal-foot">
        <button class="btn" data-close>取消</button>
        <button class="btn primary" id="save-keyword"><i data-lucide="save"></i>${kw ? "保存修改" : "添加"}</button>
      </div>
    </div>`;
  modal.addEventListener("click", (e) => {
    if (e.target === modal || e.target.closest("[data-close]")) closeModal();
  });
  $("#modal-root").appendChild(modal);
  initIcons(modal);
  if (kw) {
    const readout = modal.querySelector("#chart-readout");
    if (readout) {
      const setReadout = (wid) => {
        const r = rankOf(kw.id, wid);
        const v = volOf(kw.id, wid);
        readout.innerHTML = `<strong>${esc(weekLabel(wid))}</strong> · ABA 排名 ${rankBadge(r)} · 搜索量 ${fmt(v)}<span class="kbd-hint">（点击曲线上圆点可查看任意周）</span>`;
      };
      modal.querySelectorAll(".chart-point").forEach((pt) => {
        pt.addEventListener("click", (e) => {
          e.stopPropagation();
          setReadout(pt.dataset.wid);
        });
      });
      const lastWid = ids.filter((w) => rankOf(kw.id, w) != null || volOf(kw.id, w) != null).at(-1);
      if (lastWid) setReadout(lastWid);
    }
  }
  const saveBtn = modal.querySelector("#save-keyword");
  saveBtn.addEventListener("click", async () => {
    const body = {
      brand: modal.querySelector("#edit-brand").value.trim(),
      categoryWord: modal.querySelector("#edit-category").value,
      tags: readTagInputs(modal),
      translation: modal.querySelector("#edit-translation").value.trim(),
      notes: modal.querySelector("#edit-notes").value.trim(),
    };
    try {
      if (kw) {
        await api(`/api/keywords/${kw.id}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        body.keyword = modal.querySelector("#edit-keyword").value.trim();
        await api("/api/keywords", { method: "POST", body: JSON.stringify(body) });
      }
      closeModal();
      await loadDB();
      toast("已保存", "success");
      render();
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

function trendChartsHtml(kid) {
  const ids = weekIds();
  const YEAR_PALETTE = ["#ff9900", "#177e89", "#7c3aed", "#64748b"];
  const dataYears = [...new Set(ids.map((w) => w.slice(0, 4)))].map(Number).sort((a, b) => b - a);
  const latestYear = String(dataYears[0] || "");
  const YEAR_STYLE = Object.fromEntries(
    dataYears.map((y, i) => [
      String(y),
      {
        color: YEAR_PALETTE[i % YEAR_PALETTE.length],
        name: `${String(y).slice(2)}年${String(y) === latestYear ? " · 当前" : ""}`,
      },
    ])
  );
  const yearColor = (y) => YEAR_STYLE[y]?.color || "#98a2b3";
  const WEEK_TOTAL = 52;
  const weekOfYear = (dateStr) => {
    const d = new Date(`${dateStr}T00:00:00Z`);
    const start = Date.UTC(d.getUTCFullYear(), 0, 1);
    const dayOfYear = Math.floor((d.getTime() - start) / 86400000);
    return Math.floor(dayOfYear / 7);
  };
  const monthFirstWeek = (year, month1) => {
    const d = new Date(Date.UTC(year, month1 - 1, 1));
    const start = Date.UTC(year, 0, 1);
    const dayOfYear = Math.floor((d.getTime() - start) / 86400000);
    return Math.floor(dayOfYear / 7);
  };
  const mk = (kind) => {
    const pts = ids
      .map((w) => ({
        w,
        v: kind === "rank" ? rankOf(kid, w) : volOf(kid, w),
        weekIdx: weekOfYear(w),
      }))
      .filter((p) => p.v != null);
    if (pts.length < 2) {
      return `<div class="chart-box">
        <div class="chart-box-head"><div><div class="chart-title">${kind === "rank" ? "ABA 排名" : "搜索量"}</div><div class="chart-subtitle">周度变化</div></div></div>
        <div class="empty chart-empty">暂无${kind === "rank" ? "排名" : "搜索量"}趋势数据</div>
      </div>`;
    }
    const W = 460;
    const H = 220;
    const padL = 54;
    const padR = 18;
    const padT = 18;
    const padB = 36;
    const vals = pts.map((p) => (kind === "rank" ? Math.log10(p.v) : p.v));
    const rawMin = Math.min(...vals);
    const rawMax = Math.max(...vals);
    const rawSpan = Math.max(1e-9, rawMax - rawMin);
    const min = kind === "volume"
      ? Math.max(0, rawMin - rawSpan * 0.08)
      : rawMin - rawSpan * 0.08;
    const max = rawMax + rawSpan * 0.08;
    const span = Math.max(1e-9, max - min);
    const x = (weekIdx) => padL + (weekIdx / (WEEK_TOTAL - 1)) * (W - padL - padR);
    const y = (v) =>
      kind === "rank"
        ? padT + ((v - min) / span) * (H - padT - padB)
        : padT + (1 - (v - min) / span) * (H - padT - padB);
    const byYear = {};
    for (const p of pts) {
      const yr = p.w.slice(0, 4);
      (byYear[yr] ||= []).push(p);
    }
    const years = Object.keys(byYear).sort();
    const segmentsFor = (list) => {
      const segments = [];
      let current = [];
      for (const point of list) {
        if (current.length && point.weekIdx - current.at(-1).weekIdx > 1) {
          segments.push(current);
          current = [];
        }
        current.push(point);
      }
      if (current.length) segments.push(current);
      return segments;
    };
    const lineFor = (list) => {
      const points = list.map((p) => ({
        x: x(p.weekIdx),
        y: y(kind === "rank" ? Math.log10(p.v) : p.v),
      }));
      let d = `M${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
      for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const cur = points[i];
        const midX = (prev.x + cur.x) / 2;
        d += ` C${midX.toFixed(1)} ${prev.y.toFixed(1)} ${midX.toFixed(1)} ${cur.y.toFixed(1)} ${cur.x.toFixed(1)} ${cur.y.toFixed(1)}`;
      }
      return d;
    };
    const paths = years
      .flatMap((yr) => segmentsFor(byYear[yr]).map((segment) => ({ yr, segment })))
      .filter(({ segment }) => segment.length >= 2)
      .map(({ yr, segment }) => `<path d="${lineFor(segment)}" fill="none" stroke="${yearColor(yr)}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"></path>`)
      .join("");
    const areas =
      kind === "volume"
        ? years
            .flatMap((yr) => segmentsFor(byYear[yr]).map((segment) => ({ yr, segment })))
            .filter(({ segment }) => segment.length >= 2)
            .map(({ yr, segment }) => {
              const d = lineFor(segment);
              const a = `${d} L${x(segment.at(-1).weekIdx).toFixed(1)} ${H - padB} L${x(segment[0].weekIdx).toFixed(1)} ${H - padB} Z`;
              const fill = yr === latestYear ? `url(#volume-fill-${kid})` : yearColor(yr);
              return `<path d="${a}" fill="${fill}" opacity="${yr === latestYear ? "1" : "0.1"}"></path>`;
            })
            .join("")
        : "";
    const tickValues = Array.from({ length: 4 }, (_, i) => min + (span * i) / 3);
    const gridLines = tickValues
      .map((v) => {
        const yPos = y(v);
        const label = kind === "rank"
          ? `#${fmtCompact(Math.round(Math.pow(10, v)))}`
          : fmtCompact(Math.round(v));
        return `<line x1="${padL}" y1="${yPos.toFixed(1)}" x2="${W - padR}" y2="${yPos.toFixed(1)}" stroke="#edf0f3" stroke-width="1"></line>
          <text x="${padL - 8}" y="${(yPos + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#7c8591">${label}</text>`;
      })
      .join("");
    const weekIdxs = pts.map((p) => weekOfYear(p.w));
    const minWeek = Math.min(...weekIdxs);
    const maxWeek = Math.max(...weekIdxs);
    const refYear = Math.min(...years.map(Number));
    const xTicks = [];
    for (let m = 1; m <= 12; m++) {
      const wk = monthFirstWeek(refYear, m);
      if (wk > maxWeek) break;
      if (wk < minWeek) continue;
      if (m % 2 === 1 || xTicks.length === 0) {
        xTicks.push(`<text x="${x(wk).toFixed(1)}" y="${H - 12}" text-anchor="middle" font-size="9" fill="#7c8591">${m}月</text>`);
      }
    }
    const dots = pts
      .map((p) => {
        const v = kind === "rank" ? Math.log10(p.v) : p.v;
        const tip = kind === "rank" ? `ABA 排名 #${fmt(p.v)}` : `搜索量 ${fmt(p.v)}`;
        return `<circle class="chart-point" data-wid="${p.w}" cx="${x(p.weekIdx).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.2"
          fill="#fff" stroke="${yearColor(p.w.slice(0, 4))}" stroke-width="1.8">
          <title>${esc(weekLabel(p.w))}：${tip}</title>
        </circle>`;
      })
      .join("");
    const latest = pts.at(-1);
    const latestLabel = kind === "rank" ? `#${fmt(latest.v)}` : fmtCompact(latest.v);
    const defs = kind === "volume"
      ? `<defs><linearGradient id="volume-fill-${kid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${yearColor(latestYear)}" stop-opacity="0.18"></stop>
          <stop offset="100%" stop-color="${yearColor(latestYear)}" stop-opacity="0.01"></stop>
        </linearGradient></defs>`
      : "";
    return `<div class="chart-box">
      <div class="chart-box-head">
        <div><div class="chart-title">${kind === "rank" ? "ABA 排名" : "搜索量"}</div><div class="chart-subtitle">${kind === "rank" ? "对数刻度 · 排名越低越好" : "周度搜索量变化"}</div></div>
        <span class="chart-latest">最新 ${latestLabel}</span>
      </div>
      <svg class="trend-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${kind === "rank" ? "ABA 排名趋势图" : "搜索量趋势图"}">
        ${defs}${gridLines}${areas}${paths}${dots}
        <line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="#d9dde3" stroke-width="1"></line>
        ${xTicks.join("")}
      </svg>
    </div>`;
  };
  const legend = dataYears
    .map((yr) => `<span class="chart-legend"><i style="background:${yearColor(String(yr))}"></i>${YEAR_STYLE[String(yr)]?.name || yr}</span>`)
    .join("");
  return `<div class="chart-readout" id="chart-readout"></div>
    <div class="chart-legend-row">${legend}</div>
    <div class="chart-grid">${mk("rank")}${mk("volume")}</div>`;
}

function closeModal() {
  $("#modal-root").innerHTML = "";
  state.modal = null;
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

document.addEventListener("click", (e) => {
  document.querySelectorAll(".multi-pop:not([hidden])").forEach((pop) => {
    const wrap = pop.closest("[data-multi]");
    if (!wrap || !wrap.contains(e.target)) pop.hidden = true;
  });
});

document.querySelectorAll(".tab").forEach((t) => {
  t.addEventListener("click", () => {
    state.view = t.dataset.view;
    render();
  });
});

$("#btn-refresh")?.addEventListener("click", async () => {
  const btn = $("#btn-refresh");
  if (btn) btn.disabled = true;
  try {
    await loadDB();
    render();
    initXiyouStatus();
    toast("已刷新", "success");
  } catch (err) {
    toast("刷新失败: " + err.message, "error");
  } finally {
    if (btn) btn.disabled = false;
  }
});

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildKeywordsCsv() {
  if (!state.db) return "";
  const wid = state.weekId;
  const prev = prevWeekId(wid);
  const weeks = weekIds();
  const header = [
    "关键词",
    "关键词翻译",
    "品牌",
    "类目词",
    "属性标签",
    "当周ABA排名",
    "排名变动",
    "当周搜索量",
    "搜索量环比",
  ];
  for (const weekId of weeks) {
    header.push(`${weekOptionLabel(weekId)} ABA排名`, `${weekOptionLabel(weekId)} 搜索量`);
  }
  const rows = state.db.keywords.map((kw) => {
    const rank = rankOf(kw.id, wid);
    const prevRank = prev ? rankOf(kw.id, prev) : null;
    const volume = volOf(kw.id, wid);
    const prevVolume = prev ? volOf(kw.id, prev) : null;
    const rankChange = rank == null || prevRank == null
      ? ""
      : rank < prevRank
        ? `+${prevRank - rank}`
        : rank > prevRank
          ? `-${rank - prevRank}`
          : "0";
    const volumeChange = volume == null || prevVolume == null || prevVolume === 0
      ? ""
      : `${(((volume - prevVolume) / prevVolume) * 100).toFixed(1)}%`;
    const row = [
      kw.keyword,
      kw.translation || "",
      kw.brand || "",
      kw.categoryWord || "",
      tagEntries(kw).map((entry) => `${entry.dim}:${entry.value}`).join("；"),
      rank ?? "",
      rankChange,
      volume ?? "",
      volumeChange,
    ];
    for (const weekId of weeks) {
      row.push(rankOf(kw.id, weekId) ?? "", volOf(kw.id, weekId) ?? "");
    }
    return row;
  });
  return "\uFEFF" + [header, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
}

function exportKeywordsCsv() {
  const csv = buildKeywordsCsv();
  if (!csv) return;
  const wid = state.weekId;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `hn-search-terms-${wid}.csv`;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("#btn-export").addEventListener("click", exportKeywordsCsv);

$("#btn-update-team-link")?.addEventListener("click", updateTeamLink);

const READONLY_PASSWORD_HASH = "c47ad772ab8141e427d2982db0fd7060cffad4806d218e87d3644fccaf07a461";

async function requireAuth() {
  const gate = document.querySelector("#auth-gate");
  if (!gate) return true;
  const AUTH_KEY = "hnReadonlyAuthTs";
  let last = 0;
  try { last = Number(localStorage.getItem(AUTH_KEY) || 0); } catch {}
  if (last && Date.now() - last < 24 * 60 * 60 * 1000) {
    gate.remove();
    return true;
  }
  const form = document.querySelector("#auth-form");
  const input = document.querySelector("#auth-pass");
  const err = document.querySelector("#auth-error");
  const hash = async (s) => {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  };
  return new Promise((resolve) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if ((await hash(input.value)) === READONLY_PASSWORD_HASH) {
        gate.remove();
        try { localStorage.setItem(AUTH_KEY, String(Date.now())); } catch {}
        resolve(true);
      } else {
        if (err) err.hidden = false;
        input.value = "";
        input.focus();
      }
    });
  });
}

(async function init() {
  try {
    await requireAuth();
    showLoadProgress("正在加载数据，首次打开可能需要几分钟，之后会秒开…");
    await loadDB();
    render();
    const loadEl = document.querySelector("#load-status");
    if (loadEl) loadEl.hidden = true;
    initXiyouStatus();
  } catch (err) {
    document.body.innerHTML = `<div style="max-width:520px;margin:80px auto;background:#fff;border:1px solid #e3e8ee;border-radius:8px;padding:24px">
      <h2 style="margin-top:0">启动失败</h2><p>${esc(err.message)}</p>
      <p class="muted">请确认 data/state.json.gz 数据快照存在</p></div>`;
  }
})();
