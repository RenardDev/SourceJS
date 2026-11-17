
// C++
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <utility>

// STL
#include <algorithm>
#include <exception>
#include <filesystem>
#include <functional>
#include <map>
#include <memory>
#include <new>
#include <stdexcept>
#include <string>
#include <vector>

// Template fixture, not standalone: compile through tools/smoke_plugin_manager_native_contracts.js.
// Executes extracted runtime methods with V8/SDK doubles; not live JavaScript, GC or engine registration.
namespace Fixture {
	struct State {
		bool m_bThrowConstruction;
		bool m_bThrowCallbackStorage;
		bool m_bFailCallbackStorage;
		bool m_bFailRegistration;
		unsigned int m_unRegistrationExceptions;
		std::size_t m_unLiveCommands;
		std::size_t m_unErrors;
		std::size_t m_unHandleReads;
		std::size_t m_unPluginContextRemovals;
		std::size_t m_unPluginResourceReleases;
		void* m_pExpectedIsolate;
		unsigned int m_unBlockedCallbackID;
		unsigned int m_unFailedCallbackID;
		std::vector<unsigned int> m_vecCalls;
		std::function<void(unsigned int)> m_Callback;
	};

	State& GetState() {
		static State s_State {};

		return s_State;
	}

	void Require(const bool bCondition, char const* const pszMessage) {
		if (!bCondition) {
			throw std::runtime_error(pszMessage);
		}
	}
} // namespace Fixture

namespace v8 {
	// SDK shapes are mutually dependent: Local::Get takes Isolate, which stores Local<Context>.
	class Isolate;
	template<typename TValue>
	class Local;

	struct Value {
	};

	struct Context {
		class Scope {
		public:
			explicit Scope(Local<Context> const);
		};

		static Local<Context> New(Isolate*);
	};

	struct Object {
	};

	struct Function {
		unsigned int m_unID;
	};

	template<typename TValue>
	class Local {
	public:
		Local() {
			m_pValue = nullptr;
		}

		explicit Local(TValue* const pValue) :
			m_pValue(pValue)
		{
		}

		void Reset() {
			m_pValue = nullptr;
		}

		void Reset(Isolate*, Local<TValue> const Value) {
			m_pValue = Value.m_pValue;
		}

		bool IsEmpty() const {
			return !m_pValue;
		}

		Local<TValue> Get(Isolate* const pIsolate) const {
			Fixture::State& State = Fixture::GetState();
			if (State.m_pExpectedIsolate && (State.m_pExpectedIsolate != pIsolate)) {
				std::abort();
			}

			++State.m_unHandleReads;

			return *this;
		}

		TValue* operator->() const {
			return m_pValue;
		}

		bool operator==(Local<TValue> const Other) const {
			return m_pValue == Other.m_pValue;
		}

		bool operator!=(Local<TValue> const Other) const {
			return m_pValue != Other.m_pValue;
		}

	private:
		TValue* m_pValue;
	};

	template<typename TValue>
	using Global = Local<TValue>;

	Context::Scope::Scope(Local<Context> const) {
	}

	Local<Context> Context::New(Isolate*) {
		static Context s_Context {};

		return Local<Context>(&s_Context);
	}

	class Isolate {
	public:
		class Scope {
		public:
			explicit Scope(Isolate*);
		};

		Local<Context> GetCurrentContext() const {
			return m_Context;
		}

	public:
		Local<Context> m_Context;
	};

	Isolate::Scope::Scope(Isolate*) {
	}

	class HandleScope {
	public:
		explicit HandleScope(Isolate*);
	};

	HandleScope::HandleScope(Isolate*) {
	}
} // namespace v8

// Generated included-only records require the V8 doubles above.
#include "V8EventStateRecords.h"

namespace SourceJS {
	constexpr int kSourceJSOwnedCommandFlag = 0x01;
	constexpr int kSourceJSClientCommandFlags = 0x03;
	constexpr int FCVAR_GAMEDLL = 0x02;

	class ConCommand {
	public:
		ConCommand(char const* pszName, void(*)(), char const*, const int nFlags);
		~ConCommand();

		bool IsRegistered() const {
			return m_bRegistered;
		}

		void AddFlags(const int nFlags) {
			m_nFlags |= nFlags;
		}

	public:
		char const* m_pszName;
		int m_nFlags;
		bool m_bRegistered;
	};

	class EngineInterfaces {
	public:
		ConCommand* FindCommandBase(std::string const& strName) {
			auto itCommand = m_mapCommands.find(strName);
			return (itCommand == m_mapCommands.end()) ? nullptr : itCommand->second;
		}

		bool RegisterConCommand(ConCommand* const pCommand) {
			// Model the real integration's failure after the SDK accepted the address.
			m_mapCommands[pCommand->m_pszName] = pCommand;
			pCommand->m_bRegistered = true;

			Fixture::State& State = Fixture::GetState();
			if (State.m_unRegistrationExceptions) {
				--State.m_unRegistrationExceptions;
				throw std::bad_alloc();
			}

			return !State.m_bFailRegistration;
		}

		void UnregisterConCommand(ConCommand* const pCommand) noexcept {
			if (!pCommand) {
				return;
			}

			for (auto itCommand = m_mapCommands.begin(); itCommand != m_mapCommands.end(); ++itCommand) {
				if (itCommand->second == pCommand) {
					m_mapCommands.erase(itCommand);
					break;
				}
			}

			pCommand->m_bRegistered = false;
		}

	public:
		std::map<std::string, ConCommand*> m_mapCommands;
	};

	class MemoryHookManager {
	public:
		void RemoveContext(v8::Local<v8::Context> const LocalContext) {
			Fixture::Require(!LocalContext.IsEmpty(), "Expected the unloading plugin context");
			++Fixture::GetState().m_unPluginContextRemovals;
		}
	};

	void ReleaseSourceJSExternalResources(std::string const&) {
		++Fixture::GetState().m_unPluginResourceReleases;
	}

	class Application {
	public:
		MemoryHookManager& GetMemoryHookManager() {
			static MemoryHookManager s_Manager {};

			return s_Manager;
		}

