#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_strUsage = "Usage: node tools/smoke_hook_manager_native_contracts.js [--help]";
const g_unCommandTimeoutMilliseconds = 600_000;
const g_strSourceNamespaceAnchor = "\nnamespace SourceJS {";
const g_vecMutations = [
	{ Name: "NameSnapshot", Old: "std::string const strDispatchHookName = strHookName;", New: "std::string const strDispatchHookName {};" },
	{ Name: "PayloadSnapshot", Old: "std::string const strDispatchPayload = strPayload;", New: "std::string const strDispatchPayload = strPayload.substr(0, 0);" },
	{ Name: "DispatchCount", Old: "++HookInformation.m_unDispatchCount;", New: "" },
	{ Name: "CountOverflow", Old: "if (HookInformation.m_unDispatchCount < std::numeric_limits<std::size_t>::max())", New: "if (true)" },
	{ Name: "ShutdownDetach", Old: "m_vecHooks.clear();\n\n\t\tm_pV8Runtime = nullptr;", New: "m_vecHooks.clear();" },
	{ Name: "HookKind", Old: "FindOrCreateHook(strDispatchHookName, \"vsp\")", New: "FindOrCreateHook(strDispatchHookName, \"invalid\")" },
];
const g_vecProfiles = (process.platform === "win32") ? [
	{ Name: "Win32", Arguments: ["-G", "Visual Studio 17 2022", "-A", "Win32"] },
	{ Name: "X64", Arguments: ["-G", "Visual Studio 17 2022", "-A", "x64"] },
] : [
	{ Name: "X86", Arguments: ["-DCMAKE_CXX_FLAGS=-m32 -fsanitize=undefined -fno-sanitize-recover=all"] },
	{ Name: "X64", Arguments: ["-DCMAKE_CXX_FLAGS=-m64 -fsanitize=undefined -fno-sanitize-recover=all"] },
];
const g_strRuntimeHeader = String.raw`#pragma once

#ifndef _SOURCEJSHOOKMANAGERTESTV8RUNTIME_H_
#define _SOURCEJSHOOKMANAGERTESTV8RUNTIME_H_

// Generated only: HookManager native-test runtime boundary.

// Compatibility profile: retain this test-only project-canonical reserved guard
// under CODE_STYLE_GUIDE.md 2.5/4.1; the exception is limited to this header guard.

// STL
#include <functional>
#include <string>

namespace SourceJS {
	// Test-only runtime boundary: production HookManager bodies and its public header stay unchanged.
	class V8Runtime {
	public:
		void EmitEvent(std::string const& strEventName, std::string const& strPayload);

	public:
		std::function<void(std::string const&, std::string const&)> m_Callback;
	};
} // namespace SourceJS

#endif // _SOURCEJSHOOKMANAGERTESTV8RUNTIME_H_
`;
const g_strFixture = String.raw`
// C++
#include <cstdio>

// STL
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

// Project
#include "sourcejs/HookManager.h"
#include "sourcejs/V8Runtime.h"

// Generated only: HookManager regression fixture with a doubled runtime boundary.
namespace SourceJS {
	void V8Runtime::EmitEvent(std::string const& strEventName, std::string const& strPayload) {
		if (m_Callback) {
			m_Callback(strEventName, strPayload);
		}
	}
} // namespace SourceJS

namespace {
	struct DispatchRecord {
		std::string m_strName;
		std::string m_strPayload;
	};

	void Require(const bool bCondition, char const* const pszMessage) {
		if (!bCondition) {
			throw std::runtime_error(pszMessage);
		}
	}

	void RunContracts() {
		constexpr std::size_t kReentrantHookCount = 128;
		constexpr std::size_t kMaximumPaddingCount = 4'096;

		SourceJS::HookManager Manager {};
		SourceJS::V8Runtime Runtime {};
		SourceJS::V8Runtime OtherRuntime {};
		std::vector<DispatchRecord> vecDispatches {};
		Runtime.m_Callback = [&vecDispatches](std::string const& strName, std::string const& strPayload) {
			vecDispatches.push_back({ strName, strPayload });
		};

		Require(Manager.GetHooks().empty(), "initial registry");
		Manager.Emit("", "Ignored");
		Require(Manager.GetHooks().empty() && vecDispatches.empty(), "empty event");

		Manager.Emit("BeforeInitialize", "Ignored");
		Require((Manager.GetHooks().size() == 1) && vecDispatches.empty(), "detached observation");
		Require((Manager.GetHooks().front().m_strName == "BeforeInitialize") && (Manager.GetHooks().front().m_strKind == "vsp") && (Manager.GetHooks().front().m_unDispatchCount == 1), "new hook record");

		Manager.Initialize(&Runtime);
		std::string const strBinaryPayload = std::string("P\0X", 3);
		Manager.Emit("Observed", strBinaryPayload);
		Require((vecDispatches.size() == 1) && (vecDispatches.back().m_strName == "Observed") && (vecDispatches.back().m_strPayload == strBinaryPayload), "binary payload delivery");

		Manager.Emit("Observed", "Second");
		Require((Manager.GetHooks().size() == 2) && (Manager.GetHooks()[1].m_unDispatchCount == 2), "existing hook observation");

		Manager.Initialize(nullptr);
		Manager.Emit("Observed", "Detached");
		Require((vecDispatches.size() == 2) && (Manager.GetHooks()[1].m_unDispatchCount == 3), "explicit runtime detach");

		bool bOtherRuntimeInvoked = false;
		OtherRuntime.m_Callback = [&bOtherRuntimeInvoked](std::string const& strName, std::string const& strPayload) {
			Require((strName == "Replacement") && (strPayload == "Payload"), "replacement arguments");
			bOtherRuntimeInvoked = true;
		};

		Manager.Initialize(&OtherRuntime);
		Manager.Emit("Replacement", "Payload");
		Require(bOtherRuntimeInvoked && (vecDispatches.size() == 2), "runtime replacement");

		Manager.Initialize(&Runtime);

		while (Manager.GetHooks().size() < Manager.GetHooks().capacity()) {
			Require(Manager.GetHooks().size() < kMaximumPaddingCount, "bounded growth setup");
			Manager.Emit("Padding" + std::to_string(Manager.GetHooks().size()), "Padding");
		}

		std::string const strBorrowedPayload = Manager.GetHooks().front().m_strName;
		const std::size_t unCapacityBeforeGrowth = Manager.GetHooks().capacity();
		Manager.Emit("Growth", Manager.GetHooks().front().m_strName);
		Require((Manager.GetHooks().capacity() > unCapacityBeforeGrowth) && (vecDispatches.back().m_strPayload == strBorrowedPayload), "payload borrowed across vector reallocation");

		std::string const strRootName = Manager.GetHooks().front().m_strName;
		Runtime.m_Callback = [&Manager, &strRootName](std::string const& strName, std::string const& strPayload) {
			if (strName != strRootName) {
				return;
			}

			for (std::size_t unHookIndex = 0; unHookIndex < kReentrantHookCount; ++unHookIndex) {
				Manager.Emit("Nested" + std::to_string(unHookIndex), "NestedPayload");
			}

			Require((strName == strRootName) && (strPayload == strRootName), "borrowed arguments after reentrant growth");
		};

		const std::size_t unCapacityBeforeReentry = Manager.GetHooks().capacity();
		Manager.Emit(Manager.GetHooks().front().m_strName, Manager.GetHooks().front().m_strName);
		Require(Manager.GetHooks().capacity() > unCapacityBeforeReentry, "reentry actually reallocated records");

		Runtime.m_Callback = {};

		// Inject only the unreachable-by-short-tests boundary into an actually mutable owner.
		std::vector<SourceJS::HookRecord>& vecMutableHooks = const_cast<std::vector<SourceJS::HookRecord>&>(Manager.GetHooks());
		vecMutableHooks.front().m_unDispatchCount = std::numeric_limits<std::size_t>::max();
		Manager.Emit(vecMutableHooks.front().m_strName, "CounterLimit");
		Require(Manager.GetHooks().front().m_unDispatchCount == std::numeric_limits<std::size_t>::max(), "saturating dispatch count");

		bool bShutdownCallbackInvoked = false;
		Runtime.m_Callback = [&Manager, &strRootName, &bShutdownCallbackInvoked](std::string const& strName, std::string const& strPayload) {
			bShutdownCallbackInvoked = true;
			Manager.Shutdown();
			Require((strName == strRootName) && (strPayload == strRootName), "arguments survive reentrant shutdown");
		};

		Manager.Emit(Manager.GetHooks().front().m_strName, Manager.GetHooks().front().m_strName);
		Require(bShutdownCallbackInvoked && Manager.GetHooks().empty(), "reentrant shutdown");

		bShutdownCallbackInvoked = false;
		Manager.Emit("AfterShutdown", "Ignored");
		Require(!bShutdownCallbackInvoked && (Manager.GetHooks().size() == 1) && (Manager.GetHooks().front().m_unDispatchCount == 1), "shutdown detached runtime");

		Manager.Shutdown();
		Manager.Shutdown();
		Require(Manager.GetHooks().empty(), "repeated shutdown");
	}
} // namespace

int main(const int nArgumentCount, char**) {
	if (nArgumentCount != 1) {
		std::fputs("Usage: HookManagerContracts\n", stderr);
		return 2;
	}

	try {
		RunContracts();
		std::puts("[native] hook registry, lifecycle, binary payload, aliasing, reentrancy and counter scenarios passed");

		return 0;
	} catch (std::exception const& Exception) {
		std::fprintf(stderr, "[native] hook-manager failure: %s\n", Exception.what());
		return 1;
	}
}
`;

