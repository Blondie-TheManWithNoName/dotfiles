#include "Internals.hpp"
#include "WindowRowPassElement.hpp"

using namespace Internals;

CWindowRow::CWindowRow(PHLWORKSPACE startedOn_, bool swipe_) : startedOn(startedOn_), swipe(swipe_) {
    const auto PMONITOR = Desktop::focusState()->monitor();
    pMonitor             = PMONITOR;

    static const CConfigValue<Config::INTEGER> PGAPS("plugin:hyprexpo:gap_size");
    static const CConfigValue<Config::INTEGER> PCOL("plugin:hyprexpo:bg_col");

    GAP_WIDTH = *PGAPS;
    BG_COLOR  = CHyprColor(*PCOL);

    populateTiles();

    g_pAnimationManager->createAnimation(0.F, openPercent, Config::animationTree()->getAnimationPropertyConfig("windowsMove"), AVARDAMAGE_NONE);
    openPercent->setUpdateCallback([this](WP<Hyprutils::Animation::CBaseAnimatedVariable>) { damage(); });

    if (!swipe)
        *openPercent = 1.F;

    Cursor::overrideController->setOverride("left_ptr", Cursor::CURSOR_OVERRIDE_UNKNOWN);

    lastMousePosLocal = g_pInputManager->getMouseCoordsInternal() - pMonitor->m_position;
    updateHoveredFromMouse();
    kbFocusID = hoveredID;

    auto onCursorMove = [this](Event::SCallbackInfo& info) {
        if (closing)
            return;

        info.cancelled    = true;
        lastMousePosLocal = g_pInputManager->getMouseCoordsInternal() - pMonitor->m_position;
        updateHoveredFromMouse();
    };

    auto onCursorSelect = [this](IPointer::SButtonEvent event, Event::SCallbackInfo& info) {
        if (closing)
            return;

        info.cancelled = true;

        if (event.state != WL_POINTER_BUTTON_STATE_PRESSED)
            return;

        selectHoveredWorkspace();
        close();
    };

    auto onTouchSelect = [this](Event::SCallbackInfo& info) {
        if (closing)
            return;

        info.cancelled = true;

        selectHoveredWorkspace();
        close();
    };

    mouseMoveHook = Event::bus()->m_events.input.mouse.move.listen([onCursorMove](Vector2D, Event::SCallbackInfo& info) { onCursorMove(info); });
    touchMoveHook = Event::bus()->m_events.input.touch.motion.listen([onCursorMove](ITouch::SMotionEvent, Event::SCallbackInfo& info) { onCursorMove(info); });

    mouseButtonHook = Event::bus()->m_events.input.mouse.button.listen([onCursorSelect](IPointer::SButtonEvent event, Event::SCallbackInfo& info) { onCursorSelect(event, info); });
    touchDownHook   = Event::bus()->m_events.input.touch.down.listen([onTouchSelect](ITouch::SDownEvent, Event::SCallbackInfo& info) { onTouchSelect(info); });
}

CWindowRow::~CWindowRow() {
    Render::GL::g_pHyprOpenGL->makeEGLCurrent();
    images.clear(); // otherwise we get a vram leak
    Cursor::overrideController->unsetOverride(Cursor::CURSOR_OVERRIDE_UNKNOWN);
    g_pPointerManager->resetCursorImage();
    g_pInputManager->simulateMouseMovement();
    if (pMonitor)
        pMonitor->m_blurFBDirty = true;
}

void CWindowRow::damage() {
    blockDamageReporting = true;
    g_pHyprRenderer->damageMonitor(pMonitor.lock());
    blockDamageReporting = false;
}

void CWindowRow::onDamageReported() {
    damage();
    g_pCompositor->scheduleFrameForMonitor(pMonitor.lock());
}

void CWindowRow::onPreRender() {
    // tiles are captured once at open; there is nothing to redraw continuously.
}

void CWindowRow::render() {
    if (!pMonitor)
        return;

    g_pHyprRenderer->m_renderPass.add(makeUnique<CWindowRowPassElement>());
}

void CWindowRow::setClosing(bool closing_) {
    closing = closing_;
}

void CWindowRow::resetSwipe() {
    swipeWasCommenced = false;
}

void CWindowRow::onSwipeUpdate(double delta) {
    m_isSwiping = true;

    static const CConfigValue<Config::INTEGER> PDISTANCE("plugin:hyprexpo:gesture_distance");

    const float PERC = closing ? (1.0 - std::clamp(delta / (double)*PDISTANCE, 0.0, 1.0)) : std::clamp(delta / (double)*PDISTANCE, 0.0, 1.0);

    openPercent->setValueAndWarp(PERC);
}

void CWindowRow::onSwipeEnd() {
    if (closing || !m_isSwiping)
        return;

    const float PERC = openPercent->value();
    if (PERC < 0.5) {
        close();
        return;
    }

    *openPercent = 1.F;

    swipeWasCommenced = false;
    m_isSwiping        = false;
}

void CWindowRow::close(bool switchToSelection) {
    if (closing)
        return;

    closing = true;

    if (switchToSelection) {
        const int ID = closeOnID == -1 ? hoveredID : closeOnID;
        if (isTileValid(ID)) {
            const auto& WINDOW = images[ID].pWindow;
            Desktop::focusState()->fullWindowFocus(WINDOW, Desktop::FOCUS_REASON_KEYBIND);
            g_pCompositor->warpCursorTo(WINDOW->middle());
        }
    }

    openPercent->warp();
    *openPercent = 0.F;

    openPercent->setCallbackOnEnd([](auto) { g_pEventLoopManager->doLater([] { g_pWindowRow.reset(); }); });
}

void CWindowRow::selectHoveredWorkspace() {
    if (closing)
        return;

    updateHoveredFromMouse();
    closeOnID = std::clamp(hoveredID, -1, (int)images.size() - 1);
}

bool CWindowRow::isTileValid(int id) const {
    return id >= 0 && id < (int)images.size() && images[id].pWindow != nullptr;
}

void CWindowRow::updateHoveredFromMouse() {
    if (!pMonitor)
        return;

    int newHoveredID = -1;
    for (size_t i = 0; i < images.size(); ++i) {
        const auto& box = images[i].box;
        if (lastMousePosLocal.x >= box.x && lastMousePosLocal.x < box.x + box.w && lastMousePosLocal.y >= box.y && lastMousePosLocal.y < box.y + box.h) {
            newHoveredID = (int)i;
            break;
        }
    }

    if (newHoveredID == hoveredID)
        return;

    hoveredID = newHoveredID;
    damage();
}

void CWindowRow::ensureKeyboardFocus() {
    if (isTileValid(kbFocusID))
        return;

    if (!images.empty())
        kbFocusID = 0;
}

void CWindowRow::moveKeyboardFocus(int dx, int dy) {
    if (closing)
        return;

    static const CConfigValue<Config::INTEGER> PWRAPH("plugin:hyprexpo:keynav_wrap_h");

    ensureKeyboardFocus();
    if (!isTileValid(kbFocusID) || dx == 0)
        return;

    const int total = (int)images.size();
    const int step  = dx > 0 ? 1 : -1;
    int       id    = kbFocusID + step;
    if (id < 0 || id >= total) {
        if (!*PWRAPH)
            return;
        id = (id + total) % total;
    }

    kbFocusID = id;
    damage();
}

void CWindowRow::confirmKeyboardFocus() {
    if (closing)
        return;

    ensureKeyboardFocus();
    if (isTileValid(kbFocusID))
        closeOnID = kbFocusID;
    close();
}
