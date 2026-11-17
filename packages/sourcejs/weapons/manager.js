"use strict";

const { GetModule } = require("internal/runtime");
const { DecorateWeapon } = require("weapons");
const {
	FormatName,
	Get,
	GetAll,
	GetClasses,
	GetProperties,
	GetProjectiles,
	GetSpecialNames,
	GetTags,
} = require("weapons/data");
const { WeaponClass } = require("weapons/instance");

const g_WeaponManagerRuntime = GetModule("weapons/manager");
const g_mapClassCache = new WeakMap();

function DecorateWeapons(vecWeaponEntities) {
	const vecDecoratedWeapons = [];
	for (const WeaponEntity of vecWeaponEntities) {
		vecDecoratedWeapons.push(DecorateWeapon(WeaponEntity));
	}

	return vecDecoratedWeapons;
}

function GetOrCreateWeaponClass(WeaponRecord) {
	if (!WeaponRecord) {
		return null;
	}

	if (!g_mapClassCache.has(WeaponRecord)) {
		g_mapClassCache.set(WeaponRecord, new WeaponClass(WeaponRecord));
	}

	return g_mapClassCache.get(WeaponRecord);
}

function GetAllWeapons() {
	return DecorateWeapons(g_WeaponManagerRuntime.GetAllWeapons());
}

function GetWeaponsByClassName(strWeaponClassName) {
	return DecorateWeapons(g_WeaponManagerRuntime.GetWeaponsByClassName(strWeaponClassName));
}

function GetWeaponsByName(strWeaponName) {
	return DecorateWeapons(g_WeaponManagerRuntime.GetWeaponsByName(strWeaponName));
}

function GetCurrentWeapon(PlayerReference) {
	return DecorateWeapon(g_WeaponManagerRuntime.GetCurrentWeapon(PlayerReference));
}

// Preserve the public lazy-profile API: queries may load files, cache wrappers,
// or allocate result snapshots, including through the existing accessors.
class WeaponManager {
	FormatName(strWeaponName) {
		return FormatName(strWeaponName);
	}

	Get(strWeaponName) {
		return GetOrCreateWeaponClass(Get(strWeaponName));
	}

	Has(strWeaponName) {
		return Get(strWeaponName) !== null;
	}

	Keys() {
		return GetClasses();
	}

	Values() {
		const vecWeaponClasses = [];
		for (const WeaponRecord of GetAll()) {
			vecWeaponClasses.push(GetOrCreateWeaponClass(WeaponRecord));
		}

		return vecWeaponClasses;
	}

	Entries() {
		const vecWeaponEntries = [];
		for (const WeaponClassInstance of this.Values()) {
			vecWeaponEntries.push([WeaponClassInstance.ClassName, WeaponClassInstance]);
		}

		return vecWeaponEntries;
	}

	[Symbol.iterator]() {
		return this.Values()[Symbol.iterator]();
	}

	get AmmoProperty() {
		return GetProperties().AmmoProperty;
	}

	get MyWeaponsProperty() {
		return GetProperties().MyWeaponsProperty;
	}

	get Prefix() {
		return GetProperties().Prefix;
	}

	get Projectiles() {
		return GetProjectiles();
	}

	get SpecialNames() {
		return GetSpecialNames();
	}

	get Tags() {
		return GetTags();
	}
}

const g_WeaponManager = new WeaponManager();

const g_WeaponManagerAPI = {
	WEAPON_MANAGER: g_WeaponManager,
	WeaponManager,
	GetAllWeapons,
	GetWeaponsByClassName,
	GetWeaponsByName,
	GetClasses: g_WeaponManagerRuntime.GetClasses,
	GetCount: g_WeaponManagerRuntime.GetCount,
	GetCurrentWeapon,
	GetNames: g_WeaponManagerRuntime.GetNames,
};

module.exports = g_WeaponManagerAPI;
