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

import { spawn, execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const RAW = (process.argv[2] || "roadsters").toLowerCase();
const maxPrice = Number(process.argv[3] || 3000);
const minPrice = Number(process.argv[4] || 1); // Facebook floods cars with $1 bait prices, so no real floor
const perSearch = 40;

// Capture everything we print so we can save it to a file and copy it to the
// clipboard at the end (progress messages go to stderr and are NOT captured).
const captured = [];
const _log = console.log.bind(console);
console.log = (...a) => { const s = a.join(" "); captured.push(s); _log(s); };
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
const KILL = /salvage|rebuilt|branded|engine swap|swapped|jdm swap|mechanic special|project|as[\s-]?is|\bno title\b|lost title|bill of sale|non[\s-]?op|doesn'?t run|not running|won'?t run|\bblown\b|flood/i;
// Outright scam signals (used-car-finder scam-patterns): shipping/payment cons
// and "selling for a friend/relative/deployment" — hard discards.
const SCAM = /selling for (a |my )?(friend|friends|mother|mom|father|dad|uncle|aunt|cousin|coworker|neighbor|relative|deceased|brother|sister|grandma|grandpa)|military (deployment|deploy)|being deployed|will ship|can ship|shipping (available|included|nationwide)|storage facility|\bzelle\b|\bpaypal\b|\bvenmo\b|cash ?app|ebay motors|western union|wire transfer|gift ?card/i;
// PARTS listings — someone selling components, not a whole car. These flooded
// the results ("parting out", "partes", "engine", "transmission", "bumper"...).
const PARTS = /\bparts?\b|\bpartes\b|\bpartout\b|parting|parted|part[\s-]out|\bfor part\b|\bengine\b|\bmotor\b|\btransmission\b|\btranny\b|long block|\bbumper\b|\bfender\b|\bexhaust\b|\bheader\b|\bhood\b|\becu\b|\bswap\b|\brims?\b|\bwheels?\b|\bspoiler\b|duckbill|\bcoilovers?\b|\bseats?\b|\bdoor panel\b/i;
// WANTED / ISO posts — someone looking to buy, not sell.
const WANTED = /\blooking for\b|\bin search of\b|\biso\b|\bwtb\b|want(ed)? to buy/i;
// JUNK — toys, diecast/scale models, literature, and small parts that carry a
// year + a low real price ($3-$25) and so sneak past the other filters.
const JUNK = /hot ?wheels|matchbox|die-?cast|maisto|b?burago|\bwelly\b|\bertl\b|toymax|greenlight|snapfast|1[:/]1[08]\b|1[:/]2[0-9]\b|1[:/]3[26]\b|1[:/]64\b|\bscale\b|model kit|collectible|collector car|jigsaw|puzzle|owner'?s? manual|shop manual|service manual|brochure|\bposter\b|print ad|\bmedal\b|magazine|wall decor|\blicense\b|\blamp\b|antenna|adapter|dipstick|harness|actuator|\bbrakes?\b|headlight|tail ?light|key.?fob|keyfob|fuel tank|intake pipe|\bshell\b|emblem|\bbadge\b|decal|\bstrap\b/i;

const yearOf = (t) => { const m = t.match(/\b(19|20)\d{2}\b/); return m ? Number(m[0]) : null; };

// Convertible gate — the buyer only wants open-top cars.
const CONV_WORDS = /convertible|\bconv\b|roadster|spyder|spider|cabriolet|cabrio|drop[\s-]?top|soft[\s-]?top|\bvert\b/i;
// Models that are essentially always convertibles, so keep them even when the
// title omits the body style. (Models that also come as coupes — Z3/Z4, MR2,
// Crossfire, 350Z, etc. — are NOT here; their convertible versions still pass
// via the body-style words above, while their coupes are correctly excluded.)
const ALWAYS_CONV = /\bmiata\b|mx-?5|\bs2000\b|boxster|solstice|saturn sky|\bslk\b|\bsl\b|prowler/i;
const isConvertible = (title) => CONV_WORDS.test(title) || ALWAYS_CONV.test(title);

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
  if (KILL.test(l.title)) return true;          // salvage/rebuilt/project/title problems
  if (SCAM.test(l.title)) return true;          // shipping/payment/"selling for a friend" cons
  if (PARTS.test(l.title)) return true;         // parting out / components, not a car
  if (WANTED.test(l.title)) return true;        // ISO / looking-to-buy posts
  if (JUNK.test(l.title)) return true;          // toys, diecast, manuals, small parts
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

// ---- Craigslist (SAPI JSON feed; real prices, no $1 bait) ----
const CL_POSTAL = "90802"; // Long Beach
const CL_UA = "Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const CL_SPAM = /priced to (sale|sell)|money back|passed smog|cold ac|🔷|❗|✅|call or text|se habla|\bwholesale\b|no credit|buy here pay here|\bbhph\b|financing available/i;

function clDecode(item, floor, ceil) {
  if (!Array.isArray(item)) return null;
  const strings = [], numbers = [];
  const walk = (v) => {
    if (typeof v === "string") strings.push(v);
    else if (typeof v === "number") numbers.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(item);
  const slug = strings.filter((s) => /^[a-z0-9]+(-[a-z0-9]+){3,}$/.test(s)).sort((a, b) => b.length - a.length)[0];
  if (!slug) return null;
  const segs = slug.split("-");
  const yr = (slug.match(/\b(19|20)\d{2}\b/) || [])[0];
  // Price lives in the slug (city-year-model-PRICE-suffix). Take the largest
  // in-range slug number that isn't the year; fall back to the item's numbers.
  const slugNums = segs.map(Number).filter((n) => Number.isFinite(n) && n >= floor && n <= ceil && String(n) !== yr);
  const price = slugNums.length
    ? Math.max(...slugNums)
    : numbers.filter((n) => Number.isInteger(n) && n >= floor && n <= ceil && String(n) !== yr).sort((a, b) => b - a)[0];
  const yi = yr ? segs.indexOf(yr) : -1;
  const loc = (yi > 0 ? segs.slice(0, yi) : [segs[0]]).join(" ").replace(/\b\w/g, (c) => c.toUpperCase());
  const rest = (yi >= 0 ? segs.slice(yi) : segs).filter(
    (s) => !/^(obo|firm|cash|clean|title|runs|great|nice|price|neg|negotiable)$/.test(s) && !(/^\d+$/.test(s) && s !== yr)
  );
  return { slug, title: rest.join(" ").replace(/\b\w/g, (c) => c.toUpperCase()), price, loc };
}

async function clSearch(model) {
  const floor = Math.max(minPrice, 1);
  const url =
    `https://sapi.craigslist.org/web/v8/postings/search/full?batch=1-0-360-0-0&cc=US&lang=en&searchPath=cta` +
    `&query=${encodeURIComponent(model)}&min_price=${floor}&max_price=${maxPrice}&searchDistance=250&postal=${CL_POSTAL}&sort=date`;
  let items;
  try {
    const r = await fetch(url, { headers: { "User-Agent": CL_UA, Accept: "application/json" } });
    items = JSON.parse(await r.text())?.data?.items;
  } catch { return []; }
  if (!Array.isArray(items)) return [];
  const key = model.split(/\s+/).pop().toLowerCase();
  const out = [], seen = new Set();
  for (const it of items) {
    const d = clDecode(it, floor, maxPrice);
    if (!d) continue;
    const flat = d.slug.replace(/-/g, " "); // de-hyphenate so the shared filters match
    if (!d.slug.includes(key)) continue;
    if (!isConvertible(d.slug)) continue;
    if (CL_SPAM.test(flat) || KILL.test(flat) || SCAM.test(flat) || PARTS.test(flat)) continue;
    if (seen.has(d.slug)) continue;
    seen.add(d.slug);
    out.push(d);
  }
  return out;
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
    if (!isConvertible(l.title)) continue; // buyer wants convertibles only
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

  // --- Craigslist: real listings via SAPI (real prices, no $1 bait) ---
  const clModels = catalogMode ? models.map((r) => r[0]) : [RAW];
  process.stderr.write(`\nsweeping Craigslist for ${clModels.length} models...\n`);
  const clAll = [], clSeen = new Set();
  for (const m of clModels) {
    process.stderr.write(`craigslist "${m}"...\n`);
    for (const d of await clSearch(m)) {
      if (clSeen.has(d.slug)) continue;
      clSeen.add(d.slug);
      d.tag = tagFor(d.title);
      clAll.push(d);
    }
  }
  clAll.sort((a, b) => (a.price || 1e9) - (b.price || 1e9));
  console.log(`=== Craigslist: ${clAll.length} convertibles, $${minPrice}-$${maxPrice}, 250 mi of Long Beach (90802) ===`);
  console.log(`(real prices — Craigslist has no $1 bait)\n`);
  if (!clAll.length) {
    console.log("No Craigslist convertible matches parsed this run — try again, or browse:");
    console.log("  https://losangeles.craigslist.org/search/cta?postal=90802&search_distance=250\n");
  } else {
    for (const d of clAll) {
      console.log(`${d.price ? "$" + d.price.toLocaleString() : "see listing"} - ${d.title}${d.tag ? "  " + d.tag : ""}${d.loc ? "  📍 " + d.loc : ""}`);
    }
    console.log("");
  }

  // Save the whole report to a file and copy it to the clipboard for easy pasting.
  const text = captured.join("\n");
  try { writeFileSync("car-results.txt", text); process.stderr.write("\nSaved report to car-results.txt\n"); } catch {}
  let copied = false;
  for (const cmd of ["termux-clipboard-set", "pbcopy", "xclip -selection clipboard", "xsel --clipboard --input"]) {
    try { execSync(cmd, { input: text, stdio: ["pipe", "ignore", "ignore"] }); copied = true; break; } catch {}
  }
  process.stderr.write(copied
    ? "Results copied to clipboard — just paste them here.\n"
    : "(No clipboard tool found. Run `pkg install termux-api` once, or open car-results.txt to copy.)\n");
} finally {
  child.stdin.end(); child.kill(); process.exit(0);
}
