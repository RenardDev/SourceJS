#include "sourcejs/ExtensionBindings.h"

// C++
#include <cstdint>

// Project
#include "sourcejs/ExtensionManager.h"

namespace SourceJS {

	namespace {

		constexpr std::uint32_t kManagerIndex = 0;
		constexpr std::uint32_t kBindingIDIndex = 1;

		void InvokeExtensionBinding(v8::FunctionCallbackInfo<v8::Value> const& Arguments) {
			auto* const pIsolate = Arguments.GetIsolate();
			v8::Local<v8::Context> const LocalContext = pIsolate->GetCurrentContext();
			v8::Local<v8::Array> const LocalData = Arguments.Data().As<v8::Array>();
			v8::Local<v8::Value> LocalManager {};
			v8::Local<v8::Value> LocalBindingID {};
			if (!LocalData->Get(LocalContext, kManagerIndex).ToLocal(&LocalManager) || !LocalData->Get(LocalContext, kBindingIDIndex).ToLocal(&LocalBindingID)) {
				return;
			}

			auto* const pManager = static_cast<ExtensionManager*>(LocalManager.As<v8::External>()->Value());
			const std::uint64_t unID = LocalBindingID.As<v8::BigInt>()->Uint64Value();
			ExtensionRuntime* pRuntime = nullptr;
			fnSourceJSExtensionInvoke Handler = nullptr;
			void* pData = nullptr;
			if (!pManager->ResolveNativeBinding(unID, pRuntime, Handler, pData)) {
				v8::Local<v8::String> const LocalMessage = v8::String::NewFromUtf8Literal(pIsolate, "Native extension binding is no longer loaded.");
				pIsolate->ThrowException(v8::Exception::Error(LocalMessage));
				return;
			}

			InvokeExtensionRuntime(*pRuntime, Handler, pData, Arguments);
		}
	} // namespace

	v8::MaybeLocal<v8::Object> CreateExtensionBindingModule(ExtensionManager& Manager, ExtensionNativeModule const& Module, v8::Isolate* const pIsolate, v8::Local<v8::Context> LocalContext) {
		v8::Local<v8::Object> const LocalModule = v8::Object::New(pIsolate);
		v8::Local<v8::External> const LocalManager = v8::External::New(pIsolate, &Manager);
		for (auto const& Binding : Module.m_vecFunctions) {
			v8::Local<v8::String> LocalName {};
			if (!v8::String::NewFromUtf8(pIsolate, Binding.m_strName.c_str()).ToLocal(&LocalName)) {
				return {};
			}

			v8::Local<v8::Value> arrData[] = { LocalManager, v8::BigInt::NewFromUnsigned(pIsolate, Binding.m_unID) };
			v8::Local<v8::Array> const LocalData = v8::Array::New(pIsolate, arrData, sizeof(arrData) / sizeof(arrData[0]));
			v8::Local<v8::Function> LocalFunction {};
			if (!v8::Function::New(LocalContext, InvokeExtensionBinding, LocalData, 0, v8::ConstructorBehavior::kThrow).ToLocal(&LocalFunction)) {
				return {};
			}

			LocalFunction->SetName(LocalName);
			if (!LocalModule->CreateDataProperty(LocalContext, LocalName, LocalFunction).FromMaybe(false)) {
				return {};
			}
		}

		return LocalModule;
	}
} // namespace SourceJS
