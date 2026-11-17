
// C++
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <utility>

// STL
#include <any>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <exception>
#include <functional>
#include <future>
#include <limits>
#include <list>
#include <map>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

// Actual extracted request methods use real threads, locks, queues and exceptions.
// V8 handles/conversion/logging are narrow doubles: no real V8, GC, SDK or network IO.
namespace {
	void Check(const bool bCondition, char const* const pszMessage) {
		if (!bCondition) {
			std::fprintf(stderr, "Check failed: %s\n", pszMessage);
			std::abort();
		}
	}
} // namespace

namespace v8 {
	enum class ValueKind {
		Undefined = 0,
		Null,
		Number,
		Error
	};

	struct Value {
		Value();

		ValueKind m_Kind;
		int m_nNumber;
		std::string m_strText;
	};

	Value::Value() {
		m_Kind = ValueKind::Undefined;
		m_nNumber = 0;
	}

	struct String : Value {
	};

	template<typename T>
	class Local {
	public:
		Local() {
			m_pValue = nullptr;
		}

		explicit Local(T* const pValue) :
			m_pValue(pValue)
		{
		}

		template<typename TSource>
		Local(Local<TSource> const Other) :
			m_pValue(Other.Get())
		{
		}

		bool IsEmpty() const {
			return !m_pValue;
		}

		T* Get() const {
			return m_pValue;
		}

		T* operator->() const {
			return m_pValue;
		}

		bool operator!=(Local const Other) const {
			return m_pValue != Other.m_pValue;
		}

		bool operator==(Local const Other) const {
			return m_pValue == Other.m_pValue;
		}

	private:
		T* m_pValue;
	};

	template<typename T>
	class MaybeLocal {
	public:
		MaybeLocal() = default;

		MaybeLocal(Local<T> const ValueHandle) :
			m_Local(ValueHandle)
		{
		}

		bool ToLocal(Local<T>* const pValueOut) const {
			if (m_Local.IsEmpty()) {
				return false;
			}

			*pValueOut = m_Local;

			return true;
		}

	private:
		Local<T> m_Local;
	};
} // namespace v8

namespace {
	struct TestState {
		TestState();

		std::thread::id m_GameThreadID;
		v8::Value m_UndefinedValue;
		v8::Value m_NullValue;
		v8::String m_ErrorValue;
		bool m_bCaught;
		bool m_bFormatFailure;
		bool m_bStringFailure;
		std::size_t m_unLogCount;
	};

	TestState::TestState() {
		m_GameThreadID = std::this_thread::get_id();
		m_NullValue.m_Kind = v8::ValueKind::Null;
		m_ErrorValue.m_Kind = v8::ValueKind::Error;
		m_bCaught = false;
		m_bFormatFailure = false;
		m_bStringFailure = false;
		m_unLogCount = 0;
	}

	TestState& GetTestState() {
		// One test process owns this state; initialization occurs before any worker starts.
		static TestState s_State {};

		return s_State;
	}

	void CheckGameThread() {
		Check(std::this_thread::get_id() == GetTestState().m_GameThreadID, "V8 operation must stay on the game thread");
	}
} // namespace

namespace v8 {
	struct Context {
		class Scope {
		public:
			explicit Scope(Local<Context> LocalContext);
		};

		Local<Value> Global();
	};

	Context::Scope::Scope(Local<Context>) {
		CheckGameThread();
	}

	Local<Value> Context::Global() {
		CheckGameThread();

		return Local<Value>(&GetTestState().m_UndefinedValue);
	}

	struct Isolate {
		Isolate();

		class Scope {
		public:
			explicit Scope(Isolate* pIsolate);
		};

		Local<Context> GetCurrentContext();

		Context m_Context;
		Context* m_pCurrentContext;
	};

	Isolate::Isolate() {
		m_pCurrentContext = &m_Context;
	}

	Isolate::Scope::Scope(Isolate*) {
		CheckGameThread();
	}

	Local<Context> Isolate::GetCurrentContext() {
		CheckGameThread();

		return Local<Context>(m_pCurrentContext);
	}

	class HandleScope {
	public:
		explicit HandleScope(Isolate* pIsolate);
	};

	HandleScope::HandleScope(Isolate*) {
		CheckGameThread();
	}

	class TryCatch {
	public:
		explicit TryCatch(Isolate* pIsolate);
		bool HasCaught() const;
		void Reset();
	};

	TryCatch::TryCatch(Isolate*) {
		CheckGameThread();
		Reset();
	}

	bool TryCatch::HasCaught() const {
		return GetTestState().m_bCaught;
	}

	void TryCatch::Reset() {
		GetTestState().m_bCaught = false;
	}

	template<typename T>
	class Global {
	public:
		Global() = default;

		~Global() {
			Reset();
		}

		Global(Global const&) = delete;
		Global& operator=(Global const&) = delete;

		Global(Global&& Source) noexcept :
			m_Local(Source.m_Local)
		{
			Source.Reset();
		}

		Global& operator=(Global&& Source) noexcept {
			m_Local = Source.m_Local;
			Source.Reset();

			return *this;
		}

		void Reset() noexcept {
			CheckGameThread();
			m_Local = {};
		}

		void Reset(Isolate*, Local<T> const LocalValue) {
			CheckGameThread();
			m_Local = LocalValue;
		}

		Local<T> Get(Isolate*) const {
			CheckGameThread();

			return m_Local;
		}

		bool IsEmpty() const {
			return m_Local.IsEmpty();
		}

	private:
		Local<T> m_Local;
	};

	struct Function : Value {
		MaybeLocal<Value> Call(Local<Context> LocalContext, Local<Value> LocalReceiver, const int nArgumentCount, Local<Value>* pArguments);

		std::function<void(Local<Value>, Local<Value>)> m_Callback;
	};

	MaybeLocal<Value> Function::Call(Local<Context>, Local<Value>, const int nArgumentCount, Local<Value>* const pArguments) {
		constexpr int kCallbackArgumentCount = 2;

		CheckGameThread();
		Check(nArgumentCount == kCallbackArgumentCount, "callback must receive error and result");
		Check(!GetTestState().m_bCaught, "conversion exception must be cleared before the callback");
		m_Callback(pArguments[0], pArguments[1]);

		return Local<Value>(&GetTestState().m_UndefinedValue);
	}

