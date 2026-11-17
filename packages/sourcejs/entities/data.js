"use strict";

const { DoesFileExist, ReadTextFile } = require("filesystem");
const { GetGlobalVariables } = require("globals");
const { SOURCE_DATA_ROOT } = require("paths");

const g_unDecimalRadix = 10;
const g_strEntityIndexFileName = "index.json";
const g_vecSDKBranches = Object.freeze([
	"bgt",
	"blade",
	"bms",
	"contagion",
	"csgo",
	"css",
	"darkm",
	"dods",
	"doi",
	"episode1",
	"eye",
	"gmod",
	"hl2dm",
	"insurgency",
	"l4d",
	"l4d2",
	"mcv",
	"nucleardawn",
	"orangebox",
	"portal2",
	"pvkii",
	"sdk2013",
	"swarm",
	"tf2",
]);
const g_TypeNames = Object.freeze({
	BOOL: "bool",
	Color: "color",
	FLOAT: "float",
	INT: "int",
	ADDRESS: "address",
	QAngle: "qangle",
	SHORT: "short",
	STRING: "string",
	STRING_ARRAY: "stringarray",
	UINT: "uint",
	Vector: "vector",
});
const g_setCanonicalTypeNames = new Set(Object.values(g_TypeNames));
const g_EntityDataSectionKeys = Object.freeze({
	BasedAttributes: "BasedAttributes",
	Functions: "Functions",
	Inputs: "Inputs",
	InstanceAttributes: "InstanceAttributes",
	KeyValues: "KeyValues",
	Properties: "Properties",
	VirtualFunctions: "VirtualFunctions",
});
const g_mapEntityDataCache = new Map();
let g_EntityIndexCache = null;

function JoinSlashPath(...vecPathParts) {
	const vecNormalizedPathParts = [];
	for (const strPathPart of vecPathParts) {
		if (typeof strPathPart !== "string") {
			throw new TypeError("Path parts must be strings.");
		}

		if (strPathPart.length > 0) {
			vecNormalizedPathParts.push(strPathPart.replace(/\\/g, "/"));
		}
	}

	const strJoinedPath = vecNormalizedPathParts.join("/");
	const strNormalizedPath = strJoinedPath.replace(/\/+/g, "/");
	if (/^\/\/[^/]/.test(strJoinedPath)) {
		return `/${strNormalizedPath}`;
	}

	return strNormalizedPath;
}

function NormalizeEntityDataName(strEntityDataName) {
	if (typeof strEntityDataName !== "string") {
		throw new TypeError("Entity data names must be strings.");
	}

	const NormalizeNamePart = (strNamePart) => strNamePart[1].toUpperCase();

	return strEntityDataName.trim().replace(/^_+/, "").replace(/_([a-z0-9])/g, NormalizeNamePart);
}

function NormalizeEntityDataPublicName(strEntityDataName) {
	return NormalizeEntityDataName(strEntityDataName).replace(/^[a-z]/, (strNamePart) => strNamePart.toUpperCase());
}

function GetEntityClassNameFromPath(strEntityDataPath) {
	if ((typeof strEntityDataPath !== "string") || (strEntityDataPath.length === 0)) {
		throw new TypeError("strEntityDataPath must be a non-empty string.");
	}

	const strNormalizedPath = strEntityDataPath.replace(/\\/g, "/");
	const nLastSeparatorIndex = strNormalizedPath.lastIndexOf("/");
	const strEntityDataFileName = strNormalizedPath.slice(nLastSeparatorIndex + 1);

	return strEntityDataFileName.replace(/\.ini$/i, "");
}

function NormalizeSDKBranch(strSDKBranch) {
	if (typeof strSDKBranch !== "string") {
		throw new TypeError("strSDKBranch must be a string.");
	}

	const strNormalizedSDKBranch = strSDKBranch.trim().toLowerCase();
	if (strNormalizedSDKBranch.length === 0) {
		throw new TypeError("strSDKBranch must not be empty.");
	}

	return strNormalizedSDKBranch;
}

function GetActiveSDKBranch() {
	return NormalizeSDKBranch(GetGlobalVariables().SDKBranch);
}

