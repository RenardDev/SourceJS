#!/usr/bin/env node

"use strict";

// Executes the actual translation-unit-private helper definitions extracted
// from PluginManager.cpp. This does not instantiate the manager or exercise
// V8/engine integration. Linux directory reads test a real kernel I/O failure.
const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

if ((process.argv.length === 3) && ["--help", "-h"].includes(process.argv[2])) {
	console.log("Usage: node tools/smoke_plugin_file_helpers.js [--profile X86|X64] [--source-file <CPP>] [--expected-status 0|1]\nCompiles and executes extracted private file helpers; does not instantiate PluginManager, V8 or the server.");
	process.exit(0);
}

const g_vecArguments = process.argv.slice(2);
let g_strProfile = "";
let g_strSourceFile = "";
let g_strExpectedStatus = "";

function PrintUsageAndExit() {
	console.error("Usage: node tools/smoke_plugin_file_helpers.js [--profile X86|X64] [--source-file <CPP>] [--expected-status 0|1]");
	process.exit(2);
}

for (let unArgumentIndex = 0; unArgumentIndex < g_vecArguments.length; unArgumentIndex += 2) {
	const strOption = g_vecArguments[unArgumentIndex];
	const strValue = g_vecArguments[unArgumentIndex + 1];
	if (!strValue || strValue.startsWith("--")) {
		PrintUsageAndExit();
	}

	if (strOption === "--profile") {
		if (g_strProfile || !["X86", "X64"].includes(strValue)) {
			PrintUsageAndExit();
		}

		g_strProfile = strValue;
	} else if (strOption === "--source-file") {
		if (g_strSourceFile) {
			PrintUsageAndExit();
		}

		g_strSourceFile = strValue;
	} else if (strOption === "--expected-status") {
		if (g_strExpectedStatus || !["0", "1"].includes(strValue)) {
			PrintUsageAndExit();
		}

		g_strExpectedStatus = strValue;
	} else {
		PrintUsageAndExit();
	}
}

g_Assert(["win32", "linux"].includes(process.platform), "Windows or Linux host required");
const g_unExpectedStatus = Number(g_strExpectedStatus || "0");
const g_strProjectRoot = g_FileSystem.realpathSync(g_Path.resolve(__dirname, ".."));
g_FileSystem.mkdirSync(g_Path.join(g_strProjectRoot, "build"), { recursive: true });

const g_strBuildRoot = g_FileSystem.realpathSync(g_Path.join(g_strProjectRoot, "build"));
const g_strSourcePath = g_FileSystem.realpathSync(g_strSourceFile ? g_Path.resolve(g_strSourceFile) : g_Path.join(g_strProjectRoot, "src/sourcejs/PluginManager.cpp"));
const g_strSource = g_FileSystem.readFileSync(g_strSourcePath, "utf8").replace(/\r\n/g, "\n");
const g_nStart = g_strSource.indexOf("\tnamespace {\n");
const g_nEnd = g_strSource.indexOf("\n\t} // namespace", g_nStart);
g_Assert((g_nStart >= 0) && (g_nEnd > g_nStart), "Actual private file-helper block");
const g_strHelpers = g_strSource.slice(g_nStart, g_nEnd + "\n\t} // namespace".length);
for (const strName of ["IsDecimalText", "IsValidPluginName", "ReadTextFile", "ReadManifestString", "ReadManifestBoolean", "ContainsName", "RemoveName"]) {
	g_Assert(g_strHelpers.includes(strName + "("), "Actual helper definition: " + strName);
}

