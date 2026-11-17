#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "weapons-scripts.md");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strFilesystemPath = g_Path.join(g_strPackageRootPath, "filesystem.js");
const g_strKeyValuesPath = g_Path.join(g_strPackageRootPath, "keyvalues.js");
const g_strPathsPath = g_Path.join(g_strPackageRootPath, "paths.js");
const g_strScriptsPath = g_Path.join(g_strPackageRootPath, "weapons", "scripts.js");
const g_strRuntimePath = g_Path.join(g_strPackageRootPath, "internal", "runtime.js");
const g_unVMTimeoutMilliseconds = 1000;
const g_unChildTimeoutMilliseconds = 5000;

const g_ModulePathByRequest = {
	filesystem: g_strFilesystemPath,
	keyvalues: g_strKeyValuesPath,
	paths: g_strPathsPath,
	"internal/runtime": g_strRuntimePath,
};
const g_vecFilesystemCallLog = [];
const g_vecKeyValuesCallLog = [];
const g_vecKeyValuesInstances = [];
const g_vecNativeCallLog = [];
const g_setExistingFiles = new Set(["c:/game/scripts/weapon_rifle.txt"]);
const g_setOriginalExistingFiles = new Set(g_setExistingFiles);
const g_vecIntegrationNativeHandles = [];
let g_bIntegrationLoadSucceeds = true;
const g_IntegrationCleanup = { ScriptsAPI: null, OriginalRoot: null };

function InstallDependency(strPathName, ModuleExports) {
	delete require.cache[strPathName];
	require.cache[strPathName] = { children: [], exports: ModuleExports, filename: strPathName, id: strPathName, loaded: true, paths: [] };
}

class KeyValues {
	constructor(strFilePath) {
		this.DestroyError = null;
		this.DestroyResult = true;
		this.FilePath = strFilePath;
		this.IntegerValues = new Map([["Damage", 42]]);
		this.Destroyed = false;
	}

	static CreateKeyValuesFromFile(strFilePath) {
		g_vecKeyValuesCallLog.push(["CreateKeyValuesFromFile", strFilePath]);

		const KeyValuesObject = new KeyValues(strFilePath);
		g_vecKeyValuesInstances.push(KeyValuesObject);

		return KeyValuesObject;
	}

	DestroyKeyValues() {
		if (this.DestroyError) {
			throw this.DestroyError;
		}

		if (this.Destroyed) {
			throw new Error(`KeyValues already destroyed: ${this.FilePath}`);
		}

		g_vecKeyValuesCallLog.push(["DestroyKeyValues", this.FilePath]);
		this.Destroyed = this.DestroyResult;

		return this.DestroyResult;
	}

	GetKeyValuesInteger(strKeyName, nDefaultValue = 0) {
		if (this.Destroyed) {
			throw new Error(`KeyValues is destroyed: ${this.FilePath}`);
		}

		g_vecKeyValuesCallLog.push(["GetKeyValuesInteger", this.FilePath, strKeyName, nDefaultValue]);

		if (!this.IntegerValues.has(strKeyName)) {
			return nDefaultValue;
		}

		return this.IntegerValues.get(strKeyName);
	}
}

const g_NativeWeaponsScripts = {
	GetClasses() {
		g_vecNativeCallLog.push(["GetClasses"]);

		return ["weapon_rifle", "weapon_missing"];
	},

	GetNames() {
		g_vecNativeCallLog.push(["GetNames"]);

		return ["rifle", "missing"];
	},
};

