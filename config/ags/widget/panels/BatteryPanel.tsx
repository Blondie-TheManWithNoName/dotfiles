import { bind, Variable } from "astal";

import { Gtk } from "astal/gtk3";
import Battery from "gi://AstalBattery";

const battery = Battery.get_default();

function fmtTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, "0")}`;
    return `${m} min`;
}

export default function BatteryPanel() {
    const status = Variable.derive(
        [
            bind(battery, "state"),
            bind(battery, "timeToEmpty"),
            bind(battery, "timeToFull"),
        ],
        (state, timeToEmpty, timeToFull) => {
            switch (state) {
                case Battery.State.CHARGING:
                    return timeToFull > 0
                        ? `Charging — ${fmtTime(timeToFull)} until full`
                        : "Charging";
                case Battery.State.DISCHARGING:
                    return timeToEmpty > 0
                        ? `${fmtTime(timeToEmpty)} remaining`
                        : "On battery";
                case Battery.State.FULLY_CHARGED:
                    return "Fully charged";
                case Battery.State.PENDING_CHARGE:
                    return "Charging on hold";
                default:
                    return "Battery";
            }
        },
    );

    const draw = Variable.derive(
        [bind(battery, "state"), bind(battery, "energyRate")],
        (state, rate) =>
            state === Battery.State.DISCHARGING && rate > 0
                ? `Power draw: ${rate.toFixed(1)} W`
                : "",
    );

    return (
        <box vertical className="panel-content" spacing={4}>
            <box className="panel-header">
                <label
                    className="panel-title"
                    label="Battery"
                    halign={Gtk.Align.START}
                    hexpand
                />
                <label
                    className="battery-percent"
                    label={bind(battery, "percentage").as(
                        (p) => `${Math.floor(p * 100)}%`,
                    )}
                />
            </box>
            <label label={status()} halign={Gtk.Align.START} />
            <label
                className="dim-text"
                label={draw()}
                visible={bind(draw).as((d) => d !== "")}
                halign={Gtk.Align.START}
            />
            <label
                className="dim-text"
                label="Charge limit set to 80% (TLP)"
                halign={Gtk.Align.START}
            />
        </box>
    );
}
