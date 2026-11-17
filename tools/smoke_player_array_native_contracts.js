#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

if ((process.argv.length === 3) && ["--help", "-h"].includes(process.argv[2])) {
	console.log("Usage: node tools/smoke_player_array_native_contracts.js\nChecks player-array source contracts and negative regressions; does not execute V8 or the engine.");
	process.exit(0);
}

if (process.argv.length !== 2) {
	console.error("Usage: node tools/smoke_player_array_native_contracts.js\nNo arguments are accepted except --help or -h.");
	process.exit(2);
}

const g_strSource = g_FileSystem.readFileSync(g_Path.join(__dirname, "..", "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
let g_unRegressionCount = 0;

function ExtractFunction(strSource, strSignature) {
	const strEscapedSignature = strSignature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const vecDefinitionMatch = new RegExp("\\n\\t\\t" + strEscapedSignature + "[^\\n;{}]*\\)(?: noexcept)?(?: try)? \\{").exec(strSource);
	g_Assert.ok(vecDefinitionMatch, "Missing player definition: " + strSignature);

	const nDefinitionStart = vecDefinitionMatch.index;
	const nDefinitionEnd = strSource.indexOf("\n\t\t}\n", nDefinitionStart);
	g_Assert.ok(nDefinitionEnd > nDefinitionStart, "Missing player definition end: " + strSignature);

	return strSource.slice(nDefinitionStart, nDefinitionEnd);
}

function AssertExtractorContracts() {
	// The prototype is deliberately invalid input for definition extraction.
	const strPrototype = "\n\t\tvoid PlayerArrayExtractorProbe();\n";
	const strDefinitionBody = "\n\t\tvoid PlayerArrayExtractorProbe() {\n\t\t\treturn;";
	g_Assert.equal(ExtractFunction(strPrototype + strDefinitionBody + "\n\t\t}\n", "void PlayerArrayExtractorProbe("), strDefinitionBody);
	g_Assert.throws(() => ExtractFunction(strPrototype, "void PlayerArrayExtractorProbe("), g_Assert.AssertionError);
}

function AssertPlayerContracts(strSource) {
	const strArray = ExtractFunction(strSource, "v8::Local<v8::Array> MakePlayersArray(");
	g_Assert.ok(!strArray.includes("void GetAllPlayersCallback("));
	g_Assert.match(strArray, /if \(!pIsolate \|\| LocalContext\.IsEmpty\(\)\) \{\s*return \{\};/);
	g_Assert.match(strArray, /if \(!pPlayerInformationManager\) \{\s*return \{\};/);
	g_Assert.match(strArray, /if \(!pGlobalVariables\) \{\s*return \{\};/);
	g_Assert.ok(strArray.includes("(pEdict && !pEdict->IsFree()) ? pPlayerInformationManager->GetPlayerInfo(pEdict) : nullptr"));
	g_Assert.match(strArray, /if \(LocalPlayer\.IsEmpty\(\)\) \{\s*return \{\};/);
	g_Assert.ok(strArray.includes("LocalArray->CreateDataProperty(LocalContext, unOutputIndex, LocalPlayer).FromMaybe(false)"));
	g_Assert.ok(!strArray.includes("LocalArray->Set("));
	g_Assert.equal((strArray.match(/return LocalArray;/g) ?? []).length, 1);

	for (const strCallbackName of ["GetAllPlayersCallback", "GetHumanPlayersCallback", "GetBotPlayersCallback", "GetPlayersByTeamCallback"]) {
		const strCallback = ExtractFunction(strSource, "void " + strCallbackName + "(");
		g_Assert.match(strCallback, /if \(LocalPlayers\.IsEmpty\(\)\) \{\s*return;/);
		g_Assert.ok(strCallback.indexOf("if (LocalPlayers.IsEmpty())") < strCallback.indexOf("CallbackInformation.GetReturnValue().Set(LocalPlayers)"));
	}

	const strPlayer = ExtractFunction(strSource, "void GetPlayerCallback(");
	g_Assert.match(strPlayer, /if \(LocalPlayer\.IsEmpty\(\)\) \{\s*return;/);
	g_Assert.ok(strPlayer.indexOf("if (LocalPlayer.IsEmpty())") < strPlayer.indexOf("CallbackInformation.GetReturnValue().Set(LocalPlayer)"));
}

function AssertRegression(strSignature, strOriginal, strReplacement) {
	const strOwner = ExtractFunction(g_strSource, strSignature);
	g_Assert.ok(strOwner.includes(strOriginal), strOriginal);
	g_Assert.equal(g_strSource.indexOf(strOwner), g_strSource.lastIndexOf(strOwner), "Player regression requires one actual definition: " + strSignature);

	const strChangedOwner = strOwner.replace(strOriginal, () => strReplacement);
	g_Assert.notEqual(strChangedOwner, strOwner, "Player regression must change its definition: " + strOriginal);

	const strChangedSource = g_strSource.replace(strOwner, () => strChangedOwner);
	g_Assert.notEqual(strChangedSource, g_strSource, "Player regression must reach the actual source: " + strSignature);
	g_Assert.throws(() => AssertPlayerContracts(strChangedSource), g_Assert.AssertionError, strOriginal);
	++g_unRegressionCount;
}

AssertExtractorContracts();

AssertPlayerContracts(g_strSource);

AssertRegression("v8::Local<v8::Array> MakePlayersArray(", "!pIsolate || LocalContext.IsEmpty()", "false");
AssertRegression("v8::Local<v8::Array> MakePlayersArray(", "if (!pPlayerInformationManager)", "if (false)");
AssertRegression("v8::Local<v8::Array> MakePlayersArray(", "if (!pGlobalVariables)", "if (false)");
AssertRegression("v8::Local<v8::Array> MakePlayersArray(", "pEdict && !pEdict->IsFree()", "pEdict");
AssertRegression("v8::Local<v8::Array> MakePlayersArray(", "if (LocalPlayer.IsEmpty())", "if (false)");
AssertRegression("v8::Local<v8::Array> MakePlayersArray(", "LocalArray->CreateDataProperty(", "LocalArray->Set(");
AssertRegression("v8::Local<v8::Array> MakePlayersArray(", "return {};", "return LocalArray;");

for (const strCallbackName of ["GetAllPlayersCallback", "GetHumanPlayersCallback", "GetBotPlayersCallback", "GetPlayersByTeamCallback"]) {
	AssertRegression("void " + strCallbackName + "(", "if (LocalPlayers.IsEmpty())", "if (false)");
}

AssertRegression("void GetPlayerCallback(", "if (LocalPlayer.IsEmpty())", "if (false)");

console.log("[smoke] Player array source contracts, " + g_unRegressionCount + " negative regressions and extractor controls passed; source-only checks do not execute V8 or the engine");
