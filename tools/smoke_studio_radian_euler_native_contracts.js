#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

if ((process.argv.length === 3) && ["--help", "-h"].includes(process.argv[2])) {
	console.log("Usage: node tools/smoke_studio_radian_euler_native_contracts.js [--profile X86|X64]\nCompiles the actual RadianEuler factory with controlled SDK/V8 adapters; checks native field binding/read/write; not V8/engine execution or SDK ABI validation.");
	process.exit(0);
}

const g_vecArguments = process.argv.slice(2);
let g_strProfile = "";
if (g_vecArguments.length !== 0) {
	if ((g_vecArguments.length !== 2) || (g_vecArguments[0] !== "--profile") || !["X86", "X64"].includes(g_vecArguments[1])) {
		console.error("Usage: node tools/smoke_studio_radian_euler_native_contracts.js [--profile X86|X64]");
		process.exit(2);
	}

	g_strProfile = g_vecArguments[1];
}

g_Assert(["win32", "linux"].includes(process.platform), "Windows or Linux host required");
g_Assert(["x64", "ia32"].includes(process.arch), "Native RadianEuler factory tests require the configured x86/x64 compiler profiles.");

const g_strProjectRoot = g_FileSystem.realpathSync(g_Path.resolve(__dirname, ".."));
const g_strSource = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_strFixture = g_FileSystem.readFileSync(g_Path.join(__dirname, "fixtures", "StudioRadianEulerContracts.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_strFixtureMarker = "\t// SOURCEJS_STUDIO_RADIAN_EULER_FACTORY";
const g_unTimeoutMilliseconds = 600000;
const g_unMaximumOutputBytes = 16 * 1024 * 1024;
const g_unMaximumParallelBuildJobs = 2;
const g_unBitsPerByte = 8;

const g_vecMutations = [
	{ Name: "PitchUsesX", Old: "kRadianEulerPitchPropertyName, &pRadianEulerValue->y", New: "kRadianEulerPitchPropertyName, &pRadianEulerValue->x" },
	{ Name: "YawUsesY", Old: "kRadianEulerYawPropertyName, &pRadianEulerValue->z", New: "kRadianEulerYawPropertyName, &pRadianEulerValue->y" },
	{ Name: "RollUsesZ", Old: "kRadianEulerRollPropertyName, &pRadianEulerValue->x", New: "kRadianEulerRollPropertyName, &pRadianEulerValue->z" },
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

const g_vecFactoryMatch = /^\t\tv8::Local<v8::Object> MakeStudioRadianEulerObject\([^\n]+\) \{/m.exec(g_strSource);
g_Assert(g_vecFactoryMatch, "Missing actual studio RadianEuler factory");
const g_nFactoryEnd = g_strSource.indexOf("\n\t\t}", g_vecFactoryMatch.index);
g_Assert(g_nFactoryEnd > g_vecFactoryMatch.index);
const g_strFactory = g_strSource.slice(g_vecFactoryMatch.index, g_nFactoryEnd + "\n\t\t}".length).replace(/^\t/gm, "");

let g_bOperationFailed = false;
let g_OperationError = null;

g_FileSystem.mkdirSync(g_Path.join(g_strProjectRoot, "build"), { recursive: true });
const g_strBuildRoot = g_FileSystem.realpathSync(g_Path.join(g_strProjectRoot, "build"));
const g_strTemporaryRoot = g_FileSystem.mkdtempSync(g_Path.join(g_strBuildRoot, "NativeStudioRadianEuler-"));
try {
	const strFixturePath = g_Path.join(g_strTemporaryRoot, "StudioRadianEulerContracts.cpp");
	function WriteFixture(strFactory) {
		g_FileSystem.writeFileSync(strFixturePath, g_strFixture.replace(g_strFixtureMarker, () => strFactory));
	}

	g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "CMakeLists.txt"), [
		"cmake_minimum_required(VERSION 3.20)",
		"project(StudioRadianEulerContracts LANGUAGES CXX)",
		"set(CMAKE_CXX_EXTENSIONS OFF)",
		"if(NOT CMAKE_SIZEOF_VOID_P EQUAL SOURCEJS_TEST_ADDRESS_SIZE)",
		'\tmessage(FATAL_ERROR "Requested test bitness was not selected")',
		"endif()",
		"add_executable(StudioRadianEulerContracts StudioRadianEulerContracts.cpp)",
		"target_compile_features(StudioRadianEulerContracts PRIVATE cxx_std_20)",
		"if(MSVC)",
		"\ttarget_compile_options(StudioRadianEulerContracts PRIVATE /W4 /WX)",
		'elseif(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")',
		"\ttarget_compile_options(StudioRadianEulerContracts PRIVATE -Wall -Wextra -Wpedantic -Werror)",
		"else()",
		'\tmessage(FATAL_ERROR "Unsupported fixture compiler")',
		"endif()",
		"",
	].join("\n"));

	for (const Profile of g_vecProfiles) {
		WriteFixture(g_strFactory);

		const strBinaryRoot = g_Path.join(g_strTemporaryRoot, Profile.Name);
		RunCommand("cmake", ["-S", g_strTemporaryRoot, "-B", strBinaryRoot, "-DSOURCEJS_TEST_ADDRESS_SIZE=" + Profile.AddressByteCount, ...Profile.Arguments]);
		RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", String(g_unMaximumParallelBuildJobs)]);

		const strProgram = (process.platform === "win32") ? g_Path.join(strBinaryRoot, "Release", "StudioRadianEulerContracts.exe") : g_Path.join(strBinaryRoot, "StudioRadianEulerContracts");
		const strExpectedOutput = "StudioRadianEulerContracts PASS AddressBits=" + (Profile.AddressByteCount * g_unBitsPerByte) + "\n";
		const Result = RunCommand(strProgram, []);
		g_Assert.equal(Result.stdout.replace(/\r\n/g, "\n"), strExpectedOutput);
		g_Assert.equal(Result.stderr, "", "The RadianEuler factory fixture must succeed without stderr");
		console.log(Result.stdout.trim());

		for (const Mutation of g_vecMutations) {
			const unOccurrenceCount = g_strFactory.split(Mutation.Old).length - 1;
			const unExpectedOccurrences = Mutation.ExpectedOccurrences ?? 1;
			const unSelectedOccurrenceIndex = Mutation.OccurrenceIndex ?? 0;
			g_Assert.equal(unOccurrenceCount, unExpectedOccurrences, Mutation.Name + ": exact mutation target count required");
			g_Assert(unSelectedOccurrenceIndex < unOccurrenceCount, Mutation.Name + ": selected mutation occurrence must exist");

			let unSeenCount = 0;
			const strMutatedFactory = g_strFactory.replaceAll(Mutation.Old, () => {
				const bSelected = unSeenCount === unSelectedOccurrenceIndex;
				++unSeenCount;

				return bSelected ? Mutation.New : Mutation.Old;
			});
			g_Assert.notEqual(strMutatedFactory, g_strFactory, Mutation.Name);
			WriteFixture(strMutatedFactory);
			RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", String(g_unMaximumParallelBuildJobs)]);

			const InvalidResult = RunCommand(strProgram, [], 1);
			g_Assert.equal(InvalidResult.stdout, "", Mutation.Name + ": regression must not report success");
			g_Assert.equal(InvalidResult.stderr.trim(), "StudioRadianEulerContracts failed", Mutation.Name + ": reject through the native oracle, not an execution failure.");
			++g_unRejectedMutationCount;
		}

		WriteFixture(g_strFactory);
		RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", String(g_unMaximumParallelBuildJobs)]);

		const RestoredResult = RunCommand(strProgram, []);
		g_Assert.equal(RestoredResult.stdout.replace(/\r\n/g, "\n"), strExpectedOutput);
		g_Assert.equal(RestoredResult.stderr, "", "Restored RadianEuler factory fixture must not report stderr");
	}
} catch (OperationError) {
	g_bOperationFailed = true;
	g_OperationError = OperationError;
	throw OperationError;
} finally {
	try {
		const DirectoryStatus = g_FileSystem.lstatSync(g_strTemporaryRoot);
		g_Assert(DirectoryStatus.isDirectory() && !DirectoryStatus.isSymbolicLink(), "Fixture cleanup target must be the allocated directory, not a link");

		const strRealTemporaryRoot = g_FileSystem.realpathSync(g_strTemporaryRoot);
		const strRelativeTemporaryRoot = g_Path.relative(g_strBuildRoot, strRealTemporaryRoot);
		g_Assert(!g_Path.isAbsolute(strRelativeTemporaryRoot) && !strRelativeTemporaryRoot.startsWith("..") && /^NativeStudioRadianEuler-[^/\\]+$/.test(strRelativeTemporaryRoot) && (g_Path.basename(strRealTemporaryRoot) === g_Path.basename(g_strTemporaryRoot)), "Refuse cleanup outside the exact native fixture directory.");
		g_FileSystem.rmSync(strRealTemporaryRoot, { recursive: true, force: true });
	} catch (CleanupError) {
		if (g_bOperationFailed) {
			throw new AggregateError([g_OperationError, CleanupError], "Studio RadianEuler check and cleanup both failed.");
		}

		throw CleanupError;
	}
}

g_Assert.equal(g_unRejectedMutationCount, g_vecProfiles.length * g_vecMutations.length);

console.log("Studio RadianEuler factory native checks PASS; profiles=" + g_vecProfiles.length + "; compiled regressions=" + g_unRejectedMutationCount + "; actual source factory with controlled SDK/V8 adapters exercised; live V8/engine not exercised; temporary fixture cleaned.");
