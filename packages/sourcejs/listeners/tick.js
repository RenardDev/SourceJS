"use strict";

const { GetModule } = require("internal/runtime");
const { RegisterListener, UnregisterListener } = require("listeners");
const { EXCEPTION_HOOKS } = require("memory/hooks/exceptions");

const g_TickRuntime = GetModule("listeners/tick");
const g_vecScheduledTickDelays = [];
const g_mapTickDelayStates = new WeakMap();
const g_setActiveRepeatingTickTasks = new Set();
const g_RepeatingTickTaskStatus = Object.freeze({ STOPPED: 1, RUNNING: 2, PAUSED: 3 });
let g_bTickBridgeRegistered = false;
let g_bLevelEndBridgeRegistered = false;

function GetCurrentTimeSeconds() {
	// Public start/deadline getters expose wall-clock seconds; preserve their documented clock domain.
	return Date.now() / 1000;
}

function GetMonotonicTimeSeconds() {
	const flTimeSeconds = g_TickRuntime.GetMonotonicTimeSeconds();
	if ((typeof flTimeSeconds !== "number") || !Number.isFinite(flTimeSeconds)) {
		throw new TypeError("Native tick monotonic time must be a finite number.");
	}

	return flTimeSeconds;
}

function GetTickDelayState(TickDelayValue) {
	return g_mapTickDelayStates.get(TickDelayValue);
}

function RequireDelaySeconds(flDelaySeconds, strValueName) {
	if ((typeof flDelaySeconds !== "number") || !Number.isFinite(flDelaySeconds) || (flDelaySeconds < 0)) {
		throw new TypeError(`${strValueName} must be a non-negative finite number.`);
	}

	return flDelaySeconds;
}

function RequireCallbackArguments(vecCallbackArguments) {
	if (!Array.isArray(vecCallbackArguments)) {
		throw new TypeError("vecCallbackArguments must be an array.");
	}

	return vecCallbackArguments;
}

function RequireCancelOnLevelEnd(bCancelOnLevelEnd) {
	if (typeof bCancelOnLevelEnd !== "boolean") {
		throw new TypeError("bCancelOnLevelEnd must be a boolean.");
	}

	return bCancelOnLevelEnd;
}

function SortScheduledTickDelays() {
	g_vecScheduledTickDelays.sort((LeftDelay, RightDelay) => GetTickDelayState(LeftDelay).MonotonicExecutionTimeSeconds - GetTickDelayState(RightDelay).MonotonicExecutionTimeSeconds);
}

function RemoveScheduledTickDelay(TickDelay) {
	const nDelayIndex = g_vecScheduledTickDelays.indexOf(TickDelay);
	if (nDelayIndex < 0) {
		throw new Error("TickDelay is not running.");
	}

	g_vecScheduledTickDelays.splice(nDelayIndex, 1);
}

function ExecuteScheduledTickDelays() {
	const flCurrentTimeSeconds = GetMonotonicTimeSeconds();
	while ((g_vecScheduledTickDelays.length > 0) && (GetTickDelayState(g_vecScheduledTickDelays[0]).MonotonicExecutionTimeSeconds <= flCurrentTimeSeconds)) {
		const TickDelay = g_vecScheduledTickDelays.shift();
		GetTickDelayState(TickDelay).Running = false;

		try {
			TickDelay.ExecuteTickDelayCallback();
		} catch (ErrorValue) {
			EXCEPTION_HOOKS.PrintException(ErrorValue, { Source: "delay" });
		}
	}
}

function CancelScheduledTickTasksOnLevelEnd() {
	for (const RepeatingTickTask of g_setActiveRepeatingTickTasks) {
		if (RepeatingTickTask.CancelOnLevelEnd) {
			RepeatingTickTask.StopRepeatingTickTask();
		}
	}

	for (let nDelayIndex = g_vecScheduledTickDelays.length - 1; nDelayIndex >= 0; --nDelayIndex) {
		const TickDelay = g_vecScheduledTickDelays[nDelayIndex];
		if (TickDelay.CancelOnLevelEnd && (TickDelay.RepeatingTickTask === null)) {
			TickDelay.CancelTickDelay();
		}
	}
}

