import path from 'node:path';
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer/src'),
      '@preload': path.resolve(__dirname, 'src/preload'),
    },
  },
  test: {
    environment: 'node',
  },
});
