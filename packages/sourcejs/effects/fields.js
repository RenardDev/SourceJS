"use strict";

const { DoesFileExist, ReadTextFile } = require("filesystem");
const { GetGlobalVariables } = require("globals");
const { SOURCE_DATA_ROOT } = require("paths");

const g_strEffectsIndexFileName = "index.json";
const g_vecSupportedSDKBranches = Object.freeze([
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
const g_mapFieldGroupDataCache = new Map();
const g_mapFieldDefinitionCache = new Map();
let g_EffectsIndexCache = null;
let g_AggregateFieldDataCache = null;

function GetOwnEffectDataEntry(Entries, strEntryName) {
	return Object.hasOwn(Entries, strEntryName) ? Entries[strEntryName] : undefined;
}

function SetOwnEffectDataEntry(Entries, strEntryName, Value) {
	Object.defineProperty(Entries, strEntryName, { configurable: true, enumerable: true, value: Value, writable: true });
}

function JoinSlashPath(...vecPathParts) {
	const vecNormalizedPathParts = [];
	for (const PathPart of vecPathParts) {
		if ((PathPart === null) || (PathPart === undefined)) {
			continue;
		}

		const strPathPartText = String(PathPart);
		if (strPathPartText.length === 0) {
			continue;
		}

		vecNormalizedPathParts.push(strPathPartText.replace(/\\/g, "/"));
	}

	const strJoinedPath = vecNormalizedPathParts.join("/");
	const strNormalizedPath = strJoinedPath.replace(/\/+/g, "/");
	if (/^\/\/[^/]/.test(strJoinedPath)) {
		return `/${strNormalizedPath}`;
	}

	return strNormalizedPath;
}

function NormalizeFieldName(strFieldName) {
	const strFieldNameText = String(strFieldName ?? "").trim();

	const NormalizeUnderscoreSequence = (strUnderscoreSequence) => strUnderscoreSequence[1].toUpperCase();
	const strNormalizedFieldName = strFieldNameText.replace(/_[a-z0-9]/g, NormalizeUnderscoreSequence).replace(/_/g, "");
	if (strNormalizedFieldName.length === 0) {
		return strNormalizedFieldName;
	}

	return strNormalizedFieldName[0].toUpperCase() + strNormalizedFieldName.slice(1);
}

function GetEffectClassNameFromPath(strEffectFilePath) {
	const vecPathParts = String(strEffectFilePath ?? "").split("/");
	const strEffectFileName = vecPathParts[vecPathParts.length - 1] ?? "";

	return strEffectFileName.replace(/\.ini$/i, "");
}

function RequireSDKBranch(strSDKBranch) {
	if ((typeof strSDKBranch !== "string") || (strSDKBranch.length === 0)) {
		throw new TypeError("SDK branch must be a non-empty string.");
	}

	return strSDKBranch;
}

function GetActiveSDKBranch() {
	return RequireSDKBranch(GetGlobalVariables().SDKBranch);
}

function GetSupportedSDKBranches() {
	return g_vecSupportedSDKBranches;
}

function GetEffectsIndexFilePath() {
	return JoinSlashPath(SOURCE_DATA_ROOT, "effects", g_strEffectsIndexFileName);
}

function GetEffectsDataFilePath(strRelativeEffectDataPath) {
	return JoinSlashPath(SOURCE_DATA_ROOT, "effects", strRelativeEffectDataPath);
}

function StripINIComment(strINILine) {
	let bInsideQuotes = false;
	let strUncommentedLine = "";
	for (const strCharacter of String(strINILine ?? "")) {
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
	const strINIValueText = String(strINIValue ?? "").trim();
	const bIsQuoted = (strINIValueText.length >= 2) && (strINIValueText[0] === "\"") && (strINIValueText[strINIValueText.length - 1] === "\"");

	return bIsQuoted ? strINIValueText.slice(1, -1) : strINIValueText;
}

function ParseCSVValues(strCSVValue) {
	const vecCSVParts = String(strCSVValue ?? "").split(",");
	const vecParsedValues = [];
	for (const strCSVPart of vecCSVParts) {
		const strParsedValue = UnquoteINIValue(strCSVPart);
		if (strParsedValue.length === 0) {
			continue;
		}

		vecParsedValues.push(strParsedValue);
	}

	return vecParsedValues;
}

function IsFieldName(strFieldName) {
	const strFieldNameText = String(strFieldName ?? "").trim();

	return /^[A-Za-z_][A-Za-z0-9_]*$/.test(strFieldNameText) && !strFieldNameText.startsWith("m_");
}

function NormalizeFieldReference(strFieldReference) {
	const strFieldReferenceText = UnquoteINIValue(strFieldReference);

	return IsFieldName(strFieldReferenceText) ? NormalizeFieldName(strFieldReferenceText) : strFieldReferenceText;
}

function ParseINIAssignment(strAssignmentLine) {
	const vecAssignmentParts = String(strAssignmentLine ?? "").split("=");
	for (let unAssignmentPartIndex = 0; unAssignmentPartIndex < vecAssignmentParts.length; unAssignmentPartIndex += 1) {
		vecAssignmentParts[unAssignmentPartIndex] = vecAssignmentParts[unAssignmentPartIndex].trim();
	}

	if ((vecAssignmentParts.length < 2) || (vecAssignmentParts[0].length === 0)) {
		return null;
	}

	let strAssignmentType = null;

	if (vecAssignmentParts.length > 2) {
		let strAssignmentTypeText = vecAssignmentParts[2];
		for (let unAssignmentPartIndex = 3; unAssignmentPartIndex < vecAssignmentParts.length; unAssignmentPartIndex += 1) {
			strAssignmentTypeText += `=${vecAssignmentParts[unAssignmentPartIndex]}`;
		}

		strAssignmentType = UnquoteINIValue(strAssignmentTypeText);
	}

	return { Key: NormalizeFieldName(vecAssignmentParts[0]), Type: strAssignmentType, Value: UnquoteINIValue(vecAssignmentParts[1]) };
}

function ParseEffectINI(strEffectINIText) {
	const ParsedEffectINI = { Fields: [], Types: [] };
	const EffectSections = Object.create(null);
	let strActiveSectionName = null;
	for (const strRawINILine of String(strEffectINIText ?? "").split(/\r?\n/)) {
		const strINILine = StripINIComment(strRawINILine);
		if (strINILine.length === 0) {
			continue;
		}

		const vecSectionMatch = strINILine.match(/^\[([^\]]+)]$/);
		if (vecSectionMatch) {
			strActiveSectionName = NormalizeFieldName(vecSectionMatch[1]);
			EffectSections[strActiveSectionName] = Object.create(null);
			continue;
		}

		const FieldAssignment = ParseINIAssignment(strINILine);
		if (!FieldAssignment) {
			continue;
		}

		if (strActiveSectionName === null) {
			ParsedEffectINI.Fields.push([FieldAssignment.Key, FieldAssignment.Value]);
			if (FieldAssignment.Type) {
				ParsedEffectINI.Types.push([FieldAssignment.Key, FieldAssignment.Type, NormalizeFieldReference(FieldAssignment.Value)]);
			}

			continue;
		}

		EffectSections[strActiveSectionName][FieldAssignment.Key] = FieldAssignment.Value;
	}

	for (const strSectionName in EffectSections) {
		const SectionData = EffectSections[strSectionName];
		const vecSectionFields = ParseCSVValues(SectionData.Name);
		for (let unSectionFieldIndex = 0; unSectionFieldIndex < vecSectionFields.length; unSectionFieldIndex += 1) {
			vecSectionFields[unSectionFieldIndex] = NormalizeFieldReference(vecSectionFields[unSectionFieldIndex]);
		}

		if (!SectionData.Type || (vecSectionFields.length === 0)) {
			continue;
		}

		ParsedEffectINI.Types.push([strSectionName, SectionData.Type, (vecSectionFields.length === 1) ? vecSectionFields[0] : vecSectionFields]);
	}

	return ParsedEffectINI;
}

function LoadEffectsIndex() {
	if (g_EffectsIndexCache !== null) {
		return g_EffectsIndexCache;
	}

	const strEffectsIndexFilePath = GetEffectsIndexFilePath();
	if (!DoesFileExist(strEffectsIndexFilePath)) {
		throw new ReferenceError(`Effects field index does not exist: ${strEffectsIndexFilePath}`);
	}

	const EffectsIndex = JSON.parse(String(ReadTextFile(strEffectsIndexFilePath)).replace(/^\uFEFF/, ""));
	if (!EffectsIndex || (typeof EffectsIndex !== "object") || Array.isArray(EffectsIndex)) {
		throw new TypeError(`Effects field index has an invalid schema: ${strEffectsIndexFilePath}`);
	}

	const EffectsBranchIndex = GetOwnEffectDataEntry(EffectsIndex, "Branches");
	const EffectsGroupIndex = GetOwnEffectDataEntry(EffectsIndex, "Groups");
	const bHasValidEffectsBranchIndex = (EffectsBranchIndex !== null) && (typeof EffectsBranchIndex === "object") && !Array.isArray(EffectsBranchIndex);
	const bHasValidEffectsGroupIndex = (EffectsGroupIndex !== null) && (typeof EffectsGroupIndex === "object") && !Array.isArray(EffectsGroupIndex);
	if (!bHasValidEffectsBranchIndex || !bHasValidEffectsGroupIndex) {
		throw new TypeError(`Effects field index has an invalid schema: ${strEffectsIndexFilePath}`);
	}

	g_EffectsIndexCache = EffectsIndex;

	return g_EffectsIndexCache;
}

function LoadEffectsFieldGroup(strFieldGroupName) {
	const strFieldGroupKey = String(strFieldGroupName ?? "");
	if (g_mapFieldGroupDataCache.has(strFieldGroupKey)) {
		return g_mapFieldGroupDataCache.get(strFieldGroupKey);
	}

	const vecFieldGroupFilePaths = GetOwnEffectDataEntry(LoadEffectsIndex().Groups, strFieldGroupKey);
	if (!Array.isArray(vecFieldGroupFilePaths)) {
		throw new TypeError(`Effects field group is not an array: ${strFieldGroupKey}`);
	}

	const FieldGroupData = {};
	for (const strRelativeFieldFilePath of vecFieldGroupFilePaths) {
		const strFieldFilePath = GetEffectsDataFilePath(strRelativeFieldFilePath);
		if (!DoesFileExist(strFieldFilePath)) {
			throw new ReferenceError(`Effects field file does not exist: ${strFieldFilePath}`);
		}

		SetOwnEffectDataEntry(FieldGroupData, GetEffectClassNameFromPath(strRelativeFieldFilePath), ParseEffectINI(ReadTextFile(strFieldFilePath)));
	}

	g_mapFieldGroupDataCache.set(strFieldGroupKey, FieldGroupData);

	return FieldGroupData;
}

function MergeEffectFieldDefinition(TargetDefinition, SourceDefinition) {
	if (SourceDefinition === undefined) {
		return;
	}

	for (const [strFieldName, strPropertyPath] of SourceDefinition.Fields) {
		SetOwnEffectDataEntry(TargetDefinition.Fields, strFieldName, strPropertyPath);
	}

	for (const [strFieldName, strFieldType, FieldReferences] of SourceDefinition.Types) {
		SetOwnEffectDataEntry(TargetDefinition.Types, strFieldName, { ValueFields: FieldReferences, Type: strFieldType });
	}
}

function GetTemporaryEntityFieldGroups(strSDKBranch = GetActiveSDKBranch()) {
	const strNormalizedSDKBranch = RequireSDKBranch(strSDKBranch);
	const EffectsBranchGroupsIndex = LoadEffectsIndex().Branches;
	const vecBranchFieldGroups = GetOwnEffectDataEntry(EffectsBranchGroupsIndex, strNormalizedSDKBranch);
	if (!Array.isArray(vecBranchFieldGroups)) {
		throw new ReferenceError(`Effects field groups are not defined for SDK branch: ${strNormalizedSDKBranch}`);
	}

	return ["common", ...vecBranchFieldGroups];
}

function GetTemporaryEntityFieldDefinition(strTemporaryEntityClassName, strSDKBranch = GetActiveSDKBranch()) {
	if ((typeof strTemporaryEntityClassName !== "string") || (strTemporaryEntityClassName.length === 0)) {
		throw new TypeError("Temp entity class name must be a non-empty string.");
	}

	const strNormalizedSDKBranch = RequireSDKBranch(strSDKBranch);
	const strFieldDefinitionCacheKey = `${strNormalizedSDKBranch}:${strTemporaryEntityClassName}`;
	if (g_mapFieldDefinitionCache.has(strFieldDefinitionCacheKey)) {
		return g_mapFieldDefinitionCache.get(strFieldDefinitionCacheKey);
	}

	const FieldDefinition = { Fields: {}, Types: {} };
	for (const strFieldGroupName of GetTemporaryEntityFieldGroups(strNormalizedSDKBranch)) {
		const FieldGroupData = LoadEffectsFieldGroup(strFieldGroupName);
		MergeEffectFieldDefinition(FieldDefinition, GetOwnEffectDataEntry(FieldGroupData, strTemporaryEntityClassName));
	}

	g_mapFieldDefinitionCache.set(strFieldDefinitionCacheKey, FieldDefinition);

	return FieldDefinition;
}

function GetTemporaryEntityFieldData() {
	if (g_AggregateFieldDataCache !== null) {
		return g_AggregateFieldDataCache;
	}

	const EffectsFieldGroupIndex = LoadEffectsIndex().Groups;
	const LoadedEffectsFieldData = {};
	for (const strFieldGroupName in EffectsFieldGroupIndex) {
		if (!Object.hasOwn(EffectsFieldGroupIndex, strFieldGroupName)) {
			continue;
		}

		SetOwnEffectDataEntry(LoadedEffectsFieldData, strFieldGroupName, LoadEffectsFieldGroup(strFieldGroupName));
	}

	g_AggregateFieldDataCache = LoadedEffectsFieldData;

	return g_AggregateFieldDataCache;
}

function ClearEffectsFieldCache() {
	g_mapFieldGroupDataCache.clear();
	g_mapFieldDefinitionCache.clear();
	g_EffectsIndexCache = null;
	g_AggregateFieldDataCache = null;

	return true;
}

module.exports = {
	ClearEffectsFieldCache,
	GetTemporaryEntityFieldData,
	GetTemporaryEntityFieldDefinition,
	GetTemporaryEntityFieldGroups,
	GetSupportedSDKBranches,
};
