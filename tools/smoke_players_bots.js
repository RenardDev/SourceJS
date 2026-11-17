#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strPlayersBotsPath = g_Path.join(g_strPackageRootPath, "players", "bots.js");
const g_strPlayersBotsDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "players-bots.md");

const g_unDocumentationTimeoutMilliseconds = 1000;
const g_unDocumentationCodeBlockCount = 4;
const g_DocumentationBlockIndexes = { RootImport: 0, Roster: 1, HumanCommands: 2, Identity: 3 };

// Bounds synchronous JavaScript only; this is not a security sandbox or native-IO cancellation.
function RunDocumentationFunction(Callback, Receiver, vecArguments, strLabel) {
	const Script = new g_VM.Script("Reflect.apply(Callback, Receiver, vecArguments)", { filename: `${g_strPlayersBotsDocumentationPath}:${strLabel}` });

	return Script.runInNewContext({ Callback, Receiver, vecArguments, Reflect }, { timeout: g_unDocumentationTimeoutMilliseconds });
}

function RestorePlayersBotsProperty(Owner, strName, Descriptor) {
	if (Descriptor === undefined) {
		if (!Reflect.deleteProperty(Owner, strName)) {
			throw new Error(`Players-bots fixture could not delete temporary property ${strName}.`);
		}

		return;
	}

	Object.defineProperty(Owner, strName, Descriptor);
}

const g_vecNativeCalls = [];
const g_Bot = {
	Connected: true,
	FakeClient: true,
	Index: 2,
	Name: "Bot",
	UserID: 22,

	ExecuteClientCommand(strCommand, bServerSide) {
		g_vecNativeCalls.push(["ExecuteClientCommand", this.Index, strCommand, bServerSide]);

		return true;
	},
};

const g_Human = {
	Connected: true,
	FakeClient: false,
	Index: 1,
	Name: "Human",
	UserID: 11,

	ExecuteClientCommand(strCommand, bServerSide) {
		g_vecNativeCalls.push(["ExecuteClientCommand", this.Index, strCommand, bServerSide]);

		return true;
	},
};

const g_NativeBots = {
	GetBotPlayers() {
		g_vecNativeCalls.push(["GetBotPlayers"]);

		return [g_Bot];
	},

	GetHumanPlayers() {
		g_vecNativeCalls.push(["GetHumanPlayers"]);

		return [g_Human];
	},

	GetPlayer(nEntityIndex) {
		g_vecNativeCalls.push(["GetPlayer", nEntityIndex]);

		if (arguments.length === 0) {
			throw new TypeError("GetPlayer(nEntityIndex) requires an argument.");
		}

		if (nEntityIndex === 1) {
			return g_Human;
		}

		if (nEntityIndex === 2) {
			return g_Bot;
		}

		return null;
	},
};

const g_ModuleLoadDescriptor = Object.getOwnPropertyDescriptor(g_Module, "_load");
const g_BotsCacheDescriptor = Object.getOwnPropertyDescriptor(require.cache, g_strPlayersBotsPath);
const g_MarkerDescriptor = Object.getOwnPropertyDescriptor(g_NativeBots, "Marker");

function LoadPlayersBotsModule() {
	const OriginalModuleLoad = g_Module._load;
	Object.defineProperty(g_Module, "_load", {
		configurable: true,
		enumerable: g_ModuleLoadDescriptor?.enumerable ?? true,

		value: function Load(strRequestName, ParentModule, bIsMain) {
			if (strRequestName === "internal/runtime") {
				return {
					GetModule(strModuleName) {
						if (strModuleName === "players/bots") {
							return g_NativeBots;
						}

						throw new Error(`unexpected native module ${strModuleName}`);
					},
				};
			}

			return OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
		},

		writable: true,
	});

	const Bots = require(g_strPlayersBotsPath);

	RestorePlayersBotsProperty(g_Module, "_load", g_ModuleLoadDescriptor);

	return Bots;
}

let g_bExecutionFailed = false;
let g_Failure = null;

