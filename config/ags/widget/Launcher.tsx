import { App, Astal, Gdk, Gtk } from "astal/gtk3";
import { bind, Variable, readFile, writeFile, execAsync, exec } from "astal";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import GdkPixbuf from "gi://GdkPixbuf";
import AstalApps from "gi://AstalApps";

// Raycast-style app launcher: a transparent fullscreen TOP-layer window
// (same click-outside-backdrop pattern as Popover.tsx) holding a tall,
// draggable panel with a search entry and a fuzzy-filtered app list.

const WIDTH = 760;
const HEIGHT = 380;

// entries that ship on this system but aren't real user-facing apps and
// don't set NoDisplay/Hidden themselves (Astal's Apps already respects those)
const DENYLIST = ["avahi-discover", "bssh", "bvnc", "qv4l2", "qvidcap", "electron31", "electron34"];

const apps = new AstalApps.Apps();

// ── usage-based ranking ──────────────────────────────────────────────
// "frecency": each launch bumps a per-app counter, and the counter's
// contribution to the score decays with a 4-day half-life, so an app used
// often last month loses out to one used a couple of times this week.
const USAGE_FILE = `${GLib.get_user_cache_dir()}/ags/launcher-usage.json`;
const HALF_LIFE_DAYS = 4;

type Usage = Record<string, { count: number; last: number }>;

function loadUsage(): Usage {
    if (!GLib.file_test(USAGE_FILE, GLib.FileTest.EXISTS)) return {};
    try {
        const text = readFile(USAGE_FILE);
        return text ? JSON.parse(text) : {};
    } catch {
        return {};
    }
}

const usage: Usage = loadUsage();

function saveUsage() {
    try {
        GLib.mkdir_with_parents(GLib.path_get_dirname(USAGE_FILE), 0o755);
        writeFile(USAGE_FILE, JSON.stringify(usage));
    } catch (e) {
        console.error("launcher: failed to save usage", e);
    }
}

function recordUse(entry: string) {
    const u = usage[entry] ?? { count: 0, last: 0 };
    u.count += 1;
    u.last = Date.now();
    usage[entry] = u;
    saveUsage();
}

