"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strDictionaryPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "entities", "dictionary.js");
const g_strRuntimePath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "internal", "runtime.js");
const g_strListenersPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs", "listeners.js");
const g_strDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "entities-dictionary.md");
const g_strNativeBindingsPath = g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "modules", "ModuleBindings.cpp");
const g_vecExpectedExports = [
	"ENTITY_DICTIONARY",
	"Entity",
	"EntityDictionary",
	"SyncedEntityDictionary",
	"GetAllEntities",
	"GetEntity",
	"GetEntityDictionaryEntries",
	"GetEntityFromDictionary",
	"HasEntityInDictionary",
	"GetEntityDictionaryKeys",
	"GetEntityDictionaryValues",
];

const g_unEntityBaseAddress = 0x1000n;
const g_unEntityAddressStride = 0x100n;
const g_unFixtureEdictBaseAddress = 0x100000n;
const g_unFixtureEdictAddressStride = 0x80n;
const g_unFixtureHandleBase = 0x10000;
const g_unFixtureHandleSerialNumber = 1;
const g_unFixtureNetworkSerialBase = 100;
const g_nMinimumFixtureInteger = -0x80000000;
const g_nMaximumFixtureInteger = 0x7FFFFFFF;

const g_OriginalModuleLoad = g_Module._load;
g_Module._load = function Load(strRequestName, ParentModule, bIsMain) {
	if (strRequestName === "internal/runtime") {
		return require(g_strRuntimePath);
	}

	if (strRequestName === "listeners") {
		return require(g_strListenersPath);
	}

	return g_OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
};

function VerifyDictionaryCleanupFailures() {
	const unCreationRemovalFailureMask = 0x01;
	const unDeletionRemovalFailureMask = 0x02;

	const strSource = g_FileSystem.readFileSync(g_strDictionaryPath, "utf8");
	const vecFailureValues = [new Error("cleanup failure"), { Failure: "opaque" }, null, undefined, false, 0, ""];
	let unScenarioCount = 0;
	for (const FailureValue of vecFailureValues) {
		const CleanupFailureValue = vecFailureValues[(vecFailureValues.indexOf(FailureValue) + 1) % vecFailureValues.length];
		for (const strStage of ["Synchronization", "Registration", "Unload"]) {
			const unFailureMaskLimit = (strStage === "Unload") ? 4 : 2;
			for (let unFailureMask = 0x00; unFailureMask < unFailureMaskLimit; unFailureMask += 1) {
				const vecCleanupAttempts = [];
				let bFailCreationRemoval = false;
				let bFailDeletionRemoval = (strStage !== "Unload") && Boolean(unFailureMask);
				const CreateManager = (strName) => ({
					Callbacks: new Set(),
					RegisterListener(Callback) {
						if ((strName === "Creation") && (strStage === "Registration")) {
							throw FailureValue;
						}

						this.Callbacks.add(Callback);

						return Callback;
					},
					UnregisterListener(Callback) {
						vecCleanupAttempts.push(strName);
						if ((strName === "Creation") ? bFailCreationRemoval : bFailDeletionRemoval) {
							throw (strName === "Creation") ? FailureValue : CleanupFailureValue;
						}

						g_Assert.equal(this.Callbacks.delete(Callback), true);

						return true;
					},
				});
				const CreationManager = CreateManager("Creation");
				const DeletionManager = CreateManager("Deletion");
				const ModuleRecord = { exports: {} };
				const RequireDependency = (strName) => {
					if (strName === "internal/runtime") {
						return {
							GetModule(strModuleName) {
								g_Assert.ok(["entities/dictionary", "entities/helpers"].includes(strModuleName));

								return {};
							},
						};
					}

					g_Assert.equal(strName, "listeners");

					return { NetworkedEntityCreatedManager: CreationManager, NetworkedEntityDeletedManager: DeletionManager };
				};
				g_VM.runInNewContext(strSource, { module: ModuleRecord, require: RequireDependency }, { filename: g_strDictionaryPath });

				let mapTargetDictionary = null;

				class TrackedDictionary extends ModuleRecord.exports.SyncedEntityDictionary {
					Resynchronize() {
						mapTargetDictionary = this;

						if (strStage === "Synchronization") {
							throw FailureValue;
						}

						return super.Resynchronize();
					}
				}

				const CachedValue = {};
				let Operation = () => new TrackedDictionary(() => ({}), []);

				if (strStage === "Unload") {
					Operation();
					mapTargetDictionary.set(1, CachedValue);
					bFailCreationRemoval = Boolean(unFailureMask & unCreationRemovalFailureMask);
					bFailDeletionRemoval = Boolean(unFailureMask & unDeletionRemovalFailureMask);
					Operation = () => mapTargetDictionary.Unload();
				}

				let bCaught = false;
				let CaughtError = undefined;
				try {
					Operation();
				} catch (ErrorValue) {
					bCaught = true;
					CaughtError = ErrorValue;
				}

				const unExpectedErrorCount = (strStage === "Unload") ? (Number(bFailCreationRemoval) + Number(bFailDeletionRemoval)) : (1 + Number(bFailDeletionRemoval));
				g_Assert.equal(bCaught, unExpectedErrorCount !== 0);

				if (unExpectedErrorCount === 1) {
					g_Assert.strictEqual(CaughtError, ((strStage === "Unload") && bFailDeletionRemoval) ? CleanupFailureValue : FailureValue);
				} else if (unExpectedErrorCount === 2) {
					g_Assert.ok((CaughtError !== null) && (typeof CaughtError === "object") && (CaughtError.name === "AggregateError"), "Dictionary cleanup must preserve both failures.");
					g_Assert.deepEqual(Array.from(CaughtError.errors), [FailureValue, CleanupFailureValue]);
				}

				g_Assert.deepEqual(vecCleanupAttempts, (strStage === "Unload") ? ["Creation", "Deletion"] : ["Deletion"], "Every independent dictionary cleanup must be attempted.");
				g_Assert.equal(mapTargetDictionary.NetworkedEntityCreatedListenerRegistered, bFailCreationRemoval);
				g_Assert.equal(mapTargetDictionary.NetworkedEntityDeletedListenerRegistered, bFailDeletionRemoval);
				const bNeedsRetry = bFailCreationRemoval || bFailDeletionRemoval;
				bFailCreationRemoval = false;
				bFailDeletionRemoval = false;
				g_Assert.equal(mapTargetDictionary.Unload(), bNeedsRetry);
				g_Assert.equal(mapTargetDictionary.NetworkedEntityCreatedListenerRegistered, false);
				g_Assert.equal(mapTargetDictionary.NetworkedEntityDeletedListenerRegistered, false);
				g_Assert.equal(CreationManager.Callbacks.size, 0);
				g_Assert.equal(DeletionManager.Callbacks.size, 1, "The module-owned dictionary remains registered.");
				const unCompletedAttemptCount = vecCleanupAttempts.length;
				g_Assert.equal(mapTargetDictionary.Unload(), false);
				g_Assert.equal(vecCleanupAttempts.length, unCompletedAttemptCount);

				if (strStage === "Unload") {
					g_Assert.strictEqual(mapTargetDictionary.get(1), CachedValue);
				}

				unScenarioCount += 1;
			}
		}
	}

	g_Assert.equal(unScenarioCount, 56);
	console.log("Dictionary cleanup 56 profiles passed.");
}

VerifyDictionaryCleanupFailures();

class ListenerManagerFixture {
	constructor(strEventName) {
		this.EventName = strEventName;
		this.Callbacks = new Set();
	}

	RegisterListener(Callback) {
		if (typeof Callback !== "function") {
			throw new TypeError(`${this.EventName} callback must be a function.`);
		}

		if (this.Callbacks.has(Callback)) {
			throw new Error(`${this.EventName} callback is already registered.`);
		}

		this.Callbacks.add(Callback);

		return Callback;
	}

	UnregisterListener(Callback) {
		if (typeof Callback !== "function") {
			throw new TypeError(`${this.EventName} callback must be a function.`);
		}

		if (!this.Callbacks.delete(Callback)) {
			throw new Error(`${this.EventName} callback is not registered.`);
		}

		return true;
	}

