#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strEventsDocumentationPath = g_Path.join(g_strProjectRoot, "docs", "api", "events.md");
const g_strEventsPath = g_Path.join(g_strProjectRoot, "packages", "sourcejs", "events.js");
const g_strRuntimePath = g_Path.join(g_strProjectRoot, "packages", "sourcejs", "internal", "runtime.js");

const g_OriginalModuleLoad = g_Module._load;
g_Module._load = function Load(strRequestName, ParentModule, bIsMain) {
	if (strRequestName === "internal/runtime") {
		return require(g_strRuntimePath);
	}

	return g_OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
};

// Controlled event/payload doubles do not execute the engine or prove its ABI.
const g_flMaximumFloat = 3.4028234663852886e38;
const g_nMinimumSignedInteger32 = -0x80000000;
const g_nMaximumSignedInteger32 = 0x7FFFFFFF;
const g_unMaximumUnsignedInteger64 = 0xFFFFFFFFFFFFFFFFn;
const g_unInitialEventAddress = 0xC350n;
const g_unEventAddressStride = 0x10n;
const g_vecEventVariableTypes = [
	"bool",
	"byte",
	"short",
	"long",
	"float",
	"string",
	"local",
	"wstring",
];

const g_vecExpectedExports = [
	"CreateCustomEvent",
	"CreateEventPayload",
	"CreateEventResourceText",
	"FireEvent",
	"RegisterEventListener",
	"UnregisterEventListener",
];

function RequireNonEmptyString(strValue, strOperation) {
	if ((typeof strValue !== "string") || (strValue.length === 0)) {
		throw new TypeError(`${strOperation} expects a non-empty string.`);
	}

	return strValue;
}

function RequireObject(Value, strOperation) {
	if ((Value === null) || (typeof Value !== "object") || Array.isArray(Value)) {
		throw new TypeError(`${strOperation} expects an object.`);
	}

	return Value;
}

function RequireBoolean(bValue, strOperation) {
	if (typeof bValue !== "boolean") {
		throw new TypeError(`${strOperation} expects a boolean.`);
	}

	return bValue;
}

function RequireSignedInteger32(nValue, strOperation) {
	if (!Number.isInteger(nValue) || Object.is(nValue, -0) || (nValue < g_nMinimumSignedInteger32) || (nValue > g_nMaximumSignedInteger32)) {
		throw new TypeError(`${strOperation} expects a signed 32-bit integer value.`);
	}

	return nValue;
}

function RequireFloat(dblValue, strOperation) {
	if ((typeof dblValue !== "number") || !Number.isFinite(dblValue) || (Math.abs(dblValue) > g_flMaximumFloat)) {
		throw new TypeError(`${strOperation} expects a finite float value.`);
	}

	return dblValue;
}

function RequireUnsignedInteger64(unValue, strOperation) {
	if (typeof unValue !== "bigint") {
		throw new TypeError(`${strOperation} expects an unsigned 64-bit BigInt value.`);
	}

	if ((unValue < 0n) || (unValue > g_unMaximumUnsignedInteger64)) {
		throw new RangeError(`${strOperation} expects an unsigned 64-bit integer value.`);
	}

	return unValue;
}

function RequireEventString(strValue, strOperation) {
	if (typeof strValue !== "string") {
		throw new TypeError(`${strOperation} expects a string.`);
	}

	if (strValue.includes("\0")) {
		throw new TypeError(`${strOperation} does not accept an embedded NUL.`);
	}

	return strValue;
}

function RequireEventKey(strValue, strOperation) {
	return RequireEventString(RequireNonEmptyString(strValue, `${strOperation} key`), `${strOperation} key`);
}

function RequireEventType(strType) {
	if ((typeof strType !== "string") || !g_vecEventVariableTypes.includes(strType)) {
		throw new TypeError("Event type must use an exact supported spelling.");
	}

	return strType;
}

function GetEventTypeFromValue(Value) {
	if (typeof Value === "boolean") {
		return "bool";
	}

	if (Number.isInteger(Value) && !Object.is(Value, -0) && (Value >= g_nMinimumSignedInteger32) && (Value <= g_nMaximumSignedInteger32)) {
		return "long";
	}

	if (typeof Value === "number") {
		return "float";
	}

	return "string";
}

function GetEventTypeFromDefinition(Definition) {
	if (typeof Definition === "string") {
		return RequireEventType(Definition);
	}

	if ((Definition !== null) && ((typeof Definition === "object") || (typeof Definition === "function"))) {
		const Type = Definition.Type;
		if (typeof Type === "string") {
			return RequireEventType(Type);
		}

		const DefaultValue = Definition.DefaultValue;
		if (DefaultValue !== undefined) {
			return GetEventTypeFromValue(DefaultValue);
		}
	}

	return GetEventTypeFromValue(Definition);
}

