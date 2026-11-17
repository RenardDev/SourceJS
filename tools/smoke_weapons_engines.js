#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "weapons-engines.md");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strInternalRuntimePath = g_Path.join(g_strPackageRootPath, "internal", "runtime.js");
const g_strEnginesPath = g_Path.join(g_strPackageRootPath, "weapons", "engines.js");
const g_strModuleBindingsPath = g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "modules", "ModuleBindings.cpp");
const g_strCustomNameProperty = "m_AttributeManager.m_Item.m_szCustomName";
const g_strWeaponClassPrefix = "weapon_";
const g_unDocumentationTimeoutMilliseconds = 1000;
const g_vecCanonicalPropertyTypes = [
	"bool",
	"char",
	"uchar",
	"short",
	"ushort",
	"int",
	"uint",
	"long",
	"ulong",
	"longlong",
	"ulonglong",
	"float",
	"double",
	"stringaddress",
	"stringarray",
	"address",
	"vector",
	"vectorxy",
	"entity",
];

// Native SDK selector keys stay exact; returned vector values use project X/Y/Z fields.
const g_mapWeaponState = new Map([
	[10, {
		Ammo: 90,
		ClassName: "weapon_rifle",
		Properties: {
			[g_strCustomNameProperty]: "Primary",
			m_flNextPrimaryAttack: 1.25,
			m_hOwnerEntity: 1,
			m_iClip1: 30,
			m_vecOffset: { X: 1, Y: 2, Z: 3 },
		},
	}],
]);
const g_strInitialWeaponState = JSON.stringify(Array.from(g_mapWeaponState));

let g_unNativeOperationCount = 0;

function GetEntityIndex(EntityReference) {
	let IndexValue = EntityReference;
	if ((EntityReference !== null) && (typeof EntityReference === "object")) {
		IndexValue = EntityReference.Index;
	}

	if (!Number.isSafeInteger(IndexValue) || (IndexValue < 0)) {
		throw new TypeError("entity index must be a non-negative safe integer");
	}

	return IndexValue;
}

function CreateWeapon(unWeaponIndex) {
	const CurrentWeaponState = g_mapWeaponState.get(unWeaponIndex);
	if (CurrentWeaponState === undefined) {
		return null;
	}

	return { Index: unWeaponIndex };
}

function RequireWeaponState(WeaponReference) {
	const unWeaponIndex = GetEntityIndex(WeaponReference);
	const CurrentWeaponState = g_mapWeaponState.get(unWeaponIndex);
	if (CurrentWeaponState === undefined) {
		throw new Error(`weapon not found: ${unWeaponIndex}`);
	}

	return CurrentWeaponState;
}

function ReadWeaponProperty(WeaponReference, strPropertyName) {
	const WeaponProperties = RequireWeaponState(WeaponReference).Properties;
	if ((typeof strPropertyName !== "string") || !Object.hasOwn(WeaponProperties, strPropertyName)) {
		throw new Error(`weapon property not found: ${String(strPropertyName)}`);
	}

	return WeaponProperties[strPropertyName];
}

function WriteWeaponProperty(WeaponReference, strPropertyName, PropertyValue) {
	ReadWeaponProperty(WeaponReference, strPropertyName);
	RequireWeaponState(WeaponReference).Properties[strPropertyName] = PropertyValue;

	return true;
}

function GetWeaponShortName(strWeaponClassName) {
	return strWeaponClassName.startsWith(g_strWeaponClassPrefix) ? strWeaponClassName.slice(g_strWeaponClassPrefix.length) : strWeaponClassName;
}

