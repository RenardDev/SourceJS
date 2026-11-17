#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_vecArguments = process.argv.slice(2);
if (g_vecArguments.length > 0) {
	const bShowHelp = (g_vecArguments.length === 1) && (g_vecArguments[0] === "--help");
	const strUsage = `Usage: node ${g_Path.relative(process.cwd(), __filename)} [--help]\nChecks entity/weapon factory source guards without native V8 execution.\nUnexpected arguments exit with status 2.\n`;
	g_FileSystem.writeSync(bShowHelp ? process.stdout.fd : process.stderr.fd, strUsage);
	process.exit(bShowHelp ? 0 : 2);
}

const g_strNativeSource = g_FileSystem.readFileSync(g_Path.join(__dirname, "..", "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_vecEntityProperties = ["Index", "Valid", "Free", "ClassName", "StateFlags", "NetworkSerialNumber", "Edict", "BaseEntity", "Address", "BaseHandle", "HandleValue"];

let g_unRegressionCount = 0;

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

function AssertFactoryContracts(strSource) {
	const strInstaller = ExtractFunction(strSource, "bool InstallEntityLiveProperty(");
	g_Assert.match(strInstaller, /const LocalPropertyName = MakeString\(pIsolate, pszPropertyName\);\s*if \(LocalPropertyName\.IsEmpty\(\)\) \{\s*return false;\s*}/);
	g_Assert.match(strInstaller, /SetNativeDataProperty\(LocalContext, LocalPropertyName, GetEntityLivePropertyCallback, SetEntityLivePropertyCallback,/);

	const strEntityFactory = ExtractFunction(strSource, "v8::Local<v8::Object> MakeEntityObject(");
	const vecProperties = Array.from(strEntityFactory.matchAll(/\{ "([^"]+)", EntityLiveProperty::[^}]+ \}/g), (vecMatch) => vecMatch[1]);
	g_Assert.deepEqual(vecProperties, g_vecEntityProperties);

	for (const strSignaturePrefix of ["v8::Local<v8::Object> MakeEntityObject(", "v8::Local<v8::Object> MakeWeaponObject("]) {
		const strFactory = ExtractFunction(strSource, strSignaturePrefix);
		g_Assert.match(strFactory, /v8::TryCatch PropertyInstallationFailure\(pIsolate\);/);
		const vecFailureBranches = Array.from(strFactory.matchAll(/if \(!InstallEntityLiveProperty\([^\n]+\)\) \{([\s\S]*?ThrowError\(pIsolate, kPropertyInstallationError\);[\s\S]*?return \{\};)/g), (vecMatch) => vecMatch[1]);
		g_Assert.equal(vecFailureBranches.length, strSignaturePrefix.includes("MakeWeaponObject") ? 2 : 1);

		for (const strBranch of vecFailureBranches) {
			g_Assert.match(strBranch, /if \(PropertyInstallationFailure\.HasCaught\(\)\) \{\s*PropertyInstallationFailure\.ReThrow\(\);\s*return \{\};/);
			g_Assert.match(strBranch, /ThrowError\(pIsolate, kPropertyInstallationError\);\s*PropertyInstallationFailure\.ReThrow\(\);\s*return \{\};/);
		}
	}
}

function AssertRegression(strSignaturePrefix, strOriginal, strReplacement, unOccurrence = 0) {
	const strOwner = ExtractFunction(g_strNativeSource, strSignaturePrefix);
	const vecParts = strOwner.split(strOriginal);
	g_Assert.ok(vecParts.length > (unOccurrence + 1), strSignaturePrefix + strOriginal);
	const unOffset = vecParts.slice(0, unOccurrence + 1).join(strOriginal).length;
	const strMutatedOwner = strOwner.slice(0, unOffset) + strReplacement + strOwner.slice(unOffset + strOriginal.length);
	g_Assert.throws(() => AssertFactoryContracts(g_strNativeSource.replace(strOwner, strMutatedOwner)), g_Assert.AssertionError, strSignaturePrefix + strOriginal);
	++g_unRegressionCount;
}

AssertFactoryContracts(g_strNativeSource);
AssertRegression("bool InstallEntityLiveProperty(", "if (LocalPropertyName.IsEmpty())", "if (false)");
AssertRegression("v8::Local<v8::Object> MakeEntityObject(", "if (PropertyInstallationFailure.HasCaught())", "if (false)");
AssertRegression("v8::Local<v8::Object> MakeEntityObject(", "PropertyInstallationFailure.ReThrow();\n\t\t\t\t\t\treturn {};", "return {};");
AssertRegression("v8::Local<v8::Object> MakeEntityObject(", "ThrowError(pIsolate, kPropertyInstallationError);\n\t\t\t\t\tPropertyInstallationFailure.ReThrow();", "ThrowError(pIsolate, kPropertyInstallationError);");

for (const unOccurrence of [0, 1]) {
	AssertRegression("v8::Local<v8::Object> MakeWeaponObject(", "if (PropertyInstallationFailure.HasCaught())", "if (false)", unOccurrence);
	AssertRegression("v8::Local<v8::Object> MakeWeaponObject(", "PropertyInstallationFailure.ReThrow();\n\t\t\t\t\treturn {};", "return {};", unOccurrence);
	AssertRegression("v8::Local<v8::Object> MakeWeaponObject(", "ThrowError(pIsolate, kPropertyInstallationError);\n\t\t\t\tPropertyInstallationFailure.ReThrow();", "ThrowError(pIsolate, kPropertyInstallationError);", unOccurrence);
}

AssertRegression("v8::Local<v8::Object> MakeEntityObject(", "{ \"Address\", EntityLiveProperty::Address }", "{ \"address\", EntityLiveProperty::Address }");

console.log(`[smoke] entity/weapon factory source guards and ${g_unRegressionCount} negative regressions passed; native V8 execution is a separate check`);