function frecency(entry: string): number {
    const u = usage[entry];
    if (!u) return 0;
    const ageDays = (Date.now() - u.last) / 86_400_000;
    return u.count * Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

// ── clipboard history (backed by cliphist, fed by `wl-paste --watch`) ──
type ClipItem = {
    id: string;
    raw: string; // full "id\tpreview" line, needed verbatim by `cliphist delete`
    isImage: boolean;
    preview: string;
    ext: string;
};

// cliphist's size field varies ("316 B", "1.2 KB", ...), so match loosely
// up to the trailing "<format> <dims>" pair instead of a fixed token count
const CLIP_BIN_RE = /^\[\[ binary data .+ (\w+) (\d+x\d+) \]\]$/;
const THUMB_DIR = `${GLib.get_user_cache_dir()}/ags/clip-thumbs`;
const thumbCache = new Map<string, string>();

function parseClipLine(line: string): ClipItem | null {
    const tab = line.indexOf("\t");
    if (tab === -1) return null;
    const id = line.slice(0, tab);
    const rest = line.slice(tab + 1);
    const bin = rest.match(CLIP_BIN_RE);
    if (bin) return { id, raw: line, isImage: true, preview: `Image · ${bin[2]}`, ext: bin[1] };
    return { id, raw: line, isImage: false, preview: rest, ext: "" };
}

function listClipboard(search: string): ClipItem[] {
    let raw = "";
    try {
        raw = exec(["cliphist", "list"]);
    } catch {
        return [];
    }
    const items = raw.split("\n").filter(Boolean).map(parseClipLine).filter((i): i is ClipItem => i !== null);
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter((i) => i.preview.toLowerCase().includes(q));
}

const THUMB_SIZE = 32;

// center-crops to a square then scales, so every thumbnail is exactly
// THUMB_SIZE x THUMB_SIZE regardless of the source image's aspect ratio
function squareCropScale(pixbuf: GdkPixbuf.Pixbuf, size: number): GdkPixbuf.Pixbuf {
    const w = pixbuf.get_width();
    const h = pixbuf.get_height();
    const side = Math.min(w, h);
    const cropped = side === w && side === h
        ? pixbuf
        : pixbuf.new_subpixbuf(Math.floor((w - side) / 2), Math.floor((h - side) / 2), side, side);
    return cropped.scale_simple(size, size, GdkPixbuf.InterpType.BILINEAR) ?? cropped;
}

// decodes + caches a square thumbnail file for an image clip so <icon> can
// show it; binary-safe (goes through GLib.Bytes, never through a JS string)
function thumbPath(item: ClipItem): string | null {
    if (!item.isImage) return null;
    const cached = thumbCache.get(item.id);
    if (cached) return cached;
    try {
        GLib.mkdir_with_parents(THUMB_DIR, 0o755);
        const path = `${THUMB_DIR}/${item.id}-${THUMB_SIZE}.png`;
        if (!GLib.file_test(path, GLib.FileTest.EXISTS)) {
            const proc = Gio.Subprocess.new(["cliphist", "decode", item.id], Gio.SubprocessFlags.STDOUT_PIPE);
            const [, stdout] = proc.communicate(null, null);
            if (!stdout) return null;
            const stream = Gio.MemoryInputStream.new_from_bytes(stdout);
            const pixbuf = GdkPixbuf.Pixbuf.new_from_stream(stream, null);
            squareCropScale(pixbuf, THUMB_SIZE).savev(path, "png", [], []);
        }
        thumbCache.set(item.id, path);
        return path;
    } catch (e) {
        console.error("launcher: failed to build clipboard thumbnail", e);
        return null;
    }
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|bmp|webp|svg)$/i;
const localThumbCache = new Map<string, string>();

// a copy from a file manager puts a `file://` reference on the clipboard,
// not image bytes — that's the real clipboard content and is what gets
// pasted back (see copyClipItem's use of this), but if it points at an
// image on disk we can still resolve + preview it
function resolveLocalImagePath(item: ClipItem): string | null {
    if (item.isImage || !item.preview.startsWith("file://") || item.preview.includes("…")) return null;
    const path = decodeURIComponent(item.preview.replace(/^file:\/\//, "")).trim();
    if (!IMAGE_EXT_RE.test(path) || !GLib.file_test(path, GLib.FileTest.EXISTS)) return null;
    return path;
}

// square-cropped thumbnail cache for a file:// image reference, keyed by
// the resolved source path (distinct from resolveLocalImagePath, which
// returns the real source used for pasting, not a display-sized copy)
function localImageThumb(item: ClipItem): string | null {
    const src = resolveLocalImagePath(item);
    if (!src) return null;
    const cached = localThumbCache.get(src);
    if (cached) return cached;
    try {
        GLib.mkdir_with_parents(THUMB_DIR, 0o755);
        const hash = GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, src, -1);
        const path = `${THUMB_DIR}/file-${hash}-${THUMB_SIZE}.png`;
        if (!GLib.file_test(path, GLib.FileTest.EXISTS)) {
            const pixbuf = GdkPixbuf.Pixbuf.new_from_file(src);
            squareCropScale(pixbuf, THUMB_SIZE).savev(path, "png", [], []);
        }
        localThumbCache.set(src, path);
        return path;
    } catch (e) {
        console.error("launcher: failed to build local image thumbnail", e);
        return null;
    }
}

const MIME_BY_EXT: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    bmp: "image/bmp",
    webp: "image/webp",
    svg: "image/svg+xml",
};

function copyClipItem(item: ClipItem) {
    closeLauncher();
    try {
        const localImg = resolveLocalImagePath(item);
        if (localImg) {
            // it's a file:// reference to an image — paste the actual image
            // bytes instead of the path text, like copying the image itself
            const [ok, contents] = GLib.file_get_contents(localImg);
            if (!ok) throw new Error(`failed to read ${localImg}`);
            const ext = localImg.split(".").pop()?.toLowerCase() ?? "";
            const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";
            const copy = Gio.Subprocess.new(["wl-copy", "--type", mime], Gio.SubprocessFlags.STDIN_PIPE);
            copy.communicate(new GLib.Bytes(contents), null);
        } else {
            const decode = Gio.Subprocess.new(["cliphist", "decode", item.id], Gio.SubprocessFlags.STDOUT_PIPE);
            const [, stdout] = decode.communicate(null, null);
            const copy = Gio.Subprocess.new(["wl-copy"], Gio.SubprocessFlags.STDIN_PIPE);
            copy.communicate(stdout, null);
        }
    } catch (e) {
        console.error("launcher: failed to copy clipboard item", e);
        return;
    }
    // give the compositor a beat to hand focus back to the previously
    // active window before synthesizing the paste keystroke
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
        try {
            exec(["wtype", "-M", "ctrl", "-k", "v", "-m", "ctrl"]);
        } catch (e) {
            console.error("launcher: auto-paste failed", e);
        }
        return GLib.SOURCE_REMOVE;
    });
}

