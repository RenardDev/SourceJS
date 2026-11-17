"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");

const g_vecArguments = process.argv.slice(2);
const g_bPrintNativeAliasTest = (g_vecArguments.length === 1) && (g_vecArguments[0] === "--print-native-alias-test");
if ((g_vecArguments.length > 0) && !g_bPrintNativeAliasTest) {
	const bShowHelp = (g_vecArguments.length === 1) && (g_vecArguments[0] === "--help");
	const strUsage = `Usage: node ${g_Path.relative(process.cwd(), __filename)} [--help | --print-native-alias-test]\nChecks effects field source contracts without native V8 execution.\n--print-native-alias-test emits a standalone C++ regression using the actual source helpers; compile and execute it separately.\nUnexpected arguments exit with status 2.\n`;
	g_FileSystem.writeSync(bShowHelp ? process.stdout.fd : process.stderr.fd, strUsage);
	process.exit(bShowHelp ? 0 : 2);
}

const g_strSource = g_FileSystem.readFileSync(g_Path.resolve(__dirname, "../src/sourcejs/modules/ModuleBindings.cpp"), "utf8").replace(/\r\n/g, "\n");

const g_vecNativeAliasCases = [
	["m_fLife", "life"],
	["m_flLife", "life"],
	["m_flFadeLength", "fadelength"],
	["m_fFlags", "flags"],
	["m_flScale", "scale"],
	["m_fnCallback", "callback"],
	["m_nType", "type"],
	["m_iPlayerIndex", "playerindex"],
	["m_bActive", "active"],
	["m_clrRender", "render"],
	["m_uchAlpha", "alpha"],
	["m_chCode", "code"],
	["m_vecStartPoint", "startpoint"],
	["m_vNormal", "normal"],
	["m_Position", "position"],
	["m_ModelIndex", "modelindex"],
	["modelIndex", "modelindex"],
	["Model", "model"],
	["maxSpeed", "maxspeed"],
	["material", "material"],
	["m_name", "name"],
	["m_flow", "flow"],
	["m_floatValue", "floatvalue"],
	["m_vec", "vec"],
	["m_fl", "fl"],
	["m_f", "f"],
	["m_", "m"],
	["m_vec_origin", "origin"],
	["m_i2", "2"],
	["", ""],
];

const g_vecAliasMutations = ["\"m_f\"", "std::isupper(chRoleFirstCharacter)", "return NormalizeEffectsName(strName.substr(unMemberPrefixLength));"];

