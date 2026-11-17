#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_vecArguments = process.argv.slice(2);
if (g_vecArguments.length > 0) {
	const bShowHelp = (g_vecArguments.length === 1) && (g_vecArguments[0] === "--help");
	const strUsage = `Usage: node ${g_Path.relative(process.cwd(), __filename)} [--help]\nCompiles and runs native dispatcher contracts for both configured architectures.\nUnexpected arguments exit with status 2.\n`;
	g_FileSystem.writeSync(bShowHelp ? process.stdout.fd : process.stderr.fd, strUsage);
	process.exit(bShowHelp ? 0 : 2);
}

const g_unCommandTimeoutMilliseconds = 600_000;
const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strSource = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src", "sourcejs", "CommandDispatcher.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_strFixture = g_FileSystem.readFileSync(g_Path.join(__dirname, "fixtures", "CommandDispatcherContracts.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_strGeneratedNoticeAnchor = "\n#define SOURCEJS_VERSION ";

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

const g_strHelpers = ExtractBlock("\t\tconstexpr std::size_t kClientPageSize", "\n\t} // namespace");
const g_strMethods = [
	ExtractBlock("\tCommandDispatcher::CommandDispatcher()", "\n\tvoid CommandDispatcher::DispatchClient("),
	ExtractBlock("\tvoid CommandDispatcher::PrintRoot()", "\n\tvoid CommandDispatcher::PrintLines("),
	ExtractBlock("\tbool CommandDispatcher::RequireSelector(", "\n\tvoid CommandDispatcher::PrintClientRoot("),
	ExtractBlock("\tbool CommandDispatcher::ReadClientPageOffset(", "\n} // namespace SourceJS"),
].join("\n\n");
const g_vecMutations = [
	{ Name: "AuthorizationRoute", Block: "Methods", Old: 'if (strCommandName == "auth") {', New: 'if (strCommandName == "missing-auth") {' },
	{ Name: "RootExtensionListHelp", Block: "Methods", Old: '\t\tLogInfo("  sjs extensions list");\n\t\tLogInfo("  sjs extensions [unload|reload|disable|enable] <name/index>");', New: '\t\tLogInfo("  sjs extensions [list|unload|reload|disable|enable] <name/index>");' },
	{ Name: "TrailingManagerArguments", Block: "Helpers", Old: "unActualArgumentCount != unExpectedArgumentCount", New: "unActualArgumentCount < unExpectedArgumentCount" },
	{ Name: "TrailingRootArguments", Block: "Methods", Old: "bIsRootQuery && (unSubcommandArgumentIndex != vecArguments.size())", New: "bIsRootQuery && (unSubcommandArgumentIndex > vecArguments.size())" },
	{ Name: "ExtensionArgumentGate", Block: "Methods", Old: "!ValidateManagerCommandArgumentCount(vecArguments, unActionArgumentIndex, \"extensions\")", New: "ValidateManagerCommandArgumentCount(vecArguments, unActionArgumentIndex, \"extensions\")" },
	{ Name: "PluginListOutput", Block: "Methods", Old: "PrintLines(m_pPluginManager->List());", New: "m_pPluginManager->List();", Failure: /Implicit manager list omitted its output/ },
	{ Name: "ExtensionListOutput", Block: "Methods", Old: "PrintLines(m_pExtensionManager->List());", New: "m_pExtensionManager->List();", Failure: /Implicit manager list omitted its output/ },
	{ Name: "EmptySelector", Block: "Methods", Old: "|| vecArguments[unSelectorArgumentIndex].empty()", New: "|| !vecArguments[unSelectorArgumentIndex].empty()" },
	{ Name: "SelectorOutputCommit", Block: "Methods", Old: "\t\tif (!pszUsage || !*pszUsage) {", New: "\t\tstrSelectorOut.clear();\n\t\tif (!pszUsage || !*pszUsage) {" },
	{ Name: "OffsetOutputCommit", Block: "Methods", Old: "\t\tif (unOffsetArgumentIndex >= vecArguments.size()) {", New: "\t\tunPageOffsetOut = 0;\n\t\tif (unOffsetArgumentIndex >= vecArguments.size()) {" },
	{ Name: "OffsetNarrowing", Block: "Methods", Old: "unParsedPageOffset > static_cast<unsigned long long>(std::numeric_limits<std::size_t>::max())", New: "unParsedPageOffset < static_cast<unsigned long long>(std::numeric_limits<std::size_t>::max())" },
	{ Name: "OffsetAlignment", Block: "Methods", Old: "unParsedPageOffset % kClientPageSize", New: "unParsedPageOffset % (kClientPageSize + 1)" },
];
const g_vecProfiles = (process.platform === "win32") ? [
	{ Name: "Win32", Arguments: ["-G", "Visual Studio 17 2022", "-A", "Win32"] },
	{ Name: "X64", Arguments: ["-G", "Visual Studio 17 2022", "-A", "x64"] },
] : [
	{ Name: "X86", Arguments: ["-DCMAKE_CXX_FLAGS=-m32 -fsanitize=undefined -fno-sanitize-recover=all"] },
	{ Name: "X64", Arguments: ["-DCMAKE_CXX_FLAGS=-m64 -fsanitize=undefined -fno-sanitize-recover=all"] },
];

const g_unRoutingScenarioCount = 154;
const g_unHelperScenarioCount = 27;
const g_ContractReportPattern = new RegExp(`CommandDispatcherContracts PASS Scenarios=${g_unRoutingScenarioCount} HelperScenarios=${g_unHelperScenarioCount}\\b`);

g_Assert(["ia32", "x64"].includes(process.arch), "Native dispatcher tests require the configured x86/x64 compiler profiles.");
g_Assert.equal(g_strFixture.split("\t\t// SOURCEJS_DISPATCHER_HELPERS").length, 2);
g_Assert.equal(g_strFixture.split("\t// SOURCEJS_DISPATCHER_METHODS").length, 2);
g_Assert.equal(g_strFixture.split(g_strGeneratedNoticeAnchor).length, 2);

g_FileSystem.mkdirSync(g_Path.join(g_strProjectRoot, "build"), { recursive: true });
const g_strBuildRoot = g_FileSystem.realpathSync(g_Path.join(g_strProjectRoot, "build"));
const g_strTemporaryRoot = g_FileSystem.mkdtempSync(g_Path.join(g_strBuildRoot, "NativeCommandDispatcher-"));

function WriteFixture(strHelpers, strMethods) {
	const strProgram = g_strFixture.replace(g_strGeneratedNoticeAnchor, "\n// Generated only: fixture with current production dispatcher definitions." + g_strGeneratedNoticeAnchor).replace("\t\t// SOURCEJS_DISPATCHER_HELPERS", () => strHelpers).replace("\t// SOURCEJS_DISPATCHER_METHODS", () => strMethods);
	g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "CommandDispatcherContracts.cpp"), strProgram);
}

