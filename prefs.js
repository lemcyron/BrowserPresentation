/**
 * TouchSideBar – Preferences
 *
 * Full GTK4 + libadwaita preferences window.
 * Users can:
 *   • Toggle sidebar side (left / right)
 *   • Set sidebar width
 *   • Enable / disable auto-hide
 *   • Add, remove, reorder, and edit action buttons
 *   • Choose action type, label, icon name, and icon color for each button
 */

import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';

import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const SCHEMA_KEY = 'org.gnome.shell.extensions.touchsidebar';

const ACTION_TYPES = [
    { id: 'prev-workspace',  label: 'Previous Workspace',     icon: 'go-previous-symbolic' },
    { id: 'next-workspace',  label: 'Next Workspace',         icon: 'go-next-symbolic' },
    { id: 'overview',        label: 'Show Overview',          icon: 'view-grid-symbolic' },
    { id: 'fullscreen',      label: 'Toggle Fullscreen',      icon: 'view-fullscreen-symbolic' },
    { id: 'power-shutdown',  label: 'Power Off',              icon: 'system-shutdown-symbolic' },
    { id: 'power-reboot',    label: 'Reboot',                 icon: 'system-reboot-symbolic' },
    { id: 'power-suspend',   label: 'Suspend',                icon: 'weather-clear-night-symbolic' },
    { id: 'power-logout',    label: 'Log Out',                icon: 'system-log-out-symbolic' },
    { id: 'power-lock',      label: 'Lock Screen',            icon: 'system-lock-screen-symbolic' },
    { id: 'terminal-command',label: 'Terminal Command',       icon: 'utilities-terminal-symbolic' },
    { id: 'system-command',  label: 'System Command',         icon: 'system-run-symbolic' },
    { id: 'copy',            label: 'Copy (Clipboard)',       icon: 'edit-copy-symbolic' },
    { id: 'paste',           label: 'Paste (Clipboard)',      icon: 'edit-paste-symbolic' },
    { id: 'app-shortcut',    label: 'App Shortcut',           icon: 'application-x-executable-symbolic' },
];

function _defaultActions() {
    return [
        { type: 'prev-workspace',  label: 'Prev WS',    icon: 'go-previous-symbolic',         iconColor: '', enabled: true },
        { type: 'next-workspace',  label: 'Next WS',    icon: 'go-next-symbolic',              iconColor: '', enabled: true },
        { type: 'overview',        label: 'Overview',   icon: 'view-grid-symbolic',            iconColor: '', enabled: true },
        { type: 'fullscreen',      label: 'Fullscreen', icon: 'view-fullscreen-symbolic',      iconColor: '', enabled: true },
        { type: 'power-lock',      label: 'Lock',       icon: 'system-lock-screen-symbolic',   iconColor: '', enabled: true },
        { type: 'power-logout',    label: 'Logout',     icon: 'system-log-out-symbolic',       iconColor: '', enabled: true },
        { type: 'power-suspend',   label: 'Suspend',    icon: 'weather-clear-night-symbolic',  iconColor: '', enabled: true },
        { type: 'power-reboot',    label: 'Reboot',     icon: 'system-reboot-symbolic',        iconColor: '', enabled: true },
        { type: 'power-shutdown',  label: 'Shutdown',   icon: 'system-shutdown-symbolic',      iconColor: '#cc3333', enabled: true },
        { type: 'copy',            label: 'Copy',       icon: 'edit-copy-symbolic',            iconColor: '', enabled: true },
        { type: 'paste',           label: 'Paste',      icon: 'edit-paste-symbolic',           iconColor: '', enabled: true },
    ];
}

// ─── Action Row Widget ─────────────────────────────────────────────────────────

/**
 * A single expandable row in the Actions list.
 * Shows a summary title and expands to show all editable fields.
 */
