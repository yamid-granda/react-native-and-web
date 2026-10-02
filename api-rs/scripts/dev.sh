#!/bin/sh
set -eu

# 3001 is the contract port (NestJS holds it during parity work); 3003 keeps
# api-rs side-by-side with NestJS without colliding with Grafana on 3002.
export PORT="${PORT:-3003}"

# Until the Xcode license is accepted, every build script and proc-macro fails
# at link time with dozens of identical "You have not agreed to the Xcode
# license agreements" errors — one per crate, none of which say what to do.
# The linker needs the SDK path for exactly this reason, so probe it first and
# fail with the single command that actually fixes it.
if [ "$(uname -s)" = "Darwin" ] && ! xcrun --show-sdk-path >/dev/null 2>&1; then
  echo "api-rs: cannot link, the Xcode license has not been accepted." >&2
  echo "        run: sudo xcodebuild -license accept" >&2
  exit 1
fi

if command -v cargo-watch >/dev/null 2>&1; then
  exec cargo watch -x run
fi

exec cargo run
