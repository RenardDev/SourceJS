#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strPackageRoot = g_Path.resolve(__dirname, "..", "packages", "sourcejs");
const g_strCustomEventsPath = g_Path.join(g_strPackageRoot, "events", "custom.js");
const g_strEventsPath = g_Path.join(g_strPackageRoot, "events.js");
const g_strExceptionsPath = g_Path.join(g_strPackageRoot, "memory", "hooks", "exceptions.js");
const g_strListenerPath = g_Path.join(g_strPackageRoot, "events", "listener.js");
const g_strManagerPath = g_Path.join(g_strPackageRoot, "events", "manager.js");
const g_strManagerDocumentationPath = g_Path.resolve(__dirname, "..", "docs", "api", "events-manager.md");
const g_strRuntimePath = g_Path.join(g_strPackageRoot, "internal", "runtime.js");

const g_OriginalModuleLoad = g_Module._load;
const g_SourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
const g_vecScopedCachePaths = [
	g_strCustomEventsPath,
	g_strEventsPath,
	g_strExceptionsPath,
	g_strListenerPath,
	g_strManagerPath,
	g_strRuntimePath,
];
const g_mapOriginalCacheEntries = new Map(g_vecScopedCachePaths.map((strModulePath) => [strModulePath, require.cache[strModulePath]]));

// Dispatch/registry fixtures are not a model of native SDK conversion, allocation or lifetime.
// Event addresses below are controlled BigInt sentinels, not native memory ownership.
const g_unNativeEventAddress = 0x1000n;
const g_vecExpectedExports = [
	"EVENT_MANAGER",
	"EventListener",
	"EventManager",
	"FireEvent",
	"RegisterEventListener",
	"UnregisterEventListener",
];
const g_vecDocumentedExports = [
	"EVENT_MANAGER",
	"EventListener",
	"EventManager",
	"FireEvent",
	"RegisterEventListener",
	"UnregisterEventListener",
];
const g_vecExpectedEventListenerMethods = ["AppendEventCallback", "DispatchGameEvent", "RemoveEventCallback"];
const g_vecDocumentedEventListenerMethods = ["AppendEventCallback", "DispatchGameEvent", "RemoveEventCallback"];
const g_vecExpectedEventManagerMethods = [
	"AddNativeEventListener",
	"Clear",
	"DispatchEvent",
	"GetEventListener",
	"RegisterEventListener",
	"RemoveNativeEventListener",
	"UnregisterEventListener",
	"clear",
];
const g_vecDocumentedEventManagerMethods = [
	"AddNativeEventListener",
	"Clear",
	"DispatchEvent",
	"GetEventListener",
	"RegisterEventListener",
	"RemoveNativeEventListener",
	"UnregisterEventListener",
];
const g_vecNativeAdds = [];
const g_vecNativeRegistrations = [];
const g_vecNativeRemoves = [];
const g_vecReportedExceptions = [];
let g_bNativeAddResult = true;
let g_bNativeRemoveResult = true;

function MakeNativeGameEvent(strEventName, EventPayload) {
	return {
		EventName: strEventName,
		Reliable: true,
		Local: false,
		Address: g_unNativeEventAddress,
		GetEventBoolean(strKey, bDefaultValue = false) {
			return Object.hasOwn(EventPayload, strKey) ? EventPayload[strKey] : bDefaultValue;
		},
		GetEventFloat(strKey, dblDefaultValue = 0) {
			return Object.hasOwn(EventPayload, strKey) ? EventPayload[strKey] : dblDefaultValue;
		},
		GetEventInteger(strKey, nDefaultValue = 0) {
			return Object.hasOwn(EventPayload, strKey) ? EventPayload[strKey] : nDefaultValue;
		},
		GetEventString(strKey, strDefaultValue = "") {
			return Object.hasOwn(EventPayload, strKey) ? EventPayload[strKey] : strDefaultValue;
		},
		GetEventUInt64(strKey, unDefaultValue = 0n) {
			return Object.hasOwn(EventPayload, strKey) ? EventPayload[strKey] : unDefaultValue;
		},
		IsEventEmpty(strKey = undefined) {
			return (strKey === undefined) ? (Object.keys(EventPayload).length === 0) : !Object.hasOwn(EventPayload, strKey);
		},
		SetEventBoolean(strKey, bValue) {
			EventPayload[strKey] = bValue;

			return true;
		},
		SetEventFloat(strKey, dblValue) {
			EventPayload[strKey] = dblValue;

			return true;
		},
		SetEventInteger(strKey, nValue) {
			EventPayload[strKey] = nValue;

			return true;
		},
		SetEventString(strKey, strValue) {
			EventPayload[strKey] = strValue;

			return true;
		},
		SetEventUInt64(strKey, unValue) {
			EventPayload[strKey] = unValue;

			return true;
		},
	};
}

