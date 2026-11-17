#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

if ((process.argv.length === 3) && ["--help", "-h"].includes(process.argv[2])) {
	console.log("Usage: node tools/smoke_player_iterator_native_contracts.js\nChecks player-iterator source contracts and negative regressions; does not execute V8 or the engine.");
	process.exit(0);
}

if (process.argv.length !== 2) {
	console.error("Usage: node tools/smoke_player_iterator_native_contracts.js\nNo arguments are accepted except --help or -h.");
	process.exit(2);
}

const g_strSource = g_FileSystem.readFileSync(g_Path.join(__dirname, "..", "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
let g_unRegressionCount = 0;

function ExtractFunction(strSource, strSignature) {
	const strEscapedSignature = strSignature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const vecDefinitionMatch = new RegExp("^(\\t+)" + strEscapedSignature + "[^\\n;{}]*\\)(?: noexcept)?(?: try)? \\{", "m").exec(strSource);
	g_Assert.ok(vecDefinitionMatch, "Missing player-iterator definition: " + strSignature);

	const strIndentation = vecDefinitionMatch[1];
	const unSignatureStart = vecDefinitionMatch.index + strIndentation.length;
	const nDefinitionEnd = strSource.indexOf("\n" + strIndentation + "}\n", unSignatureStart);
	g_Assert.ok(nDefinitionEnd > unSignatureStart, "Missing player-iterator definition end: " + strSignature);

	return strSource.slice(unSignatureStart, nDefinitionEnd);
}

function AssertExtractorContracts() {
	// The prototypes deliberately test rejection at one- and two-tab indentation.
	for (const strIndentation of ["\t", "\t\t"]) {
		const strPrototype = strIndentation + "void PlayerIteratorExtractorProbe();\n";
		const strDefinitionBody = "void PlayerIteratorExtractorProbe() {\n" + strIndentation + "\treturn;";
		g_Assert.equal(ExtractFunction(strPrototype + strIndentation + strDefinitionBody + "\n" + strIndentation + "}\n", "void PlayerIteratorExtractorProbe("), strDefinitionBody);
		g_Assert.throws(() => ExtractFunction(strPrototype, "void PlayerIteratorExtractorProbe("), g_Assert.AssertionError);
	}
}

function AssertIteratorContracts(strSource) {
	const strIndexReader = ExtractFunction(strSource, "bool GetEntityIndexFromValue(");
	g_Assert.match(strIndexReader, /if \(IndexTryCatch\.HasCaught\(\)\) \{\s*IndexTryCatch\.ReThrow\(\);\s*return false;/);
	g_Assert.ok(strIndexReader.indexOf("nEntityIndexOut = nEntityIndex;") > strIndexReader.indexOf("IndexTryCatch.ReThrow();"));

	const strCollector = ExtractFunction(strSource, "bool CollectPlayerEntityIndices(");
	g_Assert.ok(!strCollector.includes("void AddUniqueRecipientEntityIndex("));
	g_Assert.ok(strCollector.includes("(pEdict && !pEdict->IsFree()) ?"));
	g_Assert.ok(strCollector.includes("for (std::size_t unEntityIndex"));
	g_Assert.ok(strCollector.includes("static_cast<int>(unEntityIndex)"));

	const strPlayersArray = ExtractFunction(strSource, "v8::Local<v8::Array> MakePlayersArray(");
	g_Assert.ok(strPlayersArray.includes("constexpr std::size_t kFirstPlayerEntityIndex = 1;"));
	g_Assert.ok(strPlayersArray.includes("for (std::size_t unEntityIndex = kFirstPlayerEntityIndex; unEntityIndex <= static_cast<std::size_t>(std::max(pGlobalVariables->maxClients, 0)); ++unEntityIndex)"));
	g_Assert.ok(strPlayersArray.includes("const int nEntityIndex = static_cast<int>(unEntityIndex);"));

	const strArrayCollector = ExtractFunction(strSource, "bool CollectRecipientEntityIndicesFromArray(");
	g_Assert.match(strArrayCollector, /if \(!LocalRecipientArray->Get\(LocalContext, unRecipientIndex\)\.ToLocal\(&LocalRecipientValue\)\) \{\s*return false;/);
	g_Assert.ok(strArrayCollector.includes("std::vector<int> vecRecipientEntityIndices = vecRecipientEntityIndicesOut;"));
	g_Assert.ok(strArrayCollector.includes("AddUniqueRecipientEntityIndex(vecRecipientEntityIndices, nEntityIndex, bIncludeBots);"));
	g_Assert.ok(strArrayCollector.includes("vecRecipientEntityIndicesOut = std::move(vecRecipientEntityIndices);"));
	g_Assert.match(strArrayCollector, /if \(!GetEntityIndexFromValue\([^\n]+\)\) \{\s*return false;/);

	const strValueCollector = ExtractFunction(strSource, "bool CollectRecipientEntityIndicesFromValue(");
	g_Assert.match(strValueCollector, /if \(LocalRecipientIndexesName\.IsEmpty\(\)\) \{\s*return false;/);
	g_Assert.match(strValueCollector, /if \(!GetEntityIndexFromValue\([^\n]+\)\) \{\s*return false;/);

	for (const strSignature of ["void ChangePlayerTeamCallback(", "void GetPlayerDictionaryValueCallback(", "void DoesPlayerDictionaryContainKeyCallback("]) {
		const strCallback = ExtractFunction(strSource, strSignature);
		g_Assert.match(strCallback, /if \(!GetEntityIndexFromValue\([^\n]+\)\) \{\s*return;/);
		g_Assert.ok(!strCallback.includes("GetValueIndex("));
	}

	const strIndexArray = ExtractFunction(strSource, "v8::Local<v8::Array> MakeEntityIndexArray(");
	g_Assert.ok(strIndexArray.includes("kMaximumEntityIndexCount"));
	g_Assert.ok(strIndexArray.includes("LocalContext.IsEmpty()"));
	g_Assert.ok(strIndexArray.includes("LocalEntityIndexArray->CreateDataProperty("));
	g_Assert.ok(!strIndexArray.includes("LocalEntityIndexArray->Set("));

	const strPlayerArray = ExtractFunction(strSource, "v8::Local<v8::Array> MakePlayerArrayFromEntityIndices(");
	g_Assert.ok(strPlayerArray.includes("LocalContext.IsEmpty()"));
	g_Assert.match(strPlayerArray, /if \(LocalPlayer\.IsEmpty\(\)\) \{\s*return \{\};/);
	g_Assert.ok(strPlayerArray.includes("LocalPlayerArray->CreateDataProperty(LocalContext, unOutputIndex, LocalPlayer)"));
	g_Assert.equal((strPlayerArray.match(/return LocalPlayerArray;/g) ?? []).length, 1);

	const strFilter = ExtractFunction(strSource, "v8::Local<v8::Object> MakeRecipientFilterObject(");
	g_Assert.equal((strFilter.match(/SetRecordProperty\(/g) ?? []).length, 3);
	g_Assert.ok(!strFilter.includes("SetValue(") && !strFilter.includes("SetInteger("));

	const strDictionary = ExtractFunction(strSource, "void GetAllPlayerDictionaryEntriesCallback(");
	g_Assert.equal((strDictionary.match(/SetRecordProperty\(/g) ?? []).length, 2);
	g_Assert.ok(!strDictionary.includes("SetValue(") && !strDictionary.includes("SetInteger("));

	const strEntries = ExtractFunction(strSource, "void GetPlayerDictionaryEntriesCallback(");
	g_Assert.equal((strEntries.match(/->CreateDataProperty\(/g) ?? []).length, 3);
	g_Assert.equal((strEntries.match(/continue;/g) ?? []).length, 1);
	g_Assert.match(strEntries, /if \(LocalEntryPair\.IsEmpty\(\)\) \{\s*return;/);
	g_Assert.match(strEntries, /if \(LocalPlayer\.IsEmpty\(\)\) \{\s*return;/);
	g_Assert.ok(!strEntries.includes("->Set("));
}

function AssertRegression(strSignature, strOriginal, strReplacement) {
	const strOwner = ExtractFunction(g_strSource, strSignature);
	g_Assert.ok(strOwner.includes(strOriginal), strOriginal);
	g_Assert.equal(g_strSource.indexOf(strOwner), g_strSource.lastIndexOf(strOwner), "Player-iterator regression requires one actual definition: " + strSignature);

	const strChangedOwner = strOwner.replace(strOriginal, () => strReplacement);
	g_Assert.notEqual(strChangedOwner, strOwner, "Player-iterator regression must change its definition: " + strOriginal);

	const strChangedSource = g_strSource.replace(strOwner, () => strChangedOwner);
	g_Assert.notEqual(strChangedSource, g_strSource, "Player-iterator regression must reach the actual source: " + strSignature);
	g_Assert.throws(() => AssertIteratorContracts(strChangedSource), g_Assert.AssertionError, strOriginal);
	++g_unRegressionCount;
}

AssertExtractorContracts();

AssertIteratorContracts(g_strSource);

AssertRegression("bool GetEntityIndexFromValue(", "if (IndexTryCatch.HasCaught())", "if (false)");
AssertRegression("bool GetEntityIndexFromValue(", "IndexTryCatch.ReThrow();", "IndexTryCatch.Reset();");
AssertRegression("bool CollectPlayerEntityIndices(", "(pEdict && !pEdict->IsFree()) ?", "pEdict ?");
AssertRegression("bool CollectPlayerEntityIndices(", "for (std::size_t unEntityIndex", "for (int unEntityIndex");

AssertRegression("v8::Local<v8::Array> MakePlayersArray(", "constexpr std::size_t kFirstPlayerEntityIndex = 1;", "constexpr int kFirstPlayerEntityIndex = 1;");
AssertRegression("v8::Local<v8::Array> MakePlayersArray(", "for (std::size_t unEntityIndex", "for (int unEntityIndex");
AssertRegression("v8::Local<v8::Array> MakePlayersArray(", "std::max(pGlobalVariables->maxClients, 0)", "pGlobalVariables->maxClients");
AssertRegression("v8::Local<v8::Array> MakePlayersArray(", "const int nEntityIndex = static_cast<int>(unEntityIndex);", "const int nEntityIndex = 0;");
AssertRegression("bool CollectRecipientEntityIndicesFromArray(", "vecRecipientEntityIndices = vecRecipientEntityIndicesOut;", "vecRecipientEntityIndices {};");
AssertRegression("bool CollectRecipientEntityIndicesFromArray(", "AddUniqueRecipientEntityIndex(vecRecipientEntityIndices,", "AddUniqueRecipientEntityIndex(vecRecipientEntityIndicesOut,");
AssertRegression("bool CollectRecipientEntityIndicesFromArray(", "vecRecipientEntityIndicesOut = std::move(vecRecipientEntityIndices);", "");
AssertRegression("bool CollectRecipientEntityIndicesFromArray(", "GetEntityIndexFromValue(", "UncheckedEntityIndex(");
AssertRegression("bool CollectRecipientEntityIndicesFromValue(", "if (LocalRecipientIndexesName.IsEmpty())", "if (false)");
AssertRegression("bool CollectRecipientEntityIndicesFromValue(", "GetEntityIndexFromValue(", "UncheckedEntityIndex(");

for (const strSignature of ["void ChangePlayerTeamCallback(", "void GetPlayerDictionaryValueCallback(", "void DoesPlayerDictionaryContainKeyCallback("]) {
	AssertRegression(strSignature, "GetEntityIndexFromValue(", "UncheckedEntityIndex(");
}

AssertRegression("v8::Local<v8::Array> MakeEntityIndexArray(", "LocalEntityIndexArray->CreateDataProperty(", "LocalEntityIndexArray->Set(");
AssertRegression("v8::Local<v8::Array> MakePlayerArrayFromEntityIndices(", "if (LocalPlayer.IsEmpty())", "if (false)");
AssertRegression("v8::Local<v8::Array> MakePlayerArrayFromEntityIndices(", "LocalPlayerArray->CreateDataProperty(", "LocalPlayerArray->Set(");
AssertRegression("v8::Local<v8::Object> MakeRecipientFilterObject(", "SetRecordProperty(", "SetValue(");
AssertRegression("void GetAllPlayerDictionaryEntriesCallback(", "SetRecordProperty(", "SetValue(");
AssertRegression("void GetPlayerDictionaryEntriesCallback(", "LocalEntryPair->CreateDataProperty(", "LocalEntryPair->Set(");
AssertRegression("void GetPlayerDictionaryEntriesCallback(", "LocalEntryArray->CreateDataProperty(", "LocalEntryArray->Set(");
AssertRegression("void GetPlayerDictionaryEntriesCallback(", "if (LocalPlayer.IsEmpty())", "if (false)");
AssertRegression("void GetPlayerDictionaryEntriesCallback(", "if (LocalEntryPair.IsEmpty())", "if (false)");

console.log("[smoke] Player iterator source contracts, " + g_unRegressionCount + " negative regressions and extractor controls passed; source-only checks do not execute V8 or the engine");
