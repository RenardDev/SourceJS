"use strict";

// Compiles actual production argument classification with compiler/ABI-specific
// expectations. This is not an installed hook or a native-callee/engine probe.
const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_strUsageMessage = "Usage: node tools/smoke_memory_hook_argument_locations.js [--profile X86|X64] [--source-file <CPP>] [--help]";
const g_vecArguments = process.argv.slice(2);
if ((g_vecArguments.length === 1) && (g_vecArguments[0] === "--help")) {
	console.log(g_strUsageMessage);
	process.exit(0);
}

const g_mapOptions = new Map();
for (let unIndex = 0; unIndex < g_vecArguments.length; unIndex += 2) {
	const strOption = g_vecArguments[unIndex];
	const strValue = g_vecArguments[unIndex + 1];
	if (!["--profile", "--source-file"].includes(strOption) || !strValue || strValue.startsWith("--") || g_mapOptions.has(strOption) || ((strOption === "--profile") && !["X86", "X64"].includes(strValue))) {
		console.error(g_strUsageMessage);
		process.exit(2);
	}

	g_mapOptions.set(strOption, strValue);
}

g_Assert(["win32", "linux"].includes(process.platform), "Windows/Linux fixture host required");
g_Assert(["ia32", "x64"].includes(process.arch), "x86/x64 fixture host required");

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_unCommandTimeoutMilliseconds = 240_000;
const g_unOutputByteLimit = 16 * 1024 * 1024;
const g_strSource = g_FileSystem.readFileSync(g_Path.resolve(g_strProjectRoot, g_mapOptions.get("--source-file") ?? "src/sourcejs/MemoryHookManager.cpp"), "utf8").replace(/\r/g, "");
const g_strHeader = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src/sourcejs/MemoryHookManager.h"), "utf8").replace(/\r/g, "");

function Rebase(strSource) {
	const vecIndentationMatch = strSource.match(/^\t+/);
	g_Assert(vecIndentationMatch, "Indented production declaration");

	return strSource.replace(new RegExp("^\\t{" + (vecIndentationMatch[0].length - 1) + "}", "gm"), "");
}

function GetDefinition(strName) {
	const vecDefinitionMatch = g_strSource.match(new RegExp("^(\\t+)(?=[^\\t\\n]).*\\b" + strName + "\\([^\\n]*\\)(?: noexcept)? \\{", "m"));
	g_Assert(vecDefinitionMatch, "Actual production definition: " + strName);

	const strEndBoundary = "\n" + vecDefinitionMatch[1] + "}";
	const nEndIndex = g_strSource.indexOf(strEndBoundary, vecDefinitionMatch.index);
	g_Assert(nEndIndex > vecDefinitionMatch.index, "Complete definition: " + strName);

	return Rebase(g_strSource.slice(vecDefinitionMatch.index, nEndIndex + strEndBoundary.length));
}

function GetRecord(strSource, strPattern) {
	const vecRecordMatch = strSource.match(new RegExp("^\\t+" + strPattern + " \\{[\\s\\S]*?^\\t+\\}[^\\n]*;", "m"));
	g_Assert(vecRecordMatch, "Actual production record: " + strPattern);

	return Rebase(vecRecordMatch[0]);
}

function ReplaceOnce(strSource, strOld, strNew) {
	g_Assert.equal(strSource.split(strOld).length, 2, "Unique compiled mutation: " + strOld);

	return strSource.replace(strOld, () => strNew);
}

function Run(strCommand, vecArguments) {
	const Result = g_ChildProcess.spawnSync(strCommand, vecArguments, { cwd: g_strProjectRoot, encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds, maxBuffer: g_unOutputByteLimit });
	g_Assert(!Result.error, Result.error?.message);
	g_Assert.equal(Result.signal, null, "Fixture must not crash");

	return Result;
}

function Build(vecArguments) {
	const Result = Run("cmake", vecArguments);
	g_Assert.equal(Result.status, 0, Result.stdout + Result.stderr);
	g_Assert(!/\bwarning(?: C\d+| LNK\d+|:)/i.test(Result.stdout + Result.stderr), "No fixture warnings: " + Result.stdout + Result.stderr);
}

function VerifyFixtureCLI(strProgram) {
	const Result = Run(strProgram, ["UnexpectedArgument"]);
	g_Assert.equal(Result.status, 2);
	g_Assert.equal(Result.stdout, "");
	g_Assert.equal(Result.stderr.replace(/\r\n/g, "\n"), "Usage: MemoryHookArgumentLocations\n");
}

const g_strFixtureTemplate = g_FileSystem.readFileSync(g_Path.join(__dirname, "fixtures/MemoryHookArgumentLocations.cpp"), "utf8");
for (const strPlaceholder of ["@DATA_TYPE@", "@SIGNATURE@", "@CONSTRUCTOR@", "@LOCATION_RECORDS@", "@RESOLVER@"]) {
	g_Assert.equal(g_strFixtureTemplate.split(strPlaceholder).length, 2, "Unique fixture placeholder: " + strPlaceholder);
}

const g_strFixture = g_strFixtureTemplate
	.replace("@DATA_TYPE@", () => "\t// Generated only: native memory-hook argument-location regression executable.\n" + GetRecord(g_strHeader, "typedef enum _DATA_TYPE : int"))
	.replace("@SIGNATURE@", () => GetRecord(g_strHeader, "struct MemoryHookSignature"))
	.replace("@CONSTRUCTOR@", () => GetDefinition("MemoryHookSignature::MemoryHookSignature"))
	.replace("@LOCATION_RECORDS@", () => GetRecord(g_strSource, "enum class NativeArgumentLocationKind") + "\n\n" + GetRecord(g_strSource, "struct NativeArgumentLocation"))
	.replace("@RESOLVER@", () => GetDefinition("ResolveNativeArgumentLocation"));
