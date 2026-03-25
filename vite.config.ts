import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: path.resolve(__dirname, 'node_modules/@runanywhere/web-llamacpp/wasm/*').replace(/\\/g, '/'),
          dest: 'wasm'
        }
      ]
    })
  ],
  optimizeDeps: {
    exclude: ['@runanywhere/web', '@runanywhere/web-llamacpp'],
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
    fs: {
      allow: ['..'],
    },
  },
});