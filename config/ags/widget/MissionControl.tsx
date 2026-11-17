import { bind, Variable, execAsync } from "astal";
import { App, Astal, Gdk, Gtk } from "astal/gtk3";
import GLib from "gi://GLib";
import GdkPixbuf from "gi://GdkPixbuf";
import Hyprland from "gi://AstalHyprland";
import { resolveAppIcon } from "./lib/appIcon";

// macOS-style Mission Control: a fullscreen OVERLAY-layer window showing
// every desktop (Hyprland workspace) as a card. Every window on a card gets
// its own REAL live thumbnail, tiled at its actual on-screen position/size
// (see tileRectFor), via a small helper binary (helpers/toplevel-capture)
// that speaks Hyprland's hyprland-toplevel-export-v1 protocol directly —
// this works even for windows on workspaces that aren't currently visible on
// any monitor (regular screenshot tools can't do that), and crucially runs as
// its own process: a bug in the capture path can't crash Hyprland the way an
// in-process compositor plugin can (we learned this the hard way with hyprexpo).
// Click a card to jump to its primary window, or a specific window tile to
// jump straight to that one. Triggered by a 3-finger swipe up (fusuma →
// `ags request missionControlOpen/Close`).

const hypr = Hyprland.get_default();

export const missionControlOpen = Variable(false);

export function openMissionControl() {
    missionControlOpen.set(true);
}

export function closeMissionControl() {
    missionControlOpen.set(false);
}

export function toggleMissionControl() {
    if (missionControlOpen.get()) closeMissionControl();
    else openMissionControl();
}

// same "recompute on structural change" tick as Workspaces.tsx — workspace
// membership can change without `clients` itself notifying
const tick = Variable(0);
for (const sig of [
    "client-added",
    "client-removed",
    "client-moved",
    "workspace-added",
    "workspace-removed",
]) {
    hypr.connect(sig, () => tick.set(tick.get() + 1));
}

// ── live thumbnails via the toplevel-capture helper ─────────────────────
const CAPTURE_BIN = `${GLib.get_home_dir()}/.config/ags/bin/toplevel-capture`;
const THUMB_DIR = `${GLib.get_user_cache_dir()}/ags/mc-thumbs`;

const thumbPaths = new Map<string, Variable<string | null>>();

function getThumbVar(address: string): Variable<string | null> {
    let v = thumbPaths.get(address);
    if (!v) {
        v = Variable(null);
        thumbPaths.set(address, v);
    }
    return v;
}

// Parses the helper's raw output (8-byte LE width/height header + raw RGB8
// pixels), wraps it as a GdkPixbuf, scales it to exactly fill the card, and
// saves a PNG — reusing this codebase's existing "pre-scale, then display via
// <icon icon={path}>" idiom (see Launcher.tsx's clipboard thumbnails) instead
// of guessing how the icon widget would handle an arbitrary live pixbuf.
async function captureThumb(address: string, targetW: number, targetH: number) {
    const thumbVar = getThumbVar(address);
    const key = address.replace(/^0x/, "");
    const rawPath = `${THUMB_DIR}/${key}.raw`;
    const pngPath = `${THUMB_DIR}/${key}.png`;

    try {
        GLib.mkdir_with_parents(THUMB_DIR, 0o755);
        // capture a bit oversized (2x target) so the downscale below has
        // some headroom to look sharp on this HiDPI panel
        await execAsync([CAPTURE_BIN, address, rawPath, String(targetW * 2), String(targetH * 2)]);

        const [ok, contents] = GLib.file_get_contents(rawPath);
        if (!ok || !contents) throw new Error("failed to read raw capture");
        const bytes = contents instanceof Uint8Array ? contents : new Uint8Array(contents);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const w = view.getUint32(0, true);
        const h = view.getUint32(4, true);
        const pixels = bytes.slice(8, 8 + w * h * 3);

        const pixbuf = GdkPixbuf.Pixbuf.new_from_bytes(
            new GLib.Bytes(pixels),
            GdkPixbuf.Colorspace.RGB,
            false,
            8,
            w,
            h,
            w * 3,
        );
        const scaled = pixbuf.scale_simple(targetW, targetH, GdkPixbuf.InterpType.BILINEAR) ?? pixbuf;
        scaled.savev(pngPath, "png", [], []);
        thumbVar.set(pngPath);
    } catch (e) {
        console.error("mission-control: thumbnail capture failed for", address, e);
        thumbVar.set(null);
    } finally {
        GLib.unlink(rawPath);
    }
}

