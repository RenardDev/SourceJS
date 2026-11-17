#include "sourcejs/Log.h"

// General
#if defined(_WIN32)
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#define SOURCEJS_DEFINED_WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#define SOURCEJS_DEFINED_NOMINMAX
#endif
#include <Windows.h>
#if defined(SOURCEJS_DEFINED_NOMINMAX)
#undef NOMINMAX
#undef SOURCEJS_DEFINED_NOMINMAX
#endif
#if defined(SOURCEJS_DEFINED_WIN32_LEAN_AND_MEAN)
#undef WIN32_LEAN_AND_MEAN
#undef SOURCEJS_DEFINED_WIN32_LEAN_AND_MEAN
#endif
#else
#include <dlfcn.h>
#endif
#include "eiface.h"
#include "icvar.h"
#if __has_include("game/server/iplayerinfo.h")
#include "game/server/iplayerinfo.h"
#elif __has_include("dlls/iplayerinfo.h")
#include "dlls/iplayerinfo.h"
#else
#include "iplayerinfo.h"
#endif

// C++
#include <cerrno>
#include <cstdarg>
#include <cstddef>
#include <cstdio>
#include <cstring>

// STL
#include <string>
#include <vector>

// Project
#include "sourcejs/Application.h"

// ================================================================
// Log
// ================================================================

namespace SourceJS {

	namespace {

		using fnSourceSpew = void(*)(char const* const pszFormat, ...);

		constexpr std::size_t kLogBufferSize = 2048;
		constexpr std::size_t kErrorBufferSize = 128;
		constexpr char kInfoLogPrefix[] = "[SourceJS] [INFO] ";
		constexpr char kWarningLogPrefix[] = "[SourceJS] [WARNING] ";
		constexpr char kErrorLogPrefix[] = "[SourceJS] [ERROR] ";

		thread_local int g_nConsoleLogClientIndex = 0;

#if defined(_WIN32)
		fnSourceSpew ResolveWindowsSourceSpew(HMODULE const hModule, char const* const pszFunctionName) noexcept {
			if (!hModule || !pszFunctionName) {
				return nullptr;
			}

			fnSourceSpew const ResolvedSpew = reinterpret_cast<fnSourceSpew>(GetProcAddress(hModule, pszFunctionName));
			if (ResolvedSpew) {
				return ResolvedSpew;
			}

			char const* pszDecoratedName = nullptr;
			if (std::strcmp(pszFunctionName, "ConMsg") == 0) {
#if defined(_WIN64)
				pszDecoratedName = "?ConMsg@@YAXPEBDZZ";
#else
				pszDecoratedName = "?ConMsg@@YAXPBDZZ";
#endif

			} else if (std::strcmp(pszFunctionName, "Msg") == 0) {
#if defined(_WIN64)
				pszDecoratedName = "?Msg@@YAXPEBDZZ";
#else
				pszDecoratedName = "?Msg@@YAXPBDZZ";
#endif

			} else if (std::strcmp(pszFunctionName, "Warning") == 0) {
#if defined(_WIN64)
				pszDecoratedName = "?Warning@@YAXPEBDZZ";
#else
				pszDecoratedName = "?Warning@@YAXPBDZZ";
#endif
			}

			return pszDecoratedName ? reinterpret_cast<fnSourceSpew>(GetProcAddress(hModule, pszDecoratedName)) : nullptr;
		}
#else
		fnSourceSpew ResolveLinuxSourceSpew(char const* const pszFunctionName) noexcept {
			if (!pszFunctionName) {
				return nullptr;
			}

			fnSourceSpew const ResolvedSpew = reinterpret_cast<fnSourceSpew>(dlsym(RTLD_DEFAULT, pszFunctionName));
			if (ResolvedSpew) {
				return ResolvedSpew;
			}

			char const* pszMangledName = nullptr;
			if (std::strcmp(pszFunctionName, "ConMsg") == 0) {
				pszMangledName = "_Z6ConMsgPKcz";

			} else if (std::strcmp(pszFunctionName, "Msg") == 0) {
				pszMangledName = "_Z3MsgPKcz";

			} else if (std::strcmp(pszFunctionName, "Warning") == 0) {
				pszMangledName = "_Z7WarningPKcz";
			}

			return pszMangledName ? reinterpret_cast<fnSourceSpew>(dlsym(RTLD_DEFAULT, pszMangledName)) : nullptr;
		}
#endif

