#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strDropWeaponPath = g_Path.join(g_strPackageRootPath, "players", "dropweapon.js");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "players-dropweapon.md");
const g_strModuleBindingsPath = g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "modules", "ModuleBindings.cpp");
const g_unDocumentationTimeoutMilliseconds = 1000;
const g_unDocumentationCodeBlockCount = 6;
const g_unMinimumDocumentationNativeCallCount = 6;
const g_DocumentationBlockIndexes = { Import: 0, ActiveWeapon: 1, ViewTarget: 2, Components: 3, PrimaryWeapon: 4, ClientCommand: 5 };
const g_setFixtureOwners = new Set();

// Bounds synchronous JavaScript only; this is not a security sandbox or native-IO cancellation.
function RunDocumentationFunction(Callback, Receiver, vecArguments, strLabel) {
	const Script = new g_VM.Script("Reflect.apply(Callback, Receiver, vecArguments)", { filename: `${g_strDocumentationPath}:${strLabel}` });

	return Script.runInNewContext({ Callback, Receiver, vecArguments, Reflect }, { timeout: g_unDocumentationTimeoutMilliseconds });
}

function CaptureMissingPlayerFactoryFailure() {
	const strPlayerSource = g_FileSystem.readFileSync(g_Path.join(g_strPackageRootPath, "players", "index.js"), "utf8");
	const vecDefinitions = ["RequireNativePlayer", "DecoratePlayer", "Player"].map((strFunctionName) => {
		const vecDefinition = strPlayerSource.match(new RegExp("^function " + strFunctionName + "\\([^\\r\\n]*\\) \\{[\\s\\S]*?^}", "m"));
		g_Assert.ok(vecDefinition, "Actual player factory definition: " + strFunctionName);

		return vecDefinition[0];
	});
	const InvokeFactory = g_VM.compileFunction(vecDefinitions.join("\n\n") + "\nreturn Player(0);", ["g_PlayersRuntime"], { filename: g_strDocumentationPath + ":ActualMissingPlayerFactory" });

	try {
		RunDocumentationFunction(InvokeFactory, undefined, [{ GetPlayer: () => null }], "Contract:MissingNativePlayer");
	} catch (ErrorValue) {
		g_Assert.equal(ErrorValue.name, "TypeError", "The decorated factory rejects a missing native player");
		g_Assert.match(ErrorValue.message, /native player object/);
		return ErrorValue;
	}

	throw new Error("The decorated Player() factory must reject a missing native player.");
}

function RequireDocumentationUnload(ModuleExports, bRequired) {
	const strRuntimeSource = g_FileSystem.readFileSync(g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "V8Runtime.cpp"), "utf8");
	const vecUnloadDefinition = strRuntimeSource.match(/^\tvoid V8Runtime::UnloadPlugin\([^\r\n]*\) \{[\s\S]*?^\t}/m);
	g_Assert.ok(vecUnloadDefinition, "Native plugin unload definition");
	g_Assert.match(vecUnloadDefinition[0], /CallPluginExportFunction\(strPluginName,\s*"Unload"\)/, "Documentation unload lookup must follow the current exact native export key");

	const Unload = ModuleExports.Unload;
	g_Assert.equal(Object.hasOwn(ModuleExports, "unload"), false, "No lowercase lifecycle alias");

	if (bRequired) {
		g_Assert.equal(typeof Unload, "function", "The command example must export the native unload entry point");
	}

	return Unload;
}

function RestoreDropWeaponProperty(Owner, strName, Descriptor) {
	if (Descriptor === undefined) {
		if (!Reflect.deleteProperty(Owner, strName)) {
			throw new Error(`Drop-weapon fixture could not delete temporary property ${strName}.`);
		}

		return;
	}

	Object.defineProperty(Owner, strName, Descriptor);
}

class Vector {
	constructor(flX = 0, flY = 0, flZ = 0) {
		this.X = flX;
		this.Y = flY;
		this.Z = flZ;
	}
}

