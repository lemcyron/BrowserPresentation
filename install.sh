#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# TouchSideBar – Install Script
#
# Compiles the GSettings schema and installs the extension into
# ~/.local/share/gnome-shell/extensions/touchsidebar@gnome-extension
#
# IMPORTANT: GNOME Shell must be restarted after installation
# before the extension can be enabled. See instructions below.
#
# Usage:
#   chmod +x install.sh
#   ./install.sh
#
# To uninstall:
#   gnome-extensions disable touchsidebar@gnome-extension
#   rm -rf ~/.local/share/gnome-shell/extensions/touchsidebar@gnome-extension
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

UUID="touchsidebar@gnome-extension"
INSTALL_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"
SCHEMA_DIR="$INSTALL_DIR/schemas"

echo "→ Creating install directory: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
mkdir -p "$SCHEMA_DIR"

echo "→ Copying extension files…"
cp metadata.json   "$INSTALL_DIR/"
cp extension.js    "$INSTALL_DIR/"
cp prefs.js        "$INSTALL_DIR/"
cp stylesheet.css  "$INSTALL_DIR/"
cp schemas/org.gnome.shell.extensions.touchsidebar.gschema.xml "$SCHEMA_DIR/"

echo "→ Compiling GSettings schema…"
glib-compile-schemas "$SCHEMA_DIR"

echo ""
echo "✔ Files installed to: $INSTALL_DIR"
echo ""
echo "══════════════════════════════════════════════════════════"
echo "  NEXT STEP — Restart GNOME Shell first, THEN enable:"
echo "══════════════════════════════════════════════════════════"
echo ""
echo "  ┌─ On X11 (e.g. GNOME on Xorg):"
echo "  │   Press Alt+F2, type  r  and press Enter."
echo "  │   Then run:  gnome-extensions enable $UUID"
echo "  │"
echo "  └─ On Wayland (e.g. GNOME on Wayland / most modern installs):"
echo "      Log out and log back in."
echo "      Then run:  gnome-extensions enable $UUID"
echo ""
echo "  After enabling, open Preferences with:"
echo "      gnome-extensions prefs $UUID"
echo ""
echo "  To verify the extension loaded:"
echo "      gnome-extensions list --enabled | grep $UUID"
echo ""

# ── Attempt to enable right now (only works if running inside an active session
#    that has already restarted since the files were placed here — e.g. re-running
#    install.sh after a restart). Silently skipped if the shell hasn't reloaded yet.
if gnome-extensions enable "$UUID" 2>/dev/null; then
    echo "  ✔ Extension enabled in the current session."
fi
