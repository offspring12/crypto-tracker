import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/crypto-tracker/', // Replace with your repository name
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  define: {
    'process.env.API_KEY': JSON.stringify(process.env.VITE_API_KEY || ''),
  },
});