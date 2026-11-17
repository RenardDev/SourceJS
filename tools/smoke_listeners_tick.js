#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRootPath = g_Path.resolve(__dirname, "..");
const g_strPackageRootPath = g_Path.join(g_strRootPath, "packages", "sourcejs");
const g_strTickPath = g_Path.join(g_strPackageRootPath, "listeners", "tick.js");
const g_strListenersPath = g_Path.join(g_strPackageRootPath, "listeners.js");
const g_strExceptionsPath = g_Path.join(g_strPackageRootPath, "memory", "hooks", "exceptions.js");
const g_strRuntimePath = g_Path.join(g_strPackageRootPath, "internal", "runtime.js");
const g_unExecutionTimeoutMilliseconds = 1000;
const g_unCompletionTimeoutMilliseconds = 10_000;
const g_mapRootCallbacks = new Map();
const g_vecExceptionRecords = [];
let g_nNowMilliseconds = 1_000_000;
let g_GetMonotonicTimeSeconds = () => g_nNowMilliseconds / 1000;
let g_strRejectedRootEvent = null;
let g_strFailedRootRemovalEvent = null;
let g_RootRemovalFailure = null;

function RegisterNativeListener(strEventName, Callback) {
	if (typeof Callback !== "function") {
		throw new TypeError("Native listener registration requires a function.");
	}

	if (strEventName === g_strRejectedRootEvent) {
		g_strRejectedRootEvent = null;
		return false;
	}

	let vecCallbacks = g_mapRootCallbacks.get(strEventName);
	if (vecCallbacks === undefined) {
		vecCallbacks = [];
		g_mapRootCallbacks.set(strEventName, vecCallbacks);
	}

	vecCallbacks.push(Callback);

	return true;
}

function UnregisterNativeListener(strEventName, Callback) {
	if (typeof Callback !== "function") {
		throw new TypeError("Native listener removal requires a function.");
	}

	if (strEventName === g_strFailedRootRemovalEvent) {
		g_strFailedRootRemovalEvent = null;
		throw g_RootRemovalFailure;
	}

	const vecCallbacks = g_mapRootCallbacks.get(strEventName);
	const nCallbackIndex = vecCallbacks?.indexOf(Callback) ?? -1;
	if (nCallbackIndex === -1) {
		return false;
	}

	vecCallbacks.splice(nCallbackIndex, 1);

	if (vecCallbacks.length === 0) {
		g_mapRootCallbacks.delete(strEventName);
	}

	return true;
}

const g_NativeTick = {
	GetMonotonicTimeSeconds() {
		return g_GetMonotonicTimeSeconds();
	},

	Emit(Payload) {
		if (typeof Payload === "symbol") {
			throw new TypeError("Native tick payload cannot convert a Symbol to a string.");
		}

		const strPayload = (arguments.length === 0) ? "" : String(Payload);
		for (const Callback of [...(g_mapRootCallbacks.get("Tick") ?? [])]) {
			Callback("Tick", strPayload);
		}
	},

	AddListener(Callback) {
		return RegisterNativeListener("Tick", Callback);
	},

	RemoveListener(Callback) {
		return UnregisterNativeListener("Tick", Callback);
	},
};

function LoadTickModule() {
	const OriginalModuleLoad = g_Module._load;
	g_Module._load = function Load(strRequestName, ParentModule, bIsMain) {
		if (strRequestName === "internal/runtime") {
			return OriginalModuleLoad.call(this, g_strRuntimePath, ParentModule, bIsMain);
		}

		if (strRequestName === "listeners") {
			return OriginalModuleLoad.call(this, g_strListenersPath, ParentModule, bIsMain);
		}

		if (strRequestName === "memory/hooks/exceptions") {
			return OriginalModuleLoad.call(this, g_strExceptionsPath, ParentModule, bIsMain);
		}

		return OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
	};

	try {
		return require(g_strTickPath);
	} finally {
		g_Module._load = OriginalModuleLoad;
	}
}

function InstallTestEnvironment() {
	const TimeDescriptor = Object.getOwnPropertyDescriptor(Date, "now");
	const BridgeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
	const vecCacheSnapshots = [g_strTickPath, g_strListenersPath, g_strExceptionsPath, g_strRuntimePath].map((strPath) => ({ Path: strPath, Descriptor: Object.getOwnPropertyDescriptor(require.cache, strPath) }));
	const RestoreEnvironment = () => {
		if (TimeDescriptor === undefined) {
			delete Date.now;

		} else {
			Object.defineProperty(Date, "now", TimeDescriptor);
		}

		if (BridgeDescriptor === undefined) {
			delete globalThis.sourcejs;

		} else {
			Object.defineProperty(globalThis, "sourcejs", BridgeDescriptor);
		}

		for (const CacheSnapshot of vecCacheSnapshots.reverse()) {
			if (CacheSnapshot.Descriptor === undefined) {
				delete require.cache[CacheSnapshot.Path];

			} else {
				Object.defineProperty(require.cache, CacheSnapshot.Path, CacheSnapshot.Descriptor);
			}
		}
	};

	try {
		for (const CacheSnapshot of vecCacheSnapshots) {
			delete require.cache[CacheSnapshot.Path];
		}

		Object.defineProperty(Date, "now", { configurable: true, enumerable: false, writable: true, value: () => g_nNowMilliseconds });
		Object.defineProperty(globalThis, "sourcejs", { configurable: true, enumerable: true, writable: true, value: { "listeners/tick": g_NativeTick } });
		require.cache[g_strListenersPath] = {
			exports: { RegisterListener: RegisterNativeListener, UnregisterListener: UnregisterNativeListener },
			filename: g_strListenersPath,
			id: g_strListenersPath,
			loaded: true,
		};
		require.cache[g_strExceptionsPath] = {
			exports: {
				EXCEPTION_HOOKS: {
					PrintException(ExceptionError, Context) {
						g_vecExceptionRecords.push({ Error: ExceptionError, ...Context });

						return ExceptionError;
					},
				},
			},
			filename: g_strExceptionsPath,
			id: g_strExceptionsPath,
			loaded: true,
		};
	} catch (ErrorValue) {
		RestoreEnvironment();
		throw ErrorValue;
	}

	return RestoreEnvironment;
}