g_Assert(!/@[A-Z_]+@/.test(g_strFixture), "All production insertion points resolved");
const g_vecProfiles = ["X86", "X64"].filter(strProfile => !g_mapOptions.has("--profile") || (strProfile === g_mapOptions.get("--profile")));

g_FileSystem.mkdirSync(g_Path.join(g_strProjectRoot, "build"), { recursive: true });
const g_strBuildRoot = g_FileSystem.realpathSync(g_Path.join(g_strProjectRoot, "build"));
const g_strTemporaryRoot = g_FileSystem.mkdtempSync(g_Path.join(g_strBuildRoot, "NativeMemoryHookArgumentLocations-"));

try {
	for (const strProfile of g_vecProfiles) {
		const vecCases = [{ Name: "Current", Source: g_strFixture, Status: 0 }];
		if (!g_mapOptions.has("--source-file")) {
			vecCases.push({ Name: "FirstArgument", Source: ReplaceOnce(g_strFixture, "nArgumentIndex < 0", "nArgumentIndex < 1"), Status: 1 });
			vecCases.push({ Name: "UnusedStackOffset", Source: ReplaceOnce(g_strFixture, "const std::size_t unArgumentIndex = static_cast<std::size_t>(nArgumentIndex);", "const std::size_t unArgumentIndex = static_cast<std::size_t>(nArgumentIndex);\n\t\t\tLocation.m_unStackOffset = 1;"), Status: 1 });

			if (strProfile === "X86") {
				vecCases.push({ Name: "FloatRegister", Source: ReplaceOnce(g_strFixture, "bFastcall && !bCurrentArgumentIsFloating &&", "bFastcall && bCurrentArgumentIsFloating &&"), Status: 1 });
				vecCases.push({ Name: "WideSize", Source: ReplaceOnce(g_strFixture, "(CurrentArgumentType == DATA_TYPE_DOUBLE) || bCurrentArgumentIsWideInteger;", "(CurrentArgumentType == DATA_TYPE_DOUBLE) || (bCurrentArgumentIsWideInteger && (CurrentArgumentType == DATA_TYPE_ULONG_LONG));"), Status: 1 });
			}
		}

		let strCMake = "# Generated only: native memory-hook argument-location regression build.\ncmake_minimum_required(VERSION 3.20)\nproject(MemoryHookArgumentLocations LANGUAGES CXX)\n";

		for (const Case of vecCases) {
			g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, Case.Name + ".cpp"), Case.Source);
			strCMake += `add_executable(${Case.Name} ${Case.Name}.cpp)
target_compile_features(${Case.Name} PRIVATE cxx_std_20)
if(MSVC)
	target_compile_options(${Case.Name} PRIVATE /W4 /WX /EHsc /permissive- /Zc:__cplusplus)
else()
	target_compile_options(${Case.Name} PRIVATE -Wall -Wextra -Werror -pedantic -fsanitize=undefined -fno-sanitize-recover=all)
	target_link_options(${Case.Name} PRIVATE -fsanitize=undefined)
endif()
`;
		}

		g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "CMakeLists.txt"), strCMake);

		const strBinaryRoot = g_Path.join(g_strTemporaryRoot, strProfile);
		const vecConfigure = ["-S", g_strTemporaryRoot, "-B", strBinaryRoot];
		if (process.platform === "win32") {
			vecConfigure.push("-G", "Visual Studio 17 2022", "-A", (strProfile === "X86") ? "Win32" : "x64");
		} else {
			const strWidth = (strProfile === "X86") ? "-m32" : "-m64";
			vecConfigure.push("-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_CXX_FLAGS=" + strWidth, "-DCMAKE_EXE_LINKER_FLAGS=" + strWidth);
		}

		Build(vecConfigure);
		Build(["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);

		for (const Case of vecCases) {
			const strProgram = g_Path.join(strBinaryRoot, (process.platform === "win32") ? "Release/" + Case.Name + ".exe" : Case.Name);
			const Result = Run(strProgram, []);
			g_Assert.equal(Result.status, Case.Status, strProfile + " " + Case.Name + ":\n" + Result.stdout + Result.stderr);

			if (Case.Status === 0) {
				VerifyFixtureCLI(strProgram);
			} else {
				g_Assert(Result.stderr.includes("Hook argument location failure:"), "Compiled control fails an assertion, not a crash");
			}

			console.log(strProfile + " " + Case.Name + ": compiled argument locations checked");
		}
	}
} finally {
	const strResolved = g_FileSystem.realpathSync(g_strTemporaryRoot);
	g_Assert.equal(strResolved, g_Path.resolve(g_strTemporaryRoot), "Cleanup remains at the exact created fixture path");
	g_Assert(!g_FileSystem.lstatSync(g_strTemporaryRoot).isSymbolicLink(), "Cleanup refuses a substituted fixture symlink");
	g_Assert.equal(g_Path.dirname(strResolved), g_strBuildRoot, "Cleanup remains in actual build root");
	g_Assert(/^NativeMemoryHookArgumentLocations-[^/\\]+$/.test(g_Path.basename(strResolved)), "Cleanup remains in owned fixture family");
	g_FileSystem.rmSync(strResolved, { recursive: true, force: true });
}
