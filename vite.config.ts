import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative asset paths, so the built app runs from any directory without being
// rebuilt for it: github.io/<repo>/, a CDN mirror of the gh-pages branch, a
// local `file://` open, or the domain root. Previously the base path was baked
// in at build time from BASE_PATH, which tied a build to one host.
//
// Safe while there's no client-side routing. If nested routes are ever added,
// deep links will need either a hash router or a build-time absolute base.
export default defineConfig({
  base: './',
  plugins: [react()],
});
