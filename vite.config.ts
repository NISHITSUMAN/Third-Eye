// The Lovable Vite wrapper supplies the normal TanStack Start, React, Tailwind,
// path-alias and Nitro plugins. On Vercel, explicitly override its Cloudflare default:
// Vercel needs its own Build Output API directory for static Cesium assets and functions.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { loadEnv, type ConfigEnv, type UserConfig } from "vite";
import { fileURLToPath } from "node:url";

const resolveDashboardPackage = (packagePath: string) =>
  fileURLToPath(new URL(`./node_modules/${packagePath}`, import.meta.url));
const isVercel = process.env["VERCEL"] === "1" || process.env["VERCEL"] === "true";
const loadLocalGroqEnv = {
  name: "load-local-groq-server-env",
  config(_config: UserConfig, { command, mode }: ConfigEnv) {
    if (command !== "serve") return;
    // Vite loads .env into import.meta.env; bridge only the server-only Groq values into Node.
    const env = loadEnv(mode, process.cwd(), "");
    for (const name of ["GROQ_API_KEY", "GROQ_MODEL"]) {
      if (!process.env[name] && env[name]) process.env[name] = env[name];
    }
  },
};

export default defineConfig({
  vite: {
    plugins: [loadLocalGroqEnv],
    // Keep Cesium's runtime resources in the public tree for both local and hosted builds.
    publicDir: "public",
    resolve: {
      alias: [
        { find: "react-router-dom", replacement: resolveDashboardPackage("react-router-dom") },
        { find: "lucide-react", replacement: resolveDashboardPackage("lucide-react") },
        { find: "@supabase/supabase-js", replacement: resolveDashboardPackage("@supabase/supabase-js") },
      ],
      dedupe: ["react", "react-dom"],
    },
    define: {
      CESIUM_BASE_URL: JSON.stringify("/cesium"),
    },
  },
  ...(isVercel
    ? {
        nitro: {
          preset: "vercel",
          output: {
            dir: ".vercel/output",
            serverDir: ".vercel/output/functions/__server.func",
            publicDir: ".vercel/output/static",
          },
        },
      }
    : {}),
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    server: { entry: "server" },
  },
});
