import { Gdk, Gtk } from "astal/gtk3";
import { execAsync } from "astal";

function menuItem(label: string, command: string) {
    const item = new Gtk.MenuItem({ label });
    item.connect("activate", () =>
        execAsync(["sh", "-c", command]).catch(console.error)
    );
    return item;
}

export default function AppleMenu() {
    const menu = new Gtk.Menu();
    menu.get_style_context().add_class("apple-menu");

    menu.append(menuItem("Sleep", "systemctl suspend"));
    menu.append(menuItem("Restart…", "systemctl reboot"));
    menu.append(menuItem("Shut Down…", "systemctl poweroff"));
    menu.append(new Gtk.SeparatorMenuItem());
    menu.append(menuItem("Log Out…", "hyprctl dispatch exit"));
    menu.show_all();

    return (
        <button
            className="apple-logo"
            onClicked={(self) =>
                menu.popup_at_widget(
                    self,
                    Gdk.Gravity.SOUTH_WEST,
                    Gdk.Gravity.NORTH_WEST,
                    null,
                )
            }
        >
            <icon className="apple-logo-img" icon="penguin-symbolic" pixelSize={19} />
        </button>
    );
}
