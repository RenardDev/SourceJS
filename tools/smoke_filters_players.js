#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");

const g_strPackageRootPath = g_Path.resolve(__dirname, "..", "packages", "sourcejs");
const g_strPackagePath = g_Path.join(g_strPackageRootPath, "filters", "players.js");
const g_strTeamsPath = g_Path.join(g_strPackageRootPath, "players", "teams.js");
const g_strRuntimePath = g_Path.join(g_strPackageRootPath, "internal", "runtime.js");
const g_strIteratorPath = g_Path.join(g_strPackageRootPath, "filters", "iterator.js");
const g_strDocumentationPath = g_Path.resolve(__dirname, "..", "docs", "api", "filters-players.md");
const g_strModuleBindingsPath = g_Path.resolve(__dirname, "..", "src", "sourcejs", "modules", "ModuleBindings.cpp");

const g_OriginalModuleLoad = g_Module._load;
const g_OriginalSourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
const g_vecCachePaths = [
	g_strPackagePath,
	g_strTeamsPath,
	g_strRuntimePath,
	g_strIteratorPath,
];
const g_mapOriginalCacheEntries = new Map(g_vecCachePaths.map((strModulePath) => [strModulePath, require.cache[strModulePath]]));
const g_RejectDocumentationConsole = () => {
	throw new Error("Player documentation must use the typed logger.");
};
const g_ConsoleDouble = new Proxy({}, { get: g_RejectDocumentationConsole });

const g_nAnyTeamNumber = -1;
const g_nMinimumTeamNumber = -2147483648;
const g_nMaximumTeamNumber = 2147483647;

const g_TeamNumbers = { CounterTerrorist: 3, Terrorist: 2 };
const g_mapPlayerStates = new Map([
	[1, { Connected: true, Dead: false, Deaths: 1, FakeClient: false, Frags: 4, Health: 80, MaximumHealth: 100, Name: "Ren", Team: 2, UserID: 11 }],
	[2, { Connected: true, Dead: false, Deaths: 0, FakeClient: true, Frags: 2, Health: 40, MaximumHealth: 100, Name: "Hunter", Team: 3, UserID: 22 }],
	[3, { Connected: true, Dead: true, Deaths: 3, FakeClient: true, Frags: 1, Health: 0, MaximumHealth: 100, Name: "Smoker", Team: 3, UserID: 33 }],
	[4, { Connected: false, Dead: false, Deaths: 0, FakeClient: false, Frags: 0, Health: 100, MaximumHealth: 100, Name: "Coach", Team: 1, UserID: 44 }],
]);

const g_vecPlayerMethodCalls = [];
let g_bHasGiveNamedItem = true;
let g_vecLastNativeScanPlayers = [];
let g_unNativeAllPlayerScanCount = 0;
let g_unUnusedCollectionIterationCount = 0;

const g_FirstCustomPlayer = { Index: 1, Label: "First" };
const g_SecondCustomPlayer = { Index: 2, Label: "Second" };
const g_LastCustomPlayer = { Index: 1, Label: "Last" };
const g_RightCustomPlayer = { Index: 1, Label: "Right" };
const g_CustomFilters = {
	Left: [g_FirstCustomPlayer, g_SecondCustomPlayer, g_LastCustomPlayer],
	Right: [g_RightCustomPlayer],
};

function CreatePlayerMethod(Player, strOperation, Result = true) {
	return function ExecutePlayerAction(...vecArguments) {
		g_Assert.strictEqual(this, Player, "player actions must retain the native receiver");
		g_vecPlayerMethodCalls.push({ Arguments: vecArguments, Index: Player.Index, Operation: strOperation });

		return Result;
	};
}

function CreateNativePlayer(unIndex) {
	const State = g_mapPlayerStates.get(unIndex);
	const Player = {
		Connected: State.Connected,
		Dead: State.Dead,
		Deaths: State.Deaths,
		FakeClient: State.FakeClient,
		Frags: State.Frags,
		Free: false,
		Health: State.Health,
		Index: unIndex,
		Language: State.FakeClient ? "" : "english",
		MaximumHealth: State.MaximumHealth,
		Model: `models/player/${State.Name.toLowerCase()}.mdl`,
		Name: State.Name,
		NetworkID: State.FakeClient ? "BOT" : `STEAM_1:0:${unIndex}`,
		Origin: { X: unIndex * 10, Y: unIndex * 20, Z: 64 },
		RemoteAddress: State.FakeClient ? "" : `127.0.0.1:${27000 + unIndex}`,
		Team: State.Team,
		UserID: State.UserID,
		Weapon: State.Dead ? "" : "weapon_smg",
	};

	Object.assign(Player, {
		Ban: CreatePlayerMethod(Player, "Ban"),
		ChangeTeam: CreatePlayerMethod(Player, "ChangeTeam"),
		ExecuteClientCommand: CreatePlayerMethod(Player, "ExecuteClientCommand"),
		GiveNamedItem: CreatePlayerMethod(Player, "GiveNamedItem", { Index: 100 + unIndex }),
		Kick: CreatePlayerMethod(Player, "Kick"),
		Say: CreatePlayerMethod(Player, "Say"),
		SayTeam: CreatePlayerMethod(Player, "SayTeam"),
		SetName: CreatePlayerMethod(Player, "SetName"),
		Slay: CreatePlayerMethod(Player, "Slay"),
	});

	if (!g_bHasGiveNamedItem) {
		delete Player.GiveNamedItem;
	}

	return Player;
}

