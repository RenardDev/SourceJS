#include "sourcejs/V8Runtime.h"

// General
#include "tier1/convar.h"

// C++
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <utility>

// STL
#include <fstream>
#include <limits>
#include <sstream>

// Project
#include "sourcejs/Application.h"
#include "sourcejs/EngineInterfaces.h"
#include "sourcejs/ExtensionBindings.h"
#include "sourcejs/Log.h"
#include "sourcejs/RuntimePaths.h"
#include "sourcejs/SourceJSPlugin.h"
#include "sourcejs/modules/ModuleBindings.h"

// ----------------------------------------------------------------
// V8Runtime
// ----------------------------------------------------------------

namespace SourceJS {

	namespace {

		// Local handles borrow the caller's active V8 handle scope, not the callback registry.
		struct ScriptCallbackSnapshotRecord {
			v8::Local<v8::Context> m_Context;
			v8::Local<v8::Function> m_Function;
		};

		constexpr std::size_t kMaximumConcurrentAsyncRequests = 128;

		// V8 initialization/disposal is process-global and not restartable; game-thread confined.
		constinit bool g_bV8InitializationAttempted = false;

		// SDK command callbacks must not unwind C++ exceptions through the engine.
		template <typename TCallback>
		void InvokeRuntimeCommand(TCallback const& Callback) noexcept {
			try {
				Callback();
			} catch (std::exception const& Exception) {
				LogError("DispatchRuntimeCommand failed Reason=\"%s\"", Exception.what());
			} catch (...) {
				LogError("DispatchRuntimeCommand failed Reason=\"unknown C++ exception\"");
			}
		}

		void DispatchSourceJSRuntimeCommandArguments(std::vector<std::string> const& vecArguments) {
			constexpr std::size_t kCommandNameArgumentIndex = 0;

			if (vecArguments.empty()) {
				return;
			}

			V8Runtime& RuntimeInstance = g_Application.GetRuntime();
			const int nClientIndex = g_SourceJSPlugin.GetCommandClient();
			if (nClientIndex > 0) {
				// Never interpret a client-originated command as server console input.
				RuntimeInstance.DispatchClientCommand(nClientIndex, vecArguments);
				return;
			}

			RuntimeInstance.DispatchCommand(vecArguments[kCommandNameArgumentIndex], vecArguments);
		}

#ifdef SOURCEJS_OLD_CONSOLE_API
		void DispatchSourceJSRuntimeCommand() {
			InvokeRuntimeCommand([]() {
				std::vector<std::string> const vecArguments = g_Application.GetEngineInterfaces().GetCurrentCommandArguments();
				DispatchSourceJSRuntimeCommandArguments(vecArguments);
			});
		}
#else
		void DispatchSourceJSRuntimeCommand(CCommand const& Command) {
			InvokeRuntimeCommand([&Command]() {
				std::vector<std::string> vecArguments {};
				for (int nArgumentIndex = 0; nArgumentIndex < Command.ArgC(); ++nArgumentIndex) {
					char const* const pszArgument = Command.Arg(nArgumentIndex);
					vecArguments.push_back(pszArgument ? pszArgument : "");
				}

				DispatchSourceJSRuntimeCommandArguments(vecArguments);
			});
		}
#endif

		std::string JoinArguments(std::vector<std::string> const& vecArguments, const std::size_t unStartArgumentIndex) {
			std::ostringstream OutputStream {};

			for (std::size_t unArgumentIndex = unStartArgumentIndex; unArgumentIndex < vecArguments.size(); ++unArgumentIndex) {
				if (unArgumentIndex > unStartArgumentIndex) {
					OutputStream << ' ';
				}

				OutputStream << vecArguments[unArgumentIndex];
			}

			return OutputStream.str();
		}

		bool IsValidPackageModuleName(std::string const& strModuleName) {
			if (strModuleName.empty() || (strModuleName[0] == '/') || (strModuleName[0] == '\\')) {
				return false;
			}

			for (std::size_t unCharacterIndex = 0; unCharacterIndex < strModuleName.size(); ++unCharacterIndex) {
				const char chCharacter = strModuleName[unCharacterIndex];
				if ((chCharacter == '\\') || (chCharacter == ':') || (chCharacter == '\0')) {
					return false;
				}
			}

			std::filesystem::path const PathModuleName = strModuleName;
			for (auto const& PathPart : PathModuleName) {
				std::string const strPart = PathPart.string();
				if ((strPart == ".") || (strPart == "..")) {
					return false;
				}
			}

			return true;
		}

		std::vector<std::string> SplitCommandText(std::string const& strText) {
			std::vector<std::string> vecArguments {};
			std::string strArgument {};

			std::istringstream InputStream = std::istringstream(strText);

			while (InputStream >> strArgument) {
				vecArguments.push_back(strArgument);
			}

			return vecArguments;
		}

		bool MakeRuntimeString(v8::Isolate* const pIsolate, std::string const& strValue, v8::Local<v8::String>& LocalValueOut) {
			constexpr std::size_t kMaximumUTF8ByteCount = static_cast<std::size_t>(std::numeric_limits<int>::max());

			if (strValue.size() > kMaximumUTF8ByteCount) {
				return false;
			}

			v8::Local<v8::String> LocalValue {};
			if (!v8::String::NewFromUtf8(pIsolate, strValue.c_str(), v8::NewStringType::kNormal, static_cast<int>(strValue.size())).ToLocal(&LocalValue)) {
				return false;
			}

			LocalValueOut = LocalValue;

			return true;
		}

		void ThrowRuntimeError(v8::Isolate* const pIsolate, std::string const& strMessage) {
			v8::Local<v8::String> LocalMessage {};
			if (!MakeRuntimeString(pIsolate, strMessage, LocalMessage)) {
				return;
			}

			pIsolate->ThrowException(v8::Exception::Error(LocalMessage));
		}

		// Exception handlers must not allocate a native std::string while reporting failure.
		void ThrowRuntimeCallbackException(v8::Isolate* const pIsolate, char const* const pszMessage) noexcept {
			if (!pIsolate || !pszMessage) {
				return;
			}

			try {
				v8::Local<v8::String> LocalMessage {};
				if (!v8::String::NewFromUtf8(pIsolate, pszMessage, v8::NewStringType::kNormal).ToLocal(&LocalMessage)) {
					return;
				}

				pIsolate->ThrowException(v8::Exception::Error(LocalMessage));
			} catch (...) {
				LogError("ThrowRuntimeCallbackException failed Reason=\"C++ exception\"");
			}
		}

		bool IsPathWithin(std::filesystem::path const& PathRoot, std::filesystem::path const& PathCandidate) {
			auto itRoot = PathRoot.begin();
			auto itCandidate = PathCandidate.begin();
			for (; itRoot != PathRoot.end(); ++itRoot, ++itCandidate) {
				if ((itCandidate == PathCandidate.end()) || (*itRoot != *itCandidate)) {
					return false;
				}
			}

			return true;
		}

		void RequirePluginModule(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation, v8::TryCatch const& CallbackFailure) {
			constexpr int kRequiredArgumentCount = 1;
			constexpr int kModuleNameArgumentIndex = 0;
			constexpr std::uint32_t kRuntimeDataIndex = 0;
			constexpr std::uint32_t kGlobalRequireDataIndex = 1;
			constexpr std::uint32_t kParentScriptDataIndex = 2;
			constexpr std::size_t kPrefixOffset = 0;

			auto* const pIsolate = CallbackInformation.GetIsolate();
			v8::Local<v8::Context> const LocalContext = pIsolate->GetCurrentContext();

			if ((CallbackInformation.Length() < kRequiredArgumentCount) || !CallbackInformation[kModuleNameArgumentIndex]->IsString()) {
				ThrowRuntimeError(pIsolate, "require(strModuleName) expects a module name.");
				return;
			}

			if (CallbackInformation.Data().IsEmpty() || !CallbackInformation.Data()->IsArray()) {
				ThrowRuntimeError(pIsolate, "Plugin require context is unavailable.");
				return;
			}

			v8::Local<v8::Array> const LocalCallbackData = CallbackInformation.Data().As<v8::Array>();
			v8::Local<v8::Value> LocalRuntimeValue {};
			v8::Local<v8::Value> LocalGlobalRequireFunction {};
			v8::Local<v8::Value> LocalParentScriptName {};
			if (!LocalCallbackData->Get(LocalContext, kRuntimeDataIndex).ToLocal(&LocalRuntimeValue)) {
				return;
			}

			if (!LocalRuntimeValue->IsExternal()) {
				ThrowRuntimeError(pIsolate, "Plugin require context is invalid.");
				return;
			}

			if (!LocalCallbackData->Get(LocalContext, kGlobalRequireDataIndex).ToLocal(&LocalGlobalRequireFunction)) {
				return;
			}

			if (!LocalGlobalRequireFunction->IsFunction()) {
				ThrowRuntimeError(pIsolate, "Plugin require context is invalid.");
				return;
			}

			if (!LocalCallbackData->Get(LocalContext, kParentScriptDataIndex).ToLocal(&LocalParentScriptName)) {
				return;
			}

			if (!LocalParentScriptName->IsString()) {
				ThrowRuntimeError(pIsolate, "Plugin require context is invalid.");
				return;
			}

			v8::String::Utf8Value const ModuleNameUTF8Value = v8::String::Utf8Value(pIsolate, CallbackInformation[kModuleNameArgumentIndex]);
			v8::String::Utf8Value const ParentScriptNameUTF8Value = v8::String::Utf8Value(pIsolate, LocalParentScriptName);
			if (!*ModuleNameUTF8Value || !*ParentScriptNameUTF8Value) {
				ThrowRuntimeError(pIsolate, "Plugin require could not read a module name.");
				return;
			}

			std::string const strModuleName = std::string(*ModuleNameUTF8Value, static_cast<std::size_t>(ModuleNameUTF8Value.length()));
			if (strModuleName.find('\0') != std::string::npos) {
				ThrowRuntimeError(pIsolate, "Plugin require module name contains a null byte.");
				return;
			}

			if (strModuleName.rfind("../", kPrefixOffset) == kPrefixOffset) {
				ThrowRuntimeError(pIsolate, "Parent-relative require is not supported. Use ./ inside the plugin root or an absolute SourceJS module name.");
				return;
			}

			if (strModuleName.rfind("./", kPrefixOffset) == kPrefixOffset) {
				auto* const pRuntime = static_cast<V8Runtime*>(LocalRuntimeValue.As<v8::External>()->Value());
				v8::Local<v8::Value> LocalModule {};
				const bool bLoaded = pRuntime && pRuntime->RequirePluginLocalModule(std::string(*ParentScriptNameUTF8Value, static_cast<std::size_t>(ParentScriptNameUTF8Value.length())), strModuleName, LocalModule);
				if (CallbackFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()) {
					return;
				}

				if (!bLoaded) {
					ThrowRuntimeError(pIsolate, "Plugin-local module could not be loaded: " + strModuleName);
					return;
				}

				CallbackInformation.GetReturnValue().Set(LocalModule);
				return;
			}

			v8::Local<v8::Value> LocalCallbackArgument = CallbackInformation[kModuleNameArgumentIndex];
			v8::Local<v8::Value> LocalResult {};
			if (!LocalGlobalRequireFunction.As<v8::Function>()->Call(LocalContext, LocalContext->Global(), kRequiredArgumentCount, &LocalCallbackArgument).ToLocal(&LocalResult)) {
				return;
			}

			CallbackInformation.GetReturnValue().Set(LocalResult);
		}

		void RequirePluginModuleCallback(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation) {
			auto* const pIsolate = CallbackInformation.GetIsolate();
			v8::TryCatch CallbackFailure(pIsolate);
			bool bNativeFailure = false;
			try {
				RequirePluginModule(CallbackInformation, CallbackFailure);
			} catch (std::exception const& Exception) {
				LogError("RequirePluginModule failed Reason=\"%s\"", Exception.what());
				bNativeFailure = true;
			} catch (...) {
				LogError("RequirePluginModule failed Reason=\"unknown C++ exception\"");
				bNativeFailure = true;
			}

			// Do not replace an existing exception or resume a terminating isolate.
			if (bNativeFailure && !CallbackFailure.HasCaught() && !pIsolate->IsExecutionTerminating() && !pIsolate->HasPendingException()) {
				pIsolate->ThrowError("Plugin require failed due to a native error.");
			}

			if (CallbackFailure.HasCaught()) {
				CallbackFailure.ReThrow();
			}
		}

		bool MakePluginRequire(V8Runtime* const pRuntime, v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalGlobalRequireFunction, std::string const& strParentScriptName, v8::Local<v8::Value>& LocalRequireFunctionOut) {
			constexpr int kCallbackDataLength = 3;
			constexpr std::uint32_t kRuntimeDataIndex = 0;
			constexpr std::uint32_t kGlobalRequireDataIndex = 1;
			constexpr std::uint32_t kParentScriptDataIndex = 2;

			if (!pRuntime || !pIsolate || LocalContext.IsEmpty() || LocalGlobalRequireFunction.IsEmpty() || !LocalGlobalRequireFunction->IsFunction()) {
				return false;
			}

			v8::Local<v8::Array> const LocalCallbackData = v8::Array::New(pIsolate, kCallbackDataLength);
			v8::Local<v8::String> LocalParentScriptName {};
			if (LocalCallbackData.IsEmpty()) {
				return false;
			}

			if (!MakeRuntimeString(pIsolate, strParentScriptName, LocalParentScriptName)) {
				return false;
			}

			// Private callback data must not invoke inherited array-index setters.
			if (!LocalCallbackData->CreateDataProperty(LocalContext, kRuntimeDataIndex, v8::External::New(pIsolate, pRuntime)).FromMaybe(false)) {
				return false;
			}

			if (!LocalCallbackData->CreateDataProperty(LocalContext, kGlobalRequireDataIndex, LocalGlobalRequireFunction).FromMaybe(false)) {
				return false;
			}

			if (!LocalCallbackData->CreateDataProperty(LocalContext, kParentScriptDataIndex, LocalParentScriptName).FromMaybe(false)) {
				return false;
			}

			v8::Local<v8::Function> LocalRequireFunction {};
			if (!v8::Function::New(LocalContext, RequirePluginModuleCallback, LocalCallbackData).ToLocal(&LocalRequireFunction)) {
				return false;
			}

			LocalRequireFunctionOut = LocalRequireFunction;

			return true;
		}

		bool RequireGameEventKeyArgument(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation, const int nArgumentIndex, char const* const pszOperation, std::string& strValueOut) {
			auto* const pIsolate = CallbackInformation.GetIsolate();
			if (!pIsolate || (nArgumentIndex < 0) || !pszOperation || !*pszOperation) {
				return false;
			}

			if ((CallbackInformation.Length() <= nArgumentIndex) || !CallbackInformation[nArgumentIndex]->IsString()) {
				ThrowRuntimeError(pIsolate, std::string(pszOperation) + " expects a non-empty string key.");
				return false;
			}

			v8::String::Utf8Value const KeyUTF8Value = v8::String::Utf8Value(pIsolate, CallbackInformation[nArgumentIndex]);
			if (!*KeyUTF8Value || !**KeyUTF8Value) {
				ThrowRuntimeError(pIsolate, std::string(pszOperation) + " expects a non-empty string key.");
				return false;
			}

			std::string strKey = std::string(*KeyUTF8Value, static_cast<std::size_t>(KeyUTF8Value.length()));
			if (strKey.find('\0') != std::string::npos) {
				ThrowRuntimeError(pIsolate, std::string(pszOperation) + " does not accept an embedded NUL in a key.");
				return false;
			}

			strValueOut = std::move(strKey);

			return true;
		}

		bool RequireGameEventStringArgument(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation, const int nArgumentIndex, char const* const pszOperation, std::string& strValueOut) {
			auto* const pIsolate = CallbackInformation.GetIsolate();
			if (!pIsolate || (nArgumentIndex < 0) || !pszOperation || !*pszOperation) {
				return false;
			}

			if ((CallbackInformation.Length() <= nArgumentIndex) || !CallbackInformation[nArgumentIndex]->IsString()) {
				ThrowRuntimeError(pIsolate, std::string(pszOperation) + " expects a string value.");
				return false;
			}

			v8::String::Utf8Value const StringArgumentUTF8Value = v8::String::Utf8Value(pIsolate, CallbackInformation[nArgumentIndex]);
			if (!*StringArgumentUTF8Value) {
				ThrowRuntimeError(pIsolate, std::string(pszOperation) + " could not read the string value.");
				return false;
			}

			std::string strValue = std::string(*StringArgumentUTF8Value, static_cast<std::size_t>(StringArgumentUTF8Value.length()));
			if (strValue.find('\0') != std::string::npos) {
				ThrowRuntimeError(pIsolate, std::string(pszOperation) + " does not accept an embedded NUL in a string value.");
				return false;
			}

			strValueOut = std::move(strValue);

			return true;
		}

		bool RequireGameEventUInt64Argument(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation, const int nArgumentIndex, char const* const pszOperation, std::uint64_t& unValueOut) {
			auto* const pIsolate = CallbackInformation.GetIsolate();
			if (!pIsolate || (nArgumentIndex < 0) || !pszOperation || !*pszOperation) {
				return false;
			}

			if (CallbackInformation.Length() <= nArgumentIndex) {
				ThrowRuntimeError(pIsolate, std::string(pszOperation) + " expects an unsigned 64-bit BigInt value.");
				return false;
			}

			v8::Local<v8::Value> const LocalArgumentValue = CallbackInformation[nArgumentIndex];
			if (LocalArgumentValue.IsEmpty() || !LocalArgumentValue->IsBigInt()) {
				ThrowRuntimeError(pIsolate, std::string(pszOperation) + " expects an unsigned 64-bit BigInt value.");
				return false;
			}

			bool bIsLossless = false;
			const std::uint64_t unBigIntValue = LocalArgumentValue.As<v8::BigInt>()->Uint64Value(&bIsLossless);
			if (!bIsLossless) {
				ThrowRuntimeError(pIsolate, std::string(pszOperation) + " expects an unsigned 64-bit BigInt value.");
				return false;
			}

			unValueOut = unBigIntValue;

			return true;
		}

		bool SetPayloadString(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object> const LocalObject, char const* const pszPropertyName, std::string const& strValue) {
			if (!pIsolate || LocalContext.IsEmpty() || LocalObject.IsEmpty() || !pszPropertyName || !*pszPropertyName) {
				return false;
			}

			v8::Local<v8::String> LocalPropertyName {};
			v8::Local<v8::String> LocalStringValue {};
			if (!v8::String::NewFromUtf8(pIsolate, pszPropertyName, v8::NewStringType::kNormal).ToLocal(&LocalPropertyName)) {
				return false;
			}

			if (!v8::String::NewFromUtf8(pIsolate, strValue.c_str(), v8::NewStringType::kNormal).ToLocal(&LocalStringValue)) {
				return false;
			}

			return LocalObject->CreateDataProperty(LocalContext, LocalPropertyName, LocalStringValue).FromMaybe(false);
		}

		bool GetRuntimeObjectBoolean(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object> const LocalObject, char const* const pszPropertyName, bool& bValueOut) {
			if (!pIsolate || LocalContext.IsEmpty() || LocalObject.IsEmpty() || !pszPropertyName || !*pszPropertyName) {
				return false;
			}

			v8::Local<v8::String> LocalPropertyName {};
			if (!MakeRuntimeString(pIsolate, pszPropertyName, LocalPropertyName)) {
				return false;
			}

			v8::Local<v8::Value> LocalPropertyValue {};
			if (!LocalObject->Get(LocalContext, LocalPropertyName).ToLocal(&LocalPropertyValue) || !LocalPropertyValue->IsBoolean()) {
				return false;
			}

			bValueOut = LocalPropertyValue.As<v8::Boolean>()->Value();

			return true;
		}

		bool GetRuntimeObjectString(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object> const LocalObject, char const* const pszPropertyName, std::string& strValueOut) {
			if (!pIsolate || LocalContext.IsEmpty() || LocalObject.IsEmpty() || !pszPropertyName || !*pszPropertyName) {
				return false;
			}

			v8::Local<v8::String> LocalPropertyName {};
			if (!MakeRuntimeString(pIsolate, pszPropertyName, LocalPropertyName)) {
				return false;
			}

			v8::Local<v8::Value> LocalPropertyValue {};
			if (!LocalObject->Get(LocalContext, LocalPropertyName).ToLocal(&LocalPropertyValue)) {
				return false;
			}

			if (LocalPropertyValue->IsNullOrUndefined() || LocalPropertyValue->IsFunction()) {
				return false;
			}

			v8::String::Utf8Value const PropertyValueUTF8Value = v8::String::Utf8Value(pIsolate, LocalPropertyValue);
			if (!*PropertyValueUTF8Value) {
				return false;
			}

			strValueOut = *PropertyValueUTF8Value;

			return true;
		}

		bool SetPayloadInteger(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object> const LocalObject, char const* const pszPropertyName, const int nValue) {
			if (!pIsolate || LocalContext.IsEmpty() || LocalObject.IsEmpty() || !pszPropertyName || !*pszPropertyName) {
				return false;
			}

			v8::Local<v8::String> LocalPropertyName {};
			if (!v8::String::NewFromUtf8(pIsolate, pszPropertyName, v8::NewStringType::kNormal).ToLocal(&LocalPropertyName)) {
				return false;
			}

			return LocalObject->CreateDataProperty(LocalContext, LocalPropertyName, v8::Integer::New(pIsolate, nValue)).FromMaybe(false);
		}

