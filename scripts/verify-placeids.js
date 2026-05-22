#!/usr/bin/env node
import { readFileSync } from "node:fs";

const data = JSON.parse(readFileSync("./data/restaurants.json", "utf8"));
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
  Accept: "text/html",
  "Accept-Language": "ko-KR,ko;q=0.9",
};

function extractName(html, placeId) {
  const re = new RegExp(`PlaceDetailBase:${placeId}[^{]*\\{[^}]*"name":"([^"]+)"`);
  const m = html.match(re);
  return m ? m[1] : null;
}

const onlyMissing = process.argv[2] === "missing";
const targets = data.restaurants.filter((r) => {
  if (!r.naverPlaceId) return false;
  if (/편의점|마트/.test(r.category ?? "")) return false;
  if (onlyMissing && r.naverMenus && r.naverMenus.length > 0) return false;
  return true;
});

console.log(`Checking ${targets.length} stores...`);
for (const r of targets) {
  try {
    const url = `https://m.place.naver.com/restaurant/${r.naverPlaceId}`;
    const res = await fetch(url, { headers: HEADERS, redirect: "follow" });
    const html = await res.text();
    const placeName = extractName(html, r.naverPlaceId);
    const ourCore = r.name.split("(")[0].trim().slice(0, 4);
    const match = placeName && (placeName.includes(ourCore) || ourCore.includes(placeName.split(" ")[0]));
    console.log(`${match ? "OK " : "??"} ${r.id} ours=[${r.name}] naver=[${placeName ?? "?"}] (placeId=${r.naverPlaceId})`);
    await new Promise((x) => setTimeout(x, 600));
  } catch (e) {
    console.log(`ERR ${r.id}: ${e.message}`);
  }
}
