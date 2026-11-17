import { Gtk } from "astal/gtk3";
import { GLib } from "astal";
import AstalApps from "gi://AstalApps";

const apps = new AstalApps.Apps();
// Deliberately NOT Gtk.IconTheme.get_default() (WhiteSur-dark): WhiteSur's
// app icons are macOS-dock-style — a white rounded-square backplate with a
// drop shadow baked into the asset. That reads fine at dock size but turns
// into a muddy border at the workspace pill's ~20px size, so pill icons are
// resolved against bare hicolor instead (flat logos, no backplate/shadow).
const theme = new Gtk.IconTheme();
theme.set_custom_theme("hicolor");
const cache = new Map<string, string>();

const FALLBACK = "application-x-executable-symbolic";

// Apps whose runtime window class doesn't match their .desktop Icon=/
// StartupWMClass at all (not even case), so neither lookup path below
// finds them. e.g. Claude Desktop's class is "com.anthropic.Claude" but
// its .desktop ships Icon=claude-desktop / StartupWMClass=claude-desktop.
const ICON_OVERRIDES: Record<string, string> = {
    "com.anthropic.claude": "claude-desktop",
};

// has_icon() can lie when the icon cache has a stale entry (theme was
// updated/uninstalled without gtk-update-icon-cache), which crashes the
// Icon widget at assign time. Verify the resolved file actually exists.
function iconFile(name: string | null | undefined): string | null {
    if (!name) return null;
    const info = theme.lookup_icon(name, 24, Gtk.IconLookupFlags.USE_BUILTIN);
    const path = info?.get_filename();
    return path && GLib.file_test(path, GLib.FileTest.EXISTS) ? path : null;
}

// Hyprland gives us a window class (e.g. "kitty", "zen", "org.kde.dolphin").
// Most icon themes ship an icon under that exact name; for the rest, fall
// back to the app's .desktop Icon= field via a wm_class/entry-id match.
// Returns a file path (not a bare icon name) once resolved — the Icon
// widget's `icon` prop happily takes either, but a bare name gets re-looked-up
// against the process-wide default theme (WhiteSur) at render time, undoing
// the point of resolving against `theme` (hicolor) above.
export function resolveAppIcon(wmClass: string | null | undefined): string {
    if (!wmClass) return FALLBACK;

    const cached = cache.get(wmClass);
    if (cached) return cached;

    const lower = wmClass.toLowerCase();
    const list = apps.get_list();
    const byWmClass = list.find(
        (a) => (a.get_wm_class() ?? "").toLowerCase() === lower,
    );
    const byEntry = list.find(
        (a) => a.get_entry().replace(/\.desktop$/, "").toLowerCase() === lower,
    );
    const candidate = byWmClass?.get_icon_name() ?? byEntry?.get_icon_name();

    const name =
        iconFile(ICON_OVERRIDES[lower]) ??
        iconFile(wmClass) ??
        iconFile(lower) ??
        iconFile(candidate) ??
        FALLBACK;

    cache.set(wmClass, name);
    return name;
}
