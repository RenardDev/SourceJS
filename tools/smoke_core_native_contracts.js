#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_vecArguments = process.argv.slice(2);
if (g_vecArguments.length > 0) {
	const bShowHelp = (g_vecArguments.length === 1) && (g_vecArguments[0] === "--help");
	const strUsage = `Usage: node ${g_Path.relative(process.cwd(), __filename)} [--help]\nChecks core source contracts without native V8 execution.\nUnexpected arguments exit with status 2.\n`;
	g_FileSystem.writeSync(bShowHelp ? process.stdout.fd : process.stderr.fd, strUsage);
	process.exit(bShowHelp ? 0 : 2);
}

const g_strSource = g_FileSystem.readFileSync(g_Path.join(__dirname, "..", "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");

let g_unRejectedMutationCount = 0;

function ExtractFunction(strSource, strSignaturePrefix) {
	const strDefinition = strSource.split("\n").find((strLine) => strLine.startsWith("\t\t" + strSignaturePrefix) && strLine.endsWith("{"));
	g_Assert.ok(strDefinition, strSignaturePrefix);

	const nStart = strSource.indexOf(strDefinition);
	const nEnd = strSource.indexOf("\n\t\t}\n", nStart);
	g_Assert.ok(nEnd > nStart, strSignaturePrefix);

	return strSource.slice(nStart, nEnd);
}

function AssertCoreContracts(strSource) {
	const strFactory = ExtractFunction(strSource, "v8::Local<v8::Object> MakeConCommandBaseObject(");
	g_Assert.match(strFactory, /auto InstallLiveProperty = \[[^\n]+\]\(char const\* const pszPropertyName, v8::AccessorNameGetterCallback const Getter, v8::AccessorNameSetterCallback const Setter\) -> bool/);
	g_Assert.match(strFactory, /v8::TryCatch PropertyInstallationFailure\(pIsolate\);/);
	g_Assert.match(strFactory, /if \(LocalPropertyName\.IsEmpty\(\) \|\| !LocalCommandObject->SetNativeDataProperty/);
	g_Assert.match(strFactory, /if \(PropertyInstallationFailure\.HasCaught\(\)\) \{\s*PropertyInstallationFailure\.ReThrow\(\);\s*return false;/);
	g_Assert.match(strFactory, /ThrowError\(pIsolate, kPropertyInstallationError\);\s*PropertyInstallationFailure\.ReThrow\(\);\s*return false;/);
	g_Assert.match(strFactory, /InstallLiveProperty\(kExistsPropertyName, ConCommandGetExistsProperty, ConCommandSetReadOnlyProperty\)/);
	g_Assert.match(strFactory, /InstallLiveProperty\(kFlagsPropertyName, ConCommandGetFlagsProperty, ConCommandSetFlagsProperty\)/);

	const strRequire = ExtractFunction(strSource, "void RequireCallback(");
	g_Assert.match(strRequire, /if \(PackageLookupFailure\.HasCaught\(\)\) \{\s*PackageLookupFailure\.ReThrow\(\);\s*return;/);
	g_Assert.match(strRequire, /const MaybeModule = LocalSourceJS->Get\(LocalContext, LocalModuleName\);\s*if \(!MaybeModule\.ToLocal\(&LocalModule\)\) \{\s*return;\s*}/);

	const strConversion = ExtractFunction(strSource, "bool ConvertLogMessage(");
	g_Assert.match(strConversion, /if \(!CallbackInformation\[kMessageArgumentIndex\]->ToString\(pIsolate->GetCurrentContext\(\)\)\.ToLocal\(&LocalString\)\) \{\s*if \(ConversionFailure\.HasCaught\(\)\) \{\s*ConversionFailure\.ReThrow\(\);\s*return false;/);
	g_Assert.match(strConversion, /if \(!pszEncodedValue\) \{\s*ThrowError\(pIsolate, kStringConversionError\);\s*ConversionFailure\.ReThrow\(\);\s*return false;/);
	g_Assert.match(strConversion, /if \(std::memchr\(pszEncodedValue, '\\0', unEncodedByteCount\)\) \{\s*ThrowError\(pIsolate, kEmbeddedNullCharacterError\);\s*ConversionFailure\.ReThrow\(\);\s*return false;/);
	g_Assert.ok(strConversion.indexOf("std::memchr(pszEncodedValue") < strConversion.indexOf("strMessageOut.assign("), "Reject embedded NUL before committing or forwarding the message.");

	for (const strCallback of ["LogInformationCallback", "LogWarningCallback", "LogErrorCallback"]) {
		const strLogger = ExtractFunction(strSource, "void " + strCallback + "(");
		g_Assert.match(strLogger, /if \(!ConvertLogMessage\(CallbackInformation, strMessage\)\) \{\s*return;\s*}\s*Log(?:Info|Warning|Error)\("%s", strMessage\.c_str\(\)\);/);
	}

	const strChecksum = ExtractFunction(strSource, "void GetCoreChecksumCallback(");
	g_Assert.match(strChecksum, /"core\.GetChecksum\(strData\) expects a string\."/);
	g_Assert.match(strChecksum, /"core\.GetChecksum\(strData\) input is too large for the Source SDK MD5 implementation\."/);
	g_Assert.match(strChecksum, /if \(!pszEncodedValue\) \{\s*ThrowError\(pIsolate, kEncodingError\);\s*return;/);
	g_Assert.match(strChecksum, /const std::size_t unEncodedByteCount = static_cast<std::size_t>\(UTF8Value\.length\(\)\);/);
	g_Assert.match(strChecksum, /if \(unEncodedByteCount > kMaximumInputByteCount\) \{\s*ThrowError\(pIsolate, kInputSizeError\);\s*return;/);
	g_Assert.match(strChecksum, /MD5Update\(&MD5Context, reinterpret_cast<unsigned char const\*>\(pszEncodedValue\), static_cast<unsigned int>\(unEncodedByteCount\)\);/);
	g_Assert.ok(strChecksum.indexOf("if (!pszEncodedValue)") < strChecksum.indexOf("MD5Init(&MD5Context)"), "Reject failed encoding before checksum dispatch.");
	g_Assert.match(strChecksum, /kHexDigestLength = kDigestLength \* kHexDigitCountPerByte/);
	g_Assert.match(strChecksum, /kHexDigits\[arrDigestBytes\[unDigestIndex\] >> kBitCountPerHexDigit\]/);
	g_Assert.match(strChecksum, /kHexDigits\[arrDigestBytes\[unDigestIndex\] & kHexDigitMask\]/);
	g_Assert.equal((strSource.match(/"GetInfo", GetCoreInformationCallback, LocalRuntimeData/g) ?? []).length, 2);
	g_Assert.ok(!strSource.includes("CoreBuildInfoObject") && !strSource.includes("GetCoreInfoCallback"));

	for (const strCallback of ["RequireCallback", "GetCoreChecksumCallback", "GetCoreInformationCallback", "GetCoreModulesCallback", "GetCorePublicPackagesCallback", "IsCoreUnversionedCallback", "GetCurrentBuildCallback", "LogInformationCallback", "LogWarningCallback", "LogErrorCallback", "AddRuntimeEventListenerCallback", "RemoveRuntimeEventListenerCallback"]) {
		const strOwner = ExtractFunction(strSource, "void " + strCallback + "(");
		g_Assert.match(strOwner, /const& CallbackInformation\) try \{/);
		g_Assert.match(strOwner, /} catch \(\.\.\.\) \{\s*constexpr char kCallbackExceptionError\[\]/);
		g_Assert.ok(strOwner.includes('"' + strCallback + ' failed with a C++ exception."'));
		g_Assert.match(strOwner, /ThrowError\(CallbackInformation\.GetIsolate\(\), kCallbackExceptionError\);/);
	}
}

function AssertRegression(strSignaturePrefix, strOriginal, strReplacement) {
	const strOwner = ExtractFunction(g_strSource, strSignaturePrefix);
	g_Assert.ok(strOwner.includes(strOriginal), strOriginal);
	g_Assert.throws(() => AssertCoreContracts(g_strSource.replace(strOwner, strOwner.replace(strOriginal, strReplacement))), g_Assert.AssertionError, strOriginal);
	++g_unRejectedMutationCount;
}

AssertCoreContracts(g_strSource);
AssertRegression("v8::Local<v8::Object> MakeConCommandBaseObject(", "LocalPropertyName.IsEmpty() || ", "");
AssertRegression("v8::Local<v8::Object> MakeConCommandBaseObject(", "if (PropertyInstallationFailure.HasCaught())", "if (false)");
AssertRegression("v8::Local<v8::Object> MakeConCommandBaseObject(", "PropertyInstallationFailure.ReThrow();\n\t\t\t\t\t\treturn false;", "return false;");
AssertRegression("v8::Local<v8::Object> MakeConCommandBaseObject(", "ThrowError(pIsolate, kPropertyInstallationError);\n\t\t\t\t\t\tPropertyInstallationFailure.ReThrow();", "ThrowError(pIsolate, kPropertyInstallationError);");
AssertRegression("void RequireCallback(", "PackageLookupFailure.ReThrow();", "");
AssertRegression("void RequireCallback(", "if (!MaybeModule.ToLocal(&LocalModule))", "if (false)");
AssertRegression("bool ConvertLogMessage(", "ConversionFailure.ReThrow();", "");
AssertRegression("bool ConvertLogMessage(", "if (!pszEncodedValue)", "if (false)");
AssertRegression("bool ConvertLogMessage(", "if (std::memchr(pszEncodedValue, '\\0', unEncodedByteCount))", "if (false)");
AssertRegression("void GetCoreChecksumCallback(", "core.GetChecksum(strData) expects", "core.checksum(strData) expects");
AssertRegression("void GetCoreChecksumCallback(", "if (!pszEncodedValue)", "if (false)");
AssertRegression("void GetCoreChecksumCallback(", "static_cast<std::size_t>(UTF8Value.length())", "std::size_t(0)");
AssertRegression("void GetCoreChecksumCallback(", "if (unEncodedByteCount > kMaximumInputByteCount)", "if (false)");
AssertRegression("void GetCoreChecksumCallback(", "static_cast<unsigned int>(unEncodedByteCount)", "static_cast<unsigned int>(0)");

for (const strCallback of ["LogInformationCallback", "LogWarningCallback", "LogErrorCallback"]) {
	AssertRegression("void " + strCallback + "(", "if (!ConvertLogMessage(CallbackInformation, strMessage))", "if (false)");
}

AssertRegression("void RequireCallback(", "ThrowError(CallbackInformation.GetIsolate(), kCallbackExceptionError);", "if (kCallbackExceptionError[0] == '\\0') { return; }");

console.log(`[smoke] core/native command source contracts and ${g_unRejectedMutationCount} negative regressions passed; native V8 execution is a separate check`);
