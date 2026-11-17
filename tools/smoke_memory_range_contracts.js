#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

if (process.argv.length > 2) {
	const bHelpRequested = (process.argv.length === 3) && ((process.argv[2] === "--help") || (process.argv[2] === "-h"));
	console[bHelpRequested ? "log" : "error"]("Usage: node tools/smoke_memory_range_contracts.js");
	process.exit(bHelpRequested ? 0 : 2);
}

const g_unCommandTimeoutMilliseconds = 600000;
const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strSource = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_strFixture = g_FileSystem.readFileSync(g_Path.join(__dirname, "fixtures", "MemoryRangeContracts.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_strFixtureMarker = "\t// SOURCEJS_MEMORY_RANGE_HELPERS";

function GetDefinition(strName, bTemplate = false) {
	const strTemplatePrefix = bTemplate ? "template<typename TValue>\\n\\1" : "";
	const vecDefinitionMatches = new RegExp("^(\\t{1,2})" + strTemplatePrefix + "(?:bool|void) " + strName + "\\([^\\n]+\\) noexcept \\{$", "m").exec(g_strSource);
	g_Assert(vecDefinitionMatches, "Missing production helper: " + strName);

	const strClosingLine = "\n" + vecDefinitionMatches[1] + "}";
	const nDefinitionEnd = g_strSource.indexOf(strClosingLine + "\n", vecDefinitionMatches.index);
	g_Assert(nDefinitionEnd > vecDefinitionMatches.index, "Missing production helper end: " + strName);

	// Only indentation changes in the compiled view of these four reviewed helpers.
	const strDefinition = g_strSource.slice(vecDefinitionMatches.index, nDefinitionEnd + strClosingLine.length);
	const strContractView = strDefinition.split("\n").map(strLine => strLine.startsWith(vecDefinitionMatches[1]) ? ("\t" + strLine.slice(vecDefinitionMatches[1].length)) : strLine).join("\n");
	const strRoundTrip = strContractView.split("\n").map(strLine => strLine.startsWith("\t") ? (vecDefinitionMatches[1] + strLine.slice(1)) : strLine).join("\n");
	g_Assert.equal(strRoundTrip, strDefinition, "The compiled helper view must round-trip to the exact production definition.");

	return strContractView;
}

function RunCommand(strCommand, vecArguments) {
	const Result = g_ChildProcess.spawnSync(strCommand, vecArguments, { encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
	g_Assert.ifError(Result.error);
	g_Assert.equal(Result.signal, null, strCommand + ": unexpected signal.");
	g_Assert.equal(Result.status, 0, strCommand + ": " + Result.stdout + Result.stderr);
	g_Assert.doesNotMatch(Result.stdout + Result.stderr, /\bwarning(?:\s+[A-Z]+\d+)?\s*:/i, strCommand + ": unexpected warning.");

	return Result;
}

function PrepareFixtureExecution(strProgram) {
	if (process.platform !== "win32") {
		return strProgram;
	}

	// Do not relink the same Windows image immediately after executing it.
	// Each copy stays inside this run's validated temporary fixture directory.
	const strExecutionRoot = g_FileSystem.mkdtempSync(g_Path.join(g_Path.dirname(strProgram), "Execution-"));
	const strExecutionPath = g_Path.join(strExecutionRoot, g_Path.basename(strProgram));
	g_FileSystem.copyFileSync(strProgram, strExecutionPath, g_FileSystem.constants.COPYFILE_EXCL);

	return strExecutionPath;
}

function CheckProgramCLI(strProgram) {
	const Result = g_ChildProcess.spawnSync(PrepareFixtureExecution(strProgram), ["--invalid"], { encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
	g_Assert.ifError(Result.error);
	g_Assert.equal(Result.signal, null);
	g_Assert.equal(Result.status, 2, "Reject invalid native fixture arguments before executing contracts.");
	g_Assert.equal(Result.stdout, "");
	g_Assert.equal(Result.stderr.trim(), "Usage: MemoryRangeContracts");
}

g_Assert(["x64", "ia32"].includes(process.arch), "Native range tests require the configured x86/x64 compiler profiles.");
g_Assert.equal(g_strFixture.split(g_strFixtureMarker).length, 2);

const g_strHelpers = [
	GetDefinition("IsMemoryAddressRangeRepresentable"),
	GetDefinition("DoMemoryAddressRangesOverlap"),
	GetDefinition("ReadMemoryScalarFromAddress", true),
	GetDefinition("WriteMemoryScalarToAddress", true),
].join("\n\n");
const g_vecMutations = [
	{ Name: "LastByteBoundary", Old: "(unByteSize - kSingleByteCount) <=", New: "(unByteSize - kSingleByteCount) <" },
	{ Name: "ZeroSizeUnderflow", Old: "\t\tif (unByteSize == 0) {\n\t\t\treturn false;\n\t\t}\n\n", New: "" },
	{ Name: "AdjacentOverlap", Old: "return unAddressDistance < unByteSize;", New: "return unAddressDistance <= unByteSize;" },
	{ Name: "UnsignedDistance", Old: "? (unSecondAddress - unFirstAddress) : (unFirstAddress - unSecondAddress)", New: "? (unFirstAddress - unSecondAddress) : (unSecondAddress - unFirstAddress)" },
	{ Name: "ShortScalarRead", Old: "std::memcpy(&ReadValue, reinterpret_cast<void const*>(unAddress), sizeof(TValue));", New: "std::memcpy(&ReadValue, reinterpret_cast<void const*>(unAddress), sizeof(TValue) - 1);" },
	{ Name: "ShortScalarWrite", Old: "std::memcpy(reinterpret_cast<void*>(unAddress), &WriteValue, sizeof(TValue));", New: "std::memcpy(reinterpret_cast<void*>(unAddress), &WriteValue, sizeof(TValue) - 1);" },
	{ Name: "MissingScalarCommit", Old: "ReadValueOut = ReadValue;", New: "ReadValueOut = TValue {};" },
];

const g_vecProfiles = (process.platform === "win32") ? [
	{ Name: "Win32", Arguments: ["-G", "Visual Studio 17 2022", "-A", "Win32"] },
	{ Name: "X64", Arguments: ["-G", "Visual Studio 17 2022", "-A", "x64"] },
] : [
	{ Name: "X86", Arguments: ["-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_CXX_FLAGS=-m32"] },
	{ Name: "X64", Arguments: ["-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_CXX_FLAGS=-m64"] },
];

g_FileSystem.mkdirSync(g_Path.join(g_strProjectRoot, "build"), { recursive: true });

const g_strBuildRoot = g_FileSystem.realpathSync(g_Path.join(g_strProjectRoot, "build"));
const g_strTemporaryRoot = g_FileSystem.mkdtempSync(g_Path.join(g_strBuildRoot, "NativeMemoryRanges-"));
const g_strFixturePath = g_Path.join(g_strTemporaryRoot, "MemoryRangeContracts.cpp");

function WriteFixture(strHelpers) {
	g_FileSystem.writeFileSync(g_strFixturePath, g_strFixture.replace(g_strFixtureMarker, () => "\t// Generated only: native memory-range regression executable.\n" + strHelpers));
}

let g_unRejectedMutationCount = 0;
try {
	g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "CMakeLists.txt"), [
		"# Generated only: native memory-range regression build.",
		"cmake_minimum_required(VERSION 3.20)",
		"project(MemoryRangeContracts LANGUAGES CXX)",
		"add_executable(MemoryRangeContracts MemoryRangeContracts.cpp)",
		"target_compile_features(MemoryRangeContracts PRIVATE cxx_std_20)",
		"if(MSVC)",
		"\ttarget_compile_options(MemoryRangeContracts PRIVATE /W4 /WX)",
		"else()",
		"\ttarget_compile_options(MemoryRangeContracts PRIVATE -Wall -Wextra -Wpedantic -Werror)",
		"\ttarget_compile_options(MemoryRangeContracts PRIVATE -fsanitize=undefined -fno-sanitize-recover=undefined)",
		"\ttarget_link_options(MemoryRangeContracts PRIVATE -fsanitize=undefined -fno-sanitize-recover=undefined)",
		"endif()",
		"",
	].join("\n"));

	for (const Profile of g_vecProfiles) {
		WriteFixture(g_strHelpers);

		const strBinaryRoot = g_Path.join(g_strTemporaryRoot, Profile.Name);
		RunCommand("cmake", ["-S", g_strTemporaryRoot, "-B", strBinaryRoot, ...Profile.Arguments]);
		RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);

		const strProgram = (process.platform === "win32") ? g_Path.join(strBinaryRoot, "Release", "MemoryRangeContracts.exe") : g_Path.join(strBinaryRoot, "MemoryRangeContracts");
		console.log(RunCommand(PrepareFixtureExecution(strProgram), []).stdout.trim());
		CheckProgramCLI(strProgram);

		for (const Mutation of g_vecMutations) {
			g_Assert(g_strHelpers.includes(Mutation.Old), Mutation.Name);
			const strMutatedHelpers = g_strHelpers.replace(Mutation.Old, () => Mutation.New);
			g_Assert.notEqual(strMutatedHelpers, g_strHelpers, Mutation.Name + ": change the compiled production helper view.");
			WriteFixture(strMutatedHelpers);
			RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);

			const Result = g_ChildProcess.spawnSync(PrepareFixtureExecution(strProgram), [], { encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
			g_Assert.ifError(Result.error);
			g_Assert.equal(Result.signal, null, Mutation.Name + ": unexpected signal.");
			g_Assert.equal(Result.status, 1, Mutation.Name + ": reject through the native oracle, not an execution failure.");
			g_Assert.equal(Result.stdout, "");
			g_Assert.match(Result.stderr.trim(), /^MemoryRangeContracts failed Scenario="[^"\r\n]+" Actual=[01] Expected=[01]$/, Mutation.Name + ": preserve the native oracle diagnostic without extra failures.");
			++g_unRejectedMutationCount;
		}

		WriteFixture(g_strHelpers);
		RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);
		RunCommand(PrepareFixtureExecution(strProgram), []);
	}
} finally {
	const strRealTemporaryRoot = g_FileSystem.realpathSync(g_strTemporaryRoot);
	const strRelativeTemporaryRoot = g_Path.relative(g_strBuildRoot, strRealTemporaryRoot);
	g_Assert(!g_Path.isAbsolute(strRelativeTemporaryRoot) && !strRelativeTemporaryRoot.startsWith("..") && /^NativeMemoryRanges-[^/\\]+$/.test(strRelativeTemporaryRoot), "Refuse cleanup outside the exact native fixture directory.");
	g_Assert(!g_FileSystem.lstatSync(g_strTemporaryRoot).isSymbolicLink());
	g_FileSystem.rmSync(strRealTemporaryRoot, { recursive: true, force: true });
}

console.log("Memory native range/scalar checks PASS; profiles=" + g_vecProfiles.length + "; compiled regressions=" + g_unRejectedMutationCount + "; stack-byte storage exercised; live V8/engine-memory access not exercised; temporary fixture cleaned.");
