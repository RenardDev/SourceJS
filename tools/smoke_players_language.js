#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strRuntimePath = g_Path.join(g_strPackageRootPath, "internal", "runtime.js");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "players-language.md");
const g_strModuleBindingsPath = g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "modules", "ModuleBindings.cpp");
const g_unExpectedListenerCount = 3;
const g_unDocumentationBlockCount = 4;
const g_unDocumentationTimeoutMilliseconds = 1000;
const g_DocumentationBlocks = { Language: 0, Cache: 1, Settings: 2, Greeting: 3 };

function GetPackagePath(strName) {
	if (strName === "players/language") {
		return g_Path.join(g_strPackageRootPath, "players", "language", "index.js");
	}

	return g_Path.join(g_strPackageRootPath, `${strName}.js`);
}

function InstallDependency(strName, ModuleExports) {
	const strFilePath = GetPackagePath(strName);
	delete require.cache[strFilePath];
	require.cache[strFilePath] = { children: [], exports: ModuleExports, filename: strFilePath, id: strFilePath, loaded: true, paths: [] };
}

const g_mapLanguageValues = new Map([
	[1, "russian"],
	[2, "english"],
]);

const g_vecHelperNativeCalls = [];
const g_mapListenerCallbacks = new Map();
const g_mapListenerRegistrationFailures = new Map();
const g_mapListenerRemovalFailures = new Map();
const g_vecRemovedListenerRegistrations = [];
const g_vecPublicNativeCalls = [];
const g_setOwnedLanguageCaches = new Set();
let g_Cache = null;

function CreateOwnedLanguageCache() {
	const Cache = new g_Cache.LanguageCache();
	g_setOwnedLanguageCaches.add(Cache);

	return Cache;
}

function RestoreOwnedLanguageCaches() {
	const vecFailures = [];
	for (const Cache of g_setOwnedLanguageCaches) {
		try {
			if (Cache.ListenersRegistered) {
				// The state guard proves active registrations; removal returns true or throws.
				g_Cache.LanguageCache.prototype.UnregisterListeners.call(Cache);
			}

			g_setOwnedLanguageCaches.delete(Cache);
		} catch (Failure) {
			vecFailures.push(Failure);
		}
	}

	if (vecFailures.length > 0) {
		throw new AggregateError(vecFailures, "Owned language cache restoration failed.");
	}
}

function ResolvePlayerIndex(PlayerReference) {
	return (typeof PlayerReference === "number") ? PlayerReference : PlayerReference.Index;
}

const g_NativeLanguage = {
	GetClientCVarValue(PlayerReference, strConVarName) {
		const nPlayerIndex = ResolvePlayerIndex(PlayerReference);
		g_vecPublicNativeCalls.push(["GetClientCVarValue", nPlayerIndex, strConVarName]);

		if (strConVarName === "cl_language") {
			return g_mapLanguageValues.get(nPlayerIndex) ?? "";
		}

		if (strConVarName === "cl_updaterate") {
			return "60";
		}

		if (strConVarName === "rate") {
			return "30000";
		}

		return "";
	},

	GetClientLanguage(PlayerReference) {
		const nPlayerIndex = ResolvePlayerIndex(PlayerReference);
		g_vecPublicNativeCalls.push(["GetClientLanguage", nPlayerIndex]);

		return g_mapLanguageValues.get(nPlayerIndex) ?? "";
	},
};

function CreateListenerManager(strEventName) {
	return {
		RegisterListener(ListenerCallback) {
			if (g_mapListenerRegistrationFailures.has(strEventName)) {
				const RegistrationFailure = g_mapListenerRegistrationFailures.get(strEventName);

				g_mapListenerRegistrationFailures.delete(strEventName);
				throw RegistrationFailure;
			}

			let setCallbacks = g_mapListenerCallbacks.get(strEventName);
			if (!setCallbacks) {
				setCallbacks = new Set();
				g_mapListenerCallbacks.set(strEventName, setCallbacks);
			}

			if (setCallbacks.has(ListenerCallback)) {
				throw new Error("Duplicate language listener callback.");
			}

			setCallbacks.add(ListenerCallback);

			return ListenerCallback;
		},

		UnregisterListener(ListenerCallback) {
			if (g_mapListenerRemovalFailures.has(strEventName)) {
				const RemovalFailure = g_mapListenerRemovalFailures.get(strEventName);

				g_mapListenerRemovalFailures.delete(strEventName);
				throw RemovalFailure;
			}

			const setCallbacks = g_mapListenerCallbacks.get(strEventName);
			g_Assert.ok(setCallbacks?.has(ListenerCallback), "language listener callback mismatch: " + strEventName);
			g_vecRemovedListenerRegistrations.push([strEventName, ListenerCallback]);
			setCallbacks.delete(ListenerCallback);

			if (setCallbacks.size === 0) {
				g_mapListenerCallbacks.delete(strEventName);
			}

			return true;
		},
	};
}

