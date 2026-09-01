import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Builds the standalone feed site (deployed onto the `feed` branch's GitHub
// Pages root alongside feed.json, published separately by publish-feed.ts).
export default defineConfig({
  root: import.meta.dirname,
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
