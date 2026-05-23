#!/usr/bin/env node
// Capture the home tab to embed in README.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const URL = process.env.SCREENSHOT_URL || "https://yellowcornsalad.github.io/ENKI_Food_Selector/";
const OUT_DIR = resolve("./assets/screenshots");
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 420, height: 980 },
  deviceScaleFactor: 2,
  locale: "ko-KR",
  timezoneId: "Asia/Seoul",
});
const page = await context.newPage();

console.log("Loading:", URL);
await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
// allow lunch countdown + map filter to settle
await page.waitForTimeout(2500);

const out = resolve(OUT_DIR, "home.png");
await page.screenshot({ path: out, fullPage: false });
console.log("Saved:", out);

await browser.close();
