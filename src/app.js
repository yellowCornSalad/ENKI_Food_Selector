import { getCurrentMeal, recommendMeals, summarizeDataHealth } from "./recommender.js?v=20260522-8";

const state = {
  meal: getCurrentMeal(new Date()),
  preferences: new Set(),
  restaurants: [],
  pickIndex: 0,
  hasPicked: false,
  mode: "quick",
  lastRecommendations: [],
  ladderSelections: new Set(),
  ladderWarning: false,
  gameSeed: 0,
  gamePhase: "setup",
  selectedStartLane: null,
  resultTimer: null,
};

const preferenceOptions = [
  { id: "korean", label: "한식" },
  { id: "light", label: "가볍게" },
  { id: "diet", label: "다이어트" },
  { id: "spicy", label: "매콤" },
  { id: "rice", label: "밥" },
  { id: "noodle", label: "면" },
  { id: "team", label: "팀 식사" },
  { id: "quick", label: "빠르게" },
];

const $ = (selector) => document.querySelector(selector);

function syncMealButtons() {
  $("#lunchButton").classList.toggle("is-active", state.meal === "lunch");
  $("#dinnerButton").classList.toggle("is-active", state.meal === "dinner");
}

function syncModeButtons() {
  for (const button of document.querySelectorAll(".mode-button")) {
    button.classList.toggle("is-active", button.dataset.mode === state.mode);
  }
}

async function loadRestaurants() {
  const response = await fetch("./data/restaurants.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("restaurant-data-load-failed");
  }
  const payload = await response.json();
  state.restaurants = payload.restaurants ?? [];
  render();
}

function setMeal(meal) {
  state.meal = meal;
  state.pickIndex = 0;
  state.hasPicked = false;
  state.ladderSelections.clear();
  state.ladderWarning = false;
  resetGameProgress();
  render();
}

function togglePreference(id) {
  if (state.preferences.has(id)) {
    state.preferences.delete(id);
  } else {
    state.preferences.add(id);
  }
  state.pickIndex = 0;
  state.hasPicked = false;
  state.ladderSelections.clear();
  state.ladderWarning = false;
  resetGameProgress();
  render();
}

function chooseMeal() {
  if (state.gamePhase === "running") return;
  if (needsManualChoices(state.mode) && state.ladderSelections.size < 2) {
    state.hasPicked = false;
    state.ladderWarning = true;
    render();
    return;
  }
  if (!needsManualChoices(state.mode)) {
    state.pickIndex += 1;
    state.gameSeed += 1;
    state.gamePhase = "done";
    state.hasPicked = true;
    render();
    return;
  }
  state.gameSeed += 1;
  state.ladderWarning = false;
  state.selectedStartLane = null;
  if (state.mode === "ladder") {
    state.gamePhase = "ready";
    state.hasPicked = false;
    render();
    return;
  }
  state.gamePhase = "running";
  state.hasPicked = false;
  render();
  scheduleResultReveal(5000);
}

function setMode(mode) {
  state.mode = mode;
  state.hasPicked = false;
  state.ladderWarning = false;
  resetGameProgress();
  render();
}

function toggleLadderSelection(id) {
  if (state.ladderSelections.has(id)) {
    state.ladderSelections.delete(id);
  } else if (state.ladderSelections.size < gameChoiceLimit()) {
    state.ladderSelections.add(id);
  }
  state.hasPicked = false;
  state.ladderWarning = false;
  resetGameProgress();
  render();
}

function resetGameProgress() {
  if (state.resultTimer) {
    clearTimeout(state.resultTimer);
  }
  state.resultTimer = null;
  state.gamePhase = "setup";
  state.selectedStartLane = null;
}

function scheduleResultReveal(ms) {
  if (state.resultTimer) clearTimeout(state.resultTimer);
  state.resultTimer = setTimeout(() => {
    state.gamePhase = "done";
    state.hasPicked = true;
    state.resultTimer = null;
    render();
  }, ms);
}

