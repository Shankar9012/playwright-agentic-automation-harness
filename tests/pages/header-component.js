import { BasePage } from './base-page.js';

/**
 * Site header (banner landmark), shared by every page. Links are scoped to the banner because
 * "Log in" / "Sign up" also appear as form-footer links and submit buttons (docs/locator-map.md).
 */
export class HeaderComponent extends BasePage {
  static path = '/';

  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    super(page);
    this.brandLink = page.getByRole('banner').getByRole('link', { name: 'Demo Shop' });
    this.productsLink = page.getByRole('banner').getByRole('link', { name: 'Products' });
    this.loginLink = page.getByRole('banner').getByRole('link', { name: 'Log in' });
    this.signupLink = page.getByRole('banner').getByRole('link', { name: 'Sign up' });
    this.cartLink = page.getByRole('banner').getByRole('link', { name: 'Cart' });
    this.ordersLink = page.getByRole('banner').getByRole('link', { name: 'Orders' });
    this.profileLink = page.getByRole('banner').getByRole('link', { name: 'Profile' });
    this.logoutButton = page.getByRole('button', { name: 'Log out' });
  }

  async openLogin() {
    await this.loginLink.click();
  }

  async openSignup() {
    await this.signupLink.click();
  }

  async logout() {
    await this.logoutButton.click();
  }
}
