"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_strUsage = "Usage: node tools/smoke_entity_transmit_native_contracts.js [--help]";
const g_vecArguments = process.argv.slice(2);
if ((g_vecArguments.length === 1) && (g_vecArguments[0] === "--help")) {
	console.log(g_strUsage);
	process.exit(0);
}

if (g_vecArguments.length !== 0) {
	console.error(g_strUsage);
	process.exit(2);
}

const g_strBindingsPath = g_Path.join(__dirname, "..", "src", "sourcejs", "modules", "ModuleBindings.cpp");
const g_strBindingsSource = g_FileSystem.readFileSync(g_strBindingsPath, "utf8").replace(/\r\n/g, "\n");

let g_unNegativeRegressionCount = 0;

function ReadDefinition(strSource, strFunctionName) {
	const DefinitionPattern = new RegExp("\\n(\\t{1,2})(?:bool|void|IServerTools\\*) " + strFunctionName + "\\([^\\n]*\\)(?: try)? \\{[\\s\\S]*?\\n\\1\\}(?=\\n|$)");
	const vecDefinitionMatch = strSource.match(DefinitionPattern);
	g_Assert.ok(vecDefinitionMatch, "Missing native definition: " + strFunctionName);

	return (vecDefinitionMatch[1].length === 2) ? vecDefinitionMatch[0].replace(/\n\t/g, "\n") : vecDefinitionMatch[0];
}