function StripINIComment(strINILine) {
	if (typeof strINILine !== "string") {
		throw new TypeError("strINILine must be a string.");
	}

	let bInsideQuotes = false;
	let bEscapedCharacter = false;
	let strUncommentedLine = "";
	for (const strCharacter of strINILine) {
		if (bEscapedCharacter) {
			bEscapedCharacter = false;
			strUncommentedLine += strCharacter;
			continue;
		}

		if (bInsideQuotes && (strCharacter === "\\")) {
			bEscapedCharacter = true;
			strUncommentedLine += strCharacter;
			continue;
		}

		if (strCharacter === "\"") {
			bInsideQuotes = !bInsideQuotes;
			strUncommentedLine += strCharacter;
			continue;
		}

		if (!bInsideQuotes && (strCharacter === "#")) {
			break;
		}

		strUncommentedLine += strCharacter;
	}

	return strUncommentedLine.trim();
}

function UnquoteINIValue(strINIValue) {
	if (typeof strINIValue !== "string") {
		throw new TypeError("INI value must be a string.");
	}

	const strINIValueText = strINIValue.trim();
	if ((strINIValueText.length >= 2) && (strINIValueText[0] === "\"") && (strINIValueText[strINIValueText.length - 1] === "\"")) {
		return strINIValueText.slice(1, -1).replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
	}

	return strINIValueText;
}

function ParseINIValue(strINIValue) {
	const strINIValueText = UnquoteINIValue(strINIValue);
	if (/^-?\d+$/.test(strINIValueText)) {
		return Number.parseInt(strINIValueText, g_unDecimalRadix);
	}

	if (strINIValueText === "True") {
		return true;
	}

	if (strINIValueText === "False") {
		return false;
	}

	return strINIValueText;
}

function NormalizeEntityDataType(strTypeName) {
	if (typeof strTypeName !== "string") {
		throw new TypeError("Entity data type name must be a string.");
	}

	const strNormalizedTypeName = strTypeName.trim();
	if (g_setCanonicalTypeNames.has(strNormalizedTypeName)) {
		return strNormalizedTypeName;
	}

	if (!Object.hasOwn(g_TypeNames, strNormalizedTypeName)) {
		throw new TypeError(`Unknown entity data type "${strNormalizedTypeName}".`);
	}

	return g_TypeNames[strNormalizedTypeName];
}

function NormalizeEntityDataArgumentTypes(ArgumentTypes) {
	if (!Array.isArray(ArgumentTypes) && (typeof ArgumentTypes !== "string")) {
		throw new TypeError("Entity data argument types must be a string or an array.");
	}

	const vecTypeNames = Array.isArray(ArgumentTypes) ? ArgumentTypes : ArgumentTypes.split(",");
	const vecNormalizedArgumentTypes = [];
	for (const strTypeName of vecTypeNames) {
		if (typeof strTypeName !== "string") {
			throw new TypeError("Entity data argument type names must be strings.");
		}

		const strNormalizedTypeName = strTypeName.trim();
		if (strNormalizedTypeName.length > 0) {
			vecNormalizedArgumentTypes.push(NormalizeEntityDataType(strNormalizedTypeName));
		}
	}

	return vecNormalizedArgumentTypes;
}

