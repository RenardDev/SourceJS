"use strict";

// Compiles and executes the actual registry implementation against its real
// header. This checks the C++ inventory/registration contract, not V8 loading,
// extension initialization or a running game server. Mutations must compile
// cleanly and fail native assertions rather than crash or trigger sanitizers.
const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_vecArguments = process.argv.slice(2);
let g_strProfile = "";
let g_strSourceFile = "";

function ExitUsage(nExitCode = 2) {
	console[nExitCode ? "error" : "log"]("Usage: node tools/smoke_module_registry.js [--profile X86|X64] [--source-file <CPP>] [--help]");
	process.exit(nExitCode);
}

function GetDisplayPath(strPath) {
	return g_Path.relative(process.cwd(), strPath) || ".";
}

if ((g_vecArguments.length === 1) && ((g_vecArguments[0] === "--help") || (g_vecArguments[0] === "-h"))) {
	ExitUsage(0);
}

for (let unArgumentIndex = 0; unArgumentIndex < g_vecArguments.length; unArgumentIndex += 2) {
	const strOption = g_vecArguments[unArgumentIndex];
	const strValue = g_vecArguments[unArgumentIndex + 1];
	if (!strValue || strValue.startsWith("--")) {
		ExitUsage();
	}

	if (strOption === "--profile") {
		if (g_strProfile || !["X86", "X64"].includes(strValue)) {
			ExitUsage();
		}

		g_strProfile = strValue;

	} else if (strOption === "--source-file") {
		if (g_strSourceFile) {
			ExitUsage();
		}

		g_strSourceFile = strValue;

	} else {
		ExitUsage();
	}
}

g_Assert(["win32", "linux"].includes(process.platform), "Windows or Linux host required");

