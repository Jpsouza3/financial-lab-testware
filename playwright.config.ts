import { defineConfig } from '@playwright/test';

const GLOBAL_STATE = /@global/;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'on-failure' }]],
  use: {
    extraHTTPHeaders: {
      Accept: 'application/json',
    },
  },
  projects: [
    {
      name: 'api',
      grepInvert: GLOBAL_STATE,
    },
    {
      name: 'global',
      grep: GLOBAL_STATE,
      fullyParallel: false,
      workers: 1,
    },
  ],
});
