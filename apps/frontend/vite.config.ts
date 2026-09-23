import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import tailwind from "@tailwindcss/vite";

export default defineConfig({
  plugins: [vue(), tailwind()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.spec.ts"],
    restoreMocks: true,
  },
  build: { sourcemap: false },
});
