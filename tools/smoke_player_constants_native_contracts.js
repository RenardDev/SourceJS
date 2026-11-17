#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

if ((process.argv.length === 3) && ["--help", "-h"].includes(process.argv[2])) {
	console.log("Usage: node tools/smoke_player_constants_native_contracts.js\nChecks player-constant and recipient source contracts; does not execute V8 or build SDK targets.");
	process.exit(0);
}

if (process.argv.length !== 2) {
	console.error("Usage: node tools/smoke_player_constants_native_contracts.js\nNo arguments are accepted except --help or -h.");
	process.exit(2);
}

const g_strSource = g_FileSystem.readFileSync(g_Path.join(__dirname, "..", "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
let g_unRegressionCount = 0;

function FindFunctionDefinitionStart(strSource, strSignature) {
	const strEscapedSignature = strSignature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const vecDefinitionMatch = new RegExp("\\n\\t\\t" + strEscapedSignature + "[^\\n;{}]*\\)(?: noexcept)?(?: try)? \\{").exec(strSource);
	g_Assert.ok(vecDefinitionMatch, "Missing player definition: " + strSignature);

	return vecDefinitionMatch.index;
}

function ExtractFunction(strSource, strSignature) {
	const unDefinitionStart = FindFunctionDefinitionStart(strSource, strSignature);
	const nDefinitionEnd = strSource.indexOf("\n\t\t}\n", unDefinitionStart + 1);
	g_Assert.ok(nDefinitionEnd > unDefinitionStart, "Missing player definition end: " + strSignature);

	return strSource.slice(unDefinitionStart + 1, nDefinitionEnd);
}

function ExtractConstantsPrefix(strSource) {
	const strPrefixEnd = 'if (!SetRecordProperty(pIsolate, LocalContext, LocalPlayerConstantsModule, "PlayerAnimation", LocalPlayerAnimationConstants)) {\n\t\t\t\treturn false;\n\t\t\t}';
	const unDefinitionStart = FindFunctionDefinitionStart(strSource, "bool InstallPlayerConstants(");
	const nPrefixEnd = strSource.indexOf(strPrefixEnd, unDefinitionStart);
	g_Assert.ok(nPrefixEnd > unDefinitionStart, "Missing reviewed player constants prefix end");

	return strSource.slice(unDefinitionStart, nPrefixEnd + strPrefixEnd.length);
}

function AssertExtractorContracts() {
	// These prototypes are deliberate negative fixtures, not project declarations.
	const strPrototype = "\n\t\tvoid PlayerConstantsExtractorProbe();\n";
	const strDefinitionBody = "\t\tvoid PlayerConstantsExtractorProbe() {\n\t\t\treturn;";
	g_Assert.equal(ExtractFunction(strPrototype + "\n" + strDefinitionBody + "\n\t\t}\n", "void PlayerConstantsExtractorProbe("), strDefinitionBody);
	g_Assert.throws(() => ExtractFunction(strPrototype, "void PlayerConstantsExtractorProbe("), g_Assert.AssertionError);
	g_Assert.throws(() => ExtractConstantsPrefix("\n\t\tbool InstallPlayerConstants();\n"), g_Assert.AssertionError);
}

function AssertPlayerContracts(strSource) {
	for (const strSignature of ["void GetRecipientsByTeamCallback(", "void CreateRecipientFilterFromPlayerCallback(", "void CreateRecipientFilterFromValuesCallback("]) {
		const strCallback = ExtractFunction(strSource, strSignature);
		g_Assert.match(strCallback, /if \(\(CallbackInformation.Length\(\) > kIncludeBotsArgumentIndex\) && !CallbackInformation\[kIncludeBotsArgumentIndex\]->IsBoolean\(\)\) \{\s*ThrowError\(pIsolate, kIncludeBotsError\);\s*return;/);
		g_Assert.match(strCallback, /if \(LocalRecipientFilter.IsEmpty\(\)\) \{\s*return;/);
		g_Assert.ok(!strCallback.includes("BooleanValue("));
	}

	const strTeam = ExtractFunction(strSource, "void GetRecipientsByTeamCallback(");
	g_Assert.match(strTeam, /if \(!GetTeamNumberFromValue\([^\n]+\)\) \{\s*ThrowError\(pIsolate, strErrorMessage.c_str\(\)\);\s*return;/);
	g_Assert.match(strTeam, /if \(!CollectPlayerEntityIndices\([^\n]+\)\) \{\s*return;/);

	const strMembership = ExtractFunction(strSource, "void DoesRecipientFilterContainRecipientCallback(");
	g_Assert.match(strMembership, /if \(!GetEntityIndexFromValue\(pIsolate, LocalContext, CallbackInformation\[kRecipientValueArgumentIndex\], nEntityIndex\)\) \{\s*return;/);
	g_Assert.ok(!strMembership.includes("GetValueIndex("));

	const nCollectionIndex = strMembership.indexOf("!CollectRecipientEntityIndicesFromValue(");
	const nResolutionIndex = strMembership.indexOf("!GetEntityIndexFromValue(");
	g_Assert.ok((nCollectionIndex >= 0) && (nResolutionIndex > nCollectionIndex), "Recipient collection must exist before entity resolution");

	const strResolution = ExtractFunction(strSource, "void ResolveRecipientPlayersCallback(");
	g_Assert.match(strResolution, /if \(LocalRecipientPlayers.IsEmpty\(\)\) \{\s*return;/);

	for (const strSignature of ["bool InstallPlayerButtonConstants(", "bool InstallPlayerLifeStateConstants("]) {
		const strInstaller = ExtractFunction(strSource, strSignature);
		g_Assert.equal((strInstaller.match(/SetRecordProperty\(/g) ?? []).length, 2);
		g_Assert.ok(!strInstaller.includes("SetInteger("));
		g_Assert.match(strInstaller, /if \(!SetRecordProperty\([^\n]+\)\) \{\s*return false;/);
		g_Assert.match(strInstaller, /return SetRecordProperty\([^\n]+\);/);
	}

	const strEngine = ExtractFunction(strSource, "bool InstallPlayerEngineFunctions(");
	g_Assert.equal((strEngine.match(/SetRecordFunction\(/g) ?? []).length, 2);
	g_Assert.ok(strEngine.includes('SetRecordProperty(pIsolate, LocalContext, LocalPlayerEngineModule, "Branch", MakeString(pIsolate, SOURCEJS_SDK_BRANCH))'));
	g_Assert.ok(!strEngine.includes("SetFunction(") && !strEngine.includes("SetString("));

	const strPrefix = ExtractConstantsPrefix(strSource);
	g_Assert.ok(!/Set(?:Integer|Value|String)\(/.test(strPrefix));
	g_Assert.equal((strPrefix.match(/SetRecordProperty\(/g) ?? []).length, 64);
	for (const strGroup of ["FixAngle", "PlayerStates", "HideHUDFlags", "HitGroup", "ObserverMode", "PlayerAnimation"]) {
		g_Assert.ok(strPrefix.includes('LocalPlayerConstantsModule, "' + strGroup + '"'));
	}
}

function AssertRegression(strSignature, strOriginal, strReplacement) {
	const strOwner = (strSignature === "prefix") ? ExtractConstantsPrefix(g_strSource) : ExtractFunction(g_strSource, strSignature);
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

for (const strSignature of ["void GetRecipientsByTeamCallback(", "void CreateRecipientFilterFromPlayerCallback(", "void CreateRecipientFilterFromValuesCallback("]) {
	AssertRegression(strSignature, "->IsBoolean()", "->IsNumber()");
	AssertRegression(strSignature, "if (LocalRecipientFilter.IsEmpty())", "if (false)");
}

AssertRegression("void GetRecipientsByTeamCallback(", "if (!GetTeamNumberFromValue(", "if (GetTeamNumberFromValue(");
AssertRegression("void GetRecipientsByTeamCallback(", "if (!CollectPlayerEntityIndices(", "if (CollectPlayerEntityIndices(");
AssertRegression("void DoesRecipientFilterContainRecipientCallback(", "if (!GetEntityIndexFromValue(", "if (GetEntityIndexFromValue(");
AssertRegression("void DoesRecipientFilterContainRecipientCallback(", "!CollectRecipientEntityIndicesFromValue(", "!CollectRecipientEntityIndicesWithoutValidation(");
AssertRegression("void ResolveRecipientPlayersCallback(", "if (LocalRecipientPlayers.IsEmpty())", "if (false)");

for (const strSignature of ["bool InstallPlayerButtonConstants(", "bool InstallPlayerLifeStateConstants("]) {
	AssertRegression(strSignature, "if (!SetRecordProperty(", "if (!SetInteger(");
	AssertRegression(strSignature, "return SetRecordProperty(", "return SetInteger(");
}

AssertRegression("bool InstallPlayerEngineFunctions(", "SetRecordFunction(", "SetFunction(");
AssertRegression("bool InstallPlayerEngineFunctions(", "SetRecordProperty(", "SetString(");
AssertRegression("prefix", "SetRecordProperty(", "SetInteger(");
AssertRegression("prefix", 'LocalPlayerConstantsModule, "PlayerAnimation"', 'LocalPlayerConstantsModule, "LegacyAnimation"');

console.log("[smoke] Player constants/recipient source contracts, " + g_unRegressionCount + " negative regressions and extractor controls passed; source-only checks do not execute V8 or build SDK targets");