function startLadder(lane) {
  state.selectedStartLane = lane;
  state.gamePhase = "running";
  state.hasPicked = false;
  render();
  scheduleResultReveal(3000);
}

function renderPreferenceChips() {
  const container = $("#preferenceChips");
  container.innerHTML = "";
  for (const option of preferenceOptions) {
    const button = document.createElement("button");
    button.className = `chip ${state.preferences.has(option.id) ? "is-selected" : ""}`;
    button.type = "button";
    button.textContent = option.label;
    button.addEventListener("click", () => togglePreference(option.id));
    container.append(button);
  }
}

function renderStatus(recommendations) {
  const health = summarizeDataHealth(state.restaurants);
  const mealLabel = state.meal === "lunch" ? "점심" : "저녁";
  const reliableCount = recommendations.filter((item) => item.sikgwonStatus === "confirmed").length;
  $("#statusStrip").innerHTML = `
    <strong>${mealLabel} 추천</strong>
    <span>${health.confirmed}곳 가맹 확인, ${health.needsVerification}곳 확인 필요</span>
    <span>${reliableCount ? "확인 가맹점 우선" : "후보 데이터 기반"}</span>
  `;
}

function renderTopPick(item) {
  const target = $("#topPick");
  if (!state.hasPicked || (needsManualChoices(state.mode) && state.gamePhase !== "done")) {
    target.classList.add("is-idle");
    const message = pendingHeroMessage();
    target.innerHTML = `
      <div class="pick-meta">
        <span>${state.meal === "lunch" ? "점심" : "저녁"} 준비</span>
        <span>${modeLabel(state.mode)}</span>
      </div>
      <h2>${message.title}</h2>
      <p class="restaurant-name">${message.name}</p>
      <p class="reason">${message.reason}</p>
      ${message.showButton ? `<button class="hero-cta" data-action="choose" type="button">메뉴 고르기</button>` : ""}
    `;
    return;
  }
  target.classList.remove("is-idle");
  if (!item) {
    target.innerHTML = `
      <p class="empty-title">추천할 수 있는 후보가 없어요</p>
      <p class="empty-copy">가맹 상태나 영업시간 데이터를 업데이트하면 다시 추천할 수 있습니다.</p>
    `;
    return;
  }
  const bestFor = item.bestFor ?? item.tags ?? [];
  const meta = [`${item.distanceM}m`, ratingText(item)].filter(Boolean);
  target.innerHTML = `
    <div class="pick-meta">
      ${meta.map((text) => `<span>${text}</span>`).join("")}
    </div>
    <h2>${item.menu}</h2>
    <p class="restaurant-name">${item.name}</p>
    <p class="reason">${item.reason}</p>
    ${renderSuggestionList(item)}
    <div class="detail-grid">
      <span>${categoryText(item)}</span>
      <span>${item.priceBand}</span>
      <span>${bestFor.slice(0, 3).join(" · ")}</span>
    </div>
  `;
}

function renderCandidate(item) {
  const article = document.createElement("article");
  article.className = "candidate-card";
  const rating = ratingText(item);
  article.innerHTML = `
    <div>
      <h3>${item.menu}</h3>
      <p>${item.name} · ${categoryText(item)}</p>
    </div>
    <div class="candidate-side">
      <span>${item.distanceM}m</span>
      <strong>${rating || "네이버 정보 없음"}</strong>
    </div>
  `;
  return article;
}

function ratingText(item) {
  if (typeof item.naverRating === "number") {
    return `네이버 ★ ${item.naverRating.toFixed(1)}`;
  }
  if (typeof item.naverVisitorReviewCount === "number") {
    return `네이버 리뷰 ${item.naverVisitorReviewCount.toLocaleString("ko-KR")}`;
  }
  if (typeof item.naverReviewCount === "number") {
    return `네이버 리뷰 ${item.naverReviewCount.toLocaleString("ko-KR")}`;
  }
  return "";
}

function categoryText(item) {
  if (!item.category || item.category === "식권대장 가맹점") return "음식점";
  return item.category;
}

