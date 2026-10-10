/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // Unit tests never inherit the committed production backend environment (#1486).
    env: {
      VITE_SUPABASE_URL: "https://unit-test.invalid",
      VITE_SUPABASE_PUBLISHABLE_KEY: "unit-test-public-key",
    },
    setupFiles: ["./src/test/unit-network.setup.ts"],
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    css: false,
  },
});
