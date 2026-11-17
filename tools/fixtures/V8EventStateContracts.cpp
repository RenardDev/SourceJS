
// C++
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <utility>

// STL
#include <map>
#include <stdexcept>
#include <string>
#include <vector>

// Template fixture, not standalone: compile through tools/smoke_plugin_manager_native_contracts.js.
// Extracted snapshot/registration methods are real; V8 handles and SDK are doubles.
namespace Fixture {
	struct State {
		std::size_t m_unGlobalHandles;
		std::size_t m_unNativeRegistrations;
		std::size_t m_unNativeRemovals;
		std::size_t m_unFailRegistrationAt;
		std::size_t m_unThrowRegistrationAt;
		std::size_t m_unLogCalls;
		bool m_bManagerAvailable;
		bool m_bRegistrationSucceeds;
		bool m_bThrowRegistration;
		bool m_bRegistrationRecordVisible;
	};

	constinit State g_State {};

	void Check(const bool bCondition) {
		if (!bCondition) {
			std::fputs("V8 event-state contract failed.\n", stderr);
			std::exit(EXIT_FAILURE);
		}
	}

	void ResetState() {
		Check(g_State.m_unGlobalHandles == 0);
		g_State = {};
		g_State.m_bManagerAvailable = true;
		g_State.m_bRegistrationSucceeds = true;
	}
} // namespace Fixture

// Exact V8 spellings; local handles borrow fixture-owned objects without real GC.
namespace v8 {
	template<typename TValue>
	class Local {
	public:
		explicit Local(TValue* const pValue = nullptr) :
			m_pValue(pValue)
		{
		}

		bool IsEmpty() const {
			return !m_pValue;
		}

		TValue* operator->() const {
			return m_pValue;
		}

		bool operator==(Local const& Other) const {
			return m_pValue == Other.m_pValue;
		}

	private:
		TValue* m_pValue;
	};

	struct Context {
	};

	struct Function {
		bool StrictEquals(Local<Function> const LocalOther) const;
	};

	bool Function::StrictEquals(Local<Function> const LocalOther) const {
		return this == LocalOther.operator->();
	}

	struct Isolate {
		Local<Context> GetCurrentContext() const;

		Context* m_pContext;
	};

	Local<Context> Isolate::GetCurrentContext() const {
		return Local<Context>(m_pContext);
	}

	template<typename TValue>
	class Global {
	public:
		Global() {
			m_pValue = nullptr;
		}

		Global(Global const&) = delete;

		Global(Global&& Other) noexcept :
			m_pValue(Other.m_pValue)
		{
			Other.m_pValue = nullptr;
		}

		~Global() {
			Reset();
		}

		Global& operator=(Global const&) = delete;

		Global& operator=(Global&& Other) noexcept {
			if (this == &Other) {
				return *this;
			}

			Reset();
			m_pValue = Other.m_pValue;
			Other.m_pValue = nullptr;

			return *this;
		}

		void Reset() noexcept {
			if (m_pValue) {
				Fixture::Check(Fixture::g_State.m_unGlobalHandles != 0);
				--Fixture::g_State.m_unGlobalHandles;
				m_pValue = nullptr;
			}
		}

		void Reset(Isolate* const pIsolate, Local<TValue> const LocalValue) {
			Fixture::Check(pIsolate && !LocalValue.IsEmpty());
			Reset();
			m_pValue = LocalValue.operator->();
			++Fixture::g_State.m_unGlobalHandles;
		}

		Local<TValue> Get(Isolate* const) const {
			return Local<TValue>(m_pValue);
		}

		bool IsEmpty() const {
			return !m_pValue;
		}

	private:
		TValue* m_pValue;
	};
} // namespace v8

// Project
#include "V8EventStateRecords.h"

namespace SourceJS {
	class V8Runtime {
	public:
		explicit V8Runtime(v8::Isolate* const pIsolate);
		V8Runtime(V8Runtime const&) = delete;
		V8Runtime& operator=(V8Runtime const&) = delete;

