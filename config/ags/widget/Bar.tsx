import { App, Astal, Gtk, Gdk } from "astal/gtk3"
import { bind, Variable } from "astal"
import { BatteryWidget } from "./Battery"
import AppleMenu from "./AppleMenu"
import ActiveApp from "./ActiveApp"
import { WifiIcon, VolumeIcon, BluetoothIcon, SpotlightIcon, SysTray } from "./StatusIcons"
import { FanIcon } from "./FanProfile"
import { DisplayIcon } from "./Display"
import { Popover, togglePanel } from "./Popover"
import WifiPanel from "./panels/WifiPanel"
import BluetoothPanel from "./panels/BluetoothPanel"
import SoundPanel from "./panels/SoundPanel"
import BatteryPanel from "./panels/BatteryPanel"
import CalendarPanel from "./panels/CalendarPanel"
import DisplayPanel from "./panels/DisplayPanel"
import Workspaces, { handleBarScroll } from "./Workspaces"

const time = Variable("").poll(1000, () => {
    const date = new Date()
    const hours = date.getHours().toString().padStart(2, '0')
    const minutes = date.getMinutes().toString().padStart(2, '0')
    const dayName = date.toLocaleDateString('en-US', { weekday: 'short' })
    const dayNumber = date.getDate()
    const month = date.toLocaleDateString('en-US', { month: 'short' })
    return `${dayName} ${dayNumber} ${month} ${hours}:${minutes}`
})

const barVisible = Variable(true) // <-- state
const barHide = Variable(true) // <-- state

export function barToggle() {
    barVisible.set(!bind(barVisible).get()) // The `barVisible.set()` function correctly updates the state
    return bind(barVisible).get();
}

export default function Bar(gdkmonitor: Gdk.Monitor) {
    const { TOP, LEFT, RIGHT } = Astal.WindowAnchor

    const barWindow = <window
        name="bar"
        namespace="bar"
        className="Bar"
        gdkmonitor={gdkmonitor}
        exclusivity={Astal.Exclusivity.EXCLUSIVE}
        anchor={TOP | LEFT | RIGHT}
        visible={bind(barVisible)} // <- Direct binding to barVisible
        application={App}>
        {
            // Scroll-to-switch-group needs to work over the whole bar, not
            // just the workspace pills — a plain GTK box has no GdkWindow of
            // its own, so wrap everything in one eventbox with the scroll
            // mask explicitly enabled (GtkEventBox doesn't listen for scroll
            // by default even with a handler attached). Buttons underneath
            // (Apple menu, pills, volume icon, clock...) still get first
            // crack at the event via GTK's normal event propagation, so the
            // volume icon's own scroll-to-adjust keeps working right over it.
        }
        <eventbox
            onScroll={(_, event) => handleBarScroll(event.delta_y)}
            setup={(self) => self.add_events(Gdk.EventMask.SCROLL_MASK)}
        >
            <centerbox className="bar-inner">
                <box halign={Gtk.Align.START} spacing={2}>
                    <AppleMenu />
                    <ActiveApp />
                </box>
                <Workspaces gdkmonitor={gdkmonitor} />
                <box halign={Gtk.Align.END} spacing={2}>
                    <SysTray />
                    <FanIcon />
                    <DisplayIcon />
                    <BluetoothIcon />
                    <WifiIcon />
                    <VolumeIcon />
                    <button
                        className="battery-button"
                        onClicked={(self) => togglePanel("battery", self)}
                    >
                        <BatteryWidget />
                    </button>
                    <SpotlightIcon />
                    <button
                        className="clock"
                        label={time()}
                        onClicked={(self) => togglePanel("calendar", self)}
                    />
                </box>
            </centerbox>
        </eventbox>
    </window>

const hoverVisible = Variable.derive([bind(barVisible)], (visible) => !visible)

    const hoverZone = 

    <window
        name="hover-reveal"
        gdkmonitor={gdkmonitor}
        layer={Astal.Layer.OVERLAY}
        exclusivity={Astal.Exclusivity.IGNORE}
        anchor={TOP | LEFT | RIGHT}
        application={App}
        className="HoverZone"
        visible={bind(hoverVisible)}  // <-- this is now reactive // <- Binding for the inverse of `barVisible`
    >
        <box hexpand={true} vexpand={false}>
            <eventbox
                hexpand={true}
                vexpand={false}
                height-request={2}
                on_enter_notify_event={() => {
                    console.log("bind(barHide)", bind(barHide).get())
                    // if (bind(barHide))
                    barHide.set(false)
                    barVisible.set(true)
                }}
                on_leave_notify_event={() => 
                    {
                        console.log("bind(barHide)2", bind(barHide).get())
                        if (!bind(barHide))
                        {
                            hoverVisible.set(false)
                            barHide.set(true)

                        }
                    }
                }
            />
        </box>
    </window>

    const popovers = [
        <Popover name="wifi" gdkmonitor={gdkmonitor}><WifiPanel /></Popover>,
        <Popover name="bluetooth" gdkmonitor={gdkmonitor}><BluetoothPanel /></Popover>,
        <Popover name="sound" gdkmonitor={gdkmonitor}><SoundPanel /></Popover>,
        <Popover name="battery" gdkmonitor={gdkmonitor}><BatteryPanel /></Popover>,
        <Popover name="calendar" gdkmonitor={gdkmonitor}><CalendarPanel /></Popover>,
        <Popover name="display" gdkmonitor={gdkmonitor}><DisplayPanel /></Popover>,
    ]

    return [barWindow, hoverZone, ...popovers]
}


// @ts-ignore
globalThis.barToggle = barToggle;