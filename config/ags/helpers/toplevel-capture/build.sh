#!/usr/bin/env bash
# Regenerates the Wayland protocol bindings and rebuilds the toplevel-capture
# helper into ~/.config/ags/bin/. Re-run this after a Hyprland/hyprland-protocols
# upgrade if Mission Control thumbnails stop working.
set -euo pipefail
cd "$(dirname "$0")"

PROTOCOL_XML=/usr/share/hyprland-protocols/protocols/hyprland-toplevel-export-v1.xml
if [ ! -f "$PROTOCOL_XML" ]; then
    echo "error: $PROTOCOL_XML not found (pacman -S hyprland-protocols)" >&2
    exit 1
fi

wayland-scanner client-header "$PROTOCOL_XML" hyprland-toplevel-export-v1-client-protocol.h
wayland-scanner private-code "$PROTOCOL_XML" hyprland-toplevel-export-v1-protocol.c

mkdir -p ../../bin
gcc -O2 -o ../../bin/toplevel-capture capture.c hyprland-toplevel-export-v1-protocol.c \
    $(pkg-config --cflags --libs wayland-client) -lrt

echo "built: $(cd ../../bin && pwd)/toplevel-capture"
