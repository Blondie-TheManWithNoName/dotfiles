#include "Internals.hpp"

using namespace Internals;

namespace {
    CBox anchoredBox(const CBox& anchor, double width, double height, const std::string& position, double offX, double offY) {
        CBox box = {0, 0, width, height};

        if (position == "top-left") {
            box.x = anchor.x + offX;
            box.y = anchor.y + offY;
        } else if (position == "top-right") {
            box.x = anchor.x + anchor.w - box.w - offX;
            box.y = anchor.y + offY;
        } else if (position == "bottom-left") {
            box.x = anchor.x + offX;
            box.y = anchor.y + anchor.h - box.h - offY;
        } else if (position == "bottom-right") {
            box.x = anchor.x + anchor.w - box.w - offX;
            box.y = anchor.y + anchor.h - box.h - offY;
        } else {
            box.x = anchor.x + (anchor.w - box.w) / 2.0 + offX;
            box.y = anchor.y + (anchor.h - box.h) / 2.0 + offY;
        }

        box.round();
        return box;
    }

    std::string elideTitle(const std::string& title, size_t maxChars) {
        if (title.size() <= maxChars)
            return title;

        return title.substr(0, maxChars > 1 ? maxChars - 1 : 0) + "…";
    }
}

void CWindowRow::populateTiles() {
    images.clear();

    if (!pMonitor || !pMonitor->m_activeWorkspace)
        return;

    std::vector<PHLWORKSPACE> workspaces = {pMonitor->m_activeWorkspace};
    if (pMonitor->m_activeSpecialWorkspace)
        workspaces.push_back(pMonitor->m_activeSpecialWorkspace);

    for (const auto& window : g_pCompositor->m_windows) {
        bool visible = false;
        for (const auto& ws : workspaces) {
            if (windowVisibleOnWorkspace(window, ws)) {
                visible = true;
                break;
            }
        }

        if (!visible)
            continue;

        SWindowTile tile;
        tile.pWindow = window;
        images.push_back(std::move(tile));
    }

    const auto tileBoxes = computeRowTileBoxes();
    for (size_t i = 0; i < images.size() && i < tileBoxes.size(); ++i)
        images[i].box = tileBoxes[i];

    for (size_t i = 0; i < images.size(); ++i)
        renderWindowTile(i);
}

std::vector<CBox> CWindowRow::computeRowTileBoxes() const {
    std::vector<CBox> boxes(images.size());
    if (!pMonitor || images.empty())
        return boxes;

    static const CConfigValue<Config::INTEGER> PGAPOUT("plugin:hyprexpo:gap_size_outer");

    const double outer  = *PGAPOUT;
    const double height = std::max(1.0, pMonitor->m_size.y - outer * 2);

    std::vector<double> widths(images.size());
    double               totalWidth = 0;
    for (size_t i = 0; i < images.size(); ++i) {
        const auto& window    = images[i].pWindow;
        const auto  windowBox = window ? window->getWindowMainSurfaceBox() : CBox{};

        double aspect = (windowBox.w > 0 && windowBox.h > 0) ? windowBox.w / windowBox.h : 16.0 / 9.0;
        aspect        = std::clamp(aspect, 0.4, 2.5);

        widths[i] = height * aspect;
        totalWidth += widths[i];
    }
    totalWidth += GAP_WIDTH * (double)(images.size() - 1);

    const double available = std::max(1.0, pMonitor->m_size.x - outer * 2);
    const double scale      = totalWidth > available ? available / totalWidth : 1.0;

    const double rowHeight = height * scale;
    const double rowWidth  = totalWidth * scale;

    double       x = (pMonitor->m_size.x - rowWidth) / 2.0;
    const double y = (pMonitor->m_size.y - rowHeight) / 2.0;

    for (size_t i = 0; i < images.size(); ++i) {
        const double w = widths[i] * scale;
        boxes[i]       = CBox{x, y, w, rowHeight};
        x += w + GAP_WIDTH * scale;
    }

    return boxes;
}

