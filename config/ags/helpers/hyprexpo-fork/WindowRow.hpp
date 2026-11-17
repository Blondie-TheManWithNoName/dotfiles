#pragma once

#define WLR_USE_UNSTABLE

#include "Globals.hpp"
#include "LabelRenderer.hpp"
#include <hyprland/src/desktop/DesktopTypes.hpp>
#include <hyprland/src/render/Framebuffer.hpp>
#include <hyprland/src/render/Texture.hpp>
#include <hyprland/src/helpers/AnimatedVariable.hpp>
#include <hyprland/src/event/EventBus.hpp>
#include <memory>
#include <vector>

class CMonitor;

// A single row of the individual windows open on the current workspace,
// shown instead of the workspace grid when plugin:hyprexpo:content_mode is
// "windows". Deliberately a separate, much smaller class rather than a mode
// bolted onto COverview: COverview's layout/interaction code is keyed on a
// square SIDE_LENGTH grid throughout (constructor, close(), Swipe.cpp,
// Interaction.cpp hit-testing/keyboard-nav), and this fork's grid pipeline
// has already been through several rounds of hard-won stability fixes that
// aren't worth risking for an unrelated layout.
class CWindowRow {
  public:
    CWindowRow(PHLWORKSPACE startedOn_, bool swipe = false);
    ~CWindowRow();

    void render();
    void damage();
    void onDamageReported();
    void onPreRender();

    void setClosing(bool closing);

    void resetSwipe();
    void onSwipeUpdate(double delta);
    void onSwipeEnd();

    // close without a selection
    void close(bool switchToSelection = true);
    // focuses the hovered window (name kept in step with COverview's dispatcher call sites)
    void selectHoveredWorkspace();
    void moveKeyboardFocus(int dx, int dy);
    void confirmKeyboardFocus();

    bool blockOverviewRendering = false;
    bool blockDamageReporting   = false;

    PHLMONITORREF pMonitor;
    bool          m_isSwiping = false;

    struct SWindowTile {
        SP<Render::IFramebuffer> fb;
        PHLWINDOW                pWindow;
        CBox                     box;
        SLabelTexture            label;
    };

  private:
    void               populateTiles();
    void               renderWindowTile(size_t id);
    void               fullRender();
    std::vector<CBox>  computeRowTileBoxes() const;
    void               updateHoveredFromMouse();
    void               ensureKeyboardFocus();
    bool               isTileValid(int id) const;

    int                GAP_WIDTH = 5;
    CHyprColor         BG_COLOR  = CHyprColor{0.1, 0.1, 0.1, 1.0};

    bool               damageDirty = false;

    Vector2D           lastMousePosLocal = Vector2D{};

    int                hoveredID = -1;
    int                kbFocusID = -1;
    int                closeOnID = -1;

    std::vector<SWindowTile> images;

    PHLWORKSPACE       startedOn;

    // 0 = fully closed (invisible), 1 = fully open. Drives a simple
    // grow-from-center + fade transform rather than COverview's per-tile
    // zoom-camera, since there's no "single tile" state to zoom out from.
    PHLANIMVAR<float>  openPercent;

    bool               closing = false;

    CHyprSignalListener mouseMoveHook;
    CHyprSignalListener mouseButtonHook;
    CHyprSignalListener touchMoveHook;
    CHyprSignalListener touchDownHook;

    bool               swipe             = false;
    bool               swipeWasCommenced = false;

    friend class CWindowRowPassElement;
};

inline std::unique_ptr<CWindowRow> g_pWindowRow;
