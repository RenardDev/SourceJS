#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strListenerDocumentationPath = g_Path.join(g_strProjectRoot, "docs", "api", "events-listener.md");
const g_strListenerPath = g_Path.join(g_strProjectRoot, "packages", "sourcejs", "events", "listener.js");
const g_strRuntimePath = g_Path.join(g_strProjectRoot, "packages", "sourcejs", "internal", "runtime.js");

const g_OriginalModuleLoad = g_Module._load;
const g_SourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
const g_mapOriginalCacheEntries = new Map([g_strListenerPath, g_strRuntimePath].map((strModulePath) => [strModulePath, require.cache[strModulePath]]));

// Controlled native views/registries/resources do not execute the engine or prove its ABI.
// Direct fixtures fail fast on assertions; documented dispatch fixtures capture callback failures.
const g_vecExpectedExports = ["FireEvent", "RegisterEventListener", "UnregisterEventListener"];
const g_vecExpectedEventProperties = ["Address", "EventName", "Local", "Reliable"];
const g_vecExpectedEventMethods = [
	"GetEventBoolean",
	"GetEventFloat",
	"GetEventInteger",
	"GetEventString",
	"IsEventEmpty",
	"SetEventBoolean",
	"SetEventFloat",
	"SetEventInteger",
	"SetEventString",
];
const g_vecUnsignedInteger64EventMethods = ["GetEventUInt64", "SetEventUInt64"];
const g_nMinimumSignedInteger32 = -0x80000000;
const g_nMaximumSignedInteger32 = 0x7FFFFFFF;
const g_flMaximumFloat = 3.4028234663852886E38;
const g_unMaximumUnsignedInteger64 = 0xFFFFFFFFFFFFFFFFn;
const g_unFirstEventAddress = 0x11170n;
const g_unEventAddressStep = 0x10n;

function RequireEventString(strValue, strOperation) {
	if (typeof strValue !== "string") {
		throw new TypeError(strOperation + " expects a string.");
	}

	if (strValue.includes("\0")) {
		throw new TypeError(strOperation + " does not accept an embedded NUL.");
	}

	return strValue;
}

function RequireNonEmptyString(strValue, strOperation) {
	if ((typeof strValue !== "string") || (strValue.length === 0)) {
		throw new TypeError(`${strOperation} expects a non-empty string.`);
	}

	if (strValue.includes("\0")) {
		throw new TypeError(strOperation + " does not accept an embedded NUL.");
	}

	return strValue;
}

function RequireObject(Value, strOperation) {
	if ((Value === null) || (typeof Value !== "object") || Array.isArray(Value)) {
		throw new TypeError(`${strOperation} expects an object.`);
	}

	return Value;
}

function RequireSignedInteger32(nValue, strOperation) {
	if (!Number.isInteger(nValue) || Object.is(nValue, -0) || (nValue < g_nMinimumSignedInteger32) || (nValue > g_nMaximumSignedInteger32)) {
		throw new TypeError(`${strOperation} expects an int32.`);
	}

	return nValue;
}

function RequireFloat(dblValue, strOperation) {
	if ((typeof dblValue !== "number") || !Number.isFinite(dblValue) || (Math.abs(dblValue) > g_flMaximumFloat)) {
		throw new TypeError(`${strOperation} expects a finite float.`);
	}

	return Math.fround(dblValue);
}

function RequireUnsignedInteger64(unValue, strOperation) {
	if (typeof unValue !== "bigint") {
		throw new TypeError(`${strOperation} expects an unsigned 64-bit BigInt value.`);
	}

	if ((unValue < 0n) || (unValue > g_unMaximumUnsignedInteger64)) {
		throw new RangeError(`${strOperation} expects a uint64 value.`);
	}

	return unValue;
}

