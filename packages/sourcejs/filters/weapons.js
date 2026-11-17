"use strict";

const { IteratorObject } = require("filters/iterator");
const { GetModule } = require("internal/runtime");
const { GetAll: g_GetAllWeaponDataRecords } = require("weapons/data");
const { GetAll: g_GetAllWeaponScripts } = require("weapons/scripts");

const g_NativeWeaponFilters = GetModule("filters/weapons");
const g_NativeWeapons = GetModule("weapons");
const g_mapRegisteredWeaponTagFilters = new Map();
const g_setWeaponIteratorClasses = new Set();
const g_mapWeaponMetadataFields = new Map([
	["BaseName", "BaseWeaponName"],
	["ClassName", "ClassName"],
	["Name", "WeaponName"],
	["Tags", "WeaponTags"],
	["AmmoProperty", "PrimaryAmmoProperty"],
	["Classes", "WeaponClassNames"],
	["Clip", "WeaponClip"],
	["Cost", "WeaponCost"],
	["Data", "WeaponData"],
	["ID", "WeaponID"],
	["ItemDefinitionIndex", "ItemDefinitionIndex"],
	["MaximumAmmo", "PrimaryMaximumAmmo"],
	["Names", "WeaponLookupNames"],
	["ParentClass", "ParentWeaponClassName"],
	["Script", "WeaponScript"],
	["SecondaryAmmoProperty", "SecondaryAmmoProperty"],
	["SecondaryMaximumAmmo", "SecondaryMaximumAmmo"],
	["Slot", "WeaponSlot"],
	["Type", "WeaponType"],
]);

function GetWeaponNameFromClassName(strWeaponClassName) {
	const strWeaponClassPrefix = "weapon_";

	return strWeaponClassName.startsWith(strWeaponClassPrefix) ? strWeaponClassName.slice(strWeaponClassPrefix.length) : strWeaponClassName;
}

function GetWeaponClassName(WeaponValue) {
	if ((WeaponValue === null) || (WeaponValue === undefined) || (typeof WeaponValue !== "object")) {
		return null;
	}

	const strWeaponClassName = WeaponValue.ClassName;
	if ((typeof strWeaponClassName !== "string") || (strWeaponClassName.length === 0)) {
		return null;
	}

	return strWeaponClassName;
}

function CreateMinimalWeaponClassInformation(strWeaponClassName) {
	if ((typeof strWeaponClassName !== "string") || (strWeaponClassName.length === 0)) {
		throw new TypeError("Weapon class name must be a non-empty string.");
	}

	const strWeaponName = GetWeaponNameFromClassName(strWeaponClassName);

	return { BaseWeaponName: strWeaponName, ClassName: strWeaponClassName, WeaponName: strWeaponName, WeaponTags: [] };
}

function CreateWeaponClassInformation(strWeaponClassName, WeaponDataRecord) {
	const WeaponClassInformation = CreateMinimalWeaponClassInformation(strWeaponClassName);
	for (const FieldName of Reflect.ownKeys(WeaponDataRecord)) {
		const FieldDescriptor = Object.getOwnPropertyDescriptor(WeaponDataRecord, FieldName);
		if (!FieldDescriptor.enumerable || (FieldName === "ClassName")) {
			continue;
		}

		const CanonicalFieldName = g_mapWeaponMetadataFields.get(FieldName) ?? FieldName;
		Object.defineProperty(WeaponClassInformation, CanonicalFieldName, { configurable: true, enumerable: true, value: WeaponDataRecord[FieldName], writable: true });
	}

	return WeaponClassInformation;
}

function CollectWeaponClassInformation() {
	const mapWeaponClassesByName = new Map();
	for (const WeaponDataRecord of g_GetAllWeaponDataRecords()) {
		const strWeaponClassName = GetWeaponClassName(WeaponDataRecord);
		if (strWeaponClassName === null) {
			throw new TypeError("weapons/data.GetAll() returned a record without a non-empty ClassName.");
		}

		mapWeaponClassesByName.set(strWeaponClassName, CreateWeaponClassInformation(strWeaponClassName, WeaponDataRecord));
	}

	const vecNativeWeaponClassNames = g_NativeWeapons.Classes();
	for (const strNativeWeaponClassName of vecNativeWeaponClassNames) {
		if (!mapWeaponClassesByName.has(strNativeWeaponClassName)) {
			mapWeaponClassesByName.set(strNativeWeaponClassName, CreateMinimalWeaponClassInformation(strNativeWeaponClassName));
		}
	}

	for (const WeaponScript of g_GetAllWeaponScripts()) {
		const strWeaponClassName = GetWeaponClassName(WeaponScript);
		if (strWeaponClassName === null) {
			throw new TypeError("weapons/scripts.GetAll() returned a record without a non-empty ClassName.");
		}

		mapWeaponClassesByName.set(strWeaponClassName, {
			...(mapWeaponClassesByName.get(strWeaponClassName) ?? CreateMinimalWeaponClassInformation(strWeaponClassName)),
			WeaponScript,
		});
	}

	return Array.from(mapWeaponClassesByName.values());
}

