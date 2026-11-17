#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_vecArguments = process.argv.slice(2);
if (g_vecArguments.length > 0) {
	const bShowHelp = (g_vecArguments.length === 1) && (g_vecArguments[0] === "--help");
	const strUsage = `Usage: node ${g_Path.relative(process.cwd(), __filename)} [--help]\nChecks ConVar live-property source contracts without native V8 execution.\nUnexpected arguments exit with status 2.\n`;
	g_FileSystem.writeSync(bShowHelp ? process.stdout.fd : process.stderr.fd, strUsage);
	process.exit(bShowHelp ? 0 : 2);
}

const g_strNativeSource = g_FileSystem.readFileSync(g_Path.join(__dirname, "..", "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_vecProperties = ["Exists", "Name", "Help", "Value", "DefaultValue", "IntValue", "FloatValue", "BooleanValue", "Flags", "Address", "HasMinimum", "HasMaximum", "MinimumValue", "MaximumValue"];

let g_unRejectedMutationCount = 0;

function ExtractFunction(strSource, strSignaturePrefix) {
	let nStart = -1;
	for (const strLine of strSource.split("\n")) {
		if (strLine.startsWith("\t\t" + strSignaturePrefix) && strLine.endsWith("{")) {
			nStart = strSource.indexOf(strLine);
			break;
		}
	}

	const nEnd = strSource.indexOf("\n\t\t}\n", nStart);
	g_Assert.ok((nStart >= 0) && (nEnd > nStart), strSignaturePrefix);

	return strSource.slice(nStart, nEnd);
}

function AssertLiveContracts(strSource) {
	const strSetter = ExtractFunction(strSource, "void ConVarSetLiveProperty(");
	g_Assert.match(strSetter, /v8::TryCatch ConversionFailure\(pIsolate\);\s*v8::Local<v8::String> LocalString \{\};\s*if \(!LocalValue->ToString\(LocalContext\)\.ToLocal\(&LocalString\)\) \{\s*if \(ConversionFailure\.HasCaught\(\)\) \{\s*ConversionFailure\.ReThrow\(\);\s*return;/);
	g_Assert.match(strSetter, /strValue\.assign\(pszEncodedValue, static_cast<std::size_t>\(UTF8Value\.length\(\)\)\);\s*}\s*pConVar->SetValue\(strValue\.c_str\(\)\);/);
	g_Assert.match(strSetter, /if \(!pszEncodedValue\) \{\s*ThrowError\(pIsolate, kStringConversionError\);\s*ConversionFailure\.ReThrow\(\);\s*return;/);
	g_Assert.match(strSetter, /constexpr double kMaximumNativeFloat = static_cast<double>\(std::numeric_limits<float>::max\(\)\);/);
	g_Assert.match(strSetter, /if \(!std::isfinite\(dblValue\) \|\| \(std::fabs\(dblValue\) > kMaximumNativeFloat\)\) \{\s*ThrowError\(pIsolate, kNativeFloatValueError\);\s*return;\s*}\s*pConVar->SetValue\(static_cast<float>\(dblValue\)\);/);

	const strGetter = ExtractFunction(strSource, "void ConVarGetLiveProperty(");
	g_Assert.match(strGetter, /v8::BigInt::NewFromUnsigned\(pIsolate, static_cast<std::uint64_t>\(unAddress\)\)/);
	for (const strFunction of [strGetter, strSetter]) {
		g_Assert.match(strFunction, /const LocalPropertyMetadata = PropertyCallbackInformation\.Data\(\);/);
		g_Assert.match(strFunction, /if \(LocalPropertyMetadata\.IsEmpty\(\) \|\| !LocalPropertyMetadata->IsExternal\(\)\) \{\s*ThrowError\(pIsolate, kMetadataError\);\s*return;/);
	}

	const strInstaller = ExtractFunction(strSource, "bool ConVarInstallLiveProperty(");
	g_Assert.match(strInstaller, /const LocalPropertyName = MakeString\(pIsolate, pszPropertyName\);\s*if \(LocalPropertyName\.IsEmpty\(\)\) \{\s*return false;\s*}/);
	g_Assert.match(strInstaller, /SetNativeDataProperty\(LocalContext, LocalPropertyName, ConVarGetLiveProperty<PropertyInformation>, ConVarSetLiveProperty<PropertyInformation>,/);

	const strFactory = ExtractFunction(strSource, "v8::Local<v8::Object> MakeConVarObject(");
	g_Assert.match(strFactory, /#if defined\(SOURCEJS_HAS_CONVAR_CREATION\)\s*static constexpr char kRangePropertyInstallationMessage\[\] = "Failed to install ConVar range properties\.";\s*#endif/);
	const vecProperties = Array.from(strFactory.matchAll(/\{ "([^"]+)", k(?:Live|Range)PropertyInstallationMessage, &ConVarInstallLiveProperty<ConVarLiveProperty::[^>]+> \}/g), (vecMatch) => vecMatch[1]);
	g_Assert.deepEqual(vecProperties, g_vecProperties);
	g_Assert.match(strFactory, /v8::TryCatch PropertyInstallationFailure\(pIsolate\);/);
	g_Assert.match(strFactory, /if \(PropertyInstallationFailure\.HasCaught\(\)\) \{\s*PropertyInstallationFailure\.ReThrow\(\);\s*return \{\};/);
	g_Assert.match(strFactory, /ThrowError\(pIsolate, PropertyBinding\.m_pszErrorMessage\);\s*PropertyInstallationFailure\.ReThrow\(\);\s*return \{\};/);

	const strCommandSetter = ExtractFunction(strSource, "void ConCommandSetFlagsProperty(");
	g_Assert.match(strCommandSetter, /if \(!LocalValue->IsInt32\(\)\) \{\s*ThrowError\(pIsolate, kFlagsError\);\s*return;/);
	g_Assert.match(strCommandSetter, /if \(!SourceJSSetConCommandFlags\(pCommandBase, nFlags\)\) \{\s*ThrowError\(pIsolate, kUnsupportedFlagsError\);/);
}

function AssertRegression(strSignaturePrefix, strOriginal, strReplacement) {
	const strOwner = ExtractFunction(g_strNativeSource, strSignaturePrefix);
	g_Assert.ok(strOwner.includes(strOriginal), strSignaturePrefix + strOriginal);

	const strMutatedOwner = strOwner.replace(strOriginal, strReplacement);
	g_Assert.throws(() => AssertLiveContracts(g_strNativeSource.replace(strOwner, strMutatedOwner)), g_Assert.AssertionError, strSignaturePrefix + strOriginal);
	++g_unRejectedMutationCount;
}

AssertLiveContracts(g_strNativeSource);
AssertRegression("void ConVarSetLiveProperty(", "if (ConversionFailure.HasCaught())", "if (false)");
AssertRegression("void ConVarSetLiveProperty(", "ConversionFailure.ReThrow();", "");
AssertRegression("void ConVarSetLiveProperty(", "if (!pszEncodedValue)", "if (false)");
AssertRegression("void ConVarSetLiveProperty(", "!std::isfinite(dblValue)", "false");
AssertRegression("void ConVarSetLiveProperty(", "std::fabs(dblValue) > kMaximumNativeFloat", "false");
AssertRegression("void ConVarGetLiveProperty(", "v8::BigInt::NewFromUnsigned", "v8::Number::New");
AssertRegression("bool ConVarInstallLiveProperty(", "if (LocalPropertyName.IsEmpty())", "if (false)");
AssertRegression("v8::Local<v8::Object> MakeConVarObject(", "if (PropertyInstallationFailure.HasCaught())", "if (false)");
AssertRegression("v8::Local<v8::Object> MakeConVarObject(", "#if defined(SOURCEJS_HAS_CONVAR_CREATION)", "#if 1");
AssertRegression("v8::Local<v8::Object> MakeConVarObject(", "PropertyInstallationFailure.ReThrow();\n\t\t\t\t\t\treturn {};", "return {};");
AssertRegression("v8::Local<v8::Object> MakeConVarObject(", "ThrowError(pIsolate, PropertyBinding.m_pszErrorMessage);\n\t\t\t\t\t\tPropertyInstallationFailure.ReThrow();", "ThrowError(pIsolate, PropertyBinding.m_pszErrorMessage);");
AssertRegression("v8::Local<v8::Object> MakeConVarObject(", "{ \"Address\", kLivePropertyInstallationMessage", "{ \"address\", kLivePropertyInstallationMessage");
AssertRegression("void ConCommandSetFlagsProperty(", "if (!LocalValue->IsInt32())", "if (false)");

console.log(`[smoke] ConVar live-property source contracts and ${g_unRejectedMutationCount} negative regressions passed; native V8 execution is a separate check`);
