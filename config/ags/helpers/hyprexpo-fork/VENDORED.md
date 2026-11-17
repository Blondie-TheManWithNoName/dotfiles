# Vendored hyprexpo fork

This is a patched copy of **hyprexpo**, the Hyprland plugin that backs
Mission Control. It is vendored as plain files rather than carried as a git
submodule, because the local fixes below were never upstreamed and existed
only as uncommitted working-tree changes — a submodule would have pointed at
a commit that doesn't contain them.

| | |
|---|---|
| Upstream | <https://github.com/colonelpanic8/hyprexpo> |
| Base commit | `46f2cdb40811926c113257565f525ee719623a17` ("Handle null monitor render hook arguments") |
| Last built against | Hyprland **0.55.4** (18 Jul 2026) |

> ### ⚠️ This fork is currently out of date
>
> The machine now runs **Hyprland 0.56.2**. A plugin is ABI-locked to the
> release it was compiled against, so the committed-to-disk
> `hyprexpo-fixed.so` no longer loads — `hyprctl plugin list` reports no
> plugins, and Mission Control is dead until it's rebuilt.
>
> Rebuilding is **not** just a recompile. The whole point of the local
> `Hooks.cpp` patch is a hardcoded mangled symbol for `shouldRenderWindow`,
> pinned to 0.55.4. That symbol very likely moved in 0.56.x, and the
> arity-checked fallback is designed to **fail the plugin load loudly**
> rather than bind the wrong overload — which is correct behaviour, but it
> means the fix needs redoing for the new version. Start with:
>
> ```sh
> nm -DC /usr/lib/libhyprland.so | grep shouldRenderWindow
> ```
>
> and compare against the symbol string in `Hooks.cpp`.

The upstream history (53 commits) is preserved as a git bundle outside this
repo at `~/hyprexpo-fork-history.bundle`. To get it back as a real repo:

```sh
git clone ~/hyprexpo-fork-history.bundle hyprexpo-upstream
```

## What was changed locally

Relative to the base commit, 17 files were modified and 5 added
(`WindowRow.{cpp,hpp}`, `WindowRowPassElement.{cpp,hpp}`,
`WindowRowRender.cpp`).

The load-bearing fix is in `Hooks.cpp`. Quoting the diagnosis recorded in
`hyprland.conf`: the upstream fork hardcoded a mangled symbol for
`shouldRenderWindow` that predated Hyprland moving `CWindow` into the
`Desktop::View` namespace. The symbol matched nothing, and a fuzzy
name-fallback silently bound the **one**-argument overload instead of the
two-argument one — so the hook read its monitor argument from a register the
callers never set, corrupting a smart-pointer refcount. That was the cause of
all seven crashes on 2026-07-17.

The fix pins the exact 0.55.4 symbol and adds an arity-checked fallback that
fails plugin load loudly rather than ever binding the wrong overload.
`LivePreview.cpp` also had a stale live-preview global fixed; see the comment
there.

## Rebuilding

`install.sh` does this automatically. By hand:

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j"$(nproc)"
cp build/libhyprexpo.so ~/.config/hypr/plugins/hyprexpo-fixed.so
hyprctl plugin unload ~/.config/hypr/plugins/hyprexpo-fixed.so
hyprctl plugin load   ~/.config/hypr/plugins/hyprexpo-fixed.so
```

Load it with `hyprctl`, **not** `hyprpm` — hyprpm only knows about the broken
upstream build.

## After a Hyprland upgrade

A plugin compiled against one Hyprland release will not load against another,
and the symbol names this fork hooks can move between releases. After
upgrading Hyprland, rebuild first; if the plugin then refuses to load with a
symbol error, the mangled names in `Hooks.cpp` need updating for the new
version. Check them with:

```sh
nm -DC /usr/lib/libhyprland.so | grep shouldRenderWindow
```
