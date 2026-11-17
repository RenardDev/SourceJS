#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "weapons-entity.md");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strBasePath = g_Path.join(g_strPackageRootPath, "weapons", "index.js");
const g_strEntitiesBasePath = g_Path.join(g_strPackageRootPath, "entities", "index.js");
const g_strEntityPath = g_Path.join(g_strPackageRootPath, "weapons", "entity.js");
const g_strRuntimePath = g_Path.join(g_strPackageRootPath, "internal", "runtime.js");
const g_strCustomNameProperty = "m_AttributeManager.m_Item.m_szCustomName";
const g_strWeaponClassPrefix = "weapon_";
const g_strAmmoPropertyPrefix = "m_iAmmo.";
const g_unDocumentationTimeoutMilliseconds = 1000;
const g_nMinimumSigned32BitInteger = -2_147_483_648;
const g_nMaximumSigned32BitInteger = 2_147_483_647;
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
const g_vecWeaponMethods = [
	"Drop",
	"GetAmmo",
	"GetClip",
	"GetOwner",
	"GetPrimaryAmmoType",
	"GetSecondaryAmmo",
	"GetSecondaryAmmoType",
	"GetSecondaryClip",
	"GetWeaponName",
	"SetAmmo",
	"SetClip",
	"SetSecondaryAmmo",
	"SetSecondaryClip",
];
const g_vecForbiddenWeaponEntityExports = ["weapon", "byIndex", "moduleName", "default"];

const g_vecDropCalls = [];
const g_mapOwnerAmmoCounts = new Map([[3, 45]]);
// Preserve native SDK selector names; vector values use project X/Y/Z fields.
const g_mapWeaponState = new Map([
	[10, {
		Ammo: 90,
		ClassName: "weapon_rifle",
		Properties: {
			[g_strCustomNameProperty]: "Primary",
			m_flNextPrimaryAttack: 1.25,
			m_hOwnerEntity: 1,
			m_iClip1: 30,
			m_iClip2: 2,
			m_iPrimaryAmmoType: 2,
			m_iSecondaryAmmoType: 3,
			m_vecOffset: { X: 1, Y: 2, Z: 3 },
		},
	}],
]);
const g_strInitialWeaponState = JSON.stringify(Array.from(g_mapWeaponState.entries()));
const g_strInitialOwnerAmmoState = JSON.stringify(Array.from(g_mapOwnerAmmoCounts.entries()));

let g_unNativeOperationCount = 0;

function InstallDependency(strDependencyPath, ModuleExports) {
	require.cache[strDependencyPath] = {
		children: [],
		exports: ModuleExports,
		filename: strDependencyPath,
		id: strDependencyPath,
		loaded: true,
		paths: [],
	};
}

function GetEntityIndex(EntityReference) {
	let IndexValue = EntityReference;
	if (EntityReference && (typeof EntityReference === "object")) {
		IndexValue = EntityReference.Index;
	}

	if (!Number.isSafeInteger(IndexValue) || (IndexValue < 0)) {
		throw new TypeError("entity index must be a non-negative safe integer");
	}

	return IndexValue;
}

function RequireSigned32BitInteger(nIntegerValue) {
	const strValueErrorMessage = "RequireSigned32BitInteger(nIntegerValue) requires an in-range signed 32-bit integer.";

	if (typeof nIntegerValue === "bigint") {
		if ((nIntegerValue < BigInt(g_nMinimumSigned32BitInteger)) || (nIntegerValue > BigInt(g_nMaximumSigned32BitInteger))) {
			throw new TypeError(strValueErrorMessage);
		}

		return Number(nIntegerValue);
	}

	if (!Number.isInteger(nIntegerValue) || (nIntegerValue < g_nMinimumSigned32BitInteger) || (nIntegerValue > g_nMaximumSigned32BitInteger)) {
		throw new TypeError(strValueErrorMessage);
	}

	return (nIntegerValue === 0) ? 0 : nIntegerValue;
}

function CreateEntity(unEntityIndex) {
	return { Free: false, Index: unEntityIndex, Valid: true };
}

function CreateNativeWeapon(unWeaponIndex) {
	const CurrentWeaponState = g_mapWeaponState.get(unWeaponIndex);
	if (!CurrentWeaponState) {
		return null;
	}

	return { ClassName: CurrentWeaponState.ClassName, Free: false, Index: unWeaponIndex, IsWeapon: true, Valid: true, Weapon: CurrentWeaponState.ClassName.slice(g_strWeaponClassPrefix.length), WeaponName: CurrentWeaponState.ClassName.slice(g_strWeaponClassPrefix.length) };
}

function RequireWeapon(WeaponReference) {
	const unWeaponIndex = GetEntityIndex(WeaponReference);
	const CurrentWeaponState = g_mapWeaponState.get(unWeaponIndex);
	if (!CurrentWeaponState) {
		throw new Error(`weapon not found: ${unWeaponIndex}`);
	}

	return CurrentWeaponState;
}

function ReadProperty(EntityReference, strPropertyName) {
	const unEntityIndex = GetEntityIndex(EntityReference);
	if ((unEntityIndex === 1) && /^m_iAmmo\.\d{3}$/.test(strPropertyName)) {
		const unAmmoTypeIndex = Number.parseInt(strPropertyName.slice(g_strAmmoPropertyPrefix.length), 10);
		if (!g_mapOwnerAmmoCounts.has(unAmmoTypeIndex)) {
			throw new Error(`owner ammo property not found: ${strPropertyName}`);
		}

		return g_mapOwnerAmmoCounts.get(unAmmoTypeIndex);
	}

	const WeaponProperties = RequireWeapon(unEntityIndex).Properties;
	if ((typeof strPropertyName !== "string") || !Object.hasOwn(WeaponProperties, strPropertyName)) {
		throw new Error(`weapon property not found: ${String(strPropertyName)}`);
	}

	return WeaponProperties[strPropertyName];
}

