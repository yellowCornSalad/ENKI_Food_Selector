# Slack Bot Extension

The Slack bot should reuse the same recommendation inputs as the website:

- `data/restaurants.json`
- `src/recommender.js`

## Suggested Commands

- `/lunch`: recommend lunch.
- `/dinner`: recommend dinner.
- `/menu spicy`: recommend with preference tags.
- `/menu team`: recommend a team-friendly place.

## Runtime Shape

Use a server-side runtime because Slack signing secrets and bot tokens must not be exposed in browser code.

Recommended deployment options:

- Cloudflare Workers
- Vercel Functions
- Netlify Functions
- Render/Fly.io small Node service

## Secrets

Keep these in the deployment platform secrets, never in Git:

- `SLACK_SIGNING_SECRET`
- `SLACK_BOT_TOKEN`
- Optional future `SIKGWON_API_TOKEN`

## Response Format

Return one decisive top pick plus two backups:

```text
오늘 점심은 소호얼크니샤브칼국수의 샤브칼국수 추천.
가까움 · 식사 시간 영업 정보 있음 · 가맹 여부 확인 필요

후보:
1. 동궁찜닭 - 고추장찜닭
2. 국제보리밥 - 보리밥 정식
```