function CreateListenerFixture({ SupportsUInt64: bSupportsUInt64 = true, EventDefinitions: mapEventDefinitions = null, CaptureCallbackErrors: bCaptureCallbackErrors = false } = {}) {
	const mapCallbacksByName = new Map();
	const vecFiredEvents = [];
	const vecCallbackErrors = [];
	let unNextAddress = g_unFirstEventAddress;

	function BuildValidatedPayload(EventPayload) {
		RequireObject(EventPayload, "events/listener.FireEvent EventPayload");

		const NativePayload = {};
		const vecNames = Object.keys(EventPayload);
		for (const strName of vecNames) {
			RequireNonEmptyString(strName, "events/listener.FireEvent EventPayload key");
			const Value = EventPayload[strName];

			if ((typeof Value === "boolean") || (typeof Value === "string")) {
				if (typeof Value === "string") {
					RequireEventString(Value, "events/listener.FireEvent EventPayload value");
				}

				Object.defineProperty(NativePayload, strName, { value: Value, enumerable: true, writable: true, configurable: true });
				continue;
			}

			if (typeof Value === "number") {
				const bSignedInteger = Number.isInteger(Value) && (Value >= g_nMinimumSignedInteger32) && (Value <= g_nMaximumSignedInteger32) && !Object.is(Value, -0);
				Object.defineProperty(NativePayload, strName, { value: bSignedInteger ? Value : RequireFloat(Value, "events/listener.FireEvent EventPayload value"), enumerable: true, writable: true, configurable: true });
				continue;
			}

			if ((typeof Value === "bigint") && bSupportsUInt64) {
				Object.defineProperty(NativePayload, strName, { value: RequireUnsignedInteger64(Value, "events/listener.FireEvent EventPayload value"), enumerable: true, writable: true, configurable: true });
				continue;
			}

			throw new TypeError("events/listener.FireEvent EventPayload contains an unsupported value.");
		}

		return NativePayload;
	}

	function CreateEventView(Dispatch) {
		function RequireActive(strOperation) {
			if (!Dispatch.Active) {
				throw new Error(`${strOperation} cannot access an event after its callback has returned.`);
			}
		}

		function RequireEventKey(strKey, strOperation) {
			RequireActive(strOperation);

			return RequireNonEmptyString(strKey, `${strOperation} strKey`);
		}

		const Event = {
			EventName: Dispatch.Name,
			Reliable: false,
			Local: false,
			Address: Dispatch.Address,
			IsEventEmpty(strKey) {
				RequireActive("GameEvent.IsEventEmpty");

				if (strKey === undefined) {
					return Object.keys(Dispatch.Payload).length === 0;
				}

				return !Object.hasOwn(Dispatch.Payload, RequireEventKey(strKey, "GameEvent.IsEventEmpty"));
			},
			GetEventBoolean(strKey, bDefaultValue) {
				const bNormalizedDefaultValue = (arguments.length > 1) ? bDefaultValue : false;
				if (typeof bNormalizedDefaultValue !== "boolean") {
					throw new TypeError("GameEvent.GetEventBoolean bDefaultValue expects a boolean.");
				}

				const Value = Dispatch.Payload[RequireEventKey(strKey, "GameEvent.GetEventBoolean")];

				return (typeof Value === "boolean") ? Value : bNormalizedDefaultValue;
			},
			GetEventInteger(strKey, nDefaultValue) {
				const nNormalizedDefaultValue = (arguments.length > 1) ? RequireSignedInteger32(nDefaultValue, "GameEvent.GetEventInteger nDefaultValue") : 0;

				const Value = Dispatch.Payload[RequireEventKey(strKey, "GameEvent.GetEventInteger")];

				return Number.isInteger(Value) ? Value : nNormalizedDefaultValue;
			},
			GetEventFloat(strKey, dblDefaultValue) {
				const flNormalizedDefaultValue = (arguments.length > 1) ? RequireFloat(dblDefaultValue, "GameEvent.GetEventFloat dblDefaultValue") : 0.0;

				const Value = Dispatch.Payload[RequireEventKey(strKey, "GameEvent.GetEventFloat")];

				return (typeof Value === "number") ? Value : flNormalizedDefaultValue;
			},
			GetEventString(strKey, strDefaultValue) {
				const strNormalizedDefaultValue = (arguments.length > 1) ? RequireEventString(strDefaultValue, "GameEvent.GetEventString strDefaultValue") : "";

				const Value = Dispatch.Payload[RequireEventKey(strKey, "GameEvent.GetEventString")];

				return (typeof Value === "string") ? Value : strNormalizedDefaultValue;
			},
			SetEventBoolean(strKey, bValue) {
				if (typeof bValue !== "boolean") {
					throw new TypeError("GameEvent.SetEventBoolean bValue expects a boolean.");
				}

				Object.defineProperty(Dispatch.Payload, RequireEventKey(strKey, "GameEvent.SetEventBoolean"), { value: bValue, enumerable: true, writable: true, configurable: true });

				return true;
			},
			SetEventInteger(strKey, nValue) {
				Object.defineProperty(Dispatch.Payload, RequireEventKey(strKey, "GameEvent.SetEventInteger"), { value: RequireSignedInteger32(nValue, "GameEvent.SetEventInteger nValue"), enumerable: true, writable: true, configurable: true });

				return true;
			},
			SetEventFloat(strKey, dblValue) {
				Object.defineProperty(Dispatch.Payload, RequireEventKey(strKey, "GameEvent.SetEventFloat"), { value: RequireFloat(dblValue, "GameEvent.SetEventFloat dblValue"), enumerable: true, writable: true, configurable: true });

				return true;
			},
			SetEventString(strKey, strValue) {
				RequireEventString(strValue, "GameEvent.SetEventString strValue");

				Object.defineProperty(Dispatch.Payload, RequireEventKey(strKey, "GameEvent.SetEventString"), { value: strValue, enumerable: true, writable: true, configurable: true });

				return true;
			},
		};

		if (bSupportsUInt64) {
			Event.GetEventUInt64 = function GetEventUInt64(strKey, unDefaultValue) {
				const unNormalizedDefaultValue = (arguments.length > 1) ? RequireUnsignedInteger64(unDefaultValue, "GameEvent.GetEventUInt64 unDefaultValue") : 0n;
				const Value = Dispatch.Payload[RequireEventKey(strKey, "GameEvent.GetEventUInt64")];

				return (typeof Value === "bigint") ? Value : unNormalizedDefaultValue;
			};
			Event.SetEventUInt64 = function SetEventUInt64(strKey, unValue) {
				Object.defineProperty(Dispatch.Payload, RequireEventKey(strKey, "GameEvent.SetEventUInt64"), { value: RequireUnsignedInteger64(unValue, "GameEvent.SetEventUInt64 unValue"), enumerable: true, writable: true, configurable: true });

				return true;
			};
		}

		return Event;
	}

	const NativeListener = {
		FireEvent(strName, EventPayload = {}, bDoNotBroadcast = false) {
			RequireNonEmptyString(strName, "events/listener.FireEvent strName");

			if ((mapEventDefinitions !== null) && !mapEventDefinitions.has(strName)) {
				throw new Error(`Unknown event definition: ${strName}`);
			}

			const NativePayload = BuildValidatedPayload(EventPayload);

			if (typeof bDoNotBroadcast !== "boolean") {
				throw new TypeError("events/listener.FireEvent bDoNotBroadcast expects a boolean.");
			}

			const Dispatch = { Active: true, Name: strName, Payload: NativePayload, Address: unNextAddress };

			unNextAddress += g_unEventAddressStep;

			try {
				for (const Callback of [...(mapCallbacksByName.get(strName) ?? [])]) {
					try {
						Callback(CreateEventView(Dispatch));
					} catch (ErrorValue) {
						if (!bCaptureCallbackErrors) {
							throw ErrorValue;
						}

						vecCallbackErrors.push(ErrorValue);
					}
				}
			} finally {
				Dispatch.Active = false;
			}

			vecFiredEvents.push({ DoNotBroadcast: bDoNotBroadcast, Name: strName, Payload: { ...Dispatch.Payload } });

			return true;
		},
		UnregisterEventListener(strName, Callback) {
			RequireNonEmptyString(strName, "events/listener.UnregisterEventListener strName");

			if (typeof Callback !== "function") {
				throw new TypeError("events/listener.UnregisterEventListener Callback expects a function.");
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
			RequireNonEmptyString(strName, "events/listener.RegisterEventListener strName");

			if ((mapEventDefinitions !== null) && !mapEventDefinitions.has(strName)) {
				return false;
			}

			if (typeof Callback !== "function") {
				throw new TypeError("events/listener.RegisterEventListener Callback expects a function.");
			}

			const vecCallbacks = mapCallbacksByName.get(strName) ?? [];
			vecCallbacks.push(Callback);
			mapCallbacksByName.set(strName, vecCallbacks);

			return true;
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
		CallbackErrors: vecCallbackErrors,
		FiredEvents: vecFiredEvents,
		NativeListener,
	};
}

function VerifyListenerValueContracts() {
	const Fixture = CreateListenerFixture();
	const strEventName = "SourceJSListenerArgumentContract";
	let bCompleted = false;
	const Callback = (EventValue) => {
		for (const Case of [
			{ Name: "GetEventBoolean", DefaultValue: false },
			{ Name: "GetEventInteger", DefaultValue: 0 },
			{ Name: "GetEventFloat", DefaultValue: 0 },
			{ Name: "GetEventString", DefaultValue: "" },
			{ Name: "GetEventUInt64", DefaultValue: 0n },
		]) {
			g_Assert.equal(EventValue[Case.Name]("Missing"), Case.DefaultValue);
			for (const InvalidDefault of [undefined, null]) {
				g_Assert.throws(() => EventValue[Case.Name]("Missing", InvalidDefault), { name: "TypeError" }, "An explicit invalid default must not be treated as an omitted argument.");
			}
		}

		for (const dblDefaultValue of [0.1, -0, g_flMaximumFloat]) {
			g_Assert.equal(EventValue.GetEventFloat("Missing", dblDefaultValue), Math.fround(dblDefaultValue), "Float defaults must retain native single-precision conversion.");
		}

		g_Assert.equal(EventValue.SetEventInteger("Value", 42), true);
		g_Assert.throws(() => EventValue.GetEventInteger("Missing", -0), { name: "TypeError" }, "Negative zero is not an Int32 default.");
		g_Assert.throws(() => EventValue.SetEventInteger("Value", -0), { name: "TypeError" }, "Negative zero is not an Int32 write.");
		g_Assert.equal(EventValue.GetEventInteger("Value"), 42, "Rejected integer writes must preserve stored event data.");
		bCompleted = true;
	};
	g_Assert.equal(Fixture.NativeListener.RegisterEventListener(strEventName, Callback), true);
	g_Assert.equal(Fixture.NativeListener.FireEvent(strEventName, {}), true);
	g_Assert.equal(bCompleted, true);
	g_Assert.equal(Fixture.CallbackErrors.length, 0);
	g_Assert.equal(Fixture.NativeListener.UnregisterEventListener(strEventName, Callback), true);
	g_Assert.equal(Fixture.GetCallbackCount(), 0);
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

function ExecuteDocumentationBlock(strSource, unBlockIndex, Modules) {
	const PluginModule = { exports: {} };
	const Context = g_VM.createContext({
		console: {
			log() {
				throw new Error("Event listener documentation must use the typed logger.");
			},
		},
		exports: PluginModule.exports,
		module: PluginModule,
		require(strModuleName) {
			if (!Object.hasOwn(Modules, strModuleName)) {
				throw new Error(`Unexpected documentation import: ${strModuleName}`);
			}

			return Modules[strModuleName];
		},
	});

	g_VM.runInContext(`"use strict";\n${strSource}`, Context, { filename: `events-listener.md:block-${unBlockIndex + 1}` });

	g_Assert.ok(!PluginModule.exports || !Object.hasOwn(PluginModule.exports, "unload"), "No lowercase lifecycle alias");

	if (PluginModule.exports && (typeof PluginModule.exports.Unload === "function")) {
		PluginModule.exports.Unload();
	}
}

function CreateDocumentationFixture(strFailure = "", bSupportsUInt64 = true) {
	const mapEventDefinitions = new Map([["player_disconnect", {}]]);
	const Fixture = CreateListenerFixture({ SupportsUInt64: bSupportsUInt64, EventDefinitions: mapEventDefinitions, CaptureCallbackErrors: true });
	const FailureError = new Error(`Documented operation failed: ${strFailure}`);
	const vecWrittenResources = [];
	const vecLoadedResources = [];
	const vecRemovedCallbacks = [];
	let unRegistrationCalls = 0;
	let unFireCalls = 0;
	let unRemovalCalls = 0;
	const NativeListener = Fixture.NativeListener;
	const RegisterNativeEventListener = NativeListener.RegisterEventListener.bind(NativeListener);
	const FireNativeEvent = NativeListener.FireEvent.bind(NativeListener);
	const UnregisterNativeEventListener = NativeListener.UnregisterEventListener.bind(NativeListener);

	NativeListener.RegisterEventListener = (strEventName, Callback) => {
		unRegistrationCalls += 1;

		if (unRegistrationCalls === 2) {
			if (strFailure === "REGISTERTHROW") {
				throw FailureError;
			}

			if (strFailure === "REGISTERFALSE") {
				return false;
			}
		}

		return RegisterNativeEventListener(strEventName, Callback);
	};

	NativeListener.FireEvent = (...vecArguments) => {
		unFireCalls += 1;

		if (strFailure === "FIRETHROW") {
			throw FailureError;
		}

		if (strFailure === "FIREFALSE") {
			return false;
		}

		return FireNativeEvent(...vecArguments);
	};

	NativeListener.UnregisterEventListener = (strEventName, Callback) => {
		unRemovalCalls += 1;
		vecRemovedCallbacks.push(Callback);

		if (unRemovalCalls === 1) {
			if (strFailure === "UNREGISTERTHROW") {
				throw FailureError;
			}

			if (strFailure === "UNREGISTERFALSE") {
				return false;
			}
		}

		return UnregisterNativeEventListener(strEventName, Callback);
	};

	class EventResourceFile {
		constructor(strPath, ...vecDefinitions) {
			this.#m_strPath = strPath;
			this.#m_vecDefinitions = vecDefinitions;
			this.#m_bWritten = false;
		}

		WriteEventResourceFile() {
			if (strFailure === "WRITE") {
				throw FailureError;
			}

			vecWrittenResources.push(this.#m_strPath);
			this.#m_bWritten = true;

			return this.#m_strPath;
		}

		LoadEventsFromFile() {
			g_Assert.equal(this.#m_bWritten, true, "Load must follow a successful write.");
			vecLoadedResources.push(this.#m_strPath);

			if (strFailure === "LOADTHROW") {
				throw FailureError;
			}

			if (strFailure === "LOADZERO") {
				return 0;
			}

			if (strFailure === "LOADFALSE") {
				return false;
			}

			if (strFailure === "LOADNAN") {
				return NaN;
			}

			for (const Definition of this.#m_vecDefinitions) {
				g_Assert.equal(typeof Definition.EventName, "string");
				g_Assert.equal(typeof Definition.EventVariables, "object");
				mapEventDefinitions.set(Definition.EventName, Definition.EventVariables);
			}

			return this.#m_vecDefinitions.length;
		}

		#m_strPath;
		#m_vecDefinitions;
		#m_bWritten;
	}

	const ListenerModule = { exports: {} };
	g_VM.runInNewContext(g_FileSystem.readFileSync(g_strListenerPath, "utf8"), {
		module: ListenerModule,
		require(strModuleName) {
			g_Assert.equal(strModuleName, "internal/runtime");

			return {
				GetModule(strNativeModuleName) {
					g_Assert.equal(strNativeModuleName, "events/listener");

					return NativeListener;
				},
			};
		},
	}, { filename: g_strListenerPath });

	return {
		Fixture,
		FailureError,
		Modules: { "events/listener": ListenerModule.exports, "events/resource": { EventResourceFile } },
		EventDefinitions: mapEventDefinitions,
		WrittenResources: vecWrittenResources,
		LoadedResources: vecLoadedResources,
		RemovedCallbacks: vecRemovedCallbacks,
		GetRegistrationCallCount: () => unRegistrationCalls,
		GetFireCallCount: () => unFireCalls,
	};
}

function AssertNativeUnloadLifecycle(strRuntimeSource) {
	const unMaximumUnloadDefinitionCharacterCount = 20000;
	const DefinitionMatch = /^(\t*)void V8Runtime::UnloadPlugin\([^\n]*$/m.exec(strRuntimeSource);
	g_Assert.notEqual(DefinitionMatch, null, "The native unload definition must exist.");
	const unUnloadStart = DefinitionMatch.index;
	const nUnloadEnd = strRuntimeSource.indexOf(`\n${DefinitionMatch[1]}}`, unUnloadStart);
	g_Assert.ok((nUnloadEnd > unUnloadStart) && ((nUnloadEnd - unUnloadStart) < unMaximumUnloadDefinitionCharacterCount), "The native unload definition must have bounded, matching-indent extraction.");
	g_Assert.match(strRuntimeSource.slice(unUnloadStart, nUnloadEnd), /CallPluginExportFunction\(strPluginName, "Unload"\)/, "Native plugin unload must call the exact lifecycle export.");
}

function AssertDocumentationLifecycle(vecBlocks) {
	const strRuntimeSource = g_FileSystem.readFileSync(g_Path.join(g_strProjectRoot, "src", "sourcejs", "V8Runtime.cpp"), "utf8");
	AssertNativeUnloadLifecycle(strRuntimeSource);

	// Synthetic source-only counterexample: another function must not satisfy the unload guard.
	const strEscapingCallFixture = 'namespace LifecycleProbe {\n\tvoid V8Runtime::UnloadPlugin(std::string const& strPluginName) {\n\t\tif (strPluginName.empty()) {\n\t\t\treturn;\n\t\t}\n\t}\n\n\tvoid OtherLifecycle(std::string const& strPluginName) {\n\t\tCallPluginExportFunction(strPluginName, "Unload");\n\t}\n} // namespace LifecycleProbe\n';
	g_Assert.throws(() => AssertNativeUnloadLifecycle(strEscapingCallFixture), /Native plugin unload must call the exact lifecycle export/);

	const Disconnect = CreateDocumentationFixture();
	ExecuteDocumentationBlock(vecBlocks[1], 1, Disconnect.Modules);
	g_Assert.equal(Disconnect.GetRegistrationCallCount(), 1);
	g_Assert.equal(Disconnect.RemovedCallbacks.length, 1, "The real unload export must unregister.");
	g_Assert.equal(Disconnect.Fixture.GetCallbackCount(), 0);

	for (const unBlockIndex of [2, 3, 4, 5, 6]) {
		const Ready = CreateDocumentationFixture();
		ExecuteDocumentationBlock(vecBlocks[unBlockIndex], unBlockIndex, Ready.Modules);
		g_Assert.equal(Ready.WrittenResources.length, 1);
		g_Assert.equal(Ready.LoadedResources.length, 1);
		g_Assert.equal(Ready.Fixture.GetCallbackCount(), 0);
		g_Assert.equal(Ready.Fixture.CallbackErrors.length, 0);
		g_Assert.equal(Ready.Fixture.FiredEvents.length, (unBlockIndex === 5) ? 2 : 1);

		for (const strFailure of [
			"WRITE",
			"LOADZERO",
			"LOADFALSE",
			"LOADNAN",
			"LOADTHROW",
		]) {
			const Failed = CreateDocumentationFixture(strFailure);
			g_Assert.throws(() => ExecuteDocumentationBlock(vecBlocks[unBlockIndex], unBlockIndex, Failed.Modules), (ErrorValue) => {
				if ((strFailure === "WRITE") || (strFailure === "LOADTHROW")) {
					return ErrorValue === Failed.FailureError;
				}

				return /load.*definition/i.test(ErrorValue.message);
			}, "Documented load failures must preserve the original error or reject the failed load.");
			g_Assert.equal(Failed.GetRegistrationCallCount(), 0, strFailure);
			g_Assert.equal(Failed.GetFireCallCount(), 0, strFailure);
			g_Assert.equal(Failed.Fixture.GetCallbackCount(), 0, strFailure);
		}
	}

	const Reduced = CreateDocumentationFixture("", false);
	g_Assert.throws(() => ExecuteDocumentationBlock(vecBlocks[2], 2, Reduced.Modules), /metric listener did not complete its inspection/);
	g_Assert.equal(Reduced.EventDefinitions.get("SourceJSListenerMetric").Sequence, "local");
	g_Assert.equal(Reduced.Fixture.CallbackErrors.length, 1);
	g_Assert.match(Reduced.Fixture.CallbackErrors[0].message, /UInt64 event accessors/);
	g_Assert.equal(Reduced.Fixture.FiredEvents[0].Payload.Count, 4, "Capability checks must precede writes.");
	g_Assert.equal(Reduced.Fixture.GetCallbackCount(), 0);

	for (const unBlockIndex of [4, 5]) {
		for (const strFailure of ["REGISTERFALSE", "REGISTERTHROW", "FIREFALSE", "FIRETHROW"]) {
			const Failed = CreateDocumentationFixture(strFailure);
			g_Assert.throws(() => ExecuteDocumentationBlock(vecBlocks[unBlockIndex], unBlockIndex, Failed.Modules), (ErrorValue) => {
				if ((strFailure === "REGISTERTHROW") || (strFailure === "FIRETHROW")) {
					return ErrorValue === Failed.FailureError;
				}

				return /register|registration|fire/i.test(ErrorValue.message);
			}, "Documented registration/dispatch failures must retain their original error contract.");
			g_Assert.equal(Failed.Fixture.GetCallbackCount(), 0, strFailure);
			g_Assert.equal(Failed.RemovedCallbacks.length, strFailure.startsWith("REGISTER") ? 1 : 2, strFailure);
		}
	}

	for (const strFailure of ["UNREGISTERFALSE", "UNREGISTERTHROW"]) {
		const Failed = CreateDocumentationFixture(strFailure);
		g_Assert.throws(() => ExecuteDocumentationBlock(vecBlocks[4], 4, Failed.Modules), (ErrorValue) => {
			return (strFailure === "UNREGISTERTHROW") ? ErrorValue === Failed.FailureError : /remove.*consumer/i.test(ErrorValue.message);
		}, "Documented removal failures must preserve their original error contract.");
		g_Assert.equal(Failed.RemovedCallbacks.length, 2, "Failure of one removal must not skip the other.");
		g_Assert.equal(Failed.Fixture.GetCallbackCount(), 1, "A failed native removal remains a lifecycle failure.");
	}
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

function AssertEventView(Event, bSupportsUInt64) {
	const vecExpectedMethods = [...g_vecExpectedEventMethods, ...(bSupportsUInt64 ? g_vecUnsignedInteger64EventMethods : [])];
	const vecExpectedMembers = [...g_vecExpectedEventProperties, ...vecExpectedMethods].sort();
	g_Assert.deepEqual(Object.keys(Event).sort(), vecExpectedMembers, "Event views must expose exactly the available members.");
	g_Assert.equal(typeof Event.EventName, "string");
	g_Assert.equal(typeof Event.Address, "bigint", "Event view addresses must remain BigInt.");
	g_Assert.equal(typeof Event.Reliable, "boolean");
	g_Assert.equal(typeof Event.Local, "boolean");

	for (const strMethodName of vecExpectedMethods) {
		g_Assert.equal(typeof Event[strMethodName], "function");
	}
}

function AssertListenerDispatchPolicies() {
	const Fixture = CreateListenerFixture({ CaptureCallbackErrors: true });
	const Listener = Fixture.NativeListener;
	const vecOrder = [];
	const vecViews = [];
	const CallbackError = new Error("Controlled listener failure before a later callback.");
	let bInitialDispatch = true;

	const LateConsumer = EventValue => {
		vecOrder.push("Late");
		vecViews.push(EventValue);
	};
	const OriginalConsumer = EventValue => {
		vecOrder.push("Original");
		vecViews.push(EventValue);
		g_Assert.equal(EventValue.GetEventInteger("Count"), 42);
	};
	const First = EventValue => {
		vecOrder.push("First");
		vecViews.push(EventValue);
		g_Assert.equal(EventValue.SetEventInteger("Count", 42), true);

		if (bInitialDispatch) {
			bInitialDispatch = false;
			g_Assert.equal(Listener.UnregisterEventListener("SourceJSDispatchPolicy", OriginalConsumer), true);
			g_Assert.equal(Listener.RegisterEventListener("SourceJSDispatchPolicy", LateConsumer), true);
			throw CallbackError;
		}
	};
	g_Assert.equal(Listener.RegisterEventListener("SourceJSDispatchPolicy", First), true);
	g_Assert.equal(Listener.RegisterEventListener("SourceJSDispatchPolicy", OriginalConsumer), true);
	g_Assert.equal(Listener.FireEvent("SourceJSDispatchPolicy", { Count: 0 }), true);
	g_Assert.deepEqual(vecOrder, ["First", "Original"], "Registration changes must not rewrite the current callback snapshot.");
	g_Assert.deepEqual(Fixture.CallbackErrors, [CallbackError], "An ordinary JS callback error is captured while later callbacks continue.");
	g_Assert.notStrictEqual(vecViews[0], vecViews[1]);
	g_Assert.equal(vecViews[0].Address, vecViews[1].Address);
	g_Assert.equal(Fixture.FiredEvents[0].Payload.Count, 42);

	vecOrder.length = 0;
	g_Assert.equal(Listener.FireEvent("SourceJSDispatchPolicy", { Count: 0 }), true);
	g_Assert.deepEqual(vecOrder, ["First", "Late"]);
	g_Assert.equal(Fixture.CallbackErrors.length, 1);

	for (const EventValue of vecViews) {
		g_Assert.throws(() => EventValue.GetEventInteger("Count"), /after its callback has returned/);
	}

	g_Assert.equal(Listener.UnregisterEventListener("SourceJSDispatchPolicy", First), true);
	g_Assert.equal(Listener.UnregisterEventListener("SourceJSDispatchPolicy", LateConsumer), true);
	g_Assert.equal(Fixture.GetCallbackCount(), 0);

	const Payload = Object.create({ Inherited: null });
	Payload.Count = 5;
	const RejectIgnoredRead = () => {
		throw new Error("Ignored payload getters must not run.");
	};
	Object.defineProperty(Payload, "Hidden", { get: RejectIgnoredRead });
	Object.defineProperty(Payload, Symbol("Ignored"), { enumerable: true, get: RejectIgnoredRead });
	g_Assert.equal(Listener.FireEvent("SourceJSFilteredListenerPayload", Payload), true);
	g_Assert.deepEqual(Fixture.FiredEvents.at(-1).Payload, { Count: 5 });
}

function AssertRegistrationRecovery(Listener, Fixture) {
	const unExpectedCallsBeforeFirstRemoval = 4;
	const unExpectedCallsAfterFirstRemoval = 5;
	const NativeListener = Fixture.NativeListener;
	const RegisterNativeEventListener = NativeListener.RegisterEventListener;
	const UnregisterNativeEventListener = NativeListener.UnregisterEventListener;
	const RegistrationError = new Error("Injected native registration failure.");
	let unCallbackCount = 0;

	function CountCallbacks() {
		++unCallbackCount;
	}

	for (const strFailureMode of ["FALSE", "THROW"]) {
		try {
			NativeListener.RegisterEventListener = function FailRegistration() {
				if (strFailureMode === "THROW") {
					throw RegistrationError;
				}

				return false;
			};

			if (strFailureMode === "THROW") {
				g_Assert.throws(() => Listener.RegisterEventListener("SourceJSRegistrationRetry", CountCallbacks), (ErrorValue) => ErrorValue === RegistrationError);

			} else {
				g_Assert.equal(Listener.RegisterEventListener("SourceJSRegistrationRetry", CountCallbacks), false);
			}
		} finally {
			NativeListener.RegisterEventListener = RegisterNativeEventListener;
		}

		g_Assert.equal(Fixture.GetCallbackCount(), 0);
		g_Assert.equal(Listener.RegisterEventListener("SourceJSRegistrationRetry", CountCallbacks), true);
		g_Assert.equal(Listener.UnregisterEventListener("SourceJSRegistrationRetry", CountCallbacks), true);
		g_Assert.equal(Listener.UnregisterEventListener("SourceJSRegistrationRetry", CountCallbacks), false);
		g_Assert.equal(Fixture.GetCallbackCount(), 0);
	}

	g_Assert.equal(Listener.RegisterEventListener("SourceJSDuplicateRetry", CountCallbacks), true);
	g_Assert.equal(Listener.RegisterEventListener("SourceJSDuplicateRetry", CountCallbacks), true);

	for (const strFailureMode of ["FALSE", "THROW"]) {
		try {
			NativeListener.UnregisterEventListener = function FailRemoval() {
				if (strFailureMode === "THROW") {
					throw RegistrationError;
				}

				return false;
			};

			if (strFailureMode === "THROW") {
				g_Assert.throws(() => Listener.UnregisterEventListener("SourceJSDuplicateRetry", CountCallbacks), (ErrorValue) => ErrorValue === RegistrationError);

			} else {
				g_Assert.equal(Listener.UnregisterEventListener("SourceJSDuplicateRetry", CountCallbacks), false);
			}
		} finally {
			NativeListener.UnregisterEventListener = UnregisterNativeEventListener;
		}

		g_Assert.equal(Fixture.GetCallbackCount(), 2);
		g_Assert.equal(Listener.FireEvent("SourceJSDuplicateRetry"), true);
	}

	g_Assert.equal(unCallbackCount, unExpectedCallsBeforeFirstRemoval);
	g_Assert.equal(Listener.UnregisterEventListener("SourceJSDuplicateRetry", CountCallbacks), true);
	g_Assert.equal(Listener.FireEvent("SourceJSDuplicateRetry"), true);
	g_Assert.equal(unCallbackCount, unExpectedCallsAfterFirstRemoval);
	g_Assert.equal(Listener.UnregisterEventListener("SourceJSDuplicateRetry", CountCallbacks), true);
	g_Assert.equal(Listener.FireEvent("SourceJSDuplicateRetry"), true);
	g_Assert.equal(unCallbackCount, unExpectedCallsAfterFirstRemoval);
	g_Assert.equal(Fixture.GetCallbackCount(), 0);
}

try {
	g_Module._load = function Load(strRequestName, ParentModule, bIsMain) {
		if (strRequestName === "internal/runtime") {
			return require(g_strRuntimePath);
		}

		return g_OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
	};

	VerifyListenerValueContracts();
	g_Assert.throws(() => ExecuteDocumentationBlock('console.log("must fail");', 0, {}), /Event listener documentation must use the typed logger\./);
	g_Assert.throws(() => ExecuteDocumentationBlock("module.exports.unload = () => {};", 0, {}), /No lowercase lifecycle alias/);
	g_Assert.doesNotThrow(() => ExecuteDocumentationBlock("module.exports = null;", 0, {}));
	g_Assert.doesNotThrow(() => ExecuteDocumentationBlock("module.exports = undefined;", 0, {}));

	const g_ListenerFixture = CreateListenerFixture();

	globalThis.sourcejs = { "events/listener": g_ListenerFixture.NativeListener };
	delete require.cache[g_strListenerPath];
	delete require.cache[g_strRuntimePath];

	const g_Listener = require(g_strListenerPath);

	g_Assert.deepEqual(Object.keys(g_Listener).sort(), g_vecExpectedExports);

	const g_strDocumentation = g_FileSystem.readFileSync(g_strListenerDocumentationPath, "utf8");
	const g_vecDocumentationBlocks = ExtractJavaScriptBlocks(g_strDocumentation);
	const g_setExercisedExports = new Set();
	const g_vecDocumentedEvents = [];

	const g_unExpectedDocumentationBlockCount = 7;
	g_Assert.equal(g_vecDocumentationBlocks.length, g_unExpectedDocumentationBlockCount, "Listener documentation must retain all seven executable blocks.");
	g_Assert.doesNotMatch(g_strDocumentation, /generated by|auto-generated|example generator/i);
	g_Assert.doesNotMatch(g_strDocumentation, /addressString|payload\.skip|events\/hooks|source\.events|module\.exports\.unload|exports\.unload/);
	g_Assert.doesNotMatch(g_strDocumentation, /\|\s*`(?:m_strEventName|m_bReliable|m_bLocal|m_pEventAddress|name|reliable|local|address)`\s*\|/);
	g_Assert.doesNotMatch(g_strDocumentation, /\bconsole\.log\(/, "Executable listener documentation must use the typed logger.");

	for (const strSource of g_vecDocumentationBlocks) {
		new g_VM.Script(`"use strict";\n${strSource}`);
	}

	AssertDocumentationLifecycle(g_vecDocumentationBlocks);

	for (const [unBlockIndex, strSource] of g_vecDocumentationBlocks.entries()) {
		const Documentation = CreateDocumentationFixture();
		ExecuteDocumentationBlock(strSource, unBlockIndex, { "events/listener": TrackExports(Documentation.Modules["events/listener"], g_setExercisedExports), "events/resource": Documentation.Modules["events/resource"] });
		g_Assert.equal(Documentation.Fixture.GetCallbackCount(), 0);
		g_Assert.deepEqual(Documentation.Fixture.CallbackErrors, [], "Documented listener callbacks must not hide failed assertions.");
		g_vecDocumentedEvents.push(...Documentation.Fixture.FiredEvents);
	}

	for (const strExportName of g_vecExpectedExports) {
		g_Assert.equal(g_setExercisedExports.has(strExportName), true, `Documentation did not call events/listener.${strExportName}.`);
	}

	g_Assert.equal(g_ListenerFixture.GetCallbackCount(), 0);

	const g_MetricEvent = g_vecDocumentedEvents.find((Event) => Event.Name === "SourceJSListenerMetric");
	g_Assert.ok(g_MetricEvent, "Listener documentation must fire its metric event.");
	g_Assert.equal(g_MetricEvent.Payload.Count, 5);
	g_Assert.equal(g_MetricEvent.Payload.Sequence, 1n, "Documented unsigned 64-bit sequence values must remain BigInt.");

	const g_OrderProbeEvent = g_vecDocumentedEvents.find((Event) => Event.Name === "SourceJSOrderProbe");
	g_Assert.ok(g_OrderProbeEvent, "Listener documentation must fire its order probe.");
	g_Assert.equal(g_OrderProbeEvent.Payload.Count, 0);

	g_Assert.equal(g_vecDocumentedEvents.filter((Event) => Event.Name === "SourceJSDuplicateProbe").length, 2);

	AssertRegistrationRecovery(g_Listener, g_ListenerFixture);

	let g_CallbackView = null;

	function Inspect(Event) {
		g_CallbackView = Event;
		AssertEventView(Event, true);
		g_Assert.equal(Event.EventName, "SourceJSContract");
		g_Assert.ok(Event.Address > 0n, "An active listener view must retain a positive BigInt address.");

		for (const nBoundaryValue of [-0x80000000, 0x7FFFFFFF]) {
			g_Assert.equal(Event.SetEventInteger("IntegerBoundary", nBoundaryValue), true);
			g_Assert.equal(Event.GetEventInteger("IntegerBoundary"), nBoundaryValue, "Listener integer boundaries must remain exact signed Numbers.");
		}

		for (const InvalidValue of [-0x80000001, 0x80000000, 1.5, 1n, "1", NaN, Infinity]) {
			g_Assert.throws(() => Event.SetEventInteger("Value", InvalidValue), { name: "TypeError", message: /int32/ }, "Listener integer setters must reject invalid signed 32-bit values.");
			g_Assert.equal(Event.GetEventInteger("Value"), 1, "Rejected listener integer writes must not change the payload.");
		}

		g_Assert.equal(Event.SetEventFloat("FloatPrecision", 0.1), true);
		g_Assert.equal(Event.GetEventFloat("FloatPrecision"), Math.fround(0.1), "Listener float setters must preserve single-precision conversion.");

		// Deliberate JavaScript-boundary key, not a project-owned identifier.
		g_Assert.equal(Event.SetEventString("__proto__", "LiteralKey"), true);
		g_Assert.equal(Event.GetEventString("__proto__"), "LiteralKey", "Listener setters must create own data keys, not change the payload prototype.");

		g_Assert.throws(() => Event.GetEventInteger("Value\0Suffix"), { name: "TypeError", message: /NUL/ });
		g_Assert.throws(() => Event.SetEventString("Text", "Value\0Suffix"), { name: "TypeError", message: /NUL/ });
		g_Assert.throws(() => Event.GetEventString("Text", "Value\0Suffix"), { name: "TypeError", message: /NUL/ });

		g_Assert.equal(Event.GetEventInteger("Value"), 1);
		g_Assert.equal(Event.GetEventUInt64("Missing"), 0n);
		g_Assert.equal(Event.GetEventUInt64("Missing", g_unMaximumUnsignedInteger64), g_unMaximumUnsignedInteger64);
		g_Assert.equal(Event.SetEventUInt64("UInt64", g_unMaximumUnsignedInteger64), true);
		g_Assert.equal(Event.GetEventUInt64("UInt64"), g_unMaximumUnsignedInteger64, "Listener unsigned 64-bit values must retain exact BigInt identity.");
		g_Assert.throws(() => Event.GetEventUInt64("UInt64", 1), /BigInt/);
		g_Assert.throws(() => Event.GetEventUInt64("UInt64", -1n), /uint64/);
		g_Assert.throws(() => Event.SetEventUInt64("UInt64", 1), /BigInt/);
		g_Assert.throws(() => Event.SetEventUInt64("UInt64", g_unMaximumUnsignedInteger64 + 1n), /uint64/);
		g_Assert.throws(() => Event.SetEventUInt64("UInt64", -1n), { name: "RangeError", message: /uint64/ });
		g_Assert.equal(Event.GetEventUInt64("UInt64"), g_unMaximumUnsignedInteger64, "Listener unsigned 64-bit values must retain exact BigInt identity.");
	}

	g_Assert.equal(g_Listener.RegisterEventListener("SourceJSContract", Inspect), true);
	g_Assert.equal(g_Listener.FireEvent("SourceJSContract", { Value: 1 }, true), true);
	g_Assert.equal(g_Listener.UnregisterEventListener("SourceJSContract", Inspect), true);
	g_Assert.equal(typeof g_CallbackView.GetEventUInt64, "function");
	g_Assert.throws(() => g_CallbackView.GetEventInteger("Value"), { name: "Error", message: /after its callback has returned/ }, "Retained listener views must expire after dispatch.");
	g_Assert.throws(() => g_CallbackView.GetEventUInt64("UInt64"), /after its callback has returned/);
	g_Assert.throws(() => g_CallbackView.SetEventString("Value", "Changed"), /after its callback has returned/);
	g_Assert.equal(g_Listener.UnregisterEventListener("SourceJSContract", Inspect), false);
	g_Assert.deepEqual(Object.keys(g_ListenerFixture.FiredEvents.at(-1)).sort(), ["DoNotBroadcast", "Name", "Payload"]);
	g_Assert.equal(g_ListenerFixture.FiredEvents.at(-1).DoNotBroadcast, true);

	const g_unFiredBeforeRejections = g_ListenerFixture.FiredEvents.length;
	g_Assert.throws(() => g_Listener.RegisterEventListener("", Inspect), /non-empty string/);
	g_Assert.throws(() => g_Listener.RegisterEventListener("Event", null), /expects a function/);
	g_Assert.throws(() => g_Listener.FireEvent("Event", [], false), /expects an object/);
	g_Assert.throws(() => g_Listener.FireEvent("Event", { Value: null }, false), /unsupported value/);
	g_Assert.throws(() => g_Listener.FireEvent("Event", { Value: -1n }, false), /uint64/);
	g_Assert.throws(() => g_Listener.FireEvent("Event", { Value: g_unMaximumUnsignedInteger64 + 1n }, false), /uint64/);
	g_Assert.throws(() => g_Listener.FireEvent("Event", {}, 1), /expects a boolean/);
	g_Assert.equal(g_ListenerFixture.FiredEvents.length, g_unFiredBeforeRejections, "Invalid listener calls must not commit an event.");

	let g_unSnapshotValueReads = 0;
	const g_SnapshotPayload = {};
	Object.defineProperty(g_SnapshotPayload, "Value", {
		get() {
			g_unSnapshotValueReads++;

			return 0.1;
		},
	});
	g_Assert.equal(g_Listener.FireEvent("SourceJSPayloadSnapshot", g_SnapshotPayload), true);
	g_Assert.equal(g_unSnapshotValueReads, 0, "Native V8 default enumeration skips non-enumerable listener payload fields.");
	g_Assert.deepEqual(g_ListenerFixture.FiredEvents.at(-1).Payload, {});

	const g_EnumerablePayload = {
		get Value() {
			g_unSnapshotValueReads++;

			return 0.1;
		},
	};
	g_Assert.equal(g_Listener.FireEvent("SourceJSEnumerablePayloadSnapshot", g_EnumerablePayload), true);
	g_Assert.equal(g_unSnapshotValueReads, 1, "An included listener payload getter must be read exactly once.");
	g_Assert.equal(g_ListenerFixture.FiredEvents.at(-1).Payload.Value, Math.fround(0.1), "Listener payload snapshots must preserve single-precision conversion.");
	AssertListenerDispatchPolicies();

	const g_CallbackError = new Error("Injected listener callback failure.");
	let g_FailedCallbackView = null;

	function FailCallback(Event) {
		g_FailedCallbackView = Event;
		throw g_CallbackError;
	}

	g_Assert.equal(g_Listener.RegisterEventListener("SourceJSFailure", FailCallback), true);
	g_Assert.throws(() => g_Listener.FireEvent("SourceJSFailure"), (ErrorValue) => ErrorValue === g_CallbackError);
	g_Assert.equal(g_Listener.UnregisterEventListener("SourceJSFailure", FailCallback), true);
	g_Assert.throws(() => g_FailedCallbackView.IsEventEmpty(), { name: "Error", message: /after its callback has returned/ }, "Failed callback views must also expire after dispatch.");
	g_Assert.equal(g_ListenerFixture.GetCallbackCount(), 0);

	const g_ReducedFixture = CreateListenerFixture({ SupportsUInt64: false });
	let g_ReducedView = null;

	function InspectReduced(Event) {
		g_ReducedView = Event;
		AssertEventView(Event, false);
	}

	g_Assert.equal(g_ReducedFixture.NativeListener.RegisterEventListener("SourceJSReduced", InspectReduced), true);
	g_Assert.equal(g_ReducedFixture.NativeListener.FireEvent("SourceJSReduced", {}, true), true);
	g_Assert.equal(g_ReducedFixture.NativeListener.UnregisterEventListener("SourceJSReduced", InspectReduced), true);
	g_Assert.equal(Object.hasOwn(g_ReducedView, "GetEventUInt64"), false);
	g_Assert.equal(Object.hasOwn(g_ReducedView, "SetEventUInt64"), false);
	g_Assert.throws(() => g_ReducedFixture.NativeListener.FireEvent("SourceJSReduced", { Value: 1n }), /unsupported value/);
	g_Assert.equal(g_ReducedFixture.GetCallbackCount(), 0);

	delete require.cache[g_strListenerPath];
	delete require.cache[g_strRuntimePath];
	delete globalThis.sourcejs;

	g_Assert.throws(() => require(g_strListenerPath), { name: "Error", message: /^SourceJS native runtime is not installed/ }, "Listeners must report native absence, not a lookup or unrelated error.");

	console.log("[  OK  ] events/listener package and documentation contracts passed with a native double; SDK dispatch is not exercised");
} finally {
	g_Module._load = g_OriginalModuleLoad;

	for (const [strModulePath, OriginalModule] of g_mapOriginalCacheEntries) {
		if (OriginalModule === undefined) {
			delete require.cache[strModulePath];

		} else {
			require.cache[strModulePath] = OriginalModule;
		}
	}

	if (g_SourceJSDescriptor === undefined) {
		delete globalThis.sourcejs;

	} else {
		Object.defineProperty(globalThis, "sourcejs", g_SourceJSDescriptor);
	}
}