		bool AddGameEventCallback(std::string const& strEventName, v8::Local<v8::Function> const LocalCallbackFunction);
		bool RemoveGameEventCallback(std::string const& strEventName, v8::Local<v8::Function> const LocalCallbackFunction);
		bool RebuildGameEventListeners();

	public:
		bool m_bInitialized;
		v8::Isolate* m_pIsolate;
		std::map<std::string, std::vector<ScriptCallbackRecord>> m_mapGameEventCallbacks;
	};

	V8Runtime::V8Runtime(v8::Isolate* const pIsolate) :
		m_pIsolate(pIsolate)
	{
		m_bInitialized = true;
	}

	class GameEventManager {
	public:
		bool AddListener(V8Runtime* const pRuntime, char const* const pszEventName, const bool bServerSide);
		void RemoveListener(V8Runtime* const pRuntime);
	};

	bool GameEventManager::AddListener(V8Runtime* const pRuntime, char const* const pszEventName, const bool bServerSide) {
		Fixture::Check(pRuntime && pszEventName && bServerSide);
		++Fixture::g_State.m_unNativeRegistrations;
		Fixture::g_State.m_bRegistrationRecordVisible = pRuntime->m_mapGameEventCallbacks.find(pszEventName) != pRuntime->m_mapGameEventCallbacks.end();

		if (Fixture::g_State.m_bThrowRegistration || (Fixture::g_State.m_unNativeRegistrations == Fixture::g_State.m_unThrowRegistrationAt)) {
			throw std::runtime_error("injected native registration failure");
		}

		return Fixture::g_State.m_bRegistrationSucceeds && (Fixture::g_State.m_unNativeRegistrations != Fixture::g_State.m_unFailRegistrationAt);
	}

	void GameEventManager::RemoveListener(V8Runtime* const pRuntime) {
		Fixture::Check(pRuntime != nullptr);
		++Fixture::g_State.m_unNativeRemovals;
	}

	constinit GameEventManager g_GameEventManager {};

	class EngineInterfaces {
	public:
		GameEventManager* GetGameEventManager();
	};

	GameEventManager* EngineInterfaces::GetGameEventManager() {
		return Fixture::g_State.m_bManagerAvailable ? &g_GameEventManager : nullptr;
	}

	constinit EngineInterfaces g_Interfaces {};

	class Application {
	public:
		EngineInterfaces& GetEngineInterfaces();
	};

	EngineInterfaces& Application::GetEngineInterfaces() {
		return g_Interfaces;
	}

	constinit Application g_Application {};

	void LogError(char const* const, ...) noexcept {
		++Fixture::g_State.m_unLogCalls;
	}
} // namespace SourceJS

// Project
#include "V8EventStateMethods.h"

