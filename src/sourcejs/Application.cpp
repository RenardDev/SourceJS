#include "sourcejs/Application.h"

// General
#if defined(_WIN32)
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#define SOURCEJS_UNDEFINE_WIN32_LEAN_AND_MEAN 1
#endif
#ifndef NOMINMAX
#define NOMINMAX
#define SOURCEJS_UNDEFINE_NOMINMAX 1
#endif
#include <Windows.h>
#ifdef SOURCEJS_UNDEFINE_NOMINMAX
#undef NOMINMAX
#undef SOURCEJS_UNDEFINE_NOMINMAX
#endif
#ifdef SOURCEJS_UNDEFINE_WIN32_LEAN_AND_MEAN
#undef WIN32_LEAN_AND_MEAN
#undef SOURCEJS_UNDEFINE_WIN32_LEAN_AND_MEAN
#endif
#else
#include <dlfcn.h>
#endif
#include "eiface.h"
#if __has_include("tier0/logging.h")
#include "tier0/logging.h"
#define SOURCEJS_HAS_TIER0_LOGGING 1
#else
#define SOURCEJS_HAS_TIER0_LOGGING 0
#endif

// C++
#include <cstdio>

// STL
#include <filesystem>
#include <string>
#include <type_traits>
#include <vector>

// Project
#include "sourcejs/ListenerPayload.h"
#include "sourcejs/Log.h"
#include "sourcejs/SourceModGameData.h"
#include "sourcejs/modules/ModuleBindings.h"

// ================================================================
// Application
// ================================================================

namespace SourceJS {

	namespace {

#if SOURCEJS_HAS_TIER0_LOGGING
		using fnLoggingSystemRegisterLoggingListener = void(*)(ILoggingListener*);
		// SDK branches differ in the clear-state parameter; preserve the selected declaration.
		using fnLoggingSystemPushLoggingState = decltype(&LoggingSystem_PushLoggingState);
		using fnLoggingSystemPopLoggingState = void(*)(bool);
		using fnLoggingSystemLogDirect = LoggingResponse_t(*)(LoggingChannelID_t, LoggingSeverity_t, Color, char const*);

		constexpr char kServerOutputCallbackErrorMessage[] = "[SourceJS] [ERROR] ServerOutput callback failed.\n";

		struct ServerOutputLoggingFunctions {
			ServerOutputLoggingFunctions() noexcept;

			bool IsValid() const noexcept;

			fnLoggingSystemRegisterLoggingListener m_RegisterLoggingListener;
			fnLoggingSystemPushLoggingState m_PushLoggingState;
			fnLoggingSystemPopLoggingState m_PopLoggingState;
			fnLoggingSystemLogDirect m_LogDirect;
		};

		ServerOutputLoggingFunctions::ServerOutputLoggingFunctions() noexcept {
			m_RegisterLoggingListener = nullptr;
			m_PushLoggingState = nullptr;
			m_PopLoggingState = nullptr;
			m_LogDirect = nullptr;
		}

		bool ServerOutputLoggingFunctions::IsValid() const noexcept {
			return m_RegisterLoggingListener && m_PushLoggingState && m_PopLoggingState && m_LogDirect;
		}

		template <typename TFunction>
		void PushServerOutputLoggingState(TFunction const PushLoggingState) {
			if constexpr (std::is_invocable_v<TFunction, bool, bool>) {
				PushLoggingState(false, true);
			} else {
				static_assert(std::is_invocable_v<TFunction, bool>, "Unsupported Tier0 logging push signature");
				PushLoggingState(false);
			}
		}

