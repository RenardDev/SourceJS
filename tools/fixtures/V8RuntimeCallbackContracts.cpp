
// C++
#include <cstdio>
#include <cstdlib>

// STL
#include <initializer_list>
#include <stdexcept>
#include <string>
#include <vector>

// Template fixture, not standalone: compile through tools/smoke_plugin_manager_native_contracts.js.
// Included production barriers/routing are real; SDK, V8 and require work are doubles.
namespace Fixture {
	enum class Failure {
		None = 0,
		Standard,
		Unknown
	};

	enum class RequireOutcome {
		Success = 0,
		JavaScript,
		Standard,
		Unknown,
		JavaScriptAndStandard,
		PendingAndStandard,
		TerminatedAndStandard
	};

	struct State {
		Failure m_ArgumentFailure;
		Failure m_DispatchFailure;
		RequireOutcome m_RequireOutcome;
		int m_nClientIndex;
		int m_nLogs;
		int m_nServerCalls;
		int m_nClientCalls;
		int m_nRequireCalls;
		bool m_bEmptyArguments;
	};

	constexpr int kUnknownExceptionValue = 17;
	constexpr int kCommandArgumentCount = 2;
	constexpr char kOriginalJavaScriptErrorMessage[] = "original JS error";

	constinit State g_State {};

	void Check(const bool bCondition) {
		if (!bCondition) {
			std::fputs("Runtime callback contract failed.\n", stderr);
			std::abort();
		}
	}

	void ThrowIfRequested(const Failure FailureMode) {
		if (FailureMode == Failure::Standard) {
			throw std::runtime_error("injected native failure");
		}

		if (FailureMode == Failure::Unknown) {
			throw kUnknownExceptionValue;
		}
	}
} // namespace Fixture

// Exact external V8 spellings; this double models caught/rethrown/pending state only.
namespace v8 {
	struct Isolate {
		bool IsExecutionTerminating() const;
		bool HasPendingException() const;
		void ThrowError(char const* const pszMessage);

		bool m_bCaught;
		bool m_bPending;
		bool m_bTerminating;
		int m_nErrors;
		int m_nRethrows;
		char const* m_pszMessage;
	};

	bool Isolate::IsExecutionTerminating() const {
		return m_bTerminating;
	}

	bool Isolate::HasPendingException() const {
		return m_bPending;
	}

	void Isolate::ThrowError(char const* const pszMessage) {
		++m_nErrors;
		m_pszMessage = pszMessage;
		m_bCaught = true;
		m_bPending = true;
	}

	class TryCatch {
	public:
		explicit TryCatch(Isolate* const pIsolate);
		TryCatch(TryCatch const&) = delete;
		~TryCatch();

		TryCatch& operator=(TryCatch const&) = delete;
		bool HasCaught() const;
		void ReThrow();

	private:
		Isolate* m_pIsolate;
		bool m_bRethrown;
	};

	TryCatch::TryCatch(Isolate* const pIsolate) :
		m_pIsolate(pIsolate)
	{
		m_bRethrown = false;
	}

	TryCatch::~TryCatch() {
		if (m_pIsolate->m_bCaught && !m_bRethrown) {
			m_pIsolate->m_bPending = false;
		}
	}

	bool TryCatch::HasCaught() const {
		return m_pIsolate->m_bCaught;
	}

	void TryCatch::ReThrow() {
		m_bRethrown = true;
		++m_pIsolate->m_nRethrows;
	}

	struct Value {
	};

	template<typename TValue>
	class FunctionCallbackInfo {
	public:
		explicit FunctionCallbackInfo(Isolate* const pIsolate) :
			m_pIsolate(pIsolate)
		{
		}

		Isolate* GetIsolate() const {
			return m_pIsolate;
		}

	private:
		Isolate* m_pIsolate;
	};
} // namespace v8

class CCommand {
public:
	int ArgC() const;
	char const* Arg(const int nArgumentIndex) const;
};

