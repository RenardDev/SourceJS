#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

if (process.argv.length > 2) {
	if ((process.argv.length === 3) && ["--help", "-h"].includes(process.argv[2])) {
		console.log("Usage: node tools/smoke_steam_native_contracts.js\nChecks source contracts only; does not execute native Steam SDK or V8 code.");
		process.exit(0);
	}

	console.error("Usage: node tools/smoke_steam_native_contracts.js");
	process.exit(2);
}

const g_strSource = g_FileSystem.readFileSync(g_Path.join(__dirname, "..", "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");

function GetNativeDefinitionRegion(strSource, strName) {
	const strEscapedName = strName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const vecDefinitions = Array.from(strSource.matchAll(new RegExp("^(\\t{1,2})(?!(?:if|for|while|switch|catch|return|else)\\b)[A-Za-z_][^\\t\\n;{}=]*[ &*]" + strEscapedName + "\\([^;\\n]*\\)(?: const)?(?: noexcept)?(?: try)? \\{$", "gm")));
	g_Assert.equal(vecDefinitions.length, 1, "Missing or ambiguous native definition: " + strName);

	const vecDefinition = vecDefinitions[0];
	const strTerminator = "\n" + vecDefinition[1] + "}";
	const nEndIndex = strSource.indexOf(strTerminator + "\n", vecDefinition.index);
	g_Assert(nEndIndex > vecDefinition.index, "Missing native definition boundary: " + strName);

	return { Start: vecDefinition.index, End: nEndIndex + strTerminator.length, Indentation: vecDefinition[1] };
}

function GetNativeParserContractView(strSource, strName) {
	const Region = GetNativeDefinitionRegion(strSource, strName);
	const nClosingLineStart = strSource.lastIndexOf("\n", Region.End - 1);
	g_Assert(nClosingLineStart > Region.Start, "Missing native parser contract boundary: " + strName);

	return strSource.slice(Region.Start, nClosingLineStart);
}

const g_strParser = GetNativeParserContractView(g_strSource, "ParseSteamUnsigned");
const g_strSteamIDParser = GetNativeParserContractView(g_strSource, "ParseSteamID");
let g_unParserRegressions = 0;
let g_unCallbackRegressions = 0;

const g_vecCallbackContracts = [
	["GetEngineServerClientSteamIDCallback", "engines/server.GetClientSteamID()"],
	["GetEngineServerSteamIDCallback", "engines/server.GetGameServerSteamID()"],
	["NormalizeSteamIDCallback", "steam.SteamIDNormalize()"],
	["ParseSteamIDCallback", "steam.SteamIDParse()"],
	["GetSteamIDFieldsCallback", "steam.SteamIDFields()"],
	["SetSteamIDCallback", "steam.SteamIDSet()"],
	["SetSteamInstancedIDCallback", "steam.SteamIDInstancedSet()"],
	["SetSteamFullIDCallback", "steam.SteamIDFullSet()"],
	["CreateBlankAnonymousLogonSteamIDCallback", "steam.SteamIDCreateBlankAnonymousLogon()"],
	["CreateBlankAnonymousUserAccountSteamIDCallback", "steam.SteamIDCreateBlankAnonymousUserAccount()"],
	["ClearSteamIDCallback", "steam.SteamIDClear()"],
	["GetSteamStaticAccountKeyCallback", "steam.SteamIDStaticAccountKey()"],
	["ClearSteamIDIndividualInstanceCallback", "steam.SteamIDClearIndividualInstance()"],
	["ConvertSteamIDToSteamID2Callback", "steam.SteamIDToSteamID2()"],
	["ConvertSteamIDToSteamID3Callback", "steam.SteamIDToSteamID3()"],
	["GetSteamNetworkIDCallback", "steam.GetNetworkID()"],
	["GetSteamXUIDCallback", "steam.GetXUID()"],
];

const g_vecNativeUnwindContracts = [
	["InstallSteamIDFunctions", "InstallationFailure"],
	["GetSteamNetworkIDCallback", "PlayerIndexFailure"],
	["GetSteamXUIDCallback", "PlayerIndexFailure"],
];

const g_vecBooleanContracts = [
	["IsSteamIDValid", "SteamIDIsValid", "SteamID.IsValid() && IsSteamKnownAccountType(static_cast<int>(SteamID.GetEAccountType()))"],
	["IsSteamIDBlankAnonymousAccount", "SteamIDIsBlankAnonymousAccount", "SteamID.BBlankAnonAccount()"],
	["IsSteamIDGameServerAccount", "SteamIDIsGameServerAccount", "SteamID.BGameServerAccount()"],
	["IsSteamIDPersistentGameServerAccount", "SteamIDIsPersistentGameServerAccount", "static_cast<int>(SteamID.GetEAccountType()) == k_EAccountTypeGameServer"],
	["IsSteamIDAnonymousGameServerAccount", "SteamIDIsAnonymousGameServerAccount", "static_cast<int>(SteamID.GetEAccountType()) == k_EAccountTypeAnonGameServer"],
	["IsSteamIDContentServerAccount", "SteamIDIsContentServerAccount", "SteamID.BContentServerAccount()"],
	["IsSteamIDClanAccount", "SteamIDIsClanAccount", "SteamID.BClanAccount()"],
	["IsSteamIDChatAccount", "SteamIDIsChatAccount", "SteamID.BChatAccount()"],
	["IsSteamIDLobby", "SteamIDIsLobby", "SteamID.BChatAccount() && ((SteamID.GetUnAccountInstance() & k_EChatInstanceFlagLobby) != 0)"],
	["IsSteamIDIndividualAccount", "SteamIDIsIndividualAccount", "SteamID.BIndividualAccount() || IsSteamConsoleUserAccountType(static_cast<int>(SteamID.GetEAccountType()))"],
	["IsSteamIDAnonymousUserAccount", "SteamIDIsAnonymousUserAccount", "IsSteamAnonymousUserAccountType(static_cast<int>(SteamID.GetEAccountType()))"],
	["IsSteamIDAnonymousAccount", "SteamIDIsAnonymousAccount", "SteamID.BBlankAnonAccount() || IsSteamAnonymousUserAccountType(static_cast<int>(SteamID.GetEAccountType()))"],
	["IsSteamIDConsoleUserAccount", "SteamIDIsConsoleUserAccount", "IsSteamConsoleUserAccountType(static_cast<int>(SteamID.GetEAccountType()))"],
	["DoesSteamIDHaveNoIndividualInstance", "SteamIDHasNoIndividualInstance", "(SteamID.BIndividualAccount() || IsSteamConsoleUserAccountType(static_cast<int>(SteamID.GetEAccountType()))) && (SteamID.GetUnAccountInstance() == 0)"],
];

const g_vecSDKConstants = [
	["InvalidSteamUniverse", "k_EUniverseInvalid"],
	["PublicSteamUniverse", "k_EUniversePublic"],
	["BetaSteamUniverse", "k_EUniverseBeta"],
	["InternalSteamUniverse", "k_EUniverseInternal"],
	["DevelopmentSteamUniverse", "k_EUniverseDev"],
	["MaximumSteamUniverse", "k_EUniverseMax"],
	["InvalidSteamAccountType", "k_EAccountTypeInvalid"],
	["IndividualSteamAccountType", "k_EAccountTypeIndividual"],
	["MultiseatSteamAccountType", "k_EAccountTypeMultiseat"],
	["GameServerSteamAccountType", "k_EAccountTypeGameServer"],
	["AnonymousGameServerSteamAccountType", "k_EAccountTypeAnonGameServer"],
	["PendingSteamAccountType", "k_EAccountTypePending"],
	["ContentServerSteamAccountType", "k_EAccountTypeContentServer"],
	["ClanSteamAccountType", "k_EAccountTypeClan"],
	["ChatSteamAccountType", "k_EAccountTypeChat"],
];

function AssertUnsignedParser(strParser) {
	g_Assert.match(strParser, /std::isspace\(static_cast<unsigned char>\(strValue\[unFirstNonWhitespaceIndex\]\)\)/);
	g_Assert.match(strParser, /if \(\(unFirstNonWhitespaceIndex == strValue\.size\(\)\) \|\| \(strValue\[unFirstNonWhitespaceIndex\] == '-'\)\) \{\s*return false;/);
	g_Assert.match(strParser, /pszParseEnd != \(strValue\.c_str\(\) \+ strValue\.size\(\)\)/);
	g_Assert.match(strParser, /std::strtoull\([^\n]+\n\s*const int nParseError = errno;/);
	g_Assert.match(strParser, /nParseError == ERANGE/);
	g_Assert.match(strParser, /unParsedValue > kMaximumUInt64/);
}

function AssertRegression(strOriginal, strReplacement) {
	g_Assert.equal(g_strParser.split(strOriginal).length, 2, strOriginal);

	const strMutatedParser = g_strParser.replace(strOriginal, () => strReplacement);
	g_Assert.notEqual(strMutatedParser, g_strParser, strOriginal);
	g_Assert.throws(() => AssertUnsignedParser(strMutatedParser), g_Assert.AssertionError, strOriginal);
	++g_unParserRegressions;
}

function AssertSteamIDRanges(strParser) {
	g_Assert.match(strParser, /kMaximumUniverse = static_cast<std::uint64_t>\(k_EUniverseMax\) - 1;/);
	g_Assert.match(strParser, /kAccountInstanceBitCount = 20;/);
	g_Assert.match(strParser, /kMaximumSteamID3AccountInstance = \(std::uint64_t\(1\) << kAccountInstanceBitCount\) - 1;/);
	g_Assert.match(strParser, /\(unAccountInstance > kMaximumSteamID3AccountInstance\)/);
	g_Assert.ok(strParser.indexOf("unAccountInstance > kMaximumSteamID3AccountInstance") < strParser.indexOf("SteamIDOut.InstancedSet("));
}

function AssertSteamIDRegression(strOriginal, strReplacement) {
	g_Assert.equal(g_strSteamIDParser.split(strOriginal).length, 2, strOriginal);

	const strMutatedParser = g_strSteamIDParser.replace(strOriginal, () => strReplacement);
	g_Assert.notEqual(strMutatedParser, g_strSteamIDParser, strOriginal);
	g_Assert.throws(() => AssertSteamIDRanges(strMutatedParser), g_Assert.AssertionError, strOriginal);
	++g_unParserRegressions;
}

function GetNativeDefinition(strSource, strName) {
	const Region = GetNativeDefinitionRegion(strSource, strName);

	// Normalize only the contract view; mutations must edit the exact source region.
	return strSource.slice(Region.Start, Region.End).split("\n").map(strLine => strLine.startsWith(Region.Indentation) ? "\t" + strLine.slice(Region.Indentation.length) : strLine).join("\n");
}

function ReplaceNativeDefinition(strSource, strName, strBody) {
	const Region = GetNativeDefinitionRegion(strSource, strName);
	const strReplacement = strBody.split("\n").map(strLine => strLine.startsWith("\t") ? Region.Indentation + strLine.slice(1) : strLine).join("\n");

	return strSource.slice(0, Region.Start) + strReplacement + strSource.slice(Region.End);
}

function VerifyNativeDefinitionExtraction() {
	// Deliberate prototype/call-before-definition fixtures, not production-code templates.
	for (const strIndent of ["\t", "\t\t"]) {
		const strPrototype = strIndent + "bool Probe();\n";
		const strCaller = strIndent + "void Caller() {\n" + strIndent + "\tif (Probe()) {\n" + strIndent + "\t}\n" + strIndent + "}\n";
		const strDefinition = strIndent + "bool Probe() {\n" + strIndent + "\treturn true;\n" + strIndent + "}";
		const strSource = strPrototype + strCaller + strDefinition + "\n";
		const strExpected = "\tbool Probe() {\n\t\treturn true;\n\t}";
		g_Assert.equal(GetNativeDefinition(strSource, "Probe"), strExpected);
		g_Assert.equal(GetNativeParserContractView(strSource, "Probe"), strDefinition.slice(0, strDefinition.lastIndexOf("\n")));
		g_Assert.equal(ReplaceNativeDefinition(strSource, "Probe", strExpected), strSource);
		g_Assert.throws(() => GetNativeDefinitionRegion(strPrototype + strCaller, "Probe"), g_Assert.AssertionError);
		g_Assert.throws(() => GetNativeParserContractView(strPrototype + strCaller, "Probe"), g_Assert.AssertionError);
	}
}

function AssertCallbackContracts(strSource) {
	for (const vecContract of g_vecNativeUnwindContracts) {
		const Pattern = new RegExp("} catch \\(\\.\\.\\.\\) \\{\\n\\t+if \\(" + vecContract[1] + "\\.HasCaught\\(\\)\\) \\{\\n\\t+" + vecContract[1] + "\\.ReThrow\\(\\);\\n\\t+}\\n\\n\\t+throw;\\n\\t+}");
		g_Assert.match(GetNativeDefinition(strSource, vecContract[0]), Pattern, "Retain the original JavaScript error during native unwinding: " + vecContract[0]);
	}

	for (const strName of ["GetSteamNetworkIDCallback", "GetSteamXUIDCallback"]) {
		const strCallback = GetNativeDefinition(strSource, strName);
		const nFrame = strCallback.indexOf("v8::TryCatch PlayerIndexFailure(pIsolate);");
		const nRead = strCallback.indexOf("GetIntegerFromValue(");
		const nRethrow = strCallback.indexOf("PlayerIndexFailure.ReThrow();");
		const nLookup = strCallback.indexOf("RequireEngineServer(");
		g_Assert((nFrame >= 0) && (nRead > nFrame) && (nRethrow > nRead) && (nLookup > nRethrow));
		g_Assert.match(strCallback, /PlayerIndexFailure\.HasCaught\(\) \|\| pIsolate->IsExecutionTerminating\(\) \|\| pIsolate->HasPendingException\(\)/);
		g_Assert.match(strCallback, /PlayerIndexFailure\.ReThrow\(\);\n\t+return;/);
		g_Assert.match(strCallback, /if \(!bHasPlayerIndex\) \{\n\t+ThrowError\(pIsolate, kGetSteam(?:NetworkID|XUID)ArgumentsErrorMessage\);\n\t+return;/);
	}

	const strWorker = GetNativeDefinition(strSource, "SetSteamBooleanCallbackResult");
	g_Assert.match(strWorker, /CallbackInformation\.GetIsolate\(\);\n\t+if \(!pIsolate\) \{\n\t+return;/);
	g_Assert.match(strWorker, /try \{[\s\S]*GetSteamIDArgument\([\s\S]*GetReturnValue\(\)\.Set\(Predicate\(SteamID\)\);[\s\S]*catch \(\.\.\.\)/);
	g_Assert.match(strWorker, /!pIsolate->IsExecutionTerminating\(\) && !pIsolate->HasPendingException\(\)/);
	g_Assert(strWorker.includes("ThrowError(pIsolate, pszNativeExceptionErrorMessage);"));

	const nMacroStart = strSource.indexOf("#define SOURCEJS_STEAM_BOOLEAN_CALLBACK(");
	g_Assert(nMacroStart >= 0, "Find the generated boolean callback definition.");

	const vecFirstInvocation = /^\t{1,2}SOURCEJS_STEAM_BOOLEAN_CALLBACK\(/m.exec(strSource.slice(nMacroStart));
	g_Assert(vecFirstInvocation, "Find the first generated boolean callback.");
	const nMacroEnd = nMacroStart + vecFirstInvocation.index;
	g_Assert((nMacroStart >= 0) && (nMacroEnd > nMacroStart));
	const strMacro = strSource.slice(nMacroStart, nMacroEnd);
	g_Assert(strMacro.includes("auto const Predicate = [](CSteamID const& SteamID) -> bool {"));
	g_Assert(strMacro.includes("return (RESULT_EXPRESSION);"));
	g_Assert(strMacro.includes("k##CALLBACK_NAME##NativeExceptionErrorMessage[] = NATIVE_EXCEPTION_ERROR_MESSAGE;"));
	g_Assert(strMacro.includes("SetSteamBooleanCallbackResult(CallbackInformation, k##CALLBACK_NAME##ArgumentsErrorMessage, k##CALLBACK_NAME##NativeExceptionErrorMessage, Predicate);"));
	g_Assert.equal([...strSource.matchAll(/^\t{1,2}SOURCEJS_STEAM_BOOLEAN_CALLBACK\(/gm)].length, g_vecBooleanContracts.length);
	for (const vecContract of g_vecBooleanContracts) {
		const strInvocation = "SOURCEJS_STEAM_BOOLEAN_CALLBACK(" + vecContract[0] + ', "steam.' + vecContract[1] + '(unSteamID) expects a BigInt SteamID value.", "steam.' + vecContract[1] + '() failed with a native C++ exception.", ' + vecContract[2] + ")";
		g_Assert(strSource.split("\n").some(strLine => strLine.trimStart() === strInvocation), vecContract[0]);
	}

	const strInstaller = GetNativeDefinition(strSource, "InstallSteamIDFunctions");
	for (const vecConstant of g_vecSDKConstants) {
		g_Assert(strInstaller.includes("constexpr int k" + vecConstant[0] + " = static_cast<int>(" + vecConstant[1] + ");"));
	}

	g_Assert(strInstaller.includes("kSteamIDByteSize = static_cast<int>(sizeof(CSteamID));"));
	g_Assert(strInstaller.includes("static_assert(sizeof(CSteamID) == sizeof(std::uint64_t));"));

	const nInstallationFrame = strInstaller.indexOf("v8::TryCatch InstallationFailure(pIsolate);");
	g_Assert(nInstallationFrame > strInstaller.indexOf("if (!pIsolate"));
	const strInstallationBody = strInstaller.slice(nInstallationFrame);
	g_Assert.equal((strInstallationBody.match(/return false;/g) ?? []).length, (strInstallationBody.match(/RethrowV8InstallationFailure\(pIsolate, InstallationFailure, nullptr\);\n\t+return false;/g) ?? []).length);

	for (const vecContract of g_vecCallbackContracts) {
		const strCallback = GetNativeDefinition(strSource, vecContract[0]);
		const nIsolate = strCallback.indexOf("CallbackInformation.GetIsolate()");
		const nTry = strCallback.indexOf("\n\t\ttry {");
		const nCatch = strCallback.indexOf("\n\t\t} catch (...) {");
		g_Assert((nIsolate >= 0) && (nTry > nIsolate) && (nCatch > nTry));
		g_Assert(strCallback.includes('kNativeExceptionErrorMessage[] = "' + vecContract[1] + ' failed with a native C++ exception.";'));
		g_Assert.match(strCallback.slice(nCatch), /if \(!pIsolate->IsExecutionTerminating\(\) && !pIsolate->HasPendingException\(\)\)/);
		g_Assert(strCallback.slice(nCatch).includes("ThrowError(pIsolate, kNativeExceptionErrorMessage);"));
	}

	const strClient = GetNativeDefinition(strSource, "GetEngineServerClientSteamIDCallback");
	g_Assert(strClient.includes("kMinimumGetClientSteamIDArgumentCount = kClientSteamIDPlayerArgumentIndex + 1;"));
	g_Assert(strClient.includes("GetClientSteamID(PlayerOrIndex, bValidatedOnly?)"));
	g_Assert.doesNotMatch(strClient, /GetClientSteamID\((?!PlayerOrIndex|\))[^"\n]*\)/);

	const nFrame = strClient.indexOf("v8::TryCatch ClientIndexFailure(pIsolate);");
	const nRead = strClient.indexOf("GetValueIndex(");
	const nLookup = strClient.indexOf("GetEdictFromEntityIndex(");
	g_Assert((nFrame >= 0) && (nRead > nFrame) && (nLookup > nRead));
	g_Assert.match(strClient, /ClientIndexFailure\.HasCaught\(\) \|\| pIsolate->IsExecutionTerminating\(\) \|\| pIsolate->HasPendingException\(\)/);
	g_Assert.match(strClient, /ClientIndexFailure\.ReThrow\(\);\n\t+return;\n\t+}\n\n\t+nClientSteamIDPlayerIndex = nReadClientSteamIDPlayerIndex;/);
	g_Assert.match(GetNativeDefinition(strSource, "GetEngineServerSteamIDDirect"), /auto const\* const pGameServerSteamID = pEngineServer->GetGameServerSteamID\(\);\n\t+bGameServerSteamIDMethodAvailableOut = true;\n\t+return pGameServerSteamID;/);
	g_Assert(GetNativeDefinition(strSource, "ParseSteamIDCallback").includes("kMinimumParseSteamIDArgumentCount = kSteamIDTextArgumentIndex + 1;"));
	g_Assert(GetNativeDefinition(strSource, "NormalizeSteamIDCallback").includes("SteamIDNormalize(unSteamID) expects"));
	for (const vecContract of [
		["ValidateSteamUniverse", "nUniverse", "k_EUniverseInvalid", "k_EUniverseMax"],
		["ValidateSteamAccountType", "nAccountType", "k_EAccountTypeInvalid", "k_EAccountTypeMax"],
	]) {
		const strValidation = GetNativeDefinition(strSource, vecContract[0]);
		g_Assert(strValidation.includes(vecContract[1] + " < static_cast<int>(" + vecContract[2] + ")"));
		g_Assert(strValidation.includes(vecContract[1] + " >= static_cast<int>(" + vecContract[3] + ")"));
		g_Assert.match(strValidation, /ThrowError\(pIsolate, pszErrorMessage\);\n\t+return false;/);
	}

	for (const strName of ["SetSteamIDCallback", "SetSteamInstancedIDCallback", "SetSteamFullIDCallback", "CreateBlankAnonymousLogonSteamIDCallback", "CreateBlankAnonymousUserAccountSteamIDCallback"]) {
		const strCallback = GetNativeDefinition(strSource, strName);
		const nConstruction = strCallback.indexOf("CSteamID SteamID {};");
		const nUniverseValidation = strCallback.indexOf("if (!ValidateSteamUniverse(pIsolate, nUniverse, ");
		g_Assert((nUniverseValidation >= 0) && (nConstruction > nUniverseValidation));

		if (strCallback.includes("int nAccountType = 0;")) {
			const nAccountValidation = strCallback.indexOf("if (!ValidateSteamAccountType(pIsolate, nAccountType, ");
			g_Assert((nAccountValidation > nUniverseValidation) && (nConstruction > nAccountValidation));
		}
	}

	const strInstanced = GetNativeDefinition(strSource, "SetSteamInstancedIDCallback");
	g_Assert(strInstanced.includes("kMaximumSteamAccountInstance = static_cast<std::uint32_t>(k_unSteamAccountInstanceMask);"));
	g_Assert.match(strInstanced, /if \(unAccountInstance > kMaximumSteamAccountInstance\) \{\n\t+ThrowError\(pIsolate, kSetSteamInstancedIDArgumentsErrorMessage\);\n\t+return;/);
	g_Assert(strInstanced.indexOf("unAccountInstance > kMaximumSteamAccountInstance") < strInstanced.indexOf("SteamID.InstancedSet("));
}

function AssertCallbackRegression(strName, strOriginal, strReplacement) {
	const strDefinition = GetNativeDefinition(g_strSource, strName);
	g_Assert.equal(ReplaceNativeDefinition(g_strSource, strName, strDefinition), g_strSource, "The contract view must round-trip without changing source.");
	g_Assert(strDefinition.includes(strOriginal), strOriginal);

	const strMutatedSource = ReplaceNativeDefinition(g_strSource, strName, strDefinition.replace(strOriginal, () => strReplacement));
	g_Assert.notEqual(strMutatedSource, g_strSource, "The mutation must change the actual source region.");
	g_Assert.throws(() => AssertCallbackContracts(strMutatedSource), g_Assert.AssertionError, strName + ": " + strOriginal);
	++g_unCallbackRegressions;
}

VerifyNativeDefinitionExtraction();

// Replacements intentionally include invalid C++ and legacy diagnostic names.
AssertUnsignedParser(g_strParser);
AssertRegression("static_cast<unsigned char>(strValue[unFirstNonWhitespaceIndex])", "strValue[unFirstNonWhitespaceIndex]");
AssertRegression("strValue[unFirstNonWhitespaceIndex] == '-'", "strValue[0] == '-'");
AssertRegression("pszParseEnd != (strValue.c_str() + strValue.size())", "*pszParseEnd != '\\0'");
AssertRegression("const int nParseError = errno;", "const int nParseError = 0;");
AssertRegression("nParseError == ERANGE", "false");
AssertRegression("unParsedValue > kMaximumUInt64", "false");

AssertSteamIDRanges(g_strSteamIDParser);
AssertSteamIDRegression("static_cast<std::uint64_t>(k_EUniverseMax) - 1", "std::numeric_limits<int>::max()");
AssertSteamIDRegression("(std::uint64_t(1) << kAccountInstanceBitCount) - 1", "std::numeric_limits<std::uint32_t>::max()");
AssertSteamIDRegression("unAccountInstance > kMaximumSteamID3AccountInstance", "false");

AssertCallbackContracts(g_strSource);
for (const vecContract of g_vecNativeUnwindContracts) {
	const Pattern = new RegExp("if \\(" + vecContract[1] + "\\.HasCaught\\(\\)\\) \\{\\n\\t+" + vecContract[1] + "\\.ReThrow\\(\\);\\n\\t+}\\n\\n\\t+throw;");
	const vecGuard = Pattern.exec(GetNativeDefinition(g_strSource, vecContract[0]));
	g_Assert(vecGuard, "Locate the native-unwind guard control: " + vecContract[0]);
	AssertCallbackRegression(vecContract[0], vecGuard[0], "throw;");
}

for (const vecContract of g_vecCallbackContracts) {
	AssertCallbackRegression(vecContract[0], "CallbackInformation.GetIsolate()", "nullptr");
	AssertCallbackRegression(vecContract[0], "\t\ttry {", "\t\t{");
	AssertCallbackRegression(vecContract[0], "!pIsolate->IsExecutionTerminating()", "true");
	AssertCallbackRegression(vecContract[0], "!pIsolate->HasPendingException()", "true");
	AssertCallbackRegression(vecContract[0], vecContract[1] + " failed with a native C++ exception.", "Wrong operation.");
}

AssertCallbackRegression("GetEngineServerClientSteamIDCallback", "v8::TryCatch ClientIndexFailure(pIsolate);", "v8::TryCatch WrongFrame(pIsolate);");
AssertCallbackRegression("GetEngineServerClientSteamIDCallback", "ClientIndexFailure.HasCaught()", "false");
AssertCallbackRegression("GetEngineServerClientSteamIDCallback", "ClientIndexFailure.ReThrow();", "ClientIndexFailure.Reset();");
AssertCallbackRegression("GetEngineServerClientSteamIDCallback", "GetClientSteamID(PlayerOrIndex", "GetClientSteamID(playerIndex");
AssertCallbackRegression("GetEngineServerClientSteamIDCallback", "kClientSteamIDPlayerArgumentIndex + 1;", "2;");
AssertCallbackRegression("GetEngineServerSteamIDDirect", "bGameServerSteamIDMethodAvailableOut = true;\n\t\t\treturn pGameServerSteamID;", "return pGameServerSteamID;");
AssertCallbackRegression("NormalizeSteamIDCallback", "SteamIDNormalize(unSteamID) expects", "SteamIDNormalize(steamID) expects");
AssertCallbackRegression("ParseSteamIDCallback", "kSteamIDTextArgumentIndex + 1;", "2;");
for (const strName of ["SetSteamIDCallback", "SetSteamInstancedIDCallback", "SetSteamFullIDCallback", "CreateBlankAnonymousLogonSteamIDCallback", "CreateBlankAnonymousUserAccountSteamIDCallback"]) {
	AssertCallbackRegression(strName, "if (!ValidateSteamUniverse(", "if (!SkipSteamUniverse(");
}

for (const strName of ["SetSteamIDCallback", "SetSteamInstancedIDCallback", "SetSteamFullIDCallback"]) {
	AssertCallbackRegression(strName, "if (!ValidateSteamAccountType(", "if (!SkipSteamAccountType(");
}

for (const vecContract of [["ValidateSteamUniverse", "nUniverse", "k_EUniverseInvalid", "k_EUniverseMax"], ["ValidateSteamAccountType", "nAccountType", "k_EAccountTypeInvalid", "k_EAccountTypeMax"]]) {
	AssertCallbackRegression(vecContract[0], vecContract[1] + " < static_cast<int>(" + vecContract[2] + ")", "false");
	AssertCallbackRegression(vecContract[0], vecContract[1] + " >= static_cast<int>(" + vecContract[3] + ")", "false");
}

AssertCallbackRegression("SetSteamInstancedIDCallback", "static_cast<std::uint32_t>(k_unSteamAccountInstanceMask)", "std::numeric_limits<std::uint32_t>::max()");
AssertCallbackRegression("SetSteamInstancedIDCallback", "unAccountInstance > kMaximumSteamAccountInstance", "false");

for (const strName of ["GetSteamNetworkIDCallback", "GetSteamXUIDCallback"]) {
	AssertCallbackRegression(strName, "v8::TryCatch PlayerIndexFailure(pIsolate);", "v8::TryCatch WrongFrame(pIsolate);");
	AssertCallbackRegression(strName, "PlayerIndexFailure.HasCaught()", "false");
	AssertCallbackRegression(strName, "PlayerIndexFailure.ReThrow();", "PlayerIndexFailure.Reset();");
	AssertCallbackRegression(strName, "if (!bHasPlayerIndex)", "if (false)");
}

for (const vecRegression of [
	["CallbackInformation.GetIsolate()", "nullptr"],
	["try {", "{"],
	["Predicate(SteamID)", "true"],
	["!pIsolate->IsExecutionTerminating()", "true"],
	["!pIsolate->HasPendingException()", "true"],
	["ThrowError(pIsolate, pszNativeExceptionErrorMessage);", "return;"],
]) {
	AssertCallbackRegression("SetSteamBooleanCallbackResult", vecRegression[0], vecRegression[1]);
}

for (const vecConstant of g_vecSDKConstants) {
	AssertCallbackRegression("InstallSteamIDFunctions", "static_cast<int>(" + vecConstant[1] + ")", "99");
}

AssertCallbackRegression("InstallSteamIDFunctions", "sizeof(CSteamID)", "sizeof(std::uint64_t)");
AssertCallbackRegression("InstallSteamIDFunctions", "static_assert(sizeof(CSteamID) == sizeof(std::uint64_t));", "");
AssertCallbackRegression("InstallSteamIDFunctions", "v8::TryCatch InstallationFailure(pIsolate);", "");
AssertCallbackRegression("InstallSteamIDFunctions", "RethrowV8InstallationFailure(pIsolate, InstallationFailure, nullptr);", "");

for (const strOriginal of [
	"return (RESULT_EXPRESSION);",
	"auto const Predicate = [](CSteamID const& SteamID) -> bool {",
	"k##CALLBACK_NAME##NativeExceptionErrorMessage[] = NATIVE_EXCEPTION_ERROR_MESSAGE;",
	"SetSteamBooleanCallbackResult(CallbackInformation, k##CALLBACK_NAME##ArgumentsErrorMessage, k##CALLBACK_NAME##NativeExceptionErrorMessage, Predicate);",
	...g_vecBooleanContracts.map((vecContract) => "steam." + vecContract[1] + "() failed with a native C++ exception."),
]) {
	g_Assert(g_strSource.includes(strOriginal));

	const strMutatedSource = g_strSource.replace(strOriginal, () => "REMOVED");
	g_Assert.notEqual(strMutatedSource, g_strSource, strOriginal);
	g_Assert.throws(() => AssertCallbackContracts(strMutatedSource), g_Assert.AssertionError);
	++g_unCallbackRegressions;
}

console.log("Steam source contracts passed: " + g_unParserRegressions + " parser regressions and " + g_unCallbackRegressions + " callback/construction regressions; source-only, no native Steam SDK or V8 execution.");
