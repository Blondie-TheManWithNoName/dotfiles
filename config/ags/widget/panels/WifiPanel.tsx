import { bind, Variable, execAsync } from "astal";
import { Gtk } from "astal/gtk3";
import Network from "gi://AstalNetwork";
import { openPanel } from "../Popover";

const network = Network.get_default();

export function signalIcon(strength: number) {
    if (strength >= 80) return "󰤨";
    if (strength >= 60) return "󰤥";
    if (strength >= 40) return "󰤢";
    if (strength >= 20) return "󰤟";
    return "󰤯";
}

function isSecured(ap: Network.AccessPoint): boolean {
    const rp = (ap as any).requiresPassword;
    if (rp !== undefined) return rp;
    return ((ap as any).flags & 0x1) !== 0;
}

// one row per SSID, strongest AP wins
function visibleNetworks(aps: Network.AccessPoint[]) {
    const bySsid = new Map<string, Network.AccessPoint>();
    for (const ap of aps) {
        if (!ap.ssid) continue;
        const existing = bySsid.get(ap.ssid);
        if (!existing || ap.strength > existing.strength)
            bySsid.set(ap.ssid, ap);
    }
    return [...bySsid.values()]
        .sort((a, b) => b.strength - a.strength)
        .slice(0, 12);
}

export default function WifiPanel() {
    const wifi = network.wifi;
    if (!wifi) return <box />;

    const staging = Variable<Network.AccessPoint | null>(null);
    const error = Variable("");

    openPanel.subscribe((panel) => {
        if (panel === "wifi") {
            wifi.scan();
        } else {
            staging.set(null);
            error.set("");
        }
    });

    function connect(ap: Network.AccessPoint, password?: string) {
        error.set("");
        if (wifi!.activeAccessPoint?.ssid === ap.ssid && !password) return;

        const cmd = ["nmcli", "device", "wifi", "connect", ap.ssid];
        if (password) cmd.push("password", password);

        execAsync(cmd)
            .then(() => {
                staging.set(null);
                error.set("");
            })
            .catch((err) => {
                if (isSecured(ap)) {
                    staging.set(ap);
                    if (password) error.set("Connection failed. Try again.");
                } else {
                    error.set("Connection failed.");
                    console.error(err);
                }
            });
    }

    return (
        <box vertical className="panel-content" spacing={4}>
            <box className="panel-header">
                <label
                    className="panel-title"
                    label="Wi-Fi"
                    halign={Gtk.Align.START}
                    hexpand
                />
                <switch
                    valign={Gtk.Align.CENTER}
                    setup={(self) => {
                        self.active = wifi.enabled;
                        self.hook(wifi, "notify::enabled", () => {
                            self.active = wifi.enabled;
                        });
                        self.connect("notify::active", () => {
                            if (self.active !== wifi.enabled)
                                wifi.set_enabled(self.active);
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
                    {bind(wifi, "accessPoints").as((aps) =>
                        visibleNetworks(aps).map((ap) => (
                            <button
                                className="panel-row"
                                onClicked={() => connect(ap)}
                            >
                                <box spacing={8}>
                                    <label
                                        className="panel-row-icon"
                                        label={signalIcon(ap.strength)}
                                    />
                                    <label
                                        label={ap.ssid}
                                        halign={Gtk.Align.START}
                                        hexpand
                                        truncate
                                    />
                                    {isSecured(ap)
                                        ? <label className="dim" label="󰌾" />
                                        : <box />}
                                    {bind(wifi, "activeAccessPoint").as((active) =>
                                        active?.ssid === ap.ssid
                                            ? <label className="accent" label="󰄬" />
                                            : <box />,
                                    )}
                                </box>
                            </button>
                        )),
                    )}
                </box>
            </scrollable>
            <revealer
                revealChild={bind(staging).as((s) => s !== null)}
                transitionType={Gtk.RevealerTransitionType.SLIDE_DOWN}
            >
                <box vertical spacing={4}>
                    <entry
                        visibility={false}
                        placeholderText={bind(staging).as((s) =>
                            s ? `Password for “${s.ssid}”` : "",
                        )}
                        onActivate={(self) => {
                            const ap = staging.get();
                            if (ap && self.text.length > 0)
                                connect(ap, self.text);
                        }}
                    />
                    <label
                        className="error"
                        label={bind(error)}
                        visible={bind(error).as((e) => e !== "")}
                        halign={Gtk.Align.START}
                    />
                </box>
            </revealer>
            <button
                className="panel-row panel-footer"
                onClicked={() => {
                    openPanel.set("");
                    execAsync(["kitty", "--title", "Wi-Fi", "-e", "nmtui"]).catch(
                        console.error,
                    );
                }}
            >
                <label label="Network Settings…" halign={Gtk.Align.START} />
            </button>
        </box>
    );
}
