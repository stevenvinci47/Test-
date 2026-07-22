#!/usr/bin/env node
// Under-the-radar roadster / convertible finder for the Long Beach / SoCal area
// (~250-mile radius) via secondhand-mcp (Facebook Marketplace), with
// fake/bait + KILL-listing filtering, reliability tagging, and Craigslist links.
//
// Heuristics borrowed from github.com/pjdoland/used-car-finder:
//   "under $2K is mostly scams and salvage"; KILL rebuilt / engine-swap /
//   salvage / parts / project listings; favor Japanese reliability.
//
// Usage:
//   node car-search.mjs roadsters [maxPrice] [minPrice]   # sweep sleeper models
//   node car-search.mjs "<query>" [maxPrice] [minPrice]   # single search term
// Examples:
//   node car-search.mjs roadsters 2500
//   node car-search.mjs "mazda miata" 3000 800

import { spawn } from "node:child_process";

const RAW = (process.argv[2] || "roadsters").toLowerCase();
const maxPrice = Number(process.argv[3] || 2500);
const minPrice = Number(process.argv[4] || 800); // real running cars ~never list below this
const perSearch = 40;
const CURRENT_YEAR = new Date().getFullYear();
const ROADSTER_MODE = ["roadsters", "roadster", "undertheradar", "sleepers"].includes(RAW);

// Under-the-radar roadsters/convertibles realistic (or dreamable) at a low budget.
// note tag: 🟢 reliable sleeper · 🟡 fun, check upkeep · 🟠 dream pick, pricey to keep
// Model catalog. Each row: [search term, keyword to match in a result title, tag].
// 🟢 reliable daily · 🟡 fun, check upkeep · 🟠 cool but pricey to keep · 🔴 iconic money-pit / rarely real at budget
// Add rows freely — the sweep uses column 1, the tagging uses column 2.
const ROADSTERS = [
  // --- Japanese: the reliable-fun core ---
  ["mazda miata",                 "miata",     "🟢 most reliable roadster — the safe sleeper"],
  ["mazda mx-5",                  "mx-5",      "🟢 Miata (MX-5) — most reliable roadster"],
  ["mazda rx-8",                  "rx-8",      "🟡 rotary — cheap + fun, thirsty, apex-seal risk"],
  ["honda s2000",                 "s2000",     "🟢 legendary roadster; peaky but reliable"],
  ["honda del sol",               "del sol",   "🟢 targa-top, bulletproof Honda"],
  ["toyota mr2 spyder",           "mr2",       "🟢 mid-engine Toyota roadster, rare + reliable"],
  ["toyota celica convertible",   "celica",    "🟢 reliable Toyota drop-top sleeper"],
  ["toyota solara convertible",   "solara",    "🟢 comfy Toyota — great road-trip daily"],
  ["nissan 350z roadster",        "350z",      "🟡 lots of car for the money"],
  ["nissan 300zx convertible",    "300zx",     "🟡 90s icon"],
  ["mitsubishi eclipse spyder",   "eclipse",   "🟡 cheap + sporty, verify maintenance"],
  ["mitsubishi 3000gt spyder",    "3000gt",    "🔴 folding-hardtop unicorn, rare + pricey"],
  // --- American: cheap, roomy, road-trip friendly ---
  ["chrysler crossfire",          "crossfire", "🟢 Mercedes SLK underneath for pennies — top sleeper"],
  ["ford mustang convertible",    "mustang",   "🟢 roomy + cheap parts — best road-trip daily"],
  ["ford thunderbird",            "thunderbird","🟡 '02-05 retro is a comfy cruiser"],
  ["chevrolet camaro convertible","camaro",    "🟡 V6 cheap, V8 fun; big cruiser"],
  ["chevrolet corvette convertible","corvette","🟡 C4 cheap, C5 is the sweet spot"],
  ["pontiac firebird convertible","firebird",  "🟡 F-body sibling; loud fun"],
  ["pontiac solstice",            "solstice",  "🟡 GM roadster sleeper; usually above budget"],
  ["cadillac allante",            "allante",   "🔴 quirky 80s/90s vert; parts are rare"],
  ["plymouth prowler",            "prowler",   "🔴 hot-rod oddball; collector money now"],
  // --- German: sharp but buy the service history ---
  ["bmw z3",                      "z3",        "🟢 the reliable BMW roadster"],
  ["bmw z4",                      "z4",        "🟡 sharper Z3 successor; solid"],
  ["bmw 3 series convertible",    "325",       "🟡 E46 vert — buy on service history"],
  ["bmw m3 convertible",          "m3",        "🟠 fast + costly to keep"],
  ["mercedes slk",                "slk",       "🟡 folding hardtop — watch pump/electrics"],
  ["mercedes clk convertible",    "clk",       "🟠 handsome cruiser; electrics bite"],
  ["mercedes sl convertible",     " sl ",      "🟠 R129 tank but repairs bite"],
  ["audi tt roadster",            "audi tt",   "🟠 desirable but pricey to fix"],
  ["audi a4 cabriolet",           "a4",        "🟠 pretty; CVT + roof headaches"],
  ["porsche boxster",             "boxster",   "🟠 dream pick — IMS-bearing risk this cheap"],
  ["porsche 944",                 "944",       "🟠 classic; belts/parts add up"],
  ["volkswagen cabrio",           "cabrio",    "🟡 cheap + cheerful"],
  ["volkswagen eos",              "eos",       "🟡 hardtop vert; watch roof leaks"],
  ["volkswagen new beetle convertible","beetle","🟡 easy, fun daily"],
  // --- British / Swedish: character ---
  ["jaguar xk8 convertible",      "xk8",       "🟠 gorgeous GT; Nikasil on early engines"],
  ["jaguar xkr convertible",      "xkr",       "🟠 supercharged Jag GT; pricey to keep"],
  ["jaguar xjs convertible",      "xjs",       "🟠 old-school GT; complex"],
  ["mg mgb",                      "mgb",       "🔴 classic roadster; hobby car, not a daily"],
  ["mini cooper convertible",     "mini",      "🟡 fun; watch clutch/CVT"],
  ["volvo c70 convertible",       "c70",       "🟡 comfy cruiser, great for trips"],
  ["saab 9-3 convertible",        "9-3",       "🟡 quirky sleeper, parts can be a hunt"],
  ["saab 900 convertible",        "900",       "🟡 classic quirky Saab"],
  // --- Italian: movie-car looks, exotic bills ---
  ["alfa romeo spider",           "alfa",      "🔴 iconic; parts/rust — not a reliable daily"],
  ["fiat 124 spider",             "fiat",      "🔴 charming; rust + parts hunt"],
  ["maserati spyder",             "maserati",  "🔴 exotic upkeep — no real $2.5k runner"],
];

