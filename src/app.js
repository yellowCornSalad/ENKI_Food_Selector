import { findRestaurantsByMenu, getCurrentMeal, recommendMeals, summarizeDataHealth } from "./recommender.js?v=20260522-22";
import { startMarbleRace } from "./marble-race.js?v=20260522-22";

const state = {
  meal: getCurrentMeal(new Date()),
  preferences: new Set(),
  restaurants: [],
  pickIndex: 0,
  hasPicked: false,
  mode: "quick",
  lastRecommendations: [],
  userMenus: [],
  userMenuInput: "",
  ladderWarning: false,
  gameSeed: 0,
  gamePhase: "setup",
  selectedStartLane: null,
  resultTimer: null,
  expandedCandidates: new Set(),
  lastGameResult: null,
  marbleItems: null,
  marbleWinnerIndex: null,
  marbleCleanup: null,
  searchQuery: "",
};

const MAX_USER_MENUS = 8;
const MARBLE_COLORS = [
  "#dc2626",
  "#f59e0b",
  "#0ea5e9",
  "#a855f7",
  "#10b981",
  "#f43f5e",
  "#22d3ee",
  "#facc15",
];

const preferenceOptions = [
  { id: "korean", label: "한식" },
  { id: "chinese", label: "중식" },
  { id: "western", label: "양식" },
  { id: "japanese", label: "일식" },
  { id: "diet", label: "다이어트" },
  { id: "quick", label: "빠르게" },
  { id: "team", label: "팀 식사" },
  { id: "drink", label: "커피/음료" },
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
  state.ladderWarning = false;
  resetGameProgress();
  render();
}

function chooseMeal() {
  if (state.gamePhase === "running") return;
  if (needsManualChoices(state.mode) && state.userMenus.length < 2) {
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
  state.marbleWinnerIndex = null;
  if (state.mode === "ladder") {
    state.gamePhase = "ready";
    state.hasPicked = false;
    render();
    return;
  }
  if (state.mode === "marble") {
    state.gamePhase = "running";
    state.hasPicked = false;
    render();
    startMarbleGame();
    return;
  }
  state.gamePhase = "running";
  state.hasPicked = false;
  render();
  scheduleResultReveal(5000);
}

function startMarbleGame() {
  const stage = $("#gameStage");
  const items = buildWheelItems(userMenuItems(), state.gameSeed);
  state.marbleItems = items;
  state.marbleWinnerIndex = null;

  stage.innerHTML = `
    <div class="marble-game is-running" id="marbleStage">
      <canvas id="marbleCanvas"></canvas>
      <p class="game-wait">핀볼 떨어지는 중...</p>
    </div>
  `;
  const canvas = document.getElementById("marbleCanvas");
  const slotColors = items.map((item, i) => {
    if (item.type === "again") return "#94a3b8";
    if (item.type === "miss") return "#475569";
    return MARBLE_COLORS[i % MARBLE_COLORS.length];
  });

  if (state.marbleCleanup) state.marbleCleanup();
  state.marbleCleanup = startMarbleRace({
    canvas,
    items,
    slotColors,
    onFinish: (winnerIndex) => {
      state.marbleWinnerIndex = winnerIndex;
      state.gamePhase = "done";
      state.hasPicked = true;
      render();
    },
  });
}

function setMode(mode) {
  state.mode = mode;
  state.hasPicked = false;
  state.ladderWarning = false;
  resetGameProgress();
  render();
}

function addUserMenu(name) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return;
  if (state.userMenus.includes(trimmed)) {
    state.userMenuInput = "";
    syncUserMenuInputValue();
    focusUserMenuInput();
    return;
  }
  if (state.userMenus.length >= MAX_USER_MENUS) return;
  state.userMenus = [...state.userMenus, trimmed];
  state.userMenuInput = "";
  state.hasPicked = false;
  state.ladderWarning = false;
  resetGameProgress();
  render();
  focusUserMenuInput();
}

function removeUserMenu(name) {
  state.userMenus = state.userMenus.filter((m) => m !== name);
  state.hasPicked = false;
  resetGameProgress();
  render();
  focusUserMenuInput();
}