function CheckMonotonicTickClocks(TickModule) {
	const PreviousClock = g_GetMonotonicTimeSeconds;
	const nPreviousWallTime = g_nNowMilliseconds;
	const vecDelays = [];
	const vecTasks = [];
	let flMonotonicTime = 0;
	let unScenarioCount = 0;
	g_GetMonotonicTimeSeconds = () => flMonotonicTime;

	try {
		for (const flWallStart of [0, 1_000_000]) {
			for (const flOrigin of [-50, 0, 512.25]) {
				for (const flWallJump of [-1_000_000, 1_000_000]) {
					g_nNowMilliseconds = flWallStart * 1000;
					flMonotonicTime = flOrigin;
					let unCalls = 0;
					const Delay = new TickModule.TickDelay(5, () => {
						++unCalls;
					});
					vecDelays.push(Delay);
					g_Assert.equal(Delay.StartTimeSeconds, flWallStart);
					g_Assert.equal(Delay.ExecutionTimeSeconds, flWallStart + 5);
					g_nNowMilliseconds += flWallJump * 1000;
					g_Assert.equal(Delay.TimeRemainingSeconds, 5, "TickDelay deadlines must ignore wall-clock jumps.");
					g_Assert.equal(Delay.TimeElapsedSeconds, 0);
					TickModule.EmitTickEvent();
					g_Assert.equal(unCalls, 0);
					flMonotonicTime += 2;
					g_Assert.equal(Delay.TimeRemainingSeconds, 3);
					g_Assert.equal(Delay.TimeElapsedSeconds, 2);
					g_nNowMilliseconds -= 2 * flWallJump * 1000;
					flMonotonicTime += 3;
					TickModule.EmitTickEvent();
					g_Assert.equal(unCalls, 1);
					g_Assert.equal(Delay.Running, false);
					g_Assert.equal(Delay.TimeRemainingSeconds, 0);
					g_Assert.equal(Delay.TimeElapsedSeconds, 0);
					g_Assert.equal(Delay.StartTimeSeconds, flWallStart);
					g_Assert.equal(Delay.ExecutionTimeSeconds, flWallStart + 5);
					g_Assert.equal(Object.keys(Delay).some(strName => strName.startsWith("m_")), false);
					++unScenarioCount;
				}
			}
		}

		for (const flWallStart of [0, 1_000_000]) {
			for (const flOrigin of [-50, 0, 512.25]) {
				for (const flWallJump of [-1_000_000, 1_000_000]) {
					g_nNowMilliseconds = flWallStart * 1000;
					flMonotonicTime = flOrigin;
					let unCalls = 0;
					const Task = new TickModule.RepeatingTickTask(() => {
						++unCalls;
					});
					vecTasks.push(Task);
					Task.StartRepeatingTickTask(5, 3);
					flMonotonicTime += 2;
					g_nNowMilliseconds += flWallJump * 1000;
					g_Assert.equal(Task.CurrentDelayTimeRemainingSeconds, 3);
					g_Assert.equal(Task.TotalTimeElapsedSeconds, 2);
					g_Assert.equal(Task.OriginalStartTimeSeconds, flWallStart);
					Task.PauseRepeatingTickTask();
					g_Assert.equal(Task.PausedDelaySeconds, 3);
					flMonotonicTime += 10;
					g_nNowMilliseconds -= 2 * flWallJump * 1000;
					g_Assert.equal(Task.TotalTimeElapsedSeconds, 12);
					Task.ResumeRepeatingTickTask();
					g_Assert.equal(Task.CurrentDelayTimeRemainingSeconds, 3);
					flMonotonicTime += 3;
					TickModule.EmitTickEvent();
					g_Assert.equal(unCalls, 1);
					g_Assert.equal(Task.LoopsRemaining, 2);
					Task.StopRepeatingTickTask();
					flMonotonicTime += 1;
					g_Assert.equal(Task.TotalTimeElapsedSeconds, 16);
					g_Assert.equal(Object.keys(Task).some(strName => strName.startsWith("m_")), false);
					++unScenarioCount;
				}
			}
		}

		flMonotonicTime = 100;
		g_nNowMilliseconds = 1000;
		const vecOrder = [];
		vecDelays.push(new TickModule.TickDelay(1, () => {
			vecOrder.push("First");
			vecDelays.push(new TickModule.TickDelay(0, () => vecOrder.push("Nested")));
		}));
		g_nNowMilliseconds -= 1_000_000_000;
		vecDelays.push(new TickModule.TickDelay(1, () => vecOrder.push("Second")));
		flMonotonicTime += 1;
		TickModule.EmitTickEvent();
		g_Assert.deepEqual(vecOrder, ["First", "Second", "Nested"], "Equal monotonic deadlines keep insertion order, including zero-delay reentrancy.");
		++unScenarioCount;

		const CancelledDelay = new TickModule.TickDelay(1, () => g_Assert.fail("Level-cancelled delay ran."), [], true);
		const PersistentDelay = new TickModule.TickDelay(1, () => undefined);
		const CancelledTask = new TickModule.RepeatingTickTask(() => g_Assert.fail("Level-cancelled task ran."), [], true);
		const PersistentTask = new TickModule.RepeatingTickTask(() => undefined);
		vecDelays.push(CancelledDelay, PersistentDelay);
		vecTasks.push(CancelledTask, PersistentTask);
		CancelledTask.StartRepeatingTickTask(1, 2);
		PersistentTask.StartRepeatingTickTask(1, 2);
		TickModule.CancelScheduledTickTasksOnLevelEnd();
		g_Assert.equal(CancelledDelay.Running, false);
		g_Assert.equal(CancelledTask.RepeatingTickTaskStatus, TickModule.RepeatingTickTaskStatus.STOPPED);
		g_Assert.equal(PersistentDelay.Running, true);
		g_Assert.equal(PersistentTask.RepeatingTickTaskStatus, TickModule.RepeatingTickTaskStatus.RUNNING);
		PersistentDelay.CancelTickDelay();
		PersistentTask.StopRepeatingTickTask();
		++unScenarioCount;

		for (const Value of [undefined, null, NaN, Infinity, "clock"]) {
			g_GetMonotonicTimeSeconds = () => Value;
			g_Assert.throws(() => new TickModule.TickDelay(1, () => undefined), /monotonic time must be a finite number/);
			++unScenarioCount;
		}

		const GameTask = new TickModule.GameThreadTask(() => undefined);
		g_Assert.equal(Object.keys(GameTask).some(strName => strName.startsWith("m_")), false);
		++unScenarioCount;
	} finally {
		for (const Task of vecTasks) {
			Task.StopRepeatingTickTask();
		}

		for (const Delay of vecDelays) {
			Delay.DisposeTickDelay();
		}

		TickModule.DisposeTickListeners();
		g_GetMonotonicTimeSeconds = PreviousClock;
		g_nNowMilliseconds = nPreviousWallTime;
	}

	g_Assert.equal(unScenarioCount, 32);
	console.log("[  OK  ] tick monotonic clock: 32 independent clock/storage/lifecycle scenarios passed");
}

function CheckReadOnlyGetters(Constructor, vecPropertyNames) {
	for (const strPropertyName of vecPropertyNames) {
		const Descriptor = Object.getOwnPropertyDescriptor(Constructor.prototype, strPropertyName);
		g_Assert.ok(Descriptor, `Missing ${Constructor.name}.${strPropertyName} getter`);
		g_Assert.equal(typeof Descriptor.get, "function");
		g_Assert.equal(Descriptor.set, undefined);
	}
}

async function CheckGameThreadTaskContract(TickModule) {
	const Callback = () => undefined;
	const BeforeStartTask = new TickModule.GameThreadTask(Callback);
	g_Assert.equal(await BeforeStartTask.JoinGameThreadTask(), undefined);
	g_Assert.equal(BeforeStartTask.Identifier, 0);
	g_Assert.equal(BeforeStartTask.Running, false);
	g_Assert.equal("Callback" in BeforeStartTask, false);
	g_Assert.equal("Promise" in BeforeStartTask, false);
	g_Assert.equal(new TickModule.GameThreadTask(Callback, { Name: undefined }).Name, Callback.name);
	g_Assert.equal(new TickModule.GameThreadTask(Callback, Object.create({ Name: "Inherited" })).Name, Callback.name);
	g_Assert.equal(new TickModule.GameThreadTask(Callback, { Unknown: true }).Name, Callback.name);
	g_Assert.throws(() => new TickModule.GameThreadTask(Callback, { Name: "" }), /non-empty string/);
	g_Assert.throws(() => new TickModule.GameThreadTask(Callback, { Name: null }), /non-empty string/);
	g_Assert.throws(() => new TickModule.GameThreadTask(Callback, { Name: new String("Boxed") }), /non-empty string/);

	const NamedCallback = () => undefined;
	Object.defineProperty(NamedCallback, "name", { value: 73 });
	g_Assert.equal(new TickModule.GameThreadTask(NamedCallback).Name, 73, "derived callback names are retained without coercion");

	const CallbackNameError = new Error("Injected callback-name getter failure.");
	const FailingNameCallback = () => undefined;
	Object.defineProperty(FailingNameCallback, "name", {
		get() {
			throw CallbackNameError;
		},
	});
	g_Assert.throws(() => new TickModule.GameThreadTask(FailingNameCallback), ErrorValue => ErrorValue === CallbackNameError);
	g_Assert.equal(new TickModule.GameThreadTask(FailingNameCallback, { Name: "Explicit" }).Name, "Explicit");

	const EchoTask = new TickModule.GameThreadTask(Value => Value);
	g_Assert.strictEqual(EchoTask.StartGameThreadTask("First"), EchoTask);
	const FirstPromise = EchoTask.JoinGameThreadTask();
	g_Assert.strictEqual(EchoTask.JoinGameThreadTask(), FirstPromise);
	g_Assert.equal(EchoTask.Identifier, 1);
	g_Assert.throws(() => EchoTask.StartGameThreadTask("Rejected"), /already running/);
	g_Assert.equal(EchoTask.Identifier, 1);
	g_Assert.equal(await FirstPromise, "First");
	g_Assert.equal(EchoTask.Running, false);
	EchoTask.StartGameThreadTask("Second");
	g_Assert.notStrictEqual(EchoTask.JoinGameThreadTask(), FirstPromise);
	g_Assert.equal(await EchoTask.JoinGameThreadTask(), "Second");
	g_Assert.equal(await FirstPromise, "First");
	g_Assert.equal(EchoTask.Identifier, 2);

	let bRequestCompleted = false;
	let CompleteRequest = null;
	const AdmissionTask = new TickModule.GameThreadTask(() => {
		CompleteRequest = () => {
			bRequestCompleted = true;
		};

		return true;
	});
	AdmissionTask.StartGameThreadTask();
	g_Assert.equal(await AdmissionTask.JoinGameThreadTask(), true);
	g_Assert.equal(bRequestCompleted, false, "an ordinary scheduling result is not request completion");
	CompleteRequest();
	g_Assert.equal(bRequestCompleted, true);

	const AwaitedTask = new TickModule.GameThreadTask(() => new Promise(Resolve => {
		CompleteRequest = Resolve;
	}));
	AwaitedTask.StartGameThreadTask();
	await Promise.resolve();
	g_Assert.equal(AwaitedTask.Running, true);
	CompleteRequest("Completed");
	g_Assert.equal(await AwaitedTask.JoinGameThreadTask(), "Completed");
	g_Assert.equal(AwaitedTask.Running, false);
}

