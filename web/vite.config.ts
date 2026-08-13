import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  server: {
    port: 3010,
    host: '0.0.0.0',
    proxy: {
      '/api': 'http://localhost:3011',
      '/report': 'http://localhost:3011',
    },
  },
  plugins: [react()],
});
