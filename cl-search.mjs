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
// Convertible gate (buyer wants open-top only). Slugs use these words, and some
// models are always convertibles even when the slug omits the body style.
const CONV_WORDS = /convertible|\bconv\b|roadster|spyder|spider|cabriolet|cabrio|drop-?top|soft-?top|\bvert\b/i;
const ALWAYS_CONV = /\bmiata\b|mx-?5|\bs2000\b|boxster|solstice|saturn-?sky|\bslk\b|\bsl\b|prowler/i;
const isConvertible = (s) => CONV_WORDS.test(s) || ALWAYS_CONV.test(s);

const sapi =
  `https://sapi.craigslist.org/web/v8/postings/search/full?batch=1-0-360-0-0&cc=US&lang=en` +
  `&searchPath=cta&query=${encodeURIComponent(query)}&min_price=${minPrice}&max_price=${maxPrice}` +
  `&searchDistance=250&postal=${POSTAL}&sort=date`;

const linkFor = () =>
  `https://losangeles.craigslist.org/search/cta?query=${encodeURIComponent(query)}` +
  `&min_price=${minPrice}&max_price=${maxPrice}&search_distance=250&postal=${POSTAL}&auto_title_status=1`;

// Decode one SAPI item. Craigslist encodes each posting's info in a URL slug
// string like "wilmington-1981-toyota-celica-1300-obo" (city-year-make-model-
// price-suffix), which is the reliable source of title/price/location.
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

  // The slug: lowercase, hyphenated, 4+ segments. Take the longest match.
  const slug = strings
    .filter((s) => /^[a-z0-9]+(-[a-z0-9]+){3,}$/.test(s))
    .sort((a, b) => b.length - a.length)[0];
  if (!slug) return null;

  const segs = slug.split("-");
  const yr = (slug.match(/\b(19|20)\d{2}\b/) || [])[0];
  // Price: prefer a structured number in range; else a slug segment that looks
  // like a price (in range, not the model year).
  let price =
    numbers.find((n) => Number.isInteger(n) && n >= minPrice && n <= maxPrice && String(n) !== yr) ||
    segs.map(Number).find((n) => n >= minPrice && n <= maxPrice && String(n) !== yr);
  // Location = the leading city segment(s) before the year.
  const yi = yr ? segs.indexOf(yr) : -1;
  const loc = (yi > 0 ? segs.slice(0, yi) : [segs[0]]).join(" ").replace(/\b\w/g, (c) => c.toUpperCase());
  // Human title = the make/model part after the year, cleaned up.
  const rest = (yi >= 0 ? segs.slice(yi) : segs).filter(
    (s) => !/^(obo|firm|cash|clean|title|runs|great|nice|price|neg|negotiable)$/.test(s) &&
           !(/^\d+$/.test(s) && s !== yr) // drop stray price/number segments, keep the year
  );
  const title = rest.join(" ").replace(/\b\w/g, (c) => c.toUpperCase());
  return { slug, title, price, loc };
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
    if (SPAM.test(d.slug)) continue;                  // drop curbstoner spam
    if (!d.slug.includes(model)) continue;            // keep only this model
    if (!isConvertible(d.slug)) continue;             // convertibles only
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
