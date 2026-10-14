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
   * Navigate to this page (relative to baseURL) and wait for the DOM to be ready.
   * @param {string} [path]
   */
  async goto(path = /** @type {typeof BasePage} */ (this.constructor).path) {
    await this.page.goto(path, { waitUntil: 'domcontentloaded' });
  }
}
