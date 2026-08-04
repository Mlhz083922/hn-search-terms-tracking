import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const root = path.dirname(fileURLToPath(import.meta.url));
const appDir = "/Users/lynn/Documents/Codex/泳装关键词跟踪";
const siteDir = path.join(root, "docs");
const dataDir = path.join(siteDir, "data");
const vendorDir = path.join(siteDir, "vendor");

// SHA-256 of the read-only team password ("HN2026").
const READONLY_PASSWORD_HASH = "c47ad772ab8141e427d2982db0fd7060cffad4806d218e87d3644fccaf07a461";
const GATE_CSS = `
.auth-gate {
  position: fixed; inset: 0; z-index: 1000;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg);
}
.auth-box {
  width: min(380px, 90vw); padding: 28px;
  background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius);
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.12); text-align: center;
}
.auth-logo {
  width: 44px; height: 44px; margin: 0 auto; display: flex; align-items: center; justify-content: center;
  background: var(--accent); color: #fff; border-radius: 10px; font-weight: 700; font-size: 20px;
}
.auth-box h1 { font-size: 20px; margin: 14px 0 6px; }
.auth-box p { color: var(--muted); margin: 0 0 16px; }
.auth-box input { width: 100%; margin-bottom: 12px; padding: 9px 12px; border: 1px solid var(--line-strong); border-radius: 6px; }
.auth-box .btn { width: 100%; }
.auth-error { color: var(--down); margin: 10px 0 0; font-size: 13px; }
.load-status {
  position: fixed; left: 50%; top: 50%;
  transform: translate(-50%, -50%);
  z-index: 1001;
  max-width: min(560px, 90vw);
  padding: 18px 24px;
  background: var(--panel);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  box-shadow: 0 12px 32px rgba(16, 24, 40, 0.16);
  color: var(--ink-2);
  font-size: 14px;
  text-align: center;
}
`;
const GATE_HTML = `
  <div id="auth-gate" class="auth-gate">
    <form id="auth-form" class="auth-box">
      <div class="auth-logo">泳</div>
      <h1>HN Search Terms Tracking</h1>
      <p>输入访问密码查看数据 · 24 小时内免重复验证</p>
      <input id="auth-pass" type="password" placeholder="访问密码" autocomplete="current-password">
      <button class="btn primary" type="submit">进入</button>
      <p id="auth-error" class="auth-error" hidden>密码错误，请重试</p>
    </form>
  </div>
  <div id="load-status" class="load-status" hidden></div>`;

const { loadDB } = await import(
  pathToFileURL(path.join(appDir, "lib", "store.mjs")).href
);

await fs.mkdir(dataDir, { recursive: true });
await fs.mkdir(vendorDir, { recursive: true });

async function copy(name, from, to) {
  await fs.copyFile(path.join(appDir, from, name), path.join(siteDir, to || name));
}

const css = await fs.readFile(path.join(appDir, "public", "styles.css"), "utf8");
await fs.writeFile(path.join(siteDir, "styles.css"), css + GATE_CSS, "utf8");
await copy("lucide.min.js", "public/vendor", "vendor/lucide.min.js");

const html = await fs.readFile(path.join(appDir, "public", "index.html"), "utf8");
let patchedHtml = html
  .replace(
    "<title>女装泳装周度热搜词追踪</title>",
    "<title>HN Search Terms Tracking · 女装泳装热搜词追踪</title>"
  )
  .replace('href="/styles.css"', 'href="styles.css"')
  .replace('src="/vendor/lucide.min.js"', 'src="vendor/lucide.min.js"')
  .replace('src="/app.js"', 'src="app.js"')
  .replace(
    "<p id=\"site-label\">亚马逊美国站 · 周度更新</p>",
    "<p id=\"site-label\">亚马逊美国站 · HN Search Terms Tracking · 只读快照</p>"
  );
patchedHtml = patchedHtml.replace("<body>", "<body>" + GATE_HTML);
await fs.writeFile(path.join(siteDir, "index.html"), patchedHtml, "utf8");

const db = await loadDB({ force: true });
const stateJson = JSON.stringify(db);
await fs.writeFile(path.join(dataDir, "state.json.gz"), gzipSync(stateJson));
await fs.rm(path.join(dataDir, "state.json"), { force: true });

