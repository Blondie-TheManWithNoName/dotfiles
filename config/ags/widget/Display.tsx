import { bind, execAsync, timeout, Variable } from "astal";
import { togglePanel } from "./Popover";

// External-display control for the bar. `hyprctl monitors` is the source of
// truth rather than AstalHyprland, whose Monitor objects don't carry the
// `disabled` / `mirrorOf` fields the mode below is derived from.

export type Mode = "mirror" | "extend" | "off";

export type Monitor = {
    name: string;
    description: string;
    disabled: boolean;
    mirrorOf: string;
    width: number;
    height: number;
};

// laptop panels come up as eDP-* (LVDS-* on pre-eDP hardware); everything
// else — HDMI-A-*, DP-*, DVI-* — is an external we're willing to drive
function isInternal(name: string) {
    return name.startsWith("eDP") || name.startsWith("LVDS");
}

function parse(out: string): Monitor[] | null {
    try {
        return JSON.parse(out).map((m: any) => ({
            name: m.name,
            description: m.description ?? "",
            disabled: !!m.disabled,
            mirrorOf: m.mirrorOf ?? "none",
            width: m.width ?? 0,
            height: m.height ?? 0,
        }));
    } catch (err) {
        console.error("display: could not parse hyprctl monitors:", err);
        return null;
    }
}

// `monitors all` keeps outputs that are plugged in but disabled, while an
// unplugged output drops off the list entirely — that absence is what
// "nothing connected" looks like to everything below
const MONITORS_CMD = ["hyprctl", "-j", "monitors", "all"];

const monitors = Variable<Monitor[]>([]).poll(
    2000,
    MONITORS_CMD,
    (out, prev) => parse(out) ?? prev,
);

// the 2s poll would catch our own changes eventually, but that's long enough
// to read as a dead button, so re-read right after acting
function refresh() {
    execAsync(MONITORS_CMD)
        .then((out) => {
            const next = parse(out);
            if (next) monitors.set(next);
        })
        .catch(console.error);
}

export const externals = Variable.derive([bind(monitors)], (ms) =>
    ms.filter((m) => !isInternal(m.name)),
);

// ── "TV only": run the external alone with the laptop panel off ──

export const internalOn = Variable.derive([bind(monitors)], (ms) => {
    const m = ms.find((x) => isInternal(x.name));
    return m ? !m.disabled : true;
});

// turning the laptop panel off is only safe while something else is lit
export const canDisableInternal = Variable.derive([bind(monitors)], (ms) =>
    ms.some((m) => !isInternal(m.name) && !m.disabled),
);

// `hyprctl reload` rather than re-deriving a monitor spec from the runtime
// state: hyprctl rounds the scale it reports (1.67 for a panel configured at
// 1.666667), and feeding that back gives a fractional pixel size Hyprland
// refuses. Reapplying hyprland.conf is the one restore guaranteed to be valid.
let restoring = false;

function restoreInternal() {
    if (restoring) return;
    restoring = true;
    execAsync(["hyprctl", "reload"])
        .then(refresh)
        .catch((err) => console.error("display: restoring laptop panel failed:", err))
        .finally(() => timeout(3000, () => (restoring = false)));
}

export function setInternalEnabled(on: boolean) {
    const ms = monitors.get();
    const m = ms.find((x) => isInternal(x.name));
    if (!m) return;

    if (on) {
        restoreInternal();
        return;
    }

    if (!ms.some((x) => !isInternal(x.name) && !x.disabled)) {
        console.warn("display: refusing TV-only — no live external display");
        return;
    }

    execAsync(["hyprctl", "keyword", "monitor", `${m.name},disable`])
        .then(refresh)
        .catch((err) => {
            console.error("display: disabling laptop panel failed:", err);
            refresh();
        });
}

// Dead-man's switch. If the external we were relying on vanishes while the
// laptop panel is off — cable pulled, TV powered down, both of which happened
// while testing this — every output would be dark with no way to recover
// short of a TTY. Bring the panel straight back instead.
monitors.subscribe((ms) => {
    const m = ms.find((x) => isInternal(x.name));
    if (!m?.disabled) return;
    if (ms.some((x) => !isInternal(x.name) && !x.disabled)) return;
    console.warn("display: external gone while laptop panel off — restoring");
    restoreInternal();
});

export function modeOf(m: Monitor): Mode {
    if (m.disabled) return "off";
    if (m.mirrorOf !== "none") return "mirror";
    return "extend";
}

export const MODE_LABEL: Record<Mode, string> = {
    mirror: "Mirroring",
    extend: "Extended",
    off: "Off",
};

export function setMode(name: string, mode: Mode) {
    const ms = monitors.get();
    const internalMon = ms.find((m) => isInternal(m.name));

    // scale 1 on purpose: externals here are 1080p TVs and projectors, and a
    // mirror only lines up if both outputs agree on a scale
    const spec =
        mode === "off"
            ? `${name},disable`
            : mode === "mirror" && internalMon
              ? `${name},preferred,auto,1,mirror,${internalMon.name}`
              : `${name},preferred,auto,1`;

    // switching off the last lit external while the laptop panel is disabled
    // would leave nothing on screen — bring the panel back first, in order,
    // rather than letting the dead-man's switch catch it a poll later
    const otherLive = ms.some(
        (m) => !isInternal(m.name) && m.name !== name && !m.disabled,
    );
    const ready =
        mode === "off" && internalMon?.disabled && !otherLive
            ? execAsync(["hyprctl", "reload"])
            : Promise.resolve("");

    ready
        .then(() => execAsync(["hyprctl", "keyword", "monitor", spec]))
        .then(refresh)
        .catch((err) => {
            console.error(`display: ${mode} on ${name} failed:`, err);
            refresh();
        });
}

export function DisplayIcon() {
    const icon = externals().as((ms) => {
        const live = ms.filter((m) => !m.disabled);
        if (live.length === 0) return "video-single-display-symbolic";
        return live.some((m) => m.mirrorOf !== "none")
            ? "video-display-symbolic"
            : "video-joined-displays-symbolic";
    });

    const tooltip = externals().as((ms) =>
        ms.length === 0
            ? "No external display"
            : ms.map((m) => `${m.name} — ${MODE_LABEL[modeOf(m)]}`).join("\n"),
    );

    return (
        <button
            className="status-icon"
            tooltipText={tooltip}
            onClicked={(self) => togglePanel("display", self)}
        >
            <icon className="status-icon-img" icon={icon} pixelSize={18} />
        </button>
    );
}
