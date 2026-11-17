#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

if ((process.argv.length === 3) && ["--help", "-h"].includes(process.argv[2])) {
	console.log("Usage: node tools/smoke_player_factory.js\nChecks player-factory source contracts and negative regressions; does not execute V8.");
	process.exit(0);
}

if (process.argv.length !== 2) {
	console.error("Usage: node tools/smoke_player_factory.js\nNo arguments are accepted except --help or -h.");
	process.exit(2);
}

const g_strNativeSource = g_FileSystem.readFileSync(g_Path.join(__dirname, "..", "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_vecLiveProperties = ["Name", "UserID", "NetworkID", "RemoteAddress", "Team", "Frags", "Deaths", "Health", "MaximumHealth", "Connected", "FakeClient", "Language", "Dead", "Origin", "Weapon", "Model"];
const g_vecMethods = ["Slay", "ExecuteClientCommand", "SetName", "Say", "SayTeam", "Kick", "Ban", "ChangeTeam", "GiveNamedItem"];
let g_unRejectedRegressionCount = 0;

function ExtractFunction(strSource, strSignature) {
	const strEscapedSignature = strSignature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const vecDefinitionMatch = new RegExp("^\\t\\t" + strEscapedSignature + "[^\\n;{}]*\\)(?: noexcept)?(?: try)? \\{", "m").exec(strSource);
	g_Assert.ok(vecDefinitionMatch, "Missing player-factory definition: " + strSignature);

	const unDefinitionStart = vecDefinitionMatch.index;
	const nDefinitionEnd = strSource.indexOf("\n\t\t}\n", unDefinitionStart);
	g_Assert.ok(nDefinitionEnd > unDefinitionStart, "Missing player-factory definition end: " + strSignature);

	return strSource.slice(unDefinitionStart, nDefinitionEnd);
}

function AssertExtractorContracts() {
	// The prototype is a deliberate negative fixture for definition extraction.
	const strPrototype = "\t\tvoid PlayerFactoryExtractorProbe();\n";
	const strDefinitionBody = "\t\tvoid PlayerFactoryExtractorProbe() {\n\t\t\treturn;";
	g_Assert.equal(ExtractFunction(strPrototype + strDefinitionBody + "\n\t\t}\n", "void PlayerFactoryExtractorProbe("), strDefinitionBody);
	g_Assert.throws(() => ExtractFunction(strPrototype, "void PlayerFactoryExtractorProbe("), g_Assert.AssertionError);
}

function AssertFactoryContracts(strSource) {
	const strInstaller = ExtractFunction(strSource, "bool InstallPlayerLiveProperty(");
	g_Assert.match(strInstaller, /const LocalPropertyName = MakeString\(pIsolate, pszPropertyName\);\s*if \(LocalPropertyName\.IsEmpty\(\)\) \{\s*return false;\s*}/);
	g_Assert.match(strInstaller, /SetNativeDataProperty\(LocalContext, LocalPropertyName, PlayerGetLivePropertyCallback, PlayerSetLiveProperty,/);

	const strFactory = ExtractFunction(strSource, "v8::Local<v8::Object> MakePlayerObject(");
	const vecProperties = Array.from(strFactory.matchAll(/\{ "([^"]+)", PlayerLiveProperty::[^}]+ \}/g), (vecMatch) => vecMatch[1]);
	const vecMethods = Array.from(strFactory.matchAll(/SetFunction\(pIsolate, LocalContext, LocalPlayerObject, "([^"]+)"/g), (vecMatch) => vecMatch[1]);
	g_Assert.deepEqual(vecProperties, g_vecLiveProperties);
	g_Assert.deepEqual(vecMethods, g_vecMethods);
	g_Assert.match(strFactory, /v8::TryCatch PropertyInstallationFailure\(pIsolate\);\s*if \(!InstallPlayerLiveProperty\([\s\S]*?if \(PropertyInstallationFailure\.HasCaught\(\)\) \{\s*PropertyInstallationFailure\.ReThrow\(\);\s*return \{\};/);
	g_Assert.match(strFactory, /ThrowError\(pIsolate, kPropertyInstallationError\);\s*PropertyInstallationFailure\.ReThrow\(\);\s*return \{\};/);
}

function AssertRegression(strSignature, strOriginal, strReplacement) {
	const strOwner = ExtractFunction(g_strNativeSource, strSignature);
	g_Assert.equal(strOwner.split(strOriginal).length, 2, strSignature + strOriginal);
	g_Assert.equal(g_strNativeSource.indexOf(strOwner), g_strNativeSource.lastIndexOf(strOwner), "Player-factory regression requires one actual definition: " + strSignature);

	const strChangedOwner = strOwner.replace(strOriginal, () => strReplacement);
	g_Assert.notEqual(strChangedOwner, strOwner, "Player-factory regression must change its definition: " + strOriginal);

	const strMutatedSource = g_strNativeSource.replace(strOwner, () => strChangedOwner);
	g_Assert.notEqual(strMutatedSource, g_strNativeSource, "Player-factory regression must reach the actual source: " + strSignature);
	g_Assert.throws(() => AssertFactoryContracts(strMutatedSource), g_Assert.AssertionError, strSignature + strOriginal);
	g_unRejectedRegressionCount += 1;
}

AssertExtractorContracts();

AssertFactoryContracts(g_strNativeSource);

AssertRegression("bool InstallPlayerLiveProperty(", "if (LocalPropertyName.IsEmpty())", "if (false)");
AssertRegression("v8::Local<v8::Object> MakePlayerObject(", "if (PropertyInstallationFailure.HasCaught())", "if (false)");
AssertRegression("v8::Local<v8::Object> MakePlayerObject(", "PropertyInstallationFailure.ReThrow();\n\t\t\t\t\t\treturn {};", "return {};");
AssertRegression("v8::Local<v8::Object> MakePlayerObject(", "ThrowError(pIsolate, kPropertyInstallationError);\n\t\t\t\t\tPropertyInstallationFailure.ReThrow();", "ThrowError(pIsolate, kPropertyInstallationError);");
AssertRegression("v8::Local<v8::Object> MakePlayerObject(", "{ \"Team\", PlayerLiveProperty::Team }", "{ \"team\", PlayerLiveProperty::Team }");
AssertRegression("v8::Local<v8::Object> MakePlayerObject(", "LocalPlayerObject, \"SayTeam\",", "LocalPlayerObject, \"sayTeam\",");

console.log("[smoke] player factory source contracts, " + g_unRejectedRegressionCount + " negative regressions and extractor controls passed; source-only checks do not execute V8");
