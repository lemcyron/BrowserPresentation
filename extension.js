/**
 * TouchSideBar – GNOME Shell Extension
 * Compatible with GNOME Shell 45–51
 *
 * A resizable, touch-friendly sidebar that can be toggled to the left or right
 * side of the screen. Supports fully customizable action buttons.
 */

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

// ─── Constants ────────────────────────────────────────────────────────────────
const SCHEMA_KEY = 'org.gnome.shell.extensions.touchsidebar';
const SIDEBAR_MIN_WIDTH = 48;
const SIDEBAR_MAX_WIDTH = 400;

// ─── Utility ──────────────────────────────────────────────────────────────────

/**
 * Create a themed icon, falling back to a symbolic name.
 */
function makeIcon(iconName, iconColor, iconSize = 24) {
    const icon = new St.Icon({
        icon_name: iconName || 'application-x-executable-symbolic',
        icon_size: iconSize,
        style_class: 'touch-sidebar-icon',
    });
    if (iconColor && iconColor !== '') {
        icon.set_style(`color: ${iconColor};`);
    }
    return icon;
}

/**
 * Spawn a command without blocking the shell.
 */
function spawnCommand(cmd) {
    try {
        GLib.spawn_command_line_async(cmd);
    } catch (e) {
        console.error(`TouchSideBar: failed to run command: ${cmd}`, e);
    }
}

// ─── Action Executor ──────────────────────────────────────────────────────────

/**
 * Central dispatcher: given an action definition object, perform the action.
 */
function executeAction(action, extensionObject) {
    switch (action.type) {
        case 'prev-workspace': {
            const ws = global.workspaceManager;
            const idx = ws.get_active_workspace_index();
            if (idx > 0) ws.get_workspace_by_index(idx - 1).activate(global.get_current_time());
            break;
        }
        case 'next-workspace': {
            const ws = global.workspaceManager;
            const idx = ws.get_active_workspace_index();
            const last = ws.get_n_workspaces() - 1;
            if (idx < last) ws.get_workspace_by_index(idx + 1).activate(global.get_current_time());
            break;
        }
        case 'overview':
            if (Main.overview.visible) Main.overview.hide();
            else Main.overview.show();
            break;
        case 'fullscreen': {
            const win = global.display.get_focus_window();
            if (win) {
                if (win.is_fullscreen()) win.unmake_fullscreen();
                else win.make_fullscreen();
            }
            break;
        }
        case 'power-shutdown':
            spawnCommand('gnome-session-quit --power-off');
            break;
        case 'power-reboot':
            spawnCommand('gnome-session-quit --reboot');
            break;
        case 'power-suspend':
            spawnCommand('systemctl suspend');
            break;
        case 'power-logout':
            spawnCommand('gnome-session-quit --logout');
            break;
        case 'power-lock':
            spawnCommand('loginctl lock-session');
            break;
        case 'terminal-command':
            if (action.command && action.command.trim() !== '')
                spawnCommand(`bash -c ${GLib.shell_quote(action.command)}`);
            break;
        case 'system-command':
            if (action.command && action.command.trim() !== '')
                spawnCommand(action.command);
            break;
        case 'copy': {
            const clipboard = St.Clipboard.get_default();
            clipboard.get_text(St.ClipboardType.CLIPBOARD, (_clip, text) => {
                // already in clipboard — just notify
                Main.notify('TouchSideBar', _('Clipboard content ready'));
            });
            break;
        }
        case 'paste': {
            const clipboard = St.Clipboard.get_default();
            clipboard.get_text(St.ClipboardType.CLIPBOARD, (_clip, text) => {
                if (text) spawnCommand(`xdotool type --clearmodifiers -- ${GLib.shell_quote(text)}`);
            });
            break;
        }
        case 'app-shortcut':
            if (action.appId) {
                const app = Shell.AppSystem.get_default().lookup_app(action.appId);
                if (app) app.activate();
            }
            break;
        default:
            console.warn(`TouchSideBar: unknown action type "${action.type}"`);
    }
}

// ─── Action Button ─────────────────────────────────────────────────────────────

