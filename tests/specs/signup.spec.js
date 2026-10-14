import { test, expect } from '../fixtures/test.js';
import { TAG } from '../support/tags.js';
import { getTestUserEmail, isAccountCreationAllowed, syntheticEmail, syntheticPassword } from '../data/test-data.js';
import { AUTH } from '../data/auth-data.js';

test.describe('Signup', () => {
  test('TC-AUTH-SIGNUP-001 header "Sign up" link opens the signup page', { tag: [TAG.SMOKE, TAG.AUTH, TAG.NAVIGATION] }, async ({ homePage, header, signupPage }) => {
    // Arrange
    await homePage.goto();

    // Act
    await header.openSignup();

    // Assert
    await expect(signupPage.page).toHaveURL(AUTH.urls.signup);
    await expect(signupPage.heading).toBeVisible();
    await expect(signupPage.fullNameInput).toBeVisible();
    await expect(signupPage.emailInput).toBeVisible();
    await expect(signupPage.passwordInput).toBeVisible();
    await expect(signupPage.submitButton).toBeVisible();
  });

  test('TC-AUTH-SIGNUP-002 home CTA "Create an account" opens signup', { tag: [TAG.REGRESSION, TAG.NAVIGATION] }, async ({ homePage, signupPage }) => {
    // Arrange
    await homePage.goto();

    // Act
    await homePage.openCreateAccount();

    // Assert
    await expect(signupPage.page).toHaveURL(AUTH.urls.signup);
  });

  test('TC-AUTH-SIGNUP-003 successful signup redirects to login with success notice', { tag: [TAG.REGRESSION, TAG.AUTH] }, async ({ signupPage, loginPage }) => {
    test.skip(!isAccountCreationAllowed(), 'Creates a persistent account; set ALLOW_ACCOUNT_CREATION=true to opt in');

    // Arrange
    await signupPage.goto();

    // Act
    await signupPage.signup({ fullName: AUTH.fullName, email: syntheticEmail('signup'), password: syntheticPassword() });

    // Assert (session state after signup intentionally not asserted: docs/app-context.md A4)
    await expect(loginPage.page).toHaveURL(AUTH.urls.signupSuccess);
    await expect(loginPage.signupSuccessNotice).toBeVisible();
    await expect(loginPage.heading).toBeVisible();
  });

  test('TC-AUTH-SIGNUP-004 duplicate email is rejected', { tag: [TAG.REGRESSION, TAG.AUTH] }, async ({ signupPage }) => {
    const email = getTestUserEmail();
    test.skip(!email, 'TEST_USER_EMAIL not set (needs an existing account email)');

    // Arrange
    await signupPage.goto();

    // Act
    await signupPage.signup({ fullName: AUTH.fullName, email, password: syntheticPassword() });

    // Assert
    await expect(signupPage.errorMessage).toHaveText(AUTH.messages.userAlreadyRegistered);
    await expect(signupPage.page).toHaveURL(AUTH.urls.signup);
    await expect(signupPage.fullNameInput).toHaveValue('');
    await expect(signupPage.emailInput).toHaveValue('');
    await expect(signupPage.passwordInput).toHaveValue('');
  });

  test('TC-AUTH-SIGNUP-005 empty form is blocked by required Full name', { tag: [TAG.REGRESSION, TAG.AUTH] }, async ({ signupPage }) => {
    // Arrange
    await signupPage.goto();

    // Act
    await signupPage.submit();

    // Assert
    expect(await signupPage.validityOf(signupPage.fullNameInput)).toMatchObject({ valid: false, valueMissing: true });
    await expect(signupPage.page).toHaveURL(AUTH.urls.signup);
    await expect(signupPage.errorMessage).toBeHidden();
  });

  test('TC-AUTH-SIGNUP-006 missing email is blocked', { tag: [TAG.REGRESSION, TAG.AUTH] }, async ({ signupPage }) => {
    // Arrange
    await signupPage.goto();

    // Act
    await signupPage.signup({ fullName: AUTH.fullName });

    // Assert
    expect(await signupPage.validityOf(signupPage.emailInput)).toMatchObject({ valid: false, valueMissing: true });
    await expect(signupPage.page).toHaveURL(AUTH.urls.signup);
    await expect(signupPage.errorMessage).toBeHidden();
  });

  test('TC-AUTH-SIGNUP-007 malformed email is blocked', { tag: [TAG.REGRESSION, TAG.AUTH] }, async ({ signupPage }) => {
    // Arrange
    await signupPage.goto();

    // Act
    await signupPage.signup({ fullName: AUTH.fullName, email: AUTH.malformedEmail });

    // Assert
    expect(await signupPage.validityOf(signupPage.emailInput)).toMatchObject({ valid: false, typeMismatch: true });
    await expect(signupPage.page).toHaveURL(AUTH.urls.signup);
    await expect(signupPage.errorMessage).toBeHidden();
  });

  test('TC-AUTH-SIGNUP-008 missing password is blocked', { tag: [TAG.REGRESSION, TAG.AUTH] }, async ({ signupPage }) => {
    // Arrange
    await signupPage.goto();

    // Act
    await signupPage.signup({ fullName: AUTH.fullName, email: AUTH.probeEmail });

    // Assert
    expect(await signupPage.validityOf(signupPage.passwordInput)).toMatchObject({ valid: false, valueMissing: true });
    await expect(signupPage.page).toHaveURL(AUTH.urls.signup);
    await expect(signupPage.errorMessage).toBeHidden();
  });

  test('TC-AUTH-SIGNUP-009 password shorter than 8 characters is blocked', { tag: [TAG.REGRESSION, TAG.AUTH] }, async ({ signupPage }) => {
    // Arrange
    await signupPage.goto();

    // Act
    await signupPage.signup({ fullName: AUTH.fullName, email: AUTH.probeEmail, password: AUTH.shortPassword });

    // Assert
    expect(await signupPage.validityOf(signupPage.passwordInput)).toMatchObject({ valid: false, tooShort: true });
    await expect(signupPage.page).toHaveURL(AUTH.urls.signup);
    await expect(signupPage.errorMessage).toBeHidden();
  });

  test('TC-AUTH-SIGNUP-010 "Log in" link in signup form footer opens login', { tag: [TAG.REGRESSION, TAG.AUTH, TAG.NAVIGATION] }, async ({ signupPage, loginPage }) => {
    // Arrange
    await signupPage.goto();

    // Act
    await signupPage.openLoginFromForm();

    // Assert
    await expect(loginPage.page).toHaveURL(AUTH.urls.login);
    await expect(loginPage.heading).toBeVisible();
  });

  test('TC-AUTH-SIGNUP-011 signup form has exactly Full name, Email, Password', { tag: [TAG.REGRESSION, TAG.AUTH] }, async ({ signupPage }) => {
    // Arrange
    // (no preconditions beyond being logged out)

    // Act
    await signupPage.goto();

    // Assert
    await expect(signupPage.fullNameInput).toBeVisible();
    await expect(signupPage.emailInput).toBeVisible();
    await expect(signupPage.passwordInput).toBeVisible();
    await expect(signupPage.showPasswordButton).toBeVisible();
    await expect(signupPage.confirmPasswordInput).toHaveCount(0);
    await expect(signupPage.formTextboxes).toHaveCount(3);
  });
});
