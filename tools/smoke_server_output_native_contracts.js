#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

if ((process.argv.length === 3) && ["--help", "-h"].includes(process.argv[2])) {
	console.log("Usage: node tools/smoke_server_output_native_contracts.js [--profile X86|X64]\nCompiles actual server-output definitions with SDK/application doubles; no live engine, V8 or IO.");
	process.exit(0);
}

const g_vecArguments = process.argv.slice(2);
let g_strProfile = "";
if (g_vecArguments.length !== 0) {
	if ((g_vecArguments.length !== 2) || (g_vecArguments[0] !== "--profile") || !["X86", "X64"].includes(g_vecArguments[1])) {
		console.error("Usage: node tools/smoke_server_output_native_contracts.js [--profile X86|X64]");
		process.exit(2);
	}

	g_strProfile = g_vecArguments[1];
}

g_Assert(["win32", "linux"].includes(process.platform), "Windows or Linux host required");
g_Assert(["ia32", "x64"].includes(process.arch), "Native server-output tests require the configured x86/x64 compiler profiles.");

const g_strProjectRoot = g_FileSystem.realpathSync(g_Path.resolve(__dirname, ".."));
const g_strSource = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src", "sourcejs", "Application.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_strFixture = g_FileSystem.readFileSync(g_Path.join(__dirname, "fixtures", "ServerOutputContracts.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_vecMutations = [
	{ Name: "MissingExceptionContainment", Block: "Callback", Old: /\} catch \(\.\.\.\) \{\n\t{4}\/\/ Engine-backed logging[^}]+\}/, New: "} catch (...) {\n\t\t\t\t\tthrow;\n\t\t\t\t}" },
	{ Name: "InvertedBlocking", Block: "Callback", Old: "if (g_Application.EmitServerOutput(nSeverity, strMessage.c_str()))", New: "if (!g_Application.EmitServerOutput(nSeverity, strMessage.c_str()))" },
	{ Name: "MissingRequiredFunction", Block: "Functions", Old: " && m_LogDirect;", New: ";" },
	{ Name: "PrematureHookChanges", Block: "Callback", Old: "if (!m_bDispatching) {", New: "if (true) {" },
	{ Name: "IgnoredFinalHookRequest", Block: "Callback", Old: "SetLoggingStatePushed(m_bEnabled);", New: "SetLoggingStatePushed(true);" },
	{ Name: "MissingStateDetachment", Block: "Callback", Old: "SetLoggingStatePushed(false);", New: "SetLoggingStatePushed(m_bEnabled);" },
	{ Name: "MissingReentrancyGuard", Block: "Callback", Old: "if (m_bDispatching) {", New: "if (false) {" },
	{ Name: "MissingDispatchCompletion", Block: "Callback", Old: "m_bDispatching = false;\n\t\t\ttry {", New: "\t\ttry {" },
	{ Name: "MissingClearState", Block: "Functions", Old: "PushLoggingState(false, true);", New: "PushLoggingState(false, false);", ClearStateOnly: true },
];
const g_vecVariants = ["Narrow", "Wide", "NarrowClearState", "WideClearState"];
const g_vecProfiles = ((process.platform === "win32") ? [
	{ Name: "X86", AddressByteCount: 4, Arguments: ["-G", "Visual Studio 17 2022", "-A", "Win32"] },
	{ Name: "X64", AddressByteCount: 8, Arguments: ["-G", "Visual Studio 17 2022", "-A", "x64"] },
] : [
	{ Name: "X86", AddressByteCount: 4, Arguments: ["-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_CXX_FLAGS=-m32 -fsanitize=undefined -fno-sanitize-recover=all"] },
	{ Name: "X64", AddressByteCount: 8, Arguments: ["-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_CXX_FLAGS=-m64 -fsanitize=undefined -fno-sanitize-recover=all"] },
]).filter(Profile => !g_strProfile || (Profile.Name === g_strProfile));
const g_unTimeoutMilliseconds = 600000;
const g_unOutputLimitBytes = 16 * 1024 * 1024;
const g_unFixtureCleanupRetries = 3;
const g_unFixtureCleanupRetryDelayMilliseconds = 100;
const g_strEmergencyDiagnostic = "[SourceJS] [ERROR] ServerOutput callback failed.\n";