type CardData = {
    id: number;
    workspace: Hyprland.Workspace;
    clients: Hyprland.Client[];
    active: boolean;
};

function matchMonitorId(gdkmonitor: Gdk.Monitor): number | undefined {
    const monitors = hypr.get_monitors();
    if (monitors.length <= 1) return monitors[0]?.get_id();

    const geo = gdkmonitor.get_geometry();
    const match = monitors.find((m) => m.get_x() === geo.x && m.get_y() === geo.y);
    return (match ?? monitors[0])?.get_id();
}

function computeCards(monitorId: number | undefined): CardData[] {
    const focusedId = hypr.get_focused_workspace()?.get_id();

    return hypr
        .get_workspaces()
        .filter(
            (ws) =>
                ws.get_id() > 0 &&
                (monitorId === undefined || ws.get_monitor()?.get_id() === monitorId),
        )
        .sort((a, b) => a.get_id() - b.get_id())
        .map((ws) => ({
            id: ws.get_id(),
            workspace: ws,
            clients: ws.get_clients(),
            active: ws.get_id() === focusedId,
        }));
}

function primaryClient(card: CardData): Hyprland.Client | null {
    const last = card.workspace.lastClient;
    if (last && card.clients.includes(last)) return last;
    return card.clients[0] ?? null;
}

// Below this many card-pixels on a side, a live capture would be
// imperceptibly small — just show the app icon instead and save the work.
const MIN_TILE_FOR_CAPTURE = 28;

type TileRect = { x: number; y: number; w: number; h: number };

// Maps a window's absolute Hyprland layout coordinates onto the card,
// using this monitor's own geometry as the reference frame — mirrors
// exactly where the window actually sits on screen, tiled or floating.
function tileRectFor(c: Hyprland.Client, monitorGeo: { x: number; y: number; width: number; height: number }, cardWidth: number, cardHeight: number): TileRect {
    const scaleX = cardWidth / Math.max(monitorGeo.width, 1);
    const scaleY = cardHeight / Math.max(monitorGeo.height, 1);
    const x = Math.round((c.get_x() - monitorGeo.x) * scaleX);
    const y = Math.round((c.get_y() - monitorGeo.y) * scaleY);
    const w = Math.max(1, Math.round(c.get_width() * scaleX));
    const h = Math.max(1, Math.round(c.get_height() * scaleY));
    return { x, y, w, h };
}

function WindowTile({ client, rect }: { client: Hyprland.Client; rect: TileRect }) {
    const bigEnough = rect.w >= MIN_TILE_FOR_CAPTURE && rect.h >= MIN_TILE_FOR_CAPTURE;
    const thumbVar = getThumbVar(client.get_address());

    return (
        <eventbox
            className="mc-win-tile"
            halign={Gtk.Align.START}
            valign={Gtk.Align.START}
            marginStart={rect.x}
            marginTop={rect.y}
            widthRequest={rect.w}
            heightRequest={rect.h}
            onButtonPressEvent={() => {
                client.focus();
                closeMissionControl();
                return true;
            }}
        >
            {bigEnough ? (
                bind(thumbVar).as((path) =>
                    path ? (
                        // Astal.Icon always renders into a square box sized off
                        // CSS font-size (see astal/gtk3/src/widget/icon.vala) —
                        // wrong tool for a wide thumbnail. A plain box with a
                        // CSS background-image fills the tile exactly instead.
                        <box
                            className="mc-win-thumb"
                            hexpand
                            vexpand
                            tooltipText={client.get_title()}
                            css={`background-image: url("file://${path}"); background-size: cover; background-position: center;`}
                        />
                    ) : (
                        <box className="mc-win-thumb-loading" hexpand vexpand halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER}>
                            <icon
                                tooltipText={client.get_title()}
                                icon={resolveAppIcon(client.get_class())}
                                pixelSize={Math.round(Math.max(16, Math.min(40, rect.w / 2, rect.h / 2)))}
                            />
                        </box>
                    ),
                )
            ) : (
                <box className="mc-win-thumb-loading" hexpand vexpand halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER}>
                    <icon
                        tooltipText={client.get_title()}
                        icon={resolveAppIcon(client.get_class())}
                        pixelSize={Math.round(Math.max(12, Math.min(24, rect.w / 2, rect.h / 2)))}
                    />
                </box>
            )}
        </eventbox>
    );
}

