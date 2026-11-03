import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./front/src', import.meta.url)) } },
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['back/test/**/*.test.{ts,mjs}', 'front/test/**/*.test.{tsx,mjs}'],
    environment: 'node',
  },
});
