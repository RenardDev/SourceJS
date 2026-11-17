#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_vecArguments = process.argv.slice(2);
if (g_vecArguments.length > 0) {
	const bShowHelp = (g_vecArguments.length === 1) && (g_vecArguments[0] === "--help");
	const strUsage = `Usage: node ${g_Path.relative(process.cwd(), __filename)} [--help]\nChecks command source contracts without native V8 execution.\nUnexpected arguments exit with status 2.\n`;
	g_FileSystem.writeSync(bShowHelp ? process.stdout.fd : process.stderr.fd, strUsage);
	process.exit(bShowHelp ? 0 : 2);
}

const g_strSource = g_FileSystem.readFileSync(g_Path.join(__dirname, "..", "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_vecCallbacks = [
	"ExecuteServerCommandCallback",
	"QueueServerCommandCallback",
	"InsertServerCommandCallback",
	"GetEngineGameDescriptionCallback",
	"RegisterCommandCallback",
	"UnregisterCommandCallback",
	"RegisterClientCommandCallback",
	"UnregisterClientCommandCallback",
	"RegisterClientCommandFilterCallback",
	"UnregisterClientCommandFilterCallback",
	"RegisterSayCommandCallback",
	"UnregisterSayCommandCallback",
	"RegisterSayCommandFilterCallback",
	"UnregisterSayCommandFilterCallback",
];
const g_vecNamedCallbacks = g_vecCallbacks.filter((strName) => !strName.includes("Filter") && /^(Register|Unregister)/.test(strName));

let g_unRejectedMutationCount = 0;

function ExtractFunction(strSource, strSignaturePrefix) {
	const strDefinition = strSource.split("\n").find((strLine) => strLine.startsWith("\t\t" + strSignaturePrefix) && strLine.endsWith("{"));
	g_Assert.ok(strDefinition, strSignaturePrefix);

	const nStart = strSource.indexOf(strDefinition);
	const nEnd = strSource.indexOf("\n\t\t}\n", nStart);
	g_Assert.ok(nEnd > nStart, strSignaturePrefix);

	return strSource.slice(nStart, nEnd);
}

function AssertCommandContracts(strSource) {
	for (const strCallback of g_vecCallbacks) {
		const strOwner = ExtractFunction(strSource, "void " + strCallback + "(");
		g_Assert.match(strOwner, /\) try \{/);
		g_Assert.ok(strOwner.includes('"' + strCallback + ' failed with a C++ exception."'));
		g_Assert.match(strOwner, /} catch \(\.\.\.\) \{\s*constexpr char kCallbackExceptionError\[\][^\n]+\s*ThrowError\(CallbackInformation\.GetIsolate\(\), kCallbackExceptionError\);/);
	}

	for (const strCallback of g_vecNamedCallbacks) {
		const strOwner = ExtractFunction(strSource, "void " + strCallback + "(");
		g_Assert.match(strOwner, /if \(!ReadCommandName\(CallbackInformation, kNameArgumentIndex, strCommandName\)\) \{\s*return;/);
		g_Assert.ok(!strOwner.includes("ValueToString("));
	}

	const strNameReader = ExtractFunction(strSource, "bool ReadCommandName(");
	g_Assert.match(strNameReader, /if \(!CallbackInformation\[nNameArgumentIndex\]->ToString\(LocalContext\)\.ToLocal\(&LocalName\)\) \{\s*if \(!ConversionFailure\.HasCaught\(\)\) \{\s*ThrowError\(pIsolate, kConversionError\);\s*}\s*ConversionFailure\.ReThrow\(\);\s*return false;/);
	g_Assert.match(strNameReader, /if \(!pszEncodedName\) \{\s*ThrowError\(pIsolate, kConversionError\);\s*ConversionFailure\.ReThrow\(\);\s*return false;/);
	g_Assert.match(strNameReader, /const std::size_t unEncodedNameLength = static_cast<std::size_t>\(UTF8Value\.length\(\)\);/);
	g_Assert.match(strNameReader, /if \(std::memchr\(pszEncodedName, '\\0', unEncodedNameLength\)\) \{\s*ThrowError\(pIsolate, kEmbeddedNULNameError\);\s*ConversionFailure\.ReThrow\(\);\s*return false;/);
	g_Assert.ok(strNameReader.indexOf("strCommandNameOut.assign(") > strNameReader.indexOf("if (std::memchr("), "Commit command name only after complete NUL validation");

	const strDescriptionCallback = ExtractFunction(strSource, "void GetEngineGameDescriptionCallback(");
	g_Assert.match(strDescriptionCallback, /if \(DescriptionFailure\.HasCaught\(\)\) \{\s*DescriptionFailure\.ReThrow\(\);\s*return;/);
	g_Assert.match(strDescriptionCallback, /if \(LocalDescription\.IsEmpty\(\)\) \{\s*ThrowError\(pIsolate, kConstructionError\);\s*DescriptionFailure\.ReThrow\(\);\s*return;/);
}

function AssertRegression(strSignaturePrefix, strOriginal, strReplacement) {
	const strOwner = ExtractFunction(g_strSource, strSignaturePrefix);
	g_Assert.ok(strOwner.includes(strOriginal), strOriginal);
	g_Assert.throws(() => AssertCommandContracts(g_strSource.replace(strOwner, strOwner.replace(strOriginal, strReplacement))), g_Assert.AssertionError, strOriginal);
	++g_unRejectedMutationCount;
}

AssertCommandContracts(g_strSource);
for (const strCallback of g_vecCallbacks) {
	AssertRegression("void " + strCallback + "(", "ThrowError(CallbackInformation.GetIsolate(), kCallbackExceptionError);", "");
}

for (const strCallback of g_vecNamedCallbacks) {
	AssertRegression("void " + strCallback + "(", "if (!ReadCommandName(CallbackInformation, kNameArgumentIndex, strCommandName))", "if (false)");
}

AssertRegression("bool ReadCommandName(", "ConversionFailure.ReThrow();", "");
AssertRegression("bool ReadCommandName(", "if (!pszEncodedName)", "if (false)");
AssertRegression("bool ReadCommandName(", "if (std::memchr(pszEncodedName, '\\0', unEncodedNameLength))", "if (std::memchr(pszEncodedName, '\\0', unEncodedNameLength) == pszEncodedName)");
AssertRegression("bool ReadCommandName(", "static_cast<std::size_t>(UTF8Value.length())", "std::strlen(pszEncodedName)");
AssertRegression("bool ReadCommandName(", "if (std::memchr(", "strCommandNameOut.assign(pszEncodedName, unEncodedNameLength);\n\t\t\tif (std::memchr(");
AssertRegression("void GetEngineGameDescriptionCallback(", "DescriptionFailure.ReThrow();", "");
AssertRegression("void GetEngineGameDescriptionCallback(", "if (LocalDescription.IsEmpty())", "if (false)");

console.log(`[smoke] command source contracts and ${g_unRejectedMutationCount} negative regressions passed; native V8 execution is a separate check`);
