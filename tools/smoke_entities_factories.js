#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strDocumentationPath = g_Path.join(g_strProjectRoot, "docs", "api", "entities-factories.md");
const g_strFactoriesPath = g_Path.join(g_strProjectRoot, "packages", "sourcejs", "entities", "factories.js");
const g_strRuntimePath = g_Path.join(g_strProjectRoot, "packages", "sourcejs", "internal", "runtime.js");
const g_strNativeSourcePath = g_Path.join(g_strProjectRoot, "src", "sourcejs", "modules", "ModuleBindings.cpp");
const g_vecExpectedExports = [
	"CreateEntityByClassName",
	"CreateAndSpawnEntityByClassName",
	"DestroyEntityByHammerID",
	"DispatchEntitySpawn",
	"FindEntityByHammerID",
	"GetEntityKeyValue",
	"SetEntityKeyValue",
];
const g_unDisposableHammerID = 4242;
const g_unAddressBase = 0x200000n;
const g_unAddressStride = 0x100n;
const g_unDataMapAddressOffset = 0x40n;
const g_unServerClassAddressOffset = 0x20n;
const g_unFixtureHandleBase = 0x30000;
const g_unFixtureNetworkSerialBase = 500;
const g_unMaximumHammerID = 0x7FFFFFFF;
const g_nMinimumFixtureInteger = -0x80000000;
const g_nMaximumFixtureInteger = 0x7FFFFFFF;
const g_unDefaultKeyValueBufferLength = 256;

const g_OriginalModuleLoad = g_Module._load;
g_Module._load = function Load(strRequestName, ParentModule, bIsMain) {
	if (strRequestName === "internal/runtime") {
		return require(g_strRuntimePath);
	}

	return g_OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
};

const g_mapEntityStates = new Map();
const g_mapAddressIndexes = new Map();
const g_vecNativeCalls = [];
let g_unNextEntityIndex = 100;

function RequireClassName(strClassName, strOperationName) {
	if ((typeof strClassName !== "string") || (strClassName.length === 0)) {
		throw new TypeError(`${strOperationName} expects a non-empty entity class name.`);
	}

	return strClassName;
}

function RequireHammerID(unHammerID, strOperationName) {
	if (!Number.isInteger(unHammerID) || (unHammerID < 0) || (unHammerID > g_unMaximumHammerID)) {
		throw new TypeError(`${strOperationName} expects a non-negative integer Hammer ID.`);
	}

	return unHammerID;
}

// Controlled Number inputs and synthetic handles do not model SDK storage widths or native handle packing.
function RequireFixtureInteger(nValue, strErrorMessage) {
	if (!Number.isInteger(nValue) || (nValue < g_nMinimumFixtureInteger) || (nValue > g_nMaximumFixtureInteger)) {
		throw new TypeError(strErrorMessage);
	}

	return (nValue === 0) ? 0 : nValue;
}

function GetVectorComponents(Value, strOperationName) {
	let vecComponents = null;

	if (Array.isArray(Value)) {
		if (Value.length !== 3) {
			return null;
		}

		vecComponents = Value;

	} else if (Value && (typeof Value === "object") && !Array.isArray(Value)) {
		const bHasComponent = Object.hasOwn(Value, "X") || Object.hasOwn(Value, "Y") || Object.hasOwn(Value, "Z");
		if (!bHasComponent) {
			return null;
		}

		if (!Object.hasOwn(Value, "X") || !Object.hasOwn(Value, "Y") || !Object.hasOwn(Value, "Z")) {
			throw new TypeError(`${strOperationName} expects finite numeric X, Y, and Z components.`);
		}

		vecComponents = [Value.X, Value.Y, Value.Z];
	}

	if (!vecComponents) {
		return null;
	}

	if (!vecComponents.every((dblComponent) => (typeof dblComponent === "number") && Number.isFinite(dblComponent))) {
		throw new TypeError(`${strOperationName} expects finite numeric X, Y, and Z components.`);
	}

	return vecComponents;
}

function CreateKeyValueRecord(strKey, Value, strOperationName) {
	if ((typeof strKey !== "string") || (strKey.length === 0)) {
		throw new TypeError(`${strOperationName} expects non-empty KeyValue names.`);
	}

	if (typeof Value === "string") {
		return { Key: strKey, Type: "string", Value };
	}

	if ((typeof Value === "number") && Number.isFinite(Value)) {
		return { Key: strKey, Type: "float", Value };
	}

	const vecVector = GetVectorComponents(Value, strOperationName);
	if (vecVector) {
		return { Key: strKey, Type: "vector", Value: vecVector };
	}

	throw new TypeError(`${strOperationName} accepts only string, finite number or three-component vector KeyValues.`);
}