const ActionRow = GObject.registerClass({
    GTypeName: 'TouchSideBarActionRow',
    Signals: {
        'removed': {},
        'moved-up': {},
        'moved-down': {},
        'changed': {},
    },
}, class ActionRow extends Adw.ExpanderRow {
    _init(action) {
        super._init({
            title: _actionSummary(action),
            show_enable_switch: true,
            enable_expansion: action.enabled !== false,
        });

        this._action = { ...action };

        this._buildContent();

        this.connect('notify::enable-expansion', () => {
            this._action.enabled = this.enable_expansion;
            this.emit('changed');
        });
    }

    _buildContent() {
        // ── Action Type ───────────────────────────────────────
        const typeRow = new Adw.ComboRow({ title: _('Action Type') });
        const typeModel = new Gtk.StringList();
        ACTION_TYPES.forEach(t => typeModel.append(t.label));
        typeRow.set_model(typeModel);
        const currentTypeIdx = ACTION_TYPES.findIndex(t => t.id === this._action.type);
        typeRow.set_selected(currentTypeIdx >= 0 ? currentTypeIdx : 0);
        typeRow.connect('notify::selected', () => {
            const idx = typeRow.get_selected();
            this._action.type = ACTION_TYPES[idx]?.id || 'overview';
            // Auto-fill icon if empty
            if (!this._action.icon || this._action.icon === '') {
                this._action.icon = ACTION_TYPES[idx]?.icon || '';
                iconEntry.set_text(this._action.icon);
            }
            this.set_title(_actionSummary(this._action));
            this.emit('changed');
        });
        this.add_row(typeRow);

        // ── Label ─────────────────────────────────────────────
        const labelRow = new Adw.EntryRow({ title: _('Button Label') });
        labelRow.set_text(this._action.label || '');
        labelRow.connect('notify::text', () => {
            this._action.label = labelRow.get_text();
            this.set_title(_actionSummary(this._action));
            this.emit('changed');
        });
        this.add_row(labelRow);

        // ── Icon Name ─────────────────────────────────────────
        const iconRow = new Adw.EntryRow({ title: _('Icon Name (symbolic)') });
        const iconEntry = iconRow;
        iconRow.set_text(this._action.icon || '');
        iconRow.connect('notify::text', () => {
            this._action.icon = iconRow.get_text();
            this.emit('changed');
        });
        this.add_row(iconRow);

        // ── Icon Color ────────────────────────────────────────
        const colorRow = new Adw.ActionRow({ title: _('Icon Color') });
        const colorEntry = new Gtk.Entry({
            placeholder_text: _('e.g. #ff0000 or red'),
            text: this._action.iconColor || '',
            valign: Gtk.Align.CENTER,
            hexpand: true,
        });
        colorEntry.connect('changed', () => {
            this._action.iconColor = colorEntry.get_text();
            this.emit('changed');
        });
        const colorDialog = new Gtk.ColorDialog({ title: _('Pick a color'), with_alpha: false });
        const colorButton = new Gtk.ColorDialogButton({
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Pick a color'),
            dialog: colorDialog,
        });
        // Sync color button → entry
        colorButton.connect('notify::rgba', () => {
            const rgba = colorButton.get_rgba();
            const hex = _rgbaToHex(rgba);
            colorEntry.set_text(hex);
        });
        const colorBox = new Gtk.Box({ spacing: 8 });
        colorBox.append(colorEntry);
        colorBox.append(colorButton);
        colorRow.add_suffix(colorBox);
        this.add_row(colorRow);

        // ── Command (for terminal-command / system-command) ───
        const cmdRow = new Adw.EntryRow({ title: _('Command') });
        cmdRow.set_text(this._action.command || '');
        cmdRow.connect('notify::text', () => {
            this._action.command = cmdRow.get_text();
            this.emit('changed');
        });
        this.add_row(cmdRow);

        // ── App ID (for app-shortcut) ─────────────────────────
        const appRow = new Adw.EntryRow({ title: _('App Desktop ID (e.g. org.gnome.Files.desktop)') });
        appRow.set_text(this._action.appId || '');
        appRow.connect('notify::text', () => {
            this._action.appId = appRow.get_text();
            this.emit('changed');
        });
        this.add_row(appRow);

        // ── Move Up / Move Down / Remove ─────────────────────
        const actionsBar = new Adw.ActionRow({ title: '' });
        const upBtn = new Gtk.Button({
            icon_name: 'go-up-symbolic',
            tooltip_text: _('Move Up'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        const downBtn = new Gtk.Button({
            icon_name: 'go-down-symbolic',
            tooltip_text: _('Move Down'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        const removeBtn = new Gtk.Button({
            icon_name: 'user-trash-symbolic',
            tooltip_text: _('Remove Action'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat', 'destructive-action'],
        });
        upBtn.connect('clicked', () => this.emit('moved-up'));
        downBtn.connect('clicked', () => this.emit('moved-down'));
        removeBtn.connect('clicked', () => this.emit('removed'));

        const btnBox = new Gtk.Box({ spacing: 4, valign: Gtk.Align.CENTER });
        btnBox.append(upBtn);
        btnBox.append(downBtn);
        btnBox.append(removeBtn);
        actionsBar.add_suffix(btnBox);
        this.add_row(actionsBar);
    }

    getAction() {
        return { ...this._action };
    }
});

function _actionSummary(action) {
    const typeMeta = ACTION_TYPES.find(t => t.id === action.type);
    const typeLabel = typeMeta ? typeMeta.label : action.type;
    return action.label ? `${action.label} (${typeLabel})` : typeLabel;
}

function _rgbaToHex(rgba) {
    const r = Math.round(rgba.red * 255).toString(16).padStart(2, '0');
    const g = Math.round(rgba.green * 255).toString(16).padStart(2, '0');
    const b = Math.round(rgba.blue * 255).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
}

// ─── Preferences Window ─────────────────────────────────────────────────────────

export default class TouchSideBarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings(SCHEMA_KEY);
        window.set_default_size(680, 720);
        window.set_title(_('TouchSideBar Preferences'));

        // ═══════════════════════════════════════════════════════
        // PAGE 1 – General
        // ═══════════════════════════════════════════════════════
        const generalPage = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-system-symbolic',
        });
        window.add(generalPage);

        const layoutGroup = new Adw.PreferencesGroup({ title: _('Layout') });
        generalPage.add(layoutGroup);

        // Sidebar side
        const sideRow = new Adw.ActionRow({ title: _('Sidebar Side') });
        const sideSwitch = new Gtk.Switch({
            active: settings.get_boolean('sidebar-on-right'),
            valign: Gtk.Align.CENTER,
            tooltip_text: _('ON = Right  |  OFF = Left'),
        });
        const sideLabel = new Gtk.Label({
            label: settings.get_boolean('sidebar-on-right') ? _('Right') : _('Left'),
            valign: Gtk.Align.CENTER,
        });
        sideSwitch.connect('notify::active', () => {
            settings.set_boolean('sidebar-on-right', sideSwitch.active);
            sideLabel.set_label(sideSwitch.active ? _('Right') : _('Left'));
        });
        const sideBox = new Gtk.Box({ spacing: 8 });
        sideBox.append(sideLabel);
        sideBox.append(sideSwitch);
        sideRow.add_suffix(sideBox);
        layoutGroup.add(sideRow);

        // Sidebar width
        const widthRow = new Adw.ActionRow({ title: _('Sidebar Width'), subtitle: _('48 – 400 px') });
        const widthSpin = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 48, upper: 400, step_increment: 4, page_increment: 20,
                value: settings.get_int('sidebar-width'),
            }),
            valign: Gtk.Align.CENTER,
            numeric: true,
        });
        widthSpin.connect('value-changed', () => {
            settings.set_int('sidebar-width', widthSpin.get_value_as_int());
        });
        widthRow.add_suffix(widthSpin);
        layoutGroup.add(widthRow);

        // Auto-hide
        const autoHideGroup = new Adw.PreferencesGroup({ title: _('Behaviour') });
        generalPage.add(autoHideGroup);

        const autoHideRow = new Adw.ActionRow({
            title: _('Auto-hide When Window Overlaps'),
            subtitle: _('Hides the sidebar when any window is underneath it'),
        });
        const autoHideSwitch = new Gtk.Switch({
            active: settings.get_boolean('auto-hide'),
            valign: Gtk.Align.CENTER,
        });
        autoHideSwitch.connect('notify::active', () => {
            settings.set_boolean('auto-hide', autoHideSwitch.active);
        });
        autoHideRow.add_suffix(autoHideSwitch);
        autoHideGroup.add(autoHideRow);

        // ═══════════════════════════════════════════════════════
        // PAGE 2 – Actions
        // ═══════════════════════════════════════════════════════
        const actionsPage = new Adw.PreferencesPage({
            title: _('Actions'),
            icon_name: 'view-list-symbolic',
        });
        window.add(actionsPage);

        const actionsGroup = new Adw.PreferencesGroup({
            title: _('Sidebar Buttons'),
            description: _('Add, remove, and reorder the buttons shown in the sidebar. Changes are applied immediately.'),
        });
        actionsPage.add(actionsGroup);

        // ── Load actions from settings ────────────────────────
        let actions = [];
        try {
            actions = JSON.parse(settings.get_string('actions'));
            if (!Array.isArray(actions) || actions.length === 0) actions = _defaultActions();
        } catch (_e) {
            actions = _defaultActions();
        }

        this._actionRows = [];

        const saveActions = () => {
            const list = this._actionRows.map(r => r.getAction());
            settings.set_string('actions', JSON.stringify(list));
        };

        const buildRows = () => {
            // Remove all existing children
            for (const row of this._actionRows) {
                actionsGroup.remove(row);
            }
            this._actionRows = [];

            for (let i = 0; i < actions.length; i++) {
                // Capture i in a block-scoped const so closures below are correct
                const idx = i;
                const row = new ActionRow(actions[idx]);
                this._actionRows.push(row);
                actionsGroup.add(row);

                row.connect('changed', () => {
                    actions[idx] = row.getAction();
                    saveActions();
                });

                row.connect('removed', () => {
                    actions.splice(idx, 1);
                    buildRows();
                    saveActions();
                });

                row.connect('moved-up', () => {
                    if (idx === 0) return;
                    [actions[idx - 1], actions[idx]] = [actions[idx], actions[idx - 1]];
                    buildRows();
                    saveActions();
                });

                row.connect('moved-down', () => {
                    if (idx === actions.length - 1) return;
                    [actions[idx], actions[idx + 1]] = [actions[idx + 1], actions[idx]];
                    buildRows();
                    saveActions();
                });
            }
        };

        buildRows();

        // ── Add action button ─────────────────────────────────
        const addActionRow = new Adw.ActionRow({ title: _('Add New Action Button') });
        const typeModel = new Gtk.StringList();
        ACTION_TYPES.forEach(t => typeModel.append(t.label));

        const typeCombo = new Gtk.DropDown({
            model: typeModel,
            selected: 0,
            valign: Gtk.Align.CENTER,
        });

        const addBtn = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            label: _('Add'),
            css_classes: ['suggested-action'],
            valign: Gtk.Align.CENTER,
        });
        addBtn.connect('clicked', () => {
            const idx = typeCombo.get_selected();
            const meta = ACTION_TYPES[idx];
            actions.push({
                type: meta.id,
                label: meta.label,
                icon: meta.icon,
                iconColor: '',
                enabled: true,
                command: '',
                appId: '',
            });
            buildRows();
            saveActions();
        });

        const addBox = new Gtk.Box({ spacing: 8 });
        addBox.append(typeCombo);
        addBox.append(addBtn);
        addActionRow.add_suffix(addBox);

        const addGroup = new Adw.PreferencesGroup();
        actionsPage.add(addGroup);
        addGroup.add(addActionRow);

        // Reset to defaults button
        const resetRow = new Adw.ActionRow({ title: _('Reset Actions to Defaults') });
        const resetBtn = new Gtk.Button({
            label: _('Reset'),
            css_classes: ['destructive-action'],
            valign: Gtk.Align.CENTER,
        });
        resetBtn.connect('clicked', () => {
            actions = _defaultActions();
            buildRows();
            saveActions();
        });
        resetRow.add_suffix(resetBtn);
        addGroup.add(resetRow);
    }
}
