import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  // Server components under test are compiled JSX. The automatic runtime lets
  // them render without React being manually in scope in every test file.
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
