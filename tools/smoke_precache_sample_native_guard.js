"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

function ShowUsage(unOutputDescriptor) {
	const strScriptPath = g_Path.relative(process.cwd(), __filename) || g_Path.basename(__filename);
	g_FileSystem.writeSync(unOutputDescriptor, `Usage: node "${strScriptPath}" [-h | --help]\n`);
	g_FileSystem.writeSync(unOutputDescriptor, "Compile and run the native precache sample guard and mutation checks for both host architectures.\n");
}

if (process.argv.length > 2) {
	const vecArguments = process.argv.slice(2);
	if ((vecArguments.length === 1) && ((vecArguments[0] === "-h") || (vecArguments[0] === "--help"))) {
		ShowUsage(process.stdout.fd);
		process.exit(0);
	}

	g_FileSystem.writeSync(process.stderr.fd, "[ERROR] Unsupported native precache guard test arguments.\n");
	ShowUsage(process.stderr.fd);
	process.exit(2);
}

const g_unBuildTimeoutMilliseconds = 600000;
const g_unProgramTimeoutMilliseconds = 60000;
const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strBuildRoot = g_Path.join(g_strProjectRoot, "build");
const g_strNativeSource = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src/sourcejs/modules/ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_nCallbackStart = g_strNativeSource.indexOf("\tvoid PrecacheSoundCallback(");
const g_nCallbackEnd = g_strNativeSource.indexOf("\tvoid IsSoundPrecachedCallback(", g_nCallbackStart);
g_Assert.ok((g_nCallbackStart >= 0) && (g_nCallbackEnd > g_nCallbackStart), "Native sound callback boundaries must exist.");

