/**
 * Explicit "app is interactive" wait, independent of the target site.
 *
 * Server-rendered apps (Next.js, Nuxt, Angular SSR, …) show complete HTML before their JavaScript
 * attaches event handlers (hydration). Playwright's actionability checks pass on that HTML, so a
 * click can land on a button that has no handler yet and silently do nothing. The `load` event is
 * not enough: React hydration was observed to finish after it on the default target.
 *
 * This waits for the framework's own "hydrated" signal. Unknown or client-only apps resolve
 * immediately. Never replace this with `waitForTimeout`.
 */

/**
 * Runs in the browser. True once every detected framework reports the page as interactive.
 * - React (incl. Next.js): every visible interactive control inside the React root carries a fiber key.
 * - Vue 3 / Nuxt: the app is mounted (`__vue_app__` on the mount element).
 * - Angular: all testabilities are stable.
 */
function isAppInteractive() {
  const controls = Array.from(document.querySelectorAll('button, input, select, textarea, a[href], [role="button"]'))
    .filter((el) => el.getClientRects().length > 0);

  const hasReactKey = (el) => Object.keys(el).some((k) => k.startsWith('__reactFiber$'));
  const reactRendered = Boolean(window.next || window.__NEXT_DATA__ || document.getElementById('__next')
    || document.querySelector('[data-reactroot]') || controls.some(hasReactKey));
  if (reactRendered && controls.some((el) => !hasReactKey(el))) return false;

  const nuxt = Boolean(window.__NUXT__ || document.getElementById('__nuxt'));
  if (nuxt && !document.querySelector('[data-v-app]')?.__vue_app__ && !document.getElementById('__nuxt')?.__vue_app__) return false;

  if (typeof window.getAllAngularTestabilities === 'function') {
    return window.getAllAngularTestabilities().every((t) => t.isStable());
  }
  return true;
}

/**
 * Wait until the current document is loaded and hydrated.
 * @param {import('@playwright/test').Page} page
 * @param {{ timeout?: number }} [options] defaults to the navigation timeout
 */
export async function waitForAppReady(page, { timeout } = {}) {
  await page.waitForLoadState('load', { timeout });
  await page.waitForFunction(isAppInteractive, undefined, { timeout, polling: 100 });
}
