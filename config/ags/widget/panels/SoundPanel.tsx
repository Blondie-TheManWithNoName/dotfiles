import { bind, Variable, execAsync } from "astal";
import { Gtk } from "astal/gtk3";
import Wp from "gi://AstalWp";
import { openPanel } from "../Popover";

function volumeIcon(volume: number, mute: boolean) {
    if (mute) return "󰝟";
    if (volume >= 0.66) return "󰕾";
    if (volume >= 0.33) return "󰖀";
    if (volume > 0) return "󰕿";
    return "󰸈";
}

function SliderRow({ endpoint, icons }: { endpoint: Wp.Endpoint; icons: [string, string] }) {
    const icon = Variable.derive(
        [bind(endpoint, "volume"), bind(endpoint, "mute")],
        (volume, mute) => (mute ? icons[1] : icons[0]),
    );

    return (
        <box spacing={8}>
            <button
                className="panel-row-icon-btn"
                label={icon()}
                onClicked={() => (endpoint.mute = !endpoint.mute)}
            />
            <slider
                hexpand
                min={0}
                max={1}
                value={bind(endpoint, "volume")}
                onDragged={(self) => {
                    endpoint.volume = self.value;
                    endpoint.mute = false;
                }}
            />
        </box>
    );
}

export default function SoundPanel() {
    const audio = Wp.get_default()?.audio;
    if (!audio) return <box />;

    const speaker = audio.defaultSpeaker;
    const mic = audio.defaultMicrophone;

    const speakerIcon = Variable.derive(
        [bind(speaker, "volume"), bind(speaker, "mute")],
        volumeIcon,
    );

    return (
        <box vertical className="panel-content" spacing={4}>
            <label
                className="panel-title"
                label="Sound"
                halign={Gtk.Align.START}
            />
            <box spacing={8}>
                <button
                    className="panel-row-icon-btn"
                    label={speakerIcon()}
                    onClicked={() => (speaker.mute = !speaker.mute)}
                />
                <slider
                    hexpand
                    min={0}
                    max={1}
                    value={bind(speaker, "volume")}
                    onDragged={(self) => {
                        speaker.volume = self.value;
                        speaker.mute = false;
                    }}
                />
            </box>
            <label
                className="panel-subtitle"
                label="Output Device"
                halign={Gtk.Align.START}
            />
            <box vertical spacing={2}>
                {bind(audio, "speakers").as((speakers) =>
                    speakers.map((ep) => (
                        <button
                            className="panel-row"
                            onClicked={() => ep.set_is_default(true)}
                        >
                            <box spacing={8}>
                                <label
                                    label={bind(ep, "description").as(
                                        (d) => d ?? "Unknown device",
                                    )}
                                    halign={Gtk.Align.START}
                                    hexpand
                                    truncate
                                />
                                {bind(ep, "isDefault").as((isDefault) =>
                                    isDefault
                                        ? <label className="accent" label="󰄬" />
                                        : <box />,
                                )}
                            </box>
                        </button>
                    )),
                )}
            </box>
            {mic ? (
                <box vertical spacing={4}>
                    <label
                        className="panel-subtitle"
                        label="Microphone"
                        halign={Gtk.Align.START}
                    />
                    <SliderRow endpoint={mic} icons={["󰍬", "󰍭"]} />
                </box>
            ) : (
                <box />
            )}
            <button
                className="panel-row panel-footer"
                onClicked={() => {
                    openPanel.set("");
                    execAsync("pavucontrol").catch(console.error);
                }}
            >
                <label label="Sound Settings…" halign={Gtk.Align.START} />
            </button>
        </box>
    );
}
