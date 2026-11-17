"use strict";

const g_FilesystemRuntime = require("filesystem");
const g_GlobalsRuntime = require("globals");
// Read the current data root from the live module instead of capturing its value at import time.
const g_Paths = require("paths");

// Keys and directory values preserve the packaged SDK-branch and data-kind spellings.
const g_EngineGroups = Object.freeze({
	bgt: ["bgt"],
	blade: ["blade"],
	bms: ["bms"],
	contagion: ["contagion"],
	csgo: ["csgo"],
	css: ["orangebox"],
	darkm: ["darkm"],
	dods: ["orangebox"],
	doi: ["doi"],
	episode1: ["episode1"],
	eye: ["eye"],
	gmod: ["gmod"],
	hl2dm: ["orangebox"],
	insurgency: ["insurgency"],
	l4d: ["l4d"],
	l4d2: ["l4d2"],
	mcv: ["mcv"],
	nucleardawn: ["nucleardawn"],
	orangebox: ["orangebox"],
	portal2: ["portal2"],
	pvkii: ["pvkii"],
	sdk2013: ["orangebox"],
	swarm: ["swarm"],
	tf2: ["orangebox"],
});

const g_GameGroups = Object.freeze({
	...g_EngineGroups,
	css: ["orangebox", "orangebox/cstrike"],
	dods: ["orangebox", "orangebox/dod"],
	hl2dm: ["orangebox", "orangebox/hl2mp"],
	tf2: ["orangebox", "orangebox/tf"],
});

const g_GroupTables = Object.freeze({
	client: g_EngineGroups,
	effects: g_GameGroups,
	entities: g_GameGroups,
	entityOutputs: g_EngineGroups,
	memory: g_EngineGroups,
});

const g_mapDataCache = new Map();

function RequireGameDataText(strTextValue, strFieldName, bAllowEmpty = false) {
	if (typeof strTextValue !== "string") {
		throw new TypeError(`${strFieldName} must be a string.`);
	}

	const strNormalizedText = strTextValue.trim();
	if (!bAllowEmpty && (strNormalizedText.length === 0)) {
		throw new TypeError(`${strFieldName} must be a non-empty string.`);
	}

	return strNormalizedText;
}

function RequireGameDataKind(strGameDataKind) {
	const strNormalizedKind = RequireGameDataText(strGameDataKind, "GameData kind");
	if (!Object.hasOwn(g_GroupTables, strNormalizedKind)) {
		throw new RangeError(`Unsupported GameData kind: ${strNormalizedKind}`);
	}

	return strNormalizedKind;
}

function JoinGameDataPath(...vecPathParts) {
	const vecNormalizedPathParts = [];
	for (const strPathPart of vecPathParts) {
		if (strPathPart.length === 0) {
			continue;
		}

		vecNormalizedPathParts.push(strPathPart.replace(/\\/g, "/"));
	}

	// Preserve a UNC prefix in the root, not a doubled separator produced by joining a POSIX root.
	const bHasUNCPathPrefix = (vecNormalizedPathParts.length > 0) && /^\/\/[^/]/.test(vecNormalizedPathParts[0]);
	const strNormalizedPath = vecNormalizedPathParts.join("/").replace(/\/+/g, "/");

	return bHasUNCPathPrefix ? `/${strNormalizedPath}` : strNormalizedPath;
}

function RequireSDKBranch(strSDKBranch) {
	return RequireGameDataText(strSDKBranch, "GameData SDK branch").toLowerCase();
}

function GetActiveSDKBranch() {
	const GlobalsInformation = g_GlobalsRuntime.GetGlobalVariables();

	return RequireSDKBranch(GlobalsInformation.SDKBranch);
}

function NormalizeGameDataKey(strGameDataKey) {
	const strKeyText = RequireGameDataText(strGameDataKey, "GameData key");

	return strKeyText.replace(/_[a-z0-9]/g, (strMatchedPair) => strMatchedPair[1].toUpperCase());
}

function NormalizeGameDataPublicKey(strGameDataKey) {
	return NormalizeGameDataKey(strGameDataKey).replace(/^[a-z]/, (strKeyPart) => strKeyPart.toUpperCase());
}

function StripGameDataComment(strConfigurationLine) {
	let bInsideQuotedValue = false;
	let bPreviousCharacterEscapes = false;
	let strUncommentedLine = "";

	for (const strCharacter of strConfigurationLine) {
		if ((strCharacter === "\"") && !bPreviousCharacterEscapes) {
			bInsideQuotedValue = !bInsideQuotedValue;
		}

		if (!bInsideQuotedValue && (strCharacter === "#")) {
			break;
		}

		strUncommentedLine += strCharacter;
		bPreviousCharacterEscapes = (strCharacter === "\\") ? !bPreviousCharacterEscapes : false;
	}

	return strUncommentedLine.trim();
}

