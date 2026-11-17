#!/bin/bash

# Desktop-group launch engine, called by the AGS bar (widget/Workspaces.tsx)
# — not meant to be triggered directly by a keybind. Workspace numbers here
# must match the `base`/`count` in ~/.config/ags/widget/lib/profiles.ts.
#
# Two modes:
#   desktop-profile.sh launch <profile>   launch any desktop in the group
#                                          that's currently empty (first-time
#                                          populate; never touches a desktop
#                                          that already has something on it)
#   desktop-profile.sh restart <profile>  reset the group to its defaults:
#                                          close anything on its desktops
#                                          that isn't one of the group's own
#                                          apps, then launch (as above) to
#                                          refill whatever's now missing
#
# Chrome/Cursor/Claude Desktop/GitHub Desktop/Discord are all single-instance
# apps: relaunching one can either open a genuinely new top-level window
# (Chrome, Cursor) or just silently refocus the single existing window with
# no new window at all (Claude Desktop, GitHub Desktop) — which one happens
# isn't reliably predictable, and isn't even consistent run-to-run for
# Chrome specifically (hence --new-window below, to force it). So for each
# app: snapshot its existing window addresses, launch it, and poll for a NEW
# address to appear. If one does, move that specific window — by address;
# `movetoworkspacesilent`'s `class:` selector silently no-ops, only
# `address:` actually moves anything. If no new window shows up within the
# timeout, it was a refocus-only relaunch — fall back to moving whichever
# existing window of that class there already is.
declare -A programming_cmd=(
    [101]="google-chrome-stable --new-window"
    [102]="cursor"
    [103]="/usr/bin/claude-desktop --enable-features=UseOzonePlatform --ozone-platform=wayland"
    [104]="github-desktop"
)
declare -A programming_class=(
    [101]='^google-chrome$'
    [102]='^cursor$'
    [103]='^com\.anthropic\.Claude$'
    [104]='^GitHub Desktop$'
)

# Figma has no native Linux app — launched as a Chrome site-specific window
# (--app=), which gets its own distinct, stable class (derived from the URL,
# not a random hash) separate from a plain Chrome window.
declare -A design_cmd=(
    [201]="google-chrome-stable --new-window"
    [202]="google-chrome-stable --app=https://figma.com --new-window"
    [203]="vesktop"
)
declare -A design_class=(
    [201]='^google-chrome$'
    [202]='^chrome-figma\.com__-Default$'
    [203]='^vesktop$'
)

mode="$1"
profile="$2"
cmd_var="${profile}_cmd"
class_var="${profile}_class"

if [[ "$mode" != "launch" && "$mode" != "restart" ]] || ! declare -p "$cmd_var" &>/dev/null; then
    notify-send "desktop-profile.sh" "usage: launch|restart <profile>"
    exit 1
fi
declare -n cmds="$cmd_var"
declare -n classes="$class_var"

addresses_for() {
    hyprctl clients -j | jq -r --arg c "$1" '.[] | select(.class | test($c)) | .address'
}

launch_onto() {
    local ws="$1" class="$2" cmd="$3"
    local before after new_addr
    before="$(addresses_for "$class" | sort)"

    hyprctl dispatch exec "$cmd"

    new_addr=""
    for _ in $(seq 1 20); do
        sleep 0.3
        after="$(addresses_for "$class" | sort)"
        new_addr="$(comm -13 <(echo "$before") <(echo "$after") | head -1)"
        [[ -n "$new_addr" ]] && break
    done

    # no new window appeared — a refocus-only relaunch, move whatever's there
    if [[ -z "$new_addr" ]]; then
        new_addr="$(addresses_for "$class" | head -1)"
    fi

    [[ -n "$new_addr" ]] && hyprctl dispatch movetoworkspacesilent "$ws,address:$new_addr"
}

if [[ "$mode" == "restart" ]]; then
    # every class this group is allowed to have, as one combined regex
    allowed="$(printf '%s|' "${classes[@]}")"
    allowed="${allowed%|}"

    for ws in "${!cmds[@]}"; do
        hyprctl clients -j | jq -r --arg ws "$ws" --arg allowed "$allowed" \
            '.[] | select(.workspace.id == ($ws|tonumber)) | select(.class | test($allowed) | not) | .address' |
        while read -r addr; do
            [[ -n "$addr" ]] && hyprctl dispatch closewindow "address:$addr"
        done
    done
fi

# launch mode, and the refill half of restart mode: only touch a desktop
# that's currently empty — never relaunches something already sitting there
for ws in "${!cmds[@]}"; do
    if [[ -z "$(hyprctl clients -j | jq --arg ws "$ws" '.[] | select(.workspace.id == ($ws|tonumber))')" ]]; then
        launch_onto "$ws" "${classes[$ws]}" "${cmds[$ws]}"
    fi
done
