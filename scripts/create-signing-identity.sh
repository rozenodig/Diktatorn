#!/usr/bin/env bash
# Creates the self-signed code-signing identities Diktatorn is signed with:
#
#   create-signing-identity.sh                  the release identity
#   create-signing-identity.sh --import FILE    moves or restores the release identity from a .p12
#   create-signing-identity.sh --dev            the identity development builds are signed with
#
# macOS ties Diktatorn's permissions to the release certificate rather than to one build, so an
# update signed with it keeps them. Whoever holds its key can therefore sign an "update" that keeps
# every user's Microphone and Accessibility. The key lives in a keychain of its own, which locks
# after five minutes and when the Mac sleeps and is only unlocked by npm run package. It is kept off
# the keychain search list, so nothing else ever asks to unlock it. A new release identity is also
# saved as a password-protected .p12 on the Desktop: keep that copy offline. Signing with a new
# certificate makes every user grant Accessibility again.
#
# The development identity sits in the login keychain, so development builds never need the release
# key. It only covers Diktatorn Dev's own permissions, which other programs can use anyway while
# Dev has them (it runs any app directory it is given).
#
# Each prints the certificate's SHA-1, the value macOS pins (codesign -d -r- shows it as
# certificate leaf = H"…").
set -euo pipefail

RELEASE_NAME="${DIKTATORN_SIGN_IDENTITY:-Diktatorn Code Signing}"
DEV_NAME="${DIKTATORN_DEV_SIGN_IDENTITY:-Diktatorn Dev Signing}"
KEYCHAIN="${DIKTATORN_SIGN_KEYCHAIN:-$HOME/Library/Keychains/diktatorn-signing.keychain-db}"
LOGIN="$HOME/Library/Keychains/login.keychain-db"
# The system LibreSSL writes a .p12 that the keychain imports; OpenSSL 3's default does not.
OPENSSL=/usr/bin/openssl

usage() {
  echo "usage: $0 [--import <backup>.p12 | --dev]" >&2
  exit 2
}

# In the same form as codesign: lowercase hex without colons.
sha1() { "$OPENSSL" x509 -noout -fingerprint -sha1 | sed 's/.*=//; s/://g' | tr 'A-F' 'a-f'; }

TMP="$(mktemp -d)"
# Set while a keychain made by this run is unfinished, so a failed run doesn't leave it behind.
CREATED=0
cleanup() {
  rm -rf "$TMP"
  if [ "$CREATED" = 1 ]; then security delete-keychain "$KEYCHAIN"; fi
}
trap cleanup EXIT

# Writes a new key and a certificate for it, called $1, to $TMP/key.pem and $TMP/cert.pem.
new_identity() {
  cat >"$TMP/cert.cnf" <<EOF
[req]
distinguished_name = dn
prompt = no
x509_extensions = ext
[dn]
CN = $1
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
subjectKeyIdentifier = hash
EOF
  "$OPENSSL" req -x509 -newkey rsa:3072 -nodes -sha256 -days 7300 -config "$TMP/cert.cnf" \
    -keyout "$TMP/key.pem" -out "$TMP/cert.pem" 2>/dev/null
}

# Imports $TMP/key.pem and $TMP/cert.pem as identity $1 into keychain $2, where codesign may use
# the key while that keychain is unlocked.
import_identity() {
  # The .p12 only carries the key into the keychain and is deleted on exit, so its password is
  # random and never shown.
  local password
  password="$("$OPENSSL" rand -hex 16)"
  "$OPENSSL" pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -name "$1" \
    -passout "pass:$password" -out "$TMP/identity.p12"
  security import "$TMP/identity.p12" -k "$2" -P "$password" -T /usr/bin/codesign
}

# Creates the release keychain, locking after five minutes and when the Mac sleeps, and leaves the
# search list as it was.
create_release_keychain() {
  local before=() keychain
  while IFS= read -r keychain; do before+=("$keychain"); done \
    < <(security list-keychains -d user | sed 's/^[[:space:]]*"//; s/"$//')
  echo "Choose a password for the signing keychain. npm run package asks for it when it signs."
  security create-keychain "$KEYCHAIN"
  CREATED=1
  security list-keychains -d user -s ${before[@]+"${before[@]}"}
  security set-keychain-settings -l -u -t 300 "$KEYCHAIN"
}

