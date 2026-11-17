"use strict";

const { GetModule } = require("internal/runtime");

const g_NativeListener = GetModule("events/listener");
const g_mapListenerWrappers = new Map();

function RequireNativeFunction(strFunctionName) {
	const NativeFunction = g_NativeListener[strFunctionName];
	if (typeof NativeFunction !== "function") {
		throw new TypeError(`Native events/listener module does not expose ${strFunctionName}().`);
	}

	return NativeFunction.bind(g_NativeListener);
}

function RegisterEventListener(strEventName, Callback) {
	if (typeof Callback !== "function") {
		throw new TypeError("RegisterEventListener Callback expects a function.");
	}

	const NativeCallback = (NativeEvent) => Callback(NativeEvent);
	const bResult = RequireNativeFunction("RegisterEventListener")(strEventName, NativeCallback);
	if (!bResult) {
		return bResult;
	}

	let mapCallbacksByCallback = g_mapListenerWrappers.get(strEventName);
	if (!mapCallbacksByCallback) {
		mapCallbacksByCallback = new Map();
		g_mapListenerWrappers.set(strEventName, mapCallbacksByCallback);
	}

	const vecNativeCallbacks = mapCallbacksByCallback.get(Callback) ?? [];
	vecNativeCallbacks.push(NativeCallback);
	mapCallbacksByCallback.set(Callback, vecNativeCallbacks);

	return bResult;
}

function UnregisterEventListener(strEventName, Callback) {
	const mapCallbacksByCallback = g_mapListenerWrappers.get(strEventName);
	const vecNativeCallbacks = mapCallbacksByCallback?.get(Callback) ?? [];
	const NativeCallback = vecNativeCallbacks[0] ?? Callback;
	const bResult = RequireNativeFunction("UnregisterEventListener")(strEventName, NativeCallback);
	if (bResult) {
		vecNativeCallbacks.shift();

		if (vecNativeCallbacks.length === 0) {
			mapCallbacksByCallback?.delete(Callback);

			if (mapCallbacksByCallback?.size === 0) {
				g_mapListenerWrappers.delete(strEventName);
			}
		}
	}

	return bResult;
}

module.exports = { FireEvent: RequireNativeFunction("FireEvent"), RegisterEventListener, UnregisterEventListener };
