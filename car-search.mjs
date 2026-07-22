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
const minPrice = Number(process.argv[4] || 1); // Facebook floods cars with $1 bait prices, so no real floor
const perSearch = 40;
const CURRENT_YEAR = new Date().getFullYear();
// Model catalog. Each row: [search term, keyword to match in a title, tag, category].
// 🟢 reliable daily · 🟡 fun, check upkeep · 🟠 cool but pricey to keep · 🔴 iconic money-pit / rarely real at budget
// categories: jp japanese · us american · de german · uk british+swedish · it italian
// Run the whole thing with "sports"/"all", or one category e.g. "japanese", or a single "term".
const ROADSTERS = [
  // --- Japanese ---
  ["mazda miata",                 "miata",     "🟢 most reliable roadster — the safe sleeper", "jp"],
  ["mazda mx-5",                  "mx-5",      "🟢 Miata (MX-5) — most reliable roadster", "jp"],
  ["mazda rx-7",                  "rx-7",      "🟠 rotary icon; apex-seal gamble", "jp"],
  ["mazda rx-8",                  "rx-8",      "🟡 rotary — cheap + fun, thirsty, seal risk", "jp"],
  ["honda s2000",                 "s2000",     "🟢 legendary roadster; peaky but reliable", "jp"],
  ["honda del sol",               "del sol",   "🟢 targa-top, bulletproof Honda", "jp"],
  ["honda prelude",               "prelude",   "🟢 sleeper 90s coupe, reliable", "jp"],
  ["acura integra",               "integra",   "🟢 bulletproof + fun; GS-R/Type R prized", "jp"],
  ["acura rsx",                   "rsx",       "🟢 reliable modern-ish sport coupe", "jp"],
  ["acura nsx",                   "nsx",       "🔴 everyday supercar — way over budget", "jp"],
  ["toyota mr2 spyder",           "mr2",       "🟢 mid-engine Toyota roadster, rare + reliable", "jp"],
  ["toyota supra",                "supra",     "🟠 legend — MkIV is money; MkIII attainable", "jp"],
  ["toyota celica",               "celica",    "🟢 reliable Toyota sport coupe/vert", "jp"],
  ["toyota solara convertible",   "solara",    "🟢 comfy Toyota — great road-trip daily", "jp"],
  ["scion fr-s",                  "fr-s",      "🟢 BRZ twin — reliable + fun", "jp"],
  ["subaru brz",                  "brz",       "🟢 modern lightweight coupe; reliable", "jp"],
  ["subaru wrx",                  "wrx",       "🟡 AWD turbo; check for abuse", "jp"],
  ["nissan 350z",                 "350z",      "🟡 lots of car for the money", "jp"],
  ["nissan 370z",                 "370z",      "🟡 modern Z; solid", "jp"],
  ["nissan 300zx",                "300zx",     "🟡 90s twin-turbo icon", "jp"],
  ["nissan 240sx",                "240sx",     "🟡 drift/tuner icon; clean ones climbing", "jp"],
  ["lexus sc300",                 "sc300",     "🟢 Supra-engine luxury coupe sleeper", "jp"],
  ["lexus sc430",                 "sc430",     "🟡 folding-hardtop luxo cruiser", "jp"],
  ["lexus is300",                 "is300",     "🟢 2JZ sleeper, reliable", "jp"],
  ["infiniti g35",                "g35",       "🟡 350Z in a suit; great value", "jp"],
  ["mitsubishi eclipse",          "eclipse",   "🟡 cheap + sporty, verify maintenance", "jp"],
  ["mitsubishi 3000gt",           "3000gt",    "🟠 90s tech flagship; complex", "jp"],
  // --- American ---
  ["chrysler crossfire",          "crossfire", "🟢 Mercedes SLK underneath for pennies — top sleeper", "us"],
  ["ford mustang",                "mustang",   "🟢 roomy + cheap parts — best road-trip daily", "us"],
  ["ford thunderbird",            "thunderbird","🟡 '02-05 retro is a comfy cruiser", "us"],
  ["chevrolet camaro",            "camaro",    "🟡 V6 cheap, V8 fun; big cruiser", "us"],
  ["chevrolet corvette",          "corvette",  "🟡 C4 cheap, C5 is the sweet spot", "us"],
  ["pontiac firebird",            "firebird",  "🟡 F-body; loud fun", "us"],
  ["pontiac trans am",            "trans am",  "🟡 F-body icon", "us"],
  ["pontiac gto",                 "gto",       "🟠 '04-06 LS muscle sleeper", "us"],
  ["pontiac solstice",            "solstice",  "🟡 GM roadster sleeper", "us"],
  ["saturn sky",                  "sky",       "🟡 Solstice twin roadster", "us"],
  ["dodge viper",                 "viper",     "🔴 V10 monster; collector money", "us"],
  ["dodge challenger",            "challenger","🟡 modern muscle; V6 cheap", "us"],
  ["dodge stealth",               "stealth",   "🟠 3000GT cousin; complex", "us"],
  ["cadillac allante",            "allante",   "🔴 quirky 80s/90s vert; parts rare", "us"],
  ["plymouth prowler",            "prowler",   "🔴 hot-rod oddball; collector money", "us"],
  // --- German ---
  ["bmw z3",                      "z3",        "🟢 the reliable BMW roadster", "de"],
  ["bmw z4",                      "z4",        "🟡 sharper Z3 successor; solid", "de"],
  ["bmw m coupe",                 "m coupe",   "🟠 'clownshoe' cult classic; pricey", "de"],
  ["bmw 3 series",                "328",       "🟡 E46 — buy on service history", "de"],
  ["bmw 335i",                    "335i",      "🟡 fast; turbo/HPFP upkeep", "de"],
  ["bmw m3",                      "m3",        "🟠 fast + costly to keep", "de"],
  ["mercedes slk",                "slk",       "🟡 folding hardtop — watch pump/electrics", "de"],
  ["mercedes clk",                "clk",       "🟠 handsome cruiser; electrics bite", "de"],
  ["mercedes sl",                 " sl ",      "🟠 R129 tank but repairs bite", "de"],
  ["audi tt",                     "audi tt",   "🟠 desirable but pricey to fix", "de"],
  ["audi s4",                     "s4",        "🟠 fast; timing/oil upkeep", "de"],
  ["porsche boxster",             "boxster",   "🟠 dream pick — IMS-bearing risk this cheap", "de"],
  ["porsche cayman",              "cayman",    "🟠 best-driving Porsche; mostly over budget", "de"],
  ["porsche 911",                 "911",       "🔴 icon; only rough/high-mile near budget", "de"],
  ["porsche 944",                 "944",       "🟠 classic; belts/parts add up", "de"],
  ["porsche 928",                 "928",       "🔴 V8 GT; cheap to buy, brutal to fix", "de"],
  ["volkswagen gti",              "gti",       "🟢 practical hot hatch; fun daily", "de"],
  ["volkswagen corrado",          "corrado",   "🔴 VR6 cult coupe; parts hunt", "de"],
  ["volkswagen cabrio",           "cabrio",    "🟡 cheap + cheerful", "de"],
  ["volkswagen eos",              "eos",       "🟡 hardtop vert; watch roof leaks", "de"],
  ["volkswagen new beetle convertible","beetle","🟡 easy, fun daily", "de"],
  // --- British / Swedish ---
  ["jaguar xk8",                  "xk8",       "🟠 gorgeous GT; Nikasil on early engines", "uk"],
  ["jaguar xkr",                  "xkr",       "🟠 supercharged Jag GT; pricey to keep", "uk"],
  ["jaguar xjs",                  "xjs",       "🟠 old-school GT; complex", "uk"],
  ["lotus elise",                 "elise",     "🔴 track toy, not a daily; over budget", "uk"],
  ["mg mgb",                      "mgb",       "🔴 classic roadster; hobby car, not a daily", "uk"],
  ["mini cooper",                 "mini",      "🟡 fun; watch clutch/CVT", "uk"],
  ["volvo c70",                   "c70",       "🟡 comfy cruiser, great for trips", "uk"],
  ["saab 9-3",                    "9-3",       "🟡 quirky sleeper, parts can be a hunt", "uk"],
  ["saab 900",                    "900",       "🟡 classic quirky Saab", "uk"],
  // --- Italian ---
  ["alfa romeo spider",           "alfa",      "🔴 iconic; parts/rust — not a reliable daily", "it"],
  ["fiat 124 spider",             "fiat",      "🔴 charming; rust + parts hunt", "it"],
  ["maserati spyder",             "maserati",  "🔴 exotic upkeep — no real $2.5k runner", "it"],
];

