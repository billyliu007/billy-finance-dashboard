import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: [
      '192.168.50.201.nip.io',
      '192-168-50-201.nip.io',
    ],
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (proxyReq, req) => {
            const host = req.headers.host;
            if (host) {
              proxyReq.setHeader('X-Forwarded-Host', host);
            }
            const proto = req.socket?.encrypted ? 'https' : 'http';
            proxyReq.setHeader('X-Forwarded-Proto', proto);
          });
        },
      },
    },
  },
})
