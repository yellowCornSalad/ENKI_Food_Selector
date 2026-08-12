const MEAL_WINDOWS = {
  lunch: { start: "11:00", end: "14:00" },
  dinner: { start: "17:00", end: "20:00" },
};

const MEAL_BUDGETS = {
  lunch: 12000,
  dinner: 12000,
};

// New random seed every page load — keeps recommendations stable WITHIN a
// session (so expanding/collapsing cards doesn't reshuffle the list) but
// shuffles them between sessions / reloads so the same restaurant doesn't
// always sit at the top.
const SESSION_SEED = `${Date.now().toString(36)}|${Math.random().toString(36).slice(2, 10)}`;

export function getCurrentMeal(now) {
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes >= toMinutes(MEAL_WINDOWS.dinner.start)) return "dinner";
  return "lunch";
}

export function recommendMeals(restaurants, options = {}) {
  const meal = options.meal ?? getCurrentMeal(options.now ?? new Date());
  const preferences = new Set(options.preferences ?? []);
  const pickIndex = Number.isFinite(options.pickIndex) ? options.pickIndex : 0;

  const ranked = restaurants
    .filter((restaurant) => isEligible(restaurant, meal))
    .map((restaurant) => ({
      ...restaurant,
      score: scoreRestaurant(restaurant, meal, preferences),
      reason: buildReason(restaurant, meal, preferences),
    }))
    .sort((a, b) => b.score - a.score);

  return rotateTopChoices(ranked, pickIndex)
    .map((restaurant) => ({
      ...restaurant,
      menu: pickMenu(restaurant, meal, preferences, pickIndex),
    }));
}

export function findRestaurantsByMenu(menuLabel, restaurants) {
  const term = String(menuLabel ?? "").trim().toLowerCase();
  if (!term) return [];
  const matched = [];
  for (const restaurant of restaurants) {
    const allMenus = [
      ...(restaurant.menus?.lunch ?? []),
      ...(restaurant.menus?.dinner ?? []),
      ...(restaurant.naverMenus ?? []),
    ];
    const menuHit = allMenus.some((menu) => String(menu?.name ?? "").toLowerCase().includes(term));
    const categoryHit = String(restaurant.category ?? "").toLowerCase().includes(term);
    const nameHit = String(restaurant.name ?? "").toLowerCase().includes(term);
    if (menuHit || categoryHit || nameHit) {
      matched.push(restaurant);
    }
  }
  return matched.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (a.distanceM ?? 0) - (b.distanceM ?? 0));
}

export function summarizeDataHealth(restaurants) {
  return restaurants.reduce(
    (acc, restaurant) => {
      if (restaurant.sikgwonStatus === "confirmed") acc.confirmed += 1;
      else acc.needsVerification += 1;
      return acc;
    },
    { confirmed: 0, needsVerification: 0 },
  );
}

function isEligible(restaurant, meal) {
  if (restaurant.active === false) return false;
  if (restaurant.meals && !restaurant.meals.includes(meal)) return false;
  if (restaurant.sikgwonStatus === "excluded") return false;
  return isOpenForMeal(restaurant, meal);
}

function isOpenForMeal(restaurant, meal) {
  if (!restaurant.hours) return true;
  const window = MEAL_WINDOWS[meal];
  return restaurant.hours.some((row) => {
    if (!row.days?.includes("weekday")) return false;
    if (row.closed) return false;
    if (row.breakStart && overlaps(window.start, window.end, row.breakStart, row.breakEnd)) return false;
    return contains(row.open, row.close, window.start) || contains(row.open, row.close, window.end);
  });
}

