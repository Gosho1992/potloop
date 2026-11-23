// Looks up QIE ID names (yourname.qie) through QIE's public, read-only Wallet MCP server.
// Falls back to a configured label, then to a short address. Never blocks anything.
import { config, isMainnet } from "./config";

const cache = new Map();

export const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

async function mcp(name, args) {
  const res = await fetch("https://mcp.qie.digital/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  const json = JSON.parse(line ? line.slice(5) : text);
  return json?.result?.structuredContent || null;
}

async function reverseLookup(address) {
  return (await mcp("qie_reverse_lookup", { address, network: "mainnet" }))?.name || null;
}

/** "thandi" or "thandi.qie" -> its QIE address (mainnet only). Returns null if not registered. */
export async function resolveQieName(name) {
  if (!isMainnet) return null;
  try {
    const r = await mcp("qie_resolve_name", { name: name.trim().toLowerCase() });
    return r?.status === "ok" && r.address ? { address: r.address, name: r.name } : null;
  } catch {
    return null;
  }
}

export async function resolveNames(addresses) {
  const out = {};
  await Promise.all(
    addresses.map(async (a) => {
      const key = a.toLowerCase();
      if (cache.has(key)) return (out[key] = cache.get(key));
      let qie = null;
      if (isMainnet) {
        try {
          qie = await reverseLookup(a);
        } catch {
          qie = null;
        }
      }
      const entry = { qie, label: config.labels[key] || null };
      cache.set(key, entry);
      out[key] = entry;
    })
  );
  return out;
}

export function displayName(names, address) {
  const e = names?.[address?.toLowerCase()];
  return e?.qie || e?.label || shortAddr(address);
}
