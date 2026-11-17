"use strict";

const { DecorateEntity } = require("entities");
const { GetModule } = require("internal/runtime");

const g_WeaponsRuntime = GetModule("weapons");
const g_PlayerWeaponRuntime = GetModule("players/dropweapon");

// These are exact engine send-property names, not project-owned public fields.
const g_strAmmoPropertyPrefix = "m_iAmmo.";
const g_strClipProperty = "m_iClip1";
const g_strOwnerProperty = "m_hOwnerEntity";
const g_strPrimaryAmmoTypeProperty = "m_iPrimaryAmmoType";
const g_strSecondaryAmmoTypeProperty = "m_iSecondaryAmmoType";
const g_strSecondaryClipProperty = "m_iClip2";

function GetWeaponIndex(WeaponValue) {
	if (Number.isSafeInteger(WeaponValue) && (WeaponValue >= 0)) {
		return WeaponValue;
	}

	if (WeaponValue && (typeof WeaponValue === "object")) {
		const unWeaponIndex = WeaponValue.Index;
		if (Number.isSafeInteger(unWeaponIndex) && (unWeaponIndex >= 0)) {
			return unWeaponIndex;
		}
	}

	throw new TypeError("Weapon reference must be a non-negative entity index or indexed weapon object.");
}

function IsValidWeapon(Weapon) {
	return Boolean(Weapon && Weapon.IsWeapon && Weapon.Valid && !Weapon.Free);
}

function GetAmmoProperty(unAmmoType) {
	if (!Number.isSafeInteger(unAmmoType) || (unAmmoType < 0)) {
		throw new TypeError("Weapon ammo type must be a non-negative integer.");
	}

	return `${g_strAmmoPropertyPrefix}${String(unAmmoType).padStart(3, "0")}`;
}

function DefineMethod(TargetObject, strMethodName, MethodCallback) {
	if (!TargetObject || (typeof TargetObject !== "object") || (strMethodName in TargetObject)) {
		return;
	}

	Object.defineProperty(TargetObject, strMethodName, { configurable: true, enumerable: false, value: MethodCallback, writable: true });
}

function GetWeaponName(WeaponValue) {
	return g_WeaponsRuntime.GetName(GetWeaponIndex(WeaponValue));
}

function GetOwner(WeaponValue) {
	return DecorateEntity(g_WeaponsRuntime.GetPropertyEntity(GetWeaponIndex(WeaponValue), g_strOwnerProperty));
}

function GetClip(WeaponValue) {
	const nPrimaryClip = g_WeaponsRuntime.GetPropertyInteger(GetWeaponIndex(WeaponValue), g_strClipProperty);
	if (nPrimaryClip < 0) {
		throw new Error("Weapon does not have a primary clip.");
	}

	return nPrimaryClip;
}

function SetClip(WeaponValue, nPrimaryClip) {
	// Validate that the weapon exposes the primary clip property before writing.
	GetClip(WeaponValue);

	return g_WeaponsRuntime.SetPropertyInteger(GetWeaponIndex(WeaponValue), g_strClipProperty, nPrimaryClip);
}

function GetPrimaryAmmoType(WeaponValue) {
	const nPrimaryAmmoType = g_WeaponsRuntime.GetPropertyInteger(GetWeaponIndex(WeaponValue), g_strPrimaryAmmoTypeProperty);
	if (nPrimaryAmmoType < 0) {
		throw new Error(`Unable to get the primary ammo type for ${GetWeaponName(WeaponValue)}.`);
	}

	return nPrimaryAmmoType;
}

function GetSecondaryAmmoType(WeaponValue) {
	const nSecondaryAmmoType = g_WeaponsRuntime.GetPropertyInteger(GetWeaponIndex(WeaponValue), g_strSecondaryAmmoTypeProperty);
	if (nSecondaryAmmoType < 0) {
		throw new Error(`Unable to get the secondary ammo type for ${GetWeaponName(WeaponValue)}.`);
	}

	return nSecondaryAmmoType;
}

function GetAmmo(WeaponValue) {
	return g_WeaponsRuntime.GetAmmo(GetWeaponIndex(WeaponValue));
}