		fnSourceSpew ResolveSourceSpew(char const* const pszFunctionName) noexcept {
			if (!pszFunctionName) {
				return nullptr;
			}

#if defined(_WIN32)
			HMODULE const hModule = GetModuleHandleA("tier0.dll");

			return hModule ? ResolveWindowsSourceSpew(hModule, pszFunctionName) : nullptr;
#else
			return ResolveLinuxSourceSpew(pszFunctionName);
#endif
		}

		bool WriteSourceSpew(char const* const pszFunctionName, char const* const pszLine) noexcept {
			if (!pszFunctionName || !pszLine) {
				return false;
			}

			fnSourceSpew const Spew = ResolveSourceSpew(pszFunctionName);
			if (!Spew) {
				return false;
			}

			Spew("%s", pszLine);

			return true;
		}

		bool WriteEngineLog(char const* const pszLine) noexcept {
			if (!pszLine) {
				return false;
			}

			auto* const pEngine = g_Application.GetEngineInterfaces().GetEngine();
			if (!pEngine) {
				return false;
			}

			pEngine->LogPrint(pszLine);

			return true;
		}

		template <typename TCVar>
		bool WriteCVarConsolePrint(TCVar* const pCVar, char const* const pszLine) noexcept {
			if (!pCVar || !pszLine) {
				return false;
			}

			if constexpr (requires(TCVar* const pCVarInterface) { pCVarInterface->ConsolePrintf("%s", pszLine); }) {
				pCVar->ConsolePrintf("%s", pszLine);
				return true;

			} else {
				return false;
			}
		}

		bool WriteConsolePrint(char const* const pszLine) noexcept {
			if (!pszLine) {
				return false;
			}

			auto* const pCVar = g_Application.GetEngineInterfaces().GetCVar();
			if (!pCVar) {
				return false;
			}

			return WriteCVarConsolePrint(pCVar, pszLine);
		}

		bool WriteClientConsolePrint(char const* const pszLine) noexcept {
			if (!pszLine || (g_nConsoleLogClientIndex <= 0)) {
				return false;
			}

			EngineInterfaces& EngineInterfacesInstance = g_Application.GetEngineInterfaces();
			auto* const pEngine = EngineInterfacesInstance.GetEngine();
			auto* const pClientEdict = EngineInterfacesInstance.GetEdict(g_nConsoleLogClientIndex);
			if (!pEngine || !pClientEdict || pClientEdict->IsFree()) {
				return false;
			}

			auto* const pPlayerInformationManager = EngineInterfacesInstance.GetPlayerInformationManager();
			auto* const pPlayerInformation = pPlayerInformationManager ? pPlayerInformationManager->GetPlayerInfo(pClientEdict) : nullptr;
			if (!pPlayerInformation || !pPlayerInformation->IsConnected() || pPlayerInformation->IsFakeClient()) {
				return false;
			}

			pEngine->ClientPrintf(pClientEdict, pszLine);

			return true;
		}

		void WriteFallback(FILE* const pOutputFile, char const* const pszPrefix, char const* const pszMessage) noexcept {
			if (!pOutputFile || !pszPrefix) {
				return;
			}

			std::fprintf(pOutputFile, "%s%s\n", pszPrefix, pszMessage ? pszMessage : "");
			// Last-resort best-effort sink: no further reliable destination exists for a write/flush failure.
			std::fflush(pOutputFile);
		}

		void WriteLog(FILE* const pOutputFile, char const* const pszSpewFunction, char const* const pszPrefix, char const* const pszMessage) noexcept {
			if (!pOutputFile || !pszSpewFunction || !pszPrefix) {
				return;
			}

			std::string strLine {};
			try {
				strLine = pszPrefix;
				strLine += pszMessage ? pszMessage : "";
				strLine += '\n';
			} catch (...) {
				// Preserve the complete record even when constructing an engine-compatible line cannot allocate.
				WriteFallback(pOutputFile, pszPrefix, pszMessage);
				return;
			}

			WriteClientConsolePrint(strLine.c_str());

			if (!WriteSourceSpew(pszSpewFunction, strLine.c_str()) && !WriteConsolePrint(strLine.c_str()) && !WriteEngineLog(strLine.c_str())) {
				WriteFallback(pOutputFile, pszPrefix, pszMessage);
			}
		}

