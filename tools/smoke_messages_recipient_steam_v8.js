#!/usr/bin/env node

"use strict";

// Actual current index/recipient/UInt32 helpers, complete dialog/menu callbacks,
// SteamID factory, module installers and netchannel DataRate setter execute with real V8. SDK storage/dispatch are adapted;
// no game-server, SDK ABI, native heap-lifetime or allocator/OOM proof is claimed.
const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_unProcessTimeoutMilliseconds = 240000;
const g_unMaximumOutputBytes = 16 * 1024 * 1024;
const g_unParallelBuildJobs = 2;
const g_vecArguments = process.argv.slice(2);
if ((g_vecArguments.length !== 2) || (g_vecArguments[0] !== "--build-tree") || !g_vecArguments[1]) {
	console.error("Usage: node tools/smoke_messages_recipient_steam_v8.js --build-tree <configured-production-build>");
	process.exit(2);
}

g_Assert(["win32", "linux"].includes(process.platform), "Windows or Linux host required");
const g_strRoot = g_Path.resolve(__dirname, "..");
const g_strBuildTree = g_FileSystem.realpathSync(g_Path.resolve(g_vecArguments[1]));
const g_strCache = g_FileSystem.readFileSync(g_Path.join(g_strBuildTree, "CMakeCache.txt"), "utf8");
const g_strSource = g_FileSystem.readFileSync(g_Path.join(g_strRoot, "src/sourcejs/modules/ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_strTemplate = g_FileSystem.readFileSync(g_Path.join(__dirname, "fixtures/MessagesRecipientSteamV8.cpp"), "utf8");

function ReadCache(strName, bRequired = true) {
	const vecMatch = g_strCache.match(new RegExp("^" + strName + ":[^=]*=(.*)$", "m"));
	g_Assert(!bRequired || vecMatch?.[1], "Missing configured entry: " + strName);

	return vecMatch?.[1].trim() ?? "";
}

function GetDefinition(strName, strParameters = "[^\\n]*") {
	const vecMatches = g_strSource.match(new RegExp("^\\t\\t[^\\t\\n].*\\b" + strName + "\\(" + strParameters + "\\)(?: noexcept)? \\{", "m"));
	g_Assert(vecMatches, "Missing definition: " + strName);
	const vecEndMatches = g_strSource.slice(vecMatches.index).match(/^\t\t}$/m);
	g_Assert(vecEndMatches && (vecEndMatches.index > 0), "Missing end: " + strName);

	return g_strSource.slice(vecMatches.index, vecMatches.index + vecEndMatches.index + vecEndMatches[0].length);
}

function ReplaceOnce(strSource, strBefore, strAfter) {
	g_Assert.equal(strSource.split(strBefore).length, 2, "Unique mutation: " + strBefore);

	return strSource.replace(strBefore, () => strAfter);
}

function IndentInstallationDefinition(strDefinition) {
	return strDefinition.split("\n").map(strLine => (strLine && !strLine.startsWith("#")) ? ("\t" + strLine) : strLine).join("\n");
}

function VerifyLiteralReplacement() {
	const strValue = "$&|$`|$'|$$";
	g_Assert.equal(ReplaceOnce("Before:target:After", "target", strValue), "Before:" + strValue + ":After");
}

function Run(strCommand, vecArguments) {
	const strDisplayCommand = g_Path.isAbsolute(strCommand) ? g_Path.relative(g_strRoot, strCommand) : strCommand;
	const Result = g_ChildProcess.spawnSync(strCommand, vecArguments, { cwd: g_strRoot, encoding: "utf8", windowsHide: true, timeout: g_unProcessTimeoutMilliseconds, maxBuffer: g_unMaximumOutputBytes });
	g_Assert(!Result.error, strDisplayCommand + " failed: " + Result.error?.message);
	g_Assert.equal(Result.signal, null, strDisplayCommand + " received native process signal: " + Result.signal);

	return Result;
}

function RequireSuccess(strCommand, vecArguments) {
	const Result = Run(strCommand, vecArguments);
	g_Assert.equal(Result.status, 0, strCommand + ": " + Result.stdout + Result.stderr);
	g_Assert(!/\bwarning(?: C\d+| LNK\d+|:)/i.test(Result.stdout + Result.stderr), strCommand + " reported a warning:\n" + Result.stdout + Result.stderr);
}

VerifyLiteralReplacement();

const g_vecIdentity = g_strSource.match(/^\t\tstruct MessagesRecipientIdentity \{[\s\S]+?(?=^\t\tvoid CreateMessagesDialogCallback)/m);
g_Assert(g_vecIdentity, "Current recipient identity implementation");
const g_strIdentity = g_vecIdentity[0].trimEnd();
const g_strUInt32 = GetDefinition("GetSteamUInt32FromValue");
const g_strBasics = [
	GetDefinition("MakeString", "v8::Isolate\\* const pIsolate, char const\\* const pszValue"),
	GetDefinition("ThrowError"),
	GetDefinition("ValueToString"),
	GetDefinition("IsValueNullish"),
	GetDefinition("GetUInt64ValueFromValue"),
	...["GetIntegerFromValue", "GetObjectIndex", "GetValueIndex", "GetNumberArgument"].map(strName => GetDefinition(strName)),
].join("\n\n");

for (const strName of ["CreateMessagesDialogCallback", "ShowMenusTextCallback", "HideMenusTextCallback"]) {
	const strDefinition = GetDefinition(strName);
	g_Assert.equal(strDefinition.split("CaptureMessagesRecipientIdentity(").length, 2);
	g_Assert.equal(strDefinition.split("RequireMessagesRecipientEdict(").length, 2);
	g_Assert(strDefinition.indexOf("RequireMessagesRecipientEdict(") < strDefinition.indexOf("->CreateMessage("), "Fresh recipient before dispatch");
	g_Assert(!strDefinition.includes("RequireMessagePlayerEdict("), "No retained early edict in dialog callback");
}

const g_vecOwner = g_strSource.match(/^\t\tstruct SourceJSKeyValuesDeleter \{[\s\S]+?^\t\tusing SourceJSKeyValuesOwner = [^\n]+;/m);
g_Assert(g_vecOwner, "Actual KeyValues owner");
const g_strSteamIDFieldsFactory = ReplaceOnce(GetDefinition("MakeSteamIDFieldsObject"), "v8::Object::New(pIsolate)", "CreateFixtureSteamFieldsObject(pIsolate)");
const g_strSteamInstallation = GetDefinition("InstallSteamIDFunctions");
const g_strSteamInstallationFixture = g_strSteamInstallation.replace(/, ([A-Za-z][A-Za-z0-9]*Callback), LocalRuntimeData\)/g, ", FixtureCallback, LocalRuntimeData)");
g_Assert.equal((g_strSteamInstallation.match(/, ([A-Za-z][A-Za-z0-9]*Callback), LocalRuntimeData\)/g) ?? []).length, 27, "Adapt only the installer callback addresses, not Steam operation bodies");
g_Assert.equal(g_strTemplate.split("@ACTUAL_STEAM_INSTALLATION_HELPERS@").length, 2);

const g_vecAuthenticationInstallers = [
	{ Name: "InstallAuthenticationFunctions", Family: "Flat", MethodCount: 17 },
	{ Name: "InstallAuthenticationSQLFunctions", Family: "SQL", MethodCount: 21 },
].map(Contract => {
	const strDefinition = GetDefinition(Contract.Name);
	const vecCallbacks = strDefinition.match(/, ([A-Za-z][A-Za-z0-9]*Callback), LocalRuntimeData\)/g) ?? [];
	g_Assert.equal(vecCallbacks.length, Contract.MethodCount, "Adapt only auth installer callback addresses: " + Contract.Name);

	return { ...Contract, Definition: strDefinition.replace(/, ([A-Za-z][A-Za-z0-9]*Callback), LocalRuntimeData\)/g, ", FixtureSteamInstallation::FixtureCallback, LocalRuntimeData)") };
});
const g_strAuthenticationInstallationFixture = g_vecAuthenticationInstallers.map(Contract => Contract.Definition).join("\n\n");
g_Assert.equal(g_strTemplate.split("@ACTUAL_AUTHENTICATION_INSTALLATION_HELPERS@").length, 2);