function scoreRestaurant(restaurant, meal, preferences) {
  let score = 0;
  if (restaurant.sikgwonStatus === "confirmed") score += 80;
  if (restaurant.sikgwonStatus === "candidate") score += 35;
  // 편의점/마트는 '오늘 뭐 먹지' 추천 대상이 아니다 — 리스트에는 남기되
  // 항상 맨 아래로 가라앉혀 히어로 추천/게임 후보에 절대 오르지 않게 한다.
  // (confirmed +80 과 노이즈 +35 를 합쳐도 못 넘는 크기의 페널티)
  if (/편의점|마트/.test(restaurant.category ?? "")) score -= 200;
  if (restaurant.hoursConfidence === "high") score += 14;
  if (restaurant.meals?.includes(meal)) score += 12;
  score += Math.max(0, 25 - restaurant.distanceM / 25);
  for (const tag of effectiveTags(restaurant)) {
    if (preferences.has(tag)) score += 18;
  }
  if (preferences.has("team") && restaurant.teamFriendly) score += 12;
  if (preferences.has("quick") && restaurant.quick) score += 12;
  // Session-randomized noise — was deterministicNoise(restaurant.id, 9) which
  // produced the same score every load, so the same restaurant always topped
  // the list (e.g. 조조감자탕). Mixing in SESSION_SEED gives each page load a
  // different shuffle of the top picks while still ranking confirmed-가맹점
  // ahead of unconfirmed (40-pt difference dominates the 35-pt noise band).
  score += deterministicNoise(`${restaurant.id}|${SESSION_SEED}`, 35);
  return score;
}

function effectiveTags(restaurant) {
  const tags = new Set(restaurant.tags ?? []);
  const cat = restaurant.category ?? "";
  if (/한식|분식|면\/국수/.test(cat)) tags.add("korean");
  if (/중식/.test(cat)) tags.add("chinese");
  if (/일식/.test(cat)) tags.add("japanese");
  if (/양식|샌드위치|버거|패스트푸드/.test(cat)) tags.add("western");
  if (/샐러드|건강식/.test(cat)) tags.add("diet");
  if (/카페|베이커리/.test(cat)) tags.add("drink");
  return tags;
}

// 원본 DB가 "메뉴 정보 없으면 임시로 업체명을 메뉴로 넣음"으로 시드된 곳이 많다.
// (예: 메뉴명이 "[가든파이브] 호두앤(현대아울렛)") 이런 placeholder 가 추천 카드
// 제목에 식당 이름처럼 떠서 어색하므로 걸러낸다. 이름이 바뀐 가게는 placeholder 에
// 옛 이름이 남아있어 이름 매칭만으론 못 잡으니, 가격이 없고 지점/위치 표기가 든
// '메뉴'도 placeholder 로 본다.
function hasPriceToken(name) {
  return /(\d{1,3}(?:,\d{3})+|\d{3,})\s*원/.test(String(name ?? ""));
}
function looksLikeBranchName(name) {
  return /\[가든파이브\]|\(현대아울렛\)|현대아울렛|법조타운점|파크하비오점|문정\S*점|역점\)?$/.test(String(name ?? ""));
}
function isPlaceholderMenu(menuName, restaurantName) {
  // 가격이 붙어 있으면 무조건 진짜 메뉴다. ("조조감자탕 小 36,000원" 처럼 업체명으로
  // 시작하는 진짜 메뉴를 placeholder 로 오판하지 않도록 가장 먼저 차단.)
  if (hasPriceToken(menuName)) return false;
  const mn = String(menuName ?? "").replace(/\s+/g, "");
  const rn = String(restaurantName ?? "").replace(/\s+/g, "");
  if (!mn) return true;
  if (mn === rn) return true;
  if (rn.length >= 3 && (mn.includes(rn) || rn.includes(mn))) return true;
  // 지점/위치 표기가 들어간 무가격 '메뉴' = 업체명 placeholder
  if (looksLikeBranchName(menuName)) return true;
  // 이름이 바뀐 가게는 placeholder 에 '옛 이름'이 남는다 (잇소니본점 vs 잇쇼니본점 = 0.5).
  // 정확 일치는 못 잡으니 bigram 유사도로 판단 — 무가격 + 상호와 절반 이상 겹치면 placeholder.
  if (rn.length >= 3 && bigramSimilarity(mn, rn) >= 0.5) return true;
  return false;
}
function bigramSimilarity(a, b) {
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s) => {
    const out = [];
    for (let i = 0; i < s.length - 1; i += 1) out.push(s.slice(i, i + 2));
    return out;
  };
  const ga = grams(a);
  const setB = new Set(grams(b));
  let hit = 0;
  for (const g of ga) if (setB.has(g)) hit += 1;
  return (2 * hit) / (ga.length + grams(b).length);
}
function realMenus(list, restaurantName) {
  return (list ?? []).filter((m) => m?.name && !isPlaceholderMenu(m.name, restaurantName));
}

