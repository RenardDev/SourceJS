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
const g_strTeamsPath = g_Path.join(g_strPackageRootPath, "players", "teams.js");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "players-teams.md");
const g_strModuleBindingsPath = g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "modules", "ModuleBindings.cpp");
const g_strTeamProfilesPath = g_Path.join(g_strRepositoryRootPath, "packaging", "runtime", "addons", "sourcejs", "data", "sourcejs", "teams");
const g_strPVKIIProfilePath = g_Path.join(g_strTeamProfilesPath, "pvkii.ini");
const g_nMinimumInt32 = -2147483648;
const g_nMaximumInt32 = 2147483647;
const g_unSource1BranchCount = 24;
const g_unDocumentationBlockCount = 6;
const g_unDocumentationTimeoutMilliseconds = 1000;
const g_DocumentationBlocks = { Profile: 0, Data: 1, Mappings: 2, Classes: 3, Rosters: 4, Change: 5 };

const g_vecExpectedTeamProfiles = [
	"berimbau",
	"blade",
	"bms",
	"contagion",
	"csgo",
	"cstrike",
	"darkm",
	"dod",
	"doi",
	"episode1",
	"eye",
	"gmod",
	"hl2mp",
	"insurgency",
	"left4dead",
	"left4dead2",
	"mcv",
	"nucleardawn",
	"orangebox",
	"portal2",
	"pvkii",
	"sdk2013",
	"swarm",
	"tf",
];

const g_vecSource1Branches = [
	"bgt",
	"blade",
	"bms",
	"contagion",
	"csgo",
	"css",
	"darkm",
	"dods",
	"doi",
	"episode1",
	"eye",
	"gmod",
	"hl2dm",
	"insurgency",
	"l4d",
	"l4d2",
	"mcv",
	"nucleardawn",
	"orangebox",
	"portal2",
	"pvkii",
	"sdk2013",
	"swarm",
	"tf2",
];

const g_vecExpectedExports = [
	"ChangePlayerTeam",
	"DataProfile",
	"GetPlayersByTeam",
	"GetTeamClassesByName",
	"GetTeamClassesByNumber",
	"GetTeamData",
	"GetTeamManagers",
	"GetTeamName",
	"GetTeamNames",
	"GetTeamNumber",
	"GetTeamNumbers",
	"GetTeamProfile",
	"GetTeamSupportedBranches",
	"SDKBranch",
];

const g_ClassNames = {
	Demoman: 4,
	Engineer: 9,
	Heavy: 6,
	Medic: 5,
	Pyro: 7,
	Scout: 1,
	Sniper: 2,
	Soldier: 3,
	Spy: 8,
};

const g_TeamNames = {
	Blue: 3,
	Red: 2,
	Spectator: 1,
	Unassigned: 0,
};

const g_vecNativeCalls = [];

const g_vecPlayers = [
	{
		Connected: true,
		FakeClient: false,
		Index: 1,
		Team: 2,

		IsConnected() {
			return this.Connected;
		},

		GetTeam() {
			return this.Team;
		},
	},
	{
		Connected: true,
		FakeClient: true,
		Index: 2,
		Team: 2,

		IsConnected() {
			return this.Connected;
		},

		GetTeam() {
			return this.Team;
		},
	},
	{
		Connected: true,
		FakeClient: false,
		Index: 3,
		Team: 3,

		IsConnected() {
			return this.Connected;
		},

		GetTeam() {
			return this.Team;
		},
	},
];

let g_CreateDocumentationPlayer = function CreateDocumentationPlayer(nPlayerIndex) {
	const Player = g_vecPlayers.find((Candidate) => Candidate.Index === nPlayerIndex);
	if (!Player) {
		throw new RangeError(`Unknown documented player index: ${nPlayerIndex}`);
	}

	return Player;
};

function VerifyCanonicalTeamProfile(strProfileName, vecExpectedAliases) {
	const strProfileText = g_FileSystem.readFileSync(g_Path.join(g_strTeamProfilesPath, `${strProfileName}.ini`), "utf8");
	g_Assert.ok(!strProfileText.includes("\r\n") || !strProfileText.replace(/\r\n/g, "").includes("\n"), `${strProfileName} team profile line endings must be consistent`);
	g_Assert.match(strProfileText, /^\[names]\r?$/m, `${strProfileName} must retain the names section`);

	const vecAliases = [...strProfileText.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*(-?\d+)[ \t]*\r?$/gm)].map((vecMatch) => [vecMatch[1], Number(vecMatch[2])]);
	g_Assert.deepEqual(vecAliases, vecExpectedAliases, `${strProfileName} must retain every configured alias and signed index`);

	for (const vecAlias of vecAliases) {
		g_Assert.match(vecAlias[0], /^[A-Z][A-Za-z0-9]*$/, `${strProfileName} packaged team/class aliases must already use PascalCase`);
	}
}

function NormalizeTeamName(strValue) {
	return strValue.toLowerCase().replace(/[_\- ]/g, "");
}

function IsInt32(Value) {
	return Number.isInteger(Value) && (Value >= g_nMinimumInt32) && (Value <= g_nMaximumInt32);
}

function ResolveTeamNumber(Team) {
	if ((Team === null) || (Team === undefined)) {
		return -1;
	}

	if (IsInt32(Team)) {
		return Team;
	}

	if (typeof Team !== "string") {
		throw new TypeError("Team must be an Int32 or configured team name.");
	}

	const strLookup = NormalizeTeamName(Team);
	for (const [strName, nNumber] of Object.entries(g_TeamNames)) {
		if (NormalizeTeamName(strName) === strLookup) {
			return nNumber;
		}
	}

	return -1;
}

function CreateNameMapByNumber(Values) {
	return Object.fromEntries(Object.entries(Values).map(([strName, nNumber]) => [nNumber, strName]));
}

