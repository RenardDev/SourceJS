#pragma once

#ifndef _SOURCEJSPUBLICISOURCEJSEXTENSION_H_
#define _SOURCEJSPUBLICISOURCEJSEXTENSION_H_

// Compatibility profile (4.1): the canonical guard uses the reserved-name exception.

// C++
#include <cstdint>

// ================================================================
// General definitions
// ================================================================

#define SOURCEJS_EXTENSION_ABI_VERSION 3

#if defined(_WIN32)
#define SOURCEJS_EXTENSION_EXPORT extern "C" __declspec(dllexport)
#else
#define SOURCEJS_EXTENSION_EXPORT extern "C" __attribute__((visibility("default")))
#endif

// ================================================================
// Extension ABI
// ================================================================

namespace v8 {
	class Context;
	class Isolate;
	class Value;
	template <typename T> class Local;
	template <typename T> class FunctionCallbackInfo;
} // namespace v8

namespace SourceJS {

	// ABI 3 is a versioned native boundary. Use the same V8 headers, build features,
	// toolchain ABI and architecture as the host. Do not link a second V8 engine.
	// No STL object, C++ exception or allocator ownership may cross the extension ABI.
	using fnSourceJSExtensionLog = void(*)(char const* const pszMessage);

	// The context and its strings are borrowed during Load; copy anything retained afterward.
	// RootPath uses the host filesystem's native narrow encoding; the remaining strings are ASCII.
	typedef struct _SOURCEJS_EXTENSION_CONTEXT {
		char const* m_pszRootPath;
		char const* m_pszSDKBranch;
		char const* m_pszPlatform;
		char const* m_pszArchitecture;
		fnSourceJSExtensionLog m_pLog;
		v8::Isolate* m_pIsolate;
		v8::Local<v8::Context> const* m_pContext;
	} SOURCEJS_EXTENSION_CONTEXT, *PSOURCEJS_EXTENSION_CONTEXT;

	using fnSourceJSExtensionGetName = char const*(*)();

	// A failed Load callback must clean its partial state; the host does not invoke Unload for it.
	using fnSourceJSExtensionLoad = bool(*)(SOURCEJS_EXTENSION_CONTEXT const* const pContext);
	using fnSourceJSExtensionUnload = void(*)();

	using fnSourceJSExtensionInvoke = void(*)(v8::FunctionCallbackInfo<v8::Value> const& Arguments);

	typedef struct _SOURCEJS_EXTENSION_FUNCTION {
		char const* m_pszName;
		fnSourceJSExtensionInvoke m_Invoke;
		void* m_pData;
	} SOURCEJS_EXTENSION_FUNCTION, *PSOURCEJS_EXTENSION_FUNCTION;

	// Names and descriptors are borrowed until the next extension callback. The
	// host copies them. Callback addresses and data must stay valid until Unload.
	typedef struct _SOURCEJS_EXTENSION_MODULE {
		char const* m_pszName;
		std::uint32_t m_unFunctionCount;
		SOURCEJS_EXTENSION_FUNCTION const* m_pFunctions;
	} SOURCEJS_EXTENSION_MODULE, *PSOURCEJS_EXTENSION_MODULE;

	using fnSourceJSExtensionGetModuleCount = std::uint32_t(*)();
	using fnSourceJSExtensionGetModule = bool(*)(std::uint32_t unModuleIndex, PSOURCEJS_EXTENSION_MODULE pModuleOut);

	// Calls arrive on the owning game thread; function addresses remain valid while loaded.
	// Load, Unload and binding calls enter the extension's private isolate and context.
	// Neither the isolate nor its handles may be used from another thread or isolate.
	// Unload must reset persistent handles, unregister external callbacks and join work.
	// Do not install V8 process-wide callbacks or keep borrowed handles past a call.
	// The host requires both module callbacks and at least one module.
	typedef struct _SOURCEJS_EXTENSION_API {
		std::uint32_t m_unSize;
		std::uint32_t m_unABIVersion;
		char const* m_pszV8ABI;
		fnSourceJSExtensionGetName m_pGetName;
		fnSourceJSExtensionLoad m_pLoad;
		fnSourceJSExtensionUnload m_pUnload;
		fnSourceJSExtensionGetModuleCount m_pGetModuleCount;
		fnSourceJSExtensionGetModule m_pGetModule;
	} SOURCEJS_EXTENSION_API, *PSOURCEJS_EXTENSION_API;

	// The SourceJS_GetNativeExtensionAPI export must check the version and
	// capacity before writing the record, and report its compiled V8 ABI tag.
	using fnSourceJSGetNativeExtensionAPI = bool(*)(std::uint32_t unRequestedVersion, std::uint32_t unCapacity, PSOURCEJS_EXTENSION_API pAPIOut);
} // namespace SourceJS

#endif // _SOURCEJSPUBLICISOURCEJSEXTENSION_H_
