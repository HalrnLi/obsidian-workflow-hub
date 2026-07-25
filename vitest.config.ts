import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    setupFiles: [path.resolve(__dirname, 'tests/setup.ts')],
  },
  resolve: {
    alias: {
      obsidian: path.resolve(__dirname, 'tests/mocks/obsidian.ts'),
    },
    extensions: ['.ts', '.js', '.json'],
  },
});