const g_vecNativeCalls = [];
const g_mapCommandRegistrations = new Map();
const g_vecPlayerMessages = [];
const g_Player = {
	Index: 1,

	Say(strMessage) {
		g_vecPlayerMessages.push(strMessage);

		return true;
	},
};

const g_ActiveWeapon = {
	ClassName: "weapon_rifle",
	Index: 12,
};

const g_PrimaryWeapon = {
	ClassName: "weapon_rifle",
	Index: 14,
};

const g_NativeDropWeapon = {
	DropWeapon(PlayerValue, WeaponValue, Target = null, Velocity = null) {
		if (PlayerValue !== g_Player) {
			throw new TypeError("expected the live player fixture");
		}

		if ((WeaponValue !== g_ActiveWeapon) && (WeaponValue !== g_PrimaryWeapon)) {
			throw new TypeError("expected a CBaseCombatWeapon fixture");
		}

		g_vecNativeCalls.push({ Player: PlayerValue, Target, Velocity, Weapon: WeaponValue });

		return true;
	},
};

const g_Players = {
	GetActiveWeapon(PlayerValue) {
		g_Assert.ok(PlayerValue === g_Player, "GetActiveWeapon player fixture");

		return g_ActiveWeapon;
	},

	GetViewCoordinates(PlayerValue) {
		g_Assert.ok(PlayerValue === g_Player, "GetViewCoordinates player fixture");

		return new Vector(512, 128, 80);
	},

	GetPrimaryWeapon(PlayerValue) {
		g_Assert.ok(PlayerValue === g_Player, "GetPrimaryWeapon player fixture");

		return g_PrimaryWeapon;
	},
};

const g_ClientCommands = {
	RegisterCommand(strCommandName, CommandCallback) {
		g_Assert.equal(typeof CommandCallback, "function", "registered client callback");
		g_mapCommandRegistrations.set(strCommandName, CommandCallback);

		return true;
	},

	UnregisterCommand(strCommandName, CommandCallback) {
		g_Assert.ok(g_mapCommandRegistrations.get(strCommandName) === CommandCallback, "unregister must use the registered callback");
		g_mapCommandRegistrations.delete(strCommandName);

		return true;
	},
};

const g_UnregisterCommand = g_ClientCommands.UnregisterCommand;
const g_ModuleLoadDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");
const g_CacheDescriptor = Object.getOwnPropertyDescriptor(require.cache, g_strDropWeaponPath);

function ReleaseRootCommands() {
	const vecErrors = [];
	for (const [strName, Callback] of [...g_mapCommandRegistrations]) {
		try {
			const bReleased = RunDocumentationFunction(g_UnregisterCommand, g_ClientCommands, [strName, Callback], "Root:UnregisterCommand");
			if (bReleased !== true) {
				throw new Error(`Drop-weapon fixture could not unregister command ${strName}.`);
			}
		} catch (ErrorValue) {
			vecErrors.push(ErrorValue);
		}
	}

	if (vecErrors.length > 0) {
		throw new AggregateError(vecErrors, "Drop-weapon command cleanup failed.");
	}
}

function LoadDropWeaponModule() {
	const OriginalModuleLoad = g_Module._load;
	Object.defineProperty(g_Module, "_load", {
		...g_ModuleLoadDescriptor,

		value: function Load(strRequestName, ParentModule, bIsMain) {
			if (strRequestName === "internal/runtime") {
				return {
					GetModule(strModuleName) {
						if (strModuleName === "players/dropweapon") {
							return g_NativeDropWeapon;
						}

						throw new Error(`unexpected native module ${strModuleName}`);
					},
				};
			}

			return OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
		},
	});

	const DropWeaponModule = require(g_strDropWeaponPath);

	RestoreDropWeaponProperty(g_Module, "_load", g_ModuleLoadDescriptor);

	return DropWeaponModule;
}

let g_bFailed = false;
let g_Failure = null;

