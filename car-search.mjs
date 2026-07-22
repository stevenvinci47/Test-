#!/usr/bin/env node
// Used-car sweep for the Long Beach / SoCal area (~250-mile radius) via
// secondhand-mcp (Facebook Marketplace), with fake/bait-listing filtering,
// plus generated Craigslist search links for the same regions.
//
// Usage:
//   node car-search.mjs "<query>" [maxPrice] [minPrice] [perCityLimit]
// Examples:
//   node car-search.mjs "convertible" 2500
//   node car-search.mjs "mazda miata" 3000 800
//   node car-search.mjs "convertible" 2500 1        # include $1 bait (not recommended)

import { spawn } from "node:child_process";

const query = process.argv[2] || "convertible";
const maxPrice = Number(process.argv[3] || 2500);
const minPrice = Number(process.argv[4] || 500); // realistic floor: real cars ~never list under this
const perCity = Number(process.argv[5] || 40);
const CURRENT_YEAR = new Date().getFullYear();

// ---------------------------------------------------------------------------
// Region: cities within ~250 mi of Long Beach for the Marketplace sweep, and
// Craigslist subdomains for the link fallback.
// ---------------------------------------------------------------------------
const CITIES = [
  "long beach", "los angeles", "anaheim", "riverside", "san bernardino",
  "san diego", "santa barbara", "oxnard", "bakersfield", "palm springs", "las vegas",
];
const CL_REGIONS = [
  "losangeles", "orangecounty", "inlandempire", "sandiego",
  "ventura", "santabarbara", "bakersfield", "lasvegas",
];

// States/countries clearly outside a ~250-mile radius — the search sometimes
// returns nationwide/foreign junk, so drop these.
const FAR_AWAY = /Florida|Texas|Georgia|Carolina|Ohio|Illinois|New York|Washington|Oregon|Colorado|Utah|Spain|Mexico|Canada|,\s*(FL|TX|GA|NC|SC|OH|IL|NY|WA|OR|CO|UT)\b/i;

function yearOf(title) {
  const m = title.match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
}

// Fake/bait detection, based on how car-listing scams present:
//  - no model year in the title           -> not a real car post (furniture, parts, toys)
//  - impossible future model year          -> spam (e.g. "2028 ..." while it's 2026)
//  - price below a realistic floor         -> $0/$1 bait to harvest messages, or parts
//  - a late-model car priced absurdly low  -> a 2016+ car for a couple grand is bait/scam
function looksFake(l) {
  const y = yearOf(l.title);
  if (!y) return true;
  if (y > CURRENT_YEAR + 1) return true;
  if (l.num < minPrice) return true;
  if (y >= 2016 && l.num < 4000) return true;
  if (FAR_AWAY.test(l.loc)) return true;
  if (!/^\$/.test(l.price)) return true; // USD only
  return false;
}

// ---------------------------------------------------------------------------
// Minimal MCP stdio client (newline-delimited JSON-RPC).
// ---------------------------------------------------------------------------
const child = spawn("npx", ["-y", "secondhand-mcp"], {
  env: { ...process.env, MARKETPLACES: "facebook" },
  stdio: ["pipe", "pipe", "inherit"],
});
const pending = new Map();
let buf = "";
child.stdout.on("data", (c) => {
  buf += c.toString();
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  }
});
let nextId = 1;
const send = (method, params) =>
  new Promise((res) => {
    const id = nextId++;
    pending.set(id, res);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
const notify = (method, params) =>
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");

function parseBlocks(text) {
  const out = [];
  for (const b of text.split(/\n\s*\n/)) {
    const idM = b.match(/🆔\s*(\S+)/);
    if (!idM) continue;
    const priceM = b.match(/\*\*(.+?)\*\*\s*-\s*([^\n]+)/);
    const locM = b.match(/📍\s*([^\n]+)/);
    const price = priceM ? priceM[1].trim() : "";
    const title = priceM ? priceM[2].trim() : b.split("\n")[0].trim();
    const num = Number((price.match(/[\d,]+/)?.[0] || "").replace(/,/g, "")) || 0;
    out.push({ id: idM[1], price, title, loc: locM ? locM[1].trim() : "", num });
  }
  return out;
}

function clLinks() {
  const q = encodeURIComponent(query);
  return CL_REGIONS.map(
    (r) =>
      `   ${r.padEnd(14)} https://${r}.craigslist.org/search/cta?query=${q}&min_price=${minPrice}&max_price=${maxPrice}&auto_title_status=1`
  ).join("\n");
}

try {
  await send("initialize", {
    protocolVersion: "2024-11-05", capabilities: {},
    clientInfo: { name: "car-search", version: "2.0.0" },
  });
  notify("notifications/initialized", {});

  const byId = new Map();
  let rawCount = 0;
  for (const city of CITIES) {
    process.stderr.write(`searching ${city}...\n`);
    const res = await send("tools/call", {
      name: "search_marketplace",
      arguments: { query, marketplace: "facebook", location: city, minPrice, maxPrice, limit: perCity },
    });
    const text = (res.result?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
    for (const l of parseBlocks(text)) { rawCount++; if (!byId.has(l.id)) byId.set(l.id, l); }
  }

  // Filter fakes, then de-dupe cross-city dealer spam by title+price.
  const seen = new Set();
  const real = [];
  for (const l of [...byId.values()].sort((a, b) => a.num - b.num)) {
    if (looksFake(l)) continue;
    const key = l.title.toLowerCase().replace(/[^a-z0-9]/g, "") + "|" + l.num;
    if (seen.has(key)) continue;
    seen.add(key);
    real.push(l);
  }

  console.log(`\n=== Facebook Marketplace: ${real.length} real "${query}" listings, $${minPrice}-$${maxPrice}, ~250 mi of Long Beach ===`);
  console.log(`(scanned ${rawCount} raw results across ${CITIES.length} cities; filtered out bait/fakes/out-of-area)\n`);
  if (!real.length) {
    console.log("No real listings passed the filter. Try raising maxPrice, lowering minPrice, or a specific model (e.g. \"mazda miata\").\n");
  } else {
    for (const l of real) {
      console.log(`${l.price} - ${l.title}`);
      if (l.loc) console.log(`   📍 ${l.loc}`);
      console.log(`   🔗 https://www.facebook.com/marketplace/item/${l.id}`);
      console.log("");
    }
  }

  console.log(`=== Craigslist: tap-to-search links (clean title, $${minPrice}-$${maxPrice}) ===`);
  console.log("(Craigslist can't be searched from the terminal reliably; open these in a browser)\n");
  console.log(clLinks());
  console.log("");
} finally {
  child.stdin.end();
  child.kill();
  process.exit(0);
}
