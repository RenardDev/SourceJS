#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "weapons-dictionary.md");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strInternalRuntimePath = g_Path.join(g_strPackageRootPath, "internal", "runtime.js");
const g_strBasePath = g_Path.join(g_strPackageRootPath, "weapons", "index.js");
const g_strDictionaryPath = g_Path.join(g_strPackageRootPath, "weapons", "dictionary.js");
const g_strEntitiesDictionaryPath = g_Path.join(g_strPackageRootPath, "entities", "dictionary.js");
const g_strListenersPath = g_Path.join(g_strPackageRootPath, "listeners.js");
const g_vecWeaponIndexes = [7, 9];
const g_unMaximumNativeWeaponIndex = 0x7FFFFFFF;
const g_vecExpectedClassMembers = [
	"clear",
	"CreateMissingEntity",
	"delete",
	"entries",
	"forEach",
	"FromIntegerHandle",
	"get",
	"has",
	"keys",
	"EntityFactoryArguments",
	"NetworkedEntityDeletedListenerRegistered",
	"EntityFactory",
	"NetworkedEntityDeletedCallback",
	"OnAutomaticallyRemoved",
	"OnNetworkedEntityDeleted",
	"set",
	"size",
	"Unload",
	"values",
];

let g_unListenerCount = 0;
let g_unNativeOperationCount = 0;
const g_setDeletionCallbacks = new Set();
const g_DeletionUnregistrationError = new Error("deletion listener unregistration failure");
let g_bFailNextDeletionUnregistration = false;

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
		throw new TypeError("Entity index must be a non-negative safe integer.");
	}

	return IndexValue;
}

function CreateNativeWeapon(unWeaponIndex) {
	if (!g_vecWeaponIndexes.includes(unWeaponIndex)) {
		return null;
	}

	return { Index: unWeaponIndex, IsWeapon: true, Valid: true, Free: false, Name: (unWeaponIndex === 7) ? "rifle" : "pistol" };
}

function ResolveNativeWeaponIndex(WeaponReference) {
	let IndexValue = WeaponReference;
	if ((WeaponReference !== null) && ((typeof WeaponReference === "object") || (typeof WeaponReference === "function"))) {
		IndexValue = WeaponReference.Index;
	}

	if (!Number.isSafeInteger(IndexValue) || (IndexValue < 0) || (IndexValue > g_unMaximumNativeWeaponIndex)) {
		return -1;
	}

	return IndexValue;
}

function RequireNativeWeaponIndex(WeaponReference) {
	const nWeaponIndex = ResolveNativeWeaponIndex(WeaponReference);
	if (nWeaponIndex < 0) {
		throw new TypeError("Native weapon reference must contain a non-negative safe integer within int32 range.");
	}

	return nWeaponIndex;
}

function Weapon(EntityReference) {
	const WeaponReference = CreateNativeWeapon(GetEntityIndex(EntityReference));
	if (WeaponReference) {
		WeaponReference.Decorated = true;
	}

	return WeaponReference;
}

function CreateMarkedWeapon() {
	return {
		Index: 7,
		IsEntityMarkedForDeletion() {
			return true;
		},
	};
}

function CreateFailingWeapon() {
	throw new TypeError("factory failure");
}

const g_NetworkedEntityDeletedManager = {
	RegisterListener(Callback) {
		g_Assert.equal(g_setDeletionCallbacks.has(Callback), false, "deletion callback registration is unique");
		g_setDeletionCallbacks.add(Callback);
		g_unListenerCount = g_setDeletionCallbacks.size;
	},

	UnregisterListener(Callback) {
		if (g_bFailNextDeletionUnregistration) {
			g_bFailNextDeletionUnregistration = false;
			throw g_DeletionUnregistrationError;
		}

		g_Assert.equal(g_setDeletionCallbacks.delete(Callback), true, "deletion callback was registered");
		g_unListenerCount = g_setDeletionCallbacks.size;
	},
};

const g_NativeWeaponDictionary = {
	GetAll() {
		g_unNativeOperationCount += 1;

		const CurrentWeapons = { Count: g_vecWeaponIndexes.length };
		for (const unWeaponIndex of g_vecWeaponIndexes) {
			CurrentWeapons[unWeaponIndex] = CreateNativeWeapon(unWeaponIndex);
		}

		return CurrentWeapons;
	},

	GetEntries() {
		g_unNativeOperationCount += 1;

		const vecCurrentEntries = [];
		for (const unCurrentEntityIndex of g_vecWeaponIndexes) {
			vecCurrentEntries.push([unCurrentEntityIndex, CreateNativeWeapon(unCurrentEntityIndex)]);
		}

		return vecCurrentEntries;
	},

	Get(EntityReference) {
		g_unNativeOperationCount += 1;

		return CreateNativeWeapon(RequireNativeWeaponIndex(EntityReference));
	},

	Has(EntityReference) {
		g_unNativeOperationCount += 1;

		return g_vecWeaponIndexes.includes(ResolveNativeWeaponIndex(EntityReference));
	},

	GetKeys() {
		g_unNativeOperationCount += 1;

		return g_vecWeaponIndexes.slice();
	},

	GetValues() {
		g_unNativeOperationCount += 1;

		const vecCurrentValues = [];
		for (const unCurrentEntityIndex of g_vecWeaponIndexes) {
			vecCurrentValues.push(CreateNativeWeapon(unCurrentEntityIndex));
		}

		return vecCurrentValues;
	},

	GetWeapon(EntityReference) {
		g_unNativeOperationCount += 1;

		return CreateNativeWeapon(RequireNativeWeaponIndex(EntityReference));
	},
};