		bool SetPayloadBoolean(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object> const LocalObject, char const* const pszPropertyName, const bool bValue) {
			if (!pIsolate || LocalContext.IsEmpty() || LocalObject.IsEmpty() || !pszPropertyName || !*pszPropertyName) {
				return false;
			}

			v8::Local<v8::String> LocalPropertyName {};
			if (!v8::String::NewFromUtf8(pIsolate, pszPropertyName, v8::NewStringType::kNormal).ToLocal(&LocalPropertyName)) {
				return false;
			}

			return LocalObject->CreateDataProperty(LocalContext, LocalPropertyName, v8::Boolean::New(pIsolate, bValue)).FromMaybe(false);
		}

		v8::Local<v8::Array> MakePayloadArguments(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, std::vector<std::string> const& vecArguments) {
			if (!pIsolate || LocalContext.IsEmpty() || (vecArguments.size() > static_cast<std::size_t>(std::numeric_limits<int>::max()))) {
				return {};
			}

			v8::Local<v8::Array> const LocalArgumentArray = v8::Array::New(pIsolate, static_cast<int>(vecArguments.size()));
			if (LocalArgumentArray.IsEmpty()) {
				return {};
			}

			for (std::size_t unArgumentIndex = 0; unArgumentIndex < vecArguments.size(); ++unArgumentIndex) {
				v8::Local<v8::String> LocalArgumentString {};
				if (!v8::String::NewFromUtf8(pIsolate, vecArguments[unArgumentIndex].c_str(), v8::NewStringType::kNormal).ToLocal(&LocalArgumentString)) {
					return {};
				}

				if (!LocalArgumentArray->CreateDataProperty(LocalContext, static_cast<std::uint32_t>(unArgumentIndex), LocalArgumentString).FromMaybe(false)) {
					return {};
				}
			}

			return LocalArgumentArray;
		}

		bool SetPayloadArguments(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object> const LocalObject, std::vector<std::string> const& vecArguments) {
			constexpr char const* const kArgumentsPropertyName = "Arguments";

			if (!pIsolate || LocalContext.IsEmpty() || LocalObject.IsEmpty()) {
				return false;
			}

			v8::Local<v8::String> LocalPropertyName {};
			if (!v8::String::NewFromUtf8(pIsolate, kArgumentsPropertyName, v8::NewStringType::kNormal).ToLocal(&LocalPropertyName)) {
				return false;
			}

			v8::Local<v8::Array> const LocalArgumentArray = MakePayloadArguments(pIsolate, LocalContext, vecArguments);
			if (LocalArgumentArray.IsEmpty()) {
				return false;
			}

			return LocalObject->CreateDataProperty(LocalContext, LocalPropertyName, LocalArgumentArray).FromMaybe(false);
		}

		bool DoesCommandResultBlock(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalResultValue) {
			constexpr int kContinueCommandResult = 0;
			constexpr int kBlockCommandResult = 1;

			if (!pIsolate || LocalContext.IsEmpty() || LocalResultValue.IsEmpty() || LocalResultValue->IsUndefined() || LocalResultValue->IsNull()) {
				return false;
			}

			if (LocalResultValue->IsBoolean()) {
				return !LocalResultValue->BooleanValue(pIsolate);
			}

			if (LocalResultValue->IsInt32()) {
				return LocalResultValue->Int32Value(LocalContext).FromMaybe(kContinueCommandResult) == kBlockCommandResult;
			}

			return false;
		}

		bool DoesStoredFunctionBelongToContext(v8::Isolate* const pIsolate, ScriptCallbackRecord const& CallbackRecord, v8::Local<v8::Context> const LocalContext) {
			return pIsolate && !LocalContext.IsEmpty() && !CallbackRecord.m_Context.IsEmpty() && (CallbackRecord.m_Context.Get(pIsolate) == LocalContext);
		}

		void ResetStoredFunction(ScriptCallbackRecord& CallbackRecord) {
			CallbackRecord.m_Function.Reset();
			CallbackRecord.m_Context.Reset();
		}

		void ResetStoredFunctions(std::vector<ScriptCallbackRecord>& vecCallbacks) {
			for (std::size_t unCallbackIndex = 0; unCallbackIndex < vecCallbacks.size(); ++unCallbackIndex) {
				ResetStoredFunction(vecCallbacks[unCallbackIndex]);
			}

			vecCallbacks.clear();
		}

		void RemoveStoredFunctionsForContext(v8::Isolate* const pIsolate, std::vector<ScriptCallbackRecord>& vecCallbacks, v8::Local<v8::Context> const LocalContext) {
			if (!pIsolate || LocalContext.IsEmpty()) {
				return;
			}

			std::size_t unCallbackIndex = 0;
			while (unCallbackIndex < vecCallbacks.size()) {
				if (!DoesStoredFunctionBelongToContext(pIsolate, vecCallbacks[unCallbackIndex], LocalContext)) {
					++unCallbackIndex;
					continue;
				}

				ResetStoredFunction(vecCallbacks[unCallbackIndex]);
				vecCallbacks.erase(vecCallbacks.begin() + static_cast<std::ptrdiff_t>(unCallbackIndex));
			}
		}

		bool AddStoredFunction(v8::Isolate* const pIsolate, std::vector<ScriptCallbackRecord>& vecCallbacks, v8::Local<v8::Function> const LocalCallbackFunction) {
			if (!pIsolate || LocalCallbackFunction.IsEmpty()) {
				return false;
			}

			v8::Local<v8::Context> const LocalContext = pIsolate->GetCurrentContext();
			if (LocalContext.IsEmpty()) {
				return false;
			}

			ScriptCallbackRecord CallbackRecord {};
			CallbackRecord.m_Context.Reset(pIsolate, LocalContext);
			CallbackRecord.m_Function.Reset(pIsolate, LocalCallbackFunction);
			vecCallbacks.push_back(std::move(CallbackRecord));

			return true;
		}

		std::vector<ScriptCallbackSnapshotRecord> SnapshotStoredFunctions(v8::Isolate* const pIsolate, std::vector<ScriptCallbackRecord> const& vecCallbacks) {
			std::vector<ScriptCallbackSnapshotRecord> vecSnapshot {};
			vecSnapshot.reserve(vecCallbacks.size());

			for (auto const& CallbackRecord : vecCallbacks) {
				vecSnapshot.push_back({ CallbackRecord.m_Context.Get(pIsolate), CallbackRecord.m_Function.Get(pIsolate) });
			}

			return vecSnapshot;
		}

		bool RemoveStoredFunction(v8::Isolate* const pIsolate, std::vector<ScriptCallbackRecord>& vecCallbacks, v8::Local<v8::Function> const LocalCallbackFunction) {
			if (!pIsolate || LocalCallbackFunction.IsEmpty()) {
				return false;
			}

			v8::Local<v8::Context> const LocalContext = pIsolate->GetCurrentContext();
			if (LocalContext.IsEmpty()) {
				return false;
			}

			for (std::size_t unCallbackIndex = 0; unCallbackIndex < vecCallbacks.size(); ++unCallbackIndex) {
				if (!DoesStoredFunctionBelongToContext(pIsolate, vecCallbacks[unCallbackIndex], LocalContext)) {
					continue;
				}

				v8::Local<v8::Function> const LocalStoredFunction = vecCallbacks[unCallbackIndex].m_Function.Get(pIsolate);
				if (!LocalStoredFunction.IsEmpty() && LocalStoredFunction->StrictEquals(LocalCallbackFunction)) {
					ResetStoredFunction(vecCallbacks[unCallbackIndex]);
					vecCallbacks.erase(vecCallbacks.begin() + static_cast<std::ptrdiff_t>(unCallbackIndex));
					return true;
				}
			}

			return false;
		}

		bool CallCommandCallback(v8::Isolate* const pIsolate, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Function> const LocalCallbackFunction, char const* const pszCommandKind, std::string const& strCommandName, std::string const& strRawInput, const int nClientIndex, std::vector<std::string> const& vecArguments, std::string const* const pMessageText, bool const* const pbTeamOnly, bool& bBlocksCommandOut) {
			constexpr int kCallbackArgumentCount = 1;

			if (!pIsolate || !pszCommandKind || !*pszCommandKind || LocalContext.IsEmpty() || LocalCallbackFunction.IsEmpty()) {
				return false;
			}

			v8::Context::Scope ContextScope(LocalContext);
			v8::Local<v8::Object> const LocalPayload = v8::Object::New(pIsolate);
			if (LocalPayload.IsEmpty()) {
				return false;
			}

			if (!SetPayloadString(pIsolate, LocalContext, LocalPayload, "Kind", pszCommandKind)) {
				return false;
			}

			if (!SetPayloadString(pIsolate, LocalContext, LocalPayload, "Name", strCommandName)) {
				return false;
			}

			if (!SetPayloadString(pIsolate, LocalContext, LocalPayload, "Raw", strRawInput)) {
				return false;
			}

			if (!SetPayloadInteger(pIsolate, LocalContext, LocalPayload, "Index", nClientIndex)) {
				return false;
			}

			if (!SetPayloadArguments(pIsolate, LocalContext, LocalPayload, vecArguments)) {
				return false;
			}

			if (pMessageText) {
				if (!SetPayloadString(pIsolate, LocalContext, LocalPayload, "Message", *pMessageText)) {
					return false;
				}

				if (!SetPayloadString(pIsolate, LocalContext, LocalPayload, "Text", *pMessageText)) {
					return false;
				}
			}

			if (pbTeamOnly && !SetPayloadBoolean(pIsolate, LocalContext, LocalPayload, "TeamOnly", *pbTeamOnly)) {
				return false;
			}

			v8::Local<v8::Value> arrCallbackArguments[kCallbackArgumentCount] = { LocalPayload };
			v8::Local<v8::Value> LocalCallbackResult {};
			if (!LocalCallbackFunction->Call(LocalContext, LocalContext->Global(), kCallbackArgumentCount, arrCallbackArguments).ToLocal(&LocalCallbackResult)) {
				return false;
			}

			bBlocksCommandOut = DoesCommandResultBlock(pIsolate, LocalContext, LocalCallbackResult);

			return true;
		}
	} // namespace

	AsyncRequestRecord::AsyncRequestRecord() {
		m_unID = 0;
		m_pNextCompletion = nullptr;
		m_bResultReady.store(false);
		m_bResultConsumed.store(false);
		m_bCleanupComplete.store(false);
	}

	V8Runtime::V8Runtime() {
		m_pRuntimePaths = nullptr;
		m_pIsolate = nullptr;
		m_unNextAsyncRequestID = 0;
		m_pFirstAsyncCompletion = nullptr;
		m_pLastAsyncCompletion = nullptr;
		m_bAcceptAsyncRequests = false;
		m_unNextGameEventToken = 0;
		m_bInitialized = false;
	}

	V8Runtime::~V8Runtime() {
		try {
			Shutdown();
		} catch (std::exception const& Exception) {
			LogError("V8Runtime destruction failed: shutdown exception: %s", Exception.what());
			std::terminate();
		} catch (...) {
			LogError("V8Runtime destruction failed: unknown shutdown exception.");
			std::terminate();
		}
	}

	bool V8Runtime::Initialize(RuntimePaths const& RuntimePathConfiguration) {
		if (m_bInitialized) {
			return true;
		}

		if (g_bV8InitializationAttempted) {
			LogError("V8Runtime.Initialize failed: V8 cannot be restarted; restart the server process.");
			return false;
		}

		bool bPlatformInitialized = false;
		bool bV8Initialized = false;
		auto ResetInitialization = [this, &bPlatformInitialized, &bV8Initialized]() {
			// Teardown is valid only for completed V8 stages, after local scopes unwind.
			m_V8Context.Reset();
			m_SourceJSObject.Reset();
			if (m_pIsolate) {
				v8::platform::NotifyIsolateShutdown(m_pPlatform.get(), m_pIsolate);
				m_pIsolate->Dispose();
				m_pIsolate = nullptr;
			}

			if (bV8Initialized && !v8::V8::Dispose()) {
				LogError("V8Runtime.Initialize rollback failed: V8 disposal failed.");
				std::terminate();
			}

			if (bPlatformInitialized) {
				v8::V8::DisposePlatform();
			}

			m_pArrayBufferAllocator.reset();
			m_pPlatform.reset();
			m_pRuntimePaths = nullptr;
			m_bInitialized = false;
		};

		m_pRuntimePaths = &RuntimePathConfiguration;
		try {
			if (!v8::V8::InitializeICUDefaultLocation(nullptr)) {
				LogError("V8Runtime.Initialize failed: ICU data initialization failed.");
				ResetInitialization();
				return false;
			}

			v8::V8::InitializeExternalStartupData(nullptr);
			m_pPlatform = v8::platform::NewDefaultPlatform();
			if (!m_pPlatform) {
				LogError("V8Runtime.Initialize failed: platform creation failed.");
				ResetInitialization();
				return false;
			}

			v8::V8::InitializePlatform(m_pPlatform.get());
			bPlatformInitialized = true;

			g_bV8InitializationAttempted = true;
			if (!v8::V8::Initialize()) {
				LogError("V8Runtime.Initialize failed: V8 initialization failed.");
				ResetInitialization();
				return false;
			}

			bV8Initialized = true;

			m_pArrayBufferAllocator.reset(v8::ArrayBuffer::Allocator::NewDefaultAllocator());
			if (!m_pArrayBufferAllocator) {
				LogError("V8Runtime.Initialize failed: array buffer allocator creation failed.");
				ResetInitialization();
				return false;
			}

			v8::Isolate::CreateParams IsolateCreateParameters {};
			IsolateCreateParameters.array_buffer_allocator = m_pArrayBufferAllocator.get();
			m_pIsolate = v8::Isolate::New(IsolateCreateParameters);
			if (!m_pIsolate) {
				LogError("V8Runtime.Initialize failed: isolate creation failed.");
				ResetInitialization();
				return false;
			}

			bool bRuntimeObjectsInstalled = false;

			{
				v8::Isolate::Scope IsolateScope(m_pIsolate);
				v8::HandleScope HandleScope(m_pIsolate);
				v8::Local<v8::Context> const LocalContext = v8::Context::New(m_pIsolate);
				if (!LocalContext.IsEmpty()) {
					v8::Context::Scope ContextScope(LocalContext);
					v8::Local<v8::Object> LocalSourceJSObject {};
					if (InstallRuntimeObjects(LocalContext, LocalSourceJSObject)) {
						m_V8Context.Reset(m_pIsolate, LocalContext);
						m_SourceJSObject.Reset(m_pIsolate, LocalSourceJSObject);
						bRuntimeObjectsInstalled = true;
					}
				}
			}

			if (!bRuntimeObjectsInstalled) {
				LogError("V8Runtime.Initialize failed: runtime object installation failed.");
				ResetInitialization();
				return false;
			}

			{
				std::lock_guard<std::mutex> Lock(m_AsyncRequestMutex);
				m_bAcceptAsyncRequests = true;
			}

			m_bInitialized = true;
			LogInfo("V8Runtime.Initialize completed.");

			return true;
		} catch (std::exception const& Exception) {
			LogError("V8Runtime.Initialize failed: C++ exception: %s", Exception.what());
		} catch (...) {
			LogError("V8Runtime.Initialize failed: unknown C++ exception.");
		}

		ResetInitialization();

		return false;
	}

	void V8Runtime::Shutdown() {
		if (!m_bInitialized) {
			return;
		}

		std::vector<std::string> vecPluginNames {};
		for (auto itPluginRuntime = m_mapPluginRuntimes.begin(); itPluginRuntime != m_mapPluginRuntimes.end(); ++itPluginRuntime) {
			vecPluginNames.push_back(itPluginRuntime->first);
		}

		for (std::size_t unPluginIndex = 0; unPluginIndex < vecPluginNames.size(); ++unPluginIndex) {
			UnloadPlugin(vecPluginNames[unPluginIndex]);
		}

		{
			v8::Isolate::Scope IsolateScope(m_pIsolate);
			v8::HandleScope HandleScope(m_pIsolate);
			v8::Local<v8::Context> const LocalContext = m_V8Context.Get(m_pIsolate);
			RemoveCallbacksForContext(LocalContext);
		}

		ReleaseSourceJSExternalResources("");
		UnregisterAllCommands();
		StopAsyncRequests();

		auto* const pGameEventManager = g_Application.GetEngineInterfaces().GetGameEventManager();
		if (pGameEventManager) {
			pGameEventManager->RemoveListener(this);
		}

		for (auto itModuleCache = m_mapPackageModuleCache.begin(); itModuleCache != m_mapPackageModuleCache.end(); ++itModuleCache) {
			itModuleCache->second.Reset();
		}

		m_mapPackageModuleCache.clear();
		m_mapPluginRuntimes.clear();
		m_mapEventCallbacks.clear();
		m_mapGameEventCallbacks.clear();
		m_mapActiveGameEvents.clear();
		m_mapCommandCallbacks.clear();
		m_mapClientCommandCallbacks.clear();
		m_mapSayCommandCallbacks.clear();
		ResetStoredFunctions(m_vecClientCommandFilters);
		ResetStoredFunctions(m_vecEarlySayCommandFilters);
		ResetStoredFunctions(m_vecSayCommandFilters);
		m_SourceJSObject.Reset();
		m_V8Context.Reset();

		if (m_pIsolate) {
			v8::platform::NotifyIsolateShutdown(m_pPlatform.get(), m_pIsolate);
			m_pIsolate->Dispose();
			m_pIsolate = nullptr;
		}

		// Failure leaves V8 utility threads/platform lifetime unproven; do not destroy their owner.
		if (!v8::V8::Dispose()) {
			LogError("V8Runtime.Shutdown failed: V8 disposal failed.");
			std::terminate();
		}

		v8::V8::DisposePlatform();

		m_pArrayBufferAllocator.reset();
		m_pPlatform.reset();
		m_pRuntimePaths = nullptr;
		m_bInitialized = false;

		LogInfo("V8 runtime shut down.");
	}

	bool V8Runtime::ExecuteFile(std::filesystem::path const& PathScript, std::string const& strScriptName) {
		std::string strSource {};
		if (!ReadFile(PathScript, strSource)) {
			LogError("ExecuteFile failed Path=\"%s\" Reason=\"Could not read script file\"", PathScript.string().c_str());
			return false;
		}

		return ExecuteString(strSource, strScriptName);
	}

	bool V8Runtime::ExecutePluginFile(std::filesystem::path const& PathScript, std::string const& strPluginName) {
		if (!m_bInitialized || !m_pIsolate || strPluginName.empty() || (m_mapPluginRuntimes.find(strPluginName) != m_mapPluginRuntimes.end())) {
			return false;
		}

		std::string strSource {};
		if (!ReadFile(PathScript, strSource)) {
			LogError("ExecutePluginFile failed Path=\"%s\" Reason=\"Could not read plugin file\"", PathScript.string().c_str());
			return false;
		}

		v8::Isolate::Scope IsolateScope(m_pIsolate);
		v8::HandleScope HandleScope(m_pIsolate);
		v8::Local<v8::Context> const LocalContext = v8::Context::New(m_pIsolate);
		if (LocalContext.IsEmpty()) {
			return false;
		}

		v8::Context::Scope ContextScope(LocalContext);
		v8::Local<v8::Object> LocalSourceJSObject {};
		if (!InstallRuntimeObjects(LocalContext, LocalSourceJSObject)) {
			return false;
		}

		PluginRuntimeRecord NewPluginRuntimeRecord {};
		NewPluginRuntimeRecord.m_Context.Reset(m_pIsolate, LocalContext);
		NewPluginRuntimeRecord.m_SourceJSObject.Reset(m_pIsolate, LocalSourceJSObject);

		std::pair<std::map<std::string, PluginRuntimeRecord>::iterator, bool> const PluginRuntimeInsertResult = m_mapPluginRuntimes.insert(std::make_pair(strPluginName, std::move(NewPluginRuntimeRecord)));
		if (!PluginRuntimeInsertResult.second) {
			return false;
		}

		PluginRuntimeRecord& StoredPluginRuntimeRecord = PluginRuntimeInsertResult.first->second;
		bool bLoaded = false;
		try {
			bLoaded = ExecuteCommonJS(strSource, PathScript.string(), StoredPluginRuntimeRecord.m_Context, &StoredPluginRuntimeRecord.m_Exports) && CallPluginExportFunction(strPluginName, "Load");
		} catch (...) {
			try {
				UnloadPlugin(strPluginName);
			} catch (...) {
				LogError("ExecutePluginFile rollback failed Plugin=\"%s\" Reason=\"Plugin unload raised a C++ exception\"", strPluginName.c_str());
			}

			throw;
		}

		if (!bLoaded) {
			UnloadPlugin(strPluginName);
			return false;
		}

		return true;
	}

	bool V8Runtime::ExecuteString(std::string const& strSource, std::string const& strScriptName) {
		return ExecuteCommonJS(strSource, strScriptName, m_V8Context, nullptr);
	}

