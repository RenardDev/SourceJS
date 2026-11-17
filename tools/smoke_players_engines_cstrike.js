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
const g_strCounterStrikePath = g_Path.join(g_strPackageRootPath, "players", "engines", "orangebox", "cstrike.js");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "players-engines-orangebox-cstrike.md");
const g_strModuleBindingsPath = g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "modules", "ModuleBindings.cpp");

const g_vecNativeCalls = [];
const g_Player = {
	Dead: true,

	HasC4() {
		g_vecNativeCalls.push(["Player.HasC4"]);

		return true;
	},

	Index: 1,

	Spawn(bForce = false) {
		g_vecNativeCalls.push(["Player.Spawn", bForce]);

		return bForce || (this.Dead && (this.Team > 1));
	},

	Team: 2,
};

const g_AlivePlayer = { Dead: false, Index: 2, Team: 2 };
const g_NativeCounterStrike = {
	Branch: "css",

	HasC4(Player) {
		g_vecNativeCalls.push(["HasC4", Player]);

		const nPlayerIndex = (typeof Player === "number") ? Player : Player.Index;

		return nPlayerIndex === 1;
	},

	GetPlayer(nPlayerIndex) {
		g_vecNativeCalls.push(["GetPlayer", nPlayerIndex]);

		return g_Player;
	},

	Spawn(Player, bForce = false) {
		g_vecNativeCalls.push(["Spawn", Player, bForce]);

		const Target = (typeof Player === "number") ? ((Player === 1) ? g_Player : g_AlivePlayer) : Player;

		return bForce || (Target.Dead && (Target.Team > 1));
	},
};

const g_unDocumentationBlockCount = 6;
const g_unDocumentationTimeoutMilliseconds = 1000;
const g_DocumentationBlocks = { Import: 0, ConfirmBranch: 1, Carrier: 2, Player: 3, HumanPlayers: 4, ServerCommand: 5 };

const g_SourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
const g_ModuleLoadDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");
const g_OriginalModuleLoad = g_ModuleLoadDescriptor.value;
const g_mapPackageCacheDescriptors = new Map();
const g_vecCleanupMaps = [];

let g_bMainFailed = false;
let g_MainError = null;

function IsPackageCachePath(strPath) {
	return (strPath === g_strPackageRootPath) || strPath.startsWith(g_strPackageRootPath + g_Path.sep);
}

function ClearPackageCache() {
	for (const strPath of Object.getOwnPropertyNames(require.cache)) {
		if (IsPackageCachePath(strPath)) {
			if (!Reflect.deleteProperty(require.cache, strPath)) {
				throw new Error("Cannot clear temporary package cache: " + strPath);
			}
		}
	}
}

function RunDocumentationWorkflow(Workflow, strLabel) {
	// This same-realm closure deadline is not a security sandbox or native IO cancellation.
	const Script = new g_VM.Script("Workflow()", { filename: g_strDocumentationPath + ":" + strLabel });

	return Script.runInNewContext({ Workflow }, { timeout: g_unDocumentationTimeoutMilliseconds });
}

function RequireCSSDocumentationUnload(ModuleExports) {
	const strRuntimeSource = g_FileSystem.readFileSync(g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "V8Runtime.cpp"), "utf8");
	const vecUnloadDefinition = strRuntimeSource.match(/^\tvoid V8Runtime::UnloadPlugin\([^\r\n]*\) \{[\s\S]*?^\t}/m);
	g_Assert.ok(vecUnloadDefinition, "Native plugin unload definition");
	g_Assert.match(vecUnloadDefinition[0], /CallPluginExportFunction\(strPluginName,\s*"Unload"\)/, "CSS documentation unload lookup must follow the current exact native export key");

	const Unload = ModuleExports.Unload;
	g_Assert.equal(Object.hasOwn(ModuleExports, "unload"), false, "No lowercase lifecycle alias");
	g_Assert.equal(typeof Unload, "function", "The CSS command example must export the native unload entry point");

	return Unload;
}

