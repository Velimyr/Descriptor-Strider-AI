// Окрема Vite-конфігурація для бандла віджета.
// Збірка: `npm run build:widget` → dist/widget/widget.js (один IIFE-файл).
// CSS інлайниться у JS-бандл (?inline import) і потім вставляється у shadow root.
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/widget',
    emptyOutDir: true,
    lib: {
      entry: path.resolve(__dirname, 'widget/entry.tsx'),
      name: 'BlukachWidget',
      formats: ['iife'],
      fileName: () => 'widget.js',
    },
    rollupOptions: {
      output: {
        // Усе в одному файлі — без чанків та окремого CSS.
        inlineDynamicImports: true,
        assetFileNames: 'widget.[ext]',
      },
    },
    // Базова мініфікація вистачає для CSS-in-JS.
    cssCodeSplit: false,
    minify: 'esbuild',
    // Інлайнимо в JS усі ассети до 100KB (логотип ~33KB) — щоб бандл був
    // самодостатнім і не вимагав окремих запитів.
    assetsInlineLimit: 100_000,
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
});