function WriteProperty(EntityReference, strPropertyName, PropertyValue) {
	const unEntityIndex = GetEntityIndex(EntityReference);
	if ((unEntityIndex === 1) && /^m_iAmmo\.\d{3}$/.test(strPropertyName)) {
		const unAmmoTypeIndex = Number.parseInt(strPropertyName.slice(g_strAmmoPropertyPrefix.length), 10);
		if (!g_mapOwnerAmmoCounts.has(unAmmoTypeIndex)) {
			throw new Error(`owner ammo property not found: ${strPropertyName}`);
		}

		g_mapOwnerAmmoCounts.set(unAmmoTypeIndex, PropertyValue);
		return true;
	}

	ReadProperty(unEntityIndex, strPropertyName);
	RequireWeapon(unEntityIndex).Properties[strPropertyName] = PropertyValue;

	return true;
}

const g_WeaponEntityRuntime = {
	GetAmmo(WeaponReference) {
		g_unNativeOperationCount += 1;

		return RequireWeapon(WeaponReference).Ammo;
	},

	GetProperty(WeaponReference, strPropertyName) {
		g_unNativeOperationCount += 1;

		return ReadProperty(WeaponReference, strPropertyName);
	},

	GetPropertyEntity(WeaponReference, strPropertyName) {
		g_unNativeOperationCount += 1;

		const EntityIndexValue = ReadProperty(WeaponReference, strPropertyName);
		if (!Number.isSafeInteger(EntityIndexValue) || (EntityIndexValue < 0)) {
			return null;
		}

		return CreateEntity(EntityIndexValue);
	},

	GetPropertyFloat(WeaponReference, strPropertyName) {
		g_unNativeOperationCount += 1;

		return ReadProperty(WeaponReference, strPropertyName);
	},

	GetPropertyInteger(WeaponReference, strPropertyName) {
		g_unNativeOperationCount += 1;

		return ReadProperty(WeaponReference, strPropertyName);
	},

	GetPropertyString(WeaponReference, strPropertyName) {
		g_unNativeOperationCount += 1;

		return ReadProperty(WeaponReference, strPropertyName);
	},

	GetPropertyStringArray(WeaponReference, strPropertyName) {
		g_unNativeOperationCount += 1;

		return ReadProperty(WeaponReference, strPropertyName);
	},

	GetName(WeaponReference) {
		g_unNativeOperationCount += 1;

		return RequireWeapon(WeaponReference).ClassName.slice(g_strWeaponClassPrefix.length);
	},

	SetAmmo(WeaponReference, nAmmoCount) {
		g_unNativeOperationCount += 1;

		const nNormalizedAmmoCount = RequireSigned32BitInteger(nAmmoCount);
		RequireWeapon(WeaponReference).Ammo = nNormalizedAmmoCount;

		return true;
	},

	SetProperty(WeaponReference, strPropertyName, PropertyValue) {
		g_unNativeOperationCount += 1;

		return WriteProperty(WeaponReference, strPropertyName, PropertyValue);
	},

	SetPropertyEntity(WeaponReference, strPropertyName, EntityReference) {
		g_unNativeOperationCount += 1;

		const unPropertyEntityIndex = GetEntityIndex(EntityReference);

		return WriteProperty(WeaponReference, strPropertyName, unPropertyEntityIndex);
	},

	SetPropertyFloat(WeaponReference, strPropertyName, flPropertyValue) {
		g_unNativeOperationCount += 1;

		if ((typeof flPropertyValue !== "number") || !Number.isFinite(flPropertyValue)) {
			throw new TypeError("property value must be finite");
		}

		return WriteProperty(WeaponReference, strPropertyName, flPropertyValue);
	},

	SetPropertyInteger(WeaponReference, strPropertyName, nPropertyValue) {
		g_unNativeOperationCount += 1;

		return WriteProperty(WeaponReference, strPropertyName, RequireSigned32BitInteger(nPropertyValue));
	},

	SetPropertyString(WeaponReference, strPropertyName, strPropertyValue) {
		g_unNativeOperationCount += 1;

		if (typeof strPropertyValue !== "string") {
			throw new TypeError("property value must be a string");
		}

		return WriteProperty(WeaponReference, strPropertyName, strPropertyValue);
	},

	SetPropertyStringArray(WeaponReference, strPropertyName, strPropertyValue) {
		g_unNativeOperationCount += 1;

		if (typeof strPropertyValue !== "string") {
			throw new TypeError("property value must be a string");
		}

		return WriteProperty(WeaponReference, strPropertyName, strPropertyValue);
	},
};

const g_NativeWeaponEntityAPI = {
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

	GetWeapon(WeaponReference) {
		g_unNativeOperationCount += 1;

		return CreateNativeWeapon(GetEntityIndex(WeaponReference));
	},
};

function RunDocumentationBlock(strDocumentationCode, unDocumentationBlockIndex, WeaponEntityAPI) {
	function RequireDocumentationModule(strModuleIdentifier) {
		if (strModuleIdentifier === "weapons/entity") {
			return WeaponEntityAPI;
		}

		throw new Error(`Unexpected documentation import: ${strModuleIdentifier}`);
	}

	const DocumentationContext = g_VM.createContext({ require: RequireDocumentationModule });
	const unNativeOperationsBefore = g_unNativeOperationCount;

	g_VM.runInContext(strDocumentationCode, DocumentationContext, { filename: `${g_strDocumentationPath}#example-${unDocumentationBlockIndex + 1}`, timeout: g_unDocumentationTimeoutMilliseconds });

	g_Assert.equal(g_unNativeOperationCount, unNativeOperationsBefore, `documentation block ${unDocumentationBlockIndex + 1} performs no native work while loading`);

	return DocumentationContext;
}