	void V8Runtime::DispatchAuthenticationCommand(std::vector<std::string> const& vecArguments) {
		constexpr char kModuleName[] = "core/command/auth";
		constexpr char kExportName[] = "DispatchAuthenticationCommand";
		constexpr int kArgumentCount = 1;

		if (!m_bInitialized || !m_pIsolate || m_V8Context.IsEmpty()) {
			LogWarning("DispatchAuthenticationCommand failed: V8 context is unavailable.");
			return;
		}

		v8::Isolate::Scope IsolateScope(m_pIsolate);
		v8::HandleScope HandleScope(m_pIsolate);
		v8::Local<v8::Context> const LocalContext = m_V8Context.Get(m_pIsolate);
		v8::Context::Scope ContextScope(LocalContext);
		v8::TryCatch CommandFailure(m_pIsolate);

		v8::Local<v8::Value> LocalModule {};
		if (!RequirePackageModule(kModuleName, LocalModule) || LocalModule.IsEmpty() || !LocalModule->IsObject()) {
			LogError("DispatchAuthenticationCommand failed Stage=Require: %s", FormatException(CommandFailure).c_str());
			return;
		}

		v8::Local<v8::Object> const LocalExports = LocalModule.As<v8::Object>();
		v8::Local<v8::String> LocalExportName {};
		v8::Local<v8::Value> LocalFunction {};
		if (!MakeRuntimeString(m_pIsolate, kExportName, LocalExportName) || !LocalExports->Get(LocalContext, LocalExportName).ToLocal(&LocalFunction) || !LocalFunction->IsFunction()) {
			LogError("DispatchAuthenticationCommand failed: required export is unavailable.");
			return;
		}

		// Engine-tokenized arguments are V8 values, never generated JavaScript source.
		v8::Local<v8::Value> LocalArguments = MakePayloadArguments(m_pIsolate, LocalContext, vecArguments);
		v8::Local<v8::Value> LocalResult {};
		if (LocalArguments.IsEmpty() || !LocalFunction.As<v8::Function>()->Call(LocalContext, LocalExports, kArgumentCount, &LocalArguments).ToLocal(&LocalResult)) {
			LogError("DispatchAuthenticationCommand failed Stage=Call: %s", FormatException(CommandFailure).c_str());
		}
	}

	void V8Runtime::UnloadPlugin(std::string const& strPluginName) {
		if (!m_bInitialized || !m_pIsolate || strPluginName.empty()) {
			return;
		}

		auto itPluginRuntime = m_mapPluginRuntimes.find(strPluginName);
		if ((itPluginRuntime == m_mapPluginRuntimes.end()) || itPluginRuntime->second.m_bUnloading) {
			return;
		}

		itPluginRuntime->second.m_bUnloading = true;
		try {
			// Cleanup continues even when the plugin's unload export reports failure.
			CallPluginExportFunction(strPluginName, "Unload");

			// A callback may mutate the registry; never reuse its pre-callback iterator.
			itPluginRuntime = m_mapPluginRuntimes.find(strPluginName);
			if (!m_bInitialized || !m_pIsolate || (itPluginRuntime == m_mapPluginRuntimes.end()) || !itPluginRuntime->second.m_bUnloading) {
				return;
			}

			v8::Isolate::Scope IsolateScope(m_pIsolate);
			v8::HandleScope HandleScope(m_pIsolate);
			v8::Local<v8::Context> const LocalContext = itPluginRuntime->second.m_Context.Get(m_pIsolate);
			if (!LocalContext.IsEmpty()) {
				RemoveCallbacksForContext(LocalContext);
				g_Application.GetMemoryHookManager().RemoveContext(LocalContext);
			}

			ReleaseSourceJSExternalResources(strPluginName);

			for (auto itPackageModule = itPluginRuntime->second.m_mapPackageModuleCache.begin(); itPackageModule != itPluginRuntime->second.m_mapPackageModuleCache.end(); ++itPackageModule) {
				itPackageModule->second.Reset();
			}

			itPluginRuntime->second.m_mapPackageModuleCache.clear();

			for (auto itLocalModule = itPluginRuntime->second.m_mapLocalModuleCache.begin(); itLocalModule != itPluginRuntime->second.m_mapLocalModuleCache.end(); ++itLocalModule) {
				itLocalModule->second.Reset();
			}

			itPluginRuntime->second.m_mapLocalModuleCache.clear();
			itPluginRuntime->second.m_Exports.Reset();
			itPluginRuntime->second.m_SourceJSObject.Reset();
			itPluginRuntime->second.m_Context.Reset();
			m_mapPluginRuntimes.erase(itPluginRuntime);
		} catch (...) {
			auto itRemainingPluginRuntime = m_mapPluginRuntimes.find(strPluginName);
			if (itRemainingPluginRuntime != m_mapPluginRuntimes.end()) {
				itRemainingPluginRuntime->second.m_bUnloading = false;
			}

			throw;
		}
	}

	bool V8Runtime::ExecuteCommonJS(std::string const& strSource, std::string const& strScriptName, v8::Global<v8::Context> const& GlobalContext, v8::Global<v8::Value>* const pExportsOut) {
		constexpr int kCommonJSArgumentCount = 8;

		if (!m_bInitialized || !m_pIsolate || GlobalContext.IsEmpty()) {
			LogError("ExecuteCommonJS failed Path=\"%s\" Reason=\"V8 runtime or execution context unavailable\"", strScriptName.c_str());
			return false;
		}

		v8::Isolate::Scope IsolateScope(m_pIsolate);
		v8::HandleScope HandleScope(m_pIsolate);
		v8::Local<v8::Context> const LocalContext = GlobalContext.Get(m_pIsolate);
		if (LocalContext.IsEmpty()) {
			return false;
		}

		v8::Context::Scope ContextScope(LocalContext);
		v8::TryCatch ScriptTryCatch(m_pIsolate);

		std::string const strWrappedSource = "(function(require, module, exports, __filename, __dirname, globalThis, global, window) {\n\"use strict\";\n" + strSource + "\n})";

		v8::Local<v8::String> LocalSourceString {};
		if (!MakeRuntimeString(m_pIsolate, strWrappedSource, LocalSourceString)) {
			LogError("ExecuteCommonJS failed Path=\"%s\" Reason=\"Could not build V8 source string\"", strScriptName.c_str());
			return false;
		}

		v8::Local<v8::Script> LocalScript {};
		if (!v8::Script::Compile(LocalContext, LocalSourceString).ToLocal(&LocalScript)) {
			LogError("ExecuteCommonJS failed Path=\"%s\" Stage=Compile: %s", strScriptName.c_str(), FormatException(ScriptTryCatch).c_str());
			return false;
		}

		v8::Local<v8::Value> LocalCommonJSResult {};
		if (!LocalScript->Run(LocalContext).ToLocal(&LocalCommonJSResult)) {
			LogError("ExecuteCommonJS failed Path=\"%s\" Stage=Run: %s", strScriptName.c_str(), FormatException(ScriptTryCatch).c_str());
			return false;
		}

		if (!LocalCommonJSResult->IsFunction()) {
			LogError("ExecuteCommonJS failed Path=\"%s\" Reason=\"Script wrapper is not a function\"", strScriptName.c_str());
			return false;
		}

		v8::Local<v8::Function> const LocalWrapperFunction = v8::Local<v8::Function>::Cast(LocalCommonJSResult);
		v8::Local<v8::Object> const LocalModuleObject = v8::Object::New(m_pIsolate);
		v8::Local<v8::Object> const LocalExportsObject = v8::Object::New(m_pIsolate);
		v8::Local<v8::String> LocalExportsPropertyName {};
		if (LocalModuleObject.IsEmpty() || LocalExportsObject.IsEmpty()) {
			LogError("ExecuteCommonJS failed Path=\"%s\" Reason=\"Could not create CommonJS exports object\"", strScriptName.c_str());
			return false;
		}

		if (!MakeRuntimeString(m_pIsolate, "exports", LocalExportsPropertyName)) {
			LogError("ExecuteCommonJS failed Path=\"%s\" Reason=\"Could not build CommonJS exports property name\"", strScriptName.c_str());
			return false;
		}

		if (!LocalModuleObject->CreateDataProperty(LocalContext, LocalExportsPropertyName, LocalExportsObject).FromMaybe(false)) {
			LogError("ExecuteCommonJS failed Path=\"%s\" Reason=\"Could not set CommonJS exports property\"", strScriptName.c_str());
			return false;
		}

		std::filesystem::path const PathScript = strScriptName;
		std::string const strDirectory = PathScript.has_parent_path() ? PathScript.parent_path().string() : "";
		v8::Local<v8::String> LocalFileNameString {};
		v8::Local<v8::String> LocalDirectoryString {};
		if (!MakeRuntimeString(m_pIsolate, strScriptName, LocalFileNameString)) {
			LogError("ExecuteCommonJS failed Path=\"%s\" Reason=\"Could not build script filename\"", strScriptName.c_str());
			return false;
		}

		if (!MakeRuntimeString(m_pIsolate, strDirectory, LocalDirectoryString)) {
			LogError("ExecuteCommonJS failed Path=\"%s\" Reason=\"Could not build script directory\"", strScriptName.c_str());
			return false;
		}

		v8::Local<v8::Value> LocalGlobalRequireFunctionValue {};
		v8::Local<v8::String> LocalRequirePropertyName {};
		if (!MakeRuntimeString(m_pIsolate, "require", LocalRequirePropertyName)) {
			LogError("ExecuteCommonJS failed Path=\"%s\" Reason=\"Could not build require property name\"", strScriptName.c_str());
			return false;
		}

		if (!LocalContext->Global()->Get(LocalContext, LocalRequirePropertyName).ToLocal(&LocalGlobalRequireFunctionValue) || !LocalGlobalRequireFunctionValue->IsFunction()) {
			LogError("ExecuteCommonJS failed Path=\"%s\" Reason=\"Could not resolve global require function\"", strScriptName.c_str());
			return false;
		}

		v8::Local<v8::Value> LocalPluginRequireFunction {};
		if (!MakePluginRequire(this, m_pIsolate, LocalContext, LocalGlobalRequireFunctionValue, strScriptName, LocalPluginRequireFunction)) {
			LogError("ExecuteCommonJS failed Path=\"%s\" Reason=\"Could not build plugin-local require function\"", strScriptName.c_str());
			return false;
		}

		v8::Local<v8::Object> const LocalGlobalObject = LocalContext->Global();
		if (LocalGlobalObject.IsEmpty()) {
			return false;
		}

		v8::Local<v8::Value> arrCommonJSArguments[kCommonJSArgumentCount] = {
			LocalPluginRequireFunction,
			LocalModuleObject,
			LocalExportsObject,
			LocalFileNameString,
			LocalDirectoryString,
			LocalGlobalObject,
			LocalGlobalObject,
			LocalGlobalObject,
		};
		if (!LocalWrapperFunction->Call(LocalContext, LocalGlobalObject, kCommonJSArgumentCount, arrCommonJSArguments).ToLocal(&LocalCommonJSResult)) {
			LogError("ExecuteCommonJS failed Path=\"%s\" Stage=Call: %s", strScriptName.c_str(), FormatException(ScriptTryCatch).c_str());
			return false;
		}

		if (pExportsOut) {
			v8::Local<v8::Value> LocalExportsValue {};
			if (!LocalModuleObject->Get(LocalContext, LocalExportsPropertyName).ToLocal(&LocalExportsValue)) {
				LogError("ExecuteCommonJS failed Path=\"%s\" Stage=ReadExports: %s", strScriptName.c_str(), FormatException(ScriptTryCatch).c_str());
				return false;
			}

			pExportsOut->Reset(m_pIsolate, LocalExportsValue);
		}

		return true;
	}

	bool V8Runtime::CallExportFunction(std::string const& strModuleName, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalExportsValue, char const* const pszFunctionName) {
		constexpr int kArgumentCount = 0;

		if (!m_bInitialized || !m_pIsolate || LocalContext.IsEmpty() || !pszFunctionName || !*pszFunctionName) {
			return false;
		}

		if (LocalExportsValue.IsEmpty() || !LocalExportsValue->IsObject()) {
			return true;
		}

		v8::TryCatch ExportTryCatch(m_pIsolate);
		v8::Local<v8::Object> const LocalExportsObject = LocalExportsValue.As<v8::Object>();
		v8::Local<v8::String> LocalFunctionPropertyName {};
		if (!MakeRuntimeString(m_pIsolate, pszFunctionName, LocalFunctionPropertyName)) {
			LogError("CallExportFunction failed Module=\"%s\" Function=\"%s\" Reason=\"Could not build lifecycle function name\"", strModuleName.c_str(), pszFunctionName);
			return false;
		}

		v8::Local<v8::Value> LocalFunctionValue {};
		if (!LocalExportsObject->Get(LocalContext, LocalFunctionPropertyName).ToLocal(&LocalFunctionValue)) {
			LogError("CallExportFunction failed Module=\"%s\" Function=\"%s\" Stage=Lookup: %s", strModuleName.c_str(), pszFunctionName, FormatException(ExportTryCatch).c_str());
			return false;
		}

		if (LocalFunctionValue->IsNullOrUndefined()) {
			return true;
		}

		if (!LocalFunctionValue->IsFunction()) {
			LogError("CallExportFunction failed Module=\"%s\" Function=\"%s\" Reason=\"Lifecycle export must be a function\"", strModuleName.c_str(), pszFunctionName);
			return false;
		}

		v8::Local<v8::Function> const LocalExportFunction = LocalFunctionValue.As<v8::Function>();
		v8::Local<v8::Value> LocalCallResult {};
		if (!LocalExportFunction->Call(LocalContext, LocalExportsObject, kArgumentCount, nullptr).ToLocal(&LocalCallResult)) {
			LogError("CallExportFunction failed Module=\"%s\" Function=\"%s\" Stage=Call: %s", strModuleName.c_str(), pszFunctionName, FormatException(ExportTryCatch).c_str());
			return false;
		}

		return true;
	}

	bool V8Runtime::CallPluginExportFunction(std::string const& strPluginName, char const* const pszFunctionName) {
		if (!m_bInitialized || !m_pIsolate || strPluginName.empty() || !pszFunctionName || !*pszFunctionName) {
			return false;
		}

		auto itPluginRuntime = m_mapPluginRuntimes.find(strPluginName);
		if (itPluginRuntime == m_mapPluginRuntimes.end()) {
			return true;
		}

		v8::Isolate::Scope IsolateScope(m_pIsolate);
		v8::HandleScope HandleScope(m_pIsolate);
		v8::Local<v8::Context> const LocalContext = itPluginRuntime->second.m_Context.Get(m_pIsolate);
		if (LocalContext.IsEmpty()) {
			return false;
		}

		v8::Context::Scope ContextScope(LocalContext);

		return CallExportFunction(strPluginName, LocalContext, itPluginRuntime->second.m_Exports.Get(m_pIsolate), pszFunctionName);
	}

	void V8Runtime::InvalidateExtensionModules(std::string const& strExtensionName) {
		constexpr std::size_t kPrefixOffset = 0;

		if (!m_bInitialized || !m_pIsolate || strExtensionName.empty()) {
			return;
		}

		std::string const strModulePrefix = "extensions/" + strExtensionName + "/";
		v8::Isolate::Scope IsolateScope(m_pIsolate);
		v8::HandleScope HandleScope(m_pIsolate);

		for (auto itModuleCache = m_mapPackageModuleCache.begin(); itModuleCache != m_mapPackageModuleCache.end();) {
			if (itModuleCache->first.rfind(strModulePrefix, kPrefixOffset) != kPrefixOffset) {
				++itModuleCache;
				continue;
			}

			itModuleCache->second.Reset();
			itModuleCache = m_mapPackageModuleCache.erase(itModuleCache);
		}

		for (auto itPluginRuntime = m_mapPluginRuntimes.begin(); itPluginRuntime != m_mapPluginRuntimes.end(); ++itPluginRuntime) {
			std::map<std::string, v8::Global<v8::Value>>& mapModuleCache = itPluginRuntime->second.m_mapPackageModuleCache;
			for (auto itModuleCache = mapModuleCache.begin(); itModuleCache != mapModuleCache.end();) {
				if (itModuleCache->first.rfind(strModulePrefix, kPrefixOffset) != kPrefixOffset) {
					++itModuleCache;
					continue;
				}

				itModuleCache->second.Reset();
				itModuleCache = mapModuleCache.erase(itModuleCache);
			}
		}
	}

	bool V8Runtime::RequirePackageModule(std::string const& strModuleName, v8::Local<v8::Value>& LocalModuleOut) {
		constexpr int kCommonJSArgumentCount = 8;
		constexpr char kExportsObjectError[] = "Could not build CommonJS exports object.";
		constexpr char kModuleMetadataError[] = "Could not build package module metadata.";
		constexpr char kRequireFunctionError[] = "Could not resolve the global require function.";

		if (!m_bInitialized || !m_pIsolate || !m_pRuntimePaths || !IsValidPackageModuleName(strModuleName)) {
			return false;
		}

		v8::EscapableHandleScope HandleScope(m_pIsolate);
		v8::Local<v8::Context> const LocalContext = m_pIsolate->GetCurrentContext();
		if (LocalContext.IsEmpty()) {
			return false;
		}

		auto* const pPluginRuntimeRecord = FindPluginRuntimeRecord(LocalContext);
		auto* const pPackageModuleCache = pPluginRuntimeRecord ? &pPluginRuntimeRecord->m_mapPackageModuleCache : &m_mapPackageModuleCache;
		auto itCachedPackageModule = pPackageModuleCache->find(strModuleName);
		if (itCachedPackageModule != pPackageModuleCache->end()) {
			v8::Local<v8::Value> const LocalCachedPackageModule = itCachedPackageModule->second.Get(m_pIsolate);
			if (!LocalCachedPackageModule.IsEmpty()) {
				LocalModuleOut = HandleScope.Escape(LocalCachedPackageModule);
				return true;
			}

			pPackageModuleCache->erase(itCachedPackageModule);
		}

		if (strModuleName.starts_with("extensions/")) {
			ExtensionManager& Manager = g_Application.GetExtensionManager();
			auto const* const pModule = Manager.FindNativeModule(strModuleName);
			if (!pModule) {
				return false;
			}

			v8::Context::Scope ContextScope(LocalContext);
			v8::Local<v8::Object> LocalNativeModule {};
			if (!CreateExtensionBindingModule(Manager, *pModule, m_pIsolate, LocalContext).ToLocal(&LocalNativeModule)) {
				return false;
			}

			pPackageModuleCache->try_emplace(strModuleName, m_pIsolate, LocalNativeModule);
			LocalModuleOut = HandleScope.Escape(LocalNativeModule);

			return true;
		}

		std::filesystem::path const PathModule = (m_pRuntimePaths->GetPackageRootPath() / "sourcejs" / (strModuleName + ".js")).lexically_normal();
		std::error_code ErrorCode {};
		if (!std::filesystem::is_regular_file(PathModule, ErrorCode)) {
			return false;
		}

		std::string strSource {};
		if (!ReadFile(PathModule, strSource)) {
			ThrowRuntimeError(m_pIsolate, "RequirePackageModule failed Module=\"" + strModuleName + "\" Reason=\"Could not read module\"");
			return false;
		}

		v8::Context::Scope ContextScope(LocalContext);
		v8::TryCatch PackageModuleTryCatch(m_pIsolate);
		auto FailPackageModule = [this, &PackageModuleTryCatch, &strModuleName](char const* const pszMessage) -> bool {
			if (!PackageModuleTryCatch.HasCaught()) {
				std::string const strErrorMessage = "RequirePackageModule failed Module=\"" + strModuleName + "\" " + pszMessage;
				ThrowRuntimeError(m_pIsolate, strErrorMessage);
			}

			if (PackageModuleTryCatch.HasCaught()) {
				PackageModuleTryCatch.ReThrow();
			}

			return false;
		};

		std::string const strWrappedSource = "(function(require, module, exports, __filename, __dirname, globalThis, global, window) {\n\"use strict\";\n" + strSource + "\n})";

		v8::Local<v8::String> LocalSourceString {};
		if (!MakeRuntimeString(m_pIsolate, strWrappedSource, LocalSourceString)) {
			return FailPackageModule("Could not build V8 package source string.");
		}

		v8::Local<v8::String> LocalScriptNameString {};
		if (!MakeRuntimeString(m_pIsolate, PathModule.string(), LocalScriptNameString)) {
			return FailPackageModule("Could not build V8 package script name.");
		}

		v8::ScriptOrigin const ScriptOriginValue = v8::ScriptOrigin(LocalScriptNameString);
		v8::ScriptCompiler::Source PackageScriptSource(LocalSourceString, ScriptOriginValue);
		v8::Local<v8::Script> LocalScript {};
		if (!v8::ScriptCompiler::Compile(LocalContext, &PackageScriptSource).ToLocal(&LocalScript)) {
			return FailPackageModule("Could not compile package module.");
		}

		v8::Local<v8::Value> LocalPackageModuleResult {};
		if (!LocalScript->Run(LocalContext).ToLocal(&LocalPackageModuleResult)) {
			return FailPackageModule("Could not evaluate package module wrapper.");
		}

		if (!LocalPackageModuleResult->IsFunction()) {
			return FailPackageModule("Package module wrapper did not compile to a function.");
		}

		v8::Local<v8::Function> const LocalWrapperFunction = v8::Local<v8::Function>::Cast(LocalPackageModuleResult);
		v8::Local<v8::Object> const LocalModuleObject = v8::Object::New(m_pIsolate);
		v8::Local<v8::Object> const LocalExportsObject = v8::Object::New(m_pIsolate);
		v8::Local<v8::String> LocalExportsPropertyName {};
		if (LocalModuleObject.IsEmpty() || LocalExportsObject.IsEmpty()) {
			return FailPackageModule(kExportsObjectError);
		}

		if (!MakeRuntimeString(m_pIsolate, "exports", LocalExportsPropertyName)) {
			return FailPackageModule(kExportsObjectError);
		}

		if (!LocalModuleObject->CreateDataProperty(LocalContext, LocalExportsPropertyName, LocalExportsObject).FromMaybe(false)) {
			return FailPackageModule(kExportsObjectError);
		}

		v8::Local<v8::String> LocalFileNameString {};
		v8::Local<v8::String> LocalDirectoryString {};
		if (!MakeRuntimeString(m_pIsolate, PathModule.string(), LocalFileNameString)) {
			return FailPackageModule(kModuleMetadataError);
		}

		if (!MakeRuntimeString(m_pIsolate, PathModule.parent_path().string(), LocalDirectoryString)) {
			return FailPackageModule(kModuleMetadataError);
		}

		v8::Local<v8::Value> LocalRequireFunctionValue {};
		v8::Local<v8::String> LocalRequirePropertyName {};
		if (!MakeRuntimeString(m_pIsolate, "require", LocalRequirePropertyName)) {
			return FailPackageModule(kRequireFunctionError);
		}

		v8::Local<v8::Object> const LocalGlobalObject = LocalContext->Global();
		if (LocalGlobalObject.IsEmpty()) {
			return FailPackageModule("Could not resolve the global object.");
		}

		if (!LocalGlobalObject->Get(LocalContext, LocalRequirePropertyName).ToLocal(&LocalRequireFunctionValue) || !LocalRequireFunctionValue->IsFunction()) {
			return FailPackageModule(kRequireFunctionError);
		}

		v8::Local<v8::Value> arrCommonJSArguments[kCommonJSArgumentCount] = {
			LocalRequireFunctionValue,
			LocalModuleObject,
			LocalExportsObject,
			LocalFileNameString,
			LocalDirectoryString,
			LocalGlobalObject,
			LocalGlobalObject,
			LocalGlobalObject,
		};

		auto OwnsCacheEntry = [this, pPackageModuleCache, &strModuleName, LocalExportsObject]() -> bool {
			auto itModuleCache = pPackageModuleCache->find(strModuleName);
			return (itModuleCache != pPackageModuleCache->end()) && (itModuleCache->second.Get(m_pIsolate) == LocalExportsObject);
		};
		auto RemoveEvaluationCacheEntry = [pPackageModuleCache, &strModuleName, &OwnsCacheEntry]() {
			if (OwnsCacheEntry()) {
				pPackageModuleCache->erase(strModuleName);
			}
		};

		try {
			(*pPackageModuleCache)[strModuleName].Reset(m_pIsolate, LocalExportsObject);
			if (!LocalWrapperFunction->Call(LocalContext, LocalGlobalObject, kCommonJSArgumentCount, arrCommonJSArguments).ToLocal(&LocalPackageModuleResult)) {
				RemoveEvaluationCacheEntry();
				return FailPackageModule("Could not execute package module.");
			}

			v8::Local<v8::Value> LocalExportsValue {};
			if (!LocalModuleObject->Get(LocalContext, LocalExportsPropertyName).ToLocal(&LocalExportsValue)) {
				RemoveEvaluationCacheEntry();
				return FailPackageModule("Could not read CommonJS exports object.");
			}

			// Invalidation or a newer evaluation owns the replacement; never republish over it.
			if (OwnsCacheEntry()) {
				(*pPackageModuleCache)[strModuleName].Reset(m_pIsolate, LocalExportsValue);
			}

			LocalModuleOut = HandleScope.Escape(LocalExportsValue);
		} catch (...) {
			RemoveEvaluationCacheEntry();
			throw;
		}

		return true;
	}

