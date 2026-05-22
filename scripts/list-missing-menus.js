#!/usr/bin/env node
import { readFileSync } from "node:fs";

const data = JSON.parse(readFileSync("./data/restaurants.json", "utf8"));
const missing = data.restaurants.filter((r) => !r.naverMenus || r.naverMenus.length === 0);
const excludedPattern = /편의점|마트/;
const targets = missing.filter((r) => !excludedPattern.test(r.category ?? ""));
const skipped = missing.filter((r) => excludedPattern.test(r.category ?? ""));

console.log(`Total restaurants: ${data.restaurants.length}`);
console.log(`Missing naverMenus: ${missing.length}`);
console.log(`Excluded (convenience/mart): ${skipped.length}`);
console.log(`Targets for crawl: ${targets.length}`);
console.log("\n=== Targets ===");
for (const r of targets) {
  console.log(`${r.id}\t${r.name}\t[${r.category}]\tplaceId=${r.naverPlaceId ?? "-"}`);
}
console.log("\n=== Skipped ===");
for (const r of skipped) {
  console.log(`${r.id}\t${r.name}\t[${r.category}]`);
}
