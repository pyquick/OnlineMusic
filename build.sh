docker-compose build
docker-compose up -d
# Trust the certificate the container generated, so browsers and the .app accept the https
# address without a warning. macOS only, and only the current user's keychain; run
# `./scripts/trust-cert.sh --system` once for every user on the Mac.
if command -v security >/dev/null 2>&1; then
  ./scripts/trust-cert.sh || echo "certificate trust not installed — run ./scripts/trust-cert.sh by hand"
fi