	bool V8Runtime::RequirePluginLocalModule(std::string const& strParentScriptName, std::string const& strModuleName, v8::Local<v8::Value>& LocalModuleOut) {
		constexpr std::size_t kPrefixOffset = 0;

		if (!m_bInitialized || !m_pIsolate || !m_pRuntimePaths || strParentScriptName.empty() || (strParentScriptName.find('\0') != std::string::npos)) {
			return false;
		}

		if ((strModuleName.rfind("./", kPrefixOffset) != kPrefixOffset) || (strModuleName.find('\0') != std::string::npos) || (strModuleName.find('\\') != std::string::npos) || (strModuleName.find(':') != std::string::npos)) {
			return false;
		}

		std::filesystem::path const PathRequestedModule = strModuleName;
		for (auto const& PathPart : PathRequestedModule) {
			if (PathPart == "..") {
				return false;
			}
		}

		v8::EscapableHandleScope HandleScope(m_pIsolate);
		v8::Local<v8::Context> const LocalContext = m_pIsolate->GetCurrentContext();
		if (LocalContext.IsEmpty()) {
			return false;
		}

		auto* const pPluginRuntimeRecord = FindPluginRuntimeRecord(LocalContext);
		std::string strPluginName {};
		if (!pPluginRuntimeRecord || !GetCurrentPluginName(m_pIsolate, strPluginName)) {
			return false;
		}

		std::error_code ErrorCode {};
		std::filesystem::path const PathPluginRoot = std::filesystem::weakly_canonical(m_pRuntimePaths->GetPluginRootPath() / strPluginName, ErrorCode);
		if (ErrorCode) {
			return false;
		}

		std::filesystem::path PathParentScript = strParentScriptName;
		if (PathParentScript.is_relative()) {
			PathParentScript = std::filesystem::absolute(PathParentScript, ErrorCode);
			if (ErrorCode) {
				return false;
			}
		}

		PathParentScript = std::filesystem::weakly_canonical(PathParentScript, ErrorCode);
		if (ErrorCode || !IsPathWithin(PathPluginRoot, PathParentScript)) {
			return false;
		}

		std::filesystem::path const PathResolvedRequest = PathParentScript.parent_path() / PathRequestedModule;
		std::vector<std::filesystem::path> vecModuleCandidates {};
		if (PathResolvedRequest.has_extension()) {
			if (PathResolvedRequest.extension() != ".js") {
				return false;
			}

			vecModuleCandidates.push_back(PathResolvedRequest);

		} else {
			std::filesystem::path PathJavaScriptFile = PathResolvedRequest;
			PathJavaScriptFile += ".js";
			vecModuleCandidates.push_back(PathJavaScriptFile);
			vecModuleCandidates.push_back(PathResolvedRequest / "index.js");
		}

		std::filesystem::path PathResolvedModule {};
		for (std::size_t unModuleCandidateIndex = 0; unModuleCandidateIndex < vecModuleCandidates.size(); ++unModuleCandidateIndex) {
			ErrorCode.clear();

			std::filesystem::path const PathModuleCandidate = std::filesystem::weakly_canonical(vecModuleCandidates[unModuleCandidateIndex], ErrorCode);
			if (!ErrorCode && IsPathWithin(PathPluginRoot, PathModuleCandidate) && std::filesystem::is_regular_file(PathModuleCandidate, ErrorCode) && !ErrorCode) {
				PathResolvedModule = PathModuleCandidate;
				break;
			}
		}

		if (PathResolvedModule.empty()) {
			return false;
		}

		std::filesystem::path const PathRelativeModule = std::filesystem::relative(PathResolvedModule, PathPluginRoot, ErrorCode);
		if (ErrorCode || PathRelativeModule.empty()) {
			return false;
		}

		std::string const strCacheKey = PathRelativeModule.generic_string();
		auto itCachedLocalModule = pPluginRuntimeRecord->m_mapLocalModuleCache.find(strCacheKey);
		if (itCachedLocalModule != pPluginRuntimeRecord->m_mapLocalModuleCache.end()) {
			v8::Local<v8::Value> const LocalCachedModuleValue = itCachedLocalModule->second.Get(m_pIsolate);
			if (!LocalCachedModuleValue.IsEmpty()) {
				LocalModuleOut = HandleScope.Escape(LocalCachedModuleValue);
				return true;
			}

			pPluginRuntimeRecord->m_mapLocalModuleCache.erase(itCachedLocalModule);
		}

		std::string strSource {};
		if (!ReadFile(PathResolvedModule, strSource)) {
			LogError("RequirePluginLocalModule failed Path=\"%s\" Reason=\"Could not read plugin-local module\"", PathResolvedModule.string().c_str());
			return false;
		}

		v8::Global<v8::Value> GlobalExports {};
		if (!ExecuteCommonJS(strSource, PathResolvedModule.string(), pPluginRuntimeRecord->m_Context, &GlobalExports)) {
			return false;
		}

		v8::Local<v8::Value> const LocalExportsValue = GlobalExports.Get(m_pIsolate);
		if (LocalExportsValue.IsEmpty()) {
			GlobalExports.Reset();
			return false;
		}

		pPluginRuntimeRecord->m_mapLocalModuleCache[strCacheKey] = std::move(GlobalExports);
		LocalModuleOut = HandleScope.Escape(LocalExportsValue);

		return true;
	}

	void V8Runtime::EmitEvent(std::string const& strEventName, std::string const& strPayload) {
		constexpr int kDefaultResult = 0;
		constexpr int kBlockResult = -1;

		EmitEventResult(strEventName, strPayload, kDefaultResult, kBlockResult);
	}

	int V8Runtime::EmitEventResult(std::string const& strEventName, std::string const& strPayload, const int nDefaultResult, const int nBlockResult) {
		constexpr int kCallbackArgumentCount = 2;
		constexpr double kMinimumIntegerResult = static_cast<double>(std::numeric_limits<int>::min());
		constexpr double kMaximumIntegerResult = static_cast<double>(std::numeric_limits<int>::max());

		if (!m_bInitialized || !m_pIsolate || strEventName.empty()) {
			return nDefaultResult;
		}

		auto itEventCallbacks = m_mapEventCallbacks.find(strEventName);
		if (itEventCallbacks == m_mapEventCallbacks.end()) {
			return nDefaultResult;
		}

		v8::Isolate::Scope IsolateScope(m_pIsolate);
		v8::HandleScope HandleScope(m_pIsolate);

		int nEventResult = nDefaultResult;
		std::vector<ScriptCallbackSnapshotRecord> const vecEventCallbacks = SnapshotStoredFunctions(m_pIsolate, itEventCallbacks->second);
		for (std::size_t unEventCallbackIndex = 0; unEventCallbackIndex < vecEventCallbacks.size(); ++unEventCallbackIndex) {
			v8::Local<v8::Context> const LocalContext = vecEventCallbacks[unEventCallbackIndex].m_Context;
			if (LocalContext.IsEmpty()) {
				continue;
			}

			v8::Context::Scope ContextScope(LocalContext);
			v8::Local<v8::String> LocalEventNameString {};
			v8::Local<v8::String> LocalPayloadString {};
			if (!MakeRuntimeString(m_pIsolate, strEventName, LocalEventNameString) || !MakeRuntimeString(m_pIsolate, strPayload, LocalPayloadString)) {
				continue;
			}

			v8::Local<v8::Value> arrCallbackArguments[kCallbackArgumentCount] = { LocalEventNameString, LocalPayloadString };
			v8::Local<v8::Function> const LocalCallbackFunction = vecEventCallbacks[unEventCallbackIndex].m_Function;
			if (LocalCallbackFunction.IsEmpty()) {
				continue;
			}

			v8::TryCatch EventTryCatch(m_pIsolate);
			v8::Local<v8::Value> LocalCallbackResult {};
			if (!LocalCallbackFunction->Call(LocalContext, LocalContext->Global(), kCallbackArgumentCount, arrCallbackArguments).ToLocal(&LocalCallbackResult)) {
				LogError("EmitEventResult failed Event=\"%s\" Stage=Call: %s", strEventName.c_str(), FormatException(EventTryCatch).c_str());
				continue;
			}

			int nCallbackResult = nDefaultResult;
			if (LocalCallbackResult->IsBoolean()) {
				nCallbackResult = LocalCallbackResult.As<v8::Boolean>()->Value() ? nDefaultResult : nBlockResult;

			} else if (LocalCallbackResult->IsInt32()) {
				nCallbackResult = LocalCallbackResult.As<v8::Int32>()->Value();

			} else if (LocalCallbackResult->IsNumber()) {
				double dblCallbackResult = 0.0;
				if (LocalCallbackResult->NumberValue(LocalContext).To(&dblCallbackResult) && std::isfinite(dblCallbackResult) && (dblCallbackResult >= kMinimumIntegerResult) && (dblCallbackResult <= kMaximumIntegerResult)) {
					nCallbackResult = static_cast<int>(dblCallbackResult);
				}
			}

			if (nCallbackResult == nBlockResult) {
				nEventResult = nBlockResult;
			}
		}

		return nEventResult;
	}

	bool V8Runtime::IsEventEmissionAllowed(std::string const& strEventName, std::string const& strPayload, std::string& strMessageOut) {
		constexpr int kCallbackArgumentCount = 2;

		if (!m_bInitialized || !m_pIsolate || strEventName.empty()) {
			strMessageOut.clear();
			return true;
		}

		auto itEventCallbacks = m_mapEventCallbacks.find(strEventName);
		if (itEventCallbacks == m_mapEventCallbacks.end()) {
			strMessageOut.clear();
			return true;
		}

		v8::Isolate::Scope IsolateScope(m_pIsolate);
		v8::HandleScope HandleScope(m_pIsolate);

		std::string strEventMessage {};
		bool bEventAllowed = true;
		std::vector<ScriptCallbackSnapshotRecord> const vecEventCallbacks = SnapshotStoredFunctions(m_pIsolate, itEventCallbacks->second);
		for (std::size_t unEventCallbackIndex = 0; unEventCallbackIndex < vecEventCallbacks.size(); ++unEventCallbackIndex) {
			v8::Local<v8::Context> const LocalContext = vecEventCallbacks[unEventCallbackIndex].m_Context;
			if (LocalContext.IsEmpty()) {
				continue;
			}

			v8::Context::Scope ContextScope(LocalContext);
			v8::Local<v8::String> LocalEventNameString {};
			v8::Local<v8::String> LocalPayloadString {};
			if (!MakeRuntimeString(m_pIsolate, strEventName, LocalEventNameString) || !MakeRuntimeString(m_pIsolate, strPayload, LocalPayloadString)) {
				continue;
			}

			v8::Local<v8::Value> arrCallbackArguments[kCallbackArgumentCount] = { LocalEventNameString, LocalPayloadString };
			v8::Local<v8::Function> const LocalCallbackFunction = vecEventCallbacks[unEventCallbackIndex].m_Function;
			if (LocalCallbackFunction.IsEmpty()) {
				continue;
			}

			v8::TryCatch EventPermissionTryCatch(m_pIsolate);
			v8::Local<v8::Value> LocalCallbackResult {};
			if (!LocalCallbackFunction->Call(LocalContext, LocalContext->Global(), kCallbackArgumentCount, arrCallbackArguments).ToLocal(&LocalCallbackResult)) {
				LogError("IsEventEmissionAllowed failed Event=\"%s\" Stage=Call: %s", strEventName.c_str(), FormatException(EventPermissionTryCatch).c_str());
				continue;
			}

			if (LocalCallbackResult->IsBoolean()) {
				if (!LocalCallbackResult.As<v8::Boolean>()->Value()) {
					bEventAllowed = false;
				}

				continue;
			}

			if (LocalCallbackResult->IsInt32()) {
				if (LocalCallbackResult.As<v8::Int32>()->Value() == 0) {
					bEventAllowed = false;
				}

				continue;
			}

			if (LocalCallbackResult->IsString()) {
				v8::String::Utf8Value const RejectionMessageUTF8Value = v8::String::Utf8Value(m_pIsolate, LocalCallbackResult);
				if (*RejectionMessageUTF8Value) {
					strEventMessage = *RejectionMessageUTF8Value;
				}

				bEventAllowed = false;

				continue;
			}

			if (LocalCallbackResult->IsObject()) {
				v8::Local<v8::Object> const LocalResultObject = LocalCallbackResult.As<v8::Object>();
				bool bIsObjectAllowed = true;
				const bool bHasAllowedProperty = GetRuntimeObjectBoolean(m_pIsolate, LocalContext, LocalResultObject, "Allowed", bIsObjectAllowed);
				if (EventPermissionTryCatch.HasCaught()) {
					LogError("IsEventEmissionAllowed failed Event=\"%s\" Stage=ReadAllowed: %s", strEventName.c_str(), FormatException(EventPermissionTryCatch).c_str());
					continue;
				}

				if (bHasAllowedProperty && !bIsObjectAllowed) {
					bEventAllowed = false;
				}

				std::string strRejectionMessage {};
				const bool bHasRejectionMessage = GetRuntimeObjectString(m_pIsolate, LocalContext, LocalResultObject, "RejectMessage", strRejectionMessage)
					|| (!EventPermissionTryCatch.HasCaught() && GetRuntimeObjectString(m_pIsolate, LocalContext, LocalResultObject, "Reason", strRejectionMessage))
					|| (!EventPermissionTryCatch.HasCaught() && GetRuntimeObjectString(m_pIsolate, LocalContext, LocalResultObject, "Message", strRejectionMessage));
				if (EventPermissionTryCatch.HasCaught()) {
					LogError("IsEventEmissionAllowed failed Event=\"%s\" Stage=ReadMessage: %s", strEventName.c_str(), FormatException(EventPermissionTryCatch).c_str());
					continue;
				}

				if (bHasRejectionMessage) {
					strEventMessage = std::move(strRejectionMessage);
					bEventAllowed = false;
				}
			}
		}

		strMessageOut = std::move(strEventMessage);

		return bEventAllowed;
	}

	bool V8Runtime::AddEventCallback(std::string const& strEventName, v8::Local<v8::Function> const LocalCallbackFunction) {
		constexpr char kServerOutputEventName[] = "ServerOutput";

		if (!m_bInitialized || !m_pIsolate || strEventName.empty() || LocalCallbackFunction.IsEmpty()) {
			return false;
		}

		std::vector<ScriptCallbackRecord>& vecEventCallbacks = m_mapEventCallbacks[strEventName];
		if (!AddStoredFunction(m_pIsolate, vecEventCallbacks, LocalCallbackFunction)) {
			if (vecEventCallbacks.empty()) {
				m_mapEventCallbacks.erase(strEventName);
			}

			return false;
		}

		if (strEventName == kServerOutputEventName) {
			g_Application.SetServerOutputHookEnabled(true);
		}

		return true;
	}

	bool V8Runtime::RemoveEventCallback(std::string const& strEventName, v8::Local<v8::Function> const LocalCallbackFunction) {
		constexpr char kServerOutputEventName[] = "ServerOutput";

		if (!m_bInitialized || !m_pIsolate || strEventName.empty() || LocalCallbackFunction.IsEmpty()) {
			return false;
		}

		auto itEventCallbacks = m_mapEventCallbacks.find(strEventName);
		if (itEventCallbacks == m_mapEventCallbacks.end()) {
			return false;
		}

		std::vector<ScriptCallbackRecord>& vecEventCallbacks = itEventCallbacks->second;
		if (!RemoveStoredFunction(m_pIsolate, vecEventCallbacks, LocalCallbackFunction)) {
			return false;
		}

		if (vecEventCallbacks.empty()) {
			m_mapEventCallbacks.erase(itEventCallbacks);
		}

		if ((strEventName == kServerOutputEventName) && !HasEventCallbacks(strEventName)) {
			g_Application.SetServerOutputHookEnabled(false);
		}

		return true;
	}

	bool V8Runtime::HasEventCallbacks(std::string const& strEventName) const {
		if (strEventName.empty()) {
			return false;
		}

		auto itEventCallbacks = m_mapEventCallbacks.find(strEventName);

		return (itEventCallbacks != m_mapEventCallbacks.end()) && !itEventCallbacks->second.empty();
	}

	std::size_t V8Runtime::GetEventCallbackCount(std::string const& strEventName) const {
		if (strEventName.empty()) {
			return 0;
		}

		auto itEventCallbacks = m_mapEventCallbacks.find(strEventName);
		if (itEventCallbacks == m_mapEventCallbacks.end()) {
			return 0;
		}

		return itEventCallbacks->second.size();
	}

	bool V8Runtime::AddGameEventCallback(std::string const& strEventName, v8::Local<v8::Function> const LocalCallbackFunction) {
		if (!m_bInitialized || !m_pIsolate || strEventName.empty() || LocalCallbackFunction.IsEmpty()) {
			return false;
		}

		auto itGameEventCallbacks = m_mapGameEventCallbacks.find(strEventName);
		if (itGameEventCallbacks != m_mapGameEventCallbacks.end()) {
			return AddStoredFunction(m_pIsolate, itGameEventCallbacks->second, LocalCallbackFunction);
		}

		auto* const pGameEventManager = g_Application.GetEngineInterfaces().GetGameEventManager();
		if (!pGameEventManager) {
			return false;
		}

		std::vector<ScriptCallbackRecord> vecNewGameEventCallbacks {};
		if (!AddStoredFunction(m_pIsolate, vecNewGameEventCallbacks, LocalCallbackFunction)) {
			return false;
		}

		std::pair<std::map<std::string, std::vector<ScriptCallbackRecord>>::iterator, bool> const CallbackInsertResult = m_mapGameEventCallbacks.emplace(strEventName, std::move(vecNewGameEventCallbacks));
		if (!CallbackInsertResult.second) {
			return false;
		}

		try {
			if (pGameEventManager->AddListener(this, strEventName.c_str(), true)) {
				return true;
			}
		} catch (...) {
			m_mapGameEventCallbacks.erase(CallbackInsertResult.first);
			throw;
		}

		m_mapGameEventCallbacks.erase(CallbackInsertResult.first);

		return false;
	}

