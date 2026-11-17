#include "sourcejs/EngineInterfaces.h"

// General
#include "datacache/imdlcache.h"
#include "edict.h"
#include "eiface.h"
#if __has_include("engine/IEngineSound.h")
#include "engine/IEngineSound.h"
#endif
#if __has_include("engine/IEngineTrace.h")
#include "engine/IEngineTrace.h"
#endif
#include "engine/iserverplugin.h"
#include "filesystem.h"
#if __has_include("game/server/iplayerinfo.h")
#include "game/server/iplayerinfo.h"
#elif __has_include("dlls/iplayerinfo.h")
#include "dlls/iplayerinfo.h"
#endif
#include "icvar.h"
#include "igameevents.h"
#if __has_include("ivoiceserver.h")
#include "ivoiceserver.h"
#endif
#include "networkstringtabledefs.h"
#if __has_include("toolframework/itoolentity.h")
#include "toolframework/itoolentity.h"
#endif
#if __has_include("vphysics_interface.h")
#include "vphysics_interface.h"
#endif

// C++
#include <cstring>

// STL
#include <algorithm>

// Project
#include "sourcejs/Log.h"

// ================================================================
// EngineInterfaces
// ================================================================

namespace SourceJS {

	namespace {

		template <typename T>
		constexpr bool kSourceSDKEdictAPIMissing = false;

		template <typename CVarType>
		ConCommandBase* FindSourceSDKCommandBase(CVarType* const pCVar, char const* const pszCommandName) noexcept {
			if constexpr (requires(CVarType* const pInterface) { pInterface->FindCommandBase(pszCommandName); }) {
				return pCVar->FindCommandBase(pszCommandName);

			} else {
				for (auto* pCommandBase = pCVar->GetCommands(); pCommandBase; pCommandBase = const_cast<ConCommandBase*>(pCommandBase->GetNext())) {
					if (std::strcmp(pCommandBase->GetName(), pszCommandName) == 0) {
						return pCommandBase;
					}
				}
			}

			return nullptr;
		}

		template <typename CVarType>
		void RegisterSourceSDKConCommand(CVarType* const pCVar, ConCommandBase* const pCommand) noexcept {
			if constexpr (requires(CVarType* const pInterface) { pInterface->RegisterConCommand(pCommand); }) {
				pCVar->RegisterConCommand(pCommand);

			} else {
				pCVar->RegisterConCommandBase(pCommand);
			}
		}

		template <typename CVarType>
		void UnregisterSourceSDKConCommand(CVarType* const pCVar, ConCommandBase* const pCommand, std::vector<ConCommandBase*> const& vecRemainingCommands) noexcept {
			if constexpr (requires(CVarType* const pInterface) { pInterface->UnregisterConCommand(pCommand); }) {
				pCVar->UnregisterConCommand(pCommand);

			} else {
				pCVar->UnlinkVariables(kSourceJSOwnedCommandFlag);

				for (auto const& pRemainingCommand : vecRemainingCommands) {
					RegisterSourceSDKConCommand(pCVar, pRemainingCommand);
				}
			}
		}

		template <typename EngineServerType, typename GlobalVariablesType>
		edict_t* FindSourceSDKEdictByIndex(EngineServerType* const pEngineServer, GlobalVariablesType* const pGlobalVariables, const int nEntityIndex) {
			if constexpr (requires(EngineServerType* const pServer) { pServer->PEntityOfEntIndex(nEntityIndex); }) {
				return pEngineServer->PEntityOfEntIndex(nEntityIndex);

			} else if constexpr (requires(GlobalVariablesType* const pServerGlobalVariables) { pServerGlobalVariables->pEdicts; }) {
				if (!pGlobalVariables->pEdicts) {
					return nullptr;
				}

				return pGlobalVariables->pEdicts + nEntityIndex;

			} else {
				static_assert(kSourceSDKEdictAPIMissing<EngineServerType>, "The selected Source SDK branch does not expose edict lookup by index.");
			}
		}

		template <typename EngineServerType, typename GlobalVariablesType>
		int GetSourceSDKEdictIndex(EngineServerType* const pEngineServer, GlobalVariablesType* const pGlobalVariables, edict_t const* const pEdict) noexcept {
			if constexpr (requires(EngineServerType* const pServer) { pServer->IndexOfEdict(pEdict); }) {
				return pEngineServer->IndexOfEdict(pEdict);

			} else if constexpr (requires(GlobalVariablesType* const pServerGlobalVariables) { pServerGlobalVariables->pEdicts; }) {
				if (!pGlobalVariables->pEdicts) {
					return -1;
				}

				return static_cast<int>(pEdict - pGlobalVariables->pEdicts);

			} else {
				static_assert(kSourceSDKEdictAPIMissing<EngineServerType>, "The selected Source SDK branch does not expose an edict index operation.");
			}
		}

	} // namespace