async function CheckRepeatingStartFailure(TickModule) {
	const vecStateProperties = [
		"StoredIntervalSeconds",
		"StoredOriginalLoopCount",
		"InitialLoopCount",
		"ElapsedLoopCount",
		"StoredLoopCountAdjustment",
		"StoredRepeatingTickTaskStatus",
		"CurrentTickDelay",
		"PausedDelaySeconds",
		"OriginalStartTimeSeconds",
	];

	for (const bPaused of [false, true]) {
		const Task = new TickModule.RepeatingTickTask(() => undefined);
		if (bPaused) {
			Task.StartRepeatingTickTask(5, 3);
			Task.PauseRepeatingTickTask();
			TickModule.DisposeTickListeners();
		}

		const StateBeforeFailure = Object.fromEntries(vecStateProperties.map(strPropertyName => [strPropertyName, Task[strPropertyName]]));
		g_strRejectedRootEvent = "Tick";
		g_Assert.throws(() => Task.StartRepeatingTickTask(2, 7), /Tick scheduler bridge registration was rejected/);

		const StateAfterFailure = Object.fromEntries(vecStateProperties.map(strPropertyName => [strPropertyName, Task[strPropertyName]]));
		g_Assert.deepEqual(StateAfterFailure, StateBeforeFailure, "rejected bridge setup must preserve stopped/paused repeating-task state");

		if (bPaused) {
			g_Assert.equal(Task.ResumeRepeatingTickTask(), true);

		} else {
			g_Assert.equal(Task.StartRepeatingTickTask(2, 7), true);
		}

		g_Assert.equal(Task.StopRepeatingTickTask(), true);
		g_Assert.equal(TickModule.DisposeTickListeners(), true);
	}

	const CallbackError = new Error("Injected immediate repeating callback failure.");
	const ThrowingTask = new TickModule.RepeatingTickTask(() => {
		throw CallbackError;
	});
	g_Assert.throws(() => ThrowingTask.StartRepeatingTickTask(1, 1, true), ErrorValue => ErrorValue === CallbackError);
	g_Assert.equal(ThrowingTask.RepeatingTickTaskStatus, TickModule.RepeatingTickTaskStatus.RUNNING, "a callback failure occurs after successful scheduling");
	g_Assert.equal(ThrowingTask.CurrentTickDelay.Running, true);
	g_Assert.equal(ThrowingTask.StopRepeatingTickTask(), true);
	g_Assert.equal(TickModule.DisposeTickListeners(), true);
}

function CheckRepeatingLoopPrecision(TickModule) {
	// Loop counts use the JavaScript scheduler's Number domain, not a native address or 64-bit value.
	const Task = new TickModule.RepeatingTickTask(() => undefined);
	for (const strMethodName of ["ExtendRepeatingTickTask", "ReduceRepeatingTickTask"]) {
		for (const InvalidAdjustment of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1", 1n, undefined, null, true]) {
			g_Assert.throws(() => Task[strMethodName](InvalidAdjustment), TypeError);
			g_Assert.equal(Task.TotalLoopCount, Infinity);
			g_Assert.equal(Task.AdjustedLoopCount, 0);
			g_Assert.equal(Task.RepeatingTickTaskStatus, TickModule.RepeatingTickTaskStatus.STOPPED);
			g_Assert.equal(Task.CurrentTickDelay, null);
		}
	}

	Task.StartRepeatingTickTask(1, Number.MAX_SAFE_INTEGER);
	g_Assert.throws(() => Task.ExtendRepeatingTickTask(1), RangeError);
	g_Assert.equal(Task.TotalLoopCount, Number.MAX_SAFE_INTEGER);
	g_Assert.equal(Task.AdjustedLoopCount, 0);
	Task.StopRepeatingTickTask();
	TickModule.DisposeTickListeners();

	const ReducedTask = new TickModule.RepeatingTickTask(() => undefined);
	ReducedTask.StartRepeatingTickTask(1, 0);
	g_Assert.equal(ReducedTask.ReduceRepeatingTickTask(Number.MAX_SAFE_INTEGER), true);
	g_Assert.throws(() => ReducedTask.ReduceRepeatingTickTask(1), RangeError);
	g_Assert.equal(ReducedTask.AdjustedLoopCount, -Number.MAX_SAFE_INTEGER);
}

function CheckRepeatingRescheduleFailure(TickModule) {
	let unCallbackCalls = 0;
	const Task = new TickModule.RepeatingTickTask(() => {
		unCallbackCalls += 1;
	});
	Task.StartRepeatingTickTask(1, 2);
	const PreviousDelay = Task.CurrentTickDelay;
	TickModule.DisposeTickListeners();
	g_strRejectedRootEvent = "Tick";
	g_Assert.throws(() => Task.ExecuteRepeatingTickTask(), /Tick scheduler bridge registration was rejected/);
	g_Assert.equal(Task.RepeatingTickTaskStatus, TickModule.RepeatingTickTaskStatus.STOPPED, "failed rescheduling must not leave a running task without a usable bridge");
	g_Assert.equal(Task.CurrentTickDelay, null);
	g_Assert.equal(PreviousDelay.Running, false);
	g_Assert.equal(Task.LoopsElapsed, 1);
	g_Assert.equal(unCallbackCalls, 0);
	g_Assert.equal(Task.StartRepeatingTickTask(1, 1), true);
	g_Assert.equal(Task.StopRepeatingTickTask(), true);
	g_Assert.equal(TickModule.DisposeTickListeners(), true);
}

function EvaluateTickDocumentation(strSource, mapModules, Exports) {
	const Context = g_VM.createContext({
		require(strModuleName) {
			g_Assert.ok(mapModules.has(strModuleName), `Unsupported tick documentation module: ${strModuleName}`);

			return mapModules.get(strModuleName);
		},
		console: { log: () => undefined },
		module: Exports,
	});
	new g_VM.Script(`"use strict";\n${strSource}`).runInContext(Context, { timeout: g_unExecutionTimeoutMilliseconds });
}

function FindTickDocumentation(vecExamples, strMarker) {
	const vecMatches = vecExamples.filter(strSource => strSource.includes(strMarker));
	g_Assert.equal(vecMatches.length, 1, strMarker);

	return vecMatches[0];
}

function CheckTickDocumentationFailure(ObservedFailure, bThrew, Expected) {
	const unExpectedCount = (Expected.PrimaryActive ? 1 : 0) + (Expected.CleanupActive ? 1 : 0);
	g_Assert.equal(bThrew, unExpectedCount > 0);

	if (unExpectedCount === 0) {
		return;
	}

	let vecObserved = [ObservedFailure];
	if (unExpectedCount > 1) {
		g_Assert.equal(ObservedFailure?.name, "AggregateError");
		g_Assert.ok(Array.isArray(ObservedFailure.errors));
		vecObserved = Array.from(ObservedFailure.errors);
	}

	g_Assert.equal(vecObserved.length, unExpectedCount);
	let unFailureIndex = 0;
	for (const strRole of ["Primary", "Cleanup"]) {
		if (!Expected[strRole + "Active"]) {
			continue;
		}

		const strMessage = Expected[strRole + "Message"];
		if (strMessage === undefined) {
			g_Assert.equal(vecObserved[unFailureIndex], Expected[strRole + "Failure"], "Failures must retain exact identity, including null/undefined/zero.");

		} else {
			g_Assert.equal(vecObserved[unFailureIndex]?.name, "Error");
			g_Assert.equal(vecObserved[unFailureIndex].message, strMessage);
		}

		++unFailureIndex;
	}
}

