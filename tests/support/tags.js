/**
 * Test tags used for scoping runs (`--grep @smoke`). Use these constants in `test(..., { tag })`
 * so tag names stay consistent across specs.
 */
export const TAG = Object.freeze({
  SMOKE: '@smoke',
  REGRESSION: '@regression',
  AUTH: '@auth',
  CART: '@cart',
  CHECKOUT: '@checkout',
  NAVIGATION: '@navigation',
});
