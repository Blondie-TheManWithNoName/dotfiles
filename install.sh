#!/usr/bin/env bash
# Installs this macOS-flavoured Hyprland setup onto a fresh Arch system.
#
# Safe to re-run: every step checks its own result first, and anything it
# would overwrite is moved into a timestamped backup directory rather than
# deleted. Nothing here touches the system outside the steps you opt into.
#
#   ./install.sh                 full install
#   ./install.sh --no-packages   skip pacman/AUR (configs + builds only)
#   ./install.sh --no-build      skip compiling hyprexpo + toplevel-capture
#   ./install.sh --dry-run       print what would happen, change nothing
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP="$HOME/.dotfiles-backup-$(date +%Y%m%d-%H%M%S)"

DO_PACKAGES=1
DO_BUILD=1
DRY_RUN=0
for arg in "$@"; do
    case "$arg" in
        --no-packages) DO_PACKAGES=0 ;;
        --no-build)    DO_BUILD=0 ;;
        --dry-run)     DRY_RUN=1 ;;
        -h|--help)     sed -n '2,12p' "$0"; exit 0 ;;
        *) echo "unknown option: $arg (try --help)" >&2; exit 1 ;;
    esac
done

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m warn\033[0m %s\n' "$*" >&2; }
skip() { printf '\033[2m     %s\033[0m\n' "$*"; }
run()  { if [ "$DRY_RUN" = 1 ]; then echo "     would run: $*"; else "$@"; fi; }

# Yes/no prompt that answers itself when there's nobody to ask: a dry run or a
# non-interactive shell both decline, so the script can never block or take a
# destructive branch unattended.
ask() {
    local reply
    if [ "$DRY_RUN" = 1 ]; then echo "     would ask: $1"; return 1; fi
    if [ ! -t 0 ]; then skip "not a terminal, skipping: $1"; return 1; fi
    read -rp "     $1 [y/N] " reply
    [[ "$reply" =~ ^[Yy]$ ]]
}

# ── Symlink a repo path to its destination, backing up whatever is there ──
link() {
    local src="$REPO/$1" dest="$2"

    [ -e "$src" ] || { warn "missing in repo, skipping: $1"; return; }

    if [ -L "$dest" ] && [ "$(readlink -f "$dest")" = "$(readlink -f "$src")" ]; then
        skip "already linked: $dest"
        return
    fi

    if [ -e "$dest" ] || [ -L "$dest" ]; then
        local rel="${dest#"$HOME"/}"
        info "backing up existing $dest"
        run mkdir -p "$BACKUP/$(dirname "$rel")"
        run mv "$dest" "$BACKUP/$rel"
    fi

    run mkdir -p "$(dirname "$dest")"
    run ln -s "$src" "$dest"
    echo "     linked $dest -> $src"
}

# ─────────────────────────── packages ───────────────────────────
if [ "$DO_PACKAGES" = 1 ]; then
    info "Installing native packages"
    if [ "$DRY_RUN" = 1 ]; then
        echo "     would run: sudo pacman -S --needed --noconfirm - < packages/pacman-explicit.txt"
    else
        sudo pacman -S --needed --noconfirm - < "$REPO/packages/pacman-explicit.txt"
    fi

    # paru/yay are themselves in aur.txt, so bootstrap one before the rest.
    AUR_HELPER=""
    for h in paru yay; do
        command -v "$h" >/dev/null 2>&1 && { AUR_HELPER="$h"; break; }
    done

    if [ -z "$AUR_HELPER" ]; then
        info "No AUR helper found - bootstrapping paru from the AUR"
        if [ "$DRY_RUN" = 1 ]; then
            echo "     would clone and makepkg paru-bin"
        else
            tmp="$(mktemp -d)"
            git clone --depth 1 https://aur.archlinux.org/paru-bin.git "$tmp/paru-bin"
            (cd "$tmp/paru-bin" && makepkg -si --noconfirm)
            rm -rf "$tmp"
            AUR_HELPER=paru
        fi
    fi

    info "Installing AUR packages with ${AUR_HELPER:-paru}"
    # Filter out the helpers and their -debug split packages: installing an
    # AUR helper through itself fails, and -debug packages are build
    # by-products that aren't separately installable.
    aur_wanted="$(grep -vE '^(paru|yay)(-bin)?(-debug)?$' "$REPO/packages/aur.txt" || true)"
    if [ -n "$aur_wanted" ]; then
        if [ "$DRY_RUN" = 1 ]; then
            echo "     would run: $AUR_HELPER -S --needed --noconfirm <$(echo "$aur_wanted" | wc -l) pkgs>"
        else
            # shellcheck disable=SC2086
            "$AUR_HELPER" -S --needed --noconfirm $aur_wanted
        fi
    fi
else
    skip "skipping package install (--no-packages)"
fi

# ─────────────────────────── config symlinks ───────────────────────────
info "Linking configs into place"
for d in ags hypr wofi kitty fusuma ghostty nvim; do
    link "config/$d" "$HOME/.config/$d"
done
for f in mimeapps.list kdeglobals chrome-flags.conf Claude-flags.conf; do
    link "config/$f" "$HOME/.config/$f"
done
link scripts "$HOME/scripts"

# Generated content (typings, compiled helpers, the built plugin) is
# gitignored, so it lives only in whatever directory was just backed up.
# Carry it into the repo rather than stranding it: regenerating @girs costs
# several minutes, and a missing bin/toplevel-capture silently breaks
# Mission Control thumbnails.
if [ -d "$BACKUP/.config/ags" ]; then
    for gen in @girs node_modules bin; do
        if [ -e "$BACKUP/.config/ags/$gen" ] && [ ! -e "$REPO/config/ags/$gen" ]; then
            info "carrying over ags/$gen from the backup"
            run mv "$BACKUP/.config/ags/$gen" "$REPO/config/ags/$gen"
        fi
    done
    old_build="$BACKUP/.config/ags/helpers/hyprexpo-fork/build"
    if [ -d "$old_build" ] && [ ! -d "$REPO/config/ags/helpers/hyprexpo-fork/build" ]; then
        info "carrying over the hyprexpo build directory"
        run mv "$old_build" "$REPO/config/ags/helpers/hyprexpo-fork/build"
    fi
fi
if [ -d "$BACKUP/.config/hypr/plugins" ] && [ ! -e "$REPO/config/hypr/plugins" ]; then
    info "carrying over the built hyprexpo plugin"
    run mv "$BACKUP/.config/hypr/plugins" "$REPO/config/hypr/plugins"
fi

# ─────────────────────────── generated dotfiles ───────────────────────────
# These two can't be symlinked: one embeds an absolute path, the other holds
# a git identity that deliberately isn't stored in the repo.

info "Generating ~/.gtkrc-2.0"
if [ "$DRY_RUN" = 1 ]; then
    echo "     would write ~/.gtkrc-2.0 with __HOME__ -> $HOME"
else
    sed "s|__HOME__|$HOME|g" "$REPO/home/gtkrc-2.0" > "$HOME/.gtkrc-2.0"
    # .gtkrc-2.0 includes this file; GTK2 warns on every launch if it's absent.
    touch "$HOME/.gtkrc-2.0.mine"
fi

link home/bashrc  "$HOME/.bashrc"
link home/profile "$HOME/.profile"

if [ -f "$HOME/.gitconfig" ] && grep -q '\[user\]' "$HOME/.gitconfig" 2>/dev/null; then
    skip "~/.gitconfig already has an identity, leaving it alone"
elif [ "$DRY_RUN" = 1 ]; then
    echo "     would prompt for git name/email and write ~/.gitconfig"
elif [ ! -t 0 ]; then
    skip "not a terminal, skipping ~/.gitconfig (re-run interactively)"
else
    info "Setting up ~/.gitconfig"
    read -rp "     git user.name:  " git_name
    read -rp "     git user.email: " git_email
    sed -e "s|__GIT_NAME__|$git_name|" -e "s|__GIT_EMAIL__|$git_email|" \
        "$REPO/home/gitconfig.template" > "$HOME/.gitconfig"
fi

# ─────────────────────────── directories the config expects ───────────────
info "Creating directories referenced by the config"
run mkdir -p "$HOME/Pictures/Screenshots" "$HOME/Pictures/wallpapers"
if [ ! -e "$HOME/Pictures/wallpapers/wallpaper.png" ]; then
    warn "no ~/Pictures/wallpapers/wallpaper.png - swaybg will start with a blank"
    warn "background. Drop any image there (see README: Wallpaper)."
fi

# ─────────────────────────── icon theme ───────────────────────────
# WhiteSur is referenced by .gtkrc-2.0 but isn't packaged; it's a 103M
# upstream install, so it's fetched rather than vendored.
if [ -d "$HOME/.local/share/icons/WhiteSur" ]; then
    skip "WhiteSur icon theme already installed"
elif [ "$DO_PACKAGES" = 1 ]; then
    info "Installing WhiteSur icon theme"
    if [ "$DRY_RUN" = 1 ]; then
        echo "     would clone vinceliuice/WhiteSur-icon-theme and run ./install.sh"
    else
        tmp="$(mktemp -d)"
        git clone --depth 1 https://github.com/vinceliuice/WhiteSur-icon-theme.git "$tmp/ws"
        (cd "$tmp/ws" && ./install.sh)
        rm -rf "$tmp"
    fi
fi

# ─────────────────────────── builds ───────────────────────────
if [ "$DO_BUILD" = 1 ]; then
    info "Generating AGS TypeScript types (~80M, a few minutes)"
    if [ -d "$HOME/.config/ags/@girs" ]; then
        skip "@girs already present - delete it to force a regen"
    else
        run ags types -d "$HOME/.config/ags"
    fi

    # Deliberately non-fatal. This plugin is pinned to a Hyprland ABI *and* to
    # a mangled C++ symbol name, so it is the single most likely thing here to
    # fail after an upgrade. Everything else in the setup works without it —
    # only Mission Control is lost — so a failure must not abort the install.
    info "Building the hyprexpo fork (Mission Control)"
    FORK="$REPO/config/ags/helpers/hyprexpo-fork"
    if [ "$DRY_RUN" = 1 ]; then
        echo "     would cmake configure + build $FORK and install the .so"
    elif cmake -S "$FORK" -B "$FORK/build" -DCMAKE_BUILD_TYPE=Release \
         && cmake --build "$FORK/build" -j"$(nproc)"; then
        mkdir -p "$HOME/.config/hypr/plugins"
        cp "$FORK/build/libhyprexpo.so" "$HOME/.config/hypr/plugins/hyprexpo-fixed.so"
        echo "     installed hyprexpo-fixed.so"
    else
        warn "hyprexpo failed to build - Mission Control will not work."
        warn "Everything else is fine. See:"
        warn "  config/ags/helpers/hyprexpo-fork/VENDORED.md"
        warn "Hyprland here is $(hyprctl version 2>/dev/null | head -1 | awk '{print $2}' || echo unknown);"
        warn "the patch was last known good on 0.55.4."
    fi

    info "Building the toplevel-capture helper (Mission Control thumbnails)"
    if [ "$DRY_RUN" = 1 ]; then
        echo "     would run: $REPO/config/ags/helpers/toplevel-capture/build.sh"
    elif ! bash "$REPO/config/ags/helpers/toplevel-capture/build.sh"; then
        warn "toplevel-capture failed to build - Mission Control thumbnails"
        warn "will be blank. Needs: hyprland-protocols, wayland, gcc."
    fi
else
    skip "skipping builds (--no-build)"
fi

# ─────────────────────────── system-level ───────────────────────────
# Asked rather than assumed: these are the only steps that change anything
# outside $HOME. Declining leaves the system untouched.
info "System tweaks (these need sudo)"
echo "     TLP battery config: caps charging at 80%, quiet profile on battery."
if ask "Install system/etc/tlp.d/10-battery.conf?"; then
    run sudo install -Dm644 "$REPO/system/etc/tlp.d/10-battery.conf" \
        /etc/tlp.d/10-battery.conf
    run sudo systemctl enable --now tlp.service
fi

if ask "Enable bluetooth, NetworkManager, docker, openrazer?"; then
    while read -r unit; do
        [ -n "$unit" ] && run sudo systemctl enable --now "$unit"
    done < "$REPO/packages/systemd-system-enabled.txt"
fi

info "Done."
[ -d "$BACKUP" ] && info "Replaced files were backed up to $BACKUP"
cat <<'EOF'

Remaining manual steps (see README.md):
  * Log out and back into Hyprland, or run `hyprctl reload`
  * Drop a wallpaper at ~/Pictures/wallpapers/wallpaper.png
  * Set the GTK theme with lxappearance if icons look wrong
EOF