		EngineInterfaces& GetEngineInterfaces() {
			static EngineInterfaces s_Interfaces {};

			return s_Interfaces;
		}
	};

	constinit Application g_Application {};

	ConCommand::ConCommand(char const* const pszName, void(*)(), char const*, const int nFlags) :
		m_pszName(pszName),
		m_nFlags(nFlags)
	{
		m_bRegistered = false;

		Fixture::State& State = Fixture::GetState();
		if (State.m_bThrowConstruction) {
			State.m_bThrowConstruction = false;
			throw std::bad_alloc();
		}

		++State.m_unLiveCommands;
	}

	ConCommand::~ConCommand() {
		// Destruction while published is a hard fixture failure, including during unwinding.
		if (m_bRegistered) {
			std::abort();
		}

		--Fixture::GetState().m_unLiveCommands;
	}

	struct ScriptCommandRecord {
		std::string m_strName;
		std::unique_ptr<ConCommand> m_pCommand;
	};

	struct PluginRuntimeRecord {
		v8::Global<v8::Context> m_Context;
		v8::Global<v8::Object> m_SourceJSObject;
		std::map<std::string, v8::Global<v8::Value>> m_mapPackageModuleCache;
		std::map<std::string, v8::Global<v8::Value>> m_mapLocalModuleCache;
		v8::Global<v8::Value> m_Exports;
		bool m_bUnloading;
	};

	class ClientConsoleLogScope {
	public:
		explicit ClientConsoleLogScope(const int);
	};

	ClientConsoleLogScope::ClientConsoleLogScope(const int) {
	}

	class V8Runtime {
	public:
		explicit V8Runtime(v8::Isolate* const pIsolate);
		V8Runtime(V8Runtime const&) = delete;
		V8Runtime& operator=(V8Runtime const&) = delete;

		~V8Runtime() {
			for (auto const& Record : m_mapRegisteredCommands) {
				g_Application.GetEngineInterfaces().UnregisterConCommand(Record.second.m_pCommand.get());
			}
		}

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
		v8::Local<v8::Object> GetSourceJSObject(v8::Isolate* const pIsolate) const;
		v8::Local<v8::Context> GetContext(v8::Isolate* const pIsolate) const noexcept;
		bool GetCurrentPluginName(v8::Isolate* const pIsolate, std::string& strPluginNameOut) const;
		bool ExecutePluginFile(std::filesystem::path const& PathScript, std::string const& strPluginName);
		bool ReadFile(std::filesystem::path const& PathScript, std::string& strSourceOut);
		bool InstallRuntimeObjects(v8::Local<v8::Context> const LocalContext, v8::Local<v8::Object>& LocalObjectOut);
		bool ExecuteCommonJS(std::string const& strSource, std::string const& strScriptName, v8::Global<v8::Context> const& Context, v8::Global<v8::Value>* const pExportsOut);
		void UnloadPlugin(std::string const& strPluginName);
		bool CallPluginExportFunction(std::string const& strPluginName, char const* const pszFunctionName);
		void RemoveCallbacksForContext(v8::Local<v8::Context> const LocalContext);

	private:
		PluginRuntimeRecord const* FindPluginRuntimeRecord(v8::Local<v8::Context> const LocalContext) const noexcept;

	public:
		bool m_bInitialized;
		std::size_t m_unUnloadExportCalls;
		bool m_bFailUnloadExport;
		std::size_t m_unLoadExportCalls;
		std::size_t m_unCommonJSCalls;
		std::function<bool()> m_CommonJSCallback;
		std::function<bool(std::string const&)> m_LoadCallback;
		std::function<void(std::string const&)> m_UnloadCallback;
		v8::Isolate* m_pIsolate;
		std::map<std::string, ScriptCommandRecord> m_mapRegisteredCommands;
		std::map<std::string, std::vector<ScriptCallbackRecord>> m_mapCommandCallbacks;
		std::map<std::string, std::vector<ScriptCallbackRecord>> m_mapClientCommandCallbacks;
		std::map<std::string, std::vector<ScriptCallbackRecord>> m_mapSayCommandCallbacks;
		std::vector<ScriptCallbackRecord> m_vecClientCommandFilters;
		std::vector<ScriptCallbackRecord> m_vecEarlySayCommandFilters;
		std::vector<ScriptCallbackRecord> m_vecSayCommandFilters;
		std::map<std::string, PluginRuntimeRecord> m_mapPluginRuntimes;
		v8::Global<v8::Context> m_V8Context;
		v8::Global<v8::Object> m_SourceJSObject;
	};

	V8Runtime::V8Runtime(v8::Isolate* const pIsolate) :
		m_pIsolate(pIsolate)
	{
		m_bInitialized = true;
		m_unUnloadExportCalls = 0;
		m_bFailUnloadExport = false;
		m_unLoadExportCalls = 0;
		m_unCommonJSCalls = 0;
	}

	bool V8Runtime::ReadFile(std::filesystem::path const&, std::string& strSourceOut) {
		strSourceOut = "fixture plugin source";

		return true;
	}

	bool V8Runtime::InstallRuntimeObjects(v8::Local<v8::Context> const, v8::Local<v8::Object>& LocalObjectOut) {
		static v8::Object s_Object {};
		LocalObjectOut = v8::Local<v8::Object>(&s_Object);

		return true;
	}

	bool V8Runtime::ExecuteCommonJS(std::string const&, std::string const&, v8::Global<v8::Context> const&, v8::Global<v8::Value>* const) {
		++m_unCommonJSCalls;

		return m_CommonJSCallback ? m_CommonJSCallback() : true;
	}

	bool V8Runtime::CallPluginExportFunction(std::string const& strName, char const* const pszFunctionName) {
		if (pszFunctionName && (std::string(pszFunctionName) == "Load")) {
			++m_unLoadExportCalls;
			return m_LoadCallback ? m_LoadCallback(strName) : true;
		}

		Fixture::Require(pszFunctionName && (std::string(pszFunctionName) == "Unload"), "Expected the unload export");
		++m_unUnloadExportCalls;
		if (m_UnloadCallback) {
			m_UnloadCallback(strName);
		}

		return !m_bFailUnloadExport;
	}

