# Diagnose Skill

A structured bug investigation workflow that ensures findings are documented even when investigations end early.

## Invocation

- `/diagnose` - Start a diagnostic investigation
- `/diagnose [error message or symptom]` - Start with specific context

## Workflow

### Phase 1: Gather Context

Before diving into code, capture the current state:

1. **Error Information**
   - Exact error message (if any)
   - Stack trace or logs
   - When it started occurring

2. **Recent Changes**
   - Run `git log --oneline -10` to see recent commits
   - Check if issue correlates with specific changes

3. **Environment State**
   - Which files are currently modified (`git status`)
   - Any build errors (`bun run typecheck`)

### Phase 2: Create Investigation Checklist

Create TODO items for each hypothesis to test:

```
[ ] Hypothesis 1: [description]
[ ] Hypothesis 2: [description]
[ ] Check if issue reproduces in [conditions]
```

### Phase 3: Systematic Testing

For each hypothesis:
1. Mark the TODO as in-progress
2. Gather evidence (code, logs, tests)
3. Document findings inline
4. Mark as completed with result

### Phase 4: Summary (REQUIRED)

**CRITICAL**: Before ending ANY diagnostic session, always provide a summary:

```markdown
## Diagnostic Summary

**Problem**: [brief description]

**Investigated**:
- [x] Hypothesis 1 - [result: confirmed/ruled out/inconclusive]
- [x] Hypothesis 2 - [result]
- [ ] Hypothesis 3 - [not tested, reason]

**Findings**:
- [key finding 1]
- [key finding 2]

**Root Cause**: [if found] / **Status**: [if not found - what's next]

**Recommended Fix**: [if applicable]
```

## Rules

1. **Never end without a summary** - Even if interrupted or context-switching
2. **Document as you go** - Update TODO items with findings immediately
3. **Preserve uncertainty** - Mark hypotheses as "inconclusive" rather than guessing
4. **Link to evidence** - Reference specific files, line numbers, log entries

## Example Usage

User: `/diagnose the video preview freezes when switching segments`

Claude:
1. Gathers recent git history and current errors
2. Creates TODOs:
   - [ ] Check segment transition handlers
   - [ ] Verify video element lifecycle
   - [ ] Look for race conditions in state updates
3. Investigates each systematically
4. Provides summary with findings and recommended fix