const TouchActionButton = GObject.registerClass(
class TouchActionButton extends St.Button {
    _init(action, extensionObject) {
        super._init({
            style_class: 'touch-sidebar-btn',
            can_focus: true,
            track_hover: true,
            accessible_name: action.label || action.type,
            reactive: true,
            x_expand: true,
        });

        this._action = action;
        this._ext = extensionObject;

        const box = new St.BoxLayout({ orientation: Clutter.Orientation.VERTICAL, x_align: Clutter.ActorAlign.CENTER });

        const iconName = action.icon || _defaultIconForType(action.type);
        const icon = makeIcon(iconName, action.iconColor || '', 28);
        box.add_child(icon);

        if (action.label && action.label.trim() !== '') {
            const label = new St.Label({
                text: action.label,
                style_class: 'touch-sidebar-btn-label',
                x_align: Clutter.ActorAlign.CENTER,
            });
            if (action.iconColor && action.iconColor !== '')
                label.set_style(`color: ${action.iconColor};`);
            box.add_child(label);
        }

        this.set_child(box);

        this.connect('clicked', () => executeAction(this._action, this._ext));
    }
});

function _defaultIconForType(type) {
    const map = {
        'prev-workspace':    'go-previous-symbolic',
        'next-workspace':    'go-next-symbolic',
        'overview':          'view-grid-symbolic',
        'fullscreen':        'view-fullscreen-symbolic',
        'power-shutdown':    'system-shutdown-symbolic',
        'power-reboot':      'system-reboot-symbolic',
        'power-suspend':     'weather-clear-night-symbolic',
        'power-logout':      'system-log-out-symbolic',
        'power-lock':        'system-lock-screen-symbolic',
        'terminal-command':  'utilities-terminal-symbolic',
        'system-command':    'system-run-symbolic',
        'copy':              'edit-copy-symbolic',
        'paste':             'edit-paste-symbolic',
        'app-shortcut':      'application-x-executable-symbolic',
    };
    return map[type] || 'application-x-executable-symbolic';
}

// ─── Resize Handle ─────────────────────────────────────────────────────────────