function SetAmmo(WeaponValue, nAmmo) {
	return g_WeaponsRuntime.SetAmmo(GetWeaponIndex(WeaponValue), nAmmo);
}

function GetSecondaryClip(WeaponValue) {
	const nSecondaryClip = g_WeaponsRuntime.GetPropertyInteger(GetWeaponIndex(WeaponValue), g_strSecondaryClipProperty);
	if (nSecondaryClip < 0) {
		throw new Error("Weapon does not have a secondary clip.");
	}

	return nSecondaryClip;
}

function SetSecondaryClip(WeaponValue, nSecondaryClip) {
	// Validate that the weapon exposes the secondary clip property before writing.
	GetSecondaryClip(WeaponValue);

	return g_WeaponsRuntime.SetPropertyInteger(GetWeaponIndex(WeaponValue), g_strSecondaryClipProperty, nSecondaryClip);
}

function GetSecondaryAmmo(WeaponValue) {
	const WeaponOwner = GetOwner(WeaponValue);
	if (!WeaponOwner) {
		throw new Error("Unable to get the weapon owner.");
	}

	return g_WeaponsRuntime.GetPropertyInteger(WeaponOwner.Index, GetAmmoProperty(GetSecondaryAmmoType(WeaponValue)));
}

function SetSecondaryAmmo(WeaponValue, nSecondaryAmmo) {
	const WeaponOwner = GetOwner(WeaponValue);
	if (!WeaponOwner) {
		throw new Error("Unable to get the weapon owner.");
	}

	return g_WeaponsRuntime.SetPropertyInteger(WeaponOwner.Index, GetAmmoProperty(GetSecondaryAmmoType(WeaponValue)), nSecondaryAmmo);
}

function Drop(WeaponValue, DropTarget = null, DropVelocity = null) {
	const WeaponOwner = GetOwner(WeaponValue);
	if (!WeaponOwner || !Number.isSafeInteger(WeaponOwner.Index) || (WeaponOwner.Index <= 0)) {
		return false;
	}

	return g_PlayerWeaponRuntime.DropWeapon(WeaponOwner, WeaponValue, DropTarget, DropVelocity);
}

function Remove(WeaponValue) {
	// Removal remains valid when the weapon has no resolvable player owner.
	Drop(WeaponValue);

	return g_WeaponsRuntime.Remove(GetWeaponIndex(WeaponValue));
}

function DecorateWeapon(Weapon) {
	if (!IsValidWeapon(Weapon)) {
		return Weapon;
	}

	// The entity decorator mutates the same object in place.
	DecorateEntity(Weapon);
	DefineMethod(Weapon, "GetWeaponName", function WeaponGetWeaponName() {
		return GetWeaponName(this);
	});
	DefineMethod(Weapon, "GetOwner", function WeaponGetOwner() {
		return GetOwner(this);
	});
	DefineMethod(Weapon, "GetClip", function WeaponGetClip() {
		return GetClip(this);
	});
	DefineMethod(Weapon, "SetClip", function WeaponSetClip(nPrimaryClip) {
		return SetClip(this, nPrimaryClip);
	});
	DefineMethod(Weapon, "GetPrimaryAmmoType", function WeaponGetPrimaryAmmoType() {
		return GetPrimaryAmmoType(this);
	});
	DefineMethod(Weapon, "GetSecondaryAmmoType", function WeaponGetSecondaryAmmoType() {
		return GetSecondaryAmmoType(this);
	});
	DefineMethod(Weapon, "GetAmmo", function WeaponGetAmmo() {
		return GetAmmo(this);
	});
	DefineMethod(Weapon, "SetAmmo", function WeaponSetAmmo(nAmmo) {
		return SetAmmo(this, nAmmo);
	});
	DefineMethod(Weapon, "GetSecondaryClip", function WeaponGetSecondaryClip() {
		return GetSecondaryClip(this);
	});
	DefineMethod(Weapon, "SetSecondaryClip", function WeaponSetSecondaryClip(nSecondaryClip) {
		return SetSecondaryClip(this, nSecondaryClip);
	});
	DefineMethod(Weapon, "GetSecondaryAmmo", function WeaponGetSecondaryAmmo() {
		return GetSecondaryAmmo(this);
	});
	DefineMethod(Weapon, "SetSecondaryAmmo", function WeaponSetSecondaryAmmo(nSecondaryAmmo) {
		return SetSecondaryAmmo(this, nSecondaryAmmo);
	});
	DefineMethod(Weapon, "Drop", function WeaponDrop(DropTarget = null, DropVelocity = null) {
		return Drop(this, DropTarget, DropVelocity);
	});

	return Weapon;
}

