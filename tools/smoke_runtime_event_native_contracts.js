#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

if ((process.argv.length === 3) && ["--help", "-h"].includes(process.argv[2])) {
	console.log("Usage: node tools/smoke_runtime_event_native_contracts.js\nChecks runtime event/hook/dispatch source contracts and negative regressions; does not execute V8.");
	process.exit(0);
}

if (process.argv.length !== 2) {
	console.error("Usage: node tools/smoke_runtime_event_native_contracts.js\nNo arguments are accepted except --help or -h.");
	process.exit(2);
}

const g_strSource = g_FileSystem.readFileSync(g_Path.join(__dirname, "..", "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_strRuntimeSource = g_FileSystem.readFileSync(g_Path.join(__dirname, "..", "src", "sourcejs", "V8Runtime.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_vecBoundaries = [
	"RegisterGameEventListenerCallback",
	"UnregisterGameEventListenerCallback",
	"EmitRuntimeEventCallback",
	"GetRuntimeEventListenerCountCallback",
	"AddFixedEventListenerCallback",
	"RemoveFixedEventListenerCallback",
	"EmitFixedEventCallback",
	"CreateFunctionHookCallback",
	"CreateVTableHookCallback",
	"AddPreHookCallback",
	"AddPostHookCallback",
	"RemoveHookCallback",
];
const g_vecGameEventAccessBoundaries = [
	"IsGameEventEmptyCallback",
	"GetGameEventBooleanCallback",
	"GetGameEventIntegerCallback",
	"GetGameEventUInt64Callback",
	"GetGameEventFloatCallback",
	"GetGameEventStringCallback",
	"SetGameEventBooleanCallback",
	"SetGameEventIntegerCallback",
	"SetGameEventUInt64Callback",
	"SetGameEventFloatCallback",
	"SetGameEventStringCallback",
];

const g_strPermissionSignature = "bool V8Runtime::IsEventEmissionAllowed(";
const g_strGameEventDispatchSignature = "void V8Runtime::FireGameEvent(";
const g_vecGameEventDispatchRegressions = [
	["FireGameEvent(IGameEvent* const pEvent) try {", "FireGameEvent(IGameEvent* const pEvent) {"],
	["SnapshotStoredFunctions(m_pIsolate, itGameEventCallbacks->second)", "itGameEventCallbacks->second"],
	["LocalContext = vecGameEventCallbacks[unCallbackIndex].m_Context;", "LocalContext = {};"],
	["LocalCallbackFunction = vecGameEventCallbacks[unCallbackIndex].m_Function;", "LocalCallbackFunction = {};"],
	["m_mapActiveGameEvents.emplace(unEventToken, pEvent)", "std::make_pair(m_mapActiveGameEvents.end(), true)"],
	["if (!EventInsertResult.second)", "if (false)"],
	["m_mapActiveGameEvents.erase(unEventToken);", ""],
	["throw;", ""],
	["Stage=Dispatch", "Stage=Ignored"],
];

let g_unRejectedRegressionCount = 0;

function ExtractFunction(strSource, strSignature, unIndentationLevel = 2) {
	const strIndentation = "\t".repeat(unIndentationLevel);
	const strEscapedSignature = strSignature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const DefinitionPattern = new RegExp("^" + strIndentation + strEscapedSignature + "[^\\n;{}]*\\)(?: const)?(?: noexcept)?(?: try)? \\{", "m");
	const vecDefinitionMatch = DefinitionPattern.exec(strSource);
	g_Assert.ok(vecDefinitionMatch, "Missing runtime-event definition: " + strSignature);

	const unDefinitionStart = vecDefinitionMatch.index;
	const nDefinitionEnd = strSource.indexOf("\n" + strIndentation + "}\n", unDefinitionStart);
	g_Assert.ok(nDefinitionEnd > unDefinitionStart, "Missing runtime-event definition end: " + strSignature);

	return strSource.slice(unDefinitionStart, nDefinitionEnd);
}

function AssertExtractorContracts() {
	// The prototypes deliberately test definition selection, not native execution.
	for (const unIndentationLevel of [1, 2]) {
		const strIndentation = "\t".repeat(unIndentationLevel);
		const strPrototype = strIndentation + "bool RuntimeEventExtractorProbe();\n";
		const strDefinitionBody = strIndentation + "bool RuntimeEventExtractorProbe() {\n" + strIndentation + "\treturn true;";
		g_Assert.equal(ExtractFunction(strPrototype + strDefinitionBody + "\n" + strIndentation + "}\n", "bool RuntimeEventExtractorProbe(", unIndentationLevel), strDefinitionBody);
		g_Assert.throws(() => ExtractFunction(strPrototype, "bool RuntimeEventExtractorProbe(", unIndentationLevel), g_Assert.AssertionError);
	}
}

function AssertEventContracts(strSource) {
	const strConversion = ExtractFunction(strSource, "bool ConvertEventPayload(");
	g_Assert.match(strConversion, /if \(!CallbackInformation\[nPayloadArgumentIndex\]->ToString\(LocalContext\)\.ToLocal\(&LocalString\)\) \{\s*if \(ConversionFailure\.HasCaught\(\)\) \{\s*ConversionFailure\.ReThrow\(\);\s*return false;/);
	g_Assert.match(strConversion, /if \(!pszEncodedValue\) \{\s*ThrowError\(pIsolate, kConversionError\);\s*ConversionFailure\.ReThrow\(\);\s*return false;/);
	g_Assert.match(strConversion, /if \(CallbackInformation\.Length\(\) <= nPayloadArgumentIndex\) \{\s*strPayloadOut\.clear\(\);\s*return true;/);

	for (const strCallback of ["EmitRuntimeEventCallback", "EmitFixedEventCallback"]) {
		const strEmitter = ExtractFunction(strSource, "void " + strCallback + "(");
		g_Assert.match(strEmitter, /if \(!ConvertEventPayload\(CallbackInformation, kPayloadArgumentIndex, strEventPayload\)\) \{\s*return;/);
		g_Assert.ok(!strEmitter.includes("ValueToString(CallbackInformation.GetIsolate()"));
	}

	for (const strCallback of g_vecBoundaries) {
		const strOwner = ExtractFunction(strSource, "void " + strCallback + "(");
		g_Assert.match(strOwner, /\) try \{/);
		g_Assert.ok(strOwner.includes('"' + strCallback + ' failed with a C++ exception."'));
		g_Assert.match(strOwner, /} catch \(\.\.\.\) \{\s*constexpr char kCallbackExceptionError\[\][^\n]+\s*ThrowError\(CallbackInformation\.GetIsolate\(\), kCallbackExceptionError\);/);
	}
}

function AssertRegression(strSignature, strOriginal, strReplacement) {
	const strOwner = ExtractFunction(g_strSource, strSignature);
	g_Assert.ok(strOwner.includes(strOriginal), strOriginal);
	g_Assert.equal(g_strSource.indexOf(strOwner), g_strSource.lastIndexOf(strOwner), "Event regression requires one actual definition: " + strSignature);

	const strChangedOwner = strOwner.replace(strOriginal, () => strReplacement);
	g_Assert.notEqual(strChangedOwner, strOwner, "Event regression must change its definition: " + strOriginal);

	const strChangedSource = g_strSource.replace(strOwner, () => strChangedOwner);
	g_Assert.notEqual(strChangedSource, g_strSource, "Event regression must reach the actual source: " + strSignature);
	g_Assert.throws(() => AssertEventContracts(strChangedSource), g_Assert.AssertionError, strOriginal);
	g_unRejectedRegressionCount += 1;
}

function AssertRuntimeDispatchContracts(strSource) {
	for (const strSignature of ["int V8Runtime::EmitEventResult(", "bool V8Runtime::IsEventEmissionAllowed("]) {
		const strOwner = ExtractFunction(strSource, strSignature, 1);
		g_Assert.match(strOwner, /std::vector<ScriptCallbackSnapshotRecord> const vecEventCallbacks = SnapshotStoredFunctions\(m_pIsolate, itEventCallbacks->second\);/);
		g_Assert.match(strOwner, /LocalContext = vecEventCallbacks\[unEventCallbackIndex\]\.m_Context;/);
		g_Assert.match(strOwner, /LocalCallbackFunction = vecEventCallbacks\[unEventCallbackIndex\]\.m_Function;/);
		g_Assert.doesNotMatch(strOwner, /vecEventCallbacks\[[^\]\r\n]+\]\.m_(Context|Function)\.Get\(/);
	}

	const strPermission = ExtractFunction(strSource, "bool V8Runtime::IsEventEmissionAllowed(", 1);
	g_Assert.match(strPermission, /GetRuntimeObjectBoolean\([^\n]+"Allowed", bIsObjectAllowed\);/);
	g_Assert.match(strPermission, /GetRuntimeObjectString\([^\n]+"RejectMessage", strRejectionMessage\)/);
	g_Assert.doesNotMatch(strPermission, /GetRuntimeObject(Boolean|String)\([^\n]+"(allow|allowed|reject|reason|message)"/);
	for (const strProperty of ["Reason", "Message"]) {
		g_Assert.ok(strPermission.includes('(!EventPermissionTryCatch.HasCaught() && GetRuntimeObjectString(m_pIsolate, LocalContext, LocalResultObject, "' + strProperty + '", strRejectionMessage))'));
	}

	for (const strStage of ["ReadAllowed", "ReadMessage"]) {
		const StageExpression = new RegExp(String.raw`if \(EventPermissionTryCatch\.HasCaught\(\)\) \{\s*LogError\("IsEventEmissionAllowed failed[^\n]+Stage=${strStage}:[^\n]+\);\s*continue;`);
		g_Assert.match(strPermission, StageExpression);
	}

	g_Assert.match(strPermission, /strMessageOut = std::move\(strEventMessage\);\s*return bEventAllowed;/);

	const strGameEventDispatch = ExtractFunction(strSource, "void V8Runtime::FireGameEvent(", 1);
	g_Assert.match(strGameEventDispatch, /FireGameEvent\([^\n]+\) try \{/);
	g_Assert.match(strGameEventDispatch, /std::vector<ScriptCallbackSnapshotRecord> const vecGameEventCallbacks = SnapshotStoredFunctions\(m_pIsolate, itGameEventCallbacks->second\);/);
	g_Assert.match(strGameEventDispatch, /LocalContext = vecGameEventCallbacks\[unCallbackIndex\]\.m_Context;/);
	g_Assert.match(strGameEventDispatch, /LocalCallbackFunction = vecGameEventCallbacks\[unCallbackIndex\]\.m_Function;/);
	g_Assert.match(strGameEventDispatch, /EventInsertResult = m_mapActiveGameEvents\.emplace\(unEventToken, pEvent\);\s*if \(!EventInsertResult\.second\) \{\s*LogError\([^\n]+Stage=RegisterToken[^\n]+\);\s*return;/);
	g_Assert.match(strGameEventDispatch, /} catch \(\.\.\.\) \{\s*m_mapActiveGameEvents\.erase\(unEventToken\);\s*throw;\s*}\s*m_mapActiveGameEvents\.erase\(unEventToken\);/);
	g_Assert.match(strGameEventDispatch, /} catch \(\.\.\.\) \{\s*LogError\("FireGameEvent failed Stage=Dispatch Reason=\\"C\+\+ exception\\""\);\s*$/);

	for (const strCallback of g_vecGameEventAccessBoundaries) {
		const strOwner = ExtractFunction(strSource, "void V8Runtime::" + strCallback + "(", 1);
		g_Assert.match(strOwner, /\) try \{/);
		g_Assert.ok(strOwner.includes('"' + strCallback + ' failed with a C++ exception."'));
		g_Assert.match(strOwner, /} catch \(\.\.\.\) \{\s*constexpr char kCallbackExceptionError\[\][^\n]+\s*ThrowRuntimeCallbackException\(CallbackInformation\.GetIsolate\(\), kCallbackExceptionError\);/);
	}

	for (const strMethod of ["RequireGameEventRuntimeFromArguments", "RequireActiveGameEventFromArguments"]) {
		const strResultType = (strMethod === "RequireGameEventRuntimeFromArguments") ? "V8Runtime*" : "IGameEvent*";
		const strOwner = ExtractFunction(strSource, strResultType + " V8Runtime::" + strMethod + "(", 1);
		g_Assert.match(strOwner, /if \(!LocalCallbackData->Get\(LocalContext, k(Runtime|EventToken)Index\)\.ToLocal\(&Local(Runtime|EventToken)\)\) \{\s*return nullptr;\s*}/);
	}
}

function AssertRuntimeRegression(strSignature, strOriginal, strReplacement) {
	const strOwner = ExtractFunction(g_strRuntimeSource, strSignature, 1);
	g_Assert.ok(strOwner.includes(strOriginal), strOriginal);
	g_Assert.equal(g_strRuntimeSource.indexOf(strOwner), g_strRuntimeSource.lastIndexOf(strOwner), "Runtime regression requires one actual definition: " + strSignature);

	const strChangedOwner = strOwner.replace(strOriginal, () => strReplacement);
	g_Assert.notEqual(strChangedOwner, strOwner, "Runtime regression must change its definition: " + strOriginal);

	const strChangedSource = g_strRuntimeSource.replace(strOwner, () => strChangedOwner);
	g_Assert.notEqual(strChangedSource, g_strRuntimeSource, "Runtime regression must reach the actual source: " + strSignature);
	g_Assert.throws(() => AssertRuntimeDispatchContracts(strChangedSource), g_Assert.AssertionError, strOriginal);
	g_unRejectedRegressionCount += 1;
}

AssertExtractorContracts();

AssertEventContracts(g_strSource);

AssertRegression("bool ConvertEventPayload(", "ConversionFailure.ReThrow();", "");
AssertRegression("bool ConvertEventPayload(", "if (!pszEncodedValue)", "if (false)");
AssertRegression("bool ConvertEventPayload(", "strPayloadOut.clear();", "");

for (const strCallback of ["EmitRuntimeEventCallback", "EmitFixedEventCallback"]) {
	AssertRegression("void " + strCallback + "(", "if (!ConvertEventPayload(CallbackInformation, kPayloadArgumentIndex, strEventPayload))", "if (false)");
}

for (const strCallback of g_vecBoundaries) {
	AssertRegression("void " + strCallback + "(", "ThrowError(CallbackInformation.GetIsolate(), kCallbackExceptionError);", "if (kCallbackExceptionError[0] == '\\0') {\n\t\t\t\treturn;\n\t\t\t}");
}

AssertRuntimeDispatchContracts(g_strRuntimeSource);

for (const strSignature of ["int V8Runtime::EmitEventResult(", "bool V8Runtime::IsEventEmissionAllowed("]) {
	AssertRuntimeRegression(strSignature, "SnapshotStoredFunctions(m_pIsolate, itEventCallbacks->second)", "itEventCallbacks->second");
	AssertRuntimeRegression(strSignature, "LocalContext = vecEventCallbacks[unEventCallbackIndex].m_Context;", "LocalContext = vecEventCallbacks[unEventCallbackIndex].m_Context.Get(m_pIsolate);");
}

for (const strProperty of ["Allowed", "RejectMessage", "Reason", "Message"]) {
	AssertRuntimeRegression(g_strPermissionSignature, '"' + strProperty + '"', '"' + strProperty.toLowerCase() + '"');
}

for (const strStage of ["ReadAllowed", "ReadMessage"]) {
	AssertRuntimeRegression(g_strPermissionSignature, "Stage=" + strStage + ":", "Stage=Ignored:");
}

for (const strProperty of ["Reason", "Message"]) {
	AssertRuntimeRegression(g_strPermissionSignature, '(!EventPermissionTryCatch.HasCaught() && GetRuntimeObjectString(m_pIsolate, LocalContext, LocalResultObject, "' + strProperty + '", strRejectionMessage))', 'GetRuntimeObjectString(m_pIsolate, LocalContext, LocalResultObject, "' + strProperty + '", strRejectionMessage)');
}

AssertRuntimeRegression(g_strPermissionSignature, "strMessageOut = std::move(strEventMessage);", "");

for (const vecRegression of g_vecGameEventDispatchRegressions) {
	AssertRuntimeRegression(g_strGameEventDispatchSignature, vecRegression[0], vecRegression[1]);
}

for (const strCallback of g_vecGameEventAccessBoundaries) {
	const strSignature = "void V8Runtime::" + strCallback + "(";
	AssertRuntimeRegression(strSignature, ") try {", ") {");
	AssertRuntimeRegression(strSignature, "ThrowRuntimeCallbackException(", "ThrowRuntimeError(");
}

for (const strMethod of ["RequireGameEventRuntimeFromArguments", "RequireActiveGameEventFromArguments"]) {
	const bRuntimeMethod = strMethod === "RequireGameEventRuntimeFromArguments";
	const strResultType = bRuntimeMethod ? "V8Runtime*" : "IGameEvent*";
	const strValueName = bRuntimeMethod ? "Runtime" : "EventToken";
	const strGuard = "if (!LocalCallbackData->Get(LocalContext, k" + strValueName + "Index).ToLocal(&Local" + strValueName + ")) {\n\t\t\treturn nullptr;\n\t\t}";
	AssertRuntimeRegression(strResultType + " V8Runtime::" + strMethod + "(", strGuard, strGuard.replace("return nullptr;", () => 'ThrowRuntimeError(pIsolate, "replacement error");\n\t\t\treturn nullptr;'));
}

console.log("[smoke] runtime-event/hook/dispatch source contracts and " + g_unRejectedRegressionCount + " negative regressions passed; extractor controls passed; source-only checks do not execute V8");
