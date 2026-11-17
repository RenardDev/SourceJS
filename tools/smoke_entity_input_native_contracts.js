#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_unProcessTimeoutMilliseconds = 240000;
const g_unMaximumOutputBytes = 16 * 1024 * 1024;
const g_unMaximumParallelBuildJobs = 2;
const g_vecArguments = process.argv.slice(2);
if ((g_vecArguments.length > 1) || ((g_vecArguments.length === 1) && (g_vecArguments[0] !== "--debug"))) {
	console.error("Usage: node tools/smoke_entity_input_native_contracts.js [--debug]");
	process.exit(2);
}

g_Assert(["win32", "linux"].includes(process.platform), "Requires Windows/Linux x86/x64 compilers.");
const g_strConfiguration = (g_vecArguments.length === 1) ? "Debug" : "Release";
const g_strRoot = g_Path.resolve(__dirname, "..");
const g_strSource = g_FileSystem.readFileSync(g_Path.join(g_strRoot, "src/sourcejs/modules/ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_strTemplate = g_FileSystem.readFileSync(g_Path.join(__dirname, "fixtures/EntityInputContracts.cpp"), "utf8");

function Extract(strStart, strEnd) {
	g_Assert.equal(g_strSource.split(strStart).length, 2, "Unique helper start required.");
	const nStart = g_strSource.indexOf(strStart);
	const nEnd = g_strSource.indexOf(strEnd, nStart + strStart.length);
	g_Assert(nEnd > nStart, "Bounded helper end required.");

	return g_strSource.slice(nStart, nEnd).replace(/^\t/gm, "");
}

function ExtractDefinition(strStart, unDeclarationIndent) {
	const strClosingLine = "\t".repeat(unDeclarationIndent) + "}";
	const strDefinition = Extract(strStart, "\n" + strClosingLine + "\n") + "\n" + "\t".repeat(unDeclarationIndent - 1) + "}";

	return (unDeclarationIndent === 1) ? strDefinition.replace(/^(?=.)/gm, "\t") : strDefinition;
}

const g_strDelayedRecord = Extract("\tstruct DelayedEntityInput {", "\n\tstruct EntityConstantGroupEntry {").replace(/^(?=.)/gm, "\t");
const g_strQueueHelpers = g_strDelayedRecord + "\n\t// Empty fixture registry has no dependency on another global.\n\tstd::vector<DelayedEntityInput> g_vecDelayedEntityInputs {};\n\n" + ExtractDefinition("\t\tbool ScheduleEntityInput(", 2) + "\n\n" + ExtractDefinition("\tvoid ClearDelayedEntityInputs()", 1) + "\n\n" + ExtractDefinition("\tvoid ProcessDelayedEntityInputs()", 1);
const g_strHandleHelpers = ExtractDefinition("\t\tbool GetEntityBaseHandleFromEdictAddress(", 2) + "\n\n" + Extract("\t\tbool GetEntityIndexFromBaseHandleValue(", "\n\t\tbool GetEntityBaseHandleFromValue(");
const g_strHelpers = Extract("\t\t// Borrowed world-name storage remains live", "\n#endif") + "\n\n" + g_strHandleHelpers + "\n\n" + g_strQueueHelpers;
const g_strMarker = "\t\t// SOURCEJS_ENTITY_INPUT_HELPERS";
g_Assert.equal(g_strTemplate.split(g_strMarker).length, 2);

function MakeFixtureSource(strHelpers, bMutation) {
	let strProgram = g_strTemplate.replace(g_strMarker, () => strHelpers.replace(/^\t/gm, "\t\t"));
	if ((process.platform === "win32") && bMutation) {
		g_Assert.equal(strProgram.split("int main() {").length, 2);
		// Actual MSVC C4702: an expected mutant exception makes main's success output unreachable.
		// Only the generated negative-control main is affected, never helpers or positive builds.
		strProgram = strProgram.replace("int main() {", "#pragma warning(push)\n#pragma warning(disable: 4702)\nint main() {");
		strProgram += "\n#pragma warning(pop)\n";
	}

	return strProgram;
}

function Run(strCommand, vecArguments) {
	const Result = g_ChildProcess.spawnSync(strCommand, vecArguments, { encoding: "utf8", windowsHide: true, timeout: g_unProcessTimeoutMilliseconds, maxBuffer: g_unMaximumOutputBytes });
	g_Assert(!Result.error, Result.error?.message);
	g_Assert.equal(Result.signal, null, "Unexpected process signal: " + Result.signal);

	return Result;
}

function RequireSuccess(strCommand, vecArguments) {
	const Result = Run(strCommand, vecArguments);
	g_Assert.equal(Result.status, 0, Result.stdout + Result.stderr);
	g_Assert(!/\bwarning(?: C\d+| LNK\d+|:)/i.test(Result.stdout + Result.stderr), "New native fixture warning.");

	return Result;
}

const g_vecProfiles = (process.platform === "win32") ? [
	{ Name: "Win32", Arguments: ["-G", "Visual Studio 17 2022", "-A", "Win32"] },
	{ Name: "X64", Arguments: ["-G", "Visual Studio 17 2022", "-A", "x64"] },
] : [
	{ Name: "X86", Arguments: ["-DCMAKE_CXX_FLAGS=-m32 -fsanitize=undefined -fno-sanitize-recover=all"] },
	{ Name: "X64", Arguments: ["-DCMAKE_CXX_FLAGS=-m64 -fsanitize=undefined -fno-sanitize-recover=all"] },
];

const g_strRestore = "std::memcpy(m_pNameStorage, m_arrOriginalName.data(), m_arrOriginalName.size());";
const g_vecMutations = [
	{ Name: "Capture", Old: "std::memcpy(m_arrOriginalName.data(), m_pNameStorage, m_arrOriginalName.size());", New: g_strRestore },
	{ Name: "Restore", Old: g_strRestore, New: "std::memcpy(m_arrOriginalName.data(), m_pNameStorage, m_arrOriginalName.size());" },
	{ Name: "ExceptionRestore", Old: g_strRestore, New: "if (std::uncaught_exceptions() == 0) {\n\t\t\t" + g_strRestore + "\n\t\t}" },
	{ Name: "ZeroHandle", Old: "bool GetEntityIndexFromBaseHandleValue(CBaseHandle const& EntityHandle, int& nEntityIndexOut) {\n\t\tif (!EntityHandle.IsValid()) {", New: "bool GetEntityIndexFromBaseHandleValue(CBaseHandle const& EntityHandle, int& nEntityIndexOut) {\n\t\tif (!EntityHandle.IsValid() || !EntityHandle.ToInt()) {" },
	{ Name: "SerialIdentity", Old: "(LiveHandle.ToInt() != EntityHandle.ToInt())", New: "false" },
	{ Name: "DelayedPumpBoundary", Old: "g_vecDelayedEntityInputs[unDelayedInputIndex].m_unSequence > unLastPendingInputSequence", New: "g_vecDelayedEntityInputs[unDelayedInputIndex].m_unSequence < unLastPendingInputSequence" },
	{ Name: "DelayedSequenceLimit", Old: "g_unLastDelayedInputSequence == std::numeric_limits<std::uint64_t>::max()", New: "g_unLastDelayedInputSequence != std::numeric_limits<std::uint64_t>::max()" },
	{ Name: "ZeroDelayPayload", Old: "if (flDelay <= 0.0f) {\n\t\t\treturn CallEntityInputNow(nEntityIndex, strInputName, InputValue);", New: "if (flDelay <= 0.0f) {\n\t\t\treturn CallEntityInputNow(nEntityIndex, strInputName, variant_t {});", Failure: /Immediate fallback changed payloads or queued work/ },
	{ Name: "MissingGlobalsPayload", Old: "if (!pGlobalVariables) {\n\t\t\treturn CallEntityInputNow(nEntityIndex, strInputName, InputValue);", New: "if (!pGlobalVariables) {\n\t\t\treturn CallEntityInputNow(nEntityIndex, strInputName, variant_t {});", Failure: /Immediate fallback changed payloads or queued work/ },
	{ Name: "DelayedClearSequence", Old: "g_vecDelayedEntityInputs.clear();", New: "g_vecDelayedEntityInputs.clear();\n\t\tg_unLastDelayedInputSequence = 0;" },
];

let g_unRejectedMutations = 0;
const g_strBuildRoot = g_FileSystem.realpathSync(g_Path.join(g_strRoot, "build"));
const g_strDirectory = g_FileSystem.mkdtempSync(g_Path.join(g_strBuildRoot, "NativeEntityInput-"));
try {
	const strProgramPath = g_Path.join(g_strDirectory, "EntityInputContracts.cpp");
	g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, "CMakeLists.txt"), `cmake_minimum_required(VERSION 3.20)
project(EntityInputContracts LANGUAGES CXX)
add_executable(EntityInputContracts EntityInputContracts.cpp)
target_compile_features(EntityInputContracts PRIVATE cxx_std_20)
if(MSVC)
	target_compile_options(EntityInputContracts PRIVATE /W4 /WX /EHsc /permissive- /Zc:__cplusplus)
else()
	target_compile_options(EntityInputContracts PRIVATE -Wall -Wextra -Wpedantic -Werror)
endif()
`);

	for (const Profile of g_vecProfiles) {
		const strBinaryRoot = g_Path.join(g_strDirectory, Profile.Name);
		g_FileSystem.writeFileSync(strProgramPath, MakeFixtureSource(g_strHelpers, false));
		const vecConfiguration = (process.platform === "linux") ? ["-DCMAKE_BUILD_TYPE=" + g_strConfiguration] : [];
		RequireSuccess("cmake", ["-S", g_strDirectory, "-B", strBinaryRoot, ...vecConfiguration, ...Profile.Arguments]);

		const strExecutable = g_Path.join(strBinaryRoot, (process.platform === "win32") ? (g_strConfiguration + "/EntityInputContracts.exe") : "EntityInputContracts");
		const vecCases = [{ Name: "Current", Source: g_strHelpers }, ...g_vecMutations.map(Mutation => {
			g_Assert.equal(g_strHelpers.split(Mutation.Old).length, 2, "Unique mutation target: " + Mutation.Name);

			return { Name: Mutation.Name, Source: g_strHelpers.replace(Mutation.Old, () => Mutation.New), Failure: Mutation.Failure };
		})];
		for (const Case of vecCases) {
			g_FileSystem.writeFileSync(strProgramPath, MakeFixtureSource(Case.Source, Case.Name !== "Current"));
			RequireSuccess("cmake", ["--build", strBinaryRoot, "--config", g_strConfiguration, "--parallel", String(g_unMaximumParallelBuildJobs)]);

			const Result = Run(strExecutable, []);
			g_Assert.equal(Result.status, (Case.Name === "Current") ? 0 : 1, Case.Name + ": compiled runtime assertion required.\n" + Result.stdout + Result.stderr);

			if (Case.Name === "Current") {
				g_Assert.match(Result.stdout, /^EntityInputContracts PASS:/);

			} else {
				g_Assert.match(Result.stderr, /^EntityInputContracts failed:/);
				if (Case.Failure) {
					g_Assert.match(Result.stderr, Case.Failure, Case.Name);
				}

				++g_unRejectedMutations;
			}
		}
	}
} finally {
	const strResolved = g_FileSystem.realpathSync(g_strDirectory);
	g_Assert.equal(g_Path.dirname(strResolved), g_strBuildRoot, "Cleanup stays within the actual build root.");
	g_Assert(g_Path.basename(strResolved).startsWith("NativeEntityInput-"), "Cleanup stays within the exact fixture family.");
	g_Assert(!g_FileSystem.lstatSync(g_strDirectory).isSymbolicLink());
	g_FileSystem.rmSync(strResolved, { recursive: true, force: true });
}

console.log("Entity input native checks PASS: x86/x64 " + g_strConfiguration + ", compiled mutations rejected=" + g_unRejectedMutations + "; actual rollback/handle/delayed-queue helpers, SDK/clock/world adapters, no V8/engine/ABI claim.");
