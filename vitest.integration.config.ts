import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Testy integracyjne sa oddzielone od jednostkowych celowo: `npm test` ma
// pozostac szybki i dzialac bez Dockera. Ten zestaw wymaga `npx supabase start`.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    // Zalozenie dwoch kont plus kilka zapytan nie miesci sie w domyslnych 5 s.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
