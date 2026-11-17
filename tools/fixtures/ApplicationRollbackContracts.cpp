
// C++
#include <cstddef>
#include <cstdio>

// STL
#include <exception>
#include <map>
#include <stdexcept>
#include <string>
#include <vector>

namespace Fixture {

	struct State {
		std::size_t m_unInformationCalls;
		std::size_t m_unErrorCalls;
		std::size_t m_unClearInputCalls;
		std::size_t m_unConVarClearCalls;
		std::size_t m_unConVarClearsWithInterfaces;
		bool m_bConVarCleanupBeforeRuntimeShutdown;
		std::size_t m_unCommandUnregisterCalls;
		bool m_bCommandUnregisterInvalidState;
		bool m_bRetainMemoryHooks;
	};

	constinit State g_State {};

	void Require(const bool bCondition, char const* const pszMessage) {
		if (!bCondition) {
			throw std::runtime_error(pszMessage);
		}
	}
} // namespace Fixture

// Only Unload/Disconnect are extracted production definitions. Native interfaces and
// subsystem operations are doubles, not SDK/V8 implementations or binary layouts.
namespace SourceJS {

	struct TestSubsystem {
		void Shutdown();
		bool IsInitialized() const noexcept;

		bool m_bInitialized;
		std::size_t m_unShutdownCalls;
	};

	struct TestMemoryHooks {
		void Shutdown();
		bool IsInitialized() const noexcept;

		bool m_bInitialized;
		std::size_t m_unShutdownCalls;
	};

	struct EngineInterfaces {
		void Disconnect() noexcept;
		void UnregisterConCommand(void* const pCommand) noexcept;

		void* m_pGlobalVariables;
		void* m_pCVar;
		void* m_pPlayerInformationManager;
		void* m_pPhysics;
		void* m_pVoiceServer;
		void* m_pServerPluginHelpers;
		void* m_pFileSystem;
		void* m_pModelCache;
		void* m_pServerTools;
		void* m_pServerGameDLL;
		void* m_pNetworkStringTableContainer;
		void* m_pEngineTrace;
		void* m_pEngineSound;
		void* m_pGameEventManager;
		void* m_pEngine;
		std::vector<std::string> m_vecInterfaceNames;
		std::map<std::string, void*> m_mapInterfaces;
		std::vector<void*> m_vecRegisteredCommands;
		bool m_bConnected;
	};

	// At-use value-initialized aggregate state, including all scalar/pointer fields.
	struct Application {
		void Unload();
		void SetServerOutputHookEnabled(const bool bEnabled);

		EngineInterfaces m_EngineInterfaces;
		TestSubsystem m_CommandDispatcher;
		TestSubsystem m_PluginManager;
		TestSubsystem m_ExtensionManager;
		TestMemoryHooks m_MemoryHookManager;
		TestSubsystem m_HookManager;
		TestSubsystem m_Runtime;
		bool m_bLoaded;
		bool m_bPaused;
		bool m_bLevelInitialized;
		bool m_bServerOutputHooked;
	};

	constinit Application* g_pExpectedConVarCleanupApplication = nullptr;

	// The extracted disconnect calls this controlled boundary; actual SDK methods are tested separately.
	void EngineInterfaces::UnregisterConCommand(void* const pCommand) noexcept {
		++Fixture::g_State.m_unCommandUnregisterCalls;
		if (m_vecRegisteredCommands.empty()) {
			Fixture::g_State.m_bCommandUnregisterInvalidState = true;
			return;
		}

		if (!m_pCVar || (m_vecRegisteredCommands.back() != pCommand)) {
			Fixture::g_State.m_bCommandUnregisterInvalidState = true;
		}

		// Always make progress in a failing fixture instead of hiding an invalid call in a hang.
		m_vecRegisteredCommands.pop_back();
	}

	void LogInfo(char const*, ...) noexcept {
		++Fixture::g_State.m_unInformationCalls;
	}

	void LogError(char const*, ...) noexcept {
		++Fixture::g_State.m_unErrorCalls;
	}