function LoadWeaponsDictionaryAPI() {
	const SourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
	const ResolverDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_resolveFilename");
	const OriginalResolveFilename = ResolverDescriptor?.value;
	const setPreviousDeletionCallbacks = new Set(g_setDeletionCallbacks);
	const mapCachedModules = new Map();
	for (const strModulePath of Object.getOwnPropertyNames(require.cache)) {
		if (strModulePath.startsWith(g_strPackageRootPath + g_Path.sep)) {
			mapCachedModules.set(strModulePath, Object.getOwnPropertyDescriptor(require.cache, strModulePath));
		}
	}

	g_Assert.ok(SourceJSDescriptor || Object.isExtensible(globalThis), "Weapons/dictionary runtime fixture must support installation.");
	g_Assert.ok(Object.isExtensible(require.cache), "Weapons/dictionary package cache must support exact restoration.");
	g_Assert.ok(!SourceJSDescriptor || SourceJSDescriptor.configurable, "Weapons/dictionary runtime fixture must support exact restoration.");
	g_Assert.ok(ResolverDescriptor && ResolverDescriptor.configurable && (typeof OriginalResolveFilename === "function"), "Weapons/dictionary resolver must support exact restoration.");

	for (const Descriptor of mapCachedModules.values()) {
		g_Assert.equal(Descriptor.configurable, true, "Borrowed weapons/dictionary cache entries must support exact restoration.");
	}

	const RestoreProperty = (Target, strKey, Descriptor) => {
		if (Descriptor) {
			Object.defineProperty(Target, strKey, Descriptor);
			return;
		}

		g_Assert.ok(Reflect.deleteProperty(Target, strKey), "Owned weapons/dictionary fixture property must be removable: " + strKey);
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

		InstallDependency(g_strBasePath, { Weapon });
		InstallDependency(g_strListenersPath, { NetworkedEntityCreatedManager: {}, NetworkedEntityDeletedManager: g_NetworkedEntityDeletedManager });
		Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: true, writable: true, value: { "weapons/dictionary": g_NativeWeaponDictionary, "entities/dictionary": {}, "entities/helpers": { GetEntityIndexFromIntegerHandle: GetEntityIndex } } });
		bSourceJSOwned = true;

		Object.defineProperty(g_Module, "_resolveFilename", {
			...ResolverDescriptor,
			writable: true,
			value: function ResolveFilename(strRequest, Parent, bIsMain, Options) {
				if (strRequest === "listeners") {
					return g_strListenersPath;
				}

				if (strRequest === "entities/dictionary") {
					return g_strEntitiesDictionaryPath;
				}

				if (strRequest === "internal/runtime") {
					return g_strInternalRuntimePath;
				}

				if (strRequest === "weapons") {
					return g_strBasePath;
				}

				return OriginalResolveFilename.call(this, strRequest, Parent, bIsMain, Options);
			},
		});
		bResolverOwned = true;

		const WeaponsDictionaryAPI = require(g_strDictionaryPath);
		const { ENTITY_DICTIONARY, EntityDictionary } = require(g_strEntitiesDictionaryPath);
		g_Assert.equal(ENTITY_DICTIONARY.Unload(), true, "test context releases the base module's default dictionary listener");

		Result = { WeaponsDictionaryAPI, EntityDictionary };
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

		// Partial module initialization can register a mock listener before require() fails.
		for (const Callback of g_setDeletionCallbacks) {
			if (!setPreviousDeletionCallbacks.has(Callback)) {
				AttemptRestoration(() => g_Assert.equal(g_setDeletionCallbacks.delete(Callback), true, "Owned dictionary listener must be removable."));
			}
		}

		for (const Callback of setPreviousDeletionCallbacks) {
			if (!g_setDeletionCallbacks.has(Callback)) {
				AttemptRestoration(() => g_setDeletionCallbacks.add(Callback));
			}
		}

		g_unListenerCount = g_setDeletionCallbacks.size;

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

			throw new AggregateError(vecFailures, "Weapons/dictionary fixture restoration failed.");
		}
	}

	if (bFailed) {
		throw Failure;
	}

	return Result;
}

