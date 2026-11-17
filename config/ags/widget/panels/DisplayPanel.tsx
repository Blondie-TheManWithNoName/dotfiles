import { bind, Variable } from "astal";
import { Gtk } from "astal/gtk3";
import {
    canDisableInternal,
    externals,
    internalOn,
    modeOf,
    setInternalEnabled,
    setMode,
} from "../Display";
import type { Mode, Monitor } from "../Display";

const MODES: { mode: Mode; label: string; seg: string }[] = [
    { mode: "mirror", label: "Mirror", seg: "first" },
    { mode: "extend", label: "Extend", seg: "mid" },
    { mode: "off", label: "Off", seg: "last" },
];

function DisplayRow(m: Monitor) {
    const active = modeOf(m);

    return (
        <box vertical spacing={2}>
            <box>
                <label
                    className="panel-title"
                    label={m.name}
                    halign={Gtk.Align.START}
                    hexpand
                />
                <label
                    className="dim-text"
                    label={m.disabled ? "" : `${m.width}×${m.height}`}
                />
            </box>
            <label
                className="dim-text"
                label={m.description || "Unknown display"}
                halign={Gtk.Align.START}
                truncate
            />
            <box className="seg-group" homogeneous spacing={1}>
                {MODES.map(({ mode, label, seg }) => (
                    <button
                        className={`seg-btn ${seg}${mode === active ? " active" : ""}`}
                        onClicked={() => setMode(m.name, mode)}
                    >
                        <label label={label} />
                    </button>
                ))}
            </box>
        </box>
    );
}

// The laptop panel gets its own row rather than a fourth segment: it's a
// property of the internal display, not a mode of the external one.
function LaptopScreenRow() {
    // you can always switch the panel back on — only switching it off needs a
    // live external to fall back to
    const sensitive = Variable.derive(
        [bind(internalOn), bind(canDisableInternal)],
        (on, can) => !on || can,
    );

    return (
        <box className="panel-footer" spacing={8}>
            <box vertical hexpand>
                <label label="Laptop screen" halign={Gtk.Align.START} />
                <label
                    className="dim-text"
                    halign={Gtk.Align.START}
                    label={bind(sensitive).as((s) =>
                        s ? "Off = render on the TV only" : "Needs a live external",
                    )}
                />
            </box>
            <switch
                valign={Gtk.Align.CENTER}
                active={bind(internalOn)}
                sensitive={bind(sensitive)}
                setup={(self) => {
                    self.connect("notify::active", () => {
                        if (self.active !== internalOn.get())
                            setInternalEnabled(self.active);
                    });
                }}
            />
        </box>
    );
}

export default function DisplayPanel() {
    return (
        <box vertical className="panel-content" spacing={6}>
            <label className="panel-title" label="Displays" halign={Gtk.Align.START} />
            {externals().as((ms) =>
                ms.length === 0
                    ? [
                          <label
                              className="dim-text"
                              label="No external display — plug in HDMI"
                              halign={Gtk.Align.START}
                          />,
                      ]
                    : ms.map((m) => DisplayRow(m)),
            )}
            <LaptopScreenRow />
        </box>
    );
}