	EngineInterfaces::EngineInterfaces() noexcept {
		m_pEngine = nullptr;
		m_pGameEventManager = nullptr;
		m_pEngineSound = nullptr;
		m_pEngineTrace = nullptr;
		m_pNetworkStringTableContainer = nullptr;
		m_pServerGameDLL = nullptr;
		m_pServerTools = nullptr;
		m_pModelCache = nullptr;
		m_pFileSystem = nullptr;
		m_pServerPluginHelpers = nullptr;
		m_pVoiceServer = nullptr;
		m_pPhysics = nullptr;
		m_pPlayerInformationManager = nullptr;
		m_pCVar = nullptr;
		m_pGlobalVariables = nullptr;
		m_bConnected = false;
	}

	void EngineInterfaces::RecordInterface(char const* const pszInterfaceName, void* const pInterface) {
		if (!pszInterfaceName || !pInterface) {
			return;
		}

		std::string const strInterfaceName = pszInterfaceName;
		if (m_mapInterfaces.find(strInterfaceName) == m_mapInterfaces.end()) {
			m_vecInterfaceNames.push_back(strInterfaceName);
		}

		m_mapInterfaces[strInterfaceName] = pInterface;
	}

	void* EngineInterfaces::LoadOptionalInterface(CreateInterfaceFn const InterfaceFactory, char const* const pszInterfaceName) {
		if (!InterfaceFactory || !pszInterfaceName) {
			return nullptr;
		}

		void* const pInterface = InterfaceFactory(pszInterfaceName, nullptr);
		if (pInterface) {
			LogInfo("EngineInterfaces.LoadOptionalInterface loaded Interface=\"%s\" Address=%p.", pszInterfaceName, pInterface);
			RecordInterface(pszInterfaceName, pInterface);

		} else {
			LogWarning("EngineInterfaces.LoadOptionalInterface unavailable Interface=\"%s\".", pszInterfaceName);
		}

		return pInterface;
	}

	bool EngineInterfaces::Connect(CreateInterfaceFn const InterfaceFactory, CreateInterfaceFn const GameServerFactory) {
		if (!InterfaceFactory || !GameServerFactory) {
			LogError("EngineInterfaces.Connect failed: interface factories are missing.");
			return false;
		}

		m_pEngine = static_cast<IVEngineServer*>(LoadOptionalInterface(InterfaceFactory, INTERFACEVERSION_VENGINESERVER));
		m_pGameEventManager = static_cast<IGameEventManager2*>(LoadOptionalInterface(InterfaceFactory, INTERFACEVERSION_GAMEEVENTSMANAGER2));
#if defined(IENGINESOUND_SERVER_INTERFACE_VERSION)
		m_pEngineSound = static_cast<IEngineSound*>(LoadOptionalInterface(InterfaceFactory, IENGINESOUND_SERVER_INTERFACE_VERSION));
#endif
#if defined(INTERFACEVERSION_ENGINETRACE_SERVER)
		m_pEngineTrace = static_cast<IEngineTrace*>(LoadOptionalInterface(InterfaceFactory, INTERFACEVERSION_ENGINETRACE_SERVER));
#endif
		m_pNetworkStringTableContainer = static_cast<INetworkStringTableContainer*>(LoadOptionalInterface(InterfaceFactory, INTERFACENAME_NETWORKSTRINGTABLESERVER));
		m_pServerGameDLL = static_cast<IServerGameDLL*>(LoadOptionalInterface(GameServerFactory, INTERFACEVERSION_SERVERGAMEDLL));
#if defined(INTERFACEVERSION_SERVERGAMECLIENTS)
		// Keep this optional interface in the registry for consumers that look it up by name.
		LoadOptionalInterface(GameServerFactory, INTERFACEVERSION_SERVERGAMECLIENTS);
#endif
#if __has_include("toolframework/itoolentity.h")
		m_pServerTools = static_cast<IServerTools*>(LoadOptionalInterface(GameServerFactory, VSERVERTOOLS_INTERFACE_VERSION));
#endif
		m_pModelCache = static_cast<IMDLCache*>(LoadOptionalInterface(InterfaceFactory, MDLCACHE_INTERFACE_VERSION));
#if defined(FILESYSTEM_INTERFACE_VERSION)
		m_pFileSystem = static_cast<IFileSystem*>(LoadOptionalInterface(InterfaceFactory, FILESYSTEM_INTERFACE_VERSION));
#endif
		m_pServerPluginHelpers = static_cast<IServerPluginHelpers*>(LoadOptionalInterface(InterfaceFactory, INTERFACEVERSION_ISERVERPLUGINHELPERS));
#if defined(INTERFACEVERSION_VOICESERVER)
		m_pVoiceServer = static_cast<IVoiceServer*>(LoadOptionalInterface(InterfaceFactory, INTERFACEVERSION_VOICESERVER));
#endif
#if defined(VPHYSICS_INTERFACE_VERSION)
		m_pPhysics = static_cast<IPhysics*>(LoadOptionalInterface(InterfaceFactory, VPHYSICS_INTERFACE_VERSION));
#endif
		m_pPlayerInformationManager = static_cast<IPlayerInfoManager*>(LoadOptionalInterface(GameServerFactory, INTERFACEVERSION_PLAYERINFOMANAGER));
#if defined(CVAR_INTERFACE_VERSION)
		m_pCVar = static_cast<ICvar*>(LoadOptionalInterface(InterfaceFactory, CVAR_INTERFACE_VERSION));
#elif defined(VENGINE_CVAR_INTERFACE_VERSION)
		m_pCVar = static_cast<ICvar*>(LoadOptionalInterface(InterfaceFactory, VENGINE_CVAR_INTERFACE_VERSION));
#endif

		if (!m_pEngine) {
			LogError("EngineInterfaces.Connect failed Interface=\"%s\".", INTERFACEVERSION_VENGINESERVER);
			return false;
		}

		if (m_pPlayerInformationManager) {
			m_pGlobalVariables = m_pPlayerInformationManager->GetGlobalVars();
		}

		m_bConnected = true;

		LogInfo("EngineInterfaces.Connect completed.");

		return true;
	}

