#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_vecArguments = process.argv.slice(2);
if (g_vecArguments.length !== 0) {
	const bHelp = (g_vecArguments.length === 1) && (g_vecArguments[0] === "--help");
	console.log("Usage: node tools/smoke_log_native_contracts.js [--help]");
	process.exit(bHelp ? 0 : 2);
}

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_unCommandTimeoutMilliseconds = 600_000;
const g_unLongMessageSize = 8_192;
const g_strSource = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src/sourcejs/Log.cpp"), "utf8");
const g_vecProfiles = (process.platform === "win32") ? [
	{ Name: "Win32", Arguments: ["-G", "Visual Studio 17 2022", "-A", "Win32"] },
	{ Name: "X64", Arguments: ["-G", "Visual Studio 17 2022", "-A", "x64"] },
] : [
	{ Name: "X86", Arguments: ["-DCMAKE_CXX_FLAGS=-m32 -fsanitize=undefined -fno-sanitize-recover=all"] },
	{ Name: "X64", Arguments: ["-DCMAKE_CXX_FLAGS=-m64 -fsanitize=undefined -fno-sanitize-recover=all"] },
];
// Negative fixtures only: every replacement must compile and fail a native assertion, not a compiler check.
const g_vecMutations = [
	{ Name: "MessageTruncation", Old: "WriteLog(pOutputFile, pszSpewFunction, pszPrefix, vecBuffer.data());", New: "WriteLog(pOutputFile, pszSpewFunction, pszPrefix, szBuffer);" },
	{ Name: "LineTruncation", Old: 'strLine += pszMessage ? pszMessage : "";', New: 'strLine += std::string(pszMessage ? pszMessage : "").substr(0, kLogBufferSize);' },
	{ Name: "ScopeRestoration", Old: "g_nConsoleLogClientIndex = m_nPreviousClientIndex;", New: "g_nConsoleLogClientIndex = 0;" },
	{ Name: "ShortNUL", Old: "if (std::memchr(szBuffer, '\\0', static_cast<std::size_t>(nFormattedLength)))", New: "if (false)" },
	{ Name: "LongNUL", Old: "if (std::memchr(vecBuffer.data(), '\\0', static_cast<std::size_t>(nFullLength)))", New: "if (false)" },
];