const g_strCallback = g_strNativeSource.slice(g_nCallbackStart, g_nCallbackEnd);
const g_vecGuardMatches = Array.from(g_strCallback.matchAll(/if \(([^\n]+)\) \{\n\s*ThrowError\(pIsolate, kEmptySampleErrorMessage\);/g));
g_Assert.equal(g_vecGuardMatches.length, 1, "Extract exactly one native empty-sample condition.");

const g_vecConditions = [
	{ Name: "Current", Expression: g_vecGuardMatches[0][1], ExpectedStatus: 0 },
	{ Name: "OldEmptyOnly", Expression: "strSample.empty()", ExpectedStatus: 1 },
	{ Name: "RejectEmbeddedNUL", Expression: "strSample.empty() || (strSample.find('\\0') != std::string::npos)", ExpectedStatus: 1 },
	{ Name: "RejectAll", Expression: "strSample.empty() || !strSample.empty()", ExpectedStatus: 1 },
];
const g_vecProfiles = (process.platform === "win32") ? [
	{ Name: "Win32", Arguments: ["-G", "Visual Studio 17 2022", "-A", "Win32"] },
	{ Name: "X64", Arguments: ["-G", "Visual Studio 17 2022", "-A", "x64"] },
] : [
	{ Name: "X86", Arguments: ["-DCMAKE_CXX_FLAGS=-m32"] },
	{ Name: "X64", Arguments: ["-DCMAKE_CXX_FLAGS=-m64"] },
];

function RunCommand(strCommand, vecArguments) {
	const Result = g_ChildProcess.spawnSync(strCommand, vecArguments, { encoding: "utf8", windowsHide: true, timeout: g_unBuildTimeoutMilliseconds });
	g_Assert.equal(Result.status, 0, strCommand + ": " + (Result.error?.message ?? (Result.stdout + Result.stderr)));

	return Result;
}

function CreateSource(strCondition) {
	return [
		"",
		"// C++",
		"#include <cstddef>",
		"#include <cstdio>",
		"",
		"// STL",
		"#include <string>",
		"",
		"namespace {",
		"\tstruct SampleCase {",
		"\t\tstd::string m_strSample;",
		"\t\tbool m_bReject;",
		"\t};",
		"",
		"\tbool RejectSample(std::string const& strSample) {",
		"\t\tif (" + strCondition + ") {",
		"\t\t\treturn true;",
		"\t\t}",
		"",
		"\t\treturn false;",
		"\t}",
		"} // namespace",
		"",
		"int main() {",
		"\tSampleCase const arrCases[] {",
		"\t\t{ {}, true },",
		"\t\t{ std::string(\"\\0suffix\", 7), true },",
		"\t\t{ std::string(\"\\0\", 1), true },",
		"\t\t{ \"ui/buttonclick.wav\", false },",
		"\t\t{ std::string(\"sample\\0suffix\", 13), false },",
		"\t\t{ std::string(\"x\\0\", 2), false },",
		"\t\t{ \"sourcejs/round_ready.wav\", false },",
		"\t};",
		"",
		"\tstd::size_t unFailures = 0;",
		"\tfor (auto const& Case : arrCases) {",
		"\t\tif (RejectSample(Case.m_strSample) != Case.m_bReject) {",
		"\t\t\t++unFailures;",
		"\t\t}",
		"\t}",
		"",
		"\tstd::printf(\"PrecacheSampleGuard Cases=%zu Failures=%zu\\n\", sizeof(arrCases) / sizeof(arrCases[0]), unFailures);",
		"",
		"\treturn (unFailures == 0) ? 0 : 1;",
		"}",
		"",
	].join("\n");
}

g_FileSystem.mkdirSync(g_strBuildRoot, { recursive: true });
const g_strFixtureDirectory = g_FileSystem.mkdtempSync(g_Path.join(g_strBuildRoot, "precache-sample-check-"));
try {
	const vecCMakeLines = [
		"cmake_minimum_required(VERSION 3.20)",
		"project(PrecacheSampleGuard LANGUAGES CXX)",
	];
	for (const Condition of g_vecConditions) {
		g_FileSystem.writeFileSync(g_Path.join(g_strFixtureDirectory, Condition.Name + ".cpp"), CreateSource(Condition.Expression));
		vecCMakeLines.push("add_executable(" + Condition.Name + " " + Condition.Name + ".cpp)");
		vecCMakeLines.push("target_compile_features(" + Condition.Name + " PRIVATE cxx_std_20)");
		vecCMakeLines.push("if(MSVC)");
		vecCMakeLines.push("\ttarget_compile_options(" + Condition.Name + " PRIVATE /W4 /WX)");
		vecCMakeLines.push("else()");
		vecCMakeLines.push("\ttarget_compile_options(" + Condition.Name + " PRIVATE -Wall -Wextra -Werror -pedantic)");
		vecCMakeLines.push("endif()");
	}

	g_FileSystem.writeFileSync(g_Path.join(g_strFixtureDirectory, "CMakeLists.txt"), vecCMakeLines.join("\n") + "\n");

	for (const Profile of g_vecProfiles) {
		const strBuildDirectory = g_Path.join(g_strFixtureDirectory, Profile.Name);
		RunCommand("cmake", ["-S", g_strFixtureDirectory, "-B", strBuildDirectory, ...Profile.Arguments]);

		RunCommand("cmake", ["--build", strBuildDirectory, "--config", "Release", "--parallel", "2"]);

		for (const Condition of g_vecConditions) {
			const strProgram = (process.platform === "win32") ? g_Path.join(strBuildDirectory, "Release", Condition.Name + ".exe") : g_Path.join(strBuildDirectory, Condition.Name);
			const Result = g_ChildProcess.spawnSync(strProgram, [], { encoding: "utf8", windowsHide: true, timeout: g_unProgramTimeoutMilliseconds });
			g_Assert.equal(Result.status, Condition.ExpectedStatus, Condition.Name + ": " + (Result.error?.message ?? (Result.stdout + Result.stderr)));
			g_Assert.match(Result.stdout, /PrecacheSampleGuard Cases=7 Failures=\d+/);

			if (Condition.Name === "Current") {
				g_Assert.match(Result.stdout, /Failures=0\b/);
			}
		}

		console.log("[precache_sample_native_guard] " + Profile.Name + " passed: actual C++ condition, seven cases and three compiled mutation rejections; V8/engine execution not exercised.");
	}
} finally {
	const strResolvedFixture = g_Path.resolve(g_strFixtureDirectory);
	g_Assert.ok(strResolvedFixture.startsWith(g_Path.resolve(g_strBuildRoot) + g_Path.sep));
	g_Assert.ok(g_Path.basename(strResolvedFixture).startsWith("precache-sample-check-"));
	g_FileSystem.rmSync(strResolvedFixture, { recursive: true, force: true });
}

console.log("[precache_sample_native_guard] generated test fixtures removed.");