	Local<Value> Undefined(Isolate*) {
		CheckGameThread();

		return Local<Value>(&GetTestState().m_UndefinedValue);
	}

	Local<Value> Null(Isolate*) {
		CheckGameThread();

		return Local<Value>(&GetTestState().m_NullValue);
	}

	namespace Exception {
		Local<Value> Error(Local<String> const LocalMessage) {
			CheckGameThread();

			return LocalMessage;
		}
	} // namespace Exception
} // namespace v8

// Generated included-only declarations require the V8 doubles above.
#include "V8AsyncRequestRecords.h"

namespace SourceJS {
	void LogError(char const* const pszFormat, ...) {
		CheckGameThread();
		Check(pszFormat && *pszFormat, "diagnostic must identify an operation");
		++GetTestState().m_unLogCount;
	}

	bool MakeRuntimeString(v8::Isolate*, std::string const& strText, v8::Local<v8::String>& LocalValueOut) {
		CheckGameThread();

		if (GetTestState().m_bStringFailure) {
			return false;
		}

		GetTestState().m_ErrorValue.m_strText = strText;
		LocalValueOut = v8::Local<v8::String>(&GetTestState().m_ErrorValue);

		return true;
	}

	struct PluginRuntimeRecord {
		v8::Global<v8::Context> m_Context;
	};

	class V8Runtime {
	public:
		V8Runtime();
		~V8Runtime();
		V8Runtime(V8Runtime const&) = delete;
		V8Runtime& operator=(V8Runtime const&) = delete;

		bool QueueAsyncRequest(v8::Local<v8::Function> LocalCallbackFunction, std::function<AsyncRequestResult()> const& Task, std::function<v8::MaybeLocal<v8::Value>(v8::Isolate*, v8::Local<v8::Context>, std::any const&)> const& ConvertResult);
		bool RunBlockingRequest(v8::Local<v8::Function> LocalCallbackFunction, std::function<AsyncRequestResult()> const& Task, std::function<v8::MaybeLocal<v8::Value>(v8::Isolate*, v8::Local<v8::Context>, std::any const&)> const& ConvertResult);
		bool QueueAsyncTask(std::function<AsyncRequestResult()> const& Task);
		bool RunRequestOnDedicatedThread(std::function<AsyncRequestResult()> const& Task, AsyncRequestResult& ResultOut);
		void ProcessAsyncRequests();

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
		void RunAsyncRequest(AsyncRequestRecord* pRequestRecord);
		void StopAsyncRequests();
		void RemoveAsyncRequestsForContext(v8::Local<v8::Context> LocalContext);
		bool QueueAsyncRequestRecord(std::uint64_t unRequestID, std::function<AsyncRequestResult()> const& Task);
		bool DeliverAsyncRequest(AsyncRequestRecord* pCompletionRecord);
		bool WaitForAsyncRequest(v8::Local<v8::Function> LocalCallbackFunction);
		std::string FormatException(v8::TryCatch const& ExceptionTryCatch) const;
		PluginRuntimeRecord* FindPluginRuntimeRecord(v8::Local<v8::Context> const LocalContext) noexcept;

		// Public only to assert fixture state; this is not the production runtime layout.
		v8::Isolate m_Isolate;
		v8::Isolate* m_pIsolate;
		v8::Global<v8::Context> m_V8Context;
		std::map<std::string, PluginRuntimeRecord> m_mapPluginRuntimes;
		std::map<std::uint64_t, AsyncRequestCallbackRecord> m_mapAsyncRequestCallbacks;
		std::list<std::unique_ptr<AsyncRequestRecord>> m_lstAsyncRequests;
		std::list<std::unique_ptr<AsyncRequestRecord>> m_lstActiveAsyncRequests;
		std::list<std::unique_ptr<AsyncRequestRecord>> m_lstRetiredAsyncRequests;
		AsyncRequestRecord* m_pFirstAsyncCompletion;
		AsyncRequestRecord* m_pLastAsyncCompletion;
		std::mutex m_AsyncRequestMutex;
		std::uint64_t m_unNextAsyncRequestID;
		bool m_bAcceptAsyncRequests;
		bool m_bInitialized;
	};

	V8Runtime::V8Runtime() {
		m_pIsolate = &m_Isolate;
		m_V8Context.Reset(m_pIsolate, v8::Local<v8::Context>(&m_Isolate.m_Context));
		m_pFirstAsyncCompletion = nullptr;
		m_pLastAsyncCompletion = nullptr;
		m_unNextAsyncRequestID = 0;
		m_bAcceptAsyncRequests = true;
		m_bInitialized = true;
	}

	V8Runtime::~V8Runtime() {
		Check(m_lstAsyncRequests.empty() && m_lstActiveAsyncRequests.empty() && m_mapAsyncRequestCallbacks.empty(), "fixture must consume every request and callback");
		StopAsyncRequests();
	}

	std::string V8Runtime::FormatException(v8::TryCatch const&) const {
		CheckGameThread();

		if (GetTestState().m_bFormatFailure) {
			throw std::runtime_error("Simulated diagnostic allocation failure.");
		}

		return "Simulated V8 exception.";
	}
} // namespace SourceJS

#include "V8AsyncRequestMethods.h"

namespace {
	class WorkerGate {
	public:
		WorkerGate();
		void Enter();
		void WaitForEntry();
		void Release();

	private:
		std::mutex m_Mutex;
		std::condition_variable m_Condition;
		bool m_bEntered;
		bool m_bReleased;
	};

	WorkerGate::WorkerGate() {
		m_bEntered = false;
		m_bReleased = false;
	}

	void WorkerGate::Enter() {
		std::unique_lock<std::mutex> Lock(m_Mutex);
		m_bEntered = true;
		m_Condition.notify_all();
		m_Condition.wait(Lock, [this]() {
			return m_bReleased;
		});
	}

	void WorkerGate::WaitForEntry() {
		constexpr int kTimeoutSeconds = 10;

		std::unique_lock<std::mutex> Lock(m_Mutex);
		Check(m_Condition.wait_for(Lock, std::chrono::seconds(kTimeoutSeconds), [this]() {
			return m_bEntered;
		}), "request must enter its own worker while another is blocked");
	}

	void WorkerGate::Release() {
		std::lock_guard<std::mutex> Lock(m_Mutex);
		m_bReleased = true;
		m_Condition.notify_all();
	}

