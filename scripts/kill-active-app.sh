#!/bin/bash

# Get PID of the focused window
pid=$(hyprctl activewindow -j | jq -r '.pid')

# Get the command name
cmd=$(ps -p "$pid" -o comm=)

# List of protected apps we should NOT kill
protected=(Hyprland systemd Xorg gnome-shell sddm sway Waybar xwayland)

# Abort if the focused app is protected
for p in "${protected[@]}"; do
    if [[ "$cmd" == "$p" ]]; then
        notify-send "⛔ Restart blocked: $cmd is protected"
        exit 1
    fi
done

# Kill all processes with that name
pkill "$cmd"