const g_strEngineHeader = String.raw`#pragma once

#ifndef _SOURCEJSTESTLOGENGINE_H_
#define _SOURCEJSTESTLOGENGINE_H_

// Generated only: native log-test SDK sink boundary.
// Compatibility profile: retain this canonical fixture guard under
// CODE_STYLE_GUIDE.md 2.5/4.1; the exception is limited to this guard.
// Narrow SDK sink doubles, not the actual SDK layout or ABI.
class edict_t {
public:
	bool IsFree() const;
};

class IVEngineServer {
public:
	void LogPrint(char const* const pszLine);
	void ClientPrintf(edict_t* const pEdict, char const* const pszLine);
};

#endif // _SOURCEJSTESTLOGENGINE_H_
`;
const g_strCVarHeader = String.raw`#pragma once

#ifndef _SOURCEJSTESTLOGCVAR_H_
#define _SOURCEJSTESTLOGCVAR_H_

// Generated only: native log-test console sink boundary.
// Compatibility profile: retain this canonical fixture guard under
// CODE_STYLE_GUIDE.md 2.5/4.1; the exception is limited to this guard.
class ICvar {
public:
	void ConsolePrintf(char const* const pszFormat, ...);
};

#endif // _SOURCEJSTESTLOGCVAR_H_
`;
const g_strApplicationHeader = String.raw`#pragma once

#ifndef _SOURCEJSTESTLOGAPPLICATION_H_
#define _SOURCEJSTESTLOGAPPLICATION_H_

// Generated only: native log-test application boundary.
// Compatibility profile: retain this canonical fixture guard under
// CODE_STYLE_GUIDE.md 2.5/4.1; the exception is limited to this guard.

// General
#include "eiface.h"
#include "icvar.h"

namespace SourceJS {
	class EngineInterfaces {
	public:
		IVEngineServer* GetEngine() const noexcept;
		ICvar* GetCVar() const noexcept;
		edict_t* GetEdict(const int nEntityIndex) const;
	};

	class Application {
	public:
		EngineInterfaces& GetEngineInterfaces() noexcept;
	};

	extern Application g_Application;
} // namespace SourceJS

#endif // _SOURCEJSTESTLOGAPPLICATION_H_
`;
const g_strFixture = String.raw`
// C++
#include <cstdarg>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <cstring>

// STL
#include <array>
#include <new>
#include <stdexcept>
#include <string>
#include <thread>

// Project
#include "sourcejs/Application.h"
#include "sourcejs/Log.h"

// Generated only: native log regression executable with doubled SDK sinks.
namespace {
	struct FixtureState {
		SourceJS::EngineInterfaces m_Interfaces;
		IVEngineServer m_Engine;
		ICvar m_CVar;
		edict_t m_Edict;
		std::string m_strEngineLine;
		std::string m_strConsoleLine;
		std::string m_strClientLine;
		std::size_t m_unClientCount;
		std::size_t m_unEngineCount;
		std::size_t m_unConsoleCount;
		int m_nSeenClientIndex;
		bool m_bEngineEnabled;
		bool m_bConsoleEnabled;
		bool m_bEdictFree;
		bool m_bInvalidFormat;
	};

	constexpr std::size_t kLongMessageSize = 8'192;
	constexpr std::array<std::size_t, 4> kMessageBoundarySizes = { 2'047, 2'048, 2'303, 2'304 };
	constexpr int kFirstClientIndex = 1;
	constexpr int kSecondClientIndex = 2;
	constexpr int kDisabledClientIndex = -1;

	FixtureState* g_pState = nullptr;
	bool g_bFailAllocation = false;

	void Require(const bool bCondition, char const* const pszMessage) {
		if (!bCondition) {
			throw std::runtime_error(pszMessage);
		}
	}
} // namespace

// Exact replaceable allocation signatures. The single-threaded fault phase uses real STL allocations.
void* operator new(const std::size_t unSize) {
	if (g_bFailAllocation) {
		throw std::bad_alloc();
	}

	void* const pAllocation = std::malloc(unSize ? unSize : 1);
	if (!pAllocation) {
		throw std::bad_alloc();
	}

	return pAllocation;
}

void* operator new[](const std::size_t unSize) {
	return ::operator new(unSize);
}

void operator delete(void* const pAllocation) noexcept {
	std::free(pAllocation);
}

void operator delete[](void* const pAllocation) noexcept {
	std::free(pAllocation);
}

void operator delete(void* const pAllocation, const std::size_t) noexcept {
	std::free(pAllocation);
}

void operator delete[](void* const pAllocation, const std::size_t) noexcept {
	std::free(pAllocation);
}

bool edict_t::IsFree() const {
	return g_pState->m_bEdictFree;
}

void IVEngineServer::LogPrint(char const* const pszLine) {
	g_pState->m_strEngineLine = pszLine;
	++g_pState->m_unEngineCount;
}

void IVEngineServer::ClientPrintf(edict_t* const pEdict, char const* const pszLine) {
	if (pEdict != &g_pState->m_Edict) {
		g_pState->m_bInvalidFormat = true;
	}

	g_pState->m_strClientLine = pszLine;
	++g_pState->m_unClientCount;
}

void ICvar::ConsolePrintf(char const* const pszFormat, ...) {
	if (std::strcmp(pszFormat, "%s") != 0) {
		g_pState->m_bInvalidFormat = true;
		return;
	}

	std::va_list ArgumentList;
	va_start(ArgumentList, pszFormat);
	char const* const pszLine = va_arg(ArgumentList, char const*);
	va_end(ArgumentList);
	g_pState->m_strConsoleLine = pszLine;
	++g_pState->m_unConsoleCount;
}

namespace SourceJS {
	Application g_Application {};

	IVEngineServer* EngineInterfaces::GetEngine() const noexcept {
		return g_pState->m_bEngineEnabled ? &g_pState->m_Engine : nullptr;
	}

	ICvar* EngineInterfaces::GetCVar() const noexcept {
		return g_pState->m_bConsoleEnabled ? &g_pState->m_CVar : nullptr;
	}

	edict_t* EngineInterfaces::GetEdict(const int nEntityIndex) const {
		g_pState->m_nSeenClientIndex = nEntityIndex;

		return (nEntityIndex > 0) ? &g_pState->m_Edict : nullptr;
	}

	EngineInterfaces& Application::GetEngineInterfaces() noexcept {
		return g_pState->m_Interfaces;
	}
} // namespace SourceJS

namespace {
	void RunSinkContracts(FixtureState& State, std::string const& strLongMessage) {
		SourceJS::LogInfo("%s|%d|%.2f|%zu|END", strLongMessage.c_str(), -17, 1.25, strLongMessage.size());
		SourceJS::LogWarning("warning");
		SourceJS::LogError("error");
		SourceJS::LogInfo(nullptr);

		State.m_bEngineEnabled = true;
		SourceJS::LogInfo("%s", strLongMessage.c_str());
		Require(State.m_strEngineLine == ("[SourceJS] [INFO] " + strLongMessage + "\n"), "engine line was truncated");

		State.m_bConsoleEnabled = true;
		const std::size_t unEngineCount = State.m_unEngineCount;
		const std::size_t unConsoleCount = State.m_unConsoleCount;
		SourceJS::LogWarning("%s", strLongMessage.c_str());
		Require(State.m_strConsoleLine == ("[SourceJS] [WARNING] " + strLongMessage + "\n"), "console line was truncated");
		Require(State.m_unConsoleCount == (unConsoleCount + 1), "console record was not written exactly once");
		Require(State.m_unEngineCount == unEngineCount, "console must precede engine fallback");

		for (auto const& unMessageSize : kMessageBoundarySizes) {
			std::string const strMessage = std::string(unMessageSize, 'b');
			SourceJS::LogError("%s", strMessage.c_str());
			Require(State.m_strConsoleLine == ("[SourceJS] [ERROR] " + strMessage + "\n"), "buffer boundary record mismatch");
		}

		State.m_bConsoleEnabled = false;
		SourceJS::LogInfo("before%cafter", 0);
		Require(State.m_strEngineLine.find("[SourceJS] [ERROR] FormatLogMessage failed Error=") == 0, "short embedded NUL was silently accepted");
		SourceJS::LogInfo("%s%cafter", strLongMessage.c_str(), 0);
		Require(State.m_strEngineLine.find("[SourceJS] [ERROR] FormatLogMessage failed Error=") == 0, "long embedded NUL was silently accepted");
	}

	void RunScopeContracts(FixtureState& State, std::string const& strLongMessage) {
		{
			SourceJS::ClientConsoleLogScope FirstScope(kFirstClientIndex);
			SourceJS::LogInfo("%s", strLongMessage.c_str());
			Require(State.m_strClientLine == State.m_strEngineLine, "client/global records differ");
			Require(State.m_nSeenClientIndex == kFirstClientIndex, "first client scope missing");

			{
				SourceJS::ClientConsoleLogScope SecondScope(kSecondClientIndex);
				SourceJS::LogWarning("nested");
				Require(State.m_nSeenClientIndex == kSecondClientIndex, "nested scope missing");
			}

			SourceJS::LogInfo("restored");
			Require(State.m_nSeenClientIndex == kFirstClientIndex, "nested client scope not restored");

			const std::size_t unClientCount = State.m_unClientCount;

			{
				SourceJS::ClientConsoleLogScope DisabledScope(kDisabledClientIndex);
				SourceJS::LogInfo("disabled");
			}

			Require(State.m_unClientCount == unClientCount, "disabled scope wrote to client");

			State.m_bEdictFree = true;
			SourceJS::LogInfo("free edict");
			Require(State.m_unClientCount == unClientCount, "free edict received client text");
			State.m_bEdictFree = false;

			// Main thread does not log while joined worker runs; sink doubles do not model real SDK thread safety.
			std::thread Worker([]() {
				SourceJS::LogInfo("other thread");
			});
			Worker.join();
			Require(State.m_unClientCount == unClientCount, "client scope leaked into another thread");
			SourceJS::LogInfo("after worker");
			Require(State.m_nSeenClientIndex == kFirstClientIndex, "disabled scope did not restore client");
		}

		const std::size_t unClientCount = State.m_unClientCount;
		SourceJS::LogInfo("after scope");
		Require(State.m_unClientCount == unClientCount, "outer scope did not restore empty state");
	}

	void RunAllocationContracts(FixtureState& State, std::string const& strLongMessage) {
		const std::size_t unEngineCount = State.m_unEngineCount;
		g_bFailAllocation = true;
		SourceJS::LogInfo("allocation-fallback record must remain complete");
		SourceJS::LogError("%s", strLongMessage.c_str());
		g_bFailAllocation = false;
		Require(State.m_unEngineCount == unEngineCount, "failed allocation reached an incomplete engine line");
	}
} // namespace

int main(const int nArgumentCount, char**) {
	if (nArgumentCount != 1) {
		std::fputs("Usage: LogContracts\n", stderr);
		return 2;
	}

	try {
		FixtureState State {};
		g_pState = &State;
		std::string const strLongMessage = std::string(kLongMessageSize, 'L');
		RunSinkContracts(State, strLongMessage);
		RunScopeContracts(State, strLongMessage);
		RunAllocationContracts(State, strLongMessage);
		Require(!State.m_bInvalidFormat, "unsafe sink format or edict");
		std::fputs("[native] log records, sinks, scopes, NUL and allocation failures passed\n", stdout);
		g_pState = nullptr;

		return 0;
	} catch (std::exception const& Error) {
		g_bFailAllocation = false;
		std::fprintf(stderr, "[native] log failure: %s\n", Error.what());
		return 1;
	}
}
`;

