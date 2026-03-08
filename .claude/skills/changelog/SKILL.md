---
name: changelog
description: Generate or update the CHANGELOG.md entry for the next release based on commits since the last tag
user-invocable: true
---

# Changelog Generator

Generate or update the CHANGELOG.md entry for the upcoming release by analyzing commits since the last version tag.

## Steps

### 1. Determine the version range

```bash
cd E:/moonsnap

# Get the latest version tag and the current version from package.json
LATEST_TAG=$(git tag --sort=-version:refname | head -1)
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "Latest tag: $LATEST_TAG"
echo "Current package.json version: $CURRENT_VERSION"
```

### 2. Gather commits since the last tag

```bash
cd E:/moonsnap
LATEST_TAG=$(git tag --sort=-version:refname | head -1)

# Show commits since the last tag (these are unreleased changes)
git log "$LATEST_TAG"..HEAD --oneline --no-merges
```

If the argument is `--current` or a version like `0.5.4`, also include commits already in the current tag:

```bash
# For re-generating the current release entry
git log "$(git tag --sort=-version:refname | sed -n '2p')"..HEAD --oneline --no-merges
```

### 3. Read the existing CHANGELOG.md

Read `E:/moonsnap/CHANGELOG.md` to understand the current entries and writing style.

### 4. Generate the changelog entry

Classify each commit into Keep a Changelog sections:

| Prefix | Section |
|--------|---------|
| `feat:` | **Added** |
| `fix:` | **Fixed** |
| `perf:`, optimization commits | **Changed** |
| `refactor:`, `chore:` with user-visible impact | **Changed** |
| `docs:`, `chore:`, `ci:`, `test:` | Skip (not user-facing) |

**Writing rules:**
- Write from the **user's perspective**, not the developer's. Describe what changed for the user, not what code was modified.
- Each bullet should be a single concise sentence ending with a period.
- Group related commits into one bullet when they address the same feature/fix.
- Use present tense ("Add", "Fix", "Improve") not past tense.
- Skip internal refactors, CI changes, and test-only commits unless they have user-visible impact.
- Match the tone and style of existing entries in CHANGELOG.md.

### 5. Determine the version number

- If the user provided a version argument (e.g., `/changelog 0.5.4`), use that.
- If there are unreleased commits (commits after the latest tag), compute the next patch version by bumping the **latest tag's** patch number (e.g., `v0.5.8-beta.2` → `0.5.9`). Do NOT use `package.json` version, as it may already reflect the tagged release.
- If there are no unreleased commits, re-generate the entry for the current version (derived from the latest tag).

### 6. Write the entry

- If an entry for this version already exists in CHANGELOG.md, **replace it** with the updated one.
- If no entry exists, insert a new `## [X.Y.Z] - YYYY-MM-DD` section at the top (below the header), using today's date. Entries must be in **descending version order** (newest first).
- After editing CHANGELOG.md, rebuild the JSON:

```bash
cd E:/moonsnap && node scripts/build-changelog-json.cjs
```

### 7. Show the result

Display the generated/updated entry and remind the user to review it before committing. The entry is a draft — the user should adjust wording as needed.

---

## Audit Mode (`/changelog --audit`)

Review and clean up existing CHANGELOG.md entries by removing or rewriting non-user-facing items.

### Audit Steps

#### 1. Read the full CHANGELOG.md

Read `E:/moonsnap/CHANGELOG.md` and examine every entry.

#### 2. Identify non-user-facing items

Flag entries that match these patterns:

| Pattern | Action |
|---------|--------|
| CI/CD workflow changes | **Remove** |
| Test additions/fixes (no user impact) | **Remove** |
| Internal refactors (component extraction, module splits) | **Remove** |
| Dependency/tooling maintenance | **Remove** |
| Build configuration changes | **Remove** |
| Code quality (linting, `unwrap` cleanup, debug code removal) | **Remove** unless it fixes crashes |
| Developer scripts/tooling | **Remove** |
| `ts-rs` path changes, TypeScript config, ESLint config | **Remove** |
| Version sync, release mirroring internals | **Remove** |
| Developer-facing language for user-visible changes | **Rewrite** from user perspective |
| Implementation details (`wgpu`, `scap`, `NV12`, `swscale`) | **Rewrite** without jargon |

#### 3. Handle empty versions

If all entries in a version are removed, **delete the entire version section**. These represent releases with no user-facing changes.

#### 4. Rewrite developer-facing descriptions

When an entry describes a real user-facing improvement but uses developer language:
- Replace implementation details with user-visible outcomes
- Example: "NV12 GPU decode path to reduce CPU swscale overhead" → "Faster video decoding with GPU-accelerated path."
- Example: "Replaced WASM text renderer with native `wgpu` surface" → "Faster text rendering with native GPU path."

#### 5. Apply changes

Edit CHANGELOG.md with all removals and rewrites, then rebuild the JSON:

```bash
cd E:/moonsnap && node scripts/build-changelog-json.cjs
```

#### 6. Show a summary

List what was removed, rewritten, and which versions were deleted. Remind the user to review before committing.