const g_NativeWeaponEngines = {
	GetAllWeapons() {
		g_unNativeOperationCount += 1;

		const vecCurrentWeapons = [];
		for (const unWeaponIndex of g_mapWeaponState.keys()) {
			vecCurrentWeapons.push(CreateWeapon(unWeaponIndex));
		}

		return vecCurrentWeapons;
	},

	BRANCH: "l4d2",

	GetWeaponsByClassName(strWeaponClassName) {
		g_unNativeOperationCount += 1;

		const vecMatchingWeapons = [];
		for (const [unWeaponIndex, CurrentWeaponState] of g_mapWeaponState) {
			if (CurrentWeaponState.ClassName === strWeaponClassName) {
				vecMatchingWeapons.push(CreateWeapon(unWeaponIndex));
			}
		}

		return vecMatchingWeapons;
	},

	GetWeaponsByName(strWeaponName) {
		g_unNativeOperationCount += 1;

		const vecMatchingWeapons = [];
		const strNormalizedWeaponName = GetWeaponShortName(strWeaponName);
		for (const [unWeaponIndex, CurrentWeaponState] of g_mapWeaponState) {
			if (GetWeaponShortName(CurrentWeaponState.ClassName) === strNormalizedWeaponName) {
				vecMatchingWeapons.push(CreateWeapon(unWeaponIndex));
			}
		}

		return vecMatchingWeapons;
	},

	GetClassName(WeaponReference) {
		g_unNativeOperationCount += 1;

		const CurrentWeaponState = g_mapWeaponState.get(GetEntityIndex(WeaponReference));
		if (CurrentWeaponState === undefined) {
			return "";
		}

		return CurrentWeaponState.ClassName;
	},

	GetCurrentWeapon(PlayerReference) {
		g_unNativeOperationCount += 1;

		if (GetEntityIndex(PlayerReference) !== 1) {
			return null;
		}

		return CreateWeapon(10);
	},

	GetAmmo(WeaponReference) {
		g_unNativeOperationCount += 1;

		return RequireWeaponState(WeaponReference).Ammo;
	},

	GetProperty(WeaponReference, strPropertyName) {
		g_unNativeOperationCount += 1;

		return ReadWeaponProperty(WeaponReference, strPropertyName);
	},

	GetPropertyEntity(WeaponReference, strPropertyName) {
		g_unNativeOperationCount += 1;

		const EntityIndexValue = ReadWeaponProperty(WeaponReference, strPropertyName);
		if (!Number.isSafeInteger(EntityIndexValue) || (EntityIndexValue < 0)) {
			return null;
		}

		return { Index: EntityIndexValue };
	},

	GetPropertyFloat(WeaponReference, strPropertyName) {
		g_unNativeOperationCount += 1;

		return ReadWeaponProperty(WeaponReference, strPropertyName);
	},

	GetPropertyInteger(WeaponReference, strPropertyName) {
		g_unNativeOperationCount += 1;

		return ReadWeaponProperty(WeaponReference, strPropertyName);
	},

	GetPropertyString(WeaponReference, strPropertyName) {
		g_unNativeOperationCount += 1;

		return ReadWeaponProperty(WeaponReference, strPropertyName);
	},

	GetPropertyStringArray(WeaponReference, strPropertyName) {
		g_unNativeOperationCount += 1;

		return ReadWeaponProperty(WeaponReference, strPropertyName);
	},

	GetName(WeaponReference) {
		g_unNativeOperationCount += 1;

		const CurrentWeaponState = g_mapWeaponState.get(GetEntityIndex(WeaponReference));
		if (CurrentWeaponState === undefined) {
			return "";
		}

		return GetWeaponShortName(CurrentWeaponState.ClassName);
	},

	Remove(WeaponReference) {
		g_unNativeOperationCount += 1;

		return g_mapWeaponState.delete(GetEntityIndex(WeaponReference));
	},

	SetAmmo(WeaponReference, nAmmoCount) {
		g_unNativeOperationCount += 1;

		if (!Number.isSafeInteger(nAmmoCount)) {
			throw new TypeError("ammo must be an integer");
		}

		RequireWeaponState(WeaponReference).Ammo = nAmmoCount;

		return true;
	},

	SetProperty(WeaponReference, strPropertyName, PropertyValue) {
		g_unNativeOperationCount += 1;

		return WriteWeaponProperty(WeaponReference, strPropertyName, PropertyValue);
	},

	SetPropertyEntity(WeaponReference, strPropertyName, EntityReference) {
		g_unNativeOperationCount += 1;

		return WriteWeaponProperty(WeaponReference, strPropertyName, GetEntityIndex(EntityReference));
	},

	SetPropertyFloat(WeaponReference, strPropertyName, flPropertyValue) {
		g_unNativeOperationCount += 1;

		if ((typeof flPropertyValue !== "number") || !Number.isFinite(flPropertyValue)) {
			throw new TypeError("property value must be finite");
		}

		return WriteWeaponProperty(WeaponReference, strPropertyName, flPropertyValue);
	},

	SetPropertyInteger(WeaponReference, strPropertyName, nPropertyValue) {
		g_unNativeOperationCount += 1;

		if (!Number.isSafeInteger(nPropertyValue)) {
			throw new TypeError("property value must be an integer");
		}

		return WriteWeaponProperty(WeaponReference, strPropertyName, nPropertyValue);
	},

	SetPropertyString(WeaponReference, strPropertyName, strPropertyValue) {
		g_unNativeOperationCount += 1;

		if (typeof strPropertyValue !== "string") {
			throw new TypeError("property value must be a string");
		}

		return WriteWeaponProperty(WeaponReference, strPropertyName, strPropertyValue);
	},

	SetPropertyStringArray(WeaponReference, strPropertyName, strPropertyValue) {
		g_unNativeOperationCount += 1;

		if (typeof strPropertyValue !== "string") {
			throw new TypeError("property value must be a string");
		}

		return WriteWeaponProperty(WeaponReference, strPropertyName, strPropertyValue);
	},

	GetWeapon(WeaponReference) {
		g_unNativeOperationCount += 1;

		return CreateWeapon(GetEntityIndex(WeaponReference));
	},
};

