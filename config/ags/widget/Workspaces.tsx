import { bind, execAsync, Variable } from "astal";
import { Gdk, Gtk } from "astal/gtk3";
import GLib from "gi://GLib";
import Hyprland from "gi://AstalHyprland";
import { resolveAppIcon } from "./lib/appIcon";
import { GROUPS, realWorkspaceId, type GroupDef } from "./lib/profiles";
import { showGroupToast } from "./GroupToast";

const hypr = Hyprland.get_default();
const PROFILE_SCRIPT = GLib.build_filenamev([GLib.get_home_dir(), "scripts", "desktop-profile.sh"]);

const activeGroupIndex = Variable(0);

// Workspace membership (which client is on which desktop) can change
// without the `clients` property itself changing (a window just moves
// between existing workspaces), so `clients`'s own notify doesn't fire.
// Bump a tick on the signals that actually mean "recompute the pills".
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

// A group with nothing on any of its desktops yet gets populated with its
// defaults once — never touches a group that already has anything running,
// so this is safe to call every time a group becomes active, not just once.
function launchIfEmpty(group: GroupDef) {
    const hasAnything = hypr.get_workspaces().some((w) => {
        const id = w.get_id();
        return id >= group.base && id < group.base + group.count && w.get_clients().length > 0;
    });
    if (!hasAnything) {
        execAsync([PROFILE_SCRIPT, "launch", group.key]).catch(console.error);
    }
}

function restartGroup(group: GroupDef) {
    execAsync([PROFILE_SCRIPT, "restart", group.key]).catch(console.error);
}

// The restart button only shows after hovering the group area for ~1s, so
// it doesn't clutter the bar the rest of the time. The pills (and the
// button itself) are each their own GtkButton with its own GdkWindow —
// GTK's enter/leave-notify crossing events get complicated and unreliable
// once the pointer is moving between an eventbox and windowed children
// nested inside it (tried filtering by crossing "detail" first; hovering
// directly over a pill never triggered anything at all, since apparently
// none of the crossing events reaching the eventbox in that case counted as
// a "real" one either). Sidestep the whole problem: poll the pointer's
// position against the group box's own allocation instead of trusting
// event propagation through the nested buttons.
const showRestart = Variable(false);
let revealTimer = 0;
let hideTimer = 0;
let wasInside = false;

function cancelTimer(id: number) {
    if (id) GLib.source_remove(id);
}

function onGroupAreaEnter() {
    cancelTimer(hideTimer);
    hideTimer = 0;
    if (showRestart.get()) return;
    cancelTimer(revealTimer);
    revealTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
        showRestart.set(true);
        revealTimer = 0;
        return GLib.SOURCE_REMOVE;
    });
}

function onGroupAreaLeave() {
    cancelTimer(revealTimer);
    revealTimer = 0;
    cancelTimer(hideTimer);
    hideTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
        showRestart.set(false);
        hideTimer = 0;
        return GLib.SOURCE_REMOVE;
    });
}

function startHoverPoll(box: Gtk.Widget) {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {
        const window = box.get_window();
        const pointer = Gdk.Display.get_default()?.get_default_seat()?.get_pointer();
        if (!window || !pointer) return GLib.SOURCE_CONTINUE;

        const [, x, y] = window.get_device_position(pointer);
        const alloc = box.get_allocation();
        const inside = x >= 0 && y >= 0 && x < alloc.width && y < alloc.height;

        if (inside && !wasInside) onGroupAreaEnter();
        else if (!inside && wasInside) onGroupAreaLeave();
        wasInside = inside;

        return GLib.SOURCE_CONTINUE;
    });
}

// Two-finger scroll anywhere on the bar switches groups (jumps to the new
// group's first desktop) rather than individual desktops one at a time —
// that's what clicking a pill is already for. The scroll handler itself
// lives on the whole bar (see Bar.tsx) so it isn't limited to the pills'
// small hit area; exported so both that and app.ts's `ags request "group
// next|prev"` (a keybind-able alternative) can trigger it.
export function switchGroup(direction: 1 | -1) {
    const next = (activeGroupIndex.get() + direction + GROUPS.length) % GROUPS.length;
    const group = GROUPS[next];
    activeGroupIndex.set(next);
    showGroupToast(group.name);
    launchIfEmpty(group);
    execAsync(["hyprctl", "dispatch", "workspace", String(group.base)]).catch(console.error);
}

// A single physical two-finger scroll produces a whole stream of tiny
// smooth-scroll ticks (not one discrete event), so calling switchGroup()
// straight from onScroll fires it many times per swipe. Same problem the
// fusuma 3-finger swipe config (~/.config/fusuma/config.yml) already solves
// for gesture swipes — threshold: accumulate distance and only trigger once
// it's past a minimum; interval: ignore further ticks for a cooldown window
// after triggering, so one gesture reliably means exactly one switch.
const SCROLL_THRESHOLD = 3;
const SCROLL_COOLDOWN_MS = 500;
const SCROLL_IDLE_RESET_MS = 200;

