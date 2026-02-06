import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
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
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    exclude: ["manifold-3d"],
    include: ["@manifold-studio/react-manifold > react-reconciler"],
  },
  build: {
    commonjsOptions: {
      include: [/manifold-3d/, /node_modules/],
    },
  },
});
