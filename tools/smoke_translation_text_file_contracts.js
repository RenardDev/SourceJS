#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_unCommandTimeoutMilliseconds = 600000;
const g_unMaximumCommandOutputByteCount = 16 * 1024 * 1024;
const g_vecProfiles = (process.platform === "win32") ? [
	{ Name: "Win32", AddressBits: 32, Arguments: ["-G", "Visual Studio 17 2022", "-A", "Win32"] },
	{ Name: "X64", AddressBits: 64, Arguments: ["-G", "Visual Studio 17 2022", "-A", "x64"] },
] : [
	{ Name: "X86", AddressBits: 32, Arguments: ["-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_CXX_FLAGS=-m32 -fsanitize=undefined -fno-sanitize-recover=undefined", "-DCMAKE_EXE_LINKER_FLAGS=-fsanitize=undefined"] },
	{ Name: "X64", AddressBits: 64, Arguments: ["-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_CXX_FLAGS=-m64 -fsanitize=undefined -fno-sanitize-recover=undefined", "-DCMAKE_EXE_LINKER_FLAGS=-fsanitize=undefined"] },
];
const g_vecExpectedFailureMessages = [
	"invalid reads changed output or reported success.",
	"exact binary/empty/block-boundary roundtrip mismatch.",
	"existing file was overwritten or reported missing.",
	"NUL path was truncated or modified its existing prefix.",
	"invalid output paths reported success.",
	"native decoding, key/value parsing, INI merging or language selection mismatch.",
];

if (process.argv.length > 2) {
	if ((process.argv.length === 3) && ["--help", "-h"].includes(process.argv[2])) {
		console.log("Usage: node tools/smoke_translation_text_file_contracts.js [--profile " + g_vecProfiles.map(Profile => Profile.Name).join("|") + "]\nCompiles extracted native helpers and executes isolated filesystem/parser contracts; does not execute live V8 or engine code.");
		process.exit(0);
	}

	const nProfileIndex = g_vecProfiles.findIndex(Profile => Profile.Name === process.argv[3]);
	if ((process.argv.length !== 4) || (process.argv[2] !== "--profile") || (nProfileIndex < 0)) {
		console.error("Usage: node tools/smoke_translation_text_file_contracts.js [--profile " + g_vecProfiles.map(Profile => Profile.Name).join("|") + "]");
		process.exit(2);
	}

	g_vecProfiles.splice(0, g_vecProfiles.length, g_vecProfiles[nProfileIndex]);
}

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strSource = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_strFixture = g_FileSystem.readFileSync(g_Path.join(__dirname, "fixtures", "TranslationTextFileContracts.cpp"), "utf8").replace(/\r\n/g, "\n");

let g_unRejectedMutationCount = 0;

