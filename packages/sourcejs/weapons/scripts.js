"use strict";

const { DoesFileExist } = require("filesystem");
const { GetModule } = require("internal/runtime");
const { KeyValues } = require("keyvalues");
const { GAME_ROOT } = require("paths");

const g_WeaponsScriptsRuntime = GetModule("weapons/scripts");
const g_mapScriptCache = new Map();
const g_strWeaponClassPrefix = "weapon_";
const g_WeaponScriptClassNamePattern = /^weapon_[a-z0-9_]+$/;

function GetWeaponClassNameFromValue(strWeaponScriptName) {
	if ((typeof strWeaponScriptName !== "string") || !strWeaponScriptName.trim()) {
		throw new TypeError("GetWeaponClassNameFromValue() expects a non-empty weapon script-name string.");
	}

	const strNormalizedWeaponScriptName = strWeaponScriptName.trim().toLowerCase();
	const strWeaponClassName = strNormalizedWeaponScriptName.startsWith(g_strWeaponClassPrefix) ? strNormalizedWeaponScriptName : `${g_strWeaponClassPrefix}${strNormalizedWeaponScriptName}`;
	if (!g_WeaponScriptClassNamePattern.test(strWeaponClassName)) {
		throw new TypeError("GetWeaponClassNameFromValue() accepts only letters, digits, and underscores.");
	}

	return strWeaponClassName;
}

function GetScriptPath(strWeaponScriptName) {
	const strPath = `${GAME_ROOT.replace(/\\/g, "/")}/scripts/${GetWeaponClassNameFromValue(strWeaponScriptName)}.txt`;
	const strNormalizedPath = strPath.replace(/\/+/g, "/");

	return strPath.startsWith("//") ? ("/" + strNormalizedPath) : strNormalizedPath;
}

function Has(strWeaponScriptName) {
	return DoesFileExist(GetScriptPath(strWeaponScriptName));
}

function Load(strWeaponScriptName) {
	const strWeaponClassName = GetWeaponClassNameFromValue(strWeaponScriptName);
	if (g_mapScriptCache.has(strWeaponClassName)) {
		return g_mapScriptCache.get(strWeaponClassName);
	}

	const strWeaponScriptFilePath = GetScriptPath(strWeaponClassName);
	if (!DoesFileExist(strWeaponScriptFilePath)) {
		throw new Error(`weapons/scripts.Load() could not find weapon script Path="${strWeaponScriptFilePath}".`);
	}

	const WeaponScriptRecord = {
		ClassName: strWeaponClassName,
		KeyValues: KeyValues.CreateKeyValuesFromFile(strWeaponScriptFilePath),
		Name: strWeaponClassName.slice(g_strWeaponClassPrefix.length),
		Path: strWeaponScriptFilePath,
	};

	g_mapScriptCache.set(strWeaponClassName, WeaponScriptRecord);

	return WeaponScriptRecord;
}

// Preserve the public query contract: allocate a snapshot and load missing
// scripts/owned KeyValues into the cache; returned records share those owners.
function GetAll() {
	const vecWeaponScriptRecords = [];
	for (const strWeaponClassName of g_WeaponsScriptsRuntime.GetClasses()) {
		if (Has(strWeaponClassName)) {
			vecWeaponScriptRecords.push(Load(strWeaponClassName));
		}
	}

	return vecWeaponScriptRecords;
}

function ClearCache() {
	// Public cleanup contract: false results do not abort; exceptions leave the cache.
	for (const WeaponScriptRecord of g_mapScriptCache.values()) {
		WeaponScriptRecord.KeyValues.DestroyKeyValues();
	}

	g_mapScriptCache.clear();

	return true;
}

const g_WeaponScriptsAPI = {
	GetAll,
	GetClasses: g_WeaponsScriptsRuntime.GetClasses,
	ClearCache,
	Has,
	Load,
	GetNames: g_WeaponsScriptsRuntime.GetNames,
	GetScriptPath,
};

module.exports = g_WeaponScriptsAPI;