	void EngineInterfaces::Disconnect() noexcept {
		// Connect can fail before its final flag; borrowed partial interfaces still need clearing.
		const bool bWasConnected = m_bConnected;

		// Failed initialization can disconnect before the plugin owner reaches rollback.
		while (m_pCVar && !m_vecRegisteredCommands.empty()) {
			UnregisterConCommand(m_vecRegisteredCommands.back());
		}

		m_pGlobalVariables = nullptr;
		m_pCVar = nullptr;
		m_pPlayerInformationManager = nullptr;
		m_pPhysics = nullptr;
		m_pVoiceServer = nullptr;
		m_pServerPluginHelpers = nullptr;
		m_pFileSystem = nullptr;
		m_pModelCache = nullptr;
		m_pServerTools = nullptr;
		m_pServerGameDLL = nullptr;
		m_pNetworkStringTableContainer = nullptr;
		m_pEngineTrace = nullptr;
		m_pEngineSound = nullptr;
		m_pGameEventManager = nullptr;
		m_pEngine = nullptr;

		m_vecInterfaceNames.clear();
		m_mapInterfaces.clear();
		m_vecRegisteredCommands.clear();

		m_bConnected = false;

		if (bWasConnected) {
			LogInfo("EngineInterfaces.Disconnect completed.");
		}
	}

	void EngineInterfaces::SetEarlyCVar(ICvar* const pCVar) noexcept {
		if (m_pCVar || !pCVar) {
			return;
		}

		m_pCVar = pCVar;
	}

	bool EngineInterfaces::RegisterConCommand(ConCommandBase* const pCommand) {
		if (!m_pCVar || !pCommand) {
			return false;
		}

		if (std::find(m_vecRegisteredCommands.begin(), m_vecRegisteredCommands.end(), pCommand) == m_vecRegisteredCommands.end()) {
			m_vecRegisteredCommands.push_back(pCommand);
		}

		if (FindSourceSDKCommandBase(m_pCVar, pCommand->GetName()) != pCommand) {
			RegisterSourceSDKConCommand(m_pCVar, pCommand);
		}

		return true;
	}

	void EngineInterfaces::UnregisterConCommand(ConCommandBase* const pCommand) noexcept {
		if (!m_pCVar || !pCommand) {
			return;
		}

		auto itRegisteredCommand = std::find(m_vecRegisteredCommands.begin(), m_vecRegisteredCommands.end(), pCommand);
		if (itRegisteredCommand != m_vecRegisteredCommands.end()) {
			m_vecRegisteredCommands.erase(itRegisteredCommand);
		}

		UnregisterSourceSDKConCommand(m_pCVar, pCommand, m_vecRegisteredCommands);
	}

