import { defineConfig } from 'vite';

// base './' : le jeu fonctionne depuis n'importe quel sous-dossier (GitHub Pages, Cloudflare Pages…).
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: { phaser: ['phaser'] },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
} as any);