function modeLabel(mode) {
  if (mode === "ladder") return "사다리";
  if (mode === "roulette") return "룰렛";
  return "바로 고르기";
}

function renderSuggestionList(item) {
  if (!item.suggestions?.length) return "";
  const rows = item.suggestions
    .slice(0, 4)
    .map((suggestion) => {
      const rating = ratingText(suggestion);
      return `<li><strong>${suggestion.name}</strong><span>${suggestion.distanceM}m${rating ? ` · ${rating}` : ""}</span></li>`;
    })
    .join("");
  return `<ul class="suggestion-list">${rows}</ul>`;
}

function renderGameStage(recommendations) {
  const stage = $("#gameStage");
  const items = gameItems(recommendations);
  if (state.mode === "ladder" && (state.gamePhase === "ready" || state.gamePhase === "running")) {
    stage.innerHTML = renderLadder(createLadderGame(items, state.gameSeed, state.selectedStartLane ?? 0));
    return;
  }
  if (state.mode === "roulette" && state.gamePhase === "running") {
    stage.innerHTML = renderRoulette(createRouletteGame(items, state.gameSeed));
    return;
  }
  if (!state.hasPicked) {
    if (needsManualChoices(state.mode)) {
      stage.innerHTML = renderChoiceSetup(recommendations);
      return;
    }
    stage.innerHTML = `<p>선택 방식을 고르고 하단 버튼을 눌러주세요.</p>`;
    return;
  }
  if (!items.length) {
    stage.innerHTML = `<p>표시할 후보가 없습니다.</p>`;
    return;
  }
  if (state.mode === "ladder") {
    stage.innerHTML = renderLadder(createLadderGame(items, state.gameSeed, state.selectedStartLane ?? 0));
    return;
  }
  if (state.mode === "roulette") {
    stage.innerHTML = renderRoulette(createRouletteGame(items, state.gameSeed));
    return;
  }
  stage.innerHTML = `<p><strong>${items[0].menu}</strong>로 바로 골랐습니다.</p>`;
}

function renderChoiceSetup(recommendations) {
  const options = gameOptions(recommendations).slice(0, 12);
  const selectedCount = state.ladderSelections.size;
  const gameName = state.mode === "roulette" ? "룰렛판" : "사다리";
  const warning = state.ladderWarning ? `<p class="ladder-warning">${gameName}에 올릴 메뉴를 2개 이상 골라주세요.</p>` : "";
  const buttons = options
    .map(
      (item) => `
        <button class="ladder-option ${state.ladderSelections.has(item.id) ? "is-selected" : ""}" data-ladder-id="${item.id}" type="button">
          <strong>${item.menu}</strong>
          <span>${item.restaurants.length}곳에서 가능</span>
        </button>
      `,
    )
    .join("");
  return `
    <div class="ladder-setup">
      <div class="ladder-setup-head">
        <strong>${gameName}에 올릴 메뉴 선택</strong>
        <span>${selectedCount}/${gameChoiceLimit()}개 선택</span>
      </div>
      <div class="ladder-options">${buttons}</div>
      ${warning}
    </div>
  `;
}

function pendingHeroMessage() {
  if (state.mode === "ladder") {
    if (state.gamePhase === "ready") {
      return {
        title: "번호를 고르세요",
        name: "1번부터 원하는 번호를 누르면 사다리가 내려갑니다.",
        reason: "결과는 사다리가 끝까지 내려간 뒤 공개됩니다.",
        showButton: false,
      };
    }
    if (state.gamePhase === "running") {
      return {
        title: "사다리 내려가는 중",
        name: "막대기가 길을 따라 내려가고 있어요.",
        reason: "3초 뒤 결과를 공개합니다.",
        showButton: false,
      };
    }
  }
  if (state.mode === "roulette" && state.gamePhase === "running") {
    return {
      title: "룰렛 도는 중",
      name: "포인터 앞을 촤르르 지나가는 중입니다.",
      reason: "5초 뒤 멈춘 칸을 공개합니다.",
      showButton: false,
    };
  }
  return {
    title: "뭐 고르세요?",
    name: "버튼을 누르면 메뉴를 하나 골라드릴게요.",
    reason: "취향 필터와 선택 방식을 먼저 고르면 더 그럴듯하게 골라집니다.",
    showButton: true,
  };
}