function ParseEntityDataConfiguration(strConfigurationText) {
	if (typeof strConfigurationText !== "string") {
		throw new TypeError("Entity data configuration text must be a string.");
	}

	const ConfigurationRoot = Object.create(null);
	let CurrentSection = ConfigurationRoot;
	let CurrentNestedSection = null;
	for (const strConfigurationLine of strConfigurationText.split(/\r?\n/)) {
		const strNormalizedLine = StripINIComment(strConfigurationLine);
		if (strNormalizedLine.length === 0) {
			continue;
		}

		const vecNestedSectionMatch = strNormalizedLine.match(/^\[\[([^\]]+)]]$/);
		if (vecNestedSectionMatch) {
			if (CurrentSection === ConfigurationRoot) {
				throw new SyntaxError(`Nested entity data section "${vecNestedSectionMatch[1]}" has no parent section.`);
			}

			CurrentNestedSection = Object.create(null);
			CurrentSection[NormalizeEntityDataName(vecNestedSectionMatch[1])] = CurrentNestedSection;
			continue;
		}

		const vecTopLevelSectionMatch = strNormalizedLine.match(/^\[([^\]]+)]$/);
		if (vecTopLevelSectionMatch) {
			CurrentNestedSection = null;
			CurrentSection = Object.create(null);
			ConfigurationRoot[NormalizeEntityDataName(vecTopLevelSectionMatch[1])] = CurrentSection;
			continue;
		}

		const nAssignmentSeparatorIndex = strNormalizedLine.indexOf("=");
		if (nAssignmentSeparatorIndex < 0) {
			continue;
		}

		const strPropertyName = NormalizeEntityDataName(strNormalizedLine.slice(0, nAssignmentSeparatorIndex));
		const TargetSection = (CurrentNestedSection === null) ? CurrentSection : CurrentNestedSection;
		TargetSection[strPropertyName] = ParseINIValue(strNormalizedLine.slice(nAssignmentSeparatorIndex + 1));
	}

	return ConfigurationRoot;
}

function NormalizeEntityDataInstanceAttributeOffset(OffsetValue) {
	let nOffset;
	if (typeof OffsetValue === "number") {
		nOffset = OffsetValue;
	} else if ((typeof OffsetValue === "string") && /^0[xX][0-9A-Fa-f]+$/.test(OffsetValue)) {
		nOffset = Number(OffsetValue);
	} else {
		throw new TypeError("Entity data instance-attribute offset must be a number or hexadecimal integer.");
	}

	if (!Number.isSafeInteger(nOffset) || (nOffset < 0)) {
		throw new RangeError("Entity data instance-attribute offset must be a nonnegative safe integer.");
	}

	return nOffset;
}

function NormalizeEntityDataDescriptor(strDescriptorSection, strDescriptorName, DescriptorValue) {
	if ((typeof strDescriptorSection !== "string") || (strDescriptorSection.length === 0)) {
		throw new TypeError("Entity data descriptor section must be a non-empty string.");
	}

	if ((typeof strDescriptorName !== "string") || (strDescriptorName.length === 0)) {
		throw new TypeError("Entity data descriptor name must be a non-empty string.");
	}

	if (typeof DescriptorValue === "string") {
		if (DescriptorValue.length === 0) {
			throw new TypeError("Entity data descriptor value must be a non-empty string or object.");
		}

		return { Name: DescriptorValue, Section: strDescriptorSection };
	}

	if ((DescriptorValue === null) || (typeof DescriptorValue !== "object") || Array.isArray(DescriptorValue)) {
		throw new TypeError("Entity data descriptor value must be a non-empty string or object.");
	}

	const strDescriptorNameValue = (DescriptorValue.name === undefined) ? strDescriptorName : DescriptorValue.name;
	if ((typeof strDescriptorNameValue !== "string") || (strDescriptorNameValue.length === 0)) {
		throw new TypeError("Entity data descriptor name value must be a non-empty string.");
	}

	const NormalizedEntityDataDescriptor = { Name: strDescriptorNameValue, Section: strDescriptorSection };

	if (DescriptorValue.type !== undefined) {
		NormalizedEntityDataDescriptor.Type = NormalizeEntityDataType(DescriptorValue.type);
	}

	if (DescriptorValue.returnType !== undefined) {
		NormalizedEntityDataDescriptor.ReturnType = NormalizeEntityDataType(DescriptorValue.returnType);
	}

	if (DescriptorValue.arguments !== undefined) {
		NormalizedEntityDataDescriptor.Arguments = NormalizeEntityDataArgumentTypes(DescriptorValue.arguments);
	}

	const vecDescriptorFields = [
		["documentation", "Documentation"],
		["identifierLinux", "IdentifierLinux"],
		["identifierWindows", "IdentifierWindows"],
		["offsetLinux", "OffsetLinux"],
		["offsetWindows", "OffsetWindows"],
		["base", "Base"],
		["offset", "Offset"],
	];
	for (const [strSourceField, strTargetField] of vecDescriptorFields) {
		if (DescriptorValue[strSourceField] !== undefined) {
			const bInstanceAttributeOffset = (strDescriptorSection === "InstanceAttribute") && ((strSourceField === "offset") || (strSourceField === "offsetLinux") || (strSourceField === "offsetWindows"));
			NormalizedEntityDataDescriptor[strTargetField] = bInstanceAttributeOffset ? NormalizeEntityDataInstanceAttributeOffset(DescriptorValue[strSourceField]) : DescriptorValue[strSourceField];
		}
	}

	return NormalizedEntityDataDescriptor;
}