function RunDocumentationBlock(strDocumentationCode, unDocumentationBlockIndex, WeaponsEnginesAPI) {
	function RequireDocumentationModule(strIdentifier) {
		if (strIdentifier === "weapons/engines") {
			return WeaponsEnginesAPI;
		}

		throw new Error(`Unexpected documentation import: ${strIdentifier}`);
	}

	const Context = g_VM.createContext({ require: RequireDocumentationModule });
	const unNativeOperationCountBefore = g_unNativeOperationCount;

	g_VM.runInContext(strDocumentationCode, Context, { filename: `${g_strDocumentationPath}#example-${unDocumentationBlockIndex + 1}`, timeout: g_unDocumentationTimeoutMilliseconds });

	g_Assert.equal(g_unNativeOperationCount, unNativeOperationCountBefore, `documentation block ${unDocumentationBlockIndex + 1} avoids native work`);

	return Context;
}

function LoadTestAPI() {
	const SourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
	const ResolverDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_resolveFilename");
	const OriginalResolveFilename = ResolverDescriptor?.value;
	const mapCachedModules = new Map();
	for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
		if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
			mapCachedModules.set(strModulePath, Object.getOwnPropertyDescriptor(require.cache, strModulePath));
		}
	}

	g_Assert.ok(SourceJSDescriptor || Object.isExtensible(globalThis), "Weapons/engines runtime fixture must support installation.");
	g_Assert.ok(Object.isExtensible(require.cache), "Weapons/engines package cache must support exact restoration.");
	g_Assert.ok(!SourceJSDescriptor || SourceJSDescriptor.configurable, "Weapons/engines runtime fixture must support exact restoration.");
	g_Assert.ok(ResolverDescriptor && ResolverDescriptor.configurable && (typeof OriginalResolveFilename === "function"), "Weapons/engines resolver must support exact restoration.");

	for (const Descriptor of mapCachedModules.values()) {
		g_Assert.equal(Descriptor.configurable, true, "Borrowed weapons/engines cache entries must support exact restoration.");
	}

	const RestoreProperty = (Target, strKey, Descriptor) => {
		if (Descriptor) {
			Object.defineProperty(Target, strKey, Descriptor);
			return;
		}

		g_Assert.ok(Reflect.deleteProperty(Target, strKey), "Owned weapons/engines fixture property must be removable: " + strKey);
	};

	let bSourceJSOwned = false;
	let bResolverOwned = false;
	let bCacheOwned = false;
	let bFailed = false;
	let Failure = undefined;
	let Result = undefined;

	try {
		bCacheOwned = true;

		for (const strModulePath of mapCachedModules.keys()) {
			RestoreProperty(require.cache, strModulePath, undefined);
		}

		Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: true, writable: true, value: { "weapons/engines": g_NativeWeaponEngines } });
		bSourceJSOwned = true;

		Object.defineProperty(g_Module, "_resolveFilename", {
			...ResolverDescriptor,
			writable: true,
			value: function ResolveFilename(strRequest, Parent, bIsMain, Options) {
				if (strRequest === "internal/runtime") {
					return g_strInternalRuntimePath;
				}

				return OriginalResolveFilename.call(this, strRequest, Parent, bIsMain, Options);
			},
		});
		bResolverOwned = true;

		Result = require(g_strEnginesPath);
	} catch (ExceptionValue) {
		Failure = ExceptionValue;
		bFailed = true;
	} finally {
		const vecFailures = [];
		const AttemptRestoration = Restore => {
			try {
				Restore();
			} catch (ExceptionValue) {
				vecFailures.push(ExceptionValue);
			}
		};

		if (bResolverOwned) {
			AttemptRestoration(() => RestoreProperty(g_Module, "_resolveFilename", ResolverDescriptor));
		}

		if (bCacheOwned) {
			for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
				if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
					AttemptRestoration(() => RestoreProperty(require.cache, strModulePath, undefined));
				}
			}

			for (const [strModulePath, Descriptor] of mapCachedModules) {
				AttemptRestoration(() => RestoreProperty(require.cache, strModulePath, Descriptor));
			}
		}

		if (bSourceJSOwned) {
			AttemptRestoration(() => RestoreProperty(globalThis, "sourcejs", SourceJSDescriptor));
		}

		if (vecFailures.length > 0) {
			if (bFailed) {
				vecFailures.unshift(Failure);
			}

			throw new AggregateError(vecFailures, "Weapons/engines fixture restoration failed.");
		}
	}

	if (bFailed) {
		throw Failure;
	}

	return Result;
}

