#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_strUsage = "Usage: node tools/smoke_entity_hook_native_contracts.js [--help]";
const g_vecCallbacks = ["GetHookListCallback", "CreateEntityHookCallback", "CreateEntityVTableHookCallback", "AddPreEntityHookCallback", "AddPostEntityHookCallback"];
const g_vecCreationCallbacks = g_vecCallbacks.slice(1);
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
let g_unNegativeRegressionCount = 0;

function ExtractFunction(strSource, strSignaturePrefix) {
	const strDefinition = strSource.split("\n").find((strLine) => strLine.startsWith("\t\t" + strSignaturePrefix) && strLine.endsWith("{"));
	g_Assert.ok(strDefinition, strSignaturePrefix);

	const nStart = strSource.indexOf(strDefinition);
	const nEnd = strSource.indexOf("\n\t\t}\n", nStart);
	g_Assert.ok(nEnd > nStart, strSignaturePrefix);

	return strSource.slice(nStart, nEnd);
}

function AssertHookContracts(strSource) {
	for (const strCallback of g_vecCallbacks) {
		const strOwner = ExtractFunction(strSource, "void " + strCallback + "(");
		g_Assert.match(strOwner, /\) try \{/);
		g_Assert.ok(strOwner.includes('"' + strCallback + ' failed with a C++ exception."'));
		g_Assert.match(strOwner, /} catch \(\.\.\.\) \{\s*constexpr char kCallbackExceptionError\[\][^\n]+\s*ThrowError\(CallbackInformation\.GetIsolate\(\), kCallbackExceptionError\);/);
	}

	for (const strCallback of g_vecCreationCallbacks) {
		const strOwner = ExtractFunction(strSource, "void " + strCallback + "(");
		g_Assert.match(strOwner, /v8::TryCatch OptionsFailure\(pIsolate\);/);
		g_Assert.match(strOwner, /if \(!OptionsFailure\.HasCaught\(\)\) \{\s*ThrowError\(pIsolate, kArgumentError\);\s*}\s*OptionsFailure\.ReThrow\(\);\s*return;/);
		g_Assert.match(strOwner, /OptionsFailure\.ReThrow\(\);\s*return;\s*}\s*} catch \(\.\.\.\) \{\s*if \(OptionsFailure\.HasCaught\(\)\) \{\s*OptionsFailure\.ReThrow\(\);\s*}\s*throw;\s*}\s*}\s*const int nHookID = CreateEntityHookID/);
		g_Assert.match(strOwner, /if \(nHookID <= kInvalidHookID\)/);
	}

	const strProperty = ExtractFunction(strSource, "bool ReadDefinedObjectProperty(");
	g_Assert.match(strProperty, /if \(LocalName\.IsEmpty\(\)\) \{\s*return false;/);
	g_Assert.match(strProperty, /bDefinedOut = !LocalValue->IsUndefined\(\) && !LocalValue->IsNull\(\);\s*return true;/);

	const strNormalization = ExtractFunction(strSource, "bool NormalizeEntityHookEntityOption(");
	g_Assert.match(strNormalization, /if \(!ReadEntityIndex\(pIsolate, LocalContext, LocalEntityValue, nEntityIndex\)\) \{\s*return false;/);

	const strSelection = ExtractFunction(strSource, "bool ReadEntityHookVTableOption(");
	g_Assert.match(strSelection, /if \(OptionFailure\.HasCaught\(\)\) \{\s*OptionFailure\.ReThrow\(\);\s*return false;/);
	g_Assert.ok(strSelection.includes('kFunctionHookKind[] = "FUNCTION"'));
	g_Assert.ok(strSelection.includes('kVTableHookKind[] = "VTABLE"'));

	const strCreation = ExtractFunction(strSource, "int CreateEntityHookID(");
	g_Assert.match(strCreation, /if \(!bForceVTable && !ReadEntityHookVTableOption\(pIsolate, LocalContext, LocalOptions, bUseVTable\)\) \{\s*return kInvalidHookID;/);

	const strCallbackOptions = ExtractFunction(strSource, "bool ReadEntityHookCallbackOptions(");
	g_Assert.ok(strCallbackOptions.includes("ReadEntityHookCreationOptions(CallbackInformation, nCallbackArgumentIndex, LocalOptions)"));
}

function AssertRegression(strSignaturePrefix, strOriginal, strReplacement) {
	const strOwner = ExtractFunction(g_strSource, strSignaturePrefix);
	g_Assert.ok(strOwner.includes(strOriginal), strOriginal);

	const strMutatedSource = g_strSource.replace(strOwner, () => strOwner.replace(strOriginal, () => strReplacement));
	g_Assert.notEqual(strMutatedSource, g_strSource, strOriginal);
	g_Assert.throws(() => AssertHookContracts(strMutatedSource), g_Assert.AssertionError, strOriginal);
	g_unNegativeRegressionCount += 1;
}

AssertHookContracts(g_strSource);

for (const strCallback of g_vecCallbacks) {
	AssertRegression("void " + strCallback + "(", "ThrowError(CallbackInformation.GetIsolate(), kCallbackExceptionError);", "");
}

for (const strCallback of g_vecCreationCallbacks) {
	AssertRegression("void " + strCallback + "(", "OptionsFailure.ReThrow();", "");
}

AssertRegression("bool ReadDefinedObjectProperty(", "if (LocalName.IsEmpty())", "if (false)");
AssertRegression("bool NormalizeEntityHookEntityOption(", "if (!ReadEntityIndex(pIsolate, LocalContext, LocalEntityValue, nEntityIndex))", "if (false)");
AssertRegression("bool ReadEntityHookVTableOption(", "OptionFailure.ReThrow();", "");
AssertRegression("int CreateEntityHookID(", "if (!bForceVTable && !ReadEntityHookVTableOption(pIsolate, LocalContext, LocalOptions, bUseVTable))", "if (false)");
AssertRegression("bool ReadEntityHookCallbackOptions(", "ReadEntityHookCreationOptions(CallbackInformation, nCallbackArgumentIndex, LocalOptions)", "ReadEntityHookCreationOptions(CallbackInformation, CallbackInformation.Length(), LocalOptions)");

console.log(`[smoke] entity-hook source contracts and ${g_unNegativeRegressionCount} negative regressions passed; native V8 execution is a separate check`);