g_Assert(["win32", "linux"].includes(process.platform), "Native logger tests require Windows or Linux.");
g_Assert(["ia32", "x64"].includes(process.arch), "Native logger tests require x86/x64 compiler profiles.");
g_FileSystem.mkdirSync(g_Path.join(g_strProjectRoot, "build"), { recursive: true });
const g_strBuildRoot = g_FileSystem.realpathSync(g_Path.join(g_strProjectRoot, "build"));
const g_strTemporaryRoot = g_FileSystem.mkdtempSync(g_Path.join(g_strBuildRoot, "NativeLog-"));

function RunCommand(strCommand, vecArguments) {
	const Result = g_ChildProcess.spawnSync(strCommand, vecArguments, { encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
	g_Assert.equal(Result.status, 0, strCommand + ": " + (Result.error?.message ?? (Result.stdout + Result.stderr)));
}

function VerifyFixtureCLI(strProgram) {
	const Result = g_ChildProcess.spawnSync(strProgram, ["UnexpectedArgument"], { encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
	g_Assert.equal(Result.status, 2, Result.error?.message ?? (Result.stdout + Result.stderr));
	g_Assert.equal(Result.signal, null);
	g_Assert.equal(Result.stdout, "");
	g_Assert.equal(Result.stderr.replace(/\r\n/g, "\n"), "Usage: LogContracts\n");
}

function RunFixture(strProgram, bRegression) {
	const Result = g_ChildProcess.spawnSync(strProgram, [], { encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
	g_Assert.equal(Result.status, bRegression ? 1 : 0, Result.error?.message ?? (Result.stdout + Result.stderr));

	if (bRegression) {
		g_Assert.match(Result.stderr, /\[native\] log failure:/, "Compiled regression must fail a native assertion.");
		return;
	}

	g_Assert.match(Result.stdout, /\[native\] log records, sinks, scopes, NUL and allocation failures passed/);
	g_Assert.equal(Result.stdout.replace(/\r\n/g, "\n"), "[SourceJS] [INFO] " + "L".repeat(g_unLongMessageSize) + "|-17|1.25|8192|END\n[SourceJS] [INFO] \n[SourceJS] [INFO] allocation-fallback record must remain complete\n[native] log records, sinks, scopes, NUL and allocation failures passed\n");
	g_Assert.match(Result.stderr, /^\[SourceJS\] \[WARNING\] warning\r?\n\[SourceJS\] \[ERROR\] error\r?\n\[SourceJS\] \[ERROR\] FormatLogMessage failed Error=0x[0-9A-F]{8}\r?\n$/);
}

let g_unRejectedMutationCount = 0;
try {
	const strSourceNoticeAnchor = "// General";
	g_Assert.equal(g_strSource.split(strSourceNoticeAnchor).length, 2, "Unique production include-group anchor for the generated-only notice.");
	const strGeneratedSource = g_strSource.replace(strSourceNoticeAnchor, "// Generated only: production log copy for native regression checks.\n\n" + strSourceNoticeAnchor);
	const strLogHeader = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src/sourcejs/Log.h"), "utf8");
	const strHeaderNoticeAnchor = "#define _SOURCEJSLOG_H_";
	g_Assert.equal(strLogHeader.split(strHeaderNoticeAnchor).length, 2, "Unique production header guard for the generated-only notice.");
	const strGeneratedHeader = strLogHeader.replace(strHeaderNoticeAnchor, strHeaderNoticeAnchor + "\n\n// Generated only: production log header copy for native regression checks.");

	g_FileSystem.mkdirSync(g_Path.join(g_strTemporaryRoot, "sourcejs"));
	g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "sourcejs/Log.h"), strGeneratedHeader);
	g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "eiface.h"), g_strEngineHeader);
	g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "icvar.h"), g_strCVarHeader);
	g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "sourcejs/Application.h"), g_strApplicationHeader);
	g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "LogContracts.cpp"), g_strFixture);
	g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "CMakeLists.txt"), [
		"# Generated only: native log regression build.",
		"cmake_minimum_required(VERSION 3.20)",
		"project(LogContracts LANGUAGES CXX)",
		"find_package(Threads REQUIRED)",
		"add_executable(LogContracts LogContracts.cpp Log.cpp)",
		"target_compile_features(LogContracts PRIVATE cxx_std_20)",
		'target_include_directories(LogContracts PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")',
		"target_link_libraries(LogContracts PRIVATE Threads::Threads ${CMAKE_DL_LIBS})",
		"if(MSVC)",
		"\ttarget_compile_options(LogContracts PRIVATE /W4 /WX)",
		"else()",
		"\ttarget_compile_options(LogContracts PRIVATE -Wall -Wextra -Wpedantic -Werror)",
		"endif()",
		"",
	].join("\n"));

	for (const Profile of g_vecProfiles) {
		const strSourcePath = g_Path.join(g_strTemporaryRoot, "Log.cpp");
		g_FileSystem.writeFileSync(strSourcePath, strGeneratedSource);

		const strBinaryRoot = g_Path.join(g_strTemporaryRoot, Profile.Name);
		RunCommand("cmake", ["-S", g_strTemporaryRoot, "-B", strBinaryRoot, ...Profile.Arguments]);
		RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);

		const strProgram = (process.platform === "win32") ? g_Path.join(strBinaryRoot, "Release/LogContracts.exe") : g_Path.join(strBinaryRoot, "LogContracts");
		RunFixture(strProgram, false);
		VerifyFixtureCLI(strProgram);

		for (const Mutation of g_vecMutations) {
			g_Assert.equal(g_strSource.split(Mutation.Old).length, 2, Mutation.Name);
			g_FileSystem.writeFileSync(strSourcePath, strGeneratedSource.replace(Mutation.Old, () => Mutation.New));
			RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);
			RunFixture(strProgram, true);
			++g_unRejectedMutationCount;
		}

		g_FileSystem.writeFileSync(strSourcePath, strGeneratedSource);
		RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);
		RunFixture(strProgram, false);
	}
} finally {
	const strRealTemporaryRoot = g_FileSystem.realpathSync(g_strTemporaryRoot);
	const strRelativeTemporaryRoot = g_Path.relative(g_strBuildRoot, strRealTemporaryRoot);
	g_Assert(!g_Path.isAbsolute(strRelativeTemporaryRoot) && !strRelativeTemporaryRoot.startsWith("..") && /^NativeLog-[^/\\]+$/.test(strRelativeTemporaryRoot), "Refuse cleanup outside the exact native fixture directory.");
	g_Assert(!g_FileSystem.lstatSync(g_strTemporaryRoot).isSymbolicLink());
	g_FileSystem.rmSync(strRealTemporaryRoot, { recursive: true, force: true });
}

console.log("Log native checks PASS; profiles=" + g_vecProfiles.length + "; compiled regressions=" + g_unRejectedMutationCount + "; actual production implementation/header; SDK sinks doubled, real formatting/allocation/stdio/platform loader; real engine/V8 and present spew exports not exercised; temporary build cleaned.");