function gameItems(recommendations) {
  if (!needsManualChoices(state.mode)) return recommendations.slice(0, 5);
  const selected = gameOptions(recommendations).filter((item) => state.ladderSelections.has(item.id));
  return selected.slice(0, gameChoiceLimit());
}

function gameOptions(recommendations) {
  const groups = new Map();
  for (const item of recommendations) {
    const menu = foodMenuLabel(item);
    if (!menu) continue;
    const id = `food-${slugify(menu)}`;
    if (!groups.has(id)) {
      groups.set(id, {
        id,
        menu,
        restaurants: [],
        score: 0,
      });
    }
    const group = groups.get(id);
    group.restaurants.push(item);
    group.score = Math.max(group.score, item.score ?? 0);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      restaurants: group.restaurants.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
    }))
    .sort((a, b) => b.score - a.score || b.restaurants.length - a.restaurants.length);
}

function foodMenuLabel(item) {
  const rawMenu = cleanMenuName(item.menu);
  const corpus = `${rawMenu} ${item.category ?? ""} ${item.name ?? ""}`;
  if (isDrinkOnly(corpus)) return "";
  const rules = [
    [/샌드위치/i, "샌드위치"],
    [/햄버거|버거|burger/i, "햄버거"],
    [/감자탕/i, "감자탕"],
    [/해장국|뼈해장국/i, "해장국"],
    [/설렁탕/i, "설렁탕"],
    [/짬뽕|짬/i, "짬뽕"],
    [/부대찌개|부찌/i, "부대찌개"],
    [/순두부/i, "순두부"],
    [/수제비|라제비/i, "수제비"],
    [/돈까스|돈카츠|카츠/i, "돈까스"],
    [/초밥|스시/i, "초밥"],
    [/덮밥|가츠동|규동|오야코동/i, "덮밥"],
    [/국밥/i, "국밥"],
    [/김밥/i, "김밥"],
    [/떡볶이/i, "떡볶이"],
    [/라멘|라면/i, "라멘"],
    [/우동/i, "우동"],
    [/쌀국수/i, "쌀국수"],
    [/마라탕|마라샹궈/i, "마라탕"],
    [/파스타|스파게티/i, "파스타"],
    [/피자/i, "피자"],
    [/치킨|닭강정/i, "치킨"],
    [/샐러드|포케/i, "샐러드"],
    [/냉면/i, "냉면"],
    [/칼국수/i, "칼국수"],
    [/찌개|김치찌개|된장찌개|부대찌개/i, "찌개"],
    [/백반|정식/i, "백반"],
    [/삼겹살|냉삼|한돈|갈매기살|항정살|돼지갈비|고기/i, "고기"],
    [/샤브/i, "샤브샤브"],
  ];
  for (const [pattern, label] of rules) {
    if (pattern.test(corpus)) return label;
  }
  if (looksLikeStoreName(rawMenu, item)) return fallbackFoodCategory(item);
  if (!rawMenu || rawMenu === "추천 메뉴 확인 필요") return fallbackFoodCategory(item);
  return rawMenu.length > 12 ? `${rawMenu.slice(0, 12)}...` : rawMenu;
}

function fallbackFoodCategory(item) {
  const category = item.category || "";
  if (!category || category === "식권대장 가맹점") return "";
  return category.replace(/\/.*$/, "").trim();
}

function looksLikeStoreName(menu, item) {
  const normalizedMenu = normalizeText(menu);
  const normalizedName = normalizeText(item.name);
  return (
    !menu ||
    normalizedMenu === normalizedName ||
    normalizedMenu.includes("문정") ||
    normalizedMenu.includes("직영점") ||
    normalizedMenu.includes("역점") ||
    normalizedMenu.endsWith("점") ||
    /\(.+점\)/.test(menu)
  );
}