function UnquoteGameDataValue(strGameDataValue) {
	const strValueText = strGameDataValue.trim();
	const bIsQuoted = (strValueText.length >= 2) && (strValueText[0] === "\"") && (strValueText[strValueText.length - 1] === "\"");
	if (!bIsQuoted) {
		return strValueText;
	}

	return strValueText.slice(1, -1);
}

function ParseGameDataInteger(strIntegerText, unNumericBase) {
	const nIntegerValue = Number.parseInt(strIntegerText, unNumericBase);
	if (!Number.isSafeInteger(nIntegerValue)) {
		throw new RangeError(`GameData integer is outside the safe integer range: ${strIntegerText}`);
	}

	return nIntegerValue;
}

function ParseGameDataScalar(strGameDataValue) {
	const strValueText = UnquoteGameDataValue(strGameDataValue);
	const strLowercaseValue = strValueText.toLowerCase();
	if (strLowercaseValue === "true") {
		return true;
	}

	if (strLowercaseValue === "false") {
		return false;
	}

	if (/^-?0x[0-9a-f]+$/i.test(strValueText)) {
		return ParseGameDataInteger(strValueText, 16);
	}

	if (/^-?\d+$/.test(strValueText)) {
		return ParseGameDataInteger(strValueText, 10);
	}

	return strValueText;
}

function ParseGameDataValue(strGameDataValue) {
	const strValueText = strGameDataValue.trim();
	const vecScalarValues = [];
	let strScalarText = "";
	let bInsideQuotedValue = false;
	let bPreviousCharacterEscapes = false;
	let bFoundSeparator = false;

	for (const strCharacter of strValueText) {
		if ((strCharacter === "\"") && !bPreviousCharacterEscapes) {
			bInsideQuotedValue = !bInsideQuotedValue;
		}

		if ((strCharacter === ",") && !bInsideQuotedValue) {
			const ScalarValue = ParseGameDataScalar(strScalarText);
			if (ScalarValue !== "") {
				vecScalarValues.push(ScalarValue);
			}

			strScalarText = "";
			bPreviousCharacterEscapes = false;
			bFoundSeparator = true;
			continue;
		}

		strScalarText += strCharacter;
		bPreviousCharacterEscapes = (strCharacter === "\\") ? !bPreviousCharacterEscapes : false;
	}

	if (bInsideQuotedValue) {
		throw new SyntaxError("GameData value contains an unterminated quoted string.");
	}

	if (!bFoundSeparator) {
		return ParseGameDataScalar(strValueText);
	}

	const FinalScalarValue = ParseGameDataScalar(strScalarText);
	if (FinalScalarValue !== "") {
		vecScalarValues.push(FinalScalarValue);
	}

	return vecScalarValues;
}

function ParseGameDataSection(strConfigurationLine) {
	const vecSectionMatch = /^(\[+)([^\]]+)(\]+)$/.exec(strConfigurationLine);
	if (vecSectionMatch === null) {
		return null;
	}

	const strOpeningBrackets = vecSectionMatch[1];
	const strSectionName = vecSectionMatch[2];
	const strClosingBrackets = vecSectionMatch[3];
	if (strOpeningBrackets.length !== strClosingBrackets.length) {
		return null;
	}

	return { SectionLevel: strOpeningBrackets.length, SectionName: NormalizeGameDataPublicKey(strSectionName) };
}

function IsGameDataObject(GameDataValue) {
	return (GameDataValue !== null) && (typeof GameDataValue === "object") && !Array.isArray(GameDataValue);
}

function SetGameDataProperty(GameDataObjectOut, strPropertyName, PropertyValue) {
	Object.defineProperty(GameDataObjectOut, strPropertyName, { configurable: true, enumerable: true, value: PropertyValue, writable: true });
}

function MergeGameDataObjects(TargetObjectOut, SourceObject) {
	if (!IsGameDataObject(TargetObjectOut) || !IsGameDataObject(SourceObject)) {
		throw new TypeError("GameData merge values must be objects.");
	}

	for (const strPropertyName in SourceObject) {
		if (!Object.hasOwn(SourceObject, strPropertyName)) {
			continue;
		}

		const SourceValue = SourceObject[strPropertyName];
		const TargetValue = Object.hasOwn(TargetObjectOut, strPropertyName) ? TargetObjectOut[strPropertyName] : undefined;
		if (IsGameDataObject(SourceValue) && IsGameDataObject(TargetValue)) {
			MergeGameDataObjects(TargetValue, SourceValue);
			continue;
		}

		SetGameDataProperty(TargetObjectOut, strPropertyName, SourceValue);
	}

	return TargetObjectOut;
}