function DispatchNativeEvent(strEventName, EventPayload, bDoNotBroadcast = false) {
	g_Assert.equal(typeof bDoNotBroadcast, "boolean");

	const GameEvent = MakeNativeGameEvent(strEventName, { ...EventPayload });
	for (const Registration of Array.from(g_vecNativeRegistrations)) {
		if (Registration.EventName === strEventName) {
			Registration.EngineCallback(GameEvent);
		}
	}

	return true;
}

function AddNativeRegistration(strEventName, Callback) {
	const Registration = { EngineCallback: Callback, EventName: strEventName };
	g_vecNativeAdds.push(Registration);
	g_vecNativeRegistrations.push(Registration);

	return true;
}

function RemoveNativeRegistration(strEventName, Callback) {
	const nRegistrationIndex = g_vecNativeRegistrations.findIndex((Registration) => (Registration.EventName === strEventName) && (Registration.EngineCallback === Callback));

	g_vecNativeRemoves.push({ EngineCallback: Callback, EventName: strEventName });

	if (nRegistrationIndex === -1) {
		return false;
	}

	g_vecNativeRegistrations.splice(nRegistrationIndex, 1);

	return true;
}

function InstallDependency(strModulePath, Dependency) {
	require.cache[strModulePath] = { exports: Dependency, filename: strModulePath, id: strModulePath, loaded: true };
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
				throw new Error("Event manager documentation must use the typed logger.");
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

	g_VM.runInContext(`"use strict";\n${strSource}`, Context, { filename: `events-manager.md:block-${unBlockIndex + 1}` });

	g_Assert.ok(!PluginModule.exports || !Object.hasOwn(PluginModule.exports, "unload"), "Documentation must not export the obsolete lowercase lifecycle.");

	if (PluginModule.exports && (typeof PluginModule.exports.Unload === "function")) {
		PluginModule.exports.Unload();
	}
}

function AssertManagedDocumentationCleanup(vecBlocks, Manager) {
	try {
		ExecuteDocumentationBlock(vecBlocks[5], 5, { "events/manager": Manager });
		g_Assert.equal(Manager.EVENT_MANAGER.size, 0, "The real unload export must release singleton listeners.");
	} finally {
		g_Assert.equal(Manager.EVENT_MANAGER.Clear(), true);
	}

	for (const strFailure of [
		"REGISTERFALSE",
		"REGISTERTHROW",
		"FIREFALSE",
		"FIRETHROW",
		"UNREGISTERFALSE",
		"UNREGISTERTHROW",
	]) {
		const FailureError = new Error(`Managed documentation failure: ${strFailure}`);
		const vecManagers = [];
		const vecRemovalCallbacks = [];
		let unRegistrationCalls = 0;
		let unRemovalCalls = 0;

		class ObservedEventManager extends Manager.EventManager {
			constructor() {
				super();
				vecManagers.push(this);
			}

			RegisterEventListener(strEventName, Callback) {
				unRegistrationCalls += 1;

				if (unRegistrationCalls === 2) {
					if (strFailure === "REGISTERTHROW") {
						throw FailureError;
					}

					if (strFailure === "REGISTERFALSE") {
						return false;
					}
				}

				return super.RegisterEventListener(strEventName, Callback);
			}

			UnregisterEventListener(strEventName, Callback) {
				unRemovalCalls += 1;
				vecRemovalCallbacks.push(Callback);

				if (unRemovalCalls === 1) {
					if (strFailure === "UNREGISTERTHROW") {
						throw FailureError;
					}

					if (strFailure === "UNREGISTERFALSE") {
						return false;
					}
				}

				return super.UnregisterEventListener(strEventName, Callback);
			}
		}

		const ManagerModule = {
			...Manager,
			EventManager: ObservedEventManager,
			FireEvent(...vecArguments) {
				if (strFailure === "FIRETHROW") {
					throw FailureError;
				}

				if (strFailure === "FIREFALSE") {
					return false;
				}

				return Manager.FireEvent(...vecArguments);
			},
		};

		try {
			g_Assert.throws(() => ExecuteDocumentationBlock(vecBlocks[2], 2, { "events/manager": ManagerModule }), (ErrorValue) => {
				if (strFailure.endsWith("THROW")) {
					return ErrorValue === FailureError;
				}

				return /register|remove|rejected/i.test(ErrorValue.message);
			});
			g_Assert.equal(vecManagers.length, 1);
			g_Assert.equal(unRemovalCalls, strFailure.startsWith("REGISTER") ? 1 : 2);

			if (strFailure.startsWith("UNREGISTER")) {
				const vecRemainingListener = vecManagers[0].get("server_cvar");
				g_Assert.equal(vecRemainingListener.length, 1, "One failed removal must not skip the other.");
				g_Assert.equal(vecRemainingListener.includes(vecRemovalCallbacks[0]), true);

			} else {
				g_Assert.equal(vecManagers[0].size, 0, strFailure);
			}
		} finally {
			for (const mapManager of vecManagers) {
				g_Assert.equal(mapManager.Clear(), true);
			}
		}
	}
}