function syncUserMenuInputValue() {
  const el = document.getElementById("userMenuInput");
  if (el) el.value = state.userMenuInput;
}

function focusUserMenuInput() {
  const el = document.getElementById("userMenuInput");
  if (!el || el.disabled) return;
  el.focus({ preventScroll: true });
  // Move caret to end so further typing appends naturally
  const len = el.value.length;
  try { el.setSelectionRange(len, len); } catch {}
}

function resetGameProgress() {
  if (state.resultTimer) {
    clearTimeout(state.resultTimer);
  }
  state.resultTimer = null;
  state.gamePhase = "setup";
  state.selectedStartLane = null;
  if (state.marbleCleanup) {
    state.marbleCleanup();
    state.marbleCleanup = null;
  }
  state.marbleItems = null;
  state.marbleWinnerIndex = null;
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
  scheduleResultReveal(5000);
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
  const id = String(item.id ?? "");
  if (id === "result-miss" || id === "result-again" || id.startsWith("result-unmatched")) {
    const tone = id === "result-miss" ? "is-miss" : id === "result-again" ? "is-again" : "is-empty";
    target.classList.add(tone);
    target.innerHTML = `
      <div class="pick-meta">
        <span>${state.meal === "lunch" ? "점심" : "저녁"} 결과</span>
        <span>${escapeHtml(modeLabel(state.mode))}</span>
      </div>
      <h2>${escapeHtml(item.menu)}</h2>
      <p class="restaurant-name">${escapeHtml(item.name)}</p>
      <p class="reason">${escapeHtml(item.reason)}</p>
      <button class="hero-cta" data-action="choose" type="button">한 번 더 돌리기</button>
    `;
    return;
  }
  target.classList.remove("is-miss", "is-again", "is-empty");
  const bestFor = item.bestFor ?? item.tags ?? [];
  const meta = [`${item.distanceM}m`, ratingText(item)].filter(Boolean);
  target.innerHTML = `
    <div class="pick-meta">
      ${meta.map((text) => `<span>${text}</span>`).join("")}
    </div>
    <h2>${escapeHtml(item.menu)}</h2>
    <p class="restaurant-name">${escapeHtml(item.name)}</p>
    <p class="reason">${escapeHtml(item.reason)}</p>
    ${renderSuggestionList(item)}
    <div class="detail-grid">
      <span>${escapeHtml(categoryText(item))}</span>
      <span>${escapeHtml(item.priceBand ?? "")}</span>
      <span>${escapeHtml(bestFor.slice(0, 3).join(" · "))}</span>
    </div>
  `;
}

function renderCandidate(item) {
  const article = document.createElement("article");
  const expanded = state.expandedCandidates.has(item.id);
  article.className = `candidate-card ${expanded ? "is-expanded" : ""}`;
  article.dataset.candidateId = item.id;
  article.setAttribute("aria-expanded", expanded ? "true" : "false");
  const rating = ratingText(item);
  const chevron = `<span class="candidate-chevron" aria-hidden="true">▾</span>`;
  article.innerHTML = `
    <div class="candidate-head">
      <div>
        <h3>${item.menu}</h3>
        <p>${item.name} · ${categoryText(item)}</p>
      </div>
      <div class="candidate-side">
        <span>${item.distanceM}m</span>
        <strong>${rating || "네이버 정보 없음"}</strong>
        ${chevron}
      </div>
    </div>
    ${renderCandidateDetail(item, expanded)}
  `;
  return article;
}

