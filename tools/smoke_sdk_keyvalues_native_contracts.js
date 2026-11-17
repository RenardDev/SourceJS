#!/usr/bin/env node

"use strict";

// Compiles the actual SDK adapter with buffer/KeyValues/filesystem doubles.
// No live SDK filesystem, KeyValues parser, or engine ABI is exercised here.
const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

if ((process.argv.length === 3) && ["--help", "-h"].includes(process.argv[2])) {
	console.log("Usage: node tools/smoke_sdk_keyvalues_native_contracts.js [--profile X86|X64]\nCompiles the actual SDK adapter with doubles; does not exercise the live parser, filesystem or engine ABI.");
	process.exit(0);
}

const g_vecArguments = process.argv.slice(2);
let g_strProfile = "";
if (g_vecArguments.length !== 0) {
	if ((g_vecArguments.length !== 2) || (g_vecArguments[0] !== "--profile") || !["X86", "X64"].includes(g_vecArguments[1])) {
		console.error("Usage: node tools/smoke_sdk_keyvalues_native_contracts.js [--profile X86|X64]");
		process.exit(2);
	}

	g_strProfile = g_vecArguments[1];
}

g_Assert(["win32", "linux"].includes(process.platform), "Windows or Linux host required");
const g_strProjectRoot = g_FileSystem.realpathSync(g_Path.resolve(__dirname, ".."));
g_FileSystem.mkdirSync(g_Path.join(g_strProjectRoot, "build"), { recursive: true });

