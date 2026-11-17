#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strPlayersBaseClientDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "players-baseclient.md");

const g_unDocumentationTimeoutMilliseconds = 1000;
const g_unDocumentationCodeBlockCount = 8;
const g_unBaseClientAddress = 0x12345678n;
const g_unWideClientAddress = 0x123456789ABCDEFn;
const g_unSetNameVirtualFunctionIndex = 16;
const g_DocumentationBlockIndexes = { RootImport: 0, CustomType: 4, LiveClient: 5 };

// Bounds synchronous JavaScript only; this is not a security sandbox or native-IO cancellation.
function RunDocumentationFunction(Callback, Receiver, vecArguments, strLabel) {
	const Script = new g_VM.Script("Reflect.apply(Callback, Receiver, vecArguments)", { filename: `${g_strPlayersBaseClientDocumentationPath}:${strLabel}` });

	return Script.runInNewContext({ Callback, Receiver, vecArguments, Reflect }, { timeout: g_unDocumentationTimeoutMilliseconds });
}

function GetPackagePath(strName) {
	return g_Path.join(g_strPackageRootPath, `${strName}.js`);
}

function LoadIsolatedPackage(strName, mapDependencies) {
	const strFilePath = GetPackagePath(strName);
	const ModuleRecord = { exports: {} };
	const Context = g_VM.createContext({
		Error,
		RangeError,
		ReferenceError,
		TypeError,
		module: ModuleRecord,
		exports: ModuleRecord.exports,

		require(strDependencyName) {
			if (!mapDependencies.has(strDependencyName)) {
				throw new Error(`Unexpected ${strName} dependency: ${strDependencyName}`);
			}

			return mapDependencies.get(strDependencyName);
		},
	});

	const Script = new g_VM.Script(g_FileSystem.readFileSync(strFilePath, "utf8"), { filename: strFilePath });
	Script.runInContext(Context, { timeout: g_unDocumentationTimeoutMilliseconds });

	return ModuleRecord.exports;
}

class CustomType {
}

const g_Player = {
	Index: 1,

	IsConnected() {
		return true;
	},
};

const g_ServerClient = { Index: 0, Name: "Alice", Address: 0x23456789n };

const g_vecDependencyCalls = [];
const g_mapRecords = new Map([
	["csgo", { Size: 0x10, VirtualFunction: { SetName: { Offset: g_unSetNameVirtualFunctionIndex } } }],
	["l4d2", { Size: 0x0C, VirtualFunction: { SetName: { Offset: g_unSetNameVirtualFunctionIndex } } }],
]);

function SelectBranch(strBranch) {
	return strBranch ?? "l4d2";
}

const g_GameData = {
	ClearGameDataCache() {
		g_vecDependencyCalls.push(["ClearGameDataCache"]);

		return true;
	},

	HasGameData(strKind, strFileName, strBranch) {
		g_vecDependencyCalls.push(["HasGameData", strKind, strFileName, strBranch]);

		return g_mapRecords.has(SelectBranch(strBranch));
	},

	LoadGameData(strKind, strFileName, strBranch) {
		g_vecDependencyCalls.push(["LoadGameData", strKind, strFileName, strBranch]);

		return g_mapRecords.get(SelectBranch(strBranch));
	},

	GetGameDataPaths(strKind, strFileName, strBranch) {
		g_vecDependencyCalls.push(["GetGameDataPaths", strKind, strFileName, strBranch]);

		return [`${strKind}/${SelectBranch(strBranch)}/${strFileName}`];
	},
};

const g_Manager = {
	CreateTypeFromObject(strTypeName, TypeDefinition, BaseType) {
		g_vecDependencyCalls.push(["CreateTypeFromObject", strTypeName, TypeDefinition, BaseType]);

		return class BaseClient extends BaseType {
			get SetName() {
				const unClientAddress = this.Address;
				g_Assert.equal(typeof unClientAddress, "bigint", "virtual member getter needs a live instance address, not the prototype");

				return {
					Call(strName) {
						g_Assert.equal(typeof strName, "string", "SetName native string argument");

						g_vecDependencyCalls.push(["SetName", unClientAddress, strName]);
						g_ServerClient.Name = strName;
					},
				};
			}
		};
	},
};

