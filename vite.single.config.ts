import { defineConfig } from 'vite';

// Variante « un seul fichier » : tout le jeu dans un script classique, pour l'intégrer dans une page unique
// (aperçu partagé, hébergement minimal). Voir tools/make-single.mjs.
export default defineConfig({
  base: './',
  define: { 'import.meta.env.VITE_SINGLE_FILE': JSON.stringify('1') },
  build: {
    target: 'es2020',
    outDir: 'single/build',
    emptyOutDir: true,
    copyPublicDir: false,
    chunkSizeWarningLimit: 4000,
    cssCodeSplit: false, // une seule feuille de styles, intégrée dans la page par make-single.mjs
    rollupOptions: {
      output: { format: 'iife', inlineDynamicImports: true, entryFileNames: 'klaxo.js', assetFileNames: 'klaxo[extname]' },
    },
  },
});
