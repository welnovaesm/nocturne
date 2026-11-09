import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'happy-dom',
    // Vitest stubs CSS imports by default; the theme is imported as a raw string.
    css: true,
  },
});
