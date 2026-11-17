#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

if (process.argv.length > 2) {
	const bHelpRequested = (process.argv.length === 3) && ((process.argv[2] === "--help") || (process.argv[2] === "-h"));
	console[bHelpRequested ? "log" : "error"]("Usage: node tools/smoke_memory_text_file_contracts.js");
	process.exit(bHelpRequested ? 0 : 2);
}

const g_unCommandTimeoutMilliseconds = 600000;
const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strSource = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_strFixture = g_FileSystem.readFileSync(g_Path.join(__dirname, "fixtures", "MemoryTextFileContracts.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_strFixtureMarker = "\t// SOURCEJS_MEMORY_TEXT_FILE_HELPER";
const g_vecDefinitionMatches = /^(\t{1,2})bool ReadMemoryManagerTextFile\([^\n]+\) noexcept \{$/m.exec(g_strSource);
g_Assert(g_vecDefinitionMatches, "Extract the real noexcept file reader, not a test implementation.");

const g_strReaderClosingLine = "\n" + g_vecDefinitionMatches[1] + "}";
const g_nDefinitionEnd = g_strSource.indexOf(g_strReaderClosingLine + "\n", g_vecDefinitionMatches.index);
g_Assert(g_nDefinitionEnd > g_vecDefinitionMatches.index, "Missing production file-reader end.");

const g_unReaderLimit = g_nDefinitionEnd + g_strReaderClosingLine.length;
const g_strActualReader = g_strSource.slice(g_vecDefinitionMatches.index, g_unReaderLimit);
const g_strReader = g_strActualReader.split("\n").map(strLine => strLine.startsWith(g_vecDefinitionMatches[1]) ? ("\t" + strLine.slice(g_vecDefinitionMatches[1].length)) : strLine).join("\n");
const g_strReaderRoundTrip = g_strReader.split("\n").map(strLine => strLine.startsWith("\t") ? (g_vecDefinitionMatches[1] + strLine.slice(1)) : strLine).join("\n");
g_Assert.equal(g_strReaderRoundTrip, g_strActualReader, "The compiled reader view must round-trip to the exact production helper.");

const g_vecFailureGuards = [
	"} catch (std::exception const&) {\n\t\t\treturn false;",
	"} catch (...) {\n\t\t\treturn false;",
	"if (InputFileStream.bad() || (nReadByteCount < 0))",
	"if (InputFileStream.fail() || (unReadByteCount == 0))",
	"if (InputFileStream.eof())",
];

function CheckFailureContracts(strReader) {
	g_Assert(strReader.includes("} catch (std::exception const&) {\n\t\t\treturn false;"));
	g_Assert(strReader.includes("} catch (...) {\n\t\t\treturn false;"));

	const nBadReadGuard = strReader.indexOf("if (InputFileStream.bad() || (nReadByteCount < 0))");
	const nAppend = strReader.indexOf("strReadText.append(");
	const nCommit = strReader.indexOf("strTextOut.swap(strReadText);");
	g_Assert((nBadReadGuard >= 0) && (nAppend > nBadReadGuard) && (nCommit > nAppend), "Never commit failed/partial reads.");
	g_Assert(strReader.includes("if (InputFileStream.fail() || (unReadByteCount == 0))"));

	const nEOFGuard = strReader.indexOf("if (InputFileStream.eof())");
	const nFailedReadGuard = strReader.indexOf("if (InputFileStream.fail()");
	g_Assert((nEOFGuard >= 0) && (nFailedReadGuard > nEOFGuard), "Normal EOF after a short or empty final read is success.");
	g_Assert.doesNotMatch(strReader.slice(0, nCommit), /strTextOut\s*(?:=|\.)/);
}

function CheckExecutionResult(Result, nExpectedExitCode, strOperation) {
	g_Assert.ifError(Result.error);
	g_Assert.equal(Result.signal, null, strOperation + ": unexpected signal.");
	g_Assert.equal(Result.status, nExpectedExitCode, strOperation + ": " + Result.stdout + Result.stderr);
	g_Assert.doesNotMatch(Result.stdout + Result.stderr, /\bwarning(?:\s+[A-Z]+\d+)?\s*:/i, strOperation + ": unexpected warning.");
}

function RunCommand(strCommand, vecArguments) {
	const Result = g_ChildProcess.spawnSync(strCommand, vecArguments, { encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
	CheckExecutionResult(Result, 0, strCommand);

	return Result;
}

CheckFailureContracts(g_strReader);

for (const strGuard of g_vecFailureGuards) {
	g_Assert(g_strReader.includes(strGuard));

	const strChangedReader = g_strReader.replace(strGuard, () => "");
	const strActualChangedReader = strChangedReader.split("\n").map(strLine => strLine.startsWith("\t") ? (g_vecDefinitionMatches[1] + strLine.slice(1)) : strLine).join("\n");
	const strChangedSource = g_strSource.slice(0, g_vecDefinitionMatches.index) + strActualChangedReader + g_strSource.slice(g_unReaderLimit);
	g_Assert.notEqual(strChangedSource, g_strSource, "Each reader regression must change the actual source region.");
	g_Assert.throws(() => CheckFailureContracts(strChangedReader), g_Assert.AssertionError);
}

const g_strReadMismatchDiagnostic = "MemoryTextFileContracts failed: binary/empty/multi-block read mismatch.";
const g_vecMutations = [
	{ Name: "EmptyPathSuccess", Old: "if (PathTextFile.empty()) {\n\t\t\treturn false;", New: "if (PathTextFile.empty()) {\n\t\t\treturn true;", Diagnostic: "MemoryTextFileContracts failed: failed reads committed output or reported success." },
	{ Name: "DroppedReadByte", Old: "strReadText.append(arrReadBuffer.data(), unReadByteCount);", New: "strReadText.append(arrReadBuffer.data(), (unReadByteCount > 0) ? (unReadByteCount - 1) : 0);", Diagnostic: g_strReadMismatchDiagnostic },
	{ Name: "MissingCommit", Old: "strTextOut.swap(strReadText);", New: "strTextOut.clear();", Diagnostic: g_strReadMismatchDiagnostic },
	{ Name: "ReadRejected", Old: "if (InputFileStream.bad() || (nReadByteCount < 0))", New: "if (true)", Diagnostic: g_strReadMismatchDiagnostic },
];
const g_vecProfiles = (process.platform === "win32") ? [
	{ Name: "Win32", Arguments: ["-G", "Visual Studio 17 2022", "-A", "Win32"] },
	{ Name: "X64", Arguments: ["-G", "Visual Studio 17 2022", "-A", "x64"] },
] : [
	{ Name: "X86", Arguments: ["-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_CXX_FLAGS=-m32"] },
	{ Name: "X64", Arguments: ["-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_CXX_FLAGS=-m64"] },
];

g_Assert.equal(g_strFixture.split(g_strFixtureMarker).length, 2);
g_FileSystem.mkdirSync(g_Path.join(g_strProjectRoot, "build"), { recursive: true });

const g_strBuildRoot = g_FileSystem.realpathSync(g_Path.join(g_strProjectRoot, "build"));
const g_strTemporaryRoot = g_FileSystem.mkdtempSync(g_Path.join(g_strBuildRoot, "NativeMemoryTextFiles-"));
const g_strFixturePath = g_Path.join(g_strTemporaryRoot, "MemoryTextFileContracts.cpp");

function WriteFixture(strReader) {
	g_FileSystem.writeFileSync(g_strFixturePath, g_strFixture.replace(g_strFixtureMarker, () => "\t// Generated only: native memory text-file regression executable.\n" + strReader));
}

function RunFixture(strProgram) {
	const strCaseRoot = g_FileSystem.mkdtempSync(g_Path.join(g_strTemporaryRoot, "Case-"));

	return g_ChildProcess.spawnSync(strProgram, [strCaseRoot], { encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
}

let g_unRejectedMutationCount = 0;
try {
	g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "CMakeLists.txt"), [
		"# Generated only: native memory text-file regression build.",
		"cmake_minimum_required(VERSION 3.20)",
		"project(MemoryTextFileContracts LANGUAGES CXX)",
		"add_executable(MemoryTextFileContracts MemoryTextFileContracts.cpp)",
		"target_compile_features(MemoryTextFileContracts PRIVATE cxx_std_20)",
		"if(MSVC)",
		"\ttarget_compile_options(MemoryTextFileContracts PRIVATE /W4 /WX)",
		"else()",
		"\ttarget_compile_options(MemoryTextFileContracts PRIVATE -Wall -Wextra -Wpedantic -Werror)",
		"\ttarget_compile_options(MemoryTextFileContracts PRIVATE -fsanitize=undefined -fno-sanitize-recover=undefined)",
		"\ttarget_link_options(MemoryTextFileContracts PRIVATE -fsanitize=undefined -fno-sanitize-recover=undefined)",
		"endif()",
		"",
	].join("\n"));

	for (const Profile of g_vecProfiles) {
		WriteFixture(g_strReader);

		const strBinaryRoot = g_Path.join(g_strTemporaryRoot, Profile.Name);
		RunCommand("cmake", ["-S", g_strTemporaryRoot, "-B", strBinaryRoot, ...Profile.Arguments]);
		RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);

		const strProgram = (process.platform === "win32") ? g_Path.join(strBinaryRoot, "Release", "MemoryTextFileContracts.exe") : g_Path.join(strBinaryRoot, "MemoryTextFileContracts");
		const strInvalidArgumentRoot = g_Path.join(g_strTemporaryRoot, `InvalidArguments-${Profile.Name}`);
		const vecInvalidArgumentLists = [[], [strInvalidArgumentRoot, "Extra"]];
		for (const vecArguments of vecInvalidArgumentLists) {
			const Result = g_ChildProcess.spawnSync(strProgram, vecArguments, { encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
			CheckExecutionResult(Result, 2, strProgram);
			g_Assert.match(Result.stderr, /^Usage: MemoryTextFileContracts /);
			g_Assert.equal(Result.stdout, "", "Invalid arguments must not execute file tests or emit a result marker.");
			g_Assert.doesNotMatch(Result.stderr, /MemoryTextFileContracts failed|native checks PASS/);
			g_Assert.equal(g_FileSystem.existsSync(strInvalidArgumentRoot), false, "Invalid arguments must not create fixture data.");
		}

		const PositiveResult = RunFixture(strProgram);
		CheckExecutionResult(PositiveResult, 0, strProgram);
		console.log(PositiveResult.stdout.trim());

		for (const Mutation of g_vecMutations) {
			g_Assert(g_strReader.includes(Mutation.Old), Mutation.Name);
			const strChangedReader = g_strReader.replace(Mutation.Old, () => Mutation.New);
			g_Assert.notEqual(strChangedReader, g_strReader, Mutation.Name + ": change the compiled production reader.");
			WriteFixture(strChangedReader);
			RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);

			const NegativeResult = RunFixture(strProgram);
			CheckExecutionResult(NegativeResult, 1, Mutation.Name);
			g_Assert.equal(NegativeResult.stdout, "");
			g_Assert.equal(NegativeResult.stderr.trim(), Mutation.Diagnostic, Mutation.Name + ": reject through the specific native oracle, not an unrelated fixture failure.");
			++g_unRejectedMutationCount;
		}

		WriteFixture(g_strReader);
		RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);

		const RestoredResult = RunFixture(strProgram);
		CheckExecutionResult(RestoredResult, 0, strProgram);
	}
} finally {
	const strRealTemporaryRoot = g_FileSystem.realpathSync(g_strTemporaryRoot);
	const strRelativeTemporaryRoot = g_Path.relative(g_strBuildRoot, strRealTemporaryRoot);
	g_Assert(!g_Path.isAbsolute(strRelativeTemporaryRoot) && !strRelativeTemporaryRoot.startsWith("..") && /^NativeMemoryTextFiles-[^/\\]+$/.test(strRelativeTemporaryRoot), "Refuse cleanup outside the exact native fixture directory.");
	g_Assert(!g_FileSystem.lstatSync(g_strTemporaryRoot).isSymbolicLink());
	g_FileSystem.rmSync(strRealTemporaryRoot, { recursive: true, force: true });
}

console.log("Memory native text-file checks PASS; profiles=" + g_vecProfiles.length + "; compiled regressions=" + g_unRejectedMutationCount + "; failure/source regressions=" + g_vecFailureGuards.length + "; live V8/engine execution not exercised; temporary fixture cleaned.");