try {
	if (g_CacheDescriptor?.configurable === false) {
		throw new Error(`Drop-weapon fixture cannot replace non-configurable cache entry ${g_strDropWeaponPath}.`);
	}

	RestoreDropWeaponProperty(require.cache, g_strDropWeaponPath, undefined);
	const g_DropWeaponModule = LoadDropWeaponModule();
	g_Assert.ok(g_DropWeaponModule === g_NativeDropWeapon, "players/dropweapon must expose the exact native object.");
	g_Assert.deepEqual(Object.keys(g_DropWeaponModule), ["DropWeapon"], "players/dropweapon exact exports");
	g_Assert.equal(g_DropWeaponModule.DropWeapon(g_Player, g_ActiveWeapon), true, "DropWeapon direct native result");
	g_Assert.ok(g_vecNativeCalls[0].Player === g_Player, "DropWeapon must preserve the player argument.");
	g_Assert.ok(g_vecNativeCalls[0].Weapon === g_ActiveWeapon, "DropWeapon must preserve the weapon argument.");
	g_Assert.equal(g_vecNativeCalls[0].Target, null, "DropWeapon omitted target");
	g_Assert.equal(g_vecNativeCalls[0].Velocity, null, "DropWeapon omitted velocity");
	g_Assert.throws(() => g_DropWeaponModule.DropWeapon(g_Player, { Index: 99 }), /CBaseCombatWeapon/, "non-weapon rejection");
	g_Assert.ok(!Object.hasOwn(g_DropWeaponModule, "moduleName"), "players/dropweapon must not expose moduleName.");
	g_Assert.ok(!Object.hasOwn(g_DropWeaponModule, "default"), "players/dropweapon must not expose a default alias.");

	function CheckDocumentationDropWeaponFailures(strDocumentation) {
		const vecCodeBlocks = [...strDocumentation.matchAll(/\x60\x60\x60js\r?\n([\s\S]*?)\x60\x60\x60/g)].map((vecMatch) => vecMatch[1]);
		const vecHelperNames = [
			"DropActiveWeapon",
			"ThrowActiveWeapon",
			"ThrowWithComponents",
			"DropPrimaryWeapon",
			"DropCurrentWeapon",
		];

		const MissingPlayerFailure = CaptureMissingPlayerFactoryFailure();
		let unScenarioCount = 0;

		for (const unCodeBlockIndex of [
			g_DocumentationBlockIndexes.ActiveWeapon,
			g_DocumentationBlockIndexes.ViewTarget,
			g_DocumentationBlockIndexes.Components,
			g_DocumentationBlockIndexes.PrimaryWeapon,
			g_DocumentationBlockIndexes.ClientCommand,
		]) {
			const vecScenarios = [
				"SUCCESS",
				"NOWEAPON",
				"PLAYERUNAVAILABLE",
				"DROPFALSE",
				"DROPERROR",
				"DROPNULL",
				"INDEXERROR",
			];
			if (unCodeBlockIndex === g_DocumentationBlockIndexes.ViewTarget) {
				vecScenarios.push("NOTARGET", "TRACEERROR");
			}

			if (unCodeBlockIndex === g_DocumentationBlockIndexes.PrimaryWeapon) {
				vecScenarios.push("CLASSERROR");
			}

			if (unCodeBlockIndex === g_DocumentationBlockIndexes.ClientCommand) {
				vecScenarios.push("SAYFALSE", "SAYERROR", "REGISTERFALSE", "REGISTERERROR", "UNREGISTERFALSE", "UNREGISTERERROR");
			}

			for (const strScenario of vecScenarios) {
				++unScenarioCount;

				let OriginalError = MissingPlayerFailure;
				if (strScenario !== "PLAYERUNAVAILABLE") {
					OriginalError = (strScenario === "DROPNULL") ? null : new Error(strScenario);
				}

				const State = {
					Dropped: false,
					NativeCalls: 0,
					SayCalls: 0,
					RegisterCalls: 0,
					UnregisterCalls: 0,
					FailUnregister: strScenario.startsWith("UNREGISTER"),
				};
				let RegisteredCallback = null;

				const ReleaseFixture = () => {
					RegisteredCallback = null;
					g_setFixtureOwners.delete(ReleaseFixture);
				};
				g_setFixtureOwners.add(ReleaseFixture);

				const CurrentPlayer = {
					Index: 1,

					Say(strMessage) {
						g_Assert.equal(strMessage, "You do not have a weapon to drop.");
						++State.SayCalls;

						if (strScenario === "SAYERROR") {
							throw OriginalError;
						}

						return strScenario !== "SAYFALSE";
					},
				};

				const Weapon = {
					get Index() {
						if (State.Dropped) {
							throw new Error("weapon index expired after the SDK call");
						}

						if (strScenario === "INDEXERROR") {
							throw OriginalError;
						}

						return 12;
					},

					get ClassName() {
						if (State.Dropped) {
							throw new Error("weapon class expired after the SDK call");
						}

						if (strScenario === "CLASSERROR") {
							throw OriginalError;
						}

						return "weapon_rifle";
					},
				};

				const bNoWeapon = (strScenario === "NOWEAPON") || strScenario.startsWith("SAY");

				const ClientCommands = {
					RegisterCommand(strName, Callback) {
						g_Assert.equal(strName, "sjs_drop");
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
						g_Assert.equal(strName, "sjs_drop");
						g_Assert.equal(Callback, RegisteredCallback, "unload keeps the exact registered callback");
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

				const RequireModule = (strName) => {
					switch (strName) {
						case "players":
							return {
								GetActiveWeapon: () => bNoWeapon ? null : Weapon,

								GetPrimaryWeapon: () => bNoWeapon ? null : Weapon,

								GetViewCoordinates() {
									if (strScenario === "TRACEERROR") {
										throw OriginalError;
									}

									return (strScenario === "NOTARGET") ? null : new Vector(512, 128, 80);
								},
							};

						case "players/entity":
							return {
								Player() {
									if (strScenario === "PLAYERUNAVAILABLE") {
										throw OriginalError;
									}

									return CurrentPlayer;
								},
							};

						case "players/dropweapon":
							return {
								DropWeapon(PlayerValue, WeaponValue) {
									g_Assert.equal(PlayerValue, CurrentPlayer);
									g_Assert.equal(WeaponValue, Weapon);
									++State.NativeCalls;
									State.Dropped = true;

									if ((strScenario === "DROPERROR") || (strScenario === "DROPNULL")) {
										throw OriginalError;
									}

									return strScenario !== "DROPFALSE";
								},
							};

						case "mathlib":
							return { Vector };

						case "commands":
							return { CommandReturn: { Continue: 0, Block: 1, Handled: 1 } };

						case "commands/client":
							return ClientCommands;

						default:
							throw new Error("unexpected fixture module " + strName);
					}
				};

				const ModuleRecord = { exports: {} };
				const strLabel = `Contract-${unCodeBlockIndex}-${strScenario}`;
				const Callback = g_VM.compileFunction(vecCodeBlocks[unCodeBlockIndex], ["require", "module", "exports"], { filename: `${g_strDocumentationPath}:${strLabel}` });
				const Execute = () => RunDocumentationFunction(Callback, undefined, [RequireModule, ModuleRecord, ModuleRecord.exports], strLabel + ":Initialize");
				if (strScenario.startsWith("REGISTER")) {
					g_Assert.throws(Execute, (ErrorValue) => (strScenario === "REGISTERERROR") ? ErrorValue === OriginalError : /Unable to register/.test(ErrorValue.message));
					g_Assert.equal(State.NativeCalls, 0, "failed registration never drops a weapon");
					g_Assert.equal(RegisteredCallback, null);
					continue;
				}

				Execute();
				g_Assert.equal(State.NativeCalls, 0, "loading an example never drops a weapon");

				const Action = ModuleRecord.exports[vecHelperNames[unCodeBlockIndex - 1]];
				const Invoke = () => RunDocumentationFunction(Action, undefined, [(unCodeBlockIndex === g_DocumentationBlockIndexes.ClientCommand) ? { Index: 1 } : 1], strLabel + ":Action");
				if ([
					"DROPERROR",
					"DROPNULL",
					"INDEXERROR",
					"CLASSERROR",
					"TRACEERROR",
					"SAYERROR",
					"PLAYERUNAVAILABLE",
				].includes(strScenario)) {
					g_Assert.throws(Invoke, (ErrorValue) => ErrorValue === OriginalError, "original failure identity is preserved");

				} else if (["DROPFALSE", "SAYFALSE"].includes(strScenario)) {
					g_Assert.throws(Invoke, (ErrorValue) => /Unable|unavailable/.test(ErrorValue.message), "failure diagnostic does not read an expired weapon");

				} else {
					let Result = null;
					g_Assert.doesNotThrow(() => {
						Result = Invoke();
					}, "success never reads weapon fields after the SDK call");

					const ExpectedWeaponIndex = (bNoWeapon || (strScenario === "NOTARGET")) ? null : 12;
					g_Assert.equal((unCodeBlockIndex === g_DocumentationBlockIndexes.ClientCommand) ? Result : (Result?.WeaponIndex ?? Result?.Index ?? Result), (unCodeBlockIndex === g_DocumentationBlockIndexes.ClientCommand) ? 1 : ExpectedWeaponIndex);
				}

				const bReachedNativeCall = [
					"SUCCESS",
					"DROPFALSE",
					"DROPERROR",
					"DROPNULL",
					"UNREGISTERFALSE",
					"UNREGISTERERROR",
				].includes(strScenario);
				g_Assert.equal(State.NativeCalls, bReachedNativeCall ? 1 : 0, "no call after unavailable inputs or getter failure");
				g_Assert.equal(State.SayCalls, ((unCodeBlockIndex === g_DocumentationBlockIndexes.ClientCommand) && bNoWeapon) ? 1 : 0, "only the no-weapon command notifies the caller");

				if (unCodeBlockIndex === g_DocumentationBlockIndexes.ClientCommand) {
					g_Assert.equal(State.RegisterCalls, 1, "command is registered once without eager invocation");

					if (State.FailUnregister) {
						g_Assert.throws(() => RunDocumentationFunction(RequireDocumentationUnload(ModuleRecord.exports, true), undefined, [], strLabel + ":Unload"), (ErrorValue) => (strScenario === "UNREGISTERERROR") ? ErrorValue === OriginalError : /Unable to unregister/.test(ErrorValue.message));
						g_Assert.equal(RegisteredCallback, Action, "failed cleanup retains ownership for a retry");

						State.FailUnregister = false;
					}

					g_Assert.doesNotThrow(() => RunDocumentationFunction(RequireDocumentationUnload(ModuleRecord.exports, true), undefined, [], strLabel + ":Unload"));
					g_Assert.equal(RegisteredCallback, null);
					g_Assert.equal(State.UnregisterCalls, strScenario.startsWith("UNREGISTER") ? 2 : 1, "only failed command cleanup is retried");
				}
			}
		}

		process.stdout.write("players/dropweapon documentation: " + unScenarioCount + " expired-field, original-error, unavailable-input, and command-cleanup scenarios passed; SDK calls mocked.\n");
	}

	const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
	CheckDocumentationDropWeaponFailures(g_strDocumentation);

	const g_vecCodeBlocks = [...g_strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);

	const g_mapInvocationResults = new Map();
	const g_vecInvocationNames = [
		"DropActiveWeapon",
		"ThrowActiveWeapon",
		"ThrowWithComponents",
		"DropPrimaryWeapon",
	];

	const g_vecRequiredSections = [
		"Import",
		"API",
		"Drop the active weapon",
		"Throw toward the view target",
		"Vector input forms",
		"Drop the primary weapon",
		"Client command",
		"Errors",
		"Lifecycle",
		"Related modules",
	];

	g_Assert.equal(g_vecCodeBlocks.length, g_unDocumentationCodeBlockCount, "players/dropweapon documentation workflow count");
	g_Assert.ok(!g_strDocumentation.includes("Generated by"), "players/dropweapon documentation must be maintained by hand.");
	g_Assert.ok(g_strDocumentation.includes("CBasePlayer::Weapon_Drop()"), "players/dropweapon documentation must name the direct SDK operation.");
	g_Assert.ok(g_strDocumentation.includes("CBaseCombatWeapon"), "players/dropweapon documentation must explain native weapon validation.");
	g_Assert.doesNotMatch(g_strDocumentation, /\bconsole\s*\./, "players/dropweapon documentation must not depend on console output.");
	g_Assert.doesNotMatch(g_strDocumentation, /```text\r?\n[\s\S]*?dropWeapon/, "players/dropweapon signatures must not use text fences.");
	g_Assert.match(g_vecCodeBlocks[g_DocumentationBlockIndexes.Import], /const \{ DropWeapon \} = require\("players\/dropweapon"\);/, "players/dropweapon documentation must import the exact function.");

	for (const strSectionName of g_vecRequiredSections) {
		const strAnchor = strSectionName.toLowerCase().replace(/ /g, "-");
		g_Assert.ok(g_strDocumentation.includes(`- [${strSectionName}](#${strAnchor})`), `players/dropweapon contents must link ${strSectionName}.`);
		g_Assert.ok(g_strDocumentation.includes(`## ${strSectionName}`), `players/dropweapon documentation must contain ${strSectionName}.`);
	}

	function RequireDocumentation(strModuleName) {
		if (strModuleName === "commands") {
			return { CommandReturn: { Continue: 0, Handled: 1, Block: 1 } };
		}

		if (strModuleName === "commands/client") {
			return g_ClientCommands;
		}

		if (strModuleName === "mathlib") {
			return { Vector };
		}

		if (strModuleName === "players") {
			return g_Players;
		}

		if (strModuleName === "players/dropweapon") {
			return g_DropWeaponModule;
		}

		if (strModuleName === "players/entity") {
			return {
				Player(unPlayerIndex) {
					g_Assert.equal(unPlayerIndex, 1, "documented player index");

					return g_Player;
				},
			};
		}

		throw new Error(`unexpected documentation module ${strModuleName}`);
	}

	for (let unCodeBlockIndex = 0; unCodeBlockIndex < g_vecCodeBlocks.length; ++unCodeBlockIndex) {
		const ModuleRecord = { exports: {} };
		const strLabel = `Root-${unCodeBlockIndex + 1}`;
		const Callback = g_VM.compileFunction(g_vecCodeBlocks[unCodeBlockIndex], ["require", "module", "exports"], { filename: `${g_strDocumentationPath}:${strLabel}` });
		const unNativeCallCountBefore = g_vecNativeCalls.length;

		RunDocumentationFunction(Callback, undefined, [RequireDocumentation, ModuleRecord, ModuleRecord.exports], strLabel + ":Initialize");

		for (const strInvocationName of g_vecInvocationNames) {
			if (typeof ModuleRecord.exports[strInvocationName] !== "function") {
				continue;
			}

			g_Assert.equal(g_vecNativeCalls.length, unNativeCallCountBefore, `${strInvocationName} must not run during plugin load.`);
			g_mapInvocationResults.set(strInvocationName, RunDocumentationFunction(ModuleRecord.exports[strInvocationName], ModuleRecord.exports, [1], strLabel + ":" + strInvocationName));
		}

		if (typeof ModuleRecord.exports.DropCurrentWeapon === "function") {
			g_Assert.equal(g_vecNativeCalls.length, unNativeCallCountBefore, "command registration must not eagerly drop a weapon");
			const nResult = RunDocumentationFunction(ModuleRecord.exports.DropCurrentWeapon, ModuleRecord.exports, [{ Index: 1, Name: "sjs_drop", Raw: "sjs_drop" }], strLabel + ":DropCurrentWeapon");
			g_Assert.equal(nResult, 1, "documented client command result");
		}

		RunDocumentationFunction(() => {
			const Unload = RequireDocumentationUnload(ModuleRecord.exports, unCodeBlockIndex === g_DocumentationBlockIndexes.ClientCommand);
			if (typeof Unload === "function") {
				Reflect.apply(Unload, ModuleRecord.exports, []);
			}
		}, undefined, [], strLabel + ":Unload");
	}

	g_Assert.equal(g_mapCommandRegistrations.size, 0, "documented client command cleanup");
	g_Assert.ok(g_vecNativeCalls.length >= g_unMinimumDocumentationNativeCallCount, "documentation must exercise every drop workflow.");
	g_Assert.ok(g_vecNativeCalls.some((NativeCall) => (NativeCall.Target instanceof Vector) && (NativeCall.Velocity instanceof Vector)), "documented native Vector drop");
	g_Assert.ok(g_vecNativeCalls.some((NativeCall) => Array.isArray(NativeCall.Target) && (NativeCall.Velocity?.Z === 220)), "documented array/object vector drop");
	g_Assert.ok(g_vecNativeCalls.some((NativeCall) => NativeCall.Weapon === g_PrimaryWeapon), "documented primary-weapon drop");
	g_Assert.equal(g_mapInvocationResults.get("DropActiveWeapon"), g_ActiveWeapon.Index, "active-weapon helper result");
	g_Assert.equal(g_mapInvocationResults.get("ThrowActiveWeapon").WeaponIndex, g_ActiveWeapon.Index, "view-target helper result");
	g_Assert.equal(g_mapInvocationResults.get("ThrowWithComponents"), g_ActiveWeapon.Index, "component helper result");
	g_Assert.equal(g_mapInvocationResults.get("DropPrimaryWeapon").Index, g_PrimaryWeapon.Index, "primary-weapon helper result");
	g_Assert.equal(g_vecPlayerMessages.length, 0, "armed command fixture must not use the no-weapon message.");

	const g_strDocumentationWithoutCode = g_strDocumentation.replace(/```[\s\S]*?```/g, "");
	const g_vecLinks = [...g_strDocumentationWithoutCode.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((vecMatch) => vecMatch[1]);
	for (const strTarget of g_vecLinks) {
		if (strTarget.startsWith("#") || /^[a-z]+:/i.test(strTarget)) {
			continue;
		}

		const strTargetPath = g_Path.resolve(g_Path.dirname(g_strDocumentationPath), strTarget.split("#", 1)[0]);
		g_Assert.ok(g_FileSystem.existsSync(strTargetPath), `players/dropweapon documentation link must exist: ${strTarget}`);
	}

	const g_strModuleBindings = g_FileSystem.readFileSync(g_strModuleBindingsPath, "utf8");
	g_Assert.ok(g_strModuleBindings.includes("PlayersIsCombatWeapon"), "native DropWeapon must validate the weapon datamap.");
	g_Assert.ok(g_strModuleBindings.includes('constexpr char kCombatWeaponClassName[] = "CBaseCombatWeapon";'), "native DropWeapon must require CBaseCombatWeapon inheritance.");
	g_Assert.ok(g_strModuleBindings.includes("pBasePlayer->Weapon_Drop(pCombatWeapon, pTargetVector, pVelocityVector);"), "native DropWeapon must call the selected SDK method directly.");
} catch (ErrorValue) {
	g_bFailed = true;
	g_Failure = ErrorValue;
} finally {
	const vecErrors = [];
	for (const Release of [
		...g_setFixtureOwners,
		ReleaseRootCommands,
		() => RestoreDropWeaponProperty(g_Module, "_load", g_ModuleLoadDescriptor),
		() => RestoreDropWeaponProperty(require.cache, g_strDropWeaponPath, g_CacheDescriptor),
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

		throw new AggregateError(vecErrors, "Drop-weapon smoke state restoration failed.");
	}
}

if (g_bFailed) {
	throw g_Failure;
}

console.log("[smoke_players_drop_weapon] ok");
