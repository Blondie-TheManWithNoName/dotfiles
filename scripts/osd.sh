#!/bin/bash
# Adjust volume/brightness/keyboard backlight and flash the macOS-style OSD in AGS.

sink=@DEFAULT_AUDIO_SINK@
src=@DEFAULT_AUDIO_SOURCE@
kbd='asus::kbd_backlight'

case "$1" in
    volume-up)   wpctl set-volume -l 1 "$sink" 5%+ ;;
    volume-down) wpctl set-volume "$sink" 5%- ;;
    volume-mute) wpctl set-mute "$sink" toggle ;;
    mic-mute)    wpctl set-mute "$src" toggle ;;
    bright-up)   brightnessctl s 5%+ >/dev/null ;;
    bright-down) brightnessctl s 2.5%- >/dev/null ;;
    kbd-up)      brightnessctl -d "$kbd" s 1+ >/dev/null ;;
    kbd-down)    brightnessctl -d "$kbd" s 1- >/dev/null ;;
    kbd-cycle)   # F7: single key cycles 0 -> 1 -> 2 -> 3 -> 0
        cur=$(brightnessctl -m -d "$kbd" | awk -F, '{print $3}')
        brightnessctl -d "$kbd" s $(( (cur + 1) % 4 )) >/dev/null ;;
    night-cycle) # F6: cycle blue-light filter levels (existing script)
        "$HOME/scripts/cycle-nightlight.sh" >/dev/null 2>&1 ;;
    *) echo "usage: $0 volume-up|volume-down|volume-mute|mic-mute|bright-up|bright-down|kbd-up|kbd-down|kbd-cycle|night-cycle" >&2; exit 1 ;;
esac

case "$1" in
    volume-*|mic-mute)
        if [[ "$1" == mic-mute ]]; then dev=$src kind=mic; else dev=$sink kind=volume; fi
        out=$(wpctl get-volume "$dev")   # "Volume: 0.45 [MUTED]"
        pct=$(awk '{printf "%d", $2 * 100 + 0.5}' <<<"$out")
        [[ "$out" == *MUTED* ]] && m=muted || m=on
        ;;
    bright-*)
        kind=brightness m=on
        pct=$(brightnessctl -m | awk -F, '{gsub("%", "", $4); print $4}')
        ;;
    kbd-*)
        kind=kbd m=on
        pct=$(brightnessctl -m -d "$kbd" | awk -F, '{gsub("%", "", $4); print $4}')
        ;;
    night-cycle)
        kind=night m=on
        lvl=$(cat "$HOME/.cache/nightlight_level" 2>/dev/null || echo 0)
        pct=$(( lvl * 100 / 4 ))   # 5 levels: 0 25 50 75 100
        ;;
esac

ags request "osd $kind $pct $m" >/dev/null 2>&1
