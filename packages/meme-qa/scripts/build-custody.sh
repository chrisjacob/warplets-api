#!/usr/bin/env bash
set -euo pipefail
task_root="$(git rev-parse --show-toplevel)"
source_dir="$task_root/.tmp/squads-source"
test "$(git -C "$source_dir" rev-parse HEAD)" = af94153ff77a28b6effe46b9c94baaa93742b48c
test -z "$(git -C "$source_dir" status --porcelain)"
mkdir -p "$task_root/.tmp/squads-tools" "$task_root/.tmp/squads-build" "$task_root/.tmp/meme-qa/custody"
archive="$task_root/.tmp/squads-tools/agave-3.0.10.tar.bz2"
curl --fail --location --proto '=https' --tlsv1.2 'https://github.com/anza-xyz/agave/releases/download/v3.0.10/solana-release-x86_64-unknown-linux-gnu.tar.bz2' --output "$archive"
echo "d9de0816fc9cf7921584ae7d6fe9037c8c1ad15b44bcd3e397e1e60e23f63ffe  $archive" | sha256sum --check --status
tar -xjf "$archive" -C "$task_root/.tmp/squads-tools"
export PATH="$task_root/.tmp/squads-tools/solana-release/bin:$PATH"
cargo-build-sbf --manifest-path "$source_dir/programs/squads_multisig_program/Cargo.toml" --sbf-out-dir "$task_root/.tmp/squads-build" -- --locked
sha256sum "$task_root/.tmp/squads-build/squads_multisig_program.so" > "$task_root/.tmp/meme-qa/custody/source-build.sha256"
printf '%s\n' 'Upstream source af94153ff77a28b6effe46b9c94baaa93742b48c; Agave 3.0.10; no testing feature or program-ID rewrite; deployed-mainnet binary equivalence NOT established.' > "$task_root/.tmp/meme-qa/custody/provenance.txt"