	void V8Runtime::RemoveCallbacksForContext(v8::Local<v8::Context> const) {
	}

	void DispatchSourceJSRuntimeCommand() {
	}

	void LogWarning(char const*, ...) noexcept {
	}

	void LogError(char const*, ...) noexcept {
		++Fixture::GetState().m_unErrors;
	}

	bool AddStoredFunction(v8::Isolate*, std::vector<ScriptCallbackRecord>& vecCallbacks, v8::Local<v8::Function> const LocalFunction) {
		Fixture::State& State = Fixture::GetState();
		if (State.m_bThrowCallbackStorage) {
			throw std::bad_alloc();
		}

		if (State.m_bFailCallbackStorage) {
			return false;
		}

		static v8::Context s_Context {};
		vecCallbacks.push_back({ v8::Local<v8::Context>(&s_Context), LocalFunction });

		return true;
	}

	bool RemoveStoredFunction(v8::Isolate*, std::vector<ScriptCallbackRecord>& vecCallbacks, v8::Local<v8::Function> const LocalFunction) {
		auto IsRequestedCallback = [LocalFunction](ScriptCallbackRecord const& Record) {
			return Record.m_Function == LocalFunction;
		};
		auto itCallback = std::find_if(vecCallbacks.begin(), vecCallbacks.end(), IsRequestedCallback);
		if (itCallback == vecCallbacks.end()) {
			return false;
		}

		vecCallbacks.erase(itCallback);

		return true;
	}

	void ResetStoredFunctions(std::vector<ScriptCallbackRecord>& vecCallbacks) {
		vecCallbacks.clear();
	}

	std::string JoinArguments(std::vector<std::string> const&, const std::size_t) {
		return "arguments";
	}

	std::vector<std::string> SplitCommandText(std::string const& strText) {
		// Parser behavior is not under test; dispatch scenarios pass one command token.
		return { strText };
	}

	bool CallCommandCallback(v8::Isolate*, v8::Local<v8::Context>, v8::Local<v8::Function> const LocalFunction, char const*, std::string const&, std::string const&, const int, std::vector<std::string> const&, std::string const*, bool const*, bool& bBlocksCommandOut) {
		Fixture::State& State = Fixture::GetState();
		State.m_vecCalls.push_back(LocalFunction->m_unID);

		if (State.m_Callback) {
			State.m_Callback(LocalFunction->m_unID);
		}

		if (LocalFunction->m_unID == State.m_unFailedCallbackID) {
			return false;
		}

		bBlocksCommandOut = LocalFunction->m_unID == State.m_unBlockedCallbackID;

		return true;
	}
} // namespace SourceJS

#include "V8CommandStateMethods.h"

namespace Fixture {
	void CheckRegistrationFailures() {
		constexpr unsigned int kConstructionExceptionCase = 0;
		constexpr unsigned int kRegistrationExceptionCase = 1;
		constexpr unsigned int kCallbackExceptionCase = 2;
		constexpr unsigned int kCallbackRejectionCase = 3;
		constexpr unsigned int kRegistrationRejectionCase = 4;
		constexpr unsigned int kCaseCount = 5;

		v8::Isolate Isolate {};
		v8::Function Function { 1 };
		v8::Local<v8::Function> const LocalFunction { &Function };
		State& State = GetState();

		for (unsigned int unFailure = 0; unFailure < kCaseCount; ++unFailure) {
			SourceJS::V8Runtime Runtime { &Isolate };
			State.m_bThrowConstruction = unFailure == kConstructionExceptionCase;
			State.m_unRegistrationExceptions = (unFailure == kRegistrationExceptionCase) ? 1 : 0;
			State.m_bThrowCallbackStorage = unFailure == kCallbackExceptionCase;
			State.m_bFailCallbackStorage = unFailure == kCallbackRejectionCase;
			State.m_bFailRegistration = unFailure == kRegistrationRejectionCase;

			try {
				Require(!Runtime.RegisterCommand("example", LocalFunction), "Failure was reported as success");
				Require(unFailure >= kCallbackRejectionCase, "Expected allocation exception was lost");
			} catch (std::bad_alloc const&) {
				Require(unFailure < kCallbackRejectionCase, "Unexpected allocation exception");
			}

			Require(Runtime.m_mapRegisteredCommands.empty(), "Failed registration retained an owned record");
			Require(Runtime.m_mapCommandCallbacks.empty(), "Failed registration retained callbacks");
			Require(SourceJS::g_Application.GetEngineInterfaces().m_mapCommands.empty(), "Failed registration retained an SDK address");
			Require(State.m_unLiveCommands == 0, "Failed registration leaked a command");
			State.m_bThrowCallbackStorage = false;
			State.m_bFailCallbackStorage = false;
			State.m_bFailRegistration = false;
			Require(Runtime.RegisterCommand("example", LocalFunction), "Registration could not recover");

			State.m_bThrowCallbackStorage = true;
			try {
				Runtime.RegisterCommand("example", LocalFunction);
				Require(false, "Existing-command failure was not injected");
			} catch (std::bad_alloc const&) {
				Require(Runtime.m_mapRegisteredCommands.size() == 1, "Existing command was discarded");
				Require(Runtime.m_mapCommandCallbacks.at("example").size() == 1, "Existing callbacks were discarded");
			}

			State.m_bThrowCallbackStorage = false;
			State.m_bFailCallbackStorage = true;
			Require(!Runtime.RegisterCommand("example", LocalFunction), "Rejected callback was reported as registered");
			Require(Runtime.m_mapCommandCallbacks.at("example").size() == 1, "Rejected callback discarded existing listeners");
			State.m_bFailCallbackStorage = false;
		}

		SourceJS::V8Runtime Runtime { &Isolate };
		Require(Runtime.RegisterCommand("example", LocalFunction), "Inactive-command setup failed");
		auto* const pCommand = Runtime.m_mapRegisteredCommands.at("example").m_pCommand.get();
		Require(Runtime.OwnsRegisteredCommand("example"), "The exact registered command must be recognized");
		Require(!Runtime.OwnsRegisteredCommand("other"), "An unrelated command must not be consumed");
		SourceJS::g_Application.GetEngineInterfaces().UnregisterConCommand(pCommand);
		Require(!Runtime.OwnsRegisteredCommand("example"), "An inactive command record must not consume engine input");
		Require(Runtime.RegisterCommand("example", LocalFunction), "Inactive command was not registered again");
		Require(SourceJS::g_Application.GetEngineInterfaces().FindCommandBase("example") == pCommand, "Re-registration lost the owner");
	}