	void ClearDelayedEntityInputs() {
		++Fixture::g_State.m_unClearInputCalls;
	}

	void SetSendPropertyGameThread(const bool) noexcept {
	}

	void ClearCreatedConVarRegistrations() noexcept {
		++Fixture::g_State.m_unConVarClearCalls;
		if (g_pExpectedConVarCleanupApplication) {
			if (g_pExpectedConVarCleanupApplication->m_Runtime.IsInitialized()) {
				Fixture::g_State.m_bConVarCleanupBeforeRuntimeShutdown = true;
			}

			if (g_pExpectedConVarCleanupApplication->m_EngineInterfaces.m_pCVar) {
				++Fixture::g_State.m_unConVarClearsWithInterfaces;
			}
		}
	}

	void TestSubsystem::Shutdown() {
		++m_unShutdownCalls;
		m_bInitialized = false;
	}

	bool TestSubsystem::IsInitialized() const noexcept {
		return m_bInitialized;
	}

	void TestMemoryHooks::Shutdown() {
		++m_unShutdownCalls;
		if (!Fixture::g_State.m_bRetainMemoryHooks) {
			m_bInitialized = false;
		}
	}

	bool TestMemoryHooks::IsInitialized() const noexcept {
		return m_bInitialized;
	}

	void Application::SetServerOutputHookEnabled(const bool bEnabled) {
		m_bServerOutputHooked = bEnabled;
	}
} // namespace SourceJS

// Generated included-only production methods require the preceding subsystem doubles.
#include "ApplicationRollbackMethods.h"

namespace Fixture {

	void SeedInterfaces(SourceJS::EngineInterfaces& Interfaces, void* const pMarker) {
		Interfaces.m_pGlobalVariables = pMarker;
		Interfaces.m_pCVar = pMarker;
		Interfaces.m_pPlayerInformationManager = pMarker;
		Interfaces.m_pPhysics = pMarker;
		Interfaces.m_pVoiceServer = pMarker;
		Interfaces.m_pServerPluginHelpers = pMarker;
		Interfaces.m_pFileSystem = pMarker;
		Interfaces.m_pModelCache = pMarker;
		Interfaces.m_pServerTools = pMarker;
		Interfaces.m_pServerGameDLL = pMarker;
		Interfaces.m_pNetworkStringTableContainer = pMarker;
		Interfaces.m_pEngineTrace = pMarker;
		Interfaces.m_pEngineSound = pMarker;
		Interfaces.m_pGameEventManager = pMarker;
		Interfaces.m_pEngine = pMarker;
		Interfaces.m_vecInterfaceNames.push_back("FixtureInterface");
		Interfaces.m_mapInterfaces.emplace("FixtureInterface", pMarker);
		Interfaces.m_vecRegisteredCommands.push_back(pMarker);
	}

	bool InterfacesAreEmpty(SourceJS::EngineInterfaces const& Interfaces) {
		return !Interfaces.m_pGlobalVariables && !Interfaces.m_pCVar && !Interfaces.m_pPlayerInformationManager && !Interfaces.m_pPhysics && !Interfaces.m_pVoiceServer && !Interfaces.m_pServerPluginHelpers && !Interfaces.m_pFileSystem && !Interfaces.m_pModelCache && !Interfaces.m_pServerTools && !Interfaces.m_pServerGameDLL && !Interfaces.m_pNetworkStringTableContainer && !Interfaces.m_pEngineTrace && !Interfaces.m_pEngineSound && !Interfaces.m_pGameEventManager && !Interfaces.m_pEngine && Interfaces.m_vecInterfaceNames.empty() && Interfaces.m_mapInterfaces.empty() && Interfaces.m_vecRegisteredCommands.empty() && !Interfaces.m_bConnected;
	}

