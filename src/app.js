import { findRestaurantsByMenu, getCurrentMeal, recommendMeals, summarizeDataHealth } from "./recommender.js?v=20260523-05";
import { startMarbleRace } from "./marble-race.js?v=20260522-31";

const state = {
  meal: getCurrentMeal(new Date()),
  preferences: new Set(),
  restaurants: [],
  // Start at a random rotation offset so the first card the user sees on
  // page load differs each session (was always 0 → same top pick).
  pickIndex: Math.floor(Math.random() * 12),
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
  renderPopular();
  render();
}

// ========== POPULAR ON HOME (네이버 평점 × log(리뷰수)) ==========
function popularScore(item) {
  const rating = typeof item.naverRating === "number" ? item.naverRating : 0;
  const reviews = item.naverVisitorReviewCount || item.naverReviewCount || 0;
  if (!rating || !reviews) return -1;
  // rating dominates; log(reviews) prevents a 5.0/1-review place from topping
  // a 4.6/2000-review staple while still rewarding genuine volume.
  return rating * Math.log10(reviews + 1);
}

function thumbForCategory(item) {
  const cat = String(item.category ?? "").toLowerCase();
  if (/고기|구이|돼지|소고기|한우|와규|곱창|족발|갈비|삼겹/.test(cat)) return "🥩";
  if (/치킨/.test(cat)) return "🍗";
  if (/중식|짜장|짬뽕|마라|훠궈/.test(cat)) return "🥟";
  if (/일식|초밥|회|스시|돈까스|돈가스|라멘|우동|규동|텐동/.test(cat)) return "🍣";
  if (/양식|샌드위치|버거|피자|파스타|스테이크/.test(cat)) return "🍝";
  if (/카페|커피|음료|차/.test(cat)) return "☕";
  if (/베이커리|빵|디저트/.test(cat)) return "🥐";
  if (/샐러드|건강식|다이어트/.test(cat)) return "🥗";
  if (/분식|떡볶이|김밥/.test(cat)) return "🍙";
  if (/면\/국수|국수|쌀국수/.test(cat)) return "🍜";
  if (/한식|국밥|찌개|순두부|덮밥|백반/.test(cat)) return "🍚";
  return "🍱";
}

function renderPopular() {
  const scroll = document.getElementById("popularScroll");
  if (!scroll) return;
  const ranked = state.restaurants
    .map((item) => ({ item, score: popularScore(item) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);
  // Take top 10 by score, then random 5 per session so the carousel
  // varies between reloads but stays anchored to real popular places.
  const pool = ranked.slice(0, 10);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const picks = pool.slice(0, 5);
  if (!picks.length) {
    scroll.innerHTML = "";
    return;
  }
  scroll.innerHTML = picks
    .map(({ item }, i) => {
      const accentCls = i % 3 === 1 ? "is-warm" : i % 3 === 2 ? "is-cool" : "";
      const rating = (item.naverRating ?? 0).toFixed(1);
      const reviews = item.naverVisitorReviewCount || item.naverReviewCount || 0;
      const distance = item.distanceM ? `${item.distanceM}m` : "";
      const cat = item.category ? `${escapeHtml(item.category)}` : "";
      const subMeta = [cat, distance].filter(Boolean).join(" · ");
      return `
        <article class="popular-card ${accentCls}" data-popular="${escapeHtml(item.name)}">
          <div class="pop-thumb">${thumbForCategory(item)}</div>
          <h4>${escapeHtml(item.name)}</h4>
          <small>${escapeHtml(subMeta)}</small>
          <div class="pop-meta">
            <span>네이버 ★ ${rating}</span>
            <strong>리뷰 ${reviews.toLocaleString("ko-KR")}</strong>
          </div>
        </article>
      `;
    })
    .join("");
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
  // Direct place URL when available, otherwise name search.
  const mapUrl = item.naverPlaceUrl || naverMapSearchUrl(item.name);
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
    <a class="hero-map" href="${escapeHtml(mapUrl)}" target="_blank" rel="noopener">🗺️ 네이버 지도에서 보기</a>
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
  // Prefer the direct Naver Place URL (lands on that specific restaurant page)
  // and fall back to a name search when we don't have one mapped.
  const mapUrl = item.naverPlaceUrl || naverMapSearchUrl(item.name);
  const mapButton = `<a class="candidate-map" href="${escapeHtml(mapUrl)}" target="_blank" rel="noopener">🗺️ 네이버 지도에서 검색</a>`;
  if (!menus.length) {
    return `
      <div class="candidate-detail">
        <p class="candidate-empty">네이버 메뉴 정보가 아직 없어요.</p>
        ${mapButton}
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
$("#refreshButton").addEventListener("click", () => {
  // Full page reload — useful to reset everything if something looks off
  window.location.reload();
});
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

// ========== HERO MAP MOUNT ==========
const HERO_MAP_TILES = [
  "55908_25396",
  "55909_25396",
  "55910_25396",
  "55908_25397",
  "55909_25397",
  "55910_25397",
  "55908_25398",
  "55909_25398",
  "55910_25398",
];

const HERO_MAP_LINK = "https://map.naver.com/p/search/%EB%AC%B8%EC%A0%95%EC%97%AD%ED%85%8C%EB%9D%BC%ED%83%80%EC%9B%8C";

function mountHeroMap(container) {
  if (!container || container.querySelector(".hero-osm")) return;
  // Map tiles — decorative only, NOT clickable
  const osm = document.createElement("div");
  osm.className = "hero-osm";
  osm.setAttribute("aria-hidden", "true");
  for (const id of HERO_MAP_TILES) {
    const img = document.createElement("img");
    img.src = `./assets/map-tiles/${id}.png`;
    img.alt = "";
    img.loading = "lazy";
    osm.append(img);
  }
  container.prepend(osm);

  // Pin — the ONLY clickable thing; opens Naver Map
  const pinLink = document.createElement("a");
  pinLink.className = "hero-pin";
  pinLink.href = HERO_MAP_LINK;
  pinLink.target = "_blank";
  pinLink.rel = "noopener noreferrer";
  pinLink.setAttribute(
    "aria-label",
    "네이버 지도에서 엔키 본사(문정역테라타워) 위치 보기"
  );
  pinLink.innerHTML = `
    <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <circle cx="50" cy="50" r="30" fill="#fbbf24" fill-opacity="0.1"/>
      <circle cx="50" cy="50" r="18" fill="#fbbf24" fill-opacity="0.22"/>
      <circle cx="50" cy="50" r="8" fill="#fbbf24"/>
      <circle cx="50" cy="50" r="3.5" fill="#1e1b4b"/>
    </svg>
  `;
  container.append(pinLink);
}

for (const el of document.querySelectorAll("[data-hero-map]")) {
  mountHeroMap(el);
}

// ========== TAB ROUTING ==========
const VALID_TABS = new Set(["home", "menu", "deal", "board", "chat", "my"]);
// Tab order used to decide slide direction. Bottom-nav order with 'menu'
// slotted right after 'home' since the home page is the primary path to it.
const TAB_ORDER = ["home", "menu", "board", "deal", "chat", "my"];

function activateTab(tab) {
  const target = VALID_TABS.has(tab) ? tab : "home";
  // Figure out which direction the new tab is coming from so the keyframes
  // can slide it in from the matching side (iOS feel).
  const prevPane = document.querySelector(".tab-pane.is-active");
  const prevTab = prevPane?.dataset.tab;
  let direction = null;
  if (prevTab && prevTab !== target) {
    const prevIdx = TAB_ORDER.indexOf(prevTab);
    const nextIdx = TAB_ORDER.indexOf(target);
    if (prevIdx >= 0 && nextIdx >= 0) {
      direction = nextIdx > prevIdx ? "right" : "left";
    }
  }

  document.querySelectorAll(".tab-pane").forEach((el) => {
    const isActive = el.dataset.tab === target;
    // Always clear direction state from previous run.
    el.classList.remove("is-from-right", "is-from-left");
    if (isActive) {
      // Restart the keyframe by toggling off + forcing reflow + toggling on.
      // Without this, re-activating the same tab (or returning to one)
      // would not replay the entrance animation.
      el.classList.remove("is-active");
      // eslint-disable-next-line no-unused-expressions
      void el.offsetWidth;
      if (direction === "right") el.classList.add("is-from-right");
      else if (direction === "left") el.classList.add("is-from-left");
      el.classList.add("is-active");
    } else {
      el.classList.remove("is-active");
    }
  });

  document.querySelectorAll(".nav-item").forEach((el) => {
    const isActive = el.dataset.tabTarget === target;
    if (isActive) {
      // Same restart trick so the icon-pop keyframe replays each tap.
      el.classList.remove("is-active");
      const icon = el.querySelector(".nav-icon");
      if (icon) void icon.offsetWidth;
      el.classList.add("is-active");
    } else {
      el.classList.remove("is-active");
    }
  });

  const action = document.getElementById("bottomAction");
  if (action) action.classList.toggle("is-visible", target === "menu");
  window.scrollTo({ top: 0, behavior: "instant" });
}

function readHashTab() {
  const raw = window.location.hash.replace(/^#\/?/, "");
  return raw || "home";
}

function navigateTo(tab) {
  const next = VALID_TABS.has(tab) ? tab : "home";
  if (readHashTab() === next) {
    activateTab(next);
  } else {
    window.location.hash = `#/${next}`;
  }
}

window.addEventListener("hashchange", () => activateTab(readHashTab()));

for (const btn of document.querySelectorAll(".nav-item")) {
  btn.addEventListener("click", () => navigateTo(btn.dataset.tabTarget));
}

for (const btn of document.querySelectorAll("[data-nav-to]")) {
  btn.addEventListener("click", () => navigateTo(btn.dataset.navTo));
}

// ========== HOME → MENU SEARCH BRIDGE ==========
const homeSearchInput = document.getElementById("homeSearch");
const homeSearchBtn = document.getElementById("homeSearchBtn");

function applyHomeSearch() {
  if (!homeSearchInput) return;
  const value = homeSearchInput.value.trim();
  if (!value) {
    navigateTo("menu");
    return;
  }
  state.searchQuery = value;
  const menuSearch = document.getElementById("candidateSearch");
  if (menuSearch) menuSearch.value = value;
  navigateTo("menu");
  render();
  // scroll list into view after tab switch
  setTimeout(() => {
    document.querySelector('[data-tab="menu"] .list-section')?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 100);
}

if (homeSearchInput) {
  homeSearchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      applyHomeSearch();
    }
  });
}
if (homeSearchBtn) {
  homeSearchBtn.addEventListener("click", applyHomeSearch);
}

