#define WLR_USE_UNSTABLE

#include "Hooks.hpp"
#include "Globals.hpp"
#include "Overview.hpp"
#include "WindowRow.hpp"

#include <hyprland/src/Compositor.hpp>
#include <hyprland/src/helpers/time/Time.hpp>
#include <hyprland/src/render/Renderer.hpp>

#include <initializer_list>

static CFunctionHook* g_pRenderWorkspaceHook    = nullptr;
static CFunctionHook* g_pAddDamageHookA         = nullptr;
static CFunctionHook* g_pAddDamageHookB         = nullptr;
static CFunctionHook* g_pShouldRenderWindowHook = nullptr;

typedef void (*origRenderWorkspace)(void*, PHLMONITOR, PHLWORKSPACE, const Time::steady_tp&, const CBox&);
typedef void (*origAddDamageA)(void*, const CBox&);
typedef void (*origAddDamageB)(void*, const pixman_region32_t*);
typedef bool (*origShouldRenderWindow)(void*, PHLWINDOW, PHLMONITOR);

static bool         g_renderingOverview = false;
static PHLMONITOR   g_livePreviewMonitor;
static PHLWORKSPACE g_livePreviewWorkspace;

static bool         livePreviewActiveForMonitor(const PHLMONITOR& pMonitor) {
    return g_livePreviewWorkspace && pMonitor && pMonitor == g_livePreviewMonitor;
}

static bool canConstrainWindowToLivePreviewWorkspace(const PHLWINDOW& pWindow) {
    if (!pWindow || !pWindow->m_workspace)
        return false;

    // Windows being unmapped can still be considered renderable by Hyprland for
    // fade-out paths. Leave those lifecycle cases to Hyprland's renderer instead
    // of treating them as stable live-preview workspace members.
    return pWindow->m_isMapped;
}

void setRenderingOverview(bool rendering) {
    g_renderingOverview = rendering;
}

void setLivePreviewWorkspace(PHLMONITOR monitor, PHLWORKSPACE workspace) {
    g_livePreviewMonitor   = monitor;
    g_livePreviewWorkspace = workspace;
}

void renderWorkspaceOriginal(PHLMONITOR pMonitor, PHLWORKSPACE pWorkspace, const Time::steady_tp& now, const CBox& geometry) {
    if (!g_pRenderWorkspaceHook)
        return;

    ((origRenderWorkspace)(g_pRenderWorkspaceHook->m_original))(g_pHyprRenderer.get(), pMonitor, pWorkspace, now, geometry);
}

static void hkRenderWorkspace(void* thisptr, PHLMONITOR pMonitor, PHLWORKSPACE pWorkspace, const Time::steady_tp& now, const CBox& geometry) {
    if (g_pOverview && !g_renderingOverview && !g_pOverview->blockOverviewRendering && g_pOverview->pMonitor == pMonitor) {
        g_pOverview->render();
        return;
    }

    if (g_pWindowRow && !g_renderingOverview && !g_pWindowRow->blockOverviewRendering && g_pWindowRow->pMonitor == pMonitor) {
        g_pWindowRow->render();
        return;
    }

    ((origRenderWorkspace)(g_pRenderWorkspaceHook->m_original))(thisptr, pMonitor, pWorkspace, now, geometry);
}

static void hkAddDamageA(void* thisptr, const CBox& box) {
    const auto PMONITOR = (CMonitor*)thisptr;

    if (g_pOverview && g_pOverview->pMonitor == PMONITOR->m_self && !g_pOverview->blockDamageReporting) {
        g_pOverview->onDamageReported();
        return;
    }

    if (g_pWindowRow && g_pWindowRow->pMonitor == PMONITOR->m_self && !g_pWindowRow->blockDamageReporting) {
        g_pWindowRow->onDamageReported();
        return;
    }

    ((origAddDamageA)g_pAddDamageHookA->m_original)(thisptr, box);
}

static void hkAddDamageB(void* thisptr, const pixman_region32_t* rg) {
    const auto PMONITOR = (CMonitor*)thisptr;

    if (g_pOverview && g_pOverview->pMonitor == PMONITOR->m_self && !g_pOverview->blockDamageReporting) {
        g_pOverview->onDamageReported();
        return;
    }

    if (g_pWindowRow && g_pWindowRow->pMonitor == PMONITOR->m_self && !g_pWindowRow->blockDamageReporting) {
        g_pWindowRow->onDamageReported();
        return;
    }

    ((origAddDamageB)g_pAddDamageHookB->m_original)(thisptr, rg);
}

static bool hkShouldRenderWindow(void* thisptr, const PHLWINDOW* pWindowArg, const PHLMONITOR* pMonitorArg) {
    if (!pWindowArg || !pMonitorArg)
        return false;

    const PHLWINDOW  pWindow  = *pWindowArg;
    const PHLMONITOR pMonitor = *pMonitorArg;
    const bool       result   = ((origShouldRenderWindow)(g_pShouldRenderWindowHook->m_original))(thisptr, pWindow, pMonitor);

    if (!result || !livePreviewActiveForMonitor(pMonitor))
        return result;

    if (!canConstrainWindowToLivePreviewWorkspace(pWindow))
        return result;

    if (pWindow->m_pinned)
        return true;

    const auto PWINDOWWORKSPACE = pWindow->m_workspace;
    if (PWINDOWWORKSPACE == g_livePreviewWorkspace)
        return true;

    if (pMonitor->m_activeSpecialWorkspace && PWINDOWWORKSPACE == pMonitor->m_activeSpecialWorkspace)
        return true;

    return false;
}

