#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_unProcessTimeoutMilliseconds = 600000;
const g_unMutationTimeoutMilliseconds = 30000;
const g_unBuildParallelCount = 2;
const g_unUniqueGuardSplitPartCount = 2;

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_vecArguments = process.argv.slice(2);
if ((g_vecArguments.length !== 0) && ((g_vecArguments.length !== 2) || (g_vecArguments[0] !== "--source-file"))) {
	console.error("Usage: node tools/smoke_engine_edict_lookup.js [--source-file strPath]");
	process.exit(2);
}

const g_strSourcePath = (g_vecArguments.length === 2) ? g_Path.resolve(g_vecArguments[1]) : g_Path.join(g_strProjectRoot, "src/sourcejs/EngineInterfaces.cpp");
const g_strSource = g_FileSystem.readFileSync(g_strSourcePath, "utf8").replace(/\r\n/g, "\n");
const g_strStartMarker = "\t\ttemplate <typename EngineServerType, typename GlobalVariablesType>\n\t\tedict_t* FindSourceSDKEdictByIndex(";
const g_nStartIndex = g_strSource.indexOf(g_strStartMarker);
const g_nEndIndex = g_strSource.indexOf("\n\n\t} // namespace", g_nStartIndex);
g_Assert((g_nStartIndex >= 0) && (g_nEndIndex > g_nStartIndex), "Current native edict helper boundaries");

const g_strHelpers = g_strSource.slice(g_nStartIndex, g_nEndIndex);
const g_vecMutations = [
	{ Name: "MissingLookupBaseGuard", From: "\t\t\t\tif (!pGlobalVariables->pEdicts) {\n\t\t\t\t\treturn nullptr;\n\t\t\t\t}\n\n" },
	{ Name: "MissingIndexBaseGuard", From: "\t\t\t\tif (!pGlobalVariables->pEdicts) {\n\t\t\t\t\treturn -1;\n\t\t\t\t}\n\n" },
];
const g_vecProfiles = (process.platform === "win32") ? [
	{ Name: "Win32", Arguments: ["-G", "Visual Studio 17 2022", "-A", "Win32"] },
	{ Name: "X64", Arguments: ["-G", "Visual Studio 17 2022", "-A", "x64"] },
] : [
	{ Name: "X86", Arguments: ["-DCMAKE_CXX_FLAGS=-m32 -fsanitize=undefined -fno-sanitize-recover=all"] },
	{ Name: "X64", Arguments: ["-DCMAKE_CXX_FLAGS=-m64 -fsanitize=undefined -fno-sanitize-recover=all"] },
];

function RunCommand(strCommand, vecArguments) {
	const Result = g_ChildProcess.spawnSync(strCommand, vecArguments, { encoding: "utf8", windowsHide: true, timeout: g_unProcessTimeoutMilliseconds });
	g_Assert.equal(Result.status, 0, `${strCommand}: ${Result.error?.message ?? (Result.stdout + Result.stderr)}`);

	return Result;
}

function CreateFixture(strHelpers) {
	return `
// C++
#include <cstddef>

// STL
#include <array>
#include <iostream>

// These exact SDK type, member and method spellings model the two supported lookup contracts.
struct edict_t {
};

struct ArrayEngineServer {
};

struct NoArrayGlobalVariables {
};

struct ArrayGlobalVariables {
\tedict_t* pEdicts;
};

class LegacyEngineServer {
public:
\texplicit LegacyEngineServer(edict_t* const pEdicts);
\tedict_t* PEntityOfEntIndex(const int nIndex);
\tint IndexOfEdict(edict_t const* const pEdict);

private:
\tedict_t* m_pEdicts;
};

LegacyEngineServer::LegacyEngineServer(edict_t* const pEdicts) :
\tm_pEdicts(pEdicts)
{
}

edict_t* LegacyEngineServer::PEntityOfEntIndex(const int nIndex) {
\treturn m_pEdicts + nIndex;
}

int LegacyEngineServer::IndexOfEdict(edict_t const* const pEdict) {
\treturn static_cast<int>(pEdict - m_pEdicts);
}

namespace SourceJS {

\tnamespace {

\t\ttemplate <typename T>
\t\tconstexpr bool kSourceSDKEdictAPIMissing = false;

${strHelpers}

\t} // namespace

\tint CheckEdictLookups() {
\t\tconstexpr std::size_t kEdictCount = 4;
\t\tconstexpr int kSelectedIndex = 2;

\t\tstd::array<edict_t, kEdictCount> arrEdicts {};
\t\tArrayEngineServer ArrayEngine {};
\t\tArrayGlobalVariables Globals { arrEdicts.data() };
\t\tArrayGlobalVariables EmptyGlobals {};
\t\tNoArrayGlobalVariables NoArrayGlobals {};
\t\tLegacyEngineServer LegacyEngine(arrEdicts.data());

\t\tif ((FindSourceSDKEdictByIndex(&ArrayEngine, &Globals, 0) != arrEdicts.data()) || (FindSourceSDKEdictByIndex(&ArrayEngine, &Globals, kSelectedIndex) != &arrEdicts[kSelectedIndex]) || (GetSourceSDKEdictIndex(&ArrayEngine, &Globals, &arrEdicts[kSelectedIndex]) != kSelectedIndex)) {
\t\t\treturn 1;
\t\t}

\t\tif ((FindSourceSDKEdictByIndex(&ArrayEngine, &EmptyGlobals, 0) != nullptr) || (FindSourceSDKEdictByIndex(&ArrayEngine, &EmptyGlobals, kSelectedIndex) != nullptr) || (GetSourceSDKEdictIndex(&ArrayEngine, &EmptyGlobals, &arrEdicts[kSelectedIndex]) != -1)) {
\t\t\treturn 2;
\t\t}

\t\tif ((FindSourceSDKEdictByIndex(&LegacyEngine, &NoArrayGlobals, kSelectedIndex) != &arrEdicts[kSelectedIndex]) || (GetSourceSDKEdictIndex(&LegacyEngine, &NoArrayGlobals, &arrEdicts[kSelectedIndex]) != kSelectedIndex)) {
\t\t\treturn 3;
\t\t}

\t\tif ((FindSourceSDKEdictByIndex(&LegacyEngine, &EmptyGlobals, kSelectedIndex) != &arrEdicts[kSelectedIndex]) || (GetSourceSDKEdictIndex(&LegacyEngine, &EmptyGlobals, &arrEdicts[kSelectedIndex]) != kSelectedIndex)) {
\t\t\treturn 4;
\t\t}

\t\treturn 0;
\t}

} // namespace SourceJS

int main() {
\tconst int nResult = SourceJS::CheckEdictLookups();
\tif (nResult != 0) {
\t\tstd::cerr << "EdictLookup failed Result=" << nResult << "\\n";
\t\treturn nResult;
\t}

\tstd::cout << "EdictLookup PASS\\n";

\treturn 0;
}
`;
}

