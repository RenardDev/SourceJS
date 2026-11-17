#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_vecArguments = process.argv.slice(2);
if (g_vecArguments.length > 0) {
	const bShowHelp = (g_vecArguments.length === 1) && (g_vecArguments[0] === "--help");
	const strUsage = `Usage: node ${g_Path.relative(process.cwd(), __filename)} [--help]\nChecks entity helper source contracts without native V8/SDK execution.\nUnexpected arguments exit with status 2.\n`;
	g_FileSystem.writeSync(bShowHelp ? process.stdout.fd : process.stderr.fd, strUsage);
	process.exit(bShowHelp ? 0 : 2);
}

const g_strSource = g_FileSystem.readFileSync(g_Path.join(__dirname, "..", "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");

let g_unRegressionCount = 0;

function ExtractFunction(strSource, strSignaturePrefix, bNormalize = true) {
	const strDefinition = strSource.split("\n").find((strLine) => (strLine.startsWith("\t" + strSignaturePrefix) || strLine.startsWith("\t\t" + strSignaturePrefix)) && strLine.endsWith("{"));
	g_Assert.ok(strDefinition, "Missing definition: " + strSignaturePrefix);

	const strIndentation = strDefinition.match(/^\t+/)[0];
	const nStart = strSource.indexOf(strDefinition);
	const nEnd = strSource.indexOf("\n" + strIndentation + "}\n", nStart);
	g_Assert.ok((nStart >= 0) && (nEnd > nStart), "Missing definition boundary: " + strSignaturePrefix);

	const strOwner = strSource.slice(nStart, nEnd);
	if (!bNormalize || (strIndentation === "\t")) {
		return strOwner;
	}

	return strOwner.split("\n").map((strLine) => strLine.startsWith(strIndentation) ? "\t" + strLine.slice(strIndentation.length) : strLine).join("\n");
}

function AssertEntityHelperContracts(strSource) {
	for (const strSignaturePrefix of ["void HasEntityInDictionaryCallback(", "void GetEntityIndexCallback(", "void IsEntityValidCallback(", "void GetPlayerIndexCallback("]) {
		const strCallback = ExtractFunction(strSource, strSignaturePrefix);
		g_Assert.match(strCallback, /if \([^\n]*!GetEntityIndexFromValue\([^\n]+\)\) \{\s*return;/);
		g_Assert.ok(!strCallback.includes("GetValueIndex("));
		g_Assert.ok(strCallback.indexOf("GetEntityIndexFromValue(") < strCallback.indexOf("CallbackInformation.GetReturnValue().Set("));

		if (strCallback.includes("GetEdictFromEntityIndex(")) {
			g_Assert.ok(strCallback.indexOf("GetEntityIndexFromValue(") < strCallback.indexOf("GetEdictFromEntityIndex("));
		}
	}

	for (const strSignaturePrefix of ["void GetEntityIndexCallback(", "void IsEntityValidCallback(", "void GetPlayerIndexCallback("]) {
		const strCallback = ExtractFunction(strSource, strSignaturePrefix);
		g_Assert.ok(strCallback.includes("int nEntityIndex = kInvalidEntityIndex;"));
		g_Assert.match(strCallback, /if \(\(CallbackInformation.Length\(\) > k(?:Entity|Player)ArgumentIndex\) && !GetEntityIndexFromValue\(/);
	}

	const strMembership = ExtractFunction(strSource, "void HasEntityInDictionaryCallback(");
	g_Assert.match(strMembership, /if \(!RequireEntityGlobals\([^\n]+\)\) \{\s*return;/);

	for (const strSignaturePrefix of ["void GetEntityDictionaryKeysCallback(", "void GetEntityDictionaryValuesCallback("]) {
		const strCallback = ExtractFunction(strSource, strSignaturePrefix);
		g_Assert.match(strCallback, /if \(!CollectEntityIndices\([^\n]+\)\) \{\s*return;/);
		g_Assert.match(strCallback, /if \(LocalEntityDictionary(?:Keys|Values)\.IsEmpty\(\)\) \{\s*return;/);
	}

	const strEntries = ExtractFunction(strSource, "void GetEntityDictionaryEntriesCallback(");
	g_Assert.equal((strEntries.match(/->CreateDataProperty\(/g) ?? []).length, 3);
	g_Assert.ok(!strEntries.includes("->Set("));
	g_Assert.ok(strEntries.includes("vecEntityIndices.size() > kMaximumEntryCount"));
	g_Assert.match(strEntries, /if \(LocalEntityIndex\.IsEmpty\(\) \|\| LocalEntity\.IsEmpty\(\)\) \{\s*return;/);
	g_Assert.equal((strEntries.match(/if \(MaybeSet\w+Result\.IsNothing\(\) \|\| !MaybeSet\w+Result\.FromJust\(\)\) \{\s*return;/g) ?? []).length, 3);

	const strHandle = ExtractFunction(strSource, "bool GetEntityHelperUnsignedHandleFromValue(");
	g_Assert.match(strHandle, /if \(LocalValue\.IsEmpty\(\) \|\| !LocalValue->IsUint32\(\)\) \{\s*return false;/);

	const strRecord = ExtractFunction(strSource, "bool GetEntityHelperRecordUnsignedValue(");
	g_Assert.match(strRecord, /MaybeHasKindProperty = LocalRecord->HasOwnProperty\([^\n]+\);\n\t\tif \(MaybeHasKindProperty\.IsNothing\(\) \|\| !MaybeHasKindProperty\.FromJust\(\)\) \{\s*return false;\n\t\t}\n\n\t\tv8::Maybe<bool> const MaybeHasValueProperty/);
	g_Assert.match(strRecord, /if \(MaybeHasValueProperty\.IsNothing\(\) \|\| !MaybeHasValueProperty\.FromJust\(\)\) \{\s*return false;/);
	g_Assert.ok(strRecord.includes('ValueToString(pIsolate, LocalKindValue) != pszExpectedKind'));
	g_Assert.ok(strRecord.includes('std::strcmp(pszExpectedKind, "basehandle") == 0'));
	g_Assert.ok(strRecord.includes('std::strcmp(pszPropertyName, "Value") == 0'));
	g_Assert.match(strRecord, /if \(!LocalPropertyValue->IsUint32\(\)\) \{\s*return false;/);
	g_Assert.ok(strRecord.includes("return GetAddressSizedUnsignedIntegerFromValue(LocalPropertyValue, unValueOut);"));

	const strResolver = ExtractFunction(strSource, "bool GetEntityIndexFromHelperConversionValue(");
	g_Assert.equal((strResolver.match(/nEntityIndexOut/g) ?? []).length, 2);
	g_Assert.match(strResolver, /default:\n\t\t\t\treturn false;\n\t\t}\n\n\t\tnEntityIndexOut = nEntityIndex;\n\n\t\treturn true;$/);
	g_Assert.equal((strResolver.match(/case EntityHelperValue::/g) ?? []).length, 6);
	g_Assert.ok(strResolver.includes('"edict", "Address"'));
	g_Assert.ok(strResolver.includes('"baseentity", "Address"'));
	g_Assert.ok(strResolver.includes('"basehandle", "Value"'));

	const strConversion = ExtractFunction(strSource, "void ConvertEntityHelperValueCallback(");
	g_Assert.match(strConversion, /v8::TryCatch ConversionFailure\(pIsolate\);\n\t{3}try \{\n\t{4}if \(!GetEntityIndexFromHelperConversionValue\([^\n]+\)\) \{\n\t{5}if \(ConversionFailure\.HasCaught\(\)\) \{\s*ConversionFailure\.ReThrow\(\);\s*return;/);
	g_Assert.ok(strConversion.indexOf("ConversionFailure.HasCaught()") < strConversion.indexOf("std::string const strErrorMessage"));
	g_Assert.match(strConversion, /ThrowError\(pIsolate, strErrorMessage\.c_str\(\)\);\n\t{5}ConversionFailure\.ReThrow\(\);\n\t{5}return;/);
	g_Assert.match(strConversion, /} catch \(\.\.\.\) \{\n\t{4}if \(ConversionFailure\.HasCaught\(\)\) \{\n\t{5}ConversionFailure\.ReThrow\(\);\n\t{4}}\n\n\t{4}throw;/);
	g_Assert.ok(strConversion.includes("!LocalConversionData->IsInt32()"));
	for (const strResult of ["LocalEdict", "LocalBaseEntity", "LocalBaseHandle", "LocalIntegerHandle", "LocalAddressValue"]) {
		g_Assert.match(strConversion, new RegExp("if \\(" + strResult + "\\.IsEmpty\\(\\)\\) \\{\\s*return;"));
	}

	g_Assert.ok(strConversion.includes("MakeEntityAddressValue(pIsolate, pEntity)"));
}

function AssertRegression(strSignaturePrefix, strOriginal, strReplacement) {
	const strOwner = ExtractFunction(g_strSource, strSignaturePrefix);
	g_Assert.ok(strOwner.includes(strOriginal), strOriginal);

	const strActualOwner = ExtractFunction(g_strSource, strSignaturePrefix, false);
	const strMutatedOwner = strOwner.replace(strOriginal, strReplacement);
	const strActualReplacement = (strActualOwner === strOwner) ? strMutatedOwner : strMutatedOwner.split("\n").map((strLine) => strLine.startsWith("\t") ? "\t" + strLine : strLine).join("\n");
	const strMutatedSource = g_strSource.replace(strActualOwner, () => strActualReplacement);
	g_Assert.notEqual(strMutatedSource, g_strSource, "Mutation must alter the actual native definition: " + strSignaturePrefix);
	g_Assert.throws(() => AssertEntityHelperContracts(strMutatedSource), g_Assert.AssertionError, strOriginal);
	++g_unRegressionCount;
}

AssertEntityHelperContracts(g_strSource);

for (const strSignaturePrefix of ["void HasEntityInDictionaryCallback(", "void GetEntityIndexCallback(", "void IsEntityValidCallback(", "void GetPlayerIndexCallback("]) {
	AssertRegression(strSignaturePrefix, "!GetEntityIndexFromValue(", "GetEntityIndexFromValue(");
}

for (const strSignaturePrefix of ["void GetEntityIndexCallback(", "void IsEntityValidCallback(", "void GetPlayerIndexCallback("]) {
	AssertRegression(strSignaturePrefix, "int nEntityIndex = kInvalidEntityIndex;", "int nEntityIndex = 0;");
}

AssertRegression("void HasEntityInDictionaryCallback(", "!RequireEntityGlobals(", "RequireEntityGlobals(");

for (const strSignaturePrefix of ["void GetEntityDictionaryKeysCallback(", "void GetEntityDictionaryValuesCallback("]) {
	AssertRegression(strSignaturePrefix, "!CollectEntityIndices(", "CollectEntityIndices(");
}

AssertRegression("void GetEntityDictionaryKeysCallback(", "if (LocalEntityDictionaryKeys.IsEmpty())", "if (false)");
AssertRegression("void GetEntityDictionaryValuesCallback(", "if (LocalEntityDictionaryValues.IsEmpty())", "if (false)");
AssertRegression("void GetEntityDictionaryEntriesCallback(", "LocalEntryPair->CreateDataProperty(", "LocalEntryPair->Set(");
AssertRegression("void GetEntityDictionaryEntriesCallback(", "LocalEntryArray->CreateDataProperty(", "LocalEntryArray->Set(");
AssertRegression("void GetEntityDictionaryEntriesCallback(", "vecEntityIndices.size() > kMaximumEntryCount", "vecEntityIndices.size() >= kMaximumEntryCount");
AssertRegression("void GetEntityDictionaryEntriesCallback(", "LocalEntityIndex.IsEmpty() || LocalEntity.IsEmpty()", "LocalEntityIndex.IsEmpty()");
AssertRegression("void GetEntityDictionaryEntriesCallback(", "MaybeSetEntityResult.IsNothing() || !MaybeSetEntityResult.FromJust()", "false");
AssertRegression("bool GetEntityHelperUnsignedHandleFromValue(", "!LocalValue->IsUint32()", "!LocalValue->IsNumber()");
AssertRegression("bool GetEntityHelperRecordUnsignedValue(", "MaybeHasKindProperty.IsNothing() || !MaybeHasKindProperty.FromJust()", "false");
AssertRegression("bool GetEntityHelperRecordUnsignedValue(", "MaybeHasValueProperty.IsNothing() || !MaybeHasValueProperty.FromJust()", "false");
AssertRegression("bool GetEntityHelperRecordUnsignedValue(", "ValueToString(pIsolate, LocalKindValue) != pszExpectedKind", "false");
AssertRegression("bool GetEntityHelperRecordUnsignedValue(", "!LocalPropertyValue->IsUint32()", "!LocalPropertyValue->IsNumber()");
AssertRegression("bool GetEntityHelperRecordUnsignedValue(", "GetAddressSizedUnsignedIntegerFromValue(LocalPropertyValue, unValueOut)", "GetValueUnsignedInteger(LocalPropertyValue, unValueOut)");
AssertRegression("bool GetEntityIndexFromHelperConversionValue(", "nEntityIndexOut = nEntityIndex;", "nEntityIndexOut = kInvalidEntityIndex;");
AssertRegression("bool GetEntityIndexFromHelperConversionValue(", '"edict", "Address"', '"edict", "LegacyAddress"');
AssertRegression("void ConvertEntityHelperValueCallback(", "ConversionFailure.HasCaught()", "false");
AssertRegression("void ConvertEntityHelperValueCallback(", "ConversionFailure.ReThrow();", "ConversionFailure.Reset();");
AssertRegression("void ConvertEntityHelperValueCallback(", "ConversionFailure(pIsolate);\n\t\t\ttry {", "ConversionFailure(pIsolate);\n\t\t\tif (true) {");
AssertRegression("void ConvertEntityHelperValueCallback(", "if (ConversionFailure.HasCaught()) {\n\t\t\t\t\tConversionFailure.ReThrow();\n\t\t\t\t}\n\n\t\t\t\tthrow;", "throw;");
AssertRegression("void ConvertEntityHelperValueCallback(", "!LocalConversionData->IsInt32()", "!LocalConversionData->IsNumber()");

for (const strResult of ["LocalEdict", "LocalBaseEntity", "LocalBaseHandle", "LocalIntegerHandle", "LocalAddressValue"]) {
	AssertRegression("void ConvertEntityHelperValueCallback(", "if (" + strResult + ".IsEmpty())", "if (false)");
}

console.log("[smoke] Entity helper source contracts and " + g_unRegressionCount + " negative regressions passed; native V8/SDK execution is a separate check");
