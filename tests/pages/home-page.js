import { BasePage } from './base-page.js';

export class HomePage extends BasePage {
  static path = '/';

  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    super(page);
    this.createAccountLink = page.getByRole('link', { name: 'Create an account' });
  }

  async openCreateAccount() {
    await this.createAccountLink.click();
  }
}
