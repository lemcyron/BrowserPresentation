# TouchSideBar – GNOME Shell Extension

A resizable, **touch-friendly sidebar** for GNOME Shell 45–51. Designed to be
useful on touchscreen devices where reaching the top panel or corners is
inconvenient.

---

## Features

| Feature | Detail |
|---|---|
| **Left / Right placement** | Toggle the sidebar to either edge from the panel menu or Preferences |
| **Resizable** | Drag the resize handle to any width between 48 px and 400 px |
| **Auto-hide** | Automatically fades out when any window on the active workspace overlaps the sidebar area, and fades back in when the overlap clears |
| **Customizable buttons** | Add, remove, reorder, and fully edit every action button from Preferences |
| **Icon customization** | Each button has its own icon name (any GNOME symbolic icon) and an independent CSS color value |
| **Preferences window** | Full GTK4 + libadwaita preferences window accessible from the panel menu |

---

## Built-in Action Types

| Action | Description |
|---|---|
| **Previous Workspace** | Activates the previous workspace |
| **Next Workspace** | Activates the next workspace |
| **Show Overview** | Toggles the GNOME Activities Overview |
| **Toggle Fullscreen** | Makes / unsets the focused window fullscreen |
| **Power Off** | `gnome-session-quit --power-off` |
| **Reboot** | `gnome-session-quit --reboot` |
| **Suspend** | `systemctl suspend` |
| **Log Out** | `gnome-session-quit --logout` |
| **Lock Screen** | `loginctl lock-session` |
| **Terminal Command** | Runs any shell command via `bash -c` |
| **System Command** | Runs any command directly (for non-interactive commands) |
| **Copy** | Shows a notification that clipboard content is ready |
| **Paste** | Types clipboard text at the current cursor position via `xdotool` |
| **App Shortcut** | Launches any installed application by its `.desktop` ID |

---

## Requirements

- GNOME Shell **45, 46, 47, 48, or 51**
- `glib-compile-schemas` (part of `glib2` / `libglib2.0-dev`)
- `xdotool` — **only needed** if you use the Paste action on X11
- `gnome-session` — for power/logout actions (standard on most distros)
- `systemd` — for suspend/lock actions (standard on most distros)

---

## Installation

```bash
# Clone or extract the extension files, then:
chmod +x install.sh
./install.sh
```

> **Important:** GNOME Shell must be **restarted** before the extension can be
> enabled. The install script copies and compiles all files, but cannot activate
> the extension in the same session.

After restarting the shell:
```bash
gnome-extensions enable touchsidebar@gnome-extension
```

On **X11**: press `Alt+F2`, type `r`, press `Enter` to restart the shell.
On **Wayland**: log out and back in.

### Manual installation

```bash
UUID="touchsidebar@gnome-extension"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"
mkdir -p "$DEST/schemas"
cp metadata.json extension.js prefs.js stylesheet.css "$DEST/"
cp schemas/*.xml "$DEST/schemas/"
glib-compile-schemas "$DEST/schemas/"
gnome-extensions enable "$UUID"
```

---

## Uninstalling

```bash
gnome-extensions disable touchsidebar@gnome-extension
rm -rf ~/.local/share/gnome-shell/extensions/touchsidebar@gnome-extension
```

---

## File Structure

```
touchsidebar@gnome-extension/
├── metadata.json        Extension manifest
├── extension.js         Main shell code (sidebar, actions, panel button)
├── prefs.js             GTK4 preferences window
├── stylesheet.css       GNOME Shell CSS styling
├── install.sh           One-step install helper
├── README.md            This file
└── schemas/
    └── org.gnome.shell.extensions.touchsidebar.gschema.xml
```

---

## Customizing from Preferences

Open Preferences from the panel menu or run:

```bash
gnome-extensions prefs touchsidebar@gnome-extension
```

### General tab
- **Sidebar Side** – toggle between Left and Right
- **Sidebar Width** – numeric spin button (48–400 px)
- **Auto-hide** – enable/disable overlap detection

### Actions tab
Every button in the sidebar corresponds to one row here:
- **Enable/disable** the button with the row toggle switch
- **Expand** the row to edit:
  - Action type (dropdown)
  - Button label
  - Icon name (any `*-symbolic` name from the system icon theme)
  - Icon color (text entry or color picker)
  - Command (for Terminal Command / System Command types)
  - App desktop ID (for App Shortcut type)
- **Move Up / Move Down** reorder the button
- **Remove** deletes the button

Use **Add New Action Button** at the bottom to append a new button of any type.  
**Reset Actions to Defaults** restores the factory button list.

---

## Security Notes

- Terminal and System commands are launched with `GLib.spawn_command_line_async` 
  — they run as your user, not as root.
- No network access is performed by the extension.
- No credentials, tokens, or personal data are stored.
- Paste action uses `xdotool type` — use only on trusted text.

---

## License

MIT License — see individual source files for copyright headers.
