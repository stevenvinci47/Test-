#!/usr/bin/env node
// Craigslist probe — finds where the REAL search results live in the page.
// The JSON-LD block turned out to be sponsored dealer spam, so this reports
// what else is in the HTML (script data blobs, the sapi URL, model matches)
// so the parser can target the real results.
//
// Usage: node cl-search.mjs "honda prelude" 2500

const query = process.argv[2] || "honda prelude";
const maxPrice = Number(process.argv[3] || 2500);
const model = query.split(" ").pop().toLowerCase(); // e.g. "prelude"
const POSTAL = "90802";

const url =
  `https://losangeles.craigslist.org/search/cta?query=${encodeURIComponent(query)}` +
  `&min_price=1&max_price=${maxPrice}&search_distance=250&postal=${POSTAL}&auto_title_status=1&sort=date`;
const UA = "Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";

// Also try Craigslist's internal JSON API directly.
const sapi =
  `https://sapi.craigslist.org/web/v8/postings/search/full?batch=1-0-360-0-0&cc=US&lang=en` +
  `&searchPath=cta&query=${encodeURIComponent(query)}&min_price=1&max_price=${maxPrice}` +
  `&searchDistance=250&postal=${POSTAL}&sort=date`;

try {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  const html = await res.text();
  console.log(`# HTML  HTTP ${res.status}  ${html.length} bytes`);
  console.log(`# "${model}" appears ${(html.toLowerCase().match(new RegExp(model, "g")) || []).length} times in the HTML`);

  // Show the script tags most likely to hold result data.
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const dataish = scripts
    .map((s, i) => ({ i, len: s.length, s }))
    .filter((x) => x.len > 800 && /posting|result|cta|price|\bpid\b|\/d\//i.test(x.s))
    .slice(0, 4);
  console.log(`# ${scripts.length} script tags; ${dataish.length} look data-ish\n`);
  for (const d of dataish) {
    console.log(`----- SCRIPT #${d.i} (${d.len} bytes) first 500 chars -----`);
    console.log(d.s.trim().slice(0, 500));
    console.log("");
  }

  // Context around the first real model match (skip if it's in the spam block).
  const idx = html.toLowerCase().indexOf(model);
  if (idx >= 0) {
    console.log(`----- context around first "${model}" -----`);
    console.log(html.slice(Math.max(0, idx - 200), idx + 200).replace(/\s+/g, " "));
    console.log("");
  }
} catch (e) {
  console.log("HTML fetch failed:", e.message);
}

// Try the JSON API — this is the real results source if it responds.
try {
  const r = await fetch(sapi, { headers: { "User-Agent": UA, Accept: "application/json" } });
  const t = await r.text();
  console.log(`\n# SAPI  HTTP ${r.status}  ${t.length} bytes`);
  console.log("----- SAPI first 1200 chars -----");
  console.log(t.slice(0, 1200));
  console.log("----- END -----");
} catch (e) {
  console.log("SAPI fetch failed:", e.message);
}
