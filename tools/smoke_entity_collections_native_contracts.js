#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_vecArguments = process.argv.slice(2);
if (g_vecArguments.length > 0) {
	const bShowHelp = (g_vecArguments.length === 1) && (g_vecArguments[0] === "--help");
	const strUsage = `Usage: node ${g_Path.relative(process.cwd(), __filename)} [--help]\nChecks entity collection source contracts without native V8/SDK execution.\nUnexpected arguments exit with status 2.\n`;
	g_FileSystem.writeSync(bShowHelp ? process.stdout.fd : process.stderr.fd, strUsage);
	process.exit(bShowHelp ? 0 : 2);
}

const g_strSource = g_FileSystem.readFileSync(g_Path.join(__dirname, "..", "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_strConversionUnwindGuard = "if (ConversionFailure.HasCaught()) {\n\t\t\t\t\t\tConversionFailure.ReThrow();\n\t\t\t\t\t}\n\n\t\t\t\t\tthrow;";

let g_unRegressionCount = 0;

function ExtractFunction(strSource, strSignaturePrefix) {
	const nStart = strSource.indexOf("\n\t\t" + strSignaturePrefix);
	const nEnd = strSource.indexOf("\n\t\t}\n", nStart + 1);
	g_Assert.ok((nStart >= 0) && (nEnd > nStart), strSignaturePrefix);

	return strSource.slice(nStart + 1, nEnd);
}

function AssertEntityContracts(strSource) {
	const strConstants = ExtractFunction(strSource, "bool InstallPlayerConstants(");
	g_Assert.equal((strConstants.match(/SetRecordFunction\(/g) ?? []).length, 2);
	g_Assert.ok(!/Set(?:Function|Integer|Value|String)\(/.test(strConstants));
	for (const strGroup of ["PlayerButtons", "LifeState"]) {
		g_Assert.match(strConstants, new RegExp('if \\(!SetRecordProperty\\([^\\n]+"' + strGroup + '"[^\\n]+\\)\\) \\{\\s*return false;'));
	}

	for (const strSignaturePrefix of ["v8::Local<v8::Array> MakeEntityArray(", "v8::Local<v8::Array> MakeEntityArrayFromIndices("]) {
		const strArray = ExtractFunction(strSource, strSignaturePrefix);
		g_Assert.ok(strArray.includes("LocalEntityArray->CreateDataProperty("));
		g_Assert.ok(!strArray.includes("LocalEntityArray->Set("));
		g_Assert.match(strArray, /if \(LocalEntity(?:Object)?\.IsEmpty\(\)\) \{\s*return \{\};/);
	}

	for (const strSignaturePrefix of ["v8::Local<v8::Array> MakeEntityArray(", "v8::Local<v8::Array> MakeEntityClassNameArray("]) {
		const strArray = ExtractFunction(strSource, strSignaturePrefix);
		g_Assert.match(strArray, /if \(!pIsolate \|\| LocalContext\.IsEmpty\(\) \|\| !pGlobalVariables\) \{\s*return \{\};/);
	}

	for (const strSignaturePrefix of ["v8::Local<v8::Array> MakeEntityArray(", "bool CollectEntityIndices(", "v8::Local<v8::Array> MakeEntityClassNameArray(", "void FindEntityByClassNameCallback("]) {
		const strScan = ExtractFunction(strSource, strSignaturePrefix);
		g_Assert.ok(strScan.includes("const std::size_t unEntityCount = (pGlobalVariables->maxEntities > 0) ? static_cast<std::size_t>(pGlobalVariables->maxEntities) : 0;"));
		g_Assert.ok(strScan.includes("for (std::size_t unEntityIndex = kFirstEntityIndex; unEntityIndex < unEntityCount; ++unEntityIndex)"));
		g_Assert.ok(strScan.includes("const int nEntityIndex = static_cast<int>(unEntityIndex);"));
	}

	const strCollector = ExtractFunction(strSource, "bool CollectEntityIndices(");
	g_Assert.match(strCollector, /if \(!pIsolate \|\| !pszOperationName\) \{\s*return false;/);
	g_Assert.ok(strCollector.includes("std::vector<int> vecEntityIndices = vecEntityIndicesOut;"));
	g_Assert.ok(strCollector.includes("vecEntityIndices.push_back(nEntityIndex);") && !strCollector.includes("vecEntityIndicesOut.push_back("));
	g_Assert.match(strCollector, /vecEntityIndicesOut = std::move\(vecEntityIndices\);\n\n\t\t\treturn true;/);

	const strClasses = ExtractFunction(strSource, "v8::Local<v8::Array> MakeEntityClassNameArray(");
	g_Assert.match(strClasses, /if \(vecClassNames\.size\(\) > kMaximumClassNameCount\) \{\s*return \{\};/);
	g_Assert.match(strClasses, /if \(LocalClassName\.IsEmpty\(\)\) \{\s*return \{\};/);
	g_Assert.ok(strClasses.includes("LocalClassNameArray->CreateDataProperty(") && !strClasses.includes("LocalClassNameArray->Set("));

	const strDictionary = ExtractFunction(strSource, "void GetAllDictionaryEntitiesCallback(");
	g_Assert.equal((strDictionary.match(/SetRecordProperty\(/g) ?? []).length, 2);
	g_Assert.ok(!strDictionary.includes("SetValue(") && !strDictionary.includes("SetInteger("));
	g_Assert.match(strDictionary, /if \(LocalEntity\.IsEmpty\(\)\) \{\s*return;/);

	for (const strSignaturePrefix of ["void GetEntityClassNameCallback(", "void GetEntityFromDictionaryCallback("]) {
		const strCallback = ExtractFunction(strSource, strSignaturePrefix);
		g_Assert.match(strCallback, /if \(!GetEntityIndexFromValue\([^\n]+\)\) \{\s*return;/);
		g_Assert.ok(!strCallback.includes("GetValueIndex("));
		g_Assert.ok(strCallback.indexOf("!GetEntityIndexFromValue(") < strCallback.indexOf("GetEdictFromEntityIndex("));
	}

	for (const strName of ["GetEntityDictionaryValuesCallback", "GetEntityDictionaryEntriesCallback", "GetEntityIndexCallback", "IsEntityValidCallback", "ConvertEntityHelperValueCallback", "GetPlayerIndexCallback"]) {
		const strCallback = ExtractFunction(strSource, "void " + strName + "(");
		g_Assert.ok(strCallback.includes(") try {"));
		g_Assert.ok(strCallback.includes('ThrowError(CallbackInformation.GetIsolate(), "' + strName + ' failed with a C++ exception.");'));
	}

	const strConversion = ExtractFunction(strSource, "void ConvertEntityHelperValueCallback(");
	g_Assert.match(strConversion, /catch \(\.\.\.\) \{\s*if \(ConversionFailure\.HasCaught\(\)\) \{\s*ConversionFailure\.ReThrow\(\);\s*\}\s*throw;/);
}

function AssertRegression(strSignaturePrefix, strOriginal, strReplacement) {
	const strOwner = ExtractFunction(g_strSource, strSignaturePrefix);
	g_Assert.ok(strOwner.includes(strOriginal), strOriginal);
	g_Assert.throws(() => AssertEntityContracts(g_strSource.replace(strOwner, strOwner.replace(strOriginal, strReplacement))), g_Assert.AssertionError, strOriginal);
	++g_unRegressionCount;
}

AssertEntityContracts(g_strSource);
AssertRegression("bool InstallPlayerConstants(", "SetRecordFunction(", "SetFunction(");
AssertRegression("bool InstallPlayerConstants(", 'LocalPlayerConstantsModule, "PlayerButtons"', 'LocalPlayerConstantsModule, "LegacyButtons"');

for (const strSignaturePrefix of ["v8::Local<v8::Array> MakeEntityArray(", "v8::Local<v8::Array> MakeEntityArrayFromIndices("]) {
	AssertRegression(strSignaturePrefix, "LocalEntityArray->CreateDataProperty(", "LocalEntityArray->Set(");
}

AssertRegression("v8::Local<v8::Array> MakeEntityArrayFromIndices(", "if (LocalEntityObject.IsEmpty())", "if (false)");

for (const strSignaturePrefix of ["v8::Local<v8::Array> MakeEntityArray(", "v8::Local<v8::Array> MakeEntityClassNameArray("]) {
	AssertRegression(strSignaturePrefix, "!pIsolate || LocalContext.IsEmpty() || !pGlobalVariables", "!pIsolate || LocalContext.IsEmpty()");
}

AssertRegression("v8::Local<v8::Array> MakeEntityArray(", "LocalContext.IsEmpty()", "LocalContextXIsEmpty()");

for (const strSignaturePrefix of ["v8::Local<v8::Array> MakeEntityArray(", "bool CollectEntityIndices(", "v8::Local<v8::Array> MakeEntityClassNameArray(", "void FindEntityByClassNameCallback("]) {
	AssertRegression(strSignaturePrefix, "unEntityIndex < unEntityCount", "unEntityIndex <= unEntityCount");
}

AssertRegression("bool CollectEntityIndices(", "!pIsolate || !pszOperationName", "!pIsolate");
AssertRegression("bool CollectEntityIndices(", "vecEntityIndices.push_back(nEntityIndex);", "vecEntityIndicesOut.push_back(nEntityIndex);");
AssertRegression("bool CollectEntityIndices(", "vecEntityIndicesOut = std::move(vecEntityIndices);", "vecEntityIndicesOut.clear();");
AssertRegression("v8::Local<v8::Array> MakeEntityClassNameArray(", "LocalClassNameArray->CreateDataProperty(", "LocalClassNameArray->Set(");
AssertRegression("v8::Local<v8::Array> MakeEntityClassNameArray(", "if (LocalClassName.IsEmpty())", "if (false)");
AssertRegression("v8::Local<v8::Array> MakeEntityClassNameArray(", "if (vecClassNames.size() > kMaximumClassNameCount)", "if (false)");
AssertRegression("v8::Local<v8::Array> MakeEntityClassNameArray(", "vecClassNames.size()", "vecClassNamesXsize()");
AssertRegression("v8::Local<v8::Array> MakeEntityClassNameArray(", "LocalClassName.IsEmpty()", "LocalClassNameXIsEmpty()");
AssertRegression("void GetAllDictionaryEntitiesCallback(", "SetRecordProperty(", "SetValue(");
AssertRegression("void GetAllDictionaryEntitiesCallback(", "if (LocalEntity.IsEmpty())", "if (false)");
AssertRegression("void GetAllDictionaryEntitiesCallback(", "LocalEntity.IsEmpty()", "LocalEntityXIsEmpty()");

for (const strSignaturePrefix of ["void GetEntityClassNameCallback(", "void GetEntityFromDictionaryCallback("]) {
	AssertRegression(strSignaturePrefix, "if (!GetEntityIndexFromValue(", "if (GetEntityIndexFromValue(");
}

for (const strName of ["GetEntityDictionaryValuesCallback", "GetEntityDictionaryEntriesCallback", "GetEntityIndexCallback", "IsEntityValidCallback", "ConvertEntityHelperValueCallback", "GetPlayerIndexCallback"]) {
	AssertRegression("void " + strName + "(", 'ThrowError(CallbackInformation.GetIsolate(), "' + strName + ' failed with a C++ exception.");', "return;");
}

AssertRegression("void ConvertEntityHelperValueCallback(", g_strConversionUnwindGuard, "throw;");

for (const strMemberName of ["HasCaught", "ReThrow"]) {
	AssertRegression("void ConvertEntityHelperValueCallback(", g_strConversionUnwindGuard, g_strConversionUnwindGuard.replace("ConversionFailure." + strMemberName, "ConversionFailureX" + strMemberName));
}

console.log("[smoke] Entity collection source contracts and " + g_unRegressionCount + " negative regressions passed; native V8/SDK execution is a separate check");
