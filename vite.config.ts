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
          // We use path.resolve to find the EXACT folder on your hard drive
          src: path.resolve(__dirname, 'node_modules/@runanywhere/web-llamacpp/dist/wasm/*').replace(/\\/g, '/'),
          dest: 'wasm'
        }
      ]
    })
  ],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  }
});