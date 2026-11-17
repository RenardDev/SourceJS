#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_vecArguments = process.argv.slice(2);
if (g_vecArguments.length > 0) {
	const bShowHelp = (g_vecArguments.length === 1) && (g_vecArguments[0] === "--help");
	const strUsage = `Usage: node ${g_Path.relative(process.cwd(), __filename)} [--help]\nCompiles and runs native auth-file contracts.\nUnexpected arguments exit with status 2.\n`;
	g_FileSystem.writeSync(bShowHelp ? process.stdout.fd : process.stderr.fd, strUsage);
	process.exit(bShowHelp ? 0 : 2);
}

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strSource = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_vecAuthNativeUnwindContracts = [
	["ReadAuthenticationStringArrayProperty", "PropertyReadFailure"],
	["LoadAuthenticationJSONRecords", "JSONReadFailure"],
	["LoadAuthenticationState", "AuthenticationStateLoadFailure"],
	["ReadAuthenticationSubjectFromValue", "SubjectReadFailure"],
	["DefineAuthenticationRecordProperty", "PropertyDefinitionFailure"],
	["MakeAuthenticationStringArray", "AuthenticationConstructionFailure"],
	["MakeAuthenticationPermissionRecordObject", "AuthenticationConstructionFailure"],
	["MakeAuthenticationPermissionRecordsObject", "AuthenticationConstructionFailure"],
	["MakeAuthenticationStateObject", "AuthenticationConstructionFailure"],
];
const g_vecAuthFailureBoundaryCallbackNames = [
	"ReloadAuthenticationCallback",
	"GetAuthenticationPlayersCallback",
	"GetAuthenticationParentsCallback",
	"GetAuthenticationPlayerCallback",
	"GetAuthenticationParentCallback",
	"HasAuthenticationPlayerPermissionCallback",
	"HasAuthenticationParentPermissionCallback",
	"AddAuthenticationPlayerPermissionCallback",
	"RemoveAuthenticationPlayerPermissionCallback",
	"AddAuthenticationPlayerParentCallback",
	"RemoveAuthenticationPlayerParentCallback",
	"AddAuthenticationParentPermissionCallback",
	"RemoveAuthenticationParentPermissionCallback",
	"AddAuthenticationParentInheritanceCallback",
	"RemoveAuthenticationParentInheritanceCallback",
	"SaveAuthenticationCallback",
	"GetAuthenticationSQLStateFilePathCallback",
	"ReloadAuthenticationSQLCallback",
	"GetAuthenticationSQLPlayersCallback",
	"GetAuthenticationSQLParentsCallback",
	"GetAuthenticationSQLPlayerCallback",
	"GetAuthenticationSQLParentCallback",
	"HasAuthenticationSQLPlayerPermissionCallback",
	"HasAuthenticationSQLParentPermissionCallback",
	"AddAuthenticationSQLPlayerPermissionCallback",
	"RemoveAuthenticationSQLPlayerPermissionCallback",
	"AddAuthenticationSQLPlayerParentCallback",
	"RemoveAuthenticationSQLPlayerParentCallback",
	"AddAuthenticationSQLParentPermissionCallback",
	"RemoveAuthenticationSQLParentPermissionCallback",
	"AddAuthenticationSQLParentInheritanceCallback",
	"RemoveAuthenticationSQLParentInheritanceCallback",
	"SaveAuthenticationSQLCallback",
	"ExportFlatAuthenticationStateToSQLCallback",
	"ImportAuthenticationSQLStateToFlatFilesCallback",
];
const g_vecAuthenticationInstallationContracts = [
	{ Name: "InstallAuthenticationFunctions", MethodCount: 17 },
	{ Name: "InstallAuthenticationSQLFunctions", MethodCount: 21 },
];

const g_strAuthenticationConversionFailureGuard = [
	"\t\t\tif (AuthenticationOperationFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()) {",
	"\t\t\t\tRethrowV8InstallationFailure(pIsolate, AuthenticationOperationFailure, kAuthenticationCallbackErrorMessage);",
	"\t\t\t\treturn;",
	"\t\t\t}",
	"",
].join("\n");