function NormalizeEntityDataDescriptorMap(strDescriptorSection, DescriptorData) {
	if ((typeof strDescriptorSection !== "string") || (strDescriptorSection.length === 0)) {
		throw new TypeError("Entity data descriptor section must be a non-empty string.");
	}

	const Descriptors = Object.create(null);
	if (DescriptorData === undefined) {
		return Descriptors;
	}

	if ((DescriptorData === null) || (typeof DescriptorData !== "object") || Array.isArray(DescriptorData)) {
		throw new TypeError("Entity data descriptor map must be an object.");
	}

	for (const strDescriptorName in DescriptorData) {
		if (!Object.hasOwn(DescriptorData, strDescriptorName)) {
			continue;
		}

		const strNormalizedDescriptorName = NormalizeEntityDataPublicName(strDescriptorName);
		const DescriptorValue = DescriptorData[strDescriptorName];
		const EntityDataDescriptor = NormalizeEntityDataDescriptor(strDescriptorSection, strNormalizedDescriptorName, DescriptorValue);
		Descriptors[strNormalizedDescriptorName] = EntityDataDescriptor;
	}

	return Descriptors;
}

function NormalizeEntityDataConfiguration(EntityDataConfiguration) {
	if ((EntityDataConfiguration === null) || (typeof EntityDataConfiguration !== "object") || Array.isArray(EntityDataConfiguration)) {
		throw new TypeError("Entity data configuration must be an object.");
	}

	let BasedAttributeData;
	let strBinaryName = "server";
	let FunctionData;
	let InputData;
	let InstanceAttributeData;
	let KeyValueData;
	let PropertyData;
	let bServerCheckEnabled = true;
	let VirtualFunctionData;

	if (Object.hasOwn(EntityDataConfiguration, "basedAttribute")) {
		BasedAttributeData = EntityDataConfiguration.basedAttribute;
	}

	if (Object.hasOwn(EntityDataConfiguration, "binary")) {
		strBinaryName = EntityDataConfiguration.binary;
	}

	if (Object.hasOwn(EntityDataConfiguration, "function")) {
		FunctionData = EntityDataConfiguration.function;
	}

	if (Object.hasOwn(EntityDataConfiguration, "input")) {
		InputData = EntityDataConfiguration.input;
	}

	if (Object.hasOwn(EntityDataConfiguration, "instanceAttribute")) {
		InstanceAttributeData = EntityDataConfiguration.instanceAttribute;
	}

	if (Object.hasOwn(EntityDataConfiguration, "keyvalue")) {
		KeyValueData = EntityDataConfiguration.keyvalue;
	}

	if (Object.hasOwn(EntityDataConfiguration, "property")) {
		PropertyData = EntityDataConfiguration.property;
	}

	if (Object.hasOwn(EntityDataConfiguration, "serverCheck")) {
		bServerCheckEnabled = EntityDataConfiguration.serverCheck;
	}

	if (Object.hasOwn(EntityDataConfiguration, "virtualFunction")) {
		VirtualFunctionData = EntityDataConfiguration.virtualFunction;
	}

	if ((typeof strBinaryName !== "string") || (strBinaryName.length === 0)) {
		throw new TypeError("Entity data binary must be a non-empty string.");
	}

	if (typeof bServerCheckEnabled !== "boolean") {
		throw new TypeError("Entity data serverCheck must be a boolean.");
	}

	return {
		BasedAttributes: NormalizeEntityDataDescriptorMap("BasedAttribute", BasedAttributeData),
		Binary: strBinaryName,
		Functions: NormalizeEntityDataDescriptorMap("Function", FunctionData),
		Inputs: NormalizeEntityDataDescriptorMap("Input", InputData),
		InstanceAttributes: NormalizeEntityDataDescriptorMap("InstanceAttribute", InstanceAttributeData),
		KeyValues: NormalizeEntityDataDescriptorMap("KeyValue", KeyValueData),
		Properties: NormalizeEntityDataDescriptorMap("Property", PropertyData),
		ServerCheckEnabled: bServerCheckEnabled,
		VirtualFunctions: NormalizeEntityDataDescriptorMap("VirtualFunction", VirtualFunctionData),
	};
}