const g_strWeaponMethods = GetDefinition("InstallWeaponPropertyAndAmmoFunctions");
g_Assert.equal((g_strWeaponMethods.match(/, ([A-Za-z][A-Za-z0-9]*Callback), LocalRuntimeData\)/g) ?? []).length, 14, "Adapt only weapon installer callback addresses");
const g_strWeaponInstallationFixture = g_strWeaponMethods.replace(/, ([A-Za-z][A-Za-z0-9]*Callback), LocalRuntimeData\)/g, ", FixtureSteamInstallation::FixtureCallback, LocalRuntimeData)") + "\n\n" + GetDefinition("InstallWeaponConstants");
const g_vecWeaponFeatures = [
	"SOURCEJS_HAS_WEAPON_SHAREDDEFS",
	"SOURCEJS_HAS_WEAPON_PARSE",
	"SOURCEJS_HAS_WEAPON_PROFICIENCY",
	"SOURCEJS_HAS_ITEM_FLAG_NOITEMPICKUP",
	"SOURCEJS_HAS_WEAPON_SOUND_TAUNT",
	"SOURCEJS_HAS_WEAPON_SOUND_UNKNOWN",
	"SOURCEJS_HAS_WEAPON_SOUND_FAST_RELOAD",
];

const g_strNetChannelDataRateFixture = ["GetFloatArgument", "GetAddressSizedUnsignedIntegerFromValue", "GetNetChannelInformationFromValue", "SetNetChannelInformationPropertyCallback"].map(strName => GetDefinition(strName)).join("\n\n");
g_Assert.equal(g_strTemplate.split("@ACTUAL_NETCHANNEL_DATA_RATE_HELPERS@").length, 2);
const g_strMemoryNarrowIntegerFixture = ["RequireMemoryInt32InRangeFromValue", "RequireMemoryUInt32AtMostFromValue"].map(strName => GetDefinition(strName)).join("\n\n");
g_Assert.equal(g_strTemplate.split("@ACTUAL_MEMORY_NARROW_INTEGER_HELPERS@").length, 2);