function pickMenu(restaurant, meal, preferences, seed) {
  // 식권대장 정적 메뉴(placeholder 제외) → 없으면 네이버 메뉴로 대체
  let pool = realMenus(restaurant.menus?.[meal] ?? restaurant.menus?.all ?? [], restaurant.name);
  if (!pool.length) pool = realMenus(restaurant.naverMenus ?? [], restaurant.name);
  if (!pool.length) return "메뉴 정보 없음";
  const tagged = pool.filter((menu) => menu.tags?.some((tag) => preferences.has(tag)));
  if (tagged.length) pool = tagged;
  // 4,500원 미만은 사리·사이드·음료대 — 제대로 된 식사 메뉴가 따로 있으면
  // 대표 자리(카드 제목)에서 제외한다. ("볶음밥 3,000원"이 감자탕집 대표로 뜨는 문제)
  const mains = pool.filter((menu) => {
    const p = extractPrice(menu.name);
    return p == null || p >= 4500;
  });
  if (mains.length) pool = mains;
  const budget = MEAL_BUDGETS[meal] ?? 12000;
  const ranked = [...pool].sort((a, b) => priceDistance(a.name, budget) - priceDistance(b.name, budget));
  const topSize = Math.min(3, ranked.length);
  const index = deterministicNoise(`${restaurant.id}-${meal}-${seed}`, topSize);
  return ranked[index]?.name ?? ranked[0]?.name ?? pool[0].name;
}

function priceDistance(name, budget) {
  const price = extractPrice(name);
  if (price == null) return Number.POSITIVE_INFINITY;
  return Math.abs(price - budget);
}

function extractPrice(name) {
  const match = String(name ?? "").match(/(\d{1,3}(?:,\d{3})+|\d{4,})\s*원/);
  if (!match) return null;
  return Number(match[1].replace(/,/g, ""));
}

function rotateTopChoices(ranked, pickIndex) {
  if (ranked.length <= 1) return ranked;
  // Bigger rotation pool (was 7) so '한 번 더' has more variety.
  const topSize = Math.min(12, ranked.length);
  const top = ranked.slice(0, topSize);
  const rest = ranked.slice(topSize);
  const offset = Math.abs(pickIndex) % top.length;
  return [top[offset], ...top.slice(0, offset), ...top.slice(offset + 1), ...rest];
}

function buildReason(restaurant, meal, preferences) {
  const parts = [];
  if (restaurant.sikgwonStatus === "confirmed") parts.push("식권대장 가맹 확인");
  else parts.push("가맹 여부 확인 필요");
  if (restaurant.hoursConfidence === "high") parts.push("식사 시간 영업 정보 있음");
  if (restaurant.distanceM <= 250) parts.push("사무실에서 가까움");
  const matched = (restaurant.tags ?? []).filter((tag) => preferences.has(tag));
  if (matched.length) parts.push("취향 필터와 맞음");
  return parts.join(" · ");
}

function toMinutes(value) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function contains(open, close, target) {
  return toMinutes(open) <= toMinutes(target) && toMinutes(target) <= toMinutes(close);
}

function overlaps(startA, endA, startB, endB) {
  if (!startB || !endB) return false;
  return toMinutes(startA) < toMinutes(endB) && toMinutes(startB) < toMinutes(endA);
}

function deterministicNoise(input, max) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return max ? hash % max : 0;
}