static bool findHookTarget(const std::string& name, SFunctionMatch& target, std::string& error) {
    const auto FNS = HyprlandAPI::findFunctionsByName(PHANDLE, name);
    if (FNS.empty()) {
        error = "no fns for hook " + name;
        return false;
    }

    target = FNS[0];
    return true;
}

static bool findHookTarget(std::initializer_list<const char*> names, const std::string& label, SFunctionMatch& target, std::string& error) {
    for (const auto* name : names) {
        if (findHookTarget(name, target, error))
            return true;
    }

    error = "no fns for hook " + label;
    return false;
}

bool installHooks(std::string& error) {
    SFunctionMatch target;

    // These long strings are Itanium C++ ABI-mangled symbol names for the
    // Hyprland methods being hooked. They identify the exact overload and
    // signature; run them through c++filt to see the demangled method names.
    // Short names are kept as compatibility fallbacks where Hyprland can find
    // the hook target without the full linker symbol.
    if (!findHookTarget(
            {
                // Render::IHyprRenderer::renderWorkspace(...)
                "_ZN6Render13IHyprRenderer15renderWorkspaceEN9Hyprutils6Memory14CSharedPointerI8CMonitorEENS3_I10CWorkspaceEERKNSt6chrono10time_pointINS8_3_V212steady_clockENS8_"
                "8durationIlSt5ratioILl1ELl1000000000EEEEEERKNS1_4Math4CBoxE",
                "renderWorkspace",
            },
            "renderWorkspace", target, error))
        return false;
    g_pRenderWorkspaceHook = HyprlandAPI::createFunctionHook(PHANDLE, target.address, (void*)hkRenderWorkspace);

    if (!findHookTarget(
            {
                // CMonitor::addDamage(pixman_region32 const*)
                "_ZN8CMonitor9addDamageEPK15pixman_region32",
                "addDamageEPK15pixman_region32",
            },
            "addDamage(pixman_region32)", target, error))
        return false;
    g_pAddDamageHookB = HyprlandAPI::createFunctionHook(PHANDLE, target.address, (void*)hkAddDamageB);

    // CMonitor::addDamage(Hyprutils::Math::CBox const&)
    if (!findHookTarget("_ZN8CMonitor9addDamageERKN9Hyprutils4Math4CBoxE", target, error))
        return false;
    g_pAddDamageHookA = HyprlandAPI::createFunctionHook(PHANDLE, target.address, (void*)hkAddDamageA);

    // Render::IHyprRenderer::shouldRenderWindow(PHLWINDOW, PHLMONITOR).
    //
    // The exact symbol matters more here than for the other hooks: Hyprland
    // exports TWO overloads of shouldRenderWindow — a one-argument
    // (PHLWINDOW) and a two-argument (PHLWINDOW, PHLMONITOR) form — and
    // hkShouldRenderWindow reads a monitor argument, so hooking the one-arg
    // overload makes it read a garbage register as a CSharedPointer and
    // corrupt/crash on the refcount increment. That is exactly what happened
    // when an older hardcoded name ("...CSharedPointerI7CWindowEE...", from
    // before the class moved into the Desktop::View namespace) stopped
    // matching and the bare "shouldRenderWindow" fallback silently bound
    // FNS[0] = the one-arg overload. Never fall back to an arity-blind name
    // match for this hook: require the mangled signature to carry the
    // CMonitor parameter, and fail plugin load loudly otherwise.
    {
        constexpr const char* SRW_EXACT       = "_ZN6Render13IHyprRenderer18shouldRenderWindowEN9Hyprutils6Memory14CSharedPointerIN7Desktop4View7CWindowEEENS3_I8CMonitorEE";
        constexpr const char* SRW_MONITOR_ARG = "8CMonitorEE";

        if (!findHookTarget(SRW_EXACT, target, error)) {
            bool found = false;
            for (const auto& match : HyprlandAPI::findFunctionsByName(PHANDLE, "shouldRenderWindow")) {
                if (match.signature.find(SRW_MONITOR_ARG) == std::string::npos)
                    continue;
                target = match;
                found  = true;
                break;
            }
            if (!found) {
                error = "no two-argument (PHLWINDOW, PHLMONITOR) overload found for hook shouldRenderWindow";
                return false;
            }
        }
    }
    g_pShouldRenderWindowHook = HyprlandAPI::createFunctionHook(PHANDLE, target.address, (void*)hkShouldRenderWindow);

    bool success = g_pRenderWorkspaceHook->hook();
    success      = success && g_pAddDamageHookA->hook();
    success      = success && g_pAddDamageHookB->hook();
    success      = success && g_pShouldRenderWindowHook->hook();

    if (!success) {
        error = "Failed initializing hooks";
        return false;
    }

    return true;
}
