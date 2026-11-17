#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

if ((process.argv.length === 3) && ["--help", "-h"].includes(process.argv[2])) {
	console.log("Usage: node tools/smoke_players_native_property_contracts.js\nChecks native player-property source guards; does not execute V8, SDK or engine calls.");
	process.exit(0);
}

if (process.argv.length !== 2) {
	console.error("Usage: node tools/smoke_players_native_property_contracts.js\nNo arguments are accepted except --help or -h.");
	process.exit(2);
}

const g_strSource = g_FileSystem.readFileSync(g_Path.resolve(__dirname, "../src/sourcejs/modules/ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");

// These source guards complement native SDK/V8 tests; they do not execute engine calls.
const g_vecContracts = [
	["PlayersGetSendPropertyAddress", "try {"],
	["PlayersGetSendPropertyAddress", "} catch (...) {"],
	["PlayersGetSendPropertyAddress", "sizeof(edict_t), alignof(edict_t)"],
	["PlayersGetSendPropertyAddress", "sizeof(IServerNetworkable), alignof(IServerNetworkable)"],
	["PlayersGetSendPropertyAddress", "sizeof(ServerClass), alignof(ServerClass)"],
	["PlayersGetSendPropertyAddress", "EntityPropertiesIsSendTableStorageValid(pServerClass->m_pTable)"],
	["PlayersGetSendPropertyAddress", "std::numeric_limits<std::uintptr_t>::max() - unBaseEntityAddress"],
	["PlayersGetSendPropertyAddress", "sizeof(char), alignof(char)"],
	["PlayersGetDatamapAddress", "try {"],
	["PlayersGetDatamapAddress", "} catch (...) {"],
	["PlayersGetDatamapAddress", "EntityDatamapsFindFieldInformation(pDatamap, pszPropertyName, FieldInformation)"],
	["PlayersGetDatamapAddress", "std::numeric_limits<std::uintptr_t>::max() - unBaseEntityAddress"],
	["PlayersGetDatamapAddress", "sizeof(char), alignof(char)"],
	["PlayersGetPropertyNamesFromValue", "v8::TryCatch PropertyNamesFailure(pIsolate);"],
	["PlayersGetPropertyNamesFromValue", "LocalPropertyNameValue->ToString(LocalContext).ToLocal(&LocalPropertyNameString)"],
	["PlayersGetPropertyNamesFromValue", "LocalPropertyNamesValue->ToString(LocalContext).ToLocal(&LocalPropertyNameString)"],
	["PlayersGetPropertyNamesFromValue", "PropertyNamesFailure.ReThrow();"],
	["PlayersGetPropertyNamesFromValue", "vecPropertyNamesOut = std::move(vecPropertyNames);"],
	["PlayersResolvePropertyAddress", "char* pchResolvedPropertyAddress = nullptr;"],
	["PlayersResolvePropertyAddress", "std::string strResolvedPropertyName = strPropertyName;"],
	["PlayersResolvePropertyAddress", "strResolvedPropertyNameOut = std::move(strResolvedPropertyName);"],
	["PlayersResolvePropertyAddress", "pchPropertyAddressOut = pchResolvedPropertyAddress;"],
	["PlayersRequirePropertyAddressFromArguments", "v8::TryCatch PlayerResolutionFailure(pIsolate);"],
	["PlayersRequirePropertyAddressFromArguments", "PlayerResolutionFailure.ReThrow();"],
	["PlayersRequirePropertyAddressFromArguments", "v8::TryCatch PropertyNamesFailure(pIsolate);"],
	["PlayersRequirePropertyAddressFromArguments", "PropertyNamesFailure.ReThrow();"],
	["PlayersRequirePropertyAddressFromArguments", "} catch (...) {"],
	["PlayersRequirePropertyAddressFromArguments", "Player property lookup failed with a native C++ exception."],
	["PlayersIsCombatWeapon", "std::vector<datamap_t*> vecVisitedDatamaps {};"],
	["PlayersIsCombatWeapon", "sizeof(datamap_t), alignof(datamap_t)"],
	["PlayersIsCombatWeapon", "if (pVisitedDatamap == pDatamap) {"],
	["PlayersIsCombatWeapon", "vecVisitedDatamaps.push_back(pDatamap);"],
	["PlayersIsCombatWeapon", "} catch (...) {"],
	["DropPlayerWeaponCallback", "v8::TryCatch PlayerResolutionFailure(pIsolate);"],
	["DropPlayerWeaponCallback", "PlayerResolutionFailure.ReThrow();"],
	["DropPlayerWeaponCallback", "v8::TryCatch WeaponResolutionFailure(pIsolate);"],
	["DropPlayerWeaponCallback", "WeaponResolutionFailure.ReThrow();"],
	["DropPlayerWeaponCallback", "} catch (...) {"],
	["DropPlayerWeaponCallback", "DropWeapon failed with a native C++ exception."],
	["PlayersCounterStrikeSetDatamapInteger", "return WriteEntityPropertiesScalarValue(pchPropertyAddress, PropertyValue);"],
	["PlayersCounterStrikeSetIntegerProperty", "return WriteEntityPropertiesScalarValue(pchPropertyAddress, PropertyValue);"],
	["PlayersGetOwnerEntityIndexFromEntity", "static_assert(std::is_standard_layout_v<CBaseHandle>);"],
	["PlayersGetOwnerEntityIndexFromEntity", "(sizeof(CBaseHandle) == sizeof(std::uint32_t)) || (sizeof(CBaseHandle) == sizeof(unsigned long))"],
	["PlayersGetOwnerEntityIndexFromEntity", "std::numeric_limits<unsigned long>::digits >= std::numeric_limits<std::uint32_t>::digits"],
	["PlayersGetOwnerEntityIndexFromEntity", "sizeof(CBaseHandle) > (std::numeric_limits<std::uintptr_t>::max() - unPropertyAddress)"],
	["PlayersGetOwnerEntityIndexFromEntity", "std::memcpy(&unOwnerEntityHandle, pchPropertyAddress, sizeof(unOwnerEntityHandle));"],
	["PlayersGetOwnerEntityIndexFromEntity", "std::memcpy(&unStoredOwnerHandle, pchPropertyAddress, sizeof(unStoredOwnerHandle));"],
	["PlayersGetOwnerEntityIndexFromEntity", "} catch (...) {"],
	["PlayersCounterStrikeSpawnPlayerByIndex", "constexpr char kAliveLifeState = static_cast<char>(LIFE_ALIVE);"],
	["PlayersCounterStrikeSpawnPlayerByIndex", "kLifeStatePropertyName, kAliveLifeState"],
	["PlayersCounterStrikeHasC4MethodCallback", "Player.HasC4 failed with a native C++ exception."],
	["PlayersCounterStrikeSpawnMethodCallback", "Player.Spawn failed with a native C++ exception."],
	["GetCounterStrikePlayerCallback", "PlayerResolutionFailure.ReThrow();"],
	["GetCounterStrikePlayerCallback", "GetPlayer failed with a native C++ exception."],
	["DoesCounterStrikePlayerHaveC4Callback", "PlayerResolutionFailure.ReThrow();"],
	["DoesCounterStrikePlayerHaveC4Callback", "HasC4 failed with a native C++ exception."],
	["PlayersReadEntityHandleStorage", "static_assert(std::is_standard_layout_v<CBaseHandle>);"],
	["PlayersReadEntityHandleStorage", "sizeof(CBaseHandle), alignof(CBaseHandle)"],
	["PlayersReadEntityHandleStorage", "ReadEntityPropertiesScalarValue(pchHandleStorage, unStoredHandleValue)"],
	["PlayersReadEntityHandleStorage", "unHandleOut = static_cast<unsigned int>(unStoredHandle);"],
	["PlayersWriteEntityHandleStorage", "sizeof(CBaseHandle), alignof(CBaseHandle)"],
	["PlayersWriteEntityHandleStorage", "std::memcpy(&unStoredHandle, &Handle, sizeof(unStoredHandle));"],
	["PlayersWriteEntityHandleStorage", "return WriteEntityPropertiesScalarValue(pchHandleStorage, unStoredHandle);"],
	["SpawnCounterStrikePlayerCallback", "ReadEntityIndex(pIsolate, LocalContext, LocalPlayerValue, nPlayerEntityIndex)"],
	["PlayersGetActiveWeaponAddress", "PlayerResolutionFailure.ReThrow();"],
	["GetPlayerActiveWeaponCallback", "PlayersReadEntityHandleStorage(pchActiveWeaponAddress, unActiveWeaponHandle)"],
	["SetPlayerActiveWeaponCallback", "WeaponResolutionFailure.ReThrow();"],
	["SetPlayerActiveWeaponCallback", "const int nWeaponEntityIndex = GetValueIndex(pIsolate, LocalContext, LocalWeaponValue);"],
	["SetPlayerActiveWeaponCallback", "PlayersWriteEntityHandleStorage(pchActiveWeaponAddress, ActiveWeaponHandle)"],
	["GetPlayerWeaponIndicesCallback", "PlayerResolutionFailure.ReThrow();"],
	["GetPlayerWeaponIndicesCallback", "LocalPropertyPrefixValue->ToString(LocalContext).ToLocal(&LocalPropertyPrefixString)"],
	["GetPlayerWeaponIndicesCallback", "PlayersReadEntityHandleStorage(pchWeaponHandleAddress, unWeaponHandle)"],
	["GetPlayerProjectileIndicesCallback", "nPlayerEntityIndex = GetValueIndex(pIsolate, LocalContext, LocalPlayerValue);"],
	["GetPlayerProjectileIndicesCallback", "LocalProjectileClassNameValue->ToString(LocalContext).ToLocal(&LocalProjectileClassNameString)"],
	["PlayersGetIntegerSendPropertyAddress", "PlayerResolutionFailure.ReThrow();"],
	["PlayersGetIntegerSendPropertyAddress", "LocalPropertyValue->ToString(LocalContext).ToLocal(&LocalPropertyNameString)"],
	["GetPlayerProjectileAmmoCallback", "ReadEntityPropertiesScalarValue(pchPropertyAddress, nProjectileAmmo)"],
	["SpawnCounterStrikePlayerCallback", "Spawn failed with a native C++ exception."],
	["SpawnCounterStrikePlayerCallback", "} catch (...) {"],
	["GetPlayerActiveWeaponCallback", "GetActiveWeapon failed with a native C++ exception."],
	["GetPlayerActiveWeaponCallback", "} catch (...) {"],
	["SetPlayerActiveWeaponCallback", "SetActiveWeapon failed with a native C++ exception."],
	["SetPlayerActiveWeaponCallback", "} catch (...) {"],
	["GetPlayerWeaponIndicesCallback", "GetWeaponIndices failed with a native C++ exception."],
	["GetPlayerWeaponIndicesCallback", "} catch (...) {"],
	["GetPlayerProjectileIndicesCallback", "GetProjectileIndices failed with a native C++ exception."],
	["GetPlayerProjectileIndicesCallback", "} catch (...) {"],
	["GetPlayerProjectileAmmoCallback", "GetProjectileAmmo failed with a native C++ exception."],
	["GetPlayerProjectileAmmoCallback", "} catch (...) {"],
	["SetPlayerProjectileAmmoCallback", "WriteEntityPropertiesScalarValue(pchPropertyAddress, nProjectileAmmoValue)"],
	["GetPlayerIntegerPropertyCallback", "ReadEntityPropertiesScalarValue(pchPropertyAddress, nIntegerPropertyValue)"],
	["SetPlayerIntegerPropertyCallback", "WriteEntityPropertiesScalarValue(pchPropertyAddress, nPropertyValue)"],
	["GetPlayerVectorPropertyCallback", "sizeof(Vector), alignof(Vector)"],
	["SetPlayerVectorPropertyCallback", "sizeof(Vector), alignof(Vector)"],
	["SetPlayerVectorPropertyCallback", "VectorConversionFailure.ReThrow();"],
	["GetPlayerEntityPropertyCallback", "PlayersReadEntityHandleStorage(pchPropertyAddress, unEntityHandleValue)"],
	["PlayersReadNativeIntegerProperty", "PlayerResolutionFailure.ReThrow();"],
	["PlayersReadNativeIntegerProperty", "ReadEntityPropertiesScalarValue(pchPropertyAddress, nIntegerPropertyValue)"],
	["PlayersReadNativeHandlePresence", "PlayerResolutionFailure.ReThrow();"],
	["PlayersReadNativeHandlePresence", "ReadEntityPropertiesScalarValue(pchPropertyAddress, nIntegerPropertyValue)"],
	["PlayersReadNativeHandlePresence", "bPresent = nIntegerPropertyValue >= kFirstEntityIndex;"],
	["IsPlayerHLTVCallback", "nPlayerEntityIndex = GetValueIndex(pIsolate, LocalContext, LocalPlayerValue);"],
	["AreEffectsServerClassStorageRangesValid", "sizeof(ServerClass), alignof(ServerClass)"],
	["AreEffectsServerClassStorageRangesValid", "sizeof(SendTable), alignof(SendTable)"],
	["DoesEffectsServerClassMatch", "!AreEffectsServerClassStorageRangesValid(pServerClass)"],
	["IsTemporaryEntityServerClass", "!AreEffectsServerClassStorageRangesValid(pServerClass)"],
	["FindEffectsServerClass", "!AreEffectsServerClassStorageRangesValid(pCurrentServerClass)"],
	["FindEffectsServerClass", "if (pVisitedServerClass == pCurrentServerClass) {"],
	["FindEffectsServerClass", "vecVisitedServerClasses.push_back(pCurrentServerClass);"],
	["SetPlayerProjectileAmmoCallback", "} catch (...) {"],
	["SetPlayerProjectileAmmoCallback", "SetProjectileAmmo failed with a native C++ exception."],
	["GetPlayerIntegerPropertyCallback", "} catch (...) {"],
	["GetPlayerIntegerPropertyCallback", "GetIntegerProperty failed with a native C++ exception."],
	["SetPlayerIntegerPropertyCallback", "} catch (...) {"],
	["SetPlayerIntegerPropertyCallback", "SetIntegerProperty failed with a native C++ exception."],
	["GetPlayerVectorPropertyCallback", "} catch (...) {"],
	["GetPlayerVectorPropertyCallback", "GetVectorProperty failed with a native C++ exception."],
	["SetPlayerVectorPropertyCallback", "} catch (...) {"],
	["SetPlayerVectorPropertyCallback", "SetVectorProperty failed with a native C++ exception."],
	["GetPlayerEntityPropertyCallback", "} catch (...) {"],
	["GetPlayerEntityPropertyCallback", "GetEntityProperty failed with a native C++ exception."],
	["IsPlayerHLTVCallback", "} catch (...) {"],
	["IsPlayerHLTVCallback", "IsHLTV failed with a native C++ exception."],
	["IsPlayerInVehicleCallback", "} catch (...) {"],
	["IsPlayerInVehicleCallback", "IsInVehicle failed with a native C++ exception."],
	["IsPlayerObserverCallback", "} catch (...) {"],
	["IsPlayerObserverCallback", "IsObserver failed with a native C++ exception."],
	["MakeCounterStrikePlayerObject", "if (!SetRecordFunction(pIsolate, LocalContext, LocalPlayerObject, \"HasC4\", PlayersCounterStrikeHasC4MethodCallback, LocalFunctionData)) {\n\t\t\t\treturn {};\n\t\t\t}"],
	["MakeCounterStrikePlayerObject", "if (!SetRecordFunction(pIsolate, LocalContext, LocalPlayerObject, \"Spawn\", PlayersCounterStrikeSpawnMethodCallback, LocalFunctionData)) {\n\t\t\t\treturn {};\n\t\t\t}"],
];

let g_unSourceGuardCount = 0;

function GetFunction(strSource, strFunctionName) {
	const strEscapedName = strFunctionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const FunctionPattern = new RegExp("^(\\t{1,2})(?:bool|void|ServerClass\\*|v8::Local<v8::Object>) " + strEscapedName + "\\([^\\n;{}]*\\)(?: noexcept)?(?: try)? \\{", "m");
	const vecDefinitionMatch = FunctionPattern.exec(strSource);
	g_Assert.ok(vecDefinitionMatch, "Missing native function definition: " + strFunctionName);

	const ClosingPattern = new RegExp("^" + vecDefinitionMatch[1] + "\\}$", "gm");
	ClosingPattern.lastIndex = vecDefinitionMatch.index + vecDefinitionMatch[0].length;
	const vecClosingMatch = ClosingPattern.exec(strSource);
	g_Assert.ok(vecClosingMatch && (vecClosingMatch.index > vecDefinitionMatch.index), "Missing native function body end: " + strFunctionName);

	return strSource.slice(vecDefinitionMatch.index, vecClosingMatch.index + vecClosingMatch[0].length);
}

function AssertExtractorContracts() {
	// These prototypes deliberately test definition selection, not native behavior.
	for (const strIndentation of ["\t", "\t\t"]) {
		const strPrototype = strIndentation + "bool NativePropertyExtractorProbe();\n";
		const strDefinition = strIndentation + "bool NativePropertyExtractorProbe() {\n" + strIndentation + "\treturn true;\n" + strIndentation + "}";
		g_Assert.equal(GetFunction(strPrototype + strDefinition + "\n", "NativePropertyExtractorProbe"), strDefinition);
		g_Assert.throws(() => GetFunction(strPrototype, "NativePropertyExtractorProbe"), g_Assert.AssertionError);

		const strObjectPrototype = strIndentation + "v8::Local<v8::Object> NativeObjectExtractorProbe();\n";
		const strObjectDefinition = strIndentation + "v8::Local<v8::Object> NativeObjectExtractorProbe() {\n" + strIndentation + "\treturn {};\n" + strIndentation + "}";
		g_Assert.equal(GetFunction(strObjectPrototype + strObjectDefinition + "\n", "NativeObjectExtractorProbe"), strObjectDefinition);
		g_Assert.throws(() => GetFunction(strObjectPrototype, "NativeObjectExtractorProbe"), g_Assert.AssertionError);
	}
}

function AssertGuardedEntityIndexRead(strFunction, strIndexName, strValueName, strFailureName) {
	const vecEscapedNames = [strIndexName, strValueName, strFailureName].map((strName) => strName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
	const strPattern = vecEscapedNames[0] + " = GetValueIndex\\(pIsolate, LocalContext, " + vecEscapedNames[1] + "\\);\\s*if \\(" + vecEscapedNames[2] + "\\.HasCaught\\(\\)\\) \\{\\s*" + vecEscapedNames[2] + "\\.ReThrow\\(\\);\\s*return;";
	g_Assert.match(strFunction, new RegExp(strPattern), "Entity-index exceptions must be rethrown immediately after conversion");
}

function AssertIndexReadContracts() {
	// These source fragments test the guard matcher, not native execution.
	const strIndexRead = "nEntityIndex = GetValueIndex(pIsolate, LocalContext, LocalEntityValue);\n";
	const strGuard = "if (ResolutionFailure.HasCaught()) {\n\tResolutionFailure.ReThrow();\n\treturn;\n}";
	AssertGuardedEntityIndexRead(strIndexRead + strGuard, "nEntityIndex", "LocalEntityValue", "ResolutionFailure");
	g_Assert.throws(() => AssertGuardedEntityIndexRead(strIndexRead + strGuard.replace("ResolutionFailure.HasCaught()", () => "false"), "nEntityIndex", "LocalEntityValue", "ResolutionFailure"), g_Assert.AssertionError);
	g_Assert.throws(() => AssertGuardedEntityIndexRead(strIndexRead + strGuard.replace("ResolutionFailure.ReThrow();", () => "ResolutionFailure.Reset();"), "nEntityIndex", "LocalEntityValue", "ResolutionFailure"), g_Assert.AssertionError);
}

AssertExtractorContracts();
AssertIndexReadContracts();

for (const vecContract of g_vecContracts) {
	const strFunctionName = vecContract[0];
	const strRequiredSource = vecContract[1];
	g_Assert.ok(GetFunction(g_strSource, strFunctionName).includes(strRequiredSource), strFunctionName + " must retain: " + strRequiredSource);
	g_unSourceGuardCount += 1;
}

for (const strFunctionName of ["PlayersGetSendPropertyAddress", "PlayersGetDatamapAddress", "PlayersResolvePropertyAddress", "PlayersRequirePropertyAddressFromArguments"]) {
	const strFunction = GetFunction(g_strSource, strFunctionName);
	g_Assert.ok(!strFunction.includes("pchPropertyAddressOut = nullptr;"), strFunctionName + " must not reset caller output on failure");
	g_Assert.ok(!strFunction.includes("strResolvedPropertyNameOut.clear();"), strFunctionName + " must not clear caller output on failure");
	g_unSourceGuardCount += 2;
}

const g_strWeaponSetter = GetFunction(g_strSource, "SetPlayerActiveWeaponCallback");
AssertGuardedEntityIndexRead(g_strWeaponSetter, "nWeaponEntityIndex", "LocalWeaponValue", "WeaponResolutionFailure");
g_unSourceGuardCount += 1;

const g_strProjectileIndices = GetFunction(g_strSource, "GetPlayerProjectileIndicesCallback");
AssertGuardedEntityIndexRead(g_strProjectileIndices, "nPlayerEntityIndex", "LocalPlayerValue", "PlayerResolutionFailure");
g_unSourceGuardCount += 1;

const g_strHLTVCallback = GetFunction(g_strSource, "IsPlayerHLTVCallback");
AssertGuardedEntityIndexRead(g_strHLTVCallback, "nPlayerEntityIndex", "LocalPlayerValue", "PlayerResolutionFailure");
g_unSourceGuardCount += 1;

const g_strResolver = GetFunction(g_strSource, "PlayersResolvePropertyAddress");
g_Assert.ok(g_strResolver.indexOf("std::string strResolvedPropertyName = strPropertyName;") < g_strResolver.indexOf("strResolvedPropertyNameOut = std::move(strResolvedPropertyName);"));
g_Assert.ok(g_strResolver.indexOf("strResolvedPropertyNameOut = std::move(strResolvedPropertyName);") < g_strResolver.indexOf("pchPropertyAddressOut = pchResolvedPropertyAddress;"));
g_unSourceGuardCount += 2;

const g_strNameParser = GetFunction(g_strSource, "PlayersGetPropertyNamesFromValue");
// Array read, two string coercions, two UTF-8 conversions and the C++ exception boundary.
const g_unPropertyNameFailureGuardCount = 6;
g_Assert.equal((g_strNameParser.match(/ValueToString\(/g) ?? []).length, 2);
g_Assert.equal((g_strNameParser.match(/if \(PropertyNamesFailure\.HasCaught\(\)\)/g) ?? []).length, g_unPropertyNameFailureGuardCount);
g_Assert.match(g_strNameParser, /} catch \(\.\.\.\) \{\s*if \(PropertyNamesFailure\.HasCaught\(\)\) \{\s*PropertyNamesFailure\.ReThrow\(\);\s*\}\s*throw;/);
g_unSourceGuardCount += 3;

console.log("players native property contracts smoke passed (" + g_unSourceGuardCount + " source guards); extractor/index-read controls passed; source-only checks do not execute V8, SDK or engine calls.");
