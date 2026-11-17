"use strict";

const { GetModule } = require("internal/runtime");

const g_CollisionsRuntime = GetModule("entities/collisions");
const g_NativeGetCollisionGroup = g_CollisionsRuntime.GetCollisionGroup;
const g_NativeGetMaximums = g_CollisionsRuntime.GetMaximumBounds;
const g_NativeGetMinimums = g_CollisionsRuntime.GetMinimumBounds;
const g_NativeGetSolidFlags = g_CollisionsRuntime.GetSolidFlags;
const g_NativeGetSolidType = g_CollisionsRuntime.GetSolidType;
const g_NativeSetCollisionGroup = g_CollisionsRuntime.SetCollisionGroup;
const g_NativeSetMaximums = g_CollisionsRuntime.SetMaximumBounds;
const g_NativeSetMinimums = g_CollisionsRuntime.SetMinimumBounds;
const g_NativeSetSolidFlags = g_CollisionsRuntime.SetSolidFlags;
const g_NativeSetSolidType = g_CollisionsRuntime.SetSolidType;

const g_unMaximumNativeSolidFlags = 0xFFFF;

function DecorateConstantGroup(Constants) {
	for (const strNativeName of Object.keys(Constants)) {
		const strLegacyGeneratedName = strNativeName.replace(/([A-Z])/g, "_$1").replace(/^_/, "").toUpperCase();
		const strCanonicalGeneratedName = strNativeName.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2").toUpperCase();
		const strLegacyPublicName = (strLegacyGeneratedName === "V_PHYSICS") ? "VPHYSICS" : strLegacyGeneratedName;
		const strCanonicalPublicName = (strCanonicalGeneratedName === "V_PHYSICS") ? "VPHYSICS" : strCanonicalGeneratedName;
		const vecPublicNames = Array.from(new Set([strLegacyPublicName, strCanonicalPublicName]));
		for (const strPublicName of vecPublicNames) {
			if (!Object.hasOwn(Constants, strPublicName)) {
				Object.defineProperty(Constants, strPublicName, { configurable: true, value: Constants[strNativeName], writable: true });
			}
		}
	}

	return Constants;
}

const g_CollisionGroup = DecorateConstantGroup(g_CollisionsRuntime.GetCollisionGroupConstants());
const g_SolidFlags = DecorateConstantGroup(g_CollisionsRuntime.GetSolidFlagConstants());
const g_SolidType = DecorateConstantGroup(g_CollisionsRuntime.GetSolidTypeConstants());

function RequireSolidFlags(nSolidFlags) {
	if (!Number.isInteger(nSolidFlags)) {
		throw new TypeError("nSolidFlags must be an integer.");
	}

	return nSolidFlags;
}

function GetRequiredEntitySolidFlags(EntityReference) {
	const unSolidFlags = g_NativeGetSolidFlags(EntityReference);
	if (!Number.isInteger(unSolidFlags) || (unSolidFlags < 0) || (unSolidFlags > g_unMaximumNativeSolidFlags)) {
		throw new TypeError("The native solid-flags getter must return an unsigned 16-bit integer.");
	}

	return unSolidFlags;
}

function AddEntitySolidFlags(EntityReference, nSolidFlags) {
	const nRequiredSolidFlags = RequireSolidFlags(nSolidFlags);
	const unCurrentSolidFlags = GetRequiredEntitySolidFlags(EntityReference);
	const nUpdatedSolidFlags = unCurrentSolidFlags | nRequiredSolidFlags;

	return g_NativeSetSolidFlags(EntityReference, nUpdatedSolidFlags);
}

function RemoveEntitySolidFlags(EntityReference, nSolidFlags) {
	const nRequiredSolidFlags = RequireSolidFlags(nSolidFlags);
	const unCurrentSolidFlags = GetRequiredEntitySolidFlags(EntityReference);
	const nUpdatedSolidFlags = unCurrentSolidFlags & ~nRequiredSolidFlags;

	return g_NativeSetSolidFlags(EntityReference, nUpdatedSolidFlags);
}

function HasEntitySolidFlags(EntityReference, nSolidFlags) {
	const nRequiredSolidFlags = RequireSolidFlags(nSolidFlags);
	const unCurrentSolidFlags = GetRequiredEntitySolidFlags(EntityReference);

	return (unCurrentSolidFlags & nRequiredSolidFlags) === nRequiredSolidFlags;
}

function IsEntityCollisionEnabled(EntityReference) {
	return !HasEntitySolidFlags(EntityReference, g_SolidFlags.NOT_SOLID);
}

function SetEntityCollisionEnabled(EntityReference, bCollisionEnabled) {
	if (typeof bCollisionEnabled !== "boolean") {
		throw new TypeError("bCollisionEnabled must be a boolean.");
	}

	return bCollisionEnabled ? RemoveEntitySolidFlags(EntityReference, g_SolidFlags.NOT_SOLID) : AddEntitySolidFlags(EntityReference, g_SolidFlags.NOT_SOLID);
}

function GetEntityCollisionBounds(EntityReference) {
	return { Maximums: g_NativeGetMaximums(EntityReference), Minimums: g_NativeGetMinimums(EntityReference) };
}

