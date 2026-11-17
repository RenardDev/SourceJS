#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_strUsage = "Usage: node tools/smoke_extension_registry_native_contracts.js [--help]";
const g_unCommandTimeoutMilliseconds = 600_000;
const g_strNamespaceStart = "namespace SourceJS {";
const g_vecMutations = [
	{ Name: "BindingIDReuse", Old: "std::uint64_t unBindingID = unLastBindingID;", New: "std::uint64_t unBindingID = 0;" },
	{ Name: "V8ABITag", Old: " || (strV8ABI != SOURCEJS_EXTENSION_V8_ABI)", New: "" },
	{ Name: "LastSelectorBoundary", Old: "unOneBasedIndex <= static_cast<unsigned long long>(m_vecExtensions.size())", New: "unOneBasedIndex < static_cast<unsigned long long>(m_vecExtensions.size())" },
	{ Name: "StateNameValidation", Old: "Detail::ParseDisabledManagerNames(strStateJSON, vecDisabledNames, IsValidExtensionName)", New: "Detail::ParseDisabledManagerNames(strStateJSON, vecDisabledNames, [](std::string const&) { return true; })" },
	{ Name: "StateNameUniqueness", Old: "\t\t\tif (!ContainsExtensionName(m_vecDisabledExtensionNames, strExtensionName)) {", New: "\t\t\tif (true) {" },
	{ Name: "ManifestBinaryOverride", Old: "if (!strManifestBinary.empty())", New: "if (strManifestBinary.empty())" },
	{ Name: "PascalManifestBinary", Old: 'ReadManifestString(PathManifest, "Binary", "")', New: 'ReadManifestString(PathManifest, "binary", "")' },
	{ Name: "PascalManifestAutoload", Old: 'ReadManifestBoolean(PathManifest, "Autoload", true)', New: 'ReadManifestBoolean(PathManifest, "autoload", true)' },
	{ Name: "RejectLegacyBinary", Old: 'HasLegacyControl("binary")', New: 'HasLegacyControl("obsoletebinary")' },
	{ Name: "RejectLegacyAutoload", Old: 'HasLegacyControl("autoload")', New: 'HasLegacyControl("obsoleteautoload")' },
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

g_Assert(["win32", "linux"].includes(process.platform), "Native registry tests require Windows or Linux.");
g_Assert(["ia32", "x64"].includes(process.arch), "Native registry tests require x86/x64 compiler profiles.");

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strSource = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src/sourcejs/ExtensionManager.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_strFixture = g_FileSystem.readFileSync(g_Path.join(__dirname, "fixtures/ExtensionRegistryContracts.cpp"), "utf8").replace(/\r\n/g, "\n");
g_Assert.equal(g_strSource.split(g_strNamespaceStart).length, 2);
g_Assert.equal(g_strFixture.split("// SOURCEJS_EXTENSION_NAMESPACE").length, 2);

const g_strNamespace = g_strSource.slice(g_strSource.indexOf(g_strNamespaceStart));

g_FileSystem.mkdirSync(g_Path.join(g_strProjectRoot, "build"), { recursive: true });

const g_strBuildRoot = g_FileSystem.realpathSync(g_Path.join(g_strProjectRoot, "build"));
const g_strTemporaryRoot = g_FileSystem.mkdtempSync(g_Path.join(g_strBuildRoot, "NativeExtensionRegistry-"));

function RunCommand(strCommand, vecArguments) {
	const Result = g_ChildProcess.spawnSync(strCommand, vecArguments, { encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
	g_Assert.equal(Result.status, 0, strCommand + ": " + (Result.error?.message ?? (Result.stdout + Result.stderr)));

	return Result;
}

function WriteFixture(strNamespace) {
	g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "ExtensionRegistryContracts.cpp"), g_strFixture.replace("// SOURCEJS_EXTENSION_NAMESPACE", () => "// Generated only: extension-registry fixture with current production definitions.\n" + strNamespace));
}

function RunFixture(strProgram, strLibrary, strNoAPILibrary, bRegression) {
	const strDataRoot = g_FileSystem.mkdtempSync(g_Path.join(g_strTemporaryRoot, "IsolatedRegistryData-"));
	const Result = g_ChildProcess.spawnSync(strProgram, [strDataRoot, strLibrary, strNoAPILibrary], { encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
	g_Assert.equal(Result.status, bRegression ? 1 : 0, Result.error?.message ?? (Result.stdout + Result.stderr));

	if (bRegression) {
		g_Assert.match(Result.stderr, /ExtensionRegistryContracts failed:/, "Compiled regression must fail a native assertion.");
	} else {
		g_Assert.match(Result.stdout, /ExtensionRegistryContracts PASS Assertions=\d+\b/);
		console.log(Result.stdout.trim());
	}
}

let g_unRejectedMutationCount = 0;

try {
	g_FileSystem.copyFileSync(g_Path.join(__dirname, "fixtures/ExtensionRegistryLibrary.cpp"), g_Path.join(g_strTemporaryRoot, "ExtensionRegistryLibrary.cpp"));
	g_FileSystem.copyFileSync(g_Path.join(__dirname, "fixtures/ExtensionRuntimeDouble.h"), g_Path.join(g_strTemporaryRoot, "ExtensionRuntimeDouble.h"));
	g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "CMakeLists.txt"), [
		"# Generated only: native extension-registry regression project.",
		"cmake_minimum_required(VERSION 3.20)",
		"project(ExtensionRegistryContracts LANGUAGES CXX)",
		"add_executable(ExtensionRegistryContracts ExtensionRegistryContracts.cpp)",
		"add_library(ExtensionRegistryLibrary SHARED ExtensionRegistryLibrary.cpp)",
		"add_library(ExtensionRegistryNoAPI SHARED ExtensionRegistryLibrary.cpp)",
		"target_compile_definitions(ExtensionRegistryNoAPI PRIVATE SOURCEJS_FIXTURE_NO_API)",
		"target_link_libraries(ExtensionRegistryContracts PRIVATE ${CMAKE_DL_LIBS})",
		"foreach(strTargetName IN ITEMS ExtensionRegistryContracts ExtensionRegistryLibrary ExtensionRegistryNoAPI)",
		"\ttarget_compile_features(${strTargetName} PRIVATE cxx_std_20)",
		"\ttarget_include_directories(${strTargetName} PRIVATE \"" + g_Path.join(g_strProjectRoot, "src").replace(/\\/g, "/").replace(/"/g, '\\"') + "\")",
		"\ttarget_compile_definitions(${strTargetName} PRIVATE SOURCEJS_SDK_BRANCH=\"fixture\")",
		"\ttarget_compile_definitions(${strTargetName} PRIVATE SOURCEJS_EXTENSION_V8_ABI=\"fixture\")",
		"\tif(CMAKE_SIZEOF_VOID_P EQUAL 4)",
		"\t\ttarget_compile_definitions(${strTargetName} PRIVATE SOURCEJS_TARGET_ARCH=\"x86\")",
		"\telse()",
		"\t\ttarget_compile_definitions(${strTargetName} PRIVATE SOURCEJS_TARGET_ARCH=\"x64\")",
		"\tendif()",
		"\tif(MSVC)",
		"\t\ttarget_compile_definitions(${strTargetName} PRIVATE SOURCEJS_TARGET_PLATFORM=\"windows\")",
		"\t\ttarget_compile_options(${strTargetName} PRIVATE /W4 /WX)",
		"\telse()",
		"\t\ttarget_compile_definitions(${strTargetName} PRIVATE SOURCEJS_TARGET_PLATFORM=\"linux\")",
		"\t\ttarget_compile_options(${strTargetName} PRIVATE -Wall -Wextra -Wpedantic -Werror)",
		"\tendif()",
		"endforeach()",
		"",
	].join("\n"));

	for (const Profile of g_vecProfiles) {
		WriteFixture(g_strNamespace);

		const strBinaryRoot = g_Path.join(g_strTemporaryRoot, Profile.Name);
		RunCommand("cmake", ["-S", g_strTemporaryRoot, "-B", strBinaryRoot, ...Profile.Arguments]);
		RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);

		const strProgram = (process.platform === "win32") ? g_Path.join(strBinaryRoot, "Release/ExtensionRegistryContracts.exe") : g_Path.join(strBinaryRoot, "ExtensionRegistryContracts");
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
		const strLibrary = (process.platform === "win32") ? g_Path.join(strBinaryRoot, "Release/ExtensionRegistryLibrary.dll") : g_Path.join(strBinaryRoot, "libExtensionRegistryLibrary.so");
		const strNoAPILibrary = (process.platform === "win32") ? g_Path.join(strBinaryRoot, "Release/ExtensionRegistryNoAPI.dll") : g_Path.join(strBinaryRoot, "libExtensionRegistryNoAPI.so");
		const strInvalidArgumentRoot = g_Path.join(g_strTemporaryRoot, `InvalidArguments-${Profile.Name}`);
		const vecInvalidArgumentLists = [
			[],
			[strInvalidArgumentRoot, strLibrary],
			[strInvalidArgumentRoot, strLibrary, strNoAPILibrary, "Extra"],
		];
		for (let unArgumentIndex = 0; unArgumentIndex < vecInvalidArgumentLists.length; ++unArgumentIndex) {
			const vecArguments = vecInvalidArgumentLists[unArgumentIndex];
			const Result = g_ChildProcess.spawnSync(CopyProgramForExecution("InvalidArguments" + unArgumentIndex), vecArguments, { encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
			g_Assert.equal(Result.status, 2, Result.error?.message ?? (Result.stdout + Result.stderr));
			g_Assert.match(Result.stderr, /^Usage: ExtensionRegistryContracts /);
			g_Assert.equal(Result.stdout, "", "Invalid arguments must not execute the fixture or emit a result marker.");
			g_Assert.doesNotMatch(Result.stderr, /ExtensionRegistryContracts (?:PASS|failed):?/);
			g_Assert.equal(g_FileSystem.existsSync(strInvalidArgumentRoot), false, "Invalid arguments must not create fixture data.");
		}

		RunFixture(CopyProgramForExecution("Baseline"), strLibrary, strNoAPILibrary, false);

		for (const Mutation of g_vecMutations) {
			g_Assert.equal(g_strNamespace.split(Mutation.Old).length, 2, Mutation.Name);
			WriteFixture(g_strNamespace.replace(Mutation.Old, () => Mutation.New));
			RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);
			RunFixture(CopyProgramForExecution(Mutation.Name), strLibrary, strNoAPILibrary, true);
			++g_unRejectedMutationCount;
		}

		WriteFixture(g_strNamespace);
		RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);
		RunFixture(CopyProgramForExecution("Restored"), strLibrary, strNoAPILibrary, false);
	}
} finally {
	const strRealTemporaryRoot = g_FileSystem.realpathSync(g_strTemporaryRoot);
	const strRelativeTemporaryRoot = g_Path.relative(g_strBuildRoot, strRealTemporaryRoot);
	g_Assert(!g_Path.isAbsolute(strRelativeTemporaryRoot) && !strRelativeTemporaryRoot.startsWith("..") && /^NativeExtensionRegistry-[^/\\]+$/.test(strRelativeTemporaryRoot), "Refuse cleanup outside the exact native fixture directory.");
	g_Assert(!g_FileSystem.lstatSync(g_strTemporaryRoot).isSymbolicLink());
	g_FileSystem.rmSync(strRealTemporaryRoot, { recursive: true, force: true });
}

console.log("Extension-registry native checks PASS; profiles=" + g_vecProfiles.length + "; compiled regressions=" + g_unRejectedMutationCount + "; actual manager/ABI/DLL or DSO/filesystem/state with isolate/cache/path/log doubles; V8/server not exercised; temporary fixture cleaned.");