function ExtractBlock(strStart, strEnd) {
	g_Assert.equal(g_strSource.split(strStart).length, 2, strStart);
	const nStart = g_strSource.indexOf(strStart);
	const nEnd = g_strSource.indexOf(strEnd, nStart);
	g_Assert(nEnd > nStart, strEnd);

	return g_strSource.slice(nStart, nEnd).trimEnd();
}

function RunCommand(strCommand, vecArguments, unExpectedStatus = 0) {
	const strDisplayCommand = g_Path.isAbsolute(strCommand) ? g_Path.relative(g_strProjectRoot, strCommand) : strCommand;
	let strExecutionCommand = strCommand;

	if ((process.platform === "win32") && /^ServerOutput(?:Narrow|Wide)(?:ClearState)?\.exe$/.test(g_Path.basename(strCommand))) {
		const strRealProgram = g_FileSystem.realpathSync(strCommand);
		const strRealBuildRoot = g_FileSystem.realpathSync(g_Path.join(g_strProjectRoot, "build"));
		const strRelativeProgramPath = g_Path.relative(strRealBuildRoot, strRealProgram);
		g_Assert.match(strRelativeProgramPath, /^NativeServerOutput-[^/\\]+[/\\](?:X86|X64)[/\\]Release[/\\]ServerOutput(?:Narrow|Wide)(?:ClearState)?\.exe$/, "Execution copies must stay within the private fixture build");

		// Keep the link output unexecuted; Windows can retain image mappings after process exit.
		const strExecutionDirectory = g_FileSystem.mkdtempSync(g_Path.join(g_Path.dirname(strRealProgram), "Run-"));
		strExecutionCommand = g_Path.join(strExecutionDirectory, g_Path.basename(strRealProgram));
		g_FileSystem.copyFileSync(strRealProgram, strExecutionCommand, g_FileSystem.constants.COPYFILE_EXCL);
	}

	const Result = g_ChildProcess.spawnSync(strExecutionCommand, vecArguments, { cwd: g_strProjectRoot, encoding: "utf8", windowsHide: true, timeout: g_unTimeoutMilliseconds, maxBuffer: g_unOutputLimitBytes });
	g_Assert(!Result.error, strDisplayCommand + " failed: " + Result.error?.message);
	g_Assert.equal(Result.signal, null, strDisplayCommand + " received native process signal: " + Result.signal);
	g_Assert.equal(Result.status, unExpectedStatus, strDisplayCommand + ": " + Result.stdout + Result.stderr);
	g_Assert(!/\bwarning\b/i.test(Result.stdout + Result.stderr), strDisplayCommand + " reported a warning:\n" + Result.stdout + Result.stderr);
	g_Assert(!/(?:runtime error:|(?:Address|UndefinedBehavior|Leak|Memory|Thread)Sanitizer|Sanitizer:)/i.test(Result.stdout + Result.stderr), strDisplayCommand + " reported a sanitizer failure:\n" + Result.stdout + Result.stderr);

	return Result;
}

function AssertSuccessfulExecution(strProgram) {
	const Result = RunCommand(strProgram, []);
	g_Assert.equal(Result.stdout.replace(/\r\n/g, "\n"), "ServerOutputContracts PASS\n");
	g_Assert.equal(Result.stderr.replace(/\r\n/g, "\n"), g_strEmergencyDiagnostic.repeat(4), "Callback and ordinary-listener failures must use only the emergency diagnostic.");
}

