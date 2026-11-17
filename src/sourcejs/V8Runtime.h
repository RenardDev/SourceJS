#pragma once

#ifndef _SOURCEJSV8RUNTIME_H_
#define _SOURCEJSV8RUNTIME_H_

// Compatibility profile (4.1): this canonical guard is the only reserved-name exception.

// General
#include "igameevents.h"

// C++
#include <cstddef>
#include <cstdint>
#include <exception>

// STL
#include <any>
#include <atomic>
#include <filesystem>
#include <functional>
#include <list>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

// V8
// Legacy SDKs define these macros in igameevents.h's platform dependencies.
// Leave them undefined for V8 and the project translation units using this header.
#ifdef min
#undef min
#endif
#ifdef max
#undef max
#endif

#include <libplatform/libplatform.h>
#include <v8.h>

class ConCommand;

// ----------------------------------------------------------------
// V8Runtime
// ----------------------------------------------------------------

namespace SourceJS {

	class RuntimePaths;

	struct ScriptCommandRecord {
		std::string m_strName;
		std::unique_ptr<ConCommand> m_pCommand;
	};

	struct ScriptCallbackRecord {
		v8::Global<v8::Context> m_Context;
		v8::Global<v8::Function> m_Function;
	};

	struct AsyncRequestResult {
		std::string m_strError;
		std::any m_Value;
		std::exception_ptr m_Exception;
	};

	struct AsyncRequestRecord {
		AsyncRequestRecord();

		std::uint64_t m_unID;
		std::function<AsyncRequestResult()> m_Task;
		AsyncRequestResult m_Result;
		AsyncRequestRecord* m_pNextCompletion;
		std::thread m_Thread;
		std::atomic<bool> m_bResultReady;
		std::atomic<bool> m_bResultConsumed;
		std::atomic<bool> m_bCleanupComplete;
	};

	struct AsyncRequestCallbackRecord {
		v8::Global<v8::Context> m_Context;
		v8::Global<v8::Function> m_Function;
		std::function<v8::MaybeLocal<v8::Value>(v8::Isolate*, v8::Local<v8::Context>, std::any const&)> m_ConvertResult;
	};

	struct PluginRuntimeRecord {
		v8::Global<v8::Context> m_Context;
		v8::Global<v8::Object> m_SourceJSObject;
		std::map<std::string, v8::Global<v8::Value>> m_mapPackageModuleCache;
		std::map<std::string, v8::Global<v8::Value>> m_mapLocalModuleCache;
		v8::Global<v8::Value> m_Exports;
		bool m_bUnloading;
	};

	// Runtime operations, registry mutations and V8 handle access are confined to the owning game thread.
	class V8Runtime : public IGameEventListener2 {
	public:
		V8Runtime();
		~V8Runtime() override;

	public:
		// Game-thread confined; an active runtime may be initialized again without reacquisition.
		// After a global V8 initialization attempt, failure/shutdown requires a server-process restart.
		bool Initialize(RuntimePaths const& RuntimePathConfiguration);

