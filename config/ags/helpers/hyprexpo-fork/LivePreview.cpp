#include "Hooks.hpp"
#include "Internals.hpp"

using namespace Internals;

// setLivePreviewWorkspace(monitor, ws) / setLivePreviewWorkspace(nullptr,
// nullptr) were previously called as a bare pair around renderWorkspaceOriginal
// with no exception/early-return safety. If anything between them didn't run
// to completion, g_livePreviewMonitor/g_livePreviewWorkspace stayed set
// indefinitely — strong PHLMONITOR/PHLWORKSPACE pointers left dangling at
// whatever they were pointing to, surviving even a `hyprctl reload` since the
// plugin's static globals aren't reset by a config reload. Later, any new
// client connecting (which walks all surfaces via hkShouldRenderWindow) would
// compare against that stale pointer and crash — this is the exact fault
// confirmed via a debug-symbol coredump analysis, landing inside a CWindow's
// vtable region (memory reused after the original object was gone). A scope
// guard makes the clear unconditional, closing the gap regardless of how the
// render call in between actually exits.
namespace {
    struct SLivePreviewScope {
        SLivePreviewScope(PHLMONITOR monitor, PHLWORKSPACE workspace) {
            setLivePreviewWorkspace(monitor, workspace);
        }
        ~SLivePreviewScope() {
            setLivePreviewWorkspace(nullptr, nullptr);
        }
        SLivePreviewScope(const SLivePreviewScope&)            = delete;
        SLivePreviewScope& operator=(const SLivePreviewScope&) = delete;
    };

    // Same problem, different variable: hideWorkspaceForPreview(OLDWS) sets
    // the REAL desktop workspace's m_visible=false (plus forceRendering/
    // alpha/renderOffset) for the duration of the tile render loop, restored
    // by a bare restoreWorkspacePreviewState(OLDWS, OLDSTATE) call at the end
    // of the function. Observed live: after closing the overview, the
    // previously-active workspace's own window(s) stopped rendering
    // entirely — hyprctl clients still reported them mapped/visible, but
    // nothing painted until forcing a workspace switch away and back, which
    // is exactly the signature of m_visible getting stuck false. A scope
    // guard makes the restore unconditional, same fix shape as above.
    struct SWorkspaceHideScope {
        PHLWORKSPACE            workspace;
        SWorkspacePreviewState  state;

        SWorkspaceHideScope(PHLWORKSPACE ws, const SWorkspacePreviewState& capturedState) : workspace(ws), state(capturedState) {
            hideWorkspaceForPreview(workspace);
        }
        ~SWorkspaceHideScope() {
            restoreWorkspacePreviewState(workspace, state);
        }
        SWorkspaceHideScope(const SWorkspaceHideScope&)            = delete;
        SWorkspaceHideScope& operator=(const SWorkspaceHideScope&) = delete;
    };
}

int COverview::initializeLivePreviews() {
    int      currentid = 0;

    Vector2D tileRenderSize = (pMonitor->m_size - Vector2D{GAP_WIDTH * pMonitor->m_scale, GAP_WIDTH * pMonitor->m_scale} * (SIDE_LENGTH - 1)) / SIDE_LENGTH;

    for (size_t i = 0; i < (size_t)(SIDE_LENGTH * SIDE_LENGTH); ++i) {
        auto& image      = images[i];
        image.pWorkspace = g_pCompositor->getWorkspaceByID(image.workspaceID);

        if (image.pWorkspace == startedOn)
            currentid = i;

        image.box = {(i % SIDE_LENGTH) * tileRenderSize.x + (i % SIDE_LENGTH) * GAP_WIDTH, (i / SIDE_LENGTH) * tileRenderSize.y + (i / SIDE_LENGTH) * GAP_WIDTH, tileRenderSize.x,
                     tileRenderSize.y};
    }

    return currentid;
}