let g_unRejectedMutationCount = 0;
try {
	g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "CMakeLists.txt"), [
		"# Generated only: native command-dispatcher regression project.",
		"cmake_minimum_required(VERSION 3.20)",
		"project(CommandDispatcherContracts LANGUAGES CXX)",
		"add_executable(CommandDispatcherContracts CommandDispatcherContracts.cpp)",
		"target_compile_features(CommandDispatcherContracts PRIVATE cxx_std_20)",
		"if(MSVC)",
		"\ttarget_compile_options(CommandDispatcherContracts PRIVATE /W4 /WX)",
		"else()",
		"\ttarget_compile_options(CommandDispatcherContracts PRIVATE -Wall -Wextra -Wpedantic -Werror)",
		"endif()",
		"",
	].join("\n"));

	for (const Profile of g_vecProfiles) {
		WriteFixture(g_strHelpers, g_strMethods);

		const strBinaryRoot = g_Path.join(g_strTemporaryRoot, Profile.Name);
		RunCommand("cmake", ["-S", g_strTemporaryRoot, "-B", strBinaryRoot, ...Profile.Arguments]);
		RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);

		const strProgram = (process.platform === "win32") ? g_Path.join(strBinaryRoot, "Release", "CommandDispatcherContracts.exe") : g_Path.join(strBinaryRoot, "CommandDispatcherContracts");
		g_Assert.match(RunCommand(strProgram, []).stdout, g_ContractReportPattern);

		for (const Mutation of g_vecMutations) {
			const strOriginal = (Mutation.Block === "Helpers") ? g_strHelpers : g_strMethods;
			g_Assert.equal(strOriginal.split(Mutation.Old).length, 2, Mutation.Name);
			const strModified = strOriginal.replace(Mutation.Old, () => Mutation.New);
			WriteFixture((Mutation.Block === "Helpers") ? strModified : g_strHelpers, (Mutation.Block === "Methods") ? strModified : g_strMethods);
			RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);
			const Result = g_ChildProcess.spawnSync(strProgram, [], { encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
			g_Assert.equal(Result.error, undefined, Mutation.Name + ": " + Result.error?.message);
			g_Assert.equal(Result.status, 1, Mutation.Name + ": compiled regression accepted or execution failed.");
			g_Assert.match(Result.stderr, /CommandDispatcherContracts failed:/, Mutation.Name + ": native assertion required.");
			if (Mutation.Failure) {
				g_Assert.match(Result.stderr, Mutation.Failure, Mutation.Name);
			}

			++g_unRejectedMutationCount;
		}

		WriteFixture(g_strHelpers, g_strMethods);
		RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);
		g_Assert.match(RunCommand(strProgram, []).stdout, g_ContractReportPattern);
	}
} finally {
	const strRealTemporaryRoot = g_FileSystem.realpathSync(g_strTemporaryRoot);
	const strRelativeTemporaryRoot = g_Path.relative(g_strBuildRoot, strRealTemporaryRoot);
	g_Assert(!g_Path.isAbsolute(strRelativeTemporaryRoot) && !strRelativeTemporaryRoot.startsWith("..") && /^NativeCommandDispatcher-[^/\\]+$/.test(strRelativeTemporaryRoot), "Refuse cleanup outside the exact native fixture directory.");
	g_Assert(!g_FileSystem.lstatSync(g_strTemporaryRoot).isSymbolicLink());
	g_FileSystem.rmSync(strRealTemporaryRoot, { recursive: true, force: true });
}

console.log(`Command-dispatcher native checks PASS; profiles=${g_vecProfiles.length}; scenarios=${g_unRoutingScenarioCount} routing +${g_unHelperScenarioCount} helpers per profile; compiled regressions=${g_unRejectedMutationCount}; actual selected server-routing/selector/offset methods with manager/log/client-output doubles; client routing/page rendering/live engine/IO not exercised; temporary fixture cleaned.`);