function RunTickDocumentationResourceScenario(TickModule, strSource, Scenario) {
	g_Assert.equal(g_mapRootCallbacks.size, 0, "Resource scenarios require an isolated scheduler fixture.");

	let unForeignCalls = 0;
	const ForeignDelay = new TickModule.TickDelay(60, () => {
		++unForeignCalls;
	});
	const mapBefore = new Map([...g_mapRootCallbacks].map(([strName, vecCallbacks]) => [strName, [...vecCallbacks]]));
	const vecCapturedDelays = [];
	const vecRegisteredCallbacks = [];
	const vecCleanupAttempts = [];
	const CleanupFailure = new Error("Controlled tick cleanup failed.");
	let unConstructorCount = 0;
	let unLogCount = 0;
	let unEmitCount = 0;

	function CreateControlledTickDelay(...vecArguments) {
		++unConstructorCount;

		if ((Scenario.Phase === "CONSTRUCT_SECOND") && (unConstructorCount === 2)) {
			throw Scenario.PrimaryFailure;
		}

		const Delay = new TickModule.TickDelay(...vecArguments);
		vecCapturedDelays.push(Delay);

		const unOrdinal = unConstructorCount;
		const OriginalDispose = Delay.DisposeTickDelay;
		Delay.DisposeTickDelay = function DisposeControlledDelay() {
			vecCleanupAttempts.push(unOrdinal);
			// Release commits in the real JS controller before this controlled reporting failure.
			const bDisposed = Reflect.apply(OriginalDispose, this, []);
			if (Scenario.CleanupMode === "THROW") {
				throw CleanupFailure;
			}

			return (Scenario.CleanupMode === "FALSE") ? false : bDisposed;
		};

		if ((Scenario.Kind === "COMPARE") && (unOrdinal === 1)) {
			const OriginalExecute = Delay.ExecuteTickDelayCallback;
			Delay.ExecuteTickDelayCallback = function ExecuteControlledDelay() {
				if (Scenario.PrimaryActive && (Scenario.Phase === "DIRECT")) {
					throw Scenario.PrimaryFailure;
				}

				const unResult = Reflect.apply(OriginalExecute, this, []);

				return (Scenario.Phase === "INVALID_DIRECT") ? 2 : unResult;
			};
		}

		if ((Scenario.Kind === "COMPARE") && (unOrdinal === 2)) {
			const OriginalInvoke = Delay.InvokeTickDelayCallback;
			Delay.InvokeTickDelayCallback = function InvokeControlledDelay() {
				const strResult = Reflect.apply(OriginalInvoke, this, []);
				if (Scenario.PrimaryActive && (Scenario.Phase === "INVOKE")) {
					throw Scenario.PrimaryFailure;
				}

				return strResult;
			};
		}

		return Delay;
	}

	const TickFacade = {
		...TickModule,
		TickDelay: CreateControlledTickDelay,
		RegisterTickListener(Callback) {
			if (Scenario.Phase === "REGISTER_FALSE") {
				return false;
			}

			if (Scenario.Phase === "REGISTER_THROW") {
				throw Scenario.PrimaryFailure;
			}

			const bRegistered = TickModule.RegisterTickListener(Callback);
			vecRegisteredCallbacks.push(Callback);

			return bRegistered;
		},

		UnregisterTickListener(Callback) {
			vecCleanupAttempts.push(1);
			const bRemoved = TickModule.UnregisterTickListener(Callback);
			if (Scenario.CleanupMode === "THROW") {
				throw CleanupFailure;
			}

			return (Scenario.CleanupMode === "FALSE") ? false : bRemoved;
		},

		EmitTickEvent(...vecArguments) {
			++unEmitCount;
			TickModule.EmitTickEvent(...vecArguments);

			if (Scenario.PrimaryActive && (Scenario.Phase === "EMIT")) {
				throw Scenario.PrimaryFailure;
			}
		},
	};
	const PlayerRecord = { Index: 1, UserID: 42, Name: "FixturePlayer", Connected: true, Say: () => true };
	const mapModules = new Map([
		["listeners/tick", TickFacade],
		["core/logger", {
			LogInfo() {
				++unLogCount;
				const unTargetLog = (Scenario.Phase === "LOG_SECOND") ? 2 : 1;
				if (Scenario.PrimaryActive && Scenario.Phase.startsWith("LOG_") && (unLogCount === unTargetLog)) {
					throw Scenario.PrimaryFailure;
				}
			},
		}],
		["filters/players", {
			GetAllPlayers() {
				if (Scenario.Phase === "PLAYERS_QUERY") {
					throw Scenario.PrimaryFailure;
				}

				return (Scenario.Phase === "NO_PLAYERS") ? [] : [PlayerRecord];
			},
		}],
		["players/entity", { Player: () => PlayerRecord }],
	]);
	const Exports = { exports: {} };
	let ObservedFailure = undefined;
	let bThrew = false;

	try {
		try {
			EvaluateTickDocumentation(strSource, mapModules, Exports);
			Exports.exports.UnloadPlugin?.();
		} catch (Failure) {
			ObservedFailure = Failure;
			bThrew = true;
		}

		CheckTickDocumentationFailure(ObservedFailure, bThrew, {
			PrimaryActive: Scenario.PrimaryActive || (Scenario.PrimaryMessage !== undefined),
			PrimaryFailure: Scenario.PrimaryFailure,
			PrimaryMessage: Scenario.PrimaryMessage,
			CleanupActive: (vecCleanupAttempts.length > 0) && (Scenario.CleanupMode !== "NONE"),
			CleanupFailure,
			CleanupMessage: (Scenario.CleanupMode === "FALSE") ? Scenario.CleanupMessage : undefined,
		});
		g_Assert.equal(ForeignDelay.Running, true, "An example must not dispose foreign work through global scheduler cleanup.");
		g_Assert.equal(unForeignCalls, 0);
		g_Assert.ok(vecCapturedDelays.every(Delay => !Delay.Running), "Every acquired example delay must be released before fixture teardown.");
		g_Assert.deepEqual(g_mapRootCallbacks, mapBefore, "Only the exact example raw callback may be removed.");

		if (Scenario.Kind === "RAW") {
			g_Assert.equal(unEmitCount, Scenario.Phase.startsWith("REGISTER_") ? 0 : 1);
			g_Assert.equal(vecCleanupAttempts.length, Scenario.Phase.startsWith("REGISTER_") ? 0 : 1, "A rejected registration owns no callback to remove.");
		}
	} finally {
		for (const Callback of vecRegisteredCallbacks) {
			TickModule.UnregisterTickListener(Callback);
		}

		for (const Delay of [...vecCapturedDelays, ForeignDelay]) {
			TickModule.TickDelay.prototype.DisposeTickDelay.call(Delay);
		}

		TickModule.DisposeTickListeners();
	}

	g_Assert.equal(g_mapRootCallbacks.size, 0);
}

function CheckTickDocumentationResources(TickModule, vecExamples) {
	const vecPrimaryCases = [
		{ PrimaryActive: false },
		...[new Error("Controlled tick operation failed."), null, undefined, 0].map(PrimaryFailure => ({ PrimaryActive: true, PrimaryFailure })),
	];
	const vecModes = ["NONE", "THROW", "FALSE"];
	let unCaseCount = 0;
	const RunScenario = (strSource, Scenario) => {
		RunTickDocumentationResourceScenario(TickModule, strSource, Scenario);
		++unCaseCount;
	};

	for (const strMarker of ["const g_TickCallback =", "const g_RunRawTickDiagnostic ="]) {
		const strSource = FindTickDocumentation(vecExamples, strMarker);
		for (const PrimaryCase of vecPrimaryCases) {
			for (const strMode of vecModes) {
				RunScenario(strSource, { Kind: "RAW", Phase: "EMIT", CleanupMode: strMode, CleanupMessage: "Could not remove the raw tick callback.", ...PrimaryCase });
			}
		}

		RunScenario(strSource, { Kind: "RAW", Phase: "REGISTER_FALSE", CleanupMode: "NONE", PrimaryMessage: "Could not register the raw tick callback." });

		for (const PrimaryCase of vecPrimaryCases.filter(Case => Case.PrimaryActive)) {
			RunScenario(strSource, { Kind: "RAW", Phase: "REGISTER_THROW", CleanupMode: "NONE", ...PrimaryCase });
		}
	}

	for (const Scenario of [
		{ Kind: "WELCOME", Marker: "const g_WelcomeTickDelay =", CleanupMessage: "Welcome tick delay cleanup failed." },
		{ Kind: "PENDING", Marker: "const g_RunPendingRestartInspection =", CleanupMessage: "Pending restart cancellation failed." },
	]) {
		const strSource = FindTickDocumentation(vecExamples, Scenario.Marker);
		for (const PrimaryCase of vecPrimaryCases) {
			for (const strMode of vecModes) {
				RunScenario(strSource, { ...Scenario, ...PrimaryCase, Phase: "LOG_FIRST", CleanupMode: strMode });
			}
		}
	}

	const strComparison = FindTickDocumentation(vecExamples, "const g_CompareTickDelayExecution =");
	RunScenario(strComparison, { Kind: "COMPARE", Phase: "NORMAL", CleanupMode: "NONE" });

	for (const PrimaryCase of vecPrimaryCases.filter(Case => Case.PrimaryActive)) {
		for (const strPhase of ["DIRECT", "LOG_FIRST"]) {
			for (const strMode of vecModes) {
				RunScenario(strComparison, { Kind: "COMPARE", Phase: strPhase, CleanupMode: strMode, CleanupMessage: "Tick delay comparison cleanup failed.", ...PrimaryCase });
			}
		}

		for (const strPhase of ["CONSTRUCT_SECOND", "INVOKE", "LOG_SECOND"]) {
			RunScenario(strComparison, { Kind: "COMPARE", Phase: strPhase, CleanupMode: "NONE", ...PrimaryCase });
		}
	}

	for (const strMode of vecModes) {
		RunScenario(strComparison, { Kind: "COMPARE", Phase: "INVALID_DIRECT", CleanupMode: strMode, PrimaryMessage: "ExecuteTickDelayCallback() did not preserve the queued operation.", CleanupMessage: "Tick delay comparison cleanup failed." });
	}

	const strWelcome = FindTickDocumentation(vecExamples, "const g_WelcomeTickDelay =");
	RunScenario(strWelcome, { Kind: "WELCOME", Phase: "NO_PLAYERS", CleanupMode: "NONE", PrimaryMessage: "Welcome-delay example requires a connected player." });

	for (const PrimaryCase of vecPrimaryCases.filter(Case => Case.PrimaryActive)) {
		RunScenario(strWelcome, { Kind: "WELCOME", Phase: "PLAYERS_QUERY", CleanupMode: "NONE", ...PrimaryCase });
	}

	g_Assert.equal(unCaseCount, 115);
}

