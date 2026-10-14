/**
 * Inputs and expected values for Login/Signup, copied verbatim from docs/test-cases.md
 * (observed 2026-10-14). Do not adjust these to make a test pass.
 */
export const AUTH = Object.freeze({
  probeEmail: 'qa-harness+probe@example.invalid',
  wrongPassword: 'WrongPass123!',
  malformedEmail: 'not-an-email',
  probePassword: 'probe1234',
  shortPassword: 'abc',
  fullName: 'QA Harness',
  messages: Object.freeze({
    invalidCredentials: 'Invalid email or password',
    userAlreadyRegistered: 'User already registered',
    signupSuccess: 'Account created. Check your email to confirm, then log in.',
  }),
  urls: Object.freeze({
    login: /\/login$/,
    signup: /\/signup$/,
    products: /\/products$/,
    signupSuccess: /\/login\?signupSuccess=1$/,
  }),
});
