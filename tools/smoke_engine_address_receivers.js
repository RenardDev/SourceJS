#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_vecArguments = process.argv.slice(2);
if (g_vecArguments.length > 0) {
	const bShowHelp = (g_vecArguments.length === 1) && (g_vecArguments[0] === "--help");
	const strUsage = `Usage: node ${g_Path.relative(process.cwd(), __filename)} [--help]\nChecks engine receiver source guards without native V8 execution.\nUnexpected arguments exit with status 2.\n`;
	g_FileSystem.writeSync(bShowHelp ? process.stdout.fd : process.stderr.fd, strUsage);
	process.exit(bShowHelp ? 0 : 2);
}

const g_strNativeSource = g_FileSystem.readFileSync(g_Path.join(__dirname, "..", "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_vecReceiverSignaturePrefixes = [
	"IServer* RequireIServerFromThis(",
	"IClient* RequireIServerClientFromThis(",
];

const g_vecGuardRegressions = [
	["v8::TryCatch AddressFailure(pIsolate);", ""],
	["if (AddressFailure.HasCaught())", "if (false)"],
	["AddressFailure.ReThrow();\n\t\t\t\treturn nullptr;", "return nullptr;"],
	["ThrowError(pIsolate, strMessage.c_str());\n\t\t\t\tAddressFailure.ReThrow();", "ThrowError(pIsolate, strMessage.c_str());"],
];

const g_vecPropertyRegressions = [
	["void GetIServerClientPropertyCallback(", "AddressFailure.ReThrow();", ""],
	["void GetIServerClientPropertyCallback(", "if (AddressFailure.HasCaught())", "if (false)"],
	["bool InstallIServerClientProperty(", "if (LocalPropertyName.IsEmpty())", "if (false)"],
];

let g_unRegressionCount = 0;

function ExtractFunction(strSource, strSignaturePrefix) {
	const nStart = strSource.indexOf("\t\t" + strSignaturePrefix);
	const nEnd = strSource.indexOf("\n\t\t}\n", nStart);
	g_Assert.ok((nStart >= 0) && (nEnd > nStart), strSignaturePrefix);

	return strSource.slice(nStart, nEnd);
}

function AssertEngineAddressReceiverGuards(strSource) {
	for (const strSignaturePrefix of g_vecReceiverSignaturePrefixes) {
		const strReceiver = ExtractFunction(strSource, strSignaturePrefix);
		g_Assert.match(strReceiver, /v8::TryCatch AddressFailure\(pIsolate\);[\s\S]*if \(AddressFailure\.HasCaught\(\)\) \{\s*AddressFailure\.ReThrow\(\);\s*return nullptr;\s*}/);
		g_Assert.match(strReceiver, /ThrowError\(pIsolate, strMessage\.c_str\(\)\);\s*AddressFailure\.ReThrow\(\);/);
	}

	const strProperty = ExtractFunction(strSource, "void GetIServerClientPropertyCallback(");
	g_Assert.match(strProperty, /v8::TryCatch AddressFailure\(pIsolate\);[\s\S]*if \(AddressFailure\.HasCaught\(\)\) \{\s*AddressFailure\.ReThrow\(\);\s*return;\s*}\s*}\s*if \(!pClient\)/);
	g_Assert.match(strProperty, /v8::BigInt::NewFromUnsigned\(pIsolate, static_cast<std::uint64_t>\(unNetworkChannelAddress\)\)/);

	const strInstaller = ExtractFunction(strSource, "bool InstallIServerClientProperty(");
	g_Assert.match(strInstaller, /if \(LocalPropertyName\.IsEmpty\(\)\) \{\s*return false;\s*}\s*return LocalClientObject->SetNativeDataProperty\(LocalContext, LocalPropertyName,/);

	const strFactory = ExtractFunction(strSource, "v8::Local<v8::Object> MakeEngineServerAddressObject(");
	g_Assert.match(strFactory, /kAddressPropertyName\[\] = "Address";/);
	g_Assert.match(strFactory, /kAddressTypePropertyName\[\] = "Kind";/);
	g_Assert.match(strFactory, /v8::BigInt::NewFromUnsigned\(pIsolate, static_cast<std::uint64_t>\(unAddress\)\)/);
	g_Assert.doesNotMatch(strFactory, /SetNumber|v8::Number::New/);
}

AssertEngineAddressReceiverGuards(g_strNativeSource);

for (const strSignaturePrefix of g_vecReceiverSignaturePrefixes) {
	const strReceiver = ExtractFunction(g_strNativeSource, strSignaturePrefix);
	for (const vecRegression of g_vecGuardRegressions) {
		g_Assert.equal(strReceiver.split(vecRegression[0]).length, 2, strSignaturePrefix + vecRegression[0]);
		const strMutatedReceiver = strReceiver.replace(vecRegression[0], vecRegression[1]);
		const strMutatedSource = g_strNativeSource.replace(strReceiver, strMutatedReceiver);
		g_Assert.throws(() => AssertEngineAddressReceiverGuards(strMutatedSource), g_Assert.AssertionError, strSignaturePrefix + vecRegression[0]);
		++g_unRegressionCount;
	}
}

for (const vecRegression of g_vecPropertyRegressions) {
	const strOwner = ExtractFunction(g_strNativeSource, vecRegression[0]);
	g_Assert.equal(strOwner.split(vecRegression[1]).length, 2, vecRegression[0] + vecRegression[1]);
	const strMutatedOwner = strOwner.replace(vecRegression[1], vecRegression[2]);
	const strMutatedSource = g_strNativeSource.replace(strOwner, strMutatedOwner);
	g_Assert.throws(() => AssertEngineAddressReceiverGuards(strMutatedSource), g_Assert.AssertionError, vecRegression[0] + vecRegression[1]);
	++g_unRegressionCount;
}

console.log(`[smoke] engine-address method/property receiver source guards and ${g_unRegressionCount} negative regressions passed; native V8 execution is a separate check`);