const g_vecArguments = process.argv.slice(2);
if ((g_vecArguments.length === 1) && (g_vecArguments[0] === "--help")) {
	console.log(g_strUsage);
	process.exit(0);
}

if (g_vecArguments.length !== 0) {
	console.error(g_strUsage);
	process.exit(2);
}

g_Assert(["win32", "linux"].includes(process.platform), "Native HookManager tests require Windows or Linux.");
g_Assert(["ia32", "x64"].includes(process.arch), "Native HookManager tests require x86/x64 compiler profiles.");

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strSource = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src/sourcejs/HookManager.cpp"), "utf8").replace(/\r\n/g, "\n");
g_Assert.equal(g_strSource.split(g_strSourceNamespaceAnchor).length, 2);
const g_strGeneratedSource = g_strSource.replace(g_strSourceNamespaceAnchor, "\n// Generated only: current HookManager native regression source.\nnamespace SourceJS {");

g_FileSystem.mkdirSync(g_Path.join(g_strProjectRoot, "build"), { recursive: true });

const g_strBuildRoot = g_FileSystem.realpathSync(g_Path.join(g_strProjectRoot, "build"));
const g_strTemporaryRoot = g_FileSystem.mkdtempSync(g_Path.join(g_strBuildRoot, "NativeHookManager-"));

