#!/bin/bash

# Accept direction as argument (e+1, e-1, 1, 2, etc.)
DIRECTION=$1

# Enlarge gaps
hyprctl --batch "keyword general:gaps_out 50"

# Wait a tiny bit to let the gaps apply
sleep 0.05

# Switch workspace
hyprctl dispatch workspace "$DIRECTION"

# Wait for swipe animation to finish (adjust as needed)
sleep 0.3

# Restore original gaps
hyprctl --batch "keyword general:gaps_out 5"