const { WeaponsDictionaryAPI: g_WeaponsDictionaryAPI, EntityDictionary } = LoadWeaponsDictionaryAPI();
g_Assert.equal(g_WeaponsDictionaryAPI, g_NativeWeaponDictionary, "weapons/dictionary exposes the exact native object");
g_Assert.deepEqual(Object.keys(g_WeaponsDictionaryAPI).sort(), [
	"Get",
	"GetAll",
	"GetEntries",
	"GetKeys",
	"GetValues",
	"GetWeapon",
	"Has",
	"WeaponDictionary",
], "exact weapons/dictionary exports");

const g_WeaponDictionaryDescriptor = Object.getOwnPropertyDescriptor(g_WeaponsDictionaryAPI, "WeaponDictionary");
g_Assert.equal(g_WeaponDictionaryDescriptor.configurable, false, "WeaponDictionary export is non-configurable");
g_Assert.equal(g_WeaponDictionaryDescriptor.enumerable, true, "WeaponDictionary export is enumerable");
g_Assert.equal(g_WeaponDictionaryDescriptor.value, g_WeaponsDictionaryAPI.WeaponDictionary, "WeaponDictionary descriptor identity");
g_Assert.equal(g_WeaponDictionaryDescriptor.writable, false, "WeaponDictionary export is non-writable");

const g_CurrentWeapons = g_WeaponsDictionaryAPI.GetAll();
const g_vecNativeValueIndexes = [];
const g_vecNativeEntryIndexes = [];

for (const Weapon of g_WeaponsDictionaryAPI.GetValues()) {
	g_vecNativeValueIndexes.push(Weapon.Index);
}

for (const [unCurrentEntityIndex] of g_WeaponsDictionaryAPI.GetEntries()) {
	g_vecNativeEntryIndexes.push(unCurrentEntityIndex);
}

g_Assert.equal(g_CurrentWeapons.Count, 2, "current native weapon count");
g_Assert.equal(g_CurrentWeapons[7].Name, "rifle", "current native weapon");
g_Assert.deepEqual(g_WeaponsDictionaryAPI.GetKeys(), g_vecWeaponIndexes, "native dictionary keys");
g_Assert.deepEqual(g_vecNativeValueIndexes, g_vecWeaponIndexes, "native dictionary values");
g_Assert.deepEqual(g_vecNativeEntryIndexes, g_vecWeaponIndexes, "native dictionary entries");
g_Assert.equal(g_WeaponsDictionaryAPI.Get(7).Index, 7, "native dictionary get");
g_Assert.equal(g_WeaponsDictionaryAPI.Get(8), null, "native dictionary missing get");
g_Assert.equal(g_WeaponsDictionaryAPI.Has(7), true, "native dictionary has");
g_Assert.equal(g_WeaponsDictionaryAPI.Has(8), false, "native dictionary missing has");
g_Assert.equal(g_WeaponsDictionaryAPI.Has("invalid"), false, "native dictionary has permissively rejects malformed values");
g_Assert.equal(g_WeaponsDictionaryAPI.GetWeapon(9).Index, 9, "native weapon factory");
g_Assert.throws(function GetWithoutIndex() {
	g_WeaponsDictionaryAPI.Get();
}, /non-negative safe integer/, "native dictionary get requires an index");
g_Assert.throws(function CreateWeaponWithNegativeIndex() {
	g_WeaponsDictionaryAPI.GetWeapon(-1);
}, /non-negative safe integer/, "native weapon factory rejects a negative index");
g_Assert.throws(function ConstructWithInvalidFactory() {
	new g_WeaponsDictionaryAPI.WeaponDictionary({});
}, /factory must be a function or null/, "dictionary constructor validates the factory");

const g_mapDefaultWeapons = new g_WeaponsDictionaryAPI.WeaponDictionary();
g_Assert.ok(g_mapDefaultWeapons instanceof EntityDictionary, "WeaponDictionary extends EntityDictionary");
g_Assert.ok(g_mapDefaultWeapons instanceof Map, "weapon dictionary instances retain the Map representation category");
g_Assert.equal(g_mapDefaultWeapons.EntityFactory, Weapon, "default canonical Weapon factory");
g_Assert.equal(g_mapDefaultWeapons.size, 0, "new dictionary starts empty");