function deleteClipItem(item: ClipItem, after: () => void) {
    try {
        const proc = Gio.Subprocess.new(["cliphist", "delete"], Gio.SubprocessFlags.STDIN_PIPE);
        const bytes = new GLib.Bytes(new TextEncoder().encode(item.raw + "\n"));
        proc.communicate(bytes, null);
    } catch (e) {
        console.error("launcher: failed to delete clipboard item", e);
    }
    after();
}

export const launcherOpen = Variable(false);
const query = Variable("");
const selected = Variable(0);
const mode = Variable<"apps" | "clipboard">("apps");
const panelX = Variable(0);
const panelY = Variable(0);

let activeMonitor: Gdk.Monitor | null = null;

function centerPanel() {
    const geo = activeMonitor?.get_geometry();
    const screenWidth = geo?.width ?? 1920;
    const screenHeight = geo?.height ?? 1080;
    panelX.set(Math.round((screenWidth - WIDTH) / 2));
    panelY.set(Math.round((screenHeight - HEIGHT) / 3));
}

export function openLauncher() {
    query.set("");
    selected.set(0);
    mode.set("apps");
    centerPanel();
    launcherOpen.set(true);
}

export function closeLauncher() {
    launcherOpen.set(false);
}

export function toggleLauncher() {
    if (launcherOpen.get()) closeLauncher();
    else openLauncher();
}

// Escape backs out of clipboard mode into the app list first, and only
// closes the launcher on a second press — same as Raycast's sub-views.
let refreshListRef: (() => void) | null = null;

function backOrClose() {
    if (mode.get() === "clipboard") {
        mode.set("apps");
        query.set("");
        selected.set(0);
        refreshListRef?.();
    } else {
        closeLauncher();
    }
}

type Row =
    | { t: "app"; app: AstalApps.Application }
    | { t: "cmd" }
    | { t: "clip"; item: ClipItem };

function appRows(search: string): Row[] {
    const list = search ? apps.fuzzy_query(search) : apps.get_list();
    const filtered = list.filter((a) => !DENYLIST.includes(a.entry.replace(/\.desktop$/, "")));
    // while searching, text relevance leads; when just browsing, rank by
    // usage + recency so the top of the list is the "top apps" list
    if (!search) filtered.sort((a, b) => frecency(b.entry) - frecency(a.entry));
    const rows: Row[] = filtered.map((app) => ({ t: "app", app }));
    if (!search || "clipboard history".includes(search.toLowerCase())) {
        rows.unshift({ t: "cmd" });
    }
    return rows;
}

function computeRows(m: "apps" | "clipboard", search: string): Row[] {
    if (m === "clipboard") return listClipboard(search).map((item) => ({ t: "clip", item }));
    return appRows(search);
}

// finds the nearest workspace with zero windows (or the next unused
// workspace id if every existing one is occupied), switches to it, then
// launches the app there — Hyprland opens new windows on the active
// workspace, so switching first is enough to land the app on a fresh desktop
async function launchOnNewWorkspace(app: AstalApps.Application) {
    try {
        const [wsRaw, activeRaw] = await Promise.all([
            execAsync(["hyprctl", "-j", "workspaces"]),
            execAsync(["hyprctl", "-j", "activeworkspace"]),
        ]);
        const workspaces: { id: number; windows: number }[] = JSON.parse(wsRaw);
        const active: number = JSON.parse(activeRaw).id;

        const empty = workspaces.filter((w) => w.windows === 0);
        let target: number;
        if (empty.length > 0) {
            target = empty.reduce((best, w) =>
                Math.abs(w.id - active) < Math.abs(best.id - active) ? w : best,
            ).id;
        } else {
            const used = new Set(workspaces.map((w) => w.id));
            target = 1;
            while (used.has(target)) target++;
        }

        await execAsync(["hyprctl", "dispatch", "workspace", String(target)]);
    } catch (e) {
        console.error("launcher: failed to switch to a free workspace", e);
    }
    recordUse(app.entry);
    app.launch();
}

