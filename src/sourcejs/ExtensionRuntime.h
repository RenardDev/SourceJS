#pragma once

#ifndef _SOURCEJSEXTENSIONRUNTIME_H_
#define _SOURCEJSEXTENSIONRUNTIME_H_

// Compatibility profile: canonical reserved include guard (2.5/4.1).

// STL
#include <memory>

// Project
#include "sourcejs/public/ISourceJSExtension.h"

namespace v8 {
	class Platform;
}

namespace SourceJS {

	class ExtensionRuntime;

	struct ExtensionRuntimeDeleter {
		void operator()(ExtensionRuntime* pRuntime) const noexcept;
	};

	using ExtensionRuntimeOwner = std::unique_ptr<ExtensionRuntime, ExtensionRuntimeDeleter>;

	// A runtime belongs to one loaded library. Its owner must reset it before
	// releasing that library or shutting down the shared V8 platform.
	ExtensionRuntimeOwner CreateExtensionRuntime(v8::Platform* pPlatform);
	bool StartExtensionRuntime(ExtensionRuntime& Runtime, fnSourceJSExtensionLoad Load, SOURCEJS_EXTENSION_CONTEXT const& Context, bool& bStartedOut);
	bool StopExtensionRuntime(ExtensionRuntime& Runtime, fnSourceJSExtensionUnload Unload);
	bool IsExtensionRuntimeInvoking(ExtensionRuntime const& Runtime) noexcept;

	void InvokeExtensionRuntime(ExtensionRuntime& Runtime, fnSourceJSExtensionInvoke Invoke, void* pData, v8::FunctionCallbackInfo<v8::Value> const& Arguments);
} // namespace SourceJS

#endif // _SOURCEJSEXTENSIONRUNTIME_H_