function Weapon(WeaponValue) {
	return DecorateWeapon(g_WeaponsRuntime.GetWeapon(GetWeaponIndex(WeaponValue)));
}

function DecorateWeapons(vecWeapons) {
	const vecDecoratedWeapons = [];
	for (const Weapon of vecWeapons) {
		vecDecoratedWeapons.push(DecorateWeapon(Weapon));
	}

	return vecDecoratedWeapons;
}

function GetAllWeapons() {
	return DecorateWeapons(g_WeaponsRuntime.GetAllWeapons());
}

function GetWeaponsByClassName(strWeaponClassName) {
	return DecorateWeapons(g_WeaponsRuntime.GetWeaponsByClassName(strWeaponClassName));
}

function GetWeaponsByName(strWeaponName) {
	return DecorateWeapons(g_WeaponsRuntime.GetWeaponsByName(strWeaponName));
}

function GetCurrentWeapon(PlayerReference) {
	return DecorateWeapon(g_WeaponsRuntime.GetCurrentWeapon(PlayerReference));
}

const g_WeaponsAPI = {
	AMMO_PROPERTY_PREFIX: g_strAmmoPropertyPrefix,
	CLIP_PROPERTY: g_strClipProperty,
	OWNER_PROPERTY: g_strOwnerProperty,
	PRIMARY_AMMO_TYPE_PROPERTY: g_strPrimaryAmmoTypeProperty,
	SECONDARY_AMMO_TYPE_PROPERTY: g_strSecondaryAmmoTypeProperty,
	SECONDARY_CLIP_PROPERTY: g_strSecondaryClipProperty,
	Weapon,
	GetAllWeapons,
	GetWeaponsByClassName,
	GetWeaponsByName,
	GetClassName: g_WeaponsRuntime.GetClassName,
	GetClasses: g_WeaponsRuntime.GetClasses,
	GetCount: g_WeaponsRuntime.GetCount,
	GetCurrentWeapon,
	DecorateWeapon,
	Drop,
	GetAmmo,
	GetClip,
	GetOwner,
	GetProperty: g_WeaponsRuntime.GetProperty,
	GetPropertyEntity: g_WeaponsRuntime.GetPropertyEntity,
	GetPropertyFloat: g_WeaponsRuntime.GetPropertyFloat,
	GetPropertyInteger: g_WeaponsRuntime.GetPropertyInteger,
	GetPropertyString: g_WeaponsRuntime.GetPropertyString,
	GetPropertyStringArray: g_WeaponsRuntime.GetPropertyStringArray,
	GetPrimaryAmmoType,
	GetSecondaryAmmo,
	GetSecondaryAmmoType,
	GetSecondaryClip,
	GetWeaponName,
	GetName: g_WeaponsRuntime.GetName,
	GetNames: g_WeaponsRuntime.GetNames,
	Remove,
	SetAmmo,
	SetClip,
	SetProperty: g_WeaponsRuntime.SetProperty,
	SetPropertyEntity: g_WeaponsRuntime.SetPropertyEntity,
	SetPropertyFloat: g_WeaponsRuntime.SetPropertyFloat,
	SetPropertyInteger: g_WeaponsRuntime.SetPropertyInteger,
	SetPropertyString: g_WeaponsRuntime.SetPropertyString,
	SetPropertyStringArray: g_WeaponsRuntime.SetPropertyStringArray,
	SetSecondaryAmmo,
	SetSecondaryClip,
};

module.exports = g_WeaponsAPI;
