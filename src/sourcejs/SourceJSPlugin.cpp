#include "sourcejs/SourceJSPlugin.h"

// General
#include "eiface.h"
#include "icvar.h"
#if defined(ENGINE_BRANCH_CSGO) || defined(ENGINE_BRANCH_BLADE)
#include "interfaces/interfaces.h"
#endif
#include "tier1/convar.h"
#if __has_include("tier1/interface.h")
#include "tier1/interface.h"
#elif __has_include("tier0/interface.h")
#include "tier0/interface.h"
#else
#error "The selected Source SDK does not provide an interface header."
#endif

#if !defined(ENGINE_BRANCH_CSGO) && !defined(ENGINE_BRANCH_BLADE)
#include "tier1/tier1.h"
#endif

// C++
#include <cstddef>
#include <cstring>
#include <utility>

// STL
#include <array>
#include <exception>
#include <limits>
#include <string>
#include <vector>

// Project
#include "sourcejs/Application.h"
#include "sourcejs/Log.h"
#ifndef SOURCEJS_OLD_CONSOLE_API
#include "sourcejs/modules/ModuleBindings.h"
#endif

// memdbgon must be the last include file in a .cpp file.
#include "tier0/memdbgon.h"

// ----------------------------------------------------------------
// VSP export
// ----------------------------------------------------------------

// The SDK export requires this static singleton; its constructor only establishes local defaults.
CSourceJSPlugin g_SourceJSPlugin;
EXPOSE_SINGLE_INTERFACE_GLOBALVAR(CSourceJSPlugin, IServerPluginCallbacks, INTERFACEVERSION_ISERVERPLUGINCALLBACKS, g_SourceJSPlugin);

// ----------------------------------------------------------------
// Command helpers
// ----------------------------------------------------------------

namespace {

	constexpr char const* kSayCommandNames[] = { "say", "say_team", "say_squad" };
	constexpr std::size_t kSayCommandCount = sizeof(kSayCommandNames) / sizeof(kSayCommandNames[0]);
	constexpr std::size_t kGlobalSayCommandIndex = 0;
	constexpr int kNoCommandClientSlot = -1;
#ifndef SOURCEJS_OLD_CONSOLE_API
	constexpr std::size_t kSquadSayCommandIndex = 2;
#endif

	// Engine callbacks cannot propagate C++ failures into the SDK caller.
	template <typename TCallback>
	bool InvokeEngineCallback(char const* const pszOperation, TCallback const& Callback) noexcept {
		try {
			Callback();

			return true;
		} catch (std::exception const& Exception) {
			SourceJS::LogError("%s failed: C++ exception: %s", pszOperation, Exception.what());
		} catch (...) {
			SourceJS::LogError("%s failed: unknown C++ exception.", pszOperation);
		}

		return false;
	}

#ifdef SOURCEJS_OLD_CONSOLE_API
	std::vector<std::string> BuildCommandArguments() {
		return SourceJS::g_Application.GetEngineInterfaces().GetCurrentCommandArguments();
	}
#else
	std::vector<std::string> BuildCommandArguments(CCommand const& Command) {
		std::vector<std::string> vecArguments {};
		for (int nArgumentIndex = 0; nArgumentIndex < Command.ArgC(); ++nArgumentIndex) {
			char const* const pszArgument = Command.Arg(nArgumentIndex);
			vecArguments.push_back(pszArgument ? pszArgument : "");
		}

		return vecArguments;
	}
#endif

	std::string JoinCommandArguments(std::vector<std::string> const& vecArguments, const std::size_t unStart) {
		std::string strResult {};
		for (std::size_t unArgumentIndex = unStart; unArgumentIndex < vecArguments.size(); ++unArgumentIndex) {
			if (unArgumentIndex > unStart) {
				strResult += " ";
			}

			strResult += vecArguments[unArgumentIndex];
		}

		return strResult;
	}

	void DispatchSourceJSCommand(std::vector<std::string> const& vecArguments) {
		const int nClientIndex = g_SourceJSPlugin.GetCommandClient();
		if (nClientIndex > 0) {
			SourceJS::g_Application.GetCommandDispatcher().DispatchClient(nClientIndex, vecArguments);
			return;
		}

		SourceJS::g_Application.GetCommandDispatcher().Dispatch(vecArguments);
	}

#ifdef SOURCEJS_OLD_CONSOLE_API
	void HandleSourceJSCommand() {
		InvokeEngineCallback("SourceJSPlugin.HandleSourceJSCommand", []() {
			DispatchSourceJSCommand(BuildCommandArguments());
		});
	}
#else
	void HandleSourceJSCommand(CCommand const& Command) {
		InvokeEngineCallback("SourceJSPlugin.HandleSourceJSCommand", [&Command]() {
			DispatchSourceJSCommand(BuildCommandArguments(Command));
		});
	}
#endif

