import { base } from "@snapit/config-eslint";

export default [
  {
    ignores: ["node_modules/**", "dist/**"],
  },
  ...base,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      // UI components export variants alongside components
      "react-refresh/only-export-components": "off",
    },
  },
];