const g_WeaponsEnginesAPI = LoadTestAPI();
g_Assert.equal(g_WeaponsEnginesAPI, g_NativeWeaponEngines, "weapons/engines exposes the exact native object");
g_Assert.deepEqual(Object.keys(g_WeaponsEnginesAPI).sort(), [
	"BRANCH",
	"GetAllWeapons",
	"GetAmmo",
	"GetClassName",
	"GetCurrentWeapon",
	"GetName",
	"GetProperty",
	"GetPropertyEntity",
	"GetPropertyFloat",
	"GetPropertyInteger",
	"GetPropertyString",
	"GetPropertyStringArray",
	"GetWeapon",
	"GetWeaponsByClassName",
	"GetWeaponsByName",
	"Remove",
	"SetAmmo",
	"SetProperty",
	"SetPropertyEntity",
	"SetPropertyFloat",
	"SetPropertyInteger",
	"SetPropertyString",
	"SetPropertyStringArray",
], "exact weapons/engines exports");
g_Assert.equal(g_WeaponsEnginesAPI.BRANCH, "l4d2", "SDK branch");
g_Assert.equal(g_WeaponsEnginesAPI.GetWeapon(10).Index, 10, "native weapon factory");
g_Assert.equal(g_WeaponsEnginesAPI.GetWeapon(99), null, "missing native weapon");
g_Assert.equal(g_WeaponsEnginesAPI.GetWeaponsByClassName("weapon_rifle")[0].Index, 10, "native class lookup");
g_Assert.equal(g_WeaponsEnginesAPI.GetWeaponsByName("rifle")[0].Index, 10, "native name lookup");
g_Assert.equal(g_WeaponsEnginesAPI.GetClassName(10), "weapon_rifle", "native class name");
g_Assert.equal(g_WeaponsEnginesAPI.GetName(10), "rifle", "native weapon name");
g_Assert.equal(g_WeaponsEnginesAPI.GetCurrentWeapon({ Index: 1 }).Index, 10, "native current weapon");
g_Assert.equal(g_WeaponsEnginesAPI.GetCurrentWeapon({ Index: 2 }), null, "missing active weapon");

const g_RifleWeapon = g_WeaponsEnginesAPI.GetWeapon(10);

{
	const OriginalWeaponState = g_mapWeaponState.get(10);
	const nOriginalAmmoCount = g_WeaponsEnginesAPI.GetAmmo(g_RifleWeapon);
	const OriginalWeaponProperties = { ...OriginalWeaponState.Properties };
	const strOriginalWeaponProperties = JSON.stringify(OriginalWeaponState.Properties);
	try {
		g_Assert.equal(g_WeaponsEnginesAPI.SetAmmo(g_RifleWeapon, nOriginalAmmoCount + 1), true, "direct ammo mutation succeeds");
		g_Assert.equal(g_WeaponsEnginesAPI.GetAmmo(g_RifleWeapon), nOriginalAmmoCount + 1, "ammo mutation");
		g_Assert.equal(g_WeaponsEnginesAPI.SetAmmo(g_RifleWeapon, nOriginalAmmoCount), true, "direct ammo restoration succeeds");
		g_Assert.equal(g_WeaponsEnginesAPI.GetProperty(g_RifleWeapon, "m_iClip1", "int"), 30, "generic property read");
		g_Assert.equal(g_WeaponsEnginesAPI.SetProperty(g_RifleWeapon, "m_iClip1", 31, "int"), true, "direct generic property mutation succeeds");
		g_Assert.equal(g_WeaponsEnginesAPI.GetPropertyInteger(g_RifleWeapon, "m_iClip1"), 31, "integer property read");
		g_Assert.equal(g_WeaponsEnginesAPI.SetPropertyInteger(g_RifleWeapon, "m_iClip1", 30), true, "direct integer property restoration succeeds");
		g_Assert.equal(g_WeaponsEnginesAPI.GetPropertyFloat(g_RifleWeapon, "m_flNextPrimaryAttack"), 1.25, "float property read");
		g_Assert.equal(g_WeaponsEnginesAPI.SetPropertyFloat(g_RifleWeapon, "m_flNextPrimaryAttack", 1.5), true, "direct float property mutation succeeds");
		g_Assert.equal(g_WeaponsEnginesAPI.GetPropertyFloat(g_RifleWeapon, "m_flNextPrimaryAttack"), 1.5, "float property mutation");
		g_Assert.equal(g_WeaponsEnginesAPI.SetPropertyFloat(g_RifleWeapon, "m_flNextPrimaryAttack", 1.25), true, "direct float property restoration succeeds");
		g_Assert.equal(g_WeaponsEnginesAPI.GetPropertyEntity(g_RifleWeapon, "m_hOwnerEntity").Index, 1, "entity property read");
		g_Assert.equal(g_WeaponsEnginesAPI.SetPropertyEntity(g_RifleWeapon, "m_hOwnerEntity", { Index: 1 }), true, "direct entity property mutation succeeds");
		g_Assert.throws(function SetNullEntityProperty() {
			g_WeaponsEnginesAPI.SetPropertyEntity(g_RifleWeapon, "m_hOwnerEntity", null);
		}, /non-negative safe integer/, "entity property rejects null");
		g_Assert.equal(g_WeaponsEnginesAPI.GetPropertyString(g_RifleWeapon, g_strCustomNameProperty), "Primary", "string property read");
		g_Assert.equal(g_WeaponsEnginesAPI.SetPropertyString(g_RifleWeapon, g_strCustomNameProperty, "Changed"), true, "direct string property mutation succeeds");
		g_Assert.equal(g_WeaponsEnginesAPI.GetPropertyStringArray(g_RifleWeapon, g_strCustomNameProperty), "Changed", "string-array property read");
		g_Assert.equal(g_WeaponsEnginesAPI.SetPropertyStringArray(g_RifleWeapon, g_strCustomNameProperty, "Primary"), true, "direct string-array property restoration succeeds");
		g_Assert.equal(JSON.stringify(g_mapWeaponState.get(10).Properties), strOriginalWeaponProperties, "direct property tests restore state");
	} finally {
		OriginalWeaponState.Ammo = nOriginalAmmoCount;
		Object.assign(OriginalWeaponState.Properties, OriginalWeaponProperties);
	}
}

