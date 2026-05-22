#!/usr/bin/env node
const placeId = process.argv[2] || "2002711258";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
  Accept: "text/html",
  "Accept-Language": "ko-KR,ko;q=0.9",
};

function extractApolloState(html) {
  const at = html.indexOf("__APOLLO_STATE__");
  if (at === -1) return null;
  let i = html.indexOf("{", at);
  if (i === -1) return null;
  const start = i;
  let depth = 0, inString = false, escape = false;
  for (; i < html.length; i += 1) {
    const ch = html[i];
    if (inString) {
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") depth += 1;
    else if (ch === "}") { depth -= 1; if (depth === 0) { i += 1; break; } }
  }
  try { return JSON.parse(html.slice(start, i)); } catch { return null; }
}

const paths = ["restaurant", "cafe", "place"];
for (const p of paths) {
  const url = `https://m.place.naver.com/${p}/${placeId}/menu/list`;
  const res = await fetch(url, { headers: HEADERS });
  const html = await res.text();
  const state = extractApolloState(html);
  if (!state) { console.log(p, "no state"); continue; }
  const types = new Set();
  for (const [, v] of Object.entries(state)) {
    if (v && typeof v === "object" && v.__typename) types.add(v.__typename);
  }
  console.log(`${p}: ${[...types].join(", ")}`);
}
