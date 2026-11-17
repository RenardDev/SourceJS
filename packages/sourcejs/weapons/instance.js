"use strict";

const { GetConVarInteger } = require("cvars");

class WeaponClass {
	constructor(Record) {
		if (!Record || (typeof Record !== "object") || Array.isArray(Record)) {
			throw new TypeError("WeaponClass requires a weapon data record.");
		}

		this.ValueRecord = Record;
	}

	HasTag(strTag) {
		if (typeof strTag !== "string") {
			throw new TypeError("Weapon tag must be a string.");
		}

		return this.ValueRecord.Tags.includes(strTag);
	}

	get Record() {
		return this.ValueRecord;
	}

	get AmmoProperty() {
		return this.ValueRecord.AmmoProperty;
	}

	get BaseName() {
		return this.ValueRecord.BaseName;
	}

	get ClassName() {
		return this.ValueRecord.ClassName;
	}

	get Clip() {
		return this.ValueRecord.Clip;
	}

	get Cost() {
		return this.ValueRecord.Cost;
	}

	get Data() {
		return this.ValueRecord.Data;
	}

	get ID() {
		return this.ValueRecord.ID;
	}

	get ItemDefinitionIndex() {
		return this.ValueRecord.ItemDefinitionIndex;
	}

	get MaximumAmmo() {
		const MaximumAmmo = this.ValueRecord.MaximumAmmo;
		if (typeof MaximumAmmo === "string") {
			return GetConVarInteger(MaximumAmmo);
		}

		return MaximumAmmo;
	}

	get Name() {
		return this.ValueRecord.Name;
	}

	get ParentClass() {
		return this.ValueRecord.ParentClass;
	}

	get Script() {
		// The public record getter may lazily load a weapon script; preserve that API.
		return this.ValueRecord.Script;
	}

	get SecondaryAmmoProperty() {
		return this.ValueRecord.SecondaryAmmoProperty;
	}

	get SecondaryMaximumAmmo() {
		const SecondaryMaximumAmmo = this.ValueRecord.SecondaryMaximumAmmo;
		if (typeof SecondaryMaximumAmmo === "string") {
			return GetConVarInteger(SecondaryMaximumAmmo);
		}

		return SecondaryMaximumAmmo;
	}

	get Slot() {
		return this.ValueRecord.Slot;
	}

	get Tags() {
		return this.ValueRecord.Tags;
	}

	get Type() {
		return this.ValueRecord.Type;
	}
}

const g_WeaponInstanceAPI = { WeaponClass };

module.exports = g_WeaponInstanceAPI;