const g_NativeImplementations = {
	GetPlayersByTeam(Team = null) {
		const nTeamNumber = ResolveTeamNumber(Team);

		return g_vecPlayers.filter((Player) => Player.Connected && ((nTeamNumber < 0) || (Player.Team === nTeamNumber)));
	},

	ChangePlayerTeam(PlayerValue, Team) {
		const nPlayerIndex = (typeof PlayerValue === "number") ? PlayerValue : PlayerValue?.Index;
		const nTeamNumber = ResolveTeamNumber(Team);
		const Target = g_vecPlayers.find((Candidate) => Candidate.Index === nPlayerIndex);
		if (!Target || (nTeamNumber < 0)) {
			throw new RangeError("Change requires a live player and configured team.");
		}

		Target.Team = nTeamNumber;

		return true;
	},

	GetTeamClassesByName() {
		return { ...g_ClassNames };
	},

	GetTeamClassesByNumber() {
		return CreateNameMapByNumber(g_ClassNames);
	},

	GetTeamData() {
		return { ClassesByName: { ...g_ClassNames }, ClassesByNumber: CreateNameMapByNumber(g_ClassNames), Managers: ["tf_team"], Names: { ...g_TeamNames }, Numbers: CreateNameMapByNumber(g_TeamNames) };
	},

	DataProfile: "tf",

	GetTeamManagers() {
		return ["tf_team"];
	},

	GetTeamName(nTeamIndex) {
		if (!IsInt32(nTeamIndex)) {
			throw new TypeError("nTeamIndex must be an Int32.");
		}

		return CreateNameMapByNumber(g_TeamNames)[nTeamIndex] ?? "";
	},

	GetTeamNames() {
		return { ...g_TeamNames };
	},

	GetTeamNumber(Team) {
		return ResolveTeamNumber(Team);
	},

	GetTeamNumbers() {
		return CreateNameMapByNumber(g_TeamNames);
	},

	GetTeamProfile() {
		return "tf";
	},

	SDKBranch: "tf2",

	GetTeamSupportedBranches() {
		return g_vecSource1Branches.slice();
	},
};

const g_NativeTeams = {};
for (const [strName, Value] of Object.entries(g_NativeImplementations)) {
	if (typeof Value !== "function") {
		g_NativeTeams[strName] = Value;
		continue;
	}

	g_NativeTeams[strName] = function InvokeTeamFunction(...vecArguments) {
		g_vecNativeCalls.push([strName, ...vecArguments]);

		return g_NativeImplementations[strName](...vecArguments);
	};
}

const g_OriginalDocumentationPlayerFactory = g_CreateDocumentationPlayer;
const g_vecFixtureStates = [
	g_NativeImplementations,
	g_NativeTeams,
	g_TeamNames,
	g_ClassNames,
	...g_vecPlayers,
].map((Fixture) => ({ Fixture, Descriptors: Object.getOwnPropertyDescriptors(Fixture), Prototype: Object.getPrototypeOf(Fixture) }));

