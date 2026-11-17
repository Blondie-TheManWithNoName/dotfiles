#!/bin/bash

PIDFILE="/tmp/wlsunset.pid"

if [ -f "$PIDFILE" ]; then
    pkill -F "$PIDFILE"
    rm "$PIDFILE"
else
    wlsunset -l 40.7 -L -74.0 -t 4500 -T 6500 &
    echo $! > "$PIDFILE"
fi
