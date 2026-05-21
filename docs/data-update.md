# Restaurant Data Update

Update `data/restaurants.json` whenever the 식권대장 가맹점 list changes.

## Manual Update Steps

1. Open the 식권대장 app/admin page and check usable stores around 문정역테라타워.
2. For each store, update:
   - `sikgwonStatus`: `confirmed`, `candidate`, or `excluded`
   - `hours`
   - `meals`
   - `menus`
   - `active`
3. Set `updatedAt` to the update date.
4. Open the homepage and confirm the top recommendation still renders.

## Data Rule

Only `confirmed` means "식권대장 가맹 확인". Use `candidate` for nearby restaurants that still need verification.
