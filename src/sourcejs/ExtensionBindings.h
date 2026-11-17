#pragma once

#ifndef _SOURCEJSEXTENSIONBINDINGS_H_
#define _SOURCEJSEXTENSIONBINDINGS_H_

// Compatibility profile: canonical reserved include guard (2.5/4.1).

// Third-party
#include "v8.h"

namespace SourceJS {

	class ExtensionManager;
	struct ExtensionNativeModule;

	// The host isolate's functions retain a manager and ID, never a DLL address.
	v8::MaybeLocal<v8::Object> CreateExtensionBindingModule(ExtensionManager& Manager, ExtensionNativeModule const& Module, v8::Isolate* pIsolate, v8::Local<v8::Context> LocalContext);
} // namespace SourceJS

#endif // _SOURCEJSEXTENSIONBINDINGS_H_