const g_EntitiesDependency = {
	DecorateEntity(EntityReference) {
		if (EntityReference) {
			EntityReference.EntityDecorated = true;

			for (const [strMethodName, Method] of Object.entries(g_NativeWeaponEntityAPI)) {
				if ((strMethodName === "GetWeapon") || (typeof Method !== "function")) {
					continue;
				}

				Object.defineProperty(EntityReference, strMethodName, { configurable: true, enumerable: false, value: (...vecArguments) => Method(EntityReference, ...vecArguments), writable: true });
			}
		}

		return EntityReference;
	},
};
const g_PlayerDropWeaponRuntime = {
	DropWeapon(OwnerReference, WeaponReference, DropTarget, DropVelocity) {
		g_unNativeOperationCount += 1;
		g_vecDropCalls.push({ DropTarget, DropVelocity, OwnerReference, WeaponReference });

		return true;
	},
};

function LoadTestAPI() {
	const SourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
	const LoaderDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");
	const OriginalModuleLoad = LoaderDescriptor?.value;
	const mapCachedModules = new Map();
	for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
		if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
			mapCachedModules.set(strModulePath, Object.getOwnPropertyDescriptor(require.cache, strModulePath));
		}
	}

	g_Assert.ok(SourceJSDescriptor || Object.isExtensible(globalThis), "Weapons/entity runtime fixture must support installation.");
	g_Assert.ok(Object.isExtensible(require.cache), "Weapons/entity package cache must support exact restoration.");
	g_Assert.ok(!SourceJSDescriptor || SourceJSDescriptor.configurable, "Weapons/entity runtime fixture must support exact restoration.");
	g_Assert.ok(LoaderDescriptor && LoaderDescriptor.configurable && (typeof OriginalModuleLoad === "function"), "Weapons/entity loader must support exact restoration.");

	for (const Descriptor of mapCachedModules.values()) {
		g_Assert.equal(Descriptor.configurable, true, "Borrowed weapons/entity cache entries must support exact restoration.");
	}

	const RestoreProperty = (Target, strKey, Descriptor) => {
		if (Descriptor) {
			Object.defineProperty(Target, strKey, Descriptor);
			return;
		}

		g_Assert.ok(Reflect.deleteProperty(Target, strKey), "Owned weapons/entity fixture property must be removable: " + strKey);
	};

	let bSourceJSOwned = false;
	let bLoaderOwned = false;
	let bCacheOwned = false;
	let bFailed = false;
	let Failure = undefined;
	let Result = undefined;

	try {
		bCacheOwned = true;

		for (const strModulePath of mapCachedModules.keys()) {
			RestoreProperty(require.cache, strModulePath, undefined);
		}

		InstallDependency(g_strEntitiesBasePath, g_EntitiesDependency);
		Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: true, writable: true, value: { "players/dropweapon": g_PlayerDropWeaponRuntime, weapons: g_WeaponEntityRuntime, "weapons/entity": g_NativeWeaponEntityAPI } });
		bSourceJSOwned = true;

		Object.defineProperty(g_Module, "_load", {
			...LoaderDescriptor,
			writable: true,
			value: function Load(strRequest, ParentModule, bIsMain) {
				if (strRequest === "internal/runtime") {
					return require(g_strRuntimePath);
				}

				if (strRequest === "entities") {
					return require(g_strEntitiesBasePath);
				}

				if (strRequest === "weapons") {
					return require(g_strBasePath);
				}

				return OriginalModuleLoad.call(this, strRequest, ParentModule, bIsMain);
			},
		});
		bLoaderOwned = true;

		const WeaponsEntityAPI = require(g_strEntityPath);
		const { DecorateWeapon } = require(g_strBasePath);

		Result = { WeaponsEntityAPI, DecorateWeapon };
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

		if (bLoaderOwned) {
			AttemptRestoration(() => RestoreProperty(g_Module, "_load", LoaderDescriptor));
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

			throw new AggregateError(vecFailures, "Weapons/entity fixture restoration failed.");
		}
	}

	if (bFailed) {
		throw Failure;
	}

	return Result;
}

const { WeaponsEntityAPI: g_WeaponsEntityAPI, DecorateWeapon } = LoadTestAPI();
g_Assert.deepEqual(Object.keys(g_WeaponsEntityAPI).sort(), [
	"Weapon",
	"GetAmmo",
	"GetProperty",
	"GetPropertyEntity",
	"GetPropertyFloat",
	"GetPropertyInteger",
	"GetPropertyString",
	"GetPropertyStringArray",
	"SetAmmo",
	"SetProperty",
	"SetPropertyEntity",
	"SetPropertyFloat",
	"SetPropertyInteger",
	"SetPropertyString",
	"SetPropertyStringArray",
].sort(), "exact weapons/entity exports");
g_Assert.equal(g_WeaponsEntityAPI.GetAmmo, g_NativeWeaponEntityAPI.GetAmmo, "direct native GetAmmo export");
g_Assert.equal(g_WeaponsEntityAPI.SetPropertyInteger, g_NativeWeaponEntityAPI.SetPropertyInteger, "direct native SetPropertyInteger export");

for (const [strExportName, NativeFunction] of Object.entries(g_NativeWeaponEntityAPI)) {
	if ((strExportName !== "Weapon") && (strExportName !== "GetWeapon") && /^[A-Z]/.test(strExportName)) {
		g_Assert.equal(g_WeaponsEntityAPI[strExportName], NativeFunction, `direct native export identity: ${strExportName}`);
	}
}

const g_LiveWeapon = g_WeaponsEntityAPI.Weapon(10);
for (const ExistingPropertyValue of [false, null, 0, undefined]) {
	const CustomizedWeapon = CreateNativeWeapon(g_LiveWeapon.Index);
	CustomizedWeapon.GetClip = ExistingPropertyValue;
	g_Assert.equal(DecorateWeapon(CustomizedWeapon), CustomizedWeapon, "decoration preserves the existing weapon identity");
	g_Assert.equal(CustomizedWeapon.GetClip, ExistingPropertyValue, "an own non-function property blocks method installation");

	const InheritedPropertyWeapon = CreateNativeWeapon(g_LiveWeapon.Index);
	Object.setPrototypeOf(InheritedPropertyWeapon, { GetClip: ExistingPropertyValue });
	DecorateWeapon(InheritedPropertyWeapon);
	g_Assert.equal(Object.hasOwn(InheritedPropertyWeapon, "GetClip"), false, "an inherited non-function property blocks method installation");
	g_Assert.equal(InheritedPropertyWeapon.GetClip, ExistingPropertyValue, "inherited property value is preserved");
}

