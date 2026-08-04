import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const root = path.dirname(fileURLToPath(import.meta.url));
const appDir = "/Users/lynn/Documents/Codex/泳装关键词跟踪";
const siteDir = path.join(root, "docs");
const dataDir = path.join(siteDir, "data");
const vendorDir = path.join(siteDir, "vendor");

const { loadDB } = await import(
  pathToFileURL(path.join(appDir, "lib", "store.mjs")).href
);

await fs.mkdir(dataDir, { recursive: true });
await fs.mkdir(vendorDir, { recursive: true });

async function copy(name, from, to) {
  await fs.copyFile(path.join(appDir, from, name), path.join(siteDir, to || name));
}

await copy("styles.css", "public");
await copy("lucide.min.js", "public/vendor", "vendor/lucide.min.js");

const html = await fs.readFile(path.join(appDir, "public", "index.html"), "utf8");
const patchedHtml = html
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
  return fetchState();
}

async function fetchState() {
  const resp = await fetch("./data/state.json.gz");
  if (!resp.ok) throw new Error(\`数据快照加载失败 \${resp.status}\`);
  const buf = await resp.arrayBuffer();
  const stream = new Response(buf).body.pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).json();
}`
  )
  .replace(
    'state.db = await api("/api/state");',
    "state.db = await fetchState();"
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
  );
await fs.writeFile(path.join(siteDir, "app.js"), patchedJs, "utf8");

console.log("read-only site built at", siteDir);
console.log("keywords:", db.keywords.length, "weeks:", Object.keys(db.weeks).length);
