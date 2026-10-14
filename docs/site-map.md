# Site map

> **Status: explored 2026-10-14 — scope: `/`, `/login`, `/signup` and auth redirects.** Routes marked *not explored* were only seen as link targets.

| Route | Page | Reached from | Auth required | Notes |
|---|---|---|---|---|
| `/` | Home (h1 "Everyday tech, delivered fast") | Header brand link "Demo Shop" | No | Observed. CTA "Create an account" → `/signup` shown only when logged out. Featured products list — not explored. |
| `/login` | Log in (h1 "Log in") | Header link "Log in"; footer link "Log in" on `/signup`; after "Log out" | No | Observed. Not redirected when already logged in. |
| `/login?signupSuccess=1` | Log in + success notice | Successful signup | No | Observed. Shows "Account created. Check your email to confirm, then log in." while the user is already logged in. |
| `/signup` | Create your account (h1 "Create your account") | Header link "Sign up"; home CTA "Create an account"; footer link "Sign up" on `/login` | No | Observed. Not redirected when already logged in. |
| `/products` | Products (h1 "Products") | Header link "Products"; **successful login redirect** | No (header link visible logged out) | Destination observed only; catalog behaviour not explored. |
| `/products/<uuid>` | Product detail | Product cards | Unknown | Not explored. |
| `/cart` | Cart | Header link "Cart" (logged in only) | Assumed yes | Not explored. |
| `/orders` | Orders | Header link "Orders" (logged in only) | Assumed yes | Not explored. |
| `/profile` | Profile | Header link "Profile" (logged in only) | Assumed yes | Not explored (no profile changes allowed). |

## Navigation tree
```
Header (logged out)                 Header (logged in)
├── Demo Shop  → /                  ├── Demo Shop → /
├── Products   → /products          ├── Products  → /products
├── Log in     → /login             ├── Cart      → /cart      (not explored)
└── Sign up    → /signup            ├── Orders    → /orders    (not explored)
                                    ├── Profile   → /profile   (not explored)
                                    └── [button] Log out → /login

/login  ── "Sign up" (footer) ──→ /signup
/login  ── valid submit ────────→ /products
/login  ── invalid submit ──────→ /login + alert "Invalid email or password"
/signup ── "Log in" (footer) ───→ /login
/signup ── valid submit ────────→ /login?signupSuccess=1 (session already active)
/signup ── existing email ──────→ /signup + alert "User already registered"
```