for (const strForbiddenExport of ["Weapon", "byIndex", "available", "csgo", "moduleName", "runtime", "default", "names", "classes", "count"]) {
	g_Assert.equal(Object.hasOwn(g_WeaponsEnginesAPI, strForbiddenExport), false, `forbidden export is absent: ${strForbiddenExport}`);
}

const g_strDocumentationSource = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
g_Assert.match(g_strDocumentationSource, /shared entity-property callbacks do not enforce a weapon class/, "documentation states the shared entity-property boundary");
g_Assert.match(g_strDocumentationSource, /`longlong`, `ulonglong` \| `bigint` \| In-range `bigint` only\./, "64-bit integer writes require bigint");
g_Assert.match(g_strDocumentationSource, /`bigint` only for 64-bit storage/, "native long write type follows the actual storage width");
g_Assert.match(g_strDocumentationSource, /Returning a promise does not delay restoration/, "temporary state does not wait for a promise callback");
g_Assert.match(g_strDocumentationSource, /it does not deep-clone arbitrary objects/, "the generic property copy is limited to vector components");
g_Assert.match(g_strDocumentationSource, /integer\s+restoration even if the first attempt throws/, "two-property cleanup attempts both restorations");
g_Assert.match(g_strDocumentationSource, /otherwise it falls back to 256 bytes/, "fixed-array writes document the current native fallback capacity");
g_Assert.match(g_strDocumentationSource, /do not bound the read by reflected capacity/, "string readers do not claim bounded reflection reads");
g_Assert.match(g_strDocumentationSource, /byte truncation can split a UTF-8 sequence/, "byte capacity is not a JavaScript character count");

const g_DocumentationCodeBlockPattern = /```js\r?\n([\s\S]*?)```/g;
const g_vecDocumentationCodeBlocks = [];
let g_vecDocumentationCodeBlockMatch = g_DocumentationCodeBlockPattern.exec(g_strDocumentationSource);
while (g_vecDocumentationCodeBlockMatch !== null) {
	g_vecDocumentationCodeBlocks.push(g_vecDocumentationCodeBlockMatch[1]);
	g_vecDocumentationCodeBlockMatch = g_DocumentationCodeBlockPattern.exec(g_strDocumentationSource);
}

g_Assert.equal(g_vecDocumentationCodeBlocks.length, 9, "all weapons/engines documentation JavaScript blocks are present");

const g_vecDocumentationContexts = [];
for (let unDocumentationBlockIndex = 0; unDocumentationBlockIndex < g_vecDocumentationCodeBlocks.length; unDocumentationBlockIndex += 1) {
	const strDocumentationCode = g_vecDocumentationCodeBlocks[unDocumentationBlockIndex];
	g_vecDocumentationContexts.push(RunDocumentationBlock(strDocumentationCode, unDocumentationBlockIndex, g_WeaponsEnginesAPI));
}

const g_WeaponInventory = g_vecDocumentationContexts[1].InspectWeaponInventory(10, "weapon_rifle", "rifle");
const g_vecCurrentInventoryEntries = [];
for (const CurrentInventoryWeapon of g_WeaponInventory.WeaponInventory) {
	g_vecCurrentInventoryEntries.push({ ClassName: CurrentInventoryWeapon.ClassName, Index: CurrentInventoryWeapon.Index, Name: CurrentInventoryWeapon.Name });
}