// Structural regression guards complement SDK/V8 execution; they do not prove native memory is mapped or live.
const g_vecContracts = [
	["EffectsSetArrayValue", "const std::size_t unArrayMemoryByteCount"],
	["EffectsSetArrayValue", "EntityPropertiesIsRecordStorageRangeValid(pArrayElementProperty, sizeof(SendProp), alignof(SendProp))"],
	["EffectsSetArrayValue", "unLastElementOffset > unArrayMemoryByteCount"],
	["EffectsSetArrayValue", "unElementSize > (unArrayMemoryByteCount - unLastElementOffset)"],
	["EffectsSetArrayValue", "SendPropType const ArrayElementType = pArrayElementProperty->GetType();"],
	["EffectsSetArrayValue", "switch (ArrayElementType)"],
	["EffectsSetPropertyValue", "unPropertyOffset > unSenderMemoryByteCount"],
	["EffectsSetPropertyValue", "unPropertyMemoryByteCount = unSenderMemoryByteCount - unPropertyOffset"],
	["EffectsSetPropertyValue", "sizeof(int) > unPropertyMemoryByteCount"],
	["EffectsSetPropertyValue", "sizeof(float) > unPropertyMemoryByteCount"],
	["EffectsSetPropertyValue", "sizeof(Vector) > unPropertyMemoryByteCount"],
	["EffectsSetPropertyValue", "unStringCapacity > unPropertyMemoryByteCount"],
	["EffectsSetPropertyValue", "LocalPropertyValue->ToString(LocalContext).ToLocal(&LocalPropertyString)"],
	["EffectsSetPropertyValue", "EffectsSetArrayValue(pIsolate, LocalContext, pchPropertyAddress, unPropertyMemoryByteCount, PropertyInformation.m_pProperty, LocalPropertyValue)"],
	["ApplyEffectsPropertyValues", "v8::TryCatch PropertyFailure(pIsolate);"],
	["ApplyEffectsPropertyValues", "PropertyFailure.ReThrow();"],
	["ApplyEffectsPropertyValues", "std::string const strPropertyName = std::string(pszPropertyName, static_cast<std::size_t>(UTF8PropertyName.length()));"],
	["ApplyEffectsPropertyValues", "strPropertyName.find('\\0') != std::string::npos"],
	["ApplyEffectsPropertyValues", "} catch (...) {\n\t\t\t\t\tif (PropertyFailure.HasCaught()) {\n\t\t\t\t\t\tPropertyFailure.ReThrow();\n\t\t\t\t\t}\n\n\t\t\t\t\tthrow;\n\t\t\t\t}"],
	["ListEffectsTemporaryEntitiesCallback", "sizeof(IServerGameDLL), alignof(IServerGameDLL)"],
	["ListEffectsTemporaryEntitiesCallback", "!AreEffectsServerClassStorageRangesValid(pCurrentServerClass)"],
	["ListEffectsTemporaryEntitiesCallback", "std::vector<ServerClass*> vecVisitedClasses {};"],
	["ListEffectsTemporaryEntitiesCallback", "pVisitedClass == pCurrentServerClass"],
	["ListEffectsTemporaryEntitiesCallback", "LocalTemporaryEntitiesArray->CreateDataProperty(LocalContext, unWriteIndex, LocalTemporaryEntityObject)"],
	["ListEffectsTemporaryEntitiesCallback", "} catch (...) {"],
	["GetEffectsSendPropertyTypeSize", "const int nRecursionDepth = 0"],
	["GetEffectsSendPropertyTypeSize", "nRecursionDepth > kMaximumRecursionDepth"],
	["GetEffectsSendPropertyTypeSize", "sizeof(SendProp), alignof(SendProp)"],
	["GetEffectsSendPropertyTypeSize", "GetEffectsSendPropertyTypeSize(pArrayProperty, nRecursionDepth + 1)"],
	["GetEffectsSendPropertyTypeSize", "(unElementSize == 0) || (unElementCount > (std::numeric_limits<std::size_t>::max() / unElementSize))"],
	["CollectEffectsSendTableSize", "EntityPropertiesIsSendTableStorageValid(pSendTable)"],
	["CollectEffectsSendTableSize", "std::int64_t nWidePropertyOffset"],
	["CollectEffectsSendTableSize", "unSendTableSizeInOut = unSendTableSize;"],
	["ComputeEffectsSenderSize", "AreEffectsServerClassStorageRangesValid(pServerClass)"],
	["ComputeEffectsSenderSize", "unSenderSizeOut = unSenderSize;"],
	["CollectEffectsSendProperties", "std::uint32_t& unWriteIndexInOut"],
	["CollectEffectsSendProperties", "std::uint32_t unWriteIndex = unWriteIndexInOut;"],
	["CollectEffectsSendProperties", "EntityPropertiesIsSendTableStorageValid(pSendTable)"],
	["CollectEffectsSendProperties", "nRecursionDepth > kMaximumRecursionDepth"],
	["CollectEffectsSendProperties", "LocalPropertiesArray->CreateDataProperty(LocalContext, unWriteIndex, LocalPropertyObject)"],
	["CollectEffectsSendProperties", "unWriteIndex == std::numeric_limits<std::uint32_t>::max()"],
	["CollectEffectsSendProperties", "SetRecordProperty(pIsolate, LocalContext, LocalPropertyObject, \"Alias\", MakeString(pIsolate, strPropertyAlias))"],
	["CollectEffectsSendProperties", "unWriteIndexInOut = unWriteIndex;"],
	["MakeEffectsSendPropertiesArray", "pServerClass && !AreEffectsServerClassStorageRangesValid(pServerClass)"],
	["MakeEffectsTemporaryEntityObject", "!AreEffectsServerClassStorageRangesValid(pServerClass)"],
	["MakeEffectsTemporaryEntityObject", "unSenderSize > kMaximumSenderSize"],
	["MakeEffectsTemporaryEntityObject", "MakeEntityPropertiesReflectionObject(pIsolate, LocalContext, \"tempentity\", pServerClass)"],
	["FindEffectsPropertyInformation", "!AreEffectsServerClassStorageRangesValid(pServerClass)"],
	["FindEffectsPropertyInformation", "PropertyInformationOut = PropertyInformation;"],
	["EffectsSetVectorComponents", "const std::size_t unSenderMemoryByteCount"],
	["EffectsSetVectorComponents", "GetVectorFromValue(pIsolate, LocalContext, LocalPropertyValue, kVectorComponentErrorMessage, bHasComponentVector, ComponentVector)"],
	["EffectsSetVectorComponents", "EntityPropertiesIsRecordStorageRangeValid(pchSenderMemory, unSenderMemoryByteCount, alignof(char))"],
	["EffectsSetVectorComponents", "ComponentPropertyInformation.m_nPropertyOffset < 0"],
	["EffectsSetVectorComponents", "unComponentOffset > unSenderMemoryByteCount"],
	["EffectsSetVectorComponents", "sizeof(float) > (unSenderMemoryByteCount - unComponentOffset)"],
	["EffectsSetVectorComponents", "WriteEntityPropertiesScalarValue(pchSenderMemory + unComponentOffset, arrComponentValues[unComponentIndex])"],
	["MakeEffectsBloodColorObject", "if (!SetRecordProperty(pIsolate, LocalContext, LocalBloodColorObject, \"DONT_BLEED\", v8::Integer::New(pIsolate, kDoNotBleedColor))) {\n\t\t\t\treturn {};\n\t\t\t}"],
	["MakeEffectsBloodColorObject", "if (!SetRecordProperty(pIsolate, LocalContext, LocalBloodColorObject, \"RED\", v8::Integer::New(pIsolate, kRedBloodColor))) {\n\t\t\t\treturn {};\n\t\t\t}"],
	["MakeEffectsBloodColorObject", "if (!SetRecordProperty(pIsolate, LocalContext, LocalBloodColorObject, \"YELLOW\", v8::Integer::New(pIsolate, kYellowBloodColor))) {\n\t\t\t\treturn {};\n\t\t\t}"],
	["MakeEffectsBloodColorObject", "if (!SetRecordProperty(pIsolate, LocalContext, LocalBloodColorObject, \"GREEN\", v8::Integer::New(pIsolate, kGreenBloodColor))) {\n\t\t\t\treturn {};\n\t\t\t}"],
	["MakeEffectsBloodColorObject", "if (!SetRecordProperty(pIsolate, LocalContext, LocalBloodColorObject, \"MECH\", v8::Integer::New(pIsolate, kMechanicalBloodColor))) {\n\t\t\t\treturn {};\n\t\t\t}"],
	["MakeEffectsShatterSurfaceObject", "if (!SetRecordProperty(pIsolate, LocalContext, LocalShatterSurfaceObject, \"GLASS\", v8::Integer::New(pIsolate, kGlassSurface))) {\n\t\t\t\treturn {};\n\t\t\t}"],
	["MakeEffectsShatterSurfaceObject", "if (!SetRecordProperty(pIsolate, LocalContext, LocalShatterSurfaceObject, \"TILE\", v8::Integer::New(pIsolate, kTileSurface))) {\n\t\t\t\treturn {};\n\t\t\t}"],
	["InstallEffectsConstants", "if (!SetRecordProperty(pIsolate, LocalContext, LocalEffectsObject, \"BloodColor\", LocalBloodColorObject)) {\n\t\t\t\treturn false;\n\t\t\t}"],
	["InstallEffectsConstants", "if (!SetRecordProperty(pIsolate, LocalContext, LocalEffectsObject, \"ShatterSurface\", LocalShatterSurfaceObject)) {\n\t\t\t\treturn false;\n\t\t\t}"],
	["InstallEffectsFunctions", "if (!SetRecordFunction(pIsolate, LocalContext, LocalEffectsObject, \"ListTempEntities\", ListEffectsTemporaryEntitiesCallback, LocalRuntimeData)) {\n\t\t\t\treturn false;\n\t\t\t}"],
	["InstallEffectsFunctions", "if (!SetRecordFunction(pIsolate, LocalContext, LocalEffectsObject, \"GetTempEntity\", GetEffectsTemporaryEntityCallback, LocalRuntimeData)) {\n\t\t\t\treturn false;\n\t\t\t}"],
	["InstallEffectsFunctions", "if (!SetRecordFunction(pIsolate, LocalContext, LocalEffectsObject, \"GetProperty\", GetEffectsPropertyCallback, LocalRuntimeData)) {\n\t\t\t\treturn false;\n\t\t\t}"],
	["InstallEffectsFunctions", "if (!SetRecordFunction(pIsolate, LocalContext, LocalEffectsObject, \"CreateTempEntity\", CreateTemporaryEntityCallback, LocalRuntimeData)) {\n\t\t\t\treturn false;\n\t\t\t}"],
];