const CITIES = ["long beach", "los angeles", "san diego", "riverside", "santa barbara", "las vegas"];
const ANCHORS = ["los angeles"]; // roadster mode sweeps many models; 1 broad anchor keeps it fast (FAR_AWAY trims region)
const CL_REGIONS = ["losangeles", "orangecounty", "inlandempire", "sandiego", "ventura", "bakersfield", "lasvegas"];

const FAR_AWAY = /Florida|Texas|Georgia|Carolina|Ohio|Illinois|New York|Washington|Oregon|Colorado|Utah|Spain|Mexico|Canada|,\s*(FL|TX|GA|NC|SC|OH|IL|NY|WA|OR|CO|UT)\b/i;
// KILL words in the title — immediate discards (from used-car-finder playbook).
const KILL = /salvage|rebuilt|engine swap|for parts|parts only|part out|mechanic special|project|as[\s-]?is|no title|non[\s-]?op|doesn'?t run|not running|won'?t run|blown|bill of sale only|flood/i;

const yearOf = (t) => { const m = t.match(/\b(19|20)\d{2}\b/); return m ? Number(m[0]) : null; };

function looksFake(l) {
  const y = yearOf(l.title);
  if (!y) return true;                          // no model year -> not a real car post
  if (y > CURRENT_YEAR + 1) return true;        // impossible future year -> spam
  if (l.num < minPrice) return true;            // $0/$1 bait or parts
  if (y >= 2016 && l.num < 4000) return true;   // late-model car this cheap -> bait/scam
  if (FAR_AWAY.test(l.loc)) return true;        // outside ~250 mi
  if (!/^\$/.test(l.price)) return true;        // USD only
  if (KILL.test(l.title)) return true;          // salvage/rebuilt/parts/project
  return false;
}

// Reliability tag for output: match a result title against the catalog's
// keyword column (column 2). First match wins, so order the catalog sensibly.
function tagFor(title) {
  const t = " " + title.toLowerCase() + " ";
  for (const [, key, note] of ROADSTERS) if (t.includes(key)) return note;
  return "";
}