for (const bConfigurable of [false, true]) {
	let unAccessorReadCount = 0;
	const AccessorWeapon = CreateNativeWeapon(g_LiveWeapon.Index);
	Object.defineProperty(AccessorWeapon, "GetClip", {
		configurable: bConfigurable,
		get: function ReadPreservedProperty() {
			unAccessorReadCount += 1;

			return false;
		},
	});
	DecorateWeapon(AccessorWeapon);
	g_Assert.equal(unAccessorReadCount, 0, "decoration does not invoke an existing accessor");
	g_Assert.equal(Object.getOwnPropertyDescriptor(AccessorWeapon, "GetClip").configurable, bConfigurable, "existing accessor configuration is preserved");
	g_Assert.equal(AccessorWeapon.GetClip, false, "existing accessor value is preserved");
	g_Assert.equal(unAccessorReadCount, 1, "only the explicit property read invokes the accessor");
}

g_Assert.equal(g_LiveWeapon.Index, 10, "Weapon index");
g_Assert.equal(g_LiveWeapon.EntityDecorated, true, "Weapon receives entity decoration");
g_Assert.equal(g_WeaponsEntityAPI.Weapon({ Index: 10 }).Index, 10, "Weapon accepts an indexed object");
g_Assert.equal(g_WeaponsEntityAPI.Weapon(99), null, "missing weapon is null");

for (const strMethodName of g_vecWeaponMethods) {
	g_Assert.equal(typeof g_LiveWeapon[strMethodName], "function", `decorated weapon method: ${strMethodName}`);
	g_Assert.equal(Object.getOwnPropertyDescriptor(g_LiveWeapon, strMethodName).enumerable, false, `weapon method is non-enumerable: ${strMethodName}`);
}

g_Assert.equal(g_LiveWeapon.GetWeaponName(), "rifle", "weapon short name");
g_Assert.equal(g_LiveWeapon.GetOwner().Index, 1, "weapon owner");
g_Assert.equal(g_LiveWeapon.GetOwner().EntityDecorated, true, "weapon owner is decorated");
g_Assert.equal(g_LiveWeapon.GetPrimaryAmmoType(), 2, "primary ammo type");
g_Assert.equal(g_LiveWeapon.GetSecondaryAmmoType(), 3, "secondary ammo type");
g_Assert.equal(g_LiveWeapon.GetClip(), 30, "primary clip");
g_Assert.equal(g_LiveWeapon.GetAmmo(), 90, "primary ammo");
g_Assert.equal(g_LiveWeapon.GetSecondaryClip(), 2, "secondary clip");
g_Assert.equal(g_LiveWeapon.GetSecondaryAmmo(), 45, "secondary ammo");

{
	const OriginalWeaponState = g_mapWeaponState.get(10);
	const nOriginalAmmoCount = OriginalWeaponState.Ammo;
	const OriginalWeaponProperties = { ...OriginalWeaponState.Properties };
	const mapOriginalOwnerAmmoCounts = new Map(g_mapOwnerAmmoCounts);
	try {
		g_Assert.equal(g_LiveWeapon.SetClip(31), true, "primary clip mutation succeeds");
		g_Assert.equal(g_LiveWeapon.SetAmmo(91), true, "primary ammo mutation succeeds");
		g_Assert.equal(g_LiveWeapon.SetSecondaryClip(3), true, "secondary clip mutation succeeds");
		g_Assert.equal(g_LiveWeapon.SetSecondaryAmmo(46), true, "secondary ammo mutation succeeds");

		g_Assert.equal(g_LiveWeapon.GetClip(), 31, "primary clip write");
		g_Assert.equal(g_LiveWeapon.GetAmmo(), 91, "primary ammo write");
		g_Assert.equal(g_LiveWeapon.GetSecondaryClip(), 3, "secondary clip write");
		g_Assert.equal(g_LiveWeapon.GetSecondaryAmmo(), 46, "secondary ammo write");

		g_Assert.equal(g_LiveWeapon.SetClip(30), true, "primary clip restoration succeeds");
		g_Assert.equal(g_LiveWeapon.SetAmmo(90), true, "primary ammo restoration succeeds");
		g_Assert.equal(g_LiveWeapon.SetSecondaryClip(2), true, "secondary clip restoration succeeds");
		g_Assert.equal(g_LiveWeapon.SetSecondaryAmmo(45), true, "secondary ammo restoration succeeds");
	} finally {
		OriginalWeaponState.Ammo = nOriginalAmmoCount;
		Object.assign(OriginalWeaponState.Properties, OriginalWeaponProperties);
		g_mapOwnerAmmoCounts.clear();

		for (const [unAmmoTypeIndex, nAmmoCount] of mapOriginalOwnerAmmoCounts) {
			g_mapOwnerAmmoCounts.set(unAmmoTypeIndex, nAmmoCount);
		}
	}
}

