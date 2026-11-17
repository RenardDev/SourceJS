#pragma once

#ifndef _SOURCEJSSOURCEJSPLUGIN_H_
#define _SOURCEJSSOURCEJSPLUGIN_H_

// Compatibility profile (4.1): this canonical guard is the only reserved-name exception.

// General
#include "engine/iserverplugin.h"

// STL
#include <memory>

class ConCommand;
class ICvar;

// ----------------------------------------------------------------
// SourceJS VSP plugin
// ----------------------------------------------------------------

// SDK callbacks run on the game thread; C++ failures are translated at that boundary.
// Exact virtual spellings/order preserve the selected SDK's callback contract.
class CSourceJSPlugin : public IServerPluginCallbacks {
public:
	CSourceJSPlugin();

public:
	bool Load(CreateInterfaceFn InterfaceFactory, CreateInterfaceFn GameServerFactory) override;
	void Unload() override;
	void Pause() override;
	void UnPause() override;
	char const* GetPluginDescription() override;
	void LevelInit(char const* const pszMapName) override;
	void ServerActivate(edict_t*, const int nEdictCount, const int nMaximumClients) override;
	void GameFrame(const bool bSimulating) override;
	void LevelShutdown() override;
	void ClientActive(edict_t* const pEntity) override;
	void ClientDisconnect(edict_t* const pEntity) override;
	void ClientPutInServer(edict_t* const pEntity, char const* const pszPlayerName) override;
	void SetCommandClient(const int nClientIndex) override;
	void ClientSettingsChanged(edict_t* const pEdict) override;
	// Optional outputs: reject text is writable only with positive capacity; failure vetoes connection.
	PLUGIN_RESULT ClientConnect(bool* const pbAllowConnectOut, edict_t* const pEntity, char const* const pszName, char const* const pszAddress, char* const pszRejectOut, const int nMaximumRejectLength) override;
#ifdef SOURCEJS_OLD_CONSOLE_API
	PLUGIN_RESULT ClientCommand(edict_t* const pEntity) override;
#else
	PLUGIN_RESULT ClientCommand(edict_t* const pEntity, CCommand const& Command) override;
#endif
	virtual void ClientFullyConnect(edict_t* pEntity);
	virtual void OnEdictAllocated(edict_t* pEdict);
	virtual void OnEdictFreed(edict_t const* pEdict);
	virtual bool BNetworkCryptKeyCheckRequired(uint32, uint16, uint32, bool);
	virtual bool BNetworkCryptKeyValidate(uint32, uint16, uint32, int, int, byte*, byte*);

	PLUGIN_RESULT NetworkIDValidated(char const* const pszUserName, char const* const pszNetworkID) override;
#if !defined(ENGINE_BRANCH_DARKM)
	void OnQueryCvarValueFinished(const QueryCvarCookie_t nQueryCookie, edict_t* const pPlayerEntity, const EQueryCvarValueStatus Status, char const* const pszCVarName, char const* const pszCVarValue) override;
#endif

	// Returns a one-based client index, or zero when no client is associated with the command.
	int GetCommandClient() const noexcept;

private:
	bool RegisterConsoleCommands(ICvar* const pCVar);
	void UnregisterConsoleCommands();
	bool RegisterConsoleVariables(CreateInterfaceFn const InterfaceFactory, CreateInterfaceFn const GameServerFactory);
	void UnregisterConsoleVariables(const bool bUnregisterVariables = true, const bool bDisconnectLibraries = true);

private:
	// Module-lifetime storage: the SDK can retain a pending-list link after unregistering.
	std::unique_ptr<ConCommand> m_pSourceJSCommand;
	// Borrowed from the engine; command removal precedes interface disconnect.
	ICvar* m_pCommandCVar;
	bool m_bCVarsRegistered;
	bool m_bSDKLibrariesConnected;
	int m_nCommandClientSlot;
};

// Registered engine callback identity, defined once in SourceJSPlugin.cpp.
extern CSourceJSPlugin g_SourceJSPlugin;
#endif // _SOURCEJSSOURCEJSPLUGIN_H_
