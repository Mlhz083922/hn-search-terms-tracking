/* Shared marketplace scope for the workbench and embedded apps. */
window.WorkbenchSites = (function () {
  "use strict";

  const SITES = ["US", "CA", "DE", "UK"];
  const META = {
    US: { label: "美国", domain: "amazon.com", currency: "$" },
    CA: { label: "加拿大", domain: "amazon.ca", currency: "CA$" },
    DE: { label: "德国", domain: "amazon.de", currency: "€" },
    UK: { label: "英国", domain: "amazon.co.uk", currency: "£" },
  };
  const SET = new Set(SITES);

  function normalize(value) {
    const site = String(value || "").trim().toUpperCase();
    return site === "GB" ? "UK" : site;
  }

  function includes(value) {
    return SET.has(normalize(value));
  }

  function productUrl(asin, siteValue) {
    if (!asin) return "#";
    const site = includes(siteValue) ? normalize(siteValue) : "US";
    return `https://www.${META[site].domain}/dp/${encodeURIComponent(String(asin).trim())}`;
  }

  function label(value) {
    const site = normalize(value);
    return META[site] ? `${site} · ${META[site].label}` : String(value || "");
  }

  function currencySymbol(value) {
    const site = includes(value) ? normalize(value) : "US";
    return META[site].currency;
  }

  return { SITES, META, normalize, includes, productUrl, label, currencySymbol };
})();