	int GetEntityIndex(edict_t* const pEntity) {
		if (!pEntity) {
			return 0;
		}

		SourceJS::EngineInterfaces& ApplicationEngineInterfaces = SourceJS::g_Application.GetEngineInterfaces();
		const int nEntityIndex = ApplicationEngineInterfaces.GetEdictIndex(pEntity);

		return (nEntityIndex >= 0) ? nEntityIndex : 0;
	}

	std::size_t FindSayCommandIndex(std::string const& strCommandName) {
		for (std::size_t unIndex = 0; unIndex < kSayCommandCount; ++unIndex) {
			if (strCommandName == kSayCommandNames[unIndex]) {
				return unIndex;
			}
		}

		return kSayCommandCount;
	}

#ifndef SOURCEJS_OLD_CONSOLE_API
	// Some engines dispatch game-DLL commands without calling VSP ClientCommand.
	// Use the SDK's Dispatch slot for stock chat commands and pass other commands through.
	struct SayDispatchRecord {
		Detours::Hook::VTableFunctionHook m_Hook;
		void** m_ppVTable;
		ConCommand* m_pCommand;
	};

	SayDispatchRecord* GetSayDispatchRecords() {
		static SayDispatchRecord s_arrRecords[kSayCommandCount] {};

		return s_arrRecords;
	}

#if defined(_MSC_VER) && defined(_M_IX86)
	using fnOriginalSayDispatch = void(__thiscall*)(ConCommand*, CCommand const&);