function VerifyFactoryContracts(strSource) {
	const strVectorReader = ReadDefinition(strSource, "GetEntityFactoryVectorFromValue");
	g_Assert.match(strVectorReader, /if \(!LocalXValue->IsNumber\(\) \|\| !LocalYValue->IsNumber\(\) \|\| !LocalZValue->IsNumber\(\)\)/);

	for (const strComponent of ["X", "Y", "Z"]) {
		const strProbe = "v8::Maybe<bool> const MaybeHas" + strComponent + "Property = LocalVectorObject->HasOwnProperty(LocalContext, Local" + strComponent + "PropertyName);";
		const strGuard = "if (MaybeHas" + strComponent + "Property.IsNothing())";
		g_Assert.ok(strVectorReader.includes(strProbe + "\n\t\t\t" + strGuard), "Stop failed descriptor probe: " + strComponent);
		g_Assert.ok(strVectorReader.includes("if (!LocalVectorObject->Get(LocalContext, Local" + strComponent + "PropertyName).ToLocal(&Local" + strComponent + "Value)) {\n\t\t\t\treturn;") === false, "Boolean helper cannot return void");
		g_Assert.ok(strVectorReader.includes("if (!LocalVectorObject->Get(LocalContext, Local" + strComponent + "PropertyName).ToLocal(&Local" + strComponent + "Value)) {\n\t\t\t\treturn false;"), "Preserve original component getter failure");
	}

	const strKeyReader = ReadDefinition(strSource, "GetEntityFactoryKeyValueFromValue");
	g_Assert.ok(strKeyReader.includes("strKeyValueName.empty() || (strKeyValueName.find('\\0') != std::string::npos)"));
	g_Assert.ok(strKeyReader.includes("if (FactoryKeyValue.m_strValue.find('\\0') != std::string::npos)"));
	g_Assert.ok(strKeyReader.includes("EntityFactoryKeyValue FactoryKeyValue {};"));
	g_Assert.ok(strKeyReader.includes("FactoryKeyValue.m_Vector.Init(0.0f, 0.0f, 0.0f);"), "Initialize SDK vector even for string/float records");
	g_Assert.doesNotMatch(strKeyReader, /EntityFactoryKeyValueOut\.(m_strKey|m_Type|m_strValue|m_flValue|m_Vector)\s*=/);
	g_Assert.equal(strKeyReader.split("EntityFactoryKeyValueOut = std::move(FactoryKeyValue);").length - 1, 3, "Commit each successful type");
	g_Assert.doesNotMatch(strKeyReader, /GetFloatArgument\([^\n]*EntityFactoryKeyValueOut/);

	const strOptionsReader = ReadDefinition(strSource, "ReadEntityFactoryOptions");
	g_Assert.ok(strOptionsReader.includes("MaybeHasDispatchSpawnOption = LocalOptions->HasOwnProperty(LocalContext, LocalDispatchSpawnOptionName);\n\t\tif (MaybeHasDispatchSpawnOption.IsNothing())"), "Stop failed option descriptor probe");

	const strKeyValuesReader = ReadDefinition(strSource, "ReadEntityFactoryKeyValues");
	g_Assert.ok(strKeyValuesReader.includes("GetOwnPropertyNames(LocalContext).ToLocal(&LocalKeyNames)"), "Keep current V8 own enumerable string-key enumeration");

	for (const strFunctionName of ["DispatchEntitySpawnCallback", "SetEntityKeyValueCallback", "GetEntityKeyValueCallback"]) {
		const strDefinition = ReadDefinition(strSource, strFunctionName);
		g_Assert.match(strDefinition, /CBaseEntity\* pBaseEntity = nullptr;\n\t\tif \(!ResolveEntityFactoryBaseEntityFromValue\([^\n]*, pBaseEntity\)\) \{\n\t\t\treturn;/);
		g_Assert.ok(strDefinition.indexOf("ResolveEntityFactoryBaseEntityFromValue(") < strDefinition.indexOf("if (!pBaseEntity)"), "Preserve original entity getter before SDK work");
	}

	for (const strFunctionName of ["CreateEntityByClassNameCallback", "CreateAndSpawnEntityByClassNameCallback", "DispatchEntitySpawnCallback", "SetEntityKeyValueCallback", "GetEntityKeyValueCallback", "FindEntityByHammerIDCallback", "DestroyEntityByHammerIDCallback"]) {
		const strDefinition = ReadDefinition(strSource, strFunctionName);
		g_Assert.ok(strDefinition.includes("CallbackInformation) try {"));
		g_Assert.ok(strDefinition.includes('ThrowError(CallbackInformation.GetIsolate(), "' + strFunctionName + ' failed with a C++ exception.");'));
	}

	const strResolver = ReadDefinition(strSource, "ResolveEntityFactoryBaseEntityFromValue");
	g_Assert.ok(strResolver.includes("v8::TryCatch EntityResolutionFailure(pIsolate);\n\t\ttry {"));
	g_Assert.equal(strResolver.split("EntityResolutionFailure.ReThrow();").length, 3);
	g_Assert.ok(strResolver.includes("pBaseEntityOut = pBaseEntity;"));
	g_Assert.ok(strResolver.includes("} catch (...) {\n\t\t\tif (EntityResolutionFailure.HasCaught()) {\n\t\t\t\tEntityResolutionFailure.ReThrow();\n\t\t\t}\n\n\t\t\tthrow;"));
	g_Assert.ok(strOptionsReader.includes("auto const CommitOptions = [pbDispatchSpawnOut, &bDispatchSpawn, &LocalKeyValuesValueOut, &LocalKeyValuesValue]() -> bool {"));

	for (const strFunctionName of ["CreateEntityByClassNameCallback", "CreateAndSpawnEntityByClassNameCallback"]) {
		g_Assert.ok(ReadDefinition(strSource, strFunctionName).includes("strClassName.empty() || (strClassName.find('\\0') != std::string::npos)"));
	}

	g_Assert.ok(ReadDefinition(strSource, "GetEntityKeyValueCallback").includes("strKeyName.empty() || (strKeyName.find('\\0') != std::string::npos)"));

	const strSetter = ReadDefinition(strSource, "SetEntityKeyValueCallback");
	const nKeyValueReadPosition = strSetter.indexOf("GetEntityFactoryKeyValueFromValue(");
	const nEntityResolutionPosition = strSetter.indexOf("ResolveEntityFactoryBaseEntityFromValue(");
	g_Assert.ok((nKeyValueReadPosition >= 0) && (nKeyValueReadPosition < nEntityResolutionPosition), "Read user-defined value properties before borrowing the SDK target");

	const strGetter = ReadDefinition(strSource, "GetEntityKeyValueCallback");
	g_Assert.ok(strGetter.includes("auto const itValueTerminator = std::find(vecValueBuffer.cbegin(), vecValueBuffer.cend(), '\\0');"));
	g_Assert.match(strGetter, /if \(itValueTerminator == vecValueBuffer\.cend\(\)\) \{\n\t\t\tThrowError\(pIsolate, kUnterminatedValueMessage\);\n\t\t\treturn;/);
	g_Assert.ok(strGetter.indexOf("if (itValueTerminator") < strGetter.indexOf("MakeString(pIsolate, vecValueBuffer.data())"), "Bound native string before reading its terminator");

	const strFunctionWriter = ReadDefinition(strSource, "SetEntityFactoryFunction");
	g_Assert.ok(strFunctionWriter.includes("v8::Function::New(LocalContext, Callback, LocalRuntimeData).ToLocal(&LocalFunction)"));
	g_Assert.ok(strFunctionWriter.includes("return SetRecordProperty(pIsolate, LocalContext, LocalEntityFactoriesObject, pszName, LocalFunction);"), "Create own factory functions");
	g_Assert.doesNotMatch(strFunctionWriter, /SetValue\(|SetFunction\(/);

	const strFactoryInstaller = ReadDefinition(strSource, "InstallEntityFactoriesFunctions");
	for (const strFunctionName of ["CreateEntityByClassName", "CreateAndSpawnEntityByClassName", "DispatchEntitySpawn", "SetEntityKeyValue", "GetEntityKeyValue", "FindEntityByHammerID"]) {
		g_Assert.ok(strFactoryInstaller.includes('SetEntityFactoryFunction(pIsolate, LocalContext, LocalEntityFactoriesObject, "' + strFunctionName + '", ' + strFunctionName + "Callback, LocalRuntimeData)"), "Own factory export: " + strFunctionName);
	}

	const strDestroyInstaller = ReadDefinition(strSource, "InstallEntityFactoriesDestroyEntityByHammerIDFunction");
	g_Assert.ok(strDestroyInstaller.includes('SetEntityFactoryFunction(pIsolate, LocalContext, LocalEntityFactoriesObject, "DestroyEntityByHammerID", DestroyEntityByHammerIDCallback<TServerTools>, LocalRuntimeData)'));

	const strServerToolsReader = ReadDefinition(strSource, "RequireEntityFactoriesServerTools");
	g_Assert.ok(strServerToolsReader.includes('std::string(pszOperation) + " requires " + VSERVERTOOLS_INTERFACE_VERSION + "."'), "Use selected SDK interface version");
}

function VerifyContracts(strSource) {
	const strRemoval = ReadDefinition(strSource, "RemoveEntityCallback");
	g_Assert.ok(strRemoval.includes("CallbackInformation) try {"));
	g_Assert.ok(strRemoval.includes('ThrowError(CallbackInformation.GetIsolate(), "entities.RemoveEntity(Entity) failed because a native C++ exception occurred.");'));
	g_Assert.match(strRemoval, /constexpr int kInvalidEntityIndex = -1;/);
	g_Assert.match(strRemoval, /int nEntityIndex = kInvalidEntityIndex;\n\t\tif \(!GetEntityIndexFromValue\([^\n]*, nEntityIndex\)\) \{\n\t\t\treturn;\n\t\t\}/);
	g_Assert.doesNotMatch(strRemoval, /GetValueIndex\(/);

	for (const strFunctionName of ["GetEntityTransmitStateFlagsCallback", "SetEntityTransmitStateFlagsCallback", "SetEntityTransmitStateCallback", "ClearEntityTransmitStateCallback"]) {
		const strDefinition = ReadDefinition(strSource, strFunctionName);
		g_Assert.ok(strDefinition.includes("CallbackInformation) try {"));
		g_Assert.ok(strDefinition.includes('ThrowError(CallbackInformation.GetIsolate(), "' + strFunctionName + ' failed with a C++ exception.");'));
		g_Assert.match(strDefinition, /edict_t\* pEntityEdict = nullptr;\n\t\tif \(!ResolveEntityTransmitEdictFromValue\([^\n]*, pEntityEdict\)\) \{\n\t\t\treturn;/);
		g_Assert.ok(strDefinition.indexOf("ResolveEntityTransmitEdictFromValue(") < strDefinition.indexOf("if (!pEntityEdict)"), "Preserve getter exception before invalid-entity reporting");
	}

	const strResolver = ReadDefinition(strSource, "ResolveEntityTransmitEdictFromValue");
	g_Assert.ok(strResolver.includes("v8::TryCatch EntityResolutionFailure(pIsolate);\n\t\ttry {"));
	g_Assert.ok(strResolver.includes("pEntityEdictOut = pEntityEdict;"));
	g_Assert.equal(strResolver.split("EntityResolutionFailure.ReThrow();").length, 3);
	g_Assert.ok(strResolver.includes("} catch (...) {\n\t\t\tif (EntityResolutionFailure.HasCaught()) {\n\t\t\t\tEntityResolutionFailure.ReThrow();\n\t\t\t}\n\n\t\t\tthrow;"));

	const strSetter = ReadDefinition(strSource, "SetEntityTransmitStateFlagsCallback");
	const nFlagTypeValidationPosition = strSetter.indexOf("!LocalStateFlagsValue->IsInt32()");
	const nEntityResolutionPosition = strSetter.indexOf("ResolveEntityTransmitEdictFromValue(");
	g_Assert.ok((nFlagTypeValidationPosition >= 0) && (nFlagTypeValidationPosition < nEntityResolutionPosition), "Validate flag type before reading entity");
	g_Assert.ok(strSetter.indexOf("ResolveEntityTransmitEdictFromValue(") < strSetter.indexOf("pEntityEdict->m_fStateFlags = nStateFlags;"), "Failed getter must precede mutation");
	g_Assert.match(strSetter, /pEntityEdict->m_fStateFlags = nStateFlags;\n\t\tMarkEntityTransmitStateChanged\(pEntityEdict\);/);

	const strInstaller = ReadDefinition(strSource, "InstallEntityConstants");
	for (const strFunctionName of ["GetMaximumEntityCount", "GetEntityCount"]) {
		const strLocalFunctionName = "Local" + strFunctionName + "Function";
		g_Assert.ok(strInstaller.includes("v8::Local<v8::Function> " + strLocalFunctionName + " {};"), "Initialize function handle");
		g_Assert.ok(strInstaller.includes("v8::Function::New(LocalContext, " + strFunctionName + "Callback, LocalRuntimeData).ToLocal(&" + strLocalFunctionName + ")"), "Preserve callback data and handle creation failure");
		g_Assert.ok(strInstaller.includes('SetRecordProperty(pIsolate, LocalContext, LocalEntityConstants, "' + strFunctionName + '", ' + strLocalFunctionName + ")"), "Install own function property");
		g_Assert.ok(!strInstaller.includes('SetFunction(pIsolate, LocalContext, LocalEntityConstants, "' + strFunctionName + '"'), "Do not invoke inherited setter");
	}

	const strStateReader = ReadDefinition(strSource, "GetEntityTransmitStateFromValue");
	g_Assert.ok(strStateReader.includes("nTransmitStateOut = nTransmitState;\n\t\t\t\treturn true;"), "Early output commit and return share one phase");

	const strModeSetter = ReadDefinition(strSource, "SetEntityTransmitStateCallback");
	g_Assert.match(strModeSetter, /if \(!LocalTransmitStateValue->IsInt32\(\)\) \{\n\t\t\tThrowError\(pIsolate, kTransmitStateTypeError\);\n\t\t\treturn;/);
	g_Assert.ok(strModeSetter.indexOf("ResolveEntityTransmitEdictFromValue(") < strModeSetter.indexOf("!LocalTransmitStateValue->IsInt32()"), "Keep entity-before-mode validation order");

	VerifyFactoryContracts(strSource);
}

function RejectMutation(strCaseName, strBefore, strAfter) {
	let strOriginal = strBefore;
	let strReplacement = strAfter;
	if (!g_strBindingsSource.includes(strOriginal) && strOriginal.startsWith("\n\t") && !strOriginal.startsWith("\n\t\t")) {
		// Restore the nested namespace level removed by ReadDefinition for assertions.
		strOriginal = strOriginal.replace(/\n(?=\t)/g, "\n\t");
		strReplacement = strReplacement.replace(/\n(?=\t)/g, "\n\t");
	}

	g_Assert.equal(g_strBindingsSource.split(strOriginal).length, 2, "Mutation is not unique: " + strCaseName);

	const strMutatedSource = g_strBindingsSource.replace(strOriginal, () => strReplacement);
	g_Assert.notEqual(strMutatedSource, g_strBindingsSource, "Mutation did not change source: " + strCaseName);
	g_Assert.throws(() => VerifyContracts(strMutatedSource), g_Assert.AssertionError, strCaseName);
	++g_unNegativeRegressionCount;
}

VerifyContracts(g_strBindingsSource);

RejectMutation("Unchecked removal", "if (!GetEntityIndexFromValue(pIsolate, LocalContext, CallbackInformation[kEntityArgumentIndex], nEntityIndex))", "if (GetValueIndex(pIsolate, LocalContext, CallbackInformation[kEntityArgumentIndex]))");
RejectMutation("Untranslated removal exception", 'ThrowError(CallbackInformation.GetIsolate(), "entities.RemoveEntity(Entity) failed because a native C++ exception occurred.");', "return;");

for (const strFunctionName of ["GetEntityTransmitStateFlagsCallback", "SetEntityTransmitStateFlagsCallback", "SetEntityTransmitStateCallback", "ClearEntityTransmitStateCallback"]) {
	RejectMutation(strFunctionName + " untranslated exception", 'ThrowError(CallbackInformation.GetIsolate(), "' + strFunctionName + ' failed with a C++ exception.");', "return;");
}

const g_strTransmitResolver = ReadDefinition(g_strBindingsSource, "ResolveEntityTransmitEdictFromValue");
RejectMutation("Transmit resolver missing catch", g_strTransmitResolver, g_strTransmitResolver.replace("v8::TryCatch EntityResolutionFailure(pIsolate);", ""));
RejectMutation("Transmit resolver masked getter", g_strTransmitResolver, g_strTransmitResolver.replace("EntityResolutionFailure.ReThrow();", "return false;"));
RejectMutation("Transmit resolver pending C++ unwind", g_strTransmitResolver, g_strTransmitResolver.replace("if (EntityResolutionFailure.HasCaught()) {\n\t\t\t\tEntityResolutionFailure.ReThrow();\n\t\t\t}\n\n\t\t\tthrow;", "throw;"));

for (const strFunctionName of ["GetMaximumEntityCount", "GetEntityCount"]) {
	const strLocalFunctionName = "Local" + strFunctionName + "Function";
	RejectMutation(strFunctionName + " inherited setter", 'SetRecordProperty(pIsolate, LocalContext, LocalEntityConstants, "' + strFunctionName + '", ' + strLocalFunctionName + ")", 'SetValue(pIsolate, LocalContext, LocalEntityConstants, "' + strFunctionName + '", ' + strLocalFunctionName + ")");
	RejectMutation(strFunctionName + " lost callback data", "v8::Function::New(LocalContext, " + strFunctionName + "Callback, LocalRuntimeData).ToLocal(&" + strLocalFunctionName + ")", "v8::Function::New(LocalContext, " + strFunctionName + "Callback).ToLocal(&" + strLocalFunctionName + ")");
}

const g_strStateReader = ReadDefinition(g_strBindingsSource, "GetEntityTransmitStateFromValue");
RejectMutation("Separated early return", g_strStateReader, g_strStateReader.replace("nTransmitStateOut = nTransmitState;\n\t\t\t\treturn true;", "nTransmitStateOut = nTransmitState;\n\n\t\t\t\treturn true;"));

const g_strModeSetter = ReadDefinition(g_strBindingsSource, "SetEntityTransmitStateCallback");
RejectMutation("Coercive transmit state", g_strModeSetter, g_strModeSetter.replace("!LocalTransmitStateValue->IsInt32()", "LocalTransmitStateValue.IsEmpty()"));

const g_strFlagsSetter = ReadDefinition(g_strBindingsSource, "SetEntityTransmitStateFlagsCallback");
RejectMutation("Missing flag type validation", g_strFlagsSetter, g_strFlagsSetter.replace("!LocalStateFlagsValue->IsInt32()", "false"));

const g_strVectorReader = ReadDefinition(g_strBindingsSource, "GetEntityFactoryVectorFromValue");
RejectMutation("Coercive vector components", g_strVectorReader, g_strVectorReader.replace("!LocalXValue->IsNumber()", "LocalXValue.IsEmpty()"));

for (const strComponent of ["X", "Y", "Z"]) {
	RejectMutation("Cascaded descriptor " + strComponent, g_strVectorReader, g_strVectorReader.replace("if (MaybeHas" + strComponent + "Property.IsNothing())", "if (false)"));
	RejectMutation("Masked getter " + strComponent, g_strVectorReader, g_strVectorReader.replace("if (!LocalVectorObject->Get(LocalContext, Local" + strComponent + "PropertyName).ToLocal(&Local" + strComponent + "Value)) {\n\t\t\t\treturn false;", "if (!LocalVectorObject->Get(LocalContext, Local" + strComponent + "PropertyName).ToLocal(&Local" + strComponent + "Value)) {\n\t\t\t\tThrowError(pIsolate, strInvalidVectorMessage.c_str());\n\t\t\t\treturn false;"));
}

const g_strKeyReader = ReadDefinition(g_strBindingsSource, "GetEntityFactoryKeyValueFromValue");
RejectMutation("Truncated KeyValue name", "strKeyValueName.empty() || (strKeyValueName.find('\\0') != std::string::npos)", "strKeyValueName.empty()");
RejectMutation("Truncated KeyValue string", "if (FactoryKeyValue.m_strValue.find('\\0') != std::string::npos)", "if (false)");
RejectMutation("Uninitialized SDK vector", g_strKeyReader, g_strKeyReader.replace("FactoryKeyValue.m_Vector.Init(0.0f, 0.0f, 0.0f);", ""));
RejectMutation("Partial record output", g_strKeyReader, g_strKeyReader.replace("FactoryKeyValue.m_strKey = strKeyValueName;", "EntityFactoryKeyValueOut.m_strKey = strKeyValueName;"));
RejectMutation("Direct float output", g_strKeyReader, g_strKeyReader.replace("FactoryKeyValue.m_flValue)", "EntityFactoryKeyValueOut.m_flValue)"));

const g_strOptionsReader = ReadDefinition(g_strBindingsSource, "ReadEntityFactoryOptions");
RejectMutation("Cascaded option descriptor", g_strOptionsReader, g_strOptionsReader.replace("if (MaybeHasDispatchSpawnOption.IsNothing())", "if (false)"));

const g_strServerToolsReader = ReadDefinition(g_strBindingsSource, "RequireEntityFactoriesServerTools");
RejectMutation("Hardcoded interface version", g_strServerToolsReader, g_strServerToolsReader.replace('std::string(pszOperation) + " requires " + VSERVERTOOLS_INTERFACE_VERSION + "."', 'std::string(pszOperation) + " requires VSERVERTOOLS001."'));

for (const strFunctionName of ["CreateEntityByClassNameCallback", "CreateAndSpawnEntityByClassNameCallback", "DispatchEntitySpawnCallback", "SetEntityKeyValueCallback", "GetEntityKeyValueCallback", "FindEntityByHammerIDCallback", "DestroyEntityByHammerIDCallback"]) {
	RejectMutation(strFunctionName + " untranslated C++ exception", 'ThrowError(CallbackInformation.GetIsolate(), "' + strFunctionName + ' failed with a C++ exception.");', "return;");
}

const g_strFactoryResolver = ReadDefinition(g_strBindingsSource, "ResolveEntityFactoryBaseEntityFromValue");
RejectMutation("Factory resolver missing catch", g_strFactoryResolver, g_strFactoryResolver.replace("v8::TryCatch EntityResolutionFailure(pIsolate);", ""));
RejectMutation("Factory resolver masked getter", g_strFactoryResolver, g_strFactoryResolver.replace("EntityResolutionFailure.ReThrow();", "return false;"));
RejectMutation("Factory resolver pending C++ unwind", g_strFactoryResolver, g_strFactoryResolver.replace("if (EntityResolutionFailure.HasCaught()) {\n\t\t\t\tEntityResolutionFailure.ReThrow();\n\t\t\t}\n\n\t\t\tthrow;", "throw;"));

for (const strFunctionName of ["CreateEntityByClassNameCallback", "CreateAndSpawnEntityByClassNameCallback"]) {
	const strDefinition = ReadDefinition(g_strBindingsSource, strFunctionName);
	RejectMutation(strFunctionName + " truncated class name", strDefinition, strDefinition.replace("strClassName.empty() || (strClassName.find('\\0') != std::string::npos)", "strClassName.empty()"));
}

const g_strFactoryGetter = ReadDefinition(g_strBindingsSource, "GetEntityKeyValueCallback");
RejectMutation("Getter truncated key", g_strFactoryGetter, g_strFactoryGetter.replace("strKeyName.empty() || (strKeyName.find('\\0') != std::string::npos)", "strKeyName.empty()"));

const g_strCommitOptionsReader = ReadDefinition(g_strBindingsSource, "ReadEntityFactoryOptions");
RejectMutation("Mutable option commit closure", g_strCommitOptionsReader, g_strCommitOptionsReader.replace("auto const CommitOptions =", "auto CommitOptions ="));
RejectMutation("Unbounded native string", g_strFactoryGetter, g_strFactoryGetter.replace("if (itValueTerminator == vecValueBuffer.cend())", "if (false)"));
RejectMutation("Mistyped native string bound", g_strFactoryGetter, g_strFactoryGetter.replace("itValueTerminator == vecValueBuffer.cend()", "itValueTerminator == vecValueBufferXcend()"));
RejectMutation("Masked unterminated value", g_strFactoryGetter, g_strFactoryGetter.replace("ThrowError(pIsolate, kUnterminatedValueMessage);", ""));

const g_strFactorySetter = ReadDefinition(g_strBindingsSource, "SetEntityKeyValueCallback");
const g_strFactoryValueRead = g_strFactorySetter.match(/\t\tEntityFactoryKeyValue FactoryKeyValue \{\};\n\t\tif \(!GetEntityFactoryKeyValueFromValue\([^\n]+\)\) \{\n\t\t\treturn;\n\t\t\}\n\n/)?.[0];
g_Assert.equal(typeof g_strFactoryValueRead, "string");

const g_strFactoryDeferredValueReadSetter = g_strFactorySetter.replace(g_strFactoryValueRead, "").replace("\t\tauto* const pServerTools = RequireEntityFactoriesServerTools(pIsolate, kOperationName);", g_strFactoryValueRead + "\t\tauto* const pServerTools = RequireEntityFactoriesServerTools(pIsolate, kOperationName);");
RejectMutation("Setter borrowed target before value getter", g_strFactorySetter, g_strFactoryDeferredValueReadSetter);

const g_strFactoryFunctionWriter = ReadDefinition(g_strBindingsSource, "SetEntityFactoryFunction");
RejectMutation("Inherited factory setter", g_strFactoryFunctionWriter, g_strFactoryFunctionWriter.replace("SetRecordProperty(", "SetValue("));
RejectMutation("Lost factory callback data", g_strFactoryFunctionWriter, g_strFactoryFunctionWriter.replace("v8::Function::New(LocalContext, Callback, LocalRuntimeData)", "v8::Function::New(LocalContext, Callback)"));

const g_strFactoryInstaller = ReadDefinition(g_strBindingsSource, "InstallEntityFactoriesFunctions");
for (const strFunctionName of ["CreateEntityByClassName", "CreateAndSpawnEntityByClassName", "DispatchEntitySpawn", "SetEntityKeyValue", "GetEntityKeyValue", "FindEntityByHammerID"]) {
	RejectMutation(strFunctionName + " legacy factory installation", g_strFactoryInstaller, g_strFactoryInstaller.replace('SetEntityFactoryFunction(pIsolate, LocalContext, LocalEntityFactoriesObject, "' + strFunctionName + '"', 'SetFunction(pIsolate, LocalContext, LocalEntityFactoriesObject, "' + strFunctionName + '"'));
}

const g_strDestroyInstaller = ReadDefinition(g_strBindingsSource, "InstallEntityFactoriesDestroyEntityByHammerIDFunction");
RejectMutation("Legacy optional factory installation", g_strDestroyInstaller, g_strDestroyInstaller.replace("SetEntityFactoryFunction(", "SetFunction("));

console.log("[smoke] Entity removal/transmit/factory source contracts and " + g_unNegativeRegressionCount + " negative regressions passed; native execution is a separate check");