const g_vecCallbackContracts = [
	["FindEffectsServerClass", "EntityPropertiesIsRecordStorageRangeValid(pServerGameDLL, sizeof(IServerGameDLL), alignof(IServerGameDLL))"],
	["GetEffectsTemporaryEntityCallback", "std::string(*UTF8TemporaryEntityName, static_cast<std::size_t>(UTF8TemporaryEntityName.length()))"],
	["GetEffectsTemporaryEntityCallback", "v8::TryCatch MetadataFailure(pIsolate);"],
	["GetEffectsTemporaryEntityCallback", "} catch (...) {\n\t\t\t\t\tif (MetadataFailure.HasCaught()) {\n\t\t\t\t\t\tMetadataFailure.ReThrow();\n\t\t\t\t\t}\n\n\t\t\t\t\tthrow;\n\t\t\t\t}"],
	["GetEffectsTemporaryEntityCallback", "} catch (...) {"],
	["GetEffectsPropertyCallback", "std::string(*UTF8TemporaryEntityName, static_cast<std::size_t>(UTF8TemporaryEntityName.length()))"],
	["GetEffectsPropertyCallback", "std::string(*UTF8PropertyName, static_cast<std::size_t>(UTF8PropertyName.length()))"],
	["GetEffectsPropertyCallback", "v8::TryCatch PropertyFailure(pIsolate);"],
	["GetEffectsPropertyCallback", "} catch (...) {\n\t\t\t\t\tif (PropertyFailure.HasCaught()) {\n\t\t\t\t\t\tPropertyFailure.ReThrow();\n\t\t\t\t\t}\n\n\t\t\t\t\tthrow;\n\t\t\t\t}"],
	["GetEffectsPropertyCallback", "} catch (...) {"],
	["CreateTemporaryEntityCallback", "std::string(*UTF8TemporaryEntityName, static_cast<std::size_t>(UTF8TemporaryEntityName.length()))"],
	["CreateTemporaryEntityCallback", "sizeof(IVEngineServer), alignof(IVEngineServer)"],
	["CreateTemporaryEntityCallback", "const int nServerClassIndex = pServerClass->m_ClassID;"],
	["CreateTemporaryEntityCallback", "unSenderSize > kMaximumSenderSize"],
	["CreateTemporaryEntityCallback", "(unSenderSize % kAddressSize) != 0"],
	["CreateTemporaryEntityCallback", "ApplyEffectsPropertyValues(pIsolate, LocalContext, pchSenderMemory, unSenderSize, pServerClass, LocalPropertyValues)"],
	["CreateTemporaryEntityCallback", "!AreEffectsServerClassStorageRangesValid(pServerClass) || (pServerClass->m_pTable != pSendTable) || (pServerClass->m_ClassID != nServerClassIndex) || !ComputeEffectsSenderSize(pServerClass, unCurrentSenderSize) || (unCurrentSenderSize > unSenderSize)"],
	["CreateTemporaryEntityCallback", "pEngineServer->PlaybackTempEntity(RecipientFilter, flDelay, pchSenderMemory, pSendTable, nServerClassIndex);"],
	["CreateTemporaryEntityCallback", "} catch (...) {"],
	["GetAllInterfaceNamesCallback", "unInterfaceCount > static_cast<std::size_t>(std::numeric_limits<int>::max())"],
	["GetAllInterfaceNamesCallback", "LocalInterfaceNamesArray->CreateDataProperty(LocalContext, static_cast<std::uint32_t>(unInterfaceIndex), LocalInterfaceName)"],
	["GetAllInterfaceNamesCallback", "} catch (...) {"],
	["GetInterfaceRecordCallback", "std::string(*UTF8InterfaceName, static_cast<std::size_t>(UTF8InterfaceName.length()))"],
	["GetInterfaceRecordCallback", "SetRecordProperty(pIsolate, LocalContext, LocalInterfaceObject, kNamePropertyName, MakeString(pIsolate, strInterfaceName))"],
	["GetInterfaceRecordCallback", "SetRecordProperty(pIsolate, LocalContext, LocalInterfaceObject, kAvailablePropertyName, v8::Boolean::New(pIsolate, kInterfaceAvailable))"],
	["GetInterfaceRecordCallback", "SetRecordProperty(pIsolate, LocalContext, LocalInterfaceObject, kAddressPropertyName, v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(unInterfaceAddress)))"],
	["GetInterfaceRecordCallback", "} catch (...) {"],
];

