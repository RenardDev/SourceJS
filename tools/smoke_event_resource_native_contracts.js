#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_strUsage = "Usage: node tools/smoke_event_resource_native_contracts.js [--help]";
const g_vecNativeBoundaryCallbacks = [
	"GetGameEventManagerAddressCallback",
	"GetFireEventHookOptionsCallback",
	"GetEventAddressCallback",
	"GetEventNameCallback",
	"GetEventInformationCallback",
	"IsEventEmptyCallback",
	"GetEventBooleanCallback",
	"GetEventIntegerCallback",
	"GetEventUInt64Callback",
	"GetEventFloatCallback",
	"GetEventStringCallback",
	"SetEventBooleanCallback",
	"SetEventIntegerCallback",
	"SetEventUInt64Callback",
	"SetEventFloatCallback",
	"SetEventStringCallback",
	"FreeGameEventCallback",
	"FireGameEventCallback",
	"CreateEventVariableCallback",
	"InferEventVariableCallback",
	"CoerceEventVariableCallback",
	"GetEventVariableTypesCallback",
	"CreateEventResourceTextCallback",
	"BuildEventResourceLineCallback",
	"DescribeEventResourceCallback",
	"LoadEventsFromFileCallback",
	"CustomEventFireMethodCallback",
	"CreateEventPayloadCallback",
	"CreateCustomEventCallback",
	"GetPlayerCallback",
	"GetAllPlayersCallback",
	"GetHumanPlayersCallback",
	"GetBotPlayersCallback",
	"GetPlayersByTeamCallback",
	"GetTeamNumberCallback",
	"GetTeamNameCallback",
];
const g_vecEventOwners = [
	{ SignaturePrefix: "bool SetGameEventPayloadFromObject(", Catcher: "PayloadFailure", Indentation: 4 },
	{ SignaturePrefix: "void GetFireEventHookOptionsCallback(", Catcher: "HookOptionsFailure", Indentation: 4 },
	{ SignaturePrefix: "void GetEventNameCallback(", Catcher: "NameFailure", Indentation: 4 },
	{ SignaturePrefix: "void GetEventInformationCallback(", Catcher: "EventInformationFailure", Indentation: 4 },
	{ SignaturePrefix: "void GetEventStringCallback(", Catcher: "StringFailure", Indentation: 4 },
];

const g_vecArguments = process.argv.slice(2);
if ((g_vecArguments.length === 1) && (g_vecArguments[0] === "--help")) {
	console.log(g_strUsage);
	process.exit(0);
}

if (g_vecArguments.length !== 0) {
	console.error(g_strUsage);
	process.exit(2);
}