const g_Memory = {
	MakeObject(TypeConstructor, unAddress) {
		g_vecDependencyCalls.push(["MakeObject", TypeConstructor, unAddress]);

		const Instance = Object.create(TypeConstructor.prototype);
		Instance.Address = unAddress;

		return Instance;
	},
};

const g_MemoryManager = { BRANCH: "l4d2", CustomType, Manager: g_Manager };
const g_mapDependencies = new Map([
	["memory", g_Memory],
	["memory/gamedata", g_GameData],
	["memory/manager", g_MemoryManager],
]);
const g_PlayersBaseClient = LoadIsolatedPackage("players/baseclient", g_mapDependencies);

g_Assert.ok(g_PlayersBaseClient.HasBaseClientGameData("csgo"), "BaseClient data presence");
g_Assert.ok(!g_PlayersBaseClient.HasBaseClientGameData("tf2"), "BaseClient missing data presence");
g_Assert.throws(() => g_PlayersBaseClient.CreateBaseClientType("tf2"), /CBaseClient GameData is not available/, "missing BaseClient data must fail before creating an empty type.");
g_Assert.equal(g_PlayersBaseClient.GetBaseClientGameDataPaths("csgo")[0], "client/csgo/CBaseClient.ini", "BaseClient data path");
g_Assert.ok(g_PlayersBaseClient.LoadBaseClientGameData("csgo") === g_mapRecords.get("csgo"), "BaseClient data must remain live.");

const g_CSGOType = g_PlayersBaseClient.CreateBaseClientType("csgo");
g_Assert.ok(g_CSGOType.prototype instanceof CustomType, "created BaseClient type base class");
g_Assert.ok(g_PlayersBaseClient.GetBaseClientType("csgo") === g_CSGOType, "same branch must reuse the cached type.");

const g_L4D2Type = g_PlayersBaseClient.GetBaseClientType("l4d2");
g_Assert.ok(g_L4D2Type !== g_CSGOType, "a different branch must rebuild the type.");
g_Assert.equal(g_vecDependencyCalls.filter((vecCall) => vecCall[0] === "CreateTypeFromObject").length, 2, "type creation count");

const g_Instance = g_PlayersBaseClient.CreateBaseClientFromAddress(g_unBaseClientAddress, "l4d2");
g_Assert.equal(g_Instance.Address, g_unBaseClientAddress, "BigInt BaseClient address");
g_Assert.ok(g_Instance instanceof g_L4D2Type, "CreateBaseClientFromAddress uses the branch type.");
g_Assert.ok(g_PlayersBaseClient.ClearBaseClientCache(), "BaseClient cache clear");
g_Assert.ok(g_vecDependencyCalls.some((vecCall) => vecCall[0] === "ClearGameDataCache"), "BaseClient must clear GameData cache.");
g_Assert.ok(!Object.hasOwn(g_PlayersBaseClient, "moduleName"), "BaseClient must not expose moduleName.");
g_Assert.ok(!Object.hasOwn(g_PlayersBaseClient, "default"), "BaseClient must not expose a default alias.");

const g_vecExpectedExports = [
	"ClearBaseClientCache",
	"CreateBaseClientType",
	"CreateBaseClientFromAddress",
	"GetBaseClientGameDataPaths",
	"GetBaseClientType",
	"HasBaseClientGameData",
	"LoadBaseClientGameData",
].sort();
g_Assert.deepEqual(Object.keys(g_PlayersBaseClient).sort(), g_vecExpectedExports, "BaseClient exact exports");

const g_strSourceDataRootPath = g_Path.join(g_strRepositoryRootPath, "packaging", "runtime", "addons", "sourcejs", "data", "sourcejs");
const g_PackagedGameData = LoadIsolatedPackage("memory/gamedata", new Map([
	["filesystem", {
		DoesFileExist: g_FileSystem.existsSync,

		ReadTextFile(strFilePath) {
			return g_FileSystem.readFileSync(strFilePath, "utf8");
		},
	}],
	["globals", {
		GetGlobalVariables() {
			return { SDKBranch: "csgo" };
		},
	}],
	["paths", { SOURCE_DATA_ROOT: g_strSourceDataRootPath }],
]));
const g_PackagedBaseClient = LoadIsolatedPackage("players/baseclient", new Map([
	["memory", g_Memory],
	["memory/gamedata", g_PackagedGameData],
	["memory/manager", g_MemoryManager],
]));

