import { waitForAppReady } from '../support/app-ready.js';

/**
 * Base class for all Page Objects.
 *
 * Conventions (enforced by the healing guardrails):
 * - Define every locator once, in the constructor, as `this.name = page.getBy...(...)`.
 *   This is the only shape the self-healer may rewrite.
 * - Locators are lazy; defining them in the constructor does not touch the page.
 * - Page Objects expose actions and locators; assertions belong in specs.
 */
export class BasePage {
  /** Path relative to baseURL; subclasses override. */
  static path = '/';

  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
  }

  /**
   * Navigate to this page (relative to baseURL) and wait until the app is interactive.
   * @param {string} [path]
   */
  async goto(path = /** @type {typeof BasePage} */ (this.constructor).path) {
    await this.page.goto(path, { waitUntil: 'load' });
    await this.waitForReady();
  }

  /**
   * Explicit readiness wait: page loaded and hydrated, so clicks reach real event handlers.
   * Call it after any full-document navigation that does not go through `goto()` (reload,
   * form post, hard redirect). Client-side route changes keep the app hydrated and need no call.
   */
  async waitForReady() {
    await waitForAppReady(this.page);
  }

  /**
   * Native constraint-validation state of a form control (browser/locale independent, unlike the
   * validation bubble text). Returns a plain snapshot of ValidityState.
   * @param {import('@playwright/test').Locator} field
   * @returns {Promise<{ valid: boolean, valueMissing: boolean, typeMismatch: boolean, tooShort: boolean }>}
   */
  async validityOf(field) {
    return field.evaluate((el) => {
      const v = /** @type {HTMLInputElement} */ (el).validity;
      return { valid: v.valid, valueMissing: v.valueMissing, typeMismatch: v.typeMismatch, tooShort: v.tooShort };
    });
  }
}