try {
	delete require.cache[g_strPlayersBotsPath];

	const g_Bots = LoadPlayersBotsModule();
	const g_vecExpectedExports = ["GetBotPlayers", "GetHumanPlayers", "GetPlayer"].sort();

	g_Assert.ok(g_Bots === g_NativeBots, "players/bots must expose the exact native object.");
	g_Assert.deepEqual(Object.keys(g_Bots).sort(), g_vecExpectedExports, "players/bots exact exports.");
	g_Assert.equal(g_Bots.GetBotPlayers()[0].Name, "Bot", "native bot list");
	g_Assert.equal(g_Bots.GetHumanPlayers()[0].Name, "Human", "native human list");
	g_Assert.equal(g_Bots.GetPlayer(2).Name, "Bot", "native player factory");
	g_Assert.equal(g_Bots.GetPlayer(0), null, "nonpositive index has no player");
	g_Assert.equal(g_Bots.GetPlayer(999), null, "unresolved index has no fallback player");
	g_Assert.throws(() => g_Bots.GetPlayer(), TypeError, "a missing native index argument is distinct from an empty slot");
	g_Assert.ok(g_vecNativeCalls.some((vecCall) => (vecCall[0] === "GetPlayer") && (vecCall[1] === 2)), "GetPlayer must call the native object directly.");

	g_NativeBots.Marker = "live";
	g_Assert.equal(g_Bots.Marker, "live", "native bots object remains live");

	// Negative assertions intentionally retain obsolete public spellings.
	g_Assert.ok(!Object.hasOwn(g_Bots, "all"), "players/bots must not fabricate all().");
	g_Assert.ok(!Object.hasOwn(g_Bots, "botManager"), "players/bots must not fabricate botManager.");
	g_Assert.ok(!Object.hasOwn(g_Bots, "moduleName"), "players/bots must not expose moduleName.");
	g_Assert.ok(!Object.hasOwn(g_Bots, "default"), "players/bots must not expose a default alias.");

	function CheckDocumentationRosterState(strDocumentation) {
		const vecExamples = [...strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
		g_Assert.equal(vecExamples.length, g_unDocumentationCodeBlockCount, "bots documentation example inventory");

		const vecScenarios = [
			"HUMAN",
			"BOTONLY",
			"EMPTY",
			"FREED",
			"DISCONNECTED",
			"REPLACED",
			"ZEROUSERID",
			"INVALIDINDEX",
			"ZEROINDEX",
			"INVALIDUSERID",
			"NEGATIVEUSERID",
			"USERIDGETTERTHROW",
			"CURRENTINDEXMISMATCH",
			"INVALIDNAME",
			"NAMETHROW",
		];
		for (const strScenario of vecScenarios) {
			const OperationError = new Error("roster observation");
			const vecLookups = [];
			const vecNames = [];
			let bLookupStarted = false;
			let nLiveUserID = (strScenario === "ZEROUSERID") ? 0 : 11;
			let unOldGetterReadsAfterLookup = 0;
			const ListedPlayer = {
				Index: (strScenario === "INVALIDINDEX") ? "1" : ((strScenario === "ZEROINDEX") ? 0 : 1),

				get UserID() {
					if (bLookupStarted) {
						unOldGetterReadsAfterLookup += 1;
					}

					if (strScenario === "USERIDGETTERTHROW") {
						throw OperationError;
					}

					return (strScenario === "INVALIDUSERID") ? "11" : ((strScenario === "NEGATIVEUSERID") ? -1 : nLiveUserID);
				},
			};

			const CurrentPlayer = {
				Index: (strScenario === "CURRENTINDEXMISMATCH") ? 2 : 1,

				get UserID() {
					return nLiveUserID;
				},
			};

			const bInvalidSelection = ["INVALIDINDEX", "ZEROINDEX", "INVALIDUSERID", "NEGATIVEUSERID", "USERIDGETTERTHROW"].includes(strScenario);

			const DocumentationRequire = (strName) => {
				if (strName === "players/bots") {
					return {
						GetHumanPlayers: () => ["BOTONLY", "EMPTY"].includes(strScenario) ? [] : [ListedPlayer],

						GetBotPlayers: () => (strScenario === "BOTONLY") ? [ListedPlayer] : [],

						GetPlayer(nEntityIndex) {
							vecLookups.push(nEntityIndex);
							bLookupStarted = true;

							if (strScenario === "REPLACED") {
								nLiveUserID = 88;
							}

							return (strScenario === "FREED") ? null : CurrentPlayer;
						},
					};
				}

				g_Assert.equal(strName, "players", "identity example dependency");

				return {
					IsConnected: (PlayerValue) => {
						g_Assert.equal(PlayerValue, CurrentPlayer, "connected check uses the re-resolved wrapper");

						return strScenario !== "DISCONNECTED";
					},

					GetName(PlayerValue) {
						g_Assert.equal(PlayerValue, CurrentPlayer, "name query uses the re-resolved wrapper");

						vecNames.push(PlayerValue.Index);

						if (strScenario === "NAMETHROW") {
							throw OperationError;
						}

						return (strScenario === "INVALIDNAME") ? 42 : "Current Player";
					},
				};
			};

			const Execute = g_VM.compileFunction(`"use strict";\n${vecExamples[g_DocumentationBlockIndexes.Identity]}`, ["require"], { filename: `${g_strPlayersBotsDocumentationPath}:Identity-${strScenario}` });
			let bCaught = false;
			let ErrorValue = null;

			try {
				RunDocumentationFunction(Execute, undefined, [DocumentationRequire], `Scenario-${strScenario}`);
			} catch (CaughtError) {
				bCaught = true;
				ErrorValue = CaughtError;
			}

			const bFails = bInvalidSelection || ["CURRENTINDEXMISMATCH", "INVALIDNAME", "NAMETHROW"].includes(strScenario);
			const bNoLookup = bInvalidSelection || (strScenario === "EMPTY");
			const bNoName = bNoLookup || ["FREED", "DISCONNECTED", "REPLACED"].includes(strScenario);
			g_Assert.equal(bCaught, bFails, `identity ${strScenario}: failure visibility`);
			g_Assert.deepEqual(vecLookups, bNoLookup ? [] : [1], "only a validated saved slot is resolved");
			g_Assert.deepEqual(vecNames, bNoName ? [] : [CurrentPlayer.Index], "never consume a disconnected or replacement client");
			g_Assert.equal(unOldGetterReadsAfterLookup, 0, "use a saved primitive user ID, not the old wrapper's live getter");

			if (["USERIDGETTERTHROW", "NAMETHROW"].includes(strScenario)) {
				g_Assert.equal(ErrorValue, OperationError, "native observation error identity");
			}
		}

		for (const strScenario of [
			"DISJOINT",
			"OVERLAP",
			"INVALIDBOTNAME",
			"INVALIDHUMANNAME",
			"HUMANDISCONNECTED",
			"NAMETHROW",
		]) {
			const Human = { Index: 1 };
			const Bot = { Index: (strScenario === "OVERLAP") ? 1 : 2 };
			const vecNameQueries = [];
			const OperationError = new Error("partition name");

			const DocumentationRequire = (strName) => (strName === "players/bots") ? { GetHumanPlayers: () => [Human], GetBotPlayers: () => [Bot] } : {
				IsConnected: (PlayerValue) => {
					g_Assert.equal(PlayerValue, Human, "connected-human filter uses the human partition");

					return strScenario !== "HUMANDISCONNECTED";
				},

				GetName(PlayerValue) {
					vecNameQueries.push(PlayerValue);

					if (strScenario === "NAMETHROW") {
						throw OperationError;
					}

					return (((PlayerValue === Bot) && (strScenario === "INVALIDBOTNAME")) || ((PlayerValue === Human) && (strScenario === "INVALIDHUMANNAME"))) ? 42 : "Player";
				},
			};

			const Execute = g_VM.compileFunction(`"use strict";\n${vecExamples[g_DocumentationBlockIndexes.Roster]}`, ["require"], { filename: `${g_strPlayersBotsDocumentationPath}:Roster-${strScenario}` });
			let bCaught = false;
			let ErrorValue = null;

			try {
				RunDocumentationFunction(Execute, undefined, [DocumentationRequire], `Scenario-${strScenario}`);
			} catch (CaughtError) {
				bCaught = true;
				ErrorValue = CaughtError;
			}

			g_Assert.equal(bCaught, !["DISJOINT", "HUMANDISCONNECTED"].includes(strScenario), "partition example reports overlap or invalid names");

			const vecExpectedQueries = (strScenario === "OVERLAP") ? [] : (["HUMANDISCONNECTED", "NAMETHROW"].includes(strScenario) ? [Bot] : [Bot, Human]);
			g_Assert.deepEqual(vecNameQueries, vecExpectedQueries, "overlap fails before name lookup and disconnected humans are skipped");

			if (strScenario === "NAMETHROW") {
				g_Assert.equal(ErrorValue, OperationError, "partition name error identity");
			}
		}

		for (const strScenario of [
			"SUCCESS",
			"DISCONNECTED",
			"FIRSTFALSE",
			"SECONDFALSE",
			"THROW",
			"NULL",
			"MISSINGMETHOD",
		]) {
			const vecCalls = [];
			const OperationError = new Error("client submission");
			const vecHumans = [1, 2, 3].map((nEntityIndex) => ({
				Index: nEntityIndex,

				ExecuteClientCommand: ((strScenario === "MISSINGMETHOD") && (nEntityIndex === 1)) ? undefined : (strCommand, bServerSide) => {
					g_Assert.equal(strCommand, "echo SourceJS human client", "fixed command is not interpolated from player data");
					g_Assert.equal(bServerSide, false, "plugin-helper command submission path");

					vecCalls.push(nEntityIndex);

					if ((nEntityIndex === 1) && (strScenario === "THROW")) {
						throw OperationError;
					}

					if ((nEntityIndex === 1) && (strScenario === "NULL")) {
						throw null;
					}

					return !(((nEntityIndex === 1) && (strScenario === "FIRSTFALSE")) || ((nEntityIndex === 2) && (strScenario === "SECONDFALSE")));
				},
			}));

			const DocumentationRequire = (strName) => (strName === "players/bots") ? { GetHumanPlayers: () => vecHumans } : { IsConnected: (PlayerValue) => !((strScenario === "DISCONNECTED") && (PlayerValue.Index === 2)) };

			const Execute = g_VM.compileFunction(`"use strict";\n${vecExamples[g_DocumentationBlockIndexes.HumanCommands]}`, ["require"], { filename: `${g_strPlayersBotsDocumentationPath}:HumanCommands-${strScenario}` });
			let bCaught = false;
			let ErrorValue = null;

			try {
				RunDocumentationFunction(Execute, undefined, [DocumentationRequire], `Scenario-${strScenario}`);
			} catch (CaughtError) {
				bCaught = true;
				ErrorValue = CaughtError;
			}

			g_Assert.equal(bCaught, !["SUCCESS", "DISCONNECTED"].includes(strScenario), "command failure visibility");

			const vecExpectedCalls = (strScenario === "SUCCESS") ? [1, 2, 3] : ((strScenario === "DISCONNECTED") ? [1, 3] : ((strScenario === "SECONDFALSE") ? [1, 2] : ((strScenario === "MISSINGMETHOD") ? [] : [1])));
			g_Assert.deepEqual(vecCalls, vecExpectedCalls, "skip disconnected clients and stop after a failed submission, retaining earlier submissions");

			if (strScenario === "THROW") {
				g_Assert.equal(ErrorValue, OperationError, "submission error identity");
			}

			if (strScenario === "NULL") {
				g_Assert.equal(ErrorValue, null, "null submission error identity");
			}
		}
	}

	const g_strDocumentation = g_FileSystem.readFileSync(g_strPlayersBotsDocumentationPath, "utf8");
	CheckDocumentationRosterState(g_strDocumentation);

	const g_vecCodeBlocks = [...g_strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
	g_Assert.equal(g_vecCodeBlocks.length, g_unDocumentationCodeBlockCount, "players/bots documentation workflow count");
	g_Assert.ok(!g_strDocumentation.includes("Generated by"), "players/bots documentation must be maintained by hand.");
	g_Assert.doesNotMatch(g_strDocumentation, /\bconsole\.[A-Za-z_$]/, "players/bots documentation must use checked workflows instead of console output.");

	const g_vecRootImport = g_vecCodeBlocks[g_DocumentationBlockIndexes.RootImport].match(/const \{([^}]*)\} = require\("players\/bots"\);/);
	g_Assert.ok(g_vecRootImport, "players/bots documentation root import.");

	const g_vecImportedExports = g_vecRootImport[1].split(",").map((strName) => strName.split(":", 1)[0].trim()).filter(Boolean).sort();
	g_Assert.deepEqual(g_vecImportedExports, g_vecExpectedExports, "players/bots documentation root import must list the exact API.");

	const g_setDocumentedExports = new Set();
	for (const strLine of g_strDocumentation.split(/\r?\n/)) {
		if (!strLine.startsWith("| `")) {
			continue;
		}

		const strFirstCell = strLine.split("|", 3)[1];
		for (const vecMatch of strFirstCell.matchAll(/`([A-Za-z][A-Za-z0-9]*)(?:\([^`]*)?`/g)) {
			g_setDocumentedExports.add(vecMatch[1]);
		}
	}

	g_Assert.deepEqual([...g_setDocumentedExports].sort(), g_vecExpectedExports, "players/bots documentation must list the exact API.");

	const g_vecContents = g_strDocumentation.match(/## Contents\r?\n([\s\S]*?)\r?\n## Import/);
	g_Assert.ok(g_vecContents, "players/bots documentation contents section.");

	const g_vecContentsAnchors = [...g_vecContents[1].matchAll(/\]\(#([^)]+)\)/g)].map((vecMatch) => vecMatch[1]);
	const g_vecSectionAnchors = [...g_strDocumentation.matchAll(/^## (.+)$/gm)].map((vecMatch) => vecMatch[1].toLowerCase().replace(/`/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")).filter((strAnchor) => strAnchor !== "contents");
	g_Assert.deepEqual(g_vecContentsAnchors, g_vecSectionAnchors, "players/bots documentation contents anchors.");

	function RequireDocumentationModule(strModuleName) {
		if (strModuleName === "players/bots") {
			return g_Bots;
		}

		if (strModuleName === "players") {
			return {
				GetName(PlayerValue) {
					return PlayerValue.Name;
				},

				IsConnected(PlayerValue) {
					return PlayerValue.Connected;
				},
			};
		}

		throw new Error(`unexpected documentation module ${strModuleName}`);
	}

	for (let unCodeBlockIndex = 0; unCodeBlockIndex < g_vecCodeBlocks.length; ++unCodeBlockIndex) {
		const ModuleRecord = { exports: {} };
		const strLabel = `Root-${unCodeBlockIndex + 1}`;
		const Callback = g_VM.compileFunction(g_vecCodeBlocks[unCodeBlockIndex], ["require", "module", "exports"], { filename: `${g_strPlayersBotsDocumentationPath}:${strLabel}` });
		RunDocumentationFunction(Callback, undefined, [RequireDocumentationModule, ModuleRecord, ModuleRecord.exports], strLabel);
	}

	const g_strDocumentationWithoutCode = g_strDocumentation.replace(/```[\s\S]*?```/g, "");
	const g_vecLinks = [...g_strDocumentationWithoutCode.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((vecMatch) => vecMatch[1]);
	for (const strTarget of g_vecLinks) {
		if (strTarget.startsWith("#") || /^[a-z]+:/i.test(strTarget)) {
			continue;
		}

		const strTargetPath = g_Path.resolve(g_Path.dirname(g_strPlayersBotsDocumentationPath), strTarget.split("#", 1)[0]);
		g_Assert.ok(g_FileSystem.existsSync(strTargetPath), `players/bots documentation link must exist: ${strTarget}`);
	}

	g_Assert.ok(g_vecNativeCalls.some((vecCall) => (vecCall[0] === "ExecuteClientCommand") && (vecCall[1] === g_Human.Index)), "human workflow must call the native player method.");
	g_Assert.ok(!g_vecNativeCalls.some((vecCall) => (vecCall[0] === "ExecuteClientCommand") && (vecCall[1] === g_Bot.Index)), "human workflow must not command bots.");
} catch (ErrorValue) {
	g_bExecutionFailed = true;
	g_Failure = ErrorValue;
} finally {
	const vecCleanupErrors = [];
	for (const Restore of [
		() => RestorePlayersBotsProperty(g_Module, "_load", g_ModuleLoadDescriptor),
		() => RestorePlayersBotsProperty(require.cache, g_strPlayersBotsPath, g_BotsCacheDescriptor),
		() => RestorePlayersBotsProperty(g_NativeBots, "Marker", g_MarkerDescriptor),
	]) {
		try {
			Restore();
		} catch (ErrorValue) {
			vecCleanupErrors.push(ErrorValue);
		}
	}

	if (vecCleanupErrors.length > 0) {
		if (!g_bExecutionFailed && (vecCleanupErrors.length === 1)) {
			throw vecCleanupErrors[0];
		}

		if (g_bExecutionFailed) {
			vecCleanupErrors.unshift(g_Failure);
		}

		throw new AggregateError(vecCleanupErrors, "Players-bots fixture restoration failed.");
	}
}

if (g_bExecutionFailed) {
	throw g_Failure;
}

console.log("[smoke_players_bots] ok");
