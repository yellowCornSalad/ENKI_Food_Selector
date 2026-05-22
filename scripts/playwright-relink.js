#!/usr/bin/env node
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const DATA_PATH = "./data/restaurants.json";
const TODAY = new Date().toISOString().slice(0, 10);
// Office coords (송파대로 167 문정역테라타워)
const OFFICE_LAT = 37.4858;
const OFFICE_LNG = 127.1228;
const MAP_COORD = `15.00,${OFFICE_LNG},${OFFICE_LAT},0,0,0,dh`;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
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

function parsePlaceMeta(state, placeId) {
  if (!state) return null;
  const key = `PlaceDetailBase:${placeId}`;
  const entity = state[key];
  if (!entity) return null;
  const visitorKey = `VisitorReviewStatsResult:${placeId}`;
  const stats = state[visitorKey] ?? null;
  return {
    name: entity.name ?? null,
    address: entity.address ?? entity.roadAddress ?? null,
    rating: typeof entity.visitorReviewScore === "number" ? entity.visitorReviewScore : null,
    visitorReviewCount: stats?.totalCount ?? entity.visitorReviewsTotal ?? null,
    blogReviewCount: entity.blogCafeReviewCount ?? null,
  };
}

function buildQueries(restaurant) {
  const raw = restaurant.name.replace(/[\[\]()]/g, " ").replace(/\s+/g, " ").trim();
  const variations = [raw];
  // 지점명 빼고 + 송파/문정 추가
  const baseName = raw.replace(/(문정[\w가-힣]*점|법조타운점|문정역점|역점|문정직영점|문정본점|문정\w*|본점|직영점)$/g, "").trim();
  if (baseName && baseName !== raw && baseName.length >= 2) {
    variations.push(`${baseName} 문정`);
    variations.push(`${baseName} 송파`);
  }
  if (!/문정|송파/.test(raw)) {
    variations.push(`${raw} 문정`);
  }
  return [...new Set(variations)];
}

function scoreMatch(restaurant, placeMeta) {
  if (!placeMeta || !placeMeta.name) return 0;
  let score = 0;
  const ours = restaurant.name.replace(/[\[\]()]/g, " ").replace(/\s+/g, " ").toLowerCase();
  const theirs = placeMeta.name.toLowerCase();
  const oursCore = ours.split(/[\s]/)[0];
  if (theirs.includes(oursCore) || ours.includes(theirs.split(/[\s]/)[0])) score += 50;
  const addr = (placeMeta.address ?? "").toLowerCase();
  if (/송파|문정|법조타운|가든파이브|문정동/.test(addr)) score += 40;
  else if (/서울/.test(addr)) score += 5;
  else score -= 60;
  // 지점명 일치 보너스
  const ourBranch = ours.match(/문정[\w가-힣]*점|법조타운점|문정역점|파크하비오점/);
  if (ourBranch && theirs.includes(ourBranch[0])) score += 20;
  return score;
}

async function searchPlaceId(page, query) {
  const url = `https://map.naver.com/p/search/${encodeURIComponent(query)}?c=${MAP_COORD}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

  // 자동 redirect 대기
  for (let i = 0; i < 14; i += 1) {
    await page.waitForTimeout(700);
    const m = page.url().match(/\/place\/(\d+)/);
    if (m) return m[1];
  }

  // searchIframe 첫 카드 클릭 시도
  const searchFrame = page.frame({ name: "searchIframe" });
  if (!searchFrame) return null;
  const selectors = [
    'li.UEzoS a.place_bluelink',
    'li[data-laim-exp-id] a.place_bluelink',
    'a.place_bluelink',
    'li a[href*="/restaurant/"]',
    'li a[href*="/place/"]',
    'ul > li:first-child a',
  ];
  for (const sel of selectors) {
    try {
      const el = await searchFrame.$(sel);
      if (!el) continue;
      await el.click({ timeout: 4000 });
      for (let i = 0; i < 10; i += 1) {
        await page.waitForTimeout(700);
        const m = page.url().match(/\/place\/(\d+)/);
        if (m) return m[1];
      }
    } catch {}
  }
  return null;
}

async function fetchPlaceDetail(placeId) {
  const paths = ["restaurant", "cafe", "place"];
  for (const p of paths) {
    const url = `https://m.place.naver.com/${p}/${placeId}/menu/list`;
    try {
      const res = await fetch(url, { headers: HEADERS, redirect: "follow" });
      if (!res.ok) continue;
      const html = await res.text();
      const state = extractApolloState(html);
      const meta = parsePlaceMeta(state, placeId);
      const menus = parseMenusFromState(state);
      if (meta) return { meta, menus, kind: p };
    } catch {}
  }
  // Fallback to homepage if menu page failed
  for (const p of paths) {
    const url = `https://m.place.naver.com/${p}/${placeId}/home`;
    try {
      const res = await fetch(url, { headers: HEADERS, redirect: "follow" });
      if (!res.ok) continue;
      const html = await res.text();
      const state = extractApolloState(html);
      const meta = parsePlaceMeta(state, placeId);
      if (meta) return { meta, menus: [], kind: p };
    } catch {}
  }
  return null;
}

