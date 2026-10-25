#!/usr/bin/env bash
# Creates the self-signed code-signing identity that release builds are signed with and puts it
# in the login keychain. macOS ties Diktatorn's permissions to this certificate rather than to
# one build, so an update signed with the same certificate keeps them. Run it once per signing
# Mac, then back the identity up (Keychain Access → My Certificates → Export, .p12): signing
# with a new certificate makes every user grant Accessibility again.
set -euo pipefail

NAME="${1:-Diktatorn Code Signing}"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
# The system LibreSSL writes a .p12 that the keychain imports; OpenSSL 3's default does not.
OPENSSL=/usr/bin/openssl

if security find-certificate -c "$NAME" "$KEYCHAIN" >/dev/null 2>&1; then
  echo "A certificate named \"$NAME\" is already in the login keychain; nothing to do." >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat >"$TMP/cert.cnf" <<EOF
[req]
distinguished_name = dn
prompt = no
x509_extensions = ext
[dn]
CN = $NAME
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
subjectKeyIdentifier = hash
EOF

"$OPENSSL" req -x509 -newkey rsa:3072 -nodes -sha256 -days 7300 -config "$TMP/cert.cnf" \
  -keyout "$TMP/key.pem" -out "$TMP/cert.pem" 2>/dev/null
# The .p12 only carries the key into the keychain and is deleted on exit, so its password is
# random and never shown.
P12_PASSWORD="$("$OPENSSL" rand -hex 16)"
"$OPENSSL" pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -name "$NAME" \
  -passout "pass:$P12_PASSWORD" -out "$TMP/identity.p12"
security import "$TMP/identity.p12" -k "$KEYCHAIN" -P "$P12_PASSWORD" -T /usr/bin/codesign

echo "Created \"$NAME\" in the login keychain. Certificate SHA-256:"
"$OPENSSL" x509 -in "$TMP/cert.pem" -noout -fingerprint -sha256
