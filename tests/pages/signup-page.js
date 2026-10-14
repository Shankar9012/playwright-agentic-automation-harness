import { BasePage } from './base-page.js';

export class SignupPage extends BasePage {
  static path = '/signup';

  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    super(page);
    this.heading = page.getByRole('heading', { level: 1, name: 'Create your account' });
    this.fullNameInput = page.getByRole('textbox', { name: 'Full name' });
    this.emailInput = page.getByRole('textbox', { name: 'Email' });
    this.passwordInput = page.getByRole('textbox', { name: 'Password', exact: true });
    this.confirmPasswordInput = page.getByRole('textbox', { name: /confirm/i });
    this.formTextboxes = page.getByRole('main').getByRole('textbox');
    this.showPasswordButton = page.getByRole('button', { name: 'Show password' });
    this.submitButton = page.getByRole('button', { name: 'Sign up' });
    this.errorMessage = page.getByRole('main').getByRole('alert');
    this.loginLink = page.getByRole('main').getByRole('link', { name: 'Log in' });
  }

  /** @param {{ fullName?: string, email?: string, password?: string }} values empty/omitted fields are left blank */
  async fillForm({ fullName = '', email = '', password = '' }) {
    await this.fullNameInput.fill(fullName);
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
  }

  async submit() {
    await this.submitButton.click();
  }

  /** @param {{ fullName?: string, email?: string, password?: string }} values */
  async signup(values) {
    await this.fillForm(values);
    await this.submit();
  }

  async openLoginFromForm() {
    await this.loginLink.click();
  }
}