const ResizeHandle = GObject.registerClass(
class ResizeHandle extends St.DrawingArea {
    _init(sidebar) {
        super._init({
            style_class: 'touch-sidebar-resize-handle',
            reactive: true,
            width: 8,
            y_expand: true,
        });
        this._sidebar = sidebar;
        this._dragging = false;
        this._startX = 0;
        this._startWidth = 0;

        this.connect('button-press-event', this._onPress.bind(this));
        this.connect('button-release-event', this._onRelease.bind(this));
        this.connect('motion-event', this._onMotion.bind(this));
        this.connect('touch-event', this._onTouch.bind(this));
    }

    _onPress(actor, event) {
        this._dragging = true;
        this._startX = event.get_coords()[0];
        this._startWidth = this._sidebar.get_width();
        return Clutter.EVENT_STOP;
    }

    _onRelease() {
        this._dragging = false;
        this._sidebar._saveWidth();
        return Clutter.EVENT_STOP;
    }

    _onMotion(actor, event) {
        if (!this._dragging) return Clutter.EVENT_PROPAGATE;
        const [cx] = event.get_coords();
        const delta = cx - this._startX;
        const onRight = this._sidebar._settings.get_boolean('sidebar-on-right');
        const newWidth = onRight
            ? this._startWidth - delta
            : this._startWidth + delta;
        this._sidebar._setWidth(newWidth);
        return Clutter.EVENT_STOP;
    }

    _onTouch(actor, event) {
        const type = event.type();
        if (type === Clutter.EventType.TOUCH_BEGIN) {
            this._dragging = true;
            this._startX = event.get_coords()[0];
            this._startWidth = this._sidebar.get_width();
            return Clutter.EVENT_STOP;
        }
        if (type === Clutter.EventType.TOUCH_END || type === Clutter.EventType.TOUCH_CANCEL) {
            this._dragging = false;
            this._sidebar._saveWidth();
            return Clutter.EVENT_STOP;
        }
        if (type === Clutter.EventType.TOUCH_UPDATE && this._dragging) {
            const [cx] = event.get_coords();
            const delta = cx - this._startX;
            const onRight = this._sidebar._settings.get_boolean('sidebar-on-right');
            const newWidth = onRight
                ? this._startWidth - delta
                : this._startWidth + delta;
            this._sidebar._setWidth(newWidth);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }
});

// ─── Sidebar Panel ──────────────────────────────────────────────────────────────

const TouchSideBar = GObject.registerClass(
class TouchSideBar extends St.BoxLayout {
    _init(settings, extensionObject) {
        super._init({
            style_class: 'touch-sidebar',
            orientation: Clutter.Orientation.VERTICAL,
            reactive: true,
            track_hover: true,
            clip_to_allocation: true,
        });

        this._settings = settings;
        this._ext = extensionObject;
        this._hideTimer = null;
        this._visible = true;
        this._currentWidth = settings.get_int('sidebar-width');

        // ── Scroll container for buttons ──────────────────────
        this._scrollView = new St.ScrollView({
            style_class: 'touch-sidebar-scroll',
            y_expand: true,
            x_expand: true,
        });
        this._scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        this._scrollView.set_overlay_scrollbars(true);

        this._buttonBox = new St.BoxLayout({
            style_class: 'touch-sidebar-button-box',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        this._scrollView.set_child(this._buttonBox);

        // ── Resize handle ──────────────────────────────────────
        this._resizeHandle = new ResizeHandle(this);

        this._rebuildLayout();

        // ── Settings listeners ────────────────────────────────
        this._settingsChangedId = settings.connect('changed', (_s, key) => {
            if (key === 'sidebar-on-right' || key === 'sidebar-width' || key === 'actions') {
                this._rebuildLayout();
            }
            if (key === 'sidebar-width') {
                this._currentWidth = settings.get_int('sidebar-width');
                this._applyWidth();
            }
        });

        // ── Window overlap detection ──────────────────────────
        this._windowCreatedId = global.display.connect('window-created', (_display, win) => {
            this._trackWindow(win);
            this._checkOverlap();
        });
        this._windowFocusId = global.display.connect('notify::focus-window', () => this._checkOverlap());
        this._workspaceChangedId = global.workspaceManager.connect(
            'active-workspace-changed', () => {
                this._untrackWindows();
                this._trackAllWindows();
                this._checkOverlap();
            });

        // Watch all windows for geometry changes
        this._windowSignals = [];
        this._trackAllWindows();
    }

    _rebuildLayout() {
        // Remove existing children
        this.remove_all_children();
        this._buttonBox.remove_all_children();

        const onRight = this._settings.get_boolean('sidebar-on-right');

        if (onRight) {
            this.add_child(this._resizeHandle);
            this._buildButtons();
            this.add_child(this._scrollView);
        } else {
            this._buildButtons();
            this.add_child(this._scrollView);
            this.add_child(this._resizeHandle);
        }

        this._applyWidth();
        this._positionSidebar();
    }

    _buildButtons() {
        const actionsJson = this._settings.get_string('actions');
        let actions = [];
        try {
            actions = JSON.parse(actionsJson);
        } catch (_e) {
            actions = _defaultActions();
        }
        if (!Array.isArray(actions) || actions.length === 0) {
            actions = _defaultActions();
        }

        for (const action of actions) {
            if (!action.enabled && action.enabled !== undefined) continue;
            const btn = new TouchActionButton(action, this._ext);
            this._buttonBox.add_child(btn);
        }
    }

    _applyWidth() {
        const w = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, this._currentWidth));
        this.set_width(w);
    }

    _setWidth(w) {
        this._currentWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, w));
        this._applyWidth();
    }

    _saveWidth() {
        this._settings.set_int('sidebar-width', this._currentWidth);
    }

    _positionSidebar() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return;

        const onRight = this._settings.get_boolean('sidebar-on-right');
        const w = this._currentWidth;
        // GNOME 45+: Main.panel is the actor itself (no .actor wrapper)
        const panelHeight = Main.panel.get_height() || 32;

        this.set_position(
            onRight ? monitor.x + monitor.width - w : monitor.x,
            monitor.y + panelHeight
        );
        this.set_height(monitor.height - panelHeight);
    }

    // ── Auto-hide on window overlap ───────────────────────────────────────────

    _trackAllWindows() {
        const workspace = global.workspaceManager.get_active_workspace();
        const windows = workspace.list_windows();
        for (const win of windows) {
            this._trackWindow(win);
        }
    }

    _trackWindow(win) {
        const id = win.connect('size-changed', () => this._checkOverlap());
        const id2 = win.connect('position-changed', () => this._checkOverlap());
        this._windowSignals.push({ win, ids: [id, id2] });
    }

    _untrackWindows() {
        for (const { win, ids } of this._windowSignals) {
            for (const id of ids) {
                try { win.disconnect(id); } catch (_e) {}
            }
        }
        this._windowSignals = [];
    }

    _checkOverlap() {
        if (!this._settings.get_boolean('auto-hide')) {
            this._showSidebar();
            return;
        }

        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return;

        const onRight = this._settings.get_boolean('sidebar-on-right');
        const w = this._currentWidth;
        const panelHeight = Main.panel.get_height() || 32;

        const sidebarRect = {
            x: onRight ? monitor.x + monitor.width - w : monitor.x,
            y: monitor.y + panelHeight,
            width: w,
            height: monitor.height - panelHeight,
        };

        const workspace = global.workspaceManager.get_active_workspace();
        const windows = workspace.list_windows();

        let overlaps = false;
        for (const win of windows) {
            if (win.get_window_type() !== Meta.WindowType.NORMAL) continue;
            if (win.minimized) continue;
            const frame = win.get_frame_rect();
            if (_rectsOverlap(frame, sidebarRect)) {
                overlaps = true;
                break;
            }
        }

        if (overlaps) this._hideSidebar();
        else this._showSidebar();
    }

    _hideSidebar() {
        if (!this._visible) return;
        this._visible = false;
        this.ease({
            opacity: 0,
            duration: 200,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => { this.hide(); },
        });
    }

    _showSidebar() {
        if (this._visible) return;
        this._visible = true;
        this.show();
        this.ease({
            opacity: 255,
            duration: 200,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
        });
    }

    // ── Public toggle (called from panel button) ──────────────────────────────

    toggleVisibility() {
        if (this.visible && this.opacity > 0) {
            this._visible = false;
            this.ease({
                opacity: 0,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => { this.hide(); },
            });
        } else {
            this._visible = true;
            this.show();
            this.ease({
                opacity: 255,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
            });
            this._checkOverlap();
        }
    }

    updatePosition() {
        this._positionSidebar();
    }

    destroy() {
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        if (this._windowCreatedId) {
            global.display.disconnect(this._windowCreatedId);
            this._windowCreatedId = null;
        }
        if (this._windowFocusId) {
            global.display.disconnect(this._windowFocusId);
            this._windowFocusId = null;
        }
        if (this._workspaceChangedId) {
            global.workspaceManager.disconnect(this._workspaceChangedId);
            this._workspaceChangedId = null;
        }
        this._untrackWindows();
        super.destroy();
    }
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

