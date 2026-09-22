import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const dataDir = mkdtempSync(join(tmpdir(), 'xray-e2e-'));
const env = {
  ...process.env,
  XRAY_FAKE_BASE_URL: 'http://127.0.0.1:8765/v1',
  XRAY_DATA_DIR: dataDir,
};

export default defineConfig({
  testDir: 'web/e2e',
  timeout: 30000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:8000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: '.venv/bin/python -m uvicorn tests.fake_llm:app --port 8765',
      env,
      url: 'http://127.0.0.1:8765/v1/models',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: '.venv/bin/python -m uvicorn app.main:app --port 8000',
      env,
      url: 'http://127.0.0.1:8000/api/meta',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
