import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Relative asset paths, so the built app runs from any directory without being
// rebuilt for it: github.io/<repo>/, a CDN mirror of the gh-pages branch, a
// local `file://` open, or the domain root.
//
// Safe while there's no client-side routing. If nested routes are ever added,
// deep links will need either a hash router or a build-time absolute base.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      // The app is a daily habit, so a stale shell is worse than a reload:
      // take the new service worker immediately rather than waiting for every
      // tab to close.
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Chess Repertoire',
        short_name: 'Repertoire',
        description:
          'Annotated opening repertoires with spaced-repetition drilling.',
        theme_color: '#16171d',
        background_color: '#16171d',
        display: 'standalone',
        orientation: 'portrait',
        // Relative, to match the base path and keep the app installable from a
        // subpath such as /chess-repertoire/.
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // Everything is client-side, so any navigation resolves to the shell.
        navigateFallback: 'index.html',
        // The whole point of installing is drilling on a train with no signal;
        // API calls to chess.com and Lichess are deliberately left uncached so
        // they fail honestly offline rather than serving stale games.
        runtimeCaching: [],
      },
    }),
  ],
});
