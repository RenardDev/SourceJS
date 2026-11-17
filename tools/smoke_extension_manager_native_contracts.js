#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_strUsage = "Usage: node tools/smoke_extension_manager_native_contracts.js [--help]";
const g_unCommandTimeoutMilliseconds = 600_000;
const g_unExpectedScenarioCount = 55;
const g_ScenarioResult = new RegExp(`ExtensionManagerContracts PASS Scenarios=${g_unExpectedScenarioCount}\\b`);
const g_strGeneratedNoticeAnchor = "// Actual selected production bodies and ABI declarations; library/runtime/registry";
const g_vecMutations = [
	{ Name: "TransactionalModuleOutput", Block: "Helpers", Old: "\t\t\tif (!ExtensionAPI.m_pGetModuleCount || !ExtensionAPI.m_pGetModule) {", New: "\t\t\tvecModulesOut.clear();\n\t\t\tif (!ExtensionAPI.m_pGetModuleCount || !ExtensionAPI.m_pGetModule) {" },
	{ Name: "ModuleCountLimit", Block: "Helpers", Old: "unModuleCount > kMaximumExtensionModuleCount", New: "unModuleCount >= kMaximumExtensionModuleCount" },
	{ Name: "ModuleNameLength", Block: "Helpers", Old: "kExtensionNameCapacity = 256;", New: "kExtensionNameCapacity = 257;" },
	{ Name: "ReadFailureOutput", Block: "Helpers", Old: "\t\t\tstd::ifstream InputFile(PathFile, std::ios::binary);", New: "\t\t\tstrTextOut.clear();\n\t\t\tstd::ifstream InputFile(PathFile, std::ios::binary);" },
	{ Name: "LibraryOwnershipCommit", Block: "Methods", Old: "\t\tpLibraryOwner.release();", New: "\t\tpLibraryOwner.reset();" },
	{ Name: "MissingSDKContext", Block: "Methods", Old: "ExtensionContext.m_pszSDKBranch = SOURCEJS_SDK_BRANCH;", New: "ExtensionContext.m_pszSDKBranch = nullptr;", Failure: /failed: SDK context/ },
	{ Name: "MissingPlatformContext", Block: "Methods", Old: "ExtensionContext.m_pszPlatform = SOURCEJS_TARGET_PLATFORM;", New: "ExtensionContext.m_pszPlatform = nullptr;", Failure: /failed: platform context/ },
	{ Name: "MissingArchitectureContext", Block: "Methods", Old: "ExtensionContext.m_pszArchitecture = SOURCEJS_TARGET_ARCH;", New: "ExtensionContext.m_pszArchitecture = nullptr;", Failure: /failed: architecture context/ },
	{ Name: "PublishedModuleName", Block: "Methods", Old: "\t\tExtensionCandidate.m_bLoaded = true;", New: "\t\tExtensionCandidate.m_vecNativeModules.front().m_strName.clear();\n\t\tExtensionCandidate.m_bLoaded = true;", Failure: /failed: published module content/ },
	{ Name: "LoadRollbackCallback", Block: "Methods", Old: "if (bLoadCompleted && ExtensionCandidate.m_pRuntime)", New: "if (!bLoadCompleted && ExtensionCandidate.m_pRuntime)" },
	{ Name: "ShutdownRecordRetention", Block: "Methods", Old: "\t\tif (!m_vecExtensions.empty()) {", New: "\t\tm_vecExtensions.clear();\n\t\tif (!m_vecExtensions.empty()) {" },
	{ Name: "UnloadFailureResult", Block: "Methods", Old: "&& !StopExtensionRuntime(*pExtension->m_pRuntime, pExtension->m_API.m_pUnload)", New: "&& StopExtensionRuntime(*pExtension->m_pRuntime, pExtension->m_API.m_pUnload)" },
];
const g_vecABIMutations = [
	{ Name: "ContextRootOrder", Old: "\t\tchar const* m_pszRootPath;\n\t\tchar const* m_pszSDKBranch;", New: "\t\tchar const* m_pszSDKBranch;\n\t\tchar const* m_pszRootPath;" },
	{ Name: "ContextMetadataOrder", Old: "\t\tchar const* m_pszPlatform;\n\t\tchar const* m_pszArchitecture;", New: "\t\tchar const* m_pszArchitecture;\n\t\tchar const* m_pszPlatform;" },
	{ Name: "APILifecycleOrder", Old: "\t\tfnSourceJSExtensionLoad m_pLoad;\n\t\tfnSourceJSExtensionUnload m_pUnload;", New: "\t\tfnSourceJSExtensionUnload m_pUnload;\n\t\tfnSourceJSExtensionLoad m_pLoad;" },
	{ Name: "APIModuleCountOrder", Old: "\t\tfnSourceJSExtensionUnload m_pUnload;\n\t\tfnSourceJSExtensionGetModuleCount m_pGetModuleCount;", New: "\t\tfnSourceJSExtensionGetModuleCount m_pGetModuleCount;\n\t\tfnSourceJSExtensionUnload m_pUnload;" },
	{ Name: "ModuleFunctionTableOrder", Old: "\t\tstd::uint32_t m_unFunctionCount;\n\t\tSOURCEJS_EXTENSION_FUNCTION const* m_pFunctions;", New: "\t\tSOURCEJS_EXTENSION_FUNCTION const* m_pFunctions;\n\t\tstd::uint32_t m_unFunctionCount;" },
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

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strSource = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src", "sourcejs", "ExtensionManager.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_strFixture = g_FileSystem.readFileSync(g_Path.join(__dirname, "fixtures", "ExtensionManagerContracts.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_strABIHeader = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src", "sourcejs", "public", "ISourceJSExtension.h"), "utf8").replace(/\r\n/g, "\n");

function ExtractBlock(strStart, strEnd) {
	g_Assert.equal(g_strSource.split(strStart).length, 2, strStart);

	const nStart = g_strSource.indexOf(strStart);
	const nEnd = g_strSource.indexOf(strEnd, nStart);
	g_Assert(nEnd > nStart, strEnd);

	return g_strSource.slice(nStart, nEnd).trimEnd();
}

function RunCommand(strCommand, vecArguments) {
	const Result = g_ChildProcess.spawnSync(strCommand, vecArguments, { encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
	g_Assert.equal(Result.status, 0, strCommand + ": " + (Result.error?.message ?? (Result.stdout + Result.stderr)));

	return Result;
}

const g_strHelpers = ExtractBlock("\t\tconstexpr std::uint32_t kMaximumExtensionModuleCount", "\n\t} // namespace");
const g_strMethods = ExtractBlock("\tExtensionManager::ExtensionManager()", "\n\tvoid ExtensionManager::ReloadAll()");

g_Assert(["win32", "linux"].includes(process.platform), "Native extension tests require Windows or Linux.");
g_Assert(["ia32", "x64"].includes(process.arch), "Native extension tests require x86/x64 compiler profiles.");
g_Assert.equal(g_strFixture.split("\t\t// SOURCEJS_EXTENSION_HELPERS").length, 2);
g_Assert.equal(g_strFixture.split("\t// SOURCEJS_EXTENSION_METHODS").length, 2);
g_Assert.equal(g_strFixture.split(g_strGeneratedNoticeAnchor).length, 2);

g_FileSystem.mkdirSync(g_Path.join(g_strProjectRoot, "build"), { recursive: true });

const g_strBuildRoot = g_FileSystem.realpathSync(g_Path.join(g_strProjectRoot, "build"));
const g_strTemporaryRoot = g_FileSystem.mkdtempSync(g_Path.join(g_strBuildRoot, "NativeExtensionManager-"));
g_FileSystem.copyFileSync(g_Path.join(__dirname, "fixtures/ExtensionRuntimeDouble.h"), g_Path.join(g_strTemporaryRoot, "ExtensionRuntimeDouble.h"));

function WriteFixture(strHelpers, strMethods, strABIHeader = g_strABIHeader) {
	const strProgram = g_strFixture.replace(g_strGeneratedNoticeAnchor, "// Generated only: extension-manager fixture with current production definitions.\n" + g_strGeneratedNoticeAnchor).replace("\t\t// SOURCEJS_EXTENSION_HELPERS", () => strHelpers).replace("\t// SOURCEJS_EXTENSION_METHODS", () => strMethods);
	g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "ExtensionManagerContracts.cpp"), strProgram);
	g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "ExtensionABI.h"), strABIHeader.replace("#pragma once\n", "#pragma once\n\n// Generated only: current public ABI snapshot for compiled contract controls.\n"));
}