	void CheckDispatchMutation() {
		constexpr unsigned int kFirstCallbackID = 1;
		constexpr unsigned int kSecondCallbackID = 2;
		constexpr unsigned int kReplacementCallbackID = 3;

		v8::Isolate Isolate {};
		v8::Function First { kFirstCallbackID };
		v8::Function Second { kSecondCallbackID };
		v8::Function Third { kReplacementCallbackID };
		SourceJS::V8Runtime Runtime { &Isolate };
		Require(Runtime.RegisterCommand("example", v8::Local<v8::Function>(&First)), "First registration failed");
		Require(Runtime.RegisterCommand("example", v8::Local<v8::Function>(&Second)), "Second registration failed");

		State& State = GetState();
		State.m_vecCalls.clear();
		State.m_Callback = [&Runtime, &Third](const unsigned int unID) {
			if (unID == kFirstCallbackID) {
				Require(Runtime.UnregisterCommand("example", {}, false), "Callback removal failed");
				Require(Runtime.RegisterCommand("example", v8::Local<v8::Function>(&Third)), "Callback replacement failed");
			}
		};
		Runtime.DispatchCommand("example", {});
		Require(State.m_vecCalls == std::vector<unsigned int> { kFirstCallbackID, kSecondCallbackID }, "Dispatch did not retain its original snapshot");
		State.m_vecCalls.clear();
		Runtime.DispatchCommand("example", {});
		Require(State.m_vecCalls == std::vector<unsigned int> { kReplacementCallbackID }, "Later dispatch did not see the replacement");
		State.m_Callback = {};
	}

	void CheckCallbackStorage(const bool bSayCommand) {
		v8::Isolate Isolate {};
		v8::Function Function { 1 };
		v8::Local<v8::Function> const LocalFunction { &Function };
		SourceJS::V8Runtime Runtime { &Isolate };
		State& State = GetState();
		std::map<std::string, std::vector<SourceJS::ScriptCallbackRecord>> const& mapCallbacks = bSayCommand ? Runtime.m_mapSayCommandCallbacks : Runtime.m_mapClientCommandCallbacks;
		auto RegisterCallback = [&Runtime, bSayCommand](v8::Local<v8::Function> const LocalCallback) {
			return bSayCommand ? Runtime.RegisterSayCommand("example", LocalCallback) : Runtime.RegisterClientCommand("example", LocalCallback);
		};
		Require(Runtime.RegisterCommand("example", LocalFunction), "Command callback setup failed");

		State.m_bThrowCallbackStorage = true;
		try {
			RegisterCallback(LocalFunction);
			Require(false, "Callback storage exception was not injected");
		} catch (std::bad_alloc const&) {
			Require(mapCallbacks.empty(), "Callback exception retained an empty record");
		}

		State.m_bThrowCallbackStorage = false;
		State.m_bFailCallbackStorage = true;
		Require(!RegisterCallback(LocalFunction), "Rejected callback was registered");
		Require(mapCallbacks.empty(), "Rejected callback retained an empty record");
		State.m_bFailCallbackStorage = false;
		Require(RegisterCallback(LocalFunction), "Callback could not recover");
		const int nExpectedFlags = bSayCommand ? SourceJS::kSourceJSOwnedCommandFlag : SourceJS::kSourceJSClientCommandFlags;
		Require(Runtime.m_mapRegisteredCommands.at("example").m_pCommand->m_nFlags == nExpectedFlags, "Callback registration changed command flags incorrectly");

		State.m_bThrowCallbackStorage = true;
		try {
			RegisterCallback(LocalFunction);
			Require(false, "Existing callback storage exception was not injected");
		} catch (std::bad_alloc const&) {
			Require(mapCallbacks.at("example").size() == 1, "Callback exception discarded existing listeners");
		}

		State.m_bThrowCallbackStorage = false;
	}