const g_strFunctions = ExtractBlock("\t\tusing fnLoggingSystemRegisterLoggingListener", "\n\t\t// Preserve lookup argument order;");
const g_strCallback = ExtractBlock("\t\tstd::string ConvertServerOutputMessage(", "\n#endif\n\n\t\tstd::filesystem::path ResolveGameRootPath(");
const g_strSetter = ExtractBlock("\tvoid Application::SetServerOutputHookEnabled(", "\n\tbool Application::EmitServerOutput(").replace("Application::SetServerOutputHookEnabled", "ApplicationDouble::SetServerOutputHookEnabled");
g_Assert.equal(g_strFixture.split("// SOURCEJS_SERVER_OUTPUT_FUNCTIONS").length, 2);
g_Assert.equal(g_strFixture.split("// SOURCEJS_SERVER_OUTPUT_CALLBACK").length, 2);
g_Assert.equal(g_strFixture.split("// SOURCEJS_SERVER_OUTPUT_SETTER").length, 2);

g_FileSystem.mkdirSync(g_Path.join(g_strProjectRoot, "build"), { recursive: true });
const g_strBuildRoot = g_FileSystem.realpathSync(g_Path.join(g_strProjectRoot, "build"));
const g_strTemporaryRoot = g_FileSystem.mkdtempSync(g_Path.join(g_strBuildRoot, "NativeServerOutput-"));

function WriteFixture(strFunctions, strCallback) {
	const strProgram = g_strFixture.replace("// SOURCEJS_SERVER_OUTPUT_FUNCTIONS", () => strFunctions).replace("// SOURCEJS_SERVER_OUTPUT_CALLBACK", () => strCallback).replace("// SOURCEJS_SERVER_OUTPUT_SETTER", () => "#define SOURCEJS_HAS_TIER0_LOGGING 1\n" + g_strSetter);
	g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "ServerOutputContracts.cpp"), strProgram + "\n// Generated-only; tools/smoke_server_output_native_contracts.js owns this copy.\n");
}

