import { App, Astal } from "astal/gtk3";
import { Variable, timeout } from "astal";
import type AstalIO from "gi://AstalIO";

// Brief "which group am I in now" toast, shown for ~1s whenever the active
// desktop group changes (see switchGroup() in Workspaces.tsx). A separate
// overlay window rather than a label in the bar itself — that way it never
// reserves space in the bar's layout, appearing/disappearing doesn't shift
// the workspace pills or anything next to them.
const groupName = Variable("");
const visible = Variable(false);
let hideTimer: AstalIO.Time | null = null;

export function showGroupToast(name: string) {
    groupName.set(name);
    visible.set(true);
    hideTimer?.cancel();
    hideTimer = timeout(1000, () => visible.set(false));
}

export default function GroupToast() {
    return (
        <window
            name="group-toast"
            namespace="group-toast"
            className="GroupToast"
            layer={Astal.Layer.OVERLAY}
            exclusivity={Astal.Exclusivity.IGNORE}
            anchor={Astal.WindowAnchor.TOP}
            visible={visible()}
            application={App}
        >
            <box className="group-toast-box">
                <label label={groupName()} />
            </box>
        </window>
    );
}
