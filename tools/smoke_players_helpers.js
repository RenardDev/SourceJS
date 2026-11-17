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
const g_strHelpersPath = g_Path.join(g_strPackageRootPath, "players", "helpers.js");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "players-helpers.md");
const g_strModuleBindingsPath = g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "modules", "ModuleBindings.cpp");
const g_unBaseEntityAddress = 0x100000000003001n;
const g_unEdictAddress = 0x100000000002001n;
const g_unHandle = 0x80000801;
const g_strNetworkID = "STEAM_1:1:1234";
const g_nPlayerIndex = 1;
const g_nUserID = 11;
const g_unExpectedExportCount = 37;
const g_unDocumentationBlockCount = 8;
const g_unDocumentationTimeoutMilliseconds = 1000;
const g_DocumentationBlocks = { NameSearch: 0, Searches: 1, Information: 2, Edict: 3, BaseEntity: 4, Handles: 5, Address: 6, Client: 7 };

const g_vecExpectedExports = [
	"GetBaseEntityFromPlayerInformation",
	"GetBaseEntityFromUserID",
	"GetBaseHandleFromPlayerInformation",
	"GetBaseHandleFromUserID",
	"GetEdictFromPlayerInformation",
	"GetEdictFromUserID",
	"GetClientCVarValue",
	"GetClientLanguage",
	"GetIndexFromName",
	"GetIndexFromNetworkID",
	"GetIndexFromPlayerInformation",
	"GetIndexFromUserID",
	"GetPlayerIndex",
	"GetIntegerHandleFromPlayerInformation",
	"GetIntegerHandleFromUserID",
	"IsConnected",
	"GetName",
	"GetNetworkAddress",
	"GetNetworkIDFromIndex",
	"GetNetworkID",
	"GetPlayerInformationFromBaseEntity",
	"GetPlayerInformationFromBaseHandle",
	"GetPlayerInformationFromEdict",
	"GetPlayerInformationFromIndex",
	"GetPlayerInformationFromIntegerHandle",
	"GetPlayerInformationFromAddress",
	"GetPlayerInformationFromUserID",
	"GetAddressFromPlayerInformation",
	"GetAddressFromUserID",
	"GetUserIDFromBaseEntity",
	"GetUserIDFromBaseHandle",
	"GetUserIDFromEdict",
	"GetUserIDFromIndex",
	"GetUserIDFromIntegerHandle",
	"GetUserIDFromPlayerInformation",
	"GetUserIDFromAddress",
	"GetUserID",
];

const g_vecNativeCalls = [];
const g_Player = {
	Index: g_nPlayerIndex,
	Connected: true,
	FakeClient: false,
	Name: "Ren",
	UserID: g_nUserID,
};

function GetPlayerIndexFromValue(Value) {
	return (typeof Value === "number") ? Value : Value.Index;
}

function MakeBaseEntity() {
	return { ClassName: "player", Index: g_nPlayerIndex, Kind: "baseentity", Address: g_unBaseEntityAddress };
}

function MakeBaseHandle() {
	return { EntryIndex: g_nPlayerIndex, Kind: "basehandle", SerialNumber: 0x100001, Valid: true, Value: g_unHandle };
}

function MakeEdict() {
	return { ClassName: "player", Index: g_nPlayerIndex, Kind: "edict", Address: g_unEdictAddress };
}