{
	const OriginalWeaponState = g_mapWeaponState.get(10);
	const nOriginalAmmo = OriginalWeaponState.Ammo;
	const nOriginalClip = OriginalWeaponState.Properties.m_iClip1;
	const nOriginalOwnerIndex = OriginalWeaponState.Properties.m_hOwnerEntity;
	const vecValidValues = [g_nMinimumSigned32BitInteger, -1, -0, 0, 1, g_nMaximumSigned32BitInteger, BigInt(g_nMinimumSigned32BitInteger), -1n, 0n, 1n, BigInt(g_nMaximumSigned32BitInteger)];
	const vecInvalidValues = [g_nMinimumSigned32BitInteger - 1, g_nMaximumSigned32BitInteger + 1, BigInt(g_nMinimumSigned32BitInteger) - 1n, BigInt(g_nMaximumSigned32BitInteger) + 1n, 0.5, NaN, Infinity, -Infinity, "1", true, null, undefined, {}, [], Object(1n)];
	let unValidWriteCount = 0;
	let unInvalidWriteCount = 0;
	let unNullishHandleCount = 0;
	try {
		for (const Operation of [
			{ Read: () => g_WeaponsEntityAPI.GetAmmo(g_LiveWeapon), Write: nValue => g_WeaponsEntityAPI.SetAmmo(g_LiveWeapon, nValue) },
			{ Read: () => g_WeaponsEntityAPI.GetPropertyInteger(g_LiveWeapon, "m_iClip1"), Write: nValue => g_WeaponsEntityAPI.SetPropertyInteger(g_LiveWeapon, "m_iClip1", nValue) },
		]) {
			for (const nValue of vecValidValues) {
				const nExpectedValue = (nValue === 0) ? 0 : Number(nValue);
				g_Assert.equal(Operation.Write(nValue), true, "valid signed32 fixture write succeeds");
				g_Assert.equal(Operation.Read(), nExpectedValue, "signed32 fixture stores native numeric representation");
				unValidWriteCount++;
			}

			for (const Value of vecInvalidValues) {
				const nValueBefore = Operation.Read();
				g_Assert.throws(() => Operation.Write(Value), TypeError, "invalid signed32 write rejects before mutation");
				g_Assert.equal(Operation.Read(), nValueBefore, "invalid signed32 write preserves storage");
				unInvalidWriteCount++;
			}
		}

		for (const EntityReference of [null, undefined]) {
			g_Assert.throws(() => g_WeaponsEntityAPI.SetPropertyEntity(g_LiveWeapon, "m_hOwnerEntity", EntityReference), TypeError, "nullish entity handle must not clear native storage");
			g_Assert.equal(OriginalWeaponState.Properties.m_hOwnerEntity, nOriginalOwnerIndex, "rejected nullish entity handle preserves owner storage");
			unNullishHandleCount++;
		}
	} finally {
		OriginalWeaponState.Ammo = nOriginalAmmo;
		OriginalWeaponState.Properties.m_iClip1 = nOriginalClip;
		OriginalWeaponState.Properties.m_hOwnerEntity = nOriginalOwnerIndex;
	}

	g_Assert.equal(unValidWriteCount, 22, "both signed32 fixture setters test Number and BigInt boundaries");
	g_Assert.equal(unInvalidWriteCount, 30, "both signed32 fixture setters reject range and type violations");
	g_Assert.equal(unNullishHandleCount, 2, "null and undefined entity handles are rejected");
	console.log("[smoke_weapons_entity] Signed32 fixture profiles passed: valid=22 invalid=30 nullish=2");
}

g_Assert.equal(g_LiveWeapon.Drop(), true, "weapon drop result");
g_Assert.equal(g_vecDropCalls.at(-1).OwnerReference.Index, 1, "drop uses current owner");

const g_unDirectDropCallCount = g_vecDropCalls.length;

for (const strForbiddenExport of g_vecForbiddenWeaponEntityExports) {
	g_Assert.equal(Object.hasOwn(g_WeaponsEntityAPI, strForbiddenExport), false, `forbidden export is absent: ${strForbiddenExport}`);
}

g_Assert.equal(GetEntityIndex({ Index: g_LiveWeapon.Index }), g_LiveWeapon.Index, "the fixture accepts the current public Index field");
g_Assert.throws(function RejectLegacyIndexField() {
	GetEntityIndex({ m_unIndex: g_LiveWeapon.Index });
}, TypeError, "the fixture does not accept a legacy indexed-object alias");

const g_strDocumentationSource = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
g_Assert.match(g_strDocumentationSource, /Direct property functions throw for unresolved entities or missing properties/, "documentation states the shared entity-property failure boundary");
g_Assert.match(g_strDocumentationSource, /`longlong`, `ulonglong` \| `bigint` \| In-range `bigint` only\./, "64-bit property writes require bigint");
g_Assert.match(g_strDocumentationSource, /first UTF-8 byte is used; empty string writes NUL/, "character properties are byte storage, not Unicode characters");
g_Assert.match(g_strDocumentationSource, /any existing property with a targeted method name/, "decoration preserves existing non-function properties too");
g_Assert.match(g_strDocumentationSource, /a returned promise\s+does not delay cleanup/, "resource cleanup does not wait for a promise result");
g_Assert.match(g_strDocumentationSource, /not\s+capacity-bounded reads/, "string readers require terminated storage rather than a reflected-capacity bound");
g_Assert.match(g_strDocumentationSource, /copies indexes before the drop operation/, "drop reports do not read borrowed identities after the mutation");

const g_DocumentationCodeBlockPattern = /```js\r?\n([\s\S]*?)```/g;
const g_vecDocumentationCodeBlocks = [];
let g_vecDocumentationCodeBlockMatch = g_DocumentationCodeBlockPattern.exec(g_strDocumentationSource);
while (g_vecDocumentationCodeBlockMatch !== null) {
	g_vecDocumentationCodeBlocks.push(g_vecDocumentationCodeBlockMatch[1]);
	g_vecDocumentationCodeBlockMatch = g_DocumentationCodeBlockPattern.exec(g_strDocumentationSource);
}

g_Assert.equal(g_vecDocumentationCodeBlocks.length, 9, "all weapons/entity documentation JavaScript blocks are present");

const g_vecDocumentationContexts = [];
for (let unDocumentationBlockIndex = 0; unDocumentationBlockIndex < g_vecDocumentationCodeBlocks.length; unDocumentationBlockIndex += 1) {
	const strDocumentationCode = g_vecDocumentationCodeBlocks[unDocumentationBlockIndex];
	g_vecDocumentationContexts.push(RunDocumentationBlock(strDocumentationCode, unDocumentationBlockIndex, g_WeaponsEntityAPI));
}