function GetDefinitionRegion(strName, bRecord, strSource) {
	const vecDefinition = new RegExp("^(\\t{1,2})[^\\t\\n]*\\b" + strName + (bRecord ? " \\{$" : "\\([^\\n]*\\)(?: noexcept)? \\{$"), "m").exec(strSource);
	g_Assert(vecDefinition, "Missing native definition: " + strName);

	const strEnd = "\n" + vecDefinition[1] + (bRecord ? "};" : "}");
	const nEnd = strSource.indexOf(strEnd, vecDefinition.index);
	g_Assert(nEnd > vecDefinition.index, "Missing native definition end: " + strName);

	return { Start: vecDefinition.index, End: nEnd + strEnd.length, Indentation: vecDefinition[1] };
}

function GetDefinition(strName, bRecord = false, strSource = g_strSource) {
	const Region = GetDefinitionRegion(strName, bRecord, strSource);

	// Keep the generated/native contract view stable without hiding source mutations.
	return strSource.slice(Region.Start, Region.End).split("\n").map(strLine => strLine.startsWith(Region.Indentation) ? "\t" + strLine.slice(Region.Indentation.length) : strLine).join("\n");
}

function ReplaceDefinition(strName, strBody) {
	const Region = GetDefinitionRegion(strName, false, g_strSource);
	const strReplacement = strBody.split("\n").map(strLine => strLine.startsWith("\t") ? Region.Indentation + strLine.slice(1) : strLine).join("\n");

	return g_strSource.slice(0, Region.Start) + strReplacement + g_strSource.slice(Region.End);
}

