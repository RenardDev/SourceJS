#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

if (process.argv.length > 2) {
	const bHelpRequested = (process.argv.length === 3) && ((process.argv[2] === "--help") || (process.argv[2] === "-h"));
	console[bHelpRequested ? "log" : "error"]("Usage: node tools/smoke_netchannel_buffer_storage.js");
	process.exit(bHelpRequested ? 0 : 2);
}

const g_strProjectRoot = g_Path.resolve(__dirname, "..");

function GetDisplayPath(strPath) {
	return g_Path.relative(process.cwd(), strPath) || ".";
}

function GetCompilerProfiles() {
	if (process.platform === "win32") {
		const strArchitecture = (process.arch === "arm64") ? "ARM64" : ((process.arch === "ia32") ? "Win32" : "x64");
		const vecProfiles = [{ Name: (strArchitecture === "Win32") ? "X86" : strArchitecture.toUpperCase(), AddressByteCount: (strArchitecture === "Win32") ? 4 : 8, Arguments: ["-G", "Visual Studio 17 2022", "-A", strArchitecture] }];
		if (process.arch === "x64") {
			vecProfiles.unshift({ Name: "X86", AddressByteCount: 4, Arguments: ["-G", "Visual Studio 17 2022", "-A", "Win32"] });
		}

		return vecProfiles;
	}

	if ((process.platform === "linux") && (process.arch === "x64")) {
		return [
			{ Name: "X86", AddressByteCount: 4, Arguments: ["-DCMAKE_CXX_FLAGS=-m32"] },
			{ Name: "X64", AddressByteCount: 8, Arguments: ["-DCMAKE_CXX_FLAGS=-m64"] },
		];
	}

	return [{ Name: "Native", AddressByteCount: 0, Arguments: [] }];
}

function RunCommand(strCommand, vecArguments, nExpectedExitCode = 0) {
	const unTimeoutMilliseconds = 120000;
	const Result = g_ChildProcess.spawnSync(strCommand, vecArguments, { cwd: g_strProjectRoot, encoding: "utf8", windowsHide: true, timeout: unTimeoutMilliseconds });
	g_Assert.ifError(Result.error);
	g_Assert.equal(Result.signal, null, GetDisplayPath(strCommand) + ": unexpected signal.");
	g_Assert.equal(Result.status, nExpectedExitCode, GetDisplayPath(strCommand) + ": " + Result.stdout + Result.stderr);
	g_Assert.doesNotMatch(Result.stdout + Result.stderr, /\bwarning(?:\s+[A-Z]+\d+)?\s*:/i, "Unexpected storage fixture warning.");
	g_Assert.doesNotMatch(Result.stderr, /runtime error:|UndefinedBehaviorSanitizer|AddressSanitizer/i, "Storage regressions must reach the native oracle, not a sanitizer failure.");

	return Result;
}

function CheckProgramCLI(strProgram) {
	const Result = RunCommand(strProgram, ["--invalid"], 2);
	g_Assert.equal(Result.stdout, "");
	g_Assert.equal(Result.stderr.trim(), "Usage: NetChannelBitBufferStorage");
}