const g_WeaponIdentity = g_vecDocumentationContexts[1].InspectWeapon(10);
g_Assert.deepEqual({ WeaponIndex: g_WeaponIdentity.WeaponIndex, IsWeapon: g_WeaponIdentity.IsWeapon, WeaponName: g_WeaponIdentity.WeaponName, NativeWeaponName: g_WeaponIdentity.NativeWeaponName, OwnerIndex: g_WeaponIdentity.OwnerIndex }, { WeaponIndex: 10, IsWeapon: true, WeaponName: "rifle", NativeWeaponName: "rifle", OwnerIndex: 1 }, "identity workflow returns owning weapon fields");
g_Assert.equal(g_WeaponIdentity.Weapon.EntityDecorated, true, "identity workflow returns a decorated live weapon");
g_Assert.equal(g_vecDocumentationContexts[1].InspectWeapon(99), null, "identity workflow preserves a missing weapon");

for (const Workflow of [
	{ BlockIndex: 2, Name: "WithTemporaryPrimaryResources", PropertyName: "m_iClip1" },
	{ BlockIndex: 3, Name: "WithTemporarySecondaryResources", PropertyName: "m_iClip2" },
]) {
	for (const nTemporaryClip of [-1, -1n]) {
		const nOriginalClip = g_WeaponsEntityAPI.GetPropertyInteger(g_LiveWeapon, Workflow.PropertyName);
		const unNativeOperationCountBefore = g_unNativeOperationCount;

		try {
			g_Assert.throws(function RejectNegativeTemporaryClip() {
				g_vecDocumentationContexts[Workflow.BlockIndex][Workflow.Name](g_LiveWeapon.Index, nTemporaryClip, 1, function RejectUnexpectedCallback() {
					throw new Error("A negative temporary clip must not reach the callback.");
				});
			}, { name: "RangeError" }, "negative temporary clips are rejected before live operations");
			g_Assert.equal(g_unNativeOperationCount, unNativeOperationCountBefore, "negative clip validation does not call native operations");
			g_Assert.equal(g_WeaponsEntityAPI.GetPropertyInteger(g_LiveWeapon, Workflow.PropertyName), nOriginalClip, "invalid temporary clip input preserves storage");
		} finally {
			g_Assert.equal(g_WeaponsEntityAPI.SetPropertyInteger(g_LiveWeapon, Workflow.PropertyName, nOriginalClip), true, "negative-clip fixture restoration succeeds");
		}
	}
}

const g_TemporaryPrimaryResources = g_vecDocumentationContexts[2].WithTemporaryPrimaryResources(10, 31, 91, function CopyTemporaryPrimaryResources(PrimaryResources) {
	return { AmmoCount: PrimaryResources.Ammo, ClipCount: PrimaryResources.PrimaryClip, PrimaryAmmoType: PrimaryResources.PrimaryAmmoType };
});
g_Assert.deepEqual(g_TemporaryPrimaryResources, { AmmoCount: 91, ClipCount: 31, PrimaryAmmoType: 2 }, "primary-resource workflow reads current resource values");
g_Assert.equal(g_mapWeaponState.get(10).Ammo, 90, "primary-resource workflow restores ammo");
g_Assert.equal(g_mapWeaponState.get(10).Properties.m_iClip1, 30, "primary-resource workflow restores clip");
g_Assert.throws(function InvokeFailingPrimaryResourceCallback() {
	g_vecDocumentationContexts[2].WithTemporaryPrimaryResources(10, 32, 92, function ThrowPrimaryResourceCallbackError() {
		throw new Error("primary callback failure");
	});
}, /primary callback failure/, "primary-resource workflow propagates callback errors");
g_Assert.equal(g_mapWeaponState.get(10).Ammo, 90, "primary-resource workflow restores ammo after errors");
g_Assert.equal(g_mapWeaponState.get(10).Properties.m_iClip1, 30, "primary-resource workflow restores clip after errors");

const g_TemporarySecondaryResources = g_vecDocumentationContexts[3].WithTemporarySecondaryResources(10, 3, 46, function CopyTemporarySecondaryResources(SecondaryResources) {
	return { SecondaryAmmoCount: SecondaryResources.SecondaryAmmo, SecondaryAmmoType: SecondaryResources.SecondaryAmmoType, SecondaryClipCount: SecondaryResources.SecondaryClip };
});
g_Assert.deepEqual(g_TemporarySecondaryResources, { SecondaryAmmoCount: 46, SecondaryAmmoType: 3, SecondaryClipCount: 3 }, "secondary-resource workflow reads current resource values");
g_Assert.equal(g_mapOwnerAmmoCounts.get(3), 45, "secondary-resource workflow restores owner ammo");
g_Assert.equal(g_mapWeaponState.get(10).Properties.m_iClip2, 2, "secondary-resource workflow restores clip");
g_Assert.throws(function InvokeFailingSecondaryResourceCallback() {
	g_vecDocumentationContexts[3].WithTemporarySecondaryResources(10, 4, 47, function ThrowSecondaryResourceCallbackError() {
		throw new Error("secondary callback failure");
	});
}, /secondary callback failure/, "secondary-resource workflow propagates callback errors");
g_Assert.equal(g_mapOwnerAmmoCounts.get(3), 45, "secondary-resource workflow restores owner ammo after errors");
g_Assert.equal(g_mapWeaponState.get(10).Properties.m_iClip2, 2, "secondary-resource workflow restores clip after errors");

const g_TemporaryVectorComponents = g_vecDocumentationContexts[4].WithTemporaryWeaponProperty(g_LiveWeapon, "m_vecOffset", "vector", { X: 4, Y: 5, Z: 6 }, function CopyTemporaryVectorComponents(PropertyValue) {
	return { X: PropertyValue.X, Y: PropertyValue.Y, Z: PropertyValue.Z };
});
g_Assert.deepEqual(g_TemporaryVectorComponents, { X: 4, Y: 5, Z: 6 }, "generic workflow exposes temporary vector components");