function EnsureTickListenersRegistered() {
	if (g_bTickBridgeRegistered && g_bLevelEndBridgeRegistered) {
		return;
	}

	if (!g_bTickBridgeRegistered) {
		if (!RegisterListener("Tick", ExecuteScheduledTickDelays)) {
			throw new Error("Tick scheduler bridge registration was rejected.");
		}

		g_bTickBridgeRegistered = true;
	}

	try {
		if (!g_bLevelEndBridgeRegistered) {
			if (!RegisterListener("LevelEnd", CancelScheduledTickTasksOnLevelEnd)) {
				throw new Error("LevelEnd scheduler bridge registration was rejected.");
			}

			g_bLevelEndBridgeRegistered = true;
		}
	} catch (RegistrationError) {
		try {
			// An already removed Tick bridge needs no additional rollback.
			UnregisterListener("Tick", ExecuteScheduledTickDelays);
			g_bTickBridgeRegistered = false;
		} catch (CleanupError) {
			throw new AggregateError([RegistrationError, CleanupError], "Tick scheduler registration and rollback failed.");
		}

		throw RegistrationError;
	}
}

function ScheduleTickDelay(TickDelay) {
	EnsureTickListenersRegistered();
	GetTickDelayState(TickDelay).Running = true;
	g_vecScheduledTickDelays.push(TickDelay);
	SortScheduledTickDelays();
}

class GameThreadTask {
	constructor(Callback, GameThreadTaskOptions = {}) {
		if (typeof Callback !== "function") {
			throw new TypeError("GameThreadTask Callback must be a function.");
		}

		if ((GameThreadTaskOptions === null) || (typeof GameThreadTaskOptions !== "object") || Array.isArray(GameThreadTaskOptions)) {
			throw new TypeError("GameThreadTask options must be an object.");
		}

		const strName = Object.hasOwn(GameThreadTaskOptions, "Name") ? GameThreadTaskOptions.Name : undefined;
		if ((strName !== undefined) && ((typeof strName !== "string") || (strName.length === 0))) {
			throw new TypeError("GameThreadTask Name must be a non-empty string.");
		}

		this.#m_Callback = Callback;
		this.#m_Name = strName ?? (Callback.name || "GameThreadTask");
		this.#m_unIdentifier = 0;
		this.#m_bRunning = false;
		this.#m_Promise = null;
	}