let g_unRejectedMutationCount = 0;
let g_unRejectedABIMutationCount = 0;

try {
	g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "CMakeLists.txt"), [
		"# Generated only: native extension-manager regression project.",
		"cmake_minimum_required(VERSION 3.20)",
		"project(ExtensionManagerContracts LANGUAGES CXX)",
		"add_executable(ExtensionManagerContracts ExtensionManagerContracts.cpp)",
		"target_compile_features(ExtensionManagerContracts PRIVATE cxx_std_20)",
		"target_include_directories(ExtensionManagerContracts PRIVATE \"" + g_Path.join(g_strProjectRoot, "src").replace(/\\/g, "/").replace(/"/g, '\\"') + "\")",
		"target_compile_definitions(ExtensionManagerContracts PRIVATE SOURCEJS_SDK_BRANCH=\"fixture\")",
		"target_compile_definitions(ExtensionManagerContracts PRIVATE SOURCEJS_EXTENSION_V8_ABI=\"fixture\")",
		"target_compile_definitions(ExtensionManagerContracts PRIVATE SOURCEJS_EXTENSION_ABI_TEST_HEADER=\"ExtensionABI.h\")",
		"if(CMAKE_SIZEOF_VOID_P EQUAL 4)",
		"\ttarget_compile_definitions(ExtensionManagerContracts PRIVATE SOURCEJS_TARGET_ARCH=\"x86\")",
		"else()",
		"\ttarget_compile_definitions(ExtensionManagerContracts PRIVATE SOURCEJS_TARGET_ARCH=\"x64\")",
		"endif()",
		"if(MSVC)",
		"\ttarget_compile_definitions(ExtensionManagerContracts PRIVATE SOURCEJS_TARGET_PLATFORM=\"windows\")",
		"\ttarget_compile_options(ExtensionManagerContracts PRIVATE /W4 /WX)",
		"else()",
		"\ttarget_compile_definitions(ExtensionManagerContracts PRIVATE SOURCEJS_TARGET_PLATFORM=\"linux\")",
		"\ttarget_compile_options(ExtensionManagerContracts PRIVATE -Wall -Wextra -Wpedantic -Werror)",
		"endif()",
		"",
	].join("\n"));

	const strDataRoot = g_Path.join(g_strTemporaryRoot, "IsolatedExtensionDataWithNonSmallStringPath");
	g_FileSystem.mkdirSync(strDataRoot);

	for (const Profile of g_vecProfiles) {
		WriteFixture(g_strHelpers, g_strMethods);

		const strBinaryRoot = g_Path.join(g_strTemporaryRoot, Profile.Name);
		RunCommand("cmake", ["-S", g_strTemporaryRoot, "-B", strBinaryRoot, ...Profile.Arguments]);
		RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);

		const strProgram = (process.platform === "win32") ? g_Path.join(strBinaryRoot, "Release", "ExtensionManagerContracts.exe") : g_Path.join(strBinaryRoot, "ExtensionManagerContracts");

		// Execute unique private copies so Windows never locks the image reused by the mutation linker.
		const CopyProgramForExecution = strScenarioName => {
			if (process.platform !== "win32") {
				return strProgram;
			}

			g_Assert.match(strScenarioName, /^[A-Za-z0-9_]+$/, "Execution copies use controlled scenario names.");
			const strExecutionRoot = g_Path.join(strBinaryRoot, "Executions");
			g_FileSystem.mkdirSync(strExecutionRoot, { recursive: true });

			const strExecutionProgram = g_Path.join(strExecutionRoot, strScenarioName + ".exe");
			g_FileSystem.copyFileSync(strProgram, strExecutionProgram, g_FileSystem.constants.COPYFILE_EXCL);

			return strExecutionProgram;
		};

		g_Assert.match(RunCommand(CopyProgramForExecution("Baseline"), [strDataRoot]).stdout, g_ScenarioResult);

		for (const Mutation of g_vecMutations) {
			const strOriginal = (Mutation.Block === "Helpers") ? g_strHelpers : g_strMethods;
			g_Assert.equal(strOriginal.split(Mutation.Old).length, 2, Mutation.Name);

			const strModified = strOriginal.replace(Mutation.Old, () => Mutation.New);
			WriteFixture((Mutation.Block === "Helpers") ? strModified : g_strHelpers, (Mutation.Block === "Methods") ? strModified : g_strMethods);
			RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);

			const Result = g_ChildProcess.spawnSync(CopyProgramForExecution(Mutation.Name), [strDataRoot], { encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
			g_Assert.equal(Result.status, 1, Mutation.Name + ": compiled regression accepted or execution failed.");
			g_Assert.match(Result.stderr, /ExtensionManagerContracts failed:/, Mutation.Name + ": native assertion required.");
			if (Mutation.Failure) {
				g_Assert.match(Result.stderr, Mutation.Failure, Mutation.Name);
			}

			++g_unRejectedMutationCount;
		}

		for (const Mutation of g_vecABIMutations) {
			g_Assert.equal(g_strABIHeader.split(Mutation.Old).length, 2, Mutation.Name);
			WriteFixture(g_strHelpers, g_strMethods, g_strABIHeader.replace(Mutation.Old, () => Mutation.New));

			const Result = g_ChildProcess.spawnSync("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"], { encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
			g_Assert.equal(Result.error, undefined, Mutation.Name + ": compiler execution failure.");
			g_Assert.equal(Result.signal, null, Mutation.Name + ": compiler terminated unexpectedly.");
			g_Assert(Number.isInteger(Result.status) && (Result.status > 0), Mutation.Name + ": ABI drift compiled successfully.");
			g_Assert.match(Result.stdout + Result.stderr, /SourceJS extension ABI:/, Mutation.Name + ": actual layout assertion failure required.");
			++g_unRejectedABIMutationCount;
		}

		WriteFixture(g_strHelpers, g_strMethods);
		RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);
		g_Assert.match(RunCommand(CopyProgramForExecution("Restored"), [strDataRoot]).stdout, g_ScenarioResult);
		console.log("Extension-manager native profile " + Profile.Name + ": " + g_unExpectedScenarioCount + " scenarios, " + g_vecMutations.length + " runtime mutations and " + g_vecABIMutations.length + " ABI compile controls passed.");
	}
} finally {
	const strRealTemporaryRoot = g_FileSystem.realpathSync(g_strTemporaryRoot);
	const strRelativeTemporaryRoot = g_Path.relative(g_strBuildRoot, strRealTemporaryRoot);
	g_Assert(!g_Path.isAbsolute(strRelativeTemporaryRoot) && !strRelativeTemporaryRoot.startsWith("..") && /^NativeExtensionManager-[^/\\]+$/.test(strRelativeTemporaryRoot), "Refuse cleanup outside the exact native fixture directory.");
	g_Assert(!g_FileSystem.lstatSync(g_strTemporaryRoot).isSymbolicLink());
	g_FileSystem.rmSync(strRealTemporaryRoot, { recursive: true, force: true });
}

console.log("Extension-manager native checks PASS; profiles=" + g_vecProfiles.length + "; scenarios=" + g_unExpectedScenarioCount + " per profile; compiled regressions=" + g_unRejectedMutationCount + "; ABI compile controls=" + g_unRejectedABIMutationCount + "; actual selected lifecycle/helpers and ABI types, real allocation/unwind/file reads with library/runtime/registry doubles; live DSO/V8/server not exercised; temporary fixture cleaned.");