const g_strBuildRoot = g_FileSystem.realpathSync(g_Path.join(g_strProjectRoot, "build"));
const g_strRoot = g_strProjectRoot.replace(/\\/g, "/");
g_Assert(!/[;"\r\n$\]]/.test(g_strRoot), "Unsupported CMake project path");
const g_unTimeoutMilliseconds = 240000;
const g_unOutputLimitBytes = 16 * 1024 * 1024;

function Run(strCommand, vecArguments, unExpectedStatus = 0) {
	const strDisplayCommand = g_Path.isAbsolute(strCommand) ? g_Path.relative(g_strProjectRoot, strCommand) : strCommand;
	const Result = g_ChildProcess.spawnSync(strCommand, vecArguments, { cwd: g_strProjectRoot, encoding: "utf8", windowsHide: true, timeout: g_unTimeoutMilliseconds, maxBuffer: g_unOutputLimitBytes });
	g_Assert(!Result.error, strDisplayCommand + " failed: " + Result.error?.message);
	g_Assert.equal(Result.signal, null, strDisplayCommand + " received native process signal: " + Result.signal);
	g_Assert.equal(Result.status, unExpectedStatus, Result.stdout + Result.stderr);
	g_Assert(!/\bwarning\b/i.test(Result.stdout + Result.stderr), "Native SDK adapter fixture warning:\n" + Result.stdout + Result.stderr);
	g_Assert(!/(?:runtime error:|(?:Address|UndefinedBehavior|Leak|Memory|Thread)Sanitizer|Sanitizer:)/i.test(Result.stdout + Result.stderr), strDisplayCommand + " reported a sanitizer failure:\n" + Result.stdout + Result.stderr);

	return Result;
}

const g_vecProfiles = ((process.platform === "win32") ? [
	{ Name: "X86", AddressByteCount: 4, Arguments: ["-G", "Visual Studio 17 2022", "-A", "Win32"] },
	{ Name: "X64", AddressByteCount: 8, Arguments: ["-G", "Visual Studio 17 2022", "-A", "x64"] },
] : [
	{ Name: "X86", AddressByteCount: 4, Arguments: ["-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_CXX_FLAGS=-m32 -fsanitize=undefined -fno-sanitize-recover=all"] },
	{ Name: "X64", AddressByteCount: 8, Arguments: ["-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_CXX_FLAGS=-m64 -fsanitize=undefined -fno-sanitize-recover=all"] },
]).filter(Profile => !g_strProfile || (Profile.Name === g_strProfile));
const g_strDirectory = g_FileSystem.mkdtempSync(g_Path.join(g_strBuildRoot, "NativeSDKKeyValues-"));
try {
	const strShimDirectory = g_Path.join(g_strDirectory, "Shim");
	g_FileSystem.mkdirSync(g_Path.join(strShimDirectory, "tier1"), { recursive: true });
	for (const Header of [
		{ Path: "filesystem.h", Guard: "_SOURCEJSTESTKEYVALUESFILESYSTEM_H_" },
		{ Path: "tier1/KeyValues.h", Guard: "_SOURCEJSTESTKEYVALUESKEYVALUES_H_" },
		{ Path: "tier1/utlbuffer.h", Guard: "_SOURCEJSTESTKEYVALUESUTLBUFFER_H_" },
	]) {
		const vecHeader = [
			"#pragma once",
			"",
			"#ifndef " + Header.Guard,
			"#define " + Header.Guard,
			"",
			"// Generated test-only SDK include shim; never used by production builds.",
			"// Project",
			'#include "SourceSDKKeyValuesDoubles.h"',
			"",
			"#endif // " + Header.Guard,
		];
		g_FileSystem.writeFileSync(g_Path.join(strShimDirectory, Header.Path), vecHeader.join("\n") + "\n");
	}

	const strBindings = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src/sourcejs/modules/ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
	const nValidatorStart = strBindings.indexOf("\t\tbool IsValidMessagesKeyValuesFieldName(");
	const nValidatorEnd = strBindings.indexOf("\n\t\t}", nValidatorStart);
	g_Assert((nValidatorStart >= 0) && (nValidatorEnd > nValidatorStart), "Locate actual dialog field-name validator");
	const strValidator = strBindings.slice(nValidatorStart, nValidatorEnd + "\n\t\t}".length).split("\n").map(strLine => strLine.startsWith("\t") ? strLine.slice(1) : strLine).join("\n");
	const vecValidatorHeader = [
		"#pragma once",
		"",
		"#ifndef _SOURCEJSTESTDIALOGFIELDNAMEVALIDATION_H_",
		"#define _SOURCEJSTESTDIALOGFIELDNAMEVALIDATION_H_",
		"",
		"// STL",
		"#include <string>",
		"",
		"namespace DialogFieldNameFixture {",
		strValidator,
		"} // namespace DialogFieldNameFixture",
		"",
		"#endif // _SOURCEJSTESTDIALOGFIELDNAMEVALIDATION_H_",
	];
	g_FileSystem.writeFileSync(g_Path.join(strShimDirectory, "DialogFieldNameValidation.h"), vecValidatorHeader.join("\n") + "\n");

	const vecConfiguration = [
		"cmake_minimum_required(VERSION 3.20)",
		"project(NativeSDKKeyValues LANGUAGES CXX)",
		"set(CMAKE_CXX_STANDARD 20)",
		"set(CMAKE_CXX_STANDARD_REQUIRED ON)",
		"set(CMAKE_CXX_EXTENSIONS OFF)",
		"if(NOT CMAKE_SIZEOF_VOID_P EQUAL SOURCEJS_TEST_ADDRESS_SIZE)",
		'\tmessage(FATAL_ERROR "Requested test bitness was not selected")',
		"endif()",
		'add_executable(Contracts "' + g_strRoot + '/tools/fixtures/SourceSDKKeyValuesContracts.cpp" "' + g_strRoot + '/src/sourcejs/SourceSDKKeyValues.cpp")',
		'target_include_directories(Contracts PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/Shim" "' + g_strRoot + '/tools/fixtures" "' + g_strRoot + '/src")',
		"if(MSVC)",
		"\ttarget_compile_options(Contracts PRIVATE /W4 /WX /EHsc /permissive-)",
		'elseif(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")',
		"\ttarget_compile_options(Contracts PRIVATE -Wall -Wextra -Wpedantic -Werror)",
		"else()",
		'\tmessage(FATAL_ERROR "Unsupported fixture compiler")',
		"endif()",
	];
	g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, "CMakeLists.txt"), vecConfiguration.join("\n") + "\n");
	for (const Profile of g_vecProfiles) {
		const strBuildDirectory = g_Path.join(g_strDirectory, Profile.Name);
		Run("cmake", ["-S", g_strDirectory, "-B", strBuildDirectory, "-DSOURCEJS_TEST_ADDRESS_SIZE=" + Profile.AddressByteCount, ...Profile.Arguments]);
		Run("cmake", ["--build", strBuildDirectory, "--config", "Release", "--parallel", "2"]);

		const strProgram = (process.platform === "win32") ? g_Path.join(strBuildDirectory, "Release", "Contracts.exe") : g_Path.join(strBuildDirectory, "Contracts");
		for (const vecInvalidArguments of [["--extra"], ["--extra", "value"]]) {
			const InvalidResult = Run(strProgram, vecInvalidArguments, 2);
			g_Assert.equal(InvalidResult.stdout, "", "Invalid native CLI must not report a fixture result");
			g_Assert.equal(InvalidResult.stderr.trim(), "Usage: SourceSDKKeyValuesContracts");
		}

		const Result = Run(strProgram, []);
		g_Assert.match(Result.stdout, /SDK KeyValues contracts passed/);
		g_Assert.equal(Result.stderr, "", "Successful SDK adapter fixture reported unexpected stderr");
		console.log(Profile.Name + ": actual SDK KeyValues adapter contracts passed (SDK doubles; no live parser/filesystem).");
	}
} finally {
	const DirectoryStatus = g_FileSystem.lstatSync(g_strDirectory);
	g_Assert(DirectoryStatus.isDirectory() && !DirectoryStatus.isSymbolicLink(), "Fixture cleanup target must be the allocated directory, not a link");

	const strRealDirectory = g_FileSystem.realpathSync(g_strDirectory);
	const strRelativeDirectory = g_Path.relative(g_strBuildRoot, strRealDirectory);
	g_Assert(strRelativeDirectory && !g_Path.isAbsolute(strRelativeDirectory) && !strRelativeDirectory.startsWith("..") && !strRelativeDirectory.includes(g_Path.sep) && (g_Path.basename(strRealDirectory) === g_Path.basename(g_strDirectory)) && g_Path.basename(strRealDirectory).startsWith("NativeSDKKeyValues-"), "Unsafe fixture cleanup target");
	g_FileSystem.rmSync(strRealDirectory, { recursive: true, force: true });
}

console.log("SDK KeyValues adapter contracts passed; compiled profiles=" + g_vecProfiles.map(Profile => Profile.Name).join(",") + "; SDK doubles only; no live parser/filesystem or engine ABI.");