		// Preserve lookup argument order; name only the fallback used by this platform.
		template <typename TFunction>
#if defined(_WIN64)
		TFunction ResolveTier0Function(char const* const pszPrimaryName, char const*, char const* const pszWindowsX64Name, char const*) noexcept {
#elif defined(_WIN32)
		TFunction ResolveTier0Function(char const* const pszPrimaryName, char const* const pszWindowsX86Name, char const*, char const*) noexcept {
#else
		TFunction ResolveTier0Function(char const* const pszPrimaryName, char const*, char const*, char const* const pszLinuxName) noexcept {
#endif
			if (!pszPrimaryName || !*pszPrimaryName) {
				return nullptr;
			}

#if defined(_WIN32)
			HMODULE const hModule = GetModuleHandleA("tier0.dll");
			if (!hModule) {
				return nullptr;
			}

			FARPROC Function = GetProcAddress(hModule, pszPrimaryName);
			if (Function) {
				return reinterpret_cast<TFunction>(Function);
			}

#if defined(_WIN64)
			if (pszWindowsX64Name && *pszWindowsX64Name) {
				Function = GetProcAddress(hModule, pszWindowsX64Name);
			}
#else
			if (pszWindowsX86Name && *pszWindowsX86Name) {
				Function = GetProcAddress(hModule, pszWindowsX86Name);
			}
#endif

			return reinterpret_cast<TFunction>(Function);
#else
			void* pFunction = dlsym(RTLD_DEFAULT, pszPrimaryName);
			if (pFunction) {
				return reinterpret_cast<TFunction>(pFunction);
			}

			if (pszLinuxName && *pszLinuxName) {
				pFunction = dlsym(RTLD_DEFAULT, pszLinuxName);
			}

			return reinterpret_cast<TFunction>(pFunction);
#endif
		}

		ServerOutputLoggingFunctions ResolveServerOutputLoggingFunctions() noexcept {
			constexpr char const* const kPushLoggingStateWindowsName = std::is_invocable_v<fnLoggingSystemPushLoggingState, bool, bool> ? "?LoggingSystem_PushLoggingState@@YAX_N0@Z" : "?LoggingSystem_PushLoggingState@@YAX_N@Z";
			constexpr char const* const kPushLoggingStateLinuxName = std::is_invocable_v<fnLoggingSystemPushLoggingState, bool, bool> ? "_Z30LoggingSystem_PushLoggingStatebb" : "_Z30LoggingSystem_PushLoggingStateb";

			ServerOutputLoggingFunctions ServerOutputLoggingFunctionSet {};
			ServerOutputLoggingFunctionSet.m_RegisterLoggingListener = ResolveTier0Function<fnLoggingSystemRegisterLoggingListener>("LoggingSystem_RegisterLoggingListener", "?LoggingSystem_RegisterLoggingListener@@YAXPAVILoggingListener@@@Z", "?LoggingSystem_RegisterLoggingListener@@YAXPEAVILoggingListener@@@Z", "_Z37LoggingSystem_RegisterLoggingListenerP16ILoggingListener");
			ServerOutputLoggingFunctionSet.m_PushLoggingState = ResolveTier0Function<fnLoggingSystemPushLoggingState>("LoggingSystem_PushLoggingState", kPushLoggingStateWindowsName, kPushLoggingStateWindowsName, kPushLoggingStateLinuxName);
			ServerOutputLoggingFunctionSet.m_PopLoggingState = ResolveTier0Function<fnLoggingSystemPopLoggingState>("LoggingSystem_PopLoggingState", "?LoggingSystem_PopLoggingState@@YAX_N@Z", "?LoggingSystem_PopLoggingState@@YAX_N@Z", "_Z29LoggingSystem_PopLoggingStateb");
			ServerOutputLoggingFunctionSet.m_LogDirect = ResolveTier0Function<fnLoggingSystemLogDirect>("LoggingSystem_LogDirect", "?LoggingSystem_LogDirect@@YA?AW4LoggingResponse_t@@HW4LoggingSeverity_t@@VColor@@PBD@Z", "?LoggingSystem_LogDirect@@YA?AW4LoggingResponse_t@@HW4LoggingSeverity_t@@VColor@@PEBD@Z", "_Z23LoggingSystem_LogDirecti17LoggingSeverity_t5ColorPKc");

			return ServerOutputLoggingFunctionSet;
		}

		ServerOutputLoggingFunctions const& GetServerOutputLoggingFunctions() noexcept {
			static ServerOutputLoggingFunctions const s_ServerOutputLoggingFunctions = ResolveServerOutputLoggingFunctions();

			return s_ServerOutputLoggingFunctions;
		}

		std::string ConvertServerOutputMessage(tchar const* const pszMessage) {
			if (!pszMessage) {
				return "";
			}

#if defined(UNICODE) || defined(_UNICODE)
			std::string strMessage {};
			for (tchar const* pszCurrent = pszMessage; *pszCurrent; ++pszCurrent) {
				const wchar_t wchValue = static_cast<wchar_t>(*pszCurrent);
				strMessage.push_back((wchValue <= L'\x7F') ? static_cast<char>(wchValue) : '?');
			}

			return strMessage;
#else
			return pszMessage;
#endif
		}

		class ServerOutputLoggingListener : public ILoggingListener {
		public:
			constexpr ServerOutputLoggingListener() noexcept;

			void Log(LoggingContext_t const* const pContext, tchar const* const pszMessage) override;
			void SetEnabled(const bool bEnabled);

		private:
			void Dispatch(LoggingContext_t const* const pContext, tchar const* const pszMessage);
			void SetLoggingStatePushed(const bool bPushed);

			bool m_bEnabled;
			bool m_bDispatching;
			bool m_bStatePushed;
		};

		constexpr ServerOutputLoggingListener::ServerOutputLoggingListener() noexcept {
			m_bEnabled = false;
			m_bDispatching = false;
			m_bStatePushed = false;
		}

		void ServerOutputLoggingListener::Log(LoggingContext_t const* const pContext, tchar const* const pszMessage) {
			if (m_bDispatching) {
				return;
			}

			m_bDispatching = true;
			try {
				// Restore ordinary listeners before user code: its logging must not reenter JavaScript.
				SetLoggingStatePushed(false);
				Dispatch(pContext, pszMessage);
			} catch (...) {
				// Engine-backed logging can reenter this callback; use the non-recursive emergency sink.
				std::fputs(kServerOutputCallbackErrorMessage, stderr);
				std::fflush(stderr);
			}

			m_bDispatching = false;
			try {
				// Apply the final request even after callback failure or a change during ordinary logging.
				SetLoggingStatePushed(m_bEnabled);
			} catch (...) {
				std::fputs(kServerOutputCallbackErrorMessage, stderr);
				std::fflush(stderr);
			}
		}

		void ServerOutputLoggingListener::SetEnabled(const bool bEnabled) {
			m_bEnabled = bEnabled;
			if (!m_bDispatching) {
				SetLoggingStatePushed(bEnabled);
			}
		}

		void ServerOutputLoggingListener::Dispatch(LoggingContext_t const* const pContext, tchar const* const pszMessage) {
			std::string const strMessage = ConvertServerOutputMessage(pszMessage);
			const int nSeverity = pContext ? static_cast<int>(pContext->m_Severity) : 0;
			if (g_Application.EmitServerOutput(nSeverity, strMessage.c_str())) {
				return;
			}

			if (!pContext) {
				return;
			}

			ServerOutputLoggingFunctions const& ServerOutputLoggingFunctionSet = GetServerOutputLoggingFunctions();
			if (!ServerOutputLoggingFunctionSet.IsValid()) {
				return;
			}

			// Construct the by-value ABI argument without the SDK's deprecated implicit Color copy.
			ServerOutputLoggingFunctionSet.m_LogDirect(pContext->m_ChannelID, pContext->m_Severity, Color(pContext->m_Color.r(), pContext->m_Color.g(), pContext->m_Color.b(), pContext->m_Color.a()), strMessage.c_str());
		}

		void ServerOutputLoggingListener::SetLoggingStatePushed(const bool bPushed) {
			if (m_bStatePushed == bPushed) {
				return;
			}

			ServerOutputLoggingFunctions const& ServerOutputLoggingFunctionSet = GetServerOutputLoggingFunctions();
			if (!ServerOutputLoggingFunctionSet.IsValid()) {
				return;
			}

			if (bPushed) {
				PushServerOutputLoggingState(ServerOutputLoggingFunctionSet.m_PushLoggingState);
				m_bStatePushed = true;
				ServerOutputLoggingFunctionSet.m_RegisterLoggingListener(this);
				return;
			}

			ServerOutputLoggingFunctionSet.m_PopLoggingState(false);
			m_bStatePushed = false;
		}

		// The SDK retains this listener's address; constant initialization preserves process lifetime.
		constinit ServerOutputLoggingListener g_ServerOutputLoggingListener;
#endif

		std::filesystem::path ResolveGameRootPath(EngineInterfaces const& EngineInterfaceSet) {
			constexpr int kGameDirectoryBufferSize = 260;

			auto* const pEngine = EngineInterfaceSet.GetEngine();
			if (!pEngine) {
				return std::filesystem::current_path();
			}

			char szGameDirectory[kGameDirectoryBufferSize] {};
			pEngine->GetGameDir(szGameDirectory, kGameDirectoryBufferSize);

			if (!szGameDirectory[0]) {
				return std::filesystem::current_path();
			}

			return std::filesystem::path(szGameDirectory);
		}
	} // namespace

	// Engine callback singleton; dependencies are connected explicitly by Load().
	Application g_Application;

	Application::Application() {
		m_bLoaded = false;
		m_bPaused = false;
		m_bLevelInitialized = false;
		m_bServerOutputHooked = false;
	}

	bool Application::Load(CreateInterfaceFn const InterfaceFactory, CreateInterfaceFn const GameServerFactory) {
		if (m_bLoaded) {
			return true;
		}

		if (!InterfaceFactory || !GameServerFactory) {
			return false;
		}

		if (!m_EngineInterfaces.Connect(InterfaceFactory, GameServerFactory)) {
			return false;
		}

		m_RuntimePaths.Initialize(ResolveGameRootPath(m_EngineInterfaces));
		LogInfo("Load resolved game root Path=\"%s\"", m_RuntimePaths.GetGameRootPath().string().c_str());

		RefreshSourceModGameData(m_RuntimePaths.GetAddonRootPath() / "gamedata");

		if (!m_Runtime.Initialize(m_RuntimePaths)) {
			ClearCreatedConVarRegistrations();
			m_EngineInterfaces.Disconnect();
			return false;
		}

		m_HookManager.Initialize(&m_Runtime);
		m_MemoryHookManager.Initialize(&m_Runtime);
		SetSendPropertyGameThread(true);
		auto InvalidateExtensionModules = [](void* const pRuntime, std::string const& strExtensionName) {
			static_cast<V8Runtime*>(pRuntime)->InvalidateExtensionModules(strExtensionName);
		};
		m_ExtensionManager.Initialize(&m_RuntimePaths, m_Runtime.GetPlatform(), InvalidateExtensionModules, &m_Runtime);
		m_PluginManager.Initialize(&m_RuntimePaths, &m_Runtime);
		m_CommandDispatcher.Initialize(&m_PluginManager, &m_ExtensionManager, &m_ModuleRegistry, &m_Runtime);

		m_bLoaded = true;
		m_bPaused = false;

		LogInfo("Load succeeded.");

		try {
			m_Runtime.ExecuteString("require(\"core/update\").AnnounceAvailableUpdate();", "SourceJS startup update check");
		} catch (...) {
			LogWarning("SourceJS startup update check could not be started.");
		}

		return true;
	}

	void Application::Unload() {
		ClearDelayedEntityInputs();

		// A failed Load may own an initialized runtime before the final loaded flag.
		if (!m_bLoaded && !m_Runtime.IsInitialized()) {
			ClearCreatedConVarRegistrations();
			m_EngineInterfaces.Disconnect();
			m_bPaused = false;
			m_bLevelInitialized = false;
			return;
		}

		LogInfo("Unload started.");
		SetServerOutputHookEnabled(false);
		m_CommandDispatcher.Shutdown();
		m_PluginManager.Shutdown();
		m_ExtensionManager.Shutdown();
		if (!m_ExtensionManager.GetExtensions().empty()) {
			LogError("Unload failed: native extensions are still active; V8 runtime retained.");
			return;
		}

		m_MemoryHookManager.Shutdown();
		if (m_MemoryHookManager.IsInitialized()) {
			LogError("Unload failed: memory hooks remain initialized; V8 runtime retained.");
			return;
		}

		SetSendPropertyGameThread(false);
		m_HookManager.Shutdown();
		m_Runtime.Shutdown();
		ClearDelayedEntityInputs();
		ClearCreatedConVarRegistrations();
		m_EngineInterfaces.Disconnect();

		m_bLoaded = false;
		m_bPaused = false;
		m_bLevelInitialized = false;

		LogInfo("Unload succeeded.");
	}

	void Application::Pause() {
		m_bPaused = true;

		LogInfo("Pause succeeded.");
	}

	void Application::Unpause() {
		m_bPaused = false;

		LogInfo("Unpause succeeded.");
	}

	void Application::LevelInitialize(char const* const pszMapName) {
		if (!m_bLoaded || m_bPaused) {
			return;
		}

		ListenerPayloadBuilder LevelInitializePayloadBuilder {};
		LevelInitializePayloadBuilder.AddString(pszMapName ? pszMapName : "");

		m_bLevelInitialized = true;
		std::string const strLevelInitializePayload = LevelInitializePayloadBuilder.Build();
		m_HookManager.Emit("LevelInitialize", strLevelInitializePayload);
		m_HookManager.Emit("LevelInit", strLevelInitializePayload);
	}

	void Application::ServerActivate(const int nEdictCount, const int nMaximumClients) {
		if (!m_bLoaded || m_bPaused) {
			return;
		}

		std::vector<int> vecEdictIndices {};
		if (nEdictCount > 0) {
			vecEdictIndices.reserve(static_cast<std::size_t>(nEdictCount));

			for (int nEdictIndex = 0; nEdictIndex < nEdictCount; ++nEdictIndex) {
				vecEdictIndices.push_back(nEdictIndex);
			}
		}

		ListenerPayloadBuilder ServerActivatePayloadBuilder {};
		ServerActivatePayloadBuilder.AddIntegerArray(vecEdictIndices);
		ServerActivatePayloadBuilder.AddInteger(nEdictCount);
		ServerActivatePayloadBuilder.AddInteger(nMaximumClients);
		m_HookManager.Emit("ServerActivate", ServerActivatePayloadBuilder.Build());
	}

	void Application::GameFrame(const bool bSimulating) {
		if (!m_bLoaded || m_bPaused) {
			return;
		}

		m_Runtime.ProcessAsyncRequests();

		if (!bSimulating) {
			return;
		}

		ProcessDelayedEntityInputs();

		ListenerPayloadBuilder TickPayloadBuilder {};
		m_HookManager.Emit("Tick", TickPayloadBuilder.Build());
	}

	void Application::LevelShutdown() {
		if (!m_bLoaded || m_bPaused) {
			ClearDelayedEntityInputs();
			return;
		}

		ListenerPayloadBuilder LevelShutdownPayloadBuilder {};
		std::string const strLevelShutdownPayload = LevelShutdownPayloadBuilder.Build();
		m_HookManager.Emit("LevelShutdown", strLevelShutdownPayload);

		if (m_bLevelInitialized) {
			m_HookManager.Emit("LevelEnd", strLevelShutdownPayload);
			m_bLevelInitialized = false;
		}

		ClearDelayedEntityInputs();
	}

	bool Application::ClientConnect(const int nEntityIndex, char const* const pszPlayerName, char const* const pszAddress, char* const pszReject, const int nMaximumRejectLength) {
		if (!m_bLoaded || m_bPaused) {
			return true;
		}

		ListenerPayloadBuilder ClientConnectPayloadBuilder {};
		ClientConnectPayloadBuilder.AddInteger(nEntityIndex);
		ClientConnectPayloadBuilder.AddString(pszPlayerName ? pszPlayerName : "");
		ClientConnectPayloadBuilder.AddString(pszAddress ? pszAddress : "");
		ClientConnectPayloadBuilder.AddInteger(nMaximumRejectLength);

		std::string strRejectMessage {};
		const bool bConnectionAllowed = m_Runtime.IsEventEmissionAllowed("ClientConnect", ClientConnectPayloadBuilder.Build(), strRejectMessage);
		if (bConnectionAllowed) {
			return true;
		}

		if (pszReject && (nMaximumRejectLength > 0)) {
			std::string const strEffectiveRejectMessage = strRejectMessage.empty() ? "Connection rejected by SourceJS." : strRejectMessage;
			const int nFormattedLength = std::snprintf(pszReject, static_cast<std::size_t>(nMaximumRejectLength), "%s", strEffectiveRejectMessage.c_str());
			pszReject[nMaximumRejectLength - 1] = '\0';

			if (nFormattedLength < 0) {
				pszReject[0] = '\0';
			}
		}

		return false;
	}

	void Application::ClientActive(const int nEntityIndex) {
		if (!m_bLoaded || m_bPaused) {
			return;
		}

		ListenerPayloadBuilder ClientActivePayloadBuilder {};
		ClientActivePayloadBuilder.AddInteger(nEntityIndex);
		m_HookManager.Emit("ClientActive", ClientActivePayloadBuilder.Build());
	}

	void Application::ClientDisconnect(const int nEntityIndex) {
		if (!m_bLoaded || m_bPaused) {
			return;
		}

		ListenerPayloadBuilder ClientDisconnectPayloadBuilder {};
		ClientDisconnectPayloadBuilder.AddInteger(nEntityIndex);
		m_HookManager.Emit("ClientDisconnect", ClientDisconnectPayloadBuilder.Build());
	}

	void Application::ClientPutInServer(const int nEntityIndex, char const* const pszPlayerName) {
		if (!m_bLoaded || m_bPaused) {
			return;
		}

		ListenerPayloadBuilder ClientPutInServerPayloadBuilder {};
		ClientPutInServerPayloadBuilder.AddInteger(nEntityIndex);
		ClientPutInServerPayloadBuilder.AddString(pszPlayerName ? pszPlayerName : "");
		m_HookManager.Emit("ClientPutInServer", ClientPutInServerPayloadBuilder.Build());
	}

	void Application::ClientSettingsChanged(const int nEntityIndex) {
		if (!m_bLoaded || m_bPaused) {
			return;
		}

		ListenerPayloadBuilder ClientSettingsChangedPayloadBuilder {};
		ClientSettingsChangedPayloadBuilder.AddInteger(nEntityIndex);
		m_HookManager.Emit("ClientSettingsChanged", ClientSettingsChangedPayloadBuilder.Build());
	}

	void Application::ClientFullyConnect(const int nEntityIndex) {
		if (!m_bLoaded || m_bPaused) {
			return;
		}

		ListenerPayloadBuilder ClientFullyConnectPayloadBuilder {};
		ClientFullyConnectPayloadBuilder.AddInteger(nEntityIndex);
		m_HookManager.Emit("ClientFullyConnect", ClientFullyConnectPayloadBuilder.Build());
	}

	void Application::EdictAllocated(const int nEdictIndex) {
		if (!m_bLoaded || m_bPaused) {
			return;
		}

		ListenerPayloadBuilder EdictAllocatedPayloadBuilder {};
		EdictAllocatedPayloadBuilder.AddInteger(nEdictIndex);
		m_HookManager.Emit("EdictAllocated", EdictAllocatedPayloadBuilder.Build());
	}

	void Application::EdictFreed(void const* const pEdict) {
		if (!m_bLoaded || m_bPaused) {
			return;
		}

		ListenerPayloadBuilder EdictFreedPayloadBuilder {};
		EdictFreedPayloadBuilder.AddAddress(pEdict);
		m_HookManager.Emit("EdictFreed", EdictFreedPayloadBuilder.Build());
	}

	void Application::NetworkIDValidated(char const* const pszUserName, char const* const pszNetworkID) {
		if (!m_bLoaded || m_bPaused) {
			return;
		}

		ListenerPayloadBuilder NetworkIDValidatedPayloadBuilder {};
		NetworkIDValidatedPayloadBuilder.AddString(pszUserName ? pszUserName : "");
		NetworkIDValidatedPayloadBuilder.AddString(pszNetworkID ? pszNetworkID : "");
		m_HookManager.Emit("NetworkIDValidated", NetworkIDValidatedPayloadBuilder.Build());
	}

	void Application::QueryCVarValueFinished(const int nQueryCookie, const int nEntityIndex, const int nQueryStatus, char const* const pszCVarName, char const* const pszCVarValue) {
		if (!m_bLoaded || m_bPaused) {
			return;
		}

		ListenerPayloadBuilder QueryCVarValueFinishedPayloadBuilder {};
		QueryCVarValueFinishedPayloadBuilder.AddInteger(nQueryCookie);
		QueryCVarValueFinishedPayloadBuilder.AddInteger(nEntityIndex);
		QueryCVarValueFinishedPayloadBuilder.AddInteger(nQueryStatus);
		QueryCVarValueFinishedPayloadBuilder.AddString(pszCVarName ? pszCVarName : "");
		QueryCVarValueFinishedPayloadBuilder.AddString(pszCVarValue ? pszCVarValue : "");
		m_HookManager.Emit("QueryCVarValueFinished", QueryCVarValueFinishedPayloadBuilder.Build());
	}

	void Application::SetServerOutputHookEnabled(const bool bEnabled) {
		if (m_bServerOutputHooked == bEnabled) {
			return;
		}

#if SOURCEJS_HAS_TIER0_LOGGING
		ServerOutputLoggingFunctions const& ServerOutputLoggingFunctionSet = GetServerOutputLoggingFunctions();
		if (!ServerOutputLoggingFunctionSet.IsValid()) {
			m_bServerOutputHooked = false;
			return;
		}

		g_ServerOutputLoggingListener.SetEnabled(bEnabled);
		m_bServerOutputHooked = bEnabled;
#else
		m_bServerOutputHooked = false;
#endif
#undef SOURCEJS_HAS_TIER0_LOGGING
	}

	bool Application::EmitServerOutput(const int nSeverity, char const* const pszMessage) {
		constexpr int kDefaultResult = 1;
		constexpr int kBlockResult = 0;

		if (!m_bLoaded || !m_Runtime.IsInitialized()) {
			return false;
		}

		ListenerPayloadBuilder ServerOutputPayloadBuilder {};
		ServerOutputPayloadBuilder.AddInteger(nSeverity);
		ServerOutputPayloadBuilder.AddString(pszMessage ? pszMessage : "");

		return m_Runtime.EmitEventResult("ServerOutput", ServerOutputPayloadBuilder.Build(), kDefaultResult, kBlockResult) == kBlockResult;
	}

	bool Application::IsLoaded() const noexcept {
		return m_bLoaded;
	}

	CommandDispatcher& Application::GetCommandDispatcher() noexcept {
		return m_CommandDispatcher;
	}

	EngineInterfaces& Application::GetEngineInterfaces() noexcept {
		return m_EngineInterfaces;
	}

	ExtensionManager& Application::GetExtensionManager() noexcept {
		return m_ExtensionManager;
	}

	HookManager& Application::GetHookManager() noexcept {
		return m_HookManager;
	}

	MemoryHookManager& Application::GetMemoryHookManager() noexcept {
		return m_MemoryHookManager;
	}

	ModuleRegistry& Application::GetModuleRegistry() noexcept {
		return m_ModuleRegistry;
	}

	PluginManager& Application::GetPluginManager() noexcept {
		return m_PluginManager;
	}

	RuntimePaths& Application::GetRuntimePaths() noexcept {
		return m_RuntimePaths;
	}

	V8Runtime& Application::GetRuntime() noexcept {
		return m_Runtime;
	}
} // namespace SourceJS
