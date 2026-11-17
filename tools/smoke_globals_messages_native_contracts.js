#!/usr/bin/env node

"use strict";

// Source-contract regressions; this script does not execute V8 or engine callbacks.
const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_strUsage = "Usage: node tools/smoke_globals_messages_native_contracts.js [--help]";
const g_vecCallbackContracts = [
	["IsGlobalVariablesClientCallback", "globals.GetGlobalVariables().IsClient()", "ReadGlobalVariablesClientState"],
	["GetGlobalVariablesNetworkBaseCallback", "globals.GetGlobalVariables().GetNetworkBase()", "ReadGlobalVariablesNetworkBase"],
	["IsGlobalVariablesRemoteClientCallback", "globals.GetGlobalVariables().IsRemoteClient()", "ReadGlobalVariablesRemoteClientState"],
	["GetGlobalVariablesCallback", "globals.GetGlobalVariables()", "MakeGlobalVariablesInformationObject"],
	["SendMessagesClientConsoleMessageCallback", "messages.SendClientConsoleMessage()", "pEngineServer->ClientPrintf(pPlayerEdict, strMessage.c_str());"],
	["SendMessagesClientCommandCallback", "messages.SendClientCommand()", "pEngineServer->ClientCommand(pPlayerEdict, \"%s\", strCommandLine.c_str());"],
	["GetMessagesBackendNameCallback", "messages.GetMessageBackend()", "MakeString(pIsolate, kBackendName)"],
	["GetMessagesBaseMessageConstantsCallback", "messages.GetBaseMessageConstants()", "LocalBaseMessageConstants"],
	["GetMessagesDialogTypesCallback", "messages.GetDialogTypes()", "LocalDialogTypes"],
	["GetMessagesDialogTypeCallback", "messages.GetDialogType()", "ValueToString(pIsolate, LocalDialogTypeNameValue)"],
];
const g_vecInstallationFunctions = [
	"MakeGlobalVariablesInformationObject",
	"GetMessagesBaseMessageConstantsCallback",
	"GetMessagesDialogTypesCallback",
];
const g_vecConditionalGlobals = [
	"AbsoluteFrameStartTimeStandardDeviation",
	"ServerCount",
	"EdictArrayAddress",
	"MapGroupName",
	"IsRemoteClient",
	"SimulatedTicksThisFrame",
	"NetworkProtocol",
	"MapLoadFailed",
	"IsClient",
	"GetNetworkBase",
];
const g_vecNetworkArgumentRoles = ["Tick", "EntityIndex"];
const g_vecArguments = process.argv.slice(2);
if ((g_vecArguments.length === 1) && (g_vecArguments[0] === "--help")) {
	console.log(g_strUsage);
	process.exit(0);
}

if (g_vecArguments.length !== 0) {
	console.error(g_strUsage);
	process.exit(2);
}

