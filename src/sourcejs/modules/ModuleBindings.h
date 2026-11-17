#pragma once

#ifndef _SOURCEJSMODULESMODULEBINDINGS_H_
#define _SOURCEJSMODULESMODULEBINDINGS_H_

// STL
#include <string>

// V8
#if defined(min)
#pragma push_macro("min")
#undef min
#define SOURCEJS_MODULES_MODULEBINDINGS_RESTORE_MIN
#endif
#if defined(max)
#pragma push_macro("max")
#undef max
#define SOURCEJS_MODULES_MODULEBINDINGS_RESTORE_MAX
#endif
#include <v8.h>
#if defined(SOURCEJS_MODULES_MODULEBINDINGS_RESTORE_MAX)
#pragma pop_macro("max")
#undef SOURCEJS_MODULES_MODULEBINDINGS_RESTORE_MAX
#endif
#if defined(SOURCEJS_MODULES_MODULEBINDINGS_RESTORE_MIN)
#pragma pop_macro("min")
#undef SOURCEJS_MODULES_MODULEBINDINGS_RESTORE_MIN
#endif

// ================================================================
// Module bindings
// ================================================================

// Compatibility profile (4.1): the canonical reserved include guard is intentional.
namespace SourceJS {

	class RuntimePaths;
	class V8Runtime;

	// Game-thread lifecycle/frame APIs; installation requires the entered isolate/context.
	// Installed callbacks borrow Runtime, which must outlive their V8 contexts.
	bool InstallSourceJSModules(V8Runtime& Runtime, RuntimePaths const& Paths, v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object> const LocalSourceJS);
	// An empty plugin name releases runtime-owned resources, including shared native lookups.
	void ReleaseSourceJSExternalResources(std::string const& strPluginName);

	// Call after runtime callbacks have stopped, before disconnecting engine interfaces.
	// Native ConVar objects and their backing strings remain alive until DLL teardown.
	void ClearCreatedConVarRegistrations() noexcept;

	void ClearDelayedEntityInputs();
	void ProcessDelayedEntityInputs();
	void SetSendPropertyGameThread(const bool bActive) noexcept;
#ifndef SOURCEJS_OLD_CONSOLE_API
	int ResolveConCommandDispatchIndex() noexcept;
#endif
} // namespace SourceJS

#endif // _SOURCEJSMODULESMODULEBINDINGS_H_
