#!/usr/bin/env node
// Craigslist search — 250-mile radius from Long Beach, real listings.
// Craigslist renders results from a JSON feed (SAPI), not static HTML (the HTML
// only holds dealer-spam), so we call SAPI directly, decode the compact item
// arrays heuristically, filter curbstoner spam, and keep model matches.
//
// Usage:
//   node cl-search.mjs "<query>" [maxPrice] [minPrice]
//   node cl-search.mjs "honda prelude" 2500
//   DEBUG=1 node cl-search.mjs "mazda miata" 2500   # print a raw sample if parsing fails

const query = process.argv[2] || "honda prelude";
const maxPrice = Number(process.argv[3] || 2500);
const minPrice = Number(process.argv[4] || 400);
const model = query.split(/\s+/).pop().toLowerCase();
const POSTAL = "90802"; // Long Beach
const DEBUG = process.env.DEBUG === "1";
const UA = "Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";

// Curbstoner / unlicensed-dealer spam patterns (flood every CL car search).
const SPAM = /priced to (sale|sell)|money back|passed smog|cold ac|🔷|❗|✅|call or text|se habla|\bwholesale\b|no credit|buy here pay here|\bbhph\b|financing available/i;

const sapi =
  `https://sapi.craigslist.org/web/v8/postings/search/full?batch=1-0-360-0-0&cc=US&lang=en` +
  `&searchPath=cta&query=${encodeURIComponent(query)}&min_price=${minPrice}&max_price=${maxPrice}` +
  `&searchDistance=250&postal=${POSTAL}&sort=date`;

const linkFor = () =>
  `https://losangeles.craigslist.org/search/cta?query=${encodeURIComponent(query)}` +
  `&min_price=${minPrice}&max_price=${maxPrice}&search_distance=250&postal=${POSTAL}&auto_title_status=1`;

// Heuristic decode of one SAPI item array: pull a title, a price, and a location.
function decodeItem(item) {
  if (!Array.isArray(item)) return null;
  const strings = [];
  const numbers = [];
  const walk = (v) => {
    if (typeof v === "string") strings.push(v);
    else if (typeof v === "number") numbers.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(item);
  // Title: the longest string that reads like a listing title (has a letter and
  // isn't a url/host/path/category code).
  const title = strings
    .filter((s) => /[a-z]/i.test(s) && !/https?:|craigslist|\.org|^\/|^[a-z]{3}$/i.test(s) && s.length >= 5)
    .sort((a, b) => b.length - a.length)[0];
  // Price: a plausible dollar amount that isn't a posting id, year, or coordinate.
  const price = numbers.find((n) => Number.isInteger(n) && n >= minPrice && n <= maxPrice);
  // Location: a short place-like string (has a letter, has no digits, title-ish).
  const loc = strings.find((s) => /^[A-Z][A-Za-z][A-Za-z .'-]{2,30}$/.test(s) && s !== title);
  if (!title) return null;
  return { title: title.trim(), price, loc: loc || "" };
}

try {
  const r = await fetch(sapi, { headers: { "User-Agent": UA, Accept: "application/json" } });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  const items = json?.data?.items;

  if (!Array.isArray(items)) {
    console.log(`Craigslist SAPI returned HTTP ${r.status} but no parseable items.`);
    if (DEBUG) { console.log("\n----- RAW SAMPLE -----\n" + text.slice(0, 1500) + "\n----- END -----"); }
    console.log(`\nOpen this search in a browser instead:\n  ${linkFor()}`);
    process.exit(0);
  }

  const rows = [];
  for (const it of items) {
    const d = decodeItem(it);
    if (!d) continue;
    if (SPAM.test(d.title)) continue;                 // drop curbstoner spam
    if (!d.title.toLowerCase().includes(model)) continue; // keep only this model
    rows.push(d);
  }
  // De-dupe by title+price.
  const seen = new Set();
  const out = rows.filter((d) => {
    const k = d.title.toLowerCase().replace(/[^a-z0-9]/g, "") + "|" + (d.price || "");
    if (seen.has(k)) return false;
    seen.add(k); return true;
  }).sort((a, b) => (a.price || 1e9) - (b.price || 1e9));

  console.log(`=== Craigslist "${query}" — $${minPrice}-$${maxPrice}, 250 mi of Long Beach ===`);
  console.log(`(scanned ${items.length} results; kept ${out.length} real ${model} listings, spam filtered)\n`);
  if (!out.length) {
    console.log(`No clean "${model}" matches parsed. Browse the live search here:\n  ${linkFor()}`);
    if (DEBUG && items[0]) console.log("\n----- FIRST ITEM (for parser tuning) -----\n" + JSON.stringify(items[0]).slice(0, 900));
  } else {
    for (const d of out) {
      console.log(`${d.price ? "$" + d.price.toLocaleString() : "see listing"} - ${d.title}${d.loc ? "  📍 " + d.loc : ""}`);
    }
    console.log(`\nFull live search (tap to open each car): ${linkFor()}`);
  }
} catch (e) {
  console.log("Craigslist fetch failed:", e.message);
  console.log(`Open in a browser instead:\n  ${linkFor()}`);
}