let g_unRejectedMutationCount = 0;
try {
	g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "CMakeLists.txt"), [
		"cmake_minimum_required(VERSION 3.20)",
		"project(ServerOutputContracts LANGUAGES CXX)",
		"set(CMAKE_CXX_EXTENSIONS OFF)",
		"if(NOT CMAKE_SIZEOF_VOID_P EQUAL SOURCEJS_TEST_ADDRESS_SIZE)",
		'\tmessage(FATAL_ERROR "Requested test bitness was not selected")',
		"endif()",
		"foreach(Variant IN ITEMS Narrow Wide NarrowClearState WideClearState)",
		"\tadd_executable(ServerOutput${Variant} ServerOutputContracts.cpp)",
		"\ttarget_compile_features(ServerOutput${Variant} PRIVATE cxx_std_20)",
		"\tif(Variant MATCHES ^Wide)",
		"\t\ttarget_compile_definitions(ServerOutput${Variant} PRIVATE UNICODE)",
		"\tendif()",
		"\tif(Variant MATCHES ClearState$)",
		"\t\ttarget_compile_definitions(ServerOutput${Variant} PRIVATE SOURCEJS_TEST_CLEAR_STATE)",
		"\tendif()",
		"\tif(MSVC)",
		"\t\ttarget_compile_options(ServerOutput${Variant} PRIVATE /W4 /WX)",
		'\telseif(CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")',
		"\t\ttarget_compile_options(ServerOutput${Variant} PRIVATE -Wall -Wextra -Wpedantic -Werror)",
		"\telse()",
		'\t\tmessage(FATAL_ERROR "Unsupported fixture compiler")',
		"\tendif()",
		"endforeach()",
		"",
	].join("\n"));

	for (const Profile of g_vecProfiles) {
		WriteFixture(g_strFunctions, g_strCallback);
		const strBinaryRoot = g_Path.join(g_strTemporaryRoot, Profile.Name);
		RunCommand("cmake", ["-S", g_strTemporaryRoot, "-B", strBinaryRoot, "-DSOURCEJS_TEST_ADDRESS_SIZE=" + Profile.AddressByteCount, ...Profile.Arguments]);
		RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);

		const vecPrograms = g_vecVariants.map(strVariant => (process.platform === "win32") ? g_Path.join(strBinaryRoot, "Release", "ServerOutput" + strVariant + ".exe") : g_Path.join(strBinaryRoot, "ServerOutput" + strVariant));
		for (const strProgram of vecPrograms) {
			for (const vecInvalidArguments of [["--extra"], ["--extra", "value"]]) {
				const InvalidResult = RunCommand(strProgram, vecInvalidArguments, 2);
				g_Assert.equal(InvalidResult.stdout, "", "Invalid native CLI must not report a fixture result");
				g_Assert.equal(InvalidResult.stderr.trim(), "Usage: ServerOutputContracts");
			}

			AssertSuccessfulExecution(strProgram);
		}

		for (const Mutation of g_vecMutations) {
			const strOriginal = (Mutation.Block === "Callback") ? g_strCallback : g_strFunctions;
			const unMatchCount = (typeof Mutation.Old === "string") ? (strOriginal.split(Mutation.Old).length - 1) : [...strOriginal.matchAll(new RegExp(Mutation.Old.source, "g"))].length;
			g_Assert.equal(unMatchCount, 1, Mutation.Name + ": regression must match exactly once");

			const strModified = strOriginal.replace(Mutation.Old, () => Mutation.New);
			g_Assert.notEqual(strModified, strOriginal, Mutation.Name);
			WriteFixture((Mutation.Block === "Functions") ? strModified : g_strFunctions, (Mutation.Block === "Callback") ? strModified : g_strCallback);
			RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);
			const vecMutationPrograms = Mutation.ClearStateOnly ? vecPrograms.filter(strProgram => g_Path.basename(strProgram).includes("ClearState")) : vecPrograms;
			for (const strProgram of vecMutationPrograms) {
				const Result = RunCommand(strProgram, [], 1);
				g_Assert.equal(Result.stdout, "", Mutation.Name + ": regression must not report a successful result");
				g_Assert.match(Result.stderr, /ServerOutputContracts failed:/, Mutation.Name + ": native assertion required.");
				++g_unRejectedMutationCount;
			}
		}

		WriteFixture(g_strFunctions, g_strCallback);
		RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);
		for (const strProgram of vecPrograms) {
			AssertSuccessfulExecution(strProgram);
		}
	}
} finally {
	const DirectoryStatus = g_FileSystem.lstatSync(g_strTemporaryRoot);
	g_Assert(DirectoryStatus.isDirectory() && !DirectoryStatus.isSymbolicLink(), "Fixture cleanup target must be the allocated directory, not a link");

	const strRealTemporaryRoot = g_FileSystem.realpathSync(g_strTemporaryRoot);
	const strRelativeTemporaryRoot = g_Path.relative(g_strBuildRoot, strRealTemporaryRoot);
	g_Assert(!g_Path.isAbsolute(strRelativeTemporaryRoot) && !strRelativeTemporaryRoot.startsWith("..") && /^NativeServerOutput-[^/\\]+$/.test(strRelativeTemporaryRoot) && (g_Path.basename(strRealTemporaryRoot) === g_Path.basename(g_strTemporaryRoot)), "Refuse cleanup outside the exact native fixture directory.");
	g_FileSystem.rmSync(strRealTemporaryRoot, { recursive: true, force: true, maxRetries: g_unFixtureCleanupRetries, retryDelay: g_unFixtureCleanupRetryDelayMilliseconds });
}

const unExpectedMutationCount = g_vecProfiles.length * g_vecMutations.reduce((unCount, Mutation) => unCount + g_vecVariants.filter(strVariant => !Mutation.ClearStateOnly || strVariant.endsWith("ClearState")).length, 0);
g_Assert.equal(g_unRejectedMutationCount, unExpectedMutationCount);

console.log("Server-output native checks PASS; profiles=" + g_vecProfiles.length + "; compiled regressions=" + g_unRejectedMutationCount + "; actual callback/converter/function-record/setter definitions with SDK/application doubles; live engine/V8/IO not exercised; temporary fixture cleaned.");