function Run() {
	const strSource = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
	const vecDefinitionMatches = /^(\t{1,2})bool PrepareNetChannelBitBufferStorage\([^\n]+\) \{/m.exec(strSource);
	g_Assert(vecDefinitionMatches, "Current native storage helper missing.");

	const strClosingLine = "\n" + vecDefinitionMatches[1] + "}";
	const nDefinitionEnd = strSource.indexOf(strClosingLine + "\n", vecDefinitionMatches.index);
	g_Assert(nDefinitionEnd > vecDefinitionMatches.index, "Current native storage helper end missing.");

	const strDefinition = strSource.slice(vecDefinitionMatches.index, nDefinitionEnd + strClosingLine.length);
	const strContractView = strDefinition.split("\n").map(strLine => strLine.startsWith(vecDefinitionMatches[1]) ? ("\t" + strLine.slice(vecDefinitionMatches[1].length)) : strLine).join("\n");
	const strRoundTrip = strContractView.split("\n").map(strLine => strLine.startsWith("\t") ? (vecDefinitionMatches[1] + strLine.slice(1)) : strLine).join("\n");
	g_Assert.equal(strRoundTrip, strDefinition, "The compiled storage view must round-trip to the actual helper.");

	const strBuildDirectory = g_Path.join(g_strProjectRoot, "build");
	g_FileSystem.mkdirSync(strBuildDirectory, { recursive: true });

	const strBuildRoot = g_FileSystem.realpathSync(strBuildDirectory);
	const vecProfiles = GetCompilerProfiles();
	let unRejectedMutationCount = 0;
	const strTemporaryRoot = g_FileSystem.mkdtempSync(g_Path.join(strBuildRoot, "NativeNetChannelStorage-"));
	try {
		const strHeader = [
			"#pragma once",
			"",
			"// Generated only: indentation-normalized current helper; no SDK/V8 dependencies.",
			"// C++",
			"#include <cstddef>",
			"#include <cstdint>",
			"#include <cstring>",
			"#include <utility>",
			"",
			"// STL",
			"#include <algorithm>",
			"#include <limits>",
			"#include <type_traits>",
			"#include <vector>",
			"",
			"namespace SourceJSBitBufferStorage {",
			"\t// Preserve the SDK uint32 spelling only for the extracted compatibility check.",
			"\tusing uint32 = std::uint32_t;",
			"",
			strContractView,
			"} // namespace SourceJSBitBufferStorage",
			"",
		].join("\n");
		const strHeaderPath = g_Path.join(strTemporaryRoot, "NetChannelBitBufferStorage.h");
		g_FileSystem.writeFileSync(strHeaderPath, strHeader);

		const strFixture = g_Path.join(g_strProjectRoot, "tools", "fixtures", "NetChannelBitBufferStorage.cpp").replace(/\\/g, "/");
		const strInclude = strTemporaryRoot.replace(/\\/g, "/");
		g_Assert.doesNotMatch(strFixture + strInclude, /[$";\n\r]/, "Unsupported CMake path.");

		const strCMake = [
			"# Generated only: native bit-buffer storage regression project.",
			"cmake_minimum_required(VERSION 3.20)",
			"project(SourceJSNetChannelStorage LANGUAGES CXX)",
			"if(DEFINED SOURCEJS_TEST_ADDRESS_BYTE_COUNT)",
			"\tif(NOT CMAKE_SIZEOF_VOID_P EQUAL SOURCEJS_TEST_ADDRESS_BYTE_COUNT)",
			'\t\tmessage(FATAL_ERROR "Requested storage fixture bitness was not selected")',
			"\tendif()",
			"endif()",
			'add_executable(NetChannelBitBufferStorage "' + strFixture + '")',
			'target_include_directories(NetChannelBitBufferStorage PRIVATE "' + strInclude + '")',
			"target_compile_features(NetChannelBitBufferStorage PRIVATE cxx_std_20)",
			"if(MSVC)",
			"\ttarget_compile_options(NetChannelBitBufferStorage PRIVATE /W4 /WX)",
			"else()",
			"\ttarget_compile_options(NetChannelBitBufferStorage PRIVATE -Wall -Wextra -Wpedantic -Werror -fsanitize=undefined -fno-sanitize-recover=undefined)",
			"\ttarget_link_options(NetChannelBitBufferStorage PRIVATE -fsanitize=undefined -fno-sanitize-recover=undefined)",
			"endif()",
			"",
		].join("\n");
		g_FileSystem.writeFileSync(g_Path.join(strTemporaryRoot, "CMakeLists.txt"), strCMake);

		for (const Profile of vecProfiles) {
			g_FileSystem.writeFileSync(strHeaderPath, strHeader);

			const strBinaryRoot = g_Path.join(strTemporaryRoot, Profile.Name);
			const vecConfigureArguments = ["-S", strTemporaryRoot, "-B", strBinaryRoot, ...Profile.Arguments];
			if (process.platform !== "win32") {
				vecConfigureArguments.push("-DCMAKE_BUILD_TYPE=Release");
			}

			if (Profile.AddressByteCount) {
				vecConfigureArguments.push("-DSOURCEJS_TEST_ADDRESS_BYTE_COUNT=" + Profile.AddressByteCount);
			}

			RunCommand("cmake", vecConfigureArguments);
			RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);

			const strBinary = (process.platform === "win32") ? g_Path.join(strBinaryRoot, "Release", "NetChannelBitBufferStorage.exe") : g_Path.join(strBinaryRoot, "NetChannelBitBufferStorage");
			CheckProgramCLI(strBinary);

			const PositiveResult = RunCommand(strBinary, []);
			g_Assert.match(PositiveResult.stdout, /native storage PASS SizeRange=0\.\.65;/);
			g_Assert.equal(PositiveResult.stderr, "");

			for (const Mutation of [
				{ Name: "MinimumAllocation", Old: "std::max(unWordCount, kMinimumAllocationWordCount)", New: "std::min(unWordCount, kMinimumAllocationWordCount)", Diagnostic: "NetChannelBitBufferStorage failed Scenario=AlignmentOrCapacity Size=0" },
				{ Name: "CopiedBytes", Old: "std::memcpy(vecWords.data(), vecBytes.data(), vecBytes.size());", New: "std::memset(vecWords.data(), 0, vecBytes.size());", Diagnostic: "NetChannelBitBufferStorage failed Scenario=CopyOrPadding Size=1 Index=0" },
				{ Name: "RoundedWordCount", Old: "(vecBytes.size() + (kWordByteCount - 1)) / kWordByteCount", New: "vecBytes.size() / kWordByteCount", Diagnostic: "NetChannelBitBufferStorage failed Scenario=AlignmentOrCapacity Size=1" },
			]) {
				g_Assert.equal(strHeader.split(Mutation.Old).length, 2, Mutation.Name + ": require one regression anchor.");
				g_FileSystem.writeFileSync(strHeaderPath, strHeader.replace(Mutation.Old, () => Mutation.New));
				RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);

				const NegativeResult = RunCommand(strBinary, [], 1);
				g_Assert.equal(NegativeResult.stdout, "");
				g_Assert.equal(NegativeResult.stderr.trim(), Mutation.Diagnostic, Mutation.Name + ": reject through its native oracle.");
				++unRejectedMutationCount;
			}

			g_FileSystem.writeFileSync(strHeaderPath, strHeader);
			RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);

			const RestoredResult = RunCommand(strBinary, []);
			g_Assert.match(RestoredResult.stdout, /native storage PASS SizeRange=0\.\.65;/);
			g_Assert.equal(RestoredResult.stderr, "");
			process.stdout.write(Profile.Name + " " + PositiveResult.stdout);
		}
	} finally {
		const strRealRoot = g_FileSystem.realpathSync(strTemporaryRoot);
		const strRelativeRoot = g_Path.relative(strBuildRoot, strRealRoot);
		g_Assert(!g_Path.isAbsolute(strRelativeRoot) && !strRelativeRoot.startsWith("..") && /^NativeNetChannelStorage-[^/\\]+$/.test(strRelativeRoot), "Refuse storage cleanup outside its build-root family.");
		g_Assert.equal(strRelativeRoot, g_Path.basename(strTemporaryRoot), "Only the allocated storage fixture directory may be removed.");
		g_Assert(!g_FileSystem.lstatSync(strTemporaryRoot).isSymbolicLink(), "Refuse a linked storage fixture directory.");
		g_FileSystem.rmSync(strTemporaryRoot, { recursive: true });
	}

	console.log("Native storage PASS Profiles=" + vecProfiles.length + " CompiledRegressions=" + unRejectedMutationCount + "; SDK/V8/game-engine execution not exercised; temporary fixture cleaned.");
}

Run();