async function RunTickDocumentationPromiseScenario(TickModule, strSource, Scenario) {
	g_Assert.equal(g_mapRootCallbacks.size, 0);

	const ForeignDelay = new TickModule.TickDelay(60, () => undefined);
	const vecTasks = [];
	const vecWarningMessages = [];
	const unExceptionCount = g_vecExceptionRecords.length;
	let unWarningCount = 0;

	function CreateControlledGameThreadTask(...vecArguments) {
		const Task = new TickModule.GameThreadTask(...vecArguments);
		vecTasks.push(Task);

		return Task;
	}

	const PlayerRecord = { Index: 1, UserID: 42, Name: "FixturePlayer" };
	const mapModules = new Map([
		["listeners/tick", { ...TickModule, GameThreadTask: CreateControlledGameThreadTask }],
		["filters/players", { GetAllPlayers: () => [PlayerRecord] }],
		["players/entity", {
			Player() {
				if ((Scenario.Phase === "LOOKUP") || (Scenario.Phase === "COERCE_LOOKUP")) {
					throw Scenario.PrimaryFailure;
				}

				return PlayerRecord;
			},
		}],
		["core/logger", {
			LogInfo() {
				if (Scenario.Phase === "RESOLVE_LOG") {
					throw Scenario.PrimaryFailure;
				}
			},

			LogWarning(strMessage) {
				++unWarningCount;
				vecWarningMessages.push(strMessage);

				if (Scenario.ReportingActive) {
					throw Scenario.SecondaryFailure;
				}
			},
		}],
	]);
	const Exports = { exports: {} };
	let ObservedFailure = undefined;
	let bThrew = false;

	try {
		EvaluateTickDocumentation(strSource, mapModules, Exports);
		g_Assert.equal(typeof Exports.exports.RunPlayerLookupTask, "function");

		try {
			const TaskPromise = Exports.exports.RunPlayerLookupTask();
			g_Assert.equal(typeof TaskPromise?.then, "function", "The caller must receive the complete task/handler Promise chain.");
			await TaskPromise;
		} catch (Failure) {
			ObservedFailure = Failure;
			bThrew = true;
		}

		CheckTickDocumentationFailure(ObservedFailure, bThrew, { PrimaryActive: Boolean(Scenario.SecondaryActive), PrimaryFailure: Scenario.PrimaryFailure, CleanupActive: Boolean(Scenario.SecondaryActive), CleanupFailure: Scenario.SecondaryFailure });
		g_Assert.equal(vecTasks.length, 1);
		g_Assert.equal(vecTasks[0].Running, false);
		g_Assert.equal(vecTasks[0].Identifier, 1);
		g_Assert.equal(ForeignDelay.Running, true);
		g_Assert.equal(unWarningCount, ["NORMAL", "COERCE_LOOKUP"].includes(Scenario.Phase) ? 0 : 1);

		if (unWarningCount > 0) {
			g_Assert.equal(vecWarningMessages[0], `Player lookup failed: ${String(Scenario.PrimaryFailure)}`);
		}

		const bLookupFailure = ["LOOKUP", "COERCE_LOOKUP"].includes(Scenario.Phase);
		g_Assert.equal(g_vecExceptionRecords.length - unExceptionCount, bLookupFailure ? 1 : 0);

		if (bLookupFailure) {
			g_Assert.equal(g_vecExceptionRecords.at(-1).Error, Scenario.PrimaryFailure);
			g_Assert.equal(g_vecExceptionRecords.at(-1).Source, "game-thread");
		}
	} finally {
		for (const Task of vecTasks) {
			try {
				await Task.JoinGameThreadTask();
			} catch {
				// The scenario already checked this task's rejection or a deliberate regression exposed it.
			}
		}

		ForeignDelay.DisposeTickDelay();
		TickModule.DisposeTickListeners();
		g_vecExceptionRecords.splice(unExceptionCount);
	}

	g_Assert.equal(g_mapRootCallbacks.size, 0);
}

async function CheckTickDocumentationPromises(TickModule, vecExamples) {
	const strSource = FindTickDocumentation(vecExamples, "const g_RunPlayerLookupTask =");
	const vecFailures = [new Error("Controlled lookup or logging failed."), null, undefined, 0];
	let unCaseCount = 0;
	const RunScenario = async Scenario => {
		await RunTickDocumentationPromiseScenario(TickModule, strSource, Scenario);
		++unCaseCount;
	};

	await RunScenario({ Phase: "NORMAL" });

	for (const strPhase of ["LOOKUP", "RESOLVE_LOG"]) {
		for (const PrimaryFailure of vecFailures) {
			await RunScenario({ Phase: strPhase, PrimaryFailure });

			for (const SecondaryFailure of vecFailures) {
				await RunScenario({ Phase: strPhase, PrimaryFailure, SecondaryFailure, ReportingActive: true, SecondaryActive: true });
			}
		}
	}

	const FormattingFailure = new Error("Controlled failure formatting failed.");
	const PrimaryFailure = {
		toString() {
			throw FormattingFailure;
		},
	};
	await RunScenario({ Phase: "COERCE_LOOKUP", PrimaryFailure, SecondaryFailure: FormattingFailure, SecondaryActive: true });
	g_Assert.equal(unCaseCount, 42);
}

