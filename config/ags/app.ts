import { App, Gdk, Gtk } from "astal/gtk3";
import style from "./style.scss";
import Bar, { barToggle } from "./widget/Bar";
import OSD, { showOsd } from "./widget/OSD";
import GroupToast from "./widget/GroupToast";
import Launcher, { toggleLauncher } from "./widget/Launcher";
import { openPanelByName, PANEL_WIDTH } from "./widget/Popover";
import MissionControl, { openMissionControl, closeMissionControl, toggleMissionControl } from "./widget/MissionControl";
import { switchGroup, desktopRealId } from "./widget/Workspaces";
import { execAsync } from "astal";


App.start({
    css: style,
    main() {
        // These used to be built once at startup, so a monitor plugged in
        // later never got a bar. That matters now that the Displays panel can
        // turn the laptop screen off: with no bar on the external, there'd be
        // no way to turn it back on again.
        const display = Gdk.Display.get_default()!;
        const perMonitor = new Map<Gdk.Monitor, Gtk.Widget[]>();

        const syncMonitors = () => {
            const current = new Set(App.get_monitors());

            for (const [mon, widgets] of perMonitor) {
                if (current.has(mon)) continue;
                widgets.forEach((w) => w.destroy());
                perMonitor.delete(mon);
            }

            for (const mon of current) {
                if (perMonitor.has(mon)) continue;
                perMonitor.set(mon, [
                    ...Bar(mon),
                    Launcher(mon),
                    MissionControl(mon),
                ] as unknown as Gtk.Widget[]);
            }
        };

        syncMonitors();
        display.connect("monitor-added", syncMonitors);
        display.connect("monitor-removed", syncMonitors);

        OSD();
        GroupToast();
    },
    requestHandler: (request: string, res: (response: any) => void) => {
        if (request === "barToggle") {
            // your bar toggle logic here
            barToggle()
            return;
        }

        if (request === "launcherToggle") {
            toggleLauncher();
            res("ok");
            return;
        }

        // "panel <wifi|bluetooth|sound|battery|calendar>" — toggle a popover
        if (request.startsWith("panel ")) {
            const name = request.split(" ")[1];
            if (name in PANEL_WIDTH) {
                openPanelByName(name);
                res("ok");
            } else {
                res(`unknown panel: ${name}`);
            }
            return;
        }

        // "missionControl <open|close|toggle>" — sent by the 3-finger swipe
        // gesture (fusuma) and available for keybinds too
        if (request.startsWith("missionControl")) {
            const action = request.slice("missionControl".length).toLowerCase();
            if (action === "open") openMissionControl();
            else if (action === "close") closeMissionControl();
            else toggleMissionControl();
            res("ok");
            return;
        }

        // "group <next|prev>" — switch desktop group, same as two-finger
        // scroll on the bar's workspace pills; keybind-able alternative
        if (request.startsWith("group ")) {
            const dir = request.split(" ")[1];
            switchGroup(dir === "prev" ? -1 : 1);
            res("ok");
            return;
        }

        // "desktop <N>" / "moveToDesktop <N>" — ALT(+SHIFT)+number keybinds.
        // N is 1-based and relative to whichever desktop group is currently
        // active (see widget/Workspaces.tsx), not a raw Hyprland workspace
        // number, since which real workspace "desktop 1" means depends on
        // the active group.
        if (request.startsWith("desktop ") || request.startsWith("moveToDesktop ")) {
            const [cmd, nStr] = request.split(" ");
            const realId = desktopRealId(Number(nStr));
            if (realId === null) {
                res(`no desktop ${nStr} in the active group`);
                return;
            }
            const dispatcher = cmd === "moveToDesktop" ? "movetoworkspace" : "workspace";
            execAsync(["hyprctl", "dispatch", dispatcher, String(realId)]).catch(console.error);
            res("ok");
            return;
        }

        // "osd <kind> <percent> <on|muted>" — sent by ~/scripts/osd.sh
        if (request.startsWith("osd ")) {
            const [, kind, pct, mute] = request.split(" ");
            showOsd(kind, Number(pct) || 0, mute === "muted");
            res("ok");
            return;
        }

        res("unknown command");
    }
});

(globalThis as any).barToggle = barToggle;