function MergeEntityDataDescriptorMap(TargetDescriptors, SourceDescriptors) {
	if ((TargetDescriptors === null) || (typeof TargetDescriptors !== "object") || Array.isArray(TargetDescriptors)) {
		throw new TypeError("Target entity data descriptors must be an object.");
	}

	if ((SourceDescriptors === null) || (typeof SourceDescriptors !== "object") || Array.isArray(SourceDescriptors)) {
		throw new TypeError("Source entity data descriptors must be an object.");
	}

	for (const strDescriptorName in SourceDescriptors) {
		if (!Object.hasOwn(SourceDescriptors, strDescriptorName)) {
			continue;
		}

		const SourceDescriptor = SourceDescriptors[strDescriptorName];
		if ((SourceDescriptor === null) || (typeof SourceDescriptor !== "object") || Array.isArray(SourceDescriptor)) {
			throw new TypeError("Source entity data descriptor must be an object.");
		}

		if (!Object.hasOwn(TargetDescriptors, strDescriptorName)) {
			TargetDescriptors[strDescriptorName] = SourceDescriptor;
			continue;
		}

		const TargetDescriptor = TargetDescriptors[strDescriptorName];
		if ((TargetDescriptor === null) || (typeof TargetDescriptor !== "object") || Array.isArray(TargetDescriptor)) {
			throw new TypeError("Target entity data descriptor must be an object.");
		}

		TargetDescriptors[strDescriptorName] = { ...TargetDescriptor, ...SourceDescriptor };
	}
}

function MergeEntityClassData(TargetEntityClassData, SourceEntityClassData) {
	if ((TargetEntityClassData === null) || (typeof TargetEntityClassData !== "object") || Array.isArray(TargetEntityClassData)) {
		throw new TypeError("Target entity class data must be an object.");
	}

	if ((SourceEntityClassData === null) || (typeof SourceEntityClassData !== "object") || Array.isArray(SourceEntityClassData)) {
		throw new TypeError("Source entity class data must be an object.");
	}

	const strBinaryName = SourceEntityClassData.Binary;
	const bServerCheckEnabled = SourceEntityClassData.ServerCheckEnabled;
	if ((typeof strBinaryName !== "string") || (strBinaryName.length === 0)) {
		throw new TypeError("Source entity class binary must be a non-empty string.");
	}

	if (typeof bServerCheckEnabled !== "boolean") {
		throw new TypeError("Source entity class ServerCheckEnabled must be a boolean.");
	}

	TargetEntityClassData.Binary = strBinaryName;
	TargetEntityClassData.ServerCheckEnabled = bServerCheckEnabled;

	MergeEntityDataDescriptorMap(TargetEntityClassData.BasedAttributes, SourceEntityClassData.BasedAttributes);
	MergeEntityDataDescriptorMap(TargetEntityClassData.Functions, SourceEntityClassData.Functions);
	MergeEntityDataDescriptorMap(TargetEntityClassData.Inputs, SourceEntityClassData.Inputs);
	MergeEntityDataDescriptorMap(TargetEntityClassData.InstanceAttributes, SourceEntityClassData.InstanceAttributes);
	MergeEntityDataDescriptorMap(TargetEntityClassData.KeyValues, SourceEntityClassData.KeyValues);
	MergeEntityDataDescriptorMap(TargetEntityClassData.Properties, SourceEntityClassData.Properties);
	MergeEntityDataDescriptorMap(TargetEntityClassData.VirtualFunctions, SourceEntityClassData.VirtualFunctions);

	return TargetEntityClassData;
}