const g_strMemoryVirtualFunctionFixture = [
	...["MakeMemoryAddressValue", "RequireMemoryAddressFromValue", "IsMemoryAddressRangeRepresentable"].map(strName => GetDefinition(strName)),
	"\t\ttemplate<typename TValue>\n" + GetDefinition("ReadMemoryScalarFromAddress"),
	GetDefinition("RequireMemoryInt32InRangeFromValue"),
	GetDefinition("GetMemoryHelpersVirtualFunctionCallback"),
].join("\n\n");

g_Assert.equal(g_strTemplate.split("@ACTUAL_MEMORY_VIRTUAL_FUNCTION_HELPERS@").length, 2);

for (const strPlaceholder of ["@ACTUAL_WEAPON_INSTALLATION_HELPERS@", "@WEAPON_FEATURE_DEFINITIONS@", "@WEAPON_FEATURE_RESTORE@"]) {
	g_Assert.equal(g_strTemplate.split(strPlaceholder).length, 2);
}

const g_strFullCallbacks = [
	g_vecOwner[0],
	...["GetMessagesIntegerFromValue", "GetMessagesNumberFromValue", "GetMessagesColorComponentFromValue", "GetMessagesColorArrayComponent", "GetMessagesColorObjectComponent", "GetMessagesColorStringFromValue", "IsValidMessagesKeyValuesFieldName", "SetMessagesKeyValuesFromObject", "CreateMessagesDialogCallback", "ShowMenusTextCallback", "HideMenusTextCallback", "RethrowV8InstallationFailure", "SteamIDToUInt64", "MakeSteamUInt64", "GetSteamStaticAccountKey"].map(strName => GetDefinition(strName)),
	GetDefinition("SetRecordProperty"),
	g_strSteamIDFieldsFactory,
].join("\n\n");

const g_vecCases = [
	{ Name: "Current", Identity: g_strIdentity, UInt32: g_strUInt32 },
	{ Name: "NegativeSign", Identity: g_strIdentity, UInt32: ReplaceOnce(g_strUInt32, "(strSteamUInt32Value.find('-') != std::string::npos)", "(strSteamUInt32Value.front() == '-')") },
	{ Name: "NegativeNUL", Identity: g_strIdentity, UInt32: ReplaceOnce(ReplaceOnce(g_strUInt32, "(pszSteamUInt32ParseEnd != pszSteamUInt32ValueEnd)", "(pszSteamUInt32ParseEnd && (*pszSteamUInt32ParseEnd != '\\0'))"), "\t\t\t\tchar const* const pszSteamUInt32ValueEnd = strSteamUInt32Value.c_str() + strSteamUInt32Value.size();\n", "") },
	{ Name: "NegativeIdentity", Identity: ReplaceOnce(g_strIdentity, "(pEngineServer->GetPlayerUserId(pPlayerEdict) != RecipientIdentity.m_nPlayerUserID)", "false"), UInt32: g_strUInt32 },
	{ Name: "NegativeRefresh", Identity: ReplaceOnce(ReplaceOnce(g_strIdentity, "auto* const pPlayerEdict = GetEdictFromEntityIndex(RecipientIdentity.m_nPlayerIndex);", "auto* const pPlayerEdict = &g_InitialEdict;"), "if (!pPlayerEdict || pPlayerEdict->IsFree() ||", "if (pPlayerEdict->IsFree() ||"), UInt32: g_strUInt32, ExpectedFailure: "Error: Touched a retired edict" },
];
for (const Probe of [
	{ Name: "CreateMessagesDialogCallback", APIName: "kCreateDialogAPIName", IdentityName: "DialogRecipientIdentity" },
	{ Name: "ShowMenusTextCallback", APIName: "kShowTextAPIName", IdentityName: "MenuRecipientIdentity" },
	{ Name: "HideMenusTextCallback", APIName: "kHideTextAPIName", IdentityName: "MenuRecipientIdentity" },
]) {
	const strBefore = "RequireMessagesRecipientEdict(pIsolate, " + Probe.IdentityName + ", " + Probe.APIName + ")";
	g_vecCases.push({ Name: "Negative" + Probe.Name, Identity: g_strIdentity, UInt32: g_strUInt32, FullSource: ReplaceOnce(g_strFullCallbacks, strBefore, "GetEdictFromEntityIndex(" + Probe.IdentityName + ".m_nPlayerIndex)") });
}

