"use strict";

const { GetModule } = require("internal/runtime");

const g_NativeEvents = GetModule("events");
const g_mapListenerWrappers = new Map();

function RequireNativeFunction(strFunctionName) {
	const NativeFunction = g_NativeEvents[strFunctionName];
	if (typeof NativeFunction !== "function") {
		throw new TypeError(`Native events module does not expose ${strFunctionName}().`);
	}

	return NativeFunction.bind(g_NativeEvents);
}

function RemoveTrackedEventCallback(strEventName, Callback, NativeCallback) {
	const mapCallbacksByCallback = g_mapListenerWrappers.get(strEventName);
	const vecNativeCallbacks = mapCallbacksByCallback?.get(Callback);
	if (vecNativeCallbacks === undefined) {
		return;
	}

	const nNativeCallbackIndex = vecNativeCallbacks.indexOf(NativeCallback);
	if (nNativeCallbackIndex < 0) {
		return;
	}

	vecNativeCallbacks.splice(nNativeCallbackIndex, 1);

	if (vecNativeCallbacks.length !== 0) {
		return;
	}

	mapCallbacksByCallback.delete(Callback);

	if (mapCallbacksByCallback.size === 0) {
		g_mapListenerWrappers.delete(strEventName);
	}
}

function CreateCustomEvent(...vecArguments) {
	return RequireNativeFunction("CreateCustomEvent")(...vecArguments);
}

function RegisterEventListener(strEventName, Callback) {
	if (typeof Callback !== "function") {
		throw new TypeError("RegisterEventListener callback expects a function.");
	}

	const RegisterNativeEventListener = RequireNativeFunction("RegisterEventListener");
	let mapCallbacksByCallback = g_mapListenerWrappers.get(strEventName);
	if (!mapCallbacksByCallback) {
		mapCallbacksByCallback = new Map();
		g_mapListenerWrappers.set(strEventName, mapCallbacksByCallback);
	}

	const NativeCallback = (NativeEvent) => Callback(NativeEvent);
	const vecNativeCallbacks = mapCallbacksByCallback.get(Callback) ?? [];
	vecNativeCallbacks.push(NativeCallback);
	mapCallbacksByCallback.set(Callback, vecNativeCallbacks);
	let bRegistered = false;
	try {
		bRegistered = RegisterNativeEventListener(strEventName, NativeCallback);

		return bRegistered;
	} finally {
		if (!bRegistered) {
			RemoveTrackedEventCallback(strEventName, Callback, NativeCallback);
		}
	}
}

function UnregisterEventListener(strEventName, Callback) {
	const vecNativeCallbacks = g_mapListenerWrappers.get(strEventName)?.get(Callback) ?? [];
	const NativeCallback = vecNativeCallbacks[0] ?? Callback;
	const bResult = RequireNativeFunction("UnregisterEventListener")(strEventName, NativeCallback);
	if (bResult) {
		RemoveTrackedEventCallback(strEventName, Callback, NativeCallback);
	}

	return bResult;
}

const g_EventsAPI = {
	CreateCustomEvent,
	CreateEventPayload: RequireNativeFunction("CreateEventPayload"),
	CreateEventResourceText: RequireNativeFunction("CreateEventResourceText"),
	FireEvent: RequireNativeFunction("FireEvent"),
	RegisterEventListener,
	UnregisterEventListener,
};

module.exports = g_EventsAPI;
