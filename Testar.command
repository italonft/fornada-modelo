#!/bin/sh
# Mac: dê dois cliques. Se faltar o Node.js, baixa a versão portátil do site oficial para dentro desta pasta.
cd "$(dirname "$0")" || exit 1
NODE=""
if [ -x runtime/node/bin/node ]; then
  NODE="$PWD/runtime/node/bin/node"
elif command -v node >/dev/null 2>&1 && node -e "process.exit(Number(process.versions.node.split('.')[0])>=22?0:1)" >/dev/null 2>&1; then
  NODE="node"
fi
if [ -z "$NODE" ]; then
  echo "Preparando pela primeira vez: baixando o Node.js do site oficial nodejs.org (cerca de 100 MB, só uma vez)."
  sh scripts/baixar-node.sh || exit 1
  NODE="$PWD/runtime/node/bin/node"
fi
if [ -x runtime/node/bin/node ]; then PATH="$PWD/runtime/node/bin:$PATH"; export PATH; fi
"$NODE" scripts/testar.mjs