function LoadWeaponsScriptsAPI(strGameRoot = "c:/game") {
	const SourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
	const LoaderDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");
	const OriginalModuleLoad = LoaderDescriptor?.value;
	const strPackagePathPrefix = `${g_strPackageRootPath}${g_Path.sep}`;
	const mapOriginalPackageCache = new Map(Object.getOwnPropertyNames(require.cache).filter(strCachedPath => strCachedPath.startsWith(strPackagePathPrefix)).map(strCachedPath => [strCachedPath, Object.getOwnPropertyDescriptor(require.cache, strCachedPath)]));
	g_Assert.ok(LoaderDescriptor?.configurable && (typeof OriginalModuleLoad === "function"), "Weapons/scripts loader must support exact restoration.");
	g_Assert.ok(SourceJSDescriptor || Object.isExtensible(globalThis), "Weapons/scripts runtime fixture must support installation.");
	g_Assert.ok(!SourceJSDescriptor || SourceJSDescriptor.configurable, "Weapons/scripts runtime fixture must support exact restoration.");
	g_Assert.ok(Object.isExtensible(require.cache), "Weapons/scripts package cache must support exact restoration.");
	g_Assert.ok(Array.from(mapOriginalPackageCache.values()).every(Descriptor => Descriptor.configurable), "Weapons/scripts cache entries must support exact restoration.");

	function RestoreProperty(Target, strName, Descriptor) {
		if (Descriptor === undefined) {
			g_Assert.equal(Reflect.deleteProperty(Target, strName), true, `Owned weapons/scripts fixture property must be removable: ${strName}`);
			return;
		}

		Object.defineProperty(Target, strName, Descriptor);
	}

	let bCacheOwned = false;
	let bLoaderOwned = false;
	let bRuntimeOwned = false;
	let bFailed = false;
	let Failure = undefined;
	let Result = undefined;
	const vecCleanupFailures = [];
	try {
		bCacheOwned = true;

		for (const strCachedPath of mapOriginalPackageCache.keys()) {
			RestoreProperty(require.cache, strCachedPath, undefined);
		}

		Object.defineProperty(g_Module, "_load", {
			...LoaderDescriptor,
			writable: true,
			value: function LoadModule(strRequest, ParentModule, bIsMain) {
				if (Object.hasOwn(g_ModulePathByRequest, strRequest)) {
					return OriginalModuleLoad.call(this, g_ModulePathByRequest[strRequest], ParentModule, bIsMain);
				}

				return OriginalModuleLoad.call(this, strRequest, ParentModule, bIsMain);
			},
		});
		bLoaderOwned = true;

		InstallDependency(g_strFilesystemPath, {
			DoesFileExist(strFilePath) {
				g_vecFilesystemCallLog.push(strFilePath);

				return g_setExistingFiles.has(strFilePath);
			},
		});
		InstallDependency(g_strKeyValuesPath, { KeyValues });
		InstallDependency(g_strPathsPath, { GAME_ROOT: strGameRoot });

		Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: true, writable: true, value: { "weapons/scripts": g_NativeWeaponsScripts } });
		bRuntimeOwned = true;

		Result = require(g_strScriptsPath);
	} catch (CaughtError) {
		bFailed = true;
		Failure = CaughtError;
	} finally {
		if (bLoaderOwned) {
			try {
				RestoreProperty(g_Module, "_load", LoaderDescriptor);
			} catch (CleanupError) {
				vecCleanupFailures.push(CleanupError);
			}
		}

		if (bRuntimeOwned) {
			try {
				RestoreProperty(globalThis, "sourcejs", SourceJSDescriptor);
			} catch (CleanupError) {
				vecCleanupFailures.push(CleanupError);
			}
		}

		if (bCacheOwned) {
			for (const strCachedPath of Object.getOwnPropertyNames(require.cache)) {
				if (strCachedPath.startsWith(strPackagePathPrefix)) {
					try {
						RestoreProperty(require.cache, strCachedPath, undefined);
					} catch (CleanupError) {
						vecCleanupFailures.push(CleanupError);
					}
				}
			}

			for (const [strCachedPath, Descriptor] of mapOriginalPackageCache) {
				try {
					RestoreProperty(require.cache, strCachedPath, Descriptor);
				} catch (CleanupError) {
					vecCleanupFailures.push(CleanupError);
				}
			}
		}
	}

	if (vecCleanupFailures.length > 0) {
		if (bFailed) {
			vecCleanupFailures.unshift(Failure);
		}

		throw new AggregateError(vecCleanupFailures, "Weapons/scripts fixture cleanup failed.");
	}

	if (bFailed) {
		throw Failure;
	}

	return Result;
}

function CheckPathRoots() {
	const unFileSystemCount = g_vecFilesystemCallLog.length;
	const unKeyValuesCount = g_vecKeyValuesCallLog.length;
	const unNativeCount = g_vecNativeCallLog.length;
	const vecPathCases = [
		{ Root: String.raw`\\SourceJSFixtureServer\FixtureShare\game`, Expected: "//SourceJSFixtureServer/FixtureShare/game/scripts/weapon_rifle.txt" },
		{ Root: "//SourceJSFixtureServer/FixtureShare/game//", Expected: "//SourceJSFixtureServer/FixtureShare/game/scripts/weapon_rifle.txt" },
		{ Root: "c:/game//", Expected: "c:/game/scripts/weapon_rifle.txt" },
		{ Root: "/game//", Expected: "/game/scripts/weapon_rifle.txt" },
	];
	for (const PathCase of vecPathCases) {
		const WeaponsScriptsAPI = LoadWeaponsScriptsAPI(PathCase.Root);
		g_Assert.equal(WeaponsScriptsAPI.GetScriptPath(" RIFLE "), PathCase.Expected, "native root prefix and normalized script path");
	}

	g_Assert.equal(g_vecFilesystemCallLog.length, unFileSystemCount, "root normalization performs no filesystem IO");
	g_Assert.equal(g_vecKeyValuesCallLog.length, unKeyValuesCount, "root normalization loads no KeyValues file");
	g_Assert.equal(g_vecNativeCallLog.length, unNativeCount, "root normalization performs no native scan");
}