g_Assert(["win32", "linux"].includes(process.platform), "Native edict lookup tests require Windows or Linux.");
g_Assert(["ia32", "x64"].includes(process.arch), "Native edict lookup tests require x86/x64 compiler profiles.");

g_FileSystem.mkdirSync(g_Path.join(g_strProjectRoot, "build"), { recursive: true });
const g_strBuildRoot = g_FileSystem.realpathSync(g_Path.join(g_strProjectRoot, "build"));
const g_strTemporaryRoot = g_FileSystem.mkdtempSync(g_Path.join(g_strBuildRoot, "NativeEngineEdictLookup-"));
try {
	g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "CMakeLists.txt"), [
		"cmake_minimum_required(VERSION 3.20)",
		"project(EngineEdictLookupContracts LANGUAGES CXX)",
		"add_executable(EngineEdictLookupContracts Fixture.cpp)",
		"target_compile_features(EngineEdictLookupContracts PRIVATE cxx_std_20)",
		"if(MSVC)",
		"\ttarget_compile_options(EngineEdictLookupContracts PRIVATE /W4 /WX)",
		"else()",
		"\ttarget_compile_options(EngineEdictLookupContracts PRIVATE -Wall -Wextra -Werror)",
		"endif()",
		"",
	].join("\n"));

	for (const Profile of g_vecProfiles) {
		const strBinaryRoot = g_Path.join(g_strTemporaryRoot, Profile.Name);
		g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "Fixture.cpp"), CreateFixture(g_strHelpers));
		RunCommand("cmake", ["-S", g_strTemporaryRoot, "-B", strBinaryRoot, ...Profile.Arguments]);
		RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", String(g_unBuildParallelCount)]);

		const strProgram = (process.platform === "win32") ? g_Path.join(strBinaryRoot, "Release/EngineEdictLookupContracts.exe") : g_Path.join(strBinaryRoot, "EngineEdictLookupContracts");
		g_Assert.match(RunCommand(strProgram, []).stdout, /EdictLookup PASS/);

		for (const Mutation of g_vecMutations) {
			g_Assert.equal(g_strHelpers.split(Mutation.From).length, g_unUniqueGuardSplitPartCount, `Unique production guard: ${Mutation.Name}`);
			g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "Fixture.cpp"), CreateFixture(g_strHelpers.replace(Mutation.From, "")));
			RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", String(g_unBuildParallelCount)]);

			const Result = g_ChildProcess.spawnSync(strProgram, [], { encoding: "utf8", windowsHide: true, timeout: g_unMutationTimeoutMilliseconds });
			g_Assert(!Result.error && (Result.status !== 0), `${Profile.Name}: reject ${Mutation.Name}`);
		}

		console.log(`${Profile.Name}: actual edict helper bodies passed with array/legacy SDK doubles; rejected two compiled null-base regressions.`);
	}
} finally {
	const strResolvedTemporaryRoot = g_FileSystem.realpathSync(g_strTemporaryRoot);
	const strRelativeTemporaryRoot = g_Path.relative(g_strBuildRoot, strResolvedTemporaryRoot);
	g_Assert(!g_Path.isAbsolute(strRelativeTemporaryRoot) && !strRelativeTemporaryRoot.startsWith("..") && /^NativeEngineEdictLookup-[^/\\]+$/.test(strRelativeTemporaryRoot), "Temporary cleanup stays in the exact native edict fixture directory");
	g_Assert(!g_FileSystem.lstatSync(g_strTemporaryRoot).isSymbolicLink(), "Temporary fixture directory is not a symbolic link");
	g_FileSystem.rmSync(strResolvedTemporaryRoot, { recursive: true, force: true });
}

console.log("Engine edict lookup native contracts passed; no live SDK/V8/game-server execution.");