function isDrinkOnly(value) {
  const foodPattern = /샌드위치|버거|감자탕|해장국|순두부|수제비|돈까스|돈카츠|초밥|덮밥|국밥|김밥|떡볶이|라멘|라면|우동|쌀국수|마라|파스타|피자|치킨|샐러드|포케|냉면|칼국수|찌개|백반|정식|고기|삼겹살|갈비|샤브/;
  const drinkPattern = /커피|라떼|아메리카노|카페|에이드|티\b|스무디|주스/;
  return drinkPattern.test(value) && !foodPattern.test(value);
}

function cleanMenuName(value) {
  return String(value ?? "")
    .replace(/\d{1,3}(,\d{3})*원/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function slugify(value) {
  return String(value)
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w가-힣-]/g, "")
    .toLowerCase();
}

function gameChoiceLimit() {
  return state.mode === "roulette" ? 6 : 5;
}

function needsManualChoices(mode) {
  return mode === "ladder" || mode === "roulette";
}

function createLadderGame(items, seed, chosenStartLane) {
  const count = Math.min(items.length, 5);
  if (!count) return { items: [], rungs: [], startLane: 0, winnerIndex: 0, path: [] };
  const rowCount = 7;
  const startLane = Number.isInteger(chosenStartLane) ? Math.max(0, Math.min(chosenStartLane, count - 1)) : 0;
  const rungs = [];
  for (let row = 0; row < rowCount; row += 1) {
    const used = new Set();
    const rungCount = 1 + deterministicNoise(`rung-count-${seed}-${row}`, Math.max(1, count - 2));
    for (let step = 0; step < rungCount; step += 1) {
      const from = deterministicNoise(`rung-${seed}-${row}-${step}`, Math.max(1, count - 1));
      if (used.has(from) || used.has(from - 1) || used.has(from + 1)) continue;
      used.add(from);
      rungs.push({ row, from });
    }
  }
  const path = traceLadderPath(startLane, rungs, rowCount);
  return {
    items: items.slice(0, count),
    rungs,
    startLane,
    winnerIndex: path[path.length - 1].lane,
    path,
  };
}

function traceLadderPath(startLane, rungs, rowCount) {
  let lane = startLane;
  const path = [{ row: -1, lane }];
  for (let row = 0; row < rowCount; row += 1) {
    const rung = rungs.find((item) => item.row === row && (item.from === lane || item.from === lane - 1));
    if (rung) {
      lane = rung.from === lane ? lane + 1 : lane - 1;
    }
    path.push({ row, lane });
  }
  return path;
}