void COverview::renderLivePreviewTiles(const std::vector<CBox>& tileBoxes) {
    if (!pMonitor)
        return;

    const auto PMONITOR = pMonitor.lock();
    const auto TIME     = Time::steadyNow();
    const auto OLDWS    = PMONITOR->m_activeWorkspace;
    const auto OLDSPEC  = PMONITOR->m_activeSpecialWorkspace;
    const auto OLDSTATE = captureWorkspacePreviewState(OLDWS);

    g_pHyprRenderer->m_bBlockSurfaceFeedback = true;

    auto renderTile = [&](size_t id) {
        if (!isTileValid(id) || id >= tileBoxes.size())
            return;

        auto& image = images[id];
        auto  ws    = image.pWorkspace ? image.pWorkspace : g_pCompositor->getWorkspaceByID(image.workspaceID);
        if (!ws)
            return;

        image.pWorkspace = ws;

        const CBox& tileBox = tileBoxes[id];
        if (tileBox.w <= 0.01 || tileBox.h <= 0.01)
            return;

        // BUG (fixed): this used to divide tileBox's position by its own
        // width-derived scale factor before handing it to
        // renderWorkspaceOriginal. IHyprRenderer::renderWorkspace(monitor,
        // workspace, now, geometry) already takes geometry.x/y as a direct
        // physical-pixel translate and derives its own internal scale from
        // geometry.width — it needs tileBox verbatim, not further divided.
        // Dividing by a sub-1.0 scale inflates the position, so every tile
        // except the one nearest the origin got rendered off-monitor
        // entirely (confirmed via HXDBG: a tile at physical x=979 with
        // scale=0.32 was landing at renderBox x=3058, on a 2880px-wide
        // monitor). This is why only one tile ever showed real content and
        // the rest looked blank — they were being drawn off-screen, not
        // failing to render.
        CBox renderBox = tileBox;
        if (PMONITOR->m_transform % 2 == 1)
            std::swap(renderBox.w, renderBox.h);

        if (OLDSPEC && ws != startedOn)
            PMONITOR->m_activeSpecialWorkspace.reset();
        else if (OLDSPEC && ws == startedOn)
            PMONITOR->m_activeSpecialWorkspace = OLDSPEC;

        const auto PREVIOUSWS   = activateWorkspaceForPreview(PMONITOR, ws);
        const auto PREVIEWSTATE = applyWorkspacePreviewState(ws);

        {
            SLivePreviewScope livePreviewScope(PMONITOR, ws);
            renderWorkspaceOriginal(PMONITOR, ws, TIME, renderBox);
        }

        restoreWorkspacePreviewState(ws, PREVIEWSTATE);
        restoreActiveWorkspaceAfterPreview(PMONITOR, PREVIOUSWS);
    };

    {
        // Was a bare hideWorkspaceForPreview(OLDWS) + a single
        // restoreWorkspacePreviewState(OLDWS, OLDSTATE) call after this loop.
        // Confirmed live: after closing the overview, the real desktop
        // workspace's own window(s) stopped rendering entirely — hyprctl
        // clients still reported them mapped/visible, but nothing painted
        // until forcing a workspace switch away and back, the exact
        // signature of m_visible getting stuck false. Whatever interrupts
        // this loop before reaching the old bare restore call now can't
        // skip it — the guard's destructor runs regardless.
        SWorkspaceHideScope hideScope(OLDWS, OLDSTATE);
        for (size_t id = 0; id < images.size(); ++id) {
            const auto ws = images[id].pWorkspace ? images[id].pWorkspace : g_pCompositor->getWorkspaceByID(images[id].workspaceID);
            if (ws == OLDWS)
                continue;

            renderTile(id);
        }
    }
    PMONITOR->m_activeSpecialWorkspace = OLDSPEC;

    for (size_t id = 0; id < images.size(); ++id) {
        const auto ws = images[id].pWorkspace ? images[id].pWorkspace : g_pCompositor->getWorkspaceByID(images[id].workspaceID);
        if (ws != OLDWS)
            continue;

        renderTile(id);
        break;
    }

    g_pHyprRenderer->m_bBlockSurfaceFeedback = false;
    PMONITOR->m_activeSpecialWorkspace       = OLDSPEC;
    PMONITOR->m_activeWorkspace              = OLDWS;
    restoreWorkspacePreviewState(OLDWS, OLDSTATE);
}