function _rectsOverlap(a, b) {
    return !(a.x + a.width <= b.x ||
             b.x + b.width <= a.x ||
             a.y + a.height <= b.y ||
             b.y + b.height <= a.y);
}

function _defaultActions() {
    return [
        { type: 'prev-workspace',   label: 'Prev WS',   icon: 'go-previous-symbolic',          iconColor: '',       enabled: true },
        { type: 'next-workspace',   label: 'Next WS',   icon: 'go-next-symbolic',               iconColor: '',       enabled: true },
        { type: 'overview',         label: 'Overview',  icon: 'view-grid-symbolic',             iconColor: '',       enabled: true },
        { type: 'fullscreen',       label: 'Fullscreen',icon: 'view-fullscreen-symbolic',       iconColor: '',       enabled: true },
        { type: 'power-lock',       label: 'Lock',      icon: 'system-lock-screen-symbolic',    iconColor: '',       enabled: true },
        { type: 'power-logout',     label: 'Logout',    icon: 'system-log-out-symbolic',        iconColor: '',       enabled: true },
        { type: 'power-suspend',    label: 'Suspend',   icon: 'weather-clear-night-symbolic',   iconColor: '',       enabled: true },
        { type: 'power-reboot',     label: 'Reboot',    icon: 'system-reboot-symbolic',         iconColor: '',       enabled: true },
        { type: 'power-shutdown',   label: 'Shutdown',  icon: 'system-shutdown-symbolic',       iconColor: '#cc3333', enabled: true },
        { type: 'copy',             label: 'Copy',      icon: 'edit-copy-symbolic',             iconColor: '',       enabled: true },
        { type: 'paste',            label: 'Paste',     icon: 'edit-paste-symbolic',            iconColor: '',       enabled: true },
    ];
}