	void WaitForCompletion(SourceJS::V8Runtime& Runtime, const std::size_t unExpectedCount) {
		constexpr int kTimeoutSeconds = 10;

		// The actual queue has no notification primitive; yield, with a steady deadline.
		std::chrono::steady_clock::time_point const Deadline = std::chrono::steady_clock::now() + std::chrono::seconds(kTimeoutSeconds);
		while (true) {
			std::size_t unCount = 0;
			{
				std::lock_guard<std::mutex> Lock(Runtime.m_AsyncRequestMutex);
				for (auto* pRecord = Runtime.m_pFirstAsyncCompletion; pRecord; pRecord = pRecord->m_pNextCompletion) {
					++unCount;
				}
			}

			if (unCount >= unExpectedCount) {
				return;
			}

			Check(std::chrono::steady_clock::now() < Deadline, "worker completion deadline");
			std::this_thread::yield();
		}
	}

	SourceJS::AsyncRequestResult MakeTaskResult(const int nValue) {
		Check(std::this_thread::get_id() != GetTestState().m_GameThreadID, "operation must execute outside the game thread");
		SourceJS::AsyncRequestResult Result {};
		Result.m_Value = nValue;

		return Result;
	}

	void CheckSelectedRequestWaiting() {
		SourceJS::V8Runtime Runtime {};
		WorkerGate SlowGate {};
		std::size_t unSlowCallbacks = 0;
		std::size_t unSelectedCallbacks = 0;
		v8::Function SlowCallback {};
		SlowCallback.m_Callback = [&unSlowCallbacks](v8::Local<v8::Value>, v8::Local<v8::Value>) {
			++unSlowCallbacks;
		};
		auto ConvertResult = [](v8::Isolate* const pIsolate, v8::Local<v8::Context>, std::any const&) -> v8::MaybeLocal<v8::Value> {
			CheckGameThread();

			return v8::Undefined(pIsolate);
		};
		v8::Function SelectedCallback {};
		SelectedCallback.m_Callback = [&Runtime, &unSelectedCallbacks](v8::Local<v8::Value> const LocalError, v8::Local<v8::Value>) {
			CheckGameThread();
			Check(LocalError->m_Kind == v8::ValueKind::Null, "selected request succeeds");
			std::lock_guard<std::mutex> Lock(Runtime.m_AsyncRequestMutex);
			++unSelectedCallbacks;
		};
		Check(Runtime.QueueAsyncRequest(v8::Local<v8::Function>(&SlowCallback), [&SlowGate]() {
			SlowGate.Enter();

			return MakeTaskResult(1);
		}, ConvertResult), "slow request admitted");
		SlowGate.WaitForEntry();
		Check(Runtime.QueueAsyncRequest(v8::Local<v8::Function>(&SelectedCallback), []() {
			return MakeTaskResult(2);
		}, ConvertResult), "selected request admitted");
		v8::Context OtherContext {};
		auto itSelectedCallback = Runtime.m_mapAsyncRequestCallbacks.find(Runtime.m_unNextAsyncRequestID);
		Check(itSelectedCallback != Runtime.m_mapAsyncRequestCallbacks.end(), "selected callback registered");
		itSelectedCallback->second.m_Context.Reset(Runtime.m_pIsolate, v8::Local<v8::Context>(&OtherContext));
		Check(!Runtime.WaitForAsyncRequest(v8::Local<v8::Function>(&SelectedCallback)), "wait cannot consume another context's matching callback");
		itSelectedCallback->second.m_Context.Reset(Runtime.m_pIsolate, Runtime.m_pIsolate->GetCurrentContext());
		Check(!Runtime.WaitForAsyncRequest({}), "empty callback cannot wait");
		Check(Runtime.WaitForAsyncRequest(v8::Local<v8::Function>(&SelectedCallback)), "selected request waits/delivers without waiting on the blocked worker");
		Check((unSelectedCallbacks == 1) && (unSlowCallbacks == 0), "only selected callback delivered before return, without holding queue mutex");
		Check(!Runtime.WaitForAsyncRequest(v8::Local<v8::Function>(&SelectedCallback)), "completed request cannot be delivered twice");
		SlowGate.Release();
		WaitForCompletion(Runtime, 1);
		Runtime.ProcessAsyncRequests();
		Check(unSlowCallbacks == 1, "unrelated blocked worker retains its callback");
	}

	void CheckSelectedCompletionLinks() {
		constexpr std::size_t kRequestCount = 3;
		constexpr std::size_t kSharedCallbackRequestCount = 2;

		for (std::size_t unSelectedIndex = 0; unSelectedIndex < kRequestCount; ++unSelectedIndex) {
			SourceJS::V8Runtime Runtime {};
			std::vector<int> vecResults {};
			v8::Value ResultValue {};
			ResultValue.m_Kind = v8::ValueKind::Number;
			auto ConvertResult = [&ResultValue](v8::Isolate*, v8::Local<v8::Context>, std::any const& Value) -> v8::MaybeLocal<v8::Value> {
				ResultValue.m_nNumber = std::any_cast<int>(Value);

				return v8::Local<v8::Value>(&ResultValue);
			};
			v8::Function arrCallbacks[kRequestCount] {};
			for (std::size_t unIndex = 0; unIndex < kRequestCount; ++unIndex) {
				arrCallbacks[unIndex].m_Callback = [&vecResults](v8::Local<v8::Value>, v8::Local<v8::Value> const LocalValue) {
					vecResults.push_back(LocalValue->m_nNumber);
				};
				Check(Runtime.QueueAsyncRequest(v8::Local<v8::Function>(&arrCallbacks[unIndex]), [unIndex]() {
					return MakeTaskResult(static_cast<int>(unIndex));
				}, ConvertResult), "ordered completion admitted");
				WaitForCompletion(Runtime, unIndex + 1);
			}

			Check(Runtime.WaitForAsyncRequest(v8::Local<v8::Function>(&arrCallbacks[unSelectedIndex])), "select head/middle/tail completion");
			Check(vecResults == std::vector<int> { static_cast<int>(unSelectedIndex) }, "selection leaves other completed callbacks pending");
			Runtime.ProcessAsyncRequests();
			Check(vecResults.size() == kRequestCount, "remaining completion links survive selected removal");
			std::size_t unResultIndex = 1;
			for (std::size_t unIndex = 0; unIndex < kRequestCount; ++unIndex) {
				if (unIndex != unSelectedIndex) {
					Check(vecResults[unResultIndex++] == static_cast<int>(unIndex), "unrelated completion order preserved");
				}
			}

			Check(!Runtime.m_pFirstAsyncCompletion && !Runtime.m_pLastAsyncCompletion, "selected removal preserves empty queue endpoints");
			for (std::size_t unIndex = 0; unIndex < kSharedCallbackRequestCount; ++unIndex) {
				Check(Runtime.QueueAsyncRequest(v8::Local<v8::Function>(&arrCallbacks[0]), [unIndex]() {
					return MakeTaskResult(static_cast<int>(unIndex));
				}, ConvertResult), "reused callback admitted");
			}

			Check(Runtime.WaitForAsyncRequest(v8::Local<v8::Function>(&arrCallbacks[0])), "wait selects oldest request sharing a callback");
			Check(vecResults[kRequestCount] == 0, "callback reuse preserves request ID order");
			Check(Runtime.WaitForAsyncRequest(v8::Local<v8::Function>(&arrCallbacks[0])), "second shared-callback request remains available");
			Check(vecResults[kRequestCount + 1] == 1, "shared callback receives each result once");
		}
	}