function CheckAuthLoadContracts(strSource) {
	const unExpectedBackendGuardCount = 17;

	for (const vecContract of g_vecAuthNativeUnwindContracts) {
		const Pattern = new RegExp("} catch \\(\\.\\.\\.\\) \\{\\n\\t+if \\(" + vecContract[1] + "\\.HasCaught\\(\\)\\) \\{\\n\\t+" + vecContract[1] + "\\.ReThrow\\(\\);\\n\\t+}\\n\\n\\t+throw;\\n\\t+}");
		g_Assert.match(GetDefinition(vecContract[0], false, strSource), Pattern, "Preserve the original JavaScript error during native unwinding: " + vecContract[0]);
	}

	const strArrayReader = GetDefinition("ReadAuthenticationStringArrayProperty", false, strSource);
	g_Assert.match(strArrayReader, /bool ReadAuthenticationStringArrayProperty\(/);
	g_Assert.match(strArrayReader, /std::vector<std::string> vecReadValues = vecValuesOut;/);
	g_Assert.match(strArrayReader, /PropertyReadFailure\.HasCaught\(\) \|\| pIsolate->IsExecutionTerminating\(\) \|\| pIsolate->HasPendingException\(\)/);
	g_Assert.match(strArrayReader, /vecValuesOut = std::move\(vecReadValues\);\n\n\t+return true;/);
	g_Assert.doesNotMatch(strArrayReader, /AddUniqueAuthenticationValue\(vecValuesOut,/);

	const strJSONReader = GetDefinition("LoadAuthenticationJSONRecords", false, strSource);
	g_Assert.match(strJSONReader, /bool LoadAuthenticationJSONRecords\(/);
	g_Assert.match(strJSONReader, /v8::TryCatch JSONReadFailure\(pIsolate\);/);
	g_Assert(strJSONReader.indexOf("v8::TryCatch JSONReadFailure(pIsolate);") < strJSONReader.indexOf("MakeString(pIsolate, strTrimmedText)"));
	g_Assert.match(strJSONReader, /std::map<std::string, AuthenticationPermissionRecord> mapLoadedRecords = mapRecordsOut;/);
	g_Assert.match(strJSONReader, /strRecordName = ValueToString\(pIsolate, LocalPropertyName\);\n\t+if \(JSONReadFailure\.HasCaught\(\) \|\| pIsolate->IsExecutionTerminating\(\) \|\| pIsolate->HasPendingException\(\)\)/);
	g_Assert.match(strJSONReader, /if \(!ReadAuthenticationStringArrayProperty\([^\n]+\) \|\| !ReadAuthenticationStringArrayProperty\([^\n]+\)\) \{\n\t+RethrowV8InstallationFailure\(pIsolate, JSONReadFailure, nullptr\);\n\t+return false;/);
	g_Assert.match(strJSONReader, /mapRecordsOut = std::move\(mapLoadedRecords\);\n\n\t+return true;/);

	const strSimpleReader = GetDefinition("LoadSimpleAuthenticationFile", false, strSource);
	g_Assert.match(strSimpleReader, /SimpleAuthenticationInputStream\.bad\(\) \|\| \(SimpleAuthenticationInputStream\.fail\(\) && !SimpleAuthenticationInputStream\.eof\(\)\)/);
	g_Assert.match(strSimpleReader, /StateOut\.m_vecSimpleAdministrators = std::move\(vecSimpleAdministrators\);\n\n\t\treturn true;/);

	for (const strLoaderName of ["LoadAuthenticationState", "LoadAuthenticationSQLState"]) {
		const strLoader = GetDefinition(strLoaderName, false, strSource);
		g_Assert.match(strLoader, /AuthenticationStateRecord& StateOut\)/);
		g_Assert.match(strLoader, /StateOut = std::move\(Loaded(?:Authentication)?State\);\n\n\t+return true;/);
	}

	const vecFlatGuards = [...strSource.matchAll(/^(\t+)AuthenticationStateRecord AuthenticationState \{\};\n\1if \(!LoadAuthenticationState\(pIsolate, LocalContext, pRuntime, AuthenticationState\)\) \{\n(?:\1\tRethrowV8InstallationFailure\(pIsolate, AuthenticationOperationFailure, kAuthenticationCallbackErrorMessage\);\n)?\1\treturn;\n\1\}\n\n/gm)];
	const vecSQLGuards = [...strSource.matchAll(/^(\t+)AuthenticationStateRecord AuthenticationState \{\};\n\1if \(!LoadAuthenticationSQLState\(pRuntime, AuthenticationState\)\) \{\n\1\t(?:ThrowError\((?:pIsolate|CallbackInformation\.GetIsolate\(\)), kAuthenticationSQLStateLoadErrorMessage\)|RethrowV8InstallationFailure\(pIsolate, AuthenticationOperationFailure, kAuthenticationSQLStateLoadErrorMessage\));\n\1\treturn;\n\1\}\n\n/gm)];
	g_Assert.equal(vecFlatGuards.length, unExpectedBackendGuardCount, "Every native flat-file caller must stop before reading or saving partial state.");
	g_Assert.equal(vecSQLGuards.length, unExpectedBackendGuardCount, "Every native SQL-dump caller must stop before reading or saving partial state.");
	g_Assert.doesNotMatch(strSource, /AuthenticationStateRecord(?: const)? AuthenticationState = LoadAuthentication(?:SQL)?State\(/);
}

function CheckAuthCallbackContracts(strSource) {
	const strStateLoader = GetDefinition("LoadAuthenticationState", false, strSource);
	g_Assert.match(strStateLoader, /v8::TryCatch AuthenticationStateLoadFailure\(pIsolate\);/);
	g_Assert.match(strStateLoader, /RethrowV8InstallationFailure\(pIsolate, AuthenticationStateLoadFailure, kAuthenticationStateLoadErrorMessage\);\n\t+return false;/);

	const strSubjectReader = GetDefinition("ReadAuthenticationSubjectFromValue", false, strSource);
	g_Assert.match(strSubjectReader, /std::string& strSubjectOut/);
	g_Assert.equal([...strSubjectReader.matchAll(/SubjectReadFailure\.HasCaught\(\) \|\| pIsolate->IsExecutionTerminating\(\) \|\| pIsolate->HasPendingException\(\)/g)].length, 3);
	g_Assert.match(strSubjectReader, /strSubjectOut = std::move\(strReadSubject\);\n\n\t+return true;/);
	g_Assert.doesNotMatch(strSource, /\bGetAuthSubjectFromValue\(/);

	const strPropertyWriter = GetDefinition("DefineAuthenticationRecordProperty", false, strSource);
	g_Assert.match(strPropertyWriter, /strvPropertyName\.size\(\) > kMaximumV8StringLength/);
	g_Assert.match(strPropertyWriter, /static_cast<int>\(strvPropertyName\.size\(\)\)/);
	g_Assert.match(strPropertyWriter, /CreateDataProperty\(LocalContext, LocalPropertyName, LocalValue\)/);
	g_Assert.match(strPropertyWriter, /MaybeDefinitionResult\.IsNothing\(\) \|\| !MaybeDefinitionResult\.FromJust\(\)/);

	for (const strFactoryName of ["MakeAuthenticationStringArray", "MakeAuthenticationPermissionRecordObject", "MakeAuthenticationPermissionRecordsObject", "MakeAuthenticationStateObject"]) {
		const strFactory = GetDefinition(strFactoryName, false, strSource);
		g_Assert.match(strFactory, /v8::TryCatch AuthenticationConstructionFailure\(pIsolate\);/);
		g_Assert.match(strFactory, /RethrowV8InstallationFailure\(pIsolate, AuthenticationConstructionFailure, nullptr\);/);
		g_Assert.doesNotMatch(strFactory, /PermissionRecordEntry\.first\.c_str\(\)|->Set\(|\bSetValue\(|\bSetString\(/);
	}

	for (const strCallbackName of g_vecAuthFailureBoundaryCallbackNames) {
		const strCallback = GetDefinition(strCallbackName, false, strSource);
		g_Assert.match(strCallback, /v8::TryCatch AuthenticationOperationFailure\(pIsolate\);\n\t\ttry \{/);
		g_Assert.match(strCallback, /catch \(std::exception const&\) \{\n\t\t\tRethrowV8InstallationFailure\(pIsolate, AuthenticationOperationFailure, kAuthenticationCallbackErrorMessage\);/);
		g_Assert.match(strCallback, /catch \(\.\.\.\) \{\n\t\t\tRethrowV8InstallationFailure\(pIsolate, AuthenticationOperationFailure, kAuthenticationCallbackErrorMessage\);/);

		if (/LoadAuthenticationState\(/.test(strCallback)) {
			g_Assert.match(strCallback, /if \(!LoadAuthenticationState\([^\n]+\) \{\n\t\t\t\tRethrowV8InstallationFailure\(pIsolate, AuthenticationOperationFailure, kAuthenticationCallbackErrorMessage\);\n\t\t\t\treturn;/);
		}

		if (/LoadAuthenticationSQLState\(/.test(strCallback)) {
			g_Assert.match(strCallback, /if \(!LoadAuthenticationSQLState\([^\n]+\) \{\n\t\t\t\tRethrowV8InstallationFailure\(pIsolate, AuthenticationOperationFailure, kAuthenticationSQLStateLoadErrorMessage\);\n\t\t\t\treturn;/);
		}

		if (/ReadAuthenticationSubjectFromValue\(/.test(strCallback)) {
			g_Assert.match(strCallback, /if \([^\n]*!ReadAuthenticationSubjectFromValue\([^\n]+\) \{\n\t\t\t\tRethrowV8InstallationFailure\(pIsolate, AuthenticationOperationFailure, kAuthenticationCallbackErrorMessage\);\n\t\t\t\treturn;/);
		}

		for (const vecConstructionGuard of strCallback.matchAll(/^\t{3}if \(LocalAuth[^\n]+\.IsEmpty\(\)\) \{\n/gm)) {
			g_Assert.match(strCallback.slice(vecConstructionGuard.index + vecConstructionGuard[0].length), /^\t{4}RethrowV8InstallationFailure\(pIsolate, AuthenticationOperationFailure, kAuthenticationCallbackErrorMessage\);\n\t{4}return;/);
		}

		const vecConversions = [...strCallback.matchAll(/^\t{3}std::string const str\w+ = [^\n]*\bValueToString\([^\n]+;\n/gm)];
		g_Assert.equal(vecConversions.length, [...strCallback.matchAll(/\bValueToString\(/g)].length);
		for (const vecConversion of vecConversions) {
			g_Assert(strCallback.startsWith(g_strAuthenticationConversionFailureGuard, vecConversion.index + vecConversion[0].length), strCallbackName + ": every conversion must stop before the next operation.");
		}
	}

	for (const Contract of g_vecAuthenticationInstallationContracts) {
		const strInstaller = GetDefinition(Contract.Name, false, strSource);
		g_Assert.equal([...strInstaller.matchAll(/\bSetRecordFunction\(/g)].length, Contract.MethodCount);
		g_Assert.doesNotMatch(strInstaller, /\bSetFunction\(/);
	}

	const strTraversal = GetDefinition("DoesAuthenticationPermissionRecordHavePermission", false, strSource);
	g_Assert.equal([...strTraversal.matchAll(/DoesAuthenticationPermissionRecordHavePermission\(/g)].length, 1, "No recursive parent traversal.");
	g_Assert.match(strTraversal, /vecTraversalFrames\.push_back\(\{ &itParentRecord->second, 0 \}\);/);
	g_Assert.match(strTraversal, /ContainsAuthenticationValue\(vecVisitedParentNamesOut, strParentName\)/);
}

function RunCommand(strCommand, vecArguments) {
	const unCommandTimeoutMilliseconds = 120_000;
	const Result = g_ChildProcess.spawnSync(strCommand, vecArguments, {
		cwd: g_strProjectRoot,
		encoding: "utf8",
		windowsHide: true,
		timeout: unCommandTimeoutMilliseconds,
	});
	g_Assert.equal(Result.error, undefined, strCommand + ": " + Result.error?.message);
	g_Assert.equal(Result.status, 0, strCommand + ": " + Result.stdout + Result.stderr);
}

function RunNativeProbe(strBinary, strDataRoot, bExpectSuccess) {
	const unProbeTimeoutMilliseconds = 10_000;
	const Result = g_ChildProcess.spawnSync(strBinary, [strDataRoot], {
		encoding: "utf8",
		windowsHide: true,
		timeout: unProbeTimeoutMilliseconds,
	});
	g_Assert.equal(Result.error, undefined, Result.error?.message);

	if (bExpectSuccess) {
		g_Assert.equal(Result.status, 0, Result.stdout + Result.stderr);
		g_Assert.match(Result.stdout, /AuthTextFiles real native IO passed/);

	} else {
		g_Assert.equal(Result.status, 1, "The negative native regression must fail its scenario, not crash or time out.");
		g_Assert.match(Result.stderr, /AuthTextFiles failed Scenario=/);
	}

	return Result;
}

function Run() {
	CheckAuthLoadContracts(g_strSource);
	CheckAuthCallbackContracts(g_strSource);

	for (const vecContract of g_vecAuthNativeUnwindContracts) {
		const strDefinition = GetDefinition(vecContract[0]);
		g_Assert.equal(ReplaceDefinition(vecContract[0], strDefinition), g_strSource, "The normalized contract view must round-trip exactly.");
		const Pattern = new RegExp("if \\(" + vecContract[1] + "\\.HasCaught\\(\\)\\) \\{\\n\\t+" + vecContract[1] + "\\.ReThrow\\(\\);\\n\\t+}\\n\\n\\t+throw;");
		const vecGuard = Pattern.exec(strDefinition);
		g_Assert(vecGuard, "Locate the native-unwind guard control: " + vecContract[0]);
		const strMutatedSource = ReplaceDefinition(vecContract[0], strDefinition.replace(vecGuard[0], "throw;"));
		g_Assert.notEqual(strMutatedSource, g_strSource, "The control must mutate actual source.");
		g_Assert.throws(() => CheckAuthLoadContracts(strMutatedSource), g_Assert.AssertionError);
	}

	for (const strRequiredGuard of [
		"PropertyReadFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()",
		"JSONReadFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()",
		"v8::TryCatch JSONReadFailure(pIsolate);",
		"SimpleAuthenticationInputStream.bad() || (SimpleAuthenticationInputStream.fail() && !SimpleAuthenticationInputStream.eof())",
		"if (!LoadAuthenticationState(pIsolate, LocalContext, pRuntime, AuthenticationState))",
		"if (!LoadAuthenticationSQLState(pRuntime, AuthenticationState))",
	]) {
		g_Assert(g_strSource.includes(strRequiredGuard));
		g_Assert.throws(() => CheckAuthLoadContracts(g_strSource.replaceAll(strRequiredGuard, "false")), g_Assert.AssertionError);
	}

	for (const strRequiredContract of [
		"v8::TryCatch AuthenticationStateLoadFailure(pIsolate);",
		"v8::TryCatch AuthenticationOperationFailure(pIsolate);",
		"catch (std::exception const&)",
		"catch (...)",
		"SubjectReadFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()",
		"static_cast<int>(strvPropertyName.size())",
		"CreateDataProperty(LocalContext, LocalPropertyName, LocalValue)",
		"v8::TryCatch AuthenticationConstructionFailure(pIsolate);",
		"ContainsAuthenticationValue(vecVisitedParentNamesOut, strParentName)",
	]) {
		g_Assert(g_strSource.includes(strRequiredContract));
		g_Assert.throws(() => CheckAuthCallbackContracts(g_strSource.replaceAll(strRequiredContract, "false")), g_Assert.AssertionError);
	}

	for (const strCallbackName of g_vecAuthFailureBoundaryCallbackNames) {
		const strDefinition = GetDefinition(strCallbackName);
		g_Assert.equal(ReplaceDefinition(strCallbackName, strDefinition), g_strSource, "Callback contract views must round-trip exactly.");
		const strWithoutFrame = strDefinition.replace("v8::TryCatch AuthenticationOperationFailure(pIsolate);", "");
		g_Assert.notEqual(strWithoutFrame, strDefinition);
		const strWithoutFrameSource = ReplaceDefinition(strCallbackName, strWithoutFrame);
		g_Assert.notEqual(strWithoutFrameSource, g_strSource);
		g_Assert.throws(() => CheckAuthCallbackContracts(strWithoutFrameSource), g_Assert.AssertionError);

		for (const vecConversion of strDefinition.matchAll(/^\t{3}std::string const str\w+ = [^\n]*\bValueToString\([^\n]+;\n/gm)) {
			const unGuardStart = vecConversion.index + vecConversion[0].length;
			g_Assert(strDefinition.startsWith(g_strAuthenticationConversionFailureGuard, unGuardStart));
			const strWithoutGuard = strDefinition.slice(0, unGuardStart) + strDefinition.slice(unGuardStart + g_strAuthenticationConversionFailureGuard.length);
			const strWithoutGuardSource = ReplaceDefinition(strCallbackName, strWithoutGuard);
			g_Assert.notEqual(strWithoutGuardSource, g_strSource);
			g_Assert.throws(() => CheckAuthCallbackContracts(strWithoutGuardSource), g_Assert.AssertionError);
		}
	}

	for (const Contract of g_vecAuthenticationInstallationContracts) {
		const strInstaller = GetDefinition(Contract.Name);
		const strRegressedInstaller = strInstaller.replaceAll("SetRecordFunction(", "SetFunction(");
		g_Assert.notEqual(strRegressedInstaller, strInstaller);
		const strRegressedSource = ReplaceDefinition(Contract.Name, strRegressedInstaller);
		g_Assert.throws(() => CheckAuthCallbackContracts(strRegressedSource), g_Assert.AssertionError);
	}

	const strBuildRoot = g_Path.join(g_strProjectRoot, "build");
	g_FileSystem.mkdirSync(strBuildRoot, { recursive: true });

	// This generated family has a unique, freshly created root. Never reuse user fixture files.
	const strRoot = g_FileSystem.mkdtempSync(g_Path.join(strBuildRoot, "native-auth-text-files-"));
	try {
		const strDataRoot = g_Path.join(strRoot, "data");
		const strBinaryRoot = g_Path.join(strRoot, "binary");
		const strGeneratedHeader = g_Path.join(strRoot, "AuthTextFiles.generated.h");
		g_FileSystem.mkdirSync(strDataRoot);
		const vecDefinitions = [
			GetDefinition("AuthenticationPermissionRecord", true),
			GetDefinition("AuthenticationStateRecord", true),
			GetDefinition("ContainsAuthenticationValue"),
			GetDefinition("AddUniqueAuthenticationValue"),
			GetDefinition("TrimAuthenticationText"),
			GetDefinition("ReadAuthenticationTextFile"),
			GetDefinition("WriteAuthenticationTextFile"),
			GetDefinition("EscapeAuthenticationJSONText"),
			GetDefinition("WriteAuthenticationJSONStringArray"),
			GetDefinition("WriteAuthenticationJSONRecords"),
			GetDefinition("EscapeAuthenticationSQLText"),
			GetDefinition("QuoteAuthenticationSQLValue"),
			GetDefinition("ConvertAuthenticationSQLToLowercase"),
			GetDefinition("DoesAuthenticationSQLStartWith"),
			GetDefinition("WriteAuthenticationSQLSingleColumnInsert"),
			GetDefinition("WriteAuthenticationSQLTwoColumnInsert"),
			GetDefinition("WriteAuthenticationSQLRecordRelations"),
			GetDefinition("MakeAuthenticationSQLText"),
			GetDefinition("ParseAuthenticationSQLStatements"),
			GetDefinition("ExtractAuthenticationSQLInsertTableName"),
			GetDefinition("ParseAuthenticationSQLValues"),
			GetDefinition("ApplyAuthenticationSQLInsert"),
			GetDefinition("DoesAuthenticationWildcardPatternMatch"),
			GetDefinition("DoesAnyAuthenticationPermissionPatternMatch"),
			GetDefinition("AuthenticationPermissionTraversalFrame", true),
			GetDefinition("DoesAuthenticationPermissionRecordHavePermission"),
			GetDefinition("DoesAuthenticationPlayerHavePermission"),
			GetDefinition("DoesAuthenticationParentHavePermission"),
		];
		const strGeneratedSource = [
			"#pragma once",
			"",
			"// Generated only: extracted current native helpers, not a hand-maintained mock.",
			"// C++",
			"#include <cstddef>",
			"#include <utility>",
			"",
			"// STL",
			"#include <cctype>",
			"#include <filesystem>",
			"#include <fstream>",
			"#include <map>",
			"#include <sstream>",
			"#include <string>",
			"#include <string_view>",
			"#include <vector>",
			"",
			"namespace SourceJSAuthTextFiles {",
			vecDefinitions.join("\n\n"),
			"} // namespace SourceJSAuthTextFiles",
			"",
		].join("\n");
		const strFixture = g_Path.join(g_strProjectRoot, "tools", "fixtures", "AuthTextFiles.cpp").replace(/\\/g, "/");
		const strInclude = strRoot.replace(/\\/g, "/");
		g_Assert.doesNotMatch(strFixture + strInclude, /[$";\n\r]/, "Unsupported CMake path.");
		const strCMake = [
			"# Generated only: native auth-file regression project.",
			"cmake_minimum_required(VERSION 3.20)",
			"project(SourceJSAuthTextFiles LANGUAGES CXX)",
			'add_executable(AuthTextFiles "' + strFixture + '")',
			'target_include_directories(AuthTextFiles PRIVATE "' + strInclude + '")',
			"target_compile_features(AuthTextFiles PRIVATE cxx_std_20)",
			"if(MSVC)",
			"\ttarget_compile_options(AuthTextFiles PRIVATE /W4 /WX)",
			"else()",
			"\ttarget_compile_options(AuthTextFiles PRIVATE -Wall -Wextra -Wpedantic -Werror)",
			"endif()",
			"",
		].join("\n");
		const strLookupFragment = g_Path.join(strRoot, "AuthSubjectLookup.generated.inc");
		const strLookupSource = "// Generated implementation fragment; fixture supplies controlled SDK-shaped dependencies.\n" + GetDefinition("ResolveAuthenticationPlayerNetworkIDFromIndex") + "\n";
		g_FileSystem.writeFileSync(strLookupFragment, strLookupSource);
		g_FileSystem.writeFileSync(strGeneratedHeader, strGeneratedSource);
		g_FileSystem.writeFileSync(g_Path.join(strRoot, "CMakeLists.txt"), strCMake);
		const vecConfigureArguments = ["-S", strRoot, "-B", strBinaryRoot];
		if (process.platform === "win32") {
			vecConfigureArguments.push("-G", "Visual Studio 17 2022", "-A", (process.arch === "arm64") ? "ARM64" : ((process.arch === "ia32") ? "Win32" : "x64"));
		} else {
			vecConfigureArguments.push("-DCMAKE_BUILD_TYPE=Release");
		}

		RunCommand("cmake", vecConfigureArguments);

		const vecBuildArguments = ["--build", strBinaryRoot, "--config", "Release", "--parallel", "2"];
		RunCommand("cmake", vecBuildArguments);

		const strBinary = (process.platform === "win32") ? g_Path.join(strBinaryRoot, "Release", "AuthTextFiles.exe") : g_Path.join(strBinaryRoot, "AuthTextFiles");
		const Probe = RunNativeProbe(strBinary, strDataRoot, true);
		process.stdout.write(Probe.stdout);

		const strPlayerRangeGuard = "if (!pGlobalVariables || (nPlayerIndex > pGlobalVariables->maxClients))";
		const vecLookupControls = [
			{ Name: "missing player bound", Before: strPlayerRangeGuard, After: "if (!pGlobalVariables)", Failure: /auth subject rejects non-player indices before SDK lookup/ },
			{ Name: "strict player bound", Before: strPlayerRangeGuard, After: "if (!pGlobalVariables || (nPlayerIndex >= pGlobalVariables->maxClients))", Failure: /last auth player lookup/ },
			{ Name: "missing globals rejection", Before: strPlayerRangeGuard, After: "if (pGlobalVariables && (nPlayerIndex > pGlobalVariables->maxClients))", Failure: /auth subject missing player globals/ },
			{ Name: "missing free edict rejection", Before: "if (!pPlayerEdict || pPlayerEdict->IsFree())", After: "if (!pPlayerEdict)", Failure: /auth subject free player edict/ },
		];
		for (const Control of vecLookupControls) {
			g_Assert.equal(strLookupSource.split(Control.Before).length, 2, Control.Name);
			g_FileSystem.writeFileSync(strLookupFragment, strLookupSource.replace(Control.Before, Control.After));
			RunCommand("cmake", vecBuildArguments);
			g_Assert.match(RunNativeProbe(strBinary, strDataRoot, false).stderr, Control.Failure);
		}

		g_FileSystem.writeFileSync(strLookupFragment, strLookupSource);
		process.stdout.write("AuthTextFiles player lookup: current body and four compiled negative controls passed; controlled SDK dependencies only.\n");

		g_Assert(strGeneratedSource.includes("if (!InputFile)"));
		g_FileSystem.writeFileSync(strGeneratedHeader, strGeneratedSource.replace("if (!InputFile)", "if (false)"));
		RunCommand("cmake", vecBuildArguments);
		g_Assert.match(RunNativeProbe(strBinary, strDataRoot, false).stderr, /missing read preserves output/);

		const strLengthAwareMatch = "DoesAuthenticationWildcardPatternMatch(strPermissionPattern, strPermission)";
		g_Assert(strGeneratedSource.includes(strLengthAwareMatch));
		g_FileSystem.writeFileSync(strGeneratedHeader, strGeneratedSource.replace(strLengthAwareMatch, "DoesAuthenticationWildcardPatternMatch(strPermissionPattern.c_str(), strPermission.c_str())"));
		RunCommand("cmake", vecBuildArguments);
		g_Assert.match(RunNativeProbe(strBinary, strDataRoot, false).stderr, /wildcard embedded null wrapper/);

		const strSQLQuote = "return \"'\" + EscapeAuthenticationSQLText(strValue) + \"'\";";
		g_Assert(strGeneratedSource.includes(strSQLQuote));
		g_FileSystem.writeFileSync(strGeneratedHeader, strGeneratedSource.replace(strSQLQuote, "return \"'\" + strValue + \"'\";"));
		RunCommand("cmake", vecBuildArguments);
		g_Assert.match(RunNativeProbe(strBinary, strDataRoot, false).stderr, /SQL dump bytes order escaping and schema/);

		if (process.platform === "linux") {
			const strReadGuard = "InputFile.bad() || (InputFile.fail() && !InputFile.eof())";
			g_Assert(strGeneratedSource.includes(strReadGuard));
			g_FileSystem.writeFileSync(strGeneratedHeader, strGeneratedSource.replace(strReadGuard, "false"));
			RunCommand("cmake", vecBuildArguments);
			g_Assert.match(RunNativeProbe(strBinary, strDataRoot, false).stderr, /directory read preserves output/);

			g_Assert(strGeneratedSource.includes("OutputFile.close();"));
			g_FileSystem.writeFileSync(strGeneratedHeader, strGeneratedSource.replace("OutputFile.close();", ""));
			RunCommand("cmake", vecBuildArguments);
			g_Assert.match(RunNativeProbe(strBinary, strDataRoot, false).stderr, /late-write error/);
		}

		g_FileSystem.writeFileSync(strGeneratedHeader, strGeneratedSource);

		RunCommand("cmake", vecBuildArguments);
		RunNativeProbe(strBinary, strDataRoot, true);
	} finally {
		const strCanonicalRoot = g_FileSystem.realpathSync(strRoot);
		const strCanonicalBuildRoot = g_FileSystem.realpathSync(strBuildRoot);
		g_Assert.equal(g_Path.dirname(strCanonicalRoot), strCanonicalBuildRoot);
		g_Assert(g_Path.basename(strCanonicalRoot).startsWith("native-auth-text-files-"));
		g_Assert.equal(strCanonicalRoot, g_Path.join(strCanonicalBuildRoot, g_Path.basename(strRoot)));

		g_FileSystem.rmSync(strCanonicalRoot, { recursive: true });
	}

	console.log("[smoke] Native auth IO, SQL codec, wildcard, inheritance and source-only V8 callback contracts passed; temporary fixture cleaned");
}

Run();