		// C++ cleanup failures propagate; destruction or failed V8 disposal terminates after logging.
		void Shutdown();
		bool ExecuteFile(std::filesystem::path const& PathScript, std::string const& strScriptName);
		bool ExecutePluginFile(std::filesystem::path const& PathScript, std::string const& strPluginName);
		bool ExecuteString(std::string const& strSource, std::string const& strScriptName);
		void DispatchAuthenticationCommand(std::vector<std::string> const& vecArguments);
		// Same-plugin reentry leaves cleanup to the outer call; native failures permit retry.
		void UnloadPlugin(std::string const& strPluginName);
		bool RequirePackageModule(std::string const& strModuleName, v8::Local<v8::Value>& LocalModuleOut);
		void InvalidateExtensionModules(std::string const& strExtensionName);
		bool RequirePluginLocalModule(std::string const& strParentScriptName, std::string const& strModuleName, v8::Local<v8::Value>& LocalModuleOut);
		void EmitEvent(std::string const& strEventName, std::string const& strPayload);
		int EmitEventResult(std::string const& strEventName, std::string const& strPayload, const int nDefaultResult, const int nBlockResult);
		// Returns permission, not execution status; both outcomes commit the final rejection message.
		bool IsEventEmissionAllowed(std::string const& strEventName, std::string const& strPayload, std::string& strMessageOut);
		bool AddEventCallback(std::string const& strEventName, v8::Local<v8::Function> const LocalCallbackFunction);
		bool RemoveEventCallback(std::string const& strEventName, v8::Local<v8::Function> const LocalCallbackFunction);
		bool HasEventCallbacks(std::string const& strEventName) const;
		std::size_t GetEventCallbackCount(std::string const& strEventName) const;
		bool AddGameEventCallback(std::string const& strEventName, v8::Local<v8::Function> const LocalCallbackFunction);
		bool RemoveGameEventCallback(std::string const& strEventName, v8::Local<v8::Function> const LocalCallbackFunction);
		void FireGameEvent(IGameEvent* const pEvent) override;
#if defined(EVENT_DEBUG_ID_INIT)
		int GetEventDebugID() noexcept override;
#endif
		bool RegisterCommand(std::string const& strCommandName, v8::Local<v8::Function> const LocalCallbackFunction);
		bool UnregisterCommand(std::string const& strCommandName, v8::Local<v8::Function> const LocalCallbackFunction, const bool bHasCallbackFunction);
		void DispatchCommand(std::string const& strCommandName, std::vector<std::string> const& vecArguments);
		bool RegisterClientCommand(std::string const& strCommandName, v8::Local<v8::Function> const LocalCallbackFunction);
		bool UnregisterClientCommand(std::string const& strCommandName, v8::Local<v8::Function> const LocalCallbackFunction, const bool bHasCallbackFunction);
		bool HasClientCommand(std::string const& strCommandName) const;
		bool OwnsRegisteredCommand(std::string const& strCommandName) const;
		bool AddClientCommandFilter(v8::Local<v8::Function> const LocalFilterFunction);
		bool RemoveClientCommandFilter(v8::Local<v8::Function> const LocalFilterFunction);
		bool DispatchClientCommand(const int nClientIndex, std::vector<std::string> const& vecArguments);
		bool RegisterSayCommand(std::string const& strCommandName, v8::Local<v8::Function> const LocalCallbackFunction);
		bool UnregisterSayCommand(std::string const& strCommandName, v8::Local<v8::Function> const LocalCallbackFunction, const bool bHasCallbackFunction);
		bool AddSayCommandFilter(v8::Local<v8::Function> const LocalFilterFunction, const bool bEarly = false);
		bool RemoveSayCommandFilter(v8::Local<v8::Function> const LocalFilterFunction, const bool bEarly = false);
		bool DispatchSayCommand(const int nClientIndex, std::string const& strMessageText, const bool bTeamOnly);

		// Call these entry points on the runtime's owning thread. Each task runs on its own worker;
		// task captures/results must outlive that work and must not contain thread-confined V8 handles.
		// ConvertResult and the callback run on the owning thread. Blocking waits for its worker and
		// invokes the callback before returning. Pending asynchronous callbacks are delivered by
		// ProcessAsyncRequests() or the selected-request WaitForAsyncRequest() control below.
		// Status reports scheduling/delivery, not backend success; false may follow already executed work.
		// Unload/shutdown can discard queued callbacks without canceling backend work. Request-owned
		// native results/task captures are released by the original worker after delivery or cancellation.
		// Converter/V8 captures remain on the owning thread; frame pumps never wait for native cleanup.
		// Blocking and shutdown also wait for cleanup; shutdown from a callback defers its active node.
		// Failure to publish a worker completion terminates after logging; a lost completion is unrecoverable.
		bool QueueAsyncRequest(v8::Local<v8::Function> const LocalCallbackFunction, std::function<AsyncRequestResult()> const& Task, std::function<v8::MaybeLocal<v8::Value>(v8::Isolate*, v8::Local<v8::Context>, std::any const&)> const& ConvertResult);
		bool RunBlockingRequest(v8::Local<v8::Function> const LocalCallbackFunction, std::function<AsyncRequestResult()> const& Task, std::function<v8::MaybeLocal<v8::Value>(v8::Isolate*, v8::Local<v8::Context>, std::any const&)> const& ConvertResult);
		bool QueueAsyncTask(std::function<AsyncRequestResult()> const& Task);
		// Lower-level blocking transfer: joins before returning ResultOut; its caller owns result cleanup.
		bool RunRequestOnDedicatedThread(std::function<AsyncRequestResult()> const& Task, AsyncRequestResult& ResultOut);
		// Wait/deliver the oldest pending request with this callback in the current context only.
		// Never waits for or delivers unrelated requests; false means no matching request/delivery.
		bool WaitForAsyncRequest(v8::Local<v8::Function> const LocalCallbackFunction);
		void ProcessAsyncRequests();