const g_RestoredVectorValue = g_mapWeaponState.get(10).Properties.m_vecOffset;
g_Assert.deepEqual({ X: g_RestoredVectorValue.X, Y: g_RestoredVectorValue.Y, Z: g_RestoredVectorValue.Z }, { X: 1, Y: 2, Z: 3 }, "generic workflow restores vector components");

{
	const CopiedVectorValue = g_vecDocumentationContexts[4].CopyWeaponPropertyValue(g_RestoredVectorValue);
	g_Assert.notEqual(CopiedVectorValue, g_RestoredVectorValue, "generic vector copy creates a detached record");
	g_Assert.deepEqual(Object.keys(CopiedVectorValue).sort(), ["X", "Y", "Z"], "generic vector copy uses canonical component names");
	g_Assert.deepEqual({ X: CopiedVectorValue.X, Y: CopiedVectorValue.Y, Z: CopiedVectorValue.Z }, { X: 1, Y: 2, Z: 3 }, "generic vector copy preserves original components");
}

g_Assert.throws(function InvokeFailingGenericPropertyCallback() {
	g_vecDocumentationContexts[4].WithTemporaryWeaponProperty(g_LiveWeapon, "m_iClip1", "int", 31, function ThrowGenericPropertyCallbackError() {
		throw new Error("generic callback failure");
	});
}, /generic callback failure/, "generic workflow propagates callback errors");
g_Assert.equal(g_mapWeaponState.get(10).Properties.m_iClip1, 30, "generic workflow restores after callback errors");

const g_TemporaryDirectScalars = g_vecDocumentationContexts[5].WithTemporaryDirectScalars(g_LiveWeapon, 91, "m_iClip1", 31, "m_flNextPrimaryAttack", 1.5, function CopyTemporaryDirectScalars(ScalarValues) {
	return { Ammo: ScalarValues.Ammo, FloatPropertyValue: ScalarValues.FloatPropertyValue, IntegerPropertyValue: ScalarValues.IntegerPropertyValue };
});
g_Assert.deepEqual(g_TemporaryDirectScalars, { Ammo: 91, FloatPropertyValue: 1.5, IntegerPropertyValue: 31 }, "direct-scalar workflow exercises every scalar pair");
g_Assert.equal(g_mapWeaponState.get(10).Ammo, 90, "direct-scalar workflow restores ammo");
g_Assert.equal(g_mapWeaponState.get(10).Properties.m_iClip1, 30, "direct-scalar workflow restores integer state");
g_Assert.equal(g_mapWeaponState.get(10).Properties.m_flNextPrimaryAttack, 1.25, "direct-scalar workflow restores float state");
g_Assert.throws(function InvokeFailingDirectScalarCallback() {
	g_vecDocumentationContexts[5].WithTemporaryDirectScalars(g_LiveWeapon, 92, "m_iClip1", 32, "m_flNextPrimaryAttack", 1.75, function ThrowDirectScalarCallbackError() {
		throw new Error("scalar callback failure");
	});
}, /scalar callback failure/, "direct-scalar workflow propagates callback errors");
g_Assert.equal(g_mapWeaponState.get(10).Ammo, 90, "direct-scalar workflow restores ammo after errors");
g_Assert.equal(g_mapWeaponState.get(10).Properties.m_iClip1, 30, "direct-scalar workflow restores integer after errors");
g_Assert.equal(g_mapWeaponState.get(10).Properties.m_flNextPrimaryAttack, 1.25, "direct-scalar workflow restores float after errors");

const g_unTemporaryOwnerIndex = g_vecDocumentationContexts[6].WithTemporaryWeaponEntity(g_LiveWeapon, "m_hOwnerEntity", { Index: 2 }, function ReadTemporaryOwnerIndex(OwnerReference) {
	return OwnerReference.Index;
});
g_Assert.equal(g_unTemporaryOwnerIndex, 2, "entity workflow exposes the temporary owner");
g_Assert.equal(g_mapWeaponState.get(10).Properties.m_hOwnerEntity, 1, "entity workflow restores the owner");
g_Assert.throws(function InvokeFailingEntityCallback() {
	g_vecDocumentationContexts[6].WithTemporaryWeaponEntity(g_LiveWeapon, "m_hOwnerEntity", { Index: 2 }, function ThrowEntityCallbackError() {
		throw new Error("entity callback failure");
	});
}, /entity callback failure/, "entity workflow propagates callback errors");
g_Assert.equal(g_mapWeaponState.get(10).Properties.m_hOwnerEntity, 1, "entity workflow restores owner after errors");

const g_TemporaryStringValues = g_vecDocumentationContexts[7].WithTemporaryWeaponString(g_LiveWeapon, g_strCustomNameProperty, "Changed", function CopyTemporaryStringValues(StringValues) {
	return { StringArrayValue: StringValues.StringArrayPropertyValue, StringValue: StringValues.StringPropertyValue };
});
g_Assert.deepEqual(g_TemporaryStringValues, { StringArrayValue: "Changed", StringValue: "Changed" }, "string workflow exercises both native names");
g_Assert.equal(g_mapWeaponState.get(10).Properties[g_strCustomNameProperty], "Primary", "string workflow restores text");
g_Assert.throws(function InvokeFailingStringCallback() {
	g_vecDocumentationContexts[7].WithTemporaryWeaponString(g_LiveWeapon, g_strCustomNameProperty, "Failure", function ThrowStringCallbackError() {
		throw new Error("string callback failure");
	});
}, /string callback failure/, "string workflow propagates callback errors");
g_Assert.equal(g_mapWeaponState.get(10).Properties[g_strCustomNameProperty], "Primary", "string workflow restores text after errors");