function AssertDocumentedClearFailure(vecBlocks, Manager) {
	for (const strFailure of ["FALSE", "THROW"]) {
		const FailureError = new Error(`Documented Clear failure: ${strFailure}`);
		const unInitialNativeRegistrations = g_vecNativeRegistrations.length;
		let mapComponentManager = null;
		let unRemovalAttempts = 0;

		class PartialCleanupManager extends Manager.EventManager {
			constructor() {
				super();
				mapComponentManager = this;
			}

			RemoveNativeEventListener(vecListener) {
				unRemovalAttempts += 1;

				if (unRemovalAttempts === 2) {
					if (strFailure === "THROW") {
						throw FailureError;
					}

					return false;
				}

				return super.RemoveNativeEventListener(vecListener);
			}
		}

		try {
			g_Assert.throws(() => ExecuteDocumentationBlock(vecBlocks[10], 10, { "events/manager": { ...Manager, EventManager: PartialCleanupManager } }), (ErrorValue) => {
				return (strFailure === "THROW") ? ErrorValue === FailureError : /player_disconnect/.test(ErrorValue.message);
			});
			g_Assert.equal(unRemovalAttempts, 2);
			g_Assert.equal(mapComponentManager.size, 1);
			g_Assert.equal(mapComponentManager.has("server_cvar"), false);
			g_Assert.equal(mapComponentManager.has("player_disconnect"), true);
			g_Assert.equal(mapComponentManager.get("player_disconnect").length, 1);
			g_Assert.equal(g_vecNativeRegistrations.length, unInitialNativeRegistrations + 1);
		} finally {
			if (mapComponentManager !== null) {
				g_Assert.equal(mapComponentManager.Clear(), true);
			}
		}

		g_Assert.equal(g_vecNativeRegistrations.length, unInitialNativeRegistrations);
	}
}

