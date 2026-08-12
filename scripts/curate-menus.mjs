// 메뉴 데이터 품질 정리 (2026-08-12)
// 1) 변동 잦은 대형 프랜차이즈 → 시그니처 메뉴 큐레이션으로 교체
//    (네이버 크롤 메뉴는 행사/콜라보가 섞여 금방 낡는다. 가격은 수시 변동이라
//     틀린 가격을 보여주느니 이름만 둔다.)
// 2) 전 가게: 행사/한정/이벤트 표기 메뉴 제거, 중복 제거, 비식품 항목 제거
// 3) 편의점/마트: 상품 목록(naverMenus) 비움 — 상세에서 "도시락·간편식" 안내로 대체
import { readFileSync, writeFileSync } from "node:fs";

const DATA = "./data/restaurants.json";
const d = JSON.parse(readFileSync(DATA, "utf8"));

// ── 1) 프랜차이즈 시그니처 큐레이션 (이름 매칭 → 메뉴 배열) ──
const menu = (name) => ({ description: "", name, price: null, priceText: "" });
const CURATED = [
  [/맘스터치/, ["싸이버거 세트", "딥치즈버거 세트", "휠렛버거 세트", "텐더 4조각", "케이준 양념감자"]],
  [/버거킹/, ["와퍼 세트", "치즈와퍼 세트", "콰트로치즈와퍼 세트", "비프&슈림프버거 세트", "너겟킹 10조각"]],
  [/KFC/, ["징거버거 세트", "타워버거 세트", "핫크리스피치킨 2조각", "텐더 3조각", "코울슬로"]],
  [/롯데리아/, ["불고기버거 세트", "새우버거 세트", "데리버거 세트", "치즈스틱", "양념감자"]],
  [/노브랜드버거/, ["NBB 시그니처 세트", "그릴드 불고기 세트", "치즈 버거 세트", "치킨 텐더", "프렌치프라이"]],
  [/써브웨이/, ["이탈리안 비엠티 15cm", "에그마요 15cm", "터키 15cm", "스테이크&치즈 15cm", "로티세리 바베큐 치킨 15cm"]],
  [/명랑핫도그/, ["명랑핫도그", "모짜렐라 핫도그", "체다치즈 핫도그", "감자 핫도그", "먹물 모짜렐라 핫도그"]],
];

let curated = 0;
for (const r of d.restaurants) {
  for (const [re, names] of CURATED) {
    if (re.test(r.name)) {
      r.naverMenus = names.map(menu);
      r.menuSource = "curated"; // UI 캡션 분기용
      curated++;
      console.log("CURATED", r.name, "→", names.length + "개 시그니처");
      break;
    }
  }
}

// ── 2) 전 가게 공통 필터 ──
const SEASONAL = /행사|한정판?|시즌 ?한정|이벤트|콜라보|에디션|리뉴얼|신메뉴|출시|NEW\b|\(행사\)|붐팔라|한라봉/i;
const JUNK = /배달(비|료)?|포장 ?비|공지|촬영|리뷰 ?이벤트|서비스 ?차지|예약금|룸 ?차지|콜키지|주차/;
let removedSeasonal = 0, removedJunk = 0, removedDup = 0;

for (const r of d.restaurants) {
  if (!Array.isArray(r.naverMenus) || r.menuSource === "curated") continue;
  const seen = new Set();
  const before = r.naverMenus.length;
  r.naverMenus = r.naverMenus.filter((m) => {
    const name = String(m.name ?? "");
    if (SEASONAL.test(name)) { removedSeasonal++; return false; }
    if (JUNK.test(name)) { removedJunk++; return false; }
    const key = name + "|" + (m.price ?? "");
    if (seen.has(key)) { removedDup++; return false; }
    seen.add(key);
    return true;
  });
  if (r.naverMenus.length !== before) {
    // 필터 후 3개 미만으로 쪼그라들면 원복하지 않고 그대로 둔다 (없는 게 낫다)
  }
}

// ── 3) 편의점/마트: 상품 목록 제거 ──
let convCleared = 0;
for (const r of d.restaurants) {
  if (/편의점|마트/.test(r.category ?? "") && Array.isArray(r.naverMenus) && r.naverMenus.length) {
    r.naverMenus = [];
    convCleared++;
  }
}

d.notes = d.notes ?? [];
d.notes.push(
  "2026-08-12 메뉴 큐레이션: 변동 잦은 프랜차이즈(맘스터치·버거킹·KFC·롯데리아·노브랜드버거·써브웨이·명랑핫도그)는 시그니처 메뉴명만 유지(menuSource=curated, 가격 미표기). 행사/한정/중복/비식품 항목 전 가게 필터. 편의점은 상품 목록 대신 간편식 안내.",
);

writeFileSync(DATA, JSON.stringify(d, null, 2) + "\n", "utf8");
console.log("");
console.log("큐레이션 교체:", curated + "곳");
console.log("행사/한정 제거:", removedSeasonal + "개 · 비식품:", removedJunk + "개 · 중복:", removedDup + "개");
console.log("편의점 상품목록 비움:", convCleared + "곳");