	void CheckReentrantSelectedRequest() {
		SourceJS::V8Runtime Runtime {};
		std::size_t unNestedCallbackCount = 0;
		auto ConvertResult = [](v8::Isolate* const pIsolate, v8::Local<v8::Context>, std::any const&) -> v8::MaybeLocal<v8::Value> {
			return v8::Undefined(pIsolate);
		};
		v8::Function NestedCallback {};
		NestedCallback.m_Callback = [&unNestedCallbackCount](v8::Local<v8::Value>, v8::Local<v8::Value>) {
			++unNestedCallbackCount;
		};
		v8::Function OuterCallback {};
		OuterCallback.m_Callback = [&Runtime, &NestedCallback, &OuterCallback, &ConvertResult, &unNestedCallbackCount](v8::Local<v8::Value>, v8::Local<v8::Value>) {
			Check(!Runtime.WaitForAsyncRequest(v8::Local<v8::Function>(&OuterCallback)), "current callback registration is detached before reentrant waiting");
			Check(Runtime.QueueAsyncRequest(v8::Local<v8::Function>(&NestedCallback), []() {
				return MakeTaskResult(2);
			}, ConvertResult), "callback can enqueue a nested request");
			Check(Runtime.WaitForAsyncRequest(v8::Local<v8::Function>(&NestedCallback)), "callback can wait for its newly queued request");
			Check(unNestedCallbackCount == 1, "nested callback runs before nested wait returns");
		};
		Check(Runtime.QueueAsyncRequest(v8::Local<v8::Function>(&OuterCallback), []() {
			return MakeTaskResult(1);
		}, ConvertResult), "outer request admitted");
		Check(Runtime.WaitForAsyncRequest(v8::Local<v8::Function>(&OuterCallback)), "outer wait survives nested callback registry mutations");
		Check(Runtime.m_lstAsyncRequests.empty() && Runtime.m_mapAsyncRequestCallbacks.empty(), "reentrant requests release all worker and callback records");
	}

	void CheckIndependentRequests() {
		SourceJS::V8Runtime Runtime {};
		WorkerGate FirstGate {};
		WorkerGate SecondGate {};
		std::thread::id FirstWorkerID {};
		std::thread::id SecondWorkerID {};
		std::vector<int> vecResults {};
		v8::Value ResultValue {};
		ResultValue.m_Kind = v8::ValueKind::Number;
		auto const ConvertResult = [&ResultValue](v8::Isolate*, v8::Local<v8::Context>, std::any const& Value) -> v8::MaybeLocal<v8::Value> {
			CheckGameThread();
			ResultValue.m_nNumber = std::any_cast<int>(Value);

			return v8::Local<v8::Value>(&ResultValue);
		};
		v8::Function Callback {};
		Callback.m_Callback = [&vecResults](v8::Local<v8::Value> const LocalError, v8::Local<v8::Value> const LocalValue) {
			Check(LocalError->m_Kind == v8::ValueKind::Null, "successful request must report null error");
			vecResults.push_back(LocalValue->m_nNumber);
		};
		v8::Local<v8::Function> const LocalCallback(&Callback);
		Check(Runtime.QueueAsyncRequest(LocalCallback, [&FirstGate, &FirstWorkerID]() {
			FirstWorkerID = std::this_thread::get_id();
			FirstGate.Enter();

			return MakeTaskResult(1);
		}, ConvertResult), "first async request accepted");
		FirstGate.WaitForEntry();
		Check(Runtime.QueueAsyncRequest(LocalCallback, [&SecondGate, &SecondWorkerID]() {
			SecondWorkerID = std::this_thread::get_id();
			SecondGate.Enter();

			return MakeTaskResult(2);
		}, ConvertResult), "second async request accepted");
		SecondGate.WaitForEntry();
		Check((FirstWorkerID != SecondWorkerID) && (FirstWorkerID != GetTestState().m_GameThreadID), "simultaneous requests must have distinct worker threads");
		SecondGate.Release();
		WaitForCompletion(Runtime, 1);
		Check(vecResults.empty(), "worker must not invoke a JavaScript callback");
		Runtime.ProcessAsyncRequests();
		Check(vecResults == std::vector<int> { 2 }, "fast request must complete while slow request remains blocked");

		Check(Runtime.RunBlockingRequest(LocalCallback, []() {
			return MakeTaskResult(3);
		}, ConvertResult), "blocking request accepted alongside blocked async request");
		Check(vecResults == std::vector<int> { 2, 3 }, "blocking request must invoke its callback before returning");
		FirstGate.Release();
		WaitForCompletion(Runtime, 1);
		Runtime.ProcessAsyncRequests();
		Check(vecResults == std::vector<int> { 2, 3, 1 }, "slow request retains its callback and result");
	}

