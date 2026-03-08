#!/usr/bin/env bash
# Użycie: ./scripts/bump-version.sh 0.1.0
# Lub z prerelease: ./scripts/bump-version.sh 0.1.0-beta.1

set -e

VERSION=$1

if [ -z "$VERSION" ]; then
  echo "Użycie: $0 <nowa-wersja>"
  echo "Przykład: $0 0.1.0"
  echo "Przykład: $0 0.1.0-beta.1"
  exit 1
fi

echo "Bumping version to $VERSION..."

# package.json
sed -i "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" package.json
echo "  ✓ package.json"

# Cargo.toml
sed -i "s/^version = \".*\"/version = \"$VERSION\"/" src-tauri/Cargo.toml
echo "  ✓ src-tauri/Cargo.toml"

# Commit i tag
git add package.json src-tauri/Cargo.toml
git commit -m "chore: bump version to $VERSION"
git tag "v$VERSION"

echo ""
echo "Gotowe! Wersja: $VERSION"
echo ""
echo "Teraz uruchom:"
echo "  git push origin main && git push origin v$VERSION"
echo ""
echo "GitHub Actions automatycznie zbuduje release."
