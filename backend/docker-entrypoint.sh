#!/bin/sh
# Container entrypoint.
#
# The only job here is to materialise the license signing private key from the
# LICENSE_PRIVATE_KEY_PEM secret into the file the application reads
# (LICENSE_PRIVATE_KEY_PATH). The key therefore never exists inside a Docker
# image or a git repository — it is stored encrypted by Fly and injected as an
# environment variable at start-up.
set -eu

KEY_PATH="${LICENSE_PRIVATE_KEY_PATH:-keys/license-private.pem}"

if [ -n "${LICENSE_PRIVATE_KEY_PEM:-}" ]; then
  KEY_DIR=$(dirname "$KEY_PATH")
  mkdir -p "$KEY_DIR"
  # Write via a temporary file and move it into place so a crash mid-write can
  # never leave a truncated key that would fail to parse on the next boot.
  printf '%s\n' "$LICENSE_PRIVATE_KEY_PEM" > "$KEY_DIR/.key.tmp"
  chmod 600 "$KEY_DIR/.key.tmp"
  mv "$KEY_DIR/.key.tmp" "$KEY_PATH"
  echo "entrypoint: license signing key materialised at $KEY_PATH"
else
  # No secret configured. In development the app generates a throwaway key pair;
  # in production it refuses to boot, which is the intended behaviour.
  echo "entrypoint: LICENSE_PRIVATE_KEY_PEM is not set"
fi

exec "$@"