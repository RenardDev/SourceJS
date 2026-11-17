#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

if (process.argv.length > 2) {
	if ((process.argv.length === 3) && ["--help", "-h"].includes(process.argv[2])) {
		console.log("Usage: node tools/smoke_weapons_native_contracts.js\nChecks source contracts only; does not execute live V8 or game-engine code.");
		process.exit(0);
	}

	console.error("Usage: node tools/smoke_weapons_native_contracts.js");
	process.exit(2);
}

const g_strSource = g_FileSystem.readFileSync(g_Path.join(__dirname, "..", "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");
const g_vecBoundaryContracts = [
	{ Name: "RequireWeaponsStringArgument", Frame: "WeaponsArgumentReadFailure", Error: "kWeaponsArgumentReadErrorMessage", Result: "false" },
	{ Name: "RequireWeaponsIndexArgument", Frame: "WeaponsArgumentReadFailure", Error: "kWeaponsArgumentReadErrorMessage", Result: "false" },
	{ Name: "MakeWeaponArrayFromIndexes", Frame: "WeaponsArrayConstructionFailure", Error: "kWeaponsArrayConstructionErrorMessage", Result: "{}" },
	{ Name: "MakeWeaponNameArray", Frame: "WeaponsArrayConstructionFailure", Error: "kWeaponsArrayConstructionErrorMessage", Result: "{}" },
	{ Name: "GetAllWeaponsCallback", Frame: "WeaponsOperationFailure", Error: "kWeaponsCallbackErrorMessage", Result: "" },
	{ Name: "GetWeaponsByClassNameCallback", Frame: "WeaponsOperationFailure", Error: "kWeaponsCallbackErrorMessage", Result: "" },
	{ Name: "GetWeaponsByNameCallback", Frame: "WeaponsOperationFailure", Error: "kWeaponsCallbackErrorMessage", Result: "" },
	{ Name: "GetWeaponCallback", Frame: "WeaponsOperationFailure", Error: "kWeaponsCallbackErrorMessage", Result: "" },
	{ Name: "GetWeaponClassNameCallback", Frame: "WeaponsOperationFailure", Error: "kWeaponsCallbackErrorMessage", Result: "" },
	{ Name: "GetWeaponNameCallback", Frame: "WeaponsOperationFailure", Error: "kWeaponsCallbackErrorMessage", Result: "" },
	{ Name: "GetWeaponNamesCallback", Frame: "WeaponsOperationFailure", Error: "kWeaponsCallbackErrorMessage", Result: "" },
	{ Name: "GetWeaponClassNamesCallback", Frame: "WeaponsOperationFailure", Error: "kWeaponsCallbackErrorMessage", Result: "" },
	{ Name: "GetWeaponCountCallback", Frame: "WeaponsOperationFailure", Error: "kWeaponsCallbackErrorMessage", Result: "" },
	{ Name: "RemoveWeaponCallback", Frame: "WeaponsOperationFailure", Error: "kWeaponsCallbackErrorMessage", Result: "" },
	{ Name: "GetAllWeaponsDictionaryCallback", Frame: "WeaponsOperationFailure", Error: "kWeaponsCallbackErrorMessage", Result: "" },
	{ Name: "HasWeaponDictionaryEntryCallback", Frame: "WeaponsOperationFailure", Error: "kWeaponsCallbackErrorMessage", Result: "" },
	{ Name: "GetWeaponsDictionaryKeysCallback", Frame: "WeaponsOperationFailure", Error: "kWeaponsCallbackErrorMessage", Result: "" },
	{ Name: "GetWeaponsDictionaryValuesCallback", Frame: "WeaponsOperationFailure", Error: "kWeaponsCallbackErrorMessage", Result: "" },
	{ Name: "GetWeaponsDictionaryEntriesCallback", Frame: "WeaponsOperationFailure", Error: "kWeaponsCallbackErrorMessage", Result: "" },
];

const g_vecArgumentContracts = [
	{ Name: "RequireWeaponsStringArgument", Conversion: "ValueToString(pIsolate, LocalStringArgument);", Output: "strArgumentValueOut = strArgumentValue;" },
	{ Name: "RequireWeaponsIndexArgument", Conversion: "GetValueIndex(pIsolate, LocalContext, LocalWeaponReferenceArgument);", Output: "nWeaponIndexOut = nWeaponIndex;" },
];

const g_vecArrayContracts = [
	{ Name: "MakeWeaponArrayFromIndexes", Array: "LocalWeaponArray", Value: "LocalWeaponObject" },
	{ Name: "MakeWeaponNameArray", Array: "LocalWeaponNamesArray", Value: "LocalWeaponName" },
];

const g_vecIndexCallbackNames = [
	"GetWeaponClassNameCallback",
	"GetWeaponNameCallback",
	"RemoveWeaponCallback",
	"HasWeaponDictionaryEntryCallback",
];

const g_vecEntryPropertyContracts = [
	"LocalWeaponEntryArray->CreateDataProperty(LocalContext, kWeaponIndexElementIndex, LocalWeaponIndex);",
	"LocalWeaponEntryArray->CreateDataProperty(LocalContext, kWeaponObjectElementIndex, LocalWeaponObject);",
	"LocalWeaponEntriesArray->CreateDataProperty(LocalContext, unWeaponEntryIndex, LocalWeaponEntryArray);",
];

const g_vecInstalledMethodNames = [
	"GetProperty",
	"SetProperty",
	"GetPropertyInteger",
	"SetPropertyInteger",
	"GetPropertyFloat",
	"SetPropertyFloat",
	"GetPropertyString",
	"SetPropertyString",
	"GetPropertyStringArray",
	"SetPropertyStringArray",
	"GetPropertyEntity",
	"SetPropertyEntity",
	"GetAmmo",
	"SetAmmo",
];

const g_unConstantOwnWriteCount = 44;
const g_strCallbackFailureGuard = "\n\t\t\tif (WeaponsOperationFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, WeaponsOperationFailure, nullptr);\n\t\t\t\treturn;\n\t\t\t}";

let g_unRejectedMutationCount = 0;

function GetDefinitionRegion(strSource, strName) {
	const strEscapedName = strName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const strNameToken = strName + "(";
	const HeaderPattern = new RegExp("^(\\t{1,2})(?:bool|void|v8::Local<v8::Array>) " + strEscapedName + "\\([^\\n;{}]*\\)(?: noexcept)? \\{$");
	const vecDefinitions = [];
	let nCandidateIndex = strSource.indexOf(strNameToken);
	while (nCandidateIndex >= 0) {
		const unLineStart = strSource.lastIndexOf("\n", nCandidateIndex) + 1;
		const nLineEnd = strSource.indexOf("\n", nCandidateIndex);
		const unLineEnd = (nLineEnd < 0) ? strSource.length : nLineEnd;
		const vecCandidate = HeaderPattern.exec(strSource.slice(unLineStart, unLineEnd));
		if (vecCandidate) {
			vecDefinitions.push({ Start: unLineStart, Indentation: vecCandidate[1], HeaderLength: vecCandidate[0].length });
		}

		nCandidateIndex = strSource.indexOf(strNameToken, unLineEnd);
	}

	g_Assert.equal(vecDefinitions.length, 1, "Expected one native definition: " + strName);
	const Definition = vecDefinitions[0];
	const ClosingPattern = new RegExp("^" + Definition.Indentation + "\\}$", "gm");
	ClosingPattern.lastIndex = Definition.Start + Definition.HeaderLength;
	const vecClosing = ClosingPattern.exec(strSource);
	g_Assert(vecClosing && (vecClosing.index > Definition.Start), "Missing native closing brace: " + strName);

	return { Start: Definition.Start, End: vecClosing.index + vecClosing[0].length, Indentation: Definition.Indentation };
}

function GetDefinition(strSource, strName) {
	const Region = GetDefinitionRegion(strSource, strName);

	// Normalize the contract view only; controls must mutate the real source region.
	return strSource.slice(Region.Start, Region.End).split("\n").map(strLine => (strLine.startsWith(Region.Indentation) && !/^\s*#/.test(strLine)) ? "\t" + strLine.slice(Region.Indentation.length) : strLine).join("\n");
}

function ReplaceDefinition(strSource, strName, strBody) {
	const Region = GetDefinitionRegion(strSource, strName);
	const strReplacement = strBody.split("\n").map(strLine => (strLine.startsWith("\t") && !/^\s*#/.test(strLine)) ? Region.Indentation + strLine.slice(1) : strLine).join("\n");

	return strSource.slice(0, Region.Start) + strReplacement + strSource.slice(Region.End);
}

function CheckDefinitionExtraction() {
	for (const strIndentation of ["\t", "\t\t"]) {
		const strPrototype = strIndentation + "bool Probe(int nValue); // marker ) {\n";
		const strUnrelated = strIndentation + "bool Other(int nValue) {\n" + strIndentation + "\treturn Probe(nValue);\n" + strIndentation + "}\n";
		const strDefinition = strIndentation + "bool Probe(int nValue) noexcept {\n#if TEST\n" + strIndentation + "\treturn true;\n#endif\n" + strIndentation + "}";
		const strSource = strPrototype + strUnrelated + strDefinition + "\n";
		const strNormalized = (strIndentation === "\t\t") ? strDefinition.replace(/^\t/gm, "") : strDefinition;
		g_Assert.equal(GetDefinition(strSource, "Probe"), strNormalized);
		g_Assert.equal(ReplaceDefinition(strSource, "Probe", strNormalized), strSource);

		const strIndented = strSource.replace(/^#/gm, "\t#");
		const strIndentedBody = GetDefinition(strIndented, "Probe");
		g_Assert.equal(strIndentedBody, strNormalized.replace(/^#/gm, "\t#"));
		g_Assert.equal(ReplaceDefinition(strIndented, "Probe", strIndentedBody), strIndented);
		g_Assert.equal(GetDefinition(strIndentation + "bool Probe() {\n" + strIndentation + "}\n", "Probe"), "\tbool Probe() {\n\t}");
		g_Assert.throws(() => GetDefinition(strPrototype + strUnrelated, "Probe"), { code: "ERR_ASSERTION" });
		g_Assert.throws(() => GetDefinition(strDefinition + "\n" + strDefinition + "\n", "Probe"), { code: "ERR_ASSERTION" });
	}
}

function CheckContracts(strSource) {
	for (const Contract of g_vecBoundaryContracts) {
		const strDefinition = GetDefinition(strSource, Contract.Name);
		g_Assert(strDefinition.includes("v8::TryCatch " + Contract.Frame + "(pIsolate);\n\t\ttry {"), Contract.Name + ": V8 frame must survive C++ unwinding.");

		for (const strCatchType of ["std::exception const&", "..."]) {
			const strReturn = Contract.Result ? "\n\t\t\treturn " + Contract.Result + ";" : "";
			g_Assert(strDefinition.includes("} catch (" + strCatchType + ") {\n\t\t\tRethrowV8InstallationFailure(pIsolate, " + Contract.Frame + ", " + Contract.Error + ");" + strReturn + "\n\t\t}"), Contract.Name + ": contextual C++ exception translation.");
		}

		for (const vecFailureGuard of strDefinition.matchAll(/^(\t{3,4})if \([^\n]+\) \{\n((?:\1\t[^\n]*\n)+)\1\}/gm)) {
			const strGuard = vecFailureGuard[0];
			if (!strGuard.includes("return " + Contract.Result + ";") && !strGuard.includes("return;")) {
				continue;
			}

			g_Assert(strGuard.includes("RethrowV8InstallationFailure(pIsolate, " + Contract.Frame + ","), Contract.Name + ": every failed operation must preserve its error.");
		}
	}

	for (const Contract of g_vecArgumentContracts) {
		const strDefinition = GetDefinition(strSource, Contract.Name);
		const strFailureGuard = "\n\t\t\tif (WeaponsArgumentReadFailure.HasCaught() || pIsolate->IsExecutionTerminating() || pIsolate->HasPendingException()) {\n\t\t\t\tRethrowV8InstallationFailure(pIsolate, WeaponsArgumentReadFailure, nullptr);\n\t\t\t\treturn false;\n\t\t\t}";
		g_Assert(strDefinition.includes(Contract.Conversion + strFailureGuard), Contract.Name + ": conversion errors must stop before validation/output.");
		const nOutput = strDefinition.indexOf(Contract.Output);
		g_Assert(nOutput > strDefinition.indexOf(strFailureGuard), Contract.Name + ": output is committed only after successful conversion.");
		g_Assert.equal(strDefinition.split(Contract.Output).length, 2, Contract.Name + ": one output commit.");
	}

	for (const Contract of g_vecArrayContracts) {
		const strDefinition = GetDefinition(strSource, Contract.Name);
		g_Assert(strDefinition.includes(Contract.Array + "->CreateDataProperty(LocalContext, unOutputIndex, " + Contract.Value + ");"), Contract.Name + ": indexed values must bypass inherited setters.");
		g_Assert(!strDefinition.includes(Contract.Array + "->Set("), Contract.Name + ": no prototype-sensitive indexed assignment.");
		g_Assert(strDefinition.includes("if (MaybeSetResult.IsNothing() || !MaybeSetResult.FromJust()) {"), Contract.Name + ": checked own-property creation.");
	}

	for (const strName of g_vecIndexCallbackNames) {
		const strDefinition = GetDefinition(strSource, strName);
		const vecConversion = /const int nWeaponIndex = [^\n]*GetValueIndex[^\n]*;/.exec(strDefinition);
		g_Assert(vecConversion);
		g_Assert(strDefinition.includes(vecConversion[0] + g_strCallbackFailureGuard), strName + ": conversion errors must stop before engine lookup.");
		g_Assert(strDefinition.indexOf("GetEdictFromEntityIndex(") > strDefinition.indexOf(g_strCallbackFailureGuard));
	}

	const strRemoval = GetDefinition(strSource, "RemoveWeaponCallback");
	g_Assert(strRemoval.includes("RemoveEntityByIndex(pIsolate, nWeaponIndex, kRemoveWeaponOperationName);" + g_strCallbackFailureGuard), "Removal must preserve native JavaScript errors.");

	const strDictionary = GetDefinition(strSource, "GetAllWeaponsDictionaryCallback");
	const nCounterDeclaration = strDictionary.indexOf("int nWeaponCount = 0;");
	const nRecordCommit = strDictionary.indexOf("if (!SetRecordProperty(pIsolate, LocalContext, LocalWeaponsDictionary, strWeaponIndexKey.c_str(), LocalWeaponObject))");
	const nCounterIncrement = strDictionary.indexOf("++nWeaponCount;");
	const nCountCommit = strDictionary.indexOf("if (!SetRecordProperty(pIsolate, LocalContext, LocalWeaponsDictionary, kWeaponCountPropertyName");
	g_Assert((nCounterDeclaration >= 0) && (nRecordCommit > nCounterDeclaration) && (nCounterIncrement > nRecordCommit) && (nCountCommit > nCounterIncrement), "Dictionary Count tracks committed properties, not the initial scan.");
	g_Assert.doesNotMatch(strDictionary, /nWeaponCount = static_cast<int>\(vecWeaponIndexes\.size\(\)\)/);
	g_Assert(strDictionary.includes("SetRecordProperty(pIsolate, LocalContext, LocalWeaponsDictionary, strWeaponIndexKey.c_str(), LocalWeaponObject)"));
	g_Assert(strDictionary.includes("SetRecordProperty(pIsolate, LocalContext, LocalWeaponsDictionary, kWeaponCountPropertyName, v8::Integer::New(pIsolate, nWeaponCount))"));

	const strEntries = GetDefinition(strSource, "GetWeaponsDictionaryEntriesCallback");
	for (const strProperty of g_vecEntryPropertyContracts) {
		g_Assert(strEntries.includes(strProperty), "Entries must create own indexed data properties.");
	}

	const strNameArray = GetDefinition(strSource, "MakeWeaponNameArray");
	g_Assert.match(strNameArray, /if \(!pGlobalVariables\) \{\n\t{4}return LocalWeaponNamesArray;/);
	g_Assert.match(GetDefinition(strSource, "MakeWeaponArrayFromIndexes"), /vecWeaponIndexes\.size\(\) > kMaximumWeaponArraySize/);

	const strCount = GetDefinition(strSource, "GetWeaponCountCallback");
	g_Assert(strCount.includes("constexpr std::size_t kMaximumWeaponCount = static_cast<std::size_t>(std::numeric_limits<int>::max());"));
	const nCountGuard = strCount.indexOf("if (unWeaponCount > kMaximumWeaponCount)");
	const nCountConversion = strCount.indexOf("const int nWeaponCount = static_cast<int>(unWeaponCount);");
	g_Assert((nCountGuard >= 0) && (nCountConversion > nCountGuard), "Validate the named count limit before narrowing.");

	const strMethods = GetDefinition(strSource, "InstallWeaponPropertyAndAmmoFunctions");
	g_Assert.doesNotMatch(strMethods, /\bSetFunction\(/, "Shared weapon methods must bypass inherited setters.");
	g_Assert.equal((strMethods.match(/\bSetRecordFunction\(/g) ?? []).length, g_vecInstalledMethodNames.length);
	for (const strName of g_vecInstalledMethodNames) {
		g_Assert(strMethods.includes('SetRecordFunction(pIsolate, LocalContext, LocalWeaponsObject, "' + strName + '",'), "Missing own shared method: " + strName);
	}

	const strConstants = GetDefinition(strSource, "InstallWeaponConstants");
	g_Assert.doesNotMatch(strConstants, /\bSet(?:Value|Integer|String)\(/, "Weapon constants and table exports must bypass inherited setters.");
	g_Assert.equal((strConstants.match(/\bSetRecordProperty\(/g) ?? []).length, g_unConstantOwnWriteCount);
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

CheckDefinitionExtraction();
CheckContracts(g_strSource);

for (const Contract of g_vecBoundaryContracts) {
	RejectMutation(Contract.Name, "v8::TryCatch " + Contract.Frame + "(pIsolate);", "");
	RejectMutation(Contract.Name, "catch (...)", "catch (int)");
	g_unRejectedMutationCount += 2;

	const strDefinition = GetDefinition(g_strSource, Contract.Name);
	for (const vecFailureGuard of strDefinition.matchAll(/^(\t{3,4})if \([^\n]+\) \{\n((?:\1\t[^\n]*\n)+)\1\}/gm)) {
		if (!vecFailureGuard[0].includes("return " + Contract.Result + ";") && !vecFailureGuard[0].includes("return;")) {
			continue;
		}

		const vecRethrow = /\t+RethrowV8InstallationFailure\([^\n]+\);\n/.exec(vecFailureGuard[0]);
		g_Assert(vecRethrow);
		RejectMutation(Contract.Name, vecFailureGuard[0], vecFailureGuard[0].replace(vecRethrow[0], ""));
		++g_unRejectedMutationCount;
	}
}

for (const Contract of g_vecArgumentContracts) {
	RejectMutation(Contract.Name, "WeaponsArgumentReadFailure.HasCaught()", "false");

	const strDefinition = GetDefinition(g_strSource, Contract.Name);
	const strOutputLine = "\t\t\t" + Contract.Output + "\n";
	const strChangedDefinition = strDefinition.replace(strOutputLine, "").replace(Contract.Conversion + "\n", () => Contract.Conversion + "\n" + strOutputLine);
	RejectMutation(Contract.Name, strDefinition, strChangedDefinition);
	g_unRejectedMutationCount += 2;
}

for (const Contract of g_vecArrayContracts) {
	RejectMutation(Contract.Name, Contract.Array + "->CreateDataProperty(", Contract.Array + "->Set(");
	++g_unRejectedMutationCount;
}

for (const strName of g_vecIndexCallbackNames) {
	RejectMutation(strName, "WeaponsOperationFailure.HasCaught()", "false");
	++g_unRejectedMutationCount;
}

RejectMutation("RemoveWeaponCallback", "RemoveEntityByIndex(pIsolate, nWeaponIndex, kRemoveWeaponOperationName);" + g_strCallbackFailureGuard, "RemoveEntityByIndex(pIsolate, nWeaponIndex, kRemoveWeaponOperationName);");
RejectMutation("GetAllWeaponsDictionaryCallback", "SetRecordProperty(pIsolate, LocalContext, LocalWeaponsDictionary, strWeaponIndexKey.c_str()", "SetValue(pIsolate, LocalContext, LocalWeaponsDictionary, strWeaponIndexKey.c_str()");
RejectMutation("GetAllWeaponsDictionaryCallback", "SetRecordProperty(pIsolate, LocalContext, LocalWeaponsDictionary, kWeaponCountPropertyName", "SetInteger(pIsolate, LocalContext, LocalWeaponsDictionary, kWeaponCountPropertyName");
RejectMutation("GetAllWeaponsDictionaryCallback", "int nWeaponCount = 0;", "int nWeaponCount = static_cast<int>(vecWeaponIndexes.size());");
RejectMutation("GetAllWeaponsDictionaryCallback", "++nWeaponCount;", "");
g_unRejectedMutationCount += 2;
g_unRejectedMutationCount += 3;

for (const strProperty of g_vecEntryPropertyContracts) {
	RejectMutation("GetWeaponsDictionaryEntriesCallback", strProperty, strProperty.replace("->CreateDataProperty(", "->Set("));
	++g_unRejectedMutationCount;
}

RejectMutation("GetWeaponCountCallback", "kMaximumWeaponCount = static_cast<std::size_t>(std::numeric_limits<int>::max())", "kMaximumWeaponCount = static_cast<std::size_t>(std::numeric_limits<std::uint32_t>::max())");
RejectMutation("GetWeaponCountCallback", "if (unWeaponCount > kMaximumWeaponCount)", "if (false)");
g_unRejectedMutationCount += 2;

for (const Contract of [
	{ Name: "InstallWeaponPropertyAndAmmoFunctions", Helper: "SetRecordFunction", OrdinaryHelper: "SetFunction", Count: g_vecInstalledMethodNames.length },
	{ Name: "InstallWeaponConstants", Helper: "SetRecordProperty", OrdinaryHelper: "SetValue", Count: g_unConstantOwnWriteCount },
]) {
	const strDefinition = GetDefinition(g_strSource, Contract.Name);
	const vecWrites = [...strDefinition.matchAll(new RegExp("^\\t+if \\(!" + Contract.Helper + "\\([^\\n]+", "gm"))];
	g_Assert.equal(vecWrites.length, Contract.Count);
	for (const vecWrite of vecWrites) {
		RejectMutation(Contract.Name, vecWrite[0], vecWrite[0].replace(Contract.Helper + "(", Contract.OrdinaryHelper + "("));
		++g_unRejectedMutationCount;
	}
}

console.log("Weapons native source contracts PASS; rejected mutations=" + g_unRejectedMutationCount + "; live V8/game-engine execution not exercised.");