int main() {
	constexpr std::size_t kOriginalCallbackCount = 2;
	constexpr std::size_t kRegisteredEventCount = 2;
	constexpr std::size_t kGlobalHandlesPerCallback = 2;
	constexpr std::size_t kRegisteredGlobalHandleCount = kRegisteredEventCount * kGlobalHandlesPerCallback;

	v8::Context FirstContext {};
	v8::Context SecondContext {};
	v8::Function FirstCallback {};
	v8::Function SecondCallback {};
	v8::Function NewCallback {};
	v8::Isolate Isolate { &FirstContext };
	SourceJS::V8Runtime Runtime(&Isolate);
	std::vector<SourceJS::ScriptCallbackRecord> vecCallbacks {};

	Fixture::ResetState();
	Fixture::Check(SourceJS::AddStoredFunction(&Isolate, vecCallbacks, v8::Local<v8::Function>(&FirstCallback)));
	Isolate.m_pContext = &SecondContext;
	Fixture::Check(SourceJS::AddStoredFunction(&Isolate, vecCallbacks, v8::Local<v8::Function>(&SecondCallback)));
	std::vector<SourceJS::ScriptCallbackSnapshotRecord> const vecSnapshot = SourceJS::SnapshotStoredFunctions(&Isolate, vecCallbacks);
	Fixture::Check(vecSnapshot.size() == kOriginalCallbackCount);
	std::vector<v8::Function*> vecExecutedCallbacks {};
	for (auto const& CallbackRecord : vecSnapshot) {
		if (vecExecutedCallbacks.empty()) {
			vecCallbacks.clear();
			Fixture::Check(SourceJS::AddStoredFunction(&Isolate, vecCallbacks, v8::Local<v8::Function>(&NewCallback)));
		}

		vecExecutedCallbacks.push_back(CallbackRecord.m_Function.operator->());
	}

	Fixture::Check((vecExecutedCallbacks.size() == kOriginalCallbackCount) && (vecExecutedCallbacks[0] == &FirstCallback) && (vecExecutedCallbacks[1] == &SecondCallback));
	Fixture::Check((vecSnapshot[0].m_Context.operator->() == &FirstContext) && (vecSnapshot[1].m_Context.operator->() == &SecondContext));
	std::vector<SourceJS::ScriptCallbackSnapshotRecord> const vecNextSnapshot = SourceJS::SnapshotStoredFunctions(&Isolate, vecCallbacks);
	Fixture::Check((vecNextSnapshot.size() == 1) && (vecNextSnapshot[0].m_Function.operator->() == &NewCallback));
	vecCallbacks.clear();
	Fixture::Check(Fixture::g_State.m_unGlobalHandles == 0);
	Fixture::Check(SourceJS::SnapshotStoredFunctions(&Isolate, vecCallbacks).empty());

	Fixture::ResetState();
	Fixture::g_State.m_bManagerAvailable = false;
	Fixture::Check(!Runtime.AddGameEventCallback("TestEvent", v8::Local<v8::Function>(&FirstCallback)));
	Fixture::Check(Runtime.m_mapGameEventCallbacks.empty() && (Fixture::g_State.m_unNativeRegistrations == 0));

	Fixture::ResetState();
	Isolate.m_pContext = nullptr;
	Fixture::Check(!Runtime.AddGameEventCallback("TestEvent", v8::Local<v8::Function>(&FirstCallback)));
	Fixture::Check(Runtime.m_mapGameEventCallbacks.empty() && (Fixture::g_State.m_unNativeRegistrations == 0));
	Isolate.m_pContext = &FirstContext;

	Fixture::ResetState();
	Fixture::g_State.m_bRegistrationSucceeds = false;
	Fixture::Check(!Runtime.AddGameEventCallback("TestEvent", v8::Local<v8::Function>(&FirstCallback)));
	Fixture::Check(Runtime.m_mapGameEventCallbacks.empty() && (Fixture::g_State.m_unGlobalHandles == 0));
	Fixture::Check((Fixture::g_State.m_unNativeRegistrations == 1) && Fixture::g_State.m_bRegistrationRecordVisible);

	Fixture::ResetState();
	Fixture::g_State.m_bThrowRegistration = true;
	bool bCaughtRegistrationFailure = false;
	try {
		Runtime.AddGameEventCallback("TestEvent", v8::Local<v8::Function>(&FirstCallback));
	} catch (std::runtime_error const&) {
		bCaughtRegistrationFailure = true;
	}

	Fixture::Check(bCaughtRegistrationFailure && Runtime.m_mapGameEventCallbacks.empty() && (Fixture::g_State.m_unGlobalHandles == 0));
	Fixture::Check((Fixture::g_State.m_unNativeRegistrations == 1) && Fixture::g_State.m_bRegistrationRecordVisible);

	Fixture::ResetState();
	Fixture::Check(!Runtime.AddGameEventCallback("", v8::Local<v8::Function>(&FirstCallback)));
	Fixture::Check(!Runtime.AddGameEventCallback("TestEvent", v8::Local<v8::Function> {}));
	Fixture::Check(Fixture::g_State.m_unNativeRegistrations == 0);
	Fixture::Check(Runtime.AddGameEventCallback("TestEvent", v8::Local<v8::Function>(&FirstCallback)));
	Fixture::Check(Runtime.AddGameEventCallback("TestEvent", v8::Local<v8::Function>(&SecondCallback)));
	Fixture::Check((Fixture::g_State.m_unNativeRegistrations == 1) && Fixture::g_State.m_bRegistrationRecordVisible);
	Fixture::Check((Runtime.m_mapGameEventCallbacks.size() == 1) && (Runtime.m_mapGameEventCallbacks.find("TestEvent") != Runtime.m_mapGameEventCallbacks.end()) && (Runtime.m_mapGameEventCallbacks.find("TestEvent")->second.size() == kOriginalCallbackCount));
	Isolate.m_pContext = nullptr;
	Fixture::Check(!Runtime.AddGameEventCallback("TestEvent", v8::Local<v8::Function>(&NewCallback)));
	Fixture::Check((Runtime.m_mapGameEventCallbacks.find("TestEvent") != Runtime.m_mapGameEventCallbacks.end()) && (Runtime.m_mapGameEventCallbacks.find("TestEvent")->second.size() == kOriginalCallbackCount) && (Fixture::g_State.m_unNativeRegistrations == 1));
	Runtime.m_mapGameEventCallbacks.clear();
	Fixture::Check(Fixture::g_State.m_unGlobalHandles == 0);

	Fixture::ResetState();
	Isolate.m_pContext = &FirstContext;
	Fixture::Check(Runtime.AddGameEventCallback("FirstEvent", v8::Local<v8::Function>(&FirstCallback)));
	Fixture::Check(Runtime.AddGameEventCallback("SecondEvent", v8::Local<v8::Function>(&SecondCallback)));
	Isolate.m_pContext = &SecondContext;
	Fixture::Check(!Runtime.RemoveGameEventCallback("FirstEvent", v8::Local<v8::Function>(&FirstCallback)));
	Isolate.m_pContext = &FirstContext;
	Fixture::Check(!Runtime.RemoveGameEventCallback("FirstEvent", v8::Local<v8::Function>(&NewCallback)));
	Fixture::Check((Fixture::g_State.m_unNativeRemovals == 0) && (Fixture::g_State.m_unGlobalHandles == kRegisteredGlobalHandleCount));
	Fixture::g_State.m_bManagerAvailable = false;
	Fixture::Check(!Runtime.RemoveGameEventCallback("FirstEvent", v8::Local<v8::Function>(&FirstCallback)));
	Fixture::Check((Runtime.m_mapGameEventCallbacks.size() == kRegisteredEventCount) && (Fixture::g_State.m_unGlobalHandles == kRegisteredGlobalHandleCount));
	Fixture::Check(Fixture::g_State.m_unLogCalls == 1);
	Fixture::g_State.m_bManagerAvailable = true;
	Fixture::g_State.m_unLogCalls = 0;

	// Rebuild rejects the remaining event once, then restoration succeeds.
	Fixture::g_State.m_unFailRegistrationAt = 3;
	Fixture::Check(!Runtime.RemoveGameEventCallback("FirstEvent", v8::Local<v8::Function>(&FirstCallback)));
	Fixture::Check((Runtime.m_mapGameEventCallbacks.size() == kRegisteredEventCount) && (Fixture::g_State.m_unGlobalHandles == kRegisteredGlobalHandleCount));
	auto itRestoredCallback = Runtime.m_mapGameEventCallbacks.find("FirstEvent");
	Fixture::Check((itRestoredCallback != Runtime.m_mapGameEventCallbacks.end()) && !itRestoredCallback->second.empty());
	Fixture::Check(itRestoredCallback->second[0].m_Context.Get(&Isolate) == v8::Local<v8::Context>(&FirstContext));
	Fixture::Check(itRestoredCallback->second[0].m_Function.Get(&Isolate) == v8::Local<v8::Function>(&FirstCallback));
	Fixture::Check(Fixture::g_State.m_unLogCalls == 0);

	// A throwing rebuild preserves the original exception after restoring the record.
	Fixture::g_State.m_unThrowRegistrationAt = Fixture::g_State.m_unNativeRegistrations + 1;
	bool bCaughtRemovalFailure = false;
	try {
		Runtime.RemoveGameEventCallback("FirstEvent", v8::Local<v8::Function>(&FirstCallback));
	} catch (std::runtime_error const&) {
		bCaughtRemovalFailure = true;
	}

	Fixture::Check(bCaughtRemovalFailure && (Runtime.m_mapGameEventCallbacks.size() == kRegisteredEventCount) && (Fixture::g_State.m_unGlobalHandles == kRegisteredGlobalHandleCount));
	Fixture::Check(Fixture::g_State.m_unLogCalls == 0);

	// A secondary restoration error is diagnosed without escaping as another failure.
	Fixture::g_State.m_bThrowRegistration = true;
	bCaughtRemovalFailure = false;
	try {
		Runtime.RemoveGameEventCallback("FirstEvent", v8::Local<v8::Function>(&FirstCallback));
	} catch (std::runtime_error const&) {
		bCaughtRemovalFailure = true;
	}

	Fixture::Check(bCaughtRemovalFailure && (Runtime.m_mapGameEventCallbacks.size() == kRegisteredEventCount) && (Fixture::g_State.m_unGlobalHandles == kRegisteredGlobalHandleCount));
	Fixture::Check(Fixture::g_State.m_unLogCalls == 1);
	Fixture::g_State.m_bThrowRegistration = false;
	Fixture::g_State.m_bRegistrationSucceeds = false;
	Fixture::Check(!Runtime.RemoveGameEventCallback("FirstEvent", v8::Local<v8::Function>(&FirstCallback)));
	Fixture::Check((Runtime.m_mapGameEventCallbacks.size() == kRegisteredEventCount) && (Fixture::g_State.m_unGlobalHandles == kRegisteredGlobalHandleCount));
	Fixture::Check(Fixture::g_State.m_unLogCalls == 2);
	Fixture::g_State.m_bRegistrationSucceeds = true;
	Fixture::Check(Runtime.RemoveGameEventCallback("FirstEvent", v8::Local<v8::Function>(&FirstCallback)));
	Fixture::Check((Runtime.m_mapGameEventCallbacks.size() == 1) && (Fixture::g_State.m_unGlobalHandles == kGlobalHandlesPerCallback));
	Fixture::Check(Runtime.RemoveGameEventCallback("SecondEvent", v8::Local<v8::Function>(&SecondCallback)));
	Fixture::Check(Runtime.m_mapGameEventCallbacks.empty() && (Fixture::g_State.m_unGlobalHandles == 0));

	Fixture::ResetState();
	Fixture::Check(Runtime.AddGameEventCallback("TestEvent", v8::Local<v8::Function>(&FirstCallback)));
	Fixture::Check(Runtime.AddGameEventCallback("TestEvent", v8::Local<v8::Function>(&SecondCallback)));
	Fixture::Check(Runtime.RemoveGameEventCallback("TestEvent", v8::Local<v8::Function>(&FirstCallback)));
	Fixture::Check((Runtime.m_mapGameEventCallbacks.find("TestEvent") != Runtime.m_mapGameEventCallbacks.end()) && (Runtime.m_mapGameEventCallbacks.find("TestEvent")->second.size() == 1) && (Fixture::g_State.m_unNativeRemovals == 0));
	Fixture::g_State.m_bManagerAvailable = false;
	Fixture::Check(Runtime.RemoveGameEventCallback("TestEvent", v8::Local<v8::Function>(&SecondCallback)));
	Fixture::Check(Runtime.m_mapGameEventCallbacks.empty() && (Fixture::g_State.m_unGlobalHandles == 0));

	std::puts("V8 event-state contracts passed.");

	return 0;
}