// Category aliases the user can type as the first arg.
const CATEGORY = { japanese: "jp", jp: "jp", american: "us", us: "us", german: "de", de: "de",
  british: "uk", uk: "uk", swedish: "uk", euro: "de", italian: "it", it: "it" };
const ALL_ALIASES = ["roadsters", "roadster", "sports", "all", "cars", "undertheradar", "sleepers"];

const CITIES = ["long beach", "los angeles", "san diego", "riverside", "santa barbara", "las vegas"];
const ANCHORS = ["los angeles"]; // roadster mode sweeps many models; 1 broad anchor keeps it fast (FAR_AWAY trims region)
const CL_REGIONS = ["losangeles", "orangecounty", "inlandempire", "sandiego", "ventura", "bakersfield", "lasvegas"];

const FAR_AWAY = /Florida|Texas|Georgia|Carolina|Ohio|Illinois|New York|Washington|Oregon|Colorado|Utah|Spain|Mexico|Canada|,\s*(FL|TX|GA|NC|SC|OH|IL|NY|WA|OR|CO|UT)\b/i;
// KILL words in the title — immediate discards (from used-car-finder playbook).
const KILL = /salvage|rebuilt|engine swap|mechanic special|project|as[\s-]?is|no title|non[\s-]?op|doesn'?t run|not running|won'?t run|blown|bill of sale only|flood/i;
// PARTS listings — someone selling components, not a whole car. These flooded
// the results ("parting out", "partes", "engine", "transmission", "bumper"...).
const PARTS = /\bparts?\b|\bpartes\b|\bpartout\b|parting|parted|part[\s-]out|\bfor part\b|\bengine\b|\bmotor\b|\btransmission\b|\btranny\b|long block|\bbumper\b|\bfender\b|\bexhaust\b|\bheader\b|\bhood\b|\becu\b|\bswap\b|\brims?\b|\bwheels?\b|\bspoiler\b|duckbill|\bcoilovers?\b|\bseats?\b|\bdoor panel\b/i;
// WANTED / ISO posts — someone looking to buy, not sell.
const WANTED = /\blooking for\b|\bin search of\b|\biso\b|\bwtb\b|want(ed)? to buy/i;

