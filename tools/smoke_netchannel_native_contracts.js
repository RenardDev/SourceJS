#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

if (process.argv.length > 2) {
	const bHelpRequested = (process.argv.length === 3) && ((process.argv[2] === "--help") || (process.argv[2] === "-h"));
	console[bHelpRequested ? "log" : "error"]("Usage: node tools/smoke_netchannel_native_contracts.js");
	process.exit(bHelpRequested ? 0 : 2);
}

const g_strSource = g_FileSystem.readFileSync(g_Path.join(__dirname, "..", "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_vecArgumentNames = [
	"RequireNetChannelPlayerIndexFromValue",
	"RequireNetChannelInformationFromFirstArgument",
	"GetOptionalNetChannelFlowArgument",
	"GetOptionalNetChannelFrameNumberArgument",
	"RequireNetChannelTransferIDArgument",
	"GetOptionalNetChannelBooleanArgument",
];

const g_vecFlowPropertyNames = ["Outgoing", "Incoming", "InOut"];
const g_vecBufferArgumentNames = [
	"RequireNetChannelFromFirstArgument",
	"RequireNetMessageFromFirstArgument",
	"GetOptionalNetChannelIntegerProperty",
	"ResolveNetChannelBufferDataValue",
	"GetNetChannelBufferBytes",
];

const g_vecCallbackNames = [
	"SendPlayerConVarValueCallback",
	"GetNetChannelInformationCallback",
	"GetEngineServerPlayerNetworkChannelInformationCallback",
	"GetRequiredNetChannelInformationCallback",
	"GetRequiredNetChannelInformationFromAddressCallback",
	"GetNetChannelTimeoutSecondsCallback",
	"GetNetChannelRemoteFrameRateCallback",
	"GetNetChannelAddressCallback",
	"GetNetChannelMessageHandlerAddressCallback",
	"SetNetChannelDataRateCallback",
	"SendNetChannelFileCallback",
	"DenyNetChannelFileCallback",
	"RequestNetChannelFileCallback",
	"SendNetChannelDataCallback",
	"ProcessNetChannelMessageCallback",
	"ReadNetChannelMessageFromBufferCallback",
	"WriteNetChannelMessageToBufferCallback",
	"IsNetChannelMessageReliableCallback",
	"SetNetChannelMessageReliableCallback",
	"GetNetChannelMessageTypeCallback",
	"GetNetChannelMessageGroupCallback",
	"GetNetChannelMessageNameCallback",
	"GetNetChannelMessageChannelCallback",
	"SetNetChannelMessageChannelCallback",
	"GetNetChannelMessageStringCallback",
	"IsNetChannelPacketValidCallback",
	"GetNetChannelPacketTimeCallback",
	"GetNetChannelPacketBytesCallback",
	"GetNetChannelTotalPacketsCallback",
	"GetNetChannelStreamProgressCallback",
	"GetNetChannelCommandInterpolationAmountCallback",
	"GetNetChannelPacketResponseLatencyCallback",
];

const g_vecPropertyCallbackNames = ["GetNetChannelInformationPropertyCallback", "SetNetChannelInformationPropertyCallback"];
const g_vecBoundaryDefinitions = [
	...g_vecBufferArgumentNames.map(strName => ({ Name: strName, Frame: "NetChannelArgumentReadFailure", Error: "kNetChannelArgumentReadErrorMessage" })),
	...g_vecCallbackNames.map(strName => ({ Name: strName, Frame: "NetChannelOperationFailure", Error: "kNetChannelCallbackErrorMessage" })),
	...g_vecPropertyCallbackNames.map(strName => ({ Name: strName, Frame: "NetChannelPropertyOperationFailure", Error: "kNetChannelPropertyOperationErrorMessage" })),
	{ Name: "GetNetChannelInformationFromPropertyReceiver", Frame: "NetChannelReceiverReadFailure", Error: "kNetChannelReceiverReadErrorMessage" },
	{ Name: "MakeNetChannelInformationObject", Frame: "NetChannelObjectConstructionFailure", Error: "kNetChannelObjectConstructionErrorMessage" },
	{ Name: "MakeMemoryAddressValue", Frame: "MemoryAddressConstructionFailure", Error: "kMemoryAddressConstructionErrorMessage" },
	{ Name: "RequireMemoryUnsignedIntegerFromValue", Frame: "MemoryIntegerConversionFailure", Error: "pszArgumentErrorMessage" },
];

function GetDefinitionRegion(strSource, strName) {
	const vecDefinitionMatches = new RegExp("^(\\t{1,2})(?:bool|void|INetChannelInfo\\*|INetChannel\\*|INetMessage\\*|v8::Local<v8::(?:Object|BigInt)>) " + strName + "\\([^\\n]*\\)(?: noexcept)? \\{$", "m").exec(strSource);
	g_Assert(vecDefinitionMatches, "Missing native definition: " + strName);

	const strClosingLine = "\n" + vecDefinitionMatches[1] + "}";
	const nDefinitionEnd = strSource.indexOf(strClosingLine, vecDefinitionMatches.index);
	g_Assert(nDefinitionEnd > vecDefinitionMatches.index, "Missing native definition end: " + strName);

	return { Start: vecDefinitionMatches.index, End: nDefinitionEnd + strClosingLine.length, Indentation: vecDefinitionMatches[1] };
}

function GetDefinition(strSource, strName) {
	const Region = GetDefinitionRegion(strSource, strName);

	// Normalize the contract view, never the source targeted by a regression control.
	return strSource.slice(Region.Start, Region.End).split("\n").map(strLine => strLine.startsWith(Region.Indentation) ? ("\t" + strLine.slice(Region.Indentation.length)) : strLine).join("\n");
}

function ReplaceDefinition(strSource, strName, strBody) {
	const Region = GetDefinitionRegion(strSource, strName);
	const strReplacement = strBody.split("\n").map(strLine => strLine.startsWith("\t") ? (Region.Indentation + strLine.slice(1)) : strLine).join("\n");

	return strSource.slice(0, Region.Start) + strReplacement + strSource.slice(Region.End);
}

function CheckBoundary(strSource, Definition) {
	const strDefinition = GetDefinition(strSource, Definition.Name);
	const strRethrow = "RethrowV8InstallationFailure(pIsolate, " + Definition.Frame + ", ";
	g_Assert(strDefinition.includes("v8::TryCatch " + Definition.Frame + "(pIsolate);\n\t\ttry {"), Definition.Name + ": V8 frame must survive C++ unwinding.");

	for (const strCatchType of ["std::exception const&", "..."]) {
		g_Assert(strDefinition.includes("} catch (" + strCatchType + ") {\n\t\t\t" + strRethrow + Definition.Error + ");"), Definition.Name + ": contextual C++ exception translation.");
	}

	for (const vecDiagnostic of strDefinition.matchAll(/^(\t+)ThrowError\([^\n]+\);\n([^\n]*)/gm)) {
		g_Assert(vecDiagnostic[2].includes(strRethrow), Definition.Name + ": diagnostics must not be swallowed.");
	}

	for (const vecGuard of strDefinition.matchAll(/^(\t{3})if \([^\n]+\) \{\n((?:\1\t[^\n]*\n)+)\1\}/gm)) {
		if (/return (?:false|nullptr|\{\});|return;/.test(vecGuard[0])) {
			g_Assert(vecGuard[0].includes(strRethrow), Definition.Name + ": preserve guarded failures.");

			if (!vecGuard[0].includes("return true;")) {
				g_Assert(!/\w+Out =/.test(vecGuard[0]), Definition.Name + ": no output commit on failure.");
			}
		}
	}
}

function CheckContracts(strSource) {
	for (const strName of g_vecArgumentNames) {
		const strDefinition = GetDefinition(strSource, strName);
		g_Assert(strDefinition.includes("v8::TryCatch NetChannelArgumentReadFailure(pIsolate);\n\t\ttry {"), strName + ": V8 frame must survive C++ unwinding.");

		for (const strCatchType of ["std::exception const&", "..."]) {
			g_Assert(strDefinition.includes("} catch (" + strCatchType + ") {\n\t\t\tRethrowV8InstallationFailure(pIsolate, NetChannelArgumentReadFailure, kNetChannelArgumentReadErrorMessage);"), strName + ": contextual C++ exception translation.");
		}

		for (const vecDiagnostic of strDefinition.matchAll(/^(\t+)ThrowError\([^\n]+\);\n([^\n]*)/gm)) {
			g_Assert(vecDiagnostic[2].includes("RethrowV8InstallationFailure(pIsolate, NetChannelArgumentReadFailure, kNetChannelArgumentReadErrorMessage);"), strName + ": diagnostics must not be swallowed by the local V8 frame.");
		}

		for (const vecGuard of strDefinition.matchAll(/^(\t{3})if \([^\n]+\) \{\n((?:\1\t[^\n]*\n)+)\1\}/gm)) {
			if (vecGuard[0].includes("return false;") || vecGuard[0].includes("return nullptr;")) {
				g_Assert(vecGuard[0].includes("RethrowV8InstallationFailure("), strName + ": preserve argument failures.");
				g_Assert(!/\w+Out =/.test(vecGuard[0]), strName + ": no output commit on failure.");
			}
		}
	}

	const strConstants = GetDefinition(strSource, "GetNetChannelFlowConstantsCallback");
	g_Assert(strConstants.includes("v8::TryCatch NetChannelFlowConstantsFailure(pIsolate);\n\t\ttry {"));

	for (const strCatchType of ["std::exception const&", "..."]) {
		g_Assert(strConstants.includes("} catch (" + strCatchType + ") {\n\t\t\tRethrowV8InstallationFailure(pIsolate, NetChannelFlowConstantsFailure, kNetChannelFlowConstantsErrorMessage);"));
	}

	for (const strProperty of g_vecFlowPropertyNames) {
		g_Assert(strConstants.includes('SetRecordProperty(pIsolate, LocalContext, LocalNetChannelFlowConstants, "' + strProperty + '", v8::Integer::New('), "Flow constants must bypass inherited setters.");
	}

	g_Assert.doesNotMatch(GetDefinition(strSource, "GetNetChannelInformationFromPlayerIndex"), /\) noexcept \{/, "An external virtual call has no non-throwing SDK contract.");

	for (const Definition of g_vecBoundaryDefinitions) {
		CheckBoundary(strSource, Definition);
	}

	const strConVar = GetDefinition(strSource, "SendPlayerConVarValueCallback");
	for (const strConversion of ["GetValueIndex", "ValueToString(pIsolate, LocalConVarName)", "ValueToString(pIsolate, LocalConVarValue)"]) {
		const nConversion = strConVar.indexOf(strConversion);
		g_Assert(nConversion >= 0);

		const strAfterConversion = strConVar.slice(strConVar.indexOf("\n", nConversion));
		g_Assert(strAfterConversion.startsWith("\n\t\t\tif (NetChannelOperationFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()) {"), "Failed ConVar conversion must stop before the next conversion or native call.");
	}

	g_Assert(strConVar.includes("alignas(std::uint32_t) char arrConVarMessageBytes[kConVarMessageBufferSize] {};"));
	g_Assert(strConVar.includes("static_assert((kConVarMessageBufferSize % sizeof(std::uint32_t)) == 0,"));
	g_Assert(strConVar.indexOf("if (ConVarMessageWriter.IsOverflowed())") < strConVar.indexOf("pNetChannel->SendData("));
	g_Assert(strConVar.includes("if (ConVarMessageWriter.IsOverflowed())"), "Overflowed messages must not be sent.");
	g_Assert.doesNotMatch(strConVar, /constexpr std::size_t kConVarMessageBufferSize = (?!256;)\d+/);

	const strProperty = GetDefinition(strSource, "GetNetChannelInformationPropertyCallback");
	g_Assert(strProperty.includes("GetNetChannelInformationFromPropertyReceiver(CallbackInformation);\n\t\t\tif (NetChannelPropertyOperationFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()) {"), "A receiver getter exception must survive instead of being replaced by an invalid-address error.");

	for (const strName of g_vecPropertyCallbackNames) {
		g_Assert(GetDefinition(strSource, strName).includes("valid BigInt address."));
	}

	const strSetter = GetDefinition(strSource, "SetNetChannelInformationPropertyCallback");
	const nConversion = strSetter.indexOf("GetFloatArgument(pIsolate, LocalContext, LocalPropertyValue,");
	const nAddressRead = strSetter.indexOf("LocalReceiver->Get(LocalContext,");
	const nAddressResolution = strSetter.indexOf("GetNetChannelInformationFromValue(LocalNetChannelAddressValue)");
	const nNativeWrite = strSetter.indexOf("pNetChannel->SetDataRate(flDataRate)");
	g_Assert((nConversion >= 0) && (nAddressRead > nConversion) && (nAddressResolution > nAddressRead) && (nNativeWrite > nAddressResolution), "DataRate conversion may reenter JavaScript; resolve the receiver address afterwards.");

	for (const Contract of [
		{ Name: "GetNetChannelFromValue", Constant: "kNullNetChannelAddress" },
		{ Name: "GetNetMessageFromValue", Constant: "kNullNetMessageAddress" },
	]) {
		g_Assert(GetDefinition(strSource, Contract.Name).includes("constexpr std::uintptr_t " + Contract.Constant + " = 0x0;"));
	}

	const strBuffer = GetDefinition(strSource, "GetNetChannelBufferBytes");
	const nSizeGuard = strBuffer.indexOf("if (vecNetChannelBufferBytes.size() > kMaximumNetChannelBufferByteCount)");
	g_Assert(nSizeGuard >= 0);
	g_Assert(nSizeGuard < strBuffer.indexOf("static_cast<int>(vecNetChannelBufferBytes.size() * kBitsPerByte)"), "Validate the source size before multiplication/narrowing.");
	g_Assert(strBuffer.includes("static_cast<std::size_t>(std::numeric_limits<int>::max()) / kBitsPerByte"));

	const strResolver = GetDefinition(strSource, "ResolveNetChannelBufferDataValue");
	for (const strPropertyName of ["DataBitCount", "MaximumBitCount", "WrittenBitCount", "Bytes"]) {
		g_Assert(strResolver.includes('"' + strPropertyName + '"'));
	}

	const strRecord = GetDefinition(strSource, "MakeNetChannelInformationObject");
	for (const strPropertyName of ["PlayerIndex", "Address"]) {
		g_Assert(strRecord.includes("SetRecordProperty(pIsolate, LocalContext, LocalNetChannelInformationObject, kNetChannelInformation" + strPropertyName + "PropertyName,"));
	}

	const strFrameRate = GetDefinition(strSource, "GetNetChannelRemoteFrameRateCallback");
	for (const strRole of ["FrameTime", "FrameTimeStandardDeviation", "FrameStartTimeStandardDeviation"]) {
		g_Assert(strFrameRate.includes("SetRecordProperty(pIsolate, LocalContext, LocalNetChannelRemoteFrameRateObject, kNetChannelRemote" + strRole + "PropertyName, v8::Number::New("), "Frame-rate records must bypass inherited setters.");
	}
}

function RejectMutation(strName, strOld, strNew) {
	const strDefinition = GetDefinition(g_strSource, strName);
	g_Assert.equal(ReplaceDefinition(g_strSource, strName, strDefinition), g_strSource, "The contract view must round-trip exactly.");
	g_Assert(strDefinition.includes(strOld), strName + ": mutation target exists.");

	const strChangedDefinition = strDefinition.replace(strOld, () => strNew);
	g_Assert.notEqual(strChangedDefinition, strDefinition);

	const strChangedSource = ReplaceDefinition(g_strSource, strName, strChangedDefinition);
	g_Assert.notEqual(strChangedSource, g_strSource, "The control must change actual source.");
	g_Assert.throws(() => CheckContracts(strChangedSource), g_Assert.AssertionError);
}

function CheckMessageContracts(strSource) {
	const strStorage = GetDefinition(strSource, "PrepareNetChannelBitBufferStorage");
	g_Assert(strStorage.includes("if (vecBytes.size() > kMaximumStorageByteCount)"));
	g_Assert(strStorage.indexOf("if (vecBytes.size() > kMaximumStorageByteCount)") < strStorage.indexOf("vecBytes.size() + (kWordByteCount - 1)"));
	g_Assert(strStorage.includes("std::max(unWordCount, kMinimumAllocationWordCount)"));
	g_Assert(strStorage.includes("std::vector<std::uint32_t> vecWords(unAllocationWordCount);"));
	g_Assert(strStorage.includes("static_assert(std::is_same_v<std::uint32_t, uint32>);"));
	g_Assert(strStorage.includes("std::numeric_limits<int>::max()) / (kBitsPerByte * kWordByteCount)"));
	g_Assert(strStorage.includes("nStorageByteCountOut = static_cast<int>(unWordCount * kWordByteCount);"));

	for (const strName of ["SendNetChannelDataCallback", "ReadNetChannelMessageFromBufferCallback", "WriteNetChannelMessageToBufferCallback"]) {
		const strDefinition = GetDefinition(strSource, strName);
		g_Assert(strDefinition.includes("PrepareNetChannelBitBufferStorage("));
		g_Assert(strDefinition.includes("vecBufferWords.data(), nStorageByteCount,"));
		g_Assert.match(strDefinition, /if \(!GetNetChannelBufferBytes\([^\n]+\)\) \{\n\t{4}if \(NetChannelOperationFailure.HasCaught\(\) \|\| pIsolate->IsExecutionTerminating\(\) \|\| pIsolate->HasPendingException\(\)\) \{/);
	}

	const strWrite = GetDefinition(strSource, "WriteNetChannelMessageToBufferCallback");
	g_Assert(strWrite.includes("reinterpret_cast<char const*>(vecBufferWords.data())"));
	g_Assert(strWrite.includes("MakeFilesystemByteArrayValue(pIsolate, pchBufferData, vecBufferBytes.size())"));

	for (const strName of ["SendNetChannelFileCallback", "DenyNetChannelFileCallback", "RequestNetChannelFileCallback"]) {
		g_Assert(GetDefinition(strSource, strName).includes("ValueToString(pIsolate, LocalFilePathValue);\n\t\t\tif (NetChannelOperationFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()) {"));
	}

	for (const strName of ["SendNetChannelFileCallback", "DenyNetChannelFileCallback"]) {
		const strDefinition = GetDefinition(strSource, strName);
		g_Assert(strDefinition.includes("strFilePath, unTransferID, bIsReplayDemoFile?"));
		g_Assert(!strDefinition.includes("unTransferID?"));
	}

	for (const strName of ["ReadNetChannelMessageFromBufferCallback", "WriteNetChannelMessageToBufferCallback", "GetNetChannelStreamProgressCallback", "GetNetChannelPacketResponseLatencyCallback"]) {
		const strDefinition = GetDefinition(strSource, strName);
		g_Assert(strDefinition.includes("SetRecordProperty("));
		g_Assert.doesNotMatch(strDefinition, /\bSet(?:Boolean|Integer|Value)\(/);
	}

	const strPacketBytes = GetDefinition(strSource, "GetNetChannelPacketBytesCallback");
	const strGroupGuard = "if ((nGroup < INetChannelInfo::GENERIC) || (nGroup >= INetChannelInfo::TOTAL))";
	g_Assert(strPacketBytes.includes(strGroupGuard));
	g_Assert(strPacketBytes.indexOf(strGroupGuard) < strPacketBytes.indexOf("->GetPacketBytes("));
	g_Assert.doesNotMatch(GetDefinition(strSource, "MakeMemoryAddressValue"), /\) noexcept \{/);

	const strInteger = GetDefinition(strSource, "RequireMemoryUnsignedIntegerFromValue");
	g_Assert.match(strInteger, /if \(MaybeNumericValue.IsNothing\(\)\) \{\n\t+RethrowV8InstallationFailure/);
}

CheckContracts(g_strSource);
CheckMessageContracts(g_strSource);

let g_unRejectedMutationCount = 0;
for (const strName of g_vecArgumentNames) {
	RejectMutation(strName, "v8::TryCatch NetChannelArgumentReadFailure(pIsolate);", "");
	RejectMutation(strName, "catch (...)", "catch (int)");
	g_unRejectedMutationCount += 2;

	const strDefinition = GetDefinition(g_strSource, strName);
	for (const vecDiagnostic of strDefinition.matchAll(/^(\t+)ThrowError\([^\n]+\);\n([^\n]*)/gm)) {
		RejectMutation(strName, vecDiagnostic[0], vecDiagnostic[0].replace(vecDiagnostic[2], ""));
		++g_unRejectedMutationCount;
	}
}

RejectMutation("GetNetChannelFlowConstantsCallback", "v8::TryCatch NetChannelFlowConstantsFailure(pIsolate);", "");
RejectMutation("GetNetChannelFlowConstantsCallback", "catch (...)", "catch (int)");
RejectMutation("GetNetChannelInformationFromPlayerIndex", ") {", ") noexcept {");
g_unRejectedMutationCount += 3;

for (const strProperty of g_vecFlowPropertyNames) {
	RejectMutation("GetNetChannelFlowConstantsCallback", 'SetRecordProperty(pIsolate, LocalContext, LocalNetChannelFlowConstants, "' + strProperty + '"', 'SetInteger(pIsolate, LocalContext, LocalNetChannelFlowConstants, "' + strProperty + '"');
	++g_unRejectedMutationCount;
}

for (const Definition of g_vecBoundaryDefinitions) {
	RejectMutation(Definition.Name, "v8::TryCatch " + Definition.Frame + "(pIsolate);", "");
	RejectMutation(Definition.Name, "catch (std::exception const&)", "catch (int)");
	RejectMutation(Definition.Name, "catch (...)", "catch (int)");
	g_unRejectedMutationCount += 3;

	const strDefinition = GetDefinition(g_strSource, Definition.Name);
	for (const vecDiagnostic of strDefinition.matchAll(/^(\t+)ThrowError\([^\n]+\);\n([^\n]*)/gm)) {
		RejectMutation(Definition.Name, vecDiagnostic[0], vecDiagnostic[0].replace(vecDiagnostic[2], ""));
		++g_unRejectedMutationCount;
	}
}

RejectMutation("GetOptionalNetChannelIntegerProperty", "return false;\n\t\t\t}", "nNetChannelBufferPropertyValueOut = 0;\n\t\t\t\treturn false;\n\t\t\t}");
RejectMutation("GetNetChannelBufferBytes", "if (vecNetChannelBufferBytes.size() > kMaximumNetChannelBufferByteCount)", "if (false)");
RejectMutation("SendPlayerConVarValueCallback", "alignas(std::uint32_t) char arrConVarMessageBytes", "char arrConVarMessageBytes");
RejectMutation("SendPlayerConVarValueCallback", "static_assert((kConVarMessageBufferSize % sizeof(std::uint32_t)) == 0,", "static_assert(true,");
RejectMutation("SendPlayerConVarValueCallback", "if (ConVarMessageWriter.IsOverflowed())", "if (false)");
RejectMutation("GetNetChannelInformationPropertyCallback", "if (NetChannelPropertyOperationFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())", "if (false)");
g_unRejectedMutationCount += 6;

for (const strPropertyName of ["PlayerIndex", "Address"]) {
	RejectMutation("MakeNetChannelInformationObject", "SetRecordProperty(pIsolate, LocalContext, LocalNetChannelInformationObject, kNetChannelInformation" + strPropertyName + "PropertyName", "SetValue(pIsolate, LocalContext, LocalNetChannelInformationObject, kNetChannelInformation" + strPropertyName + "PropertyName");
	++g_unRejectedMutationCount;
}

for (const strRole of ["FrameTime", "FrameTimeStandardDeviation", "FrameStartTimeStandardDeviation"]) {
	RejectMutation("GetNetChannelRemoteFrameRateCallback", "SetRecordProperty(pIsolate, LocalContext, LocalNetChannelRemoteFrameRateObject, kNetChannelRemote" + strRole + "PropertyName", "SetValue(pIsolate, LocalContext, LocalNetChannelRemoteFrameRateObject, kNetChannelRemote" + strRole + "PropertyName");
	++g_unRejectedMutationCount;
}

for (const strConversion of ["GetValueIndex", "ValueToString(pIsolate, LocalConVarName)", "ValueToString(pIsolate, LocalConVarValue)"]) {
	const strDefinition = GetDefinition(g_strSource, "SendPlayerConVarValueCallback");
	const nConversion = strDefinition.indexOf(strConversion);
	g_Assert(nConversion >= 0, "Locate the ConVar conversion control: " + strConversion);

	const nLineStart = strDefinition.lastIndexOf("\n", nConversion) + 1;
	const nNextLineStart = strDefinition.indexOf("\n", nConversion) + 1;
	const nNextLineEnd = strDefinition.indexOf("\n", nNextLineStart);
	g_Assert((nNextLineStart > nLineStart) && (nNextLineEnd > nNextLineStart), "Locate the conversion failure guard line.");

	const strTarget = strDefinition.slice(nLineStart, nNextLineEnd);
	RejectMutation("SendPlayerConVarValueCallback", strTarget, strTarget.replace("if (NetChannelOperationFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException())", "if (false)"));
	++g_unRejectedMutationCount;
}

for (const vecMutation of [
	["SendNetChannelFileCallback", "strFilePath, unTransferID, bIsReplayDemoFile?", "strFilePath, unTransferID?, bIsReplayDemoFile?"],
	["DenyNetChannelFileCallback", "strFilePath, unTransferID, bIsReplayDemoFile?", "strFilePath, unTransferID?, bIsReplayDemoFile?"],
	["PrepareNetChannelBitBufferStorage", "if (vecBytes.size() > kMaximumStorageByteCount)", "if (false)"],
	["PrepareNetChannelBitBufferStorage", "std::max(unWordCount, kMinimumAllocationWordCount)", "unWordCount"],
	["PrepareNetChannelBitBufferStorage", "std::vector<std::uint32_t> vecWords", "std::vector<char> vecWords"],
	["WriteNetChannelMessageToBufferCallback", "reinterpret_cast<char const*>(vecBufferWords.data())", "vecBufferBytes.data()"],
	["GetNetChannelPacketBytesCallback", "if ((nGroup < INetChannelInfo::GENERIC) || (nGroup >= INetChannelInfo::TOTAL))", "if (false)"],
	["MakeMemoryAddressValue", ") {", ") noexcept {"],
]) {
	const strDefinition = GetDefinition(g_strSource, vecMutation[0]);
	g_Assert(strDefinition.includes(vecMutation[1]));

	const strChanged = strDefinition.replace(vecMutation[1], () => vecMutation[2]);
	g_Assert.notEqual(strChanged, strDefinition, "The message control must change its definition.");
	g_Assert.equal(ReplaceDefinition(g_strSource, vecMutation[0], strDefinition), g_strSource, "The message-contract view must round-trip exactly.");

	const strChangedSource = ReplaceDefinition(g_strSource, vecMutation[0], strChanged);
	g_Assert.notEqual(strChangedSource, g_strSource, "The message control must change actual source.");
	g_Assert.throws(() => CheckMessageContracts(strChangedSource), g_Assert.AssertionError);
	++g_unRejectedMutationCount;
}

const g_strDataRateSetter = GetDefinition(g_strSource, "SetNetChannelInformationPropertyCallback");
const g_vecDataRateConversion = /\t\t\tfloat flDataRate = 0\.0F;\n\t\t\tif \(!GetFloatArgument[^\n]+\n\t\t\t\tRethrowV8InstallationFailure[^\n]+\n\t\t\t\treturn;\n\t\t\t}\n\n/.exec(g_strDataRateSetter);
g_Assert(g_vecDataRateConversion);
const g_strEarlyAddressSetter = g_strDataRateSetter.replace(g_vecDataRateConversion[0], "").replace("\t\t\tauto* const pNetChannel = static_cast<INetChannel*>(pNetChannelInformation);", () => g_vecDataRateConversion[0] + "\t\t\tauto* const pNetChannel = static_cast<INetChannel*>(pNetChannelInformation);");
RejectMutation("SetNetChannelInformationPropertyCallback", g_strDataRateSetter, g_strEarlyAddressSetter);
++g_unRejectedMutationCount;

for (const Contract of [
	{ Name: "GetNetChannelFromValue", Constant: "kNullNetChannelAddress" },
	{ Name: "GetNetMessageFromValue", Constant: "kNullNetMessageAddress" },
]) {
	RejectMutation(Contract.Name, Contract.Constant + " = 0x0;", Contract.Constant + " = 0;");
	++g_unRejectedMutationCount;
}

console.log("NetChannel native source contracts PASS; rejected mutations=" + g_unRejectedMutationCount + "; live V8/game-engine execution not exercised.");
