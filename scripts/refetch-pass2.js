#!/usr/bin/env node
// 2차 재수집: 1차에서 점수 미달/미매칭된 14곳.
// 네이버 공식 상호가 식권대장 표기와 글자 단위로 다를 뿐 같은 가게인 경우가 많아서
// bigram 유사도 기반 퍼지 매칭으로 다시 시도한다. 명백한 오독 3건은 표기도 바로잡는다.
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const DATA_PATH = "./data/restaurants.json";
const TODAY = "2026-06-10";
const OFFICE_LAT = 37.4858;
const OFFICE_LNG = 127.1228;
const MAP_COORD = `15.00,${OFFICE_LNG},${OFFICE_LAT},0,0,0,dh`;

const TARGET_IDS = new Set([
  "sikgwon-013", "sikgwon-019", "sikgwon-032", "sikgwon-057", "sikgwon-058",
  "sikgwon-059", "sikgwon-060", "sikgwon-100", "sikgwon-118", "sikgwon-134",
  "sikgwon-141", "sikgwon-154", "sikgwon-166", "sikgwon-188",
]);

// 명백한 내 오독 — 표기 자체를 네이버 공식 상호로 교정
const NAME_FIXES = {
  "sikgwon-013": "야키니쿠히오리",
  "sikgwon-019": "얌샐러드",
  "sikgwon-154": "카가야쿠",
};

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
        menu: { description: val.description ?? "", name: val.name, price, priceText: priceText(price) },
      });
    }
  }
  entries.sort((a, b) => a.index - b.index);
  return entries.map((e) => e.menu);
}

function parsePlaceMeta(state, placeId) {
  if (!state) return null;
  const entity = state[`PlaceDetailBase:${placeId}`];
  if (!entity) return null;
  const stats = state[`VisitorReviewStatsResult:${placeId}`] ?? null;
  return {
    name: entity.name ?? null,
    address: entity.address ?? entity.roadAddress ?? null,
    rating: typeof entity.visitorReviewsScore === "number" ? entity.visitorReviewsScore : null,
    visitorReviewCount: stats?.totalCount ?? entity.visitorReviewsTotal ?? null,
    blogReviewCount: entity.blogCafeReviewCount ?? null,
  };
}

// ── 퍼지 이름 유사도 (bigram Dice) ──
function norm(s) {
  return String(s ?? "")
    .replace(/\[[^\]]*\]/g, " ")        // [가든파이브] 류 prefix 제거
    .replace(/[\[\]()]/g, " ")
    .replace(/문정|송파|법조타운|역점|본점|직영점|지점|현대아울렛|점$/g, " ")
    .replace(/[\s·,]/g, "")
    .toLowerCase();
}
function bigrams(s) {
  const out = [];
  for (let i = 0; i < s.length - 1; i += 1) out.push(s.slice(i, i + 2));
  return out;
}
function nameSim(a, b) {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.length >= 2 && (na.includes(nb) || nb.includes(na))) return 0.9;
  const ba = bigrams(na), bbSet = new Set(bigrams(nb));
  if (!ba.length || !bbSet.size) return 0;
  let hit = 0;
  for (const g of ba) if (bbSet.has(g)) hit += 1;
  return (2 * hit) / (ba.length + bigrams(nb).length);
}

function buildQueries(restaurant) {
  const raw = restaurant.name.replace(/\[[^\]]*\]/g, " ").replace(/[\[\]()]/g, " ").replace(/\s+/g, " ").trim();
  const variations = [raw];
  const baseName = raw.replace(/(문정[\w가-힣]*점|법조타운점|문정역점|역점|문정직영점|문정본점|문정\w*|본점|직영점)$/g, "").trim();
  if (baseName && baseName !== raw && baseName.length >= 2) {
    variations.push(`${baseName} 문정`);
    variations.push(`${baseName} 송파`);
    variations.push(baseName);
  }
  if (!/문정|송파/.test(raw)) variations.push(`${raw} 문정`);
  return [...new Set(variations)];
}

function scoreMatch(restaurant, placeMeta) {
  if (!placeMeta || !placeMeta.name) return { score: 0, sim: 0 };
  const sim = nameSim(restaurant.name, placeMeta.name);
  let score = 0;
  if (sim >= 0.85) score += 70;
  else if (sim >= 0.55) score += 50;
  else if (sim >= 0.34) score += 25;
  const addr = (placeMeta.address ?? "").toLowerCase();
  if (/송파|문정|법조타운|가든파이브|문정동|장지|가락/.test(addr)) score += 40;
  else if (/서울/.test(addr)) score += 5;
  else score -= 50;
  return { score, sim };
}

