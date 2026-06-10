// 네이버 별점 일괄 갱신. 기존 파서는 옛 필드 visitorReviewScore(단수)를 읽어
// 대부분 별점을 놓쳤다. 현재 네이버는 visitorReviewsScore(복수 Reviews)에 평점을 둔다.
// placeId 보유한 모든 식당의 home 페이지를 fetch 해 별점·리뷰수를 다시 채운다.
import { readFileSync, writeFileSync } from "node:fs";

const DATA_PATH = "./data/restaurants.json";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
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

async function fetchRating(placeId) {
  for (const p of ["restaurant", "cafe", "place"]) {
    try {
      const res = await fetch(`https://m.place.naver.com/${p}/${placeId}/home`, { headers: HEADERS, redirect: "follow" });
      if (!res.ok) continue;
      const st = extractApolloState(await res.text());
      const base = st && st[`PlaceDetailBase:${placeId}`];
      if (!base) continue;
      const score = typeof base.visitorReviewsScore === "number" ? base.visitorReviewsScore : null;
      const reviews = typeof base.visitorReviewsTotal === "number" ? base.visitorReviewsTotal : null;
      const blog = typeof base.cafeBlogReviewsTotal === "number" ? base.cafeBlogReviewsTotal : null;
      return { score, reviews, blog, name: base.name };
    } catch { /* next path */ }
  }
  return null;
}

async function main() {
  const data = JSON.parse(readFileSync(DATA_PATH, "utf8"));
  const targets = data.restaurants.filter((r) => r.naverPlaceId);
  console.log(`별점 갱신 대상(placeId 보유): ${targets.length}곳\n`);

  let rated = 0, zeroScore = 0, fixed1 = 0, fail = 0;
  let done = 0;

  for (const r of targets) {
    const info = await fetchRating(r.naverPlaceId);
    done += 1;
    if (!info) { fail += 1; console.log(`FAIL ${r.id} ${r.name}`); continue; }

    const had1 = r.naverRating === 1;
    if (info.score && info.score > 0) {
      r.naverRating = info.score;
      rated += 1;
    } else {
      // score 0 = 네이버가 별점 미표시 → 가짜 ★1 등 제거
      if (typeof r.naverRating === "number") { delete r.naverRating; if (had1) fixed1 += 1; }
      zeroScore += 1;
    }
    if (typeof info.reviews === "number") r.naverVisitorReviewCount = info.reviews;
    if (typeof info.blog === "number") r.naverBlogReviewCount = info.blog;

    if (done % 20 === 0) {
      writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");
      console.log(`  …${done}/${targets.length} 진행`);
    }
    await new Promise((x) => setTimeout(x, 180));
  }

  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`\n=== Done ===`);
  console.log(`별점 채움: ${rated}곳 · 별점 0(미표시): ${zeroScore}곳 · 가짜 ★1 제거: ${fixed1}곳 · 실패: ${fail}곳`);
}

main().catch((e) => { console.error(e); process.exit(1); });