	Emit(Entity) {
		return Array.from(this.Callbacks, (Callback) => Callback(Entity));
	}

	get Size() {
		return this.Callbacks.size;
	}
}

function LoadFactoryDiagnosticFixture(strSource) {
	const CreatedManager = new ListenerManagerFixture("FactoryCreation");
	const DeletedManager = new ListenerManagerFixture("FactoryDeletion");
	const DictionaryRuntime = {};
	const PreviousLoad = g_Module._load;
	g_Module._load = function Load(strName, ParentModule, bIsMain) {
		if (strName === "internal/runtime") {
			return {
				GetModule(strModuleName) {
					g_Assert.ok(["entities/dictionary", "entities/helpers"].includes(strModuleName));

					return (strModuleName === "entities/dictionary") ? DictionaryRuntime : {};
				},
			};
		}

		if (strName === "listeners") {
			return { NetworkedEntityCreatedManager: CreatedManager, NetworkedEntityDeletedManager: DeletedManager };
		}

		return PreviousLoad.call(this, strName, ParentModule, bIsMain);
	};

	try {
		const LoadedModule = new g_Module(g_strDictionaryPath, module);
		LoadedModule.filename = g_strDictionaryPath;
		LoadedModule.paths = g_Module._nodeModulePaths(g_Path.dirname(g_strDictionaryPath));
		LoadedModule._compile(strSource, g_strDictionaryPath);

		return { API: LoadedModule.exports, CreatedManager, DeletedManager };
	} finally {
		g_Module._load = PreviousLoad;
	}
}

function VerifyFactoryDiagnosticCase(strSource, Case, strRoute) {
	const Fixture = LoadFactoryDiagnosticFixture(strSource);
	const Counts = { FactoryCalls: 0, CreatedHooks: 0, Receiver: undefined };
	const Factory = function Factory(unEntityIndex, strOwner) {
		g_Assert.equal(unEntityIndex, 1);
		g_Assert.equal(strOwner, "FactoryOwner");
		g_Assert.strictEqual(this, Counts.Receiver);
		Counts.FactoryCalls++;
		throw Case.Value;
	};

	class SyncedCache extends Fixture.API.SyncedEntityDictionary {
		OnAutomaticallyCreated() {
			Counts.CreatedHooks++;
		}
	}

	const mapCache = (strRoute === "created") ? new SyncedCache(Factory, [], "FactoryOwner") : new Fixture.API.EntityDictionary(Factory, "FactoryOwner");
	Counts.Receiver = mapCache;
	const ExistingRecord = { Existing: true };
	const unExistingIndex = (strRoute === "direct") ? 1 : 2;
	mapCache.set(unExistingIndex, ExistingRecord);

	try {
		let CaughtError = undefined;
		let bThrew = false;
		try {
			if (strRoute === "get") {
				mapCache.get(1);
			} else if (strRoute === "direct") {
				mapCache.CreateMissingEntity(1);
			} else {
				g_Assert.equal(strRoute, "created");
				mapCache.OnNetworkedEntityCreated({ Index: 1 });
			}
		} catch (Failure) {
			bThrew = true;
			CaughtError = Failure;
		}

		g_Assert.equal(bThrew, true);
		g_Assert.ok(CaughtError instanceof Error);
		g_Assert.ok(Object.hasOwn(CaughtError, "cause"), "Factory diagnostic formatting lost original cause.");
		g_Assert.strictEqual(CaughtError.cause, Case.Value, "Factory diagnostic formatting lost original cause.");
		const strExpectedMessage = Case.Fallback ? "Unable to create entity: factory failure details are unavailable." : `Unable to create entity for index 1: ${Case.Suffix}`;
		g_Assert.equal(CaughtError.message, strExpectedMessage);
		g_Assert.equal(Counts.FactoryCalls, 1);
		g_Assert.equal(Counts.CreatedHooks, 0);
		g_Assert.equal(mapCache.size, 1);
		g_Assert.strictEqual(Map.prototype.get.call(mapCache, unExistingIndex), ExistingRecord);
		g_Assert.equal(mapCache.NetworkedEntityDeletedListenerRegistered, true);

		if (strRoute === "created") {
			g_Assert.equal(mapCache.NetworkedEntityCreatedListenerRegistered, true);
		}
	} finally {
		g_Assert.equal(mapCache.Unload(), true);
		g_Assert.equal(mapCache.Unload(), false);
		g_Assert.equal(Fixture.API.ENTITY_DICTIONARY.Unload(), true);
		g_Assert.equal(Fixture.CreatedManager.Size, 0);
		g_Assert.equal(Fixture.DeletedManager.Size, 0);
	}
}