int CCommand::ArgC() const {
	Fixture::ThrowIfRequested(Fixture::g_State.m_ArgumentFailure);

	return Fixture::g_State.m_bEmptyArguments ? 0 : Fixture::kCommandArgumentCount;
}

char const* CCommand::Arg(const int nArgumentIndex) const {
	Fixture::Check((nArgumentIndex == 0) || (nArgumentIndex == 1));

	return (nArgumentIndex == 0) ? "test" : "value";
}

class CSourceJSPlugin {
public:
	int GetCommandClient() const noexcept;
};

int CSourceJSPlugin::GetCommandClient() const noexcept {
	return Fixture::g_State.m_nClientIndex;
}

constinit CSourceJSPlugin g_SourceJSPlugin {};

namespace SourceJS {
	class V8Runtime {
	public:
		void DispatchClientCommand(const int nClientIndex, std::vector<std::string> const& vecArguments);
		void DispatchCommand(std::string const& strName, std::vector<std::string> const& vecArguments);
	};

	void V8Runtime::DispatchClientCommand(const int nClientIndex, std::vector<std::string> const& vecArguments) {
		Fixture::Check((nClientIndex > 0) && (vecArguments == std::vector<std::string> { "test", "value" }));
		++Fixture::g_State.m_nClientCalls;
		Fixture::ThrowIfRequested(Fixture::g_State.m_DispatchFailure);
	}

	void V8Runtime::DispatchCommand(std::string const& strName, std::vector<std::string> const& vecArguments) {
		Fixture::Check((strName == "test") && (vecArguments == std::vector<std::string> { "test", "value" }));
		++Fixture::g_State.m_nServerCalls;
		Fixture::ThrowIfRequested(Fixture::g_State.m_DispatchFailure);
	}

	class EngineInterfaces {
	public:
		std::vector<std::string> GetCurrentCommandArguments() const;
	};

	std::vector<std::string> EngineInterfaces::GetCurrentCommandArguments() const {
		Fixture::ThrowIfRequested(Fixture::g_State.m_ArgumentFailure);

		return Fixture::g_State.m_bEmptyArguments ? std::vector<std::string> {} : std::vector<std::string> { "test", "value" };
	}

	class Application {
	public:
		V8Runtime& GetRuntime();
		EngineInterfaces& GetEngineInterfaces();

	private:
		V8Runtime m_Runtime;
		EngineInterfaces m_Interfaces;
	};

	V8Runtime& Application::GetRuntime() {
		return m_Runtime;
	}

	EngineInterfaces& Application::GetEngineInterfaces() {
		return m_Interfaces;
	}

	constinit Application g_Application {};

	void LogError(char const* const, ...) noexcept {
		++Fixture::g_State.m_nLogs;
	}

	void RequirePluginModule(v8::FunctionCallbackInfo<v8::Value> const& CallbackInformation, v8::TryCatch const&) {
		auto* const pIsolate = CallbackInformation.GetIsolate();
		++Fixture::g_State.m_nRequireCalls;
		const Fixture::RequireOutcome Outcome = Fixture::g_State.m_RequireOutcome;
		if ((Outcome == Fixture::RequireOutcome::JavaScript) || (Outcome == Fixture::RequireOutcome::JavaScriptAndStandard)) {
			pIsolate->ThrowError(Fixture::kOriginalJavaScriptErrorMessage);
		}

		if (Outcome == Fixture::RequireOutcome::PendingAndStandard) {
			pIsolate->m_bPending = true;
		}

		if (Outcome == Fixture::RequireOutcome::TerminatedAndStandard) {
			pIsolate->m_bTerminating = true;
		}

		if (Outcome == Fixture::RequireOutcome::Unknown) {
			Fixture::ThrowIfRequested(Fixture::Failure::Unknown);
		}

		if ((Outcome != Fixture::RequireOutcome::Success) && (Outcome != Fixture::RequireOutcome::JavaScript)) {
			Fixture::ThrowIfRequested(Fixture::Failure::Standard);
		}
	}
} // namespace SourceJS

