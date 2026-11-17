"use strict";

const { GetModule } = require("internal/runtime");

const g_strEventPrefix = "SourceJS:Plugins:";
const g_mapCallbackWrappers = new WeakMap();
const g_ListenerRuntime = GetModule("listeners");

function RequirePluginBusOptions(PluginBusOptions, strDiagnosticContext) {
	if ((PluginBusOptions === null) || (typeof PluginBusOptions !== "object") || Array.isArray(PluginBusOptions)) {
		throw new TypeError(`${strDiagnosticContext} must be an object.`);
	}
}

function NormalizePluginBusChannelName(strChannelName) {
	if (typeof strChannelName !== "string") {
		throw new TypeError("Plugin bus channel must be a non-empty string.");
	}

	const strNormalizedChannelName = strChannelName.trim();
	if (strNormalizedChannelName.length === 0) {
		throw new TypeError("Plugin bus channel must be a non-empty string.");
	}

	if (strNormalizedChannelName.includes("\0") || strNormalizedChannelName.includes("\n") || strNormalizedChannelName.includes("\r")) {
		throw new TypeError("Plugin bus channel must not contain control characters.");
	}

	return strNormalizedChannelName;
}

function ReadPluginBusMetadataValue(PluginBusOptions, strMetadataName) {
	if (!Object.hasOwn(PluginBusOptions, strMetadataName)) {
		return undefined;
	}

	const strMetadataValue = PluginBusOptions[strMetadataName];
	if (strMetadataValue === undefined) {
		return undefined;
	}

	if (typeof strMetadataValue !== "string") {
		throw new TypeError(`Plugin bus ${strMetadataName} must be a string.`);
	}

	return strMetadataValue;
}

function GetEventName(strChannelName) {
	return `${g_strEventPrefix}${NormalizePluginBusChannelName(strChannelName)}`;
}

function CreatePluginBusEnvelope(strChannelName, PluginBusPayload, PluginBusOptions = {}) {
	RequirePluginBusOptions(PluginBusOptions, "Plugin bus options");

	const strSourceMetadataValue = ReadPluginBusMetadataValue(PluginBusOptions, "Source");
	const strTargetMetadataValue = ReadPluginBusMetadataValue(PluginBusOptions, "Target");
	const strMessageType = ReadPluginBusMetadataValue(PluginBusOptions, "Type");
	const strSourcePluginName = (strSourceMetadataValue === undefined) ? "" : strSourceMetadataValue;
	const strTargetPluginName = (strTargetMetadataValue === undefined) ? "" : strTargetMetadataValue;

	const PluginBusEnvelope = { Channel: NormalizePluginBusChannelName(strChannelName), Payload: PluginBusPayload, Source: strSourcePluginName, Target: strTargetPluginName, Timestamp: Date.now() };
	if (strMessageType !== undefined) {
		PluginBusEnvelope.Type = strMessageType;
	}

	return PluginBusEnvelope;
}

function DecodePluginBusEnvelope(strChannelName, strSerializedEnvelope) {
	if (typeof strSerializedEnvelope !== "string") {
		throw new TypeError("Plugin bus payload must be a serialized envelope.");
	}

	const PluginBusEnvelope = JSON.parse(strSerializedEnvelope);
	if ((PluginBusEnvelope === null) || (typeof PluginBusEnvelope !== "object") || Array.isArray(PluginBusEnvelope)) {
		throw new TypeError("Plugin bus envelope must be an object.");
	}

	const strNormalizedChannelName = NormalizePluginBusChannelName(strChannelName);
	if (!Object.hasOwn(PluginBusEnvelope, "Channel") || (PluginBusEnvelope.Channel !== strNormalizedChannelName)) {
		throw new RangeError("Plugin bus envelope channel does not match the listener channel.");
	}

	if (!Object.hasOwn(PluginBusEnvelope, "Payload")) {
		throw new TypeError("Plugin bus envelope must contain payload.");
	}

	if (!Object.hasOwn(PluginBusEnvelope, "Source") || !Object.hasOwn(PluginBusEnvelope, "Target") || !Object.hasOwn(PluginBusEnvelope, "Timestamp")) {
		throw new TypeError("Plugin bus envelope metadata is invalid.");
	}

	const strSourcePluginName = PluginBusEnvelope.Source;
	const strTargetPluginName = PluginBusEnvelope.Target;
	const dblMessageTimestamp = PluginBusEnvelope.Timestamp;
	if ((typeof strSourcePluginName !== "string") || (typeof strTargetPluginName !== "string") || (typeof dblMessageTimestamp !== "number") || !Number.isFinite(dblMessageTimestamp)) {
		throw new TypeError("Plugin bus envelope metadata is invalid.");
	}

	if (Object.hasOwn(PluginBusEnvelope, "Type")) {
		const strMessageType = PluginBusEnvelope.Type;
		if (typeof strMessageType !== "string") {
			throw new TypeError("Plugin bus envelope type must be a string.");
		}
	}

	return PluginBusEnvelope;
}

