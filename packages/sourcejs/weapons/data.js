"use strict";

const { DoesFileExist, ReadTextFile } = require("filesystem");
const { GetGlobalVariables } = require("globals");
const { SOURCE_DATA_ROOT } = require("paths");
const { Load: g_LoadWeaponScript } = require("weapons/scripts");

const g_vecSupportedBranches = Object.freeze([
	"blade",
	"bms",
	"csgo",
	"css",
	"dods",
	"gmod",
	"hl2dm",
	"l4d2",
	"tf2",
]);

const g_mapDataCache = new Map();

function RequireString(strValue, strName) {
	if (typeof strValue !== "string") {
		throw new TypeError(`${strName} must be a string.`);
	}

	return strValue;
}

function GetBranchName(strBranch) {
	const strValue = RequireString(strBranch, "Weapon data branch").trim().toLowerCase();
	if (strValue.length === 0) {
		throw new TypeError("Weapon data branch must not be empty.");
	}

	if (!/^[a-z0-9_]+$/.test(strValue)) {
		throw new TypeError("Weapon data branch must contain only letters, digits or underscores.");
	}

	return strValue;
}

function GetActiveBranch() {
	return GetBranchName(GetGlobalVariables().SDKBranch);
}

function GetSlashPath(strRoot, strDirectory, strFileName) {
	const strPath = `${strRoot}/${strDirectory}/${strFileName}`.replace(/\\/g, "/");
	const strNormalizedPath = strPath.replace(/\/+/g, "/");

	return strPath.startsWith("//") ? ("/" + strNormalizedPath) : strNormalizedPath;
}

function StripComment(strLine) {
	let bEscaped = false;
	let bQuoted = false;
	let strResult = "";
	for (const strCharacter of strLine) {
		if (bEscaped) {
			strResult += strCharacter;
			bEscaped = false;
			continue;
		}

		if (strCharacter === "\\") {
			strResult += strCharacter;
			bEscaped = true;
			continue;
		}

		if (strCharacter === "\"") {
			bQuoted = !bQuoted;
			strResult += strCharacter;
			continue;
		}

		if (!bQuoted && (strCharacter === "#")) {
			break;
		}

		strResult += strCharacter;
	}

	if (bQuoted) {
		throw new SyntaxError("Weapon data contains an unterminated quoted value.");
	}

	return strResult.trim();
}

function ParseValue(strValue) {
	const strText = strValue.trim();
	if ((strText.length >= 2) && strText.startsWith("\"") && strText.endsWith("\"")) {
		return strText.slice(1, -1).replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
	}

	if (/^-?\d+$/.test(strText)) {
		return Number.parseInt(strText, 10);
	}

	if (/^-?(?:\d+\.\d*|\d*\.\d+)$/.test(strText)) {
		return Number.parseFloat(strText);
	}

	return strText;
}

function SetUniqueProperty(TargetObject, strKey, Value, unLineNumber) {
	if (Object.hasOwn(TargetObject, strKey)) {
		throw new SyntaxError(`Duplicate weapon data key "${strKey}" on line ${unLineNumber}.`);
	}

	TargetObject[strKey] = Value;
}

function ParseConfigurationObject(strText) {
	RequireString(strText, "Weapon data text");

	const Root = Object.create(null);
	let CurrentObject = Root;
	let CurrentSection = null;
	const vecLines = strText.split(/\r?\n/);
	for (let unLineIndex = 0; unLineIndex < vecLines.length; unLineIndex += 1) {
		const unLineNumber = unLineIndex + 1;
		const strLine = StripComment(vecLines[unLineIndex]);
		if (strLine.length === 0) {
			continue;
		}

		const vecNestedSection = strLine.match(/^\[\[([^\]]+)]]$/);
		if (vecNestedSection) {
			if (!CurrentSection) {
				throw new SyntaxError(`Nested weapon data section on line ${unLineNumber} has no parent section.`);
			}

			const strName = vecNestedSection[1].trim();
			const NestedObject = Object.create(null);

			if (strName.length === 0) {
				throw new SyntaxError(`Nested weapon data section on line ${unLineNumber} has no name.`);
			}

			SetUniqueProperty(CurrentSection, strName, NestedObject, unLineNumber);
			CurrentObject = NestedObject;
			continue;
		}

		const vecSection = strLine.match(/^\[([^\]]+)]$/);
		if (vecSection) {
			const strName = vecSection[1].trim();
			const SectionObject = Object.create(null);

			if (strName.length === 0) {
				throw new SyntaxError(`Weapon data section on line ${unLineNumber} has no name.`);
			}

			SetUniqueProperty(Root, strName, SectionObject, unLineNumber);
			CurrentSection = SectionObject;
			CurrentObject = SectionObject;
			continue;
		}

		const nSeparatorIndex = strLine.indexOf("=");
		if (nSeparatorIndex < 0) {
			throw new SyntaxError(`Weapon data line ${unLineNumber} must contain "=".`);
		}

		const strKey = strLine.slice(0, nSeparatorIndex).trim();
		if (strKey.length === 0) {
			throw new SyntaxError(`Weapon data line ${unLineNumber} has no key.`);
		}

		SetUniqueProperty(CurrentObject, strKey, ParseValue(strLine.slice(nSeparatorIndex + 1)), unLineNumber);
	}

	return Root;
}

