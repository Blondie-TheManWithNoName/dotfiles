#include "WindowRowPassElement.hpp"
#include <hyprland/src/render/OpenGL.hpp>
#include "WindowRow.hpp"

CWindowRowPassElement::CWindowRowPassElement() {
    ;
}

std::vector<UP<IPassElement>> CWindowRowPassElement::draw() {
    g_pWindowRow->fullRender();
    return {};
}

bool CWindowRowPassElement::needsLiveBlur() {
    return false;
}

bool CWindowRowPassElement::needsPrecomputeBlur() {
    return false;
}

std::optional<CBox> CWindowRowPassElement::boundingBox() {
    if (!g_pWindowRow->pMonitor)
        return std::nullopt;

    return CBox{{}, g_pWindowRow->pMonitor->m_size};
}

CRegion CWindowRowPassElement::opaqueRegion() {
    if (!g_pWindowRow->pMonitor)
        return CRegion{};

    return CBox{{}, g_pWindowRow->pMonitor->m_size};
}