function RunCommand(strCommand, vecArguments) {
	const Result = g_ChildProcess.spawnSync(strCommand, vecArguments, { encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
	g_Assert.equal(Result.status, 0, strCommand + ": " + (Result.error?.message ?? (Result.stdout + Result.stderr)));
}

function RunFixture(strProgram, bRegression) {
	const Result = g_ChildProcess.spawnSync(strProgram, [], { encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
	g_Assert.equal(Result.status, bRegression ? 1 : 0, Result.error?.message ?? (Result.stdout + Result.stderr));

	if (bRegression) {
		g_Assert.match(Result.stderr, /\[native\] hook-manager failure:/, "Compiled regression must fail a native assertion.");
	} else {
		g_Assert.match(Result.stdout, /\[native\] hook registry, lifecycle, binary payload, aliasing, reentrancy and counter scenarios passed/);
	}
}

let g_unRejectedMutationCount = 0;

try {
	g_FileSystem.mkdirSync(g_Path.join(g_strTemporaryRoot, "sourcejs"));
	g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "sourcejs/V8Runtime.h"), g_strRuntimeHeader);
	g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "HookManagerContracts.cpp"), g_strFixture);
	g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "CMakeLists.txt"), [
		"# Generated only: native HookManager regression project.",
		"cmake_minimum_required(VERSION 3.20)",
		"project(HookManagerContracts LANGUAGES CXX)",
		"add_executable(HookManagerContracts HookManagerContracts.cpp HookManager.cpp)",
		"target_compile_features(HookManagerContracts PRIVATE cxx_std_20)",
		"target_include_directories(HookManagerContracts PRIVATE . \"" + g_Path.join(g_strProjectRoot, "src").replace(/\\/g, "/").replace(/"/g, '\\"') + "\")",
		"if(MSVC)",
		"\ttarget_compile_options(HookManagerContracts PRIVATE /W4 /WX)",
		"else()",
		"\ttarget_compile_options(HookManagerContracts PRIVATE -Wall -Wextra -Wpedantic -Werror)",
		"endif()",
		"",
	].join("\n"));

	for (const Profile of g_vecProfiles) {
		const strSourcePath = g_Path.join(g_strTemporaryRoot, "HookManager.cpp");
		g_FileSystem.writeFileSync(strSourcePath, g_strGeneratedSource);

		const strBinaryRoot = g_Path.join(g_strTemporaryRoot, Profile.Name);
		RunCommand("cmake", ["-S", g_strTemporaryRoot, "-B", strBinaryRoot, ...Profile.Arguments]);
		RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);

		const strProgram = (process.platform === "win32") ? g_Path.join(strBinaryRoot, "Release/HookManagerContracts.exe") : g_Path.join(strBinaryRoot, "HookManagerContracts");
		RunFixture(strProgram, false);

		const InvalidArgumentsResult = g_ChildProcess.spawnSync(strProgram, ["UnexpectedArgument"], { encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
		g_Assert.equal(InvalidArgumentsResult.status, 2, InvalidArgumentsResult.error?.message ?? (InvalidArgumentsResult.stdout + InvalidArgumentsResult.stderr));
		g_Assert.equal(InvalidArgumentsResult.signal, null, "Invalid arity must not terminate with a signal.");
		g_Assert.match(InvalidArgumentsResult.stderr, /^Usage: HookManagerContracts\b/);
		g_Assert.equal(InvalidArgumentsResult.stdout, "", "Invalid arguments must not execute the fixture.");
		g_Assert.doesNotMatch(InvalidArgumentsResult.stderr, /hook-manager failure:/);

		for (const Mutation of g_vecMutations) {
			g_Assert.equal(g_strSource.split(Mutation.Old).length, 2, Mutation.Name);
			g_FileSystem.writeFileSync(strSourcePath, g_strGeneratedSource.replace(Mutation.Old, () => Mutation.New));
			RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);
			RunFixture(strProgram, true);
			++g_unRejectedMutationCount;
		}

		g_FileSystem.writeFileSync(strSourcePath, g_strGeneratedSource);
		RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);
		RunFixture(strProgram, false);
	}
} finally {
	const strRealTemporaryRoot = g_FileSystem.realpathSync(g_strTemporaryRoot);
	const strRelativeTemporaryRoot = g_Path.relative(g_strBuildRoot, strRealTemporaryRoot);
	g_Assert(!g_Path.isAbsolute(strRelativeTemporaryRoot) && !strRelativeTemporaryRoot.startsWith("..") && /^NativeHookManager-[^/\\]+$/.test(strRelativeTemporaryRoot), "Refuse cleanup outside the exact native fixture directory.");
	g_Assert(!g_FileSystem.lstatSync(g_strTemporaryRoot).isSymbolicLink());
	g_FileSystem.rmSync(strRealTemporaryRoot, { recursive: true, force: true });
}

console.log("HookManager native checks PASS; profiles=" + g_vecProfiles.length + "; compiled regressions=" + g_unRejectedMutationCount + "; actual production implementation/header, runtime callback boundary doubled; V8/live server not exercised; temporary build cleaned.");
