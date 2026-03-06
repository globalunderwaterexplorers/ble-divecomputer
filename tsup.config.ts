import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: false, // don't delete dist/wasm/
  outDir: 'dist',
  splitting: false,
  sourcemap: true,
});
