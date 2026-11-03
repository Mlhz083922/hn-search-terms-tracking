/* ============================================================
   库存监控
   - 型号细化 / 花色细化 / SKU细化
   - 库存范围: 国内在仓、国内在途采购、FBA总库存、FBA在途
   - 在途明细: 发货/采购时间、预计到国内仓/FBA时间
   ============================================================ */

(function () {
  "use strict";

  const W = window.Workbench;
  const esc = W.esc;
  const fmtNum = W.fmtNum;
  const dataCache = new Map();
  const FBA_LEAD_STORAGE = "wb.inventoryFbaLeadOverrides";
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let snapshotDetailsPromise = null;

  async function loadSnapshotDetails() {
    if (!snapshotDetailsPromise) {
      snapshotDetailsPromise = (async () => {
        const response = await fetch(new URL("snapshot-details.json.gz?v=20261103-compact", location.href));
        if (!response.ok) throw new Error("库存明细读取失败");
        const buffer = await response.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let stream = new Blob([bytes]).stream();
        if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
          stream = stream.pipeThrough(new DecompressionStream("gzip"));
        }
        return JSON.parse(await new Response(stream).text());
      })().catch((error) => {
        snapshotDetailsPromise = null;
        throw error;
      });
    }
    return snapshotDetailsPromise;
  }

  function readFbaLeadOverrides() {
    try {
      const parsed = JSON.parse(localStorage.getItem(FBA_LEAD_STORAGE) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeFbaLeadOverrides(value) {
    try {
      localStorage.setItem(FBA_LEAD_STORAGE, JSON.stringify(value || {}));
    } catch {
      /* 忽略存储失败 */
    }
  }

  function defaultFbaLeadDays(mode) {
    return fbaShippingModeKind(mode) === "空运" ? 20 : 35;
  }

  const FBA_SHIPPING_MODE_LABELS = {
    HYMSZB: "海运美森正班",
    HYPC: "海运普船",
    KH: "卡航",
    TL: "铁运",
    KD: "快递",
    HYMSJB: "海运美森加班",
    HYKC: "海运快船",
    KYM: "空运慢线",
    KYK: "空运快线",
    HYMC: "海运慢船",
    USKD: "US快递",
    USKY: "US空运",
    USHYMS: "US海运美森正班",
    USHYHD: "US海运合德以星",
    USHYPC: "US海运普船",
    CAKD: "CA快递",
    CAKY: "CA空运慢线",
    CAHYKC: "CA海运快船",
    CAHYMC: "CA海运慢船",
    DEKY: "DE空运",
    DEKH: "DE卡航",
    DETY: "DE铁运",
    DEHY: "DE海运",
    GBKY: "GB空运",
    GBKH: "GB卡航",
    GBTY: "GB铁路",
    GBHYKC: "GB海运快船",
    GBHYPC: "GB海运普船",
  };

  function fbaShippingModeKind(mode) {
    const value = text(mode).toUpperCase();
    if (!value) return "";
    if (/空运/.test(value) || value.includes("KY")) return "空运";
    if (/海运/.test(value) || value.includes("HY")) return "海运";
    if (/卡航/.test(value) || value.includes("KH")) return "卡航";
    if (/铁运|铁路/.test(value) || value.includes("TL")) return "铁运";
    if (/快递/.test(value) || value.includes("KD")) return "快递";
    return value;
  }

  function fbaShippingModeLabel(mode) {
    const value = text(mode).toUpperCase();
    return FBA_SHIPPING_MODE_LABELS[value] || fbaShippingModeKind(value) || value;
  }

  function fbaLeadDays(shipment) {
    const override = readFbaLeadOverrides()[shipment.groupId];
    const days = Number(override);
    return Number.isFinite(days) && days > 0 ? Math.round(days) : defaultFbaLeadDays(shipment.shippingMode);
  }

  function addDaysToDateTime(dateTime, days) {
    const parsed = new Date(String(dateTime || "").replace(" ", "T") + "Z");
    if (Number.isNaN(parsed.getTime())) return "";
    parsed.setUTCDate(parsed.getUTCDate() + days);
    return parsed.toISOString().slice(0, 10);
  }

  function fbaShippedAt(shipment) {
    const status = text(shipment && shipment.status);
    const salesProcessingTime = text(shipment && shipment.salesProcessingTime);
    const auditAt = text(shipment && shipment.auditAt);
    if (status === "有渠道" && !salesProcessingTime && auditAt) return auditAt;
    return text(shipment && shipment.shippedAt);
  }

  function fbaEta(shipment) {
    const days = fbaLeadDays(shipment);
    const shippedAt = fbaShippedAt(shipment);
    const date = shippedAt ? addDaysToDateTime(shippedAt, days) : "";
    return { start: date, end: date, days };
  }

  function fbaItemQty(item) {
    return num(item.packingQty)
      || num(item.labelQty)
      || num(item.pickingQty)
      || num(item.applyQty);
  }

  function fbaItemSite(item) {
    let team = item && item.team;
    if (typeof team === "string") {
      try {
        team = JSON.parse(team);
      } catch {
        team = String(team || "").split(",").map((value) => value.trim()).filter(Boolean);
      }
    }
    const codes = Array.isArray(team)
      ? team
      : team && typeof team === "object"
        ? Object.keys(team)
        : [];
    for (const code of codes) {
      const match = String(code || "").match(/[-_]((US|CA|DE|UK|GB))$/i);
      if (match) return match[1].toUpperCase() === "GB" ? "UK" : match[1].toUpperCase();
    }
    const site = text(item && item.site).toUpperCase();
    return site === "GB" ? "UK" : site || "待确认";
  }

  const SCOPES = {
    "inventory-model": {
      title: "型号细化",
      desc: "关注 HN运营组产品，并纳入尚未上架但已有国内采购在途的新型号。",
    },
    "inventory-color": {
      title: "花色细化",
      desc: "关注 HN运营组已建档花色；尚未上架的新品以“待上架”展示采购在途。",
    },
    "inventory-sku": {
      title: "SKU细化",
      desc: "展开 HN运营组产品的 SKU库存；尚无 SKU 的新品展示为“SKU待生成”。",
    },
  };

  function num(value) {
    const parsed = Number(String(value == null ? "" : value).replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function normalizeColor(value) {
    const valueText = text(value);
    if (!valueText) return "";
    const match = valueText.match(/^(.+)_(?:[^_]+)$/);
    return match ? match[1] : valueText;
  }

  function minDate(current, next) {
    const value = text(next);
    if (!value || value === "-") return current || "";
    if (!current || value < current) return value;
    return current;
  }

  function maxDate(current, next) {
    const value = text(next);
    if (!value || value === "-") return current || "";
    if (!current || value > current) return value;
    return current;
  }

  function dateRange(start, end) {
    if (!start && !end) return "-";
    if (start && end && start !== end) return `${start.slice(0, 10)} ~ ${end.slice(0, 10)}`;
    return String(start || end).slice(0, 10);
  }

  function shanghaiDate(value) {
    const parsed = new Date(value || Date.now());
    if (Number.isNaN(parsed.getTime())) return "";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(parsed);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function inventorySnapshotStale(data) {
    if (window.__INVENTORY_SNAPSHOT_MODE__) return false;
    const snapshotDate = data && data.updatedAt ? shanghaiDate(data.updatedAt) : "";
    return !snapshotDate || snapshotDate !== shanghaiDate(Date.now());
  }

  function dateOnly(value) {
    return String(value || "").slice(0, 10);
  }

  function shanghaiCutoff(days) {
    const count = Number(days);
    if (!Number.isFinite(count) || count <= 0) return "";
    const today = shanghaiDate(Date.now());
    const date = new Date(`${today}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - count + 1);
    return date.toISOString().slice(0, 10);
  }

  function categoryLeaf(value) {
    const parts = text(value).split(/[>＞/／-]/).map((part) => part.trim()).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : "";
  }

  function joinedValues(values) {
    const list = Array.from(values || []).map((value) => text(value)).filter(Boolean);
    return list.slice(0, 4).join(" / ") + (list.length > 4 ? ` +${list.length - 4}` : "");
  }

  function statusTag(status) {
    const value = text(status) || "待补充";
    let cls = "blue";
    if (/重点推广|正常销售/.test(value)) cls = "green";
    else if (/新品/.test(value)) cls = "blue";
    else if (/清仓/.test(value)) cls = "red";
    else if (/暂停/.test(value)) cls = "amber";
    return `<span class="tag ${cls}">${esc(value)}</span>`;
  }

  function fbaStatusInfo(item) {
    const status = text(item.status)
      || (item.recordState === "completed" ? "已完成" : "有渠道");
    const etaEnd = dateOnly(item.etaEnd || item.estimatedArrivalEnd);
    const overdue = item.recordState !== "completed"
      && etaEnd
      && shanghaiDate(Date.now()) > etaEnd;
    return {
      status,
      overdue,
      note: overdue ? "时效异常" : "",
    };
  }

  function fbaStatusTag(info) {
    const cls = info.overdue ? "red" : info.status === "已完成" ? "green" : "blue";
    return `<span class="tag ${cls}">${esc(info.status)}</span>`;
  }

  async function loadData(force, date) {
    const key = date || "latest";
    if (!dataCache.has(key) || force) {
      const params = new URLSearchParams();
      if (date) params.set("date", date);
      params.set("t", String(Date.now()));
      const path = "/api/inventory-monitor?" + params.toString();
      dataCache.set(key, W.api(path).catch((error) => {
        dataCache.delete(key);
        throw error;
      }));
    }
    return dataCache.get(key);
  }

  function buildPurchaseIndex(rows) {
    const byModel = new Map();
    (rows || []).forEach((row) => {
      const model = text(row.spu);
      if (!model) return;
      const site = text(row.site) || "待确认";
      const key = [site, model].join("|").toLowerCase();
      if (!byModel.has(key)) {
        byModel.set(key, {
          model,
          site,
          key,
          qty: 0,
          batchCount: 0,
          earliestPurchase: "",
          earliestArrival: "",
          latestArrival: "",
          rows: [],
        });
      }
      const item = byModel.get(key);
      const qty = row.recordState === "completed" ? 0 : num(row.inTransitQty);
      item.qty += qty;
      if (qty > 0) item.batchCount += 1;
      if (qty <= 0) {
        item.rows.push(row);
        return;
      }
      item.earliestPurchase = minDate(item.earliestPurchase, row.sendTime && row.sendTime !== "-" ? row.sendTime : row.orderTime);
      item.earliestArrival = minDate(item.earliestArrival, row.expectedWarehouseTime);
      item.latestArrival = maxDate(item.latestArrival, row.expectedWarehouseTime);
      item.rows.push(row);
    });
    return byModel;
  }

  function purchaseForModel(index, model, site) {
    return index.get([text(site) || "待确认", text(model)].join("|").toLowerCase()) || {
      qty: 0,
      batchCount: 0,
      earliestPurchase: "",
      earliestArrival: "",
      latestArrival: "",
      rows: [],
    };
  }

  function buildModelRows(data) {
    const purchaseIndex = buildPurchaseIndex(data.purchaseInTransit);
    const groups = new Map();
    (data.colors || []).forEach((row) => {
      const model = text(row.model);
      if (!model) return;
      const site = text(row.site) || "待确认";
      const key = [site, model].join("|").toLowerCase();
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          model,
          site,
          colors: new Set(),
          accounts: new Set(),
          sites: new Set(),
          statuses: new Set(),
          salesSet: new Set(),
          categorySet: new Set(),
          planTimeSet: new Set(),
          domesticInWarehouse: 0,
          domesticInTransit: 0,
          fbaInWarehouse: 0,
          fbaInTransit: 0,
          fbaShippedAt: "",
          fbaEtaStart: "",
          fbaEtaEnd: "",
          fbaShipmentCount: 0,
          fbaMatchedQty: 0,
        });
      }
      const group = groups.get(key);
      group.colors.add(text(row.color));
      group.accounts.add(text(row.account));
      group.sites.add(text(row.site));
      group.statuses.add(text(row.status));
      group.salesSet.add(text(row.sales));
      group.categorySet.add(categoryLeaf(row.category));
      group.planTimeSet.add(text(row.planTime));
      group.domesticInWarehouse += num(row.domesticInWarehouse);
      group.domesticInTransit += num(row.domesticInTransit);
      group.fbaInWarehouse += num(row.fbaInWarehouse);
      group.fbaInTransit += num(row.fbaInTransit);
      group.fbaShippedAt = minDate(group.fbaShippedAt, row.fbaShippedAt);
      group.fbaEtaStart = minDate(group.fbaEtaStart, row.fbaEtaStart);
      group.fbaEtaEnd = maxDate(group.fbaEtaEnd, row.fbaEtaEnd);
    });

    (data.fbaShipments || []).forEach((shipment) => {
      (shipment.items || []).forEach((item) => {
        const itemModel = text(item.model || item.sku).split(/[-_]/)[0];
        if (!itemModel) return;
        const itemSite = fbaItemSite(item);
        const itemKey = [itemSite, itemModel].join("|").toLowerCase();
        if (!groups.has(itemKey)) {
          groups.set(itemKey, {
            key: itemKey,
            model: itemModel,
            site: itemSite,
            colors: new Set(),
            accounts: new Set(),
            sites: new Set(),
            statuses: new Set([shipment.recordState === "completed" ? "FBA已完结" : "FBA在途"]),
            salesSet: new Set(),
            categorySet: new Set(),
            planTimeSet: new Set(),
            domesticInWarehouse: 0,
            domesticInTransit: 0,
            fbaInWarehouse: 0,
            fbaInTransit: 0,
            fbaShippedAt: "",
            fbaEtaStart: "",
            fbaEtaEnd: "",
            fbaShipmentCount: 0,
            fbaMatchedQty: 0,
            snapshotFbaInTransit: 0,
          });
        }
        const group = groups.get(itemKey);
        const eta = fbaEta(shipment);
        if (!shipment.recordState || shipment.recordState === "in_transit") {
          group.fbaMatchedQty += fbaItemQty(item);
          group.fbaShippedAt = minDate(group.fbaShippedAt, fbaShippedAt(shipment));
          group.fbaEtaStart = minDate(group.fbaEtaStart, eta.start);
          group.fbaEtaEnd = maxDate(group.fbaEtaEnd, eta.end);
          if (shipment.groupId) {
            group.fbaShipmentIds = group.fbaShipmentIds || new Set();
            group.fbaShipmentIds.add(shipment.groupId);
          }
        }
      });
    });

    purchaseIndex.forEach((purchase) => {
      const key = [purchase.site || "待确认", purchase.model].join("|").toLowerCase();
      if (groups.has(key)) return;
      const related = Array.from(groups.values()).filter((group) => group.model === purchase.model);
      const archiveStatuses = new Set();
      const archiveSales = new Set();
      const archiveCategories = new Set();
      const archivePlanTimes = new Set();
      related.forEach((group) => {
        group.statuses.forEach((value) => archiveStatuses.add(value));
        group.salesSet.forEach((value) => archiveSales.add(value));
        group.categorySet.forEach((value) => archiveCategories.add(value));
        group.planTimeSet.forEach((value) => archivePlanTimes.add(value));
      });
      groups.set(key, {
        key,
        model: purchase.model,
        site: purchase.site || "待确认",
        colors: new Set(),
        accounts: new Set(),
        sites: new Set(),
        statuses: archiveStatuses.size ? archiveStatuses : new Set(["新品待上架"]),
        salesSet: archiveSales.size ? archiveSales : new Set(["未上架"]),
        categorySet: archiveCategories,
        planTimeSet: archivePlanTimes,
        domesticInWarehouse: 0,
        domesticInTransit: 0,
        fbaInWarehouse: 0,
        fbaInTransit: 0,
        fbaShippedAt: "",
        fbaEtaStart: "",
        fbaEtaEnd: "",
        fbaShipmentCount: 0,
        fbaMatchedQty: 0,
        snapshotFbaInTransit: 0,
        purchaseOnly: true,
      });
    });

    return Array.from(groups.values()).map((group) => {
      const purchase = purchaseForModel(purchaseIndex, group.model, group.site);
      purchase.rows.forEach((row) => {
        group.categorySet.add(categoryLeaf(row.categoryLevelStr));
        group.planTimeSet.add(text(row.planTime));
      });
      const fbaInTransit = num(group.fbaInTransit);
      const fbaMatchedQty = num(group.fbaMatchedQty);
      const domesticInTransit = Math.max(num(group.domesticInTransit), purchase.qty);
      return {
        ...group,
        colorCount: group.colors.size,
        accountCount: group.accounts.size,
        siteCount: group.sites.size,
        status: Array.from(group.statuses).filter(Boolean).join(" / "),
        salesText: joinedValues(group.salesSet),
        categoryText: joinedValues(group.categorySet),
        planTimeText: joinedValues(group.planTimeSet),
        domesticInTransit,
        fbaInTransit,
        fbaMatchedQty,
        fbaUnmatchedQty: Math.max(0, fbaInTransit - fbaMatchedQty),
        fbaShipmentCount: Math.max(group.fbaShipmentCount, group.fbaShipmentIds ? group.fbaShipmentIds.size : 0),
        purchaseInTransit: purchase.qty,
        purchaseBatches: purchase.batchCount,
        purchaseAt: purchase.earliestPurchase,
        domesticEtaStart: purchase.earliestArrival,
        domesticEtaEnd: purchase.latestArrival,
        totalStock: group.domesticInWarehouse + domesticInTransit + group.fbaInWarehouse + fbaInTransit,
        purchaseRows: purchase.rows,
      };
    }).sort((a, b) => b.totalStock - a.totalStock || String(a.model).localeCompare(String(b.model), "zh-CN"));
  }

  function buildColorRows(data) {
    const purchaseIndex = buildPurchaseIndex(data.purchaseInTransit);
    const archiveColors = new Set(
      (data.colors || []).map((row) => [text(row.model), normalizeColor(row.color)].join("|").toLowerCase()),
    );
    const shipmentColors = new Map();
    (data.fbaShipments || []).forEach((shipment) => {
      if (shipment.recordState === "completed") return;
      (shipment.items || []).forEach((item) => {
        const model = text(item.model || item.sku).split(/[-_]/)[0];
        const color = normalizeColor(item.color || item.sku);
        const site = fbaItemSite(item);
        const key = [site, model, color].join("|").toLowerCase();
        if (!archiveColors.has(key)) return;
        if (!shipmentColors.has(key)) {
          shipmentColors.set(key, {
            qty: 0,
            shippedAt: "",
            etaStart: "",
            etaEnd: "",
            batchCount: 0,
          });
        }
        const group = shipmentColors.get(key);
        const eta = fbaEta(shipment);
        group.qty += num(item.packingQty) || num(item.labelQty) || num(item.pickingQty) || num(item.applyQty);
        group.shippedAt = minDate(group.shippedAt, fbaShippedAt(shipment));
        group.etaStart = minDate(group.etaStart, eta.start);
        group.etaEnd = maxDate(group.etaEnd, eta.end);
        group.batchCount += shipment.groupId ? 1 : 0;
      });
    });

    const rows = (data.colors || []).map((row) => {
      const purchase = purchaseForModel(purchaseIndex, row.model, row.site);
      const shipment = shipmentColors.get([text(row.site) || "待确认", text(row.model), normalizeColor(row.color)].join("|").toLowerCase());
      const fbaInTransit = num(row.fbaInTransit);
      return {
        ...row,
        fbaInTransit,
        fbaShippedAt: minDate(row.fbaShippedAt, shipment ? shipment.shippedAt : ""),
        fbaEtaStart: minDate(row.fbaEtaStart, shipment ? shipment.etaStart : ""),
        fbaEtaEnd: maxDate(row.fbaEtaEnd, shipment ? shipment.etaEnd : ""),
        purchaseInTransit: purchase.qty,
        purchaseBatches: purchase.batchCount,
        purchaseAt: purchase.earliestPurchase,
        domesticEtaStart: purchase.earliestArrival,
        domesticEtaEnd: purchase.latestArrival,
        totalStock: num(row.domesticInWarehouse) + num(row.domesticInTransit)
          + num(row.fbaInWarehouse) + fbaInTransit,
        purchaseRows: purchase.rows,
      };
    });
    const modelsInListing = new Set(rows.map((row) => [text(row.site) || "待确认", text(row.model)].join("|").toLowerCase()));
    purchaseIndex.forEach((purchase) => {
      const key = [purchase.site || "待确认", purchase.model].join("|").toLowerCase();
      if (modelsInListing.has(key)) return;
      const related = rows.filter((item) => item.model === purchase.model);
      const relatedStatuses = Array.from(new Set(related.map((item) => text(item.status)).filter(Boolean)));
      const relatedSales = related.map((item) => text(item.sales)).find(Boolean);
      rows.push({
        account: "待上架",
        site: purchase.site || "待确认",
        model: purchase.model,
        color: "待上架",
        sales: relatedSales || "未上架",
        status: relatedStatuses.length ? relatedStatuses.join(" / ") : "新品待上架",
        domesticInWarehouse: 0,
        domesticInTransit: purchase.qty,
        fbaInWarehouse: 0,
        fbaInTransit: 0,
        fbaShippedAt: "",
        fbaEtaStart: "",
        fbaEtaEnd: "",
        purchaseInTransit: purchase.qty,
        purchaseBatches: purchase.batchCount,
        purchaseAt: purchase.earliestPurchase,
        domesticEtaStart: purchase.earliestArrival,
        domesticEtaEnd: purchase.latestArrival,
        totalStock: purchase.qty,
        purchaseRows: purchase.rows,
      });
    });
    return rows.sort((a, b) => b.totalStock - a.totalStock || String(a.model).localeCompare(String(b.model), "zh-CN"));
  }

  function warehouseValues(sku) {
    const warehouses = sku.warehouses || {};
    let domestic = 0;
    let fba = 0;
    Object.keys(warehouses).forEach((name) => {
      if (/FBA/i.test(name)) fba += num(warehouses[name]);
      else domestic += num(warehouses[name]);
    });
    return { domestic, fba };
  }

  function buildSkuRows(data) {
    const colorIndex = new Map();
    const archiveColors = new Set();
    const variantSites = new Map();
    (data.colors || []).forEach((row) => {
      const site = text(row.site) || "待确认";
      const variantKey = [text(row.model), normalizeColor(row.color)].join("|").toLowerCase();
      const key = [site, text(row.model), normalizeColor(row.color)].join("|").toLowerCase();
      archiveColors.add(key);
      if (!variantSites.has(variantKey)) variantSites.set(variantKey, new Set());
      variantSites.get(variantKey).add(site);
      if (!colorIndex.has(key)) {
        colorIndex.set(key, {
          accountStock: 0,
          domesticWarehouse: 0,
          domesticInTransit: 0,
          fbaWarehouse: 0,
          fbaInTransit: 0,
          statuses: new Set(),
          accounts: new Set(),
        });
      }
      const item = colorIndex.get(key);
      item.accountStock += num(row.totalStock);
      item.domesticWarehouse += num(row.domesticInWarehouse);
      item.domesticInTransit += num(row.domesticInTransit);
      item.fbaWarehouse += num(row.fbaInWarehouse);
      item.fbaInTransit += num(row.fbaInTransit);
      item.statuses.add(text(row.status));
      item.accounts.add(text(row.account));
    });

    const purchaseIndex = buildPurchaseIndex(data.purchaseInTransit);
    const fbaBySku = data.fbaBySku || {};
    const groups = new Map();

    (data.skuInventory || []).forEach((sku) => {
      const skuCode = text(sku.sku);
      if (!skuCode) return;
      const model = text(sku.spu);
      const color = normalizeColor(sku.color);
      const variantKey = [model, color].join("|").toLowerCase();
      const explicitSite = text(sku.site).toUpperCase();
      const sites = explicitSite ? [explicitSite] : Array.from(variantSites.get(variantKey) || []);
      if (!sites.length) return;
      const teamStockScope = sku.stockScope === "团队库存报表";
      const wh = warehouseValues(sku);
      sites.forEach((site) => {
        const siteKey = [site, model, color].join("|").toLowerCase();
        if (!archiveColors.has(siteKey)) return;
        const key = [site, skuCode].join("|").toLowerCase();
        groups.set(key, {
          key,
          sku: skuCode,
          site,
          model,
          color,
          name: text(sku.name),
          category: text(sku.category),
          stockScope: teamStockScope ? "团队库存报表" : "PDM SKU仓库库存",
          domesticInWarehouse: teamStockScope ? num(sku.domesticInWarehouse) : wh.domestic,
          fbaInWarehouse: teamStockScope ? num(sku.fbaInWarehouse) : wh.fba,
          fbaInTransit: teamStockScope ? num(sku.fbaInTransit) : 0,
          fbaShippedAt: "",
          fbaEtaStart: "",
          fbaEtaEnd: "",
          fbaGroups: new Set(),
        });
      });
    });

    Object.keys(fbaBySku).forEach((skuCode) => {
      const shipments = fbaBySku[skuCode] || [];
      shipments.forEach((shipment) => {
        const model = text(shipment.model || skuCode).split(/[-_]/)[0];
        const color = normalizeColor(shipment.color || skuCode);
        const site = text(shipment.site) || "待确认";
        if (!archiveColors.has([site, model, color].join("|").toLowerCase())) return;
        const key = [site, skuCode].join("|").toLowerCase();
        if (!groups.has(key)) {
          groups.set(key, {
            key,
            sku: skuCode,
            site,
            model,
            color,
            name: "",
            category: "",
            stockScope: "仅FBA在途",
            domesticInWarehouse: 0,
            fbaInWarehouse: 0,
            fbaInTransit: 0,
            fbaShippedAt: "",
            fbaEtaStart: "",
            fbaEtaEnd: "",
            fbaGroups: new Set(),
          });
        }
        const group = groups.get(key);
        const eta = fbaEta(shipment);
        if (group.stockScope !== "团队库存报表") {
          group.fbaInTransit += num(shipment.qty);
        }
        group.fbaShippedAt = minDate(group.fbaShippedAt, fbaShippedAt(shipment));
        group.fbaEtaStart = minDate(group.fbaEtaStart, eta.start);
        group.fbaEtaEnd = maxDate(group.fbaEtaEnd, eta.end);
        if (shipment.groupId) group.fbaGroups.add(shipment.groupId);
      });
    });

    const skuModels = new Set(Array.from(groups.values()).map((row) => [text(row.site), text(row.model)].join("|").toLowerCase()));
    purchaseIndex.forEach((purchase) => {
      const key = [purchase.site || "待确认", text(purchase.model)].join("|").toLowerCase();
      if (skuModels.has(key)) return;
      const relatedStatuses = Array.from(new Set(
        Array.from(groups.values())
          .filter((row) => text(row.model) === text(purchase.model))
          .flatMap((row) => Array.from(row.statuses || []))
          .map((value) => text(value))
          .filter(Boolean),
      ));
      groups.set(`${key}|__pending`, {
        key: `${key}|__pending`,
        sku: "SKU待生成",
        site: purchase.site || "待确认",
        model: purchase.model,
        color: "待上架",
        name: "",
        category: "",
        stockScope: "新品待上架",
        statusOverride: relatedStatuses.length ? relatedStatuses.join(" / ") : "",
        domesticInWarehouse: 0,
        domesticInTransit: purchase.qty,
        fbaInWarehouse: 0,
        fbaInTransit: 0,
        fbaShippedAt: "",
        fbaEtaStart: "",
        fbaEtaEnd: "",
        fbaGroups: new Set(),
      });
    });

    return Array.from(groups.values()).map((row) => {
      const colorKey = [text(row.site) || "待确认", row.model, row.color].join("|").toLowerCase();
      const colorStock = colorIndex.get(colorKey) || {
        accountStock: 0,
        domesticWarehouse: 0,
        domesticInTransit: 0,
        fbaWarehouse: 0,
        fbaInTransit: 0,
        statuses: new Set(),
        accounts: new Set(),
      };
      const purchase = purchaseForModel(purchaseIndex, row.model, row.site);
      const hasSkuStock = row.stockScope === "PDM SKU仓库库存";
      const teamStockScope = row.stockScope === "团队库存报表";
      const pendingListing = row.stockScope === "新品待上架";
      return {
        ...row,
        domesticInWarehouse: hasSkuStock ? row.domesticInWarehouse : colorStock.domesticWarehouse,
        fbaInWarehouse: teamStockScope ? row.fbaInWarehouse : (hasSkuStock ? row.fbaInWarehouse : colorStock.fbaWarehouse),
        domesticInTransit: pendingListing ? purchase.qty : (teamStockScope ? row.domesticInTransit : colorStock.domesticInTransit),
        accountStock: colorStock.accountStock,
        status: pendingListing
          ? (text(row.statusOverride) || "新品待上架")
          : Array.from(colorStock.statuses).filter(Boolean).join(" / "),
        accountCount: colorStock.accounts.size,
        purchaseInTransit: purchase.qty,
        purchaseAt: purchase.earliestPurchase,
        domesticEtaStart: purchase.earliestArrival,
        domesticEtaEnd: purchase.latestArrival,
        purchaseRows: purchase.rows,
      };
    }).sort((a, b) => (b.fbaInTransit - a.fbaInTransit) || (b.accountStock - a.accountStock));
  }

  function summarize(rows, scope, data) {
    if (scope === "sku") {
      const models = new Set(rows.map((row) => [text(row.site) || "待确认", text(row.model)].join("|").toLowerCase()).filter(Boolean));
      const colorByKey = new Map();
      (data.colors || []).forEach((row) => {
        const key = [text(row.site) || "待确认", text(row.model)].join("|").toLowerCase();
        if (!models.has(key)) return;
        if (!colorByKey.has(key)) {
          colorByKey.set(key, {
            domesticInWarehouse: 0,
            domesticInTransit: 0,
            fbaInWarehouse: 0,
            fbaInTransit: 0,
          });
        }
        const item = colorByKey.get(key);
        item.domesticInWarehouse += num(row.domesticInWarehouse);
        item.domesticInTransit += num(row.domesticInTransit);
        item.fbaInWarehouse += num(row.fbaInWarehouse);
        item.fbaInTransit += num(row.fbaInTransit);
      });
      const purchaseByKey = new Map();
      (data.purchaseInTransit || []).forEach((row) => {
        const key = [text(row.site) || "待确认", text(row.spu)].join("|").toLowerCase();
        if (models.has(key) && row.recordState !== "completed") {
          purchaseByKey.set(key, num(purchaseByKey.get(key)) + num(row.inTransitQty));
        }
      });
      const summary = {
        domesticInWarehouse: 0,
        domesticInTransit: 0,
        fbaInWarehouse: 0,
        fbaInTransit: 0,
        purchaseInTransit: 0,
      };
      models.forEach((key) => {
        const colors = colorByKey.get(key) || {
          domesticInWarehouse: 0,
          domesticInTransit: 0,
          fbaInWarehouse: 0,
          fbaInTransit: 0,
        };
        const purchase = num(purchaseByKey.get(key));
        summary.domesticInWarehouse += colors.domesticInWarehouse;
        summary.domesticInTransit += Math.max(colors.domesticInTransit, purchase);
        summary.fbaInWarehouse += colors.fbaInWarehouse;
        summary.fbaInTransit += colors.fbaInTransit;
        summary.purchaseInTransit += purchase;
      });
      const shipmentModels = new Set();
      (data.fbaShipments || []).forEach((shipment) => {
        if (shipment.recordState === "completed") return;
        (shipment.items || []).forEach((item) => {
          const model = text(item.model || item.sku).split(/[-_]/)[0];
        const site = fbaItemSite(item);
          const key = [site, model].join("|").toLowerCase();
          if (!models.has(key)) return;
          shipmentModels.add(shipment.groupId || key);
        });
      });
      summary.totalStock = summary.domesticInWarehouse + summary.domesticInTransit
        + summary.fbaInWarehouse + summary.fbaInTransit;
      summary.batchCount = (data.purchaseInTransit || []).filter((row) => models.has([text(row.site) || "待确认", text(row.spu)].join("|").toLowerCase()) && row.recordState !== "completed" && num(row.inTransitQty) > 0).length
        + shipmentModels.size;
      return summary;
    }
    const summary = rows.reduce((acc, row) => {
      acc.domesticInWarehouse += num(row.domesticInWarehouse);
      acc.domesticInTransit += num(row.domesticInTransit);
      acc.fbaInWarehouse += num(row.fbaInWarehouse);
      acc.fbaInTransit += num(row.fbaInTransit);
      return acc;
    }, {
      domesticInWarehouse: 0,
      domesticInTransit: 0,
      fbaInWarehouse: 0,
      fbaInTransit: 0,
      purchaseInTransit: 0,
    });
    summary.purchaseInTransit = data.purchaseInTransitTotal != null
      ? num(data.purchaseInTransitTotal)
      : (data.purchaseInTransit || [])
        .filter((row) => row.recordState !== "completed")
        .reduce((sum, row) => sum + num(row.inTransitQty), 0);
    summary.totalStock = summary.domesticInWarehouse + summary.domesticInTransit
      + summary.fbaInWarehouse + summary.fbaInTransit;
    summary.batchCount = data.purchaseBatchCount != null
      ? num(data.purchaseBatchCount) + num(data.fbaBatchCount)
      : (data.purchaseInTransit || []).filter((row) => row.recordState !== "completed" && num(row.inTransitQty) > 0).length
        + (data.fbaShipments || []).filter((shipment) => shipment.recordState !== "completed").length;
    return summary;
  }

  function filterRows(rows, state) {
    const q = text(state.query).toLowerCase();
    const model = text(state.model);
    const site = text(state.site);
    const sales = text(state.sales);
    const category = text(state.category);
    const planTime = text(state.planTime);
    const status = text(state.status);
    return rows.filter((row) => {
      if (state.onlyActive) {
        const stock = num(row.totalStock)
          + num(row.domesticInWarehouse)
          + num(row.fbaInWarehouse)
          + num(row.domesticInTransit)
          + num(row.fbaInTransit)
          + num(row.purchaseInTransit);
        if (!stock) return false;
      }
      if (model && text(row.model) !== model) return false;
      if (site && text(row.site) !== site) return false;
      if (sales && !text(row.salesText).split(" / ").includes(sales)) return false;
      if (category && !text(row.categoryText).split(" / ").includes(category)) return false;
      if (planTime && !text(row.planTimeText).split(" / ").includes(planTime)) return false;
      if (status && !text(row.status).includes(status)) return false;
      if (!q) return true;
      return [
        row.model,
        row.color,
        row.sku,
        row.site,
        row.name,
        row.category,
        row.categoryText,
        row.sales,
        row.salesText,
        row.planTime,
        row.planTimeText,
        row.status,
      ].some((value) => text(value).toLowerCase().includes(q));
    });
  }

  function metric(label, value, sub, cls) {
    return `<div class="stat-card ${cls || ""}"><div class="label">${esc(label)}</div><div class="value">${esc(fmtNum(value, 0))}</div><div class="sub">${esc(sub || "")}</div></div>`;
  }

  function renderSummary(summary, state, data) {
    const skuPartial = state.scope === "sku" && data.sources && data.sources.skuInventory && data.sources.skuInventory.partial;
    const coverage = data.skuCoverage || {};
    const coverageText = coverage.totalModels
      ? `SKU 映射已覆盖 ${fmtNum(coverage.coveredModels, 0)} / ${fmtNum(coverage.totalModels, 0)} 个型号，仍缺 ${fmtNum(coverage.missingModels, 0)} 个；其中已建档未映射 ${fmtNum(coverage.missingListingModels, 0)} 个，未上架新品 ${fmtNum(coverage.pendingNewModels, 0)} 个。`
      : "SKU 映射当前为分批缓存结果。";
    const purchaseSource = data.sources && data.sources.purchaseInTransit;
    const fbaSource = data.sources && data.sources.fbaInTransit;
    const purchaseNotice = purchaseSource && purchaseSource.rowCount < purchaseSource.reportedTotal
      ? `<div class="inventory-notice"><i data-lucide="Info"></i><span>采购在途接口报告 ${esc(fmtNum(purchaseSource.reportedTotal, 0))} 条，逐页实取 ${esc(fmtNum(purchaseSource.rowCount, 0))} 条唯一记录。</span></div>`
      : "";
    const splitErrors = purchaseSource && purchaseSource.apsTeamSplit && Array.isArray(purchaseSource.apsTeamSplit.errors)
      ? purchaseSource.apsTeamSplit.errors.length
      : 0;
    const fbaDetailErrors = fbaSource ? num(fbaSource.detailErrorCount) : 0;
    const splitNotice = splitErrors
      ? `<div class="inventory-notice"><i data-lucide="TriangleAlert"></i><span>APS 团队拆分有 ${esc(fmtNum(splitErrors, 0))} 批未完成，相关采购记录暂归“待确认”。</span></div>`
      : "";
    const fbaNotice = fbaDetailErrors
      ? `<div class="inventory-notice"><i data-lucide="TriangleAlert"></i><span>FBA 有 ${esc(fmtNum(fbaDetailErrors, 0))} 张调拨单明细未取到，请重新登录 OA 后同步。</span></div>`
      : "";
    const staleNotice = inventorySnapshotStale(data)
      ? `<div class="inventory-notice"><i data-lucide="TriangleAlert"></i><span>当前展示的是${data.updatedAt ? ` ${esc(shanghaiDate(data.updatedAt))} ` : "历史"}旧快照，FBA 调拨明细可能未包含最新调拨单。请重新登录 OA 并同步。</span></div>`
      : "";
    const summaryDate = state.selectedDates?.length > 1
      ? ` · 指标口径 ${esc(state.selectedDates[0])}`
      : "";
    return `
      ${skuPartial ? `<div class="inventory-notice"><i data-lucide="Info"></i><span>${esc(coverageText)} 可点击“同步OA”补齐。</span></div>` : ""}
      ${purchaseNotice}
      ${splitNotice}
      ${fbaNotice}
      ${staleNotice}
      <div class="grid-4 inventory-summary">
        ${metric("国内在仓", summary.domesticInWarehouse, "团队库存报表 华南服装仓", "ok")}
        ${metric("国内在途", summary.domesticInTransit, `${fmtNum(summary.purchaseInTransit, 0)} 件采购在途`, "warn")}
        ${metric("FBA总库存", summary.fbaInWarehouse + num(summary.fbaInTransit), `FBA在仓 ${fmtNum(summary.fbaInWarehouse, 0)} + FBA在途 ${fmtNum(summary.fbaInTransit, 0)}`, "accent")}
        ${metric("FBA在途", summary.fbaInTransit, `${fmtNum(summary.batchCount, 0)} 个在途批次`, "down")}
      </div>
      <div class="inventory-total-row">
        <span>当前视图总库存</span>
        <strong>${esc(fmtNum(summary.totalStock, 0))}</strong>
        <span class="muted">范围：${esc(state.scope === "sku" ? "SKU" : state.scope === "color" ? "账号花色" : "型号汇总")} · 筛选后 ${esc(fmtNum(state.filteredCount, 0))} 行${summaryDate}</span>
      </div>
    `;
  }

  function renderTable(rows, state) {
    if (!rows.length) {
      return `<div class="empty-state"><i data-lucide="PackageSearch"></i><p>没有匹配的库存数据</p></div>`;
    }
    if (state.scope === "model") {
      return `
        <div class="table-wrap inventory-table-wrap">
          <table class="data-table inventory-table">
            <thead><tr>
              <th>型号</th><th>站点</th><th>销售</th><th>分类</th><th>企划</th><th class="num">花色</th><th class="num">账号</th>
              <th class="num">国内在仓</th><th class="num">国内在途</th>
              <th class="num">FBA总库存</th><th class="num">FBA在途</th><th class="num">总库存</th>
              <th class="num">采购在途</th><th>预计到国内仓</th>
              <th class="num">FBA批次</th><th>发货时间</th><th>预计到FBA</th><th>状态</th>
            </tr></thead>
            <tbody>${rows.map((row, index) => `
              <tr>
                <td><button class="link-button inventory-detail" data-index="${index}">${esc(row.model)}</button></td>
                <td>${esc(row.site || "待确认")}</td>
                <td>${esc(row.salesText || "-")}</td>
                <td>${esc(row.categoryText || "-")}</td>
                <td>${esc(row.planTimeText || "-")}</td>
                <td class="num">${esc(fmtNum(row.colorCount, 0))}</td>
                <td class="num">${esc(fmtNum(row.accountCount, 0))}</td>
                <td class="num">${esc(fmtNum(row.domesticInWarehouse, 0))}</td>
                <td class="num">${esc(fmtNum(row.domesticInTransit, 0))}</td>
                <td class="num">${esc(fmtNum(num(row.fbaInWarehouse) + num(row.fbaInTransit), 0))}</td>
                <td class="num">${esc(fmtNum(row.fbaInTransit, 0))}</td>
                <td class="num inventory-strong">${esc(fmtNum(row.totalStock, 0))}</td>
                <td class="num">${esc(fmtNum(row.purchaseInTransit, 0))}</td>
                <td>${esc(dateRange(row.domesticEtaStart, row.domesticEtaEnd))}</td>
                <td class="num">${esc(fmtNum(row.fbaShipmentCount, 0))}</td>
                <td>${esc(row.fbaShippedAt ? row.fbaShippedAt.slice(0, 16) : "-")}</td>
                <td>${esc(dateRange(row.fbaEtaStart, row.fbaEtaEnd))}</td>
                <td>${statusTag(row.status)}</td>
              </tr>
            `).join("")}</tbody>
          </table>
        </div>
      `;
    }
    if (state.scope === "color") {
      return `
        <div class="table-wrap inventory-table-wrap">
          <table class="data-table inventory-table">
            <thead><tr>
              <th>账号</th><th>站点</th><th>型号</th><th>花色</th><th>状态</th>
              <th class="num">国内在仓</th><th class="num">国内在途</th><th class="num">FBA总库存</th><th class="num">FBA在途</th>
              <th class="num">总库存</th><th class="num">型号采购在途</th><th>预计到国内仓</th>
              <th>FBA发货时间</th><th>预计到FBA</th>
            </tr></thead>
            <tbody>${rows.map((row, index) => `
              <tr>
                <td>${esc(row.account || "-")}</td>
                <td>${esc(row.site || "-")}</td>
                <td>${esc(row.model)}</td>
                <td><button class="link-button inventory-detail" data-index="${index}">${esc(row.color)}</button></td>
                <td>${statusTag(row.status)}</td>
                <td class="num">${esc(fmtNum(row.domesticInWarehouse, 0))}</td>
                <td class="num">${esc(fmtNum(row.domesticInTransit, 0))}</td>
                <td class="num">${esc(fmtNum(num(row.fbaInWarehouse) + num(row.fbaInTransit), 0))}</td>
                <td class="num">${esc(fmtNum(row.fbaInTransit, 0))}</td>
                <td class="num inventory-strong">${esc(fmtNum(row.totalStock, 0))}</td>
                <td class="num">${esc(fmtNum(row.purchaseInTransit, 0))}</td>
                <td>${esc(dateRange(row.domesticEtaStart, row.domesticEtaEnd))}</td>
                <td>${esc(row.fbaShippedAt ? row.fbaShippedAt.slice(0, 16) : "-")}</td>
                <td>${esc(dateRange(row.fbaEtaStart, row.fbaEtaEnd))}</td>
              </tr>
            `).join("")}</tbody>
          </table>
        </div>
      `;
    }
    return `
      <div class="table-wrap inventory-table-wrap">
        <table class="data-table inventory-table">
          <thead><tr>
            <th>SKU</th><th>站点</th><th>型号</th><th>花色</th><th>库存口径</th>
            <th class="num">国内在仓</th><th class="num">FBA总库存</th><th class="num">国内在途</th><th class="num">FBA在途</th>
            <th class="num">账号花色总库存</th><th class="num">型号采购在途</th>
            <th>FBA发货时间</th><th>预计到FBA</th><th>状态</th>
          </tr></thead>
          <tbody>${rows.map((row, index) => `
            <tr>
              <td><button class="link-button inventory-detail" data-index="${index}">${esc(row.sku)}</button></td>
              <td>${esc(row.site || "待确认")}</td>
              <td>${esc(row.model || "-")}</td>
              <td>${esc(row.color || "-")}</td>
              <td><span class="tag ${row.stockScope === "PDM SKU仓库库存" ? "green" : "amber"}">${esc(row.stockScope)}</span></td>
              <td class="num">${esc(fmtNum(row.domesticInWarehouse, 0))}</td>
              <td class="num">${esc(fmtNum(num(row.fbaInWarehouse) + num(row.fbaInTransit), 0))}</td>
              <td class="num">${esc(fmtNum(row.domesticInTransit, 0))}</td>
              <td class="num">${esc(fmtNum(row.fbaInTransit, 0))}</td>
              <td class="num inventory-strong">${esc(fmtNum(row.accountStock, 0))}</td>
              <td class="num">${esc(fmtNum(row.purchaseInTransit, 0))}</td>
              <td>${esc(row.fbaShippedAt ? row.fbaShippedAt.slice(0, 16) : "-")}</td>
              <td>${esc(dateRange(row.fbaEtaStart, row.fbaEtaEnd))}</td>
              <td>${statusTag(row.status)}</td>
            </tr>
          `).join("")}</tbody>
        </table>
      </div>
    `;
  }

  function renderSnapshotTables(rows, state) {
    const groups = new Map();
    rows.forEach((row) => {
      const date = text(row.snapshotDate) || "latest";
      if (!groups.has(date)) groups.set(date, []);
      groups.get(date).push(row);
    });
    return Array.from(groups.entries()).map(([date, groupRows]) => {
      const total = groupRows.reduce((sum, row) => sum + num(row.totalStock), 0);
      const label = date === "latest" ? "最新快照" : `${date} 中国快照`;
      return `
        <section class="inventory-snapshot-block">
          <div class="inventory-snapshot-head">
            <strong>${esc(label)}</strong>
            <span>筛选后 ${esc(fmtNum(groupRows.length, 0))} 行 · 总库存 ${esc(fmtNum(total, 0))}</span>
          </div>
          ${renderTable(groupRows, state)}
        </section>
      `;
    }).join("");
  }

  function renderPager(state, total, pageSize) {
    const size = Math.max(1, Number(pageSize) || state.pageSize);
    const pages = Math.max(1, Math.ceil(total / size));
    state.page = Math.min(state.page, pages);
    const start = total ? (state.page - 1) * size + 1 : 0;
    const end = Math.min(total, state.page * size);
    return `
      <div class="inventory-pager">
        <span>${esc(fmtNum(start, 0))}-${esc(fmtNum(end, 0))} / ${esc(fmtNum(total, 0))}</span>
        <div class="inventory-pager-actions">
          <button class="btn btn-sm" data-page="${state.page - 1}" ${state.page <= 1 ? "disabled" : ""}><i data-lucide="ChevronLeft"></i>上一页</button>
          <span>${esc(String(state.page))} / ${esc(String(pages))}</span>
          <button class="btn btn-sm" data-page="${state.page + 1}" ${state.page >= pages ? "disabled" : ""}>下一页<i data-lucide="ChevronRight"></i></button>
        </div>
      </div>
    `;
  }

  function aggregateFbaRows(rows) {
    const groups = new Map();
    rows.forEach((item) => {
      const groupId = item.groupId || "未关联调拨单";
      if (!groups.has(groupId)) {
        groups.set(groupId, {
          groupId,
          status: item.status || "",
          recordState: item.recordState || "in_transit",
          channelName: item.channelName || "",
          auditAt: item.auditAt || "",
          salesProcessingTime: item.salesProcessingTime || "",
          shippedAt: item.shippedAt || "",
          shippingMode: item.shippingMode || "",
          etaStart: item.etaStart || "",
          etaEnd: item.etaEnd || "",
          qty: 0,
          itemCount: 0,
          skuItems: new Map(),
        });
      }
      const group = groups.get(groupId);
      group.qty += num(item.qty);
      group.itemCount += 1;
      const skuKey = [text(item.site), text(item.sku)].join("|").toLowerCase();
      if (!group.skuItems.has(skuKey)) {
        group.skuItems.set(skuKey, {
          sku: text(item.sku),
          site: text(item.site),
          color: text(item.color || item.sku),
          applyQty: 0,
          pickingQty: 0,
          labelQty: 0,
          packingQty: 0,
          packingDate: text(item.packingDate),
        });
      }
      const skuItem = group.skuItems.get(skuKey);
      skuItem.applyQty += num(item.applyQty);
      skuItem.pickingQty += num(item.pickingQty);
      skuItem.labelQty += num(item.labelQty);
      skuItem.packingQty += num(item.packingQty);
      if (!skuItem.packingDate || text(item.packingDate) > skuItem.packingDate) {
        skuItem.packingDate = text(item.packingDate);
      }
    });
    return Array.from(groups.values()).map((group) => ({
      ...group,
      skuItems: Array.from(group.skuItems.values()).sort((a, b) => (
        text(a.sku).localeCompare(text(b.sku), "zh-CN", { numeric: true })
        || text(a.site).localeCompare(text(b.site))
      )),
    }));
  }

  function findUpdatedRow(rows, row, scope) {
    const sameSnapshot = (item) => text(item.snapshotDate) === text(row.snapshotDate);
    if (scope === "model") {
      return rows.find((item) => sameSnapshot(item)
        && text(item.model) === text(row.model)
        && text(item.site) === text(row.site)) || row;
    }
    if (scope === "color") {
      return rows.find((item) => sameSnapshot(item)
        && text(item.account) === text(row.account)
        && text(item.site) === text(row.site)
        && text(item.model) === text(row.model)
        && normalizeColor(item.color) === normalizeColor(row.color)) || row;
    }
    return rows.find((item) => sameSnapshot(item) && text(item.sku) === text(row.sku)) || row;
  }

  function showFloatingNote(anchor, note) {
    document.querySelectorAll(".inventory-note-popover").forEach((item) => item.remove());
    if (!note || note === "-") return;
    const popover = document.createElement("div");
    popover.className = "inventory-note-popover";
    popover.textContent = note;
    document.body.appendChild(popover);
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(460, Math.max(260, window.innerWidth - 24));
    popover.style.width = width + "px";
    popover.style.left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left)) + "px";
    popover.style.top = Math.min(window.innerHeight - 80, rect.bottom + 6) + "px";
    setTimeout(() => {
      document.addEventListener("pointerdown", () => popover.remove(), { once: true });
    }, 0);
  }

  function showOaLoginModal(onSuccess) {
    const root = W.$("#modal-root");
    if (!root) return;
    let oaDepartment = "";
    root.innerHTML = `
      <div class="modal-mask" id="inventory-oa-login">
        <div class="modal" style="max-width:460px">
          <div class="modal-head">
            <h3>登录亚飞 OA</h3>
            <button class="modal-close" data-oa-close aria-label="关闭">×</button>
          </div>
          <div class="modal-body">
            <p class="hint">登录成功后会自动继续同步库存。</p>
            <div style="display:grid;gap:8px;margin-top:12px">
              <label style="font-size:12.5px;color:var(--ink-2)">OA 用户名</label>
              <input id="inventory-oa-user" value="maling" style="padding:8px 10px;border:1px solid var(--line-strong);border-radius:6px;font-size:13px" />
              <label style="font-size:12.5px;color:var(--ink-2)">OA 密码</label>
              <input type="password" id="inventory-oa-password" style="padding:8px 10px;border:1px solid var(--line-strong);border-radius:6px;font-size:13px" />
              <div style="display:flex;gap:8px;align-items:center;margin-top:4px">
                <button class="btn btn-sm" id="inventory-oa-send"><i data-lucide="Send"></i>发送钉钉验证码</button>
                <span id="inventory-oa-status" style="font-size:12px;color:var(--muted)"></span>
              </div>
              <label style="font-size:12.5px;color:var(--ink-2);margin-top:8px">钉钉验证码</label>
              <input id="inventory-oa-code" style="padding:8px 10px;border:1px solid var(--line-strong);border-radius:6px;font-size:13px" />
              <button class="btn btn-primary" id="inventory-oa-submit" style="margin-top:14px"><i data-lucide="LogIn"></i>登录并继续同步</button>
            </div>
          </div>
        </div>
      </div>
    `;
    W.initIcons(root);
    const close = () => { root.innerHTML = ""; };
    root.querySelector("[data-oa-close]").addEventListener("click", close);
    root.querySelector("#inventory-oa-login").addEventListener("click", (event) => {
      if (event.target.id === "inventory-oa-login") close();
    });
    root.querySelector("#inventory-oa-send").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const status = root.querySelector("#inventory-oa-status");
      button.disabled = true;
      status.textContent = "发送中…";
      try {
        const username = root.querySelector("#inventory-oa-user").value.trim();
        const data = await W.api("/api/oa/send-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username }),
        });
        status.textContent = data.ok ? "验证码已发送，请查收钉钉" : (data.error || "发送失败");
        status.style.color = data.ok ? "var(--ok)" : "var(--down)";
        if (data.ok) {
          oaDepartment = data.department || "";
          const codeInput = root.querySelector("#inventory-oa-code");
          if (codeInput) {
            codeInput.value = "";
            codeInput.focus();
          }
        }
      } catch (error) {
        status.textContent = "发送失败：" + error.message;
        status.style.color = "var(--down)";
      } finally {
        button.disabled = false;
      }
    });
    root.querySelector("#inventory-oa-submit").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const username = root.querySelector("#inventory-oa-user").value.trim();
      const password = root.querySelector("#inventory-oa-password").value;
      const code = root.querySelector("#inventory-oa-code").value.trim();
      if (!username || !password || !code) {
        W.toast("请输入 OA 用户名、密码和钉钉验证码", "error");
        return;
      }
      button.disabled = true;
      button.innerHTML = `<i data-lucide="LoaderCircle" class="spin"></i>登录中`;
      W.initIcons(button);
      try {
        const result = await W.api("/api/oa/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password, code, department: oaDepartment || 1 }),
        });
        if (!result.ok) {
          const message = String(result.message || result.error || "OA 登录失败").replace(/^OA_ERROR:\s*/, "");
          const status = root.querySelector("#inventory-oa-status");
          if (status) {
            status.textContent = /验证码/.test(message)
              ? "验证码错误或已过期，请重新发送验证码后重试"
              : message;
            status.style.color = "var(--down)";
          }
          if (/验证码/.test(message)) {
            const codeInput = root.querySelector("#inventory-oa-code");
            if (codeInput) codeInput.value = "";
          }
          W.toast(message, "error");
          return;
        }
        close();
        W.toast("OA 登录成功，正在继续同步", "success");
        onSuccess();
      } catch (error) {
        W.toast("登录失败：" + error.message, "error");
      } finally {
        if (root.querySelector("#inventory-oa-submit")) {
          button.disabled = false;
          button.innerHTML = `<i data-lucide="LogIn"></i>登录并继续同步`;
          W.initIcons(button);
        }
      }
    });
  }

  function openDetail(root, row, scope, data, detailView) {
    const purchaseRows = (row.purchaseRows || []).slice().sort((a, b) => (
      text(b.orderTime).localeCompare(text(a.orderTime))
    ));
    const fbaRows = [];
    (data.fbaShipments || []).forEach((shipment) => {
      const eta = fbaEta(shipment);
      (shipment.items || []).forEach((item) => {
        const itemModel = text(item.model || item.sku).split(/[-_]/)[0];
        const itemColor = normalizeColor(item.color || item.sku);
        const itemSite = fbaItemSite(item);
        const matches = scope === "sku"
          ? text(item.sku) === text(row.sku) && itemSite === text(row.site)
          : scope === "color"
            ? itemModel === text(row.model) && itemColor === normalizeColor(row.color) && itemSite === text(row.site)
            : itemModel === text(row.model) && itemSite === text(row.site);
        if (matches) {
          fbaRows.push({
            ...item,
            qty: num(item.qty) || fbaItemQty(item),
            groupId: shipment.groupId || item.groupId || "",
            status: shipment.status || item.status || "",
            recordState: shipment.recordState || item.recordState || "",
            channelName: shipment.channelName || item.channelName || "",
            auditAt: shipment.auditAt || item.auditAt || "",
            salesProcessingTime: shipment.salesProcessingTime || item.salesProcessingTime || "",
            shippedAt: fbaShippedAt(shipment) || item.shippedAt || "",
            shippingMode: shipment.shippingMode || item.shippingMode || "",
            estimatedArrivalStart: shipment.estimatedArrivalStart || item.estimatedArrivalStart || "",
            estimatedArrivalEnd: shipment.estimatedArrivalEnd || item.estimatedArrivalEnd || "",
            etaStart: eta.start,
            etaEnd: eta.end,
          });
        }
      });
    });
    fbaRows.sort((a, b) => (
      text(b.shippedAt || b.auditAt).localeCompare(text(a.shippedAt || a.auditAt))
    ));
    const shipmentRows = aggregateFbaRows(fbaRows)
      .sort((a, b) => text(b.shippedAt || b.auditAt).localeCompare(text(a.shippedAt || a.auditAt)));
    const fbaInTransit = num(row.fbaInTransit);
    const matchedFbaQty = shipmentRows
      .filter((item) => item.recordState === "in_transit")
      .reduce((sum, item) => sum + num(item.qty), 0);
    const fbaDifference = fbaInTransit - matchedFbaQty;
    const unmatchedFbaQty = Math.max(0, fbaDifference);
    const extraFbaQty = Math.max(0, -fbaDifference);
    const reconciliationNote = unmatchedFbaQty
      ? `库存报表 FBA在途 ${fmtNum(fbaInTransit, 0)}，已匹配调拨明细 ${fmtNum(matchedFbaQty, 0)}，尚有 ${fmtNum(unmatchedFbaQty, 0)} 件未匹配到调拨单。`
      : extraFbaQty
        ? `调拨明细在途 ${fmtNum(matchedFbaQty, 0)}，库存报表 FBA在途 ${fmtNum(fbaInTransit, 0)}，明细多出 ${fmtNum(extraFbaQty, 0)} 件。`
        : "";
    const overrides = readFbaLeadOverrides();
    const purchaseFollowup = (item) => {
      if (Array.isArray(item.followupLogs) && item.followupLogs.length) {
        return item.followupLogs.join("\n");
      }
      if (text(item.followupText)) return text(item.followupText);
      const date = text(item.purchaseUserTime || item.updatedAt || item.orderTime);
      const note = text(item.remark || item.purchaseUserRemark || "-");
      if (!date || note.startsWith(date)) return note;
      return `${date} ${note}`;
    };
    const purchaseSection = scope === "model"
      ? `${purchaseRows.length ? `
          <div class="inventory-detail-scroll">
            <table class="data-table">
              <thead><tr><th>采购单号</th><th>SPU</th><th>供应商</th><th>采购时间</th><th class="num">数量</th><th>预计到仓</th><th>状态</th><th>采购跟进备注</th></tr></thead>
              <tbody>${purchaseRows.map((item) => `
                <tr data-detail-date="${esc(dateOnly(item.orderTime || item.purchaseUserTime || item.updatedAt))}" data-record-state="${esc(item.recordState || "in_transit")}">
                  <td>${esc(item.purchaseOrder)}</td>
                  <td>${esc(item.spu)}</td>
                  <td>${esc(item.supplier)}</td>
                  <td>${esc(item.orderTime || "-")}</td>
                  <td class="num">${esc(fmtNum(item.recordState === "completed" ? item.warehouseQty : item.inTransitQty, 0))}</td>
                  <td>${esc(item.recordState === "completed" ? "-" : (item.expectedWarehouseTime || "-"))}</td>
                  <td>${esc(item.recordState === "completed" ? "已完结" : (item.productionState || item.sendOrderState || "在途中"))}</td>
                  <td class="purchase-followup-cell">
                    <button type="button" class="purchase-note" data-note="${esc(purchaseFollowup(item))}" title="${esc(purchaseFollowup(item))}">
                      <span>${esc(purchaseFollowup(item))}</span>
                    </button>
                  </td>
                </tr>
              `).join("")}</tbody>
            </table>
          </div>
        ` : `<p class="hint">当前型号没有国内采购明细。</p>`}`
      : `<p class="hint">国内采购单按型号级维护，无法拆分到${scope === "color" ? "花色" : "SKU"}；上方指标为该${scope === "color" ? "花色" : "SKU"}维度的国内仓库存。</p>`;
    const shipmentTable = scope === "sku"
      ? fbaRows.map((item) => {
        const info = fbaStatusInfo(item);
        return `
          <tr data-detail-date="${esc(dateOnly(item.shippedAt || item.auditAt))}" data-record-state="${esc(item.recordState || "in_transit")}"><td>${esc(item.sku)}</td><td><button type="button" class="link-button inventory-shipment-sku-link" data-shipment-group="${esc(item.groupId)}" title="查看该调拨单的 SKU 装箱明细">${esc(item.groupId)}</button></td><td>${fbaStatusTag(info)}</td><td>${esc(item.auditAt || "-")}</td><td>${esc(item.salesProcessingTime || "-")}</td><td>${esc(item.shippedAt || "-")}</td><td class="num">${esc(fmtNum(item.qty, 0))}</td><td>${esc(item.shippingModeLabel || fbaShippingModeLabel(item.shippingMode) || "-")}</td><td>${esc(dateRange(item.etaStart, item.etaEnd))}</td><td class="${info.overdue ? "inventory-anomaly-text" : "pf-na"}">${esc(info.note || "-")}</td></tr>
        `;
      }).join("")
      : shipmentRows.map((item) => {
        const info = fbaStatusInfo(item);
        return `
          <tr data-detail-date="${esc(dateOnly(item.shippedAt || item.auditAt))}" data-record-state="${esc(item.recordState || "in_transit")}"><td><button type="button" class="link-button inventory-shipment-sku-link" data-shipment-group="${esc(item.groupId)}" title="查看该调拨单的 SKU 装箱明细">${esc(item.groupId)}</button></td><td>${fbaStatusTag(info)}</td><td>${esc(item.auditAt || "-")}</td><td>${esc(item.salesProcessingTime || "-")}</td><td>${esc(item.shippedAt || "-")}</td><td class="num">${esc(fmtNum(item.qty, 0))}</td><td>${esc(item.shippingModeLabel || fbaShippingModeLabel(item.shippingMode) || "-")}</td><td>${esc(dateRange(item.etaStart, item.etaEnd))}</td><td class="${info.overdue ? "inventory-anomaly-text" : "pf-na"}">${esc(info.note || "-")}</td></tr>
        `;
      }).join("");
    const fbaHead = scope === "sku"
      ? "<tr><th>SKU</th><th>调拨单号</th><th>状态</th><th>审核时间</th><th>销售处理</th><th>实际发货时间</th><th class=\"num\">数量</th><th>物流方式</th><th>预计到FBA</th><th>异常备注</th></tr>"
      : "<tr><th>调拨单号</th><th>状态</th><th>审核时间</th><th>销售处理</th><th>实际发货时间</th><th class=\"num\">数量</th><th>物流方式</th><th>预计到FBA</th><th>异常备注</th></tr>";
    const unmatchedRow = unmatchedFbaQty
      ? scope === "sku"
        ? `<tr data-detail-date="" data-record-state="in_transit"><td>-</td><td>待匹配调拨批次</td><td><span class="tag amber">待匹配</span></td><td>-</td><td>-</td><td>-</td><td class="num">${esc(fmtNum(unmatchedFbaQty, 0))}</td><td>-</td><td>-</td><td class="inventory-anomaly-text">未匹配到调拨单</td></tr>`
        : `<tr data-detail-date="" data-record-state="in_transit"><td>待匹配调拨批次</td><td><span class="tag amber">待匹配</span></td><td>-</td><td>-</td><td>-</td><td class="num">${esc(fmtNum(unmatchedFbaQty, 0))}</td><td>-</td><td>-</td><td class="inventory-anomaly-text">未匹配到调拨单</td></tr>`
      : "";
    const hasFbaRows = shipmentRows.length > 0 || Boolean(unmatchedRow);
    const fbaRowCount = shipmentRows.length + (unmatchedRow ? 1 : 0);
    const shipmentDetailByGroup = new Map(
      [...fbaRows, ...shipmentRows].map((item) => [item.groupId, item]).filter(([groupId]) => groupId),
    );
    const shipmentLinks = new Map(
      shipmentRows.map((item) => [item.groupId, item]),
    );
    const editorRows = shipmentRows.map((item) => {
      const automatic = defaultFbaLeadDays(item.shippingMode);
      return `<div class="inventory-lead-row">
        <div><strong>${esc(item.groupId)}</strong><span>${esc(item.shippingModeLabel || fbaShippingModeLabel(item.shippingMode) || "-")} · 默认 ${automatic} 天</span></div>
        <label><input type="number" min="1" max="180" step="1" data-lead-group="${esc(item.groupId)}" value="${esc(overrides[item.groupId] || "")}" placeholder="${automatic}" /> 天</label>
      </div>`;
    }).join("");
    const modal = document.createElement("div");
    modal.className = "modal-mask";
    modal.innerHTML = `
      <div class="modal inventory-detail-modal">
        <div class="modal-head">
          <h3>${esc(row.model || row.sku || row.color || "库存明细")}</h3>
          <button class="modal-close" aria-label="关闭">×</button>
        </div>
        <div class="modal-body">
          <div class="detail-metrics">
            <div><span>国内在仓</span><b>${esc(fmtNum(row.domesticInWarehouse, 0))}</b></div>
            <div><span>国内在途</span><b>${esc(fmtNum(row.domesticInTransit, 0))}</b></div>
            <div><span>FBA总库存</span><b>${esc(fmtNum(num(row.fbaInWarehouse) + num(row.fbaInTransit), 0))}</b></div>
            <div><span>FBA在途</span><b>${esc(fmtNum(row.fbaInTransit, 0))}</b></div>
          </div>
          <div class="inventory-detail-tabs" role="tablist" aria-label="库存明细视图">
            <button type="button" class="is-active" data-detail-tab="fba" role="tab" aria-selected="true">FBA 调拨明细 <span>${esc(fmtNum(shipmentRows.length, 0))}</span></button>
            <button type="button" data-detail-tab="purchase" role="tab" aria-selected="false">国内采购明细 <span>${esc(fmtNum(purchaseRows.length, 0))}</span></button>
          </div>
          <section class="inventory-detail-pane" data-detail-pane="fba">
            <div class="inventory-detail-toolbar">
              <span data-detail-count="fba">显示 ${esc(fmtNum(fbaRowCount, 0))} 条</span>
              <label>时间范围
                <select data-detail-days="fba">
                  <option value="7">近7天</option>
                  <option value="30" selected>近30天</option>
                  <option value="90">近90天</option>
                  <option value="0">全部</option>
                </select>
              </label>
              ${shipmentRows.length ? `<button class="btn btn-sm" id="inventory-adjust-lead"><i data-lucide="SlidersHorizontal"></i>调整时效</button>` : ""}
            </div>
            <p class="hint">状态取调拨单管理界面；未完结调拨均计入明细匹配。实际发货时间 = 审核时间 + 销售处理时效，有渠道且无销售处理时效时直接取审核时间。预计到 FBA 超过时效仍未完成时标记异常。时间筛选只隐藏已完结历史单，在途单始终保留。</p>
            ${reconciliationNote ? `<div class="inventory-notice"><i data-lucide="TriangleAlert"></i><span>${esc(reconciliationNote)}</span></div>` : ""}
            ${hasFbaRows ? `
              <div class="inventory-lead-editor" id="inventory-lead-editor" hidden>
                ${editorRows}
                <div class="inventory-lead-actions"><button class="btn btn-sm btn-primary" id="inventory-save-lead"><i data-lucide="Check"></i>保存时效</button></div>
              </div>
              <div class="inventory-detail-scroll">
                <table class="data-table">
                  <thead>${fbaHead}</thead>
                  <tbody>${shipmentTable}${unmatchedRow}</tbody>
                </table>
              </div>
            ` : `<p class="hint">当前${scope === "model" ? "型号" : scope === "color" ? "花色" : "SKU"}没有 FBA 调拨记录。</p>`}
          </section>
          <section class="inventory-detail-pane" data-detail-pane="purchase" hidden>
            <div class="inventory-detail-toolbar">
              <span data-detail-count="purchase">显示 ${esc(fmtNum(purchaseRows.length, 0))} 条</span>
              <label>时间范围
                <select data-detail-days="purchase">
                  <option value="7">近7天</option>
                  <option value="30" selected>近30天</option>
                  <option value="90">近90天</option>
                  <option value="0">全部</option>
                </select>
              </label>
            </div>
            ${purchaseSection}
          </section>
        </div>
      </div>
    `;
    W.$("#modal-root").appendChild(modal);
    const close = () => modal.remove();
    modal.querySelector(".modal-close").addEventListener("click", close);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) close();
    });
    modal.querySelectorAll("[data-shipment-group]").forEach((button) => {
      button.addEventListener("click", () => {
        const groupId = button.dataset.shipmentGroup;
        const shipment = shipmentDetailByGroup.get(groupId) || shipmentLinks.get(groupId);
        const skuItems = Array.isArray(shipment?.skuItems)
          ? shipment.skuItems
          : shipment
            ? [{
              sku: shipment.sku,
              site: shipment.site,
              color: shipment.color || shipment.sku,
              applyQty: shipment.applyQty,
              pickingQty: shipment.pickingQty,
              labelQty: shipment.labelQty,
              packingQty: shipment.packingQty,
              packingDate: shipment.packingDate,
            }]
            : [];
        const sortedItems = skuItems.slice().sort((a, b) => (
          text(a.sku).localeCompare(text(b.sku), "zh-CN", { numeric: true })
          || text(a.site).localeCompare(text(b.site))
        ));
        const totalPackingQty = sortedItems.reduce((sum, item) => sum + num(item.packingQty), 0);
        const skuDetail = document.createElement("div");
        skuDetail.className = "modal-mask inventory-shipment-sku-mask";
        skuDetail.innerHTML = `
          <div class="modal inventory-shipment-sku-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-sku-detail-title">
            <div class="modal-head">
              <div>
                <h3 id="inventory-sku-detail-title">SKU 装箱明细</h3>
                <p class="inventory-shipment-sku-subtitle">${esc(groupId || "-")}</p>
              </div>
              <button class="modal-close" aria-label="关闭">×</button>
            </div>
            <div class="modal-body">
              <div class="inventory-shipment-sku-summary">
                <div><span>对应型号</span><b>${esc(row.model || "-")}</b></div>
                <div><span>SKU 数量</span><b>${esc(fmtNum(sortedItems.length, 0))}</b></div>
                <div><span>装箱合计</span><b>${esc(fmtNum(totalPackingQty, 0))}</b></div>
              </div>
              <div class="inventory-detail-scroll inventory-shipment-sku-scroll">
                <table class="data-table">
                  <thead><tr><th>SKU</th><th>花色</th><th class="num">装箱数量</th><th class="num">申请数量</th><th>装箱时间</th></tr></thead>
                  <tbody>${sortedItems.map((item) => `
                    <tr>
                      <td><strong>${esc(item.sku || "-")}</strong></td>
                      <td>${esc(item.color || "-")}</td>
                      <td class="num">${esc(fmtNum(item.packingQty, 0))}</td>
                      <td class="num">${esc(fmtNum(item.applyQty, 0))}</td>
                      <td>${esc(item.packingDate || "-")}</td>
                    </tr>
                  `).join("")}</tbody>
                </table>
              </div>
              ${totalPackingQty ? "" : `<p class="hint inventory-shipment-sku-empty">该调拨单尚未装箱，装箱数量为 0，可参考申请数量。</p>`}
            </div>
          </div>
        `;
        W.$("#modal-root").appendChild(skuDetail);
        const closeSkuDetail = () => skuDetail.remove();
        skuDetail.querySelector(".modal-close").addEventListener("click", closeSkuDetail);
        skuDetail.addEventListener("click", (event) => {
          if (event.target === skuDetail) closeSkuDetail();
        });
        W.initIcons(skuDetail);
      });
    });
    modal.querySelectorAll("[data-detail-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        const tab = button.dataset.detailTab;
        modal.querySelectorAll("[data-detail-tab]").forEach((item) => {
          const active = item === button;
          item.classList.toggle("is-active", active);
          item.setAttribute("aria-selected", active ? "true" : "false");
        });
        modal.querySelectorAll("[data-detail-pane]").forEach((pane) => {
          pane.hidden = pane.dataset.detailPane !== tab;
        });
      });
    });
    const applyDetailFilter = (paneName) => {
      const pane = modal.querySelector(`[data-detail-pane="${paneName}"]`);
      const select = modal.querySelector(`[data-detail-days="${paneName}"]`);
      const count = modal.querySelector(`[data-detail-count="${paneName}"]`);
      if (!pane || !select || !count) return;
      const cutoff = shanghaiCutoff(select.value);
      const rows = Array.from(pane.querySelectorAll("tbody tr[data-detail-date]"));
      let visible = 0;
      rows.forEach((tr) => {
        const active = tr.dataset.recordState === "in_transit";
        const date = dateOnly(tr.dataset.detailDate);
        const show = !cutoff || active || (date && date >= cutoff);
        tr.hidden = !show;
        if (show) visible += 1;
      });
      count.textContent = `显示 ${fmtNum(visible, 0)} / ${fmtNum(rows.length, 0)} 条`;
    };
    modal.querySelectorAll("[data-detail-days]").forEach((select) => {
      select.addEventListener("change", () => applyDetailFilter(select.dataset.detailDays));
    });
    applyDetailFilter("fba");
    applyDetailFilter("purchase");
    const adjust = modal.querySelector("#inventory-adjust-lead");
    const editor = modal.querySelector("#inventory-lead-editor");
    if (adjust && editor) {
      adjust.addEventListener("click", () => {
        editor.hidden = !editor.hidden;
      });
    }
    const save = modal.querySelector("#inventory-save-lead");
    if (save) {
      save.addEventListener("click", async () => {
        const next = { ...readFbaLeadOverrides() };
        modal.querySelectorAll("[data-lead-group]").forEach((input) => {
          const groupId = input.dataset.leadGroup;
          const value = Math.round(Number(input.value));
          if (Number.isFinite(value) && value > 0) next[groupId] = Math.min(180, value);
          else delete next[groupId];
        });
        writeFbaLeadOverrides(next);
        try {
          await W.api("/api/inventory-monitor-fba-lead", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ overrides: next }),
          });
        } catch (error) {
          W.toast("本地已调整，服务端保存失败：" + error.message, "error");
        }
        detailView.prepareRows();
        detailView.renderTable(root);
        close();
        const updated = findUpdatedRow(detailView.rows, row, scope);
        openDetail(root, updated, scope, data, detailView);
        W.toast("FBA 时效已更新", "success");
      });
    }
    modal.querySelectorAll(".purchase-note").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        showFloatingNote(button, button.dataset.note || button.textContent || "");
      });
    });
    W.initIcons(modal);
  }

  const view = {
    _name: "inventory-model",
    _scope: "model",
    data: null,
    snapshots: [],
    rows: [],
    tableRows: [],
    syncRunning: false,
    state: {
      scope: "model",
      query: "",
      model: "",
      site: "",
      sales: "",
      category: "",
      planTime: "",
      status: "",
      onlyActive: true,
      page: 1,
      pageSize: 100,
      filteredCount: 0,
      selectedDates: [],
    },

    render(root) {
      const cfg = SCOPES[this._name] || SCOPES["inventory-model"];
      this.state.scope = this._scope;
      this.state.page = 1;
      root.innerHTML = `
        <div class="page-head">
          <div>
            <h1>库存监控 · ${esc(cfg.title)}</h1>
            <p>${esc(cfg.desc)}</p>
          </div>
          <div class="head-actions">
            <button class="btn" id="inventory-refresh" data-lucide-icon="RefreshCw"><i data-lucide="RefreshCw"></i>同步OA</button>
          </div>
        </div>
        <div id="inventory-summary" class="inventory-summary-shell"></div>
        <div class="inventory-toolbar">
          <div class="inventory-search">
            <i data-lucide="Search"></i>
            <input id="inventory-query" placeholder="搜索型号、花色、SKU、账号" />
          </div>
          <select id="inventory-model-filter"><option value="">全部型号</option></select>
          ${this._scope === "model" ? `
            <select id="inventory-sales-filter"><option value="">全部销售</option></select>
            <select id="inventory-category-filter"><option value="">全部分类</option></select>
            <select id="inventory-plan-filter"><option value="">全部企划</option></select>
          ` : ""}
          <select id="inventory-site-filter"><option value="">全部站点</option></select>
          <select id="inventory-status-filter">
            <option value="">全部状态</option>
            <option value="正常销售中">正常销售中</option>
            <option value="重点推广">重点推广</option>
            <option value="新品推广中">新品推广中</option>
            <option value="暂停销售">暂停销售</option>
            <option value="商品清仓中">商品清仓中</option>
          </select>
          <div class="inventory-date-picker" id="inventory-date-filter">
            <button type="button" class="inventory-date-trigger" id="inventory-date-toggle" aria-expanded="false">
              <span id="inventory-date-label">最新</span><i data-lucide="ChevronDown"></i>
            </button>
            <div class="inventory-date-menu" id="inventory-date-menu" hidden>
              <button type="button" class="inventory-date-latest" data-inventory-date-latest><span>最新</span><i data-lucide="Check"></i></button>
              <div id="inventory-date-options"></div>
            </div>
          </div>
          <label class="inventory-check"><input type="checkbox" id="inventory-active" checked />仅看有库存/在途</label>
          <span class="inventory-source" id="inventory-source"></span>
        </div>
        <div id="inventory-table"></div>
      `;
      root.querySelector("#inventory-query").addEventListener("input", (event) => {
        this.state.query = event.target.value;
        this.state.page = 1;
        this.renderTable(root);
      });
      root.querySelector("#inventory-model-filter").addEventListener("change", (event) => {
        this.state.model = event.target.value;
        this.state.page = 1;
        this.renderTable(root);
      });
      const salesFilter = root.querySelector("#inventory-sales-filter");
      if (salesFilter) salesFilter.addEventListener("change", (event) => {
        this.state.sales = event.target.value;
        this.state.page = 1;
        this.renderTable(root);
      });
      const categoryFilter = root.querySelector("#inventory-category-filter");
      if (categoryFilter) categoryFilter.addEventListener("change", (event) => {
        this.state.category = event.target.value;
        this.state.page = 1;
        this.renderTable(root);
      });
      const planFilter = root.querySelector("#inventory-plan-filter");
      if (planFilter) planFilter.addEventListener("change", (event) => {
        this.state.planTime = event.target.value;
        this.state.page = 1;
        this.renderTable(root);
      });
      root.querySelector("#inventory-site-filter").addEventListener("change", (event) => {
        this.state.site = event.target.value;
        this.state.page = 1;
        this.renderTable(root);
      });
      root.querySelector("#inventory-status-filter").addEventListener("change", (event) => {
        this.state.status = event.target.value;
        this.state.page = 1;
        this.renderTable(root);
      });
      const dateFilter = root.querySelector("#inventory-date-filter");
      const dateToggle = root.querySelector("#inventory-date-toggle");
      const dateMenu = root.querySelector("#inventory-date-menu");
      dateToggle.addEventListener("click", () => {
        dateMenu.hidden = !dateMenu.hidden;
        dateToggle.setAttribute("aria-expanded", dateMenu.hidden ? "false" : "true");
      });
      dateMenu.addEventListener("click", (event) => {
        if (!event.target.closest("[data-inventory-date-latest]")) return;
        this.state.selectedDates = [];
        this.state.page = 1;
        dateMenu.hidden = true;
        dateToggle.setAttribute("aria-expanded", "false");
        this.updateDateLabel(root);
        this.load(root, true, []);
      });
      dateMenu.addEventListener("change", (event) => {
        const checkbox = event.target.closest("[data-inventory-date]");
        if (!checkbox) return;
        const selected = new Set(this.state.selectedDates);
        if (checkbox.checked) selected.add(checkbox.value);
        else selected.delete(checkbox.value);
        this.state.selectedDates = Array.from(selected).sort().reverse();
        this.state.page = 1;
        this.updateDateLabel(root);
        this.load(root, true, this.state.selectedDates);
      });
      dateFilter.addEventListener("focusout", () => {
        setTimeout(() => {
          if (!dateFilter.contains(document.activeElement)) {
            dateMenu.hidden = true;
            dateToggle.setAttribute("aria-expanded", "false");
          }
        }, 0);
      });
      root.querySelector("#inventory-active").addEventListener("change", (event) => {
        this.state.onlyActive = event.target.checked;
        this.state.page = 1;
        this.renderTable(root);
      });
      root.querySelector("#inventory-refresh").addEventListener("click", () => this.sync(root, true));
      this.load(root);
    },

    afterRender() {},

    dailySyncKey() {
      return `wb.inventoryDailySync:${shanghaiDate(Date.now())}`;
    },

    async sync(root, manual, options = {}) {
      if (this.syncRunning) return;
      const key = this.dailySyncKey();
      if (!manual && !options.stale) {
        try {
          if (localStorage.getItem(key) === "1") return;
          localStorage.setItem(key, "1");
        } catch {
          /* 存储不可用时仍执行当天首次同步 */
        }
      }
      this.syncRunning = true;
      const button = root.querySelector("#inventory-refresh");
      if (button) {
        button.disabled = true;
        button.innerHTML = `<i data-lucide="LoaderCircle" class="spin"></i>同步中`;
        W.initIcons(button);
      }
      try {
        let result = await W.api("/api/inventory-monitor-sync", { method: "POST" });
        let waitingForRunningSync = false;
        while (result.busy) {
          if (!waitingForRunningSync) {
            waitingForRunningSync = true;
            W.toast("已有库存同步任务正在执行，完成后会自动刷新", "info");
          }
          if (button) {
            button.innerHTML = `<i data-lucide="LoaderCircle" class="spin"></i>等待同步`;
            W.initIcons(button);
          }
          await delay(4000);
          const status = await W.api("/api/inventory-monitor-sync-status");
          if (status.running) {
            const progress = String(status.progress || "").replace(/^\[inventory-sync\]\s*/, "").slice(0, 28);
            if (button) {
              button.innerHTML = `<i data-lucide="LoaderCircle" class="spin"></i>${W.esc(progress || "等待同步")}`;
              W.initIcons(button);
            }
            continue;
          }
          result = status.lastResult || { ok: true, message: "库存同步任务已结束" };
        }
        if (!result.ok && result.needLogin) {
          if (manual || options.stale) showOaLoginModal(() => this.sync(root, true));
          else W.toast("库存监控今日尚未同步，请登录 OA 后重试", "info");
          return;
        }
        if (!result.ok) throw new Error(result.message || result.error || "同步失败");
        this.data = null;
        dataCache.clear();
        this.state.selectedDates = [];
        await this.load(root, true, []);
        W.toast("库存数据已同步", "success");
      } catch (error) {
        W.toast(error.message || "同步失败", "error");
        try { localStorage.removeItem(key); } catch {}
      } finally {
        this.syncRunning = false;
        if (button) {
          button.disabled = false;
          button.innerHTML = `<i data-lucide="RefreshCw"></i>同步OA`;
          W.initIcons(button);
        }
      }
    },

    async load(root, force, dates) {
      const tableRoot = root.querySelector("#inventory-table");
      tableRoot.innerHTML = `<div class="empty-state"><p>正在读取库存数据…</p></div>`;
      try {
        const selectedDates = Array.isArray(dates)
          ? dates.filter(Boolean)
          : dates
            ? [dates]
            : this.state.selectedDates.slice();
        const requests = selectedDates.length ? selectedDates : [""];
        const loaded = await Promise.all(requests.map(async (date) => ({
          requestedDate: date,
          data: await loadData(force, date),
        })));
        this.snapshots = loaded.map(({ requestedDate, data }) => ({
          date: data.selectedDate || requestedDate || "latest",
          data,
          rows: this.buildRows(data),
        }));
        this.data = this.snapshots[0] ? this.snapshots[0].data : null;
        if (!this.data) {
          tableRoot.innerHTML = `<div class="empty-state"><p>没有可用的库存快照</p></div>`;
          return;
        }
        if (this.data.fbaLeadOverrides && typeof this.data.fbaLeadOverrides === "object") {
          writeFbaLeadOverrides({ ...readFbaLeadOverrides(), ...this.data.fbaLeadOverrides });
        }
        root.dataset.inventorySkuRows = String(this.snapshots.reduce((sum, snapshot) => sum + (snapshot.data.skuInventory || []).length, 0));
        root.dataset.inventoryColors = String(this.snapshots.reduce((sum, snapshot) => sum + (snapshot.data.colors || []).length, 0));
        this.state.selectedDates = selectedDates;
        this.prepareRows();
        root.dataset.inventoryPreparedRows = String(this.rows.length);
        root.dataset.inventoryHn0010Rows = String(this.rows.filter((row) => text(row.model) === "HN0010S27").length);
        this.fillFilters(root);
        this.renderTable(root);
        if (window.__INVENTORY_SNAPSHOT_MODE__) {
          setTimeout(() => loadSnapshotDetails().catch(() => {}), 800);
        }
        const todayCn = shanghaiDate(Date.now());
        const snapshotCn = this.data.updatedAt ? shanghaiDate(this.data.updatedAt) : "";
        if (snapshotCn !== todayCn && !window.__INVENTORY_SNAPSHOT_MODE__) {
          this.sync(root, false, { stale: true });
        }
      } catch (error) {
        tableRoot.innerHTML = `<div class="empty-state"><p>库存数据读取失败：${esc(error.message)}</p></div>`;
      }
    },

    buildRows(data) {
      if (!data) return [];
      if (this._scope === "model" && Array.isArray(data.precomputedRows)) {
        return data.precomputedRows;
      }
      return this._scope === "model"
        ? buildModelRows(data)
        : this._scope === "color"
          ? buildColorRows(data)
          : buildSkuRows(data);
    },

    prepareRows() {
      const snapshots = this.snapshots.length
        ? this.snapshots
        : this.data
          ? [{ date: this.data.selectedDate || "latest", data: this.data, rows: this.buildRows(this.data) }]
          : [];
      this.rows = snapshots.flatMap((snapshot) => (
        snapshot.rows.map((row) => ({ ...row, snapshotDate: snapshot.date }))
      ));
    },

    fillFilters(root) {
      const sites = Array.from(new Set(this.rows.map((row) => text(row.site)).filter(Boolean))).sort();
      const modelSelect = root.querySelector("#inventory-model-filter");
      const siteSelect = root.querySelector("#inventory-site-filter");
      siteSelect.innerHTML = `<option value="">全部站点</option>${sites.map((value) => `<option value="${esc(value)}">${esc(value)}</option>`).join("")}`;
      this.refreshModelOptions(root);
      if (this._scope === "model") {
        const splitOptions = (values) => Array.from(new Set(values
          .flatMap((value) => text(value).split(" / "))
          .map((value) => value.trim())
          .filter((value) => value && !value.startsWith("+"))))
          .sort((a, b) => a.localeCompare(b, "zh-CN"));
        const salesOptions = splitOptions(this.rows.map((row) => row.salesText));
        const categoryOptions = splitOptions(this.rows.map((row) => row.categoryText));
        const planOptions = splitOptions(this.rows.map((row) => row.planTimeText));
        root.querySelector("#inventory-sales-filter").innerHTML = `<option value="">全部销售</option>${salesOptions.map((value) => `<option value="${esc(value)}">${esc(value)}</option>`).join("")}`;
        root.querySelector("#inventory-category-filter").innerHTML = `<option value="">全部分类</option>${categoryOptions.map((value) => `<option value="${esc(value)}">${esc(value)}</option>`).join("")}`;
        root.querySelector("#inventory-plan-filter").innerHTML = `<option value="">全部企划</option>${planOptions.map((value) => `<option value="${esc(value)}">${esc(value)}</option>`).join("")}`;
      }
      const history = Array.from(new Set(
        this.snapshots.flatMap((snapshot) => snapshot.data.history || []),
      )).sort().reverse();
      const selectedDates = new Set(this.state.selectedDates);
      root.querySelector("#inventory-date-options").innerHTML = history.map((date) => `
        <label class="inventory-date-option">
          <input type="checkbox" data-inventory-date value="${esc(date)}"${selectedDates.has(date) ? " checked" : ""}>
          <span>${esc(date)}</span>
        </label>
      `).join("");
      this.updateDateLabel(root);
      const updated = this.data.updatedAt ? new Date(this.data.updatedAt).toLocaleString("zh-CN", { hour12: false }) : "未同步";
      const purchaseStates = this.data.sources && this.data.sources.purchaseInTransit && this.data.sources.purchaseInTransit.recordStates;
      const fbaStates = this.data.sources && this.data.sources.fbaInTransit && this.data.sources.fbaInTransit.recordStates;
      const historyText = purchaseStates || fbaStates
        ? ` · 采购 在途${fmtNum(purchaseStates && purchaseStates.in_transit, 0)}/已完结${fmtNum(purchaseStates && purchaseStates.completed, 0)} · FBA 在途${fmtNum(fbaStates && fbaStates.in_transit, 0)}/已完结${fmtNum(fbaStates && fbaStates.completed, 0)}`
        : "";
      const snapshotLabel = this.state.selectedDates.length
        ? `快照 ${this.state.selectedDates.join("、")}`
        : "最新快照";
      root.querySelector("#inventory-source").textContent = `${snapshotLabel} · 数据更新 ${updated}${historyText}`;
    },

    refreshModelOptions(root) {
      const modelSelect = root.querySelector("#inventory-model-filter");
      if (!modelSelect) return;
      const modelRows = filterRows(this.rows, { ...this.state, model: "" });
      const models = Array.from(new Set(modelRows.map((row) => text(row.model)).filter(Boolean))).sort();
      if (this.state.model && !models.includes(this.state.model)) this.state.model = "";
      modelSelect.innerHTML = `<option value="">全部型号</option>${models.map((value) => `<option value="${esc(value)}">${esc(value)}</option>`).join("")}`;
      modelSelect.value = this.state.model;
    },

    updateDateLabel(root) {
      const label = root.querySelector("#inventory-date-label");
      const latest = root.querySelector("[data-inventory-date-latest]");
      if (!label) return;
      const count = this.state.selectedDates.length;
      label.textContent = count === 0
        ? "最新"
        : count === 1
          ? this.state.selectedDates[0]
          : `已选 ${count} 天`;
      if (latest) latest.setAttribute("aria-pressed", count === 0 ? "true" : "false");
    },

    renderTable(root) {
      if (!this.data) return;
      this.refreshModelOptions(root);
      const filtered = filterRows(this.rows, this.state);
      this.state.filteredCount = filtered.length;
      const pageSize = this.state.selectedDates.length > 1
        ? Math.max(this.state.pageSize, filtered.length)
        : this.state.pageSize;
      const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
      this.state.page = Math.min(this.state.page, pages);
      const start = (this.state.page - 1) * pageSize;
      this.tableRows = filtered.slice(start, start + pageSize);
      const primarySnapshot = this.snapshots.find((snapshot) => snapshot.date === this.tableRows[0]?.snapshotDate)
        || this.snapshots[0];
      const summaryRows = primarySnapshot
        ? filterRows(primarySnapshot.rows.map((row) => ({ ...row, snapshotDate: primarySnapshot.date })), this.state)
        : filtered;
      const summaryData = primarySnapshot ? primarySnapshot.data : this.data;
      const summaryState = { ...this.state, filteredCount: summaryRows.length };
      root.querySelector("#inventory-summary").innerHTML = renderSummary(summarize(summaryRows, this._scope, summaryData), summaryState, summaryData);
      const tableRoot = root.querySelector("#inventory-table");
      tableRoot.innerHTML = renderSnapshotTables(this.tableRows, this.state) + renderPager(this.state, filtered.length, pageSize);
      tableRoot.querySelectorAll("[data-page]").forEach((button) => {
        button.addEventListener("click", () => {
          this.state.page = Number(button.dataset.page);
          this.renderTable(root);
        });
      });
      tableRoot.querySelectorAll(".inventory-detail").forEach((button) => {
        button.addEventListener("click", async () => {
          const row = this.tableRows[Number(button.dataset.index)];
          const snapshot = this.snapshots.find((item) => item.date === row?.snapshotDate) || this.snapshots[0];
          if (window.__INVENTORY_SNAPSHOT_MODE__ && snapshot) {
            button.disabled = true;
            try {
              const details = await loadSnapshotDetails();
              row.purchaseRows = details.purchaseRowsByKey?.[row.key] || [];
              snapshot.data = { ...snapshot.data, fbaShipments: details.fbaShipments || [] };
            } catch (error) {
              W.toast(error.message || "库存明细读取失败", "error");
              button.disabled = false;
              return;
            }
            button.disabled = false;
          }
          openDetail(root, row, this._scope, snapshot ? snapshot.data : this.data, this);
        });
      });
      W.initIcons(root);
    },
  };

  Object.keys(SCOPES).forEach((key) => {
    const instance = Object.create(view);
    instance._name = key;
    instance._scope = key.replace("inventory-", "");
    instance.data = null;
    instance.rows = [];
    instance.tableRows = [];
    instance.state = { ...view.state, scope: instance._scope };
    W.views[key] = instance;
  });
})();