// Popular cards on home → set search query and jump to menu tab.
// Event delegation so re-rendered cards (after data load) still work.
const popularScrollEl = document.getElementById("popularScroll");
if (popularScrollEl) {
  popularScrollEl.addEventListener("click", (event) => {
    const card = event.target.closest("[data-popular]");
    if (!card) return;
    state.searchQuery = card.dataset.popular;
    const menuSearch = document.getElementById("candidateSearch");
    if (menuSearch) menuSearch.value = state.searchQuery;
    navigateTo("menu");
    render();
  });
}

// ========== LUNCH COUNTDOWN ==========
function updateLunchCountdown() {
  const el = document.getElementById("lunchCountdown");
  if (!el) return;
  const now = new Date();
  const lunch = new Date(now);
  lunch.setHours(12, 0, 0, 0);
  const dinner = new Date(now);
  dinner.setHours(18, 0, 0, 0);
  let diffMs;
  let label;
  if (now < lunch) {
    diffMs = lunch - now;
    label = "점심";
  } else if (now < dinner) {
    diffMs = dinner - now;
    label = "저녁";
  } else {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(12, 0, 0, 0);
    diffMs = tomorrow - now;
    label = "내일 점심";
  }
  const totalMinutes = Math.max(0, Math.round(diffMs / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const timeText = hours > 0 ? `${hours}시간 ${minutes}분` : `${minutes}분`;
  el.innerHTML = `🕒 ${label}까지 <strong>${timeText}</strong>`;
  // Mirror the same label into 메뉴 탭 hero (if mounted)
  const menuEl = document.getElementById("menuLunchCountdown");
  if (menuEl) {
    menuEl.innerHTML = `🕒 ${label}까지 <strong>${timeText}</strong>`;
  }
}
updateLunchCountdown();
setInterval(updateLunchCountdown, 30000);

// ========== WEATHER + DATE (문정동) ==========
function weatherIcon(code) {
  if (code === 0) return "☀️";
  if (code <= 2) return "🌤️";
  if (code === 3) return "☁️";
  if (code >= 45 && code <= 48) return "🌫️";
  if (code >= 51 && code <= 57) return "🌦️";
  if (code >= 61 && code <= 67) return "🌧️";
  if (code >= 71 && code <= 77) return "❄️";
  if (code >= 80 && code <= 82) return "🌧️";
  if (code >= 85 && code <= 86) return "🌨️";
  if (code >= 95) return "⛈️";
  return "🌤️";
}

function todayLabel() {
  const now = new Date();
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  return `${now.getMonth() + 1}월 ${now.getDate()}일 (${weekdays[now.getDay()]})`;
}

async function updateWeatherAndDate() {
  const el = document.getElementById("heroWeather");
  if (!el) return;
  const dateText = todayLabel();
  el.textContent = `📅 ${dateText}`;
  try {
    const res = await fetch(
      "https://api.open-meteo.com/v1/forecast?latitude=37.4858&longitude=127.1228&current_weather=true&timezone=Asia%2FSeoul",
      { cache: "default" },
    );
    if (!res.ok) return;
    const data = await res.json();
    const current = data?.current_weather;
    if (!current) return;
    const icon = weatherIcon(current.weathercode);
    const temp = Math.round(current.temperature);
    el.textContent = `📅 ${dateText} · ${icon} ${temp}°`;
  } catch {
    // network failed; keep date-only label
  }
}

updateWeatherAndDate();
setInterval(updateWeatherAndDate, 10 * 60 * 1000);

// ========== BUDGET TRACKER (localStorage) ==========
const BUDGET_DAILY_DEFAULT = 12000;
const BUDGET_DAILY_KEY = "enki.budget.daily.v1";
const BUDGET_KEY = "enki.budget.v1";
function getDailyBudget() {
  try {
    const raw = localStorage.getItem(BUDGET_DAILY_KEY);
    const n = raw == null ? BUDGET_DAILY_DEFAULT : Number(raw);
    return Number.isFinite(n) && n > 0 ? n : BUDGET_DAILY_DEFAULT;
  } catch { return BUDGET_DAILY_DEFAULT; }
}
function setDailyBudget(n) {
  try { localStorage.setItem(BUDGET_DAILY_KEY, String(Math.round(n))); } catch {}
}
let BUDGET_DAILY = getDailyBudget();

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function loadBudget() {
  try {
    const raw = localStorage.getItem(BUDGET_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const today = todayKey();
    if (!parsed || parsed.date !== today) {
      return { date: today, entries: [] };
    }
    return parsed;
  } catch {
    return { date: todayKey(), entries: [] };
  }
}

function saveBudget(budget) {
  try { localStorage.setItem(BUDGET_KEY, JSON.stringify(budget)); } catch {}
}

let budgetState = loadBudget();

function totalUsed() {
  return budgetState.entries.reduce((sum, e) => sum + Number(e.amount || 0), 0);
}

function renderBudget() {
  // Daily rollover check
  if (budgetState.date !== todayKey()) {
    budgetState = { date: todayKey(), entries: [] };
    saveBudget(budgetState);
  }
  const used = totalUsed();
  const remaining = BUDGET_DAILY - used;
  const isOver = remaining < 0;
  const ratio = Math.max(0, Math.min(1, used / BUDGET_DAILY));

  const remainEl = document.getElementById("budgetRemaining");
  if (remainEl) {
    remainEl.textContent = `${remaining.toLocaleString("ko-KR")}원`;
    remainEl.classList.toggle("is-over", isOver);
  }
  const subEl = document.getElementById("budgetSub");
  if (subEl) {
    subEl.textContent = used > 0
      ? `오늘 ${used.toLocaleString("ko-KR")}원 사용 · 자정에 자동 리셋`
      : `하루 ${BUDGET_DAILY.toLocaleString("ko-KR")}원 · 자정에 자동 리셋`;
  }
  // Ring progress
  const ring = document.getElementById("budgetRingFg");
  const ringLabel = document.getElementById("budgetRingLabel");
  if (ring) {
    const circumference = 2 * Math.PI * 26; // r=26
    const remainRatio = Math.max(0, 1 - ratio);
    ring.style.strokeDasharray = `${circumference}`;
    ring.style.strokeDashoffset = `${circumference * (1 - remainRatio)}`;
    ring.classList.toggle("is-over", isOver);
  }
  if (ringLabel) {
    const pct = isOver ? 0 : Math.round((1 - ratio) * 100);
    ringLabel.textContent = isOver ? "초과" : `${pct}%`;
    ringLabel.classList.toggle("is-over", isOver);
  }
  // Home action card mirror
  const cardRemain = document.getElementById("budgetCardRemaining");
  const cardHint = document.getElementById("budgetCardHint");
  if (cardRemain) {
    cardRemain.textContent = isOver
      ? `초과 ${Math.abs(remaining).toLocaleString("ko-KR")}원`
      : `${remaining.toLocaleString("ko-KR")}원 남음`;
  }
  if (cardHint) {
    cardHint.textContent = used > 0
      ? `오늘 ${used.toLocaleString("ko-KR")}원 사용 · 탭하여 기록`
      : `탭하여 사용 금액 입력`;
  }
  // Log
  const log = document.getElementById("budgetLog");
  if (log) {
    if (!budgetState.entries.length) {
      log.innerHTML = `<p class="budget-empty">오늘은 아직 사용 기록이 없어요.</p>`;
    } else {
      log.innerHTML = budgetState.entries
        .slice()
        .reverse()
        .map((entry, idxFromEnd) => {
          const actualIdx = budgetState.entries.length - 1 - idxFromEnd;
          const note = entry.note ? `<span class="budget-note">${escapeHtml(entry.note)}</span>` : "";
          return `
            <div class="budget-entry">
              <div class="budget-entry-main">
                <strong>${entry.amount.toLocaleString("ko-KR")}원</strong>
                ${note}
              </div>
              <div class="budget-entry-side">
                <span>${escapeHtml(entry.time ?? "")}</span>
                <button type="button" class="budget-remove" data-budget-remove="${actualIdx}" aria-label="삭제">×</button>
              </div>
            </div>
          `;
        })
        .join("");
    }
  }
}

function addBudgetEntry(amount, note) {
  if (!Number.isFinite(amount) || amount <= 0) return;
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  budgetState.entries.push({ amount: Math.round(amount), note: note || "", time });
  saveBudget(budgetState);
  renderBudget();
}

function removeBudgetEntry(idx) {
  budgetState.entries.splice(idx, 1);
  saveBudget(budgetState);
  renderBudget();
}

function resetBudgetToday() {
  budgetState = { date: todayKey(), entries: [] };
  saveBudget(budgetState);
  renderBudget();
}

const budgetForm = document.getElementById("budgetForm");
if (budgetForm) {
  budgetForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const amountEl = document.getElementById("budgetAmount");
    const noteEl = document.getElementById("budgetNote");
    const amount = Number(amountEl?.value ?? 0);
    const note = (noteEl?.value ?? "").trim();
    if (!Number.isFinite(amount) || amount <= 0) return;
    addBudgetEntry(amount, note);
    if (amountEl) amountEl.value = "";
    if (noteEl) noteEl.value = "";
    amountEl?.focus();
  });
}

const budgetLogEl = document.getElementById("budgetLog");
if (budgetLogEl) {
  budgetLogEl.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-budget-remove]");
    if (!btn) return;
    const idx = Number(btn.dataset.budgetRemove);
    if (Number.isInteger(idx)) removeBudgetEntry(idx);
  });
}