const g_FirstWeapon = g_mapDefaultWeapons.get(7);
g_Assert.equal(g_FirstWeapon.Decorated, true, "default factory returns decorated weapons");
g_Assert.equal(g_mapDefaultWeapons.get(7), g_FirstWeapon, "dictionary caches one object per index");
g_Assert.equal(g_mapDefaultWeapons.has(7), true, "local cache membership");
g_Assert.deepEqual(Array.from(g_mapDefaultWeapons.keys()), [7], "local cache keys");
g_Assert.equal(g_mapDefaultWeapons.FromIntegerHandle(7), g_FirstWeapon, "integer-handle lookup");
g_Assert.equal(g_mapDefaultWeapons.OnNetworkedEntityDeleted({ Index: 7 }), true, "automatic eviction result");
g_Assert.equal(g_mapDefaultWeapons.has(7), false, "automatic eviction removes the cache entry");
g_Assert.equal(g_mapDefaultWeapons.Unload(), true, "first unload unregisters the listener");
g_Assert.equal(g_mapDefaultWeapons.Unload(), false, "second unload is idempotent");

const g_mapNullFactoryWeapons = new g_WeaponsDictionaryAPI.WeaponDictionary(null, "first", "second");
g_Assert.equal(g_mapNullFactoryWeapons.EntityFactory, null, "explicit null factory");
g_Assert.deepEqual(g_mapNullFactoryWeapons.EntityFactoryArguments, ["first", "second"], "factory arguments");
g_Assert.throws(function GetMissingManualWeapon() {
	g_mapNullFactoryWeapons.get(7);
}, /not cached/, "null factory rejects cache misses");
g_mapNullFactoryWeapons.set(7, { Index: 7 });
g_Assert.equal(g_mapNullFactoryWeapons.get(7).Index, 7, "null factory can read manually cached values");
g_Assert.equal(g_mapNullFactoryWeapons.Unload(), true, "manual dictionary cleanup unregisters its listener");

const g_mapMarkedWeapons = new g_WeaponsDictionaryAPI.WeaponDictionary(CreateMarkedWeapon);
const g_MarkedWeapon = g_mapMarkedWeapons.CreateMissingEntity(7);
g_Assert.equal(g_MarkedWeapon.Index, 7, "marked factory result is returned");
g_Assert.equal(g_mapMarkedWeapons.has(7), false, "marked factory result is not cached");
g_Assert.equal(g_mapMarkedWeapons.Unload(), true, "marked dictionary cleanup unregisters its listener");

const g_mapFailingWeapons = new g_WeaponsDictionaryAPI.WeaponDictionary(CreateFailingWeapon);
let g_FactoryError = null;

try {
	g_mapFailingWeapons.get(9);
} catch (ErrorValue) {
	g_FactoryError = ErrorValue;
}

g_Assert.match(g_FactoryError.message, /Unable to create entity for index 9: factory failure/, "factory errors include index context");
g_Assert.equal(g_FactoryError.cause.message, "factory failure", "factory errors retain their cause");
g_Assert.equal(g_mapFailingWeapons.has(9), false, "factory errors leave no cache entry");
g_Assert.equal(g_mapFailingWeapons.Unload(), true, "failing factory dictionary cleanup unregisters its listener");

const g_mapThrowingEvictionWeapons = new g_WeaponsDictionaryAPI.WeaponDictionary();
g_mapThrowingEvictionWeapons.get(7);
g_mapThrowingEvictionWeapons.OnAutomaticallyRemoved = function ThrowEvictionError() {
	throw new Error("eviction failure");
};
g_Assert.throws(function InvokeThrowingEvictionHook() {
	g_mapThrowingEvictionWeapons.OnNetworkedEntityDeleted(7);
}, /eviction failure/, "eviction hook errors propagate");
g_Assert.equal(g_mapThrowingEvictionWeapons.has(7), false, "eviction hook errors still remove the cache entry");
g_Assert.equal(g_mapThrowingEvictionWeapons.Unload(), true, "throwing eviction dictionary cleanup unregisters its listener");

for (const MarkerValue of [undefined, null, 0, 1, "false", {}, [], 0n]) {
	const mapWeapons = new g_WeaponsDictionaryAPI.WeaponDictionary(function CreateInvalidMarkerWeapon() {
		return {
			Index: 7,
			IsEntityMarkedForDeletion() {
				return MarkerValue;
			},
		};
	});

	try {
		g_Assert.throws(function ResolveInvalidMarkerWeapon() {
			mapWeapons.get(7);
		}, /must return a boolean/, "real base class rejects non-boolean deletion markers");
		g_Assert.equal(mapWeapons.has(7), false, "invalid markers never enter the real cache");
	} finally {
		g_Assert.equal(mapWeapons.Unload(), true, "invalid-marker dictionary cleanup unregisters its listener");
	}
}