	bool V8Runtime::RemoveGameEventCallback(std::string const& strEventName, v8::Local<v8::Function> const LocalCallbackFunction) {
		if (!m_bInitialized || !m_pIsolate || strEventName.empty() || LocalCallbackFunction.IsEmpty()) {
			return false;
		}

		auto itEventCallbacks = m_mapGameEventCallbacks.find(strEventName);
		if (itEventCallbacks == m_mapGameEventCallbacks.end()) {
			return false;
		}

		std::vector<ScriptCallbackRecord>& vecEventCallbacks = itEventCallbacks->second;
		if (vecEventCallbacks.size() != 1) {
			return RemoveStoredFunction(m_pIsolate, vecEventCallbacks, LocalCallbackFunction);
		}

		v8::Local<v8::Context> const LocalContext = m_pIsolate->GetCurrentContext();
		if (!DoesStoredFunctionBelongToContext(m_pIsolate, vecEventCallbacks[0], LocalContext)) {
			return false;
		}

		v8::Local<v8::Function> const LocalStoredFunction = vecEventCallbacks[0].m_Function.Get(m_pIsolate);
		if (LocalStoredFunction.IsEmpty() || !LocalStoredFunction->StrictEquals(LocalCallbackFunction)) {
			return false;
		}

		// Retain the original context/handles and map allocation until SDK removal succeeds.
		std::map<std::string, std::vector<ScriptCallbackRecord>>::node_type CallbackNode = m_mapGameEventCallbacks.extract(itEventCallbacks);
		auto RestoreCallback = [this, &CallbackNode, &strEventName]() -> void {
			try {
				std::map<std::string, std::vector<ScriptCallbackRecord>>::insert_return_type const RestoreResult = m_mapGameEventCallbacks.insert(std::move(CallbackNode));
				if (!RestoreResult.inserted) {
					LogError("RemoveGameEventCallback failed Event=\"%s\" Stage=RestoreCallback", strEventName.c_str());
					return;
				}

				if (!RebuildGameEventListeners()) {
					LogError("RemoveGameEventCallback failed Event=\"%s\" Stage=RestoreListeners", strEventName.c_str());
				}
			} catch (...) {
				LogError("RemoveGameEventCallback failed Event=\"%s\" Stage=RestoreListeners Reason=\"C++ exception\"", strEventName.c_str());
			}
		};

		try {
			if (RebuildGameEventListeners()) {
				return true;
			}
		} catch (...) {
			RestoreCallback();
			throw;
		}

		RestoreCallback();

		return false;
	}

	bool V8Runtime::RebuildGameEventListeners() {
		auto* const pGameEventManager = g_Application.GetEngineInterfaces().GetGameEventManager();
		if (!pGameEventManager) {
			return m_mapGameEventCallbacks.empty();
		}

		pGameEventManager->RemoveListener(this);

		for (auto itGameEventCallbacks = m_mapGameEventCallbacks.begin(); itGameEventCallbacks != m_mapGameEventCallbacks.end(); ++itGameEventCallbacks) {
			if (!itGameEventCallbacks->second.empty() && !pGameEventManager->AddListener(this, itGameEventCallbacks->first.c_str(), true)) {
				pGameEventManager->RemoveListener(this);
				return false;
			}
		}

		return true;
	}

	void V8Runtime::FireGameEvent(IGameEvent* const pEvent) try {
		constexpr int kCallbackArgumentCount = 1;

		if (!m_bInitialized || !m_pIsolate || !pEvent) {
			return;
		}

		char const* const pszEventName = pEvent->GetName();
		if (!pszEventName || !*pszEventName) {
			return;
		}

		std::string const strEventName = pszEventName;
		auto itGameEventCallbacks = m_mapGameEventCallbacks.find(strEventName);
		if (itGameEventCallbacks == m_mapGameEventCallbacks.end()) {
			return;
		}

		v8::Isolate::Scope IsolateScope(m_pIsolate);
		v8::HandleScope HandleScope(m_pIsolate);
		std::vector<ScriptCallbackSnapshotRecord> const vecGameEventCallbacks = SnapshotStoredFunctions(m_pIsolate, itGameEventCallbacks->second);

		++m_unNextGameEventToken;

		if (m_unNextGameEventToken == 0) {
			++m_unNextGameEventToken;
		}

		const std::uint64_t unEventToken = m_unNextGameEventToken;
		std::pair<std::map<std::uint64_t, IGameEvent*>::iterator, bool> const EventInsertResult = m_mapActiveGameEvents.emplace(unEventToken, pEvent);
		if (!EventInsertResult.second) {
			LogError("FireGameEvent failed Event=\"%s\" Stage=RegisterToken", strEventName.c_str());
			return;
		}

		try {
			for (std::size_t unCallbackIndex = 0; unCallbackIndex < vecGameEventCallbacks.size(); ++unCallbackIndex) {
				v8::Local<v8::Context> const LocalContext = vecGameEventCallbacks[unCallbackIndex].m_Context;
				v8::Local<v8::Function> const LocalCallbackFunction = vecGameEventCallbacks[unCallbackIndex].m_Function;
				if (LocalContext.IsEmpty() || LocalCallbackFunction.IsEmpty()) {
					continue;
				}

				v8::Context::Scope ContextScope(LocalContext);
				v8::Local<v8::Object> const LocalEventView = MakeGameEventView(LocalContext, pEvent, unEventToken);
				if (LocalEventView.IsEmpty()) {
					continue;
				}

				v8::Local<v8::Value> arrCallbackArguments[kCallbackArgumentCount] = { LocalEventView };
				v8::TryCatch GameEventTryCatch(m_pIsolate);
				if (LocalCallbackFunction->Call(LocalContext, LocalContext->Global(), kCallbackArgumentCount, arrCallbackArguments).IsEmpty()) {
					LogError("FireGameEvent failed Event=\"%s\" Stage=Call: %s", strEventName.c_str(), FormatException(GameEventTryCatch).c_str());
				}
			}
		} catch (...) {
			m_mapActiveGameEvents.erase(unEventToken);
			throw;
		}

		m_mapActiveGameEvents.erase(unEventToken);
	} catch (...) {
		LogError("FireGameEvent failed Stage=Dispatch Reason=\"C++ exception\"");
	}

#if defined(EVENT_DEBUG_ID_INIT)
	int V8Runtime::GetEventDebugID() noexcept {
		return EVENT_DEBUG_ID_INIT;
	}
#endif

	v8::Local<v8::Object> V8Runtime::MakeGameEventView(v8::Local<v8::Context> const LocalContext, IGameEvent* const pEvent, const std::uint64_t unEventToken) {
		constexpr int kCallbackDataLength = 2;
		constexpr std::uint32_t kRuntimeIndex = 0;
		constexpr std::uint32_t kEventTokenIndex = 1;

		if (!m_pIsolate || LocalContext.IsEmpty() || !pEvent) {
			return {};
		}

		v8::Local<v8::Object> const LocalEvent = v8::Object::New(m_pIsolate);
		v8::Local<v8::Array> const LocalCallbackData = v8::Array::New(m_pIsolate, kCallbackDataLength);
		if (LocalEvent.IsEmpty() || LocalCallbackData.IsEmpty()) {
			return {};
		}

		if (!LocalCallbackData->CreateDataProperty(LocalContext, kRuntimeIndex, v8::External::New(m_pIsolate, this)).FromMaybe(false)) {
			return {};
		}

		if (!LocalCallbackData->CreateDataProperty(LocalContext, kEventTokenIndex, v8::BigInt::NewFromUnsigned(m_pIsolate, unEventToken)).FromMaybe(false)) {
			return {};
		}

		char const* const pszEventName = pEvent->GetName();
		if (!SetPayloadString(m_pIsolate, LocalContext, LocalEvent, "EventName", pszEventName ? pszEventName : "")) {
			return {};
		}

		if (!SetPayloadBoolean(m_pIsolate, LocalContext, LocalEvent, "Reliable", pEvent->IsReliable())) {
			return {};
		}

		if (!SetPayloadBoolean(m_pIsolate, LocalContext, LocalEvent, "Local", pEvent->IsLocal())) {
			return {};
		}

		v8::Local<v8::String> LocalAddressKey {};
		if (!MakeRuntimeString(m_pIsolate, "Address", LocalAddressKey)) {
			return {};
		}

		if (!LocalEvent->CreateDataProperty(LocalContext, LocalAddressKey, v8::BigInt::NewFromUnsigned(m_pIsolate, static_cast<std::uint64_t>(reinterpret_cast<std::uintptr_t>(pEvent)))).FromMaybe(false)) {
			return {};
		}

		auto SetMethod = [this, LocalContext, LocalCallbackData, LocalEvent](char const* const pszName, v8::FunctionCallback const Callback) -> bool {
			v8::Local<v8::String> LocalMethodName {};
			v8::Local<v8::Function> LocalMethodFunction {};
			if (!MakeRuntimeString(m_pIsolate, pszName, LocalMethodName)) {
				return false;
			}

			if (!v8::Function::New(LocalContext, Callback, LocalCallbackData).ToLocal(&LocalMethodFunction)) {
				return false;
			}

			if (!LocalEvent->CreateDataProperty(LocalContext, LocalMethodName, LocalMethodFunction).FromMaybe(false)) {
				return false;
			}

			return true;
		};

		if (!SetMethod("IsEventEmpty", IsGameEventEmptyCallback)) {
			return {};
		}

		if (!SetMethod("GetEventBoolean", GetGameEventBooleanCallback)) {
			return {};
		}

		if (!SetMethod("GetEventInteger", GetGameEventIntegerCallback)) {
			return {};
		}

		if (!SetMethod("GetEventFloat", GetGameEventFloatCallback)) {
			return {};
		}

		if (!SetMethod("GetEventString", GetGameEventStringCallback)) {
			return {};
		}

		if (!SetMethod("SetEventBoolean", SetGameEventBooleanCallback)) {
			return {};
		}

		if (!SetMethod("SetEventInteger", SetGameEventIntegerCallback)) {
			return {};
		}

		if (!SetMethod("SetEventFloat", SetGameEventFloatCallback)) {
			return {};
		}

		if (!SetMethod("SetEventString", SetGameEventStringCallback)) {
			return {};
		}

		auto InstallUInt64Methods = [&SetMethod]<typename EventType>() -> bool {
			if constexpr (requires(EventType* const pGameEvent, char const* const pszKey, const std::uint64_t unValue) {
				pGameEvent->GetUint64(pszKey, unValue);
				pGameEvent->SetUint64(pszKey, unValue);
			}) {
				if (!SetMethod("GetEventUInt64", GetGameEventUInt64Callback<EventType>)) {
					return false;
				}

				if (!SetMethod("SetEventUInt64", SetGameEventUInt64Callback<EventType>)) {
					return false;
				}
			}

			return true;
		};

		if (!InstallUInt64Methods.template operator()<IGameEvent>()) {
			return {};
		}

		return LocalEvent;
	}

	V8Runtime* V8Runtime::RequireGameEventRuntimeFromArguments(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation, char const* const pszOperation) {
		constexpr std::uint32_t kRuntimeIndex = 0;

		auto* const pIsolate = CallbackInformation.GetIsolate();
		if (!pIsolate || !pszOperation) {
			return nullptr;
		}

		v8::Local<v8::Value> const LocalCallbackDataValue = CallbackInformation.Data();
		if (LocalCallbackDataValue.IsEmpty() || !LocalCallbackDataValue->IsArray()) {
			ThrowRuntimeError(pIsolate, std::string(pszOperation) + " has no active game-event context.");
			return nullptr;
		}

		v8::Local<v8::Context> const LocalContext = pIsolate->GetCurrentContext();
		if (LocalContext.IsEmpty()) {
			ThrowRuntimeError(pIsolate, std::string(pszOperation) + " has no active game-event context.");
			return nullptr;
		}

		v8::Local<v8::Array> const LocalCallbackData = LocalCallbackDataValue.As<v8::Array>();
		v8::Local<v8::Value> LocalRuntime {};
		if (!LocalCallbackData->Get(LocalContext, kRuntimeIndex).ToLocal(&LocalRuntime)) {
			return nullptr;
		}

		if (LocalRuntime.IsEmpty() || !LocalRuntime->IsExternal()) {
			ThrowRuntimeError(pIsolate, std::string(pszOperation) + " has no active game-event runtime.");
			return nullptr;
		}

		auto* const pRuntime = static_cast<V8Runtime*>(LocalRuntime.As<v8::External>()->Value());
		if (!pRuntime) {
			ThrowRuntimeError(pIsolate, std::string(pszOperation) + " has no active game-event runtime.");
			return nullptr;
		}

		return pRuntime;
	}

	IGameEvent* V8Runtime::RequireActiveGameEventFromArguments(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation, char const* const pszOperation) {
		constexpr std::uint32_t kEventTokenIndex = 1;

		auto* const pIsolate = CallbackInformation.GetIsolate();
		if (!pIsolate || !pszOperation) {
			return nullptr;
		}

		v8::Local<v8::Value> const LocalCallbackDataValue = CallbackInformation.Data();
		if (LocalCallbackDataValue.IsEmpty() || !LocalCallbackDataValue->IsArray()) {
			ThrowRuntimeError(pIsolate, std::string(pszOperation) + " has no active game-event context.");
			return nullptr;
		}

		v8::Local<v8::Context> const LocalContext = pIsolate->GetCurrentContext();
		if (LocalContext.IsEmpty()) {
			ThrowRuntimeError(pIsolate, std::string(pszOperation) + " has no active game-event context.");
			return nullptr;
		}

		v8::Local<v8::Array> const LocalCallbackData = LocalCallbackDataValue.As<v8::Array>();
		v8::Local<v8::Value> LocalEventToken {};
		if (!LocalCallbackData->Get(LocalContext, kEventTokenIndex).ToLocal(&LocalEventToken)) {
			return nullptr;
		}

		if (LocalEventToken.IsEmpty() || !LocalEventToken->IsBigInt()) {
			ThrowRuntimeError(pIsolate, std::string(pszOperation) + " has no active game-event token.");
			return nullptr;
		}

		bool bLossless = false;
		const std::uint64_t unEventToken = LocalEventToken.As<v8::BigInt>()->Uint64Value(&bLossless);
		auto itActiveGameEvent = m_mapActiveGameEvents.find(unEventToken);
		if (!bLossless || (itActiveGameEvent == m_mapActiveGameEvents.end()) || !itActiveGameEvent->second) {
			ThrowRuntimeError(pIsolate, std::string(pszOperation) + " cannot access an event after its callback has returned.");
			return nullptr;
		}

		return itActiveGameEvent->second;
	}

	void V8Runtime::IsGameEventEmptyCallback(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation) try {
		constexpr int kKeyArgumentIndex = 0;
		constexpr char kOperation[] = "GameEvent.IsEventEmpty(strKey?)";

		auto* const pRuntime = RequireGameEventRuntimeFromArguments(CallbackInformation, kOperation);
		if (!pRuntime) {
			return;
		}

		std::string strKey {};
		if ((CallbackInformation.Length() > kKeyArgumentIndex) && !CallbackInformation[kKeyArgumentIndex]->IsUndefined() && !RequireGameEventKeyArgument(CallbackInformation, kKeyArgumentIndex, kOperation, strKey)) {
			return;
		}

		auto* const pEvent = pRuntime->RequireActiveGameEventFromArguments(CallbackInformation, kOperation);
		if (!pEvent) {
			return;
		}

		CallbackInformation.GetReturnValue().Set(pEvent->IsEmpty(strKey.empty() ? nullptr : strKey.c_str()));
	} catch (...) {
		constexpr char kCallbackExceptionError[] = "IsGameEventEmptyCallback failed with a C++ exception.";

		ThrowRuntimeCallbackException(CallbackInformation.GetIsolate(), kCallbackExceptionError);
	}

	void V8Runtime::GetGameEventBooleanCallback(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation) try {
		constexpr int kKeyArgumentIndex = 0;
		constexpr int kDefaultValueArgumentIndex = 1;
		constexpr char kOperation[] = "GameEvent.GetEventBoolean(strKey, bDefaultValue?)";

		auto* const pRuntime = RequireGameEventRuntimeFromArguments(CallbackInformation, kOperation);
		std::string strKey {};
		if (!pRuntime || !RequireGameEventKeyArgument(CallbackInformation, kKeyArgumentIndex, kOperation, strKey)) {
			return;
		}

		if ((CallbackInformation.Length() > kDefaultValueArgumentIndex) && !CallbackInformation[kDefaultValueArgumentIndex]->IsBoolean()) {
			ThrowRuntimeError(CallbackInformation.GetIsolate(), std::string(kOperation) + " expects a boolean default value.");
			return;
		}

		const bool bDefaultValue = (CallbackInformation.Length() > kDefaultValueArgumentIndex) ? CallbackInformation[kDefaultValueArgumentIndex].As<v8::Boolean>()->Value() : false;
		auto* const pEvent = pRuntime->RequireActiveGameEventFromArguments(CallbackInformation, kOperation);
		if (!pEvent) {
			return;
		}

		CallbackInformation.GetReturnValue().Set(pEvent->GetBool(strKey.c_str(), bDefaultValue));
	} catch (...) {
		constexpr char kCallbackExceptionError[] = "GetGameEventBooleanCallback failed with a C++ exception.";

		ThrowRuntimeCallbackException(CallbackInformation.GetIsolate(), kCallbackExceptionError);
	}

	void V8Runtime::GetGameEventIntegerCallback(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation) try {
		constexpr int kKeyArgumentIndex = 0;
		constexpr int kDefaultValueArgumentIndex = 1;
		constexpr char kOperation[] = "GameEvent.GetEventInteger(strKey, nDefaultValue?)";

		auto* const pRuntime = RequireGameEventRuntimeFromArguments(CallbackInformation, kOperation);
		std::string strKey {};
		if (!pRuntime || !RequireGameEventKeyArgument(CallbackInformation, kKeyArgumentIndex, kOperation, strKey)) {
			return;
		}

		if ((CallbackInformation.Length() > kDefaultValueArgumentIndex) && !CallbackInformation[kDefaultValueArgumentIndex]->IsInt32()) {
			ThrowRuntimeError(CallbackInformation.GetIsolate(), std::string(kOperation) + " expects an int32 default value.");
			return;
		}

		const int nDefaultValue = (CallbackInformation.Length() > kDefaultValueArgumentIndex) ? CallbackInformation[kDefaultValueArgumentIndex].As<v8::Int32>()->Value() : 0;
		auto* const pEvent = pRuntime->RequireActiveGameEventFromArguments(CallbackInformation, kOperation);
		if (!pEvent) {
			return;
		}

		CallbackInformation.GetReturnValue().Set(pEvent->GetInt(strKey.c_str(), nDefaultValue));
	} catch (...) {
		constexpr char kCallbackExceptionError[] = "GetGameEventIntegerCallback failed with a C++ exception.";

		ThrowRuntimeCallbackException(CallbackInformation.GetIsolate(), kCallbackExceptionError);
	}

	template <typename EventType>
	void V8Runtime::GetGameEventUInt64Callback(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation) try {
		constexpr int kKeyArgumentIndex = 0;
		constexpr int kDefaultValueArgumentIndex = 1;
		constexpr char kOperation[] = "GameEvent.GetEventUInt64(strKey, unDefaultValue?)";

		auto* const pRuntime = RequireGameEventRuntimeFromArguments(CallbackInformation, kOperation);
		std::string strKey {};
		if (!pRuntime || !RequireGameEventKeyArgument(CallbackInformation, kKeyArgumentIndex, kOperation, strKey)) {
			return;
		}

		std::uint64_t unDefaultValue = 0;
		if ((CallbackInformation.Length() > kDefaultValueArgumentIndex) && !RequireGameEventUInt64Argument(CallbackInformation, kDefaultValueArgumentIndex, kOperation, unDefaultValue)) {
			return;
		}

		auto* const pEvent = static_cast<EventType*>(pRuntime->RequireActiveGameEventFromArguments(CallbackInformation, kOperation));
		if (!pEvent) {
			return;
		}

		const std::uint64_t unValue = pEvent->GetUint64(strKey.c_str(), unDefaultValue);
		CallbackInformation.GetReturnValue().Set(v8::BigInt::NewFromUnsigned(CallbackInformation.GetIsolate(), unValue));
	} catch (...) {
		constexpr char kCallbackExceptionError[] = "GetGameEventUInt64Callback failed with a C++ exception.";

		ThrowRuntimeCallbackException(CallbackInformation.GetIsolate(), kCallbackExceptionError);
	}

	void V8Runtime::GetGameEventFloatCallback(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation) try {
		constexpr int kKeyArgumentIndex = 0;
		constexpr int kDefaultValueArgumentIndex = 1;
		constexpr double kMinimumFloatValue = static_cast<double>(std::numeric_limits<float>::lowest());
		constexpr double kMaximumFloatValue = static_cast<double>(std::numeric_limits<float>::max());
		constexpr char kOperation[] = "GameEvent.GetEventFloat(strKey, dblDefaultValue?)";

		auto* const pRuntime = RequireGameEventRuntimeFromArguments(CallbackInformation, kOperation);
		std::string strKey {};
		if (!pRuntime || !RequireGameEventKeyArgument(CallbackInformation, kKeyArgumentIndex, kOperation, strKey)) {
			return;
		}

		double dblDefaultValue = 0.0;
		if (CallbackInformation.Length() > kDefaultValueArgumentIndex) {
			if (!CallbackInformation[kDefaultValueArgumentIndex]->IsNumber()) {
				ThrowRuntimeError(CallbackInformation.GetIsolate(), std::string(kOperation) + " expects a finite float default value.");
				return;
			}

			v8::Local<v8::Context> const LocalContext = CallbackInformation.GetIsolate()->GetCurrentContext();
			if (LocalContext.IsEmpty() || !CallbackInformation[kDefaultValueArgumentIndex]->NumberValue(LocalContext).To(&dblDefaultValue)) {
				ThrowRuntimeError(CallbackInformation.GetIsolate(), std::string(kOperation) + " expects a finite float default value.");
				return;
			}

			if (!std::isfinite(dblDefaultValue) || (dblDefaultValue < kMinimumFloatValue) || (dblDefaultValue > kMaximumFloatValue)) {
				ThrowRuntimeError(CallbackInformation.GetIsolate(), std::string(kOperation) + " expects a finite float default value.");
				return;
			}
		}

		auto* const pEvent = pRuntime->RequireActiveGameEventFromArguments(CallbackInformation, kOperation);
		if (!pEvent) {
			return;
		}

		CallbackInformation.GetReturnValue().Set(pEvent->GetFloat(strKey.c_str(), static_cast<float>(dblDefaultValue)));
	} catch (...) {
		constexpr char kCallbackExceptionError[] = "GetGameEventFloatCallback failed with a C++ exception.";

		ThrowRuntimeCallbackException(CallbackInformation.GetIsolate(), kCallbackExceptionError);
	}