	void CheckCompletionPumpBound() {
		SourceJS::V8Runtime Runtime {};
		std::size_t unCallbackCount = 0;
		v8::Function Callback {};
		auto const ConvertResult = [](v8::Isolate* const pIsolate, v8::Local<v8::Context>, std::any const&) -> v8::MaybeLocal<v8::Value> {
			return v8::Undefined(pIsolate);
		};
		Callback.m_Callback = [&Runtime, &Callback, &unCallbackCount, &ConvertResult](v8::Local<v8::Value>, v8::Local<v8::Value>) {
			++unCallbackCount;

			if (unCallbackCount == 1) {
				Check(Runtime.QueueAsyncRequest(v8::Local<v8::Function>(&Callback), []() {
					return MakeTaskResult(2);
				}, ConvertResult), "callback can enqueue without an internal lock held");
				WaitForCompletion(Runtime, 1);
			}
		};
		Check(Runtime.QueueAsyncRequest(v8::Local<v8::Function>(&Callback), []() {
			return MakeTaskResult(1);
		}, ConvertResult), "initial reentrant request");
		WaitForCompletion(Runtime, 1);
		Runtime.ProcessAsyncRequests();
		Check((unCallbackCount == 1) && (Runtime.m_mapAsyncRequestCallbacks.size() == 1), "reentrant completion must wait for the next pump");
		Runtime.ProcessAsyncRequests();
		Check(unCallbackCount == 2, "next pump delivers reentrant completion exactly once");
		Runtime.ProcessAsyncRequests();
		Check(unCallbackCount == 2, "empty pump must not repeat callbacks");
	}

	void CheckRequestFailure(const bool bBlocking, const int nFailureMode) {
		SourceJS::V8Runtime Runtime {};
		std::size_t unCallbackCount = 0;
		bool bConverted = false;
		v8::Value ResultValue {};
		ResultValue.m_Kind = v8::ValueKind::Number;
		auto const Task = [nFailureMode]() -> SourceJS::AsyncRequestResult {
			if (nFailureMode == 0) {
				throw std::runtime_error("Task failed.");
			}

			if (nFailureMode == 1) {
				throw 1;
			}

			return MakeTaskResult(7);
		};
		auto const ConvertResult = [&ResultValue, &bConverted, nFailureMode](v8::Isolate*, v8::Local<v8::Context>, std::any const&) -> v8::MaybeLocal<v8::Value> {
			CheckGameThread();
			bConverted = true;

			if (nFailureMode == 2) {
				return {};
			}

			if (nFailureMode == 3) {
				throw std::runtime_error("Conversion failed.");
			}

			GetTestState().m_bCaught = true;

			return v8::Local<v8::Value>(&ResultValue);
		};
		v8::Function Callback {};
		Callback.m_Callback = [&unCallbackCount, nFailureMode](v8::Local<v8::Value> const LocalError, v8::Local<v8::Value> const LocalValue) {
			++unCallbackCount;
			Check(LocalError->m_Kind == v8::ValueKind::Error, "task/conversion failure must produce an error");
			Check(!LocalError->m_strText.empty(), "failure must retain a diagnostic");
			Check(LocalValue->m_Kind == v8::ValueKind::Undefined, "failed conversion must not expose a partial result");

			if (nFailureMode == 0) {
				Check(LocalError->m_strText == "Task failed.", "standard exception message preserved");
			}
		};
		v8::Local<v8::Function> const LocalCallback(&Callback);
		if (bBlocking) {
			Check(Runtime.RunBlockingRequest(LocalCallback, Task, ConvertResult), "blocking failure delivered");
		} else {
			Check(Runtime.QueueAsyncRequest(LocalCallback, Task, ConvertResult), "async failure accepted");
			WaitForCompletion(Runtime, 1);
			Runtime.ProcessAsyncRequests();
		}

		Check(unCallbackCount == 1, "failure callback exactly once");
		Check(bConverted == (nFailureMode >= 2), "task failure must skip conversion");
	}

	void CheckRejectedAndCleanupRequests() {
		SourceJS::V8Runtime Runtime {};
		SourceJS::AsyncRequestResult Result {};
		Result.m_strError = "Preserve output.";
		Runtime.m_bAcceptAsyncRequests = false;
		Check(!Runtime.RunRequestOnDedicatedThread([]() {
			return MakeTaskResult(1);
		}, Result), "closed runtime rejects blocking worker");
		Check(Result.m_strError == "Preserve output.", "rejected worker preserves output");
		Check(!Runtime.QueueAsyncTask([]() {
			return MakeTaskResult(1);
		}), "closed runtime rejects cleanup worker");
		Runtime.m_bAcceptAsyncRequests = true;
		const std::size_t unInitialLogCount = GetTestState().m_unLogCount;
		Check(Runtime.QueueAsyncTask([]() -> SourceJS::AsyncRequestResult {
			throw std::runtime_error("Cleanup failed.");
		}), "cleanup worker accepted");
		WaitForCompletion(Runtime, 1);
		Runtime.ProcessAsyncRequests();
		Check(GetTestState().m_unLogCount == (unInitialLogCount + 1), "failed cleanup worker logs once without a callback");
	}

	void CheckDeliveryFailures(const bool bBlocking) {
		SourceJS::V8Runtime Runtime {};
		std::size_t unCallbackCount = 0;
		v8::Function Callback {};
		Callback.m_Callback = [&unCallbackCount](v8::Local<v8::Value>, v8::Local<v8::Value> const LocalValue) {
			++unCallbackCount;
			Check(LocalValue->m_Kind == v8::ValueKind::Undefined, "failed diagnostic conversion retains undefined result");
		};
		auto const Task = []() {
			return MakeTaskResult(1);
		};
		auto const ConvertResult = [](v8::Isolate* const pIsolate, v8::Local<v8::Context>, std::any const&) -> v8::MaybeLocal<v8::Value> {
			GetTestState().m_bCaught = true;

			return v8::Undefined(pIsolate);
		};
		auto const Deliver = [&Runtime, &Callback, &Task, &ConvertResult, bBlocking]() -> bool {
			if (bBlocking) {
				return Runtime.RunBlockingRequest(v8::Local<v8::Function>(&Callback), Task, ConvertResult);
			}

			Check(Runtime.QueueAsyncRequest(v8::Local<v8::Function>(&Callback), Task, ConvertResult), "delivery failure request accepted");
			WaitForCompletion(Runtime, 1);
			Runtime.ProcessAsyncRequests();

			return true;
		};
		GetTestState().m_bFormatFailure = true;
		Check(Deliver(), "formatting exception becomes a conversion failure");
		GetTestState().m_bFormatFailure = false;
		Check(unCallbackCount == 1, "formatting failure still delivers one error callback");
		GetTestState().m_bStringFailure = true;
		const std::size_t unInitialLogCount = GetTestState().m_unLogCount;
		Check(Deliver() == !bBlocking, "blocking delivery reports inability to create error value");
		GetTestState().m_bStringFailure = false;
		Check((unCallbackCount == 1) && (GetTestState().m_unLogCount == (unInitialLogCount + 1)), "undeliverable error logs once and does not call with a partial result");
	}