function GetFunctionSource(strFunctionName, strSource = g_strSource) {
	const Expression = new RegExp("\\n(\\t+)[^\\n]*\\b" + strFunctionName + "\\([^\\n]*\\) [^{\\n]*\\{");
	const vecMatch = Expression.exec(strSource);
	g_Assert.ok(vecMatch, "Missing native definition: " + strFunctionName);

	const strClosingLine = "\n" + vecMatch[1] + "}";
	const nEndIndex = strSource.indexOf(strClosingLine, vecMatch.index);
	g_Assert.ok(nEndIndex > vecMatch.index, "Missing native function end: " + strFunctionName);

	return strSource.slice(vecMatch.index, nEndIndex + strClosingLine.length);
}

function MakeNativeAliasTest() {
	const vecHelpers = ["DoesEffectsStringStartWith", "NormalizeEffectsName", "RemoveEffectsNormalizedMemberPrefix", "DoEffectsNamesMatch"].map(strName => GetFunctionSource(strName).replace(/^\t\t/gm, ""));
	const strTestBody = `
struct AliasCase {
	char const* m_pszName;
	char const* m_pszAlias;
};

constexpr AliasCase kAliasCases[] = {
${g_vecNativeAliasCases.map(vecCase => "\t{ " + JSON.stringify(vecCase[0]) + ", " + JSON.stringify(vecCase[1]) + " },").join("\n")}
};

int main() {
	for (auto const& Case : kAliasCases) {
		std::string const strAlias = RemoveEffectsNormalizedMemberPrefix(Case.m_pszName);
		if (strAlias != Case.m_pszAlias) {
			std::cerr << "Alias mismatch Name=" << Case.m_pszName << " Expected=" << Case.m_pszAlias << " Actual=" << strAlias << '\\n';
			return 1;
		}

		if (!DoEffectsNamesMatch(Case.m_pszAlias, Case.m_pszName) || !DoEffectsNamesMatch(Case.m_pszName, Case.m_pszAlias)) {
			std::cerr << "Bidirectional matching failed Name=" << Case.m_pszName << '\\n';
			return 1;
		}
	}

	if (!DoEffectsNamesMatch("LIFE", "m_fLife") || !DoEffectsNamesMatch("m_flife", "m_fLife") || !DoEffectsNamesMatch("m-fLife", "m_fLife")) {
		std::cerr << "Case/separator matching failed\\n";
		return 1;
	}

	if (DoEffectsNamesMatch("Model", "odel") || DoEffectsNamesMatch("material", "aterial") || DoEffectsNamesMatch("Life", "m_fLight") || DoEffectsNamesMatch("Life", "m_fLifeCycle")) {
		std::cerr << "Distinct names matched after prefix removal\\n";
		return 1;
	}

	std::cout << "effects native alias regression passed (${g_vecNativeAliasCases.length} alias cases, bidirectional/case/separator and negative matching)\\n";

	return 0;
}
`;

	const nMainPosition = strTestBody.indexOf("\nint main() {");
	g_Assert.ok(nMainPosition >= 0, "The native alias program must have a main function");

	return "\n// C++\n#include <cstddef>\n\n// STL\n#include <cctype>\n#include <iostream>\n#include <string>\n" + strTestBody.slice(0, nMainPosition) + vecHelpers.join("\n") + "\n" + strTestBody.slice(nMainPosition);
}

