
// C++
#include <cstdarg>
#include <cstddef>
#include <cstdio>
#include <cstring>
#include <utility>

// STL
#include <array>
#include <exception>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

// Narrow engine-boundary doubles; not the real SDK or complete plugin class.
// These state aggregates are value-initialized at their use sites.
struct edict_t {
	int m_nIndex;
};

// Selected CSGO/TF2 SDK callback values; the fixture does not assert SDK layout.
typedef enum _PLUGIN_RESULT : int {
	PLUGIN_CONTINUE = 0,
	PLUGIN_OVERRIDE,
	PLUGIN_STOP
} PLUGIN_RESULT, *PPLUGIN_RESULT;

constexpr int FCVAR_GAMEDLL = 0x01;

struct CCommand {
	int ArgC() const {
		return 2;
	}

	char const* ArgS() const {
		return "@admins";
	}
};

struct ConCommand {
	bool IsCommand() const {
		return true;
	}

	bool IsFlagSet(int) const {
		return true;
	}

	void** m_ppVTable;
};

namespace Detours::Hook {
	class VTableFunctionHook {
	public:
		VTableFunctionHook();

		bool Set(void** const ppVTable, const std::size_t unSlot) {
			m_ppSlot = &ppVTable[unSlot];
			m_pOriginal = *m_ppSlot;

			return true;
		}

		bool Hook(void* const pCallback) {
			*m_ppSlot = pCallback;

			return true;
		}

		bool Release() {
			*m_ppSlot = m_pOriginal;
			m_ppSlot = nullptr;
			m_pOriginal = nullptr;

			return true;
		}

		void* GetOriginal() const {
			return m_pOriginal;
		}

	private:
		void** m_ppSlot;
		void* m_pOriginal;
	};

	VTableFunctionHook::VTableFunctionHook() {
		m_ppSlot = nullptr;
		m_pOriginal = nullptr;
	}
} // namespace Detours::Hook

namespace SourceJS {
	constexpr std::size_t kDiagnosticCapacity = 512;
	constexpr int kUnknownExceptionValue = 7;

	struct TestEngine {
		bool IsDedicatedServer() const;

		bool m_bDedicated;
	};

	struct EngineInterfaces {
		TestEngine* GetEngine() const;
		int GetEdictIndex(edict_t* const pEntity) const;
		ConCommand* FindCommandBase(char const* const pszName) const;

		TestEngine* m_pEngine;
		ConCommand* m_pSay;
		ConCommand* m_pTeamSay;
		ConCommand* m_pSquadSay;
	};

	struct TestApplication {
		EngineInterfaces& GetEngineInterfaces();
		TestApplication& GetCommandDispatcher();
		TestApplication& GetRuntime();
		void DispatchClient(const int nClientIndex, std::vector<std::string> const&);
		void Dispatch(std::vector<std::string> const&);
		bool DispatchClientCommand(const int nClientIndex, std::vector<std::string> const&);
		bool DispatchSayCommand(const int nClientIndex, std::string const& strText, const bool bTeamOnly);
		bool OwnsRegisteredCommand(std::string const& strName) const;
		bool ClientConnect(const int nClientIndex, char const*, char const*, char* const pszRejectOut, const int nMaximumRejectLength);

		EngineInterfaces m_EngineInterfaces;
		bool m_bAllowConnection;
		bool m_bThrowStandardException;
		bool m_bThrowUnknownException;
		int m_nLastClientIndex;
		int m_nClientDispatches;
		int m_nServerDispatches;
		int m_nChatDispatches;
		bool m_bLastChatTeamOnly;
		bool m_bBlockChat;
	};

	char g_szLastError[kDiagnosticCapacity] {};
	constinit TestApplication g_Application {};

	void LogError(char const* const pszFormat, ...) noexcept {
		std::va_list ArgumentList;
		va_start(ArgumentList, pszFormat);
		std::vsnprintf(g_szLastError, kDiagnosticCapacity, pszFormat, ArgumentList);
		va_end(ArgumentList);
	}