g_vecCases.push({ Name: "NegativeSteamSnapshot", Identity: g_strIdentity, UInt32: g_strUInt32, FullSource: ReplaceOnce(g_strFullCallbacks, "CSteamID const SteamID = SteamIDBorrowed;", "CSteamID const& SteamID = SteamIDBorrowed;"), ExpectedFailure: "Error: Preserve SteamID owned snapshot during output construction" });
for (const Probe of [
	{ Name: "NegativeSteamOwnAccountID", Before: "SetRecordProperty(pIsolate, LocalContext, LocalSteamIDFieldsObject, kAccountIDPropertyName, LocalSteamAccountIDValue)", After: "SetValue(pIsolate, LocalContext, LocalSteamIDFieldsObject, kAccountIDPropertyName, LocalSteamAccountIDValue)" },
	{ Name: "NegativeSteamOwnAccountInstance", Before: "SetRecordProperty(pIsolate, LocalContext, LocalSteamIDFieldsObject, kAccountInstancePropertyName, v8::Integer::New(pIsolate, static_cast<int>(SteamID.GetUnAccountInstance())))", After: "SetInteger(pIsolate, LocalContext, LocalSteamIDFieldsObject, kAccountInstancePropertyName, static_cast<int>(SteamID.GetUnAccountInstance()))" },
	{ Name: "NegativeSteamOwnAccountType", Before: "SetRecordProperty(pIsolate, LocalContext, LocalSteamIDFieldsObject, kAccountTypePropertyName, v8::Integer::New(pIsolate, static_cast<int>(SteamID.GetEAccountType())))", After: "SetInteger(pIsolate, LocalContext, LocalSteamIDFieldsObject, kAccountTypePropertyName, static_cast<int>(SteamID.GetEAccountType()))" },
	{ Name: "NegativeSteamOwnUniverse", Before: "SetRecordProperty(pIsolate, LocalContext, LocalSteamIDFieldsObject, kUniversePropertyName, v8::Integer::New(pIsolate, static_cast<int>(SteamID.GetEUniverse())))", After: "SetInteger(pIsolate, LocalContext, LocalSteamIDFieldsObject, kUniversePropertyName, static_cast<int>(SteamID.GetEUniverse()))" },
	{ Name: "NegativeSteamOwnStaticAccountKey", Before: "SetRecordProperty(pIsolate, LocalContext, LocalSteamIDFieldsObject, kStaticAccountKeyPropertyName, LocalSteamStaticAccountKeyValue)", After: "SetValue(pIsolate, LocalContext, LocalSteamIDFieldsObject, kStaticAccountKeyPropertyName, LocalSteamStaticAccountKeyValue)" },
	{ Name: "NegativeSteamOwnValue", Before: "SetRecordProperty(pIsolate, LocalContext, LocalSteamIDFieldsObject, kSteamIDValuePropertyName, LocalSteamIDValue)", After: "SetValue(pIsolate, LocalContext, LocalSteamIDFieldsObject, kSteamIDValuePropertyName, LocalSteamIDValue)" },
	{ Name: "NegativeSteamOwnValid", Before: "SetRecordProperty(pIsolate, LocalContext, LocalSteamIDFieldsObject, kValidPropertyName, v8::Boolean::New(pIsolate, SteamID.IsValid()))", After: "SetBoolean(pIsolate, LocalContext, LocalSteamIDFieldsObject, kValidPropertyName, SteamID.IsValid())" },
]) {
	const strRegression = ReplaceOnce(g_strSteamIDFieldsFactory, Probe.Before, Probe.After);
	g_vecCases.push({ Name: Probe.Name, Identity: g_strIdentity, UInt32: g_strUInt32, FullSource: ReplaceOnce(g_strFullCallbacks, g_strSteamIDFieldsFactory, strRegression), ExpectedFailure: "Error: Preserve own SteamID fields" });
}