const budgetResetBtn = document.getElementById("budgetReset");
if (budgetResetBtn) {
  budgetResetBtn.addEventListener("click", () => {
    if (confirm("오늘 사용 기록을 모두 지울까요?")) resetBudgetToday();
  });
}

// ========== 식대 모달 open/close ==========
const budgetModal = document.getElementById("budgetModal");
const budgetModalClose = document.getElementById("budgetModalClose");

function openBudgetModal() {
  if (!budgetModal) return;
  renderBudget(); // ensure ring/log/remaining are fresh
  budgetModal.hidden = false;
  document.body.classList.add("modal-open");
  // focus the amount input after the slide animation
  setTimeout(() => {
    document.getElementById("budgetAmount")?.focus();
  }, 240);
}

function closeBudgetModal() {
  if (!budgetModal) return;
  budgetModal.hidden = true;
  document.body.classList.remove("modal-open");
}

// Triggers — any element with [data-open-budget]
document.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-open-budget]");
  if (trigger) {
    event.preventDefault();
    openBudgetModal();
  }
});

// Close: × button, backdrop click, ESC key
if (budgetModalClose) {
  budgetModalClose.addEventListener("click", closeBudgetModal);
}
if (budgetModal) {
  budgetModal.addEventListener("click", (event) => {
    if (event.target === budgetModal) closeBudgetModal();
  });
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && budgetModal && !budgetModal.hidden) {
    closeBudgetModal();
  }
});

// Initial render + midnight rollover check every minute
renderBudget();
setInterval(renderBudget, 60 * 1000);

// ========== CHAT TAB (mock data, v1.1 preview) ==========
const CHAT_THREADS = [
  {
    id: "t1",
    type: "lunch",
    name: "박지인 매니저",
    initial: "박",
    avatarClass: "",
    online: true,
    lastMessage: "오늘 12시 한식 같이 가실 분 계실까요?",
    time: "방금",
    unread: 2,
    tag: "점심 모집",
  },
  {
    id: "t2",
    type: "lunch",
    name: "다이어트 같이먹어요 (4)",
    initial: "🥗",
    avatarClass: "is-group",
    online: false,
    lastMessage: "이서연: 슬로우캘리 1시 어떠세요?",
    time: "10분 전",
    unread: 5,
    tag: "그룹 점심",
  },
  {
    id: "t3",
    type: "deal",
    name: "김민수 (거래)",
    initial: "김",
    avatarClass: "is-deal",
    online: true,
    lastMessage: "맥북 충전기 65W 아직 판매중이신가요?",
    time: "1시간 전",
    unread: 1,
    tag: "거래",
  },
  {
    id: "t4",
    type: "system",
    name: "ENKI 공지",
    initial: "E",
    avatarClass: "is-system",
    online: false,
    lastMessage: "5/24(금) 전사 회식 — 송파대로 BBQ 6시 집결",
    time: "어제",
    unread: 0,
    tag: "공지",
  },
  {
    id: "t5",
    type: "dm",
    name: "이서연 책임",
    initial: "이",
    avatarClass: "",
    online: false,
    lastMessage: "내일 점심 같이 슬로우캘리 가요!",
    time: "어제",
    unread: 0,
    tag: "1:1",
  },
  {
    id: "t6",
    type: "deal",
    name: "맛집 추천 모임 (8)",
    initial: "🍱",
    avatarClass: "is-group",
    online: false,
    lastMessage: "박철수: 어제 갔던 지인고기 진짜 맛있었어요",
    time: "그저께",
    unread: 0,
    tag: "그룹",
  },
  {
    id: "t7",
    type: "deal",
    name: "최지우 (거래)",
    initial: "최",
    avatarClass: "is-deal",
    online: false,
    lastMessage: "에어팟 프로 2 케이스 같이 드릴게요",
    time: "그저께",
    unread: 0,
    tag: "거래",
  },
  {
    id: "t8",
    type: "system",
    name: "ENKI 시스템",
    initial: "🤖",
    avatarClass: "is-system",
    online: false,
    lastMessage: "식권대장 가맹점 데이터 v1.0 배포 완료",
    time: "1일 전",
    unread: 0,
    tag: "공지",
  },
];

