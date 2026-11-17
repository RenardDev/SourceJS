#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

function ShowUsage(unOutputDescriptor) {
	const strScriptPath = g_Path.relative(process.cwd(), __filename) || g_Path.basename(__filename);
	g_FileSystem.writeSync(unOutputDescriptor, `Usage: node "${strScriptPath}" [--debug | -h | --help]\n`);
	g_FileSystem.writeSync(unOutputDescriptor, "Run the native record checks; --debug selects Debug instead of Release for both host architectures.\n");
}

const g_unCommandTimeoutMilliseconds = 600000;
const g_vecArguments = process.argv.slice(2);
if ((g_vecArguments.length === 1) && ((g_vecArguments[0] === "-h") || (g_vecArguments[0] === "--help"))) {
	ShowUsage(process.stdout.fd);
	process.exit(0);
}

if ((g_vecArguments.length > 1) || ((g_vecArguments.length === 1) && (g_vecArguments[0] !== "--debug"))) {
	g_FileSystem.writeSync(process.stderr.fd, "[ERROR] Unsupported entity-factory native test arguments.\n");
	ShowUsage(process.stderr.fd);
	process.exit(2);
}

const g_strConfiguration = (g_vecArguments.length === 1) ? "Debug" : "Release";
const g_strRoot = g_Path.resolve(__dirname, "..");
const g_strSource = g_FileSystem.readFileSync(g_Path.join(g_strRoot, "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_strFixture = g_FileSystem.readFileSync(g_Path.join(__dirname, "fixtures", "EntityFactoryKeyValueRecords.cpp"), "utf8");
const g_strStart = "\tenum class EntityFactoryKeyValueType : unsigned char {";
const g_strEnd = "\tconstexpr char kEntityFactoryDispatchSpawnOptionName[]";
g_Assert.equal(g_strSource.split(g_strStart).length, 2);
g_Assert.equal(g_strSource.split(g_strEnd).length, 2);
const g_nStart = g_strSource.indexOf(g_strStart);
const g_nEnd = g_strSource.indexOf(g_strEnd, g_nStart);
g_Assert.ok(g_nEnd > g_nStart);
const g_strRecord = g_strSource.slice(g_nStart, g_nEnd);
const g_strMarker = "\t// SOURCEJS_ENTITY_FACTORY_KEY_VALUE_RECORD";
g_Assert.equal(g_strFixture.split(g_strMarker).length, 2);

function Run(strCommand, vecArguments) {
	const Result = g_ChildProcess.spawnSync(strCommand, vecArguments, { encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
	g_Assert.equal(Result.status, 0, strCommand + ": " + (Result.error?.message ?? (Result.stdout + Result.stderr)));

	return Result;
}

g_Assert.ok(["win32", "linux"].includes(process.platform), "Requires Windows/Linux x86/x64 compiler profiles.");
g_Assert.ok(["ia32", "x64"].includes(process.arch));
const g_vecProfiles = (process.platform === "win32") ? [
	{ Name: "Win32", Arguments: ["-G", "Visual Studio 17 2022", "-A", "Win32"] },
	{ Name: "X64", Arguments: ["-G", "Visual Studio 17 2022", "-A", "x64"] },
] : [
	{ Name: "X86", Arguments: ["-DCMAKE_CXX_FLAGS=-m32 -fsanitize=undefined -fno-sanitize-recover=all"] },
	{ Name: "X64", Arguments: ["-DCMAKE_CXX_FLAGS=-m64 -fsanitize=undefined -fno-sanitize-recover=all"] },
];
const g_vecMutations = [
	{ Name: "DefaultVector", Old: "m_Vector.Init(0.0f, 0.0f, 0.0f);", New: "m_Vector.Init(1.0f, 0.0f, 0.0f);", Count: 1 },
	{ Name: "CopyKey", Old: "m_strKey(Other.m_strKey)", New: "m_strKey()", Count: 1 },
	{ Name: "MoveValue", Old: "m_strValue(std::move(Other.m_strValue))", New: "m_strValue()", Count: 1 },
	{ Name: "VectorComponents", Old: "m_Vector(Other.m_Vector.x, Other.m_Vector.y, Other.m_Vector.z)", New: "m_Vector(Other.m_Vector.y, Other.m_Vector.x, Other.m_Vector.z)", Count: 2 },
];

g_FileSystem.mkdirSync(g_Path.join(g_strRoot, "build"), { recursive: true });
const g_strBuildRoot = g_FileSystem.realpathSync(g_Path.join(g_strRoot, "build"));
const g_strTemporaryRoot = g_FileSystem.mkdtempSync(g_Path.join(g_strBuildRoot, "NativeFactoryRecords-"));
const g_strProgramPath = g_Path.join(g_strTemporaryRoot, "EntityFactoryKeyValueRecords.cpp");
let g_unRejectedMutations = 0;

try {
	g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "CMakeLists.txt"), [
		"cmake_minimum_required(VERSION 3.20)",
		"project(EntityFactoryKeyValueRecords LANGUAGES CXX)",
		"add_executable(EntityFactoryKeyValueRecords EntityFactoryKeyValueRecords.cpp)",
		"target_compile_features(EntityFactoryKeyValueRecords PRIVATE cxx_std_20)",
		"if(MSVC)",
		"\ttarget_compile_options(EntityFactoryKeyValueRecords PRIVATE /W4 /WX)",
		"else()",
		"\ttarget_compile_options(EntityFactoryKeyValueRecords PRIVATE -Wall -Wextra -Wpedantic -Werror)",
		"endif()",
		"",
	].join("\n"));

	for (const Profile of g_vecProfiles) {
		const strBinaryRoot = g_Path.join(g_strTemporaryRoot, Profile.Name);
		g_FileSystem.writeFileSync(g_strProgramPath, g_strFixture.replace(g_strMarker, () => g_strRecord));
		const vecConfigurationArguments = (process.platform === "linux") ? ["-DCMAKE_BUILD_TYPE=" + g_strConfiguration] : [];
		Run("cmake", ["-S", g_strTemporaryRoot, "-B", strBinaryRoot, ...vecConfigurationArguments, ...Profile.Arguments]);

		Run("cmake", ["--build", strBinaryRoot, "--config", g_strConfiguration, "--parallel", "2"]);

		const strProgram = (process.platform === "win32") ? g_Path.join(strBinaryRoot, g_strConfiguration, "EntityFactoryKeyValueRecords.exe") : g_Path.join(strBinaryRoot, "EntityFactoryKeyValueRecords");
		g_Assert.match(Run(strProgram, []).stdout, /^EntityFactoryKeyValueRecords PASS:/);

		for (const Mutation of g_vecMutations) {
			g_Assert.equal(g_strRecord.split(Mutation.Old).length, Mutation.Count + 1, Mutation.Name);
			const strChangedRecord = g_strRecord.split(Mutation.Old).join(Mutation.New);
			let strChangedProgram = g_strFixture.replace(g_strMarker, () => strChangedRecord);
			if (process.platform === "win32") {
				// MSVC C4702 (observed in the generated mutant): constant failed assertions
				// make main's later checks unreachable. Keep its failure reporting compiled.
				// Suppress only this deliberately broken generated main, never positive code.
				g_Assert.equal(strChangedProgram.split("\nint main(const int nArgumentCount, char** ppszArguments) {").length, 2);
				strChangedProgram = strChangedProgram.replace("\nint main(const int nArgumentCount, char** ppszArguments) {", "\n// MSVC C4702: known-failing generated regression entry point only.\n#pragma warning(push)\n#pragma warning(disable: 4702)\nint main(const int nArgumentCount, char** ppszArguments) {") + "\n#pragma warning(pop)\n";
			}

			g_FileSystem.writeFileSync(g_strProgramPath, strChangedProgram);

			Run("cmake", ["--build", strBinaryRoot, "--config", g_strConfiguration, "--parallel", "2"]);

			const Result = g_ChildProcess.spawnSync(strProgram, [], { encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
			g_Assert.equal(Result.status, 1, Mutation.Name + ": compiled mutation must fail at execution.");
			g_Assert.match(Result.stderr, /^\[ERROR\] EntityFactoryKeyValueRecords failed:/);
			++g_unRejectedMutations;
		}

		g_FileSystem.writeFileSync(g_strProgramPath, g_strFixture.replace(g_strMarker, () => g_strRecord));

		Run("cmake", ["--build", strBinaryRoot, "--config", g_strConfiguration, "--parallel", "2"]);

		g_Assert.match(Run(strProgram, []).stdout, /^EntityFactoryKeyValueRecords PASS:/);
	}
} finally {
	const strRealTemporaryRoot = g_FileSystem.realpathSync(g_strTemporaryRoot);
	const strRelativeRoot = g_Path.relative(g_strBuildRoot, strRealTemporaryRoot);
	g_Assert.ok(!g_Path.isAbsolute(strRelativeRoot) && !strRelativeRoot.startsWith("..") && /^NativeFactoryRecords-[^/\\]+$/.test(strRelativeRoot), "Refuse cleanup outside the exact fixture directory.");
	g_Assert.ok(!g_FileSystem.lstatSync(g_strTemporaryRoot).isSymbolicLink());
	g_FileSystem.rmSync(strRealTemporaryRoot, { recursive: true, force: true });
}

console.log("Entity-factory record native checks PASS: actual record/constructors, x86/x64 " + g_strConfiguration + ", compiled mutations rejected=" + g_unRejectedMutations + "; SDK Vector facade forbids copy construction. SDK ABI/V8/server/allocation failures not exercised.");
