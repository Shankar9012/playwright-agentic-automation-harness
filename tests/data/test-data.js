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
