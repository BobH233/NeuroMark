import path from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@main': path.resolve(__dirname, 'src/main'),
        '@preload': path.resolve(__dirname, 'src/preload'),
      },
    },
    build: {
      outDir: 'dist-electron/main',
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@preload': path.resolve(__dirname, 'src/preload'),
      },
    },
    build: {
      outDir: 'dist-electron/preload',
    },
  },
  renderer: {
    root: path.resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src/renderer/src'),
        '@preload': path.resolve(__dirname, 'src/preload'),
      },
    },
    plugins: [vue()],
    build: {
      outDir: path.resolve(__dirname, 'dist'),
      emptyOutDir: true,
    },
  },
});