	bool EngineInterfaces::IsConnected() const noexcept {
		return m_bConnected;
	}

	IVEngineServer* EngineInterfaces::GetEngine() const noexcept {
		return m_pEngine;
	}

	IGameEventManager2* EngineInterfaces::GetGameEventManager() const noexcept {
		return m_pGameEventManager;
	}

	IEngineSound* EngineInterfaces::GetEngineSound() const noexcept {
		return m_pEngineSound;
	}

	IEngineTrace* EngineInterfaces::GetEngineTrace() const noexcept {
		return m_pEngineTrace;
	}

	INetworkStringTableContainer* EngineInterfaces::GetNetworkStringTableContainer() const noexcept {
		return m_pNetworkStringTableContainer;
	}

	IServerGameDLL* EngineInterfaces::GetServerGameDLL() const noexcept {
		return m_pServerGameDLL;
	}

	IServerTools* EngineInterfaces::GetServerTools() const noexcept {
		return m_pServerTools;
	}

	IMDLCache* EngineInterfaces::GetModelCache() const noexcept {
		return m_pModelCache;
	}

	IFileSystem* EngineInterfaces::GetFileSystem() const noexcept {
		return m_pFileSystem;
	}

	IServerPluginHelpers* EngineInterfaces::GetServerPluginHelpers() const noexcept {
		return m_pServerPluginHelpers;
	}

	IVoiceServer* EngineInterfaces::GetVoiceServer() const noexcept {
		return m_pVoiceServer;
	}

	IPhysics* EngineInterfaces::GetPhysics() const noexcept {
		return m_pPhysics;
	}

	IPlayerInfoManager* EngineInterfaces::GetPlayerInformationManager() const noexcept {
		return m_pPlayerInformationManager;
	}

	ICvar* EngineInterfaces::GetCVar() const noexcept {
		return m_pCVar;
	}

	CGlobalVars* EngineInterfaces::GetGlobalVariables() const noexcept {
		return m_pGlobalVariables;
	}

	edict_t* EngineInterfaces::GetEdict(const int nEntityIndex) const {
		if (!m_pEngine || !m_pGlobalVariables || (nEntityIndex < 0) || (nEntityIndex >= m_pGlobalVariables->maxEntities)) {
			return nullptr;
		}

		return FindSourceSDKEdictByIndex(m_pEngine, m_pGlobalVariables, nEntityIndex);
	}

	int EngineInterfaces::GetEdictIndex(edict_t const* const pEdict) const noexcept {
		// Non-null inputs must be current-server edicts, not arbitrary foreign addresses.
		if (!m_pEngine || !m_pGlobalVariables || !pEdict) {
			return -1;
		}

		const int nEntityIndex = GetSourceSDKEdictIndex(m_pEngine, m_pGlobalVariables, pEdict);
		if ((nEntityIndex < 0) || (nEntityIndex >= m_pGlobalVariables->maxEntities)) {
			return -1;
		}

		return nEntityIndex;
	}

	std::vector<std::string> EngineInterfaces::GetCurrentCommandArguments() const {
		std::vector<std::string> vecArguments {};

#ifdef SOURCEJS_OLD_CONSOLE_API
		if (!m_pEngine) {
			return vecArguments;
		}

		const int nArgumentCount = m_pEngine->Cmd_Argc();
		for (int nArgumentIndex = 0; nArgumentIndex < nArgumentCount; ++nArgumentIndex) {
			char const* const pszArgument = m_pEngine->Cmd_Argv(nArgumentIndex);
			vecArguments.push_back(pszArgument ? pszArgument : "");
		}
#endif // SOURCEJS_OLD_CONSOLE_API

		return vecArguments;
	}

	ConCommandBase* EngineInterfaces::FindCommandBase(std::string const& strCommandName) const noexcept {
		return m_pCVar ? FindSourceSDKCommandBase(m_pCVar, strCommandName.c_str()) : nullptr;
	}

	std::vector<std::string> const& EngineInterfaces::GetInterfaceNames() const noexcept {
		return m_vecInterfaceNames;
	}

	void* EngineInterfaces::GetInterface(std::string const& strInterfaceName) const noexcept {
		auto itInterface = m_mapInterfaces.find(strInterfaceName);
		if (itInterface == m_mapInterfaces.end()) {
			return nullptr;
		}

		return itInterface->second;
	}
} // namespace SourceJS