	void CheckCommandPhaseSnapshots(const bool bSayCommand) {
		constexpr unsigned int kFirstFilterID = 1;
		constexpr unsigned int kSecondFilterID = 2;
		constexpr unsigned int kNewFilterID = 3;
		constexpr unsigned int kFirstCallbackID = 4;
		constexpr unsigned int kSecondCallbackID = 5;
		constexpr unsigned int kNewCallbackID = 6;
		constexpr int kClientIndex = 1;

		v8::Isolate Isolate {};
		v8::Function FirstFilter { kFirstFilterID };
		v8::Function SecondFilter { kSecondFilterID };
		v8::Function NewFilter { kNewFilterID };
		v8::Function FirstCallback { kFirstCallbackID };
		v8::Function SecondCallback { kSecondCallbackID };
		v8::Function NewCallback { kNewCallbackID };
		SourceJS::V8Runtime Runtime { &Isolate };
		State& State = GetState();
		State.m_vecCalls.clear();

		auto AddFilter = [&Runtime, bSayCommand](v8::Function* const pFunction) {
			v8::Local<v8::Function> const LocalFunction { pFunction };

			return bSayCommand ? Runtime.AddSayCommandFilter(LocalFunction) : Runtime.AddClientCommandFilter(LocalFunction);
		};
		auto RemoveFilter = [&Runtime, bSayCommand](v8::Function* const pFunction) {
			v8::Local<v8::Function> const LocalFunction { pFunction };

			return bSayCommand ? Runtime.RemoveSayCommandFilter(LocalFunction) : Runtime.RemoveClientCommandFilter(LocalFunction);
		};
		auto RegisterCallback = [&Runtime, bSayCommand](v8::Function* const pFunction) {
			v8::Local<v8::Function> const LocalFunction { pFunction };

			return bSayCommand ? Runtime.RegisterSayCommand("example", LocalFunction) : Runtime.RegisterClientCommand("example", LocalFunction);
		};
		auto RemoveCallbacks = [&Runtime, bSayCommand]() {
			return bSayCommand ? Runtime.UnregisterSayCommand("example", {}, false) : Runtime.UnregisterClientCommand("example", {}, false);
		};
		auto Dispatch = [&Runtime, bSayCommand]() {
			return bSayCommand ? Runtime.DispatchSayCommand(kClientIndex, "example", false) : Runtime.DispatchClientCommand(kClientIndex, { "example" });
		};
		auto ExpectCalls = [&State](std::vector<unsigned int> const& vecExpected) {
			Require(State.m_vecCalls == vecExpected, "Unexpected dispatch-phase callback order");
			State.m_vecCalls.clear();
		};
		Require(AddFilter(&FirstFilter) && AddFilter(&SecondFilter), "Filter registration failed");
		Require(RegisterCallback(&FirstCallback) && RegisterCallback(&SecondCallback), "Command callback registration failed");

		State.m_Callback = [&RemoveFilter, &FirstFilter, &SecondFilter, &AddFilter, &NewFilter, &RemoveCallbacks, &RegisterCallback, &NewCallback](const unsigned int unID) {
			if (unID == kFirstFilterID) {
				Require(RemoveFilter(&FirstFilter) && RemoveFilter(&SecondFilter), "Filter mutation failed");
				Require(AddFilter(&NewFilter), "New filter registration failed");
				Require(RemoveCallbacks() && RegisterCallback(&NewCallback), "Filter could not replace the command phase");
			}
		};
		Require(!Dispatch(), "Nonblocking filter dispatch blocked");
		ExpectCalls({ kFirstFilterID, kSecondFilterID, kNewCallbackID });
		Require(!Dispatch(), "Later nonblocking filter dispatch blocked");
		ExpectCalls({ kNewFilterID, kNewCallbackID });
		State.m_Callback = {};

		Require(RemoveFilter(&NewFilter) && RemoveCallbacks(), "Command phase setup cleanup failed");
		Require(RegisterCallback(&FirstCallback) && RegisterCallback(&SecondCallback), "Command phase setup failed");
		State.m_Callback = [&RemoveCallbacks, &RegisterCallback, &NewCallback](const unsigned int unID) {
			if (unID == kFirstCallbackID) {
				Require(RemoveCallbacks() && RegisterCallback(&NewCallback), "Command callback mutation failed");
			}
		};
		Require(!Dispatch(), "Nonblocking command dispatch blocked");
		ExpectCalls({ kFirstCallbackID, kSecondCallbackID });
		Require(!Dispatch(), "Later nonblocking command dispatch blocked");
		ExpectCalls({ kNewCallbackID });
		State.m_Callback = {};

		Require(RemoveCallbacks() && RegisterCallback(&FirstCallback) && RegisterCallback(&SecondCallback), "Blocking command setup failed");
		State.m_unBlockedCallbackID = kFirstCallbackID;
		Require(Dispatch(), "Blocking command result was ignored");
		ExpectCalls({ kFirstCallbackID });
		State.m_unFailedCallbackID = kFirstCallbackID;
		Require(!Dispatch(), "Failed command callback blocked dispatch");
		ExpectCalls({ kFirstCallbackID, kSecondCallbackID });

		State.m_unFailedCallbackID = 0;
		State.m_unBlockedCallbackID = kFirstFilterID;
		Require(AddFilter(&FirstFilter) && AddFilter(&SecondFilter), "Blocking filter setup failed");
		Require(Dispatch(), "Blocking filter result was ignored");
		ExpectCalls({ kFirstFilterID });
		State.m_unFailedCallbackID = kFirstFilterID;
		Require(!Dispatch(), "Failed filter blocked dispatch");
		ExpectCalls({ kFirstFilterID, kSecondFilterID, kFirstCallbackID, kSecondCallbackID });
		State.m_unFailedCallbackID = 0;
		State.m_unBlockedCallbackID = 0;
	}

	void CheckEarlySayFilters() {
		constexpr unsigned int kRegularID = 1;
		constexpr unsigned int kEarlyID = 2;
		constexpr unsigned int kSecondEarlyID = 3;
		constexpr unsigned int kTriggerID = 4;
		constexpr int kClientIndex = 1;

		v8::Isolate Isolate {};
		v8::Function RegularFilter { kRegularID };
		v8::Function EarlyFilter { kEarlyID };
		v8::Function SecondEarlyFilter { kSecondEarlyID };
		v8::Function Trigger { kTriggerID };
		SourceJS::V8Runtime Runtime { &Isolate };
		v8::Local<v8::Function> const LocalEarlyFilter { &EarlyFilter };
		State& TestState = GetState();
		TestState.m_vecCalls.clear();
		Require(Runtime.AddSayCommandFilter(v8::Local<v8::Function>(&RegularFilter)), "Could not register the regular say filter");
		Require(Runtime.AddSayCommandFilter(LocalEarlyFilter, true), "Could not register the early say filter");
		Require(Runtime.AddSayCommandFilter(v8::Local<v8::Function>(&SecondEarlyFilter), true), "Could not register the second early say filter");
		Require(Runtime.RegisterSayCommand("/example", v8::Local<v8::Function>(&Trigger)), "Could not register the say command");
		Require(!Runtime.RemoveSayCommandFilter(LocalEarlyFilter), "Regular removal affected an early filter");

		TestState.m_unBlockedCallbackID = kEarlyID;
		Require(Runtime.DispatchSayCommand(kClientIndex, "/example", true), "An early filter did not block team chat");
		Require(TestState.m_vecCalls == std::vector<unsigned int> { kEarlyID }, "An early block reached another filter or trigger");
		TestState.m_vecCalls.clear();
		TestState.m_unBlockedCallbackID = 0;

		Require(!Runtime.DispatchSayCommand(kClientIndex, "/example", false), "The filters unexpectedly blocked global chat");
		Require(TestState.m_vecCalls == std::vector<unsigned int> { kEarlyID, kSecondEarlyID, kRegularID, kTriggerID }, "Say filters did not run in phase and registration order");
		TestState.m_vecCalls.clear();
		Require(Runtime.RemoveSayCommandFilter(LocalEarlyFilter, true), "Could not remove the early say filter");
		Require(!Runtime.DispatchSayCommand(kClientIndex, "/example", false), "The remaining filters unexpectedly blocked chat");
		Require(TestState.m_vecCalls == std::vector<unsigned int> { kSecondEarlyID, kRegularID, kTriggerID }, "An unregistered early filter still ran");
		TestState.m_vecCalls.clear();
	}