function CreateKeyValueRecords(KeyValues, strOperationName) {
	if (KeyValues === undefined) {
		return [];
	}

	if (!KeyValues || (typeof KeyValues !== "object") || Array.isArray(KeyValues) || (typeof KeyValues === "function")) {
		throw new TypeError(`${strOperationName} expects KeyValues to be a non-array object.`);
	}

	return Object.entries(KeyValues).map(([strKey, Value]) => CreateKeyValueRecord(strKey, Value, strOperationName));
}

function CreateEntityOptions(Options, strOperationName, bAllowDispatchSpawn) {
	if (Options === undefined) {
		return { DispatchSpawn: false, KeyValues: [] };
	}

	if (!Options || (typeof Options !== "object") || Array.isArray(Options) || (typeof Options === "function")) {
		throw new TypeError(`${strOperationName} expects Options to be a non-array object.`);
	}

	const vecNames = Object.keys(Options);
	const bIsOptionsObject = Object.hasOwn(Options, "DispatchSpawn") || Object.hasOwn(Options, "KeyValues");

	if (!bIsOptionsObject) {
		return { DispatchSpawn: false, KeyValues: CreateKeyValueRecords(Options, strOperationName) };
	}

	for (const strName of vecNames) {
		if ((strName !== "KeyValues") && ((strName !== "DispatchSpawn") || !bAllowDispatchSpawn)) {
			throw new TypeError(`${strOperationName} received an unknown option: ${strName}`);
		}
	}

	if (Object.hasOwn(Options, "DispatchSpawn") && (typeof Options.DispatchSpawn !== "boolean")) {
		throw new TypeError(`${strOperationName} expects DispatchSpawn to be a boolean.`);
	}

	return { DispatchSpawn: Options.DispatchSpawn ?? false, KeyValues: CreateKeyValueRecords(Options.KeyValues, strOperationName) };
}

function RenderKeyValue(Record) {
	switch (Record.Type) {
		case "string":
			return Record.Value;

		case "float":
			return String(Record.Value);

		case "vector":
			return Record.Value.join(" ");

		default:
			throw new Error(`Unknown KeyValue Type: ${Record.Type}`);
	}
}

function InstallEntity(unIndex, strClassName, Options = {}) {
	const unAddress = g_unAddressBase + BigInt(unIndex) * g_unAddressStride;
	const State = {
		ClassName: strClassName,
		DataMap: { ClassName: "CBaseEntity", Address: unAddress + g_unDataMapAddressOffset },
		Free: false,
		HammerID: Options.HammerID ?? null,
		HandleValue: g_unFixtureHandleBase + unIndex,
		KeyValues: new Map(),
		NetworkBaseName: "DT_BaseEntity",
		Networked: true,
		NetworkSerial: unIndex + g_unFixtureNetworkSerialBase,
		Address: unAddress,
		ServerClass: { Name: "CBaseEntity", Address: unAddress + g_unServerClassAddressOffset },
		Spawned: Options.Spawned ?? false,
		StateChanged: false,
		StateFlags: 0x00,
	};

	for (const [strKey, Value] of Object.entries(Options.KeyValues ?? {})) {
		State.KeyValues.set(strKey, Value);
	}

	g_mapEntityStates.set(unIndex, State);
	g_mapAddressIndexes.set(unAddress, unIndex);

	return State;
}

function RemoveEntity(unIndex) {
	const State = g_mapEntityStates.get(unIndex);
	if (!State || State.Free) {
		return false;
	}

	State.Free = true;
	g_mapAddressIndexes.delete(State.Address);
	g_vecNativeCalls.push(["remove", unIndex]);

	return true;
}

