import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { viteStaticCopy } from "vite-plugin-static-copy";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
    viteStaticCopy({
      targets: [
        {
          src: "node_modules/manifold-3d/manifold.wasm",
          dest: ".",
        },
      ],
    }),
  ],
  resolve: {
    dedupe: ["react", "react-dom", "three"],
  },
  optimizeDeps: {
    exclude: ["manifold-3d", "loro-crdt"],
    include: ["@manifold-studio/react-manifold > react-reconciler"],
  },
  build: {
    commonjsOptions: {
      include: [/manifold-3d/, /node_modules/],
    },
  },
});