	void CheckRuntimeGetterScope() {
		constexpr char kUnchangedPluginName[] = "previous";

		v8::Isolate Isolate {};
		v8::Isolate ForeignIsolate {};
		v8::Context RootContext {};
		v8::Context PluginContext {};
		v8::Context UnknownContext {};
		v8::Object RootObject {};
		v8::Object PluginObject {};
		SourceJS::V8Runtime Runtime { &Isolate };
		Runtime.m_V8Context = v8::Local<v8::Context>(&RootContext);
		Runtime.m_SourceJSObject = v8::Local<v8::Object>(&RootObject);
		Runtime.m_mapPluginRuntimes.emplace("Example", SourceJS::PluginRuntimeRecord { v8::Local<v8::Context>(&PluginContext), v8::Local<v8::Object>(&PluginObject), {}, {}, {}, false });
		Isolate.m_Context = v8::Local<v8::Context>(&PluginContext);

		State& State = GetState();
		State.m_pExpectedIsolate = &Isolate;
		std::string strName = kUnchangedPluginName;
		Require(Runtime.GetCurrentPluginName(&Isolate, strName) && (strName == "Example"), "Plugin context did not resolve its name");
		Require(Runtime.GetSourceJSObject(&Isolate).operator->() == &PluginObject, "Plugin object did not resolve in its context");
		Require(Runtime.GetContext(&Isolate).operator->() == &RootContext, "Root context getter returned the active plugin context");

		v8::Isolate* const arrInvalidIsolates[] = { nullptr, &ForeignIsolate };
		for (auto const& pInvalidIsolate : arrInvalidIsolates) {
			const std::size_t unPreviousReads = State.m_unHandleReads;
			strName = kUnchangedPluginName;
			Require(!Runtime.GetCurrentPluginName(pInvalidIsolate, strName) && (strName == kUnchangedPluginName), "Invalid isolate changed plugin-name output");
			Require(Runtime.GetSourceJSObject(pInvalidIsolate).IsEmpty(), "Invalid isolate resolved a runtime object");
			Require(Runtime.GetContext(pInvalidIsolate).IsEmpty(), "Invalid isolate resolved a runtime context");
			Require(State.m_unHandleReads == unPreviousReads, "Invalid isolate accessed a stored V8 handle");
		}

		Isolate.m_Context = v8::Local<v8::Context>(&RootContext);
		Require(Runtime.GetCurrentPluginName(&Isolate, strName) && strName.empty(), "Root context did not commit an empty plugin name");
		Require(Runtime.GetSourceJSObject(&Isolate).operator->() == &RootObject, "Root object did not resolve");
		Isolate.m_Context = v8::Local<v8::Context>(&UnknownContext);
		strName = kUnchangedPluginName;
		Require(!Runtime.GetCurrentPluginName(&Isolate, strName) && (strName == kUnchangedPluginName), "Unknown context changed plugin-name output");
		Isolate.m_Context = {};
		Require(!Runtime.GetCurrentPluginName(&Isolate, strName) && (strName == kUnchangedPluginName), "Empty context changed plugin-name output");
		Runtime.m_SourceJSObject = {};
		Require(Runtime.GetSourceJSObject(&Isolate).IsEmpty(), "Missing runtime object was fabricated");
		Runtime.m_V8Context = {};
		Require(Runtime.GetContext(&Isolate).IsEmpty(), "Missing root context was fabricated");
		State.m_pExpectedIsolate = nullptr;
	}

	void CheckClientCommandReplacement() {
		constexpr unsigned int kConstructionExceptionCase = 0;
		constexpr unsigned int kRegistrationExceptionCase = 1;
		constexpr unsigned int kRestorationExceptionCase = 2;
		constexpr unsigned int kRegistrationRejectionCase = 3;
		constexpr unsigned int kSuccessCase = 4;
		constexpr unsigned int kCaseCount = 5;

		v8::Isolate Isolate {};
		v8::Function Function { 1 };
		v8::Local<v8::Function> const LocalFunction { &Function };
		State& State = GetState();

		for (unsigned int unFailure = 0; unFailure < kCaseCount; ++unFailure) {
			SourceJS::V8Runtime Runtime { &Isolate };
			Runtime.m_mapClientCommandCallbacks["example"].push_back({ {}, LocalFunction });
			Require(Runtime.RegisterCommand("example", LocalFunction), "Client-visible command registration failed");
			auto* const pPreviousCommand = Runtime.m_mapRegisteredCommands.at("example").m_pCommand.get();
			State.m_bThrowConstruction = unFailure == kConstructionExceptionCase;
			State.m_unRegistrationExceptions = ((unFailure == kRegistrationExceptionCase) || (unFailure == kRestorationExceptionCase)) ? unFailure : 0;
			State.m_bFailRegistration = unFailure == kRegistrationRejectionCase;
			State.m_unErrors = 0;

			try {
				const bool bRemoved = Runtime.UnregisterClientCommand("example", {}, false);
				Require(bRemoved == (unFailure == kSuccessCase), "Unexpected replacement result");
				Require(unFailure >= kRegistrationRejectionCase, "Expected replacement exception was lost");
			} catch (std::bad_alloc const&) {
				Require(unFailure < kRegistrationRejectionCase, "Unexpected replacement exception");
			}

			auto* const pCurrentCommand = Runtime.m_mapRegisteredCommands.at("example").m_pCommand.get();
			Require(pCurrentCommand && pCurrentCommand->IsRegistered(), "Replacement failure detached the command");
			Require(SourceJS::g_Application.GetEngineInterfaces().FindCommandBase("example") == pCurrentCommand, "SDK retained a stale command");
			Require(State.m_unLiveCommands == 1, "Replacement leaked or lost an owner");
			Require(Runtime.m_mapClientCommandCallbacks.empty(), "Removed client callbacks remained registered");

			if (unFailure < kSuccessCase) {
				Require(pCurrentCommand == pPreviousCommand, "Replacement failure did not restore the old owner");
				Require(pCurrentCommand->m_nFlags == SourceJS::kSourceJSClientCommandFlags, "Restoration changed the old flags");
			} else {
				Require(pCurrentCommand != pPreviousCommand, "Successful replacement reused the old owner");
				Require(pCurrentCommand->m_nFlags == SourceJS::kSourceJSOwnedCommandFlag, "Successful replacement retained client flags");
			}

			const std::size_t unExpectedErrors = ((unFailure == kRestorationExceptionCase) || (unFailure == kRegistrationRejectionCase)) ? 1 : 0;
			Require(State.m_unErrors == unExpectedErrors, "Restoration diagnostics did not match failure");
			State.m_bFailRegistration = false;
		}
	}
} // namespace Fixture