// ─── Panel Indicator ───────────────────────────────────────────────────────────

const TouchSideBarIndicator = GObject.registerClass(
class TouchSideBarIndicator extends PanelMenu.Button {
    _init(sidebar, settings) {
        super._init(0.0, 'TouchSideBar');
        this._sidebar = sidebar;
        this._settings = settings;

        const icon = new St.Icon({
            icon_name: 'view-sidebar-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(icon);

        // ── Toggle sidebar ────────────────────────────────────
        const toggleItem = new PopupMenu.PopupMenuItem(_('Toggle Sidebar'));
        toggleItem.connect('activate', () => sidebar.toggleVisibility());
        this.menu.addMenuItem(toggleItem);

        // ── Switch side ───────────────────────────────────────
        const switchSide = new PopupMenu.PopupMenuItem(
            settings.get_boolean('sidebar-on-right') ? _('Move to Left') : _('Move to Right')
        );
        switchSide.connect('activate', () => {
            const onRight = settings.get_boolean('sidebar-on-right');
            settings.set_boolean('sidebar-on-right', !onRight);
            switchSide.label.set_text(!onRight ? _('Move to Left') : _('Move to Right'));
        });
        this.menu.addMenuItem(switchSide);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // ── Preferences ───────────────────────────────────────
        const prefsItem = new PopupMenu.PopupMenuItem(_('Preferences…'));
        prefsItem.connect('activate', () => {
            this._ext?.openPreferences();
        });
        this.menu.addMenuItem(prefsItem);
    }

    setExtension(ext) {
        this._ext = ext;
    }
});

// ─── Edge Swipe Zone ───────────────────────────────────────────────────────────
//
// An invisible 8 px strip anchored to the screen edge (same side as the
// sidebar). Dragging / swiping inward from this strip shows the sidebar.
// Works with both mouse pointer-press/motion and touch TOUCH_BEGIN/UPDATE events.

const SWIPE_THRESHOLD = 20; // px inward travel needed to trigger reveal

const EdgeSwipeZone = GObject.registerClass(
class EdgeSwipeZone extends St.Button {
    _init(settings, sidebar) {
        super._init({
            style_class: 'touch-sidebar-swipe-zone',
            reactive: true,
            can_focus: false,
            opacity: 0,          // fully transparent — invisible but interactive
            width: 8,
        });

        this._settings = settings;
        this._sidebar = sidebar;
        this._dragging = false;
        this._startX = 0;
        this._triggered = false;

        this.connect('button-press-event', this._onPress.bind(this));
        this.connect('button-release-event', this._onRelease.bind(this));
        this.connect('motion-event', this._onMotion.bind(this));
        this.connect('touch-event', this._onTouch.bind(this));

        settings.connect('changed::sidebar-on-right', () => this._reposition());
        settings.connect('changed::sidebar-width', () => this._reposition());
    }

    _reposition() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return;
        const onRight = this._settings.get_boolean('sidebar-on-right');
        const panelHeight = Main.panel.get_height() || 32;
        this.set_size(8, monitor.height - panelHeight);
        this.set_position(
            onRight ? monitor.x + monitor.width - 8 : monitor.x,
            monitor.y + panelHeight
        );
    }

    _onPress(actor, event) {
        this._dragging = true;
        this._triggered = false;
        this._startX = event.get_coords()[0];
        return Clutter.EVENT_STOP;
    }

    _onRelease() {
        this._dragging = false;
        return Clutter.EVENT_STOP;
    }

    _onMotion(actor, event) {
        if (!this._dragging || this._triggered) return Clutter.EVENT_PROPAGATE;
        const [cx] = event.get_coords();
        const onRight = this._settings.get_boolean('sidebar-on-right');
        const delta = onRight ? this._startX - cx : cx - this._startX;
        if (delta >= SWIPE_THRESHOLD) {
            this._triggered = true;
            this._revealSidebar();
        }
        return Clutter.EVENT_STOP;
    }

    _onTouch(actor, event) {
        const type = event.type();
        if (type === Clutter.EventType.TOUCH_BEGIN) {
            this._dragging = true;
            this._triggered = false;
            this._startX = event.get_coords()[0];
            return Clutter.EVENT_STOP;
        }
        if (type === Clutter.EventType.TOUCH_END || type === Clutter.EventType.TOUCH_CANCEL) {
            this._dragging = false;
            return Clutter.EVENT_STOP;
        }
        if (type === Clutter.EventType.TOUCH_UPDATE && this._dragging && !this._triggered) {
            const [cx] = event.get_coords();
            const onRight = this._settings.get_boolean('sidebar-on-right');
            const delta = onRight ? this._startX - cx : cx - this._startX;
            if (delta >= SWIPE_THRESHOLD) {
                this._triggered = true;
                this._revealSidebar();
            }
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _revealSidebar() {
        // Show the sidebar if it's currently hidden
        if (!this._sidebar.visible || this._sidebar.opacity === 0) {
            this._sidebar._visible = false; // force showSidebar to run
            this._sidebar._showSidebar();
        }
    }
});

// ─── Extension Entry Point ─────────────────────────────────────────────────────

export default class TouchSideBarExtension extends Extension {
    enable() {
        this._settings = this.getSettings(SCHEMA_KEY);

        // ── Sidebar widget ────────────────────────────────────
        this._sidebar = new TouchSideBar(this._settings, this);
        Main.layoutManager.addChrome(this._sidebar, {
            affectsStruts: false,
            trackFullscreen: false,
        });
        this._sidebar._positionSidebar();
        this._sidebar._checkOverlap();

        // ── Edge swipe zone ───────────────────────────────────
        // Placed above sidebar in the chrome stack so it catches
        // touches/drags that start from the very edge of the screen.
        this._swipeZone = new EdgeSwipeZone(this._settings, this._sidebar);
        Main.layoutManager.addChrome(this._swipeZone, {
            affectsStruts: false,
            trackFullscreen: false,
        });
        this._swipeZone._reposition();

        // Keep swipe zone repositioned alongside sidebar
        this._swipeSideId = this._settings.connect('changed::sidebar-on-right', () => {
            this._swipeZone._reposition();
        });

        // ── Panel indicator ───────────────────────────────────
        this._indicator = new TouchSideBarIndicator(this._sidebar, this._settings);
        this._indicator.setExtension(this);
        Main.panel.addToStatusArea('touchsidebar', this._indicator);

        // ── Reposition on monitor change ──────────────────────
        this._monitorsChangedId = Main.layoutManager.connect(
            'monitors-changed', () => {
                this._sidebar._positionSidebar();
                this._sidebar._checkOverlap();
                this._swipeZone._reposition();
            }
        );

        // ── Reposition when sidebar-on-right changes ──────────
        this._sideChangedId = this._settings.connect('changed::sidebar-on-right', () => {
            this._sidebar._positionSidebar();
        });
    }

    disable() {
        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = null;
        }
        if (this._sideChangedId) {
            this._settings.disconnect(this._sideChangedId);
            this._sideChangedId = null;
        }
        if (this._swipeSideId) {
            this._settings.disconnect(this._swipeSideId);
            this._swipeSideId = null;
        }
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        if (this._swipeZone) {
            this._swipeZone.destroy();
            this._swipeZone = null;
        }
        if (this._sidebar) {
            this._sidebar.destroy();
            this._sidebar = null;
        }
        this._settings = null;
    }

    openPreferences() {
        super.openPreferences();
    }
}