if (g_bPrintNativeAliasTest) {
	process.stdout.write(MakeNativeAliasTest());
	process.exit(0);
}

function VerifyAliasContracts(strSource) {
	const strHelper = GetFunctionSource("RemoveEffectsNormalizedMemberPrefix", strSource);
	for (const strRequired of ["\"m_f\"", "DoesEffectsStringStartWith(strName, strMemberPrefix)", "std::isupper(chRoleFirstCharacter)", "std::isdigit(chRoleFirstCharacter)", "return NormalizeEffectsName(strName.substr(unMemberPrefixLength));"]) {
		g_Assert.ok(strHelper.includes(strRequired), "Raw native member prefixes must retain role boundaries: " + strRequired);
	}

	g_Assert.ok(!strHelper.includes("NormalizeEffectsName(strName);\n\t\t\tfor"), "Do not discard role capitalization before stripping a native prefix");
}

VerifyAliasContracts(g_strSource);

for (const strRequired of g_vecAliasMutations) {
	const strOriginal = GetFunctionSource("RemoveEffectsNormalizedMemberPrefix");
	const strMutated = strOriginal.replace(strRequired, "RemovedAliasContract");
	g_Assert.notEqual(strMutated, strOriginal, "Mutation must change the alias helper");
	g_Assert.throws(() => VerifyAliasContracts(g_strSource.replace(strOriginal, strMutated)), { name: "AssertionError" }, "Reject native alias prefix regression: " + strRequired);
}

