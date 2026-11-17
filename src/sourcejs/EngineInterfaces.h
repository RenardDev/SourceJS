#pragma once

#ifndef _SOURCEJSENGINEINTERFACES_H_
#define _SOURCEJSENGINEINTERFACES_H_

// Compatibility profile: retain this project-canonical reserved guard spelling
// under CODE_STYLE_GUIDE.md 2.5/4.1; the exception is limited to this header guard.

// General
#if __has_include("tier1/iconvar.h")
#include "tier1/iconvar.h"
#else
#include "tier1/convar.h"
#endif
#if __has_include("tier1/interface.h")
#include "tier1/interface.h"
#elif __has_include("tier0/interface.h")
#include "tier0/interface.h"
#else
#error "The selected Source SDK does not provide an interface header."
#endif

// STL
#include <map>
#include <string>
#include <vector>

class CGlobalVars;
class ConCommandBase;
class ICvar;
class IEngineSound;
class IEngineTrace;
class IFileSystem;
class IGameEventManager2;
class IMDLCache;
class INetworkStringTableContainer;
class IPhysics;
class IPlayerInfoManager;
class IServerGameDLL;
class IServerPluginHelpers;
class IServerTools;
class IVEngineServer;
class IVoiceServer;
struct edict_t;

// ================================================================
// EngineInterfaces
// ================================================================

namespace SourceJS {

	inline constexpr int kSourceJSOwnedCommandFlag = static_cast<int>(static_cast<unsigned int>(1) << 31);
	inline constexpr int kSourceJSClientCommandFlags = kSourceJSOwnedCommandFlag | FCVAR_GAMEDLL;

	// Not thread-safe; serialize lifecycle, registration and interface access.
	// Engine interfaces and commands are borrowed; the engine/caller owns their lifetime.
	// Unregister commands before destruction; do not keep interface addresses past disconnect.
	// Disconnect releases tracked registrations before clearing ICvar, without destroying command objects.
	// Connect() and RegisterConCommand() may throw on allocation failure.
	class EngineInterfaces {
	public:
		EngineInterfaces() noexcept;

	public:
		bool Connect(CreateInterfaceFn const InterfaceFactory, CreateInterfaceFn const GameServerFactory);
		void Disconnect() noexcept;
		void SetEarlyCVar(ICvar* const pCVar) noexcept;
		bool RegisterConCommand(ConCommandBase* const pCommand);
		void UnregisterConCommand(ConCommandBase* const pCommand) noexcept;

	public:
		bool IsConnected() const noexcept;
		IVEngineServer* GetEngine() const noexcept;
		IGameEventManager2* GetGameEventManager() const noexcept;
		IEngineSound* GetEngineSound() const noexcept;
		IEngineTrace* GetEngineTrace() const noexcept;
		INetworkStringTableContainer* GetNetworkStringTableContainer() const noexcept;
		IServerGameDLL* GetServerGameDLL() const noexcept;
		IServerTools* GetServerTools() const noexcept;
		IMDLCache* GetModelCache() const noexcept;
		IFileSystem* GetFileSystem() const noexcept;
		IServerPluginHelpers* GetServerPluginHelpers() const noexcept;
		IVoiceServer* GetVoiceServer() const noexcept;
		IPhysics* GetPhysics() const noexcept;
		IPlayerInfoManager* GetPlayerInformationManager() const noexcept;
		ICvar* GetCVar() const noexcept;
		CGlobalVars* GetGlobalVariables() const noexcept;
		edict_t* GetEdict(const int nEntityIndex) const;
		// A non-null edict must belong to the current server's edict array.
		int GetEdictIndex(edict_t const* const pEdict) const noexcept;
		std::vector<std::string> GetCurrentCommandArguments() const;
		ConCommandBase* FindCommandBase(std::string const& strCommandName) const noexcept;
		std::vector<std::string> const& GetInterfaceNames() const noexcept;
		void* GetInterface(std::string const& strInterfaceName) const noexcept;

	private:
		void RecordInterface(char const* const pszInterfaceName, void* const pInterface);
		void* LoadOptionalInterface(CreateInterfaceFn const InterfaceFactory, char const* const pszInterfaceName);

	private:
		IVEngineServer* m_pEngine;
		IGameEventManager2* m_pGameEventManager;
		IEngineSound* m_pEngineSound;
		IEngineTrace* m_pEngineTrace;
		INetworkStringTableContainer* m_pNetworkStringTableContainer;
		IServerGameDLL* m_pServerGameDLL;
		IServerTools* m_pServerTools;
		IMDLCache* m_pModelCache;
		IFileSystem* m_pFileSystem;
		IServerPluginHelpers* m_pServerPluginHelpers;
		IVoiceServer* m_pVoiceServer;
		IPhysics* m_pPhysics;
		IPlayerInfoManager* m_pPlayerInformationManager;
		ICvar* m_pCVar;
		CGlobalVars* m_pGlobalVariables;
		std::vector<std::string> m_vecInterfaceNames;
		std::map<std::string, void*> m_mapInterfaces;
		std::vector<ConCommandBase*> m_vecRegisteredCommands;
		bool m_bConnected;
	};
} // namespace SourceJS
#endif // _SOURCEJSENGINEINTERFACES_H_
