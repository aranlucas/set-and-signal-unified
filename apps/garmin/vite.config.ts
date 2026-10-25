import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [cloudflare()],
  // Keep a predictable URL for local development.
  server: { port: 5173, strictPort: true },
});
