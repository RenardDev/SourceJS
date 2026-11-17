
// C++
#include <cstdarg>
#include <cstddef>
#include <cstdio>
#include <cstring>

// STL
#include <exception>
#include <memory>
#include <stdexcept>

// Engine/application doubles: only the generated plugin methods are production code.
using CreateInterfaceFn = void*(*)(char const*, int*);

struct ICvar {
};

#ifdef SOURCEJS_OLD_CONSOLE_API
using fnCommandCallback = void(*)();
#else
struct CCommand {
};

using fnCommandCallback = void(*)(CCommand const&);
#endif

struct ConCommand {
	ConCommand(char const*, fnCommandCallback, char const*, int);
	~ConCommand();
};

namespace Fixture {
	enum class FailureStage {
		None = 0,
		RegisterCVars,
		Factory,
		RegisterCommand,
		ApplicationLoad,
		UnregisterCommand,
		UnregisterCVars,
		ApplicationUnload
	};

	constexpr std::size_t kDiagnosticCapacity = 512;
	constexpr int kUnknownExceptionValue = 7;
#ifdef SOURCEJS_OLD_CONSOLE_API
	constexpr bool kUsesModuleCVars = false;
#else
	constexpr bool kUsesModuleCVars = true;
#endif
	constexpr std::size_t kCVarRegistrationCount = kUsesModuleCVars ? 1 : 0;

	// Trivial instrumentation, initialized at use without dynamic global constructors.
	struct State {
		FailureStage m_FailureStage;
		bool m_bUnknownException;
		bool m_bEarlyCVarAvailable;
		bool m_bFinalCVarAvailable;
		bool m_bReturnApplicationFailure;
		bool m_bReturnCommandFailure;
		bool m_bCVarsLive;
		bool m_bSDKLive;
		std::size_t m_unSDKConnectCalls;
		std::size_t m_unSDKDisconnectCalls;
		ConCommand* m_pRegisteredCommand;
		std::size_t m_unDestroyedRegisteredCommands;
		std::size_t m_unRegisterCVarCalls;
		std::size_t m_unUnregisterCVarCalls;
		std::size_t m_unRegisterCommandCalls;
		std::size_t m_unUnregisterCommandCalls;
		std::size_t m_unApplicationLoadCalls;
		std::size_t m_unApplicationUnloadCalls;
		std::size_t m_unFactoryCalls;
		std::size_t m_unUnavailableCVarWarnings;
		char m_szLastError[kDiagnosticCapacity];
	};

	constinit State g_State {};
	constinit ICvar g_CVar {};

	void ThrowAt(FailureStage const Stage) {
		if (g_State.m_FailureStage != Stage) {
			return;
		}

		if (g_State.m_bUnknownException) {
			throw kUnknownExceptionValue;
		}

		throw std::runtime_error("injected lifecycle failure");
	}

	void Require(const bool bCondition, char const* const pszMessage) {
		if (!bCondition) {
			throw std::runtime_error(pszMessage);
		}
	}

	void* InterfaceFactory(char const*, int*) {
		++g_State.m_unFactoryCalls;
		ThrowAt(FailureStage::Factory);

		return g_State.m_bEarlyCVarAvailable ? &g_CVar : nullptr;
	}
	void* GameServerFactory(char const*, int*) {
		++g_State.m_unFactoryCalls;
		ThrowAt(FailureStage::Factory);

		return g_State.m_bFinalCVarAvailable ? &g_CVar : nullptr;
	}
} // namespace Fixture

constinit ICvar* g_pCVar = nullptr;

ConCommand::ConCommand(char const*, fnCommandCallback, char const*, int) {
}

ConCommand::~ConCommand() {
	if (Fixture::g_State.m_pRegisteredCommand == this) {
		++Fixture::g_State.m_unDestroyedRegisteredCommands;
	}
}

#ifdef SOURCEJS_OLD_CONSOLE_API
void HandleSourceJSCommand() {
}
#else
void HandleSourceJSCommand(CCommand const&) {
}
#endif

void ConVar_Register(int) {
	Fixture::Require(g_pCVar && Fixture::g_State.m_bSDKLive, "SDK connection precedes variable registration");
	++Fixture::g_State.m_unRegisterCVarCalls;
	Fixture::g_State.m_bCVarsLive = true;
	Fixture::ThrowAt(Fixture::FailureStage::RegisterCVars);
}

