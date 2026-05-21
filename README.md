# 엔키 오늘 뭐 먹지

엔키화이트햇 문정동 근무자가 점심/저녁 식사 시간에 모바일 웹에서 바로 메뉴를 추천받는 정적 웹앱입니다.

## 현재 구조

- `index.html`: GitHub Pages로 바로 배포 가능한 모바일 웹앱
- `src/recommender.js`: 웹앱과 향후 Slack bot이 같이 쓸 추천 엔진
- `data/restaurants.json`: 문정역테라타워/문정법조타운 주변 식당 후보와 식권대장 가맹 확인 상태
- `.github/workflows/pages.yml`: GitHub Pages 자동 배포

## 운영 데이터 원칙

식권대장 공식 API가 제공되지 않거나 접근할 수 없으면 `data/restaurants.json`을 주기적으로 갱신합니다.

- `sikgwonStatus: "confirmed"`: 식권대장 가맹 확인 완료
- `sikgwonStatus: "candidate"`: 주변 식당 후보, 가맹 여부 확인 필요
- `sikgwonStatus: "excluded"`: 추천 제외

운영 전에는 식권대장 앱/관리자에서 실제 가맹 여부를 확인한 뒤 `confirmed`로 바꾸는 것을 권장합니다.

## GitHub Pages 배포

1. 이 폴더를 GitHub 저장소로 push합니다.
2. 저장소 Settings > Pages에서 Source를 GitHub Actions로 설정합니다.
3. `main` 브랜치에 push하면 `.github/workflows/pages.yml`이 배포합니다.

정적 사이트라 API 토큰은 포함하지 않습니다. 식권대장 공식 API 토큰이 필요한 경우에는 GitHub Pages가 아니라 서버리스 함수 또는 별도 백엔드를 붙여야 합니다.

## Slack bot 확장 방향

Slack bot은 `src/recommender.js`의 추천 로직과 `data/restaurants.json`을 재사용하도록 구현합니다.

권장 명령:

- `/lunch`: 점심 추천
- `/dinner`: 저녁 추천
- `/menu spicy`: 매콤한 메뉴 추천

토큰과 Slack signing secret은 GitHub에 커밋하지 말고 배포 플랫폼 secrets에 저장합니다.
