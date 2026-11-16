import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// ローカルでは SWA CLI（Step 4）が /api を Functions へ中継するため、ここではプロキシ不要。
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: { outDir: 'dist' },
});