const g_SelectedWeaponDetails = { ClassName: g_WeaponInventory.SelectedWeaponDetails.ClassName, Index: g_WeaponInventory.SelectedWeaponDetails.Index, Name: g_WeaponInventory.SelectedWeaponDetails.Name };

g_Assert.equal(g_WeaponInventory.Branch, "l4d2", "inventory workflow returns the selected SDK branch");
g_Assert.deepEqual(Array.from(g_WeaponInventory.ClassMatchIndexes), [10], "inventory workflow performs exact class lookup");
g_Assert.deepEqual(Array.from(g_WeaponInventory.NameMatchIndexes), [10], "inventory workflow performs short-name lookup");
g_Assert.deepEqual(g_vecCurrentInventoryEntries, [{ ClassName: "weapon_rifle", Index: 10, Name: "rifle" }], "inventory workflow reports current weapon identity");
g_Assert.deepEqual(g_SelectedWeaponDetails, { ClassName: "weapon_rifle", Index: 10, Name: "rifle" }, "inventory workflow resolves a caller-selected weapon");

const g_ActiveWeapon = g_vecDocumentationContexts[2].InspectActiveWeapon({ Index: 1 });
g_Assert.equal(g_ActiveWeapon.Index, 10, "active-weapon workflow resolves the current index");
g_Assert.equal(g_ActiveWeapon.Name, "rifle", "active-weapon workflow resolves the current name");
g_Assert.equal(g_ActiveWeapon.Weapon.Index, 10, "active-weapon workflow retains the live native object");
g_Assert.equal(g_vecDocumentationContexts[2].InspectActiveWeapon({ Index: 2 }), null, "active-weapon workflow preserves no active weapon");

const g_nTemporaryAmmoResult = g_vecDocumentationContexts[3].WithTemporaryWeaponAmmo(g_RifleWeapon, 91, function ReadTemporaryAmmo(nAmmoCount) {
	return nAmmoCount;
});
g_Assert.equal(g_nTemporaryAmmoResult, 91, "ammo workflow exposes the temporary reserve value");
g_Assert.equal(g_mapWeaponState.get(10).Ammo, 90, "ammo workflow restores reserve ammo");
g_Assert.throws(function InvokeFailingAmmoCallback() {
	g_vecDocumentationContexts[3].WithTemporaryWeaponAmmo(g_RifleWeapon, 92, function ThrowAmmoCallbackError() {
		throw new Error("ammo callback failure");
	});
}, /ammo callback failure/, "ammo workflow propagates callback errors");
g_Assert.equal(g_mapWeaponState.get(10).Ammo, 90, "ammo workflow restores after callback errors");

const g_TemporaryVectorResult = g_vecDocumentationContexts[4].WithTemporaryWeaponProperty(g_RifleWeapon, "m_vecOffset", "vector", { X: 4, Y: 5, Z: 6 }, function CopyTemporaryVector(VectorValue) {
	return { X: VectorValue.X, Y: VectorValue.Y, Z: VectorValue.Z };
});
g_Assert.deepEqual(g_TemporaryVectorResult, { X: 4, Y: 5, Z: 6 }, "generic workflow exposes temporary vector components");

const g_RestoredVectorValue = g_mapWeaponState.get(10).Properties.m_vecOffset;
g_Assert.deepEqual({ X: g_RestoredVectorValue.X, Y: g_RestoredVectorValue.Y, Z: g_RestoredVectorValue.Z }, { X: 1, Y: 2, Z: 3 }, "generic workflow restores vector components");

{
	const CopiedVectorValue = g_vecDocumentationContexts[4].CopyWeaponPropertyValue(g_RestoredVectorValue);
	g_Assert.notEqual(CopiedVectorValue, g_RestoredVectorValue, "generic vector copy creates a detached record");
	g_Assert.deepEqual(Object.keys(CopiedVectorValue).sort(), ["X", "Y", "Z"], "generic vector copy uses canonical component names");
	g_Assert.deepEqual({ X: CopiedVectorValue.X, Y: CopiedVectorValue.Y, Z: CopiedVectorValue.Z }, { X: 1, Y: 2, Z: 3 }, "generic vector copy preserves original components");
}

