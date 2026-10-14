import { BasePage } from './base-page.js';

export class ProductsPage extends BasePage {
  static path = '/products';

  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    super(page);
    this.heading = page.getByRole('heading', { level: 1, name: 'Products' });
  }
}
