#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

if (process.argv.length > 2) {
	if ((process.argv.length === 3) && ["--help", "-h"].includes(process.argv[2])) {
		console.log("Usage: node tools/smoke_team_data_native_contracts.js\nChecks source contracts only; does not execute live V8 or engine code.");
		process.exit(0);
	}

	console.error("Usage: node tools/smoke_team_data_native_contracts.js");
	process.exit(2);
}

const g_strSource = g_FileSystem.readFileSync(g_Path.join(__dirname, "..", "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_vecTeamCallbacks = [
	"GetTeamDataCallback",
	"GetTeamClassesByNameCallback",
	"GetTeamClassesByNumberCallback",
	"GetTeamNamesCallback",
	"GetTeamNumbersCallback",
	"GetTeamManagersCallback",
	"GetTeamProfileCallback",
	"GetTeamSupportedBranchesCallback",
	"ChangePlayerTeamCallback",
];

let g_unRegressionCount = 0;

function ExtractFunction(strSource, strSignature, unIndentationLevel = 2) {
	const strIndentation = "\t".repeat(unIndentationLevel);
	const strEscapedSignature = strSignature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const vecDefinitions = [...strSource.matchAll(new RegExp("^" + strIndentation + strEscapedSignature + "[^\\n;{}]*\\)(?: noexcept)?(?: try)? \\{$", "gm"))];
	g_Assert.equal(vecDefinitions.length, 1, "Expected one function definition: " + strSignature);

	const nStart = vecDefinitions[0].index - 1;
	const nEnd = strSource.indexOf("\n" + strIndentation + "}\n", nStart);
	g_Assert.ok((nStart >= 0) && (nEnd > nStart), strSignature);

	return strSource.slice(nStart, nEnd);
}

function AssertFunctionExtraction() {
	for (const unIndentationLevel of [1, 2]) {
		const strIndentation = "\t".repeat(unIndentationLevel);
		const strPrototype = "\n" + strIndentation + "bool Probe(int nValue); // signature marker ) {\n";
		const strUnrelated = strIndentation + "bool Other(int nValue) {\n" + strIndentation + "\treturn Probe(nValue);\n" + strIndentation + "}\n";
		const strBody = strIndentation + "bool Probe(int nValue) noexcept try {\n" + strIndentation + "\treturn nValue > 0;\n" + strIndentation + "} catch (...) {\n" + strIndentation + "\treturn false;";
		const strDefinition = "\n" + strBody + "\n" + strIndentation + "}\n";
		g_Assert.equal(ExtractFunction(strPrototype + strUnrelated + strDefinition, "bool Probe(", unIndentationLevel), "\n" + strBody, "Ignore prototypes and unrelated calls while preserving the function-try block.");

		const strEmptyBody = strIndentation + "bool Probe() {\n" + strIndentation + "\treturn true;";
		const strEmptyDefinition = "\n" + strEmptyBody + "\n" + strIndentation + "}\n";
		g_Assert.equal(ExtractFunction(strEmptyDefinition, "bool Probe(", unIndentationLevel), "\n" + strEmptyBody);
		g_Assert.throws(() => ExtractFunction(strPrototype + strUnrelated, "bool Probe(", unIndentationLevel), { code: "ERR_ASSERTION" });
		g_Assert.throws(() => ExtractFunction(strDefinition + strDefinition, "bool Probe(", unIndentationLevel), { code: "ERR_ASSERTION" });
	}
}

function AssertTeamContracts(strSource) {
	const strNamedMap = ExtractFunction(strSource, "v8::Local<v8::Object> MakePlayerTeamNumbersByName(", 2);
	g_Assert.ok(!strNamedMap.includes("MakePlayerTeamNamesByNumber("));
	g_Assert.match(strNamedMap, /if \(LocalName\.IsEmpty\(\)\) \{\s*return \{\};/);
	g_Assert.ok(strNamedMap.includes("MakeString(pIsolate, TeamNumberEntry.first)"));
	g_Assert.ok(strNamedMap.includes("LocalNumbersByName->CreateDataProperty(LocalContext, LocalName,"));
	g_Assert.ok(!strNamedMap.includes("LocalNumbersByName->Set("));

	const strNumberedMap = ExtractFunction(strSource, "v8::Local<v8::Object> MakePlayerTeamNamesByNumber(");
	g_Assert.match(strNumberedMap, /if \(!v8::Integer::New\(pIsolate, TeamNameEntry\.first\)->ToString\(LocalContext\)\.ToLocal\(&LocalNumber\)\) \{\s*return \{\};/);
	g_Assert.match(strNumberedMap, /if \(LocalName\.IsEmpty\(\)\) \{\s*return \{\};/);
	g_Assert.ok(strNumberedMap.includes("LocalNamesByNumber->CreateDataProperty(LocalContext, LocalNumber, LocalName)"));
	g_Assert.ok(!strNumberedMap.includes("LocalNamesByNumber->Set("));

	const strManagers = ExtractFunction(strSource, "v8::Local<v8::Array> MakePlayerTeamManagerArray(");
	g_Assert.ok(strManagers.includes("vecManagerNames.size() > kMaximumManagerNameCount"));
	g_Assert.match(strManagers, /if \(LocalManagerName\.IsEmpty\(\)\) \{\s*return \{\};/);
	g_Assert.ok(strManagers.includes("LocalManagerNameArray->CreateDataProperty("));
	g_Assert.ok(!strManagers.includes("LocalManagerNameArray->Set("));

	const strData = ExtractFunction(strSource, "void GetTeamDataCallback(");
	g_Assert.equal((strData.match(/SetRecordProperty\(/g) ?? []).length, 5);
	g_Assert.ok(!strData.includes("SetValue("));

	const strBranches = ExtractFunction(strSource, "void GetTeamSupportedBranchesCallback(");
	g_Assert.match(strBranches, /if \(LocalBranchName\.IsEmpty\(\)\) \{\s*return;/);
	g_Assert.ok(strBranches.includes("LocalSupportedBranches->CreateDataProperty("));
	g_Assert.ok(!strBranches.includes("LocalSupportedBranches->Set("));

	for (const strName of g_vecTeamCallbacks) {
		const strCallback = ExtractFunction(strSource, "void " + strName + "(");
		g_Assert.ok(strCallback.includes(") try {"));
		g_Assert.ok(strCallback.includes("ThrowError(CallbackInformation.GetIsolate(), \"" + strName + " failed with a C++ exception.\");"));
	}

	const strProfile = ExtractFunction(strSource, "void GetTeamProfileCallback(");
	g_Assert.match(strProfile, /if \(LocalProfileName\.IsEmpty\(\)\) \{\s*return;/);

	const strIndex = ExtractFunction(strSource, "bool GetEntityIndexFromValue(");
	g_Assert.match(strIndex, /} catch \(\.\.\.\) \{\s*if \(IndexTryCatch\.HasCaught\(\)\) \{\s*IndexTryCatch\.ReThrow\(\);\s*}\s*throw;/);
}

function AssertRegression(strSignature, strOriginal, strReplacement, unIndentationLevel = 2) {
	const strOwner = ExtractFunction(g_strSource, strSignature, unIndentationLevel);
	g_Assert.ok(strOwner.includes(strOriginal), strOriginal);

	// Intentionally invalid source fixtures must change only their owning definition.
	const strChanged = strOwner.replace(strOriginal, () => strReplacement);
	g_Assert.notEqual(strChanged, strOwner, strSignature);

	const strChangedSource = g_strSource.replace(strOwner, () => strChanged);
	g_Assert.notEqual(strChangedSource, g_strSource, strSignature);
	g_Assert.throws(() => AssertTeamContracts(strChangedSource), g_Assert.AssertionError, strOriginal);
	++g_unRegressionCount;
}

AssertFunctionExtraction();
AssertTeamContracts(g_strSource);
AssertRegression("v8::Local<v8::Object> MakePlayerTeamNumbersByName(", "if (LocalName.IsEmpty())", "if (false)", 2);
AssertRegression("v8::Local<v8::Object> MakePlayerTeamNumbersByName(", "MakeString(pIsolate, TeamNumberEntry.first)", "MakeString(pIsolate, TeamNumberEntry.first.c_str())", 2);
AssertRegression("v8::Local<v8::Object> MakePlayerTeamNumbersByName(", "LocalNumbersByName->CreateDataProperty(", "LocalNumbersByName->Set(", 2);
AssertRegression("v8::Local<v8::Object> MakePlayerTeamNamesByNumber(", "->ToString(LocalContext).ToLocal(&LocalNumber)", "->ToString(LocalContext).ToLocal(&IgnoredNumber)");
AssertRegression("v8::Local<v8::Object> MakePlayerTeamNamesByNumber(", "if (LocalName.IsEmpty())", "if (false)");
AssertRegression("v8::Local<v8::Object> MakePlayerTeamNamesByNumber(", "LocalNamesByNumber->CreateDataProperty(", "LocalNamesByNumber->Set(");
AssertRegression("v8::Local<v8::Array> MakePlayerTeamManagerArray(", "vecManagerNames.size() > kMaximumManagerNameCount", "false");
AssertRegression("v8::Local<v8::Array> MakePlayerTeamManagerArray(", "if (LocalManagerName.IsEmpty())", "if (false)");
AssertRegression("v8::Local<v8::Array> MakePlayerTeamManagerArray(", "LocalManagerNameArray->CreateDataProperty(", "LocalManagerNameArray->Set(");
AssertRegression("void GetTeamDataCallback(", "SetRecordProperty(", "SetValue(");
AssertRegression("void GetTeamSupportedBranchesCallback(", "if (LocalBranchName.IsEmpty())", "if (false)");
AssertRegression("void GetTeamSupportedBranchesCallback(", "LocalSupportedBranches->CreateDataProperty(", "LocalSupportedBranches->Set(");

for (const strName of g_vecTeamCallbacks) {
	AssertRegression("void " + strName + "(", ") try {", ") {");
}

AssertRegression("void GetTeamProfileCallback(", "if (LocalProfileName.IsEmpty())", "if (false)");
AssertRegression("bool GetEntityIndexFromValue(", "if (IndexTryCatch.HasCaught()) {\n\t\t\t\t\tIndexTryCatch.ReThrow();\n\t\t\t\t}\n\n\t\t\t\tthrow;", "throw;");

console.log("[smoke] Team data source contracts and " + g_unRegressionCount + " negative regressions passed; native V8/runtime-data execution is a separate check");
