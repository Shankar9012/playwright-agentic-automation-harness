# Application context

> **Status: explored 2026-10-14 — scope: Login (`/login`) and Signup (`/signup`) pages, header navigation, post-login / post-signup / logout destinations.** Everything else (catalog, product detail, cart, orders, profile, checkout) is **NOT EXPLORED**; it is only listed in the site map because links to it were seen.

- **Base URL:** `https://qa-demo-website.vercel.app` (from `BASE_URL`)
- **App name:** "Demo Shop" (header brand link and `<title>` on every page visited) — Observed
- **Environment:** public demo deployment on Vercel. Home page text: "A small demo shop for headphones, keyboards, and other desk gear. Browse the catalog, add to cart, and check out with Stripe." — Observed
- **Tech hints (Observed):** Next.js App Router (`?_rsc=` prefetch requests; login submitted as a server action `POST /login` returning 200; an empty page-level `alert` element is present on every page and receives the page name after client navigation, e.g. "Log in", "Products" — the Next.js route announcer). Error string "User already registered" matches Supabase Auth wording (Assumption about the backend, see below).
- **Authentication model (Observed):** email + password. Session persists across full page loads (cookie-based; exact mechanism not inspected). Logged-out header: `Products`, `Log in`, `Sign up`. Logged-in header: `Products`, `Cart`, `Orders`, `Profile`, button `Log out`.
- **Test-data dependencies:** valid-login tests need `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` from `.env`. In `.env.example` both are **empty**, so a valid login is not configured by default. A throwaway account was created during exploration (see below); its password is not stored in docs.
- **Third-party hand-offs:** home page mentions Stripe checkout — **not explored**, no navigation to Stripe made.

## Observed (2026-10-14, Chromium via Playwright MCP)

### Reaching the auth pages
- Home `/` header (logged out): link "Log in" → `/login`, link "Sign up" → `/signup`. Hero CTA link "Create an account" → `/signup` (only shown when logged out; absent when logged in).
- `/login` footer: "Don't have an account?" + link "Sign up" → `/signup`.
- `/signup` footer: "Already have an account?" + link "Log in" → `/login`.
- Both pages: page title "Demo Shop"; no placeholders on any field (visually empty inputs).

### Login page (`/login`)
- h1 "Log in". Fields: textbox "Email" (label "Email", native email validation), textbox "Password" (label "Password", masked) with toggle button "Show password". Submit button "Log in".
- Empty submit: no request, focus on Email, native bubble "Please fill out this field." (Email is `required`).
- Email filled, password empty: native bubble on Password "Please fill out this field." (Password is `required`).
- Email `not-an-email`: native bubble "Please include an '@' in the email address. 'not-an-email' is missing an '@'." (input type=email).
- Show password: button changes to "Hide password" with `pressed` state; password text becomes visible. (Clicking "Hide password" again was not exercised.)
- Wrong credentials (unknown email `qa-harness+probe@example.invalid` / `WrongPass123!`, and existing email with wrong password): inline `alert` inside the form with text **"Invalid email or password"**; URL stays `/login`; both Email and Password fields are cleared. Same message for unknown vs existing email (no account enumeration).
- Successful login (throwaway account): redirect to **`/products`** (h1 "Products"); header switches to logged-in links.
- Visiting `/login` while logged in: form still rendered, no redirect.
- Log out (header button "Log out"): redirect to `/login`, header returns to logged-out links.

### Signup page (`/signup`)
- h1 "Create your account". Fields: textbox "Full name" (required), textbox "Email" (required, type=email), textbox "Password" (required, minimum length 8) with toggle "Show password". Submit button "Sign up". **No confirm-password field.**
- Empty submit: bubble on Full name "Please fill out this field."
- Full name only: bubble on Email "Please fill out this field."
- Email `not-an-email`: "Please include an '@' in the email address. 'not-an-email' is missing an '@'."
- Password empty: bubble on Password "Please fill out this field."
- Password `abc`: "Please lengthen this text to 8 characters or more (you are currently using 3 characters)."
- Success (Full name "QA Harness", email `qa-harness+20261014074400@example.invalid`, 14-char password): redirect to **`/login?signupSuccess=1`** showing paragraph **"Account created. Check your email to confirm, then log in."** above the login form — **but the user is already logged in** (header shows Cart/Orders/Profile/Log out, and the session persists on `/`).
- Email confirmation is **not enforced**: the unconfirmed `.invalid` account could log in immediately.
- Duplicate email: inline `alert` **"User already registered"**; URL stays `/signup`; all fields cleared.
- Visiting `/signup` while logged in: form still rendered, no redirect.

### Accounts created during exploration
- `qa-harness+20261014074400@example.invalid` (Full name "QA Harness") — created 2026-10-14 07:44 UTC by the planner. Left in place (no deletion performed).

## Specified
_None provided. No product requirements were supplied for login/signup; all expectations in test cases are Observed._

## Assumptions
- A1: Field "required"/type/minlength attributes are inferred from native browser validation bubbles (attributes not read directly; MCP had no DOM-evaluate tool). Confirm with `toHaveAttribute('required')` etc. when automating.
- A2: Native validation message strings are Chromium + English-locale specific. Tests should assert validity state (`validity.valueMissing`, `typeMismatch`, `tooShort`) or "no navigation / no alert" rather than the exact bubble text.
- A3: Backend is Supabase Auth (based on "User already registered" wording). Not confirmed; does not affect tests.
- A4: The "Check your email to confirm" message combined with an immediately logged-in session looks like a defect or a demo shortcut. Needs product clarification before writing an assertion about the logged-in state after signup.
- A5: Login has no client-side min length on password (9-char probe accepted by browser); short passwords on login were not tested.

## Unavailable / unverified
- Valid login with configured credentials: `TEST_USER_EMAIL`/`TEST_USER_PASSWORD` are empty in `.env.example`; `.env` was intentionally not read.
- Email confirmation flow (no mailbox; `.invalid` domain).
- Password reset / "Forgot password": **no such link exists** on `/login`.
- Social / OAuth login: none present.
- Redirect-back-after-login (e.g. from `/cart` or `/orders` when logged out): not explored.
- Catalog, product detail, cart, orders, profile, checkout/Stripe: out of scope, not explored.
- `scripts/check-target.mjs` could not be executed in this session (no shell tool); host matches `ALLOWED_HOSTS` in `.env.example`.
