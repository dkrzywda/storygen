import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

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
  },
});
