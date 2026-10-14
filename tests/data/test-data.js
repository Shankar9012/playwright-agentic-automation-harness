import process from 'node:process';

/**
 * Test data helpers. Rules:
 * - Credentials come only from environment variables (.env, never committed). Tests that need
 *   them must call `getCredentials()` and `test.skip(!credentials, 'reason')` when they are absent;
 *   credentials are never invented.
 * - Expected business values (prices, names, messages) are recorded from observed behaviour in
 *   docs/test-cases.md and kept here or in the spec, never "adjusted" to make a test pass.
 * - Generated data uses a unique, recognizable prefix so it can be identified and cleaned up.
 */

/** @returns {{ email: string, password: string } | null} */
export function getCredentials() {
  const email = process.env.TEST_USER_EMAIL;
  const password = process.env.TEST_USER_PASSWORD;
  return email && password ? { email, password } : null;
}

/**
 * Unique, clearly synthetic email for negative/validation tests (never a real mailbox).
 * @param {string} [label]
 */
export function syntheticEmail(label = 'user') {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return `qa-harness+${label}-${stamp}@example.invalid`;
}

/**
 * Email of the configured test account only (for cases that need an existing email but not its
 * password, e.g. wrong-password and duplicate-signup checks).
 * @returns {string | null}
 */
export function getTestUserEmail() {
  return process.env.TEST_USER_EMAIL || null;
}

/**
 * Opt-in for tests that create persistent accounts on the target (successful signup).
 * Off unless ALLOW_ACCOUNT_CREATION=true.
 */
export function isAccountCreationAllowed() {
  return process.env.ALLOW_ACCOUNT_CREATION === 'true';
}

/**
 * Synthetic, clearly fake password that satisfies the observed 8-character minimum.
 * Not a credential for any real account.
 */
export function syntheticPassword() {
  return `QaHarness-${Date.now().toString(36)}!`;
}