for (const IndexValue of [undefined, null, -1, 1.5, NaN, Infinity, 0n, "7", g_unMaximumNativeWeaponIndex + 1]) {
	g_Assert.equal(g_WeaponsDictionaryAPI.Has(IndexValue), false, "native double rejects invalid index values without coercion");
	g_Assert.throws(function GetInvalidNativeIndex() {
		g_WeaponsDictionaryAPI.Get(IndexValue);
	}, /int32/, "native double rejects invalid direct Get indexes");
	g_Assert.throws(function GetInvalidNativeWeaponFactoryIndex() {
		g_WeaponsDictionaryAPI.GetWeapon({ Index: IndexValue });
	}, /int32/, "native double rejects invalid factory indexes");
}

for (const ErrorValue of [new Error("index getter failure"), false, null, 0, undefined]) {
	const WeaponReference = {
		get Index() {
			throw ErrorValue;
		},
	};
	for (const strMethodName of ["Get", "GetWeapon", "Has"]) {
		g_Assert.throws(function InvokeThrowingIndexGetter() {
			g_WeaponsDictionaryAPI[strMethodName](WeaponReference);
		}, function IsOriginalIndexGetterError(ThrownValue) {
			return ThrownValue === ErrorValue;
		}, "native double preserves throwing Index getters, including falsy values");
	}
}

g_Assert.equal(g_unListenerCount, 0, "direct test dictionaries release listeners");

const g_IndexedFunctionWeaponReference = function IndexedWeaponReference() {
};
g_IndexedFunctionWeaponReference.Index = 7;
g_Assert.equal(g_WeaponsDictionaryAPI.Get(g_IndexedFunctionWeaponReference).Index, 7, "native double accepts indexed function objects");
g_Assert.equal(g_WeaponsDictionaryAPI.GetWeapon(g_IndexedFunctionWeaponReference).Index, 7, "native factory double accepts indexed function objects");
g_Assert.equal(g_WeaponsDictionaryAPI.Has(g_IndexedFunctionWeaponReference), true, "native membership double accepts indexed function objects");

const g_mapRetryUnloadWeapons = new g_WeaponsDictionaryAPI.WeaponDictionary();
g_bFailNextDeletionUnregistration = true;
g_Assert.throws(function UnloadAfterListenerFailure() {
	g_mapRetryUnloadWeapons.Unload();
}, function IsOriginalListenerError(ErrorValue) {
	return ErrorValue === g_DeletionUnregistrationError;
}, "real base class propagates listener unregistration failures");
g_Assert.equal(g_mapRetryUnloadWeapons.NetworkedEntityDeletedListenerRegistered, true, "failed unregistration retains real base ownership state");
g_Assert.equal(g_setDeletionCallbacks.has(g_mapRetryUnloadWeapons.NetworkedEntityDeletedCallback), true, "failed unregistration retains its callback");
g_Assert.equal(g_mapRetryUnloadWeapons.Unload(), true, "real base class retries failed unregistration");
g_Assert.equal(g_mapRetryUnloadWeapons.Unload(), false, "successful retry remains idempotent");
g_Assert.equal(g_unListenerCount, 0, "real base class retry releases the last listener");

const g_mapWideManualWeapons = new g_WeaponsDictionaryAPI.WeaponDictionary(null);
const g_unWideManualIndex = g_unMaximumNativeWeaponIndex + 1;
const g_WideManualRecord = { Index: g_unWideManualIndex };
try {
	g_mapWideManualWeapons.set(g_unWideManualIndex, g_WideManualRecord);
	g_Assert.equal(g_mapWideManualWeapons.get(g_unWideManualIndex), g_WideManualRecord, "real JavaScript cache accepts safe keys outside native int32 range");
	g_Assert.equal(g_mapWideManualWeapons.has({ Index: g_unWideManualIndex }), true, "real JavaScript cache normalizes wide indexed objects");
	g_Assert.throws(function ResolveFunctionObjectCacheKey() {
		g_mapWideManualWeapons.has(g_IndexedFunctionWeaponReference);
	}, /non-negative safe integer/, "real JavaScript cache does not normalize function objects");
} finally {
	g_Assert.equal(g_mapWideManualWeapons.Unload(), true, "wide-key dictionary cleanup unregisters its listener");
}

for (const strForbiddenExport of ["Weapon", "weaponDictionary", "moduleName", "runtime", "default"]) {
	g_Assert.equal(Object.hasOwn(g_WeaponsDictionaryAPI, strForbiddenExport), false, `forbidden export is absent: ${strForbiddenExport}`);
}