const chatState = { filter: "all", query: "" };

function escapeChatHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function chatTagClass(type) {
  return ({
    lunch: "tag-lunch",
    deal: "tag-deal",
    system: "tag-system",
    dm: "",
  })[type] || "";
}

function filteredThreads() {
  const q = chatState.query.trim().toLowerCase();
  return CHAT_THREADS.filter((t) => {
    if (chatState.filter !== "all" && t.type !== chatState.filter) return false;
    if (!q) return true;
    return (
      t.name.toLowerCase().includes(q) ||
      t.lastMessage.toLowerCase().includes(q)
    );
  });
}

function renderChatList() {
  const listEl = document.getElementById("chatList");
  if (!listEl) return;
  const items = filteredThreads();
  if (!items.length) {
    listEl.innerHTML = `<li class="chat-empty">검색 결과가 없어요.</li>`;
    return;
  }
  listEl.innerHTML = items
    .map((t) => {
      const tagCls = chatTagClass(t.type);
      const tagHtml = t.tag
        ? `<span class="chat-tag ${tagCls}">${escapeChatHtml(t.tag)}</span>`
        : "";
      const unreadHtml = t.unread > 0
        ? `<span class="chat-badge">${t.unread}</span>`
        : "";
      const onlineHtml = t.online ? `<span class="chat-online"></span>` : "";
      const previewCls = t.unread > 0 ? "chat-preview has-unread" : "chat-preview";
      return `
        <li>
          <button type="button" class="chat-item" data-chat-id="${t.id}" data-chat-name="${escapeChatHtml(t.name)}">
            <div class="chat-avatar ${t.avatarClass}">
              ${escapeChatHtml(t.initial)}
              ${onlineHtml}
            </div>
            <div class="chat-body">
              <div class="chat-line">
                <strong>${escapeChatHtml(t.name)}${tagHtml}</strong>
                <span class="chat-time">${escapeChatHtml(t.time)}</span>
              </div>
              <p class="${previewCls}">${escapeChatHtml(t.lastMessage)}</p>
            </div>
            ${unreadHtml}
          </button>
        </li>
      `;
    })
    .join("");
}

function totalChatUnread() {
  return CHAT_THREADS.reduce((s, t) => s + (t.unread || 0), 0);
}

function updateChatBadges() {
  const total = totalChatUnread();
  const navBadge = document.getElementById("navChatBadge");
  if (navBadge) {
    if (total > 0) {
      navBadge.textContent = total > 99 ? "99+" : String(total);
      navBadge.hidden = false;
    } else {
      navBadge.hidden = true;
    }
  }
  const sub = document.getElementById("chatHeroSub");
  if (sub) {
    sub.textContent = total > 0
      ? `읽지 않은 메시지 ${total}개 · 점심 · 거래 · 1:1`
      : `점심 모집 · 거래 · 1:1 메시지`;
  }
}

function showToast(message) {
  const existing = document.querySelector(".chat-toast");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.className = "chat-toast";
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), 2400);
}

// Wire chat tab
const chatListEl = document.getElementById("chatList");
const chatFilterEl = document.getElementById("chatFilter");
const chatSearchInput = document.getElementById("chatSearchInput");
const chatNewBtn = document.getElementById("chatNewBtn");

if (chatListEl) {
  chatListEl.addEventListener("click", (event) => {
    const item = event.target.closest("[data-chat-id]");
    if (!item) return;
    const name = item.dataset.chatName || "채팅";
    showToast(`💬 ${name} — v1.2에서 실시간 채팅 열립니다`);
  });
}

if (chatFilterEl) {
  chatFilterEl.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-chat-filter]");
    if (!btn) return;
    chatState.filter = btn.dataset.chatFilter || "all";
    for (const c of chatFilterEl.querySelectorAll(".chat-chip")) {
      c.classList.toggle("is-active", c === btn);
    }
    renderChatList();
  });
}

if (chatSearchInput) {
  chatSearchInput.addEventListener("input", () => {
    chatState.query = chatSearchInput.value;
    renderChatList();
  });
}

if (chatNewBtn) {
  chatNewBtn.addEventListener("click", () => {
    showToast("✏️ 새 채팅 만들기 — v1.2에서 활성화");
  });
}

renderChatList();
updateChatBadges();

// ========== SETTINGS MODAL ==========
const settingsModal = document.getElementById("settingsModal");
const settingsModalClose = document.getElementById("settingsModalClose");
const settingsBudgetForm = document.getElementById("settingsBudgetForm");
const settingsBudgetInput = document.getElementById("settingsBudgetInput");
const settingsResetBudget = document.getElementById("settingsResetBudget");
const settingsResetAll = document.getElementById("settingsResetAll");

function openSettingsModal() {
  if (!settingsModal) return;
  if (settingsBudgetInput) settingsBudgetInput.value = String(BUDGET_DAILY);
  settingsModal.hidden = false;
  document.body.classList.add("modal-open");
}
function closeSettingsModal() {
  if (!settingsModal) return;
  settingsModal.hidden = true;
  document.body.classList.remove("modal-open");
}

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-open-settings]")) {
    event.preventDefault();
    openSettingsModal();
  }
});
if (settingsModalClose) settingsModalClose.addEventListener("click", closeSettingsModal);
if (settingsModal) {
  settingsModal.addEventListener("click", (event) => {
    if (event.target === settingsModal) closeSettingsModal();
  });
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && settingsModal && !settingsModal.hidden) {
    closeSettingsModal();
  }
});

if (settingsBudgetForm) {
  settingsBudgetForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const v = Number(settingsBudgetInput?.value ?? 0);
    if (!Number.isFinite(v) || v <= 0 || v > 100000) {
      showToast("⚠️ 1원 ~ 100,000원 사이로 입력해주세요");
      return;
    }
    setDailyBudget(v);
    BUDGET_DAILY = v;
    renderBudget();
    showToast(`✅ 일일 식대 ${v.toLocaleString("ko-KR")}원으로 변경됨`);
  });
}

if (settingsResetBudget) {
  settingsResetBudget.addEventListener("click", () => {
    if (!confirm("오늘 식대 사용 기록을 모두 지울까요?")) return;
    resetBudgetToday();
    showToast("🗑️ 오늘 식대 기록 초기화됨");
  });
}

if (settingsResetAll) {
  settingsResetAll.addEventListener("click", () => {
    if (!confirm("모든 로컬 데이터(식대·일일 한도·향후 즐겨찾기 등)를 초기화합니다.\n계속할까요?")) return;
    try {
      localStorage.removeItem(BUDGET_KEY);
      localStorage.removeItem(BUDGET_DAILY_KEY);
    } catch {}
    BUDGET_DAILY = BUDGET_DAILY_DEFAULT;
    budgetState = { date: todayKey(), entries: [] };
    saveBudget(budgetState);
    renderBudget();
    if (settingsBudgetInput) settingsBudgetInput.value = String(BUDGET_DAILY);
    showToast("🗑️ 모든 로컬 데이터 초기화됨");
  });
}