function WorkspaceCard({
    card,
    cardWidth,
    cardHeight,
    monitorGeo,
}: {
    card: CardData;
    cardWidth: number;
    cardHeight: number;
    monitorGeo: { x: number; y: number; width: number; height: number };
}) {
    const classes = card.active ? "mc-card active" : "mc-card";

    function activate() {
        const primary = primaryClient(card);
        if (primary) primary.focus();
        else card.workspace.focus();
        closeMissionControl();
    }

    return (
        <box vertical spacing={8} halign={Gtk.Align.CENTER}>
            <eventbox
                className={classes}
                widthRequest={cardWidth}
                heightRequest={cardHeight}
                onButtonPressEvent={() => {
                    activate();
                    return true;
                }}
            >
                <overlay>
                    <box widthRequest={cardWidth} heightRequest={cardHeight} />
                    {card.clients.map((c) => (
                        <WindowTile client={c} rect={tileRectFor(c, monitorGeo, cardWidth, cardHeight)} />
                    ))}
                </overlay>
            </eventbox>
            <label className="mc-card-label" label={String(card.id)} />
        </box>
    );
}

export default function MissionControl(gdkmonitor: Gdk.Monitor) {
    const { TOP, LEFT, RIGHT, BOTTOM } = Astal.WindowAnchor;

    const monitorId = matchMonitorId(gdkmonitor);
    const geo = gdkmonitor.get_geometry();
    const cardHeight = 170;
    const cardWidth = Math.round(cardHeight * (geo.width / Math.max(geo.height, 1)));

    const cards = Variable.derive(
        [bind(tick), bind(hypr, "focusedWorkspace"), bind(hypr, "monitors")],
        () => computeCards(monitorId),
    );

    // fresh captures every time this monitor's overview opens — window
    // content changes constantly, so caching across opens isn't worth it.
    // Every window gets captured at its own tile size (skipping tiles too
    // small to matter), not just each card's primary window.
    missionControlOpen.subscribe((open) => {
        if (!open) return;
        for (const card of cards.get()) {
            for (const c of card.clients) {
                const rect = tileRectFor(c, geo, cardWidth, cardHeight);
                if (rect.w >= MIN_TILE_FOR_CAPTURE && rect.h >= MIN_TILE_FOR_CAPTURE) {
                    captureThumb(c.get_address(), rect.w, rect.h);
                }
            }
        }
    });

    return (
        <window
            name="mission-control"
            namespace="mission-control"
            className="MissionControl"
            gdkmonitor={gdkmonitor}
            anchor={TOP | LEFT | RIGHT | BOTTOM}
            exclusivity={Astal.Exclusivity.IGNORE}
            layer={Astal.Layer.OVERLAY}
            keymode={Astal.Keymode.ON_DEMAND}
            visible={bind(missionControlOpen)}
            application={App}
            onKeyPressEvent={(_, event) => {
                if (event.get_keyval()[1] === Gdk.KEY_Escape) closeMissionControl();
            }}
            onButtonPressEvent={() => {
                closeMissionControl();
            }}
        >
            <box hexpand vexpand halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER}>
                <eventbox onButtonPressEvent={() => true}>
                    <box spacing={28} halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER} className="mc-row">
                        {bind(cards).as((list) =>
                            list.map((card) => (
                                <WorkspaceCard card={card} cardWidth={cardWidth} cardHeight={cardHeight} monitorGeo={geo} />
                            )),
                        )}
                    </box>
                </eventbox>
            </box>
        </window>
    );
}
