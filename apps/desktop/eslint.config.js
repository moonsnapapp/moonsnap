// Use relative import to bypass broken workspace symlinks on Windows
// (Bun creates junctions that Node.js/ESLint can't traverse)
import { base, react, testFiles } from "../../packages/config-eslint/index.js";

export default [
  // Ignore patterns
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "src-tauri/**",
      "src/types/generated/**",
    ],
  },

  // Base rules
  ...base,

  // React rules for src files
  ...react.map((config) => ({
    ...config,
    files: ["src/**/*.{ts,tsx}"],
  })),

  // Test file rules
  ...testFiles,

  // UI components (shadcn/ui pattern) - allow exporting variants alongside components
  {
    files: ["src/components/ui/**/*.{ts,tsx}"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },

  // Library components - exports helper functions alongside components
  {
    files: ["src/components/Library/**/*.{ts,tsx}"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
];
