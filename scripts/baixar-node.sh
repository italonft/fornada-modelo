#!/bin/sh
# Baixa o Node.js portátil do site oficial, confere a assinatura SHA-256 e guarda em runtime/node.
# Não instala nada no sistema: apagar a pasta do Fornada remove tudo.
cd "$(dirname "$0")/.." || exit 1
fail() { echo ""; echo "$1"; echo "Instale a versão LTS em https://nodejs.org e abra este arquivo de novo."; exit 1; }
case "$(uname -s)" in Darwin) PLAT=darwin ;; Linux) PLAT=linux ;; *) fail "Sistema não reconhecido." ;; esac
case "$(uname -m)" in arm64 | aarch64) ARCH=arm64 ;; x86_64 | amd64) ARCH=x64 ;; *) fail "Processador não reconhecido." ;; esac
BASE="https://nodejs.org/dist/latest-v22.x"
LINE=$(curl -fsSL "$BASE/SHASUMS256.txt" | grep -E "node-v[0-9.]+-$PLAT-$ARCH\.tar\.gz$" | head -n 1)
[ -n "$LINE" ] || fail "Não consegui consultar a versão do Node.js."
EXPECTED=${LINE%% *}
FILE=${LINE##* }
TMP=$(mktemp -d) || fail "Não consegui criar uma pasta temporária."
curl -fL "$BASE/$FILE" -o "$TMP/$FILE" || fail "Não consegui baixar o Node.js."
if command -v shasum >/dev/null 2>&1; then ACTUAL=$(shasum -a 256 "$TMP/$FILE" | cut -d ' ' -f 1); else ACTUAL=$(sha256sum "$TMP/$FILE" | cut -d ' ' -f 1); fi
[ "$ACTUAL" = "$EXPECTED" ] || fail "O arquivo baixado não confere com a assinatura oficial."
[ -d runtime/node ] && mv runtime/node "runtime/node-antigo-$$"
mkdir -p runtime
tar xzf "$TMP/$FILE" -C runtime || fail "Não consegui extrair o Node.js."
mv runtime/node-v*-"$PLAT"-"$ARCH" runtime/node
echo "Node.js pronto."