	template <std::size_t unSlot>
	void __fastcall DispatchSayCommand(ConCommand* const pCommand, void*, CCommand const& Command) {
#else
	using fnOriginalSayDispatch = void(*)(ConCommand*, CCommand const&);

	template <std::size_t unSlot>
	void DispatchSayCommand(ConCommand* const pCommand, CCommand const& Command) {
#endif
		auto const* const pRecords = GetSayDispatchRecords();
		const fnOriginalSayDispatch OriginalDispatch = reinterpret_cast<fnOriginalSayDispatch>(pRecords[unSlot].m_Hook.GetOriginal());
		const int nClientIndex = g_SourceJSPlugin.GetCommandClient();
		std::size_t unCommandIndex = 0;

		while ((unCommandIndex < kSayCommandCount) && (pCommand != pRecords[unCommandIndex].m_pCommand)) {
			++unCommandIndex;
		}

		if ((nClientIndex > 0) && (unCommandIndex < kSayCommandCount) && (Command.ArgC() >= 2)) {
			const bool bTeamOnly = unCommandIndex != kGlobalSayCommandIndex;
			bool bBlocked = false;
			InvokeEngineCallback("SourceJSPlugin.DispatchSayCommand", [&Command, nClientIndex, bTeamOnly, &bBlocked]() {
				bBlocked = SourceJS::g_Application.GetRuntime().DispatchSayCommand(nClientIndex, Command.ArgS(), bTeamOnly);
			});

			if (bBlocked) {
				return;
			}
		}

		OriginalDispatch(pCommand, Command);
	}

	// Derive the callback type from the platform-specific hook, including its calling convention.
	using fnSayDispatch = decltype(&DispatchSayCommand<kGlobalSayCommandIndex>);

	template <std::size_t... unSlots>
	std::array<fnSayDispatch, sizeof...(unSlots)> GetSayDispatchCallbacks(std::index_sequence<unSlots...>) {
		return { &DispatchSayCommand<unSlots>... };
	}

	void UninstallSayDispatch() {
		auto* const pRecords = GetSayDispatchRecords();
		for (std::size_t unSlot = kSayCommandCount; unSlot > 0; --unSlot) {
			SayDispatchRecord& Record = pRecords[unSlot - 1];
			Record.m_pCommand = nullptr;

			if (Record.m_ppVTable && !Record.m_Hook.Release()) {
				SourceJS::LogError("SourceJSPlugin.UninstallSayDispatch failed Command=\"%s\"", kSayCommandNames[unSlot - 1]);
				continue;
			}

			Record.m_ppVTable = nullptr;
		}
	}

	void InstallSayDispatch() {
		const int nDispatchIndex = SourceJS::ResolveConCommandDispatchIndex();
		if (nDispatchIndex < 0) {
			SourceJS::LogWarning("SourceJSPlugin.InstallSayDispatch failed: ConCommand::Dispatch slot is unavailable.");
			return;
		}

		auto* const pRecords = GetSayDispatchRecords();
		std::array<fnSayDispatch, kSayCommandCount> const arrCallbacks = GetSayDispatchCallbacks(std::make_index_sequence<kSayCommandCount> {});

		for (std::size_t unSlot = 0; unSlot < kSayCommandCount; ++unSlot) {
			SayDispatchRecord& Record = pRecords[unSlot];
			if (Record.m_pCommand) {
				continue;
			}

			if (Record.m_ppVTable && !Record.m_Hook.Release()) {
				continue;
			}

			Record.m_ppVTable = nullptr;

			auto* const pBase = SourceJS::g_Application.GetEngineInterfaces().FindCommandBase(kSayCommandNames[unSlot]);
			if (!pBase && (unSlot == kSquadSayCommandIndex)) {
				continue;
			}

			if (!pBase || !pBase->IsCommand() || !pBase->IsFlagSet(FCVAR_GAMEDLL)) {
				SourceJS::LogWarning("SourceJSPlugin.InstallSayDispatch skipped Command=\"%s\"", kSayCommandNames[unSlot]);
				continue;
			}

			auto* const pCommand = static_cast<ConCommand*>(pBase);
			void** ppVTable = nullptr;
			std::memcpy(&ppVTable, pCommand, sizeof(ppVTable));
			if (!ppVTable) {
				continue;
			}

			std::size_t unOwnerSlot = 0;
			while ((unOwnerSlot < kSayCommandCount) && (ppVTable != pRecords[unOwnerSlot].m_ppVTable)) {
				++unOwnerSlot;
			}

			if (unOwnerSlot < kSayCommandCount) {
				if (pRecords[unOwnerSlot].m_pCommand) {
					Record.m_pCommand = pCommand;
				}

				continue;
			}

			void* const pDispatch = reinterpret_cast<void*>(arrCallbacks[unSlot]);
			if (!Record.m_Hook.Set(ppVTable, static_cast<std::size_t>(nDispatchIndex))) {
				SourceJS::LogWarning("SourceJSPlugin.InstallSayDispatch failed Command=\"%s\"", kSayCommandNames[unSlot]);
				continue;
			}

			Record.m_ppVTable = ppVTable;
			if (!Record.m_Hook.Hook(pDispatch)) {
				SourceJS::LogWarning("SourceJSPlugin.InstallSayDispatch failed Command=\"%s\"", kSayCommandNames[unSlot]);

				if (Record.m_Hook.Release()) {
					Record.m_ppVTable = nullptr;
				}

				continue;
			}

			Record.m_pCommand = pCommand;
			SourceJS::LogInfo("SourceJSPlugin.InstallSayDispatch hooked Command=\"%s\"", kSayCommandNames[unSlot]);
		}
	}
#endif

	PLUGIN_RESULT HandleClientCommand(edict_t* const pEntity, std::vector<std::string> const& vecArguments) {
		if (vecArguments.empty()) {
			return PLUGIN_CONTINUE;
		}

		std::string const& strCommandName = vecArguments[0];
		const int nEntityIndex = GetEntityIndex(pEntity);
		if (nEntityIndex <= 0) {
			return PLUGIN_CONTINUE;
		}

		if (strCommandName == "sjs") {
			SourceJS::g_Application.GetCommandDispatcher().DispatchClient(nEntityIndex, vecArguments);
			return PLUGIN_STOP;
		}

		if (SourceJS::g_Application.GetRuntime().DispatchClientCommand(nEntityIndex, vecArguments)) {
			return PLUGIN_STOP;
		}

		if (SourceJS::g_Application.GetRuntime().OwnsRegisteredCommand(strCommandName)) {
			// The client path already ran, even if no callback requested a block.
			return PLUGIN_STOP;
		}

		const std::size_t unSayCommandIndex = FindSayCommandIndex(strCommandName);
		if (unSayCommandIndex < kSayCommandCount) {
			const bool bTeamOnly = unSayCommandIndex != kGlobalSayCommandIndex;
#ifndef SOURCEJS_OLD_CONSOLE_API
			// The stock command hook is authoritative for the native dispatch path.
			auto const* const pRecords = GetSayDispatchRecords();
			if (pRecords[unSayCommandIndex].m_pCommand) {
				return PLUGIN_CONTINUE;
			}
#endif
			std::string const strText = JoinCommandArguments(vecArguments, 1);
			if (SourceJS::g_Application.GetRuntime().DispatchSayCommand(nEntityIndex, strText, bTeamOnly)) {
				return PLUGIN_STOP;
			}
		}

		return PLUGIN_CONTINUE;
	}
} // namespace

// ----------------------------------------------------------------
// CSourceJSPlugin
// ----------------------------------------------------------------

CSourceJSPlugin::CSourceJSPlugin() {
	m_pCommandCVar = nullptr;
	m_bCVarsRegistered = false;
	m_bSDKLibrariesConnected = false;
	m_nCommandClientSlot = kNoCommandClientSlot;
}

bool CSourceJSPlugin::RegisterConsoleVariables(CreateInterfaceFn const InterfaceFactory, CreateInterfaceFn const GameServerFactory) {
	constexpr int kInterfaceFactoryCount = 2;

	if (!m_bSDKLibrariesConnected) {
		CreateInterfaceFn arrInterfaceFactories[] = { InterfaceFactory, GameServerFactory };
		// Connection may throw after initializing only part of the SDK globals.
		m_bSDKLibrariesConnected = true;
#if defined(ENGINE_BRANCH_CSGO) || defined(ENGINE_BRANCH_BLADE)
		ConnectInterfaces(arrInterfaceFactories, kInterfaceFactoryCount);
#else
		ConnectTier1Libraries(arrInterfaceFactories, kInterfaceFactoryCount);
#endif
	}

	if (!g_pCVar) {
		SourceJS::LogError("SourceJSPlugin.RegisterConsoleVariables failed: SDK ICvar is unavailable.");
		return false;
	}

#ifndef SOURCEJS_OLD_CONSOLE_API
	if (!m_bCVarsRegistered) {
		// Registration may throw after partially registering this module's variables.
		m_bCVarsRegistered = true;
		ConVar_Register(0);
	}
#endif

	return true;
}

void CSourceJSPlugin::UnregisterConsoleVariables(const bool bUnregisterVariables, const bool bDisconnectLibraries) {
	const bool bReleaseVariables = bUnregisterVariables && m_bCVarsRegistered;
	const bool bReleaseLibraries = bDisconnectLibraries && m_bSDKLibrariesConnected;
	if (!bReleaseVariables && !bReleaseLibraries) {
		return;
	}

	if (SourceJS::g_Application.GetRuntime().IsInitialized()) {
		SourceJS::LogWarning("SourceJSPlugin.UnregisterConsoleVariables deferred: runtime remains initialized; SDK interfaces retained.");
		return;
	}

#ifndef SOURCEJS_OLD_CONSOLE_API
	if (bReleaseVariables) {
		ConVar_Unregister();
		m_bCVarsRegistered = false;
	}
#endif

	if (bReleaseLibraries) {
#if defined(ENGINE_BRANCH_CSGO) || defined(ENGINE_BRANCH_BLADE)
		DisconnectInterfaces();
#else
		DisconnectTier1Libraries();
#endif
		m_bSDKLibrariesConnected = false;
	}
}

bool CSourceJSPlugin::Load(CreateInterfaceFn InterfaceFactory, CreateInterfaceFn GameServerFactory) {
	if (!InterfaceFactory || !GameServerFactory) {
		SourceJS::LogError("SourceJSPlugin.Load failed: interface factories are required.");
		return false;
	}

	const bool bApplicationWasLoaded = SourceJS::g_Application.IsLoaded();
	const bool bCommandWasRegistered = (m_pSourceJSCommand != nullptr) && (m_pCommandCVar != nullptr);
	const bool bSDKLibrariesWereConnected = m_bSDKLibrariesConnected;
	const bool bCVarsWereRegistered = m_bCVarsRegistered;
	bool bLoaded = false;
	InvokeEngineCallback("SourceJSPlugin.Load", [this, InterfaceFactory, GameServerFactory, &bLoaded]() {
		if (!RegisterConsoleVariables(InterfaceFactory, GameServerFactory)) {
			return;
		}

		ICvar* pEarlyCVar = nullptr;
#if defined(CVAR_INTERFACE_VERSION)
		pEarlyCVar = static_cast<ICvar*>(InterfaceFactory(CVAR_INTERFACE_VERSION, nullptr));
#elif defined(VENGINE_CVAR_INTERFACE_VERSION)
		pEarlyCVar = static_cast<ICvar*>(InterfaceFactory(VENGINE_CVAR_INTERFACE_VERSION, nullptr));
#endif

		SourceJS::g_Application.GetEngineInterfaces().SetEarlyCVar(pEarlyCVar);
		// Registration may be retried after Application::Load resolves the final ICvar.
		RegisterConsoleCommands(pEarlyCVar);

		if (!SourceJS::g_Application.Load(InterfaceFactory, GameServerFactory)) {
			return;
		}

		if (!RegisterConsoleCommands(SourceJS::g_Application.GetEngineInterfaces().GetCVar())) {
			return;
		}

#ifndef SOURCEJS_OLD_CONSOLE_API
		InvokeEngineCallback("SourceJSPlugin.Load.InstallSayDispatch", InstallSayDispatch);
#endif

		bLoaded = true;
	});
	if (!bLoaded) {
		// Roll back only this attempt; never unload a previously running application.
		if (!bCommandWasRegistered) {
			InvokeEngineCallback("SourceJSPlugin.Load.UnregisterConsoleCommands", [this]() {
				UnregisterConsoleCommands();
			});
		}

		if (!bApplicationWasLoaded) {
			InvokeEngineCallback("SourceJSPlugin.Load.RollbackApplication", []() {
				SourceJS::g_Application.Unload();
			});
		}

		if (!bCVarsWereRegistered || !bSDKLibrariesWereConnected) {
			InvokeEngineCallback("SourceJSPlugin.Load.UnregisterConsoleVariables", [this, bCVarsWereRegistered, bSDKLibrariesWereConnected]() {
				UnregisterConsoleVariables(!bCVarsWereRegistered, !bSDKLibrariesWereConnected);
			});
		}
	}

	return bLoaded;
}

void CSourceJSPlugin::Unload() {
	SetCommandClient(kNoCommandClientSlot);
#ifndef SOURCEJS_OLD_CONSOLE_API
	InvokeEngineCallback("SourceJSPlugin.Unload.UninstallSayDispatch", UninstallSayDispatch);
#endif

	InvokeEngineCallback("SourceJSPlugin.Unload.UnregisterConsoleCommands", [this]() {
		UnregisterConsoleCommands();
	});
	InvokeEngineCallback("SourceJSPlugin.Unload", []() {
		SourceJS::g_Application.Unload();
	});
	InvokeEngineCallback("SourceJSPlugin.Unload.UnregisterConsoleVariables", [this]() {
		UnregisterConsoleVariables();
	});
}

void CSourceJSPlugin::Pause() {
	SetCommandClient(kNoCommandClientSlot);
#ifndef SOURCEJS_OLD_CONSOLE_API
	InvokeEngineCallback("SourceJSPlugin.Pause.UninstallSayDispatch", UninstallSayDispatch);
#endif

	InvokeEngineCallback("SourceJSPlugin.Pause", []() {
		SourceJS::g_Application.Pause();
	});
}

void CSourceJSPlugin::UnPause() {
	InvokeEngineCallback("SourceJSPlugin.UnPause", []() {
		SourceJS::g_Application.Unpause();
#ifndef SOURCEJS_OLD_CONSOLE_API
		InstallSayDispatch();
#endif
	});
}

char const* CSourceJSPlugin::GetPluginDescription() {
	return "SourceJS, JavaScript V8 runtime for Source Engine.";
}

void CSourceJSPlugin::LevelInit(char const* const pszMapName) {
	InvokeEngineCallback("SourceJSPlugin.LevelInit", [pszMapName]() {
		SourceJS::g_Application.LevelInitialize(pszMapName);
	});
}

void CSourceJSPlugin::ServerActivate(edict_t*, const int nEdictCount, const int nMaximumClients) {
#ifndef SOURCEJS_OLD_CONSOLE_API
	InvokeEngineCallback("SourceJSPlugin.ServerActivate.InstallSayDispatch", InstallSayDispatch);
#endif

	InvokeEngineCallback("SourceJSPlugin.ServerActivate", [nEdictCount, nMaximumClients]() {
		SourceJS::g_Application.ServerActivate(nEdictCount, nMaximumClients);
	});
}

void CSourceJSPlugin::GameFrame(const bool bSimulating) {
	InvokeEngineCallback("SourceJSPlugin.GameFrame", [bSimulating]() {
		SourceJS::g_Application.GameFrame(bSimulating);
	});
}

void CSourceJSPlugin::LevelShutdown() {
	SetCommandClient(kNoCommandClientSlot);

	InvokeEngineCallback("SourceJSPlugin.LevelShutdown", []() {
		SourceJS::g_Application.LevelShutdown();
	});
}

void CSourceJSPlugin::ClientActive(edict_t* const pEntity) {
	InvokeEngineCallback("SourceJSPlugin.ClientActive", [pEntity]() {
		SourceJS::g_Application.ClientActive(GetEntityIndex(pEntity));
	});
}

void CSourceJSPlugin::ClientDisconnect(edict_t* const pEntity) {
	InvokeEngineCallback("SourceJSPlugin.ClientDisconnect", [this, pEntity]() {
		const int nClientIndex = GetEntityIndex(pEntity);
		if (nClientIndex == GetCommandClient()) {
			SetCommandClient(kNoCommandClientSlot);
		}

		SourceJS::g_Application.ClientDisconnect(nClientIndex);
	});
}

void CSourceJSPlugin::ClientPutInServer(edict_t* const pEntity, char const* const pszPlayerName) {
	InvokeEngineCallback("SourceJSPlugin.ClientPutInServer", [pEntity, pszPlayerName]() {
		SourceJS::g_Application.ClientPutInServer(GetEntityIndex(pEntity), pszPlayerName);
	});
}

void CSourceJSPlugin::SetCommandClient(const int nClientIndex) {
	m_nCommandClientSlot = nClientIndex;
}

void CSourceJSPlugin::ClientSettingsChanged(edict_t* const pEdict) {
	InvokeEngineCallback("SourceJSPlugin.ClientSettingsChanged", [pEdict]() {
		SourceJS::g_Application.ClientSettingsChanged(GetEntityIndex(pEdict));
	});
}

PLUGIN_RESULT CSourceJSPlugin::ClientConnect(bool* const pbAllowConnectOut, edict_t* const pEntity, char const* const pszName, char const* const pszAddress, char* const pszRejectOut, const int nMaximumRejectLength) {
	// Failure must not bypass a connection veto or expose unwritten rejection text.
	bool bAllowed = false;
	const bool bCompleted = InvokeEngineCallback("SourceJSPlugin.ClientConnect", [&bAllowed, pEntity, pszName, pszAddress, pszRejectOut, nMaximumRejectLength]() {
		bAllowed = SourceJS::g_Application.ClientConnect(GetEntityIndex(pEntity), pszName, pszAddress, pszRejectOut, nMaximumRejectLength);
	});
	if (!bCompleted && pszRejectOut && (nMaximumRejectLength > 0)) {
		pszRejectOut[0] = '\0';
	}

	if (pbAllowConnectOut) {
		*pbAllowConnectOut = bAllowed;
	}

	return bAllowed ? PLUGIN_CONTINUE : PLUGIN_STOP;
}

#ifdef SOURCEJS_OLD_CONSOLE_API
PLUGIN_RESULT CSourceJSPlugin::ClientCommand(edict_t* const pEntity) {
	PLUGIN_RESULT Result = PLUGIN_CONTINUE;
	InvokeEngineCallback("SourceJSPlugin.ClientCommand", [pEntity, &Result]() {
		Result = HandleClientCommand(pEntity, BuildCommandArguments());
	});

	return Result;
}
#else
PLUGIN_RESULT CSourceJSPlugin::ClientCommand(edict_t* const pEntity, CCommand const& Command) {
	PLUGIN_RESULT Result = PLUGIN_CONTINUE;
	InvokeEngineCallback("SourceJSPlugin.ClientCommand", [pEntity, &Command, &Result]() {
		Result = HandleClientCommand(pEntity, BuildCommandArguments(Command));
	});

	return Result;
}
#endif

void CSourceJSPlugin::ClientFullyConnect(edict_t* const pEntity) {
	InvokeEngineCallback("SourceJSPlugin.ClientFullyConnect", [pEntity]() {
		SourceJS::g_Application.ClientFullyConnect(GetEntityIndex(pEntity));
	});
}

void CSourceJSPlugin::OnEdictAllocated(edict_t* pEdict) {
	InvokeEngineCallback("SourceJSPlugin.OnEdictAllocated", [pEdict]() {
		SourceJS::g_Application.EdictAllocated(GetEntityIndex(pEdict));
	});
}

void CSourceJSPlugin::OnEdictFreed(edict_t const* pEdict) {
	InvokeEngineCallback("SourceJSPlugin.OnEdictFreed", [pEdict]() {
		SourceJS::g_Application.EdictFreed(pEdict);
	});
}

bool CSourceJSPlugin::BNetworkCryptKeyCheckRequired(const uint32, const uint16, const uint32, const bool) {
	return false;
}

bool CSourceJSPlugin::BNetworkCryptKeyValidate(const uint32, const uint16, const uint32, const int, const int, byte* const, byte* const) {
	return false;
}

int CSourceJSPlugin::GetCommandClient() const noexcept {
	if ((m_nCommandClientSlot < 0) || (m_nCommandClientSlot == std::numeric_limits<int>::max())) {
		return 0;
	}

	return m_nCommandClientSlot + 1;
}

PLUGIN_RESULT CSourceJSPlugin::NetworkIDValidated(char const* const pszUserName, char const* const pszNetworkID) {
	InvokeEngineCallback("SourceJSPlugin.NetworkIDValidated", [pszUserName, pszNetworkID]() {
		SourceJS::g_Application.NetworkIDValidated(pszUserName, pszNetworkID);
	});

	return PLUGIN_CONTINUE;
}

#if !defined(ENGINE_BRANCH_DARKM)
void CSourceJSPlugin::OnQueryCvarValueFinished(const QueryCvarCookie_t nQueryCookie, edict_t* const pPlayerEntity, const EQueryCvarValueStatus Status, char const* const pszCVarName, char const* const pszCVarValue) {
	InvokeEngineCallback("SourceJSPlugin.OnQueryCvarValueFinished", [nQueryCookie, pPlayerEntity, Status, pszCVarName, pszCVarValue]() {
		SourceJS::g_Application.QueryCVarValueFinished(nQueryCookie, GetEntityIndex(pPlayerEntity), static_cast<int>(Status), pszCVarName, pszCVarValue);
	});
}
#endif

bool CSourceJSPlugin::RegisterConsoleCommands(ICvar* const pCVar) {
	if (!pCVar) {
		SourceJS::LogWarning("SourceJSPlugin.RegisterConsoleCommands failed: ICvar is unavailable.");
		return false;
	}

	auto* const pExistingCommand = SourceJS::g_Application.GetEngineInterfaces().FindCommandBase("sjs");
	if (pExistingCommand && (pExistingCommand != m_pSourceJSCommand.get())) {
		m_pCommandCVar = nullptr;
		SourceJS::LogInfo("SourceJSPlugin.RegisterConsoleCommands completed: sjs is already registered.");
		return true;
	}

	if (!m_pSourceJSCommand) {
		m_pSourceJSCommand = std::make_unique<ConCommand>("sjs", HandleSourceJSCommand, "SourceJS runtime command tree.", SourceJS::kSourceJSOwnedCommandFlag);
	}

	// The SDK can register during construction; retain the unregister route if bookkeeping throws.
	m_pCommandCVar = pCVar;
	if (!SourceJS::g_Application.GetEngineInterfaces().RegisterConCommand(m_pSourceJSCommand.get())) {
		SourceJS::LogError("SourceJSPlugin.RegisterConsoleCommands failed: ICvar rejected sjs registration.");
		m_pCommandCVar = nullptr;
		return false;
	}

	SourceJS::LogInfo("SourceJSPlugin.RegisterConsoleCommands completed: sjs registered.");

	return true;
}

void CSourceJSPlugin::UnregisterConsoleCommands() {
	if (m_pSourceJSCommand && m_pCommandCVar) {
		SourceJS::g_Application.GetEngineInterfaces().UnregisterConCommand(m_pSourceJSCommand.get());
	}

	// SDK pending lists can still borrow this object; keep it alive until DLL teardown.
	m_pCommandCVar = nullptr;
}
