import { BasePage } from './base-page.js';

export class LoginPage extends BasePage {
  static path = '/login';

  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    super(page);
    this.heading = page.getByRole('heading', { level: 1, name: 'Log in' });
    this.emailInput = page.getByRole('textbox', { name: 'Email' });
    this.passwordInput = page.getByRole('textbox', { name: 'Password', exact: true });
    this.passwordToggle = page.getByRole('button', { name: /^(Show|Hide) password$/ });
    this.submitButton = page.getByRole('button', { name: 'Log in' });
    this.errorMessage = page.getByRole('main').getByRole('alert');
    this.signupSuccessNotice = page.getByText('Account created. Check your email to confirm, then log in.');
    this.signupLink = page.getByRole('main').getByRole('link', { name: 'Sign up' });
  }

  /** @param {{ email?: string, password?: string }} values empty/omitted fields are left blank */
  async fillForm({ email = '', password = '' }) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
  }

  async submit() {
    await this.submitButton.click();
  }

  /** @param {{ email?: string, password?: string }} credentials */
  async login(credentials) {
    await this.fillForm(credentials);
    await this.submit();
  }

  async togglePasswordVisibility() {
    await this.passwordToggle.click();
  }

  async openSignupFromForm() {
    await this.signupLink.click();
  }
}