function VerifyFactoryDiagnostics() {
	const strSource = g_FileSystem.readFileSync(g_strDictionaryPath, "utf8");
	const vecOrdinaryCases = [
		{ Value: undefined, Suffix: "undefined" },
		{ Value: null, Suffix: "null" },
		{ Value: false, Suffix: "false" },
		{ Value: 0, Suffix: "0" },
		{ Value: -0, Suffix: "0" },
		{ Value: "", Suffix: "" },
		{ Value: true, Suffix: "true" },
		{ Value: 42, Suffix: "42" },
		{ Value: Number.NaN, Suffix: "NaN" },
		{ Value: Infinity, Suffix: "Infinity" },
		{ Value: -(1n << 63n), Suffix: "-9223372036854775808" },
		{ Value: (1n << 64n) - 1n, Suffix: "18446744073709551615" },
		{ Value: "Factory text", Suffix: "Factory text" },
		{ Value: Symbol("Factory"), Suffix: "Symbol(Factory)" },
		{ Value: new Error("Ordinary"), Suffix: "Ordinary" },
		{ Value: new TypeError("Typed"), Suffix: "Typed" },
		{
			Value: {
				toString() {
					return "Custom text";
				},
			},
			Suffix: "Custom text",
		},
		{ Value: g_VM.runInNewContext('new Error("Foreign")'), Suffix: "Error: Foreign" },
	];
	const vecInvalidCases = [];
	for (const SecondaryError of [new Error("Secondary formatter failure"), undefined, null, 0, "", Symbol("Secondary")]) {
		vecInvalidCases.push({
			Value: {
				toString() {
					throw SecondaryError;
				},
			},
			Fallback: true,
		});
	}

	const PoisonedMessageError = new Error("Ignored");
	Object.defineProperty(PoisonedMessageError, "message", {
		get() {
			throw new Error("Message getter failure");
		},
	});
	const PoisonedMessageValueError = new Error("Ignored");
	PoisonedMessageValueError.message = {
		toString() {
			throw 0;
		},
	};
	const SymbolMessageError = new Error("Ignored");
	SymbolMessageError.message = Symbol("Message");
	vecInvalidCases.push(
		{ Value: PoisonedMessageError, Fallback: true },
		{ Value: PoisonedMessageValueError, Fallback: true },
		{ Value: SymbolMessageError, Fallback: true },
		{ Value: Object.create(null), Fallback: true },
		{
			Value: {
				[Symbol.toPrimitive]() {
					return {};
				},
			},
			Fallback: true,
		},
		{
			Value: new Proxy({}, {
				getPrototypeOf() {
					throw new Error("Prototype failure");
				},
			}),
			Fallback: true,
		},
	);
	const vecRoutes = ["get", "direct", "created"];
	for (const Case of [...vecOrdinaryCases, ...vecInvalidCases]) {
		for (const strRoute of vecRoutes) {
			VerifyFactoryDiagnosticCase(strSource, Case, strRoute);
		}
	}

	// Negative controls bypass only the formatting guard in memory; no source/snapshot file dependency.
	g_Assert.equal(Array.from(strSource.matchAll(/\bcatch\s*\{/g)).length, 1, "The formatting guard must be the only anonymous catch in this module.");
	const strUnguardedSource = strSource.replace(/\bcatch\s*\{/, "catch (DiagnosticFailure) {\n\t\t\t\tthrow DiagnosticFailure;");
	for (const Case of vecOrdinaryCases) {
		for (const strRoute of vecRoutes) {
			VerifyFactoryDiagnosticCase(strUnguardedSource, Case, strRoute);
		}
	}

	for (const strRoute of vecRoutes) {
		g_Assert.throws(() => VerifyFactoryDiagnosticCase(strUnguardedSource, vecInvalidCases[0], strRoute), (Failure) => (Failure.code === "ERR_ASSERTION") && Failure.message.includes("Factory diagnostic formatting lost original cause."));
	}

	const unCurrentCases = (vecOrdinaryCases.length + vecInvalidCases.length) * vecRoutes.length;
	const unOrdinaryControls = vecOrdinaryCases.length * vecRoutes.length;
	console.log(`Dictionary factory diagnostics ${unCurrentCases} cases, ${unOrdinaryControls} ordinary mutation controls, and ${vecRoutes.length} cause-loss negative controls passed.`);
}

VerifyFactoryDiagnostics();

const g_NetworkedEntityCreatedManager = new ListenerManagerFixture("NetworkedEntityCreated");
const g_NetworkedEntityDeletedManager = new ListenerManagerFixture("NetworkedEntityDeleted");
const g_mapEntityStates = new Map();

function GetNativeEntityIndex(Value) {
	if ((Value !== null) && ((typeof Value === "object") || (typeof Value === "function"))) {
		Value = Value.Index;
	}

	if (!Number.isInteger(Value) || (Value < g_nMinimumFixtureInteger) || (Value > g_nMaximumFixtureInteger)) {
		return -1;
	}

	return Value;
}

// Controlled Number inputs and synthetic handles below do not model SDK storage widths or bit packing.
function RequireFixtureInteger(nValue, strErrorMessage) {
	if (!Number.isInteger(nValue) || (nValue < g_nMinimumFixtureInteger) || (nValue > g_nMaximumFixtureInteger)) {
		throw new TypeError(strErrorMessage);
	}

	return (nValue === 0) ? 0 : nValue;
}

function MakeEntity(unEntityIndex, strEntityClassName) {
	// Synthetic addresses/serials exercise record snapshots, not SDK layout or entity identity.
	const unBaseEntityAddress = g_unEntityBaseAddress + BigInt(unEntityIndex) * g_unEntityAddressStride;
	const unEdictAddress = g_unFixtureEdictBaseAddress + BigInt(unEntityIndex) * g_unFixtureEdictAddressStride;
	const State = {
		ClassName: strEntityClassName,
		Free: false,
		HandleValue: g_unFixtureHandleBase + unEntityIndex,
		HandleSerialNumber: g_unFixtureHandleSerialNumber,
		Index: unEntityIndex,
		Inputs: [],
		NetworkSerialNumber: g_unFixtureNetworkSerialBase + unEntityIndex,
		Removed: false,
		Slain: false,
		StateFlags: 0x00,
	};
	const Entity = {
		CallEntityInput(strInputName, Value = null, flDelay = 0) {
			State.Inputs.push({ Delay: flDelay, Name: strInputName, Value });

			return true;
		},
		RemoveEntity() {
			State.Removed = true;

			return true;
		},
		SlayEntity() {
			State.Slain = true;

			return true;
		},
	};
	const CreateAddressRecord = (strKind, unAddress) => ({ Kind: strKind, Address: unAddress, Index: State.Index, ClassName: State.ClassName });
	Object.defineProperties(Entity, {
		BaseEntity: {
			enumerable: true,
			get: () => (State.Free || State.Removed) ? null : CreateAddressRecord("baseentity", unBaseEntityAddress),
		},
		BaseHandle: {
			enumerable: true,
			get: () => (State.Free || State.Removed) ? null : { Kind: "basehandle", Value: State.HandleValue, EntryIndex: State.Index, SerialNumber: State.HandleSerialNumber, Valid: true },
		},
		HandleValue: {
			enumerable: true,
			get: () => (State.Free || State.Removed) ? -1 : State.HandleValue,
		},
		ClassName: {
			enumerable: true,
			get: () => (State.Free || State.Removed) ? "" : State.ClassName,
		},
		Edict: {
			enumerable: true,
			get: () => (State.Free || State.Removed) ? null : CreateAddressRecord("edict", unEdictAddress),
		},
		Free: {
			enumerable: true,
			get: () => State.Free || State.Removed,
			set: (bValue) => {
				if (typeof bValue !== "boolean") {
					throw new TypeError("Entity Free must be a boolean.");
				}

				State.Free = bValue;
			},
		},
		Index: {
			enumerable: true,
			get: () => State.Index,
		},
		NetworkSerialNumber: {
			enumerable: true,
			get: () => State.NetworkSerialNumber,
			set: (nValue) => {
				State.NetworkSerialNumber = RequireFixtureInteger(nValue, "Entity.NetworkSerialNumber requires an integer.");
			},
		},
		Address: {
			enumerable: true,
			get: () => (State.Free || State.Removed) ? 0n : unBaseEntityAddress,
		},
		StateFlags: {
			enumerable: true,
			get: () => State.StateFlags,
			set: (nValue) => {
				State.StateFlags = RequireFixtureInteger(nValue, "Entity.StateFlags requires an integer.");
			},
		},
		Valid: {
			enumerable: true,
			get: () => !State.Free && !State.Removed,
		},
	});

	State.Entity = Entity;
	g_mapEntityStates.set(unEntityIndex, State);

	return Entity;
}

function GetCurrentStates() {
	return Array.from(g_mapEntityStates.values()).filter((State) => !State.Free && !State.Removed).sort((LeftState, RightState) => LeftState.Index - RightState.Index);
}

function GetEntityFromIndex(nEntityIndex) {
	const State = g_mapEntityStates.get(nEntityIndex);
	if (!State || State.Free || State.Removed) {
		return null;
	}

	return State.Entity;
}

function GetNativeAll() {
	const Registry = {};
	const vecStates = GetCurrentStates();
	for (const State of vecStates) {
		Object.defineProperty(Registry, State.Index, { configurable: true, enumerable: true, value: State.Entity, writable: true });
	}

	Object.defineProperty(Registry, "Count", { configurable: true, enumerable: true, value: vecStates.length, writable: true });

	return Registry;
}

function GetNativeEntity(Value) {
	if (arguments.length === 0) {
		throw new TypeError("GetEntityFromDictionary(EntityValue) expects an entity selector.");
	}

	return GetEntityFromIndex(GetNativeEntityIndex(Value));
}

function GetNativeEntityByIndex(nEntityIndex) {
	const nCheckedEntityIndex = RequireFixtureInteger(nEntityIndex, "GetEntity(nEntityIndex) expects an integer entity index.");

	return GetEntityFromIndex(nCheckedEntityIndex);
}

function HasNativeEntity(Value) {
	if (arguments.length === 0) {
		throw new TypeError("HasEntityInDictionary(EntityValue) expects an entity selector.");
	}

	return GetNativeEntity(Value) !== null;
}

function GetNativeKeys() {
	return GetCurrentStates().map((State) => State.Index);
}

function GetNativeValues() {
	return GetCurrentStates().map((State) => State.Entity);
}

function GetNativeEntries() {
	return GetCurrentStates().map((State) => [State.Index, State.Entity]);
}

function GetIndexFromIntegerHandle(nIntegerHandle) {
	const nCheckedHandle = RequireFixtureInteger(nIntegerHandle, "GetEntityIndexFromIntegerHandle(nIntegerHandle) expects an integer handle.");
	for (const State of g_mapEntityStates.values()) {
		if (State.HandleValue === nCheckedHandle) {
			return State.Index;
		}
	}

	return -1;
}

function VerifyEntityRecordSnapshots(CreateEntity = MakeEntity) {
	const unEntityIndex = 64;
	const PreviousState = g_mapEntityStates.get(unEntityIndex);
	const Entity = CreateEntity(unEntityIndex, "prop_snapshot_fixture");
	try {
		const State = g_mapEntityStates.get(unEntityIndex);
		const BaseRecord = Entity.BaseEntity;
		const EdictRecord = Entity.Edict;
		const HandleRecord = Entity.BaseHandle;
		for (const [strPropertyName, Record] of [["BaseEntity", BaseRecord], ["Edict", EdictRecord]]) {
			g_Assert.deepEqual(Object.keys(Record), ["Kind", "Address", "Index", "ClassName"], "Entity properties must return address snapshot records.");
			g_Assert.notStrictEqual(Entity[strPropertyName], Record, "Entity properties must create fresh snapshots.");
			g_Assert.equal(Record.Index, unEntityIndex);
			g_Assert.equal(Record.ClassName, "prop_snapshot_fixture");
			g_Assert.equal(typeof Record.Address, "bigint");
		}

		g_Assert.equal(BaseRecord.Kind, "baseentity");
		g_Assert.equal(BaseRecord.Address, Entity.Address);
		g_Assert.equal(EdictRecord.Kind, "edict");
		g_Assert.equal(EdictRecord.Address, g_unFixtureEdictBaseAddress + BigInt(unEntityIndex) * g_unFixtureEdictAddressStride);
		g_Assert.deepEqual(Object.keys(HandleRecord), ["Kind", "Value", "EntryIndex", "SerialNumber", "Valid"], "Entity properties must return handle snapshot records.");
		g_Assert.notStrictEqual(Entity.BaseHandle, HandleRecord, "Entity properties must create fresh snapshots.");
		g_Assert.deepEqual(HandleRecord, { Kind: "basehandle", Value: Entity.HandleValue, EntryIndex: unEntityIndex, SerialNumber: g_unFixtureHandleSerialNumber, Valid: true });
		g_Assert.equal(Object.hasOwn(Entity, "IsEntityMarkedForDeletion"), false, "A fixture-only deletion marker must not appear as a native Entity method.");

		State.ClassName = "prop_changed_fixture";
		State.HandleValue++;
		g_Assert.equal(Entity.ClassName, State.ClassName);
		g_Assert.equal(Entity.BaseEntity.ClassName, State.ClassName);
		g_Assert.equal(Entity.BaseHandle.Value, State.HandleValue);
		g_Assert.equal(BaseRecord.ClassName, "prop_snapshot_fixture");
		g_Assert.equal(EdictRecord.ClassName, "prop_snapshot_fixture");
		g_Assert.equal(HandleRecord.Value, g_unFixtureHandleBase + unEntityIndex);

		BaseRecord.ClassName = "Detached mutation";
		EdictRecord.Address = 0n;
		HandleRecord.Value = 0;
		g_Assert.equal(Entity.ClassName, "prop_changed_fixture");
		g_Assert.equal(Entity.BaseHandle.Value, State.HandleValue);
		g_Assert.notEqual(Entity.Edict.Address, 0n);

		const Registry = GetNativeAll();
		g_Assert.strictEqual(Object.getOwnPropertyDescriptor(Registry, String(unEntityIndex)).value, State.Entity);
		g_Assert.equal(Object.getOwnPropertyDescriptor(Registry, "Count").value, GetCurrentStates().length);

		for (const strInvalidationFlag of ["Free", "Removed"]) {
			State[strInvalidationFlag] = true;
			g_Assert.equal(Entity.Valid, false);
			g_Assert.equal(Entity.Free, true);
			g_Assert.equal(Entity.ClassName, "");
			g_Assert.equal(Entity.Address, 0n);
			g_Assert.equal(Entity.BaseEntity, null);
			g_Assert.equal(Entity.Edict, null);
			g_Assert.equal(Entity.BaseHandle, null);
			g_Assert.equal(Entity.HandleValue, -1);
			State[strInvalidationFlag] = false;
			g_Assert.equal(Entity.Valid, true);
		}
	} finally {
		if (PreviousState === undefined) {
			g_mapEntityStates.delete(unEntityIndex);
		} else {
			g_mapEntityStates.set(unEntityIndex, PreviousState);
		}
	}
}

VerifyEntityRecordSnapshots();

for (const strPropertyName of ["BaseEntity", "Edict", "BaseHandle"]) {
	const CreateStaleRecordFixture = function CreateStaleRecordFixture(unEntityIndex, strClassName) {
		const Entity = MakeEntity(unEntityIndex, strClassName);
		const SavedRecord = Entity[strPropertyName];

		return new Proxy(Entity, {
			get(Target, Property, Receiver) {
				return (Property === strPropertyName) ? SavedRecord : Reflect.get(Target, Property, Receiver);
			},
		});
	};
	g_Assert.throws(() => VerifyEntityRecordSnapshots(CreateStaleRecordFixture), (Failure) => (Failure.code === "ERR_ASSERTION") && Failure.message.includes("Entity properties must create fresh snapshots."));
}

for (const strPropertyName of ["BaseEntity", "Edict", "BaseHandle"]) {
	const CreateLegacyRecordFixture = function CreateLegacyRecordFixture(unEntityIndex, strClassName) {
		const Entity = MakeEntity(unEntityIndex, strClassName);

		return new Proxy(Entity, {
			get(Target, Property, Receiver) {
				if (Property === strPropertyName) {
					return (strPropertyName === "BaseHandle") ? { Value: Target.HandleValue } : Target;
				}

				return Reflect.get(Target, Property, Receiver);
			},
		});
	};
	g_Assert.throws(() => VerifyEntityRecordSnapshots(CreateLegacyRecordFixture), (Failure) => (Failure.code === "ERR_ASSERTION") && Failure.message.includes("snapshot records."));
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
	g_Assert.doesNotMatch(strSource, /console\./, "Documentation must use the typed logger.");

	const Script = new g_VM.Script(`(function (require, module) {\n${strSource}\n})`, { filename: `entities-dictionary.md:block-${unBlockIndex + 1}` });
	const Callback = Script.runInNewContext({});
	const PluginModule = { exports: {} };
	const vecLogRecords = [];
	const DocumentationLogger = {
		LogInfo(strFormat, Result) {
			g_Assert.equal(typeof strFormat, "string");
			g_Assert.match(strFormat, /^[A-Z][A-Za-z]+ Result=%j$/);
			g_Assert.equal(typeof Result, "object");
			g_Assert.notEqual(Result, null);
			vecLogRecords.push({ Format: strFormat, Result: JSON.parse(JSON.stringify(Result)) });
		},
	};
	const RequireDocumentation = (strModuleName) => {
		if (strModuleName === "loggers") {
			return DocumentationLogger;
		}

		if (!Object.hasOwn(Modules, strModuleName)) {
			throw new Error(`Undeclared documentation module: ${strModuleName}`);
		}

		return Modules[strModuleName];
	};
	Callback(RequireDocumentation, PluginModule);

	const vecExpectedFormats = [
		[],
		["InspectEntityRegistry Result=%j"],
		["InspectEntity Result=%j"],
		["CacheDecoratedEntities Result=%j"],
		["ReadEntityCache Result=%j", "ReadMissingEntityCache Result=%j"],
		["HandleEntityDeletion Result=%j"],
		["CreateDeletionMarkedEntity Result=%j"],
		["ReadSharedEntityCache Result=%j"],
		["ResynchronizeEntities Result=%j", "ReadUnsynchronizedEntityCache Result=%j"],
		["SynchronizePropEntities Result=%j"],
	][unBlockIndex];
	g_Assert.deepEqual(vecLogRecords.map((Record) => Record.Format), vecExpectedFormats);

	for (const Record of vecLogRecords) {
		g_Assert(Object.keys(Record.Result).length > 0);

		if (Record.Format === "InspectEntityRegistry Result=%j") {
			g_Assert(Number.isInteger(Record.Result.NativeIndex));
			g_Assert(Record.Result.NativeIndex > 0);
			g_Assert.equal(typeof Record.Result.WrappedClassName, "string");
			g_Assert.equal(Record.Result.WrappedClassName, Record.Result.LookupClassName);
			g_Assert.equal(Record.Result.EntityCount, Record.Result.EntryCount);
			g_Assert.equal(Record.Result.EntryCount, Record.Result.ValueCount);
		}

		if (Record.Format === "InspectEntity Result=%j") {
			g_Assert.match(Record.Result.Address, /^0x[0-9A-F]+$/);
			g_Assert.equal(typeof Record.Result.Valid, "boolean");
		}

		if (Record.Format === "CacheDecoratedEntities Result=%j") {
			g_Assert.equal(Record.Result.CachedIdentity, true);
			g_Assert.equal(Record.Result.FromHandleIdentity, true);
			g_Assert.equal(Record.Result.HasEntity, true);
			g_Assert.equal(Record.Result.Owner, "round-controller");
		}

		if (Record.Format === "HandleEntityDeletion Result=%j") {
			g_Assert.equal(Record.Result.Removed, true);
			g_Assert.equal(Record.Result.RemovedEntityIndexes.length, 1);
		}

		if (Record.Format === "CreateDeletionMarkedEntity Result=%j") {
			g_Assert.equal(Record.Result.ProvisionalEntityIndex, Record.Result.RetainedEntityIndex);
			g_Assert(Record.Result.ProvisionalEntityIndex > 0);
		}

		if (Record.Format === "ResynchronizeEntities Result=%j") {
			g_Assert(Record.Result.AfterCount > 0);
			g_Assert.equal(Record.Result.BeforeCount, Record.Result.AfterCount);
		}

		if (Record.Format === "SynchronizePropEntities Result=%j") {
			g_Assert.equal(Record.Result.AcceptedNonPropEntity, false);
			g_Assert.equal(Record.Result.AcceptedPropEntity, true);
			g_Assert.equal(Record.Result.RemovedPropEntity, true);
		}

		if ((Record.Format === "ReadMissingEntityCache Result=%j") || (Record.Format === "ReadUnsynchronizedEntityCache Result=%j")) {
			g_Assert.equal(typeof Record.Result.Error, "string");
			g_Assert(Record.Result.Error.length > 0);
		}
	}
}

let g_bRejectedDocumentationExecuted = false;
const g_RejectedDocumentationProbe = {
	Run() {
		g_bRejectedDocumentationExecuted = true;
	},
};
g_Assert.throws(() => ExecuteDocumentationBlock('require("Probe").Run(); console.log("Rejected");', 0, { Probe: g_RejectedDocumentationProbe }), (Failure) => (Failure.code === "ERR_ASSERTION") && Failure.message.includes("Documentation must use the typed logger."));
g_Assert.equal(g_bRejectedDocumentationExecuted, false, "Rejected documentation must not execute before logger validation.");

function VerifyDictionaryEntityFixture() {
	const unFixtureIndex = 64;
	const Entity = MakeEntity(unFixtureIndex, "FixtureEntity");
	try {
		g_Assert.equal(Entity.Address, 0x5000n, "dictionary fixture addresses must be exact BigInt values");
		g_Assert.equal(Entity.HandleValue, 0x10040, "dictionary fixture handles remain 32-bit Numbers");
		g_Assert.equal(Entity.BaseHandle.Value, 0x10040);

		for (const strPropertyName of ["StateFlags", "NetworkSerialNumber"]) {
			for (const nValue of [-1, 0, 1]) {
				Entity[strPropertyName] = nValue;
				g_Assert.equal(Entity[strPropertyName], nValue, "dictionary fixture live fields accept signed integers");
			}

			for (const InvalidValue of [undefined, null, true, "1", 1n, NaN, Infinity, 0.5, g_nMinimumFixtureInteger - 1, g_nMaximumFixtureInteger + 1]) {
				const nPreviousValue = Entity[strPropertyName];
				g_Assert.throws(() => {
					Entity[strPropertyName] = InvalidValue;
				}, TypeError, "dictionary fixture live fields reject non-Int32 Number inputs");
				g_Assert.equal(Entity[strPropertyName], nPreviousValue, "invalid dictionary fixture writes preserve prior state");
			}
		}

		Entity.Free = true;
		g_Assert.equal(Entity.Address, 0n, "invalid dictionary fixture address must be BigInt zero");
		g_Assert.equal(Entity.HandleValue, -1, "invalid dictionary fixture handle must be signed -1");
		for (const strPropertyName of ["BaseEntity", "BaseHandle", "Edict"]) {
			g_Assert.equal(Entity[strPropertyName], null, "invalid dictionary fixture views must be null");
		}

		Entity.Free = false;
		g_Assert.equal(Entity.Address, 0x5000n, "reattached dictionary fixture address must be exact");
		g_Assert.equal(Entity.RemoveEntity(), true);
		g_Assert.equal(Entity.Address, 0n, "removed dictionary fixture address must be BigInt zero");
		g_Assert.equal(Entity.HandleValue, -1, "removed dictionary fixture handle must be signed -1");
		for (const strPropertyName of ["BaseEntity", "BaseHandle", "Edict"]) {
			g_Assert.equal(Entity[strPropertyName], null, "removed dictionary fixture views must be null");
		}
	} finally {
		g_mapEntityStates.delete(unFixtureIndex);
	}

	g_Assert.equal(g_mapEntityStates.has(unFixtureIndex), false, "dictionary fixture self-check must restore its state");
}

VerifyDictionaryEntityFixture();

const g_World = MakeEntity(0, "worldspawn");
const g_Player = MakeEntity(1, "CBasePlayer");
const g_PhysicsProp = MakeEntity(2, "prop_physics");

const g_NativeDictionary = {
	GetAllEntities: GetNativeAll,
	GetEntity: GetNativeEntityByIndex,
	GetEntityDictionaryEntries: GetNativeEntries,
	GetEntityFromDictionary: GetNativeEntity,
	HasEntityInDictionary: HasNativeEntity,
	GetEntityDictionaryKeys: GetNativeKeys,
	GetEntityDictionaryValues: GetNativeValues,
};

// Verify actual installed names as source contracts; controlled fixtures are not SDK/ABI execution.
const g_strNativeBindingsSource = g_FileSystem.readFileSync(g_strNativeBindingsPath, "utf8");
const g_nNativeDictionaryInstallStart = g_strNativeBindingsSource.indexOf("v8::Local<v8::Object> const LocalEntityDictionaryModule = MakeModule(pIsolate);");
const g_nNativeDictionaryInstallEnd = g_strNativeBindingsSource.indexOf('InstallModule(pIsolate, LocalContext, LocalSourceJS, "entities/dictionary", LocalEntityDictionaryModule)', g_nNativeDictionaryInstallStart);
g_Assert(g_nNativeDictionaryInstallStart >= 0);
g_Assert(g_nNativeDictionaryInstallEnd > g_nNativeDictionaryInstallStart);
const g_vecInstalledNativeNames = Array.from(g_strNativeBindingsSource.slice(g_nNativeDictionaryInstallStart, g_nNativeDictionaryInstallEnd).matchAll(/SetFunction\(pIsolate, LocalContext, LocalEntityDictionaryModule, "([^"]+)"/g), (vecMatch) => vecMatch[1]);
const g_setPackageExportNames = new Set(["ENTITY_DICTIONARY", "Entity", "EntityDictionary", "SyncedEntityDictionary"]);
const g_vecExpectedNativeNames = g_vecExpectedExports.filter((strName) => !g_setPackageExportNames.has(strName));
g_Assert.deepEqual(g_vecInstalledNativeNames.sort(), g_vecExpectedNativeNames.sort());

const g_NativeHelpers = { GetEntityIndexFromIntegerHandle: GetIndexFromIntegerHandle };

const g_PreviousSourceJS = globalThis.sourcejs;
const g_PreviousListenersModule = require.cache[g_strListenersPath];

require.cache[g_strListenersPath] = {
	exports: {
		NetworkedEntityCreatedManager: g_NetworkedEntityCreatedManager,
		NetworkedEntityDeletedManager: g_NetworkedEntityDeletedManager,
	},
	filename: g_strListenersPath,
	id: g_strListenersPath,
	loaded: true,
};
globalThis.sourcejs = { "entities/dictionary": g_NativeDictionary, "entities/helpers": g_NativeHelpers };
delete require.cache[g_strDictionaryPath];

const g_Dictionary = require(g_strDictionaryPath);
const {
	ENTITY_DICTIONARY,
	Entity,
	EntityDictionary,
	SyncedEntityDictionary,
} = g_Dictionary;

g_Assert.strictEqual(g_Dictionary, g_NativeDictionary);
g_Assert.deepEqual(Object.keys(g_Dictionary).sort(), g_vecExpectedExports.slice().sort());
g_Assert.strictEqual(g_Dictionary.GetAllEntities, GetNativeAll);
g_Assert.strictEqual(g_Dictionary.GetEntity, GetNativeEntityByIndex);
g_Assert.notStrictEqual(g_Dictionary.GetEntity, g_Dictionary.Entity);
g_Assert.equal(typeof g_Dictionary.Entity, "function");
g_Assert.strictEqual(g_Dictionary.GetEntityDictionaryEntries, GetNativeEntries);
g_Assert.strictEqual(g_Dictionary.GetEntityFromDictionary, GetNativeEntity);
g_Assert.strictEqual(g_Dictionary.HasEntityInDictionary, HasNativeEntity);
g_Assert.strictEqual(g_Dictionary.GetEntityDictionaryKeys, GetNativeKeys);
g_Assert.strictEqual(g_Dictionary.GetEntityDictionaryValues, GetNativeValues);

const g_ReplacementKeys = () => [27];
g_NativeDictionary.GetEntityDictionaryKeys = g_ReplacementKeys;
g_Assert.strictEqual(g_Dictionary.GetEntityDictionaryKeys, g_ReplacementKeys);
g_Assert.deepEqual(g_Dictionary.GetEntityDictionaryKeys(), [27]);
g_Dictionary.GetEntityDictionaryKeys = GetNativeKeys;
g_Assert.strictEqual(g_NativeDictionary.GetEntityDictionaryKeys, GetNativeKeys);
g_Assert.equal(g_NetworkedEntityCreatedManager.Size, 0);
g_Assert.equal(g_NetworkedEntityDeletedManager.Size, 1);

const g_Registry = g_Dictionary.GetAllEntities();
g_Assert.equal(g_Registry.Count, 3);
g_Assert.strictEqual(g_Registry[0], g_World);
g_Assert.strictEqual(g_Registry[1], g_Player);
g_Assert.strictEqual(g_Registry[2], g_PhysicsProp);
g_Assert.deepEqual(g_Dictionary.GetEntityDictionaryKeys(), [0, 1, 2]);
g_Assert.deepEqual(g_Dictionary.GetEntityDictionaryValues(), [g_World, g_Player, g_PhysicsProp]);
g_Assert.deepEqual(g_Dictionary.GetEntityDictionaryEntries(), [[0, g_World], [1, g_Player], [2, g_PhysicsProp]]);
g_Assert.strictEqual(g_Dictionary.GetEntity(1), g_Player);
g_Assert.equal(g_Dictionary.GetEntity(-1), null);
g_Assert.equal(g_Dictionary.GetEntity(2047), null);

for (const InvalidIndex of [undefined, null, "1", 1n, 1.5, NaN, Infinity, g_nMinimumFixtureInteger - 1, g_nMaximumFixtureInteger + 1, { Index: 1 }]) {
	g_Assert.throws(() => g_Dictionary.GetEntity(InvalidIndex), TypeError);
}

g_Assert.throws(() => g_Dictionary.GetEntity(), TypeError);
g_Assert.throws(() => g_Dictionary.GetEntityFromDictionary(), TypeError);
g_Assert.throws(() => g_Dictionary.HasEntityInDictionary(), TypeError);
g_Assert.equal(GetNativeEntityIndex(g_nMinimumFixtureInteger - 1), -1);
g_Assert.equal(GetNativeEntityIndex({ Index: g_nMaximumFixtureInteger + 1 }), -1);

for (const InvalidSelector of [undefined, null, -1, "1", 1n, 1.5, NaN, Infinity, g_nMaximumFixtureInteger + 1, {}, { Index: "1" }, { Index: 1n }, { Index: g_nMaximumFixtureInteger + 1 }]) {
	g_Assert.equal(g_Dictionary.GetEntityFromDictionary(InvalidSelector), null);
	g_Assert.equal(g_Dictionary.HasEntityInDictionary(InvalidSelector), false);
}

const g_SelectorError = new Error("Index getter failed.");
const g_ThrowingSelector = {
	get Index() {
		throw g_SelectorError;
	},
};
g_Assert.throws(() => g_Dictionary.GetEntityFromDictionary(g_ThrowingSelector), (ErrorValue) => ErrorValue === g_SelectorError);
g_Assert.throws(() => g_Dictionary.HasEntityInDictionary(g_ThrowingSelector), (ErrorValue) => ErrorValue === g_SelectorError);
const g_FunctionSelector = Object.assign(() => {}, { Index: 1 });
g_Assert.strictEqual(g_Dictionary.GetEntityFromDictionary(g_FunctionSelector), g_Player);
g_Assert.equal(g_Dictionary.HasEntityInDictionary(g_FunctionSelector), true);
g_Assert.strictEqual(g_Dictionary.GetEntityFromDictionary(1), g_Player);
g_Assert.strictEqual(g_Dictionary.GetEntityFromDictionary({ Index: 2 }), g_PhysicsProp);
g_Assert.equal(g_Dictionary.GetEntityFromDictionary("1"), null);
g_Assert.equal(g_Dictionary.HasEntityInDictionary(1), true);
g_Assert.equal(g_Dictionary.HasEntityInDictionary(2047), false);

g_Assert.strictEqual(Entity(1), g_Player);
g_Assert.strictEqual(Entity({ Index: 2 }), g_PhysicsProp);
g_Assert.equal(Entity(2047), null);
g_Assert.throws(() => Entity(-1), /non-negative safe integer/);
g_Assert.throws(() => Entity("1"), /non-negative safe integer/);
g_Assert.equal(Entity(Number.MAX_SAFE_INTEGER), null);

const g_vecFactoryCalls = [];
const g_mapCustomCache = new EntityDictionary((unEntityIndex, strOwner, nPriority) => {
	g_vecFactoryCalls.push({ Index: unEntityIndex, Owner: strOwner, Priority: nPriority });

	return { Entity: Entity(unEntityIndex), Owner: strOwner, Priority: nPriority };
}, "round-controller", 5);
try {
	const Created = g_mapCustomCache.CreateMissingEntity(1);
	g_Assert.strictEqual(g_mapCustomCache.get(1), Created);
	g_Assert.strictEqual(g_mapCustomCache.FromIntegerHandle(g_Player.HandleValue), Created);
	g_Assert.equal(g_mapCustomCache.has(1), true);
	g_Assert.deepEqual(Array.from(g_mapCustomCache.keys()), [1]);
	g_Assert.deepEqual(Array.from(g_mapCustomCache.values()), [Created]);
	g_Assert.deepEqual(Array.from(g_mapCustomCache.entries()), [[1, Created]]);
	g_Assert.deepEqual([...g_mapCustomCache], [[1, Created]]);
	g_Assert.equal(g_mapCustomCache.size, 1);
	g_Assert.deepEqual(g_vecFactoryCalls, [{ Index: 1, Owner: "round-controller", Priority: 5 }]);
	g_Assert.equal(g_mapCustomCache.delete(1), true);
	g_Assert.equal(g_mapCustomCache.delete(1), false);
} finally {
	g_Assert.equal(g_mapCustomCache.Unload(), true);
	g_Assert.equal(g_mapCustomCache.Unload(), false);
}

g_Assert.equal(g_NetworkedEntityDeletedManager.Size, 1);
g_Assert.throws(() => new EntityDictionary("Entity"), /factory must be a function or null/);

const g_mapReadOnlyCache = new EntityDictionary(null);
try {
	g_mapReadOnlyCache.set(1, g_Player);
	const itCachedEntries = g_mapReadOnlyCache.entries();
	const itCachedKeys = g_mapReadOnlyCache.keys();
	const itCachedValues = g_mapReadOnlyCache.values();

	g_mapReadOnlyCache.set(2, g_PhysicsProp);
	g_Assert.deepEqual(Array.from(itCachedEntries), [[1, g_Player], [2, g_PhysicsProp]]);
	g_Assert.deepEqual(Array.from(itCachedKeys), [1, 2]);
	g_Assert.deepEqual(Array.from(itCachedValues), [g_Player, g_PhysicsProp]);
	g_Assert.strictEqual(g_mapReadOnlyCache.get(1), g_Player);
	g_mapReadOnlyCache.clear();
	g_Assert.throws(() => g_mapReadOnlyCache.get(1), /Entity index is not cached/);
} finally {
	g_Assert.equal(g_mapReadOnlyCache.Unload(), true, "read-only dictionary must unload successfully");
}

const g_mapNullFactoryCache = new EntityDictionary(() => null);
try {
	g_Assert.throws(() => g_mapNullFactoryCache.get(1), /Unable to create entity/);
} finally {
	g_Assert.equal(g_mapNullFactoryCache.Unload(), true, "null-factory dictionary must unload successfully");
}

const g_FactoryError = new Error("factory failure");
const g_mapFailingFactoryCache = new EntityDictionary(() => {
	throw g_FactoryError;
});
try {
	g_Assert.throws(() => g_mapFailingFactoryCache.get(1), (ErrorValue) => {
		g_Assert.match(ErrorValue.message, /factory failure/);
		g_Assert.strictEqual(ErrorValue.cause, g_FactoryError);

		return true;
	});
} finally {
	g_Assert.equal(g_mapFailingFactoryCache.Unload(), true, "failing-factory dictionary must unload successfully");
}

let g_bMarkedForDeletion = true;
const g_mapDeletionMarkedCache = new EntityDictionary((unEntityIndex) => ({ Index: unEntityIndex, IsEntityMarkedForDeletion: () => g_bMarkedForDeletion }));
try {
	const Provisional = g_mapDeletionMarkedCache.CreateMissingEntity(2);
	g_Assert.equal(Provisional.Index, 2);
	g_Assert.equal(g_mapDeletionMarkedCache.has(2), false);
	g_bMarkedForDeletion = false;
	g_Assert.equal(g_mapDeletionMarkedCache.get(2).Index, 2);
	g_Assert.equal(g_mapDeletionMarkedCache.has(2), true);
} finally {
	g_Assert.equal(g_mapDeletionMarkedCache.Unload(), true, "deletion-marked dictionary must unload successfully");
}

const g_mapInvalidDeletionStateCache = new EntityDictionary(() => ({
	IsEntityMarkedForDeletion() {
		return 1;
	},
}));
try {
	g_Assert.throws(() => g_mapInvalidDeletionStateCache.get(2), /must return a boolean/);
	g_Assert.equal(g_mapInvalidDeletionStateCache.has(2), false);
} finally {
	g_Assert.equal(g_mapInvalidDeletionStateCache.Unload(), true, "invalid-deletion-state dictionary must unload successfully");
}

class TrackingEntityDictionary extends EntityDictionary {
	constructor() {
		super(Entity);
		this.RemovedIndexes = [];
	}

	OnAutomaticallyRemoved(unEntityIndex) {
		this.RemovedIndexes.push(unEntityIndex);
	}
}

const g_mapTrackingCache = new TrackingEntityDictionary();
try {
	g_mapTrackingCache.get(1);
	const vecDeletionResults = g_NetworkedEntityDeletedManager.Emit(g_Player);
	g_Assert.deepEqual(vecDeletionResults, [false, true]);
	g_Assert.equal(g_mapTrackingCache.has(1), false);
	g_Assert.deepEqual(g_mapTrackingCache.RemovedIndexes, [1]);
	g_Assert.equal(g_mapTrackingCache.OnNetworkedEntityDeleted(g_Player), false);
} finally {
	g_Assert.equal(g_mapTrackingCache.Unload(), true, "tracking dictionary must unload successfully");
}

g_Assert.equal(g_NetworkedEntityDeletedManager.Size, 1);

function VerifyWorldDictionaryExample(DictionaryAPI) {
	const strExamplePath = g_Path.join(g_strRepositoryRootPath, "examples", "plugins", "disabled", "api-world-objects", "index.js");
	const strExample = g_FileSystem.readFileSync(strExamplePath, "utf8");
	const vecMatch = strExample.match(/\tLogResult\("entities\/dictionary ENTITY_DICTIONARY",[\s\S]*?\r?\n\t}\);/);
	g_Assert.ok(vecMatch, "world example must retain its dictionary callback");

	const RunExample = new Function("ENTITY_DICTIONARY", "GetAllEntities", "GetEntityIndexes", "LogResult", vecMatch[0]);
	const vecNativeEntities = DictionaryAPI.GetEntityDictionaryValues();
	g_Assert.ok(vecNativeEntities.length > 0, "the populated world dictionary profile must contain native records");

	const mapDictionary = new DictionaryAPI.EntityDictionary();
	try {
		for (const vecEntities of [[], vecNativeEntities]) {
			let Result = null;
			RunExample(mapDictionary, () => vecEntities, (vecValues) => vecValues.map((Entity) => Entity.Index), (strLabel, Callback) => {
				g_Assert.equal(strLabel, "entities/dictionary ENTITY_DICTIONARY");
				Result = Callback();
			});
			g_Assert.equal(Result.EntityCount, vecEntities.length);

			if (vecEntities.length === 0) {
				g_Assert.equal(Result.FirstEntity, null);
				continue;
			}

			g_Assert.equal(Result.FirstEntity.Index, vecEntities[0].Index);
			g_Assert.equal(Result.FirstEntity.ClassName, vecEntities[0].ClassName);
			g_Assert.equal(Result.FirstEntity.Valid, true);
			g_Assert.equal(typeof Result.FirstEntity.Address, "bigint");
		}
	} finally {
		g_Assert.equal(mapDictionary.Unload(), true);
	}
}

VerifyWorldDictionaryExample(g_Dictionary);

g_Assert.equal(ENTITY_DICTIONARY.size, 0);
g_Assert.strictEqual(ENTITY_DICTIONARY.get(1), g_Player);
g_Assert.strictEqual(ENTITY_DICTIONARY.get(1), g_Player);
g_Assert.equal(ENTITY_DICTIONARY.delete(1), true);

class TrackingSyncedEntityDictionary extends SyncedEntityDictionary {
	constructor(Factory, EntityIterable, ...vecFactoryArguments) {
		super(Factory, EntityIterable, ...vecFactoryArguments);
		// Preserve arrays populated by overrides during base construction.
		this.CreatedIndexes ??= [];
		this.RemovedIndexes ??= [];
	}

	OnAutomaticallyCreated(unEntityIndex) {
		(this.CreatedIndexes ??= []).push(unEntityIndex);
	}

	OnAutomaticallyRemoved(unEntityIndex) {
		(this.RemovedIndexes ??= []).push(unEntityIndex);
	}
}

const g_mapSyncedCache = new TrackingSyncedEntityDictionary(Entity, null);
try {
	g_Assert.deepEqual(Array.from(g_mapSyncedCache.keys()), [0, 1, 2]);
	g_Assert.deepEqual(g_mapSyncedCache.CreatedIndexes, [0, 1, 2]);
	g_Assert.throws(() => g_mapSyncedCache.get(2047), /Entity index is not synced/);
	g_Assert.throws(() => g_mapSyncedCache.CreateMissingEntity(2047), /Entity index is not synced/);

	const SpawnedProp = MakeEntity(3, "prop_dynamic");
	const vecCreationResults = g_NetworkedEntityCreatedManager.Emit(SpawnedProp);
	g_Assert.deepEqual(vecCreationResults, [true]);
	g_Assert.strictEqual(g_mapSyncedCache.get(3), SpawnedProp);
	g_Assert.deepEqual(g_mapSyncedCache.CreatedIndexes, [0, 1, 2, 3]);

	const vecDeletionResults = g_NetworkedEntityDeletedManager.Emit(SpawnedProp);
	g_Assert.deepEqual(vecDeletionResults, [false, true]);
	g_Assert.equal(g_mapSyncedCache.has(3), false);
	g_Assert.deepEqual(g_mapSyncedCache.RemovedIndexes, [3]);
	g_Assert.equal(g_mapEntityStates.delete(3), true, "temporary dictionary entity state must be removed");
	g_Assert.strictEqual(g_mapSyncedCache.Resynchronize(), g_mapSyncedCache);
	g_Assert.deepEqual(Array.from(g_mapSyncedCache.keys()), [0, 1, 2]);
} finally {
	g_Assert.equal(g_mapSyncedCache.Unload(), true);
	g_Assert.equal(g_mapSyncedCache.Unload(), false);
}

g_Assert.equal(g_NetworkedEntityCreatedManager.Size, 0);
g_Assert.equal(g_NetworkedEntityDeletedManager.Size, 1);

const g_PropEntityIterable = {
	*[Symbol.iterator]() {
		yield* GetNativeValues();
	},
	IsEntityValid(Entity) {
		return Entity.ClassName.startsWith("prop_");
	},
};

const g_mapFilteredCache = new TrackingSyncedEntityDictionary((unIndex, strOwner) => ({ Entity: Entity(unIndex), Owner: strOwner }), g_PropEntityIterable, "physics-monitor");
try {
	g_Assert.deepEqual(Array.from(g_mapFilteredCache.keys()), [2]);
	g_Assert.equal(g_mapFilteredCache.get(2).Owner, "physics-monitor");
	g_Assert.equal(g_mapFilteredCache.OnNetworkedEntityCreated(g_Player), false);

	const NewProp = MakeEntity(3, "prop_dynamic_override");
	g_Assert.equal(g_mapFilteredCache.OnNetworkedEntityCreated(NewProp), true);
	g_Assert.equal(g_mapFilteredCache.has(3), true);
	g_Assert.equal(g_mapFilteredCache.OnNetworkedEntityDeleted(NewProp), true);
	g_Assert.equal(g_mapFilteredCache.has(3), false);
	g_Assert.deepEqual(g_mapFilteredCache.RemovedIndexes, [3]);
	g_Assert.equal(g_mapEntityStates.delete(3), true, "temporary dictionary entity state must be removed");
} finally {
	g_Assert.equal(g_mapFilteredCache.Unload(), true, "filtered dictionary must unload successfully");
}

{
	const vecEntityIndexes = [1, 2];
	const mapEntityCache = new SyncedEntityDictionary(Entity, vecEntityIndexes);
	try {
		g_Assert.strictEqual(mapEntityCache.EntityIterator, vecEntityIndexes);
		g_Assert.equal(mapEntityCache.EntityIterator.next, undefined);
		g_Assert.deepEqual(Array.from(mapEntityCache.keys()), vecEntityIndexes);
		g_Assert.strictEqual(mapEntityCache.get(1), g_Player);
	} finally {
		g_Assert.equal(mapEntityCache.Unload(), true);
	}
}

g_Assert.throws(() => new SyncedEntityDictionary(null), /Factory cannot be null/);
g_Assert.throws(() => new SyncedEntityDictionary(Entity, {}), /iterator must be iterable/);
g_Assert.throws(
	() => new SyncedEntityDictionary(Entity, {
		*[Symbol.iterator]() {
		},
		IsEntityValid: true,
	}),
	/iterator IsEntityValid must be a function/,
);

const g_unDeletionListenerCountBeforeRollback = g_NetworkedEntityDeletedManager.Size;
const g_unCreationListenerCountBeforeRollback = g_NetworkedEntityCreatedManager.Size;
const g_ThrowingEntityIterable = {
	*[Symbol.iterator]() {
		throw new Error("iterator failure");
	},
};

g_Assert.throws(() => new SyncedEntityDictionary(Entity, g_ThrowingEntityIterable), /iterator failure/);
g_Assert.equal(g_NetworkedEntityDeletedManager.Size, g_unDeletionListenerCountBeforeRollback);
g_Assert.equal(g_NetworkedEntityCreatedManager.Size, g_unCreationListenerCountBeforeRollback);

const g_ResynchronizeError = new Error("Resynchronize iterator failed after its first entity.");
let g_bFailResynchronization = false;
const g_RebuildingEntityIterable = {
	*[Symbol.iterator]() {
		yield g_Player;

		if (g_bFailResynchronization) {
			throw g_ResynchronizeError;
		}

		yield g_PhysicsProp;
	},
	IsEntityValid(EntityValue) {
		return (EntityValue.Index === 1) ? "accepted" : 0;
	},
};

const g_mapRebuildingCache = new SyncedEntityDictionary(Entity, g_RebuildingEntityIterable);

try {
	g_Assert.deepEqual(Array.from(g_mapRebuildingCache.keys()), [1]);
	g_mapRebuildingCache.set(2, g_PhysicsProp);
	g_bFailResynchronization = true;
	g_Assert.throws(() => g_mapRebuildingCache.Resynchronize(), (ErrorValue) => ErrorValue === g_ResynchronizeError);
	g_Assert.deepEqual(Array.from(g_mapRebuildingCache.keys()), [1]);

	const unDeletionListenerCount = g_NetworkedEntityDeletedManager.Size;
	const unCreationListenerCount = g_NetworkedEntityCreatedManager.Size;
	g_Assert.throws(() => new SyncedEntityDictionary(Entity, g_RebuildingEntityIterable), (ErrorValue) => ErrorValue === g_ResynchronizeError);
	g_Assert.equal(g_NetworkedEntityDeletedManager.Size, unDeletionListenerCount);
	g_Assert.equal(g_NetworkedEntityCreatedManager.Size, unCreationListenerCount);
} finally {
	g_bFailResynchronization = false;
	g_Assert.equal(g_mapRebuildingCache.Unload(), true);
}

ENTITY_DICTIONARY.clear();

const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
const g_vecDocumentationBlocks = ExtractJavaScriptBlocks(g_strDocumentation);
const g_setExercisedExports = new Set();
const g_DocumentedDictionary = TrackModule(g_Dictionary, g_setExercisedExports);

g_Assert.equal(g_vecDocumentationBlocks.length, 10);
g_Assert.doesNotMatch(g_strDocumentation, /generated by|auto-generated|generate_api_docs/i);
g_Assert.doesNotMatch(g_strDocumentation, /get\(filePath|has\(branch|const\s+moduleName|moduleName\s*:|byIndex\(|\.dispose\(/);
g_Assert.doesNotMatch(g_strDocumentation, /console\.log\(instance\)|console\.log\(result\)/);

for (const strRelatedPath of [
	"entities.md",
	"entities-entity.md",
	"entities-helpers.md",
	"listeners.md",
	"filters-entities.md",
]) {
	g_Assert.match(g_strDocumentation, new RegExp(`\\(${strRelatedPath.replace(".", "\\.")}\\)`));
}

for (const [unIndex, strSource] of g_vecDocumentationBlocks.entries()) {
	ExecuteDocumentationBlock(strSource, unIndex, { "entities/dictionary": g_DocumentedDictionary });

	g_Assert.equal(g_NetworkedEntityCreatedManager.Size, 0, `Documentation block ${unIndex + 1} leaked a creation listener.`);
	g_Assert.equal(g_NetworkedEntityDeletedManager.Size, 1, `Documentation block ${unIndex + 1} leaked a deletion listener.`);
}

for (const strExportName of g_vecExpectedExports) {
	g_Assert.equal(g_setExercisedExports.has(strExportName), true, `Documentation did not reference entities/dictionary.${strExportName}.`);
}

g_Assert.equal(ENTITY_DICTIONARY.size, 0);
g_Assert.equal(ENTITY_DICTIONARY.Unload(), true);
g_Assert.equal(g_NetworkedEntityDeletedManager.Size, 0);

delete globalThis.sourcejs["entities/dictionary"];
delete require.cache[g_strDictionaryPath];
g_Assert.throws(() => require(g_strDictionaryPath), /SourceJS module is not installed: entities\/dictionary/);

delete require.cache[g_strDictionaryPath];

if (g_PreviousListenersModule === undefined) {
	delete require.cache[g_strListenersPath];
} else {
	require.cache[g_strListenersPath] = g_PreviousListenersModule;
}

if (g_PreviousSourceJS === undefined) {
	delete globalThis.sourcejs;
} else {
	globalThis.sourcejs = g_PreviousSourceJS;
}

console.log("[smoke] entities/dictionary API and documentation contracts passed");

g_Module._load = g_OriginalModuleLoad;
