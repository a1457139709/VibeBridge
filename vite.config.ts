import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: 'app/renderer',
  base: './',
  build: { outDir: resolve('dist/renderer'), emptyOutDir: true },
});
