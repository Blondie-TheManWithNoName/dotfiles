import { bind } from "astal";
import Hyprland from "gi://AstalHyprland";

const hypr = Hyprland.get_default();

// window class -> display name, like the app name in the macOS menu bar
const KNOWN_APPS: Record<string, string> = {
    "zen": "Zen",
    "zen-browser": "Zen",
    "kitty": "Terminal",
    "org.kde.dolphin": "Dolphin",
    "code": "Code",
    "firefox": "Firefox",
};

function prettify(cls: string): string {
    if (!cls) return "Desktop";
    const known = KNOWN_APPS[cls.toLowerCase()];
    if (known) return known;
    const last = cls.split(".").pop() ?? cls;
    return last.charAt(0).toUpperCase() + last.slice(1);
}

export default function ActiveApp() {
    return (
        <label
            className="app-name"
            label={bind(hypr, "focusedClient").as((c) =>
                prettify(c?.get_class() ?? ""),
            )}
        />
    );
}