// Project
#include "V8RuntimeCallbackMethods.h"

namespace Fixture {
	void RunCommand() {
#ifdef SOURCEJS_OLD_CONSOLE_API
		SourceJS::DispatchSourceJSRuntimeCommand();
#else
		CCommand const Command {};
		SourceJS::DispatchSourceJSRuntimeCommand(Command);
#endif
	}

	void VerifyCommands() {
		constexpr int kClientCommandIndex = 7;

		for (auto const& nClientIndex : { 0, kClientCommandIndex }) {
			g_State = {};
			g_State.m_nClientIndex = nClientIndex;
			RunCommand();

			const bool bClientRoute = nClientIndex > 0;
			Check(g_State.m_nClientCalls == (bClientRoute ? 1 : 0));
			Check(g_State.m_nServerCalls == (bClientRoute ? 0 : 1));
			Check(g_State.m_nLogs == 0);
		}

		g_State = {};
		g_State.m_bEmptyArguments = true;
		RunCommand();
		Check((g_State.m_nServerCalls == 0) && (g_State.m_nClientCalls == 0) && (g_State.m_nLogs == 0));

		for (auto const& FailureMode : { Failure::Standard, Failure::Unknown }) {
			g_State = {};
			g_State.m_ArgumentFailure = FailureMode;
			RunCommand();
			Check((g_State.m_nLogs == 1) && (g_State.m_nServerCalls == 0) && (g_State.m_nClientCalls == 0));

			for (auto const& nClientIndex : { 0, kClientCommandIndex }) {
				g_State = {};
				g_State.m_nClientIndex = nClientIndex;
				g_State.m_DispatchFailure = FailureMode;
				RunCommand();
				Check((g_State.m_nLogs == 1) && ((g_State.m_nServerCalls + g_State.m_nClientCalls) == 1));
			}
		}
	}

	void VerifyRequire() {
		constexpr RequireOutcome kOutcomes[] = { RequireOutcome::Success, RequireOutcome::JavaScript, RequireOutcome::Standard, RequireOutcome::Unknown, RequireOutcome::JavaScriptAndStandard, RequireOutcome::PendingAndStandard, RequireOutcome::TerminatedAndStandard };

		for (auto const& Outcome : kOutcomes) {
			g_State = {};
			g_State.m_RequireOutcome = Outcome;
			v8::Isolate Isolate {};
			v8::FunctionCallbackInfo<v8::Value> const CallbackInformation(&Isolate);
			SourceJS::RequirePluginModuleCallback(CallbackInformation);
			Check(g_State.m_nRequireCalls == 1);
			const bool bSuccess = Outcome == RequireOutcome::Success;
			const bool bJavaScriptOnly = Outcome == RequireOutcome::JavaScript;
			const bool bPendingOnly = Outcome == RequireOutcome::PendingAndStandard;
			const bool bTerminated = Outcome == RequireOutcome::TerminatedAndStandard;
			Check(g_State.m_nLogs == ((bSuccess || bJavaScriptOnly) ? 0 : 1));
			Check(Isolate.m_nErrors == ((bSuccess || bPendingOnly || bTerminated) ? 0 : 1));
			Check(Isolate.m_nRethrows == ((bSuccess || bPendingOnly || bTerminated) ? 0 : 1));
			Check(Isolate.m_bPending == (!bSuccess && !bTerminated));
			Check(Isolate.m_bTerminating == bTerminated);

			if (bJavaScriptOnly || (Outcome == RequireOutcome::JavaScriptAndStandard)) {
				Check(Isolate.m_pszMessage && (std::string(Isolate.m_pszMessage) == kOriginalJavaScriptErrorMessage));
			}
		}
	}
} // namespace Fixture

int main() {
	Fixture::VerifyCommands();
	Fixture::VerifyRequire();

	std::puts("V8 runtime callback contracts passed (V8/SDK doubles; no live engine).");

	return 0;
}
