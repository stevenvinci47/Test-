#!/usr/bin/env node
// 250-mile-radius used-car sweep for the Long Beach / SoCal area via
// secondhand-mcp (Facebook Marketplace). Runs one search per nearby city,
// merges + de-duplicates, sorts by price, and prints a clickable link per car.
//
// Usage:
//   node car-search.mjs "<query>" [maxPrice] [perCityLimit]
// Examples:
//   node car-search.mjs "convertible" 2500
//   node car-search.mjs "mazda miata" 3000 40

import { spawn } from "node:child_process";

const query = process.argv[2] || "convertible";
const maxPrice = Number(process.argv[3] || 2500);
const perCity = Number(process.argv[4] || 30);
const minPrice = 1; // only listings that actually show a price ($1+), not $0 blanks

// States clearly outside a ~250-mile radius of Long Beach — drop them, since the
// marketplace search sometimes returns nationwide/foreign results.
const FAR_AWAY = /Florida|Texas|Georgia|Carolina|Ohio|Illinois|New York|Washington|Oregon|Colorado|Utah|Spain|,\s*[A-Z]{2}$/i;

// A real car listing has a 4-digit model year in the title. This filters out
// furniture, baby gear, toys, parts, and accessories that match "convertible".
function isCar(l) {
  if (!/^\$/.test(l.price)) return false;            // US dollars only
  if (!/\b(18|19|20)\d{2}\b/.test(l.title)) return false; // must have a model year
  if (!(l.num >= minPrice && l.num <= maxPrice)) return false;
  if (FAR_AWAY.test(l.loc)) return false;
  return true;
}

// Major cities within ~250 miles of Long Beach, CA.
const CITIES = [
  "long beach", "los angeles", "anaheim", "riverside", "san bernardino",
  "san diego", "santa barbara", "oxnard", "bakersfield", "palm springs", "las vegas",
];

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
    if (m.id !== undefined && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
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

// Parse the server's text output (blocks like: "**$2,200** - Title\n  📍 City\n  🆔 id").
function parseBlocks(text) {
  const out = [];
  for (const b of text.split(/\n\s*\n/)) {
    const idM = b.match(/🆔\s*(\S+)/);
    if (!idM) continue;
    const priceM = b.match(/\*\*(.+?)\*\*\s*-\s*([^\n]+)/);
    const locM = b.match(/📍\s*([^\n]+)/);
    const price = priceM ? priceM[1].trim() : "";
    const title = priceM ? priceM[2].trim() : b.split("\n")[0].trim();
    const num = Number((price.match(/[\d,]+/)?.[0] || "").replace(/,/g, "")) || Infinity;
    out.push({ id: idM[1], price, title, loc: locM ? locM[1].trim() : "", num });
  }
  return out;
}

try {
  await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "car-search", version: "1.0.0" },
  });
  notify("notifications/initialized", {});

  const byId = new Map();
  for (const city of CITIES) {
    process.stderr.write(`searching ${city}...\n`);
    const res = await send("tools/call", {
      name: "search_marketplace",
      arguments: { query, marketplace: "facebook", location: city, minPrice, maxPrice, limit: perCity },
    });
    const text = (res.result?.content ?? [])
      .filter((c) => c.type === "text").map((c) => c.text).join("\n");
    for (const l of parseBlocks(text)) if (!byId.has(l.id)) byId.set(l.id, l);
  }

  const all = [...byId.values()].filter(isCar).sort((a, b) => a.num - b.num);
  if (!all.length) {
    console.log('No matching car listings found (or Facebook is unreachable from this network).');
  } else {
    console.log(`\n=== ${all.length} car listings for "${query}", $${minPrice}–$${maxPrice}, within ~250 mi of Long Beach ===\n`);
    for (const l of all) {
      console.log(`${l.price} - ${l.title}`);
      if (l.loc) console.log(`   📍 ${l.loc}`);
      console.log(`   🔗 https://www.facebook.com/marketplace/item/${l.id}`);
      console.log("");
    }
  }
} finally {
  child.stdin.end();
  child.kill();
  process.exit(0);
}
