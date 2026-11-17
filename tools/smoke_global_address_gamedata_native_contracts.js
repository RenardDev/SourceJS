#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_strUsage = "Usage: node tools/smoke_global_address_gamedata_native_contracts.js [--help]";
const g_unCommandTimeoutMilliseconds = 600_000;
const g_strGeneratedNoticeAnchor = "// General";
const g_vecMutations = [
	{ Name: "MinimumSignedInteger", X64Only: true, Old: "unMagnitude > (bNegative ? kMaximumNegativeMagnitude : kMaximumPositiveValue)", New: "unMagnitude >= (bNegative ? kMaximumNegativeMagnitude : kMaximumPositiveValue)" },
	{ Name: "OffsetParsing", Old: "if (pOffset && !ParseGlobalAddressGameDataInteger(*pOffset, nOffset))", New: "if (pOffset && ParseGlobalAddressGameDataInteger(*pOffset, nOffset))" },
	{ Name: "WildcardEncoding", Old: "constexpr unsigned char kWildcardByte = 0x2A;", New: "constexpr unsigned char kWildcardByte = 0x00;" },
	{ Name: "ScanChunkOverlap", Old: "unChunkAddress += unCandidateCount;", New: "unChunkAddress += unByteCount;" },
	{ Name: "TransformNullAddress", Old: "if (unMagnitude >= unAddress)", New: "if (unMagnitude > unAddress)" },
];
const g_vecProfiles = (process.platform === "win32") ? [
	{ Name: "Win32", Arguments: ["-G", "Visual Studio 17 2022", "-A", "Win32"] },
	{ Name: "X64", Arguments: ["-G", "Visual Studio 17 2022", "-A", "x64"] },
] : [
	{ Name: "X86", Arguments: ["-DCMAKE_CXX_FLAGS=-m32 -fsanitize=undefined -fno-sanitize-recover=all"] },
	{ Name: "X64", Arguments: ["-DCMAKE_CXX_FLAGS=-m64 -fsanitize=undefined -fno-sanitize-recover=all"] },
];

const g_vecArguments = process.argv.slice(2);
if ((g_vecArguments.length === 1) && (g_vecArguments[0] === "--help")) {
	console.log(g_strUsage);
	process.exit(0);
}

if (g_vecArguments.length !== 0) {
	console.error(g_strUsage);
	process.exit(2);
}

g_Assert(["win32", "linux"].includes(process.platform), "Native GameData tests require Windows or Linux.");
g_Assert(["ia32", "x64"].includes(process.arch), "Native GameData tests require x86/x64 compiler profiles.");

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strSource = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src/sourcejs/GlobalAddressGameData.cpp"), "utf8");
g_Assert.equal(g_strSource.split(g_strGeneratedNoticeAnchor).length, 2);

g_FileSystem.mkdirSync(g_Path.join(g_strProjectRoot, "build"), { recursive: true });

const g_strBuildRoot = g_FileSystem.realpathSync(g_Path.join(g_strProjectRoot, "build"));
const g_strTemporaryRoot = g_FileSystem.mkdtempSync(g_Path.join(g_strBuildRoot, "NativeGlobalAddressGameData-"));

function RunCommand(strCommand, vecArguments) {
	const Result = g_ChildProcess.spawnSync(strCommand, vecArguments, { encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
	g_Assert.equal(Result.status, 0, strCommand + ": " + (Result.error?.message ?? (Result.stdout + Result.stderr)));

	return Result;
}

function WriteSource(strSource) {
	g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "GlobalAddressGameData.cpp"), strSource.replace(g_strGeneratedNoticeAnchor, "// Generated only: native global-address GameData regression source.\n\n" + g_strGeneratedNoticeAnchor));
}