function AssertLocalDispatchContracts(Manager) {
	const mapEvents = new Manager.EventManager();
	let LatestEvent = null;
	const Record = EventValue => {
		LatestEvent = EventValue;
	};
	g_Assert.equal(mapEvents.RegisterEventListener("SourceJSLocalContract", Record), true);

	try {
		for (const Input of [undefined, null, "", false, 0, 7n, "null", '{"Value":7}']) {
			LatestEvent = null;
			g_Assert.equal(mapEvents.DispatchEvent("SourceJSLocalContract", Input), true);
			g_Assert.notEqual(LatestEvent, null);

			if (Input === undefined) {
				g_Assert.deepEqual(LatestEvent.EventPayload, {});
				g_Assert.deepEqual(LatestEvent.RawEventPayload, {});

			} else if ((Input === null) || (Input === "")) {
				g_Assert.deepEqual(LatestEvent.EventPayload, {});
				g_Assert.strictEqual(LatestEvent.RawEventPayload, Input);

			} else {
				g_Assert.deepEqual(LatestEvent.EventPayload, (typeof Input === "string") ? JSON.parse(Input) : Input);
				g_Assert.strictEqual(LatestEvent.RawEventPayload, Input);
			}
		}

		const Payload = Object.create({ Inherited: 99 });
		Object.defineProperty(Payload, "Hidden", { value: 7 });
		g_Assert.equal(mapEvents.DispatchEvent("SourceJSLocalContract", Payload), true);
		g_Assert.strictEqual(LatestEvent.EventPayload, Payload);
		g_Assert.strictEqual(LatestEvent.RawEventPayload, Payload);
		g_Assert.equal(LatestEvent.GetEventValue("Hidden", -1), 7, "Local own-property lookup includes non-enumerable keys, unlike native payload enumeration.");
		g_Assert.equal(LatestEvent.GetEventValue("Inherited", -1), -1);

		const PassedEvent = { EventName: "DifferentName", GetEventValue: () => 23 };
		g_Assert.equal(mapEvents.DispatchEvent("SourceJSLocalContract", PassedEvent), true);
		g_Assert.strictEqual(LatestEvent, PassedEvent, "A passed-through event is not renamed or wrapped.");
	} finally {
		g_Assert.equal(mapEvents.UnregisterEventListener("SourceJSLocalContract", Record), true);
	}

	g_Assert.equal(mapEvents.size, 0);

	const vecSnapshotListeners = new Manager.EventListener("SourceJSManagedSnapshot");
	const vecCalls = [];
	const vecViews = [];
	let bInitialDispatch = true;
	const Added = EventValue => {
		vecCalls.push("Added");
		vecViews.push(EventValue);
	};
	const Original = EventValue => {
		vecCalls.push("Original");
		vecViews.push(EventValue);
	};
	const Mutator = EventValue => {
		vecCalls.push("Mutator");
		vecViews.push(EventValue);

		if (bInitialDispatch) {
			bInitialDispatch = false;
			vecSnapshotListeners.RemoveEventCallback(Original);
			vecSnapshotListeners.AppendEventCallback(Added);
		}
	};
	vecSnapshotListeners.AppendEventCallback(Mutator);
	vecSnapshotListeners.AppendEventCallback(Original);

	const GameEvent = { EventName: "SourceJSManagedSnapshot", GetEventValue: () => undefined };
	g_Assert.equal(vecSnapshotListeners.DispatchGameEvent(GameEvent), true);
	g_Assert.deepEqual(vecCalls, ["Mutator", "Original"]);
	g_Assert.strictEqual(vecViews[0], vecViews[1], "One managed listener forwards the same event object to its callback array.");

	vecCalls.length = 0;
	g_Assert.equal(vecSnapshotListeners.DispatchGameEvent(GameEvent), true);
	g_Assert.deepEqual(vecCalls, ["Mutator", "Added"]);
	vecSnapshotListeners.RemoveEventCallback(Mutator);
	vecSnapshotListeners.RemoveEventCallback(Added);
	g_Assert.equal(vecSnapshotListeners.length, 0);

	const vecListeners = new Manager.EventListener("SourceJSReporterFailure");
	const CallbackError = new Error("Controlled managed callback failure.");
	const ReporterError = new Error("Controlled exception reporter failure.");
	const Fail = () => {
		throw CallbackError;
	};
	let unLaterCalls = 0;
	const Later = () => {
		unLaterCalls++;
	};
	vecListeners.AppendEventCallback(Fail);
	vecListeners.AppendEventCallback(Later);

	const ExceptionHooks = require(g_strExceptionsPath).EXCEPTION_HOOKS;
	const OriginalPrintException = ExceptionHooks.PrintException;
	ExceptionHooks.PrintException = () => {
		throw ReporterError;
	};

	try {
		g_Assert.throws(() => vecListeners.DispatchGameEvent({ EventName: "DifferentName", GetEventValue: () => 0 }), ErrorValue => ErrorValue === ReporterError);
		g_Assert.equal(unLaterCalls, 0, "A reporter failure propagates rather than guaranteeing later managed callbacks run.");
	} finally {
		ExceptionHooks.PrintException = OriginalPrintException;
		g_Assert.strictEqual(vecListeners.RemoveEventCallback(Fail), Fail);
		g_Assert.strictEqual(vecListeners.RemoveEventCallback(Later), Later);
	}
}

function TrackExports(ModuleExports, setExercisedExports) {
	return new Proxy(ModuleExports, {
		get(Target, PropertyKey, Receiver) {
			const Value = Reflect.get(Target, PropertyKey, Receiver);

			if ((typeof PropertyKey !== "string") || !g_vecExpectedExports.includes(PropertyKey)) {
				return Value;
			}

			if (PropertyKey === "EVENT_MANAGER") {
				setExercisedExports.add(PropertyKey);
				return Value;
			}

			if ((PropertyKey === "EventListener") || (PropertyKey === "EventManager")) {
				return new Proxy(Value, {
					construct(Constructor, vecArguments, NewTarget) {
						setExercisedExports.add(PropertyKey);

						return Reflect.construct(Constructor, vecArguments, NewTarget);
					},
				});
			}

			return function TrackedExport(...vecArguments) {
				setExercisedExports.add(PropertyKey);

				return Reflect.apply(Value, Target, vecArguments);
			};
		},
	});
}

function TrackPrototypeMethods(Prototype, vecMethodNames, setExercisedMethods) {
	const mapOriginalMethods = new Map();

	for (const strMethodName of vecMethodNames) {
		const OriginalMethod = Prototype[strMethodName];
		mapOriginalMethods.set(strMethodName, OriginalMethod);
		Prototype[strMethodName] = function TrackedMethod(...vecArguments) {
			setExercisedMethods.add(strMethodName);

			return Reflect.apply(OriginalMethod, this, vecArguments);
		};
	}

	return function RestorePrototypeMethods() {
		for (const [strMethodName, OriginalMethod] of mapOriginalMethods) {
			Prototype[strMethodName] = OriginalMethod;
		}
	};
}

