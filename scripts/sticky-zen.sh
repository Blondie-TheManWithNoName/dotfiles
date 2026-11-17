#!/bin/bash

APP_CLASS="zen"
WINDOW_TITLE="Picture-in-Picture"

echo "Sticky window tracker started"

while true; do
    WIN_ID=$(hyprctl clients -j | jq -r --arg class "$APP_CLASS" --arg title "$WINDOW_TITLE" '
        .[] | select(.class == $class and .title == $title) | .address')

    if [ -n "$WIN_ID" ]; then
        WS_ID=$(hyprctl activeworkspace -j | jq '.id')
        echo "[$(date +%T)] Moving $WIN_ID to workspace $WS_ID"
        hyprctl dispatch movetoworkspacesilent "$WS_ID,$WIN_ID"
    fi

    sleep 0.2
done