		void WriteFormattingFailure(const int nError) noexcept {
			char szErrorMessage[kErrorBufferSize] {};
			const int nErrorLength = std::snprintf(szErrorMessage, sizeof(szErrorMessage), "FormatLogMessage failed Error=0x%08X", static_cast<unsigned int>(nError));
			if ((nErrorLength < 0) || (static_cast<std::size_t>(nErrorLength) >= sizeof(szErrorMessage))) {
				WriteLog(stderr, "Warning", kErrorLogPrefix, "FormatLogMessage failed.");
				return;
			}

			WriteLog(stderr, "Warning", kErrorLogPrefix, szErrorMessage);
		}

		int FormatLogMessage(char* const pchBufferOut, const std::size_t unBufferSize, char const* const pszFormat, std::va_list ArgumentList, int& nErrorOut) noexcept {
			std::va_list FormatArguments;
			va_copy(FormatArguments, ArgumentList);
			const int nFormattedLength = std::vsnprintf(pchBufferOut, unBufferSize, pszFormat, FormatArguments);
			nErrorOut = (nFormattedLength < 0) ? errno : 0;
			va_end(FormatArguments);

			return nFormattedLength;
		}

		void WriteFormattedLog(FILE* const pOutputFile, char const* const pszSpewFunction, char const* const pszPrefix, char const* const pszFormat, std::va_list ArgumentList) noexcept {
			if (!pszFormat) {
				WriteLog(pOutputFile, pszSpewFunction, pszPrefix, "");
				return;
			}

			char szBuffer[kLogBufferSize] {};
			int nFormatError = 0;
			const int nFormattedLength = FormatLogMessage(szBuffer, sizeof(szBuffer), pszFormat, ArgumentList, nFormatError);
			if (nFormattedLength < 0) {
				WriteFormattingFailure(nFormatError);
				return;
			}

			if (static_cast<std::size_t>(nFormattedLength) < sizeof(szBuffer)) {
				if (std::memchr(szBuffer, '\0', static_cast<std::size_t>(nFormattedLength))) {
					WriteFormattingFailure(EILSEQ);
					return;
				}

				WriteLog(pOutputFile, pszSpewFunction, pszPrefix, szBuffer);
				return;
			}

			try {
				// vsnprintf returns an int; its nonnegative length plus the terminator fits size_t on supported x86/x64 targets.
				std::vector<char> vecBuffer(static_cast<std::size_t>(nFormattedLength) + 1);
				const int nFullLength = FormatLogMessage(vecBuffer.data(), vecBuffer.size(), pszFormat, ArgumentList, nFormatError);
				if (nFullLength < 0) {
					WriteFormattingFailure(nFormatError);
					return;
				}

				if (static_cast<std::size_t>(nFullLength) >= vecBuffer.size()) {
					WriteFormattingFailure(ERANGE);
					return;
				}

				if (std::memchr(vecBuffer.data(), '\0', static_cast<std::size_t>(nFullLength))) {
					WriteFormattingFailure(EILSEQ);
					return;
				}

				WriteLog(pOutputFile, pszSpewFunction, pszPrefix, vecBuffer.data());
			} catch (...) {
				// Allocation/extent failures cannot escape this logger's noexcept boundary or report a truncated success.
				WriteFormattingFailure(ENOMEM);
			}
		}
	} // namespace

	ClientConsoleLogScope::ClientConsoleLogScope(const int nClientIndex) noexcept {
		m_nPreviousClientIndex = g_nConsoleLogClientIndex;
		g_nConsoleLogClientIndex = (nClientIndex > 0) ? nClientIndex : 0;
	}

	ClientConsoleLogScope::~ClientConsoleLogScope() noexcept {
		g_nConsoleLogClientIndex = m_nPreviousClientIndex;
	}

	void LogInfo(char const* const pszFormat, ...) noexcept {
		std::va_list ArgumentList;
		va_start(ArgumentList, pszFormat);
		WriteFormattedLog(stdout, "ConMsg", kInfoLogPrefix, pszFormat, ArgumentList);
		va_end(ArgumentList);
	}

	void LogWarning(char const* const pszFormat, ...) noexcept {
		std::va_list ArgumentList;
		va_start(ArgumentList, pszFormat);
		WriteFormattedLog(stderr, "Warning", kWarningLogPrefix, pszFormat, ArgumentList);
		va_end(ArgumentList);
	}

	void LogError(char const* const pszFormat, ...) noexcept {
		std::va_list ArgumentList;
		va_start(ArgumentList, pszFormat);
		WriteFormattedLog(stderr, "Warning", kErrorLogPrefix, pszFormat, ArgumentList);
		va_end(ArgumentList);
	}
} // namespace SourceJS