let scrollAccum = 0;
let lastSwitchAt = 0;
let idleResetSource = 0;

export function handleBarScroll(deltaY: number) {
    if (idleResetSource) GLib.source_remove(idleResetSource);
    idleResetSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SCROLL_IDLE_RESET_MS, () => {
        scrollAccum = 0;
        idleResetSource = 0;
        return GLib.SOURCE_REMOVE;
    });

    scrollAccum += deltaY;

    const now = GLib.get_monotonic_time() / 1000;
    if (Math.abs(scrollAccum) < SCROLL_THRESHOLD || now - lastSwitchAt < SCROLL_COOLDOWN_MS) return;

    switchGroup(scrollAccum > 0 ? 1 : -1);
    scrollAccum = 0;
    lastSwitchAt = now;
}

// Resolves "desktop N" (1-based, as the ALT+number keybinds and the pills
// both talk about it) to the real Hyprland workspace ID for whichever group
// is currently active — e.g. ALT+1 means Hyprland workspace 101 while
// Programming is active, 201 while Design is. Null if N is out of range for
// the current group (Design only has 3 desktops, so ALT+4 there is a no-op).
export function desktopRealId(n: number): number | null {
    const group = GROUPS[activeGroupIndex.get()];
    if (n < 1 || n > group.count) return null;
    return realWorkspaceId(group, n - 1);
}

type PillData = {
    desktopNumber: number; // 1-based, relative to the active group
    realId: number;
    clients: Hyprland.Client[];
    active: boolean;
};

function computePills(group: GroupDef): PillData[] {
    const focusedId = hypr.get_focused_workspace()?.get_id();
    const workspaces = hypr.get_workspaces();

    return Array.from({ length: group.count }, (_, i) => {
        const realId = realWorkspaceId(group, i);
        const ws = workspaces.find((w) => w.get_id() === realId);
        return {
            desktopNumber: i + 1,
            realId,
            clients: ws?.get_clients() ?? [],
            active: realId === focusedId,
        };
    });
}

function WorkspacePill({
    pill,
    isFirst,
    isLast,
}: {
    pill: PillData;
    isFirst: boolean;
    isLast: boolean;
}) {
    const classes = ["workspace-pill"];
    if (pill.active) classes.push("active");
    if (isFirst) classes.push("first");
    else if (isLast) classes.push("last");
    else classes.push("mid");

    return (
        <button
            className={classes.join(" ")}
            onClicked={() =>
                execAsync(["hyprctl", "dispatch", "workspace", String(pill.realId)]).catch(
                    console.error,
                )
            }
        >
            <box vertical spacing={2} halign={Gtk.Align.CENTER}>
                <box className="workspace-dots" spacing={3} halign={Gtk.Align.CENTER}>
                    {Array.from({ length: pill.desktopNumber }, (_, i) => (
                        <box className="workspace-dot" />
                    ))}
                </box>
                {pill.clients.length > 0 ? (
                    <box className="workspace-apps" spacing={3} halign={Gtk.Align.CENTER}>
                        {pill.clients.map((c) => (
                            <icon
                                className="workspace-app-icon"
                                tooltipText={c.get_title()}
                                icon={resolveAppIcon(c.get_class())}
                                pixelSize={24}
                            />
                        ))}
                    </box>
                ) : (
                    <box />
                )}
            </box>
        </button>
    );
}

export default function Workspaces({ gdkmonitor }: { gdkmonitor: Gdk.Monitor }) {
    launchIfEmpty(GROUPS[activeGroupIndex.get()]);

    const pills = Variable.derive(
        [bind(tick), bind(hypr, "focusedWorkspace"), bind(activeGroupIndex)],
        () => computePills(GROUPS[activeGroupIndex.get()]),
    );

    return (
        // scroll-to-switch-group is handled bar-wide (see Bar.tsx's outer
        // eventbox) — this eventbox exists purely so startHoverPoll() has a
        // widget with its own GdkWindow to query the pointer position
        // against; a plain <box> has no window of its own to ask
        <eventbox setup={(self) => startHoverPoll(self)}>
            <box spacing={4} halign={Gtk.Align.CENTER}>
                <box className="workspaces" spacing={4} halign={Gtk.Align.CENTER}>
                    {bind(pills).as((list) =>
                        list.map((pill, i) => (
                            <WorkspacePill
                                pill={pill}
                                isFirst={i === 0}
                                isLast={i === list.length - 1}
                            />
                        )),
                    )}
                </box>
                <revealer
                    transitionType={Gtk.RevealerTransitionType.SLIDE_RIGHT}
                    transitionDuration={220}
                    revealChild={bind(showRestart)}
                >
                    <button
                        className="group-restart"
                        tooltipText="Restart this group"
                        onClicked={() => restartGroup(GROUPS[activeGroupIndex.get()])}
                    >
                        <icon icon="view-refresh-symbolic" pixelSize={14} />
                    </button>
                </revealer>
            </box>
        </eventbox>
    );
}