function CreateEmptyEntityClassData(strEntityClassName) {
	if ((typeof strEntityClassName !== "string") || (strEntityClassName.length === 0)) {
		throw new TypeError("Entity class name must be a non-empty string.");
	}

	return {
		BasedAttributes: Object.create(null),
		Binary: "server",
		ClassName: strEntityClassName,
		Functions: Object.create(null),
		Inputs: Object.create(null),
		InstanceAttributes: Object.create(null),
		KeyValues: Object.create(null),
		Properties: Object.create(null),
		ServerCheckEnabled: true,
		VirtualFunctions: Object.create(null),
	};
}

function GetEntityIndexFilePath() {
	return JoinSlashPath(SOURCE_DATA_ROOT, "entities", g_strEntityIndexFileName);
}

function GetEntityDataPath(strEntityDataPath = g_strEntityIndexFileName) {
	return JoinSlashPath(SOURCE_DATA_ROOT, "entities", strEntityDataPath);
}

function LoadEntityDataIndex() {
	if (g_EntityIndexCache !== null) {
		return g_EntityIndexCache;
	}

	const strFilePath = GetEntityIndexFilePath();
	if (!DoesFileExist(strFilePath)) {
		throw new Error(`Entity data index does not exist: ${strFilePath}`);
	}

	const EntityDataIndex = JSON.parse(ReadTextFile(strFilePath).replace(/^\uFEFF/, ""));
	if ((EntityDataIndex === null) || (typeof EntityDataIndex !== "object") || Array.isArray(EntityDataIndex)) {
		throw new TypeError("Entity data index must be an object.");
	}

	if (!Object.hasOwn(EntityDataIndex, "Branches")) {
		throw new TypeError("Entity data index Branches must be an object.");
	}

	if (!Object.hasOwn(EntityDataIndex, "Groups")) {
		throw new TypeError("Entity data index Groups must be an object.");
	}

	const EntityDataBranches = EntityDataIndex.Branches;
	const EntityDataGroups = EntityDataIndex.Groups;
	if ((EntityDataBranches === null) || (typeof EntityDataBranches !== "object") || Array.isArray(EntityDataBranches)) {
		throw new TypeError("Entity data index Branches must be an object.");
	}

	if ((EntityDataGroups === null) || (typeof EntityDataGroups !== "object") || Array.isArray(EntityDataGroups)) {
		throw new TypeError("Entity data index Groups must be an object.");
	}

	g_EntityIndexCache = { Branches: EntityDataBranches, Groups: EntityDataGroups };

	return g_EntityIndexCache;
}

function LoadEntityDataFile(strEntityDataPath) {
	const strFilePath = GetEntityDataPath(strEntityDataPath);
	if (!DoesFileExist(strFilePath)) {
		throw new Error(`Entity data file does not exist: ${strFilePath}`);
	}

	return NormalizeEntityDataConfiguration(ParseEntityDataConfiguration(ReadTextFile(strFilePath)));
}

function MergeEntityDataFile(EntityClasses, strEntityDataPath) {
	if ((EntityClasses === null) || (typeof EntityClasses !== "object") || Array.isArray(EntityClasses)) {
		throw new TypeError("Entity classes must be an object.");
	}

	const strEntityClassName = GetEntityClassNameFromPath(strEntityDataPath);
	const SourceEntityClassData = LoadEntityDataFile(strEntityDataPath);

	if (!Object.hasOwn(EntityClasses, strEntityClassName)) {
		EntityClasses[strEntityClassName] = CreateEmptyEntityClassData(strEntityClassName);
	}

	return MergeEntityClassData(EntityClasses[strEntityClassName], SourceEntityClassData);
}

