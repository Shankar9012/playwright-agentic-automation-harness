import { test, expect } from '@playwright/test';
import { ShopPage } from '../pages/shop-page.js';

test('shows the product price', async ({ page }) => {
  // Arrange
  const shop = new ShopPage(page);

  // Act
  await shop.open();

  // Assert — FAULT (Test B): the page shows $149.99; this expected value is intentionally wrong.
  await expect(shop.price).toHaveText('$149.98');
});
