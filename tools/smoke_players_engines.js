#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strPlayersEnginesDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "players-engines.md");
const g_strBMSDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "players-engines-bms.md");
const g_strCSGODocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "players-engines-csgo.md");
const g_strL4D2DocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "players-engines-l4d2.md");
const g_strOrangeBoxDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "players-engines-orangebox.md");
const g_strModuleBindingsPath = g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "modules", "ModuleBindings.cpp");
const g_strRuntimePath = g_Path.join(g_strPackageRootPath, "internal", "runtime.js");
const g_unDocumentationTimeoutMilliseconds = 1000;
const g_unEngineDocumentationBlockCount = 6;
const g_EngineDocumentationBlocks = { Import: 0, InspectBranch: 1, ItemEntity: 2, ItemIndex: 3, CSGOItem: 4, ServerCommand: 5 };
const g_setFixtureOwners = new Set();

// Bounds synchronous JavaScript only; this is not a security sandbox or native-IO cancellation.
function RunDocumentationFunction(Callback, Receiver, vecArguments, strLabel, strDocumentationPath = g_strPlayersEnginesDocumentationPath) {
	const Script = new g_VM.Script("Reflect.apply(Callback, Receiver, vecArguments)", { filename: `${strDocumentationPath}:${strLabel}` });

	return Script.runInNewContext({ Callback, Receiver, vecArguments, Reflect }, { timeout: g_unDocumentationTimeoutMilliseconds });
}

function RequirePlayersEngineDocumentationUnload(ModuleExports, bRequired) {
	const strRuntimeSource = g_FileSystem.readFileSync(g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "V8Runtime.cpp"), "utf8");
	const vecUnloadDefinition = strRuntimeSource.match(/^\tvoid V8Runtime::UnloadPlugin\([^\r\n]*\) \{[\s\S]*?^\t}/m);
	g_Assert.ok(vecUnloadDefinition, "Native plugin unload definition");
	g_Assert.match(vecUnloadDefinition[0], /CallPluginExportFunction\(strPluginName,\s*"Unload"\)/, "Player-engine documentation unload lookup must follow the current exact native export key");

	const Unload = ModuleExports.Unload;
	g_Assert.equal(Object.hasOwn(ModuleExports, "unload"), false, "No lowercase lifecycle alias");

	if (bRequired) {
		g_Assert.equal(typeof Unload, "function", "The command example must export the native unload entry point");
	}

	return Unload;
}

function RegisterFixtureCleanup(Cleanup) {
	const Release = () => {
		Cleanup();
		g_setFixtureOwners.delete(Release);
	};
	g_setFixtureOwners.add(Release);
}

function RestoreEngineProperty(Owner, strName, Descriptor) {
	if (Descriptor === undefined) {
		if (!Reflect.deleteProperty(Owner, strName)) {
			throw new Error(`Engine fixture could not delete temporary property ${strName}.`);
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
				throw new Error(`Engine fixture cannot replace non-configurable cache entry ${strFilePath}.`);
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
				RestoreEngineProperty(require.cache, strFilePath, undefined);
			} catch (ErrorValue) {
				vecErrors.push(ErrorValue);
			}
		}
	}

	if (vecErrors.length > 0) {
		throw new AggregateError(vecErrors, "Engine fixture cache purge failed.");
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
			RestoreEngineProperty(require.cache, strFilePath, Descriptor);
		} catch (ErrorValue) {
			vecErrors.push(ErrorValue);
		}
	}

	if (vecErrors.length > 0) {
		throw new AggregateError(vecErrors, "Engine fixture cache restoration failed.");
	}
}

function CreateNativeEngine(strBranch) {
	const vecNativeCalls = [];
	const NativeModule = {
		Branch: strBranch,

		GiveNamedItem(nPlayerIndex, strItem, ...vecOptionalArguments) {
			g_Assert.equal(Number.isInteger(nPlayerIndex), true, `${strBranch} integer player index`);
			g_Assert.equal(typeof strItem, "string", `${strBranch} item class string`);
			vecNativeCalls.push(["GiveNamedItem", [nPlayerIndex, strItem, ...vecOptionalArguments]]);

			return { Branch: strBranch, ClassName: strItem, Index: 40 };
		},

		GiveNamedItemIndex(nPlayerIndex, strItem, ...vecOptionalArguments) {
			g_Assert.equal(Number.isInteger(nPlayerIndex), true, `${strBranch} integer player index`);
			g_Assert.equal(typeof strItem, "string", `${strBranch} item class string`);
			vecNativeCalls.push(["GiveNamedItemIndex", [nPlayerIndex, strItem, ...vecOptionalArguments]]);

			return 40;
		},
	};

	Object.defineProperty(NativeModule, "NativeCalls", { configurable: false, enumerable: false, value: vecNativeCalls, writable: false });

	return NativeModule;
}

const g_NativeModules = {
	"players/engines": CreateNativeEngine("l4d2"),
	"players/engines/bms": CreateNativeEngine("bms"),
	"players/engines/csgo": CreateNativeEngine("csgo"),
	"players/engines/l4d2": CreateNativeEngine("l4d2"),
	"players/engines/orangebox": CreateNativeEngine("tf2"),
};

const g_ModuleLoadDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");
const g_SourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
const g_mapPackageCacheDescriptors = CapturePackageCacheDescriptors();

function LoadEngineModules() {
	const OriginalModuleLoad = g_Module._load;
	Object.defineProperty(g_Module, "_load", {
		...g_ModuleLoadDescriptor,

		value: function Load(strRequestName, ParentModule, bIsMain) {
			if (strRequestName === "internal/runtime") {
				return require(g_strRuntimePath);
			}

			return OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
		},
	});

	const EngineModules = {
		Engines: require(g_Path.join(g_strPackageRootPath, "players", "engines.js")),
		BMS: require(g_Path.join(g_strPackageRootPath, "players", "engines", "bms.js")),
		CSGO: require(g_Path.join(g_strPackageRootPath, "players", "engines", "csgo.js")),
		L4D2: require(g_Path.join(g_strPackageRootPath, "players", "engines", "l4d2.js")),
		OrangeBox: require(g_Path.join(g_strPackageRootPath, "players", "engines", "orangebox.js")),
	};

	RestoreEngineProperty(g_Module, "_load", g_ModuleLoadDescriptor);

	return EngineModules;
}

let g_bFailed = false;
let g_Failure = null;

