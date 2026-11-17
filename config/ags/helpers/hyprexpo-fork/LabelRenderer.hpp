#pragma once

#include <hyprland/src/render/Texture.hpp>
#include <cstdint>
#include <string>

struct SLabelTexture {
    SP<Render::ITexture> tex;
    Vector2D             sizePx;
    std::string          text;
    uint64_t             color      = 0;
    int                  fontSizePx = 0;
    std::string          fontFamily;
    bool                 bold   = false;
    bool                 italic = false;
};

SP<Render::ITexture> ensureLabelTexture(SLabelTexture& cached, const std::string& text, uint64_t color, int fontSizePx, const std::string& fontFamily, bool bold, bool italic);
