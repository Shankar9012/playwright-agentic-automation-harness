# Locator map

> **Status: explored 2026-10-14 — scope: header navigation, `/login`, `/signup`.** Filled from ARIA snapshots; the executer adds the Page Object column. The self-healer reads this file to confirm a broken locator's intended target.

Locator priority: `getByRole` (+name) → `getByLabel` → `getByPlaceholder` → `getByText` → `getByTestId` → scoped CSS.

## Ambiguity notes (Observed)
- "Log in" exists as a **header link** and a **submit button** on `/login`; always specify role. On `/signup`, link "Log in" appears in both the header and the form footer, so scope by landmark (`banner` vs `main`).
- "Sign up" exists as a header link, a footer link on `/login`, and the submit button on `/signup`; scope links by landmark.
- An **empty page-level `alert`** (Next.js route announcer) is on every page and gets the page name after client navigation (e.g. "Log in"). Do not use bare `getByRole('alert')`; scope to `main` and/or filter by text.
- The password toggle button's name contains "password" ("Show password"/"Hide password"). Use `exact: true` on `getByRole('textbox', { name: 'Password' })` and avoid `getByLabel('Password')` without `exact` (it may also match the button's aria-label).
- The toggle's name changes after click ("Show password" → "Hide password").
- No `data-testid` or placeholders were observed.

| Page | Element | Role | Accessible name / label | Preferred locator | Fallback | Page Object property |
|---|---|---|---|---|---|---|
| Header (all) | Brand link | link | "Demo Shop" | `page.getByRole('banner').getByRole('link', { name: 'Demo Shop' })` | `page.getByRole('link', { name: 'Demo Shop' })` | HeaderComponent.brandLink |
| Header (all) | Products link | link | "Products" | `page.getByRole('banner').getByRole('link', { name: 'Products' })` | — | HeaderComponent.productsLink |
| Header (logged out) | Log in link | link | "Log in" | `page.getByRole('banner').getByRole('link', { name: 'Log in' })` | — | HeaderComponent.loginLink |
| Header (logged out) | Sign up link | link | "Sign up" | `page.getByRole('banner').getByRole('link', { name: 'Sign up' })` | — | HeaderComponent.signupLink |
| Header (logged in) | Cart link | link | "Cart" | `page.getByRole('banner').getByRole('link', { name: 'Cart' })` | — | HeaderComponent.cartLink |
| Header (logged in) | Orders link | link | "Orders" | `page.getByRole('banner').getByRole('link', { name: 'Orders' })` | — | HeaderComponent.ordersLink |
| Header (logged in) | Profile link | link | "Profile" | `page.getByRole('banner').getByRole('link', { name: 'Profile' })` | — | HeaderComponent.profileLink |
| Header (logged in) | Log out button | button | "Log out" | `page.getByRole('button', { name: 'Log out' })` | — | HeaderComponent.logoutButton |
| Home `/` | Create an account CTA | link | "Create an account" | `page.getByRole('link', { name: 'Create an account' })` | — | HomePage.createAccountLink |
| Login `/login` | Heading | heading (h1) | "Log in" | `page.getByRole('heading', { level: 1, name: 'Log in' })` | — | LoginPage.heading |
| Login `/login` | Email input | textbox | "Email" (label) | `page.getByRole('textbox', { name: 'Email' })` | `page.getByLabel('Email', { exact: true })` | LoginPage.emailInput |
| Login `/login` | Password input | textbox | "Password" (label) | `page.getByRole('textbox', { name: 'Password', exact: true })` | `page.getByLabel('Password', { exact: true })` | LoginPage.passwordInput |
| Login `/login` | Show/hide password toggle | button | "Show password" → "Hide password" (pressed) | `page.getByRole('button', { name: /^(Show\|Hide) password$/ })` | `page.getByRole('button', { name: 'Show password' })` | LoginPage.passwordToggle |
| Login `/login` | Submit | button | "Log in" | `page.getByRole('button', { name: 'Log in' })` | `page.getByRole('main').getByRole('button', { name: 'Log in' })` | LoginPage.submitButton |
| Login `/login` | Error message | alert (in form) | "Invalid email or password" | `page.getByRole('main').getByRole('alert')` | `page.getByText('Invalid email or password')` | LoginPage.errorMessage |
| Login `/login?signupSuccess=1` | Signup success notice | paragraph | "Account created. Check your email to confirm, then log in." | `page.getByText('Account created. Check your email to confirm, then log in.')` | — | LoginPage.signupSuccessNotice |
| Login `/login` | Sign up footer link | link | "Sign up" | `page.getByRole('main').getByRole('link', { name: 'Sign up' })` | — | LoginPage.signupLink |
| Signup `/signup` | Heading | heading (h1) | "Create your account" | `page.getByRole('heading', { level: 1, name: 'Create your account' })` | — | SignupPage.heading |
| Signup `/signup` | Full name input | textbox | "Full name" (label) | `page.getByRole('textbox', { name: 'Full name' })` | `page.getByLabel('Full name')` | SignupPage.fullNameInput |
| Signup `/signup` | Email input | textbox | "Email" (label) | `page.getByRole('textbox', { name: 'Email' })` | `page.getByLabel('Email', { exact: true })` | SignupPage.emailInput |
| Signup `/signup` | Password input | textbox | "Password" (label) | `page.getByRole('textbox', { name: 'Password', exact: true })` | `page.getByLabel('Password', { exact: true })` | SignupPage.passwordInput |
| Signup `/signup` | Show/hide password toggle | button | "Show password" → "Hide password" | `page.getByRole('button', { name: /^(Show\|Hide) password$/ })` | — | SignupPage.showPasswordButton (Show password state only) |
| Signup `/signup` | Submit | button | "Sign up" | `page.getByRole('button', { name: 'Sign up' })` | `page.getByRole('main').getByRole('button', { name: 'Sign up' })` | SignupPage.submitButton |
| Signup `/signup` | Error message | alert (in form) | "User already registered" | `page.getByRole('main').getByRole('alert')` | `page.getByText('User already registered')` | SignupPage.errorMessage |
| Signup `/signup` | Log in footer link | link | "Log in" | `page.getByRole('main').getByRole('link', { name: 'Log in' })` | — | SignupPage.loginLink |


Executer additions (2026-10-14, not separately observed as elements; derived from the rows above): `ProductsPage.heading` = `page.getByRole('heading', { level: 1, name: 'Products' })`; `SignupPage.confirmPasswordInput` = `page.getByRole('textbox', { name: /confirm/i })` (asserted absent, TC-AUTH-SIGNUP-011); `SignupPage.formTextboxes` = `page.getByRole('main').getByRole('textbox')` (count 3).

Note: in the regex cells, `\|` is Markdown escaping; the actual regex is `/^(Show|Hide) password$/`.