	void CheckContextCancellation() {
		SourceJS::V8Runtime Runtime {};
		WorkerGate Gate {};
		v8::Context OtherContext {};
		std::size_t unCallbackCount = 0;
		v8::Function Callback {};
		Callback.m_Callback = [&unCallbackCount](v8::Local<v8::Value>, v8::Local<v8::Value>) {
			++unCallbackCount;
		};
		auto const ConvertResult = [](v8::Isolate* const pIsolate, v8::Local<v8::Context>, std::any const&) -> v8::MaybeLocal<v8::Value> {
			return v8::Undefined(pIsolate);
		};
		Check(Runtime.QueueAsyncRequest(v8::Local<v8::Function>(&Callback), [&Gate]() {
			Gate.Enter();

			return MakeTaskResult(1);
		}, ConvertResult), "cancelable-context request accepted");
		Gate.WaitForEntry();
		Check(Runtime.QueueAsyncRequest(v8::Local<v8::Function>(&Callback), []() {
			return MakeTaskResult(2);
		}, ConvertResult), "other-context request accepted");
		auto itOtherCallback = Runtime.m_mapAsyncRequestCallbacks.find(Runtime.m_unNextAsyncRequestID);
		Check(itOtherCallback != Runtime.m_mapAsyncRequestCallbacks.end(), "other context callback stored");
		itOtherCallback->second.m_Context.Reset(Runtime.m_pIsolate, v8::Local<v8::Context>(&OtherContext));
		Runtime.RemoveAsyncRequestsForContext(Runtime.m_pIsolate->GetCurrentContext());
		Check(Runtime.m_mapAsyncRequestCallbacks.size() == 1, "unloading context removes only its callbacks without waiting on its worker");
		Check(!Runtime.WaitForAsyncRequest(v8::Local<v8::Function>(&Callback)), "wait cannot consume canceled or other-context requests");
		WaitForCompletion(Runtime, 1);
		Runtime.ProcessAsyncRequests();
		Check(unCallbackCount == 1, "remaining context receives its result");
		Gate.Release();
		WaitForCompletion(Runtime, 1);
		Runtime.ProcessAsyncRequests();
		Check(unCallbackCount == 1, "unloaded context must not receive its late result");
	}

	void CheckRequestContextAdmission(const bool bBlocking) {
		SourceJS::V8Runtime Runtime {};
		v8::Context PluginContext {};
		std::atomic<std::size_t> unTaskCount {};
		std::size_t unCallbackCount = 0;
		v8::Function Callback {};
		Callback.m_Callback = [&unCallbackCount](v8::Local<v8::Value>, v8::Local<v8::Value>) {
			++unCallbackCount;
		};

		v8::Local<v8::Function> const LocalCallback = v8::Local<v8::Function>(&Callback);
		auto const Task = [&unTaskCount]() -> SourceJS::AsyncRequestResult {
			unTaskCount.fetch_add(1);

			return MakeTaskResult(1);
		};

		auto const ConvertResult = [](v8::Isolate* const pIsolate, v8::Local<v8::Context>, std::any const&) -> v8::MaybeLocal<v8::Value> {
			return v8::Undefined(pIsolate);
		};

		auto const RunRequest = [&Runtime, &Task, &ConvertResult, LocalCallback, bBlocking]() -> bool {
			return bBlocking ? Runtime.RunBlockingRequest(LocalCallback, Task, ConvertResult) : Runtime.QueueAsyncRequest(LocalCallback, Task, ConvertResult);
		};

		auto const CompleteRequest = [&Runtime, bBlocking]() -> void {
			if (!bBlocking) {
				WaitForCompletion(Runtime, 1);
				Runtime.ProcessAsyncRequests();
			}
		};

		Runtime.m_Isolate.m_pCurrentContext = &PluginContext;
		Check(!RunRequest(), "unregistered context must reject requests before worker admission");
		Check((unTaskCount.load() == 0) && (unCallbackCount == 0) && (Runtime.m_unNextAsyncRequestID == 0) && Runtime.m_mapAsyncRequestCallbacks.empty() && Runtime.m_lstAsyncRequests.empty(), "rejected context must leave no worker, callback or request ID");

		auto itPluginRuntime = Runtime.m_mapPluginRuntimes.try_emplace("fixture-plugin").first;
		itPluginRuntime->second.m_Context.Reset(Runtime.m_pIsolate, v8::Local<v8::Context>(&PluginContext));
		Check(RunRequest(), "registered live plugin context must admit requests");
		CompleteRequest();
		Check((unTaskCount.load() == 1) && (unCallbackCount == 1), "live plugin request must run and deliver exactly once");

		const std::uint64_t unRequestIDAfterLiveRequest = Runtime.m_unNextAsyncRequestID;

		Runtime.m_mapPluginRuntimes.clear();
		Check(!RunRequest(), "unloaded plugin context must reject new requests");
		Runtime.m_Isolate.m_pCurrentContext = nullptr;
		Check(!RunRequest(), "empty context must reject new requests");
		Runtime.m_Isolate.m_pCurrentContext = &Runtime.m_Isolate.m_Context;
		Runtime.m_V8Context.Reset();
		Check(!RunRequest(), "released root context must reject new requests");
		Check((unTaskCount.load() == 1) && (unCallbackCount == 1) && (Runtime.m_unNextAsyncRequestID == unRequestIDAfterLiveRequest) && Runtime.m_mapAsyncRequestCallbacks.empty() && Runtime.m_lstAsyncRequests.empty(), "dead contexts must not allocate workers, callbacks or request IDs");

		Runtime.m_V8Context.Reset(Runtime.m_pIsolate, Runtime.m_pIsolate->GetCurrentContext());
		Check(RunRequest(), "live root context must admit requests after restoration");
		CompleteRequest();
		Check((unTaskCount.load() == 2) && (unCallbackCount == 2), "restored root request must run and deliver exactly once");
	}