async function searchPlaceId(page, query) {
  const url = `https://map.naver.com/p/search/${encodeURIComponent(query)}?c=${MAP_COORD}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  for (let i = 0; i < 14; i += 1) {
    await page.waitForTimeout(700);
    const m = page.url().match(/\/place\/(\d+)/);
    if (m) return m[1];
  }
  const searchFrame = page.frame({ name: "searchIframe" });
  if (!searchFrame) return null;
  const selectors = [
    'li.UEzoS a.place_bluelink', 'li[data-laim-exp-id] a.place_bluelink',
    'a.place_bluelink', 'li a[href*="/restaurant/"]', 'li a[href*="/place/"]', 'ul > li:first-child a',
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
    try {
      const res = await fetch(`https://m.place.naver.com/${p}/${placeId}/menu/list`, { headers: HEADERS, redirect: "follow" });
      if (!res.ok) continue;
      const state = extractApolloState(await res.text());
      const meta = parsePlaceMeta(state, placeId);
      const menus = parseMenusFromState(state);
      if (meta) return { meta, menus, kind: p };
    } catch {}
  }
  for (const p of paths) {
    try {
      const res = await fetch(`https://m.place.naver.com/${p}/${placeId}/home`, { headers: HEADERS, redirect: "follow" });
      if (!res.ok) continue;
      const meta = parsePlaceMeta(extractApolloState(await res.text()), placeId);
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
    const { score, sim } = scoreMatch(restaurant, detail.meta);
    if (!best || score > best.score) best = { placeId, ...detail, score, sim, query: q };
    if (score >= 90) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  return best;
}

async function main() {
  const data = JSON.parse(readFileSync(DATA_PATH, "utf8"));

  // 표기 교정 먼저 반영
  for (const r of data.restaurants) {
    if (NAME_FIXES[r.id]) {
      console.log(`RENAME ${r.id}: ${r.name} → ${NAME_FIXES[r.id]}`);
      r.name = NAME_FIXES[r.id];
    }
  }

  const targets = data.restaurants.filter((r) => TARGET_IDS.has(r.id));
  console.log(`Targets: ${targets.length}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    locale: "ko-KR", viewport: { width: 1280, height: 900 },
    geolocation: { latitude: OFFICE_LAT, longitude: OFFICE_LNG }, permissions: ["geolocation"],
  });
  const page = await context.newPage();

  let linked = 0, menuCount = 0;
  const stillMissing = [];

  for (const r of targets) {
    try {
      const best = await relink(page, r);
      // 수락 기준: 이름 유사도가 의미 있게 기여(sim>=0.34)하고 총점>=55, 또는 이름이 거의 동일(sim>=0.85)
      const accept = best && best.sim >= 0.34 && (best.score >= 55 || best.sim >= 0.85);
      if (!accept) {
        console.log(`MISS ${r.id} [${r.name}] best=(${best?.meta?.name ?? "no match"}) score=${best?.score ?? "-"} sim=${best?.sim?.toFixed(2) ?? "-"}`);
        stillMissing.push(`${r.id} ${r.name}`);
        continue;
      }
      r.naverPlaceId = best.placeId;
      r.naverSearchQuery = best.query;
      r.naverPlaceUrl = `https://pcmap.place.naver.com/${best.kind}/${best.placeId}/menu/list?from=map&fromPanelNum=1&additionalHeight=76&locale=ko&svcName=map_pcv5`;
      if (typeof best.meta?.rating === "number") r.naverRating = best.meta.rating;
      if (typeof best.meta?.visitorReviewCount === "number") r.naverVisitorReviewCount = best.meta.visitorReviewCount;
      if (typeof best.meta?.blogReviewCount === "number") r.naverBlogReviewCount = best.meta.blogReviewCount;
      if (best.menus.length) { r.naverMenus = best.menus; menuCount += 1; }
      r.naverMenuUpdatedAt = TODAY;
      linked += 1;
      console.log(`OK   ${r.id} [${r.name}] → ${best.placeId} (${best.meta.name}) score=${best.score} sim=${best.sim.toFixed(2)} reviews=${best.meta.visitorReviewCount ?? "-"} menus=${best.menus.length}`);
      writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");
      await new Promise((x) => setTimeout(x, 600));
    } catch (err) {
      console.error(`ERR  ${r.id} ${r.name}: ${err.message}`);
      stillMissing.push(`${r.id} ${r.name} (err)`);
    }
  }

  await browser.close();
  console.log(`\n=== Pass2 Done ===`);
  console.log(`Linked: ${linked}, Menus: ${menuCount}`);
  console.log(`Still missing (${stillMissing.length}):`);
  stillMissing.forEach((s) => console.log(`  - ${s}`));
}

main().catch((err) => { console.error(err); process.exit(1); });
