import { test, expect } from '@playwright/test';

test('home page loads and renders the app shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('App shell ready')).toBeVisible();
});
