#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strPackagePath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "filters.js");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "filters.md");
const g_strNativeBindingsPath = g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "modules", "ModuleBindings.cpp");
const g_strRuntimePath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "internal", "runtime.js");
const g_OriginalModuleLoad = g_Module._load;
const g_OriginalSourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
const g_vecCachePaths = [g_strPackagePath, g_strRuntimePath];
const g_mapOriginalCacheEntries = new Map(g_vecCachePaths.map((strModulePath) => [strModulePath, require.cache[strModulePath]]));

const g_vecNativeCalls = [];
const g_vecSentMessages = [];
const g_RejectDocumentationConsole = () => {
	throw new Error("Root-filter documentation must use the typed logger.");
};
const g_ConsoleDouble = new Proxy({}, { get: g_RejectDocumentationConsole });

function CreateEntity(unIndex, strClassName, Extra = {}) {
	const unBaseEntityAddress = 0x7D0n + BigInt(unIndex);

	return {
		Index: unIndex,
		Valid: true,
		Free: false,
		ClassName: strClassName,
		StateFlags: 0,
		NetworkSerialNumber: unIndex + 100,
		Edict: { Address: 0x3E8n + BigInt(unIndex) },
		BaseEntity: { Address: unBaseEntityAddress },
		Address: unBaseEntityAddress,
		BaseHandle: { Address: 0xBB8n + BigInt(unIndex) },
		HandleValue: 4000 + unIndex,
		RemoveEntity() {
			this.Free = true;

			return true;
		},
		...Extra,
	};
}

function CreatePlayer(unIndex, strName, unUserID, bFakeClient) {
	return CreateEntity(unIndex, "player", {
		Index: unIndex,
		Name: strName,
		UserID: unUserID,
		NetworkID: bFakeClient ? "BOT" : `STEAM_1:1:${unUserID}`,
		RemoteAddress: bFakeClient ? "" : `127.0.0.1:${27000 + unIndex}`,
		Team: 2,
		Frags: 3,
		Deaths: 1,
		Health: 80,
		MaximumHealth: 100,
		Connected: true,
		FakeClient: bFakeClient,
		Language: bFakeClient ? "" : "russian",
		Dead: false,
		Free: false,
		Origin: { X: unIndex * 10, Y: 20, Z: 30 },
		Weapon: "weapon_rifle",
		Model: "models/survivors/survivor_manager.mdl",

		Slay() {
			return true;
		},

		ExecuteClientCommand() {
			return true;
		},

		SetName(strName) {
			this.Name = strName;

			return true;
		},

		Say() {
			return true;
		},

		SayTeam() {
			return true;
		},

		Kick() {
			return true;
		},

		Ban() {
			return true;
		},

		ChangeTeam(nTeamNumber) {
			this.Team = nTeamNumber;

			return true;
		},
	});
}

const g_State = {
	Entities: [
		CreateEntity(0, "worldspawn"),
		CreateEntity(8, "prop_physics"),
		CreateEntity(14, "weapon_rifle"),
		CreateEntity(15, "weapon_pistol"),
	],
	Players: [
		CreatePlayer(1, "Ren", 21, false),
		CreatePlayer(2, "Coach", 22, true),
	],
};

// These stand-ins model the exercised live fields, not selected-SDK capabilities.
function GetWorldRecords() {
	return [...g_State.Entities, ...g_State.Players];
}

function CreateLiveFacade(unIndex, GetRecords, vecFieldNames, vecMethodNames) {
	const Facade = {};
	const GetCurrentRecord = () => GetRecords().find((Record) => Record.Index === unIndex);
	Object.defineProperty(Facade, "Index", { enumerable: true, value: unIndex });

	for (const strFieldName of vecFieldNames) {
		Object.defineProperty(Facade, strFieldName, {
			enumerable: true,
			get() {
				const Record = GetCurrentRecord();
				if (strFieldName === "Valid") {
					return Boolean(Record) && !Record.Free;
				}

				if (strFieldName === "Free") {
					return !Record || Record.Free;
				}

				return Record?.[strFieldName];
			},
		});
	}

	for (const strMethodName of vecMethodNames) {
		Facade[strMethodName] = (...vecArguments) => {
			const Record = GetCurrentRecord();

			return Record[strMethodName](...vecArguments);
		};
	}

	return Facade;
}