	void V8Runtime::GetGameEventStringCallback(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation) try {
		constexpr int kKeyArgumentIndex = 0;
		constexpr int kDefaultValueArgumentIndex = 1;
		constexpr char kOperation[] = "GameEvent.GetEventString(strKey, strDefaultValue?)";

		auto* const pRuntime = RequireGameEventRuntimeFromArguments(CallbackInformation, kOperation);
		std::string strKey {};
		if (!pRuntime || !RequireGameEventKeyArgument(CallbackInformation, kKeyArgumentIndex, kOperation, strKey)) {
			return;
		}

		std::string strDefaultValue {};
		if ((CallbackInformation.Length() > kDefaultValueArgumentIndex) && !RequireGameEventStringArgument(CallbackInformation, kDefaultValueArgumentIndex, kOperation, strDefaultValue)) {
			return;
		}

		auto* const pEvent = pRuntime->RequireActiveGameEventFromArguments(CallbackInformation, kOperation);
		if (!pEvent) {
			return;
		}

		char const* const pszEventValue = pEvent->GetString(strKey.c_str(), strDefaultValue.c_str());
		v8::Local<v8::String> LocalEventValue {};
		if (!MakeRuntimeString(CallbackInformation.GetIsolate(), pszEventValue ? pszEventValue : "", LocalEventValue)) {
			return;
		}

		CallbackInformation.GetReturnValue().Set(LocalEventValue);
	} catch (...) {
		constexpr char kCallbackExceptionError[] = "GetGameEventStringCallback failed with a C++ exception.";

		ThrowRuntimeCallbackException(CallbackInformation.GetIsolate(), kCallbackExceptionError);
	}

	void V8Runtime::SetGameEventBooleanCallback(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation) try {
		constexpr int kKeyArgumentIndex = 0;
		constexpr int kValueArgumentIndex = 1;
		constexpr int kRequiredArgumentCount = 2;
		constexpr char kOperation[] = "GameEvent.SetEventBoolean(strKey, bValue)";

		auto* const pRuntime = RequireGameEventRuntimeFromArguments(CallbackInformation, kOperation);
		std::string strKey {};
		if (!pRuntime || !RequireGameEventKeyArgument(CallbackInformation, kKeyArgumentIndex, kOperation, strKey)) {
			return;
		}

		if ((CallbackInformation.Length() < kRequiredArgumentCount) || !CallbackInformation[kValueArgumentIndex]->IsBoolean()) {
			ThrowRuntimeError(CallbackInformation.GetIsolate(), std::string(kOperation) + " expects a boolean value.");
			return;
		}

		auto* const pEvent = pRuntime->RequireActiveGameEventFromArguments(CallbackInformation, kOperation);
		if (!pEvent) {
			return;
		}

		const bool bEventValue = CallbackInformation[kValueArgumentIndex].As<v8::Boolean>()->Value();
		pEvent->SetBool(strKey.c_str(), bEventValue);
		CallbackInformation.GetReturnValue().Set(true);
	} catch (...) {
		constexpr char kCallbackExceptionError[] = "SetGameEventBooleanCallback failed with a C++ exception.";

		ThrowRuntimeCallbackException(CallbackInformation.GetIsolate(), kCallbackExceptionError);
	}

	void V8Runtime::SetGameEventIntegerCallback(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation) try {
		constexpr int kKeyArgumentIndex = 0;
		constexpr int kValueArgumentIndex = 1;
		constexpr int kRequiredArgumentCount = 2;
		constexpr char kOperation[] = "GameEvent.SetEventInteger(strKey, nValue)";

		auto* const pRuntime = RequireGameEventRuntimeFromArguments(CallbackInformation, kOperation);
		std::string strKey {};
		if (!pRuntime || !RequireGameEventKeyArgument(CallbackInformation, kKeyArgumentIndex, kOperation, strKey)) {
			return;
		}

		if ((CallbackInformation.Length() < kRequiredArgumentCount) || !CallbackInformation[kValueArgumentIndex]->IsInt32()) {
			ThrowRuntimeError(CallbackInformation.GetIsolate(), std::string(kOperation) + " expects an int32 value.");
			return;
		}

		auto* const pEvent = pRuntime->RequireActiveGameEventFromArguments(CallbackInformation, kOperation);
		if (!pEvent) {
			return;
		}

		const int nEventValue = CallbackInformation[kValueArgumentIndex].As<v8::Int32>()->Value();
		pEvent->SetInt(strKey.c_str(), nEventValue);
		CallbackInformation.GetReturnValue().Set(true);
	} catch (...) {
		constexpr char kCallbackExceptionError[] = "SetGameEventIntegerCallback failed with a C++ exception.";

		ThrowRuntimeCallbackException(CallbackInformation.GetIsolate(), kCallbackExceptionError);
	}

	template <typename EventType>
	void V8Runtime::SetGameEventUInt64Callback(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation) try {
		constexpr int kKeyArgumentIndex = 0;
		constexpr int kValueArgumentIndex = 1;
		constexpr char kOperation[] = "GameEvent.SetEventUInt64(strKey, unValue)";

		auto* const pRuntime = RequireGameEventRuntimeFromArguments(CallbackInformation, kOperation);
		std::string strKey {};
		std::uint64_t unEventValue = 0;
		if (!pRuntime || !RequireGameEventKeyArgument(CallbackInformation, kKeyArgumentIndex, kOperation, strKey)) {
			return;
		}

		if (!RequireGameEventUInt64Argument(CallbackInformation, kValueArgumentIndex, kOperation, unEventValue)) {
			return;
		}

		auto* const pEvent = static_cast<EventType*>(pRuntime->RequireActiveGameEventFromArguments(CallbackInformation, kOperation));
		if (!pEvent) {
			return;
		}

		pEvent->SetUint64(strKey.c_str(), unEventValue);
		CallbackInformation.GetReturnValue().Set(true);
	} catch (...) {
		constexpr char kCallbackExceptionError[] = "SetGameEventUInt64Callback failed with a C++ exception.";

		ThrowRuntimeCallbackException(CallbackInformation.GetIsolate(), kCallbackExceptionError);
	}

	void V8Runtime::SetGameEventFloatCallback(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation) try {
		constexpr int kKeyArgumentIndex = 0;
		constexpr int kValueArgumentIndex = 1;
		constexpr int kRequiredArgumentCount = 2;
		constexpr double kMinimumFloatValue = static_cast<double>(std::numeric_limits<float>::lowest());
		constexpr double kMaximumFloatValue = static_cast<double>(std::numeric_limits<float>::max());
		constexpr char kOperation[] = "GameEvent.SetEventFloat(strKey, dblValue)";

		auto* const pRuntime = RequireGameEventRuntimeFromArguments(CallbackInformation, kOperation);
		std::string strKey {};
		if (!pRuntime || !RequireGameEventKeyArgument(CallbackInformation, kKeyArgumentIndex, kOperation, strKey)) {
			return;
		}

		if ((CallbackInformation.Length() < kRequiredArgumentCount) || !CallbackInformation[kValueArgumentIndex]->IsNumber()) {
			ThrowRuntimeError(CallbackInformation.GetIsolate(), std::string(kOperation) + " expects a finite float value.");
			return;
		}

		v8::Local<v8::Context> const LocalContext = CallbackInformation.GetIsolate()->GetCurrentContext();
		double dblEventValue = 0.0;
		if (LocalContext.IsEmpty() || !CallbackInformation[kValueArgumentIndex]->NumberValue(LocalContext).To(&dblEventValue)) {
			ThrowRuntimeError(CallbackInformation.GetIsolate(), std::string(kOperation) + " expects a finite float value.");
			return;
		}

		if (!std::isfinite(dblEventValue) || (dblEventValue < kMinimumFloatValue) || (dblEventValue > kMaximumFloatValue)) {
			ThrowRuntimeError(CallbackInformation.GetIsolate(), std::string(kOperation) + " expects a finite float value.");
			return;
		}

		auto* const pEvent = pRuntime->RequireActiveGameEventFromArguments(CallbackInformation, kOperation);
		if (!pEvent) {
			return;
		}

		pEvent->SetFloat(strKey.c_str(), static_cast<float>(dblEventValue));
		CallbackInformation.GetReturnValue().Set(true);
	} catch (...) {
		constexpr char kCallbackExceptionError[] = "SetGameEventFloatCallback failed with a C++ exception.";

		ThrowRuntimeCallbackException(CallbackInformation.GetIsolate(), kCallbackExceptionError);
	}

	void V8Runtime::SetGameEventStringCallback(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation) try {
		constexpr int kKeyArgumentIndex = 0;
		constexpr int kValueArgumentIndex = 1;
		constexpr char kOperation[] = "GameEvent.SetEventString(strKey, strValue)";

		auto* const pRuntime = RequireGameEventRuntimeFromArguments(CallbackInformation, kOperation);
		std::string strKey {};
		std::string strEventValue {};
		if (!pRuntime || !RequireGameEventKeyArgument(CallbackInformation, kKeyArgumentIndex, kOperation, strKey)) {
			return;
		}

		if (!RequireGameEventStringArgument(CallbackInformation, kValueArgumentIndex, kOperation, strEventValue)) {
			return;
		}

		auto* const pEvent = pRuntime->RequireActiveGameEventFromArguments(CallbackInformation, kOperation);
		if (!pEvent) {
			return;
		}

		pEvent->SetString(strKey.c_str(), strEventValue.c_str());
		CallbackInformation.GetReturnValue().Set(true);
	} catch (...) {
		constexpr char kCallbackExceptionError[] = "SetGameEventStringCallback failed with a C++ exception.";

		ThrowRuntimeCallbackException(CallbackInformation.GetIsolate(), kCallbackExceptionError);
	}

	bool V8Runtime::RegisterCommand(std::string const& strCommandName, v8::Local<v8::Function> const LocalCallbackFunction) {
		if (!m_bInitialized || !m_pIsolate || strCommandName.empty() || LocalCallbackFunction.IsEmpty()) {
			return false;
		}

		EngineInterfaces& EngineInterfaceSet = g_Application.GetEngineInterfaces();
		auto itRegisteredCommand = m_mapRegisteredCommands.find(strCommandName);
		bool bCreatedCommand = false;
		auto RemoveCreatedCommand = [this, &EngineInterfaceSet, &itRegisteredCommand, &bCreatedCommand]() {
			if (!bCreatedCommand) {
				return;
			}

			// Registration can throw after the SDK has accepted the borrowed command address.
			EngineInterfaceSet.UnregisterConCommand(itRegisteredCommand->second.m_pCommand.get());
			m_mapRegisteredCommands.erase(itRegisteredCommand);
			bCreatedCommand = false;
		};

		try {
			if (itRegisteredCommand == m_mapRegisteredCommands.end()) {
				if (EngineInterfaceSet.FindCommandBase(strCommandName)) {
					LogWarning("RegisterCommand failed Command=\"%s\" Reason=\"Command is not owned by SourceJS\"", strCommandName.c_str());
					return false;
				}

				ScriptCommandRecord NewCommandRecord {};
				NewCommandRecord.m_strName = strCommandName;

				std::pair<std::map<std::string, ScriptCommandRecord>::iterator, bool> const CommandInsertResult = m_mapRegisteredCommands.insert(std::make_pair(strCommandName, std::move(NewCommandRecord)));
				if (!CommandInsertResult.second) {
					return false;
				}

				itRegisteredCommand = CommandInsertResult.first;
				bCreatedCommand = true;

				const int nCommandFlags = HasClientCommand(strCommandName) ? kSourceJSClientCommandFlags : kSourceJSOwnedCommandFlag;
				itRegisteredCommand->second.m_pCommand = std::make_unique<ConCommand>(itRegisteredCommand->second.m_strName.c_str(), DispatchSourceJSRuntimeCommand, "SourceJS script command.", nCommandFlags);
			}

			if (!itRegisteredCommand->second.m_pCommand) {
				RemoveCreatedCommand();
				return false;
			}

			if (!itRegisteredCommand->second.m_pCommand->IsRegistered() && !EngineInterfaceSet.RegisterConCommand(itRegisteredCommand->second.m_pCommand.get())) {
				RemoveCreatedCommand();
				return false;
			}

			std::vector<ScriptCallbackRecord>& vecCommandCallbacks = m_mapCommandCallbacks[strCommandName];
			if (AddStoredFunction(m_pIsolate, vecCommandCallbacks, LocalCallbackFunction)) {
				return true;
			}

			if (vecCommandCallbacks.empty()) {
				m_mapCommandCallbacks.erase(strCommandName);
			}

			RemoveCreatedCommand();

			return false;
		} catch (...) {
			auto itCommandCallbacks = m_mapCommandCallbacks.find(strCommandName);
			if ((itCommandCallbacks != m_mapCommandCallbacks.end()) && itCommandCallbacks->second.empty()) {
				m_mapCommandCallbacks.erase(itCommandCallbacks);
			}

			RemoveCreatedCommand();
			throw;
		}
	}

	bool V8Runtime::UnregisterCommand(std::string const& strCommandName, v8::Local<v8::Function> const LocalCallbackFunction, const bool bHasCallbackFunction) {
		if (!m_bInitialized || !m_pIsolate || strCommandName.empty() || (bHasCallbackFunction && LocalCallbackFunction.IsEmpty())) {
			return false;
		}

		auto itCommandCallbacks = m_mapCommandCallbacks.find(strCommandName);
		if (itCommandCallbacks == m_mapCommandCallbacks.end()) {
			return false;
		}

		if (bHasCallbackFunction) {
			if (!RemoveStoredFunction(m_pIsolate, itCommandCallbacks->second, LocalCallbackFunction)) {
				return false;
			}

		} else {
			ResetStoredFunctions(itCommandCallbacks->second);
		}

		if (!itCommandCallbacks->second.empty()) {
			return true;
		}

		m_mapCommandCallbacks.erase(itCommandCallbacks);

		auto itRegisteredCommand = m_mapRegisteredCommands.find(strCommandName);
		if (itRegisteredCommand == m_mapRegisteredCommands.end()) {
			return true;
		}

		if (itRegisteredCommand->second.m_pCommand && itRegisteredCommand->second.m_pCommand->IsRegistered()) {
			g_Application.GetEngineInterfaces().UnregisterConCommand(itRegisteredCommand->second.m_pCommand.get());
		}

		m_mapRegisteredCommands.erase(itRegisteredCommand);

		return true;
	}

	void V8Runtime::DispatchCommand(std::string const& strCommandName, std::vector<std::string> const& vecArguments) {
		constexpr std::size_t kFirstArgumentIndex = 0;
		constexpr int kServerClientIndex = 0;
		constexpr char kCommandKind[] = "server";

		if (!m_bInitialized || !m_pIsolate || strCommandName.empty()) {
			return;
		}

		auto itCommandCallbacks = m_mapCommandCallbacks.find(strCommandName);
		if (itCommandCallbacks == m_mapCommandCallbacks.end()) {
			return;
		}

		v8::Isolate::Scope IsolateScope(m_pIsolate);
		v8::HandleScope HandleScope(m_pIsolate);
		std::string const strRawArguments = JoinArguments(vecArguments, kFirstArgumentIndex);
		std::vector<ScriptCallbackSnapshotRecord> const vecCommandCallbacks = SnapshotStoredFunctions(m_pIsolate, itCommandCallbacks->second);
		for (std::size_t unCommandCallbackIndex = 0; unCommandCallbackIndex < vecCommandCallbacks.size(); ++unCommandCallbackIndex) {
			ScriptCallbackSnapshotRecord const& CallbackRecord = vecCommandCallbacks[unCommandCallbackIndex];
			bool bBlocksCommand = false;
			CallCommandCallback(m_pIsolate, CallbackRecord.m_Context, CallbackRecord.m_Function, kCommandKind, strCommandName, strRawArguments, kServerClientIndex, vecArguments, nullptr, nullptr, bBlocksCommand);
		}
	}

	bool V8Runtime::RegisterClientCommand(std::string const& strCommandName, v8::Local<v8::Function> const LocalCallbackFunction) {
		if (!m_bInitialized || !m_pIsolate || strCommandName.empty() || LocalCallbackFunction.IsEmpty()) {
			return false;
		}

		std::vector<ScriptCallbackRecord>& vecClientCommandCallbacks = m_mapClientCommandCallbacks[strCommandName];
		try {
			if (!AddStoredFunction(m_pIsolate, vecClientCommandCallbacks, LocalCallbackFunction)) {
				if (vecClientCommandCallbacks.empty()) {
					m_mapClientCommandCallbacks.erase(strCommandName);
				}

				return false;
			}
		} catch (...) {
			if (vecClientCommandCallbacks.empty()) {
				m_mapClientCommandCallbacks.erase(strCommandName);
			}

			throw;
		}

		auto itRegisteredCommand = m_mapRegisteredCommands.find(strCommandName);
		if ((itRegisteredCommand != m_mapRegisteredCommands.end()) && itRegisteredCommand->second.m_pCommand) {
			itRegisteredCommand->second.m_pCommand->AddFlags(FCVAR_GAMEDLL);
		}

		return true;
	}

	bool V8Runtime::UnregisterClientCommand(std::string const& strCommandName, v8::Local<v8::Function> const LocalCallbackFunction, const bool bHasCallbackFunction) {
		if (!m_bInitialized || !m_pIsolate || strCommandName.empty() || (bHasCallbackFunction && LocalCallbackFunction.IsEmpty())) {
			return false;
		}

		auto itClientCommandCallbacks = m_mapClientCommandCallbacks.find(strCommandName);
		if (itClientCommandCallbacks == m_mapClientCommandCallbacks.end()) {
			return false;
		}

		if (bHasCallbackFunction) {
			if (!RemoveStoredFunction(m_pIsolate, itClientCommandCallbacks->second, LocalCallbackFunction)) {
				return false;
			}

		} else {
			ResetStoredFunctions(itClientCommandCallbacks->second);
		}

		if (!itClientCommandCallbacks->second.empty()) {
			return true;
		}

		m_mapClientCommandCallbacks.erase(itClientCommandCallbacks);

		auto itRegisteredCommand = m_mapRegisteredCommands.find(strCommandName);
		if (itRegisteredCommand == m_mapRegisteredCommands.end()) {
			return true;
		}

		ScriptCommandRecord& RegisteredCommandRecord = itRegisteredCommand->second;
		EngineInterfaces& EngineInterfaceSet = g_Application.GetEngineInterfaces();
		if (!RegisteredCommandRecord.m_pCommand) {
			return false;
		}

		std::unique_ptr<ConCommand> pPreviousCommand = std::move(RegisteredCommandRecord.m_pCommand);
		EngineInterfaceSet.UnregisterConCommand(pPreviousCommand.get());

		auto RestorePreviousCommand = [&RegisteredCommandRecord, &EngineInterfaceSet, &pPreviousCommand, &strCommandName]() {
			if (!pPreviousCommand) {
				return;
			}

			EngineInterfaceSet.UnregisterConCommand(RegisteredCommandRecord.m_pCommand.get());
			RegisteredCommandRecord.m_pCommand = std::move(pPreviousCommand);
			if (!EngineInterfaceSet.RegisterConCommand(RegisteredCommandRecord.m_pCommand.get())) {
				LogError("UnregisterClientCommand rollback failed Command=\"%s\"", strCommandName.c_str());
			}
		};

		try {
			RegisteredCommandRecord.m_pCommand = std::make_unique<ConCommand>(RegisteredCommandRecord.m_strName.c_str(), DispatchSourceJSRuntimeCommand, "SourceJS script command.", kSourceJSOwnedCommandFlag);
			if (!RegisteredCommandRecord.m_pCommand->IsRegistered() && !EngineInterfaceSet.RegisterConCommand(RegisteredCommandRecord.m_pCommand.get())) {
				RestorePreviousCommand();
				return false;
			}
		} catch (...) {
			try {
				RestorePreviousCommand();
			} catch (...) {
				LogError("UnregisterClientCommand rollback failed with a C++ exception Command=\"%s\"", strCommandName.c_str());
			}

			throw;
		}

		return true;
	}

	bool V8Runtime::HasClientCommand(std::string const& strCommandName) const {
		if (strCommandName.empty()) {
			return false;
		}

		auto itClientCommandCallbacks = m_mapClientCommandCallbacks.find(strCommandName);

		return (itClientCommandCallbacks != m_mapClientCommandCallbacks.end()) && !itClientCommandCallbacks->second.empty();
	}

	bool V8Runtime::OwnsRegisteredCommand(std::string const& strCommandName) const {
		auto const itCommand = m_mapRegisteredCommands.find(strCommandName);

		return (itCommand != m_mapRegisteredCommands.end()) && itCommand->second.m_pCommand && (g_Application.GetEngineInterfaces().FindCommandBase(strCommandName) == itCommand->second.m_pCommand.get());
	}

	bool V8Runtime::AddClientCommandFilter(v8::Local<v8::Function> const LocalFilterFunction) {
		if (!m_bInitialized || !m_pIsolate || LocalFilterFunction.IsEmpty()) {
			return false;
		}

		return AddStoredFunction(m_pIsolate, m_vecClientCommandFilters, LocalFilterFunction);
	}

	bool V8Runtime::RemoveClientCommandFilter(v8::Local<v8::Function> const LocalFilterFunction) {
		if (!m_bInitialized || !m_pIsolate || LocalFilterFunction.IsEmpty()) {
			return false;
		}

		return RemoveStoredFunction(m_pIsolate, m_vecClientCommandFilters, LocalFilterFunction);
	}

