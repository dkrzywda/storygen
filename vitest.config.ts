import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Lustrzane odbicie `paths` z tsconfig.json — testy muszą rozwiązywać `@/*`
    // tak samo jak aplikacja, inaczej importy w testach rozjeżdżają się z kodem.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Bez tego `*.integration.test.ts` wpadaloby tutaj i `npm test` zaczalby
    // wymagac Dockera. Testy integracyjne maja wlasna konfiguracje.
    exclude: [...configDefaults.exclude, "**/*.integration.test.ts"],
  },
});
