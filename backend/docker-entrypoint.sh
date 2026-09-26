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

if [ -n "${LICENSE_PRIVATE_KEY_PEM_B64:-}" ]; then
  KEY_DIR=$(dirname "$KEY_PATH")
  mkdir -p "$KEY_DIR"
  # The key is transported base64-encoded because `flyctl secrets import`
  # accepts only one-line NAME=VALUE pairs, and a raw PEM is multi-line.
  # Decoding here and validating the result is what makes a corrupted secret
  # fail loudly at boot instead of producing an app that cannot sign.
  printf '%s' "$LICENSE_PRIVATE_KEY_PEM_B64" | base64 -d > "$KEY_DIR/.key.tmp" 2>/dev/null \
    || { echo "entrypoint: LICENSE_PRIVATE_KEY_PEM_B64 is not valid base64" >&2; exit 1; }
  chmod 600 "$KEY_DIR/.key.tmp"
  grep -q -- '-----BEGIN .*PRIVATE KEY-----' "$KEY_DIR/.key.tmp" \
    || { echo "entrypoint: decoded key is not a PEM private key" >&2; rm -f "$KEY_DIR/.key.tmp"; exit 1; }
  # openssl validates the structure, so a truncated key cannot reach the app.
  openssl pkey -in "$KEY_DIR/.key.tmp" -noout \
    || { echo "entrypoint: the private key is malformed" >&2; rm -f "$KEY_DIR/.key.tmp"; exit 1; }
  mv "$KEY_DIR/.key.tmp" "$KEY_PATH"
  echo "entrypoint: license signing key materialised at $KEY_PATH"
elif [ -n "${LICENSE_PRIVATE_KEY_PEM:-}" ]; then
  # Raw PEM fallback for local development.
  KEY_DIR=$(dirname "$KEY_PATH")
  mkdir -p "$KEY_DIR"
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