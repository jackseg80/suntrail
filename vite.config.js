import { defineConfig } from 'vite';
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  // Base URL essentielle pour GitHub Pages (nom du dépôt)
  base: '/suntrail/',
  plugins: [
    topLevelAwait({
      promiseExportName: "__tla",
      promiseImportName: i => `__tla_${i}`
    })
  ],
  build: {
    target: 'esnext'
  }
});
