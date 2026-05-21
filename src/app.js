import { getCurrentMeal, recommendMeals, summarizeDataHealth } from "./recommender.js?v=20260521-6";

const state = {
  meal: getCurrentMeal(new Date()),
  preferences: new Set(),
  restaurants: [],
  pickIndex: 0,
  hasPicked: false,
  mode: "quick",
  lastRecommendations: [],
};

const preferenceOptions = [
  { id: "korean", label: "한식" },
  { id: "light", label: "가볍게" },
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
  render();
}

function reroll() {
  state.pickIndex += 1;
  state.hasPicked = true;
  render();
}

function setMode(mode) {
  state.mode = mode;
  render();
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
  if (!state.hasPicked) {
    target.classList.add("is-idle");
    target.innerHTML = `
      <div class="pick-meta">
        <span>${state.meal === "lunch" ? "점심" : "저녁"} 준비</span>
        <span>${modeLabel(state.mode)}</span>
      </div>
      <h2>뭐 고르세요?</h2>
      <p class="restaurant-name">아래 버튼을 누르면 메뉴를 하나 골라드릴게요.</p>
      <p class="reason">취향 필터와 선택 방식을 먼저 고르면 더 그럴듯하게 골라집니다.</p>
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
  target.innerHTML = `
    <div class="pick-meta">
      <span>${badgeText(item)}</span>
      <span>${item.distanceM}m</span>
      <span>${ratingText(item)}</span>
    </div>
    <h2>${item.menu}</h2>
    <p class="restaurant-name">${item.name}</p>
    <p class="reason">${item.reason}</p>
    <div class="detail-grid">
      <span>${item.category}</span>
      <span>${item.priceBand}</span>
      <span>${bestFor.slice(0, 3).join(" · ")}</span>
    </div>
  `;
}

function renderCandidate(item) {
  const article = document.createElement("article");
  article.className = "candidate-card";
  article.innerHTML = `
    <div>
      <h3>${item.menu}</h3>
      <p>${item.name} · ${item.category}</p>
    </div>
    <div class="candidate-side">
      <span>${item.distanceM}m</span>
      <span>${ratingText(item)}</span>
      <strong>${badgeText(item)}</strong>
    </div>
  `;
  return article;
}

function badgeText(item) {
  if (item.sikgwonStatus === "confirmed") return "식권 확인";
  if (item.sikgwonStatus === "candidate") return "가맹 후보";
  return "확인 필요";
}

function ratingText(item) {
  if (typeof item.kakaoRating === "number") {
    return `카카오 ★ ${item.kakaoRating.toFixed(1)}`;
  }
  return "카카오 ★ 확인중";
}

function modeLabel(mode) {
  if (mode === "ladder") return "사다리";
  if (mode === "roulette") return "룰렛";
  return "바로 고르기";
}

function renderGameStage(recommendations) {
  const stage = $("#gameStage");
  const items = recommendations.slice(0, 5);
  if (!state.hasPicked) {
    stage.innerHTML = `<p>선택 방식을 고르고 하단 버튼을 눌러주세요.</p>`;
    return;
  }
  if (!items.length) {
    stage.innerHTML = `<p>표시할 후보가 없습니다.</p>`;
    return;
  }
  if (state.mode === "ladder") {
    stage.innerHTML = renderLadder(items);
    return;
  }
  if (state.mode === "roulette") {
    stage.innerHTML = renderRoulette(items);
    return;
  }
  stage.innerHTML = `<p><strong>${items[0].menu}</strong>로 바로 골랐습니다.</p>`;
}

function renderLadder(items) {
  const lanes = items
    .map(
      (item, index) => `
        <div class="ladder-lane ${index === 0 ? "is-winner" : ""}">
          <span>${item.menu}</span>
          <i></i>
          <b>${index === 0 ? "당첨" : "후보"}</b>
        </div>
      `,
    )
    .join("");
  return `<div class="ladder-board">${lanes}</div>`;
}

function renderRoulette(items) {
  const chips = items
    .map(
      (item, index) => `
        <span class="roulette-chip ${index === 0 ? "is-winner" : ""}">${item.menu}</span>
      `,
    )
    .join("");
  return `<div class="roulette-board">${chips}</div>`;
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
  state.lastRecommendations = recommendations;
  renderStatus(recommendations);
  renderTopPick(recommendations[0]);
  renderGameStage(recommendations);
  $("#candidateCount").textContent = `${recommendations.length}곳`;
  const list = $("#candidateList");
  list.innerHTML = "";
  for (const item of recommendations.slice(1, 8)) {
    list.append(renderCandidate(item));
  }
}

$("#lunchButton").addEventListener("click", () => setMeal("lunch"));
$("#dinnerButton").addEventListener("click", () => setMeal("dinner"));
$("#refreshButton").addEventListener("click", reroll);
$("#chooseButton").addEventListener("click", reroll);
for (const button of document.querySelectorAll(".mode-button")) {
  button.addEventListener("click", () => setMode(button.dataset.mode));
}
$("#clearFiltersButton").addEventListener("click", () => {
  state.preferences.clear();
  state.pickIndex = 0;
  state.hasPicked = false;
  render();
});

syncMealButtons();
syncModeButtons();
$("#statusStrip").textContent = "가맹점 데이터를 불러오는 중입니다.";
loadRestaurants().catch(() => {
  $("#statusStrip").textContent = "가맹점 데이터를 불러오지 못했습니다.";
});
