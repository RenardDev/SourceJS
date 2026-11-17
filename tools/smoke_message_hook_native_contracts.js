#!/usr/bin/env node

"use strict";

// Source-boundary regressions plus the actual private method decoder compiled in isolation.
// SDK-header probes inspect real member addresses; no fixture invokes an engine/V8 callback.
const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_Crypto = require("node:crypto");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_strRootPath = g_Path.resolve(__dirname, "..");
const g_strFixtureDirectory = g_Path.join(g_strRootPath, "build", "native-message-method-index");
const g_strOwnerMarker = "Generated-only; tools/smoke_message_hook_native_contracts.js owns this file.";
const g_strUsage = "Usage: node tools/smoke_message_hook_native_contracts.js [--architecture x86|x64] [--sdk-root PATH] [--help]";
const g_unCommandTimeoutMilliseconds = 180000;
const g_setOptions = new Set();
let g_strArchitecture = "x64";
let g_strSDKRootPath = "";
let g_unRejectedMutations = 0;

function ExitUsage(nExitCode, strError = "") {
	if (strError) {
		console.error(strError);
	}

	console[nExitCode ? "error" : "log"](g_strUsage);
	process.exit(nExitCode);
}

function GetDisplayPath(strPath) {
	return g_Path.relative(process.cwd(), strPath) || ".";
}

if ((process.argv.length === 3) && ((process.argv[2] === "--help") || (process.argv[2] === "-h"))) {
	ExitUsage(0);
}

for (let unIndex = 2; unIndex < process.argv.length; unIndex += 2) {
	const strOption = process.argv[unIndex];
	const strValue = process.argv[unIndex + 1];
	if ((strOption !== "--architecture") && (strOption !== "--sdk-root")) {
		ExitUsage(2, "Unknown option: " + strOption);
	}

	if (g_setOptions.has(strOption)) {
		ExitUsage(2, "Duplicate option: " + strOption);
	}

	if ((typeof strValue !== "string") || !strValue || strValue.startsWith("--")) {
		ExitUsage(2, "Missing value for option: " + strOption);
	}

	g_setOptions.add(strOption);

	if (strOption === "--architecture") {
		g_strArchitecture = strValue;

	} else {
		g_strSDKRootPath = g_Path.resolve(strValue);
	}
}

if ((g_strArchitecture !== "x86") && (g_strArchitecture !== "x64")) {
	ExitUsage(2, "Unsupported architecture: " + g_strArchitecture);
}

g_Assert((process.platform === "win32") || (process.platform === "linux"));
g_Assert((process.arch === "ia32") || (process.arch === "x64"), "Native fixtures support only x86-family hosts.");

if (g_strSDKRootPath) {
	const strSDKHeaderPath = g_Path.join(g_strSDKRootPath, "public", "eiface.h");
	g_Assert(g_FileSystem.existsSync(strSDKHeaderPath), "Selected SDK header is missing: " + GetDisplayPath(strSDKHeaderPath));
}

