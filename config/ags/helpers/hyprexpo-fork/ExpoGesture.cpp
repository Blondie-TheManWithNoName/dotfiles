#include "ExpoGesture.hpp"

#include "Overview.hpp"
#include "WindowRow.hpp"

#include <hyprland/src/Compositor.hpp>
#include <hyprland/src/config/ConfigValue.hpp>
#include <hyprland/src/desktop/state/FocusState.hpp>
#include <hyprland/src/helpers/Monitor.hpp>

#include <algorithm>
#include <cctype>

static std::string lowerCopy(std::string value) {
    std::ranges::transform(value, value.begin(), [](unsigned char c) { return std::tolower(c); });
    return value;
}

void CExpoGesture::begin(const ITrackpadGesture::STrackpadGestureBegin& e) {
    ITrackpadGesture::begin(e);

    m_lastDelta   = 0.F;
    m_firstUpdate = true;

    if (g_pOverview) {
        g_pOverview->selectHoveredWorkspace();
        g_pOverview->setClosing(true);
        return;
    }

    if (g_pWindowRow) {
        g_pWindowRow->selectHoveredWorkspace();
        g_pWindowRow->setClosing(true);
        return;
    }

    static const CConfigValue<Config::STRING> PCONTENTMODE("plugin:hyprexpo:content_mode");
    if (lowerCopy(*PCONTENTMODE) == "windows")
        g_pWindowRow = std::make_unique<CWindowRow>(Desktop::focusState()->monitor()->m_activeWorkspace, true);
    else
        g_pOverview = std::make_unique<COverview>(Desktop::focusState()->monitor()->m_activeWorkspace, true);
}

void CExpoGesture::update(const ITrackpadGesture::STrackpadGestureUpdate& e) {
    if (m_firstUpdate) {
        m_firstUpdate = false;
        return;
    }

    if (!g_pOverview && !g_pWindowRow)
        return;

    m_lastDelta += distance(e);

    if (m_lastDelta <= 0.01) // plugin will crash if swipe ends at <= 0
        m_lastDelta = 0.01;

    if (g_pOverview)
        g_pOverview->onSwipeUpdate(m_lastDelta);
    else
        g_pWindowRow->onSwipeUpdate(m_lastDelta);
}

void CExpoGesture::end(const ITrackpadGesture::STrackpadGestureEnd& e) {
    if (g_pOverview) {
        g_pOverview->setClosing(false);
        g_pOverview->onSwipeEnd();
        return;
    }

    if (g_pWindowRow) {
        g_pWindowRow->setClosing(false);
        g_pWindowRow->onSwipeEnd();
    }
}