function renderLadder(game) {
  if (!game.items.length) return `<p>표시할 후보가 없습니다.</p>`;
  const width = 320;
  const height = 220;
  const top = 42;
  const bottom = 164;
  const left = 28;
  const gap = game.items.length > 1 ? 264 / (game.items.length - 1) : 0;
  const rowGap = (bottom - top) / (7 + 1);
  const xFor = (lane) => left + gap * lane;
  const yFor = (row) => top + rowGap * (row + 1);
  const activeRungs = new Set();
  const snakePoints = [{ x: xFor(game.startLane), y: top }];
  let activeLane = game.startLane;
  let cursorY = top;
  for (const point of game.path.slice(1)) {
    const rowY = yFor(point.row);
    snakePoints.push({ x: xFor(activeLane), y: rowY });
    if (point.lane !== activeLane) {
      const from = Math.min(activeLane, point.lane);
      activeRungs.add(`${point.row}-${from}`);
      snakePoints.push({ x: xFor(point.lane), y: rowY });
    }
    activeLane = point.lane;
    cursorY = rowY;
  }
  snakePoints.push({ x: xFor(activeLane), y: bottom });
  const verticals = game.items
    .map((_, index) => `<line class="ladder-line" x1="${xFor(index)}" y1="${top}" x2="${xFor(index)}" y2="${bottom}" />`)
    .join("");
  const rungs = game.rungs
    .map(({ row, from }) => {
      const active = activeRungs.has(`${row}-${from}`) ? " is-active" : "";
      return `<line class="ladder-rung${active}" x1="${xFor(from)}" y1="${yFor(row)}" x2="${xFor(from + 1)}" y2="${yFor(row)}" />`;
    })
    .join("");
  const pathData = snakePoints.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const path = `<path class="ladder-path" d="${pathData}" pathLength="100" />`;
  const showPath = state.gamePhase === "running" || state.gamePhase === "done";
  const revealResult = state.gamePhase === "done";
  const starts = game.items
    .map(
      (item, index) =>
        `<button class="ladder-number ${state.selectedStartLane === index ? "is-start" : ""}" data-ladder-start="${index}" style="left:${(xFor(index) / width) * 100}%" type="button">${index + 1}</button>`,
    )
    .join("");
  const results = game.items
    .map(
      (item, index) =>
        `<span class="ladder-result ${revealResult && index === game.winnerIndex ? "is-winner" : ""}" style="left:${(xFor(index) / width) * 100}%">${item.menu}</span>`,
    )
    .join("");
  return `
    <div class="ladder-game ${showPath ? "is-revealed" : "is-covered"} ${state.gamePhase === "running" ? "is-running" : ""} ${revealResult ? "is-done" : ""}">
      <div class="ladder-labels">${starts}</div>
      <div class="ladder-field">
        <svg class="ladder-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="사다리타기 결과">
          ${verticals}
          ${rungs}
          ${showPath ? path : ""}
        </svg>
        ${showPath ? "" : `<div class="ladder-cover">번호를 고르면 길이 나타납니다</div>`}
      </div>
      <div class="ladder-results">${results}</div>
      ${
        revealResult
          ? `<p class="game-result"><strong>${game.items[game.winnerIndex].menu}</strong> 당첨</p>`
          : `<p class="game-wait">${state.gamePhase === "running" ? "두근두근... 내려가는 중" : "위 번호 중 하나를 골라주세요"}</p>`
      }
    </div>
  `;
}

function createRouletteGame(items, seed) {
  const count = items.length;
  const winnerIndex = deterministicNoise(`roulette-${seed}-${items.map((item) => item.id).join("-")}`, count);
  return { items, winnerIndex };
}

function renderRoulette(game) {
  if (!game.items.length) return `<p>표시할 후보가 없습니다.</p>`;
  const revealResult = state.gamePhase === "done";
  const colors = ["#0f766e", "#f59e0b", "#2563eb", "#dc2626", "#7c3aed", "#059669"];
  const segment = 360 / game.items.length;
  const gradient = game.items
    .map((_, index) => `${colors[index % colors.length]} ${index * segment}deg ${(index + 1) * segment}deg`)
    .join(", ");
  const finalRotation = 1800 - (game.winnerIndex * segment + segment / 2);
  const labels = game.items
    .map((item, index) => {
      const angle = index * segment + segment / 2;
      return `<span class="roulette-label" style="--angle:${angle}deg">${item.menu}</span>`;
    })
    .join("");
  return `
    <div class="roulette-game ${state.gamePhase === "running" ? "is-running" : ""} ${revealResult ? "is-done" : ""}">
      <div class="roulette-pointer" aria-hidden="true"></div>
      <div class="roulette-wheel" style="--wheel:${gradient}; --spin:${finalRotation}deg">
        ${labels}
        <span class="roulette-center">GO</span>
      </div>
      ${
        revealResult
          ? `<div class="confetti" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div><p class="game-result"><strong>${game.items[game.winnerIndex].menu}</strong> 당첨</p>`
          : `<p class="game-wait">아직 몰라요... 거의 멈추는 중</p>`
      }
    </div>
  `;
}