const g_NativeEvents = {
	CreateCustomEvent(strName, Variables) {
		return { EventName: strName, EventVariables: Variables };
	},
	FireEvent: DispatchNativeEvent,
	UnregisterEventListener(strEventName, Callback) {
		return RemoveNativeRegistration(strEventName, Callback);
	},
	RegisterEventListener(strEventName, Callback) {
		return AddNativeRegistration(strEventName, Callback);
	},
	CreateEventPayload(Variables, Overrides) {
		g_Assert.equal(typeof Variables, "object");

		return { Enabled: false, ...Overrides };
	},
	CreateEventResourceText() {
		return '"Enabled"\t"bool"';
	},
};

const g_NativeCustomEvents = { CreateCustomEvent: g_NativeEvents.CreateCustomEvent, FireEvent: DispatchNativeEvent, CreateEventPayload: g_NativeEvents.CreateEventPayload, CreateEventResourceText: g_NativeEvents.CreateEventResourceText };

const g_NativeEventListener = { FireEvent: DispatchNativeEvent, UnregisterEventListener: g_NativeEvents.UnregisterEventListener, RegisterEventListener: g_NativeEvents.RegisterEventListener };

const g_NativeEventManager = {
	FireEvent: DispatchNativeEvent,
	UnregisterEventListener(strEventName, Callback) {
		if (!g_bNativeRemoveResult) {
			return false;
		}

		return RemoveNativeRegistration(strEventName, Callback);
	},
	RegisterEventListener(strEventName, Callback) {
		if (!g_bNativeAddResult) {
			return false;
		}

		return AddNativeRegistration(strEventName, Callback);
	},
};

