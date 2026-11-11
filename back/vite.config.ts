import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { config } from './src/config.ts';

export default defineConfig(({ mode }) => {
  const local = mode === 'production' ? {} : loadEnv(mode, import.meta.dirname, '');
  const define = Object.fromEntries(
    Object.keys(config).map((key) => [
      `import.meta.env.${key}`,
      mode === 'production'
        ? `process.env.${key}`
        : `(process.env.${key} ?? ${JSON.stringify(local[key]) ?? 'undefined'})`,
    ]),
  );

  return {
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    envDir: false,
    define,
    ssr: { noExternal: true },
    build: {
      ssr: 'src/handler.ts',
      target: 'node22',
      minify: false,
      rolldownOptions: {
        output: {
          format: 'cjs',
          entryFileNames: 'handler.cjs',
          codeSplitting: false,
        },
      },
    },
  };
});