	void LogWarning(char const*, ...) noexcept {
	}

	void LogInfo(char const*, ...) noexcept {
	}

	int ResolveConCommandDispatchIndex() noexcept {
		return 0;
	}

	bool TestEngine::IsDedicatedServer() const {
		return m_bDedicated;
	}

	TestEngine* EngineInterfaces::GetEngine() const {
		return m_pEngine;
	}

	int EngineInterfaces::GetEdictIndex(edict_t* const pEntity) const {
		return pEntity->m_nIndex;
	}

	ConCommand* EngineInterfaces::FindCommandBase(char const* const pszName) const {
		if (std::strcmp(pszName, "say") == 0) {
			return m_pSay;
		}

		if (std::strcmp(pszName, "say_team") == 0) {
			return m_pTeamSay;
		}

		return m_pSquadSay;
	}

	EngineInterfaces& TestApplication::GetEngineInterfaces() {
		return m_EngineInterfaces;
	}

	TestApplication& TestApplication::GetCommandDispatcher() {
		return *this;
	}

	TestApplication& TestApplication::GetRuntime() {
		return *this;
	}

	void TestApplication::DispatchClient(const int nClientIndex, std::vector<std::string> const&) {
		m_nLastClientIndex = nClientIndex;
		++m_nClientDispatches;
	}

	void TestApplication::Dispatch(std::vector<std::string> const&) {
		++m_nServerDispatches;
	}

	bool TestApplication::DispatchClientCommand(const int nClientIndex, std::vector<std::string> const& vecArguments) {
		DispatchClient(nClientIndex, vecArguments);

		return false;
	}

	bool TestApplication::DispatchSayCommand(const int, std::string const&, const bool bTeamOnly) {
		++m_nChatDispatches;
		m_bLastChatTeamOnly = bTeamOnly;

		return m_bBlockChat;
	}

	bool TestApplication::OwnsRegisteredCommand(std::string const& strName) const {
		return strName == "sjs_owned";
	}

	bool TestApplication::ClientConnect(const int nClientIndex, char const*, char const*, char* const pszRejectOut, const int nMaximumRejectLength) {
		m_nLastClientIndex = nClientIndex;

		if (m_bThrowStandardException) {
			throw std::runtime_error("expected connection failure");
		}

		if (m_bThrowUnknownException) {
			throw kUnknownExceptionValue;
		}

		if (!m_bAllowConnection && pszRejectOut && (nMaximumRejectLength > 0)) {
			pszRejectOut[0] = '\0';
		}

		return m_bAllowConnection;
	}
} // namespace SourceJS

class CSourceJSPlugin {
public:
	CSourceJSPlugin();

	void SetCommandClient(const int nClientIndex);
	int GetCommandClient() const noexcept;
	PLUGIN_RESULT ClientConnect(bool* const pbAllowConnectOut, edict_t* const pEntity, char const* const pszName, char const* const pszAddress, char* const pszRejectOut, const int nMaximumRejectLength);

private:
	int m_nCommandClientSlot;
};

CSourceJSPlugin::CSourceJSPlugin() {
	m_nCommandClientSlot = -1;
}

CSourceJSPlugin g_SourceJSPlugin;

namespace {
	int g_nOriginalSayCalls = 0;

	std::string JoinCommandArguments(std::vector<std::string> const& vecArguments, const std::size_t unStart) {
		return vecArguments.at(unStart);
	}

#if defined(_MSC_VER) && defined(_M_IX86)
	struct OriginalSayDispatcher {
		void Dispatch(CCommand const&) {
			++g_nOriginalSayCalls;
		}
	};

	void* GetOriginalSayAddress() {
		using fnOriginalSayDispatch = void(OriginalSayDispatcher::*)(CCommand const&);

		const fnOriginalSayDispatch Dispatch = &OriginalSayDispatcher::Dispatch;
		void* pAddress = nullptr;

		static_assert(sizeof(Dispatch) == sizeof(pAddress));

		std::memcpy(&pAddress, &Dispatch, sizeof(pAddress));

		return pAddress;
	}

