import { bind, execAsync } from "astal";
import { Gtk } from "astal/gtk3";
import Bluetooth from "gi://AstalBluetooth";
import { openPanel } from "../Popover";

const bt = Bluetooth.get_default();

function sortedDevices(devices: Bluetooth.Device[]) {
    return devices
        .filter((d) => d.name)
        .sort(
            (a, b) =>
                Number(b.connected) - Number(a.connected) ||
                Number(b.paired) - Number(a.paired) ||
                a.name.localeCompare(b.name),
        )
        .slice(0, 10);
}

export default function BluetoothPanel() {
    return (
        <box vertical className="panel-content" spacing={4}>
            <box className="panel-header">
                <label
                    className="panel-title"
                    label="Bluetooth"
                    halign={Gtk.Align.START}
                    hexpand
                />
                <switch
                    valign={Gtk.Align.CENTER}
                    setup={(self) => {
                        self.active = bt.isPowered;
                        self.hook(bt, "notify::is-powered", () => {
                            self.active = bt.isPowered;
                        });
                        self.connect("notify::active", () => {
                            const adapter = bt.adapter;
                            if (adapter && self.active !== bt.isPowered)
                                adapter.set_powered(self.active);
                        });
                    }}
                />
            </box>
            <scrollable
                hscroll={Gtk.PolicyType.NEVER}
                vscroll={Gtk.PolicyType.AUTOMATIC}
                propagateNaturalHeight
                maxContentHeight={280}
            >
                <box vertical spacing={2}>
                    {bind(bt, "devices").as((devices) => {
                        const rows = sortedDevices(devices);
                        if (rows.length === 0)
                            return [
                                <label
                                    className="dim-text"
                                    label="No known devices"
                                    halign={Gtk.Align.START}
                                />,
                            ];
                        return rows.map((d) => (
                            <button
                                className="panel-row"
                                onClicked={() => {
                                    if (d.connected) d.disconnect_device(() => {});
                                    else d.connect_device(() => {});
                                }}
                            >
                                <box spacing={8}>
                                    <label
                                        className="panel-row-icon"
                                        label={bind(d, "connected").as((c) =>
                                            c ? "󰂱" : "󰂯",
                                        )}
                                    />
                                    <label
                                        label={d.name}
                                        halign={Gtk.Align.START}
                                        hexpand
                                        truncate
                                    />
                                    <label
                                        className="dim-text"
                                        label={bind(d, "batteryPercentage").as((p) =>
                                            p > 0 ? `${Math.round(p * 100)}%` : "",
                                        )}
                                    />
                                    {bind(d, "connected").as((c) =>
                                        c
                                            ? <label className="accent" label="󰄬" />
                                            : <box />,
                                    )}
                                </box>
                            </button>
                        ));
                    })}
                </box>
            </scrollable>
            <button
                className="panel-row panel-footer"
                onClicked={() => {
                    openPanel.set("");
                    execAsync("blueman-manager").catch(console.error);
                }}
            >
                <label label="Bluetooth Settings…" halign={Gtk.Align.START} />
            </button>
        </box>
    );
}
