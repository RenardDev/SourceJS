#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

function ShowUsage(unOutputDescriptor) {
	const strScriptPath = g_Path.relative(process.cwd(), __filename) || g_Path.basename(__filename);
	g_FileSystem.writeSync(unOutputDescriptor, `Usage: node "${strScriptPath}" [-h | --help]\n`);
	g_FileSystem.writeSync(unOutputDescriptor, "Compile and run the manager-state native fixture and regression checks for both host architectures.\n");
}

if (process.argv.length > 2) {
	const vecArguments = process.argv.slice(2);
	if ((vecArguments.length === 1) && ((vecArguments[0] === "-h") || (vecArguments[0] === "--help"))) {
		ShowUsage(process.stdout.fd);
		process.exit(0);
	}

	g_FileSystem.writeSync(process.stderr.fd, "[ERROR] Unsupported manager-state native test arguments.\n");
	ShowUsage(process.stderr.fd);
	process.exit(2);
}

const g_unCommandTimeoutMilliseconds = 600000;
const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strExtensionSource = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src", "sourcejs", "ExtensionManager.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_strPluginSource = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src", "sourcejs", "PluginManager.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_strFixture = g_FileSystem.readFileSync(g_Path.join(__dirname, "fixtures", "ManagerStateContracts.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_strHeader = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src", "sourcejs", "ManagerState.h"), "utf8").replace(/\r\n/g, "\n");

function ExtractFunction(strSource, strDeclaration, unIndent) {
	const strIndent = "\t".repeat(unIndent);
	const strStart = strIndent + strDeclaration;
	g_Assert.equal(strSource.split(strStart).length, 2, strDeclaration);
	const nStart = strSource.indexOf(strStart);
	const strEnd = "\n" + strIndent + "}";
	const nEnd = strSource.indexOf(strEnd, nStart);
	g_Assert.ok(nEnd > nStart, strDeclaration);

	return strSource.slice(nStart, nEnd + strEnd.length);
}