	StartGameThreadTask(...vecCallbackArguments) {
		if (this.#m_bRunning) {
			throw new Error(`GameThreadTask "${this.#m_Name}" is already running.`);
		}

		this.#m_bRunning = true;
		this.#m_unIdentifier += 1;
		this.#m_Promise = Promise.resolve()
			.then(() => this.#m_Callback(...vecCallbackArguments))
			.catch((ErrorValue) => {
				EXCEPTION_HOOKS.PrintException(ErrorValue, { Source: "game-thread", ThreadName: this.#m_Name });
				throw ErrorValue;
			})
			.finally(() => {
				this.#m_bRunning = false;
			});

		return this;
	}

	JoinGameThreadTask() {
		return this.#m_Promise ?? Promise.resolve();
	}

	IsGameThreadTaskAlive() {
		return this.#m_bRunning;
	}

	get Name() {
		return this.#m_Name;
	}

	get Identifier() {
		return this.#m_unIdentifier;
	}

	get Running() {
		return this.#m_bRunning;
	}

	#m_Callback;
	#m_Name;
	#m_unIdentifier;
	#m_bRunning;
	#m_Promise;
}

class TickDelay {
	constructor(flDelaySeconds, Callback, vecCallbackArguments = [], bCancelOnLevelEnd = false) {
		if (typeof Callback !== "function") {
			throw new TypeError("TickDelay Callback must be a function.");
		}

		const flValidatedDelaySeconds = RequireDelaySeconds(flDelaySeconds, "TickDelay flDelaySeconds");
		const vecValidatedArguments = RequireCallbackArguments(vecCallbackArguments);
		const bValidatedCancelOnLevelEnd = RequireCancelOnLevelEnd(bCancelOnLevelEnd);
		const flStartTimeSeconds = GetCurrentTimeSeconds();
		const flMonotonicStartTimeSeconds = GetMonotonicTimeSeconds();

		this.#m_State = {
			DelaySeconds: flValidatedDelaySeconds,
			CallbackArguments: vecValidatedArguments,
			CancelOnLevelEnd: bValidatedCancelOnLevelEnd,
			StartTimeSeconds: flStartTimeSeconds,
			ExecutionTimeSeconds: flStartTimeSeconds + flValidatedDelaySeconds,
			MonotonicStartTimeSeconds: flMonotonicStartTimeSeconds,
			MonotonicExecutionTimeSeconds: flMonotonicStartTimeSeconds + flValidatedDelaySeconds,
			Callback,
			RepeatingTickTask: null,
			Running: false,
		};
		g_mapTickDelayStates.set(this, this.#m_State);
		ScheduleTickDelay(this);
	}

	InvokeTickDelayCallback() {
		this.CancelTickDelay();

		return this.ExecuteTickDelayCallback();
	}

	ExecuteTickDelayCallback() {
		return this.#m_State.Callback(...this.#m_State.CallbackArguments);
	}

	CancelTickDelay() {
		RemoveScheduledTickDelay(this);
		this.#m_State.Running = false;

		return true;
	}

	DisposeTickDelay() {
		if (!this.#m_State.Running) {
			return false;
		}

		return this.CancelTickDelay();
	}

	get DelaySeconds() {
		return this.#m_State.DelaySeconds;
	}

	get CallbackArguments() {
		return this.#m_State.CallbackArguments;
	}

	get CancelOnLevelEnd() {
		return this.#m_State.CancelOnLevelEnd;
	}

	get Callback() {
		return this.#m_State.Callback;
	}

	get TimeRemainingSeconds() {
		return this.#m_State.Running ? Math.max(0, this.#m_State.MonotonicExecutionTimeSeconds - GetMonotonicTimeSeconds()) : 0;
	}

	get TimeElapsedSeconds() {
		return this.#m_State.Running ? Math.max(0, GetMonotonicTimeSeconds() - this.#m_State.MonotonicStartTimeSeconds) : 0;
	}

	get StartTimeSeconds() {
		return this.#m_State.StartTimeSeconds;
	}

	get ExecutionTimeSeconds() {
		return this.#m_State.ExecutionTimeSeconds;
	}

	get RepeatingTickTask() {
		return this.#m_State.RepeatingTickTask;
	}

	get Running() {
		return this.#m_State.Running;
	}

	#m_State;
}

class RepeatingTickTask {
	constructor(Callback, vecCallbackArguments = [], bCancelOnLevelEnd = false) {
		if (typeof Callback !== "function") {
			throw new TypeError("RepeatingTickTask Callback must be a function.");
		}

		this.#m_Callback = Callback;
		this.#m_vecCallbackArguments = RequireCallbackArguments(vecCallbackArguments);
		this.#m_bCancelOnLevelEnd = RequireCancelOnLevelEnd(bCancelOnLevelEnd);
		this.#m_flStoredIntervalSeconds = 0;
		this.#m_unStoredOriginalLoopCount = Infinity;
		this.#m_unInitialLoopCount = Infinity;
		this.#m_unElapsedLoopCount = 0;
		this.#m_nStoredLoopCountAdjustment = 0;
		this.#m_nStoredRepeatingTickTaskStatus = g_RepeatingTickTaskStatus.STOPPED;
		this.#m_CurrentTickDelay = null;
		this.#m_flPausedDelaySeconds = 0;
		this.#m_flOriginalStartTimeSeconds = 0;
		this.#m_flOriginalMonotonicStartTimeSeconds = null;
	}

	StartRepeatingTickTask(flIntervalSeconds, unLoopCountLimit = Infinity, bExecuteCallbackOnStart = false) {
		if (this.#m_nStoredRepeatingTickTaskStatus === g_RepeatingTickTaskStatus.RUNNING) {
			return false;
		}

		RequireDelaySeconds(flIntervalSeconds, "RepeatingTickTask flIntervalSeconds");

		if ((unLoopCountLimit !== Infinity) && (!Number.isSafeInteger(unLoopCountLimit) || (unLoopCountLimit < 0))) {
			throw new TypeError("RepeatingTickTask unLoopCountLimit must be a non-negative integer or Infinity.");
		}

		if (typeof bExecuteCallbackOnStart !== "boolean") {
			throw new TypeError("bExecuteCallbackOnStart must be a boolean.");
		}

		// Rejected bridge setup must leave stopped/paused task state retryable.
		const flStartTimeSeconds = GetCurrentTimeSeconds();
		const flMonotonicStartTimeSeconds = GetMonotonicTimeSeconds();
		const NextTickDelay = (unLoopCountLimit === 0) ? null : this.CreateRepeatingTickTaskDelay(flIntervalSeconds);

		this.#m_flStoredIntervalSeconds = flIntervalSeconds;
		this.#m_unStoredOriginalLoopCount = unLoopCountLimit;
		this.#m_unInitialLoopCount = unLoopCountLimit;
		this.#m_unElapsedLoopCount = 0;
		this.#m_nStoredLoopCountAdjustment = 0;
		this.#m_flOriginalStartTimeSeconds = flStartTimeSeconds;
		this.#m_flOriginalMonotonicStartTimeSeconds = flMonotonicStartTimeSeconds;
		this.#m_nStoredRepeatingTickTaskStatus = (unLoopCountLimit === 0) ? g_RepeatingTickTaskStatus.STOPPED : g_RepeatingTickTaskStatus.RUNNING;
		this.#m_CurrentTickDelay = NextTickDelay;

		if (unLoopCountLimit > 0) {
			g_setActiveRepeatingTickTasks.add(this);
		} else {
			g_setActiveRepeatingTickTasks.delete(this);
		}

		if (bExecuteCallbackOnStart) {
			this.InvokeRepeatingTickTaskCallback();
		}

		return true;
	}

	StopRepeatingTickTask() {
		if (this.#m_nStoredRepeatingTickTaskStatus === g_RepeatingTickTaskStatus.STOPPED) {
			return false;
		}

		if (this.#m_CurrentTickDelay?.Running) {
			this.#m_CurrentTickDelay.CancelTickDelay();
		}

		g_setActiveRepeatingTickTasks.delete(this);
		this.#m_nStoredRepeatingTickTaskStatus = g_RepeatingTickTaskStatus.STOPPED;
		this.#m_CurrentTickDelay = null;

		return true;
	}

	RestartRepeatingTickTask() {
		const flIntervalSeconds = this.IntervalSeconds;
		const unLoopCount = this.TotalLoopCount;
		this.StopRepeatingTickTask();

		return this.StartRepeatingTickTask(flIntervalSeconds, unLoopCount);
	}

	PauseRepeatingTickTask() {
		if (this.#m_nStoredRepeatingTickTaskStatus !== g_RepeatingTickTaskStatus.RUNNING) {
			return false;
		}

		this.#m_flPausedDelaySeconds = this.#m_CurrentTickDelay?.TimeRemainingSeconds ?? 0;
		this.#m_CurrentTickDelay?.CancelTickDelay();
		this.#m_CurrentTickDelay = null;
		this.#m_nStoredRepeatingTickTaskStatus = g_RepeatingTickTaskStatus.PAUSED;

		return true;
	}

	ResumeRepeatingTickTask() {
		if (this.#m_nStoredRepeatingTickTaskStatus !== g_RepeatingTickTaskStatus.PAUSED) {
			return false;
		}

		this.#m_CurrentTickDelay = this.CreateRepeatingTickTaskDelay(this.#m_flPausedDelaySeconds);
		this.#m_nStoredRepeatingTickTaskStatus = g_RepeatingTickTaskStatus.RUNNING;

		return true;
	}

	ExtendRepeatingTickTask(unLoopCountAdjustment) {
		if (!Number.isSafeInteger(unLoopCountAdjustment) || (unLoopCountAdjustment < 1)) {
			throw new TypeError("unLoopCountAdjustment must be a positive integer.");
		}

		if (this.TotalLoopCount === Infinity) {
			return false;
		}

		const nNextLoopCountAdjustment = this.#m_nStoredLoopCountAdjustment + unLoopCountAdjustment;
		const nNextTotalLoopCount = this.#m_unStoredOriginalLoopCount + nNextLoopCountAdjustment;
		if (!Number.isSafeInteger(nNextLoopCountAdjustment) || !Number.isSafeInteger(nNextTotalLoopCount)) {
			throw new RangeError("RepeatingTickTask loop count adjustment would exceed safe integer precision.");
		}

		this.#m_nStoredLoopCountAdjustment = nNextLoopCountAdjustment;

		return true;
	}

	ReduceRepeatingTickTask(unLoopCountAdjustment) {
		if (!Number.isSafeInteger(unLoopCountAdjustment) || (unLoopCountAdjustment < 1)) {
			throw new TypeError("unLoopCountAdjustment must be a positive integer.");
		}

		if (this.TotalLoopCount === Infinity) {
			return false;
		}

		const nNextLoopCountAdjustment = this.#m_nStoredLoopCountAdjustment - unLoopCountAdjustment;
		const nNextTotalLoopCount = this.#m_unStoredOriginalLoopCount + nNextLoopCountAdjustment;
		if (!Number.isSafeInteger(nNextLoopCountAdjustment) || !Number.isSafeInteger(nNextTotalLoopCount)) {
			throw new RangeError("RepeatingTickTask loop count adjustment would exceed safe integer precision.");
		}

		this.#m_nStoredLoopCountAdjustment = nNextLoopCountAdjustment;

		if ((this.LoopsRemaining <= 0) && (this.#m_nStoredRepeatingTickTaskStatus !== g_RepeatingTickTaskStatus.STOPPED)) {
			this.StopRepeatingTickTask();
		}

		return true;
	}

	DisposeRepeatingTickTask() {
		return this.StopRepeatingTickTask();
	}

	CreateRepeatingTickTaskDelay(flDelaySeconds) {
		const RepeatingTickTaskDelay = new TickDelay(flDelaySeconds, () => this.ExecuteRepeatingTickTask(), [], this.#m_bCancelOnLevelEnd);
		GetTickDelayState(RepeatingTickTaskDelay).RepeatingTickTask = this;

		return RepeatingTickTaskDelay;
	}

	InvokeRepeatingTickTaskCallback() {
		return this.#m_Callback(...this.#m_vecCallbackArguments);
	}

	ExecuteRepeatingTickTask() {
		this.#m_unElapsedLoopCount += 1;

		if (this.LoopsRemaining > 0) {
			try {
				this.#m_CurrentTickDelay = this.CreateRepeatingTickTaskDelay(this.IntervalSeconds);
			} catch (ErrorValue) {
				this.StopRepeatingTickTask();
				throw ErrorValue;
			}
		} else {
			g_setActiveRepeatingTickTasks.delete(this);
			this.#m_nStoredRepeatingTickTaskStatus = g_RepeatingTickTaskStatus.STOPPED;
			this.#m_CurrentTickDelay = null;
		}

		return this.InvokeRepeatingTickTaskCallback();
	}

	get Callback() {
		return this.#m_Callback;
	}

	get CallbackArguments() {
		return this.#m_vecCallbackArguments;
	}

	get CancelOnLevelEnd() {
		return this.#m_bCancelOnLevelEnd;
	}

	get StoredIntervalSeconds() {
		return this.#m_flStoredIntervalSeconds;
	}

	get StoredOriginalLoopCount() {
		return this.#m_unStoredOriginalLoopCount;
	}

	get InitialLoopCount() {
		return this.#m_unInitialLoopCount;
	}

	get ElapsedLoopCount() {
		return this.#m_unElapsedLoopCount;
	}

	get StoredLoopCountAdjustment() {
		return this.#m_nStoredLoopCountAdjustment;
	}

	get StoredRepeatingTickTaskStatus() {
		return this.#m_nStoredRepeatingTickTaskStatus;
	}

	get CurrentTickDelay() {
		return this.#m_CurrentTickDelay;
	}

	get PausedDelaySeconds() {
		return this.#m_flPausedDelaySeconds;
	}

	get OriginalStartTimeSeconds() {
		return this.#m_flOriginalStartTimeSeconds;
	}

	get IntervalSeconds() {
		return this.#m_flStoredIntervalSeconds;
	}

	get AdjustedLoopCount() {
		return this.#m_nStoredLoopCountAdjustment;
	}

	get LoopsRemaining() {
		return (this.TotalLoopCount === Infinity) ? Infinity : (this.TotalLoopCount - this.LoopsElapsed);
	}

	get LoopsElapsed() {
		return this.#m_unElapsedLoopCount;
	}

	get TotalLoopCount() {
		return (this.#m_unStoredOriginalLoopCount === Infinity) ? Infinity : (this.#m_unStoredOriginalLoopCount + this.#m_nStoredLoopCountAdjustment);
	}

	get OriginalLoopCount() {
		return this.#m_unStoredOriginalLoopCount;
	}

	get TotalTimeRemainingSeconds() {
		return (this.LoopsRemaining === Infinity) ? Infinity : Math.max(0, (this.LoopsRemaining - 1) * this.IntervalSeconds + this.CurrentDelayTimeRemainingSeconds);
	}

	get TotalTimeElapsedSeconds() {
		return (this.#m_flOriginalMonotonicStartTimeSeconds === null) ? 0 : Math.max(0, GetMonotonicTimeSeconds() - this.#m_flOriginalMonotonicStartTimeSeconds);
	}

	get TotalTimeSeconds() {
		return (this.TotalLoopCount === Infinity) ? Infinity : (this.TotalLoopCount * this.IntervalSeconds);
	}

	get CurrentDelayTimeRemainingSeconds() {
		return this.#m_CurrentTickDelay?.TimeRemainingSeconds ?? 0;
	}

	get CurrentDelayTimeElapsedSeconds() {
		return this.#m_CurrentTickDelay?.TimeElapsedSeconds ?? 0;
	}

	get RepeatingTickTaskStatus() {
		return this.#m_nStoredRepeatingTickTaskStatus;
	}

	#m_Callback;
	#m_vecCallbackArguments;
	#m_bCancelOnLevelEnd;
	#m_flStoredIntervalSeconds;
	#m_unStoredOriginalLoopCount;
	#m_unInitialLoopCount;
	#m_unElapsedLoopCount;
	#m_nStoredLoopCountAdjustment;
	#m_nStoredRepeatingTickTaskStatus;
	#m_CurrentTickDelay;
	#m_flPausedDelaySeconds;
	#m_flOriginalStartTimeSeconds;
	#m_flOriginalMonotonicStartTimeSeconds;
}

function DisposeTickListeners() {
	if (!g_bTickBridgeRegistered && !g_bLevelEndBridgeRegistered) {
		return false;
	}

	if (g_bTickBridgeRegistered) {
		const bTickUnregistered = UnregisterListener("Tick", ExecuteScheduledTickDelays);
		g_bTickBridgeRegistered = false;
		if (!bTickUnregistered) {
			throw new Error("Tick scheduler bridge could not be disposed.");
		}
	}

	if (g_bLevelEndBridgeRegistered) {
		const bLevelEndUnregistered = UnregisterListener("LevelEnd", CancelScheduledTickTasksOnLevelEnd);
		g_bLevelEndBridgeRegistered = false;
		if (!bLevelEndUnregistered) {
			throw new Error("LevelEnd scheduler bridge could not be disposed.");
		}
	}

	return true;
}

module.exports = {
	CancelScheduledTickTasksOnLevelEnd,
	DisposeTickListeners,
	EmitTickEvent: g_TickRuntime.Emit,
	GameThreadTask,
	RegisterTickListener: g_TickRuntime.AddListener,
	RepeatingTickTask,
	RepeatingTickTaskStatus: g_RepeatingTickTaskStatus,
	TickDelay,
	UnregisterTickListener: g_TickRuntime.RemoveListener,
};