const g_strProjectRoot = g_FileSystem.realpathSync(g_Path.resolve(__dirname, ".."));
const g_strSourcePath = g_FileSystem.realpathSync(g_strSourceFile ? g_Path.resolve(g_strSourceFile) : g_Path.join(g_strProjectRoot, "src/sourcejs/ModuleRegistry.cpp"));
const g_strSource = g_FileSystem.readFileSync(g_strSourcePath, "utf8");
const g_unCommandTimeoutMilliseconds = 240000;
const g_unOutputLimitBytes = 16 * 1024 * 1024;
const g_strRoot = g_strProjectRoot.replace(/\\/g, "/");
g_Assert(!/[;"\r\n]|\$\{/.test(g_strRoot), "Unsupported CMake project path");

g_FileSystem.mkdirSync(g_Path.join(g_strProjectRoot, "build"), { recursive: true });

const g_strBuildRoot = g_FileSystem.realpathSync(g_Path.join(g_strProjectRoot, "build"));

function Run(strCommand, vecArguments) {
	const Result = g_ChildProcess.spawnSync(strCommand, vecArguments, { cwd: g_strProjectRoot, encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds, maxBuffer: g_unOutputLimitBytes });
	g_Assert.ifError(Result.error);
	g_Assert.equal(Result.signal, null, "Unexpected native process signal: " + Result.signal);

	return Result;
}

function RequireSuccess(strCommand, vecArguments) {
	const Result = Run(strCommand, vecArguments);
	g_Assert.equal(Result.status, 0, GetDisplayPath(strCommand) + ":\n" + Result.stdout + Result.stderr);
	g_Assert(!/\bwarning(?: C\d+| LNK\d+|:)/i.test(Result.stdout + Result.stderr), "Native registry fixture warning:\n" + Result.stdout + Result.stderr);
}

function CheckProgramCLI(strProgram) {
	const Result = Run(strProgram, ["--invalid"]);
	g_Assert.equal(Result.status, 2, "Invalid native fixture arguments must not execute registry contracts.");
	g_Assert.equal(Result.stdout, "");
	g_Assert.equal(Result.stderr.trim(), "Usage: ModuleRegistryContracts");
}

function ReplaceOnce(strSource, strOld, strNew) {
	g_Assert.equal(strSource.split(strOld).length, 2, "Unique mutation target: " + strOld);

	return strSource.replace(strOld, () => strNew);
}

function MutateRegistration(strSource) {
	const nStart = strSource.indexOf("\tvoid ModuleRegistry::RegisterNativeModule(");
	g_Assert(nStart >= 0, "Actual registration definition");

	const nEnd = strSource.indexOf("\n\t}", nStart);
	g_Assert(nEnd > nStart, "Actual registration definition end");

	const strDefinition = strSource.slice(nStart, nEnd + "\n\t}".length);
	const strMutation = ReplaceOnce(strDefinition, "strNativeModule == strModuleName", "strNativeModule != strModuleName");

	return ReplaceOnce(strSource, strDefinition, strMutation);
}

const g_vecCases = [{ Name: "Current", Source: g_strSource, ExpectedStatus: 0 }];
if (!g_strSourceFile) {
	g_vecCases.push(
		{ Name: "DuplicateRegistration", Source: MutateRegistration(g_strSource), ExpectedStatus: 1 },
		{ Name: "PublicVisibility", Source: ReplaceOnce(g_strSource, "strPublicPackage == strModuleName", "strPublicPackage != strModuleName"), ExpectedStatus: 1 },
		{ Name: "EmptyRegistration", Source: ReplaceOnce(g_strSource, "if (strModuleName.empty()) {", "if (!strModuleName.empty()) {"), ExpectedStatus: 1 },
		{ Name: "PublicInventory", Source: ReplaceOnce(g_strSource, '"auth",', '"authx",'), ExpectedStatus: 1 },
	);
}

const g_vecProfiles = ((process.platform === "win32") ? [
	{ Name: "X86", AddressByteCount: 4, Arguments: ["-G", "Visual Studio 17 2022", "-A", "Win32"] },
	{ Name: "X64", AddressByteCount: 8, Arguments: ["-G", "Visual Studio 17 2022", "-A", "x64"] },
] : [
	{ Name: "X86", AddressByteCount: 4, Arguments: ["-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_CXX_FLAGS=-m32 -fsanitize=undefined -fno-sanitize-recover=all"] },
	{ Name: "X64", AddressByteCount: 8, Arguments: ["-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_CXX_FLAGS=-m64 -fsanitize=undefined -fno-sanitize-recover=all"] },
]).filter(Profile => !g_strProfile || (Profile.Name === g_strProfile));
const g_strDirectory = g_FileSystem.mkdtempSync(g_Path.join(g_strBuildRoot, "NativeModuleRegistry-"));
try {
	const vecConfiguration = [
		"# Generated only: native module-registry regression build.",
		"cmake_minimum_required(VERSION 3.20)",
		"project(NativeModuleRegistry LANGUAGES CXX)",
		"set(CMAKE_CXX_STANDARD 20)",
		"set(CMAKE_CXX_STANDARD_REQUIRED ON)",
		"set(CMAKE_CXX_EXTENSIONS OFF)",
		"if(NOT CMAKE_SIZEOF_VOID_P EQUAL SOURCEJS_TEST_ADDRESS_SIZE)",
		'\tmessage(FATAL_ERROR "Requested test bitness was not selected")',
		"endif()",
	];
	for (const Case of g_vecCases) {
		g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, Case.Name + ".cpp"), Case.Source + "\n// Generated only: native module-registry regression source copy.\n");
		vecConfiguration.push(
			'add_executable(' + Case.Name + ' "' + g_strRoot + '/tools/fixtures/ModuleRegistryContracts.cpp" ' + Case.Name + ".cpp)",
			'target_include_directories(' + Case.Name + ' PRIVATE "' + g_strRoot + '/src")',
			"if(MSVC)",
			"\ttarget_compile_options(" + Case.Name + " PRIVATE /W4 /WX /EHsc /permissive-)",
			"elseif(CMAKE_CXX_COMPILER_ID MATCHES \"GNU|Clang\")",
			"\ttarget_compile_options(" + Case.Name + " PRIVATE -Wall -Wextra -Wpedantic -Werror)",
			"else()",
			'\tmessage(FATAL_ERROR "Unsupported fixture compiler")',
			"endif()",
		);
	}

	g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, "CMakeLists.txt"), vecConfiguration.join("\n") + "\n");

	for (const Profile of g_vecProfiles) {
		const strBuildDirectory = g_Path.join(g_strDirectory, Profile.Name);
		RequireSuccess("cmake", ["-S", g_strDirectory, "-B", strBuildDirectory, "-DSOURCEJS_TEST_ADDRESS_SIZE=" + Profile.AddressByteCount, ...Profile.Arguments]);
		RequireSuccess("cmake", ["--build", strBuildDirectory, "--config", "Release", "--parallel", "2"]);

		for (const Case of g_vecCases) {
			const strProgram = (process.platform === "win32") ? g_Path.join(strBuildDirectory, "Release", Case.Name + ".exe") : g_Path.join(strBuildDirectory, Case.Name);
			CheckProgramCLI(strProgram);

			const Result = Run(strProgram, []);
			g_Assert.equal(Result.status, Case.ExpectedStatus, Result.stdout + Result.stderr);
			g_Assert.match((Case.ExpectedStatus === 0) ? Result.stdout : Result.stderr, (Case.ExpectedStatus === 0) ? /Module registry contracts passed/ : /Module registry contract failed:/);
			g_Assert.doesNotMatch(Result.stderr, /runtime error:|UndefinedBehaviorSanitizer|AddressSanitizer/i, "Registry cases must fail native assertions, not sanitizers.");
			console.log(Profile.Name + " " + Case.Name + ": compiled registry contracts checked");
		}
	}
} finally {
	const strRealDirectory = g_FileSystem.realpathSync(g_strDirectory);
	const strRelativeDirectory = g_Path.relative(g_strBuildRoot, strRealDirectory);
	g_Assert(strRelativeDirectory && !g_Path.isAbsolute(strRelativeDirectory) && !strRelativeDirectory.startsWith("..") && !strRelativeDirectory.includes(g_Path.sep) && g_Path.basename(strRealDirectory).startsWith("NativeModuleRegistry-"), "Unsafe fixture cleanup target");
	g_Assert.equal(strRelativeDirectory, g_Path.basename(g_strDirectory), "Only the allocated fixture directory may be removed.");
	g_Assert(!g_FileSystem.lstatSync(g_strDirectory).isSymbolicLink(), "Refuse a linked fixture cleanup target: " + GetDisplayPath(g_strDirectory));
	g_FileSystem.rmSync(strRealDirectory, { recursive: true, force: true });
}