function RequireGameDataGroup(strGameDataGroup) {
	const strNormalizedGroup = RequireGameDataText(strGameDataGroup, "GameData group", true);
	if (strNormalizedGroup.length === 0) {
		return strNormalizedGroup;
	}

	const bHasInvalidCharacters = strNormalizedGroup.includes("\\") || strNormalizedGroup.includes(":");
	const bHasInvalidSlashShape = strNormalizedGroup.startsWith("/") || strNormalizedGroup.endsWith("/") || strNormalizedGroup.includes("//");
	if (bHasInvalidCharacters || bHasInvalidSlashShape) {
		throw new RangeError("GameData group must be a normalized relative path.");
	}

	const vecGroupSegments = strNormalizedGroup.split("/");
	for (const strGroupSegment of vecGroupSegments) {
		if ((strGroupSegment === ".") || (strGroupSegment === "..")) {
			throw new RangeError("GameData group cannot contain traversal segments.");
		}
	}

	return strNormalizedGroup;
}

function RequireGameDataFileName(strDataFileName) {
	const strNormalizedFileName = RequireGameDataText(strDataFileName, "GameData file name");
	if (/[\\/:]/.test(strNormalizedFileName) || (strNormalizedFileName === ".") || (strNormalizedFileName === "..")) {
		throw new RangeError("GameData file name must be a relative file name without path separators.");
	}

	return strNormalizedFileName;
}

function RequireSourceDataRoot() {
	return RequireGameDataText(g_Paths.SOURCE_DATA_ROOT, "Source data root");
}

function BuildGameDataFilePath(strSourceDataRoot, strGameDataKind, strGameDataGroup, strDataFileName) {
	return JoinGameDataPath(strSourceDataRoot, strGameDataKind, strGameDataGroup, strDataFileName);
}

function CheckGameDataFileExists(strGameDataFilePath) {
	const bFileExists = g_FilesystemRuntime.DoesFileExist(strGameDataFilePath);
	if (typeof bFileExists !== "boolean") {
		throw new TypeError("filesystem.DoesFileExist() must return a boolean.");
	}

	return bFileExists;
}

function ParseConfigObject(strGameDataText) {
	if (typeof strGameDataText !== "string") {
		throw new TypeError("GameData configuration text must be a string.");
	}

	const vecConfigurationLines = strGameDataText.split(/\r?\n/);
	const ParsedConfiguration = {};
	const vecSectionStack = [{ SectionLevel: 0, SectionValue: ParsedConfiguration }];

	for (let unLineIndex = 0; unLineIndex < vecConfigurationLines.length; unLineIndex++) {
		const strSourceLine = vecConfigurationLines[unLineIndex];
		const strConfigurationLine = StripGameDataComment(strSourceLine);
		if (strConfigurationLine.length === 0) {
			continue;
		}

		const SectionRecord = ParseGameDataSection(strConfigurationLine);
		if (SectionRecord !== null) {
			const unSectionLevel = SectionRecord.SectionLevel;
			const strSectionName = SectionRecord.SectionName;

			while ((vecSectionStack.length > 1) && (vecSectionStack[vecSectionStack.length - 1].SectionLevel >= unSectionLevel)) {
				vecSectionStack.pop();
			}

			const ParentSection = vecSectionStack[vecSectionStack.length - 1].SectionValue;
			let SectionValue = Object.hasOwn(ParentSection, strSectionName) ? ParentSection[strSectionName] : undefined;
			if (SectionValue === undefined) {
				SectionValue = {};
				SetGameDataProperty(ParentSection, strSectionName, SectionValue);
			} else if (!IsGameDataObject(SectionValue)) {
				throw new SyntaxError(`GameData section conflicts with an existing value on line ${unLineIndex + 1}: ${strSectionName}`);
			}

			vecSectionStack.push({ SectionLevel: unSectionLevel, SectionValue: SectionValue });
			continue;
		}

		const nAssignmentIndex = strConfigurationLine.indexOf("=");
		if (nAssignmentIndex < 0) {
			throw new SyntaxError(`Invalid GameData assignment on line ${unLineIndex + 1}: ${strConfigurationLine}`);
		}

		const strPropertyName = NormalizeGameDataPublicKey(strConfigurationLine.slice(0, nAssignmentIndex));
		const PropertyValue = ParseGameDataValue(strConfigurationLine.slice(nAssignmentIndex + 1));
		const CurrentSection = vecSectionStack[vecSectionStack.length - 1].SectionValue;
		SetGameDataProperty(CurrentSection, strPropertyName, PropertyValue);
	}

	return ParsedConfiguration;
}

