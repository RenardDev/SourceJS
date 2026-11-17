"use strict";

const { GetModule } = require("internal/runtime");
const { DecorateWeapon } = require("weapons");

const g_WeaponEntityRuntime = GetModule("weapons/entity");

function Weapon(WeaponReference) {
	return DecorateWeapon(g_WeaponEntityRuntime.GetWeapon(WeaponReference));
}

const g_WeaponEntityExports = {
	Weapon,
	GetAmmo: g_WeaponEntityRuntime.GetAmmo,
	GetProperty: g_WeaponEntityRuntime.GetProperty,
	GetPropertyEntity: g_WeaponEntityRuntime.GetPropertyEntity,
	GetPropertyFloat: g_WeaponEntityRuntime.GetPropertyFloat,
	GetPropertyInteger: g_WeaponEntityRuntime.GetPropertyInteger,
	GetPropertyString: g_WeaponEntityRuntime.GetPropertyString,
	GetPropertyStringArray: g_WeaponEntityRuntime.GetPropertyStringArray,
	SetAmmo: g_WeaponEntityRuntime.SetAmmo,
	SetProperty: g_WeaponEntityRuntime.SetProperty,
	SetPropertyEntity: g_WeaponEntityRuntime.SetPropertyEntity,
	SetPropertyFloat: g_WeaponEntityRuntime.SetPropertyFloat,
	SetPropertyInteger: g_WeaponEntityRuntime.SetPropertyInteger,
	SetPropertyString: g_WeaponEntityRuntime.SetPropertyString,
	SetPropertyStringArray: g_WeaponEntityRuntime.SetPropertyStringArray,
};

module.exports = g_WeaponEntityExports;