const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
g_Assert.match(g_strDocumentation, /returned containers do not refresh their membership/, "documentation distinguishes container membership from live native weapon fields");
g_Assert.match(g_strDocumentation, /method must return a boolean/, "documentation states the real deletion-marker contract");
g_Assert.match(g_strDocumentation, /GetEntityIndexFromIntegerHandle/, "documentation uses the current handle resolver");
g_Assert.doesNotMatch(g_strDocumentation, /GetEntityIndexFromIntHandle/, "documentation does not teach the obsolete handle resolver");
g_Assert.match(g_strDocumentation, /Has\(WeaponReference\)` is not an exception barrier/, "documentation preserves the native getter error contract");
g_Assert.match(g_strDocumentation, /leaves the registration flag set for retry/, "documentation states failed unregistration ownership");
g_Assert.match(g_strDocumentation, /cache-key range is wider than the native int32 index range/, "documentation distinguishes JavaScript cache keys from native indexes");

const g_CodeBlockPattern = /```js\r?\n([\s\S]*?)```/g;
const g_vecCodeBlocks = [];
const g_unDocumentationTimeoutMilliseconds = 1000;
let g_vecCodeBlockMatch = g_CodeBlockPattern.exec(g_strDocumentation);

function RequireDocumentationModule(strIdentifier) {
	if (strIdentifier === "weapons/dictionary") {
		return g_WeaponsDictionaryAPI;
	}

	if (strIdentifier === "weapons/entity") {
		return { Weapon };
	}

	throw new Error(`Unexpected documentation import: ${strIdentifier}`);
}

function RunDocumentationBlock(strDocumentationCode, unDocumentationBlockIndex) {
	const Context = g_VM.createContext({ require: RequireDocumentationModule });
	const unListenerCountBefore = g_unListenerCount;
	const unNativeOperationCountBefore = g_unNativeOperationCount;

	g_VM.runInContext(strDocumentationCode, Context, { filename: `${g_strDocumentationPath}#example-${unDocumentationBlockIndex + 1}`, timeout: g_unDocumentationTimeoutMilliseconds });

	g_Assert.equal(g_unListenerCount, unListenerCountBefore, `documentation block ${unDocumentationBlockIndex + 1} registers no listener while loading`);
	g_Assert.equal(g_unNativeOperationCount, unNativeOperationCountBefore, `documentation block ${unDocumentationBlockIndex + 1} avoids native work`);

	return Context;
}

while (g_vecCodeBlockMatch !== null) {
	g_vecCodeBlocks.push(g_vecCodeBlockMatch[1]);
	g_vecCodeBlockMatch = g_CodeBlockPattern.exec(g_strDocumentation);
}

g_Assert.equal(g_vecCodeBlocks.length, 6, "all weapons/dictionary documentation JavaScript blocks are present");

const g_vecDocumentedMapBindings = g_vecCodeBlocks.flatMap(strCodeBlock => [...strCodeBlock.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+(?:WeaponDictionary|AuditedWeaponDictionary)\s*\(/g)].map(vecMatch => vecMatch[1]));
g_Assert.equal(g_vecDocumentedMapBindings.length, 4, "all four documented Map-derived dictionary bindings are checked");

for (const strDictionaryBinding of g_vecDocumentedMapBindings) {
	g_Assert.match(strDictionaryBinding, /^map[A-Z]/, "Map-derived documentation bindings use map plus a PascalCase role");
}

const g_vecDocumentationContexts = [];
for (let unDocumentationBlockIndex = 0; unDocumentationBlockIndex < g_vecCodeBlocks.length; unDocumentationBlockIndex += 1) {
	g_vecDocumentationContexts.push(RunDocumentationBlock(g_vecCodeBlocks[unDocumentationBlockIndex], unDocumentationBlockIndex));
}

const g_CurrentDictionary = g_vecDocumentationContexts[1].InspectCurrentWeaponDictionary(7);
const g_vecCurrentDictionaryValueIndexes = [];
const g_vecCurrentDictionaryEntryIndexes = [];

for (const Weapon of g_CurrentDictionary.CurrentWeaponValues) {
	g_vecCurrentDictionaryValueIndexes.push(Weapon.Index);
}

for (const [unCurrentEntityIndex] of g_CurrentDictionary.CurrentWeaponEntries) {
	g_vecCurrentDictionaryEntryIndexes.push(unCurrentEntityIndex);
}

g_Assert.equal(g_CurrentDictionary.WeaponCount, 2, "native workflow returns the current weapon count");
g_Assert.equal(g_CurrentDictionary.CurrentWeaponsByIndex[7].Name, "rifle", "native workflow returns current weapons");
g_Assert.deepEqual(g_CurrentDictionary.CurrentWeaponIndexes, g_vecWeaponIndexes, "native workflow returns current keys");
g_Assert.deepEqual(g_vecCurrentDictionaryValueIndexes, g_vecWeaponIndexes, "native workflow returns current values");
g_Assert.deepEqual(g_vecCurrentDictionaryEntryIndexes, g_vecWeaponIndexes, "native workflow returns current entries");
g_Assert.equal(g_CurrentDictionary.SelectedWeapon.Present, true, "native workflow checks current membership");
g_Assert.equal(g_CurrentDictionary.SelectedWeapon.FromGet.Index, 7, "native workflow resolves through Get");
g_Assert.equal(g_CurrentDictionary.SelectedWeapon.FromFactory.Index, 7, "native workflow resolves through GetWeapon");

