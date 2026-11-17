#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strDocumentationPath = g_Path.join(g_strProjectRoot, "docs", "api", "entities-helpers.md");
const g_strEntityHelpersPath = g_Path.join(g_strProjectRoot, "packages", "sourcejs", "entities", "helpers.js");
const g_strRuntimePath = g_Path.join(g_strProjectRoot, "packages", "sourcejs", "internal", "runtime.js");
const g_strNativeSourcePath = g_Path.join(g_strProjectRoot, "src", "sourcejs", "modules", "ModuleBindings.cpp");
const g_vecExpectedExports = [
	"FindEntityOutputNameByAddress",
	"GetBaseEntityFromBaseHandle",
	"GetBaseEntityFromEdict",
	"GetBaseEntityFromEntityIndex",
	"GetBaseEntityFromEntityAddress",
	"GetBaseEntityFromIntegerHandle",
	"GetBaseHandleFromBaseEntity",
	"GetBaseHandleFromEdict",
	"GetBaseHandleFromEntityIndex",
	"GetBaseHandleFromEntityAddress",
	"GetBaseHandleFromIntegerHandle",
	"GetEdictFromBaseEntity",
	"GetEdictFromBaseHandle",
	"GetEdictFromEntityIndex",
	"GetEdictFromEntityAddress",
	"GetEdictFromIntegerHandle",
	"GetEntityIndex",
	"GetEntityIndexFromBaseEntity",
	"GetEntityIndexFromBaseHandle",
	"GetEntityIndexFromEdict",
	"GetEntityIndexFromEntityAddress",
	"GetEntityIndexFromIntegerHandle",
	"GetEntityAddressFromBaseEntity",
	"GetEntityAddressFromBaseHandle",
	"GetEntityAddressFromEdict",
	"GetEntityAddressFromEntityIndex",
	"GetEntityAddressFromIntegerHandle",
	"GetIntegerHandleFromBaseEntity",
	"GetIntegerHandleFromBaseHandle",
	"GetIntegerHandleFromEdict",
	"GetIntegerHandleFromEntityIndex",
	"GetIntegerHandleFromEntityAddress",
	"IsEntityValid",
];

class DocumentationCommand {
	constructor(Payload) {
		this.Arguments = Payload.Arguments.slice();
	}

	GetArgument(unIndex) {
		return this.Arguments[unIndex];
	}

	get Length() {
		return this.Arguments.length;
	}
}

const g_unUnsignedIntegerMaximum = 0xFFFFFFFF;
const g_unHandleEntryMultiplier = 0x1000;
// Controlled fixtures use a 32-bit address range and synthetic handle packing.
// This is not a host/SDK ABI or a complete native-conversion model.
const g_unAddressMaximum = 0xFFFFFFFFn;
const g_unAddressBase = 0x200000n;
const g_unEdictAddressBase = 0x300000n;
const g_unEntityAddressStride = 0x100n;
const g_unEdictAddressStride = 0x40n;
const g_unOutputRecordAddressBase = 0x500000n;
const g_unOutputFieldOffset = 0x90;
const g_unFixtureSerialBase = 100;

const g_mapEntityStates = new Map();
const g_mapAddressIndexes = new Map();
const g_mapEdictAddressIndexes = new Map();
const g_mapServerCommands = new Map();
const g_vecNativeCalls = [];

function RequireUnsignedInteger(unValue, strOperationName, unMaximum = g_unUnsignedIntegerMaximum) {
	if (!Number.isSafeInteger(unValue) || (unValue < 0) || (unValue > unMaximum)) {
		throw new TypeError(`${strOperationName} expects an unsigned integer.`);
	}

	return unValue;
}

function RequireAddress(unValue, strOperationName) {
	if ((typeof unValue !== "bigint") || (unValue < 0n) || (unValue > g_unAddressMaximum)) {
		throw new TypeError(`${strOperationName} expects an unsigned BigInt address within the native uintptr_t range.`);
	}

	return unValue;
}

function EncodeHandle(unIndex, unSerialNumber) {
	return unSerialNumber * g_unHandleEntryMultiplier + unIndex;
}

function DecodeHandle(unValue) {
	const unHandle = RequireUnsignedInteger(unValue, "entity handle", g_unUnsignedIntegerMaximum);

	return { EntryIndex: unHandle % g_unHandleEntryMultiplier, SerialNumber: Math.floor(unHandle / g_unHandleEntryMultiplier), Value: unHandle };
}

function InstallEntity(unIndex, Options = {}) {
	const unSerialNumber = Options.SerialNumber ?? (g_unFixtureSerialBase + unIndex);
	const unAddress = Options.Address ?? (g_unAddressBase + BigInt(unIndex) * g_unEntityAddressStride + BigInt(unSerialNumber));
	const unEdictAddress = Options.EdictAddress ?? (g_unEdictAddressBase + BigInt(unIndex) * g_unEdictAddressStride);
	const State = {
		ClassName: Options.ClassName ?? "info_target",
		EdictAddress: unEdictAddress,
		Free: false,
		Index: unIndex,
		Outputs: Options.Outputs ?? [
			{
				ExternalName: "OnUser1",
				Output: true,
				Name: "m_OnUser1",
				Offset: g_unOutputFieldOffset,
				Address: g_unOutputRecordAddressBase + BigInt(unIndex) * g_unEntityAddressStride,
			},
		],
		Address: unAddress,
		SerialNumber: unSerialNumber,
	};

	g_mapEntityStates.set(unIndex, State);
	g_mapAddressIndexes.set(unAddress, unIndex);
	g_mapEdictAddressIndexes.set(unEdictAddress, unIndex);

	return State;
}

function RemoveEntity(unIndex) {
	const State = g_mapEntityStates.get(unIndex);
	if (!State || State.Free) {
		return false;
	}

	State.Free = true;
	g_mapAddressIndexes.delete(State.Address);
	g_mapEdictAddressIndexes.delete(State.EdictAddress);

	return true;
}

function GetLiveState(nEntityIndex, strOperationName) {
	if (!Number.isInteger(nEntityIndex)) {
		throw new TypeError(`${strOperationName} expects an integer entity index.`);
	}

	const State = g_mapEntityStates.get(nEntityIndex);
	if (!State || State.Free) {
		throw new Error(`${strOperationName} could not resolve a live entity.`);
	}

	return State;
}

function ResolveLiveState(nEntityIndex, strOperationName) {
	if (nEntityIndex === undefined) {
		throw new Error(`${strOperationName} could not resolve a live entity.`);
	}

	return GetLiveState(nEntityIndex, strOperationName);
}

function GetEntityIndex(Value) {
	if (Number.isInteger(Value)) {
		return Value;
	}

	if (Value && (typeof Value === "object") && Number.isInteger(Value.Index)) {
		return Value.Index;
	}

	return -1;
}