	public:
		// Use the runtime's isolate; unavailable objects/contexts return empty borrowed handles.
		v8::Local<v8::Object> GetSourceJSObject(v8::Isolate* const pIsolate) const;
		v8::Isolate* GetIsolate() const noexcept;
		v8::Platform* GetPlatform() const noexcept;
		v8::Local<v8::Context> GetContext(v8::Isolate* const pIsolate) const noexcept;
		RuntimePaths const* GetRuntimePaths() const noexcept;
		// Requires the runtime's isolate. Failure preserves output; the root context succeeds with an empty name.
		bool GetCurrentPluginName(v8::Isolate* const pIsolate, std::string& strPluginNameOut) const;
		bool IsInitialized() const noexcept;

	private:
		bool InstallRuntimeObjects(v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object>& LocalSourceJSOut);
		bool ExecuteCommonJS(std::string const& strSource, std::string const& strScriptName, v8::Global<v8::Context> const& GlobalContext, v8::Global<v8::Value>* const pExportsOut);
		bool CallExportFunction(std::string const& strModuleName, v8::Local<v8::Context> const LocalContext, v8::Local<v8::Value> const LocalExportsValue, char const* const pszFunctionName);
		bool CallPluginExportFunction(std::string const& strPluginName, char const* const pszFunctionName);
		PluginRuntimeRecord* FindPluginRuntimeRecord(v8::Local<v8::Context> const LocalContext) noexcept;
		PluginRuntimeRecord const* FindPluginRuntimeRecord(v8::Local<v8::Context> const LocalContext) const noexcept;
		bool RebuildGameEventListeners();
		v8::Local<v8::Object> MakeGameEventView(v8::Local<v8::Context> const LocalContext, IGameEvent* const pEvent, const std::uint64_t unEventToken);
		static V8Runtime* RequireGameEventRuntimeFromArguments(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation, char const* const pszOperation);
		IGameEvent* RequireActiveGameEventFromArguments(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation, char const* const pszOperation);
		static void IsGameEventEmptyCallback(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation);
		static void GetGameEventBooleanCallback(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation);
		static void GetGameEventIntegerCallback(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation);
		template <typename EventType>
		static void GetGameEventUInt64Callback(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation);
		static void GetGameEventFloatCallback(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation);
		static void GetGameEventStringCallback(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation);
		static void SetGameEventBooleanCallback(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation);
		static void SetGameEventIntegerCallback(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation);
		template <typename EventType>
		static void SetGameEventUInt64Callback(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation);
		static void SetGameEventFloatCallback(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation);
		static void SetGameEventStringCallback(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation);
		void RemoveCallbacksForContext(v8::Local<v8::Context> const LocalContext);
		bool ReadFile(std::filesystem::path const& PathScript, std::string& strSourceOut);
		std::string FormatException(v8::TryCatch const& ExceptionTryCatch) const;
		void UnregisterAllCommands();

