const MEAL_WINDOWS = {
  lunch: { start: "11:00", end: "14:00" },
  dinner: { start: "17:00", end: "20:00" },
};

export function getCurrentMeal(now) {
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes >= toMinutes(MEAL_WINDOWS.dinner.start)) return "dinner";
  return "lunch";
}

export function recommendMeals(restaurants, options = {}) {
  const meal = options.meal ?? getCurrentMeal(options.now ?? new Date());
  const preferences = new Set(options.preferences ?? []);
  const seed = options.seed ?? 0;

  return restaurants
    .filter((restaurant) => isEligible(restaurant, meal))
    .map((restaurant) => ({
      ...restaurant,
      score: scoreRestaurant(restaurant, meal, preferences, seed),
      reason: buildReason(restaurant, meal, preferences),
    }))
    .sort((a, b) => b.score - a.score)
    .map((restaurant) => ({
      ...restaurant,
      menu: pickMenu(restaurant, meal, preferences, seed),
    }));
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

function scoreRestaurant(restaurant, meal, preferences, seed) {
  let score = 0;
  if (restaurant.sikgwonStatus === "confirmed") score += 80;
  if (restaurant.sikgwonStatus === "candidate") score += 35;
  if (restaurant.hoursConfidence === "high") score += 14;
  if (restaurant.meals?.includes(meal)) score += 12;
  score += Math.max(0, 25 - restaurant.distanceM / 25);
  for (const tag of restaurant.tags ?? []) {
    if (preferences.has(tag)) score += 18;
  }
  if (preferences.has("team") && restaurant.teamFriendly) score += 12;
  if (preferences.has("quick") && restaurant.quick) score += 12;
  score += deterministicNoise(`${restaurant.id}-${seed}`, 9);
  return score;
}

function pickMenu(restaurant, meal, preferences, seed) {
  const menus = restaurant.menus?.[meal] ?? restaurant.menus?.all ?? [];
  if (!menus.length) return "추천 메뉴 확인 필요";
  const tagged = menus.filter((menu) => menu.tags?.some((tag) => preferences.has(tag)));
  const pool = tagged.length ? tagged : menus;
  const index = deterministicNoise(`${restaurant.id}-${meal}-${seed}`, pool.length);
  return pool[index]?.name ?? pool[0].name;
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