	bool ApplicationIsEmpty(SourceJS::Application const& Application) {
		return InterfacesAreEmpty(Application.m_EngineInterfaces) && !Application.m_bLoaded && !Application.m_bPaused && !Application.m_bLevelInitialized && !Application.m_bServerOutputHooked && !Application.m_CommandDispatcher.IsInitialized() && !Application.m_PluginManager.IsInitialized() && !Application.m_ExtensionManager.IsInitialized() && !Application.m_MemoryHookManager.IsInitialized() && !Application.m_HookManager.IsInitialized() && !Application.m_Runtime.IsInitialized();
	}
} // namespace Fixture

int main() {
	try {
		int nMarker = 0;
		SourceJS::EngineInterfaces Interfaces {};
		Fixture::SeedInterfaces(Interfaces, &nMarker);
		Interfaces.Disconnect();
		Fixture::Require(Fixture::InterfacesAreEmpty(Interfaces), "partial connection clears all borrowed interfaces and inventories");
		Fixture::Require((Fixture::g_State.m_unCommandUnregisterCalls == 1) && !Fixture::g_State.m_bCommandUnregisterInvalidState, "Disconnect releases tracked commands while the interface is still available");
		Fixture::Require(Fixture::g_State.m_unInformationCalls == 0, "partial connection does not report a completed connection");
		Interfaces.Disconnect();
		Fixture::Require(Fixture::InterfacesAreEmpty(Interfaces), "partial disconnect is repeat-safe");
		Fixture::Require(Fixture::g_State.m_unCommandUnregisterCalls == 1, "Repeated disconnect does not repeat native command unregister");

		Fixture::SeedInterfaces(Interfaces, &nMarker);
		Interfaces.m_bConnected = true;
		Interfaces.Disconnect();
		Fixture::Require(Fixture::InterfacesAreEmpty(Interfaces) && (Fixture::g_State.m_unInformationCalls == 1), "completed connection disconnects and logs once");
		Interfaces.Disconnect();
		Fixture::Require(Fixture::g_State.m_unInformationCalls == 1, "empty repeated disconnect is silent");

		Fixture::g_State = {};
		SourceJS::Application EarlyFailure {};
		Fixture::SeedInterfaces(EarlyFailure.m_EngineInterfaces, &nMarker);
		EarlyFailure.m_bPaused = true;
		EarlyFailure.m_bLevelInitialized = true;
		SourceJS::g_pExpectedConVarCleanupApplication = &EarlyFailure;
		EarlyFailure.Unload();
		Fixture::Require(Fixture::ApplicationIsEmpty(EarlyFailure), "pre-runtime failure disconnects partial interfaces and resets flags");
		Fixture::Require((Fixture::g_State.m_unConVarClearCalls == 1) && (Fixture::g_State.m_unConVarClearsWithInterfaces == 1) && !Fixture::g_State.m_bConVarCleanupBeforeRuntimeShutdown, "pre-runtime failure clears ConVar registrations before disconnect");
		Fixture::Require((Fixture::g_State.m_unCommandUnregisterCalls == 1) && !Fixture::g_State.m_bCommandUnregisterInvalidState, "Pre-runtime failure also releases the tracked core command registration");
		Fixture::Require((EarlyFailure.m_Runtime.m_unShutdownCalls == 0) && (EarlyFailure.m_PluginManager.m_unShutdownCalls == 0) && (Fixture::g_State.m_unClearInputCalls == 1), "pre-runtime failure only clears delayed inputs and partial interfaces");

		Fixture::g_State = {};
		SourceJS::Application PartialLoad {};
		Fixture::SeedInterfaces(PartialLoad.m_EngineInterfaces, &nMarker);
		PartialLoad.m_EngineInterfaces.m_bConnected = true;
		PartialLoad.m_Runtime.m_bInitialized = true;
		PartialLoad.m_CommandDispatcher.m_bInitialized = true;
		PartialLoad.m_PluginManager.m_bInitialized = true;
		PartialLoad.m_ExtensionManager.m_bInitialized = true;
		PartialLoad.m_MemoryHookManager.m_bInitialized = true;
		PartialLoad.m_HookManager.m_bInitialized = true;
		PartialLoad.m_bPaused = true;
		PartialLoad.m_bLevelInitialized = true;
		PartialLoad.m_bServerOutputHooked = true;
		SourceJS::g_pExpectedConVarCleanupApplication = &PartialLoad;
		PartialLoad.Unload();
		Fixture::Require(Fixture::ApplicationIsEmpty(PartialLoad) && (Fixture::g_State.m_unClearInputCalls == 2), "runtime acquired before loaded flag is released");
		Fixture::Require((Fixture::g_State.m_unConVarClearCalls == 1) && (Fixture::g_State.m_unConVarClearsWithInterfaces == 1) && !Fixture::g_State.m_bConVarCleanupBeforeRuntimeShutdown, "ConVar registration cleanup follows runtime shutdown and precedes interface disconnect");
		Fixture::Require((PartialLoad.m_CommandDispatcher.m_unShutdownCalls == 1) && (PartialLoad.m_PluginManager.m_unShutdownCalls == 1) && (PartialLoad.m_ExtensionManager.m_unShutdownCalls == 1) && (PartialLoad.m_MemoryHookManager.m_unShutdownCalls == 1) && (PartialLoad.m_HookManager.m_unShutdownCalls == 1) && (PartialLoad.m_Runtime.m_unShutdownCalls == 1), "partial runtime shutdown visits every subsystem once");
		PartialLoad.Unload();
		Fixture::Require(Fixture::ApplicationIsEmpty(PartialLoad) && (PartialLoad.m_Runtime.m_unShutdownCalls == 1) && (Fixture::g_State.m_unClearInputCalls == 3), "partial application unload is repeat-safe");
		Fixture::Require((Fixture::g_State.m_unConVarClearCalls == 2) && (Fixture::g_State.m_unConVarClearsWithInterfaces == 1), "repeated ConVar cleanup tolerates already disconnected interfaces");

		Fixture::g_State = {};
		Fixture::g_State.m_bRetainMemoryHooks = true;
		SourceJS::Application RetainedRuntime {};
		Fixture::SeedInterfaces(RetainedRuntime.m_EngineInterfaces, &nMarker);
		RetainedRuntime.m_EngineInterfaces.m_bConnected = true;
		RetainedRuntime.m_bLoaded = true;
		RetainedRuntime.m_Runtime.m_bInitialized = true;
		RetainedRuntime.m_MemoryHookManager.m_bInitialized = true;
		SourceJS::g_pExpectedConVarCleanupApplication = &RetainedRuntime;
		RetainedRuntime.Unload();
		Fixture::Require(RetainedRuntime.m_bLoaded && RetainedRuntime.m_Runtime.IsInitialized() && RetainedRuntime.m_EngineInterfaces.m_bConnected, "failed hook removal preserves live runtime and interfaces");
		Fixture::Require(Fixture::g_State.m_unConVarClearCalls == 0, "retained runtime also retains native ConVar registrations");
		Fixture::Require(Fixture::g_State.m_unCommandUnregisterCalls == 0, "Retained runtime does not disconnect native command registrations");
		Fixture::Require((RetainedRuntime.m_HookManager.m_unShutdownCalls == 0) && (RetainedRuntime.m_Runtime.m_unShutdownCalls == 0) && (Fixture::g_State.m_unErrorCalls == 1), "retention gate prevents unsafe downstream teardown");
		Fixture::g_State.m_bRetainMemoryHooks = false;
		RetainedRuntime.Unload();
		Fixture::Require(Fixture::ApplicationIsEmpty(RetainedRuntime), "retained runtime can finish cleanup after hook removal succeeds");
		Fixture::Require((Fixture::g_State.m_unConVarClearCalls == 1) && (Fixture::g_State.m_unConVarClearsWithInterfaces == 1) && !Fixture::g_State.m_bConVarCleanupBeforeRuntimeShutdown, "release ConVar registrations only after retained runtime shutdown completes");
		std::puts("Application rollback contracts passed (extracted Unload/Disconnect; subsystem doubles).");

		return 0;
	} catch (std::exception const& Exception) {
		std::fprintf(stderr, "Application rollback contract failed: %s\n", Exception.what());
		return 1;
	}
}
