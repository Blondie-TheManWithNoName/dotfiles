import { App, Astal } from "astal/gtk3"
import { Variable, timeout } from "astal"
import type AstalIO from "gi://AstalIO"

type Kind = "volume" | "mic" | "brightness" | "kbd" | "night"

const state = Variable({ kind: "volume" as Kind, pct: 0, muted: false })
const visible = Variable(false)
let hideTimer: AstalIO.Time | null = null

export function showOsd(kind: string, pct: number, muted: boolean) {
    state.set({ kind: kind as Kind, pct, muted })
    visible.set(true)
    hideTimer?.cancel()
    hideTimer = timeout(1500, () => visible.set(false))
}

function iconName({ kind, pct, muted }: { kind: Kind; pct: number; muted: boolean }) {
    switch (kind) {
        case "mic":
            return muted
                ? "microphone-sensitivity-muted-symbolic"
                : "microphone-sensitivity-high-symbolic"
        case "brightness":
            return "display-brightness-symbolic"
        case "kbd":
            return "keyboard-brightness-symbolic"
        case "night":
            return "night-light-symbolic"
        default:
            if (muted || pct === 0) return "audio-volume-muted-symbolic"
            if (pct < 34) return "audio-volume-low-symbolic"
            if (pct < 67) return "audio-volume-medium-symbolic"
            return "audio-volume-high-symbolic"
    }
}

export default function OSD() {
    return <window
        name="osd"
        namespace="osd"
        className="OSD"
        layer={Astal.Layer.OVERLAY}
        exclusivity={Astal.Exclusivity.IGNORE}
        visible={visible()}
        application={App}>
        <box vertical className="osd-box">
            <icon icon={state(s => iconName(s))} vexpand />
            <levelbar value={state(s => (s.muted ? 0 : s.pct / 100))} />
        </box>
    </window>
}
