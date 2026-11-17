import { App, Astal, Gdk, Gtk } from "astal/gtk3";
import { bind, Variable } from "astal";

// Pattern borrowed from HyprPanel's DropdownMenu: a transparent fullscreen
// TOP-layer window acts as a click-outside backdrop, the panel itself is
// positioned inside it with margins computed from the clicked bar button.

export const PANEL_WIDTH: Record<string, number> = {
    wifi: 300,
    bluetooth: 300,
    sound: 320,
    battery: 300,
    calendar: 320,
    display: 300,
};

export const openPanel = Variable("");
const panelX = Variable(8);
const panelTop = Variable(40);

// Which monitor the open panel belongs to. Popovers are built once per bar,
// so without this every monitor would pop its own copy of the same panel —
// clicking the bar on the laptop would also throw a panel onto the TV.
const openOn = Variable<Gdk.Monitor | null>(null);

// window names have to stay unique across monitors
let serial = 0;

// toggle a panel without a bar button (for `ags request "panel <name>"`
// and future keybinds) — anchors it near the right edge of the screen
export function openPanelByName(name: string) {
    if (openPanel.get() === name) {
        openPanel.set("");
        return;
    }
    const width = PANEL_WIDTH[name] ?? 300;
    // Gdk.Screen.get_width() returns physical pixels, not the logical/scaled
    // width layer-shell margins use (same units as bar.get_allocated_width()
    // in togglePanel below) — read it off a monitor's geometry instead, or
    // the panel opens off-screen on a HiDPI scale like this laptop's 1.67x.
    const primary = App.get_monitors()[0] ?? null;
    const screenWidth = primary?.get_geometry().width ?? 1728;
    panelX.set(Math.max(8, screenWidth - width - 12));
    panelTop.set(40);
    openOn.set(primary);
    openPanel.set(name);
}

export function togglePanel(name: string, button: Gtk.Widget) {
    if (openPanel.get() === name) {
        openPanel.set("");
        return;
    }

    const width = PANEL_WIDTH[name] ?? 300;
    // the bar spans the full monitor width, so allocation.x is a screen coordinate
    const alloc = button.get_allocation();
    const bar = button.get_toplevel();
    const screenWidth = bar.get_allocated_width();

    const centered = Math.round(alloc.x + alloc.width / 2 - width / 2);
    panelX.set(Math.min(Math.max(centered, 8), Math.max(8, screenWidth - width - 8)));
    panelTop.set(bar.get_allocated_height() + 6);
    openOn.set((bar as any).gdkmonitor ?? null);
    openPanel.set(name);
}

export function Popover({
    name,
    gdkmonitor,
    child,
}: {
    name: string;
    gdkmonitor?: Gdk.Monitor;
    child?: JSX.Element;
}) {
    const { TOP, LEFT, RIGHT, BOTTOM } = Astal.WindowAnchor;

    // namespace stays stable so any layerrules keep matching; only the
    // window name carries the per-monitor suffix
    const id = serial++;

    const visible = Variable.derive(
        [bind(openPanel), bind(openOn)],
        (panel, mon) =>
            panel === name && (!mon || !gdkmonitor || mon === gdkmonitor),
    );

    return (
        <window
            name={`popover-${name}-${id}`}
            namespace={`popover-${name}`}
            className="Popover"
            gdkmonitor={gdkmonitor}
            anchor={TOP | LEFT | RIGHT | BOTTOM}
            exclusivity={Astal.Exclusivity.IGNORE}
            layer={Astal.Layer.TOP}
            keymode={Astal.Keymode.ON_DEMAND}
            visible={bind(visible)}
            application={App}
            onKeyPressEvent={(_, event) => {
                if (event.get_keyval()[1] === Gdk.KEY_Escape)
                    openPanel.set("");
            }}
            onButtonPressEvent={() => {
                openPanel.set("");
            }}
        >
            <eventbox
                halign={Gtk.Align.START}
                valign={Gtk.Align.START}
                marginStart={bind(panelX)}
                marginTop={bind(panelTop)}
                onButtonPressEvent={() => true}
            >
                <box
                    className="popover-panel"
                    vertical
                    widthRequest={PANEL_WIDTH[name] ?? 300}
                >
                    {child}
                </box>
            </eventbox>
        </window>
    );
}