for (const strFamily of ["Methods", "Constants", "Exports"]) {
	let strInstaller = g_strSteamInstallationFixture;
	if (strFamily === "Methods") {
		strInstaller = strInstaller.replaceAll("SetRecordFunction(", "SetFunction(");
	} else if (strFamily === "Constants") {
		strInstaller = strInstaller.replace(/SetRecordProperty\(pIsolate, LocalContext, (LocalSteamUniverse|LocalSteamAccountType), ("[^"]+"), v8::Integer::New\(pIsolate, (k[A-Za-z0-9]+)\)\)/g, "SetInteger(pIsolate, LocalContext, $1, $2, $3)");
	} else {
		strInstaller = strInstaller.replace(/SetRecordProperty\(pIsolate, LocalContext, LocalSteamModule, ("Universe"|"AccountType"), (LocalSteamUniverse|LocalSteamAccountType)\)/g, "SetValue(pIsolate, LocalContext, LocalSteamModule, $1, $2)");
		strInstaller = ReplaceOnce(strInstaller, 'SetRecordProperty(pIsolate, LocalContext, LocalSteamModule, "STEAM_ID_SIZE", v8::Integer::New(pIsolate, kSteamIDByteSize))', 'SetInteger(pIsolate, LocalContext, LocalSteamModule, "STEAM_ID_SIZE", kSteamIDByteSize)');
	}

	g_Assert.notEqual(strInstaller, g_strSteamInstallationFixture, "Actual installer family mutation: " + strFamily);
	g_vecCases.push({ Name: "NegativeSteamInstallation" + strFamily, Identity: g_strIdentity, UInt32: g_strUInt32, InstallationSource: strInstaller, ExpectedFailure: "Error: Preserve Steam installation own records" });
}

for (const Contract of g_vecAuthenticationInstallers) {
	const strRegression = Contract.Definition.replaceAll("SetRecordFunction(", "SetFunction(");
	g_Assert.notEqual(strRegression, Contract.Definition, "Actual auth installer mutation: " + Contract.Name);
	g_vecCases.push({ Name: "NegativeAuthenticationInstallation" + Contract.Family, Identity: g_strIdentity, UInt32: g_strUInt32, AuthenticationSource: ReplaceOnce(g_strAuthenticationInstallationFixture, Contract.Definition, strRegression), ExpectedFailure: "Error: Preserve authentication installation own records" });
}

for (const strFamily of ["Methods", "Constants", "Exports"]) {
	let unMutatedWrites = 0;
	const strPattern = (strFamily === "Methods") ? "SetRecordFunction\\(" : "SetRecordProperty\\(pIsolate, LocalContext, " + ((strFamily === "Constants") ? "(?:LocalItemFlags|LocalWeaponState|LocalWeaponProficiency|LocalWeaponSound)" : "LocalWeaponConstantsModule") + ",";
	const strRegression = g_strWeaponInstallationFixture.replace(new RegExp(strPattern, "g"), strMatch => {
		++unMutatedWrites;

		return strMatch.replace((strFamily === "Methods") ? "SetRecordFunction(" : "SetRecordProperty(", (strFamily === "Methods") ? "SetFunction(" : "SetValue(");
	});
	g_Assert.equal(unMutatedWrites, (strFamily === "Methods") ? 14 : ((strFamily === "Constants") ? 37 : 7), "Actual weapon installer family mutation: " + strFamily);
	g_vecCases.push({ Name: "NegativeWeaponInstallation" + strFamily, Identity: g_strIdentity, UInt32: g_strUInt32, WeaponSource: strRegression, ExpectedFailure: "Error: Preserve weapon installation own records" });
}

g_vecCases.push({ Name: "MinimalWeaponInstallation", Positive: true, WeaponMode: "MIN", Identity: g_strIdentity, UInt32: g_strUInt32 });
g_vecCases.push({ Name: "BaseWeaponInstallation", Positive: true, WeaponMode: "BASE", Identity: g_strIdentity, UInt32: g_strUInt32 });
g_vecCases.push({ Name: "LegacyDialog", Positive: true, OldConsoleAPI: true, Identity: g_strIdentity, UInt32: g_strUInt32 });
g_vecCases.push({ Name: "BMSInstallation", Positive: true, SteamBranch: "bms", Identity: g_strIdentity, UInt32: g_strUInt32 });

const g_vecDataRateConversion = /\t{4}float flDataRate = 0\.0F;\n\t{4}if \(!GetFloatArgument[^\n]+\n\t{5}RethrowV8InstallationFailure[^\n]+\n\t{5}return;\n\t{4}}\n\n/.exec(g_strNetChannelDataRateFixture);
g_Assert(g_vecDataRateConversion, "Actual DataRate conversion block");
const g_strEarlyAddressDataRateFixture = ReplaceOnce(ReplaceOnce(g_strNetChannelDataRateFixture, g_vecDataRateConversion[0], ""), "\t\t\t\tauto* const pNetChannel = static_cast<INetChannel*>(pNetChannelInformation);", g_vecDataRateConversion[0] + "\t\t\t\tauto* const pNetChannel = static_cast<INetChannel*>(pNetChannelInformation);");
g_vecCases.push({ Name: "NegativeNetChannelDataRateFreshAddress", Identity: g_strIdentity, UInt32: g_strUInt32, DataRateSource: g_strEarlyAddressDataRateFixture, ExpectedFailure: "Error: Preserve netchannel DataRate address after coercion" });

for (const Contract of [
	{ Family: "Signed", Name: "RequireMemoryInt32InRangeFromValue", Declaration: "int nInteger = 0;", Conversion: "GetInt32Argument(pIsolate, LocalContext, LocalIntegerValue, pszArgumentErrorMessage, nInteger)", Guard: "if ((nInteger < nMinimumValue) || (nInteger > nMaximumValue))", Commit: "nIntegerOut = nInteger;" },
	{ Family: "Unsigned", Name: "RequireMemoryUInt32AtMostFromValue", Declaration: "std::uint32_t unInteger = 0;", Conversion: "GetUInt32Argument(pIsolate, LocalContext, LocalIntegerValue, pszArgumentErrorMessage, unInteger)", Guard: "if (unInteger > unMaximumValue)", Commit: "unIntegerOut = unInteger;" },
]) {
	const strDefinition = GetDefinition(Contract.Name);
	const vecGuard = /if \(!std::isfinite\(dblInteger\)[^\n]+/.exec(strDefinition);
	g_Assert(vecGuard, "Actual bounded integer source guard: " + Contract.Name);
	let strRegression = ReplaceOnce(strDefinition, "double dblInteger = 0.0;", Contract.Declaration);
	strRegression = ReplaceOnce(strRegression, "GetNumberArgument(pIsolate, LocalContext, LocalIntegerValue, pszArgumentErrorMessage, dblInteger)", Contract.Conversion);
	strRegression = ReplaceOnce(strRegression, vecGuard[0], Contract.Guard + " {");
	strRegression = ReplaceOnce(strRegression, (Contract.Family === "Signed") ? "nIntegerOut = static_cast<int>(dblInteger);" : "unIntegerOut = static_cast<std::uint32_t>(dblInteger);", Contract.Commit);
	g_vecCases.push({ Name: "NegativeMemory" + Contract.Family + "Narrowing", Identity: g_strIdentity, UInt32: g_strUInt32, MemoryIntegerSource: ReplaceOnce(g_strMemoryNarrowIntegerFixture, strDefinition, strRegression), ExpectedFailure: "Error: Preserve memory " + Contract.Family.toLowerCase() + " integer source range" });
}

const g_strVirtualIndexRead = "RequireMemoryInt32InRangeFromValue(pIsolate, LocalContext, LocalVirtualFunctionIndexValue, kIndexArgumentErrorMessage, kMinimumIndexValue, kMaximumIndexValue, nVirtualFunctionIndex)";
let g_strModuloVirtualFunctionFixture = ReplaceOnce(g_strMemoryVirtualFunctionFixture, g_strVirtualIndexRead, "GetInt32Argument(pIsolate, LocalContext, LocalVirtualFunctionIndexValue, kIndexArgumentErrorMessage, nVirtualFunctionIndex)");
g_strModuloVirtualFunctionFixture = ReplaceOnce(g_strModuloVirtualFunctionFixture, GetDefinition("RequireMemoryInt32InRangeFromValue"), "");
for (const strLimit of ["\t\t\tconstexpr int kMinimumIndexValue = std::numeric_limits<int>::min();\n", "\t\t\tconstexpr int kMaximumIndexValue = std::numeric_limits<int>::max();\n"]) {
	g_strModuloVirtualFunctionFixture = ReplaceOnce(g_strModuloVirtualFunctionFixture, strLimit, "");
}

const g_nVirtualRefreshBegin = g_strMemoryVirtualFunctionFixture.indexOf("\n\t\t\t\t\t// Index coercion may change the object's table; refresh before using it.");
const g_strVirtualRefreshClose = "\n\t\t\t\t\t}\n";
const g_nVirtualRefreshEnd = g_strMemoryVirtualFunctionFixture.indexOf(g_strVirtualRefreshClose, g_nVirtualRefreshBegin);
g_Assert((g_nVirtualRefreshBegin >= 0) && (g_nVirtualRefreshEnd > g_nVirtualRefreshBegin));
const g_strVirtualRefreshBlock = g_strMemoryVirtualFunctionFixture.slice(g_nVirtualRefreshBegin, g_nVirtualRefreshEnd + g_strVirtualRefreshClose.length);

g_vecCases.push({ Name: "NegativeVirtualFunctionModulo", Identity: g_strIdentity, UInt32: g_strUInt32, VirtualFunctionSource: g_strModuloVirtualFunctionFixture, ExpectedFailure: "Error: Preserve virtual function index range" });
g_vecCases.push({ Name: "NegativeVirtualFunctionFreshTable", Identity: g_strIdentity, UInt32: g_strUInt32, VirtualFunctionSource: ReplaceOnce(g_strMemoryVirtualFunctionFixture, g_strVirtualRefreshBlock, ""), ExpectedFailure: "Error: Preserve virtual table after index coercion" });
g_vecCases.push({ Name: "NegativeVirtualFunctionNullBypass", Identity: g_strIdentity, UInt32: g_strUInt32, VirtualFunctionSource: ReplaceOnce(g_strMemoryVirtualFunctionFixture, "if (ppVirtualTable) {\n\t\t\t\t\tif (!" + g_strVirtualIndexRead, "if (true) {\n\t\t\t\t\tif (!" + g_strVirtualIndexRead), ExpectedFailure: "Error: Preserve null virtual table index bypass" });

const g_strV8Root = ReadCache("V8_ROOT").replace(/\\/g, "/");
const g_strV8Configuration = ReadCache("V8_CONFIG");
g_Assert(![g_strRoot, g_strV8Root, g_strV8Configuration].some(strValue => /[;"\r\n]|\$\{/.test(strValue)), "Safe CMake paths");
const g_strPlatform = (process.platform === "win32") ? "windows" : "linux";
const g_strBuildRoot = g_FileSystem.realpathSync(g_Path.join(g_strRoot, "build"));
let g_bOperationFailed = false;
let g_OperationError = null;

const g_strDirectory = g_FileSystem.mkdtempSync(g_Path.join(g_strBuildRoot, "NativeMessagesSteamV8-"));
try {
	let strCMake = "cmake_minimum_required(VERSION 3.20)\nproject(MessagesRecipientSteamV8 LANGUAGES CXX)\ninclude(\"" + g_strRoot.replace(/\\/g, "/") + "/cmake/SourceJSPackage.cmake\")\n";
	for (const Case of g_vecCases) {
		const strFullCallbacks = Case.FullSource ?? g_strFullCallbacks;
		const strInstaller = Case.InstallationSource ?? g_strSteamInstallationFixture;
		const strAuthenticationInstaller = Case.AuthenticationSource ?? g_strAuthenticationInstallationFixture;
		const strWeaponInstaller = Case.WeaponSource ?? g_strWeaponInstallationFixture;
		const strUsedHelpers = strFullCallbacks + "\n" + strInstaller + "\n" + strAuthenticationInstaller + "\n" + strWeaponInstaller;
		const vecInstallationHelpers = [];
		if (/\b(?:SetValue|SetBoolean|SetInteger|SetFunction)\(/.test(strUsedHelpers)) {
			vecInstallationHelpers.push(GetDefinition("SetValue"));
		}

		for (const strName of ["SetBoolean", "SetInteger", "SetFunction"]) {
			if (strUsedHelpers.includes(strName + "(")) {
				vecInstallationHelpers.push(GetDefinition(strName));
			}
		}

		const vecOwnFunctionHelpers = strUsedHelpers.includes("SetRecordFunction(") ? [GetDefinition("SetRecordFunction")] : [];
		const strFixtureBranch = Case.SteamBranch ?? ReadCache("SOURCEJS_SDK_BRANCH");
		g_Assert(/^[a-z0-9_]+$/.test(strFixtureBranch), "Safe controlled SDK branch");
		const strInstallationHelpers = [
			'#pragma push_macro("SOURCEJS_SDK_BRANCH")',
			"#undef SOURCEJS_SDK_BRANCH",
			"#define SOURCEJS_SDK_BRANCH " + JSON.stringify(strFixtureBranch),
			IndentInstallationDefinition(GetDefinition("IsSteamL4D2Branch")),
			IndentInstallationDefinition(GetDefinition("IsSteamBMSBranch")),
			'#pragma pop_macro("SOURCEJS_SDK_BRANCH")',
			IndentInstallationDefinition(strInstaller),
		].join("\n\n");
		const strAuthenticationHelpers = [GetDefinition("MakeModule"), strAuthenticationInstaller].join("\n\n");
		const strWeaponMode = Case.WeaponMode ?? "FULL";
		g_Assert(["MIN", "BASE", "FULL"].includes(strWeaponMode), "Known controlled weapon configuration");
		const vecEnabledWeaponFeatures = (strWeaponMode === "MIN") ? [] : ((strWeaponMode === "BASE") ? g_vecWeaponFeatures.slice(0, 3) : g_vecWeaponFeatures);
		const strWeaponDefinitions = g_vecWeaponFeatures.flatMap(strName => ['#pragma push_macro("' + strName + '")', "#undef " + strName]).concat(vecEnabledWeaponFeatures.map(strName => "#define " + strName + " 1")).join("\n");
		const strWeaponRestore = [...g_vecWeaponFeatures].reverse().map(strName => '#pragma pop_macro("' + strName + '")').join("\n");
		const strMemoryIntegerSource = Case.MemoryIntegerSource ?? g_strMemoryNarrowIntegerFixture;
		const vecLegacyIntegerHelpers = ["GetInt32Argument", "GetUInt32Argument"].filter(strName => strMemoryIntegerSource.includes(strName + "(")).map(strName => GetDefinition(strName));
		const strMemoryIntegerHelpers = IndentInstallationDefinition([...vecLegacyIntegerHelpers, strMemoryIntegerSource].join("\n\n"));
		const strMemoryVirtualSource = Case.VirtualFunctionSource ?? g_strMemoryVirtualFunctionFixture;
		const vecLegacyVirtualHelpers = strMemoryVirtualSource.includes("GetInt32Argument(") ? [GetDefinition("GetInt32Argument")] : [];
		const strMemoryVirtualHelpers = IndentInstallationDefinition([...vecLegacyVirtualHelpers, strMemoryVirtualSource].join("\n\n"));
		const strProgram = g_strTemplate.replace("@BASIC_HELPERS@", () => g_strBasics).replace("@RECIPIENT_HELPERS@", () => Case.Identity).replace("@STEAM_UINT32_HELPER@", () => Case.UInt32).replace("@ACTUAL_PLAYER_EDICT_HELPER@", () => GetDefinition("RequireMessagePlayerEdict")).replace("@ACTUAL_FULL_CALLBACK_HELPERS@", () => [...vecInstallationHelpers, strFullCallbacks, ...vecOwnFunctionHelpers].join("\n\n")).replace("@ACTUAL_STEAM_INSTALLATION_HELPERS@", () => strInstallationHelpers).replace("@ACTUAL_AUTHENTICATION_INSTALLATION_HELPERS@", () => strAuthenticationHelpers).replace("@ACTUAL_WEAPON_INSTALLATION_HELPERS@", () => IndentInstallationDefinition(strWeaponInstaller)).replace("@WEAPON_FEATURE_DEFINITIONS@", () => strWeaponDefinitions).replace("@WEAPON_FEATURE_RESTORE@", () => strWeaponRestore).replace("@ACTUAL_NETCHANNEL_DATA_RATE_HELPERS@", () => IndentInstallationDefinition(Case.DataRateSource ?? g_strNetChannelDataRateFixture)).replace("@ACTUAL_MEMORY_NARROW_INTEGER_HELPERS@", () => strMemoryIntegerHelpers).replace("@ACTUAL_MEMORY_VIRTUAL_FUNCTION_HELPERS@", () => strMemoryVirtualHelpers);
		g_Assert(!/@[A-Z_]+@/.test(strProgram));
		g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, Case.Name + ".cpp"), strProgram);
		if (Case.OldConsoleAPI) {
			strCMake += "set_source_files_properties(" + Case.Name + ".cpp PROPERTIES COMPILE_DEFINITIONS SOURCEJS_OLD_CONSOLE_API=1)\n";
		}

		strCMake += `add_executable(${Case.Name} "${Case.Name}.cpp")
target_compile_features(${Case.Name} PRIVATE cxx_std_20)
target_include_directories(${Case.Name} SYSTEM PRIVATE "${g_strV8Root}/include")
SourceJSLinkV8(${Case.Name} "${g_strV8Root}" "${g_strV8Configuration}" "${g_strPlatform}")
if(MSVC)
	set_target_properties(${Case.Name} PROPERTIES MSVC_RUNTIME_LIBRARY "MultiThreaded")
	target_compile_options(${Case.Name} PRIVATE /W4 /WX /EHsc /permissive- /Zc:__cplusplus)
	target_link_libraries(${Case.Name} PRIVATE advapi32 dbghelp winmm ws2_32)
else()
	target_compile_options(${Case.Name} PRIVATE -Wall -Wextra -Werror -pedantic)
	target_link_options(${Case.Name} PRIVATE "-fuse-ld=${ReadCache("SOURCEJS_LINUX_LINKER", false) || "bfd"}")
	target_link_libraries(${Case.Name} PRIVATE dl pthread atomic)
endif()
`;
	}

	g_FileSystem.writeFileSync(g_Path.join(g_strDirectory, "CMakeLists.txt"), strCMake);
	const strBinaryRoot = g_Path.join(g_strDirectory, "compiled");
	const vecConfigure = ["-S", g_strDirectory, "-B", strBinaryRoot, "-G", ReadCache("CMAKE_GENERATOR"), "-DCMAKE_CXX_FLAGS=" + ReadCache("CMAKE_CXX_FLAGS", false)];
	if (process.platform === "win32") {
		vecConfigure.push("-A", ReadCache("CMAKE_GENERATOR_PLATFORM"));
	} else {
		vecConfigure.push("-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_CXX_COMPILER=" + ReadCache("CMAKE_CXX_COMPILER"));
	}

	RequireSuccess("cmake", vecConfigure);
	for (const Case of g_vecCases) {
		RequireSuccess("cmake", ["--build", strBinaryRoot, "--config", "Release", "--target", Case.Name, "--parallel", String(g_unParallelBuildJobs)]);
		const strExecutable = g_Path.join(strBinaryRoot, (process.platform === "win32") ? ("Release/" + Case.Name + ".exe") : Case.Name);
		const Result = Run(strExecutable, []);
		g_Assert.equal(Result.status, ((Case.Name === "Current") || Case.Positive) ? 0 : 1, Case.Name + "\n" + Result.stdout + Result.stderr);
		g_Assert.equal(Result.stdout, "", Case.Name + ": native fixture must not write stdout");

		if ((Case.Name !== "Current") && !Case.Positive) {
			const strExpectedFailure = Case.ExpectedFailure ?? "Error: Contract assertion failed";
			g_Assert.equal(Result.stderr.replace(/\r\n/g, "\n"), "Messages/Steam fixture: " + strExpectedFailure + "\n", Case.Name + ": exact controlled runtime witness required");
		} else {
			g_Assert.equal(Result.stderr, "", Case.Name + ": positive fixture must not write stderr");
		}

		console.log("Real V8 messages/Steam " + Case.Name + ": checked");
	}
} catch (OperationError) {
	g_bOperationFailed = true;
	g_OperationError = OperationError;
	throw OperationError;
} finally {
	try {
		const DirectoryStatus = g_FileSystem.lstatSync(g_strDirectory);
		g_Assert(DirectoryStatus.isDirectory() && !DirectoryStatus.isSymbolicLink(), "Fixture cleanup target must be the allocated directory, not a link");

		const strResolved = g_FileSystem.realpathSync(g_strDirectory);
		const strRelativeDirectory = g_Path.relative(g_strBuildRoot, strResolved);
		g_Assert(!g_Path.isAbsolute(strRelativeDirectory) && !strRelativeDirectory.startsWith("..") && /^NativeMessagesSteamV8-[^/\\]+$/.test(strRelativeDirectory) && (g_Path.basename(strResolved) === g_Path.basename(g_strDirectory)), "Refuse cleanup outside the exact native fixture directory.");
		g_FileSystem.rmSync(strResolved, { recursive: true, force: true });
	} catch (CleanupError) {
		if (g_bOperationFailed) {
			throw new AggregateError([g_OperationError, CleanupError], "Messages/Steam check and cleanup both failed.");
		}

		throw CleanupError;
	}
}

const g_unPositiveCaseCount = g_vecCases.filter(Case => (Case.Name === "Current") || Case.Positive).length;
const g_unNegativeCaseCount = g_vecCases.length - g_unPositiveCaseCount;
console.log("Real V8 messages/Steam/auth/weapons/netchannel/memory: " + g_unPositiveCaseCount + " positive cases and " + g_unNegativeCaseCount + " compiled negative controls; actual UInt32, recipient/index, dialog/menu callbacks, SteamID factory, module installers, module factory, DataRate setter, bounded integer readers and virtual-function callback; controlled native virtual-table slots, minimal/base/full weapon constants; SDK storage/constants, installer callback addresses and dispatch adapted, controlled construction-entry mutation, no foreign memory write, live channel/Steam/auth/weapon operation, live-game, SDK ABI or allocator/OOM claim.");
