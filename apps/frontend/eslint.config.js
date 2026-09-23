import vue from "eslint-plugin-vue";
import ts from "typescript-eslint";
export default [
  {
    ignores: [
      "dist/**",
      ".openapi-build/**",
      "src/shared/api/schema.d.ts",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  ...ts.configs.recommended,
  ...vue.configs["flat/recommended"],
  {
    files: ["**/*.vue"],
    languageOptions: { parserOptions: { parser: ts.parser } },
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "vue/multi-word-component-names": "off",
      "vue/max-attributes-per-line": "off",
      "vue/singleline-html-element-content-newline": "off",
      "vue/html-self-closing": "off",
    },
  },
];
