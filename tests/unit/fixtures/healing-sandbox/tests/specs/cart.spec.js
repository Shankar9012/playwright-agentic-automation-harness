import { test, expect } from '@playwright/test';
import { ShopPage } from '../pages/shop-page.js';

test('adds the product to the cart', async ({ page }) => {
  // Arrange
  const shop = new ShopPage(page);
  await shop.open();

  // Act
  await shop.addToCart();

  // Assert
  await expect(shop.status).toHaveText('Added to cart');
});