	bool V8Runtime::DispatchClientCommand(const int nClientIndex, std::vector<std::string> const& vecArguments) {
		constexpr std::size_t kCommandNameArgumentIndex = 0;
		constexpr char kCommandKind[] = "client";

		if (!m_bInitialized || !m_pIsolate || vecArguments.empty()) {
			return false;
		}

		std::string const strCommandName = vecArguments[kCommandNameArgumentIndex];
		if (strCommandName.empty() && m_vecClientCommandFilters.empty()) {
			return false;
		}

		v8::Isolate::Scope IsolateScope(m_pIsolate);
		v8::HandleScope HandleScope(m_pIsolate);
		ClientConsoleLogScope ClientLogScope(nClientIndex);
		std::string const strRawArguments = JoinArguments(vecArguments, kCommandNameArgumentIndex);
		std::vector<ScriptCallbackSnapshotRecord> const vecClientCommandFilters = SnapshotStoredFunctions(m_pIsolate, m_vecClientCommandFilters);
		for (std::size_t unClientCommandFilterIndex = 0; unClientCommandFilterIndex < vecClientCommandFilters.size(); ++unClientCommandFilterIndex) {
			ScriptCallbackSnapshotRecord const& CallbackRecord = vecClientCommandFilters[unClientCommandFilterIndex];
			bool bBlocksCommand = false;
			if (!CallCommandCallback(m_pIsolate, CallbackRecord.m_Context, CallbackRecord.m_Function, kCommandKind, strCommandName, strRawArguments, nClientIndex, vecArguments, nullptr, nullptr, bBlocksCommand)) {
				continue;
			}

			if (bBlocksCommand) {
				return true;
			}
		}

		auto itClientCommandCallbacks = m_mapClientCommandCallbacks.find(strCommandName);
		if (itClientCommandCallbacks == m_mapClientCommandCallbacks.end()) {
			return false;
		}

		std::vector<ScriptCallbackSnapshotRecord> const vecClientCommandCallbacks = SnapshotStoredFunctions(m_pIsolate, itClientCommandCallbacks->second);
		for (std::size_t unClientCommandCallbackIndex = 0; unClientCommandCallbackIndex < vecClientCommandCallbacks.size(); ++unClientCommandCallbackIndex) {
			ScriptCallbackSnapshotRecord const& CallbackRecord = vecClientCommandCallbacks[unClientCommandCallbackIndex];
			bool bBlocksCommand = false;
			if (!CallCommandCallback(m_pIsolate, CallbackRecord.m_Context, CallbackRecord.m_Function, kCommandKind, strCommandName, strRawArguments, nClientIndex, vecArguments, nullptr, nullptr, bBlocksCommand)) {
				continue;
			}

			if (bBlocksCommand) {
				return true;
			}
		}

		return false;
	}

	bool V8Runtime::RegisterSayCommand(std::string const& strCommandName, v8::Local<v8::Function> const LocalCallbackFunction) {
		if (!m_bInitialized || !m_pIsolate || strCommandName.empty() || LocalCallbackFunction.IsEmpty()) {
			return false;
		}

		std::vector<ScriptCallbackRecord>& vecSayCommandCallbacks = m_mapSayCommandCallbacks[strCommandName];
		try {
			if (!AddStoredFunction(m_pIsolate, vecSayCommandCallbacks, LocalCallbackFunction)) {
				if (vecSayCommandCallbacks.empty()) {
					m_mapSayCommandCallbacks.erase(strCommandName);
				}

				return false;
			}
		} catch (...) {
			if (vecSayCommandCallbacks.empty()) {
				m_mapSayCommandCallbacks.erase(strCommandName);
			}

			throw;
		}

		return true;
	}

	bool V8Runtime::UnregisterSayCommand(std::string const& strCommandName, v8::Local<v8::Function> const LocalCallbackFunction, const bool bHasCallbackFunction) {
		if (!m_bInitialized || !m_pIsolate || strCommandName.empty() || (bHasCallbackFunction && LocalCallbackFunction.IsEmpty())) {
			return false;
		}

		auto itSayCommandCallbacks = m_mapSayCommandCallbacks.find(strCommandName);
		if (itSayCommandCallbacks == m_mapSayCommandCallbacks.end()) {
			return false;
		}

		if (bHasCallbackFunction) {
			if (!RemoveStoredFunction(m_pIsolate, itSayCommandCallbacks->second, LocalCallbackFunction)) {
				return false;
			}

		} else {
			ResetStoredFunctions(itSayCommandCallbacks->second);
		}

		if (!itSayCommandCallbacks->second.empty()) {
			return true;
		}

		m_mapSayCommandCallbacks.erase(itSayCommandCallbacks);

		return true;
	}

	bool V8Runtime::AddSayCommandFilter(v8::Local<v8::Function> const LocalFilterFunction, const bool bEarly) {
		if (!m_bInitialized || !m_pIsolate || LocalFilterFunction.IsEmpty()) {
			return false;
		}

		return AddStoredFunction(m_pIsolate, bEarly ? m_vecEarlySayCommandFilters : m_vecSayCommandFilters, LocalFilterFunction);
	}

	bool V8Runtime::RemoveSayCommandFilter(v8::Local<v8::Function> const LocalFilterFunction, const bool bEarly) {
		if (!m_bInitialized || !m_pIsolate || LocalFilterFunction.IsEmpty()) {
			return false;
		}

		return RemoveStoredFunction(m_pIsolate, bEarly ? m_vecEarlySayCommandFilters : m_vecSayCommandFilters, LocalFilterFunction);
	}

	bool V8Runtime::DispatchSayCommand(const int nClientIndex, std::string const& strMessageText, const bool bTeamOnly) {
		constexpr std::size_t kCommandNameArgumentIndex = 0;
		constexpr char kCommandKind[] = "say";

		if (!m_bInitialized || !m_pIsolate || strMessageText.empty()) {
			return false;
		}

		std::vector<std::string> const vecArguments = SplitCommandText(strMessageText);
		std::string const strCommandName = vecArguments.empty() ? "" : vecArguments[kCommandNameArgumentIndex];
		if (strCommandName.empty() && m_vecEarlySayCommandFilters.empty() && m_vecSayCommandFilters.empty()) {
			return false;
		}

		v8::Isolate::Scope IsolateScope(m_pIsolate);
		v8::HandleScope HandleScope(m_pIsolate);
		ClientConsoleLogScope ClientLogScope(nClientIndex);

		std::vector<ScriptCallbackSnapshotRecord> const vecEarlySayCommandFilters = SnapshotStoredFunctions(m_pIsolate, m_vecEarlySayCommandFilters);
		std::vector<ScriptCallbackSnapshotRecord> const vecSayCommandFilters = SnapshotStoredFunctions(m_pIsolate, m_vecSayCommandFilters);

		for (auto const* const pFilters : { &vecEarlySayCommandFilters, &vecSayCommandFilters }) {
			for (auto const& CallbackRecord : *pFilters) {
				bool bBlocksCommand = false;
				if (CallCommandCallback(m_pIsolate, CallbackRecord.m_Context, CallbackRecord.m_Function, kCommandKind, strCommandName, strMessageText, nClientIndex, vecArguments, &strMessageText, &bTeamOnly, bBlocksCommand) && bBlocksCommand) {
					return true;
				}
			}
		}

		auto itSayCommandCallbacks = m_mapSayCommandCallbacks.find(strCommandName);
		if (itSayCommandCallbacks == m_mapSayCommandCallbacks.end()) {
			return false;
		}

		std::vector<ScriptCallbackSnapshotRecord> const vecSayCommandCallbacks = SnapshotStoredFunctions(m_pIsolate, itSayCommandCallbacks->second);
		for (std::size_t unSayCommandCallbackIndex = 0; unSayCommandCallbackIndex < vecSayCommandCallbacks.size(); ++unSayCommandCallbackIndex) {
			ScriptCallbackSnapshotRecord const& CallbackRecord = vecSayCommandCallbacks[unSayCommandCallbackIndex];
			bool bBlocksCommand = false;
			if (!CallCommandCallback(m_pIsolate, CallbackRecord.m_Context, CallbackRecord.m_Function, kCommandKind, strCommandName, strMessageText, nClientIndex, vecArguments, &strMessageText, &bTeamOnly, bBlocksCommand)) {
				continue;
			}

			if (bBlocksCommand) {
				return true;
			}
		}

		return false;
	}

	v8::Local<v8::Object> V8Runtime::GetSourceJSObject(v8::Isolate* const pIsolate) const {
		if (!pIsolate || (pIsolate != m_pIsolate)) {
			return {};
		}

		v8::Local<v8::Context> const LocalContext = pIsolate->GetCurrentContext();
		if (!LocalContext.IsEmpty()) {
			auto const* const pPluginRuntimeRecord = FindPluginRuntimeRecord(LocalContext);
			if (pPluginRuntimeRecord && !pPluginRuntimeRecord->m_SourceJSObject.IsEmpty()) {
				return pPluginRuntimeRecord->m_SourceJSObject.Get(pIsolate);
			}
		}

		if (m_SourceJSObject.IsEmpty()) {
			return {};
		}

		return m_SourceJSObject.Get(pIsolate);
	}

	v8::Isolate* V8Runtime::GetIsolate() const noexcept {
		return m_pIsolate;
	}

	v8::Platform* V8Runtime::GetPlatform() const noexcept {
		return m_pPlatform.get();
	}

	v8::Local<v8::Context> V8Runtime::GetContext(v8::Isolate* const pIsolate) const noexcept {
		if (!pIsolate || (pIsolate != m_pIsolate) || m_V8Context.IsEmpty()) {
			return {};
		}

		return m_V8Context.Get(pIsolate);
	}

	RuntimePaths const* V8Runtime::GetRuntimePaths() const noexcept {
		return m_pRuntimePaths;
	}

	bool V8Runtime::GetCurrentPluginName(v8::Isolate* const pIsolate, std::string& strPluginNameOut) const {
		if (!pIsolate || (pIsolate != m_pIsolate)) {
			return false;
		}

		v8::Local<v8::Context> const LocalContext = pIsolate->GetCurrentContext();
		if (LocalContext.IsEmpty()) {
			return false;
		}

		for (auto itPluginRuntime = m_mapPluginRuntimes.begin(); itPluginRuntime != m_mapPluginRuntimes.end(); ++itPluginRuntime) {
			if (!itPluginRuntime->second.m_Context.IsEmpty() && (itPluginRuntime->second.m_Context.Get(pIsolate) == LocalContext)) {
				strPluginNameOut = itPluginRuntime->first;
				return true;
			}
		}

		if (m_V8Context.IsEmpty() || (m_V8Context.Get(pIsolate) != LocalContext)) {
			return false;
		}

		strPluginNameOut.clear();

		return true;
	}

	bool V8Runtime::IsInitialized() const noexcept {
		return m_bInitialized;
	}

	bool V8Runtime::QueueAsyncRequest(v8::Local<v8::Function> const LocalCallbackFunction, std::function<AsyncRequestResult()> const& Task, std::function<v8::MaybeLocal<v8::Value>(v8::Isolate*, v8::Local<v8::Context>, std::any const&)> const& ConvertResult) {
		if (!m_bInitialized || !m_pIsolate || LocalCallbackFunction.IsEmpty() || !Task || !ConvertResult || (m_unNextAsyncRequestID == std::numeric_limits<std::uint64_t>::max())) {
			return false;
		}

		v8::Local<v8::Context> const LocalContext = m_pIsolate->GetCurrentContext();
		if (LocalContext.IsEmpty()) {
			return false;
		}

		const bool bRootContext = !m_V8Context.IsEmpty() && (m_V8Context.Get(m_pIsolate) == LocalContext);
		if (!bRootContext && !FindPluginRuntimeRecord(LocalContext)) {
			return false;
		}

		const std::uint64_t unRequestID = ++m_unNextAsyncRequestID;
		AsyncRequestCallbackRecord CallbackRecord {};
		try {
			CallbackRecord.m_Context.Reset(m_pIsolate, LocalContext);
			CallbackRecord.m_Function.Reset(m_pIsolate, LocalCallbackFunction);
			CallbackRecord.m_ConvertResult = ConvertResult;

			std::pair<std::map<std::uint64_t, AsyncRequestCallbackRecord>::iterator, bool> const AsyncCallbackInsertResult = m_mapAsyncRequestCallbacks.emplace(unRequestID, std::move(CallbackRecord));
			if (!AsyncCallbackInsertResult.second) {
				return false;
			}

			if (!QueueAsyncRequestRecord(unRequestID, Task)) {
				AsyncCallbackInsertResult.first->second.m_Function.Reset();
				AsyncCallbackInsertResult.first->second.m_Context.Reset();
				m_mapAsyncRequestCallbacks.erase(AsyncCallbackInsertResult.first);
				return false;
			}
		} catch (...) {
			auto itAsyncCallback = m_mapAsyncRequestCallbacks.find(unRequestID);
			if (itAsyncCallback != m_mapAsyncRequestCallbacks.end()) {
				itAsyncCallback->second.m_Function.Reset();
				itAsyncCallback->second.m_Context.Reset();
				m_mapAsyncRequestCallbacks.erase(itAsyncCallback);
			}

			return false;
		}

		return true;
	}

	bool V8Runtime::QueueAsyncTask(std::function<AsyncRequestResult()> const& Task) {
		if (!m_bInitialized || !Task) {
			return false;
		}

		return QueueAsyncRequestRecord(0, Task);
	}

	bool V8Runtime::RunRequestOnDedicatedThread(std::function<AsyncRequestResult()> const& Task, AsyncRequestResult& ResultOut) {
		if (!m_bInitialized || !Task) {
			return false;
		}

		{
			std::lock_guard<std::mutex> Lock(m_AsyncRequestMutex);
			if (!m_bAcceptAsyncRequests) {
				return false;
			}
		}

		AsyncRequestResult RequestResult {};
		try {
			std::thread RequestThread([Task, &RequestResult]() {
				try {
					RequestResult = Task();
				} catch (...) {
					RequestResult.m_Exception = std::current_exception();
				}
			});

			RequestThread.join();
			if (RequestResult.m_Exception) {
				try {
					std::rethrow_exception(RequestResult.m_Exception);
				} catch (std::exception const& Exception) {
					RequestResult.m_strError = Exception.what();
				} catch (...) {
					RequestResult.m_strError = "Unknown dedicated worker request failure.";
				}

				RequestResult.m_Exception = nullptr;
			}
		} catch (...) {
			return false;
		}

		ResultOut = std::move(RequestResult);

		return true;
	}

	V8Runtime::AsyncRequestCompletionScope::AsyncRequestCompletionScope(V8Runtime* const pRuntime, AsyncRequestRecord* const pRequestRecord) :
		m_pRuntime(pRuntime),
		m_pRequestRecord(pRequestRecord)
	{
	}

	V8Runtime::AsyncRequestCompletionScope::~AsyncRequestCompletionScope() {
		if (m_pRuntime) {
			m_pRuntime->RetireAsyncRequest(m_pRequestRecord);
			return;
		}

		m_pRequestRecord->m_bResultConsumed.store(true);
		m_pRequestRecord->m_bResultConsumed.notify_one();
		m_pRequestRecord->m_Thread.join();
	}

	void V8Runtime::ConsumeAsyncRequestResult(AsyncRequestRecord* const pRequestRecord) {
		pRequestRecord->m_bResultConsumed.wait(false);
		pRequestRecord->m_Result = {};
		pRequestRecord->m_Task = {};
		pRequestRecord->m_bCleanupComplete.store(true);
	}

	void V8Runtime::RunBlockingAsyncRequest(AsyncRequestRecord* const pRequestRecord) {
		try {
			pRequestRecord->m_Result = pRequestRecord->m_Task();
		} catch (...) {
			pRequestRecord->m_Result.m_Exception = std::current_exception();
		}

		pRequestRecord->m_bResultReady.store(true);
		pRequestRecord->m_bResultReady.notify_one();
		ConsumeAsyncRequestResult(pRequestRecord);
	}

	void V8Runtime::RetireAsyncRequest(AsyncRequestRecord* const pRequestRecord) {
		for (auto itAsyncRequest = m_lstActiveAsyncRequests.begin(); itAsyncRequest != m_lstActiveAsyncRequests.end(); ++itAsyncRequest) {
			if (itAsyncRequest->get() != pRequestRecord) {
				continue;
			}

			m_lstRetiredAsyncRequests.splice(m_lstRetiredAsyncRequests.end(), m_lstActiveAsyncRequests, itAsyncRequest);
			pRequestRecord->m_bResultConsumed.store(true);
			pRequestRecord->m_bResultConsumed.notify_one();

			// A callback may have stopped the runtime while this node was isolated in the active list.
			if (!m_bAcceptAsyncRequests) {
				pRequestRecord->m_Thread.join();
				m_lstRetiredAsyncRequests.erase(itAsyncRequest);
			}

			return;
		}
	}

	void V8Runtime::ReapAsyncRequests() {
		for (auto itAsyncRequest = m_lstRetiredAsyncRequests.begin(); itAsyncRequest != m_lstRetiredAsyncRequests.end();) {
			if (!(*itAsyncRequest)->m_bCleanupComplete.load()) {
				++itAsyncRequest;
				continue;
			}

			(*itAsyncRequest)->m_Thread.join();
			itAsyncRequest = m_lstRetiredAsyncRequests.erase(itAsyncRequest);
		}
	}

	bool V8Runtime::RunBlockingRequest(v8::Local<v8::Function> const LocalCallbackFunction, std::function<AsyncRequestResult()> const& Task, std::function<v8::MaybeLocal<v8::Value>(v8::Isolate*, v8::Local<v8::Context>, std::any const&)> const& ConvertResult) {
		constexpr int kCallbackArgumentCount = 2;
		constexpr char kResultConversionErrorMessage[] = "Blocking request result conversion failed.";

		if (!m_bInitialized || !m_pIsolate || LocalCallbackFunction.IsEmpty() || !Task || !ConvertResult) {
			return false;
		}

		v8::Local<v8::Context> const LocalContext = m_pIsolate->GetCurrentContext();
		if (LocalContext.IsEmpty()) {
			return false;
		}

		const bool bRootContext = !m_V8Context.IsEmpty() && (m_V8Context.Get(m_pIsolate) == LocalContext);
		if (!bRootContext && !FindPluginRuntimeRecord(LocalContext)) {
			return false;
		}

		{
			std::lock_guard<std::mutex> Lock(m_AsyncRequestMutex);
			if (!m_bAcceptAsyncRequests) {
				return false;
			}
		}

		AsyncRequestRecord RequestRecord {};
		try {
			RequestRecord.m_Task = Task;
			RequestRecord.m_Thread = std::thread(&V8Runtime::RunBlockingAsyncRequest, &RequestRecord);
		} catch (...) {
			return false;
		}

		AsyncRequestCompletionScope CompletionScope(nullptr, &RequestRecord);
		RequestRecord.m_bResultReady.wait(false);
		AsyncRequestResult& RequestResult = RequestRecord.m_Result;
		if (RequestResult.m_Exception) {
			try {
				std::rethrow_exception(RequestResult.m_Exception);
			} catch (std::exception const& Exception) {
				RequestResult.m_strError = Exception.what();
			} catch (...) {
				RequestResult.m_strError = "Unknown dedicated worker request failure.";
			}
		}

		v8::TryCatch CallbackTryCatch(m_pIsolate);
		std::string strError = std::move(RequestResult.m_strError);
		v8::Local<v8::Value> LocalResultValue = v8::Undefined(m_pIsolate);
		if (strError.empty()) {
			try {
				const bool bConverted = ConvertResult(m_pIsolate, LocalContext, RequestResult.m_Value).ToLocal(&LocalResultValue);
				if (!bConverted || CallbackTryCatch.HasCaught()) {
					strError = CallbackTryCatch.HasCaught() ? FormatException(CallbackTryCatch) : kResultConversionErrorMessage;
				}
			} catch (...) {
				strError = kResultConversionErrorMessage;
			}
		}

		CallbackTryCatch.Reset();
		v8::Local<v8::Value> LocalErrorValue = v8::Null(m_pIsolate);
		if (!strError.empty()) {
			LocalResultValue = v8::Undefined(m_pIsolate);
			v8::Local<v8::String> LocalErrorMessage {};
			if (!MakeRuntimeString(m_pIsolate, strError, LocalErrorMessage)) {
				LogError("RunBlockingRequest failed Stage=ErrorValue");
				return false;
			}

			LocalErrorValue = v8::Exception::Error(LocalErrorMessage);
		}

		v8::Local<v8::Value> arrCallbackArguments[kCallbackArgumentCount] = { LocalErrorValue, LocalResultValue };
		v8::Local<v8::Value> LocalCallbackResult {};
		if (!LocalCallbackFunction->Call(LocalContext, LocalContext->Global(), kCallbackArgumentCount, arrCallbackArguments).ToLocal(&LocalCallbackResult)) {
			LogError("RunBlockingRequest failed Stage=Callback Error=\"%s\"", FormatException(CallbackTryCatch).c_str());
		}

		return true;
	}

	bool V8Runtime::QueueAsyncRequestRecord(const std::uint64_t unRequestID, std::function<AsyncRequestResult()> const& Task) {
		if (!Task) {
			return false;
		}

		std::unique_ptr<AsyncRequestRecord> RequestRecordOwner {};
		AsyncRequestRecord* pRequestRecord = nullptr;
		try {
			RequestRecordOwner = std::make_unique<AsyncRequestRecord>();
			RequestRecordOwner->m_unID = unRequestID;
			RequestRecordOwner->m_Task = Task;
			RequestRecordOwner->m_pNextCompletion = nullptr;
			pRequestRecord = RequestRecordOwner.get();

			{
				std::lock_guard<std::mutex> Lock(m_AsyncRequestMutex);
				if (!m_bAcceptAsyncRequests || ((m_lstAsyncRequests.size() + m_lstActiveAsyncRequests.size() + m_lstRetiredAsyncRequests.size()) >= kMaximumConcurrentAsyncRequests)) {
					return false;
				}

				m_lstAsyncRequests.push_back(std::move(RequestRecordOwner));
			}

			pRequestRecord->m_Thread = std::thread(&V8Runtime::RunAsyncRequest, this, pRequestRecord);
		} catch (...) {
			if (pRequestRecord) {
				for (auto itAsyncRequest = m_lstAsyncRequests.begin(); itAsyncRequest != m_lstAsyncRequests.end(); ++itAsyncRequest) {
					if (itAsyncRequest->get() == pRequestRecord) {
						m_lstAsyncRequests.erase(itAsyncRequest);
						break;
					}
				}
			}

			return false;
		}

		return true;
	}