function GetDefinition(strPattern, strClosingLine, strSource = g_strSource) {
	const vecDefinitions = [...strSource.matchAll(new RegExp("^(\\t{1,2})" + strPattern + "$", "gm"))];
	g_Assert.equal(vecDefinitions.length, 1, "Extract one real translation definition: " + strPattern);

	const vecDefinition = vecDefinitions[0];
	const vecClosing = new RegExp("^" + vecDefinition[1] + strClosingLine + "$", "m").exec(strSource.slice(vecDefinition.index));
	g_Assert(vecClosing && (vecClosing.index > 0));
	const strActualDefinition = strSource.slice(vecDefinition.index, vecDefinition.index + vecClosing.index + vecClosing[0].length);
	const bNested = vecDefinition[1].length === 2;
	const strDefinition = bNested ? strActualDefinition.replace(/^\t(?![ \t]*#)/gm, "") : strActualDefinition;
	g_Assert.equal(bNested ? strDefinition.replace(/^\t(?![ \t]*#)/gm, "\t\t") : strDefinition, strActualDefinition, "The compiled view preserves the actual definition exactly, apart from namespace indentation.");

	return strDefinition;
}

function CheckDefinitionExtraction() {
	const strPattern = "bool Probe\\([^\\n;{}]*\\)(?: noexcept)? \\{";
	for (const strIndentation of ["\t", "\t\t"]) {
		const strPrototype = strIndentation + "bool Probe(int nValue); // marker ) noexcept {\n";
		const strUnrelated = strIndentation + "bool Other(int nValue) {\n" + strIndentation + "\treturn Probe(nValue);\n" + strIndentation + "}\n";
		const strDefinition = strIndentation + "bool Probe(int nValue) noexcept {\n#if TEST\n" + strIndentation + "\treturn true;\n#endif\n" + strIndentation + "}";
		const strNormalized = (strIndentation === "\t\t") ? strDefinition.replace(/^\t/gm, "") : strDefinition;
		g_Assert.equal(GetDefinition(strPattern, "\\}", strPrototype + strUnrelated + strDefinition + "\n"), strNormalized);
		g_Assert.equal(GetDefinition(strPattern, "\\}", strDefinition.replace(/^#/gm, "\t#") + "\n"), strNormalized.replace(/^#/gm, "\t#"));

		const strEmpty = strIndentation + "bool Probe() noexcept {\n" + strIndentation + "}";
		g_Assert.equal(GetDefinition(strPattern, "\\}", strEmpty + "\n"), "\tbool Probe() noexcept {\n\t}");
		const strRecord = strIndentation + "struct Sample {\n" + strIndentation + "\tint m_nValue;\n" + strIndentation + "};\n";
		g_Assert.equal(GetDefinition("struct Sample \\{", "\\};", strRecord), "\tstruct Sample {\n\t\tint m_nValue;\n\t};");
		g_Assert.throws(() => GetDefinition(strPattern, "\\}", strPrototype + strUnrelated), { code: "ERR_ASSERTION" });
		g_Assert.throws(() => GetDefinition(strPattern, "\\}", strDefinition + "\n" + strDefinition + "\n"), { code: "ERR_ASSERTION" });
	}
}

const g_strFixtureMarker = "\t// SOURCEJS_TRANSLATION_TEXT_FILE_HELPERS";
const g_vecHelperNames = ["ReadTranslationTextFile", "WriteTranslationTextFile", "EnsureTranslationTextFileExists"];
const g_vecHelpers = g_vecHelperNames.map(strName => GetDefinition("bool " + strName + "\\([^\\n;{}]*\\) noexcept \\{", "\\}"));
const g_strHelpers = g_vecHelpers.join("\n\n");
const g_strRecordsMarker = "\t// SOURCEJS_TRANSLATION_TEXT_FILE_RECORDS";
const g_strParsersMarker = "\t// SOURCEJS_TRANSLATION_PARSER_HELPERS";
const g_vecRecordNames = ["TranslationLanguageState", "TranslationPhrase", "TranslationFile"];
const g_strRecords = g_vecRecordNames.map(strName => GetDefinition("struct " + strName + " \\{", "\\};")).join("\n\n");
const g_vecParserNames = [
	"ConvertTranslationStringToLowercase",
	"TrimStringWhitespace",
	"DecodeTranslationHexadecimalDigit",
	"DecodeTranslationEscapeSequences",
	"UnquoteTranslationString",
	"ParseTranslationKeyValue",
	"RegisterTranslationLanguageAlias",
	"GetTranslationLanguageCode",
	"ParseTranslationINIFile",
	"SelectTranslationPhraseLanguageCode",
];
const g_vecParsers = g_vecParserNames.map(strName => GetDefinition("(?:constexpr )?(?:bool|int|std::string) " + strName + "\\([^\\n;{}]*\\) (?:noexcept )?\\{", "\\}"));
const g_strParsers = g_vecParsers.join("\n\n");

function CheckSourceContracts(strHelpers) {
	g_Assert.equal([...strHelpers.matchAll(/catch \(std::exception const&\)/g)].length, 3);
	g_Assert.equal([...strHelpers.matchAll(/catch \(\.\.\.\)/g)].length, 3);
	g_Assert.equal([...strHelpers.matchAll(/PathTextFile\.native\(\)\.find\(kNullPathCharacter\) != std::filesystem::path::string_type::npos/g)].length, 3);
	g_Assert(strHelpers.includes("kTextReadBlockByteCount = 4096;"));
	g_Assert(strHelpers.includes("if (InputFileStream.bad() || (nReadByteCount < 0))"));
	g_Assert(strHelpers.includes("if (InputFileStream.fail() || (unReadByteCount == 0))"));
	g_Assert(strHelpers.indexOf("if (InputFileStream.eof())") < strHelpers.indexOf("if (InputFileStream.fail()"));
	g_Assert(strHelpers.includes("strTextOut.swap(strReadText);"));
	g_Assert(strHelpers.includes("strSourceText.size() > kMaximumWriteByteCount"));
	g_Assert(strHelpers.includes("kMaximumWriteByteCount = static_cast<std::uintmax_t>(std::numeric_limits<std::streamsize>::max());"));
	g_Assert(strHelpers.includes("OutputFileStream.flush();\n\n\t\t\treturn OutputFileStream.good();"));
}

function RunCommand(strCommand, vecArguments, nExpectedStatus = 0) {
	const vecDisplayArguments = [strCommand, ...vecArguments].map(strArgument => {
		const strRelativeArgument = g_Path.isAbsolute(strArgument) ? g_Path.relative(g_strProjectRoot, strArgument) : strArgument;

		return g_Path.isAbsolute(strRelativeArgument) ? strArgument : strRelativeArgument;
	});
	const strContext = "RunCommand Command=" + JSON.stringify(vecDisplayArguments);
	const Result = g_ChildProcess.spawnSync(strCommand, vecArguments, { cwd: g_strProjectRoot, encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds, maxBuffer: g_unMaximumCommandOutputByteCount });
	g_Assert(!Result.error, strContext + ": " + Result.error?.message);
	g_Assert.equal(Result.signal, null, strContext + ": unexpected signal.");
	g_Assert.equal(Result.status, nExpectedStatus, strContext + ": " + Result.stdout + Result.stderr);
	g_Assert.doesNotMatch(Result.stdout + Result.stderr, /\bwarning(?:\s+[A-Z]\d+)?\s*:|\bruntime error:|\b(?:AddressSanitizer|UndefinedBehaviorSanitizer)\b/i, strContext + ": warnings and sanitizer diagnostics fail this check.");

	return Result;
}

const g_vecSourceMutations = [
	{ Old: "catch (std::exception const&)", New: "catch (int)" },
	{ Old: "catch (...)", New: "catch (int)" },
	{ Old: "PathTextFile.native().find(kNullPathCharacter) != std::filesystem::path::string_type::npos", New: "false" },
	{ Old: "strSourceText.size() > kMaximumWriteByteCount", New: "false" },
	{ Old: "strTextOut.swap(strReadText);", New: "strTextOut.clear();" },
	{ Old: "OutputFileStream.flush();", New: "" },
];

CheckDefinitionExtraction();
CheckSourceContracts(g_strHelpers);

for (const Mutation of g_vecSourceMutations) {
	g_Assert(g_strHelpers.includes(Mutation.Old));
	g_Assert.throws(() => CheckSourceContracts(g_strHelpers.replace(Mutation.Old, () => Mutation.New)), g_Assert.AssertionError);
}

const g_vecMutations = [
	{ Name: "ReadInvalidPathSuccess", Helper: 0, Old: "\n\t\t\treturn false;", New: "\n\t\t\treturn true;" },
	{ Name: "DroppedReadByte", Helper: 0, Old: "strReadText.append(arrReadBuffer.data(), unReadByteCount);", New: "strReadText.append(arrReadBuffer.data(), (unReadByteCount > 0) ? (unReadByteCount - 1) : 0);" },
	{ Name: "MissingReadCommit", Helper: 0, Old: "strTextOut.swap(strReadText);", New: "strTextOut.clear();" },
	{ Name: "WriteInvalidPathSuccess", Helper: 1, Old: "\n\t\t\treturn false;", New: "\n\t\t\treturn true;" },
	{ Name: "DroppedWriteByte", Helper: 1, Old: "static_cast<std::streamsize>(strSourceText.size())", New: "static_cast<std::streamsize>(strSourceText.empty() ? 0 : (strSourceText.size() - 1))" },
	{ Name: "EnsureInvalidPathSuccess", Helper: 2, Old: "\n\t\t\treturn false;", New: "\n\t\t\treturn true;" },
	{ Name: "ExistingFileOverwritten", Helper: 2, Old: "if (bTextFileExists) {\n\t\t\t\treturn true;", New: "if (bTextFileExists) {\n\t\t\t\treturn WriteTranslationTextFile(PathTextFile, strInitialText);" },
];
const g_vecParserMutations = [
	{ Name: "HexadecimalLetterValue", Helper: "DecodeTranslationHexadecimalDigit", Old: "kHexadecimalLetterValueOffset = 0xA;", New: "kHexadecimalLetterValueOffset = 0xB;" },
	{ Name: "HexadecimalLowDigit", Helper: "DecodeTranslationEscapeSequences", Old: "kLowHexadecimalDigitOffset = kHexadecimalDigitCount;", New: "kLowHexadecimalDigitOffset = kNextCharacterOffset;" },
	{ Name: "QuotedTextNotUnquoted", Helper: "UnquoteTranslationString", Old: "if (!bDoubleQuoted && !bSingleQuoted)", New: "if (bDoubleQuoted || bSingleQuoted)" },
	{ Name: "InvalidKeyValueSuccess", Helper: "ParseTranslationKeyValue", Old: "\n\t\t\treturn false;", New: "\n\t\t\treturn true;" },
	{ Name: "AliasNotCaseFolded", Helper: "RegisterTranslationLanguageAlias", Old: "ConvertTranslationStringToLowercase(TrimStringWhitespace(strLanguageAlias))", New: "TrimStringWhitespace(strLanguageAlias)" },
	{ Name: "MissingPhrasesCommit", Helper: "ParseTranslationINIFile", Old: "TranslationFileDataInOut.m_mapPhrases.swap(mapParsedPhrases);", New: "TranslationFileDataInOut.m_mapPhrases.clear();" },
	{ Name: "MissingDefaultLanguageCommit", Helper: "ParseTranslationINIFile", Old: "TranslationFileDataInOut.m_strDefaultLanguageCode.swap(strParsedDefaultLanguageCode);", New: "TranslationFileDataInOut.m_strDefaultLanguageCode.clear();" },
	{ Name: "RequestedLanguageIgnored", Helper: "SelectTranslationPhraseLanguageCode", Old: "return strRequestedLanguageCode;", New: "return LanguageState.m_strDefaultLanguageCode;" },
];

g_Assert.equal(g_strFixture.split(g_strFixtureMarker).length, 2);
g_Assert.equal(g_strFixture.split(g_strRecordsMarker).length, 2);
g_Assert.equal(g_strFixture.split(g_strParsersMarker).length, 2);
g_FileSystem.mkdirSync(g_Path.join(g_strProjectRoot, "build"), { recursive: true });
const g_strBuildRoot = g_FileSystem.realpathSync(g_Path.join(g_strProjectRoot, "build"));
const g_strTemporaryRoot = g_FileSystem.mkdtempSync(g_Path.join(g_strBuildRoot, "NativeTranslationTextFiles-"));
const g_strFixturePath = g_Path.join(g_strTemporaryRoot, "TranslationTextFileContracts.cpp");

function WriteFixture(strHelpers, strParsers = g_strParsers) {
	const strSource = g_strFixture.replace(g_strRecordsMarker, () => g_strRecords).replace(g_strFixtureMarker, () => strHelpers).replace(g_strParsersMarker, () => strParsers);
	g_FileSystem.writeFileSync(g_strFixturePath, strSource + "\n// Generated-only; tools/smoke_translation_text_file_contracts.js owns this compiled fixture copy.\n");
}

function RunFixture(strProgram, nExpectedStatus = 0) {
	const strCaseRoot = g_FileSystem.mkdtempSync(g_Path.join(g_strTemporaryRoot, "Case-"));

	return RunCommand(strProgram, [strCaseRoot], nExpectedStatus);
}

function CheckPositiveFixture(Result, unAddressBits) {
	const strOutput = Result.stdout.replace(/\r\n/g, "\n");
	const vecLines = strOutput.split("\n");
	g_Assert.equal(Result.stderr, "");
	g_Assert.equal(vecLines.length, 4, "The native fixture must emit three complete result records.");
	g_Assert.equal(vecLines[3], "");

	if (process.platform === "win32") {
		g_Assert.equal(vecLines[0], "Translation delayed-write failure probe: unavailable (no /dev/full on Windows).");
	} else {
		g_Assert.match(vecLines[0], /^Translation delayed-write failure probe: (?:PASS|unavailable \(\/dev\/full absent\))\.$/);
	}

	g_Assert.equal(vecLines[1], "Translation text-file native checks PASS; AddressBits=" + unAddressBits + "; FailedReads=4; Roundtrips=6; ExistingFilePreserved=true.");
	g_Assert.equal(vecLines[2], "Translation parser native checks PASS; HexadecimalCharacters=256; INIMerge=true; SelectionPrecedence=true.");
}

function CheckNegativeFixture(Result, strName) {
	const strError = Result.stderr.replace(/\r\n/g, "\n");
	g_Assert(g_vecExpectedFailureMessages.some(strMessage => strError === ("TranslationTextFileContracts failed: " + strMessage + "\n")), strName + ": reject through a known native oracle, not an execution/environment failure: " + strError);
	g_Assert.match(Result.stdout.replace(/\r\n/g, "\n"), /^(?:Translation delayed-write failure probe: (?:PASS|unavailable \((?:no \/dev\/full on Windows|\/dev\/full absent)\))\.\n)?$/, strName + ": unexpected negative-fixture output.");
}

try {
	g_FileSystem.writeFileSync(g_Path.join(g_strTemporaryRoot, "CMakeLists.txt"), [
		"cmake_minimum_required(VERSION 3.20)",
		"project(TranslationTextFileContracts LANGUAGES CXX)",
		"add_executable(TranslationTextFileContracts TranslationTextFileContracts.cpp)",
		"target_compile_features(TranslationTextFileContracts PRIVATE cxx_std_20)",
		"if(MSVC)",
		"\ttarget_compile_options(TranslationTextFileContracts PRIVATE /W4 /WX)",
		"elseif(CMAKE_CXX_COMPILER_ID MATCHES \"GNU|Clang\")",
		"\ttarget_compile_options(TranslationTextFileContracts PRIVATE -Wall -Wextra -Wpedantic -Werror)",
		"else()",
		"\tmessage(FATAL_ERROR \"Unsupported fixture compiler\")",
		"endif()",
		"",
	].join("\n"));

	for (const Profile of g_vecProfiles) {
		WriteFixture(g_strHelpers);
		const strBinaryRoot = g_Path.join(g_strTemporaryRoot, Profile.Name);
		RunCommand("cmake", ["-S", g_strTemporaryRoot, "-B", strBinaryRoot, ...Profile.Arguments]);
		RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);
		const strProgram = (process.platform === "win32") ? g_Path.join(strBinaryRoot, "Release", "TranslationTextFileContracts.exe") : g_Path.join(strBinaryRoot, "TranslationTextFileContracts");
		const PositiveResult = RunFixture(strProgram);
		CheckPositiveFixture(PositiveResult, Profile.AddressBits);
		console.log(PositiveResult.stdout.trim());

		for (const vecArguments of [[], [g_strTemporaryRoot, "extra"]]) {
			const InvalidResult = RunCommand(strProgram, vecArguments, 2);
			g_Assert.equal(InvalidResult.stdout, "");
			g_Assert.equal(InvalidResult.stderr.replace(/\r\n/g, "\n"), "Usage: TranslationTextFileContracts <private-fixture-directory>\n");
		}

		for (const Mutation of g_vecMutations) {
			const strOriginalHelper = g_vecHelpers[Mutation.Helper];
			g_Assert(strOriginalHelper.includes(Mutation.Old));
			const strMutatedHelper = strOriginalHelper.replace(Mutation.Old, () => Mutation.New);
			g_Assert.notEqual(strMutatedHelper, strOriginalHelper);
			WriteFixture(g_strHelpers.replace(strOriginalHelper, () => strMutatedHelper));
			RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);
			const NegativeResult = RunFixture(strProgram, 1);
			CheckNegativeFixture(NegativeResult, Mutation.Name);
			++g_unRejectedMutationCount;
		}

		for (const Mutation of g_vecParserMutations) {
			const nHelperIndex = g_vecParserNames.indexOf(Mutation.Helper);
			g_Assert(nHelperIndex >= 0);
			const strOriginalParser = g_vecParsers[nHelperIndex];
			g_Assert(strOriginalParser.includes(Mutation.Old));
			const strMutatedParser = strOriginalParser.replace(Mutation.Old, () => Mutation.New);
			g_Assert.notEqual(strMutatedParser, strOriginalParser);
			WriteFixture(g_strHelpers, g_strParsers.replace(strOriginalParser, () => strMutatedParser));
			RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);
			const NegativeResult = RunFixture(strProgram, 1);
			CheckNegativeFixture(NegativeResult, Mutation.Name);
			++g_unRejectedMutationCount;
		}

		WriteFixture(g_strHelpers);
		RunCommand("cmake", ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"]);
		const RestoredResult = RunFixture(strProgram);
		CheckPositiveFixture(RestoredResult, Profile.AddressBits);
	}
} finally {
	const TemporaryInformation = g_FileSystem.lstatSync(g_strTemporaryRoot);
	g_Assert(TemporaryInformation.isDirectory() && !TemporaryInformation.isSymbolicLink(), "Refuse cleanup through a replaced fixture directory.");

	const strRealTemporaryRoot = g_FileSystem.realpathSync(g_strTemporaryRoot);
	const strRelativeTemporaryRoot = g_Path.relative(g_strBuildRoot, strRealTemporaryRoot);
	g_Assert((g_Path.dirname(strRealTemporaryRoot) === g_strBuildRoot) && (strRelativeTemporaryRoot === g_Path.basename(g_strTemporaryRoot)) && /^NativeTranslationTextFiles-[^/\\]+$/.test(strRelativeTemporaryRoot), "Refuse cleanup outside the exact allocated native fixture directory.");
	g_FileSystem.rmSync(strRealTemporaryRoot, { recursive: true, force: true });
}

console.log("Translation native text-file checks PASS; profiles=" + g_vecProfiles.length + "; compiled regressions=" + g_unRejectedMutationCount + "; source regressions=" + g_vecSourceMutations.length + "; live V8/engine execution not exercised; temporary fixture cleaned.");
