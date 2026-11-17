"use strict";

const { EntityDictionary } = require("entities/dictionary");
const { GetModule } = require("internal/runtime");
const { Weapon } = require("weapons");

const g_WeaponsDictionaryRuntime = GetModule("weapons/dictionary");

class WeaponDictionary extends EntityDictionary {
	constructor(Factory = Weapon, ...vecFactoryArguments) {
		super(Factory, ...vecFactoryArguments);
	}
}

Object.defineProperty(g_WeaponsDictionaryRuntime, "WeaponDictionary", { configurable: false, enumerable: true, value: WeaponDictionary, writable: false });

module.exports = g_WeaponsDictionaryRuntime;