function GetEntityDataGroups(strSDKBranch = GetActiveSDKBranch()) {
	const strNormalizedSDKBranch = NormalizeSDKBranch(strSDKBranch);
	if (!g_vecSDKBranches.includes(strNormalizedSDKBranch)) {
		throw new RangeError(`Unsupported entity data SDK branch "${strNormalizedSDKBranch}".`);
	}

	const EntityDataBranches = LoadEntityDataIndex().Branches;
	if (!Object.hasOwn(EntityDataBranches, strNormalizedSDKBranch)) {
		throw new TypeError(`Entity data groups for SDK branch "${strNormalizedSDKBranch}" must be an array.`);
	}

	const vecEntityDataGroups = EntityDataBranches[strNormalizedSDKBranch];
	if (!Array.isArray(vecEntityDataGroups)) {
		throw new TypeError(`Entity data groups for SDK branch "${strNormalizedSDKBranch}" must be an array.`);
	}

	return ["common", ...vecEntityDataGroups];
}

function GetSupportedEntityDataSDKBranches() {
	return g_vecSDKBranches;
}

function GetSupportedEntityDataGroups() {
	return Object.keys(LoadEntityDataIndex().Groups);
}

function LoadEntityData(strSDKBranch = GetActiveSDKBranch()) {
	const strNormalizedSDKBranch = NormalizeSDKBranch(strSDKBranch);
	if (g_mapEntityDataCache.has(strNormalizedSDKBranch)) {
		return g_mapEntityDataCache.get(strNormalizedSDKBranch);
	}

	const EntityClasses = Object.create(null);
	const EntityDataFilesByGroup = LoadEntityDataIndex().Groups;

	for (const strGroupName of GetEntityDataGroups(strNormalizedSDKBranch)) {
		if (!Object.hasOwn(EntityDataFilesByGroup, strGroupName)) {
			throw new TypeError(`Entity data group "${strGroupName}" must be an array.`);
		}

		const vecEntityDataFiles = EntityDataFilesByGroup[strGroupName];
		if (!Array.isArray(vecEntityDataFiles)) {
			throw new TypeError(`Entity data group "${strGroupName}" must be an array.`);
		}

		for (const strEntityDataFilePath of vecEntityDataFiles) {
			MergeEntityDataFile(EntityClasses, strEntityDataFilePath);
		}
	}

	g_mapEntityDataCache.set(strNormalizedSDKBranch, EntityClasses);

	return EntityClasses;
}

function RequireEntityDataLookupName(strLookupName, strLookupNameDescription) {
	if ((typeof strLookupName !== "string") || (strLookupName.length === 0)) {
		throw new TypeError(`${strLookupNameDescription} must be a non-empty string.`);
	}

	return strLookupName;
}

function GetEntityClassDataNames(strSDKBranch = GetActiveSDKBranch()) {
	return Object.keys(LoadEntityData(strSDKBranch));
}

function HasEntityClassData(strEntityClassName, strSDKBranch = GetActiveSDKBranch()) {
	const strRequiredEntityClassName = RequireEntityDataLookupName(strEntityClassName, "Entity class name");
	const EntityClasses = LoadEntityData(strSDKBranch);

	return Object.hasOwn(EntityClasses, strRequiredEntityClassName);
}

function GetEntityClassData(strEntityClassName, strSDKBranch = GetActiveSDKBranch()) {
	const strRequiredEntityClassName = RequireEntityDataLookupName(strEntityClassName, "Entity class name");
	const EntityClasses = LoadEntityData(strSDKBranch);
	if (!Object.hasOwn(EntityClasses, strRequiredEntityClassName)) {
		return null;
	}

	return EntityClasses[strRequiredEntityClassName];
}

function GetEntityDataSection(strEntityClassName, strEntityDataSectionName, strSDKBranch = GetActiveSDKBranch()) {
	const strRequiredEntityClassName = RequireEntityDataLookupName(strEntityClassName, "Entity class name");
	const strRequiredEntityDataSectionName = RequireEntityDataLookupName(strEntityDataSectionName, "Entity data section name");
	const strNormalizedEntityDataSectionName = NormalizeEntityDataPublicName(strRequiredEntityDataSectionName);
	const EntityClassData = GetEntityClassData(strRequiredEntityClassName, strSDKBranch);

	const strEntityDataSectionKey = Object.hasOwn(g_EntityDataSectionKeys, strNormalizedEntityDataSectionName) ? g_EntityDataSectionKeys[strNormalizedEntityDataSectionName] : undefined;
	if ((EntityClassData === null) || (strEntityDataSectionKey === undefined) || !Object.hasOwn(EntityClassData, strEntityDataSectionKey)) {
		return null;
	}

	return EntityClassData[strEntityDataSectionKey];
}

