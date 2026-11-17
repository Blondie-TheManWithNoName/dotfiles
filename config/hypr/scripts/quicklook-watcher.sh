#!/usr/bin/env python3
# Dynamically binds/unbinds Space (press -> show, release -> hide) to the
# Quick Look scripts, only while a Dolphin window is focused, so Space still
# behaves normally everywhere else.
import os
import socket
import subprocess

SHOW_SCRIPT = os.path.expanduser("~/.config/hypr/scripts/quicklook.sh")
HIDE_SCRIPT = os.path.expanduser("~/.config/hypr/scripts/quicklook-hide.sh")

sig = os.environ["HYPRLAND_INSTANCE_SIGNATURE"]
runtime = os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")
sock_path = f"{runtime}/hypr/{sig}/.socket2.sock"

bound = False


def bind():
    global bound
    if not bound:
        subprocess.run(
            ["hyprctl", "keyword", "bind", f",space,exec,{SHOW_SCRIPT}"],
            capture_output=True,
        )
        subprocess.run(
            ["hyprctl", "keyword", "bindr", f",space,exec,{HIDE_SCRIPT}"],
            capture_output=True,
        )
        bound = True


def unbind():
    global bound
    if bound:
        subprocess.run(["hyprctl", "keyword", "unbind", ",space"], capture_output=True)
        bound = False


def main():
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.connect(sock_path)
    buf = b""
    while True:
        data = s.recv(4096)
        if not data:
            break
        buf += data
        while b"\n" in buf:
            line, buf = buf.split(b"\n", 1)
            text = line.decode(errors="ignore")
            if text.startswith("activewindow>>"):
                payload = text[len("activewindow>>"):]
                wclass = payload.split(",", 1)[0]
                if wclass == "org.kde.dolphin":
                    bind()
                else:
                    unbind()


if __name__ == "__main__":
    main()