void ConVar_Unregister() {
	++Fixture::g_State.m_unUnregisterCVarCalls;
	Fixture::ThrowAt(Fixture::FailureStage::UnregisterCVars);
	Fixture::g_State.m_bCVarsLive = false;
	Fixture::g_State.m_pRegisteredCommand = nullptr;
}

namespace SourceJS {
	constexpr int kSourceJSOwnedCommandFlag = 0x01;

	struct TestEngineInterfaces {
		void SetEarlyCVar(ICvar* const pCVar);
		ICvar* GetCVar() const;
		ConCommand* FindCommandBase(char const*) const;
		bool RegisterConCommand(ConCommand* const pCommand);
		void UnregisterConCommand(ConCommand* const pCommand);

		ICvar* m_pCVar;
	};

	struct TestApplication {
		bool IsLoaded() const;
		TestEngineInterfaces& GetEngineInterfaces();
		bool Load(CreateInterfaceFn, CreateInterfaceFn);
		void Unload();
		TestApplication& GetRuntime();
		bool IsInitialized() const;

		TestEngineInterfaces m_EngineInterfaces;
		bool m_bLoaded;
		bool m_bRuntimeInitialized;
	};

	constinit TestApplication g_Application {};

	void LogError(char const* const pszFormat, ...) noexcept {
		std::va_list ArgumentList;
		va_start(ArgumentList, pszFormat);
		std::vsnprintf(Fixture::g_State.m_szLastError, Fixture::kDiagnosticCapacity, pszFormat, ArgumentList);
		va_end(ArgumentList);
	}

	void LogInfo(char const*, ...) noexcept {
	}

	void LogWarning(char const*, ...) noexcept {
		++Fixture::g_State.m_unUnavailableCVarWarnings;
	}

	void TestEngineInterfaces::SetEarlyCVar(ICvar* const pCVar) {
		m_pCVar = pCVar;
	}

	ICvar* TestEngineInterfaces::GetCVar() const {
		return Fixture::g_State.m_bFinalCVarAvailable ? &Fixture::g_CVar : nullptr;
	}

	ConCommand* TestEngineInterfaces::FindCommandBase(char const*) const {
		return Fixture::g_State.m_pRegisteredCommand;
	}

	bool TestEngineInterfaces::RegisterConCommand(ConCommand* const pCommand) {
		if (Fixture::g_State.m_pRegisteredCommand == pCommand) {
			return true;
		}

		++Fixture::g_State.m_unRegisterCommandCalls;

		if (Fixture::g_State.m_bReturnCommandFailure) {
			return false;
		}

		// Model a successful SDK registration followed by throwing bookkeeping.
		Fixture::g_State.m_pRegisteredCommand = pCommand;
		Fixture::ThrowAt(Fixture::FailureStage::RegisterCommand);

		return true;
	}

	void TestEngineInterfaces::UnregisterConCommand(ConCommand* const pCommand) {
		++Fixture::g_State.m_unUnregisterCommandCalls;
		Fixture::ThrowAt(Fixture::FailureStage::UnregisterCommand);
		Fixture::Require(!Fixture::g_State.m_pRegisteredCommand || (Fixture::g_State.m_pRegisteredCommand == pCommand), "unregister owns only its command and tolerates prior module unregister");
		Fixture::g_State.m_pRegisteredCommand = nullptr;
	}

	bool TestApplication::IsLoaded() const {
		return m_bLoaded;
	}

	TestEngineInterfaces& TestApplication::GetEngineInterfaces() {
		return m_EngineInterfaces;
	}

	bool TestApplication::Load(CreateInterfaceFn, CreateInterfaceFn) {
		++Fixture::g_State.m_unApplicationLoadCalls;

		if (m_bLoaded) {
			return true;
		}

		// An acquired runtime with no final loaded flag exercises the plugin rollback call.
		m_bRuntimeInitialized = true;
		Fixture::ThrowAt(Fixture::FailureStage::ApplicationLoad);

		if (Fixture::g_State.m_bReturnApplicationFailure) {
			return false;
		}

		m_bLoaded = true;

		return true;
	}

