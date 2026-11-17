import { bind, Variable } from "astal";
import { Gdk, Gtk, Widget } from "astal/gtk3";
import { GLib } from "astal";
import Battery from "gi://AstalBattery";
import AstalBattery from "gi://AstalBattery";

const battery = Battery.get_default();

const CHARGING_COLOR = "#34C759";
const DISCHARGING_COLOR = "#E5E5EA";
const LOW_BATTERY_COLOR = "#FECC0B";
const CRITICAL_BATTERY_COLOR = "#FF453A";


function getColor(percentage: number) {
    if (battery.state === Battery.State.CHARGING) {
        return CHARGING_COLOR;
    }
    if (percentage >= 50) {
        return DISCHARGING_COLOR;
    }
    if (percentage >= 20) {
        return LOW_BATTERY_COLOR;
    }
    return CRITICAL_BATTERY_COLOR;
}

function getBorderRadius(percentage: number) {
    if (percentage >= 85) {
        const progress = (percentage - 85) / (100 - 85); // 0 to 1
        const eased = Math.pow(progress, 0.5); // sqrt for fast early growth
        const radius = eased * 3;
        return `5px ${radius.toFixed(1)}px ${radius.toFixed(1)}px 5px`;
    }
    return "5px 0px 0px 5px";
}
function getTextColor(percentage: number) {
    if (battery.state === Battery.State.CHARGING) {
        return "#FDFDFD";
    }
    if (percentage >= 50) {
        return "#2C2C2E";
    }
    if (percentage >= 20) {
        return "#2C2C2E";
    }
    return "#FDFDFD";
}

export function BatteryWidget() {
    const provider = new Gtk.CssProvider();
    provider.load_from_path(GLib.build_filenamev([GLib.get_home_dir(), ".config", "ags", "battery.css"]));
    
    const screen = Gdk.Screen.get_default();
    if (screen) {
        Gtk.StyleContext.add_provider_for_screen(
           screen,
            provider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
        );
    } else {
        log("Failed to get Gdk.Screen — cannot apply CSS");
    }

    const batteryPercentage = bind(battery, 'percentage');
    const batteryService = AstalBattery.get_default();
    const WIDTH = 36;
    const HEIGHT = 13;
    // const labelText = Variable('');
    let lowBatteryPopup: Gtk.Window | null = null;

    function showLowBatteryPopup() {
        if (lowBatteryPopup) return; // Already shown
    
        lowBatteryPopup = new Gtk.Window({
            title: "Low Battery Warning",
            type: Gtk.WindowType.TOPLEVEL,
            default_width: 300,
            default_height: 120,
            decorated: true,
            modal: true,
            resizable: false,
        });
    
        const vbox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 10,
            margin_top: 20,
            margin_bottom: 20,
            margin_start: 20,
            margin_end: 20,
        });
    
        const label = new Gtk.Label({
            label: "Laptop about to die.\nGo get the charger ma g",
            justify: Gtk.Justification.CENTER,
        });
    
        const okButton = new Gtk.Button({ label: "OK" });
        okButton.connect("clicked", () => {
            if (lowBatteryPopup) {
                lowBatteryPopup.destroy();
                lowBatteryPopup = null;
            }
        });
        lowBatteryPopup.get_style_context().add_class("low-battery-popup");

        label.get_style_context().add_class("warning-label");
        okButton.get_style_context().add_class("ok-button");
    
        vbox.pack_start(label, true, true, 0);
        vbox.pack_start(okButton, false, false, 0);
    
        lowBatteryPopup.add(vbox);
        lowBatteryPopup.show_all();
    }


    
    function hideLowBatteryPopup() {
        if (lowBatteryPopup) {
            lowBatteryPopup.destroy();
            lowBatteryPopup = null;
        }
    }
    if (bind(batteryService, 'percentage').get() < 15 && bind(batteryService, 'state').get() === Battery.State.DISCHARGING ) showLowBatteryPopup()


    const labelText = Variable.derive(
        [bind(batteryService, 'percentage'), bind(batteryService, 'state')],
        (percentage, state) => {
            const percent = Math.floor(percentage * 100);
            if (percent < 15 && state === Battery.State.DISCHARGING && lowBatteryPopup === null ) showLowBatteryPopup()
            if (lowBatteryPopup !== null &&state === Battery.State.CHARGING )hideLowBatteryPopup()
                return state === Battery.State.CHARGING
                ? `${percent}<span size="7900" rise="1500" letter_spacing="1000"></span>`
                : `${percent}`
        }
    );

// Call initially
    return (
        <overlay
        className="battery-widget"
        hexpand={false}
        
        widthRequest={WIDTH}
    >
        <box
            className="outer-box"
            height_request={HEIGHT}
            width_request={WIDTH}
        >
  
            {/* Background bar */}
            <box
                className="inner-box"
                hexpand={false}
                width_request={bind(batteryPercentage).as(num => num * WIDTH)}
                setup={(self) => {
                    const update = () => {
                        self.css = `background-color: ${getColor(bind(batteryPercentage).as(num => num * 100).get())};
                        border-radius: ${getBorderRadius(bind(batteryPercentage).as(num => num * 100).get())}
                        `;
                    };
                    self.hook(battery, "notify::state", update);
                    update();
                }}
            />

        </box>
            {/* Overlayed label */}
           
            <label
    useMarkup={true}
    label={bind(labelText).as(v => v)}
    setup={(self) => {
        const colorUpdate = () => {
            const color = getTextColor(batteryPercentage.get() * 100);
            self.css = `color: ${color}`;
        };
        
        self.hook(battery, "notify::state", colorUpdate);
        self.hook(batteryPercentage, colorUpdate);
        colorUpdate();
    }}
    halign={Gtk.Align.CENTER}
    valign={Gtk.Align.CENTER}
    xalign={0.5}
    yalign={0.5}
    hexpand={true}
    vexpand={true}
/>


            {/* <SvgImage file="/your/path/to/bolt.svg" size={16} /> */}
        </overlay>
    );
}