function renderCandidateDetail(item, expanded) {
  if (!expanded) return "";
  const menus = item.naverMenus ?? [];
  const mapUrl = naverMapSearchUrl(item.name);
  const mapButton = `<a class="candidate-map" href="${escapeHtml(mapUrl)}" target="_blank" rel="noopener">🗺️ 네이버 지도에서 검색</a>`;
  const link = item.naverPlaceUrl
    ? `<a class="candidate-link" href="${escapeHtml(item.naverPlaceUrl)}" target="_blank" rel="noopener">네이버 플레이스에서 더 보기 →</a>`
    : "";
  if (!menus.length) {
    return `
      <div class="candidate-detail">
        <p class="candidate-empty">네이버 메뉴 정보가 아직 없어요.</p>
        ${mapButton}
        ${link}
      </div>
    `;
  }
  const rows = menus
    .map((menu) => {
      const overBudget = typeof menu.price === "number" && menu.price > 12000;
      const priceClass = overBudget ? "menu-price is-over" : "menu-price";
      const price = menu.priceText ? `<span class="${priceClass}">${escapeHtml(menu.priceText)}</span>` : "";
      const desc = menu.description ? `<p class="menu-desc">${escapeHtml(menu.description)}</p>` : "";
      return `
        <li>
          <div class="menu-row">
            <strong>${escapeHtml(menu.name)}</strong>
            ${price}
          </div>
          ${desc}
        </li>
      `;
    })
    .join("");
  return `
    <div class="candidate-detail">
      <ul class="menu-list">${rows}</ul>
      ${mapButton}
      ${link}
    </div>
  `;
}

