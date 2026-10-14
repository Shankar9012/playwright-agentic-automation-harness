import { test, expect } from '../fixtures/test.js';
import { TAG } from '../support/tags.js';
import { getCredentials, getTestUserEmail } from '../data/test-data.js';
import { AUTH } from '../data/auth-data.js';

test.describe('Login', () => {
  test('TC-AUTH-LOGIN-001 header "Log in" link opens the login page', { tag: [TAG.SMOKE, TAG.AUTH, TAG.NAVIGATION] }, async ({ homePage, header, loginPage }) => {
    // Arrange
    await homePage.goto();

    // Act
    await header.openLogin();

    // Assert
    await expect(loginPage.page).toHaveURL(AUTH.urls.login);
    await expect(loginPage.heading).toBeVisible();
    await expect(loginPage.emailInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.submitButton).toBeVisible();
  });

  test('TC-AUTH-LOGIN-002 valid login redirects to Products with logged-in header', { tag: [TAG.SMOKE, TAG.AUTH] }, async ({ loginPage, productsPage, header }) => {
    const credentials = getCredentials();
    test.skip(!credentials, 'TEST_USER_EMAIL/PASSWORD not set');

    // Arrange
    await loginPage.goto();

    // Act
    await loginPage.login(credentials);

    // Assert
    await expect(productsPage.page).toHaveURL(AUTH.urls.products);
    await expect(productsPage.heading).toBeVisible();
    await expect(header.cartLink).toBeVisible();
    await expect(header.ordersLink).toBeVisible();
    await expect(header.profileLink).toBeVisible();
    await expect(header.logoutButton).toBeVisible();
    await expect(header.loginLink).toBeHidden();
  });

  test('TC-AUTH-LOGIN-003 unknown email is rejected with generic error', { tag: [TAG.SMOKE, TAG.AUTH] }, async ({ loginPage, header }) => {
    // Arrange
    await loginPage.goto();

    // Act
    await loginPage.login({ email: AUTH.probeEmail, password: AUTH.wrongPassword });

    // Assert
    await expect(loginPage.errorMessage).toHaveText(AUTH.messages.invalidCredentials);
    await expect(loginPage.page).toHaveURL(AUTH.urls.login);
    await expect(header.loginLink).toBeVisible();
  });

  test('TC-AUTH-LOGIN-004 existing email with wrong password shows same generic error', { tag: [TAG.REGRESSION, TAG.AUTH] }, async ({ loginPage }) => {
    const email = getTestUserEmail();
    test.skip(!email, 'TEST_USER_EMAIL not set');

    // Arrange
    await loginPage.goto();

    // Act
    await loginPage.login({ email, password: AUTH.wrongPassword });

    // Assert
    await expect(loginPage.errorMessage).toHaveText(AUTH.messages.invalidCredentials);
    await expect(loginPage.page).toHaveURL(AUTH.urls.login);
  });

  test('TC-AUTH-LOGIN-005 empty form is blocked by required Email', { tag: [TAG.REGRESSION, TAG.AUTH] }, async ({ loginPage }) => {
    // Arrange
    await loginPage.goto();

    // Act
    await loginPage.submit();

    // Assert
    expect(await loginPage.validityOf(loginPage.emailInput)).toMatchObject({ valid: false, valueMissing: true });
    await expect(loginPage.page).toHaveURL(AUTH.urls.login);
    await expect(loginPage.errorMessage).toBeHidden();
  });

  test('TC-AUTH-LOGIN-006 empty password is blocked', { tag: [TAG.REGRESSION, TAG.AUTH] }, async ({ loginPage }) => {
    // Arrange
    await loginPage.goto();

    // Act
    await loginPage.login({ email: AUTH.probeEmail, password: '' });

    // Assert
    expect(await loginPage.validityOf(loginPage.passwordInput)).toMatchObject({ valid: false, valueMissing: true });
    await expect(loginPage.page).toHaveURL(AUTH.urls.login);
    await expect(loginPage.errorMessage).toBeHidden();
  });

  test('TC-AUTH-LOGIN-007 malformed email is blocked', { tag: [TAG.REGRESSION, TAG.AUTH] }, async ({ loginPage }) => {
    // Arrange
    await loginPage.goto();

    // Act
    await loginPage.login({ email: AUTH.malformedEmail, password: AUTH.probePassword });

    // Assert
    expect(await loginPage.validityOf(loginPage.emailInput)).toMatchObject({ valid: false, typeMismatch: true });
    await expect(loginPage.page).toHaveURL(AUTH.urls.login);
    await expect(loginPage.errorMessage).toBeHidden();
  });

  test('TC-AUTH-LOGIN-008 show password reveals the password', { tag: [TAG.REGRESSION, TAG.AUTH] }, async ({ loginPage }) => {
    // Arrange
    await loginPage.goto();
    await loginPage.fillForm({ password: AUTH.probePassword });

    // Act
    await loginPage.togglePasswordVisibility();

    // Assert
    await expect(loginPage.passwordToggle).toHaveAccessibleName('Hide password');
    await expect(loginPage.passwordToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(loginPage.passwordInput).toHaveAttribute('type', 'text');
    await expect(loginPage.passwordInput).toHaveValue(AUTH.probePassword);
  });

  test('TC-AUTH-LOGIN-009 "Sign up" link in login form footer opens signup', { tag: [TAG.REGRESSION, TAG.AUTH, TAG.NAVIGATION] }, async ({ loginPage, signupPage }) => {
    // Arrange
    await loginPage.goto();

    // Act
    await loginPage.openSignupFromForm();

    // Assert
    await expect(signupPage.page).toHaveURL(AUTH.urls.signup);
    await expect(signupPage.heading).toBeVisible();
  });

  test('TC-AUTH-LOGIN-010 fields are cleared after a failed login', { tag: [TAG.REGRESSION, TAG.AUTH] }, async ({ loginPage }) => {
    // Arrange
    await loginPage.goto();

    // Act
    await loginPage.login({ email: AUTH.probeEmail, password: AUTH.wrongPassword });

    // Assert
    await expect(loginPage.errorMessage).toHaveText(AUTH.messages.invalidCredentials);
    await expect(loginPage.emailInput).toHaveValue('');
    await expect(loginPage.passwordInput).toHaveValue('');
  });

  test('TC-AUTH-LOGIN-011 log out returns to login with logged-out header', { tag: [TAG.REGRESSION, TAG.AUTH] }, async ({ loginPage, productsPage, header }) => {
    const credentials = getCredentials();
    test.skip(!credentials, 'TEST_USER_EMAIL/PASSWORD not set');

    // Arrange
    await loginPage.goto();
    await loginPage.login(credentials);
    await expect(productsPage.page).toHaveURL(AUTH.urls.products);

    // Act
    await header.logout();

    // Assert
    await expect(loginPage.page).toHaveURL(AUTH.urls.login);
    await expect(header.loginLink).toBeVisible();
    await expect(header.signupLink).toBeVisible();
    await expect(header.logoutButton).toBeHidden();
  });
});