function RunCommand(strCommand, vecArguments) {
	const Result = g_ChildProcess.spawnSync(strCommand, vecArguments, { encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
	g_Assert.equal(Result.status, 0, strCommand + ": " + (Result.error?.message ?? (Result.stdout + Result.stderr)));

	return Result;
}

function MakeFixture(strExtensionSource = g_strExtensionSource) {
	const vecFragments = [
		{ Marker: "\t\t// SOURCEJS_EXTENSION_STATE_HELPERS", Source: strExtensionSource, Declarations: ["bool ReadTextFile(", "bool IsValidExtensionName(", "bool ContainsExtensionName("], Indent: 2 },
		{ Marker: "\t\t// SOURCEJS_EXTENSION_STATE_METHODS", Source: strExtensionSource, Declarations: ["void ExtensionManager::LoadState()", "void ExtensionManager::SaveState() const"], Indent: 1 },
		{ Marker: "\t\t// SOURCEJS_PLUGIN_STATE_HELPERS", Source: g_strPluginSource, Declarations: ["bool ReadTextFile(", "bool IsValidPluginName("], Indent: 2 },
		{ Marker: "\t\t// SOURCEJS_PLUGIN_STATE_METHODS", Source: g_strPluginSource, Declarations: ["void PluginManager::LoadState()", "void PluginManager::SaveState() const"], Indent: 1 },
	];

	let strProgram = g_strFixture;
	for (const Fragment of vecFragments) {
		g_Assert.equal(strProgram.split(Fragment.Marker).length, 2, Fragment.Marker);
		const strCode = Fragment.Declarations.map((strDeclaration) => ExtractFunction(Fragment.Source, strDeclaration, Fragment.Indent)).join("\n\n");
		// Preserve the production body; only align it with the test-only namespace.
		const strAlignedCode = (Fragment.Indent === 1) ? strCode.split("\n").map((strLine) => strLine ? ("\t" + strLine) : "").join("\n") : strCode;
		strProgram = strProgram.replace(Fragment.Marker, () => strAlignedCode);
	}

	return strProgram;
}

g_Assert.ok(["win32", "linux"].includes(process.platform), "Native manager-state tests require Windows or Linux.");
g_Assert.ok(["ia32", "x64"].includes(process.arch), "Native manager-state tests require x86/x64 compiler profiles.");

const g_vecProfiles = (process.platform === "win32") ? [
	{ Name: "Win32", Arguments: ["-G", "Visual Studio 17 2022", "-A", "Win32"] },
	{ Name: "X64", Arguments: ["-G", "Visual Studio 17 2022", "-A", "x64"] },
] : [
	{ Name: "X86", Arguments: ["-DCMAKE_CXX_FLAGS=-m32 -fsanitize=undefined -fno-sanitize-recover=all"] },
	{ Name: "X64", Arguments: ["-DCMAKE_CXX_FLAGS=-m64 -fsanitize=undefined -fno-sanitize-recover=all"] },
];

g_FileSystem.mkdirSync(g_Path.join(g_strProjectRoot, "build"), { recursive: true });
const g_strBuildRoot = g_FileSystem.realpathSync(g_Path.join(g_strProjectRoot, "build"));
const g_strTemporaryRoot = g_FileSystem.mkdtempSync(g_Path.join(g_strBuildRoot, "NativeManagerState-"));
const g_strHeaderDirectory = g_Path.join(g_strTemporaryRoot, "include", "sourcejs");
const g_strHeaderPath = g_Path.join(g_strHeaderDirectory, "ManagerState.h");

// Deliberately broken generated copies; never modify the production input files.
const g_vecMutations = [
	{ Name: "DropDisabledValue", Header: false, Old: "if (!ContainsExtensionName(m_vecDisabledExtensionNames, strExtensionName)) {", New: "if ((strExtensionName != \"Disabled\") && !ContainsExtensionName(m_vecDisabledExtensionNames, strExtensionName)) {" },
	{ Name: "LowercaseStateKey", Header: true, Old: 'kDisabledKey[] = "\\\"Disabled\\\"";', New: 'kDisabledKey[] = "\\\"disabled\\\"";' },
	{ Name: "CommitPartialOutput", Header: true, Old: "if (!NameValidator(strName)) {", New: "if (!NameValidator(strName)) {\n\t\t\t\t\t\tvecNamesOut = vecNames;" },
	{ Name: "AcceptTrailingInput", Header: true, Old: " || (strState.find_first_not_of(\" \\t\\r\\n\", unOffset) != std::string::npos)", New: "" },
];

function BuildFixture(Profile, strBinaryRoot, strCaseName) {
	g_Assert.match(strCaseName, /^[A-Z][A-Za-z0-9]*$/);
	RunCommand("cmake", ["-S", g_strTemporaryRoot, "-B", strBinaryRoot, "-DstrManagerStateFixtureCase=" + strCaseName, ...Profile.Arguments]);
	RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);

	const strOutputName = "ManagerStateContracts-" + strCaseName;

	return (process.platform === "win32") ? g_Path.join(strBinaryRoot, "Release", strOutputName + ".exe") : g_Path.join(strBinaryRoot, strOutputName);
}

let g_unRejectedMutations = 0;

try {
	g_FileSystem.mkdirSync(g_strHeaderDirectory, { recursive: true });
	g_FileSystem.writeFileSync(g_strHeaderPath, g_strHeader);
	g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "ManagerStateContracts.cpp"), MakeFixture());
	g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "CMakeLists.txt"), [
		"cmake_minimum_required(VERSION 3.20)",
		"project(ManagerStateContracts LANGUAGES CXX)",
		"add_executable(ManagerStateContracts ManagerStateContracts.cpp)",
		// Windows can retain a sharing lock after execution; never relink a previously run case.
		"set(strManagerStateFixtureCase Baseline CACHE STRING \"Isolated executable case\")",
		"set_target_properties(ManagerStateContracts PROPERTIES OUTPUT_NAME \"ManagerStateContracts-${strManagerStateFixtureCase}\")",
		"target_compile_features(ManagerStateContracts PRIVATE cxx_std_20)",
		"target_include_directories(ManagerStateContracts PRIVATE \"" + g_Path.join(g_strTemporaryRoot, "include").replace(/\\/g, "/").replace(/"/g, '\\"') + "\" \"" + g_Path.join(g_strProjectRoot, "src").replace(/\\/g, "/").replace(/"/g, '\\"') + "\")",
		"if(MSVC)",
		"\ttarget_compile_options(ManagerStateContracts PRIVATE /W4 /WX)",
		"else()",
		"\ttarget_compile_options(ManagerStateContracts PRIVATE -Wall -Wextra -Wpedantic -Werror)",
		"endif()",
		"",
	].join("\n"));

	for (const Profile of g_vecProfiles) {
		const strBinaryRoot = g_Path.join(g_strTemporaryRoot, Profile.Name);
		const strDataPrefix = g_Path.join(g_strTemporaryRoot, "Data-" + Profile.Name + "-");
		g_FileSystem.writeFileSync(g_strHeaderPath, g_strHeader);
		g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "ManagerStateContracts.cpp"), MakeFixture());

		const strProgram = BuildFixture(Profile, strBinaryRoot, "Baseline");
		g_Assert.match(RunCommand(strProgram, [strDataPrefix + "Baseline"]).stdout, /^ManagerStateContracts PASS:/);

		const strExistingRoot = strDataPrefix + "Existing";
		const strExistingStatePath = g_Path.join(strExistingRoot, "ExtensionsState.json");
		const strExistingState = '{"Disabled":["Preserve"]}\n';
		g_FileSystem.mkdirSync(strExistingRoot);
		g_FileSystem.writeFileSync(strExistingStatePath, strExistingState);
		const ExistingDirectoryResult = g_ChildProcess.spawnSync(strProgram, [strExistingRoot], { encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
		g_Assert.equal(ExistingDirectoryResult.status, 2, "Existing fixture directory must be rejected.");
		g_Assert.match(ExistingDirectoryResult.stderr, /requires a new isolated directory/);
		g_Assert.doesNotMatch(ExistingDirectoryResult.stdout, /^ManagerStateContracts PASS:/m);
		g_Assert.equal(g_FileSystem.readFileSync(strExistingStatePath, "utf8"), strExistingState);

		for (const Mutation of g_vecMutations) {
			const strOriginal = Mutation.Header ? g_strHeader : ExtractFunction(g_strExtensionSource, "void ExtensionManager::LoadState()", 1);
			g_Assert.equal(strOriginal.split(Mutation.Old).length, 2, Mutation.Name);
			const strModified = strOriginal.replace(Mutation.Old, () => Mutation.New);
			g_FileSystem.writeFileSync(g_strHeaderPath, Mutation.Header ? strModified : g_strHeader);
			const strExtensionSource = Mutation.Header ? g_strExtensionSource : g_strExtensionSource.replace(strOriginal, () => strModified);
			g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "ManagerStateContracts.cpp"), MakeFixture(strExtensionSource));

			const strMutatedProgram = BuildFixture(Profile, strBinaryRoot, Mutation.Name);
			const Result = g_ChildProcess.spawnSync(strMutatedProgram, [strDataPrefix + Mutation.Name], { encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
			g_Assert.equal(Result.status, 1, Mutation.Name + ": compiled regression must fail at execution.");
			g_Assert.match(Result.stderr, /^\[ERROR\] ManagerStateContracts failed:/, Mutation.Name + ": assertion failure required.");
			++g_unRejectedMutations;
		}

		g_FileSystem.writeFileSync(g_strHeaderPath, g_strHeader);
		g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "ManagerStateContracts.cpp"), MakeFixture());

		const strRestoredProgram = BuildFixture(Profile, strBinaryRoot, "Restored");
		g_Assert.match(RunCommand(strRestoredProgram, [strDataPrefix + "Restored"]).stdout, /^ManagerStateContracts PASS:/);
	}
} finally {
	const strRealTemporaryRoot = g_FileSystem.realpathSync(g_strTemporaryRoot);
	const strRelativeTemporaryRoot = g_Path.relative(g_strBuildRoot, strRealTemporaryRoot);
	g_Assert.ok(!g_Path.isAbsolute(strRelativeTemporaryRoot) && !strRelativeTemporaryRoot.startsWith("..") && /^NativeManagerState-[^/\\]+$/.test(strRelativeTemporaryRoot), "Refuse cleanup outside the exact manager-state fixture directory.");
	g_Assert.ok(!g_FileSystem.lstatSync(g_strTemporaryRoot).isSymbolicLink());
	g_FileSystem.rmSync(strRealTemporaryRoot, { recursive: true, force: true });
}

console.log("Manager-state native checks PASS: production persistence bodies and validators; x86/x64, compiled regressions=" + g_unRejectedMutations + ", real isolated files, existing directories preserved, malformed schema/name/escape inputs and transactional parser output. Facade/logging/path doubles; live SDK/server not exercised.");
