import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    rollupOptions: {
      output: {
        // libraries in their own files: they change rarely, so browsers keep them cached
        manualChunks(id) {
          if (id.includes("node_modules/ethers") || id.includes("node_modules/@noble") || id.includes("node_modules/@adraffy")) return "ethers";
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) return "react";
        },
      },
    },
  },
});
