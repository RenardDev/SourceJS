#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strPlayersBasePath = g_Path.join(g_strPackageRootPath, "players", "index.js");
const g_strPlayersDictionaryPath = g_Path.join(g_strPackageRootPath, "players", "dictionary.js");
const g_strEntityDictionaryPath = g_Path.join(g_strPackageRootPath, "entities", "dictionary.js");
const g_strRuntimePath = g_Path.join(g_strPackageRootPath, "internal", "runtime.js");
const g_strPlayersDictionaryDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "players-dictionary.md");
const g_unDocumentationTimeoutMilliseconds = 1000;
const g_unDocumentationCodeBlockCount = 6;
const g_DocumentationBlockIndexes = { Import: 0, Roster: 1, OwnedDictionary: 2, SharedDictionary: 3, CustomValues: 4, Sessions: 5 };
const g_setActiveMockDictionaries = new Set();
const g_setDocumentationFixtureOwners = new Set();
const g_mapActiveButtonListeners = new Map();

// Bounds synchronous JavaScript only; this is not a security sandbox or native-IO cancellation.
function RunDocumentationFunction(Callback, Receiver, vecArguments, strLabel) {
	const Script = new g_VM.Script("Reflect.apply(Callback, Receiver, vecArguments)", { filename: `${g_strPlayersDictionaryDocumentationPath}:${strLabel}` });

	return Script.runInNewContext({ Callback, Receiver, vecArguments, Reflect }, { timeout: g_unDocumentationTimeoutMilliseconds });
}

function RestoreDictionaryProperty(Owner, strName, Descriptor) {
	if (Descriptor === undefined) {
		if (!Reflect.deleteProperty(Owner, strName)) {
			throw new Error(`Dictionary fixture could not delete temporary property ${strName}.`);
		}

		return;
	}

	Object.defineProperty(Owner, strName, Descriptor);
}

function IsPackageCachePath(strFilePath) {
	const strRelativePath = g_Path.relative(g_strPackageRootPath, strFilePath);

	return (strRelativePath === "") || ((strRelativePath !== "..") && !strRelativePath.startsWith(`..${g_Path.sep}`) && !g_Path.isAbsolute(strRelativePath));
}

function CapturePackageCacheDescriptors() {
	const mapDescriptors = new Map();
	for (const strFilePath of Object.getOwnPropertyNames(require.cache)) {
		if (IsPackageCachePath(strFilePath)) {
			const Descriptor = Object.getOwnPropertyDescriptor(require.cache, strFilePath);
			if (!Descriptor.configurable) {
				throw new Error(`Dictionary fixture cannot replace non-configurable cache entry ${strFilePath}.`);
			}

			mapDescriptors.set(strFilePath, Descriptor);
		}
	}

	return mapDescriptors;
}

function PurgePackageCache() {
	const vecErrors = [];
	for (const strFilePath of Object.getOwnPropertyNames(require.cache)) {
		if (IsPackageCachePath(strFilePath)) {
			try {
				RestoreDictionaryProperty(require.cache, strFilePath, undefined);
			} catch (ErrorValue) {
				vecErrors.push(ErrorValue);
			}
		}
	}

	if (vecErrors.length > 0) {
		throw new AggregateError(vecErrors, "Dictionary fixture cache purge failed.");
	}
}

function RestorePackageCache(mapDescriptors) {
	const vecErrors = [];

	try {
		PurgePackageCache();
	} catch (ErrorValue) {
		vecErrors.push(ErrorValue);
	}

	for (const [strFilePath, Descriptor] of mapDescriptors) {
		try {
			RestoreDictionaryProperty(require.cache, strFilePath, Descriptor);
		} catch (ErrorValue) {
			vecErrors.push(ErrorValue);
		}
	}

	if (vecErrors.length > 0) {
		throw new AggregateError(vecErrors, "Dictionary fixture cache restoration failed.");
	}
}

const g_vecDictionaryCalls = [];

function InstallDependency(strFilePath, ModuleExports) {
	delete require.cache[strFilePath];
	require.cache[strFilePath] = { children: [], exports: ModuleExports, filename: strFilePath, id: strFilePath, loaded: true, paths: [] };
}

class EntityDictionary extends Map {
	constructor(EntityFactory, ...vecFactoryArguments) {
		super();
		this.EntityFactory = EntityFactory;
		this.EntityFactoryArguments = vecFactoryArguments;
		this.NetworkedEntityDeletedListenerRegistered = true;
		g_setActiveMockDictionaries.add(this);
		g_vecDictionaryCalls.push(["construct", this]);
	}

	CreateMissingEntity(unEntityIndex) {
		if (!super.has(unEntityIndex)) {
			const EntityInstance = this.EntityFactory(unEntityIndex, ...this.EntityFactoryArguments);
			if ((EntityInstance === null) || (EntityInstance === undefined)) {
				throw new Error(`Unable to create entity for index ${unEntityIndex}.`);
			}

			super.set(unEntityIndex, EntityInstance);
		}

		return super.get(unEntityIndex);
	}

	get(EntityReference) {
		if (!super.has(EntityReference)) {
			return this.CreateMissingEntity(EntityReference);
		}

		return super.get(EntityReference);
	}

	delete(EntityReference) {
		return super.delete(EntityReference);
	}

	// Signature mirrors the package's overridable automatic-removal hook.
	OnAutomaticallyRemoved(unEntityIndex) {
	}

	OnNetworkedEntityDeleted(EntityReference) {
		if (!super.has(EntityReference)) {
			return false;
		}

		this.OnAutomaticallyRemoved(EntityReference);

		return super.delete(EntityReference);
	}

	Unload() {
		if (!this.NetworkedEntityDeletedListenerRegistered) {
			return false;
		}

		this.NetworkedEntityDeletedListenerRegistered = false;
		g_setActiveMockDictionaries.delete(this);
		g_vecDictionaryCalls.push(["Unload", this]);

		return true;
	}
}

const g_vecNativeCalls = [];
const g_mapPlayers = new Map([
	[1, { Index: 1, Name: "Ren", UserID: 11 }],
	[2, { Index: 2, Name: "Bot", UserID: 99 }],
]);

