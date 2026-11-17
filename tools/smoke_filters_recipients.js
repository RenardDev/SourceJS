#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");

const g_strPackageRootPath = g_Path.resolve(__dirname, "..", "packages", "sourcejs");
const g_strPackagePath = g_Path.join(g_strPackageRootPath, "filters", "recipients.js");
const g_strDocumentationPath = g_Path.resolve(__dirname, "..", "docs", "api", "filters-recipients.md");
const g_strTeamsPath = g_Path.join(g_strPackageRootPath, "players", "teams.js");
const g_strRuntimePath = g_Path.join(g_strPackageRootPath, "internal", "runtime.js");

const g_OriginalModuleLoad = g_Module._load;
const g_OriginalSourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
const g_vecCachePaths = [
	g_strPackagePath,
	g_strTeamsPath,
	g_strRuntimePath,
];
const g_mapOriginalCacheEntries = new Map(g_vecCachePaths.map((strModulePath) => [strModulePath, require.cache[strModulePath]]));

const g_nMinimumTeamNumber = -2147483648;
const g_nMaximumTeamNumber = 2147483647;
const g_nAnyTeamNumber = -1;

const g_TeamNumbers = { CounterTerrorist: 3, Terrorist: 2 };
const g_mapPlayerStates = new Map([
	[1, { Connected: true, Dead: false, FakeClient: false, Name: "Ren", Team: 2, UserID: 11 }],
	[2, { Connected: true, Dead: true, FakeClient: false, Name: "Bill", Team: 3, UserID: 22 }],
	[3, { Connected: true, Dead: false, FakeClient: true, Name: "Hunter", Team: 3, UserID: 33 }],
	[4, { Connected: false, Dead: false, FakeClient: false, Name: "Coach", Team: 1, UserID: 44 }],
]);

const g_vecMessageDeliveries = [];

function ExecutePlayerAction() {
	return true;
}

function CreateNativePlayerFacade(unIndex) {
	return {
		Ban: ExecutePlayerAction,
		ChangeTeam: ExecutePlayerAction,
		ExecuteClientCommand: ExecutePlayerAction,
		GiveNamedItem: ExecutePlayerAction,
		Kick: ExecutePlayerAction,
		Say: ExecutePlayerAction,
		SayTeam: ExecutePlayerAction,
		SetName: ExecutePlayerAction,
		Slay: ExecutePlayerAction,
		Index: unIndex,

		get Name() {
			return g_mapPlayerStates.get(unIndex).Name;
		},

		get UserID() {
			return g_mapPlayerStates.get(unIndex).UserID;
		},

		get Connected() {
			return g_mapPlayerStates.get(unIndex).Connected;
		},

		get Team() {
			return g_mapPlayerStates.get(unIndex).Team;
		},

		get Weapon() {
			return g_mapPlayerStates.get(unIndex).Dead ? "" : "weapon_smg";
		},

		get Model() {
			return `models/player/${g_mapPlayerStates.get(unIndex).Name.toLowerCase()}.mdl`;
		},
	};
}

function GetRecipientIndex(Value) {
	const unIndex = (typeof Value === "number") ? Value : Value?.Index;
	if (!Number.isSafeInteger(unIndex) || (unIndex <= 0)) {
		throw new TypeError("Recipient values must contain positive safe integer indexes.");
	}

	return unIndex;
}

function CreateTeamLookupName(strTeamName) {
	return strTeamName.replace(/[A-Z]/g, strCharacter => strCharacter.toLowerCase()).replace(/[_ -]/g, "");
}

function ResolveTeamNumber(TeamValue) {
	if ((TeamValue === null) || (TeamValue === undefined)) {
		return g_nAnyTeamNumber;
	}

	if (Number.isInteger(TeamValue) && (TeamValue >= g_nMinimumTeamNumber) && (TeamValue <= g_nMaximumTeamNumber)) {
		return TeamValue;
	}

	if (typeof TeamValue !== "string") {
		throw new TypeError("Team selector must be a string or signed 32-bit integer.");
	}

	const strTeamLookupName = CreateTeamLookupName(TeamValue);
	for (const vecTeamEntry of Object.entries(g_TeamNumbers)) {
		if (CreateTeamLookupName(vecTeamEntry[0]) === strTeamLookupName) {
			return vecTeamEntry[1];
		}
	}

	return g_nAnyTeamNumber;
}

function NormalizeIndexes(Values, bIncludeBots) {
	const vecSource = Array.isArray(Values) ? Values : (Array.isArray(Values?.RecipientIndexes) ? Values.RecipientIndexes : [Values]);
	const vecIndexes = [];

	for (const Value of vecSource) {
		const unIndex = GetRecipientIndex(Value);
		const State = g_mapPlayerStates.get(unIndex);
		if (!State?.Connected || (!bIncludeBots && State.FakeClient) || vecIndexes.includes(unIndex)) {
			continue;
		}

		vecIndexes.push(unIndex);
	}

	return vecIndexes;
}

function CreateRecipientInformation(vecIndexes) {
	return {
		RecipientIndexes: vecIndexes,
		RecipientPlayers: vecIndexes.map((unIndex) => CreateNativePlayerFacade(unIndex)),
		RecipientCount: vecIndexes.length,
	};
}

