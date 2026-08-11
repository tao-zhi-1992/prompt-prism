import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import appPackage from '../prompt-prism/package.json' with { type: 'json' };

export default defineConfig({
  base: '/_pp/',
  plugins: [react()],
  define: {
    __PROMPT_PRISM_VERSION__: JSON.stringify(appPackage.version),
  },
  build: {
    outDir: '../prompt-prism/public/dashboard',
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['./src/**/*.test.{ts,tsx}'],
  },
});
