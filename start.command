#!/usr/bin/env bash
# macOS: double-click this file in Finder to start the app (opens in Terminal).
# It simply runs start.sh from the same folder.
cd "$(dirname "$0")" || exit 1
exec bash ./start.sh