function GetCurrentIndexes(Predicate) {
	return Array.from(g_mapPlayerStates.entries()).filter(([, State]) => State.Connected && Predicate(State)).map(([unIndex]) => unIndex);
}

function ExtractJavaScriptBlocks(strMarkdown) {
	return [...strMarkdown.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
}

function VerifyWorldRecipientExamples(Recipients) {
	const unExpectedExampleCount = 2;
	const strExamplePath = g_Path.resolve(__dirname, "..", "examples", "plugins", "disabled", "api-world-objects", "index.js");
	const strExample = g_FileSystem.readFileSync(strExamplePath, "utf8");
	const strStartMarker = '\tLogResult("filters/recipients current groups",';
	const strEndMarker = '\tLogResult("filters/iterator live entity view",';
	const nExampleStart = strExample.indexOf(strStartMarker);
	const nExampleEnd = strExample.indexOf(strEndMarker, nExampleStart);
	g_Assert.ok((nExampleStart >= 0) && (nExampleEnd > nExampleStart), "world example must retain both recipient callbacks");

	const strImports = `const { ${Object.keys(Recipients).join(", ")} } = Recipients;`;
	const RunExamples = new Function("Recipients", "GetAllPlayers", "LogResult", "GetEntityIndexes", `${strImports}\n${strExample.slice(nExampleStart, nExampleEnd)}`);
	const mapOriginalConnections = new Map([...g_mapPlayerStates].map(([unIndex, State]) => [unIndex, State.Connected]));
	let unVerifiedProfileCount = 0;

	try {
		for (const bConnected of [false, true]) {
			for (const State of g_mapPlayerStates.values()) {
				State.Connected = bConnected;
			}

			// Snapshot consumers must not rely on decorated Player methods.
			const vecPlayers = [...g_mapPlayerStates].map(([unIndex, State]) => ({ Connected: State.Connected, Index: unIndex, TeamNumber: State.Team }));
			const mapResults = new Map();
			RunExamples(Recipients, () => vecPlayers, (strLabel, Callback) => mapResults.set(strLabel, Callback()), (vecPlayersToResolve) => vecPlayersToResolve.map((Player) => Player.Index));
			g_Assert.equal(mapResults.size, unExpectedExampleCount);

			const Groups = mapResults.get("filters/recipients current groups");
			const Conversions = mapResults.get("filters/recipients conversions and mutable filters");
			g_Assert.equal(Groups.WithBots.length, bConnected ? vecPlayers.length : 0);
			g_Assert.deepEqual(Groups.ByFirstPlayerTeam, bConnected ? Recipients.GetRecipientsByTeam(vecPlayers[0].TeamNumber, true).GetRecipientIndexes() : null);
			g_Assert.equal(Conversions.Mutable.Count, Conversions.Mutable.Indices.length);
			g_Assert.equal(Conversions.NativeRoundTrip.Count, Conversions.NativeRoundTrip.Indices.length);
			g_Assert.equal(Conversions.Mutable.Reliable, true);
			g_Assert.equal(Conversions.NativeRoundTrip.Reliable, true);
			g_Assert.deepEqual(Conversions.FromPlayer, bConnected ? [vecPlayers[0].Index] : []);
			g_Assert.deepEqual(Conversions.ResolvedPlayers, Groups.WithBots);
			g_Assert.equal(Conversions.NativeRoundTrip.InitializationMessage, false);
			++unVerifiedProfileCount;
		}
	} finally {
		for (const [unIndex, bConnected] of mapOriginalConnections) {
			g_mapPlayerStates.get(unIndex).Connected = bConnected;
		}
	}

	return unVerifiedProfileCount;
}

const g_NativeRecipients = {
	GetAliveRecipients() {
		return CreateRecipientInformation(GetCurrentIndexes((State) => !State.FakeClient && !State.Dead));
	},

	GetBotRecipients() {
		return CreateRecipientInformation(GetCurrentIndexes((State) => State.FakeClient));
	},

	GetRecipientsByTeam(TeamValue, bIncludeBots) {
		const nTeamNumber = ResolveTeamNumber(TeamValue);

		return CreateRecipientInformation(GetCurrentIndexes((State) => ((nTeamNumber < 0) || (State.Team === nTeamNumber)) && (bIncludeBots || !State.FakeClient)));
	},

	ContainsRecipient(Filter, Value) {
		return NormalizeIndexes(Filter, true).includes(GetRecipientIndex(Value));
	},

	GetDeadRecipients() {
		return CreateRecipientInformation(GetCurrentIndexes((State) => !State.FakeClient && State.Dead));
	},

	CreateRecipientFilterFromPlayer(Value, bIncludeBots) {
		return CreateRecipientInformation(NormalizeIndexes([Value], bIncludeBots));
	},

	CreateRecipientFilterFromValues(Values, bIncludeBots) {
		return CreateRecipientInformation(NormalizeIndexes(Values, bIncludeBots));
	},

	GetHumanRecipients() {
		return CreateRecipientInformation(GetCurrentIndexes((State) => !State.FakeClient));
	},

	ResolveRecipientPlayers(Filter) {
		return NormalizeIndexes(Filter, true).map((unIndex) => CreateNativePlayerFacade(unIndex));
	},

	GetAllRecipients() {
		return CreateRecipientInformation(GetCurrentIndexes(() => true));
	},
};

const g_Teams = {
	GetTeamNames() {
		return { ...g_TeamNumbers };
	},
};

class SayText2 {
	constructor(strMessage) {
		this.Message = strMessage;
	}

	SendUserMessage(Recipients) {
		g_vecMessageDeliveries.push({ RecipientIndexes: Recipients.GetRecipientIndexes(), Message: this.Message });

		return Recipients.RecipientCount > 0;
	}
}

function VerifyRecipientMessageContract(strExampleSource) {
	// Source alignment only; this check does not perform native message delivery.
	const strMessageSource = g_FileSystem.readFileSync(g_Path.join(g_strPackageRootPath, "messages", "index.js"), "utf8").replace(/\r\n/g, "\n");
	const vecCreatorClassMatch = strMessageSource.match(/^class UserMessageCreator \{([\s\S]*?)^}/m);
	g_Assert.ok(vecCreatorClassMatch, "The message creator definition must exist.");

	const VerifyCreatorMethod = (strCreatorClass) => {
		g_Assert.match(strCreatorClass, /^\tSendUserMessage\(TargetReferences, TranslationTokens = \{\}\) \{/m, "The documentation double must use the current message creator method.");
	};

	VerifyCreatorMethod(vecCreatorClassMatch[0]);
	g_Assert.throws(() => VerifyCreatorMethod(vecCreatorClassMatch[0].replace("SendUserMessage(", "SendMessage(")), { name: "AssertionError" });

	for (const strDeclaration of ["class SayText2 extends TextMessage {", "class TextMessage extends CustomUserMessageCreator {", "class CustomUserMessageCreator extends UserMessageCreator {"]) {
		g_Assert.ok(strMessageSource.includes(strDeclaration));
	}

	g_Assert.equal(strExampleSource.split(".SendUserMessage(").length, 2);
	g_Assert.equal(strExampleSource.includes(".SendMessage("), false);
	g_Assert.equal(typeof SayText2.prototype.SendUserMessage, "function");
	g_Assert.equal(SayText2.prototype.SendMessage, undefined);

	const Message = new SayText2("Controlled recipient delivery.");
	const unOriginalDeliveryCount = g_vecMessageDeliveries.length;
	try {
		g_Assert.strictEqual(Message.SendUserMessage({ GetRecipientIndexes: () => [], RecipientCount: 0 }), false);
		g_Assert.strictEqual(Message.SendUserMessage({ GetRecipientIndexes: () => [1], RecipientCount: 1 }), true);
	} finally {
		g_vecMessageDeliveries.length = unOriginalDeliveryCount;
	}
}

function VerifyRecipientTeamSelectors(Recipients) {
	for (const TeamValue of [
		"CounterTerrorist",
		"counterterrorist",
		"COUNTER_TERRORIST",
		"Counter-Terrorist",
		"Counter Terrorist",
		" Counter Terrorist ",
		3,
	]) {
		g_Assert.doesNotThrow(() => g_Assert.deepEqual(Recipients.GetRecipientsByTeam(TeamValue).GetRecipientIndexes(), [2]));
		g_Assert.doesNotThrow(() => g_Assert.deepEqual(Recipients.GetRecipientsByTeam(TeamValue, true).GetRecipientIndexes(), [2, 3]));
	}

	for (const TeamValue of [
		null,
		undefined,
		-1,
		"UnknownTeam",
		"",
		"Survivor",
	]) {
		g_Assert.doesNotThrow(() => g_Assert.deepEqual(Recipients.GetRecipientsByTeam(TeamValue).GetRecipientIndexes(), [1, 2]));
		g_Assert.doesNotThrow(() => g_Assert.deepEqual(Recipients.GetRecipientsByTeam(TeamValue, true).GetRecipientIndexes(), [1, 2, 3]));
	}

	for (const TeamValue of [
		1.5,
		NaN,
		Infinity,
		true,
		{},
		[],
		g_nMinimumTeamNumber - 1,
		g_nMaximumTeamNumber + 1,
	]) {
		g_Assert.throws(() => Recipients.GetRecipientsByTeam(TeamValue), TypeError);
	}
}

function VerifyRecipientUpdateFailureCommit(Recipients) {
	const unExpectedFailureScenarioCount = 8;
	let unFailureScenarioCount = 0;
	for (const Failure of [
		new Error("Controlled recipient resolution failure."),
		null,
		undefined,
		0,
	]) {
		for (const strFailurePhase of ["SOURCE", "OPTIONS"]) {
			const Filter = new Recipients.BaseRecipientFilter([1], { IncludeBots: false, Reliable: true, InitializationMessage: true });
			const vecOriginalIndexes = Filter.RecipientIndexes;
			const vecOriginalSources = [[1]];
			Filter.RecipientSourceFilters = vecOriginalSources;
			const FailingSource = {
				*[Symbol.iterator]() {
					yield 3;
					throw Failure;
				},
			};
			const Options = { ClearRecipients: true, IncludeBots: true, Reliable: false, InitializationMessage: false };
			if (strFailurePhase === "OPTIONS") {
				Object.defineProperty(Options, "Reliable", {
					get() {
						throw Failure;
					},
				});
			}

			let CapturedFailure = null;
			try {
				Filter.UpdateRecipients([2], (strFailurePhase === "SOURCE") ? FailingSource : [3], Options);
			} catch (CaughtFailure) {
				CapturedFailure = { Value: CaughtFailure };
			}

			g_Assert.notEqual(CapturedFailure, null);
			g_Assert.strictEqual(CapturedFailure.Value, Failure);
			g_Assert.strictEqual(Filter.RecipientIndexes, vecOriginalIndexes);
			g_Assert.deepEqual(Filter.GetRecipientIndexes(), [1]);
			g_Assert.strictEqual(Filter.RecipientSourceFilters, vecOriginalSources);
			g_Assert.deepEqual(vecOriginalSources, [[1]]);
			g_Assert.equal(Filter.IsRecipientFilterReliable(), true);
			g_Assert.equal(Filter.IsRecipientFilterInitializationMessage(), true);
			g_Assert.equal(Filter.IncludeBots, false);

			g_Assert.strictEqual(Filter.UpdateRecipients([2, 3, 2], { IncludeBots: true, Reliable: false, InitializationMessage: false }), Filter);
			g_Assert.strictEqual(Filter.RecipientIndexes, vecOriginalIndexes);
			g_Assert.deepEqual(Filter.GetRecipientIndexes(), [2, 3]);
			g_Assert.equal(Filter.IsRecipientFilterReliable(), false);
			g_Assert.equal(Filter.IsRecipientFilterInitializationMessage(), false);
			g_Assert.equal(Filter.IncludeBots, false);
			g_Assert.strictEqual(Filter.RecipientSourceFilters, vecOriginalSources);
			g_Assert.strictEqual(Filter.UpdateRecipients([1], { ClearRecipients: false }), Filter);
			g_Assert.deepEqual(Filter.GetRecipientIndexes(), [2, 3, 1]);
			g_Assert.strictEqual(Filter.UpdateRecipients(), Filter);
			g_Assert.deepEqual(Filter.GetRecipientIndexes(), [1]);
			++unFailureScenarioCount;
		}
	}

	g_Assert.equal(unFailureScenarioCount, unExpectedFailureScenarioCount);
}

try {
	for (const strModulePath of g_vecCachePaths) {
		delete require.cache[strModulePath];
	}

	// Replace the test bridge without invoking a prior accessor; restore its exact descriptor below.
	Object.defineProperty(globalThis, "sourcejs", {
		configurable: true,
		enumerable: true,
		writable: true,
		value: { "filters/recipients": g_NativeRecipients },
	});
	require.cache[g_strTeamsPath] = { exports: g_Teams, filename: g_strTeamsPath, id: g_strTeamsPath, loaded: true };

	g_Module._load = function Load(strRequestName, ParentModule, bIsMain) {
		if (strRequestName === "internal/runtime") {
			return require(g_strRuntimePath);
		}

		return g_OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
	};

	const g_Recipients = require(g_strPackagePath);
	g_Module._load = g_OriginalModuleLoad;
	VerifyRecipientTeamSelectors(g_Recipients);
	VerifyRecipientUpdateFailureCommit(g_Recipients);

	g_Assert.deepEqual(Object.keys(g_Recipients).sort(), [
		"BaseRecipientFilter",
		"ContainsRecipient",
		"CreateRecipientFilterFromPlayer",
		"CreateRecipientFilterFromValues",
		"GetAliveRecipients",
		"GetAllRecipients",
		"GetBotRecipients",
		"GetDeadRecipients",
		"GetHumanRecipients",
		"GetRecipientsByTeam",
		"RecipientFilter",
		"ResolveRecipientPlayers",
	]);
	g_Assert.deepEqual(g_Recipients.GetHumanRecipients().GetRecipientIndexes(), [1, 2]);
	g_Assert.deepEqual(g_Recipients.GetAllRecipients().GetRecipientIndexes(), [1, 2, 3]);
	g_Assert.deepEqual(g_Recipients.GetBotRecipients().GetRecipientIndexes(), [3]);
	g_Assert.deepEqual(g_Recipients.GetAliveRecipients().GetRecipientIndexes(), [1]);
	g_Assert.deepEqual(g_Recipients.GetDeadRecipients().GetRecipientIndexes(), [2]);
	g_Assert.deepEqual(g_Recipients.GetRecipientsByTeam(3).GetRecipientIndexes(), [2]);
	g_Assert.deepEqual(g_Recipients.GetRecipientsByTeam("CounterTerrorist", true).GetRecipientIndexes(), [2, 3]);
	g_Assert.deepEqual(g_Recipients.GetRecipientsByTeam().GetRecipientIndexes(), [1, 2]);
	g_Assert.deepEqual(g_Recipients.GetRecipientsByTeam(null, true).GetRecipientIndexes(), [1, 2, 3]);
	g_Assert.deepEqual(g_Recipients.GetRecipientsByTeam(-1, true).GetRecipientIndexes(), [1, 2, 3]);
	g_Assert.deepEqual(g_Recipients.GetRecipientsByTeam(g_nMinimumTeamNumber, true).GetRecipientIndexes(), [1, 2, 3]);
	g_Assert.deepEqual(g_Recipients.GetRecipientsByTeam(g_nMaximumTeamNumber, true).GetRecipientIndexes(), []);
	g_Assert.throws(() => g_Recipients.GetRecipientsByTeam(g_nMinimumTeamNumber - 1), /signed 32-bit integer/);
	g_Assert.throws(() => g_Recipients.GetRecipientsByTeam(g_nMaximumTeamNumber + 1), /signed 32-bit integer/);
	g_Assert.deepEqual(g_Recipients.CreateRecipientFilterFromPlayer(3).GetRecipientIndexes(), []);
	g_Assert.deepEqual(g_Recipients.CreateRecipientFilterFromPlayer({ Index: 3 }, true).GetRecipientIndexes(), [3]);
	g_Assert.throws(() => g_Recipients.CreateRecipientFilterFromPlayer({ m_unIndex: 3 }, true), /positive safe integer index/);
	g_Assert.deepEqual(g_Recipients.CreateRecipientFilterFromValues(new Set([1, 3, 1]), true).GetRecipientIndexes(), [1, 3]);

	const g_BaseFilter = new g_Recipients.BaseRecipientFilter([1, { Index: 2 }], { IncludeBots: false, InitializationMessage: true, Reliable: true });
	const g_vecLiveIndexes = g_BaseFilter.RecipientIndexes;

	g_Assert.equal(g_BaseFilter.RecipientLength, 2);
	g_Assert.equal(g_BaseFilter.RecipientCount, 2);
	g_Assert.equal(g_BaseFilter.IsRecipientFilterReliable(), true);
	g_Assert.equal(g_BaseFilter.IsRecipientFilterInitializationMessage(), true);
	g_Assert.equal(g_BaseFilter.At(-1), 2);
	g_Assert.equal(g_BaseFilter.At(99), null);
	g_Assert.equal(typeof g_BaseFilter.at, "undefined", "project-owned At must not expose a lowercase alias");
	g_Assert.equal(g_BaseFilter.GetRecipientIndex(99), 0);
	g_Assert.deepEqual(g_BaseFilter.Slice(0, 1), [1]);
	g_Assert.equal(typeof g_BaseFilter.slice, "undefined", "project-owned Slice must not expose a lowercase alias");
	g_Assert.equal(g_BaseFilter.toString(), "(1, 2)");
	g_Assert.deepEqual([...g_BaseFilter], [1, 2]);
	g_Assert.strictEqual(g_BaseFilter.AddRecipient(3), g_BaseFilter);
	g_Assert.strictEqual(g_BaseFilter.AddRecipient(3), g_BaseFilter);
	g_Assert.strictEqual(g_BaseFilter.RemoveRecipient(2), g_BaseFilter);
	g_Assert.strictEqual(g_BaseFilter.RecipientIndexes, g_vecLiveIndexes);
	g_Assert.deepEqual(g_BaseFilter.GetRecipientIndexes(), [1, 3]);
	g_Assert.equal(g_BaseFilter.ContainsRecipient(3), true);
	g_Assert.equal(g_BaseFilter.HasRecipient({ Index: 1 }), true);

	const g_vecPreservedIndexes = g_BaseFilter.GetRecipientIndexes();
	g_BaseFilter.UpdateRecipients(g_vecPreservedIndexes, { InitializationMessage: false, Reliable: false });
	g_Assert.equal(g_BaseFilter.IsRecipientFilterReliable(), false);
	g_Assert.equal(g_BaseFilter.IsRecipientFilterInitializationMessage(), false);
	g_Assert.strictEqual(g_BaseFilter.RecipientIndexes, g_vecLiveIndexes);
	g_Assert.strictEqual(g_BaseFilter.ClearRecipients(), g_BaseFilter);
	g_Assert.strictEqual(g_BaseFilter.RemoveAllPlayerRecipients(), g_BaseFilter);
	g_Assert.strictEqual(g_BaseFilter.AddAllPlayerRecipients(false), g_BaseFilter);
	g_Assert.deepEqual(g_BaseFilter.GetRecipientIndexes(), [1, 2]);
	g_Assert.strictEqual(g_BaseFilter.RemoveAllPlayerRecipients().AddAllPlayerRecipients(true), g_BaseFilter);
	g_Assert.deepEqual(g_BaseFilter.GetRecipientIndexes(), [1, 2, 3]);

	// Preserve the established public CreateRecipientFilterFromNativeInfo() spelling.
	const g_NativeBaseFilter = g_Recipients.BaseRecipientFilter.CreateRecipientFilterFromNativeInfo({ RecipientIndexes: [1], InitializationMessage: true, Reliable: true });
	const g_NativeRecipientFilter = g_Recipients.RecipientFilter.CreateRecipientFilterFromNativeInfo({ RecipientIndexes: [2], Reliable: true });
	g_Assert.equal(g_NativeBaseFilter instanceof g_Recipients.BaseRecipientFilter, true);
	g_Assert.equal(g_NativeRecipientFilter instanceof g_Recipients.RecipientFilter, true);
	g_Assert.deepEqual(g_NativeRecipientFilter.GetRecipientIndexes(), [2]);
	g_Assert.equal(g_NativeRecipientFilter.IsRecipientFilterReliable(), true);
	g_Assert.deepEqual(new g_Recipients.RecipientFilter().GetRecipientIndexes(), [1, 2, 3]);
	g_Assert.deepEqual(new g_Recipients.RecipientFilter({ IncludeBots: false }).GetRecipientIndexes(), [1, 2]);

	const g_StoredFilter = new g_Recipients.RecipientFilter(g_Recipients.GetHumanRecipients(), { IncludeBots: false, Reliable: true });
	g_StoredFilter.UpdateRecipients(g_Recipients.GetBotRecipients(), { ClearRecipients: false, IncludeBots: true });
	g_Assert.deepEqual(g_StoredFilter.GetRecipientIndexes(), [1, 2, 3]);
	g_Assert.equal(g_StoredFilter.RecipientSourceFilters.length, 1);

	const g_bOriginalStoredConnection = g_mapPlayerStates.get(2).Connected;
	g_mapPlayerStates.get(2).Connected = false;
	try {
		g_StoredFilter.UpdateRecipients();
		g_Assert.deepEqual(g_StoredFilter.GetRecipientIndexes(), [1]);
	} finally {
		g_mapPlayerStates.get(2).Connected = g_bOriginalStoredConnection;
	}

	g_Assert.equal(g_Recipients.ContainsRecipient(g_StoredFilter, 1), true);
	g_Assert.deepEqual(g_Recipients.ResolveRecipientPlayers(g_Recipients.GetAllRecipients()).map((Player) => Player.Name), ["Ren", "Bill", "Hunter"]);
	g_Assert.deepEqual(g_StoredFilter.ResolveRecipientPlayers().map((Player) => Player.Index), [1]);

	const g_Player = g_StoredFilter.ResolveRecipientPlayers()[0];
	g_Assert.equal(g_Player.Team, 2);
	g_Assert.equal(g_Player.Weapon, "weapon_smg");
	g_Assert.equal(g_Player.Model, "models/player/ren.mdl");
	g_Assert.equal(typeof g_Player.Slay, "function");
	g_Assert.equal(Object.hasOwn(g_Player, "SlayPlayer"), false);
	g_Assert.equal(Object.hasOwn(g_Player, "TeamNumber"), false);

	const g_strOriginalPlayerName = g_mapPlayerStates.get(1).Name;
	g_mapPlayerStates.get(1).Name = "Updated";
	try {
		g_Assert.equal(g_Player.Name, "Updated", "resolved Player facades read current state rather than compact snapshots");
	} finally {
		g_mapPlayerStates.get(1).Name = g_strOriginalPlayerName;
	}

	const g_GroupFilter = g_Recipients.GetHumanRecipients();
	const g_vecGroupSourceIndexes = g_GroupFilter.RecipientSourceFilters[0];
	g_Assert.equal(g_GroupFilter.IncludeBots, true, "native group construction does not override the future bot policy");
	g_Assert.notStrictEqual(g_GroupFilter.RecipientIndexes, g_vecGroupSourceIndexes);
	g_vecGroupSourceIndexes.push(3);
	g_GroupFilter.UpdateRecipients();
	g_Assert.deepEqual(g_GroupFilter.GetRecipientIndexes(), [1, 2, 3], "stored native group indexes are retained by reference");

	const g_StaleRemovalFilter = new g_Recipients.BaseRecipientFilter([2, 3], { IncludeBots: false });
	const g_vecStaleRemovalIndexes = g_StaleRemovalFilter.RecipientIndexes;
	const g_bOriginalRemovalConnection = g_mapPlayerStates.get(2).Connected;
	g_mapPlayerStates.get(2).Connected = false;
	try {
		g_Assert.equal(g_StaleRemovalFilter.ContainsRecipient(2), false, "membership queries normalize current connected clients");
		g_Assert.strictEqual(g_StaleRemovalFilter.RemoveRecipient(2), g_StaleRemovalFilter);
		g_Assert.deepEqual(g_StaleRemovalFilter.GetRecipientIndexes(), [3], "removal must purge a cached index after disconnect");
		g_Assert.strictEqual(g_StaleRemovalFilter.RecipientIndexes, g_vecStaleRemovalIndexes);
		g_Assert.throws(() => g_StaleRemovalFilter.RemoveRecipients([3, 0]), /positive safe integer/);
		g_Assert.deepEqual(g_StaleRemovalFilter.GetRecipientIndexes(), [3], "all removal indexes are validated before mutation");
		g_StaleRemovalFilter.RecipientIndexes.push(3);
		g_Assert.strictEqual(g_StaleRemovalFilter.RemoveRecipients(new Set([2, 3])), g_StaleRemovalFilter);
		g_Assert.deepEqual(g_StaleRemovalFilter.GetRecipientIndexes(), [], "bulk removal purges duplicate stored bots as well as disconnected indexes");
	} finally {
		g_mapPlayerStates.get(2).Connected = g_bOriginalRemovalConnection;
	}

	const g_InheritedIndex = Object.create({ Index: 1 });

	g_Assert.throws(() => g_Recipients.CreateRecipientFilterFromPlayer(0), /positive safe integer/);
	g_Assert.throws(() => g_Recipients.CreateRecipientFilterFromPlayer(g_InheritedIndex), /own positive safe integer/);
	g_Assert.throws(() => g_Recipients.CreateRecipientFilterFromValues([[1]], true), /positive safe integer/);
	g_Assert.throws(() => g_Recipients.CreateRecipientFilterFromValues([1], 1), /must be a boolean/);
	g_Assert.throws(() => new g_Recipients.BaseRecipientFilter([], { Reliable: 1 }), /must be a boolean/);
	g_Assert.throws(() => new g_Recipients.BaseRecipientFilter([], { Unknown: true }), /unknown option/);
	g_Assert.throws(() => new g_Recipients.BaseRecipientFilter([], new Date()), /plain or null-prototype/);
	g_Assert.throws(() => g_Recipients.BaseRecipientFilter.CreateRecipientFilterFromNativeInfo({ RecipientIndexes: "1,2" }), /RecipientIndexes array/);
	g_Assert.throws(() => g_Recipients.BaseRecipientFilter.CreateRecipientFilterFromNativeInfo({ RecipientIndexes: [1], Reliable: 1 }), /must be a boolean/);
	g_Assert.throws(() => new g_Recipients.RecipientFilter({ Unknown: true }), /unknown option/);
	g_Assert.throws(() => new g_Recipients.RecipientFilter(1, true), /positive safe integer/);

	const g_HiddenOptions = Object.defineProperty({}, "Reliable", { value: true });
	g_Assert.equal(new g_Recipients.BaseRecipientFilter([], g_HiddenOptions).IsRecipientFilterReliable(), true);
	g_Assert.throws(() => new g_Recipients.BaseRecipientFilter([], Object.defineProperty({}, "Unknown", { value: true })), /unknown option/);
	g_Assert.throws(() => new g_Recipients.BaseRecipientFilter([], { [Symbol("Unknown")]: true }), /unknown option/);

	const g_NativeInformationWithInheritedFlags = Object.assign(Object.create({ Reliable: true, InitializationMessage: true }), { RecipientIndexes: [1], Extra: true });
	const g_FilterWithInheritedFlags = g_Recipients.BaseRecipientFilter.CreateRecipientFilterFromNativeInfo(g_NativeInformationWithInheritedFlags);
	g_Assert.equal(g_FilterWithInheritedFlags.IsRecipientFilterReliable(), false);
	g_Assert.equal(g_FilterWithInheritedFlags.IsRecipientFilterInitializationMessage(), false);

	const g_CallerEditedFilter = new g_Recipients.BaseRecipientFilter([1]);
	g_CallerEditedFilter.RecipientIndexes.push(1, null);
	g_Assert.equal(g_CallerEditedFilter.RecipientCount, 3);
	g_Assert.equal(g_CallerEditedFilter.At(-1), null);
	g_Assert.deepEqual(g_CallerEditedFilter.GetRecipientIndexes(), [1, 1, null]);
	g_Assert.deepEqual(g_CallerEditedFilter.Slice(), [1, 1, null]);
	g_Assert.equal(g_CallerEditedFilter.GetRecipientIndex(1), 1);
	g_Assert.throws(() => g_CallerEditedFilter.GetRecipientIndex(-1), /positive safe integer/);

	const g_vecReplacementIndexes = [3];
	g_CallerEditedFilter.RecipientIndexes = g_vecReplacementIndexes;
	g_Assert.strictEqual(g_CallerEditedFilter.ClearRecipients(), g_CallerEditedFilter);
	g_Assert.strictEqual(g_CallerEditedFilter.RecipientIndexes, g_vecReplacementIndexes);
	g_Assert.deepEqual(g_vecReplacementIndexes, []);

	const g_RejectDocumentationConsole = () => {
		throw new Error("Recipient documentation must use the typed logger.");
	};
	const g_ConsoleDouble = new Proxy({}, { get: g_RejectDocumentationConsole });

	function CreateDocumentationRequire(Recipients, LogInfo) {
		return strModuleName => {
			if (strModuleName === "filters/recipients") {
				return Recipients;
			}

			if (strModuleName === "players/teams") {
				return g_Teams;
			}

			if (strModuleName === "messages") {
				return { SayText2 };
			}

			if (strModuleName === "loggers") {
				return { LogInfo };
			}

			throw new Error(`Unexpected documentation module: ${strModuleName}`);
		};
	}

	function VerifyDocumentationRequireContracts() {
		const Recipients = {};
		const vecLogCalls = [];
		const LogInfo = (...vecArguments) => vecLogCalls.push(vecArguments);
		const DocumentationRequire = CreateDocumentationRequire(Recipients, LogInfo);
		g_Assert.strictEqual(DocumentationRequire("filters/recipients"), Recipients);
		g_Assert.strictEqual(DocumentationRequire("players/teams"), g_Teams);
		g_Assert.strictEqual(DocumentationRequire("messages").SayText2, SayText2);
		g_Assert.strictEqual(DocumentationRequire("loggers").LogInfo, LogInfo);
		DocumentationRequire("loggers").LogInfo("RecipientProbe Count=%d", 2);
		g_Assert.deepEqual(vecLogCalls, [["RecipientProbe Count=%d", 2]]);
		g_Assert.throws(() => DocumentationRequire("UnknownModule"), /Unexpected documentation module/);
		g_Assert.throws(() => g_ConsoleDouble.log, /typed logger/);
	}

	VerifyDocumentationRequireContracts();
	const g_unExpectedDocumentationBlockCount = 10;
	const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
	const g_vecBlocks = ExtractJavaScriptBlocks(g_strDocumentation);
	let g_unExecutedDocumentationBlockCount = 0;
	const g_vecDocumentationLogCalls = [];
	const g_LogDocumentationInfo = (...vecArguments) => g_vecDocumentationLogCalls.push(vecArguments);
	const g_DocumentationRequire = CreateDocumentationRequire(g_Recipients, g_LogDocumentationInfo);
	g_Assert.equal(g_vecBlocks.length, g_unExpectedDocumentationBlockCount, "filters/recipients documentation must contain ten executable JavaScript blocks");
	const g_unMessageDeliveryBlockIndex = 8;
	VerifyRecipientMessageContract(g_vecBlocks[g_unMessageDeliveryBlockIndex]);

	for (const strBlock of g_vecBlocks) {
		const RunBlock = new Function("require", "console", strBlock);
		RunBlock(g_DocumentationRequire, g_ConsoleDouble);
		++g_unExecutedDocumentationBlockCount;
	}

	g_Assert.equal(g_unExecutedDocumentationBlockCount, g_vecBlocks.length, "Every recipient documentation block must execute.");
	const g_unExpectedDocumentationLogCount = 13;
	g_Assert.equal(g_vecDocumentationLogCalls.length, g_unExpectedDocumentationLogCount, "Every recipient diagnostic must reach the typed logger.");
	const g_HasOnlyStringLogArguments = (vecArguments) => vecArguments.every((Argument) => typeof Argument === "string");
	g_Assert.equal(g_vecDocumentationLogCalls.every(g_HasOnlyStringLogArguments), true, "Recipient diagnostics must pass explicit strings/JSON rather than live objects.");

	const g_vecConversionLogCalls = g_vecDocumentationLogCalls.filter((vecArguments) => vecArguments[0] === "RecipientConversions %s");
	g_Assert.equal(g_vecConversionLogCalls.length, 1, "The conversion example must emit exactly one diagnostic record.");
	const g_ConversionReport = JSON.parse(g_vecConversionLogCalls[0][1]);
	g_Assert.deepEqual(g_ConversionReport.RecipientPlayerNames, ["Ren", "Bill"], "Conversion diagnostics must project live Player facades to names.");

	for (const strExportName of [
		"BaseRecipientFilter",
		"RecipientFilter",
		"ContainsRecipient",
		"CreateRecipientFilterFromPlayer",
		"CreateRecipientFilterFromValues",
		"GetAliveRecipients",
		"GetAllRecipients",
		"GetBotRecipients",
		"GetDeadRecipients",
		"GetHumanRecipients",
		"GetRecipientsByTeam",
		"ResolveRecipientPlayers",
	]) {
		g_Assert.match(g_strDocumentation, new RegExp(`\\b${strExportName}\\b`), `documentation must cover ${strExportName}`);
	}

	for (const strMemberName of [
		"RecipientIndexes",
		"RecipientSourceFilters",
		"IncludeBots",
		"Reliable",
		"InitializationMessage",
		"RecipientLength",
		"RecipientCount",
		"CreateRecipientFilterFromNativeInfo",
		"ClearRecipients",
		"At",
		"Slice",
		"IsRecipientFilterReliable",
		"IsRecipientFilterInitializationMessage",
		"GetRecipientIndex",
		"AddRecipients",
		"RemoveRecipients",
		"AddAllPlayerRecipients",
		"RemoveAllPlayerRecipients",
		"AddRecipient",
		"RemoveRecipient",
		"HasRecipient",
		"ContainsRecipient",
		"MergeRecipients",
		"UpdateRecipients",
		"ResolveRecipientPlayers",
		"GetRecipientIndexes",
		"toString",
	]) {
		g_Assert.match(g_strDocumentation, new RegExp(`\\b${strMemberName}\\b`), `documentation must cover ${strMemberName}`);
	}

	for (const strForbiddenTerm of [
		"Generated by",
		"generate_api_docs",
		"console.log(instance)",
		"console.log(result)",
		"new Vector(128",
		"sourcejs:example",
	]) {
		g_Assert.equal(g_strDocumentation.includes(strForbiddenTerm), false, `documentation must not contain ${strForbiddenTerm}`);
	}

	g_Assert.doesNotMatch(g_strDocumentation, /\bconsole\./, "Executable recipient documentation must use typed logging.");

	g_Assert.equal(g_vecMessageDeliveries.some((Delivery) => Delivery.Message === "The round is live."), true, "documentation must request delivery through the message test double");

	for (const strRemovedName of ["all", "from", "one", "players"]) {
		g_Assert.equal(Object.hasOwn(g_Recipients, strRemovedName), false);
	}

	g_Assert.equal(typeof g_BaseFilter.toJSON, "undefined");
	g_Assert.equal(Object.hasOwn(g_Recipients, "moduleName"), false);
	g_Assert.equal(Object.hasOwn(g_Recipients, "default"), false);

	const g_unExpectedWorldProfileCount = 2;
	g_Assert.equal(VerifyWorldRecipientExamples(g_Recipients), g_unExpectedWorldProfileCount, "Both recipient world example profiles must execute.");

	console.log("[  OK  ] filters/recipients contracts and documentation passed with recipient/message doubles; native SDK execution not exercised");
} finally {
	g_Module._load = g_OriginalModuleLoad;

	for (const [strModulePath, CacheEntry] of g_mapOriginalCacheEntries) {
		delete require.cache[strModulePath];

		if (CacheEntry !== undefined) {
			require.cache[strModulePath] = CacheEntry;
		}
	}

	if (g_OriginalSourceJSDescriptor === undefined) {
		delete globalThis.sourcejs;
	} else {
		Object.defineProperty(globalThis, "sourcejs", g_OriginalSourceJSDescriptor);
	}
}
