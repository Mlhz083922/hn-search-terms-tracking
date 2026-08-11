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
  filter: { q: "", categories: [], attributes: [], source: "", brands: [], rankMin: "", rankMax: "" },
  sort: { key: "", dir: 1 },
  overviewBrands: [],
  overviewCategories: [],
  overviewAttributes: [],
  volFromWeek: null,
  volToWeek: null,
  moverBaseWeek: null,
  moverCurWeek: null,
  draft: null,
  reviewTab: "include",
  reviewLimit: 250,
  xiyouBatch: 1,
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
          ${options.map((b) => `
            <label class="multi-item">
              <input type="checkbox" value="${esc(b)}" ${(selected || []).includes(b) ? "checked" : ""}>
              <span>${esc(b)}</span>
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

function rankOf(kid, wid) {
  return state.db.rankings[kid]?.[wid] ?? null;
}

function volOf(kid, wid) {
  return state.db.volumes[kid]?.[wid] ?? null;
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

const STATE_KEY = "hnStateCache";

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

function render() {
  if (!state.db) return;
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
}

function viewOverview() {
  const wid = state.weekId;
  const prev = prevWeekId(wid);
  const active = state.db.keywords.filter((k) => k.active !== false);
  const focusSet = new Set(
    (state.db.settings?.focusBrands || []).map((b) => String(b).toLowerCase().trim())
  );
  const focusBrands = state.db.settings?.focusBrands || [];
  const cats = [...new Set(active.map((k) => k.categoryWord).filter(Boolean))].sort();
  const attrs = [...new Set(active.map((k) => k.attribute).filter(Boolean))].sort();
  const filtered = active.filter((k) =>
    brandMatches(k, state.overviewBrands) &&
    exactMatches(k.categoryWord, state.overviewCategories) &&
    exactMatches(k.attribute, state.overviewAttributes)
  );
  const focusCount = filtered.filter((k) => focusSet.has(String(k.brand || "").toLowerCase().trim())).length;
  const ranked = filtered.filter((k) => rankOf(k.id, wid) != null);
  const rankedPrev = prev ? filtered.filter((k) => rankOf(k.id, prev) != null).length : null;
  const volMatched = filtered.filter((k) => volOf(k.id, wid) != null).length;
  const weekHasVol = volMatched > 0;
  const newlyAdded = filtered.filter((k) => k.firstSeenWeek === wid).length;
  const newWeeks = Object.keys(state.db.weeks).filter((x) => x > wid).length;

  const topRows = ranked
    .map((k) => ({ k, rank: rankOf(k.id, wid) }))
    .filter((x) => x.rank <= 9999)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 500);
  const moverBase = state.moverBaseWeek || prev;
  const moverCur = state.moverCurWeek || wid;
  const movers = ranked
    .map((k) => {
      const r = rankOf(k.id, moverCur);
      const p = rankOf(k.id, moverBase);
      return { k, r, p, ratio: r != null && p != null && r > 0 && p > r ? p / r : null };
    })
    .filter((x) => x.ratio != null && x.r <= 250000)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 15);

  const volRows = filtered
    .map((k) => ({ k, v: volOf(k.id, wid) }))
    .filter((x) => x.v != null)
    .sort((a, b) => b.v - a.v)
    .slice(0, 10);
  const volWeeks = weekIds().filter((x) => filtered.some((k) => volOf(k.id, x) != null));
  const volRangeStart = state.volFromWeek || volWeeks.slice(-12)[0] || volWeeks[0];
  const volRangeEnd = state.volToWeek || volWeeks.at(-1);
  const volRange = volWeeks.filter((x) => x >= volRangeStart && x <= volRangeEnd);
  const volSums = volRange
    .map((x) => ({ wid: x, sum: filtered.reduce((a, k) => a + (volOf(k.id, x) || 0), 0) }));

  const stats = [
    { label: "词库词数", value: fmt(filtered.length), icon: "database", extra: `共 ${state.db.keywords.length} 条词库 · 白名单品牌 ${focusCount} 词` },
    { label: "当周上榜", value: fmt(ranked.length), icon: "trending-up", extra: rankedPrev == null ? "" : ranked.length - rankedPrev > 0 ? `<span class="up">+${ranked.length - rankedPrev}</span> 较上周边化` : ranked.length - rankedPrev < 0 ? `<span class="down">${ranked.length - rankedPrev}</span> 较上周边化` : "与上周持平" },
    { label: "搜索量已匹配", value: fmt(volMatched), icon: "search", extra: weekHasVol ? `覆盖率 ${filtered.length ? Math.round((volMatched / filtered.length) * 100) : 0}%` : "西柚数据待更新（预计周三）" },
    { label: "本周新增", value: fmt(newlyAdded), icon: "plus-circle", extra: newWeeks > 0 ? "当前周后仍有新周期" : "当前为最新数据周" },
    { label: "当周周期", value: esc(weekLabel(wid)), icon: "calendar", extra: state.db.weeks[wid]?.volumeSource === "xiyou" ? "搜索量来自西柚" : weekHasVol ? "搜索量来自人工登记" : "搜索量待西柚更新" },
    { label: "白名单品牌", value: fmt(focusCount), icon: "star", extra: "品牌白名单相关词" },
  ];

  return `
    <section class="view">
      <div class="view-head">
        <div>
          <h2>总览 <span class="muted" style="font-size:14px">· ${esc(weekLabel(wid))}</span></h2>
          <p>女装泳装类目周度 ABA 排名与搜索量变化</p>
        </div>
        <div class="view-actions">
          ${multiFilterHtml("品牌", focusBrands, state.overviewBrands, "overview-brands")}
          ${multiFilterHtml("类目词", cats, state.overviewCategories, "overview-cats")}
          ${multiFilterHtml("属性词", attrs, state.overviewAttributes, "overview-attrs")}
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

      <div class="two-col">
        <div class="panel">
          <div class="panel-head">
            <h3>当周 ABA 排名 TOP（1 万以内）</h3>
            <span class="sub">共 ${fmt(topRows.length)} 词 · 点击行查看历史趋势</span>
          </div>
          <div class="table-wrap">
            <table class="data">
              <thead><tr>
                <th>排名</th><th>关键词</th><th>类目词</th><th>属性词</th>
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
                    <td>${esc(k.attribute || "—")}</td>
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

        <div style="display:grid;gap:16px">
          <div class="panel">
            <div class="panel-head">
              <h3>自定义周度对比</h3>
              <span class="sub">排名上升最快 TOP15 · 对比周排名 25 万以内</span>
            </div>
            <div class="panel-head" style="border-bottom:0;padding-top:8px;flex-wrap:wrap">
              <span class="hstack" style="gap:6px">
                <span class="muted sm">基准周</span>
                <select class="select" id="mover-base">
                  ${weekIds().map((x) => `<option value="${x}" ${x === moverBase ? "selected" : ""}>${esc(weekLabel(x))}</option>`).join("")}
                </select>
                <span class="muted">→</span>
                <select class="select" id="mover-cur">
                  ${weekIds().map((x) => `<option value="${x}" ${x === moverCur ? "selected" : ""}>${esc(weekLabel(x))}</option>`).join("")}
                </select>
                <span class="muted sm">对比周</span>
              </span>
            </div>
            <div class="panel-body">
              ${movers.length ? `
                <div class="mover-head"><span>关键词</span><span>基准周 → 对比周</span><span>上升幅度</span></div>
                ${movers.map(({ k, r, p, ratio }) => `
                  <div class="mover-row clickable" data-action="open-keyword" data-id="${k.id}" title="点击查看历史趋势">
                    <span class="label" title="${esc(k.keyword)}">${esc(k.keyword)}</span>
                    <span class="ranks"><b>#${fmt(p)}</b><span class="muted">→</span><b class="cur">#${fmt(r)}</b></span>
                    <span class="badge up">▲ ${ratio.toFixed(2)}x</span>
                  </div>`).join("")}
              ` : '<div class="empty">当前周排名 25 万内暂无上升词</div>'}
            </div>
          </div>

          <div class="panel">
            <div class="panel-head"><h3>当周搜索量 Top 10</h3><span class="sub">来自西柚匹配</span></div>
            <div class="panel-body">
              ${volRows.length ? volRows.map(({ k, v }, i) => `
                <div class="mini-row clickable" data-action="open-keyword" data-id="${k.id}" title="点击查看历史趋势" style="margin-bottom:6px">
                  <span class="rank">${i + 1}</span>
                  <span class="label" title="${esc(k.keyword)}">${esc(k.keyword)}</span>
                  <span class="val"><strong>${fmt(v)}</strong></span>
                </div>`).join("") : '<div class="empty">本周搜索量待西柚更新（预计每周三）</div>'}
            </div>
          </div>

          <div class="panel">
            <div class="panel-head"><h3>周度搜索量合计</h3><span class="sub">按当前筛选 · 自定义区间</span></div>
            <div class="panel-head" style="border-bottom:0;padding-top:8px;flex-wrap:wrap">
              <span class="hstack" style="gap:6px">
                <span class="muted sm">起始周</span>
                <select class="select" id="vol-from">
                  ${volWeeks.map((x) => `<option value="${x}" ${x === volRangeStart ? "selected" : ""}>${esc(weekLabel(x))}</option>`).join("")}
                </select>
                <span class="muted">→</span>
                <select class="select" id="vol-to">
                  ${volWeeks.map((x) => `<option value="${x}" ${x === volRangeEnd ? "selected" : ""}>${esc(weekLabel(x))}</option>`).join("")}
                </select>
                <span class="muted sm">结束周</span>
              </span>
            </div>
            <div class="panel-body">${volumeTrendSvg(volSums)}</div>
          </div>
        </div>
      </div>
    </section>`;
}

function volumeTrendSvg(volSums) {
  if (volSums.length < 2) {
    return `<div class="empty">累计至少两个周期后显示趋势</div>`;
  }
  const max = Math.max(...volSums.map((x) => x.sum));
  const w = 360;
  const h = 150;
  const padB = 26;
  const padT = 12;
  const padX = 26;
  const bw = Math.max(8, (w - padX * 2 - volSums.length * 4) / volSums.length);
  const bars = volSums
    .map((x, i) => {
      const bh = ((x.sum / max) * (h - padT - padB));
      const x0 = padX + i * (bw + 4);
      return `<rect x="${x0}" y="${h - padB - bh}" width="${bw}" height="${bh}" rx="2" fill="#0e7f82" opacity="0.85">
        <title>${esc(weekLabel(x.wid))}: ${fmt(x.sum)}</title></rect>
        <text x="${x0 + bw / 2}" y="${h - 10}" text-anchor="middle" font-size="9" fill="#667085">${esc(weekLabel(x.wid).replace("-", "~"))}</text>
        <text x="${x0 + bw / 2}" y="${h - padB - bh - 4}" text-anchor="middle" font-size="9" fill="#344054">${fmtCompact(x.sum)}</text>`;
    })
    .join("");
  return `<svg class="svg-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${bars}</svg>`;
}

function sparklineHtml(kid) {
  const ids = weekIds().slice(-12);
  const pts = ids.map((w, i) => ({ w, i, v: rankOf(kid, w) }));
  const vals = pts.filter((p) => p.v != null).map((p) => p.v);
  if (vals.length < 2) return '<span class="muted">—</span>';
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = Math.max(1, max - min);
  const W = 110;
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
    const y = H - P - ((p.v - min) / span) * (H - P * 2);
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
    case "attribute": return k.attribute || "";
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
    case "source": return k.source || "";
    case "status": return k.active === false ? 0 : 1;
    default: return String(k.keyword || "").toLowerCase();
  }
}

