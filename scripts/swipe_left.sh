#!/bin/bash
hyprctl animation "workspaces" "ease" "slide" 5
sleep 1.05
hyprctl dispatch workspace e+1
sleep 10.3
hyprctl animation workspaces 1 5 ease fade
