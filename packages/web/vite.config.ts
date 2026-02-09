import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      protocolImports: true,
    }),
  ],
  build: {
    target: "esnext",
  },
  optimizeDeps: {
    esbuildOptions: { target: "esnext" },
    exclude: ["@aztec/bb.js", "@noir-lang/noir_js", "@noir-lang/acvm_js", "@noir-lang/noirc_abi"],
  },
  resolve: {
    alias: {
      pino: "pino/browser.js",
    },
  },
  server: {
    port: 3000,
    headers: {
      "Cross-Origin-Embedder-Policy": "credentialless",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
    fs: {
      allow: ["../.."],
    },
  },
});
