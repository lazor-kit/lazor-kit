#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 || ! -f "$1" || ! -f "$2" ]]; then
  echo "Usage: pnpm staging:kora <baseline-program.so> <hardened-program.so>" >&2
  exit 2
fi

for command in git cargo node solana solana-test-validator; do
  command -v "$command" >/dev/null
done

kora_commit=938b9b26be9a991b0ca591d9b20a8a945843915f
kora_dir=$(mktemp -d "${TMPDIR:-/tmp}/lazorkit-kora-source.XXXXXX")
git -C "$kora_dir" init -q
git -C "$kora_dir" fetch --depth=1 https://github.com/solana-foundation/kora.git "$kora_commit"
git -C "$kora_dir" checkout --quiet --detach FETCH_HEAD
test "$(git -C "$kora_dir" rev-parse HEAD)" = "$kora_commit"
echo "Kora upstream commit $kora_commit in $kora_dir"
(
  cd "$kora_dir"
  CARGO_TARGET_DIR="$kora_dir/target" CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 \
    cargo build --locked --jobs 6 -p kora-cli --bin kora
)
node packages/react-native/test/protocol-v1-kora.staging.mjs "$kora_dir/target/debug/kora" "$1" "$2"