in_login_keychain() { security find-certificate -c "$1" "$LOGIN" >/dev/null 2>&1; }

# Writes the key (-nocerts) or the certificate (-nokeys) from $BACKUP to $2. It is unpacked into
# the temporary folder and wrapped again for the import, so the backup's password never appears
# on a command line.
unpack_backup() {
  printf '%s\n' "$BACKUP_PASSWORD" | "$OPENSSL" pkcs12 -in "$BACKUP" -passin stdin -nodes "$1" -out "$2" 2>/dev/null
}

case "${1:-}" in
  --dev)
    [ $# -eq 1 ] || usage
    if PEM="$(security find-certificate -c "$DEV_NAME" -p "$LOGIN" 2>/dev/null)"; then
      echo "\"$DEV_NAME\" is already in the login keychain; nothing to do. Certificate SHA-1:"
      sha1 <<<"$PEM"
      exit 0
    fi
    new_identity "$DEV_NAME"
    import_identity "$DEV_NAME" "$LOGIN"
    echo "Created \"$DEV_NAME\" in the login keychain. Certificate SHA-1:"
    sha1 <"$TMP/cert.pem"
    ;;

  --import)
    [ $# -eq 2 ] || usage
    BACKUP="$2"
    if [ -e "$KEYCHAIN" ]; then
      echo "$KEYCHAIN already exists. To import again, delete it first: security delete-keychain \"$KEYCHAIN\"" >&2
      exit 1
    fi
    read -rsp "Password of $BACKUP: " BACKUP_PASSWORD
    echo
    if ! unpack_backup -nocerts "$TMP/key.pem" || ! unpack_backup -nokeys "$TMP/cert.pem"; then
      echo "Couldn't read $BACKUP: wrong password, or not a .p12 file." >&2
      exit 1
    fi
    SUBJECT="$("$OPENSSL" x509 -noout -subject -in "$TMP/cert.pem")"
    if [[ "$SUBJECT" != *"/CN=$RELEASE_NAME" ]]; then
      echo "$BACKUP holds \"${SUBJECT##*CN=}\", not \"$RELEASE_NAME\"." >&2
      exit 1
    fi
    create_release_keychain
    import_identity "$RELEASE_NAME" "$KEYCHAIN"
    security lock-keychain "$KEYCHAIN"
    CREATED=0
    echo "Imported \"$RELEASE_NAME\" into $KEYCHAIN. Certificate SHA-1:"
    sha1 <"$TMP/cert.pem"
    if in_login_keychain "$RELEASE_NAME"; then
      echo "Once npm run package has signed a build with it, delete \"$RELEASE_NAME\" from the login keychain"
      echo "(Keychain Access → login → My Certificates), so the key is only in the locked keychain."
    fi
    ;;

  "")
    if [ -e "$KEYCHAIN" ]; then
      echo "$KEYCHAIN already exists; nothing to do."
      exit 0
    fi
    if in_login_keychain "$RELEASE_NAME"; then
      echo "\"$RELEASE_NAME\" is in the login keychain. A new one would be a different certificate, and" >&2
      echo "every user would have to grant Accessibility again. Move that one instead: export it from" >&2
      echo "Keychain Access (login → My Certificates → Export, .p12), then run $0 --import <file>.p12" >&2
      exit 1
    fi
    BACKUP="$HOME/Desktop/$RELEASE_NAME.p12"
    if [ -e "$BACKUP" ]; then
      echo "$BACKUP already exists; move it away first." >&2
      exit 1
    fi
    new_identity "$RELEASE_NAME"
    echo "Choose a password for the backup of the key."
    "$OPENSSL" pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -name "$RELEASE_NAME" -out "$BACKUP"
    create_release_keychain
    import_identity "$RELEASE_NAME" "$KEYCHAIN"
    security lock-keychain "$KEYCHAIN"
    CREATED=0
    echo "Created \"$RELEASE_NAME\" in $KEYCHAIN."
    echo "Its backup is $BACKUP: keep it offline, with its password, and delete it from the Desktop."
    echo "Certificate SHA-1:"
    sha1 <"$TMP/cert.pem"
    ;;

  *) usage ;;
esac
