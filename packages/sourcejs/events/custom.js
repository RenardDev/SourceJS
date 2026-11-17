"use strict";

const { GetModule } = require("internal/runtime");

const g_NativeCustomEvents = GetModule("events/custom");

function RequireNativeFunction(strFunctionName) {
	const NativeFunction = g_NativeCustomEvents[strFunctionName];
	if (typeof NativeFunction !== "function") {
		throw new TypeError(`Native events/custom module does not expose ${strFunctionName}().`);
	}

	return NativeFunction.bind(g_NativeCustomEvents);
}

function CreateCustomEvent(...vecArguments) {
	const CustomEvent = RequireNativeFunction("CreateCustomEvent")(...vecArguments);
	CustomEvent.Name = CustomEvent.EventName;
	CustomEvent.Variables = CustomEvent.EventVariables;
	CustomEvent.ResourceText = CustomEvent.EventResourceText;
	CustomEvent.Fire = CustomEvent.FireEvent;

	return CustomEvent;
}

const g_CustomEventsAPI = {
	CreateCustomEvent,
	CreateEventPayload: RequireNativeFunction("CreateEventPayload"),
	CreateEventResourceText: RequireNativeFunction("CreateEventResourceText"),
	FireEvent: RequireNativeFunction("FireEvent"),
};

module.exports = g_CustomEventsAPI;