function MakeEntity(unIndex) {
	const State = g_mapEntityStates.get(unIndex);
	if (!State || State.Free) {
		return null;
	}

	const Entity = {};
	Object.defineProperties(Entity, {
		Free: {
			enumerable: true,
			get: () => State.Free,
			set: (bValue) => {
				if (typeof bValue !== "boolean") {
					throw new TypeError("Free expects a boolean.");
				}

				State.Free = bValue;
			},
		},
		Valid: {
			enumerable: true,
			get: () => !State.Free,
		},
		ClassName: {
			enumerable: true,
			get: () => State.ClassName,
		},
		StateFlags: {
			enumerable: true,
			get: () => State.StateFlags,
			set: (nValue) => {
				State.StateFlags = RequireFixtureInteger(nValue, "Entity.StateFlags requires an integer.");
			},
		},
		NetworkSerialNumber: {
			enumerable: true,
			get: () => State.NetworkSerial,
			set: (nValue) => {
				State.NetworkSerial = RequireFixtureInteger(nValue, "Entity.NetworkSerialNumber requires an integer.");
			},
		},
		Edict: {
			enumerable: true,
			get: () => State.Free ? null : Entity,
		},
		BaseEntity: {
			enumerable: true,
			get: () => State.Free ? null : Entity,
		},
		Address: {
			enumerable: true,
			get: () => State.Free ? 0n : State.Address,
		},
		BaseHandle: {
			enumerable: true,
			get: () => State.Free ? null : { Value: State.HandleValue },
		},
		HandleValue: {
			enumerable: true,
			get: () => State.Free ? -1 : State.HandleValue,
		},
		Index: {
			enumerable: true,
			get: () => unIndex,
		},
		DataMap: {
			enumerable: true,
			get: () => State.DataMap,
		},
		NetworkBaseName: {
			enumerable: true,
			get: () => State.NetworkBaseName,
		},
		Networked: {
			enumerable: true,
			get: () => State.Networked,
		},
		NetworkSerial: {
			enumerable: true,
			get: () => State.NetworkSerial,
		},
		ServerClass: {
			enumerable: true,
			get: () => State.ServerClass,
		},
		StateChanged: {
			enumerable: true,
			get: () => State.StateChanged,
			set: (bValue) => {
				if (typeof bValue !== "boolean") {
					throw new TypeError("StateChanged expects a boolean.");
				}

				State.StateChanged = bValue;
			},
		},
	});

	Object.defineProperty(Entity, "RemoveEntity", { enumerable: true, value: () => RemoveEntity(unIndex) });

	return Entity;
}

function RequireEntityState(Value, strOperationName) {
	let nEntityIndex = -1;

	if (typeof Value === "bigint") {
		nEntityIndex = g_mapAddressIndexes.get(Value) ?? -1;

	} else if (Number.isInteger(Value)) {
		nEntityIndex = Value;

	} else if (Value && (typeof Value === "object") && Number.isInteger(Value.Index)) {
		nEntityIndex = Value.Index;
	}

	const State = g_mapEntityStates.get(nEntityIndex);
	if (!State || State.Free) {
		throw new TypeError(`${strOperationName} received an invalid entity.`);
	}

	return { Index: nEntityIndex, State };
}

function VerifyFactoryEntityFixture() {
	const unFixtureIndex = 64;
	const unPreviousNativeCallCount = g_vecNativeCalls.length;
	const State = InstallEntity(unFixtureIndex, "FixtureEntity");
	const Entity = MakeEntity(unFixtureIndex);
	try {
		g_Assert.equal(Entity.Address, 0x204000n, "factory fixture addresses must be exact BigInt values");
		g_Assert.equal(Entity.DataMap.Address, 0x204040n, "factory datamap addresses must be exact BigInt values");
		g_Assert.equal(Entity.ServerClass.Address, 0x204020n, "factory server-class addresses must be exact BigInt values");
		g_Assert.equal(Entity.HandleValue, 0x30040, "factory fixture handles must be initialized 32-bit Numbers");
		g_Assert.equal(Entity.BaseHandle.Value, 0x30040);
		g_Assert.equal(Entity.StateFlags, 0x00, "factory fixture state flags must be initialized");
		g_Assert.equal(RequireEntityState(Entity.Address, "fixture").Index, unFixtureIndex, "factory fixture must resolve BigInt addresses");
		g_Assert.strictEqual(RequireEntityState(unFixtureIndex, "fixture").State, State);
		g_Assert.throws(() => RequireEntityState(Number(Entity.Address), "fixture"), /invalid entity/, "factory fixture must reject Number native addresses");

		for (const strPropertyName of ["StateFlags", "NetworkSerialNumber"]) {
			for (const nValue of [-1, 0, 1]) {
				Entity[strPropertyName] = nValue;
				g_Assert.equal(Entity[strPropertyName], nValue, "factory fixture live fields accept signed integers");
			}

			for (const InvalidValue of [undefined, null, true, "1", 1n, NaN, Infinity, 0.5, g_nMinimumFixtureInteger - 1, g_nMaximumFixtureInteger + 1]) {
				const nPreviousValue = Entity[strPropertyName];
				g_Assert.throws(() => {
					Entity[strPropertyName] = InvalidValue;
				}, TypeError, "factory fixture live fields reject non-Int32 Number inputs");
				g_Assert.equal(Entity[strPropertyName], nPreviousValue, "invalid factory fixture writes preserve prior state");
			}
		}

		Entity.Free = true;
		g_Assert.equal(Entity.Address, 0n, "invalid factory fixture address must be BigInt zero");
		g_Assert.equal(Entity.HandleValue, -1, "invalid factory fixture handle must be signed -1");
		for (const strPropertyName of ["BaseEntity", "BaseHandle", "Edict"]) {
			g_Assert.equal(Entity[strPropertyName], null, "invalid factory fixture views must be null");
		}

		Entity.Free = false;
		g_Assert.equal(Entity.Address, 0x204000n, "reattached factory fixture address must be exact");
		g_Assert.equal(Entity.RemoveEntity(), true);
		g_Assert.equal(Entity.Address, 0n, "removed factory fixture address must be BigInt zero");
		g_Assert.throws(() => RequireEntityState(0x204000n, "fixture"), /invalid entity/);
	} finally {
		g_mapEntityStates.delete(unFixtureIndex);
		g_mapAddressIndexes.delete(State.Address);
		g_vecNativeCalls.length = unPreviousNativeCallCount;
	}

	g_Assert.equal(g_mapEntityStates.has(unFixtureIndex), false, "factory fixture self-check must restore entity state");
	g_Assert.equal(g_mapAddressIndexes.has(0x204000n), false, "factory fixture self-check must restore address indexes");
}