// ========== NOTIFICATIONS ==========
// Mock dataset (v1.1) — real push comes with Firebase in v1.2.
const NOTIFICATIONS = [
  {
    id: "n1",
    type: "chat",
    icon: "💬",
    title: "박지인 매니저",
    body: "오늘 12시 한식 같이 가실 분 계실까요?",
    time: "방금",
    unread: true,
    action: { kind: "tab", target: "chat" },
  },
  {
    id: "n2",
    type: "deal",
    icon: "💰",
    title: "맥북 충전기 65W",
    body: "관심 등록한 상품에 새 댓글 1개",
    time: "5분 전",
    unread: true,
    action: { kind: "tab", target: "deal" },
  },
  {
    id: "n3",
    type: "lunch",
    icon: "🍽️",
    title: "점심 모집 — 슬로우캘리",
    body: "12시 다이어트 도시락, 4명 중 2명 모집됨",
    time: "15분 전",
    unread: true,
    action: { kind: "tab", target: "chat" },
  },
  {
    id: "n4",
    type: "system",
    icon: "📢",
    title: "ENKI 공지",
    body: "5/24(금) 전사 회식 — 송파대로 BBQ 6시 집결",
    time: "1시간 전",
    unread: true,
    action: { kind: "tab", target: "board" },
  },
  {
    id: "n5",
    type: "budget",
    icon: "💳",
    title: "오늘의 식대",
    body: "남은 식대 8,500원 · 자정에 자동 리셋",
    time: "2시간 전",
    unread: false,
    action: { kind: "modal", target: "budget" },
  },
  {
    id: "n6",
    type: "app",
    icon: "🤖",
    title: "ENKI Food Selector v1.1",
    body: "광장 / 채팅 / 알림 센터가 추가됐어요",
    time: "어제",
    unread: false,
    action: { kind: "modal", target: "settings" },
  },
];

function totalNotifUnread() {
  return NOTIFICATIONS.reduce((s, n) => s + (n.unread ? 1 : 0), 0);
}

function escapeNotifHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function notifTypeClass(type) {
  return `notif-icon-${type}`;
}

function renderNotifList() {
  const listEl = document.getElementById("notifList");
  if (!listEl) return;
  if (!NOTIFICATIONS.length) {
    listEl.innerHTML = `<li class="notif-empty">📭 알림이 없어요</li>`;
    return;
  }
  listEl.innerHTML = NOTIFICATIONS.map((n) => {
    const unreadCls = n.unread ? " is-unread" : "";
    return `
      <li>
        <button type="button" class="notif-item${unreadCls}" data-notif-id="${n.id}">
          <span class="notif-ico ${notifTypeClass(n.type)}">${escapeNotifHtml(n.icon)}</span>
          <div class="notif-body">
            <div class="notif-line">
              <strong>${escapeNotifHtml(n.title)}</strong>
              <span class="notif-time">${escapeNotifHtml(n.time)}</span>
            </div>
            <p>${escapeNotifHtml(n.body)}</p>
          </div>
          ${n.unread ? '<span class="notif-unread-dot" aria-hidden="true"></span>' : ""}
        </button>
      </li>
    `;
  }).join("");
}

function updateNotifBadges() {
  const total = totalNotifUnread();
  const dot = document.getElementById("notifUnreadDot");
  if (dot) dot.hidden = total === 0;
  const sub = document.getElementById("notifSub");
  if (sub) {
    sub.textContent = total > 0
      ? `읽지 않은 알림 ${total}개`
      : `최근 알림이 없어요`;
  }
}

const notifModal = document.getElementById("notifModal");
const notifModalClose = document.getElementById("notifModalClose");
const notifListEl = document.getElementById("notifList");
const notifMarkAllBtn = document.getElementById("notifMarkAll");
const notifClearAllBtn = document.getElementById("notifClearAll");

function openNotifModal() {
  if (!notifModal) return;
  renderNotifList();
  updateNotifBadges();
  notifModal.hidden = false;
  document.body.classList.add("modal-open");
}
function closeNotifModal() {
  if (!notifModal) return;
  notifModal.hidden = true;
  document.body.classList.remove("modal-open");
}

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-open-notifications]")) {
    event.preventDefault();
    openNotifModal();
  }
});
if (notifModalClose) notifModalClose.addEventListener("click", closeNotifModal);
if (notifModal) {
  notifModal.addEventListener("click", (event) => {
    if (event.target === notifModal) closeNotifModal();
  });
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && notifModal && !notifModal.hidden) {
    closeNotifModal();
  }
});

if (notifListEl) {
  notifListEl.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-notif-id]");
    if (!btn) return;
    const id = btn.dataset.notifId;
    const notif = NOTIFICATIONS.find((n) => n.id === id);
    if (!notif) return;
    if (notif.unread) {
      notif.unread = false;
      renderNotifList();
      updateNotifBadges();
    }
    closeNotifModal();
    // Dispatch by action kind
    if (notif.action?.kind === "tab") {
      navigateTo(notif.action.target);
    } else if (notif.action?.kind === "modal") {
      if (notif.action.target === "budget") openBudgetModal();
      else if (notif.action.target === "settings") openSettingsModal();
    }
  });
}

if (notifMarkAllBtn) {
  notifMarkAllBtn.addEventListener("click", () => {
    for (const n of NOTIFICATIONS) n.unread = false;
    renderNotifList();
    updateNotifBadges();
  });
}
if (notifClearAllBtn) {
  notifClearAllBtn.addEventListener("click", () => {
    if (!confirm("모든 알림을 지울까요?")) return;
    NOTIFICATIONS.length = 0;
    renderNotifList();
    updateNotifBadges();
  });
}

renderNotifList();
updateNotifBadges();

// ========== BOARD (광장) ==========
const BOARD_USER_POSTS_KEY = "enki.board.userPosts.v1";
const BOARD_LIKES_KEY = "enki.board.likes.v1";
const BOARD_USER_COMMENTS_KEY = "enki.board.userComments.v1";
const BOARD_CATEGORY_LABEL = {
  notice: "📢 공지",
  free: "💬 자유",
  anon: "🕵️ 익명",
  lunch: "🍱 점심 모집",
  review: "⭐ 거래 후기",
};
const BOARD_TAG_CLASS = {
  notice: "tag-notice",
  free: "tag-free",
  anon: "tag-anon",
  lunch: "tag-lunch",
  review: "tag-review",
};