const g_DictionaryRuntime = {
	GetAll() {
		g_vecNativeCalls.push(["GetAll"]);

		return Object.fromEntries([...g_mapPlayers, ["Count", g_mapPlayers.size]]);
	},

	GetEntries() {
		return Array.from(g_mapPlayers.entries());
	},

	Get(unIndex) {
		return g_mapPlayers.get(unIndex) ?? null;
	},

	Has(unIndex) {
		return g_mapPlayers.has(unIndex);
	},

	GetKeys() {
		return Array.from(g_mapPlayers.keys());
	},

	GetPlayer(unIndex) {
		return g_mapPlayers.get(unIndex) ?? null;
	},

	GetValues() {
		return Array.from(g_mapPlayers.values());
	},
};

const g_HelpersRuntime = {
	GetIndexFromUserID(unUserID) {
		g_vecNativeCalls.push(["IndexFromUserID", unUserID]);

		return (unUserID === 99) ? 2 : 1;
	},
};

function Player(unIndex) {
	return g_DictionaryRuntime.GetPlayer(unIndex);
}

const g_vecDocumentationModules = [];
const g_vecListenerCalls = [];

function ReleaseRootResources(setPreserved = new Set()) {
	const vecErrors = [];
	for (const [Subscription, Dispose] of [...g_mapActiveButtonListeners]) {
		try {
			RunDocumentationFunction(Dispose, Subscription, [], "Root:DisposeSubscription");
		} catch (ErrorValue) {
			vecErrors.push(ErrorValue);
		}
	}

	for (const mapDictionary of [...g_setActiveMockDictionaries]) {
		if (!setPreserved.has(mapDictionary)) {
			for (const Release of [
				() => Map.prototype.clear.call(mapDictionary),
				() => EntityDictionary.prototype.Unload.call(mapDictionary),
			]) {
				try {
					Release();
				} catch (ErrorValue) {
					vecErrors.push(ErrorValue);
				}
			}
		}
	}

	if (vecErrors.length > 0) {
		throw new AggregateError(vecErrors, "Mock dictionary resource cleanup failed.");
	}
}

const g_ModuleLoadDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");
const g_SourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
const g_mapPackageCacheDescriptors = CapturePackageCacheDescriptors();

function LoadPlayersDictionaryModule() {
	const OriginalModuleLoad = g_Module._load;
	Object.defineProperty(g_Module, "_load", {
		configurable: true,
		enumerable: g_ModuleLoadDescriptor?.enumerable ?? true,

		value: function Load(strRequestName, ParentModule, bIsMain) {
			if (strRequestName === "internal/runtime") {
				return require(g_strRuntimePath);
			}

			if (strRequestName === "players") {
				return require(g_strPlayersBasePath);
			}

			if (strRequestName === "entities/dictionary") {
				return require(g_strEntityDictionaryPath);
			}

			return OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
		},

		writable: true,
	});

	const Dictionary = require(g_strPlayersDictionaryPath);

	RestoreDictionaryProperty(g_Module, "_load", g_ModuleLoadDescriptor);

	return Dictionary;
}

let g_bFailed = false;
let g_Failure = null;