function VerifyCanonicalBaseClientProfile(strSDKBranch) {
	const strGameDataFilePath = g_Path.join(g_strSourceDataRootPath, "client", strSDKBranch, "CBaseClient.ini");
	g_Assert.ok(g_PackagedBaseClient.GetBaseClientGameDataPaths(strSDKBranch).some((strFilePath) => g_Path.resolve(strFilePath) === strGameDataFilePath), `${strSDKBranch} profile must participate in the actual GameData lookup`);

	const strGameDataText = g_FileSystem.readFileSync(strGameDataFilePath, "utf8");
	const vecDescriptorNames = [...strGameDataText.matchAll(/^\t*(?:\[+([A-Za-z_][A-Za-z0-9_]*)\]+|([A-Za-z_][A-Za-z0-9_]*)\s*=)/gm)].map((vecMatch) => vecMatch[1] ?? vecMatch[2]);
	g_Assert.ok(vecDescriptorNames.length >= 5, `${strSDKBranch} BaseClient descriptor names must remain visible`);

	for (const strDescriptorName of vecDescriptorNames) {
		g_Assert.match(strDescriptorName, /^[A-Z][A-Za-z0-9]*$/, `${strSDKBranch} packaged descriptors must already be PascalCase`);
	}

	const BaseClientDefinition = g_PackagedBaseClient.LoadBaseClientGameData(strSDKBranch);
	const SetNameDefinition = BaseClientDefinition.VirtualFunction.SetName;
	g_Assert.equal(SetNameDefinition.Arguments, "string", `${strSDKBranch} SetName must use the canonical compact type name`);

	for (const strFieldName of ["OffsetLinux", "OffsetWindows"]) {
		const unVTableIndex = SetNameDefinition[strFieldName];
		g_Assert.ok(Number.isInteger(unVTableIndex) && (unVTableIndex >= 0), `${strSDKBranch} ${strFieldName} must remain a nonnegative integer vtable index`);
	}
}

VerifyCanonicalBaseClientProfile("bms");
VerifyCanonicalBaseClientProfile("csgo");
VerifyCanonicalBaseClientProfile("gmod");
VerifyCanonicalBaseClientProfile("l4d2");
VerifyCanonicalBaseClientProfile("orangebox");

g_Assert.equal(g_PackagedBaseClient.HasBaseClientGameData(), true, "actual GameData default SDK lookup");
g_Assert.ok(g_PackagedBaseClient.GetBaseClientGameDataPaths("csgo").some((strFilePath) => g_FileSystem.existsSync(strFilePath)), "actual packaged GameData paths");
g_Assert.ok(Object.keys(g_PackagedBaseClient.LoadBaseClientGameData("csgo")).length > 0, "actual packaged GameData parsing");
g_Assert.deepEqual(Object.keys(g_PackagedBaseClient).sort(), g_vecExpectedExports, "actual GameData integration preserves the public API");

for (const strLegacyExport of ["ClearCache", "Has", "Load", "Paths"]) {
	g_Assert.equal(Object.hasOwn(g_PackagedGameData, strLegacyExport), false, `actual GameData does not restore ${strLegacyExport}`);
}

const g_PackagedBaseClientType = g_PackagedBaseClient.GetBaseClientType("csgo");
g_Assert.equal(g_PackagedBaseClient.GetBaseClientType("csgo"), g_PackagedBaseClientType, "actual GameData type cache reuse");
g_Assert.equal(g_PackagedBaseClient.CreateBaseClientFromAddress(g_unWideClientAddress, "csgo").Address, g_unWideClientAddress, "BaseClient BigInt address above the Number exact range");
g_Assert.equal(g_PackagedBaseClient.HasBaseClientGameData("blade"), false, "supported SDK with no BaseClient profile");
g_Assert.throws(() => g_PackagedBaseClient.GetBaseClientType("blade"), ReferenceError, "missing profile is not an empty type");
g_Assert.throws(() => g_PackagedBaseClient.HasBaseClientGameData("missing-sdk"), RangeError, "unsupported SDK is rejected");
g_Assert.equal(g_PackagedBaseClient.GetBaseClientType("csgo"), g_PackagedBaseClientType, "failed lookup preserves the previous cached type");
g_Assert.equal(g_PackagedBaseClient.ClearBaseClientCache(), true, "actual GameData cache clear");
g_Assert.notEqual(g_PackagedBaseClient.GetBaseClientType("csgo"), g_PackagedBaseClientType, "clear forces fresh type creation");

