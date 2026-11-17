// Groups of desktops, shown on the topbar one group at a time.
// Hyprland's workspaces are one flat global list — there's no native concept
// of "desktop 1 of group A" vs "desktop 1 of group B". We fake it: each
// group gets its own private block of real Hyprland workspace IDs (`base`
// .. `base + count - 1`), far out of the range of any workspace you'd reach
// by hand (1-10ish), and the bar only ever displays/labels them as 1..count
// relative to whichever group is currently active.
//
// The actual launch-command/window-class definitions live in
// ~/scripts/desktop-profile.sh (bash, reusing its already-tested app-launch
// and window-placement logic) — keep `base`/`count` here in sync with that
// script's workspace numbers whenever either one changes.
export type GroupDef = {
    name: string;
    // matches the <key>_cmd/<key>_class array prefix in desktop-profile.sh
    key: string;
    base: number;
    count: number;
};

export const GROUPS: GroupDef[] = [
    { name: "Programming", key: "programming", base: 101, count: 4 },
    { name: "Design", key: "design", base: 201, count: 3 },
];

export function realWorkspaceId(group: GroupDef, desktopIndex: number): number {
    return group.base + desktopIndex;
}
