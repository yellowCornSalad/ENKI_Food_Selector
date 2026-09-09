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
  const recentIds = new Set((options.recentIds ?? []).map(String));
  const excludedIds = new Set((options.excludedIds ?? []).map(String));
  // 검색 중일 때만 편의점을 후보에 넣는다 ("세븐일레븐" 검색은 되어야 하니까).
  const includeConvenience = options.includeConvenience === true;

  const ranked = restaurants
    .filter((restaurant) => isEligible(restaurant, meal, includeConvenience))
    .filter((restaurant) => !excludedIds.has(String(restaurant.id)))
    .map((restaurant) => ({
      ...restaurant,
      score: scoreRestaurant(restaurant, meal, preferences),
      reason: buildReason(restaurant, meal, preferences),
    }))
    .sort((a, b) => b.score - a.score);

  return promoteFreshChoice(ranked, pickIndex, recentIds)
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

// 편의점·마트는 '점심 뭐 먹지'의 답이 아니다. 도시락을 팔긴 하지만 메뉴 추천
// 목록에 세븐일레븐이 섞여 있으면 고르는 데 방해만 된다. 다만 검색으로는 찾을 수
// 있어야 하므로 includeConvenience 로 열어둔다.
function isConvenienceStore(restaurant) {
  return /편의점|마트/.test(restaurant.category ?? "");
}

function isEligible(restaurant, meal, includeConvenience) {
  if (restaurant.active === false) return false;
  if (restaurant.meals && !restaurant.meals.includes(meal)) return false;
  if (restaurant.sikgwonStatus === "excluded") return false;
  if (!includeConvenience && isConvenienceStore(restaurant)) return false;
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
  // 카페·베이커리·디저트도 '점심 뭐 먹지'의 답은 아니다. 다만 편의점과 달리
  // 토스트·샌드위치로 끼니가 되기도 하므로, 히어로로는 안 오르되 리스트에는
  // 남을 만큼만 낮춘다. '커피/음료' 취향을 켜면 페널티를 면제한다.
  if (/카페|베이커리|디저트/.test(restaurant.category ?? "") && !preferences.has("drink")) {
    score -= 60;
  }
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

// "돈," "김,볶,치" 처럼 가게 내부 축약으로 적힌 메뉴명인지.
// 가격 표기를 뗀 본문이 아주 짧거나, 쉼표로 이어붙인 한두 글자 토막이면 축약으로 본다.
function isAbbreviatedMenu(name) {
  const body = String(name ?? "").replace(/\s*[\d,]+\s*원.*$/, "").trim();
  if (!body) return true;
  if (body.includes(",")) {
    return body.split(",").every((part) => part.trim().length <= 2);
  }
  return body.length <= 2;
}

// 대표 메뉴의 가격(원). 알 수 없으면 null.
export function menuPrice(menuName) {
  return extractPrice(menuName);
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
  // 가게가 메뉴판에 쓰는 축약 표기("돈,", "김,볶,치")는 카드 제목으로 걸면
  // 무슨 음식인지 알 수 없다. 읽을 수 있는 이름이 하나라도 있으면 그쪽을 쓴다.
  const readable = pool.filter((menu) => !isAbbreviatedMenu(menu.name));
  if (readable.length) pool = readable;
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

// '한 번 더'를 눌러도 같은 12곳만 돌던 문제를 고친 대표 선정 로직.
//
// 예전엔 상위 12곳을 pickIndex 로 회전시켜서, 13번째 누르면 1번과 완전히 같은
// 결과가 나왔다(192곳 중 180곳은 영영 안 나옴). 점수 1~12위 차이가 6점도 안 되는데
// 12위에서 칼같이 자른 것이 원인.
//
// 이제는 (1) 1위와 점수차가 크지 않은 곳을 모두 후보로 열어두고
// (2) 점수가 높을수록 더 자주 뽑히는 가중 랜덤으로 대표를 정하며
// (3) 최근에 보여준 곳은 후보에서 뺀다. 좋은 집이 여전히 자주 나오되 매번 새롭다.
const SCORE_WINDOW = 18; // 1위와 이 점수 차 이내면 '비슷하게 좋은 집'으로 본다
const MIN_POOL = 15;

function promoteFreshChoice(ranked, pickIndex, recentIds) {
  if (ranked.length <= 1) return ranked;

  const best = ranked[0].score;
  let pool = ranked.filter((r) => best - r.score <= SCORE_WINDOW);
  if (pool.length < MIN_POOL) pool = ranked.slice(0, Math.min(MIN_POOL, ranked.length));

  // 최근 본 곳 제외. 다 걸러지면(후보가 적을 때) 제외를 포기하고 전체를 쓴다.
  const fresh = pool.filter((r) => !recentIds.has(String(r.id)));
  const candidates = fresh.length ? fresh : pool;

  // 점수를 가중치로: 풀 최저점을 기준선으로 잡아 상대 우위를 반영한다.
  const floor = candidates[candidates.length - 1].score - 1;
  const weights = candidates.map((r) => Math.max(0.1, r.score - floor));
  const total = weights.reduce((s, w) => s + w, 0);

  // pickIndex 를 섞어 '한 번 더' 마다 다른 난수를 쓴다.
  let dart = randomFor(pickIndex) * total;
  let chosen = candidates[candidates.length - 1];
  for (let i = 0; i < candidates.length; i += 1) {
    dart -= weights[i];
    if (dart <= 0) { chosen = candidates[i]; break; }
  }

  return [chosen, ...ranked.filter((r) => r !== chosen)];
}

function randomFor(pickIndex) {
  // 세션 시드 + pickIndex 를 섞은 해시. 같은 렌더 안에서는 안정적이고
  // (스크롤·펼치기로 결과가 안 바뀜) '한 번 더' 를 누르면 새 값이 나온다.
  const h = hashString(`${SESSION_SEED}|pick|${pickIndex}`);
  return (h % 100000) / 100000;
}

function hashString(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
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
