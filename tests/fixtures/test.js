import { test as base, expect } from '@playwright/test';
import { HeaderComponent } from '../pages/header-component.js';
import { HomePage } from '../pages/home-page.js';
import { LoginPage } from '../pages/login-page.js';
import { ProductsPage } from '../pages/products-page.js';
import { SignupPage } from '../pages/signup-page.js';

/**
 * Project-wide test fixture. Every spec imports `test` and `expect` from here, never directly
 * from '@playwright/test', so shared behaviour lives in one place.
 *
 * - `healingEvidence` (auto): on failure, attaches an ARIA snapshot of the page as
 *   `healing-aria-snapshot`. The failure classifier uses it to confirm whether the intended
 *   element still exists under a different accessible identity before any locator repair.
 * - Page Object fixtures: register each Page Object below so specs receive ready instances
 *   (`async ({ loginPage }) => ...`) and never construct them by hand.
 */
export const test = base.extend({
  healingEvidence: [
    async ({ page }, use, testInfo) => {
      await use();
      if (testInfo.status === testInfo.expectedStatus || page.isClosed()) return;
      try {
        const snapshot = await page.locator('body').ariaSnapshot({ timeout: 2_000 });
        await testInfo.attach('healing-aria-snapshot', { body: snapshot, contentType: 'text/yaml' });
        await testInfo.attach('healing-page-url', { body: page.url(), contentType: 'text/plain' });
      } catch {
        // Evidence is best effort; a missing snapshot makes the classifier more conservative.
      }
    },
    { auto: true },
  ],

  header: async ({ page }, use) => {
    await use(new HeaderComponent(page));
  },
  homePage: async ({ page }, use) => {
    await use(new HomePage(page));
  },
  productsPage: async ({ page }, use) => {
    await use(new ProductsPage(page));
  },
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  signupPage: async ({ page }, use) => {
    await use(new SignupPage(page));
  },
});

export { expect };
