# `require("listeners/tick")`

> AI agents: use the contents and process one bounded chunk at a time. Verify timing, lifecycle, and public getters against the implementation before continuing. Read the timing model before using these controllers for engine state; a Promise-backed task is not a worker thread.

`listeners/tick` provides simulated-frame callbacks and monotonic-time schedulers for one isolated plugin context. It lives in `packages/sourcejs/listeners/tick.js`; the native fixed event channel and steady clock are installed by `src/sourcejs/modules/ModuleBindings.cpp`.

## Contents

- [Timing model](#timing-model)
- [Exports](#exports)
- [Raw tick channel](#raw-tick-channel)
- [`TickDelay`](#tickdelay)
- [`GameThreadTask`](#gamethreadtask)
- [`RepeatingTickTask`](#repeatingticktask)
- [Level changes and cleanup](#level-changes-and-cleanup)
- [Errors and common mistakes](#errors-and-common-mistakes)
- [Related modules](#related-modules)

## Timing model

SourceJS automatically emits the native `Tick` event from VSP `GameFrame` only while all of these conditions are true:

- SourceJS is loaded;
- the application is not paused;
- the engine reports a simulating frame.

No automatic `Tick` is emitted when the application is paused or the engine reports a nonsimulating frame. `TickDelay` and `RepeatingTickTask` measure queued deadlines and durations with the native `GetMonotonicTimeSeconds()` clock, backed by `std::chrono::steady_clock`; their scheduler runs when the managed `Tick` listener is dispatched. This clock advances independently of calendar changes, engine simulation, and task pause state. A five-second delay can become overdue in the main menu and run on the first simulating frame after a map starts. A manual `EmitTickEvent()` also dispatches the scheduler when its bridge is installed; it is not gated by the engine's simulating flag.

The public `StartTimeSeconds`, `ExecutionTimeSeconds`, and `OriginalStartTimeSeconds` getters retain their calendar-seconds contract: they capture `Date.now() / 1000` at construction or start and are not rewritten after a clock adjustment. These labels are not used for dispatch, remaining time, or elapsed durations. The native monotonic clock has an opaque origin, not a Unix epoch; its numeric seconds must not be mixed with calendar timestamps. System-clock adjustments do not advance, postpone, or make the scheduler's elapsed estimates negative. The package requires the matching native steady-clock binding; it does not fall back to `Date.now()` for timeouts.

Each scheduler pass captures the current time once. A delay queued outside dispatch waits for a `Tick`; a zero-delay operation queued inside a callback can execute during the same pass if its deadline does not exceed that captured time. Do not use zero-delay self-rescheduling as a guaranteed next-frame boundary.

Raw/scheduled callback invocations run synchronously in the plugin's V8 context on the game thread. A long callback stalls it. A synchronous throw from a scheduled delay is routed to `EXCEPTION_HOOKS.PrintException(ErrorValue, { Source: "delay" })`; the delay is already removed before invocation. The delay scheduler neither awaits nor attaches rejection handlers to a returned Promise: handle asynchronous failures explicitly.

The first `TickDelay` or started `RepeatingTickTask` lazily registers internal root [`listeners`](listeners.md) callbacks for `Tick` and `LevelEnd`. The registration remains until `DisposeTickListeners()` is called.

Native request completion delivery is separate from this tick scheduler: while the application is loaded and not paused, `GameFrame` processes completed requests before checking its simulating flag. `EmitTickEvent()` is an event dispatch, not a substitute for pumping native request completions.

## Exports

```js
const {
	CancelScheduledTickTasksOnLevelEnd,
	DisposeTickListeners,
	EmitTickEvent,
	GameThreadTask,
	RegisterTickListener,
	RepeatingTickTask,
	RepeatingTickTaskStatus,
	TickDelay,
	UnregisterTickListener,
} = require("listeners/tick");
```

| Export | Signature | Result |
| --- | --- | --- |
| [`TickDelay`](#tickdelay) | `new TickDelay(flDelaySeconds, Callback, vecCallbackArguments = [], bCancelOnLevelEnd = false)` | Scheduled delay. |
| [`GameThreadTask`](#gamethreadtask) | `new GameThreadTask(Callback, GameThreadTaskOptions = {})` | Promise-backed task controller. |
| [`RepeatingTickTask`](#repeatingticktask) | `new RepeatingTickTask(Callback, vecCallbackArguments = [], bCancelOnLevelEnd = false)` | Stopped repeating task. |
| `RepeatingTickTaskStatus` | namespace | Frozen `STOPPED`, `RUNNING`, and `PAUSED` numeric values. |
| `CancelScheduledTickTasksOnLevelEnd` | `CancelScheduledTickTasksOnLevelEnd()` | `undefined`; stops map-scoped tick delays and repeating tick tasks now. |
| `DisposeTickListeners` | `DisposeTickListeners()` | `true` when internal listeners were removed, otherwise `false`. |
| `EmitTickEvent` | `EmitTickEvent(ValuePayload?)` | `undefined`; synchronously emits the fixed native `Tick` channel. |
| `RegisterTickListener` | `RegisterTickListener(Callback)` | Native boolean registration result. |
| `UnregisterTickListener` | `UnregisterTickListener(Callback)` | Native boolean removal result. |

`RepeatingTickTaskStatus` exposes these values:

| Member | Value | Meaning |
| --- | ---: | --- |
| `RepeatingTickTaskStatus.STOPPED` | `1` | No loop delay is active. |
| `RepeatingTickTaskStatus.RUNNING` | `2` | A loop delay is queued. |
| `RepeatingTickTaskStatus.PAUSED` | `3` | Remaining delay is stored for `ResumeRepeatingTickTask()`. |

## Raw tick channel

The package's raw functions are fixed to the `Tick` channel and do not accept an event name. They map to the native `AddListener`, `RemoveListener`, and `Emit` exports from `ModuleBindings.cpp`.

```js
const { EmitTickEvent, RegisterTickListener, UnregisterTickListener } = require("listeners/tick");

const g_TickCallback = (strEventName, strPayload) => {
	console.log(`${strEventName}: ${strPayload}`);
};

if (!RegisterTickListener(g_TickCallback)) {
	throw new Error("Could not register the raw tick callback.");
}

const g_vecRawTickFailures = [];
try {
	EmitTickEvent();
} catch (Failure) {
	g_vecRawTickFailures.push(Failure);
}

try {
	if (!UnregisterTickListener(g_TickCallback)) {
		throw new Error("Could not remove the raw tick callback.");
	}
} catch (CleanupFailure) {
	g_vecRawTickFailures.push(CleanupFailure);
}

if (g_vecRawTickFailures.length === 1) {
	throw g_vecRawTickFailures[0];
}

if (g_vecRawTickFailures.length > 1) {
	throw new AggregateError(g_vecRawTickFailures, "Raw tick dispatch or cleanup failed.");
}
```

A raw callback receives `(strEventName, strPayload)`. `strEventName` is always `"Tick"`; `strPayload` is the native string payload. Automatic game-frame ticks currently carry the serialized listener envelope for an empty argument list. `EmitTickEvent(ValuePayload)` converts its first value to a native string before delivery and is mainly useful for diagnostics and low-level adapters.

Only an omitted raw payload becomes an empty string; explicit `undefined` and `null` become `"undefined"` and `"null"`. Native string conversion of a `Symbol` throws `TypeError`. If converting a supplied value throws, the original JavaScript exception propagates and no event is emitted. A nonthrowing conversion/encoding failure reports `The event payload could not be converted to a native string.` The conversion catch ends before native emission. C++ exceptions at the native callback boundary become callback-specific JavaScript errors, without exposing their original text; this does not recover from invalid native memory or fatal V8 out-of-memory termination.

Always remove the exact function object that was registered:

```js
const { LogInfo } = require("core/logger");
const { EmitTickEvent, RegisterTickListener, UnregisterTickListener } = require("listeners/tick");

const g_RunRawTickDiagnostic = () => {
	function InspectTickEvent(strEventName, strPayload) {
		LogInfo(`${strEventName}: ${strPayload}`);
	}

	if (!RegisterTickListener(InspectTickEvent)) {
		throw new Error("Could not register the raw tick callback.");
	}

	const vecFailures = [];
	try {
		EmitTickEvent(JSON.stringify({ Source: "manual-diagnostic" }));
	} catch (Failure) {
		vecFailures.push(Failure);
	}

	try {
		if (!UnregisterTickListener(InspectTickEvent)) {
			throw new Error("Could not remove the raw tick callback.");
		}
	} catch (CleanupFailure) {
		vecFailures.push(CleanupFailure);
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Raw tick diagnostic or cleanup failed.");
	}
};

g_RunRawTickDiagnostic();
```

Use the managed `RegisterTickListener` export from [`listeners`](listeners.md) for ordinary frame callbacks. The raw channel is lower level and exposes serialized payload text.

## `TickDelay`

### Construction

`new TickDelay(flDelaySeconds, Callback, vecCallbackArguments = [], bCancelOnLevelEnd = false)`

- `flDelaySeconds` must be a non-negative finite number.
- `Callback` must be a function.
- `vecCallbackArguments` must be an array. The same live array is retained.
- `bCancelOnLevelEnd` must be a boolean.

Construction schedules the delay immediately, records an internal monotonic deadline, and captures separate calendar start/deadline labels for the public getters.

Scheduling throws if the native `Tick` or `LevelEnd` bridge cannot be registered. A failed second registration rolls back the first; a rollback failure is combined with the registration error in `AggregateError`. Any bridge left installed is tracked so a retry does not register it twice and `DisposeTickListeners()` can release it. Failed setup does not queue the new delay.

### Read-only getters

| Member | Type | Behavior |
| --- | --- | --- |
| `DelaySeconds` | `number` | Original requested delay. |
| `CallbackArguments` | `Array` | Live positional arguments used on every execution. |
| `CancelOnLevelEnd` | `boolean` | Whether level-end cancellation owns this delay. |
| `StartTimeSeconds` | `number` | Wall-clock start in seconds. |
| `ExecutionTimeSeconds` | `number` | Wall-clock deadline in seconds. |
| `Callback` | `Function` | Exact callback object. |
| [`RepeatingTickTask`](#repeatingticktask) | `RepeatingTickTask \| null` | Owning repeating task for scheduler-created delays; `null` for ordinary delays. |
| `Running` | `boolean` | Whether the delay is still in the scheduler queue. |
| `TimeRemainingSeconds` | `number` | Non-negative monotonic seconds until the queued deadline, or `0` when not queued. |
| `TimeElapsedSeconds` | `number` | Non-negative monotonic age, or `0` when not queued. |

All listed properties are read-only getters. Primitive results are point-in-time values; `CallbackArguments` returns the same mutable array, and `RepeatingTickTask` returns the live owning controller. Do not assign these properties or modify implementation state to reschedule a delay; use its lifecycle methods.

### Methods

| Method | Result | Behavior |
| --- | --- | --- |
| [`InvokeTickDelayCallback()`](#invoketickdelaycallback-versus-executetickdelaycallback) | callback result | Cancels the queued delay, then invokes `Callback`. Throws if the delay is no longer running. |
| `ExecuteTickDelayCallback()` | callback result | Invokes `Callback` directly, even after completion/cancellation, without changing queue membership. Direct throws propagate to the caller. |
| `CancelTickDelay()` | `true` | Removes a running delay. Throws if it is not queued. |
| `DisposeTickDelay()` | `boolean` | Cancels a running delay and returns `true`; returns `false` after completion/cancellation. |

### Delayed player action

Capture stable identifiers, not a live entity object that may be removed before the deadline:

```js
const { TickDelay } = require("listeners/tick");
const { LogInfo } = require("core/logger");
const { GetAllPlayers } = require("filters/players");
const { Player } = require("players/entity");

function WelcomePlayer(unPlayerIndex, nUserID, strMessage) {
	const CurrentPlayer = Player(unPlayerIndex);
	if ((CurrentPlayer === null) || (CurrentPlayer.UserID !== nUserID) || !CurrentPlayer.Connected) {
		return;
	}

	if (!CurrentPlayer.Say(strMessage)) {
		throw new Error(`Failed to greet player #${unPlayerIndex}.`);
	}
}

function CreateWelcomeTickDelay() {
	const vecCurrentPlayers = GetAllPlayers();
	if (vecCurrentPlayers.length === 0) {
		throw new Error("Welcome-delay example requires a connected player.");
	}

	const SelectedPlayer = vecCurrentPlayers[0];

	return new TickDelay(2, WelcomePlayer, [SelectedPlayer.Index, SelectedPlayer.UserID, "Welcome to the server."], true);
}

const g_WelcomeTickDelay = CreateWelcomeTickDelay();
try {
	LogInfo(`Welcome scheduled for ${g_WelcomeTickDelay.ExecutionTimeSeconds}.`);
} catch (Failure) {
	const vecFailures = [Failure];
	try {
		if (g_WelcomeTickDelay.Running && !g_WelcomeTickDelay.DisposeTickDelay()) {
			throw new Error("Welcome tick delay cleanup failed.");
		}
	} catch (CleanupFailure) {
		vecFailures.push(CleanupFailure);
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	throw new AggregateError(vecFailures, "Welcome scheduling or cleanup failed.");
}

function UnloadPlugin() {
	if (g_WelcomeTickDelay.Running && !g_WelcomeTickDelay.DisposeTickDelay()) {
		throw new Error("Welcome tick delay cleanup failed.");
	}
}

module.exports = { UnloadPlugin };
```

`bCancelOnLevelEnd: true` prevents this action from crossing into the next map.

### Inspect and cancel pending work

```js
const { LogInfo } = require("core/logger");
const { TickDelay } = require("listeners/tick");

const g_RunPendingRestartInspection = () => {
	function RestartRound() {
		LogInfo("Restarting the round.");
	}

	const PendingRestartTickDelay = new TickDelay(15, RestartRound, [], true);
	const vecFailures = [];
	try {
		LogInfo(`Restart in ${PendingRestartTickDelay.TimeRemainingSeconds.toFixed(2)} seconds.`);
	} catch (Failure) {
		vecFailures.push(Failure);
	}

	try {
		if (PendingRestartTickDelay.Running && !PendingRestartTickDelay.DisposeTickDelay()) {
			throw new Error("Pending restart cancellation failed.");
		}
	} catch (CleanupFailure) {
		vecFailures.push(CleanupFailure);
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Pending restart inspection or cleanup failed.");
	}
};

g_RunPendingRestartInspection();
```

### `InvokeTickDelayCallback()` versus `ExecuteTickDelayCallback()`

`InvokeTickDelayCallback()` consumes the scheduled operation. `ExecuteTickDelayCallback()` invokes the callback directly and leaves the original deadline queued:

```js
const { TickDelay } = require("listeners/tick");
const { LogInfo } = require("core/logger");

const g_CompareTickDelayExecution = () => {
	let unExecutionCount = 0;

	function CountTickDelayExecution() {
		unExecutionCount += 1;

		return unExecutionCount;
	}

	function GetImmediateTickDelayResult() {
		return "executed-now";
	}

	const QueuedTickDelay = new TickDelay(10, CountTickDelayExecution);
	const vecFailures = [];
	let ImmediateTickDelay = null;

	try {
		const unDirectTickDelayExecutionResult = QueuedTickDelay.ExecuteTickDelayCallback();
		if ((unDirectTickDelayExecutionResult !== 1) || !QueuedTickDelay.Running) {
			throw new Error("ExecuteTickDelayCallback() did not preserve the queued operation.");
		}

		LogInfo(`Direct result ${unDirectTickDelayExecutionResult}; still queued: ${QueuedTickDelay.Running}.`);

		if (!QueuedTickDelay.CancelTickDelay()) {
			throw new Error("Queued delay cancellation failed.");
		}

		ImmediateTickDelay = new TickDelay(10, GetImmediateTickDelayResult);
		const strImmediateTickDelayExecutionResult = ImmediateTickDelay.InvokeTickDelayCallback();
		if ((strImmediateTickDelayExecutionResult !== "executed-now") || ImmediateTickDelay.Running) {
			throw new Error("InvokeTickDelayCallback() did not consume the queued operation.");
		}

		LogInfo(`${strImmediateTickDelayExecutionResult}; still queued: ${ImmediateTickDelay.Running}.`);
	} catch (Failure) {
		vecFailures.push(Failure);
	}

	for (const TickDelayInstance of [ImmediateTickDelay, QueuedTickDelay]) {
		if (TickDelayInstance !== null) {
			try {
				if (TickDelayInstance.Running && !TickDelayInstance.DisposeTickDelay()) {
					throw new Error("Tick delay comparison cleanup failed.");
				}
			} catch (CleanupFailure) {
				vecFailures.push(CleanupFailure);
			}
		}
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	if (vecFailures.length > 1) {
		throw new AggregateError(vecFailures, "Tick delay comparison or cleanup failed.");
	}
};

g_CompareTickDelayExecution();
```

Do not call `ExecuteTickDelayCallback()` manually unless a second scheduled execution is intentional.

## `GameThreadTask`

### Construction

`new GameThreadTask(Callback, GameThreadTaskOptions = {})`

`Callback` must be a function. `GameThreadTaskOptions` must be a non-null object other than an array. Only its own `Name` property is read: a value other than `undefined` must be a non-empty primitive string. Inherited `Name`, an own `Name: undefined`, and other option keys do not supply a name. Without an explicit name, SourceJS retains a truthy `Callback.name` or uses `"GameThreadTask"`; a customized callback name is not coerced, and accessor errors propagate.

`GameThreadTask` is not an operating-system thread. `StartGameThreadTask()` queues its JavaScript callback through `Promise.resolve().then(...)` in the same V8 isolate and game thread. It adopts the callback's returned value/Promise; it does not move JavaScript, filesystem access, or engine calls to a worker.

The request APIs of [CPR](cpr.md), [Redis](redis.md), [SOCI](soci.md), and [socket](socket.md) already use a separate native thread per request. Their required `Options` plus `Callback` contract remains unchanged inside a `GameThreadTask`: requests are asynchronous by default; `{ Blocking: true }` waits for that request on the game thread and still invokes its callback there. Wrapping a blocking request in this class does not make it nonblocking.

Returning a request's ordinary scheduling result does not make `JoinGameThreadTask()` wait for its native completion. To coordinate completion, return a Promise settled by that request's callback. `JoinGameThreadTask()` does not block the game thread; it exposes the JavaScript task Promise.

### Read-only getters

| Member | Type | Behavior |
| --- | --- | --- |
| `Name` | Normally `string` | Explicit string or the retained callback-name value; diagnostic name, not an OS thread name. |
| `Identifier` | `number` | Per-instance start sequence; increments before every start. It is not an OS thread ID. |
| `Running` | `boolean` | `true` from `StartGameThreadTask()` until the current promise settles. |

There is no public `Callback` or `Promise` property on this controller. Use `JoinGameThreadTask()` to obtain the current Promise.

### Methods

| Method | Result | Behavior |
| --- | --- | --- |
| `StartGameThreadTask(...vecCallbackArguments)` | this `GameThreadTask` | Starts one task. Throws while another run is active. |
| `JoinGameThreadTask()` | `Promise` | Exact current task Promise, or an already-resolved Promise yielding `undefined` before the first start. It does not start a task. |
| `IsGameThreadTaskAlive()` | `boolean` | Returns the current `Running` value. |

Callback failures are reported through `EXCEPTION_HOOKS.PrintException()` with `Source: "game-thread"` and the task's `Name` in `ThreadName`; they also reject `JoinGameThreadTask()`.

### Promise-backed task lifecycle

```js
const { GameThreadTask } = require("listeners/tick");
const { GetAllPlayers } = require("filters/players");
const { LogInfo, LogWarning } = require("core/logger");
const { Player } = require("players/entity");

const g_RunPlayerLookupTask = () => {
	async function LookupPlayer(unPlayerIndex, nUserID) {
		await Promise.resolve();

		const CurrentPlayer = Player(unPlayerIndex);
		if ((CurrentPlayer === null) || (CurrentPlayer.UserID !== nUserID)) {
			throw new Error(`Player #${unPlayerIndex} changed during lookup.`);
		}

		return CurrentPlayer.Name;
	}

	const vecCurrentPlayers = GetAllPlayers();
	if (vecCurrentPlayers.length === 0) {
		throw new Error("GameThreadTask player lookup requires a connected player.");
	}

	const SelectedPlayer = vecCurrentPlayers[0];
	const PlayerLookupGameThreadTask = new GameThreadTask(LookupPlayer, { Name: "player-lookup" });

	function HandlePlayerLookupResolved(strPlayerName) {
		LogInfo(`Resolved ${strPlayerName} in task #${PlayerLookupGameThreadTask.Identifier}.`);
	}

	function HandlePlayerLookupRejected(ErrorValue) {
		try {
			LogWarning(`Player lookup failed: ${String(ErrorValue)}`);
		} catch (ReportingFailure) {
			throw new AggregateError([ErrorValue, ReportingFailure], "Player lookup and reporting failed.");
		}
	}

	if (PlayerLookupGameThreadTask.StartGameThreadTask(SelectedPlayer.Index, SelectedPlayer.UserID) !== PlayerLookupGameThreadTask) {
		throw new Error("StartGameThreadTask() did not return the controller.");
	}

	return PlayerLookupGameThreadTask.JoinGameThreadTask().then(HandlePlayerLookupResolved).catch(HandlePlayerLookupRejected);
};

module.exports = { RunPlayerLookupTask: g_RunPlayerLookupTask };
```

Await the exported `RunPlayerLookupTask()` helper from an async caller. Its returned chain handles a failed lookup with `LogWarning`; if reporting also fails, the caller receives both failures in `AggregateError`. Do not discard this Promise. Use this class to coordinate Promise-returning JavaScript work. Native request workers perform network/database operations, not arbitrary JavaScript; a native extension or external worker process is needed for other true parallelism. A Promise obtained for one run remains that run's Promise after a later start.

## `RepeatingTickTask`

### Construction

`new RepeatingTickTask(Callback, vecCallbackArguments = [], bCancelOnLevelEnd = false)`

Construction creates a stopped repeating tick task. `vecCallbackArguments` is retained by reference. Call `StartRepeatingTickTask()` to schedule loops.

### Stored-state getters

| Member | Type | Behavior |
| --- | --- | --- |
| `Callback` | `Function` | Exact loop callback. |
| `CallbackArguments` | `Array` | Live positional callback arguments. |
| `CancelOnLevelEnd` | `boolean` | Stops both running and paused repeating tick tasks at level end. |
| `StoredIntervalSeconds` | `number` | Stored interval used by `IntervalSeconds`. |
| `StoredOriginalLoopCount` | `number` | Original finite loop limit or `Infinity`. |
| `InitialLoopCount` | `number` | Snapshot of the latest initial finite loop limit or `Infinity`; it currently mirrors `StoredOriginalLoopCount`. |
| `ElapsedLoopCount` | `number` | Completed scheduled loop count. |
| `StoredLoopCountAdjustment` | `number` | Net result of `ExtendRepeatingTickTask()` and `ReduceRepeatingTickTask()`. |
| `StoredRepeatingTickTaskStatus` | `RepeatingTickTaskStatus` value | Backing status used by `RepeatingTickTaskStatus`. |
| `CurrentTickDelay` | `TickDelay \| null` | Current scheduler delay while running. |
| `PausedDelaySeconds` | `number` | Remaining delay captured by `PauseRepeatingTickTask()`. |
| `OriginalStartTimeSeconds` | `number` | Most recent wall-clock start in seconds, or `0` before start. |

These are read-only getters over scheduler-owned state, not writable fields. `CallbackArguments` is a live array and `CurrentTickDelay` is a live controller; all numeric/boolean/status outputs are snapshots. Prefer the repeating task's lifecycle methods for control rather than editing its current delay or internal backing state.

### Getters

| Getter | Meaning |
| --- | --- |
| `IntervalSeconds` | Current interval in seconds. |
| `AdjustedLoopCount` | Net loop adjustment. |
| `LoopsRemaining` | `TotalLoopCount - LoopsElapsed`, or `Infinity`. |
| `LoopsElapsed` | Completed scheduled loops. A `bExecuteCallbackOnStart` callback is not counted. |
| `TotalLoopCount` | Original plus adjusted loops, or `Infinity`. |
| `OriginalLoopCount` | Loop limit passed to the most recent `StartRepeatingTickTask()`. |
| `TotalTimeRemainingSeconds` | Estimated queued loop time: `(LoopsRemaining - 1) * IntervalSeconds + CurrentDelayTimeRemainingSeconds`, clamped to zero, or `Infinity`. A paused task does not add `PausedDelaySeconds` to this estimate. |
| `TotalTimeElapsedSeconds` | Non-negative monotonic seconds since the most recent `StartRepeatingTickTask()`, or `0` before start. This continues while paused or stopped, including when the captured calendar start is zero. |
| `TotalTimeSeconds` | `TotalLoopCount * IntervalSeconds`, or `Infinity`. |
| `CurrentDelayTimeRemainingSeconds` | Remaining time on `CurrentTickDelay`, or `0` when paused/stopped. |
| `CurrentDelayTimeElapsedSeconds` | Elapsed time on `CurrentTickDelay`, or `0` when paused/stopped. |
| `RepeatingTickTaskStatus` | Current `RepeatingTickTaskStatus` value. |

### Lifecycle methods

| Method | Result | Behavior |
| --- | --- | --- |
| `StartRepeatingTickTask(flIntervalSeconds, unLoopCountLimit = Infinity, bExecuteCallbackOnStart = false)` | `boolean` | Resets state and schedules a repeating tick task; returns `false` only when already running. A zero limit schedules no loop, enters `STOPPED`, and removes a previously paused task from the active-task registry. |
| `StopRepeatingTickTask()` | `boolean` | Stops running or paused work; returns `false` if already stopped. |
| `RestartRepeatingTickTask()` | `boolean` | Stops and starts with the current interval and current total loop count. |
| `PauseRepeatingTickTask()` | `boolean` | Captures remaining delay and enters `PAUSED`; returns `false` unless running. |
| `ResumeRepeatingTickTask()` | `boolean` | Queues the captured remaining delay; returns `false` unless paused. |
| `ExtendRepeatingTickTask(unLoopCountAdjustment)` | `boolean` | Requires a positive safe-integer adjustment (`TypeError` otherwise). After validation, returns `false` for an infinite task; otherwise adds loops. Throws `RangeError` without mutation if the accumulated adjustment or resulting total would lose integer precision. |
| `ReduceRepeatingTickTask(unLoopCountAdjustment)` | `boolean` | Requires a positive safe-integer adjustment (`TypeError` otherwise). After validation, returns `false` for an infinite task; otherwise subtracts loops and stops when none remain. An accumulated adjustment or resulting total outside safe-integer precision throws `RangeError` without mutation. An overshoot may leave a negative total/remaining count; it is not clamped to zero. |
| `DisposeRepeatingTickTask()` | `boolean` | Delegates to `StopRepeatingTickTask()`. |

When not already running, `StartRepeatingTickTask()` requires a finite non-negative interval, a non-negative safe-integer loop limit or `Infinity`, and a strict boolean start flag. It returns `false` before validating new arguments when already running. A rejected scheduler bridge leaves prior stopped/paused state unchanged, so a valid retry or resume remains possible.

Setting `bExecuteCallbackOnStart` to `true` invokes the callback immediately in addition to the requested scheduled loops, even with a zero limit. It does not increment `LoopsElapsed` or reduce the requested loop limit. An immediate callback throw propagates after scheduling; it does not roll back the active task.

### Advanced methods

| Method | Result | Behavior |
| --- | --- | --- |
| `CreateRepeatingTickTaskDelay(flDelaySeconds)` | `TickDelay` | Creates and queues a delay whose callback invokes `ExecuteRepeatingTickTask()`. It does not install that delay as `CurrentTickDelay`. |
| `InvokeRepeatingTickTaskCallback()` | callback result | Invokes the callback without changing counters or scheduling. |
| `ExecuteRepeatingTickTask()` | callback result | Increments the loop count, schedules the next delay or stops, then invokes the callback. If next-delay scheduling fails, stops/cancels tracked work and propagates the error without invoking that loop's callback; the consumed loop count remains incremented. |

These methods are advanced operations that bypass ordinary lifecycle guards. `CurrentTickDelay` is read-only: a manually created delay cannot be assigned to it. Retain and explicitly dispose each additional delay unless it has already executed. Stopping the parent or level-end cancellation tracks only its current delay, not extra manually created repeating-owned delays; do not retain those extras across a level transition.

### Finite countdown

```js
const { RepeatingTickTask, RepeatingTickTaskStatus } = require("listeners/tick");
const { LogInfo } = require("core/logger");

const g_CountdownState = { Value: 3 };

function UpdateCountdown(State) {
	LogInfo(`Round starts in ${State.Value}.`);
	State.Value -= 1;
}

const g_CountdownRepeatingTickTask = new RepeatingTickTask(UpdateCountdown, [g_CountdownState], true);
try {
	if (!g_CountdownRepeatingTickTask.StartRepeatingTickTask(1, 3, true)) {
		throw new Error("Countdown start failed.");
	}
} catch (Failure) {
	const vecFailures = [Failure];
	try {
		if ((g_CountdownRepeatingTickTask.RepeatingTickTaskStatus !== RepeatingTickTaskStatus.STOPPED) && !g_CountdownRepeatingTickTask.DisposeRepeatingTickTask()) {
			throw new Error("Countdown cleanup failed.");
		}
	} catch (CleanupFailure) {
		vecFailures.push(CleanupFailure);
	}

	if (vecFailures.length === 1) {
		throw vecFailures[0];
	}

	throw new AggregateError(vecFailures, "Countdown start or cleanup failed.");
}

function UnloadPlugin() {
	if ((g_CountdownRepeatingTickTask.RepeatingTickTaskStatus !== RepeatingTickTaskStatus.STOPPED) && !g_CountdownRepeatingTickTask.DisposeRepeatingTickTask()) {
		throw new Error("Countdown cleanup failed.");
	}
}

module.exports = { UnloadPlugin };
```

This emits one immediate message and three scheduled messages. Inspect `g_CountdownRepeatingTickTask.LoopsElapsed` to count only scheduled loops.

### Pause, resume, and restart

```js
const { RepeatingTickTask, RepeatingTickTaskStatus } = require("listeners/tick");
const { LogInfo } = require("core/logger");

function LogHeartbeat() {
	LogInfo("Heartbeat");
}

const g_HeartbeatRepeatingTickTask = new RepeatingTickTask(LogHeartbeat, [], true);
const g_vecHeartbeatFailures = [];
try {
	if (!g_HeartbeatRepeatingTickTask.StartRepeatingTickTask(5, 4)) {
		throw new Error("Heartbeat start failed.");
	}

	if (!g_HeartbeatRepeatingTickTask.PauseRepeatingTickTask() || (g_HeartbeatRepeatingTickTask.RepeatingTickTaskStatus !== RepeatingTickTaskStatus.PAUSED)) {
		throw new Error("Heartbeat pause failed.");
	}

	LogInfo(`Paused with ${g_HeartbeatRepeatingTickTask.PausedDelaySeconds} seconds remaining.`);

	if (!g_HeartbeatRepeatingTickTask.ResumeRepeatingTickTask() || (g_HeartbeatRepeatingTickTask.RepeatingTickTaskStatus !== RepeatingTickTaskStatus.RUNNING)) {
		throw new Error("Heartbeat resume failed.");
	}

	if (!g_HeartbeatRepeatingTickTask.StopRepeatingTickTask() || !g_HeartbeatRepeatingTickTask.RestartRepeatingTickTask()) {
		throw new Error("Heartbeat restart lifecycle failed.");
	}
} catch (Failure) {
	g_vecHeartbeatFailures.push(Failure);
}

try {
	if ((g_HeartbeatRepeatingTickTask.RepeatingTickTaskStatus !== RepeatingTickTaskStatus.STOPPED) && !g_HeartbeatRepeatingTickTask.DisposeRepeatingTickTask()) {
		throw new Error("Heartbeat cleanup failed.");
	}
} catch (CleanupFailure) {
	g_vecHeartbeatFailures.push(CleanupFailure);
}

if (g_vecHeartbeatFailures.length === 1) {
	throw g_vecHeartbeatFailures[0];
}

if (g_vecHeartbeatFailures.length > 1) {
	throw new AggregateError(g_vecHeartbeatFailures, "Heartbeat lifecycle or cleanup failed.");
}
```

`RestartRepeatingTickTask()` uses the current `TotalLoopCount`, so previous `ExtendRepeatingTickTask()` and `ReduceRepeatingTickTask()` adjustments become the new original limit. If an overshooting reduction left that total negative, restart stops the prior task and throws during limit validation; supply a valid limit with `StartRepeatingTickTask()` instead.

### Adjust a running loop budget

```js
const { LogInfo } = require("core/logger");
const { RepeatingTickTask, RepeatingTickTaskStatus } = require("listeners/tick");

function PollActiveVote() {
	LogInfo("Polling the active vote.");
}

const g_VotePollRepeatingTickTask = new RepeatingTickTask(PollActiveVote, [], true);
const g_vecVotePollFailures = [];
try {
	if (!g_VotePollRepeatingTickTask.StartRepeatingTickTask(2, 2) || !g_VotePollRepeatingTickTask.ExtendRepeatingTickTask(2) || !g_VotePollRepeatingTickTask.ReduceRepeatingTickTask(1)) {
		throw new Error("Vote-poll loop adjustment failed.");
	}

	LogInfo(`${g_VotePollRepeatingTickTask.LoopsRemaining}/${g_VotePollRepeatingTickTask.TotalLoopCount} polls remain.`);
	LogInfo(`${g_VotePollRepeatingTickTask.TotalTimeRemainingSeconds.toFixed(2)} seconds remain.`);
} catch (Failure) {
	g_vecVotePollFailures.push(Failure);
}

try {
	if ((g_VotePollRepeatingTickTask.RepeatingTickTaskStatus !== RepeatingTickTaskStatus.STOPPED) && !g_VotePollRepeatingTickTask.StopRepeatingTickTask()) {
		throw new Error("Vote-poll stop failed.");
	}
} catch (CleanupFailure) {
	g_vecVotePollFailures.push(CleanupFailure);
}

if (g_vecVotePollFailures.length === 1) {
	throw g_vecVotePollFailures[0];
}

if (g_vecVotePollFailures.length > 1) {
	throw new AggregateError(g_vecVotePollFailures, "Vote-poll adjustment or cleanup failed.");
}
```

### Controlled advanced execution

```js
const { EmitTickEvent, RepeatingTickTask, RepeatingTickTaskStatus } = require("listeners/tick");
const { LogInfo } = require("core/logger");

let g_unCallbackCount = 0;

function CountControlledRepeatingTickTaskExecution() {
	g_unCallbackCount += 1;

	return g_unCallbackCount;
}

const g_ControlledRepeatingTickTask = new RepeatingTickTask(CountControlledRepeatingTickTaskExecution);
const g_vecControlledFailures = [];
let g_ManualTickDelay = null;

try {
	if (!g_ControlledRepeatingTickTask.StartRepeatingTickTask(10, 2)) {
		throw new Error("Controlled repeating tick task start failed.");
	}

	const unDirectRepeatingTickTaskCallbackResult = g_ControlledRepeatingTickTask.InvokeRepeatingTickTaskCallback();
	if ((unDirectRepeatingTickTaskCallbackResult !== 1) || (g_unCallbackCount !== 1) || (g_ControlledRepeatingTickTask.LoopsElapsed !== 0)) {
		throw new Error("Direct repeating tick task callback changed scheduler counters.");
	}

	if (g_ControlledRepeatingTickTask.CurrentTickDelay === null) {
		throw new Error("Controlled repeating tick task did not create its initial delay.");
	}

	if (!g_ControlledRepeatingTickTask.CurrentTickDelay.CancelTickDelay()) {
		throw new Error("Controlled repeating tick task delay cancellation failed.");
	}

	g_ManualTickDelay = g_ControlledRepeatingTickTask.CreateRepeatingTickTaskDelay(0);
	EmitTickEvent("manual-scheduler-tick");

	if ((g_unCallbackCount !== 2) || (g_ControlledRepeatingTickTask.LoopsElapsed !== 1)) {
		throw new Error("Manual scheduler tick did not execute one loop.");
	}

	LogInfo(`Callbacks: ${g_unCallbackCount}; loops: ${g_ControlledRepeatingTickTask.LoopsElapsed}.`);
} catch (Failure) {
	g_vecControlledFailures.push(Failure);
}

try {
	if ((g_ManualTickDelay !== null) && g_ManualTickDelay.Running && !g_ManualTickDelay.DisposeTickDelay()) {
		throw new Error("Manual tick delay cleanup failed.");
	}
} catch (CleanupFailure) {
	g_vecControlledFailures.push(CleanupFailure);
}

try {
	if ((g_ControlledRepeatingTickTask.RepeatingTickTaskStatus !== RepeatingTickTaskStatus.STOPPED) && !g_ControlledRepeatingTickTask.DisposeRepeatingTickTask()) {
		throw new Error("Controlled repeating tick task cleanup failed.");
	}
} catch (CleanupFailure) {
	g_vecControlledFailures.push(CleanupFailure);
}

if (g_vecControlledFailures.length === 1) {
	throw g_vecControlledFailures[0];
}

if (g_vecControlledFailures.length > 1) {
	throw new AggregateError(g_vecControlledFailures, "Controlled tick execution or cleanup failed.");
}
```

`InvokeRepeatingTickTaskCallback()` contributes one callback but no loop. The zero-second repeating-tick-task-owned delay invokes `ExecuteRepeatingTickTask()` on the emitted tick and contributes one scheduled loop.

## Level changes and cleanup

`CancelScheduledTickTasksOnLevelEnd()` immediately applies the same map-transition policy used by the internal `LevelEnd` listener. It cancels ordinary delays with `CancelOnLevelEnd` set to `true` and stops both running and paused map-scoped repeating tick tasks.

```js
const { CancelScheduledTickTasksOnLevelEnd, RepeatingTickTask, RepeatingTickTaskStatus, TickDelay } = require("listeners/tick");
const { LogInfo } = require("core/logger");

function LogPersistentTickDelay() {
	LogInfo("Persistent tick delay fired.");
}

function LogMapTickDelay() {
	LogInfo("Map tick delay fired.");
}

function LogMapRepeatingTickTask() {
	LogInfo("Map repeating tick task fired.");
}

const g_PersistentTickDelay = new TickDelay(30, LogPersistentTickDelay);
const g_vecLevelCleanupFailures = [];
let g_MapTickDelay = null;
let g_PausedMapRepeatingTickTask = null;
try {
	g_MapTickDelay = new TickDelay(30, LogMapTickDelay, [], true);
	g_PausedMapRepeatingTickTask = new RepeatingTickTask(LogMapRepeatingTickTask, [], true);
	if (!g_PausedMapRepeatingTickTask.StartRepeatingTickTask(10) || !g_PausedMapRepeatingTickTask.PauseRepeatingTickTask()) {
		throw new Error("Map repeating tick task setup failed.");
	}

	CancelScheduledTickTasksOnLevelEnd();

	if (!g_PersistentTickDelay.Running || g_MapTickDelay.Running || (g_PausedMapRepeatingTickTask.RepeatingTickTaskStatus !== RepeatingTickTaskStatus.STOPPED)) {
		throw new Error("Map-scoped scheduler cleanup failed.");
	}
} catch (Failure) {
	g_vecLevelCleanupFailures.push(Failure);
}

try {
	if ((g_PausedMapRepeatingTickTask !== null) && (g_PausedMapRepeatingTickTask.RepeatingTickTaskStatus !== RepeatingTickTaskStatus.STOPPED) && !g_PausedMapRepeatingTickTask.DisposeRepeatingTickTask()) {
		throw new Error("Map repeating tick task cleanup failed.");
	}
} catch (CleanupFailure) {
	g_vecLevelCleanupFailures.push(CleanupFailure);
}

for (const TickDelayInstance of [g_MapTickDelay, g_PersistentTickDelay]) {
	try {
		if ((TickDelayInstance !== null) && TickDelayInstance.Running && !TickDelayInstance.DisposeTickDelay()) {
			throw new Error("Level example tick delay cleanup failed.");
		}
	} catch (CleanupFailure) {
		g_vecLevelCleanupFailures.push(CleanupFailure);
	}
}

if (g_vecLevelCleanupFailures.length === 1) {
	throw g_vecLevelCleanupFailures[0];
}

if (g_vecLevelCleanupFailures.length > 1) {
	throw new AggregateError(g_vecLevelCleanupFailures, "Level cancellation or cleanup failed.");
}
```

Call `DisposeTickDelay()` or `StopRepeatingTickTask()` for work owned by a plugin feature. Use `DisposeTickListeners()` only for scheduler teardown after all owned work has been stopped:

```js
const { DisposeTickListeners, TickDelay } = require("listeners/tick");
const { LogInfo } = require("core/logger");

function LogOwnedWork() {
	LogInfo("Owned work fired.");
}

const g_OwnedTickDelay = new TickDelay(60, LogOwnedWork, [], true);
if (!g_OwnedTickDelay.DisposeTickDelay()) {
	throw new Error("Owned tick delay cleanup failed; scheduler remains attached.");
}

if (!DisposeTickListeners()) {
	throw new Error("Owned scheduler teardown failed after delay cleanup.");
}
```

`DisposeTickListeners()` does not cancel queued delays. Detaching with live work leaves that work dormant until a later `TickDelay` or `RepeatingTickTask` causes lazy listener registration again. Ordinary plugin code should therefore dispose its resources and usually leave the shared scheduler listeners attached.

Each internal bridge is tracked separately. Removal failures throw, but successfully removed bridges are not removed again on a retry. An already-absent registration also throws and is marked detached, allowing a retry to release the remaining bridge.

## Errors and common mistakes

- Do not treat a wall-clock deadline as an execution guarantee: automatic processing requires a simulating frame; a manual `EmitTickEvent()` can dispatch the installed scheduler without one.
- Do not use `GameThreadTask` to offload JavaScript or `{ Blocking: true }` requests; it runs on the game thread. Returning an admission result is not awaiting a request callback.
- Do not pass entity objects through delayed identifiers. Store an index plus `UserID` or `NetworkID` identity and re-resolve at execution time.
- Do not call `TickDelay.CancelTickDelay()` twice; it throws when the delay is no longer queued. Use `DisposeTickDelay()` when cleanup should return `false` after completion or cancellation.
- Do not call `RepeatingTickTask.ExecuteRepeatingTickTask()` while its ordinary delay remains queued unless an extra loop is intentional.
- Do not pass a scalar as `CallbackArguments`; the API requires an array.
- Do not remove a raw callback with a new function expression; `UnregisterTickListener()` uses exact function identity.
- Do not detach scheduler listeners while queued work remains, assign read-only controller properties, or lose manually created delays.
- Do not rely on zero-delay rescheduling as a next-frame guarantee or subtract calendar labels to measure elapsed durations; use the monotonic elapsed/remaining getters.

## Related modules

- [`listeners`](listeners.md) provides managed VSP lifecycle and event listeners, including `RegisterTickListener` and `RegisterLevelEndListener`.
- [`memory/hooks/exceptions`](memory-hooks-exceptions.md) receives scheduler and task exceptions.