function GetOptionalNumber(Value, strName) {
	if ((Value === "") || (Value === null) || (Value === undefined)) {
		return null;
	}

	if (!Number.isFinite(Value)) {
		throw new TypeError(`${strName} must be a finite number or empty.`);
	}

	return Value;
}

function GetOptionalScalar(Value) {
	if ((Value === "") || (Value === undefined)) {
		return null;
	}

	return Value;
}

function GetTagsFromValue(Value) {
	if ((Value === undefined) || (Value === "")) {
		return ["all"];
	}

	if (typeof Value !== "string") {
		throw new TypeError("Weapon tags must be a comma-separated string.");
	}

	const vecTags = [];
	for (const strPart of Value.split(",")) {
		const strTag = strPart.trim();
		if ((strTag.length > 0) && !vecTags.includes(strTag)) {
			vecTags.push(strTag);
		}
	}

	return (vecTags.length > 0) ? vecTags : ["all"];
}

function RequireSection(Source, strSectionName) {
	const Section = Source[strSectionName];
	if (!Section || (typeof Section !== "object") || Array.isArray(Section)) {
		throw new SyntaxError(`Weapon data requires a [${strSectionName}] section.`);
	}

	return Section;
}

// Raw names preserve the documented weapon INI schema and exact engine send-property names.
function NormalizeProperties(Source) {
	const AmmoProperty = GetOptionalScalar(Source.ammo_property);
	const MyWeaponsProperty = GetOptionalScalar(Source.my_weapons_property);
	const Prefix = GetOptionalScalar(Source.prefix);

	return {
		AmmoProperty: (AmmoProperty === null) ? "m_iAmmo." : AmmoProperty,
		MyWeaponsProperty: (MyWeaponsProperty === null) ? "m_hMyWeapons." : MyWeaponsProperty,
		Prefix: (Prefix === null) ? "weapon_" : Prefix,
	};
}

function NormalizeWeaponRecord(strBaseName, Source, Properties) {
	if (!Source || (typeof Source !== "object") || Array.isArray(Source)) {
		throw new TypeError(`Weapon data record "${strBaseName}" must be an object.`);
	}

	const strClassName = strBaseName.startsWith(Properties.Prefix) ? strBaseName : `${Properties.Prefix}${strBaseName}`;
	const strWeaponName = strClassName.slice(Properties.Prefix.length);
	const vecTags = GetTagsFromValue(Source.tags);

	return {
		AmmoProperty: GetOptionalScalar(Source.ammo_property),
		BaseName: strBaseName,
		ClassName: strClassName,
		Classes: [strClassName],
		Clip: GetOptionalNumber(Source.clip, `${strBaseName}.clip`),
		Cost: GetOptionalNumber(Source.cost, `${strBaseName}.cost`),
		Data: Source,
		ID: GetOptionalScalar(Source.id),
		ItemDefinitionIndex: Number.isFinite(Source.id) ? Source.id : null,
		MaximumAmmo: GetOptionalScalar(Source.maximum_ammo),
		Name: strWeaponName,
		Names: [strWeaponName, strBaseName],
		ParentClass: GetOptionalScalar(Source.parent_class),
		// Public record contract: this getter invokes the weapon-script loader on demand.
		get Script() {
			return g_LoadWeaponScript(strClassName);
		},
		SecondaryAmmoProperty: GetOptionalScalar(Source.secondary_fire_ammo_property),
		SecondaryMaximumAmmo: GetOptionalScalar(Source.secondary_fire_maximum_ammo),
		Slot: GetOptionalScalar(Source.slot),
		Tags: vecTags,
		Type: GetOptionalScalar(Source.type),
	};
}

function NormalizeWeaponData(Source) {
	const Properties = NormalizeProperties(RequireSection(Source, "properties"));
	const WeaponSection = RequireSection(Source, "weapons");
	const vecWeapons = [];
	for (const vecWeaponEntry of Object.entries(WeaponSection)) {
		const strBaseName = vecWeaponEntry[0];
		const Record = vecWeaponEntry[1];
		vecWeapons.push(NormalizeWeaponRecord(strBaseName, Record, Properties));
	}

	const vecTags = [];
	for (const Weapon of vecWeapons) {
		for (const strTag of Weapon.Tags) {
			if (!vecTags.includes(strTag)) {
				vecTags.push(strTag);
			}
		}
	}

	const Projectiles = Source.projectiles;
	const SpecialNames = Source["special names"];

	return {
		Projectiles: ((Projectiles === null) || (Projectiles === undefined)) ? Object.create(null) : Projectiles,
		Properties,
		SpecialNames: ((SpecialNames === null) || (SpecialNames === undefined)) ? Object.create(null) : SpecialNames,
		Tags: vecTags,
		Weapons: vecWeapons,
	};
}