function sortableTh(key, label, num = false) {
  const active = state.sort.key === key;
  const arrow = active ? (state.sort.dir === 1 ? " ▲" : " ▼") : "";
  return `<th class="${num ? "num " : ""}sortable" data-sort="${key}" title="点击排序">${label}${arrow}</th>`;
}

function viewLibrary() {
  const f = state.filter;
  const cats = [...new Set(state.db.keywords.map((k) => k.categoryWord).filter(Boolean))].sort();
  const attrs = [...new Set(state.db.keywords.map((k) => k.attribute).filter(Boolean))].sort();
  const focusBrands = state.db.settings?.focusBrands || [];
  const focusSet = new Set(focusBrands.map((b) => String(b).toLowerCase().trim()));
  const q = f.q.toLowerCase();
  const rows = state.db.keywords.filter((k) => {
    if (!exactMatches(k.categoryWord, f.categories)) return false;
    if (!exactMatches(k.attribute, f.attributes)) return false;
    if (f.source && k.source !== f.source) return false;
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
    return [k.keyword, k.translation, k.brand, k.categoryWord, k.attribute].some((s) => String(s || "").toLowerCase().includes(q));
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
  return `
    <section class="view">
      <div class="view-head">
        <div>
          <h2>关键词库</h2>
          <p>${fmt(state.db.keywords.length)} 个女装泳装词 · 点击行查看周度历史（只读快照）</p>
        </div>
        <div class="view-actions">
        </div>
      </div>
      <div class="panel">
        <div class="toolbar">
          <div class="search"><i data-lucide="search"></i><input id="lib-q" placeholder="搜索关键词、翻译、品牌..." value="${esc(f.q)}"></div>
          ${multiFilterHtml("类目词", cats, f.categories, "library-cats")}
          ${multiFilterHtml("属性词", attrs, f.attributes, "library-attrs")}
          ${multiFilterHtml("品牌", state.db.settings?.focusBrands || [], f.brands, "library")}
          <div class="rank-filter" title="按当周 ABA 排名区间筛选">
            <span class="muted sm">当周排名</span>
            <input type="number" id="lib-rank-min" min="1" step="1" placeholder="最小" value="${esc(f.rankMin)}">
            <span class="muted">—</span>
            <input type="number" id="lib-rank-max" min="1" step="1" placeholder="最大" value="${esc(f.rankMax)}">
            <select class="select" id="lib-rank-preset">
              <option value="">全部</option>
              <option value="10000" ${presetMatch === "10000" ? "selected" : ""}>1万以内</option>
              <option value="100000" ${presetMatch === "100000" ? "selected" : ""}>10万以内</option>
              <option value="250000" ${presetMatch === "250000" ? "selected" : ""}>25万以内</option>
              <option value="500000" ${presetMatch === "500000" ? "selected" : ""}>50万以内</option>
              <option value="1000000" ${presetMatch === "1000000" ? "selected" : ""}>100万以内</option>
            </select>
          </div>
          <select class="select" id="lib-source">
            <option value="">全部来源</option>
            <option value="manual" ${f.source === "manual" ? "selected" : ""}>手动登记</option>
            <option value="weekly" ${f.source === "weekly" ? "selected" : ""}>周度导入</option>
          </select>
          <div class="spacer"></div>
          <button class="btn" data-action="reset-filters"><i data-lucide="x"></i>清空</button>
        </div>
        <div class="table-wrap">
          <table class="data">
            <thead><tr>
              ${sortableTh("keyword", "关键词")}${sortableTh("brand", "品牌")}${sortableTh("category", "类目词")}${sortableTh("attribute", "属性词")}
              ${sortableTh("rank", "当周排名", true)}${sortableTh("rankChange", "排名变动", true)}${sortableTh("volume", "当周搜索量", true)}${sortableTh("volChange", "搜索量环比", true)}
              ${sortableTh("source", "来源")}${sortableTh("status", "状态")}
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
                  <td>${esc(k.brand || "—")}${focus ? ' <span class="badge new">重点</span>' : ""}</td>
                  <td>${esc(k.categoryWord || "—")}</td>
                  <td>${esc(k.attribute || "—")}</td>
                  <td class="num">${rankBadge(r)}</td>
                  <td class="num">${deltaHtml(p, r)}</td>
                  <td class="num">${fmt(v)}</td>
                  <td class="num">${volumeDeltaHtml(pv, v)}</td>
                  <td>${k.source === "weekly" ? '<span class="tag">周度导入</span>' : "手动"}</td>
                  <td>${k.active === false ? '<span class="badge flat">停用</span>' : '<span class="badge up">启用</span>'}</td>
                </tr>`;
              }).join("") || emptyRow(10, "没有匹配的关键词")}
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
            <button class="btn" data-action="xiyou-export" data-week="${d.weekId}"><i data-lucide="download"></i>导出待匹配词（第1批/100词）</button>
            <button class="btn" data-action="xiyou-export-next" data-week="${d.weekId}"><i data-lucide="chevrons-right"></i>下一批</button>
            <span class="kbd-hint">也可直接到「西柚匹配」页导出全部批次</span>
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
  const volMatched = active.filter((k) => volOf(k.id, wid) != null).length;
  const w = state.db.weeks[wid];
  return `
    <section class="view">
      <div class="view-head">
        <div>
          <h2>西柚洞察匹配</h2>
          <p>批量查询当周关键词搜索量</p>
        </div>
        <div class="view-actions">
          <button class="btn" data-action="xiyou-export" data-week="${wid}"><i data-lucide="download"></i>导出待匹配词（第1批/100词）</button>
          <button class="btn" data-action="xiyou-export-next" data-week="${wid}"><i data-lucide="chevrons-right"></i>下一批</button>
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
            <button class="chip amber chip-toggle" type="button" data-action="xiyou-pending" data-week="${wid}" aria-expanded="false"><b>${fmt(Math.max(0, ranked.length - volMatched))}</b> 待匹配 <i data-lucide="chevron-down"></i></button>
          </div>
          <div id="xiyou-pending-list"></div>
          <div class="auto-match-box">
            <div class="hstack">
              <button class="btn primary" data-action="xiyou-auto-match" data-week="${wid}"><i data-lucide="zap"></i>一键自动匹配搜索量</button>
              <span class="kbd-hint">自动跳过已有搜索量的词，进度实时显示</span>
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
      else if (action === "edit-keyword") { e.stopPropagation(); openKeywordModal(id); }
      else if (action === "delete-keyword") { e.stopPropagation(); deleteKeyword(id); }
      else if (action === "add-keyword") openKeywordModal();
      else if (action === "goto-update") { state.view = "update"; render(); }
      else if (action === "goto-xiyou") { state.view = "xiyou"; render(); }
      else if (action === "load-more") { state.libraryPage += 1; render(); }
      else if (action === "reset-filters") { state.filter = { q: "", categories: [], attributes: [], source: "", brands: [], rankMin: "", rankMax: "" }; state.libraryPage = 1; render(); }
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
      else if (action === "xiyou-export") xiyouExport(week, 1);
      else if (action === "xiyou-export-next") xiyouExport(week, state.xiyouBatch + 1);
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

  root.querySelectorAll("[data-multi-toggle]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
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
      else if (wrap.dataset.target === "overview-attrs") state.overviewAttributes = vals;
      else if (wrap.dataset.target === "library-cats") state.filter.categories = vals;
      else if (wrap.dataset.target === "library-attrs") state.filter.attributes = vals;
      else state.filter.brands = vals;
      state.libraryPage = 1;
      render();
    });
  });

  const moverBase = root.querySelector("#mover-base");
  const moverCur = root.querySelector("#mover-cur");
  if (moverBase) moverBase.addEventListener("change", () => { state.moverBaseWeek = moverBase.value; render(); });
  if (moverCur) moverCur.addEventListener("change", () => { state.moverCurWeek = moverCur.value; render(); });

  const volFrom = root.querySelector("#vol-from");
  const volTo = root.querySelector("#vol-to");
  if (volFrom) volFrom.addEventListener("change", () => { state.volFromWeek = volFrom.value; render(); });
  if (volTo) volTo.addEventListener("change", () => { state.volToWeek = volTo.value; render(); });

  const q = root.querySelector("#lib-q");
  if (q) {
    q.addEventListener("input", debounce(() => {
      state.filter.q = q.value;
      state.libraryPage = 1;
      render();
      const newQ = $("#lib-q");
      if (newQ) {
        newQ.focus();
        newQ.setSelectionRange(newQ.value.length, newQ.value.length);
      }
    }, 220));
  }
  for (const [sel, key] of [["#lib-source", "source"]]) {
    const el = root.querySelector(sel);
    if (el) el.addEventListener("change", () => {
      state.filter[key] = el.value;
      state.libraryPage = 1;
      render();
    });
  }

  const rankMinEl = root.querySelector("#lib-rank-min");
  const rankMaxEl = root.querySelector("#lib-rank-max");
  const rankPresetEl = root.querySelector("#lib-rank-preset");
  const applyRank = (active) => {
    state.filter.rankMin = rankMinEl?.value ?? "";
    state.filter.rankMax = rankMaxEl?.value ?? "";
    state.libraryPage = 1;
    render();
    const next = active === "min" ? $("#lib-rank-min") : $("#lib-rank-max");
    if (next) {
      next.focus();
      next.setSelectionRange(next.value.length, next.value.length);
    }
  };
  if (rankMinEl) {
    rankMinEl.addEventListener("input", debounce(() => applyRank("min"), 220));
  }
  if (rankMaxEl) {
    rankMaxEl.addEventListener("input", debounce(() => applyRank("max"), 220));
  }
  if (rankPresetEl) {
    rankPresetEl.addEventListener("change", () => {
      const v = rankPresetEl.value;
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
      render();
    };
  }

  const xw = root.querySelector("#xiyou-week");
  if (xw) {
    xw.onchange = () => {
      state.xiyouWeekId = xw.value;
      state.xiyouBatch = 1;
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
  const base64 = await fileToBase64(pendingFile);
  const addNew = $("#add-new").value === "true";
  const btn = document.querySelector('[data-action="parse-file"]');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2"></i>解析中...';
    initIcons(btn);
  }
  try {
    const draft = await api("/api/import/aba", {
      method: "POST",
      body: JSON.stringify({
        fileName: pendingFile.name,
        fileData: base64,
        weekStart: start,
        weekEnd: end,
        addNewKeywords: addNew,
      }),
    });
    state.draft = draft;
    state.reviewTab = "include";
    state.reviewLimit = 250;
    state.xiyouBatch = 1;
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
  if (row) row.status = status;
  render();
}

function bulkStatus(from, to) {
  const d = state.draft;
  for (const r of d.rows) if (r.status === from) r.status = to;
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

async function updateTeamLink() {
  const btn = $("#btn-update-team-link");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader-2"></i>更新中...';
    initIcons(btn);
  }
  try {
    const res = await api("/api/team-link/update", { method: "POST", body: "{}" });
    toast(res.message || "团队链接已更新", "success");
    showTeamLinkModal(res);
  } catch (err) {
    toast(err.message, "error");
  } finally {
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
    const res = await api(`/api/drafts/${state.draft.id}/commit`, { method: "POST", body: "{}" });
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

async function xiyouExport(week, batch) {
  if (!week) week = state.xiyouWeekId || state.weekId;
  try {
    const data = await api(`/api/xiyou/pending?weekId=${week}&batch=${batch}&batchSize=100&missingOnly=1`);
    state.xiyouBatch = batch;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `xiyou_week_${week}_batch${batch}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast(data.more ? `已导出第 ${batch} 批，还有更多批次` : `已导出第 ${batch} 批（共 ${data.total} 词）`, "success");
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
    .filter((x) => x.rank != null && volOf(x.k.id, week) == null)
    .sort((a, b) => a.rank - b.rank);
  box.dataset.open = "1";
  chip?.setAttribute("aria-expanded", "true");
  box.innerHTML = pending.length
    ? `<div class="panel" style="margin-top:12px">
        <div class="panel-head">
          <h3>待匹配关键词</h3>
          <span class="sub">有当周 ABA 排名但尚无搜索量</span>
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
  const btn = document.querySelector('[data-action="xiyou-auto-match"]');
  const box = $("#xiyou-auto-status");
  if (!box) return;
  const restore = () => {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="zap"></i>一键自动匹配搜索量';
      initIcons(btn);
    }
  };
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
    box.innerHTML = `
      <div class="chip"><b>${fmt(cur.done)}/${fmt(cur.total)}</b> 词 · 已匹配 ${fmt(cur.matched)} · 消耗 ${fmt(cur.costCredits)} 积分</div>
      <div class="progress"><i style="width:${pct}%"></i></div>`;
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
      box.innerHTML = `
        <div class="chip-row" style="margin-top:6px">
          <span class="chip green"><b>${fmt(cur.matched)}</b> 匹配成功</span>
          ${cur.stopped === "credits" ? '<span class="chip red">西柚积分不足，已暂停</span>' : ""}
          <span class="chip"><b>${fmt(cur.costCredits)}</b> 积分</span>
        </div>
        ${cur.notFound.length ? `<div class="kbd-hint">未匹配：${esc(cur.notFound.slice(0, 10).join("、"))}${cur.notFound.length > 10 ? " 等" : ""}</div>` : ""}`;
      toast(
        cur.stopped === "credits"
          ? `自动匹配暂停：积分不足，已匹配 ${cur.matched} 词`
          : `自动匹配完成：${cur.matched} 词`,
        "success"
      );
    } else {
      box.innerHTML = `<div class="chip red"><b>任务失败</b> ${esc(cur.error || "未知错误")}</div>`;
    }
  } catch (err) {
    box.innerHTML = `<div class="chip red"><b>查询失败</b> ${esc(err.message)}</div>`;
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

function openKeywordModal(kid) {
  const kw = kid ? state.db.keywords.find((k) => k.id === kid) : null;
  const ids = weekIds();
  const focusBrands = state.db.settings?.focusBrands || [];
  const histRows = kw
    ? ids.map((wid) => {
        const r = rankOf(kw.id, wid);
        const v = volOf(kw.id, wid);
        return `<tr>
          <td>${esc(weekLabel(wid))}</td>
          <td class="num">${rankBadge(r)}</td>
          <td class="num">${fmt(v)}</td>
        </tr>`;
      }).join("")
    : "";
  const cats = [...new Set(state.db.keywords.map((k) => k.categoryWord).filter(Boolean))].sort();
  for (const c of ["Bikini", "One Piece", "Tankini", "Tankini Top"]) if (!cats.includes(c)) cats.push(c);
  const volWeeks = ids.filter((w) => kw && volOf(kw.id, w) != null);
  const volLast = volWeeks.at(-1);
  const volPrev = volWeeks.at(-2);
  const volDelta = volLast
    ? volumeDeltaHtml(volPrev ? volOf(kw.id, volPrev) : null, volOf(kw.id, volLast))
    : '<span class="muted">—</span>';
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
        <div class="form-grid" style="grid-template-columns:repeat(4,minmax(0,1fr))">
          <div class="field"><label>品牌</label><input id="edit-brand" list="brand-list" value="${esc(kw?.brand || "")}" placeholder="从白名单选择"></div>
          <div class="field"><label>类目词</label>
            <select id="edit-category">
              <option value="">—</option>
              ${cats.map((c) => `<option ${kw?.categoryWord === c ? "selected" : ""}>${esc(c)}</option>`).join("")}
            </select>
          </div>
          <div class="field"><label>属性词</label><input id="edit-attribute" value="${esc(kw?.attribute || "")}" placeholder="High"></div>
          <div class="field"><label>关键词</label><input id="edit-keyword" value="${esc(kw?.keyword || "")}" ${kw ? "disabled" : ""}></div>
          <div class="field"><label>关键词翻译</label><input id="edit-translation" value="${esc(kw?.translation || "")}"></div>
          <div class="field"><label>备注</label><input id="edit-notes" value="${esc(kw?.notes || "")}"></div>
          <div class="field"><label>状态</label>
            <select id="edit-active">
              <option value="true" ${kw?.active !== false ? "selected" : ""}>启用</option>
              <option value="false" ${kw?.active === false ? "selected" : ""}>停用</option>
            </select>
          </div>
        </div>
        <datalist id="brand-list">${focusBrands.map((b) => `<option value="${esc(b)}">`).join("")}</datalist>
        ${kw ? `
          <div style="margin-top:16px">
            <div class="panel-head" style="padding:10px 0"><h3 style="font-size:14px">周度历史</h3><span class="sub">共 ${fmt(ids.length)} 个周期 · 搜索量周环比 ${volDelta}</span></div>
            ${trendChartsHtml(kw.id)}
            <div class="table-wrap" style="max-height:220px">
              <table class="data">
                <thead><tr><th>周期</th><th class="num">ABA排名</th><th class="num">搜索量</th></tr></thead>
                <tbody>${histRows}</tbody>
              </table>
            </div>
          </div>` : ""}
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
      attribute: modal.querySelector("#edit-attribute").value.trim(),
      translation: modal.querySelector("#edit-translation").value.trim(),
      notes: modal.querySelector("#edit-notes").value.trim(),
      active: modal.querySelector("#edit-active").value === "true",
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
  const YEAR_STYLE = {
    "2024": { color: "#98a2b3", name: "24年" },
    "2025": { color: "#d64045", name: "25年" },
    "2026": { color: "#0e7f82", name: "26年" },
  };
  const yearColor = (y) => YEAR_STYLE[y]?.color || "#7c3aed";
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
      .map((w, i) => ({ w, i, v: kind === "rank" ? rankOf(kid, w) : volOf(kid, w) }))
      .filter((p) => p.v != null);
    if (pts.length < 2) return `<div class="empty">暂无${kind === "rank" ? "排名" : "搜索量"}趋势数据</div>`;
    const W = 620;
    const H = 190;
    const padL = 54;
    const padR = 14;
    const padT = 14;
    const padB = 28;
    const vals = pts.map((p) => (kind === "rank" ? Math.log10(p.v) : p.v));
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = Math.max(1e-9, max - min);
    const x = (weekIdx) => padL + (weekIdx / (WEEK_TOTAL - 1)) * (W - padL - padR);
    const y = (v) => padT + (1 - (v - min) / span) * (H - padT - padB);
    const byYear = {};
    for (const p of pts) {
      const yr = p.w.slice(0, 4);
      (byYear[yr] ||= []).push({ ...p, weekIdx: weekOfYear(p.w) });
    }
    const years = Object.keys(byYear).sort();
    const lineFor = (list) => {
      let d = "";
      let pen = false;
      for (const p of list) {
        const v = kind === "rank" ? Math.log10(p.v) : p.v;
        d += `${pen ? "L" : "M"}${x(p.weekIdx).toFixed(1)} ${y(v).toFixed(1)}`;
        pen = true;
      }
      return d;
    };
    const paths = years
      .map((yr) => {
        const list = byYear[yr];
        if (list.length < 2) return "";
        return `<path d="${lineFor(list)}" fill="none" stroke="${yearColor(yr)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></path>`;
      })
      .join("");
    const areas =
      kind === "volume"
        ? years
            .map((yr) => {
              const list = byYear[yr];
              if (list.length < 2) return "";
              const d = lineFor(list);
              const a = `${d} L${x(list[list.length - 1].weekIdx).toFixed(1)} ${H - padB} L${x(list[0].weekIdx).toFixed(1)} ${H - padB} Z`;
              return `<path d="${a}" fill="${yearColor(yr)}" opacity="0.08"></path>`;
            })
            .join("")
        : "";
    const yTicks = [min, (min + max) / 2, max]
      .map((v) => {
        const label = kind === "rank" ? fmt(Math.round(Math.pow(10, v))) : fmt(Math.round(v));
        return `<text x="${padL - 6}" y="${y(v) + 3}" text-anchor="end" font-size="9" fill="#667085">${label}</text>`;
      })
      .join("");
    const weekIdxs = pts.map((p) => weekOfYear(p.w));
    const minWeek = Math.min(...weekIdxs);
    const maxWeek = Math.max(...weekIdxs);
    const refYear = Math.min(...years.map(Number));
    const gridLines = [];
    const xTicks = [];
    for (let wk = minWeek; wk <= maxWeek; wk++) {
      gridLines.push(`<line x1="${x(wk).toFixed(1)}" y1="${padT}" x2="${x(wk).toFixed(1)}" y2="${H - padB}" stroke="#eef1f4" stroke-width="1"></line>`);
    }
    for (let m = 1; m <= 12; m++) {
      const wk = monthFirstWeek(refYear, m);
      if (wk > maxWeek) break;
      if (wk < minWeek) continue;
      xTicks.push(`<text x="${x(wk).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="#667085">${m}月</text>`);
    }
    if (xTicks.length === 0) {
      xTicks.push(`<text x="${x(minWeek).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="#667085">第${minWeek + 1}周</text>`);
      if (maxWeek > minWeek) {
        xTicks.push(`<text x="${x(maxWeek).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="#667085">第${maxWeek + 1}周</text>`);
      }
    }
    const xTicksHtml = xTicks.join("");
    const dots = pts
      .map((p) => {
        const v = kind === "rank" ? Math.log10(p.v) : p.v;
        const wk = weekOfYear(p.w);
        const tip = kind === "rank" ? `ABA 排名 #${fmt(p.v)}` : `搜索量 ${fmt(p.v)}`;
        return `<circle class="chart-point" data-wid="${p.w}" cx="${x(wk).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.5"
          fill="${yearColor(p.w.slice(0, 4))}" stroke="#fff" stroke-width="1">
          <title>${esc(weekLabel(p.w))}：${tip}</title>
        </circle>`;
      })
      .join("");
    const legend = years
      .map((yr) => `<span class="chart-legend"><i style="background:${yearColor(yr)}"></i>${YEAR_STYLE[yr]?.name || yr}</span>`)
      .join("");
    return `<div class="chart-legend-row">${legend}</div>
    <svg class="trend-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      ${gridLines.join("")}${areas}${paths}
      ${yTicks}${xTicksHtml}${dots}
    </svg>`;
  };
  return `<div class="chart-grid">
    <div class="chart-box"><div class="chart-title">ABA 排名趋势（对数刻度 · 同周对齐按年分线）</div>${mk("rank")}</div>
    <div class="chart-box"><div class="chart-title">搜索量趋势（同周对齐按年分线）</div>${mk("volume")}</div>
  </div>
  <div class="chart-readout" id="chart-readout"></div>`;
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

