import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  // `npm run dev:ui` serves the page with hot reload; the API comes from `wrangler dev` alongside.
  server: { proxy: { '/api': 'http://localhost:8787' } },
  test: { include: ['src/**/*.test.ts', 'worker/**/*.test.ts'], environment: 'node' },
});