const g_DropTarget = { X: 10, Y: 20, Z: 30 };
const g_DropVelocity = { X: 1, Y: 2, Z: 3 };
for (const bDropResult of [false, true]) {
	let bFieldsExpired = false;
	const WeaponOwner = {
		get Index() {
			if (bFieldsExpired) {
				throw new Error("The borrowed owner index expired during drop.");
			}

			return 1;
		},
	};
	const NativeWeapon = {
		get Index() {
			if (bFieldsExpired) {
				throw new Error("The borrowed weapon index expired during drop.");
			}

			return g_LiveWeapon.Index;
		},

		GetOwner() {
			return WeaponOwner;
		},

		Drop(DropTarget, DropVelocity) {
			g_Assert.equal(DropTarget, g_DropTarget, "drop expiry scenario preserves target forwarding");
			g_Assert.equal(DropVelocity, g_DropVelocity, "drop expiry scenario preserves velocity forwarding");
			bFieldsExpired = true;

			return bDropResult;
		},
	};
	const WeaponEntityAPI = {
		Weapon(unWeaponIndex) {
			g_Assert.equal(unWeaponIndex, g_LiveWeapon.Index, "drop expiry scenario preserves the selected index");

			return NativeWeapon;
		},
	};
	const Context = RunDocumentationBlock(g_vecDocumentationCodeBlocks[8], 8, WeaponEntityAPI);
	const Report = Context.DropCallerOwnedWeapon(g_LiveWeapon.Index, g_DropTarget, g_DropVelocity);
	g_Assert.deepEqual(Object.assign({}, Report), { WasDropped: bDropResult, OwnerIndex: 1, WeaponIndex: g_LiveWeapon.Index }, "drop report preserves pre-operation identities when borrowed fields expire");
	g_Assert.equal(bFieldsExpired, true, "drop expiry scenario executed the mutation");
}

const g_DropWorkflowResult = g_vecDocumentationContexts[8].DropCallerOwnedWeapon(10, g_DropTarget, g_DropVelocity);
g_Assert.deepEqual({ OwnerIndex: g_DropWorkflowResult.OwnerIndex, WasDropped: g_DropWorkflowResult.WasDropped, WeaponIndex: g_DropWorkflowResult.WeaponIndex }, { OwnerIndex: 1, WasDropped: true, WeaponIndex: 10 }, "drop workflow reports caller-owned weapon state");
g_Assert.equal(g_vecDropCalls.length, g_unDirectDropCallCount + 1, "drop workflow performs exactly one drop operation");
g_Assert.equal(g_vecDropCalls.at(-1).DropTarget, g_DropTarget, "drop workflow forwards the target");
g_Assert.equal(g_vecDropCalls.at(-1).DropVelocity, g_DropVelocity, "drop workflow forwards velocity");

const g_strRestoredWeaponStateJSON = JSON.stringify(Array.from(g_mapWeaponState.entries()));
const g_strRestoredOwnerAmmoStateJSON = JSON.stringify(Array.from(g_mapOwnerAmmoCounts.entries()));
const g_DocumentationPattern = /Generated by|m_iHealth|Weapon\(2\)|const api =/;

g_Assert.equal(g_strRestoredWeaponStateJSON, g_strInitialWeaponState, "documentation workflows restore exact weapon state");
g_Assert.equal(g_strRestoredOwnerAmmoStateJSON, g_strInitialOwnerAmmoState, "documentation workflows restore exact owner ammo");
g_Assert.doesNotMatch(g_strDocumentationSource, /console\.(?:log|warn|error)/, "weapons/entity examples do not depend on console output");
g_Assert.doesNotMatch(g_strDocumentationSource, g_DocumentationPattern, "weapons/entity documentation is hand-maintained");

for (const strExportName of ["Weapon", "GetAmmo", "GetProperty", "GetPropertyEntity", "GetPropertyFloat", "GetPropertyInteger", "GetPropertyString", "GetPropertyStringArray", "SetAmmo", "SetProperty", "SetPropertyEntity", "SetPropertyFloat", "SetPropertyInteger", "SetPropertyString", "SetPropertyStringArray"]) {
	g_Assert.match(g_strDocumentationSource, new RegExp(`\\b${strExportName}\\b`), `documentation covers ${strExportName}`);
}

for (const strMethodName of g_vecWeaponMethods) {
	g_Assert.match(g_strDocumentationSource, new RegExp(`\\b${strMethodName}\\b`), `documentation covers Weapon.${strMethodName}`);
}

for (const strPropertyType of g_vecCanonicalPropertyTypes) {
	g_Assert.match(g_strDocumentationSource, new RegExp(`\\b${strPropertyType}\\b`), `documentation covers property type ${strPropertyType}`);
}

for (const strRelativeLink of ["weapons.md", "weapons-engines.md", "entities-entity.md", "entities-props.md", "players-dropweapon.md"]) {
	g_Assert.equal(g_FileSystem.existsSync(g_Path.join(g_Path.dirname(g_strDocumentationPath), strRelativeLink)), true, `documentation link exists: ${strRelativeLink}`);
}

const g_unMissingRuntimeTimeoutMilliseconds = 5000;
const g_MissingRuntimeResult = g_ChildProcess.spawnSync(process.execPath, ["-e", `require(${JSON.stringify(g_strEntityPath)});`], { encoding: "utf8", timeout: g_unMissingRuntimeTimeoutMilliseconds, env: { ...process.env, NODE_PATH: g_strPackageRootPath } });
g_Assert.equal(g_MissingRuntimeResult.error, undefined, "missing-runtime child starts and completes without timeout");
g_Assert.equal(g_MissingRuntimeResult.signal, null, "missing-runtime child exits without a signal");
g_Assert.equal(g_MissingRuntimeResult.status, 1, "weapons/entity requires the native runtime");
g_Assert.match(g_MissingRuntimeResult.stderr, /SourceJS native runtime is not installed/, "missing runtime error");

console.log("[  OK  ] smoke_weapons_entity");