VerifyFactoryEntityFixture();

function CreateEntity(strClassName, Options = undefined) {
	const strRequiredClassName = RequireClassName(strClassName, "entities/factories.CreateEntityByClassName(strClassName, Options?)");
	const ParsedOptions = CreateEntityOptions(Options, "entities/factories.CreateEntityByClassName(strClassName, Options?)", true);

	if (strRequiredClassName === "sourcejs_missing_class") {
		return null;
	}

	const unIndex = g_unNextEntityIndex;
	g_unNextEntityIndex += 1;
	const State = InstallEntity(unIndex, strRequiredClassName, ParsedOptions);

	for (const Record of ParsedOptions.KeyValues) {
		State.KeyValues.set(Record.Key, RenderKeyValue(Record));
	}

	State.Spawned = ParsedOptions.DispatchSpawn;
	g_vecNativeCalls.push(["CreateEntityByClassName", strRequiredClassName, unIndex, ParsedOptions.DispatchSpawn, ParsedOptions.KeyValues]);

	return MakeEntity(unIndex);
}

function CreateAndSpawnEntity(strClassName, Options = undefined) {
	const strRequiredClassName = RequireClassName(strClassName, "entities/factories.CreateAndSpawnEntityByClassName(strClassName, Options?)");
	const ParsedOptions = CreateEntityOptions(Options, "entities/factories.CreateAndSpawnEntityByClassName(strClassName, Options?)", false);

	if (strRequiredClassName === "sourcejs_missing_class") {
		return null;
	}

	const unIndex = g_unNextEntityIndex;
	g_unNextEntityIndex += 1;
	const State = InstallEntity(unIndex, strRequiredClassName, ParsedOptions);

	for (const Record of ParsedOptions.KeyValues) {
		State.KeyValues.set(Record.Key, RenderKeyValue(Record));
	}

	State.Spawned = true;
	g_vecNativeCalls.push(["CreateAndSpawnEntityByClassName", strRequiredClassName, unIndex, ParsedOptions.KeyValues]);

	return MakeEntity(unIndex);
}

function DispatchEntitySpawn(EntityReference) {
	const { Index: unEntityIndex, State } = RequireEntityState(EntityReference, "entities/factories.DispatchEntitySpawn(EntityReference)");
	State.Spawned = true;
	g_vecNativeCalls.push(["DispatchEntitySpawn", unEntityIndex]);

	return true;
}

function SetEntityKeyValue(EntityReference, strKeyName, Value) {
	const { Index: unEntityIndex, State } = RequireEntityState(EntityReference, "entities/factories.SetEntityKeyValue(EntityReference, strKeyName, Value)");
	const Record = CreateKeyValueRecord(strKeyName, Value, "entities/factories.SetEntityKeyValue(EntityReference, strKeyName, Value)");

	if (strKeyName === "sourcejs_rejected_key") {
		return false;
	}

	State.KeyValues.set(strKeyName, RenderKeyValue(Record));
	g_vecNativeCalls.push(["SetEntityKeyValue", unEntityIndex, Record]);

	return true;
}

function GetEntityKeyValue(EntityReference, strKeyName, nMaximumLength = g_unDefaultKeyValueBufferLength) {
	const { Index: unEntityIndex, State } = RequireEntityState(EntityReference, "entities/factories.GetEntityKeyValue(EntityReference, strKeyName, nMaximumLength?)");

	if ((typeof strKeyName !== "string") || (strKeyName.length === 0)) {
		throw new TypeError("entities/factories.GetEntityKeyValue expects a non-empty string strKeyName.");
	}

	if ((nMaximumLength !== undefined) && (nMaximumLength !== null) && (!Number.isInteger(nMaximumLength) || (nMaximumLength <= 0) || (nMaximumLength > g_nMaximumFixtureInteger))) {
		throw new TypeError("entities/factories.GetEntityKeyValue expects a positive integer nMaximumLength.");
	}

	const unBufferLength = nMaximumLength ?? g_unDefaultKeyValueBufferLength;
	const strValue = State.KeyValues.get(strKeyName);

	g_vecNativeCalls.push(["GetEntityKeyValue", unEntityIndex, strKeyName, unBufferLength]);

	if ((strValue === undefined) || ((strValue.length + 1) > unBufferLength)) {
		return null;
	}

	return strValue;
}

