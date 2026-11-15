import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      { find: "react-router-dom", replacement: path.resolve(__dirname, "./node_modules/react-router-dom") },
      { find: "lucide-react", replacement: path.resolve(__dirname, "./node_modules/lucide-react") },
      { find: "@supabase/supabase-js", replacement: path.resolve(__dirname, "./node_modules/@supabase/supabase-js") },
    ],
    dedupe: ["react", "react-dom"],
  },
});