function GetGameDataGroups(strGameDataKind, strSDKBranch = GetActiveSDKBranch()) {
	const strNormalizedKind = RequireGameDataKind(strGameDataKind);
	const strNormalizedBranch = RequireSDKBranch(strSDKBranch);
	const GameDataGroupTable = g_GroupTables[strNormalizedKind];
	const vecGameDataGroups = Object.hasOwn(GameDataGroupTable, strNormalizedBranch) ? GameDataGroupTable[strNormalizedBranch] : undefined;
	if (vecGameDataGroups === undefined) {
		throw new RangeError(`Unsupported GameData SDK branch for ${strNormalizedKind}: ${strNormalizedBranch}`);
	}

	return vecGameDataGroups.slice();
}

function GetGameDataPath(strGameDataKind, strGameDataGroup, strDataFileName) {
	const strNormalizedKind = RequireGameDataKind(strGameDataKind);
	const strNormalizedGroup = RequireGameDataGroup(strGameDataGroup);
	const strNormalizedFileName = RequireGameDataFileName(strDataFileName);
	const strSourceDataRoot = RequireSourceDataRoot();

	return BuildGameDataFilePath(strSourceDataRoot, strNormalizedKind, strNormalizedGroup, strNormalizedFileName);
}

function BuildGameDataFilePaths(strSourceDataRoot, strGameDataKind, strDataFileName, strSDKBranch) {
	const vecGameDataGroups = GetGameDataGroups(strGameDataKind, strSDKBranch);
	const vecGameDataFilePaths = [BuildGameDataFilePath(strSourceDataRoot, strGameDataKind, "", strDataFileName)];
	for (const strGameDataGroup of vecGameDataGroups) {
		vecGameDataFilePaths.push(BuildGameDataFilePath(strSourceDataRoot, strGameDataKind, strGameDataGroup, strDataFileName));
	}

	return vecGameDataFilePaths;
}

function GetGameDataPaths(strGameDataKind, strDataFileName, strSDKBranch = GetActiveSDKBranch()) {
	const strNormalizedKind = RequireGameDataKind(strGameDataKind);
	const strNormalizedFileName = RequireGameDataFileName(strDataFileName);
	const strNormalizedBranch = RequireSDKBranch(strSDKBranch);
	const strSourceDataRoot = RequireSourceDataRoot();

	return BuildGameDataFilePaths(strSourceDataRoot, strNormalizedKind, strNormalizedFileName, strNormalizedBranch);
}

function HasGameData(strGameDataKind, strDataFileName, strSDKBranch = GetActiveSDKBranch()) {
	const vecGameDataFilePaths = GetGameDataPaths(strGameDataKind, strDataFileName, strSDKBranch);
	for (const strGameDataFilePath of vecGameDataFilePaths) {
		if (CheckGameDataFileExists(strGameDataFilePath)) {
			return true;
		}
	}

	return false;
}

function LoadGameData(strGameDataKind, strDataFileName, strSDKBranch = GetActiveSDKBranch()) {
	const strNormalizedKind = RequireGameDataKind(strGameDataKind);
	const strNormalizedFileName = RequireGameDataFileName(strDataFileName);
	const strNormalizedBranch = RequireSDKBranch(strSDKBranch);
	// Use one live root snapshot for both cache identity and all file lookups.
	const strSourceDataRoot = RequireSourceDataRoot();
	const strCacheKey = JSON.stringify([strSourceDataRoot, strNormalizedKind, strNormalizedBranch, strNormalizedFileName]);
	if (g_mapDataCache.has(strCacheKey)) {
		return g_mapDataCache.get(strCacheKey);
	}

	const MergedGameData = {};
	const vecGameDataFilePaths = BuildGameDataFilePaths(strSourceDataRoot, strNormalizedKind, strNormalizedFileName, strNormalizedBranch);
	for (const strGameDataFilePath of vecGameDataFilePaths) {
		if (CheckGameDataFileExists(strGameDataFilePath)) {
			const strFileText = g_FilesystemRuntime.ReadTextFile(strGameDataFilePath);
			const FileGameData = ParseConfigObject(strFileText);
			MergeGameDataObjects(MergedGameData, FileGameData);
		}
	}

	g_mapDataCache.set(strCacheKey, MergedGameData);

	return MergedGameData;
}

function ClearGameDataCache() {
	g_mapDataCache.clear();

	return true;
}

module.exports = {
	ClearGameDataCache,
	GetGameDataPath,
	GetGameDataGroups,
	HasGameData,
	LoadGameData,
	ParseConfigObject,
	GetGameDataPaths,
};
