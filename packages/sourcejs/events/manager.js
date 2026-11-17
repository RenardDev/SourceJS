"use strict";

const { GetModule } = require("internal/runtime");
const { EXCEPTION_HOOKS } = require("memory/hooks/exceptions");

const g_strModuleName = "events/manager";
const g_EventsManagerRuntime = GetModule("events/manager");

function RequireNativeFunction(strFunctionName) {
	const NativeFunction = g_EventsManagerRuntime[strFunctionName];
	if (typeof NativeFunction !== "function") {
		throw new TypeError(`Native events/manager module does not expose ${strFunctionName}().`);
	}

	return NativeFunction.bind(g_EventsManagerRuntime);
}

function RequireEventName(strEventName) {
	if ((typeof strEventName !== "string") || (strEventName.length === 0)) {
		throw new TypeError("Event name must be a non-empty string.");
	}

	return strEventName;
}

function RequireEventCallback(Callback) {
	if (typeof Callback !== "function") {
		throw new TypeError(`'${typeof Callback}' object is not callable.`);
	}

	return Callback;
}

function GetEventCallbackName(Callback) {
	return (Callback.name.length > 0) ? Callback.name : "<anonymous>";
}

function IsGameEvent(GameEvent) {
	if ((GameEvent === null) || (typeof GameEvent !== "object")) {
		return false;
	}

	const bHasEventName = typeof GameEvent.EventName === "string";
	const bHasEventGetter = (typeof GameEvent.GetEventString === "function") || (typeof GameEvent.GetEventValue === "function");

	return bHasEventName && bHasEventGetter;
}

function GetEventListenerName(ListenerDescriptor) {
	return RequireEventName(ListenerDescriptor.EventName);
}

function GetEventListenerCallback(ListenerDescriptor) {
	return RequireEventCallback(ListenerDescriptor.EngineCallback);
}

function CreateDispatchedGameEvent(strEventName, Payload = {}) {
	if (IsGameEvent(Payload)) {
		return Payload;
	}

	const bUseEmptyPayload = (Payload === null) || (Payload === "");
	const EventPayload = bUseEmptyPayload ? {} : ((typeof Payload === "string") ? JSON.parse(Payload) : Payload);
	const GetEventValue = (strEventKey, DefaultValue = undefined) => ((EventPayload !== null) && (typeof EventPayload === "object") && Object.hasOwn(EventPayload, strEventKey)) ? EventPayload[strEventKey] : DefaultValue;

	return { EventName: strEventName, EventPayload, RawEventPayload: Payload, GetEventValue };
}

function ReportEventException(EventError) {
	EXCEPTION_HOOKS.PrintException(EventError, { Source: g_strModuleName });
}

class EventListener extends Array {
	constructor(strEventName) {
		super();
		this.EventName = RequireEventName(strEventName);
		this.EngineCallback = (GameEvent) => this.DispatchGameEvent(GameEvent);
	}

	AppendEventCallback(Callback) {
		const EventCallback = RequireEventCallback(Callback);
		if (this.includes(EventCallback)) {
			throw new Error(`Event callback "${GetEventCallbackName(EventCallback)}" is already registered for event "${this.EventName}".`);
		}

		super.push(EventCallback);

		return EventCallback;
	}

	RemoveEventCallback(Callback) {
		const EventCallback = RequireEventCallback(Callback);
		const nCallbackIndex = this.indexOf(EventCallback);
		if (nCallbackIndex === -1) {
			throw new Error(`Event callback "${GetEventCallbackName(EventCallback)}" is not registered for event "${this.EventName}".`);
		}

		super.splice(nCallbackIndex, 1);

		return EventCallback;
	}

	DispatchGameEvent(GameEvent) {
		if (!IsGameEvent(GameEvent)) {
			throw new TypeError("Event callbacks require a live game event or a dispatched event value.");
		}

		for (const EventCallback of Array.from(this)) {
			try {
				EventCallback(GameEvent);
			} catch (EventError) {
				ReportEventException(EventError);
			}
		}

		return true;
	}

	static get [Symbol.species]() {
		return Array;
	}
}

class EventManager extends Map {
	GetEventListener(strEventName) {
		const strRequiredEventName = RequireEventName(strEventName);
		if (this.has(strRequiredEventName)) {
			return this.get(strRequiredEventName);
		}

		const vecEventListener = new EventListener(strRequiredEventName);
		if (!this.AddNativeEventListener(vecEventListener)) {
			throw new Error(`Unable to register native event listener for "${strRequiredEventName}".`);
		}

		this.set(strRequiredEventName, vecEventListener);

		return vecEventListener;
	}

	AddNativeEventListener(ListenerDescriptor) {
		return RequireNativeFunction("RegisterEventListener")(GetEventListenerName(ListenerDescriptor), GetEventListenerCallback(ListenerDescriptor));
	}

	RemoveNativeEventListener(ListenerDescriptor) {
		return RequireNativeFunction("UnregisterEventListener")(GetEventListenerName(ListenerDescriptor), GetEventListenerCallback(ListenerDescriptor));
	}

	RegisterEventListener(strEventName, Callback) {
		const EventCallback = RequireEventCallback(Callback);
		this.GetEventListener(strEventName).AppendEventCallback(EventCallback);

		return true;
	}

	UnregisterEventListener(strEventName, Callback) {
		const strRequiredEventName = RequireEventName(strEventName);
		const vecEventListener = this.get(strRequiredEventName);
		const EventCallback = RequireEventCallback(Callback);
		if (!vecEventListener) {
			throw new Error(`Event "${strRequiredEventName}" is not registered.`);
		}

		if (!vecEventListener.includes(EventCallback)) {
			throw new Error(`Event callback "${GetEventCallbackName(EventCallback)}" is not registered for event "${strRequiredEventName}".`);
		}

		if ((vecEventListener.length === 1) && !this.RemoveNativeEventListener(vecEventListener)) {
			throw new Error(`Unable to unregister native event listener for "${strRequiredEventName}".`);
		}

		vecEventListener.RemoveEventCallback(EventCallback);

		if (vecEventListener.length === 0) {
			this.delete(strRequiredEventName);
		}

		return true;
	}

	DispatchEvent(strEventName, Payload = {}) {
		const strRequiredEventName = RequireEventName(strEventName);

		return this.has(strRequiredEventName) ? this.get(strRequiredEventName).DispatchGameEvent(CreateDispatchedGameEvent(strRequiredEventName, Payload)) : false;
	}

	Clear() {
		for (const [strEventName, vecEventListener] of this) {
			if (!this.RemoveNativeEventListener(vecEventListener)) {
				throw new Error(`Unable to unregister native event listener for "${strEventName}".`);
			}

			this.delete(strEventName);
		}

		return true;
	}

	clear() {
		// Map.clear() must release native listeners instead of only deleting map entries.
		return this.Clear();
	}
}

const g_mapEventManager = new EventManager();
const g_FireEvent = RequireNativeFunction("FireEvent");

function RegisterEventListener(strEventName, Callback) {
	return g_mapEventManager.RegisterEventListener(strEventName, Callback);
}

function UnregisterEventListener(strEventName, Callback) {
	return g_mapEventManager.UnregisterEventListener(strEventName, Callback);
}

const g_EventsManagerAPI = {
	EVENT_MANAGER: g_mapEventManager,
	EventListener,
	EventManager,
	FireEvent: g_FireEvent,
	RegisterEventListener,
	UnregisterEventListener,
};

module.exports = g_EventsManagerAPI;