const g_SourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
const g_ModuleLoadDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");
const g_mapPackageCacheDescriptors = new Map();
for (const strPath of Object.getOwnPropertyNames(require.cache)) {
	if (strPath.startsWith(g_strPackageRootPath + g_Path.sep)) {
		g_mapPackageCacheDescriptors.set(strPath, Object.getOwnPropertyDescriptor(require.cache, strPath));
	}
}

function RestoreSourceJS() {
	if (g_SourceJSDescriptor === undefined) {
		g_Assert.ok(Reflect.deleteProperty(globalThis, "sourcejs"), "Temporary SourceJS global must be removable.");
		return;
	}

	Object.defineProperty(globalThis, "sourcejs", g_SourceJSDescriptor);
}

function RestoreModuleLoader() {
	Object.defineProperty(g_Module, "_load", g_ModuleLoadDescriptor);
}

function RestorePackageCache() {
	const vecFailures = [];
	for (const strPath of Object.getOwnPropertyNames(require.cache)) {
		if (strPath.startsWith(g_strPackageRootPath + g_Path.sep)) {
			try {
				g_Assert.ok(Reflect.deleteProperty(require.cache, strPath), "Temporary package cache entry must be removable: " + strPath);
			} catch (ErrorValue) {
				vecFailures.push(ErrorValue);
			}
		}
	}

	for (const [strPath, Descriptor] of g_mapPackageCacheDescriptors) {
		try {
			Object.defineProperty(require.cache, strPath, Descriptor);
		} catch (ErrorValue) {
			vecFailures.push(ErrorValue);
		}
	}

	if (vecFailures.length > 0) {
		throw new AggregateError(vecFailures, "Player language package cache restoration failed.");
	}
}

// The same-realm callback is deadline-bounded, not a security sandbox or native IO cancellation.
function RunDocumentationTask(Callback, strRole) {
	return g_VM.runInNewContext("Run()", { Run: Callback }, { filename: g_strDocumentationPath + "#" + strRole, timeout: g_unDocumentationTimeoutMilliseconds });
}

function CompileDocumentationBlock(strSource, unBlockIndex) {
	return g_VM.compileFunction(strSource, ["require", "module", "exports"], { filename: g_strDocumentationPath + "#js-" + (unBlockIndex + 1) });
}

let g_PrimaryFailure = undefined;
let g_bFailed = false;
let g_unDocumentationScenarioCount = 0;