function RequirePluginBusBooleanResult(bNativeResult, strOperationName) {
	if (typeof bNativeResult !== "boolean") {
		throw new TypeError(`Plugin bus ${strOperationName} must return a boolean.`);
	}

	return bNativeResult;
}

function RequirePluginBusListenerCount(unListenerCountResult, strOperationName) {
	if (!Number.isSafeInteger(unListenerCountResult) || (unListenerCountResult < 0)) {
		throw new TypeError(`Plugin bus ${strOperationName} must return a non-negative safe integer.`);
	}

	return unListenerCountResult;
}

function GetOrCreateCallbackWrapperRecord(strChannelName, PluginBusCallback) {
	if (typeof PluginBusCallback !== "function") {
		throw new TypeError("Plugin bus callback must be a function.");
	}

	const strNormalizedChannelName = NormalizePluginBusChannelName(strChannelName);
	let mapCallbackChannelRecords = g_mapCallbackWrappers.get(PluginBusCallback);
	if (mapCallbackChannelRecords === undefined) {
		mapCallbackChannelRecords = new Map();
		g_mapCallbackWrappers.set(PluginBusCallback, mapCallbackChannelRecords);
	}

	if (!mapCallbackChannelRecords.has(strNormalizedChannelName)) {
		const strListenerEventName = GetEventName(strNormalizedChannelName);
		const ListenerCallback = (strEmittedEventName, strSerializedEnvelope) => {
			if (strEmittedEventName !== strListenerEventName) {
				throw new RangeError("Plugin bus listener event does not match the registered channel.");
			}

			const PluginBusEnvelope = DecodePluginBusEnvelope(strNormalizedChannelName, strSerializedEnvelope);

			return PluginBusCallback(PluginBusEnvelope.Payload, PluginBusEnvelope);
		};
		mapCallbackChannelRecords.set(strNormalizedChannelName, { ListenerCallback, ListenerEventName: strListenerEventName, RegistrationActive: false });
	}

	return mapCallbackChannelRecords.get(strNormalizedChannelName);
}

function On(strChannelName, PluginBusCallback) {
	const CallbackWrapperRecord = GetOrCreateCallbackWrapperRecord(strChannelName, PluginBusCallback);
	if (CallbackWrapperRecord.RegistrationActive) {
		return false;
	}

	const bListenerRegistrationResult = RequirePluginBusBooleanResult(g_ListenerRuntime.AddListener(CallbackWrapperRecord.ListenerEventName, CallbackWrapperRecord.ListenerCallback), "listener registration");
	if (bListenerRegistrationResult) {
		CallbackWrapperRecord.RegistrationActive = true;
	}

	return bListenerRegistrationResult;
}

