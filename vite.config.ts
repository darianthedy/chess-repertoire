import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves this project from https://<user>.github.io/chess-repertoire/,
// so assets must be requested from that subpath rather than the domain root.
// Locally (and on any root-domain host) BASE_PATH is unset and we use '/'.
const base = process.env.BASE_PATH ?? '/';

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [react()],
});
