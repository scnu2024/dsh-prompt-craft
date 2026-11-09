import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/ui',
  fullyParallel: true,
  workers: 3,
  timeout: 30000,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4178', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: { command: 'npm run preview:ui', url: 'http://127.0.0.1:4178', reuseExistingServer: !process.env.CI },
})