function IsEntityValid(Value) {
	const nIndex = GetEntityIndex(Value);
	const State = g_mapEntityStates.get(nIndex);

	return Boolean(State && !State.Free);
}

function RequireRecord(Value, strKind, strPropertyName, strOperationName) {
	if (!Value || (typeof Value !== "object") || Array.isArray(Value)) {
		throw new TypeError(`${strOperationName} expects a ${strKind} record.`);
	}

	const strKindProperty = "Kind";
	if (!Object.hasOwn(Value, strKindProperty) || !Object.hasOwn(Value, strPropertyName) || (Value[strKindProperty] !== strKind)) {
		throw new TypeError(`${strOperationName} expects an own ${strKind} identity.`);
	}

	return (strPropertyName === "Value") ? RequireUnsignedInteger(Value[strPropertyName], strOperationName) : RequireAddress(Value[strPropertyName], strOperationName);
}

function GetIndexFromHandle(unValue, strOperationName) {
	const Handle = DecodeHandle(unValue);
	const State = GetLiveState(Handle.EntryIndex, strOperationName);
	if (State.SerialNumber !== Handle.SerialNumber) {
		throw new Error(`${strOperationName} could not resolve a live entity.`);
	}

	return State.Index;
}

function GetIndexFromRepresentation(Value, strSourceName, strOperationName) {
	switch (strSourceName) {
		case "Index":
			return GetLiveState(Value, strOperationName).Index;

		case "Edict": {
			const unEdictAddress = RequireRecord(Value, "edict", "Address", strOperationName);
			const unEntityIndex = g_mapEdictAddressIndexes.get(unEdictAddress);
			return ResolveLiveState(unEntityIndex, strOperationName).Index;
		}

		case "BaseEntity": {
			const unAddress = RequireRecord(Value, "baseentity", "Address", strOperationName);
			const unEntityIndex = g_mapAddressIndexes.get(unAddress);
			return ResolveLiveState(unEntityIndex, strOperationName).Index;
		}

		case "BaseHandle": {
			const unHandleValue = RequireRecord(Value, "basehandle", "Value", strOperationName);
			return GetIndexFromHandle(unHandleValue, strOperationName);
		}

		case "IntegerHandle":
			return GetIndexFromHandle(Value, strOperationName);

		case "Address": {
			const unAddress = RequireAddress(Value, strOperationName);
			const unEntityIndex = g_mapAddressIndexes.get(unAddress);
			return ResolveLiveState(unEntityIndex, strOperationName).Index;
		}

		default:
			throw new Error(`Unknown entity-helper source: ${strSourceName}`);
	}
}

function MakeEdictRecord(State) {
	return { ClassName: State.ClassName, Index: State.Index, Kind: "edict", Address: State.EdictAddress };
}

function MakeBaseEntityRecord(State) {
	return { ClassName: State.ClassName, Index: State.Index, Kind: "baseentity", Address: State.Address };
}

function MakeBaseHandleRecord(State) {
	return { EntryIndex: State.Index, Kind: "basehandle", SerialNumber: State.SerialNumber, Valid: true, Value: EncodeHandle(State.Index, State.SerialNumber) };
}

function GetResultFromState(State, strResultName) {
	switch (strResultName) {
		case "Index":
			return State.Index;

		case "Edict":
			return MakeEdictRecord(State);

		case "BaseEntity":
			return MakeBaseEntityRecord(State);

		case "BaseHandle":
			return MakeBaseHandleRecord(State);

		case "IntegerHandle":
			return EncodeHandle(State.Index, State.SerialNumber);

		case "Address":
			return State.Address;

		default:
			throw new Error(`Unknown entity-helper result: ${strResultName}`);
	}
}

function CreateConversion(strSourceName, strResultName) {
	const ConversionNames = {
		BaseEntityFromBaseHandle: "GetBaseEntityFromBaseHandle",
		BaseEntityFromEdict: "GetBaseEntityFromEdict",
		BaseEntityFromIndex: "GetBaseEntityFromEntityIndex",
		BaseEntityFromIntegerHandle: "GetBaseEntityFromIntegerHandle",
		BaseEntityFromAddress: "GetBaseEntityFromEntityAddress",
		BaseHandleFromBaseEntity: "GetBaseHandleFromBaseEntity",
		BaseHandleFromEdict: "GetBaseHandleFromEdict",
		BaseHandleFromIndex: "GetBaseHandleFromEntityIndex",
		BaseHandleFromIntegerHandle: "GetBaseHandleFromIntegerHandle",
		BaseHandleFromAddress: "GetBaseHandleFromEntityAddress",
		EdictFromBaseEntity: "GetEdictFromBaseEntity",
		EdictFromBaseHandle: "GetEdictFromBaseHandle",
		EdictFromIndex: "GetEdictFromEntityIndex",
		EdictFromIntegerHandle: "GetEdictFromIntegerHandle",
		EdictFromAddress: "GetEdictFromEntityAddress",
		IndexFromBaseEntity: "GetEntityIndexFromBaseEntity",
		IndexFromBaseHandle: "GetEntityIndexFromBaseHandle",
		IndexFromEdict: "GetEntityIndexFromEdict",
		IndexFromIntegerHandle: "GetEntityIndexFromIntegerHandle",
		IndexFromAddress: "GetEntityIndexFromEntityAddress",
		IntegerHandleFromBaseEntity: "GetIntegerHandleFromBaseEntity",
		IntegerHandleFromBaseHandle: "GetIntegerHandleFromBaseHandle",
		IntegerHandleFromEdict: "GetIntegerHandleFromEdict",
		IntegerHandleFromIndex: "GetIntegerHandleFromEntityIndex",
		IntegerHandleFromAddress: "GetIntegerHandleFromEntityAddress",
		AddressFromBaseEntity: "GetEntityAddressFromBaseEntity",
		AddressFromBaseHandle: "GetEntityAddressFromBaseHandle",
		AddressFromEdict: "GetEntityAddressFromEdict",
		AddressFromIndex: "GetEntityAddressFromEntityIndex",
		AddressFromIntegerHandle: "GetEntityAddressFromIntegerHandle",
	};
	const strOperationName = ConversionNames[`${strResultName}From${strSourceName}`];

	return function ConvertEntityIdentity(EntityReference) {
		g_vecNativeCalls.push(strOperationName);
		const unEntityIndex = GetIndexFromRepresentation(EntityReference, strSourceName, strOperationName);

		return GetResultFromState(GetLiveState(unEntityIndex, strOperationName), strResultName);
	};
}