function FindEntityByHammerID(unHammerID) {
	const unRequiredHammerID = RequireHammerID(unHammerID, "entities/factories.FindEntityByHammerID(unHammerID)");
	for (const [unIndex, State] of g_mapEntityStates) {
		if (!State.Free && (State.HammerID === unRequiredHammerID)) {
			g_vecNativeCalls.push(["FindEntityByHammerID", unRequiredHammerID, unIndex]);
			return MakeEntity(unIndex);
		}
	}

	g_vecNativeCalls.push(["FindEntityByHammerID", unRequiredHammerID, null]);

	return null;
}

function DestroyEntityByHammerID(unHammerID) {
	const unRequiredHammerID = RequireHammerID(unHammerID, "entities/factories.DestroyEntityByHammerID(unHammerID)");
	const Entity = FindEntityByHammerID(unRequiredHammerID);
	if (!Entity) {
		return false;
	}

	const bDestroyed = RemoveEntity(Entity.Index);
	g_vecNativeCalls.push(["DestroyEntityByHammerID", unRequiredHammerID, bDestroyed]);

	return bDestroyed;
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

function ExecuteDocumentationBlock(strSource, unIndex, Modules, BeforeUnload = null) {
	const Script = new g_VM.Script(`(function (require, module, console) {\n${strSource}\n})`, { filename: `entities-factories.md:block-${unIndex + 1}` });
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
			throw new Error("Entity factory documentation must use the typed logger.");
		},
	};

	Callback(DocumentationRequire, PluginModule, DocumentationConsole);

	g_Assert.equal(Object.hasOwn(PluginModule.exports, "unload"), false, "Documentation must not export lowercase Unload aliases.");

	if (typeof PluginModule.exports.Unload === "function") {
		if (BeforeUnload) {
			BeforeUnload();
		}

		PluginModule.exports.Unload();
	}
}

g_Assert.throws(() => ExecuteDocumentationBlock('console.log("unexpected");', 0, {}), /Entity factory documentation must use the typed logger\./);
g_Assert.throws(() => ExecuteDocumentationBlock("module.exports.unload = () => {};", 0, {}), /Documentation must not export lowercase Unload aliases/);

function VerifyEntityOwnershipDocumentation(vecDocumentationBlocks) {
	const nBlockIndex = vecDocumentationBlocks.findIndex((strSource) => strSource.includes("sourcejs_owned_marker"));
	g_Assert.notEqual(nBlockIndex, -1, "The owned-marker documentation example is missing.");
	const strSource = vecDocumentationBlocks[nBlockIndex];
	const VerifyScenario = (strScenario, strExampleSource, unExpectedRemovalCount, nOriginalHandleValue = 100) => {
		const nOriginalNetworkSerialNumber = 500;
		let nHandleValue = nOriginalHandleValue;
		let nNetworkSerialNumber = nOriginalNetworkSerialNumber;
		let bValid = true;
		let unRemovalCount = 0;
		const MarkerEntity = {
			get Valid() {
				return bValid;
			},
			get HandleValue() {
				return nHandleValue;
			},
			get NetworkSerialNumber() {
				return nNetworkSerialNumber;
			},
			RemoveEntity() {
				unRemovalCount += 1;
				bValid = false;

				return true;
			},
		};
		const BeforeUnload = () => {
			switch (strScenario) {
				case "ChangedHandle":
					nHandleValue += 1;
					break;

				case "ChangedSerial":
					nNetworkSerialNumber += 1;
					break;

				case "RemovedEntity":
					bValid = false;
					break;

				case "OriginalEntity":
					break;

				default:
					throw new Error(`Unknown entity-ownership scenario: ${strScenario}`);
			}
		};
		const Run = () => ExecuteDocumentationBlock(strExampleSource, nBlockIndex, {
			"entities/factories": {
				CreateAndSpawnEntityByClassName(strClassName, Options) {
					g_Assert.equal(strClassName, "info_target");
					g_Assert.equal(Options.targetname, "sourcejs_owned_marker");

					return MarkerEntity;
				},
			},
		}, BeforeUnload);

		if (nOriginalHandleValue === -1) {
			g_Assert.throws(Run, /no native handle for deferred cleanup/);
		} else {
			Run();
		}

		g_Assert.equal(unRemovalCount, unExpectedRemovalCount, `Owned-marker cleanup removed the wrong entity in ${strScenario}.`);
	};

	VerifyScenario("OriginalEntity", strSource, 1);
	VerifyScenario("ChangedHandle", strSource, 0);
	VerifyScenario("ChangedSerial", strSource, 0);
	VerifyScenario("RemovedEntity", strSource, 0);
	VerifyScenario("OriginalEntity", strSource, 1, -1);
	VerifyScenario("OriginalEntity", strSource, 1, -2);

	const strHandleGuard = " || (OwnedEntity.HandleValue !== OwnedEntityRecord.HandleValue)";
	const strSerialGuard = " || (OwnedEntity.NetworkSerialNumber !== OwnedEntityRecord.NetworkSerialNumber)";
	g_Assert.ok(strSource.includes(strHandleGuard), "The owned-marker cleanup must check the saved handle.");
	g_Assert.ok(strSource.includes(strSerialGuard), "The owned-marker cleanup must check the saved network serial.");

	for (const Scenario of [{ Name: "ChangedHandle", Guard: strHandleGuard }, { Name: "ChangedSerial", Guard: strSerialGuard }]) {
		g_Assert.throws(() => VerifyScenario(Scenario.Name, strSource.replace(Scenario.Guard, ""), 0), (ErrorValue) => {
			g_Assert.ok(ErrorValue instanceof g_Assert.AssertionError, "Ownership mutations must reach a cleanup assertion.");
			g_Assert.equal(ErrorValue.message.includes(`Owned-marker cleanup removed the wrong entity in ${Scenario.Name}.`), true, ErrorValue.message);

			return true;
		});
	}
}

