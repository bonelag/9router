#!/bin/sh
set -eu

REPOSITORY="${NINEROUTER_REPO:-bonelag/9router}"

step() {
  printf '\033[36m==> %s\033[0m\n' "$1"
}

die() {
  printf '\033[31mError: %s\033[0m\n' "$1" >&2
  exit 1
}

is_9router_path() {
  candidate=$1
  [ -n "$candidate" ] || return 1
  [ -f "$candidate/cli.js" ] || return 1
  [ -f "$candidate/package.json" ] || return 1
  node -e '
    const fs = require("fs");
    const path = process.argv[1];
    const pkg = JSON.parse(fs.readFileSync(path, "utf8"));
    process.exit(pkg.name === "9router" ? 0 : 1);
  ' "$candidate/package.json" >/dev/null 2>&1
}

find_9router_path() {
  if [ -n "${NINEROUTER_HOME:-}" ] && is_9router_path "$NINEROUTER_HOME"; then
    (cd "$NINEROUTER_HOME" && pwd -P)
    return
  fi

  npm_root=$(npm root -g 2>/dev/null || true)
  if [ -n "$npm_root" ] && is_9router_path "$npm_root/9router"; then
    (cd "$npm_root/9router" && pwd -P)
    return
  fi

  command_path=$(command -v 9router 2>/dev/null || true)
  if [ -n "$command_path" ]; then
    resolved_command=$(node -e '
      const fs = require("fs");
      try { process.stdout.write(fs.realpathSync(process.argv[1])); } catch {}
    ' "$command_path")
    command_dir=$(dirname "$command_path")

    if [ -n "$resolved_command" ] && [ "$(basename "$resolved_command")" = "cli.js" ]; then
      resolved_dir=$(dirname "$resolved_command")
      if is_9router_path "$resolved_dir"; then
        (cd "$resolved_dir" && pwd -P)
        return
      fi
    fi
    if is_9router_path "$command_dir/../lib/node_modules/9router"; then
      (cd "$command_dir/../lib/node_modules/9router" && pwd -P)
      return
    fi
    if is_9router_path "$command_dir/node_modules/9router"; then
      (cd "$command_dir/node_modules/9router" && pwd -P)
      return
    fi
  fi

  for candidate in \
    "/usr/local/lib/node_modules/9router" \
    "/usr/lib/node_modules/9router" \
    "$HOME/.npm-global/lib/node_modules/9router"
  do
    if is_9router_path "$candidate"; then
      (cd "$candidate" && pwd -P)
      return
    fi
  done

  return 1
}

command -v node >/dev/null 2>&1 ||
  die "Node.js was not found. Install Node.js 20.9 or newer first."
command -v npm >/dev/null 2>&1 ||
  die "npm was not found. Install Node.js with npm first."
command -v curl >/dev/null 2>&1 ||
  die "curl is required."
command -v unzip >/dev/null 2>&1 ||
  die "unzip is required."

node_supported=$(node -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  process.exit(major > 20 || (major === 20 && minor >= 9) ? 0 : 1);
' && printf yes || printf no)
[ "$node_supported" = "yes" ] ||
  die "9Router requires Node.js 20.9 or newer."

case "$REPOSITORY" in
  */*) ;;
  *) die "Invalid NINEROUTER_REPO: $REPOSITORY" ;;
esac

TARGET=$(find_9router_path) ||
  die "Could not find 9Router. Set NINEROUTER_HOME to the directory containing cli.js."

case "$TARGET" in
  ""|"/"|"/usr"|"/usr/local"|"$HOME")
    die "Refusing to replace unsafe target path: $TARGET"
    ;;
esac

SUDO=""
if [ ! -w "$TARGET" ] || [ ! -w "$(dirname "$TARGET")" ]; then
  command -v sudo >/dev/null 2>&1 ||
    die "The installation is not writable and sudo is unavailable: $TARGET"
  SUDO="sudo"
fi

step "Current installation: $TARGET"
step "Checking latest release from $REPOSITORY"

RELEASE_JSON=$(curl -fsSL \
  -H "Accept: application/vnd.github+json" \
  -H "User-Agent: 9router-one-click-installer" \
  "https://api.github.com/repos/$REPOSITORY/releases/latest")

ASSET_INFO=$(printf '%s' "$RELEASE_JSON" | node -e '
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => input += chunk);
  process.stdin.on("end", () => {
    const release = JSON.parse(input);
    const asset = (release.assets || []).find(item =>
      /^9router_[0-9].*\.zip$/.test(item.name)
    );
    if (!asset) process.exit(1);
    process.stdout.write(`${asset.name}\n${asset.browser_download_url}`);
  });
') || die "The latest release does not contain a 9router_<version>.zip asset."

ASSET_NAME=$(printf '%s\n' "$ASSET_INFO" | sed -n '1p')
ASSET_URL=$(printf '%s\n' "$ASSET_INFO" | sed -n '2p')

TEMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/9router-update.XXXXXX")
ARCHIVE="$TEMP_ROOT/$ASSET_NAME"
PAYLOAD="$TEMP_ROOT/payload"
BACKUP="$TEMP_ROOT/backup"
mkdir -p "$PAYLOAD" "$BACKUP"
cleanup() {
  $SUDO rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT HUP INT TERM

step "Downloading $ASSET_NAME"
curl -fL \
  -H "Accept: application/octet-stream" \
  -H "User-Agent: 9router-one-click-installer" \
  "$ASSET_URL" \
  -o "$ARCHIVE"

step "Validating downloaded package"
unzip -q "$ARCHIVE" -d "$PAYLOAD"
is_9router_path "$PAYLOAD" ||
  die "Downloaded ZIP is invalid: cli.js and package.json must be at the archive root."
[ -d "$PAYLOAD/node_modules" ] ||
  die "Downloaded ZIP is not portable: node_modules is missing."
[ -f "$PAYLOAD/app/server.js" ] ||
  die "Downloaded ZIP is incomplete: app/server.js is missing."

NEW_VERSION=$(node -e '
  const pkg = require(process.argv[1]);
  process.stdout.write(pkg.version);
' "$PAYLOAD/package.json")
step "Installing 9Router $NEW_VERSION"

ps -eo pid=,args= 2>/dev/null |
  while read -r pid command_line; do
    case "$command_line" in
      *"$TARGET/cli.js"*)
        printf 'Stopping running 9Router process %s...\n' "$pid"
        $SUDO kill "$pid" 2>/dev/null || true
        ;;
    esac
  done

$SUDO cp -a "$TARGET/." "$BACKUP/"

if $SUDO rm -rf "$TARGET" &&
   $SUDO mkdir -p "$TARGET" &&
   $SUDO cp -a "$PAYLOAD/." "$TARGET/" &&
   $SUDO chmod +x "$TARGET/cli.js" &&
   node "$TARGET/cli.js" --version >/dev/null
then
  printf '\n\033[32m9Router %s installed successfully.\033[0m\n' "$NEW_VERSION"
  printf 'Location: %s\n' "$TARGET"
else
  printf '\033[33mUpdate failed; restoring the previous installation...\033[0m\n' >&2
  $SUDO rm -rf "$TARGET"
  $SUDO mkdir -p "$TARGET"
  $SUDO cp -a "$BACKUP/." "$TARGET/"
  $SUDO chmod +x "$TARGET/cli.js" 2>/dev/null || true
  die "The previous installation was restored."
fi
