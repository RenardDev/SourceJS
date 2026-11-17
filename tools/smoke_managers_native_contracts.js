#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_vecArguments = process.argv.slice(2);
if (g_vecArguments.length !== 0) {
	const bHelp = (g_vecArguments.length === 1) && (g_vecArguments[0] === "--help");
	console.log("Usage: node tools/smoke_managers_native_contracts.js [--help]");
	process.exit(bHelp ? 0 : 2);
}

// Structural source guards, not live V8, engine, or external-service execution proof.
const g_strSource = g_FileSystem.readFileSync(g_Path.join(__dirname, "..", "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_vecBoundaries = [
	{ Name: "GetAutodocModuleNamesCallback", Failure: "AutodocFailure", Guards: 9 },
	{ Name: "InstallPluginRecordValue", Failure: "ManagerFailure", Guards: 3, Result: "false" },
	{ Name: "ParsePluginNameArgument", Failure: "ManagerFailure", Guards: 3, Result: "false" },
	{ Name: "ParsePluginSelectorArgument", Failure: "ManagerFailure", Guards: 5, Result: "false" },
	{ Name: "ListPluginsCallback", Failure: "ManagerFailure", Guards: 5 },
	{ Name: "MakePluginRecordObject", Failure: "ManagerFailure", Guards: 8, Result: "{}" },
	{ Name: "GetPluginRecordsCallback", Failure: "ManagerFailure", Guards: 5 },
	{ Name: "LoadPluginCallback", Failure: "ManagerFailure", Guards: 3 },
	{ Name: "UnloadPluginCallback", Failure: "ManagerFailure", Guards: 3 },
	{ Name: "ReloadPluginCallback", Failure: "ManagerFailure", Guards: 3 },
	{ Name: "UnloadAllPluginsCallback", Failure: "ManagerFailure", Guards: 2 },
	{ Name: "ReloadAllPluginsCallback", Failure: "ManagerFailure", Guards: 2 },
	{ Name: "DisablePluginCallback", Failure: "ManagerFailure", Guards: 3 },
	{ Name: "EnablePluginCallback", Failure: "ManagerFailure", Guards: 3 },
	{ Name: "ParseExtensionStringArgument", Failure: "ManagerFailure", Guards: 3, Result: "false" },
	{ Name: "ListExtensionsCallback", Failure: "ManagerFailure", Guards: 5 },
	{ Name: "LoadExtensionCallback", Failure: "ManagerFailure", Guards: 3 },
	{ Name: "UnloadExtensionCallback", Failure: "ManagerFailure", Guards: 3 },
	{ Name: "ReloadExtensionCallback", Failure: "ManagerFailure", Guards: 3 },
	{ Name: "UnloadAllExtensionsCallback", Failure: "ManagerFailure", Guards: 2 },
	{ Name: "ReloadAllExtensionsCallback", Failure: "ManagerFailure", Guards: 2 },
	{ Name: "DisableExtensionCallback", Failure: "ManagerFailure", Guards: 3 },
	{ Name: "EnableExtensionCallback", Failure: "ManagerFailure", Guards: 3 },
	{ Name: "RequireExternalPluginName", Failure: "ManagerFailure", Guards: 3, Result: "false" },
	{ Name: "ParseExternalHandleFromValue", Failure: "ManagerFailure", Guards: 3, Result: "false" },
	{ Name: "ParseRequiredExternalStringArgument", Failure: "ManagerFailure", Guards: 3, Result: "false" },
	{ Name: "ParseExternalStringFromValue", Failure: "ExternalFailure", Guards: 3, Result: "false" },
	{ Name: "ParseOptionalExternalStringArgument", Failure: "ExternalFailure", Guards: 3, Result: "false" },
	{ Name: "ParseOptionalExternalStringProperty", Failure: "ExternalFailure", Guards: 4, Result: "false" },
	{ Name: "ParseOptionalExternalBooleanProperty", Failure: "ExternalFailure", Guards: 4, Result: "false" },
	{ Name: "ParseExternalInt32FromValue", Failure: "ExternalFailure", Guards: 4, Result: "false" },
	{ Name: "ParseOptionalExternalInt32Property", Failure: "ExternalFailure", Guards: 4, Result: "false" },
	{ Name: "MakeExternalInt64Value", Failure: "ExternalFailure", Guards: 2, Result: "{}" },
	{ Name: "SetSOCIParameterFromValue", Failure: "SOCIFailure", Guards: 7, Result: "false" },
	{ Name: "ParseSOCIParametersFromValue", Failure: "SOCIFailure", Guards: 11, Result: "false" },
	{ Name: "ParseAsyncRequestExecutionMode", Failure: "AsyncFailure", Guards: 7, Result: "false" },
	{ Name: "RunAsyncRequest", Failure: "AsyncFailure", Guards: 4, Result: "false" },
	{ Name: "RunAsyncRequest", Failure: "ResultFailure", Guards: 3, Isolate: "pResultIsolate", Indent: 4, ErrorMessage: "pszInvalidResultErrorMessage" },
	{ Name: "RequireSOCISessionRecordFromCallbackInformation", Failure: "SOCIFailure", Guards: 6, Result: "{}" },
	{ Name: "MakeSOCIQueryValue", Failure: "SOCIFailure", Guards: 7, Result: "{}" },
	{ Name: "MakeSOCIRowObject", Failure: "SOCIFailure", Guards: 5, Result: "{}" },
	{ Name: "ConnectSOCICallback", Failure: "SOCIFailure", Guards: 7, ErrorMessage: "kUnknownSOCIConnectFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "ConnectSOCICallback", Failure: "SOCIResultFailure", Guards: 2, Isolate: "pResultIsolate", Indent: 4, ErrorMessage: "kInvalidSOCIConnectResultErrorMessage" },
	{ Name: "CloseSOCICallback", Failure: "SOCIFailure", Guards: 8, ErrorMessage: "kSOCICloseRequestFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "CloseSOCICallback", Failure: "SOCIResultFailure", Guards: 2, Isolate: "pResultIsolate", Indent: 4, ErrorMessage: "kSOCICloseRequestFailureErrorMessage" },
	{ Name: "ExecuteSOCICallback", Failure: "SOCIFailure", Guards: 9, ErrorMessage: "kSOCIExecuteRequestFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "QuerySOCICallback", Failure: "SOCIFailure", Guards: 9, ErrorMessage: "kSOCIQueryRequestFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "QuerySOCICallback", Failure: "SOCIResultFailure", Guards: 4, Isolate: "pResultIsolate", Indent: 4, ErrorMessage: "kInvalidSOCIQueryResultErrorMessage" },
	{ Name: "GetSOCIBackendNameCallback", Failure: "SOCIFailure", Guards: 5, ErrorMessage: "kSOCIBackendNameRequestFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "GetSOCILastInsertIDCallback", Failure: "SOCIFailure", Guards: 6, ErrorMessage: "kSOCILastInsertIDRequestFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "GetSOCINextSequenceValueCallback", Failure: "SOCIFailure", Guards: 6, ErrorMessage: "kSOCINextSequenceValueRequestFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "BeginSOCICallback", Failure: "SOCIFailure", Guards: 5, ErrorMessage: "kSOCITransactionRequestFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "CommitSOCICallback", Failure: "SOCIFailure", Guards: 5, ErrorMessage: "kSOCICommitRequestFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "RollbackSOCICallback", Failure: "SOCIFailure", Guards: 5, ErrorMessage: "kSOCIRollbackRequestFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "ReconnectSOCICallback", Failure: "SOCIFailure", Guards: 5, ErrorMessage: "kSOCIReconnectRequestFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "IsSOCIConnectedCallback", Failure: "SOCIFailure", Guards: 5, ErrorMessage: "kSOCIConnectedRequestFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "RequireSocketConnectionFromCallbackInformation", Failure: "SocketFailure", Guards: 6, Result: "{}" },
	{ Name: "ConnectSocketCallback", Failure: "SocketFailure", Guards: 9, ErrorMessage: "kSocketConnectUnknownFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "ConnectSocketCallback", Failure: "SocketResultFailure", Guards: 2, Isolate: "pResultIsolate", Indent: 4, ErrorMessage: "kSocketConnectInvalidResultErrorMessage" },
	{ Name: "CloseSocketCallback", Failure: "SocketFailure", Guards: 5, ErrorMessage: "kSocketCloseRequestFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "CloseSocketCallback", Failure: "SocketResultFailure", Guards: 2, Isolate: "pResultIsolate", Indent: 4, ErrorMessage: "kSocketCloseInvalidResultErrorMessage" },
	{ Name: "SendSocketCallback", Failure: "SocketFailure", Guards: 20, ErrorMessage: "kSocketSendUnknownFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "ReceiveSocketCallback", Failure: "SocketFailure", Guards: 8, ErrorMessage: "kSocketReceiveUnknownFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "AcquireRedisClientFromCallbackInformation", Failure: "RedisFailure", Guards: 5, Result: "{}" },
	{ Name: "ParseRedisRequestExecutionMode", Failure: "RedisFailure", Guards: 7, Result: "false", ErrorMessage: "pszCallbackErrorMessage" },
	{ Name: "RunRedisRequest", Failure: "RedisFailure", Guards: 4, Result: "false" },
	{ Name: "RunRedisRequest", Failure: "ResultFailure", Guards: 3, Isolate: "pResultIsolate", Indent: 4, ErrorMessage: "pszInvalidResultErrorMessage" },
	{ Name: "ParseRedisCommandArguments", Failure: "RedisFailure", Guards: 9, Result: "false" },
	{ Name: "MakeRedisReplyValue", Failure: "RedisFailure", Guards: 10, Result: "{}" },
	{ Name: "ParseExternalStringVectorFromValue", Failure: "ExternalFailure", Guards: 6, Result: "false", ErrorMessage: "pszExternalStringVectorErrorMessage" },
	{ Name: "ParseExternalStringMapFromValue", Failure: "ExternalFailure", Guards: 8, Result: "false", ErrorMessage: "pszExternalStringMapContainerErrorMessage" },
	{ Name: "ConnectRedisCallback", Failure: "RedisFailure", Guards: 7, ErrorMessage: "kUnknownRedisConnectFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "ConnectRedisCallback", Failure: "RedisResultFailure", Guards: 2, Isolate: "pResultIsolate", Indent: 4, ErrorMessage: "kInvalidRedisConnectResultErrorMessage" },
	{ Name: "CloseRedisCallback", Failure: "RedisFailure", Guards: 8, ErrorMessage: "kUnknownRedisCloseFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "PingRedisCallback", Failure: "RedisFailure", Guards: 8, ErrorMessage: "kUnknownRedisPingFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "ExecuteRedisCommandCallback", Failure: "RedisFailure", Guards: 7, ErrorMessage: "kUnknownRedisCommandFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "ExecuteRedisCommandCallback", Failure: "RedisResultFailure", Guards: 2, Isolate: "pResultIsolate", Indent: 4, ErrorMessage: "kInvalidRedisCommandReplyErrorMessage" },
	{ Name: "GetRedisValueCallback", Failure: "RedisFailure", Guards: 7, ErrorMessage: "kUnknownRedisGetFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "SetRedisValueCallback", Failure: "RedisFailure", Guards: 8, ErrorMessage: "kUnknownRedisSetFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "DeleteRedisKeyCallback", Failure: "RedisFailure", Guards: 7, ErrorMessage: "kUnknownRedisDeleteFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "DoesRedisKeyExistCallback", Failure: "RedisFailure", Guards: 7, ErrorMessage: "kUnknownRedisExistsFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "IncrementRedisValueCallback", Failure: "RedisFailure", Guards: 7, ErrorMessage: "kUnknownRedisIncrementFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "ExpireRedisKeyCallback", Failure: "RedisFailure", Guards: 9, ErrorMessage: "kUnknownRedisExpireFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "GetRedisHashFieldCallback", Failure: "RedisFailure", Guards: 8, ErrorMessage: "kUnknownRedisHashGetFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "SetRedisHashFieldCallback", Failure: "RedisFailure", Guards: 9, ErrorMessage: "kUnknownRedisHashSetFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "GetRedisDatabaseSizeCallback", Failure: "RedisFailure", Guards: 6, ErrorMessage: "kUnknownRedisDatabaseSizeFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "GetRedisKeysCallback", Failure: "RedisFailure", Guards: 7, ErrorMessage: "kUnknownRedisKeysFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "GetRedisKeyTypeCallback", Failure: "RedisFailure", Guards: 7, ErrorMessage: "kUnknownRedisKeyTypeFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "GetRedisKeyTTLCallback", Failure: "RedisFailure", Guards: 7, ErrorMessage: "kUnknownRedisKeyTTLFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "PersistRedisKeyCallback", Failure: "RedisFailure", Guards: 7, ErrorMessage: "kUnknownRedisPersistFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "DecrementRedisValueCallback", Failure: "RedisFailure", Guards: 7, ErrorMessage: "kUnknownRedisDecrementFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "IncrementRedisValueByAmountCallback", Failure: "RedisFailure", Guards: 9, ErrorMessage: "kUnknownRedisIncrementByAmountFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "GetMultipleRedisValuesCallback", Failure: "RedisFailure", Guards: 8, ErrorMessage: "kUnknownRedisMultipleGetFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "GetMultipleRedisValuesCallback", Failure: "RedisResultFailure", Guards: 4, Isolate: "pResultIsolate", Indent: 4, ErrorMessage: "kInvalidRedisMultipleGetResultErrorMessage" },
	{ Name: "SetMultipleRedisValuesCallback", Failure: "RedisFailure", Guards: 8, ErrorMessage: "kUnknownRedisMultipleSetFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "DeleteRedisHashFieldsCallback", Failure: "RedisFailure", Guards: 9, ErrorMessage: "kUnknownRedisHashFieldsDeleteFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "DoesRedisHashFieldExistCallback", Failure: "RedisFailure", Guards: 8, ErrorMessage: "kUnknownRedisHashFieldExistsFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "GetRedisHashFieldCountCallback", Failure: "RedisFailure", Guards: 7, ErrorMessage: "kUnknownRedisHashFieldCountFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "GetAllRedisHashFieldsCallback", Failure: "RedisFailure", Guards: 7, ErrorMessage: "kUnknownRedisHashGetAllFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "GetAllRedisHashFieldsCallback", Failure: "RedisResultFailure", Guards: 7, Isolate: "pResultIsolate", Indent: 4, ErrorMessage: "kInvalidRedisHashGetAllResultErrorMessage" },
	{ Name: "PushRedisListValues", Failure: "RedisFailure", Guards: 9, ErrorMessage: "kUnknownRedisListPushFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "PopRedisListValue", Failure: "RedisFailure", Guards: 7, ErrorMessage: "kUnknownRedisListPopFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "GetRedisListRangeCallback", Failure: "RedisFailure", Guards: 11, ErrorMessage: "kUnknownRedisListRangeFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "AddOrRemoveRedisSetMembers", Failure: "RedisFailure", Guards: 9, ErrorMessage: "kUnknownRedisSetMemberUpdateFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "GetRedisSetMembersCallback", Failure: "RedisFailure", Guards: 7, ErrorMessage: "kUnknownRedisSetMembersFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "PublishRedisMessageCallback", Failure: "RedisFailure", Guards: 8, ErrorMessage: "kUnknownRedisPublishFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "ParseOptionalExternalStringMapProperty", Failure: "ExternalStringMapFailure", Guards: 4, ErrorMessage: "kUnknownExternalStringMapPropertyFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "ParseOptionalHTTPRequestBodyProperty", Failure: "HTTPFailure", Guards: 4, ErrorMessage: "kUnknownHTTPRequestBodyFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "ParseOptionalHTTPAuthenticationProperty", Failure: "HTTPFailure", Guards: 12, ErrorMessage: "kUnknownHTTPAuthenticationFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "ParseHTTPRequestOptions", Failure: "HTTPFailure", Guards: 22, ErrorMessage: "kUnknownHTTPRequestOptionsFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "MakeCPRResponseObject", Failure: "CPRResponseFailure", Guards: 20, ErrorMessage: "kUnknownCPRResponseFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "QueueCPRRequest", Failure: "CPRFailure", Guards: 8, ErrorMessage: "kUnknownRequestFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "QueueCPRRequest", Failure: "CPRResultFailure", Guards: 2, Isolate: "pResultIsolate", Indent: 4, ErrorMessage: "kInvalidResponseErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
	{ Name: "InstallPathConstants", Failure: "PathConstantsFailure", Guards: 4, ErrorMessage: "kPathConstantsFailureErrorMessage", StandardException: "Exception", StandardErrorMessage: "Exception.what()" },
];
const g_vecLifecycleOperations = [
	{ Name: "LoadPluginCallback", Parse: "!ParsePluginNameArgument(CallbackInformation, strPluginName)", Invoke: "const bool bPluginLoaded = g_Application.GetPluginManager().Load(strPluginName);", Result: "bPluginLoaded" },
	{ Name: "UnloadPluginCallback", Parse: "!ParsePluginSelectorArgument(CallbackInformation, kInvalidPluginUnloadSelectorErrorMessage, strPluginSelector)", Invoke: "const bool bPluginUnloaded = g_Application.GetPluginManager().Unload(strPluginSelector);", Result: "bPluginUnloaded", Diagnostic: "plugins.UnloadPlugin(PluginSelector) expects a non-empty plugin name or positive one-based index." },
	{ Name: "ReloadPluginCallback", Parse: "!ParsePluginSelectorArgument(CallbackInformation, kInvalidPluginReloadSelectorErrorMessage, strPluginSelector)", Invoke: "const bool bPluginReloaded = g_Application.GetPluginManager().Reload(strPluginSelector);", Result: "bPluginReloaded", Diagnostic: "plugins.ReloadPlugin(PluginSelector) expects a non-empty plugin name or positive one-based index." },
	{ Name: "UnloadAllPluginsCallback", Invoke: "g_Application.GetPluginManager().UnloadAll();", Result: "true" },
	{ Name: "ReloadAllPluginsCallback", Invoke: "g_Application.GetPluginManager().ReloadAll();", Result: "true" },
	{ Name: "DisablePluginCallback", Parse: "!ParsePluginSelectorArgument(CallbackInformation, kInvalidPluginDisableSelectorErrorMessage, strPluginSelector)", Invoke: "const bool bPluginDisabled = g_Application.GetPluginManager().Disable(strPluginSelector);", Result: "bPluginDisabled", Diagnostic: "plugins.DisablePlugin(PluginSelector) expects a non-empty plugin name or positive one-based index." },
	{ Name: "EnablePluginCallback", Parse: "!ParsePluginSelectorArgument(CallbackInformation, kInvalidPluginEnableSelectorErrorMessage, strPluginSelector)", Invoke: "const bool bPluginEnabled = g_Application.GetPluginManager().Enable(strPluginSelector);", Result: "bPluginEnabled", Diagnostic: "plugins.EnablePlugin(PluginSelector) expects a non-empty plugin name or positive one-based index." },
	{ Name: "LoadExtensionCallback", Parse: "!ParseExtensionStringArgument(CallbackInformation, kInvalidExtensionNameErrorMessage, strExtensionName)", Invoke: "const bool bExtensionLoaded = g_Application.GetExtensionManager().Load(strExtensionName);", Result: "bExtensionLoaded", Diagnostic: "extensions.Load(strExtensionName) expects a non-empty extension name string." },
	{ Name: "UnloadExtensionCallback", Parse: "!ParseExtensionStringArgument(CallbackInformation, kInvalidExtensionUnloadSelectorErrorMessage, strExtensionSelector)", Invoke: "const bool bExtensionUnloaded = g_Application.GetExtensionManager().Unload(strExtensionSelector);", Result: "bExtensionUnloaded", Diagnostic: "extensions.Unload(strExtensionSelector) expects a non-empty extension name or one-based index string." },
	{ Name: "ReloadExtensionCallback", Parse: "!ParseExtensionStringArgument(CallbackInformation, kInvalidExtensionReloadSelectorErrorMessage, strExtensionSelector)", Invoke: "const bool bExtensionReloaded = g_Application.GetExtensionManager().Reload(strExtensionSelector);", Result: "bExtensionReloaded", Diagnostic: "extensions.Reload(strExtensionSelector) expects a non-empty extension name or one-based index string." },
	{ Name: "UnloadAllExtensionsCallback", Invoke: "g_Application.GetExtensionManager().UnloadAll();", Result: "true" },
	{ Name: "ReloadAllExtensionsCallback", Invoke: "g_Application.GetExtensionManager().ReloadAll();", Result: "true" },
	{ Name: "DisableExtensionCallback", Parse: "!ParseExtensionStringArgument(CallbackInformation, kInvalidExtensionDisableSelectorErrorMessage, strExtensionSelector)", Invoke: "const bool bExtensionDisabled = g_Application.GetExtensionManager().Disable(strExtensionSelector);", Result: "bExtensionDisabled", Diagnostic: "extensions.Disable(strExtensionSelector) expects a non-empty extension name or one-based index string." },
	{ Name: "EnableExtensionCallback", Parse: "!ParseExtensionStringArgument(CallbackInformation, kInvalidExtensionEnableSelectorErrorMessage, strExtensionSelector)", Invoke: "const bool bExtensionEnabled = g_Application.GetExtensionManager().Enable(strExtensionSelector);", Result: "bExtensionEnabled", Diagnostic: "extensions.Enable(strExtensionSelector) expects a non-empty extension name or one-based index string." },
];
const g_vecChecks = [
	{
		Name: "GetAutodocModuleNamesCallback",
		Fragments: ["if (!pRuntime) {\n\t\t\t\tCallbackInformation.GetReturnValue().Set(LocalAutodocModuleNamesArray);\n\t\t\t\treturn;", "if (LocalContext.IsEmpty()) {\n\t\t\t\tCallbackInformation.GetReturnValue().Set(LocalAutodocModuleNamesArray);\n\t\t\t\treturn;", "if (LocalSourceJS.IsEmpty()) {\n\t\t\t\tCallbackInformation.GetReturnValue().Set(LocalAutodocModuleNamesArray);\n\t\t\t\treturn;", "if (!LocalPropertyName->IsString()) {\n\t\t\t\t\tcontinue;", "if (!LocalPropertyValue->IsObject() || LocalPropertyValue->IsFunction()) {\n\t\t\t\t\tcontinue;", "\n\t\t\tCallbackInformation.GetReturnValue().Set(LocalAutodocModuleNamesArray);\n\t\t} catch (std::exception const&)"],
		Order: ["if (AutodocFailure.HasCaught()", "v8::Array::New(pIsolate);", "if (LocalAutodocModuleNamesArray.IsEmpty() || AutodocFailure.HasCaught()", "GetRuntimeFromCallbackInformation(CallbackInformation);\n\t\t\tif (AutodocFailure.HasCaught()", "if (!pRuntime)", "pIsolate->GetCurrentContext();\n\t\t\tif (AutodocFailure.HasCaught()", "if (LocalContext.IsEmpty())", "pRuntime->GetSourceJSObject(pIsolate);\n\t\t\tif (AutodocFailure.HasCaught()", "if (LocalSourceJS.IsEmpty())", "!LocalSourceJS->GetOwnPropertyNames(LocalContext).ToLocal(&LocalSourceJSPropertyNamesArray) || LocalSourceJSPropertyNamesArray.IsEmpty() || AutodocFailure.HasCaught()", "for (std::uint32_t unPropertyIndex = 0; unPropertyIndex < unPropertyCount; ++unPropertyIndex)", "!LocalSourceJSPropertyNamesArray->Get(LocalContext, unPropertyIndex).ToLocal(&LocalPropertyName) || LocalPropertyName.IsEmpty() || AutodocFailure.HasCaught()", "if (!LocalPropertyName->IsString())", "!LocalSourceJS->Get(LocalContext, LocalPropertyName.As<v8::String>()).ToLocal(&LocalPropertyValue) || LocalPropertyValue.IsEmpty() || AutodocFailure.HasCaught()", "if (!LocalPropertyValue->IsObject() || LocalPropertyValue->IsFunction())", "LocalAutodocModuleNamesArray->CreateDataProperty(LocalContext, unModuleIndex, LocalPropertyName);", "if (!MaybeCreationResult.FromMaybe(false) || AutodocFailure.HasCaught()", "++unModuleIndex;"],
		Forbidden: ["LocalAutodocModuleNamesArray->Set("],
	},
	{
		Name: "InstallPluginRecordValue",
		Fragments: ["if (!pIsolate || LocalContext.IsEmpty() || LocalTargetObject.IsEmpty() || !pszPropertyName)"],
		Order: ["if (LocalValue.IsEmpty() || ManagerFailure.HasCaught()", "MakeString(pIsolate, pszPropertyName);", "if (LocalPropertyName.IsEmpty() || ManagerFailure.HasCaught()", "LocalTargetObject->CreateDataProperty(LocalContext, LocalPropertyName, LocalValue);", "if (!MaybeCreationResult.FromMaybe(false) || ManagerFailure.HasCaught()", "return true;"],
		Forbidden: ["LocalTargetObject->Set("],
	},
	{
		Name: "ParsePluginNameArgument",
		Fragments: ["kPluginNameArgumentIndex = 0;", "kPluginNameRequiredArgumentCount = 1;", 'kInvalidPluginNameErrorMessage = "plugins.LoadPlugin(strPluginName) expects a non-empty plugin name string.";', "if (CallbackInformation.Length() < kPluginNameRequiredArgumentCount) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, ManagerFailure, kInvalidPluginNameErrorMessage);\n\t\t\t\treturn false;", "if (!LocalPluginNameValue->IsString()) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, ManagerFailure, kInvalidPluginNameErrorMessage);\n\t\t\t\treturn false;", "if (strPluginName.empty()) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, ManagerFailure, kInvalidPluginNameErrorMessage);\n\t\t\t\treturn false;"],
		Order: ["if (ManagerFailure.HasCaught()", "if (CallbackInformation.Length() < kPluginNameRequiredArgumentCount)", "if (LocalPluginNameValue.IsEmpty() || ManagerFailure.HasCaught()", "if (!LocalPluginNameValue->IsString())", "ValueToString(pIsolate, LocalPluginNameValue);\n\t\t\tif (ManagerFailure.HasCaught()", "if (strPluginName.empty())", "strPluginNameOut = std::move(strPluginName);", "return true;"],
		Forbidden: ["->ToString(", "strPluginNameOut.clear("],
	},
	{
		Name: "ParsePluginSelectorArgument",
		Fragments: ["kPluginSelectorArgumentIndex = 0;", "kPluginSelectorRequiredArgumentCount = 1;", "if (!pIsolate || !pszInvalidPluginSelectorErrorMessage || !*pszInvalidPluginSelectorErrorMessage)", "if (strPluginSelector.empty()) {\n\t\t\t\t\tRethrowV8InstallationFailure(pIsolate, ManagerFailure, pszInvalidPluginSelectorErrorMessage);\n\t\t\t\t\treturn false;", "if (!LocalPluginSelectorValue->IsUint32()) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, ManagerFailure, pszInvalidPluginSelectorErrorMessage);\n\t\t\t\treturn false;", "if (unPluginSelectorIndex == 0) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, ManagerFailure, pszInvalidPluginSelectorErrorMessage);\n\t\t\t\treturn false;", "strPluginSelectorOut = std::to_string(unPluginSelectorIndex);\n\n\t\t\treturn true;"],
		Order: ["if (ManagerFailure.HasCaught()", "if (CallbackInformation.Length() < kPluginSelectorRequiredArgumentCount)", "if (LocalPluginSelectorValue.IsEmpty() || ManagerFailure.HasCaught()", "if (LocalPluginSelectorValue->IsString())", "ValueToString(pIsolate, LocalPluginSelectorValue);\n\t\t\t\tif (ManagerFailure.HasCaught()", "if (strPluginSelector.empty())", "strPluginSelectorOut = std::move(strPluginSelector);", "if (!LocalPluginSelectorValue->IsUint32())", "if (LocalContext.IsEmpty() || ManagerFailure.HasCaught()", "LocalPluginSelectorValue->Uint32Value(LocalContext);", "if (MaybePluginSelectorIndex.IsNothing() || ManagerFailure.HasCaught()", "MaybePluginSelectorIndex.FromJust();", "if (unPluginSelectorIndex == 0)", "strPluginSelectorOut = std::to_string(unPluginSelectorIndex);"],
		Forbidden: ["IsNumber(", "NumberValue(", "strPluginSelectorOut.clear("],
	},
	{
		Name: "ListPluginsCallback",
		Fragments: ["RethrowV8InstallationFailure(pIsolate, ManagerFailure, kPluginListExcessiveLineCountErrorMessage);", "const std::uint32_t unPluginLineArrayIndex = static_cast<std::uint32_t>(unPluginLineIndex);"],
		Order: ["if (LocalContext.IsEmpty() || ManagerFailure.HasCaught()", "g_Application.GetPluginManager().List();\n\t\t\tif (ManagerFailure.HasCaught()", "if (unPluginLineCount > static_cast<std::size_t>(std::numeric_limits<int>::max()))", "const int nPluginLineCount = static_cast<int>(unPluginLineCount);", "v8::Array::New(pIsolate, nPluginLineCount);", "if (LocalPluginLinesArray.IsEmpty() || ManagerFailure.HasCaught()", "for (std::size_t unPluginLineIndex = 0; unPluginLineIndex < unPluginLineCount; ++unPluginLineIndex)", "MakeString(pIsolate, vecPluginLines[unPluginLineIndex]);", "if (LocalPluginLine.IsEmpty() || ManagerFailure.HasCaught()", "LocalPluginLinesArray->CreateDataProperty(LocalContext, unPluginLineArrayIndex, LocalPluginLine);", "if (!MaybeCreationResult.FromMaybe(false) || ManagerFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(LocalPluginLinesArray);"],
		Forbidden: ["LocalPluginLinesArray->Set("],
	},
	{
		Name: "MakePluginRecordObject",
		Fragments: ['kPluginRecordIndexPropertyName = "Index";', 'kPluginRecordNamePropertyName = "Name";', 'kPluginRecordDirectoryPropertyName = "Directory";', 'kPluginRecordEntryPropertyName = "Entry";', 'kPluginRecordEnabledPropertyName = "Enabled";', 'kPluginRecordLoadedPropertyName = "Loaded";', "kMaximumZeroBasedPluginIndex = static_cast<std::size_t>(std::numeric_limits<int>::max()) - 1;", "if (unZeroBasedPluginIndex > kMaximumZeroBasedPluginIndex) {\n\t\t\t\treturn {};"],
		Order: ["if (ManagerFailure.HasCaught()", "if (unZeroBasedPluginIndex > kMaximumZeroBasedPluginIndex)", "v8::Object::New(pIsolate);", "if (LocalPluginRecordObject.IsEmpty() || ManagerFailure.HasCaught()", "const int nOneBasedPluginIndex = static_cast<int>(unZeroBasedPluginIndex + 1);", "!InstallPluginRecordValue(pIsolate, LocalContext, LocalPluginRecordObject, kPluginRecordIndexPropertyName, v8::Integer::New(pIsolate, nOneBasedPluginIndex)) || ManagerFailure.HasCaught()", "!InstallPluginRecordValue(pIsolate, LocalContext, LocalPluginRecordObject, kPluginRecordNamePropertyName, MakeString(pIsolate, PluginRecordInformation.m_strName)) || ManagerFailure.HasCaught()", "EncodePathAsUTF8(PluginRecordInformation.m_PathDirectory);", "!InstallPluginRecordValue(pIsolate, LocalContext, LocalPluginRecordObject, kPluginRecordDirectoryPropertyName, MakeString(pIsolate, strPluginDirectory)) || ManagerFailure.HasCaught()", "EncodePathAsUTF8(PluginRecordInformation.m_PathEntry);", "!InstallPluginRecordValue(pIsolate, LocalContext, LocalPluginRecordObject, kPluginRecordEntryPropertyName, MakeString(pIsolate, strPluginEntry)) || ManagerFailure.HasCaught()", "!InstallPluginRecordValue(pIsolate, LocalContext, LocalPluginRecordObject, kPluginRecordEnabledPropertyName, v8::Boolean::New(pIsolate, PluginRecordInformation.m_bEnabled)) || ManagerFailure.HasCaught()", "!InstallPluginRecordValue(pIsolate, LocalContext, LocalPluginRecordObject, kPluginRecordLoadedPropertyName, v8::Boolean::New(pIsolate, PluginRecordInformation.m_bLoaded)) || ManagerFailure.HasCaught()", "return LocalPluginRecordObject;"],
		Forbidden: ["!SetValue(", "!SetString(", "!SetBoolean(", "!SetInteger(", "PluginRecordInformation.m_PathDirectory.string()", "PluginRecordInformation.m_PathEntry.string()"],
	},
	{
		Name: "GetPluginRecordsCallback",
		Fragments: ["RethrowV8InstallationFailure(pIsolate, ManagerFailure, kPluginRecordsExcessiveRecordCountErrorMessage);", "const std::uint32_t unPluginRecordArrayIndex = static_cast<std::uint32_t>(unPluginRecordIndex);"],
		Order: ["if (LocalContext.IsEmpty() || ManagerFailure.HasCaught()", "g_Application.GetPluginManager().GetPlugins();\n\t\t\tif (ManagerFailure.HasCaught()", "if (unPluginRecordCount > static_cast<std::size_t>(std::numeric_limits<int>::max()))", "const int nPluginRecordCount = static_cast<int>(unPluginRecordCount);", "v8::Array::New(pIsolate, nPluginRecordCount);", "if (LocalPluginRecordsArray.IsEmpty() || ManagerFailure.HasCaught()", "for (std::size_t unPluginRecordIndex = 0; unPluginRecordIndex < unPluginRecordCount; ++unPluginRecordIndex)", "MakePluginRecordObject(pIsolate, LocalContext, vecPluginRecords[unPluginRecordIndex], unPluginRecordIndex);", "if (LocalPluginRecordObject.IsEmpty() || ManagerFailure.HasCaught()", "LocalPluginRecordsArray->CreateDataProperty(LocalContext, unPluginRecordArrayIndex, LocalPluginRecordObject);", "if (!MaybeCreationResult.FromMaybe(false) || ManagerFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(LocalPluginRecordsArray);"],
		Forbidden: ["LocalPluginRecordsArray->Set("],
	},
	...g_vecLifecycleOperations.map(Lifecycle => ({
		Name: Lifecycle.Name,
		Fragments: ["if (!pIsolate) {\n\t\t\treturn;", ...(Lifecycle.Diagnostic ? [Lifecycle.Diagnostic] : [])],
		Order: ["if (ManagerFailure.HasCaught()", ...(Lifecycle.Parse ? [Lifecycle.Parse + " || ManagerFailure.HasCaught()"] : []), Lifecycle.Invoke + (Lifecycle.Parse ? "\n" : "\n\n") + "\t\t\tif (ManagerFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(" + Lifecycle.Result + ");"],
		Forbidden: ["ThrowError("],
	})),
	{
		Name: "ParseExtensionStringArgument",
		Fragments: ["kExtensionValueArgumentIndex = 0;", "kExtensionStringRequiredArgumentCount = 1;", "if (!pIsolate || !pszInvalidExtensionValueErrorMessage || !*pszInvalidExtensionValueErrorMessage)", "if (!LocalExtensionValue->IsString()) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, ManagerFailure, pszInvalidExtensionValueErrorMessage);\n\t\t\t\treturn false;", "if (strExtensionValue.empty()) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, ManagerFailure, pszInvalidExtensionValueErrorMessage);\n\t\t\t\treturn false;"],
		Order: ["if (ManagerFailure.HasCaught()", "if (CallbackInformation.Length() < kExtensionStringRequiredArgumentCount)", "if (LocalExtensionValue.IsEmpty() || ManagerFailure.HasCaught()", "if (!LocalExtensionValue->IsString())", "ValueToString(pIsolate, LocalExtensionValue);\n\t\t\tif (ManagerFailure.HasCaught()", "if (strExtensionValue.empty())", "strExtensionValueOut = std::move(strExtensionValue);", "return true;"],
		Forbidden: ["->ToString(", "IsNumber(", "Uint32Value(", "strExtensionValueOut.clear("],
	},
	{
		Name: "ListExtensionsCallback",
		Fragments: ["RethrowV8InstallationFailure(pIsolate, ManagerFailure, kExtensionListExcessiveLineCountErrorMessage);", "const std::uint32_t unExtensionLineArrayIndex = static_cast<std::uint32_t>(unExtensionLineIndex);"],
		Order: ["if (LocalContext.IsEmpty() || ManagerFailure.HasCaught()", "g_Application.GetExtensionManager().List();\n\t\t\tif (ManagerFailure.HasCaught()", "if (unExtensionLineCount > static_cast<std::size_t>(std::numeric_limits<int>::max()))", "const int nExtensionLineCount = static_cast<int>(unExtensionLineCount);", "v8::Array::New(pIsolate, nExtensionLineCount);", "if (LocalExtensionLinesArray.IsEmpty() || ManagerFailure.HasCaught()", "for (std::size_t unExtensionLineIndex = 0; unExtensionLineIndex < unExtensionLineCount; ++unExtensionLineIndex)", "MakeString(pIsolate, vecExtensionLines[unExtensionLineIndex]);", "if (LocalExtensionLine.IsEmpty() || ManagerFailure.HasCaught()", "LocalExtensionLinesArray->CreateDataProperty(LocalContext, unExtensionLineArrayIndex, LocalExtensionLine);", "if (!MaybeCreationResult.FromMaybe(false) || ManagerFailure.HasCaught()", "CallbackInformation.GetReturnValue().Set(LocalExtensionLinesArray);"],
		Forbidden: ["LocalExtensionLinesArray->Set("],
	},
	{
		Name: "RequireExternalPluginName",
		Fragments: ['kExternalPluginNameMissingRuntimeContextErrorMessage = "External resource access requires a SourceJS runtime context.";', "if (!pRuntime) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, ManagerFailure, kExternalPluginNameMissingRuntimeContextErrorMessage);\n\t\t\t\treturn false;"],
		Order: ["if (ManagerFailure.HasCaught()", "GetRuntimeFromCallbackInformation(CallbackInformation);\n\t\t\tif (ManagerFailure.HasCaught()", "if (!pRuntime)", "std::string strPluginName {};", "!pRuntime->GetCurrentPluginName(pIsolate, strPluginName) || ManagerFailure.HasCaught()", "strPluginNameOut = std::move(strPluginName);", "return true;"],
		Forbidden: ["strPluginName.empty()", "strPluginNameOut.clear("],
	},
	{
		Name: "ParseExternalHandleFromValue",
		Fragments: ['kExternalHandlePropertyName = "Handle";', "if (!pIsolate || LocalContext.IsEmpty() || LocalExternalHandleValue.IsEmpty())", "if (nExternalHandle <= 0) {\n\t\t\t\t\treturn false;", "nExternalHandleOut = nExternalHandle;\n\n\t\t\t\treturn true;", "if (!bObjectIntegerParsed || (nExternalHandle <= 0)) {\n\t\t\t\treturn false;", "nExternalHandleOut = nExternalHandle;\n\n\t\t\treturn true;"],
		Order: ["if (ManagerFailure.HasCaught()", "GetIntegerFromValue(LocalContext, LocalExternalHandleValue, nExternalHandle);\n\t\t\tif (ManagerFailure.HasCaught()", "if (bIntegerParsed)", "if (nExternalHandle <= 0)", "if (!LocalExternalHandleValue->IsObject())", "LocalExternalHandleValue.As<v8::Object>();", "if (LocalExternalHandleObject.IsEmpty())", "GetObjectInteger(pIsolate, LocalContext, LocalExternalHandleObject, kExternalHandlePropertyName, nExternalHandle);\n\t\t\tif (ManagerFailure.HasCaught()", "if (!bObjectIntegerParsed || (nExternalHandle <= 0))"],
		Forbidden: ["nExternalHandleOut = 0;", "->Int32Value(", "->ToString("],
	},
	{
		Name: "ParseRequiredExternalStringArgument",
		Fragments: ["if (!pIsolate || !pszInvalidExternalStringValueErrorMessage || !*pszInvalidExternalStringValueErrorMessage)", "if (nExternalStringArgumentIndex < 0) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, ManagerFailure, pszInvalidExternalStringValueErrorMessage);\n\t\t\t\treturn false;", "if (nExternalStringArgumentIndex >= CallbackInformation.Length()) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, ManagerFailure, pszInvalidExternalStringValueErrorMessage);\n\t\t\t\treturn false;", "if (!bAllowEmptyExternalString && strExternalString.empty()) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, ManagerFailure, pszInvalidExternalStringValueErrorMessage);\n\t\t\t\treturn false;"],
		Order: ["if (ManagerFailure.HasCaught()", "if (nExternalStringArgumentIndex < 0)", "if (nExternalStringArgumentIndex >= CallbackInformation.Length())", "CallbackInformation[nExternalStringArgumentIndex];", "if (LocalExternalStringValue.IsEmpty() || ManagerFailure.HasCaught()", "if (LocalExternalStringValue->IsNullOrUndefined())", "if (!LocalExternalStringValue->IsString())", "ValueToString(pIsolate, LocalExternalStringValue);\n\t\t\tif (ManagerFailure.HasCaught()", "if (!bAllowEmptyExternalString && strExternalString.empty())", "strExternalStringOut = std::move(strExternalString);", "return true;"],
		Forbidden: ["->ToString(", "strExternalStringOut.clear("],
	},
	{
		Name: "ParseExternalStringFromValue",
		Fragments: ["if (IsValueNullish(LocalExternalStringValue)) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, ExternalFailure, pszInvalidExternalStringValueErrorMessage);", "if (!bAllowEmptyExternalString && strExternalString.empty()) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, ExternalFailure, pszInvalidExternalStringValueErrorMessage);"],
		Order: ["if (ExternalFailure.HasCaught()", "if (LocalExternalStringValue.IsEmpty() || ExternalFailure.HasCaught()", "if (IsValueNullish(LocalExternalStringValue))", "if (!LocalExternalStringValue->IsString())", "ValueToString(pIsolate, LocalExternalStringValue);\n\t\t\tif (ExternalFailure.HasCaught()", "if (!bAllowEmptyExternalString && strExternalString.empty())", "strExternalStringOut = std::move(strExternalString);", "return true;"],
		Forbidden: ["->ToString(", "strExternalStringOut.clear("],
	},
	{
		Name: "ParseOptionalExternalStringArgument",
		Fragments: ["if (nExternalStringArgumentIndex < 0) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, ExternalFailure, pszInvalidExternalStringValueErrorMessage);", "if (nExternalStringArgumentIndex >= CallbackInformation.Length()) {\n\t\t\t\tstrExternalStringOut.clear();\n\t\t\t\treturn true;", "if (IsValueNullish(LocalExternalStringArgumentValue)) {\n\t\t\t\tstrExternalStringOut.clear();\n\t\t\t\treturn true;"],
		Order: ["if (ExternalFailure.HasCaught()", "if (nExternalStringArgumentIndex < 0)", "if (nExternalStringArgumentIndex >= CallbackInformation.Length())", "if (LocalExternalStringArgumentValue.IsEmpty() || ExternalFailure.HasCaught()", "if (IsValueNullish(LocalExternalStringArgumentValue))", "std::string strExternalString {};", "ParseExternalStringFromValue(pIsolate, LocalExternalStringArgumentValue, pszInvalidExternalStringValueErrorMessage, bAllowEmptyExternalString, strExternalString);\n\t\t\tif (ExternalFailure.HasCaught()", "if (!bStringParsed)", "strExternalStringOut = std::move(strExternalString);", "\n\t\t\treturn true;"],
		Forbidden: ["bAllowEmptyExternalString, strExternalStringOut)", "return ParseExternalStringFromValue("],
	},
	{
		Name: "ParseOptionalExternalStringProperty",
		Fragments: ["if (IsValueNullish(LocalExternalStringPropertyValue)) {\n\t\t\t\treturn true;"],
		Order: ["if (ExternalFailure.HasCaught()", "MakeString(pIsolate, pszExternalStringPropertyName);", "if (LocalExternalStringPropertyName.IsEmpty() || ExternalFailure.HasCaught()", "!LocalExternalObject->Get(LocalContext, LocalExternalStringPropertyName).ToLocal(&LocalExternalStringPropertyValue) || LocalExternalStringPropertyValue.IsEmpty() || ExternalFailure.HasCaught()", "if (IsValueNullish(LocalExternalStringPropertyValue))", "std::string strExternalString {};", "ParseExternalStringFromValue(pIsolate, LocalExternalStringPropertyValue, pszInvalidExternalStringValueErrorMessage, bAllowEmptyExternalString, strExternalString);\n\t\t\tif (ExternalFailure.HasCaught()", "if (!bStringParsed)", "strExternalStringOut = std::move(strExternalString);", "\n\t\t\treturn true;"],
		Forbidden: ["strExternalStringOut.clear(", "bAllowEmptyExternalString, strExternalStringOut)", "return ParseExternalStringFromValue("],
	},
	{
		Name: "ParseOptionalExternalBooleanProperty",
		Fragments: ["if (IsValueNullish(LocalExternalBooleanPropertyValue)) {\n\t\t\t\treturn true;", "if (!LocalExternalBooleanPropertyValue->IsBoolean()) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, ExternalFailure, pszInvalidExternalBooleanValueErrorMessage);"],
		Order: ["if (ExternalFailure.HasCaught()", "MakeString(pIsolate, pszExternalBooleanPropertyName);", "if (LocalExternalBooleanPropertyName.IsEmpty() || ExternalFailure.HasCaught()", "!LocalExternalObject->Get(LocalContext, LocalExternalBooleanPropertyName).ToLocal(&LocalExternalBooleanPropertyValue) || LocalExternalBooleanPropertyValue.IsEmpty() || ExternalFailure.HasCaught()", "if (IsValueNullish(LocalExternalBooleanPropertyValue))", "if (!LocalExternalBooleanPropertyValue->IsBoolean())", "LocalExternalBooleanPropertyValue->BooleanValue(pIsolate);\n\t\t\tif (ExternalFailure.HasCaught()", "bExternalBooleanOut = bExternalBoolean;", "\n\t\t\treturn true;"],
		Forbidden: ["bExternalBooleanOut = false;", "bExternalBooleanOut = LocalExternalBooleanPropertyValue"],
	},
	{
		Name: "ParseExternalInt32FromValue",
		Fragments: ["if (IsValueNullish(LocalExternalInt32Value)) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, ExternalFailure, pszInvalidExternalInt32ValueErrorMessage);", "if (!std::isfinite(dblExternalInt32Value) || (std::floor(dblExternalInt32Value) != dblExternalInt32Value) || (dblExternalInt32Value < static_cast<double>(std::numeric_limits<int>::min())) || (dblExternalInt32Value > static_cast<double>(std::numeric_limits<int>::max())) || ExternalFailure.HasCaught()"],
		Order: ["if (ExternalFailure.HasCaught()", "if (LocalExternalInt32Value.IsEmpty() || ExternalFailure.HasCaught()", "if (IsValueNullish(LocalExternalInt32Value))", "if (!LocalExternalInt32Value->IsNumber())", "LocalExternalInt32Value.As<v8::Number>();", "if (LocalExternalInt32Number.IsEmpty() || ExternalFailure.HasCaught()", "LocalExternalInt32Number->Value();", "if (!std::isfinite(dblExternalInt32Value)", "nExternalInt32Out = static_cast<int>(dblExternalInt32Value);", "return true;"],
		Forbidden: ["->Int32Value(", "nExternalInt32Out = 0;"],
	},
	{
		Name: "ParseOptionalExternalInt32Property",
		Fragments: ["if (IsValueNullish(LocalExternalInt32PropertyValue)) {\n\t\t\t\treturn true;"],
		Order: ["if (ExternalFailure.HasCaught()", "MakeString(pIsolate, pszExternalInt32PropertyName);", "if (LocalExternalInt32PropertyName.IsEmpty() || ExternalFailure.HasCaught()", "!LocalExternalObject->Get(LocalContext, LocalExternalInt32PropertyName).ToLocal(&LocalExternalInt32PropertyValue) || LocalExternalInt32PropertyValue.IsEmpty() || ExternalFailure.HasCaught()", "if (IsValueNullish(LocalExternalInt32PropertyValue))", "int nExternalInt32 = 0;", "ParseExternalInt32FromValue(pIsolate, LocalExternalInt32PropertyValue, pszInvalidExternalInt32ValueErrorMessage, nExternalInt32);\n\t\t\tif (ExternalFailure.HasCaught()", "if (!bIntegerParsed)", "nExternalInt32Out = nExternalInt32;", "\n\t\t\treturn true;"],
		Forbidden: ["nExternalInt32Out = 0;", "pszInvalidExternalInt32ValueErrorMessage, nExternalInt32Out)", "return ParseExternalInt32FromValue("],
	},
	{
		Name: "MakeExternalInt64Value",
		Fragments: ["if (!pIsolate) {\n\t\t\treturn {};"],
		Order: ["if (ExternalFailure.HasCaught()", "v8::BigInt::New(pIsolate, nExternalInt64);", "if (LocalExternalInt64Value.IsEmpty() || ExternalFailure.HasCaught()", "return LocalExternalInt64Value;"],
		Forbidden: ["v8::Number::New(", "static_cast<double>", "return v8::BigInt::New("],
	},
	{
		Name: "SetSOCIParameterFromValue",
		Fragments: ['kSOCIParameterInvalidBigIntErrorMessage = "soci parameters require lossless signed 64-bit BigInt values.";', 'kSOCIParameterInvalidNumberErrorMessage = "soci parameters require finite numeric values.";', 'kSOCIParameterUnsupportedValueErrorMessage = "soci parameters support null, boolean, string, finite Number and signed 64-bit BigInt values.";', "std::string const strNullSOCIParameterValue {};", "const int nBooleanSOCIParameterValue = LocalSOCIParameterValue->BooleanValue(pIsolate) ? 1 : 0;", "if (!std::isfinite(dblNumberSOCIParameterValue) || SOCIFailure.HasCaught()", "const int nIntegerSOCIParameterValue = static_cast<int>(dblNumberSOCIParameterValue);"],
		Order: ["if (SOCIFailure.HasCaught()", "if (LocalSOCIParameterValue.IsEmpty() || SOCIFailure.HasCaught()", "if (IsValueNullish(LocalSOCIParameterValue))", "strNullSOCIParameterValue, soci::i_null);", "if (LocalSOCIParameterValue->IsBoolean())", "LocalSOCIParameterValue->BooleanValue(pIsolate) ? 1 : 0;\n\t\t\t\tif (SOCIFailure.HasCaught()", "nBooleanSOCIParameterValue, soci::i_ok);", "if (LocalSOCIParameterValue->IsString())", "ValueToString(pIsolate, LocalSOCIParameterValue);\n\t\t\t\tif (SOCIFailure.HasCaught()", "strStringSOCIParameterValue, soci::i_ok);", "if (LocalSOCIParameterValue->IsBigInt())", "!GetInt64Argument(pIsolate, LocalContext, LocalSOCIParameterValue, kSOCIParameterInvalidBigIntErrorMessage, nBigIntSOCIParameterValue) || SOCIFailure.HasCaught()", "const long long nSOCIParameterValue = static_cast<long long>(nBigIntSOCIParameterValue);", ", nSOCIParameterValue, soci::i_ok);", "if (LocalSOCIParameterValue->IsNumber())", "if (LocalNumberSOCIParameterValue.IsEmpty() || SOCIFailure.HasCaught()", "if (!std::isfinite(dblNumberSOCIParameterValue) || SOCIFailure.HasCaught()", "if (LocalNumberSOCIParameterValue->IsInt32())", "nIntegerSOCIParameterValue, soci::i_ok);", "dblNumberSOCIParameterValue, soci::i_ok);", "\n\t\t\tRethrowV8InstallationFailure(pIsolate, SOCIFailure, kSOCIParameterUnsupportedValueErrorMessage);\n\t\t\treturn false;\n\t\t} catch"],
		Forbidden: ["->Int64Value(", "->ToString(", "vecSOCIParameters.clear("],
	},
	{
		Name: "ParseSOCIParametersFromValue",
		Fragments: ['kSOCIEmptyNamedParameterNameErrorMessage = "soci named parameter names must not be empty.";', 'kSOCIInvalidParametersErrorMessage = "soci parameters expect an array for positional values or an object for named values.";', 'kSOCIPositionalParameterName = "";', "if (IsValueNullish(LocalSOCIParametersValue)) {\n\t\t\t\tvecSOCIParametersOut.clear();\n\t\t\t\treturn true;", "vecSOCIParametersOut = std::move(vecSOCIParameters);\n\t\t\t\treturn true;", "vecSOCIParametersOut = std::move(vecSOCIParameters);\n\n\t\t\treturn true;"],
		Order: ["if (SOCIFailure.HasCaught()", "if (LocalSOCIParametersValue.IsEmpty() || SOCIFailure.HasCaught()", "if (IsValueNullish(LocalSOCIParametersValue))", "std::vector<SOCIBoundParameter> vecSOCIParameters {};", "if (LocalSOCIParametersValue->IsArray())", "if (LocalPositionalSOCIParametersArray.IsEmpty() || SOCIFailure.HasCaught()", "unSOCIParameterIndex < LocalPositionalSOCIParametersArray->Length()", "!LocalPositionalSOCIParametersArray->Get(LocalContext, unSOCIParameterIndex).ToLocal(&LocalSOCIParameterValue) || LocalSOCIParameterValue.IsEmpty() || SOCIFailure.HasCaught()", "!SetSOCIParameterFromValue(pIsolate, LocalContext, vecSOCIParameters, kSOCIPositionalParameterName, false, LocalSOCIParameterValue) || SOCIFailure.HasCaught()", "if (!LocalSOCIParametersValue->IsObject())", "if (LocalNamedSOCIParametersObject.IsEmpty() || SOCIFailure.HasCaught()", "!LocalNamedSOCIParametersObject->GetOwnPropertyNames(LocalContext).ToLocal(&LocalSOCIParameterNamesArray) || LocalSOCIParameterNamesArray.IsEmpty() || SOCIFailure.HasCaught()", "unSOCIParameterIndex < LocalSOCIParameterNamesArray->Length()", "!LocalSOCIParameterNamesArray->Get(LocalContext, unSOCIParameterIndex).ToLocal(&LocalSOCIParameterNameValue) || LocalSOCIParameterNameValue.IsEmpty() || SOCIFailure.HasCaught()", "!LocalNamedSOCIParametersObject->Get(LocalContext, LocalSOCIParameterNameValue).ToLocal(&LocalSOCIParameterValue) || LocalSOCIParameterValue.IsEmpty() || SOCIFailure.HasCaught()", "ValueToString(pIsolate, LocalSOCIParameterNameValue);\n\t\t\t\tif (SOCIFailure.HasCaught()", "if (strSOCIParameterName.empty())", "!SetSOCIParameterFromValue(pIsolate, LocalContext, vecSOCIParameters, strSOCIParameterName, true, LocalSOCIParameterValue) || SOCIFailure.HasCaught()", "vecSOCIParametersOut = std::move(vecSOCIParameters);\n\n\t\t\treturn true;"],
		Forbidden: ["LocalNamedSOCIParametersObject->GetPropertyNames(", "SetSOCIParameterFromValue(pIsolate, LocalContext, vecSOCIParametersOut,"],
	},
	{
		Name: "ParseAsyncRequestExecutionMode",
		Fragments: ["kExecutionOptionArgumentCount = kCallbackArgumentCount + kOptionsArgumentCount;", 'kBlockingOptionPropertyName = "Blocking";', "(nOperationArgumentCount < nRequiredArgumentCount) || ((nOperationArgumentCount - nRequiredArgumentCount) > nOptionalArgumentCount)", "bool bBlocking = false;"],
		Order: ["if (AsyncFailure.HasCaught()", "CallbackInformation.Length() - kExecutionOptionArgumentCount;", "if ((nRequiredArgumentCount < 1)", "if (LocalOptionsValue.IsEmpty() || AsyncFailure.HasCaught()", "if (!LocalOptionsValue->IsObject() || LocalOptionsValue->IsArray())", "if (LocalCallbackValue.IsEmpty() || AsyncFailure.HasCaught()", "if (!LocalCallbackValue->IsFunction())", "if (LocalContext.IsEmpty() || AsyncFailure.HasCaught()", "if (LocalOptionsObject.IsEmpty() || AsyncFailure.HasCaught()", "!ParseOptionalExternalBooleanProperty(pIsolate, LocalContext, LocalOptionsObject, kBlockingOptionPropertyName, pszInvalidBlockingOptionErrorMessage, bBlocking) || AsyncFailure.HasCaught()", "if (LocalCallbackFunction.IsEmpty() || AsyncFailure.HasCaught()", "ExecutionModeOut.m_bBlocking = bBlocking;", "ExecutionModeOut.m_CallbackFunction = LocalCallbackFunction;", "\n\t\t\treturn true;"],
		Forbidden: ["ThrowError(", "return ParseOptionalExternalBooleanProperty("],
	},
	{
		Name: "RunAsyncRequest",
		Fragments: ["auto Task = [Operation = std::move(Operation)]() mutable -> AsyncRequestResult {", "RequestResult.m_Value = Operation();", "auto ConvertResult = [pszInvalidResultErrorMessage, Converter]", "if (!pResultIsolate || LocalResultContext.IsEmpty())", "auto* const pResult = std::any_cast<TResult>(&ResultValue);", "v8::MaybeLocal<v8::Value> const MaybeResultValue = Converter(pResultIsolate, LocalResultContext, *pResult);"],
		Order: ["if (AsyncFailure.HasCaught()", "!pRuntime->GetCurrentPluginName(pIsolate, strPluginName) || AsyncFailure.HasCaught()", "auto Task =", "auto ConvertResult =", "std::any_cast<TResult>(&ResultValue);", "if (!pResult || ResultFailure.HasCaught()", "MaybeResultValue = Converter(", "if (!MaybeResultValue.ToLocal(&LocalResultValue) || LocalResultValue.IsEmpty() || ResultFailure.HasCaught()", "return LocalResultValue;", "if (ExecutionMode.m_bBlocking)", "pRuntime->RunBlockingRequest(ExecutionMode.m_CallbackFunction, Task, ConvertResult);", "if (!bRequestRan || AsyncFailure.HasCaught()", "pRuntime->QueueAsyncRequest(ExecutionMode.m_CallbackFunction, Task, ConvertResult);", "if (!bRequestQueued || AsyncFailure.HasCaught()"],
		Forbidden: ["ThrowError(", "TResult const* const pResult", "return Converter("],
	},
	{
		Name: "RequireSOCISessionRecordFromCallbackInformation",
		Fragments: ["kSOCISessionHandleArgumentIndex = 0;", 'kMissingSOCISessionHandleErrorMessage = "soci session handle is required.";', 'kUnknownSOCISessionHandleErrorMessage = "Unknown soci session handle.";', "if ((itSOCISession == umapSOCISessions.end()) || !itSOCISession->second || (itSOCISession->second->m_strPluginName != strCurrentPluginName))", "// Waiting for that mutex here would block gameplay while an earlier request runs."],
		Order: ["if (SOCIFailure.HasCaught()", "if (LocalContext.IsEmpty() || SOCIFailure.HasCaught()", "if (CallbackInformation.Length() < kSOCISessionRequiredArgumentCount)", "if (LocalSOCISessionHandleValue.IsEmpty() || SOCIFailure.HasCaught()", "!ParseExternalHandleFromValue(pIsolate, LocalContext, LocalSOCISessionHandleValue, nSOCISessionHandle) || SOCIFailure.HasCaught()", "!RequireExternalPluginName(CallbackInformation, strCurrentPluginName) || SOCIFailure.HasCaught()", "umapSOCISessions = GetSOCISessions();", "auto itSOCISession = umapSOCISessions.find(nSOCISessionHandle);\n\t\t\tif (SOCIFailure.HasCaught()", "if ((itSOCISession == umapSOCISessions.end())", "return itSOCISession->second;"],
		Forbidden: ["ThrowError(", "std::lock_guard", "std::unique_lock", "m_pSession->"],
	},
	{
		Name: "RequireSocketConnectionFromCallbackInformation",
		Fragments: ["kSocketConnectionHandleArgumentIndex = 0;", "kSocketConnectionRequiredArgumentCount = kSocketConnectionHandleArgumentIndex + 1;", 'kMissingSocketConnectionHandleErrorMessage = "socket connection handle is required.";', 'kUnknownSocketConnectionHandleErrorMessage = "Unknown socket connection handle.";', "if ((itSocketConnection == umapSocketConnections.end()) || !itSocketConnection->second || (itSocketConnection->second->m_strPluginName != strCurrentPluginName))", "// Registry lookup stays on the game thread without waiting for socket IO."],
		Order: ["if (SocketFailure.HasCaught()", "if (LocalContext.IsEmpty() || SocketFailure.HasCaught()", "if (CallbackInformation.Length() < kSocketConnectionRequiredArgumentCount)", "if (LocalSocketConnectionHandleValue.IsEmpty() || SocketFailure.HasCaught()", "!ParseExternalHandleFromValue(pIsolate, LocalContext, LocalSocketConnectionHandleValue, nSocketConnectionHandle) || SocketFailure.HasCaught()", "!RequireExternalPluginName(CallbackInformation, strCurrentPluginName) || SocketFailure.HasCaught()", "umapSocketConnections = GetSocketConnections();", "auto itSocketConnection = umapSocketConnections.find(nSocketConnectionHandle);\n\t\t\tif (SocketFailure.HasCaught()", "if ((itSocketConnection == umapSocketConnections.end())", "return itSocketConnection->second;"],
		Forbidden: ["ThrowError(", "std::lock_guard", "std::unique_lock", "SocketConnectionOperation", "m_hSocket"],
	},
	{
		Name: "MakeSOCIQueryValue",
		Fragments: ["std::holds_alternative<std::monostate>(QueryValue)", "v8::Null(pIsolate);", "MakeString(pIsolate, std::get<std::string>(QueryValue));", "v8::Number::New(pIsolate, std::get<double>(QueryValue));", "v8::Integer::New(pIsolate, std::get<int>(QueryValue));", "v8::BigInt::New(pIsolate, std::get<long long>(QueryValue));", "v8::BigInt::NewFromUnsigned(pIsolate, std::get<unsigned long long>(QueryValue));"],
		Order: ["if (SOCIFailure.HasCaught()", "std::holds_alternative<std::monostate>", "std::holds_alternative<std::string>", "std::holds_alternative<double>", "std::holds_alternative<int>", "std::holds_alternative<long long>", "std::holds_alternative<unsigned long long>"],
		Forbidden: ["static_cast<double>", "return v8::", "return MakeString("],
	},
	{
		Name: "MakeSOCIRowObject",
		Fragments: ["for (auto const& SOCIColumn : vecSOCIQueryColumns)", "LocalSOCIRowObject->CreateDataProperty(LocalContext, LocalSOCIColumnName, LocalSOCIColumnValue);"],
		Order: ["if (SOCIFailure.HasCaught()", "v8::Object::New(pIsolate);", "if (LocalSOCIRowObject.IsEmpty() || SOCIFailure.HasCaught()", "for (auto const& SOCIColumn", "MakeSOCIQueryValue(pIsolate, SOCIColumn.m_Value);", "if (LocalSOCIColumnValue.IsEmpty() || SOCIFailure.HasCaught()", "MakeString(pIsolate, SOCIColumn.m_strName);", "if (LocalSOCIColumnName.IsEmpty() || SOCIFailure.HasCaught()", "LocalSOCIRowObject->CreateDataProperty(", "if (!MaybeCreationResult.FromMaybe(false) || SOCIFailure.HasCaught()", "return LocalSOCIRowObject;"],
		Forbidden: ["SetValue(", "->Set(", "m_strName.c_str("],
	},
	{
		Name: "RegisterRequiredSOCIBackends",
		Fragments: ["static std::once_flag s_SOCIBackendRegistration {};", "auto RegisterSOCIBackends = []() -> void {", "std::call_once(s_SOCIBackendRegistration, RegisterSOCIBackends);"],
		Order: ["soci::register_factory_sqlite3();", "soci::register_factory_mysql();", "std::call_once("],
		Forbidden: ["s_bSOCIBackendsRegistered", "return true;"],
	},
	{
		Name: "ConnectSOCICallback",
		Fragments: ["kSOCIConnectRequiredArgumentCount = 1;", "kSOCIConnectOptionalArgumentCount = 1;", "kSOCIConnectOptionsAndCallbackArgumentCount = 2;", "kSOCIConnectAllowEmptyBackend = true;", "if (!NewSOCISessionRecord || !NewSOCISessionRecord->m_pSession)", "if (!bSessionRegistered)", "return LocalSOCISessionHandle;"],
		Order: ["v8::TryCatch SOCIFailure(pIsolate);", "GetRuntimeFromCallbackInformation(CallbackInformation);", "!ParseAsyncRequestExecutionMode(", "!RequireExternalPluginName(", "!ParseRequiredExternalStringArgument(", "if (nSOCIConnectOperationArgumentCount > kSOCIConnectRequiredArgumentCount)", "!ParseOptionalExternalStringArgument(", "auto Operation = [strCurrentPluginName, strSOCIConnectionString, strSOCIBackendName]", "RegisterRequiredSOCIBackends();", "std::make_shared<SOCISessionRecord>();", "m_strPluginName = strCurrentPluginName;", "std::make_unique<soci::session>(strSOCIConnectionString);", "std::make_unique<soci::session>(strSOCIBackendName, strSOCIConnectionString);", "auto ConvertResult =", "if (!NewSOCISessionRecord", "AllocateExternalHandle();", "v8::Integer::New(pResultIsolate, nSOCISessionHandle);", "if (LocalSOCISessionHandle.IsEmpty() || SOCIResultFailure.HasCaught()", "GetSOCISessions().emplace(nSOCISessionHandle, NewSOCISessionRecord).second;", "if (!bSessionRegistered)", "return LocalSOCISessionHandle;", "!RunAsyncRequest<std::shared_ptr<SOCISessionRecord>>("],
		Forbidden: ["ThrowError(", "GetSOCISessions()[", "std::lock_guard"],
	},
	{
		Name: "CloseSOCICallback",
		Fragments: ["kSOCICloseHandleArgumentIndex = 0;", "kSOCICloseRequiredArgumentCount = 1;", "SOCISessionRecordOwner->m_pSession.reset();", "if ((itResultSession != umapResultSessions.end()) && (itResultSession->second == SOCISessionRecordOwner))"],
		Order: ["v8::TryCatch SOCIFailure(pIsolate);", "GetRuntimeFromCallbackInformation(CallbackInformation);", "!ParseAsyncRequestExecutionMode(", "if (LocalContext.IsEmpty() || SOCIFailure.HasCaught()", "if (LocalSOCICloseSessionHandleValue.IsEmpty() || SOCIFailure.HasCaught()", "!ParseExternalHandleFromValue(", "!RequireExternalPluginName(", "auto itSOCISession = umapSOCISessions.find(nSOCISessionHandle);", "itSOCISession->second->m_strPluginName == strCurrentPluginName", "auto Operation = [SOCISessionRecordOwner]", "std::lock_guard<std::mutex> Lock(SOCISessionRecordOwner->m_Mutex);", "if (!SOCISessionRecordOwner->m_pSession)", "m_pSession.reset();", "auto ConvertResult =", "v8::Boolean::New(pResultIsolate, bClosed);", "if (LocalSOCIClosed.IsEmpty() || SOCIResultFailure.HasCaught()", "if (bClosed && SOCISessionRecordOwner)", "if ((itResultSession !=", "umapResultSessions.erase(itResultSession);", "return LocalSOCIClosed;", "!RunAsyncRequest<bool>("],
		Forbidden: ["ThrowError(", "return v8::Boolean::New("],
	},
	...[
		{ Name: "Execute", Result: "std::int64_t", Finish: "return static_cast<std::int64_t>(SOCIStatement.get_affected_rows());" },
		{ Name: "Query", Result: "SOCIQueryResult", Finish: "return CollectSOCIStatementRows(SOCIStatement, SOCIRow);" },
	].map(Operation => ({
		Name: Operation.Name + "SOCICallback",
		Fragments: ["kSOCI" + Operation.Name + "RequiredArgumentCount = 2;", "kSOCI" + Operation.Name + "OptionalArgumentCount = 1;", "kSOCI" + Operation.Name + "OptionsAndCallbackArgumentCount = 2;", 'throw std::runtime_error("soci.' + Operation.Name + ' cannot use a closed session.");'],
		Order: ["v8::TryCatch SOCIFailure(pIsolate);", "GetRuntimeFromCallbackInformation(CallbackInformation);", "!ParseAsyncRequestExecutionMode(", "RequireSOCISessionRecordFromCallbackInformation(CallbackInformation);", "!ParseRequiredExternalStringArgument(", "if (nSOCI" + Operation.Name + "OperationArgumentCount > kSOCI" + Operation.Name + "RequiredArgumentCount)", "if (LocalSOCIParametersValue.IsEmpty() || SOCIFailure.HasCaught()", "!ParseSOCIParametersFromValue(", "auto Operation = [SOCISessionRecordOwner, strSQLQuery, vecSOCIParameters = std::move(vecSOCIParameters)]", "std::lock_guard<std::mutex> Lock(SOCISessionRecordOwner->m_Mutex);", "if (!SOCISessionRecordOwner->m_pSession)", "soci::statement SOCIStatement = *SOCISessionRecordOwner->m_pSession;", "SOCIStatement.alloc();", "SOCIStatement.prepare(strSQLQuery);", "ExchangeSOCIParameters(SOCIStatement, vecSOCIParameters, strSQLQuery);", "SOCIStatement.define_and_bind();", Operation.Finish, "auto ConvertResult =", "!RunAsyncRequest<" + Operation.Result + ">("],
		Forbidden: ["ThrowError("],
	})),
	{
		Name: "ExecuteSOCICallback",
		Fragments: ["return MakeExternalInt64Value(pResultIsolate, nSOCIAffectedRowCount);", "SOCIStatement.execute(true);"],
		Order: ["if (nSOCIExecuteOperationArgumentCount >", "if (LocalContext.IsEmpty() || SOCIFailure.HasCaught()", "if (LocalSOCIParametersValue.IsEmpty() || SOCIFailure.HasCaught()", "!ParseSOCIParametersFromValue("],
		Forbidden: ["v8::Number::New(", "static_cast<double>"],
	},
	{
		Name: "QuerySOCICallback",
		Fragments: ["constexpr std::size_t kMaximumSOCIRowCount = std::numeric_limits<std::uint32_t>::max();", "SOCIStatement.exchange(soci::into(SOCIRow));", "for (auto const& vecSOCIQueryColumns : vecSOCIRows)"],
		Order: ["auto ConvertResult =", "if (vecSOCIRows.size() > kMaximumSOCIRowCount)", "v8::Array::New(pResultIsolate);", "if (LocalSOCIRowsArray.IsEmpty() || SOCIResultFailure.HasCaught()", "std::uint32_t unSOCIRowIndex = 0;", "MakeSOCIRowObject(pResultIsolate, LocalResultContext, vecSOCIQueryColumns);", "if (LocalSOCIRowObject.IsEmpty() || SOCIResultFailure.HasCaught()", "LocalSOCIRowsArray->CreateDataProperty(LocalResultContext, unSOCIRowIndex, LocalSOCIRowObject);", "if (!MaybeCreationResult.FromMaybe(false) || SOCIResultFailure.HasCaught()", "++unSOCIRowIndex;", "return LocalSOCIRowsArray;"],
		Forbidden: ["LocalSOCIRowsArray->Set("],
	},
	...[
		{ Name: "GetSOCIBackendNameCallback", Role: "BackendName", Export: "GetBackendName", ArgumentCount: 1, ResultType: "std::string", Capture: "SOCISessionRecordOwner", Invoke: "return SOCISessionRecordOwner->m_pSession->get_backend_name();", Result: "return LocalSOCIBackendName;" },
		{ Name: "GetSOCILastInsertIDCallback", Role: "LastInsertID", Export: "LastInsertId", ArgumentCount: 2, ResultType: "std::int64_t", Capture: "SOCISessionRecordOwner, strSOCITableName", Parse: "!ParseRequiredExternalStringArgument(CallbackInformation, kSOCILastInsertIDTableNameArgumentIndex, kSOCILastInsertIDInvalidTableNameErrorMessage, kSOCILastInsertIDAllowEmptyTableName, strSOCITableName)", Invoke: "if (!SOCISessionRecordOwner->m_pSession->get_last_insert_id(strSOCITableName, nSOCILastInsertID))", Result: "return MakeExternalInt64Value(pResultIsolate, nSOCILastInsertID);" },
		{ Name: "GetSOCINextSequenceValueCallback", Role: "NextSequenceValue", Export: "GetNextSequenceValue", ArgumentCount: 2, ResultType: "std::int64_t", Capture: "SOCISessionRecordOwner, strSOCISequenceName", Parse: "!ParseRequiredExternalStringArgument(CallbackInformation, kSOCINextSequenceValueNameArgumentIndex, kSOCINextSequenceValueInvalidNameErrorMessage, kSOCINextSequenceValueAllowEmptyName, strSOCISequenceName)", Invoke: "if (!SOCISessionRecordOwner->m_pSession->get_next_sequence_value(strSOCISequenceName, nSOCINextSequenceValue))", Result: "return MakeExternalInt64Value(pResultIsolate, nSOCINextSequenceValue);" },
		{ Name: "BeginSOCICallback", Role: "Transaction", Export: "Begin", ArgumentCount: 1, ResultType: "bool", Capture: "SOCISessionRecordOwner", Invoke: "SOCISessionRecordOwner->m_pSession->begin();", Result: "return v8::Boolean::New(pResultIsolate, bSucceeded);" },
		{ Name: "CommitSOCICallback", Role: "Commit", Export: "Commit", ArgumentCount: 1, ResultType: "bool", Capture: "SOCISessionRecordOwner", Invoke: "SOCISessionRecordOwner->m_pSession->commit();", Result: "return v8::Boolean::New(pResultIsolate, bSucceeded);" },
		{ Name: "RollbackSOCICallback", Role: "Rollback", Export: "Rollback", ArgumentCount: 1, ResultType: "bool", Capture: "SOCISessionRecordOwner", Invoke: "SOCISessionRecordOwner->m_pSession->rollback();", Result: "return v8::Boolean::New(pResultIsolate, bSucceeded);" },
		{ Name: "ReconnectSOCICallback", Role: "Reconnect", Export: "Reconnect", ArgumentCount: 1, ResultType: "bool", Capture: "SOCISessionRecordOwner", Invoke: "SOCISessionRecordOwner->m_pSession->reconnect();", Result: "return v8::Boolean::New(pResultIsolate, bSucceeded);" },
		{ Name: "IsSOCIConnectedCallback", Role: "Connected", Export: "IsConnected", ArgumentCount: 1, ResultType: "bool", Capture: "SOCISessionRecordOwner", Invoke: "return SOCISessionRecordOwner->m_pSession->is_connected();", Result: "return v8::Boolean::New(pResultIsolate, bConnected);" },
	].map(Request => ({
		Name: Request.Name,
		Fragments: ["kSOCI" + Request.Role + "RequiredArgumentCount = " + Request.ArgumentCount + ";", "kSOCI" + Request.Role + "RequiredArgumentCount, 0, kSOCI" + Request.Role + "InvalidArgumentsErrorMessage, kSOCI" + Request.Role + "BlockingOptionErrorMessage, ExecutionMode)", "if (!pResultIsolate || LocalResultContext.IsEmpty()) {\n\t\t\t\t\treturn {};", "// Session IO is serialized on workers; callbacks run after this lock is released."],
		Order: ["v8::TryCatch SOCIFailure(pIsolate);", "GetRuntimeFromCallbackInformation(CallbackInformation);", "!ParseAsyncRequestExecutionMode(", "RequireSOCISessionRecordFromCallbackInformation(CallbackInformation);", "if (!SOCISessionRecordOwner || SOCIFailure.HasCaught()", ...(Request.Parse ? [Request.Parse + " || SOCIFailure.HasCaught()"] : []), "auto Operation = [" + Request.Capture + "]() -> " + Request.ResultType + " {", "std::lock_guard<std::mutex> Lock(SOCISessionRecordOwner->m_Mutex);", "if (!SOCISessionRecordOwner->m_pSession)", 'throw std::runtime_error("soci.' + Request.Export + ' cannot use a closed session.");', Request.Invoke, "auto ConvertResult =", Request.Result, "!RunAsyncRequest<" + Request.ResultType + ">("],
		Forbidden: ["ThrowError("],
	})),
	{
		Name: "GetSOCIBackendNameCallback",
		Fragments: ["MakeString(pResultIsolate, strSOCIBackendName);", "if (LocalSOCIBackendName.IsEmpty()) {\n\t\t\t\t\treturn {};"],
		Order: ["auto ConvertResult =", "MakeString(pResultIsolate, strSOCIBackendName);", "if (LocalSOCIBackendName.IsEmpty())", "return LocalSOCIBackendName;"],
		Forbidden: ["strSOCIBackendName.c_str("],
	},
	...[
		{ Name: "GetSOCILastInsertIDCallback", Value: "nSOCILastInsertID", AllowEmpty: "kSOCILastInsertIDAllowEmptyTableName", Unsupported: "kSOCIUnsupportedLastInsertIDErrorMessage" },
		{ Name: "GetSOCINextSequenceValueCallback", Value: "nSOCINextSequenceValue", AllowEmpty: "kSOCINextSequenceValueAllowEmptyName", Unsupported: "kSOCIUnsupportedSequenceValueErrorMessage" },
	].map(Request => ({
		Name: Request.Name,
		Fragments: [Request.AllowEmpty + " = false;", "static_assert(std::numeric_limits<long long>::digits <= std::numeric_limits<std::int64_t>::digits,", "long long " + Request.Value + " = 0;", "throw std::runtime_error(" + Request.Unsupported + ");", "return static_cast<std::int64_t>(" + Request.Value + ");"],
		Order: ["static_assert(", "auto Operation =", "long long " + Request.Value + " = 0;", "throw std::runtime_error(" + Request.Unsupported + ");", "return static_cast<std::int64_t>(" + Request.Value + ");", "auto ConvertResult =", "return MakeExternalInt64Value("],
		Forbidden: ["v8::Number::New(", "static_cast<double>"],
	})),
	...[
		{ Name: "Connect", Count: 2, Result: "bool" },
		{ Name: "Close", Count: 1, Result: "bool" },
		{ Name: "Send", Count: 2, Result: "std::size_t" },
		{ Name: "Receive", Count: 2, Result: "std::vector<char>" },
	].map(Request => ({
		Name: Request.Name + "SocketCallback",
		Fragments: ["kSocket" + Request.Name + "RequiredArgumentCount = " + Request.Count + ";", "kSocket" + Request.Name + "OptionalArgumentCount = 0;", "if (!pResultIsolate || LocalResultContext.IsEmpty()) {\n\t\t\t\t\treturn {};"],
		Order: ["v8::TryCatch SocketFailure(pIsolate);", "!ParseAsyncRequestExecutionMode(", "GetRuntimeFromCallbackInformation(CallbackInformation);", "if (!pRuntime || SocketFailure.HasCaught()", "auto Operation =", "auto ConvertResult =", "!RunAsyncRequest<" + Request.Result + ">("],
		Forbidden: ["ThrowError("],
	})),
	{
		Name: "ConnectSocketCallback",
		Fragments: ["kMinimumSocketPort = 1;", "kMaximumSocketPort = 65535;", "if (strHost.find('\\0') != std::string::npos)", "if (!bConnected || (SocketConnectionRecordOwner->m_hSocket == kInvalidNativeSocketHandle))", "if (!bConnectionRegistered)"],
		Order: ["!ParseRequiredExternalStringArgument(", "if (LocalContext.IsEmpty() || SocketFailure.HasCaught()", "if (LocalPortValue.IsEmpty() || SocketFailure.HasCaught()", "!GetIntegerFromValue(LocalContext, LocalPortValue, nPort)", "!RequireExternalPluginName(", "AllocateExternalHandle();", "std::make_shared<SocketConnectionRecord>();", "auto Operation =", "ConnectNativeSocket(*SocketConnectionRecordOwner, strHost, nPort);", "auto ConvertResult =", "v8::Integer::New(pResultIsolate, nSocketConnectionHandle);", "if (LocalConnectionHandle.IsEmpty() || SocketResultFailure.HasCaught()", "GetSocketConnections().emplace(nSocketConnectionHandle, SocketConnectionRecordOwner).second;", "if (!bConnectionRegistered)", "return LocalConnectionHandle;"],
		Forbidden: ["GetSocketConnections()[", "return v8::Integer::New("],
	},
	{
		Name: "CloseSocketCallback",
		Fragments: ["if ((itSocketConnection != umapSocketConnections.end()) && (itSocketConnection->second == SocketConnectionRecordOwner))"],
		Order: ["RequireSocketConnectionFromCallbackInformation(CallbackInformation);", "if (!SocketConnectionRecordOwner || SocketFailure.HasCaught()", "auto Operation =", "return CloseSocketConnection(*SocketConnectionRecordOwner);", "auto ConvertResult =", "v8::Boolean::New(pResultIsolate, bClosed);", "if (LocalConnectionClosed.IsEmpty() || SocketResultFailure.HasCaught()", "auto itSocketConnection = umapSocketConnections.find(nSocketConnectionHandle);", "if ((itSocketConnection !=", "umapSocketConnections.erase(itSocketConnection);", "return LocalConnectionClosed;"],
		Forbidden: ["return v8::Boolean::New("],
	},
	{
		Name: "SendSocketCallback",
		Fragments: ["if (!LocalByteValue->IsNumber())", "if (!std::isfinite(dblByteValue) || (std::floor(dblByteValue) != dblByteValue) || (dblByteValue < kMinimumSocketByteValue) || (dblByteValue > kMaximumSocketByteValue) || SocketFailure.HasCaught()", "if (strCurrentPluginName != SocketConnectionRecordOwner->m_strPluginName)", "// Same-direction IO is serialized on workers; callbacks run after this lock is released.", "if (vecDataBytes.empty()) {\n\t\t\t\t\treturn 0;"],
		Order: ["RequireSocketConnectionFromCallbackInformation(", "if (LocalContext.IsEmpty() || SocketFailure.HasCaught()", "if (LocalDataValue.IsEmpty() || SocketFailure.HasCaught()", "if (LocalDataArray.IsEmpty() || SocketFailure.HasCaught()", "if ((static_cast<std::size_t>(unDataArrayElementCount) > kMaximumSocketTransferByteCount) || SocketFailure.HasCaught()", "!LocalDataArray->Get(LocalContext, unByteIndex).ToLocal(&LocalByteValue) || LocalByteValue.IsEmpty() || SocketFailure.HasCaught()", "if (!LocalByteValue->IsNumber())", "if (LocalByteNumber.IsEmpty() || SocketFailure.HasCaught()", "vecDataBytes.push_back(static_cast<std::uint8_t>(dblByteValue));", "if (LocalArrayBufferView.IsEmpty() || SocketFailure.HasCaught()", "LocalArrayBufferView->ByteLength();", "LocalArrayBufferView->CopyContents(vecDataBytes.data(), unDataByteCount)", "if (LocalArrayBuffer.IsEmpty() || SocketFailure.HasCaught()", "if (!BackingStore || SocketFailure.HasCaught()", "BackingStore->ByteLength();", "if (!pSourceBytes || SocketFailure.HasCaught()", "std::memcpy(vecDataBytes.data(), pSourceBytes, unDataByteCount);", "!RequireExternalPluginName(CallbackInformation, strCurrentPluginName) || SocketFailure.HasCaught()", "if (strCurrentPluginName !=", "auto Operation = [SocketConnectionRecordOwner, vecDataBytes = std::move(vecDataBytes)]", "SocketConnectionOperation SocketOperation = *SocketConnectionRecordOwner;", "std::lock_guard<std::mutex> SendLock(SocketConnectionRecordOwner->m_SendMutex);", "if (vecDataBytes.empty())", "auto ConvertResult =", "return v8::Number::New(pResultIsolate, static_cast<double>(unSentByteCount));"],
		Forbidden: ["ByteTryCatch", "bByteValueRead"],
	},
	{
		Name: "ReceiveSocketCallback",
		Fragments: ["(nMaximumByteCount < kMinimumSocketReceiveByteCount) || (static_cast<std::size_t>(nMaximumByteCount) > kMaximumSocketTransferByteCount) || SocketFailure.HasCaught()", "// Same-direction IO is serialized on workers; callbacks run after this lock is released."],
		Order: ["RequireSocketConnectionFromCallbackInformation(", "if (LocalContext.IsEmpty() || SocketFailure.HasCaught()", "if (LocalMaximumByteCountValue.IsEmpty() || SocketFailure.HasCaught()", "!GetIntegerFromValue(LocalContext, LocalMaximumByteCountValue, nMaximumByteCount)", "auto Operation =", "SocketConnectionOperation SocketOperation = *SocketConnectionRecordOwner;", "std::lock_guard<std::mutex> ReceiveLock(SocketConnectionRecordOwner->m_ReceiveMutex);", "std::vector<char> vecReceivedBytes(unMaximumByteCount);", "return vecReceivedBytes;", "auto ConvertResult =", "return MakeFilesystemByteArrayValue(pResultIsolate, vecReceivedBytes.data(), vecReceivedBytes.size());"],
		Forbidden: ["return MakeString("],
	},
	{
		Name: "AcquireRedisClientFromCallbackInformation",
		Fragments: ["std::shared_ptr<sw::redis::Redis>", "!itRedisClient->second.m_pClient", "itRedisClient->second.m_strPluginName != strCurrentPluginName"],
		Order: ["if (RedisFailure.HasCaught()", "GetCurrentContext();", "if (LocalContext.IsEmpty() || RedisFailure.HasCaught()", "LocalRedisClientHandleValue = CallbackInformation[", "if (LocalRedisClientHandleValue.IsEmpty() || RedisFailure.HasCaught()", "!ParseExternalHandleFromValue(", "!RequireExternalPluginName(", "umapRedisClients.find(nRedisClientHandle);", "return itRedisClient->second.m_pClient;"],
		Forbidden: ["return nullptr;", "umapRedisClients["],
	},
	{
		Name: "ParseRedisRequestExecutionMode",
		Fragments: ["constexpr int kControlArgumentCount = 2;", "((nCallbackArgumentCount - 1) < nRequiredArgumentCount)", "((nArgumentCount - nRequiredValueArgumentCount) > nOptionalArgumentCount)", "LocalOptionsValue->IsArray()"],
		Order: ["if (RedisFailure.HasCaught()", "nCallbackArgumentCount < kControlArgumentCount", "LocalCallbackValue = CallbackInformation[", "if (LocalCallbackValue.IsEmpty() || !LocalCallbackValue->IsFunction() || RedisFailure.HasCaught()", "LocalOptionsValue = CallbackInformation[", "if (LocalOptionsValue.IsEmpty() || !LocalOptionsValue->IsObject()", "const int nRequiredValueArgumentCount = nRequiredArgumentCount - 1;", "if (LocalContext.IsEmpty() || RedisFailure.HasCaught()", "LocalOptionsValue.As<v8::Object>();", "if (LocalOptionsObject.IsEmpty() || RedisFailure.HasCaught()", "!ParseOptionalExternalBooleanProperty(", "LocalCallbackValue.As<v8::Function>();", "if (LocalCallbackFunction.IsEmpty() || RedisFailure.HasCaught()", "ExecutionModeOut.m_bBlocking = bBlocking;", "ExecutionModeOut.m_CallbackFunction = LocalCallbackFunction;"],
		Forbidden: ["nRequiredArgumentCount + 1", "nRequiredValueArgumentCount + nOptionalArgumentCount"],
	},
	{
		Name: "RunRedisRequest",
		Fragments: ["ExecutionMode.m_CallbackFunction.IsEmpty()", "auto* const pResult = std::any_cast<TResult>(&ResultValue);", "RequestResult.m_Value = Operation();"],
		Order: ["if (RedisFailure.HasCaught()", "!pRuntime->GetCurrentPluginName(pIsolate, strPluginName) || RedisFailure.HasCaught()", "auto Task =", "auto ConvertResult =", "std::any_cast<TResult>(&ResultValue);", "if (!pResult || ResultFailure.HasCaught()", "MaybeResultValue = Converter(", "if (!MaybeResultValue.ToLocal(&LocalResultValue) || LocalResultValue.IsEmpty() || ResultFailure.HasCaught()", "return LocalResultValue;", "if (ExecutionMode.m_bBlocking)", "pRuntime->RunBlockingRequest(ExecutionMode.m_CallbackFunction, Task, ConvertResult);", "if (!bRequestRan || RedisFailure.HasCaught()", "pRuntime->QueueAsyncRequest(ExecutionMode.m_CallbackFunction, Task, ConvertResult);", "if (!bRequestQueued || RedisFailure.HasCaught()"],
		Forbidden: ["return Converter("],
	},
	{
		Name: "ParseRedisCommandArguments",
		Fragments: ["constexpr bool kRedisCommandAllowEmptyPart = true;", "nCommandArgumentEndExclusive > CallbackInformation.Length()", "const std::uint32_t unRedisCommandPartCount = LocalRedisCommandPartsArray->Length();"],
		Order: ["if (RedisFailure.HasCaught()", "if (LocalContext.IsEmpty() || RedisFailure.HasCaught()", "nCommandArgumentEndExclusive < kRedisCommandRequiredArgumentCount", "LocalRedisCommandArgumentValue = CallbackInformation[", "if (LocalRedisCommandArgumentValue.IsEmpty() || RedisFailure.HasCaught()", "std::vector<std::string> vecRedisCommandParts {};", "LocalRedisCommandArgumentValue->IsArray()", "if (LocalRedisCommandPartsArray.IsEmpty() || RedisFailure.HasCaught()", "unRedisCommandPartCount = LocalRedisCommandPartsArray->Length();", "unRedisCommandPartIndex < unRedisCommandPartCount", "!LocalRedisCommandPartsArray->Get(", "LocalRedisCommandPartValue.IsEmpty() || RedisFailure.HasCaught()", "!ParseExternalStringFromValue(", "nRedisCommandArgumentIndex < nCommandArgumentEndExclusive", "if (LocalRedisCommandPartValue.IsEmpty() || RedisFailure.HasCaught()", "vecRedisCommandParts.empty() || vecRedisCommandParts.front().empty()", "vecRedisCommandPartsOut = std::move(vecRedisCommandParts);"],
		Forbidden: ["vecRedisCommandPartsOut.clear();", "vecRedisCommandPartsOut.push_back("],
	},
	{
		Name: "MakeRedisReplyValue",
		Fragments: ["case REDIS_REPLY_NIL:", "case REDIS_REPLY_INTEGER:", "case REDIS_REPLY_DOUBLE:", "case REDIS_REPLY_BOOL:", "case REDIS_REPLY_STRING:", "case REDIS_REPLY_STATUS:", "case REDIS_REPLY_BIGNUM:", "case REDIS_REPLY_VERB:", "std::string(pRedisReply->str, pRedisReply->len)", "if (LocalNullValue.IsEmpty() || RedisFailure.HasCaught()", "if (LocalIntegerValue.IsEmpty() || RedisFailure.HasCaught()", "if (LocalNumberValue.IsEmpty() || RedisFailure.HasCaught()", "if (LocalBooleanValue.IsEmpty() || RedisFailure.HasCaught()", "if (LocalStringValue.IsEmpty() || RedisFailure.HasCaught()"],
		Order: ["if (RedisFailure.HasCaught()", "if (!pRedisReply)", "switch (pRedisReply->type)", "case REDIS_REPLY_ERROR:", "RethrowV8InstallationFailure(pIsolate, RedisFailure, pszRedisErrorMessage);", "MakeExternalInt64Value(pIsolate, static_cast<std::int64_t>(pRedisReply->integer));", "pRedisReply->elements > kMaximumRedisReplyArrayLength", "v8::Array::New(pIsolate, static_cast<int>(pRedisReply->elements));", "if (LocalRedisReplyArray.IsEmpty() || RedisFailure.HasCaught()", "MakeRedisReplyValue(pIsolate, LocalContext, pRedisReplyElement);", "if (LocalRedisReplyElementValue.IsEmpty() || RedisFailure.HasCaught()", "LocalRedisReplyArray->CreateDataProperty(", "if (!bRedisReplyElementSet || RedisFailure.HasCaught()", "return LocalRedisReplyArray;", "MakeString(pIsolate, strRedisReplyText);"],
		Forbidden: ["LocalRedisReplyArray->Set(", "std::string(pRedisReply->str)", "return MakeString("],
	},
	{
		Name: "ParseExternalStringVectorFromValue",
		Fragments: ["if (LocalExternalStringValuesArray.IsEmpty() || ExternalFailure.HasCaught()", "LocalExternalStringValue.IsEmpty() || ExternalFailure.HasCaught()", "if (vecParsedExternalStringValues.empty())"],
		Order: ["if (ExternalFailure.HasCaught()", "std::vector<std::string> vecParsedExternalStringValues {};", "LocalExternalStringVectorSourceValue.As<v8::Array>();", "if (LocalExternalStringValuesArray.IsEmpty()", "const std::uint32_t unExternalStringValueCount = LocalExternalStringValuesArray->Length();", "unExternalStringValueIndex < unExternalStringValueCount", "!LocalExternalStringValuesArray->Get(", "!ParseExternalStringFromValue(pIsolate, LocalExternalStringValue,", "} else if (bAllowSingleExternalStringValue)", "!ParseExternalStringFromValue(pIsolate, LocalExternalStringVectorSourceValue,", "vecExternalStringValuesOut = std::move(vecParsedExternalStringValues);"],
		Forbidden: ["vecExternalStringValuesOut.clear();", "vecExternalStringValuesOut.push_back("],
	},
	{
		Name: "ParseExternalStringMapFromValue",
		Fragments: ["constexpr bool kAllowEmptyExternalStringMapEntryValues = true;", "if (LocalExternalStringMapSourceObject.IsEmpty() || ExternalFailure.HasCaught()", "LocalExternalStringMapPropertyNamesArray.IsEmpty() || ExternalFailure.HasCaught()", "LocalExternalStringMapPropertyName.IsEmpty() || ExternalFailure.HasCaught()", "LocalExternalStringMapPropertyValue.IsEmpty() || ExternalFailure.HasCaught()"],
		Order: ["if (ExternalFailure.HasCaught()", "IsValueNullish(LocalExternalStringMapSourceValue)", "LocalExternalStringMapSourceValue.As<v8::Object>();", "!LocalExternalStringMapSourceObject->GetOwnPropertyNames(", "const std::uint32_t unExternalStringMapPropertyCount =", "std::map<std::string, std::string> mapParsedExternalStringValues {};", "unExternalStringMapPropertyIndex < unExternalStringMapPropertyCount", "!LocalExternalStringMapPropertyNamesArray->Get(", "!LocalExternalStringMapSourceObject->Get(", "ValueToString(pIsolate, LocalExternalStringMapPropertyName);", "!bAllowEmptyExternalStringMapKeys && strExternalStringMapKey.empty()", "!ParseExternalStringFromValue(", "mapParsedExternalStringValues.emplace(", "mapExternalStringValuesOut = std::move(mapParsedExternalStringValues);"],
		Forbidden: ["->GetPropertyNames(", "mapExternalStringValuesOut.clear();", "mapExternalStringValuesOut.emplace("],
	},
	{
		Name: "ConnectRedisCallback",
		Fragments: ["std::make_shared<sw::redis::Redis>(strRedisURI)", "NewRedisClientRecord.m_strPluginName = strRedisClientPluginName;", "NewRedisClientRecord.m_pClient = pRedisClient;"],
		Order: ["if (RedisFailure.HasCaught()", "!ParseRedisRequestExecutionMode(", "!RequireExternalPluginName(", "!ParseRequiredExternalStringArgument(", "auto Operation =", "auto ConvertResult =", "if (!pRedisClient || RedisResultFailure.HasCaught()", "AllocateExternalHandle();", "RedisClientRecord NewRedisClientRecord {};", "v8::Integer::New(pResultIsolate, nRedisClientHandle);", "if (LocalRedisClientHandle.IsEmpty() || RedisResultFailure.HasCaught()", "GetRedisClients().emplace(nRedisClientHandle, std::move(NewRedisClientRecord)).second;", "if (!bClientRegistered)", "return LocalRedisClientHandle;", "if (LocalContext.IsEmpty() || RedisFailure.HasCaught()", "GetRuntimeFromCallbackInformation(", "!RunRedisRequest<std::shared_ptr<sw::redis::Redis>>("],
		Forbidden: ["GetRedisClients()["],
	},
	{
		Name: "CloseRedisCallback",
		Fragments: ["std::shared_ptr<RedisClientRecord> const RedisCloseRecordOwner = std::make_shared<RedisClientRecord>();", "itRedisClient->second.m_strPluginName == strRedisClientPluginName", "RedisCloseRecordOwner->m_pClient.reset();", "itClosingClient->second.m_pClient = std::move(RedisCloseRecordOwner->m_pClient);"],
		Order: ["if (RedisFailure.HasCaught()", "!ParseRedisRequestExecutionMode(", "if (LocalContext.IsEmpty() || RedisFailure.HasCaught()", "if (LocalRedisClientHandleValue.IsEmpty() || RedisFailure.HasCaught()", "!ParseExternalHandleFromValue(", "!RequireExternalPluginName(", "GetRuntimeFromCallbackInformation(", "auto itRedisClient = umapRedisClients.find(", "auto Operation =", "auto CompleteSubmission =", "auto itClosingClient = umapRedisClients.find(nRedisClientHandle);", "if (!bAccepted && RedisCloseRecordOwner->m_pClient)", "auto ConvertResult =", "if (bRedisClientClosed)", "RedisCloseRecordOwner->m_pClient = std::move(itRedisClient->second.m_pClient);", "RunRedisRequest<bool>(", "CompleteSubmission(bAccepted);", "if (!bAccepted || RedisFailure.HasCaught()", "CompleteSubmission(false);"],
		Forbidden: ["umapRedisClients["],
	},
	{
		Name: "PingRedisCallback",
		Fragments: ["constexpr bool kAllowEmptyRedisPingMessage = true;", "return bHasRedisPingMessage ? pRedisClient->ping(strRedisPingMessage) : pRedisClient->ping();"],
		Order: ["if (RedisFailure.HasCaught()", "!ParseRedisRequestExecutionMode(", "AcquireRedisClientFromCallbackInformation(", "if (!pRedisClient || RedisFailure.HasCaught()", "nRedisPingOptionsArgumentIndex > kRedisPingMessageArgumentIndex", "bool bHasRedisPingMessage = false;", "if (bHasRedisPingMessageArgument)", "if (LocalRedisPingMessageValue.IsEmpty() || RedisFailure.HasCaught()", "bHasRedisPingMessage = !IsValueNullish(LocalRedisPingMessageValue);", "!ParseOptionalExternalStringArgument(", "auto Operation =", "auto ConvertValue =", "MakeString(pResultIsolate, strRedisPingResponse);", "if (LocalContext.IsEmpty() || RedisFailure.HasCaught()", "GetRuntimeFromCallbackInformation(", "!RunRedisRequest<std::string>("],
		Forbidden: ["strRedisPingMessage.empty()"],
	},
	{
		Name: "ExecuteRedisCommandCallback",
		Fragments: ["nRedisCommandOptionalArgumentCount = RedisCommandCallbackInformation.Length() - (kRedisCommandRequiredArgumentCount + 1);", "std::shared_ptr<sw::redis::Redis> const pRedisClient", "nCommandArgumentEndExclusive = RedisCommandCallbackInformation.Length() - 2;"],
		Order: ["if (RedisFailure.HasCaught()", "!ParseRedisRequestExecutionMode(", "AcquireRedisClientFromCallbackInformation(", "!ParseRedisCommandArguments(", "auto Operation =", "pRedisClient->command(vecRedisCommandParts.begin(), vecRedisCommandParts.end());", "std::shared_ptr<redisReply> pRedisCommandReply = std::move(RedisCommandReply);", "auto ConvertResult =", "if (!pResultIsolate || LocalResultContext.IsEmpty())", "if (!pRedisCommandReply || RedisResultFailure.HasCaught()", "MakeRedisReplyValue(pResultIsolate, LocalResultContext, pRedisCommandReply.get());", "if (LocalRedisCommandReply.IsEmpty() || RedisResultFailure.HasCaught()", "return LocalRedisCommandReply;", "if (LocalContext.IsEmpty() || RedisFailure.HasCaught()", "GetRuntimeFromCallbackInformation(", "!RunRedisRequest<std::shared_ptr<redisReply>>("],
		Forbidden: ["v8::Number::New("],
	},
	{
		Name: "MakeRedisOptionalStringValue",
		Fragments: ["sw::redis::OptionalString const& OptionalRedisStringValue"],
		Order: ["if (!pIsolate || LocalContext.IsEmpty())", "return {};", "if (!OptionalRedisStringValue)", "return v8::Null(pIsolate);", "return MakeString(pIsolate, OptionalRedisStringValue.value());"],
		Forbidden: ["OptionalRedisStringValue.value().empty()", "v8::Undefined("],
	},
	{
		Name: "GetRedisValueCallback",
		Fragments: ["constexpr bool kAllowEmptyRedisKey = false;", "std::shared_ptr<sw::redis::Redis> const pRedisClient"],
		Order: ["if (RedisFailure.HasCaught()", "!ParseRedisRequestExecutionMode(", "AcquireRedisClientFromCallbackInformation(", "!ParseRequiredExternalStringArgument(", "auto Operation =", "pRedisClient->get(strRedisKey);", "if (LocalContext.IsEmpty() || RedisFailure.HasCaught()", "GetRuntimeFromCallbackInformation(", "!RunRedisRequest<sw::redis::OptionalString>(", "std::move(Operation), MakeRedisOptionalStringValue)"],
		Forbidden: ["OptionalRedisStringValue.value().empty()"],
	},
	{
		Name: "SetRedisValueCallback",
		Fragments: ["constexpr bool kAllowEmptyRedisKey = false;", "constexpr bool kAllowEmptyRedisValue = true;", "std::shared_ptr<sw::redis::Redis> const pRedisClient"],
		Order: ["if (RedisFailure.HasCaught()", "!ParseRedisRequestExecutionMode(", "AcquireRedisClientFromCallbackInformation(", "!ParseRequiredExternalStringArgument(RedisSetCallbackInformation, kRedisSetKeyArgumentIndex", "!ParseRequiredExternalStringArgument(RedisSetCallbackInformation, kRedisSetValueArgumentIndex", "auto Operation =", "pRedisClient->set(strRedisKey, strRedisValue);", "return true;", "auto ConvertResult =", "v8::Boolean::New(pResultIsolate, bRedisSetResult);", "if (LocalContext.IsEmpty() || RedisFailure.HasCaught()", "GetRuntimeFromCallbackInformation(", "!RunRedisRequest<bool>("],
		Forbidden: ["return false;"],
	},
	{
		Name: "DeleteRedisKeyCallback",
		Fragments: ["constexpr bool kAllowEmptyRedisKey = false;", "std::shared_ptr<sw::redis::Redis> const pRedisClient", "static_assert(std::numeric_limits<long long>::digits <= std::numeric_limits<std::int64_t>::digits"],
		Order: ["if (RedisFailure.HasCaught()", "!ParseRedisRequestExecutionMode(", "AcquireRedisClientFromCallbackInformation(", "!ParseRequiredExternalStringArgument(", "auto Operation =", "const long long nDeletedRedisKeyCount = pRedisClient->del(strRedisKey);", "return static_cast<std::int64_t>(nDeletedRedisKeyCount);", "auto ConvertResult =", "MakeExternalInt64Value(pResultIsolate, nDeletedRedisKeyCount);", "if (LocalDeletedRedisKeyCount.IsEmpty())", "return LocalDeletedRedisKeyCount;", "if (LocalContext.IsEmpty() || RedisFailure.HasCaught()", "GetRuntimeFromCallbackInformation(", "!RunRedisRequest<std::int64_t>("],
		Forbidden: ["v8::Number::New("],
	},
	{
		Name: "DoesRedisKeyExistCallback",
		Fragments: ["constexpr bool kAllowEmptyRedisKey = false;", "std::shared_ptr<sw::redis::Redis> const pRedisClient"],
		Order: ["if (RedisFailure.HasCaught()", "!ParseRedisRequestExecutionMode(", "AcquireRedisClientFromCallbackInformation(", "!ParseRequiredExternalStringArgument(", "auto Operation =", "return pRedisClient->exists(strRedisKey) > 0;", "auto ConvertResult =", "v8::Boolean::New(pResultIsolate, bRedisKeyExists);", "if (LocalContext.IsEmpty() || RedisFailure.HasCaught()", "GetRuntimeFromCallbackInformation(", "!RunRedisRequest<bool>("],
		Forbidden: ["pRedisClient->exists(strRedisKey) >= 0"],
	},
	{
		Name: "IncrementRedisValueCallback",
		Fragments: ["constexpr bool kAllowEmptyRedisKey = false;", "std::shared_ptr<sw::redis::Redis> const pRedisClient", "static_assert(std::numeric_limits<long long>::digits <= std::numeric_limits<std::int64_t>::digits"],
		Order: ["if (RedisFailure.HasCaught()", "!ParseRedisRequestExecutionMode(", "AcquireRedisClientFromCallbackInformation(", "!ParseRequiredExternalStringArgument(", "auto Operation =", "const long long nIncrementedRedisValue = pRedisClient->incr(strRedisKey);", "return static_cast<std::int64_t>(nIncrementedRedisValue);", "auto ConvertResult =", "MakeExternalInt64Value(pResultIsolate, nIncrementedRedisValue);", "if (LocalIncrementedRedisValue.IsEmpty())", "return LocalIncrementedRedisValue;", "if (LocalContext.IsEmpty() || RedisFailure.HasCaught()", "GetRuntimeFromCallbackInformation(", "!RunRedisRequest<std::int64_t>("],
		Forbidden: ["v8::Number::New("],
	},
	{
		Name: "ExpireRedisKeyCallback",
		Fragments: ["constexpr bool kAllowEmptyRedisKey = false;", "std::shared_ptr<sw::redis::Redis> const pRedisClient"],
		Order: ["if (RedisFailure.HasCaught()", "!ParseRedisRequestExecutionMode(", "AcquireRedisClientFromCallbackInformation(", "!ParseRequiredExternalStringArgument(", "LocalRedisExpirationSecondsValue = RedisExpireCallbackInformation[", "if (LocalRedisExpirationSecondsValue.IsEmpty() || RedisFailure.HasCaught()", "int nRedisExpirationSeconds = 0;", "!ParseExternalInt32FromValue(pIsolate, LocalRedisExpirationSecondsValue, kInvalidRedisExpirationSecondsErrorMessage, nRedisExpirationSeconds)", "auto Operation =", "pRedisClient->expire(strRedisKey, nRedisExpirationSeconds);", "auto ConvertResult =", "v8::Boolean::New(pResultIsolate, bRedisExpirationSet);", "if (LocalContext.IsEmpty() || RedisFailure.HasCaught()", "GetRuntimeFromCallbackInformation(", "!RunRedisRequest<bool>("],
		Forbidden: ["->IntegerValue("],
	},
	{
		Name: "GetRedisHashFieldCallback",
		Fragments: ["constexpr bool kAllowEmptyRedisKey = false;", "constexpr bool kAllowEmptyRedisHashField = false;", "std::shared_ptr<sw::redis::Redis> const pRedisClient"],
		Order: ["if (RedisFailure.HasCaught()", "!ParseRedisRequestExecutionMode(", "AcquireRedisClientFromCallbackInformation(", "!ParseRequiredExternalStringArgument(RedisHashGetCallbackInformation, kRedisHashGetKeyArgumentIndex", "!ParseRequiredExternalStringArgument(RedisHashGetCallbackInformation, kRedisHashGetFieldArgumentIndex", "auto Operation =", "pRedisClient->hget(strRedisKey, strRedisHashField);", "if (LocalContext.IsEmpty() || RedisFailure.HasCaught()", "GetRuntimeFromCallbackInformation(", "!RunRedisRequest<sw::redis::OptionalString>(", "std::move(Operation), MakeRedisOptionalStringValue)"],
		Forbidden: ["OptionalRedisStringValue.value().empty()"],
	},
	{
		Name: "SetRedisHashFieldCallback",
		Fragments: ["constexpr bool kAllowEmptyRedisKey = false;", "constexpr bool kAllowEmptyRedisHashField = false;", "constexpr bool kAllowEmptyRedisHashValue = true;", "std::shared_ptr<sw::redis::Redis> const pRedisClient", "static_assert(std::numeric_limits<long long>::digits <= std::numeric_limits<std::int64_t>::digits"],
		Order: ["if (RedisFailure.HasCaught()", "!ParseRedisRequestExecutionMode(", "AcquireRedisClientFromCallbackInformation(", "!ParseRequiredExternalStringArgument(RedisHashSetCallbackInformation, kRedisHashSetKeyArgumentIndex", "!ParseRequiredExternalStringArgument(RedisHashSetCallbackInformation, kRedisHashSetFieldArgumentIndex", "!ParseRequiredExternalStringArgument(RedisHashSetCallbackInformation, kRedisHashSetValueArgumentIndex", "auto Operation =", "const long long nAddedRedisHashFieldCount = pRedisClient->hset(strRedisKey, strRedisHashField, strRedisHashValue);", "return static_cast<std::int64_t>(nAddedRedisHashFieldCount);", "auto ConvertResult =", "return MakeExternalInt64Value(pResultIsolate, nAddedRedisHashFieldCount);", "if (LocalContext.IsEmpty() || RedisFailure.HasCaught()", "GetRuntimeFromCallbackInformation(", "!RunRedisRequest<std::int64_t>("],
		Forbidden: ["v8::Number::New("],
	},
	{
		Name: "GetRedisDatabaseSizeCallback",
		Fragments: ["std::shared_ptr<sw::redis::Redis> const pRedisClient", "static_assert(std::numeric_limits<long long>::digits <= std::numeric_limits<std::int64_t>::digits"],
		Order: ["if (RedisFailure.HasCaught()", "!ParseRedisRequestExecutionMode(", "AcquireRedisClientFromCallbackInformation(", "auto Operation =", "const long long nRedisDatabaseKeyCount = pRedisClient->dbsize();", "return static_cast<std::int64_t>(nRedisDatabaseKeyCount);", "auto ConvertResult =", "if (!pResultIsolate || LocalResultContext.IsEmpty())", "return MakeExternalInt64Value(pResultIsolate, nRedisDatabaseKeyCount);", "if (LocalContext.IsEmpty() || RedisFailure.HasCaught()", "GetRuntimeFromCallbackInformation(", "!RunRedisRequest<std::int64_t>("],
		Forbidden: ["v8::Number::New("],
	},
	{
		Name: "GetRedisKeysCallback",
		Fragments: ["constexpr bool kAllowEmptyRedisKeyPattern = false;", "std::shared_ptr<sw::redis::Redis> const pRedisClient"],
		Order: ["if (RedisFailure.HasCaught()", "!ParseRedisRequestExecutionMode(", "AcquireRedisClientFromCallbackInformation(", "!ParseRequiredExternalStringArgument(", "auto Operation =", "std::vector<std::string> vecRedisKeys {};", "pRedisClient->keys(strRedisKeyPattern, std::back_inserter(vecRedisKeys));", "return vecRedisKeys;", "auto ConvertResult =", "if (!pResultIsolate || LocalResultContext.IsEmpty())", "return MakeStringArray(pResultIsolate, LocalResultContext, vecRedisKeys);", "if (LocalContext.IsEmpty() || RedisFailure.HasCaught()", "GetRuntimeFromCallbackInformation(", "!RunRedisRequest<std::vector<std::string>>("],
		Forbidden: ["vecRedisKeys.front()"],
	},
	{
		Name: "GetRedisKeyTypeCallback",
		Fragments: ["constexpr bool kAllowEmptyRedisKey = false;", "std::shared_ptr<sw::redis::Redis> const pRedisClient"],
		Order: ["if (RedisFailure.HasCaught()", "!ParseRedisRequestExecutionMode(", "AcquireRedisClientFromCallbackInformation(", "!ParseRequiredExternalStringArgument(", "auto Operation =", "return pRedisClient->type(strRedisKey);", "auto ConvertResult =", "if (!pResultIsolate || LocalResultContext.IsEmpty())", "return MakeString(pResultIsolate, strRedisKeyType);", "if (LocalContext.IsEmpty() || RedisFailure.HasCaught()", "GetRuntimeFromCallbackInformation(", "!RunRedisRequest<std::string>("],
		Forbidden: ["ToUpper(", "ToLower("],
	},
	{
		Name: "MakeRedisInt64Value",
		Fragments: ["std::int64_t const& nValue"],
		Order: ["if (!pIsolate || LocalContext.IsEmpty())", "return {};", "return MakeExternalInt64Value(pIsolate, nValue);"],
		Forbidden: ["v8::Number::New(", "MakeExternalUInt64Value("],
	},
	{
		Name: "GetRedisKeyTTLCallback",
		Fragments: ["constexpr bool kAllowEmptyRedisKey = false;", "std::shared_ptr<sw::redis::Redis> const pRedisClient", "static_assert(std::numeric_limits<long long>::digits <= std::numeric_limits<std::int64_t>::digits"],
		Order: ["if (RedisFailure.HasCaught()", "!ParseRedisRequestExecutionMode(", "AcquireRedisClientFromCallbackInformation(", "!ParseRequiredExternalStringArgument(", "auto Operation =", "const long long nRemainingRedisKeyTTLSeconds = pRedisClient->ttl(strRedisKey);", "return static_cast<std::int64_t>(nRemainingRedisKeyTTLSeconds);", "if (LocalContext.IsEmpty() || RedisFailure.HasCaught()", "GetRuntimeFromCallbackInformation(", "!RunRedisRequest<std::int64_t>(", "std::move(Operation), MakeRedisInt64Value)"],
		Forbidden: ["v8::Number::New(", "static_cast<std::uint64_t>(nRemainingRedisKeyTTLSeconds)"],
	},
	{
		Name: "PersistRedisKeyCallback",
		Fragments: ["constexpr bool kAllowEmptyRedisKey = false;", "std::shared_ptr<sw::redis::Redis> const pRedisClient"],
		Order: ["if (RedisFailure.HasCaught()", "!ParseRedisRequestExecutionMode(", "AcquireRedisClientFromCallbackInformation(", "!ParseRequiredExternalStringArgument(", "auto Operation =", "return pRedisClient->persist(strRedisKey);", "auto ConvertResult =", "if (!pResultIsolate || LocalResultContext.IsEmpty())", "return v8::Boolean::New(pResultIsolate, bRedisExpirationRemoved);", "if (LocalContext.IsEmpty() || RedisFailure.HasCaught()", "GetRuntimeFromCallbackInformation(", "!RunRedisRequest<bool>("],
		Forbidden: ["v8::Integer::New("],
	},
	{
		Name: "DecrementRedisValueCallback",
		Fragments: ["constexpr bool kAllowEmptyRedisKey = false;", "std::shared_ptr<sw::redis::Redis> const pRedisClient", "static_assert(std::numeric_limits<long long>::digits <= std::numeric_limits<std::int64_t>::digits"],
		Order: ["if (RedisFailure.HasCaught()", "!ParseRedisRequestExecutionMode(", "AcquireRedisClientFromCallbackInformation(", "!ParseRequiredExternalStringArgument(", "auto Operation =", "const long long nDecrementedRedisValue = pRedisClient->decr(strRedisKey);", "return static_cast<std::int64_t>(nDecrementedRedisValue);", "if (LocalContext.IsEmpty() || RedisFailure.HasCaught()", "GetRuntimeFromCallbackInformation(", "!RunRedisRequest<std::int64_t>(", "std::move(Operation), MakeRedisInt64Value)"],
		Forbidden: ["v8::Number::New("],
	},
	{
		Name: "IncrementRedisValueByAmountCallback",
		Fragments: ["constexpr bool kAllowEmptyRedisKey = false;", "std::shared_ptr<sw::redis::Redis> const pRedisClient", "static_assert(std::numeric_limits<std::int64_t>::digits <= std::numeric_limits<long long>::digits", "static_assert(std::numeric_limits<long long>::digits <= std::numeric_limits<std::int64_t>::digits"],
		Order: ["if (RedisFailure.HasCaught()", "!ParseRedisRequestExecutionMode(", "if (LocalContext.IsEmpty() || RedisFailure.HasCaught()", "AcquireRedisClientFromCallbackInformation(", "!ParseRequiredExternalStringArgument(", "LocalRedisIncrementAmountValue = RedisIncrementByAmountCallbackInformation[", "if (LocalRedisIncrementAmountValue.IsEmpty() || RedisFailure.HasCaught()", "std::int64_t nRedisIncrementAmount = 0;", "!GetInt64Argument(pIsolate, LocalContext, LocalRedisIncrementAmountValue, kInvalidRedisIncrementAmountErrorMessage, nRedisIncrementAmount)", "auto Operation =", "pRedisClient->incrby(strRedisKey, static_cast<long long>(nRedisIncrementAmount));", "return static_cast<std::int64_t>(nIncrementedRedisValue);", "GetRuntimeFromCallbackInformation(", "!RunRedisRequest<std::int64_t>(", "std::move(Operation), MakeRedisInt64Value)"],
		Forbidden: ["v8::Number::New(", "->IntegerValue("],
	},
	{
		Name: "GetMultipleRedisValuesCallback",
		Fragments: ["constexpr std::size_t kMaximumRedisValueCount = static_cast<std::size_t>(std::numeric_limits<int>::max());", "constexpr bool kAllowSingleRedisKey = false;", "constexpr bool kAllowEmptyRedisKeyStrings = false;", "std::shared_ptr<sw::redis::Redis> const pRedisClient"],
		Order: ["if (RedisFailure.HasCaught()", "!ParseRedisRequestExecutionMode(", "if (LocalContext.IsEmpty() || RedisFailure.HasCaught()", "AcquireRedisClientFromCallbackInformation(", "LocalRedisKeysValue = RedisMultipleGetCallbackInformation[", "if (LocalRedisKeysValue.IsEmpty() || RedisFailure.HasCaught()", "!ParseExternalStringVectorFromValue(pIsolate, LocalContext, LocalRedisKeysValue, kInvalidRedisKeysErrorMessage, kAllowSingleRedisKey, kAllowEmptyRedisKeyStrings, vecRedisKeys)", "auto Operation =", "pRedisClient->mget(vecRedisKeys.begin(), vecRedisKeys.end(), std::back_inserter(vecOptionalRedisStringValues));", "for (auto& OptionalRedisStringValue : vecOptionalRedisStringValues)", "if (!OptionalRedisStringValue)", "vecRedisStringValues.emplace_back(false, std::string {});", "vecRedisStringValues.emplace_back(true, std::move(OptionalRedisStringValue.value()));", "return vecRedisStringValues;", "auto ConvertResult =", "if (RedisResultFailure.HasCaught()", "unRedisValueCount > kMaximumRedisValueCount", "v8::Array::New(pResultIsolate, static_cast<int>(unRedisValueCount));", "if (LocalRedisValuesArray.IsEmpty() || RedisResultFailure.HasCaught()", "unRedisValueIndex < unRedisValueCount", "if (!RedisStringValue.first)", "LocalRedisValue = v8::Null(pResultIsolate);", "LocalRedisValue = MakeString(pResultIsolate, RedisStringValue.second);", "if (LocalRedisValue.IsEmpty() || RedisResultFailure.HasCaught()", "LocalRedisValuesArray->CreateDataProperty(", "if (!bRedisValueSet || RedisResultFailure.HasCaught()", "return LocalRedisValuesArray;", "GetRuntimeFromCallbackInformation(", "!RunRedisRequest<std::vector<std::pair<bool, std::string>>>("],
		Forbidden: ["LocalRedisValuesArray->Set(", "RedisStringValue.second.empty()"],
	},
	{
		Name: "MakeRedisBooleanValue",
		Fragments: ["bool const& bValue"],
		Order: ["if (!pIsolate || LocalContext.IsEmpty())", "return {};", "return v8::Boolean::New(pIsolate, bValue);"],
		Forbidden: ["v8::Number::New(", "v8::Integer::New("],
	},
	{
		Name: "SetMultipleRedisValuesCallback",
		Fragments: ["constexpr bool kAllowEmptyRedisKeys = false;", "std::shared_ptr<sw::redis::Redis> const pRedisClient"],
		Order: ["if (RedisFailure.HasCaught()", "!ParseRedisRequestExecutionMode(", "if (LocalContext.IsEmpty() || RedisFailure.HasCaught()", "AcquireRedisClientFromCallbackInformation(", "LocalRedisValuesObjectValue = RedisMultipleSetCallbackInformation[", "if (LocalRedisValuesObjectValue.IsEmpty() || RedisFailure.HasCaught()", "std::map<std::string, std::string> mapRedisStringValues {};", "!ParseExternalStringMapFromValue(", "if (mapRedisStringValues.empty())", "auto Operation =", "pRedisClient->mset(mapRedisStringValues.begin(), mapRedisStringValues.end());", "return true;", "GetRuntimeFromCallbackInformation(", "!RunRedisRequest<bool>(", "std::move(Operation), MakeRedisBooleanValue)"],
		Forbidden: ["if (!pIsolate->HasPendingException())"],
	},
	{
		Name: "DeleteRedisHashFieldsCallback",
		Fragments: ["constexpr bool kAllowSingleRedisHashField = true;", "constexpr bool kAllowEmptyRedisHashFieldStrings = false;", "std::shared_ptr<sw::redis::Redis> const pRedisClient", "static_assert(std::numeric_limits<long long>::digits <= std::numeric_limits<std::int64_t>::digits"],
		Order: ["if (RedisFailure.HasCaught()", "!ParseRedisRequestExecutionMode(", "if (LocalContext.IsEmpty() || RedisFailure.HasCaught()", "AcquireRedisClientFromCallbackInformation(", "!ParseRequiredExternalStringArgument(", "if (LocalRedisHashFieldsValue.IsEmpty() || RedisFailure.HasCaught()", "kAllowSingleRedisHashField, kAllowEmptyRedisHashFieldStrings, vecRedisHashFields)", "auto Operation =", "pRedisClient->hdel(strRedisKey, vecRedisHashFields.begin(), vecRedisHashFields.end());", "return static_cast<std::int64_t>(nDeletedRedisHashFieldCount);", "GetRuntimeFromCallbackInformation(", "!RunRedisRequest<std::int64_t>(", "std::move(Operation), MakeRedisInt64Value)"],
		Forbidden: ["v8::Number::New("],
	},
	{
		Name: "DoesRedisHashFieldExistCallback",
		Fragments: ["constexpr bool kAllowEmptyRedisKey = false;", "constexpr bool kAllowEmptyRedisHashField = false;", "std::shared_ptr<sw::redis::Redis> const pRedisClient"],
		Order: ["if (RedisFailure.HasCaught()", "!ParseRedisRequestExecutionMode(", "AcquireRedisClientFromCallbackInformation(", "kAllowEmptyRedisKey, strRedisKey)", "kAllowEmptyRedisHashField, strRedisHashField)", "auto Operation =", "return pRedisClient->hexists(strRedisKey, strRedisHashField);", "if (LocalContext.IsEmpty() || RedisFailure.HasCaught()", "GetRuntimeFromCallbackInformation(", "!RunRedisRequest<bool>(", "std::move(Operation), MakeRedisBooleanValue)"],
		Forbidden: ["v8::Integer::New("],
	},
	{
		Name: "GetRedisHashFieldCountCallback",
		Fragments: ["constexpr bool kAllowEmptyRedisKey = false;", "std::shared_ptr<sw::redis::Redis> const pRedisClient", "static_assert(std::numeric_limits<long long>::digits <= std::numeric_limits<std::int64_t>::digits"],
		Order: ["if (RedisFailure.HasCaught()", "!ParseRedisRequestExecutionMode(", "AcquireRedisClientFromCallbackInformation(", "!ParseRequiredExternalStringArgument(", "auto Operation =", "const long long nRedisHashFieldCount = pRedisClient->hlen(strRedisKey);", "return static_cast<std::int64_t>(nRedisHashFieldCount);", "if (LocalContext.IsEmpty() || RedisFailure.HasCaught()", "GetRuntimeFromCallbackInformation(", "!RunRedisRequest<std::int64_t>(", "std::move(Operation), MakeRedisInt64Value)"],
		Forbidden: ["v8::Number::New("],
	},
	{
		Name: "GetAllRedisHashFieldsCallback",
		Fragments: ["constexpr bool kAllowEmptyRedisKey = false;", "std::shared_ptr<sw::redis::Redis> const pRedisClient", "[kRedisHashGetAllResultObjectErrorMessage, kInvalidRedisHashGetAllResultErrorMessage]"],
		Order: ["if (RedisFailure.HasCaught()", "!ParseRedisRequestExecutionMode(", "if (LocalContext.IsEmpty() || RedisFailure.HasCaught()", "AcquireRedisClientFromCallbackInformation(", "!ParseRequiredExternalStringArgument(", "auto Operation =", "pRedisClient->hgetall(strRedisKey, std::inserter(umapRedisHashFields, umapRedisHashFields.end()));", "return umapRedisHashFields;", "auto ConvertResult =", "if (RedisResultFailure.HasCaught()", "v8::Object::New(pResultIsolate);", "if (LocalRedisHashFieldsObject.IsEmpty() || RedisResultFailure.HasCaught()", "LocalNullPrototype = v8::Null(pResultIsolate);", "if (LocalNullPrototype.IsEmpty() || RedisResultFailure.HasCaught()", "SetPrototypeV2(LocalResultContext, LocalNullPrototype).FromMaybe(false);", "if (!bNullPrototypeSet || RedisResultFailure.HasCaught()", "for (auto itRedisHashField =", "MakeString(pResultIsolate, itRedisHashField->first);", "if (LocalRedisHashFieldName.IsEmpty() || RedisResultFailure.HasCaught()", "MakeString(pResultIsolate, itRedisHashField->second);", "if (LocalRedisHashFieldValue.IsEmpty() || RedisResultFailure.HasCaught()", "CreateDataProperty(LocalResultContext, LocalRedisHashFieldName, LocalRedisHashFieldValue).FromMaybe(false);", "if (!bRedisHashFieldSet || RedisResultFailure.HasCaught()", "return LocalRedisHashFieldsObject;", "GetRuntimeFromCallbackInformation(", "!RunRedisRequest<std::unordered_map<std::string, std::string>>("],
		Forbidden: ["LocalRedisHashFieldsObject->Set(", "v8::Undefined(pResultIsolate)", "if (!pResultIsolate->HasPendingException())"],
	},
	{
		Name: "PushRedisListValues",
		Fragments: ["constexpr bool kAllowEmptyRedisListKey = false;", "constexpr bool kAllowSingleRedisListValue = true;", "constexpr bool kAllowEmptyRedisListValueStrings = true;", "std::shared_ptr<sw::redis::Redis> const pRedisClient", "static_assert(std::numeric_limits<long long>::digits <= std::numeric_limits<std::int64_t>::digits"],
		Order: ["if (RedisFailure.HasCaught()", "!ParseRedisRequestExecutionMode(", "if (LocalContext.IsEmpty() || RedisFailure.HasCaught()", "AcquireRedisClientFromCallbackInformation(", "!ParseRequiredExternalStringArgument(", "if (LocalRedisListPushValuesValue.IsEmpty() || RedisFailure.HasCaught()", "kAllowSingleRedisListValue, kAllowEmptyRedisListValueStrings, vecRedisListValues)", "auto Operation =", "const long long nRedisListLength = bPushToRedisListLeft ? pRedisClient->lpush(strRedisKey, vecRedisListValues.begin(), vecRedisListValues.end()) : pRedisClient->rpush(strRedisKey, vecRedisListValues.begin(), vecRedisListValues.end());", "return static_cast<std::int64_t>(nRedisListLength);", "GetRuntimeFromCallbackInformation(", "!RunRedisRequest<std::int64_t>(", "std::move(Operation), MakeRedisInt64Value)"],
		Forbidden: ["v8::Number::New("],
	},
	{
		Name: "PushLeftRedisListCallback",
		Fragments: ["constexpr bool kPushToRedisListLeft = true;"],
		Order: ["PushRedisListValues(RedisLeftPushCallbackInformation, kPushToRedisListLeft);"],
		Forbidden: [],
	},
	{
		Name: "PushRightRedisListCallback",
		Fragments: ["constexpr bool kPushToRedisListLeft = false;"],
		Order: ["PushRedisListValues(RedisRightPushCallbackInformation, kPushToRedisListLeft);"],
		Forbidden: [],
	},
	{
		Name: "PopRedisListValue",
		Fragments: ["constexpr bool kAllowEmptyRedisListKey = false;", "std::shared_ptr<sw::redis::Redis> const pRedisClient"],
		Order: ["if (RedisFailure.HasCaught()", "!ParseRedisRequestExecutionMode(", "AcquireRedisClientFromCallbackInformation(", "!ParseRequiredExternalStringArgument(", "auto Operation =", "return bPopFromRedisListLeft ? pRedisClient->lpop(strRedisKey) : pRedisClient->rpop(strRedisKey);", "if (LocalContext.IsEmpty() || RedisFailure.HasCaught()", "GetRuntimeFromCallbackInformation(", "!RunRedisRequest<sw::redis::OptionalString>(", "std::move(Operation), MakeRedisOptionalStringValue)"],
		Forbidden: ["v8::Undefined("],
	},
	{
		Name: "PopLeftRedisListCallback",
		Fragments: ["constexpr bool kPopFromRedisListLeft = true;"],
		Order: ["PopRedisListValue(RedisLeftPopCallbackInformation, kPopFromRedisListLeft);"],
		Forbidden: [],
	},
	{
		Name: "PopRightRedisListCallback",
		Fragments: ["constexpr bool kPopFromRedisListLeft = false;"],
		Order: ["PopRedisListValue(RedisRightPopCallbackInformation, kPopFromRedisListLeft);"],
		Forbidden: [],
	},
	{
		Name: "GetRedisListRangeCallback",
		Fragments: ["constexpr bool kAllowEmptyRedisListKey = false;", "std::shared_ptr<sw::redis::Redis> const pRedisClient", "static_assert(std::numeric_limits<std::int64_t>::digits <= std::numeric_limits<long long>::digits"],
		Order: ["if (RedisFailure.HasCaught()", "!ParseRedisRequestExecutionMode(", "if (LocalContext.IsEmpty() || RedisFailure.HasCaught()", "AcquireRedisClientFromCallbackInformation(", "!ParseRequiredExternalStringArgument(", "if (LocalRedisListRangeStartValue.IsEmpty() || RedisFailure.HasCaught()", "!GetInt64Argument(pIsolate, LocalContext, LocalRedisListRangeStartValue, kInvalidRedisListRangeStartErrorMessage, nRedisListRangeStartIndex)", "if (LocalRedisListRangeStopValue.IsEmpty() || RedisFailure.HasCaught()", "!GetInt64Argument(pIsolate, LocalContext, LocalRedisListRangeStopValue, kInvalidRedisListRangeStopErrorMessage, nRedisListRangeStopIndex)", "auto Operation =", "pRedisClient->lrange(strRedisKey, static_cast<long long>(nRedisListRangeStartIndex), static_cast<long long>(nRedisListRangeStopIndex), std::back_inserter(vecRedisListValues));", "return vecRedisListValues;", "GetRuntimeFromCallbackInformation(", "!RunRedisRequest<std::vector<std::string>>(", "std::move(Operation), MakeStringArray)"],
		Forbidden: ["->IntegerValue(", "->NumberValue("],
	},
	{
		Name: "AddOrRemoveRedisSetMembers",
		Fragments: ["constexpr bool kAllowEmptyRedisSetKey = false;", "constexpr bool kAllowSingleRedisSetMember = true;", "constexpr bool kAllowEmptyRedisSetMemberStrings = true;", "std::shared_ptr<sw::redis::Redis> const pRedisClient", "static_assert(std::numeric_limits<long long>::digits <= std::numeric_limits<std::int64_t>::digits"],
		Order: ["if (RedisFailure.HasCaught()", "!ParseRedisRequestExecutionMode(", "if (LocalContext.IsEmpty() || RedisFailure.HasCaught()", "AcquireRedisClientFromCallbackInformation(", "!ParseRequiredExternalStringArgument(", "if (LocalRedisSetMembersValue.IsEmpty() || RedisFailure.HasCaught()", "kAllowSingleRedisSetMember, kAllowEmptyRedisSetMemberStrings, vecRedisSetMembers)", "auto Operation =", "const long long nChangedRedisSetMemberCount = bAddRedisSetMembers ? pRedisClient->sadd(strRedisKey, vecRedisSetMembers.begin(), vecRedisSetMembers.end()) : pRedisClient->srem(strRedisKey, vecRedisSetMembers.begin(), vecRedisSetMembers.end());", "return static_cast<std::int64_t>(nChangedRedisSetMemberCount);", "GetRuntimeFromCallbackInformation(", "!RunRedisRequest<std::int64_t>(", "std::move(Operation), MakeRedisInt64Value)"],
		Forbidden: ["v8::Number::New("],
	},
	{
		Name: "AddRedisSetMembersCallback",
		Fragments: ["constexpr bool kAddRedisSetMembers = true;"],
		Order: ["AddOrRemoveRedisSetMembers(RedisSetMemberAddCallbackInformation, kAddRedisSetMembers);"],
		Forbidden: [],
	},
	{
		Name: "RemoveRedisSetMembersCallback",
		Fragments: ["constexpr bool kAddRedisSetMembers = false;"],
		Order: ["AddOrRemoveRedisSetMembers(RedisSetMemberRemoveCallbackInformation, kAddRedisSetMembers);"],
		Forbidden: [],
	},
	{
		Name: "GetRedisSetMembersCallback",
		Fragments: ["constexpr bool kAllowEmptyRedisSetKey = false;", "std::shared_ptr<sw::redis::Redis> const pRedisClient"],
		Order: ["if (RedisFailure.HasCaught()", "!ParseRedisRequestExecutionMode(", "AcquireRedisClientFromCallbackInformation(", "!ParseRequiredExternalStringArgument(", "auto Operation =", "pRedisClient->smembers(strRedisKey, std::back_inserter(vecRedisSetMembers));", "return vecRedisSetMembers;", "if (LocalContext.IsEmpty() || RedisFailure.HasCaught()", "GetRuntimeFromCallbackInformation(", "!RunRedisRequest<std::vector<std::string>>(", "std::move(Operation), MakeStringArray)"],
		Forbidden: [],
	},
	{
		Name: "PublishRedisMessageCallback",
		Fragments: ["constexpr bool kAllowEmptyRedisChannel = false;", "constexpr bool kAllowEmptyRedisMessage = true;", "std::shared_ptr<sw::redis::Redis> const pRedisClient", "static_assert(std::numeric_limits<long long>::digits <= std::numeric_limits<std::int64_t>::digits"],
		Order: ["if (RedisFailure.HasCaught()", "!ParseRedisRequestExecutionMode(", "AcquireRedisClientFromCallbackInformation(", "!ParseRequiredExternalStringArgument(RedisPublishCallbackInformation, kRedisPublishChannelArgumentIndex, kInvalidRedisChannelErrorMessage, kAllowEmptyRedisChannel, strRedisChannel)", "!ParseRequiredExternalStringArgument(RedisPublishCallbackInformation, kRedisPublishMessageArgumentIndex, kInvalidRedisMessageErrorMessage, kAllowEmptyRedisMessage, strRedisMessage)", "auto Operation =", "const long long nRedisSubscriberCount = pRedisClient->publish(strRedisChannel, strRedisMessage);", "return static_cast<std::int64_t>(nRedisSubscriberCount);", "if (LocalContext.IsEmpty() || RedisFailure.HasCaught()", "GetRuntimeFromCallbackInformation(", "!RunRedisRequest<std::int64_t>(", "std::move(Operation), MakeRedisInt64Value)"],
		Forbidden: ["v8::Number::New("],
	},
	{
		Name: "ParseOptionalExternalStringMapProperty",
		Fragments: ["constexpr bool kAllowEmptyExternalStringMapKeys = true;", "if (!pIsolate || LocalExternalStringMapPropertyContext.IsEmpty() || LocalExternalStringMapPropertyOwnerObject.IsEmpty() || !pszExternalStringMapPropertyName || !pszExternalStringMapContainerErrorMessage || !pszExternalStringMapEntryErrorMessage)"],
		Order: ["if (ExternalStringMapFailure.HasCaught()", "if (LocalExternalStringMapPropertyName.IsEmpty() || ExternalStringMapFailure.HasCaught()", "LocalExternalStringMapPropertyOwnerObject->Get(LocalExternalStringMapPropertyContext, LocalExternalStringMapPropertyName).ToLocal(&LocalExternalStringMapPropertyValue)", "LocalExternalStringMapPropertyValue.IsEmpty() || ExternalStringMapFailure.HasCaught()", "if (IsValueNullish(LocalExternalStringMapPropertyValue)) {\n\t\t\t\treturn true;\n\t\t\t}", "!ParseExternalStringMapFromValue(pIsolate, LocalExternalStringMapPropertyContext, LocalExternalStringMapPropertyValue, pszExternalStringMapContainerErrorMessage, pszExternalStringMapEntryErrorMessage, kAllowEmptyExternalStringMapKeys, mapExternalStringValuesOut)", "\n\n\t\t\treturn true;\n\t\t} catch"],
		Forbidden: ["mapExternalStringValuesOut.clear()"],
	},
	{
		Name: "ParseOptionalHTTPRequestBodyProperty",
		Fragments: ["constexpr char const* const kHTTPRequestBodyPropertyName = \"Body\";", "if (!LocalHTTPRequestBodyValue->IsString() && !LocalHTTPRequestBodyValue->IsArrayBuffer() && !LocalHTTPRequestBodyValue->IsArrayBufferView())"],
		Order: ["if (HTTPFailure.HasCaught()", "if (LocalHTTPRequestBodyPropertyName.IsEmpty() || HTTPFailure.HasCaught()", "LocalHTTPRequestOptionsObject->Get(LocalHTTPRequestBodyContext, LocalHTTPRequestBodyPropertyName).ToLocal(&LocalHTTPRequestBodyValue)", "LocalHTTPRequestBodyValue.IsEmpty() || HTTPFailure.HasCaught()", "if (IsValueNullish(LocalHTTPRequestBodyValue)) {\n\t\t\t\treturn true;\n\t\t\t}", "if (!LocalHTTPRequestBodyValue->IsString()", "!GetFilesystemBytesFromValue(pIsolate, LocalHTTPRequestBodyValue, vecRequestBody)", "RequestOptionsOut.m_vecRequestBody = std::move(vecRequestBody);", "RequestOptionsOut.m_bHasRequestBody = true;", "\n\n\t\t\treturn true;\n\t\t} catch"],
		Forbidden: ["ValueToString("],
	},
	{
		Name: "ParseHTTPAuthenticationMode",
		Fragments: ["{ \"basic\", cpr::AuthMode::BASIC }", "{ \"digest\", cpr::AuthMode::DIGEST }", "{ \"ntlm\", cpr::AuthMode::NTLM }", "{ \"negotiate\", cpr::AuthMode::NEGOTIATE }", "{ \"any\", cpr::AuthMode::ANY }", "{ \"anysafe\", cpr::AuthMode::ANYSAFE }"],
		Order: ["if (!pIsolate)", "std::tolower(static_cast<unsigned char>(chAuthenticationModeCharacter))", "if (strHTTPAuthenticationMode != HTTPAuthenticationModeInformation.m_pszExternalName)", "AuthenticationModeOut = HTTPAuthenticationModeInformation.m_AuthenticationMode;", "return true;", "ThrowError(pIsolate, kInvalidHTTPAuthenticationModeErrorMessage);\n\n\t\treturn false;"],
		Forbidden: [],
	},
	{
		Name: "ParseOptionalHTTPAuthenticationProperty",
		Fragments: ["constexpr char const* const kDefaultHTTPAuthenticationMode = \"basic\";", "constexpr bool kAllowEmptyHTTPAuthenticationCredentialStrings = true;", "constexpr bool kAllowEmptyHTTPAuthenticationMode = false;", "if (!LocalHTTPAuthenticationValue->IsObject() || LocalHTTPAuthenticationValue->IsArray())"],
		Order: ["if (HTTPFailure.HasCaught()", "LocalHTTPRequestOptionsObject->Get(LocalHTTPAuthenticationContext, LocalHTTPAuthenticationPropertyName).ToLocal(&LocalHTTPAuthenticationValue)", "LocalHTTPAuthenticationValue.IsEmpty() || HTTPFailure.HasCaught()", "if (IsValueNullish(LocalHTTPAuthenticationValue)) {\n\t\t\t\treturn true;\n\t\t\t}", "if (!LocalHTTPAuthenticationValue->IsObject()", "if (LocalHTTPAuthenticationObject.IsEmpty() || HTTPFailure.HasCaught()", "if (LocalHTTPAuthenticationUsernamePropertyName.IsEmpty() || HTTPFailure.HasCaught()", "if (LocalHTTPAuthenticationPasswordPropertyName.IsEmpty() || HTTPFailure.HasCaught()", "LocalHTTPAuthenticationObject->Get(LocalHTTPAuthenticationContext, LocalHTTPAuthenticationUsernamePropertyName).ToLocal(&LocalHTTPAuthenticationUsernameValue)", "LocalHTTPAuthenticationUsernameValue.IsEmpty() || HTTPFailure.HasCaught()", "LocalHTTPAuthenticationObject->Get(LocalHTTPAuthenticationContext, LocalHTTPAuthenticationPasswordPropertyName).ToLocal(&LocalHTTPAuthenticationPasswordValue)", "LocalHTTPAuthenticationPasswordValue.IsEmpty() || HTTPFailure.HasCaught()", "!ParseExternalStringFromValue(pIsolate, LocalHTTPAuthenticationUsernameValue, kInvalidHTTPAuthenticationUsernameErrorMessage, kAllowEmptyHTTPAuthenticationCredentialStrings, strHTTPAuthenticationUsername)", "!ParseExternalStringFromValue(pIsolate, LocalHTTPAuthenticationPasswordValue, kInvalidHTTPAuthenticationPasswordErrorMessage, kAllowEmptyHTTPAuthenticationCredentialStrings, strHTTPAuthenticationPassword)", "!ParseOptionalExternalStringProperty(pIsolate, LocalHTTPAuthenticationContext, LocalHTTPAuthenticationObject, kHTTPAuthenticationModePropertyName, kInvalidHTTPAuthenticationModeErrorMessage, kAllowEmptyHTTPAuthenticationMode, strHTTPAuthenticationMode)", "!ParseHTTPAuthenticationMode(pIsolate, strHTTPAuthenticationMode, ParsedHTTPAuthenticationMode)", "RequestOptionsOut.m_strAuthenticationUsername = std::move(strHTTPAuthenticationUsername);", "RequestOptionsOut.m_strAuthenticationPassword = std::move(strHTTPAuthenticationPassword);", "RequestOptionsOut.m_AuthenticationMode = ParsedHTTPAuthenticationMode;", "RequestOptionsOut.m_bHasAuthentication = true;", "\n\n\t\t\treturn true;\n\t\t} catch"],
		Forbidden: ["ValueToString("],
	},
	{
		Name: "HTTPRequestOptions::HTTPRequestOptions",
		Fragments: ["kDefaultHTTPMethod = \"GET\";", "kDefaultRequestTimeoutMilliseconds = 0;", "kDefaultConnectionTimeoutMilliseconds = 0;", "kDefaultMaximumRedirectCount = 50;", "kDefaultVerifySSL = true;", "kDefaultFollowRedirects = true;", "kDefaultHasAuthentication = false;", "kDefaultHasRequestBody = false;", "kDefaultBlocking = false;", "kDefaultHTTPRequestAuthenticationMode = cpr::AuthMode::BASIC;"],
		Order: ["m_strMethod = kDefaultHTTPMethod;", "m_nRequestTimeoutMilliseconds = kDefaultRequestTimeoutMilliseconds;", "m_nConnectionTimeoutMilliseconds = kDefaultConnectionTimeoutMilliseconds;", "m_nMaximumRedirectCount = kDefaultMaximumRedirectCount;", "m_bVerifySSL = kDefaultVerifySSL;", "m_bFollowRedirects = kDefaultFollowRedirects;", "m_bHasAuthentication = kDefaultHasAuthentication;", "m_bHasRequestBody = kDefaultHasRequestBody;", "m_bBlocking = kDefaultBlocking;", "m_AuthenticationMode = kDefaultHTTPRequestAuthenticationMode;"],
		Forbidden: ["memset("],
	},
	{
		Name: "InitializeHTTPRequestOptions",
		Fragments: ["RequestOptionsOut = HTTPRequestOptions {};"],
		Order: ["RequestOptionsOut = HTTPRequestOptions {};", "if (pszHTTPMethod)", "RequestOptionsOut.m_strMethod = pszHTTPMethod;"],
		Forbidden: ["memset(", "constexpr ", "kDefaultHTTP"],
	},
	{
		Name: "IsHTTPMethodSupported",
		Fragments: ['return (strHTTPMethod == "GET") || (strHTTPMethod == "POST") || (strHTTPMethod == "PUT") || (strHTTPMethod == "PATCH") || (strHTTPMethod == "DELETE") || (strHTTPMethod == "HEAD") || (strHTTPMethod == "OPTIONS");'],
		Order: [],
		Forbidden: [],
	},
	{
		Name: "ParseHTTPRequestOptions",
		Fragments: [
			"kHTTPRequestArgumentIndex = 0;", "kHTTPRequestRequiredArgumentCount = 1;", "kMinimumHTTPRedirectCount = -1;",
			"kAllowEmptyHTTPRequestMethod = false;", "kAllowEmptyHTTPRequestURL = false;", "kAllowEmptyHTTPUserAgent = true;", "kAllowEmptyHTTPBearerToken = false;",
			...["Method", "URL", "UserAgent", "BearerToken", "Timeout", "ConnectionTimeout", "MaximumRedirects", "VerifySSL", "FollowRedirects", "Blocking", "Headers", "Parameters", "Cookies"].map(strName => '= "' + strName + '";'),
			"if ((ParsedHTTPRequestOptions.m_nRequestTimeoutMilliseconds < 0) || (ParsedHTTPRequestOptions.m_nConnectionTimeoutMilliseconds < 0))",
			"if (ParsedHTTPRequestOptions.m_nMaximumRedirectCount < kMinimumHTTPRedirectCount)",
			"if (ParsedHTTPRequestOptions.m_bHasAuthentication && !ParsedHTTPRequestOptions.m_strBearerToken.empty())",
			"if (HTTPFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, HTTPFailure, kInvalidHTTPRequestErrorMessage);\n\t\t\t\treturn false;\n\t\t\t}\n\n\t\t\tRequestOptionsOut = std::move(ParsedHTTPRequestOptions);",
			"} catch (std::exception const& Exception) {\n\t\t\tRethrowV8InstallationFailure(pIsolate, HTTPFailure, Exception.what());\n\t\t\treturn false;",
			"} catch (...) {\n\t\t\tRethrowV8InstallationFailure(pIsolate, HTTPFailure, kUnknownHTTPRequestOptionsFailureErrorMessage);\n\t\t\treturn false;",
		],
		Order: [
			"if (HTTPFailure.HasCaught()", "if (LocalHTTPRequestOptionsContext.IsEmpty() || HTTPFailure.HasCaught()", "if (HTTPRequestOptionsCallbackInformation.Length() < kHTTPRequestRequiredArgumentCount)", "if (LocalHTTPRequestValue.IsEmpty() || HTTPFailure.HasCaught()", "if (!LocalHTTPRequestValue->IsObject() || LocalHTTPRequestValue->IsArray())", "if (LocalHTTPRequestOptionsObject.IsEmpty() || HTTPFailure.HasCaught()", "HTTPRequestOptions ParsedHTTPRequestOptions {};", "InitializeHTTPRequestOptions(ParsedHTTPRequestOptions, pszFixedHTTPMethod);",
			"if (!pszFixedHTTPMethod)", "kAllowEmptyHTTPRequestMethod, ParsedHTTPRequestOptions.m_strMethod)", "if (LocalHTTPRequestMethodPropertyName.IsEmpty() || HTTPFailure.HasCaught()", "LocalHTTPRequestOptionsObject->Get(LocalHTTPRequestOptionsContext, LocalHTTPRequestMethodPropertyName).ToLocal(&LocalHTTPRequestMethodValue) || LocalHTTPRequestMethodValue.IsEmpty() || HTTPFailure.HasCaught()", "if (!IsValueNullish(LocalHTTPRequestMethodValue))",
			"kAllowEmptyHTTPRequestURL, ParsedHTTPRequestOptions.m_strURL)", "!ParseOptionalHTTPRequestBodyProperty(", "kAllowEmptyHTTPUserAgent, ParsedHTTPRequestOptions.m_strUserAgent)", "kAllowEmptyHTTPBearerToken, ParsedHTTPRequestOptions.m_strBearerToken)",
			"kInvalidHTTPRequestTimeoutErrorMessage, ParsedHTTPRequestOptions.m_nRequestTimeoutMilliseconds)", "kInvalidHTTPRequestConnectionTimeoutErrorMessage, ParsedHTTPRequestOptions.m_nConnectionTimeoutMilliseconds)", "kInvalidHTTPRequestMaximumRedirectsErrorMessage, ParsedHTTPRequestOptions.m_nMaximumRedirectCount)",
			"kInvalidHTTPRequestVerifySSLErrorMessage, ParsedHTTPRequestOptions.m_bVerifySSL)", "kInvalidHTTPRequestFollowRedirectsErrorMessage, ParsedHTTPRequestOptions.m_bFollowRedirects)", "kInvalidHTTPRequestBlockingErrorMessage, ParsedHTTPRequestOptions.m_bBlocking)",
			"kInvalidHTTPRequestHeaderEntryErrorMessage, ParsedHTTPRequestOptions.m_mapHeaders)", "kInvalidHTTPRequestParameterEntryErrorMessage, ParsedHTTPRequestOptions.m_mapParameters)", "kInvalidHTTPRequestCookieEntryErrorMessage, ParsedHTTPRequestOptions.m_mapCookies)", "!ParseOptionalHTTPAuthenticationProperty(",
			"if (ParsedHTTPRequestOptions.m_strURL.empty())", "std::toupper(static_cast<unsigned char>(chHTTPMethodCharacter))", "if (!IsHTTPMethodSupported(ParsedHTTPRequestOptions.m_strMethod))", "if ((ParsedHTTPRequestOptions.m_nRequestTimeoutMilliseconds < 0)", "if (ParsedHTTPRequestOptions.m_nMaximumRedirectCount < kMinimumHTTPRedirectCount)", "if (ParsedHTTPRequestOptions.m_bHasAuthentication", "RequestOptionsOut = std::move(ParsedHTTPRequestOptions);\n\n\t\t\treturn true;\n\t\t} catch",
		],
		Forbidden: ["ThrowError(", "ValueToString(", "RequestOptionsOut.clear(", "if (LocalHTTPRequestValue->IsObject() &&"],
	},
	{
		Name: "MakeCPRResponseObject",
		Fragments: [
			...["StatusCode", "Text", "Bytes", "URL", "Error", "ErrorCode", "Elapsed", "ElapsedMilliseconds", "RawHeader", "StatusLine", "Reason", "UploadedBytes", "DownloadedBytes", "RedirectCount", "PrimaryIP", "PrimaryPort", "OK", "Headers", "Cookies"].map(strName => '= "' + strName + '";'),
			"std::numeric_limits<cpr::cpr_off_t>::lowest() >= std::numeric_limits<std::int64_t>::lowest()", "std::numeric_limits<cpr::cpr_off_t>::max() <= std::numeric_limits<std::int64_t>::max()", "std::numeric_limits<long>::digits <= std::numeric_limits<std::int64_t>::digits", "std::numeric_limits<std::uint16_t>::max() <= std::numeric_limits<int>::max()",
			"constexpr int kMinimumHTTPResponseStatusCode = std::numeric_limits<int>::lowest();", "constexpr int kMaximumHTTPResponseStatusCode = std::numeric_limits<int>::max();",
			"if ((HTTPResponse.status_code < kMinimumHTTPResponseStatusCode) || (HTTPResponse.status_code > kMaximumHTTPResponseStatusCode))",
			"const bool bSuccessfulHTTPResponse = (HTTPResponse.status_code >= kMinimumSuccessfulStatusCode) && (HTTPResponse.status_code < kMaximumSuccessfulStatusCode) && (HTTPResponse.error.code == cpr::ErrorCode::OK);",
			"if (LocalPropertyValue.IsEmpty() || CPRResponseFailure.HasCaught()", "if (LocalPropertyName.IsEmpty() || CPRResponseFailure.HasCaught()", "if (!LocalCPRResponseObject->CreateDataProperty(LocalCPRResponseContext, LocalPropertyName, LocalPropertyValue).FromMaybe(false) || CPRResponseFailure.HasCaught()",
			"} catch (std::exception const& Exception) {\n\t\t\tRethrowV8InstallationFailure(pIsolate, CPRResponseFailure, Exception.what());\n\t\t\treturn {};",
			"} catch (...) {\n\t\t\tRethrowV8InstallationFailure(pIsolate, CPRResponseFailure, kUnknownCPRResponseFailureErrorMessage);\n\t\t\treturn {};",
		],
		Order: [
			"if (CPRResponseFailure.HasCaught()", "if (LocalCPRResponseObject.IsEmpty() || CPRResponseFailure.HasCaught()", "auto CreateResponseProperty =", "if (LocalPropertyValue.IsEmpty() || CPRResponseFailure.HasCaught()", "MakeString(pIsolate, pszPropertyName);", "if (LocalPropertyName.IsEmpty() || CPRResponseFailure.HasCaught()", "LocalCPRResponseObject->CreateDataProperty(",
			"MakeFilesystemByteArrayValue(pIsolate, HTTPResponse.text.data(), HTTPResponse.text.size())", "if (LocalCPRResponseBytes.IsEmpty() || CPRResponseFailure.HasCaught()", "MakeExternalInt64Value(pIsolate, static_cast<std::int64_t>(HTTPResponse.uploaded_bytes))", "if (LocalCPRResponseUploadedByteCount.IsEmpty() || CPRResponseFailure.HasCaught()", "MakeExternalInt64Value(pIsolate, static_cast<std::int64_t>(HTTPResponse.downloaded_bytes))", "if (LocalCPRResponseDownloadedByteCount.IsEmpty() || CPRResponseFailure.HasCaught()", "if ((HTTPResponse.status_code <", "const int nHTTPResponseStatusCode = static_cast<int>(HTTPResponse.status_code);", "MakeExternalInt64Value(pIsolate, static_cast<std::int64_t>(HTTPResponse.redirect_count))", "if (LocalHTTPResponseRedirectCount.IsEmpty() || CPRResponseFailure.HasCaught()", "HTTPResponse.url.str();",
			"!CreateResponseProperty(kStatusCodePropertyName, v8::Integer::New(pIsolate, nHTTPResponseStatusCode))", "!CreateResponseProperty(kTextPropertyName, MakeString(pIsolate, HTTPResponse.text))", "!CreateResponseProperty(kBytesPropertyName, LocalCPRResponseBytes)", "!CreateResponseProperty(kURLPropertyName, MakeString(pIsolate, strHTTPResponseURL))", "!CreateResponseProperty(kErrorPropertyName, MakeString(pIsolate, HTTPResponse.error.message))", "!CreateResponseProperty(kErrorCodePropertyName, v8::Integer::New(pIsolate, nCPRResponseErrorCode))", "!CreateResponseProperty(kElapsedPropertyName, v8::Number::New(pIsolate, dblHTTPResponseElapsedSeconds))", "!CreateResponseProperty(kElapsedMillisecondsPropertyName, v8::Number::New(pIsolate, dblHTTPResponseElapsedMilliseconds))", "!CreateResponseProperty(kRawHeaderPropertyName, MakeString(pIsolate, HTTPResponse.raw_header))", "!CreateResponseProperty(kStatusLinePropertyName, MakeString(pIsolate, HTTPResponse.status_line))", "!CreateResponseProperty(kReasonPropertyName, MakeString(pIsolate, HTTPResponse.reason))", "!CreateResponseProperty(kUploadedBytesPropertyName, LocalCPRResponseUploadedByteCount)", "!CreateResponseProperty(kDownloadedBytesPropertyName, LocalCPRResponseDownloadedByteCount)", "!CreateResponseProperty(kRedirectCountPropertyName, LocalHTTPResponseRedirectCount)", "!CreateResponseProperty(kPrimaryIPPropertyName, MakeString(pIsolate, HTTPResponse.primary_ip))", "!CreateResponseProperty(kPrimaryPortPropertyName, v8::Integer::New(pIsolate, nHTTPResponsePrimaryPort))", "!CreateResponseProperty(kOKPropertyName, v8::Boolean::New(pIsolate, bSuccessfulHTTPResponse))",
			"if (LocalCPRResponseHeaders.IsEmpty() || CPRResponseFailure.HasCaught()", "v8::Null(pIsolate);", "if (LocalCPRResponseNullPrototype.IsEmpty() || CPRResponseFailure.HasCaught()", "LocalCPRResponseHeaders->SetPrototypeV2(LocalCPRResponseContext, LocalCPRResponseNullPrototype)", "MakeString(pIsolate, itCPRResponseHeader->first)", "if (LocalCPRResponseHeaderName.IsEmpty() || CPRResponseFailure.HasCaught()", "MakeString(pIsolate, itCPRResponseHeader->second)", "if (LocalCPRResponseHeaderValue.IsEmpty() || CPRResponseFailure.HasCaught()", "LocalCPRResponseHeaders->CreateDataProperty(", "!CreateResponseProperty(kHeadersPropertyName, LocalCPRResponseHeaders)",
			"if (LocalCPRResponseCookies.IsEmpty() || CPRResponseFailure.HasCaught()", "LocalCPRResponseCookies->SetPrototypeV2(LocalCPRResponseContext, LocalCPRResponseNullPrototype)", "MakeString(pIsolate, itCPRResponseCookie->GetName())", "if (LocalCPRResponseCookieName.IsEmpty() || CPRResponseFailure.HasCaught()", "MakeString(pIsolate, itCPRResponseCookie->GetValue())", "if (LocalCPRResponseCookieValue.IsEmpty() || CPRResponseFailure.HasCaught()", "LocalCPRResponseCookies->CreateDataProperty(", "!CreateResponseProperty(kCookiesPropertyName, LocalCPRResponseCookies)", "\n\n\t\t\treturn LocalCPRResponseObject;\n\t\t} catch",
		],
		Forbidden: ["ThrowError(", "->Set(", "!SetValue(", "!SetString(", "!SetInteger(", "!SetNumber(", "!SetBoolean(", "BigInt::Uint64Value(", "BigInt::Int64Value("],
	},
	{
		Name: "QueueCPRRequest",
		Fragments: [
			"kOptionsArgumentIndex = 0;",
			"kCallbackArgumentIndex = 1;",
			"kRequiredArgumentCount = 2;",
			"if (!pRuntime)",
			"if (CallbackInformation.Length() != kRequiredArgumentCount)",
			"|| !LocalOptionsValue->IsObject() || LocalOptionsValue->IsArray()",
			"|| !LocalCallbackValue->IsFunction()",
			"auto Task = [ParsedHTTPRequestOptions = std::move(ParsedHTTPRequestOptions)]() -> AsyncRequestResult {",
			"RequestResult.m_Value = PerformHTTPRequest(ParsedHTTPRequestOptions);\n\n\t\t\t\treturn RequestResult;",
			"const bool bBlockingRequest = ParsedHTTPRequestOptions.m_bBlocking;",
			"if (!pResultIsolate || LocalResultContext.IsEmpty())",
			"if (!pHTTPResponse) {\n\t\t\t\t\t\tRethrowV8InstallationFailure(pResultIsolate, CPRResultFailure, kInvalidResponseErrorMessage);\n\t\t\t\t\t\treturn {};",
			"} catch (std::exception const& Exception) {\n\t\t\t\t\tRethrowV8InstallationFailure(pResultIsolate, CPRResultFailure, Exception.what());\n\t\t\t\t\treturn {};",
			"} catch (...) {\n\t\t\t\t\tRethrowV8InstallationFailure(pResultIsolate, CPRResultFailure, kInvalidResponseErrorMessage);\n\t\t\t\t\treturn {};",
		],
		Order: [
			"if (CPRFailure.HasCaught()",
			"GetRuntimeFromCallbackInformation(CallbackInformation);\n\t\t\tif (CPRFailure.HasCaught()",
			"if (!pRuntime)",
			"if (CallbackInformation.Length() != kRequiredArgumentCount)",
			"if (LocalOptionsValue.IsEmpty() || CPRFailure.HasCaught()",
			"if (LocalCallbackValue.IsEmpty() || CPRFailure.HasCaught()",
			"!ParseHTTPRequestOptions(CallbackInformation, pszFixedHTTPMethod, ParsedHTTPRequestOptions) || CPRFailure.HasCaught()",
			"if (LocalCallbackFunction.IsEmpty() || CPRFailure.HasCaught()",
			"const bool bBlockingRequest",
			"auto Task =",
			"RequestResult.m_Value = PerformHTTPRequest(ParsedHTTPRequestOptions);",
			"auto ConvertResult =",
			"if (!pResultIsolate || LocalResultContext.IsEmpty())",
			"if (CPRResultFailure.HasCaught()",
			"std::any_cast<cpr::Response>(&ResultValue);",
			"if (!pHTTPResponse)",
			"MakeCPRResponseObject(pResultIsolate, LocalResultContext, *pHTTPResponse);",
			"if (LocalResponseObject.IsEmpty() || CPRResultFailure.HasCaught()",
			"\n\n\t\t\t\t\treturn LocalResponseObject;\n\t\t\t\t} catch",
			"if (bBlockingRequest)",
			"!pRuntime->RunBlockingRequest(LocalCallbackFunction, std::move(Task), ConvertResult) || CPRFailure.HasCaught()",
			"!pRuntime->QueueAsyncRequest(LocalCallbackFunction, std::move(Task), ConvertResult) || CPRFailure.HasCaught()",
		],
		Forbidden: [
			"ThrowError(",
			"V8Runtime* const pRuntime,",
			"auto Task = [&",
		],
	},
	{
		Name: "PerformCPRRequestCallback",
		Fragments: [
			"constexpr char const* const kNoFixedHTTPMethod = nullptr;",
		],
		Order: [
			"if (!pIsolate)",
			"QueueCPRRequest(pIsolate, CPRRequestCallbackInformation, kNoFixedHTTPMethod);",
		],
		Forbidden: [
			"GetRuntimeFromCallbackInformation(",
		],
	},
	{
		Name: "PerformFixedMethodCPRRequest",
		Fragments: [
			"if (!pIsolate || !pszHTTPMethod)",
		],
		Order: [
			"FixedMethodCPRRequestCallbackInformation.GetIsolate();",
			"if (!pIsolate || !pszHTTPMethod)",
			"QueueCPRRequest(pIsolate, FixedMethodCPRRequestCallbackInformation, pszHTTPMethod);",
		],
		Forbidden: [
			"GetRuntimeFromCallbackInformation(",
		],
	},
	{
		Name: "InstallPathConstants",
		Fragments: [
			"if (!pIsolate || LocalPathConstantsContext.IsEmpty() || LocalPathModuleObject.IsEmpty())",
			"if (!InstallPathConstant(\"GAME_ROOT\", PathGameRoot)) {\n\t\t\t\treturn false;\n\t\t\t}",
			"if (!InstallPathConstant(\"ADDON_ROOT\", PathGameRoot / \"addons\")) {\n\t\t\t\treturn false;\n\t\t\t}",
			"if (!InstallPathConstant(\"DATA_ROOT\", PathDataRoot)) {\n\t\t\t\treturn false;\n\t\t\t}",
			"if (!InstallPathConstant(\"PLUGIN_ROOT\", RuntimePathsInformation.GetPluginRootPath())) {\n\t\t\t\treturn false;\n\t\t\t}",
			"if (!InstallPathConstant(\"EXTENSION_ROOT\", RuntimePathsInformation.GetExtensionRootPath())) {\n\t\t\t\treturn false;\n\t\t\t}",
			"if (!InstallPathConstant(\"PACKAGE_ROOT\", PathPackageRoot)) {\n\t\t\t\treturn false;\n\t\t\t}",
			"if (!InstallPathConstant(\"BASE_ROOT\", PathAddonRoot)) {\n\t\t\t\treturn false;\n\t\t\t}",
			"if (!InstallPathConstant(\"UPDATE_ROOT\", PathUpdateRoot)) {\n\t\t\t\treturn false;\n\t\t\t}",
			"if (!InstallPathConstant(\"UPDATE_DATA_ROOT\", PathUpdateRoot / \"addons\" / \"sourcejs\" / \"data\")) {\n\t\t\t\treturn false;\n\t\t\t}",
			"if (!InstallPathConstant(\"UPDATE_SOURCE_DATA_ROOT\", PathUpdateRoot / \"addons\" / \"sourcejs\" / \"data\" / \"sourcejs\")) {\n\t\t\t\treturn false;\n\t\t\t}",
			"if (!InstallPathConstant(\"DOCS_ROOT\", PathDocumentationRoot)) {\n\t\t\t\treturn false;\n\t\t\t}",
			"if (!InstallPathConstant(\"SOURCE_DOCS_ROOT\", PathDocumentationRoot / \"sourcejs\")) {\n\t\t\t\treturn false;\n\t\t\t}",
			"if (!InstallPathConstant(\"PLUGIN_DOCS_ROOT\", PathDocumentationRoot / \"plugins\")) {\n\t\t\t\treturn false;\n\t\t\t}",
			"if (!InstallPathConstant(\"CUSTOM_PACKAGE_DOCS_ROOT\", PathDocumentationRoot / \"custom\")) {\n\t\t\t\treturn false;\n\t\t\t}",
			"if (!InstallPathConstant(\"SOURCE_PACKAGE_ROOT\", PathPackageRoot / \"sourcejs\")) {\n\t\t\t\treturn false;\n\t\t\t}",
			"if (!InstallPathConstant(\"CUSTOM_PACKAGE_ROOT\", PathPackageRoot / \"custom\")) {\n\t\t\t\treturn false;\n\t\t\t}",
			"if (!InstallPathConstant(\"SITE_PACKAGE_ROOT\", PathPackageRoot / \"site-packages\")) {\n\t\t\t\treturn false;\n\t\t\t}",
			"if (!InstallPathConstant(\"CONFIG_ROOT\", PathConfigurationRoot)) {\n\t\t\t\treturn false;\n\t\t\t}",
			"if (!InstallPathConstant(\"LOG_ROOT\", PathLogRoot)) {\n\t\t\t\treturn false;\n\t\t\t}",
			"if (!InstallPathConstant(\"TRANSLATION_ROOT\", PathResourceRoot / \"translations\")) {\n\t\t\t\treturn false;\n\t\t\t}",
			"if (!InstallPathConstant(\"LANGUAGE_FILE\", PathDataRoot / \"languages.ini\")) {\n\t\t\t\treturn false;\n\t\t\t}",
			"if (!InstallPathConstant(\"TRANSLATION_CORE_ROOT\", PathResourceRoot / \"translations\" / \"_core\")) {\n\t\t\t\treturn false;\n\t\t\t}",
			"if (!InstallPathConstant(\"TRANSLATION_CORE_FILE\", PathResourceRoot / \"translations\" / \"_core\" / \"translations_strings.ini\")) {\n\t\t\t\treturn false;\n\t\t\t}",
			"if (!InstallPathConstant(\"EVENT_ROOT\", PathResourceRoot / \"events\")) {\n\t\t\t\treturn false;\n\t\t\t}",
			"if (!InstallPathConstant(\"SOUND_ROOT\", PathGameRoot / \"sound\" / \"sourcejs\")) {\n\t\t\t\treturn false;\n\t\t\t}",
			"if (!InstallPathConstant(\"SOURCE_DATA_ROOT\", PathDataRoot / \"sourcejs\")) {\n\t\t\t\treturn false;\n\t\t\t}",
			"if (!InstallPathConstant(\"CUSTOM_DATA_ROOT\", PathDataRoot / \"custom\")) {\n\t\t\t\treturn false;\n\t\t\t}",
			"if (!InstallPathConstant(\"PLUGIN_DATA_ROOT\", PathDataRoot / \"plugins\")) {\n\t\t\t\treturn false;\n\t\t\t}",
			"if (!InstallPathConstant(\"AUTH_CONFIG_ROOT\", PathAuthenticationConfigurationRoot)) {\n\t\t\t\treturn false;\n\t\t\t}",
			"if (!InstallPathConstant(\"BACKEND_ROOT\", PathPackageRoot / \"sourcejs\" / \"auth\" / \"backends\")) {\n\t\t\t\treturn false;\n\t\t\t}",
			"if (!InstallPathConstant(\"BACKEND_CONFIG_FILE\", PathAuthenticationConfigurationRoot / \"permissions.ini\")) {\n\t\t\t\treturn false;\n\t\t\t}",
			"if (!InstallPathConstant(\"AUTH_PLAYERS_FILE\", PathAuthenticationConfigurationRoot / \"players.json\")) {\n\t\t\t\treturn false;\n\t\t\t}",
			"if (!InstallPathConstant(\"AUTH_PARENTS_FILE\", PathAuthenticationConfigurationRoot / \"parents.json\")) {\n\t\t\t\treturn false;\n\t\t\t}",
			"if (!InstallPathConstant(\"AUTH_SIMPLE_FILE\", PathAuthenticationConfigurationRoot / \"simple.txt\")) {\n\t\t\t\treturn false;\n\t\t\t}",
			"if (!InstallPathConstant(\"AUTH_SQL_FILE\", PathAuthenticationConfigurationRoot / \"permissions.sqlite3\")) {\n\t\t\t\treturn false;\n\t\t\t}",
			"} catch (std::exception const& Exception) {\n\t\t\tRethrowV8InstallationFailure(pIsolate, PathConstantsFailure, Exception.what());\n\t\t\treturn false;",
			"} catch (...) {\n\t\t\tRethrowV8InstallationFailure(pIsolate, PathConstantsFailure, kPathConstantsFailureErrorMessage);\n\t\t\treturn false;",
		],
		Order: [
			"if (PathConstantsFailure.HasCaught()",
			"RuntimePathsInformation.GetGameRootPath();",
			"RuntimePathsInformation.GetAddonRootPath();",
			"RuntimePathsInformation.GetPackageRootPath();",
			"RuntimePathsInformation.GetDataPath();",
			"PathGameRoot / \"cfg\" / \"sourcejs\";",
			"PathGameRoot / \"logs\" / \"sourcejs\";",
			"PathAddonRoot / \"docs\";",
			"PathGameRoot / \"resource\" / \"sourcejs\";",
			"PathConfigurationRoot / \"auth\";",
			"PathAddonRoot / \"update\";",
			"auto InstallPathConstant =",
			"MakeString(pIsolate, EncodePathAsUTF8(PathValue));",
			"if (LocalPathValue.IsEmpty() || PathConstantsFailure.HasCaught()",
			"MakeString(pIsolate, pszPropertyName);",
			"if (LocalPropertyName.IsEmpty() || PathConstantsFailure.HasCaught()",
			"LocalPathModuleObject->CreateDataProperty(LocalPathConstantsContext, LocalPropertyName, LocalPathValue).FromMaybe(false) || PathConstantsFailure.HasCaught()",
			"InstallPathConstant(\"GAME_ROOT\", PathGameRoot)",
			"InstallPathConstant(\"ADDON_ROOT\", PathGameRoot / \"addons\")",
			"InstallPathConstant(\"DATA_ROOT\", PathDataRoot)",
			"InstallPathConstant(\"PLUGIN_ROOT\", RuntimePathsInformation.GetPluginRootPath())",
			"InstallPathConstant(\"EXTENSION_ROOT\", RuntimePathsInformation.GetExtensionRootPath())",
			"InstallPathConstant(\"PACKAGE_ROOT\", PathPackageRoot)",
			"InstallPathConstant(\"BASE_ROOT\", PathAddonRoot)",
			"InstallPathConstant(\"UPDATE_ROOT\", PathUpdateRoot)",
			"InstallPathConstant(\"UPDATE_DATA_ROOT\", PathUpdateRoot / \"addons\" / \"sourcejs\" / \"data\")",
			"InstallPathConstant(\"UPDATE_SOURCE_DATA_ROOT\", PathUpdateRoot / \"addons\" / \"sourcejs\" / \"data\" / \"sourcejs\")",
			"InstallPathConstant(\"DOCS_ROOT\", PathDocumentationRoot)",
			"InstallPathConstant(\"SOURCE_DOCS_ROOT\", PathDocumentationRoot / \"sourcejs\")",
			"InstallPathConstant(\"PLUGIN_DOCS_ROOT\", PathDocumentationRoot / \"plugins\")",
			"InstallPathConstant(\"CUSTOM_PACKAGE_DOCS_ROOT\", PathDocumentationRoot / \"custom\")",
			"InstallPathConstant(\"SOURCE_PACKAGE_ROOT\", PathPackageRoot / \"sourcejs\")",
			"InstallPathConstant(\"CUSTOM_PACKAGE_ROOT\", PathPackageRoot / \"custom\")",
			"InstallPathConstant(\"SITE_PACKAGE_ROOT\", PathPackageRoot / \"site-packages\")",
			"InstallPathConstant(\"CONFIG_ROOT\", PathConfigurationRoot)",
			"InstallPathConstant(\"LOG_ROOT\", PathLogRoot)",
			"InstallPathConstant(\"TRANSLATION_ROOT\", PathResourceRoot / \"translations\")",
			"InstallPathConstant(\"LANGUAGE_FILE\", PathDataRoot / \"languages.ini\")",
			"InstallPathConstant(\"TRANSLATION_CORE_ROOT\", PathResourceRoot / \"translations\" / \"_core\")",
			"InstallPathConstant(\"TRANSLATION_CORE_FILE\", PathResourceRoot / \"translations\" / \"_core\" / \"translations_strings.ini\")",
			"InstallPathConstant(\"EVENT_ROOT\", PathResourceRoot / \"events\")",
			"InstallPathConstant(\"SOUND_ROOT\", PathGameRoot / \"sound\" / \"sourcejs\")",
			"InstallPathConstant(\"SOURCE_DATA_ROOT\", PathDataRoot / \"sourcejs\")",
			"InstallPathConstant(\"CUSTOM_DATA_ROOT\", PathDataRoot / \"custom\")",
			"InstallPathConstant(\"PLUGIN_DATA_ROOT\", PathDataRoot / \"plugins\")",
			"InstallPathConstant(\"AUTH_CONFIG_ROOT\", PathAuthenticationConfigurationRoot)",
			"InstallPathConstant(\"BACKEND_ROOT\", PathPackageRoot / \"sourcejs\" / \"auth\" / \"backends\")",
			"InstallPathConstant(\"BACKEND_CONFIG_FILE\", PathAuthenticationConfigurationRoot / \"permissions.ini\")",
			"InstallPathConstant(\"AUTH_PLAYERS_FILE\", PathAuthenticationConfigurationRoot / \"players.json\")",
			"InstallPathConstant(\"AUTH_PARENTS_FILE\", PathAuthenticationConfigurationRoot / \"parents.json\")",
			"InstallPathConstant(\"AUTH_SIMPLE_FILE\", PathAuthenticationConfigurationRoot / \"simple.txt\")",
			"InstallPathConstant(\"AUTH_SQL_FILE\", PathAuthenticationConfigurationRoot / \"permissions.sqlite3\")",
			"\n\n\t\t\treturn true;\n\t\t} catch",
		],
		Forbidden: [
			"ThrowError(",
			"->Set(",
			"SetString(",
		],
	},
	...[
		{ Method: "Get", Value: "GET" },
		{ Method: "Post", Value: "POST" },
		{ Method: "Put", Value: "PUT" },
		{ Method: "Patch", Value: "PATCH" },
		{ Method: "Delete", Value: "DELETE" },
		{ Method: "Head", Value: "HEAD" },
		{ Method: "Options", Value: "OPTIONS" },
	].map(HTTPRequest => ({
		Name: "PerformCPR" + HTTPRequest.Method + "RequestCallback",
		Fragments: ['constexpr char const* const kHTTP' + HTTPRequest.Method + 'Method = "' + HTTPRequest.Value + '";'],
		Order: ["PerformFixedMethodCPRRequest(", "kHTTP" + HTTPRequest.Method + "Method);"],
		Forbidden: ["GetRuntimeFromCallbackInformation(", "PerformHTTPRequest("],
	})),
];

let g_unRejectedMutationCount = 0;

function GetDefinition(strSource, strName) {
	const strReturnTypePattern = (strName === "HTTPRequestOptions::HTTPRequestOptions") ? "" : "(?:static )?(?:void|bool|std::shared_ptr<(?:SOCISessionRecord|SocketConnectionRecord|sw::redis::Redis)>|v8::(?:Maybe)?Local<v8::(?:Object|Value)>) ";
	const vecDefinitionMatch = new RegExp("^(\\t{1,2})" + strReturnTypePattern + strName + "\\([^\\n]*\\)(?: noexcept)? \\{", "m").exec(strSource);
	g_Assert(vecDefinitionMatch, "Missing native boundary definition: " + strName);

	const ClosingBoundaryPattern = new RegExp("^" + vecDefinitionMatch[1] + "\\}$", "gm");
	ClosingBoundaryPattern.lastIndex = vecDefinitionMatch.index + vecDefinitionMatch[0].length;
	const vecClosingBoundaryMatch = ClosingBoundaryPattern.exec(strSource);
	g_Assert(vecClosingBoundaryMatch && (vecClosingBoundaryMatch.index > vecDefinitionMatch.index));

	const strDefinition = strSource.slice(vecDefinitionMatch.index, vecClosingBoundaryMatch.index + vecClosingBoundaryMatch[0].length);
	if (vecDefinitionMatch[1].length === 2) {
		return strDefinition.split("\n").map((strLine) => strLine.startsWith("\t") ? strLine.slice(1) : strLine).join("\n");
	}

	return strDefinition;
}

function CheckOrder(strDefinition, vecFragments) {
	let nPreviousIndex = -1;
	for (const strFragment of vecFragments) {
		const nIndex = strDefinition.indexOf(strFragment);
		g_Assert(nIndex >= 0, "Missing ordered fragment: " + strFragment);
		g_Assert(nIndex > nPreviousIndex, "Unexpected fragment order: " + strFragment);
		nPreviousIndex = nIndex;
	}
}

function GetFailureBranches(strDefinition, strFailure) {
	return [...strDefinition.matchAll(new RegExp("^\\t+if \\([^\\n]*" + strFailure + "\\.HasCaught\\(\\)[^\\n]*\\) \\{\\n\\t+(RethrowV8InstallationFailure\\([^\\n]+\\);)\\n\\t+return(?: [^\\n;]+)?;", "gm"))];
}

function GetCatchFragments(Boundary) {
	const strIsolate = Boundary.Isolate || "pIsolate";
	const strIndentation = "\t".repeat((Boundary.Indent ?? 2) + 1);
	const strErrorMessage = Boundary.ErrorMessage || "kFailureErrorMessage";
	const strStandardException = "std::exception const&" + (Boundary.StandardException ? " " + Boundary.StandardException : "");
	const strStandardErrorMessage = Boundary.StandardErrorMessage || strErrorMessage;

	return [
		"} catch (" + strStandardException + ") {\n" + strIndentation + "RethrowV8InstallationFailure(" + strIsolate + ", " + Boundary.Failure + ", " + strStandardErrorMessage + ");",
		"} catch (...) {\n" + strIndentation + "RethrowV8InstallationFailure(" + strIsolate + ", " + Boundary.Failure + ", " + strErrorMessage + ");",
	];
}

function CheckContracts(strSource, strTargetName = null) {
	for (const Boundary of g_vecBoundaries) {
		if ((strTargetName !== null) && (Boundary.Name !== strTargetName)) {
			continue;
		}

		const strDefinition = GetDefinition(strSource, Boundary.Name);
		const strIsolate = Boundary.Isolate || "pIsolate";
		const strIndentation = "\t".repeat(Boundary.Indent ?? 2);
		g_Assert(strDefinition.includes("v8::TryCatch " + Boundary.Failure + "(" + strIsolate + ");\n" + strIndentation + "try {"));

		for (const strCatch of GetCatchFragments(Boundary)) {
			g_Assert(strDefinition.includes(strCatch));
		}

		g_Assert.doesNotMatch(strDefinition, /ThrowError\(|noexcept/);
		g_Assert.equal(GetFailureBranches(strDefinition, Boundary.Failure).length, Boundary.Guards, "Missing immediate propagation: " + Boundary.Name);

		for (const strGuard of [Boundary.Failure + ".HasCaught()", strIsolate + "->IsExecutionTerminating()", strIsolate + "->HasPendingException()"]) {
			g_Assert.equal(strDefinition.split(strGuard).length - 1, Boundary.Guards);
		}

		if (Boundary.Result !== undefined) {
			g_Assert(strDefinition.endsWith("\n\n\t\treturn " + Boundary.Result + ";\n\t}"));
		}
	}

	for (const Check of g_vecChecks) {
		if ((strTargetName !== null) && (Check.Name !== strTargetName)) {
			continue;
		}

		const strDefinition = GetDefinition(strSource, Check.Name);

		for (const strFragment of Check.Fragments) {
			g_Assert(strDefinition.includes(strFragment), Check.Name + ": " + strFragment);
		}

		CheckOrder(strDefinition, Check.Order);

		for (const strForbidden of Check.Forbidden) {
			g_Assert(!strDefinition.includes(strForbidden), Check.Name + ": forbidden " + strForbidden);
		}
	}
}

function RejectMutation(strName, strOld, strNew, unTargetOccurrence = 0) {
	const bCoveredTarget = g_vecBoundaries.some((Boundary) => Boundary.Name === strName) || g_vecChecks.some((Check) => Check.Name === strName);
	g_Assert(bCoveredTarget, "Mutation target has no native contract: " + strName);

	const strDefinition = GetDefinition(g_strSource, strName);
	g_Assert(strDefinition.includes(strOld), "Missing mutation anchor: " + strName + ": " + strOld);

	let unOccurrence = 0;
	const strChanged = strDefinition.replaceAll(strOld, () => (unOccurrence++ === unTargetOccurrence) ? strNew : strOld);
	g_Assert.notEqual(strChanged, strDefinition);

	// The baseline checks every definition; this mutation changes only this checked body.
	g_Assert.throws(() => CheckContracts(strChanged, strName), g_Assert.AssertionError, strName + ": " + strOld);
	++g_unRejectedMutationCount;
}

// Minimal parser inputs, not standalone native-execution fixtures.
const g_strDefinitionProbe = "\tvoid Probe() {\n\t}";
g_Assert.equal(GetDefinition(g_strDefinitionProbe + "\n\tvoid Later() {\n\t}", "Probe"), g_strDefinitionProbe);
g_Assert.equal(GetDefinition(g_strDefinitionProbe.replaceAll("\t", "\t\t"), "Probe"), g_strDefinitionProbe);
g_Assert.throws(() => GetDefinition(g_strDefinitionProbe, "Missing"), g_Assert.AssertionError);
g_Assert.throws(() => GetDefinition("\tvoid Probe() {\n", "Probe"), g_Assert.AssertionError);

const g_strConstructorProbe = "\tHTTPRequestOptions::HTTPRequestOptions(void) {\n\t}";
g_Assert.equal(GetDefinition(g_strConstructorProbe, "HTTPRequestOptions::HTTPRequestOptions"), g_strConstructorProbe);
g_Assert.equal(GetDefinition(g_strConstructorProbe.replaceAll("\t", "\t\t"), "HTTPRequestOptions::HTTPRequestOptions"), g_strConstructorProbe);
g_Assert.throws(() => GetDefinition(g_strConstructorProbe.replace("HTTPRequestOptions::HTTPRequestOptions", "Probe"), "Probe"), g_Assert.AssertionError);
g_Assert.throws(() => GetDefinition("\tHTTPRequestOptions::HTTPRequestOptions(void) {\n", "HTTPRequestOptions::HTTPRequestOptions"), g_Assert.AssertionError);

const g_strMaybeLocalDefinitionProbe = "\tv8::MaybeLocal<v8::Value> Probe() {\n\t}";
g_Assert.equal(GetDefinition(g_strMaybeLocalDefinitionProbe, "Probe"), g_strMaybeLocalDefinitionProbe);
g_Assert.equal(GetDefinition(g_strMaybeLocalDefinitionProbe.replaceAll("\t", "\t\t"), "Probe"), g_strMaybeLocalDefinitionProbe);

CheckContracts(g_strSource);

for (const Boundary of g_vecBoundaries) {
	const strIsolate = Boundary.Isolate || "pIsolate";

	for (const strPart of ["v8::TryCatch " + Boundary.Failure + "(" + strIsolate + ");", ...GetCatchFragments(Boundary)]) {
		RejectMutation(Boundary.Name, strPart, "");
	}

	for (const strGuard of [Boundary.Failure + ".HasCaught()", strIsolate + "->IsExecutionTerminating()", strIsolate + "->HasPendingException()"]) {
		for (let unOccurrence = 0; unOccurrence < Boundary.Guards; ++unOccurrence) {
			RejectMutation(Boundary.Name, strGuard, "false", unOccurrence);
		}
	}

	const strDefinition = GetDefinition(g_strSource, Boundary.Name);

	for (const vecMatch of GetFailureBranches(strDefinition, Boundary.Failure)) {
		const unOccurrence = strDefinition.slice(0, vecMatch.index).split(vecMatch[1]).length - 1;
		RejectMutation(Boundary.Name, vecMatch[1], "", unOccurrence);
	}
}

for (const Check of g_vecChecks) {
	for (const strFragment of Check.Fragments) {
		RejectMutation(Check.Name, strFragment, "");
	}

	for (const strFragment of Check.Order) {
		RejectMutation(Check.Name, strFragment, "");
	}
}

RejectMutation("GetAutodocModuleNamesCallback", "->CreateDataProperty(", "->Set(");
RejectMutation("InstallPluginRecordValue", "->CreateDataProperty(", "->Set(");
RejectMutation("ListPluginsCallback", "->CreateDataProperty(", "->Set(");
RejectMutation("MakePluginRecordObject", "!InstallPluginRecordValue(", "!SetValue(");
RejectMutation("GetPluginRecordsCallback", "->CreateDataProperty(", "->Set(");
RejectMutation("ListExtensionsCallback", "->CreateDataProperty(", "->Set(");
RejectMutation("ParseExtensionStringArgument", "->IsString()", "->IsNumber()");
RejectMutation("RequireExternalPluginName", "!pRuntime->GetCurrentPluginName(pIsolate, strPluginName)", "strPluginName.empty() || !pRuntime->GetCurrentPluginName(pIsolate, strPluginName)");
RejectMutation("ParseExternalHandleFromValue", "nExternalHandle <= 0", "nExternalHandle < 0");
RejectMutation("ParseRequiredExternalStringArgument", "!bAllowEmptyExternalString && strExternalString.empty()", "strExternalString.empty()");
RejectMutation("ParsePluginSelectorArgument", "->IsUint32()", "->IsNumber()");
RejectMutation("UnloadPluginCallback", "plugins.UnloadPlugin(PluginSelector)", "plugins.UnloadPlugin(strPluginSelector)");
RejectMutation("ReloadPluginCallback", "plugins.ReloadPlugin(PluginSelector)", "plugins.ReloadPlugin(strPluginSelector)");
RejectMutation("DisablePluginCallback", "plugins.DisablePlugin(PluginSelector)", "plugins.DisablePlugin(strPluginSelector)");
RejectMutation("EnablePluginCallback", "plugins.EnablePlugin(PluginSelector)", "plugins.EnablePlugin(strPluginSelector)");
RejectMutation("MakePluginRecordObject", "unZeroBasedPluginIndex + 1", "unZeroBasedPluginIndex");
RejectMutation("MakePluginRecordObject", "EncodePathAsUTF8(PluginRecordInformation.m_PathDirectory)", "PluginRecordInformation.m_PathDirectory.string()");
RejectMutation("MakePluginRecordObject", "EncodePathAsUTF8(PluginRecordInformation.m_PathEntry)", "PluginRecordInformation.m_PathEntry.string()");
RejectMutation("ParseOptionalExternalStringArgument", "strExternalStringOut.clear();", "", 1);
RejectMutation("ParseOptionalExternalStringProperty", "if (IsValueNullish(LocalExternalStringPropertyValue)) {\n\t\t\t\treturn true;", "if (IsValueNullish(LocalExternalStringPropertyValue)) {\n\t\t\t\tstrExternalStringOut.clear();\n\t\t\t\treturn true;");
RejectMutation("ParseOptionalExternalBooleanProperty", "->IsBoolean()", "->IsNumber()");
RejectMutation("ParseExternalInt32FromValue", "std::floor(dblExternalInt32Value) != dblExternalInt32Value", "false");
RejectMutation("ParseExternalInt32FromValue", "dblExternalInt32Value > static_cast<double>(std::numeric_limits<int>::max())", "false");
RejectMutation("ParseOptionalExternalInt32Property", "pszInvalidExternalInt32ValueErrorMessage, nExternalInt32);", "pszInvalidExternalInt32ValueErrorMessage, nExternalInt32Out);");
RejectMutation("MakeExternalInt64Value", "v8::BigInt::New(", "v8::Number::New(");
RejectMutation("SetSOCIParameterFromValue", "strNullSOCIParameterValue, soci::i_null", "strNullSOCIParameterValue, soci::i_ok");
RejectMutation("SetSOCIParameterFromValue", "!GetInt64Argument(", "!GetDoubleArgument(");
RejectMutation("ParseSOCIParametersFromValue", "->GetOwnPropertyNames(", "->GetPropertyNames(");
RejectMutation("ParseSOCIParametersFromValue", "std::move(vecSOCIParameters)", "std::move(vecSOCIParametersOut)", 1);

RejectMutation("ParseAsyncRequestExecutionMode", "kCallbackArgumentCount + kOptionsArgumentCount", "kCallbackArgumentCount");
RejectMutation("ParseAsyncRequestExecutionMode", "LocalOptionsValue->IsArray()", "false");
RejectMutation("ParseAsyncRequestExecutionMode", "ExecutionModeOut.m_CallbackFunction = LocalCallbackFunction;", "ExecutionModeOut.m_CallbackFunction = {};");
RejectMutation("RunAsyncRequest", "if (ExecutionMode.m_bBlocking)", "if (false)");
RejectMutation("RunAsyncRequest", "!pRuntime->GetCurrentPluginName(pIsolate, strPluginName)", "false");
RejectMutation("RunAsyncRequest", "if (!MaybeResultValue.ToLocal(&LocalResultValue)", "if (false");
RejectMutation("RequireSOCISessionRecordFromCallbackInformation", "itSOCISession->second->m_strPluginName != strCurrentPluginName", "false");
RejectMutation("MakeSOCIQueryValue", "v8::BigInt::New(", "v8::Number::New(");
RejectMutation("MakeSOCIQueryValue", "v8::BigInt::NewFromUnsigned(", "v8::Number::New(");
RejectMutation("MakeSOCIRowObject", "->CreateDataProperty(", "->Set(");
RejectMutation("MakeSOCIRowObject", "MakeString(pIsolate, SOCIColumn.m_strName)", "MakeString(pIsolate, SOCIColumn.m_strName.c_str())");

RejectMutation("RegisterRequiredSOCIBackends", "std::call_once(s_SOCIBackendRegistration, RegisterSOCIBackends);", "RegisterSOCIBackends();");
RejectMutation("RegisterRequiredSOCIBackends", "static std::once_flag s_SOCIBackendRegistration {};", "static std::once_flag s_SOCIBackendRegistration;");
RejectMutation("ConnectSOCICallback", "GetSOCISessions().emplace(nSOCISessionHandle, NewSOCISessionRecord).second", "(GetSOCISessions()[nSOCISessionHandle] = NewSOCISessionRecord, true)");
RejectMutation("CloseSOCICallback", "itSOCISession->second->m_strPluginName == strCurrentPluginName", "true");
RejectMutation("CloseSOCICallback", "itResultSession->second == SOCISessionRecordOwner", "true");
RejectMutation("QuerySOCICallback", "vecSOCIRows.size() > kMaximumSOCIRowCount", "false");
RejectMutation("QuerySOCICallback", "->CreateDataProperty(", "->Set(");

RejectMutation("GetSOCIBackendNameCallback", "MakeString(pResultIsolate, strSOCIBackendName)", "MakeString(pResultIsolate, strSOCIBackendName.c_str())");
RejectMutation("GetSOCILastInsertIDCallback", "long long nSOCILastInsertID = 0;", "int nSOCILastInsertID = 0;");
RejectMutation("GetSOCINextSequenceValueCallback", "kSOCINextSequenceValueAllowEmptyName = false;", "kSOCINextSequenceValueAllowEmptyName = true;");
RejectMutation("BeginSOCICallback", "m_pSession->begin();", "m_pSession->commit();");
RejectMutation("CommitSOCICallback", "m_pSession->commit();", "m_pSession->rollback();");
RejectMutation("RollbackSOCICallback", "m_pSession->rollback();", "m_pSession->commit();");
RejectMutation("ReconnectSOCICallback", "m_pSession->reconnect();", "m_pSession->rollback();");
RejectMutation("IsSOCIConnectedCallback", "return SOCISessionRecordOwner->m_pSession->is_connected();", "return true;");
RejectMutation("RequireSocketConnectionFromCallbackInformation", "itSocketConnection->second->m_strPluginName != strCurrentPluginName", "false");
RejectMutation("ConnectSocketCallback", "GetSocketConnections().emplace(nSocketConnectionHandle, SocketConnectionRecordOwner).second", "(GetSocketConnections()[nSocketConnectionHandle] = SocketConnectionRecordOwner, true)");
RejectMutation("CloseSocketCallback", "itSocketConnection->second == SocketConnectionRecordOwner", "true");
RejectMutation("SendSocketCallback", "dblByteValue > kMaximumSocketByteValue", "false");
RejectMutation("ReceiveSocketCallback", "static_cast<std::size_t>(nMaximumByteCount) > kMaximumSocketTransferByteCount", "false");

RejectMutation("AcquireRedisClientFromCallbackInformation", "itRedisClient->second.m_strPluginName != strCurrentPluginName", "false");
RejectMutation("ParseRedisRequestExecutionMode", "LocalOptionsValue->IsArray()", "false");
RejectMutation("ParseRedisRequestExecutionMode", "ExecutionModeOut.m_CallbackFunction = LocalCallbackFunction;", "ExecutionModeOut.m_CallbackFunction = {};");
RejectMutation("RunRedisRequest", "if (ExecutionMode.m_bBlocking)", "if (false)");
RejectMutation("RunRedisRequest", "!pRuntime->GetCurrentPluginName(pIsolate, strPluginName)", "false");
RejectMutation("RunRedisRequest", "if (!MaybeResultValue.ToLocal(&LocalResultValue)", "if (false");
RejectMutation("ParseRedisCommandArguments", "vecRedisCommandPartsOut = std::move(vecRedisCommandParts);", "vecRedisCommandParts = std::move(vecRedisCommandPartsOut);");
RejectMutation("MakeRedisReplyValue", "->CreateDataProperty(", "->Set(");
RejectMutation("MakeRedisReplyValue", "pRedisReply->elements > kMaximumRedisReplyArrayLength", "false");
RejectMutation("MakeRedisReplyValue", "MakeExternalInt64Value(pIsolate, static_cast<std::int64_t>(pRedisReply->integer))", "v8::Number::New(pIsolate, pRedisReply->integer)");
RejectMutation("MakeRedisReplyValue", "std::string(pRedisReply->str, pRedisReply->len)", "std::string(pRedisReply->str)");

RejectMutation("ParseExternalStringVectorFromValue", "vecExternalStringValuesOut = std::move(vecParsedExternalStringValues);", "vecParsedExternalStringValues = std::move(vecExternalStringValuesOut);");
RejectMutation("ParseExternalStringMapFromValue", "->GetOwnPropertyNames(", "->GetPropertyNames(");
RejectMutation("ParseExternalStringMapFromValue", "mapExternalStringValuesOut = std::move(mapParsedExternalStringValues);", "mapParsedExternalStringValues = std::move(mapExternalStringValuesOut);");
RejectMutation("ConnectRedisCallback", "GetRedisClients().emplace(nRedisClientHandle, std::move(NewRedisClientRecord)).second", "(GetRedisClients()[nRedisClientHandle] = std::move(NewRedisClientRecord), true)");
RejectMutation("CloseRedisCallback", "itRedisClient->second.m_strPluginName == strRedisClientPluginName", "true");
RejectMutation("CloseRedisCallback", "if (!bAccepted && RedisCloseRecordOwner->m_pClient)", "if (false)");
RejectMutation("PingRedisCallback", "bHasRedisPingMessage = !IsValueNullish(LocalRedisPingMessageValue);", "bHasRedisPingMessage = !strRedisPingMessage.empty();");
RejectMutation("ExecuteRedisCommandCallback", "if (!pResultIsolate || LocalResultContext.IsEmpty())", "if (false)");
RejectMutation("ExecuteRedisCommandCallback", "pRedisCommandReply.get()", "nullptr");
RejectMutation("MakeRedisOptionalStringValue", "if (!pIsolate || LocalContext.IsEmpty())", "if (false)");
RejectMutation("MakeRedisOptionalStringValue", "return v8::Null(pIsolate);", "return v8::Undefined(pIsolate);");
RejectMutation("MakeRedisOptionalStringValue", "OptionalRedisStringValue.value()", "std::string()");
RejectMutation("GetRedisValueCallback", "std::move(Operation), MakeRedisOptionalStringValue)", "std::move(Operation), MakeString)");
RejectMutation("SetRedisValueCallback", "constexpr bool kAllowEmptyRedisValue = true;", "constexpr bool kAllowEmptyRedisValue = false;");
RejectMutation("DeleteRedisKeyCallback", "MakeExternalInt64Value(pResultIsolate, nDeletedRedisKeyCount)", "v8::Number::New(pResultIsolate, nDeletedRedisKeyCount)");
RejectMutation("DoesRedisKeyExistCallback", "pRedisClient->exists(strRedisKey) > 0", "pRedisClient->exists(strRedisKey) >= 0");
RejectMutation("IncrementRedisValueCallback", "MakeExternalInt64Value(pResultIsolate, nIncrementedRedisValue)", "v8::Number::New(pResultIsolate, nIncrementedRedisValue)");
RejectMutation("ExpireRedisKeyCallback", "!ParseExternalInt32FromValue(", "!ParseExternalInt64FromValue(");
RejectMutation("ExpireRedisKeyCallback", "pRedisClient->expire(strRedisKey, nRedisExpirationSeconds)", "pRedisClient->expire(strRedisKey, 0)");
RejectMutation("GetRedisHashFieldCallback", "std::move(Operation), MakeRedisOptionalStringValue)", "std::move(Operation), MakeString)");
RejectMutation("SetRedisHashFieldCallback", "constexpr bool kAllowEmptyRedisHashValue = true;", "constexpr bool kAllowEmptyRedisHashValue = false;");
RejectMutation("SetRedisHashFieldCallback", "MakeExternalInt64Value(pResultIsolate, nAddedRedisHashFieldCount)", "v8::Number::New(pResultIsolate, nAddedRedisHashFieldCount)");
RejectMutation("GetRedisDatabaseSizeCallback", "MakeExternalInt64Value(pResultIsolate, nRedisDatabaseKeyCount)", "v8::Number::New(pResultIsolate, nRedisDatabaseKeyCount)");
RejectMutation("GetRedisKeysCallback", "std::back_inserter(vecRedisKeys)", "vecRedisKeys.begin()");
RejectMutation("GetRedisKeysCallback", "if (!pResultIsolate || LocalResultContext.IsEmpty())", "if (false)");
RejectMutation("GetRedisKeyTypeCallback", "return pRedisClient->type(strRedisKey);", "return pRedisClient->get(strRedisKey).value();");
RejectMutation("MakeRedisInt64Value", "if (!pIsolate || LocalContext.IsEmpty())", "if (false)");
RejectMutation("MakeRedisInt64Value", "MakeExternalInt64Value(pIsolate, nValue)", "v8::Number::New(pIsolate, nValue)");
RejectMutation("MakeRedisInt64Value", "MakeExternalInt64Value(pIsolate, nValue)", "MakeExternalUInt64Value(pIsolate, nValue)");
RejectMutation("MakeRedisInt64Value", "MakeExternalInt64Value(pIsolate, nValue)", "MakeExternalInt64Value(pIsolate, 0)");
RejectMutation("GetRedisKeyTTLCallback", "std::move(Operation), MakeRedisInt64Value)", "std::move(Operation), MakeString)");
RejectMutation("GetRedisKeyTTLCallback", "return static_cast<std::int64_t>(nRemainingRedisKeyTTLSeconds);", "return static_cast<std::uint64_t>(nRemainingRedisKeyTTLSeconds);");
RejectMutation("PersistRedisKeyCallback", "return v8::Boolean::New(pResultIsolate, bRedisExpirationRemoved);", "return v8::Boolean::New(pResultIsolate, false);");
RejectMutation("DecrementRedisValueCallback", "std::move(Operation), MakeRedisInt64Value)", "std::move(Operation), MakeString)");
RejectMutation("IncrementRedisValueByAmountCallback", "GetInt64Argument(pIsolate, LocalContext, LocalRedisIncrementAmountValue, kInvalidRedisIncrementAmountErrorMessage, nRedisIncrementAmount)", "GetInt64Argument(pIsolate, LocalContext, v8::BigInt::New(pIsolate, 0), kInvalidRedisIncrementAmountErrorMessage, nRedisIncrementAmount)");
RejectMutation("IncrementRedisValueByAmountCallback", "std::move(Operation), MakeRedisInt64Value)", "std::move(Operation), MakeString)");
RejectMutation("GetMultipleRedisValuesCallback", "vecRedisKeys.begin(), vecRedisKeys.end()", "vecRedisKeys.rbegin(), vecRedisKeys.rend()");
RejectMutation("GetMultipleRedisValuesCallback", "LocalRedisValuesArray->CreateDataProperty(", "LocalRedisValuesArray->Set(");
RejectMutation("GetMultipleRedisValuesCallback", "LocalRedisValue = v8::Null(pResultIsolate);", "LocalRedisValue = v8::Undefined(pResultIsolate);");
RejectMutation("GetMultipleRedisValuesCallback", "MakeString(pResultIsolate, RedisStringValue.second)", "MakeString(pResultIsolate, std::string {})");
RejectMutation("GetMultipleRedisValuesCallback", "unRedisValueCount > kMaximumRedisValueCount", "false");
RejectMutation("GetMultipleRedisValuesCallback", "constexpr std::size_t kMaximumRedisValueCount = static_cast<std::size_t>(std::numeric_limits<int>::max());", "constexpr std::size_t kMaximumRedisValueCount = 0;");
RejectMutation("GetMultipleRedisValuesCallback", "constexpr bool kAllowSingleRedisKey = false;", "constexpr bool kAllowSingleRedisKey = true;");
RejectMutation("GetMultipleRedisValuesCallback", "constexpr bool kAllowEmptyRedisKeyStrings = false;", "constexpr bool kAllowEmptyRedisKeyStrings = true;");
RejectMutation("GetMultipleRedisValuesCallback", "kAllowSingleRedisKey, kAllowEmptyRedisKeyStrings, vecRedisKeys", "kAllowEmptyRedisKeyStrings, kAllowSingleRedisKey, vecRedisKeys");
RejectMutation("SetMultipleRedisValuesCallback", "if (mapRedisStringValues.empty())", "if (false)");
RejectMutation("SetMultipleRedisValuesCallback", "constexpr bool kAllowEmptyRedisKeys = false;", "constexpr bool kAllowEmptyRedisKeys = true;");
RejectMutation("MakeRedisBooleanValue", "if (!pIsolate || LocalContext.IsEmpty())", "if (false)");
RejectMutation("MakeRedisBooleanValue", "v8::Boolean::New(pIsolate, bValue)", "v8::Boolean::New(pIsolate, false)");
RejectMutation("MakeRedisBooleanValue", "v8::Boolean::New(pIsolate, bValue)", "v8::Boolean::New(pIsolate, !bValue)");
RejectMutation("MakeRedisBooleanValue", "v8::Boolean::New(pIsolate, bValue)", "v8::Integer::New(pIsolate, bValue)");
RejectMutation("SetMultipleRedisValuesCallback", "std::move(Operation), MakeRedisBooleanValue)", "std::move(Operation), MakeString)");
RejectMutation("DeleteRedisHashFieldsCallback", "std::move(Operation), MakeRedisInt64Value)", "std::move(Operation), MakeString)");
RejectMutation("DeleteRedisHashFieldsCallback", "constexpr bool kAllowSingleRedisHashField = true;", "constexpr bool kAllowSingleRedisHashField = false;");
RejectMutation("DeleteRedisHashFieldsCallback", "constexpr bool kAllowEmptyRedisHashFieldStrings = false;", "constexpr bool kAllowEmptyRedisHashFieldStrings = true;");
RejectMutation("DoesRedisHashFieldExistCallback", "std::move(Operation), MakeRedisBooleanValue)", "std::move(Operation), MakeString)");
RejectMutation("GetRedisHashFieldCountCallback", "std::move(Operation), MakeRedisInt64Value)", "std::move(Operation), MakeString)");
RejectMutation("GetAllRedisHashFieldsCallback", "LocalNullPrototype = v8::Null(pResultIsolate);", "LocalNullPrototype = v8::Undefined(pResultIsolate);");
RejectMutation("GetAllRedisHashFieldsCallback", "SetPrototypeV2(LocalResultContext, LocalNullPrototype).FromMaybe(false)", "SetPrototypeV2(LocalResultContext, LocalNullPrototype).FromMaybe(true)");
RejectMutation("GetAllRedisHashFieldsCallback", "LocalRedisHashFieldsObject->CreateDataProperty(", "LocalRedisHashFieldsObject->Set(");
RejectMutation("GetAllRedisHashFieldsCallback", "MakeString(pResultIsolate, itRedisHashField->first)", "MakeString(pResultIsolate, itRedisHashField->second)");
RejectMutation("GetAllRedisHashFieldsCallback", "MakeString(pResultIsolate, itRedisHashField->second)", "MakeString(pResultIsolate, itRedisHashField->first)");
RejectMutation("PushRedisListValues", "bPushToRedisListLeft ? pRedisClient->lpush(", "!bPushToRedisListLeft ? pRedisClient->lpush(");
RejectMutation("PushRedisListValues", "constexpr bool kAllowEmptyRedisListValueStrings = true;", "constexpr bool kAllowEmptyRedisListValueStrings = false;");
RejectMutation("PushRedisListValues", "std::move(Operation), MakeRedisInt64Value)", "std::move(Operation), MakeString)");
RejectMutation("PushLeftRedisListCallback", "constexpr bool kPushToRedisListLeft = true;", "constexpr bool kPushToRedisListLeft = false;");
RejectMutation("PushRightRedisListCallback", "constexpr bool kPushToRedisListLeft = false;", "constexpr bool kPushToRedisListLeft = true;");
RejectMutation("PopRedisListValue", "std::move(Operation), MakeRedisOptionalStringValue)", "std::move(Operation), MakeString)");
RejectMutation("PopRedisListValue", "bPopFromRedisListLeft ? pRedisClient->lpop(", "!bPopFromRedisListLeft ? pRedisClient->lpop(");
RejectMutation("MakeRedisOptionalStringValue", "if (!OptionalRedisStringValue)", "if (!OptionalRedisStringValue || OptionalRedisStringValue.value().empty())");
RejectMutation("PopLeftRedisListCallback", "constexpr bool kPopFromRedisListLeft = true;", "constexpr bool kPopFromRedisListLeft = false;");
RejectMutation("PopRightRedisListCallback", "constexpr bool kPopFromRedisListLeft = false;", "constexpr bool kPopFromRedisListLeft = true;");
RejectMutation("GetRedisListRangeCallback", "GetInt64Argument(pIsolate, LocalContext, LocalRedisListRangeStartValue, kInvalidRedisListRangeStartErrorMessage, nRedisListRangeStartIndex)", "GetInt64Argument(pIsolate, LocalContext, LocalRedisListRangeStopValue, kInvalidRedisListRangeStartErrorMessage, nRedisListRangeStartIndex)");
RejectMutation("GetRedisListRangeCallback", "GetInt64Argument(pIsolate, LocalContext, LocalRedisListRangeStopValue, kInvalidRedisListRangeStopErrorMessage, nRedisListRangeStopIndex)", "GetInt64Argument(pIsolate, LocalContext, LocalRedisListRangeStopValue, kInvalidRedisListRangeStopErrorMessage, nRedisListRangeStartIndex)");
RejectMutation("GetRedisListRangeCallback", "static_cast<long long>(nRedisListRangeStartIndex), static_cast<long long>(nRedisListRangeStopIndex)", "static_cast<long long>(nRedisListRangeStopIndex), static_cast<long long>(nRedisListRangeStartIndex)");
RejectMutation("GetRedisListRangeCallback", "return vecRedisListValues;", "return {};");
RejectMutation("AddOrRemoveRedisSetMembers", "constexpr bool kAllowSingleRedisSetMember = true;", "constexpr bool kAllowSingleRedisSetMember = false;");
RejectMutation("AddOrRemoveRedisSetMembers", "constexpr bool kAllowEmptyRedisSetMemberStrings = true;", "constexpr bool kAllowEmptyRedisSetMemberStrings = false;");
RejectMutation("AddOrRemoveRedisSetMembers", "bAddRedisSetMembers ? pRedisClient->sadd(", "!bAddRedisSetMembers ? pRedisClient->sadd(");
RejectMutation("GetRedisListRangeCallback", "std::move(Operation), MakeStringArray)", "std::move(Operation), MakeString)");
RejectMutation("AddOrRemoveRedisSetMembers", "std::move(Operation), MakeRedisInt64Value)", "std::move(Operation), MakeString)");
RejectMutation("AddRedisSetMembersCallback", "constexpr bool kAddRedisSetMembers = true;", "constexpr bool kAddRedisSetMembers = false;");
RejectMutation("RemoveRedisSetMembersCallback", "constexpr bool kAddRedisSetMembers = false;", "constexpr bool kAddRedisSetMembers = true;");
RejectMutation("GetRedisSetMembersCallback", "std::back_inserter(vecRedisSetMembers)", "vecRedisSetMembers.begin()");
RejectMutation("GetRedisSetMembersCallback", "return vecRedisSetMembers;", "return {};");
RejectMutation("GetRedisSetMembersCallback", "std::move(Operation), MakeStringArray)", "std::move(Operation), MakeString)");
RejectMutation("PublishRedisMessageCallback", "constexpr bool kAllowEmptyRedisMessage = true;", "constexpr bool kAllowEmptyRedisMessage = false;");
RejectMutation("PublishRedisMessageCallback", "ParseRequiredExternalStringArgument(RedisPublishCallbackInformation, kRedisPublishChannelArgumentIndex, kInvalidRedisChannelErrorMessage, kAllowEmptyRedisChannel, strRedisChannel)", "ParseRequiredExternalStringArgument(RedisPublishCallbackInformation, kRedisPublishMessageArgumentIndex, kInvalidRedisChannelErrorMessage, kAllowEmptyRedisChannel, strRedisChannel)");
RejectMutation("PublishRedisMessageCallback", "pRedisClient->publish(strRedisChannel, strRedisMessage)", "pRedisClient->publish(strRedisMessage, strRedisChannel)");
RejectMutation("PublishRedisMessageCallback", "std::move(Operation), MakeRedisInt64Value)", "std::move(Operation), MakeString)");
RejectMutation("PublishRedisMessageCallback", "return static_cast<std::int64_t>(nRedisSubscriberCount);", "return {};");
RejectMutation("ParseOptionalExternalStringMapProperty", "constexpr bool kAllowEmptyExternalStringMapKeys = true;", "constexpr bool kAllowEmptyExternalStringMapKeys = false;");
RejectMutation("ParseOptionalExternalStringMapProperty", "if (IsValueNullish(LocalExternalStringMapPropertyValue))", "if (false)");
RejectMutation("ParseOptionalExternalStringMapProperty", "LocalExternalStringMapPropertyValue.IsEmpty() || ExternalStringMapFailure.HasCaught()", "false || ExternalStringMapFailure.HasCaught()");
RejectMutation("ParseOptionalHTTPRequestBodyProperty", "if (IsValueNullish(LocalHTTPRequestBodyValue))", "if (false)");
RejectMutation("ParseOptionalHTTPRequestBodyProperty", "if (!LocalHTTPRequestBodyValue->IsString() && !LocalHTTPRequestBodyValue->IsArrayBuffer() && !LocalHTTPRequestBodyValue->IsArrayBufferView())", "if (!LocalHTTPRequestBodyValue->IsString() || !LocalHTTPRequestBodyValue->IsArrayBuffer() || !LocalHTTPRequestBodyValue->IsArrayBufferView())");
RejectMutation("ParseOptionalHTTPRequestBodyProperty", "GetFilesystemBytesFromValue(pIsolate, LocalHTTPRequestBodyValue, vecRequestBody)", "GetFilesystemBytesFromValue(pIsolate, LocalHTTPRequestOptionsObject, vecRequestBody)");
RejectMutation("ParseOptionalHTTPRequestBodyProperty", "RequestOptionsOut.m_bHasRequestBody = true;", "RequestOptionsOut.m_bHasRequestBody = false;");
RejectMutation("ParseHTTPAuthenticationMode", "std::tolower(static_cast<unsigned char>(chAuthenticationModeCharacter))", "std::tolower(chAuthenticationModeCharacter)");
RejectMutation("ParseHTTPAuthenticationMode", "{ \"ntlm\", cpr::AuthMode::NTLM }", "{ \"ntlm\", cpr::AuthMode::DIGEST }");
RejectMutation("ParseHTTPAuthenticationMode", "AuthenticationModeOut = HTTPAuthenticationModeInformation.m_AuthenticationMode;", "AuthenticationModeOut = cpr::AuthMode::BASIC;");
RejectMutation("ParseOptionalHTTPAuthenticationProperty", "constexpr char const* const kDefaultHTTPAuthenticationMode = \"basic\";", "constexpr char const* const kDefaultHTTPAuthenticationMode = \"digest\";");
RejectMutation("ParseOptionalHTTPAuthenticationProperty", "constexpr bool kAllowEmptyHTTPAuthenticationCredentialStrings = true;", "constexpr bool kAllowEmptyHTTPAuthenticationCredentialStrings = false;");
RejectMutation("ParseOptionalHTTPAuthenticationProperty", "constexpr bool kAllowEmptyHTTPAuthenticationMode = false;", "constexpr bool kAllowEmptyHTTPAuthenticationMode = true;");
RejectMutation("ParseOptionalHTTPAuthenticationProperty", "if (IsValueNullish(LocalHTTPAuthenticationValue))", "if (false)");
RejectMutation("ParseOptionalHTTPAuthenticationProperty", "LocalHTTPAuthenticationObject->Get(LocalHTTPAuthenticationContext, LocalHTTPAuthenticationPasswordPropertyName).ToLocal(&LocalHTTPAuthenticationPasswordValue)", "LocalHTTPAuthenticationObject->Get(LocalHTTPAuthenticationContext, LocalHTTPAuthenticationUsernamePropertyName).ToLocal(&LocalHTTPAuthenticationPasswordValue)");
RejectMutation("ParseOptionalHTTPAuthenticationProperty", "ParseExternalStringFromValue(pIsolate, LocalHTTPAuthenticationPasswordValue, kInvalidHTTPAuthenticationPasswordErrorMessage, kAllowEmptyHTTPAuthenticationCredentialStrings, strHTTPAuthenticationPassword)", "ParseExternalStringFromValue(pIsolate, LocalHTTPAuthenticationUsernameValue, kInvalidHTTPAuthenticationPasswordErrorMessage, kAllowEmptyHTTPAuthenticationCredentialStrings, strHTTPAuthenticationPassword)");
RejectMutation("ParseOptionalHTTPAuthenticationProperty", "RequestOptionsOut.m_AuthenticationMode = ParsedHTTPAuthenticationMode;", "RequestOptionsOut.m_AuthenticationMode = cpr::AuthMode::BASIC;");
RejectMutation("ParseOptionalHTTPAuthenticationProperty", "RequestOptionsOut.m_bHasAuthentication = true;", "RequestOptionsOut.m_bHasAuthentication = false;");
RejectMutation("ParseOptionalHTTPAuthenticationProperty", "RequestOptionsOut.m_strAuthenticationUsername = std::move(strHTTPAuthenticationUsername);", "RequestOptionsOut.m_strAuthenticationUsername = std::move(strHTTPAuthenticationPassword);");

RejectMutation("HTTPRequestOptions::HTTPRequestOptions", "kDefaultHTTPMethod = \"GET\";", "kDefaultHTTPMethod = \"POST\";");
RejectMutation("HTTPRequestOptions::HTTPRequestOptions", "kDefaultRequestTimeoutMilliseconds = 0;", "kDefaultRequestTimeoutMilliseconds = 1;");
RejectMutation("HTTPRequestOptions::HTTPRequestOptions", "kDefaultFollowRedirects = true;", "kDefaultFollowRedirects = false;");
RejectMutation("HTTPRequestOptions::HTTPRequestOptions", "kDefaultBlocking = false;", "kDefaultBlocking = true;");
RejectMutation("InitializeHTTPRequestOptions", "RequestOptionsOut = HTTPRequestOptions {};", "");
RejectMutation("InitializeHTTPRequestOptions", "if (pszHTTPMethod)", "if (!pszHTTPMethod)");
RejectMutation("InitializeHTTPRequestOptions", "RequestOptionsOut.m_strMethod = pszHTTPMethod;", "RequestOptionsOut.m_strURL = pszHTTPMethod;");
RejectMutation("IsHTTPMethodSupported", "\"OPTIONS\"", "\"TRACE\"");
RejectMutation("ParseHTTPRequestOptions", "LocalHTTPRequestMethodValue.IsEmpty() || HTTPFailure.HasCaught()", "false || HTTPFailure.HasCaught()");
RejectMutation("ParseHTTPRequestOptions", "if (!LocalHTTPRequestValue->IsObject() || LocalHTTPRequestValue->IsArray())", "if (!LocalHTTPRequestValue->IsObject())");
RejectMutation("ParseHTTPRequestOptions", "if (!pszFixedHTTPMethod)", "if (pszFixedHTTPMethod)");
RejectMutation("ParseHTTPRequestOptions", "if (!IsValueNullish(LocalHTTPRequestMethodValue))", "if (false)");
RejectMutation("ParseHTTPRequestOptions", "if (ParsedHTTPRequestOptions.m_strURL.empty())", "if (false)");
RejectMutation("ParseHTTPRequestOptions", "std::toupper(static_cast<unsigned char>(chHTTPMethodCharacter))", "std::toupper(chHTTPMethodCharacter)");
RejectMutation("ParseHTTPRequestOptions", "ParsedHTTPRequestOptions.m_nConnectionTimeoutMilliseconds < 0", "ParsedHTTPRequestOptions.m_nConnectionTimeoutMilliseconds <= 0");
RejectMutation("ParseHTTPRequestOptions", "ParsedHTTPRequestOptions.m_bHasAuthentication && !ParsedHTTPRequestOptions.m_strBearerToken.empty()", "ParsedHTTPRequestOptions.m_bHasAuthentication || !ParsedHTTPRequestOptions.m_strBearerToken.empty()");
RejectMutation("ParseHTTPRequestOptions", "RequestOptionsOut = std::move(ParsedHTTPRequestOptions);", "RequestOptionsOut = std::move(RequestOptionsOut);");
RejectMutation("MakeCPRResponseObject", "LocalCPRResponseObject->CreateDataProperty(", "LocalCPRResponseObject->Set(");
RejectMutation("MakeCPRResponseObject", "LocalCPRResponseHeaders->CreateDataProperty(", "LocalCPRResponseHeaders->Set(");
RejectMutation("MakeCPRResponseObject", "LocalCPRResponseCookies->CreateDataProperty(", "LocalCPRResponseCookies->Set(");
RejectMutation("MakeCPRResponseObject", "MakeExternalInt64Value(pIsolate, static_cast<std::int64_t>(HTTPResponse.uploaded_bytes))", "v8::Number::New(pIsolate, static_cast<double>(HTTPResponse.uploaded_bytes))");
RejectMutation("MakeCPRResponseObject", "MakeExternalInt64Value(pIsolate, static_cast<std::int64_t>(HTTPResponse.downloaded_bytes))", "v8::Number::New(pIsolate, static_cast<double>(HTTPResponse.downloaded_bytes))");
RejectMutation("MakeCPRResponseObject", "MakeExternalInt64Value(pIsolate, static_cast<std::int64_t>(HTTPResponse.redirect_count))", "v8::Number::New(pIsolate, static_cast<double>(HTTPResponse.redirect_count))");
RejectMutation("MakeCPRResponseObject", "LocalCPRResponseHeaderName.IsEmpty() || CPRResponseFailure.HasCaught()", "false || CPRResponseFailure.HasCaught()");
RejectMutation("MakeCPRResponseObject", "LocalCPRResponseCookieName.IsEmpty() || CPRResponseFailure.HasCaught()", "false || CPRResponseFailure.HasCaught()");
RejectMutation("MakeCPRResponseObject", "HTTPResponse.status_code < kMaximumSuccessfulStatusCode", "HTTPResponse.status_code <= kMaximumSuccessfulStatusCode");
RejectMutation("MakeCPRResponseObject", "constexpr int kMinimumHTTPResponseStatusCode = std::numeric_limits<int>::lowest();", "constexpr int kMinimumHTTPResponseStatusCode = 0;");
RejectMutation("MakeCPRResponseObject", "constexpr int kMaximumHTTPResponseStatusCode = std::numeric_limits<int>::max();", "constexpr int kMaximumHTTPResponseStatusCode = 0;");
RejectMutation("MakeCPRResponseObject", "HTTPResponse.status_code < kMinimumHTTPResponseStatusCode", "HTTPResponse.status_code > kMinimumHTTPResponseStatusCode");
RejectMutation("MakeCPRResponseObject", "HTTPResponse.status_code > kMaximumHTTPResponseStatusCode", "HTTPResponse.status_code < kMaximumHTTPResponseStatusCode");
RejectMutation("MakeCPRResponseObject", "return LocalCPRResponseObject;", "return {};");

RejectMutation("QueueCPRRequest", "kRequiredArgumentCount = 2;", "kRequiredArgumentCount = 1;");
RejectMutation("QueueCPRRequest", "kCallbackArgumentIndex = 1;", "kCallbackArgumentIndex = 0;");
RejectMutation("QueueCPRRequest", "!LocalOptionsValue->IsObject() || LocalOptionsValue->IsArray()", "!LocalOptionsValue->IsObject()");
RejectMutation("QueueCPRRequest", "!LocalCallbackValue->IsFunction()", "false");
RejectMutation("QueueCPRRequest", "ParsedHTTPRequestOptions.m_bBlocking;", "false;");
RejectMutation("QueueCPRRequest", "[ParsedHTTPRequestOptions = std::move(ParsedHTTPRequestOptions)]() -> AsyncRequestResult", "[&ParsedHTTPRequestOptions]() -> AsyncRequestResult");
RejectMutation("QueueCPRRequest", "RequestResult.m_Value = PerformHTTPRequest(ParsedHTTPRequestOptions);", "RequestResult.m_Value = {};");
RejectMutation("QueueCPRRequest", "GetRuntimeFromCallbackInformation(CallbackInformation);\n\t\t\tif (CPRFailure.HasCaught()", "nullptr;\n\t\t\tif (CPRFailure.HasCaught()");
RejectMutation("QueueCPRRequest", "std::any_cast<cpr::Response>(&ResultValue);", "std::any_cast<std::string>(&ResultValue);");
RejectMutation("QueueCPRRequest", "if (!pHTTPResponse)", "if (false)");
RejectMutation("QueueCPRRequest", "if (bBlockingRequest)", "if (false)");
RejectMutation("QueueCPRRequest", "RunBlockingRequest(LocalCallbackFunction, std::move(Task), ConvertResult)", "RunBlockingRequest(LocalCallbackFunction, Task, ConvertResult)");
RejectMutation("QueueCPRRequest", "QueueAsyncRequest(LocalCallbackFunction, std::move(Task), ConvertResult)", "QueueAsyncRequest(LocalCallbackFunction, Task, ConvertResult)");
RejectMutation("QueueCPRRequest", "LocalCallbackFunction.IsEmpty() || CPRFailure.HasCaught()", "false || CPRFailure.HasCaught()");
RejectMutation("InstallPathConstants", "LocalPathModuleObject->CreateDataProperty(", "LocalPathModuleObject->Set(");
RejectMutation("InstallPathConstants", "MakeString(pIsolate, EncodePathAsUTF8(PathValue));", "MakeString(pIsolate, PathValue.string());");
RejectMutation("InstallPathConstants", "LocalPathValue.IsEmpty() || PathConstantsFailure.HasCaught()", "false || PathConstantsFailure.HasCaught()");
RejectMutation("InstallPathConstants", "LocalPropertyName.IsEmpty() || PathConstantsFailure.HasCaught()", "false || PathConstantsFailure.HasCaught()");
RejectMutation("InstallPathConstants", "InstallPathConstant(\"ADDON_ROOT\", PathGameRoot / \"addons\")", "InstallPathConstant(\"ADDON_ROOT\", PathAddonRoot)");
RejectMutation("PerformCPRRequestCallback", "kNoFixedHTTPMethod = nullptr;", "kNoFixedHTTPMethod = \"GET\";");
RejectMutation("PerformFixedMethodCPRRequest", "QueueCPRRequest(pIsolate, FixedMethodCPRRequestCallbackInformation, pszHTTPMethod);", "QueueCPRRequest(pIsolate, FixedMethodCPRRequestCallbackInformation, nullptr);");
RejectMutation("PerformCPRGetRequestCallback", "kHTTPGetMethod = \"GET\";", "kHTTPGetMethod = \"TRACE\";");
RejectMutation("PerformCPRPostRequestCallback", "kHTTPPostMethod = \"POST\";", "kHTTPPostMethod = \"TRACE\";");
RejectMutation("PerformCPRPutRequestCallback", "kHTTPPutMethod = \"PUT\";", "kHTTPPutMethod = \"TRACE\";");
RejectMutation("PerformCPRPatchRequestCallback", "kHTTPPatchMethod = \"PATCH\";", "kHTTPPatchMethod = \"TRACE\";");
RejectMutation("PerformCPRDeleteRequestCallback", "kHTTPDeleteMethod = \"DELETE\";", "kHTTPDeleteMethod = \"TRACE\";");
RejectMutation("PerformCPRHeadRequestCallback", "kHTTPHeadMethod = \"HEAD\";", "kHTTPHeadMethod = \"TRACE\";");
RejectMutation("PerformCPROptionsRequestCallback", "kHTTPOptionsMethod = \"OPTIONS\";", "kHTTPOptionsMethod = \"TRACE\";");

console.log("Manager/autodoc/external parameter native source contracts PASS; rejected mutations=" + g_unRejectedMutationCount + "; live V8/engine execution not exercised.");
