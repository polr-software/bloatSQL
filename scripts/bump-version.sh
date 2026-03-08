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

# package.json - użyj node żeby uniknąć problemów z CRLF na Windows
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = '$VERSION';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"
echo "  ✓ package.json"

# Cargo.toml - użyj node zamiast sed
node -e "
const fs = require('fs');
let cargo = fs.readFileSync('src-tauri/Cargo.toml', 'utf8');
cargo = cargo.replace(/^version = \".*\"/m, 'version = \"$VERSION\"');
fs.writeFileSync('src-tauri/Cargo.toml', cargo);
"
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