// ---- minimal MCP stdio client ----
const child = spawn("npx", ["-y", "secondhand-mcp"], {
  env: { ...process.env, MARKETPLACES: "facebook" }, stdio: ["pipe", "pipe", "inherit"],
});
const pending = new Map();
let buf = "";
child.stdout.on("data", (c) => {
  buf += c.toString();
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
    if (!line) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  }
});
let nextId = 1;
const send = (method, params) => new Promise((res) => {
  const id = nextId++; pending.set(id, res);
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
});
const notify = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");

function parseBlocks(text) {
  const out = [];
  for (const b of text.split(/\n\s*\n/)) {
    const idM = b.match(/🆔\s*(\S+)/); if (!idM) continue;
    const priceM = b.match(/\*\*(.+?)\*\*\s*-\s*([^\n]+)/);
    const locM = b.match(/📍\s*([^\n]+)/);
    const price = priceM ? priceM[1].trim() : "";
    const title = priceM ? priceM[2].trim() : b.split("\n")[0].trim();
    const num = Number((price.match(/[\d,]+/)?.[0] || "").replace(/,/g, "")) || 0;
    out.push({ id: idM[1], price, title, loc: locM ? locM[1].trim() : "", num });
  }
  return out;
}

async function search(term, location) {
  const res = await send("tools/call", {
    name: "search_marketplace",
    arguments: { query: term, marketplace: "facebook", location, minPrice, maxPrice, limit: perSearch },
  });
  return (res.result?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
}

try {
  await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "car-search", version: "3.0.0" } });
  notify("notifications/initialized", {});

  const jobs = ROADSTER_MODE
    ? ROADSTERS.flatMap(([q]) => ANCHORS.map((c) => [q, c]))
    : CITIES.map((c) => [RAW, c]);

  const byId = new Map();
  let raw = 0;
  for (const [term, city] of jobs) {
    process.stderr.write(`searching "${term}" in ${city}...\n`);
    for (const l of parseBlocks(await search(term, city))) { raw++; if (!byId.has(l.id)) byId.set(l.id, l); }
  }

  const seen = new Set();
  const real = [];
  for (const l of [...byId.values()].sort((a, b) => a.num - b.num)) {
    if (looksFake(l)) continue;
    const key = l.title.toLowerCase().replace(/[^a-z0-9]/g, "") + "|" + l.num;
    if (seen.has(key)) continue;
    seen.add(key);
    real.push(l);
  }

  const label = ROADSTER_MODE ? "under-the-radar roadsters" : `"${RAW}"`;
  console.log(`\n=== Facebook Marketplace: ${real.length} real ${label}, $${minPrice}-$${maxPrice}, ~250 mi of Long Beach ===`);
  console.log(`(scanned ${raw} raw results; filtered out bait, fakes, salvage/parts, and out-of-area)\n`);
  if (!real.length) {
    console.log("Nothing passed the filter at this budget. Try a higher maxPrice (e.g. 4000) — sleeper roadsters are thin under $2.5k.\n");
  } else {
    for (const l of real) {
      const tag = tagFor(l.title);
      console.log(`${l.price} - ${l.title}${tag ? "  " + tag : ""}`);
      if (l.loc) console.log(`   📍 ${l.loc}`);
      console.log(`   🔗 https://www.facebook.com/marketplace/item/${l.id}`);
      console.log("");
    }
  }

  // Craigslist links (CL needs a browser to scrape; links are the reliable route).
  const clModels = ROADSTER_MODE
    ? ["mazda miata", "chrysler crossfire", "toyota mr2 spyder", "bmw z3", "jaguar xk8", "ford mustang convertible"]
    : [RAW];
  console.log(`=== Craigslist: tap-to-search links (clean title, $${minPrice}-$${maxPrice}) ===\n`);
  for (const m of clModels) {
    const q = encodeURIComponent(m);
    console.log(`${m}:`);
    for (const r of CL_REGIONS.slice(0, 4)) {
      console.log(`   https://${r}.craigslist.org/search/cta?query=${q}&min_price=${minPrice}&max_price=${maxPrice}&auto_title_status=1`);
    }
    console.log("");
  }
} finally {
  child.stdin.end(); child.kill(); process.exit(0);
}