function Off(strChannelName, PluginBusCallback) {
	if (typeof PluginBusCallback !== "function") {
		throw new TypeError("Plugin bus callback must be a function.");
	}

	const strNormalizedChannelName = NormalizePluginBusChannelName(strChannelName);
	const mapCallbackChannelRecords = g_mapCallbackWrappers.get(PluginBusCallback);
	if ((mapCallbackChannelRecords === undefined) || !mapCallbackChannelRecords.has(strNormalizedChannelName)) {
		return false;
	}

	const CallbackWrapperRecord = mapCallbackChannelRecords.get(strNormalizedChannelName);
	if (!CallbackWrapperRecord.RegistrationActive) {
		return false;
	}

	const bListenerRemovalResult = RequirePluginBusBooleanResult(g_ListenerRuntime.RemoveListener(CallbackWrapperRecord.ListenerEventName, CallbackWrapperRecord.ListenerCallback), "listener removal");
	if (bListenerRemovalResult) {
		mapCallbackChannelRecords.delete(strNormalizedChannelName);

		if (mapCallbackChannelRecords.size === 0) {
			g_mapCallbackWrappers.delete(PluginBusCallback);
		}
	}

	return bListenerRemovalResult;
}

function Emit(strChannelName, PluginBusPayload = {}, PluginBusOptions = {}) {
	const strNormalizedChannelName = NormalizePluginBusChannelName(strChannelName);
	const strSerializedEnvelope = JSON.stringify(CreatePluginBusEnvelope(strNormalizedChannelName, PluginBusPayload, PluginBusOptions));
	DecodePluginBusEnvelope(strNormalizedChannelName, strSerializedEnvelope);

	const unEmittedListenerCount = g_ListenerRuntime.Emit(GetEventName(strNormalizedChannelName), strSerializedEnvelope);

	return RequirePluginBusListenerCount(unEmittedListenerCount, "listener emit");
}

function GetListenerCount(strChannelName) {
	const unRegisteredListenerCount = g_ListenerRuntime.GetListenerCount(GetEventName(strChannelName));

	return RequirePluginBusListenerCount(unRegisteredListenerCount, "listener count");
}

class PluginBusChannel {
	constructor(strChannelName, PluginBusOptions = {}) {
		RequirePluginBusOptions(PluginBusOptions, "Plugin bus channel options");

		const strSourceMetadataValue = ReadPluginBusMetadataValue(PluginBusOptions, "Source");
		const strTargetMetadataValue = ReadPluginBusMetadataValue(PluginBusOptions, "Target");

		this.ValueName = NormalizePluginBusChannelName(strChannelName);
		this.ValueSource = (strSourceMetadataValue === undefined) ? "" : strSourceMetadataValue;
		this.ValueTarget = (strTargetMetadataValue === undefined) ? "" : strTargetMetadataValue;
	}

	GetEventName() {
		return GetEventName(this.ValueName);
	}

	On(PluginBusCallback) {
		return On(this.ValueName, PluginBusCallback);
	}

	Off(PluginBusCallback) {
		return Off(this.ValueName, PluginBusCallback);
	}

	Emit(PluginBusPayload = {}, PluginBusOptions = {}) {
		RequirePluginBusOptions(PluginBusOptions, "Plugin bus channel emit options");

		const strSourceMetadataValue = ReadPluginBusMetadataValue(PluginBusOptions, "Source");
		const strTargetMetadataValue = ReadPluginBusMetadataValue(PluginBusOptions, "Target");
		const strMessageType = ReadPluginBusMetadataValue(PluginBusOptions, "Type");
		const strSourcePluginName = (strSourceMetadataValue === undefined) ? this.ValueSource : strSourceMetadataValue;
		const strTargetPluginName = (strTargetMetadataValue === undefined) ? this.ValueTarget : strTargetMetadataValue;

		const DeliveryOptions = { Source: strSourcePluginName, Target: strTargetPluginName };
		if (strMessageType !== undefined) {
			DeliveryOptions.Type = strMessageType;
		}

		return Emit(this.ValueName, PluginBusPayload, DeliveryOptions);
	}

	GetListenerCount() {
		return GetListenerCount(this.ValueName);
	}

	get Name() {
		return this.ValueName;
	}

	get Source() {
		return this.ValueSource;
	}

	get Target() {
		return this.ValueTarget;
	}
}

function CreateChannel(strChannelName, PluginBusOptions = {}) {
	return new PluginBusChannel(strChannelName, PluginBusOptions);
}

module.exports = {
	EVENT_PREFIX: g_strEventPrefix,
	PluginBusChannel,
	CreateChannel,
	Emit,
	GetEventName,
	GetListenerCount,
	Off,
	On,
};
