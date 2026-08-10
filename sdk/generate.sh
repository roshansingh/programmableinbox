#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v java >/dev/null 2>&1; then
  if [ -x "/opt/homebrew/opt/openjdk/bin/java" ]; then
    export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"
  elif [ -x "/usr/local/opt/openjdk/bin/java" ]; then
    export PATH="/usr/local/opt/openjdk/bin:$PATH"
  else
    echo "error: java not found on PATH. openapi-generator-cli needs JDK 11+." >&2
    echo "Install with: brew install openjdk" >&2
    exit 1
  fi
fi

echo "==> Exporting OpenAPI spec"
npm run --silent sdk:export-spec

GEN="npx --no-install openapi-generator-cli generate"

echo "==> Generating Python SDK"
$GEN -i sdk/openapi.json -g python -o sdk/python -c sdk/openapi-generator-config/python.yaml

echo "==> Generating Go SDK"
$GEN -i sdk/openapi.json -g go -o sdk/go -c sdk/openapi-generator-config/go.yaml

echo "==> Generating TypeScript SDK"
$GEN -i sdk/openapi.json -g typescript-fetch -o sdk/typescript -c sdk/openapi-generator-config/typescript.yaml

echo "==> Generating Java SDK"
$GEN -i sdk/openapi.json -g java -o sdk/java -c sdk/openapi-generator-config/java.yaml

echo "==> Generating C# SDK"
$GEN -i sdk/openapi.json -g csharp -o sdk/csharp -c sdk/openapi-generator-config/csharp.yaml

echo "==> Done. Review with: git status sdk/"