InstallEntity(10, "info_target", { HammerID: g_unDisposableHammerID, KeyValues: { targetname: "sourcejs_disposable_marker" }, Spawned: true });

const g_NativeFactories = {
	CreateEntityByClassName: CreateEntity,
	CreateAndSpawnEntityByClassName: CreateAndSpawnEntity,
	DestroyEntityByHammerID,
	DispatchEntitySpawn,
	FindEntityByHammerID,
	GetEntityKeyValue,
	SetEntityKeyValue,
};

globalThis.sourcejs = { "entities/factories": g_NativeFactories };

delete require.cache[g_strFactoriesPath];
delete require.cache[g_strRuntimePath];

const g_Factories = require(g_strFactoriesPath);
g_Assert.equal(g_Factories, g_NativeFactories);
g_Assert.deepEqual(Object.keys(g_Factories).sort(), g_vecExpectedExports.slice().sort());

const g_DirectEntity = g_Factories.CreateEntityByClassName("info_target", {
	DispatchSpawn: false,
	KeyValues: {
		origin: { X: 1, Y: 2, Z: 3 },
		spawnflags: 4,
		targetname: "sourcejs_direct_test",
	},
});
g_Assert.equal(g_DirectEntity.Valid, true);
g_Assert.equal(g_mapEntityStates.get(g_DirectEntity.Index).Spawned, false);
g_Assert.equal(g_Factories.GetEntityKeyValue(g_DirectEntity.Address, "origin"), "1 2 3");
g_Assert.equal(g_Factories.GetEntityKeyValue(g_DirectEntity.Index, "spawnflags"), "4");
g_Assert.equal(g_Factories.DispatchEntitySpawn(g_DirectEntity), true);
g_Assert.equal(g_mapEntityStates.get(g_DirectEntity.Index).Spawned, true);
g_Assert.equal(g_Factories.SetEntityKeyValue(g_DirectEntity, "sourcejs_rejected_key", "value"), false);
g_Assert.equal(g_DirectEntity.RemoveEntity(), true);

g_Assert.equal(g_Factories.CreateEntityByClassName("sourcejs_missing_class"), null);
g_Assert.equal(g_Factories.CreateAndSpawnEntityByClassName("sourcejs_missing_class"), null);
g_Assert.equal(g_Factories.FindEntityByHammerID(987654), null);

