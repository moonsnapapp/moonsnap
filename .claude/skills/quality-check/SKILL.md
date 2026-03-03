---
name: quality-check
description: Run full quality suite (typecheck, lint, test) before push
user-invocable: true
---

Run the complete quality validation suite for MoonSnap:

```bash
cd E:/moonsnap && bun run typecheck && bun run lint && bun run test:run
```

After running:
1. If all checks pass, confirm the codebase is ready for push
2. If any check fails, summarize the failures with:
   - File paths and line numbers
   - Brief description of each issue
   - Suggested fixes where obvious
3. Group failures by type (TypeScript errors, lint violations, test failures)
