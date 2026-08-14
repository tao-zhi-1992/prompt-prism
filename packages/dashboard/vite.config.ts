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
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'markdown', test: /node_modules\/(?:react-markdown|remark-|rehype-|unified|micromark|mdast-|hast-|lowlight|highlight\.js|property-information|space-separated-tokens|comma-separated-tokens|vfile|unist-)/ },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['./src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/test/**', 'src/**/*.d.ts', '**/packages/dashboard-kit/**'],
      reporter: ['text', 'json', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      thresholds: { statements: 91, branches: 81, functions: 91, lines: 94 },
    },
  },
});