function naverMapSearchUrl(name) {
  const cleaned = String(name ?? "")
    .replace(/[\[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `https://map.naver.com/p/search/${encodeURIComponent(cleaned)}`;
}

function toggleCandidate(id) {
  if (state.expandedCandidates.has(id)) {
    state.expandedCandidates.delete(id);
  } else {
    state.expandedCandidates.add(id);
  }
  render();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
  if (mode === "marble") return "핀볼";
  return "바로 고르기";
}

function renderSuggestionList(item) {
  if (!item.suggestions?.length) return "";
  const rows = item.suggestions
    .slice(0, 4)
    .map((suggestion) => {
      const rating = ratingText(suggestion);
      const url = naverMapSearchUrl(suggestion.name);
      const meta = `${suggestion.distanceM}m${rating ? ` · ${rating}` : ""}`;
      return `<li><a href="${escapeHtml(url)}" target="_blank" rel="noopener"><strong>${escapeHtml(suggestion.name)}</strong><span>${escapeHtml(meta)}</span></a></li>`;
    })
    .join("");
  return `<ul class="suggestion-list">${rows}</ul>`;
}

function renderGameStage() {
  const stage = $("#gameStage");
  const items = userMenuItems();
  if (state.mode === "ladder" && (state.gamePhase === "ready" || state.gamePhase === "running" || (state.gamePhase === "done" && state.hasPicked))) {
    stage.innerHTML = renderLadder(createLadderGame(items, state.gameSeed, state.selectedStartLane ?? 0));
    return;
  }
  if (state.mode === "roulette" && (state.gamePhase === "running" || (state.gamePhase === "done" && state.hasPicked))) {
    stage.innerHTML = renderRoulette(createRouletteGame(items, state.gameSeed));
    return;
  }
  if (state.mode === "marble" && (state.gamePhase === "running" || (state.gamePhase === "done" && state.hasPicked))) {
    updateMarbleStage();
    return;
  }
  if (needsManualChoices(state.mode)) {
    stage.innerHTML = renderUserMenuInput();
    return;
  }
  stage.innerHTML = `<p>하단 "메뉴 고르기" 버튼을 누르면 자동 추천을 받습니다.</p>`;
}

function updateMarbleStage() {
  const stage = $("#gameStage");
  let game = stage.querySelector(".marble-game");
  if (!game) {
    // canvas not mounted yet; keep current contents (startMarbleGame will mount)
    return;
  }
  if (state.gamePhase === "done" && state.marbleItems && state.marbleWinnerIndex != null) {
    game.classList.remove("is-running");
    game.classList.add("is-done");
    const wait = game.querySelector(".game-wait");
    if (wait) wait.remove();
    if (!game.querySelector(".game-result")) {
      const winner = state.marbleItems[state.marbleWinnerIndex];
      game.insertAdjacentHTML("beforeend", renderWheelResult(winner));
    }
  }
}

function userMenuItems() {
  return state.userMenus.map((label, i) => ({ id: `menu-${i}`, label, type: "menu" }));
}

function renderUserMenuInput() {
  const chips = state.userMenus
    .map(
      (menu) =>
        `<span class="user-menu-chip"><span>${escapeHtml(menu)}</span><button type="button" class="user-menu-remove" data-remove-menu="${escapeHtml(menu)}" aria-label="${escapeHtml(menu)} 삭제">×</button></span>`,
    )
    .join("");
  const count = state.userMenus.length;
  const atLimit = count >= MAX_USER_MENUS;
  const placeholder = atLimit ? "더 추가할 수 없습니다" : "메뉴 입력 후 + 또는 Enter";
  const warning = state.ladderWarning ? `<p class="ladder-warning">${modeLabel(state.mode)}에 올릴 메뉴를 2개 이상 입력해주세요.</p>` : "";
  const placeholderHint = count === 0 ? `<span class="user-menu-empty">예) 짜장면, 햄버거, 돈까스 등 직접 입력</span>` : "";
  return `
    <div class="user-menu-setup">
      <div class="user-menu-head">
        <strong>${modeLabel(state.mode)}에 올릴 메뉴 입력</strong>
        <span>${count}/${MAX_USER_MENUS}개</span>
      </div>
      <div class="user-menu-form">
        <input type="text" id="userMenuInput" placeholder="${placeholder}" value="${escapeHtml(state.userMenuInput)}" ${atLimit ? "disabled" : ""} maxlength="14" autocomplete="off" />
        <button type="button" id="addMenuButton" ${atLimit ? "disabled" : ""}>추가</button>
      </div>
      <div class="user-menu-chips">${chips}${placeholderHint}</div>
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
        reason: "5초 뒤 결과를 공개합니다.",
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
  if (state.mode === "marble" && state.gamePhase === "running") {
    return {
      title: "핀볼 떨어지는 중",
      name: "공들이 페그를 부딪히며 내려가고 있어요.",
      reason: "가장 먼저 바닥에 닿는 공이 당첨입니다.",
      showButton: false,
    };
  }
  if (needsManualChoices(state.mode) && !state.userMenus.length) {
    return {
      title: "메뉴를 입력해주세요",
      name: `${modeLabel(state.mode)}에 올릴 메뉴를 직접 적어주세요.`,
      reason: "예) 짜장면, 햄버거, 돈까스처럼 2개 이상이면 출발 가능합니다.",
      showButton: false,
    };
  }
  if (needsManualChoices(state.mode) && state.userMenus.length < 2) {
    return {
      title: "한 개 더!",
      name: "최소 2개의 메뉴가 필요합니다.",
      reason: "하단 입력칸에 메뉴를 추가해주세요.",
      showButton: false,
    };
  }
  if (needsManualChoices(state.mode)) {
    return {
      title: `${modeLabel(state.mode)} 준비 완료`,
      name: `${state.userMenus.length}개의 메뉴로 게임을 시작합니다.`,
      reason: "하단 버튼을 누르면 게임이 시작됩니다.",
      showButton: true,
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
    [/햄버거|버거|burger/i, "햄버거"],
    [/샌드위치|서브웨이|써브웨이/i, "샌드위치"],
    [/베이글/i, "베이글"],
    [/감자탕/i, "감자탕"],
    [/뼈해장국|해장국/i, "해장국"],
    [/설렁탕/i, "설렁탕"],
    [/육개장/i, "육개장"],
    [/삼계탕|닭백숙/i, "삼계탕"],
    [/돼지국밥|순대국밥|국밥/i, "국밥"],
    [/순대|아바이/i, "순대"],
    [/족발|보쌈/i, "족발"],
    [/제육/i, "제육"],
    [/짜장|간짜장|쟁반짜장/i, "짜장면"],
    [/짬뽕/i, "짬뽕"],
    [/탕수육|깐풍기|양장피|마파두부/i, "중식요리"],
    [/김치찌개/i, "김치찌개"],
    [/된장찌개/i, "된장찌개"],
    [/부대찌개|부찌/i, "부대찌개"],
    [/순두부/i, "순두부"],
    [/수제비|라제비/i, "수제비"],
    [/칼국수|칼제비/i, "칼국수"],
    [/돈까스|돈카츠|카츠/i, "돈까스"],
    [/초밥|스시/i, "초밥"],
    [/덮밥|가츠동|규동|오야코동|텐동/i, "덮밥"],
    [/김밥|키토김밥/i, "김밥"],
    [/떡볶이/i, "떡볶이"],
    [/라멘|라면/i, "라멘"],
    [/우동|쫄면/i, "우동"],
    [/쌀국수|우육면/i, "쌀국수"],
    [/마라탕|마라샹궈/i, "마라탕"],
    [/파스타|스파게티/i, "파스타"],
    [/피자/i, "피자"],
    [/치킨|닭강정|닭다리|닭가슴/i, "치킨"],
    [/포케/i, "포케"],
    [/통밀랩|랩샌드|보울/i, "샐러드"],
    [/샐러드/i, "샐러드"],
    [/냉면|밀면/i, "냉면"],
    [/찌개/i, "찌개"],
    [/쌈밥|한정식|밥상/i, "한정식"],
    [/백반|정식|뷔페|도시락/i, "백반"],
    [/오믈렛|오므라이스/i, "오믈렛"],
    [/동태찜|찜닭|아구찜/i, "찜"],
    [/와규|한우|안창살|살치살|등심|부채살|치마살|꽃살|척아이롤|우설|토마호크|아롱사태/i, "고기"],
    [/삼겹살|냉삼|한돈|갈매기살|항정살|돼지갈비|돼지구이|숯불구이|소갈비/i, "고기"],
    [/샤브/i, "샤브샤브"],
  ];
  for (const [pattern, label] of rules) {
    if (pattern.test(corpus)) return label;
  }
  return fallbackFoodCategory(item);
}

function fallbackFoodCategory(item) {
  const category = item.category || "";
  if (!category || category === "식권대장 가맹점") return "";
  if (/편의점|마트|카페|베이커리/.test(category)) return "";
  const first = category.split("/")[0].trim();
  if (first === "버거") return "햄버거";
  if (first === "샐러드") return "샐러드";
  return first;
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
  return mode === "ladder" || mode === "roulette" || mode === "marble";
}

function createLadderGame(items, seed, chosenStartLane) {
  const count = Math.min(items.length, MAX_USER_MENUS);
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
  const ladderRows = 7;
  const rungs = game.rungs
    .map(({ row, from }) => {
      const active = activeRungs.has(`${row}-${from}`) ? " is-active" : "";
      // Reveal each row of rungs roughly when the snake reaches it (5s total animation, ease-out)
      const progress = (row + 1) / ladderRows;
      const delay = (progress * 4.4).toFixed(2);
      return `<line class="ladder-rung${active}" style="--rung-delay:${delay}s" x1="${xFor(from)}" y1="${yFor(row)}" x2="${xFor(from + 1)}" y2="${yFor(row)}" />`;
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
        `<span class="ladder-result ${revealResult && index === game.winnerIndex ? "is-winner" : ""}" style="left:${(xFor(index) / width) * 100}%">${escapeHtml(item.label)}</span>`,
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
          ? `<p class="game-result"><strong>${escapeHtml(game.items[game.winnerIndex].label)}</strong> 당첨</p>`
          : `<p class="game-wait">${state.gamePhase === "running" ? "두근두근... 사다리 따라 내려가는 중" : "위 번호 중 하나를 골라주세요"}</p>`
      }
    </div>
  `;
}

function buildWheelItems(userItems, seed) {
  const N = userItems.length;
  const extras = [];
  const halfUp = Math.ceil(N / 2);
  const halfDown = Math.floor(N / 2);
  for (let i = 0; i < halfUp; i += 1) {
    extras.push({ id: `again-${i}`, label: "한번더", type: "again" });
  }
  for (let i = 0; i < halfDown; i += 1) {
    extras.push({ id: `miss-${i}`, label: "꽝", type: "miss" });
  }
  const combined = [...userItems, ...extras];
  // deterministic shuffle so the same seed yields the same layout
  for (let i = combined.length - 1; i > 0; i -= 1) {
    const j = deterministicNoise(`shuffle-${seed}-${i}`, i + 1);
    [combined[i], combined[j]] = [combined[j], combined[i]];
  }
  return combined;
}

function pickEdgeFraction(seed, key) {
  const noise = deterministicNoise(`${key}-${seed}`, 100);
  const base = 0.08 + (noise / 100) * 0.14; // 0.08 ~ 0.22 from a boundary
  return noise % 2 === 0 ? base : 1 - base;
}

function sliceColor(item, index, colors) {
  if (item.type === "again") return "#94a3b8";
  if (item.type === "miss") return "#475569";
  return colors[index % colors.length];
}

function createRouletteGame(items, seed) {
  const allItems = buildWheelItems(items, seed);
  const count = allItems.length;
  const winnerIndex = deterministicNoise(`roulette-${seed}-${allItems.map((item) => item.label).join("-")}`, count);
  const sliceFraction = pickEdgeFraction(seed, "roulette-edge");
  return { items: allItems, winnerIndex, sliceFraction };
}

function renderRoulette(game) {
  if (!game.items.length) return `<p>표시할 후보가 없습니다.</p>`;
  const revealResult = state.gamePhase === "done";
  const colors = ["#0f766e", "#f59e0b", "#2563eb", "#dc2626", "#7c3aed", "#059669"];
  const segment = 360 / game.items.length;
  const gradient = game.items
    .map((item, index) => `${sliceColor(item, index, colors)} ${index * segment}deg ${(index + 1) * segment}deg`)
    .join(", ");
  const finalRotation = 1800 - (game.winnerIndex * segment + segment * game.sliceFraction);
  const labels = game.items
    .map((item, index) => {
      const angle = index * segment + segment / 2;
      const cls = item.type === "again" ? "is-again" : item.type === "miss" ? "is-miss" : "";
      return `<span class="roulette-label ${cls}" style="--angle:${angle}deg"><span class="roulette-label-text">${escapeHtml(item.label)}</span></span>`;
    })
    .join("");
  const winner = game.items[game.winnerIndex];
  return `
    <div class="roulette-game ${state.gamePhase === "running" ? "is-running" : ""} ${revealResult ? "is-done" : ""}">
      <div class="roulette-pointer" aria-hidden="true"></div>
      <div class="roulette-wheel" style="--wheel:${gradient}; --spin:${finalRotation}deg">
        ${labels}
        <span class="roulette-center">GO</span>
      </div>
      ${revealResult ? renderWheelResult(winner) : `<p class="game-wait">아직 몰라요... 거의 멈추는 중</p>`}
    </div>
  `;
}

function renderWheelResult(winner) {
  if (winner.type === "miss") {
    return `<p class="game-result is-miss"><strong>꽝</strong> 다시 한번 도전!</p>`;
  }
  if (winner.type === "again") {
    return `<p class="game-result is-again"><strong>한번더!</strong> 룰렛을 한 번 더 돌려보세요.</p>`;
  }
  return `<div class="confetti" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div><p class="game-result"><strong>${escapeHtml(winner.label)}</strong> 당첨</p>`;
}

function createMarbleGame(items, seed) {
  const allItems = buildWheelItems(items, `marble-${seed}`);
  const count = allItems.length;
  const winnerIndex = deterministicNoise(`marble-${seed}-${allItems.map((item) => item.label).join("-")}`, count);
  const sliceFraction = pickEdgeFraction(seed, "marble-edge");
  return { items: allItems, winnerIndex, sliceFraction };
}

function renderMarble(game) {
  if (!game.items.length) return `<p>표시할 후보가 없습니다.</p>`;
  const revealResult = state.gamePhase === "done";
  const count = game.items.length;
  const slotWidth = 100 / count; // %
  const winnerCenter = (game.winnerIndex + 0.5) * slotWidth; // %, 0~100
  // 시작점 (위 가운데) → 끝점 (winner slot center) 까지 좌우로 흔들리며 내려옴
  const startX = 50;
  const finalDX = winnerCenter - startX;
  // 페그 (장식용) 그리드
  const pegRows = 6;
  const pegsHtml = [];
  for (let row = 0; row < pegRows; row += 1) {
    const offset = row % 2 === 0 ? 0 : 50 / Math.max(count, 5);
    const cols = Math.max(count, 5);
    for (let col = 0; col < cols; col += 1) {
      const left = offset + (col * 100) / cols + (50 / cols);
      const top = 10 + (row * 60) / pegRows;
      pegsHtml.push(`<i class="marble-peg" style="left:${left}%;top:${top}%"></i>`);
    }
  }
  const slots = game.items
    .map((item, index) => {
      const cls = item.type === "again"
        ? "is-again"
        : item.type === "miss"
          ? "is-miss"
          : "is-menu";
      const winnerCls = revealResult && index === game.winnerIndex ? " is-winner" : "";
      return `<div class="marble-slot ${cls}${winnerCls}" style="flex:1"><span>${escapeHtml(item.label)}</span></div>`;
    })
    .join("");
  const winner = game.items[game.winnerIndex];
  return `
    <div class="marble-game ${state.gamePhase === "running" ? "is-running" : ""} ${revealResult ? "is-done" : ""}">
      <div class="marble-arena">
        <div class="marble-pegs" aria-hidden="true">${pegsHtml.join("")}</div>
        <div class="marble-ball" style="--final-dx:${finalDX.toFixed(2)}%" aria-hidden="true"></div>
        <div class="marble-slots">${slots}</div>
      </div>
      ${revealResult ? renderWheelResult(winner) : `<p class="game-wait">공이 떨어지는 중...</p>`}
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
  renderGameStage();
  syncUserMenuInputValue();
  const heroId = String(selectedRecommendations[0]?.id ?? "");
  const candidates = [...recommendations]
    .filter((item) => String(item.id) !== heroId)
    .sort((a, b) => (a.distanceM ?? Number.POSITIVE_INFINITY) - (b.distanceM ?? Number.POSITIVE_INFINITY));
  const filtered = filterBySearch(candidates);
  const countLabel = state.searchQuery
    ? `${filtered.length}곳 / ${recommendations.length}곳`
    : `${recommendations.length}곳`;
  $("#candidateCount").textContent = countLabel;
  const clearBtn = document.getElementById("clearSearchButton");
  if (clearBtn) clearBtn.hidden = !state.searchQuery;
  const list = $("#candidateList");
  list.innerHTML = "";
  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "candidate-empty-state";
    empty.textContent = state.searchQuery
      ? `'${state.searchQuery}'에 맞는 가맹점이 없어요`
      : "표시할 가맹점이 없습니다.";
    list.append(empty);
    return;
  }
  for (const item of filtered) {
    list.append(renderCandidate(item));
  }
}

function filterBySearch(items) {
  const query = state.searchQuery.trim().toLowerCase();
  if (!query) return items;
  return items.filter((item) => {
    if (String(item.name ?? "").toLowerCase().includes(query)) return true;
    if (String(item.category ?? "").toLowerCase().includes(query)) return true;
    const allMenus = [
      ...(item.menus?.lunch ?? []),
      ...(item.menus?.dinner ?? []),
      ...(item.naverMenus ?? []),
    ];
    return allMenus.some((menu) => String(menu?.name ?? "").toLowerCase().includes(query));
  });
}

function selectGameWinner(recommendations) {
  if (!state.hasPicked || state.gamePhase !== "done") return recommendations;
  if (!needsManualChoices(state.mode)) return recommendations;
  let winner = null;
  if (state.mode === "marble") {
    if (!state.marbleItems || state.marbleWinnerIndex == null) return recommendations;
    winner = state.marbleItems[state.marbleWinnerIndex];
  } else {
    const items = userMenuItems();
    if (!items.length) return recommendations;
    let game = null;
    if (state.mode === "ladder") {
      game = createLadderGame(items, state.gameSeed, state.selectedStartLane ?? 0);
    } else if (state.mode === "roulette") {
      game = createRouletteGame(items, state.gameSeed);
    }
    if (!game) return recommendations;
    winner = game.items[game.winnerIndex];
  }
  if (!winner) return recommendations;
  if (winner.type === "miss") {
    return [buildMissResult(), ...recommendations];
  }
  if (winner.type === "again") {
    return [buildAgainResult(), ...recommendations];
  }
  return mergeMenuWinner(winner.label, recommendations);
}

function mergeMenuWinner(menuLabel, recommendations) {
  const matched = findRestaurantsByMenu(menuLabel, recommendations);
  if (!matched.length) {
    return [buildUnmatchedResult(menuLabel), ...recommendations];
  }
  const suggestions = matched.slice(0, 4);
  const top = suggestions[0];
  const names = suggestions.map((item) => item.name);
  const nameText = names.length > 1 ? `${names.slice(0, 3).join(", ")} 어떠신가요?` : `${top.name} 어떠신가요?`;
  const result = {
    ...top,
    id: `result-menu-${menuLabel}`,
    menu: menuLabel,
    name: nameText,
    reason: `${menuLabel} 메뉴가 있는 가맹점 ${matched.length}곳 중 가까운 곳입니다.`,
    suggestions,
  };
  const matchedIds = new Set(matched.map((item) => item.id));
  return [result, ...recommendations.filter((item) => !matchedIds.has(item.id))];
}

function buildMissResult() {
  return {
    id: "result-miss",
    menu: "꽝",
    name: "다음 기회에…",
    reason: "한 번 더 돌려보세요. 행운을 빌어요!",
    distanceM: 0,
    category: "",
    priceBand: "",
    tags: [],
  };
}

function buildAgainResult() {
  return {
    id: "result-again",
    menu: "한번더!",
    name: "다시 한 번 도전",
    reason: "룰렛을 한 번 더 돌릴 기회예요.",
    distanceM: 0,
    category: "",
    priceBand: "",
    tags: [],
  };
}

function buildUnmatchedResult(menuLabel) {
  return {
    id: `result-unmatched-${menuLabel}`,
    menu: menuLabel,
    name: "매칭되는 가맹점이 없어요",
    reason: `${menuLabel} 메뉴를 파는 가맹점을 찾지 못했습니다. 다른 메뉴로 시도해보세요.`,
    distanceM: 0,
    category: "",
    priceBand: "",
    tags: [],
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
  const removeBtn = event.target.closest("[data-remove-menu]");
  if (removeBtn) {
    removeUserMenu(removeBtn.dataset.removeMenu);
    return;
  }
  if (event.target.closest("#addMenuButton")) {
    addUserMenu(state.userMenuInput);
    return;
  }
});
$("#gameStage").addEventListener("input", (event) => {
  if (event.target.id === "userMenuInput") {
    state.userMenuInput = event.target.value;
  }
});
$("#gameStage").addEventListener("keydown", (event) => {
  if (event.target.id === "userMenuInput" && event.key === "Enter") {
    event.preventDefault();
    addUserMenu(event.target.value);
  }
});
$("#candidateList").addEventListener("click", (event) => {
  if (event.target.closest("a")) return;
  const head = event.target.closest(".candidate-head");
  if (!head) return;
  const card = head.closest("[data-candidate-id]");
  if (card) toggleCandidate(card.dataset.candidateId);
});
const searchInput = document.getElementById("candidateSearch");
if (searchInput) {
  searchInput.addEventListener("input", (event) => {
    state.searchQuery = event.target.value ?? "";
    render();
    // keep focus + cursor where it is
    const el = document.getElementById("candidateSearch");
    if (el && document.activeElement !== el) {
      el.focus({ preventScroll: true });
      const len = el.value.length;
      try { el.setSelectionRange(len, len); } catch {}
    }
  });
}
const clearSearchBtn = document.getElementById("clearSearchButton");
if (clearSearchBtn) {
  clearSearchBtn.addEventListener("click", () => {
    state.searchQuery = "";
    const el = document.getElementById("candidateSearch");
    if (el) el.value = "";
    render();
    if (el) el.focus({ preventScroll: true });
  });
}
for (const button of document.querySelectorAll(".mode-button")) {
  button.addEventListener("click", () => setMode(button.dataset.mode));
}
$("#clearFiltersButton").addEventListener("click", () => {
  state.preferences.clear();
  state.pickIndex = 0;
  state.hasPicked = false;
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
