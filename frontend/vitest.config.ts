import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Logica-tests (node-env, geen DOM): de dragende, framework-onafhankelijke helpers.
// De "@/"-alias spiegelt tsconfig.paths zodat imports identiek zijn aan de app.
export default defineConfig({
  resolve: {
    alias: [{ find: /^@\/(.*)$/, replacement: fileURLToPath(new URL("./$1", import.meta.url)) }],
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules", ".next"],
  },
});