// A VM deadline skips inner finally blocks; restore only these freshly owned fixtures outside it.
function RestoreTeamFixtures() {
	g_CreateDocumentationPlayer = g_OriginalDocumentationPlayerFactory;

	const vecFailures = [];
	for (const FixtureState of g_vecFixtureStates) {
		for (const PropertyKey of Reflect.ownKeys(FixtureState.Fixture)) {
			try {
				g_Assert.ok(Reflect.deleteProperty(FixtureState.Fixture, PropertyKey), "Temporary team fixture property must be removable: " + String(PropertyKey));
			} catch (Failure) {
				vecFailures.push(Failure);
			}
		}

		for (const PropertyKey of Reflect.ownKeys(FixtureState.Descriptors)) {
			try {
				Object.defineProperty(FixtureState.Fixture, PropertyKey, FixtureState.Descriptors[PropertyKey]);
			} catch (Failure) {
				vecFailures.push(Failure);
			}
		}

		try {
			Object.setPrototypeOf(FixtureState.Fixture, FixtureState.Prototype);
		} catch (Failure) {
			vecFailures.push(Failure);
		}
	}

	if (vecFailures.length > 0) {
		throw new AggregateError(vecFailures, "Owned team fixture restoration failed.");
	}
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
		throw new AggregateError(vecFailures, "Player teams package cache restoration failed.");
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

	Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: true, writable: true, value: { "players/teams": g_NativeTeams } });

	for (const strPath of g_mapPackageCacheDescriptors.keys()) {
		g_Assert.ok(Reflect.deleteProperty(require.cache, strPath), "Existing package cache must be removable: " + strPath);
	}

	Object.defineProperty(g_Module, "_load", {
		...g_ModuleLoadDescriptor,

		value: function LoadModule(strRequestName) {
			if (strRequestName === "internal/runtime") {
				return require(g_strRuntimePath);
			}

			return g_ModuleLoadDescriptor.value.apply(this, arguments);
		},
	});

	const g_Teams = require(g_strTeamsPath);
	RestoreModuleLoader();

	g_Assert.ok(g_Teams === g_NativeTeams, "players/teams must expose the exact native object.");
	g_Assert.deepEqual(Object.keys(g_Teams).sort(), g_vecExpectedExports.slice().sort(), "players/teams exact exports");
	g_Assert.equal(g_Teams.SDKBranch, "tf2", "selected SDK branch");
	g_Assert.equal(g_Teams.DataProfile, "tf", "selected data profile");
	g_Assert.equal(g_Teams.GetTeamNumber("red"), 2, "GetTeamNumber direct result");
	g_Assert.equal(g_Teams.GetTeamNumber("R E D"), 2, "GetTeamNumber normalized alias");
	g_Assert.equal(g_Teams.GetTeamName(3), "Blue", "GetTeamName direct result");
	g_Assert.equal(g_Teams.GetTeamClassesByNumber()[1], "Scout", "class profile data");
	g_Assert.equal(g_Teams.GetTeamData().Names.Red, 2, "complete current data result");
	g_Assert.equal(g_Teams.GetTeamData().Names.Unassigned, 0, "complete unassigned team name");
	g_Assert.equal(g_Teams.GetTeamData().Names.Spectator, 1, "complete spectator team name");
	g_Assert.equal(Object.hasOwn(g_Teams.GetTeamData().Names, "un"), false, "unassigned team name must be complete");
	g_Assert.equal(Object.hasOwn(g_Teams.GetTeamData().Names, "spec"), false, "spectator team name must be complete");
	g_Assert.deepEqual(g_Teams.GetPlayersByTeam("red").map((Player) => Player.Index), [1, 2], "GetPlayersByTeam must include humans and bots.");
	g_Assert.ok(g_Teams.ChangePlayerTeam(g_vecPlayers[0], "red"), "ChangePlayerTeam must call native code directly.");
	g_Assert.ok(g_vecNativeCalls.some((vecCall) => (vecCall[0] === "ChangePlayerTeam") && (vecCall[2] === "red")), "ChangePlayerTeam call arguments");
	g_Assert.equal(g_Teams.GetTeamSupportedBranches().length, g_unSource1BranchCount, "teams must expose exactly 24 Source 1 branches.");

	for (const strBranch of ["cs2", "deadlock", "dota"]) {
		g_Assert.ok(!g_Teams.GetTeamSupportedBranches().includes(strBranch), `teams must exclude Source 2 branch ${strBranch}.`);
	}

	for (const strRemovedName of [
		"BLUE",
		"INFECTED",
		"RED",
		"SURVIVOR",
		"clearCache",
		"default",
		"moduleName",
	]) {
		g_Assert.ok(!Object.hasOwn(g_Teams, strRemovedName), `players/teams must not expose ${strRemovedName}.`);
	}

	g_vecNativeCalls.length = 0;

	const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
	const g_vecCodeBlocks = [...g_strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);

	function RequireDocumentationModule(strModuleName) {
		if (strModuleName === "players/entity") {
			return {
				Player(nPlayerIndex) {
					return g_CreateDocumentationPlayer(nPlayerIndex);
				},
			};
		}

		if (strModuleName === "players/teams") {
			return g_Teams;
		}

		throw new Error(`unexpected players/teams documentation module ${strModuleName}`);
	}

	g_Assert.equal(g_vecCodeBlocks.length, g_unDocumentationBlockCount, "players/teams documentation workflow count");
	g_Assert.ok(!g_strDocumentation.includes("Generated by"), "players/teams documentation must be maintained by hand.");
	g_Assert.ok(g_strDocumentation.includes("has no boolean bot-inclusion argument"), "players/teams documentation must reject the fabricated byTeam option.");
	g_Assert.ok(g_strDocumentation.includes("does not export game-specific constants"), "players/teams documentation must stay branch-neutral.");
	g_Assert.ok(!g_strDocumentation.includes("console."), "players/teams documentation must not depend on console-only inspection.");

	function CheckTeamDocumentationExamples() {
		const vecDocumentationModules = [];
		for (let unDocumentationCodeBlockIndex = 0; unDocumentationCodeBlockIndex < g_vecCodeBlocks.length; ++unDocumentationCodeBlockIndex) {
			const ModuleRecord = { exports: {} };
			CompileDocumentationBlock(g_vecCodeBlocks[unDocumentationCodeBlockIndex], unDocumentationCodeBlockIndex)(RequireDocumentationModule, ModuleRecord, ModuleRecord.exports);
			vecDocumentationModules.push(ModuleRecord.exports);
		}

		g_Assert.equal(g_vecNativeCalls.length, 0, "players/teams examples must not query native state during block load");
		g_Assert.deepEqual(vecDocumentationModules[g_DocumentationBlocks.Profile].InspectTeamProfile(), { DataProfile: "tf", ProfileFromDisk: "tf", SDKBranch: "tf2" }, "documented selected profile inspection");

		const DocumentedTeamData = vecDocumentationModules[g_DocumentationBlocks.Data].InspectTeamData();
		g_Assert.deepEqual(DocumentedTeamData.Names, g_TeamNames, "documented team-name data");
		g_Assert.deepEqual(DocumentedTeamData.ClassesByName, g_ClassNames, "documented player-class data");
		g_Assert.equal(vecDocumentationModules[g_DocumentationBlocks.Mappings].InspectTeamMappings().length, Object.keys(g_TeamNames).length, "documented reversible team mappings");
		g_Assert.deepEqual(vecDocumentationModules[g_DocumentationBlocks.Classes].InspectTeamClasses().ManagerClasses, ["tf_team"], "documented team manager classes");

		const DocumentedRosters = vecDocumentationModules[g_DocumentationBlocks.Rosters].InspectTeamRosters();
		g_Assert.deepEqual(DocumentedRosters.Rosters.Red, [1, 2], "documented red roster includes human and bot");
		g_Assert.deepEqual(DocumentedRosters.Rosters.Blue, [3], "documented blue roster");
		g_Assert.deepEqual(DocumentedRosters.AllConnected, [1, 2, 3], "documented complete connected roster");

		const DocumentedChange = vecDocumentationModules[g_DocumentationBlocks.Change].MovePlayerToTeam(1, "blue");
		g_Assert.deepEqual(DocumentedChange, { Changed: true, Index: 1, PreviousTeam: 2, TargetTeam: 3 }, "documented explicit team change");
		g_Assert.equal(g_vecPlayers[0].Team, 3, "documented team change reaches native player state");
		g_Assert.ok(g_Teams.ChangePlayerTeam(g_vecPlayers[0], "red"), "restore documented player team");
		g_Assert.equal(g_vecPlayers[0].Team, 2, "documented player team returns to baseline");

		for (const strExportName of g_vecExpectedExports) {
			if (typeof g_Teams[strExportName] === "function") {
				g_Assert.ok(g_strDocumentation.includes(`${strExportName}(`), `players/teams documentation must use ${strExportName}().`);
				g_Assert.ok(g_vecNativeCalls.some((vecCall) => vecCall[0] === strExportName), `players/teams examples must execute ${strExportName}().`);

			} else {
				g_Assert.ok(g_strDocumentation.includes(strExportName), `players/teams documentation must use ${strExportName}.`);
			}
		}

		g_Assert.deepEqual(g_Teams.GetPlayersByTeam("red").map((Player) => Player.Index), [1, 2], "documented team roster must continue to include the bot.");
		g_Assert.equal(g_vecPlayers[0].Team, 2, "documented team workflow must restore the player's team.");

		return vecDocumentationModules;
	}

	const g_vecDocumentationModules = RunDocumentationTask(CheckTeamDocumentationExamples, "examples");

	const g_strDocumentationWithoutCode = g_strDocumentation.replace(/```[\s\S]*?```/g, "");
	const g_vecLinks = [...g_strDocumentationWithoutCode.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((vecMatch) => vecMatch[1]);
	for (const strTarget of g_vecLinks) {
		if (strTarget.startsWith("#") || /^[a-z]+:/i.test(strTarget)) {
			continue;
		}

		const strTargetPath = g_Path.resolve(g_Path.dirname(g_strDocumentationPath), strTarget.split("#", 1)[0]);
		g_Assert.ok(g_FileSystem.existsSync(strTargetPath), `players/teams documentation link must exist: ${strTarget}`);
	}

	function ExtractNativeTeamHelperSource(strBindings, strSignature) {
		const strNormalizedBindings = strBindings.replace(/\r\n/g, "\n");
		const nStartIndex = strNormalizedBindings.indexOf(strSignature);
		g_Assert.ok(nStartIndex >= 0, `native team helper must exist: ${strSignature}`);

		const strClosingLine = "\n\t\t}\n";
		const nEndIndex = strNormalizedBindings.indexOf(strClosingLine, nStartIndex);
		g_Assert.ok(nEndIndex > nStartIndex, `native team helper must be complete: ${strSignature}`);

		return strNormalizedBindings.slice(nStartIndex, nEndIndex + strClosingLine.length);
	}

	function VerifyNativeTeamInputContracts(strBindings) {
		const strNameHelper = ExtractNativeTeamHelperSource(strBindings, "\t\tstd::string MakeTeamPascalName(std::string const& strName) {");
		g_Assert.match(strNameHelper, /if \(\(chCharacter == '_'\) \|\| \(chCharacter == '-'\) \|\| \(chCharacter == ' '\)\) \{\s+bUpperNext = true;/, "a leading team-name separator must retain PascalCase capitalization");

		const strIntegerHelper = ExtractNativeTeamHelperSource(strBindings, "\t\tbool ParseTeamInteger(std::string const& strValue, int& nValueOut) {");
		g_Assert.match(strIntegerHelper, /std::strtol\(pszValue, &pszParseEnd, kDecimalRadix\);\s+const int nParseError = errno;/, "team integer parsing captures errno immediately");
		g_Assert.ok(strIntegerHelper.includes("pszParseEnd != (pszValue + strValue.size())"), "team integer parsing rejects bytes after an embedded NUL");

		const strFileHelper = ExtractNativeTeamHelperSource(strBindings, "\t\tbool ReadTeamTextFile(std::filesystem::path const& PathFile, std::string& strTextOut) {");
		g_Assert.match(strFileHelper, /InputFile\.read\(arrReadBuffer, kReadBufferByteCount\);\s+const std::streamsize nReadByteCount = InputFile\.gcount\(\);/, "team file copying uses the actual number of bytes read");
		g_Assert.match(strFileHelper, /if \(!FileContentsStream\.write\(arrReadBuffer, nReadByteCount\)\) \{\s+return false;/, "team file copying checks output failure");
		g_Assert.match(strFileHelper, /if \(InputFile\.bad\(\) \|\| !InputFile\.eof\(\)\) \{\s+return false;/, "team file reading distinguishes EOF from an input failure");
		g_Assert.ok(strFileHelper.indexOf("InputFile.bad()") < strFileHelper.indexOf("strTextOut = FileContentsStream.str();"), "team text is committed only after successful reading");
	}

	function VerifyNativeTeamInputMutations(strBindings) {
		const strNormalizedBindings = strBindings.replace(/\r\n/g, "\n");
		const vecSignatures = [
			"\t\tstd::string MakeTeamPascalName(std::string const& strName) {",
			"\t\tbool ParseTeamInteger(std::string const& strValue, int& nValueOut) {",
			"\t\tbool ReadTeamTextFile(std::filesystem::path const& PathFile, std::string& strTextOut) {",
		];
		const strHelperSources = vecSignatures.map((strSignature) => ExtractNativeTeamHelperSource(strNormalizedBindings, strSignature)).join("\n");

		const vecMutations = [
			{ From: "\t\t\t\t\tbUpperNext = true;", To: "\t\t\t\t\tbUpperNext = !strPascalName.empty();" },
			{ From: "const int nParseError = errno;", To: "const int nParseError = 0;" },
			{ From: "pszParseEnd != (pszValue + strValue.size())", To: "*pszParseEnd != '\\0'" },
			{ From: "if (!FileContentsStream.write(arrReadBuffer, nReadByteCount))", To: "if (false)" },
			{ From: "if (InputFile.bad() || !InputFile.eof())", To: "if (false)" },
		];
		for (const Mutation of vecMutations) {
			g_Assert.equal(strHelperSources.split(Mutation.From).length, 2, `unique native team mutation target: ${Mutation.From}`);
			const strMutatedSources = strHelperSources.replace(Mutation.From, Mutation.To);
			g_Assert.throws(() => VerifyNativeTeamInputContracts(strMutatedSources), g_Assert.AssertionError);
		}
	}

	const g_strModuleBindings = g_FileSystem.readFileSync(g_strModuleBindingsPath, "utf8");
	VerifyNativeTeamInputContracts(g_strModuleBindings);
	VerifyNativeTeamInputMutations(g_strModuleBindings);

	g_Assert.ok(g_strModuleBindings.includes("std::string GetTeamProfileName()"), "native SDK-to-profile selection");
	g_Assert.ok(g_strModuleBindings.includes("LoadPlayerTeamDataFromRuntime"), "native current profile loading");
	g_Assert.ok(g_strModuleBindings.includes("MakeTeamLookupName"), "native normalized team aliases");
	g_Assert.ok(g_strModuleBindings.includes("MakePlayersArray(pIsolate, LocalContext, nTeamIndex, PlayerFakeClientFilter::ANY)"), "native byTeam human-and-bot roster");
	g_Assert.ok(g_strModuleBindings.includes("pPlayerInformation->ChangeTeam(nTeamIndex);"), "native team change");
	g_Assert.ok(g_strModuleBindings.includes("v8::Local<v8::Object> const LocalPlayerTeamsModule = MakeModule(pIsolate);"), "native players/teams module installation");
	g_Assert.ok(!g_strModuleBindings.includes('SetFunction(pIsolate, LocalContext, LocalPlayerTeamsModule, "includeBots"'), "players/teams must not expose a fabricated includeBots API.");

	const g_vecTeamProfileNames = g_FileSystem.readdirSync(g_strTeamProfilesPath, { withFileTypes: true }).filter((DirectoryEntry) => DirectoryEntry.isFile() && DirectoryEntry.name.endsWith(".ini")).map((DirectoryEntry) => g_Path.basename(DirectoryEntry.name, ".ini")).sort();
	g_Assert.deepEqual(g_vecTeamProfileNames, g_vecExpectedTeamProfiles, "team data must contain exactly the 24 Source 1 profiles");

	for (const strProfileName of g_vecTeamProfileNames) {
		const strProfile = g_FileSystem.readFileSync(g_Path.join(g_strTeamProfilesPath, `${strProfileName}.ini`), "utf8");
		g_Assert.doesNotMatch(strProfile, /^(un|spec) =/m, `${strProfileName} must use complete neutral team names`);
	}

	VerifyCanonicalTeamProfile("berimbau", [
		["Unassigned", 0],
		["Spectator", 1],
		["Players", 2],
	]);

	VerifyCanonicalTeamProfile("blade", [
		["Unassigned", 0],
		["Spectator", 1],
		["T", 2],
		["CT", 3],
	]);

	VerifyCanonicalTeamProfile("bms", [
		["Unassigned", 0],
		["Spectator", 1],
		["Grunt", 2],
		["Scientist", 3],
	]);

	VerifyCanonicalTeamProfile("contagion", [
		["Unassigned", 0],
		["Spectator", 1],
		["T", 2],
		["CT", 3],
	]);

	VerifyCanonicalTeamProfile("csgo", [
		["Unassigned", 0],
		["Spectator", 1],
		["T", 2],
		["CT", 3],
	]);

	VerifyCanonicalTeamProfile("cstrike", [
		["Unassigned", 0],
		["Spectator", 1],
		["T", 2],
		["CT", 3],
		["PhoenixConnexion", 1],
		["EliteCrew", 2],
		["ArcticAvengers", 3],
		["GuerillaWarfare", 4],
		["SEALTeam6", 5],
		["GSG9", 6],
		["SAS", 7],
		["GIGN", 8],
	]);

	VerifyCanonicalTeamProfile("darkm", [
		["Unassigned", 0],
		["Spectator", 1],
		["T", 2],
		["CT", 3],
	]);

	VerifyCanonicalTeamProfile("dod", [
		["Unassigned", 0],
		["Spectator", 1],
		["Allies", 2],
		["Axis", 3],
	]);

	VerifyCanonicalTeamProfile("doi", [
		["Unassigned", 0],
		["Spectator", 1],
		["T", 2],
		["CT", 3],
	]);

	VerifyCanonicalTeamProfile("episode1", [
		["Unassigned", 0],
		["Spectator", 1],
		["T", 2],
		["CT", 3],
	]);

	VerifyCanonicalTeamProfile("eye", [
		["Unassigned", 0],
		["Spectator", 1],
		["T", 2],
		["CT", 3],
	]);

	VerifyCanonicalTeamProfile("gmod", [
		["Unassigned", 0],
		["Spectator", 1],
		["T", 2],
		["CT", 3],
	]);

	VerifyCanonicalTeamProfile("hl2mp", [
		["Unassigned", 0],
		["Spectator", 1],
		["Combine", 2],
		["Rebels", 3],
	]);

	VerifyCanonicalTeamProfile("insurgency", [
		["Unassigned", 0],
		["Spectator", 1],
		["T", 2],
		["CT", 3],
	]);

	VerifyCanonicalTeamProfile("left4dead", [
		["Unassigned", 0],
		["Spectator", 1],
		["Survivor", 2],
		["Infected", 3],
	]);

	VerifyCanonicalTeamProfile("left4dead2", [
		["Unassigned", 0],
		["Spectator", 1],
		["Survivor", 2],
		["Infected", 3],
		["L4D1Survivor", 4],
	]);

	VerifyCanonicalTeamProfile("mcv", [
		["Unassigned", 0],
		["Spectator", 1],
		["T", 2],
		["CT", 3],
	]);

	VerifyCanonicalTeamProfile("nucleardawn", [
		["Unassigned", 0],
		["Spectator", 1],
		["T", 2],
		["CT", 3],
	]);

	VerifyCanonicalTeamProfile("orangebox", [
		["Unassigned", 0],
		["Spectator", 1],
		["T", 2],
		["CT", 3],
	]);

	VerifyCanonicalTeamProfile("portal2", [
		["Unassigned", 0],
		["Spectator", 1],
		["T", 2],
		["CT", 3],
	]);

	VerifyCanonicalTeamProfile("pvkii", [
		["Unassigned", 0],
		["Spectator", 1],
		["Pirates", 2],
		["Vikings", 3],
		["Knights", 4],
	]);

	VerifyCanonicalTeamProfile("sdk2013", [
		["Unassigned", 0],
		["Spectator", 1],
		["T", 2],
		["CT", 3],
	]);

	VerifyCanonicalTeamProfile("swarm", [
		["Unassigned", 0],
		["Spectator", 1],
		["T", 2],
		["CT", 3],
	]);

	VerifyCanonicalTeamProfile("tf", [
		["Unassigned", 0],
		["Spectator", 1],
		["Red", 2],
		["Blue", 3],
		["Scout", 1],
		["Sniper", 2],
		["Soldier", 3],
		["Demoman", 4],
		["Medic", 5],
		["Heavy", 6],
		["Pyro", 7],
		["Spy", 8],
		["Engineer", 9],
	]);

	const g_strPVKIIProfile = g_FileSystem.readFileSync(g_strPVKIIProfilePath, "utf8");
	g_Assert.match(g_strPVKIIProfile, /^Unassigned = 0$/m, "PVKII unassigned team index");
	g_Assert.match(g_strPVKIIProfile, /^Spectator = 1$/m, "PVKII spectator team index");
	g_Assert.match(g_strPVKIIProfile, /^Pirates = 2$/m, "PVKII Pirates team index");
	g_Assert.match(g_strPVKIIProfile, /^Vikings = 3$/m, "PVKII Vikings team index");
	g_Assert.match(g_strPVKIIProfile, /^Knights = 4$/m, "PVKII Knights team index");
	g_Assert.doesNotMatch(g_strPVKIIProfile, /^(un|spec|t|ct) =/mi, "PVKII profile must not retain generic team aliases");

	function VerifyTeamDocumentationCase(strScenarioName, Callback) {
		g_Assert.doesNotThrow(Callback, strScenarioName);
		++g_unDocumentationScenarioCount;
	}

	function WithTeamImplementation(strName, Implementation, Callback) {
		const Original = g_NativeImplementations[strName];
		g_NativeImplementations[strName] = Implementation;

		try {
			Callback();
		} finally {
			g_NativeImplementations[strName] = Original;
		}
	}

	function WithDocumentationPlayer(PlayerValue, Callback) {
		const Original = g_CreateDocumentationPlayer;
		g_CreateDocumentationPlayer = function CreateReplacementPlayer() {
			return PlayerValue;
		};

		try {
			Callback();
		} finally {
			g_CreateDocumentationPlayer = Original;
		}
	}

	function CheckTeamDocumentationScenarios() {
		const MovePlayerToTeam = g_vecDocumentationModules[g_DocumentationBlocks.Change].MovePlayerToTeam;

		const vecInvalidPlayerIndices = [
			undefined,
			null,
			false,
			true,
			"",
			"1",
			1n,
			{},
			[],
			NaN,
			Infinity,
			-Infinity,
			-1,
			0,
			1.5,
			2147483648,
			4294967297,
		];
		for (const PlayerIndex of vecInvalidPlayerIndices) {
			VerifyTeamDocumentationCase(`reject player index ${String(PlayerIndex)} before native queries`, () => {
				g_vecNativeCalls.length = 0;
				g_Assert.throws(() => MovePlayerToTeam(PlayerIndex, "Blue"), TypeError);
				g_Assert.equal(g_vecNativeCalls.length, 0);
			});
		}

		for (const TeamName of [
			undefined,
			null,
			false,
			2,
			2n,
			{},
			[],
			"",
		]) {
			VerifyTeamDocumentationCase(`reject configured name ${String(TeamName)} before native queries`, () => {
				g_vecNativeCalls.length = 0;
				g_Assert.throws(() => MovePlayerToTeam(1, TeamName), TypeError);
				g_Assert.equal(g_vecNativeCalls.length, 0);
			});
		}

		for (const TeamValue of [
			undefined,
			null,
			false,
			"3",
			3n,
			{},
			NaN,
			Infinity,
			-1,
			-2,
			-2147483648,
			1.5,
			2147483648,
		]) {
			VerifyTeamDocumentationCase(`reject invalid resolved team ${String(TeamValue)} before player lookup`, () => {
				WithTeamImplementation("GetTeamNumber", () => TeamValue, () => {
					let unPlayerReads = 0;
					const Original = g_CreateDocumentationPlayer;
					g_CreateDocumentationPlayer = function CountPlayerRead() {
						++unPlayerReads;

						return g_vecPlayers[0];
					};

					try {
						g_Assert.throws(() => MovePlayerToTeam(1, "Blue"), RangeError);
						g_Assert.equal(unPlayerReads, 0);
					} finally {
						g_CreateDocumentationPlayer = Original;
					}
				});
			});
		}

		for (const PlayerValue of [
			null,
			undefined,
			false,
			1,
			"player",
			[],
			() => null,
		]) {
			VerifyTeamDocumentationCase("reject invalid player record", () => {
				WithDocumentationPlayer(PlayerValue, () => {
					g_vecNativeCalls.length = 0;
					g_Assert.throws(() => MovePlayerToTeam(1, "Blue"), TypeError);
					g_Assert.equal(g_vecNativeCalls.some((vecCall) => vecCall[0] === "ChangePlayerTeam"), false);
				});
			});
		}

		for (const PlayerIndex of [undefined, "1", 1n, 2]) {
			VerifyTeamDocumentationCase("reject mismatched player Index", () => {
				WithDocumentationPlayer({ Index: PlayerIndex }, () => {
					g_Assert.throws(() => MovePlayerToTeam(1, "Blue"), /different index/);
				});
			});
		}

		for (const Status of [
			undefined,
			null,
			1,
			"true",
			{},
		]) {
			VerifyTeamDocumentationCase("reject non-boolean connection status before previous-team lookup", () => {
				WithDocumentationPlayer({
					Index: 1,

					IsConnected() {
						return Status;
					},

					GetTeam() {
						g_Assert.fail("invalid connection status must stop before GetTeam()");
					},
				}, () => {
					g_Assert.throws(() => MovePlayerToTeam(1, "Blue"), TypeError);
				});
			});
		}

		VerifyTeamDocumentationCase("disconnected player stops before previous-team lookup", () => {
			WithDocumentationPlayer({
				Index: 1,

				IsConnected() {
					return false;
				},

				GetTeam() {
					g_Assert.fail("disconnected player must stop before GetTeam()");
				},
			}, () => g_Assert.throws(() => MovePlayerToTeam(1, "Blue"), /not connected/));
		});

		for (const PreviousTeam of [
			undefined,
			null,
			false,
			"2",
			2n,
			NaN,
			Infinity,
			1.5,
			-2147483649,
			2147483648,
		]) {
			VerifyTeamDocumentationCase("reject invalid previous-team result before mutation", () => {
				WithDocumentationPlayer({
					Index: 1,

					IsConnected() {
						return true;
					},

					GetTeam() {
						return PreviousTeam;
					},
				}, () => {
					g_vecNativeCalls.length = 0;
					g_Assert.throws(() => MovePlayerToTeam(1, "Blue"), TypeError);
					g_Assert.equal(g_vecNativeCalls.some((vecCall) => vecCall[0] === "ChangePlayerTeam"), false);
				});
			});
		}

		for (const ChangeResult of [
			undefined,
			null,
			false,
			0,
			1,
			"true",
			{},
		]) {
			VerifyTeamDocumentationCase("require exact true result from native change", () => {
				WithTeamImplementation("ChangePlayerTeam", () => ChangeResult, () => {
					g_Assert.throws(() => MovePlayerToTeam(1, "Blue"), /Failed to request/);
				});
			});
		}

		for (const Failure of [new Error("original team failure"), null]) {
			for (const strOperation of ["GetTeamNumber", "ChangePlayerTeam"]) {
				VerifyTeamDocumentationCase(`preserve ${strOperation} thrown value`, () => {
					WithTeamImplementation(strOperation, () => {
						throw Failure;
					}, () => {
						g_Assert.throws(() => MovePlayerToTeam(1, "Blue"), (ErrorValue) => ErrorValue === Failure);
					});
				});
			}

			for (const strMember of ["Index", "IsConnected", "GetTeam"]) {
				VerifyTeamDocumentationCase(`preserve ${strMember} getter thrown value`, () => {
					const PlayerValue = {
						Index: 1,

						IsConnected() {
							return true;
						},

						GetTeam() {
							return 2;
						},
					};
					Object.defineProperty(PlayerValue, strMember, {
						get() {
							throw Failure;
						},
					});
					WithDocumentationPlayer(PlayerValue, () => {
						g_Assert.throws(() => MovePlayerToTeam(1, "Blue"), (ErrorValue) => ErrorValue === Failure);
					});
				});
			}
		}

		VerifyTeamDocumentationCase("read player Index/methods once and preserve method receiver", () => {
			const Counts = { Index: 0, IsConnected: 0, GetTeam: 0 };
			const PlayerValue = {};
			Object.defineProperties(PlayerValue, {
				Index: {
					get() {
						++Counts.Index;

						return 1;
					},
				},

				IsConnected: {
					get() {
						++Counts.IsConnected;

						return function ReadConnected() {
							g_Assert.equal(this, PlayerValue);

							return true;
						};
					},
				},

				GetTeam: {
					get() {
						++Counts.GetTeam;

						return function ReadTeam() {
							g_Assert.equal(this, PlayerValue);

							return 2;
						};
					},
				},
			});
			WithDocumentationPlayer(PlayerValue, () => {
				WithTeamImplementation("ChangePlayerTeam", (nPlayerIndex, nTeamNumber) => {
					g_Assert.equal(nPlayerIndex, 1);
					g_Assert.equal(nTeamNumber, 3);

					return true;
				}, () => {
					g_Assert.deepEqual(MovePlayerToTeam(1, "Blue"), { Changed: true, Index: 1, PreviousTeam: 2, TargetTeam: 3 });
					g_Assert.deepEqual(Counts, { Index: 1, IsConnected: 1, GetTeam: 1 });
				});
			});
		});

		VerifyTeamDocumentationCase("numeric target avoids repeated name resolution and does not claim SDK acceptance", () => {
			g_vecNativeCalls.length = 0;
			WithTeamImplementation("ChangePlayerTeam", () => true, () => {
				const Report = MovePlayerToTeam(1, "Blue");
				g_Assert.equal(Report.Changed, true);
				g_Assert.equal(g_vecPlayers[0].Team, 2);
				g_Assert.equal(g_vecNativeCalls.filter((vecCall) => vecCall[0] === "GetTeamNumber").length, 1);
				g_Assert.deepEqual(g_vecNativeCalls.find((vecCall) => vecCall[0] === "ChangePlayerTeam"), ["ChangePlayerTeam", 1, 3]);
			});
		});

		for (const Team of [
			undefined,
			null,
			-1,
			-2,
			-2147483648,
			"UnknownTeam",
		]) {
			VerifyTeamDocumentationCase("every negative/unknown selector includes connected humans and bots", () => {
				g_Assert.deepEqual(g_Teams.GetPlayersByTeam(Team).map((Player) => Player.Index), [1, 2, 3]);
			});
		}

		for (const Team of [
			false,
			true,
			1n,
			new Number(2),
			new String("Red"),
			{},
			[],
			NaN,
			Infinity,
			1.5,
			2147483648,
			-2147483649,
		]) {
			VerifyTeamDocumentationCase("reject non-Int32 numeric/native team selectors", () => {
				g_Assert.throws(() => g_Teams.GetTeamNumber(Team), TypeError);
				g_Assert.throws(() => g_Teams.GetPlayersByTeam(Team), TypeError);
			});
		}

		VerifyTeamDocumentationCase("numeric strings are names and out-of-profile numbers are not coerced", () => {
			g_Assert.equal(g_Teams.GetTeamNumber("2"), -1);
			g_Assert.equal(g_Teams.GetTeamNumber(2147483647), 2147483647);
			g_Assert.equal(g_Teams.GetTeamName(-2147483648), "");
			g_Assert.equal(g_Teams.GetTeamName(2147483647), "");
			g_Assert.deepEqual(g_Teams.GetPlayersByTeam(2147483647), []);
		});

		VerifyTeamDocumentationCase("disconnected players are absent from the roster and the example refuses a change", () => {
			g_vecPlayers[2].Connected = false;

			try {
				g_Assert.deepEqual(g_Teams.GetPlayersByTeam().map((Player) => Player.Index), [1, 2]);
				g_vecNativeCalls.length = 0;
				g_Assert.throws(() => MovePlayerToTeam(3, "Blue"), /not connected/);
				g_Assert.equal(g_vecNativeCalls.some((vecCall) => vecCall[0] === "ChangePlayerTeam"), false);
			} finally {
				g_vecPlayers[2].Connected = true;
			}
		});

		VerifyTeamDocumentationCase("native roster reads Team without a legacy TeamNumber fallback", () => {
			let unLegacyTeamReads = 0;
			WithTeamImplementation("GetPlayersByTeam", (Team) => [{
				Index: 1,
				Team: ResolveTeamNumber(Team),

				get TeamNumber() {
					++unLegacyTeamReads;
					throw new Error("The roster must not read the legacy TeamNumber field.");
				},
			}], () => {
				const Report = g_vecDocumentationModules[g_DocumentationBlocks.Rosters].InspectTeamRosters();
				g_Assert.deepEqual(Report.Rosters.Blue, [1]);
				g_Assert.deepEqual(Report.Rosters.Red, [1]);
				g_Assert.equal(unLegacyTeamReads, 0);
			});
		});

		VerifyTeamDocumentationCase("native roster rejects a wrong Team even if legacy TeamNumber matches", () => {
			WithTeamImplementation("GetPlayersByTeam", (Team) => {
				const nTeamNumber = ResolveTeamNumber(Team);

				return [{ Index: 1, Team: nTeamNumber + 1, TeamNumber: nTeamNumber }];
			}, () => {
				g_Assert.throws(() => g_vecDocumentationModules[g_DocumentationBlocks.Rosters].InspectTeamRosters(), /returned a player outside/);
			});
		});

		VerifyTeamDocumentationCase("negative configured team is rejected before broadening a roster query", () => {
			const OriginalNames = { ...g_TeamNames };
			g_TeamNames.Invalid = -2;

			try {
				g_vecNativeCalls.length = 0;
				g_Assert.throws(() => g_vecDocumentationModules[g_DocumentationBlocks.Rosters].InspectTeamRosters(), /Invalid team mapping/);
				g_Assert.equal(g_vecNativeCalls.some((vecCall) => (vecCall[0] === "GetPlayersByTeam") && (vecCall[1] === "Invalid")), false);
			} finally {
				delete g_TeamNames.Invalid;
				g_Assert.deepEqual(g_TeamNames, OriginalNames);
			}
		});

		VerifyTeamDocumentationCase("team data returns independent own PascalCase fields", () => {
			const First = g_Teams.GetTeamData();
			const Second = g_Teams.GetTeamData();
			for (const strField of [
				"Names",
				"Numbers",
				"ClassesByName",
				"ClassesByNumber",
				"Managers",
			]) {
				g_Assert.notEqual(First[strField], Second[strField]);
				const Descriptor = Object.getOwnPropertyDescriptor(First, strField);
				g_Assert.equal(Descriptor.writable && Descriptor.enumerable && Descriptor.configurable, true);
			}

			First.Names.Red = 99;
			g_Assert.equal(Second.Names.Red, 2);
			g_Assert.equal(g_Teams.GetTeamName(2), "Red");
		});

		for (const strMethodName of ["IsConnected", "GetTeam"]) {
			for (const MethodValue of [undefined, null, 1]) {
				VerifyTeamDocumentationCase(`reject non-callable ${strMethodName}`, () => {
					const PlayerValue = {
						Index: 1,

						IsConnected() {
							return true;
						},

						GetTeam() {
							return 2;
						},
					};
					PlayerValue[strMethodName] = MethodValue;
					WithDocumentationPlayer(PlayerValue, () => {
						g_Assert.throws(() => MovePlayerToTeam(1, "Blue"), (ErrorValue) => (ErrorValue instanceof TypeError) && ErrorValue.message.includes("requires IsConnected() and GetTeam()."));
					});
				});
			}
		}

		VerifyTeamDocumentationCase("requesting the previous team reports no requested difference", () => {
			g_Assert.deepEqual(MovePlayerToTeam(1, "Red"), { Changed: false, Index: 1, PreviousTeam: 2, TargetTeam: 2 });
		});
	}

	RunDocumentationTask(CheckTeamDocumentationScenarios, "scenarios");
} catch (ErrorValue) {
	g_PrimaryFailure = ErrorValue;
	g_bFailed = true;
} finally {
	const vecCleanupFailures = [];
	for (const Restore of [RestoreTeamFixtures, RestorePackageCache, RestoreModuleLoader, RestoreSourceJS]) {
		try {
			Restore();
		} catch (ErrorValue) {
			vecCleanupFailures.push(ErrorValue);
		}
	}

	if (vecCleanupFailures.length > 0) {
		if (g_bFailed) {
			throw new AggregateError([g_PrimaryFailure, ...vecCleanupFailures], "Player teams review and restoration failed.");
		}

		throw new AggregateError(vecCleanupFailures, "Player teams restoration failed.");
	}
}

if (g_bFailed) {
	throw g_PrimaryFailure;
}

console.log(`[  OK  ] smoke_players_teams documentation cases=${g_unDocumentationScenarioCount}`);