	bool V8Runtime::DeliverAsyncRequest(AsyncRequestRecord* const pCompletionRecord) {
		constexpr int kCallbackArgumentCount = 2;
		constexpr char kResultConversionErrorMessage[] = "Asynchronous request result conversion failed.";

		auto itAsyncRequest = m_lstAsyncRequests.begin();
		while ((itAsyncRequest != m_lstAsyncRequests.end()) && (itAsyncRequest->get() != pCompletionRecord)) {
			++itAsyncRequest;
		}

		if (itAsyncRequest == m_lstAsyncRequests.end()) {
			return false;
		}

		m_lstActiveAsyncRequests.splice(m_lstActiveAsyncRequests.end(), m_lstAsyncRequests, itAsyncRequest);
		// Destroy converter/V8 captures before acknowledging native cleanup, including every early exit.
		AsyncRequestCompletionScope CompletionScope(this, pCompletionRecord);

		// Take callback ownership before exception formatting can allocate or throw.
		AsyncRequestCallbackRecord CallbackRecord {};
		if (pCompletionRecord->m_unID) {
			auto itAsyncCallback = m_mapAsyncRequestCallbacks.find(pCompletionRecord->m_unID);
			if (itAsyncCallback == m_mapAsyncRequestCallbacks.end()) {
				return false;
			}

			CallbackRecord = std::move(itAsyncCallback->second);
			m_mapAsyncRequestCallbacks.erase(itAsyncCallback);
		}

		if (pCompletionRecord->m_Result.m_Exception) {
			try {
				std::rethrow_exception(pCompletionRecord->m_Result.m_Exception);
			} catch (std::exception const& Exception) {
				pCompletionRecord->m_Result.m_strError = Exception.what();
			} catch (...) {
				pCompletionRecord->m_Result.m_strError = "Unknown asynchronous request failure.";
			}
		}

		if (!pCompletionRecord->m_unID) {
			if (!pCompletionRecord->m_Result.m_strError.empty()) {
				LogError("DeliverAsyncRequest failed Stage=Cleanup Error=\"%s\"", pCompletionRecord->m_Result.m_strError.c_str());
			}

			return false;
		}

		v8::Isolate::Scope IsolateScope(m_pIsolate);
		v8::HandleScope HandleScope(m_pIsolate);
		v8::Local<v8::Context> const LocalContext = CallbackRecord.m_Context.Get(m_pIsolate);
		v8::Local<v8::Function> const LocalCallbackFunction = CallbackRecord.m_Function.Get(m_pIsolate);
		if (LocalContext.IsEmpty() || LocalCallbackFunction.IsEmpty()) {
			CallbackRecord.m_Function.Reset();
			CallbackRecord.m_Context.Reset();
			return false;
		}

		v8::Context::Scope ContextScope(LocalContext);
		v8::TryCatch CallbackTryCatch(m_pIsolate);
		std::string strError = std::move(pCompletionRecord->m_Result.m_strError);
		v8::Local<v8::Value> LocalResultValue = v8::Undefined(m_pIsolate);
		if (strError.empty()) {
			try {
				const bool bConverted = CallbackRecord.m_ConvertResult(m_pIsolate, LocalContext, pCompletionRecord->m_Result.m_Value).ToLocal(&LocalResultValue);
				if (!bConverted || CallbackTryCatch.HasCaught()) {
					strError = CallbackTryCatch.HasCaught() ? FormatException(CallbackTryCatch) : kResultConversionErrorMessage;
				}
			} catch (...) {
				strError = kResultConversionErrorMessage;
			}
		}

		CallbackTryCatch.Reset();
		v8::Local<v8::Value> LocalErrorValue = v8::Null(m_pIsolate);
		if (!strError.empty()) {
			LocalResultValue = v8::Undefined(m_pIsolate);
			v8::Local<v8::String> LocalErrorMessage {};
			if (!MakeRuntimeString(m_pIsolate, strError, LocalErrorMessage)) {
				LogError("DeliverAsyncRequest failed Stage=ErrorValue");
				CallbackRecord.m_Function.Reset();
				CallbackRecord.m_Context.Reset();
				return false;
			}

			LocalErrorValue = v8::Exception::Error(LocalErrorMessage);
		}

		v8::Local<v8::Value> arrCallbackArguments[kCallbackArgumentCount] = { LocalErrorValue, LocalResultValue };
		v8::Local<v8::Value> LocalCallbackResult {};
		if (!LocalCallbackFunction->Call(LocalContext, LocalContext->Global(), kCallbackArgumentCount, arrCallbackArguments).ToLocal(&LocalCallbackResult)) {
			LogError("DeliverAsyncRequest failed Stage=Callback Error=\"%s\"", FormatException(CallbackTryCatch).c_str());
		}

		CallbackRecord.m_Function.Reset();
		CallbackRecord.m_Context.Reset();

		return true;
	}

	bool V8Runtime::WaitForAsyncRequest(v8::Local<v8::Function> const LocalCallbackFunction) {
		if (!m_bInitialized || !m_pIsolate || LocalCallbackFunction.IsEmpty()) {
			return false;
		}

		v8::Local<v8::Context> const LocalContext = m_pIsolate->GetCurrentContext();
		if (LocalContext.IsEmpty()) {
			return false;
		}

		std::uint64_t unRequestID = 0;
		for (auto const& CallbackEntry : m_mapAsyncRequestCallbacks) {
			if ((CallbackEntry.second.m_Context.Get(m_pIsolate) == LocalContext) && (CallbackEntry.second.m_Function.Get(m_pIsolate) == LocalCallbackFunction)) {
				unRequestID = CallbackEntry.first;
				break;
			}
		}

		if (!unRequestID) {
			return false;
		}

		AsyncRequestRecord* pSelectedRequest = nullptr;
		for (auto const& RequestOwner : m_lstAsyncRequests) {
			if (RequestOwner->m_unID == unRequestID) {
				pSelectedRequest = RequestOwner.get();
				break;
			}
		}

		if (!pSelectedRequest) {
			return false;
		}

		// Wait only for this result; the worker remains alive to clean it up after callback consumption.
		pSelectedRequest->m_bResultReady.wait(false);

		{
			std::lock_guard<std::mutex> Lock(m_AsyncRequestMutex);
			AsyncRequestRecord* pPreviousCompletion = nullptr;
			auto* pCompletionRecord = m_pFirstAsyncCompletion;
			while (pCompletionRecord && (pCompletionRecord != pSelectedRequest)) {
				pPreviousCompletion = pCompletionRecord;
				pCompletionRecord = pCompletionRecord->m_pNextCompletion;
			}

			if (!pCompletionRecord) {
				return false;
			}

			if (pPreviousCompletion) {
				pPreviousCompletion->m_pNextCompletion = pSelectedRequest->m_pNextCompletion;

			} else {
				m_pFirstAsyncCompletion = pSelectedRequest->m_pNextCompletion;
			}

			if (m_pLastAsyncCompletion == pSelectedRequest) {
				m_pLastAsyncCompletion = pPreviousCompletion;
			}

			pSelectedRequest->m_pNextCompletion = nullptr;
		}

		return DeliverAsyncRequest(pSelectedRequest);
	}

	void V8Runtime::ProcessAsyncRequests() {
		if (!m_bInitialized || !m_pIsolate) {
			return;
		}

		ReapAsyncRequests();

		// Callbacks may enqueue more work; bound this pump to the number already completed.
		std::size_t unCompletionCount = 0;
		{
			std::lock_guard<std::mutex> Lock(m_AsyncRequestMutex);
			for (auto* pCompletionRecord = m_pFirstAsyncCompletion; pCompletionRecord; pCompletionRecord = pCompletionRecord->m_pNextCompletion) {
				++unCompletionCount;
			}
		}

		for (std::size_t unCompletionIndex = 0; unCompletionIndex < unCompletionCount; ++unCompletionIndex) {
			AsyncRequestRecord* pCompletionRecord = nullptr;
			{
				std::lock_guard<std::mutex> Lock(m_AsyncRequestMutex);
				pCompletionRecord = m_pFirstAsyncCompletion;
				if (!pCompletionRecord) {
					return;
				}

				m_pFirstAsyncCompletion = pCompletionRecord->m_pNextCompletion;
				if (!m_pFirstAsyncCompletion) {
					m_pLastAsyncCompletion = nullptr;
				}

				pCompletionRecord->m_pNextCompletion = nullptr;
			}

			DeliverAsyncRequest(pCompletionRecord);
		}

		ReapAsyncRequests();
	}

	void V8Runtime::RunAsyncRequest(AsyncRequestRecord* const pRequestRecord) {
		if (!pRequestRecord) {
			return;
		}

		try {
			pRequestRecord->m_Result = pRequestRecord->m_Task();
		} catch (...) {
			pRequestRecord->m_Result.m_Exception = std::current_exception();
		}

		// A publication failure cannot leave a request waiting forever or escape the thread entry.
		try {
			std::lock_guard<std::mutex> Lock(m_AsyncRequestMutex);
			if (m_pLastAsyncCompletion) {
				m_pLastAsyncCompletion->m_pNextCompletion = pRequestRecord;

			} else {
				m_pFirstAsyncCompletion = pRequestRecord;
			}

			m_pLastAsyncCompletion = pRequestRecord;
			pRequestRecord->m_bResultReady.store(true);
		} catch (...) {
			LogError("RunAsyncRequest failed Stage=PublishCompletion Reason=\"C++ exception\"");
			std::terminate();
		}

		pRequestRecord->m_bResultReady.notify_one();
		ConsumeAsyncRequestResult(pRequestRecord);
	}

	void V8Runtime::StopAsyncRequests() {
		{
			std::lock_guard<std::mutex> Lock(m_AsyncRequestMutex);
			m_bAcceptAsyncRequests = false;
		}

		if (m_pIsolate) {
			v8::Isolate::Scope IsolateScope(m_pIsolate);
			v8::HandleScope HandleScope(m_pIsolate);
			for (auto itAsyncCallback = m_mapAsyncRequestCallbacks.begin(); itAsyncCallback != m_mapAsyncRequestCallbacks.end(); ++itAsyncCallback) {
				itAsyncCallback->second.m_Function.Reset();
				itAsyncCallback->second.m_Context.Reset();
			}
		}

		m_mapAsyncRequestCallbacks.clear();
		for (auto const& RequestOwner : m_lstAsyncRequests) {
			RequestOwner->m_bResultConsumed.store(true);
			RequestOwner->m_bResultConsumed.notify_one();
		}

		for (auto const& RequestOwner : m_lstRetiredAsyncRequests) {
			RequestOwner->m_bResultConsumed.store(true);
			RequestOwner->m_bResultConsumed.notify_one();
		}

		for (auto const& RequestOwner : m_lstAsyncRequests) {
			RequestOwner->m_Thread.join();
		}

		for (auto const& RequestOwner : m_lstRetiredAsyncRequests) {
			RequestOwner->m_Thread.join();
		}

		m_lstAsyncRequests.clear();
		m_lstRetiredAsyncRequests.clear();

		std::lock_guard<std::mutex> Lock(m_AsyncRequestMutex);
		m_pFirstAsyncCompletion = nullptr;
		m_pLastAsyncCompletion = nullptr;
	}

	void V8Runtime::RemoveAsyncRequestsForContext(v8::Local<v8::Context> const LocalContext) {
		if (!m_pIsolate || LocalContext.IsEmpty()) {
			return;
		}

		for (auto itAsyncCallback = m_mapAsyncRequestCallbacks.begin(); itAsyncCallback != m_mapAsyncRequestCallbacks.end();) {
			if (itAsyncCallback->second.m_Context.IsEmpty() || (itAsyncCallback->second.m_Context.Get(m_pIsolate) != LocalContext)) {
				++itAsyncCallback;
				continue;
			}

			itAsyncCallback->second.m_Function.Reset();
			itAsyncCallback->second.m_Context.Reset();
			itAsyncCallback = m_mapAsyncRequestCallbacks.erase(itAsyncCallback);
		}
	}

	bool V8Runtime::InstallRuntimeObjects(v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object>& LocalSourceJSOut) {
		if (!m_pIsolate || !m_pRuntimePaths || LocalContext.IsEmpty()) {
			return false;
		}

		v8::Local<v8::Object> const LocalSourceJS = v8::Object::New(m_pIsolate);
		v8::Local<v8::Object> const LocalGlobalObject = LocalContext->Global();
		if (LocalSourceJS.IsEmpty() || LocalGlobalObject.IsEmpty()) {
			return false;
		}

		if (!InstallSourceJSModules(*this, *m_pRuntimePaths, m_pIsolate, LocalContext, LocalSourceJS)) {
			return false;
		}

		v8::Local<v8::String> LocalSourceJSName {};
		if (!v8::String::NewFromUtf8(m_pIsolate, "sourcejs", v8::NewStringType::kNormal).ToLocal(&LocalSourceJSName)) {
			return false;
		}

		if (!LocalGlobalObject->Set(LocalContext, LocalSourceJSName, LocalSourceJS).FromMaybe(false)) {
			return false;
		}

		v8::Local<v8::String> LocalSourceAliasName {};
		if (!v8::String::NewFromUtf8(m_pIsolate, "source", v8::NewStringType::kNormal).ToLocal(&LocalSourceAliasName)) {
			return false;
		}

		if (!LocalGlobalObject->Set(LocalContext, LocalSourceAliasName, LocalSourceJS).FromMaybe(false)) {
			return false;
		}

		if (!LocalSourceJS->SetIntegrityLevel(LocalContext, v8::IntegrityLevel::kFrozen).FromMaybe(false)) {
			return false;
		}

		LocalSourceJSOut = LocalSourceJS;

		return true;
	}

	PluginRuntimeRecord* V8Runtime::FindPluginRuntimeRecord(v8::Local<v8::Context> const LocalContext) noexcept {
		if (!m_pIsolate || LocalContext.IsEmpty()) {
			return nullptr;
		}

		for (auto itPluginRuntime = m_mapPluginRuntimes.begin(); itPluginRuntime != m_mapPluginRuntimes.end(); ++itPluginRuntime) {
			if (!itPluginRuntime->second.m_Context.IsEmpty() && (itPluginRuntime->second.m_Context.Get(m_pIsolate) == LocalContext)) {
				return &itPluginRuntime->second;
			}
		}

		return nullptr;
	}

	PluginRuntimeRecord const* V8Runtime::FindPluginRuntimeRecord(v8::Local<v8::Context> const LocalContext) const noexcept {
		if (!m_pIsolate || LocalContext.IsEmpty()) {
			return nullptr;
		}

		for (auto itPluginRuntime = m_mapPluginRuntimes.begin(); itPluginRuntime != m_mapPluginRuntimes.end(); ++itPluginRuntime) {
			if (!itPluginRuntime->second.m_Context.IsEmpty() && (itPluginRuntime->second.m_Context.Get(m_pIsolate) == LocalContext)) {
				return &itPluginRuntime->second;
			}
		}

		return nullptr;
	}

	void V8Runtime::RemoveCallbacksForContext(v8::Local<v8::Context> const LocalContext) {
		constexpr char kServerOutputEventName[] = "ServerOutput";

		if (!m_pIsolate || LocalContext.IsEmpty()) {
			return;
		}

		for (auto itEventCallbacks = m_mapEventCallbacks.begin(); itEventCallbacks != m_mapEventCallbacks.end();) {
			RemoveStoredFunctionsForContext(m_pIsolate, itEventCallbacks->second, LocalContext);

			if (itEventCallbacks->second.empty()) {
				itEventCallbacks = m_mapEventCallbacks.erase(itEventCallbacks);

			} else {
				++itEventCallbacks;
			}
		}

		if (!HasEventCallbacks(kServerOutputEventName)) {
			g_Application.SetServerOutputHookEnabled(false);
		}

		bool bGameEventListenersChanged = false;
		for (auto itGameEventCallbacks = m_mapGameEventCallbacks.begin(); itGameEventCallbacks != m_mapGameEventCallbacks.end();) {
			RemoveStoredFunctionsForContext(m_pIsolate, itGameEventCallbacks->second, LocalContext);

			if (itGameEventCallbacks->second.empty()) {
				itGameEventCallbacks = m_mapGameEventCallbacks.erase(itGameEventCallbacks);
				bGameEventListenersChanged = true;

			} else {
				++itGameEventCallbacks;
			}
		}

		if (bGameEventListenersChanged && !RebuildGameEventListeners()) {
			LogError("RemoveCallbacksForContext failed Stage=RebuildGameEventListeners");
		}

		for (auto itCommandCallbacks = m_mapCommandCallbacks.begin(); itCommandCallbacks != m_mapCommandCallbacks.end();) {
			RemoveStoredFunctionsForContext(m_pIsolate, itCommandCallbacks->second, LocalContext);

			if (!itCommandCallbacks->second.empty()) {
				++itCommandCallbacks;
				continue;
			}

			auto itRegisteredCommand = m_mapRegisteredCommands.find(itCommandCallbacks->first);
			if (itRegisteredCommand != m_mapRegisteredCommands.end()) {
				if (itRegisteredCommand->second.m_pCommand && itRegisteredCommand->second.m_pCommand->IsRegistered()) {
					g_Application.GetEngineInterfaces().UnregisterConCommand(itRegisteredCommand->second.m_pCommand.get());
				}

				m_mapRegisteredCommands.erase(itRegisteredCommand);
			}

			itCommandCallbacks = m_mapCommandCallbacks.erase(itCommandCallbacks);
		}

		for (auto itClientCommandCallbacks = m_mapClientCommandCallbacks.begin(); itClientCommandCallbacks != m_mapClientCommandCallbacks.end();) {
			RemoveStoredFunctionsForContext(m_pIsolate, itClientCommandCallbacks->second, LocalContext);

			if (itClientCommandCallbacks->second.empty()) {
				itClientCommandCallbacks = m_mapClientCommandCallbacks.erase(itClientCommandCallbacks);

			} else {
				++itClientCommandCallbacks;
			}
		}

		for (auto itSayCommandCallbacks = m_mapSayCommandCallbacks.begin(); itSayCommandCallbacks != m_mapSayCommandCallbacks.end();) {
			RemoveStoredFunctionsForContext(m_pIsolate, itSayCommandCallbacks->second, LocalContext);

			if (itSayCommandCallbacks->second.empty()) {
				itSayCommandCallbacks = m_mapSayCommandCallbacks.erase(itSayCommandCallbacks);

			} else {
				++itSayCommandCallbacks;
			}
		}

		RemoveStoredFunctionsForContext(m_pIsolate, m_vecClientCommandFilters, LocalContext);
		RemoveStoredFunctionsForContext(m_pIsolate, m_vecEarlySayCommandFilters, LocalContext);
		RemoveStoredFunctionsForContext(m_pIsolate, m_vecSayCommandFilters, LocalContext);
		RemoveAsyncRequestsForContext(LocalContext);
	}

	bool V8Runtime::ReadFile(std::filesystem::path const& PathScript, std::string& strSourceOut) {
		constexpr std::size_t kReadBufferByteCount = 4096;

		if (PathScript.empty()) {
			return false;
		}

		std::ifstream InputFile { PathScript, std::ios::binary };
		if (!InputFile) {
			return false;
		}

		std::string strSource {};
		char arrBuffer[kReadBufferByteCount] {};
		while (InputFile) {
			InputFile.read(arrBuffer, static_cast<std::streamsize>(kReadBufferByteCount));
			const std::streamsize nReadByteCount = InputFile.gcount();
			if (nReadByteCount > 0) {
				strSource.append(arrBuffer, static_cast<std::size_t>(nReadByteCount));
			}
		}

		if (!InputFile.eof() || InputFile.bad()) {
			return false;
		}

		strSourceOut = std::move(strSource);

		return true;
	}

	std::string V8Runtime::FormatException(v8::TryCatch const& ExceptionTryCatch) const {
		constexpr char kExceptionPrefix[] = "V8 exception: ";
		constexpr char kUnknownException[] = "unknown V8 exception";

		if (!m_pIsolate) {
			return std::string(kExceptionPrefix) + kUnknownException;
		}

		v8::Local<v8::Value> const LocalException = ExceptionTryCatch.Exception();
		if (LocalException.IsEmpty()) {
			return std::string(kExceptionPrefix) + kUnknownException;
		}

		v8::String::Utf8Value const ExceptionUTF8Value = v8::String::Utf8Value(m_pIsolate, LocalException);
		char const* const pszExceptionMessage = *ExceptionUTF8Value ? *ExceptionUTF8Value : kUnknownException;

		return std::string(kExceptionPrefix) + pszExceptionMessage;
	}

	void V8Runtime::UnregisterAllCommands() {
		for (auto itRegisteredCommand = m_mapRegisteredCommands.begin(); itRegisteredCommand != m_mapRegisteredCommands.end(); ++itRegisteredCommand) {
			if (itRegisteredCommand->second.m_pCommand && itRegisteredCommand->second.m_pCommand->IsRegistered()) {
				g_Application.GetEngineInterfaces().UnregisterConCommand(itRegisteredCommand->second.m_pCommand.get());
			}
		}

		m_mapRegisteredCommands.clear();
	}
} // namespace SourceJS