function FindEntityOutputNameByAddress(EntityReference, unEntityOutputAddress) {
	g_vecNativeCalls.push("FindEntityOutputNameByAddress");
	const nEntityIndex = GetEntityIndex(EntityReference);
	const State = GetLiveState(nEntityIndex, "FindEntityOutputNameByAddress");

	RequireAddress(unEntityOutputAddress, "FindEntityOutputNameByAddress");

	if (unEntityOutputAddress === 0n) {
		throw new TypeError("FindEntityOutputNameByAddress expects a non-zero BigInt output address.");
	}

	const Output = State.Outputs.find((Field) => (State.Address + BigInt(Field.Offset)) === unEntityOutputAddress);

	return Output?.ExternalName || null;
}

function Entity(nEntityIndex) {
	const State = GetLiveState(nEntityIndex, "Entity");

	return {
		ClassName: State.ClassName,
		GetEntityOutputs() {
			return State.Outputs.map((Output) => ({ ...Output }));
		},
		Index: State.Index,
		Address: State.Address,
	};
}

function RegisterServerCommand(NameValue, Callback) {
	if (typeof Callback !== "function") {
		throw new TypeError("commands/server.RegisterCommand(strCommandName, Callback) expects a function callback.");
	}

	const strCommandName = String(NameValue);
	if (strCommandName.length === 0) {
		return false;
	}

	g_mapServerCommands.set(strCommandName, Callback);

	return true;
}

function UnregisterServerCommand(NameValue, Callback) {
	const strCommandName = String(NameValue);
	if (!g_mapServerCommands.has(strCommandName) || ((typeof Callback === "function") && (g_mapServerCommands.get(strCommandName) !== Callback))) {
		return false;
	}

	g_mapServerCommands.delete(strCommandName);

	return true;
}

function ExtractJavaScriptBlocks(strMarkdown) {
	return Array.from(strMarkdown.matchAll(/```js\r?\n([\s\S]*?)```/g), (vecMatch) => vecMatch[1]);
}

function TrackModule(ModuleExports, setExercisedExports) {
	const TrackedExports = {};
	for (const [strName, Value] of Object.entries(ModuleExports)) {
		Object.defineProperty(TrackedExports, strName, {
			enumerable: true,
			get() {
				setExercisedExports.add(strName);

				return Value;
			},
		});
	}

	return TrackedExports;
}

function ExecuteDocumentationBlock(strSource, unBlockIndex, Modules) {
	const Script = new g_VM.Script(`(function (require, module, exports, console) {\n${strSource}\n})`, { filename: `entities-helpers.md:block-${unBlockIndex + 1}` });
	const Callback = Script.runInNewContext({});
	const PluginModule = { exports: {} };
	const DocumentationRequire = (strModuleName) => {
		if (!Object.hasOwn(Modules, strModuleName)) {
			throw new Error(`Undeclared documentation module: ${strModuleName}`);
		}

		return Modules[strModuleName];
	};
	const DocumentationConsole = {
		log() {
			throw new Error("Entity helper documentation must use the typed logger.");
		},
	};
	const setRegisteredCommands = new Set(g_mapServerCommands.keys());

	Callback(DocumentationRequire, PluginModule, PluginModule.exports, DocumentationConsole);

	for (const [strName, CommandCallback] of g_mapServerCommands) {
		if (!setRegisteredCommands.has(strName)) {
			const vecCommandArguments = [strName, "1"];
			g_Assert.equal(CommandCallback({
				Arguments: vecCommandArguments,
				Index: 1,
				Kind: "server",
				Message: "",
				Name: strName,
				Raw: vecCommandArguments.join(" "),
				TeamOnly: false,
			}), 2);
		}
	}

	g_Assert.equal(Object.hasOwn(PluginModule.exports, "unload"), false, "Documentation must not export the obsolete lowercase lifecycle.");

	if (typeof PluginModule.exports.Unload === "function") {
		PluginModule.exports.Unload();
	}

	g_Assert.deepEqual(Array.from(g_mapServerCommands.keys()), Array.from(setRegisteredCommands), "A documentation plugin left server commands registered after unload.");
}

g_Assert.throws(() => ExecuteDocumentationBlock('console.log("unexpected");', 0, {}), /Entity helper documentation must use the typed logger\./);
g_Assert.throws(() => ExecuteDocumentationBlock("module.exports.unload = () => {};", 0, {}), /Documentation must not export the obsolete lowercase lifecycle/);

function ValidateEntityHelperDocumentationLog(strFormat, Result) {
	g_Assert.match(strFormat, /^[A-Z][A-Za-z]+ Result=%j$/);
	g_Assert.doesNotThrow(() => JSON.stringify(Result));
}

function VerifyEntityIdentityLoggingDocumentation(vecBlocks) {
	// Serialization adapters only, not liveness, native address-width, or SDK handle-packing validation.
	const vecOperations = ["ReportEntityIdentities", "ReportEdictConversions", "ReportBaseEntityConversions", "InspectEntityCommand"];
	for (const unAddress of [0n, 0xFEDCBA9876543210n, 0xFFFFFFFFFFFFFFFFn]) {
		const BaseEntity = { Kind: "baseentity", Address: unAddress, Index: 1, ClassName: "FixtureEntity" };
		const Edict = { Kind: "edict", Address: unAddress, Index: 1, ClassName: "FixtureEntity" };
		const BaseHandle = { Kind: "basehandle", Value: 0x80000001, EntryIndex: 1, SerialNumber: 0x80000, Valid: true };
		const EntityHelpers = {
			GetBaseHandleFromEntityIndex: () => BaseHandle,
			GetEntityAddressFromEntityIndex: () => unAddress,
			GetIntegerHandleFromEntityIndex: () => BaseHandle.Value,
			IsEntityValid: () => true,
		};
		for (const strSourceName of ["EntityIndex", "Edict", "BaseEntity", "BaseHandle", "IntegerHandle", "EntityAddress"]) {
			if (strSourceName !== "BaseEntity") {
				EntityHelpers[`GetBaseEntityFrom${strSourceName}`] = () => BaseEntity;
			}

			if (strSourceName !== "Edict") {
				EntityHelpers[`GetEdictFrom${strSourceName}`] = () => Edict;
			}
		}

		for (const strOperation of vecOperations) {
			const nBlockIndex = vecBlocks.findIndex(strSource => strSource.includes(`function ${strOperation}(`));
			g_Assert(nBlockIndex >= 0);
			let unLogCount = 0;
			const Loggers = {
				LogInfo(strFormat, Result) {
					g_Assert.equal(strFormat, `${strOperation} Result=%j`);
					const Snapshot = JSON.parse(JSON.stringify(Result));
					const strAddress = `0x${unAddress.toString(16).toUpperCase()}`;
					if ((strOperation === "ReportEntityIdentities") || (strOperation === "InspectEntityCommand")) {
						g_Assert.equal(Snapshot.BaseEntity.Address, strAddress);
						g_Assert.equal(Snapshot.Edict.Address, strAddress);
						g_Assert.equal(Snapshot.EntityAddress, strAddress);
						g_Assert.equal(Snapshot.IntegerHandle, BaseHandle.Value);
						g_Assert.equal(Snapshot.BaseHandle.Value, BaseHandle.Value);
					} else {
						g_Assert.equal(Snapshot.length, 5);
						for (const Record of Snapshot) {
							g_Assert.equal((strOperation === "ReportEdictConversions") ? Record.Address : Record, strAddress);
						}
					}

					unLogCount += 1;
				},
			};
			ExecuteDocumentationBlock(vecBlocks[nBlockIndex], nBlockIndex, {
				"entities/helpers": EntityHelpers,
				commands: { Command: DocumentationCommand, HANDLED: 2 },
				"commands/server": { RegisterCommand: RegisterServerCommand, UnregisterCommand: UnregisterServerCommand },
				loggers: Loggers,
			});
			g_Assert.equal(unLogCount, 1);
			g_Assert.equal(BaseEntity.Address, unAddress);
			g_Assert.equal(Edict.Address, unAddress);
			g_Assert.equal(typeof BaseEntity.Address, "bigint");
			g_Assert.equal(typeof Edict.Address, "bigint");
		}
	}
}

