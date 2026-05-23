# 🍱 엔키 — 오늘 뭐 먹지

엔키화이트햇 문정동 근무자 전용 사내 점심·중고거래 모바일 웹앱.
점심 추천부터 사다리·룰렛·핀볼 미니게임, 사내 거래까지 한 화면에서.

<p align="center">
  <img src="./assets/screenshots/home.png" alt="ENKI 오늘 뭐 먹지 — 홈 화면" width="340" />
</p>

> 🌐 라이브: <https://yellowcornsalad.github.io/ENKI_Food_Selector/>

---

## v1.1 — 주요 기능

### 🏠 홈
- 다크 인디고 hero + 황금 포인트 + CARTO Dark 지도 (엔키 본사 핀 펄스)
- 실시간 **점심/저녁 카운트다운**, **문정동 날씨**, 가맹점 수
- 메뉴/가맹점/동료 통합 검색 → 메뉴 탭으로 점프
- 빠른 진입 카드 (오늘의 추천 · 같이 갈 사람 · 식대) + 최근 소식 + 인기 가맹점 가로 스크롤

### 🍱 메뉴
- **식권대장 가맹점 190곳** 통합 (네이버 메뉴·별점·리뷰 약 140곳)
- 취향 칩: 한식 · 중식 · 양식 · 일식 · 다이어트 · 빠르게 · 팀 식사 · 커피/음료
- 미니게임 **4종** — 모두 사용자 메뉴 직접 입력
  - **바로**: 자동 추천
  - **사다리타기**: 가로 막대 점진 노출 (5초)
  - **룰렛**: 경계 멈춤 + 막대 동기 감속
  - **핀볼**: matter.js 멀티 마블 레이스 (첫 도달 winner)
- **12,000원 식대** 기준 메뉴 추천 + 초과 가격 빨강 표시
- 가맹점 카드 펼침 → 네이버 메뉴/가격/별점 + 네이버 지도 검색 링크
- 가맹점 실시간 검색 (이름/카테고리/메뉴)

### 💰 거래 *(UI 시안)*
- 사내 중고거래 — 당근 톤 (`#ff6f0f` 그라데이션)
- 카테고리 칩 + 검색 + 상품 카드 (판매중/예약중/나눔/거래완료)
- 백엔드(이미지 업로드·채팅·좋아요)는 **1.2 버전**에서

### 💬 소통 *(개발 예정)*
- 사내 게시판 · 점심 모집글 · 1:1/그룹 채팅

### 🙋 마이
- 프로필 + 즐겨찾기/방문기록/알림/식대 정보 *(준비 중)*

---

## 기술 스택

- **Vanilla JS modules** — 빌드 없는 정적 SPA
- **GitHub Pages** + Actions 자동 배포
- **matter.js** — 핀볼 물리 시뮬레이션
- **CARTO Dark Basemap** — 홈 hero 지도
- **Open-Meteo** — 문정동 실시간 날씨
- **Playwright** — Naver Place 자동 placeId 매핑 (스크립트)

## 디렉토리

```
index.html                  메인 페이지 (4탭 SPA)
src/
  app.js                    상태 / 라우팅 / 렌더
  recommender.js            추천 엔진 (점수 · 식대 · 매칭)
  marble-race.js            matter.js 핀볼 시뮬레이션
  styles.css                전체 스타일
data/restaurants.json       식권대장 + Naver 통합 데이터
assets/map-tiles/           CARTO Dark 지도 타일 (문정역 3×3)
assets/screenshots/         README용 캡처
scripts/                    데이터 풍부화 / 크롤링 / 캡처
.github/workflows/pages.yml GitHub Pages 자동 배포
```

## 브랜치 / 태그

| 이름 | 용도 |
|---|---|
| `main` | 자동 배포 |
| `1.1v` | v1.1 개발 (현재) |
| `1.0v` / `v1.0` | v1.0 sealing snapshot |

## 로컬에서 실행

```bash
# 정적 서버 (포트 8000)
python -m http.server 8000
# 또는
npx http-server -p 8000
```

브라우저에서 <http://localhost:8000>.
ES module 때문에 `file://`로 바로 열면 일부 기능 동작 안 함 — 반드시 서버 경유.

## 데이터 풍부화

```bash
# Naver Place 매핑 (Playwright + 좌표 검증)
node scripts/playwright-relink.js

# 메뉴/리뷰 fetch
node scripts/fetch-naver-menus.js withId
```

---

## Made by 준호 배