const yearOf = (t) => { const m = t.match(/\b(19|20)\d{2}\b/); return m ? Number(m[0]) : null; };

// NOTE: Facebook shows a bogus $1/$0 "bait" price on a huge share of car
// listings (sellers do it to jump into cheap searches; the real price is inside
// the listing). So we CANNOT trust the displayed price to filter — instead we
// keep older cars even at a bait price, and use the year+price combo only to
// kill the obvious modern-car scams ("$1 2024 Corvette").
function looksFake(l) {
  const y = yearOf(l.title);
  if (!y) return true;                          // no model year -> not a real car post
  if (y > CURRENT_YEAR + 1) return true;        // impossible future year -> spam
  if (y >= 2012 && l.num < 3000) return true;   // a <~14yr car this cheap = bait/scam
  if (FAR_AWAY.test(l.loc)) return true;        // outside ~250 mi
  if (!/^\$/.test(l.price)) return true;        // USD only (drops €/foreign)
  if (KILL.test(l.title)) return true;          // salvage/rebuilt/project
  if (PARTS.test(l.title)) return true;         // parting out / components, not a car
  if (WANTED.test(l.title)) return true;        // ISO / looking-to-buy posts
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

  const catFilter = CATEGORY[RAW];
  const catalogMode = Boolean(catFilter) || ALL_ALIASES.includes(RAW);
  const models = catFilter ? ROADSTERS.filter((r) => r[3] === catFilter) : ROADSTERS;
  const jobs = catalogMode
    ? models.flatMap(([q]) => ANCHORS.map((c) => [q, c]))
    : CITIES.map((c) => [RAW, c]);
  if (catalogMode) process.stderr.write(`sweeping ${models.length} models (this is a big scan — give it a few minutes)...\n`);

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
    l.tag = tagFor(l.title);
    if (catalogMode && !l.tag) continue; // drop tangential cars not in the catalog (Avalon, ES300, ...)
    const key = l.title.toLowerCase().replace(/[^a-z0-9]/g, "") + "|" + l.num;
    if (seen.has(key)) continue;
    seen.add(key);
    real.push(l);
  }

  const label = catFilter ? `${RAW} sports cars` : (ALL_ALIASES.includes(RAW) ? "sports cars & convertibles" : `"${RAW}"`);
  console.log(`\n=== Facebook Marketplace: ${real.length} real ${label}, $${minPrice}-$${maxPrice}, ~250 mi of Long Beach ===`);
  console.log(`(scanned ${raw} raw results; filtered out bait, fakes, salvage/parts, and out-of-area)\n`);
  if (!real.length) {
    console.log("Nothing passed the filter at this budget. Try a higher maxPrice (e.g. 4000) — sleeper roadsters are thin under $2.5k.\n");
  } else {
    for (const l of real) {
      const tag = l.tag;
      const shown = l.num <= 1 ? "price hidden — open to see" : l.price;
      console.log(`${shown} - ${l.title}${tag ? "  " + tag : ""}`);
      if (l.loc) console.log(`   📍 ${l.loc}`);
      console.log(`   🔗 https://www.facebook.com/marketplace/item/${l.id}`);
      console.log("");
    }
  }

  // Craigslist native 250-mile radius searches. CL supports search_distance +
  // postal, so ONE link per model covers the whole area from Long Beach. CL
  // blocks headless scraping and dropped its public API, so deep links beat a
  // fragile terminal scraper. One CL search per model in the active sweep, to
  // match the Facebook breadth.
  const POSTAL = "90802"; // Long Beach, CA
  const clModels = catalogMode ? models.map((r) => r[0]) : [RAW];
  console.log(`=== Craigslist: 250-mile radius searches from Long Beach (clean title, $${minPrice}-$${maxPrice}) ===`);
  console.log(`(open in a browser; each covers the full ${clModels.length > 1 ? "area for that model" : "250-mile area"})\n`);
  for (const m of clModels) {
    const q = encodeURIComponent(m);
    console.log(`${m}:`);
    console.log(`   https://losangeles.craigslist.org/search/cta?query=${q}&min_price=${minPrice}&max_price=${maxPrice}&search_distance=250&postal=${POSTAL}&auto_title_status=1`);
  }
  console.log("");
} finally {
  child.stdin.end(); child.kill(); process.exit(0);
}