const js = await fs.readFile(path.join(appDir, "public", "app.js"), "utf8");
const patchedJs = js
  .replace(
    `async function api(path, options = {}) {
  const resp = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || \`请求失败 \${resp.status}\`);
  return data;
}`,
    `async function api(path, options = {}) {
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
  if (!resp.ok) throw new Error(\`数据快照加载失败 \${resp.status}\`);
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
      showLoadProgress(\`数据加载中 \${pct}%，约 \${(received / 1048576).toFixed(1)} MB / \${(total / 1048576).toFixed(1)} MB\`);
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
}`
  )
  .replace(
    `async function loadDB() {
  state.db = await api("/api/state");
  if (!state.weekId || !state.db.weeks[state.weekId]) {
    state.weekId = weekIds().at(-1);
  }
  if (!state.xiyouWeekId) state.xiyouWeekId = state.weekId;
}`,
    `async function loadDB() {
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
}`
  )
  .replace(
    `  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.view === state.view);
  });`,
    `  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.view === state.view);
  });
  document.querySelector('[data-view="update"]')?.remove();
  document.querySelector('[data-view="xiyou"]')?.remove();`
  )
  .replace(
    `          <button class="btn" data-action="goto-update"><i data-lucide="upload-cloud"></i>上传本周数据</button>
          <button class="btn" data-action="goto-xiyou"><i data-lucide="refresh-cw"></i>西柚匹配搜索量</button>
`,
    ""
  )
  .replace(
    "<p>${fmt(state.db.keywords.length)} 个女装泳装词 · 点击行查看周度历史与编辑</p>",
    "<p>${fmt(state.db.keywords.length)} 个女装泳装词 · 点击行查看周度历史（只读快照）</p>"
  )
  .replace(
    `          <button class="btn primary" data-action="add-keyword"><i data-lucide="plus"></i>手动添加</button>
`,
    ""
  )
  .replace(
    '${sortableTh("source", "来源")}${sortableTh("status", "状态")}<th>操作</th>',
    '${sortableTh("source", "来源")}${sortableTh("status", "状态")}'
  )
  .replace(
    `                  <td>
                    <div class="hstack" style="gap:4px">
                      <button class="icon-btn" title="编辑" data-action="edit-keyword" data-id="\${k.id}"><i data-lucide="pencil"></i></button>
                      <button class="icon-btn danger" title="删除" data-action="delete-keyword" data-id="\${k.id}"><i data-lucide="trash-2"></i></button>
                    </div>
                  </td>
`,
    ""
  )
  .replace('emptyRow(11, "没有匹配的关键词")', 'emptyRow(10, "没有匹配的关键词")')
  .replace(
    `  $("#modal-root").appendChild(modal);
  initIcons(modal);`,
    `  $("#modal-root").appendChild(modal);
  initIcons(modal);
  modal.querySelectorAll("input, select").forEach((el) => (el.disabled = true));
  const readOnlySave = modal.querySelector("#save-keyword");
  if (readOnlySave) readOnlySave.hidden = true;`
  )
  .replace(
    `$("#btn-export").addEventListener("click", () => {
  window.open("/api/export?format=csv", "_blank");
});`,
    `$("#btn-export").addEventListener("click", exportCsv);

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
    "\\uFEFF" +
    [head, ...rows]
      .map((r) =>
        r
          .map((v) => {
            const s = String(v ?? "");
            return /[",\\n\\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
          })
          .join(",")
      )
      .join("\\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "hn-search-terms-" + wid + ".csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}`
  )
  .replace(
    "请确认服务端已启动：node server.mjs",
    "请确认 data/state.json.gz 数据快照存在"
  )
  .replace(
    `(async function init() {
  try {
    await loadDB();
    render();`,
    `const READONLY_PASSWORD_HASH = "${READONLY_PASSWORD_HASH}";

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
    if (loadEl) loadEl.hidden = true;`
  );
await fs.writeFile(path.join(siteDir, "app.js"), patchedJs, "utf8");

console.log("read-only site built at", siteDir);
console.log("keywords:", db.keywords.length, "weeks:", Object.keys(db.weeks).length);
