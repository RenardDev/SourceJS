#pragma once

#ifndef _SOURCEJSTOOLSEXTENSIONRUNTIMEDOUBLE_H_
#define _SOURCEJSTOOLSEXTENSIONRUNTIMEDOUBLE_H_

// Compatibility profile: canonical reserved include guard (2.5/4.1).

// Project
#include "sourcejs/ExtensionRuntime.h"

// Control for manager-only tests; the isolate test uses the real V8 implementation.
namespace v8 {
	class Platform {};
}

namespace SourceJS {

	class ExtensionRuntime {};

	inline void ExtensionRuntimeDeleter::operator()(ExtensionRuntime* const pRuntime) const noexcept {
		delete pRuntime;
	}

	inline ExtensionRuntimeOwner CreateExtensionRuntime(v8::Platform* const pPlatform) {
		if (!pPlatform) {
			return {};
		}

		return ExtensionRuntimeOwner(new ExtensionRuntime);
	}

	inline bool StartExtensionRuntime(ExtensionRuntime&, fnSourceJSExtensionLoad Load, SOURCEJS_EXTENSION_CONTEXT const& Context, bool& bStartedOut) {
		try {
			bStartedOut = !Load || Load(&Context);
		} catch (...) {
			bStartedOut = true;
			return false;
		}

		return bStartedOut;
	}

	inline bool StopExtensionRuntime(ExtensionRuntime&, fnSourceJSExtensionUnload Unload) {
		try {
			if (Unload) {
				Unload();
			}
		} catch (...) {
			return false;
		}

		return true;
	}

	inline bool IsExtensionRuntimeInvoking(ExtensionRuntime const&) noexcept {
		return false;
	}
} // namespace SourceJS

#endif // _SOURCEJSTOOLSEXTENSIONRUNTIMEDOUBLE_H_
