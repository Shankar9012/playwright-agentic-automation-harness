export const SHOP_HTML = `<main>
  <h1>Noise-Cancelling Headphones</h1>
  <p data-testid="price">$149.99</p>
  <button type="button" onclick="document.getElementById('status').textContent = 'Added to cart'">Add to cart</button>
  <button type="button">Buy now</button>
  <p id="status" role="status"></p>
</main>`;

export class ShopPage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
    // FAULT (Test A): the real button is "Add to cart"; this locator is intentionally broken.
    this.addToCartButton = page.getByRole('button', { name: 'Add to bag' });
    this.price = page.getByTestId('price');
    this.status = page.getByRole('status');
  }

  async open() {
    await this.page.setContent(SHOP_HTML);
  }

  async addToCart() {
    await this.addToCartButton.click();
  }
}