function render() {
  syncMealButtons();
  syncModeButtons();
  renderPreferenceChips();
  const recommendations = recommendMeals(state.restaurants, {
    meal: state.meal,
    preferences: [...state.preferences],
    now: new Date(),
    pickIndex: state.pickIndex,
  });
  const selectedRecommendations = selectGameWinner(recommendations);
  state.lastRecommendations = selectedRecommendations;
  renderStatus(recommendations);
  renderTopPick(selectedRecommendations[0]);
  renderGameStage(recommendations);
  $("#candidateCount").textContent = `${recommendations.length}곳`;
  const list = $("#candidateList");
  list.innerHTML = "";
  for (const item of recommendations.slice(1)) {
    list.append(renderCandidate(item));
  }
}

function selectGameWinner(recommendations) {
  if (!state.hasPicked || state.gamePhase !== "done") return recommendations;
  let winner = null;
  if (state.mode === "ladder") {
    const game = createLadderGame(gameItems(recommendations), state.gameSeed, state.selectedStartLane ?? 0);
    winner = game.items[game.winnerIndex];
  }
  if (state.mode === "roulette") {
    const game = createRouletteGame(gameItems(recommendations), state.gameSeed);
    winner = game.items[game.winnerIndex];
  }
  if (!winner) return recommendations;
  if (winner.restaurants) {
    const result = buildFoodResult(winner);
    const winnerRestaurantIds = new Set(winner.restaurants.map((item) => item.id));
    return [result, ...recommendations.filter((item) => !winnerRestaurantIds.has(item.id))];
  }
  return [winner, ...recommendations.filter((item) => item.id !== winner.id)];
}

function buildFoodResult(group) {
  const suggestions = group.restaurants.slice(0, 4);
  const first = suggestions[0];
  const names = suggestions.map((item) => item.name);
  const nameText = names.length > 1 ? `${names.slice(0, 3).join(", ")}는 어떠신가요?` : `${first.name}은 어떠신가요?`;
  return {
    ...first,
    id: `result-${group.id}`,
    menu: group.menu,
    name: nameText,
    reason: `${group.menu} 파는 식권대장 가맹점 ${group.restaurants.length}곳 중 가까운 곳을 골랐습니다.`,
    suggestions,
  };
}

function deterministicNoise(input, max) {
  let hash = 0;
  for (let i = 0; i < String(input).length; i += 1) {
    hash = (hash * 31 + String(input).charCodeAt(i)) >>> 0;
  }
  return max ? hash % max : 0;
}

$("#lunchButton").addEventListener("click", () => setMeal("lunch"));
$("#dinnerButton").addEventListener("click", () => setMeal("dinner"));
$("#refreshButton").addEventListener("click", chooseMeal);
$("#chooseButton").addEventListener("click", chooseMeal);
$("#topPick").addEventListener("click", (event) => {
  if (event.target.closest("[data-action='choose']")) {
    chooseMeal();
  }
});
$("#gameStage").addEventListener("click", (event) => {
  const start = event.target.closest("[data-ladder-start]");
  if (start && state.mode === "ladder" && state.gamePhase === "ready") {
    startLadder(Number(start.dataset.ladderStart));
    return;
  }
  const button = event.target.closest("[data-ladder-id]");
  if (button) {
    toggleLadderSelection(button.dataset.ladderId);
  }
});
for (const button of document.querySelectorAll(".mode-button")) {
  button.addEventListener("click", () => setMode(button.dataset.mode));
}
$("#clearFiltersButton").addEventListener("click", () => {
  state.preferences.clear();
  state.pickIndex = 0;
  state.hasPicked = false;
  state.ladderSelections.clear();
  state.ladderWarning = false;
  resetGameProgress();
  render();
});

syncMealButtons();
syncModeButtons();
$("#statusStrip").textContent = "가맹점 데이터를 불러오는 중입니다.";
loadRestaurants().catch(() => {
  $("#statusStrip").textContent = "가맹점 데이터를 불러오지 못했습니다.";
});