const g_MissingCurrentWeapon = g_vecDocumentationContexts[1].InspectCurrentWeaponDictionary(8);
g_Assert.equal(g_MissingCurrentWeapon.SelectedWeapon.Present, false, "native workflow preserves missing membership");
g_Assert.equal(g_MissingCurrentWeapon.SelectedWeapon.FromGet, null, "native workflow preserves missing get");
g_Assert.equal(g_MissingCurrentWeapon.SelectedWeapon.FromFactory, null, "native workflow preserves missing factory result");

const g_LazyCache = g_vecDocumentationContexts[2].InspectLazyWeaponCache(7);
const g_vecLazyCacheKeys = Array.from(g_LazyCache.KeyIndexes);
const g_vecLazyCacheValues = Array.from(g_LazyCache.ValueIndexes);
const g_vecLazyCacheEntries = [];
const g_vecLazyCacheIterated = [];

for (const [unCurrentEntityIndex, unCurrentWeaponIndex] of g_LazyCache.EntryIndexes) {
	g_vecLazyCacheEntries.push([unCurrentEntityIndex, unCurrentWeaponIndex]);
}

for (const [unCurrentEntityIndex, unCurrentWeaponIndex] of g_LazyCache.IteratedIndexes) {
	g_vecLazyCacheIterated.push([unCurrentEntityIndex, unCurrentWeaponIndex]);
}

g_Assert.equal(g_LazyCache.CallbackBound, true, "lazy-cache workflow observes the bound callback");
g_Assert.equal(g_LazyCache.FactoryArgumentCount, 0, "lazy-cache workflow observes default factory arguments");
g_Assert.equal(g_LazyCache.FactoryType, "function", "lazy-cache workflow observes the default factory");
g_Assert.equal(g_LazyCache.HasWeaponIndex, true, "lazy-cache workflow caches the requested index");
g_Assert.equal(g_LazyCache.ListenerRegistered, true, "lazy-cache workflow observes listener ownership before teardown");
g_Assert.equal(g_LazyCache.ListenerRemoved, true, "lazy-cache workflow releases its listener");
g_Assert.equal(g_LazyCache.SameIdentity, true, "lazy-cache workflow returns one identity per index");
g_Assert.equal(g_LazyCache.Size, 1, "lazy-cache workflow reports local size");
g_Assert.deepEqual(g_vecLazyCacheKeys, [7], "lazy-cache workflow returns local keys");
g_Assert.deepEqual(g_vecLazyCacheValues, [7], "lazy-cache workflow returns local values");
g_Assert.deepEqual(g_vecLazyCacheEntries, [[7, 7]], "lazy-cache workflow returns local entries");
g_Assert.deepEqual(g_vecLazyCacheIterated, [[7, 7]], "lazy-cache workflow uses the Map iterator");
g_Assert.equal(g_unListenerCount, 0, "lazy-cache workflow leaves no listener");

const g_TrackedWeapon = g_vecDocumentationContexts[3].WithTrackedWeapon(9, "tracked", function SummarizeTrackedWeapon(TrackedWeaponState) {
	return { Cached: TrackedWeaponState.Cached, Decorated: TrackedWeaponState.TrackedWeapon.Weapon.Decorated, FactoryArguments: Array.from(TrackedWeaponState.FactoryArguments), Index: TrackedWeaponState.TrackedWeapon.Index, Label: TrackedWeaponState.TrackedWeapon.Label, SameIdentity: TrackedWeaponState.SameIdentity };
});
g_Assert.deepEqual(g_TrackedWeapon, { Cached: true, Decorated: true, FactoryArguments: ["tracked"], Index: 9, Label: "tracked", SameIdentity: true }, "custom-factory workflow invokes the factory with retained arguments");
g_Assert.throws(function InvokeTrackedWeaponWithoutCallback() {
	g_vecDocumentationContexts[3].WithTrackedWeapon(9, "tracked", null);
}, /expects a callback function/, "custom-factory workflow validates callbacks before construction");
g_Assert.throws(function InvokeThrowingTrackedWeaponCallback() {
	g_vecDocumentationContexts[3].WithTrackedWeapon(9, "tracked", function ThrowTrackedWeaponCallbackError() {
		throw new Error("callback failure");
	});
}, /callback failure/, "custom-factory workflow propagates callback errors");
g_Assert.equal(g_unListenerCount, 0, "custom-factory workflow releases listeners on every path");

const g_ManualCache = g_vecDocumentationContexts[4].InspectManualWeaponCache([{ Index: 7, Name: "rifle" }, { Index: 9, Name: "pistol" }], 7);
const g_vecRemainingManualEntries = [];
const g_vecVisitedManualEntries = [];