const g_strRootPath = g_Path.resolve(__dirname, "..");
const g_strBindings = g_FileSystem.readFileSync(g_Path.join(g_strRootPath, "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
let g_unRejectedMutations = 0;

function GetNativeFunctionRegion(strBindings, strFunctionName) {
	const vecDefinitionMatch = new RegExp("^(\\t{1,2})[^\\t\\n]*\\b" + strFunctionName + "\\([^\\n]*\\) (?:noexcept )?\\{$", "m").exec(strBindings);
	g_Assert(vecDefinitionMatch, "Missing native definition: " + strFunctionName);

	const strTerminator = "\n" + vecDefinitionMatch[1] + "}";
	const nEnd = strBindings.indexOf(strTerminator, vecDefinitionMatch.index);
	g_Assert(nEnd > vecDefinitionMatch.index, "Missing native function end: " + strFunctionName);

	return { Start: vecDefinitionMatch.index, End: nEnd + strTerminator.length, Indentation: vecDefinitionMatch[1] };
}

function GetNativeFunction(strBindings, strFunctionName) {
	const Region = GetNativeFunctionRegion(strBindings, strFunctionName);

	// Only normalize the behavioral view; mutations retain the exact source region.
	return strBindings.slice(Region.Start, Region.End).split("\n").map(strLine => strLine.startsWith(Region.Indentation) ? "\t" + strLine.slice(Region.Indentation.length) : strLine).join("\n");
}

function ReplaceNativeFunction(strBindings, strFunctionName, strBody) {
	const Region = GetNativeFunctionRegion(strBindings, strFunctionName);
	const strReplacement = strBody.split("\n").map(strLine => strLine.startsWith("\t") ? Region.Indentation + strLine.slice(1) : strLine).join("\n");

	return strBindings.slice(0, Region.Start) + strReplacement + strBindings.slice(Region.End);
}

function VerifyNativeContracts(strBindings) {
	for (const strFunctionName of [...g_vecInstallationFunctions, "RequireMessagePlayerEdict"]) {
		const strOwner = GetNativeFunction(strBindings, strFunctionName);
		g_Assert.match(strOwner, /} catch \(\.\.\.\) \{\n\t+if \((InstallationFailure|PlayerIndexFailure)\.HasCaught\(\)\) \{\n\t+\1\.ReThrow\(\);\n\t+}\n\n\t+throw;\n\t+}/, "Retain original JavaScript exceptions during native unwinding: " + strFunctionName);
	}

	for (const vecContract of g_vecCallbackContracts) {
		const strFunction = GetNativeFunction(strBindings, vecContract[0]);
		const nGuardStart = strFunction.indexOf("\n\t\tif (!pIsolate) {\n\t\t\treturn;\n\t\t}");
		const nTryStart = strFunction.indexOf("\n\t\ttry {\n");
		const nCatchStart = strFunction.indexOf("\n\t\t} catch (...) {\n\t\t\tThrowError(pIsolate, kNativeExceptionErrorMessage);\n\t\t}");
		g_Assert(nGuardStart >= 0, "Callback must guard its isolate.");
		g_Assert(nTryStart > nGuardStart, "Guard must precede the C++ boundary.");
		g_Assert(nCatchStart > nTryStart, "Callback must translate C++ exceptions.");
		g_Assert.equal((strFunction.match(/\n\t\ttry \{/g) ?? []).length, 1);
		g_Assert(strFunction.includes('constexpr char kNativeExceptionErrorMessage[] = "' + vecContract[1] + ' failed with a native C++ exception.";'));
		g_Assert(strFunction.slice(nTryStart, nCatchStart).includes(vecContract[2]), "Native work must remain protected.");
		g_Assert(strFunction.slice(nTryStart, nCatchStart).includes("CallbackInformation.GetReturnValue().Set("), "Successful result must remain protected.");

		if (strFunction.includes("pIsolate->GetCurrentContext()")) {
			g_Assert(strFunction.indexOf("pIsolate->GetCurrentContext()") > nTryStart, "Context preparation belongs inside the boundary.");
		}
	}

	const strRethrow = GetNativeFunction(strBindings, "RethrowV8InstallationFailure");
	g_Assert(strRethrow.includes("if (pszFallbackErrorMessage && !InstallationFailure.HasCaught() && !pIsolate->IsExecutionTerminating() && !pIsolate->HasPendingException()) {\n\t\t\tThrowError(pIsolate, pszFallbackErrorMessage);\n\t\t}"));
	g_Assert(strRethrow.includes("if (InstallationFailure.HasCaught()) {\n\t\t\tInstallationFailure.ReThrow();\n\t\t}"));
	g_Assert.equal((strRethrow.match(/ThrowError\(/g) ?? []).length, 1);
	g_Assert.doesNotMatch(strRethrow, /\.Reset\(|SetVerbose\(/);

	for (const strFunctionName of g_vecInstallationFunctions) {
		const strFunction = GetNativeFunction(strBindings, strFunctionName);
		const nContextGuardPosition = strFunction.indexOf("LocalContext.IsEmpty()");
		const nFrame = strFunction.indexOf("v8::TryCatch InstallationFailure(pIsolate);");
		g_Assert((nContextGuardPosition >= 0) && (nFrame > nContextGuardPosition), "Guard must precede the installation frame.");
		g_Assert(nFrame < strFunction.indexOf("v8::Object::New(pIsolate)"), "Frame must cover object construction.");

		const vecEmptyFailures = [...strFunction.slice(nFrame).matchAll(/^\t+if \([^\n]*\.IsEmpty\(\)[^\n]*\) \{\n([^\n]*)/gm)];
		g_Assert(vecEmptyFailures.length > 0);
		for (const vecEmptyFailure of vecEmptyFailures) {
			g_Assert.equal(vecEmptyFailure[1].trim(), "RethrowV8InstallationFailure(pIsolate, InstallationFailure, nullptr);", "Each originally silent empty result stays silent.");
		}

		const vecRethrows = [...strFunction.matchAll(/RethrowV8InstallationFailure\(pIsolate, InstallationFailure, [^\n]+\);/g)];
		g_Assert(vecRethrows.length > 1, "Every factory failure must propagate through the same frame.");
		for (const vecRethrow of vecRethrows) {
			g_Assert.match(strFunction.slice(vecRethrow.index + vecRethrow[0].length), /^\n\t+return(?: \{\})?;/, "Return immediately after rethrow.");
		}

		g_Assert(strFunction.includes("RethrowV8InstallationFailure(pIsolate, InstallationFailure, nullptr);"), "Originally silent empty results stay silent.");
		g_Assert.doesNotMatch(strFunction, /ThrowError\(pIsolate, k(?:InformationInstallation|Install)ErrorMessage\)/);
	}

	const strGlobalPropertyInstaller = GetNativeFunction(strBindings, "InstallGlobalVariablesInformationProperty");
	g_Assert(strGlobalPropertyInstaller.includes("GetGlobalVariablesInformationPropertyCallback, SetGlobalVariablesInformationPropertyValueCallback, LocalPropertyMetadata).FromMaybe(false);"), "Writable global fields must retain their native setter without a ReadOnly attribute.");
	g_Assert(strGlobalPropertyInstaller.includes("GetGlobalVariablesInformationPropertyCallback, nullptr, LocalPropertyMetadata, v8::ReadOnly).FromMaybe(false);"), "Omitting the native setter alone permits JavaScript shadowing; read-only global fields require the ReadOnly attribute.");

	const strGlobals = GetNativeFunction(strBindings, "MakeGlobalVariablesInformationObject");
	const strBaseProperties = strGlobals.split("kBasePropertyBindings[] = {", 2)[1].split("\n\t\t};", 1)[0];
	g_Assert.doesNotMatch(strBaseProperties, /MapLoadFailed/);
	g_Assert.equal((strGlobals.match(/"MapLoadFailed", GlobalsInformationProperty::GlobalsInformationMapLoadFailed/g) ?? []).length, 1);
	// A pure branch-local diagnostic definition does not move registration outside its SDK guard.
	g_Assert.match(strGlobals, /if constexpr \(kSDKHasGlobalMapLoadFailed<CGlobalVars>\) \{\n(?:\t+constexpr char k[A-Za-z0-9]+\[\] = "[^"\n]*";\n\n)?\t+if \(!InstallGlobalVariablesInformationProperty\([^\n]+"MapLoadFailed"/);
	g_Assert(strGlobals.includes('if (!SetRecordProperty(pIsolate, LocalContext, LocalGlobalVariablesInformation, "SDKBranch", MakeString(pIsolate, SOURCEJS_SDK_BRANCH))) {'), "SDK branch string creation and property installation must remain checked.");
	g_Assert.equal((strGlobals.match(/if constexpr \(kSDKHasGlobal/g) ?? []).length, g_vecConditionalGlobals.length);
	for (const strPropertyName of g_vecConditionalGlobals) {
		g_Assert(strGlobals.includes("if constexpr (kSDKHasGlobal" + strPropertyName + "<CGlobalVars>) {"), "Preserve SDK availability: " + strPropertyName);
	}

	const strPlayer = GetNativeFunction(strBindings, "RequireMessagePlayerEdict");
	g_Assert(strPlayer.includes("int nPlayerIndex = 0;\n\t\t{\n\t\t\tv8::TryCatch PlayerIndexFailure(pIsolate);\n\t\t\ttry {\n\t\t\t\tnPlayerIndex = GetValueIndex(pIsolate, LocalContext, LocalValue);\n\t\t\t\tif (PlayerIndexFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()) {\n\t\t\t\t\tPlayerIndexFailure.ReThrow();\n\t\t\t\t\treturn nullptr;\n\t\t\t\t}"), "Index errors and execution termination must stop before native lookup.");
	g_Assert.equal((strPlayer.match(/GetValueIndex\(/g) ?? []).length, 1, "Read Index once.");
	g_Assert(strPlayer.includes("\n\t\tauto* const pPlayerEdict = (nPlayerIndex > 0) ? GetEdictFromEntityIndex(nPlayerIndex) : nullptr;"));
	g_Assert(strPlayer.includes("if ((nPlayerIndex <= 0) || !pPlayerEdict || pPlayerEdict->IsFree())"));
	g_Assert(strPlayer.indexOf("ThrowError(pIsolate, strErrorMessage.c_str());") > strPlayer.indexOf("GetEdictFromEntityIndex"), "Generic validation must remain outside the local V8 frame.");

	for (const strFunctionName of ["SendMessagesClientConsoleMessageCallback", "SendMessagesClientCommandCallback"]) {
		const strFunction = GetNativeFunction(strBindings, strFunctionName);
		g_Assert(strFunction.includes("constexpr int kPlayerOrIndexArgumentIndex = 0;"));
		g_Assert(strFunction.includes("CallbackInformation[kPlayerOrIndexArgumentIndex], kAPIName)"));
		g_Assert(strFunction.includes("(PlayerOrIndex, str"), "Pseudo-signature must describe both accepted representations.");
	}

	const strCommand = GetNativeFunction(strBindings, "SendMessagesClientCommandCallback");
	g_Assert(strCommand.includes("std::string const strCommandLine = ValueToString(pIsolate, LocalCommandLineValue);\n\t\t\tif (strCommandLine.empty())"));

	const strNetwork = GetNativeFunction(strBindings, "GetGlobalVariablesNetworkBaseCallback");
	g_Assert(strNetwork.includes("kRequiredArgumentCount = kEntityIndexArgumentIndex + 1;"));

	const nEngineGlobalVariablesPosition = strNetwork.indexOf("RequireEngineGlobalVariables");
	for (const strArgumentRole of g_vecNetworkArgumentRoles) {
		const strGuard = `if (!GetGlobalVariablesIntegerFromValue(pIsolate, LocalContext, CallbackInformation[k${strArgumentRole}ArgumentIndex], k${strArgumentRole}ErrorMessage, n${strArgumentRole})) {\n\t\t\t\treturn;\n\t\t\t}`;
		const nGuardPosition = strNetwork.indexOf(strGuard);
		g_Assert((nGuardPosition >= 0) && (nGuardPosition < nEngineGlobalVariablesPosition));
	}

	const strConstants = GetNativeFunction(strBindings, "GetMessagesBaseMessageConstantsCallback");
	g_Assert(strConstants.includes('LocalBaseMessageConstants, "HUDDestination", LocalHUDDestinationConstants'));
	g_Assert.doesNotMatch(strConstants, /"HudDestination"/);
	g_Assert(strConstants.includes("#else\n\t\t\tThrowError(pIsolate, kUnsupportedErrorMessage);\n#endif"), "Unsupported error must not be swallowed by the supported-branch frame.");
	g_Assert(strConstants.includes("#if defined(SOURCEJS_HAS_SHAREDDEFS) && defined(SOURCEJS_HAS_SHAKE_H)\n\t\t\tv8::Local<v8::Context>"));
	g_Assert(strConstants.includes('if (!SetRecordProperty(pIsolate, LocalContext, LocalBaseMessageConstants, "SCREEN_FADE_FRACTION_BITS", v8::Integer::New(pIsolate, SCREENFADE_FRACBITS))) {'), "Screen-fade constant conversion and property installation must remain checked.");

	const strDialogs = GetNativeFunction(strBindings, "GetMessagesDialogTypesCallback");
	g_Assert(strDialogs.includes('#if defined(SOURCEJS_HAS_DIALOG_ASKCONNECT)\n\t\t\t\tif (!SetRecordProperty(pIsolate, LocalContext, LocalDialogTypes, "AskConnect", v8::Integer::New(pIsolate, DIALOG_ASKCONNECT))) {'), "AskConnect registration must remain SDK-gated and check the converted property write.");

	const strBackend = GetNativeFunction(strBindings, "GetMessagesBackendNameCallback");
	for (const strBackendName of ["protobuf", "bitbuffer", "source2"]) {
		g_Assert(strBackend.includes('kBackendName[] = "' + strBackendName + '";'));
	}
}

function RejectMutation(strFunctionName, strOriginal, strReplacement) {
	const strFunction = GetNativeFunction(g_strBindings, strFunctionName);
	g_Assert(strFunction.includes(strOriginal), "Mutation must match: " + strFunctionName);

	const strChangedFunction = strFunction.replace(strOriginal, () => strReplacement);
	g_Assert.notEqual(strChangedFunction, strFunction);

	const strChangedBindings = ReplaceNativeFunction(g_strBindings, strFunctionName, strChangedFunction);
	g_Assert.notEqual(strChangedBindings, g_strBindings, "Mutation must affect the actual source region.");
	g_Assert.throws(() => VerifyNativeContracts(strChangedBindings), { name: "AssertionError" }, "Must reject mutation in " + strFunctionName + ": " + strOriginal);
	++g_unRejectedMutations;
}

VerifyNativeContracts(g_strBindings);

for (const strFunctionName of ["MakeGlobalVariablesInformationObject", "RequireMessagePlayerEdict", "GetMessagesDialogTypeCallback"]) {
	g_Assert.equal(ReplaceNativeFunction(g_strBindings, strFunctionName, GetNativeFunction(g_strBindings, strFunctionName)), g_strBindings, "Native source extraction must round-trip: " + strFunctionName);
}

for (const vecContract of g_vecCallbackContracts) {
	RejectMutation(vecContract[0], "\n\t\tif (!pIsolate) {\n\t\t\treturn;\n\t\t}", "");
	RejectMutation(vecContract[0], "\n\t\ttry {\n", "\n\t\t{\n");
	RejectMutation(vecContract[0], "catch (...) {", "catch (int) {");
	RejectMutation(vecContract[0], '"' + vecContract[1] + ' failed with a native C++ exception."', '"Wrong operation."');
}

for (const strFunctionName of g_vecInstallationFunctions) {
	RejectMutation(strFunctionName, "v8::TryCatch InstallationFailure(pIsolate);", "v8::TryCatch DifferentFrame(pIsolate);");
	RejectMutation(strFunctionName, "LocalContext.IsEmpty()", "false");
	RejectMutation(strFunctionName, "RethrowV8InstallationFailure(pIsolate, InstallationFailure, nullptr);", "RethrowV8InstallationFailure(pIsolate, InstallationFailure, kUnexpectedError);");
	RejectMutation(strFunctionName, "RethrowV8InstallationFailure(pIsolate, InstallationFailure, nullptr);\n", "RethrowV8InstallationFailure(pIsolate, InstallationFailure, nullptr);\n\t\t\tMakeString(pIsolate, \"unsafe after rethrow\");\n");
}

for (const strFunctionName of [...g_vecInstallationFunctions, "RequireMessagePlayerEdict"]) {
	const strOwner = GetNativeFunction(g_strBindings, strFunctionName);
	const strFrame = (strFunctionName === "RequireMessagePlayerEdict") ? "PlayerIndexFailure" : "InstallationFailure";
	const vecGuard = new RegExp("if \\(" + strFrame + "\\.HasCaught\\(\\)\\) \\{\\n\\t+" + strFrame + "\\.ReThrow\\(\\);\\n\\t+}\\n\\n\\t+throw;").exec(strOwner);
	g_Assert(vecGuard, "Locate the native-unwind guard mutation: " + strFunctionName);
	RejectMutation(strFunctionName, vecGuard[0], "throw;");
}

for (const strGuard of ["pszFallbackErrorMessage && ", "!InstallationFailure.HasCaught() && ", "!pIsolate->IsExecutionTerminating() && ", " && !pIsolate->HasPendingException()", "InstallationFailure.ReThrow();"]) {
	RejectMutation("RethrowV8InstallationFailure", strGuard, "");
}

RejectMutation("InstallGlobalVariablesInformationProperty", "nullptr, LocalPropertyMetadata, v8::ReadOnly)", "nullptr, LocalPropertyMetadata)");
RejectMutation("InstallGlobalVariablesInformationProperty", "SetGlobalVariablesInformationPropertyValueCallback, LocalPropertyMetadata)", "SetGlobalVariablesInformationPropertyValueCallback, LocalPropertyMetadata, v8::ReadOnly)");
RejectMutation("RequireMessagePlayerEdict", "PlayerIndexFailure.ReThrow();", "PlayerIndexFailure.Reset();");
RejectMutation("RequireMessagePlayerEdict", "return nullptr;\n\t\t\t\t}", "// continue after Index error\n\t\t\t\t}");
RejectMutation("RequireMessagePlayerEdict", "PlayerIndexFailure.HasCaught()", "false");
RejectMutation("RequireMessagePlayerEdict", "pIsolate->IsExecutionTerminating()", "false");
RejectMutation("RequireMessagePlayerEdict", "pIsolate->HasPendingException()", "false");
RejectMutation("RequireMessagePlayerEdict", "nPlayerIndex = GetValueIndex(pIsolate, LocalContext, LocalValue);", "nPlayerIndex = GetValueIndex(pIsolate, LocalContext, LocalValue);\n\t\t\tGetValueIndex(pIsolate, LocalContext, LocalValue);");
RejectMutation("MakeGlobalVariablesInformationObject", '{ "Address",', '{ "MapLoadFailed",');
RejectMutation("MakeGlobalVariablesInformationObject", "kSDKHasGlobalMapLoadFailed<CGlobalVars>", "kSDKHasGlobalNetworkProtocol<CGlobalVars>");
RejectMutation("MakeGlobalVariablesInformationObject", '"SDKBranch", MakeString(pIsolate, SOURCEJS_SDK_BRANCH)', '"SDKBranch", MakeString(pIsolate, "wrong branch")');
RejectMutation("MakeGlobalVariablesInformationObject", 'if (!SetRecordProperty(pIsolate, LocalContext, LocalGlobalVariablesInformation, "SDKBranch",', 'if (SetRecordProperty(pIsolate, LocalContext, LocalGlobalVariablesInformation, "SDKBranch",');
RejectMutation("GetMessagesBaseMessageConstantsCallback", '"HUDDestination"', '"HudDestination"');
RejectMutation("GetMessagesBaseMessageConstantsCallback", '"SCREEN_FADE_FRACTION_BITS", v8::Integer::New(pIsolate, SCREENFADE_FRACBITS)', '"SCREEN_FADE_FRACTION_BITS", v8::Integer::New(pIsolate, 0)');
RejectMutation("GetMessagesBaseMessageConstantsCallback", 'if (!SetRecordProperty(pIsolate, LocalContext, LocalBaseMessageConstants, "SCREEN_FADE_FRACTION_BITS",', 'if (SetRecordProperty(pIsolate, LocalContext, LocalBaseMessageConstants, "SCREEN_FADE_FRACTION_BITS",');
RejectMutation("GetMessagesBaseMessageConstantsCallback", "#else\n\t\t\tThrowError(pIsolate, kUnsupportedErrorMessage);", "#else\n\t\t\tv8::TryCatch InstallationFailure(pIsolate);\n\t\t\tThrowError(pIsolate, kUnsupportedErrorMessage);");
RejectMutation("GetMessagesDialogTypesCallback", "#if defined(SOURCEJS_HAS_DIALOG_ASKCONNECT)", "#if 1");
RejectMutation("GetMessagesDialogTypesCallback", '"AskConnect", v8::Integer::New(pIsolate, DIALOG_ASKCONNECT)', '"AskConnect", v8::Integer::New(pIsolate, 0)');
RejectMutation("GetMessagesDialogTypesCallback", 'if (!SetRecordProperty(pIsolate, LocalContext, LocalDialogTypes, "AskConnect",', 'if (SetRecordProperty(pIsolate, LocalContext, LocalDialogTypes, "AskConnect",');
RejectMutation("GetGlobalVariablesNetworkBaseCallback", "kEntityIndexArgumentIndex + 1;", "2;");
RejectMutation("SendMessagesClientCommandCallback", "strCommandLine.empty()", "false");

for (const strArgumentRole of g_vecNetworkArgumentRoles) {
	const strParseCall = `GetGlobalVariablesIntegerFromValue(pIsolate, LocalContext, CallbackInformation[k${strArgumentRole}ArgumentIndex], k${strArgumentRole}ErrorMessage, n${strArgumentRole})`;
	RejectMutation("GetGlobalVariablesNetworkBaseCallback", strParseCall, strParseCall.replace("GetGlobalVariablesIntegerFromValue", "IgnoredIntegerConversion"));

	const strFunction = GetNativeFunction(g_strBindings, "GetGlobalVariablesNetworkBaseCallback");
	const strGuardBlock = "\t\t\tif (!" + strParseCall + ") {\n\t\t\t\treturn;\n\t\t\t}\n\n";
	g_Assert.equal(strFunction.split(strGuardBlock).length, 2, "Locate the exact argument-validation block: " + strArgumentRole);

	const strEngineResultDeclaration = "\t\t\tint nNetworkBase = 0;";
	g_Assert.equal(strFunction.split(strEngineResultDeclaration).length, 2, "Locate insertion after engine resolution.");

	const strDeferredFunction = strFunction.replace(strGuardBlock, "").replace(strEngineResultDeclaration, () => strGuardBlock + strEngineResultDeclaration);
	RejectMutation("GetGlobalVariablesNetworkBaseCallback", strFunction, strDeferredFunction);
}

console.log("globals/messages native source contracts PASS; rejected mutations=" + g_unRejectedMutations);