function VerifyEntityOutputLoggingDocumentation(vecBlocks) {
	const nBlockIndex = vecBlocks.findIndex(strSource => strSource.includes("function VerifyEntityOutputName()"));
	g_Assert(nBlockIndex >= 0);
	const strSource = vecBlocks[nBlockIndex];
	for (const unBaseAddress of [0x200000n, 0xFFFFFFFFFFFFF000n]) {
		const NamedField = { Offset: 0x90, Address: 0x1111n, ExternalName: "OnFixtureOutput" };
		let vecFields = [{ Offset: 0, ExternalName: "" }, NamedField];
		const EntityRecord = { Index: 1, Address: unBaseAddress, GetEntityOutputs: () => vecFields };
		let unLookupCount = 0;
		let unLogCount = 0;
		const Modules = {
			"entities/entity": { Entity: () => EntityRecord },
			"entities/helpers": {
				FindEntityOutputNameByAddress(EntityValue, unOutputAddress) {
					g_Assert.strictEqual(EntityValue, EntityRecord);
					g_Assert.equal(unOutputAddress, unBaseAddress + BigInt(NamedField.Offset));
					unLookupCount += 1;

					return NamedField.ExternalName;
				},
			},
			loggers: {
				LogInfo(strFormat, Result) {
					g_Assert.equal(strFormat, "VerifyEntityOutputName Result=%j");
					const Snapshot = JSON.parse(JSON.stringify(Result));
					g_Assert.equal(Snapshot.EntityOutputAddress, `0x${(unBaseAddress + BigInt(NamedField.Offset)).toString(16).toUpperCase()}`);
					g_Assert.equal(Snapshot.EntityOutputName, NamedField.ExternalName);
					unLogCount += 1;
				},
			},
		};
		const Run = () => ExecuteDocumentationBlock(strSource, nBlockIndex, Modules);
		Run();
		g_Assert.equal(unLookupCount, 1);
		g_Assert.equal(unLogCount, 1);

		vecFields = [{ Offset: 0, ExternalName: "" }];
		g_Assert.throws(Run, /no named reflected output fields/);
		g_Assert.equal(unLookupCount, 1);
		g_Assert.equal(unLogCount, 1);

		Modules["entities/helpers"].FindEntityOutputNameByAddress = undefined;
		g_Assert.throws(Run, /does not expose datamap output lookup/);
		g_Assert.equal(unLookupCount, 1);
	}
}

function VerifyEntityCommandDocumentation(strSource, unBlockIndex, EntityHelpers) {
	const ServerCommandModule = {
		RegisterCommand(strCommandName, Callback) {
			g_Assert.equal(strCommandName, "sjs_entity_identity");
			g_Assert.equal(typeof Callback, "function");

			return false;
		},
		UnregisterCommand() {
			throw new Error("Unexpected cleanup after failed registration.");
		},
	};
	const Modules = {
		commands: { Command: DocumentationCommand, HANDLED: 2 },
		"commands/server": ServerCommandModule,
		"entities/helpers": EntityHelpers,
		loggers: { LogInfo: ValidateEntityHelperDocumentationLog, LogWarning: ValidateEntityHelperDocumentationLog },
	};
	g_Assert.throws(() => ExecuteDocumentationBlock(strSource, unBlockIndex, Modules), /Unable to register the entity-identity command\./);

	ServerCommandModule.RegisterCommand = () => true;
	ServerCommandModule.UnregisterCommand = () => false;
	g_Assert.throws(() => ExecuteDocumentationBlock(strSource, unBlockIndex, Modules), /Unable to unregister the entity-identity command\./);

	for (const strArgument of ["not-an-index", "2147483648"]) {
		let unWarnings = 0;
		Modules["entities/helpers"] = { IsEntityValid: () => false };
		Modules.loggers = {
			LogInfo() {
				throw new Error("Invalid entity index reached identity conversion logging.");
			},
			LogWarning(strFormat, Result) {
				g_Assert.equal(strFormat, "InspectEntityCommand Result=%j");
				const Snapshot = JSON.parse(JSON.stringify(Result));
				g_Assert.equal(Snapshot.Valid, false);
				g_Assert.equal(Snapshot.EntityIndexArgument, strArgument);
				unWarnings += 1;
			},
		};
		ServerCommandModule.RegisterCommand = (strName, Callback) => {
			g_Assert.equal(Callback({ Arguments: [strName, strArgument] }), 2);

			return true;
		};
		ServerCommandModule.UnregisterCommand = () => true;
		ExecuteDocumentationBlock(strSource, unBlockIndex, Modules);
		g_Assert.equal(unWarnings, 1);
	}
}

function GetConversionFunctionName(strResultName, strSourceName) {
	const ResultPrefixes = {
		BaseEntity: "GetBaseEntityFrom",
		BaseHandle: "GetBaseHandleFrom",
		Edict: "GetEdictFrom",
		Index: "GetEntityIndexFrom",
		IntegerHandle: "GetIntegerHandleFrom",
		Address: "GetEntityAddressFrom",
	};
	const SourceSuffixes = {
		BaseEntity: "BaseEntity",
		BaseHandle: "BaseHandle",
		Edict: "Edict",
		Index: "EntityIndex",
		IntegerHandle: "IntegerHandle",
		Address: "EntityAddress",
	};

	return `${ResultPrefixes[strResultName]}${SourceSuffixes[strSourceName]}`;
}

