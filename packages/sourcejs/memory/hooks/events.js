"use strict";

const { GetModule } = require("internal/runtime");
const g_MemoryHooks = require("memory/hooks");

const g_NativeEvents = GetModule("memory/hooks/events");
const g_mapPreEventCallbacks = new Map();

const g_EventAction = Object.freeze({ Continue: 0, StopBroadcast: 1, Block: 2 });

let g_PreEventHook = null;
// Failed registration retains its live native handle until cleanup succeeds.
let g_bPreEventHookPendingCleanup = false;

function RequireEventName(strEventName) {
	if ((typeof strEventName !== "string") || (strEventName.length === 0)) {
		throw new TypeError("Pre-event names must be non-empty strings.");
	}

	return strEventName;
}

function RequireCallback(Callback) {
	if (typeof Callback !== "function") {
		throw new TypeError("Pre-event callbacks must be functions.");
	}

	return Callback;
}

function RequireEventAction(nAction) {
	if ((nAction === undefined) || (nAction === g_EventAction.Continue) || (nAction === g_EventAction.StopBroadcast) || (nAction === g_EventAction.Block)) {
		return (nAction === undefined) ? g_EventAction.Continue : nAction;
	}

	throw new TypeError("Pre-event callbacks must return EventAction.Continue, EventAction.StopBroadcast, EventAction.Block, or undefined.");
}

function RequireEventAddress(unAddress) {
	if ((typeof unAddress !== "bigint") || (unAddress <= 0n)) {
		throw new TypeError("Pre-event hooks require a positive BigInt event address.");
	}

	return unAddress;
}

function CreatePreEventContext(HookPayload, unEventAddress, bDoNotBroadcast) {
	if (typeof bDoNotBroadcast !== "boolean") {
		throw new TypeError("The FireEvent bDoNotBroadcast argument must be boolean.");
	}

	const Context = {
		Action: g_EventAction.Continue,
		DoNotBroadcast: bDoNotBroadcast,
		Name: g_NativeEvents.GetEventName(unEventAddress),
		Address: unEventAddress,
		Block() {
			this.Action = g_EventAction.Block;

			return this.Action;
		},
		CallHookTrampoline(Options = undefined) {
			return (Options === undefined) ? HookPayload.CallHookTrampoline() : HookPayload.CallHookTrampoline(Options);
		},
		Continue() {
			this.Action = g_EventAction.Continue;

			return this.Action;
		},
		SetHookReturnValue(Value) {
			return HookPayload.SetHookReturnValue(Value);
		},
		StopBroadcast() {
			this.Action = g_EventAction.StopBroadcast;
			this.DoNotBroadcast = true;

			return this.Action;
		},
	};

	return Context;
}

function DispatchPreEvent(HookPayload) {
	if (!HookPayload || !Array.isArray(HookPayload.Arguments) || (HookPayload.Arguments.length < 3)) {
		throw new TypeError("The FireEvent hook payload must expose three arguments.");
	}

	const unEventAddress = RequireEventAddress(HookPayload.Arguments[1]);
	const strEventName = g_NativeEvents.GetEventName(unEventAddress);
	const setEventCallbacks = g_mapPreEventCallbacks.get(strEventName);
	if (!setEventCallbacks || (setEventCallbacks.size === 0)) {
		return undefined;
	}

	const Context = CreatePreEventContext(HookPayload, unEventAddress, HookPayload.Arguments[2]);
	let nFinalAction = g_EventAction.Continue;
	for (const Callback of setEventCallbacks) {
		const nAction = RequireEventAction(Callback(Context));
		nFinalAction = Math.max(nFinalAction, Context.Action, nAction);
		Context.Action = nFinalAction;

		if (nFinalAction === g_EventAction.Block) {
			break;
		}
	}

	if (Context.DoNotBroadcast || (nFinalAction === g_EventAction.StopBroadcast)) {
		HookPayload.SetHookArgument(2, true);
	}

	if (nFinalAction === g_EventAction.Block) {
		g_NativeEvents.FreeEvent(unEventAddress);
		return false;
	}

	return undefined;
}

function RemovePreEventHook() {
	if (g_PreEventHook === null) {
		return false;
	}

	const bRemoved = g_PreEventHook.Remove();
	if (bRemoved) {
		g_PreEventHook = null;
		g_bPreEventHookPendingCleanup = false;
	}

	return bRemoved;
}