try {
	PurgePackageCache();
	Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: g_SourceJSDescriptor?.enumerable ?? true, writable: true, value: g_NativeModules });

	const g_EngineModules = LoadEngineModules();
	const g_Engines = g_EngineModules.Engines;
	const g_BMS = g_EngineModules.BMS;
	const g_CSGO = g_EngineModules.CSGO;
	const g_L4D2 = g_EngineModules.L4D2;
	const g_OrangeBox = g_EngineModules.OrangeBox;

	g_Assert.ok(g_Engines === g_NativeModules["players/engines"], "players/engines must expose the exact native object.");
	g_Assert.ok(g_BMS === g_NativeModules["players/engines/bms"], "BMS module must expose its exact native object.");
	g_Assert.ok(g_CSGO === g_NativeModules["players/engines/csgo"], "CSGO module must expose its exact native object.");
	g_Assert.ok(g_L4D2 === g_NativeModules["players/engines/l4d2"], "L4D2 module must expose its exact native object.");
	g_Assert.ok(g_OrangeBox === g_NativeModules["players/engines/orangebox"], "OrangeBox module must expose its exact native object.");
	g_Assert.deepEqual(Object.keys(g_Engines).sort(), ["Branch", "GiveNamedItem", "GiveNamedItemIndex"], "players/engines exact exports");

	g_Assert.equal(g_CSGO.GiveNamedItemIndex(2, "weapon_ak47", 3, false), 40, "CSGO direct SDK result");
	g_Assert.equal(g_BMS.GiveNamedItemIndex(1, "weapon_crowbar", 2), 40, "BMS direct SDK result");
	g_Assert.equal(g_L4D2.GiveNamedItemIndex(3, "weapon_rifle", 4), 40, "L4D2 direct SDK result");
	g_Assert.equal(g_OrangeBox.GiveNamedItemIndex(4, "weapon_rocketlauncher", 5), 40, "OrangeBox direct SDK result");
	g_Assert.equal(g_CSGO.NativeCalls[0][1][3], false, "CSGO bRemoveIfNotCarried argument");

	for (const [strModuleName, NativeModule] of Object.entries(g_NativeModules)) {
		g_Assert.ok(!Object.hasOwn(NativeModule, "available"), `${strModuleName} must not expose an availability snapshot.`);
		g_Assert.ok(!Object.hasOwn(NativeModule, "Player"), `${strModuleName} must not re-export Player.`);
		g_Assert.ok(!Object.hasOwn(NativeModule, "moduleName"), `${strModuleName} must not expose moduleName.`);
		g_Assert.ok(!Object.hasOwn(NativeModule, "default"), `${strModuleName} must not expose a default alias.`);
	}

	const g_strObsoleteMemoryPath = g_Path.join(g_strPackageRootPath, "players", "engines", "_memory.js");
	g_Assert.ok(!g_FileSystem.existsSync(g_strObsoleteMemoryPath), "players/engines/_memory must not recreate SDK ABI in JavaScript.");

	const g_strDocumentation = g_FileSystem.readFileSync(g_strPlayersEnginesDocumentationPath, "utf8");
	const g_vecCodeBlocks = [...g_strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);

	const g_mapCommandRegistrations = new Map();
	RegisterFixtureCleanup(() => Map.prototype.clear.call(g_mapCommandRegistrations));

	const g_vecDocumentationLogs = [];
	const g_mapInvocationResults = new Map();
	const g_InvocationArguments = {
		CreateCSGOItem: [1, "weapon_test_csgo", 2, false],
		CreateItemEntity: [1, "weapon_test_entity", 0],
		CreateItemIndex: [1, "weapon_test_index", 0],
	};

	const g_vecRequiredSections = [
		"Import",
		"Exports",
		"Inspect the selected branch",
		"Create an item entity",
		"Return only the entity index",
		"CSGO ownership option",
		"Server command",
		"Errors",
		"Lifecycle",
		"Related modules",
	];

	let g_nDocumentationBlockIndex = -1;

	const g_ServerCommands = {
		RegisterCommand(strName, Callback) {
			g_mapCommandRegistrations.set(strName, Callback);

			return true;
		},

		UnregisterCommand(strName, Callback) {
			g_Assert.ok(g_mapCommandRegistrations.get(strName) === Callback, "server command cleanup callback");
			g_mapCommandRegistrations.delete(strName);

			return true;
		},
	};

	function RequireDocumentationModule(strModuleName) {
		if (strModuleName === "commands") {
			return { CommandReturn: { Continue: 0, Handled: 1, Block: 1 } };
		}

		if (strModuleName === "commands/server") {
			return g_ServerCommands;
		}

		if (strModuleName === "loggers") {
			return {
				LogInfo(strMessage) {
					g_vecDocumentationLogs.push(["INFO", strMessage]);

					return true;
				},

				LogWarning(strMessage) {
					g_vecDocumentationLogs.push(["WARNING", strMessage]);

					return true;
				},
			};
		}

		if (strModuleName === "players/engines") {
			return (g_nDocumentationBlockIndex === g_EngineDocumentationBlocks.CSGOItem) ? g_CSGO : g_Engines;
		}

		throw new Error(`unexpected documentation module ${strModuleName}`);
	}

	function CheckPlayersEngineDocumentationFailures(strDocumentation) {
		const vecCodeBlocks = [...strDocumentation.matchAll(/\x60\x60\x60js\r?\n([\s\S]*?)\x60\x60\x60/g)].map((vecMatch) => vecMatch[1]);
		const nMinimumInt32 = -0x80000000;
		const nMaximumInt32 = 0x7FFFFFFF;
		const vecScenarios = [];
		for (const Group of [
			{ Block: g_EngineDocumentationBlocks.Import, Cases: ["SUCCESS", "BADBRANCH", "MISSINGFUNCTION"] },
			{ Block: g_EngineDocumentationBlocks.InspectBranch, Cases: ["SUCCESS", "BADBRANCH"] },
			{
				Block: g_EngineDocumentationBlocks.ItemEntity,
				Cases: [
					"SUCCESS",
					"UNRESOLVED",
					"BADRESULT",
					"WIDERESULT",
					"BADCLASS",
					"NULITEM",
					"BADITEM",
					"BADPLAYER",
					"BADSUBTYPE",
					"NULLSUBTYPE",
					"DEFAULTSUBTYPE",
					"MINIMUMSUBTYPE",
					"NATIVEERROR",
					"NATIVENULL",
				],
			},
			{
				Block: g_EngineDocumentationBlocks.ItemIndex,
				Cases: [
					"SUCCESS",
					"UNRESOLVED",
					"BADRESULT",
					"WIDERESULT",
					"NULITEM",
					"BADPLAYER",
					"BADSUBTYPE",
					"NULLSUBTYPE",
					"DEFAULTSUBTYPE",
					"MINIMUMSUBTYPE",
					"NATIVEERROR",
					"NATIVENULL",
				],
			},
			{
				Block: g_EngineDocumentationBlocks.CSGOItem,
				Cases: [
					"SUCCESS",
					"WRONGBRANCH",
					"UNRESOLVED",
					"BADRESULT",
					"WIDERESULT",
					"NULITEM",
					"BADPLAYER",
					"BADSUBTYPE",
					"BADOPTION",
					"NULLOPTION",
					"OMITTEDOPTION",
					"FALSEOPTION",
					"NULLSUBTYPE",
					"DEFAULTSUBTYPE",
					"MINIMUMSUBTYPE",
					"NATIVEERROR",
					"NATIVENULL",
				],
			},
			{
				Block: g_EngineDocumentationBlocks.ServerCommand,
				Cases: [
					"SUCCESS",
					"WIDEPLAYER",
					"EXTRATOKEN",
					"MISSINGITEM",
					"NULITEM",
					"UNRESOLVED",
					"BADRESULT",
					"WIDERESULT",
					"NATIVEERROR",
					"NATIVENULL",
					"LOGFALSE",
					"LOGERROR",
					"UNRESOLVEDLOGFALSE",
					"UNRESOLVEDLOGERROR",
					"USAGELOGFALSE",
					"USAGELOGERROR",
					"REGISTERFALSE",
					"REGISTERERROR",
					"UNREGISTERFALSE",
					"UNREGISTERERROR",
				],
			},
		]) {
			for (const strCase of Group.Cases) {
				vecScenarios.push({ Block: Group.Block, Case: strCase });
			}
		}

		g_Assert.equal(vecCodeBlocks.length, g_unEngineDocumentationBlockCount, "players/engines fixture covers all six fences");

		for (const Scenario of vecScenarios) {
			RunDocumentationFunction(() => {
				const strCase = Scenario.Case;
				const strLabel = "players/engines fence " + Scenario.Block + " " + strCase;
				const OriginalError = new Error(strLabel);
				const vecCalls = [];
				const vecLogs = [];
				const mapRegistrations = new Map();
				RegisterFixtureCleanup(() => Map.prototype.clear.call(mapRegistrations));

				const mapReads = new Map();
				const strBranch = ((Scenario.Block === g_EngineDocumentationBlocks.CSGOItem) && (strCase !== "WRONGBRANCH")) ? "csgo" : "tf2";
				let unCommandReads = 0;
				let bCleanupFailure = strCase.startsWith("UNREGISTER");
				const Item = {};
				for (const strField of ["Index", "ClassName"]) {
					Object.defineProperty(Item, strField, {
						get() {
							const unReads = (mapReads.get(strField) ?? 0) + 1;
							mapReads.set(strField, unReads);
							g_Assert.equal(unReads, 1, strLabel + " reads item " + strField + " once");

							if (strField === "ClassName") {
								return (strCase === "BADCLASS") ? 40 : "sdk_item";
							}

							return (strCase === "BADRESULT") ? "40" : ((strCase === "WIDERESULT") ? (nMaximumInt32 + 1) : 40);
						},
					});
				}

				const InvokeSDK = (nPlayerIndex, strItem, nSubtype, bRemoveIfNotCarried) => {
					if (!Number.isInteger(nPlayerIndex) || (nPlayerIndex <= 0) || (nPlayerIndex > nMaximumInt32) || (typeof strItem !== "string") || (strItem.length === 0)) {
						throw new TypeError("Native input validation");
					}

					if ((nSubtype !== null) && (nSubtype !== undefined) && (!Number.isInteger(nSubtype) || (nSubtype < nMinimumInt32) || (nSubtype > nMaximumInt32))) {
						throw new TypeError("Native subtype validation");
					}

					if ((strBranch === "csgo") && (bRemoveIfNotCarried !== null) && (bRemoveIfNotCarried !== undefined) && (typeof bRemoveIfNotCarried !== "boolean")) {
						throw new TypeError("Native option validation");
					}

					g_Assert.ok(!strItem.includes("\0"), strLabel + " caller rejects NUL before SDK");

					const nResolvedSubtype = nSubtype ?? 0;
					const bResolvedOption = bRemoveIfNotCarried ?? true;
					vecCalls.push([nPlayerIndex, strItem, nResolvedSubtype, bResolvedOption]);

					if (strCase === "NATIVEERROR") {
						throw OriginalError;
					}

					if (strCase === "NATIVENULL") {
						throw null;
					}

					if (strCase.startsWith("UNRESOLVED")) {
						return -1;
					}

					return (strCase === "BADRESULT") ? -2 : ((strCase === "WIDERESULT") ? (nMaximumInt32 + 1) : 40);
				};
				const NativeModule = {
					Branch: (strCase === "BADBRANCH") ? "" : strBranch,

					GiveNamedItem(nPlayerIndex, strItem, nSubtype) {
						const nResult = InvokeSDK(nPlayerIndex, strItem, nSubtype);

						return (nResult === -1) ? null : Item;
					},

					GiveNamedItemIndex: InvokeSDK,
				};
				if (strCase === "MISSINGFUNCTION") {
					delete NativeModule.GiveNamedItemIndex;
				}

				const WriteLog = (strSeverity, strMessage) => {
					vecLogs.push([strSeverity, strMessage]);

					if (strCase.endsWith("LOGERROR")) {
						throw OriginalError;
					}

					return !strCase.endsWith("LOGFALSE");
				};

				const Modules = {
					"players/engines": NativeModule,
					"commands": { CommandReturn: { Continue: 0, Handled: 1, Block: 1 } },
					"commands/server": {
						RegisterCommand(strName, Callback) {
							if (strCase === "REGISTERERROR") {
								throw OriginalError;
							}

							if (strCase === "REGISTERFALSE") {
								return false;
							}

							mapRegistrations.set(strName, Callback);

							return true;
						},

						UnregisterCommand(strName, Callback) {
							g_Assert.equal(mapRegistrations.get(strName), Callback, strLabel + " exact callback");

							if (bCleanupFailure) {
								if (strCase === "UNREGISTERERROR") {
									throw OriginalError;
								}

								return false;
							}

							mapRegistrations.delete(strName);

							return true;
						},
					},
					"loggers": {
						LogInfo(strMessage) {
							return WriteLog("INFO", strMessage);
						},

						LogWarning(strMessage) {
							return WriteLog("WARNING", strMessage);
						},
					},
				};

				const ModuleRecord = { exports: {} };
				let Result = null;
				let ErrorValue = null;
				let bThrew = false;

				try {
					const Callback = g_VM.compileFunction(vecCodeBlocks[Scenario.Block], ["require", "module", "exports"], { filename: g_strPlayersEnginesDocumentationPath + ":" + strLabel });
					Callback((strName) => Modules[strName], ModuleRecord, ModuleRecord.exports);
					g_Assert.equal(vecCalls.length, 0, strLabel + " no SDK effects at load");

					if ((Scenario.Block >= g_EngineDocumentationBlocks.ItemEntity) && (Scenario.Block <= g_EngineDocumentationBlocks.CSGOItem)) {
						const nPlayerIndex = (strCase === "BADPLAYER") ? 1.5 : 1;
						const strItem = (strCase === "NULITEM") ? "item\0tail" : ((strCase === "BADITEM") ? "" : "sdk_item");
						const nSubtype = (strCase === "BADSUBTYPE") ? 0.5 : ((strCase === "NULLSUBTYPE") ? null : ((strCase === "DEFAULTSUBTYPE") ? undefined : ((strCase === "MINIMUMSUBTYPE") ? nMinimumInt32 : 7)));

						if (Scenario.Block === g_EngineDocumentationBlocks.ItemEntity) {
							Result = ModuleRecord.exports.CreateItemEntity(nPlayerIndex, strItem, nSubtype);

						} else if (Scenario.Block === g_EngineDocumentationBlocks.ItemIndex) {
							Result = ModuleRecord.exports.CreateItemIndex(nPlayerIndex, strItem, nSubtype);

						} else {
							const bRemoveIfNotCarried = (strCase === "BADOPTION") ? 1 : ((strCase === "NULLOPTION") ? null : strCase !== "FALSEOPTION");
							Result = (strCase === "OMITTEDOPTION") ? ModuleRecord.exports.CreateCSGOItem(nPlayerIndex, strItem, nSubtype) : ModuleRecord.exports.CreateCSGOItem(nPlayerIndex, strItem, nSubtype, bRemoveIfNotCarried);
						}

					} else if (Scenario.Block === g_EngineDocumentationBlocks.ServerCommand) {
						const vecArguments = ["sjs_give_item", (strCase === "WIDEPLAYER") ? "2147483648" : "1", (strCase === "NULITEM") ? "item\0tail" : "sdk_item"];
						if (strCase === "EXTRATOKEN") {
							vecArguments.push("extra");

						} else if ((strCase === "MISSINGITEM") || strCase.startsWith("USAGE")) {
							vecArguments.pop();
						}

						Result = ModuleRecord.exports.GiveItem({
							get Arguments() {
								++unCommandReads;
								g_Assert.equal(unCommandReads, 1, strLabel + " one command snapshot");
								g_Assert.equal(vecCalls.length, 0, strLabel + " snapshot before SDK");

								return vecArguments;
							},
						});
						Reflect.apply(RequirePlayersEngineDocumentationUnload(ModuleRecord.exports, true), ModuleRecord.exports, []);
					}
				} catch (CaughtError) {
					bThrew = true;
					ErrorValue = CaughtError;
				}

				const bUsage = (Scenario.Block === g_EngineDocumentationBlocks.ServerCommand) && (["WIDEPLAYER", "EXTRATOKEN", "MISSINGITEM", "NULITEM"].includes(strCase) || strCase.startsWith("USAGE"));
				const bExpectedFailure = ["BADBRANCH", "MISSINGFUNCTION", "BADRESULT", "WIDERESULT", "BADCLASS", "BADITEM", "BADPLAYER", "BADSUBTYPE", "BADOPTION", "WRONGBRANCH"].includes(strCase) || (strCase === "NATIVENULL") || strCase.endsWith("ERROR") || strCase.endsWith("FALSE") || ((strCase === "NULITEM") && !bUsage);
				g_Assert.equal(bThrew, bExpectedFailure, strLabel + " failure result");

				if (bThrew) {
					g_Assert.ok(!(ErrorValue instanceof g_Assert.AssertionError), strLabel + " validation error is not a fixture invariant failure");
				}

				if (strCase.endsWith("ERROR") || (strCase === "NATIVENULL")) {
					g_Assert.equal(ErrorValue, (strCase === "NATIVENULL") ? null : OriginalError, strLabel + " original thrown value");
				}

				if ([
					"BADPLAYER",
					"BADSUBTYPE",
					"BADOPTION",
					"BADITEM",
					"NULITEM",
					"WIDEPLAYER",
					"EXTRATOKEN",
					"MISSINGITEM",
					"WRONGBRANCH",
					"BADBRANCH",
					"MISSINGFUNCTION",
				].includes(strCase) || strCase.startsWith("USAGE") || strCase.startsWith("REGISTER")) {
					g_Assert.equal(vecCalls.length, 0, strLabel + " validation before SDK");
				}

				if ((Scenario.Block === g_EngineDocumentationBlocks.ItemEntity) && !bThrew) {
					g_Assert.equal(Result, (strCase === "UNRESOLVED") ? null : Item, strLabel + " wrapper identity");

					if (Result !== null) {
						g_Assert.equal(mapReads.get("Index"), 1, strLabel + " item index validated");
						g_Assert.equal(mapReads.get("ClassName"), 1, strLabel + " class validated");
					}
				}

				if (((Scenario.Block === g_EngineDocumentationBlocks.ItemIndex) || (Scenario.Block === g_EngineDocumentationBlocks.CSGOItem)) && !bThrew) {
					g_Assert.equal(Result, (strCase === "UNRESOLVED") ? -1 : 40, strLabel + " index sentinel");
				}

				if ((Scenario.Block >= g_EngineDocumentationBlocks.ItemEntity) && (Scenario.Block <= g_EngineDocumentationBlocks.CSGOItem) && !bThrew) {
					g_Assert.equal(vecCalls[0][2], ((strCase === "NULLSUBTYPE") || (strCase === "DEFAULTSUBTYPE")) ? 0 : ((strCase === "MINIMUMSUBTYPE") ? nMinimumInt32 : 7), strLabel + " exact subtype");

					if (Scenario.Block === g_EngineDocumentationBlocks.CSGOItem) {
						g_Assert.equal(vecCalls[0][3], strCase !== "FALSEOPTION", strLabel + " exact ownership option");
					}
				}

				if ((Scenario.Block === g_EngineDocumentationBlocks.ServerCommand) && !bThrew) {
					g_Assert.equal(Result, 1, strLabel + " command status");
					g_Assert.equal(unCommandReads, 1, strLabel + " command read");

					const strMessage = bUsage ? "Usage: sjs_give_item <player-index> <item-class>" : ((strCase === "UNRESOLVED") ? "GiveNamedItemIndex did not resolve sdk_item for player 1." : "GiveNamedItemIndex resolved sdk_item for player 1: entity 40.");
					g_Assert.deepEqual(vecLogs, [[(bUsage || (strCase === "UNRESOLVED")) ? "WARNING" : "INFO", strMessage]], strLabel + " truthful checked log");
				}

				if (bCleanupFailure) {
					g_Assert.equal(mapRegistrations.size, 1, strLabel + " pending cleanup");

					bCleanupFailure = false;
					Reflect.apply(RequirePlayersEngineDocumentationUnload(ModuleRecord.exports, true), ModuleRecord.exports, []);
				}

				if ((Scenario.Block === g_EngineDocumentationBlocks.ServerCommand) && !strCase.startsWith("REGISTER")) {
					if (bThrew && !strCase.startsWith("UNREGISTER")) {
						Reflect.apply(RequirePlayersEngineDocumentationUnload(ModuleRecord.exports, true), ModuleRecord.exports, []);
					}

					g_Assert.equal(mapRegistrations.size, 0, strLabel + " cleanup complete");
				}
			}, undefined, [], "EngineContract:" + Scenario.Block + ":" + Scenario.Case);
		}

		console.log("players/engines documentation scenarios passed: " + vecScenarios.length + "; native SDK calls mocked.");
	}

	CheckPlayersEngineDocumentationFailures(g_strDocumentation);

	g_Assert.equal(g_vecCodeBlocks.length, g_unEngineDocumentationBlockCount, "players/engines documentation workflow count");
	g_Assert.ok(!g_strDocumentation.includes("Generated by"), "players/engines documentation must be maintained by hand.");
	g_Assert.ok(g_strDocumentation.includes("CBasePlayer::GiveNamedItem()"), "players/engines documentation must name the direct SDK operation.");
	g_Assert.doesNotMatch(g_strDocumentation, /\bconsole\s*\./, "players/engines documentation must not depend on console output.");
	g_Assert.match(g_vecCodeBlocks[g_EngineDocumentationBlocks.Import], /const \{\s*GiveNamedItem,\s*GiveNamedItemIndex,\s*Branch,\s*\} = require\("players\/engines"\);/, "players/engines documentation must import every exact export directly.");

	for (const strSectionName of g_vecRequiredSections) {
		const strAnchor = strSectionName.toLowerCase().replace(/ /g, "-");
		g_Assert.ok(g_strDocumentation.includes(`- [${strSectionName}](#${strAnchor})`), `players/engines contents must link ${strSectionName}.`);
		g_Assert.ok(g_strDocumentation.includes(`## ${strSectionName}`), `players/engines documentation must contain ${strSectionName}.`);
	}

	for (let unIndex = 0; unIndex < g_vecCodeBlocks.length; ++unIndex) {
		RunDocumentationFunction(() => {
			g_nDocumentationBlockIndex = unIndex;

			const ModuleRecord = { exports: {} };
			const Callback = g_VM.compileFunction(g_vecCodeBlocks[unIndex], ["require", "module", "exports"], { filename: `${g_strPlayersEnginesDocumentationPath}:Root-${unIndex + 1}` });
			const unNativeCallCountBefore = ((g_nDocumentationBlockIndex === g_EngineDocumentationBlocks.CSGOItem) ? g_CSGO : g_Engines).NativeCalls.length;

			Callback(RequireDocumentationModule, ModuleRecord, ModuleRecord.exports);

			for (const [strInvocationName, vecInvocationArguments] of Object.entries(g_InvocationArguments)) {
				if (typeof ModuleRecord.exports[strInvocationName] !== "function") {
					continue;
				}

				const NativeModule = (g_nDocumentationBlockIndex === g_EngineDocumentationBlocks.CSGOItem) ? g_CSGO : g_Engines;
				g_Assert.equal(NativeModule.NativeCalls.length, unNativeCallCountBefore, `${strInvocationName} must not create an item during plugin load.`);
				g_mapInvocationResults.set(strInvocationName, ModuleRecord.exports[strInvocationName](...vecInvocationArguments));
			}

			if (typeof ModuleRecord.exports.GiveItem === "function") {
				g_Assert.equal(g_Engines.NativeCalls.length, unNativeCallCountBefore, "players/engines registration does not invoke SDK");
				g_Assert.equal(g_mapCommandRegistrations.get("sjs_give_item"), ModuleRecord.exports.GiveItem, "players/engines callback identity");
				g_Assert.equal(ModuleRecord.exports.GiveItem({ Arguments: ["sjs_give_item", "1", "weapon_pistol"] }), 1, "players/engines deliberate command invocation");
				Reflect.apply(RequirePlayersEngineDocumentationUnload(ModuleRecord.exports, true), ModuleRecord.exports, []);

			} else {
				const Unload = RequirePlayersEngineDocumentationUnload(ModuleRecord.exports, false);
				if (typeof Unload === "function") {
					Reflect.apply(Unload, ModuleRecord.exports, []);
				}
			}
		}, undefined, [], `Root-${unIndex + 1}`);
	}

	g_Assert.equal(g_mapCommandRegistrations.size, 0, "documented server command cleanup");
	g_Assert.ok(g_vecDocumentationLogs.some((vecEntry) => (vecEntry[0] === "INFO") && vecEntry[1].includes("weapon_pistol")), "server command must log the resolved item.");
	g_Assert.equal(g_mapInvocationResults.get("CreateItemEntity").ClassName, "weapon_test_entity", "entity-returning helper result");
	g_Assert.equal(g_mapInvocationResults.get("CreateItemIndex"), 40, "index-returning helper result");
	g_Assert.equal(g_mapInvocationResults.get("CreateCSGOItem"), 40, "CSGO ownership helper result");
	g_Assert.ok(g_Engines.NativeCalls.some((vecCall) => (vecCall[0] === "GiveNamedItem") && (vecCall[1][1] === "weapon_test_entity")), "documented entity-returning item creation");
	g_Assert.ok(g_Engines.NativeCalls.some((vecCall) => (vecCall[0] === "GiveNamedItemIndex") && (vecCall[1][1] === "weapon_test_index")), "documented index-returning item creation");
	g_Assert.ok(g_CSGO.NativeCalls.some((vecCall) => (vecCall[0] === "GiveNamedItemIndex") && (vecCall[1][1] === "weapon_test_csgo") && (vecCall[1][3] === false)), "documented CSGO bRemoveIfNotCarried call");

	const g_strDocumentationWithoutCode = g_strDocumentation.replace(/```[\s\S]*?```/g, "");
	const g_vecLinks = [...g_strDocumentationWithoutCode.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((vecMatch) => vecMatch[1]);
	for (const strTarget of g_vecLinks) {
		if (strTarget.startsWith("#") || /^[a-z]+:/i.test(strTarget)) {
			continue;
		}

		const strTargetPath = g_Path.resolve(g_Path.dirname(g_strPlayersEnginesDocumentationPath), strTarget.split("#", 1)[0]);
		g_Assert.ok(g_FileSystem.existsSync(strTargetPath), `players/engines documentation link must exist: ${strTarget}`);
	}

	function CheckBMSDocumentationFailures(strDocumentation) {
		const vecCodeBlocks = [...strDocumentation.matchAll(/\x60\x60\x60js\r?\n([\s\S]*?)\x60\x60\x60/g)].map((vecMatch) => vecMatch[1]);
		const vecScenarios = [
			["SUCCESS", "WRONGBRANCH", "MISSINGENTITYFUNCTION", "MISSINGINDEXFUNCTION"],
			["SUCCESS", "WRONGBRANCH"],
			[
				"SUCCESS",
				"NOENTITY",
				"BADINDEX",
				"BADCLASS",
				"EMPTYCLASS",
				"INDEXERROR",
				"CLASSERROR",
				"NATIVEERROR",
				"NATIVENULL",
			],
			[
				"SUCCESS",
				"NOENTITY",
				"BADINDEX",
				"MISSINGWRAPPER",
				"WRONGWRAPPER",
				"WRAPERROR",
				"NATIVEERROR",
				"NATIVENULL",
				"NEGATIVESUBTYPE",
				"NULLSUBTYPE",
				"STRINGSUBTYPE",
				"BIGINTSUBTYPE",
			],
			[
				"SUCCESS",
				"NOENTITY",
				"BADINDEX",
				"LOGGERFALSE",
				"LOGGERERROR",
				"WARNINGFALSE",
				"WARNINGERROR",
				"NATIVEERROR",
				"NATIVENULL",
				"REGISTERFALSE",
				"REGISTERERROR",
				"UNREGISTERFALSE",
				"UNREGISTERERROR",
			],
		];
		let unScenarioCount = 0;

		for (let unCodeBlockIndex = 0; unCodeBlockIndex < vecScenarios.length; ++unCodeBlockIndex) {
			for (const strScenario of vecScenarios[unCodeBlockIndex]) {
				++unScenarioCount;

				const OriginalError = (strScenario === "NATIVENULL") ? null : new Error(strScenario);
				const State = { NativeCalls: 0, IndexReads: 0, ClassReads: 0, CommandReads: 0, WrapCalls: 0, RegisterCalls: 0, UnregisterCalls: 0, FailUnregister: strScenario.startsWith("UNREGISTER"), Logs: [], Subtype: null };
				let RegisteredCallback = null;
				RegisterFixtureCleanup(() => {
					RegisteredCallback = null;
				});

				const Item = {
					get Index() {
						++State.IndexReads;
						if (State.IndexReads > 1) {
							throw new Error("item index was read more than once");
						}

						if (strScenario === "INDEXERROR") {
							throw OriginalError;
						}

						return (strScenario === "BADINDEX") ? -2 : 40;
					},

					get ClassName() {
						++State.ClassReads;
						if (State.ClassReads > 1) {
							throw new Error("item class name was read more than once");
						}

						if (strScenario === "CLASSERROR") {
							throw OriginalError;
						}

						return (strScenario === "BADCLASS") ? 42 : ((strScenario === "EMPTYCLASS") ? "" : "weapon_crowbar");
					},
				};

				const CurrentWeapon = { Index: (strScenario === "WRONGWRAPPER") ? 41 : 40 };

				const ValidateArguments = (nPlayerIndex, strItem, nSubtype) => {
					const nMinimumInt32 = -0x80000000;
					const nMaximumInt32 = 0x7FFFFFFF;

					if (!Number.isInteger(nPlayerIndex) || (nPlayerIndex < nMinimumInt32) || (nPlayerIndex > nMaximumInt32) || (typeof strItem !== "string") || (strItem.length === 0)) {
						throw new TypeError("invalid player or item argument");
					}

					if ((nSubtype !== null) && (nSubtype !== undefined) && (!Number.isInteger(nSubtype) || (nSubtype < nMinimumInt32) || (nSubtype > nMaximumInt32))) {
						throw new TypeError("invalid subtype argument");
					}
				};

				const NativeModule = {
					Branch: (strScenario === "WRONGBRANCH") ? "csgo" : "bms",

					GiveNamedItem(nPlayerIndex, strItem, nSubtype = 0) {
						ValidateArguments(nPlayerIndex, strItem, nSubtype);
						g_Assert.equal(strItem, "weapon_crowbar");
						++State.NativeCalls;

						if (strScenario.startsWith("NATIVE")) {
							throw OriginalError;
						}

						return (strScenario === "NOENTITY") ? null : Item;
					},

					GiveNamedItemIndex(nPlayerIndex, strItem, nSubtype = 0) {
						ValidateArguments(nPlayerIndex, strItem, nSubtype);
						g_Assert.equal(strItem, (unCodeBlockIndex === 3) ? "weapon_glock" : "weapon_crowbar");
						++State.NativeCalls;
						State.Subtype = (nSubtype === null) ? 0 : nSubtype;

						if (strScenario.startsWith("NATIVE")) {
							throw OriginalError;
						}

						return ["NOENTITY", "WARNINGFALSE", "WARNINGERROR"].includes(strScenario) ? -1 : ((strScenario === "BADINDEX") ? -2 : 40);
					},
				};

				if (strScenario === "MISSINGENTITYFUNCTION") {
					delete NativeModule.GiveNamedItem;
				}

				if (strScenario === "MISSINGINDEXFUNCTION") {
					delete NativeModule.GiveNamedItemIndex;
				}

				const BMSDocumentationBlocks = { Import: 0, ConfirmBranch: 1, Crowbar: 2, Glock: 3, ClientCommand: 4 };

				const Log = (strSeverity, strMessage) => {
					State.Logs.push([strSeverity, strMessage]);

					if ((strScenario === "LOGGERERROR") || (strScenario === "WARNINGERROR")) {
						throw OriginalError;
					}

					return (strScenario !== "LOGGERFALSE") && (strScenario !== "WARNINGFALSE");
				};

				const RequireModule = (strName) => {
					switch (strName) {
						case "players/engines/bms":
							return NativeModule;

						case "weapons/entity":
							return {
								Weapon(nEntityIndex) {
									++State.WrapCalls;
									g_Assert.equal(nEntityIndex, 40);

									if (strScenario === "WRAPERROR") {
										throw OriginalError;
									}

									return (strScenario === "MISSINGWRAPPER") ? null : CurrentWeapon;
								},
							};

						case "commands":
							return { CommandReturn: { Continue: 0, Block: 1, Handled: 1 } };

						case "commands/client":
							return {
								RegisterCommand(strName, Callback) {
									g_Assert.equal(strName, "sjs_bms_crowbar");
									++State.RegisterCalls;

									if (strScenario === "REGISTERERROR") {
										throw OriginalError;
									}

									if (strScenario === "REGISTERFALSE") {
										return false;
									}

									RegisteredCallback = Callback;

									return true;
								},

								UnregisterCommand(strName, Callback) {
									g_Assert.equal(strName, "sjs_bms_crowbar");
									g_Assert.equal(Callback, RegisteredCallback, "cleanup uses the registered callback");
									++State.UnregisterCalls;

									if (State.FailUnregister) {
										if (strScenario === "UNREGISTERERROR") {
											throw OriginalError;
										}

										return false;
									}

									RegisteredCallback = null;

									return true;
								},
							};

						case "loggers":
							return { LogInfo: (strMessage) => Log("INFO", strMessage), LogWarning: (strMessage) => Log("WARNING", strMessage) };

						default:
							throw new Error("unexpected BMS fixture module " + strName);
					}
				};

				const ModuleRecord = { exports: {} };
				const strLabel = `BMSContract-${unCodeBlockIndex}-${strScenario}`;
				const Callback = g_VM.compileFunction(vecCodeBlocks[unCodeBlockIndex], ["require", "module", "exports"], { filename: `${g_strBMSDocumentationPath}:${strLabel}` });
				const Execute = () => RunDocumentationFunction(Callback, undefined, [RequireModule, ModuleRecord, ModuleRecord.exports], strLabel + ":Initialize", g_strBMSDocumentationPath);
				const Unload = () => RunDocumentationFunction(() => Reflect.apply(RequirePlayersEngineDocumentationUnload(ModuleRecord.exports, true), undefined, []), undefined, [], strLabel + ":Unload", g_strBMSDocumentationPath);
				if ((strScenario === "WRONGBRANCH") || (strScenario.startsWith("MISSING") && (unCodeBlockIndex === BMSDocumentationBlocks.Import)) || strScenario.startsWith("REGISTER")) {
					g_Assert.throws(Execute, (ErrorValue) => (strScenario === "REGISTERERROR") ? ErrorValue === OriginalError : /invalid native surface|Expected the bms|Unable to register/.test(ErrorValue.message));
					g_Assert.equal(State.NativeCalls, 0);
					g_Assert.equal(RegisteredCallback, null);
					continue;
				}

				Execute();
				g_Assert.equal(State.NativeCalls, 0, "loading a BMS example never requests an item");

				if (unCodeBlockIndex <= BMSDocumentationBlocks.ConfirmBranch) {
					if (unCodeBlockIndex === BMSDocumentationBlocks.Import) {
						g_Assert.equal(ModuleRecord.exports.GiveNamedItem, NativeModule.GiveNamedItem);
						g_Assert.equal(ModuleRecord.exports.GiveNamedItemIndex, NativeModule.GiveNamedItemIndex);
					}

					g_Assert.equal(ModuleRecord.exports.Branch ?? ModuleRecord.exports.SelectedBranch, "bms");
					continue;
				}

				const Command = {
					get Index() {
						++State.CommandReads;
						if (State.CommandReads > 1) {
							throw new Error("command index was read again after the item request");
						}

						return 1;
					},
				};

				const Invoke = () => RunDocumentationFunction(() => {
					if (unCodeBlockIndex === BMSDocumentationBlocks.Crowbar) {
						return ModuleRecord.exports.CreateBMSCrowbar(1);
					}

					if (unCodeBlockIndex === BMSDocumentationBlocks.Glock) {
						const SubtypeValue = (strScenario === "NEGATIVESUBTYPE") ? -3 : ((strScenario === "NULLSUBTYPE") ? null : ((strScenario === "STRINGSUBTYPE") ? "1" : ((strScenario === "BIGINTSUBTYPE") ? 1n : 0)));
						return ModuleRecord.exports.CreateBMSGlock(1, SubtypeValue);
					}

					return ModuleRecord.exports.GiveCrowbar(Command);
				}, undefined, [], strLabel + ":Action", g_strBMSDocumentationPath);
				if ([
					"NATIVEERROR",
					"NATIVENULL",
					"INDEXERROR",
					"CLASSERROR",
					"WRAPERROR",
					"LOGGERERROR",
					"WARNINGERROR",
				].includes(strScenario)) {
					g_Assert.throws(Invoke, (ErrorValue) => ErrorValue === OriginalError, "post-request failures preserve the original error, including null");

				} else if ([
					"BADINDEX",
					"BADCLASS",
					"EMPTYCLASS",
					"MISSINGWRAPPER",
					"WRONGWRAPPER",
					"LOGGERFALSE",
					"WARNINGFALSE",
					"STRINGSUBTYPE",
					"BIGINTSUBTYPE",
				].includes(strScenario)) {
					g_Assert.throws(Invoke, (ErrorValue) => /invalid|Unable to/.test(ErrorValue.message));

				} else {
					let Result = null;
					g_Assert.doesNotThrow(() => {
						Result = Invoke();
					}, "a successful BMS request reads live fields only once");
					g_Assert.equal(Result, (unCodeBlockIndex === BMSDocumentationBlocks.ClientCommand) ? 1 : ((strScenario === "NOENTITY") ? null : ((unCodeBlockIndex === BMSDocumentationBlocks.Crowbar) ? Item : CurrentWeapon)));
				}

				g_Assert.equal(State.NativeCalls, ["STRINGSUBTYPE", "BIGINTSUBTYPE"].includes(strScenario) ? 0 : 1, "a later validation/logging failure never retries the irreversible request");

				if (unCodeBlockIndex === BMSDocumentationBlocks.Glock) {
					g_Assert.equal(State.WrapCalls, [
						"SUCCESS",
						"NEGATIVESUBTYPE",
						"NULLSUBTYPE",
						"MISSINGWRAPPER",
						"WRONGWRAPPER",
						"WRAPERROR",
					].includes(strScenario) ? 1 : 0);

					if ((strScenario === "NEGATIVESUBTYPE") || (strScenario === "NULLSUBTYPE")) {
						g_Assert.equal(State.Subtype, (strScenario === "NEGATIVESUBTYPE") ? -3 : 0);
					}
				}

				if (unCodeBlockIndex === BMSDocumentationBlocks.ClientCommand) {
					g_Assert.equal(State.CommandReads, 1, "command identity is captured before the item request");

					const bReachedLog = [
						"SUCCESS",
						"NOENTITY",
						"LOGGERFALSE",
						"LOGGERERROR",
						"WARNINGFALSE",
						"WARNINGERROR",
						"UNREGISTERFALSE",
						"UNREGISTERERROR",
					].includes(strScenario);
					g_Assert.equal(State.Logs.length, bReachedLog ? 1 : 0);

					if (bReachedLog) {
						const bUnresolvedItem = ["NOENTITY", "WARNINGFALSE", "WARNINGERROR"].includes(strScenario);
						g_Assert.deepEqual(State.Logs[0], bUnresolvedItem ? ["WARNING", "BMS did not return a live crowbar entity for player 1."] : ["INFO", "BMS crowbar request for player 1: entity 40."]);
					}

					g_Assert.equal(State.RegisterCalls, 1);

					if (State.FailUnregister) {
						g_Assert.throws(Unload, (ErrorValue) => (strScenario === "UNREGISTERERROR") ? ErrorValue === OriginalError : /Unable to unregister/.test(ErrorValue.message));
						g_Assert.equal(RegisteredCallback, ModuleRecord.exports.GiveCrowbar);

						State.FailUnregister = false;
					}

					g_Assert.doesNotThrow(Unload);
					g_Assert.equal(RegisteredCallback, null);
					g_Assert.equal(State.UnregisterCalls, strScenario.startsWith("UNREGISTER") ? 2 : 1);
				}
			}
		}

		process.stdout.write("players/engines/bms documentation: " + unScenarioCount + " branch, sentinel, original-error, one-read, logging, and command-cleanup scenarios passed; SDK calls mocked.\n");
	}

	const g_unBMSDocumentationBlockCount = 5;
	const g_strBMSDocumentation = g_FileSystem.readFileSync(g_strBMSDocumentationPath, "utf8");
	CheckBMSDocumentationFailures(g_strBMSDocumentation);

	const g_vecBMSCodeBlocks = [...g_strBMSDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);

	const g_mapBMSCommandRegistrations = new Map();
	RegisterFixtureCleanup(() => Map.prototype.clear.call(g_mapBMSCommandRegistrations));

	const g_vecBMSDocumentationLogs = [];
	const g_mapBMSInvocationResults = new Map();
	const g_BMSInvocationArguments = { CreateBMSCrowbar: [1], CreateBMSGlock: [1, 0] };

	const g_vecBMSRequiredSections = [
		"Import",
		"Exports",
		"Confirm the BMS build",
		"Give a crowbar",
		"Resolve the weapon by index",
		"Client command",
		"Errors",
		"Lifecycle",
		"Related modules",
	];

	const g_BMSClientCommands = {
		RegisterCommand(strName, Callback) {
			g_mapBMSCommandRegistrations.set(strName, Callback);

			return true;
		},

		UnregisterCommand(strName, Callback) {
			g_Assert.ok(g_mapBMSCommandRegistrations.get(strName) === Callback, "BMS client command cleanup callback");
			g_mapBMSCommandRegistrations.delete(strName);

			return true;
		},
	};

	function RequireBMSDocumentationModule(strModuleName) {
		if (strModuleName === "commands") {
			return { CommandReturn: { Continue: 0, Handled: 1, Block: 1 } };
		}

		if (strModuleName === "commands/client") {
			return g_BMSClientCommands;
		}

		if (strModuleName === "loggers") {
			return {
				LogInfo(strMessage) {
					g_vecBMSDocumentationLogs.push(`[INFO] ${strMessage}`);

					return true;
				},

				LogWarning(strMessage) {
					g_vecBMSDocumentationLogs.push(`[WARNING] ${strMessage}`);

					return true;
				},
			};
		}

		if (strModuleName === "players/engines/bms") {
			return g_BMS;
		}

		if (strModuleName === "weapons/entity") {
			return {
				Weapon(unIndex) {
					g_Assert.equal(unIndex, 40, "documented BMS weapon index");

					return { Index: unIndex, WeaponName: "glock" };
				},
			};
		}

		throw new Error(`unexpected BMS documentation module ${strModuleName}`);
	}

	g_Assert.equal(g_vecBMSCodeBlocks.length, g_unBMSDocumentationBlockCount, "players/engines/bms documentation workflow count");
	g_Assert.ok(!g_strBMSDocumentation.includes("Generated by"), "players/engines/bms documentation must be maintained by hand.");
	g_Assert.ok(g_strBMSDocumentation.includes("CBasePlayer::GiveNamedItem()"), "players/engines/bms documentation must name the direct SDK operation.");
	g_Assert.doesNotMatch(g_strBMSDocumentation, /\bconsole\s*\./, "players/engines/bms documentation must not depend on console output.");
	g_Assert.match(g_vecBMSCodeBlocks[0], /const \{\s*GiveNamedItem,\s*GiveNamedItemIndex,\s*Branch,\s*\} = require\("players\/engines\/bms"\);/, "players/engines/bms documentation must import every exact export directly.");

	for (const strSectionName of g_vecBMSRequiredSections) {
		const strAnchor = strSectionName.toLowerCase().replace(/ /g, "-");
		g_Assert.ok(g_strBMSDocumentation.includes(`- [${strSectionName}](#${strAnchor})`), `players/engines/bms contents must link ${strSectionName}.`);
		g_Assert.ok(g_strBMSDocumentation.includes(`## ${strSectionName}`), `players/engines/bms documentation must contain ${strSectionName}.`);
	}

	for (let unIndex = 0; unIndex < g_vecBMSCodeBlocks.length; ++unIndex) {
		RunDocumentationFunction(() => {
			const ModuleRecord = { exports: {} };
			const Callback = g_VM.compileFunction(g_vecBMSCodeBlocks[unIndex], ["require", "module", "exports"], { filename: `${g_strBMSDocumentationPath}:Root-${unIndex + 1}` });
			const unNativeCallCountBefore = g_BMS.NativeCalls.length;

			Callback(RequireBMSDocumentationModule, ModuleRecord, ModuleRecord.exports);

			for (const [strInvocationName, vecInvocationArguments] of Object.entries(g_BMSInvocationArguments)) {
				if (typeof ModuleRecord.exports[strInvocationName] !== "function") {
					continue;
				}

				g_Assert.equal(g_BMS.NativeCalls.length, unNativeCallCountBefore, `${strInvocationName} must not create an item during plugin load.`);
				g_mapBMSInvocationResults.set(strInvocationName, ModuleRecord.exports[strInvocationName](...vecInvocationArguments));
			}

			if (typeof ModuleRecord.exports.GiveCrowbar === "function") {
				g_Assert.equal(g_BMS.NativeCalls.length, unNativeCallCountBefore, "BMS command registration must not request an item");
				g_Assert.equal(ModuleRecord.exports.GiveCrowbar({ Index: 1 }), 1, "documented BMS client command result");
				Reflect.apply(RequirePlayersEngineDocumentationUnload(ModuleRecord.exports, true), ModuleRecord.exports, []);

				const FailureModuleRecord = { exports: {} };
				const unLogCountBefore = g_vecBMSDocumentationLogs.length;
				let bFailureExampleFailed = false;
				let FailureExampleError = null;

				function RequireCreationFailureModule(strModuleName) {
					if (strModuleName === "players/engines/bms") {
						return {
							...g_BMS,

							GiveNamedItemIndex() {
								return -1;
							},
						};
					}

					return RequireBMSDocumentationModule(strModuleName);
				}

				try {
					Callback(RequireCreationFailureModule, FailureModuleRecord, FailureModuleRecord.exports);
					g_Assert.equal(FailureModuleRecord.exports.GiveCrowbar({ Index: 1 }), 1, "unresolved BMS result is handled without retrying creation");
					g_Assert.equal(g_vecBMSDocumentationLogs.length, unLogCountBefore + 1, "BMS creation failure must emit exactly one diagnostic.");
					g_Assert.equal(g_vecBMSDocumentationLogs[unLogCountBefore], "[WARNING] BMS did not return a live crowbar entity for player 1.", "unresolved BMS result must not be logged as successful creation.");
				} catch (ErrorValue) {
					bFailureExampleFailed = true;
					FailureExampleError = ErrorValue;
				}

				try {
					const Unload = RequirePlayersEngineDocumentationUnload(FailureModuleRecord.exports, !bFailureExampleFailed);
					if (typeof Unload === "function") {
						Reflect.apply(Unload, FailureModuleRecord.exports, []);
					}
				} catch (CleanupError) {
					if (bFailureExampleFailed) {
						throw new AggregateError([FailureExampleError, CleanupError], "BMS failure-example execution and cleanup failed.");
					}

					throw CleanupError;
				}

				if (bFailureExampleFailed) {
					throw FailureExampleError;
				}

			} else {
				const Unload = RequirePlayersEngineDocumentationUnload(ModuleRecord.exports, false);
				if (typeof Unload === "function") {
					Reflect.apply(Unload, ModuleRecord.exports, []);
				}
			}
		}, undefined, [], `Root-${unIndex + 1}`, g_strBMSDocumentationPath);
	}

	g_Assert.equal(g_mapBMSCommandRegistrations.size, 0, "documented BMS client command cleanup");
	g_Assert.ok(g_vecBMSDocumentationLogs.some((strMessage) => strMessage.includes("BMS crowbar")), "BMS client command must log the created item.");
	g_Assert.equal(g_mapBMSInvocationResults.get("CreateBMSCrowbar").ClassName, "weapon_crowbar", "documented BMS crowbar entity creation");
	g_Assert.equal(g_mapBMSInvocationResults.get("CreateBMSGlock").Index, 40, "documented BMS Glock wrapper creation");
	g_Assert.ok(g_BMS.NativeCalls.some((vecCall) => (vecCall[0] === "GiveNamedItem") && (vecCall[1][1] === "weapon_crowbar")), "documented BMS crowbar native call");
	g_Assert.ok(g_BMS.NativeCalls.some((vecCall) => (vecCall[0] === "GiveNamedItemIndex") && (vecCall[1][1] === "weapon_glock")), "documented BMS Glock index call");

	const g_strBMSDocumentationWithoutCode = g_strBMSDocumentation.replace(/```[\s\S]*?```/g, "");
	const g_vecBMSLinks = [...g_strBMSDocumentationWithoutCode.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((vecMatch) => vecMatch[1]);
	for (const strTarget of g_vecBMSLinks) {
		if (strTarget.startsWith("#") || /^[a-z]+:/i.test(strTarget)) {
			continue;
		}

		const strTargetPath = g_Path.resolve(g_Path.dirname(g_strBMSDocumentationPath), strTarget.split("#", 1)[0]);
		g_Assert.ok(g_FileSystem.existsSync(strTargetPath), `players/engines/bms documentation link must exist: ${strTarget}`);
	}

	const g_unCSGODocumentationBlockCount = 6;
	const g_strCSGODocumentation = g_FileSystem.readFileSync(g_strCSGODocumentationPath, "utf8");
	const g_vecCSGOCodeBlocks = [...g_strCSGODocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);

	const g_mapCSGOCommandRegistrations = new Map();
	RegisterFixtureCleanup(() => Map.prototype.clear.call(g_mapCSGOCommandRegistrations));

	const g_vecCSGODocumentationLogs = [];
	const g_mapCSGOInvocationResults = new Map();
	const g_CSGOInvocationArguments = { CreateCSGOAK47: [1], CreateCSGOM4A1: [1], CreateRetainedDeagle: [1] };

	const g_vecCSGORequiredSections = [
		"Import",
		"Exports",
		"Confirm the CSGO build",
		"Give an AK-47",
		"Keep an uncarried item",
		"Use a weapon wrapper",
		"Server command",
		"Errors",
		"Lifecycle",
		"Related modules",
	];

	const g_CSGOServerCommands = {
		RegisterCommand(strName, Callback) {
			g_mapCSGOCommandRegistrations.set(strName, Callback);

			return true;
		},

		UnregisterCommand(strName, Callback) {
			g_Assert.ok(g_mapCSGOCommandRegistrations.get(strName) === Callback, "CSGO server command cleanup callback");
			g_mapCSGOCommandRegistrations.delete(strName);

			return true;
		},
	};

	function RequireCSGODocumentationModule(strModuleName) {
		if (strModuleName === "commands") {
			return { CommandReturn: { Continue: 0, Handled: 1, Block: 1 } };
		}

		if (strModuleName === "commands/server") {
			return g_CSGOServerCommands;
		}

		if (strModuleName === "loggers") {
			return {
				LogInfo(strMessage) {
					g_vecCSGODocumentationLogs.push(["INFO", strMessage]);

					return true;
				},

				LogWarning(strMessage) {
					g_vecCSGODocumentationLogs.push(["WARNING", strMessage]);

					return true;
				},
			};
		}

		if (strModuleName === "players/engines/csgo") {
			return g_CSGO;
		}

		if (strModuleName === "weapons/entity") {
			return {
				Weapon(unIndex) {
					g_Assert.equal(unIndex, 40, "documented CSGO weapon index");

					return { Index: unIndex, WeaponName: "m4a1" };
				},
			};
		}

		throw new Error(`unexpected CSGO documentation module ${strModuleName}`);
	}

	function CheckCSGODocumentationFailures(strDocumentation) {
		const CSGODocumentationBlocks = { Import: 0, ConfirmBranch: 1, AK47: 2, RetainedDeagle: 3, M4A1: 4, ServerCommand: 5 };
		const vecCodeBlocks = [...strDocumentation.matchAll(/\x60\x60\x60js\r?\n([\s\S]*?)\x60\x60\x60/g)].map((vecMatch) => vecMatch[1]);
		const vecScenarios = [
			{ Block: CSGODocumentationBlocks.Import, Case: "SUCCESS" },
			{ Block: CSGODocumentationBlocks.Import, Case: "WRONGBRANCH" },
			{ Block: CSGODocumentationBlocks.Import, Case: "MISSINGITEM" },
			{ Block: CSGODocumentationBlocks.Import, Case: "MISSINGINDEX" },
			{ Block: CSGODocumentationBlocks.ConfirmBranch, Case: "SUCCESS" },
			{ Block: CSGODocumentationBlocks.ConfirmBranch, Case: "WRONGBRANCH" },
			{ Block: CSGODocumentationBlocks.AK47, Case: "SUCCESS" },
			{ Block: CSGODocumentationBlocks.AK47, Case: "NOENTITY" },
			{ Block: CSGODocumentationBlocks.AK47, Case: "BADINDEX" },
			{ Block: CSGODocumentationBlocks.AK47, Case: "FRACTIONINDEX" },
			{ Block: CSGODocumentationBlocks.AK47, Case: "BIGINTINDEX" },
			{ Block: CSGODocumentationBlocks.AK47, Case: "BADCLASS" },
			{ Block: CSGODocumentationBlocks.AK47, Case: "EMPTYCLASS" },
			{ Block: CSGODocumentationBlocks.AK47, Case: "INDEXERROR" },
			{ Block: CSGODocumentationBlocks.AK47, Case: "CLASSERROR" },
			{ Block: CSGODocumentationBlocks.AK47, Case: "NATIVEERROR" },
			{ Block: CSGODocumentationBlocks.AK47, Case: "NATIVENULL" },
			{ Block: CSGODocumentationBlocks.RetainedDeagle, Case: "SUCCESS" },
			{ Block: CSGODocumentationBlocks.RetainedDeagle, Case: "NOENTITY" },
			{ Block: CSGODocumentationBlocks.RetainedDeagle, Case: "BADINDEX" },
			{ Block: CSGODocumentationBlocks.RetainedDeagle, Case: "FRACTIONINDEX" },
			{ Block: CSGODocumentationBlocks.RetainedDeagle, Case: "BIGINTINDEX" },
			{ Block: CSGODocumentationBlocks.RetainedDeagle, Case: "NATIVEERROR" },
			{ Block: CSGODocumentationBlocks.RetainedDeagle, Case: "NATIVENULL" },
			{ Block: CSGODocumentationBlocks.M4A1, Case: "SUCCESS" },
			{ Block: CSGODocumentationBlocks.M4A1, Case: "NOENTITY" },
			{ Block: CSGODocumentationBlocks.M4A1, Case: "BADINDEX" },
			{ Block: CSGODocumentationBlocks.M4A1, Case: "FRACTIONINDEX" },
			{ Block: CSGODocumentationBlocks.M4A1, Case: "BIGINTINDEX" },
			{ Block: CSGODocumentationBlocks.M4A1, Case: "NOWRAPPER" },
			{ Block: CSGODocumentationBlocks.M4A1, Case: "WRONGWRAPPER" },
			{ Block: CSGODocumentationBlocks.M4A1, Case: "WRAPPERERROR" },
			{ Block: CSGODocumentationBlocks.M4A1, Case: "NATIVEERROR" },
			{ Block: CSGODocumentationBlocks.M4A1, Case: "NATIVENULL" },
			{ Block: CSGODocumentationBlocks.ServerCommand, Case: "SUCCESS" },
			{ Block: CSGODocumentationBlocks.ServerCommand, Case: "KEEP" },
			{ Block: CSGODocumentationBlocks.ServerCommand, Case: "NOENTITY" },
			{ Block: CSGODocumentationBlocks.ServerCommand, Case: "BADINDEX" },
			{ Block: CSGODocumentationBlocks.ServerCommand, Case: "FRACTIONINDEX" },
			{ Block: CSGODocumentationBlocks.ServerCommand, Case: "BIGINTINDEX" },
			{ Block: CSGODocumentationBlocks.ServerCommand, Case: "MISSINGPLAYER" },
			{ Block: CSGODocumentationBlocks.ServerCommand, Case: "ZEROPLAYER" },
			{ Block: CSGODocumentationBlocks.ServerCommand, Case: "FRACTIONPLAYER" },
			{ Block: CSGODocumentationBlocks.ServerCommand, Case: "WIDEPLAYER" },
			{ Block: CSGODocumentationBlocks.ServerCommand, Case: "EMPTYITEM" },
			{ Block: CSGODocumentationBlocks.ServerCommand, Case: "NULITEM" },
			{ Block: CSGODocumentationBlocks.ServerCommand, Case: "BADMODE" },
			{ Block: CSGODocumentationBlocks.ServerCommand, Case: "EXTRATOKEN" },
			{ Block: CSGODocumentationBlocks.ServerCommand, Case: "REGISTERFALSE" },
			{ Block: CSGODocumentationBlocks.ServerCommand, Case: "REGISTERERROR" },
			{ Block: CSGODocumentationBlocks.ServerCommand, Case: "UNREGISTERFALSE" },
			{ Block: CSGODocumentationBlocks.ServerCommand, Case: "UNREGISTERERROR" },
			{ Block: CSGODocumentationBlocks.ServerCommand, Case: "LOGFALSE" },
			{ Block: CSGODocumentationBlocks.ServerCommand, Case: "LOGERROR" },
			{ Block: CSGODocumentationBlocks.ServerCommand, Case: "WARNINGFALSE" },
			{ Block: CSGODocumentationBlocks.ServerCommand, Case: "WARNINGERROR" },
			{ Block: CSGODocumentationBlocks.ServerCommand, Case: "NATIVEERROR" },
			{ Block: CSGODocumentationBlocks.ServerCommand, Case: "NATIVENULL" },
		];
		g_Assert.equal(vecCodeBlocks.length, g_unCSGODocumentationBlockCount, "CSGO failure fixture covers every fence");

		for (const Scenario of vecScenarios) {
			RunDocumentationFunction(() => {
				const strCase = Scenario.Case;
				const strLabel = `CSGO fence ${Scenario.Block} ${strCase}`;
				const OriginalError = new Error(strLabel);
				const vecCalls = [];
				const vecLogs = [];
				const mapRegistrations = new Map();
				RegisterFixtureCleanup(() => Map.prototype.clear.call(mapRegistrations));

				const vecArguments = ["sjs_csgo_item", "1", "weapon_awp"];
				const CommandReturn = { Continue: 0, Block: 1, Handled: 1 };
				let unIndexReads = 0;
				let unClassReads = 0;
				let bCleanupFailure = strCase.startsWith("UNREGISTER");

				if (strCase === "MISSINGPLAYER") {
					vecArguments.splice(1);

				} else if (strCase === "ZEROPLAYER") {
					vecArguments[1] = "0";

				} else if (strCase === "FRACTIONPLAYER") {
					vecArguments[1] = "1.5";

				} else if (strCase === "WIDEPLAYER") {
					vecArguments[1] = "2147483648";

				} else if (strCase === "EMPTYITEM") {
					vecArguments[2] = "";

				} else if (strCase === "NULITEM") {
					vecArguments[2] = "weapon_awp\0suffix";

				} else if (strCase === "BADMODE") {
					vecArguments.push("retain");

				} else if (strCase === "EXTRATOKEN") {
					vecArguments.push("keep", "extra");

				} else if (strCase === "KEEP") {
					vecArguments.push("keep");
				}

				const IndexResult = (strCase === "BADINDEX") ? -2 : ((strCase === "FRACTIONINDEX") ? 40.5 : ((strCase === "BIGINTINDEX") ? 40n : 40));
				const Item = {};
				Object.defineProperties(Item, {
					Index: {
						get() {
							++unIndexReads;
							g_Assert.equal(unIndexReads, 1, `${strLabel} reads item index once`);

							if (strCase === "INDEXERROR") {
								throw OriginalError;
							}

							return IndexResult;
						},
					},

					ClassName: {
						get() {
							++unClassReads;
							g_Assert.equal(unClassReads, 1, `${strLabel} reads class name once`);

							if (strCase === "CLASSERROR") {
								throw OriginalError;
							}

							return (strCase === "BADCLASS") ? 123 : ((strCase === "EMPTYCLASS") ? "" : "weapon_ak47");
						},
					},
				});

				const NativeModule = {
					Branch: (strCase === "WRONGBRANCH") ? "bms" : "csgo",

					GiveNamedItem(nPlayerIndex, strItem) {
						vecCalls.push(["GiveNamedItem", nPlayerIndex, strItem]);

						if (strCase === "NATIVEERROR") {
							throw OriginalError;
						}

						if (strCase === "NATIVENULL") {
							throw null;
						}

						return (strCase === "NOENTITY") ? null : Item;
					},

					GiveNamedItemIndex(nPlayerIndex, strItem, nSubtype, bRemoveIfNotCarried) {
						vecCalls.push(["GiveNamedItemIndex", nPlayerIndex, strItem, nSubtype, bRemoveIfNotCarried]);

						if (strCase === "NATIVEERROR") {
							throw OriginalError;
						}

						if (strCase === "NATIVENULL") {
							throw null;
						}

						return ((strCase === "NOENTITY") || strCase.startsWith("WARNING")) ? -1 : IndexResult;
					},
				};
				if (strCase === "MISSINGITEM") {
					delete NativeModule.GiveNamedItem;

				} else if (strCase === "MISSINGINDEX") {
					delete NativeModule.GiveNamedItemIndex;
				}

				const WeaponView = { Index: (strCase === "WRONGWRAPPER") ? 41 : 40 };

				const Modules = {
					"players/engines/csgo": NativeModule,
					"commands": { CommandReturn },
					"commands/server": {
						RegisterCommand(strName, Callback) {
							if (strCase === "REGISTERERROR") {
								throw OriginalError;
							}

							if (strCase === "REGISTERFALSE") {
								return false;
							}

							mapRegistrations.set(strName, Callback);

							return true;
						},

						UnregisterCommand(strName, Callback) {
							g_Assert.equal(mapRegistrations.get(strName), Callback, `${strLabel} exact callback`);

							if (bCleanupFailure) {
								if (strCase === "UNREGISTERERROR") {
									throw OriginalError;
								}

								return false;
							}

							mapRegistrations.delete(strName);

							return true;
						},
					},
					"loggers": {
						LogInfo(strMessage) {
							vecLogs.push(["INFO", strMessage]);

							if (strCase === "LOGERROR") {
								throw OriginalError;
							}

							return strCase !== "LOGFALSE";
						},

						LogWarning(strMessage) {
							vecLogs.push(["WARNING", strMessage]);

							if (strCase === "WARNINGERROR") {
								throw OriginalError;
							}

							return strCase !== "WARNINGFALSE";
						},
					},
					"weapons/entity": {
						Weapon(nEntityIndex) {
							g_Assert.equal(nEntityIndex, 40, `${strLabel} weapon index`);

							if (strCase === "WRAPPERERROR") {
								throw OriginalError;
							}

							return (strCase === "NOWRAPPER") ? null : WeaponView;
						},
					},
				};

				const ModuleRecord = { exports: {} };
				let ErrorValue = null;
				let bThrew = false;
				let Result = null;

				try {
					const Callback = g_VM.compileFunction(vecCodeBlocks[Scenario.Block], ["require", "module", "exports"], { filename: g_strCSGODocumentationPath + ":" + strLabel });
					Callback((strName) => Modules[strName], ModuleRecord, ModuleRecord.exports);
					g_Assert.equal(vecCalls.length, 0, `${strLabel} does not mutate at load`);

					if (Scenario.Block === CSGODocumentationBlocks.AK47) {
						Result = ModuleRecord.exports.CreateCSGOAK47(1);

					} else if (Scenario.Block === CSGODocumentationBlocks.RetainedDeagle) {
						Result = ModuleRecord.exports.CreateRetainedDeagle(1);

					} else if (Scenario.Block === CSGODocumentationBlocks.M4A1) {
						Result = ModuleRecord.exports.CreateCSGOM4A1(1);

					} else if (Scenario.Block === CSGODocumentationBlocks.ServerCommand) {
						g_Assert.equal(mapRegistrations.get("sjs_csgo_item"), ModuleRecord.exports.GiveCSGOItem, `${strLabel} registered handler`);
						Result = ModuleRecord.exports.GiveCSGOItem({ Arguments: vecArguments });
						Reflect.apply(RequirePlayersEngineDocumentationUnload(ModuleRecord.exports, true), ModuleRecord.exports, []);
					}
				} catch (CaughtError) {
					bThrew = true;
					ErrorValue = CaughtError;
				}

				const bInvalidCommand = (Scenario.Block === CSGODocumentationBlocks.ServerCommand) && [
					"MISSINGPLAYER",
					"ZEROPLAYER",
					"FRACTIONPLAYER",
					"WIDEPLAYER",
					"EMPTYITEM",
					"NULITEM",
					"BADMODE",
					"EXTRATOKEN",
				].includes(strCase);
				const bExpectedFailure = !["SUCCESS", "KEEP", "NOENTITY"].includes(strCase) && !bInvalidCommand;
				g_Assert.equal(bThrew, bExpectedFailure, `${strLabel} failure result`);

				if ([
					"BADINDEX",
					"FRACTIONINDEX",
					"BIGINTINDEX",
					"BADCLASS",
					"EMPTYCLASS",
					"NOWRAPPER",
					"WRONGWRAPPER",
				].includes(strCase)) {
					let strExpectedErrorMessage = "";
					if (Scenario.Block === CSGODocumentationBlocks.AK47) {
						strExpectedErrorMessage = "CSGO returned an invalid AK-47 entity.";

					} else if (Scenario.Block === CSGODocumentationBlocks.RetainedDeagle) {
						strExpectedErrorMessage = "CSGO returned an invalid Desert Eagle entity index.";

					} else if (Scenario.Block === CSGODocumentationBlocks.M4A1) {
						strExpectedErrorMessage = ["NOWRAPPER", "WRONGWRAPPER"].includes(strCase) ? "Unable to wrap CSGO weapon 40." : "CSGO returned an invalid M4A1 entity index.";

					} else {
						strExpectedErrorMessage = "CSGO returned an invalid entity index.";
					}

					g_Assert.equal(ErrorValue.message, strExpectedErrorMessage, `${strLabel} explicit validation diagnostic`);
				}

				if (strCase.endsWith("ERROR") || (strCase === "NATIVENULL")) {
					g_Assert.equal(ErrorValue, (strCase === "NATIVENULL") ? null : OriginalError, `${strLabel} original thrown value`);
				}

				const unExpectedCallCount = ((Scenario.Block < CSGODocumentationBlocks.AK47) || bInvalidCommand || strCase.startsWith("REGISTER")) ? 0 : 1;
				g_Assert.equal(vecCalls.length, unExpectedCallCount, `${strLabel} no blind retry`);

				if ((Scenario.Block === CSGODocumentationBlocks.AK47) && (strCase === "SUCCESS")) {
					g_Assert.equal(Result, Item, `${strLabel} borrowed entity identity`);
				}

				if ((Scenario.Block === CSGODocumentationBlocks.M4A1) && (strCase === "SUCCESS")) {
					g_Assert.equal(Result, WeaponView, `${strLabel} decorated weapon identity`);
				}

				if ((Scenario.Block === CSGODocumentationBlocks.RetainedDeagle) && !bThrew) {
					g_Assert.equal(Result, (strCase === "NOENTITY") ? -1 : 40, `${strLabel} signed result`);
				}

				if (((Scenario.Block === CSGODocumentationBlocks.AK47) || (Scenario.Block === CSGODocumentationBlocks.M4A1)) && (strCase === "NOENTITY")) {
					g_Assert.equal(Result, null, `${strLabel} unresolved result`);
				}

				if ((Scenario.Block === CSGODocumentationBlocks.ServerCommand) && !bThrew) {
					g_Assert.equal(Result, bInvalidCommand ? CommandReturn.Block : CommandReturn.Handled, `${strLabel} command result`);

					const strSeverity = (bInvalidCommand || (strCase === "NOENTITY")) ? "WARNING" : "INFO";
					g_Assert.equal(vecLogs.length, 1, `${strLabel} one log record`);
					g_Assert.equal(vecLogs[0][0], strSeverity, `${strLabel} log severity`);

					if (bInvalidCommand) {
						g_Assert.equal(vecLogs[0][1], "Usage: sjs_csgo_item <player-index> <item-class> [keep]", `${strLabel} full usage`);

					} else {
						const bRemoveIfNotCarried = strCase !== "KEEP";
						const strExpectedMessage = (strCase === "NOENTITY") ? `CSGO did not return a live item weapon_awp for player 1, RemoveIfNotCarried=${bRemoveIfNotCarried}.` : `CSGO item request weapon_awp for player 1: entity 40, RemoveIfNotCarried=${bRemoveIfNotCarried}.`;
						g_Assert.equal(vecLogs[0][1], strExpectedMessage, `${strLabel} request diagnostic`);
					}
				}

				if ((Scenario.Block >= CSGODocumentationBlocks.RetainedDeagle) && (vecCalls.length === 1)) {
					const strExpectedItem = (Scenario.Block === CSGODocumentationBlocks.RetainedDeagle) ? "weapon_deagle" : ((Scenario.Block === CSGODocumentationBlocks.M4A1) ? "weapon_m4a1" : "weapon_awp");
					const bExpectedRemoval = (Scenario.Block !== CSGODocumentationBlocks.RetainedDeagle) && (strCase !== "KEEP");
					g_Assert.deepEqual(vecCalls[0], ["GiveNamedItemIndex", 1, strExpectedItem, 0, bExpectedRemoval], `${strLabel} exact SDK argument forwarding`);
				}

				if (bCleanupFailure) {
					g_Assert.equal(mapRegistrations.size, 1, `${strLabel} failed cleanup remains pending`);

					bCleanupFailure = false;
					Reflect.apply(RequirePlayersEngineDocumentationUnload(ModuleRecord.exports, true), ModuleRecord.exports, []);
				}

				if ((Scenario.Block === CSGODocumentationBlocks.ServerCommand) && !strCase.startsWith("REGISTER")) {
					if (bThrew && !strCase.startsWith("UNREGISTER")) {
						g_Assert.equal(mapRegistrations.size, 1, `${strLabel} request error preserves registration`);
						Reflect.apply(RequirePlayersEngineDocumentationUnload(ModuleRecord.exports, true), ModuleRecord.exports, []);
					}

					g_Assert.equal(mapRegistrations.size, 0, `${strLabel} cleanup completed`);
				}
			}, undefined, [], `CSGOContract-${Scenario.Block}-${Scenario.Case}`, g_strCSGODocumentationPath);
		}

		console.log(`CSGO documentation failure scenarios passed: ${vecScenarios.length}.`);
	}

	CheckCSGODocumentationFailures(g_strCSGODocumentation);

	g_Assert.equal(g_vecCSGOCodeBlocks.length, g_unCSGODocumentationBlockCount, "players/engines/csgo documentation workflow count");
	g_Assert.ok(!g_strCSGODocumentation.includes("Generated by"), "players/engines/csgo documentation must be maintained by hand.");
	g_Assert.ok(g_strCSGODocumentation.includes("CBasePlayer::GiveNamedItem()"), "players/engines/csgo documentation must name the direct SDK operation.");
	g_Assert.doesNotMatch(g_strCSGODocumentation, /\bconsole\s*\./, "players/engines/csgo documentation must not depend on console output.");
	g_Assert.match(g_vecCSGOCodeBlocks[0], /const \{[\s\S]*?GiveNamedItem,[\s\S]*?GiveNamedItemIndex,[\s\S]*?Branch,[\s\S]*?\} = require\("players\/engines\/csgo"\);/, "players/engines/csgo documentation must import every exact export.");

	for (const strSectionName of g_vecCSGORequiredSections) {
		const strAnchor = strSectionName.toLowerCase().replace(/ /g, "-");
		g_Assert.ok(g_strCSGODocumentation.includes(`- [${strSectionName}](#${strAnchor})`), `players/engines/csgo contents must link ${strSectionName}.`);
		g_Assert.ok(g_strCSGODocumentation.includes(`## ${strSectionName}`), `players/engines/csgo documentation must contain ${strSectionName}.`);
	}

	for (let unIndex = 0; unIndex < g_vecCSGOCodeBlocks.length; ++unIndex) {
		RunDocumentationFunction(() => {
			const ModuleRecord = { exports: {} };
			const Callback = g_VM.compileFunction(g_vecCSGOCodeBlocks[unIndex], ["require", "module", "exports"], { filename: `${g_strCSGODocumentationPath}:Root-${unIndex + 1}` });
			const unNativeCallCountBefore = g_CSGO.NativeCalls.length;

			Callback(RequireCSGODocumentationModule, ModuleRecord, ModuleRecord.exports);

			for (const [strInvocationName, vecInvocationArguments] of Object.entries(g_CSGOInvocationArguments)) {
				if (typeof ModuleRecord.exports[strInvocationName] !== "function") {
					continue;
				}

				g_Assert.equal(g_CSGO.NativeCalls.length, unNativeCallCountBefore, `${strInvocationName} must not create an item during plugin load.`);
				g_mapCSGOInvocationResults.set(strInvocationName, ModuleRecord.exports[strInvocationName](...vecInvocationArguments));
			}

			if (typeof ModuleRecord.exports.GiveCSGOItem === "function") {
				g_Assert.equal(g_CSGO.NativeCalls.length, unNativeCallCountBefore, "CSGO command registration does not create an item at load");
				g_Assert.equal(ModuleRecord.exports.GiveCSGOItem({ Arguments: ["sjs_csgo_item", "1", "weapon_awp", "keep"] }), 1, "documented CSGO command result");
				Reflect.apply(RequirePlayersEngineDocumentationUnload(ModuleRecord.exports, true), ModuleRecord.exports, []);

			} else {
				const Unload = RequirePlayersEngineDocumentationUnload(ModuleRecord.exports, false);
				if (typeof Unload === "function") {
					Reflect.apply(Unload, ModuleRecord.exports, []);
				}
			}
		}, undefined, [], `Root-${unIndex + 1}`, g_strCSGODocumentationPath);
	}

	g_Assert.equal(g_mapCSGOCommandRegistrations.size, 0, "documented CSGO server command cleanup");
	g_Assert.ok(g_vecCSGODocumentationLogs.some((vecEntry) => (vecEntry[0] === "INFO") && vecEntry[1].includes("weapon_awp")), "CSGO server command must log the created item.");
	g_Assert.equal(g_mapCSGOInvocationResults.get("CreateCSGOAK47").ClassName, "weapon_ak47", "documented CSGO AK-47 entity creation");
	g_Assert.equal(g_mapCSGOInvocationResults.get("CreateRetainedDeagle"), 40, "documented CSGO retained Desert Eagle creation");
	g_Assert.equal(g_mapCSGOInvocationResults.get("CreateCSGOM4A1").Index, 40, "documented CSGO M4A1 wrapper creation");
	g_Assert.ok(g_CSGO.NativeCalls.some((vecCall) => (vecCall[0] === "GiveNamedItem") && (vecCall[1][1] === "weapon_ak47")), "documented CSGO AK-47 native call");
	g_Assert.ok(g_CSGO.NativeCalls.some((vecCall) => (vecCall[0] === "GiveNamedItemIndex") && (vecCall[1][1] === "weapon_deagle") && (vecCall[1][3] === false)), "documented CSGO retained Desert Eagle native call");
	g_Assert.ok(g_CSGO.NativeCalls.some((vecCall) => (vecCall[0] === "GiveNamedItemIndex") && (vecCall[1][1] === "weapon_m4a1") && (vecCall[1][3] === true)), "documented CSGO M4A1 native call");
	g_Assert.ok(g_CSGO.NativeCalls.some((vecCall) => (vecCall[0] === "GiveNamedItemIndex") && (vecCall[1][1] === "weapon_awp") && (vecCall[1][3] === false)), "documented CSGO server command forwarding");

	const g_strCSGODocumentationWithoutCode = g_strCSGODocumentation.replace(/```[\s\S]*?```/g, "");
	const g_vecCSGOLinks = [...g_strCSGODocumentationWithoutCode.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((vecMatch) => vecMatch[1]);
	for (const strTarget of g_vecCSGOLinks) {
		if (strTarget.startsWith("#") || /^[a-z]+:/i.test(strTarget)) {
			continue;
		}

		const strTargetPath = g_Path.resolve(g_Path.dirname(g_strCSGODocumentationPath), strTarget.split("#", 1)[0]);
		g_Assert.ok(g_FileSystem.existsSync(strTargetPath), `players/engines/csgo documentation link must exist: ${strTarget}`);
	}

	const g_unL4D2DocumentationBlockCount = 6;
	const g_strL4D2Documentation = g_FileSystem.readFileSync(g_strL4D2DocumentationPath, "utf8");
	const g_vecL4D2CodeBlocks = [...g_strL4D2Documentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);

	const g_mapL4D2CommandRegistrations = new Map();
	RegisterFixtureCleanup(() => Map.prototype.clear.call(g_mapL4D2CommandRegistrations));

	const g_vecL4D2DocumentationLogs = [];
	const g_mapL4D2InvocationResults = new Map();
	const g_L4D2InvocationArguments = { CreateL4D2Loadout: [1], CreateL4D2Pistol: [1], CreateL4D2Rifle: [1] };

	const g_vecL4D2RequiredSections = [
		"Import",
		"Exports",
		"Confirm the L4D2 build",
		"Give a pistol",
		"Give a survivor loadout",
		"Use a weapon wrapper",
		"Client command",
		"Errors",
		"Lifecycle",
		"Related modules",
	];

	const g_L4D2ClientCommands = {
		RegisterCommand(strName, Callback) {
			g_mapL4D2CommandRegistrations.set(strName, Callback);

			return true;
		},

		UnregisterCommand(strName, Callback) {
			g_Assert.ok(g_mapL4D2CommandRegistrations.get(strName) === Callback, "L4D2 client command cleanup callback");
			g_mapL4D2CommandRegistrations.delete(strName);

			return true;
		},
	};

	function RequireL4D2DocumentationModule(strModuleName) {
		if (strModuleName === "commands") {
			return { CommandReturn: { Continue: 0, Handled: 1, Block: 1 } };
		}

		if (strModuleName === "commands/client") {
			return g_L4D2ClientCommands;
		}

		if (strModuleName === "loggers") {
			return {
				LogInfo(strMessage) {
					g_vecL4D2DocumentationLogs.push(strMessage);

					return true;
				},

				LogWarning(strMessage) {
					g_vecL4D2DocumentationLogs.push(strMessage);

					return true;
				},
			};
		}

		if (strModuleName === "players/engines/l4d2") {
			return g_L4D2;
		}

		if (strModuleName === "weapons/entity") {
			return {
				Weapon(unIndex) {
					g_Assert.equal(unIndex, 40, "documented L4D2 weapon index");

					return { Index: unIndex, WeaponName: "rifle" };
				},
			};
		}

		throw new Error(`unexpected L4D2 documentation module ${strModuleName}`);
	}

	function CheckL4D2DocumentationFailures(strDocumentation) {
		const vecCodeBlocks = [...strDocumentation.matchAll(/\x60\x60\x60js\r?\n([\s\S]*?)\x60\x60\x60/g)].map((vecMatch) => vecMatch[1]);
		const vecScenarios = [];
		for (let unBlock = 0; unBlock < g_unL4D2DocumentationBlockCount; ++unBlock) {
			const vecCases = (unBlock < 2) ? ["SUCCESS", "WRONGBRANCH"] : [
				"SUCCESS",
				"NONE",
				"BADINDEX",
				"FRACTIONINDEX",
				"BIGINTINDEX",
				"NATIVEERROR",
				"NATIVENULL",
			];
			for (const strCase of vecCases) {
				vecScenarios.push({ Block: unBlock, Case: strCase });
			}
		}

		for (const strCase of ["MISSINGITEM", "MISSINGINDEX"]) {
			vecScenarios.push({ Block: 0, Case: strCase });
		}

		for (const strCase of ["BADCLASS", "EMPTYCLASS", "INDEXERROR", "CLASSERROR"]) {
			vecScenarios.push({ Block: 2, Case: strCase });
		}

		for (const strCase of [
			"MIXED",
			"SECONDERROR",
			"SECONDNULL",
			"BADSECOND",
			"FRACTIONSECOND",
			"BIGINTSECOND",
		]) {
			vecScenarios.push({ Block: 3, Case: strCase });
		}

		for (const strCase of ["NOWRAPPER", "WRONGWRAPPER", "WRAPPERERROR"]) {
			vecScenarios.push({ Block: 4, Case: strCase });
		}

		for (const strCase of [
			"REGISTERFALSE",
			"REGISTERERROR",
			"UNREGISTERFALSE",
			"UNREGISTERERROR",
			"LOGFALSE",
			"LOGERROR",
			"WARNINGFALSE",
			"WARNINGERROR",
		]) {
			vecScenarios.push({ Block: 5, Case: strCase });
		}

		g_Assert.equal(vecCodeBlocks.length, g_unL4D2DocumentationBlockCount, "L4D2 fixture covers every fence");

		for (const Scenario of vecScenarios) {
			RunDocumentationFunction(() => {
				const L4D2DocumentationBlocks = { Import: 0, ConfirmBranch: 1, Pistol: 2, Loadout: 3, Rifle: 4, ClientCommand: 5 };
				const strCase = Scenario.Case;
				const strLabel = `L4D2 fence ${Scenario.Block} ${strCase}`;
				const OriginalError = new Error(strLabel);
				const vecCalls = [];
				const vecLogs = [];
				const mapRegistrations = new Map();
				RegisterFixtureCleanup(() => Map.prototype.clear.call(mapRegistrations));

				let unIndexReads = 0;
				let unClassReads = 0;
				let unCommandIndexReads = 0;
				let bCleanupFailure = strCase.startsWith("UNREGISTER");
				const Item = {};
				Object.defineProperties(Item, {
					Index: {
						get() {
							++unIndexReads;
							g_Assert.equal(unIndexReads, 1, `${strLabel} reads item index once`);

							if (strCase === "INDEXERROR") {
								throw OriginalError;
							}

							return (strCase === "BADINDEX") ? -2 : ((strCase === "FRACTIONINDEX") ? 40.5 : ((strCase === "BIGINTINDEX") ? 40n : 40));
						},
					},

					ClassName: {
						get() {
							++unClassReads;
							g_Assert.equal(unClassReads, 1, `${strLabel} reads class name once`);

							if (strCase === "CLASSERROR") {
								throw OriginalError;
							}

							return (strCase === "BADCLASS") ? 123 : ((strCase === "EMPTYCLASS") ? "" : "weapon_pistol");
						},
					},
				});

				const CallNative = (strMethod, nPlayerIndex, strItem, vecOptionalArguments) => {
					g_Assert.equal(nPlayerIndex, 1, `${strLabel} original player index`);

					const strExpectedItem = (Scenario.Block === L4D2DocumentationBlocks.Pistol) ? "weapon_pistol" : ((Scenario.Block === L4D2DocumentationBlocks.Rifle) ? "weapon_rifle" : ((Scenario.Block === L4D2DocumentationBlocks.ClientCommand) ? "weapon_first_aid_kit" : ((vecCalls.length === 0) ? "weapon_pistol" : "weapon_pain_pills")));
					g_Assert.equal(strItem, strExpectedItem, `${strLabel} exact SDK item name`);
					g_Assert.deepEqual(vecOptionalArguments, (Scenario.Block === L4D2DocumentationBlocks.Rifle) ? [0] : [], `${strLabel} L4D2 argument count`);
					vecCalls.push([strMethod, nPlayerIndex, strItem, ...vecOptionalArguments]);

					if ((strCase === "NATIVEERROR") || ((strCase === "SECONDERROR") && (vecCalls.length === 2))) {
						throw OriginalError;
					}

					if ((strCase === "NATIVENULL") || ((strCase === "SECONDNULL") && (vecCalls.length === 2))) {
						throw null;
					}

					if ((strCase === "NONE") || strCase.startsWith("WARNING") || ((strCase === "MIXED") && (vecCalls.length === 2))) {
						return (strMethod === "GiveNamedItem") ? null : -1;
					}

					if ((strCase === "BADINDEX") || ((strCase === "BADSECOND") && (vecCalls.length === 2))) {
						return -2;
					}

					if ((strCase === "FRACTIONINDEX") || ((strCase === "FRACTIONSECOND") && (vecCalls.length === 2))) {
						return 40.5;
					}

					if ((strCase === "BIGINTINDEX") || ((strCase === "BIGINTSECOND") && (vecCalls.length === 2))) {
						return 40n;
					}

					return (strMethod === "GiveNamedItem") ? Item : 40;
				};

				const NativeModule = {
					Branch: (strCase === "WRONGBRANCH") ? "csgo" : "l4d2",

					GiveNamedItem(nPlayerIndex, strItem, ...vecOptionalArguments) {
						const Result = CallNative("GiveNamedItem", nPlayerIndex, strItem, vecOptionalArguments);

						return ((strCase === "BADINDEX") || (strCase === "FRACTIONINDEX") || (strCase === "BIGINTINDEX")) ? Item : Result;
					},

					GiveNamedItemIndex(nPlayerIndex, strItem, ...vecOptionalArguments) {
						return CallNative("GiveNamedItemIndex", nPlayerIndex, strItem, vecOptionalArguments);
					},
				};
				if (strCase === "MISSINGITEM") {
					delete NativeModule.GiveNamedItem;

				} else if (strCase === "MISSINGINDEX") {
					delete NativeModule.GiveNamedItemIndex;
				}

				const WeaponView = { Index: (strCase === "WRONGWRAPPER") ? 41 : 40 };

				const WriteLog = (strSeverity, strMessage) => {
					vecLogs.push([strSeverity, strMessage]);

					if ((strCase === "LOGERROR") || (strCase === "WARNINGERROR")) {
						throw OriginalError;
					}

					return (strCase !== "LOGFALSE") && (strCase !== "WARNINGFALSE");
				};

				const Modules = {
					"players/engines/l4d2": NativeModule,
					"commands": { CommandReturn: { Continue: 0, Handled: 1, Block: 1 } },
					"commands/client": {
						RegisterCommand(strName, Callback) {
							if (strCase === "REGISTERERROR") {
								throw OriginalError;
							}

							if (strCase === "REGISTERFALSE") {
								return false;
							}

							mapRegistrations.set(strName, Callback);

							return true;
						},

						UnregisterCommand(strName, Callback) {
							g_Assert.equal(mapRegistrations.get(strName), Callback, `${strLabel} exact cleanup callback`);

							if (bCleanupFailure) {
								if (strCase === "UNREGISTERERROR") {
									throw OriginalError;
								}

								return false;
							}

							mapRegistrations.delete(strName);

							return true;
						},
					},
					"loggers": {
						LogInfo(strMessage) {
							return WriteLog("INFO", strMessage);
						},

						LogWarning(strMessage) {
							return WriteLog("WARNING", strMessage);
						},
					},
					"weapons/entity": {
						Weapon(nEntityIndex) {
							g_Assert.equal(nEntityIndex, 40, `${strLabel} rifle index`);

							if (strCase === "WRAPPERERROR") {
								throw OriginalError;
							}

							return (strCase === "NOWRAPPER") ? null : WeaponView;
						},
					},
				};

				const ModuleRecord = { exports: {} };
				const Command = {
					get Index() {
						++unCommandIndexReads;
						g_Assert.equal(unCommandIndexReads, 1, `${strLabel} reads player index once`);
						g_Assert.equal(vecCalls.length, 0, `${strLabel} snapshots index before SDK`);

						return 1;
					},
				};

				let Result = null;
				let ErrorValue = null;
				let bThrew = false;

				try {
					const Callback = g_VM.compileFunction(vecCodeBlocks[Scenario.Block], ["require", "module", "exports"], { filename: g_strL4D2DocumentationPath + ":" + strLabel });
					Callback((strName) => Modules[strName], ModuleRecord, ModuleRecord.exports);
					g_Assert.equal(vecCalls.length, 0, `${strLabel} no SDK mutation at load`);

					if (Scenario.Block === L4D2DocumentationBlocks.Pistol) {
						Result = ModuleRecord.exports.CreateL4D2Pistol(1);

					} else if (Scenario.Block === L4D2DocumentationBlocks.Loadout) {
						Result = ModuleRecord.exports.CreateL4D2Loadout(1);

					} else if (Scenario.Block === L4D2DocumentationBlocks.Rifle) {
						Result = ModuleRecord.exports.CreateL4D2Rifle(1);

					} else if (Scenario.Block === L4D2DocumentationBlocks.ClientCommand) {
						g_Assert.equal(mapRegistrations.get("sjs_l4d2_medkit"), ModuleRecord.exports.GiveFirstAidKit, `${strLabel} registered handler`);
						Result = ModuleRecord.exports.GiveFirstAidKit(Command);
						Reflect.apply(RequirePlayersEngineDocumentationUnload(ModuleRecord.exports, true), ModuleRecord.exports, []);
					}
				} catch (CaughtError) {
					bThrew = true;
					ErrorValue = CaughtError;
				}

				const bExpectedFailure = !["SUCCESS", "NONE", "MIXED"].includes(strCase);
				g_Assert.equal(bThrew, bExpectedFailure, `${strLabel} failure result`);

				if (strCase.endsWith("ERROR") || strCase.endsWith("NULL")) {
					g_Assert.equal(ErrorValue, strCase.endsWith("NULL") ? null : OriginalError, `${strLabel} preserves thrown value`);
				}

				const unExpectedCallCount = ((Scenario.Block < L4D2DocumentationBlocks.Pistol) || strCase.startsWith("REGISTER")) ? 0 : (((Scenario.Block === L4D2DocumentationBlocks.Loadout) && (["SUCCESS", "NONE", "MIXED"].includes(strCase) || strCase.includes("SECOND"))) ? 2 : 1);
				g_Assert.equal(vecCalls.length, unExpectedCallCount, `${strLabel} stops on first failure/no blind retry`);

				if ((Scenario.Block === L4D2DocumentationBlocks.ClientCommand) && !strCase.startsWith("REGISTER")) {
					g_Assert.equal(unCommandIndexReads, 1, `${strLabel} captures actual command index`);
				}

				if (((Scenario.Block === L4D2DocumentationBlocks.Pistol) || (Scenario.Block === L4D2DocumentationBlocks.Rifle)) && !bThrew) {
					g_Assert.equal(Result, (strCase === "NONE") ? null : ((Scenario.Block === L4D2DocumentationBlocks.Pistol) ? Item : WeaponView), `${strLabel} borrowed view identity`);
				}

				if ((Scenario.Block === L4D2DocumentationBlocks.Loadout) && !bThrew) {
					g_Assert.deepEqual(Result, { CreatedIndexes: (strCase === "NONE") ? [] : ((strCase === "MIXED") ? [40] : [40, 40]), RequestedCount: 2 }, `${strLabel} exact resolved-index record including duplicate indexes`);
				}

				if (["NOWRAPPER", "WRONGWRAPPER"].includes(strCase)) {
					g_Assert.equal(ErrorValue.message, "Unable to wrap L4D2 weapon 40.", `${strLabel} explicit wrapper diagnostic`);
				}

				if ((Scenario.Block === L4D2DocumentationBlocks.ClientCommand) && !bThrew) {
					g_Assert.equal(Result, 1, `${strLabel} handled command`);

					const strExpectedMessage = (strCase === "NONE") ? "L4D2 did not return a live first aid kit for player 1." : "L4D2 first aid kit request for player 1: entity 40.";
					g_Assert.deepEqual(vecLogs, [[(strCase === "NONE") ? "WARNING" : "INFO", strExpectedMessage]], `${strLabel} request log severity/context`);
				}

				if (bCleanupFailure) {
					g_Assert.equal(mapRegistrations.size, 1, `${strLabel} failed cleanup pending`);

					bCleanupFailure = false;
					Reflect.apply(RequirePlayersEngineDocumentationUnload(ModuleRecord.exports, true), ModuleRecord.exports, []);
				}

				if ((Scenario.Block === L4D2DocumentationBlocks.ClientCommand) && !strCase.startsWith("REGISTER")) {
					if (bThrew && !strCase.startsWith("UNREGISTER")) {
						g_Assert.equal(mapRegistrations.size, 1, `${strLabel} request failure preserves registration`);
						Reflect.apply(RequirePlayersEngineDocumentationUnload(ModuleRecord.exports, true), ModuleRecord.exports, []);
					}

					g_Assert.equal(mapRegistrations.size, 0, `${strLabel} cleanup complete`);
				}
			}, undefined, [], `L4D2Contract-${Scenario.Block}-${Scenario.Case}`, g_strL4D2DocumentationPath);
		}

		console.log(`L4D2 documentation failure scenarios passed: ${vecScenarios.length}; SDK calls mocked.`);
	}

	CheckL4D2DocumentationFailures(g_strL4D2Documentation);

	g_Assert.equal(g_vecL4D2CodeBlocks.length, g_unL4D2DocumentationBlockCount, "players/engines/l4d2 documentation workflow count");
	g_Assert.ok(!g_strL4D2Documentation.includes("Generated by"), "players/engines/l4d2 documentation must be maintained by hand.");
	g_Assert.ok(g_strL4D2Documentation.includes("CBasePlayer::GiveNamedItem()"), "players/engines/l4d2 documentation must name the direct SDK operation.");
	g_Assert.doesNotMatch(g_strL4D2Documentation, /\bconsole\s*\./, "players/engines/l4d2 documentation must not depend on console output.");
	g_Assert.match(g_vecL4D2CodeBlocks[0], /const \{[\s\S]*?GiveNamedItem,[\s\S]*?GiveNamedItemIndex,[\s\S]*?Branch,[\s\S]*?\} = require\("players\/engines\/l4d2"\);/, "players/engines/l4d2 documentation must import every exact export.");

	for (const strSectionName of g_vecL4D2RequiredSections) {
		const strAnchor = strSectionName.toLowerCase().replace(/ /g, "-");
		g_Assert.ok(g_strL4D2Documentation.includes(`- [${strSectionName}](#${strAnchor})`), `players/engines/l4d2 contents must link ${strSectionName}.`);
		g_Assert.ok(g_strL4D2Documentation.includes(`## ${strSectionName}`), `players/engines/l4d2 documentation must contain ${strSectionName}.`);
	}

	for (let unIndex = 0; unIndex < g_vecL4D2CodeBlocks.length; ++unIndex) {
		RunDocumentationFunction(() => {
			const ModuleRecord = { exports: {} };
			const Callback = g_VM.compileFunction(g_vecL4D2CodeBlocks[unIndex], ["require", "module", "exports"], { filename: `${g_strL4D2DocumentationPath}:Root-${unIndex + 1}` });
			const unNativeCallCountBefore = g_L4D2.NativeCalls.length;

			Callback(RequireL4D2DocumentationModule, ModuleRecord, ModuleRecord.exports);

			for (const [strInvocationName, vecInvocationArguments] of Object.entries(g_L4D2InvocationArguments)) {
				if (typeof ModuleRecord.exports[strInvocationName] !== "function") {
					continue;
				}

				g_Assert.equal(g_L4D2.NativeCalls.length, unNativeCallCountBefore, `${strInvocationName} must not create an item during plugin load.`);
				g_mapL4D2InvocationResults.set(strInvocationName, ModuleRecord.exports[strInvocationName](...vecInvocationArguments));
			}

			if (typeof ModuleRecord.exports.GiveFirstAidKit === "function") {
				g_Assert.equal(g_L4D2.NativeCalls.length, unNativeCallCountBefore, "L4D2 registration does not create an item at load");
				g_Assert.equal(ModuleRecord.exports.GiveFirstAidKit({ Index: 1 }), 1, "documented L4D2 client command result");
				Reflect.apply(RequirePlayersEngineDocumentationUnload(ModuleRecord.exports, true), ModuleRecord.exports, []);

			} else {
				const Unload = RequirePlayersEngineDocumentationUnload(ModuleRecord.exports, false);
				if (typeof Unload === "function") {
					Reflect.apply(Unload, ModuleRecord.exports, []);
				}
			}
		}, undefined, [], `Root-${unIndex + 1}`, g_strL4D2DocumentationPath);
	}

	g_Assert.equal(g_mapL4D2CommandRegistrations.size, 0, "documented L4D2 client command cleanup");
	g_Assert.ok(g_vecL4D2DocumentationLogs.some((strMessage) => strMessage.includes("first aid kit")), "L4D2 client command must log the created item.");
	g_Assert.equal(g_mapL4D2InvocationResults.get("CreateL4D2Pistol").ClassName, "weapon_pistol", "documented L4D2 pistol entity creation");
	g_Assert.equal(g_mapL4D2InvocationResults.get("CreateL4D2Loadout").CreatedIndexes.length, 2, "documented L4D2 survivor loadout creation");
	g_Assert.equal(g_mapL4D2InvocationResults.get("CreateL4D2Rifle").Index, 40, "documented L4D2 rifle wrapper creation");
	g_Assert.ok(g_L4D2.NativeCalls.some((vecCall) => (vecCall[0] === "GiveNamedItem") && (vecCall[1][1] === "weapon_pistol")), "documented L4D2 pistol native call");
	g_Assert.ok(g_L4D2.NativeCalls.some((vecCall) => (vecCall[0] === "GiveNamedItemIndex") && (vecCall[1][1] === "weapon_pain_pills")), "documented L4D2 survivor loadout native call");
	g_Assert.ok(g_L4D2.NativeCalls.some((vecCall) => (vecCall[0] === "GiveNamedItemIndex") && (vecCall[1][1] === "weapon_rifle")), "documented L4D2 rifle native call");
	g_Assert.ok(g_L4D2.NativeCalls.some((vecCall) => (vecCall[0] === "GiveNamedItemIndex") && (vecCall[1][1] === "weapon_first_aid_kit")), "documented L4D2 medkit command");

	const g_strL4D2DocumentationWithoutCode = g_strL4D2Documentation.replace(/```[\s\S]*?```/g, "");
	const g_vecL4D2Links = [...g_strL4D2DocumentationWithoutCode.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((vecMatch) => vecMatch[1]);
	for (const strTarget of g_vecL4D2Links) {
		if (strTarget.startsWith("#") || /^[a-z]+:/i.test(strTarget)) {
			continue;
		}

		const strTargetPath = g_Path.resolve(g_Path.dirname(g_strL4D2DocumentationPath), strTarget.split("#", 1)[0]);
		g_Assert.ok(g_FileSystem.existsSync(strTargetPath), `players/engines/l4d2 documentation link must exist: ${strTarget}`);
	}

	const g_unOrangeBoxDocumentationBlockCount = 6;
	const g_strOrangeBoxDocumentation = g_FileSystem.readFileSync(g_strOrangeBoxDocumentationPath, "utf8");
	const g_vecOrangeBoxCodeBlocks = [...g_strOrangeBoxDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);

	const g_mapOrangeBoxCommandRegistrations = new Map();
	RegisterFixtureCleanup(() => Map.prototype.clear.call(g_mapOrangeBoxCommandRegistrations));

	const g_vecOrangeBoxDocumentationLogs = [];
	const g_mapOrangeBoxInvocationResults = new Map();
	const g_OrangeBoxInvocationArguments = { CreateOrangeBoxBranchItem: [1], CreateOrangeBoxEntity: [1, "tf_weapon_rocketlauncher"], GiveOrangeBoxItemToHumans: ["tf_weapon_bat"] };

	const g_vecOrangeBoxRequiredSections = [
		"Import",
		"Exports",
		"Identify the concrete game",
		"Choose a branch item",
		"Resolve the generic entity",
		"Give items to human players",
		"Server command",
		"Errors",
		"Lifecycle",
		"Related modules",
	];

	const g_OrangeBoxServerCommands = {
		RegisterCommand(strName, Callback) {
			g_mapOrangeBoxCommandRegistrations.set(strName, Callback);

			return true;
		},

		UnregisterCommand(strName, Callback) {
			g_Assert.ok(g_mapOrangeBoxCommandRegistrations.get(strName) === Callback, "OrangeBox server command cleanup callback");
			g_mapOrangeBoxCommandRegistrations.delete(strName);

			return true;
		},
	};

	function RequireOrangeBoxDocumentationModule(strModuleName) {
		if (strModuleName === "commands") {
			return { CommandReturn: { Continue: 0, Handled: 1, Block: 1 } };
		}

		if (strModuleName === "commands/server") {
			return g_OrangeBoxServerCommands;
		}

		if (strModuleName === "entities/entity") {
			return {
				Entity(unIndex) {
					g_Assert.equal(unIndex, 40, "documented OrangeBox entity index");

					return { ClassName: "tf_weapon_rocketlauncher", Index: unIndex };
				},
			};
		}

		if (strModuleName === "loggers") {
			return {
				LogInfo(strMessage) {
					g_vecOrangeBoxDocumentationLogs.push(["INFO", strMessage]);

					return true;
				},

				LogWarning(strMessage) {
					g_vecOrangeBoxDocumentationLogs.push(["WARNING", strMessage]);

					return true;
				},
			};
		}

		if (strModuleName === "players/bots") {
			return {
				GetHumanPlayers() {
					return [{ Index: 1 }, { Index: 2 }];
				},
			};
		}

		if (strModuleName === "players/engines/orangebox") {
			return g_OrangeBox;
		}

		throw new Error(`unexpected OrangeBox documentation module ${strModuleName}`);
	}

	function CheckOrangeBoxDocumentationFailures(strDocumentation) {
		const OrangeBoxDocumentationBlocks = { Import: 0, IdentifyBranch: 1, BranchItem: 2, Entity: 3, HumanPlayers: 4, ServerCommand: 5 };
		const unOutOfRangeEntityIndex = 0x80000000;
		const vecCodeBlocks = [...strDocumentation.matchAll(/\x60\x60\x60js\r?\n([\s\S]*?)\x60\x60\x60/g)].map((vecMatch) => vecMatch[1]);

		const vecFamilyBranches = ["css", "dods", "gmod", "hl2dm", "orangebox", "sdk2013", "tf2"];
		const vecScenarios = [];
		for (const strBranch of vecFamilyBranches) {
			for (let unBlock = 0; unBlock < g_unOrangeBoxDocumentationBlockCount; ++unBlock) {
				vecScenarios.push({ Block: unBlock, Case: "SUCCESS", Branch: strBranch });
			}
		}

		for (const CaseGroup of [
			{ Block: OrangeBoxDocumentationBlocks.Import, Cases: ["WRONGBRANCH", "MISSINGFUNCTION"] },
			{ Block: OrangeBoxDocumentationBlocks.IdentifyBranch, Cases: ["WRONGBRANCH"] },
			{
				Block: OrangeBoxDocumentationBlocks.BranchItem,
				Cases: [
					"WRONGBRANCH",
					"BADPLAYER",
					"UNRESOLVED",
					"BADRESULT",
					"WIDERESULT",
					"BADCLASS",
					"NATIVEERROR",
					"NATIVENULL",
				],
			},
			{
				Block: OrangeBoxDocumentationBlocks.Entity,
				Cases: [
					"BADPLAYER",
					"NULITEM",
					"UNRESOLVED",
					"BADRESULT",
					"WIDERESULT",
					"MISSINGENTITY",
					"WRONGENTITY",
					"NATIVEERROR",
					"NATIVENULL",
				],
			},
			{
				Block: OrangeBoxDocumentationBlocks.HumanPlayers,
				Cases: [
					"NULITEM",
					"BADROSTER",
					"BADPLAYER",
					"UNRESOLVED",
					"MIXED",
					"BADRESULT",
					"WIDERESULT",
					"SECONDERROR",
					"SECONDNULL",
				],
			},
			{
				Block: OrangeBoxDocumentationBlocks.ServerCommand,
				Cases: [
					"WIDEPLAYER",
					"EXTRATOKEN",
					"NULITEM",
					"UNRESOLVED",
					"BADRESULT",
					"WIDERESULT",
					"NATIVEERROR",
					"NATIVENULL",
					"LOGFALSE",
					"LOGERROR",
					"REGISTERFALSE",
					"REGISTERERROR",
					"UNREGISTERFALSE",
					"UNREGISTERERROR",
				],
			},
		]) {
			for (const strCase of CaseGroup.Cases) {
				vecScenarios.push({ Block: CaseGroup.Block, Case: strCase, Branch: "tf2" });
			}
		}

		g_Assert.equal(vecCodeBlocks.length, g_unOrangeBoxDocumentationBlockCount, "OrangeBox fixture covers all six fences");

		for (const Scenario of vecScenarios) {
			RunDocumentationFunction(() => {
				const strCase = Scenario.Case;
				const strLabel = "OrangeBox fence " + Scenario.Block + " " + Scenario.Branch + " " + strCase;
				const OriginalError = new Error(strLabel);
				const vecCalls = [];
				const vecLogs = [];
				const mapRegistrations = new Map();
				RegisterFixtureCleanup(() => Map.prototype.clear.call(mapRegistrations));

				const mapItemReads = new Map();
				const vecPlayers = [];
				let unCommandReads = 0;
				let unEntityCalls = 0;
				let bCleanupFailure = strCase.startsWith("UNREGISTER");

				for (let nPlayerIndex = 1; nPlayerIndex <= 2; ++nPlayerIndex) {
					let unReads = 0;
					vecPlayers.push({
						get Index() {
							++unReads;
							g_Assert.equal(unReads, 1, strLabel + " reads player index once");
							g_Assert.ok(!vecCalls.some((vecCall) => vecCall[0] === nPlayerIndex), strLabel + " reads player index before SDK");

							return (strCase === "BADPLAYER") ? 0 : nPlayerIndex;
						},
					});
				}

				const Item = {};
				for (const strField of ["Index", "ClassName"]) {
					Object.defineProperty(Item, strField, {
						get() {
							const unReads = (mapItemReads.get(strField) ?? 0) + 1;
							mapItemReads.set(strField, unReads);
							g_Assert.equal(unReads, 1, strLabel + " reads item " + strField + " once");

							if (strField === "ClassName") {
								return (strCase === "BADCLASS") ? "" : "sdk_item";
							}

							return (strCase === "BADRESULT") ? "40" : ((strCase === "WIDERESULT") ? unOutOfRangeEntityIndex : 40);
						},
					});
				}

				const InvokeSDK = (nPlayerIndex, strItem, nSubtype) => {
					g_Assert.equal(nPlayerIndex, (Scenario.Block === OrangeBoxDocumentationBlocks.HumanPlayers) ? (vecCalls.length + 1) : 1, strLabel + " target index");
					g_Assert.equal(typeof strItem, "string", strLabel + " string item");
					g_Assert.ok(!strItem.includes("\0"), strLabel + " no NUL in SDK item");
					g_Assert.ok((nSubtype === undefined) || (nSubtype === 0), strLabel + " exact subtype");
					vecCalls.push([nPlayerIndex, strItem, nSubtype]);

					if ((strCase === "NATIVEERROR") || ((strCase === "SECONDERROR") && (vecCalls.length === 2))) {
						throw OriginalError;
					}

					if ((strCase === "NATIVENULL") || ((strCase === "SECONDNULL") && (vecCalls.length === 2))) {
						throw null;
					}

					if ((strCase === "UNRESOLVED") || ((strCase === "MIXED") && (vecCalls.length === 2))) {
						return -1;
					}

					return (strCase === "BADRESULT") ? -2 : ((strCase === "WIDERESULT") ? unOutOfRangeEntityIndex : 40);
				};

				const NativeModule = {
					Branch: (strCase === "WRONGBRANCH") ? "csgo" : Scenario.Branch,

					GiveNamedItem(nPlayerIndex, strItem, nSubtype) {
						const nResult = InvokeSDK(nPlayerIndex, strItem, nSubtype);

						return (nResult === -1) ? null : Item;
					},

					GiveNamedItemIndex: InvokeSDK,
				};
				if (strCase === "MISSINGFUNCTION") {
					delete NativeModule.GiveNamedItemIndex;
				}

				const WriteLog = (strSeverity, strMessage) => {
					vecLogs.push([strSeverity, strMessage]);

					if (strCase === "LOGERROR") {
						throw OriginalError;
					}

					return strCase !== "LOGFALSE";
				};

				const Modules = {
					"players/engines/orangebox": NativeModule,
					"players/bots": {
						GetHumanPlayers() {
							return (strCase === "BADROSTER") ? null : vecPlayers;
						},
					},
					"entities/entity": {
						Entity(nEntityIndex) {
							++unEntityCalls;
							g_Assert.equal(nEntityIndex, 40, strLabel + " exact entity factory index");

							return (strCase === "MISSINGENTITY") ? null : { Index: (strCase === "WRONGENTITY") ? 41 : nEntityIndex };
						},
					},
					"commands": { CommandReturn: { Continue: 0, Handled: 1, Block: 1 } },
					"commands/server": {
						RegisterCommand(strName, Callback) {
							if (strCase === "REGISTERERROR") {
								throw OriginalError;
							}

							if (strCase === "REGISTERFALSE") {
								return false;
							}

							mapRegistrations.set(strName, Callback);

							return true;
						},

						UnregisterCommand(strName, Callback) {
							g_Assert.equal(mapRegistrations.get(strName), Callback, strLabel + " exact callback");

							if (bCleanupFailure) {
								if (strCase === "UNREGISTERERROR") {
									throw OriginalError;
								}

								return false;
							}

							mapRegistrations.delete(strName);

							return true;
						},
					},
					"loggers": {
						LogInfo(strMessage) {
							return WriteLog("INFO", strMessage);
						},

						LogWarning(strMessage) {
							return WriteLog("WARNING", strMessage);
						},
					},
				};

				const ModuleRecord = { exports: {} };
				let Result = null;
				let ErrorValue = null;
				let bThrew = false;

				try {
					const Callback = g_VM.compileFunction(vecCodeBlocks[Scenario.Block], ["require", "module", "exports"], { filename: g_strOrangeBoxDocumentationPath + ":" + strLabel });
					Callback((strName) => Modules[strName], ModuleRecord, ModuleRecord.exports);
					g_Assert.equal(vecCalls.length, 0, strLabel + " no SDK effects at load");

					if (Scenario.Block === OrangeBoxDocumentationBlocks.BranchItem) {
						Result = ModuleRecord.exports.CreateOrangeBoxBranchItem((strCase === "BADPLAYER") ? 0 : 1);

					} else if (Scenario.Block === OrangeBoxDocumentationBlocks.Entity) {
						Result = ModuleRecord.exports.CreateOrangeBoxEntity((strCase === "BADPLAYER") ? 0 : 1, (strCase === "NULITEM") ? "item\0tail" : "sdk_item");

					} else if (Scenario.Block === OrangeBoxDocumentationBlocks.HumanPlayers) {
						Result = ModuleRecord.exports.GiveOrangeBoxItemToHumans((strCase === "NULITEM") ? "item\0tail" : "sdk_item");

					} else if (Scenario.Block === OrangeBoxDocumentationBlocks.ServerCommand) {
						const vecArguments = ["sjs_ob_item", (strCase === "WIDEPLAYER") ? "2147483648" : "1", (strCase === "NULITEM") ? "item\0tail" : "sdk_item"];
						if (strCase === "EXTRATOKEN") {
							vecArguments.push("extra");
						}

						Result = ModuleRecord.exports.GiveOrangeBoxItem({
							get Arguments() {
								++unCommandReads;
								g_Assert.equal(unCommandReads, 1, strLabel + " one command snapshot");
								g_Assert.equal(vecCalls.length, 0, strLabel + " command snapshot before SDK");

								return vecArguments;
							},
						});

						Reflect.apply(RequirePlayersEngineDocumentationUnload(ModuleRecord.exports, true), ModuleRecord.exports, []);
					}
				} catch (CaughtError) {
					bThrew = true;
					ErrorValue = CaughtError;
				}

				const bUsage = (Scenario.Block === OrangeBoxDocumentationBlocks.ServerCommand) && ["WIDEPLAYER", "EXTRATOKEN", "NULITEM"].includes(strCase);
				const bExpectedFailure = !["SUCCESS", "UNRESOLVED", "MIXED"].includes(strCase) && !bUsage;
				g_Assert.equal(bThrew, bExpectedFailure, strLabel + " failure result");

				if (bThrew) {
					g_Assert.ok(!(ErrorValue instanceof g_Assert.AssertionError), strLabel + " validation failure is not a fixture invariant failure");
				}

				if (strCase.endsWith("ERROR") || strCase.endsWith("NULL")) {
					g_Assert.equal(ErrorValue, strCase.endsWith("NULL") ? null : OriginalError, strLabel + " original thrown value");
				}

				if ([
					"BADPLAYER",
					"NULITEM",
					"WIDEPLAYER",
					"EXTRATOKEN",
					"BADROSTER",
					"WRONGBRANCH",
					"MISSINGFUNCTION",
				].includes(strCase) || strCase.startsWith("REGISTER")) {
					g_Assert.equal(vecCalls.length, 0, strLabel + " validation before mutation");
				}

				if ((Scenario.Block === OrangeBoxDocumentationBlocks.BranchItem) && !bThrew) {
					g_Assert.equal(Result, (strCase === "UNRESOLVED") ? null : Item, strLabel + " exact result identity");

					if (Result !== null) {
						g_Assert.equal(mapItemReads.get("Index"), 1, strLabel + " item index validated");
						g_Assert.equal(mapItemReads.get("ClassName"), 1, strLabel + " item class validated");
						g_Assert.equal(ModuleRecord.exports.ItemsByBranch[Scenario.Branch], vecCalls[0][1], strLabel + " concrete branch item");
					}
				}

				if ((Scenario.Block === OrangeBoxDocumentationBlocks.Entity) && !bThrew) {
					g_Assert.equal(unEntityCalls, (strCase === "UNRESOLVED") ? 0 : 1, strLabel + " sentinel before entity factory");
					g_Assert.equal(Result?.Index ?? null, (strCase === "UNRESOLVED") ? null : 40, strLabel + " entity result");
				}

				if ((Scenario.Block === OrangeBoxDocumentationBlocks.HumanPlayers) && !bThrew) {
					const vecExpected = (strCase === "UNRESOLVED") ? [] : ((strCase === "MIXED") ? [{ EntityIndex: 40, PlayerIndex: 1 }] : [{ EntityIndex: 40, PlayerIndex: 1 }, { EntityIndex: 40, PlayerIndex: 2 }]);
					g_Assert.deepEqual(Result, vecExpected, strLabel + " resolved indexes preserve duplicates/skip sentinel");
				}

				if (strCase.startsWith("SECOND")) {
					g_Assert.equal(vecCalls.length, 2, strLabel + " second failure retains first effect/no replay");
				}

				if ((Scenario.Block === OrangeBoxDocumentationBlocks.ServerCommand) && !bThrew) {
					g_Assert.equal(Result, 1, strLabel + " native command status");
					g_Assert.equal(unCommandReads, 1, strLabel + " command read");
					g_Assert.deepEqual(vecLogs, [[bUsage ? "WARNING" : "INFO", bUsage ? "Usage: sjs_ob_item <player-index> <item-class>" : ("OrangeBox-family item sdk_item for player 1: entity " + ((strCase === "UNRESOLVED") ? -1 : 40) + ".")]], strLabel + " truthful checked log");
				}

				if (bCleanupFailure) {
					g_Assert.equal(mapRegistrations.size, 1, strLabel + " pending cleanup");

					bCleanupFailure = false;
					Reflect.apply(RequirePlayersEngineDocumentationUnload(ModuleRecord.exports, true), ModuleRecord.exports, []);
				}

				if ((Scenario.Block === OrangeBoxDocumentationBlocks.ServerCommand) && !strCase.startsWith("REGISTER")) {
					if (bThrew && !strCase.startsWith("UNREGISTER")) {
						Reflect.apply(RequirePlayersEngineDocumentationUnload(ModuleRecord.exports, true), ModuleRecord.exports, []);
					}

					g_Assert.equal(mapRegistrations.size, 0, strLabel + " cleanup complete");
				}
			}, undefined, [], `OrangeBoxContract-${Scenario.Block}-${Scenario.Branch}-${Scenario.Case}`, g_strOrangeBoxDocumentationPath);
		}

		console.log("OrangeBox documentation scenarios passed: " + vecScenarios.length + "; seven branch profiles, SDK calls mocked.");
	}

	CheckOrangeBoxDocumentationFailures(g_strOrangeBoxDocumentation);

	g_Assert.equal(g_vecOrangeBoxCodeBlocks.length, g_unOrangeBoxDocumentationBlockCount, "players/engines/orangebox documentation workflow count");
	g_Assert.ok(!g_strOrangeBoxDocumentation.includes("Generated by"), "players/engines/orangebox documentation must be maintained by hand.");
	g_Assert.ok(g_strOrangeBoxDocumentation.includes("CBasePlayer::GiveNamedItem()"), "players/engines/orangebox documentation must name the direct SDK operation.");
	g_Assert.ok(g_strOrangeBoxDocumentation.includes("css`, `dods`, `gmod`, `hl2dm`, `orangebox`, `sdk2013` and `tf2"), "players/engines/orangebox documentation must name every selected family branch.");
	g_Assert.doesNotMatch(g_strOrangeBoxDocumentation, /\bconsole\s*\./, "players/engines/orangebox documentation must not depend on console output.");
	g_Assert.match(g_vecOrangeBoxCodeBlocks[0], /const \{[\s\S]*?GiveNamedItem,[\s\S]*?GiveNamedItemIndex,[\s\S]*?Branch,[\s\S]*?\} = require\("players\/engines\/orangebox"\);/, "players/engines/orangebox documentation must import every exact export.");

	for (const strSectionName of g_vecOrangeBoxRequiredSections) {
		const strAnchor = strSectionName.toLowerCase().replace(/ /g, "-");
		g_Assert.ok(g_strOrangeBoxDocumentation.includes(`- [${strSectionName}](#${strAnchor})`), `players/engines/orangebox contents must link ${strSectionName}.`);
		g_Assert.ok(g_strOrangeBoxDocumentation.includes(`## ${strSectionName}`), `players/engines/orangebox documentation must contain ${strSectionName}.`);
	}

	for (let unIndex = 0; unIndex < g_vecOrangeBoxCodeBlocks.length; ++unIndex) {
		RunDocumentationFunction(() => {
			const ModuleRecord = { exports: {} };
			const Callback = g_VM.compileFunction(g_vecOrangeBoxCodeBlocks[unIndex], ["require", "module", "exports"], { filename: `${g_strOrangeBoxDocumentationPath}:Root-${unIndex + 1}` });
			const unNativeCallCountBefore = g_OrangeBox.NativeCalls.length;

			Callback(RequireOrangeBoxDocumentationModule, ModuleRecord, ModuleRecord.exports);

			for (const [strInvocationName, vecInvocationArguments] of Object.entries(g_OrangeBoxInvocationArguments)) {
				if (typeof ModuleRecord.exports[strInvocationName] !== "function") {
					continue;
				}

				g_Assert.equal(g_OrangeBox.NativeCalls.length, unNativeCallCountBefore, `${strInvocationName} must not create an item during plugin load.`);
				g_mapOrangeBoxInvocationResults.set(strInvocationName, ModuleRecord.exports[strInvocationName](...vecInvocationArguments));
			}

			if (typeof ModuleRecord.exports.GiveOrangeBoxItem === "function") {
				g_Assert.equal(g_OrangeBox.NativeCalls.length, unNativeCallCountBefore, "OrangeBox registration does not invoke SDK");
				g_Assert.equal(g_mapOrangeBoxCommandRegistrations.get("sjs_ob_item"), ModuleRecord.exports.GiveOrangeBoxItem, "OrangeBox registered callback identity");
				g_Assert.equal(ModuleRecord.exports.GiveOrangeBoxItem({ Arguments: ["sjs_ob_item", "1", "tf_weapon_shotgun"] }), 1, "OrangeBox deliberate command invocation");
				Reflect.apply(RequirePlayersEngineDocumentationUnload(ModuleRecord.exports, true), ModuleRecord.exports, []);

			} else {
				const Unload = RequirePlayersEngineDocumentationUnload(ModuleRecord.exports, false);
				if (typeof Unload === "function") {
					Reflect.apply(Unload, ModuleRecord.exports, []);
				}
			}
		}, undefined, [], `Root-${unIndex + 1}`, g_strOrangeBoxDocumentationPath);
	}

	g_Assert.equal(g_mapOrangeBoxCommandRegistrations.size, 0, "documented OrangeBox server command cleanup");
	g_Assert.ok(g_vecOrangeBoxDocumentationLogs.some((vecEntry) => (vecEntry[0] === "INFO") && vecEntry[1].includes("tf_weapon_shotgun")), "OrangeBox server command must log the created item.");
	g_Assert.equal(g_mapOrangeBoxInvocationResults.get("CreateOrangeBoxBranchItem").ClassName, "tf_weapon_rocketlauncher", "documented TF2 rocket launcher entity creation");
	g_Assert.equal(g_mapOrangeBoxInvocationResults.get("CreateOrangeBoxEntity").Index, 40, "documented OrangeBox generic entity creation");
	g_Assert.equal(g_mapOrangeBoxInvocationResults.get("GiveOrangeBoxItemToHumans").length, 2, "documented OrangeBox human-player item creation");
	g_Assert.ok(g_OrangeBox.NativeCalls.some((vecCall) => (vecCall[0] === "GiveNamedItem") && (vecCall[1][1] === "tf_weapon_rocketlauncher")), "documented TF2 rocket launcher native call");
	g_Assert.ok(g_OrangeBox.NativeCalls.filter((vecCall) => (vecCall[0] === "GiveNamedItemIndex") && (vecCall[1][1] === "tf_weapon_bat")).length === 2, "documented OrangeBox human-player native calls");
	g_Assert.ok(g_OrangeBox.NativeCalls.some((vecCall) => (vecCall[0] === "GiveNamedItemIndex") && (vecCall[1][1] === "tf_weapon_shotgun")), "documented OrangeBox server command forwarding");

	const g_strOrangeBoxDocumentationWithoutCode = g_strOrangeBoxDocumentation.replace(/```[\s\S]*?```/g, "");
	const g_vecOrangeBoxLinks = [...g_strOrangeBoxDocumentationWithoutCode.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((vecMatch) => vecMatch[1]);
	for (const strTarget of g_vecOrangeBoxLinks) {
		if (strTarget.startsWith("#") || /^[a-z]+:/i.test(strTarget)) {
			continue;
		}

		const strTargetPath = g_Path.resolve(g_Path.dirname(g_strOrangeBoxDocumentationPath), strTarget.split("#", 1)[0]);
		g_Assert.ok(g_FileSystem.existsSync(strTargetPath), `players/engines/orangebox documentation link must exist: ${strTarget}`);
	}

	const g_strModuleBindings = g_FileSystem.readFileSync(g_strModuleBindingsPath, "utf8");
	g_Assert.ok(g_strModuleBindings.includes("return pPlayer->GiveNamedItem(strItem.c_str(), nSubtype);"), "players/engines must call the selected Source SDK declaration directly.");
	g_Assert.ok(g_strModuleBindings.includes("return pPlayer->GiveNamedItem(strItem.c_str(), nSubtype, bRemoveIfNotCarried);"), "players/engines must call the CSGO Source SDK declaration directly.");
	g_Assert.ok(g_strModuleBindings.includes('SetRecordFunction(pIsolate, LocalContext, LocalPlayerEngineModule, "GiveNamedItem", GiveNamedItemCallback, LocalRuntimeData)'), "players/engines native own-function installation with runtime data");
	g_Assert.ok(g_strModuleBindings.includes('SetRecordFunction(pIsolate, LocalContext, LocalPlayerEngineModule, "GiveNamedItemIndex", GiveNamedItemEntityIndexCallback, LocalRuntimeData)'), "players/engines native own-index-function installation with runtime data");
	g_Assert.ok(g_strModuleBindings.includes("v8::Local<v8::Object> const LocalBMSPlayerEngineModule = MakeModule(pIsolate);"), "players/engines/bms native module installation");
	g_Assert.ok(g_strModuleBindings.includes("v8::Local<v8::Object> const LocalCSGOPlayerEngineModule = MakeModule(pIsolate);"), "players/engines/csgo native module installation");
	g_Assert.ok(g_strModuleBindings.includes("v8::Local<v8::Object> const LocalL4D2PlayerEngineModule = MakeModule(pIsolate);"), "players/engines/l4d2 native module installation");
	g_Assert.ok(g_strModuleBindings.includes("v8::Local<v8::Object> const LocalOrangeBoxPlayerEngineModule = MakeModule(pIsolate);"), "players/engines/orangebox native module installation");
} catch (ErrorValue) {
	g_bFailed = true;
	g_Failure = ErrorValue;
} finally {
	const vecErrors = [];
	for (const Release of [
		...g_setFixtureOwners,
		() => RestoreEngineProperty(g_Module, "_load", g_ModuleLoadDescriptor),
		() => RestorePackageCache(g_mapPackageCacheDescriptors),
		() => RestoreEngineProperty(globalThis, "sourcejs", g_SourceJSDescriptor),
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

		throw new AggregateError(vecErrors, "Engine smoke state restoration failed.");
	}
}

if (g_bFailed) {
	throw g_Failure;
}

console.log("[  OK  ] smoke_players_engines");