function ParseWeaponINI(strText) {
	return NormalizeWeaponData(ParseConfigurationObject(strText));
}

function GetDataPath(strBranch = GetActiveBranch()) {
	return GetSlashPath(SOURCE_DATA_ROOT, "weapons", `${GetBranchName(strBranch)}.ini`);
}

function Load(strBranch = GetActiveBranch()) {
	const strBranchName = GetBranchName(strBranch);
	if (g_mapDataCache.has(strBranchName)) {
		return g_mapDataCache.get(strBranchName);
	}

	const strPath = GetDataPath(strBranchName);
	if (!DoesFileExist(strPath)) {
		throw new Error(`Weapon data is unavailable for SDK branch "${strBranchName}".`);
	}

	const WeaponData = ParseWeaponINI(ReadTextFile(strPath));
	WeaponData.Branch = strBranchName;
	WeaponData.Path = strPath;
	g_mapDataCache.set(strBranchName, WeaponData);

	return WeaponData;
}

function Has(strBranch = GetActiveBranch()) {
	return DoesFileExist(GetDataPath(strBranch));
}

// Established cached queries may synchronously load a profile on the first access.
function GetProperties(strBranch = GetActiveBranch()) {
	return Load(strBranch).Properties;
}

function GetSpecialNames(strBranch = GetActiveBranch()) {
	return Load(strBranch).SpecialNames;
}

function GetProjectiles(strBranch = GetActiveBranch()) {
	return Load(strBranch).Projectiles;
}

function GetTags(strBranch = GetActiveBranch()) {
	return Load(strBranch).Tags;
}

function GetAll(strBranch = GetActiveBranch()) {
	return Load(strBranch).Weapons;
}

function FormatName(strWeaponName, strBranch = GetActiveBranch()) {
	let strNormalizedName = RequireString(strWeaponName, "Weapon name").trim().toLowerCase();
	if (strNormalizedName.length === 0) {
		throw new TypeError("Weapon name must not be empty.");
	}

	const WeaponData = Load(strBranch);
	const strSpecialName = WeaponData.SpecialNames[strNormalizedName];
	if ((strSpecialName !== null) && (strSpecialName !== undefined)) {
		strNormalizedName = strSpecialName;
	}

	const strProjectile = WeaponData.Projectiles[strNormalizedName];
	if ((strProjectile !== null) && (strProjectile !== undefined)) {
		strNormalizedName = strProjectile;
	}

	if (strNormalizedName.length === 0) {
		return "";
	}

	return strNormalizedName.startsWith(WeaponData.Properties.Prefix) ? strNormalizedName : `${WeaponData.Properties.Prefix}${strNormalizedName}`;
}

function Get(strWeaponName, strBranch = GetActiveBranch()) {
	const strNormalizedName = RequireString(strWeaponName, "Weapon name").trim().toLowerCase();
	const strClassName = FormatName(strNormalizedName, strBranch);

	for (const Record of GetAll(strBranch)) {
		if ((Record.ClassName === strClassName) || (Record.ClassName === strNormalizedName) || (Record.Name === strNormalizedName) || (Record.BaseName === strNormalizedName) || Record.Names.includes(strNormalizedName)) {
			return Record;
		}
	}

	return null;
}

function GetNames(strBranch = GetActiveBranch()) {
	const vecWeaponNames = [];
	for (const Record of GetAll(strBranch)) {
		vecWeaponNames.push(Record.Name);
	}

	return vecWeaponNames;
}

function GetClasses(strBranch = GetActiveBranch()) {
	const vecWeaponClasses = [];
	for (const Record of GetAll(strBranch)) {
		vecWeaponClasses.push(Record.ClassName);
	}

	return vecWeaponClasses;
}

function ClearCache() {
	g_mapDataCache.clear();

	return true;
}

const g_WeaponDataAPI = {
	SUPPORTED_BRANCHES: g_vecSupportedBranches,
	GetAll,
	GetClasses,
	ClearCache,
	GetDataPath,
	FormatName,
	Get,
	Has,
	Load,
	GetNames,
	ParseConfigurationObject,
	ParseWeaponINI,
	GetProjectiles,
	GetProperties,
	GetSpecialNames,
	GetTags,
};

module.exports = g_WeaponDataAPI;