const g_strBindings = g_FileSystem.readFileSync(g_Path.join(g_strRootPath, "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_vecCallbackContracts = [
	["GetMessagesUserMessageBeginHookOptionsCallback", "messages/hooks.GetUserMessageBeginHookOptions()"],
	["GetMessagesMessageEndHookOptionsCallback", "messages/hooks.GetMessageEndHookOptions()"],
	["GetMessagesBitBufferRecipientFilterCallback", "messages/hooks.GetRecipientFilter()"],
	["GetMessagesBitBufferStateCallback", "messages/hooks.GetBitBufferState()"],
	["ApplyMessagesBitBufferStateCallback", "messages/hooks.ApplyBitBufferState()"],
	["GetMessagesMessageIndexCallback", "messages.GetUserMessageIndex()"],
	["GetMessagesMessageNameCallback", "messages.GetUserMessageName()"],
	["GetMessagesMessageSizeCallback", "messages.GetUserMessageSize()"],
	["GetMessagesSendUserMessageHookOptionsCallback", "messages/hooks.GetSendUserMessageHookOptions()"],
	["GetMessagesProtobufRecipientFilterCallback", "messages/hooks.GetRecipientFilter()"],
	["HandleMessagesProtobufMethodCallback", "messages/hooks protobuf message operation"],
	["GetMessagesProtobufMessageCallback", "messages/hooks.GetProtobufMessage()"],
	["SendMessagesUserMessageCallback", "messages.SendUserMessage()", true],
	["SendMessagesSayTextMessageCallback", "messages.SendSayTextMessage()", true],
	["SendMessagesSayText2MessageCallback", "messages.SendSayText2Message()", true],
	["ApplyMessagesSayText2ColorCallback", "messages/colors/saytext2.Apply()", true],
	["StripMessagesSayText2ColorCodesCallback", "messages/colors/saytext2.Strip()", true],
	["CreateMessagesDialogCallback", "messages.CreateDialog()", true],
	["ShowMenusTextCallback", "menus.ShowText()", true],
	["HideMenusTextCallback", "menus.HideText()", true],
];
const g_vecInstallationFunctions = [
	["MakeMessagesHookOptions", "nullptr"],
	["GetMessagesBitBufferRecipientFilterCallback", "nullptr"],
	["GetMessagesBitBufferStateCallback", "nullptr"],
	["GetMessagesProtobufRecipientFilterCallback", "kRecipientFilterBuildErrorMessage"],
	["MakeMessagesProtobufMessageObject", "nullptr"],
	["MakeSteamIDFieldsObject", "nullptr"],
];

const g_vecNativeUnwindContracts = [
	["MakeMessagesHookOptions", "InstallationFailure"],
	["GetMessagesBitBufferRecipientFilterCallback", "InstallationFailure"],
	["GetMessagesBitBufferStateCallback", "InstallationFailure"],
	["GetMessagesObjectValue", "PropertyFailure"],
	["GetMessagesProtobufRecipientFilterCallback", "InstallationFailure"],
	["MakeMessagesProtobufMessageObject", "InstallationFailure"],
	["HandleMessagesProtobufMethodCallback", "ParseFailure"],
	["SendMessagesSayTextMessageCallback", "SenderIndexFailure"],
	["SendMessagesSayText2MessageCallback", "SenderIndexFailure"],
	["GetMessagesColorArrayComponent", "ColorComponentFailure"],
	["GetMessagesColorObjectComponent", "ColorComponentFailure"],
	["SetMessagesKeyValuesFromObject", "FieldEnumerationFailure"],
	["SetMessagesKeyValuesFromObject", "FieldNameFailure"],
	["SetMessagesKeyValuesFromObject", "FieldValueFailure"],
	["GetSteamUInt32FromValue", "NumberFailure"],
	["MakeSteamIDFieldsObject", "InstallationFailure"],
	["GetEngineServerClientSteamIDCallback", "ClientIndexFailure"],
];

function GetNativeFunctionRegion(strBindings, strName) {
	const vecDefinitionMatches = new RegExp("^(\\t{1,2})[^\\t\\n]*\\b" + strName + "\\([^\\n]*\\) (?:noexcept )?\\{$", "m").exec(strBindings);
	g_Assert(vecDefinitionMatches, "Missing native definition: " + strName);

	const strTerminator = "\n" + vecDefinitionMatches[1] + "}";
	const nDefinitionEnd = strBindings.indexOf(strTerminator, vecDefinitionMatches.index);
	g_Assert(nDefinitionEnd > vecDefinitionMatches.index, "Missing native function end: " + strName);

	return { Start: vecDefinitionMatches.index, End: nDefinitionEnd + strTerminator.length, Indentation: vecDefinitionMatches[1] };
}

function GetNativeFunction(strBindings, strName) {
	const Region = GetNativeFunctionRegion(strBindings, strName);

	// Only normalize the behavioral view; mutations retain the exact source region.
	return strBindings.slice(Region.Start, Region.End).split("\n").map(strLine => strLine.startsWith(Region.Indentation) ? ("\t" + strLine.slice(Region.Indentation.length)) : strLine).join("\n");
}

function ReplaceNativeFunction(strBindings, strName, strBody) {
	const Region = GetNativeFunctionRegion(strBindings, strName);
	const strReplacement = strBody.split("\n").map(strLine => strLine.startsWith("\t") ? (Region.Indentation + strLine.slice(1)) : strLine).join("\n");

	return strBindings.slice(0, Region.Start) + strReplacement + strBindings.slice(Region.End);
}

function VerifySourceContracts(strBindings) {
	for (const vecContract of g_vecNativeUnwindContracts) {
		const strFrame = vecContract[1];
		const Pattern = new RegExp("} catch \\(\\.\\.\\.\\) \\{\\n\\t+if \\(" + strFrame + "\\.HasCaught\\(\\)\\) \\{\\n\\t+" + strFrame + "\\.ReThrow\\(\\);\\n\\t+}\\n\\n\\t+throw;\\n\\t+}");
		g_Assert.match(GetNativeFunction(strBindings, vecContract[0]), Pattern, "Retain original JavaScript exceptions during native unwinding: " + vecContract[0]);
	}

	for (const vecContract of g_vecCallbackContracts) {
		const strFunction = GetNativeFunction(strBindings, vecContract[0]);
		const nGuard = strFunction.indexOf("\n\t\tif (!pIsolate) {\n\t\t\treturn;\n\t\t}");
		const nTry = strFunction.indexOf("\n\t\ttry {\n");
		const nCatch = strFunction.indexOf("\n\t\t} catch (...) {");
		g_Assert((nGuard >= 0) && (nTry > nGuard) && (nCatch > nTry));
		const strTranslation = vecContract[2] ? "\n\t\t\tif (!pIsolate->IsExecutionTerminating() && !pIsolate->HasPendingException()) {\n\t\t\t\tThrowError(pIsolate, kNativeExceptionErrorMessage);\n\t\t\t}" : "\n\t\t\tThrowError(pIsolate, kNativeExceptionErrorMessage);";
		g_Assert.equal(strFunction.slice(nCatch), "\n\t\t} catch (...) {" + strTranslation + "\n\t\t}\n\t}");
		g_Assert(strFunction.includes('kNativeExceptionErrorMessage[] = "' + vecContract[1] + ' failed with a native C++ exception.";'));
		g_Assert(strFunction.slice(nTry, nCatch).includes("CallbackInformation.GetReturnValue().Set("));

		if (strFunction.includes("pIsolate->GetCurrentContext()")) {
			g_Assert(strFunction.indexOf("pIsolate->GetCurrentContext()") > nTry);
		}

		g_Assert.doesNotMatch(strFunction, /using (?:UserMessageBegin|MessageEnd|SendUserMessage)MethodType|GetSDKVirtualMethodIndex</);
	}

	for (const vecContract of g_vecInstallationFunctions) {
		const strFunction = GetNativeFunction(strBindings, vecContract[0]);
		const nContextGuard = strFunction.indexOf("LocalContext.IsEmpty()");
		const nFrame = strFunction.indexOf("v8::TryCatch InstallationFailure(pIsolate);");
		g_Assert((nContextGuard >= 0) && (nFrame > nContextGuard) && (nFrame < strFunction.indexOf("v8::Object::New(pIsolate)")));

		const strProtected = strFunction.slice(nFrame);
		g_Assert.doesNotMatch(strProtected, /ThrowError\(pIsolate, (?:strHookOptionsInstallErrorMessage|kRecipientFilterBuildErrorMessage|kBitBufferStateBuildErrorMessage)/);
		const vecRethrowMatches = [...strProtected.matchAll(/RethrowV8InstallationFailure\(pIsolate, InstallationFailure, [^\n]+\);/g)];
		g_Assert(vecRethrowMatches.length > 1);
		for (const vecRethrowMatch of vecRethrowMatches) {
			g_Assert.match(strProtected.slice(vecRethrowMatch.index + vecRethrowMatch[0].length), /^\n\t+return(?: \{\})?;/);
		}

		const vecEmptyFailures = [...strProtected.matchAll(/^\t+if \([^\n]*\.IsEmpty\(\)[^\n]*\) \{\n([^\n]*)/gm)];
		g_Assert(vecEmptyFailures.length > 0);
		g_Assert.equal(vecEmptyFailures[0][1].trim(), "RethrowV8InstallationFailure(pIsolate, InstallationFailure, " + vecContract[1] + ");");
	}

	g_Assert.doesNotMatch(strBindings, /\bGetMessagesProtobufVirtualMethodIndex\b/);

	const strSize = GetNativeFunction(strBindings, "GetMessagesMessageSizeCallback");
	const SizeRegion = GetNativeFunctionRegion(strBindings, "GetMessagesMessageSizeCallback");
	g_Assert(strBindings.includes("#if !defined(SOURCEJS_USERMESSAGE_IS_PROTOBUF)\n" + strBindings.slice(SizeRegion.Start, SizeRegion.End) + "\n#endif // !defined(SOURCEJS_USERMESSAGE_IS_PROTOBUF)"));
	g_Assert.doesNotMatch(strSize, /kUnsupportedErrorMessage|messages\.GetMessageSize/);

	const strIndex = GetNativeFunction(strBindings, "GetMessagesMessageIndexCallback");
	const nNameConversion = strIndex.indexOf("ValueToString(");
	const nNullGuard = strIndex.indexOf("if (strUserMessageName.find('\\0') != std::string::npos)");
	g_Assert((nNameConversion >= 0) && (nNullGuard > nNameConversion) && (nNullGuard < strIndex.indexOf("FindUserMessageType(")), "Reject NUL before native message lookup.");

	const UnsignedRegion = GetNativeFunctionRegion(strBindings, "GetMessagesUnsignedIntegerFromValue");
	g_Assert(strBindings.includes("#if defined(SOURCEJS_HAS_RECIPIENT_FILTER) && defined(SOURCEJS_USERMESSAGE_CAN_WRITE_SAYTEXT)\n" + strBindings.slice(UnsignedRegion.Start, UnsignedRegion.End) + "\n#endif // bitbuffer unsigned message fields"), "Compile the unsigned parser only in its using bitbuffer configuration.");

	const strProperty = GetNativeFunction(strBindings, "GetMessagesObjectValue");
	g_Assert(strProperty.includes("v8::TryCatch PropertyFailure(pIsolate);"));
	g_Assert(strProperty.includes("!PropertyFailure.HasCaught() && !pIsolate->IsExecutionTerminating() && !pIsolate->HasPendingException()"));
	g_Assert.match(strProperty, /PropertyFailure\.ReThrow\(\);\n\t+return false;/);

	const strField = GetNativeFunction(strBindings, "WriteUserMessageField");
	g_Assert.doesNotMatch(strField, /\bGetObjectString\(|\bGetObjectValue\(/);
	g_Assert.equal((strField.match(/GetMessagesObjectValue\(/g) ?? []).length, 3);
	g_Assert(strField.includes("if (!LocalFieldTypeValue->IsString())"));
	g_Assert(strField.indexOf("LocalFieldTypeValue->IsString()") < strField.indexOf("ValueToString(pIsolate, LocalFieldTypeValue)"));

	const strBinding = GetNativeFunction(strBindings, "GetMessagesProtobufMessageFromData");
	g_Assert.doesNotMatch(strBinding, /\bGetObjectValue\(/);
	g_Assert(strBinding.includes("if (!pProtobufMessage)"));
	g_Assert(strBinding.indexOf("strMethodOperationOut =") > strBinding.indexOf("if (!pProtobufMessage)"));

	const strRepeatedValidation = GetNativeFunction(strBindings, "ValidateMessagesProtobufRepeatedIndex");
	g_Assert.match(strRepeatedValidation, /if \(\(nRepeatedFieldIndex < 0\) \|\| \(nRepeatedFieldIndex >= nRepeatedFieldCount\)\) \{\n\t+ThrowError\(pIsolate, kRepeatedFieldIndexRangeErrorMessage\);\n\t+return false;\n\t+\}/);

	const strRepeated = GetNativeFunction(strBindings, "RequireMessagesProtobufRepeatedIndex");
	g_Assert(strRepeated.includes("kRepeatedFieldIndexArgumentErrorMessage, nRepeatedFieldIndex)"));
	g_Assert.match(strRepeated, /if \(!ValidateMessagesProtobufRepeatedIndex\(pIsolate, pMessage, pFieldDescriptor, nRepeatedFieldIndex\)\) \{\n\t+return false;\n\t+\}/);
	g_Assert(strRepeated.indexOf("nRepeatedFieldIndexOut = nRepeatedFieldIndex;") > strRepeated.indexOf("if (!ValidateMessagesProtobufRepeatedIndex("));
	g_Assert(GetNativeFunction(strBindings, "RequireMessagesProtobufField").includes("CppType const ExpectedFieldType"));
	g_Assert(GetNativeFunction(strBindings, "WriteUserMessageFloat").includes("std::numeric_limits<float>::is_iec559"));

	const strStringProperty = GetNativeFunction(strBindings, "GetMessagesObjectString");
	g_Assert(strStringProperty.includes("GetMessagesObjectValue(pIsolate, LocalContext, LocalObject, pszPropertyName, pszErrorMessage, LocalValue)"));
	g_Assert(strStringProperty.includes("if (!LocalValue->IsString())"));
	g_Assert(strStringProperty.indexOf("strValueOut = ValueToString(pIsolate, LocalValue);") > strStringProperty.indexOf("if (!LocalValue->IsString())"));

	const strProtobufField = GetNativeFunction(strBindings, "WriteMessagesProtobufField");
	g_Assert.doesNotMatch(strProtobufField, /\bGetObjectString\(|\bGetObjectValue\(/);
	const vecPropertyReads = [...strProtobufField.matchAll(/GetMessagesObject(?:String|Value)\(pIsolate, LocalContext, LocalFieldDefinitionObject, "([^"]+)"/g)];
	g_Assert.deepEqual(vecPropertyReads.map((vecPropertyReadMatch) => vecPropertyReadMatch[1]), ["Kind", "Name", "Fields", "Type", "Value"]);

	const strOperation = GetNativeFunction(strBindings, "HandleMessagesProtobufMethodCallback");
	const nParseFrame = strOperation.indexOf("v8::TryCatch ParseFailure(pIsolate);");
	const nByteConversion = strOperation.indexOf("GetFilesystemBytesFromValue(");
	const nByteLimit = strOperation.indexOf("vecSerializedProtobufBytes.size() > kMaximumProtobufParseByteCount");
	const nNativeParse = strOperation.indexOf("pMessage->ParseFromArray(");
	g_Assert((nParseFrame >= 0) && (nByteConversion > nParseFrame) && (nByteLimit > nByteConversion) && (nNativeParse > nByteLimit));
	const strByteRead = strOperation.slice(nParseFrame, nByteLimit);
	g_Assert(strByteRead.includes("!ParseFailure.HasCaught() && !pIsolate->IsExecutionTerminating() && !pIsolate->HasPendingException()"));
	g_Assert.match(strByteRead, /ParseFailure\.ReThrow\(\);\n\t+return;\n\t+}/);
	g_Assert.match(strByteRead, /throw;\n\t+}\n\t+}\n\n\t+if \(/);
	g_Assert(strOperation.includes("kRequiredArgumentCount = kFirstArgumentIndex + 1;"));
	g_Assert(GetNativeFunction(strBindings, "GetMessagesProtobufMessageCallback").includes("kRequiredArgumentCount = kProtobufMessageArgumentIndex + 1;"));

	const strPlayer = GetNativeFunction(strBindings, "RequireMessagePlayerEdict");
	g_Assert(strPlayer.includes("int* const pnPlayerIndexOut = nullptr"));
	g_Assert(strPlayer.includes("PlayerIndexFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()"));

	const nFreeEdictGuard = strPlayer.indexOf("pPlayerEdict->IsFree()");
	g_Assert((nFreeEdictGuard >= 0) && (strPlayer.indexOf("*pnPlayerIndexOut = nPlayerIndex;") > nFreeEdictGuard));
	g_Assert.match(strPlayer, /if \(pnPlayerIndexOut\) \{\n\t+\*pnPlayerIndexOut = nPlayerIndex;\n\t+}\n\n\t+return pPlayerEdict;/);

	for (const strName of ["SendMessagesSayTextMessageCallback", "SendMessagesSayText2MessageCallback"]) {
		const strSend = GetNativeFunction(strBindings, strName);
		g_Assert.equal((strSend.match(/GetValueIndex\(/g) ?? []).length, 1);
		g_Assert.match(strSend, /RequireMessagePlayerEdict\([^\n]*, &nPlayerIndex\)/);
		g_Assert(strSend.includes("v8::TryCatch SenderIndexFailure(pIsolate);"));
		g_Assert(strSend.includes("SenderIndexFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()"));
		g_Assert.match(strSend, /SenderIndexFailure\.ReThrow\(\);\n\t+return;/);
	}

	for (const strName of ["SendMessagesUserMessageCallback", "SendMessagesSayTextMessageCallback", "SendMessagesSayText2MessageCallback"]) {
		const strSend = GetNativeFunction(strBindings, strName);
		g_Assert.match(strSend, /if \(!pBitBuffer\) \{\n\t+ThrowError\(pIsolate, [^\n]+\);\n\t+return;\n\t+}\n\n\t+SourceJSUserMessageScope UserMessageScope\(pEngineServer\);/);
		g_Assert.equal((strSend.match(/UserMessageScope\.EndUserMessage\(\);/g) ?? []).length, 1);
		g_Assert.doesNotMatch(strSend, /pEngineServer->MessageEnd\(\)/);

		const nMessageWrite = strSend.indexOf("WriteUserMessage");
		const nMessageEnd = strSend.indexOf("UserMessageScope.EndUserMessage();");
		g_Assert((nMessageWrite >= 0) && (nMessageEnd > nMessageWrite) && (nMessageEnd < strSend.indexOf("CallbackInformation.GetReturnValue().Set(")));
	}

	const strSayText2 = GetNativeFunction(strBindings, "SendMessagesSayText2MessageCallback");
	g_Assert.match(strSayText2, /constexpr std::size_t kSayText2ParameterCount = 4;/);
	g_Assert.match(strSayText2, /for \(std::size_t unParameterIndex = 0; bSayText2WriteSucceeded && \(unParameterIndex < kSayText2ParameterCount\); \+\+unParameterIndex\) \{\n\t+bSayText2WriteSucceeded = WriteUserMessageString\(pBitBuffer, ""\);\n\t+}/);

	const nMessageTextWrite = strSayText2.indexOf("WriteUserMessageString(pBitBuffer, strMessageText)");
	const nParameterLoopOffset = strSayText2.indexOf("for (std::size_t unParameterIndex");
	g_Assert((nMessageTextWrite >= 0) && (nParameterLoopOffset > nMessageTextWrite), "SayText2 parameters follow the message text");
	g_Assert(nParameterLoopOffset < strSayText2.indexOf("UserMessageScope.EndUserMessage()"), "SayText2 parameters precede message end");

	const strScopeStart = "#if defined(SOURCEJS_HAS_RECIPIENT_FILTER) && defined(SOURCEJS_USERMESSAGE_CAN_WRITE_SAYTEXT)\n\t\t// Attempts to end a successfully begun bitbuffer message once";
	const nScopeStart = strBindings.indexOf(strScopeStart);
	const nScopeEnd = strBindings.indexOf("\n#endif // defined(SOURCEJS_HAS_RECIPIENT_FILTER) && defined(SOURCEJS_USERMESSAGE_CAN_WRITE_SAYTEXT)", nScopeStart);
	g_Assert((nScopeStart >= 0) && (nScopeEnd > nScopeStart));

	const strScope = strBindings.slice(nScopeStart, nScopeEnd);
	g_Assert(strScope.includes("SourceJSUserMessageScope::~SourceJSUserMessageScope() noexcept {\n\t\t\ttry {\n\t\t\t\tEndUserMessage();\n\t\t\t} catch (...) {"));
	g_Assert(strScope.includes("auto* const pEngineServer = m_pEngineServer;\n\t\t\tm_pEngineServer = nullptr;\n\t\t\tpEngineServer->MessageEnd();"));
	g_Assert.equal((strScope.match(/= delete;/g) ?? []).length, 4);
	g_Assert.doesNotMatch(strScope, /namespace \{/);

	const OptionalChatRegion = GetNativeFunctionRegion(strBindings, "ReadMessagesOptionalChatArgument");
	const SayText2Region = GetNativeFunctionRegion(strBindings, "SendMessagesSayText2MessageCallback");
	const strChatGroup = strBindings.slice(OptionalChatRegion.Start, SayText2Region.End);
	g_Assert(strBindings.includes("#if defined(SOURCEJS_HAS_RECIPIENT_FILTER) && defined(SOURCEJS_USERMESSAGE_CAN_WRITE_SAYTEXT)\n" + strChatGroup + "\n#endif // bitbuffer-only chat helpers"), "Compile private chat helpers only in the configuration that exports them.");
	g_Assert.doesNotMatch(strChatGroup, /#if|#else|kNativeBitBufferSupportErrorMessage/);

	const strSend = GetNativeFunction(strBindings, "SendMessagesUserMessageCallback");
	const vecNameGuards = [...strSend.matchAll(/if \(strUserMessageName\.find\('\\0'\) != std::string::npos\) \{/g)];
	g_Assert.equal(vecNameGuards.length, 2, "Guard both bitbuffer and protobuf message names.");
	for (const vecGuard of vecNameGuards) {
		const nLookup = strSend.indexOf("RequireUserMessageType(", vecGuard.index);
		g_Assert(nLookup > vecGuard.index);
		g_Assert.match(strSend.slice(vecGuard.index, nLookup), /ThrowError\(pIsolate, kEmbeddedNullMessageNameErrorMessage\);\n\t+return;/);
	}

	g_Assert.doesNotMatch(strBindings, /\bGetMessagesRecipientFilterCallback\b/);
	g_Assert(strBindings.includes('#if defined(SOURCEJS_USERMESSAGE_CAN_WRITE_SAYTEXT)\n\t\tif (!SetFunction(pIsolate, LocalContext, LocalMessageHooksModule, "GetRecipientFilter", GetMessagesBitBufferRecipientFilterCallback, LocalRuntimeData)) {\n#else\n\t\tif (!SetFunction(pIsolate, LocalContext, LocalMessageHooksModule, "GetRecipientFilter", GetMessagesProtobufRecipientFilterCallback, LocalRuntimeData)) {\n#endif'));

	for (const strName of ["GetMessagesColorArrayComponent", "GetMessagesColorObjectComponent"]) {
		const strColor = GetNativeFunction(strBindings, strName);
		const nFrame = strColor.indexOf("v8::TryCatch ColorComponentFailure(pIsolate);");
		const nRead = strColor.indexOf(".ToLocal(&LocalColorComponentValue)");
		const nDefault = strColor.indexOf("nColorComponentOut = nDefaultColorComponentValue;");
		g_Assert((nFrame > 0) && (nRead > nFrame) && (nDefault > nRead));
		g_Assert(strColor.includes("!bHasColorComponent || ColorComponentFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()"));
		g_Assert(strColor.includes("bIsColorComponentRequired && !ColorComponentFailure.HasCaught() && !pIsolate->IsExecutionTerminating() && !pIsolate->HasPendingException()"));
		g_Assert.match(strColor, /ColorComponentFailure\.ReThrow\(\);\n\t+return false;\n\t+}/);
		g_Assert.match(strColor, /throw;\n\t+}\n\t+}\n\n\t+if \(IsValueNullish\(LocalColorComponentValue\)\)/);
		g_Assert(strColor.indexOf("GetMessagesColorComponentFromValue(") > nDefault);
	}

	const strDialog = GetNativeFunction(strBindings, "CreateMessagesDialogCallback");
	g_Assert(strDialog.includes("kMinimumCreateDialogArgumentCount = kDialogFieldsArgumentIndex + 1;"));
	g_Assert(strDialog.includes("CreateDialog(PlayerOrIndex, nDialogType, DialogFields, strDialogName?)"));
	const nFieldConversion = strDialog.indexOf("SetMessagesKeyValuesFromObject(");
	const nDialogDispatch = strDialog.indexOf("pDialogServerPluginHelpers->CreateMessage(");
	g_Assert((nFieldConversion >= 0) && (nDialogDispatch > nFieldConversion));
	for (const vecContract of [
		["CreateMessagesDialogCallback", "Dialog", "DIALOG_TYPE>(nDialogType)"],
		["ShowMenusTextCallback", "Menu", "DIALOG_TEXT"],
		["HideMenusTextCallback", "Menu", "DIALOG_TEXT"],
	]) {
		const strCallback = GetNativeFunction(strBindings, vecContract[0]);
		const strOwner = "p" + vecContract[1] + "KeyValues";
		const nOwner = strCallback.indexOf("SourceJSKeyValuesOwner " + strOwner + "(new KeyValues(");
		const nDispatch = strCallback.indexOf("->CreateMessage(");
		const nCleanup = strCallback.indexOf(strOwner + ".reset();");
		const nResult = strCallback.indexOf("CallbackInformation.GetReturnValue().Set(true)");
		g_Assert((nOwner >= 0) && (nDispatch > nOwner) && (nCleanup > nDispatch) && (nResult > nCleanup));
		g_Assert(strCallback.includes(strOwner + ".get(), &g_SourceJSPlugin)"));
		g_Assert(strCallback.includes(vecContract[2]));
		g_Assert.doesNotMatch(strCallback, /\.release\(\)/);
		g_Assert(strCallback.includes("(PlayerOrIndex"));
		g_Assert.doesNotMatch(strCallback, /\b(?:CreateDialog|ShowText|HideText)\((?!PlayerOrIndex|\))[^"]*\)/);

		if (vecContract[0] !== "CreateMessagesDialogCallback") {
			for (const strKey of ["title", "msg", "level", "time"]) {
				g_Assert(strCallback.includes('[] = "' + strKey + '";'), "Keep the native SDK wire key: " + strKey);
			}
		}
	}

	const strFields = GetNativeFunction(strBindings, "SetMessagesKeyValuesFromObject");
	const strFieldNameValidator = GetNativeFunction(strBindings, "IsValidMessagesKeyValuesFieldName");
	for (const strRequiredCheck of ["!strFieldName.empty()", "strFieldName.find('\\0') == std::string::npos", "strFieldName.find('/') == std::string::npos"]) {
		g_Assert(strFieldNameValidator.includes(strRequiredCheck), "Dialog field names reject empty, NUL and SDK path separators");
	}

	const nFieldNameGuard = strFields.indexOf("if (!IsValidMessagesKeyValuesFieldName(strFieldName))");
	g_Assert(nFieldNameGuard > strFields.indexOf("if (IsValueNullish(LocalFieldValue))"), "Nullish fields remain skipped before name validation");
	g_Assert((nFieldNameGuard >= 0) && (nFieldNameGuard < strFields.indexOf("pKeyValues->SetString(")) && (nFieldNameGuard < strFields.indexOf("pKeyValues->SetInt(")) && (nFieldNameGuard < strFields.indexOf("pKeyValues->FindKey(")), "Validate names before every SDK field dispatch");
	g_Assert.match(strFields, /if \(!IsValidMessagesKeyValuesFieldName\(strFieldName\)\) \{\n\t+ThrowError\(pIsolate, kInvalidDialogFieldNameErrorMessage\);\n\t+return false;\n\t+}/);

	g_Assert(strFields.includes("const std::size_t unNestedDepth = 0"));
	g_Assert(strFields.includes("kMaximumNestedDepth = 32;"));

	const nDepthGuard = strFields.indexOf("unNestedDepth > kMaximumNestedDepth");
	g_Assert((nDepthGuard >= 0) && (nDepthGuard < strFields.indexOf("GetOwnPropertyNames(")));
	g_Assert(strFields.includes("pNestedDialogKeyValues, LocalNestedDialogFieldsObject, unNestedDepth + 1)"));
	for (const strFrame of ["FieldEnumerationFailure", "FieldNameFailure", "FieldValueFailure"]) {
		g_Assert(strFields.includes("v8::TryCatch " + strFrame + "(pIsolate);"));
		g_Assert(strFields.includes("!" + strFrame + ".HasCaught() && !pIsolate->IsExecutionTerminating() && !pIsolate->HasPendingException()"));
		g_Assert.match(strFields, new RegExp(strFrame + "\\.ReThrow\\(\\);\\n\\t+return false;"));
	}

	g_Assert.match(strFields, /FieldValueFailure\.ReThrow\(\);\n\t+}\n\n\t+throw;\n\t+}\n\t+}\n\n\t+if \(IsValueNullish\(LocalFieldValue\)\)/);
	g_Assert.doesNotMatch(strFields, /!bHasFieldValue \|\| IsValueNullish/);

	const strSteamNumber = GetNativeFunction(strBindings, "GetSteamUInt32FromValue");
	g_Assert.match(strSteamNumber, /std::strtoull\([^\n]+\n\t+const int nSteamUInt32ParseError = errno;/);
	g_Assert(strSteamNumber.includes("nSteamUInt32ParseError == ERANGE"));
	g_Assert(strSteamNumber.includes("char* pszSteamUInt32ParseEnd = nullptr;"));
	g_Assert(strSteamNumber.includes("v8::TryCatch NumberFailure(pIsolate);"));
	g_Assert(strSteamNumber.includes("!NumberFailure.HasCaught() && !pIsolate->IsExecutionTerminating() && !pIsolate->HasPendingException()"));
	g_Assert.match(strSteamNumber, /NumberFailure\.ReThrow\(\);\n\t+return false;\n\t+}\n\n\t+dblSteamUInt32NumberValue = MaybeSteamUInt32NumberValue\.FromJust\(\);/);
	g_Assert.match(strSteamNumber, /dblSteamUInt32NumberValue = MaybeSteamUInt32NumberValue\.FromJust\(\);\n\t+} catch \(\.\.\.\) \{\n\t+if \(NumberFailure\.HasCaught\(\)\) \{\n\t+NumberFailure\.ReThrow\(\);\n\t+}\n\n\t+throw;\n\t+}\n\t+}\n\n\t+if \(!std::isfinite/);
	g_Assert.doesNotMatch(GetNativeFunction(strBindings, "MakeSteamUInt64").split("\n", 1)[0], /noexcept/);

	const strSteamMethod = GetNativeFunction(strBindings, "GetEngineServerClientSteamIDDirect");
	const vecCalls = [...strSteamMethod.matchAll(/auto const\* const pClientSteamID = pEngineServer->GetClientSteamID\(([^\n]+)\);\n\t+bClientSteamIDMethodAvailableOut = true;\n\t+return pClientSteamID;/g)];
	g_Assert.deepEqual(vecCalls.map(vecCallMatch => vecCallMatch[1]), ["pClientEdict, bValidatedOnly", "pClientEdict"]);

	const strReader = GetNativeFunction(strBindings, "ReadSDKMethodInstruction");
	g_Assert(strReader.includes("unByteCount > (kMaximumAddress - unMethodAddress)"));
	g_Assert(strReader.includes("ReadProcessMemory(GetCurrentProcess()"));
	g_Assert(strReader.includes("unReadByteCount != unByteCount"));
	g_Assert(strReader.indexOf("std::memcpy(arrInstructionOut") > strReader.indexOf("unReadByteCount != unByteCount"));

	const strDecoder = GetNativeFunction(strBindings, "GetSDKVirtualMethodIndex");
	g_Assert(strDecoder.includes("MemberAddressInformation.m_nThisOffset != 0"));
	g_Assert(strDecoder.includes("nByteOffset % kVTableEntryByteCount"));
	g_Assert(strDecoder.includes("nMethodIndex > kMaximumMethodIndex"));
	g_Assert(strDecoder.includes("sizeof(TMethod) == sizeof(std::uintptr_t)"));
	g_Assert(strDecoder.includes("-static_cast<std::int64_t>(nRelativeDisplacement)"));
	g_Assert(strDecoder.includes("unDisplacement > (kMaximumAddress - unMethodAddress)"));
	g_Assert(strDecoder.includes("unDisplacement > unMethodAddress"));
	g_Assert(strDecoder.includes("nByteOffset < 0"));
	g_Assert(strDecoder.includes("static_cast<std::size_t>(nByteOffset) % sizeof(void*)"));
	g_Assert.doesNotMatch(strDecoder, /pchMethodCode|5 \+ nRelativeDisplacement/);

	const strNumber = GetNativeFunction(strBindings, "GetMessagesNumberFromValue");
	const nFiniteGuard = strNumber.indexOf("if (!std::isfinite(dblNumber))");
	g_Assert((nFiniteGuard >= 0) && (strNumber.indexOf("dblNumberOut = dblNumber;") > nFiniteGuard));
	g_Assert.doesNotMatch(strNumber, /GetNumberArgument\([^\n]*dblNumberOut\)/);

	const strInformation = GetNativeFunction(strBindings, "GetUserMessageInformation");
	g_Assert.doesNotMatch(strInformation, /strUserMessageNameOut\.clear\(\)|nUserMessageSizeOut = 0/);
	g_Assert(strInformation.includes("std::memchr(szUserMessageName, 0, sizeof(szUserMessageName))"));
	g_Assert(strInformation.includes("nUserMessageSizeOut = nUserMessageSize;"));
	g_Assert(GetNativeFunction(strBindings, "FindUserMessageType").includes("std::memchr(szCandidateMessageName, 0, sizeof(szCandidateMessageName))"));
}

function RejectMutation(strName, strOriginal, strReplacement) {
	const strFunction = GetNativeFunction(g_strBindings, strName);
	g_Assert(strFunction.includes(strOriginal), "Mutation must match: " + strName);

	const strChanged = strFunction.replace(strOriginal, () => strReplacement);
	g_Assert.notEqual(strChanged, strFunction);

	const strChangedBindings = ReplaceNativeFunction(g_strBindings, strName, strChanged);
	g_Assert.notEqual(strChangedBindings, g_strBindings, "Mutation must affect the actual source region.");
	g_Assert.throws(() => VerifySourceContracts(strChangedBindings), g_Assert.AssertionError, strName + ": " + strOriginal);
	++g_unRejectedMutations;
}

function WriteGeneratedFile(strName, strContent) {
	const strPath = g_Path.join(g_strFixtureDirectory, strName);
	const ExistingFile = g_FileSystem.lstatSync(strPath, { throwIfNoEntry: false });
	if (ExistingFile) {
		g_Assert(ExistingFile.isFile(), "Refuse to overwrite a linked or non-file fixture: " + GetDisplayPath(strPath));

		const strPrevious = g_FileSystem.readFileSync(strPath, "utf8");
		const vecPreviousLines = strPrevious.split(/\r?\n/);
		g_Assert(vecPreviousLines.includes("// " + g_strOwnerMarker) || vecPreviousLines.includes("# " + g_strOwnerMarker), "Refuse to overwrite a non-owned fixture: " + GetDisplayPath(strPath));

		if (strPrevious === strContent) {
			return;
		}
	}

	g_FileSystem.writeFileSync(strPath, strContent);
}

function Run(strCommand, vecArguments) {
	const Result = g_ChildProcess.spawnSync(strCommand, vecArguments, { cwd: g_strRootPath, encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
	g_Assert.ifError(Result.error);
	g_Assert.equal(Result.signal, null, GetDisplayPath(strCommand) + ": unexpected signal.");
	g_Assert.equal(Result.status, 0, GetDisplayPath(strCommand) + " failed:\n" + Result.stdout + Result.stderr);
	g_Assert.doesNotMatch(Result.stdout + Result.stderr, /\bwarning(?:\s+[A-Z]+\d+)?\s*:/i, GetDisplayPath(strCommand) + ": unexpected warning.");

	return Result.stdout;
}

function CheckProgramCLI(strProgram) {
	const Result = g_ChildProcess.spawnSync(strProgram, ["--invalid"], { cwd: g_strRootPath, encoding: "utf8", windowsHide: true, timeout: g_unCommandTimeoutMilliseconds });
	g_Assert.ifError(Result.error);
	g_Assert.equal(Result.signal, null);
	g_Assert.equal(Result.status, 2, "Reject invalid native fixture arguments before decoding methods.");
	g_Assert.equal(Result.stdout, "");
	g_Assert.equal(Result.stderr.trim(), "Usage: MessageMethodIndex");
}

VerifySourceContracts(g_strBindings);

for (const strName of ["GetSDKVirtualMethodIndex", "GetMessagesMessageSizeCallback", "RequireMessagePlayerEdict"]) {
	g_Assert.equal(ReplaceNativeFunction(g_strBindings, strName, GetNativeFunction(g_strBindings, strName)), g_strBindings, "Native source extraction must round-trip: " + strName);
}

for (const vecContract of g_vecCallbackContracts) {
	RejectMutation(vecContract[0], "\n\t\ttry {\n", "\n\t\t{\n");
	RejectMutation(vecContract[0], "catch (...) {", "catch (int) {");
	RejectMutation(vecContract[0], '"' + vecContract[1] + ' failed with a native C++ exception."', '"Wrong operation."');
}

for (const vecContract of g_vecInstallationFunctions) {
	RejectMutation(vecContract[0], "v8::TryCatch InstallationFailure(pIsolate);", "v8::TryCatch WrongFrame(pIsolate);");
	RejectMutation(vecContract[0], "RethrowV8InstallationFailure(pIsolate, InstallationFailure, " + vecContract[1] + ");", "RethrowV8InstallationFailure(pIsolate, InstallationFailure, kUnexpectedError);");
	RejectMutation(vecContract[0], "LocalContext.IsEmpty()", "false");
}

for (const vecContract of g_vecNativeUnwindContracts) {
	const strFrame = vecContract[1];
	const Pattern = new RegExp("if \\(" + strFrame + "\\.HasCaught\\(\\)\\) \\{\\n\\t+" + strFrame + "\\.ReThrow\\(\\);\\n\\t+}\\n\\n\\t+throw;");
	const vecGuardMatches = Pattern.exec(GetNativeFunction(g_strBindings, vecContract[0]));
	g_Assert(vecGuardMatches, "Locate the native-unwind guard mutation: " + vecContract[0]);
	RejectMutation(vecContract[0], vecGuardMatches[0], "throw;");
}

RejectMutation("GetMessagesObjectValue", "v8::TryCatch PropertyFailure(pIsolate);", "v8::TryCatch WrongFrame(pIsolate);");
RejectMutation("GetMessagesObjectValue", "!PropertyFailure.HasCaught()", "true");
RejectMutation("GetMessagesObjectValue", "PropertyFailure.ReThrow();", "PropertyFailure.Reset();");
RejectMutation("WriteUserMessageField", "GetMessagesObjectValue(", "GetObjectValue(");
RejectMutation("GetMessagesProtobufMessageFromData", "if (!pProtobufMessage)", "if (false)");
RejectMutation("ValidateMessagesProtobufRepeatedIndex", "nRepeatedFieldIndex < 0", "false");
RejectMutation("ValidateMessagesProtobufRepeatedIndex", "nRepeatedFieldIndex >= nRepeatedFieldCount", "false");
RejectMutation("ValidateMessagesProtobufRepeatedIndex", "ThrowError(pIsolate, kRepeatedFieldIndexRangeErrorMessage);", "");
RejectMutation("RequireMessagesProtobufRepeatedIndex", "!ValidateMessagesProtobufRepeatedIndex(pIsolate, pMessage, pFieldDescriptor, nRepeatedFieldIndex)", "false");
RejectMutation("RequireMessagesProtobufRepeatedIndex", "nRepeatedFieldIndexOut = nRepeatedFieldIndex;", "");
RejectMutation("RequireMessagesProtobufField", "CppType const ExpectedFieldType", "CppType const nExpectedFieldType");
RejectMutation("WriteUserMessageFloat", "std::numeric_limits<float>::is_iec559", "true");

RejectMutation("GetMessagesObjectString", "GetMessagesObjectValue(", "GetObjectValue(");
RejectMutation("GetMessagesObjectString", "if (!LocalValue->IsString())", "if (false)");
RejectMutation("GetMessagesObjectString", "strValueOut = ValueToString(pIsolate, LocalValue);", "");
RejectMutation("WriteMessagesProtobufField", "GetMessagesObjectString(", "GetObjectString(");
RejectMutation("WriteMessagesProtobufField", "GetMessagesObjectValue(", "GetObjectValue(");
RejectMutation("HandleMessagesProtobufMethodCallback", "v8::TryCatch ParseFailure(pIsolate);", "v8::TryCatch WrongFrame(pIsolate);");
RejectMutation("HandleMessagesProtobufMethodCallback", "!ParseFailure.HasCaught()", "true");
RejectMutation("HandleMessagesProtobufMethodCallback", "ParseFailure.ReThrow();", "ParseFailure.Reset();");
RejectMutation("HandleMessagesProtobufMethodCallback", "vecSerializedProtobufBytes.size() > kMaximumProtobufParseByteCount", "false");

RejectMutation("RequireMessagePlayerEdict", "*pnPlayerIndexOut = nPlayerIndex;", "");
RejectMutation("RequireMessagePlayerEdict", "PlayerIndexFailure.HasCaught()", "false");
RejectMutation("RequireMessagePlayerEdict", "pPlayerEdict->IsFree()", "false");
RejectMutation("SetMessagesKeyValuesFromObject", "unNestedDepth > kMaximumNestedDepth", "false");
RejectMutation("SetMessagesKeyValuesFromObject", "!IsValidMessagesKeyValuesFieldName(strFieldName)", "false");
for (const strRequiredCheck of ["!strFieldName.empty()", "strFieldName.find('\\0') == std::string::npos", "strFieldName.find('/') == std::string::npos"]) {
	RejectMutation("IsValidMessagesKeyValuesFieldName", strRequiredCheck, "true");
}

RejectMutation("SetMessagesKeyValuesFromObject", "unNestedDepth + 1)", "unNestedDepth)");
for (const strFrame of ["FieldEnumerationFailure", "FieldNameFailure", "FieldValueFailure"]) {
	RejectMutation("SetMessagesKeyValuesFromObject", "v8::TryCatch " + strFrame + "(pIsolate);", "v8::TryCatch WrongFrame(pIsolate);");
	RejectMutation("SetMessagesKeyValuesFromObject", "!" + strFrame + ".HasCaught()", "true");
	RejectMutation("SetMessagesKeyValuesFromObject", strFrame + ".ReThrow();", strFrame + ".Reset();");
}

RejectMutation("CreateMessagesDialogCallback", "kDialogFieldsArgumentIndex + 1;", "4;");
RejectMutation("CreateMessagesDialogCallback", "SetMessagesKeyValuesFromObject(", "SkipMessagesKeyValuesConversion(");
for (const vecContract of [["CreateMessagesDialogCallback", "Dialog"], ["ShowMenusTextCallback", "Menu"], ["HideMenusTextCallback", "Menu"]]) {
	RejectMutation(vecContract[0], "SourceJSKeyValuesOwner p" + vecContract[1] + "KeyValues", "KeyValues* p" + vecContract[1] + "KeyValues");
	RejectMutation(vecContract[0], "p" + vecContract[1] + "KeyValues.reset();", "");
	RejectMutation(vecContract[0], "(PlayerOrIndex", "(playerIndex");
}

RejectMutation("GetSteamUInt32FromValue", "const int nSteamUInt32ParseError = errno;", "const int nSteamUInt32ParseError = 0;");
RejectMutation("GetSteamUInt32FromValue", "nSteamUInt32ParseError == ERANGE", "false");
RejectMutation("GetSteamUInt32FromValue", "v8::TryCatch NumberFailure(pIsolate);", "v8::TryCatch WrongFrame(pIsolate);");
RejectMutation("GetSteamUInt32FromValue", "NumberFailure.ReThrow();", "NumberFailure.Reset();");
RejectMutation("MakeSteamUInt64", "unSteamUInt64Value) {", "unSteamUInt64Value) noexcept {");
RejectMutation("GetEngineServerClientSteamIDDirect", "bClientSteamIDMethodAvailableOut = true;\n\t\t\treturn pClientSteamID;", "return pClientSteamID;");
for (const strName of ["SendMessagesSayTextMessageCallback", "SendMessagesSayText2MessageCallback"]) {
	RejectMutation(strName, ", &nPlayerIndex)", ")");
	RejectMutation(strName, "v8::TryCatch SenderIndexFailure(pIsolate);", "v8::TryCatch WrongFrame(pIsolate);");
	RejectMutation(strName, "SenderIndexFailure.ReThrow();", "SenderIndexFailure.Reset();");
}

for (const strName of ["SendMessagesUserMessageCallback", "SendMessagesSayTextMessageCallback", "SendMessagesSayText2MessageCallback"]) {
	RejectMutation(strName, "SourceJSUserMessageScope UserMessageScope(pEngineServer);", "");
	RejectMutation(strName, "UserMessageScope.EndUserMessage();", "pEngineServer->MessageEnd();");

	const strFunction = GetNativeFunction(g_strBindings, strName);
	RejectMutation(strName, strFunction, strFunction.replaceAll("WriteUserMessage", "SkipUserMessage"));
}

RejectMutation("SendMessagesSayText2MessageCallback", "kSayText2ParameterCount = 4;", "kSayText2ParameterCount = 3;");
RejectMutation("SendMessagesSayText2MessageCallback", "std::size_t unParameterIndex = 0;", "std::size_t unParameterIndex = 1;");
RejectMutation("SendMessagesSayText2MessageCallback", "bSayText2WriteSucceeded && (unParameterIndex < kSayText2ParameterCount)", "unParameterIndex < kSayText2ParameterCount");
RejectMutation("SendMessagesSayText2MessageCallback", 'WriteUserMessageString(pBitBuffer, "");', "WriteUserMessageByte(pBitBuffer, 0);");
RejectMutation("SendMessagesSayText2MessageCallback", "WriteUserMessageString(pBitBuffer, strMessageText)", 'WriteUserMessageString(pBitBuffer, "")');

for (const strName of ["GetMessagesColorArrayComponent", "GetMessagesColorObjectComponent"]) {
	RejectMutation(strName, "v8::TryCatch ColorComponentFailure(pIsolate);", "v8::TryCatch WrongFrame(pIsolate);");
	RejectMutation(strName, "ColorComponentFailure.ReThrow();", "ColorComponentFailure.Reset();");
	RejectMutation(strName, "ColorComponentFailure.HasCaught()", "false");
	RejectMutation(strName, "if (IsValueNullish(LocalColorComponentValue))", "if (!bHasColorComponent || IsValueNullish(LocalColorComponentValue))");
}

for (const vecMutation of [
	["m_pEngineServer = nullptr;\n\t\t\tpEngineServer->MessageEnd();", "pEngineServer->MessageEnd();\n\t\t\tm_pEngineServer = nullptr;"],
	["~SourceJSUserMessageScope() noexcept {\n\t\t\ttry {", "~SourceJSUserMessageScope() noexcept {\n\t\t\t{"],
	['"GetRecipientFilter", GetMessagesBitBufferRecipientFilterCallback', '"GetRecipientFilter", GetMessagesRecipientFilterCallback'],
	['"GetRecipientFilter", GetMessagesProtobufRecipientFilterCallback', '"GetRecipientFilter", GetMessagesRecipientFilterCallback'],
]) {
	g_Assert(g_strBindings.includes(vecMutation[0]), "Mutation must match.");
	g_Assert.throws(() => VerifySourceContracts(g_strBindings.replace(vecMutation[0], () => vecMutation[1])), g_Assert.AssertionError);
	++g_unRejectedMutations;
}

for (const strExpression of ["unDisplacement > (kMaximumAddress - unMethodAddress)", "unDisplacement > unMethodAddress", "MemberAddressInformation.m_nThisOffset != 0", "nMethodIndex > kMaximumMethodIndex", "nByteOffset < 0"]) {
	RejectMutation("GetSDKVirtualMethodIndex", strExpression, "false");
}

RejectMutation("ReadSDKMethodInstruction", "unReadByteCount != unByteCount", "false");
RejectMutation("GetMessagesNumberFromValue", "dblNumberOut = dblNumber;", "");
RejectMutation("GetMessagesNumberFromValue", "if (!std::isfinite(dblNumber))", "if (false)");
RejectMutation("GetMessagesMessageIndexCallback", "strUserMessageName.find('\\0') != std::string::npos", "false");
RejectMutation("GetMessagesMessageIndexCallback", "ValueToString(", "SkipStringConversion(");
RejectMutation("SendMessagesUserMessageCallback", "strUserMessageName.find('\\0') != std::string::npos", "false");
RejectMutation("GetUserMessageInformation", "std::memchr(szUserMessageName, 0, sizeof(szUserMessageName))", "true");

const g_strReader = GetNativeFunction(g_strBindings, "ReadSDKMethodInstruction");
const g_strDecoder = GetNativeFunction(g_strBindings, "GetSDKVirtualMethodIndex");
const g_strMessageBeginSignature = GetNativeFunction(g_strBindings, "UserMessageBeginHasName");
const g_strBeginMessage = GetNativeFunction(g_strBindings, "BeginUserMessage");
const g_strDefinitionSHA256 = g_Crypto.createHash("sha256").update(g_strReader + g_strDecoder + g_strMessageBeginSignature + g_strBeginMessage).digest("hex").toUpperCase();
const g_strSDKKey = g_strSDKRootPath ? ("-sdk-" + g_Crypto.createHash("sha256").update(g_strSDKRootPath).digest("hex").slice(0, 12).toUpperCase()) : "";
const g_strBuildDirectory = g_Path.join(g_strFixtureDirectory, process.platform + "-" + g_strArchitecture + g_strSDKKey);
const g_vecHeaderLines = [
	"#pragma once",
	"",
	"// General",
	"#if defined(_WIN32)",
	"#include <Windows.h>",
	"#endif",
	"",
	"// C++",
	"#include <cstddef>",
	"#include <cstdint>",
	"#include <cstring>",
	"",
	"// STL",
	"#include <limits>",
	"#include <type_traits>",
	"",
	"// " + g_strOwnerMarker,
	"// DefinitionSHA256=" + g_strDefinitionSHA256,
	"",
	"class bf_write;",
	"class IRecipientFilter;",
	"",
	"namespace NativeMessageMethodIndex {",
	"#if defined(_WIN32)",
	"\ttemplate <std::size_t unByteCount>",
	g_strReader,
	"#endif",
	"",
	"\ttemplate <typename TMethod>",
	g_strDecoder,
	"",
	"\ttemplate <typename TEngineServer>",
	g_strMessageBeginSignature,
	"",
	"\ttemplate <typename TEngineServer>",
	g_strBeginMessage,
	"} // namespace NativeMessageMethodIndex",
	"",
];
const g_vecCMakeLines = [
	"cmake_minimum_required(VERSION 3.24)",
	"project(NativeMessageMethodIndex LANGUAGES CXX)",
	"",
	"# " + g_strOwnerMarker,
	'add_executable(MessageMethodIndex "${SOURCEJS_FIXTURE_SOURCE}")',
	'target_include_directories(MessageMethodIndex PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")',
	"target_compile_features(MessageMethodIndex PRIVATE cxx_std_20)",
	"set_target_properties(MessageMethodIndex PROPERTIES CXX_EXTENSIONS OFF)",
	"if(MSVC)",
	"\ttarget_compile_options(MessageMethodIndex PRIVATE /W4 /WX /utf-8)",
	"\ttarget_compile_definitions(MessageMethodIndex PRIVATE NOMINMAX WIN32_LEAN_AND_MEAN)",
	"else()",
	"\ttarget_compile_options(MessageMethodIndex PRIVATE -Wall -Wextra -Wpedantic -Werror)",
	"\ttarget_compile_options(MessageMethodIndex PRIVATE -fsanitize=undefined -fno-sanitize-recover=undefined)",
	"\ttarget_link_options(MessageMethodIndex PRIVATE -fsanitize=undefined -fno-sanitize-recover=undefined)",
	"endif()",
	"if(SOURCEJS_SDK_ROOT)",
	"\ttarget_compile_definitions(MessageMethodIndex PRIVATE SOURCEJS_NATIVE_FIXTURE_WITH_SDK)",
	"\tif(CMAKE_SIZEOF_VOID_P EQUAL 8)",
	"\t\ttarget_compile_definitions(MessageMethodIndex PRIVATE X64BITS PLATFORM_64BITS)",
	"\tendif()",
	'\ttarget_include_directories(MessageMethodIndex SYSTEM PRIVATE "${SOURCEJS_SDK_ROOT}/public" "${SOURCEJS_SDK_ROOT}/public/tier0" "${SOURCEJS_SDK_ROOT}/public/tier1")',
	"\tif(WIN32)",
	"\t\ttarget_compile_definitions(MessageMethodIndex PRIVATE WIN32 _WINDOWS COMPILER_MSVC)",
	"\t\tif(CMAKE_SIZEOF_VOID_P EQUAL 4)",
	"\t\t\ttarget_compile_definitions(MessageMethodIndex PRIVATE COMPILER_MSVC32)",
	"\t\telse()",
	"\t\t\ttarget_compile_definitions(MessageMethodIndex PRIVATE COMPILER_MSVC64)",
	"\t\tendif()",
	"\telse()",
	"\t\t# Match the project's POSIX SDK compatibility spellings and prerequisite declarations.",
	"\t\ttarget_compile_definitions(MessageMethodIndex PRIVATE POSIX _LINUX LINUX GNUC COMPILER_GCC stricmp=strcasecmp strnicmp=strncasecmp strcmpi=strcasecmp _stricmp=strcasecmp _strnicmp=strncasecmp _snprintf=snprintf _vsnprintf=vsnprintf)",
	'\t\ttarget_compile_options(MessageMethodIndex PRIVATE "SHELL:-include strings.h" "SHELL:-include stdio.h")',
	"\t\t# This header-only ABI probe never uses ConVar services; discard unused SDK vtables and their dependencies.",
	"\t\ttarget_compile_options(MessageMethodIndex PRIVATE -ffunction-sections -fdata-sections)",
	'\t\ttarget_link_options(MessageMethodIndex PRIVATE "LINKER:--gc-sections")',
	"\tendif()",
	"endif()",
	"",
];

g_FileSystem.mkdirSync(g_strFixtureDirectory, { recursive: true });
g_Assert(!g_FileSystem.lstatSync(g_strFixtureDirectory).isSymbolicLink(), "Refuse a linked generated fixture directory: " + GetDisplayPath(g_strFixtureDirectory));
WriteGeneratedFile("MessageMethodIndex.h", g_vecHeaderLines.join("\n"));
WriteGeneratedFile("CMakeLists.txt", g_vecCMakeLines.join("\n"));

const g_vecConfigureArguments = ["-S", g_strFixtureDirectory, "-B", g_strBuildDirectory, "-DCMAKE_BUILD_TYPE=Release", "-DSOURCEJS_FIXTURE_SOURCE=" + g_Path.join(g_strRootPath, "tools", "fixtures", "MessageMethodIndex.cpp"), "-DSOURCEJS_SDK_ROOT=" + g_strSDKRootPath];
if (process.platform === "win32") {
	g_vecConfigureArguments.push("-G", "Visual Studio 17 2022", "-A", (g_strArchitecture === "x86") ? "Win32" : "x64");

} else {
	g_vecConfigureArguments.push((g_strArchitecture === "x86") ? "-DCMAKE_CXX_FLAGS=-m32" : "-DCMAKE_CXX_FLAGS=-m64");
}

Run("cmake", g_vecConfigureArguments);
Run("cmake", ["--build", g_strBuildDirectory, "--config", "Release", "--parallel", "2"]);

const g_strBinaryDirectory = (process.platform === "win32") ? g_Path.join(g_strBuildDirectory, "Release") : g_strBuildDirectory;
const g_strBinaryName = (process.platform === "win32") ? "MessageMethodIndex.exe" : "MessageMethodIndex";
const g_strProgramPath = g_Path.join(g_strBinaryDirectory, g_strBinaryName);
const g_strFixtureOutput = Run(g_strProgramPath, []);
g_Assert.equal(g_strFixtureOutput.trim(), "native message-method index fixture PASS Architecture=" + g_strArchitecture + " SDK=" + (g_strSDKRootPath ? "selected-header" : "compiler-only"));
CheckProgramCLI(g_strProgramPath);
process.stdout.write(g_strFixtureOutput);
console.log("message hook native source contracts PASS; rejected mutations=" + g_unRejectedMutations + "; DefinitionSHA256=" + g_strDefinitionSHA256);