for (const [unCurrentEntityIndex, WeaponRecord] of g_ManualCache.RemainingWeaponEntries) {
	g_vecRemainingManualEntries.push([unCurrentEntityIndex, WeaponRecord.Name]);
}

for (const [unCurrentEntityIndex, strCurrentWeaponName] of g_ManualCache.VisitedWeaponEntries) {
	g_vecVisitedManualEntries.push([unCurrentEntityIndex, strCurrentWeaponName]);
}

g_Assert.equal(g_ManualCache.WeaponRemoved, true, "manual-cache workflow deletes a selected entry");
g_Assert.equal(g_ManualCache.SelectedWeaponRecord.Name, "rifle", "manual-cache workflow reads a manually cached value");
g_Assert.equal(g_ManualCache.SizeAfterClear, 0, "manual-cache workflow clears local state");
g_Assert.deepEqual(g_vecRemainingManualEntries, [[9, "pistol"]], "manual-cache workflow reports remaining entries");
g_Assert.deepEqual(g_vecVisitedManualEntries, [[7, "rifle"], [9, "pistol"]], "manual-cache workflow uses Map forEach");
g_Assert.throws(function InspectManualCacheWithInvalidIndex() {
	g_vecDocumentationContexts[4].InspectManualWeaponCache([{ Index: -1, Name: "invalid" }], -1);
}, /expects non-negative safe weapon indexes/, "manual-cache workflow validates inherited Map keys");
g_Assert.equal(g_unListenerCount, 0, "manual-cache workflow releases listeners on every path");

const g_WeaponEviction = g_vecDocumentationContexts[5].ResolveAndEvictWeaponHandle(9);
g_Assert.equal(g_WeaponEviction.WeaponIndex, 9, "eviction workflow resolves an integer handle");
g_Assert.equal(g_WeaponEviction.WeaponRemoved, true, "eviction workflow reports a cached removal");
g_Assert.deepEqual(Array.from(g_WeaponEviction.RemovedWeaponIndexes), [9], "eviction workflow invokes the subclass hook");
g_Assert.equal(g_WeaponEviction.StillCached, false, "eviction workflow removes the cached index");
g_Assert.equal(g_unListenerCount, 0, "eviction workflow releases its listener");
g_Assert.doesNotMatch(g_strDocumentation, /console\.(?:log|warn|error)/, "weapons/dictionary examples do not depend on console output");
g_Assert.doesNotMatch(g_strDocumentation, /Generated by|get\(filePath|has\(branch|const api =/, "documentation is hand-maintained");
g_Assert.doesNotMatch(g_strDocumentation, /\bsnapshot\b/i, "weapons/dictionary documentation avoids snapshot terminology");
g_Assert.doesNotMatch(g_strDocumentation, /\bdeleted(?:Callback|ListenerRegistered)\b/, "documentation uses exact lifecycle fields");

for (const strExportName of Object.keys(g_WeaponsDictionaryAPI)) {
	g_Assert.match(g_strDocumentation, new RegExp(`\\b${strExportName}\\b`), `documentation covers ${strExportName}`);
}

for (const strMemberName of g_vecExpectedClassMembers) {
	g_Assert.match(g_strDocumentation, new RegExp(`\\b${strMemberName}\\b`), `documentation covers WeaponDictionary.${strMemberName}`);
}

g_Assert.match(g_strDocumentation, /Symbol\.iterator/, "documentation covers WeaponDictionary[Symbol.iterator]");

for (const strRelativeLink of ["entities-dictionary.md", "entities-helpers.md", "listeners.md", "weapons-entity.md", "weapons.md"]) {
	g_Assert.equal(g_FileSystem.existsSync(g_Path.join(g_Path.dirname(g_strDocumentationPath), strRelativeLink)), true, `documentation link exists: ${strRelativeLink}`);
}

const g_unMissingRuntimeTimeoutMilliseconds = 5000;
const g_MissingRuntimeResult = g_ChildProcess.spawnSync(process.execPath, ["-e", `require(${JSON.stringify(g_strDictionaryPath)});`], { encoding: "utf8", timeout: g_unMissingRuntimeTimeoutMilliseconds, env: { ...process.env, NODE_PATH: g_strPackageRootPath } });
g_Assert.equal(g_MissingRuntimeResult.error, undefined, "missing-runtime child starts and completes without timeout");
g_Assert.equal(g_MissingRuntimeResult.signal, null, "missing-runtime child exits without a signal");
g_Assert.equal(g_MissingRuntimeResult.status, 1, "weapons/dictionary requires the native runtime");
g_Assert.match(g_MissingRuntimeResult.stderr, /SourceJS native runtime is not installed/, "missing runtime error");

console.log("[  OK  ] smoke_weapons_dictionary");
