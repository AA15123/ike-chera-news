#!/bin/zsh
set -euo pipefail

PROJECT_DIR="/Users/abrahama/IkeCheraNews"
LOG_DIR="$HOME/Library/Logs/IkeCheraNews"
LOG_FILE="$LOG_DIR/digest-refresh.log"
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

mkdir -p "$LOG_DIR"

cd "$PROJECT_DIR"
/usr/local/bin/npm run build:digest >> "$LOG_FILE" 2>&1