g_Assert.throws(() => g_Factories.CreateEntityByClassName(42), /non-empty entity class name/);
g_Assert.throws(() => g_Factories.CreateEntityByClassName("info_target", null), /Options to be a non-array object/);
g_Assert.throws(() => g_Factories.CreateEntityByClassName("info_target", []), /Options to be a non-array object/);
g_Assert.throws(() => g_Factories.CreateEntityByClassName("info_target", { DispatchSpawn: 1 }), /DispatchSpawn to be a boolean/);
g_Assert.throws(() => g_Factories.CreateEntityByClassName("info_target", { DispatchSpawn: true, targetname: "mixed" }), /unknown option: targetname/);
g_Assert.throws(() => g_Factories.CreateAndSpawnEntityByClassName("info_target", { DispatchSpawn: false }), /unknown option: DispatchSpawn/);
g_Assert.throws(() => g_Factories.CreateEntityByClassName("info_target", { KeyValues: null }), /KeyValues to be a non-array object/);
g_Assert.throws(() => g_Factories.CreateEntityByClassName("info_target", { origin: [1, 2] }), /three-component vector KeyValues/);
g_Assert.throws(() => g_Factories.CreateEntityByClassName("info_target", { origin: { X: 1, Y: 2 } }), /finite numeric X, Y, and Z/);
g_Assert.throws(() => g_Factories.CreateEntityByClassName("info_target", { targetname: true }), /string, finite number or three-component vector/);
g_Assert.throws(() => g_Factories.SetEntityKeyValue(9999, "targetname", "missing"), /invalid entity/);
g_Assert.throws(() => g_Factories.SetEntityKeyValue(10, 123, "value"), /non-empty KeyValue names/);
g_Assert.throws(() => g_Factories.SetEntityKeyValue(10, "targetname", Number.NaN), /three-component vector KeyValues/);
g_Assert.throws(() => g_Factories.GetEntityKeyValue(10, "targetname", 0), /positive integer nMaximumLength/);
g_Assert.throws(() => g_Factories.FindEntityByHammerID(-1), /non-negative integer Hammer ID/);
g_Assert.throws(() => g_Factories.DestroyEntityByHammerID("4242"), /non-negative integer Hammer ID/);

function VerifyWorldFactoryExample() {
	const strExamplePath = g_Path.join(g_strProjectRoot, "examples", "plugins", "disabled", "api-world-objects", "index.js");
	const strExample = g_FileSystem.readFileSync(strExamplePath, "utf8");
	const vecMatch = strExample.match(/\tLogResult\("entities\/factories live lookup",[\s\S]*?\r?\n\t}\);/);
	g_Assert.ok(vecMatch, "world entity factory callback must remain available");
	g_Assert.equal(g_mapEntityStates.has(0), false, "world factory fixture must not overwrite an existing entity");

	const RunExample = new Function("GetEntitiesByClassName", "GetEntityKeyValue", "FindEntityByHammerID", "LogResult", vecMatch[0]);
	const WorldState = InstallEntity(0, "worldspawn", { KeyValues: { classname: "worldspawn" } });
	const Worldspawn = MakeEntity(0);

	try {
		for (const Profile of [{ Entities: [], HammerID: null }, { Entities: [Worldspawn], HammerID: null }, { Entities: [Worldspawn], HammerID: 0 }]) {
			WorldState.HammerID = Profile.HammerID;

			let Result = undefined;
			RunExample((strClassName) => {
				g_Assert.equal(strClassName, "worldspawn");

				return Profile.Entities;
			}, g_Factories.GetEntityKeyValue, g_Factories.FindEntityByHammerID, (strLabel, Callback) => {
				g_Assert.equal(strLabel, "entities/factories live lookup");
				Result = Callback();
			});
			g_Assert.deepEqual(Result, (Profile.Entities.length === 0) ? null : { ClassNameKeyValue: "worldspawn", IndexForHammerIDZero: Profile.HammerID, Index: 0 });
		}
	} finally {
		g_mapEntityStates.delete(0);
		g_mapAddressIndexes.delete(WorldState.Address);
	}
}

VerifyWorldFactoryExample();

const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
const g_vecDocumentationBlocks = ExtractJavaScriptBlocks(g_strDocumentation);
VerifyEntityOwnershipDocumentation(g_vecDocumentationBlocks);
const g_setExercisedExports = new Set();
const g_DocumentedFactories = TrackModule(g_Factories, g_setExercisedExports);

g_Assert.equal(g_vecDocumentationBlocks.length, 10);
g_Assert.doesNotMatch(g_strDocumentation, /generated by|auto-generated|example generator/i);
g_Assert.doesNotMatch(g_strDocumentation, /console\.log\(result\)|sourcejs:player:1|make_object|get_object_pointer|addressString/);

for (const strRelatedPath of [
	"entities.md",
	"entities-entity.md",
	"entities-engines.md",
	"entities-props.md",
	"entities-datamaps.md",
	"entities-outputs.md",
	"keyvalues.md",
]) {
	g_Assert.match(g_strDocumentation, new RegExp(`\\(${strRelatedPath.replace(".", "\\.")}\\)`));
}

const g_vecDocumentationLogOperations = [];
for (const [unIndex, strSource] of g_vecDocumentationBlocks.entries()) {
	ExecuteDocumentationBlock(strSource, unIndex, {
		"entities/factories": g_DocumentedFactories,
		loggers: {
			LogInfo(strFormat, Result) {
				g_Assert.match(strFormat, /^[A-Z][A-Za-z]+ Result=%j$/);
				g_Assert.doesNotThrow(() => JSON.stringify(Result));
				g_vecDocumentationLogOperations.push(strFormat);
			},
		},
	});
}

