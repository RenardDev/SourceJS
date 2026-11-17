"use strict";

const { GetModule } = require("internal/runtime");
const { HookBase, HookDecorator } = require("memory/hooks/index");
const { EXCEPTION_HOOKS } = require("memory/hooks/exceptions");

const g_WarningsRuntime = GetModule("memory/hooks/warnings");
const { LogWarning } = GetModule("loggers");
const g_mapNativeWarningCallbacks = new Map();

function SerializeWarningPayload(Payload) {
	if ((Payload === null) || (typeof Payload !== "object") || Array.isArray(Payload)) {
		throw new TypeError("Native warning payload must be an object.");
	}

	const strSerializedPayload = JSON.stringify(Payload);
	if (typeof strSerializedPayload !== "string") {
		throw new TypeError("Native warning payload must be JSON-serializable.");
	}

	return strSerializedPayload;
}

function Emit(Payload) {
	return g_WarningsRuntime.Emit(SerializeWarningPayload(Payload));
}

function ParseWarningPayload(strEventName, strSerializedPayload) {
	if ((strEventName !== "Warning") || (typeof strSerializedPayload !== "string")) {
		throw new TypeError("Native warning callback requires the warning event and a serialized payload.");
	}

	const Payload = JSON.parse(strSerializedPayload);
	if ((Payload === null) || (typeof Payload !== "object") || Array.isArray(Payload)) {
		throw new TypeError("Native warning callback payload must decode to an object.");
	}

	return Payload;
}

function NormalizeWarning(strMessage, strCategory = "Warning", strFilename = "", unLineNumber = 0, Extra = {}) {
	if (typeof strMessage !== "string") {
		throw new TypeError("Warning message must be a string.");
	}

	if ((typeof strCategory !== "string") || (strCategory.length === 0)) {
		throw new TypeError("Warning category must be a non-empty string.");
	}

	if (typeof strFilename !== "string") {
		throw new TypeError("Warning filename must be a string.");
	}

	if (!Number.isSafeInteger(unLineNumber) || (unLineNumber < 0)) {
		throw new TypeError("Warning line number must be a safe non-negative integer.");
	}

	if ((Extra === null) || (typeof Extra !== "object") || Array.isArray(Extra)) {
		throw new TypeError("Warning extra fields must be an object.");
	}

	return { ...Extra, Message: strMessage, Category: strCategory, Filename: strFilename, LineNumber: unLineNumber };
}

class WarningHooks extends HookBase {
	PrintWarning(strMessage, strCategory = "Warning", strFilename = "", unLineNumber = 0, Extra = {}) {
		const WarningRecord = NormalizeWarning(strMessage, strCategory, strFilename, unLineNumber, Extra);
		Emit(WarningRecord);

		for (const Callback of Array.from(this)) {
			try {
				Callback(WarningRecord);
			} catch (ErrorValue) {
				EXCEPTION_HOOKS.PrintException(ErrorValue, { Source: "warning-callback" });
			}
		}

		const strLocation = WarningRecord.Filename ? ` Path="${WarningRecord.Filename}" Line=${WarningRecord.LineNumber}` : "";
		LogWarning(`Memory hook diagnostic Category="${WarningRecord.Category}" Message="${WarningRecord.Message}"${strLocation}`);

		return WarningRecord;
	}
}

const g_vecWarningHooks = new WarningHooks();

class WarningHook extends HookDecorator {
}

Object.defineProperty(WarningHook, "ClassInstance", { value: g_vecWarningHooks, writable: true, enumerable: true, configurable: true });

function Off(Callback) {
	const RuntimeCallback = g_mapNativeWarningCallbacks.get(Callback);
	if (RuntimeCallback === undefined) {
		return false;
	}

	const bRemoved = g_WarningsRuntime.RemoveListener(RuntimeCallback);
	if (bRemoved) {
		g_mapNativeWarningCallbacks.delete(Callback);
	}

	return bRemoved;
}

function On(Callback) {
	if (typeof Callback !== "function") {
		throw new TypeError("Native warning callback must be a function.");
	}

	if (g_mapNativeWarningCallbacks.has(Callback)) {
		throw new Error("Native warning callback is already registered.");
	}

	function RuntimeCallback(strEventName, strSerializedPayload) {
		return Callback(ParseWarningPayload(strEventName, strSerializedPayload));
	}

	if (!g_WarningsRuntime.AddListener(RuntimeCallback)) {
		throw new Error("Unable to register native warning callback.");
	}

	g_mapNativeWarningCallbacks.set(Callback, RuntimeCallback);

	return Callback;
}

function Warning(strMessage, strCategory = "Warning", strFilename = "", unLineNumber = 0, Extra = {}) {
	return g_vecWarningHooks.PrintWarning(strMessage, strCategory, strFilename, unLineNumber, Extra);
}

if ((typeof process !== "undefined") && process && (typeof process.on === "function")) {
	process.on("warning", (WarningEvent) => {
		try {
			g_vecWarningHooks.PrintWarning(WarningEvent.message, WarningEvent.name, "", 0, { WarningEvent });
		} catch {
			// Warning reporting must not escape the process-level warning handler.
		}
	});
}

module.exports = {
	WARNING_HOOKS: g_vecWarningHooks,
	WarningHook,
	WarningHooks,
	Emit,
	Off,
	On,
	Warning,
};
