#!/bin/bash
# macOS-style Quick Look "hide" — fired on Space keyup.
gdbus call --session --dest org.gnome.NautilusPreviewer \
  --object-path /org/gnome/NautilusPreviewer \
  --method org.gnome.NautilusPreviewer2.Close >/dev/null 2>&1
