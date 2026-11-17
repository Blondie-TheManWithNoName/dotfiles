#!/bin/bash
# Cycles the blue-light filter through 5 levels using wlsunset gamma control.
# Unlike a compositor shader, this adjusts the display's gamma table directly,
# so it does NOT show up in screenshots or screen recordings (same as macOS Night Shift).

STATE_FILE="$HOME/.cache/nightlight_level"
TEMPS=(6500 5000 3600 2500 1500)

LEVEL=$(cat "$STATE_FILE" 2>/dev/null || echo 0)
LEVEL=$(( (LEVEL + 1) % ${#TEMPS[@]} ))
echo "$LEVEL" > "$STATE_FILE"

pkill -x wlsunset 2>/dev/null

if [[ "$LEVEL" -ne 0 ]]; then
    TEMP=${TEMPS[$LEVEL]}
    # wlsunset requires T > t, so pin them 1K apart (imperceptible).
    # Manual sunset at 00:01/sunrise at 00:00 means we're in "night" (temp t)
    # for effectively the entire day, giving a constant filter rather than
    # a real day/night cycle.
    setsid -f wlsunset -S 00:00 -s 00:01 -d 2 -t "$TEMP" -T "$((TEMP + 1))" >/dev/null 2>&1
fi