try {
	PurgePackageCache();
	InstallDependency(g_strPlayersBasePath, { Player });
	InstallDependency(g_strEntityDictionaryPath, { EntityDictionary });
	Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: g_SourceJSDescriptor?.enumerable ?? true, writable: true, value: { "players/dictionary": g_DictionaryRuntime, "players/helpers": g_HelpersRuntime } });

	const g_Dictionary = LoadPlayersDictionaryModule();

	g_Assert.ok(g_Dictionary === g_DictionaryRuntime, "players/dictionary must extend the exact native object.");

	const g_SharedDictionaryDescriptor = Object.getOwnPropertyDescriptor(g_Dictionary, "PLAYER_DICTIONARY");
	const g_PlayerDictionaryTypeDescriptor = Object.getOwnPropertyDescriptor(g_Dictionary, "PlayerDictionary");
	g_Assert.equal(g_SharedDictionaryDescriptor.configurable, true, "PLAYER_DICTIONARY must remain configurable.");
	g_Assert.equal(g_SharedDictionaryDescriptor.enumerable, true, "PLAYER_DICTIONARY must remain enumerable.");
	g_Assert.equal(g_SharedDictionaryDescriptor.writable, true, "PLAYER_DICTIONARY must remain writable.");
	g_Assert.equal(g_PlayerDictionaryTypeDescriptor.configurable, true, "PlayerDictionary must remain configurable.");
	g_Assert.equal(g_PlayerDictionaryTypeDescriptor.enumerable, true, "PlayerDictionary must remain enumerable.");
	g_Assert.equal(g_PlayerDictionaryTypeDescriptor.writable, true, "PlayerDictionary must remain writable.");

	g_Assert.equal(g_Dictionary.GetAll()[2].Name, "Bot", "native GetAll direct call");
	g_Assert.equal(g_Dictionary.GetAll().Count, 2, "native GetAll count");
	g_Assert.equal(g_Dictionary.GetPlayer(1).Name, "Ren", "native GetPlayer direct call");
	g_Assert.equal(g_Dictionary.PLAYER_DICTIONARY.FromUserID(99).Name, "Bot", "default dictionary user ID lookup");
	g_Assert.ok(g_vecNativeCalls.some((vecCall) => (vecCall[0] === "IndexFromUserID") && (vecCall[1] === 99)), "FromUserID must call the native helper directly.");

	const g_mapCustomDictionary = new g_Dictionary.PlayerDictionary((unIndex, strMarker) => ({ Index: unIndex, Marker: strMarker }), "custom");
	g_Assert.equal(g_mapCustomDictionary.get(7).Marker, "custom", "custom player factory arguments");
	g_Assert.equal(g_mapCustomDictionary.FromUserID(99).Index, 2, "custom dictionary user ID lookup");
	g_Assert.equal(g_mapCustomDictionary.Unload(), true, "custom dictionary test cleanup");
	g_Assert.ok(!Object.hasOwn(g_Dictionary, "Player"), "players/dictionary must not re-export the Player factory.");
	g_Assert.ok(!Object.hasOwn(g_Dictionary, "playerDictionary"), "players/dictionary must not expose a lower-camel singleton alias.");
	g_Assert.ok(!Object.hasOwn(g_Dictionary, "moduleName"), "players/dictionary must not expose moduleName.");
	g_Assert.ok(!Object.hasOwn(g_Dictionary, "default"), "players/dictionary must not expose a default alias.");

	g_Assert.deepEqual(Object.keys(g_Dictionary).sort(), [
		"PLAYER_DICTIONARY",
		"PlayerDictionary",
		"GetAll",
		"GetEntries",
		"Get",
		"Has",
		"GetKeys",
		"GetPlayer",
		"GetValues",
	].sort(), "players/dictionary exact exports");

	function EvaluateDictionaryDocumentationModule(strSource, RequireModule) {
		const ModuleRecord = { exports: {} };
		const Callback = g_VM.compileFunction(strSource, ["require", "module", "exports"], { filename: `${g_strPlayersDictionaryDocumentationPath}:Contract` });
		RunDocumentationFunction(Callback, undefined, [RequireModule, ModuleRecord, ModuleRecord.exports], "Contract:Initialize");

		return ModuleRecord.exports;
	}

	function CreateDocumentationDictionaryRuntime(Options) {
		const setDeletionListeners = new Set();
		const mapOwnedDictionaries = new Map();
		const mapOwnedSubscriptions = new Map();

		const ReleaseFixture = () => {
			const vecErrors = [];
			for (const [Subscription, Dispose] of [...mapOwnedSubscriptions]) {
				try {
					const bReleased = RunDocumentationFunction(Dispose, Subscription, [], "Fixture:DisposeSubscription");
					if (bReleased !== true) {
						throw new Error("Dictionary fixture subscription did not release.");
					}

					mapOwnedSubscriptions.delete(Subscription);
				} catch (ErrorValue) {
					vecErrors.push(ErrorValue);
				}
			}

			for (const [mapOwnedDictionary, Dispose] of mapOwnedDictionaries) {
				for (const Release of [
					() => Map.prototype.clear.call(mapOwnedDictionary),
					() => RunDocumentationFunction(Dispose, mapOwnedDictionary, [], "Fixture:UnloadActualBase"),
				]) {
					try {
						Release();
					} catch (ErrorValue) {
						vecErrors.push(ErrorValue);
					}
				}
			}

			for (const Callback of [...setDeletionListeners]) {
				try {
					Manager.UnregisterListener(Callback);
				} catch (ErrorValue) {
					vecErrors.push(ErrorValue);
				}
			}

			if (vecErrors.length > 0) {
				throw new AggregateError(vecErrors, "Actual dictionary fixture cleanup failed.");
			}

			mapOwnedDictionaries.clear();
			g_setDocumentationFixtureOwners.delete(ReleaseFixture);
		};
		g_setDocumentationFixtureOwners.add(ReleaseFixture);

		const vecCleanupCalls = [];
		const NativeRuntime = {};
		const PlayerRecord = { Index: 1, UserID: 11 };
		const Manager = {
			RegisterListener(Callback) {
				setDeletionListeners.add(Callback);
			},

			UnregisterListener(Callback) {
				g_Assert.equal(setDeletionListeners.delete(Callback), true, "real base unregisters its exact callback");
			},
		};

		const strBaseSource = g_FileSystem.readFileSync(g_strEntityDictionaryPath, "utf8");
		const nUnrelatedClassOffset = strBaseSource.indexOf("class SyncedEntityDictionary extends EntityDictionary");
		g_Assert.ok(nUnrelatedClassOffset > 0, "isolate the actual base class, not unrelated synced-dictionary behavior");

		const Base = EvaluateDictionaryDocumentationModule(strBaseSource.slice(0, nUnrelatedClassOffset) + "\nmodule.exports = { EntityDictionary };", (strName) => {
			if (strName === "internal/runtime") {
				return { GetModule: () => ({ GetEntityIndexFromIntegerHandle: () => 1 }) };
			}

			if (strName === "listeners") {
				return { NetworkedEntityCreatedManager: Manager, NetworkedEntityDeletedManager: Manager };
			}

			throw new Error("Unexpected real-base documentation dependency: " + strName);
		});
		const TrackedBase = {
			...Base,
			EntityDictionary: new Proxy(Base.EntityDictionary, {
				construct(Target, vecArguments, NewTarget) {
					const Instance = Reflect.construct(Target, vecArguments, NewTarget);
					mapOwnedDictionaries.set(Instance, Target.prototype.Unload);

					return Instance;
				},
			}),
		};
		const DictionaryModule = EvaluateDictionaryDocumentationModule(g_FileSystem.readFileSync(g_strPlayersDictionaryPath, "utf8"), (strName) => {
			if (strName === "entities/dictionary") {
				return TrackedBase;
			}

			if (strName === "internal/runtime") {
				return {
					GetModule(strModuleName) {
						return (strModuleName === "players/dictionary") ? NativeRuntime : { GetIndexFromUserID: () => 1 };
					},
				};
			}

			if (strName === "players") {
				return { Player: () => PlayerRecord };
			}

			throw new Error("Unexpected real-player dictionary dependency: " + strName);
		});

		class FaultDictionary extends DictionaryModule.PlayerDictionary {
			get(EntityReference) {
				if (Options.FailOperation) {
					throw Options.OperationError;
				}

				return super.get(EntityReference);
			}

			clear() {
				vecCleanupCalls.push("clear");

				if (Options.FailClear) {
					throw Options.ClearError;
				}

				return super.clear();
			}

			Unload() {
				vecCleanupCalls.push("unload");

				if (Options.FailUnload) {
					throw Options.UnloadError;
				}

				if (Options.FalseUnload) {
					return false;
				}

				return super.Unload();
			}
		}

		return {
			DictionaryModule,
			FaultDictionary,
			PlayerRecord,

			RequireModule(strName) {
				if (strName === "players/dictionary") {
					return { ...DictionaryModule, PlayerDictionary: FaultDictionary };
				}

				if (strName === "listeners") {
					return {
						RegisterButtonStateChangedListener(Callback) {
							const Subscription = Options.RegisterButtonListener(Callback);
							const Dispose = Subscription.DisposeListener;
							mapOwnedSubscriptions.set(Subscription, Dispose);

							Object.defineProperty(Subscription, "DisposeListener", {
								configurable: true,
								enumerable: true,
								writable: true,

								value: function DisposeListener() {
									const Result = Reflect.apply(Dispose, this, []);
									if (Result === true) {
										mapOwnedSubscriptions.delete(Subscription);
									}

									return Result;
								},
							});

							return Subscription;
						},
					};
				}

				if (strName === "players") {
					return { GetAllPlayers: () => [PlayerRecord] };
				}

				throw new Error("Unexpected current dictionary documentation dependency: " + strName);
			},

			CleanupCalls: vecCleanupCalls,
		};
	}

	function CheckDocumentationDictionaryCleanup(strDocumentation) {
		const vecCodeBlocks = [...strDocumentation.matchAll(/\x60\x60\x60js\r?\n([\s\S]*?)\x60\x60\x60/g)].map((vecMatch) => vecMatch[1]);
		for (const unCodeBlockIndex of [g_DocumentationBlockIndexes.OwnedDictionary, g_DocumentationBlockIndexes.CustomValues]) {
			for (const strScenario of [
				"SUCCESS",
				"OPERATION",
				"NULLOPERATION",
				"CLEARANDUNLOAD",
				"OPERATIONANDCLEARANDUNLOAD",
				"FALSEUNLOAD",
			]) {
				const Options = {
					FailOperation: strScenario.includes("OPERATION"),
					OperationError: (strScenario === "NULLOPERATION") ? null : new Error("operation"),
					FailClear: strScenario.includes("CLEAR"),
					ClearError: new Error("clear"),
					FailUnload: strScenario.includes("ANDUNLOAD"),
					UnloadError: new Error("unload"),
					FalseUnload: strScenario === "FALSEUNLOAD",
				};
				const Runtime = CreateDocumentationDictionaryRuntime(Options);

				const Execute = () => EvaluateDictionaryDocumentationModule(vecCodeBlocks[unCodeBlockIndex], Runtime.RequireModule);
				if (Options.FailClear || Options.FailUnload || Options.FalseUnload) {
					g_Assert.throws(Execute, (ErrorValue) => {
						g_Assert.ok(ErrorValue instanceof AggregateError, "cleanup failures are reported together");

						const vecExpectedErrors = [];
						if (Options.FailOperation) {
							vecExpectedErrors.push(Options.OperationError);
						}

						if (Options.FailClear) {
							vecExpectedErrors.push(Options.ClearError);
						}

						if (Options.FailUnload) {
							vecExpectedErrors.push(Options.UnloadError);
						}

						if (Options.FalseUnload) {
							g_Assert.match(ErrorValue.errors[ErrorValue.errors.length - 1].message, /Unable to unload/);

						} else {
							g_Assert.deepEqual(ErrorValue.errors, vecExpectedErrors, "original operation and all cleanup failures retain identity and order");
						}

						return true;
					}, strScenario);

				} else if (Options.FailOperation) {
					g_Assert.throws(Execute, (ErrorValue) => ErrorValue === Options.OperationError, "successful cleanup preserves even a null operation failure");

				} else {
					g_Assert.doesNotThrow(Execute, "the current example runs against actual package dictionary logic");
				}

				g_Assert.deepEqual(Runtime.CleanupCalls, ["clear", "unload"], "unload is attempted even when clear fails");
			}
		}

		const Runtime = CreateDocumentationDictionaryRuntime({});
		const mapDictionary = new Runtime.DictionaryModule.PlayerDictionary(null);
		g_Assert.throws(() => mapDictionary.get(1), /not cached/, "null factory is cache-only");
		mapDictionary.set(1, { Value: 7 });

		for (const itDictionaryView of [mapDictionary.keys(), mapDictionary.values(), mapDictionary.entries()]) {
			g_Assert.equal(Array.isArray(itDictionaryView), false, "Map views are not arrays");
			g_Assert.equal(typeof itDictionaryView.next, "function", "Map views are iterators");
		}

		g_Assert.equal(mapDictionary.get({ Index: 1 }).Value, 7, "cached lookup accepts a validated index-bearing record");
		g_Assert.throws(() => mapDictionary.get({ Index: -1 }), TypeError, "invalid entity index is rejected");
		g_Assert.equal(mapDictionary.FromIntegerHandle(1).Value, 7, "integer-handle helper uses the actual base method");
		g_Assert.equal(mapDictionary.Unload(), true);
		g_Assert.equal(mapDictionary.Unload(), false);

		let unFactoryCalls = 0;
		const mapMarkedDictionary = new Runtime.DictionaryModule.PlayerDictionary(() => {
			unFactoryCalls += 1;

			return { IsEntityMarkedForDeletion: () => true };
		});
		mapMarkedDictionary.get(1);
		mapMarkedDictionary.get(1);
		g_Assert.equal(unFactoryCalls, 2, "marked-for-deletion results are not retained");
		g_Assert.equal(mapMarkedDictionary.size, 0);
		g_Assert.equal(mapMarkedDictionary.Unload(), true);

		for (const bExistingEntry of [false, true]) {
			const SharedRuntime = CreateDocumentationDictionaryRuntime({});
			const mapShared = SharedRuntime.DictionaryModule.PLAYER_DICTIONARY;
			if (bExistingEntry) {
				mapShared.set(1, SharedRuntime.PlayerRecord);
			}

			g_Assert.doesNotThrow(() => EvaluateDictionaryDocumentationModule(vecCodeBlocks[g_DocumentationBlockIndexes.SharedDictionary], SharedRuntime.RequireModule));
			g_Assert.equal(mapShared.has(1), bExistingEntry, "shared example removes only an entry it inserted");
			g_Assert.equal(mapShared.NetworkedEntityDeletedListenerRegistered, true, "feature does not unload the shared dictionary");
		}

		for (const strFailure of ["INDEX", "NULL", "REPLACED"]) {
			const SharedRuntime = CreateDocumentationDictionaryRuntime({});
			const mapShared = SharedRuntime.DictionaryModule.PLAYER_DICTIONARY;
			const OperationError = (strFailure === "NULL") ? null : new Error("cached index");
			const ReplacementPlayer = { Index: 1, UserID: 99 };
			let unIndexReads = 0;

			Object.defineProperty(SharedRuntime.PlayerRecord, "Index", {
				get() {
					unIndexReads += 1;

					if (unIndexReads === 1) {
						return 1;
					}

					if (strFailure === "REPLACED") {
						mapShared.set(1, ReplacementPlayer);
					}

					throw OperationError;
				},
			});

			g_Assert.throws(() => EvaluateDictionaryDocumentationModule(vecCodeBlocks[g_DocumentationBlockIndexes.SharedDictionary], SharedRuntime.RequireModule), (ErrorValue) => {
				if (strFailure === "REPLACED") {
					g_Assert.ok(ErrorValue instanceof AggregateError);
					g_Assert.equal(ErrorValue.errors[0], OperationError);
					g_Assert.equal(mapShared.get(1), ReplacementPlayer, "cleanup never deletes a replacement belonging to another feature");

				} else {
					g_Assert.equal(ErrorValue, OperationError, "shared cleanup preserves even a null operation failure");
					g_Assert.equal(mapShared.has(1), false, "shared entry is restored after a later accessor failure");
				}

				return true;
			});
		}

		for (const strFailure of ["FALSE", "THROW", "NULL"]) {
			let bFailDisposal = true;
			const vecDisposalCalls = [];
			const DisposalError = new Error("subscription disposal");
			const vecSubscriptions = [];
			const Options = {
				RegisterButtonListener() {
					const unSubscriptionIndex = vecSubscriptions.length;
					const Subscription = {
						DisposeListener() {
							vecDisposalCalls.push(unSubscriptionIndex);

							if ((unSubscriptionIndex === 0) && bFailDisposal) {
								if (strFailure === "FALSE") {
									return false;
								}

								throw (strFailure === "NULL") ? null : DisposalError;
							}

							return true;
						},
					};
					vecSubscriptions.push(Subscription);

					return Subscription;
				},
			};
			const SubscriptionRuntime = CreateDocumentationDictionaryRuntime(Options);
			const Example = EvaluateDictionaryDocumentationModule(vecCodeBlocks[g_DocumentationBlockIndexes.Sessions], SubscriptionRuntime.RequireModule);
			const mapSessions = Example.Sessions;
			RunDocumentationFunction(() => mapSessions.WatchButtons(1), undefined, [], "Contract:WatchButtons");

			g_Assert.throws(() => RunDocumentationFunction(() => mapSessions.OnNetworkedEntityDeleted(1), undefined, [], "Contract:OnNetworkedEntityDeleted"), (ErrorValue) => {
				g_Assert.ok(ErrorValue instanceof AggregateError);

				if (strFailure !== "FALSE") {
					g_Assert.equal(ErrorValue.errors[0], (strFailure === "NULL") ? null : DisposalError);
				}

				return true;
			});
			g_Assert.deepEqual(vecDisposalCalls, [0, 1], "one failed disposal never skips another subscription");
			g_Assert.equal(RunDocumentationFunction(() => mapSessions.has(1), undefined, [], "Contract:has"), false, "actual parent removes the cache entry even when the hook throws");
			g_Assert.equal(mapSessions.Subscriptions.size, 1, "failed handle stays reachable after automatic removal");

			bFailDisposal = false;
			g_Assert.equal(RunDocumentationFunction(() => mapSessions.ReleaseSubscriptions(mapSessions.Subscriptions), undefined, [], "Contract:ReleaseSubscriptions"), true);
			g_Assert.equal(mapSessions.Subscriptions.size, 0, "explicit retry releases only failed handles");
		}

		const CreateRoster = () => ({
			GetAll: () => ({ Count: 2, 1: { Index: 1 }, 2: { Index: 2 } }),

			GetEntries: () => [[1, { Index: 1 }], [2, { Index: 2 }]],

			GetKeys: () => [1, 2],

			GetValues: () => [{ Index: 1 }, { Index: 2 }],

			Get: (unIndex) => (unIndex === 0) ? null : { Index: unIndex },

			GetPlayer: (unIndex) => (unIndex === 0) ? null : { Index: unIndex },

			Has: (unIndex) => unIndex !== 0,
		});
		g_Assert.doesNotThrow(() => EvaluateDictionaryDocumentationModule(vecCodeBlocks[g_DocumentationBlockIndexes.Roster], () => CreateRoster()), "roster accepts fresh wrappers rather than requiring object identity");

		for (const strInvalidView of [
			"KEYS",
			"ENTRIES",
			"ENTRYINDEX",
			"VALUES",
			"VALUEINDEX",
		]) {
			const Roster = CreateRoster();
			if (strInvalidView === "KEYS") {
				Roster.GetKeys = () => [1, 1];

			} else if (strInvalidView === "ENTRIES") {
				Roster.GetEntries = () => [null, [2, { Index: 2 }]];

			} else if (strInvalidView === "ENTRYINDEX") {
				Roster.GetEntries = () => [[1, { Index: 1 }], [1, { Index: 1 }]];

			} else if (strInvalidView === "VALUES") {
				Roster.GetValues = () => [null, { Index: 2 }];

			} else {
				Roster.GetValues = () => [{ Index: 1 }, { Index: 1 }];
			}

			g_Assert.throws(() => EvaluateDictionaryDocumentationModule(vecCodeBlocks[g_DocumentationBlockIndexes.Roster], () => Roster), /Invalid connected-player index|invalid player (entry|value)/, "roster rejects malformed or duplicated " + strInvalidView);
		}

		process.stdout.write("players/dictionary documentation: actual package cache/iterators and fault-injected independent cleanup contracts passed.\n");
	}

	function CheckDocumentationDictionaryUnload(strDocumentation) {
		const vecCodeBlocks = [...strDocumentation.matchAll(/\x60\x60\x60js\r?\n([\s\S]*?)\x60\x60\x60/g)].map((vecMatch) => vecMatch[1]);
		for (const strScenario of [
			"SUCCESS",
			"SUBSCRIPTION",
			"NULLSUBSCRIPTION",
			"CLEARANDUNLOAD",
			"SUBSCRIPTIONANDCLEARANDUNLOAD",
			"FALSEUNLOAD",
		]) {
			const vecCallbacks = [];
			const vecDisposalCalls = [];
			const SubscriptionError = new Error("subscription");
			const Options = {
				FailClear: strScenario.includes("CLEAR"),
				ClearError: new Error("clear"),
				FailUnload: strScenario.includes("ANDUNLOAD"),
				UnloadError: new Error("unload"),
				FalseUnload: strScenario === "FALSEUNLOAD",

				RegisterButtonListener(Callback) {
					const unSubscriptionIndex = vecCallbacks.length;
					vecCallbacks.push(Callback);

					return {
						DisposeListener() {
							vecDisposalCalls.push(unSubscriptionIndex);

							if ((unSubscriptionIndex === 0) && strScenario.includes("SUBSCRIPTION") && Options.FailSubscription) {
								throw (strScenario === "NULLSUBSCRIPTION") ? null : SubscriptionError;
							}

							return true;
						},
					};
				},

				FailSubscription: strScenario.includes("SUBSCRIPTION"),
			};
			const Runtime = CreateDocumentationDictionaryRuntime(Options);
			const Example = EvaluateDictionaryDocumentationModule(vecCodeBlocks[g_DocumentationBlockIndexes.Sessions], Runtime.RequireModule);
			const mapSessions = Example.Sessions;
			const Session = RunDocumentationFunction(() => mapSessions.get(1), undefined, [], "Contract:get");
			RunDocumentationFunction(() => mapSessions.WatchButtons(1), undefined, [], "Contract:WatchButtons");
			RunDocumentationFunction(() => vecCallbacks[0]({ Index: 1 }), undefined, [], "Contract:ButtonCallback");
			g_Assert.equal(Session.ButtonChanges, 1, "active session accepts its button event");

			if (Options.FailSubscription || Options.FailClear || Options.FailUnload || Options.FalseUnload) {
				g_Assert.throws(() => RunDocumentationFunction(() => mapSessions.Unload(), undefined, [], "Contract:Unload"), (ErrorValue) => {
					g_Assert.ok(ErrorValue instanceof AggregateError, "unload collects independent phase failures");

					const vecExpectedErrors = [];
					if (Options.FailSubscription) {
						g_Assert.ok(ErrorValue.errors[0] instanceof AggregateError);
						g_Assert.equal(ErrorValue.errors[0].errors[0], (strScenario === "NULLSUBSCRIPTION") ? null : SubscriptionError);
						vecExpectedErrors.push(ErrorValue.errors[0]);
					}

					if (Options.FailClear) {
						vecExpectedErrors.push(Options.ClearError);
					}

					if (Options.FailUnload) {
						vecExpectedErrors.push(Options.UnloadError);
					}

					if (Options.FalseUnload) {
						g_Assert.match(ErrorValue.errors[ErrorValue.errors.length - 1].message, /Unable to unregister/);

					} else {
						g_Assert.deepEqual(ErrorValue.errors, vecExpectedErrors, "phase errors preserve identity and order");
					}

					return true;
				});

			} else {
				g_Assert.equal(RunDocumentationFunction(() => mapSessions.Unload(), undefined, [], "Contract:Unload"), true, "successful owned cleanup reports work");
			}

			g_Assert.deepEqual(vecDisposalCalls, [0, 1], "a failed subscription never skips a later subscription");
			g_Assert.deepEqual(Runtime.CleanupCalls, ["clear", "unload"], "clear and listener removal are attempted after subscription failures");
			g_Assert.equal(Session.Active, false, "session is deactivated before native disposal");

			g_Assert.doesNotThrow(() => RunDocumentationFunction(() => vecCallbacks[0]({
				get Index() {
					throw new Error("inactive callbacks must not touch a borrowed player");
				},
			}), undefined, [], "Contract:ButtonCallback"));
			g_Assert.equal(Session.ButtonChanges, 1, "inactive callback does not modify released state");

			Options.FailSubscription = false;
			Options.FailClear = false;
			Options.FailUnload = false;
			Options.FalseUnload = false;

			const bHadPendingOwnership = mapSessions.NetworkedEntityDeletedListenerRegistered || (mapSessions.Subscriptions.size !== 0) || (mapSessions.size !== 0);
			g_Assert.doesNotThrow(() => g_Assert.equal(RunDocumentationFunction(() => mapSessions.Unload(), undefined, [], "Contract:Unload"), bHadPendingOwnership, "retry reports only pending ownership"), "retry does not fail after recovery");
			g_Assert.doesNotThrow(() => g_Assert.equal(RunDocumentationFunction(() => mapSessions.Unload(), undefined, [], "Contract:Unload"), false, "a complete empty dictionary is not registered again"), "complete empty dictionary cleanup is harmless");
			g_Assert.equal(mapSessions.Subscriptions.size, 0, "retry drains failed handles even after the cache was cleared");
			g_Assert.deepEqual(vecDisposalCalls, strScenario.includes("SUBSCRIPTION") ? [0, 1, 0] : [0, 1], "only failed subscriptions are retried");
			g_Assert.equal(Runtime.CleanupCalls.filter((strCall) => strCall === "unload").length, (strScenario.includes("ANDUNLOAD") || (strScenario === "FALSEUNLOAD")) ? 2 : 1, "a removed listener is not unregistered again");
		}

		process.stdout.write("players/dictionary documentation: independent session unload, inactive callbacks, and pending-only retries passed.\n");
	}

	const g_strDocumentation = g_FileSystem.readFileSync(g_strPlayersDictionaryDocumentationPath, "utf8");
	CheckDocumentationDictionaryCleanup(g_strDocumentation);
	CheckDocumentationDictionaryUnload(g_strDocumentation);

	const g_vecCodeBlocks = [...g_strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);

	const g_vecRequiredExports = [
		"PLAYER_DICTIONARY",
		"PlayerDictionary",
		"GetAll",
		"GetEntries",
		"Get",
		"Has",
		"GetKeys",
		"GetPlayer",
		"GetValues",
	];

	const g_vecRequiredMembers = [
		"get(EntityReference)",
		"FromUserID(unUserID)",
		"FromIntegerHandle(unEntityHandle)",
		"has(EntityReference)",
		"keys()",
		"values()",
		"entries()",
		"delete(EntityReference)",
		"clear()",
		"set(unEntityIndex, Value)",
		"size",
		"forEach()",
		"CreateMissingEntity(unEntityIndex)",
		"OnAutomaticallyRemoved(unEntityIndex)",
		"OnNetworkedEntityDeleted(EntityReference)",
		"Unload()",
	];

	const g_vecRequiredSections = [
		"Import",
		"Native roster API",
		"PlayerDictionary",
		"Shared dictionary",
		"Custom cached values",
		"Automatic removal",
		"Errors",
		"Lifecycle",
		"Related modules",
	];

	g_Assert.equal(g_vecCodeBlocks.length, g_unDocumentationCodeBlockCount, "players/dictionary documentation workflow count");
	g_Assert.ok(!g_strDocumentation.includes("Generated by"), "players/dictionary documentation must be maintained by hand.");
	g_Assert.ok(!g_strDocumentation.includes("cfg/sourcejs/example.txt"), "players/dictionary documentation must not describe a filesystem getter.");
	g_Assert.doesNotMatch(g_strDocumentation, /\bconsole\s*\./, "players/dictionary documentation must not depend on console output.");
	g_Assert.doesNotMatch(g_strDocumentation, /```text\r?\nnew PlayerDictionary/, "PlayerDictionary constructor syntax must use a JavaScript fence.");

	for (const strExportName of g_vecRequiredExports) {
		g_Assert.ok(g_vecCodeBlocks[g_DocumentationBlockIndexes.Import].includes(strExportName), `players/dictionary import must include ${strExportName}.`);
		g_Assert.ok(g_strDocumentation.includes(`\`${strExportName}`), `players/dictionary documentation must cover ${strExportName}.`);
	}

	for (const strMemberName of g_vecRequiredMembers) {
		g_Assert.ok(g_strDocumentation.includes(`\`${strMemberName}`), `players/dictionary documentation must cover ${strMemberName}.`);
	}

	for (const strSectionName of g_vecRequiredSections) {
		const strAnchor = strSectionName.toLowerCase().replace(/ /g, "-");
		g_Assert.ok(g_strDocumentation.includes(`- [${strSectionName}](#${strAnchor})`), `players/dictionary contents must link ${strSectionName}.`);
		g_Assert.ok(g_strDocumentation.includes(`## ${strSectionName}`), `players/dictionary documentation must contain ${strSectionName}.`);
	}

	function RequireDocumentationModule(strModuleName) {
		if (strModuleName === "players/dictionary") {
			return g_Dictionary;
		}

		if (strModuleName === "players") {
			return {
				GetAllPlayers() {
					return Array.from(g_mapPlayers.values());
				},
			};
		}

		if (strModuleName === "listeners") {
			return {
				RegisterButtonStateChangedListener(Callback) {
					let bDisposed = false;
					const Subscription = {
						DisposeListener() {
							if (bDisposed) {
								return false;
							}

							bDisposed = true;
							g_mapActiveButtonListeners.delete(Subscription);
							g_vecListenerCalls.push(["dispose", Callback]);

							return true;
						},
					};
					g_mapActiveButtonListeners.set(Subscription, Subscription.DisposeListener);
					g_vecListenerCalls.push(["register", Callback]);

					Callback({ Index: 1 }, 0, 1);

					return Subscription;
				},
			};
		}

		throw new Error(`unexpected documentation module ${strModuleName}`);
	}

	function ExecuteRootDocumentation(unCodeBlockIndex) {
		const setPreserved = new Set(g_setActiveMockDictionaries);
		const ModuleRecord = { exports: {} };
		const strLabel = `Root-${unCodeBlockIndex + 1}`;
		const Callback = g_VM.compileFunction(g_vecCodeBlocks[unCodeBlockIndex], ["require", "module", "exports"], { filename: `${g_strPlayersDictionaryDocumentationPath}:${strLabel}` });
		let bFailed = false;
		let Failure = null;

		try {
			RunDocumentationFunction(Callback, undefined, [RequireDocumentationModule, ModuleRecord, ModuleRecord.exports], strLabel);
			g_vecDocumentationModules.push(ModuleRecord.exports);
			RunDocumentationFunction(() => {
				if (ModuleRecord.exports.Sessions && Array.isArray(ModuleRecord.exports.Sessions.RemovedIndexes)) {
					const mapSessions = ModuleRecord.exports.Sessions;
					g_Assert.equal(mapSessions.OnNetworkedEntityDeleted(1), true, "automatic-removal example engine callback");
					g_Assert.deepEqual(mapSessions.RemovedIndexes, [1], "automatic-removal example hook result");
				}
			}, undefined, [], strLabel + ":AutomaticRemoval");
		} catch (ErrorValue) {
			bFailed = true;
			Failure = ErrorValue;
		}

		const vecErrors = [];

		try {
			RunDocumentationFunction(() => {
				const strRuntimeSource = g_FileSystem.readFileSync(g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "V8Runtime.cpp"), "utf8");
				const vecUnloadDefinition = strRuntimeSource.match(/^\tvoid V8Runtime::UnloadPlugin\([^\r\n]*\) \{[\s\S]*?^\t}/m);
				g_Assert.ok(vecUnloadDefinition, "Native plugin unload definition");
				g_Assert.match(vecUnloadDefinition[0], /CallPluginExportFunction\(strPluginName,\s*"Unload"\)/, "Documentation unload lookup must follow the current exact native export key");

				const Exports = ModuleRecord.exports;
				const Unload = Exports.Unload;
				g_Assert.equal(Object.hasOwn(Exports, "unload"), false, "No lowercase lifecycle alias");

				if (unCodeBlockIndex === g_DocumentationBlockIndexes.Sessions) {
					g_Assert.equal(typeof Unload, "function", "The session example must export the native unload entry point");
				}

				if (typeof Unload === "function") {
					Reflect.apply(Unload, Exports, []);
				}
			}, undefined, [], strLabel + ":Unload");
		} catch (ErrorValue) {
			vecErrors.push(ErrorValue);
		}

		if (!bFailed && (vecErrors.length === 0) && ((g_mapActiveButtonListeners.size !== 0) || [...g_setActiveMockDictionaries].some((mapDictionary) => !setPreserved.has(mapDictionary)))) {
			vecErrors.push(new Error("Dictionary documentation did not release all owned registrations."));
		}

		try {
			ReleaseRootResources(setPreserved);
		} catch (ErrorValue) {
			vecErrors.push(ErrorValue);
		}

		if (vecErrors.length > 0) {
			if (!bFailed && (vecErrors.length === 1)) {
				throw vecErrors[0];
			}

			if (bFailed) {
				vecErrors.unshift(Failure);
			}

			throw new AggregateError(vecErrors, "Dictionary documentation cleanup failed.");
		}

		if (bFailed) {
			throw Failure;
		}
	}

	for (let unCodeBlockIndex = 0; unCodeBlockIndex < g_vecCodeBlocks.length; ++unCodeBlockIndex) {
		ExecuteRootDocumentation(unCodeBlockIndex);
	}

	const g_strDocumentationWithoutCode = g_strDocumentation.replace(/```[\s\S]*?```/g, "");
	const g_vecLinks = [...g_strDocumentationWithoutCode.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((vecMatch) => vecMatch[1]);
	for (const strTarget of g_vecLinks) {
		if (strTarget.startsWith("#") || /^[a-z]+:/i.test(strTarget)) {
			continue;
		}

		const strTargetPath = g_Path.resolve(g_Path.dirname(g_strPlayersDictionaryDocumentationPath), strTarget.split("#", 1)[0]);
		g_Assert.ok(g_FileSystem.existsSync(strTargetPath), `players/dictionary documentation link must exist: ${strTarget}`);
	}

	g_Assert.ok(g_vecNativeCalls.some((vecCall) => (vecCall[0] === "IndexFromUserID") && (vecCall[1] === 11)), "default dictionary workflow must resolve a user ID natively.");
	g_Assert.ok(g_vecListenerCalls.some((vecCall) => vecCall[0] === "register"), "automatic-removal workflow must register a disposable subscription.");
	g_Assert.ok(g_vecListenerCalls.some((vecCall) => vecCall[0] === "dispose"), "automatic-removal workflow must dispose its subscription.");
	g_Assert.ok(g_vecDocumentationModules.some((Exports) => (typeof Exports.ReadRosterViews === "function") && (RunDocumentationFunction(() => Exports.ReadRosterViews(), undefined, [], "Contract:ReadRosterViews").Roster.Count === g_mapPlayers.size)), "native roster workflow must reacquire every connected player without storing borrowed wrappers.");
	g_Assert.ok(g_vecDocumentationModules.some((Exports) => Exports.SessionResult && Exports.SessionResult.Role === "guest"), "custom value workflow must preserve factory arguments.");
	g_Assert.ok(g_vecDictionaryCalls.filter((vecCall) => vecCall[0] === "Unload").length >= 4, "custom dictionaries must be unloaded by their owners.");

	function VerifyWorldDictionaryExample() {
		const strExamplePath = g_Path.join(g_strRepositoryRootPath, "examples", "plugins", "disabled", "api-world-objects", "index.js");
		const strExample = g_FileSystem.readFileSync(strExamplePath, "utf8");
		const vecMatch = strExample.match(/\tLogResult\("players\/dictionary roster and cache",[\s\S]*?\r?\n\t}\);/);
		g_Assert.ok(vecMatch, "world player dictionary callback must remain available");

		const RunExample = g_VM.compileFunction(vecMatch[0], ["g_GetAllDictionaryPlayers", "GetKeys", "GetPlayer", "g_HasDictionaryPlayer", "g_GetDictionaryPlayer", "GetEntries", "PLAYER_DICTIONARY", "PlayerDictionary", "GetValues", "LogResult"], { filename: strExamplePath + ":Dictionary" });
		const vecOriginalPlayers = Array.from(g_mapPlayers);
		const vecOriginalCache = Array.from(g_Dictionary.PLAYER_DICTIONARY);

		try {
			for (const vecPlayers of [[], vecOriginalPlayers]) {
				g_mapPlayers.clear();
				g_Dictionary.PLAYER_DICTIONARY.clear();

				for (const [unIndex, PlayerInstance] of vecPlayers) {
					g_mapPlayers.set(unIndex, PlayerInstance);
					g_Dictionary.PLAYER_DICTIONARY.get(unIndex);
				}

				let Result = undefined;
				RunDocumentationFunction(RunExample, undefined, [g_Dictionary.GetAll, g_Dictionary.GetKeys, g_Dictionary.GetPlayer, g_Dictionary.Has, g_Dictionary.Get, g_Dictionary.GetEntries, g_Dictionary.PLAYER_DICTIONARY, g_Dictionary.PlayerDictionary, g_Dictionary.GetValues, (strLabel, Callback) => {
					g_Assert.equal(strLabel, "players/dictionary roster and cache");
					Result = RunDocumentationFunction(Callback, undefined, [], "World:Callback");
				}], "World:Initialize");

				const vecIndexes = vecPlayers.map(([unIndex]) => unIndex);
				g_Assert.deepEqual(Result.Keys, vecIndexes);
				g_Assert.deepEqual(Result.Values, vecIndexes);
				g_Assert.deepEqual(Result.Entries, vecIndexes.map((unIndex) => [unIndex, unIndex]));
				g_Assert.deepEqual(Result.All, Object.fromEntries([...vecIndexes.map((unIndex) => [unIndex, unIndex]), ["Count", vecIndexes.length]]));
				g_Assert.deepEqual(Result.SharedCache, { InstanceOfPlayerDictionary: true, Keys: vecIndexes, Size: vecIndexes.length });
				g_Assert.deepEqual(Result.FirstPlayer, (vecIndexes.length === 0) ? null : { IndexFromGetPlayer: vecIndexes[0], Has: true, Index: vecIndexes[0], IndexFromDictionary: vecIndexes[0] });
			}
		} finally {
			g_mapPlayers.clear();
			g_Dictionary.PLAYER_DICTIONARY.clear();

			for (const [unIndex, PlayerInstance] of vecOriginalPlayers) {
				g_mapPlayers.set(unIndex, PlayerInstance);
			}

			for (const [unIndex, PlayerInstance] of vecOriginalCache) {
				g_Dictionary.PLAYER_DICTIONARY.set(unIndex, PlayerInstance);
			}
		}
	}

	VerifyWorldDictionaryExample();
} catch (ErrorValue) {
	g_bFailed = true;
	g_Failure = ErrorValue;
} finally {
	const vecErrors = [];
	for (const Release of [
		...g_setDocumentationFixtureOwners,
		ReleaseRootResources,
		() => RestoreDictionaryProperty(g_Module, "_load", g_ModuleLoadDescriptor),
		() => RestorePackageCache(g_mapPackageCacheDescriptors),
		() => RestoreDictionaryProperty(globalThis, "sourcejs", g_SourceJSDescriptor),
	]) {
		try {
			Release();
		} catch (ErrorValue) {
			vecErrors.push(ErrorValue);
		}
	}

	if (vecErrors.length > 0) {
		if (!g_bFailed && (vecErrors.length === 1)) {
			throw vecErrors[0];
		}

		if (g_bFailed) {
			vecErrors.unshift(g_Failure);
		}

		throw new AggregateError(vecErrors, "Dictionary smoke state restoration failed.");
	}
}

if (g_bFailed) {
	throw g_Failure;
}

console.log("[smoke_players_dictionary] ok");