namespace Fixture {
	void CheckPluginUnloadReentry() {
		v8::Isolate Isolate {};
		v8::Context Context {};
		v8::Value Exports {};
		GetState().m_pExpectedIsolate = nullptr;

		auto AddPlugin = [&Context, &Exports](SourceJS::V8Runtime& Runtime, std::string const& strName) {
			SourceJS::PluginRuntimeRecord Record {};
			Record.m_Context = v8::Local<v8::Context>(&Context);
			Record.m_Exports = v8::Local<v8::Value>(&Exports);
			Record.m_mapPackageModuleCache.emplace("package", v8::Local<v8::Value>(&Exports));
			Record.m_mapLocalModuleCache.emplace("local", v8::Local<v8::Value>(&Exports));
			Runtime.m_mapPluginRuntimes.emplace(strName, std::move(Record));
		};

		{
			std::size_t unCallbackCount = 0;
			SourceJS::V8Runtime Runtime { &Isolate };
			AddPlugin(Runtime, "Example");
			Runtime.m_UnloadCallback = [&Runtime, &unCallbackCount](std::string const& strName) {
				++unCallbackCount;
				Require(unCallbackCount == 1, "Recursive plugin unload invoked the same export twice");
				Runtime.UnloadPlugin(strName);
			};

			const std::size_t unPreviousResources = GetState().m_unPluginResourceReleases;
			const std::size_t unPreviousContexts = GetState().m_unPluginContextRemovals;
			Runtime.UnloadPlugin("Example");
			Require(Runtime.m_mapPluginRuntimes.empty() && (unCallbackCount == 1), "Recursive plugin unload must finish once");
			Require((GetState().m_unPluginResourceReleases == (unPreviousResources + 1)) && (GetState().m_unPluginContextRemovals == (unPreviousContexts + 1)), "Recursive plugin unload must release resources and hooks once");
		}

		{
			bool bThrow = true;
			SourceJS::V8Runtime Runtime { &Isolate };
			AddPlugin(Runtime, "Example");
			Runtime.m_UnloadCallback = [&bThrow](std::string const&) {
				if (bThrow) {
					bThrow = false;
					throw std::runtime_error("Expected unload failure");
				}
			};

			bool bCaught = false;
			try {
				Runtime.UnloadPlugin("Example");
			} catch (std::runtime_error const&) {
				bCaught = true;
			}

			Require(bCaught && (Runtime.m_mapPluginRuntimes.size() == 1) && !Runtime.m_mapPluginRuntimes.at("Example").m_bUnloading, "Failed native unload must restore the retry guard");
			Runtime.UnloadPlugin("Example");
			Require(Runtime.m_mapPluginRuntimes.empty(), "Native unload retry must finish");
		}

		{
			SourceJS::V8Runtime Runtime { &Isolate };
			AddPlugin(Runtime, "Outer");
			AddPlugin(Runtime, "Inner");
			Runtime.m_UnloadCallback = [&Runtime](std::string const& strName) {
				if (strName == "Outer") {
					Runtime.UnloadPlugin("Inner");
				}
			};

			Runtime.UnloadPlugin("Outer");
			Require(Runtime.m_mapPluginRuntimes.empty() && (Runtime.m_unUnloadExportCalls == 2), "Unloading another plugin must remain supported");
		}

		{
			SourceJS::V8Runtime Runtime { &Isolate };
			AddPlugin(Runtime, "Example");
			Runtime.m_bFailUnloadExport = true;
			Runtime.UnloadPlugin("Example");
			Require(Runtime.m_mapPluginRuntimes.empty(), "Reported export failure must not skip native cleanup");
		}

		{
			SourceJS::V8Runtime Runtime { &Isolate };
			AddPlugin(Runtime, "Example");
			Runtime.m_UnloadCallback = [&Runtime](std::string const& strName) {
				Runtime.m_mapPluginRuntimes.erase(strName);
			};

			const std::size_t unPreviousResources = GetState().m_unPluginResourceReleases;
			Runtime.UnloadPlugin("Example");
			Require(Runtime.m_mapPluginRuntimes.empty() && (GetState().m_unPluginResourceReleases == unPreviousResources), "Callback invalidation must not reuse its erased registry iterator");
		}

		{
			SourceJS::V8Runtime Runtime { &Isolate };
			AddPlugin(Runtime, "Example");
			Runtime.m_UnloadCallback = [&Runtime, &AddPlugin](std::string const& strName) {
				Runtime.m_mapPluginRuntimes.erase(strName);
				AddPlugin(Runtime, strName);
			};

			const std::size_t unPreviousResources = GetState().m_unPluginResourceReleases;
			Runtime.UnloadPlugin("Example");
			Require((Runtime.m_mapPluginRuntimes.size() == 1) && !Runtime.m_mapPluginRuntimes.at("Example").m_bUnloading && (GetState().m_unPluginResourceReleases == unPreviousResources), "Callback replacement must retain the new non-unloading record");
			Runtime.m_UnloadCallback = nullptr;
			Runtime.UnloadPlugin("Example");
			Require(Runtime.m_mapPluginRuntimes.empty(), "The replacement record must remain independently unloadable");
		}
	}
} // namespace Fixture

