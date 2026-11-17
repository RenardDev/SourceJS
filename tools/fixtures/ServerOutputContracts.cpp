
// C++
#include <cstddef>
#include <cstdio>

// STL
#include <exception>
#include <stdexcept>
#include <string>
#include <type_traits>

// Template fixture, not standalone: compile through tools/smoke_server_output_native_contracts.js.
// The runner inserts production logging code at the unique markers below.
// SDK doubles retain exact SDK type/member spellings; these are not ABI-layout tests.
#if defined(UNICODE)
using tchar = wchar_t;
#else
using tchar = char;
#endif
using LoggingChannelID_t = int;
using LoggingResponse_t = int;
using LoggingSeverity_t = int;

constexpr LoggingChannelID_t kLoggingChannelID = 3;
constexpr LoggingSeverity_t kLoggingSeverity = 2;

class Color {
public:
	Color(const int nRed, const int nGreen, const int nBlue, const int nAlpha);

	int r() const noexcept {
		return m_nRed;
	}

	int g() const noexcept {
		return m_nGreen;
	}

	int b() const noexcept {
		return m_nBlue;
	}

	int a() const noexcept {
		return m_nAlpha;
	}

private:
	int m_nRed;
	int m_nGreen;
	int m_nBlue;
	int m_nAlpha;
};

Color::Color(const int nRed, const int nGreen, const int nBlue, const int nAlpha) :
	m_nRed(nRed),
	m_nGreen(nGreen),
	m_nBlue(nBlue),
	m_nAlpha(nAlpha)
{
}

struct LoggingContext_t {
	LoggingChannelID_t m_ChannelID;
	LoggingSeverity_t m_Severity;
	Color m_Color;
};

class ILoggingListener {
public:
	virtual void Log(LoggingContext_t const* pContext, tchar const* pszMessage) = 0;
};

enum class HookChange : unsigned char {
	NONE = 0,
	DISABLE,
	REPLACE
};

class ApplicationDouble {
public:
	ApplicationDouble();

	void SetServerOutputHookEnabled(const bool bEnabled);
	bool EmitServerOutput(const int nSeverity, char const* const pszMessage);

	bool m_bServerOutputHooked;
	bool m_bBlock;
	bool m_bThrowStandard;
	bool m_bThrowUnknown;
	bool m_bReenter;
	HookChange m_Change;
	int m_nSeverity;
	std::string m_strMessage;
	std::size_t m_unEmitCount;
};

ApplicationDouble::ApplicationDouble() {
	m_bServerOutputHooked = false;
	m_bBlock = false;
	m_bThrowStandard = false;
	m_bThrowUnknown = false;
	m_bReenter = false;
	m_Change = HookChange::NONE;
	m_nSeverity = 0;
	m_unEmitCount = 0;
}

// Single-translation-unit double for the exported engine callback singleton.
// Constructed here before the injected callback; no cross-TU initialization dependency.
ApplicationDouble g_Application;

struct LoggingState {
	LoggingState();

	std::size_t m_unDepth;
	std::size_t m_unPushCount;
	std::size_t m_unPopCount;
	std::size_t m_unRegisterCount;
	std::size_t m_unForwardCount;
	ILoggingListener* m_pListener;
	HookChange m_ChangeOnDirect;
	bool m_bThrowOnDirect;
};

LoggingState::LoggingState() {
	m_unDepth = 0;
	m_unPushCount = 0;
	m_unPopCount = 0;
	m_unRegisterCount = 0;
	m_unForwardCount = 0;
	m_pListener = nullptr;
	m_ChangeOnDirect = HookChange::NONE;
	m_bThrowOnDirect = false;
}

LoggingState& GetLoggingState() {
	static LoggingState s_State {};

	return s_State;
}

void Require(const bool bCondition, char const* const pszMessage) {
	if (!bCondition) {
		throw std::runtime_error(pszMessage);
	}
}

void ChangeHook(const HookChange Change) {
	if (Change != HookChange::NONE) {
		g_Application.SetServerOutputHookEnabled(false);
	}

	if (Change == HookChange::REPLACE) {
		g_Application.SetServerOutputHookEnabled(true);
	}
}

void PopLoggingState(const bool bThreadLocal) {
	LoggingState& State = GetLoggingState();
	Require(!bThreadLocal && (State.m_unDepth == 1), "pop order/underflow");
	State.m_unDepth = 0;
	State.m_pListener = nullptr;
	++State.m_unPopCount;
}

LoggingResponse_t LogDirect(const LoggingChannelID_t nChannelID, const LoggingSeverity_t nSeverity, Color ColorValue, char const* const pszMessage) {
	LoggingState& State = GetLoggingState();
	Require((State.m_unDepth == 0) && (nChannelID == kLoggingChannelID) && (nSeverity == kLoggingSeverity), "direct arguments/order");
	Require((ColorValue.r() == 1) && (ColorValue.g() == 2) && (ColorValue.b() == 3) && (ColorValue.a() == 4), "direct color");
	Require(std::string(pszMessage) == "message", "direct message");
	++State.m_unForwardCount;
	ChangeHook(State.m_ChangeOnDirect);
	Require(State.m_unDepth == 0, "hook changes deferred during ordinary logging");

	if (State.m_bThrowOnDirect) {
		throw std::runtime_error("fixture ordinary listener failure");
	}

	return 0;
}