function EnsurePreEventHook() {
	if (g_PreEventHook !== null) {
		if (!g_bPreEventHookPendingCleanup) {
			return g_PreEventHook;
		}

		if (!RemovePreEventHook()) {
			throw new Error("Unable to remove the pending FireEvent pre-hook handle.");
		}
	}

	const Hook = g_MemoryHooks.CreateVTableHook(g_NativeEvents.GetFireEventHookOptions());
	if (!Hook || (typeof Hook.Pre !== "function") || (typeof Hook.Remove !== "function")) {
		throw new Error("memory/hooks.CreateVTableHook() did not return a native hook handle.");
	}

	try {
		if (!Hook.Pre(DispatchPreEvent)) {
			throw new Error("Unable to register the native FireEvent pre-hook callback.");
		}
	} catch (ErrorValue) {
		try {
			if (!Hook.Remove()) {
				throw new Error("Unable to roll back the native FireEvent pre-hook handle.");
			}
		} catch (CleanupError) {
			g_PreEventHook = Hook;
			g_bPreEventHookPendingCleanup = true;
			throw new AggregateError([ErrorValue, CleanupError], "Registering and rolling back the native FireEvent pre-hook both failed.");
		}

		throw ErrorValue;
	}

	g_PreEventHook = Hook;

	return g_PreEventHook;
}

function OnPre(strEventName, Callback) {
	const strNormalizedEventName = RequireEventName(strEventName);
	const EventCallback = RequireCallback(Callback);
	let setEventCallbacks = g_mapPreEventCallbacks.get(strNormalizedEventName);
	if (setEventCallbacks && setEventCallbacks.has(EventCallback)) {
		throw new Error(`Pre-event callback is already registered for "${strNormalizedEventName}".`);
	}

	EnsurePreEventHook();

	if (!setEventCallbacks) {
		setEventCallbacks = new Set();
		g_mapPreEventCallbacks.set(strNormalizedEventName, setEventCallbacks);
	}

	setEventCallbacks.add(EventCallback);

	return EventCallback;
}

function OffPre(strEventName, Callback) {
	const strNormalizedEventName = RequireEventName(strEventName);
	const EventCallback = RequireCallback(Callback);
	const setEventCallbacks = g_mapPreEventCallbacks.get(strNormalizedEventName);
	if (!setEventCallbacks || !setEventCallbacks.delete(EventCallback)) {
		throw new Error(`Pre-event callback is not registered for "${strNormalizedEventName}".`);
	}

	if (setEventCallbacks.size === 0) {
		g_mapPreEventCallbacks.delete(strNormalizedEventName);
	}

	if (g_mapPreEventCallbacks.size === 0) {
		RemovePreEventHook();
	}

	return true;
}

function ClearPreEvents(strEventName = undefined) {
	if (strEventName === undefined) {
		g_mapPreEventCallbacks.clear();
		RemovePreEventHook();
		return true;
	}

	const bRemoved = g_mapPreEventCallbacks.delete(RequireEventName(strEventName));

	if (g_mapPreEventCallbacks.size === 0) {
		RemovePreEventHook();
	}

	return bRemoved;
}

function GetPreEventHook() {
	return g_PreEventHook;
}

function IsPreEventHookInstalled() {
	return (g_PreEventHook !== null) && !g_bPreEventHookPendingCleanup;
}

const g_EventsHooks = {
	EventAction: g_EventAction,
	ClearPreEvents,
	EnsurePreEventHook,
	EventInfo: g_NativeEvents.GetEventInformation,
	EventName: g_NativeEvents.GetEventName,
	EventAddress: g_NativeEvents.GetEventAddress,
	Fire: g_NativeEvents.FireEvent,
	FireEventHookOptions: g_NativeEvents.GetFireEventHookOptions,
	FreeEvent: g_NativeEvents.FreeEvent,
	GetBool: g_NativeEvents.GetBoolean,
	GetFloat: g_NativeEvents.GetFloat,
	GetInt: g_NativeEvents.GetInteger,
	GetPreEventHook,
	GetString: g_NativeEvents.GetString,
	IsEmpty: g_NativeEvents.IsEventEmpty,
	IsPreEventHookInstalled,
	ManagerAddress: g_NativeEvents.GetManagerAddress,
	Off: g_NativeEvents.RemoveListener,
	OffPre,
	On: g_NativeEvents.AddListener,
	OnPre,
	RemovePreEventHook,
	SetBool: g_NativeEvents.SetBoolean,
	SetFloat: g_NativeEvents.SetFloat,
	SetInt: g_NativeEvents.SetInteger,
	SetString: g_NativeEvents.SetString,
};

if ((typeof g_NativeEvents.GetUInt64 === "function") && (typeof g_NativeEvents.SetUInt64 === "function")) {
	g_EventsHooks.GetUInt64 = g_NativeEvents.GetUInt64;
	g_EventsHooks.SetUInt64 = g_NativeEvents.SetUInt64;
}

module.exports = g_EventsHooks;
