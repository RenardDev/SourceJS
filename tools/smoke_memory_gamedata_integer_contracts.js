#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_vecArguments = process.argv.slice(2);
if (g_vecArguments.length !== 0) {
	const bHelp = (g_vecArguments.length === 1) && (g_vecArguments[0] === "--help");
	console.log("Usage: node tools/smoke_memory_gamedata_integer_contracts.js [--help]");
	process.exit(bHelp ? 0 : 2);
}

const g_unCommandTimeoutMilliseconds = 600_000;

g_Assert(["win32", "linux"].includes(process.platform), "Native GameData integer tests require Windows or Linux.");
g_Assert(["ia32", "x64"].includes(process.arch), "Native GameData integer tests require x86/x64 compiler profiles.");

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strSource = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_strFixture = g_FileSystem.readFileSync(g_Path.join(__dirname, "fixtures", "MemoryGameDataIntegerContracts.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_strFixtureMarker = "\t// SOURCEJS_MEMORY_GAMEDATA_INTEGER_HELPER";
const g_vecDefinitionMatch = /^(\t{1,2})bool ParseMemoryManagerInt32FromString\([^\n]+\) noexcept \{$/m.exec(g_strSource);
g_Assert(g_vecDefinitionMatch, "Compile the exact production parser, not a test reimplementation.");

const g_strParserClosingLine = "\n" + g_vecDefinitionMatch[1] + "}";
const g_nDefinitionEndIndex = g_strSource.indexOf(g_strParserClosingLine + "\n", g_vecDefinitionMatch.index);
g_Assert(g_nDefinitionEndIndex > g_vecDefinitionMatch.index);

const g_strActualParser = g_strSource.slice(g_vecDefinitionMatch.index, g_nDefinitionEndIndex + g_strParserClosingLine.length);
const g_strParser = g_strActualParser.split("\n").map(strLine => strLine.startsWith(g_vecDefinitionMatch[1]) ? "\t" + strLine.slice(g_vecDefinitionMatch[1].length) : strLine).join("\n");
const g_strParserRoundTrip = g_strParser.split("\n").map(strLine => strLine.startsWith("\t") ? g_vecDefinitionMatch[1] + strLine.slice(1) : strLine).join("\n");
g_Assert.equal(g_strParserRoundTrip, g_strActualParser, "The compiled parser view must round-trip to the exact production definition.");

const g_vecMutations = [
	{ Name: "TrailingBytesAccepted", Old: "pszParseEnd != (pszIntegerText + strIntegerText.size())", New: "false" },
	{ Name: "LowerBoundUnchecked", Old: "nParsedIntegerValue < std::numeric_limits<int>::min()", New: "false" },
	{ Name: "UpperBoundUnchecked", Old: "nParsedIntegerValue > std::numeric_limits<int>::max()", New: "false" },
	{ Name: "OutputNotCommitted", Old: "nIntegerValueOut = static_cast<int>(nParsedIntegerValue);", New: "nIntegerValueOut = 0;" },
	{ Name: "StaleErrorNotCleared", Old: "errno = 0;", New: "" },
	{ Name: "SuccessRejected", Old: "\n\t\treturn true;", New: "\n\t\treturn false;" },
];
const g_vecProfiles = (process.platform === "win32") ? [
	{ Name: "Win32", Arguments: ["-G", "Visual Studio 17 2022", "-A", "Win32"] },
	{ Name: "X64", Arguments: ["-G", "Visual Studio 17 2022", "-A", "x64"] },
] : [
	{ Name: "X86", Arguments: ["-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_CXX_FLAGS=-m32 -fsanitize=undefined -fno-sanitize-recover=all"] },
	{ Name: "X64", Arguments: ["-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_CXX_FLAGS=-m64 -fsanitize=undefined -fno-sanitize-recover=all"] },
];

function RunCommand(strCommand, vecArguments) {
	const Result = g_ChildProcess.spawnSync(strCommand, vecArguments, { encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
	g_Assert.equal(Result.status, 0, strCommand + ": " + (Result.error?.message ?? (Result.stdout + Result.stderr)));

	return Result;
}

function VerifyFixtureCLI(strProgram) {
	const Result = g_ChildProcess.spawnSync(strProgram, ["UnexpectedArgument"], { encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
	g_Assert.ifError(Result.error);
	g_Assert.equal(Result.status, 2);
	g_Assert.equal(Result.signal, null);
	g_Assert.equal(Result.stdout, "");
	g_Assert.equal(Result.stderr.replace(/\r\n/g, "\n"), "Usage: MemoryGameDataIntegerContracts\n");
}

g_Assert.equal(g_strFixture.split(g_strFixtureMarker).length, 2);
g_FileSystem.mkdirSync(g_Path.join(g_strProjectRoot, "build"), { recursive: true });
const g_strBuildRoot = g_FileSystem.realpathSync(g_Path.join(g_strProjectRoot, "build"));
const g_strTemporaryRoot = g_FileSystem.mkdtempSync(g_Path.join(g_strBuildRoot, "NativeMemoryGameDataIntegers-"));
const g_strFixturePath = g_Path.join(g_strTemporaryRoot, "MemoryGameDataIntegerContracts.cpp");

function WriteFixture(strParser) {
	g_FileSystem.writeFileSync(g_strFixturePath, g_strFixture.replace(g_strFixtureMarker, () => "\t// Generated only: native GameData int32 parser regression executable.\n" + strParser));
}

let g_unRejectedMutationCount = 0;
try {
	g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "CMakeLists.txt"), [
		"# Generated only: native GameData int32 parser regression build.",
		"cmake_minimum_required(VERSION 3.20)",
		"project(MemoryGameDataIntegerContracts LANGUAGES CXX)",
		"add_executable(MemoryGameDataIntegerContracts MemoryGameDataIntegerContracts.cpp)",
		"target_compile_features(MemoryGameDataIntegerContracts PRIVATE cxx_std_20)",
		"if(MSVC)",
		"\ttarget_compile_options(MemoryGameDataIntegerContracts PRIVATE /W4 /WX)",
		"else()",
		"\ttarget_compile_options(MemoryGameDataIntegerContracts PRIVATE -Wall -Wextra -Wpedantic -Werror)",
		"endif()",
		"",
	].join("\n"));

	for (const Profile of g_vecProfiles) {
		WriteFixture(g_strParser);

		const strBinaryRoot = g_Path.join(g_strTemporaryRoot, Profile.Name);
		RunCommand("cmake", ["-S", g_strTemporaryRoot, "-B", strBinaryRoot, ...Profile.Arguments]);
		RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);

		const strProgram = (process.platform === "win32") ? g_Path.join(strBinaryRoot, "Release", "MemoryGameDataIntegerContracts.exe") : g_Path.join(strBinaryRoot, "MemoryGameDataIntegerContracts");
		const PositiveResult = RunCommand(strProgram, []);
		console.log(PositiveResult.stdout.trim());
		VerifyFixtureCLI(strProgram);

		for (const Mutation of g_vecMutations) {
			g_Assert(g_strParser.includes(Mutation.Old));
			const strChangedParser = g_strParser.replace(Mutation.Old, () => Mutation.New);
			g_Assert.notEqual(strChangedParser, g_strParser, Mutation.Name + ": change the compiled production parser.");

			WriteFixture(strChangedParser);
			RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);

			const NegativeResult = g_ChildProcess.spawnSync(strProgram, [], { encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
			g_Assert.ifError(NegativeResult.error);
			g_Assert.equal(NegativeResult.status, 1, Mutation.Name + ": compiled regression must fail the native oracle.");
			g_Assert.equal(NegativeResult.signal, null);
			g_Assert.match(NegativeResult.stderr, /MemoryGameDataIntegerContracts failed/, "Reject through the native oracle, not an execution failure.");
			++g_unRejectedMutationCount;
		}

		WriteFixture(g_strParser);
		RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);
		RunCommand(strProgram, []);
	}
} finally {
	const strRealTemporaryRoot = g_FileSystem.realpathSync(g_strTemporaryRoot);
	const strRelativeTemporaryRoot = g_Path.relative(g_strBuildRoot, strRealTemporaryRoot);
	g_Assert(!g_Path.isAbsolute(strRelativeTemporaryRoot) && !strRelativeTemporaryRoot.startsWith("..") && /^NativeMemoryGameDataIntegers-[^/\\]+$/.test(strRelativeTemporaryRoot), "Refuse cleanup outside the exact native fixture directory.");
	g_Assert(!g_FileSystem.lstatSync(g_strTemporaryRoot).isSymbolicLink());
	g_FileSystem.rmSync(strRealTemporaryRoot, { recursive: true, force: true });
}

console.log("Memory native GameData int32 checks PASS; profiles=" + g_vecProfiles.length + "; compiled regressions=" + g_unRejectedMutationCount + "; live V8/engine execution not exercised; temporary fixture cleaned.");