function GetNativeConnectedPlayers() {
	const vecPlayers = [];
	for (const vecPlayerEntry of g_mapPlayerStates.entries()) {
		const unIndex = vecPlayerEntry[0];
		const State = vecPlayerEntry[1];
		if (State.Connected) {
			vecPlayers.push(CreateNativePlayer(unIndex));
		}
	}

	g_vecLastNativeScanPlayers = vecPlayers;

	return vecPlayers;
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

	if (typeof TeamValue === "string") {
		const strLookupName = CreateTeamLookupName(TeamValue);
		for (const vecTeamEntry of Object.entries(g_TeamNumbers)) {
			if (CreateTeamLookupName(vecTeamEntry[0]) === strLookupName) {
				return vecTeamEntry[1];
			}
		}

		return g_nAnyTeamNumber;
	}

	throw new TypeError("Team selector must be a string or signed 32-bit integer.");
}

function* GenerateUnusedCustomPlayers() {
	g_unUnusedCollectionIterationCount++;
	yield g_SecondCustomPlayer;
}

function ExtractJavaScriptBlocks(strMarkdown) {
	return [...strMarkdown.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
}

const g_NativePlayers = {
	GetTeam(Player) {
		return g_mapPlayerStates.get(Player.Index).Team;
	},

	GetUserID(Player) {
		return g_mapPlayerStates.get(Player.Index).UserID;
	},

	IsFakeClient(Player) {
		return g_mapPlayerStates.get(Player.Index).FakeClient;
	},

	IsConnected(Player) {
		return g_mapPlayerStates.get(Player.Index).Connected;
	},

	IsDead(Player) {
		return g_mapPlayerStates.get(Player.Index).Dead;
	},
};

const g_NativePlayerFilters = {
	GetAllPlayers() {
		g_Assert.strictEqual(this, g_NativePlayerFilters);
		g_unNativeAllPlayerScanCount++;

		return GetNativeConnectedPlayers();
	},

	GetBotPlayers() {
		g_Assert.strictEqual(this, g_NativePlayerFilters);

		return GetNativeConnectedPlayers().filter((Player) => Player.FakeClient);
	},

	GetPlayersByTeam(TeamValue = null) {
		g_Assert.strictEqual(this, g_NativePlayerFilters);

		const nTeamNumber = ResolveTeamNumber(TeamValue);
		const vecPlayers = GetNativeConnectedPlayers();

		return (nTeamNumber < 0) ? vecPlayers : vecPlayers.filter((Player) => Player.Team === nTeamNumber);
	},

	GetHumanPlayers() {
		g_Assert.strictEqual(this, g_NativePlayerFilters);

		return GetNativeConnectedPlayers().filter((Player) => !Player.FakeClient);
	},
};

const g_Teams = {
	GetTeamNames() {
		return { ...g_TeamNumbers };
	},

	GetTeamNumber(TeamValue) {
		return ResolveTeamNumber(TeamValue);
	},
};

function ReadNativeFunction(strSource, strSignature) {
	const unMaximumDefinitionLineCount = 160;
	const unMaximumDefinitionCharacterCount = 14000;

	const strClosingPrefix = "\n\t\t}";
	const nStartIndex = strSource.indexOf("\t\t" + strSignature);
	g_Assert(nStartIndex >= 0, `Missing native definition: ${strSignature}`);
	let nCloseIndex = strSource.indexOf(strClosingPrefix, nStartIndex);
	g_Assert(nCloseIndex > nStartIndex);
	let unEndIndex = nCloseIndex + strClosingPrefix.length;
	while (strSource.startsWith(" catch ", unEndIndex)) {
		nCloseIndex = strSource.indexOf(strClosingPrefix, unEndIndex);
		g_Assert(nCloseIndex > unEndIndex);
		unEndIndex = nCloseIndex + strClosingPrefix.length;
	}

	const strBody = strSource.slice(nStartIndex, unEndIndex);
	g_Assert(strBody.split("\n").length <= unMaximumDefinitionLineCount, "Native source checks must remain bounded to the selected definition.");
	g_Assert(strBody.length <= unMaximumDefinitionCharacterCount);

	return strBody;
}

function VerifyNativePlayerFilterDocumentationContracts(strDocumentation) {
	// Source/doc alignment complements the actual V8 Ban validation fixture.
	const strSource = g_FileSystem.readFileSync(g_strModuleBindingsPath, "utf8").replace(/\r\n/g, "\n");
	const strBan = ReadNativeFunction(strSource, "void PlayerBanMethodCallback(");
	const strIntegerArgument = ReadNativeFunction(strSource, "bool GetInt32Argument(");
	g_Assert.match(strBan, /constexpr int kDefaultBanDuration = 0;/);
	g_Assert.match(strBan, /constexpr bool kDefaultKickPlayer = true;/);
	g_Assert.match(strBan, /constexpr bool kDefaultWriteBanList = true;/);
	g_Assert.match(strBan, /constexpr double kMaximumBanDuration = static_cast<double>\(std::numeric_limits<std::int32_t>::max\(\)\);/);
	g_Assert.match(strBan, /if \(!LocalDurationValue->IsNumber\(\)\)/);
	g_Assert.match(strBan, /!std::isfinite\(dblBanDuration\) \|\| \(std::floor\(dblBanDuration\) != dblBanDuration\)/);
	g_Assert.match(strBan, /\(dblBanDuration < 0\) \|\| \(dblBanDuration > kMaximumBanDuration\)/);
	g_Assert.doesNotMatch(strBan, /GetInt32Argument\(|->(?:Int32Value|IntegerValue|NumberValue)\(/);
	const nDurationCommit = strBan.indexOf("nBanDuration = static_cast<int>(dblBanDuration);");
	g_Assert(nDurationCommit >= 0);
	for (const strGuard of ["!LocalDurationValue->IsNumber()", "!std::isfinite(dblBanDuration)", "std::floor(dblBanDuration) != dblBanDuration", "dblBanDuration < 0", "dblBanDuration > kMaximumBanDuration"]) {
		const nGuardPosition = strBan.indexOf(strGuard);
		g_Assert((nGuardPosition >= 0) && (nGuardPosition < nDurationCommit));
	}

	g_Assert(nDurationCommit < strBan.indexOf("ReadEntityIndex("));
	g_Assert.match(strBan, /CallbackInformation\[kKickArgumentIndex\]->IsBoolean\(\)/);
	g_Assert.match(strBan, /CallbackInformation\[kWriteBanArgumentIndex\]->IsBoolean\(\)/);
	g_Assert.match(strIntegerArgument, /LocalValue->Int32Value\(LocalContext\)/);
	g_Assert.doesNotMatch(strIntegerArgument, /IsInt32\(|IsNumber\(|std::isfinite|std::floor/);
	g_Assert(strDocumentation.includes("BanPlayer(nBanDuration?, bKickPlayer?, bWriteBanList?)"));
	g_Assert(strDocumentation.includes("primitive number"));
	g_Assert(strDocumentation.includes("2147483647"));
	g_Assert(!strDocumentation.includes("duration-conversion limitation"));

	const strTeamValue = ReadNativeFunction(strSource, "bool GetTeamNumberFromValue(");
	const strTeamAlias = ReadNativeFunction(strSource, "bool GetTeamNumberFromAlias(");
	const strTeamLookup = ReadNativeFunction(strSource, "std::string MakeTeamLookupName(");
	const strPlayersByTeam = ReadNativeFunction(strSource, "void GetPlayersByTeamCallback(");
	const strPlayersArray = ReadNativeFunction(strSource, "v8::Local<v8::Array> MakePlayersArray(");
	g_Assert.match(strTeamValue, /!LocalValue->IsInt32\(\)/);
	g_Assert.match(strTeamValue, /GetTeamNumberFromAlias\(/);
	g_Assert.match(strTeamAlias, /MakeTeamLookupName\(strAlias\)/);
	g_Assert.match(strTeamAlias, /nTeamIndexOut = kAnyTeamIndex;\s+return true;/);
	g_Assert.match(strTeamLookup, /ToLowerASCII\(strName\)/);
	g_Assert.match(strTeamLookup, /\(chCharacter != '_'\) && \(chCharacter != '-'\) && \(chCharacter != ' '\)/);
	g_Assert.match(strPlayersByTeam, /MakePlayersArray\([^\n]+PlayerFakeClientFilter::ANY\)/);
	g_Assert.match(strPlayersArray, /\(nTeamIndex >= 0\) && \(pPlayerInformation->GetTeamIndex\(\) != nTeamIndex\)/);
}

function VerifyNativeTeamSelectorAlignment(Filters) {
	for (const TeamValue of [
		"CounterTerrorist",
		"counterterrorist",
		"COUNTER_TERRORIST",
		"Counter-Terrorist",
		"Counter Terrorist",
		" Counter Terrorist ",
		3,
	]) {
		g_Assert.doesNotThrow(() => g_Assert.deepEqual(Filters.GetPlayersByTeam(TeamValue).map(Player => Player.Index), [2, 3]));
	}

	for (const TeamValue of [
		null,
		undefined,
		-1,
		"UnknownTeam",
		"",
		"Survivor",
	]) {
		g_Assert.doesNotThrow(() => g_Assert.deepEqual(Filters.GetPlayersByTeam(TeamValue).map(Player => Player.Index), [1, 2, 3]));
	}

	g_Assert.throws(() => new Filters.PlayerIterator("counterterrorist"), ReferenceError);
	g_Assert.throws(() => Filters.ParsePlayerFilterExpression("counterterrorist"), ReferenceError);
}

function CreateDocumentationRequire(Filters, LogInfo = () => undefined) {
	return strModuleName => {
		if (strModuleName === "filters/players") {
			return Filters;
		}

		if (strModuleName === "players/teams") {
			return g_Teams;
		}

		if (strModuleName === "loggers") {
			return { LogInfo };
		}

		throw new Error(`Unexpected documentation module: ${strModuleName}`);
	};
}

function VerifyDocumentationRequireContracts() {
	const Filters = {};
	const vecLogCalls = [];
	const LogInfo = (...vecArguments) => vecLogCalls.push(vecArguments);
	const DocumentationRequire = CreateDocumentationRequire(Filters, LogInfo);
	g_Assert.strictEqual(DocumentationRequire("filters/players"), Filters);
	g_Assert.strictEqual(DocumentationRequire("players/teams"), g_Teams);
	g_Assert.strictEqual(DocumentationRequire("loggers").LogInfo, LogInfo);
	DocumentationRequire("loggers").LogInfo("PlayerFilterProbe Count=%d", 2);
	g_Assert.deepEqual(vecLogCalls, [["PlayerFilterProbe Count=%d", 2]]);
	g_Assert.throws(() => DocumentationRequire("UnknownModule"), /Unexpected documentation module/);
	g_Assert.throws(() => g_ConsoleDouble.log, /typed logger/);
}

function VerifyWoundedFilterCleanup(strExampleSource, Filters) {
	const unExpectedCleanupScenarioCount = 15;
	const IteratorClass = Filters.PlayerIterator;
	const IteratorPrototype = IteratorClass.prototype;
	const OriginalResolve = IteratorPrototype.Resolve;
	const OriginalUnregister = IteratorClass.UnregisterFilter;
	const OriginalResolveDescriptor = Object.getOwnPropertyDescriptor(IteratorPrototype, "Resolve");
	const OriginalUnregisterDescriptor = Object.getOwnPropertyDescriptor(IteratorClass, "UnregisterFilter");
	const vecOriginalFilterNames = IteratorClass.GetFilterNames();
	const RunExample = new Function("require", "console", strExampleSource);
	const DocumentationRequire = CreateDocumentationRequire(Filters);
	const RestoreOverrides = () => {
		for (const Property of [
			{ Owner: IteratorPrototype, Name: "Resolve", Descriptor: OriginalResolveDescriptor },
			{ Owner: IteratorClass, Name: "UnregisterFilter", Descriptor: OriginalUnregisterDescriptor },
		]) {
			if (Property.Descriptor === undefined) {
				delete Property.Owner[Property.Name];
			} else {
				Object.defineProperty(Property.Owner, Property.Name, Property.Descriptor);
			}
		}
	};
	const vecPrimaryCases = [
		{ Throws: false },
		{ Throws: true, Value: new Error("Controlled wounded-player iteration failure.") },
		{ Throws: true, Value: null },
		{ Throws: true, Value: undefined },
		{ Throws: true, Value: 0 },
	];
	let unScenarioCount = 0;
	for (const PrimaryCase of vecPrimaryCases) {
		for (const strMode of ["SUCCESS", "FALSE", "THROWS"]) {
			g_Assert.equal(IteratorClass.HasFilter("Wounded"), false);

			const CleanupFailure = new Error("Controlled Wounded cleanup failure.");
			let CapturedFailure = null;
			let unUnregisterCallCount = 0;
			IteratorPrototype.Resolve = function ResolveControlledPlayers(...vecArguments) {
				const vecPlayers = Reflect.apply(OriginalResolve, this, vecArguments);
				if (PrimaryCase.Throws) {
					throw PrimaryCase.Value;
				}

				return vecPlayers;
			};
			IteratorClass.UnregisterFilter = function UnregisterControlledFilter(...vecArguments) {
				const bResult = Reflect.apply(OriginalUnregister, this, vecArguments);
				++unUnregisterCallCount;

				if (strMode === "THROWS") {
					throw CleanupFailure;
				}

				return (strMode === "FALSE") ? false : bResult;
			};
			try {
				RunExample(DocumentationRequire, g_ConsoleDouble);
			} catch (Failure) {
				CapturedFailure = { Value: Failure };
			} finally {
				RestoreOverrides();

				if (IteratorClass.HasFilter("Wounded")) {
					g_Assert.equal(OriginalUnregister.call(IteratorClass, "Wounded"), true);
				}
			}

			g_Assert.equal(unUnregisterCallCount, 1, "A successful registration must be cleaned up after every iteration outcome.");
			g_Assert.deepEqual(Object.getOwnPropertyDescriptor(IteratorPrototype, "Resolve"), OriginalResolveDescriptor);
			g_Assert.deepEqual(Object.getOwnPropertyDescriptor(IteratorClass, "UnregisterFilter"), OriginalUnregisterDescriptor);

			if (!PrimaryCase.Throws && (strMode === "SUCCESS")) {
				g_Assert.equal(CapturedFailure, null);
			} else {
				g_Assert.notEqual(CapturedFailure, null);
				let ReportedCleanupFailure = CapturedFailure.Value;

				if (PrimaryCase.Throws) {
					if (strMode === "SUCCESS") {
						g_Assert.strictEqual(CapturedFailure.Value, PrimaryCase.Value);
					} else {
						g_Assert(CapturedFailure.Value instanceof AggregateError);
						g_Assert.equal(CapturedFailure.Value.errors.length, 2);
						g_Assert.strictEqual(CapturedFailure.Value.errors[0], PrimaryCase.Value);
						ReportedCleanupFailure = CapturedFailure.Value.errors[1];
					}
				}

				if (strMode === "THROWS") {
					g_Assert.strictEqual(ReportedCleanupFailure, CleanupFailure);
				} else if (strMode === "FALSE") {
					g_Assert(ReportedCleanupFailure instanceof Error);
					g_Assert.match(ReportedCleanupFailure.message, /Wounded filter cleanup failed/);
				}
			}

			++unScenarioCount;
		}
	}

	g_Assert.equal(unScenarioCount, unExpectedCleanupScenarioCount);

	const ExistingFilter = () => true;
	let unForeignCleanupCallCount = 0;
	g_Assert.strictEqual(IteratorClass.RegisterFilter("Wounded", ExistingFilter), ExistingFilter);
	IteratorClass.UnregisterFilter = function CountForeignCleanup(...vecArguments) {
		++unForeignCleanupCallCount;

		return Reflect.apply(OriginalUnregister, this, vecArguments);
	};
	try {
		g_Assert.throws(() => RunExample(DocumentationRequire, g_ConsoleDouble), ReferenceError);
		g_Assert.equal(unForeignCleanupCallCount, 0);
		g_Assert.equal(IteratorClass.HasFilter("Wounded"), true);
		g_Assert.strictEqual(new IteratorClass("Wounded").GetIteratorFilterCallback("Wounded"), ExistingFilter);
	} finally {
		RestoreOverrides();

		if (IteratorClass.HasFilter("Wounded")) {
			g_Assert.equal(OriginalUnregister.call(IteratorClass, "Wounded"), true);
		}
	}

	g_Assert.deepEqual(IteratorClass.GetFilterNames(), vecOriginalFilterNames);
}

try {
	for (const strModulePath of g_vecCachePaths) {
		delete require.cache[strModulePath];
	}

	// Replace the test bridge without invoking a prior accessor; restore its descriptor below.
	Object.defineProperty(globalThis, "sourcejs", {
		configurable: true,
		enumerable: true,
		writable: true,
		value: {
			"filters/players": g_NativePlayerFilters,
			players: g_NativePlayers,
		},
	});
	require.cache[g_strTeamsPath] = { exports: g_Teams, filename: g_strTeamsPath, id: g_strTeamsPath, loaded: true };

	g_Module._load = function Load(strRequestName, ParentModule, bIsMain) {
		if (strRequestName === "internal/runtime") {
			return require(g_strRuntimePath);
		}

		if (strRequestName === "players/teams") {
			return g_Teams;
		}

		if (strRequestName === "filters/iterator") {
			return require(g_strIteratorPath);
		}

		return g_OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
	};

	const g_Filters = require(g_strPackagePath);
	g_Module._load = g_OriginalModuleLoad;

	VerifyDocumentationRequireContracts();
	g_Assert.strictEqual(g_Filters, g_NativePlayerFilters);
	g_Assert.deepEqual(Object.keys(g_Filters).sort(), [
		"GetAllPlayers",
		"GetBotPlayers",
		"GetConnectedPlayers",
		"GetDefaultPlayerFilters",
		"GetHumanPlayers",
		"GetPlayersByTeam",
		"ParsePlayerFilterExpression",
		"PlayerIterator",
	].sort());
	g_Assert.deepEqual(g_Filters.GetAllPlayers().map((Player) => Player.Index), [1, 2, 3]);
	g_Assert.deepEqual(g_Filters.GetHumanPlayers().map((Player) => Player.Index), [1]);
	g_Assert.deepEqual(g_Filters.GetBotPlayers().map((Player) => Player.Index), [2, 3]);
	g_Assert.deepEqual(g_Filters.GetConnectedPlayers().map((Player) => Player.Index), [1, 2, 3]);
	g_Assert.deepEqual(g_Filters.GetPlayersByTeam(3).map((Player) => Player.Index), [2, 3]);
	g_Assert.deepEqual(g_Filters.GetPlayersByTeam("Terrorist").map((Player) => Player.Index), [1]);
	g_Assert.deepEqual(g_Filters.GetPlayersByTeam(null).map((Player) => Player.Index), [1, 2, 3]);
	g_Assert.deepEqual(g_Filters.GetPlayersByTeam(-1).map((Player) => Player.Index), [1, 2, 3]);
	g_Assert.deepEqual(g_Filters.GetPlayersByTeam(g_nMinimumTeamNumber).map((Player) => Player.Index), [1, 2, 3]);
	g_Assert.throws(() => g_Filters.GetPlayersByTeam(g_nMaximumTeamNumber + 1), /signed 32-bit/);
	g_Assert.throws(() => g_Filters.GetPlayersByTeam(g_nMinimumTeamNumber - 1), /signed 32-bit/);
	g_Assert.throws(() => g_Filters.GetPlayersByTeam(1.5), /signed 32-bit/);

	const g_vecPlayerSnapshotFields = [
		"Connected",
		"Dead",
		"FakeClient",
		"Free",
		"Deaths",
		"Frags",
		"Health",
		"MaximumHealth",
		"TeamNumber",
		"UserID",
		"Language",
		"ModelName",
		"Name",
		"NetworkID",
		"RemoteAddress",
		"WeaponName",
		"Index",
		"Origin",
	];
	const g_vecPlayerSnapshotMethods = [
		"BanPlayer",
		"ChangePlayerTeam",
		"ExecuteClientCommand",
		"GivePlayerNamedItem",
		"KickPlayer",
		"SayPlayerMessage",
		"SayPlayerTeamMessage",
		"SetPlayerName",
		"SlayPlayer",
	];
	const g_FirstPlayer = g_Filters.GetAllPlayers()[0];
	for (const strFieldName of g_vecPlayerSnapshotFields) {
		g_Assert.equal(Object.hasOwn(g_FirstPlayer, strFieldName), true, `compact Player must expose ${strFieldName}`);
	}

	for (const strMethodName of g_vecPlayerSnapshotMethods) {
		g_Assert.equal(typeof g_FirstPlayer[strMethodName], "function", `compact Player must expose ${strMethodName}()`);
		g_FirstPlayer[strMethodName]("receiver-check");
	}

	g_Assert.equal(g_FirstPlayer.Name, "Ren");
	g_Assert.equal(g_FirstPlayer.ModelName, "models/player/ren.mdl");
	g_Assert.equal(g_FirstPlayer.WeaponName, "weapon_smg");
	g_Assert.equal(g_FirstPlayer.TeamNumber, 2);
	g_Assert.equal(g_FirstPlayer.Deaths, 1);
	g_Assert.equal(g_FirstPlayer.Frags, 4);
	g_Assert.deepEqual(g_FirstPlayer.Origin, { X: 10, Y: 20, Z: 64 });
	g_Assert.deepEqual(Object.keys(g_FirstPlayer).sort(), [...g_vecPlayerSnapshotFields, ...g_vecPlayerSnapshotMethods].sort());
	g_Assert.equal(g_vecPlayerMethodCalls.length, g_vecPlayerSnapshotMethods.length);
	g_Assert.equal(g_vecPlayerMethodCalls.every((Call) => (Call.Index === 1) && (Call.Arguments[0] === "receiver-check")), true);

	const g_MutableSnapshot = g_Filters.GetAllPlayers()[0];
	const g_CapturedNativePlayer = g_vecLastNativeScanPlayers[0];
	g_Assert.notStrictEqual(g_MutableSnapshot.Origin, g_CapturedNativePlayer.Origin);

	g_MutableSnapshot.Index = 2;
	g_MutableSnapshot.Name = "SnapshotOnly";
	g_MutableSnapshot.Origin.X = -1;
	g_Assert.equal(g_CapturedNativePlayer.Index, 1);
	g_Assert.equal(g_CapturedNativePlayer.Name, "Ren");
	g_Assert.equal(g_CapturedNativePlayer.Origin.X, 10);
	g_Assert.equal(g_MutableSnapshot.SetPlayerName("NativeReceiverCheck"), true);
	g_Assert.equal(g_vecPlayerMethodCalls[g_vecPlayerMethodCalls.length - 1].Index, 1, "snapshot field writes must not retarget bound methods");

	g_bHasGiveNamedItem = false;
	try {
		g_Assert.equal(g_Filters.GetAllPlayers()[0].GivePlayerNamedItem, undefined, "native records without GiveNamedItem must produce an undefined snapshot action");
	} finally {
		g_bHasGiveNamedItem = true;
	}

	g_Assert.deepEqual(new g_Filters.PlayerIterator("Bot").ToArray().map((Player) => Player.Index), [2, 3]);
	g_Assert.deepEqual(new g_Filters.PlayerIterator(["Connected", "Alive", "Human"]).ToArray().map((Player) => Player.Index), [1]);
	g_Assert.deepEqual(new g_Filters.PlayerIterator(new Set(["Connected", "Alive", "Human"])).ToArray().map((Player) => Player.Index), [1]);
	g_Assert.deepEqual(new g_Filters.PlayerIterator(null, "Dead").ToArray().map((Player) => Player.Index), [1, 2]);
	g_Assert.deepEqual(new g_Filters.PlayerIterator(null, new Set(["Dead"])).ToArray().map((Player) => Player.Index), [1, 2]);
	g_Assert.throws(() => new g_Filters.PlayerIterator("Missing"), /filter does not exist/);
	g_Assert.throws(() => new g_Filters.PlayerIterator("bot"), /filter does not exist/, "legacy lowercase built-ins must not be aliases");

	const g_unDefaultScanStart = g_unNativeAllPlayerScanCount;
	const g_DefaultPlayerFilters = g_Filters.GetDefaultPlayerFilters();
	g_Assert.equal(g_unNativeAllPlayerScanCount - g_unDefaultScanStart, g_Filters.PlayerIterator.GetFilterNames().length);
	g_Assert.equal(Object.getPrototypeOf(g_DefaultPlayerFilters), null);
	g_Assert.deepEqual(Object.keys(g_DefaultPlayerFilters).sort(), [
		"Alive",
		"All",
		"Bot",
		"Connected",
		"CounterTerrorist",
		"Dead",
		"Human",
		"Terrorist",
	]);
	g_Assert.deepEqual(Array.from(g_DefaultPlayerFilters.CounterTerrorist, (Player) => Player.Index), [2, 3]);
	g_Assert.deepEqual(Array.from(g_DefaultPlayerFilters.Dead, (Player) => Player.Index), [3]);
	g_Assert.equal(Object.hasOwn(g_DefaultPlayerFilters, "Survivor"), false);
	g_Assert.equal(Object.hasOwn(g_DefaultPlayerFilters, "Infected"), false);

	g_Assert.deepEqual(Array.from(g_Filters.ParsePlayerFilterExpression("(Human + Bot) - Dead"), (Player) => Player.Index), [1, 2]);
	g_Assert.deepEqual(Array.from(g_Filters.ParsePlayerFilterExpression(" Human + 22 "), (Player) => Player.Index), [1, 2]);
	g_Assert.deepEqual(Array.from(g_Filters.ParsePlayerFilterExpression("All - Bot + 22"), (Player) => Player.Index), [1, 2]);
	g_Assert.deepEqual(Array.from(g_Filters.ParsePlayerFilterExpression("Wounded + TeamThree", {
		TeamThree: g_Filters.GetPlayersByTeam(3),
		Wounded: g_Filters.GetAllPlayers().filter((Player) => !Player.Dead && (Player.Health < Player.MaximumHealth)),
	}), (Player) => Player.Index), [1, 2, 3]);

	const g_NullPrototypeFilters = Object.create(null);
	g_NullPrototypeFilters.Humans = g_Filters.GetHumanPlayers();
	g_Assert.deepEqual(Array.from(g_Filters.ParsePlayerFilterExpression("Humans", g_NullPrototypeFilters), (Player) => Player.Index), [1]);
	g_Assert.throws(() => g_Filters.ParsePlayerFilterExpression(1), /must be a string/);
	g_Assert.throws(() => g_Filters.ParsePlayerFilterExpression("   "), /must not be empty/);
	g_Assert.throws(() => g_Filters.ParsePlayerFilterExpression("Human +"), /Unexpected end/);
	g_Assert.throws(() => g_Filters.ParsePlayerFilterExpression("UnknownFilter"), /Unknown player filter/);
	g_Assert.throws(() => g_Filters.ParsePlayerFilterExpression("999"), /Unable to find player/);
	g_Assert.throws(() => g_Filters.ParsePlayerFilterExpression("999999999999999999999999"), /outside the supported range/);
	g_Assert.throws(() => g_Filters.ParsePlayerFilterExpression("Human", []), /must be an object/);
	g_Assert.throws(() => g_Filters.ParsePlayerFilterExpression("Human", new Map()), /plain or null-prototype/);
	g_Assert.throws(() => g_Filters.ParsePlayerFilterExpression("bad-name", { "bad-name": [] }), /Invalid player filter name/);
	g_Assert.throws(() => g_Filters.ParsePlayerFilterExpression("Human", { Human: 1 }), /must be an iterable collection/);
	g_Assert.throws(() => g_Filters.ParsePlayerFilterExpression("Legacy", { Legacy: [{ m_unIndex: 1 }] }), /Index property/, "legacy m_* fields must not normalize to public Index");

	g_Assert.deepEqual([...g_Filters.ParsePlayerFilterExpression("Left", g_CustomFilters)], [g_LastCustomPlayer, g_SecondCustomPlayer]);
	g_Assert.deepEqual([...g_Filters.ParsePlayerFilterExpression("Left + Right", g_CustomFilters)], [g_RightCustomPlayer, g_SecondCustomPlayer]);
	g_Assert.deepEqual([...g_Filters.ParsePlayerFilterExpression("Left - Right", g_CustomFilters)], [g_SecondCustomPlayer]);

	const g_UserIDCollision = { Index: 99, UserID: 11 };
	const g_unExpectedNumericScanCount = 2;
	const g_unNumericScanStart = g_unNativeAllPlayerScanCount;
	const g_setNumericMatches = g_Filters.ParsePlayerFilterExpression("00011 + 22", { Unused: [g_UserIDCollision] });
	g_Assert.deepEqual([...g_setNumericMatches].map((Player) => Player.Index), [1, 2]);
	g_Assert.equal(g_setNumericMatches.has(g_UserIDCollision), false, "numeric terms must search native players, not the provided collections");
	g_Assert.equal(g_unNativeAllPlayerScanCount - g_unNumericScanStart, g_unExpectedNumericScanCount);
	g_Assert.throws(() => g_Filters.ParsePlayerFilterExpression("2147483648", {}), /outside the supported range/);
	g_Assert.throws(() => g_Filters.ParsePlayerFilterExpression("2147483647", {}), /Unable to find player/);

	const g_EagerFilters = { Used: [g_FirstCustomPlayer], Unused: { [Symbol.iterator]: GenerateUnusedCustomPlayers } };
	Object.defineProperty(g_EagerFilters, "Hidden", { value: null });
	g_EagerFilters[Symbol("Hidden")] = null;
	g_Assert.deepEqual([...g_Filters.ParsePlayerFilterExpression("Used", g_EagerFilters)], [g_FirstCustomPlayer]);
	g_Assert.equal(g_unUnusedCollectionIterationCount, 1, "all enumerable entries must be consumed, even if unreferenced");
	g_Assert.throws(() => g_Filters.ParsePlayerFilterExpression("Used +", g_EagerFilters), SyntaxError);
	g_Assert.equal(g_unUnusedCollectionIterationCount, 2, "collection resolution precedes complete grammar validation");
	g_Assert.throws(() => g_Filters.ParsePlayerFilterExpression("#", g_EagerFilters), SyntaxError);
	g_Assert.equal(g_unUnusedCollectionIterationCount, 2, "tokenization must precede collection resolution");
	g_Assert.throws(() => g_Filters.ParsePlayerFilterExpression("Unknown", { Used: [g_FirstCustomPlayer], Unused: null }), /iterable collection/);

	const g_IterableFailure = new Error("Unused collection failed.");
	const g_ThrowingFilters = {
		Used: [g_FirstCustomPlayer],
		Unused: {
			[Symbol.iterator]() {
				throw g_IterableFailure;
			},
		},
	};
	g_Assert.throws(() => g_Filters.ParsePlayerFilterExpression("Used", g_ThrowingFilters), (CaughtError) => CaughtError === g_IterableFailure);

	const g_SourceOverriddenIterator = new g_Filters.PlayerIterator("Human");
	const g_unOverrideScanStart = g_unNativeAllPlayerScanCount;
	g_SourceOverriddenIterator.IteratorItems = [{ Index: 99, FakeClient: true }];
	g_Assert.deepEqual(g_SourceOverriddenIterator.ToArray().map((Player) => Player.Index), [99]);
	g_Assert.equal(g_unNativeAllPlayerScanCount, g_unOverrideScanStart, "replacing IteratorItems must bypass native and named-filter scanning");

	for (const strReservedFilterName of ["+", "-", ")"]) {
		g_Filters.PlayerIterator.RegisterFilter(strReservedFilterName, () => true);
		try {
			g_Assert.throws(() => g_Filters.ParsePlayerFilterExpression(strReservedFilterName), SyntaxError, "registered operator names must not become expression primaries");
			g_Assert.throws(() => g_Filters.ParsePlayerFilterExpression(`Human + ${strReservedFilterName}`), SyntaxError);
		} finally {
			g_Assert.equal(g_Filters.PlayerIterator.UnregisterFilter(strReservedFilterName), true);
		}
	}

	const g_unExpectedDocumentationBlockCount = 11;
	const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
	const g_vecDocumentationBlocks = ExtractJavaScriptBlocks(g_strDocumentation);
	let g_unExecutedDocumentationBlockCount = 0;
	g_Assert.equal(g_vecDocumentationBlocks.length, g_unExpectedDocumentationBlockCount, "filters/players documentation must contain eleven executable JavaScript blocks");
	VerifyNativePlayerFilterDocumentationContracts(g_strDocumentation);
	VerifyNativeTeamSelectorAlignment(g_Filters);
	const g_unWoundedFilterBlockIndex = 5;
	VerifyWoundedFilterCleanup(g_vecDocumentationBlocks[g_unWoundedFilterBlockIndex], g_Filters);

	const g_unDocumentationMethodCallStart = g_vecPlayerMethodCalls.length;
	for (const strBlock of g_vecDocumentationBlocks) {
		const RunBlock = new Function("require", "console", strBlock);
		RunBlock(CreateDocumentationRequire(g_Filters), g_ConsoleDouble);
		++g_unExecutedDocumentationBlockCount;
	}

	g_Assert.equal(g_unExecutedDocumentationBlockCount, g_vecDocumentationBlocks.length, "Every player-filter documentation block must execute.");

	for (const strExportName of [
		"PlayerIterator",
		"GetAllPlayers",
		"GetBotPlayers",
		"GetConnectedPlayers",
		"GetDefaultPlayerFilters",
		"GetHumanPlayers",
		"GetPlayersByTeam",
		"ParsePlayerFilterExpression",
	]) {
		g_Assert.match(g_strDocumentation, new RegExp(`\\b${strExportName}\\b`), `documentation must cover ${strExportName}`);
	}

	for (const strMemberName of [
		"Index",
		"Name",
		"UserID",
		"NetworkID",
		"RemoteAddress",
		"TeamNumber",
		"Frags",
		"Deaths",
		"Health",
		"MaximumHealth",
		"Connected",
		"FakeClient",
		"Dead",
		"Free",
		"Language",
		"Origin",
		"WeaponName",
		"ModelName",
		"SlayPlayer",
		"ExecuteClientCommand",
		"SetPlayerName",
		"SayPlayerMessage",
		"SayPlayerTeamMessage",
		"KickPlayer",
		"BanPlayer",
		"ChangePlayerTeam",
		"GivePlayerNamedItem",
		"RequiredFilterNames",
		"ExcludedFilterNames",
		"IteratorItems",
		"IteratorPredicate",
		"Filters",
		"Iterator",
		"GetIteratorFilterCallback",
		"IsValid",
		"Resolve",
		"Values",
		"ToArray",
		"Count",
		"First",
		"Filter",
		"Map",
		"ForEach",
		"RegisterFilter",
		"UnregisterFilter",
		"HasFilter",
		"GetFilterNames",
		"DefaultFilters",
	]) {
		g_Assert.match(g_strDocumentation, new RegExp(`\\b${strMemberName}\\b`), `documentation must cover ${strMemberName}`);
	}

	g_Assert.equal(g_strDocumentation.includes("new PlayerIterator(RequiredFilters = null, ExcludedFilters = null)"), true, "documentation must use the inherited iterable filter-argument names");

	for (const strForbiddenTerm of [
		"Generated by",
		"generate_api_docs",
		"console.log(instance)",
		"console.log(result)",
		"parseFilter(1)",
		"byTeam(team, includeBots",
	]) {
		g_Assert.equal(g_strDocumentation.includes(strForbiddenTerm), false, `documentation must not contain ${strForbiddenTerm}`);
	}

	g_Assert.doesNotMatch(g_strDocumentation, /\bconsole\./, "Executable player-filter documentation must use typed logging.");

	g_Assert.equal(g_Filters.PlayerIterator.HasFilter("Wounded"), false, "documentation filter must be unregistered");
	g_Assert.equal(g_vecPlayerMethodCalls.slice(g_unDocumentationMethodCallStart).some((Call) => Call.Operation === "ExecuteClientCommand"), true, "documentation must execute a compact Player method");

	console.log("[  OK  ] filters/players contracts and documentation passed with native player doubles; SDK execution not exercised");
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
