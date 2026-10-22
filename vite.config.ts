import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [cloudflare()],
  // The Worker rejects requests whose origin differs from the development PUBLIC_URL.
  server: { port: 5173, strictPort: true },
});