#if defined(SOURCEJS_TEST_CLEAR_STATE)
void LoggingSystem_PushLoggingState(const bool bThreadLocal, const bool bClearState) {
#else
void LoggingSystem_PushLoggingState(const bool bThreadLocal) {
#endif
#if defined(SOURCEJS_TEST_CLEAR_STATE)
	Require(bClearState, "push clear-state");
#endif
	LoggingState& State = GetLoggingState();
	Require(!bThreadLocal && (State.m_unDepth == 0), "push order");
	State.m_unDepth = 1;
	++State.m_unPushCount;
}

void RegisterLoggingListener(ILoggingListener* const pListener) {
	LoggingState& State = GetLoggingState();
	Require(pListener && (State.m_unDepth == 1) && !State.m_pListener, "register order");
	State.m_pListener = pListener;
	++State.m_unRegisterCount;
}

// SOURCEJS_SERVER_OUTPUT_FUNCTIONS

ServerOutputLoggingFunctions& GetServerOutputLoggingFunctions() {
	static ServerOutputLoggingFunctions s_Functions {};

	return s_Functions;
}

// SOURCEJS_SERVER_OUTPUT_CALLBACK

// SOURCEJS_SERVER_OUTPUT_SETTER

bool ApplicationDouble::EmitServerOutput(const int nSeverity, char const* const pszMessage) {
	Require(GetLoggingState().m_unDepth == 0, "user callback runs outside the intercepted state");
	++m_unEmitCount;
	ChangeHook(m_Change);
	Require(GetLoggingState().m_unDepth == 0, "hook changes deferred during user callback");

	if (m_bReenter) {
		m_bReenter = false;
		LoggingContext_t Context { kLoggingChannelID, kLoggingSeverity, Color(1, 2, 3, 4) };
#if defined(UNICODE)
		g_ServerOutputLoggingListener.Log(&Context, L"message");
#else
		g_ServerOutputLoggingListener.Log(&Context, "message");
#endif
	}

	if (m_bThrowStandard) {
		throw std::runtime_error("fixture dispatch failure");
	}

	if (m_bThrowUnknown) {
		throw 1;
	}

	m_nSeverity = nSeverity;
	m_strMessage = pszMessage;

	return m_bBlock;
}

void CheckHookState(const bool bEnabled) {
	const std::size_t unExpectedDepth = bEnabled ? 1 : 0;
	LoggingState const& State = GetLoggingState();
	Require(g_Application.m_bServerOutputHooked == bEnabled, "requested hook state");
	Require(State.m_unDepth == unExpectedDepth, "effective hook depth");
	Require(State.m_pListener == (bEnabled ? &g_ServerOutputLoggingListener : nullptr), "effective listener");
	Require(State.m_unPushCount == (State.m_unPopCount + unExpectedDepth), "balanced state stack");
	Require(State.m_unRegisterCount == State.m_unPushCount, "each pushed state registered exactly once");
}

int main(const int nArgumentCount, char**) {
	constexpr int kRequiredArgumentCount = 1;
	constexpr int kInvalidArgumentExitCode = 2;

	if (nArgumentCount != kRequiredArgumentCount) {
		std::fprintf(stderr, "Usage: ServerOutputContracts\n");
		return kInvalidArgumentExitCode;
	}

	try {
		ServerOutputLoggingFunctions Functions {};
		Require(!Functions.IsValid(), "default function state");

		LoggingContext_t Context { kLoggingChannelID, kLoggingSeverity, Color(1, 2, 3, 4) };
#if defined(UNICODE)
		tchar const* const pszMessage = L"message";
		Require(ConvertServerOutputMessage(L"A\x80") == "A?", "wide conversion");
#else
		tchar const* const pszMessage = "message";
#endif
		Require(ConvertServerOutputMessage(nullptr).empty(), "null conversion");
		g_ServerOutputLoggingListener.Log(&Context, pszMessage);
		Require((g_Application.m_nSeverity == kLoggingSeverity) && (g_Application.m_strMessage == "message"), "dispatch arguments");
		Require(GetLoggingState().m_unForwardCount == 0, "unavailable functions");
		CheckHookState(false);

		ServerOutputLoggingFunctions& FunctionSet = GetServerOutputLoggingFunctions();
		FunctionSet.m_PopLoggingState = PopLoggingState;
		FunctionSet.m_PushLoggingState = LoggingSystem_PushLoggingState;
		FunctionSet.m_RegisterLoggingListener = RegisterLoggingListener;
		Require(!FunctionSet.IsValid(), "incomplete function state");
		FunctionSet.m_LogDirect = LogDirect;
		Require(FunctionSet.IsValid(), "complete function state");

		g_Application.SetServerOutputHookEnabled(true);
		g_Application.SetServerOutputHookEnabled(true);
		Require(GetLoggingState().m_unPushCount == 1, "idempotent activation");
		CheckHookState(true);

		g_Application.m_bBlock = true;
		g_ServerOutputLoggingListener.Log(&Context, pszMessage);
		Require(GetLoggingState().m_unForwardCount == 0, "blocked output");
		CheckHookState(true);

		g_Application.m_bBlock = false;
		g_ServerOutputLoggingListener.Log(nullptr, pszMessage);
		Require((g_Application.m_nSeverity == 0) && (GetLoggingState().m_unForwardCount == 0), "null context");
		CheckHookState(true);

		bool bEscaped = false;
		g_Application.m_bThrowStandard = true;
		try {
			g_ServerOutputLoggingListener.Log(&Context, pszMessage);
		} catch (...) {
			bEscaped = true;
		}

		Require(!bEscaped && (GetLoggingState().m_unForwardCount == 0), "standard exception containment");
		CheckHookState(true);

		g_Application.m_bThrowStandard = false;
		g_Application.m_bThrowUnknown = true;
		try {
			g_ServerOutputLoggingListener.Log(&Context, pszMessage);
		} catch (...) {
			bEscaped = true;
		}

		Require(!bEscaped && (GetLoggingState().m_unForwardCount == 0), "unknown exception containment");
		CheckHookState(true);

		g_Application.m_bThrowUnknown = false;
		g_ServerOutputLoggingListener.Log(&Context, pszMessage);
		Require(GetLoggingState().m_unForwardCount == 1, "forwarding");
		CheckHookState(true);

		g_Application.m_Change = HookChange::DISABLE;
		g_ServerOutputLoggingListener.Log(&Context, pszMessage);
		Require(GetLoggingState().m_unForwardCount == 2, "self-removal still forwards");
		CheckHookState(false);

		g_Application.SetServerOutputHookEnabled(true);
		g_Application.m_Change = HookChange::REPLACE;
		g_ServerOutputLoggingListener.Log(&Context, pszMessage);
		Require(GetLoggingState().m_unForwardCount == 3, "replacement still forwards");
		CheckHookState(true);

		g_Application.m_Change = HookChange::DISABLE;
		g_Application.m_bBlock = true;
		g_ServerOutputLoggingListener.Log(&Context, pszMessage);
		Require(GetLoggingState().m_unForwardCount == 3, "self-removal with blocked output");
		CheckHookState(false);

		g_Application.SetServerOutputHookEnabled(true);
		g_Application.m_bThrowStandard = true;
		g_ServerOutputLoggingListener.Log(&Context, pszMessage);
		Require(GetLoggingState().m_unForwardCount == 3, "self-removal with exception");
		CheckHookState(false);

		g_Application.SetServerOutputHookEnabled(true);
		g_Application.m_bThrowStandard = false;
		g_Application.m_bBlock = false;
		g_Application.m_Change = HookChange::NONE;
		GetLoggingState().m_ChangeOnDirect = HookChange::DISABLE;
		g_ServerOutputLoggingListener.Log(&Context, pszMessage);
		Require(GetLoggingState().m_unForwardCount == 4, "ordinary logger disables hook");
		CheckHookState(false);

		g_Application.SetServerOutputHookEnabled(true);
		GetLoggingState().m_ChangeOnDirect = HookChange::REPLACE;
		g_ServerOutputLoggingListener.Log(&Context, pszMessage);
		Require(GetLoggingState().m_unForwardCount == 5, "ordinary logger replaces hook");
		CheckHookState(true);

		GetLoggingState().m_ChangeOnDirect = HookChange::NONE;
		GetLoggingState().m_bThrowOnDirect = true;
		g_ServerOutputLoggingListener.Log(&Context, pszMessage);
		Require(GetLoggingState().m_unForwardCount == 6, "ordinary logger failure");
		CheckHookState(true);

		GetLoggingState().m_bThrowOnDirect = false;
		g_Application.m_bReenter = true;
		const std::size_t unPreviousEmitCount = g_Application.m_unEmitCount;
		g_ServerOutputLoggingListener.Log(&Context, pszMessage);
		Require(g_Application.m_unEmitCount == (unPreviousEmitCount + 1), "recursive callback suppressed");
		Require(GetLoggingState().m_unForwardCount == 7, "output after contained exceptions");
		CheckHookState(true);

		g_Application.SetServerOutputHookEnabled(false);
		g_Application.SetServerOutputHookEnabled(false);
		CheckHookState(false);

		std::puts("ServerOutputContracts PASS");

		return 0;
	} catch (std::exception const& Exception) {
		std::fprintf(stderr, "ServerOutputContracts failed: %s\n", Exception.what());
		return 1;
	}
}