try {
	g_Assert.ok((g_SourceJSDescriptor === undefined) || g_SourceJSDescriptor.configurable, "Existing SourceJS global must be restorable.");
	g_Assert.ok(g_ModuleLoadDescriptor && Object.hasOwn(g_ModuleLoadDescriptor, "value") && (typeof g_ModuleLoadDescriptor.value === "function"), "Node module loader must have its normal data descriptor.");

	for (const [strPath, Descriptor] of g_mapPackageCacheDescriptors) {
		g_Assert.ok(Descriptor.configurable, "Existing package cache must be restorable: " + strPath);
	}

	Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: true, writable: true, value: { "players/language": g_NativeLanguage } });

	for (const strPath of g_mapPackageCacheDescriptors.keys()) {
		g_Assert.ok(Reflect.deleteProperty(require.cache, strPath), "Existing package cache must be removable: " + strPath);
	}

	InstallDependency("listeners", {
		ClientDisconnectManager: CreateListenerManager("ClientDisconnect"),
		ClientFullyConnectManager: CreateListenerManager("ClientFullyConnect"),
		ClientSettingsChangedManager: CreateListenerManager("ClientSettingsChanged"),
	});

	InstallDependency("players/helpers", {
		GetClientLanguage(PlayerReference) {
			g_vecHelperNativeCalls.push(PlayerReference);

			return g_mapLanguageValues.get(ResolvePlayerIndex(PlayerReference)) ?? "";
		},

		GetPlayerIndex(PlayerReference) {
			return ResolvePlayerIndex(PlayerReference);
		},
	});

	const g_strCachePath = GetPackagePath("players/language/cache");
	const g_strPublicPath = GetPackagePath("players/language");
	const g_ModulePaths = {
		"core": GetPackagePath("core"),
		"internal/runtime": g_strRuntimePath,
		"listeners": GetPackagePath("listeners"),
		"players/helpers": GetPackagePath("players/helpers"),
		"players/language": g_strPublicPath,
		"players/language/cache": g_strCachePath,
	};

	Object.defineProperty(g_Module, "_load", {
		...g_ModuleLoadDescriptor,

		value: function Load(strRequestName, ParentModule, bIsMain) {
			const strModulePath = Object.hasOwn(g_ModulePaths, strRequestName) ? g_ModulePaths[strRequestName] : undefined;
			if (strModulePath) {
				return require(strModulePath);
			}

			return g_ModuleLoadDescriptor.value.call(this, strRequestName, ParentModule, bIsMain);
		},
	});

	delete require.cache[g_strCachePath];
	g_Cache = require(g_strCachePath);
	g_setOwnedLanguageCaches.add(g_Cache.LANGUAGE_CACHE);
	g_Assert.ok(g_Cache.LANGUAGE_CACHE instanceof g_Cache.LanguageCache, "LANGUAGE_CACHE type");
	g_Assert.ok(g_Cache.LANGUAGE_CACHE.ClientLanguages instanceof Map, "LanguageCache live client-language Map");
	g_Assert.equal(g_Cache.LANGUAGE_CACHE.ListenersRegistered, true, "LanguageCache listener state after construction");
	g_Assert.ok(!Object.hasOwn(g_Cache.LANGUAGE_CACHE, "registered"), "LanguageCache must not expose registered alias state.");
	g_Assert.ok(!Object.hasOwn(g_Cache.LANGUAGE_CACHE, "values"), "LanguageCache must not expose generic values state.");
	g_Assert.equal(g_mapListenerCallbacks.size, g_unExpectedListenerCount, "language cache listener count");
	g_Assert.equal(g_Cache.GetClientLanguage(2), "english", "cached language lookup");
	g_mapLanguageValues.set(2, "russian");
	g_Assert.equal(g_Cache.GetClientLanguage(2), "english", "language cache retains its live entry");

	for (const Callback of g_mapListenerCallbacks.get("ClientSettingsChanged")) {
		Callback(2);
	}

	g_Assert.equal(g_Cache.GetClientLanguage(2), "russian", "settings callback refreshes language");

	for (const Callback of g_mapListenerCallbacks.get("ClientDisconnect")) {
		Callback(2);
	}

	g_Assert.ok(!g_Cache.LANGUAGE_CACHE.HasClientLanguage(2), "disconnect callback removes language");
	g_Assert.ok(!Object.hasOwn(g_Cache, "languageCache"), "language cache must not expose a lower-camel singleton alias.");

	InstallDependency("core", { SOURCE_ENGINE_BRANCH: "csgo" });
	delete require.cache[g_strPublicPath];
	const g_CSGORouter = require(g_strPublicPath);
	g_Assert.equal(g_CSGORouter.GetClientLanguage(2), "russian", "CSGO router uses cache backend");

	InstallDependency("core", { SOURCE_ENGINE_BRANCH: "l4d2" });
	delete require.cache[g_strPublicPath];
	const g_BaseRouter = require(g_strPublicPath);
	RestoreModuleLoader();
	g_Assert.equal(g_BaseRouter.GetClientLanguage(2), "russian", "Source 1 router uses base backend");
	g_Assert.ok(!Object.hasOwn(g_BaseRouter, "default"), "language router must not expose a default alias.");

	g_mapLanguageValues.set(2, "english");
	const g_PublicLanguage = g_BaseRouter;
	g_Assert.notStrictEqual(g_PublicLanguage, g_NativeLanguage, "players/language must expose its merged package facade.");
	g_Assert.deepEqual(Object.keys(g_PublicLanguage).sort(), ["GetClientCVarValue", "GetClientLanguage"], "players/language exact exports");
	g_Assert.equal(g_PublicLanguage.GetClientCVarValue(2, "cl_language"), "english", "native client CVar lookup");

	g_Assert.ok(g_Cache.LANGUAGE_CACHE.UnregisterListeners(), "language cache disposal");
	g_Assert.equal(g_vecRemovedListenerRegistrations.length, g_unExpectedListenerCount, "language cache unregister count");
	g_Assert.equal(g_mapListenerCallbacks.size, 0, "language cache listeners removed");
	g_Assert.equal(g_Cache.LANGUAGE_CACHE.ListenersRegistered, false, "LanguageCache listener state after disposal");
	g_Assert.equal(g_Cache.LANGUAGE_CACHE.ClientLanguages.size, 0, "LanguageCache disposal clears cached languages");

	g_vecRemovedListenerRegistrations.length = 0;

	const g_RegistrationFailure = new Error("client fully-connect registration failed");
	g_mapListenerRegistrationFailures.set("ClientFullyConnect", g_RegistrationFailure);
	const g_IsRegistrationFailure = (ErrorValue) => ErrorValue === g_RegistrationFailure;
	g_Assert.throws(CreateOwnedLanguageCache, g_IsRegistrationFailure);
	g_Assert.equal(g_mapListenerCallbacks.size, 0, "failed LanguageCache construction rolls back prior listeners");
	g_Assert.equal(g_vecRemovedListenerRegistrations.length, 1, "failed LanguageCache construction removes one prior listener");

	const g_RetryableLanguageCache = CreateOwnedLanguageCache();
	const g_mapRegisteredListenerCallbacks = new Map([...g_mapListenerCallbacks].map(([strName, setCallbacks]) => [strName, [...setCallbacks][0]]));

	g_RetryableLanguageCache.SetClientLanguage(2, "english");
	g_RetryableLanguageCache.ClientDisconnectCallback = () => {};
	g_RetryableLanguageCache.ClientFullyConnectCallback = () => {};
	g_RetryableLanguageCache.ClientSettingsChangedCallback = () => {};
	g_vecRemovedListenerRegistrations.length = 0;

	const g_RemovalFailure = new Error("client fully-connect removal failed");
	g_mapListenerRemovalFailures.set("ClientFullyConnect", g_RemovalFailure);
	const g_UnregisterRetryableLanguageCache = () => g_RetryableLanguageCache.UnregisterListeners();
	const g_IsRemovalFailure = (ErrorValue) => ErrorValue === g_RemovalFailure;
	g_Assert.throws(g_UnregisterRetryableLanguageCache, g_IsRemovalFailure);
	g_Assert.equal(g_RetryableLanguageCache.ListenersRegistered, true, "failed disposal retains listener ownership");
	g_Assert.equal(g_mapListenerCallbacks.size, 1, "failed disposal retains only the failed listener");

	g_Assert.ok(g_mapListenerCallbacks.get("ClientFullyConnect").has(g_mapRegisteredListenerCallbacks.get("ClientFullyConnect")), "failed disposal retains the originally registered callback");
	g_Assert.equal(g_RetryableLanguageCache.ClientLanguages.get(2), "english", "failed disposal retains cached languages");
	g_Assert.equal(g_RetryableLanguageCache.UnregisterListeners(), true, "LanguageCache disposal retry succeeds");
	g_Assert.equal(g_RetryableLanguageCache.ListenersRegistered, false, "successful retry clears listener ownership");
	g_Assert.equal(g_RetryableLanguageCache.ClientLanguages.size, 0, "successful retry clears cached languages");
	g_Assert.equal(g_mapListenerCallbacks.size, 0, "successful retry removes the retained listener");

	let g_unExactListenerRemovalCount = 0;
	for (const [strEventName, ListenerCallback] of g_vecRemovedListenerRegistrations) {
		if (g_mapRegisteredListenerCallbacks.get(strEventName) === ListenerCallback) {
			g_unExactListenerRemovalCount += 1;
		}
	}

	g_Assert.equal(g_unExactListenerRemovalCount, g_unExpectedListenerCount, "LanguageCache disposal owns the exact registered callbacks");

	g_vecPublicNativeCalls.length = 0;

	const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
	const g_vecCodeBlocks = [...g_strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);

	const g_DocumentationPlayer = {
		Index: 1,

		IsConnected() {
			return true;
		},

		IsFakeClient() {
			return false;
		},

		Name: "Ren",
	};

	function RequireDocumentationModule(strModuleName) {
		if (strModuleName === "players/entity") {
			return {
				Player(nPlayerIndex) {
					g_Assert.equal(nPlayerIndex, 1, "documented language player index");

					return g_DocumentationPlayer;
				},
			};
		}

		if (strModuleName === "players/language") {
			return g_PublicLanguage;
		}

		if (strModuleName === "players/helpers") {
			return { GetPlayerIndex: ResolvePlayerIndex };
		}

		if (strModuleName === "players/language/cache") {
			return g_Cache;
		}

		throw new Error(`unexpected players/language documentation module ${strModuleName}`);
	}

	g_Assert.equal(g_vecCodeBlocks.length, g_unDocumentationBlockCount, "players/language documentation workflow count");
	g_Assert.ok(!g_strDocumentation.includes("Generated by"), "players/language documentation must be maintained by hand.");
	g_Assert.ok(!g_strDocumentation.includes("console."), "players/language documentation must not use console output.");
	g_Assert.ok(!/[^\x00-\x7F]/.test(g_strDocumentation), "players/language documentation must not contain damaged non-ASCII text.");
	g_Assert.ok(g_strDocumentation.includes("IVEngineServer"), "players/language documentation must identify native ownership.");
	g_Assert.ok(g_strDocumentation.includes("raw strings"), "players/language documentation must explain client ConVar results.");

	function CheckLanguageDocumentation(vecCodeBlocks) {
		const vecCases = [
			{ Name: "InspectClientLanguage", Arguments: [1] },
			{ Name: "InspectLanguageCache", Arguments: [1] },
			{ Name: "InspectClientSettings", Arguments: [1] },
			{ Name: "GreetingFor", Arguments: [1] },
		];
		let unScenarioCount = 0;

		function Execute(unBlockIndex, vecArguments = vecCases[unBlockIndex].Arguments, Changes = {}) {
			const vecCalls = [];
			const CurrentPlayer = Changes.Player ?? { ...g_DocumentationPlayer };
			const CallerCache = (unBlockIndex === g_DocumentationBlocks.Cache) ? (Changes.Cache ?? CreateOwnedLanguageCache()) : null;
			let Result = undefined;
			let Failure = undefined;
			let bFailed = false;
			let bCacheRegistered = false;
			let bCacheStateCaptured = false;

			try {
				if (Changes.CacheMethods) {
					Object.assign(CallerCache, Changes.CacheMethods);
				}

				const LanguageModule = { ...(Changes.Router ?? g_BaseRouter), ...Changes.Language };
				const ModuleRecord = { exports: {} };
				const Require = (strName) => {
					if (strName === "players/entity") {
						return {
							Player: (nPlayerIndex) => {
								vecCalls.push("Player");
								g_Assert.ok(Number.isInteger(nPlayerIndex) && (nPlayerIndex > 0) && (nPlayerIndex <= 0x7FFFFFFF), "native player double requires a positive Int32 index");

								if (Changes.PlayerFailure) {
									throw Changes.PlayerFailure.Value;
								}

								return CurrentPlayer;
							},
						};
					}

					if (strName === "players/language") {
						const API = {};
						for (const strName of ["GetClientLanguage", "GetClientCVarValue"]) {
							API[strName] = (...vecParameters) => {
								vecCalls.push(strName);

								return LanguageModule[strName](...vecParameters);
							};
						}

						return API;
					}

					if (strName === "players/language/cache") {
						return {
							LANGUAGE_CACHE: g_Cache.LANGUAGE_CACHE,
							LanguageCache: g_Cache.LanguageCache,

							GetClientLanguage: (PlayerReference) => {
								vecCalls.push("GetSharedClientLanguage");

								return g_Cache.GetClientLanguage(PlayerReference);
							},
						};
					}

					if (strName === "players/helpers") {
						return {
							GetPlayerIndex: (PlayerReference) => {
								vecCalls.push("GetPlayerIndex");

								return ResolvePlayerIndex(PlayerReference);
							},
						};
					}

					throw new Error("Unexpected language documentation import: " + strName);
				};
				CompileDocumentationBlock(vecCodeBlocks[unBlockIndex], unBlockIndex)(Require, ModuleRecord, ModuleRecord.exports);
				g_Assert.equal(vecCalls.length, 0, "examples must not query clients while their exports load");

				try {
					const vecCallArguments = (unBlockIndex === g_DocumentationBlocks.Cache) ? [...vecArguments, CallerCache] : vecArguments;
					Result = ModuleRecord.exports[vecCases[unBlockIndex].Name](...vecCallArguments);
				} catch (ErrorValue) {
					Failure = ErrorValue;
					bFailed = true;
				}

				bCacheRegistered = CallerCache ? CallerCache.ListenersRegistered : false;
				bCacheStateCaptured = true;
			} catch (ErrorValue) {
				Failure = bFailed ? new AggregateError([Failure, ErrorValue], "Language documentation and state capture failed.") : ErrorValue;
				bFailed = true;
				throw Failure;
			} finally {
				// The fixture caller owns the independent cache even if setup/compilation or an overridden method fails.
				try {
					if (CallerCache && (CallerCache !== g_Cache.LANGUAGE_CACHE)) {
						const bCallerCacheRegistered = bCacheStateCaptured ? bCacheRegistered : CallerCache.ListenersRegistered;
						if (bCallerCacheRegistered) {
							// The captured state proves active registrations; removal returns true or throws.
							g_Cache.LanguageCache.prototype.UnregisterListeners.call(CallerCache);
						}

						g_setOwnedLanguageCaches.delete(CallerCache);
					}
				} catch (CleanupFailure) {
					if (bFailed) {
						throw new AggregateError([Failure, CleanupFailure], "Language documentation and caller cleanup failed.");
					}

					throw CleanupFailure;
				}
			}

			++unScenarioCount;

			return { Result, Failure, Failed: bFailed, Calls: vecCalls, CacheRegisteredAfterHelper: bCacheRegistered };
		}

		function ExpectFailure(unBlockIndex, vecArguments, Changes = {}) {
			const Run = Execute(unBlockIndex, vecArguments, Changes);
			g_Assert.equal(Run.Failed, true, vecCases[unBlockIndex].Name + " must reject invalid values");
			g_Assert.ok(!(Run.Failure instanceof SyntaxError), "syntax errors are not contract failures");
			g_Assert.ok(!(Run.Failure instanceof g_Assert.AssertionError), "a fixture assertion is not a contract test");

			return Run;
		}

		// An SDK-double assertion is a fixture failure, not documented input rejection.
		const FixtureInvariantError = new g_Assert.AssertionError({ message: "fixture invariant failed", actual: false, expected: true, operator: "strictEqual" });
		const CreateFailureGuard = g_VM.compileFunction(ExpectFailure.toString() + "\nreturn ExpectFailure;", ["Execute", "vecCases", "g_Assert"], { filename: __filename + "#failure-guard" });
		const FailureGuard = CreateFailureGuard(() => ({ Failed: true, Failure: FixtureInvariantError }), [{ Name: "FixtureInvariant" }], g_Assert);
		g_Assert.throws(() => FailureGuard(0, []), { code: "ERR_ASSERTION", message: "a fixture assertion is not a contract test" });

		for (const unBlockIndex of [g_DocumentationBlocks.Language, g_DocumentationBlocks.Settings, g_DocumentationBlocks.Greeting]) {
			g_Assert.equal(Execute(unBlockIndex).Failed, false);

			for (const IndexValue of [
				undefined,
				null,
				false,
				0,
				-1,
				0.5,
				"1",
				1n,
				{},
				NaN,
				Infinity,
				0x80000000,
			]) {
				g_Assert.equal(ExpectFailure(unBlockIndex, [IndexValue]).Calls.length, 0, "index validation must precede player/native work");
			}

			for (const [strMethodName, bValue] of [["IsConnected", false], ["IsFakeClient", true]]) {
				const Run = Execute(unBlockIndex, undefined, { Player: { ...g_DocumentationPlayer, [strMethodName]: () => bValue } });
				g_Assert.equal(Run.Failed, false);
				g_Assert.equal(Run.Result, null);
				g_Assert.deepEqual(Run.Calls, ["Player"], "fake/disconnected clients must not query language/settings");
			}

			for (const strMethodName of ["IsConnected", "IsFakeClient"]) {
				for (const StatusValue of [undefined, null, 0, 1, "true"]) {
					g_Assert.deepEqual(ExpectFailure(unBlockIndex, undefined, { Player: { ...g_DocumentationPlayer, [strMethodName]: () => StatusValue } }).Calls, ["Player"]);
				}

				const Run = Execute(unBlockIndex, undefined, {
					Player: {
						...g_DocumentationPlayer,

						[strMethodName]: () => {
							throw null;
						},
					},
				});
				g_Assert.equal(Run.Failed, true);
				g_Assert.strictEqual(Run.Failure, null, "status exceptions must propagate unchanged");
				g_Assert.deepEqual(Run.Calls, ["Player"]);
			}

			ExpectFailure(unBlockIndex, undefined, { Player: { ...g_DocumentationPlayer, Index: 2 } });

			for (const LanguageValue of [undefined, null, false, 1, {}]) {
				ExpectFailure(unBlockIndex, undefined, { Language: { GetClientLanguage: () => LanguageValue } });
			}

			const PlayerFailure = Execute(unBlockIndex, undefined, { PlayerFailure: { Value: null } });
			g_Assert.equal(PlayerFailure.Failed, true);
			g_Assert.strictEqual(PlayerFailure.Failure, null);

			const LanguageFailure = Execute(unBlockIndex, undefined, {
				Language: {
					GetClientLanguage: () => {
						throw null;
					},
				},
			});
			g_Assert.equal(LanguageFailure.Failed, true);
			g_Assert.strictEqual(LanguageFailure.Failure, null);
		}

		for (const strConVarName of ["rate", "cl_updaterate"]) {
			for (const RateValue of [
				"",
				"30000junk",
				"30000.5",
				" 30000",
				"30000 ",
				"+30000",
				"-1",
				"0",
				"2147483648",
				"999999999999999999999999999999",
				"1e3",
				null,
				30000,
				Object("30000"),
			]) {
				const Run = ExpectFailure(g_DocumentationBlocks.Settings, undefined, {
					Language: {
						GetClientCVarValue: (nPlayerIndex, strName) => {
							g_Assert.equal(nPlayerIndex, 1, "rate query must retain the validated client index");

							return (strName === strConVarName) ? RateValue : "30000";
						},
					},
				});
				g_Assert.ok(!Run.Calls.includes("GetClientLanguage"), "invalid rates must not reach the language query");
				g_Assert.equal(Run.Calls.length, (strConVarName === "rate") ? 2 : 3, "invalid rate must stop before any subsequent setting query");
			}
		}

		for (const strRate of ["1", "0001", "2147483647"]) {
			const Run = Execute(g_DocumentationBlocks.Settings, undefined, { Language: { GetClientCVarValue: () => strRate } });
			g_Assert.equal(Run.Failed, false);
			g_Assert.equal(Run.Result.Rate, Number(strRate));
			g_Assert.equal(Run.Result.UpdateRate, Number(strRate));
		}

		for (const [strLanguage, strExpectedGreeting] of [
			["english", "Welcome to the server."],
			["german", "Willkommen auf dem Server."],
			["", "Welcome to the server."],
			["__proto__", "Welcome to the server."],
			["unknown", "Welcome to the server."],
		]) {
			const Run = Execute(g_DocumentationBlocks.Greeting, undefined, { Language: { GetClientLanguage: () => strLanguage } });
			g_Assert.equal(Run.Failed, false);
			g_Assert.equal(Run.Result, strExpectedGreeting);
		}

		for (const unBlockIndex of [g_DocumentationBlocks.Language, g_DocumentationBlocks.Settings, g_DocumentationBlocks.Greeting]) {
			const CurrentPlayer = { Name: "Ren" };
			const mapReads = new Map();
			for (const [strName, Value] of [
				["Index", 1],
				["IsConnected", function IsConnected() {
					g_Assert.strictEqual(this, CurrentPlayer);

					return true;
				}],
				["IsFakeClient", function IsFakeClient() {
					g_Assert.strictEqual(this, CurrentPlayer);

					return false;
				}],
			]) {
				mapReads.set(strName, 0);
				Object.defineProperty(CurrentPlayer, strName, {
					get() {
						const unCount = mapReads.get(strName) + 1;
						mapReads.set(strName, unCount);
						g_Assert.equal(unCount, 1, "player field/method must be captured once: " + strName);

						return Value;
					},
				});
			}

			g_Assert.equal(Execute(unBlockIndex, undefined, { Player: CurrentPlayer }).Failed, false);
			g_Assert.ok([...mapReads.values()].every((unCount) => unCount === 1));
		}

		g_Cache.LANGUAGE_CACHE.SetClientLanguage(2, "shared-before-report");
		g_Assert.equal(g_Cache.LANGUAGE_CACHE.RegisterListeners(), true, "shared cache must acquire its listeners");
		const mapSharedCallbacks = new Map([...g_mapListenerCallbacks].map(([strName, setCallbacks]) => [strName, new Set(setCallbacks)]));
		const CacheRun = Execute(g_DocumentationBlocks.Cache);
		g_Assert.equal(CacheRun.Failed, false);
		g_Assert.equal(CacheRun.Result.ListenersRegistered, false, "report must reflect completed independent disposal");
		g_Assert.equal(g_Cache.LANGUAGE_CACHE.ClientLanguages.get(2), "shared-before-report", "independent report must not erase unrelated shared entries");
		g_Assert.equal(g_Cache.LANGUAGE_CACHE.ListenersRegistered, true, "independent disposal must not unregister the shared singleton");

		for (const [strName, setCallbacks] of mapSharedCallbacks) {
			g_Assert.deepEqual(g_mapListenerCallbacks.get(strName), setCallbacks, "independent disposal must preserve exact shared callback identities");
		}

		g_Assert.equal(ExpectFailure(g_DocumentationBlocks.Cache, undefined, { Cache: g_Cache.LANGUAGE_CACHE }).Calls.length, 0, "report must reject the shared singleton before mutation");
		g_Assert.equal(g_Cache.LANGUAGE_CACHE.ListenersRegistered, true);

		const CallbackFailure = {};
		for (const strMethodName of ["GetClientLanguage", "RefreshClientLanguage", "SetClientLanguage", "ClearClientLanguages"]) {
			const Run = Execute(g_DocumentationBlocks.Cache, undefined, {
				CacheMethods: {
					[strMethodName]: () => {
						throw CallbackFailure;
					},
				},
			});
			g_Assert.equal(Run.Failed, true);
			g_Assert.strictEqual(Run.Failure, CallbackFailure, "successful disposal must preserve the exact operation exception");
			g_Assert.equal(Run.CacheRegisteredAfterHelper, false);
		}

		g_mapListenerRemovalFailures.set("ClientDisconnect", null);
		const CleanupRun = Execute(g_DocumentationBlocks.Cache);
		g_Assert.equal(CleanupRun.Failed, true);
		g_Assert.strictEqual(CleanupRun.Failure, null, "cleanup-only failure must remain exact");
		g_Assert.equal(CleanupRun.CacheRegisteredAfterHelper, true, "caller must retain the retryable independent instance");

		g_mapListenerRemovalFailures.set("ClientDisconnect", null);
		const BothFailed = Execute(g_DocumentationBlocks.Cache, undefined, {
			CacheMethods: {
				GetClientLanguage: () => {
					throw null;
				},
			},
		});
		g_Assert.equal(BothFailed.Failed, true);
		g_Assert.ok(BothFailed.Failure instanceof AggregateError);
		g_Assert.deepEqual(BothFailed.Failure.errors, [null, null], "operation and cleanup failures must not mask one another");
		g_Assert.equal(BothFailed.CacheRegisteredAfterHelper, true);

		for (const IndexValue of [
			0,
			-1,
			0.5,
			"1",
			1n,
			0x80000000,
		]) {
			const Run = ExpectFailure(g_DocumentationBlocks.Cache, [IndexValue]);
			g_Assert.equal(Run.CacheRegisteredAfterHelper, true, "preflight failure leaves ownership in the caller");
			g_Assert.deepEqual(Run.Calls, ["GetPlayerIndex"]);
		}

		g_Cache.LANGUAGE_CACHE.SetClientLanguage(1, "cached-language");
		g_mapLanguageValues.set(1, "engine-language");
		const unQueriesBeforeHit = g_vecHelperNativeCalls.length;
		const CacheHit = Execute(g_DocumentationBlocks.Language, undefined, { Router: g_CSGORouter });
		g_Assert.equal(CacheHit.Result.Language, "cached-language", "actual CS:GO router must use the existing cache snapshot");
		g_Assert.equal(g_vecHelperNativeCalls.length, unQueriesBeforeHit, "CS:GO cache hit must not query native client state");
		g_Assert.equal(Execute(g_DocumentationBlocks.Language, undefined, { Router: g_BaseRouter }).Result.Language, "engine-language", "actual non-CS:GO router must bypass the cache");
		g_Cache.LANGUAGE_CACHE.ClientSettingsChangedCallback(1);
		g_Assert.equal(Execute(g_DocumentationBlocks.Language, undefined, { Router: g_CSGORouter }).Result.Language, "engine-language", "settings listener must refresh the actual shared cache");
		g_mapLanguageValues.set(1, "russian");
		g_Assert.equal(g_Cache.LANGUAGE_CACHE.UnregisterListeners(), true, "shared cache must release its listeners");

		return unScenarioCount;
	}

	function CheckLanguageDocumentationExamples() {
		const vecDocumentationModules = [];
		for (let unCodeBlockIndex = 0; unCodeBlockIndex < g_vecCodeBlocks.length; ++unCodeBlockIndex) {
			const ModuleRecord = { exports: {} };
			CompileDocumentationBlock(g_vecCodeBlocks[unCodeBlockIndex], unCodeBlockIndex)(RequireDocumentationModule, ModuleRecord, ModuleRecord.exports);
			vecDocumentationModules.push(ModuleRecord.exports);
		}

		g_Assert.equal(g_vecPublicNativeCalls.length, 0, "players/language examples must not query clients while code blocks load.");

		const DocumentationAPI = Object.assign({}, ...vecDocumentationModules);
		g_Assert.deepEqual(DocumentationAPI.InspectClientLanguage(1), { Index: 1, Language: "russian", Name: "Ren" }, "documented client language inspection");
		g_Assert.deepEqual(DocumentationAPI.InspectLanguageCache(1, CreateOwnedLanguageCache()), { InitialLanguage: "russian", ListenersRegistered: false, RefreshedLanguage: "russian", SharedLanguage: "russian" }, "documented language-cache lifecycle");
		g_Assert.deepEqual(DocumentationAPI.InspectClientSettings(1), { Language: "russian", Rate: 30000, UpdateRate: 60 }, "documented client settings inspection");
		g_Assert.equal(DocumentationAPI.GreetingFor(1), "Welcome to the server.", "documented explicit language fallback");
		g_Assert.ok(g_vecPublicNativeCalls.some((vecCall) => (vecCall[0] === "GetClientLanguage") && (vecCall[1] === 1)), "documented native language lookup");
		g_Assert.ok(g_vecPublicNativeCalls.some((vecCall) => (vecCall[0] === "GetClientCVarValue") && (vecCall[1] === 1) && (vecCall[2] === "rate")), "documented native rate lookup");
		g_Assert.ok(g_vecPublicNativeCalls.some((vecCall) => (vecCall[0] === "GetClientCVarValue") && (vecCall[1] === 1) && (vecCall[2] === "cl_updaterate")), "documented native update-rate lookup");
	}

	g_unDocumentationScenarioCount = RunDocumentationTask(() => CheckLanguageDocumentation(g_vecCodeBlocks), "contract-suite");
	g_vecPublicNativeCalls.length = 0;
	RunDocumentationTask(CheckLanguageDocumentationExamples, "examples");

	const g_strDocumentationWithoutCode = g_strDocumentation.replace(/```[\s\S]*?```/g, "");
	const g_vecLinks = [...g_strDocumentationWithoutCode.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((vecMatch) => vecMatch[1]);
	for (const strTarget of g_vecLinks) {
		if (strTarget.startsWith("#") || /^[a-z]+:/i.test(strTarget)) {
			continue;
		}

		const strTargetPath = g_Path.resolve(g_Path.dirname(g_strDocumentationPath), strTarget.split("#", 1)[0]);
		g_Assert.ok(g_FileSystem.existsSync(strTargetPath), `players/language documentation link must exist: ${strTarget}`);
	}

	const g_strModuleBindings = g_FileSystem.readFileSync(g_strModuleBindingsPath, "utf8");
	g_Assert.ok(g_strModuleBindings.includes("v8::Local<v8::Object> const LocalPlayerLanguageModule = MakeModule(pIsolate);"), "native players/language module installation");
	g_Assert.ok(g_strModuleBindings.includes('SetFunction(pIsolate, LocalContext, LocalPlayerLanguageModule, "GetClientCVarValue", GetPlayerClientCVarValueCallback'), "native client ConVar callback");
	g_Assert.ok(g_strModuleBindings.includes('SetFunction(pIsolate, LocalContext, LocalPlayerLanguageModule, "GetClientLanguage", GetPlayerClientLanguageCallback'), "native language callback");
	g_Assert.ok(g_strModuleBindings.includes('GetClientConVarValue(pEngineServer, nEntityIndex, kLanguageCVarName)'), "native cl_language query");
} catch (ErrorValue) {
	g_PrimaryFailure = ErrorValue;
	g_bFailed = true;
} finally {
	const vecCleanupFailures = [];
	for (const Restore of [RestoreOwnedLanguageCaches, RestorePackageCache, RestoreModuleLoader, RestoreSourceJS]) {
		try {
			Restore();
		} catch (ErrorValue) {
			vecCleanupFailures.push(ErrorValue);
		}
	}

	if (vecCleanupFailures.length > 0) {
		if (g_bFailed) {
			throw new AggregateError([g_PrimaryFailure, ...vecCleanupFailures], "Player language review and restoration failed.");
		}

		throw new AggregateError(vecCleanupFailures, "Player language restoration failed.");
	}
}

if (g_bFailed) {
	throw g_PrimaryFailure;
}

console.log("[  OK  ] smoke_players_language DocumentationScenarios=" + g_unDocumentationScenarioCount);