$("#btn-export").addEventListener("click", exportCsv);

function exportCsv() {
  if (!state.db) return;
  const wid = state.weekId;
  const head = ["关键词", "翻译", "品牌", "类目词", "属性词", "来源", "状态", "当周ABA排名", "当周搜索量"];
  const rows = state.db.keywords.map((k) => [
    k.keyword,
    k.translation || "",
    k.brand || "",
    k.categoryWord || "",
    k.attribute || "",
    k.source === "weekly" ? "周度导入" : "手动",
    k.active === false ? "停用" : "启用",
    rankOf(k.id, wid) ?? "",
    volOf(k.id, wid) ?? "",
  ]);
  const csv =
    "\uFEFF" +
    [head, ...rows]
      .map((r) =>
        r
          .map((v) => {
            const s = String(v ?? "");
            return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
          })
          .join(",")
      )
      .join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "hn-search-terms-" + wid + ".csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

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
  } catch (err) {
    document.body.innerHTML = `<div style="max-width:520px;margin:80px auto;background:#fff;border:1px solid #e3e8ee;border-radius:8px;padding:24px">
      <h2 style="margin-top:0">启动失败</h2><p>${esc(err.message)}</p>
      <p class="muted">请确认 data/state.json.gz 数据快照存在</p></div>`;
  }
})();