function CompileDocumentationModule(strSource, unBlockIndex) {
	return g_VM.compileFunction(strSource, ["require", "module", "exports"], { filename: g_strDocumentationPath + ":fence" + (unBlockIndex + 1) });
}

g_Assert.equal(typeof g_OriginalModuleLoad, "function", "Node module loader must have its normal data descriptor.");

for (const strPath of Object.getOwnPropertyNames(require.cache)) {
	if (IsPackageCachePath(strPath)) {
		const Descriptor = Object.getOwnPropertyDescriptor(require.cache, strPath);
		g_Assert.ok(Descriptor.configurable, "Existing package cache must be restorable: " + strPath);
		g_mapPackageCacheDescriptors.set(strPath, Descriptor);
	}
}

try {
	ClearPackageCache();
	Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: true, writable: true, value: { "players/engines/orangebox/cstrike": g_NativeCounterStrike } });

	g_Module._load = function LoadModule(strRequest) {
		if (strRequest === "internal/runtime") {
			return require(g_strRuntimePath);
		}

		return g_OriginalModuleLoad.apply(this, arguments);
	};

	let g_CounterStrike = null;

	try {
		g_CounterStrike = require(g_strCounterStrikePath);
	} finally {
		Object.defineProperty(g_Module, "_load", g_ModuleLoadDescriptor);
	}

	g_Assert.ok(g_CounterStrike === g_NativeCounterStrike, "CStrike must expose the exact native CSS object.");
	g_Assert.deepEqual(Object.keys(g_CounterStrike).sort(), ["Branch", "GetPlayer", "HasC4", "Spawn"], "CStrike exact exports");
	g_Assert.ok(g_CounterStrike.GetPlayer(1) === g_Player, "GetPlayer() must return the native player object.");
	g_Assert.equal(g_CounterStrike.HasC4(g_Player), true, "HasC4 direct native result");
	g_Assert.equal(g_CounterStrike.Spawn(g_Player, true), true, "Spawn direct native result");
	g_Assert.equal(g_Player.HasC4(), true, "native Player.HasC4 method");
	g_Assert.equal(g_Player.Spawn(false), true, "native Player.Spawn method");
	g_Assert.ok(g_vecNativeCalls.some((vecCall) => (vecCall[0] === "GetPlayer") && (vecCall[1] === 1)), "GetPlayer() must call native code directly.");
	g_Assert.ok(!Object.hasOwn(g_CounterStrike, "decoratePlayer"), "CStrike must not decorate players in JavaScript.");
	g_Assert.ok(!Object.hasOwn(g_CounterStrike, "available"), "CStrike must not expose an availability snapshot.");
	g_Assert.ok(!Object.hasOwn(g_CounterStrike, "moduleName"), "CStrike must not expose moduleName.");
	g_Assert.ok(!Object.hasOwn(g_CounterStrike, "default"), "CStrike must not expose a default alias.");

	g_vecNativeCalls.length = 0;

	const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
	const g_vecCodeBlocks = [...g_strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);

	const g_mapCommandRegistrations = new Map();
	g_vecCleanupMaps.push(g_mapCommandRegistrations);

	const g_vecLoggerRecords = [];

	const g_ServerCommands = {
		RegisterCommand(strName, Callback) {
			g_Assert.ok(!g_mapCommandRegistrations.has(strName), "CSS server command must be registered once.");
			g_mapCommandRegistrations.set(strName, Callback);

			return true;
		},

		UnregisterCommand(strName, Callback) {
			g_Assert.ok(g_mapCommandRegistrations.get(strName) === Callback, "CSS server command cleanup callback");
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
					g_vecLoggerRecords.push(["INFO", strMessage]);

					return true;
				},

				LogWarning(strMessage) {
					g_vecLoggerRecords.push(["WARNING", strMessage]);

					return true;
				},
			};
		}

		if (strModuleName === "players/bots") {
			return {
				GetHumanPlayers() {
					return [g_Player, g_AlivePlayer];
				},
			};
		}

		if (strModuleName === "players/engines/orangebox/cstrike") {
			return g_CounterStrike;
		}

		throw new Error(`unexpected CSS documentation module ${strModuleName}`);
	}

	function CheckCSSDocumentationFailures(strDocumentation) {
		const vecCodeBlocks = [...strDocumentation.matchAll(/\x60\x60\x60js\r?\n([\s\S]*?)\x60\x60\x60/g)].map((vecMatch) => vecMatch[1]);

		const vecScenarios = [
			{ Block: g_DocumentationBlocks.Import, Case: "SUCCESS" },
			{ Block: g_DocumentationBlocks.Import, Case: "WRONGBRANCH" },
			{ Block: g_DocumentationBlocks.Import, Case: "MISSINGSPAWN" },
			{ Block: g_DocumentationBlocks.ConfirmBranch, Case: "WRONGBRANCH" },
			{ Block: g_DocumentationBlocks.Carrier, Case: "SUCCESS" },
			{ Block: g_DocumentationBlocks.Carrier, Case: "NOCARRIER" },
			{ Block: g_DocumentationBlocks.Carrier, Case: "BADROSTER" },
			{ Block: g_DocumentationBlocks.Carrier, Case: "BADINDEX" },
			{ Block: g_DocumentationBlocks.Carrier, Case: "BADRESULT" },
			{ Block: g_DocumentationBlocks.Carrier, Case: "NATIVEERROR" },
			{ Block: g_DocumentationBlocks.Carrier, Case: "NATIVENULL" },
			{ Block: g_DocumentationBlocks.Player, Case: "SUCCESS" },
			{ Block: g_DocumentationBlocks.Player, Case: "BADINDEX" },
			{ Block: g_DocumentationBlocks.Player, Case: "WRONGINDEX" },
			{ Block: g_DocumentationBlocks.Player, Case: "BADRESULT" },
			{ Block: g_DocumentationBlocks.Player, Case: "NATIVEERROR" },
			{ Block: g_DocumentationBlocks.Player, Case: "NATIVENULL" },
			{ Block: g_DocumentationBlocks.Player, Case: "SPAWNSUCCESS" },
			{ Block: g_DocumentationBlocks.Player, Case: "SPAWNFALSE" },
			{ Block: g_DocumentationBlocks.Player, Case: "SPAWNERROR" },
			{ Block: g_DocumentationBlocks.Player, Case: "BADFORCE" },
			{ Block: g_DocumentationBlocks.HumanPlayers, Case: "SUCCESS" },
			{ Block: g_DocumentationBlocks.HumanPlayers, Case: "ALIVE" },
			{ Block: g_DocumentationBlocks.HumanPlayers, Case: "SPECTATOR" },
			{ Block: g_DocumentationBlocks.HumanPlayers, Case: "BADROSTER" },
			{ Block: g_DocumentationBlocks.HumanPlayers, Case: "BADINDEX" },
			{ Block: g_DocumentationBlocks.HumanPlayers, Case: "BADDEAD" },
			{ Block: g_DocumentationBlocks.HumanPlayers, Case: "BADTEAM" },
			{ Block: g_DocumentationBlocks.HumanPlayers, Case: "BADRESULT" },
			{ Block: g_DocumentationBlocks.HumanPlayers, Case: "SECONDERROR" },
			{ Block: g_DocumentationBlocks.HumanPlayers, Case: "SECONDNULL" },
			{ Block: g_DocumentationBlocks.ServerCommand, Case: "SUCCESS" },
			{ Block: g_DocumentationBlocks.ServerCommand, Case: "FORCE" },
			{ Block: g_DocumentationBlocks.ServerCommand, Case: "SKIPPED" },
			{ Block: g_DocumentationBlocks.ServerCommand, Case: "WIDEINDEX" },
			{ Block: g_DocumentationBlocks.ServerCommand, Case: "EXTRATOKEN" },
			{ Block: g_DocumentationBlocks.ServerCommand, Case: "BADMODE" },
			{ Block: g_DocumentationBlocks.ServerCommand, Case: "BADRESULT" },
			{ Block: g_DocumentationBlocks.ServerCommand, Case: "NATIVEERROR" },
			{ Block: g_DocumentationBlocks.ServerCommand, Case: "NATIVENULL" },
			{ Block: g_DocumentationBlocks.ServerCommand, Case: "LOGFALSE" },
			{ Block: g_DocumentationBlocks.ServerCommand, Case: "LOGERROR" },
			{ Block: g_DocumentationBlocks.ServerCommand, Case: "REGISTERFALSE" },
			{ Block: g_DocumentationBlocks.ServerCommand, Case: "REGISTERERROR" },
			{ Block: g_DocumentationBlocks.ServerCommand, Case: "UNREGISTERFALSE" },
			{ Block: g_DocumentationBlocks.ServerCommand, Case: "UNREGISTERERROR" },
		];

		g_Assert.equal(vecCodeBlocks.length, g_unDocumentationBlockCount, "CSS fixture covers all six fences");

		for (const Scenario of vecScenarios) {
			const strCase = Scenario.Case;
			const strLabel = `CSS fence ${Scenario.Block} ${strCase}`;
			const OriginalError = new Error(strLabel);
			const vecCalls = [];
			const vecLogs = [];
			const mapRegistrations = new Map();

			try {
				RunDocumentationWorkflow(() => {
					const vecPlayers = [];
					let bCleanupFailure = strCase.startsWith("UNREGISTER");

					for (let nPlayerIndex = 1; nPlayerIndex <= 2; ++nPlayerIndex) {
						const Player = {};
						const mapReads = new Map();
						for (const strField of ["Index", "Dead", "Team"]) {
							Object.defineProperty(Player, strField, {
								get() {
									const unReads = (mapReads.get(strField) ?? 0) + 1;
									mapReads.set(strField, unReads);
									g_Assert.equal(unReads, 1, `${strLabel} player${nPlayerIndex} reads${strField} once`);
									g_Assert.equal(vecCalls.filter((vecCall) => vecCall[1] === nPlayerIndex).length, 0, `${strLabel} reads fields before SDK`);

									if (strField === "Index") {
										return (strCase === "BADINDEX") ? 0 : ((strCase === "WRONGINDEX") ? 2 : nPlayerIndex);
									}

									if (strField === "Dead") {
										return (strCase === "BADDEAD") ? "dead" : strCase !== "ALIVE";
									}

									return (strCase === "BADTEAM") ? 2.5 : ((strCase === "SPECTATOR") ? 1 : 2);
								},
							});
						}

						vecPlayers.push(Player);
					}

					const NativeResult = (strOperation, nPlayerIndex, bForce = false) => {
						vecCalls.push([strOperation, nPlayerIndex, bForce]);

						if ((strCase === "NATIVEERROR") || (strCase === "SPAWNERROR") || ((strCase === "SECONDERROR") && (vecCalls.length === 2))) {
							throw OriginalError;
						}

						if ((strCase === "NATIVENULL") || ((strCase === "SECONDNULL") && (vecCalls.length === 2))) {
							throw null;
						}

						if (strCase === "BADRESULT") {
							return "true";
						}

						return !["NOCARRIER", "SPAWNFALSE", "SKIPPED"].includes(strCase);
					};

					const CSSPlayer = vecPlayers[0];
					CSSPlayer.HasC4 = function HasC4() {
						return NativeResult("Player.HasC4", 1);
					};

					CSSPlayer.Spawn = function Spawn(bForce) {
						g_Assert.equal(this, CSSPlayer, `${strLabel} method receiver`);

						return NativeResult("Player.Spawn", 1, bForce);
					};

					const NativeModule = {
						Branch: (strCase === "WRONGBRANCH") ? "csgo" : "css",

						HasC4(nPlayerIndex) {
							g_Assert.equal(nPlayerIndex, vecCalls.length + 1, `${strLabel} current carrier-query index`);

							return NativeResult("HasC4", nPlayerIndex);
						},

						GetPlayer(nPlayerIndex) {
							g_Assert.equal(nPlayerIndex, 1, `${strLabel} input player`);

							return CSSPlayer;
						},

						Spawn(nPlayerIndex, bForce) {
							g_Assert.equal(nPlayerIndex, (Scenario.Block === g_DocumentationBlocks.HumanPlayers) ? (vecCalls.length + 1) : 1, `${strLabel} current spawn target`);

							return NativeResult("Spawn", nPlayerIndex, bForce);
						},
					};
					if (strCase === "MISSINGSPAWN") {
						delete NativeModule.Spawn;
					}

					const WriteLog = (strSeverity, strMessage) => {
						vecLogs.push([strSeverity, strMessage]);

						if (strCase === "LOGERROR") {
							throw OriginalError;
						}

						return strCase !== "LOGFALSE";
					};

					const Modules = {
						"players/engines/orangebox/cstrike": NativeModule,
						"players/bots": {
							GetHumanPlayers() {
								return (strCase === "BADROSTER") ? null : vecPlayers;
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
						const Callback = CompileDocumentationModule(vecCodeBlocks[Scenario.Block], Scenario.Block);
						Callback((strName) => Modules[strName], ModuleRecord, ModuleRecord.exports);
						g_Assert.equal(vecCalls.length, 0, `${strLabel} no SDK mutation at load`);

						if (Scenario.Block === g_DocumentationBlocks.Carrier) {
							Result = ModuleRecord.exports.FindC4Carrier();

						} else if (Scenario.Block === g_DocumentationBlocks.Player) {
							Result = (strCase.startsWith("SPAWN") || (strCase === "BADFORCE")) ? ModuleRecord.exports.RespawnWithCSSPlayer(1, (strCase === "BADFORCE") ? 1 : false) : ModuleRecord.exports.InspectCSSPlayer((strCase === "BADINDEX") ? 0 : 1);

						} else if (Scenario.Block === g_DocumentationBlocks.HumanPlayers) {
							Result = ModuleRecord.exports.RespawnDeadHumans();

						} else if (Scenario.Block === g_DocumentationBlocks.ServerCommand) {
							const vecArguments = ["sjs_css_respawn", (strCase === "WIDEINDEX") ? "2147483648" : "1"];
							if (strCase === "FORCE") {
								vecArguments.push("force");

							} else if (strCase === "EXTRATOKEN") {
								vecArguments.push("force", "extra");

							} else if (strCase === "BADMODE") {
								vecArguments.push("invalid");
							}

							Result = ModuleRecord.exports.RespawnCSSPlayer({ Arguments: vecArguments });
							Reflect.apply(RequireCSSDocumentationUnload(ModuleRecord.exports), ModuleRecord.exports, []);
						}
					} catch (CaughtError) {
						bThrew = true;
						ErrorValue = CaughtError;
					}

					const bUsage = (Scenario.Block === g_DocumentationBlocks.ServerCommand) && ["WIDEINDEX", "EXTRATOKEN", "BADMODE"].includes(strCase);
					const bExpectedFailure = ![
						"SUCCESS",
						"NOCARRIER",
						"SPAWNSUCCESS",
						"SPAWNFALSE",
						"ALIVE",
						"SPECTATOR",
						"FORCE",
						"SKIPPED",
					].includes(strCase) && !bUsage;
					g_Assert.equal(bThrew, bExpectedFailure, `${strLabel} failure result`);

					if (strCase.endsWith("ERROR") || strCase.endsWith("NULL")) {
						g_Assert.equal(ErrorValue, strCase.endsWith("NULL") ? null : OriginalError, `${strLabel} original thrown value`);
					}

					if ((Scenario.Block === g_DocumentationBlocks.Carrier) && !bThrew) {
						g_Assert.equal(Result, (strCase === "NOCARRIER") ? null : CSSPlayer, `${strLabel} carrier identity`);
					}

					if ((Scenario.Block === g_DocumentationBlocks.Player) && !bThrew) {
						g_Assert.deepEqual(Result, strCase.startsWith("SPAWN") ? strCase !== "SPAWNFALSE" : { CarriesC4: true, Index: 1 }, `${strLabel} specialized result`);
					}

					if ((Scenario.Block === g_DocumentationBlocks.HumanPlayers) && !bThrew) {
						g_Assert.deepEqual(Result, ["ALIVE", "SPECTATOR"].includes(strCase) ? [] : [{ Index: 1, Spawned: true }, { Index: 2, Spawned: true }], `${strLabel} independent bulk results`);
					}

					if (strCase.startsWith("SECOND")) {
						g_Assert.equal(vecCalls.length, 2, `${strLabel} second failure retains first dispatch/no retry`);
					}

					if (bUsage || ["ALIVE", "SPECTATOR", "BADFORCE"].includes(strCase) || strCase.startsWith("REGISTER")) {
						g_Assert.equal(vecCalls.length, 0, `${strLabel} validation before mutation`);
					}

					if ((Scenario.Block === g_DocumentationBlocks.ServerCommand) && !bThrew) {
						g_Assert.equal(Result, 1, `${strLabel} actual command status`);
						g_Assert.equal(vecLogs.length, 1, `${strLabel} one log record`);
						g_Assert.equal(vecLogs[0][0], bUsage ? "WARNING" : "INFO", `${strLabel} log severity`);

						if (!bUsage) {
							g_Assert.deepEqual(vecCalls, [["Spawn", 1, strCase === "FORCE"]], `${strLabel} exact force flag`);

							const strOutcome = (strCase === "SKIPPED") ? "not eligible" : "dispatch completed";
							g_Assert.equal(vecLogs[0][1], `CSS player 1: ${strOutcome}; Force=${strCase === "FORCE"}.`, `${strLabel} truthful diagnostic`);
						}
					}

					if (bCleanupFailure) {
						g_Assert.equal(mapRegistrations.size, 1, `${strLabel} pending cleanup`);

						bCleanupFailure = false;
						Reflect.apply(RequireCSSDocumentationUnload(ModuleRecord.exports), ModuleRecord.exports, []);
					}

					if ((Scenario.Block === g_DocumentationBlocks.ServerCommand) && !strCase.startsWith("REGISTER")) {
						if (bThrew && !strCase.startsWith("UNREGISTER")) {
							Reflect.apply(RequireCSSDocumentationUnload(ModuleRecord.exports), ModuleRecord.exports, []);
						}

						g_Assert.equal(mapRegistrations.size, 0, `${strLabel} cleanup complete`);
					}
				}, strLabel);
			} finally {
				mapRegistrations.clear();
			}
		}

		console.log(`CSS documentation failure scenarios passed: ${vecScenarios.length}; SDK calls mocked.`);
	}

	CheckCSSDocumentationFailures(g_strDocumentation);

	g_Assert.equal(g_vecCodeBlocks.length, g_unDocumentationBlockCount, "players/engines/orangebox/cstrike documentation workflow count");
	g_Assert.ok(!g_strDocumentation.includes("Generated by"), "players/engines/orangebox/cstrike documentation must be maintained by hand.");
	g_Assert.ok(!g_strDocumentation.includes("console."), "CSS documentation must use SourceJS logging instead of console output.");
	g_Assert.ok(g_strDocumentation.includes("weapon_c4"), "CSS documentation must explain live C4 ownership.");
	g_Assert.ok(g_strDocumentation.includes("VSERVERTOOLS001::DispatchSpawn()"), "CSS documentation must explain the native spawn operation.");

	for (const strHeading of ["Input forms", "Errors", "Lifecycle", "Related modules"]) {
		g_Assert.ok(g_strDocumentation.includes(`## ${strHeading}`), `CSS documentation must include ${strHeading}.`);
	}

	const g_vecDocumentationModules = [];
	for (let unIndex = 0; unIndex < g_vecCodeBlocks.length; ++unIndex) {
		const ModuleRecord = { exports: {} };
		const Callback = CompileDocumentationModule(g_vecCodeBlocks[unIndex], unIndex);
		RunDocumentationWorkflow(() => Callback(RequireDocumentationModule, ModuleRecord, ModuleRecord.exports), "load fence " + (unIndex + 1));
		g_vecDocumentationModules.push(ModuleRecord.exports);
	}

	g_Assert.equal(g_vecNativeCalls.length, 0, "CSS documentation must not inspect or respawn players while examples load.");
	g_Assert.equal(g_vecDocumentationModules[g_DocumentationBlocks.ConfirmBranch].SelectedBranch, "css", "documented CSS branch invariant");

	const g_Carrier = RunDocumentationWorkflow(() => g_vecDocumentationModules[g_DocumentationBlocks.Carrier].FindC4Carrier(), "FindC4Carrier()");
	const g_Status = RunDocumentationWorkflow(() => g_vecDocumentationModules[g_DocumentationBlocks.Player].InspectCSSPlayer(1), "InspectCSSPlayer(1)");
	const g_bWrapperSpawned = RunDocumentationWorkflow(() => g_vecDocumentationModules[g_DocumentationBlocks.Player].RespawnWithCSSPlayer(1, false), "RespawnWithCSSPlayer(1, false)");
	const g_vecBulkResults = RunDocumentationWorkflow(() => g_vecDocumentationModules[g_DocumentationBlocks.HumanPlayers].RespawnDeadHumans(), "RespawnDeadHumans()");
	const g_CommandCallback = g_mapCommandRegistrations.get("sjs_css_respawn");

	g_Assert.ok(g_Carrier === g_Player, "documented C4 carrier helper result");
	g_Assert.deepEqual(g_Status, { CarriesC4: true, Index: 1 }, "documented specialized CSS player status");
	g_Assert.equal(g_bWrapperSpawned, true, "documented specialized CSS player spawn result");
	g_Assert.deepEqual(g_vecBulkResults, [{ Index: 1, Spawned: true }], "documented dead-human respawn results");
	g_Assert.equal(typeof g_CommandCallback, "function", "documented CSS command registration");

	const g_nInvalidCommandResult = RunDocumentationWorkflow(() => g_CommandCallback({ Arguments: ["sjs_css_respawn", "2", "invalid"], Name: "sjs_css_respawn", Raw: "sjs_css_respawn 2 invalid" }), "invalid command");
	const g_nValidCommandResult = RunDocumentationWorkflow(() => g_CommandCallback({ Arguments: ["sjs_css_respawn", "2", "force"], Name: "sjs_css_respawn", Raw: "sjs_css_respawn 2 force" }), "force command");

	g_Assert.equal(g_nInvalidCommandResult, 1, "documented invalid CSS command result");
	g_Assert.equal(g_nValidCommandResult, 1, "documented valid CSS command result");
	g_Assert.ok(g_vecLoggerRecords.some((vecRecord) => (vecRecord[0] === "WARNING") && vecRecord[1].includes("Usage:")), "documented CSS command usage log");
	g_Assert.ok(g_vecLoggerRecords.some((vecRecord) => (vecRecord[0] === "INFO") && vecRecord[1].includes("dispatch completed")), "documented CSS command result log");

	RunDocumentationWorkflow(() => Reflect.apply(RequireCSSDocumentationUnload(g_vecDocumentationModules[g_DocumentationBlocks.ServerCommand]), g_vecDocumentationModules[g_DocumentationBlocks.ServerCommand], []), "Unload()");

	g_Assert.equal(g_mapCommandRegistrations.size, 0, "documented CSS server command cleanup");
	g_Assert.ok(g_vecNativeCalls.some((vecCall) => (vecCall[0] === "HasC4") && (vecCall[1] === 1)), "documented CSS C4 carrier query");
	g_Assert.ok(g_vecNativeCalls.some((vecCall) => (vecCall[0] === "Player.Spawn") && (vecCall[1] === false)), "documented specialized CSS player spawn");
	g_Assert.ok(g_vecNativeCalls.some((vecCall) => (vecCall[0] === "Spawn") && (vecCall[1] === 1) && (vecCall[2] === false)), "documented non-forced CSS spawn");
	g_Assert.ok(g_vecNativeCalls.some((vecCall) => (vecCall[0] === "Spawn") && (vecCall[1] === 2) && (vecCall[2] === true)), "documented forced CSS server-command spawn");

	const g_strDocumentationWithoutCode = g_strDocumentation.replace(/```[\s\S]*?```/g, "");
	const g_vecLinks = [...g_strDocumentationWithoutCode.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((vecMatch) => vecMatch[1]);
	for (const strTarget of g_vecLinks) {
		if (strTarget.startsWith("#") || /^[a-z]+:/i.test(strTarget)) {
			continue;
		}

		const strTargetPath = g_Path.resolve(g_Path.dirname(g_strDocumentationPath), strTarget.split("#", 1)[0]);
		g_Assert.ok(g_FileSystem.existsSync(strTargetPath), `CSS documentation link must exist: ${strTarget}`);
	}

	const g_strModuleBindings = g_FileSystem.readFileSync(g_strModuleBindingsPath, "utf8");
	g_Assert.ok(g_strModuleBindings.includes('{ "Team", PlayerLiveProperty::Team }'), "CSS raw roster Team must match the native player binding (source wiring only).");
	g_Assert.equal(Object.hasOwn(g_Player, "TeamNumber"), false, "CSS raw roster fixtures must not invent TeamNumber.");
	g_Assert.ok(g_strModuleBindings.includes("std::strcmp(pszEntityClassName, kC4ClassName)"), "CSS HasC4 must scan the native C4 class.");
	g_Assert.ok(g_strModuleBindings.includes("PlayersGetOwnerEntityIndexFromEntity(pC4WeaponEntity, bHasOwnerProperty, nOwnerEntityIndex)"), "CSS HasC4 must read the live owner handle.");
	g_Assert.ok(g_strModuleBindings.includes("PlayersCounterStrikeSetIntegerProperty(pPlayerBaseEntity, kPlayerStatePropertyName, kDefaultPlayerState)"), "CSS spawn must activate the player state.");
	g_Assert.ok(g_strModuleBindings.includes("constexpr char kAliveLifeState = static_cast<char>(LIFE_ALIVE);"), "CSS spawn must retain the selected SDK's one-byte life-state value.");
	g_Assert.ok(g_strModuleBindings.includes("PlayersCounterStrikeSetIntegerProperty(pPlayerBaseEntity, kLifeStatePropertyName, kAliveLifeState)"), "CSS spawn must set the live life state without overwriting adjacent fields.");
	g_Assert.ok(g_strModuleBindings.includes("pServerTools->DispatchSpawn(pPlayerBaseEntity);"), "CSS spawn must dispatch through server tools.");
	g_Assert.ok(g_strModuleBindings.includes("v8::Local<v8::Object> const LocalCounterStrikePlayerEngineModule = MakeModule(pIsolate);"), "CSS native module installation");
} catch (CaughtError) {
	g_bMainFailed = true;
	g_MainError = CaughtError;
} finally {
	const vecCleanupErrors = [];
	const AttemptCleanup = (Cleanup) => {
		try {
			Cleanup();
		} catch (CaughtError) {
			vecCleanupErrors.push(CaughtError);
		}
	};
	for (const mapRegistrations of g_vecCleanupMaps) {
		AttemptCleanup(() => mapRegistrations.clear());
	}

	AttemptCleanup(ClearPackageCache);

	for (const [strPath, Descriptor] of g_mapPackageCacheDescriptors) {
		AttemptCleanup(() => Object.defineProperty(require.cache, strPath, Descriptor));
	}

	AttemptCleanup(() => Object.defineProperty(g_Module, "_load", g_ModuleLoadDescriptor));
	AttemptCleanup(() => {
		if (g_SourceJSDescriptor === undefined) {
			if (!Reflect.deleteProperty(globalThis, "sourcejs")) {
				throw new Error("Cannot restore the original SourceJS global.");
			}

		} else {
			Object.defineProperty(globalThis, "sourcejs", g_SourceJSDescriptor);
		}
	});

	if (g_bMainFailed) {
		vecCleanupErrors.unshift(g_MainError);
	}

	if (vecCleanupErrors.length === 1) {
		throw vecCleanupErrors[0];
	}

	if (vecCleanupErrors.length > 1) {
		throw new AggregateError(vecCleanupErrors, "Counter-Strike smoke check and cleanup failed.");
	}
}

console.log("[  OK  ] smoke_players_engines_cstrike");
