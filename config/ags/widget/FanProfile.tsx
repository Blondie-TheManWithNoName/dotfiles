import { Variable, exec, execAsync } from "astal";

const PROFILES = ["quiet", "balanced", "performance"] as const;
type Profile = (typeof PROFILES)[number];

const ICONS: Record<Profile, string> = {
    quiet: "power-profile-power-saver-symbolic",
    balanced: "power-profile-balanced-symbolic",
    performance: "power-profile-performance-symbolic",
};

const LABELS: Record<Profile, string> = {
    quiet: "Quiet",
    balanced: "Balanced",
    performance: "Performance (fans up)",
};

function readProfile(): Profile {
    try {
        const text = exec(["cat", "/sys/firmware/acpi/platform_profile"]).trim();
        return (PROFILES as readonly string[]).includes(text) ? (text as Profile) : "balanced";
    } catch {
        return "balanced";
    }
}

const profile = Variable<Profile>(readProfile()).poll(2000, readProfile);

function setProfile(next: Profile) {
    execAsync(["sudo", "-n", "/usr/local/bin/set-fan-profile", next])
        .then(() => profile.set(next))
        .catch((err) => {
            console.error("set-fan-profile failed:", err);
            profile.set(readProfile());
        });
}

export function FanIcon() {
    return (
        <button
            className="status-icon"
            tooltipText={profile().as((p) => LABELS[p])}
            onClicked={() => {
                const current = profile.get();
                const next = PROFILES[(PROFILES.indexOf(current) + 1) % PROFILES.length];
                setProfile(next);
            }}
        >
            <icon className="status-icon-img" icon={profile().as((p) => ICONS[p])} pixelSize={18} />
        </button>
    );
}