const g_strSource = g_FileSystem.readFileSync(g_Path.join(__dirname, "..", "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
let g_unRegressionCount = 0;

function ExtractFunction(strSource, strSignaturePrefix, unIndentationLevel = 2) {
	const strIndentation = "\t".repeat(unIndentationLevel);
	const nDefinitionStart = strSource.indexOf("\n" + strIndentation + strSignaturePrefix);
	const nStart = nDefinitionStart + 1;
	const nEnd = strSource.indexOf("\n" + strIndentation + "}\n", nStart);
	g_Assert.ok((nDefinitionStart >= 0) && (nEnd > nStart), strSignaturePrefix);

	return strSource.slice(nStart, nEnd);
}

function AssertGameEventContracts(strSource) {
	for (const strCallbackName of g_vecNativeBoundaryCallbacks) {
		const strCallback = ExtractFunction(strSource, "void " + strCallbackName + "(");
		g_Assert.ok(strCallback.includes(") try {"));
		g_Assert.match(strCallback, /\n\t\t} catch \(\.\.\.\) \{\s*ThrowError\(CallbackInformation\.GetIsolate\(\), "[^"\n]+C\+\+ exception\."\);/);
	}

	for (const Guard of g_vecEventOwners) {
		const strOwner = ExtractFunction(strSource, Guard.SignaturePrefix);
		g_Assert.ok(strOwner.includes("v8::TryCatch " + Guard.Catcher + "(pIsolate);\n\t\t\ttry {"));
		const strPattern = "} catch \\(\\.\\.\\.\\) \\{\\s*if \\(" + Guard.Catcher + "\\.HasCaught\\(\\)\\) \\{\\s*" + Guard.Catcher + "\\.ReThrow\\(\\);\\s*}\\s*throw;";
		g_Assert.match(strOwner, new RegExp(strPattern));
	}

	const strUInt64Installer = ExtractFunction(strSource, "bool InstallEventHookUInt64Functions(");
	for (const strOperation of ["Get", "Set"]) {
		const strCall = 'SetRecordFunction(pIsolate, LocalContext, LocalTargetObject, "' + strOperation + 'UInt64", ' + strOperation + 'EventUInt64Callback<TEvent>, LocalRuntimeData)';
		g_Assert.ok(strUInt64Installer.includes(strCall));
	}

	const strSetter = ExtractFunction(strSource, "bool SetGameEventValueFromV8(");
	g_Assert.ok(strSetter.includes("if (strValue.find('\\0') != std::string::npos)"));

	const strPayload = ExtractFunction(strSource, "bool SetGameEventPayloadFromObject(");
	g_Assert.ok(strPayload.includes("RequireEventStringFromValue(pIsolate, LocalKey, kPayloadKeyEncodingError, kAllowEmptyKey, strKey)"));
	g_Assert.ok(!strPayload.includes("ValueToString("));
	g_Assert.equal((strPayload.match(/PayloadFailure\.ReThrow\(\);/g) ?? []).length, 9);
	g_Assert.ok(strPayload.includes("if (strKey.find('\\0') != std::string::npos)"));

	const strFire = ExtractFunction(strSource, "bool FireGameEvent(");
	g_Assert.ok(strFire.includes("if (strName.find('\\0') != std::string::npos)"));
	g_Assert.ok(strFire.includes("std::unique_ptr<IGameEvent, decltype(FreeEvent)>"));
	g_Assert.ok(strFire.includes("SetGameEventPayloadFromObject<IGameEvent>(pIsolate, LocalContext, pEvent.get(),"));
	g_Assert.ok(strFire.includes("pEventManager->FireEvent(pEvent.release(), bDoNotBroadcast)"));

	const strKey = ExtractFunction(strSource, "bool GetEventHookKeyArgument(");
	g_Assert.ok(strKey.includes("RequireEventStringFromValue(pIsolate, CallbackInformation[nArgumentIndex], pszErrorMessage, false, strKey)"));
	g_Assert.ok(!strKey.includes("ValueToString("));
	g_Assert.ok(strKey.includes("if (strKey.find('\\0') != std::string::npos)"));

	const strOptions = ExtractFunction(strSource, "void GetFireEventHookOptionsCallback(");
	for (const strArgument of ["Manager", "Event", "Broadcast"]) {
		const strGuard = "HookOptionsFailure.HasCaught() || Local" + strArgument + "ArgumentType.IsEmpty() || !LocalArguments->CreateDataProperty";
		g_Assert.ok(strOptions.includes(strGuard));
	}

	for (const strProperty of ["ObjectAddress", "Index", "Convention", "ReturnType", "Arguments"]) {
		g_Assert.ok(strOptions.includes('SetRecordProperty(pIsolate, LocalContext, LocalObject, "' + strProperty + '", '));
	}

	const strNameCallback = ExtractFunction(strSource, "void GetEventNameCallback(");
	g_Assert.ok(strNameCallback.includes("NameFailure.HasCaught() || LocalName.IsEmpty()"));

	const strInformation = ExtractFunction(strSource, "void GetEventInformationCallback(");
	g_Assert.ok(strInformation.includes('"Reliable", v8::Boolean::New(pIsolate, bReliable)'));
	g_Assert.ok(strInformation.includes('"Local", v8::Boolean::New(pIsolate, bLocal)'));

	for (const strProperty of ["EventName", "Reliable", "Local", "EventAddress"]) {
		g_Assert.ok(strInformation.includes('SetRecordProperty(pIsolate, LocalContext, LocalObject, "' + strProperty + '", '));
	}

	const nReliabilityReadPosition = strInformation.indexOf("pEvent->IsReliable()");
	const nLocalityReadPosition = strInformation.indexOf("pEvent->IsLocal()");
	const nFirstPropertyWritePosition = strInformation.indexOf("SetRecordProperty(");
	g_Assert.ok((nReliabilityReadPosition >= 0) && (nReliabilityReadPosition < nFirstPropertyWritePosition));
	g_Assert.ok((nLocalityReadPosition >= 0) && (nLocalityReadPosition < nFirstPropertyWritePosition));

	const strGetString = ExtractFunction(strSource, "void GetEventStringCallback(");
	g_Assert.ok(strGetString.includes("RequireEventStringFromValue(pIsolate, CallbackInformation[kDefaultValueArgumentIndex], kDefaultValueEncodingError, kAllowEmptyDefaultValue, strDefaultValue)"));
	g_Assert.ok(strGetString.includes("if (strDefaultValue.find('\\0') != std::string::npos)"));
	g_Assert.ok(strGetString.includes("StringFailure.HasCaught() || LocalValue.IsEmpty()"));
	g_Assert.ok(!strGetString.includes("ValueToString("));

	const strSetString = ExtractFunction(strSource, "void SetEventStringCallback(");
	g_Assert.ok(strSetString.includes("RequireEventStringFromValue(pIsolate, CallbackInformation[kValueArgumentIndex], kValueEncodingError, kAllowEmptyValue, strValue)"));
	g_Assert.ok(strSetString.includes("if (strValue.find('\\0') != std::string::npos)"));
	g_Assert.ok(!strSetString.includes("ValueToString("));

	const strDefaults = ExtractFunction(strSource, "bool AddEventPayloadDefaults(");
	g_Assert.match(strDefaults, /} catch \(\.\.\.\) \{\s*if \(DefaultValueFailure\.HasCaught\(\)\) \{\s*DefaultValueFailure\.ReThrow\(\);\s*}\s*throw;/);
}

function AssertResourceContracts(strSource) {
	AssertGameEventContracts(strSource);

	const strProperty = ExtractFunction(strSource, "bool GetObjectValue(");
	g_Assert.match(strProperty, /if \(PropertyFailure\.HasCaught\(\) \|\| LocalName\.IsEmpty\(\)\)/);
	g_Assert.match(strProperty, /PropertyFailure\.ReThrow\(\);\s*return false;/);
	g_Assert.equal((strProperty.match(/PropertyFailure\.ReThrow\(\);/g) ?? []).length, 3);

	const nUndefinedValueGuardPosition = strProperty.indexOf("if (LocalValue->IsUndefined())");
	const nOutputCommitPosition = strProperty.indexOf("LocalValueOut = LocalValue;");
	g_Assert.ok((nUndefinedValueGuardPosition >= 0) && (nOutputCommitPosition > nUndefinedValueGuardPosition));

	const strString = ExtractFunction(strSource, "bool RequireEventStringFromValue(");
	g_Assert.match(strString, /if \(ConversionFailure\.HasCaught\(\) \|\| !pszValue\)/);
	g_Assert.match(strString, /ConversionFailure\.ReThrow\(\);\s*return false;/);
	g_Assert.equal((strString.match(/ConversionFailure\.ReThrow\(\);/g) ?? []).length, 3);
	g_Assert.ok(!strString.includes("ValueToString("));

	const strDefinition = ExtractFunction(strSource, "std::string GetEventVariableTypeFromDefinition(");
	g_Assert.equal((strDefinition.match(/DefinitionFailure\.ReThrow\(\);/g) ?? []).length, 5);
	g_Assert.ok(strDefinition.includes("GetObjectValue(pIsolate, LocalContext, LocalObject, kTypeProperty, LocalType)"));
	g_Assert.ok(strDefinition.includes("RequireEventStringFromValue("));

	const strResource = ExtractFunction(strSource, "std::string BuildEventResourceText(");
	g_Assert.ok(!strResource.includes("continue;"));
	g_Assert.equal((strResource.match(/ResourceFailure\.ReThrow\(\);\s*return \{\};/g) ?? []).length, 6);
	g_Assert.ok(strResource.includes("if (!LocalKey->ToString(LocalContext).ToLocal(&LocalName))"));
	g_Assert.ok(strResource.includes("RequireEventStringFromValue(pIsolate, LocalName,"));

	for (const Guard of [
		{ SignaturePrefix: "bool GetObjectValue(", Catcher: "PropertyFailure" },
		{ SignaturePrefix: "bool RequireEventStringFromValue(", Catcher: "ConversionFailure" },
		{ SignaturePrefix: "std::string GetEventVariableTypeFromDefinition(", Catcher: "DefinitionFailure" },
		{ SignaturePrefix: "std::string BuildEventResourceText(", Catcher: "ResourceFailure" },
	]) {
		const strOwner = ExtractFunction(strSource, Guard.SignaturePrefix);
		const strPattern = "} catch \\(\\.\\.\\.\\) \\{\\s*if \\(" + Guard.Catcher + "\\.HasCaught\\(\\)\\) \\{\\s*" + Guard.Catcher + "\\.ReThrow\\(\\);\\s*}\\s*throw;";
		g_Assert.match(strOwner, new RegExp(strPattern));
	}

	const strSetter = ExtractFunction(strSource, "bool SetGameEventValueFromV8(");
	g_Assert.match(strSetter, /if \(!RequireEventStringFromValue\([^\n]+\)\) \{\s*return false;/);
	g_Assert.ok(strSetter.includes("!std::isfinite(dblValue)"));

	const strIndex = ExtractFunction(strSource, "int GetGameEventManagerFireEventVTableIndex()");
	g_Assert.match(strIndex, /if constexpr \(requires\(TEventManager& EventManager\) \{ EventManager\.AddListenerGlobal\(nullptr, false\); \}\)/);
	g_Assert.match(strIndex, /constexpr int kGlobalListenerMethodCount = 1;/);
	g_Assert.match(strIndex, /return kFireEventVTableIndex \+ kGlobalListenerMethodCount;/);
	g_Assert.ok(strSource.includes("GetGameEventManagerFireEventVTableIndex<IGameEventManager2>()"));

	const strCopy = ExtractFunction(strSource, "bool CopyEventObjectProperties(");
	g_Assert.ok(strCopy.includes("static_cast<v8::PropertyFilter>(v8::ONLY_ENUMERABLE | v8::SKIP_SYMBOLS)"));
	g_Assert.ok(strCopy.includes("GetOwnPropertyNames(LocalContext, kPropertyFilter, v8::KeyConversionMode::kConvertToString)"));
	g_Assert.ok(strCopy.includes("LocalTarget->CreateDataProperty(LocalContext, LocalKey.As<v8::Name>(), LocalValue)"));
	g_Assert.ok(!strCopy.includes("LocalTarget->Set("));

	const strDefaults = ExtractFunction(strSource, "bool AddEventPayloadDefaults(");
	g_Assert.ok(strDefaults.includes("static_cast<v8::PropertyFilter>(v8::ONLY_ENUMERABLE | v8::SKIP_SYMBOLS)"));
	g_Assert.ok(strDefaults.includes("GetOwnPropertyNames(LocalContext, kPropertyFilter, v8::KeyConversionMode::kConvertToString)"));
	g_Assert.match(strDefaults, /if \(DefaultValueFailure\.HasCaught\(\)\) \{\s*DefaultValueFailure\.ReThrow\(\);\s*return false;/);
	g_Assert.equal((strDefaults.match(/LocalPayload->CreateDataProperty\(/g) ?? []).length, 2);
	g_Assert.ok(!strDefaults.includes("LocalPayload->Set("));

	const strPayload = ExtractFunction(strSource, "bool MakeCustomEventPayload(");
	g_Assert.equal((strPayload.match(/LocalPayloadOut = /g) ?? []).length, 1);
	g_Assert.ok(strPayload.indexOf("LocalPayloadOut = LocalPayload;") > strPayload.indexOf("CopyEventObjectProperties("));
	g_Assert.ok(strPayload.includes("AddEventPayloadDefaults(pIsolate, LocalContext, LocalPayload, LocalVariables)"));
	g_Assert.ok(strPayload.includes("CopyEventObjectProperties(pIsolate, LocalContext, LocalPayload, LocalOverrides)"));

	const strRecordProperty = ExtractFunction(strSource, "bool SetRecordProperty(");
	g_Assert.match(strRecordProperty, /if \(LocalValue\.IsEmpty\(\)\) \{\s*return false;/);
	g_Assert.match(strRecordProperty, /if \(LocalName\.IsEmpty\(\)\) \{\s*return false;/);
	g_Assert.ok(strRecordProperty.indexOf("if (LocalValue.IsEmpty())") < strRecordProperty.indexOf("MakeString("));
	g_Assert.ok(strRecordProperty.includes("LocalObject->CreateDataProperty(LocalContext, LocalName, LocalValue)"));

	const strVariable = ExtractFunction(strSource, "v8::Local<v8::Object> MakeEventVariableObject(");
	g_Assert.match(strVariable, /if \(strType\.empty\(\)\) \{\s*return \{\};/);
	g_Assert.ok(strVariable.indexOf("if (strType.empty())") < strVariable.indexOf("SetRecordProperty("));
	g_Assert.match(strVariable, /if \(DefaultValueFailure\.HasCaught\(\)\) \{\s*DefaultValueFailure\.ReThrow\(\);\s*return \{\};/);
	g_Assert.equal((strVariable.match(/SetRecordProperty\(/g) ?? []).length, 4);

	const strArray = ExtractFunction(strSource, "v8::Local<v8::Array> MakeEventVariableArray(");
	g_Assert.ok(!strArray.includes("continue;") && !strArray.includes("LocalArray->Set("));
	g_Assert.equal((strArray.match(/return \{\};/g) ?? []).length, 7);
	g_Assert.equal((strArray.match(/return LocalArray;/g) ?? []).length, 2);
	g_Assert.ok(strArray.includes("LocalArray->CreateDataProperty(LocalContext, unOutputIndex, LocalVariableObject)"));

	const vecFieldCallbacks = [
		"GetEventBooleanCallback",
		"GetEventIntegerCallback",
		"GetEventUInt64Callback",
		"GetEventFloatCallback",
		"GetEventStringCallback",
		"SetEventBooleanCallback",
		"SetEventIntegerCallback",
		"SetEventUInt64Callback",
		"SetEventFloatCallback",
		"SetEventStringCallback",
	];
	for (const strCallbackName of vecFieldCallbacks) {
		const strCallback = ExtractFunction(strSource, "void " + strCallbackName + "(");
		g_Assert.ok(strCallback.includes(", strKeyName,"));
		g_Assert.ok(!strCallback.includes(", strName,"));
		g_Assert.ok(strCallback.includes("kKeyNameArgumentIndex"));
	}

	const strUInt64 = ExtractFunction(strSource, "void GetEventUInt64Callback(");
	g_Assert.ok(strUInt64.includes("expects unDefaultValue to be an unsigned BigInt."));

	const strCreateVariable = ExtractFunction(strSource, "void CreateEventVariableCallback(");
	g_Assert.equal((strCreateVariable.match(/SetRecordProperty\(/g) ?? []).length, 3);

	const strInferVariable = ExtractFunction(strSource, "void InferEventVariableCallback(");
	g_Assert.match(strInferVariable, /if \(LocalType\.IsEmpty\(\)\) \{\s*return;/);

	const strCoerceVariable = ExtractFunction(strSource, "void CoerceEventVariableCallback(");
	g_Assert.match(strCoerceVariable, /if \(!LocalValue->ToString\(LocalContext\)\.ToLocal\(&LocalString\)\) \{\s*return;/);
	g_Assert.ok(strCoerceVariable.includes("RequireEventStringFromValue(pIsolate, LocalString, kEncodingError, kAllowEmptyString, strValue)"));
	g_Assert.ok(!strCoerceVariable.includes("ValueToString("));

	const strVariableTypes = ExtractFunction(strSource, "void GetEventVariableTypesCallback(");
	g_Assert.ok(strVariableTypes.includes("LocalArray->CreateDataProperty("));
	g_Assert.ok(!strVariableTypes.includes("LocalArray->Set("));

	for (const strCallbackName of ["CreateEventResourceTextCallback", "DescribeEventResourceCallback"]) {
		const strCallback = ExtractFunction(strSource, "void " + strCallbackName + "(");
		g_Assert.match(strCallback, /if \(strText\.empty\(\)\) \{\s*return;/);
	}

	const strDescribeResource = ExtractFunction(strSource, "void DescribeEventResourceCallback(");
	g_Assert.match(strDescribeResource, /if \(LocalVariableArray\.IsEmpty\(\)\) \{\s*return;/);
	g_Assert.equal((strDescribeResource.match(/SetRecordProperty\(/g) ?? []).length, 3);

	const strCustomEvent = ExtractFunction(strSource, "void CreateCustomEventCallback(");
	g_Assert.equal((strCustomEvent.match(/SetRecordProperty\(/g) ?? []).length, 4);
	g_Assert.match(strCustomEvent, /if \(strResourceText\.empty\(\)\) \{\s*return;/);
	g_Assert.ok(strCustomEvent.indexOf("if (strResourceText.empty())") < strCustomEvent.indexOf("v8::Function::New("));
	g_Assert.match(strCustomEvent, /if \(CallbackInformation\.Length\(\) < kNameArgumentCount\) \{\s*ThrowError\(pIsolate, kNameArgumentError\);\s*return;/);

	const strLoad = ExtractFunction(strSource, "void LoadEventsFromFileCallback(");
	g_Assert.ok(strLoad.includes("if (strPath.find('\\0') != std::string::npos)"));
	g_Assert.ok(strLoad.indexOf("if (strPath.find(") < strLoad.indexOf("RequireGameEventManager("));
	g_Assert.ok(strArray.includes("RequireEventStringFromValue(pIsolate, LocalVariableName, kNameEncodingError, kAllowEmptyName, strVariableName)"));
	g_Assert.ok(!strArray.includes("ValueToString("));
	g_Assert.match(strVariable, /} catch \(\.\.\.\) \{\s*if \(DefaultValueFailure\.HasCaught\(\)\) \{\s*DefaultValueFailure\.ReThrow\(\);\s*}\s*throw;/);
	g_Assert.ok(strVariableTypes.includes("if (LocalType.IsEmpty())"));

	const strMethod = ExtractFunction(strSource, "void CustomEventFireMethodCallback(");
	g_Assert.ok(strMethod.includes("GetObjectValue(pIsolate, LocalContext, CallbackInformation.This(), kEventNameProperty, LocalName)"));
	g_Assert.ok(strMethod.includes("GetObjectValue(pIsolate, LocalContext, CallbackInformation.This(), kEventVariablesProperty, LocalVariables)"));
	g_Assert.ok(!strMethod.includes("->Get(LocalContext, MakeString("));
}

function AssertRegression(strSignaturePrefix, strOriginal, strReplacement, unIndentationLevel = 2) {
	const strOwner = ExtractFunction(g_strSource, strSignaturePrefix, unIndentationLevel);
	g_Assert.ok(strOwner.includes(strOriginal), strOriginal);

	const strMutatedSource = g_strSource.replace(strOwner, () => strOwner.replace(strOriginal, () => strReplacement));
	g_Assert.notEqual(strMutatedSource, g_strSource, strOriginal);
	g_Assert.throws(() => AssertResourceContracts(strMutatedSource), g_Assert.AssertionError, strOriginal);
	++g_unRegressionCount;
}

AssertResourceContracts(g_strSource);

for (const Guard of [
	{ SignaturePrefix: "bool GetObjectValue(", Catcher: "PropertyFailure", Indentation: 4 },
	{ SignaturePrefix: "bool RequireEventStringFromValue(", Catcher: "ConversionFailure", Indentation: 4 },
	{ SignaturePrefix: "std::string GetEventVariableTypeFromDefinition(", Catcher: "DefinitionFailure", Indentation: 5 },
	{ SignaturePrefix: "std::string BuildEventResourceText(", Catcher: "ResourceFailure", Indentation: 5 },
]) {
	const strIndentation = "\t".repeat(Guard.Indentation);
	const strGuard = "if (" + Guard.Catcher + ".HasCaught()) {\n" + strIndentation + "\t" + Guard.Catcher + ".ReThrow();\n" + strIndentation + "}\n\n" + strIndentation + "throw;";
	AssertRegression(Guard.SignaturePrefix, strGuard, "throw;");
}

AssertRegression("bool GetObjectValue(", "LocalName.IsEmpty()", "false");
AssertRegression("bool GetObjectValue(", "PropertyFailure.ReThrow();", "");
AssertRegression("bool GetObjectValue(", "if (LocalValue->IsUndefined())", "if (false)");
AssertRegression("bool RequireEventStringFromValue(", "!pszValue", "false");
AssertRegression("bool RequireEventStringFromValue(", "ConversionFailure.ReThrow();", "");
AssertRegression("std::string GetEventVariableTypeFromDefinition(", "DefinitionFailure.ReThrow();", "");
AssertRegression("std::string GetEventVariableTypeFromDefinition(", "GetObjectValue(pIsolate, LocalContext, LocalObject, kTypeProperty, LocalType)", "IgnoredProperty()");
AssertRegression("std::string BuildEventResourceText(", "ResourceFailure.ReThrow();", "");
AssertRegression("std::string BuildEventResourceText(", "if (!LocalKey->ToString(LocalContext).ToLocal(&LocalName))", "if (false)");
AssertRegression("bool SetGameEventValueFromV8(", "!RequireEventStringFromValue(", "!IgnoredConversion(");
AssertRegression("bool SetGameEventValueFromV8(", "!std::isfinite(dblValue) || ", "");

AssertRegression("int GetGameEventManagerFireEventVTableIndex()", "EventManager.AddListenerGlobal(nullptr, false)", "EventManager.MissingGlobalListener(nullptr, false)");
AssertRegression("int GetGameEventManagerFireEventVTableIndex()", "kGlobalListenerMethodCount = 1", "kGlobalListenerMethodCount = 0");
AssertRegression("int GetGameEventManagerFireEventVTableIndex()", "return kFireEventVTableIndex + kGlobalListenerMethodCount;", "return kFireEventVTableIndex;");
AssertRegression("void GetEventBooleanCallback(", ", strKeyName,", ", strName,");
AssertRegression("void GetEventUInt64Callback(", "expects unDefaultValue to be an unsigned BigInt.", "expects unDefaultValue to be an unsigned integer.");

AssertRegression("bool CopyEventObjectProperties(", "LocalTarget->CreateDataProperty(LocalContext, LocalKey.As<v8::Name>(), LocalValue)", "LocalTarget->Set(LocalContext, LocalKey, LocalValue)");
AssertRegression("bool CopyEventObjectProperties(", "v8::KeyConversionMode::kConvertToString", "v8::KeyConversionMode::kKeepNumbers");
AssertRegression("bool AddEventPayloadDefaults(", "v8::KeyConversionMode::kConvertToString", "v8::KeyConversionMode::kKeepNumbers");
AssertRegression("bool AddEventPayloadDefaults(", "DefaultValueFailure.ReThrow();", "");
AssertRegression("bool AddEventPayloadDefaults(", "DefaultValueFailure.HasCaught()", "false");
AssertRegression("bool AddEventPayloadDefaults(", "LocalPayload->CreateDataProperty(LocalContext, LocalKey.As<v8::Name>(), LocalDefaultValue)", "LocalPayload->Set(LocalContext, LocalKey, LocalDefaultValue)");
AssertRegression("bool MakeCustomEventPayload(", "LocalPayloadOut = LocalPayload;", "");
AssertRegression("bool MakeCustomEventPayload(", "LocalPayloadOut = LocalPayload;", "LocalPayloadOut = LocalPayload; LocalPayloadOut = LocalPayload;");
AssertRegression("bool SetRecordProperty(", "LocalValue.IsEmpty()", "false");
AssertRegression("bool SetRecordProperty(", "LocalName.IsEmpty()", "false");
AssertRegression("bool SetRecordProperty(", "LocalObject->CreateDataProperty(LocalContext, LocalName, LocalValue)", "LocalObject->Set(LocalContext, LocalName, LocalValue)");
AssertRegression("v8::Local<v8::Object> MakeEventVariableObject(", "if (strType.empty())", "if (false)");
AssertRegression("v8::Local<v8::Object> MakeEventVariableObject(", "DefaultValueFailure.ReThrow();", "");
AssertRegression("v8::Local<v8::Object> MakeEventVariableObject(", "SetRecordProperty(pIsolate, LocalContext, LocalObject, \"DefaultValue\", LocalDefaultValue)", "SetValue(pIsolate, LocalContext, LocalObject, \"DefaultValue\", LocalDefaultValue)");
AssertRegression("v8::Local<v8::Array> MakeEventVariableArray(", "return {};", "return LocalArray;");
AssertRegression("v8::Local<v8::Array> MakeEventVariableArray(", "LocalArray->CreateDataProperty(LocalContext, unOutputIndex, LocalVariableObject)", "LocalArray->Set(LocalContext, unOutputIndex, LocalVariableObject)");
AssertRegression("void SetEventFloatCallback(", ", strKeyName,", ", strName,");
AssertRegression("void SetEventStringCallback(", ", strKeyName,", ", strName,");

AssertRegression("void CreateEventVariableCallback(", "SetRecordProperty(", "SetValue(");
AssertRegression("void InferEventVariableCallback(", "if (LocalType.IsEmpty())", "if (false)");
AssertRegression("void CoerceEventVariableCallback(", "if (!LocalValue->ToString(LocalContext).ToLocal(&LocalString))", "if (false)");
AssertRegression("void CoerceEventVariableCallback(", "RequireEventStringFromValue(pIsolate, LocalString, kEncodingError, kAllowEmptyString, strValue)", "IgnoredStringConversion()");
AssertRegression("void GetEventVariableTypesCallback(", "LocalArray->CreateDataProperty(", "LocalArray->Set(");
AssertRegression("void CreateEventResourceTextCallback(", "if (strText.empty())", "if (false)");
AssertRegression("void DescribeEventResourceCallback(", "if (strText.empty())", "if (false)");
AssertRegression("void DescribeEventResourceCallback(", "if (LocalVariableArray.IsEmpty())", "if (false)");
AssertRegression("void DescribeEventResourceCallback(", "SetRecordProperty(", "SetValue(");

AssertRegression("void CreateCustomEventCallback(", "SetRecordProperty(", "SetValue(");
AssertRegression("void CreateCustomEventCallback(", "if (strResourceText.empty())", "if (false)");
AssertRegression("void CreateCustomEventCallback(", "ThrowError(pIsolate, kNameArgumentError);", "");

for (const strCallbackName of g_vecNativeBoundaryCallbacks) {
	AssertRegression("void " + strCallbackName + "(", ") try {", ") {");
}

for (const Guard of g_vecEventOwners) {
	const strIndentation = "\t".repeat(Guard.Indentation);
	const strGuard = "if (" + Guard.Catcher + ".HasCaught()) {\n" + strIndentation + "\t" + Guard.Catcher + ".ReThrow();\n" + strIndentation + "}\n\n" + strIndentation + "throw;";
	AssertRegression(Guard.SignaturePrefix, strGuard, "throw;");
	AssertRegression(Guard.SignaturePrefix, "v8::TryCatch " + Guard.Catcher + "(pIsolate);", "");
}

AssertRegression("bool SetGameEventValueFromV8(", "if (strValue.find('\\0') != std::string::npos)", "if (false)");
AssertRegression("bool SetGameEventPayloadFromObject(", "RequireEventStringFromValue(pIsolate, LocalKey, kPayloadKeyEncodingError, kAllowEmptyKey, strKey)", "IgnoredKeyConversion()");
AssertRegression("bool SetGameEventPayloadFromObject(", "PayloadFailure.ReThrow();", "");
AssertRegression("bool SetGameEventPayloadFromObject(", "if (strKey.find('\\0') != std::string::npos)", "if (false)");
AssertRegression("bool FireGameEvent(", "if (strName.find('\\0') != std::string::npos)", "if (false)");
AssertRegression("bool FireGameEvent(", "std::unique_ptr<IGameEvent, decltype(FreeEvent)>", "NonOwningEvent");
AssertRegression("bool FireGameEvent(", "pEventManager->FireEvent(pEvent.release(), bDoNotBroadcast)", "pEventManager->FireEvent(pEvent.get(), bDoNotBroadcast)");
AssertRegression("bool GetEventHookKeyArgument(", "RequireEventStringFromValue(pIsolate, CallbackInformation[nArgumentIndex], pszErrorMessage, false, strKey)", "IgnoredKeyConversion()");
AssertRegression("bool GetEventHookKeyArgument(", "if (strKey.find('\\0') != std::string::npos)", "if (false)");

for (const strArgument of ["Manager", "Event", "Broadcast"]) {
	AssertRegression("void GetFireEventHookOptionsCallback(", "Local" + strArgument + "ArgumentType.IsEmpty()", "false");
	AssertRegression("void GetFireEventHookOptionsCallback(", "LocalArguments->CreateDataProperty(LocalContext, k" + strArgument + "ArgumentIndex, Local" + strArgument + "ArgumentType)", "LocalArguments->Set(LocalContext, k" + strArgument + "ArgumentIndex, Local" + strArgument + "ArgumentType)");
}

for (const strProperty of ["ObjectAddress", "Index", "Convention", "ReturnType", "Arguments"]) {
	AssertRegression("void GetFireEventHookOptionsCallback(", 'SetRecordProperty(pIsolate, LocalContext, LocalObject, "' + strProperty + '", ', 'SetValue(pIsolate, LocalContext, LocalObject, "' + strProperty + '", ');
}

for (const strProperty of ["EventName", "Reliable", "Local", "EventAddress"]) {
	AssertRegression("void GetEventInformationCallback(", 'SetRecordProperty(pIsolate, LocalContext, LocalObject, "' + strProperty + '", ', 'SetValue(pIsolate, LocalContext, LocalObject, "' + strProperty + '", ');
}

for (const strOperation of ["Get", "Set"]) {
	AssertRegression("bool InstallEventHookUInt64Functions(", 'SetRecordFunction(pIsolate, LocalContext, LocalTargetObject, "' + strOperation + 'UInt64", ', 'SetFunction(pIsolate, LocalContext, LocalTargetObject, "' + strOperation + 'UInt64", ');
}

AssertRegression("void GetEventNameCallback(", "LocalName.IsEmpty()", "false");
AssertRegression("void GetEventInformationCallback(", '"Reliable", v8::Boolean::New(pIsolate, bReliable)', '"Reliable", v8::Boolean::New(pIsolate, pEvent->IsReliable())');
AssertRegression("void GetEventInformationCallback(", '"Local", v8::Boolean::New(pIsolate, bLocal)', '"Local", v8::Boolean::New(pIsolate, pEvent->IsLocal())');
AssertRegression("void GetEventInformationCallback(", "pEvent->IsReliable()", "true");
AssertRegression("void GetEventInformationCallback(", "pEvent->IsLocal()", "true");

AssertRegression("void GetEventStringCallback(", "RequireEventStringFromValue(pIsolate, CallbackInformation[kDefaultValueArgumentIndex], kDefaultValueEncodingError, kAllowEmptyDefaultValue, strDefaultValue)", "IgnoredDefaultConversion()");
AssertRegression("void GetEventStringCallback(", "if (strDefaultValue.find('\\0') != std::string::npos)", "if (false)");
AssertRegression("void GetEventStringCallback(", "LocalValue.IsEmpty()", "false");
AssertRegression("void SetEventStringCallback(", "RequireEventStringFromValue(pIsolate, CallbackInformation[kValueArgumentIndex], kValueEncodingError, kAllowEmptyValue, strValue)", "IgnoredValueConversion()");
AssertRegression("void SetEventStringCallback(", "if (strValue.find('\\0') != std::string::npos)", "if (false)");
AssertRegression("bool AddEventPayloadDefaults(", "if (DefaultValueFailure.HasCaught()) {\n\t\t\t\t\t\t\t\tDefaultValueFailure.ReThrow();\n\t\t\t\t\t\t\t}\n\n\t\t\t\t\t\t\tthrow;", "throw;");

AssertRegression("void LoadEventsFromFileCallback(", "if (strPath.find('\\0') != std::string::npos)", "if (false)");
AssertRegression("v8::Local<v8::Array> MakeEventVariableArray(", "RequireEventStringFromValue(pIsolate, LocalVariableName, kNameEncodingError, kAllowEmptyName, strVariableName)", "IgnoredNameConversion()");
AssertRegression("v8::Local<v8::Object> MakeEventVariableObject(", "if (DefaultValueFailure.HasCaught()) {\n\t\t\t\t\t\t\tDefaultValueFailure.ReThrow();\n\t\t\t\t\t\t}\n\n\t\t\t\t\t\tthrow;", "throw;");
AssertRegression("void GetEventVariableTypesCallback(", "if (LocalType.IsEmpty())", "if (false)");
AssertRegression("void CustomEventFireMethodCallback(", "GetObjectValue(pIsolate, LocalContext, CallbackInformation.This(), kEventNameProperty, LocalName)", "IgnoredReceiverName()");
AssertRegression("void CustomEventFireMethodCallback(", "GetObjectValue(pIsolate, LocalContext, CallbackInformation.This(), kEventVariablesProperty, LocalVariables)", "IgnoredReceiverVariables()");

console.log("[smoke] Event resource source contracts and " + g_unRegressionCount + " negative regressions passed; native V8/SDK execution is a separate check");
