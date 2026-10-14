# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: capture.spec.js >> locator-not-found
- Location: .capture\capture.spec.js:20:1

# Error details

```
TimeoutError: locator.click: Timeout 1500ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Add to bag' })

```

# Page snapshot

```yaml
- main [ref=e2]:
  - heading "Shop" [level=1] [ref=e3]
  - paragraph [ref=e4]: $149.99
  - button "Add to cart" [ref=e5]
  - button "Buy" [ref=e6]
  - button "Buy" [ref=e7]
  - button "Disabled" [disabled] [ref=e8]
  - textbox "Name" [ref=e9]
  - generic [ref=e10]: hello
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | const html = `<main><h1>Shop</h1><p class="price">$149.99</p>
  4  | <button>Add to cart</button><button class="b">Buy</button><button class="b">Buy</button>
  5  | <button id="dis" disabled>Disabled</button><input id="name" aria-label="Name"><div id="txt">hello</div></main>`;
  6  | 
  7  | class P {
  8  |   constructor(page) {
  9  |     this.page = page;
  10 |     this.add = page.getByRole('button', { name: 'Add to bag' });
  11 |     this.buy = page.locator('button.b');
  12 |     this.price = page.locator('.price');
  13 |     this.missing = page.getByTestId('banner');
  14 |     this.disabled = page.locator('#dis');
  15 |     this.nameField = page.locator('#txt');
  16 |   }
  17 | }
  18 | 
  19 | test.beforeEach(async ({ page }) => { await page.setContent(html); });
> 20 | test('locator-not-found', async ({ page }) => { await new P(page).add.click({ timeout: 1500 }); });
     |                                                                       ^ TimeoutError: locator.click: Timeout 1500ms exceeded.
  21 | test('strict-mode', async ({ page }) => { await new P(page).buy.click({ timeout: 1500 }); });
  22 | test('assert-text', async ({ page }) => { await expect(new P(page).price).toHaveText('$149.98', { timeout: 1000 }); });
  23 | test('assert-tobe', async () => { expect(2 + 2).toBe(5); });
  24 | test('visible-missing', async ({ page }) => { await expect(new P(page).missing).toBeVisible({ timeout: 1000 }); });
  25 | test('actionability', async ({ page }) => { await new P(page).disabled.click({ timeout: 1500 }); });
  26 | test('wrong-element', async ({ page }) => { await new P(page).nameField.fill('x', { timeout: 1500 }); });
  27 | test('navigation', async ({ page }) => { await page.goto('http://127.0.0.1:9/'); });
  28 | test('api', async ({ request }) => { await request.get('http://127.0.0.1:9/api'); });
  29 | test('test-timeout', async ({ page }) => { test.setTimeout(1500); await page.waitForEvent('popup'); });
  30 | test('assert-url', async ({ page }) => { await expect(page).toHaveURL(/checkout/, { timeout: 1000 }); });
  31 | 
```