	void CallSayDispatch(ConCommand& Say, CCommand const& Command) {
		using fnDispatch = void(__fastcall*)(ConCommand*, void*, CCommand const&);
		reinterpret_cast<fnDispatch>(Say.m_ppVTable[0])(&Say, nullptr, Command);
	}
#else
	void OriginalSayDispatch(ConCommand*, CCommand const&) {
		++g_nOriginalSayCalls;
	}

	void* GetOriginalSayAddress() {
		return reinterpret_cast<void*>(&OriginalSayDispatch);
	}

	void CallSayDispatch(ConCommand& Say, CCommand const& Command) {
		using fnDispatch = void(*)(ConCommand*, CCommand const&);
		reinterpret_cast<fnDispatch>(Say.m_ppVTable[0])(&Say, Command);
	}
#endif
} // namespace

// Generated included-only fragment: actual method definitions require the preceding doubles.
#include "SourceJSListenClientMethods.h"

namespace {
	struct ClientIndexCase {
		int m_nInput;
		int m_nExpected;
	};

	void Require(const bool bCondition, char const* const pszMessage) {
		if (!bCondition) {
			throw std::runtime_error(pszMessage);
		}
	}
} // namespace

int main() {
	constexpr int kClientEntityIndex = 42;
	constexpr std::size_t kRejectStorageByteCount = 3;
	constexpr ClientIndexCase kClientIndexCases[] = {
		{ std::numeric_limits<int>::min(), 0 },
		{ -1, 0 },
		{ 0, 1 },
		{ 1, 2 },
		{ 63, 64 },
		{ std::numeric_limits<int>::max() - 1, std::numeric_limits<int>::max() },
		{ std::numeric_limits<int>::max(), 0 },
	};

	try {
		std::size_t unCallbackCallCount = 0;
		Require(InvokeEngineCallback("Fixture.Success", [&unCallbackCallCount]() {
			++unCallbackCallCount;
		}), "successful callback returns success");
		Require(unCallbackCallCount == 1, "successful callback runs exactly once");
		Require(InvokeEngineCallback("Fixture.StandardException", []() {
			throw std::runtime_error("expected callback failure");
		}) == false, "standard callback exception is contained");
		Require(std::strstr(SourceJS::g_szLastError, "Fixture.StandardException failed: C++ exception: expected callback failure") != nullptr, "standard callback diagnostic preserves context");
		Require(InvokeEngineCallback("Fixture.UnknownException", []() {
			throw SourceJS::kUnknownExceptionValue;
		}) == false, "unknown callback exception is contained");
		Require(std::strstr(SourceJS::g_szLastError, "Fixture.UnknownException failed: unknown C++ exception.") != nullptr, "unknown callback diagnostic preserves context");

		CSourceJSPlugin Plugin {};
		Plugin.SetCommandClient(0);
		Require(Plugin.GetCommandClient() == 1, "explicit client index does not need an engine lookup");

		SourceJS::TestEngine Engine {};
		SourceJS::g_Application.m_EngineInterfaces.m_pEngine = &Engine;
		for (auto const& TestCase : kClientIndexCases) {
			Plugin.SetCommandClient(TestCase.m_nInput);
			Require(Plugin.GetCommandClient() == TestCase.m_nExpected, "client index boundary");
		}

		Engine.m_bDedicated = true;
		Plugin.SetCommandClient(0);
		Require(Plugin.GetCommandClient() == 1, "dedicated engine preserves the client index");
		Plugin.SetCommandClient(-1);
		Require(Plugin.GetCommandClient() == 0, "engine console resets the client index");
		SourceJS::g_Application.m_EngineInterfaces.m_pEngine = nullptr;

		SourceJS::g_Application.m_bAllowConnection = true;
		SourceJS::g_Application.m_bBlockChat = true;
		edict_t ClientEntity { kClientEntityIndex };
		Require(HandleClientCommand(&ClientEntity, { "sjs_owned" }) == PLUGIN_STOP, "owned command cannot reach a second native dispatch");
		Require(HandleClientCommand(&ClientEntity, { "say_team", "message" }) == PLUGIN_STOP, "SDK callback blocks team chat when no native hook is installed");
		Require(SourceJS::g_Application.m_bLastChatTeamOnly, "team chat is classified as non-public");
		Require(HandleClientCommand(&ClientEntity, { "say_squad", "@admins" }) == PLUGIN_STOP, "SDK callback can block squad chat");
		Require(SourceJS::g_Application.m_bLastChatTeamOnly, "squad chat is classified as non-public");

		SourceJS::g_Application.m_bBlockChat = false;
		Require(HandleClientCommand(&ClientEntity, { "say_squad", "ordinary" }) == PLUGIN_CONTINUE, "unblocked squad chat reaches the engine");
		Require(HandleClientCommand(&ClientEntity, { "say", "ordinary" }) == PLUGIN_CONTINUE, "unblocked global chat reaches the engine");
		Require(!SourceJS::g_Application.m_bLastChatTeamOnly, "global chat is not classified as team chat");
		Require(HandleClientCommand(&ClientEntity, { "ordinary" }) == PLUGIN_CONTINUE, "unowned command may reach the engine");
		Require((SourceJS::g_Application.m_nClientDispatches == 6) && (SourceJS::g_Application.m_nChatDispatches == 4), "each incoming command is evaluated once");

		g_SourceJSPlugin.SetCommandClient(0);
		DispatchSourceJSCommand({ "sjs", "auth" });
		Require((SourceJS::g_Application.m_nLastClientIndex == 1) && (SourceJS::g_Application.m_nClientDispatches == 7) && (SourceJS::g_Application.m_nServerDispatches == 0), "client cannot enter the server command dispatcher");
		g_SourceJSPlugin.SetCommandClient(-1);
		DispatchSourceJSCommand({ "sjs", "auth" });
		Require(SourceJS::g_Application.m_nServerDispatches == 1, "console source reaches the server command dispatcher");

		void* const pOriginal = GetOriginalSayAddress();
		void* arrGlobalVTable[] = { pOriginal };
		void* arrTeamVTable[] = { pOriginal };
		ConCommand GlobalSay { arrGlobalVTable };
		ConCommand TeamSay { arrTeamVTable };
		ConCommand SquadSay { arrTeamVTable };
		ConCommand OtherCommand { arrTeamVTable };
		SourceJS::EngineInterfaces& Interfaces = SourceJS::g_Application.m_EngineInterfaces;
		Interfaces.m_pSay = &GlobalSay;
		Interfaces.m_pTeamSay = &TeamSay;
		Interfaces.m_pSquadSay = &SquadSay;

		InstallSayDispatch();
		SayDispatchRecord const& SquadRecord = GetSayDispatchRecords()[kSquadSayCommandIndex];
		Require((SquadRecord.m_pCommand == &SquadSay) && !SquadRecord.m_ppVTable, "squad command shares the team hook without patching twice");

		const int nBeforeNativeChat = SourceJS::g_Application.m_nChatDispatches;
		Require(HandleClientCommand(&ClientEntity, { "say_squad", "@admins" }) == PLUGIN_CONTINUE, "SDK callback defers to the installed squad hook");
		Require(SourceJS::g_Application.m_nChatDispatches == nBeforeNativeChat, "SDK callback does not pre-dispatch hooked squad chat");
		g_SourceJSPlugin.SetCommandClient(0);
		CCommand const Command {};
		SourceJS::g_Application.m_bBlockChat = true;
		CallSayDispatch(SquadSay, Command);
		Require((SourceJS::g_Application.m_nChatDispatches == (nBeforeNativeChat + 1)) && SourceJS::g_Application.m_bLastChatTeamOnly && (g_nOriginalSayCalls == 0), "shared hook blocks squad chat once and does not leak it to the engine");
		CallSayDispatch(OtherCommand, Command);
		Require((SourceJS::g_Application.m_nChatDispatches == (nBeforeNativeChat + 1)) && (g_nOriginalSayCalls == 1), "unrelated commands sharing the vtable use only the original");
		SourceJS::g_Application.m_bBlockChat = false;
		CallSayDispatch(SquadSay, Command);
		Require((SourceJS::g_Application.m_nChatDispatches == (nBeforeNativeChat + 2)) && (g_nOriginalSayCalls == 2), "unblocked squad chat calls the original once");

		UninstallSayDispatch();
		Require((arrGlobalVTable[0] == pOriginal) && (arrTeamVTable[0] == pOriginal), "uninstall restores each unique vtable");
		g_SourceJSPlugin.SetCommandClient(-1);

		bool bAllowConnection = false;
		char arrRejectBytes[kRejectStorageByteCount] { 'A', 'B', 'C' };
		Require(Plugin.ClientConnect(&bAllowConnection, &ClientEntity, "Player", "Address", &arrRejectBytes[1], 1) == PLUGIN_CONTINUE, "successful connection result preserved");
		Require(bAllowConnection && (SourceJS::g_Application.m_nLastClientIndex == kClientEntityIndex) && (arrRejectBytes[1] == 'B'), "successful connection outputs preserved");
		ClientEntity.m_nIndex = -1;
		Require(Plugin.ClientConnect(&bAllowConnection, &ClientEntity, "Player", "Address", nullptr, 0) == PLUGIN_CONTINUE, "negative entity index retains successful result");
		Require(SourceJS::g_Application.m_nLastClientIndex == 0, "negative entity index normalizes to server console");

		SourceJS::g_Application.m_bAllowConnection = false;
		bAllowConnection = true;
		Require(Plugin.ClientConnect(&bAllowConnection, nullptr, "Player", "Address", nullptr, 0) == PLUGIN_STOP, "connection veto result preserved");
		Require(!bAllowConnection && (SourceJS::g_Application.m_nLastClientIndex == 0), "connection veto output and null entity preserved");

		SourceJS::g_Application.m_bThrowStandardException = true;
		bAllowConnection = true;
		Require(Plugin.ClientConnect(&bAllowConnection, &ClientEntity, "Player", "Address", &arrRejectBytes[1], 1) == PLUGIN_STOP, "standard exception rejects connection");
		Require(!bAllowConnection && (arrRejectBytes[0] == 'A') && (arrRejectBytes[1] == '\0') && (arrRejectBytes[2] == 'C'), "exception output stays within one-byte capacity");
		Require(std::strstr(SourceJS::g_szLastError, "SourceJSPlugin.ClientConnect failed: C++ exception: expected connection failure") != nullptr, "connection failure diagnostic");

		arrRejectBytes[1] = 'B';
		Require(Plugin.ClientConnect(nullptr, nullptr, "Player", "Address", &arrRejectBytes[1], 0) == PLUGIN_STOP, "null allow output and zero capacity accepted on failure");
		Require(arrRejectBytes[1] == 'B', "zero capacity does not write rejection output");
		Require(Plugin.ClientConnect(nullptr, nullptr, "Player", "Address", &arrRejectBytes[1], -1) == PLUGIN_STOP, "negative capacity accepted on failure");
		Require(arrRejectBytes[1] == 'B', "negative capacity does not write rejection output");

		SourceJS::g_Application.m_bThrowStandardException = false;
		SourceJS::g_Application.m_bThrowUnknownException = true;
		bAllowConnection = true;
		Require(Plugin.ClientConnect(&bAllowConnection, nullptr, "Player", "Address", nullptr, 0) == PLUGIN_STOP, "unknown exception rejects connection");
		Require(!bAllowConnection, "unknown exception commits rejected output");
		SourceJS::g_Application.m_bThrowUnknownException = false;

		std::puts("SourceJS listen-client and callback-boundary contracts passed (extracted definitions; doubles).");

		return 0;
	} catch (std::exception const& Exception) {
		SourceJS::g_Application.m_EngineInterfaces.m_pEngine = nullptr;
		std::fprintf(stderr, "SourceJS listen-client contract failed: %s\n", Exception.what());
		return 1;
	}
}
