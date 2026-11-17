#pragma once

#ifndef _SOURCEJSAPPLICATION_H_
#define _SOURCEJSAPPLICATION_H_

// Local compatibility profile: Windows/Linux C++20; the canonical guard
// is this header's only reserved-name exception (guide 4.1).

// General
#if __has_include("tier1/interface.h")
#include "tier1/interface.h"
#elif __has_include("tier0/interface.h")
#include "tier0/interface.h"
#else
#error "The selected Source SDK does not provide an interface header."
#endif

// Project
#include "sourcejs/CommandDispatcher.h"
#include "sourcejs/EngineInterfaces.h"
#include "sourcejs/ExtensionManager.h"
#include "sourcejs/HookManager.h"
#include "sourcejs/MemoryHookManager.h"
#include "sourcejs/ModuleRegistry.h"
#include "sourcejs/PluginManager.h"
#include "sourcejs/RuntimePaths.h"
#include "sourcejs/V8Runtime.h"

// ================================================================
// Application
// ================================================================

namespace SourceJS {

	class Application {
	public:
		Application();

	public:
		bool Load(CreateInterfaceFn const InterfaceFactory, CreateInterfaceFn const GameServerFactory);
		void Unload();
		void Pause();
		void Unpause();
		void LevelInitialize(char const* const pszMapName);
		void ServerActivate(const int nEdictCount, const int nMaximumClients);
		void GameFrame(const bool bSimulating);
		void LevelShutdown();
		bool ClientConnect(const int nEntityIndex, char const* const pszPlayerName, char const* const pszAddress, char* const pszReject, const int nMaximumRejectLength);
		void ClientActive(const int nEntityIndex);
		void ClientDisconnect(const int nEntityIndex);
		void ClientPutInServer(const int nEntityIndex, char const* const pszPlayerName);
		void ClientSettingsChanged(const int nEntityIndex);
		void ClientFullyConnect(const int nEntityIndex);
		void EdictAllocated(const int nEdictIndex);
		void EdictFreed(void const* const pEdict);
		void NetworkIDValidated(char const* const pszUserName, char const* const pszNetworkID);
		void QueryCVarValueFinished(const int nQueryCookie, const int nEntityIndex, const int nQueryStatus, char const* const pszCVarName, char const* const pszCVarValue);
		void SetServerOutputHookEnabled(const bool bEnabled);
		bool EmitServerOutput(const int nSeverity, char const* const pszMessage);
		bool IsLoaded() const noexcept;

	public:
		CommandDispatcher& GetCommandDispatcher() noexcept;
		EngineInterfaces& GetEngineInterfaces() noexcept;
		ExtensionManager& GetExtensionManager() noexcept;
		HookManager& GetHookManager() noexcept;
		MemoryHookManager& GetMemoryHookManager() noexcept;
		ModuleRegistry& GetModuleRegistry() noexcept;
		PluginManager& GetPluginManager() noexcept;
		RuntimePaths& GetRuntimePaths() noexcept;
		V8Runtime& GetRuntime() noexcept;

	private:
		EngineInterfaces m_EngineInterfaces;
		RuntimePaths m_RuntimePaths;
		V8Runtime m_Runtime;
		PluginManager m_PluginManager;
		ExtensionManager m_ExtensionManager;
		HookManager m_HookManager;
		MemoryHookManager m_MemoryHookManager;
		ModuleRegistry m_ModuleRegistry;
		CommandDispatcher m_CommandDispatcher;
		bool m_bLoaded;
		bool m_bPaused;
		bool m_bLevelInitialized;
		bool m_bServerOutputHooked;
	};

	extern Application g_Application;
} // namespace SourceJS
#endif // _SOURCEJSAPPLICATION_H_