try {
	g_Module._load = function Load(strRequestName, ParentModule, bIsMain) {
		if (strRequestName === "internal/runtime") {
			return require(g_strRuntimePath);
		}

		if (strRequestName === "memory/hooks/exceptions") {
			return require(g_strExceptionsPath);
		}

		return g_OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
	};

	for (const strModulePath of g_vecScopedCachePaths) {
		delete require.cache[strModulePath];
	}

	globalThis.sourcejs = { events: g_NativeEvents, "events/custom": g_NativeCustomEvents, "events/listener": g_NativeEventListener, "events/manager": g_NativeEventManager };

	InstallDependency(g_strExceptionsPath, {
		EXCEPTION_HOOKS: {
			PrintException(Error, Context) {
			g_vecReportedExceptions.push({ Context, Error });

				return true;
			},
		},
	});

	const g_Events = require(g_strEventsPath);
	require(g_strCustomEventsPath);
	require(g_strListenerPath);
	const g_Manager = require(g_strManagerPath);

	g_Assert.deepEqual(Object.keys(g_Manager).sort(), g_vecExpectedExports);
	g_Assert.throws(() => ExecuteDocumentationBlock('console.log("must fail");', 0, {}), /Event manager documentation must use the typed logger\./);
	g_Assert.throws(() => ExecuteDocumentationBlock("module.exports.unload = () => {};", 0, {}), /obsolete lowercase lifecycle/);
	g_Assert.doesNotThrow(() => ExecuteDocumentationBlock("module.exports = null;", 0, {}));
	g_Assert.doesNotThrow(() => ExecuteDocumentationBlock("module.exports = undefined;", 0, {}));

	for (const [EventClass, vecExpectedMethods] of [[g_Manager.EventListener, g_vecExpectedEventListenerMethods], [g_Manager.EventManager, g_vecExpectedEventManagerMethods]]) {
		const vecOwnMethodNames = Object.getOwnPropertyNames(EventClass.prototype).filter((strPropertyName) => strPropertyName !== "constructor").sort();
		g_Assert.deepEqual(vecOwnMethodNames, vecExpectedMethods);
	}

	let g_TopLevelSnapshot = null;

	function HandleTopLevelEvent(GameEvent) {
		GameEvent.SetEventInteger("Value", GameEvent.GetEventInteger("Value") + 1);
		g_TopLevelSnapshot = { Address: GameEvent.Address, EventName: GameEvent.EventName, Value: GameEvent.GetEventInteger("Value") };
	}

	g_Events.RegisterEventListener("TopLevelEvent", HandleTopLevelEvent);
	const g_TopLevelPayload = { Value: 42 };
	g_Assert.equal(g_Events.FireEvent("TopLevelEvent", g_TopLevelPayload), true);
	g_Assert.ok(g_TopLevelSnapshot, "The top-level callback must capture its event while it is live.");
	g_Assert.equal(g_TopLevelSnapshot.EventName, "TopLevelEvent");
	g_Assert.equal(g_TopLevelSnapshot.Address, 0x1000n, "Captured event addresses must retain BigInt identity.");
	g_Assert.equal(g_TopLevelSnapshot.Value, 43);
	g_Assert.equal(g_TopLevelPayload.Value, 42, "Native dispatch must not mutate the caller payload.");
	g_Assert.equal(g_Events.UnregisterEventListener("TopLevelEvent", HandleTopLevelEvent), true);
	g_Assert.equal(g_vecNativeRegistrations.length, 0);

	g_vecNativeAdds.length = 0;
	g_vecNativeRemoves.length = 0;

	const g_vecSeenEvents = [];
	let g_CapturedGameEvent = null;

	function HandleFirstManagedEvent(Event) {
		g_CapturedGameEvent = Event;
		g_vecSeenEvents.push(["first", Event.EventName, Event.GetEventInteger("userid"), Event.GetEventString("weapon")]);
	}

	function HandleSecondManagedEvent(Event) {
		g_vecSeenEvents.push(["second", Event.EventName, Event.GetEventInteger("userid")]);
	}

	g_Assert.equal(g_Manager.RegisterEventListener("player_death", HandleFirstManagedEvent), true);
	g_Assert.equal(g_vecNativeAdds.length, 1);
	g_Assert.equal(g_Manager.EVENT_MANAGER.has("player_death"), true);
	const g_vecManagedListener = g_Manager.EVENT_MANAGER.get("player_death");
	g_Assert.equal(g_vecManagedListener instanceof g_Manager.EventListener, true);
	g_Assert.equal(Array.isArray(g_vecManagedListener), true);
	g_Assert.equal(g_vecManagedListener.EventName, "player_death");
	g_Assert.equal(typeof g_vecManagedListener.EngineCallback, "function");
	g_Assert.equal(Object.hasOwn(g_vecManagedListener, "eventName"), false);
	g_Assert.equal(Object.hasOwn(g_vecManagedListener, "engineCallback"), false);
	g_Assert.equal(g_vecManagedListener.length, 1);
	g_Assert.strictEqual(g_vecManagedListener[0], HandleFirstManagedEvent);
	g_Assert.equal(g_vecManagedListener.slice() instanceof g_Manager.EventListener, false);
	g_Assert.throws(() => g_Manager.RegisterEventListener("player_death", HandleFirstManagedEvent), /already registered/);
	g_Assert.equal(g_Manager.RegisterEventListener("player_death", HandleSecondManagedEvent), true);
	g_Assert.equal(g_vecNativeAdds.length, 1);

	g_vecNativeAdds[0].EngineCallback(MakeNativeGameEvent("player_death", { userid: 12, weapon: "smg" }));
	g_Assert.deepEqual(g_vecSeenEvents, [
		["first", "player_death", 12, "smg"],
		["second", "player_death", 12],
	]);
	g_Assert.equal(Object.hasOwn(g_CapturedGameEvent, "toJSON"), false);
	g_Assert.equal(g_Manager.UnregisterEventListener("player_death", HandleFirstManagedEvent), true);
	g_Assert.equal(g_vecNativeRemoves.length, 0);
	g_Assert.equal(g_Manager.UnregisterEventListener("player_death", HandleSecondManagedEvent), true);
	g_Assert.equal(g_vecNativeRemoves.length, 1);
	g_Assert.equal(g_Manager.EVENT_MANAGER.has("player_death"), false);
	g_Assert.throws(() => g_Manager.RegisterEventListener(7, HandleFirstManagedEvent), /non-empty string/);

	const g_mapFailureManager = new g_Manager.EventManager();

	function HandleFailedRegistration() {
	}

	g_Assert.throws(() => g_mapFailureManager.RegisterEventListener("InvalidCallback", "nope"), /not callable/);
	g_Assert.equal(g_mapFailureManager.size, 0);

	g_Assert.throws(() => g_mapFailureManager.AddNativeEventListener({ eventName: "LegacyListener", engineCallback: HandleFailedRegistration }), /non-empty string/);
	g_Assert.throws(() => g_mapFailureManager.RemoveNativeEventListener({ eventName: "LegacyListener", engineCallback: HandleFailedRegistration }), /non-empty string/);
	g_Assert.equal(g_mapFailureManager.size, 0);

	g_bNativeAddResult = false;
	g_Assert.throws(() => g_mapFailureManager.RegisterEventListener("NativeAddFailure", HandleFailedRegistration), /Unable to register/);
	g_Assert.equal(g_mapFailureManager.size, 0);

	g_bNativeAddResult = true;
	g_Assert.equal(g_mapFailureManager.RegisterEventListener("NativeRemoveFailure", HandleFailedRegistration), true);

	g_bNativeRemoveResult = false;
	g_Assert.throws(() => g_mapFailureManager.UnregisterEventListener("NativeRemoveFailure", HandleFailedRegistration), /Unable to unregister/);
	g_Assert.equal(g_mapFailureManager.get("NativeRemoveFailure").length, 1);

	g_bNativeRemoveResult = true;
	g_Assert.equal(g_mapFailureManager.UnregisterEventListener("NativeRemoveFailure", HandleFailedRegistration), true);

	const g_vecThrowingListener = new g_Manager.EventListener("BrokenEvent");
	let g_bCallbackAfterExceptionRan = false;

	function ThrowManagedCallbackError() {
		throw new Error("boom");
	}

	function RecordCallbackAfterException() {
		g_bCallbackAfterExceptionRan = true;
	}

	g_vecThrowingListener.AppendEventCallback(ThrowManagedCallbackError);
	g_vecThrowingListener.AppendEventCallback(RecordCallbackAfterException);
	g_Assert.equal(g_vecThrowingListener.DispatchGameEvent(MakeNativeGameEvent("BrokenEvent", {})), true);
	g_Assert.equal(g_bCallbackAfterExceptionRan, true);
	g_Assert.equal(g_vecReportedExceptions.length, 1);
	g_Assert.equal(g_vecReportedExceptions[0].Context.Source, "events/manager");
	g_Assert.match(g_vecReportedExceptions[0].Error.message, /boom/);
	g_Assert.throws(() => new g_Manager.EventListener(""), /non-empty string/);
	g_Assert.throws(() => g_vecThrowingListener.AppendEventCallback(null), /not callable/);
	g_Assert.throws(() => g_vecThrowingListener.RemoveEventCallback(null), /not callable/);
	g_Assert.throws(() => g_vecThrowingListener.AppendEventCallback(g_vecThrowingListener[0]), /already registered/);
	g_Assert.throws(() => g_vecThrowingListener.RemoveEventCallback(function HandleUnknownEvent() {}), /not registered/);
	g_Assert.throws(() => g_vecThrowingListener.DispatchGameEvent({ EventName: "BrokenEvent" }), /live game event/);
	g_Assert.throws(() => g_vecThrowingListener.DispatchGameEvent({ name: "BrokenEvent", getString: () => "" }), /live game event/);

	const g_mapLocalManager = new g_Manager.EventManager();
	const g_vecLocalListener = new g_Manager.EventListener("LocalEvent");
	let g_LocalEvent = null;

	function RecordLocalEvent(Event) {
		g_LocalEvent = Event;
		g_vecSeenEvents.push(["local", Event.EventName, Event.GetEventValue("Value")]);
	}

	g_vecLocalListener.AppendEventCallback(RecordLocalEvent);
	g_mapLocalManager.set("LocalEvent", g_vecLocalListener);
	g_Assert.equal(g_mapLocalManager.DispatchEvent("LocalEvent", "{\"Value\":7}"), true);
	g_Assert.deepEqual(g_vecSeenEvents.at(-1), ["local", "LocalEvent", 7]);
	g_Assert.equal(g_LocalEvent.EventName, "LocalEvent");
	g_Assert.deepEqual(g_LocalEvent.EventPayload, { Value: 7 });
	g_Assert.equal(g_LocalEvent.RawEventPayload, "{\"Value\":7}");
	g_Assert.equal(g_LocalEvent.GetEventValue("Missing", 11), 11);
	g_Assert.deepEqual(Object.keys(g_LocalEvent).sort(), ["EventName", "EventPayload", "GetEventValue", "RawEventPayload"]);
	g_Assert.throws(() => g_mapLocalManager.DispatchEvent("LocalEvent", "{"), SyntaxError);
	g_Assert.equal(g_mapLocalManager.DispatchEvent("MissingEvent", "{"), false);

	const g_PassThroughEvent = {
		EventName: "ExternalName",
		GetEventValue(strKey, DefaultValue) {
			return (strKey === "Value") ? 13 : DefaultValue;
		},
	};

	g_Assert.equal(g_mapLocalManager.DispatchEvent("LocalEvent", g_PassThroughEvent), true);
	g_Assert.strictEqual(g_LocalEvent, g_PassThroughEvent);

	const g_mapClearManager = new g_Manager.EventManager();

	function HandleFirstClearEvent() {
	}

	function HandleSecondClearEvent() {
	}

	g_mapClearManager.RegisterEventListener("ClearFirst", HandleFirstClearEvent);
	g_mapClearManager.RegisterEventListener("ClearSecond", HandleSecondClearEvent);
	g_bNativeRemoveResult = false;
	g_Assert.throws(() => g_mapClearManager.Clear(), /ClearFirst/);
	g_Assert.equal(g_mapClearManager.size, 2);
	g_bNativeRemoveResult = true;
	g_Assert.equal(g_mapClearManager.Clear(), true);
	g_Assert.equal(g_mapClearManager.size, 0);

	g_mapClearManager.RegisterEventListener("ClearFirst", HandleFirstClearEvent);
	g_mapClearManager.RegisterEventListener("ClearSecond", HandleSecondClearEvent);
	g_Assert.equal(g_mapClearManager.clear(), true);
	g_Assert.equal(g_mapClearManager.size, 0);
	g_Assert.equal(g_vecNativeRegistrations.length, 0);

	const g_strDocumentation = g_FileSystem.readFileSync(g_strManagerDocumentationPath, "utf8");
	const g_vecDocumentationBlocks = ExtractJavaScriptBlocks(g_strDocumentation);
	const g_setExercisedExports = new Set();
	const g_setExercisedEventListenerMethods = new Set();
	const g_setExercisedEventManagerMethods = new Set();
	const g_DocumentedManager = TrackExports(g_Manager, g_setExercisedExports);
	const g_RestoreEventListenerMethods = TrackPrototypeMethods(g_Manager.EventListener.prototype, g_vecExpectedEventListenerMethods, g_setExercisedEventListenerMethods);
	const g_RestoreEventManagerMethods = TrackPrototypeMethods(g_Manager.EventManager.prototype, g_vecExpectedEventManagerMethods, g_setExercisedEventManagerMethods);

	try {
		const g_unExpectedDocumentationBlockCount = 11;
		g_Assert.equal(g_vecDocumentationBlocks.length, g_unExpectedDocumentationBlockCount);
		g_Assert.match(g_strDocumentation, /numbers recognized by V8 as signed `int32` values use `SetInt`/);
		AssertManagedDocumentationCleanup(g_vecDocumentationBlocks, g_Manager);
		AssertDocumentedClearFailure(g_vecDocumentationBlocks, g_Manager);
		g_Assert.doesNotMatch(g_strDocumentation, /generated by|auto-generated|example generator/i);
		g_Assert.doesNotMatch(g_strDocumentation, /addressString|payload\.skip|events\/hooks|source\.events|moduleName|module\.exports\.unload|exports\.unload/);
		g_Assert.doesNotMatch(g_strDocumentation, /\bconsole\.log\(/, "Executable event-manager documentation must use the typed logger.");

		for (const strSource of g_vecDocumentationBlocks) {
			new g_VM.Script(`"use strict";\n${strSource}`);
		}

		g_setExercisedExports.clear();
		g_setExercisedEventListenerMethods.clear();
		g_setExercisedEventManagerMethods.clear();
		g_Assert.equal(g_setExercisedEventListenerMethods.size + g_setExercisedEventManagerMethods.size, 0, "Documentation coverage must start without calls from helper scenarios.");
		for (const [unBlockIndex, strSource] of g_vecDocumentationBlocks.entries()) {
			ExecuteDocumentationBlock(strSource, unBlockIndex, { "events/manager": g_DocumentedManager });
		}
	} finally {
		g_RestoreEventManagerMethods();
		g_RestoreEventListenerMethods();
	}

	for (const strExportName of g_vecDocumentedExports) {
		g_Assert.equal(g_setExercisedExports.has(strExportName), true, `Documentation did not exercise events/manager.${strExportName}.`);
	}

	for (const strMethodName of g_vecDocumentedEventListenerMethods) {
		g_Assert.equal(g_setExercisedEventListenerMethods.has(strMethodName), true, `Documentation did not exercise EventListener.${strMethodName}.`);
	}

	for (const strMethodName of g_vecDocumentedEventManagerMethods) {
		g_Assert.equal(g_setExercisedEventManagerMethods.has(strMethodName), true, `Documentation did not exercise EventManager.${strMethodName}.`);
	}

	g_Assert.equal(g_Manager.EVENT_MANAGER.size, 0);
	g_Assert.equal(g_vecNativeRegistrations.length, 0);
	AssertLocalDispatchContracts(g_Manager);
	g_Assert.equal(g_vecNativeRegistrations.length, 0);

	for (const strPackagePath of [g_strEventsPath, g_strCustomEventsPath, g_strListenerPath, g_strManagerPath, g_strRuntimePath]) {
		delete require.cache[strPackagePath];
	}

	delete globalThis.sourcejs;

	g_Assert.throws(() => require(g_strEventsPath), { name: "Error", message: /^SourceJS native runtime is not installed/ }, "Events must report native absence, not a lookup or unrelated error.");
	g_Assert.throws(() => require(g_strCustomEventsPath), { name: "Error", message: /^SourceJS native runtime is not installed/ }, "Custom events must report native absence, not a lookup or unrelated error.");
	g_Assert.throws(() => require(g_strListenerPath), { name: "Error", message: /^SourceJS native runtime is not installed/ }, "Listeners must report native absence, not a lookup or unrelated error.");
	g_Assert.throws(() => require(g_strManagerPath), { name: "Error", message: /^SourceJS native runtime is not installed/ }, "Event manager must report native absence, not a lookup or unrelated error.");

	console.log("[  OK  ] events/manager API and documentation passed with native doubles; native SDK execution not exercised");
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
