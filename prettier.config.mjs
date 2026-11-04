/** @type {import('prettier').Config & import('prettier-plugin-tailwindcss').PluginOptions} */
export default {
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: true,
  jsxSingleQuote: false,
  trailingComma: 'all',
  printWidth: 100,
  objectWrap: 'preserve',
  endOfLine: 'lf',
  proseWrap: 'preserve',
  plugins: ['prettier-plugin-tailwindcss'],
  tailwindStylesheet: './front/src/index.css',
  tailwindFunctions: ['cn', 'clsx', 'cva'],
};