InstallEntity(1, { ClassName: "worldspawn", SerialNumber: 17 });
InstallEntity(2, { ClassName: "info_target", SerialNumber: 23 });

const g_NativeEntityHelpers = { GetEntityIndex, IsEntityValid, FindEntityOutputNameByAddress };
const g_vecRepresentationNames = ["Index", "Edict", "BaseEntity", "BaseHandle", "IntegerHandle", "Address"];

for (const strResultName of g_vecRepresentationNames) {
	for (const strSourceName of g_vecRepresentationNames) {
		if (strSourceName === strResultName) {
			continue;
		}

		const strFunctionName = GetConversionFunctionName(strResultName, strSourceName);
		g_NativeEntityHelpers[strFunctionName] = CreateConversion(strSourceName, strResultName);
	}
}

globalThis.sourcejs = { "entities/helpers": g_NativeEntityHelpers };

delete require.cache[g_strEntityHelpersPath];
delete require.cache[g_strRuntimePath];

const g_EntityHelpers = require(g_strEntityHelpersPath);
g_Assert.equal(g_EntityHelpers, g_NativeEntityHelpers);
g_Assert.deepEqual(Object.keys(g_EntityHelpers).sort(), g_vecExpectedExports.slice().sort());
g_Assert.equal(g_EntityHelpers.GetEntityIndex(1), 1);
g_Assert.equal(g_EntityHelpers.GetEntityIndex({ Index: 1 }), 1);
g_Assert.equal(g_EntityHelpers.GetEntityIndex(), -1);
g_Assert.equal(g_EntityHelpers.GetEntityIndex("1"), -1);
g_Assert.equal(g_EntityHelpers.IsEntityValid(1), true);
g_Assert.equal(g_EntityHelpers.IsEntityValid({ Index: 1 }), true);
g_Assert.equal(g_EntityHelpers.IsEntityValid(9999), false);
g_Assert.equal(g_EntityHelpers.IsEntityValid(), false);

const g_SourceValues = {
	BaseEntity: g_EntityHelpers.GetBaseEntityFromEntityIndex(1),
	BaseHandle: g_EntityHelpers.GetBaseHandleFromEntityIndex(1),
	Edict: g_EntityHelpers.GetEdictFromEntityIndex(1),
	Index: 1,
	IntegerHandle: g_EntityHelpers.GetIntegerHandleFromEntityIndex(1),
	Address: g_EntityHelpers.GetEntityAddressFromEntityIndex(1),
};

g_Assert.deepEqual(g_SourceValues.Edict, { ClassName: "worldspawn", Index: 1, Kind: "edict", Address: g_unEdictAddressBase + 0x40n });
g_Assert.deepEqual(g_SourceValues.BaseEntity, { ClassName: "worldspawn", Index: 1, Kind: "baseentity", Address: g_unAddressBase + 0x100n + 17n });
g_Assert.deepEqual(g_SourceValues.BaseHandle, { EntryIndex: 1, Kind: "basehandle", SerialNumber: 17, Valid: true, Value: EncodeHandle(1, 17) });
g_Assert.equal(typeof g_SourceValues.IntegerHandle, "number");
g_Assert.equal(typeof g_SourceValues.Address, "bigint");
g_Assert.equal(typeof g_SourceValues.BaseEntity.Address, "bigint");
g_Assert.equal(typeof g_SourceValues.Edict.Address, "bigint");

for (const strResultName of g_vecRepresentationNames) {
	for (const strSourceName of g_vecRepresentationNames) {
		if (strSourceName === strResultName) {
			continue;
		}

		const strFunctionName = GetConversionFunctionName(strResultName, strSourceName);
		const Result = g_EntityHelpers[strFunctionName](g_SourceValues[strSourceName]);
		switch (strResultName) {
			case "Index":
				g_Assert.equal(Result, 1, strFunctionName);
				break;

			case "Edict":
				g_Assert.equal(Result.Kind, "edict", strFunctionName);
				g_Assert.equal(Result.Address, g_SourceValues.Edict.Address, strFunctionName);
				break;

			case "BaseEntity":
				g_Assert.equal(Result.Kind, "baseentity", strFunctionName);
				g_Assert.equal(Result.Address, g_SourceValues.BaseEntity.Address, strFunctionName);
				break;

			case "BaseHandle":
				g_Assert.equal(Result.Kind, "basehandle", strFunctionName);
				g_Assert.equal(Result.Value, g_SourceValues.BaseHandle.Value, strFunctionName);
				g_Assert.equal(Result.SerialNumber, 17, strFunctionName);
				break;

			case "IntegerHandle":
				g_Assert.equal(Result, g_SourceValues.IntegerHandle, strFunctionName);
				break;

			case "Address":
				g_Assert.equal(Result, g_SourceValues.Address, strFunctionName);
				break;

			default:
				g_Assert.fail(`Unhandled result representation: ${strResultName}`);
		}
	}
}

for (const strFunctionName of g_vecExpectedExports.filter((strName) => strName.includes("From"))) {
	g_Assert.throws(() => g_EntityHelpers[strFunctionName](), /expects|could not resolve/);
}

g_Assert.throws(() => g_EntityHelpers.GetEntityIndexFromEdict(g_SourceValues.BaseEntity), /expects an own edict identity/);
g_Assert.throws(() => g_EntityHelpers.GetEntityIndexFromBaseEntity(g_SourceValues.Edict), /expects an own baseentity identity/);
g_Assert.throws(() => g_EntityHelpers.GetEntityIndexFromBaseHandle(g_SourceValues.IntegerHandle), /expects a basehandle record/);
g_Assert.throws(() => g_EntityHelpers.GetEntityIndexFromIntegerHandle(g_SourceValues.BaseHandle), /expects an unsigned integer/);
g_Assert.throws(() => g_EntityHelpers.GetEntityIndexFromEntityAddress(String(g_SourceValues.Address)), /expects an unsigned BigInt address/);
g_Assert.throws(() => g_EntityHelpers.GetEntityIndexFromEntityAddress(Number(g_SourceValues.Address)), /expects an unsigned BigInt address/);
g_Assert.throws(() => g_EntityHelpers.GetEntityIndexFromEntityAddress({ Address: g_SourceValues.Address }), /expects an unsigned BigInt address/);
g_Assert.throws(() => g_EntityHelpers.GetEntityIndexFromEntityAddress(-1n), /expects an unsigned BigInt address/);
g_Assert.throws(() => g_EntityHelpers.GetEntityIndexFromEntityAddress(g_unAddressMaximum + 1n), /expects an unsigned BigInt address/);
g_Assert.equal(g_EntityHelpers.GetEntityIndexFromEntityAddress(g_SourceValues.Address), 1);
g_Assert.throws(() => g_EntityHelpers.GetEntityIndexFromIntegerHandle(g_unUnsignedIntegerMaximum + 1), /expects an unsigned integer/);
g_Assert.throws(() => g_EntityHelpers.GetEntityIndexFromEdict([]), /expects a edict record/);
g_Assert.throws(() => g_EntityHelpers.GetEntityIndexFromEdict(Object.create(g_SourceValues.Edict)), /expects an own edict identity/);
g_Assert.throws(() => g_EntityHelpers.GetEntityIndexFromEdict(Object.assign(Object.create({ Address: g_SourceValues.Edict.Address }), { Kind: "edict" })), /expects an own edict identity/);
g_Assert.throws(() => g_EntityHelpers.GetEntityIndexFromBaseHandle(Object.create(g_SourceValues.BaseHandle)), /expects an own basehandle identity/);
g_Assert.throws(() => g_EntityHelpers.GetEntityIndexFromBaseHandle({ ...g_SourceValues.BaseHandle, Kind: "BaseHandle" }), /expects an own basehandle identity/);

