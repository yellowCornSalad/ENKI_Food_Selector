# Restaurant Data Update

Update `data/restaurants.json` whenever the 식권대장 가맹점 list changes.

## Manual Update Steps

1. Open the 식권대장 app/admin page and check usable stores around 문정역테라타워, or export/capture the company store list.
2. For each store, update:
   - `sikgwonStatus`: `confirmed`, `candidate`, or `excluded`
   - `hours`
   - `meals`
   - `menus`
   - `naverRating`: Naver Map rating as a number, only when directly verified
   - `naverReviewCount`: Naver Map visitor/blog review count, only when directly verified
   - `active`
3. Set `updatedAt` to the update date.
4. Open the homepage and confirm the top recommendation still renders.

## Data Rule

Only `confirmed` means "식권대장 가맹 확인". Use `candidate` only for nearby restaurants that still need verification and should not be treated as usable company meal stores.

When rebuilding from screenshots, remove old manual candidates first and add only stores visible in the latest 식권대장 app/admin source.

Only fill `naverRating` or `naverReviewCount` after checking Naver Map directly. If Naver does not expose a numeric rating for that store, leave the rating empty instead of showing a placeholder.