function CheckDocumentationVirtualClientCalls(strDocumentation) {
	const vecExamples = [...strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);
	g_Assert.equal(vecExamples.length, g_unDocumentationCodeBlockCount, "base-client documentation example inventory");

	const vecScenarios = [
		"SUCCESS",
		"APPLYTHROW",
		"APPLYNULL",
		"APPLYMISMATCH",
		"RESTORETHROW",
		"RESTORENULL",
		"RESTOREMISMATCH",
		"BOTHTHROW",
		"NULLBOTHTHROW",
		"APPLYMISMATCHRESTORETHROW",
		"NOCONNECTEDPLAYER",
		"MISSINGPROFILE",
		"NULLSERVER",
		"NULLCLIENT",
		"NUMBERADDRESS",
		"ZEROADDRESS",
		"WRONGSLOT",
		"INVALIDPREVIOUSNAME",
		"WRONGVIEWADDRESS",
		"NULLVIEW",
		"MISSINGCALL",
	];

	const setBeforeMutationScenarios = new Set([
		"NULLSERVER",
		"NULLCLIENT",
		"NUMBERADDRESS",
		"ZEROADDRESS",
		"WRONGSLOT",
		"INVALIDPREVIOUSNAME",
		"WRONGVIEWADDRESS",
		"NULLVIEW",
		"MISSINGCALL",
	]);
	for (const strScenario of vecScenarios) {
		const vecCalls = [];
		const vecCreatedAddresses = [];
		const OperationError = new Error("rename operation");
		const RestorationError = new Error("rename restoration");
		const unClientAddress = g_unWideClientAddress;
		let strCurrentName = "Alice";
		let unMemberGetterCount = 0;
		const ServerClient = {
			Index: (strScenario === "WRONGSLOT") ? 7 : 0,
			Address: (strScenario === "NUMBERADDRESS") ? 0x04D2 : ((strScenario === "ZEROADDRESS") ? 0n : unClientAddress),

			get Name() {
				return (strScenario === "INVALIDPREVIOUSNAME") ? 42 : strCurrentName;
			},
		};

		const BaseClient = {
			Address: (strScenario === "WRONGVIEWADDRESS") ? (unClientAddress + 0x08n) : unClientAddress,

			get SetName() {
				unMemberGetterCount += 1;

				if (strScenario === "MISSINGCALL") {
					return {};
				}

				return {
					Call(strName) {
						vecCalls.push(strName);
						if (vecCalls.length === 1) {
							if (["APPLYTHROW", "BOTHTHROW"].includes(strScenario)) {
								throw OperationError;
							}

							if (["APPLYNULL", "NULLBOTHTHROW"].includes(strScenario)) {
								throw null;
							}

							strCurrentName = ["APPLYMISMATCH", "APPLYMISMATCHRESTORETHROW"].includes(strScenario) ? "Normalized Guest" : strName;

						} else {
							if (["RESTORETHROW", "BOTHTHROW", "NULLBOTHTHROW", "APPLYMISMATCHRESTORETHROW"].includes(strScenario)) {
								throw RestorationError;
							}

							if (strScenario === "RESTORENULL") {
								throw null;
							}

							strCurrentName = (strScenario === "RESTOREMISMATCH") ? "Normalized Alice" : strName;
						}
					},
				};
			},
		};

		const DocumentationRequire = (strName) => {
			if (strName === "players") {
				return { GetAllPlayers: () => [{ Index: 1, IsConnected: () => strScenario !== "NOCONNECTEDPLAYER" }] };
			}

			if (strName === "engines/server") {
				return {
					GetServer: () => (strScenario === "NULLSERVER") ? null : {
						GetClient(nClientIndex) {
							g_Assert.equal(nClientIndex, 0, "zero-based SDK client slot");

							return (strScenario === "NULLCLIENT") ? null : ServerClient;
						},
					},
				};
			}

			g_Assert.equal(strName, "players/baseclient", "live client documentation dependency");

			return {
				HasBaseClientGameData: () => strScenario !== "MISSINGPROFILE",

				CreateBaseClientFromAddress: (unAddress) => {
					vecCreatedAddresses.push(unAddress);
					g_Assert.equal(unAddress, unClientAddress, "pass an exact BigInt beyond Number's exact range");

					return (strScenario === "NULLVIEW") ? null : BaseClient;
				},
			};
		};

		const Execute = g_VM.compileFunction(`"use strict";\n${vecExamples[g_DocumentationBlockIndexes.LiveClient]}`, ["require"], { filename: `${g_strPlayersBaseClientDocumentationPath}:LiveClient-${strScenario}` });
		let bCaught = false;
		let ErrorValue = null;

		try {
			RunDocumentationFunction(Execute, undefined, [DocumentationRequire], `LiveClient-${strScenario}`);
		} catch (CaughtError) {
			bCaught = true;
			ErrorValue = CaughtError;
		}

		const bSkip = ["NOCONNECTEDPLAYER", "MISSINGPROFILE"].includes(strScenario);
		const bBeforeMutation = setBeforeMutationScenarios.has(strScenario);
		const bFails = !bSkip && (strScenario !== "SUCCESS");
		g_Assert.equal(bCaught, bFails, `live client ${strScenario}: failure visibility`);
		g_Assert.deepEqual(vecCalls, (bSkip || bBeforeMutation) ? [] : ["SourceJS Guest", "Alice"], "every started rename attempts restoration, without treating void as a boolean");

		const bViewStage = ["WRONGVIEWADDRESS", "NULLVIEW", "MISSINGCALL"].includes(strScenario);
		g_Assert.deepEqual(vecCreatedAddresses, (bSkip || (bBeforeMutation && !bViewStage)) ? [] : [unClientAddress], "reject invalid metadata before constructing a native view");

		if (bSkip || (bBeforeMutation && (strScenario !== "MISSINGCALL"))) {
			g_Assert.equal(unMemberGetterCount, 0, "validate metadata before resolving an ABI member getter");
		}

		if (["BOTHTHROW", "NULLBOTHTHROW", "APPLYMISMATCHRESTORETHROW"].includes(strScenario)) {
			g_Assert.ok(ErrorValue instanceof AggregateError, "both failures must survive");
			g_Assert.equal(ErrorValue.errors.length, 2, "rename and restoration error count");
			g_Assert.equal(ErrorValue.errors[1], RestorationError, "restoration error identity");

			if (strScenario === "APPLYMISMATCHRESTORETHROW") {
				g_Assert.ok(ErrorValue.errors[0] instanceof Error, "observable rename mismatch is reported");

			} else {
				g_Assert.equal(ErrorValue.errors[0], (strScenario === "NULLBOTHTHROW") ? null : OperationError, "original exception, including null, is retained");
			}

		} else if (strScenario === "APPLYTHROW") {
			g_Assert.equal(ErrorValue, OperationError, "successful cleanup preserves operation exception");

		} else if (strScenario === "RESTORETHROW") {
			g_Assert.equal(ErrorValue, RestorationError, "restoration exception identity");

		} else if (["APPLYNULL", "RESTORENULL"].includes(strScenario)) {
			g_Assert.equal(ErrorValue, null, "null exception visibility");
		}

		if (["SUCCESS", "APPLYTHROW", "APPLYNULL", "APPLYMISMATCH"].includes(strScenario)) {
			g_Assert.equal(strCurrentName, "Alice", "successful restoration restores the observed name");
		}
	}

	class CustomType {
	}

	const vecNamedCalls = [];

	const CreateBaseClientType = (strSDKBranch, BaseType) => {
		g_Assert.equal(strSDKBranch, undefined, "custom class uses the selected branch");

		return class BaseClient extends BaseType {
			get SetName() {
				g_Assert.equal(typeof this.Address, "bigint", "do not evaluate native getters on a prototype");

				const Call = (strName) => {
					g_Assert.equal(strName, "Controlled Client", "custom Rename forwards through MemberFunction.Call");

					vecNamedCalls.push(strName);
				};

				return { Call };
			}
		};
	};

	const DocumentationRequire = (strName) => (strName === "memory/manager") ? { CustomType } : { CreateBaseClientType, HasBaseClientGameData: () => true };

	const ExecuteType = g_VM.compileFunction(`"use strict";\n${vecExamples[g_DocumentationBlockIndexes.CustomType]}\nreturn g_NamedBaseClientType;`, ["require"], { filename: `${g_strPlayersBaseClientDocumentationPath}:CustomType` });
	const NamedBaseClientType = RunDocumentationFunction(ExecuteType, undefined, [DocumentationRequire], "CustomType:Initialize");
	const Instance = Object.create(NamedBaseClientType.prototype);
	Instance.Address = g_unWideClientAddress;
	let RenameResult = null;
	g_Assert.doesNotThrow(() => {
		RenameResult = RunDocumentationFunction(() => Instance.Rename("Controlled Client"), undefined, [], "CustomType:Rename");
	}, "custom Rename must call the virtual member through Call");
	g_Assert.equal(RenameResult, undefined, "custom Rename forwards the void result");
	g_Assert.deepEqual(vecNamedCalls, ["Controlled Client"], "custom Rename actually invokes the ABI member");
}