const g_StaleEdict = g_EntityHelpers.GetEdictFromEntityIndex(2);
const g_StaleBaseHandle = g_EntityHelpers.GetBaseHandleFromEntityIndex(2);
const g_unStaleHandle = g_EntityHelpers.GetIntegerHandleFromEntityIndex(2);
const g_unStaleAddress = g_EntityHelpers.GetEntityAddressFromEntityIndex(2);
const g_unReusedEdictAddress = g_EntityHelpers.GetEdictFromEntityIndex(2).Address;

g_Assert.equal(RemoveEntity(2), true);
InstallEntity(2, { ClassName: "prop_dynamic", EdictAddress: g_unReusedEdictAddress, SerialNumber: 24 });
g_Assert.throws(() => g_EntityHelpers.GetEntityIndexFromIntegerHandle(g_unStaleHandle), /could not resolve a live entity/);
g_Assert.throws(() => g_EntityHelpers.GetEntityIndexFromEntityAddress(g_unStaleAddress), /could not resolve a live entity/);
g_Assert.equal(g_EntityHelpers.GetEntityIndexFromEdict({ Kind: "edict", Address: g_unReusedEdictAddress }), 2);
g_Assert.equal(g_EntityHelpers.GetEntityIndexFromEdict(g_StaleEdict), 2);
g_Assert.notEqual(g_StaleEdict.ClassName, g_EntityHelpers.GetBaseEntityFromEdict(g_StaleEdict).ClassName);
g_Assert.throws(() => g_EntityHelpers.GetEntityIndexFromBaseHandle(g_StaleBaseHandle), /could not resolve a live entity/);

const g_MisleadingEdict = { ...g_StaleEdict, Index: 9999, ClassName: "not_current_class" };
g_Assert.equal(g_EntityHelpers.GetEntityIndexFromEdict(g_MisleadingEdict), 2);

const g_OutputField = Entity(1).GetEntityOutputs()[0];
const g_unEntityOutputAddress = Entity(1).Address + BigInt(g_OutputField.Offset);
g_Assert.equal(g_EntityHelpers.FindEntityOutputNameByAddress(Entity(1), g_unEntityOutputAddress), "OnUser1");
g_Assert.equal(g_EntityHelpers.FindEntityOutputNameByAddress(Entity(1), g_unEntityOutputAddress + 1n), null);
g_Assert.throws(() => g_EntityHelpers.FindEntityOutputNameByAddress(9999, g_unEntityOutputAddress), /could not resolve a live entity/);
g_Assert.throws(() => g_EntityHelpers.FindEntityOutputNameByAddress(Entity(1), 0n), /non-zero BigInt output address/);
g_Assert.throws(() => g_EntityHelpers.FindEntityOutputNameByAddress(Entity(1), String(g_unEntityOutputAddress)), /unsigned BigInt address/);
g_Assert.throws(() => g_EntityHelpers.FindEntityOutputNameByAddress(Entity(1), Number(g_unEntityOutputAddress)), /unsigned BigInt address/);

const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
const g_vecDocumentationBlocks = ExtractJavaScriptBlocks(g_strDocumentation);
VerifyEntityIdentityLoggingDocumentation(g_vecDocumentationBlocks);
VerifyEntityOutputLoggingDocumentation(g_vecDocumentationBlocks);
const g_setExercisedExports = new Set();
const g_DocumentedEntityHelpers = TrackModule(g_EntityHelpers, g_setExercisedExports);

g_Assert.equal(g_vecDocumentationBlocks.length, 12);
g_Assert.doesNotMatch(g_strDocumentation, /generated by|auto-generated|example generator|do not edit this file/i);
g_Assert.doesNotMatch(g_strDocumentation, /console\.log\(result\)|_ZN16CCoreDispSurface4InitEv|addressString|make_object|get_object_pointer/);
g_Assert.match(g_strDocumentation, /const unOutputAddress = EntityInstance\.Address \+ BigInt\(OutputField\.Offset\)/);
g_Assert.match(g_strDocumentation, /serial number changes/);
g_Assert.match(g_strDocumentation, /not writable native-memory views/);
g_Assert.ok(/Address-only records do not carry a serial number/.test(g_strDocumentation), "The documentation must distinguish address reuse from serial-aware handles.");

for (const strRelatedPath of [
	"entities-entity.md",
	"entities-datamaps.md",
	"entities-outputs.md",
	"players-helpers.md",
	"memory-hooks.md",
]) {
	g_Assert.match(g_strDocumentation, new RegExp(`\\(${strRelatedPath.replace(".", "\\.")}\\)`));
}

for (const [unBlockIndex, strSource] of g_vecDocumentationBlocks.entries()) {
	if (strSource.includes("sjs_entity_identity")) {
		VerifyEntityCommandDocumentation(strSource, unBlockIndex, g_DocumentedEntityHelpers);
	}

	ExecuteDocumentationBlock(strSource, unBlockIndex, {
		commands: { Command: DocumentationCommand, HANDLED: 2 },
		"commands/server": { RegisterCommand: RegisterServerCommand, UnregisterCommand: UnregisterServerCommand },
		"entities/entity": { Entity },
		"entities/helpers": g_DocumentedEntityHelpers,
		loggers: { LogInfo: ValidateEntityHelperDocumentationLog, LogWarning: ValidateEntityHelperDocumentationLog },
	});
}

g_Assert.equal(g_mapServerCommands.size, 0);

for (const strExportName of g_vecExpectedExports) {
	g_Assert.equal(g_setExercisedExports.has(strExportName), true, `Documentation did not reference entities/helpers.${strExportName}.`);
}

for (const strFunctionName of g_vecExpectedExports.filter((strName) => strName.includes("From"))) {
	g_Assert.equal(g_vecNativeCalls.includes(strFunctionName), true, `The smoke did not execute ${strFunctionName}.`);
}

