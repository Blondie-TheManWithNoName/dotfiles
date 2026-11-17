#!/bin/bash
# Sends a Ctrl-style shortcut to the focused window when it's a browser
# (Chrome/Zen), otherwise runs the fallback command. Lets a Cmd+key bind
# behave like macOS in the browser without changing what that key already
# does everywhere else.
#
# Usage: browser-key.sh <mods> <key> <fallback command...>
#   mods/key are passed straight to `hyprctl dispatch sendshortcut`.

mods="$1"
key="$2"
shift 2

class=$(hyprctl activewindow -j | jq -r '.class')

case "$class" in
    google-chrome|zen)
        hyprctl dispatch sendshortcut "$mods,$key,activewindow"
        ;;
    *)
        "$@"
        ;;
esac
