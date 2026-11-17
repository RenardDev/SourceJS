
// C++
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <cstring>

// Project
#include "sourcejs/public/ISourceJSExtension.h"

// This test library uses the public C ABI; no STL ownership crosses the boundary.
#if defined(SOURCEJS_FIXTURE_NO_API)
SOURCEJS_EXTENSION_EXPORT bool SourceJS_UnrelatedAPI() {
	return true;
}
#else
namespace {
	constexpr std::uint32_t kModuleCount = 2;

	SourceJS::fnSourceJSExtensionLog g_Log = nullptr;

	bool IsMode(char const* const pszExpected) noexcept {
#if defined(_WIN32)
		constexpr std::size_t kModeCapacity = 32;

		char szMode[kModeCapacity] {};
		std::size_t unLength = 0;
		if (getenv_s(&unLength, szMode, sizeof(szMode), "SOURCEJS_EXTENSION_FIXTURE_MODE") != 0) {
			return false;
		}

		return std::strcmp(szMode, pszExpected) == 0;
#else
		char const* const pszMode = std::getenv("SOURCEJS_EXTENSION_FIXTURE_MODE");

		return pszMode && (std::strcmp(pszMode, pszExpected) == 0);
#endif
	}

	bool Load(SourceJS::SOURCEJS_EXTENSION_CONTEXT const* const pContext) {
		if (!pContext || !pContext->m_pszRootPath || !pContext->m_pLog || !pContext->m_pszSDKBranch || !pContext->m_pszPlatform || !pContext->m_pszArchitecture) {
			return false;
		}

		if ((std::strcmp(pContext->m_pszSDKBranch, SOURCEJS_SDK_BRANCH) != 0) || (std::strcmp(pContext->m_pszPlatform, SOURCEJS_TARGET_PLATFORM) != 0) || (std::strcmp(pContext->m_pszArchitecture, SOURCEJS_TARGET_ARCH) != 0)) {
			return false;
		}

		pContext->m_pLog("Fixture.Load");

		if (IsMode("REJECT_LOAD")) {
			return false;
		}

		g_Log = pContext->m_pLog;

		return true;
	}

	void Unload() {
		if (g_Log) {
			g_Log("Fixture.Unload");
		}

		g_Log = nullptr;
	}

	std::uint32_t GetModuleCount() {
		return kModuleCount;
	}

	void Echo(v8::FunctionCallbackInfo<v8::Value> const&) {
	}

	constexpr SourceJS::SOURCEJS_EXTENSION_FUNCTION kFunctions[] = {
		{ "Echo", Echo, nullptr },
	};

	bool GetModule(const std::uint32_t unModuleIndex, SourceJS::PSOURCEJS_EXTENSION_MODULE pModule) {
		if (!pModule || (unModuleIndex >= kModuleCount) || IsMode("REJECT_MODULE")) {
			return false;
		}

		pModule->m_pszName = (unModuleIndex == 0) ? "Main" : "Nested/Helper";
		pModule->m_unFunctionCount = 1;
		pModule->m_pFunctions = kFunctions;

		return true;
	}
} // namespace

SOURCEJS_EXTENSION_EXPORT bool SourceJS_GetNativeExtensionAPI(const std::uint32_t unVersion, const std::uint32_t unCapacity, SourceJS::PSOURCEJS_EXTENSION_API pAPI) {
	if (!pAPI || (unVersion != SOURCEJS_EXTENSION_ABI_VERSION) || (unCapacity != sizeof(*pAPI))) {
		return false;
	}

	*pAPI = {};
	pAPI->m_unSize = IsMode("BAD_SIZE") ? 0 : sizeof(*pAPI);
	pAPI->m_unABIVersion = IsMode("BAD_ABI") ? (SOURCEJS_EXTENSION_ABI_VERSION + 1) : SOURCEJS_EXTENSION_ABI_VERSION;
	pAPI->m_pszV8ABI = IsMode("BAD_V8_ABI") ? "wrong" : SOURCEJS_EXTENSION_V8_ABI;
	pAPI->m_pLoad = Load;
	pAPI->m_pUnload = Unload;
	pAPI->m_pGetModuleCount = GetModuleCount;
	pAPI->m_pGetModule = GetModule;

	return true;
}
#endif
