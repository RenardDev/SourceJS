#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

if (process.argv.length > 2) {
	const bHelpRequested = (process.argv.length === 3) && ((process.argv[2] === "--help") || (process.argv[2] === "-h"));
	console[bHelpRequested ? "log" : "error"]("Usage: node tools/smoke_native_argument_errors.js");
	process.exit(bHelpRequested ? 0 : 2);
}

const g_strNativeSource = g_FileSystem.readFileSync(g_Path.join(__dirname, "..", "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_vecConversionSignatures = ["bool GetInt32Argument(", "bool GetNumberArgument(", "bool GetUInt32Argument("];
const g_vecPlayerReceiverSignatures = ["void PlayerKickMethodCallback(", "void PlayerBanMethodCallback(", "void PlayerChangeTeamMethodCallback("];
const g_vecPlayerArgumentSignatures = ["void SetPlayerNameCallback(", "void SendClientCommandCallback(", "void SayCallback(", "void SayToTeamCallback("];
const g_vecCounterStrikePlayerSignatures = ["void PlayersCounterStrikeHasC4MethodCallback(", "void PlayersCounterStrikeSpawnMethodCallback("];

let g_unRejectedRegressionCount = 0;

function ExtractFunction(strSource, strSignature) {
	const strEscapedSignature = strSignature.replace(/[.*+?^${}()|[\]\\]/g, strCharacter => "\\" + strCharacter);
	const DefinitionPattern = new RegExp("^(\\t{1,2})" + strEscapedSignature + "[^\\n]*\\)(?: noexcept)?(?: try)? \\{$", "m");
	const vecDefinitionMatches = DefinitionPattern.exec(strSource);
	g_Assert(vecDefinitionMatches, "Missing native argument definition: " + strSignature);

	const strIndentation = vecDefinitionMatches[1];
	const nDefinitionEnd = strSource.indexOf("\n" + strIndentation + "}\n", vecDefinitionMatches.index);
	g_Assert(nDefinitionEnd > vecDefinitionMatches.index, "Missing native argument definition end: " + strSignature);

	return strSource.slice(vecDefinitionMatches.index, nDefinitionEnd);
}

function AssertNativeArgumentGuards(strSource) {
	for (const strSignature of g_vecConversionSignatures) {
		const strConversion = ExtractFunction(strSource, strSignature);
		g_Assert.match(strConversion, /v8::TryCatch ConversionFailure\(pIsolate\);[\s\S]*if \(ConversionFailure\.HasCaught\(\)\) \{\s*ConversionFailure\.ReThrow\(\);\s*return false;/);
		g_Assert.match(strConversion, /ThrowError\(pIsolate, pszErrorMessage\);\s*ConversionFailure\.ReThrow\(\);\s*return false;/);
	}

	const strDisconnect = ExtractFunction(strSource, "void DisconnectIServerClientCallback(");
	g_Assert.match(strDisconnect, /v8::TryCatch ClientAddressFailure\(pIsolate\);\s*pClient = GetIServerClientFromValue\([\s\S]*if \(ClientAddressFailure\.HasCaught\(\)\) \{\s*ClientAddressFailure\.ReThrow\(\);\s*return;\s*}\s*}\s*if \(!pClient\)/);

	const strTimescale = ExtractFunction(strSource, "void SetIServerTimescaleCallback(");
	g_Assert.match(strTimescale, /if \(!GetNumberArgument\([\s\S]*?\)\) \{\s*return;\s*}/);

	for (const strSignature of g_vecPlayerReceiverSignatures) {
		const strCallback = ExtractFunction(strSource, strSignature);
		g_Assert.match(strCallback, /if \(!ReadEntityIndex\(CallbackInformation, nEntityIndex\)\) \{\s*return;\s*}/);
	}

	for (const strSignature of g_vecPlayerArgumentSignatures) {
		const strCallback = ExtractFunction(strSource, strSignature);
		g_Assert.match(strCallback, /if \(!ReadEntityIndex\(pIsolate, LocalContext, LocalPlayerValue, nPlayerIndex\)\) \{\s*return;\s*}/);
	}

	const strPlayerInformation = ExtractFunction(strSource, "IPlayerInfo* RequirePlayerInformationArgument(");
	g_Assert.match(strPlayerInformation, /if \(!ReadEntityIndex\(pIsolate, LocalContext, CallbackInformation\[kPlayerArgumentIndex\], nEntityIndex\)\) \{\s*return nullptr;\s*}\s*return RequirePlayerInformationFromIndex/);

	const strServerFromAddress = ExtractFunction(strSource, "void GetEngineServerFromAddressCallback(");
	g_Assert.match(strServerFromAddress, /v8::TryCatch AddressFailure\(pIsolate\);\s*pEngineServer = GetIServerFromValue\([\s\S]*if \(AddressFailure\.HasCaught\(\)\) \{\s*AddressFailure\.ReThrow\(\);\s*return;\s*}\s*}\s*if \(!pEngineServer\)/);

	for (const strSignature of g_vecCounterStrikePlayerSignatures) {
		const strCallback = ExtractFunction(strSource, strSignature);
		g_Assert.match(strCallback, /if \(!ReadEntityIndex\(CallbackInformation, nPlayerEntityIndex\)\) \{\s*return;\s*}/);
	}

	g_Assert.doesNotMatch(strSource, /int GetEntityIndexFromCallbackThis\(/);
}

AssertNativeArgumentGuards(g_strNativeSource);

const g_vecConversionRegressions = [
	["if (ConversionFailure.HasCaught())", "if (false)"],
	["ConversionFailure.ReThrow();\n\t\t\t\t\treturn false;", "return false;"],
	["ThrowError(pIsolate, pszErrorMessage);\n\t\t\t\tConversionFailure.ReThrow();", "ThrowError(pIsolate, pszErrorMessage);"],
];

function AssertRegression(strSignature, strOriginal, strReplacement) {
	const strOwner = ExtractFunction(g_strNativeSource, strSignature);
	g_Assert.equal(strOwner.split(strOriginal).length, 2, strSignature + strOriginal);
	g_Assert.equal(g_strNativeSource.split(strOwner).length, 2, "Unique native argument owner: " + strSignature);

	const strMutatedOwner = strOwner.replace(strOriginal, () => strReplacement);
	g_Assert.notEqual(strMutatedOwner, strOwner, "The argument regression must change its owner.");

	const strMutatedSource = g_strNativeSource.replace(strOwner, () => strMutatedOwner);
	g_Assert.notEqual(strMutatedSource, g_strNativeSource, "The argument regression must change actual source.");
	g_Assert.throws(() => AssertNativeArgumentGuards(strMutatedSource), g_Assert.AssertionError, strSignature + strOriginal);
	++g_unRejectedRegressionCount;
}

for (const strSignature of g_vecConversionSignatures) {
	for (const vecRegression of g_vecConversionRegressions) {
		AssertRegression(strSignature, vecRegression[0], vecRegression[1]);
	}
}

AssertRegression("void DisconnectIServerClientCallback(", "if (ClientAddressFailure.HasCaught())", "if (false)");
AssertRegression("void DisconnectIServerClientCallback(", "ClientAddressFailure.ReThrow();", "");
AssertRegression("void SetIServerTimescaleCallback(", "kTimescaleMessage, dblServerTimescale)) {\n\t\t\t\treturn;", "kTimescaleMessage, dblServerTimescale)) {\n\t\t\t\tThrowError(pIsolate, kTimescaleMessage);\n\t\t\t\treturn;");

for (const strSignature of g_vecPlayerReceiverSignatures) {
	AssertRegression(strSignature, "!ReadEntityIndex(CallbackInformation, nEntityIndex)", "false");
}

for (const strSignature of g_vecPlayerArgumentSignatures) {
	AssertRegression(strSignature, "!ReadEntityIndex(pIsolate, LocalContext, LocalPlayerValue, nPlayerIndex)", "false");
}

AssertRegression("IPlayerInfo* RequirePlayerInformationArgument(", "!ReadEntityIndex(pIsolate, LocalContext, CallbackInformation[kPlayerArgumentIndex], nEntityIndex)", "false");

AssertRegression("void GetEngineServerFromAddressCallback(", "if (AddressFailure.HasCaught())", "if (false)");
AssertRegression("void GetEngineServerFromAddressCallback(", "AddressFailure.ReThrow();", "");

for (const strSignature of g_vecCounterStrikePlayerSignatures) {
	AssertRegression(strSignature, "!ReadEntityIndex(CallbackInformation, nPlayerEntityIndex)", "false");
}

// Extractor-only controls: the prototype and unrelated function are not compiled.
const g_strExtractorProbe = [
	"\tbool ProbeArgument();",
	"\tvoid UnrelatedProbe() {",
	"\t}",
	"\tbool ProbeArgument() {",
	"\t\treturn true;",
	"\t}",
	"",
].join("\n");
g_Assert.equal(ExtractFunction(g_strExtractorProbe, "bool ProbeArgument("), "\tbool ProbeArgument() {\n\t\treturn true;");
g_Assert.throws(() => ExtractFunction("\tbool ProbeArgument();\n", "bool ProbeArgument("), g_Assert.AssertionError);

console.log("[smoke] native argument-error source guards PASS; rejected regressions=" + g_unRejectedRegressionCount + "; native V8 execution not exercised");