function EscapeResourceValue(strValue) {
	return strValue.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function BuildResourceText(strName, Variables) {
	let strText = `"${EscapeResourceValue(strName)}"\n{\n`;

	const vecVariableNames = Object.keys(Variables);
	for (const strVariableName of vecVariableNames) {
		const Definition = Variables[strVariableName];
		strText += `\t"${EscapeResourceValue(strVariableName)}"\t"${GetEventTypeFromDefinition(Definition)}"\n`;
	}

	strText += "}\n";

	return strText;
}

function BuildPayload(Variables = {}, Overrides = {}) {
	RequireObject(Variables, "events.CreateEventPayload Variables");
	RequireObject(Overrides, "events.CreateEventPayload Overrides");

	const Result = {};
	const vecVariableNames = Object.keys(Variables);
	for (const strName of vecVariableNames) {
		const Definition = Variables[strName];
		if ((Definition !== null) && ((typeof Definition === "object") || (typeof Definition === "function"))) {
			const DefaultValue = Definition.DefaultValue;
			if (DefaultValue !== undefined) {
				Object.defineProperty(Result, strName, { value: DefaultValue, enumerable: true, writable: true, configurable: true });
			}

		} else if (typeof Definition !== "string") {
			Object.defineProperty(Result, strName, { value: Definition, enumerable: true, writable: true, configurable: true });
		}
	}

	const vecOverrideNames = Object.keys(Overrides);
	for (const strName of vecOverrideNames) {
		Object.defineProperty(Result, strName, { value: Overrides[strName], enumerable: true, writable: true, configurable: true });
	}

	return Result;
}

function CreateNativeEvents({ SupportsUInt64: bSupportsUInt64 = true } = {}) {
	const mapCallbacksByName = new Map();
	const vecFiredEvents = [];
	const vecCallbackFailures = [];
	let unNextAddress = g_unInitialEventAddress;
	let EventResourceCheck = null;

	function BuildValidatedPayload(Payload) {
		RequireObject(Payload, "events.FireEvent Payload");

		const NativePayload = {};
		const vecKeys = Object.keys(Payload);
		for (const strKey of vecKeys) {
			const Value = Payload[strKey];
			RequireEventKey(strKey, "events.FireEvent Payload key");

			if (typeof Value === "boolean") {
				Object.defineProperty(NativePayload, strKey, { value: Value, enumerable: true, writable: true, configurable: true });
				continue;
			}

			if (typeof Value === "string") {
				RequireEventString(Value, "events.FireEvent Payload value");
				Object.defineProperty(NativePayload, strKey, { value: Value, enumerable: true, writable: true, configurable: true });
				continue;
			}

			if (typeof Value === "number") {
				if (Number.isInteger(Value) && (Value >= g_nMinimumSignedInteger32) && (Value <= g_nMaximumSignedInteger32) && !Object.is(Value, -0)) {
					Object.defineProperty(NativePayload, strKey, { value: Value, enumerable: true, writable: true, configurable: true });
					continue;
				}

				RequireFloat(Value, "events.FireEvent Payload value");
				Object.defineProperty(NativePayload, strKey, { value: Math.fround(Value), enumerable: true, writable: true, configurable: true });
				continue;
			}

			if ((typeof Value === "bigint") && bSupportsUInt64) {
				RequireUnsignedInteger64(Value, "events.FireEvent Payload value");
				Object.defineProperty(NativePayload, strKey, { value: Value, enumerable: true, writable: true, configurable: true });
				continue;
			}

			throw new TypeError("events.FireEvent Payload values must use a supported game-event type.");
		}

		return NativePayload;
	}

	function CreateEventView(DispatchState) {
		function RequireActive(strOperation) {
			if (!DispatchState.Active) {
				throw new Error(`${strOperation} cannot access an event after its callback has returned.`);
			}
		}

		function GetValue(strKey, DefaultValue, Predicate, strOperation) {
			RequireActive(strOperation);
			RequireEventKey(strKey, strOperation);

			const Value = DispatchState.Payload[strKey];

			return Predicate(Value) ? Value : DefaultValue;
		}

		const Event = {
			EventName: DispatchState.Name,
			Reliable: false,
			Local: false,
			Address: DispatchState.Address,
			IsEventEmpty(strKey) {
				RequireActive("GameEvent.IsEventEmpty");

				if (strKey === undefined) {
					return Object.keys(DispatchState.Payload).length === 0;
				}

				RequireEventKey(strKey, "GameEvent.IsEventEmpty");

				return !Object.hasOwn(DispatchState.Payload, strKey);
			},
			GetEventBoolean(strKey, bDefaultValue) {
				const bNormalizedDefault = (arguments.length > 1) ? RequireBoolean(bDefaultValue, "GameEvent.GetEventBoolean bDefaultValue") : false;

				return GetValue(strKey, bNormalizedDefault, (Value) => typeof Value === "boolean", "GameEvent.GetEventBoolean");
			},
			GetEventInteger(strKey, nDefaultValue) {
				const nNormalizedDefault = (arguments.length > 1) ? RequireSignedInteger32(nDefaultValue, "GameEvent.GetEventInteger nDefaultValue") : 0;

				return GetValue(strKey, nNormalizedDefault, (Value) => Number.isInteger(Value), "GameEvent.GetEventInteger");
			},
			GetEventFloat(strKey, dblDefaultValue) {
				const flNormalizedDefault = (arguments.length > 1) ? Math.fround(RequireFloat(dblDefaultValue, "GameEvent.GetEventFloat dblDefaultValue")) : 0.0;

				return GetValue(strKey, flNormalizedDefault, (Value) => typeof Value === "number", "GameEvent.GetEventFloat");
			},
			GetEventString(strKey, strDefaultValue) {
				const strNormalizedDefault = (arguments.length > 1) ? RequireEventString(strDefaultValue, "GameEvent.GetEventString strDefaultValue") : "";

				return GetValue(strKey, strNormalizedDefault, (Value) => typeof Value === "string", "GameEvent.GetEventString");
			},
			SetEventBoolean(strKey, bValue) {
				RequireActive("GameEvent.SetEventBoolean");
				DispatchState.Payload[RequireEventKey(strKey, "GameEvent.SetEventBoolean")] = RequireBoolean(bValue, "GameEvent.SetEventBoolean bValue");

				return true;
			},
			SetEventInteger(strKey, nValue) {
				RequireActive("GameEvent.SetEventInteger");
				DispatchState.Payload[RequireEventKey(strKey, "GameEvent.SetEventInteger")] = RequireSignedInteger32(nValue, "GameEvent.SetEventInteger nValue");

				return true;
			},
			SetEventFloat(strKey, dblValue) {
				RequireActive("GameEvent.SetEventFloat");
				DispatchState.Payload[RequireEventKey(strKey, "GameEvent.SetEventFloat")] = Math.fround(RequireFloat(dblValue, "GameEvent.SetEventFloat dblValue"));

				return true;
			},
			SetEventString(strKey, strValue) {
				RequireActive("GameEvent.SetEventString");
				RequireEventKey(strKey, "GameEvent.SetEventString");

				DispatchState.Payload[strKey] = RequireEventString(strValue, "GameEvent.SetEventString strValue");

				return true;
			},
		};

		if (bSupportsUInt64) {
			Event.GetEventUInt64 = function GetEventUInt64(strKey, unDefaultValue) {
				const unNormalizedDefault = (arguments.length > 1) ? RequireUnsignedInteger64(unDefaultValue, "GameEvent.GetEventUInt64 unDefaultValue") : 0n;

				return GetValue(strKey, unNormalizedDefault, (Value) => typeof Value === "bigint", "GameEvent.GetEventUInt64");
			};
			Event.SetEventUInt64 = function SetEventUInt64(strKey, unValue) {
				RequireActive("GameEvent.SetEventUInt64");
				DispatchState.Payload[RequireEventKey(strKey, "GameEvent.SetEventUInt64")] = RequireUnsignedInteger64(unValue, "GameEvent.SetEventUInt64 unValue");

				return true;
			};
		}

		return Event;
	}

	const NativeEvents = {
		CreateCustomEvent(strName, Variables = {}) {
			RequireNonEmptyString(strName, "events.CreateCustomEvent strName");
			RequireObject(Variables, "events.CreateCustomEvent Variables");

			const strEventResourceText = BuildResourceText(strName, Variables);

			function FireEvent(Overrides = {}, bDoNotBroadcast = false) {
				const strEventName = RequireNonEmptyString(this.EventName, "Custom event FireEvent EventName");
				const EventVariables = (this.EventVariables === undefined) ? {} : RequireObject(this.EventVariables, "Custom event FireEvent EventVariables");
				RequireObject(Overrides, "Custom event FireEvent overrides");
				RequireBoolean(bDoNotBroadcast, "Custom event FireEvent bDoNotBroadcast");

				return NativeEvents.FireEvent(strEventName, BuildPayload(EventVariables, Overrides), bDoNotBroadcast);
			}

			return { EventName: strName, EventVariables: Variables, EventResourceText: strEventResourceText, FireEvent };
		},
		FireEvent(strName, Payload = {}, bDoNotBroadcast = false) {
			RequireNonEmptyString(strName, "events.FireEvent strName");
			const NativePayload = BuildValidatedPayload(Payload);
			RequireBoolean(bDoNotBroadcast, "events.FireEvent bDoNotBroadcast");

			if (EventResourceCheck !== null) {
				EventResourceCheck(strName);
			}

			const DispatchState = { Active: true, Name: strName, Payload: NativePayload, Address: unNextAddress };

			unNextAddress += g_unEventAddressStride;

			try {
				for (const Callback of [...(mapCallbacksByName.get(strName) ?? [])]) {
					try {
						Callback(CreateEventView(DispatchState));
					} catch (Failure) {
						vecCallbackFailures.push(Failure);
					}
				}
			} finally {
				DispatchState.Active = false;
			}

			vecFiredEvents.push({ DoNotBroadcast: bDoNotBroadcast, EventName: strName, Payload: { ...DispatchState.Payload } });

			return true;
		},
		UnregisterEventListener(strName, Callback) {
			RequireNonEmptyString(strName, "events.UnregisterEventListener strName");

			if (typeof Callback !== "function") {
				throw new TypeError("events.UnregisterEventListener Callback expects a function.");
			}

			const vecCallbacks = mapCallbacksByName.get(strName);
			const nCallbackIndex = vecCallbacks?.indexOf(Callback) ?? -1;
			if (nCallbackIndex < 0) {
				return false;
			}

			vecCallbacks.splice(nCallbackIndex, 1);

			if (vecCallbacks.length === 0) {
				mapCallbacksByName.delete(strName);
			}

			return true;
		},
		RegisterEventListener(strName, Callback) {
			RequireNonEmptyString(strName, "events.RegisterEventListener strName");

			if (EventResourceCheck !== null) {
				EventResourceCheck(strName);
			}

			if (typeof Callback !== "function") {
				throw new TypeError("events.RegisterEventListener Callback expects a function.");
			}

			const vecCallbacks = mapCallbacksByName.get(strName) ?? [];
			vecCallbacks.push(Callback);
			mapCallbacksByName.set(strName, vecCallbacks);

			return true;
		},
		CreateEventPayload(Variables = {}, Overrides = {}) {
			return BuildPayload(Variables, Overrides);
		},
		CreateEventResourceText(strName, Variables = {}) {
			RequireNonEmptyString(strName, "events.CreateEventResourceText strName");
			RequireObject(Variables, "events.CreateEventResourceText Variables");

			return BuildResourceText(strName, Variables);
		},
	};

	return {
		GetCallbackCount() {
			let unCount = 0;

			for (const vecCallbacks of mapCallbacksByName.values()) {
				unCount += vecCallbacks.length;
			}

			return unCount;
		},
		NativeEvents,
		FiredEvents: vecFiredEvents,
		CallbackFailures: vecCallbackFailures,
		SetEventResourceCheck(Check) {
			EventResourceCheck = Check;
		},
	};
}

function VerifyFloatSetterStorage() {
	const Fixture = CreateNativeEvents();
	const strEventName = "FloatSetterStorage";
	let bCallbackCompleted = false;
	const Callback = (EventValue) => {
		for (const dblValue of [0.1, -0, g_flMaximumFloat]) {
			g_Assert.equal(EventValue.SetEventFloat("Value", dblValue), true);
			g_Assert.equal(EventValue.GetEventFloat("Value"), Math.fround(dblValue), "The event setter must store native float32 precision, including signed zero.");
		}

		const flPreviousValue = EventValue.GetEventFloat("Value");
		for (const InvalidValue of [NaN, Infinity, -Infinity, g_flMaximumFloat * 2, "0.1", null, undefined, 1n]) {
			g_Assert.throws(() => EventValue.SetEventFloat("Value", InvalidValue), { name: "TypeError" });
			g_Assert.equal(EventValue.GetEventFloat("Value"), flPreviousValue, "Rejected float writes must not change stored event data.");
		}

		bCallbackCompleted = true;
	};
	g_Assert.equal(Fixture.NativeEvents.RegisterEventListener(strEventName, Callback), true);
	g_Assert.equal(Fixture.NativeEvents.FireEvent(strEventName, { Value: 0.5 }), true);
	g_Assert.equal(Fixture.CallbackFailures.length, 0, "Float setter assertions must not be swallowed by event dispatch.");
	g_Assert.equal(bCallbackCompleted, true);
	g_Assert.equal(Fixture.NativeEvents.UnregisterEventListener(strEventName, Callback), true);
	g_Assert.equal(Fixture.GetCallbackCount(), 0);
}

// Keep float-regression failures within the loader-restoring orchestration below.

// Controlled write/load model; smoke_events_resource.js verifies the actual package.
function CreateDocumentationResources({ FailureOperation: strFailureOperation = "" } = {}) {
	const mapWrittenResources = new Map();
	const setLoadedNames = new Set(["player_disconnect"]);
	const vecOperations = [];

	class EventResourceFile {
		constructor(strEventResourceFilePath, ...vecDefinitions) {
			RequireNonEmptyString(strEventResourceFilePath, "Documented EventResourceFile path");
			this.EventResourceFilePath = strEventResourceFilePath;
			this.EventDefinitions = vecDefinitions;
		}

		WriteEventResourceFile() {
			vecOperations.push("Write");

			if (strFailureOperation === "Write") {
				throw new Error("Controlled resource write failure.");
			}

			const vecNames = this.EventDefinitions.map((Definition) => RequireNonEmptyString(Definition.EventName, "Documented event name"));
			mapWrittenResources.set(this.FullEventResourceFilePath, vecNames);

			return this.FullEventResourceFilePath;
		}

		LoadEventsFromFile() {
			vecOperations.push("Load");
			const vecNames = mapWrittenResources.get(this.FullEventResourceFilePath);
			g_Assert.notEqual(vecNames, undefined, "Load requires a written resource.");

			if (strFailureOperation === "LoadThrows") {
				throw new Error("Controlled resource load failure.");
			}

			if (strFailureOperation === "LoadZero") {
				return 0;
			}

			for (const strName of vecNames) {
				setLoadedNames.add(strName);
			}

			return vecNames.length;
		}

		get FullEventResourceFilePath() {
			return `/event-root/${this.EventResourceFilePath}.res`;
		}
	}

	return {
		ResourceModule: { EventResourceFile },
		Operations: vecOperations,
		LoadedNames: setLoadedNames,
		RequireLoaded(strName) {
			g_Assert.equal(setLoadedNames.has(strName), true, `Event resource must be written and loaded before use: ${strName}`);
		},
	};
}

function ExtractJavaScriptBlocks(strMarkdown) {
	const vecBlocks = [];
	const Expression = /```js\r?\n([\s\S]*?)\r?\n```/g;
	let vecMatch = null;

	while ((vecMatch = Expression.exec(strMarkdown)) !== null) {
		vecBlocks.push(vecMatch[1]);
	}

	return vecBlocks;
}

function CreateDocumentationLoggers(vecRecords = []) {
	return {
		LogInfo(strRecord) {
			g_Assert.equal(typeof strRecord, "string");
			g_Assert.doesNotMatch(strRecord, /^\s*\[/, "Typed logger messages must not duplicate severity.");
			vecRecords.push(strRecord);
		},
	};
}

function ExecuteDocumentationBlock(strSource, unBlockIndex, Modules, strDocumentName = "events.md") {
	const PluginModule = { exports: {} };
	const Context = g_VM.createContext({
		console: {
			log() {
				throw new Error("Event documentation must use the typed logger.");
			},
		},
		module: PluginModule,
		exports: PluginModule.exports,
		require(strModuleName) {
			if (!Object.hasOwn(Modules, strModuleName)) {
				throw new Error(`Unexpected documentation import: ${strModuleName}`);
			}

			return Modules[strModuleName];
		},
	});

	g_VM.runInContext(`"use strict";\n${strSource}`, Context, { filename: `${strDocumentName}:block-${unBlockIndex + 1}` });

	g_Assert.ok(!PluginModule.exports || !Object.hasOwn(PluginModule.exports, "unload"), "Documentation must not export the obsolete lowercase lifecycle.");

	if (PluginModule.exports && (typeof PluginModule.exports.Unload === "function")) {
		PluginModule.exports.Unload();
	}
}

g_Assert.throws(() => ExecuteDocumentationBlock('console.log("must fail");', 0, {}), /Event documentation must use the typed logger\./);
g_Assert.throws(() => ExecuteDocumentationBlock("module.exports.unload = () => {};", 0, {}), /obsolete lowercase lifecycle/);

function LoadEventPackage(strPackageName, NativeModules, InspectModule = undefined) {
	const PackageModule = { exports: {} };
	const strPackagePath = g_Path.join(g_strProjectRoot, "packages", "sourcejs", `${strPackageName}.js`);
	const Context = g_VM.createContext({
		module: PackageModule,
		exports: PackageModule.exports,
		require(strModuleName) {
			g_Assert.equal(strModuleName, "internal/runtime");

			return {
				GetModule(strNativeModuleName) {
					g_Assert.equal(Object.hasOwn(NativeModules, strNativeModuleName), true);

					return NativeModules[strNativeModuleName];
				},
			};
		},
	});
	g_VM.runInContext(g_FileSystem.readFileSync(strPackagePath, "utf8"), Context, { filename: strPackagePath });

	if (InspectModule !== undefined) {
		InspectModule(Context);
	}

	return PackageModule.exports;
}

function VerifyDocumentationCleanupFailures(vecBlocks) {
	const OperationError = new Error("Controlled event operation failure.");
	const CleanupError = new Error("Controlled event cleanup failure.");
	for (const unBlockIndex of [2, 3, 4, 5]) {
		for (const OperationFailure of [{ Value: OperationError }, { Value: null }, { Value: undefined }, { Value: 0 }, null]) {
			for (const strCleanupMode of ["Success", "False", "Throws"]) {
				const Fixture = CreateNativeEvents();
				const Resources = CreateDocumentationResources();
				Fixture.SetEventResourceCheck(Resources.RequireLoaded);
				const NativeFireEvent = Fixture.NativeEvents.FireEvent;
				const NativeUnregisterEventListener = Fixture.NativeEvents.UnregisterEventListener;
				Fixture.NativeEvents.FireEvent = function (...vecArguments) {
					if (OperationFailure !== null) {
						throw OperationFailure.Value;
					}

					return NativeFireEvent.apply(this, vecArguments);
				};
				let unCleanupAttempts = 0;
				Fixture.NativeEvents.UnregisterEventListener = function (strEventName, Callback) {
					++unCleanupAttempts;
					if (strCleanupMode === "Throws") {
						throw CleanupError;
					}

					if (strCleanupMode === "Success") {
						return NativeUnregisterEventListener.call(this, strEventName, Callback);
					}

					return false;
				};
				const Events = LoadEventPackage("events", { events: Fixture.NativeEvents });
				const Execute = () => ExecuteDocumentationBlock(vecBlocks[unBlockIndex], unBlockIndex, { events: Events, "events/resource": Resources.ResourceModule, globals: { GetGlobalVariables: () => ({ MapName: "sourcejs_test_map" }) } });
				const VerifyFailure = Failure => {
					if (strCleanupMode === "Success") {
						g_Assert.notEqual(OperationFailure, null);
						g_Assert.equal(Failure, OperationFailure.Value);

					} else if (OperationFailure !== null) {
						g_Assert.equal(Failure?.name, "AggregateError", "Cleanup must not hide the original event-operation failure.");
						g_Assert.equal(Failure.errors.length, 2);
						g_Assert.equal(Failure.errors[0], OperationFailure.Value);
						if (strCleanupMode === "Throws") {
							g_Assert.equal(Failure.errors[1], CleanupError);

						} else {
							g_Assert.match(Failure.errors[1].message, /Could not remove/);
						}

					} else if (strCleanupMode === "Throws") {
						g_Assert.equal(Failure, CleanupError);

					} else {
						g_Assert.match(Failure.message, /Could not remove/);
					}

					return true;
				};
				if ((OperationFailure === null) && (strCleanupMode === "Success")) {
					g_Assert.doesNotThrow(Execute);

				} else {
					g_Assert.throws(Execute, VerifyFailure);
				}

				g_Assert.equal(unCleanupAttempts, 1);
				g_Assert.equal(Fixture.GetCallbackCount(), (strCleanupMode === "Success") ? 0 : 1, "Failed native cleanup cannot be reported as a removed registration.");
			}
		}
	}
}

function VerifyRoundMetricFloatGuard(strSource) {
	const strGuard = '\t\tif (!Number.isFinite(flDuration)) {\n\t\t\tthrow new RangeError("The round-metric duration must be finite before normalization.");\n\t\t}\n';
	const strNormalizedSource = strSource.replace(/\r\n/g, "\n");
	g_Assert.equal(strNormalizedSource.split(strGuard).length, 2, "The duration guard must appear exactly once in the round-metric example.");
	const strUnguardedSource = strNormalizedSource.replace(strGuard, "");
	const VerifyInvalidDuration = (strExample, flNativeDuration) => {
		const Fixture = CreateNativeEvents();
		const Resources = CreateDocumentationResources();
		Fixture.SetEventResourceCheck(Resources.RequireLoaded);
		const NativeRegisterEventListener = Fixture.NativeEvents.RegisterEventListener;
		const NativeUnregisterEventListener = Fixture.NativeEvents.UnregisterEventListener;
		const mapCallbackWrappers = new Map();
		let unWriteAttempts = 0;
		Fixture.NativeEvents.RegisterEventListener = function (strEventName, Callback) {
			const ReadControlledDuration = (EventValue) => {
				const ControlledEvent = Object.create(EventValue);
				ControlledEvent.GetEventFloat = () => flNativeDuration;
				for (const strSetterName of ["SetEventInteger", "SetEventFloat", "SetEventString", "SetEventBoolean"]) {
					ControlledEvent[strSetterName] = (...vecArguments) => {
						++unWriteAttempts;

						return EventValue[strSetterName](...vecArguments);
					};
				}

				return Callback(ControlledEvent);
			};
			mapCallbackWrappers.set(Callback, ReadControlledDuration);

			return NativeRegisterEventListener.call(this, strEventName, ReadControlledDuration);
		};
		Fixture.NativeEvents.UnregisterEventListener = function (strEventName, Callback) {
			return NativeUnregisterEventListener.call(this, strEventName, mapCallbackWrappers.get(Callback) ?? Callback);
		};
		const Events = LoadEventPackage("events", { events: Fixture.NativeEvents });
		let OperationFailure = null;
		try {
			ExecuteDocumentationBlock(strExample, 3, { events: Events, "events/resource": Resources.ResourceModule, globals: { GetGlobalVariables: () => ({ MapName: "sourcejs_test_map" }) } });
		} catch (ErrorValue) {
			OperationFailure = ErrorValue;
		}

		g_Assert.equal(Fixture.GetCallbackCount(), 0, "A rejected duration must still release the documented listener.");
		g_Assert.equal(unWriteAttempts, 0, "The duration guard must run before any native writes.");
		g_Assert.match(OperationFailure?.message ?? "", /event callback did not observe/);
		g_Assert.equal(Fixture.CallbackFailures.length, 1);
		g_Assert.equal(Fixture.CallbackFailures[0].name, "RangeError");
		g_Assert.match(Fixture.CallbackFailures[0].message, /duration must be finite/);
		g_Assert.equal(Fixture.FiredEvents.length, 1);
		g_Assert.equal(Fixture.FiredEvents[0].Payload.Round, 3);
		g_Assert.equal(Fixture.FiredEvents[0].Payload.Duration, 83.75);
	};

	// Controlled getter values model unchecked native reads, not actual SDK execution.
	for (const flNativeDuration of [NaN, Infinity, -Infinity]) {
		VerifyInvalidDuration(strNormalizedSource, flNativeDuration);
		g_Assert.throws(() => VerifyInvalidDuration(strUnguardedSource, flNativeDuration), { name: "AssertionError", message: /duration guard must run before any native writes/ }, "Removing the guard must be detected by its write-order witness.");
	}
}

function VerifyRootDocumentationContracts(vecBlocks) {
	VerifyDocumentationCleanupFailures(vecBlocks);
	VerifyRoundMetricFloatGuard(vecBlocks[3]);

	const vecResourceBlocks = [1, 2, 3, 4, 5];
	for (const unBlockIndex of vecResourceBlocks) {
		for (const strFailureOperation of ["Write", "LoadZero", "LoadThrows"]) {
			const Fixture = CreateNativeEvents();
			const Resources = CreateDocumentationResources({ FailureOperation: strFailureOperation });
			Fixture.SetEventResourceCheck(Resources.RequireLoaded);
			const Events = LoadEventPackage("events", { events: Fixture.NativeEvents });
			g_Assert.throws(() => ExecuteDocumentationBlock(vecBlocks[unBlockIndex], unBlockIndex, { events: Events, "events/resource": Resources.ResourceModule, globals: { GetGlobalVariables: () => ({ MapName: "sourcejs_test_map" }) } }), { name: "Error", message: /resource/i }, "Resource failures must stop documented setup before registration or dispatch.");
			g_Assert.equal(Fixture.GetCallbackCount(), 0);
			g_Assert.equal(Fixture.FiredEvents.length, 0);
			g_Assert.deepEqual(Resources.Operations, (strFailureOperation === "Write") ? ["Write"] : ["Write", "Load"]);
		}

		const strMissingWrite = vecBlocks[unBlockIndex].replace(/^\t\w+Resource\.WriteEventResourceFile\(\);\r?$/m, "");
		g_Assert.equal(strMissingWrite === vecBlocks[unBlockIndex], false, "Each resource example must perform its write.");

		const Fixture = CreateNativeEvents();
		const Resources = CreateDocumentationResources();
		Fixture.SetEventResourceCheck(Resources.RequireLoaded);
		const Events = LoadEventPackage("events", { events: Fixture.NativeEvents });
		g_Assert.throws(() => ExecuteDocumentationBlock(strMissingWrite, unBlockIndex, { events: Events, "events/resource": Resources.ResourceModule, globals: { GetGlobalVariables: () => ({ MapName: "sourcejs_test_map" }) } }), { name: "AssertionError", message: /Load requires a written resource/ }, "A missing write must be detected before load or registration.");
		g_Assert.equal(Fixture.GetCallbackCount(), 0);
		g_Assert.equal(Fixture.FiredEvents.length, 0);
	}

	for (const unBlockIndex of [3, 5]) {
		const Fixture = CreateNativeEvents();
		const Resources = CreateDocumentationResources();
		const Events = LoadEventPackage("events", { events: Fixture.NativeEvents });
		g_Assert.throws(() => ExecuteDocumentationBlock(vecBlocks[unBlockIndex], unBlockIndex, { events: Events, "events/resource": Resources.ResourceModule, globals: { GetGlobalVariables: () => ({ MapName: "" }) } }), /requires an active map/);
		g_Assert.equal(Resources.Operations.length, 0);
		g_Assert.equal(Fixture.GetCallbackCount(), 0);
	}

	const UnsupportedFixture = CreateNativeEvents({ SupportsUInt64: false });
	const UnsupportedResources = CreateDocumentationResources();
	UnsupportedFixture.SetEventResourceCheck(UnsupportedResources.RequireLoaded);
	const UnsupportedEvents = LoadEventPackage("events", { events: UnsupportedFixture.NativeEvents });
	g_Assert.throws(() => ExecuteDocumentationBlock(vecBlocks[2], 2, { events: UnsupportedEvents, "events/resource": UnsupportedResources.ResourceModule }), /does not expose UInt64/);
	g_Assert.equal(UnsupportedFixture.GetCallbackCount(), 0);
	g_Assert.deepEqual(UnsupportedFixture.FiredEvents.map((Event) => Event.EventName), ["SourceJSCapabilityProbe"]);

	const LoggingFixture = CreateNativeEvents();
	const LoggingEvents = LoadEventPackage("events", { events: LoggingFixture.NativeEvents });
	const LoggingPluginModule = { exports: {} };
	const vecLogRecords = [];
	const LoggingModules = { events: LoggingEvents, loggers: CreateDocumentationLoggers(vecLogRecords) };
	const LoggingContext = g_VM.createContext({
		console: {
			log() {
				throw new Error("Event documentation must use the typed logger.");
			},
		},
		module: LoggingPluginModule,
		require(strModuleName) {
			g_Assert.equal(Object.hasOwn(LoggingModules, strModuleName), true);

			return LoggingModules[strModuleName];
		},
	});
	// Dispatch before unload; the generic executor immediately invokes unload.
	g_VM.runInContext(`"use strict";\n${vecBlocks[8]}`, LoggingContext);
	try {
		const strPlayerName = 'Name\n"Quoted"';
		const strReason = "Reason\\Path\nSecond line";
		g_Assert.equal(LoggingEvents.FireEvent("player_disconnect", { name: strPlayerName, reason: strReason }), true);
		g_Assert.deepEqual(LoggingFixture.CallbackFailures, []);
		g_Assert.deepEqual(vecLogRecords, [`PlayerDisconnect PlayerName=${JSON.stringify(strPlayerName)} Reason=${JSON.stringify(strReason)}`]);
	} finally {
		LoggingPluginModule.exports.Unload();
	}

	g_Assert.equal(LoggingFixture.GetCallbackCount(), 0);

	const UnloadFixture = CreateNativeEvents();
	const UnloadEvents = LoadEventPackage("events", { events: UnloadFixture.NativeEvents });
	ExecuteDocumentationBlock(vecBlocks[8], 8, { events: UnloadEvents, loggers: CreateDocumentationLoggers() });
	g_Assert.equal(UnloadFixture.GetCallbackCount(), 0, "The real unload lifecycle export must remove the registration.");

	const LegacyFixture = CreateNativeEvents();
	const LegacyEvents = LoadEventPackage("events", { events: LegacyFixture.NativeEvents });
	const strLegacyExport = vecBlocks[8].replace("Unload: g_UnloadPlugin", "UnloadPlugin: g_UnloadPlugin");
	g_Assert.equal(strLegacyExport === vecBlocks[8], false, "Negative lifecycle fixture must differ.");
	ExecuteDocumentationBlock(strLegacyExport, 8, { events: LegacyEvents, loggers: CreateDocumentationLoggers() });
	g_Assert.equal(LegacyFixture.GetCallbackCount(), 1, "Unrecognized lifecycle exports must not be invoked.");

	const DispatchFixture = CreateNativeEvents();
	const DispatchEvents = LoadEventPackage("events", { events: DispatchFixture.NativeEvents });
	const CallbackFailure = new Error("Controlled listener failure.");
	let RetainedEvent = null;
	let unLaterCalls = 0;
	const FailDuringDispatch = (Event) => {
		RetainedEvent = Event;
		Event.SetEventInteger("Value", 7);
		throw CallbackFailure;
	};
	const ReadDuringDispatch = () => {
		g_Assert.equal(RetainedEvent.GetEventInteger("Value"), 7);
		++unLaterCalls;
	};

	g_Assert.equal(DispatchEvents.RegisterEventListener("SourceJSDispatchContract", FailDuringDispatch), true);
	g_Assert.equal(DispatchEvents.RegisterEventListener("SourceJSDispatchContract", ReadDuringDispatch), true);
	g_Assert.equal(DispatchEvents.FireEvent("SourceJSDispatchContract", { Value: 1 }, true), true);
	g_Assert.equal(unLaterCalls, 1, "One failed listener must not stop later callbacks.");
	g_Assert.deepEqual(DispatchFixture.CallbackFailures, [CallbackFailure], "Listener failures must retain the original error identity.");
	g_Assert.throws(() => RetainedEvent.GetEventInteger("Value"), { name: "Error", message: /after its callback has returned/ }, "Retained event views must expire after dispatch.");
	g_Assert.equal(DispatchEvents.UnregisterEventListener("SourceJSDispatchContract", FailDuringDispatch), true);
	g_Assert.equal(DispatchEvents.UnregisterEventListener("SourceJSDispatchContract", ReadDuringDispatch), true);
	g_Assert.equal(DispatchFixture.GetCallbackCount(), 0);

	const unFailuresBeforeDefaultCheck = DispatchFixture.CallbackFailures.length;
	let bDefaultChecksCompleted = false;
	const VerifyTypedDefaults = EventValue => {
		for (const GetterCase of [
			{ Name: "GetEventBoolean", DefaultValue: false },
			{ Name: "GetEventInteger", DefaultValue: 0 },
			{ Name: "GetEventFloat", DefaultValue: 0 },
			{ Name: "GetEventString", DefaultValue: "" },
			{ Name: "GetEventUInt64", DefaultValue: 0n },
		]) {
			g_Assert.equal(EventValue[GetterCase.Name]("MissingKey"), GetterCase.DefaultValue);
			g_Assert.throws(() => EventValue[GetterCase.Name]("MissingKey", undefined));
			g_Assert.throws(() => EventValue[GetterCase.Name]("MissingKey", null));
		}

		g_Assert.equal(EventValue.IsEventEmpty(undefined), true);
		g_Assert.throws(() => EventValue.GetEventInteger("MissingKey", -0), /int32|32-bit/);
		g_Assert.throws(() => EventValue.SetEventInteger("Value", -0), /int32|32-bit/);
		g_Assert.equal(EventValue.GetEventFloat("MissingKey", 0.1), Math.fround(0.1));
		bDefaultChecksCompleted = true;
	};
	g_Assert.equal(DispatchEvents.RegisterEventListener("SourceJSOptionalArgumentContract", VerifyTypedDefaults), true);
	try {
		g_Assert.equal(DispatchEvents.FireEvent("SourceJSOptionalArgumentContract", {}, undefined), true);
		g_Assert.equal(bDefaultChecksCompleted, true, "Runtime-caught callback assertions must not become false-positive tests.");
		g_Assert.equal(DispatchFixture.CallbackFailures.length, unFailuresBeforeDefaultCheck);
		g_Assert.equal(DispatchFixture.FiredEvents.at(-1).DoNotBroadcast, false);
	} finally {
		g_Assert.equal(DispatchEvents.UnregisterEventListener("SourceJSOptionalArgumentContract", VerifyTypedDefaults), true);
	}

	const DefaultBroadcastDescriptor = DispatchEvents.CreateCustomEvent("SourceJSCustomDefaultBroadcast");
	g_Assert.equal(DefaultBroadcastDescriptor.FireEvent(undefined, undefined), true);
	g_Assert.equal(DispatchFixture.FiredEvents.at(-1).DoNotBroadcast, false);
	g_Assert.throws(() => DispatchEvents.FireEvent("SourceJSInvalidBroadcast", {}, null), /boolean/);
	g_Assert.throws(() => DefaultBroadcastDescriptor.FireEvent({}, null), /boolean/);

	const SnapshotFixture = CreateNativeEvents();
	const SnapshotEvents = LoadEventPackage("events", { events: SnapshotFixture.NativeEvents });
	const vecCalls = [];
	let bChangedRegistrations = false;
	const Later = () => vecCalls.push("Later");
	const Added = () => vecCalls.push("Added");
	const First = () => {
		vecCalls.push("First");

		if (!bChangedRegistrations) {
			bChangedRegistrations = true;
			g_Assert.equal(SnapshotEvents.UnregisterEventListener("SourceJSSnapshotContract", Later), true);
			g_Assert.equal(SnapshotEvents.RegisterEventListener("SourceJSSnapshotContract", Added), true);
		}
	};

	g_Assert.equal(SnapshotEvents.RegisterEventListener("SourceJSSnapshotContract", First), true);
	g_Assert.equal(SnapshotEvents.RegisterEventListener("SourceJSSnapshotContract", Later), true);
	g_Assert.equal(SnapshotEvents.FireEvent("SourceJSSnapshotContract", {}, true), true);
	g_Assert.deepEqual(vecCalls, ["First", "Later"], "Current dispatch must use its original listener snapshot.");
	g_Assert.equal(SnapshotEvents.FireEvent("SourceJSSnapshotContract", {}, true), true);
	g_Assert.deepEqual(vecCalls, ["First", "Later", "First", "Added"], "Registration changes must take effect on the next dispatch.");
	g_Assert.equal(SnapshotEvents.UnregisterEventListener("SourceJSSnapshotContract", First), true);
	g_Assert.equal(SnapshotEvents.UnregisterEventListener("SourceJSSnapshotContract", Added), true);
	g_Assert.equal(SnapshotFixture.GetCallbackCount(), 0);

	// Deliberate JavaScript-boundary fixture; this key is not a project identifier.
	const Variables = Object.create(null);
	Variables.__proto__ = { DefaultValue: { Marker: true } };
	const Payload = BuildPayload(Variables);
	g_Assert.equal(Object.getPrototypeOf(Payload), Object.prototype);
	g_Assert.equal(Object.hasOwn(Payload, "__proto__"), true);
	g_Assert.equal(Payload.__proto__.Marker, true);

	const ReadFailure = new Error("Stop payload reads.");
	const FailingVariables = {};
	Object.defineProperty(FailingVariables, "First", {
		enumerable: true,
		get() {
			throw ReadFailure;
		},
	});
	Object.defineProperty(FailingVariables, "Later", {
		enumerable: true,
		get() {
			throw new Error("Later getter must not run.");
		},
	});
	g_Assert.throws(() => BuildPayload(FailingVariables), (Failure) => Failure === ReadFailure);
	g_Assert.throws(() => DispatchEvents.FireEvent("SourceJSInvalidPayload", { ["Key\0Suffix"]: 1 }), /NUL/);
	g_Assert.throws(() => DispatchEvents.FireEvent("SourceJSInvalidPayload", { Value: "Value\0Suffix" }), /NUL/);

	let unValueReads = 0;
	const NonEnumerablePayload = {};
	Object.defineProperty(NonEnumerablePayload, "Value", {
		get() {
			++unValueReads;

			return 0.1;
		},
	});
	g_Assert.equal(DispatchEvents.FireEvent("SourceJSSinglePayloadRead", NonEnumerablePayload), true);
	g_Assert.equal(unValueReads, 0, "Non-enumerable payload fields must not be read.");
	g_Assert.equal(Object.hasOwn(DispatchFixture.FiredEvents.at(-1).Payload, "Value"), false);

	const EnumerablePayload = Object.create({ Inherited: true });
	Object.defineProperty(EnumerablePayload, "Value", {
		enumerable: true,
		get() {
			++unValueReads;

			return 0.1;
		},
	});
	Object.defineProperty(EnumerablePayload, Symbol("IgnoredPayloadKey"), {
		enumerable: true,
		get() {
			throw new Error("Symbol payload getters must not run.");
		},
	});
	g_Assert.equal(DispatchEvents.FireEvent("SourceJSSinglePayloadRead", EnumerablePayload), true);
	g_Assert.equal(unValueReads, 1, "Each enumerable payload value must be read exactly once.");
	g_Assert.deepEqual(Object.keys(DispatchFixture.FiredEvents.at(-1).Payload), ["Value"]);
	g_Assert.equal(DispatchFixture.FiredEvents.at(-1).Payload.Value, Math.fround(0.1), "Event float payloads must use native single-precision values.");
	g_Assert.equal(DispatchEvents.FireEvent("SourceJSNegativeZeroPayload", { Value: -0 }), true);
	g_Assert.equal(Object.is(DispatchFixture.FiredEvents.at(-1).Payload.Value, -0), true);

	const ResourceVariables = Object.create({ Inherited: "long" });
	ResourceVariables.Value = -0;
	Object.defineProperty(ResourceVariables, "Hidden", {
		get() {
			throw new Error("Hidden resource definitions must not be read.");
		},
	});
	g_Assert.equal(DispatchEvents.CreateEventResourceText("SourceJSFilteredResource", ResourceVariables), '"SourceJSFilteredResource"\n{\n\t"Value"\t"float"\n}\n');

	const strBindings = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8");
	const unMaximumDefinitionCharacterCount = 20000;
	const DefinitionMatch = /^(\t+)bool SetGameEventPayloadFromObject\([^\n]*$/m.exec(strBindings);
	g_Assert.notEqual(DefinitionMatch, null, "The native payload definition must exist.");
	const unDefinitionStart = DefinitionMatch.index;
	const nDefinitionEnd = strBindings.indexOf(`\n${DefinitionMatch[1]}}`, unDefinitionStart);
	g_Assert.equal((nDefinitionEnd > unDefinitionStart) && ((nDefinitionEnd - unDefinitionStart) < unMaximumDefinitionCharacterCount), true, "The native payload definition must have bounded, matching-indent extraction.");
	const strPayloadDefinition = strBindings.slice(unDefinitionStart, nDefinitionEnd);
	g_Assert.equal(strPayloadDefinition.includes("if (strKey.find('\\0') != std::string::npos)"), true, "Native payload keys must reject embedded NUL before committing.");
	g_Assert.match(strPayloadDefinition, /ThrowError\(pIsolate, kEmbeddedNullPayloadKeyError\)/);
}

function CreateNativeEventVariables() {
	return {
		CreateEventVariable(strName, strType, DefaultValue) {
			if (arguments.length === 0) {
				return undefined;
			}

			RequireNonEmptyString(strName, "events/variable.CreateEventVariable strName");
			const strResolvedType = ((strType === undefined) || (strType === null)) ? GetEventTypeFromValue(DefaultValue) : RequireEventType(strType);
			const Definition = { Name: strName, Type: strResolvedType };
			if (arguments.length > 2) {
				Definition.DefaultValue = DefaultValue;
			}

			return Definition;
		},
		InferEventVariable(Value) {
			return GetEventTypeFromValue(Value);
		},
		CoerceEventVariable(strType = "string", Value = undefined) {
			RequireEventType(strType);

			if (strType === "bool") {
				return Boolean(Value);
			}

			if (["string", "local", "wstring"].includes(strType)) {
				if (typeof Value === "symbol") {
					throw new TypeError("Event string coercion cannot convert a symbol.");
				}

				return String(Value);
			}

			if (typeof Value === "bigint") {
				throw new TypeError("Event number coercion cannot convert a BigInt.");
			}

			const dblValue = Number(Value);

			return (strType === "float") ? dblValue : (dblValue | 0);
		},
		GetEventVariableTypes() {
			return g_vecEventVariableTypes.slice();
		},
	};
}

function VerifyEventVariableProperties(Variable) {
	for (const strOldName of ["name", "type", "comment", "defaultValue", "setterType", "define", "m_ValueDefault", "m_strEventVariableName", "m_strEventVariableType"]) {
		g_Assert.equal(strOldName in Variable, false, `Obsolete event-variable member ${strOldName} remains.`);
	}
}

function TestEventVariables() {
	// These are native doubles: executing actual packages/examples verifies the
	// JavaScript migration, not SDK conversion, IO, or callback-thread behavior.
	const NativeVariables = CreateNativeEventVariables();
	const Variables = LoadEventPackage("events/variable", { "events/variable": NativeVariables });
	const Fixture = CreateNativeEvents();
	const CustomEvents = LoadEventPackage("events/custom", { "events/custom": Fixture.NativeEvents });
	const unExpectedVariableExportCount = 21;
	g_Assert.equal(Object.keys(Variables).length, unExpectedVariableExportCount);
	g_Assert.equal(Object.keys(Variables).every((strName) => /^[A-Z]/.test(strName)), true);
	g_Assert.deepEqual(Object.keys(Variables.CreateEventVariableDefinition("Label", "string")), ["Name", "Type"]);
	g_Assert.deepEqual(Object.keys(Variables.CreateEventVariableDefinition("Label", "string", undefined)), ["Name", "Type", "DefaultValue"]);
	VerifyEventVariableProperties(Variables.CreateEventVariableDefinition("Label", "string", "Ready"));
	VerifyEventVariableProperties(new Variables.EventVariable("Label", "string", "Ready"));
	g_Assert.throws(() => Variables.CreateEventVariableDefinition(), /non-empty string/);
	g_Assert.throws(() => Variables.CreateEventVariableDefinition(""), /non-empty string/);
	g_Assert.throws(() => Variables.CreateEventVariableDefinition(12), /non-empty string/);
	g_Assert.throws(() => new Variables.EventVariableTemplate("integer"), /Unsupported event variable type/);
	g_Assert.throws(() => new Variables.EventVariableTemplate("long", 12), /comments must be strings/);

	for (const strOldType of ["Boolean", "boolean", "integer", "int", "number", "str"]) {
		g_Assert.throws(() => Variables.CreateEventVariableDefinition("Value", strOldType), /exact supported spelling/);
	}

	g_Assert.equal(GetEventTypeFromDefinition({ type: "long", defaultValue: 12 }), "string");
	g_Assert.deepEqual(BuildPayload({ Value: { type: "long", defaultValue: 12 } }), {});

	for (const TemplateType of [
		Variables.BoolVariable,
		Variables.ByteVariable,
		Variables.ShortVariable,
		Variables.LongVariable,
		Variables.FloatVariable,
		Variables.StringVariable,
	]) {
		const Template = new TemplateType("Description");
		VerifyEventVariableProperties(Template);
		VerifyEventVariableProperties(Template.DefineEventVariable("Value"));
		g_Assert.equal(CustomEvents.CreateEventPayload({ Value: Template }).Value, Template.DefaultValue);
		Template.DefaultValue = 7;
		g_Assert.equal(Template.DefineEventVariable("Value").DefaultValue, 7);
		g_Assert.equal(CustomEvents.CreateEventPayload({ Value: Template }).Value, 7);

		const MetadataDefaultValue = { Marker: true };
		const MetadataTemplate = new TemplateType("Metadata", MetadataDefaultValue);
		g_Assert.equal(MetadataTemplate.DefaultValue, MetadataDefaultValue);
		g_Assert.equal(MetadataTemplate.DefineEventVariable("Metadata").DefaultValue, MetadataDefaultValue);
	}

	const strDocument = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "docs", "api", "events-variable.md"), "utf8");
	const vecBlocks = ExtractJavaScriptBlocks(strDocument);
	const unExpectedVariableDocumentationBlockCount = 9;
	g_Assert.equal(vecBlocks.length, unExpectedVariableDocumentationBlockCount);
	g_Assert.doesNotMatch(strDocument, /\.(?:name|type|comment|defaultValue|setterType|define)\b|`(?:create|coerce|infer|types)`/);
	for (const [unBlockIndex, strSource] of vecBlocks.entries()) {
		ExecuteDocumentationBlock(strSource, unBlockIndex, { "events/variable": Variables, "events/custom": CustomEvents }, "events-variable.md");
	}

	const InvalidVariable = { name: "Legacy" };
	g_Assert.throws(() => VerifyEventVariableProperties(InvalidVariable), /Obsolete event-variable member/);
}

function TrackExports(ModuleExports, setExercisedExports) {
	return new Proxy(ModuleExports, {
		get(Target, PropertyKey, Receiver) {
			const Value = Reflect.get(Target, PropertyKey, Receiver);

			if ((typeof PropertyKey === "string") && g_vecExpectedExports.includes(PropertyKey) && (typeof Value === "function")) {
				return function TrackedExport(...vecArguments) {
					setExercisedExports.add(PropertyKey);

					return Reflect.apply(Value, Target, vecArguments);
				};
			}

			return Value;
		},
	});
}

const g_SourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
const g_EventsCacheEntry = require.cache[g_strEventsPath];
const g_RuntimeCacheEntry = require.cache[g_strRuntimePath];

try {
	VerifyFloatSetterStorage();

	const g_EventFixture = CreateNativeEvents();

	globalThis.sourcejs = { events: g_EventFixture.NativeEvents };
	delete require.cache[g_strEventsPath];
	delete require.cache[g_strRuntimePath];

	const g_Events = require(g_strEventsPath);

	g_Assert.deepEqual(Object.keys(g_Events).sort(), g_vecExpectedExports);

	const strHookExampleSource = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "examples", "plugins", "disabled", "api-events-hooks", "index.js"), "utf8");
	const vecHookExampleImports = [...strHookExampleSource.matchAll(/const\s*\{([^}]+)\}\s*=\s*require\("events"\);/g)];
	g_Assert.equal(vecHookExampleImports.length, 1, "The hook example must retain its checked events import.");
	for (const strBinding of vecHookExampleImports[0][1].split(",").map((strValue) => strValue.trim()).filter(Boolean)) {
		const strExportName = strBinding.split(":")[0].trim();
		g_Assert.equal(typeof g_Events[strExportName], "function", `Hook example imports absent events.${strExportName}`);
	}

	const g_strDocumentation = g_FileSystem.readFileSync(g_strEventsDocumentationPath, "utf8");
	const g_vecDocumentationBlocks = ExtractJavaScriptBlocks(g_strDocumentation);
	const g_setExercisedExports = new Set();
	const g_DocumentedEvents = TrackExports(g_Events, g_setExercisedExports);

	const g_unExpectedDocumentationBlockCount = 9;
	g_Assert.equal(g_vecDocumentationBlocks.length, g_unExpectedDocumentationBlockCount, "The root event documentation must retain its nine executable blocks.");
	g_Assert.doesNotMatch(g_strDocumentation, /generated by|auto-generated|example generator/i);
	g_Assert.doesNotMatch(g_strDocumentation, /addressString|payload\.skip|events\/hooks|source\.events/);
	g_Assert.doesNotMatch(g_strDocumentation, /\bconsole\.log\(/, "Executable event documentation must use the typed logger.");

	for (const strSource of g_vecDocumentationBlocks) {
		new g_VM.Script(`"use strict";\n${strSource}`);
	}

	const DocumentationResources = CreateDocumentationResources();
	g_EventFixture.SetEventResourceCheck(DocumentationResources.RequireLoaded);
	try {
		for (const [unBlockIndex, strSource] of g_vecDocumentationBlocks.entries()) {
			ExecuteDocumentationBlock(strSource, unBlockIndex, {
				events: g_DocumentedEvents,
				"events/resource": DocumentationResources.ResourceModule,
				loggers: CreateDocumentationLoggers(),
				globals: {
					GetGlobalVariables() {
						return { MapName: "sourcejs_test_map" };
					},
				},
			});
		}
	} finally {
		g_EventFixture.SetEventResourceCheck(null);
	}

	VerifyRootDocumentationContracts(g_vecDocumentationBlocks);

	const g_unExpectedLoadedEventNameCount = 7;
	g_Assert.equal(DocumentationResources.LoadedNames.size, g_unExpectedLoadedEventNameCount);
	g_Assert.deepEqual(DocumentationResources.Operations, ["Write", "Load", "Write", "Load", "Write", "Load", "Write", "Load", "Write", "Load"]);

	for (const strExportName of g_vecExpectedExports) {
		g_Assert.equal(g_setExercisedExports.has(strExportName), true, `Documentation did not call events.${strExportName}.`);
	}

	g_Assert.equal(g_EventFixture.GetCallbackCount(), 0);
	g_Assert.deepEqual(g_EventFixture.CallbackFailures, [], "Documented event callbacks must not hide failed assertions.");
	g_Assert.equal(g_EventFixture.FiredEvents.some((Event) => Event.EventName === "SourceJSRoundMetric"), true);
	g_Assert.equal(g_EventFixture.FiredEvents.some((Event) => Event.EventName === "SourceJSRoundSummary"), true);

	const g_Variables = { Count: { Type: "long", DefaultValue: 1 } };
	const g_Descriptor = g_Events.CreateCustomEvent("SourceJSDescriptorTest", g_Variables);

	g_Assert.equal(g_Descriptor.EventName, "SourceJSDescriptorTest");
	g_Assert.strictEqual(g_Descriptor.EventVariables, g_Variables);
	g_Assert.equal(typeof g_Descriptor.EventResourceText, "string");
	g_Assert.equal(typeof g_Descriptor.FireEvent, "function");
	g_Assert.deepEqual(g_Events.CreateEventPayload(g_Variables, { Count: 2 }), { Count: 2 });
	g_Assert.equal(g_Descriptor.FireEvent({ Count: 3 }, true), true);

	let g_FirstView = null;
	let g_nSecondValue = 0;
	let g_unSecondUnsignedInteger64Value = 0n;

	function HandleFirstIntegerEvent(Event) {
		g_FirstView = Event;
		Event.SetEventInteger("Value", 42);

		g_Assert.equal(typeof Event.Address, "bigint", "Event addresses must remain BigInt.");
		g_Assert.ok(Event.Address > 0n, "An active event must expose a positive address.");

		for (const InvalidValue of [-0x80000001, 0x80000000, 1.5, 1n, "1", NaN, Infinity]) {
			g_Assert.throws(() => Event.SetEventInteger("Value", InvalidValue), { name: "TypeError", message: /signed 32-bit integer/ }, "Event integer setters must reject invalid signed 32-bit values.");
			g_Assert.equal(Event.GetEventInteger("Value"), 42, "Rejected event integer writes must not change the payload.");
		}

		for (const nBoundaryValue of [-0x80000000, 0x7FFFFFFF]) {
			g_Assert.equal(Event.SetEventInteger("IntegerBoundary", nBoundaryValue), true);
			g_Assert.equal(Event.GetEventInteger("IntegerBoundary"), nBoundaryValue, "Event integer boundaries must remain exact signed Numbers.");
		}

		g_Assert.throws(() => Event.IsEventEmpty("\0Value"), /embedded NUL/);
		g_Assert.throws(() => Event.GetEventString("Value\0Suffix"), /embedded NUL/);
		g_Assert.throws(() => Event.SetEventInteger("Value\0Suffix", 1), /embedded NUL/);
		g_Assert.throws(() => Event.GetEventString("Text", "a\0b"), /embedded NUL/);
		g_Assert.throws(() => Event.SetEventString("Text", "a\0b"), /embedded NUL/);
		g_Assert.equal(Event.SetEventString("Text", ""), true);
		g_Assert.equal(Event.GetEventString("Text", "fallback"), "");
	}

	function HandleSecondIntegerEvent(Event) {
		g_nSecondValue = Event.GetEventInteger("Value");
	}

	function HandleFirstUnsignedInteger64Event(Event) {
		Event.SetEventUInt64("Value", g_unMaximumUnsignedInteger64);

		for (const nInvalidValue of [-1n, g_unMaximumUnsignedInteger64 + 1n]) {
			g_Assert.throws(() => Event.SetEventUInt64("Value", nInvalidValue), { name: "RangeError", message: /unsigned 64-bit integer/ }, "Event unsigned 64-bit setters must reject out-of-range BigInts.");
			g_Assert.equal(Event.GetEventUInt64("Value"), g_unMaximumUnsignedInteger64, "Rejected unsigned 64-bit writes must not change the payload.");
		}

		g_Assert.throws(() => Event.SetEventUInt64("Value", 1), /unsigned 64-bit BigInt value/);
	}

	function HandleSecondUnsignedInteger64Event(Event) {
		g_unSecondUnsignedInteger64Value = Event.GetEventUInt64("Value", 0n);
		g_Assert.throws(() => Event.GetEventUInt64("Value", 1), /unsigned 64-bit BigInt value/);
	}

	g_Assert.equal(g_Events.RegisterEventListener("SourceJSWriteThrough", HandleFirstIntegerEvent), true);
	g_Assert.equal(g_Events.RegisterEventListener("SourceJSWriteThrough", HandleSecondIntegerEvent), true);
	g_Assert.equal(g_Events.FireEvent("SourceJSWriteThrough", { Value: 1 }, true), true);
	g_Assert.deepEqual(g_EventFixture.CallbackFailures, [], "Integer/address callbacks must not hide failed assertions.");
	g_Assert.equal(g_nSecondValue, 42, "Later listeners must observe earlier signed-integer writes.");
	g_Assert.equal(g_Events.UnregisterEventListener("SourceJSWriteThrough", HandleFirstIntegerEvent), true);
	g_Assert.equal(g_Events.UnregisterEventListener("SourceJSWriteThrough", HandleSecondIntegerEvent), true);
	g_Assert.throws(() => g_FirstView.GetEventInteger("Value"), /after its callback has returned/);

	g_Assert.equal(g_Events.RegisterEventListener("SourceJSUInt64", HandleFirstUnsignedInteger64Event), true);
	g_Assert.equal(g_Events.RegisterEventListener("SourceJSUInt64", HandleSecondUnsignedInteger64Event), true);
	g_Assert.equal(g_Events.FireEvent("SourceJSUInt64", { Value: 0n }, true), true);
	g_Assert.deepEqual(g_EventFixture.CallbackFailures, [], "Unsigned 64-bit callbacks must not hide failed assertions.");
	g_Assert.equal(g_unSecondUnsignedInteger64Value, g_unMaximumUnsignedInteger64, "Later listeners must retain exact unsigned 64-bit BigInt values.");
	g_Assert.equal(g_Events.UnregisterEventListener("SourceJSUInt64", HandleFirstUnsignedInteger64Event), true);
	g_Assert.equal(g_Events.UnregisterEventListener("SourceJSUInt64", HandleSecondUnsignedInteger64Event), true);

	g_Assert.throws(() => g_Events.FireEvent("", {}, false), /non-empty string/);
	g_Assert.throws(() => g_Events.FireEvent("BadPayload", [], false), /expects an object/);
	g_Assert.throws(() => g_Events.FireEvent("BadPayload", { Value: null }, false), /supported game-event type/);
	g_Assert.throws(() => g_Events.FireEvent("BadPayload", { Value: Number.POSITIVE_INFINITY }, false), /finite float/);
	g_Assert.throws(() => g_Events.FireEvent("BadBroadcast", {}, 1), /expects a boolean/);
	g_Assert.throws(() => g_Events.RegisterEventListener("Event", null), /expects a function/);
	g_Assert.throws(() => g_Events.CreateEventPayload([], {}), /expects an object/);
	g_Assert.throws(() => g_Events.CreateEventResourceText("Event", []), /expects an object/);

	{
		const Fixture = CreateNativeEvents();
		let mapListenerWrappers = null;
		const Events = LoadEventPackage("events", { events: Fixture.NativeEvents }, (Context) => {
			mapListenerWrappers = g_VM.runInContext("g_mapListenerWrappers", Context);
		});
		const RegisterNativeEventListener = Fixture.NativeEvents.RegisterEventListener;
		const UnregisterNativeEventListener = Fixture.NativeEvents.UnregisterEventListener;
		const RegistrationError = new Error("Native event registration failed.");
		const UnregistrationError = new Error("Native event unregistration failed.");
		const strEventName = "SourceJSRegistrationRollback";
		const Callback = () => {};

		try {
			for (const RegistrationOutcome of [false, RegistrationError]) {
				Fixture.NativeEvents.RegisterEventListener = function RegisterFailedEventListener() {
					g_Assert.strictEqual(this, Fixture.NativeEvents);

					if (RegistrationOutcome !== false) {
						throw RegistrationOutcome;
					}

					return false;
				};

				if (RegistrationOutcome === false) {
					g_Assert.equal(Events.RegisterEventListener(strEventName, Callback), false);

				} else {
					g_Assert.throws(() => Events.RegisterEventListener(strEventName, Callback), (ErrorValue) => ErrorValue === RegistrationError);
				}

				g_Assert.equal(Fixture.GetCallbackCount(), 0);
				g_Assert.equal(mapListenerWrappers.size, 0);
			}

			Fixture.NativeEvents.RegisterEventListener = RegisterNativeEventListener;
			g_Assert.throws(() => Events.RegisterEventListener("", Callback), /non-empty string/);
			g_Assert.equal(mapListenerWrappers.size, 0);
			delete Fixture.NativeEvents.RegisterEventListener;
			g_Assert.throws(() => Events.RegisterEventListener(strEventName, Callback), /does not expose RegisterEventListener/);
			g_Assert.equal(mapListenerWrappers.size, 0);
			Fixture.NativeEvents.RegisterEventListener = RegisterNativeEventListener;

			g_Assert.equal(Events.RegisterEventListener(strEventName, Callback), true);
			Fixture.NativeEvents.RegisterEventListener = () => false;
			g_Assert.equal(Events.RegisterEventListener(strEventName, Callback), false);
			Fixture.NativeEvents.RegisterEventListener = RegisterNativeEventListener;
			g_Assert.equal(Events.RegisterEventListener(strEventName, Callback), true);
			g_Assert.equal(Fixture.GetCallbackCount(), 2);
			g_Assert.equal(mapListenerWrappers.get(strEventName).get(Callback).length, 2);
			Fixture.NativeEvents.UnregisterEventListener = () => false;
			g_Assert.equal(Events.UnregisterEventListener(strEventName, Callback), false);
			g_Assert.equal(mapListenerWrappers.get(strEventName).get(Callback).length, 2);
			Fixture.NativeEvents.UnregisterEventListener = () => {
				throw UnregistrationError;
			};
			g_Assert.throws(() => Events.UnregisterEventListener(strEventName, Callback), (ErrorValue) => ErrorValue === UnregistrationError);
			g_Assert.equal(mapListenerWrappers.get(strEventName).get(Callback).length, 2);
			Fixture.NativeEvents.UnregisterEventListener = UnregisterNativeEventListener;
			g_Assert.equal(Events.UnregisterEventListener(strEventName, Callback), true);
			g_Assert.equal(Events.UnregisterEventListener(strEventName, Callback), true);
			g_Assert.equal(Events.UnregisterEventListener(strEventName, Callback), false);
			g_Assert.equal(Fixture.GetCallbackCount(), 0);
			g_Assert.equal(mapListenerWrappers.size, 0);

			for (const RegistrationOutcome of [false, RegistrationError]) {
				Fixture.NativeEvents.RegisterEventListener = function RegisterReentrantEventListener(strRegisteredEventName) {
					Fixture.NativeEvents.RegisterEventListener = RegisterNativeEventListener;
					g_Assert.equal(Events.RegisterEventListener(strRegisteredEventName, Callback), true);

					if (RegistrationOutcome !== false) {
						throw RegistrationOutcome;
					}

					return false;
				};

				if (RegistrationOutcome === false) {
					g_Assert.equal(Events.RegisterEventListener(strEventName, Callback), false);

				} else {
					g_Assert.throws(() => Events.RegisterEventListener(strEventName, Callback), (ErrorValue) => ErrorValue === RegistrationError);
				}

				g_Assert.equal(Fixture.GetCallbackCount(), 1);
				g_Assert.equal(mapListenerWrappers.get(strEventName).get(Callback).length, 1);
				g_Assert.equal(Events.UnregisterEventListener(strEventName, Callback), true);
				g_Assert.equal(Fixture.GetCallbackCount(), 0);
				g_Assert.equal(mapListenerWrappers.size, 0);
			}
		} finally {
			Fixture.NativeEvents.RegisterEventListener = RegisterNativeEventListener;
			Fixture.NativeEvents.UnregisterEventListener = UnregisterNativeEventListener;
		}
	}

	const g_ReducedFixture = CreateNativeEvents({ SupportsUInt64: false });
	let g_ReducedEvent = null;

	function InspectReducedEvent(Event) {
		g_ReducedEvent = Event;
	}

	g_Assert.equal(g_ReducedFixture.NativeEvents.RegisterEventListener("SourceJSReduced", InspectReducedEvent), true);
	g_Assert.equal(g_ReducedFixture.NativeEvents.FireEvent("SourceJSReduced", {}, true), true);
	g_Assert.equal(g_ReducedFixture.NativeEvents.UnregisterEventListener("SourceJSReduced", InspectReducedEvent), true);
	g_Assert.equal(Object.hasOwn(g_ReducedEvent, "GetEventUInt64"), false);
	g_Assert.equal(Object.hasOwn(g_ReducedEvent, "SetEventUInt64"), false);
	g_Assert.throws(() => g_ReducedFixture.NativeEvents.FireEvent("SourceJSReduced", { Sequence: 1n }, true), /supported game-event type/);

	delete require.cache[g_strEventsPath];
	delete require.cache[g_strRuntimePath];
	delete globalThis.sourcejs;

	g_Assert.throws(() => require(g_strEventsPath), { name: "Error", message: /^SourceJS native runtime is not installed/ }, "Events must report native absence, not a lookup or unrelated error.");

	TestEventVariables();

	console.log("[  OK  ] events and event-variable packages/documentation checks passed (native doubles, not SDK proof)");
} finally {
	delete require.cache[g_strEventsPath];
	delete require.cache[g_strRuntimePath];

	if (g_EventsCacheEntry !== undefined) {
		require.cache[g_strEventsPath] = g_EventsCacheEntry;
	}

	if (g_RuntimeCacheEntry !== undefined) {
		require.cache[g_strRuntimePath] = g_RuntimeCacheEntry;
	}

	if (g_SourceJSDescriptor === undefined) {
		delete globalThis.sourcejs;

	} else {
		Object.defineProperty(globalThis, "sourcejs", g_SourceJSDescriptor);
	}

	g_Module._load = g_OriginalModuleLoad;
}
