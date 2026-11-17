#!/bin/bash
# macOS-style Quick Look "show" — fired on Space keydown while Dolphin is focused.
# Uses sushi (org.gnome.NautilusPreviewer) as the preview engine.

active=$(hyprctl activewindow -j)
class=$(jq -r '.class' <<<"$active")
pid=$(jq -r '.pid' <<<"$active")

[[ "$class" != "org.kde.dolphin" ]] && exit 0

service="org.kde.dolphin-${pid}"

# Grab the selected file's path via Dolphin's "Copy Location" action, then
# restore whatever was on the clipboard before, so this doesn't clobber it.
old_clip=$(wl-paste 2>/dev/null || true)

gdbus call --session --dest "$service" \
  --object-path /dolphin/Dolphin_1/actions/copy_location \
  --method org.qtproject.Qt.QAction.trigger >/dev/null 2>&1

new_path=""
for _ in $(seq 1 10); do
  sleep 0.03
  cur=$(wl-paste 2>/dev/null || true)
  if [[ -n "$cur" && "$cur" != "$old_clip" ]]; then
    new_path="$cur"
    break
  fi
done

if [[ -n "$old_clip" ]]; then
  printf '%s' "$old_clip" | wl-copy >/dev/null 2>&1
else
  wl-copy --clear >/dev/null 2>&1 || true
fi

[[ -z "$new_path" || ! -e "$new_path" ]] && exit 0

uri="file://$(python3 -c "import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1]))" "$new_path")"

gdbus call --session --dest org.gnome.NautilusPreviewer \
  --object-path /org/gnome/NautilusPreviewer \
  --method org.gnome.NautilusPreviewer2.ShowFile "$uri" "" true "" >/dev/null 2>&1

# Sushi ignores windowrule size/center hints and resizes itself to fit the
# content shortly after mapping, so force geometry after it settles instead.
(
  sleep 0.35
  mon=$(hyprctl monitors -j | jq '.[] | select(.focused==true)')
  mw=$(jq -r '.width' <<<"$mon")
  mh=$(jq -r '.height' <<<"$mon")
  mx=$(jq -r '.x' <<<"$mon")
  my=$(jq -r '.y' <<<"$mon")
  w=$(( mw * 55 / 100 ))
  h=$(( mh * 55 / 100 ))
  x=$(( mx + (mw - w) / 2 ))
  y=$(( my + (mh - h) / 2 ))
  hyprctl dispatch resizewindowpixel "exact $w $h,class:^(org.gnome.NautilusPreviewer)$" >/dev/null 2>&1
  hyprctl dispatch movewindowpixel "exact $x $y,class:^(org.gnome.NautilusPreviewer)$" >/dev/null 2>&1
) &
disown