g_Assert.deepEqual(g_vecDocumentationLogOperations, [
	"ReportEntityFactoryCapabilities Result=%j",
	"ExerciseEntityCreationOptions Result=%j",
	"ExerciseCreateAndSpawnEntity Result=%j",
	"ExerciseTypedEntityKeyValues Result=%j",
	"DestroyOwnedHammerEntity Result=%j",
	"ExerciseMarkerClone Result=%j",
]);

for (const strExportName of g_vecExpectedExports) {
	g_Assert.equal(g_setExercisedExports.has(strExportName), true, `Documentation did not reference entities/factories.${strExportName}.`);
}

g_Assert.equal(FindEntityByHammerID(g_unDisposableHammerID), null);

const g_unCreatedEntityIndexMinimum = 100;
for (const [unIndex, State] of g_mapEntityStates) {
	if (unIndex >= g_unCreatedEntityIndexMinimum) {
		g_Assert.equal(State.Free, true, `Documentation leaked entity ${unIndex}.`);
	}
}

for (const strCallName of g_vecExpectedExports) {
	g_Assert.equal(g_vecNativeCalls.some(([strName]) => strName === strCallName), true, `The smoke did not execute ${strCallName}.`);
}

const g_strNativeSource = g_FileSystem.readFileSync(g_strNativeSourcePath, "utf8");
const g_nFactoriesStart = g_strNativeSource.indexOf("// Entity factories");
const g_nFactoriesEnd = g_strNativeSource.indexOf("// Entity datamaps", g_nFactoriesStart);
g_Assert.ok((g_nFactoriesStart >= 0) && (g_nFactoriesEnd > g_nFactoriesStart), "Entity factory native source bounds must be ordered");
const g_strFactoriesSource = g_strNativeSource.slice(g_nFactoriesStart, g_nFactoriesEnd);

g_Assert.match(g_strFactoriesSource, /ReadEntityFactoryOptions[\s\S]*?"entities\/factories\.CreateEntityByClassName\(strClassName, Options\?\)"/s);
g_Assert.match(g_strFactoriesSource, /ReadEntityFactoryKeyValues[\s\S]*?"entities\/factories\.CreateEntityByClassName\(strClassName, Options\?\)"/s);
g_Assert.match(g_strFactoriesSource, /accepts only string, finite number or three-component vector KeyValues/);
g_Assert.match(g_strFactoriesSource, /HasOwnProperty/);
g_Assert.match(g_strFactoriesSource, /if constexpr \(kEntityFactoriesHasDestroyHammerID<TServerTools>\)/);
g_Assert.match(g_strFactoriesSource, /pServerTools->DestroyEntityByHammerId\(nHammerID\)/);
g_Assert.match(g_strFactoriesSource, /CreateEntityByClassNameCallback[\s\S]*?if \(\(CallbackInformation\.Length\(\) < kRequiredArgumentCount\) \|\| !CallbackInformation\[kClassNameArgumentIndex\]->IsString\(\)\)/s);
g_Assert.match(g_strFactoriesSource, /CreateAndSpawnEntityByClassNameCallback[\s\S]*?if \(\(CallbackInformation\.Length\(\) < kRequiredArgumentCount\) \|\| !CallbackInformation\[kClassNameArgumentIndex\]->IsString\(\)\)/s);
g_Assert.doesNotMatch(g_strFactoriesSource, /entities\.factories|EntityFactoriesUnavailable/);
g_Assert.ok(g_strFactoriesSource.indexOf("ReadEntityFactoryKeyValues") < g_strFactoriesSource.indexOf("CreateEntityByName"));

const g_ReducedFactories = {
	CreateEntityByClassName: CreateEntity,
	CreateAndSpawnEntityByClassName: CreateAndSpawnEntity,
	DispatchEntitySpawn,
	FindEntityByHammerID,
	GetEntityKeyValue,
	SetEntityKeyValue,
};

globalThis.sourcejs = { "entities/factories": g_ReducedFactories };
delete require.cache[g_strFactoriesPath];

const g_ReducedAPI = require(g_strFactoriesPath);
g_Assert.equal(g_ReducedAPI, g_ReducedFactories);
g_Assert.equal(Object.hasOwn(g_ReducedAPI, "DestroyEntityByHammerID"), false);

delete require.cache[g_strFactoriesPath];
delete require.cache[g_strRuntimePath];
delete globalThis.sourcejs;

g_Assert.throws(() => require(g_strFactoriesPath), /SourceJS native runtime is not installed/);

console.log("[  OK  ] entities/factories API and documentation contracts passed");

g_Module._load = g_OriginalModuleLoad;