		class AsyncRequestCompletionScope {
		public:
			AsyncRequestCompletionScope(V8Runtime* const pRuntime, AsyncRequestRecord* const pRequestRecord);
			~AsyncRequestCompletionScope();
			AsyncRequestCompletionScope(AsyncRequestCompletionScope const&) = delete;
			AsyncRequestCompletionScope& operator=(AsyncRequestCompletionScope const&) = delete;

		private:
			V8Runtime* m_pRuntime;
			AsyncRequestRecord* m_pRequestRecord;
		};

		static void ConsumeAsyncRequestResult(AsyncRequestRecord* const pRequestRecord);
		static void RunBlockingAsyncRequest(AsyncRequestRecord* const pRequestRecord);
		void RetireAsyncRequest(AsyncRequestRecord* const pRequestRecord);
		void ReapAsyncRequests();
		void RunAsyncRequest(AsyncRequestRecord* const pRequestRecord);
		void StopAsyncRequests();
		bool QueueAsyncRequestRecord(const std::uint64_t unRequestID, std::function<AsyncRequestResult()> const& Task);
		// The caller has observed result readiness and detached its completion link, without the mutex.
		bool DeliverAsyncRequest(AsyncRequestRecord* const pCompletionRecord);
		void RemoveAsyncRequestsForContext(v8::Local<v8::Context> const LocalContext);

	private:
		RuntimePaths const* m_pRuntimePaths;
		std::unique_ptr<v8::Platform> m_pPlatform;
		std::unique_ptr<v8::ArrayBuffer::Allocator> m_pArrayBufferAllocator;
		v8::Isolate* m_pIsolate;
		v8::Global<v8::Context> m_V8Context;
		v8::Global<v8::Object> m_SourceJSObject;
		std::map<std::string, v8::Global<v8::Value>> m_mapPackageModuleCache;
		std::map<std::string, PluginRuntimeRecord> m_mapPluginRuntimes;
		std::map<std::string, std::vector<ScriptCallbackRecord>> m_mapEventCallbacks;
		std::map<std::string, std::vector<ScriptCallbackRecord>> m_mapGameEventCallbacks;
		std::map<std::uint64_t, IGameEvent*> m_mapActiveGameEvents;
		std::map<std::string, std::vector<ScriptCallbackRecord>> m_mapCommandCallbacks;
		std::map<std::string, std::vector<ScriptCallbackRecord>> m_mapClientCommandCallbacks;
		std::map<std::string, std::vector<ScriptCallbackRecord>> m_mapSayCommandCallbacks;
		std::vector<ScriptCallbackRecord> m_vecClientCommandFilters;
		std::vector<ScriptCallbackRecord> m_vecEarlySayCommandFilters;
		std::vector<ScriptCallbackRecord> m_vecSayCommandFilters;
		std::map<std::string, ScriptCommandRecord> m_mapRegisteredCommands;
		// Containers/thread handles are owned by the game thread. Workers publish results under
		// m_AsyncRequestMutex, then wait for consumption before destroying native results/task captures.
		// Active delivery nodes survive reentrant shutdown; retired nodes are reaped after worker cleanup.
		// The mutex guards acceptance and completion links, never V8 calls or callback execution.
		std::map<std::uint64_t, AsyncRequestCallbackRecord> m_mapAsyncRequestCallbacks;
		std::list<std::unique_ptr<AsyncRequestRecord>> m_lstAsyncRequests;
		std::list<std::unique_ptr<AsyncRequestRecord>> m_lstActiveAsyncRequests;
		std::list<std::unique_ptr<AsyncRequestRecord>> m_lstRetiredAsyncRequests;
		AsyncRequestRecord* m_pFirstAsyncCompletion;
		AsyncRequestRecord* m_pLastAsyncCompletion;
		std::mutex m_AsyncRequestMutex;
		std::uint64_t m_unNextAsyncRequestID;
		bool m_bAcceptAsyncRequests;
		std::uint64_t m_unNextGameEventToken;
		bool m_bInitialized;
	};
} // namespace SourceJS
#endif // _SOURCEJSV8RUNTIME_H_
