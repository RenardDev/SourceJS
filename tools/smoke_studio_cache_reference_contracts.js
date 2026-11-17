#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

if ((process.argv.length === 3) && ["--help", "-h"].includes(process.argv[2])) {
	console.log("Usage: node tools/smoke_studio_cache_reference_contracts.js [--profile X86|X64]\nCompiles the actual reference owner with a fake SDK cache; no live V8 or engine.");
	process.exit(0);
}

const g_vecArguments = process.argv.slice(2);
let g_strProfile = "";
if (g_vecArguments.length !== 0) {
	if ((g_vecArguments.length !== 2) || (g_vecArguments[0] !== "--profile") || !["X86", "X64"].includes(g_vecArguments[1])) {
		console.error("Usage: node tools/smoke_studio_cache_reference_contracts.js [--profile X86|X64]");
		process.exit(2);
	}

	g_strProfile = g_vecArguments[1];
}

g_Assert(["win32", "linux"].includes(process.platform), "Windows or Linux host required");
g_Assert(["x64", "ia32"].includes(process.arch), "Native cache-reference tests require the configured x86/x64 compiler profiles.");

const g_strProjectRoot = g_FileSystem.realpathSync(g_Path.resolve(__dirname, ".."));
const g_strSource = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_strFixture = g_FileSystem.readFileSync(g_Path.join(__dirname, "fixtures", "StudioCacheReferenceContracts.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_strFixtureMarker = "\t// SOURCEJS_STUDIO_CACHE_REFERENCE_OWNER";
const g_unTimeoutMilliseconds = 600000;
const g_unMaximumOutputBytes = 16 * 1024 * 1024;
const g_unBitsPerByte = 8;

const g_vecMutations = [
	{ Name: "MissingRelease", Old: "m_pStudioModelCache->Release(m_hModelHandle);", New: "return;" },
	{ Name: "InvalidHandleRelease", Old: "(m_hModelHandle == MDLHANDLE_INVALID)", New: "false" },
	{ Name: "MissingOwnershipTransfer", Old: "m_hModelHandle = MDLHANDLE_INVALID;\n\t\tm_pStudioModelCache = nullptr;", New: "" },
	{ Name: "LostStandardReleaseDiagnostic", Old: "LogError(kReleaseFailureErrorMessage, static_cast<unsigned int>(m_hModelHandle));", New: "return;", ExpectedOccurrences: 2, OccurrenceIndex: 0 },
	{ Name: "LostUnknownReleaseDiagnostic", Old: "LogError(kReleaseFailureErrorMessage, static_cast<unsigned int>(m_hModelHandle));", New: "return;", ExpectedOccurrences: 2, OccurrenceIndex: 1 },
];

const g_vecProfiles = ((process.platform === "win32") ? [
	{ Name: "X86", AddressByteCount: 4, Arguments: ["-G", "Visual Studio 17 2022", "-A", "Win32"] },
	{ Name: "X64", AddressByteCount: 8, Arguments: ["-G", "Visual Studio 17 2022", "-A", "x64"] },
] : [
	{ Name: "X86", AddressByteCount: 4, Arguments: ["-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_CXX_FLAGS=-m32 -fsanitize=undefined -fno-sanitize-recover=all"] },
	{ Name: "X64", AddressByteCount: 8, Arguments: ["-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_CXX_FLAGS=-m64 -fsanitize=undefined -fno-sanitize-recover=all"] },
]).filter(Profile => !g_strProfile || (Profile.Name === g_strProfile));

let g_unRejectedMutationCount = 0;

function RunCommand(strCommand, vecArguments, unExpectedStatus = 0) {
	const strDisplayCommand = g_Path.isAbsolute(strCommand) ? g_Path.relative(g_strProjectRoot, strCommand) : strCommand;
	const Result = g_ChildProcess.spawnSync(strCommand, vecArguments, { cwd: g_strProjectRoot, encoding: "utf8", windowsHide: true, timeout: g_unTimeoutMilliseconds, maxBuffer: g_unMaximumOutputBytes });
	g_Assert(!Result.error, strDisplayCommand + " failed: " + Result.error?.message);
	g_Assert.equal(Result.signal, null, strDisplayCommand + " received native process signal: " + Result.signal);
	g_Assert.equal(Result.status, unExpectedStatus, strDisplayCommand + ": " + Result.stdout + Result.stderr);
	g_Assert(!/\bwarning\b/i.test(Result.stdout + Result.stderr), strDisplayCommand + " reported a warning:\n" + Result.stdout + Result.stderr);
	g_Assert(!/(?:runtime error:|(?:Address|UndefinedBehavior|Leak|Memory|Thread)Sanitizer|Sanitizer:)/i.test(Result.stdout + Result.stderr), strDisplayCommand + " reported a sanitizer failure:\n" + Result.stdout + Result.stderr);

	return Result;
}

g_Assert.equal(g_strFixture.split(g_strFixtureMarker).length, 2);

const g_vecOwnerStarts = ["\tclass StudioModelReferenceOwner {", "\t\tclass StudioModelReferenceOwner {"];
const g_strOwnerStart = g_vecOwnerStarts.find((strStart) => g_strSource.includes("\n" + strStart));
g_Assert(g_strOwnerStart, "Expected the exact namespace indentation for the source owner.");
const g_strOwnerIndent = g_strOwnerStart.slice(0, g_strOwnerStart.indexOf("class"));
const g_strOwnerEnd = "\n" + g_strOwnerIndent + "void FindStudioModelCallback(";
const g_nOwnerStart = g_strSource.indexOf(g_strOwnerStart);
const g_nOwnerEnd = g_strSource.indexOf(g_strOwnerEnd, g_nOwnerStart);
g_Assert.equal(g_strSource.split(g_strOwnerStart).length, 2);
g_Assert(g_nOwnerStart >= 0);
g_Assert(g_nOwnerEnd > g_nOwnerStart);

const g_strOwner = g_strSource.slice(g_nOwnerStart, g_nOwnerEnd).trimEnd().split("\n").map((strLine) => ((g_strOwnerIndent.length === 2) && strLine.startsWith("\t")) ? strLine.slice(1) : strLine).join("\n");

g_FileSystem.mkdirSync(g_Path.join(g_strProjectRoot, "build"), { recursive: true });
const g_strBuildRoot = g_FileSystem.realpathSync(g_Path.join(g_strProjectRoot, "build"));
const g_strTemporaryRoot = g_FileSystem.mkdtempSync(g_Path.join(g_strBuildRoot, "NativeStudioCacheReferences-"));
const g_strFixturePath = g_Path.join(g_strTemporaryRoot, "StudioCacheReferenceContracts.cpp");

function WriteFixture(strOwner) {
	g_FileSystem.writeFileSync(g_strFixturePath, g_strFixture.replace(g_strFixtureMarker, () => strOwner));
}

try {
	g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "CMakeLists.txt"), [
		"cmake_minimum_required(VERSION 3.20)",
		"project(StudioCacheReferenceContracts LANGUAGES CXX)",
		"set(CMAKE_CXX_EXTENSIONS OFF)",
		"if(NOT CMAKE_SIZEOF_VOID_P EQUAL SOURCEJS_TEST_ADDRESS_SIZE)",
		'\tmessage(FATAL_ERROR "Requested test bitness was not selected")',
		"endif()",
		"add_executable(StudioCacheReferenceContracts StudioCacheReferenceContracts.cpp)",
		"target_compile_features(StudioCacheReferenceContracts PRIVATE cxx_std_20)",
		"if(MSVC)",
		"\ttarget_compile_options(StudioCacheReferenceContracts PRIVATE /W4 /WX)",
		'elseif(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")',
		"\ttarget_compile_options(StudioCacheReferenceContracts PRIVATE -Wall -Wextra -Wpedantic -Werror)",
		"else()",
		'\tmessage(FATAL_ERROR "Unsupported fixture compiler")',
		"endif()",
		"",
	].join("\n"));

	for (const Profile of g_vecProfiles) {
		WriteFixture(g_strOwner);

		const strBinaryRoot = g_Path.join(g_strTemporaryRoot, Profile.Name);
		RunCommand("cmake", ["-S", g_strTemporaryRoot, "-B", strBinaryRoot, "-DSOURCEJS_TEST_ADDRESS_SIZE=" + Profile.AddressByteCount, ...Profile.Arguments]);
		RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);

		const strProgram = (process.platform === "win32") ? g_Path.join(strBinaryRoot, "Release", "StudioCacheReferenceContracts.exe") : g_Path.join(strBinaryRoot, "StudioCacheReferenceContracts");
		const strExpectedOutput = "StudioCacheReferenceContracts PASS AddressBits=" + (Profile.AddressByteCount * g_unBitsPerByte) + "\n";
		const Result = RunCommand(strProgram, []);
		g_Assert.equal(Result.stdout.replace(/\r\n/g, "\n"), strExpectedOutput);
		g_Assert.equal(Result.stderr, "", "The reference owner fixture must succeed without stderr");
		console.log(Result.stdout.trim());

		for (const Mutation of g_vecMutations) {
			const unOccurrenceCount = g_strOwner.split(Mutation.Old).length - 1;
			const unExpectedOccurrences = Mutation.ExpectedOccurrences ?? 1;
			const unSelectedOccurrenceIndex = Mutation.OccurrenceIndex ?? 0;
			g_Assert.equal(unOccurrenceCount, unExpectedOccurrences, Mutation.Name + ": exact mutation target count required");
			g_Assert(unSelectedOccurrenceIndex < unOccurrenceCount, Mutation.Name + ": selected mutation occurrence must exist");

			let unSeenCount = 0;
			const strMutatedOwner = g_strOwner.replaceAll(Mutation.Old, () => {
				const bSelected = unSeenCount === unSelectedOccurrenceIndex;
				++unSeenCount;

				return bSelected ? Mutation.New : Mutation.Old;
			});
			g_Assert.notEqual(strMutatedOwner, g_strOwner, Mutation.Name);
			WriteFixture(strMutatedOwner);
			RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);

			const InvalidResult = RunCommand(strProgram, [], 1);
			g_Assert.equal(InvalidResult.stdout, "", Mutation.Name + ": regression must not report success");
			g_Assert.equal(InvalidResult.stderr.trim(), "StudioCacheReferenceContracts failed", Mutation.Name + ": reject through the native oracle, not an execution failure.");
			++g_unRejectedMutationCount;
		}

		WriteFixture(g_strOwner);
		RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);

		const RestoredResult = RunCommand(strProgram, []);
		g_Assert.equal(RestoredResult.stdout.replace(/\r\n/g, "\n"), strExpectedOutput);
		g_Assert.equal(RestoredResult.stderr, "", "Restored reference owner fixture must not report stderr");
	}
} finally {
	const DirectoryStatus = g_FileSystem.lstatSync(g_strTemporaryRoot);
	g_Assert(DirectoryStatus.isDirectory() && !DirectoryStatus.isSymbolicLink(), "Fixture cleanup target must be the allocated directory, not a link");

	const strRealTemporaryRoot = g_FileSystem.realpathSync(g_strTemporaryRoot);
	const strRelativeTemporaryRoot = g_Path.relative(g_strBuildRoot, strRealTemporaryRoot);
	g_Assert(!g_Path.isAbsolute(strRelativeTemporaryRoot) && !strRelativeTemporaryRoot.startsWith("..") && /^NativeStudioCacheReferences-[^/\\]+$/.test(strRelativeTemporaryRoot) && (g_Path.basename(strRealTemporaryRoot) === g_Path.basename(g_strTemporaryRoot)), "Refuse cleanup outside the exact native fixture directory.");
	g_FileSystem.rmSync(strRealTemporaryRoot, { recursive: true, force: true });
}

g_Assert.equal(g_unRejectedMutationCount, g_vecProfiles.length * g_vecMutations.length);

console.log("Studio cache-reference native checks PASS; profiles=" + g_vecProfiles.length + "; compiled regressions=" + g_unRejectedMutationCount + "; actual source owner with a fake SDK cache exercised; live V8/engine not exercised; temporary fixture cleaned.");