namespace Fixture {
	// Only startup orchestration and real registry ownership are under test; V8/IO/execution are doubles.
	void CheckPluginLoadRollback() {
		constexpr unsigned int kFailureStageCount = 2;
		constexpr unsigned int kRollbackModeCount = 2;
		constexpr unsigned int kStatusCaseCount = 3;

		for (unsigned int unFailureStage = 0; unFailureStage < kFailureStageCount; ++unFailureStage) {
			for (unsigned int unRollbackMode = 0; unRollbackMode < kRollbackModeCount; ++unRollbackMode) {
				GetState() = {};
				v8::Isolate Isolate {};
				SourceJS::V8Runtime Runtime(&Isolate);
				Runtime.m_CommonJSCallback = [&Runtime, unFailureStage]() -> bool {
					Require(Runtime.m_mapPluginRuntimes.contains("Example"), "Execution must see its published runtime");

					if (unFailureStage == 0) {
						throw std::bad_alloc();
					}

					return true;
				};
				Runtime.m_LoadCallback = [&Runtime](std::string const&) -> bool {
					Require(Runtime.m_mapPluginRuntimes.contains("Example"), "Load must see its published runtime");
					throw std::bad_alloc();
				};

				if (unRollbackMode != 0) {
					Runtime.m_UnloadCallback = [](std::string const&) {
						throw std::runtime_error("Injected unload failure");
					};
				}

				bool bOriginalFailureCaught = false;
				try {
					Runtime.ExecutePluginFile("Example/index.js", "Example");
				} catch (std::bad_alloc const&) {
					bOriginalFailureCaught = true;
				}

				Require(bOriginalFailureCaught, "Plugin startup must preserve the original C++ failure");
				Require(Runtime.m_unUnloadExportCalls == 1, "Exceptional plugin startup must attempt unload exactly once");
				Require(Runtime.m_unCommonJSCalls == 1, "Exceptional startup must execute once");
				Require(Runtime.m_unLoadExportCalls == unFailureStage, "Load export must follow successful execution only");

				if (unRollbackMode == 0) {
					Require(Runtime.m_mapPluginRuntimes.empty(), "Exceptional startup must release its published runtime");
					Require(GetState().m_unErrors == 0, "Successful startup rollback must not report a cleanup failure");

				} else {
					Require((Runtime.m_mapPluginRuntimes.size() == 1) && !Runtime.m_mapPluginRuntimes.at("Example").m_bUnloading, "Failed startup rollback must retain a retryable runtime");
					Require(GetState().m_unErrors == 1, "Failed startup rollback must report its cleanup failure");
					Runtime.m_UnloadCallback = {};
					Runtime.UnloadPlugin("Example");
					Require(Runtime.m_mapPluginRuntimes.empty(), "Retained startup runtime must be independently unloadable");
				}
			}
		}

		for (unsigned int unStatusCase = 0; unStatusCase < kStatusCaseCount; ++unStatusCase) {
			GetState() = {};
			v8::Isolate Isolate {};
			SourceJS::V8Runtime Runtime(&Isolate);
			Runtime.m_CommonJSCallback = [unStatusCase]() {
				return unStatusCase != 1;
			};
			Runtime.m_LoadCallback = [unStatusCase](std::string const&) {
				return unStatusCase != 2;
			};
			const bool bLoaded = Runtime.ExecutePluginFile("Example/index.js", "Example");
			Require(bLoaded == (unStatusCase == 0), "Ordinary plugin startup result changed");
			Require(Runtime.m_unCommonJSCalls == 1, "Ordinary plugin startup must execute once");
			const std::size_t unExpectedLoadExportCalls = (unStatusCase == 1) ? 0 : 1;
			Require(Runtime.m_unLoadExportCalls == unExpectedLoadExportCalls, "Ordinary startup export order changed");

			if (bLoaded) {
				Require(Runtime.m_unUnloadExportCalls == 0, "Successful startup must not unload its runtime");
				Require(!Runtime.ExecutePluginFile("Example/index.js", "Example") && (Runtime.m_unCommonJSCalls == 1), "Duplicate startup must not execute again");
				Runtime.UnloadPlugin("Example");
			}

			Require(Runtime.m_mapPluginRuntimes.empty() && (Runtime.m_unUnloadExportCalls == 1), "Ordinary startup cleanup must occur exactly once");
		}
	}
} // namespace Fixture

int main() {
	try {
		Fixture::CheckRegistrationFailures();
		Fixture::CheckDispatchMutation();
		Fixture::CheckCallbackStorage(false);
		Fixture::CheckCallbackStorage(true);
		Fixture::CheckCommandPhaseSnapshots(false);
		Fixture::CheckCommandPhaseSnapshots(true);
		Fixture::CheckEarlySayFilters();
		Fixture::CheckRuntimeGetterScope();
		Fixture::CheckClientCommandReplacement();
		Fixture::CheckPluginUnloadReentry();
		Fixture::CheckPluginLoadRollback();
		Fixture::Require(Fixture::GetState().m_unLiveCommands == 0, "Final command owner leaked");

		std::puts("V8 command-state contracts passed");

		return 0;
	} catch (std::exception const& Exception) {
		std::fprintf(stderr, "V8 command-state contract failed: %s\n", Exception.what());
		return 1;
	}
}
