// Captures a single Hyprland toplevel (window) via hyprland-toplevel-export-v1,
// even if it's on a workspace that isn't currently visible on any monitor.
// Downscales (nearest-neighbor, never upscales) and writes a tiny custom raw
// format GJS/GdkPixbuf can load with zero decoding: two little-endian uint32
// (width, height) followed by width*height*3 raw RGB8 bytes, row-major.
//
// Runs as its own process, separate from Hyprland — a bug here can't take
// the compositor down with it (unlike an in-process C++ plugin).
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/mman.h>
#include <wayland-client.h>
#include "hyprland-toplevel-export-v1-client-protocol.h"

// Referenced by the generated code's (unused) v2 request only; we call the
// address-based v1 request instead, so an empty stub satisfies the linker
// without pulling in wlr-foreign-toplevel-management-v1 as a real dependency.
const struct wl_interface zwlr_foreign_toplevel_handle_v1_interface = {
    "zwlr_foreign_toplevel_handle_v1", 1, 0, NULL, 0, NULL
};

static struct wl_shm *shm = NULL;
static struct hyprland_toplevel_export_manager_v1 *export_manager = NULL;

static uint32_t buf_format = 0, buf_width = 0, buf_height = 0, buf_stride = 0;
static int frame_done = 0, frame_failed = 0;
static struct wl_buffer *the_buffer = NULL;
static void *shm_data = NULL;

static void registry_global(void *data, struct wl_registry *registry,
                             uint32_t name, const char *interface, uint32_t version) {
    if (strcmp(interface, wl_shm_interface.name) == 0) {
        shm = wl_registry_bind(registry, name, &wl_shm_interface, 1);
    } else if (strcmp(interface, hyprland_toplevel_export_manager_v1_interface.name) == 0) {
        export_manager = wl_registry_bind(registry, name, &hyprland_toplevel_export_manager_v1_interface, 2);
    }
}
static void registry_global_remove(void *data, struct wl_registry *registry, uint32_t name) {}
static const struct wl_registry_listener registry_listener = {
    .global = registry_global,
    .global_remove = registry_global_remove,
};

static int create_shm_fd(size_t size) {
    char name[64];
    int fd = -1;
    for (int i = 0; i < 100; i++) {
        snprintf(name, sizeof(name), "/tlcap-%d-%d", getpid(), rand());
        fd = shm_open(name, O_RDWR | O_CREAT | O_EXCL, 0600);
        if (fd >= 0) { shm_unlink(name); break; }
    }
    if (fd < 0) return -1;
    if (ftruncate(fd, size) < 0) { close(fd); return -1; }
    return fd;
}

static void frame_buffer(void *data, struct hyprland_toplevel_export_frame_v1 *frame,
                          uint32_t format, uint32_t width, uint32_t height, uint32_t stride) {
    buf_format = format;
    buf_width = width;
    buf_height = height;
    buf_stride = stride;
}

static void frame_buffer_done(void *data, struct hyprland_toplevel_export_frame_v1 *frame) {
    size_t shm_size = (size_t)buf_stride * buf_height;
    int shm_fd = create_shm_fd(shm_size);
    if (shm_fd < 0) { frame_failed = 1; return; }
    shm_data = mmap(NULL, shm_size, PROT_READ | PROT_WRITE, MAP_SHARED, shm_fd, 0);
    if (shm_data == MAP_FAILED) { close(shm_fd); frame_failed = 1; return; }

    struct wl_shm_pool *pool = wl_shm_create_pool(shm, shm_fd, shm_size);
    the_buffer = wl_shm_pool_create_buffer(pool, 0, buf_width, buf_height, buf_stride, buf_format);
    wl_shm_pool_destroy(pool);
    close(shm_fd);

    hyprland_toplevel_export_frame_v1_copy(frame, the_buffer, 1 /* ignore_damage */);
}

static void frame_flags(void *data, struct hyprland_toplevel_export_frame_v1 *frame, uint32_t flags) {}

static void frame_ready(void *data, struct hyprland_toplevel_export_frame_v1 *frame,
                         uint32_t tv_sec_hi, uint32_t tv_sec_lo, uint32_t tv_nsec) {
    frame_done = 1;
}

static void frame_failed_cb(void *data, struct hyprland_toplevel_export_frame_v1 *frame) {
    frame_failed = 1;
}

static void frame_damage(void *data, struct hyprland_toplevel_export_frame_v1 *frame,
                          uint32_t x, uint32_t y, uint32_t width, uint32_t height) {}
