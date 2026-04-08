import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3020,
    proxy: {
      '/api': {
        target: 'http://localhost:8020',
        changeOrigin: true,
        secure: false,
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, _res) => {
            console.error(`[Vite Proxy] API proxy error: ${(err as Error).message}`);
            console.error('[Vite Proxy] Is the backend running? Run: cd backend && npm run dev');
          });
          proxy.on('proxyRes', (proxyRes, _req, _res) => {
            if (proxyRes.statusCode === 503 || proxyRes.statusCode === 502) {
              console.error('[Vite Proxy] Backend returned error status:', proxyRes.statusCode);
            }
          });
        }
      },
      '/socket.io': {
        target: 'http://localhost:8020',
        ws: true,
        changeOrigin: true,
        secure: false,
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, _res) => {
            const errMsg = (err as Error).message;
            // Suppress ECONNRESET errors (normal during dev)
            if (!errMsg.includes('ECONNRESET')) {
              console.error(`[Vite Proxy] WS proxy error: ${errMsg}`);
            }
          });
        }
      }
    }
  },
  build: {
    outDir: '../backend/public',
    emptyOutDir: true
  }
})