for (const vecContract of g_vecContracts) {
	const strFunctionName = vecContract[0];
	const strRequiredSource = vecContract[1];
	g_Assert.ok(GetFunctionSource(strFunctionName).includes(strRequiredSource), strFunctionName + " must retain: " + strRequiredSource);
}

const g_strMetadata = GetFunctionSource("MakeEffectsTemporaryEntityObject");
for (const strFieldName of ["Name", "ClassName", "ClassIndex", "TableName", "Size", "ServerClass", "Properties"]) {
	g_Assert.ok(g_strMetadata.includes("SetRecordProperty(pIsolate, LocalContext, LocalTemporaryEntityObject, \"" + strFieldName + "\""), "Temporary-entity metadata must own field " + strFieldName);
}

g_Assert.ok(!/\bSet(?:String|Integer|Value)\(/.test(g_strMetadata), "Owned metadata must not invoke inherited setters");

const g_strCollector = GetFunctionSource("CollectEffectsSendProperties");
g_Assert.ok(!g_strCollector.includes("LocalPropertiesArray->Set("), "Owned arrays must not invoke inherited numeric setters");
g_Assert.ok(g_strCollector.indexOf("std::uint32_t unWriteIndex = unWriteIndexInOut;") < g_strCollector.indexOf("unWriteIndexInOut = unWriteIndex;"), "Commit the caller counter only after successful traversal");

const g_strComponents = GetFunctionSource("EffectsSetVectorComponents");
g_Assert.ok(g_strComponents.indexOf("unComponentOffset > unSenderMemoryByteCount") < g_strComponents.indexOf("WriteEntityPropertiesScalarValue("), "Check complete component capacity before writing");
g_Assert.ok(!g_strComponents.includes("std::memcpy("), "Component writes must use the checked scalar writer");

// These caller checks cover capacity propagation, not the complete temporary-entity creation callback.
g_Assert.equal((g_strSource.match(/EffectsSetVectorComponents\(pIsolate, LocalContext, pchSenderMemory, unSenderMemoryByteCount, pServerClass, PropertyInformation, LocalPropertyValue, bHandledAsVectorComponent\)/g) ?? []).length, 2);
g_Assert.ok(g_strSource.includes("EffectsSetPropertyValue(pIsolate, LocalContext, pchSenderMemory, unSenderMemoryByteCount, pServerClass, PropertyInformation, LocalPropertyValue)"));
g_Assert.ok(g_strSource.includes("ApplyEffectsPropertyValues(pIsolate, LocalContext, pchSenderMemory, unSenderSize, pServerClass, LocalPropertyValues)"));

const g_strArrayWriter = GetFunctionSource("EffectsSetArrayValue");
g_Assert.ok(g_strArrayWriter.indexOf("SendPropType const ArrayElementType") < g_strArrayWriter.indexOf("LocalInputArray->Get("), "Capture the checked element type before user getters");
g_Assert.ok(/if \(!LocalInputArray->Get\([^\n]+\) \{\n\s+return false;/.test(g_strArrayWriter), "Stop processing immediately when an element getter throws");
g_Assert.equal((GetFunctionSource("ApplyEffectsPropertyValues").match(/PropertyFailure\.ReThrow\(\);/g) ?? []).length, 5, "Preserve lower-level errors, newly created diagnostics and the native-unwind rethrow");

function VerifyCallbackContracts(strSource) {
	for (const vecContract of g_vecCallbackContracts) {
		g_Assert.ok(GetFunctionSource(vecContract[0], strSource).includes(vecContract[1]), vecContract[0] + " must retain: " + vecContract[1]);
	}

	const strCreate = GetFunctionSource("CreateTemporaryEntityCallback", strSource);
	g_Assert.ok(strCreate.indexOf("const int nServerClassIndex =") < strCreate.indexOf("ApplyEffectsPropertyValues("), "Snapshot class identity before property getters");

	const nRecipientCollectionIndex = strCreate.indexOf("CollectRecipientEntityIndicesFromValue(");
	const nExtentRevalidationIndex = strCreate.indexOf("std::size_t unCurrentSenderSize =");
	g_Assert.ok((nRecipientCollectionIndex >= 0) && (nExtentRevalidationIndex > nRecipientCollectionIndex), "Require recipient collection before extent revalidation");
	g_Assert.ok(strCreate.indexOf("ComputeEffectsSenderSize(pServerClass, unCurrentSenderSize)") < strCreate.indexOf("pEngineServer->PlaybackTempEntity("), "Revalidate complete native extent before playback");
	g_Assert.equal((GetFunctionSource("GetEffectsTemporaryEntityCallback", strSource).match(/MetadataFailure\.ReThrow\(\);/g) ?? []).length, 3, "Preserve metadata errors, diagnostics and native-unwind rethrow");
	g_Assert.equal((GetFunctionSource("GetEffectsPropertyCallback", strSource).match(/PropertyFailure\.ReThrow\(\);/g) ?? []).length, 4, "Preserve property errors, diagnostics and native-unwind rethrow");
	g_Assert.ok(!GetFunctionSource("GetAllInterfaceNamesCallback", strSource).includes("LocalInterfaceNamesArray->Set("), "Interface name arrays must not invoke inherited setters");
	g_Assert.ok(!/\bSet(?:String|Boolean|Value)\(/.test(GetFunctionSource("GetInterfaceRecordCallback", strSource)), "Interface records must own their data properties");
}

VerifyCallbackContracts(g_strSource);

// Mutations stay in memory and target only the callback/lookup block under review.
const g_vecCallbackMutations = [
	["CreateTemporaryEntityCallback", "CollectRecipientEntityIndicesFromValue(", "SkipRecipientEntityIndicesFromValue("],
	["CreateTemporaryEntityCallback", "pSendTable, nServerClassIndex);", "pSendTable, pServerClass->m_ClassID);"],
	["CreateTemporaryEntityCallback", " || (pServerClass->m_ClassID != nServerClassIndex)", ""],
	["CreateTemporaryEntityCallback", " || (unCurrentSenderSize > unSenderSize)", ""],
	["GetEffectsTemporaryEntityCallback", "static_cast<std::size_t>(UTF8TemporaryEntityName.length())", "std::strlen(*UTF8TemporaryEntityName)"],
	["GetEffectsPropertyCallback", "static_cast<std::size_t>(UTF8PropertyName.length())", "std::strlen(*UTF8PropertyName)"],
	["GetEffectsTemporaryEntityCallback", "MetadataFailure.ReThrow();", ""],
	["GetEffectsPropertyCallback", "PropertyFailure.ReThrow();", ""],
	["GetEffectsPropertyCallback", "} catch (...) {", "} catch (std::bad_alloc const&) {"],
	["GetAllInterfaceNamesCallback", "LocalInterfaceNamesArray->CreateDataProperty(", "LocalInterfaceNamesArray->Set("],
	["GetInterfaceRecordCallback", "v8::BigInt::NewFromUnsigned(", "v8::Number::New("],
	["FindEffectsServerClass", "EntityPropertiesIsRecordStorageRangeValid(pServerGameDLL, sizeof(IServerGameDLL), alignof(IServerGameDLL))", "pServerGameDLL"],
];
for (const vecMutation of g_vecCallbackMutations) {
	const strOriginal = GetFunctionSource(vecMutation[0]);
	g_Assert.ok(strOriginal.includes(vecMutation[1]), "Mutation must change actual source: " + vecMutation[0]);
	const strMutated = strOriginal.replace(vecMutation[1], vecMutation[2]);
	g_Assert.notEqual(strMutated, strOriginal, "Mutation must change callback bytes: " + vecMutation[0]);
	const strMutatedSource = g_strSource.replace(strOriginal, strMutated);
	g_Assert.throws(() => VerifyCallbackContracts(strMutatedSource), { name: "AssertionError" }, "Reject callback contract regression: " + vecMutation[0]);
}

console.log("effects native field contracts smoke passed (" + (g_vecContracts.length + g_vecCallbackContracts.length) + " source contracts, ordering/ownership checks, " + g_vecCallbackMutations.length + " callback mutations, " + g_vecAliasMutations.length + " alias mutations; native execution is a separate check).");
