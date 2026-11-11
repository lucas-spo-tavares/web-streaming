import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    projects: [
      {
        extends: true,
        resolve: { alias: { '@': fileURLToPath(new URL('./back/src', import.meta.url)) } },
        test: { name: 'back', include: ['back/test/**/*.test.{ts,mjs}'] },
      },
      {
        extends: true,
        resolve: { alias: { '@': fileURLToPath(new URL('./front/src', import.meta.url)) } },
        test: { name: 'front', include: ['front/test/**/*.test.{tsx,mjs}'] },
      },
    ],
    environment: 'node',
  },
});