	struct NativeCleanupObservation {
		NativeCleanupObservation();

		std::thread::id m_WorkerID;
		std::thread::id m_DestructorID;
		std::atomic<bool> m_bDestroyed;
	};

	NativeCleanupObservation::NativeCleanupObservation() {
		m_bDestroyed.store(false);
	}

	class NativeCleanupSentinel {
	public:
		NativeCleanupSentinel(NativeCleanupObservation& Observation, WorkerGate* const pCleanupGate);
		~NativeCleanupSentinel();
		NativeCleanupSentinel(NativeCleanupSentinel const&) = delete;
		NativeCleanupSentinel& operator=(NativeCleanupSentinel const&) = delete;

	private:
		NativeCleanupObservation& m_Observation;
		WorkerGate* m_pCleanupGate;
	};

	NativeCleanupSentinel::NativeCleanupSentinel(NativeCleanupObservation& Observation, WorkerGate* const pCleanupGate) :
		m_Observation(Observation),
		m_pCleanupGate(pCleanupGate)
	{
	}

	NativeCleanupSentinel::~NativeCleanupSentinel() {
		Check(std::this_thread::get_id() == m_Observation.m_WorkerID, "native result/capture cleanup must run on its original request worker");

		if (m_pCleanupGate) {
			m_pCleanupGate->Enter();
		}

		m_Observation.m_DestructorID = std::this_thread::get_id();
		Check(!m_Observation.m_bDestroyed.exchange(true), "native resource must be destroyed exactly once");
	}

	enum class NativeCleanupScenario {
		Success = 0,
		CancelBeforeCompletion,
		CancelAfterCompletion,
		ConversionFailure,
		CallbackFailure,
		ReentrantStop,
		Shutdown
	};

	void CheckNativeResultCleanup(const bool bBlocking, const NativeCleanupScenario Scenario) {
		SourceJS::V8Runtime Runtime {};
		NativeCleanupObservation Observation {};
		WorkerGate TaskGate {};
		std::size_t unCallbackCount = 0;
		v8::Function Callback {};
		Callback.m_Callback = [&Runtime, &Observation, &unCallbackCount, Scenario](v8::Local<v8::Value>, v8::Local<v8::Value>) {
			CheckGameThread();
			Check(!Observation.m_bDestroyed.load(), "native result must remain alive throughout callback delivery");
			++unCallbackCount;

			if (Scenario == NativeCleanupScenario::CallbackFailure) {
				throw std::runtime_error("Simulated C++ delivery failure.");
			}

			if (Scenario == NativeCleanupScenario::ReentrantStop) {
				Runtime.StopAsyncRequests();
				Check(!Observation.m_bDestroyed.load(), "reentrant stop must not destroy an active delivery result");
			}
		};
		auto Task = [&Observation, &TaskGate, Scenario]() -> SourceJS::AsyncRequestResult {
			Observation.m_WorkerID = std::this_thread::get_id();
			SourceJS::AsyncRequestResult Result {};
			Result.m_Value = std::make_shared<NativeCleanupSentinel>(Observation, nullptr);

			if (Scenario == NativeCleanupScenario::CancelBeforeCompletion) {
				TaskGate.Enter();
			}

			return Result;
		};
		auto ConvertResult = [Scenario](v8::Isolate* const pIsolate, v8::Local<v8::Context>, std::any const&) -> v8::MaybeLocal<v8::Value> {
			if (Scenario == NativeCleanupScenario::ConversionFailure) {
				throw std::runtime_error("Simulated native result conversion failure.");
			}

			return v8::Undefined(pIsolate);
		};
		bool bDeliveryThrew = false;
		try {
			if (bBlocking) {
				Check(Runtime.RunBlockingRequest(v8::Local<v8::Function>(&Callback), Task, ConvertResult), "blocking cleanup request admitted");
			} else {
				Check(Runtime.QueueAsyncRequest(v8::Local<v8::Function>(&Callback), Task, ConvertResult), "native cleanup request admitted");
				if (Scenario == NativeCleanupScenario::CancelBeforeCompletion) {
					TaskGate.WaitForEntry();
					Runtime.RemoveAsyncRequestsForContext(Runtime.m_pIsolate->GetCurrentContext());
					TaskGate.Release();
				}

				WaitForCompletion(Runtime, 1);
				if (Scenario == NativeCleanupScenario::CancelAfterCompletion) {
					Runtime.RemoveAsyncRequestsForContext(Runtime.m_pIsolate->GetCurrentContext());
				}

				if (Scenario == NativeCleanupScenario::Shutdown) {
					Runtime.StopAsyncRequests();

				} else {
					Runtime.ProcessAsyncRequests();
				}
			}
		} catch (std::runtime_error const&) {
			bDeliveryThrew = true;
		}

		Check(bDeliveryThrew == (Scenario == NativeCleanupScenario::CallbackFailure), "only the simulated C++ callback failure escapes delivery");
		Runtime.StopAsyncRequests();
		Check(Observation.m_bDestroyed.load() && (Observation.m_DestructorID == Observation.m_WorkerID), "shutdown must drain worker-owned native results");
		const bool bCancelled = (Scenario == NativeCleanupScenario::CancelBeforeCompletion) || (Scenario == NativeCleanupScenario::CancelAfterCompletion) || (Scenario == NativeCleanupScenario::Shutdown);
		const std::size_t unExpectedCallbackCount = bCancelled ? 0 : 1;
		Check(unCallbackCount == unExpectedCallbackCount, "cancellation skips callbacks; all other deliveries happen exactly once");
		Check(Runtime.m_lstActiveAsyncRequests.empty() && Runtime.m_lstRetiredAsyncRequests.empty(), "delivery, exceptions and reentrant stop leave no joinable active/retired workers");
	}