function GetEntityDataDescriptor(strEntityClassName, strEntityDataSectionName, strEntityDataDescriptorName, strSDKBranch) {
	const strRequiredEntityClassName = RequireEntityDataLookupName(strEntityClassName, "Entity class name");
	const strRequiredEntityDataSectionName = RequireEntityDataLookupName(strEntityDataSectionName, "Entity data section name");
	const strRequiredEntityDataDescriptorName = RequireEntityDataLookupName(strEntityDataDescriptorName, "Entity descriptor name");
	const strNormalizedEntityDataDescriptorName = NormalizeEntityDataPublicName(strRequiredEntityDataDescriptorName);
	const EntityDataSection = GetEntityDataSection(strRequiredEntityClassName, strRequiredEntityDataSectionName, strSDKBranch);
	if ((EntityDataSection === null) || !Object.hasOwn(EntityDataSection, strNormalizedEntityDataDescriptorName)) {
		return null;
	}

	return EntityDataSection[strNormalizedEntityDataDescriptorName];
}

function GetEntityInputDescriptor(strEntityClassName, strEntityDataDescriptorName, strSDKBranch = GetActiveSDKBranch()) {
	return GetEntityDataDescriptor(strEntityClassName, "Inputs", strEntityDataDescriptorName, strSDKBranch);
}

function GetEntityInstanceAttributeDescriptor(strEntityClassName, strEntityDataDescriptorName, strSDKBranch = GetActiveSDKBranch()) {
	return GetEntityDataDescriptor(strEntityClassName, "InstanceAttributes", strEntityDataDescriptorName, strSDKBranch);
}

function GetEntityKeyValueDescriptor(strEntityClassName, strEntityDataDescriptorName, strSDKBranch = GetActiveSDKBranch()) {
	return GetEntityDataDescriptor(strEntityClassName, "KeyValues", strEntityDataDescriptorName, strSDKBranch);
}

function GetEntityPropertyDescriptor(strEntityClassName, strEntityDataDescriptorName, strSDKBranch = GetActiveSDKBranch()) {
	return GetEntityDataDescriptor(strEntityClassName, "Properties", strEntityDataDescriptorName, strSDKBranch);
}

function GetEntityFunctionDescriptor(strEntityClassName, strEntityDataDescriptorName, strSDKBranch = GetActiveSDKBranch()) {
	return GetEntityDataDescriptor(strEntityClassName, "Functions", strEntityDataDescriptorName, strSDKBranch);
}

function GetEntityVirtualFunctionDescriptor(strEntityClassName, strEntityDataDescriptorName, strSDKBranch = GetActiveSDKBranch()) {
	return GetEntityDataDescriptor(strEntityClassName, "VirtualFunctions", strEntityDataDescriptorName, strSDKBranch);
}

function GetEntityBasedAttributeDescriptor(strEntityClassName, strEntityDataDescriptorName, strSDKBranch = GetActiveSDKBranch()) {
	return GetEntityDataDescriptor(strEntityClassName, "BasedAttributes", strEntityDataDescriptorName, strSDKBranch);
}

function ClearEntityDataCache() {
	g_mapEntityDataCache.clear();
	g_EntityIndexCache = null;
}

module.exports = {
	ClearEntityDataCache,
	GetEntityBasedAttributeDescriptor,
	GetEntityClassData,
	GetEntityClassDataNames,
	GetEntityDataGroups,
	GetEntityDataPath,
	GetEntityDataSection,
	GetEntityFunctionDescriptor,
	GetEntityInputDescriptor,
	GetEntityInstanceAttributeDescriptor,
	GetEntityKeyValueDescriptor,
	GetEntityPropertyDescriptor,
	GetEntityVirtualFunctionDescriptor,
	GetSupportedEntityDataGroups,
	GetSupportedEntityDataSDKBranches,
	HasEntityClassData,
	LoadEntityData,
};