// Seed posts — feels like a live ENKI community board
const SEED_POSTS = [
  {
    id: "p1",
    category: "notice",
    pinned: true,
    title: "5/24(금) 전사 회식 — 송파대로 BBQ 6시 집결",
    body: `안녕하세요, 운영팀입니다.
이번 주 금요일 5/24, 전사 회식이 있습니다.

📍 장소: BBQ 송파대로점 (문정역 4번 출구 도보 3분)
⏰ 시간: 오후 6시 집결, 6시 30분 시작
🍻 메뉴: 황금올리브치킨 + 양념 + 맥주
🙋 참석 확인은 본 게시글에 댓글 또는 인사팀 슬랙으로 부탁드립니다.

회식 후 2차는 자율입니다. 즐거운 한 주 마무리해요!`,
    author: "ENKI 운영팀",
    avatarInitial: "E",
    time: "어제 14:20",
    timestamp: Date.now() - 22 * 60 * 60 * 1000,
    likes: 24,
    views: 142,
    comments: [
      { id: "c1", author: "박지인", initial: "박", body: "참석합니다!", time: "어제 14:25", likes: 3 },
      { id: "c2", author: "김민수", initial: "김", body: "BBQ 어느 매장이에요?", time: "어제 14:32", likes: 1 },
      { id: "c3", author: "이서연", initial: "이", body: "송파대로 어느 쪽인지 알 수 있을까요?", time: "어제 15:08", likes: 0 },
      { id: "c4", author: "최지우", initial: "최", body: "예약 인원 알려주세요 🙋‍♂️", time: "어제 16:11", likes: 2 },
      { id: "c5", author: "박철수", initial: "박", body: "2차 어디로 가는지 정해지면 공유 부탁드려요", time: "어제 17:40", likes: 5 },
    ],
  },
  {
    id: "p2",
    category: "notice",
    pinned: true,
    title: "식권대장 6월 1일부터 결제 한도 변경 안내",
    body: `인사팀 공지입니다.

6월 1일부터 식권대장 일일 한도가 조정됩니다.
- 점심: 12,000원 → 13,000원 (변경 없음)
- 저녁: 12,000원 → 신규 신청자 한정 적용

자세한 내용은 인사팀 공지를 확인해주세요.`,
    author: "인사팀",
    avatarInitial: "H",
    time: "2일 전",
    timestamp: Date.now() - 48 * 60 * 60 * 1000,
    likes: 15,
    views: 89,
    comments: [
      { id: "c1", author: "박지인", initial: "박", body: "오 저녁도 가능해지나요?", time: "2일 전", likes: 4 },
      { id: "c2", author: "이서연", initial: "이", body: "신청 방법 안내 부탁드려요", time: "2일 전", likes: 2 },
    ],
  },
  {
    id: "p3",
    category: "free",
    title: "송파 가나순두부 진짜 추천 — 점심 후보로 강추",
    body: `오늘 점심에 갔다왔는데 두부조림 미쳤습니다.
한식 카테고리 1순위로 등록해도 될 듯.

위치: 문정역 3번 출구 도보 5분
가격: 9,000~12,000원
대기: 12시 30분 넘으면 줄 섭니다`,
    author: "박지인",
    avatarInitial: "박",
    time: "30분 전",
    timestamp: Date.now() - 30 * 60 * 1000,
    likes: 12,
    views: 38,
    comments: [
      { id: "c1", author: "김민수", initial: "김", body: "거기 진짜 맛있죠 👍", time: "20분 전", likes: 5 },
      { id: "c2", author: "이서연", initial: "이", body: "근데 줄 길어요...", time: "18분 전", likes: 3 },
      { id: "c3", author: "박철수", initial: "박", body: "오늘 가봐야겠다", time: "12분 전", likes: 1 },
      { id: "c4", author: "최지우", initial: "최", body: "두부조림 미쳤음 ㅇㅈ", time: "8분 전", likes: 4 },
      { id: "c5", author: "강지영", initial: "강", body: "내일 점심 같이 가실 분?", time: "5분 전", likes: 2 },
    ],
  },
  {
    id: "p4",
    category: "lunch",
    title: "12시 슬로우캘리 같이 가실 분 (3/4 모집됨)",
    body: `오늘 12시에 슬로우캘리 가실 분 모집합니다.
다이어트 도시락 좋아하시는 분이면 누구나 환영!

현재: 3명 / 4명
출발: 5층 라운지 11:55`,
    author: "박지인",
    avatarInitial: "박",
    time: "방금",
    timestamp: Date.now() - 2 * 60 * 1000,
    likes: 2,
    views: 14,
    comments: [
      { id: "c1", author: "이서연", initial: "이", body: "저요!", time: "방금", likes: 1 },
      { id: "c2", author: "박지인", initial: "박", body: "@이서연 1명 남았어요~ 빨리오세요", time: "방금", likes: 0 },
    ],
    lunch: { current: 3, total: 4 },
  },
  {
    id: "p5",
    category: "lunch",
    title: "1시 한식 모집해요 (2/6) — 송파 가나순두부",
    body: `위 박지인님 글 보고 끌려서 1시 팀도 만듭니다 ㅋㅋ

현재: 2명 / 6명
출발: 5층 로비 12:50`,
    author: "김민수",
    avatarInitial: "김",
    time: "10분 전",
    timestamp: Date.now() - 10 * 60 * 1000,
    likes: 1,
    views: 22,
    comments: [
      { id: "c1", author: "박철수", initial: "박", body: "참여합니다", time: "8분 전", likes: 0 },
    ],
    lunch: { current: 2, total: 6 },
  },
  {
    id: "p6",
    category: "lunch",
    title: "라멘 좋아하시는 분 (4/4 마감)",
    body: `오늘 점심 라멘 같이 갈 팀 만들었습니다.
마감되어 다음에 또 모집할게요!`,
    author: "이서연",
    avatarInitial: "이",
    time: "1시간 전",
    timestamp: Date.now() - 60 * 60 * 1000,
    likes: 5,
    views: 45,
    comments: [],
    lunch: { current: 4, total: 4 },
  },
  {
    id: "p7",
    category: "free",
    title: "회사 근처 새로 생긴 카페 정보 공유해요",
    body: `문정역 6번 출구 쪽에 카페 새로 생겼는데 (이름이 'Munjeong Roastery')
- 핸드드립 4,500원
- 큐브치즈케이크 6,000원
- 좌석 30석 정도, 콘센트 풍부함
- 노트북 작업하기 좋음

추천드려요!`,
    author: "김민수",
    avatarInitial: "김",
    time: "1시간 전",
    timestamp: Date.now() - 65 * 60 * 1000,
    likes: 18,
    views: 92,
    comments: [
      { id: "c1", author: "박지인", initial: "박", body: "오 가봐야겠네요!", time: "55분 전", likes: 3 },
      { id: "c2", author: "이서연", initial: "이", body: "치즈케이크 맛있나요?", time: "50분 전", likes: 1 },
      { id: "c3", author: "김민수", initial: "김", body: "@이서연 진짜 추천드림 ㅋ", time: "45분 전", likes: 2 },
      { id: "c4", author: "최지우", initial: "최", body: "좌석 정보 감사요", time: "30분 전", likes: 0 },
    ],
  },
  {
    id: "p8",
    category: "anon",
    title: "야근 너무 많은 거 아닌가요...",
    body: `진짜 매일 9시 퇴근이 일상이 되어버렸습니다.
다들 비슷한 상황인가요?

특히 이번 분기 들어서 더 심해진 것 같은데
다른 팀은 어떤지 궁금합니다.`,
    author: "익명",
    avatarInitial: "?",
    isAnon: true,
    time: "1일 전",
    timestamp: Date.now() - 26 * 60 * 60 * 1000,
    likes: 42,
    views: 287,
    comments: [
      { id: "c1", author: "익명 1", initial: "?", body: "+1 우리팀도...", time: "1일 전", likes: 12, isAnon: true },
      { id: "c2", author: "익명 2", initial: "?", body: "그래도 우리 회사는 야근 강요는 안 하잖아요", time: "1일 전", likes: 5, isAnon: true },
      { id: "c3", author: "익명 3", initial: "?", body: "PM한테 일정 협상이 필요할 듯", time: "1일 전", likes: 8, isAnon: true },
      { id: "c4", author: "익명 4", initial: "?", body: "이번 프로젝트 끝나면 좀 나아지지 않을까요", time: "1일 전", likes: 3, isAnon: true },
      { id: "c5", author: "익명 5", initial: "?", body: "야근 수당이라도 제대로 챙겨주면 좋겠음", time: "20시간 전", likes: 15, isAnon: true },
    ],
  },
  {
    id: "p9",
    category: "anon",
    title: "회사 커피머신 진짜 답이 없네요",
    body: `매번 고장 나는 거 정상인가요?
이번 주만 3번째 고장입니다.

새로 사주시면 안 되나요...`,
    author: "익명",
    avatarInitial: "?",
    isAnon: true,
    time: "2일 전",
    timestamp: Date.now() - 50 * 60 * 60 * 1000,
    likes: 31,
    views: 198,
    comments: [
      { id: "c1", author: "익명 1", initial: "?", body: "ㅋㅋㅋㅋ 진짜 동의", time: "2일 전", likes: 18, isAnon: true },
      { id: "c2", author: "익명 2", initial: "?", body: "1층 가서 사먹는 게 빠를 듯", time: "2일 전", likes: 4, isAnon: true },
    ],
  },
  {
    id: "p10",
    category: "free",
    title: "오늘 점심 추천 좀 부탁드려요",
    body: `오늘 메뉴 고르기 힘들어서요.
한식 / 일식 / 분식 다 좋습니다.`,
    author: "최지우",
    avatarInitial: "최",
    time: "3시간 전",
    timestamp: Date.now() - 3 * 60 * 60 * 1000,
    likes: 6,
    views: 54,
    comments: [
      { id: "c1", author: "박지인", initial: "박", body: "가나순두부 가셈", time: "2시간 전", likes: 4 },
      { id: "c2", author: "김민수", initial: "김", body: "지인고기 점심 메뉴도 괜찮음", time: "2시간 전", likes: 3 },
    ],
  },
  {
    id: "p11",
    category: "review",
    title: "맥북 충전기 거래 — 김민수님 진짜 감사합니다",
    body: `맥북 충전기 65W 잘 받았습니다.
새 거나 다름없고, 가격도 시중가 절반이라 너무 좋네요.

거래도 5층 휴게실에서 5분 만에 끝났어요.
김민수님 추천합니다!`,
    author: "박지인",
    avatarInitial: "박",
    time: "1일 전",
    timestamp: Date.now() - 27 * 60 * 60 * 1000,
    likes: 3,
    views: 24,
    comments: [
      { id: "c1", author: "김민수", initial: "김", body: "감사합니다 잘 쓰세요!", time: "1일 전", likes: 1 },
    ],
  },
  {
    id: "p12",
    category: "anon",
    title: "신입 분들 적응 꿀팁",
    body: `1년차 후배가 적응 어려워하길래 정리해봅니다.

1. 슬랙 채널 다 입장하기 (특히 #lunch)
2. 식권대장 앱 회사 메일로 가입
3. 5층 라운지 11시 50분 ~ 12시 5분 사이 가면 점심 메이트 자동 매칭
4. 매주 금요일 4시 간식타임 절대 놓치지 말 것

이거 알면 첫 달 적응 쉬워요`,
    author: "익명",
    avatarInitial: "?",
    isAnon: true,
    time: "어제",
    timestamp: Date.now() - 24 * 60 * 60 * 1000,
    likes: 19,
    views: 134,
    comments: [
      { id: "c1", author: "익명 1", initial: "?", body: "감사합니다 진짜 도움 많이 됐어요", time: "어제", likes: 3, isAnon: true },
      { id: "c2", author: "익명 2", initial: "?", body: "4시 간식타임 ㄹㅇ 못 놓침", time: "어제", likes: 7, isAnon: true },
    ],
  },
];