	void CheckCancelledTaskCaptureCleanup() {
		SourceJS::V8Runtime Runtime {};
		NativeCleanupObservation Observation {};
		std::shared_ptr<NativeCleanupSentinel> ResourceOwner = std::make_shared<NativeCleanupSentinel>(Observation, nullptr);
		std::function<SourceJS::AsyncRequestResult()> Task = [&Observation, ResourceOwner]() -> SourceJS::AsyncRequestResult {
			Observation.m_WorkerID = std::this_thread::get_id();
			Check(ResourceOwner.use_count() > 1, "task and converter share the native socket-like owner");

			return MakeTaskResult(1);
		};
		std::function<v8::MaybeLocal<v8::Value>(v8::Isolate*, v8::Local<v8::Context>, std::any const&)> ConvertResult = [ResourceOwner](v8::Isolate*, v8::Local<v8::Context>, std::any const&) -> v8::MaybeLocal<v8::Value> {
			Check(ResourceOwner.use_count() > 0, "converter retains native owner");
			Check(false, "cancelled socket-like conversion must not execute");
			return {};
		};
		v8::Function Callback {};
		Check(Runtime.QueueAsyncRequest(v8::Local<v8::Function>(&Callback), Task, ConvertResult), "socket-like owner request admitted");
		Task = {};
		ConvertResult = {};
		ResourceOwner.reset();
		WaitForCompletion(Runtime, 1);
		Runtime.RemoveAsyncRequestsForContext(Runtime.m_pIsolate->GetCurrentContext());
		Check(!Observation.m_bDestroyed.load(), "worker retains task captures after completion and converter cancellation");
		Runtime.ProcessAsyncRequests();
		Runtime.StopAsyncRequests();
		Check(Observation.m_bDestroyed.load(), "cancelled task capture must be released by its worker");
	}

	void CheckSlowNativeCleanupDoesNotBlockPump() {
		constexpr int kTimeoutSeconds = 10;

		SourceJS::V8Runtime Runtime {};
		NativeCleanupObservation Observation {};
		WorkerGate CleanupGate {};
		v8::Function Callback {};
		Callback.m_Callback = [](v8::Local<v8::Value>, v8::Local<v8::Value>) {
		};
		Check(Runtime.QueueAsyncRequest(v8::Local<v8::Function>(&Callback), [&Observation, &CleanupGate]() -> SourceJS::AsyncRequestResult {
			Observation.m_WorkerID = std::this_thread::get_id();
			SourceJS::AsyncRequestResult Result {};
			Result.m_Value = std::make_shared<NativeCleanupSentinel>(Observation, &CleanupGate);

			return Result;
		}, [](v8::Isolate* const pIsolate, v8::Local<v8::Context>, std::any const&) -> v8::MaybeLocal<v8::Value> {
			return v8::Undefined(pIsolate);
		}), "slow native cleanup request admitted");
		WaitForCompletion(Runtime, 1);
		std::promise<void> FrameReturned {};
		std::future<void> FrameReturnFuture = FrameReturned.get_future();
		bool bFrameReturnedBeforeRelease = false;
		std::thread ReleaseThread([&CleanupGate, &FrameReturnFuture, &bFrameReturnedBeforeRelease, nTimeoutSeconds = kTimeoutSeconds]() {
			CleanupGate.WaitForEntry();
			bFrameReturnedBeforeRelease = FrameReturnFuture.wait_for(std::chrono::seconds(nTimeoutSeconds)) == std::future_status::ready;
			CleanupGate.Release();
		});
		Runtime.ProcessAsyncRequests();
		CleanupGate.WaitForEntry();
		Runtime.ProcessAsyncRequests();
		FrameReturned.set_value();
		ReleaseThread.join();
		Check(bFrameReturnedBeforeRelease, "frame pump must return while a native destructor remains blocked");
		Runtime.StopAsyncRequests();
		Check(Observation.m_bDestroyed.load(), "shutdown joins cleanup only after the blocked destructor is released");
	}

	void CheckRequestShutdown() {
		SourceJS::V8Runtime Runtime {};
		WorkerGate Gate {};
		v8::Function Callback {};
		Callback.m_Callback = [](v8::Local<v8::Value>, v8::Local<v8::Value>) {
			Check(false, "shutdown must release callbacks rather than invoke them");
		};
		auto const ConvertResult = [](v8::Isolate*, v8::Local<v8::Context>, std::any const&) -> v8::MaybeLocal<v8::Value> {
			Check(false, "shutdown must not convert a canceled result");
			return {};
		};
		Check(Runtime.QueueAsyncRequest(v8::Local<v8::Function>(&Callback), [&Gate]() {
			Gate.Enter();

			return MakeTaskResult(1);
		}, ConvertResult), "shutdown request accepted");
		Gate.WaitForEntry();
		std::thread ReleaseThread([&Gate]() {
			Gate.Release();
		});
		Runtime.StopAsyncRequests();
		ReleaseThread.join();
		Check(!Runtime.m_bAcceptAsyncRequests && !Runtime.m_pFirstAsyncCompletion && !Runtime.m_pLastAsyncCompletion, "shutdown rejects new requests and clears completion links after joining workers");
		Check(!Runtime.QueueAsyncRequest(v8::Local<v8::Function>(&Callback), []() {
			return MakeTaskResult(2);
		}, ConvertResult), "stopped request leaves no callback registration");
		Runtime.StopAsyncRequests();
	}
} // namespace

int main() {
	constexpr int kFailureModeCount = 5;

	CheckGameThread();
	CheckSelectedRequestWaiting();
	CheckSelectedCompletionLinks();
	CheckReentrantSelectedRequest();
	CheckIndependentRequests();
	CheckCompletionPumpBound();

	for (auto const& bBlocking : { false, true }) {
		CheckRequestContextAdmission(bBlocking);

		for (int nFailureMode = 0; nFailureMode < kFailureModeCount; ++nFailureMode) {
			CheckRequestFailure(bBlocking, nFailureMode);
		}

		CheckDeliveryFailures(bBlocking);
		for (auto const& Scenario : { NativeCleanupScenario::Success, NativeCleanupScenario::ConversionFailure, NativeCleanupScenario::CallbackFailure, NativeCleanupScenario::ReentrantStop }) {
			CheckNativeResultCleanup(bBlocking, Scenario);
		}
	}

	for (auto const& Scenario : { NativeCleanupScenario::CancelBeforeCompletion, NativeCleanupScenario::CancelAfterCompletion, NativeCleanupScenario::Shutdown }) {
		CheckNativeResultCleanup(false, Scenario);
	}

	CheckCancelledTaskCaptureCleanup();
	CheckSlowNativeCleanupDoesNotBlockPump();
	CheckRejectedAndCleanupRequests();
	CheckContextCancellation();
	CheckRequestShutdown();

	std::puts("V8 async request contracts passed");

	return 0;
}
