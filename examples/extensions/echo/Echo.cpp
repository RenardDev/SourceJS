
// C++
#include <cstdint>

// Third-party
#include <v8.h>

// Project
#include "sourcejs/public/ISourceJSExtension.h"

namespace {

#if defined(SOURCEJS_ECHO_VERIFY_ISOLATE)
	constexpr std::uint32_t kIsolateTestSlot = 0;
#endif

	constinit v8::Isolate* g_pIsolate = nullptr;

	bool Load(SourceJS::SOURCEJS_EXTENSION_CONTEXT const* const pContext) {
		if (!pContext || !pContext->m_pContext || !pContext->m_pIsolate) {
			return false;
		}

		g_pIsolate = pContext->m_pIsolate;
#if defined(SOURCEJS_ECHO_VERIFY_ISOLATE)
		g_pIsolate->SetData(kIsolateTestSlot, &g_pIsolate);
#endif

		return true;
	}

	void Unload() {
#if defined(SOURCEJS_ECHO_VERIFY_ISOLATE)
		g_pIsolate->SetData(kIsolateTestSlot, nullptr);
#endif
		g_pIsolate = nullptr;
	}

	void Echo(v8::FunctionCallbackInfo<v8::Value> const& Arguments) {
#if defined(SOURCEJS_ECHO_VERIFY_ISOLATE)
		if (Arguments.GetIsolate()->GetData(kIsolateTestSlot) != &g_pIsolate) {
			return;
		}
#endif

		if ((Arguments.GetIsolate() == g_pIsolate) && (Arguments.Length() > 0)) {
			Arguments.GetReturnValue().Set(Arguments[0]);
		}
	}

#if defined(SOURCEJS_ECHO_LINKED_V8)
	void GetV8Version(v8::FunctionCallbackInfo<v8::Value> const& Arguments) {
		v8::Local<v8::String> LocalVersion {};
		if (v8::String::NewFromUtf8(Arguments.GetIsolate(), v8::V8::GetVersion()).ToLocal(&LocalVersion)) {
			Arguments.GetReturnValue().Set(LocalVersion);
		}
	}
#endif

	constexpr SourceJS::SOURCEJS_EXTENSION_FUNCTION kFunctions[] = {
		{ "Echo", Echo, nullptr },
#if defined(SOURCEJS_ECHO_LINKED_V8)
		{ "GetV8Version", GetV8Version, nullptr },
#endif
	};

	std::uint32_t GetModuleCount() {
		return 1;
	}

	bool GetModule(const std::uint32_t unModuleIndex, SourceJS::PSOURCEJS_EXTENSION_MODULE pModuleOut) {
		if (!pModuleOut || (unModuleIndex != 0)) {
			return false;
		}

		*pModuleOut = { "echo", sizeof(kFunctions) / sizeof(kFunctions[0]), kFunctions };

		return true;
	}
} // namespace

SOURCEJS_EXTENSION_EXPORT bool SourceJS_GetNativeExtensionAPI(const std::uint32_t unRequestedVersion, const std::uint32_t unCapacity, SourceJS::PSOURCEJS_EXTENSION_API pAPIOut) {
	if (!pAPIOut || (unRequestedVersion != SOURCEJS_EXTENSION_ABI_VERSION) || (unCapacity != sizeof(*pAPIOut))) {
		return false;
	}

	*pAPIOut = {};
	pAPIOut->m_unSize = sizeof(*pAPIOut);
	pAPIOut->m_unABIVersion = SOURCEJS_EXTENSION_ABI_VERSION;
	pAPIOut->m_pszV8ABI = SOURCEJS_EXTENSION_V8_ABI;
	pAPIOut->m_pLoad = Load;
	pAPIOut->m_pUnload = Unload;
	pAPIOut->m_pGetModuleCount = GetModuleCount;
	pAPIOut->m_pGetModule = GetModule;

	return true;
}