function CreateNativeEntityFacade(unIndex) {
	const vecFieldNames = [
		"Valid",
		"Free",
		"ClassName",
		"StateFlags",
		"NetworkSerialNumber",
		"Edict",
		"BaseEntity",
		"Address",
		"BaseHandle",
		"HandleValue",
	];

	return CreateLiveFacade(unIndex, GetWorldRecords, vecFieldNames, ["RemoveEntity"]);
}

function CreateNativePlayerFacade(unIndex) {
	const vecFieldNames = [
		"Valid",
		"Free",
		"ClassName",
		"StateFlags",
		"NetworkSerialNumber",
		"Edict",
		"BaseEntity",
		"Address",
		"BaseHandle",
		"HandleValue",
		"Name",
		"UserID",
		"NetworkID",
		"RemoteAddress",
		"Team",
		"Frags",
		"Deaths",
		"Health",
		"MaximumHealth",
		"Connected",
		"FakeClient",
		"Language",
		"Dead",
		"Origin",
		"Weapon",
		"Model",
	];
	const vecMethodNames = [
		"RemoveEntity",
		"Slay",
		"ExecuteClientCommand",
		"SetName",
		"Say",
		"SayTeam",
		"Kick",
		"Ban",
		"ChangeTeam",
	];

	return CreateLiveFacade(unIndex, () => g_State.Players, vecFieldNames, vecMethodNames);
}

function CreateNativeWeaponFacade(unIndex) {
	const Weapon = CreateNativeEntityFacade(unIndex);
	const GetCurrentRecord = () => g_State.Entities.find((Record) => (Record.Index === unIndex) && !Record.Free);
	Object.defineProperty(Weapon, "IsWeapon", { enumerable: true, get: () => GetCurrentRecord()?.ClassName.startsWith("weapon_") ?? false });
	Object.defineProperty(Weapon, "Weapon", { enumerable: true, get: () => GetCurrentRecord()?.ClassName.replace(/^weapon_/, "") ?? "" });

	return Weapon;
}

const g_NativeFilters = {
	GetAllEntities() {
		g_vecNativeCalls.push("GetAllEntities");

		return GetWorldRecords().filter((Record) => !Record.Free).sort((Left, Right) => Left.Index - Right.Index).map((Record) => CreateNativeEntityFacade(Record.Index));
	},

	GetAllPlayers() {
		g_vecNativeCalls.push("GetAllPlayers");

		return g_State.Players.filter((Record) => Record.Connected && !Record.Free).map((Record) => CreateNativePlayerFacade(Record.Index));
	},

	GetAllRecipients() {
		g_vecNativeCalls.push("GetAllRecipients");
		const vecHumanPlayers = g_State.Players.filter((Entry) => Entry.Connected && !Entry.Free && !Entry.FakeClient).map((Entry) => CreateNativePlayerFacade(Entry.Index));

		return {
			RecipientIndexes: vecHumanPlayers.map((Entry) => Entry.Index),
			RecipientPlayers: vecHumanPlayers,
			RecipientCount: vecHumanPlayers.length,
		};
	},

	GetAllWeapons() {
		g_vecNativeCalls.push("GetAllWeapons");

		return g_State.Entities.filter((Entry) => !Entry.Free && Entry.ClassName.startsWith("weapon_")).map((Entry) => CreateNativeWeaponFacade(Entry.Index));
	},
};

function LoadRuntimeModule(strRequestName, ParentModule, bIsMain) {
	if (strRequestName === "internal/runtime") {
		return require(g_strRuntimePath);
	}

	return g_OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
}

