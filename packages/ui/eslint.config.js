// Use relative import to bypass broken workspace symlinks on Windows
import { base } from "../config-eslint/index.js";

export default [
  {
    ignores: ["node_modules/**", "dist/**"],
  },
  ...base,
  {
    // cwd-agnostic glob: matches both `src/...` (lint from this package) and
    // `packages/ui/src/...` (lint-staged pre-commit runs from the repo root).
    files: ["**/src/**/*.{ts,tsx}"],
    rules: {
      // UI components export variants alongside components
      "react-refresh/only-export-components": "off",
    },
  },
];