try {
	CheckPathRoots();

	const g_WeaponsScriptsAPI = LoadWeaponsScriptsAPI();
	g_Assert.equal(g_vecFilesystemCallLog.length, 0, "module import performs no filesystem check");
	g_Assert.equal(g_vecKeyValuesCallLog.length, 0, "module import loads, reads, and destroys no KeyValues root");
	g_Assert.equal(g_vecNativeCallLog.length, 0, "module import performs no native scan");
	g_Assert.deepEqual(Object.keys(g_WeaponsScriptsAPI).sort(), [
		"ClearCache",
		"GetAll",
		"GetClasses",
		"GetNames",
		"GetScriptPath",
		"Has",
		"Load",
	], "exact weapons/scripts exports");
	g_Assert.equal(g_WeaponsScriptsAPI.GetClasses, g_NativeWeaponsScripts.GetClasses, "direct native classes export");
	g_Assert.equal(g_WeaponsScriptsAPI.GetNames, g_NativeWeaponsScripts.GetNames, "direct native names export");
	g_Assert.deepEqual(g_WeaponsScriptsAPI.GetClasses(), ["weapon_rifle", "weapon_missing"], "native classes result");
	g_Assert.deepEqual(g_WeaponsScriptsAPI.GetNames(), ["rifle", "missing"], "native names result");
	g_Assert.equal(g_WeaponsScriptsAPI.GetScriptPath(" RIFLE "), "c:/game/scripts/weapon_rifle.txt", "short script path normalization");
	g_Assert.equal(g_WeaponsScriptsAPI.GetScriptPath("WEAPON_RIFLE"), "c:/game/scripts/weapon_rifle.txt", "class script path normalization");
	g_Assert.equal(g_WeaponsScriptsAPI.Has("rifle"), true, "existing script");
	g_Assert.equal(g_WeaponsScriptsAPI.Has("missing"), false, "missing script");

	const g_FirstWeaponScriptRecord = g_WeaponsScriptsAPI.Load("rifle");
	const g_SameWeaponScriptRecord = g_WeaponsScriptsAPI.Load(" WEAPON_RIFLE ");
	g_Assert.equal(g_FirstWeaponScriptRecord, g_SameWeaponScriptRecord, "script cache preserves record identity");
	g_Assert.deepEqual(Object.keys(g_FirstWeaponScriptRecord).sort(), ["ClassName", "KeyValues", "Name", "Path"], "exact script record fields");
	g_Assert.equal(g_FirstWeaponScriptRecord.ClassName, "weapon_rifle", "script class name");
	g_Assert.equal(g_FirstWeaponScriptRecord.Name, "rifle", "script short name");
	g_Assert.equal(g_FirstWeaponScriptRecord.Path, "c:/game/scripts/weapon_rifle.txt", "weapon script path");
	g_Assert.ok(g_FirstWeaponScriptRecord.KeyValues instanceof KeyValues, "script data is a native KeyValues handle");
	g_Assert.equal(g_FirstWeaponScriptRecord.KeyValues.GetKeyValuesInteger("Damage", 0), 42, "native KeyValues integer read");

	let g_unCreateKeyValuesFromFileCallCount = 0;
	for (const vecKeyValuesCall of g_vecKeyValuesCallLog) {
		if (vecKeyValuesCall[0] === "CreateKeyValuesFromFile") {
			g_unCreateKeyValuesFromFileCallCount += 1;
		}
	}

	g_Assert.equal(g_unCreateKeyValuesFromFileCallCount, 1, "initial KeyValues.CreateKeyValuesFromFile call count");

	g_Assert.equal(g_setExistingFiles.delete(g_FirstWeaponScriptRecord.Path), true, "cached script fixture source file removal succeeds");
	g_Assert.equal(g_WeaponsScriptsAPI.Has("rifle"), false, "Has observes deletion after caching");
	const g_unFilesystemCallsBeforeCachedLoad = g_vecFilesystemCallLog.length;
	g_Assert.equal(g_WeaponsScriptsAPI.Load("rifle"), g_FirstWeaponScriptRecord, "cached load survives source-file deletion");
	g_Assert.equal(g_vecFilesystemCallLog.length, g_unFilesystemCallsBeforeCachedLoad, "cached load performs no filesystem check");
	g_setExistingFiles.add(g_FirstWeaponScriptRecord.Path);

	const g_vecAllWeaponScriptRecords = g_WeaponsScriptsAPI.GetAll();
	const g_vecSecondAllWeaponScriptRecords = g_WeaponsScriptsAPI.GetAll();
	g_Assert.deepEqual(g_vecAllWeaponScriptRecords, [g_FirstWeaponScriptRecord], "all includes only current classes with files");
	g_Assert.notEqual(g_vecAllWeaponScriptRecords, g_vecSecondAllWeaponScriptRecords, "all returns a fresh array");
	g_Assert.equal(g_vecSecondAllWeaponScriptRecords[0], g_FirstWeaponScriptRecord, "all reuses cached records");

	const g_LoadMissingWeaponScript = function LoadMissingWeaponScript() {
		g_WeaponsScriptsAPI.Load("missing");
	};
	g_Assert.throws(g_LoadMissingWeaponScript, /could not find weapon script/i, "missing script load must throw");

	for (const WeaponScriptName of [7, null, "", "   ", "weapon_", "../cfg/server", "rifle/ak47", "rifle-ak47", "rifle.ak47"]) {
		const ReadInvalidWeaponScriptPath = function ReadInvalidWeaponScriptPath() {
			g_WeaponsScriptsAPI.GetScriptPath(WeaponScriptName);
		};
		g_Assert.throws(ReadInvalidWeaponScriptPath, /non-empty.*string|only letters, digits, and underscores/, "invalid script name must throw");
	}

	g_Assert.equal(g_WeaponsScriptsAPI.ClearCache(), true, "initial ClearCache result");
	g_Assert.equal(g_FirstWeaponScriptRecord.KeyValues.Destroyed, true, "ClearCache destroys native KeyValues handles");

	let g_unDestroyCallCount = 0;
	for (const vecKeyValuesCall of g_vecKeyValuesCallLog) {
		if (vecKeyValuesCall[0] === "DestroyKeyValues") {
			g_unDestroyCallCount += 1;
		}
	}

	g_Assert.equal(g_unDestroyCallCount, 1, "initial KeyValues.DestroyKeyValues call count");

	const g_ReloadedWeaponScriptRecord = g_WeaponsScriptsAPI.Load("rifle");
	g_Assert.notEqual(g_ReloadedWeaponScriptRecord, g_FirstWeaponScriptRecord, "load after clear creates a new record");
	g_Assert.notEqual(g_ReloadedWeaponScriptRecord.KeyValues, g_FirstWeaponScriptRecord.KeyValues, "load after clear creates a new KeyValues root");
	g_Assert.equal(g_ReloadedWeaponScriptRecord.KeyValues.Destroyed, false, "reloaded KeyValues root is live");
	g_ReloadedWeaponScriptRecord.KeyValues.DestroyResult = false;
	g_Assert.equal(g_WeaponsScriptsAPI.ClearCache(), true, "reloaded cache cleanup");
	g_Assert.equal(g_ReloadedWeaponScriptRecord.KeyValues.Destroyed, false, "false destroy result is ignored while clearing the cache");

	const g_WeaponScriptRecordAfterFalseDestroy = g_WeaponsScriptsAPI.Load("rifle");
	g_Assert.notEqual(g_WeaponScriptRecordAfterFalseDestroy, g_ReloadedWeaponScriptRecord, "false destroy result does not preserve the cache entry");
	g_Assert.equal(g_WeaponsScriptsAPI.ClearCache(), true, "record after false destroy cleanup");
	g_Assert.equal(g_WeaponScriptRecordAfterFalseDestroy.KeyValues.Destroyed, true, "record after false destroy is released normally");

	for (const strForbiddenExport of ["parse", "get", "moduleName", "default"]) {
		g_Assert.equal(Object.hasOwn(g_WeaponsScriptsAPI, strForbiddenExport), false, `forbidden export is absent: ${strForbiddenExport}`);
	}

	const g_strDocumentationSource = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
	const g_vecDocumentationCodeBlocks = [];
	for (const vecDocumentationCodeBlockMatch of g_strDocumentationSource.matchAll(/```js\r?\n([\s\S]*?)```/g)) {
		g_vecDocumentationCodeBlocks.push(vecDocumentationCodeBlockMatch[1]);
	}

	const g_RequireDocumentationModule = function RequireDocumentationModule(strModuleIdentifier) {
		if (strModuleIdentifier === "weapons/scripts") {
			return g_WeaponsScriptsAPI;
		}

		throw new Error(`Unexpected documentation import: ${strModuleIdentifier}`);
	};

	g_Assert.equal(g_vecDocumentationCodeBlocks.length, 6, "all weapons/scripts documentation JavaScript blocks are present");

	const g_vecDocumentationModules = [];
	const g_unFilesystemCallsBeforeBlockLoad = g_vecFilesystemCallLog.length;
	const g_unKeyValuesCallsBeforeBlockLoad = g_vecKeyValuesCallLog.length;
	const g_unNativeCallsBeforeBlockLoad = g_vecNativeCallLog.length;
	for (let unDocumentationCodeBlockIndex = 0; unDocumentationCodeBlockIndex < g_vecDocumentationCodeBlocks.length; unDocumentationCodeBlockIndex += 1) {
		const DocumentationModule = { exports: {} };
		g_VM.runInNewContext(g_vecDocumentationCodeBlocks[unDocumentationCodeBlockIndex], { module: DocumentationModule, require: g_RequireDocumentationModule }, { filename: `${g_strDocumentationPath}#example-${unDocumentationCodeBlockIndex + 1}`, timeout: g_unVMTimeoutMilliseconds });

		g_vecDocumentationModules.push(DocumentationModule.exports);
	}

	g_Assert.equal(g_vecFilesystemCallLog.length, g_unFilesystemCallsBeforeBlockLoad, "documentation blocks perform no filesystem work while loading");
	g_Assert.equal(g_vecKeyValuesCallLog.length, g_unKeyValuesCallsBeforeBlockLoad, "documentation blocks perform no KeyValues work while loading");
	g_Assert.equal(g_vecNativeCallLog.length, g_unNativeCallsBeforeBlockLoad, "documentation blocks perform no native scan while loading");

	const g_DocumentedWeaponScriptAvailability = g_vecDocumentationModules[1].InspectWeaponScript(" RIFLE ");
	g_Assert.equal(g_DocumentedWeaponScriptAvailability.Exists, true, "documented availability sees the script");
	g_Assert.equal(g_DocumentedWeaponScriptAvailability.WeaponScriptFilePath, "c:/game/scripts/weapon_rifle.txt", "documented availability path");

	const g_DocumentedWeaponScriptRecord = g_vecDocumentationModules[2].ReadWeaponScript("rifle");
	g_Assert.equal(g_DocumentedWeaponScriptRecord.WeaponClassName, "weapon_rifle", "documented record class name");
	g_Assert.equal(g_DocumentedWeaponScriptRecord.WeaponName, "rifle", "documented record short name");
	g_Assert.equal(g_DocumentedWeaponScriptRecord.WeaponScriptFilePath, "c:/game/scripts/weapon_rifle.txt", "documented record path");
	g_Assert.equal(g_DocumentedWeaponScriptRecord.Damage, 42, "documented record damage");
	g_Assert.ok(g_DocumentedWeaponScriptRecord.KeyValues instanceof KeyValues, "documented record exposes native KeyValues");

	const g_DocumentedWeaponScriptIdentity = g_vecDocumentationModules[3].VerifyWeaponScriptCache("rifle");
	g_Assert.equal(g_DocumentedWeaponScriptIdentity.WeaponClassName, "weapon_rifle", "documented cache identity class name");
	g_Assert.equal(g_DocumentedWeaponScriptIdentity.RecordShared, true, "documented cache record identity");
	g_Assert.equal(g_DocumentedWeaponScriptIdentity.RootShared, true, "documented cache root identity");

	const g_DocumentedWeaponScriptCatalog = g_vecDocumentationModules[4].BuildCurrentWeaponScriptCatalog();
	g_Assert.deepEqual(Array.from(g_DocumentedWeaponScriptCatalog.WeaponClassNames), ["weapon_rifle", "weapon_missing"], "documented catalog live classes");
	g_Assert.deepEqual(Array.from(g_DocumentedWeaponScriptCatalog.WeaponNames), ["rifle", "missing"], "documented catalog live names");
	g_Assert.equal(g_DocumentedWeaponScriptCatalog.WeaponScriptCatalog.length, 1, "documented catalog filters missing scripts");
	g_Assert.equal(g_DocumentedWeaponScriptCatalog.WeaponScriptCatalog[0].WeaponClassName, "weapon_rifle", "documented catalog script class");
	g_Assert.equal(g_DocumentedWeaponScriptCatalog.WeaponScriptCatalog[0].Damage, 42, "documented catalog script damage");
	g_Assert.ok(g_DocumentedWeaponScriptCatalog.WeaponScriptCatalog[0].KeyValues instanceof KeyValues, "documented catalog exposes native KeyValues");

	const g_WeaponScriptRecordBeforeDocumentedRefresh = g_WeaponsScriptsAPI.Load("rifle");
	const g_DocumentedRefreshedWeaponScriptRecord = g_vecDocumentationModules[5].RefreshWeaponScript("rifle");
	g_Assert.notEqual(g_DocumentedRefreshedWeaponScriptRecord, g_WeaponScriptRecordBeforeDocumentedRefresh, "documented refresh creates a new record");
	g_Assert.notEqual(g_DocumentedRefreshedWeaponScriptRecord.KeyValues, g_WeaponScriptRecordBeforeDocumentedRefresh.KeyValues, "documented refresh creates a new root");
	g_Assert.equal(g_WeaponScriptRecordBeforeDocumentedRefresh.KeyValues.Destroyed, true, "documented refresh destroys the previous root");
	g_Assert.equal(g_DocumentedRefreshedWeaponScriptRecord.KeyValues.Destroyed, false, "documented refresh returns a live root");

	g_Assert.equal(g_WeaponsScriptsAPI.ClearCache(), true, "documentation cache cleanup");
	g_Assert.equal(g_DocumentedRefreshedWeaponScriptRecord.KeyValues.Destroyed, true, "documented refreshed root cleanup");

	const g_vecLiveKeyValuesInstances = [];
	for (const KeyValuesInstance of g_vecKeyValuesInstances) {
		if (!KeyValuesInstance.Destroyed) {
			g_vecLiveKeyValuesInstances.push(KeyValuesInstance);
		}
	}

	g_Assert.deepEqual(g_vecLiveKeyValuesInstances, [g_ReloadedWeaponScriptRecord.KeyValues], "only the intentionally false-destroyed root remains live");
	g_Assert.doesNotMatch(g_strDocumentationSource, /Generated by|GetClasses\(\)\[0\]|console\.|const api =|Load\("weapon_pistol"\)/, "weapons/scripts documentation is hand-maintained and action-oriented");
	g_Assert.match(g_strDocumentationSource, /KeyValues\.CreateKeyValuesFromFile\(\)/, "documentation uses the current owning factory");
	g_Assert.match(g_strDocumentationSource, /Calls are synchronous in the plugin's game-thread context/, "documentation states native thread confinement");
	g_Assert.match(g_strDocumentationSource, /Replacing `KeyValues` changes the target of later cleanup/, "documentation warns against root replacement");
	g_Assert.match(g_strDocumentationSource, /Clear and reload are not transactional/, "documentation does not promise rollback during refresh");
	g_Assert.match(g_strDocumentationSource, /`GetAll\(\)` has no rollback/, "documentation states partial catalog-load effects");

	for (const strDocumentationRelativeLink of ["keyvalues.md", "weapons.md", "weapons-data.md", "filesystem.md"]) {
		const strDocumentationLinkPath = g_Path.join(g_Path.dirname(g_strDocumentationPath), strDocumentationRelativeLink);
		g_Assert.equal(g_FileSystem.existsSync(strDocumentationLinkPath), true, `documentation link exists: ${strDocumentationRelativeLink}`);
	}

	g_setExistingFiles.add("c:/game/scripts/weapon_pistol.txt");
	const g_PartialCleanupWeaponsScriptsAPI = LoadWeaponsScriptsAPI();
	const g_PartialCleanupRifleWeaponScriptRecord = g_PartialCleanupWeaponsScriptsAPI.Load("rifle");
	const g_PartialCleanupPistolWeaponScriptRecord = g_PartialCleanupWeaponsScriptsAPI.Load("pistol");

	g_PartialCleanupPistolWeaponScriptRecord.KeyValues.DestroyError = new Error("pistol destroy failed");

	const g_ClearPartialWeaponScriptCache = function ClearPartialWeaponScriptCache() {
		g_PartialCleanupWeaponsScriptsAPI.ClearCache();
	};
	g_Assert.throws(g_ClearPartialWeaponScriptCache, /pistol destroy failed/, "cache cleanup propagates root destruction errors");
	g_Assert.equal(g_PartialCleanupRifleWeaponScriptRecord.KeyValues.Destroyed, true, "partial cleanup destroys earlier roots");
	g_Assert.equal(g_PartialCleanupPistolWeaponScriptRecord.KeyValues.Destroyed, false, "partial cleanup leaves the throwing root live");
	g_Assert.equal(g_PartialCleanupWeaponsScriptsAPI.Load("rifle"), g_PartialCleanupRifleWeaponScriptRecord, "partial cleanup leaves the earlier destroyed record cached");
	g_Assert.equal(g_PartialCleanupWeaponsScriptsAPI.Load("pistol"), g_PartialCleanupPistolWeaponScriptRecord, "partial cleanup leaves the throwing record cached");

	// Exercise both current JavaScript wrappers; only the native SDK boundary is mocked.
	const g_IntegrationKeyValuesRuntime = {
		Types() {
			return {};
		},

		Create(strKeyValuesName) {
			g_Assert.equal(strKeyValuesName, "", "the owning file factory creates an unnamed root");
			const Handle = { Destroyed: false, FilePath: null };
			g_vecIntegrationNativeHandles.push(Handle);

			return Handle;
		},

		LoadFromFile(Handle, strFilePath, bUseEscapeSequences) {
			g_Assert.equal(Handle.Destroyed, false, "native file load receives a live root");
			g_Assert.equal(bUseEscapeSequences, false, "script loads use default escape-sequence options");
			Handle.FilePath = strFilePath;

			return g_bIntegrationLoadSucceeds;
		},

		GetInt(Handle, strKeyName, nDefaultValue) {
			g_Assert.equal(Handle.Destroyed, false, "native integer reads receive a live root");

			return (strKeyName === "Damage") ? 42 : nDefaultValue;
		},

		Destroy(Handle) {
			g_Assert.equal(Handle.Destroyed, false, "native root cleanup is not duplicated");
			Handle.Destroyed = true;

			return true;
		},
	};
	const g_RequireIntegrationKeyValuesModule = function RequireIntegrationKeyValuesModule(strModuleIdentifier) {
		if (strModuleIdentifier === "colors") {
			return { Color: class Color {} };
		}

		if (strModuleIdentifier === "internal/runtime") {
			return {
				GetModule: strModuleName => {
					g_Assert.equal(strModuleName, "keyvalues", "the current KeyValues wrapper obtains its native module");

					return g_IntegrationKeyValuesRuntime;
				},
			};
		}

		throw new Error(`Unexpected integration KeyValues import: ${strModuleIdentifier}`);
	};

	const g_IntegrationKeyValuesModule = { exports: {} };
	g_VM.runInNewContext(g_FileSystem.readFileSync(g_strKeyValuesPath, "utf8"), { module: g_IntegrationKeyValuesModule, require: g_RequireIntegrationKeyValuesModule }, { filename: g_strKeyValuesPath, timeout: g_unVMTimeoutMilliseconds });
	g_Assert.equal(typeof g_IntegrationKeyValuesModule.exports.KeyValues.CreateKeyValuesFromFile, "function", "the real wrapper exports the current factory");
	g_Assert.equal(g_IntegrationKeyValuesModule.exports.KeyValues.FromFile, undefined, "the real wrapper does not provide the obsolete alias");

	const g_RequireIntegrationScriptsModule = function RequireIntegrationScriptsModule(strModuleIdentifier) {
		if (strModuleIdentifier === "keyvalues") {
			return g_IntegrationKeyValuesModule.exports;
		}

		if (strModuleIdentifier === "filesystem") {
			return { DoesFileExist: strFilePath => g_setExistingFiles.has(strFilePath) };
		}

		if (strModuleIdentifier === "paths") {
			return { GAME_ROOT: "c:/game" };
		}

		if (strModuleIdentifier === "internal/runtime") {
			return {
				GetModule: strModuleName => {
					g_Assert.equal(strModuleName, "weapons/scripts", "the script wrapper obtains its native module");

					return g_NativeWeaponsScripts;
				},
			};
		}

		throw new Error(`Unexpected integration script import: ${strModuleIdentifier}`);
	};

	const g_IntegrationScriptsModule = { exports: {} };
	g_VM.runInNewContext(g_FileSystem.readFileSync(g_strScriptsPath, "utf8"), { module: g_IntegrationScriptsModule, require: g_RequireIntegrationScriptsModule }, { filename: g_strScriptsPath, timeout: g_unVMTimeoutMilliseconds });
	g_IntegrationCleanup.ScriptsAPI = g_IntegrationScriptsModule.exports;

	const g_IntegrationScriptRecord = g_IntegrationScriptsModule.exports.Load(" RIFLE ");
	const g_IntegrationOriginalRoot = g_IntegrationScriptRecord.KeyValues;
	g_IntegrationCleanup.OriginalRoot = g_IntegrationOriginalRoot;
	g_Assert.ok(g_IntegrationOriginalRoot instanceof g_IntegrationKeyValuesModule.exports.KeyValues, "script loading returns the real KeyValues wrapper");
	g_Assert.equal(g_IntegrationOriginalRoot.GetKeyValuesInteger("Damage", 0), 42, "the real wrapper reads script data");
	g_Assert.equal(g_IntegrationScriptsModule.exports.Load("WEAPON_RIFLE"), g_IntegrationScriptRecord, "normalized loads share a cached real-wrapper record");
	g_Assert.equal(g_vecIntegrationNativeHandles.length, 1, "a cache hit allocates no new root");

	g_IntegrationScriptRecord.Path = "caller-mutated-path";
	g_Assert.equal(g_IntegrationScriptsModule.exports.Load("rifle"), g_IntegrationScriptRecord, "metadata mutation does not change the cache key");
	g_IntegrationScriptRecord.KeyValues = g_IntegrationKeyValuesModule.exports.KeyValues.CreateKeyValuesFromFile("c:/game/scripts/weapon_pistol.txt");
	g_Assert.equal(g_IntegrationScriptsModule.exports.ClearCache(), true, "cleanup uses the record's current root field");
	g_Assert.equal(g_vecIntegrationNativeHandles[1].Destroyed, true, "root replacement redirects cleanup");
	g_Assert.equal(g_vecIntegrationNativeHandles[0].Destroyed, false, "root replacement orphans the original native root");
	g_Assert.equal(g_IntegrationOriginalRoot.DestroyKeyValues(), true, "the test explicitly releases the orphaned root");

	g_bIntegrationLoadSucceeds = false;
	g_Assert.throws(() => g_IntegrationScriptsModule.exports.Load("rifle"), /Could not load the KeyValues file/, "native load failure propagates through both current wrappers");
	g_Assert.equal(g_vecIntegrationNativeHandles[2].Destroyed, true, "the real factory releases the root after a failed load");

	g_bIntegrationLoadSucceeds = true;
	const g_IntegrationRetriedScriptRecord = g_IntegrationScriptsModule.exports.Load("rifle");
	g_Assert.notEqual(g_IntegrationRetriedScriptRecord, g_IntegrationScriptRecord, "failed loads are not installed in the cache");
	g_Assert.equal(g_vecIntegrationNativeHandles.length, 4, "a successful retry allocates a new owning root");
	g_Assert.equal(g_IntegrationScriptsModule.exports.ClearCache(), true, "real-wrapper integration final cleanup");
	g_Assert.equal(g_vecIntegrationNativeHandles.every(Handle => Handle.Destroyed), true, "the integration test leaves no native test root live");

	const g_vecNodeModulePaths = [g_strPackageRootPath];
	if (process.env.NODE_PATH) {
		g_vecNodeModulePaths.push(process.env.NODE_PATH);
	}

	const g_strNodeModulePath = g_vecNodeModulePaths.join(g_Path.delimiter);
	const g_ChildProcessEnvironment = { ...process.env, NODE_PATH: g_strNodeModulePath };

	const g_MissingRuntimeResult = g_ChildProcess.spawnSync(process.execPath, ["-e", `require(${JSON.stringify(g_strScriptsPath)});`], { encoding: "utf8", env: g_ChildProcessEnvironment, timeout: g_unChildTimeoutMilliseconds });
	g_Assert.equal(g_MissingRuntimeResult.error, undefined, "missing-runtime child starts and finishes before the timeout");
	g_Assert.equal(g_MissingRuntimeResult.signal, null, "missing-runtime child is not terminated by a signal");
	g_Assert.equal(g_MissingRuntimeResult.status, 1, "weapons/scripts requires the native runtime");
	g_Assert.match(g_MissingRuntimeResult.stderr, /SourceJS native runtime is not installed/, "missing runtime error");
} finally {
	try {
		// Preserve false-destroy/throwing-root assertions, then release fixture-owned roots.
		for (const KeyValuesInstance of g_vecKeyValuesInstances) {
			if (!KeyValuesInstance.Destroyed) {
				KeyValuesInstance.DestroyError = null;
				KeyValuesInstance.DestroyResult = true;
				g_Assert.equal(KeyValuesInstance.DestroyKeyValues(), true, "fixture root final cleanup succeeds");
			}
		}
	} finally {
		try {
			if (g_IntegrationCleanup.ScriptsAPI !== null) {
				g_Assert.equal(g_IntegrationCleanup.ScriptsAPI.ClearCache(), true, "integration cache final cleanup succeeds");
			}
		} finally {
			try {
				if ((g_IntegrationCleanup.OriginalRoot !== null) && (g_IntegrationCleanup.OriginalRoot.Handle !== null)) {
					g_Assert.equal(g_IntegrationCleanup.OriginalRoot.DestroyKeyValues(), true, "orphaned integration root final cleanup succeeds");
				}
			} finally {
				g_bIntegrationLoadSucceeds = true;
				g_setExistingFiles.clear();

				for (const strFilePath of g_setOriginalExistingFiles) {
					g_setExistingFiles.add(strFilePath);
				}
			}
		}
	}
}

g_Assert.equal(g_vecKeyValuesInstances.every(KeyValuesInstance => KeyValuesInstance.Destroyed), true, "the test leaves no mock KeyValues root live");
g_Assert.equal(g_vecIntegrationNativeHandles.every(Handle => Handle.Destroyed), true, "the test leaves no real-wrapper native test root live");
g_Assert.deepEqual(g_setExistingFiles, g_setOriginalExistingFiles, "the test restores fixture file availability");

console.log("[  OK  ] smoke_weapons_scripts");
