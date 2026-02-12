// Use relative import to bypass broken workspace symlinks on Windows
import { base } from "../config-eslint/index.js";

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