const g_NativeImplementations = {
	GetBaseEntityFromPlayerInformation(PlayerReference) {
		g_Assert.equal(GetPlayerIndexFromValue(PlayerReference), g_nPlayerIndex, "GetBaseEntityFromPlayerInformation fixture index");

		return MakeBaseEntity();
	},

	GetBaseEntityFromUserID(nInputUserID) {
		g_Assert.equal(nInputUserID, g_nUserID, "GetBaseEntityFromUserID fixture user ID");

		return MakeBaseEntity();
	},

	GetBaseHandleFromPlayerInformation(PlayerReference) {
		g_Assert.equal(GetPlayerIndexFromValue(PlayerReference), g_nPlayerIndex, "GetBaseHandleFromPlayerInformation fixture index");

		return MakeBaseHandle();
	},

	GetBaseHandleFromUserID(nInputUserID) {
		g_Assert.equal(nInputUserID, g_nUserID, "GetBaseHandleFromUserID fixture user ID");

		return MakeBaseHandle();
	},

	GetEdictFromPlayerInformation(PlayerReference) {
		g_Assert.equal(GetPlayerIndexFromValue(PlayerReference), g_nPlayerIndex, "GetEdictFromPlayerInformation fixture index");

		return MakeEdict();
	},

	GetEdictFromUserID(nInputUserID) {
		g_Assert.equal(nInputUserID, g_nUserID, "GetEdictFromUserID fixture user ID");

		return MakeEdict();
	},

	GetClientCVarValue(PlayerReference, strConVarName) {
		g_Assert.equal(GetPlayerIndexFromValue(PlayerReference), g_nPlayerIndex, "GetClientCVarValue fixture index");

		return (strConVarName === "rate") ? "30000" : "russian";
	},

	GetClientLanguage(PlayerReference) {
		g_Assert.equal(GetPlayerIndexFromValue(PlayerReference), g_nPlayerIndex, "GetClientLanguage fixture index");

		return "russian";
	},

	GetIndexFromName(strName) {
		return (strName.toLowerCase() === "ren") ? g_nPlayerIndex : -1;
	},

	GetIndexFromNetworkID(strInputNetworkID) {
		return (strInputNetworkID === g_strNetworkID) ? g_nPlayerIndex : -1;
	},

	GetIndexFromPlayerInformation(PlayerReference) {
		return GetPlayerIndexFromValue(PlayerReference);
	},

	GetIndexFromUserID(nInputUserID) {
		return (nInputUserID === g_nUserID) ? g_nPlayerIndex : -1;
	},

	GetPlayerIndex(PlayerReference) {
		return (PlayerReference === undefined) ? -1 : GetPlayerIndexFromValue(PlayerReference);
	},

	GetIntegerHandleFromPlayerInformation(PlayerReference) {
		g_Assert.equal(GetPlayerIndexFromValue(PlayerReference), g_nPlayerIndex, "GetIntegerHandleFromPlayerInformation fixture index");

		return g_unHandle;
	},

	GetIntegerHandleFromUserID(nUserID) {
		return (nUserID === g_nUserID) ? g_unHandle : -1;
	},

	IsConnected(PlayerReference) {
		return GetPlayerIndexFromValue(PlayerReference) === g_nPlayerIndex;
	},

	GetName(PlayerReference) {
		return (GetPlayerIndexFromValue(PlayerReference) === g_nPlayerIndex) ? "Ren" : "";
	},

	GetNetworkAddress(PlayerReference) {
		g_Assert.equal(GetPlayerIndexFromValue(PlayerReference), g_nPlayerIndex, "GetNetworkAddress fixture index");

		return "127.0.0.1:27015";
	},

	GetNetworkIDFromIndex(nPlayerIndex) {
		return (nPlayerIndex === g_nPlayerIndex) ? g_strNetworkID : "";
	},

	GetNetworkID(PlayerReference) {
		return (GetPlayerIndexFromValue(PlayerReference) === g_nPlayerIndex) ? g_strNetworkID : "";
	},

	GetPlayerInformationFromBaseEntity(BaseEntity) {
		return (BaseEntity.Address === g_unBaseEntityAddress) ? g_Player : null;
	},

	GetPlayerInformationFromBaseHandle(BaseHandle) {
		return (BaseHandle.EntryIndex === g_nPlayerIndex) ? g_Player : null;
	},

	GetPlayerInformationFromEdict(Edict) {
		return (Edict.Address === g_unEdictAddress) ? g_Player : null;
	},

	GetPlayerInformationFromIndex(nPlayerIndex) {
		return (nPlayerIndex === g_nPlayerIndex) ? g_Player : null;
	},

	GetPlayerInformationFromIntegerHandle(unHandle) {
		return (unHandle === g_unHandle) ? g_Player : null;
	},

	GetPlayerInformationFromAddress(unAddress) {
		return (unAddress === g_unBaseEntityAddress) ? g_Player : null;
	},

	GetPlayerInformationFromUserID(nInputUserID) {
		return (nInputUserID === g_nUserID) ? g_Player : null;
	},

	GetAddressFromPlayerInformation(PlayerReference) {
		return (GetPlayerIndexFromValue(PlayerReference) === g_nPlayerIndex) ? g_unBaseEntityAddress : 0n;
	},

	GetAddressFromUserID(nInputUserID) {
		return (nInputUserID === g_nUserID) ? g_unBaseEntityAddress : 0n;
	},

	GetUserIDFromBaseEntity(BaseEntity) {
		return (BaseEntity.Address === g_unBaseEntityAddress) ? g_nUserID : -1;
	},

	GetUserIDFromBaseHandle(BaseHandle) {
		return (BaseHandle.EntryIndex === g_nPlayerIndex) ? g_nUserID : -1;
	},

	GetUserIDFromEdict(Edict) {
		return (Edict.Address === g_unEdictAddress) ? g_nUserID : -1;
	},

	GetUserIDFromIndex(nPlayerIndex) {
		return (nPlayerIndex === g_nPlayerIndex) ? g_nUserID : -1;
	},

	GetUserIDFromIntegerHandle(unHandle) {
		return (unHandle === g_unHandle) ? g_nUserID : -1;
	},

	GetUserIDFromPlayerInformation(PlayerReference) {
		return (GetPlayerIndexFromValue(PlayerReference) === g_nPlayerIndex) ? g_nUserID : -1;
	},

	GetUserIDFromAddress(unAddress) {
		return (unAddress === g_unBaseEntityAddress) ? g_nUserID : -1;
	},

	GetUserID(PlayerReference) {
		return (GetPlayerIndexFromValue(PlayerReference) === g_nPlayerIndex) ? g_nUserID : -1;
	},
};