function RunRepeatingTickDocumentationScenario(TickModule, strSource, Scenario) {
	g_Assert.equal(g_mapRootCallbacks.size, 0);

	const ForeignDelay = (Scenario.Kind === "TEARDOWN") ? null : new TickModule.TickDelay(60, () => undefined);
	const mapBefore = new Map([...g_mapRootCallbacks].map(([strName, vecCallbacks]) => [strName, [...vecCallbacks]]));
	const vecTasks = [];
	const vecDelays = [];
	const vecCleanupFailures = [];
	let bPrimaryInjected = false;
	let unDelayCount = 0;
	let unLogCount = 0;
	let unDetachCount = 0;
	const FailOperation = strPhase => {
		if (Scenario.PrimaryActive && !bPrimaryInjected && (strPhase === Scenario.Phase)) {
			bPrimaryInjected = true;
			throw Scenario.PrimaryFailure;
		}
	};

	const RunCleanup = (Owner, Cleanup, strMessage) => {
		// These faults report after the genuine JS controller commits release; not native-failure recovery.
		const bReleased = Reflect.apply(Cleanup, Owner, []);
		if (Scenario.CleanupMode === "THROW") {
			const Failure = new Error("Controlled repeating example cleanup failed.");
			vecCleanupFailures.push({ Failure });
			throw Failure;
		}

		if (Scenario.CleanupMode === "FALSE") {
			vecCleanupFailures.push({ Message: strMessage });
			return false;
		}

		return bReleased;
	};

	const CaptureDelay = Delay => {
		vecDelays.push(Delay);
		const Dispose = Delay.DisposeTickDelay;
		const strMessage = (Scenario.Kind === "CONTROLLED") ? "Manual tick delay cleanup failed." : (Scenario.Kind === "TEARDOWN") ? "Owned tick delay cleanup failed; scheduler remains attached." : "Level example tick delay cleanup failed.";
		Delay.DisposeTickDelay = () => RunCleanup(Delay, Dispose, strMessage);

		return Delay;
	};

	function CreateControlledDelay(...vecArguments) {
		++unDelayCount;

		if (unDelayCount === 2) {
			FailOperation("DELAY_SECOND");
		}

		return CaptureDelay(new TickModule.TickDelay(...vecArguments));
	}

	function CreateControlledTask(...vecArguments) {
		FailOperation("REPEAT_CONSTRUCT");

		const Task = new TickModule.RepeatingTickTask(...vecArguments);
		vecTasks.push(Task);

		for (const strMethod of [
			"StartRepeatingTickTask",
			"PauseRepeatingTickTask",
			"ResumeRepeatingTickTask",
			"RestartRepeatingTickTask",
			"ExtendRepeatingTickTask",
			"ReduceRepeatingTickTask",
			"InvokeRepeatingTickTaskCallback",
		]) {
			const Original = Task[strMethod];
			Task[strMethod] = function RunControlledMethod(...vecValues) {
				const Result = Reflect.apply(Original, this, vecValues);
				FailOperation(strMethod);

				return Result;
			};
		}

		const CreateDelay = Task.CreateRepeatingTickTaskDelay;
		Task.CreateRepeatingTickTaskDelay = function CreateControlledRepeatingDelay(flSeconds) {
			if (flSeconds === 0) {
				FailOperation("CREATE_MANUAL");
				return CaptureDelay(Reflect.apply(CreateDelay, this, [flSeconds]));
			}

			return Reflect.apply(CreateDelay, this, [flSeconds]);
		};

		const Dispose = Task.DisposeRepeatingTickTask;
		const Stop = Task.StopRepeatingTickTask;
		const strMessage = {
			COUNTDOWN: "Countdown cleanup failed.",
			HEARTBEAT: "Heartbeat cleanup failed.",
			VOTE: "Vote-poll stop failed.",
			CONTROLLED: "Controlled repeating tick task cleanup failed.",
			LEVEL: "Map repeating tick task cleanup failed.",
		}[Scenario.Kind];
		Task.DisposeRepeatingTickTask = () => RunCleanup(Task, Dispose, strMessage);

		if (Scenario.Kind === "VOTE") {
			Task.StopRepeatingTickTask = () => RunCleanup(Task, Stop, strMessage);
		}

		return Task;
	}

	const TickFacade = {
		...TickModule,
		TickDelay: CreateControlledDelay,
		RepeatingTickTask: CreateControlledTask,
		EmitTickEvent(...vecArguments) {
			FailOperation("EMIT");

			return TickModule.EmitTickEvent(...vecArguments);
		},

		CancelScheduledTickTasksOnLevelEnd() {
			FailOperation("LEVEL");

			return TickModule.CancelScheduledTickTasksOnLevelEnd();
		},

		DisposeTickListeners() {
			++unDetachCount;

			return TickModule.DisposeTickListeners();
		},
	};
	const mapModules = new Map([
		["listeners/tick", TickFacade],
		["core/logger", {
			LogInfo() {
				FailOperation("LOG_" + ++unLogCount);
			},
		}],
	]);
	const Exports = { exports: {} };
	let ObservedFailure = undefined;
	let bThrew = false;

	try {
		try {
			EvaluateTickDocumentation(strSource, mapModules, Exports);
			Exports.exports.UnloadPlugin?.();
		} catch (Failure) {
			ObservedFailure = Failure;
			bThrew = true;
		}

		g_Assert.equal(bPrimaryInjected, Scenario.PrimaryActive);
		const vecExpected = [...(bPrimaryInjected ? [{ Failure: Scenario.PrimaryFailure }] : []), ...vecCleanupFailures];
		g_Assert.equal(bThrew, vecExpected.length > 0);
		let vecObserved = bThrew ? [ObservedFailure] : [];
		if (vecExpected.length > 1) {
			g_Assert.equal(ObservedFailure?.name, "AggregateError");
			g_Assert.ok(Array.isArray(ObservedFailure.errors));
			vecObserved = Array.from(ObservedFailure.errors);
		}

		g_Assert.equal(vecObserved.length, vecExpected.length);

		for (const [unIndex, Expected] of vecExpected.entries()) {
			if (Object.hasOwn(Expected, "Message")) {
				g_Assert.equal(vecObserved[unIndex]?.name, "Error");
				g_Assert.equal(vecObserved[unIndex].message, Expected.Message);

			} else {
				g_Assert.equal(vecObserved[unIndex], Expected.Failure);
			}
		}

		g_Assert.ok(vecTasks.every(Task => Task.RepeatingTickTaskStatus === TickModule.RepeatingTickTaskStatus.STOPPED), "Release every acquired task, including a paused task, before fixture teardown.");
		g_Assert.ok(vecDelays.every(Delay => !Delay.Running), "Release every acquired or manually scheduled delay before fixture teardown.");

		if (ForeignDelay !== null) {
			g_Assert.equal(ForeignDelay.Running, true);
			g_Assert.deepEqual(g_mapRootCallbacks, mapBefore, "Feature examples must preserve shared scheduler bridges.");
			g_Assert.equal(unDetachCount, 0);

		} else {
			g_Assert.equal(unDetachCount, (Scenario.CleanupMode === "NONE") ? 1 : 0, "Failed owner cleanup must not detach shared scheduler bridges.");
			g_Assert.equal(g_mapRootCallbacks.size, (unDetachCount === 0) ? 2 : 0);
		}
	} finally {
		for (const Task of vecTasks) {
			TickModule.RepeatingTickTask.prototype.StopRepeatingTickTask.call(Task);
		}

		for (const Delay of [...vecDelays, ForeignDelay]) {
			if (Delay !== null) {
				TickModule.TickDelay.prototype.DisposeTickDelay.call(Delay);
			}
		}

		TickModule.DisposeTickListeners();
	}

	g_Assert.equal(g_mapRootCallbacks.size, 0);
}

function CheckRepeatingTickDocumentation(TickModule, vecExamples) {
	const vecCases = [
		{ Kind: "COUNTDOWN", Marker: "const g_CountdownState =", Phases: ["LOG_1", "StartRepeatingTickTask"] },
		{ Kind: "HEARTBEAT", Marker: "const g_HeartbeatRepeatingTickTask =", Phases: ["StartRepeatingTickTask", "PauseRepeatingTickTask", "LOG_1", "ResumeRepeatingTickTask", "RestartRepeatingTickTask"] },
		{ Kind: "VOTE", Marker: "const g_VotePollRepeatingTickTask =", Phases: ["StartRepeatingTickTask", "ExtendRepeatingTickTask", "ReduceRepeatingTickTask", "LOG_1", "LOG_2"] },
		{ Kind: "CONTROLLED", Marker: "const g_ControlledRepeatingTickTask =", Phases: ["StartRepeatingTickTask", "InvokeRepeatingTickTaskCallback", "CREATE_MANUAL", "EMIT", "LOG_1"] },
		{ Kind: "LEVEL", Marker: "const g_PersistentTickDelay =", Phases: ["DELAY_SECOND", "REPEAT_CONSTRUCT", "StartRepeatingTickTask", "PauseRepeatingTickTask", "LEVEL"] },
		{ Kind: "TEARDOWN", Marker: "const g_OwnedTickDelay =", Phases: [] },
	];
	let unCaseCount = 0;
	for (const Case of vecCases) {
		const strSource = FindTickDocumentation(vecExamples, Case.Marker);
		for (const strMode of ["NONE", "THROW", "FALSE"]) {
			RunRepeatingTickDocumentationScenario(TickModule, strSource, { ...Case, PrimaryActive: false, CleanupMode: strMode });
			++unCaseCount;

			for (const strPhase of Case.Phases) {
				for (const PrimaryFailure of [new Error("Controlled repeating operation failed."), null, undefined, 0]) {
					RunRepeatingTickDocumentationScenario(TickModule, strSource, { ...Case, Phase: strPhase, PrimaryActive: true, PrimaryFailure, CleanupMode: strMode });
					++unCaseCount;
				}
			}
		}
	}

	g_Assert.equal(unCaseCount, 282);
}

async function CheckDocumentationExamples(TickModule, strDocumentation) {
	const vecExamples = [...strDocumentation.matchAll(/```js\r?\n([\s\S]*?)\r?\n```/g)];
	g_Assert.equal(vecExamples.length, 13, "tick documentation must contain thirteen executable examples");
	CheckTickDocumentationResources(TickModule, vecExamples.map(vecMatch => vecMatch[1]));
	await CheckTickDocumentationPromises(TickModule, vecExamples.map(vecMatch => vecMatch[1]));
	CheckRepeatingTickDocumentation(TickModule, vecExamples.map(vecMatch => vecMatch[1]));

	const PlayerRecord = {
		Index: 1,
		UserID: 42,
		Name: "FixturePlayer",
		Connected: true,
		Say: () => true,
	};
	const mapModules = new Map([
		["listeners/tick", TickModule],
		["core/logger", { LogInfo: () => undefined, LogWarning: () => undefined }],
		["filters/players", { GetAllPlayers: () => [PlayerRecord] }],
		["players/entity", { Player: unPlayerIndex => (unPlayerIndex === PlayerRecord.Index) ? PlayerRecord : null }],
	]);

	for (const vecExampleMatch of vecExamples) {
		const Exports = { exports: {} };
		try {
			EvaluateTickDocumentation(vecExampleMatch[1], mapModules, Exports);

			if (typeof Exports.exports.RunPlayerLookupTask === "function") {
				await Exports.exports.RunPlayerLookupTask();
			}

			for (let unFrame = 0; unFrame < 3; ++unFrame) {
				g_nNowMilliseconds += 1_000;
				TickModule.EmitTickEvent();
			}

			for (let unCheckpoint = 0; unCheckpoint < 12; ++unCheckpoint) {
				await Promise.resolve();
			}
		} finally {
			Exports.exports.UnloadPlugin?.();
			TickModule.CancelScheduledTickTasksOnLevelEnd();
			TickModule.DisposeTickListeners();
		}

		g_Assert.equal(g_mapRootCallbacks.size, 0, "each documentation example must release its callbacks");
	}
}

