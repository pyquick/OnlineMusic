#!/bin/sh
# Trusts the certificate the Docker deployment generated, so this Mac accepts
# https://<TLS_HOSTS>:3000 without a warning — Safari, Chrome and the desktop .app all read the
# same system trust store. Run it once per certificate: a fresh data volume issues a new one.
# `build.sh` calls it after every deploy; running it again is harmless.
#
#   ./scripts/trust-cert.sh            # this user's keychain, no admin needed
#   ./scripts/trust-cert.sh --system   # every user on the Mac, asks for an admin password
#
# The certificate is kept at $TMPDIR/onlinemusic-server-cert.pem for reference and removal:
#   security remove-trusted-cert [-d] "$TMPDIR/onlinemusic-server-cert.pem"
set -e

CONTAINER=${CONTAINER:-onlinemusic-web-1}
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
DOMAIN=""
if [ "$1" = "--system" ]; then
  KEYCHAIN="/Library/Keychains/System.keychain"
  DOMAIN="-d"
fi

CERT="${TMPDIR:-/tmp}/onlinemusic-server-cert.pem"
# The container generates the certificate as it starts, so a deploy may race it: retry briefly.
attempt=0
until docker cp "$CONTAINER:/app/data/certs/cert.pem" "$CERT" 2>/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 15 ]; then
    echo "no certificate at $CONTAINER:/app/data/certs/cert.pem — is the container running?" >&2
    exit 1
  fi
  sleep 1
done
security add-trusted-cert $DOMAIN -r trustRoot -p ssl -k "$KEYCHAIN" "$CERT"

echo "trusted $(openssl x509 -in "$CERT" -noout -subject | sed 's/^subject=//') on $KEYCHAIN"
echo "the certificate itself is at $CERT"
