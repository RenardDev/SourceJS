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
	console.error("Usage: node tools/smoke_team_data_loading_native.js [--debug]");
	process.exit(2);
}

g_Assert(["win32", "linux"].includes(process.platform), "Requires Windows/Linux x86/x64 compilers.");
const g_strConfiguration = (g_vecArguments.length === 1) ? "Debug" : "Release";
const g_strRoot = g_Path.resolve(__dirname, "..");
const g_strSource = g_FileSystem.readFileSync(g_Path.join(g_strRoot, "src/sourcejs/modules/ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_strTemplate = g_FileSystem.readFileSync(g_Path.join(__dirname, "fixtures/TeamDataLoading.cpp"), "utf8");
const g_strStart = "\t\tstruct PlayerTeamData {";
const g_strEnd = "\n\t\tbool LoadPlayerTeamDataFromRuntime(";
g_Assert.equal(g_strSource.split(g_strStart).length, 2);
g_Assert.equal(g_strSource.split(g_strEnd).length, 2);
const g_nStart = g_strSource.indexOf(g_strStart);
const g_nEnd = g_strSource.indexOf(g_strEnd, g_nStart);
g_Assert(g_nEnd > g_nStart);
const g_strHelpers = g_strSource.slice(g_nStart, g_nEnd).replace(/^\t/gm, "");
const g_strMarker = "\t// SOURCEJS_TEAM_LOADING_HELPERS";
g_Assert.equal(g_strTemplate.split(g_strMarker).length, 2);

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
const g_vecMutations = [
	{ Name: "EarlyReset", Old: "PlayerTeamData TeamData {};", New: "TeamDataOut = PlayerTeamData {};\n\t\tPlayerTeamData TeamData {};" },
	{ Name: "ProfileLeak", Old: "TeamData.m_strProfileName = GetTeamProfileName();", New: "TeamDataOut.m_strProfileName = GetTeamProfileName();" },
	{ Name: "PartialParseLeak", Old: "LoadPlayerTeamFile(PathProfileFile, TeamData)", New: "LoadPlayerTeamFile(PathProfileFile, TeamDataOut)" },
	{ Name: "IncompleteCommit", Old: "TeamDataOut = std::move(TeamData);", New: "TeamDataOut.m_strProfileName = TeamData.m_strProfileName;" },
	{ Name: "CanonicalAliasMap", Old: "TeamData.m_mapTeamNumbersByName[strPublicName] = nTeamIndex;", New: "TeamData.m_mapTeamNumbersByName[(strName == \"RedTeam\") ? \"WrongCanonicalTeam\" : strPublicName] = nTeamIndex;" },
	{ Name: "CanonicalAcronym", Old: "TeamData.m_mapTeamNumbersByName[strPublicName] = nTeamIndex;", New: "TeamData.m_mapTeamNumbersByName[(strName == \"CT\") ? \"Ct\" : strPublicName] = nTeamIndex;" },
	{ Name: "CanonicalClassAcronym", Old: "TeamData.m_mapClassNumbersByName[strPublicName] = nClassIndex;", New: "TeamData.m_mapClassNumbersByName[(strName == \"SEALTeam6\") ? \"SealTeam6\" : strPublicName] = nClassIndex;" },
];

const g_strBuildRoot = g_FileSystem.realpathSync(g_Path.join(g_strRoot, "build"));
let g_unRejectedMutations = 0;
const g_strDirectory = g_FileSystem.mkdtempSync(g_Path.join(g_strBuildRoot, "NativeTeamLoading-"));
try {
	const strProgramPath = g_Path.join(g_strDirectory, "TeamDataLoading.cpp");

	g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, "CMakeLists.txt"), `cmake_minimum_required(VERSION 3.20)
project(TeamDataLoading LANGUAGES CXX)
add_executable(TeamDataLoading TeamDataLoading.cpp)
target_compile_features(TeamDataLoading PRIVATE cxx_std_20)
if(MSVC)
	target_compile_options(TeamDataLoading PRIVATE /W4 /WX /EHsc /permissive- /Zc:__cplusplus)
else()
	target_compile_options(TeamDataLoading PRIVATE -Wall -Wextra -Wpedantic -Werror)
endif()
`);

	for (const Profile of g_vecProfiles) {
		const strBinaryRoot = g_Path.join(g_strDirectory, Profile.Name);
		g_FileSystem.writeFileSync(strProgramPath, g_strTemplate.replace(g_strMarker, () => g_strHelpers));
		const vecConfiguration = (process.platform === "linux") ? ["-DCMAKE_BUILD_TYPE=" + g_strConfiguration] : [];
		RequireSuccess("cmake", ["-S", g_strDirectory, "-B", strBinaryRoot, ...vecConfiguration, ...Profile.Arguments]);

		const strExecutable = g_Path.join(strBinaryRoot, (process.platform === "win32") ? (g_strConfiguration + "/TeamDataLoading.exe") : "TeamDataLoading");
		const vecCases = [{ Name: "Current", Source: g_strHelpers }, ...g_vecMutations.map(Mutation => {
			g_Assert.equal(g_strHelpers.split(Mutation.Old).length, 2, "Unique mutation target: " + Mutation.Name);

			return { Name: Mutation.Name, Source: g_strHelpers.replace(Mutation.Old, () => Mutation.New) };
		})];
		for (const Case of vecCases) {
			g_FileSystem.writeFileSync(strProgramPath, g_strTemplate.replace(g_strMarker, () => Case.Source));
			RequireSuccess("cmake", ["--build", strBinaryRoot, "--config", g_strConfiguration, "--parallel", String(g_unMaximumParallelBuildJobs)]);

			const strProfileRoot = g_FileSystem.mkdtempSync(g_Path.join(g_strDirectory, Profile.Name + "-" + Case.Name + "-"));
			const Result = Run(strExecutable, [strProfileRoot]);
			g_Assert.equal(Result.status, (Case.Name === "Current") ? 0 : 1, Case.Name + ": compiled runtime assertion required.\n" + Result.stdout + Result.stderr);

			if (Case.Name === "Current") {
				g_Assert.match(Result.stdout, /^TeamDataLoading PASS:/);

			} else {
				g_Assert.match(Result.stderr, /^TeamDataLoading failed:/);
				++g_unRejectedMutations;
			}
		}
	}
} finally {
	const strResolved = g_FileSystem.realpathSync(g_strDirectory);
	g_Assert.equal(g_Path.dirname(strResolved), g_strBuildRoot, "Cleanup stays within the actual build root.");
	g_Assert(g_Path.basename(strResolved).startsWith("NativeTeamLoading-"), "Cleanup stays within the exact fixture family.");
	g_Assert(!g_FileSystem.lstatSync(g_strDirectory).isSymbolicLink());
	g_FileSystem.rmSync(strResolved, { recursive: true, force: true });
}

console.log("Team data loading native checks PASS: x86/x64 " + g_strConfiguration + ", compiled mutations rejected=" + g_unRejectedMutations + "; actual parsers/files/transactional output, runtime path getter adapted, no V8/server claim.");