async function relink(page, restaurant) {
  const queries = buildQueries(restaurant);
  let best = null;
  for (const q of queries) {
    const placeId = await searchPlaceId(page, q);
    if (!placeId) continue;
    const detail = await fetchPlaceDetail(placeId);
    if (!detail) continue;
    const score = scoreMatch(restaurant, detail.meta);
    if (!best || score > best.score) {
      best = { placeId, ...detail, score, query: q };
    }
    if (score >= 70) break; // 충분히 정확
    await new Promise((r) => setTimeout(r, 400));
  }
  return best;
}

async function main() {
  const data = JSON.parse(readFileSync(DATA_PATH, "utf8"));
  const excludedPattern = /편의점|마트/;
  const targets = data.restaurants.filter((r) => {
    if (excludedPattern.test(r.category ?? "")) return false;
    const hasReview =
      typeof r.naverRating === "number" ||
      typeof r.naverVisitorReviewCount === "number" ||
      typeof r.naverReviewCount === "number";
    const hasMenus = r.naverMenus && r.naverMenus.length > 0;
    return !hasReview || !hasMenus;
  });

  console.log(`Targets: ${targets.length}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    locale: "ko-KR",
    viewport: { width: 1280, height: 900 },
    geolocation: { latitude: OFFICE_LAT, longitude: OFFICE_LNG },
    permissions: ["geolocation"],
  });
  const page = await context.newPage();

  let linked = 0;
  let menuCount = 0;
  let skipped = 0;
  let lowScore = 0;

  for (const r of targets) {
    try {
      const best = await relink(page, r);
      if (!best || best.score < 50) {
        console.log(`SKIP ${r.id} [${r.name}] best score=${best?.score ?? "-"} (${best?.meta?.name ?? "no match"})`);
        if (best) lowScore += 1;
        else skipped += 1;
        continue;
      }
      r.naverPlaceId = best.placeId;
      r.naverSearchQuery = best.query;
      r.naverPlaceUrl = `https://pcmap.place.naver.com/${best.kind}/${best.placeId}/menu/list?from=map&fromPanelNum=1&additionalHeight=76&locale=ko&svcName=map_pcv5`;
      if (typeof best.meta?.rating === "number") r.naverRating = best.meta.rating;
      if (typeof best.meta?.visitorReviewCount === "number") r.naverVisitorReviewCount = best.meta.visitorReviewCount;
      if (typeof best.meta?.blogReviewCount === "number") r.naverBlogReviewCount = best.meta.blogReviewCount;
      if (best.menus.length) {
        r.naverMenus = best.menus;
        menuCount += 1;
      } else if (!r.naverMenus) {
        r.naverMenus = [];
      }
      r.naverMenuUpdatedAt = TODAY;
      linked += 1;
      console.log(`OK   ${r.id} [${r.name}] → ${best.placeId} (${best.meta.name}) score=${best.score} menus=${best.menus.length}`);
      // Incremental save
      writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");
      await new Promise((x) => setTimeout(x, 600));
    } catch (err) {
      console.error(`ERR  ${r.id} ${r.name}: ${err.message}`);
    }
  }

  await browser.close();
  console.log(`\n=== Done ===`);
  console.log(`Linked: ${linked}, Menus fetched: ${menuCount}, Low-score skipped: ${lowScore}, No match: ${skipped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
