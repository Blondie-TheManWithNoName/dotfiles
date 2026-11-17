import { bind, Variable } from "astal";
import Network from "gi://AstalNetwork";
import Bluetooth from "gi://AstalBluetooth";
import Wp from "gi://AstalWp";
import Tray from "gi://AstalTray";
import { togglePanel } from "./Popover";
import { toggleLauncher } from "./Launcher";

function wifiIconName(enabled: boolean, ssid: string | null, strength: number) {
    if (!enabled) return "network-wireless-disabled-symbolic";
    if (!ssid) return "network-wireless-offline-symbolic";
    if (strength >= 80) return "network-wireless-signal-excellent-symbolic";
    if (strength >= 55) return "network-wireless-signal-good-symbolic";
    if (strength >= 30) return "network-wireless-signal-ok-symbolic";
    if (strength > 0) return "network-wireless-signal-weak-symbolic";
    return "network-wireless-signal-none-symbolic";
}

export function WifiIcon() {
    const wifi = Network.get_default().wifi;
    if (!wifi) return <box />;

    const icon = Variable.derive(
        [bind(wifi, "enabled"), bind(wifi, "strength"), bind(wifi, "ssid")],
        (enabled, strength, ssid) => wifiIconName(enabled, ssid, strength),
    );

    return (
        <button
            className="status-icon"
            tooltipText={bind(wifi, "ssid").as((s) => s ?? "Not connected")}
            onClicked={(self) => togglePanel("wifi", self)}
        >
            <icon className="status-icon-img" icon={icon()} pixelSize={18} />
        </button>
    );
}

export function VolumeIcon() {
    const speaker = Wp.get_default()?.audio.defaultSpeaker;
    if (!speaker) return <box />;

    const icon = Variable.derive(
        [bind(speaker, "volume"), bind(speaker, "mute")],
        (volume, mute) => {
            if (mute) return "audio-volume-muted-symbolic";
            if (volume >= 0.66) return "audio-volume-high-symbolic";
            if (volume >= 0.33) return "audio-volume-medium-symbolic";
            if (volume > 0) return "audio-volume-low-symbolic";
            return "audio-volume-muted-symbolic";
        },
    );

    return (
        <button
            className="status-icon"
            tooltipText={bind(speaker, "volume").as(
                (v) => `Volume ${Math.round(v * 100)}%`,
            )}
            onClicked={(self) => togglePanel("sound", self)}
            onScroll={(_, event) => {
                const next = speaker.volume - event.delta_y * 0.04;
                speaker.volume = Math.min(1, Math.max(0, next));
            }}
        >
            <icon className="status-icon-img" icon={icon()} pixelSize={18} />
        </button>
    );
}

export function BluetoothIcon() {
    const bt = Bluetooth.get_default();

    const icon = Variable.derive(
        [bind(bt, "isPowered"), bind(bt, "isConnected")],
        (powered, connected) => {
            if (!powered) return "bluetooth-disabled-symbolic";
            if (connected) return "bluetooth-active-symbolic";
            return "bluetooth-disconnected-symbolic";
        },
    );

    return (
        <button
            className="status-icon"
            onClicked={(self) => togglePanel("bluetooth", self)}
        >
            <icon className="status-icon-img" icon={icon()} pixelSize={18} />
        </button>
    );
}

export function SpotlightIcon() {
    return (
        <button
            className="status-icon"
            tooltipText="Search"
            onClicked={() => toggleLauncher()}
        >
            <icon className="status-icon-img" icon="system-search-symbolic" pixelSize={18} />
        </button>
    );
}

export function SysTray() {
    const tray = Tray.get_default();
    return (
        <box className="systray">
            {bind(tray, "items").as((items) =>
                items.map((item) => (
                    <menubutton
                        className="tray-item"
                        tooltipMarkup={bind(item, "tooltipMarkup")}
                        usePopover={false}
                        actionGroup={bind(item, "actionGroup").as(
                            (ag) => ["dbusmenu", ag] as const,
                        )}
                        menuModel={bind(item, "menuModel")}
                    >
                        <icon gicon={bind(item, "gicon")} pixelSize={16} />
                    </menubutton>
                )),
            )}
        </box>
    );
}
