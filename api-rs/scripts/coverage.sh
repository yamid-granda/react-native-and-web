#!/bin/sh
set -eu

# cargo-llvm-cov is an optional install (see README.md prerequisites). When it is
# missing, cargo's own error is a terse "no such command: `llvm-cov`" that names
# neither the tool nor the second, separate requirement — llvm-tools-preview,
# which must be installed *for the pinned toolchain*, not the default one. Probe
# both and fail with the exact commands that fix it, the same way dev.sh handles
# the Xcode license.
sysroot=$(rustc --print sysroot)

if ! cargo llvm-cov --version >/dev/null 2>&1; then
  echo "api-rs: coverage needs cargo-llvm-cov, which is not installed." >&2
  echo "        run: cargo install cargo-llvm-cov" >&2
  exit 1
fi

if ! ls "$sysroot"/lib/rustlib/*/bin/llvm-cov >/dev/null 2>&1; then
  echo "api-rs: llvm-tools-preview is missing for $(rustc --version)." >&2
  echo "        cargo-llvm-cov shells out to llvm-cov from the toolchain, and" >&2
  echo "        rust-toolchain.toml pins 1.99.0 — install it for that toolchain:" >&2
  echo "        run: rustup component add llvm-tools-preview" >&2
  echo "        (listed in rust-toolchain.toml, so any rustup sync provisions it)" >&2
  exit 1
fi

exec cargo llvm-cov --workspace --fail-under-lines 80 --lcov --output-path lcov.info "$@"