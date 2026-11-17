"use strict";

const { GetModule } = require("internal/runtime");
const { HookBase, HookDecorator } = require("memory/hooks/index");

const g_ExceptionsRuntime = GetModule("memory/hooks/exceptions");
const { LogError } = GetModule("loggers");
const g_mapNativeExceptionCallbacks = new Map();

function SerializeExceptionPayload(Payload) {
	if ((Payload === null) || (typeof Payload !== "object") || Array.isArray(Payload)) {
		throw new TypeError("Native exception payload must be an object.");
	}

	const strSerializedPayload = JSON.stringify(Payload);
	if (typeof strSerializedPayload !== "string") {
		throw new TypeError("Native exception payload must be JSON-serializable.");
	}

	return strSerializedPayload;
}

function Emit(Payload) {
	return g_ExceptionsRuntime.Emit(SerializeExceptionPayload(Payload));
}

function ParseExceptionPayload(strEventName, strSerializedPayload) {
	if ((strEventName !== "Exception") || (typeof strSerializedPayload !== "string")) {
		throw new TypeError("Native exception callback requires the exception event and a serialized payload.");
	}

	const Payload = JSON.parse(strSerializedPayload);
	if ((Payload === null) || (typeof Payload !== "object") || Array.isArray(Payload)) {
		throw new TypeError("Native exception callback payload must decode to an object.");
	}

	return Payload;
}

function NormalizeException(Value, Extra = {}) {
	if (Value instanceof Error) {
		return { Name: Value.name, Message: Value.message, Stack: Value.stack || "", Error: Value, ...Extra };
	}

	return { Name: "Error", Message: String(Value), Stack: "", Error: Value, ...Extra };
}

class ExceptionHooks extends HookBase {
	PrintException(Value = undefined, Extra = {}, bCallbacks = true) {
		if ((Extra === null) || (typeof Extra !== "object") || Array.isArray(Extra)) {
			throw new TypeError("Exception extra fields must be an object.");
		}

		if (typeof bCallbacks !== "boolean") {
			throw new TypeError("Exception callback dispatch state must be a boolean.");
		}

		const Exception = NormalizeException((Value === undefined) ? new Error("Unknown exception") : Value, Extra);
		Emit(Exception);

		if (bCallbacks) {
			for (const Callback of Array.from(this)) {
				try {
					Callback(Exception);
				} catch (ErrorValue) {
					this.PrintException(ErrorValue, { Source: "exception-callback" }, false);
				}
			}
		}

		const strStack = Exception.Stack ? `\n${Exception.Stack}` : "";
		LogError(`[SourceJS] Exception: ${Exception.Name}: ${Exception.Message}${strStack}`);

		return Exception;
	}
}

const g_vecExceptionHooks = new ExceptionHooks();

class ExceptionHook extends HookDecorator {
}

Object.defineProperty(ExceptionHook, "ClassInstance", { value: g_vecExceptionHooks, writable: true, enumerable: true, configurable: true });

if ((typeof process !== "undefined") && process && (typeof process.on === "function")) {
	process.on("uncaughtException", (ErrorValue) => {
		try {
			g_vecExceptionHooks.PrintException(ErrorValue, { Source: "uncaughtException" });
		} catch {
			// Exception reporting must not escape the process-level failure handler.
		}
	});

	process.on("unhandledRejection", (Reason) => {
		try {
			g_vecExceptionHooks.PrintException(Reason, { Source: "unhandledRejection" });
		} catch {
			// Exception reporting must not escape the process-level failure handler.
		}
	});
}

function Off(Callback) {
	const RuntimeCallback = g_mapNativeExceptionCallbacks.get(Callback);
	if (RuntimeCallback === undefined) {
		return false;
	}

	const bRemoved = g_ExceptionsRuntime.RemoveListener(RuntimeCallback);
	if (bRemoved) {
		g_mapNativeExceptionCallbacks.delete(Callback);
	}

	return bRemoved;
}

function On(Callback) {
	if (typeof Callback !== "function") {
		throw new TypeError("Native exception callback must be a function.");
	}

	if (g_mapNativeExceptionCallbacks.has(Callback)) {
		throw new Error("Native exception callback is already registered.");
	}

	function RuntimeCallback(strEventName, strSerializedPayload) {
		return Callback(ParseExceptionPayload(strEventName, strSerializedPayload));
	}

	if (!g_ExceptionsRuntime.AddListener(RuntimeCallback)) {
		throw new Error("Unable to register native exception callback.");
	}

	g_mapNativeExceptionCallbacks.set(Callback, RuntimeCallback);

	return Callback;
}

module.exports = {
	EXCEPTION_HOOKS: g_vecExceptionHooks,
	ExceptionHook,
	ExceptionHooks,
	Emit,
	Off,
	On,
};