function CheckRawTickPayloadContract(TickModule) {
	const strNativeSource = g_FileSystem.readFileSync(g_Path.join(g_strRootPath, "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8");
	const nConverterStart = strNativeSource.indexOf("bool ConvertEventPayload(");
	const nConverterEnd = strNativeSource.indexOf("void EmitRuntimeEventCallback(", nConverterStart);
	g_Assert.ok((nConverterStart >= 0) && (nConverterEnd > nConverterStart));
	const strConverter = strNativeSource.slice(nConverterStart, nConverterEnd);
	g_Assert.match(strConverter, /CallbackInformation\.Length\(\) <= nPayloadArgumentIndex/);
	g_Assert.match(strConverter, /CallbackInformation\[nPayloadArgumentIndex\]->ToString\(LocalContext\)/);
	g_Assert.doesNotMatch(strConverter, /IsUndefined\(|IsNull\(/);
	g_Assert.strictEqual(TickModule.EmitTickEvent, g_NativeTick.Emit);

	const vecRawTickArguments = [];
	const RecordRawTick = (...vecArguments) => vecRawTickArguments.push(vecArguments);
	g_Assert.equal(TickModule.RegisterTickListener(RecordRawTick), true);
	try {
		const HintedPayload = {
			[Symbol.toPrimitive](strHint) {
				g_Assert.equal(strHint, "string");

				return "hinted";
			},
		};
		const vecCases = [
			{ Arguments: [], Expected: "" },
			{ Arguments: [undefined], Expected: "undefined" },
			{ Arguments: [null], Expected: "null" },
			{ Arguments: [""], Expected: "" },
			{ Arguments: [0], Expected: "0" },
			{ Arguments: [false], Expected: "false" },
			{ Arguments: [12n], Expected: "12" },
			{ Arguments: [HintedPayload], Expected: "hinted" },
		];
		for (const Case of vecCases) {
			g_Assert.equal(TickModule.EmitTickEvent(...Case.Arguments), undefined);
			g_Assert.deepEqual(vecRawTickArguments.at(-1), ["Tick", Case.Expected]);
		}

		g_Assert.equal(vecRawTickArguments.length, vecCases.length);
		for (const Failure of [new Error("Tick payload conversion failed."), undefined, null, false, 0, ""]) {
			const FailurePayload = {
				toString() {
					throw Failure;
				},
			};
			g_Assert.throws(() => TickModule.EmitTickEvent(FailurePayload), ErrorValue => Object.is(ErrorValue, Failure));
		}

		for (const SymbolValue of [Symbol("TickPayload"), Object(Symbol("TickPayload"))]) {
			g_Assert.throws(() => TickModule.EmitTickEvent(SymbolValue), TypeError);
		}

		g_Assert.equal(vecRawTickArguments.length, vecCases.length, "Failed payload conversion must not emit a tick");
	} finally {
		g_Assert.equal(TickModule.UnregisterTickListener(RecordRawTick), true);
	}
}

async function RunSmoke() {
	const RestoreEnvironment = InstallTestEnvironment();
	let TickModule = null;

	try {
		TickModule = LoadTickModule();
		CheckMonotonicTickClocks(TickModule);
		CheckRawTickPayloadContract(TickModule);
		g_Assert.deepEqual(Object.keys(TickModule).sort(), [
			"CancelScheduledTickTasksOnLevelEnd",
			"DisposeTickListeners",
			"EmitTickEvent",
			"GameThreadTask",
			"RegisterTickListener",
			"RepeatingTickTask",
			"RepeatingTickTaskStatus",
			"TickDelay",
			"UnregisterTickListener",
		].sort());
		g_Assert.deepEqual(TickModule.RepeatingTickTaskStatus, { STOPPED: 1, RUNNING: 2, PAUSED: 3 });
		g_Assert.equal(typeof TickModule.RegisterTickListener, "function");
		g_Assert.equal(typeof TickModule.UnregisterTickListener, "function");
		g_Assert.strictEqual(TickModule.RegisterTickListener, g_NativeTick.AddListener);
		g_Assert.strictEqual(TickModule.UnregisterTickListener, g_NativeTick.RemoveListener);

		const vecRawTickArguments = [];
		const RecordRawTick = (...vecArguments) => {
			vecRawTickArguments.push(vecArguments);
		};
		g_Assert.equal(TickModule.RegisterTickListener(RecordRawTick), true);
		g_Assert.equal(TickModule.RegisterTickListener(RecordRawTick), true);
		g_Assert.equal(TickModule.EmitTickEvent("raw tick"), undefined);
		g_Assert.deepEqual(vecRawTickArguments, [["Tick", "raw tick"], ["Tick", "raw tick"]]);
		g_Assert.equal(TickModule.UnregisterTickListener(RecordRawTick), true);
		g_Assert.equal(TickModule.EmitTickEvent("remaining raw tick"), undefined);
		g_Assert.deepEqual(vecRawTickArguments[2], ["Tick", "remaining raw tick"]);
		g_Assert.equal(TickModule.UnregisterTickListener(RecordRawTick), true);
		g_Assert.equal(TickModule.UnregisterTickListener(RecordRawTick), false);
		g_Assert.equal(g_mapRootCallbacks.size, 0);
		g_Assert.throws(() => TickModule.RegisterTickListener(null), TypeError);
		g_Assert.throws(() => TickModule.UnregisterTickListener(null), TypeError);

		CheckReadOnlyGetters(TickModule.TickDelay, [
			"DelaySeconds",
			"CallbackArguments",
			"CancelOnLevelEnd",
			"StartTimeSeconds",
			"ExecutionTimeSeconds",
			"Callback",
			"RepeatingTickTask",
			"Running",
			"TimeRemainingSeconds",
			"TimeElapsedSeconds",
		]);
		CheckReadOnlyGetters(TickModule.GameThreadTask, ["Name", "Identifier", "Running"]);
		CheckReadOnlyGetters(TickModule.RepeatingTickTask, [
			"Callback",
			"CallbackArguments",
			"CancelOnLevelEnd",
			"StoredIntervalSeconds",
			"StoredOriginalLoopCount",
			"InitialLoopCount",
			"ElapsedLoopCount",
			"StoredLoopCountAdjustment",
			"StoredRepeatingTickTaskStatus",
			"CurrentTickDelay",
			"PausedDelaySeconds",
			"OriginalStartTimeSeconds",
			"IntervalSeconds",
			"AdjustedLoopCount",
			"LoopsRemaining",
			"LoopsElapsed",
			"TotalLoopCount",
			"OriginalLoopCount",
			"TotalTimeRemainingSeconds",
			"TotalTimeElapsedSeconds",
			"TotalTimeSeconds",
			"CurrentDelayTimeRemainingSeconds",
			"CurrentDelayTimeElapsedSeconds",
			"RepeatingTickTaskStatus",
		]);

		let unDelayCalls = 0;
		const RecordDelayExecution = () => ++unDelayCalls;
		g_strRejectedRootEvent = "Tick";
		g_Assert.throws(() => new TickModule.TickDelay(0, RecordDelayExecution), /Tick scheduler bridge registration was rejected/);
		g_Assert.equal(g_mapRootCallbacks.size, 0);
		g_Assert.equal(unDelayCalls, 0);

		g_strRejectedRootEvent = "LevelEnd";
		g_Assert.throws(() => new TickModule.TickDelay(0, RecordDelayExecution), /LevelEnd scheduler bridge registration was rejected/);
		g_Assert.equal(g_mapRootCallbacks.size, 0, "a rejected LevelEnd bridge must roll back the registered Tick bridge");
		g_Assert.equal(unDelayCalls, 0);

		g_strRejectedRootEvent = "LevelEnd";
		g_strFailedRootRemovalEvent = "Tick";
		g_RootRemovalFailure = new Error("Injected scheduler bridge rollback failure.");
		g_Assert.throws(() => new TickModule.TickDelay(0, RecordDelayExecution), (ErrorValue) => {
			g_Assert.equal(ErrorValue instanceof AggregateError, true);
			g_Assert.equal(ErrorValue.errors.length, 2);
			g_Assert.match(ErrorValue.errors[0].message, /LevelEnd scheduler bridge registration was rejected/);
			g_Assert.strictEqual(ErrorValue.errors[1], g_RootRemovalFailure);

			return true;
		});
		g_Assert.equal(g_mapRootCallbacks.get("Tick").length, 1);
		g_Assert.equal(g_mapRootCallbacks.has("LevelEnd"), false);

		const TickDelay = new TickModule.TickDelay(1, () => ++unDelayCalls);
		g_Assert.equal(g_mapRootCallbacks.size, 2, "failed scheduler setup remains retryable");
		g_Assert.equal(g_mapRootCallbacks.get("Tick").length, 1, "retry reuses an installed bridge after rollback failure");
		g_Assert.equal(TickDelay.Running, true);
		g_Assert.equal(TickDelay.ExecuteTickDelayCallback(), 1);
		g_Assert.equal(TickDelay.Running, true);
		g_Assert.equal(TickDelay.CancelTickDelay(), true);
		g_Assert.equal(TickDelay.DisposeTickDelay(), false);

		g_nNowMilliseconds += 1_000;
		const ExecutedDelay = new TickModule.TickDelay(0, () => ++unDelayCalls);
		TickModule.EmitTickEvent("");
		g_Assert.equal(ExecutedDelay.Running, false);
		g_Assert.equal(unDelayCalls, 2);

		const vecLiveDelayArguments = ["First"];
		const vecLiveDelayResults = [];
		const LiveArgumentDelay = new TickModule.TickDelay(0, Value => vecLiveDelayResults.push(Value), vecLiveDelayArguments);
		g_Assert.strictEqual(LiveArgumentDelay.CallbackArguments, vecLiveDelayArguments);
		vecLiveDelayArguments[0] = "Changed";
		TickModule.EmitTickEvent();
		g_Assert.deepEqual(vecLiveDelayResults, ["Changed"]);
		g_Assert.equal(LiveArgumentDelay.Running, false);
		LiveArgumentDelay.ExecuteTickDelayCallback();
		g_Assert.deepEqual(vecLiveDelayResults, ["Changed", "Changed"], "direct execution is allowed after scheduled completion");
		g_Assert.throws(() => LiveArgumentDelay.InvokeTickDelayCallback(), /not running/);

		const vecSamePassCalls = [];
		new TickModule.TickDelay(0, () => {
			vecSamePassCalls.push("First");
			new TickModule.TickDelay(0, () => vecSamePassCalls.push("Second"));
		});
		TickModule.EmitTickEvent();
		g_Assert.deepEqual(vecSamePassCalls, ["First", "Second"], "zero-delay scheduling can run during the current pass");

		const nTimeBeforeAdjustment = g_nNowMilliseconds;
		const PreviousMonotonicClock = g_GetMonotonicTimeSeconds;
		const flTimeBeforeAdjustment = PreviousMonotonicClock();
		g_GetMonotonicTimeSeconds = () => flTimeBeforeAdjustment;
		const ClockDelay = new TickModule.TickDelay(2, () => undefined);
		const ClockTask = new TickModule.RepeatingTickTask(() => undefined);

		try {
			ClockTask.StartRepeatingTickTask(2, 1);
			g_nNowMilliseconds -= 1_000;
			g_Assert.equal(ClockDelay.TimeElapsedSeconds, 0);
			g_Assert.equal(ClockDelay.TimeRemainingSeconds, 2);
			g_Assert.equal(ClockTask.TotalTimeElapsedSeconds, 0);
		} finally {
			ClockDelay.DisposeTickDelay();
			ClockTask.StopRepeatingTickTask();
			g_nNowMilliseconds = nTimeBeforeAdjustment;
			g_GetMonotonicTimeSeconds = PreviousMonotonicClock;
		}

		let unLoopCalls = 0;
		const RepeatingTickTask = new TickModule.RepeatingTickTask(() => ++unLoopCalls);
		g_Assert.equal(RepeatingTickTask.StartRepeatingTickTask(1, 2), true);
		g_nNowMilliseconds += 1_000;
		TickModule.EmitTickEvent("");
		g_nNowMilliseconds += 1_000;
		TickModule.EmitTickEvent("");
		g_Assert.equal(unLoopCalls, 2);
		g_Assert.equal(RepeatingTickTask.RepeatingTickTaskStatus, TickModule.RepeatingTickTaskStatus.STOPPED);

		const ZeroLimitTask = new TickModule.RepeatingTickTask(() => ++unLoopCalls, [], true);
		g_Assert.equal(ZeroLimitTask.StartRepeatingTickTask(1), true);
		g_Assert.equal(ZeroLimitTask.PauseRepeatingTickTask(), true);
		const StopZeroLimitTask = ZeroLimitTask.StopRepeatingTickTask.bind(ZeroLimitTask);
		let unZeroLimitStopCalls = 0;
		ZeroLimitTask.StopRepeatingTickTask = () => {
			unZeroLimitStopCalls += 1;

			return StopZeroLimitTask();
		};
		g_Assert.equal(ZeroLimitTask.StartRepeatingTickTask(1, 0), true);
		g_Assert.equal(ZeroLimitTask.RepeatingTickTaskStatus, TickModule.RepeatingTickTaskStatus.STOPPED);
		TickModule.CancelScheduledTickTasksOnLevelEnd();
		g_Assert.equal(unZeroLimitStopCalls, 0, "a zero-limit restart must remove a paused task from the active-task registry");
		g_Assert.equal(unLoopCalls, 2);

		let unTaskValue = 0;
		const GameThreadTask = new TickModule.GameThreadTask(
			(unValue) => {
				unTaskValue = unValue;
			},
			{ Name: "smoke" });
		g_Assert.equal(GameThreadTask.StartGameThreadTask(7), GameThreadTask);
		g_Assert.equal(GameThreadTask.Running, true);
		await GameThreadTask.JoinGameThreadTask();
		g_Assert.equal(unTaskValue, 7);
		g_Assert.equal(GameThreadTask.IsGameThreadTaskAlive(), false);

		g_strFailedRootRemovalEvent = "LevelEnd";
		g_RootRemovalFailure = new Error("Injected scheduler bridge disposal failure.");
		g_Assert.throws(() => TickModule.DisposeTickListeners(), (ErrorValue) => ErrorValue === g_RootRemovalFailure);
		g_Assert.equal(g_mapRootCallbacks.has("Tick"), false);
		g_Assert.equal(g_mapRootCallbacks.has("LevelEnd"), true);
		g_Assert.equal(TickModule.DisposeTickListeners(), true);
		g_Assert.equal(TickModule.DisposeTickListeners(), false);
		g_Assert.equal(g_mapRootCallbacks.size, 0);

		const MissingBridgeDelay = new TickModule.TickDelay(1, RecordDelayExecution);
		g_Assert.equal(MissingBridgeDelay.CancelTickDelay(), true);
		g_mapRootCallbacks.delete("Tick");
		g_Assert.throws(() => TickModule.DisposeTickListeners(), /Tick scheduler bridge could not be disposed/);
		g_Assert.equal(TickModule.DisposeTickListeners(), true, "retry disposes the remaining bridge after an absent Tick registration");
		g_Assert.equal(TickModule.DisposeTickListeners(), false);
		g_Assert.equal(g_mapRootCallbacks.size, 0);

		CheckRepeatingLoopPrecision(TickModule);
		CheckRepeatingRescheduleFailure(TickModule);
		await CheckRepeatingStartFailure(TickModule);
		await CheckGameThreadTaskContract(TickModule);

		const strDocumentation = g_FileSystem.readFileSync(g_Path.join(g_strRootPath, "docs", "api", "listeners-tick.md"), "utf8");
		for (const strCanonicalName of [
			"TickDelay",
			"GameThreadTask",
			"RepeatingTickTask",
			"RepeatingTickTaskStatus",
			"CancelScheduledTickTasksOnLevelEnd",
			"DisposeTickListeners",
		]) {
			g_Assert.equal(strDocumentation.includes(`\`${strCanonicalName}\``), true);
		}

		await CheckDocumentationExamples(TickModule, strDocumentation);

		g_Assert.equal(strDocumentation.includes("new Delay"), false);
		g_Assert.equal(strDocumentation.includes("class Repeat"), false);
		g_Assert.equal(g_vecExceptionRecords.length, 0);
	} finally {
		g_strRejectedRootEvent = null;
		g_strFailedRootRemovalEvent = null;
		g_RootRemovalFailure = null;

		try {
			TickModule?.CancelScheduledTickTasksOnLevelEnd?.();
			TickModule?.DisposeTickListeners?.();
		} finally {
			// This bridge is fixture-only; early failures can leave raw, non-scheduler callbacks here.
			g_mapRootCallbacks.clear();
			RestoreEnvironment();
		}
	}
}

const g_CompletionTimeout = setTimeout(() => {
	console.error("[ FAIL ] listeners tick smoke did not complete before its deadline");
	process.exitCode = 1;
}, g_unCompletionTimeoutMilliseconds);

RunSmoke().then(() => {
	console.log("[  OK  ] listeners tick smoke passed");
}).catch((ErrorValue) => {
	console.error("[ FAIL ] listeners tick smoke failed", ErrorValue);
	process.exitCode = 1;
}).finally(() => {
	clearTimeout(g_CompletionTimeout);
});