function launch(app: AstalApps.Application, onNewDesktop = false) {
    closeLauncher();
    if (onNewDesktop) {
        launchOnNewWorkspace(app);
    } else {
        recordUse(app.entry);
        app.launch();
    }
}

export default function Launcher(gdkmonitor: Gdk.Monitor) {
    const { TOP, LEFT, RIGHT, BOTTOM } = Astal.WindowAnchor;

    activeMonitor = gdkmonitor;

    let dragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let panelStartX = 0;
    let panelStartY = 0;

    let currentItems: Row[] = computeRows(mode.get(), query.get());

    const listBox = (
        <box vertical className="launcher-list" />
    ) as Gtk.Box;

    function enterClipboardMode() {
        mode.set("clipboard");
        query.set("");
        selected.set(0);
        refreshList();
    }

    function activateRow(row: Row, altHeld: boolean) {
        if (row.t === "app") launch(row.app, altHeld);
        else if (row.t === "cmd") enterClipboardMode();
        else copyClipItem(row.item);
    }

    function buildRow(row: Row, sel: boolean): Gtk.Widget {
        const cls = sel ? "launcher-row launcher-row-selected" : "launcher-row";

        if (row.t === "app") {
            return (
                <button
                    className={cls}
                    onButtonPressEvent={(_, event) => {
                        const [, state] = event.get_state();
                        activateRow(row, (state & Gdk.ModifierType.MOD1_MASK) !== 0);
                        return true;
                    }}
                >
                    <box spacing={10}>
                        <icon icon={row.app.iconName} pixelSize={28} />
                        <label className="launcher-row-name" label={row.app.name} xalign={0} valign={Gtk.Align.CENTER} />
                    </box>
                </button>
            ) as Gtk.Widget;
        }

        if (row.t === "cmd") {
            return (
                <button className={cls} onButtonPressEvent={() => { activateRow(row, false); return true; }}>
                    <box spacing={10}>
                        <icon icon="edit-paste-symbolic" pixelSize={28} />
                        <label className="launcher-row-name" label="Clipboard History" xalign={0} valign={Gtk.Align.CENTER} />
                    </box>
                </button>
            ) as Gtk.Widget;
        }

        const item = row.item;
        const thumb = thumbPath(item) ?? localImageThumb(item);
        return (
            <eventbox
                className={cls}
                onButtonPressEvent={() => { activateRow(row, false); return true; }}
            >
                <box spacing={10}>
                    {thumb ? (
                        <icon className="launcher-row-thumb" icon={thumb} pixelSize={THUMB_SIZE} widthRequest={THUMB_SIZE} heightRequest={THUMB_SIZE} />
                    ) : (
                        <icon icon={item.isImage ? "image-x-generic-symbolic" : "edit-paste-symbolic"} pixelSize={THUMB_SIZE} widthRequest={THUMB_SIZE} heightRequest={THUMB_SIZE} />
                    )}
                    <label
                        className="launcher-row-name"
                        label={item.preview}
                        xalign={0}
                        valign={Gtk.Align.CENTER}
                        hexpand
                        truncate
                        maxWidthChars={70}
                    />
                    <button
                        className="launcher-row-delete"
                        onButtonPressEvent={() => {
                            deleteClipItem(item, refreshList);
                            return true;
                        }}
                    >
                        <label label="✕" />
                    </button>
                </box>
            </eventbox>
        ) as Gtk.Widget;
    }

    function rebuildList(items: Row[], sel: number) {
        listBox.get_children().forEach((c) => c.destroy());
        items.slice(0, 50).forEach((row, i) => listBox.add(buildRow(row, i === sel)));
        listBox.show_all();
    }

    // recomputes the ranked/filtered list from scratch — called on every
    // launcher open (so frecency reflects the latest usage) and keystroke
    function refreshList() {
        currentItems = computeRows(mode.get(), query.get());
        rebuildList(currentItems, selected.get());
    }
    refreshListRef = refreshList;

    refreshList();
    query.subscribe(() => {
        selected.set(0);
        refreshList();
    });
    selected.subscribe((sel) => rebuildList(currentItems, sel));

    // GTK3's placeholder-text has no reliable CSS styling hook, so the hint
    // is drawn as a manually-overlaid label instead of relying on it.
    const placeholderLabel = (
        <label
            className="launcher-entry-placeholder"
            label={bind(mode).as((m) => (m === "clipboard" ? "Search clipboard..." : "Search apps..."))}
            xalign={0}
            visible={bind(query).as((q) => q === "")}
        />
    ) as Gtk.Widget;

    const entry = (
        <entry
            className="launcher-entry"
            text={bind(query)}
            onChanged={(self) => {
                query.set(self.text);
                selected.set(0);
            }}
            onKeyPressEvent={(self, event) => {
                const keyval = event.get_keyval()[1];
                const items = currentItems;
                if (keyval === Gdk.KEY_Down) {
                    selected.set(Math.min(selected.get() + 1, Math.max(items.length - 1, 0)));
                    return true;
                }
                if (keyval === Gdk.KEY_Up) {
                    selected.set(Math.max(selected.get() - 1, 0));
                    return true;
                }
                if (keyval === Gdk.KEY_Return) {
                    const row = items[selected.get()];
                    const [, state] = event.get_state();
                    if (row) activateRow(row, (state & Gdk.ModifierType.MOD1_MASK) !== 0);
                    return true;
                }
                if (keyval === Gdk.KEY_Escape) {
                    backOrClose();
                    return true;
                }
                if (keyval === Gdk.KEY_BackSpace && self.text === "" && mode.get() === "clipboard") {
                    mode.set("apps");
                    refreshList();
                    return true;
                }
                return false;
            }}
        />
    ) as Gtk.Widget;

    launcherOpen.subscribe((open) => {
        if (open) {
            refreshList();
            (entry as Gtk.Entry).grab_focus();
        }
    });

    const dragHandle = (
        <eventbox
            className="launcher-drag-handle"
            onButtonPressEvent={(_, event) => {
                const [, x, y] = event.get_root_coords();
                dragging = true;
                dragStartX = x;
                dragStartY = y;
                panelStartX = panelX.get();
                panelStartY = panelY.get();
                return true;
            }}
            onButtonReleaseEvent={() => {
                dragging = false;
                return true;
            }}
            onMotionNotifyEvent={(_, event) => {
                if (!dragging) return false;
                const [, x, y] = event.get_root_coords();
                panelX.set(panelStartX + (x - dragStartX));
                panelY.set(panelStartY + (y - dragStartY));
                return true;
            }}
        >
            <box hexpand valign={Gtk.Align.CENTER} heightRequest={14} />
        </eventbox>
    ) as Gtk.Widget;

    return (
        <window
            name="launcher"
            namespace="launcher"
            className="Launcher"
            gdkmonitor={gdkmonitor}
            anchor={TOP | LEFT | RIGHT | BOTTOM}
            exclusivity={Astal.Exclusivity.IGNORE}
            layer={Astal.Layer.OVERLAY}
            keymode={Astal.Keymode.ON_DEMAND}
            visible={bind(launcherOpen)}
            application={App}
            onKeyPressEvent={(_, event) => {
                if (event.get_keyval()[1] === Gdk.KEY_Escape) backOrClose();
            }}
            onButtonPressEvent={() => {
                closeLauncher();
            }}
        >
            <eventbox
                halign={Gtk.Align.START}
                valign={Gtk.Align.START}
                marginStart={bind(panelX)}
                marginTop={bind(panelY)}
                onButtonPressEvent={() => true}
            >
                <box
                    className="launcher-panel"
                    vertical
                    widthRequest={WIDTH}
                    heightRequest={HEIGHT}
                >
                    {dragHandle}
                    <overlay passThrough>
                        {entry}
                        <box className="launcher-entry-placeholder-box">
                            {placeholderLabel}
                        </box>
                    </overlay>
                    <scrollable vexpand hscroll={Gtk.PolicyType.NEVER}>
                        {listBox}
                    </scrollable>
                </box>
            </eventbox>
        </window>
    );
}
