#!/usr/bin/env node
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const DATA_PATH = "./data/restaurants.json";
const TODAY = new Date().toISOString().slice(0, 10);

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
  Accept: "text/html",
  "Accept-Language": "ko-KR,ko;q=0.9",
};

// Wrong mappings to wipe before re-mapping
const WRONG_MAPPINGS = new Set(["sikgwon-085", "sikgwon-161", "sikgwon-167", "sikgwon-186"]);

function buildQuery(name) {
  return name
    .replace(/[\[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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

async function findPlaceId(page, query) {
  const url = `https://map.naver.com/p/search/${encodeURIComponent(query)}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

  // Wait up to ~9s for the page or an iframe to settle on a place URL
  for (let i = 0; i < 12; i += 1) {
    await page.waitForTimeout(750);
    const m = page.url().match(/\/place\/(\d+)/);
    if (m) return m[1];
  }

  // No auto-redirect; click the first place card in searchIframe
  const searchFrame = page.frame({ name: "searchIframe" });
  if (!searchFrame) return null;

  // Try several selectors for the first place link
  const candidates = [
    'li.UEzoS a.place_bluelink',
    'li[data-laim-exp-id] a.place_bluelink',
    'a.place_bluelink',
    'li a[href*="/restaurant/"]',
    'li a[href*="/place/"]',
    'li.VLTHu a',
    'ul > li:first-child a',
  ];

  for (const sel of candidates) {
    try {
      const el = await searchFrame.$(sel);
      if (!el) continue;
      await el.click({ timeout: 4000 });
      // Wait for entry navigation
      for (let i = 0; i < 12; i += 1) {
        await page.waitForTimeout(700);
        const m = page.url().match(/\/place\/(\d+)/);
        if (m) return m[1];
        const ef = page.frame({ name: "entryIframe" });
        if (ef) {
          const m2 = ef.url().match(/\/(?:restaurant|place|cafe)\/(\d+)/);
          if (m2) return m2[1];
        }
      }
    } catch {
      // try next selector
    }
  }

  return null;
}

async function main() {
  const data = JSON.parse(readFileSync(DATA_PATH, "utf8"));

  // Wipe wrong mappings
  for (const r of data.restaurants) {
    if (WRONG_MAPPINGS.has(r.id)) {
      delete r.naverPlaceId;
      delete r.naverPlaceUrl;
      delete r.naverVisitorReviewCount;
      delete r.naverBlogReviewCount;
      delete r.naverRating;
      r.naverMenus = [];
    }
  }

  const excludedPattern = /편의점|마트/;
  const targets = data.restaurants.filter(
    (r) =>
      (!r.naverMenus || r.naverMenus.length === 0) &&
      !excludedPattern.test(r.category ?? ""),
  );

  console.log(`Targets: ${targets.length}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    locale: "ko-KR",
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  let mapped = 0;
  let menuFetched = 0;
  let failed = 0;

  for (const r of targets) {
    const query = buildQuery(r.name);
    try {
      let placeId = r.naverPlaceId;
      if (!placeId) {
        placeId = await findPlaceId(page, query);
        if (!placeId) {
          console.log(`NOID ${r.id} [${r.name}] query=[${query}]`);
          failed += 1;
          continue;
        }
        r.naverPlaceId = placeId;
        r.naverSearchQuery = query;
        r.naverPlaceUrl = `https://pcmap.place.naver.com/restaurant/${placeId}/menu/list?from=map&fromPanelNum=1&additionalHeight=76&locale=ko&svcName=map_pcv5`;
        mapped += 1;
        console.log(`MAP  ${r.id} [${r.name}] → ${placeId}`);
      }

      const menus = await fetchMenus(placeId);
      if (menus.length) {
        r.naverMenus = menus;
        r.naverMenuUpdatedAt = TODAY;
        menuFetched += 1;
        console.log(`     menus: ${menus.length}`);
      } else {
        r.naverMenus = [];
        r.naverMenuUpdatedAt = TODAY;
        console.log(`     (no menus on Naver)`);
      }

      // Save incrementally to avoid losing progress
      writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");
      await page.waitForTimeout(500);
    } catch (err) {
      console.error(`ERR  ${r.id} ${r.name}: ${err.message}`);
      failed += 1;
    }
  }

  await browser.close();
  console.log(`\nMapped: ${mapped}, Menus fetched: ${menuFetched}, Failed: ${failed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
