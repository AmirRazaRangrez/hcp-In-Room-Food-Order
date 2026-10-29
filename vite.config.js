import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'copy-guest-order-html',
      closeBundle() {
        try {
          const distDir = path.resolve(__dirname, 'dist');
          const indexHtml = path.resolve(distDir, 'index.html');
          if (fs.existsSync(indexHtml)) {
            fs.copyFileSync(indexHtml, path.resolve(distDir, 'guest-order.html'));
            const subDir = path.resolve(distDir, 'guest-order');
            if (!fs.existsSync(subDir)) fs.mkdirSync(subDir, { recursive: true });
            fs.copyFileSync(indexHtml, path.resolve(subDir, 'index.html'));
          }
        } catch (e) {
          console.error('Error copying guest-order HTML:', e);
        }
      }
    }
  ],
  server: {
    port: 5174
  }
});