g_Assert.throws(function InvokeGenericEntityController() {
	g_vecDocumentationContexts[4].WithTemporaryWeaponProperty(g_RifleWeapon, "m_iClip1", "entity", 1, function AcceptEntityProperty() {
		return true;
	});
}, /use WithTemporaryWeaponEntity/, "generic workflow routes entity handles to the dedicated controller");
g_Assert.throws(function InvokeFailingPropertyCallback() {
	g_vecDocumentationContexts[4].WithTemporaryWeaponProperty(g_RifleWeapon, "m_iClip1", "int", 31, function ThrowPropertyCallbackError() {
		throw new Error("property callback failure");
	});
}, /property callback failure/, "generic workflow propagates callback errors");
g_Assert.equal(g_mapWeaponState.get(10).Properties.m_iClip1, 30, "generic workflow restores after callback errors");

const g_TemporaryScalars = g_vecDocumentationContexts[5].WithTemporaryWeaponScalars(g_RifleWeapon, "m_iClip1", 31, "m_flNextPrimaryAttack", 1.5, function CopyTemporaryScalars(ScalarValues) {
	return { FloatValue: ScalarValues.FloatPropertyValue, IntegerValue: ScalarValues.IntegerPropertyValue };
});
g_Assert.deepEqual(g_TemporaryScalars, { FloatValue: 1.5, IntegerValue: 31 }, "typed-scalar workflow reads both temporary values");
g_Assert.equal(g_mapWeaponState.get(10).Properties.m_iClip1, 30, "typed-scalar workflow restores the integer");
g_Assert.equal(g_mapWeaponState.get(10).Properties.m_flNextPrimaryAttack, 1.25, "typed-scalar workflow restores the float");
g_Assert.throws(function InvokeFailingScalarCallback() {
	g_vecDocumentationContexts[5].WithTemporaryWeaponScalars(g_RifleWeapon, "m_iClip1", 32, "m_flNextPrimaryAttack", 1.75, function ThrowScalarCallbackError() {
		throw new Error("scalar callback failure");
	});
}, /scalar callback failure/, "typed-scalar workflow propagates callback errors");
g_Assert.equal(g_mapWeaponState.get(10).Properties.m_iClip1, 30, "typed-scalar workflow restores integer state after errors");
g_Assert.equal(g_mapWeaponState.get(10).Properties.m_flNextPrimaryAttack, 1.25, "typed-scalar workflow restores float state after errors");

const g_unTemporaryEntityIndex = g_vecDocumentationContexts[6].WithTemporaryWeaponEntity(g_RifleWeapon, "m_hOwnerEntity", { Index: 2 }, function ReadTemporaryEntityIndex(EntityValue) {
	return EntityValue.Index;
});
g_Assert.equal(g_unTemporaryEntityIndex, 2, "entity workflow exposes the temporary handle target");
g_Assert.equal(g_mapWeaponState.get(10).Properties.m_hOwnerEntity, 1, "entity workflow restores the original handle");
g_Assert.throws(function InvokeFailingEntityCallback() {
	g_vecDocumentationContexts[6].WithTemporaryWeaponEntity(g_RifleWeapon, "m_hOwnerEntity", { Index: 2 }, function ThrowEntityCallbackError() {
		throw new Error("entity callback failure");
	});
}, /entity callback failure/, "entity workflow propagates callback errors");
g_Assert.equal(g_mapWeaponState.get(10).Properties.m_hOwnerEntity, 1, "entity workflow restores after callback errors");

const g_TemporaryStringValues = g_vecDocumentationContexts[7].WithTemporaryWeaponString(g_RifleWeapon, g_strCustomNameProperty, "Changed", function CopyTemporaryStringValues(StringValues) {
	return { StringArrayValue: StringValues.StringArrayPropertyValue, StringValue: StringValues.StringPropertyValue };
});
g_Assert.deepEqual(g_TemporaryStringValues, { StringArrayValue: "Changed", StringValue: "Changed" }, "string workflow exercises both native string readers");
g_Assert.equal(g_mapWeaponState.get(10).Properties[g_strCustomNameProperty], "Primary", "string workflow restores the original value");
g_Assert.throws(function InvokeFailingStringCallback() {
	g_vecDocumentationContexts[7].WithTemporaryWeaponString(g_RifleWeapon, g_strCustomNameProperty, "Failure", function ThrowStringCallbackError() {
		throw new Error("string callback failure");
	});
}, /string callback failure/, "string workflow propagates callback errors");
g_Assert.equal(g_mapWeaponState.get(10).Properties[g_strCustomNameProperty], "Primary", "string workflow restores after callback errors");

g_mapWeaponState.set(99, {
	Ammo: 0,
	ClassName: "weapon_temporary",
	Properties: {
		[g_strCustomNameProperty]: "Temporary",
		m_flNextPrimaryAttack: 0,
		m_hOwnerEntity: 1,
		m_iClip1: 0,
		m_vecOffset: { X: 0, Y: 0, Z: 0 },
	},
});