function IsWeaponAlwaysValid() {
	return true;
}

function IsValidWeapon(WeaponEntity) {
	if ((WeaponEntity === null) || (WeaponEntity === undefined) || (typeof WeaponEntity !== "object")) {
		return false;
	}

	return (WeaponEntity.IsWeapon === true) && (WeaponEntity.Valid === true) && (WeaponEntity.Free === false);
}

function RequireWeaponTags(vecWeaponTags, strValueName) {
	if (!Array.isArray(vecWeaponTags)) {
		throw new TypeError(`${strValueName} must be an array.`);
	}

	for (const strWeaponTag of vecWeaponTags) {
		if ((typeof strWeaponTag !== "string") || (strWeaponTag.length === 0)) {
			throw new TypeError(`${strValueName} must contain only non-empty strings.`);
		}
	}

	return vecWeaponTags;
}

function WeaponHasTag(WeaponValue, strWeaponTag) {
	if ((WeaponValue === null) || (WeaponValue === undefined) || (typeof WeaponValue !== "object")) {
		return false;
	}

	const vecDirectWeaponTags = WeaponValue.WeaponTags;
	if (vecDirectWeaponTags !== undefined) {
		return RequireWeaponTags(vecDirectWeaponTags, "Weapon tags").includes(strWeaponTag);
	}

	const strWeaponClassName = GetWeaponClassName(WeaponValue);
	if (strWeaponClassName === null) {
		return false;
	}

	for (const WeaponClassInformation of CollectWeaponClassInformation()) {
		if (WeaponClassInformation.ClassName !== strWeaponClassName) {
			continue;
		}

		return RequireWeaponTags(WeaponClassInformation.WeaponTags, `${strWeaponClassName} weapon class tags`).includes(strWeaponTag);
	}

	return false;
}

function SynchronizeWeaponTagFilters(IteratorClass, setWeaponTags) {
	let mapRegisteredTagFilters = g_mapRegisteredWeaponTagFilters.get(IteratorClass);
	if (mapRegisteredTagFilters === undefined) {
		mapRegisteredTagFilters = new Map();
		g_mapRegisteredWeaponTagFilters.set(IteratorClass, mapRegisteredTagFilters);
	}

	for (const [strRegisteredTag, RegisteredFilterCallback] of mapRegisteredTagFilters) {
		if (setWeaponTags.has(strRegisteredTag)) {
			continue;
		}

		// A plugin may replace or remove a generated filter before its metadata tag disappears.
		if (IteratorClass.Filters.get(strRegisteredTag) === RegisteredFilterCallback) {
			IteratorClass.UnregisterFilter(strRegisteredTag);
		}

		mapRegisteredTagFilters.delete(strRegisteredTag);
	}

	for (const strWeaponTag of setWeaponTags) {
		if (IteratorClass.HasFilter(strWeaponTag)) {
			continue;
		}

		const FilterCallback = (WeaponValue) => WeaponHasTag(WeaponValue, strWeaponTag);
		IteratorClass.RegisterFilter(strWeaponTag, FilterCallback);
		mapRegisteredTagFilters.set(strWeaponTag, FilterCallback);
	}
}

function RefreshTagFilters() {
	const setWeaponTags = new Set();
	const vecWeaponClassInformationRecords = CollectWeaponClassInformation();
	for (const WeaponClassInformation of vecWeaponClassInformationRecords) {
		const vecWeaponClassTags = RequireWeaponTags(WeaponClassInformation.WeaponTags, `${WeaponClassInformation.ClassName} weapon class tags`);
		for (const strWeaponTag of vecWeaponClassTags) {
			setWeaponTags.add(strWeaponTag);
		}
	}

	for (const WeaponIteratorClass of g_setWeaponIteratorClasses) {
		SynchronizeWeaponTagFilters(WeaponIteratorClass, setWeaponTags);
	}

	return vecWeaponClassInformationRecords;
}

class WeaponIterator extends IteratorObject {
	constructor(RequiredFilters = null, ExcludedFilters = null) {
		RefreshTagFilters();
		super(RequiredFilters, ExcludedFilters);
	}

	static Iterator() {
		RefreshTagFilters();

		return g_NativeWeaponFilters.GetAllWeapons();
	}
}

class WeaponClassIterator extends IteratorObject {
	constructor(RequiredFilters = null, ExcludedFilters = null) {
		RefreshTagFilters();
		super(RequiredFilters, ExcludedFilters);
	}

	static Iterator() {
		return RefreshTagFilters();
	}
}

g_setWeaponIteratorClasses.add(WeaponIterator);
g_setWeaponIteratorClasses.add(WeaponClassIterator);

WeaponIterator.RegisterFilter("All", IsWeaponAlwaysValid);
WeaponIterator.RegisterFilter("Valid", IsValidWeapon);
WeaponClassIterator.RegisterFilter("All", IsWeaponAlwaysValid);

Object.assign(g_NativeWeaponFilters, { WeaponClassIterator, WeaponIterator });

module.exports = g_NativeWeaponFilters;