const g_strDocumentation = g_FileSystem.readFileSync(g_strPlayersBaseClientDocumentationPath, "utf8");
CheckDocumentationVirtualClientCalls(g_strDocumentation);

const g_vecCodeBlocks = [...g_strDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)].map((vecMatch) => vecMatch[1]);

g_Assert.equal(g_vecCodeBlocks.length, g_unDocumentationCodeBlockCount, "BaseClient documentation workflow count");
g_Assert.ok(!g_strDocumentation.includes("Generated by"), "BaseClient documentation must be maintained by hand.");
g_Assert.ok(!g_strDocumentation.includes("_ZN16CCoreDispSurface4InitEv"), "BaseClient documentation must not wrap an unrelated symbol.");
g_Assert.doesNotMatch(g_strDocumentation, /\bconsole\.[A-Za-z_$]/, "BaseClient documentation must use checked workflows instead of console output.");

const g_vecRootImport = g_vecCodeBlocks[g_DocumentationBlockIndexes.RootImport].match(/const \{([\s\S]*?)\} = require\("players\/baseclient"\);/);
g_Assert.ok(g_vecRootImport, "BaseClient documentation root import.");

const g_vecImportedExports = [...g_vecRootImport[1].matchAll(/^\s*([A-Za-z][A-Za-z0-9]*)(?:\s*:\s*[A-Za-z][A-Za-z0-9_]*)?,$/gm)].map((vecMatch) => vecMatch[1]).sort();
g_Assert.deepEqual(g_vecImportedExports, g_vecExpectedExports, "BaseClient documentation root import must list the exact API.");

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