function SetEntityCollisionBounds(EntityReference, MinimumBounds, MaximumBounds) {
	const bMinimumResult = g_NativeSetMinimums(EntityReference, MinimumBounds);
	const bMaximumResult = g_NativeSetMaximums(EntityReference, MaximumBounds);

	return bMinimumResult && bMaximumResult;
}

class CollisionRules {
	constructor(EntityReference) {
		this.Entity = EntityReference;
	}

	AddSolidFlags(nSolidFlags) {
		return AddEntitySolidFlags(this.Entity, nSolidFlags);
	}

	RemoveSolidFlags(nSolidFlags) {
		return RemoveEntitySolidFlags(this.Entity, nSolidFlags);
	}

	HasSolidFlags(nSolidFlags) {
		return HasEntitySolidFlags(this.Entity, nSolidFlags);
	}

	GetEntityCollisionBounds() {
		return GetEntityCollisionBounds(this.Entity);
	}

	SetEntityCollisionBounds(MinimumBounds, MaximumBounds) {
		return SetEntityCollisionBounds(this.Entity, MinimumBounds, MaximumBounds);
	}

	get CollisionGroup() {
		return g_NativeGetCollisionGroup(this.Entity);
	}

	set CollisionGroup(nCollisionGroup) {
		g_NativeSetCollisionGroup(this.Entity, nCollisionGroup);
	}

	get SolidType() {
		return g_NativeGetSolidType(this.Entity);
	}

	set SolidType(unSolidType) {
		g_NativeSetSolidType(this.Entity, unSolidType);
	}

	get SolidFlags() {
		return g_NativeGetSolidFlags(this.Entity);
	}

	set SolidFlags(unSolidFlags) {
		g_NativeSetSolidFlags(this.Entity, unSolidFlags);
	}

	get CollisionEnabled() {
		return IsEntityCollisionEnabled(this.Entity);
	}

	set CollisionEnabled(bCollisionEnabled) {
		SetEntityCollisionEnabled(this.Entity, bCollisionEnabled);
	}
}

function GetEntityCollisionGroup(EntityReference) {
	return g_NativeGetCollisionGroup(EntityReference);
}

function GetEntityCollisionMaximums(EntityReference) {
	return GetEntityCollisionBounds(EntityReference).Maximums;
}

function GetEntityCollisionMinimums(EntityReference) {
	return GetEntityCollisionBounds(EntityReference).Minimums;
}

function GetEntitySolidFlags(EntityReference) {
	return g_NativeGetSolidFlags(EntityReference);
}

function GetEntitySolidType(EntityReference) {
	return g_NativeGetSolidType(EntityReference);
}

function GetSolidFlagConstants() {
	return g_SolidFlags;
}

function GetSolidTypeConstants() {
	return g_SolidType;
}

function SetEntityCollisionGroup(EntityReference, nCollisionGroup) {
	return g_NativeSetCollisionGroup(EntityReference, nCollisionGroup);
}

function SetEntityCollisionMaximums(EntityReference, MaximumBounds) {
	const MinimumBounds = GetEntityCollisionMinimums(EntityReference);
	const vecMinimumBounds = [MinimumBounds.X, MinimumBounds.Y, MinimumBounds.Z];

	return SetEntityCollisionBounds(EntityReference, vecMinimumBounds, MaximumBounds);
}

function SetEntityCollisionMinimums(EntityReference, MinimumBounds) {
	const MaximumBounds = GetEntityCollisionMaximums(EntityReference);
	const vecMaximumBounds = [MaximumBounds.X, MaximumBounds.Y, MaximumBounds.Z];

	return SetEntityCollisionBounds(EntityReference, MinimumBounds, vecMaximumBounds);
}

function SetEntitySolidFlags(EntityReference, unSolidFlags) {
	return g_NativeSetSolidFlags(EntityReference, unSolidFlags);
}

function SetEntitySolidType(EntityReference, unSolidType) {
	return g_NativeSetSolidType(EntityReference, unSolidType);
}

Object.assign(g_CollisionsRuntime, {
	AddEntitySolidFlags,
	CollisionGroup: g_CollisionGroup,
	CollisionRules,
	GetCollisionGroupConstants: function GetCollisionGroupConstants() {
		return g_CollisionGroup;
	},
	GetEntityCollisionBounds,
	GetEntityCollisionGroup,
	GetEntityCollisionMaximums,
	GetEntityCollisionMinimums,
	GetEntitySolidFlags,
	GetEntitySolidType,
	GetSolidFlagConstants,
	GetSolidTypeConstants,
	HasEntitySolidFlags,
	IsEntityCollisionEnabled,
	RemoveEntitySolidFlags,
	SetEntityCollisionBounds,
	SetEntityCollisionEnabled,
	SetEntityCollisionGroup,
	SetEntityCollisionMaximums,
	SetEntityCollisionMinimums,
	SetEntitySolidFlags,
	SetEntitySolidType,
	SolidFlags: g_SolidFlags,
	SolidType: g_SolidType,
});

for (const strNativeName of [
	"GetCollisionGroup",
	"GetMaximumBounds",
	"GetMinimumBounds",
	"GetSolidFlags",
	"GetSolidType",
	"SetCollisionGroup",
	"SetMaximumBounds",
	"SetMinimumBounds",
	"SetSolidFlags",
	"SetSolidType",
]) {
	delete g_CollisionsRuntime[strNativeName];
}

module.exports = g_CollisionsRuntime;
