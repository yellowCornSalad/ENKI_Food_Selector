#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const DATA_PATH = "./data/restaurants.json";
const TODAY = new Date().toISOString().slice(0, 10);

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
};

function extractApolloState(html) {
  const at = html.indexOf("__APOLLO_STATE__");
  if (at === -1) return null;
  let i = html.indexOf("{", at);
  if (i === -1) return null;
  const start = i;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (; i < html.length; i += 1) {
    const ch = html[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        break;
      }
    }
  }
  try {
    return JSON.parse(html.slice(start, i));
  } catch {
    return null;
  }
}

function priceText(price) {
  if (price == null || !Number.isFinite(price)) return "";
  return `${price.toLocaleString("ko-KR")}원`;
}

function parseMenusFromState(state) {
  if (!state) return [];
  const entries = [];
  for (const [, val] of Object.entries(state)) {
    if (!val || typeof val !== "object") continue;
    if (val.__typename === "Menu" && val.name) {
      const priceNum = val.price != null && val.price !== "" ? Number(val.price) : null;
      const price = Number.isFinite(priceNum) ? priceNum : null;
      entries.push({
        index: typeof val.index === "number" ? val.index : 0,
        menu: {
          description: val.description ?? "",
          name: val.name,
          price,
          priceText: priceText(price),
        },
      });
    }
  }
  entries.sort((a, b) => a.index - b.index);
  return entries.map((e) => e.menu);
}

async function fetchMenus(placeId) {
  const paths = ["restaurant", "cafe", "place"];
  for (const p of paths) {
    const url = `https://m.place.naver.com/${p}/${placeId}/menu/list`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) continue;
    const html = await res.text();
    const menus = parseMenusFromState(extractApolloState(html));
    if (menus.length) return menus;
  }
  return [];
}

async function searchPlaceId(query) {
  const url = `https://map.naver.com/p/api/search/allSearch?query=${encodeURIComponent(query)}&type=all&searchCoord=127.123;37.484&boundary=`;
  const res = await fetch(url, {
    headers: {
      ...HEADERS,
      Accept: "application/json, text/plain, */*",
      Referer: "https://map.naver.com/",
    },
  });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  if (!json) return null;
  const items = json?.result?.place?.list ?? [];
  if (!items.length) return null;
  return items[0]?.id ?? null;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const data = JSON.parse(readFileSync(DATA_PATH, "utf8"));
  const excludedPattern = /편의점|마트/;
  const phase = process.argv[2] ?? "withId";

  const targets = data.restaurants.filter(
    (r) =>
      (!r.naverMenus || r.naverMenus.length === 0) &&
      !excludedPattern.test(r.category ?? ""),
  );

  let processed = 0;
  let updated = 0;
  for (const r of targets) {
    const hasId = !!r.naverPlaceId;
    if (phase === "withId" && !hasId) continue;
    if (phase === "search" && hasId) continue;

    try {
      let placeId = r.naverPlaceId;
      if (!placeId) {
        placeId = await searchPlaceId(r.name);
        if (!placeId) {
          console.log(`NOID ${r.id} ${r.name}`);
          await sleep(700);
          continue;
        }
        r.naverPlaceId = placeId;
        r.naverSearchQuery = r.name;
      }
      const menus = await fetchMenus(placeId);
      if (menus.length) {
        r.naverMenus = menus;
        r.naverMenuUpdatedAt = TODAY;
        if (!r.naverPlaceUrl) {
          r.naverPlaceUrl = `https://pcmap.place.naver.com/restaurant/${placeId}/menu/list?from=map&fromPanelNum=1&additionalHeight=76&locale=ko&svcName=map_pcv5`;
        }
        updated += 1;
        console.log(`OK   ${r.id} ${r.name} → ${menus.length} menus`);
      } else {
        r.naverMenus = [];
        r.naverMenuUpdatedAt = TODAY;
        console.log(`EMP  ${r.id} ${r.name} (no menus on Naver)`);
      }
      processed += 1;
      await sleep(900);
    } catch (err) {
      console.error(`ERR  ${r.id} ${r.name}: ${err.message}`);
      await sleep(900);
    }
  }

  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`\nProcessed: ${processed}, Menus updated: ${updated}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