g_Assert.deepEqual([...g_setDocumentedExports].sort(), g_vecExpectedExports, "BaseClient documentation must list the exact API.");

const g_vecContents = g_strDocumentation.match(/## Contents\r?\n([\s\S]*?)\r?\n## Import/);
g_Assert.ok(g_vecContents, "BaseClient documentation contents section.");

const g_vecContentsAnchors = [...g_vecContents[1].matchAll(/\]\(#([^)]+)\)/g)].map((vecMatch) => vecMatch[1]);
const g_vecSectionAnchors = [...g_strDocumentation.matchAll(/^## (.+)$/gm)].map((vecMatch) => vecMatch[1].toLowerCase().replace(/`/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")).filter((strAnchor) => strAnchor !== "contents");
g_Assert.deepEqual(g_vecContentsAnchors, g_vecSectionAnchors, "BaseClient documentation contents anchors.");

function RequireDocumentationModule(strModuleName) {
	if (strModuleName === "players/baseclient") {
		return g_PlayersBaseClient;
	}

	if (strModuleName === "players") {
		return {
			GetAllPlayers() {
				return [g_Player];
			},
		};
	}

	if (strModuleName === "engines/server") {
		return {
			GetServer() {
				return {
					GetClient(nClientIndex) {
						g_Assert.equal(nClientIndex, 0);

						return g_ServerClient;
					},
				};
			},
		};
	}

	if (g_mapDependencies.has(strModuleName)) {
		return g_mapDependencies.get(strModuleName);
	}

	throw new Error(`Unexpected BaseClient documentation dependency: ${strModuleName}`);
}

function UnloadDocumentationModule(ModuleRecord, bRequired = false) {
	const strRuntimeSource = g_FileSystem.readFileSync(g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "V8Runtime.cpp"), "utf8");
	const vecUnloadDefinition = strRuntimeSource.match(/^\tvoid V8Runtime::UnloadPlugin\([^\r\n]*\) \{[\s\S]*?^\t}/m);
	g_Assert.ok(vecUnloadDefinition, "Native plugin unload definition");
	g_Assert.match(vecUnloadDefinition[0], /CallPluginExportFunction\(strPluginName,\s*"Unload"\)/, "Documentation unload lookup must follow the current exact native export key");

	const ModuleExports = ModuleRecord.exports;
	const Unload = ModuleExports.Unload;
	g_Assert.equal(Object.hasOwn(ModuleExports, "unload"), false, "No lowercase lifecycle alias");

	if (bRequired) {
		g_Assert.equal(typeof Unload, "function", "The cleanup example must export the native unload entry point");
	}

	if (typeof Unload === "function") {
		Reflect.apply(Unload, ModuleExports, []);
	}
}

function ExecuteRootDocumentation(unCodeBlockIndex) {
	const strLabel = `Root-${unCodeBlockIndex + 1}`;
	const ModuleRecord = { exports: {} };
	const Callback = g_VM.compileFunction(g_vecCodeBlocks[unCodeBlockIndex], ["require", "module", "exports"], { filename: `${g_strPlayersBaseClientDocumentationPath}:${strLabel}` });
	const NameDescriptor = Object.getOwnPropertyDescriptor(g_ServerClient, "Name");
	let bFailed = false;
	let Failure = null;

	try {
		RunDocumentationFunction(Callback, undefined, [RequireDocumentationModule, ModuleRecord, ModuleRecord.exports], strLabel);
	} catch (ErrorValue) {
		bFailed = true;
		Failure = ErrorValue;
	}

	const vecCleanupErrors = [];
	for (const Restore of [
		() => RunDocumentationFunction(UnloadDocumentationModule, undefined, [ModuleRecord, unCodeBlockIndex === (g_unDocumentationCodeBlockCount - 1)], `${strLabel}:Unload`),
		() => Object.defineProperty(g_ServerClient, "Name", NameDescriptor),
	]) {
		try {
			Restore();
		} catch (ErrorValue) {
			vecCleanupErrors.push(ErrorValue);
		}
	}

	if (vecCleanupErrors.length > 0) {
		if (!bFailed && (vecCleanupErrors.length === 1)) {
			throw vecCleanupErrors[0];
		}

		if (bFailed) {
			vecCleanupErrors.unshift(Failure);
		}

		throw new AggregateError(vecCleanupErrors, "BaseClient documentation cleanup failed.");
	}

	if (bFailed) {
		throw Failure;
	}
}

for (let unCodeBlockIndex = 0; unCodeBlockIndex < g_vecCodeBlocks.length; ++unCodeBlockIndex) {
	ExecuteRootDocumentation(unCodeBlockIndex);
}

const g_strDocumentationWithoutCode = g_strDocumentation.replace(/```[\s\S]*?```/g, "");
const g_vecLinks = [...g_strDocumentationWithoutCode.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((vecMatch) => vecMatch[1]);
for (const strTarget of g_vecLinks) {
	if (strTarget.startsWith("#") || /^[a-z]+:/i.test(strTarget)) {
		continue;
	}

	const strTargetPath = g_Path.resolve(g_Path.dirname(g_strPlayersBaseClientDocumentationPath), strTarget.split("#", 1)[0]);
	g_Assert.ok(g_FileSystem.existsSync(strTargetPath), `BaseClient documentation link must exist: ${strTarget}`);
}

g_Assert.ok(g_vecDependencyCalls.some((vecCall) => (vecCall[0] === "SetName") && (vecCall[1] === g_ServerClient.Address)), "CreateBaseClientFromAddress example calls the generated method fixture.");

console.log("[smoke_players_base_client] package, real GameData/packaged INI, and documentation passed; native construction/calls mocked");