const g_strRoot = g_strProjectRoot.replace(/\\/g, "/");
g_Assert(!/[;"\r\n$]/.test(g_strRoot), "Unsupported CMake project path");
const g_unCommandTimeoutMilliseconds = 240000;
const g_unOutputLimitBytes = 16 * 1024 * 1024;

function Run(strCommand, vecArguments) {
	const strDisplayCommand = g_Path.isAbsolute(strCommand) ? g_Path.relative(g_strProjectRoot, strCommand) : strCommand;
	const Result = g_ChildProcess.spawnSync(strCommand, vecArguments, { cwd: g_strProjectRoot, encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds, maxBuffer: g_unOutputLimitBytes });
	g_Assert(!Result.error, strDisplayCommand + " failed: " + Result.error?.message);
	g_Assert.equal(Result.signal, null, strDisplayCommand + " received native process signal: " + Result.signal);
	g_Assert(Number.isInteger(Result.status), strDisplayCommand + " did not report a native exit status");
	g_Assert(!/(?:runtime error:|(?:Address|UndefinedBehavior|Leak|Memory|Thread)Sanitizer|Sanitizer:)/i.test(Result.stdout + Result.stderr), strDisplayCommand + " reported a sanitizer failure:\n" + Result.stdout + Result.stderr);

	return Result;
}

function RequireSuccess(strCommand, vecArguments) {
	const Result = Run(strCommand, vecArguments);
	g_Assert.equal(Result.status, 0, Result.stdout + Result.stderr);
	g_Assert(!/\bwarning\b/i.test(Result.stdout + Result.stderr), "Native file-helper fixture warning:\n" + Result.stdout + Result.stderr);
}

const g_vecProfiles = ((process.platform === "win32") ? [
	{ Name: "X86", AddressByteCount: 4, Arguments: ["-G", "Visual Studio 17 2022", "-A", "Win32"] },
	{ Name: "X64", AddressByteCount: 8, Arguments: ["-G", "Visual Studio 17 2022", "-A", "x64"] },
] : [
	{ Name: "X86", AddressByteCount: 4, Arguments: ["-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_CXX_FLAGS=-m32 -fsanitize=undefined -fno-sanitize-recover=all"] },
	{ Name: "X64", AddressByteCount: 8, Arguments: ["-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_CXX_FLAGS=-m64 -fsanitize=undefined -fno-sanitize-recover=all"] },
]).filter(Profile => !g_strProfile || (Profile.Name === g_strProfile));
const g_strDirectory = g_FileSystem.mkdtempSync(g_Path.join(g_strBuildRoot, "NativePluginFileHelpers-"));
try {
	const vecHeader = [
		"#pragma once",
		"",
		"#ifndef _SOURCEJSPLUGINFILEHELPERSFIXTURE_H_",
		"#define _SOURCEJSPLUGINFILEHELPERSFIXTURE_H_",
		"",
		"// Generated test-only fragment; requires the fixture's standard headers.",
		"// Project",
		'#include "sourcejs/ManagerManifest.h"',
		"",
		"namespace SourceJS {",
		g_strHelpers,
		"} // namespace SourceJS",
		"",
		"#endif // _SOURCEJSPLUGINFILEHELPERSFIXTURE_H_",
	];
	g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, "PluginFileHelpers.h"), vecHeader.join("\n") + "\n");
	const vecConfiguration = [
		"cmake_minimum_required(VERSION 3.20)",
		"project(NativePluginFileHelpers LANGUAGES CXX)",
		"set(CMAKE_CXX_STANDARD 20)",
		"set(CMAKE_CXX_STANDARD_REQUIRED ON)",
		"set(CMAKE_CXX_EXTENSIONS OFF)",
		"if(NOT CMAKE_SIZEOF_VOID_P EQUAL SOURCEJS_TEST_ADDRESS_SIZE)",
		'\tmessage(FATAL_ERROR "Requested test bitness was not selected")',
		"endif()",
		'add_executable(Contracts "' + g_strRoot + '/tools/fixtures/PluginFileHelpersContracts.cpp")',
		'target_include_directories(Contracts PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}" "' + g_strRoot + '/src")',
		"if(MSVC)",
		"\ttarget_compile_options(Contracts PRIVATE /W4 /WX /EHsc /permissive-)",
		"elseif(CMAKE_CXX_COMPILER_ID MATCHES \"GNU|Clang\")",
		"\ttarget_compile_options(Contracts PRIVATE -Wall -Wextra -Wpedantic -Werror)",
		"else()",
		'\tmessage(FATAL_ERROR "Unsupported fixture compiler")',
		"endif()",
	];
	g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, "CMakeLists.txt"), vecConfiguration.join("\n") + "\n");
	for (const Profile of g_vecProfiles) {
		const strBuildDirectory = g_Path.join(g_strDirectory, Profile.Name);
		const strFilesDirectory = g_Path.join(g_strDirectory, "Files-" + Profile.Name);
		g_FileSystem.mkdirSync(strFilesDirectory);
		RequireSuccess("cmake", ["-S", g_strDirectory, "-B", strBuildDirectory, "-DSOURCEJS_TEST_ADDRESS_SIZE=" + Profile.AddressByteCount, ...Profile.Arguments]);
		RequireSuccess("cmake", ["--build", strBuildDirectory, "--config", "Release", "--parallel", "2"]);

		const strProgram = (process.platform === "win32") ? g_Path.join(strBuildDirectory, "Release", "Contracts.exe") : g_Path.join(strBuildDirectory, "Contracts");
		for (const vecInvalidArguments of [[], [strFilesDirectory, "--extra"]]) {
			const InvalidResult = Run(strProgram, vecInvalidArguments);
			g_Assert.equal(InvalidResult.status, 2, InvalidResult.stdout + InvalidResult.stderr);
			g_Assert.equal(InvalidResult.stdout, "", "Invalid native CLI must not report a fixture result");
			g_Assert.equal(InvalidResult.stderr.trim(), "Usage: PluginFileHelpersContracts <fixture-directory>");
		}

		const Result = Run(strProgram, [strFilesDirectory]);
		g_Assert.equal(Result.status, g_unExpectedStatus, Result.stdout + Result.stderr);
		if (g_unExpectedStatus === 0) {
			g_Assert.match(Result.stdout, /Plugin file-helper contracts passed/);
			g_Assert.equal(Result.stderr, "", "Successful file-helper fixture reported unexpected stderr");
		} else {
			g_Assert.match(Result.stderr, /Plugin file-helper contract failed: directory read must fail/);
			g_Assert.equal(Result.stdout, "", "Failed file-helper fixture must not report success");
		}

		console.log(Profile.Name + ": compiled extracted file-helper contracts checked; expected status=" + g_unExpectedStatus);
	}
} finally {
	const DirectoryStatus = g_FileSystem.lstatSync(g_strDirectory);
	g_Assert(DirectoryStatus.isDirectory() && !DirectoryStatus.isSymbolicLink(), "Fixture cleanup target must be the allocated directory, not a link");

	const strRealDirectory = g_FileSystem.realpathSync(g_strDirectory);
	const strRelativeDirectory = g_Path.relative(g_strBuildRoot, strRealDirectory);
	g_Assert(strRelativeDirectory && !g_Path.isAbsolute(strRelativeDirectory) && !strRelativeDirectory.startsWith("..") && !strRelativeDirectory.includes(g_Path.sep) && (g_Path.basename(strRealDirectory) === g_Path.basename(g_strDirectory)) && g_Path.basename(strRealDirectory).startsWith("NativePluginFileHelpers-"), "Unsafe fixture cleanup target");
	g_FileSystem.rmSync(strRealDirectory, { recursive: true, force: true });
}

console.log("Plugin file-helper contracts passed; compiled profiles=" + g_vecProfiles.map(Profile => Profile.Name).join(",") + "; expected status=" + g_unExpectedStatus + "; no manager/V8/server integration exercised.");