static void frame_linux_dmabuf(void *data, struct hyprland_toplevel_export_frame_v1 *frame,
                                uint32_t format, uint32_t width, uint32_t height) {}

static const struct hyprland_toplevel_export_frame_v1_listener frame_listener = {
    .buffer = frame_buffer,
    .buffer_done = frame_buffer_done,
    .flags = frame_flags,
    .ready = frame_ready,
    .failed = frame_failed_cb,
    .damage = frame_damage,
    .linux_dmabuf = frame_linux_dmabuf,
};

static void write_u32le(FILE *out, uint32_t v) {
    uint8_t b[4] = { v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff };
    fwrite(b, 1, 4, out);
}

int main(int argc, char **argv) {
    if (argc < 5) {
        fprintf(stderr, "usage: %s <window-address-hex> <output-path> <max-width> <max-height>\n", argv[0]);
        return 1;
    }

    const char *addr_str = argv[1];
    if (strncmp(addr_str, "0x", 2) == 0) addr_str += 2;
    uint64_t full_addr = strtoull(addr_str, NULL, 16);
    // Hyprland's v1 handle is a 32-bit uint; matching is done on the low
    // 32 bits of the window pointer on both sides, so truncating here (even
    // though hyprctl prints full 64-bit addresses) is correct, not lossy.
    uint32_t handle = (uint32_t)(full_addr & 0xFFFFFFFFu);

    long max_w = strtol(argv[3], NULL, 10);
    long max_h = strtol(argv[4], NULL, 10);
    if (max_w <= 0 || max_h <= 0) { fprintf(stderr, "invalid max dimensions\n"); return 1; }

    struct wl_display *display = wl_display_connect(NULL);
    if (!display) { fprintf(stderr, "failed to connect to wayland display\n"); return 1; }

    struct wl_registry *registry = wl_display_get_registry(display);
    wl_registry_add_listener(registry, &registry_listener, NULL);
    wl_display_roundtrip(display);

    if (!shm || !export_manager) { fprintf(stderr, "missing required globals\n"); return 1; }

    struct hyprland_toplevel_export_frame_v1 *frame =
        hyprland_toplevel_export_manager_v1_capture_toplevel(export_manager, 0 /* overlay_cursor */, handle);
    hyprland_toplevel_export_frame_v1_add_listener(frame, &frame_listener, NULL);

    // Bound how long we'll wait on a single window — a hung/closed client
    // shouldn't be able to stall the whole Mission Control capture batch.
    int guard = 0;
    while (!frame_done && !frame_failed && guard < 2000) {
        if (wl_display_dispatch(display) < 0) { fprintf(stderr, "display dispatch failed\n"); return 1; }
        guard++;
    }
    if (!frame_done) { fprintf(stderr, "capture failed or timed out for handle %u\n", handle); return 2; }

    double scale = 1.0;
    if (buf_width > (uint32_t)max_w) scale = (double)max_w / buf_width;
    if (buf_height * scale > (double)max_h) scale = (double)max_h / buf_height;
    if (scale > 1.0) scale = 1.0; // never upscale

    uint32_t out_w = (uint32_t)(buf_width * scale);
    uint32_t out_h = (uint32_t)(buf_height * scale);
    if (out_w < 1) out_w = 1;
    if (out_h < 1) out_h = 1;

    FILE *out = fopen(argv[2], "wb");
    if (!out) { perror("fopen output"); return 1; }
    write_u32le(out, out_w);
    write_u32le(out, out_h);

    uint8_t *px = (uint8_t *)shm_data;
    uint8_t *row_buf = malloc((size_t)out_w * 3);
    for (uint32_t oy = 0; oy < out_h; oy++) {
        uint32_t sy = (uint32_t)(oy / scale);
        if (sy >= buf_height) sy = buf_height - 1;
        uint8_t *row = px + (size_t)sy * buf_stride;
        for (uint32_t ox = 0; ox < out_w; ox++) {
            uint32_t sx = (uint32_t)(ox / scale);
            if (sx >= buf_width) sx = buf_width - 1;
            uint8_t *p = row + (size_t)sx * 4;
            // little-endian 32bpp (xrgb8888/argb8888): byte0=B,1=G,2=R,3=A/X
            row_buf[ox * 3 + 0] = p[2]; // R
            row_buf[ox * 3 + 1] = p[1]; // G
            row_buf[ox * 3 + 2] = p[0]; // B
        }
        fwrite(row_buf, 1, (size_t)out_w * 3, out);
    }
    free(row_buf);
    fclose(out);

    return 0;
}