	void TestApplication::Unload() {
		++Fixture::g_State.m_unApplicationUnloadCalls;
		Fixture::ThrowAt(Fixture::FailureStage::ApplicationUnload);

		m_bRuntimeInitialized = false;
		m_bLoaded = false;
		m_EngineInterfaces.m_pCVar = nullptr;
	}
	TestApplication& TestApplication::GetRuntime() {
		return *this;
	}

	bool TestApplication::IsInitialized() const {
		return m_bRuntimeInitialized;
	}
} // namespace SourceJS

void ConnectTier1Libraries(CreateInterfaceFn* const pFactories, const int nFactoryCount) {
	++Fixture::g_State.m_unSDKConnectCalls;
	Fixture::g_State.m_bSDKLive = true;
	Fixture::Require(pFactories && (nFactoryCount == 2), "SDK receives engine and game factories");
	g_pCVar = nullptr;
	for (int nFactoryIndex = 0; !g_pCVar && (nFactoryIndex < nFactoryCount); ++nFactoryIndex) {
		g_pCVar = static_cast<ICvar*>(pFactories[nFactoryIndex]("FixtureCVar", nullptr));
	}
}

void DisconnectTier1Libraries() {
	Fixture::Require(!SourceJS::g_Application.m_bRuntimeInitialized && !Fixture::g_State.m_bCVarsLive, "runtime and variable release precede SDK disconnect");
	++Fixture::g_State.m_unSDKDisconnectCalls;
	Fixture::g_State.m_bSDKLive = false;
	g_pCVar = nullptr;
}

class CSourceJSPlugin {
public:
	CSourceJSPlugin();

	bool Load(CreateInterfaceFn InterfaceFactory, CreateInterfaceFn GameServerFactory);
	void Unload();
	void SetCommandClient(const int nClientIndex);

	bool HasCommand() const;
	bool HasCVars() const;
	int GetCommandClientSlot() const;

private:
	bool RegisterConsoleCommands(ICvar* const pCVar);
	void UnregisterConsoleCommands();
	bool RegisterConsoleVariables(CreateInterfaceFn const InterfaceFactory, CreateInterfaceFn const GameServerFactory);
	void UnregisterConsoleVariables(const bool bUnregisterVariables = true, const bool bDisconnectLibraries = true);

private:
	std::unique_ptr<ConCommand> m_pSourceJSCommand;
	ICvar* m_pCommandCVar;
	bool m_bCVarsRegistered;
	bool m_bSDKLibrariesConnected;
	int m_nCommandClientSlot;
};

bool CSourceJSPlugin::HasCommand() const {
	return m_pSourceJSCommand && m_pCommandCVar;
}

bool CSourceJSPlugin::HasCVars() const {
	return m_bCVarsRegistered;
}

#ifndef SOURCEJS_OLD_CONSOLE_API
namespace {
	// This fixture substitutes chat registration to test the plugin lifecycle in isolation.
	void InstallSayDispatch() {
	}

	void UninstallSayDispatch() {
	}
} // namespace
#endif

void CSourceJSPlugin::SetCommandClient(const int nClientIndex) {
	m_nCommandClientSlot = nClientIndex;
}

int CSourceJSPlugin::GetCommandClientSlot() const {
	return m_nCommandClientSlot;
}

// Included-only production definitions require the preceding SDK/application doubles.
// SourceJSPluginLifecycleMethods
#ifndef CVAR_INTERFACE_VERSION
#define CVAR_INTERFACE_VERSION "FixtureCVar"
#define SOURCEJS_LIFECYCLE_FIXTURE_OWNS_CVAR_INTERFACE_VERSION
#endif
#include "SourceJSPluginLifecycleMethods.h"
#if defined(SOURCEJS_LIFECYCLE_FIXTURE_OWNS_CVAR_INTERFACE_VERSION)
#undef CVAR_INTERFACE_VERSION
#undef SOURCEJS_LIFECYCLE_FIXTURE_OWNS_CVAR_INTERFACE_VERSION
#endif

namespace Fixture {
	void Reset() {
		g_State = {};
		g_State.m_bEarlyCVarAvailable = true;
		g_State.m_bFinalCVarAvailable = true;
		SourceJS::g_Application = {};
		g_pCVar = nullptr;
	}