function escBoard(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function loadBoardUserPosts() {
  try {
    const raw = localStorage.getItem(BOARD_USER_POSTS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch { return []; }
}
function saveBoardUserPosts(arr) {
  try { localStorage.setItem(BOARD_USER_POSTS_KEY, JSON.stringify(arr)); } catch {}
}
function loadBoardLikes() {
  try { return JSON.parse(localStorage.getItem(BOARD_LIKES_KEY) || "{}"); }
  catch { return {}; }
}
function saveBoardLikes(obj) {
  try { localStorage.setItem(BOARD_LIKES_KEY, JSON.stringify(obj)); } catch {}
}
function loadBoardUserComments() {
  try { return JSON.parse(localStorage.getItem(BOARD_USER_COMMENTS_KEY) || "{}"); }
  catch { return {}; }
}
function saveBoardUserComments(obj) {
  try { localStorage.setItem(BOARD_USER_COMMENTS_KEY, JSON.stringify(obj)); } catch {}
}

let boardUserPosts = loadBoardUserPosts();
let boardLikes = loadBoardLikes();
let boardUserComments = loadBoardUserComments();

const boardState = { filter: "all", query: "", currentPostId: null };

function allBoardPosts() {
  // User posts first (newest), then seed posts; pinned still stays on top
  return [...boardUserPosts, ...SEED_POSTS];
}

function findPost(id) {
  return allBoardPosts().find((p) => p.id === id);
}

function relativeTime(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일 전`;
  return new Date(ts).toLocaleDateString("ko-KR");
}

function isLiked(postId) {
  return !!boardLikes[postId];
}
function likeCountOf(post) {
  return (post.likes || 0) + (isLiked(post.id) ? 1 : 0);
}
function commentsOf(post) {
  const extra = boardUserComments[post.id] || [];
  return [...(post.comments || []), ...extra];
}

function filteredPosts() {
  const q = boardState.query.trim().toLowerCase();
  const arr = allBoardPosts().filter((p) => {
    if (boardState.filter !== "all" && p.category !== boardState.filter) return false;
    if (!q) return true;
    return (
      p.title.toLowerCase().includes(q) ||
      p.body.toLowerCase().includes(q) ||
      (p.author || "").toLowerCase().includes(q)
    );
  });
  // pinned posts first, then by timestamp desc
  arr.sort((a, b) => {
    const ap = a.pinned ? 1 : 0;
    const bp = b.pinned ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return (b.timestamp || 0) - (a.timestamp || 0);
  });
  return arr;
}

function renderBoardList() {
  const listEl = document.getElementById("boardList");
  if (!listEl) return;
  const items = filteredPosts();
  if (!items.length) {
    listEl.innerHTML = `<li class="board-empty">📭 게시글이 없어요. 첫 글을 작성해보세요!</li>`;
    return;
  }
  listEl.innerHTML = items.map((p) => {
    const tagCls = BOARD_TAG_CLASS[p.category] || "tag-free";
    const tagLabel = BOARD_CATEGORY_LABEL[p.category] || "💬 자유";
    const liked = isLiked(p.id);
    const likes = likeCountOf(p);
    const comments = commentsOf(p).length;
    const isMine = !!p.isUserPost;
    const isAnonAuthor = !!p.isAnon || p.category === "anon";
    const time = p.timestamp ? relativeTime(p.timestamp) : (p.time || "");
    const lunchMeta = p.lunch
      ? `<span class="board-lunch-meta ${p.lunch.current >= p.lunch.total ? "is-full" : ""}">
           ${p.lunch.current >= p.lunch.total ? "마감" : `${p.lunch.current}/${p.lunch.total}`}
         </span>`
      : "";
    const pinned = p.pinned ? `<span class="post-pin-badge">📌 고정</span>` : "";
    const classList = [
      "board-card",
      p.pinned ? "is-pinned" : "",
      isMine ? "is-mine" : "",
    ].filter(Boolean).join(" ");
    return `
      <li>
        <button type="button" class="${classList}" data-post-id="${escBoard(p.id)}">
          <div class="post-card-top">
            <span class="post-tag ${tagCls}">${escBoard(tagLabel)}</span>
            ${pinned}
            ${lunchMeta}
          </div>
          <h3>${escBoard(p.title)}</h3>
          <p class="preview">${escBoard(p.body.replace(/\n+/g, " "))}</p>
          <div class="post-card-foot">
            <span class="post-author-mini">
              <span class="post-avatar-mini ${isAnonAuthor ? "is-anon" : ""}">${escBoard(p.avatarInitial || "?")}</span>
              <strong>${escBoard(p.author || "익명")}</strong>
            </span>
            <span>${escBoard(time)}</span>
            <span class="post-card-stats">
              <span class="${liked ? "stat-liked" : ""}">${liked ? "❤️" : "🤍"} ${likes}</span>
              <span>💬 ${comments}</span>
              <span>👁️ ${p.views ?? 0}</span>
            </span>
          </div>
        </button>
      </li>
    `;
  }).join("");
}

function updateBoardSub() {
  const sub = document.getElementById("boardHeroSub");
  if (!sub) return;
  const total = allBoardPosts().length;
  sub.textContent = `${total}개의 게시글 · 공지 · 자유 · 익명 · 점심 모집`;
}

// ----- Detail modal -----
const postDetailModal = document.getElementById("postDetailModal");
const postDetailClose = document.getElementById("postDetailClose");

function openPostDetail(postId) {
  const p = findPost(postId);
  if (!p || !postDetailModal) return;
  boardState.currentPostId = postId;
  // increment view (visual only — for seed posts the view counter is per-session)
  p.views = (p.views || 0) + 1;

  const tagEl = document.getElementById("postDetailTag");
  if (tagEl) {
    tagEl.className = `post-tag ${BOARD_TAG_CLASS[p.category] || "tag-free"}`;
    tagEl.textContent = BOARD_CATEGORY_LABEL[p.category] || "💬 자유";
  }
  const authorEl = document.getElementById("postDetailAuthor");
  if (authorEl) authorEl.textContent = p.author || "익명";
  const timeEl = document.getElementById("postDetailTime");
  if (timeEl) timeEl.textContent = p.timestamp ? relativeTime(p.timestamp) : (p.time || "");
  const avatarEl = document.getElementById("postDetailAvatar");
  if (avatarEl) {
    avatarEl.textContent = p.avatarInitial || "?";
    avatarEl.className = `post-avatar ${p.isAnon || p.category === "anon" ? "is-anon" : ""}`;
  }
  const titleEl = document.getElementById("postDetailTitle");
  if (titleEl) titleEl.textContent = p.title;
  const bodyEl = document.getElementById("postDetailBody");
  if (bodyEl) bodyEl.textContent = p.body;

  // Like state
  const liked = isLiked(p.id);
  const likeBtn = document.getElementById("postLikeBtn");
  const likeIcon = document.getElementById("postLikeIcon");
  const likeCount = document.getElementById("postLikeCount");
  if (likeBtn) likeBtn.classList.toggle("is-liked", liked);
  if (likeIcon) likeIcon.textContent = liked ? "❤️" : "🤍";
  if (likeCount) likeCount.textContent = String(likeCountOf(p));

  // Comments
  const comments = commentsOf(p);
  const commentsCount = document.getElementById("postCommentsCount");
  if (commentsCount) commentsCount.textContent = String(comments.length);
  const commentsMeta = document.getElementById("postCommentsMeta");
  if (commentsMeta) commentsMeta.textContent = String(comments.length);
  const viewsMeta = document.getElementById("postViewsMeta");
  if (viewsMeta) viewsMeta.textContent = String(p.views ?? 0);

  const commentsList = document.getElementById("postCommentsList");
  if (commentsList) {
    if (!comments.length) {
      commentsList.innerHTML = `<li class="post-comments-empty">아직 댓글이 없어요. 첫 댓글을 남겨보세요.</li>`;
    } else {
      commentsList.innerHTML = comments.map((c) => {
        const mine = !!c.isMine;
        const anon = !!c.isAnon || (c.author || "").startsWith("익명");
        return `
          <li class="post-comment ${mine ? "is-mine" : ""}">
            <div class="post-comment-top">
              <span class="post-avatar-mini ${anon ? "is-anon" : ""}">${escBoard(c.initial || "?")}</span>
              <strong>${escBoard(c.author || "익명")}</strong>
              <span>${escBoard(c.time || "")}</span>
            </div>
            <div class="post-comment-body">${escBoard(c.body || "")}</div>
          </li>
        `;
      }).join("");
    }
  }

  postDetailModal.hidden = false;
  document.body.classList.add("modal-open");
  // Re-render board list to reflect new view count
  renderBoardList();
}

function closePostDetail() {
  if (!postDetailModal) return;
  postDetailModal.hidden = true;
  document.body.classList.remove("modal-open");
  boardState.currentPostId = null;
}

const boardListEl = document.getElementById("boardList");
const boardFilterEl = document.getElementById("boardFilter");
const boardSearchInput = document.getElementById("boardSearchInput");

if (boardListEl) {
  boardListEl.addEventListener("click", (event) => {
    const card = event.target.closest("[data-post-id]");
    if (!card) return;
    openPostDetail(card.dataset.postId);
  });
}

if (boardFilterEl) {
  boardFilterEl.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-board-filter]");
    if (!btn) return;
    boardState.filter = btn.dataset.boardFilter || "all";
    for (const c of boardFilterEl.querySelectorAll(".chat-chip")) {
      c.classList.toggle("is-active", c === btn);
    }
    renderBoardList();
  });
}

if (boardSearchInput) {
  boardSearchInput.addEventListener("input", () => {
    boardState.query = boardSearchInput.value;
    renderBoardList();
  });
}

if (postDetailClose) postDetailClose.addEventListener("click", closePostDetail);
if (postDetailModal) {
  postDetailModal.addEventListener("click", (event) => {
    if (event.target === postDetailModal) closePostDetail();
  });
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && postDetailModal && !postDetailModal.hidden) {
    closePostDetail();
  }
});

// Like toggle
const postLikeBtn = document.getElementById("postLikeBtn");
if (postLikeBtn) {
  postLikeBtn.addEventListener("click", () => {
    const id = boardState.currentPostId;
    if (!id) return;
    boardLikes[id] = !boardLikes[id];
    saveBoardLikes(boardLikes);
    const p = findPost(id);
    if (p) {
      const liked = isLiked(id);
      postLikeBtn.classList.toggle("is-liked", liked);
      const ico = document.getElementById("postLikeIcon");
      if (ico) ico.textContent = liked ? "❤️" : "🤍";
      const cnt = document.getElementById("postLikeCount");
      if (cnt) cnt.textContent = String(likeCountOf(p));
    }
    renderBoardList();
  });
}

// Comment submit
const postCommentForm = document.getElementById("postCommentForm");
const postCommentInput = document.getElementById("postCommentInput");
if (postCommentForm) {
  postCommentForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const id = boardState.currentPostId;
    const text = (postCommentInput?.value || "").trim();
    if (!id || !text) return;
    const p = findPost(id);
    if (!p) return;
    const anon = p.category === "anon";
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const comment = {
      id: `uc${Date.now()}`,
      author: anon ? "익명 (나)" : "준호 배",
      initial: anon ? "?" : "준",
      body: text,
      time: `방금 ${timeStr}`,
      likes: 0,
      isMine: true,
      isAnon: anon,
    };
    if (!boardUserComments[id]) boardUserComments[id] = [];
    boardUserComments[id].push(comment);
    saveBoardUserComments(boardUserComments);
    if (postCommentInput) postCommentInput.value = "";
    openPostDetail(id); // re-render
  });
}

// ----- Compose modal -----
const composeModal = document.getElementById("composeModal");
const composeModalClose = document.getElementById("composeModalClose");
const composeCancel = document.getElementById("composeCancel");
const composeForm = document.getElementById("composeForm");
const boardNewBtn = document.getElementById("boardNewBtn");

function openComposeModal() {
  if (!composeModal) return;
  composeModal.hidden = false;
  document.body.classList.add("modal-open");
  document.getElementById("composeTitle")?.focus();
}
function closeComposeModal() {
  if (!composeModal) return;
  composeModal.hidden = true;
  document.body.classList.remove("modal-open");
}

if (boardNewBtn) boardNewBtn.addEventListener("click", openComposeModal);
if (composeModalClose) composeModalClose.addEventListener("click", closeComposeModal);
if (composeCancel) composeCancel.addEventListener("click", closeComposeModal);
if (composeModal) {
  composeModal.addEventListener("click", (event) => {
    if (event.target === composeModal) closeComposeModal();
  });
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && composeModal && !composeModal.hidden) {
    closeComposeModal();
  }
});

if (composeForm) {
  composeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const category = document.getElementById("composeCategory")?.value || "free";
    const title = (document.getElementById("composeTitle")?.value || "").trim();
    const body = (document.getElementById("composeBody")?.value || "").trim();
    if (!title || !body) return;
    const anon = category === "anon";
    const post = {
      id: `up${Date.now()}`,
      category,
      title,
      body,
      author: anon ? "익명" : "준호 배",
      avatarInitial: anon ? "?" : "준",
      isAnon: anon,
      isUserPost: true,
      timestamp: Date.now(),
      time: "방금",
      likes: 0,
      views: 1,
      comments: [],
    };
    boardUserPosts = [post, ...boardUserPosts];
    saveBoardUserPosts(boardUserPosts);
    // Clear form
    if (document.getElementById("composeTitle")) document.getElementById("composeTitle").value = "";
    if (document.getElementById("composeBody")) document.getElementById("composeBody").value = "";
    closeComposeModal();
    renderBoardList();
    updateBoardSub();
    showToast("✅ 글이 게시됐어요");
  });
}

renderBoardList();
updateBoardSub();

// Initial routing
activateTab(readHashTab());
