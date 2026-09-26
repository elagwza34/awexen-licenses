import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * Fails the production build when VITE_API_BASE_URL is missing.
 *
 * Vite replaces `import.meta.env.VITE_API_BASE_URL` at build time. When the
 * variable is absent the code in src/lib/api.ts falls back to the relative
 * '/api/v1', and the deployed panel then requests the Pages origin instead of
 * the API: every call fails with a 404 that looks like a backend outage, and
 * nothing in the build output says so. Vite also loads .env files silently, so
 * a stale local .env can pin the bundle to the wrong API for good.
 */
function requireApiBaseUrl(): Plugin {
  return {
    name: 'require-api-base-url',
    // Runs before the module graph is transformed, i.e. before the value is
    // frozen into the bundle.
    configResolved(config) {
      const mode = config.mode;
      if (mode === 'development') return;
      const base = config.env.VITE_API_BASE_URL;
      if (base) return;
      throw new Error(
        `VITE_API_BASE_URL is not set for the "${mode}" build.\n` +
          `The bundle would fall back to the relative path "/api/v1" and every ` +
          `API call would 404 against the panel origin.\n` +
          `Set it before building, for example:\n` +
          `  $env:VITE_API_BASE_URL='https://api.awexen.com/api/v1'; npm run build`,
      );
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), requireApiBaseUrl()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    host: true,
    // The API runs on a different origin in development. Proxying keeps the
    // browser same-origin so the refresh-token cookie works without exceptions.
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY ?? 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          query: ['@tanstack/react-query'],
        },
      },
    },
  },
});
