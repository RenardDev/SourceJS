#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_unUniqueTargetSplitPartCount = 2;
const g_unProcessTimeoutMilliseconds = 240000;
const g_unMaximumProcessOutputBytes = 16 * 1024 * 1024;
const g_unMaximumParallelBuildJobs = 2;

const g_vecArguments = process.argv.slice(2);
if ((g_vecArguments.length > 1) || ((g_vecArguments.length === 1) && (g_vecArguments[0] !== "--debug"))) {
	console.error("Usage: node tools/smoke_memory_binary_native_contracts.js [--debug]");
	process.exit(2);
}

g_Assert(["win32", "linux"].includes(process.platform), "Requires Windows/Linux x86/x64 compilers.");

const g_strConfiguration = (g_vecArguments.length === 1) ? "Debug" : "Release";
const g_strRoot = g_Path.resolve(__dirname, "..");
const g_strSource = g_FileSystem.readFileSync(g_Path.join(g_strRoot, "src/sourcejs/modules/ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_strTemplate = g_FileSystem.readFileSync(g_Path.join(__dirname, "fixtures/MemoryBinaryGameData.cpp"), "utf8");

function Extract(strStart, strEnd, strSource = g_strSource) {
	g_Assert.equal(strSource.split(strStart).length, g_unUniqueTargetSplitPartCount, "Unique helper start required.");
	const nStart = strSource.indexOf(strStart);
	const nEnd = strSource.indexOf(strEnd, nStart + strStart.length);
	g_Assert(nEnd > nStart, "Bounded helper end required.");

	return strSource.slice(nStart, nEnd).replace(/^\t/gm, "");
}

function ReplaceOnce(strSource, strOld, strNew) {
	g_Assert.equal(strSource.split(strOld).length, g_unUniqueTargetSplitPartCount, "Unique mutation target: " + strOld);

	return strSource.replace(strOld, () => strNew);
}

function VerifyLiteralReplacement() {
	const strReplacement = "$&$$$`$'$1$<Name>";
	g_Assert.equal(ReplaceOnce("Before TARGET After", "TARGET", strReplacement), "Before " + strReplacement + " After");
}

VerifyLiteralReplacement();

const g_strBinaryResolver = Extract("\n\t\tstruct MemoryManagerBinaryInformation {", "\n#if defined(SOURCEJS_HAS_ISERVER)").replace(/^\t/gm, "");
g_Assert.doesNotMatch(g_strBinaryResolver, /SDKTools/i, "The native binary lookup must not depend on SDKTools.");
let g_strHelpers = g_strBinaryResolver + "\n\n" + Extract("\t\tstruct SourceModIServerGameData {", "\n\t\tSourceJSKeyValuesOwner LoadSDKToolsGameData(") + "\n\n" + Extract("\t\tbool ConvertSourceModPatternHexDigit(", "\n\t\tbool GetSourceModPatternByteCount(");

for (const Insertion of [
	{ Indent: "\t\t\t", Call: "vecBinaryInformations.push_back(std::move(BinaryInformation));" },
	{ Indent: "\t\t", Call: "pCollection->m_vecBinaryInformations.push_back(std::move(BinaryInformation));" },
]) {
	const strInsertion = "\n" + Insertion.Indent + Insertion.Call;
	const strFault = "\n" + Insertion.Indent + "if (g_bFailCollection) {\n" + Insertion.Indent + '\tthrow std::runtime_error("Controlled insertion failure");\n' + Insertion.Indent + "}\n";
	g_strHelpers = ReplaceOnce(g_strHelpers, strInsertion, strFault + strInsertion);
}

const g_strMarker = "\t// SOURCEJS_MEMORY_BINARY_HELPERS";
g_Assert.equal(g_strTemplate.split(g_strMarker).length, g_unUniqueTargetSplitPartCount);

function MakeFixtureSource(strHelpers, bMutation) {
	let strProgram = g_strTemplate.replace(g_strMarker, () => strHelpers);
	if ((process.platform === "win32") && bMutation) {
		const strMain = "int main(const int nArgumentCount, char** ppszArguments) {";
		g_Assert.equal(strProgram.split(strMain).length, g_unUniqueTargetSplitPartCount);
		// Actual MSVC C4702: a known mutant failure makes main's success print unreachable.
		// Scope only to generated negative-control main, never positive or production helpers.
		strProgram = strProgram.replace(strMain, "#pragma warning(push)\n#pragma warning(disable: 4702)\n" + strMain);
		strProgram += "\n#pragma warning(pop)\n";
	}

	return strProgram;
}

function Run(strCommand, vecArguments) {
	const Result = g_ChildProcess.spawnSync(strCommand, vecArguments, { encoding: "utf8", windowsHide: true, timeout: g_unProcessTimeoutMilliseconds, maxBuffer: g_unMaximumProcessOutputBytes });
	g_Assert(!Result.error, Result.error?.message);
	g_Assert.equal(Result.signal, null, "Unexpected process signal: " + Result.signal);

	return Result;
}

function RequireSuccess(strCommand, vecArguments) {
	const Result = Run(strCommand, vecArguments);
	g_Assert.equal(Result.status, 0, Result.stdout + Result.stderr);
	g_Assert(!/\bwarning(?: C\d+| LNK\d+|:)/i.test(Result.stdout + Result.stderr), "New native fixture warning.\n" + Result.stdout + Result.stderr);

	return Result;
}

const g_vecProfiles = (process.platform === "win32") ? [
	{ Name: "Win32", Arguments: ["-G", "Visual Studio 17 2022", "-A", "Win32"] },
	{ Name: "X64", Arguments: ["-G", "Visual Studio 17 2022", "-A", "x64"] },
] : [
	{ Name: "X86", Arguments: ["-DCMAKE_CXX_FLAGS=-m32 -fsanitize=undefined -fno-sanitize-recover=all"] },
	{ Name: "X64", Arguments: ["-DCMAKE_CXX_FLAGS=-m64 -fsanitize=undefined -fno-sanitize-recover=all"] },
];

const g_vecMutations = [
	{ Name: "GameDataDefault", Old: "m_nWindowsAddressOffset = -1;", New: "m_nWindowsAddressOffset = 0;" },
	{ Name: "ByteOrderMark", Old: "strSource.size() >= kUTF8ByteOrderMarkByteCount", New: "strSource.empty()" },
	{ Name: "ByteCursor", Old: "unCharacterIndex += kEscapedByteCharacterCount;", New: "unCharacterIndex += 1;" },
	{ Name: "ByteValue", Old: "unPatternByteOut = static_cast<unsigned char>((unHighNibble << kNibbleBitCount) | unLowNibble);", New: "unPatternByteOut = static_cast<unsigned char>(((unHighNibble << kNibbleBitCount) | unLowNibble) ^ 1);" },
	...((process.platform === "linux") ? [
		{ Name: "LibraryReference", Old: "std::unique_ptr<void, MemoryManagerDynamicLibraryCloser> const pDynamicLibraryHandle(bHasModuleName ? hDynamicLibraryHandle : nullptr);", New: "" },
		{ Name: "LocalELFSymbol", Old: "return ResolveMemoryManagerELFImageSymbol(vecBytes, BinaryInformation, strSymbolName, unSymbolAddressOut, unExpectedFunctionAddress);", New: "return ResolveMemoryManagerELFImageSymbol(vecBytes, BinaryInformation, strSymbolName, unSymbolAddressOut, unExpectedFunctionAddress) && false;" },
		{ Name: "ELFRelocationBias", Old: "const std::uint64_t unRelativeAddress = Symbol.st_value - unMinimumVirtualAddress;", New: "const std::uint64_t unRelativeAddress = Symbol.st_value;" },
		{ Name: "ELFAmbiguousSymbol", Old: "if (bFoundSymbol && (unCandidateAddress != unResolvedAddress)) {", New: "if (bFoundSymbol && (unCandidateAddress == unResolvedAddress)) {" },
		{ Name: "ELFAddressOverflow", Old: "unVirtualAddress > (kMaximumAddress - unModuleBaseAddress)", New: "false" },
		{ Name: "ELFSizeOverflow", Old: "unSegmentByteSize > (kMaximumAddress - unSegmentBeginAddress)", New: "false" },
		{ Name: "LoaderStop", Old: "return kStopIteration;", New: "return kStopIteration - 1;" },
	] : []),
];

let g_unRejectedMutations = 0;
const g_strBuildRoot = g_FileSystem.realpathSync(g_Path.join(g_strRoot, "build"));
const g_strDirectory = g_FileSystem.mkdtempSync(g_Path.join(g_strBuildRoot, "NativeMemoryBinary-"));
try {
	const strProgramPath = g_Path.join(g_strDirectory, "MemoryBinaryGameData.cpp");
	g_FileSystem.copyFileSync(g_Path.join(__dirname, "fixtures/MemoryBinaryLibrary.cpp"), g_Path.join(g_strDirectory, "MemoryBinaryLibrary.cpp"));
	g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, "FixtureLibrary.def"), "EXPORTS\n\tSourceJSNativeBinaryProbe\n");
	g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, "CMakeLists.txt"), `cmake_minimum_required(VERSION 3.20)
project(MemoryBinaryGameData LANGUAGES CXX)
add_library(FixtureLibrary SHARED MemoryBinaryLibrary.cpp)
add_executable(MemoryBinaryGameData MemoryBinaryGameData.cpp)
target_compile_features(FixtureLibrary PRIVATE cxx_std_20)
target_compile_features(MemoryBinaryGameData PRIVATE cxx_std_20)
if(MSVC)
	target_sources(FixtureLibrary PRIVATE FixtureLibrary.def)
	target_compile_options(FixtureLibrary PRIVATE /W4 /WX /EHsc /permissive- /Zc:__cplusplus)
	target_compile_options(MemoryBinaryGameData PRIVATE /W4 /WX /EHsc /permissive- /Zc:__cplusplus)
else()
	target_compile_options(FixtureLibrary PRIVATE -Wall -Wextra -Wpedantic -Werror)
	target_compile_options(MemoryBinaryGameData PRIVATE -Wall -Wextra -Wpedantic -Werror)
	target_link_libraries(MemoryBinaryGameData PRIVATE dl)
endif()
`);

	for (const Profile of g_vecProfiles) {
		const strBinaryRoot = g_Path.join(g_strDirectory, Profile.Name);
		g_FileSystem.writeFileSync(strProgramPath, MakeFixtureSource(g_strHelpers, false));
		const vecConfiguration = (process.platform === "linux") ? ["-DCMAKE_BUILD_TYPE=" + g_strConfiguration] : [];
		RequireSuccess("cmake", ["-S", g_strDirectory, "-B", strBinaryRoot, ...vecConfiguration, ...Profile.Arguments]);

		const strExecutable = g_Path.join(strBinaryRoot, (process.platform === "win32") ? (g_strConfiguration + "/MemoryBinaryGameData.exe") : "MemoryBinaryGameData");
		const strLibrary = g_Path.join(strBinaryRoot, (process.platform === "win32") ? (g_strConfiguration + "/FixtureLibrary.dll") : "libFixtureLibrary.so");
		const vecCases = [
			{ Name: "Current", Source: g_strHelpers },
			...g_vecMutations.map(Mutation => ({ Name: Mutation.Name, Source: ReplaceOnce(g_strHelpers, Mutation.Old, Mutation.New) })),
		];
		for (const Case of vecCases) {
			console.log("Memory binary native " + Profile.Name + " " + g_strConfiguration + " " + Case.Name + ": compiling");
			g_FileSystem.writeFileSync(strProgramPath, MakeFixtureSource(Case.Source, Case.Name !== "Current"));
			RequireSuccess("cmake", ["--build", strBinaryRoot, "--config", g_strConfiguration, "--parallel", String(g_unMaximumParallelBuildJobs)]);

			const Result = Run(strExecutable, [strLibrary]);
			g_Assert.equal(Result.status, (Case.Name === "Current") ? 0 : 1, Case.Name + ": compiled runtime assertion required.\n" + Result.stdout + Result.stderr);

			if (Case.Name === "Current") {
				g_Assert.match(Result.stdout, /^MemoryBinaryGameData PASS:/);

			} else {
				g_Assert.match(Result.stderr, /^MemoryBinaryGameData failed:/);
				++g_unRejectedMutations;
			}
		}
	}
} finally {
	const strResolved = g_FileSystem.realpathSync(g_strDirectory);
	g_Assert.equal(g_Path.dirname(strResolved), g_strBuildRoot, "Cleanup stays within the actual build root.");
	g_Assert(g_Path.basename(strResolved).startsWith("NativeMemoryBinary-"), "Cleanup stays within the exact fixture family.");
	g_Assert(!g_FileSystem.lstatSync(g_strDirectory).isSymbolicLink());
	g_FileSystem.rmSync(strResolved, { recursive: true, force: true });
}

console.log("Memory binary/GameData native checks PASS: x86/x64 " + g_strConfiguration + ", compiled mutations rejected=" + g_unRejectedMutations + "; actual OS lookup/cleanup, controlled insertion failures, pure parsing helpers; no SDK/engine/OOM claim.");
