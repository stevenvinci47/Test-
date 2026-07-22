#!/usr/bin/env node
// Standalone Facebook Marketplace search via the secondhand-mcp server.
// No install step: uses `npx -y secondhand-mcp` and speaks MCP over stdio directly.
//
// Usage:
//   node run-search.mjs "<query>" [location] [maxPrice] [limit]
// Examples:
//   node run-search.mjs "bike"
//   node run-search.mjs "iphone 14" "nyc" 400 10
//   node run-search.mjs "vintage couch" "los angeles"

import { spawn } from "node:child_process";

const [, , query, location = "san francisco", maxPrice, limit = "10"] = process.argv;

if (!query) {
  console.error('Usage: node run-search.mjs "<query>" [location] [maxPrice] [limit]');
  process.exit(1);
}

const args = {
  query,
  marketplace: "facebook",
  location,
  limit: Number(limit),
};
if (maxPrice !== undefined) args.maxPrice = Number(maxPrice);

// --- minimal MCP stdio client (newline-delimited JSON-RPC) ---
const child = spawn("npx", ["-y", "secondhand-mcp"], {
  env: { ...process.env, MARKETPLACES: "facebook" },
  stdio: ["pipe", "pipe", "inherit"],
});

const pending = new Map();
let buf = "";
child.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

let nextId = 1;
function send(method, params) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

try {
  await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "run-search", version: "1.0.0" },
  });
  notify("notifications/initialized", {});

  const res = await send("tools/call", { name: "search_marketplace", arguments: args });
  const contents = res.result?.content ?? [];
  let text = contents.filter((c) => c.type === "text").map((c) => c.text).join("\n");
  // The server prints each listing's ID (🆔 <id>) but not its URL. Add a
  // clickable Facebook link right after every ID so results are tappable.
  text = text.replace(/(🆔\s*)(\S+)/g, (_, tag, id) =>
    `${tag}${id}\n   🔗 https://www.facebook.com/marketplace/item/${id}`);
  console.log(text || JSON.stringify(res.result ?? res.error, null, 2));
} finally {
  child.stdin.end();
  child.kill();
  process.exit(0);
}