class SayText2 {
	constructor(strMessage, Options = {}) {
		this.Message = strMessage;
		this.Options = Options;
	}

	SendUserMessage(Recipients) {
		g_vecSentMessages.push({ Message: this.Message, Options: this.Options, RecipientIndexes: [...Recipients.RecipientIndexes] });

		return Recipients.RecipientIndexes.length > 0;
	}
}

function ExtractJavaScriptBlocks(strMarkdown) {
	return [...strMarkdown.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
}

function CreateDocumentationRequire(Filters, LogInfo) {
	return function RequireDocumentationModule(strModuleName) {
		if (strModuleName === "filters") {
			return Filters;
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

function VerifyRecipientMessageContract(strExampleSource) {
	// Source alignment only; this check does not perform native message delivery.
	const strMessageSource = g_FileSystem.readFileSync(g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "messages", "index.js"), "utf8").replace(/\r\n/g, "\n");
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

	const Message = new SayText2("Controlled root-filter recipient delivery.");
	const unOriginalDeliveryCount = g_vecSentMessages.length;
	try {
		g_Assert.strictEqual(Message.SendUserMessage({ RecipientIndexes: [] }), false);
		g_Assert.strictEqual(Message.SendUserMessage({ RecipientIndexes: [1] }), true);
	} finally {
		g_vecSentMessages.length = unOriginalDeliveryCount;
	}
}

function VerifyDocumentationRequireContracts() {
	const Filters = {};
	const vecLogCalls = [];
	const LogInfo = (...vecArguments) => vecLogCalls.push(vecArguments);
	const DocumentationRequire = CreateDocumentationRequire(Filters, LogInfo);
	g_Assert.strictEqual(DocumentationRequire("filters"), Filters);
	g_Assert.strictEqual(DocumentationRequire("messages").SayText2, SayText2);
	g_Assert.strictEqual(DocumentationRequire("loggers").LogInfo, LogInfo);
	DocumentationRequire("loggers").LogInfo("RootFilterProbe Count=%d", 2);
	g_Assert.deepEqual(vecLogCalls, [["RootFilterProbe Count=%d", 2]]);
	g_Assert.throws(() => DocumentationRequire("UnknownModule"), /Unexpected documentation module/);
	g_Assert.throws(() => g_ConsoleDouble.log, /typed logger/);
}

function VerifyPlayerContractDocumentation(strDocumentation, strNativeBindings) {
	// Bounded source/document alignment only; this does not execute engine mutations or fix Ban's validation policy.
	const unMaximumDefinitionLineCount = 100;
	const unMaximumDefinitionCharacterCount = 10000;
	const strSource = strNativeBindings.replace(/\r\n/g, "\n");
	const ReadDefinition = strSignature => {
		const strClosingPrefix = "\n\t\t}";
		const nStartIndex = strSource.indexOf("\t\t" + strSignature);
		g_Assert(nStartIndex >= 0, strSignature);
		let nCloseIndex = strSource.indexOf(strClosingPrefix, nStartIndex);
		g_Assert(nCloseIndex > nStartIndex);
		let unEndIndex = nCloseIndex + strClosingPrefix.length;
		while (strSource.startsWith(" catch ", unEndIndex)) {
			nCloseIndex = strSource.indexOf(strClosingPrefix, unEndIndex);
			g_Assert(nCloseIndex > unEndIndex);
			unEndIndex = nCloseIndex + strClosingPrefix.length;
		}

		const strBody = strSource.slice(nStartIndex, unEndIndex);
		g_Assert(strBody.split("\n").length <= unMaximumDefinitionLineCount);
		g_Assert(strBody.length <= unMaximumDefinitionCharacterCount);

		return strBody;
	};
	const strBan = ReadDefinition("void PlayerBanMethodCallback(");
	const strIntegerArgument = ReadDefinition("bool GetInt32Argument(");
	g_Assert(strDocumentation.includes("Ban(nBanDuration?, bKickPlayer?, bWriteBanList?)"));
	g_Assert(strDocumentation.includes("primitive number"));
	g_Assert(strDocumentation.includes("2147483647"));
	g_Assert(!strDocumentation.includes("duration-conversion limitation"));
	g_Assert(!strDocumentation.includes("Ban(nDuration?"));
	g_Assert.match(strBan, /Player\.Ban\(nBanDuration\?, bKickPlayer\?, bWriteBanList\?\)/);
	g_Assert.match(strBan, /kDefaultBanDuration = 0;/);
	g_Assert.match(strBan, /kDefaultKickPlayer = true;/);
	g_Assert.match(strBan, /kDefaultWriteBanList = true;/);
	g_Assert.match(strBan, /LocalDurationValue->IsNumber\(\)/);
	g_Assert.match(strBan, /!std::isfinite\(dblBanDuration\) \|\| \(std::floor\(dblBanDuration\) != dblBanDuration\)/);
	g_Assert.match(strBan, /\(dblBanDuration < 0\) \|\| \(dblBanDuration > kMaximumBanDuration\)/);
	g_Assert.doesNotMatch(strBan, /GetInt32Argument\(|->(?:Int32Value|IntegerValue|NumberValue)\(/);
	const nDurationCommit = strBan.indexOf("nBanDuration = static_cast<int>(dblBanDuration);");
	g_Assert(nDurationCommit > strBan.indexOf("dblBanDuration > kMaximumBanDuration"));
	g_Assert(nDurationCommit < strBan.indexOf("ReadEntityIndex("));
	g_Assert.match(strIntegerArgument, /LocalValue->Int32Value\(LocalContext\)/);

	const strChangeTeam = ReadDefinition("void PlayerChangeTeamMethodCallback(");
	const strTeamValue = ReadDefinition("bool GetTeamNumberFromValue(");
	const strTeamAlias = ReadDefinition("bool GetTeamNumberFromAlias(");
	const strTeamLookup = ReadDefinition("std::string MakeTeamLookupName(");
	g_Assert(strDocumentation.includes("ChangeTeam(TeamReference)"));
	g_Assert(!strDocumentation.includes("ChangeTeam(nTeamIndex)"));
	g_Assert.match(strChangeTeam, /Player\.ChangeTeam\(TeamReference\)/);
	g_Assert.match(strChangeTeam, /GetTeamNumberFromValue\(/);
	g_Assert.match(strChangeTeam, /if \(nTeamIndex < 0\)/);
	g_Assert(strChangeTeam.indexOf("GetTeamNumberFromValue(") < strChangeTeam.indexOf("if (nTeamIndex < 0)"));
	g_Assert(strChangeTeam.indexOf("if (nTeamIndex < 0)") < strChangeTeam.indexOf("pPlayerInformation->ChangeTeam(nTeamIndex)"));
	g_Assert.match(strTeamValue, /!LocalValue->IsInt32\(\)/);
	g_Assert.match(strTeamValue, /GetTeamNumberFromAlias\(/);
	g_Assert.match(strTeamAlias, /nTeamIndexOut = kAnyTeamIndex;\s+return true;/);
	g_Assert.match(strTeamLookup, /ToLowerASCII\(strName\)/);
	g_Assert.match(strTeamLookup, /\(chCharacter != '_'\) && \(chCharacter != '-'\) && \(chCharacter != ' '\)/);

	const strPlayersDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "filters-players.md");
	const strPlayersPackagePath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "filters", "players.js");
	const strPlayersDocumentation = g_FileSystem.readFileSync(strPlayersDocumentationPath, "utf8");
	const strPlayersPackage = g_FileSystem.readFileSync(strPlayersPackagePath, "utf8");
	g_Assert(strPlayersDocumentation.includes("ChangePlayerTeam(TeamReference)"));
	g_Assert(!strPlayersDocumentation.includes("ChangePlayerTeam(nTeamNumber)"));
	g_Assert.match(strPlayersPackage, /ChangePlayerTeam: PlayerRecord\.ChangeTeam\?\.bind\(PlayerRecord\)/);
}

try {
	for (const strModulePath of g_vecCachePaths) {
		delete require.cache[strModulePath];
	}

	// Replace the fixture bridge without invoking a prior accessor; restore its descriptor below.
	Object.defineProperty(globalThis, "sourcejs", {
		configurable: true,
		enumerable: true,
		writable: true,
		value: { filters: g_NativeFilters },
	});

	g_Module._load = LoadRuntimeModule;

	const g_Filters = require(g_strPackagePath);
	g_Module._load = g_OriginalModuleLoad;

	VerifyDocumentationRequireContracts();
	g_Assert.strictEqual(g_Filters, g_NativeFilters);
	g_Assert.deepEqual(Object.keys(g_Filters).sort(), [
		"GetAllEntities",
		"GetAllPlayers",
		"GetAllRecipients",
		"GetAllWeapons",
	]);
	g_Assert.equal(g_Filters.GetAllPlayers()[0].UserID, 21);
	g_Assert.equal(g_Filters.GetAllPlayers()[0].NetworkID, "STEAM_1:1:21");
	g_Assert.equal(g_Filters.GetAllPlayers()[0].RemoteAddress, "127.0.0.1:27001");
	g_Assert.equal(g_Filters.GetAllEntities().find((Entity) => Entity.Index === 8).ClassName, "prop_physics");
	g_Assert.deepEqual(g_Filters.GetAllRecipients().RecipientIndexes, [1]);
	g_Assert.equal(g_Filters.GetAllRecipients().RecipientCount, 1);
	g_Assert.deepEqual(g_Filters.GetAllWeapons().map((Weapon) => Weapon.Weapon), ["rifle", "pistol"]);
	g_Assert.equal(Object.hasOwn(g_Filters, "moduleName"), false);
	g_Assert.equal(Object.hasOwn(g_Filters, "default"), false);

	const g_vecFirstPlayerScan = g_Filters.GetAllPlayers();
	const g_FirstPlayer = g_vecFirstPlayerScan[0];
	const g_PlayerRecord = g_State.Players[0];
	const g_strOriginalPlayerName = g_PlayerRecord.Name;
	const g_bOriginalPlayerConnection = g_PlayerRecord.Connected;
	const g_HumanRecipientRecord = g_Filters.GetAllRecipients();
	g_Assert.equal(typeof g_FirstPlayer.Address, "bigint");
	g_Assert.equal(typeof g_FirstPlayer.Edict.Address, "bigint");
	g_Assert.equal(typeof g_FirstPlayer.BaseEntity.Address, "bigint");
	g_Assert.equal(typeof g_FirstPlayer.BaseHandle.Address, "bigint");
	g_Assert.equal(typeof g_FirstPlayer.RemoveEntity, "function");
	g_Assert.notStrictEqual(g_Filters.GetAllPlayers()[0], g_FirstPlayer);

	g_PlayerRecord.Name = "Updated";
	try {
		g_Assert.equal(g_FirstPlayer.Name, "Updated", "retained Player must read current state");
		g_Assert.equal(g_HumanRecipientRecord.RecipientPlayers[0].Name, "Updated");
		g_Assert.equal(g_FirstPlayer.SetName("Renamed"), true);
		g_Assert.equal(g_PlayerRecord.Name, "Renamed", "native action stand-in must mutate the current record");
		g_PlayerRecord.Connected = false;
		g_Assert.equal(g_FirstPlayer.Connected, false);
		g_Assert.deepEqual(g_Filters.GetAllPlayers().map((Player) => Player.Index), [2]);
		g_Assert.deepEqual(g_Filters.GetAllRecipients().RecipientIndexes, []);
		g_Assert.equal(g_vecFirstPlayerScan.length, 2, "scan membership remains a point-in-time array");
		g_Assert.equal(g_HumanRecipientRecord.RecipientCount, 1);
		g_Assert.deepEqual(g_HumanRecipientRecord.RecipientIndexes, [1]);
	} finally {
		g_PlayerRecord.Name = g_strOriginalPlayerName;
		g_PlayerRecord.Connected = g_bOriginalPlayerConnection;
	}

	const g_EntityRecord = g_State.Entities.find((Record) => Record.Index === 8);
	const g_Entity = g_Filters.GetAllEntities().find((Entity) => Entity.Index === 8);
	const g_strOriginalEntityClassName = g_EntityRecord.ClassName;
	const g_bOriginalEntityFree = g_EntityRecord.Free;
	const g_vecFirstWeaponScan = g_Filters.GetAllWeapons();
	g_Assert.deepEqual(g_Filters.GetAllEntities().map((Entity) => Entity.Index), [0, 1, 2, 8, 14, 15]);
	g_Assert.equal(Object.hasOwn(g_vecFirstWeaponScan[0], "WeaponName"), false);

	g_EntityRecord.ClassName = "weapon_runtime";
	try {
		g_Assert.equal(g_Entity.ClassName, "weapon_runtime", "retained Entity must read current state");
		g_Assert.deepEqual(g_Filters.GetAllWeapons().map((Weapon) => Weapon.Weapon), ["runtime", "rifle", "pistol"]);
		g_Assert.equal(g_vecFirstWeaponScan.length, 2);
		g_EntityRecord.Free = true;
		g_Assert.equal(g_Entity.Valid, false);
		g_Assert.equal(g_Entity.Free, true);
		g_Assert.deepEqual(g_Filters.GetAllEntities().map((Entity) => Entity.Index), [0, 1, 2, 14, 15]);
		g_Assert.deepEqual(g_Filters.GetAllWeapons().map((Weapon) => Weapon.Weapon), ["rifle", "pistol"]);
	} finally {
		g_EntityRecord.ClassName = g_strOriginalEntityClassName;
		g_EntityRecord.Free = g_bOriginalEntityFree;
	}

	const g_unExpectedDocumentationBlockCount = 5;
	const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
	const g_vecBlocks = ExtractJavaScriptBlocks(g_strDocumentation);
	const g_vecDocumentationLogCalls = [];
	const g_LogDocumentationInfo = (...vecArguments) => {
		g_Assert.equal(vecArguments.every((Argument) => (typeof Argument === "string") || (typeof Argument === "number")), true, "Root-filter diagnostics must project native objects to scalar/JSON fields.");
		g_vecDocumentationLogCalls.push(vecArguments);
	};
	const g_DocumentationRequire = CreateDocumentationRequire(g_Filters, g_LogDocumentationInfo);
	let g_unExecutedDocumentationBlockCount = 0;
	g_Assert.equal(g_vecBlocks.length, g_unExpectedDocumentationBlockCount, "filters documentation must contain five executable JavaScript blocks");
	const g_unMessageDeliveryBlockIndex = 3;
	VerifyRecipientMessageContract(g_vecBlocks[g_unMessageDeliveryBlockIndex]);

	for (const strBlock of g_vecBlocks) {
		const RunBlock = new Function("require", "console", strBlock);
		RunBlock(g_DocumentationRequire, g_ConsoleDouble);
		++g_unExecutedDocumentationBlockCount;
	}

	g_Assert.equal(g_unExecutedDocumentationBlockCount, g_vecBlocks.length, "Every root-filter documentation block must execute.");
	const g_unExpectedDocumentationLogCount = 5;
	g_Assert.equal(g_vecDocumentationLogCalls.length, g_unExpectedDocumentationLogCount, "Every root-filter diagnostic must reach the typed logger.");
	const g_vecPlayerDiagnosticValues = g_vecDocumentationLogCalls.filter((vecArguments) => vecArguments[0] === "RootFilterPlayer Index=%d Name=%s Team=%d").map((vecArguments) => vecArguments.slice(1));
	g_Assert.deepEqual(g_vecPlayerDiagnosticValues, [[1, "Ren", 2], [2, "Coach", 2]], "Player diagnostics must contain current scalar fields, not retained facades.");

	const g_unMinimumScannerCallCount = 2;
	const g_unMinimumRecipientScannerCallCount = 3;
	g_Assert.ok(g_vecNativeCalls.filter((strName) => strName === "GetAllPlayers").length >= g_unMinimumScannerCallCount, "players documentation must execute the scanner");
	g_Assert.ok(g_vecNativeCalls.filter((strName) => strName === "GetAllEntities").length >= g_unMinimumScannerCallCount, "entities documentation must execute the scanner");
	g_Assert.ok(g_vecNativeCalls.filter((strName) => strName === "GetAllRecipients").length >= g_unMinimumRecipientScannerCallCount, "recipients documentation must execute the scanner");
	g_Assert.ok(g_vecNativeCalls.filter((strName) => strName === "GetAllWeapons").length >= g_unMinimumScannerCallCount, "weapons documentation must execute the scanner");
	g_Assert.deepEqual(g_vecSentMessages, [{ Message: "SourceJS configuration reloaded.", Options: { Chat: true }, RecipientIndexes: [1] }]);

	for (const strExportName of Object.keys(g_NativeFilters)) {
		g_Assert.match(g_strDocumentation, new RegExp(`\\b${strExportName}\\b`), `documentation must cover ${strExportName}`);
	}

	for (const strRequiredTerm of [
		"UserID",
		"NetworkID",
		"RemoteAddress",
		"RecipientIndexes",
		"Weapon",
		"point-in-time",
	]) {
		g_Assert.match(g_strDocumentation, new RegExp(strRequiredTerm), `documentation must describe ${strRequiredTerm}`);
	}

	for (const strForbiddenTerm of [
		"Generated by",
		"generate_api_docs",
		"console.log(result)",
		"networkId",
		"steamId",
		"uniqueId",
		"userid",
	]) {
		g_Assert.equal(g_strDocumentation.includes(strForbiddenTerm), false, `documentation must not contain ${strForbiddenTerm}`);
	}

	g_Assert.doesNotMatch(g_strDocumentation, /\bconsole\./, "Executable root-filter documentation must use typed logging.");

	const g_strNativeBindings = g_FileSystem.readFileSync(g_strNativeBindingsPath, "utf8");
	VerifyPlayerContractDocumentation(g_strDocumentation, g_strNativeBindings);
	g_Assert.match(g_strNativeBindings, /constexpr PlayerLivePropertyBinding kPlayerLivePropertyBindings\[\] = \{/);

	for (const strCanonicalField of ["Name", "UserID", "NetworkID", "RemoteAddress"]) {
		g_Assert.match(g_strNativeBindings, new RegExp(`\\{ "${strCanonicalField}",`), `native player records must expose ${strCanonicalField}`);
	}

	for (const strRemovedField of ["userid", "networkId", "steamId", "uniqueId"]) {
		g_Assert.equal(g_strNativeBindings.includes(`LocalObject, "${strRemovedField}"`), false, `native player records must not expose ${strRemovedField}`);
	}

	// Keep the missing-native check independent of NODE_PATH and stale runtime caches.
	delete require.cache[g_strPackagePath];
	delete require.cache[g_strRuntimePath];
	delete globalThis.sourcejs;
	g_Module._load = LoadRuntimeModule;

	g_Assert.throws(() => require(g_strPackagePath), (ErrorValue) => (ErrorValue instanceof Error) && (ErrorValue.constructor === Error) && (ErrorValue.message === "SourceJS native runtime is not installed."), "Missing native bridge must not be mistaken for module-resolution failure.");
	g_Module._load = g_OriginalModuleLoad;

	console.log("[  OK  ] filters root facade/documentation and typed missing-runtime contracts passed with live record/message doubles; native SDK execution not exercised");
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