void CWindowRow::renderWindowTile(size_t id) {
    if (id >= images.size())
        return;

    auto& image = images[id];
    if (!image.pWindow)
        return;

    const auto PMONITOR = pMonitor.lock();
    if (!PMONITOR)
        return;

    Render::GL::g_pHyprOpenGL->makeEGLCurrent();

    CBox monbox{{0, 0}, PMONITOR->m_pixelSize};

    ensureFramebuffer(image.fb, monbox, framebufferFormatWithAlpha(PMONITOR->m_output->state->state().drmFormat));

    CRegion fakeDamage{0, 0, INT16_MAX, INT16_MAX};
    g_pHyprRenderer->beginRender(PMONITOR, fakeDamage, Render::RENDER_MODE_FULL_FAKE, nullptr, image.fb);

    clearWithColor(CHyprColor{0, 0, 0, 0.0});

    g_pHyprRenderer->renderWindow(image.pWindow, PMONITOR, Time::steadyNow(), true, Render::RENDER_PASS_ALL, true, true);

    g_pHyprRenderer->m_renderData.blockScreenShader = true;
    g_pHyprRenderer->endRender();
}

void CWindowRow::fullRender() {
    if (!pMonitor)
        return;

    if (pMonitor->m_activeWorkspace != startedOn && !closing) {
        // likely user changed workspace out from under the row; just bail without a selection.
        close(false);
        return;
    }

    static const CConfigValue<Config::INTEGER> PTILEROUND("plugin:hyprexpo:tile_rounding");
    static const CConfigValue<Config::FLOAT>   PROUNDINGPOWER("plugin:hyprexpo:tile_rounding_power");
    static const CConfigValue<Config::INTEGER> PTILEROUNDHOVER("plugin:hyprexpo:tile_rounding_hover");
    static const CConfigValue<Config::INTEGER> PTILEROUNDFOCUS("plugin:hyprexpo:tile_rounding_focus");
    static const CConfigValue<Config::INTEGER> PBORDERWIDTH("plugin:hyprexpo:border_width");
    static const CConfigValue<Config::INTEGER> PBORDERHOVER("plugin:hyprexpo:border_color_hover");
    static const CConfigValue<Config::INTEGER> PBORDERFOCUS("plugin:hyprexpo:border_color_focus");
    static const CConfigValue<Config::INTEGER> PLABELENABLE("plugin:hyprexpo:label_enable");
    static const CConfigValue<Config::STRING>  PLABELPOS("plugin:hyprexpo:label_position");
    static const CConfigValue<Config::INTEGER> PLABELOFFX("plugin:hyprexpo:label_offset_x");
    static const CConfigValue<Config::INTEGER> PLABELOFFY("plugin:hyprexpo:label_offset_y");
    static const CConfigValue<Config::INTEGER> PLABELSIZE("plugin:hyprexpo:label_font_size");
    static const CConfigValue<Config::STRING>  PLABELFONT("plugin:hyprexpo:label_font_family");
    static const CConfigValue<Config::INTEGER> PLABELBOLD("plugin:hyprexpo:label_font_bold");
    static const CConfigValue<Config::INTEGER> PLABELITALIC("plugin:hyprexpo:label_font_italic");
    static const CConfigValue<Config::INTEGER> PLABELCOLDEFAULT("plugin:hyprexpo:label_color_default");
    static const CConfigValue<Config::INTEGER> PLABELCOLHOVER("plugin:hyprexpo:label_color_hover");
    static const CConfigValue<Config::INTEGER> PLABELCOLFOCUS("plugin:hyprexpo:label_color_focus");
    static const CConfigValue<Config::INTEGER> PLABELBGENABLE("plugin:hyprexpo:label_bg_enable");
    static const CConfigValue<Config::INTEGER> PLABELBGCOLOR("plugin:hyprexpo:label_bg_color");
    static const CConfigValue<Config::INTEGER> PLABELBGROUND("plugin:hyprexpo:label_bg_rounding");
    static const CConfigValue<Config::INTEGER> PLABELBGPAD("plugin:hyprexpo:label_padding");
    static const CConfigValue<Config::INTEGER> PWINDOWICONENABLE("plugin:hyprexpo:window_icon_enable");
    static const CConfigValue<Config::STRING>  PWINDOWICONPOS("plugin:hyprexpo:window_icon_position");
    static const CConfigValue<Config::INTEGER> PWINDOWICONSIZE("plugin:hyprexpo:window_icon_size");
    static const CConfigValue<Config::INTEGER> PWINDOWICONOFFX("plugin:hyprexpo:window_icon_offset_x");
    static const CConfigValue<Config::INTEGER> PWINDOWICONOFFY("plugin:hyprexpo:window_icon_offset_y");
    static const CConfigValue<Config::FLOAT>   PWINDOWICONALPHA("plugin:hyprexpo:window_icon_alpha");
    static const CConfigValue<Config::INTEGER> PWINDOWICONBGENABLE("plugin:hyprexpo:window_icon_bg_enable");
    static const CConfigValue<Config::INTEGER> PWINDOWICONBGCOLOR("plugin:hyprexpo:window_icon_bg_color");
    static const CConfigValue<Config::INTEGER> PWINDOWICONBGROUND("plugin:hyprexpo:window_icon_bg_rounding");
    static const CConfigValue<Config::INTEGER> PWINDOWICONBGPAD("plugin:hyprexpo:window_icon_padding");

    const float t = std::clamp(openPercent->value(), 0.F, 1.F);

    clearWithColor(CHyprColor{(float)BG_COLOR.r, (float)BG_COLOR.g, (float)BG_COLOR.b, (float)(BG_COLOR.a * t)});

    if (images.empty())
        return;

    const Vector2D center = pMonitor->m_size / 2.0;

    auto lerpBox = [&](const CBox& target) {
        return CBox{center.x + (target.x - center.x) * t, center.y + (target.y - center.y) * t, target.w * t, target.h * t};
    };

    const int   baseRoundPx   = std::max(0, (int)std::lround((double)*PTILEROUND * pMonitor->m_scale));
    const int   hoverRoundPx  = *PTILEROUNDHOVER >= 0 ? std::max(0, (int)std::lround((double)*PTILEROUNDHOVER * pMonitor->m_scale)) : baseRoundPx;
    const int   focusRoundPx  = *PTILEROUNDFOCUS >= 0 ? std::max(0, (int)std::lround((double)*PTILEROUNDFOCUS * pMonitor->m_scale)) : baseRoundPx;
    const float roundingPower = *PROUNDINGPOWER;

    // Tiles are lerped from a zero-size point at the row's center up to their
    // final box as the open animation plays, so early frames have boxes with
    // ~0 width/height. Hyprland's renderers (renderBorder in particular)
    // abort() on a non-positive box rather than no-op, so every draw call
    // below must skip tiles that haven't grown to a real size yet.
    std::vector<CBox> displayBoxes(images.size());
    std::vector<int>  tileRounds(images.size());
    std::vector<bool> tileVisible(images.size());
    for (size_t id = 0; id < images.size(); ++id) {
        displayBoxes[id] = lerpBox(images[id].box);
        tileVisible[id]  = displayBoxes[id].w >= 1.0 && displayBoxes[id].h >= 1.0;

        int round = baseRoundPx;
        if ((int)id == kbFocusID)
            round = focusRoundPx;
        else if ((int)id == hoveredID)
            round = hoverRoundPx;

        tileRounds[id] = std::min(round, std::max(0, (int)std::floor(std::min(displayBoxes[id].w, displayBoxes[id].h) / 2.0)));
    }

    for (size_t id = 0; id < images.size(); ++id) {
        const auto& image = images[id];
        if (!image.fb || !tileVisible[id])
            continue;

        CRegion damage{0, 0, INT16_MAX, INT16_MAX};
        Render::GL::g_pHyprOpenGL->renderTextureInternal(image.fb->getTexture(), displayBoxes[id],
                                                         {.damage = &damage, .a = t, .round = tileRounds[id], .roundingPower = roundingPower});
    }

    if (*PWINDOWICONENABLE) {
        const int    iconSizePx = std::max(1, (int)std::lround((double)*PWINDOWICONSIZE * pMonitor->m_scale));
        const double offX       = *PWINDOWICONOFFX * pMonitor->m_scale;
        const double offY       = *PWINDOWICONOFFY * pMonitor->m_scale;
        const double bgPad      = std::max(0, (int)*PWINDOWICONBGPAD) * pMonitor->m_scale;
        const double alpha      = std::clamp((double)*PWINDOWICONALPHA, 0.0, 1.0) * t;

        for (size_t id = 0; id < images.size(); ++id) {
            const auto& window = images[id].pWindow;
            if (!window || !tileVisible[id])
                continue;

            auto tex = resolveWindowIconTexture(window->m_class.empty() ? window->m_initialClass : window->m_class, iconSizePx);
            if (!tex && !window->m_initialClass.empty() && window->m_initialClass != window->m_class)
                tex = resolveWindowIconTexture(window->m_initialClass, iconSizePx);
            if (!tex)
                continue;

            const CBox&  tileBox = displayBoxes[id];
            const double side    = std::min<double>(iconSizePx, std::max(1.0, std::min(tileBox.w, tileBox.h)));
            const CBox   iconBox = anchoredBox(tileBox, side, side, *PWINDOWICONPOS, offX, offY);

            if (*PWINDOWICONBGENABLE) {
                CBox bg = {iconBox.x - bgPad, iconBox.y - bgPad, iconBox.w + bgPad * 2, iconBox.h + bgPad * 2};
                bg.round();
                Render::GL::g_pHyprOpenGL->renderRect(bg, CHyprColor(*PWINDOWICONBGCOLOR),
                                                      {.round = std::max(0, (int)std::lround((double)*PWINDOWICONBGROUND * pMonitor->m_scale))});
            }

            Render::GL::g_pHyprOpenGL->renderTexture(tex, iconBox, {.a = (float)alpha});
        }
    }

    if (*PLABELENABLE) {
        for (size_t id = 0; id < images.size(); ++id) {
            const auto& window = images[id].pWindow;
            if (!window || !tileVisible[id])
                continue;

            const std::string label = elideTitle(window->m_title, 40);
            if (label.empty())
                continue;

            const bool isHover = (int)id == hoveredID;
            const bool isFocus = (int)id == kbFocusID;

            uint64_t color = *PLABELCOLDEFAULT;
            if (isFocus)
                color = *PLABELCOLFOCUS;
            else if (isHover)
                color = *PLABELCOLHOVER;

            const int fontSize = std::max(8, (int)*PLABELSIZE);
            auto&     cache    = images[id].label;
            auto      tex      = ensureLabelTexture(cache, label, color, fontSize, *PLABELFONT, *PLABELBOLD, *PLABELITALIC);
            if (!tex || tex->m_texID == 0 || cache.sizePx.x <= 0 || cache.sizePx.y <= 0)
                continue;

            const double offX     = *PLABELOFFX * pMonitor->m_scale;
            const double offY     = *PLABELOFFY * pMonitor->m_scale;
            const CBox   labelBox = anchoredBox(displayBoxes[id], cache.sizePx.x, cache.sizePx.y, *PLABELPOS, offX, offY);

            if (*PLABELBGENABLE) {
                const double pad = *PLABELBGPAD * pMonitor->m_scale;
                CBox         bg  = {labelBox.x - pad, labelBox.y - pad, labelBox.w + pad * 2, labelBox.h + pad * 2};
                bg.round();
                Render::GL::g_pHyprOpenGL->renderRect(bg, CHyprColor(*PLABELBGCOLOR), {.round = std::max(0, (int)std::lround((double)*PLABELBGROUND * pMonitor->m_scale))});
            }

            Render::GL::g_pHyprOpenGL->renderTexture(tex, labelBox, {.a = t});
        }
    }

    auto drawBorder = [&](int id, uint64_t color) {
        if (id < 0 || id >= (int)images.size() || !tileVisible[id] || *PBORDERWIDTH <= 0 || CHyprColor(color).a <= 0.0)
            return;

        Render::GL::g_pHyprOpenGL->renderBorder(displayBoxes[id], gradientFromColor(color),
                                                {.round = tileRounds[id], .roundingPower = roundingPower, .borderSize = std::max(1, (int)*PBORDERWIDTH)});
    };

    if (hoveredID != -1 && hoveredID != kbFocusID)
        drawBorder(hoveredID, *PBORDERHOVER);
    if (kbFocusID != -1)
        drawBorder(kbFocusID, *PBORDERFOCUS);
}
