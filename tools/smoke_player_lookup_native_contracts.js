#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

if ((process.argv.length === 3) && ["--help", "-h"].includes(process.argv[2])) {
	console.log("Usage: node tools/smoke_player_lookup_native_contracts.js\nChecks player-lookup source contracts and negative regressions; does not execute V8 or SDK calls.");
	process.exit(0);
}

if (process.argv.length !== 2) {
	console.error("Usage: node tools/smoke_player_lookup_native_contracts.js\nNo arguments are accepted except --help or -h.");
	process.exit(2);
}

const g_strSource = g_FileSystem.readFileSync(g_Path.join(__dirname, "..", "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");

const g_vecPlayerQuerySignatures = [
	"void GetPlayerUserIDFromIndexCallback(",
	"void GetPlayerNameFromIndexCallback(",
	"void GetPlayerNetworkAddressFromIndexCallback(",
	"void GetPlayerNetworkIDFromIndexCallback(",
	"void IsPlayerConnectedByIndexCallback(",
	"void GetPlayerClientCVarValueCallback(",
	"void GetPlayerClientLanguageCallback(",
];

let g_unRegressionCount = 0;

function ExtractFunction(strSource, strSignature) {
	const strEscapedSignature = strSignature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const vecDefinitionMatch = new RegExp("^(\\t{1,2})" + strEscapedSignature + "[^\\n;{}]*\\)(?: noexcept)?(?: try)? \\{", "m").exec(strSource);
	g_Assert.ok(vecDefinitionMatch, "Missing player-lookup definition: " + strSignature);

	const unDefinitionStart = vecDefinitionMatch.index;
	const nDefinitionEnd = strSource.indexOf("\n" + vecDefinitionMatch[1] + "}\n", unDefinitionStart + 1);
	g_Assert.ok(nDefinitionEnd > unDefinitionStart, "Missing player-lookup definition end: " + strSignature);

	return strSource.slice(unDefinitionStart, nDefinitionEnd);
}

function ExtractEntityConstantsPrefix(strSource) {
	const strDefinition = ExtractFunction(strSource, "bool InstallEntityConstants(");
	const nPrefixEnd = strDefinition.indexOf("#if !defined(ENGINE_BRANCH_DARKM)");
	g_Assert.ok(nPrefixEnd > 0, "Missing reviewed entity constants prefix end");

	return strDefinition.slice(0, nPrefixEnd);
}

function AssertExtractorContracts() {
	// Prototypes deliberately test definition selection at both allowed indentation levels.
	for (const strIndentation of ["\t", "\t\t"]) {
		const strPrototype = strIndentation + "void PlayerLookupExtractorProbe();\n";
		const strDefinitionBody = strIndentation + "void PlayerLookupExtractorProbe() {\n" + strIndentation + "\treturn;";
		g_Assert.equal(ExtractFunction(strPrototype + strDefinitionBody + "\n" + strIndentation + "}\n", "void PlayerLookupExtractorProbe("), strDefinitionBody);
		g_Assert.throws(() => ExtractFunction(strPrototype, "void PlayerLookupExtractorProbe("), g_Assert.AssertionError);
	}

	const strConstantsPrototype = "\t\tbool InstallEntityConstants();\n";
	const strConstantsDefinition = "\t\tbool InstallEntityConstants() {\n";
	g_Assert.equal(ExtractEntityConstantsPrefix(strConstantsPrototype + strConstantsDefinition + "#if !defined(ENGINE_BRANCH_DARKM)\n#endif\n\t\t}\n"), strConstantsDefinition);
	g_Assert.throws(() => ExtractEntityConstantsPrefix(strConstantsPrototype), g_Assert.AssertionError);
}

function AssertPlayerLookupContracts(strSource) {
	for (const strSignature of ["int FindPlayerEntityIndex(", "bool GetPlayerEntityIndexFromUserIDValue(", "void GetPlayerIndexFromNetworkIDCallback("]) {
		const strFunction = ExtractFunction(strSource, strSignature);
		g_Assert.ok(strFunction.includes("(pGlobalVariables->maxClients > 0) ? static_cast<std::size_t>(pGlobalVariables->maxClients) : 0"));
		g_Assert.ok(strFunction.includes("for (std::size_t unEntityIndex = kFirstPlayerEntityIndex; unEntityIndex <= unPlayerCount; ++unEntityIndex)"));
		g_Assert.ok(strFunction.includes("static_cast<int>(unEntityIndex)"));
		g_Assert.ok(strFunction.includes("pPlayerInformation->IsConnected()"));
	}

	for (const vecMatcher of [["bool DoesPlayerNameMatch(", "pszName"], ["bool DoesPlayerNetworkIDMatch(", "pszNetworkID"]]) {
		const strFunction = ExtractFunction(strSource, vecMatcher[0]);
		g_Assert.ok(strFunction.includes("if (!pPlayerInformation)"));
		g_Assert.match(strFunction, new RegExp("if \\(!" + vecMatcher[1] + "\\) \\{\\s*return false;"));
	}

	const strUserID = ExtractFunction(strSource, "bool GetPlayerEntityIndexFromUserIDValue(");
	g_Assert.match(strUserID, /if \(!LocalValue->IsInt32\(\)\) \{\s*nEntityIndexOut = kInvalidEntityIndex;\s*return true;/);
	g_Assert.match(strUserID, /if \(!pPlayerInformationManager\) \{\s*return false;/);
	g_Assert.match(strUserID, /if \(!pGlobalVariables\) \{\s*return false;/);
	for (const strSignature of ["void GetPlayerIndexFromUserIDCallback(", "void GetPlayerFromUserIDCallback("]) {
		const strFunction = ExtractFunction(strSource, strSignature);
		g_Assert.match(strFunction, /if \(!GetPlayerEntityIndexFromUserIDValue\([^\n]+, nEntityIndex\)\) \{\s*return;/);
	}

	const strResolver = ExtractFunction(strSource, "bool GetPlayerEntityIndexFromHelperConversionValue(");
	g_Assert.equal((strResolver.match(/nEntityIndexOut/g) ?? []).length, 2);
	g_Assert.match(strResolver, /default:\n\t\t\t\t\treturn false;\n\t\t\t}\n\n\t\t\tnEntityIndexOut = nEntityIndex;\n\n\t\t\treturn true;$/);
	g_Assert.equal((strResolver.match(/case PlayerHelperValue::/g) ?? []).length, 8);
	g_Assert.ok(strResolver.includes('GetEntityHelperRecordUnsignedValue(pIsolate, LocalContext, LocalValue, "baseentity", "Address", unEntityAddress)'));
	g_Assert.ok(strResolver.includes("GetAddressSizedUnsignedIntegerFromValue(LocalValue, unEntityAddress)"));
	g_Assert.ok(strResolver.includes("!GetEntityIndexFromValue(pIsolate, LocalContext, LocalValue, nEntityIndex)"));
	g_Assert.ok(strResolver.includes("!GetPlayerEntityIndexFromUserIDValue(pIsolate, LocalContext, LocalValue, kOperationName, nEntityIndex)"));

	const strConversion = ExtractFunction(strSource, "void ConvertPlayerHelperValueCallback(");
	g_Assert.match(strConversion, /v8::TryCatch ConversionFailure\(pIsolate\);\n\t\t\t\ttry \{\n\t\t\t\t\tif \(!GetPlayerEntityIndexFromHelperConversionValue\([^\n]+\)\) \{\n\t\t\t\t\t\tif \(ConversionFailure\.HasCaught\(\)\) \{\s*ConversionFailure\.ReThrow\(\);\s*return;/);
	g_Assert.ok(strConversion.indexOf("ConversionFailure.HasCaught()") < strConversion.indexOf("ThrowError(pIsolate, kPlayerIndexError)"));
	g_Assert.match(strConversion, /ThrowError\(pIsolate, kPlayerIndexError\);\n\t\t\t\t\t\tConversionFailure\.ReThrow\(\);\n\t\t\t\t\t\treturn;/);
	g_Assert.match(strConversion, /catch \(\.\.\.\) \{\s*if \(ConversionFailure\.HasCaught\(\)\) \{\s*ConversionFailure\.ReThrow\(\);\s*\}\s*throw;/);
	g_Assert.ok(strConversion.includes("const unsigned int unIntegerHandle = static_cast<unsigned int>(BaseHandle.ToInt());"));
	g_Assert.ok(strConversion.includes("CallbackInformation.GetReturnValue().Set(unIntegerHandle);"));
	g_Assert.ok(strConversion.includes("CallbackInformation.GetReturnValue().Set(kInvalidIntegerHandle);"));
	for (const strResult of ["LocalPlayer", "LocalEdict", "LocalBaseEntity", "LocalBaseHandle", "LocalAddressValue"]) {
		g_Assert.ok(strConversion.includes("if (" + strResult + ".IsEmpty())"));
	}

	const strSpawn = ExtractFunction(strSource, "void SpawnPlayerCallback(");
	g_Assert.match(strSpawn, /constexpr char kLiveEntityError\[\] = "players\.SpawnPlayer\(Player, bForce\?\) requires " VSERVERTOOLS_INTERFACE_VERSION " and a live player entity\.";/, "Player spawn errors must use the selected SDK interface version.");
	g_Assert.match(strSpawn, /if \(!GetEntityIndexFromValue\([^\n]+\)\) \{\s*return;/);
	g_Assert.ok(!strSpawn.includes("GetValueIndex("));
	g_Assert.ok(strSpawn.indexOf("GetEntityIndexFromValue(") < strSpawn.indexOf("RequirePlayerInformationFromIndex("));
	g_Assert.match(strSpawn, /pServerTools->DispatchSpawn\(pPlayerEntity\);\n\n\t\t\tCallbackInformation\.GetReturnValue\(\)\.Set\(true\);\n#endif\n\t\t} catch/);

	for (const strName of ["GetPlayerIndexFromUserIDCallback", "GetPlayerFromUserIDCallback", "ConvertPlayerHelperValueCallback", "SpawnPlayerCallback", "GetPlayerIndexFromNameCallback", "GetPlayerIndexFromNetworkIDCallback", "GetEntityCallback", "GetEntityCountCallback", "GetMaximumEntityCountCallback", ...g_vecPlayerQuerySignatures.map(strSignature => strSignature.slice("void ".length, -1))]) {
		const strCallback = ExtractFunction(strSource, "void " + strName + "(");
		g_Assert.ok(strCallback.includes(") try {"));
		g_Assert.ok(strCallback.includes('ThrowError(CallbackInformation.GetIsolate(), "' + strName + ' failed with a C++ exception.");'));
	}

	const strCandidates = ExtractFunction(strSource, "void AddPlayerSteamIDCandidates(");
	g_Assert.ok(strCandidates.includes("SteamID2Stream << \"STEAM_\" << static_cast<int>(SteamID.GetEUniverse())"));
	g_Assert.ok(strCandidates.includes("SteamID64Stream << SteamIDToUInt64(SteamID);"));
	g_Assert.ok(strCandidates.includes("SteamID.GetUnAccountInstance() != kSteamID3ImplicitAccountInstance"));

	const nCandidateIndex = strCandidates.indexOf("AddPlayerNetworkIDCandidate(vecNetworkIDCandidates, strRawSteamID)");
	const nParsingIndex = strCandidates.indexOf("ParseSteamID(");
	g_Assert.ok((nCandidateIndex >= 0) && (nParsingIndex > nCandidateIndex), "Raw SteamID candidate must exist before parsing");

	for (const strSignature of g_vecPlayerQuerySignatures) {
		const strQuery = ExtractFunction(strSource, strSignature);
		g_Assert.ok(strQuery.includes("int nEntityIndex = kInvalidEntityIndex;"));
		g_Assert.match(strQuery, /if \(!GetEntityIndexFromValue\([^\n]+\)\) \{\s*return;/);
		g_Assert.ok(!strQuery.includes("GetValueIndex("));
		g_Assert.ok(strQuery.indexOf("GetEntityIndexFromValue(") < strQuery.indexOf("RequirePlayerInformationFromIndex("));
	}

	const strConstantGroup = ExtractFunction(strSource, "v8::Local<v8::Object> MakeEntityConstantGroup(");
	g_Assert.match(strConstantGroup, /if \(!MaybeLocalNativeValue\.ToLocal\(&LocalNativeValue\)\) \{\s*return \{\};/);
	g_Assert.match(strConstantGroup, /if \(LocalNativeValue->IsUndefined\(\)\) \{\s*continue;/);
	g_Assert.ok(strConstantGroup.includes("SetRecordProperty(pIsolate, LocalContext, LocalEntityConstantGroup,"));
	g_Assert.ok(!strConstantGroup.includes("SetValue("));

	const strGroupInstaller = ExtractFunction(strSource, "bool InstallEntityConstantGroup(");
	g_Assert.ok(strGroupInstaller.includes("return SetRecordProperty(pIsolate, LocalContext, LocalEntityConstants, pszGroupName, LocalEntityConstantGroup);"));

	const strInstallerPrefix = ExtractEntityConstantsPrefix(strSource);
	g_Assert.equal((strInstallerPrefix.match(/SetRecordProperty\(/g) ?? []).length, 8);
	g_Assert.ok(!strInstallerPrefix.includes("SetInteger(") && !strInstallerPrefix.includes("SetNumber("));
	g_Assert.ok(strInstallerPrefix.includes("auto const SetEntityConstant = [pIsolate, LocalContext, LocalNativeConstants](char const* const pszName, const int nValue) -> bool {"));
}

function AssertRegression(strSignature, strOriginal, strReplacement) {
	const strOwner = (strSignature === "prefix") ? ExtractEntityConstantsPrefix(g_strSource) : ExtractFunction(g_strSource, strSignature);
	g_Assert.ok(strOwner.includes(strOriginal), strOriginal);
	g_Assert.equal(g_strSource.indexOf(strOwner), g_strSource.lastIndexOf(strOwner), "Player-lookup regression requires one actual definition: " + strSignature);

	const strChangedOwner = strOwner.replace(strOriginal, () => strReplacement);
	g_Assert.notEqual(strChangedOwner, strOwner, "Player-lookup regression must change its definition: " + strOriginal);

	const strChangedSource = g_strSource.replace(strOwner, () => strChangedOwner);
	g_Assert.notEqual(strChangedSource, g_strSource, "Player-lookup regression must reach the actual source: " + strSignature);
	g_Assert.throws(() => AssertPlayerLookupContracts(strChangedSource), g_Assert.AssertionError, strOriginal);
	++g_unRegressionCount;
}

AssertExtractorContracts();

AssertPlayerLookupContracts(g_strSource);

for (const vecChange of [
	["auto const SetEntityConstant =", "auto SetEntityConstant ="],
	["[pIsolate, LocalContext, LocalNativeConstants]", "[&]"],
	["const int nValue) -> bool {", "const int nValue) {"],
]) {
	AssertRegression("prefix", vecChange[0], vecChange[1]);
}

for (const strSignature of ["int FindPlayerEntityIndex(", "bool GetPlayerEntityIndexFromUserIDValue(", "void GetPlayerIndexFromNetworkIDCallback("]) {
	AssertRegression(strSignature, "std::size_t unEntityIndex =", "int unEntityIndex =");
	AssertRegression(strSignature, "unEntityIndex <= unPlayerCount", "unEntityIndex < unPlayerCount");
}

AssertRegression("bool DoesPlayerNameMatch(", "if (!pszName)", "if (false)");
AssertRegression("bool DoesPlayerNetworkIDMatch(", "if (!pszNetworkID)", "if (false)");
AssertRegression("bool GetPlayerEntityIndexFromUserIDValue(", "!LocalValue->IsInt32()", "!LocalValue->IsNumber()");
AssertRegression("bool GetPlayerEntityIndexFromUserIDValue(", "if (!pPlayerInformationManager)", "if (false)");
AssertRegression("bool GetPlayerEntityIndexFromUserIDValue(", "if (!pGlobalVariables)", "if (false)");

for (const strSignature of ["void GetPlayerIndexFromUserIDCallback(", "void GetPlayerFromUserIDCallback("]) {
	AssertRegression(strSignature, "!GetPlayerEntityIndexFromUserIDValue(", "GetPlayerEntityIndexFromUserIDValue(");
}

AssertRegression("bool GetPlayerEntityIndexFromHelperConversionValue(", "nEntityIndexOut = nEntityIndex;", "nEntityIndexOut = kInvalidEntityIndex;");
AssertRegression("bool GetPlayerEntityIndexFromHelperConversionValue(", '"baseentity", "Address"', '"baseentity", "LegacyAddress"');
AssertRegression("bool GetPlayerEntityIndexFromHelperConversionValue(", "!GetEntityIndexFromValue(", "GetEntityIndexFromValue(");
AssertRegression("void ConvertPlayerHelperValueCallback(", "ConversionFailure.HasCaught()", "false");
AssertRegression("void ConvertPlayerHelperValueCallback(", "ConversionFailure.ReThrow();", "ConversionFailure.Reset();");
AssertRegression("void ConvertPlayerHelperValueCallback(", "static_cast<unsigned int>(BaseHandle.ToInt())", "BaseHandle.ToInt()");
AssertRegression("void ConvertPlayerHelperValueCallback(", "Set(kInvalidIntegerHandle)", "Set(0)");

for (const strResult of ["LocalPlayer", "LocalEdict", "LocalBaseEntity", "LocalBaseHandle", "LocalAddressValue"]) {
	AssertRegression("void ConvertPlayerHelperValueCallback(", "if (" + strResult + ".IsEmpty())", "if (false)");
}

AssertRegression("void SpawnPlayerCallback(", "!GetEntityIndexFromValue(", "GetEntityIndexFromValue(");
AssertRegression("void SpawnPlayerCallback(", "Set(true);\n#endif", "Set(true);");
AssertRegression("void SpawnPlayerCallback(", '" VSERVERTOOLS_INTERFACE_VERSION "', "VSERVERTOOLS001");
AssertRegression("void AddPlayerSteamIDCandidates(", "SteamID64Stream << SteamIDToUInt64(SteamID)", "SteamID64Stream << static_cast<double>(SteamIDToUInt64(SteamID))");
AssertRegression("void AddPlayerSteamIDCandidates(", "AddPlayerNetworkIDCandidate(vecNetworkIDCandidates, strRawSteamID)", "IgnoredPlayerNetworkIDCandidate(vecNetworkIDCandidates, strRawSteamID)");

for (const strName of ["GetPlayerIndexFromUserIDCallback", "GetPlayerFromUserIDCallback", "ConvertPlayerHelperValueCallback", "SpawnPlayerCallback", "GetPlayerIndexFromNameCallback", "GetPlayerIndexFromNetworkIDCallback", "GetEntityCallback", "GetEntityCountCallback", "GetMaximumEntityCountCallback", ...g_vecPlayerQuerySignatures.map(strSignature => strSignature.slice("void ".length, -1))]) {
	AssertRegression("void " + strName + "(", 'ThrowError(CallbackInformation.GetIsolate(), "' + strName + ' failed with a C++ exception.");', "return;");
}

AssertRegression("void ConvertPlayerHelperValueCallback(", "if (ConversionFailure.HasCaught()) {\n\t\t\t\t\t\tConversionFailure.ReThrow();\n\t\t\t\t\t}\n\n\t\t\t\t\tthrow;", "throw;");

for (const strSignature of g_vecPlayerQuerySignatures) {
	AssertRegression(strSignature, "!GetEntityIndexFromValue(", "GetEntityIndexFromValue(");
	AssertRegression(strSignature, "int nEntityIndex = kInvalidEntityIndex;", "int nEntityIndex = 0;");
}

AssertRegression("v8::Local<v8::Object> MakeEntityConstantGroup(", "!MaybeLocalNativeValue.ToLocal(&LocalNativeValue)", "false");
AssertRegression("v8::Local<v8::Object> MakeEntityConstantGroup(", "SetRecordProperty(", "SetValue(");
AssertRegression("v8::Local<v8::Object> MakeEntityConstantGroup(", "LocalNativeValue->IsUndefined()", "LocalNativeValue->IsNullOrUndefined()");
AssertRegression("bool InstallEntityConstantGroup(", "SetRecordProperty(", "SetValue(");

console.log("[smoke] Player lookup source contracts, " + g_unRegressionCount + " negative regressions and extractor controls passed; source-only checks do not execute V8 or SDK calls");