	bool IsReleased(CSourceJSPlugin const& Plugin) {
		return !Plugin.HasCommand() && !Plugin.HasCVars() && !g_State.m_bSDKLive && !g_pCVar && !g_State.m_bCVarsLive && !g_State.m_pRegisteredCommand && (g_State.m_unDestroyedRegisteredCommands == 0) && !SourceJS::g_Application.m_bLoaded && !SourceJS::g_Application.m_bRuntimeInitialized && !SourceJS::g_Application.m_EngineInterfaces.m_pCVar;
	}
} // namespace Fixture

int main() {
	constexpr bool kExceptionKinds[] = { false, true };
	constexpr Fixture::FailureStage kLoadFailures[] = {
		Fixture::FailureStage::RegisterCVars,
		Fixture::FailureStage::Factory,
		Fixture::FailureStage::RegisterCommand,
		Fixture::FailureStage::ApplicationLoad,
	};
	constexpr Fixture::FailureStage kUnloadFailures[] = {
		Fixture::FailureStage::UnregisterCommand,
		Fixture::FailureStage::UnregisterCVars,
		Fixture::FailureStage::ApplicationUnload,
	};

	try {
		Fixture::Reset();
		CSourceJSPlugin Plugin {};
		Fixture::Require(Plugin.GetCommandClientSlot() == -1, "actual constructor establishes client sentinel");
		Fixture::Require(!Plugin.Load(nullptr, Fixture::InterfaceFactory) && !Plugin.Load(Fixture::InterfaceFactory, nullptr) && !Plugin.Load(nullptr, nullptr), "null factories rejected");
		Fixture::Require((Fixture::g_State.m_unFactoryCalls == 0) && (Fixture::g_State.m_unRegisterCVarCalls == 0) && (Fixture::g_State.m_unApplicationLoadCalls == 0), "null factory guard precedes all acquisitions");
		Fixture::Require(Plugin.Load(Fixture::InterfaceFactory, Fixture::GameServerFactory), "initial load succeeds");
		Fixture::Require(Plugin.Load(Fixture::InterfaceFactory, Fixture::GameServerFactory), "repeated load succeeds");
		Fixture::Require(Fixture::g_State.m_unRegisterCVarCalls == Fixture::kCVarRegistrationCount, "repeated load does not register CVars twice");
		Fixture::Require(Fixture::g_State.m_unRegisterCommandCalls == 1, "repeated load does not register command twice");

		Fixture::g_State.m_FailureStage = Fixture::FailureStage::Factory;
		Fixture::Require(!Plugin.Load(Fixture::InterfaceFactory, Fixture::GameServerFactory), "failed repeat reports failure");
		Fixture::Require(Plugin.HasCommand() && (Plugin.HasCVars() == Fixture::kUsesModuleCVars) && (Fixture::g_State.m_bCVarsLive == Fixture::kUsesModuleCVars) && SourceJS::g_Application.m_bLoaded, "failed repeat preserves prior resources");
		Fixture::Require((Fixture::g_State.m_unUnregisterCommandCalls == 0) && (Fixture::g_State.m_unUnregisterCVarCalls == 0) && (Fixture::g_State.m_unApplicationUnloadCalls == 0), "failed repeat does not clean prior resources");
		Fixture::g_State.m_FailureStage = Fixture::FailureStage::None;
		Plugin.Unload();
		Plugin.Unload();
		Fixture::Require(Fixture::IsReleased(Plugin) && (Fixture::g_State.m_unUnregisterCVarCalls == Fixture::kCVarRegistrationCount), "unload is repeat-safe");

		for (auto const& Failure : kLoadFailures) {
			if constexpr (!Fixture::kUsesModuleCVars) {
				if (Failure == Fixture::FailureStage::RegisterCVars) {
					continue;
				}
			}

			for (auto const& bUnknownException : kExceptionKinds) {
				Fixture::Reset();
				Fixture::g_State.m_FailureStage = Failure;
				Fixture::g_State.m_bUnknownException = bUnknownException;
				CSourceJSPlugin FailedPlugin {};
				Fixture::Require(!FailedPlugin.Load(Fixture::InterfaceFactory, Fixture::GameServerFactory), "load exception becomes failure");
				Fixture::Require(Fixture::IsReleased(FailedPlugin), "load exception rolls back current attempt");
				Fixture::Require(std::strstr(Fixture::g_State.m_szLastError, "SourceJSPlugin.Load failed:") != nullptr, "load failure context logged");
				Fixture::g_State.m_FailureStage = Fixture::FailureStage::None;
				Fixture::Require(FailedPlugin.Load(Fixture::InterfaceFactory, Fixture::GameServerFactory), "retry reuses valid retained command storage");
				FailedPlugin.Unload();
				Fixture::Require(Fixture::IsReleased(FailedPlugin), "retry releases the reacquired SDK resources");
			}
		}

		Fixture::Reset();
		Fixture::g_State.m_bReturnApplicationFailure = true;
		CSourceJSPlugin RejectedPlugin {};
		Fixture::Require(!RejectedPlugin.Load(Fixture::InterfaceFactory, Fixture::GameServerFactory) && Fixture::IsReleased(RejectedPlugin), "false application result rolls back");

		Fixture::Reset();
		Fixture::g_State.m_bReturnCommandFailure = true;
		CSourceJSPlugin RejectedCommandPlugin {};
		Fixture::Require(!RejectedCommandPlugin.Load(Fixture::InterfaceFactory, Fixture::GameServerFactory) && Fixture::IsReleased(RejectedCommandPlugin), "false command registration releases unregistered ownership");

		Fixture::Reset();
		Fixture::g_State.m_bEarlyCVarAvailable = false;
		CSourceJSPlugin RetriedPlugin {};
		Fixture::Require(RetriedPlugin.Load(Fixture::InterfaceFactory, Fixture::GameServerFactory), "registration retried with resolved CVar");
		Fixture::Require((Fixture::g_State.m_unRegisterCommandCalls == 1) && (Fixture::g_State.m_unUnavailableCVarWarnings == 1), "exactly one late registration retry after unavailable early CVar");
		RetriedPlugin.Unload();

		Fixture::Reset();
		Fixture::g_State.m_bEarlyCVarAvailable = false;
		Fixture::g_State.m_bFinalCVarAvailable = false;
		CSourceJSPlugin NoCommandPlugin {};
		Fixture::Require(!NoCommandPlugin.Load(Fixture::InterfaceFactory, Fixture::GameServerFactory) && Fixture::IsReleased(NoCommandPlugin), "late command failure rolls back loaded application");

		for (auto const& Failure : kUnloadFailures) {
			if constexpr (!Fixture::kUsesModuleCVars) {
				if (Failure == Fixture::FailureStage::UnregisterCVars) {
					continue;
				}
			}

			for (auto const& bUnknownException : kExceptionKinds) {
				Fixture::Reset();
				CSourceJSPlugin CleanupPlugin {};
				Fixture::Require(CleanupPlugin.Load(Fixture::InterfaceFactory, Fixture::GameServerFactory), "cleanup setup");
				Fixture::g_State.m_FailureStage = Failure;
				Fixture::g_State.m_bUnknownException = bUnknownException;
				CleanupPlugin.Unload();
				const std::size_t unExpectedCVarReleases = (Failure == Fixture::FailureStage::ApplicationUnload) ? 0 : Fixture::kCVarRegistrationCount;
				Fixture::Require((Fixture::g_State.m_unUnregisterCommandCalls == 1) && (Fixture::g_State.m_unUnregisterCVarCalls == unExpectedCVarReleases) && (Fixture::g_State.m_unApplicationUnloadCalls == 1), "cleanup continues but keeps SDK resources if runtime release failed");
				Fixture::Require(std::strstr(Fixture::g_State.m_szLastError, "SourceJSPlugin.Unload") != nullptr, "cleanup failure context logged");
				Fixture::g_State.m_FailureStage = Fixture::FailureStage::None;
				CleanupPlugin.Unload();
				Fixture::Require(Fixture::IsReleased(CleanupPlugin), "failed cleanup remains retryable");
			}
		}

		std::puts("SourceJS plugin lifecycle contracts passed (extracted methods; dependency doubles).");

		return 0;
	} catch (std::exception const& Exception) {
		std::fprintf(stderr, "SourceJS plugin lifecycle contract failed: %s\n", Exception.what());
		return 1;
	}
}