g_Assert.equal(g_vecDocumentationContexts[8].RemoveCallerOwnedWeapon(CreateWeapon(99)), true, "removal workflow removes a caller-owned weapon");
g_Assert.equal(g_mapWeaponState.has(99), false, "removal workflow invalidates the temporary entity");
g_Assert.throws(function RemoveMissingCallerOwnedWeapon() {
	g_vecDocumentationContexts[8].RemoveCallerOwnedWeapon(null);
}, /expects a weapon reference/, "removal workflow validates ownership input");
g_Assert.equal(JSON.stringify(Array.from(g_mapWeaponState)), g_strInitialWeaponState, "documentation workflows restore exact weapon state");
g_Assert.doesNotMatch(g_strDocumentationSource, /console\.(?:log|warn|error)/, "weapons/engines examples do not depend on console output");
g_Assert.doesNotMatch(g_strDocumentationSource, /Generated by|byClassName\(\)|byName\(\)|weapon\(\)/, "documentation is handwritten");
g_Assert.doesNotMatch(g_strDocumentationSource, /\bsnapshots?\b/i, "weapons/engines documentation describes live values");

for (const strExportName of Object.keys(g_WeaponsEnginesAPI)) {
	g_Assert.match(g_strDocumentationSource, new RegExp(`\\b${strExportName}\\b`), `documentation covers ${strExportName}`);
}

for (const strPropertyType of g_vecCanonicalPropertyTypes) {
	g_Assert.match(g_strDocumentationSource, new RegExp(`\\b${strPropertyType}\\b`), `documentation covers property type ${strPropertyType}`);
}

for (const strRelativeLink of ["weapons.md", "weapons-entity.md", "weapons-engines-csgo.md", "entities-props.md", "players-entity.md"]) {
	g_Assert.equal(g_FileSystem.existsSync(g_Path.join(g_Path.dirname(g_strDocumentationPath), strRelativeLink)), true, `documentation link exists: ${strRelativeLink}`);
}

const g_strModuleBindingsSource = g_FileSystem.readFileSync(g_strModuleBindingsPath, "utf8");
const g_strWeaponEnginesModuleMarker = "v8::Local<v8::Object> const LocalWeaponsEnginesModule = MakeModule(pIsolate);";
const g_strWeaponEnginesInstallMarker = "InstallModule(pIsolate, LocalContext, LocalSourceJS, \"weapons/engines\"";
const g_nWeaponEnginesBindingStartIndex = g_strModuleBindingsSource.indexOf(g_strWeaponEnginesModuleMarker);
g_Assert.notEqual(g_nWeaponEnginesBindingStartIndex, -1, "weapons/engines module binding starts in native source");

const g_nWeaponEnginesBindingEndIndex = g_strModuleBindingsSource.indexOf(g_strWeaponEnginesInstallMarker, g_nWeaponEnginesBindingStartIndex);
g_Assert.notEqual(g_nWeaponEnginesBindingEndIndex, -1, "weapons/engines module binding ends in native source");
g_Assert.ok(g_nWeaponEnginesBindingEndIndex > g_nWeaponEnginesBindingStartIndex, "weapons/engines binding region is ordered");

const g_strWeaponEnginesBindingSource = g_strModuleBindingsSource.slice(g_nWeaponEnginesBindingStartIndex, g_nWeaponEnginesBindingEndIndex);
g_Assert.match(g_strWeaponEnginesBindingSource, /InstallWeaponPropertyAndAmmoFunctions/, "weapons/engines installs the complete property API");
g_Assert.doesNotMatch(g_strWeaponEnginesBindingSource, /GetWeaponItemDefinitionIndex|ITEM_DEFINITION_PROPERTY/, "CS:GO-only members stay separate");
g_Assert.match(g_strModuleBindingsSource, /#if defined\(ENGINE_CSGO\)[\s\S]*?"weapons\/engines\/csgo"/, "CS:GO module is branch-conditioned");

const g_unMissingRuntimeTimeoutMilliseconds = 5000;
const g_MissingRuntimeResult = g_ChildProcess.spawnSync(process.execPath, ["-e", `require(${JSON.stringify(g_strEnginesPath)});`], { encoding: "utf8", timeout: g_unMissingRuntimeTimeoutMilliseconds, env: { ...process.env, NODE_PATH: g_strPackageRootPath } });
g_Assert.equal(g_MissingRuntimeResult.error, undefined, "missing-runtime child starts and completes without timeout");
g_Assert.equal(g_MissingRuntimeResult.signal, null, "missing-runtime child exits without a signal");
g_Assert.equal(g_MissingRuntimeResult.status, 1, "weapons/engines requires the native runtime");
g_Assert.match(g_MissingRuntimeResult.stderr, /SourceJS native runtime is not installed/, "missing runtime error");

console.log("[  OK  ] smoke_weapons_engines");