const g_NativeHelpers = {};
for (const [strName, Callback] of Object.entries(g_NativeImplementations)) {
	g_NativeHelpers[strName] = function InvokeNativeHelper(...vecArguments) {
		g_vecNativeCalls.push([strName, ...vecArguments]);

		return Callback(...vecArguments);
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
		throw new AggregateError(vecFailures, "Player helpers package cache restoration failed.");
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

	Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: true, writable: true, value: { "players/helpers": g_NativeHelpers } });

	for (const strPath of g_mapPackageCacheDescriptors.keys()) {
		g_Assert.ok(Reflect.deleteProperty(require.cache, strPath), "Existing package cache must be removable: " + strPath);
	}

	Object.defineProperty(g_Module, "_load", {
		...g_ModuleLoadDescriptor,

		value: function Load(strRequestName, ParentModule, bIsMain) {
			if (strRequestName === "internal/runtime") {
				return require(g_strRuntimePath);
			}

			return g_ModuleLoadDescriptor.value.call(this, strRequestName, ParentModule, bIsMain);
		},
	});

	const g_Helpers = require(g_strHelpersPath);
	RestoreModuleLoader();

	g_Assert.ok(g_Helpers === g_NativeHelpers, "players/helpers must expose the exact native object.");
	g_Assert.equal(g_vecExpectedExports.length, g_unExpectedExportCount, "players/helpers export inventory size");
	g_Assert.deepEqual(Object.keys(g_Helpers).sort(), g_vecExpectedExports.slice().sort(), "players/helpers exact exports");
	g_Assert.equal(g_Helpers.GetIndexFromUserID(g_nUserID), g_nPlayerIndex, "GetIndexFromUserID direct result");
	g_Assert.equal(g_Helpers.GetIndexFromName("Ren"), g_nPlayerIndex, "GetIndexFromName direct result");
	g_Assert.equal(g_Helpers.GetIndexFromNetworkID(g_strNetworkID), g_nPlayerIndex, "GetIndexFromNetworkID direct result");
	g_Assert.ok(g_Helpers.GetPlayerInformationFromIndex(g_nPlayerIndex) === g_Player, "GetPlayerInformationFromIndex native object identity");
	g_Assert.equal(g_Helpers.GetAddressFromPlayerInformation(g_Player), g_unBaseEntityAddress, "GetAddressFromPlayerInformation BigInt address");
	g_Assert.equal(g_Helpers.GetAddressFromUserID(g_nUserID), g_unBaseEntityAddress, "GetAddressFromUserID BigInt address");
	g_Assert.equal(g_Helpers.GetUserIDFromAddress(g_unBaseEntityAddress), g_nUserID, "GetUserIDFromAddress direct result");
	g_Assert.equal(g_Helpers.GetNetworkAddress(g_Player), "127.0.0.1:27015", "network endpoint");
	g_Assert.equal(g_Helpers.GetClientCVarValue(g_Player, "cl_language"), "russian", "client CVar direct result");

	for (const strRemovedName of [
		"Player",
		"addressFromPlayerInfo",
		"all",
		"byIndex",
		"default",
		"moduleName",
		"steamIDFromPlayerInfo",
		"uniqueIDFromPlayerInfo",
	]) {
		g_Assert.ok(!Object.hasOwn(g_Helpers, strRemovedName), `players/helpers must not expose ${strRemovedName}.`);
	}

	g_vecNativeCalls.length = 0;

	const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
	const g_vecCodeBlocks = [...g_strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);

	function RequireDocumentationModule(strModuleName) {
		if (strModuleName === "players/entity") {
			return {
				Player: function CreatePlayer(nPlayerIndex) {
					return g_NativeImplementations.GetPlayerInformationFromIndex(nPlayerIndex);
				},
			};
		}

		if (strModuleName === "players/helpers") {
			return g_Helpers;
		}

		throw new Error(`unexpected players/helpers documentation module ${strModuleName}`);
	}

	g_Assert.equal(g_vecCodeBlocks.length, g_unDocumentationBlockCount, "players/helpers documentation workflow count");
	g_Assert.ok(!g_strDocumentation.includes("Generated by"), "players/helpers documentation must be maintained by hand.");
	g_Assert.ok(!g_strDocumentation.includes("console."), "players/helpers documentation must not use console output.");
	g_Assert.ok(g_strDocumentation.includes("not a numeric `IPlayerInfo*` and not the extended `players/entity` decoration"), "players/helpers documentation must define native playerInfo values.");
	g_Assert.ok(g_strDocumentation.includes("never returned as a string"), "players/helpers documentation must define exact BigInt addresses.");

	function CheckPlayerHelpersDocumentation(vecCodeBlocks) {
		const vecCases = [
			{ Name: "FindPlayerByName", Arguments: ["Ren"] },
			{ Name: "ResolvePlayerSearches", Arguments: ["Ren", g_strNetworkID, g_nUserID] },
			{ Name: "RoundTripPlayerInformation", Arguments: [g_nPlayerIndex] },
			{ Name: "RoundTripPlayerEdict", Arguments: [g_nPlayerIndex] },
			{ Name: "RoundTripPlayerBaseEntity", Arguments: [g_nPlayerIndex] },
			{ Name: "RoundTripPlayerHandles", Arguments: [g_nPlayerIndex] },
			{ Name: "RoundTripPlayerAddress", Arguments: [g_nPlayerIndex] },
			{ Name: "InspectHumanClient", Arguments: [g_nPlayerIndex, "rate"] },
		];
		const vecReverseCalls = [
			"GetPlayerInformationFromEdict",
			"GetUserIDFromEdict",
			"GetPlayerInformationFromBaseEntity",
			"GetUserIDFromBaseEntity",
			"GetPlayerInformationFromBaseHandle",
			"GetUserIDFromBaseHandle",
			"GetPlayerInformationFromIntegerHandle",
			"GetUserIDFromIntegerHandle",
			"GetPlayerInformationFromAddress",
			"GetUserIDFromAddress",
		];
		let unScenarioCount = 0;

		function Execute(unBlockIndex, vecArguments = vecCases[unBlockIndex].Arguments, Overrides = {}, DecoratePlayer = g_NativeImplementations.GetPlayerInformationFromIndex) {
			const vecCalls = [];
			const NativeModule = {};
			for (const strName of g_vecExpectedExports) {
				const Callback = Object.hasOwn(Overrides, strName) ? Overrides[strName] : g_NativeImplementations[strName];
				NativeModule[strName] = (...vecNativeArguments) => {
					vecCalls.push(strName);

					return Callback(...vecNativeArguments);
				};
			}

			const ModuleRecord = { exports: {} };
			const Require = (strName) => {
				if (strName === "players/helpers") {
					return NativeModule;
				}

				if (strName === "players/entity") {
					return {
						Player: (...vecPlayerArguments) => {
							vecCalls.push("Player");

							return DecoratePlayer(...vecPlayerArguments);
						},
					};
				}

				throw new Error("Unexpected documentation import: " + strName);
			};
			CompileDocumentationBlock(vecCodeBlocks[unBlockIndex], unBlockIndex)(Require, ModuleRecord, ModuleRecord.exports);
			g_Assert.equal(vecCalls.length, 0, "documentation imports must not perform SDK lookups");

			let Result = undefined;
			let Failure = undefined;
			let bFailed = false;

			try {
				Result = ModuleRecord.exports[vecCases[unBlockIndex].Name](...vecArguments);
			} catch (ErrorValue) {
				Failure = ErrorValue;
				bFailed = true;
			}

			++unScenarioCount;

			return { Result, Failure, Failed: bFailed, Calls: vecCalls };
		}

		function ExpectFailure(unBlockIndex, vecArguments, Overrides = {}) {
			const Run = Execute(unBlockIndex, vecArguments, Overrides);
			g_Assert.ok(Run.Failed, vecCases[unBlockIndex].Name + " must reject a malformed value");
			g_Assert.ok(!(Run.Failure instanceof SyntaxError), "a syntax error is not a contract test");
			g_Assert.ok(!(Run.Failure instanceof g_Assert.AssertionError), "a fixture assertion is not a contract test");

			return Run;
		}

		function AssertNoReverse(Run) {
			g_Assert.ok(!Run.Calls.some((strName) => vecReverseCalls.includes(strName)), "invalid or unavailable representations must not reach reverse conversions");
		}

		function MakeReadOnceRecord(Record) {
			const Snapshot = {};
			const mapReads = new Map();
			for (const strName of Object.keys(Record)) {
				mapReads.set(strName, 0);
				Object.defineProperty(Snapshot, strName, {
					get() {
						const unReadCount = mapReads.get(strName) + 1;
						mapReads.set(strName, unReadCount);
						g_Assert.equal(unReadCount, 1, "descriptor field must be captured once: " + strName);

						return Record[strName];
					},
				});
			}

			return { Snapshot, Reads: mapReads };
		}

		// An SDK-double assertion is a fixture failure, not documented input rejection.
		const FixtureInvariantError = new g_Assert.AssertionError({ message: "fixture invariant failed", actual: false, expected: true, operator: "strictEqual" });
		const CreateFailureGuard = g_VM.compileFunction(ExpectFailure.toString() + "\nreturn ExpectFailure;", ["Execute", "vecCases", "g_Assert"], { filename: __filename + "#failure-guard" });
		const FailureGuard = CreateFailureGuard(() => ({ Failed: true, Failure: FixtureInvariantError }), [{ Name: "FixtureInvariant" }], g_Assert);
		g_Assert.throws(() => FailureGuard(0, []), { code: "ERR_ASSERTION", message: "a fixture assertion is not a contract test" });

		const vecSuccessfulRuns = vecCases.map((Case, unBlockIndex) => Execute(unBlockIndex, Case.Arguments));
		for (const Run of vecSuccessfulRuns) {
			g_Assert.equal(Run.Failed, false, "each documentation workflow must succeed with current SDK doubles");
		}

		g_Assert.equal(vecSuccessfulRuns[g_DocumentationBlocks.Edict].Result.Address, g_unEdictAddress, "edict BigInt must be exact beyond Number precision");
		g_Assert.equal(vecSuccessfulRuns[g_DocumentationBlocks.BaseEntity].Result.Address, g_unBaseEntityAddress, "base entity BigInt must be exact beyond Number precision");
		g_Assert.equal(vecSuccessfulRuns[g_DocumentationBlocks.Handles].Result.IntegerHandle, g_unHandle, "unsigned handle high bit must not be narrowed to Int32");
		g_Assert.equal(vecSuccessfulRuns[g_DocumentationBlocks.Address].Result.Address, g_unBaseEntityAddress, "address BigInt must be exact beyond Number precision");

		const vecInvalidIndexes = [
			undefined,
			null,
			false,
			"1",
			1n,
			{},
			0,
			-1,
			0.5,
			NaN,
			Infinity,
			0x80000000,
		];
		for (let unBlockIndex = g_DocumentationBlocks.Information; unBlockIndex < vecCases.length; ++unBlockIndex) {
			for (const IndexValue of vecInvalidIndexes) {
				const Run = ExpectFailure(unBlockIndex, [IndexValue, "rate"]);
				g_Assert.equal(Run.Calls.length, 0, "index validation must precede SDK work");
			}
		}

		const vecInvalidStrings = [
			undefined,
			null,
			false,
			1,
			{},
			"",
			"Ren\0suffix",
		];
		for (const NameValue of vecInvalidStrings) {
			for (const unBlockIndex of [g_DocumentationBlocks.NameSearch, g_DocumentationBlocks.Searches]) {
				const Run = ExpectFailure(unBlockIndex, [NameValue, g_strNetworkID, g_nUserID]);
				g_Assert.equal(Run.Calls.length, 0, "name validation must precede searches");
			}

			g_Assert.equal(ExpectFailure(g_DocumentationBlocks.Searches, ["Ren", NameValue, g_nUserID]).Calls.length, 0, "network identity validation must precede searches");

			if (NameValue !== undefined) {
				g_Assert.equal(ExpectFailure(g_DocumentationBlocks.Client, [g_nPlayerIndex, NameValue]).Calls.length, 0, "ConVar validation must precede player lookup");
			}
		}

		const vecInvalidUserIDs = [
			undefined,
			null,
			false,
			"11",
			11n,
			{},
			0.5,
			NaN,
			Infinity,
			-0x80000001,
			0x80000000,
		];
		for (const UserIDValue of vecInvalidUserIDs) {
			g_Assert.equal(ExpectFailure(g_DocumentationBlocks.Searches, ["Ren", g_strNetworkID, UserIDValue]).Calls.length, 0, "expected user ID must be Int32 before SDK work");

			for (let unBlockIndex = g_DocumentationBlocks.Searches; unBlockIndex <= g_DocumentationBlocks.Address; ++unBlockIndex) {
				const strUserIDCall = (unBlockIndex === g_DocumentationBlocks.Searches) ? "GetUserID" : "GetUserIDFromPlayerInformation";
				const Run = ExpectFailure(unBlockIndex, vecCases[unBlockIndex].Arguments, { [strUserIDCall]: () => UserIDValue });
				g_Assert.equal(Run.Calls[Run.Calls.length - 1], strUserIDCall, "invalid native user ID must stop before further conversions");
			}
		}

		for (const unBlockIndex of [g_DocumentationBlocks.NameSearch, g_DocumentationBlocks.Searches]) {
			const Run = Execute(unBlockIndex, undefined, { GetIndexFromName: () => -1 });
			g_Assert.equal(Run.Failed, false);
			g_Assert.equal(Run.Result, null, "a missing name is not an invalid player lookup");
			g_Assert.deepEqual(Run.Calls, ["GetIndexFromName"]);

			for (const IndexValue of [
				0,
				-2,
				"1",
				1n,
				0.5,
				NaN,
				0x80000000,
			]) {
				g_Assert.deepEqual(ExpectFailure(unBlockIndex, undefined, { GetIndexFromName: () => IndexValue }).Calls, ["GetIndexFromName"], "invalid search output must not reach SDK queries");
			}
		}

		for (const [unBlockIndex, strCallName, EmptyValue] of [
			[g_DocumentationBlocks.BaseEntity, "GetBaseEntityFromPlayerInformation", null],
			[g_DocumentationBlocks.BaseEntity, "GetBaseEntityFromUserID", null],
			[g_DocumentationBlocks.Handles, "GetBaseHandleFromPlayerInformation", null],
			[g_DocumentationBlocks.Handles, "GetBaseHandleFromUserID", null],
			[g_DocumentationBlocks.Handles, "GetIntegerHandleFromPlayerInformation", -1],
			[g_DocumentationBlocks.Handles, "GetIntegerHandleFromUserID", -1],
			[g_DocumentationBlocks.Address, "GetAddressFromPlayerInformation", 0n],
			[g_DocumentationBlocks.Address, "GetAddressFromUserID", 0n],
		]) {
			const Run = Execute(unBlockIndex, undefined, { [strCallName]: () => EmptyValue });
			g_Assert.equal(Run.Failed, false);
			g_Assert.equal(Run.Result, null, "unavailable native representations must return null");
			g_Assert.equal(Run.Calls[Run.Calls.length - 1], strCallName, "unavailable representation must stop immediately");
			AssertNoReverse(Run);
		}

		for (const [unBlockIndex, strFirstCall, strSecondCall, MakeRecord] of [
			[g_DocumentationBlocks.Edict, "GetEdictFromPlayerInformation", "GetEdictFromUserID", MakeEdict],
			[g_DocumentationBlocks.BaseEntity, "GetBaseEntityFromPlayerInformation", "GetBaseEntityFromUserID", MakeBaseEntity],
			[g_DocumentationBlocks.Handles, "GetBaseHandleFromPlayerInformation", "GetBaseHandleFromUserID", MakeBaseHandle],
		]) {
			const First = MakeReadOnceRecord(MakeRecord());
			const Second = MakeReadOnceRecord(MakeRecord());
			const Run = Execute(unBlockIndex, undefined, { [strFirstCall]: () => First.Snapshot, [strSecondCall]: () => Second.Snapshot });
			g_Assert.equal(Run.Failed, false, "native descriptor getters must only be consumed once");

			for (const Captured of [First, Second]) {
				g_Assert.ok([...Captured.Reads.values()].every((unCount) => unCount === 1), "every descriptor field must be captured once");
			}

			const vecBadFields = (unBlockIndex === g_DocumentationBlocks.Handles)
				? [
					{ Kind: "wrong" },
					{ Value: 0 },
					{ Value: 0xFFFFFFFF },
					{ Value: 1n },
					{ EntryIndex: 2 },
					{ SerialNumber: -1 },
					{ SerialNumber: 0x80000000 },
					{ Valid: "true" },
					{ Valid: false },
				]
				: [
					{ Kind: "wrong" },
					{ Address: 1 },
					{ Address: 0n },
					{ Address: -1n },
					{ Address: 1n << 64n },
					{ Index: 2 },
					{ ClassName: null },
				];
			for (const strCallName of [strFirstCall, strSecondCall]) {
				for (const BadFields of vecBadFields) {
					AssertNoReverse(ExpectFailure(unBlockIndex, undefined, { [strCallName]: () => ({ ...MakeRecord(), ...BadFields }) }));
				}

				for (const WrongShape of [undefined, false, 1, "descriptor", []]) {
					AssertNoReverse(ExpectFailure(unBlockIndex, undefined, { [strCallName]: () => WrongShape }));
				}

				for (const strFieldName of Object.keys(MakeRecord())) {
					const Record = MakeRecord();
					Object.defineProperty(Record, strFieldName, {
						get() {
							throw null;
						},
					});
					const FailureRun = Execute(unBlockIndex, undefined, { [strCallName]: () => Record });
					g_Assert.equal(FailureRun.Failed, true, "throwing descriptor getters must abort");
					g_Assert.strictEqual(FailureRun.Failure, null, "non-Error getter failures must propagate unchanged");
					AssertNoReverse(FailureRun);
				}
			}
		}

		for (const strCallName of ["GetAddressFromPlayerInformation", "GetAddressFromUserID"]) {
			for (const AddressValue of [
				undefined,
				null,
				0,
				1,
				"address",
				Object(1n),
				-1n,
				1n << 64n,
			]) {
				AssertNoReverse(ExpectFailure(g_DocumentationBlocks.Address, undefined, { [strCallName]: () => AddressValue }));
			}
		}

		for (const strCallName of ["GetIntegerHandleFromPlayerInformation", "GetIntegerHandleFromUserID"]) {
			for (const HandleValue of [
				undefined,
				null,
				false,
				0,
				-2,
				1n,
				"handle",
				0.5,
				NaN,
				0xFFFFFFFF,
				0x100000000,
				g_unHandle + 1,
			]) {
				AssertNoReverse(ExpectFailure(g_DocumentationBlocks.Handles, undefined, { [strCallName]: () => HandleValue }));
			}
		}

		for (const [unBlockIndex, strCallName] of [
			[g_DocumentationBlocks.Edict, "GetPlayerInformationFromEdict"],
			[g_DocumentationBlocks.BaseEntity, "GetPlayerInformationFromBaseEntity"],
			[g_DocumentationBlocks.Address, "GetPlayerInformationFromAddress"],
		]) {
			const SamePlayer = MakeReadOnceRecord({ Index: g_nPlayerIndex });
			const Run = Execute(unBlockIndex, undefined, { [strCallName]: () => SamePlayer.Snapshot });
			g_Assert.equal(Run.Failed, false, "reverse wrapper Index must be captured once");
			g_Assert.equal(SamePlayer.Reads.get("Index"), 1);
		}

		for (const [strPropertyName, PropertyValue] of [["Connected", undefined], ["FakeClient", 1]]) {
			g_Assert.ok(ExpectFailure(g_DocumentationBlocks.Client, undefined, { GetPlayerInformationFromIndex: () => ({ ...g_Player, [strPropertyName]: PropertyValue }) }).Calls.every((strName) => strName === "GetPlayerInformationFromIndex"));
		}

		for (const strPropertyName of ["Connected", "FakeClient"]) {
			for (const Value of [undefined, null, 0, 1, "true"]) {
				const Run = ExpectFailure(g_DocumentationBlocks.Client, undefined, { GetPlayerInformationFromIndex: () => ({ ...g_Player, [strPropertyName]: Value }) });
				g_Assert.deepEqual(Run.Calls, ["GetPlayerInformationFromIndex"], "non-boolean client status must stop before identity queries");
			}
		}

		for (const [strPropertyName, bValue] of [["Connected", false], ["FakeClient", true]]) {
			const Run = Execute(g_DocumentationBlocks.Client, undefined, { GetPlayerInformationFromIndex: () => ({ ...g_Player, [strPropertyName]: bValue }) });
			g_Assert.equal(Run.Failed, false);
			g_Assert.equal(Run.Result, null);
			g_Assert.deepEqual(Run.Calls, ["GetPlayerInformationFromIndex"], "unavailable human client must stop before identity queries");
		}

		for (const strCallName of ["GetNetworkID", "GetNetworkAddress", "GetClientCVarValue", "GetClientLanguage", "GetNetworkIDFromIndex"]) {
			for (const Value of [null, 1, {}]) {
				ExpectFailure(g_DocumentationBlocks.Client, undefined, { [strCallName]: () => Value });
			}
		}

		for (const strCallName of g_vecExpectedExports) {
			const nBlockIndex = vecSuccessfulRuns.findIndex((Run) => Run.Calls.includes(strCallName));
			g_Assert.ok(nBlockIndex >= 0, "each of the 37 native exports must execute in documentation");
			const Run = Execute(nBlockIndex, undefined, {
				[strCallName]: () => {
					throw null;
				},
			});
			g_Assert.equal(Run.Failed, true, "native failures must stop the workflow");
			g_Assert.strictEqual(Run.Failure, null, "non-Error native exceptions must propagate unchanged");
			g_Assert.equal(Run.Calls[Run.Calls.length - 1], strCallName, "no native operation may run after a failure");
		}

		for (const [strCallName, Value] of [
			["IsConnected", 1],
			["GetName", 1],
			["GetIndexFromNetworkID", 2],
			["GetIndexFromUserID", 2],
			["GetPlayerIndex", 2],
			["GetUserIDFromIndex", 12],
		]) {
			ExpectFailure(g_DocumentationBlocks.Searches, undefined, { [strCallName]: () => Value });
		}

		ExpectFailure(g_DocumentationBlocks.NameSearch, undefined, { GetName: () => null });
		g_Assert.equal(Execute(g_DocumentationBlocks.Client, [g_nPlayerIndex]).Failed, false, "omitted ConVar name must use the documented rate default");

		const WrongIndex = ExpectFailure(g_DocumentationBlocks.Information, undefined, { GetIndexFromPlayerInformation: () => 2 });
		g_Assert.equal(WrongIndex.Calls[WrongIndex.Calls.length - 1], "GetIndexFromPlayerInformation", "changed native index must stop before decoration");

		const WrongDecorator = Execute(g_DocumentationBlocks.Information, undefined, {}, () => ({ Index: 2 }));
		g_Assert.equal(WrongDecorator.Failed, true, "decoration must preserve the current player index");

		for (let unBlockIndex = g_DocumentationBlocks.Information; unBlockIndex < vecCases.length; ++unBlockIndex) {
			const Run = Execute(unBlockIndex, [0x7FFFFFFF, "rate"], {
				GetPlayerInformationFromIndex: () => {
					throw null;
				},
			});
			g_Assert.equal(Run.Failed, true);
			g_Assert.strictEqual(Run.Failure, null, "a valid Int32 boundary must reach the native provider, which decides liveness");
			g_Assert.deepEqual(Run.Calls, ["GetPlayerInformationFromIndex"]);
		}

		for (const nUserID of [-0x80000000, 0, 0x7FFFFFFF]) {
			const Run = Execute(g_DocumentationBlocks.Information, undefined, {
				GetUserIDFromPlayerInformation: () => nUserID,

				GetPlayerInformationFromUserID: () => {
					throw null;
				},
			});
			g_Assert.equal(Run.Failed, true);
			g_Assert.strictEqual(Run.Failure, null, "signed Int32 user IDs must reach the native resolver without narrowing");
			g_Assert.equal(Run.Calls[Run.Calls.length - 1], "GetPlayerInformationFromUserID");
		}

		for (const [unBlockIndex, strCallName, MakeRecord] of [
			[g_DocumentationBlocks.Edict, "GetEdictFromUserID", MakeEdict],
			[g_DocumentationBlocks.BaseEntity, "GetBaseEntityFromUserID", MakeBaseEntity],
		]) {
			AssertNoReverse(ExpectFailure(unBlockIndex, undefined, { [strCallName]: () => ({ ...MakeRecord(), Address: g_unBaseEntityAddress + 1n }) }));
		}

		for (const Fields of [{ Value: g_unHandle + 1 }, { SerialNumber: 0x100002 }]) {
			AssertNoReverse(ExpectFailure(g_DocumentationBlocks.Handles, undefined, { GetBaseHandleFromUserID: () => ({ ...MakeBaseHandle(), ...Fields }) }));
		}

		for (const [unBlockIndex, strCallName] of [
			[g_DocumentationBlocks.Edict, "GetPlayerInformationFromEdict"],
			[g_DocumentationBlocks.BaseEntity, "GetPlayerInformationFromBaseEntity"],
			[g_DocumentationBlocks.Handles, "GetPlayerInformationFromBaseHandle"],
			[g_DocumentationBlocks.Handles, "GetPlayerInformationFromIntegerHandle"],
			[g_DocumentationBlocks.Address, "GetPlayerInformationFromAddress"],
		]) {
			ExpectFailure(unBlockIndex, undefined, { [strCallName]: () => ({ Index: 2 }) });
			const Run = Execute(unBlockIndex, undefined, {
				[strCallName]: () => ({
					get Index() {
						throw null;
					},
				}),
			});
			g_Assert.equal(Run.Failed, true);
			g_Assert.strictEqual(Run.Failure, null, "reverse wrapper getter exceptions must propagate unchanged");
		}

		for (const [unBlockIndex, strCallName] of [
			[g_DocumentationBlocks.Edict, "GetUserIDFromEdict"],
			[g_DocumentationBlocks.BaseEntity, "GetUserIDFromBaseEntity"],
			[g_DocumentationBlocks.Handles, "GetUserIDFromBaseHandle"],
			[g_DocumentationBlocks.Handles, "GetUserIDFromIntegerHandle"],
			[g_DocumentationBlocks.Address, "GetUserIDFromAddress"],
		]) {
			ExpectFailure(unBlockIndex, undefined, { [strCallName]: () => 12 });
		}

		const Decorated = MakeReadOnceRecord({ Index: g_nPlayerIndex });
		g_Assert.equal(Execute(g_DocumentationBlocks.Information, undefined, {}, () => Decorated.Snapshot).Failed, false);
		g_Assert.equal(Decorated.Reads.get("Index"), 1, "decoration must read the current Index only once");

		const HumanPlayer = { Index: g_nPlayerIndex };
		const mapPropertyReads = new Map();
		for (const strPropertyName of ["Connected", "FakeClient"]) {
			mapPropertyReads.set(strPropertyName, 0);
			Object.defineProperty(HumanPlayer, strPropertyName, {
				get() {
					const unReadCount = mapPropertyReads.get(strPropertyName) + 1;
					mapPropertyReads.set(strPropertyName, unReadCount);
					g_Assert.equal(unReadCount, 1, "human-client status properties must be captured once");

					return strPropertyName === "Connected";
				},
			});
		}

		const HumanRun = Execute(g_DocumentationBlocks.Client, undefined, { GetPlayerInformationFromIndex: () => HumanPlayer });
		g_Assert.equal(HumanRun.Failed, false);
		g_Assert.ok([...mapPropertyReads.values()].every((unCount) => unCount === 1));

		for (const strPropertyName of ["Connected", "FakeClient"]) {
			const Run = Execute(g_DocumentationBlocks.Client, undefined, {
				GetPlayerInformationFromIndex: () => ({
					...g_Player,

					get [strPropertyName]() {
						throw null;
					},
				}),
			});
			g_Assert.equal(Run.Failed, true);
			g_Assert.strictEqual(Run.Failure, null, "native status exceptions must propagate unchanged");
			g_Assert.deepEqual(Run.Calls, ["GetPlayerInformationFromIndex"]);
		}

		return unScenarioCount;
	}

	function CheckPlayerHelpersDocumentationExamples() {
		const vecDocumentationModules = [];
		for (let unDocumentationCodeBlockIndex = 0; unDocumentationCodeBlockIndex < g_vecCodeBlocks.length; ++unDocumentationCodeBlockIndex) {
			const ModuleRecord = { exports: {} };
			CompileDocumentationBlock(g_vecCodeBlocks[unDocumentationCodeBlockIndex], unDocumentationCodeBlockIndex)(RequireDocumentationModule, ModuleRecord, ModuleRecord.exports);
			vecDocumentationModules.push(ModuleRecord.exports);
		}

		g_Assert.equal(g_vecNativeCalls.length, 0, "players/helpers examples must not perform conversions while code blocks load.");

		const DocumentationAPI = Object.assign({}, ...vecDocumentationModules);
		g_Assert.deepEqual(DocumentationAPI.FindPlayerByName("Ren"), { PlayerIndex: g_nPlayerIndex, Name: "Ren" }, "documented name lookup");

		const Searches = DocumentationAPI.ResolvePlayerSearches("Ren", g_strNetworkID, g_nUserID);
		const PlayerInformationRoundTrip = DocumentationAPI.RoundTripPlayerInformation(g_nPlayerIndex);
		const EdictRoundTrip = DocumentationAPI.RoundTripPlayerEdict(g_nPlayerIndex);
		const BaseEntityRoundTrip = DocumentationAPI.RoundTripPlayerBaseEntity(g_nPlayerIndex);
		const HandleRoundTrip = DocumentationAPI.RoundTripPlayerHandles(g_nPlayerIndex);
		const AddressRoundTrip = DocumentationAPI.RoundTripPlayerAddress(g_nPlayerIndex);
		const HumanClient = DocumentationAPI.InspectHumanClient(g_nPlayerIndex, "rate");

		g_Assert.equal(Searches.NetworkIDIndex, g_nPlayerIndex, "documented network-ID lookup");
		g_Assert.equal(Searches.UserIDIndex, g_nPlayerIndex, "documented user-ID lookup");
		g_Assert.ok(PlayerInformationRoundTrip.PlayerInformation === g_Player, "documented native player-information wrapper");
		g_Assert.equal(PlayerInformationRoundTrip.DecoratedPlayer.Index, g_nPlayerIndex, "documented decorated Player conversion");
		g_Assert.equal(EdictRoundTrip.Address, g_unEdictAddress, "documented edict address");
		g_Assert.equal(BaseEntityRoundTrip.Address, g_unBaseEntityAddress, "documented base-entity address");
		g_Assert.equal(HandleRoundTrip.IntegerHandle, g_unHandle, "documented integer handle");
		g_Assert.equal(AddressRoundTrip.Address, g_unBaseEntityAddress, "documented BigInt address");
		g_Assert.equal(HumanClient.ClientConVarValue, "30000", "documented client ConVar value");

		for (const strExportName of g_vecExpectedExports) {
			g_Assert.ok(g_strDocumentation.includes(`${strExportName}(`), `players/helpers documentation must use ${strExportName}().`);
			g_Assert.ok(g_vecNativeCalls.some((vecCall) => vecCall[0] === strExportName), `players/helpers examples must execute ${strExportName}().`);
		}
	}

	g_unDocumentationScenarioCount = RunDocumentationTask(() => CheckPlayerHelpersDocumentation(g_vecCodeBlocks), "contract-suite");
	RunDocumentationTask(CheckPlayerHelpersDocumentationExamples, "examples");

	const g_vecAddressResults = [g_Helpers.GetAddressFromPlayerInformation(g_Player), g_Helpers.GetAddressFromUserID(g_nUserID)];
	for (const unAddress of g_vecAddressResults) {
		g_Assert.equal(typeof unAddress, "bigint", "players/helpers address conversions must return primitive BigInts.");
		g_Assert.ok(unAddress > 0n, "players/helpers address conversions must return positive BigInt addresses.");
	}

	const g_strDocumentationWithoutCode = g_strDocumentation.replace(/```[\s\S]*?```/g, "");
	const g_vecLinks = [...g_strDocumentationWithoutCode.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((vecMatch) => vecMatch[1]);
	for (const strTarget of g_vecLinks) {
		if (strTarget.startsWith("#") || /^[a-z]+:/i.test(strTarget)) {
			continue;
		}

		const strTargetPath = g_Path.resolve(g_Path.dirname(g_strDocumentationPath), strTarget.split("#", 1)[0]);
		g_Assert.ok(g_FileSystem.existsSync(strTargetPath), `players/helpers documentation link must exist: ${strTarget}`);
	}

	const g_strModuleBindings = g_FileSystem.readFileSync(g_strModuleBindingsPath, "utf8");
	g_Assert.equal(Object.hasOwn(g_Player, "IsConnected"), false, "raw player fixtures must not invent decorated IsConnected methods");
	g_Assert.equal(Object.hasOwn(g_Player, "IsFakeClient"), false, "raw player fixtures must not invent decorated IsFakeClient methods");
	g_Assert.ok(g_strModuleBindings.includes('{ "Connected", PlayerLiveProperty::Connected }'), "raw player Connected field must match native wiring (source only)");
	g_Assert.ok(g_strModuleBindings.includes('{ "FakeClient", PlayerLiveProperty::FakeClient }'), "raw player FakeClient field must match native wiring (source only)");
	g_Assert.ok(g_strModuleBindings.includes("enum class PlayerHelperValue"), "native player helper conversion value inventory");
	g_Assert.ok(/\t\tenum class PlayerHelperValue : unsigned char \{\r?\n\t\t\tPLAYER_INDEX = 0,\r?\n\t\t\tPLAYER_INFORMATION,\r?\n\t\t\tUSER_ID,\r?\n\t\t\tEDICT,\r?\n\t\t\tBASE_ENTITY,\r?\n\t\t\tBASE_HANDLE,\r?\n\t\t\tINTEGER_HANDLE,\r?\n\t\t\tADDRESS\r?\n\t\t\};/.test(g_strModuleBindings), "native player helper conversion representation and ordinal inventory");
	g_Assert.doesNotMatch(g_strModuleBindings, /\bPlayerHelperValue::PLAYER_INFO\b/, "native player helper discriminator must use complete words");
	g_Assert.strictEqual((g_strModuleBindings.match(/\bcase PlayerHelperValue::PLAYER_INFORMATION\b/g) || []).length, 2, "native player information input/output dispatch");
	g_Assert.ok(g_strModuleBindings.includes("ConvertPlayerHelperValueCallback"), "native player helper conversion callback");
	g_Assert.ok(g_strModuleBindings.includes("AddPlayerSteamIDCandidates"), "native equivalent Steam ID matching");
	g_Assert.ok(g_strModuleBindings.includes("RequireConnectedHumanPlayerInformation"), "native human-client validation");
	g_Assert.ok(g_strModuleBindings.includes("v8::Local<v8::Object> const LocalPlayerHelpersModule = MakeModule(pIsolate);"), "native players/helpers module installation");
	g_Assert.ok(g_strModuleBindings.includes('InstallPlayerConversionFunction("GetPlayerInformationFromAddress", PlayerHelperValue::ADDRESS, PlayerHelperValue::PLAYER_INFORMATION)'), "BigInt address to player conversion");
	g_Assert.ok(g_strModuleBindings.includes('InstallPlayerConversionFunction("GetAddressFromPlayerInformation", PlayerHelperValue::PLAYER_INFORMATION, PlayerHelperValue::ADDRESS)'), "player to BigInt address conversion");
	g_Assert.ok(g_strModuleBindings.includes("return v8::BigInt::NewFromUnsigned(pIsolate, static_cast<std::uint64_t>(unAddress));"), "BigInt native entity addresses");
	g_Assert.ok(g_strModuleBindings.includes('GetClientConVarValue(pEngineServer, nEntityIndex, kLanguageCVarName)'), "native client-language lookup");
} catch (ErrorValue) {
	g_PrimaryFailure = ErrorValue;
	g_bFailed = true;
} finally {
	const vecCleanupFailures = [];
	for (const Restore of [RestorePackageCache, RestoreModuleLoader, RestoreSourceJS]) {
		try {
			Restore();
		} catch (ErrorValue) {
			vecCleanupFailures.push(ErrorValue);
		}
	}

	if (vecCleanupFailures.length > 0) {
		if (g_bFailed) {
			throw new AggregateError([g_PrimaryFailure, ...vecCleanupFailures], "Player helpers review and restoration failed.");
		}

		throw new AggregateError(vecCleanupFailures, "Player helpers restoration failed.");
	}
}

if (g_bFailed) {
	throw g_PrimaryFailure;
}

console.log("[  OK  ] smoke_players_helpers DocumentationScenarios=" + g_unDocumentationScenarioCount);
