#!/usr/bin/env node
// EXPERIMENTAL Craigslist scraper — 250-mile radius from Long Beach.
// Craigslist has no public API and blocks bots, so this fetches the normal
// search page and tries to read the results Craigslist embeds in the HTML as
// JSON-LD. If the format isn't what we expect, it dumps a sample so the parser
// can be fixed from real output.
//
// Usage:
//   node cl-search.mjs "<query>" [maxPrice] [minPrice]
//   node cl-search.mjs "honda prelude" 2500
//   DEBUG=1 node cl-search.mjs "mazda miata" 2500   # dump raw sample

const query = process.argv[2] || "honda prelude";
const maxPrice = Number(process.argv[3] || 2500);
const minPrice = Number(process.argv[4] || 1);
const POSTAL = "90802"; // Long Beach
const DEBUG = process.env.DEBUG === "1";

const url =
  `https://losangeles.craigslist.org/search/cta?query=${encodeURIComponent(query)}` +
  `&min_price=${minPrice}&max_price=${maxPrice}&search_distance=250&postal=${POSTAL}` +
  `&auto_title_status=1&sort=date`;

const UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/124.0 Mobile Safari/537.36";

function pickPrice(obj) {
  // JSON-LD offers.price, or a bare price field.
  const p = obj?.offers?.price ?? obj?.price ?? obj?.item?.offers?.price;
  return p != null ? `$${Number(p).toLocaleString()}` : "";
}

try {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "text/html" } });
  const html = await res.text();
  console.log(`# Craigslist "${query}"  (HTTP ${res.status}, ${html.length} bytes)\n`);

  const listings = [];

  // Strategy 1: JSON-LD blocks (Craigslist embeds an ItemList of results).
  const ld = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of ld) {
    let data;
    try { data = JSON.parse(m[1]); } catch { continue; }
    const arr = data?.itemListElement || (Array.isArray(data) ? data : []);
    for (const el of arr) {
      const it = el?.item || el;
      const name = it?.name || el?.name;
      const link = it?.url || el?.url;
      if (name) listings.push({ name, price: pickPrice(it), url: link || "" });
    }
  }

  // Strategy 2: fall back to result anchors + adjacent price spans in the HTML.
  if (!listings.length) {
    const rows = [...html.matchAll(/href="(https:\/\/[a-z]+\.craigslist\.org\/[^"]*?\/(\d{9,})\.html)"[^>]*>([^<]{6,120})</gi)];
    const prices = [...html.matchAll(/\$[\d,]{2,7}/g)].map((x) => x[0]);
    rows.forEach((r, i) => listings.push({ name: r[3].trim(), url: r[1], price: prices[i] || "" }));
  }

  if (listings.length) {
    console.log(`Found ${listings.length} Craigslist listings:\n`);
    for (const l of listings) {
      console.log(`${l.price || "?"} - ${l.name}`);
      if (l.url) console.log(`   🔗 ${l.url}`);
      console.log("");
    }
  } else {
    console.log("Could not parse listings from the page.");
    console.log("This means Craigslist changed its format — paste the sample below to me and I'll fix the parser:\n");
    console.log("----- RAW SAMPLE (first 1800 chars) -----");
    console.log(html.slice(0, 1800));
    console.log("----- END SAMPLE -----");
  }

  if (DEBUG) {
    console.log("\n[DEBUG] ld+json blocks found:", ld.length);
  }
} catch (e) {
  console.log("Fetch failed:", e.message);
  console.log("If this says 'blocked' or times out, Craigslist may be refusing the request from this network.");
}
