#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const DATA_PATH = "./data/restaurants.json";
const data = JSON.parse(readFileSync(DATA_PATH, "utf8"));

// Mappings that resolved to a different branch / store after Playwright relink
const WRONG = new Set([
  "sikgwon-036", // 본설렁탕(문정역점) → 본설렁탕국밥 수서점 (다른 지점)
  "sikgwon-085", // 요거 문정점 → 요거티아 (다른 가게)
  "sikgwon-092", // 바나프레소(문정SK점) → 문정대명벨리온점 (다른 지점, 같은 체인)
  "sikgwon-117", // 백채김치찌개 문정법조타운점 → 문정지구점 (다른 지점)
]);

let wiped = 0;
for (const r of data.restaurants) {
  if (!WRONG.has(r.id)) continue;
  delete r.naverPlaceId;
  delete r.naverSearchQuery;
  delete r.naverPlaceUrl;
  delete r.naverVisitorReviewCount;
  delete r.naverBlogReviewCount;
  delete r.naverRating;
  r.naverMenus = [];
  delete r.naverMenuUpdatedAt;
  wiped += 1;
  console.log(`WIPED ${r.id} ${r.name}`);
}

writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");
console.log(`\nWiped ${wiped} restaurants`);