g_Assert.equal(g_vecNativeCalls.includes("FindEntityOutputNameByAddress"), true);

function ExtractSourceSection(strSource, strStartMarker, strEndMarker) {
	const nStart = strSource.indexOf(strStartMarker);
	g_Assert.ok(nStart >= 0, `Missing source section start: ${strStartMarker}`);

	const nEnd = strSource.indexOf(strEndMarker, nStart + strStartMarker.length);
	g_Assert.ok(nEnd > nStart, `Missing source section end: ${strEndMarker}`);

	return strSource.slice(nStart, nEnd);
}

function AssertEntityHandleSourceContracts(strSource) {
	const ExtractHelper = (strSignature) => ExtractSourceSection(strSource, "\t\t" + strSignature, "\n\t\t}");

	const strLiveHandleSource = ExtractHelper("bool GetEntityIndexFromBaseHandleValue(");
	g_Assert.match(strLiveHandleSource, /GetEntityBaseHandleFromEdictAddress\(pEdict, LiveHandle\)/);
	g_Assert.match(strLiveHandleSource, /LiveHandle\.ToInt\(\) != EntityHandle\.ToInt\(\)/, "Live entity handles must match serial-aware identity.");
	g_Assert.match(strLiveHandleSource, /return false;[\s\S]*nEntityIndexOut = nEntryIndex;/);

	const strIntegerHandleSource = ExtractHelper("bool GetEntityIndexFromIntegerHandleValue(");
	g_Assert.match(strIntegerHandleSource, /return GetEntityIndexFromBaseHandleValue\(Handle, nEntityIndexOut\);/, "Integer handles must use live base-handle validation.");

	const strHandleConversionSource = ExtractHelper("bool GetEntityBaseHandleFromValue(");
	g_Assert.match(strHandleConversionSource, /!pIsolate \|\| LocalContext\.IsEmpty\(\) \|\| LocalValue\.IsEmpty\(\)/);
	// These compatibility keys and SDK operations retain their exact native spelling.
	g_Assert.match(strHandleConversionSource, /"Handle", "Value", "IntHandle"/);
	g_Assert.match(strHandleConversionSource, /if \(!LocalObject->Get\(LocalContext, LocalPropertyName\)\.ToLocal\(&LocalPropertyValue\)\) \{\s*return false;\s*}/, "Property getter failure must stop base-handle conversion.");
	g_Assert.match(strHandleConversionSource, /if \(!LocalPropertyValue->IsUndefined\(\)\)/, "Only undefined properties may fall back to another handle representation.");
	g_Assert.match(strHandleConversionSource, /if \(!Handle\.IsValid\(\)\) \{\s*return false;\s*}\s*HandleOut\.Init\(Handle\.GetEntryIndex\(\), Handle\.GetSerialNumber\(\)\);/, "Invalid SDK handles must not be committed.");
	g_Assert.doesNotMatch(strHandleConversionSource, /HandleOut\s*=/);

	const strEdictHandleSource = ExtractHelper("bool GetEntityBaseHandleFromEdictAddress(");
	g_Assert.match(strEdictHandleSource, /HandleOut\.Init\(EntityHandle\.GetEntryIndex\(\), EntityHandle\.GetSerialNumber\(\)\);/, "Edict handles must preserve SDK initialization.");
	g_Assert.doesNotMatch(strEdictHandleSource, /HandleOut\s*=/);

	const strHandleRecordSource = ExtractHelper("v8::Local<v8::Object> MakeEntityBaseHandleObject(");
	g_Assert.match(strHandleRecordSource, /CreateEntityRecordProperty\(pIsolate, LocalContext, LocalObject, "Valid", v8::Boolean::New\(pIsolate, EntityHandle\.IsValid\(\)\)\)/);
	g_Assert.doesNotMatch(strHandleRecordSource, /unHandleValue\s*!=\s*0/);

	for (const strSignature of ["v8::Local<v8::Object> MakeEntityAddressObject(", "v8::Local<v8::Object> MakeEntityBaseHandleObject("]) {
		const strBuilderSource = ExtractHelper(strSignature);
		g_Assert.match(strBuilderSource, /if \(!pIsolate \|\| LocalContext\.IsEmpty\(\)\)/);
		g_Assert.match(strBuilderSource, /if \(LocalObject\.IsEmpty\(\)\)/);
		g_Assert.match(strBuilderSource, /if \(!CreateEntityRecordProperty[\s\S]*\) \{\s*return {};\s*}\s*return LocalObject;/, "Own entity record property definitions must report failure.");
		g_Assert.doesNotMatch(strBuilderSource, /\bSet(?:String|Value|Integer|Number|Boolean)\(/, "Entity record construction must not dispatch inherited setters.");
	}

	const strAddressValueSource = ExtractHelper("v8::Local<v8::Value> MakeEntityAddressValue(");
	g_Assert.doesNotMatch(strAddressValueSource, /LocalContext/);
	g_Assert.match(strAddressValueSource, /v8::BigInt::NewFromUnsigned/);

	const strEntityValueSource = ExtractHelper("v8::Local<v8::Value> MakeEntityValueFromBaseEntity(");
	g_Assert.match(strEntityValueSource, /if \(!pIsolate \|\| LocalContext\.IsEmpty\(\)\) \{\s*return {};\s*}/, "Entity values must reject an unavailable V8 context.");
	g_Assert.match(strEntityValueSource, /return v8::Null\(pIsolate\);/);

	const strEntityResultSource = ExtractHelper("void SetEntityResult(");
	g_Assert.match(strEntityResultSource, /if \(!pIsolate\) \{\s*return;\s*}/);
	g_Assert.match(strEntityResultSource, /if \(LocalEntity\.IsEmpty\(\)\) \{\s*return;\s*}\s*CallbackInformation\.GetReturnValue\(\)\.Set\(LocalEntity\);/, "Entity results must reject an empty V8 value.");
	g_Assert.doesNotMatch(strEntityResultSource, /GetReturnValue\(\)\.Set\(MakeEntityValueFromBaseEntity/);
}

g_Assert.throws(() => ExtractSourceSection("", "MissingStart", "MissingEnd"), { name: "AssertionError", message: /Missing source section start/ });
g_Assert.throws(() => ExtractSourceSection("SectionStart", "SectionStart", "MissingEnd"), { name: "AssertionError", message: /Missing source section end/ });

const g_strNativeSource = g_FileSystem.readFileSync(g_strNativeSourcePath, "utf8");
AssertEntityHandleSourceContracts(g_strNativeSource);

const g_vecHandleSourceRegressions = [
	["live identity", "LiveHandle.ToInt() != EntityHandle.ToInt()", "false", "Live entity handles must match serial-aware identity."],
	["integer handle validation", "return GetEntityIndexFromBaseHandleValue(Handle, nEntityIndexOut);", "nEntityIndexOut = Handle.GetEntryIndex(); return true;", "Integer handles must use live base-handle validation."],
	["getter failure", "!LocalObject->Get(LocalContext, LocalPropertyName).ToLocal(&LocalPropertyValue)", "LocalPropertyValue.IsEmpty()", "Property getter failure must stop base-handle conversion."],
	["undefined-only fallback", "if (!LocalPropertyValue->IsUndefined())", "if (!LocalPropertyValue->IsNull())", "Only undefined properties may fall back to another handle representation."],
	["validated output", "if (!Handle.IsValid())", "if (false)", "Invalid SDK handles must not be committed."],
	["SDK output initialization", "\tHandleOut.Init(EntityHandle.GetEntryIndex(), EntityHandle.GetSerialNumber());", "\tHandleOut = EntityHandle;", "Edict handles must preserve SDK initialization."],
	["address record property status", "if (!CreateEntityRecordProperty(pIsolate, LocalContext, LocalObject, \"Kind\", LocalKindValue)", "if (CreateEntityRecordProperty(pIsolate, LocalContext, LocalObject, \"Kind\", LocalKindValue)", "Own entity record property definitions must report failure."],
	["base-handle record property status", "if (!CreateEntityRecordProperty(pIsolate, LocalContext, LocalObject, \"Kind\", MakeString(pIsolate, \"basehandle\"))", "if (CreateEntityRecordProperty(pIsolate, LocalContext, LocalObject, \"Kind\", MakeString(pIsolate, \"basehandle\"))", "Own entity record property definitions must report failure."],
];

for (const [strScenario, strOriginal, strReplacement, strExpectedFailure] of g_vecHandleSourceRegressions) {
	g_Assert.equal(g_strNativeSource.split(strOriginal).length, 2, strScenario + " must target exactly one current contract");
	g_Assert.throws(() => AssertEntityHandleSourceContracts(g_strNativeSource.replace(strOriginal, strReplacement)), (ErrorValue) => (ErrorValue instanceof g_Assert.AssertionError) && ErrorValue.message.includes(strExpectedFailure), strScenario);
}

for (const strSignature of ["v8::Local<v8::Value> MakeEntityValueFromBaseEntity(", "void SetEntityResult("]) {
	const strOriginal = ExtractSourceSection(g_strNativeSource, "\t\t" + strSignature, "\n\t\t}");
	const strGuard = (strSignature === "void SetEntityResult(") ? "LocalEntity.IsEmpty()" : "!pIsolate || LocalContext.IsEmpty()";
	const strExpectedFailure = (strSignature === "void SetEntityResult(") ? "Entity results must reject an empty V8 value." : "Entity values must reject an unavailable V8 context.";
	g_Assert.equal(strOriginal.split(strGuard).length, 2, strSignature);
	g_Assert.throws(() => AssertEntityHandleSourceContracts(g_strNativeSource.replace(strOriginal, strOriginal.replace(strGuard, "false"))), (ErrorValue) => (ErrorValue instanceof g_Assert.AssertionError) && ErrorValue.message.includes(strExpectedFailure), strSignature);
}

const g_strHelperSource = ExtractSourceSection(g_strNativeSource, "enum class EntityHelperValue", "void GetPlayerIndexCallback");
g_Assert.match(g_strHelperSource, /enum class EntityHelperValue/);
g_Assert.match(g_strHelperSource, /ConvertEntityHelperValueCallback/);
g_Assert.match(g_strHelperSource, /HasOwnProperty/);
g_Assert.match(g_strHelperSource, /LocalValue->IsArray\(\)/);
g_Assert.match(g_strHelperSource, /std::numeric_limits<unsigned int>::max\(\)/);
g_Assert.match(g_strHelperSource, /GetEntityIndexFromIntegerHandleValue/);
g_Assert.match(g_strHelperSource, /could not resolve a live entity/);
g_Assert.doesNotMatch(g_strHelperSource, /EntityHelperIndexFromBaseHandleCallback|EntityHelperEdictFromIndexCallback|EntityHelperPointerFromIndexCallback/);

const g_strFindOutputSource = ExtractSourceSection(g_strNativeSource, "void FindEntityOutputNameByAddressCallback", "template <typename TTypeDescription>");
g_Assert.match(g_strFindOutputSource, /EntityDatamapsGetDatamapFromBaseEntity\(pCallerEntity\)/);
g_Assert.match(g_strFindOutputSource, /pCurrentDatamap = pCurrentDatamap->baseMap/);
g_Assert.match(g_strFindOutputSource, /EntityDatamapsGetTypeDescriptionOffset\(pTypeDescription\)/);
g_Assert.match(g_strFindOutputSource, /pTypeDescription->externalName/);
g_Assert.match(g_strFindOutputSource, /unCallerAddress \+ unFieldOffset/);
g_Assert.doesNotMatch(g_strFindOutputSource, /outputs|outputName|fieldName/);

const g_strInstallerSource = ExtractSourceSection(g_strNativeSource, "v8::Local<v8::Object> const LocalEntityHelpersModule", "v8::Local<v8::Object> const LocalEntityPropertiesModule");
g_Assert.match(g_strInstallerSource, /auto InstallEntityConversionFunction/);
g_Assert.match(g_strInstallerSource, /InstallEntityConversionFunction\("GetBaseEntityFromBaseHandle"/);
g_Assert.match(g_strInstallerSource, /InstallEntityConversionFunction\("GetEntityAddressFromIntegerHandle"/);
g_Assert.match(g_strInstallerSource, /#ifdef SOURCEJS_HAS_DATAMAPS[\s\S]+"FindEntityOutputNameByAddress"[\s\S]+#endif/);

const g_ReducedEntityHelpers = { ...g_NativeEntityHelpers };
delete g_ReducedEntityHelpers.FindEntityOutputNameByAddress;
globalThis.sourcejs = { "entities/helpers": g_ReducedEntityHelpers };

delete require.cache[g_strEntityHelpersPath];

const g_ReducedAPI = require(g_strEntityHelpersPath);
g_Assert.equal(g_ReducedAPI, g_ReducedEntityHelpers);
g_Assert.equal(Object.keys(g_ReducedAPI).length, 32);
g_Assert.equal(Object.hasOwn(g_ReducedAPI, "FindEntityOutputNameByAddress"), false);

delete require.cache[g_strEntityHelpersPath];
delete require.cache[g_strRuntimePath];
delete globalThis.sourcejs;

g_Assert.throws(() => require(g_strEntityHelpersPath), /SourceJS native runtime is not installed/);

console.log("[  OK  ] entities/helpers API and documentation passed with native doubles/source guards; native SDK execution not exercised");
