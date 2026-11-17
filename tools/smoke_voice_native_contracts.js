#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

if (process.argv.length > 2) {
	if ((process.argv.length === 3) && ["--help", "-h"].includes(process.argv[2])) {
		console.log("Usage: node tools/smoke_voice_native_contracts.js\nChecks source contracts only; does not execute live V8 or SDK ABI code.");
		process.exit(0);
	}

	console.error("Usage: node tools/smoke_voice_native_contracts.js");
	process.exit(2);
}

const g_strSource = g_FileSystem.readFileSync(g_Path.join(__dirname, "..", "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_vecVoiceCallbacks = [
	{ Name: "GetVoiceClientListeningCallback", Information: "CallbackInformation" },
	{ Name: "SetVoiceClientListeningCallback", Information: "CallbackInformation" },
	{ Name: "SetVoiceClientProximityCallback", Information: "CallbackInformation" },
	{ Name: "GetVoiceServerPropertyCallback", Information: "PropertyCallbackInformation" },
];

let g_unRegressionCount = 0;

function ExtractFunction(strSource, strSignature) {
	const strEscapedSignature = strSignature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const vecDefinitions = [...strSource.matchAll(new RegExp("^\\t\\t" + strEscapedSignature + "[^\\n;{}]*\\)(?: noexcept)?(?: try)? \\{$", "gm"))];
	g_Assert.equal(vecDefinitions.length, 1, "Expected one function definition: " + strSignature);

	const nStart = vecDefinitions[0].index - 1;
	const nEnd = strSource.indexOf("\n\t\t}\n", nStart);
	g_Assert.ok((nStart >= 0) && (nEnd > nStart), strSignature);

	return strSource.slice(nStart, nEnd);
}

function AssertFunctionExtraction() {
	const strPrototype = "\n\t\tbool Probe(int nValue); // marker ) {\n";
	const strUnrelated = "\t\tbool Other(int nValue) {\n\t\t\treturn Probe(nValue);\n\t\t}\n";
	const strBody = "\t\tbool Probe(int nValue) noexcept try {\n\t\t\treturn nValue > 0;\n\t\t} catch (...) {\n\t\t\treturn false;";
	const strDefinition = "\n" + strBody + "\n\t\t}\n";
	g_Assert.equal(ExtractFunction(strPrototype + strUnrelated + strDefinition, "bool Probe("), "\n" + strBody, "Ignore prototypes and unrelated calls while preserving the function-try block.");
	g_Assert.equal(ExtractFunction("\n\t\tbool Probe() {\n\t\t\treturn true;\n\t\t}\n", "bool Probe("), "\n\t\tbool Probe() {\n\t\t\treturn true;");
	g_Assert.throws(() => ExtractFunction(strPrototype + strUnrelated, "bool Probe("), { code: "ERR_ASSERTION" });
	g_Assert.throws(() => ExtractFunction(strDefinition + strDefinition, "bool Probe("), { code: "ERR_ASSERTION" });
}

function AssertVoiceContracts(strSource) {
	const strReader = ExtractFunction(strSource, "bool GetVoiceEntityIndexArgument(");
	g_Assert.ok(strReader.includes("int& nEntityIndexOut"));
	g_Assert.ok(strReader.includes("return GetEntityIndexFromValue(pIsolate, LocalContext, CallbackInformation[nArgumentIndex], nEntityIndexOut);"));
	g_Assert.ok(!strReader.includes("GetValueIndex("));

	for (const strSignature of ["void GetVoiceClientListeningCallback(", "void SetVoiceClientListeningCallback(", "void SetVoiceClientProximityCallback("]) {
		const strCallback = ExtractFunction(strSource, strSignature);
		g_Assert.match(strCallback, /if \(!GetVoiceEntityIndexArgument\(CallbackInformation, kReceiverArgumentIndex, nReceiverIndex\)\) \{\s*return;/);
		g_Assert.match(strCallback, /if \(!GetVoiceEntityIndexArgument\(CallbackInformation, kSenderArgumentIndex, nSenderIndex\)\) \{\s*return;/);
		g_Assert.ok(strCallback.indexOf("kReceiverArgumentIndex, nReceiverIndex") < strCallback.indexOf("kSenderArgumentIndex, nSenderIndex"));
		g_Assert.ok(strCallback.indexOf("kSenderArgumentIndex, nSenderIndex") < strCallback.indexOf("!ValidateVoicePlayerIndices"));
	}

	for (const [strSignature, strBooleanName] of [["void SetVoiceClientListeningCallback(", "bListen"], ["void SetVoiceClientProximityCallback(", "bUseProximity"]]) {
		const strCallback = ExtractFunction(strSource, strSignature);
		const nFeatureStart = strCallback.indexOf("#if defined(SOURCEJS_HAS_VOICE_SERVER)");
		const nFeatureEnd = strCallback.indexOf("#else", nFeatureStart);
		const nDeclaration = strCallback.indexOf("const bool " + strBooleanName + " =");
		g_Assert.ok((nDeclaration > nFeatureStart) && (nDeclaration < nFeatureEnd));
	}

	const strProximity = ExtractFunction(strSource, "bool SetVoiceClientProximity(");
	const nAlternative = strProximity.indexOf("} else {");
	g_Assert.ok(nAlternative >= 0);
	g_Assert.ok(strProximity.indexOf("constexpr char kUnsupportedError") > nAlternative);
	g_Assert.ok(strProximity.indexOf("ThrowError(pIsolate, kUnsupportedError)") > nAlternative);

	const strRecordFunction = ExtractFunction(strSource, "bool SetRecordFunction(");
	g_Assert.match(strRecordFunction, /if \(!v8::Function::New\(LocalContext, Callback, LocalData\)\.ToLocal\(&LocalFunction\)\) \{\s*return false;/);
	g_Assert.ok(strRecordFunction.includes("return SetRecordProperty(pIsolate, LocalContext, LocalObject, pszName, LocalFunction);"));

	const strFunctions = ExtractFunction(strSource, "bool InstallVoiceFunctions(");
	g_Assert.equal((strFunctions.match(/SetRecordFunction\(/g) ?? []).length, 3);
	g_Assert.ok(!strFunctions.includes("SetFunction("));

	const strCapability = ExtractFunction(strSource, "constexpr bool HasVoiceClientProximity(");
	g_Assert.match(strCapability, /return requires\(TVoiceServer\* pVoiceServer\) \{\s*pVoiceServer->SetClientProximity\(0, 0, false\);\s*\};/);

	const strVTableLookup = ExtractFunction(strSource, "void* GetVoiceVTableFunctionAddress(");
	g_Assert.ok(strVTableLookup.includes("(nVTableIndex == GetVoiceSetClientProximityVTableIndex()) && !HasVoiceClientProximity<IVoiceServer>()"));
	g_Assert.ok(strVTableLookup.indexOf("!HasVoiceClientProximity<IVoiceServer>()") < strVTableLookup.indexOf("std::memcpy("));
	g_Assert.ok(strVTableLookup.includes("nVTableIndex > kMaximumVoiceVTableIndex"));
	g_Assert.ok(strVTableLookup.includes("std::memcpy(&pVTableAddress, pVoiceServer, sizeof(pVTableAddress))"));
	g_Assert.ok(strVTableLookup.includes("std::memcpy(&pFunctionAddress, static_cast<unsigned char const*>(pVTableAddress) + unVTableEntryOffset, sizeof(pFunctionAddress))"));
	g_Assert.ok(!strVTableLookup.includes("reinterpret_cast<void**"));

	const strMetadata = ExtractFunction(strSource, "bool InstallVoiceMetadata(");
	g_Assert.equal((strMetadata.match(/SetRecordProperty\(/g) ?? []).length, 7);
	g_Assert.equal((strMetadata.match(/v8::BigInt::NewFromUnsigned\(/g) ?? []).length, 4);
	g_Assert.ok(!strMetadata.includes("SetValue(") && !strMetadata.includes("SetInteger(") && !strMetadata.includes("v8::Number::New("));

	const strObject = ExtractFunction(strSource, "v8::Local<v8::Object> MakeVoiceServerObject(");
	g_Assert.match(strObject, /if \(!InstallVoiceMetadata\([^\n]+\)\) \{\s*return \{\};/);
	g_Assert.match(strObject, /if \(!InstallVoiceFunctions\([^\n]+\)\) \{\s*return \{\};/);

	for (const Definition of g_vecVoiceCallbacks) {
		const strCallback = ExtractFunction(strSource, "void " + Definition.Name + "(");
		g_Assert.ok(strCallback.includes(") try {"));
		g_Assert.ok(strCallback.includes("ThrowError(" + Definition.Information + ".GetIsolate(), \"" + Definition.Name + " failed with a C++ exception.\");"));
	}
}

function AssertRegression(strSignature, strOriginal, strReplacement) {
	const strOwner = ExtractFunction(g_strSource, strSignature);
	g_Assert.ok(strOwner.includes(strOriginal), strOriginal);

	// Intentionally invalid source fixtures must change only their owning definition.
	const strChanged = strOwner.replace(strOriginal, () => strReplacement);
	g_Assert.notEqual(strChanged, strOwner, strSignature);

	const strChangedSource = g_strSource.replace(strOwner, () => strChanged);
	g_Assert.notEqual(strChangedSource, g_strSource, strSignature);
	g_Assert.throws(() => AssertVoiceContracts(strChangedSource), g_Assert.AssertionError, strOriginal);
	++g_unRegressionCount;
}

AssertFunctionExtraction();
AssertVoiceContracts(g_strSource);
AssertRegression("constexpr bool HasVoiceClientProximity(", "return requires(TVoiceServer* pVoiceServer) {\n\t\t\t\tpVoiceServer->SetClientProximity(0, 0, false);\n\t\t\t};", "return true;");
AssertRegression("void* GetVoiceVTableFunctionAddress(", "(nVTableIndex == GetVoiceSetClientProximityVTableIndex()) && !HasVoiceClientProximity<IVoiceServer>()", "false");
AssertRegression("bool GetVoiceEntityIndexArgument(", "return GetEntityIndexFromValue(", "return GetValueIndex(");

for (const strSignature of ["void GetVoiceClientListeningCallback(", "void SetVoiceClientListeningCallback(", "void SetVoiceClientProximityCallback("]) {
	AssertRegression(strSignature, "if (!GetVoiceEntityIndexArgument(CallbackInformation, kReceiverArgumentIndex, nReceiverIndex))", "if (false)");
	AssertRegression(strSignature, "if (!GetVoiceEntityIndexArgument(CallbackInformation, kSenderArgumentIndex, nSenderIndex))", "if (false)");
}

AssertRegression("void SetVoiceClientListeningCallback(", "const bool bListen =", "bool bListen =");
AssertRegression("void SetVoiceClientProximityCallback(", "const bool bUseProximity =", "bool bUseProximity =");
AssertRegression("bool SetVoiceClientProximity(", "} else {", "} {");
AssertRegression("bool SetRecordFunction(", "if (!v8::Function::New(", "if (v8::Function::New(");
AssertRegression("bool SetRecordFunction(", "return SetRecordProperty(", "return SetValue(");
AssertRegression("bool InstallVoiceFunctions(", "SetRecordFunction(", "SetFunction(");
AssertRegression("bool InstallVoiceMetadata(", "SetRecordProperty(", "SetValue(");
AssertRegression("bool InstallVoiceMetadata(", "v8::BigInt::NewFromUnsigned(", "v8::Number::New(");
AssertRegression("v8::Local<v8::Object> MakeVoiceServerObject(", "if (!InstallVoiceMetadata(", "if (InstallVoiceMetadata(");
AssertRegression("v8::Local<v8::Object> MakeVoiceServerObject(", "if (!InstallVoiceFunctions(", "if (InstallVoiceFunctions(");

AssertRegression("void* GetVoiceVTableFunctionAddress(", "nVTableIndex > kMaximumVoiceVTableIndex", "false");
AssertRegression("void* GetVoiceVTableFunctionAddress(", "std::memcpy(&pVTableAddress, pVoiceServer, sizeof(pVTableAddress))", "IgnoredVTableRead()");
AssertRegression("void* GetVoiceVTableFunctionAddress(", "std::memcpy(&pFunctionAddress, static_cast<unsigned char const*>(pVTableAddress) + unVTableEntryOffset, sizeof(pFunctionAddress))", "IgnoredFunctionRead()");

for (const Definition of g_vecVoiceCallbacks) {
	AssertRegression("void " + Definition.Name + "(", ") try {", ") {");
}

console.log("[smoke] Voice source contracts and " + g_unRegressionCount + " negative regressions passed; native V8/SDK-ABI execution is a separate check");