function RunFixture(strProgram, bRegression) {
	const Result = g_ChildProcess.spawnSync(strProgram, [g_strProjectRoot], { encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
	g_Assert.equal(Result.status, bRegression ? 1 : 0, Result.error?.message ?? (Result.stdout + Result.stderr));
	g_Assert.doesNotMatch(Result.stderr, /GameDataFixture\.RemovePath failed|MappedPages\.Release failed/, "Fixture resources must be released without errors");

	if (bRegression) {
		g_Assert.match(Result.stderr, /\[native\] global-address failure:/, "Compiled regression must fail a native assertion.");
	} else {
		g_Assert.match(Result.stdout, /\[native\] packaged global-address INI, architecture, pattern, mapping, indirection and overflow scenarios passed/);
	}
}

let g_unRejectedMutationCount = 0;

try {
	const strBladeGameData = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "packaging/runtime/addons/sourcejs/data/sourcejs/memory/blade/GlobalAddresses.ini"), "utf8");
	const vecBladeOffsetSpellings = [...strBladeGameData.matchAll(/^offset_windows = ([^\r\n]+)$/gm)].map(vecMatch => vecMatch[1]);
	g_Assert.deepEqual(vecBladeOffsetSpellings, ["0x14", "0x20", "0x08", "0x13"], "Blade global-address offsets must use canonical hexadecimal without changing their values.");

	const strBMSGameData = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "packaging/runtime/addons/sourcejs/data/sourcejs/memory/bms/GlobalAddresses.ini"), "utf8");
	const vecBMSOffsetSpellings = [...strBMSGameData.matchAll(/^offset_windows = ([^\r\n]+)$/gm)].map(vecMatch => vecMatch[1]);
	g_Assert.deepEqual(vecBMSOffsetSpellings, ["0x0B"], "BMS global-address offsets must use canonical hexadecimal without changing their values.");

	const strCSGOGameData = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "packaging/runtime/addons/sourcejs/data/sourcejs/memory/csgo/GlobalAddresses.ini"), "utf8");
	const vecCSGOOffsetSpellings = [...strCSGOGameData.matchAll(/^(?:accessor_)?offset_(?:windows|linux) = ([^\r\n]+)$/gm)].map(vecMatch => vecMatch[1]);
	g_Assert.deepEqual(vecCSGOOffsetSpellings, ["0x06", "0x0F", "0x0B", "0x65", "0x0E", "0x08", "0x0B", "0x04", "0x14"], "CSGO global-address offsets must use canonical hexadecimal without changing their values.");

	const strGModGameData = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "packaging/runtime/addons/sourcejs/data/sourcejs/memory/gmod/GlobalAddresses.ini"), "utf8");
	const vecGModOffsetSpellings = [...strGModGameData.matchAll(/^offset_windows = ([^\r\n]+)$/gm)].map(vecMatch => vecMatch[1]);
	g_Assert.deepEqual(vecGModOffsetSpellings, ["0x07", "0x1A", "0x03"], "GMod global-address offsets must use canonical hexadecimal without changing their values.");

	const strL4D2GameData = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "packaging/runtime/addons/sourcejs/data/sourcejs/memory/l4d2/GlobalAddresses.ini"), "utf8");
	const vecL4D2OffsetSpellings = [...strL4D2GameData.matchAll(/^offset_windows = ([^\r\n]+)$/gm)].map(vecMatch => vecMatch[1]);
	g_Assert.deepEqual(vecL4D2OffsetSpellings, ["0x14", "0x31", "0x1B", "0x13"], "L4D2 global-address offsets must use canonical hexadecimal without changing their values.");

	const strOrangeBoxGameData = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "packaging/runtime/addons/sourcejs/data/sourcejs/memory/orangebox/GlobalAddresses.ini"), "utf8");
	const vecOrangeBoxOffsetSpellings = [...strOrangeBoxGameData.matchAll(/^offset_windows = ([^\r\n]+)$/gm)].map(vecMatch => vecMatch[1]);
	g_Assert.deepEqual(vecOrangeBoxOffsetSpellings, ["0x0B"], "OrangeBox global-address offsets must use canonical hexadecimal without changing their values.");

	g_FileSystem.copyFileSync(g_Path.join(__dirname, "native_global_address_gamedata.cpp"), g_Path.join(g_strTemporaryRoot, "GlobalAddressGameDataContracts.cpp"));
	g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "CMakeLists.txt"), [
		"# Generated only: native global-address GameData regression project.",
		"cmake_minimum_required(VERSION 3.20)",
		"project(GlobalAddressGameDataContracts LANGUAGES CXX)",
		"add_executable(GlobalAddressGameDataContracts GlobalAddressGameDataContracts.cpp GlobalAddressGameData.cpp)",
		"target_compile_features(GlobalAddressGameDataContracts PRIVATE cxx_std_20)",
		"target_include_directories(GlobalAddressGameDataContracts PRIVATE \"" + g_Path.join(g_strProjectRoot, "src").replace(/\\/g, "/").replace(/"/g, '\\"') + "\")",
		"if(MSVC)",
		"\ttarget_compile_options(GlobalAddressGameDataContracts PRIVATE /W4 /WX)",
		"else()",
		"\ttarget_compile_options(GlobalAddressGameDataContracts PRIVATE -Wall -Wextra -Wpedantic -Werror)",
		"endif()",
		"",
	].join("\n"));

	for (const Profile of g_vecProfiles) {
		WriteSource(g_strSource);

		const strBinaryRoot = g_Path.join(g_strTemporaryRoot, Profile.Name);
		RunCommand("cmake", ["-S", g_strTemporaryRoot, "-B", strBinaryRoot, ...Profile.Arguments]);
		RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);

		const strProgram = (process.platform === "win32") ? g_Path.join(strBinaryRoot, "Release/GlobalAddressGameDataContracts.exe") : g_Path.join(strBinaryRoot, "GlobalAddressGameDataContracts");
		RunFixture(strProgram, false);

		for (const vecInvalidArguments of [[], [g_strProjectRoot, "UnexpectedArgument"]]) {
			const InvalidArgumentsResult = g_ChildProcess.spawnSync(strProgram, vecInvalidArguments, { encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
			g_Assert.equal(InvalidArgumentsResult.status, 2, InvalidArgumentsResult.error?.message ?? (InvalidArgumentsResult.stdout + InvalidArgumentsResult.stderr));
			g_Assert.equal(InvalidArgumentsResult.signal, null, "Invalid arity must not terminate with a signal");
			g_Assert.match(InvalidArgumentsResult.stderr, /^Usage: native_global_address_gamedata /m);
			g_Assert.doesNotMatch(InvalidArgumentsResult.stdout + InvalidArgumentsResult.stderr, /scenarios passed|global-address failure:/);
		}

		for (const Mutation of g_vecMutations) {
			// INT64_MIN can be accepted as an address offset only with native 64-bit ptrdiff_t.
			if (Mutation.X64Only && (Profile.Name !== "X64")) {
				continue;
			}

			g_Assert.equal(g_strSource.split(Mutation.Old).length, 2, Mutation.Name);
			WriteSource(g_strSource.replace(Mutation.Old, () => Mutation.New));
			RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);
			RunFixture(strProgram, true);
			++g_unRejectedMutationCount;
		}

		WriteSource(g_strSource);
		RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);
		RunFixture(strProgram, false);
	}
} finally {
	const strRealTemporaryRoot = g_FileSystem.realpathSync(g_strTemporaryRoot);
	const strRelativeTemporaryRoot = g_Path.relative(g_strBuildRoot, strRealTemporaryRoot);
	g_Assert(!g_Path.isAbsolute(strRelativeTemporaryRoot) && !strRelativeTemporaryRoot.startsWith("..") && /^NativeGlobalAddressGameData-[^/\\]+$/.test(strRelativeTemporaryRoot), "Refuse cleanup outside the exact native fixture directory.");
	g_Assert(!g_FileSystem.lstatSync(g_strTemporaryRoot).isSymbolicLink());
	g_FileSystem.rmSync(strRealTemporaryRoot, { recursive: true, force: true });
}

console.log("Global-address GameData native checks PASS; profiles=" + g_vecProfiles.length + "; compiled regressions=" + g_unRejectedMutationCount + "; actual production implementation/header, packaged INI data and OS memory mappings/reads; live SDK/server not exercised; temporary build cleaned.");
