#!/bin/bash
# Release script that bumps version in all package files

set -e

# Get the bump type (patch, minor, major) - default to patch
BUMP_TYPE=${1:-patch}

# Bump root package.json and get new version
npm version $BUMP_TYPE --no-git-tag-version
NEW_VERSION=$(node -p "require('./package.json').version")

echo "Bumping to version $NEW_VERSION"

# Update apps/desktop/package.json
sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$NEW_VERSION\"/" apps/desktop/package.json

# Update apps/desktop/src-tauri/Cargo.toml (first version line only)
sed -i "0,/^version = \"[^\"]*\"/{s/^version = \"[^\"]*\"/version = \"$NEW_VERSION\"/}" apps/desktop/src-tauri/Cargo.toml

# Update apps/desktop/src-tauri/tauri.conf.json
sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$NEW_VERSION\"/" apps/desktop/src-tauri/tauri.conf.json

# Update Cargo.lock
cd apps/desktop/src-tauri && cargo update -p snapit --precise $NEW_VERSION 2>/dev/null || cargo generate-lockfile
cd ../../..

# Commit and tag
git add -A
git commit -m "$NEW_VERSION"
git tag -a "v$NEW_VERSION" -m "v$NEW_VERSION"

echo "Released v$NEW_VERSION"
echo "Run 'git push && git push --tags' to publish"
