"use strict";

const { GetModule } = require("internal/runtime");

const g_DefaultValues = Object.freeze({
	bool: false,
	byte: 0,
	short: 0,
	long: 0,
	float: 0,
	string: "",
});

const g_SetterTypes = Object.freeze({
	bool: "bool",
	byte: "int",
	short: "int",
	long: "int",
	float: "float",
	string: "string",
});

const g_EventVariablesRuntime = GetModule("events/variable");
const g_NativeCreateEventVariable = g_EventVariablesRuntime.CreateEventVariable;
const g_NativeInferEventVariable = g_EventVariablesRuntime.InferEventVariable;
const g_NativeCoerceEventVariable = g_EventVariablesRuntime.CoerceEventVariable;
const g_NativeGetEventVariableTypes = g_EventVariablesRuntime.GetEventVariableTypes;

function CreateEventVariableDefinition(strEventVariableName, strEventVariableType, EventVariableDefaultValue) {
	const NativeDefinition = (arguments.length > 2) ? g_NativeCreateEventVariable(strEventVariableName, strEventVariableType, EventVariableDefaultValue) : g_NativeCreateEventVariable(strEventVariableName, strEventVariableType);
	const Definition = { Name: NativeDefinition.Name, Type: NativeDefinition.Type };

	if (Object.hasOwn(NativeDefinition, "DefaultValue")) {
		Object.defineProperty(Definition, "DefaultValue", { value: NativeDefinition.DefaultValue, enumerable: true, writable: true, configurable: true });
	}

	return Definition;
}

class EventVariable {
	constructor(strEventVariableName, strEventVariableType, EventVariableDefaultValue) {
		const VariableDefinition = (arguments.length > 2) ? g_EventVariablesRuntime.CreateEventVariableDefinition(strEventVariableName, strEventVariableType, EventVariableDefaultValue) : g_EventVariablesRuntime.CreateEventVariableDefinition(strEventVariableName, strEventVariableType);
		this.Name = VariableDefinition.Name;
		this.Type = VariableDefinition.Type;

		if (Object.hasOwn(VariableDefinition, "DefaultValue")) {
			this.DefaultValue = VariableDefinition.DefaultValue;
		}
	}
}

class EventVariableTemplate {
	constructor(strEventVariableType, strEventVariableComment = "", EventVariableDefaultValue = undefined) {
		if (typeof strEventVariableType !== "string") {
			throw new TypeError("Event variable types must be strings.");
		}

		if (!Object.hasOwn(g_DefaultValues, strEventVariableType)) {
			throw new TypeError(`Unsupported event variable type: ${strEventVariableType}`);
		}

		if (typeof strEventVariableComment !== "string") {
			throw new TypeError("Event variable comments must be strings.");
		}

		this.Type = strEventVariableType;
		this.Comment = strEventVariableComment;
		this.DefaultValue = (EventVariableDefaultValue === undefined) ? g_DefaultValues[strEventVariableType] : EventVariableDefaultValue;
	}

	DefineEventVariable(strEventVariableName) {
		return new EventVariable(strEventVariableName, this.Type, this.DefaultValue);
	}

	get DefaultValue() {
		return this.#m_DefaultValue;
	}

	set DefaultValue(EventVariableDefaultValue) {
		this.#m_DefaultValue = EventVariableDefaultValue;
	}

	get SetterType() {
		return g_SetterTypes[this.Type];
	}

	#m_DefaultValue;
}

class BoolVariable extends EventVariableTemplate {
	constructor(strEventVariableComment = "", EventVariableDefaultValue = g_DefaultValues.bool) {
		super("bool", strEventVariableComment, EventVariableDefaultValue);
	}
}

class ByteVariable extends EventVariableTemplate {
	constructor(strEventVariableComment = "", EventVariableDefaultValue = g_DefaultValues.byte) {
		super("byte", strEventVariableComment, EventVariableDefaultValue);
	}
}

class ShortVariable extends EventVariableTemplate {
	constructor(strEventVariableComment = "", EventVariableDefaultValue = g_DefaultValues.short) {
		super("short", strEventVariableComment, EventVariableDefaultValue);
	}
}

class LongVariable extends EventVariableTemplate {
	constructor(strEventVariableComment = "", EventVariableDefaultValue = g_DefaultValues.long) {
		super("long", strEventVariableComment, EventVariableDefaultValue);
	}
}

class FloatVariable extends EventVariableTemplate {
	constructor(strEventVariableComment = "", EventVariableDefaultValue = g_DefaultValues.float) {
		super("float", strEventVariableComment, EventVariableDefaultValue);
	}
}

class StringVariable extends EventVariableTemplate {
	constructor(strEventVariableComment = "", EventVariableDefaultValue = g_DefaultValues.string) {
		super("string", strEventVariableComment, EventVariableDefaultValue);
	}
}

Object.assign(g_EventVariablesRuntime, {
	BooleanEventVariableTemplate: BoolVariable,
	BoolVariable: BoolVariable,
	ByteEventVariableTemplate: ByteVariable,
	ByteVariable: ByteVariable,
	CoerceEventVariable: g_NativeCoerceEventVariable,
	CoerceEventVariableValue: g_NativeCoerceEventVariable,
	CreateEventVariable: g_NativeCreateEventVariable,
	CreateEventVariableDefinition: CreateEventVariableDefinition,
	FloatEventVariableTemplate: FloatVariable,
	FloatVariable: FloatVariable,
	GetEventVariableTypes: g_NativeGetEventVariableTypes,
	InferEventVariable: g_NativeInferEventVariable,
	InferEventVariableType: g_NativeInferEventVariable,
	LongEventVariableTemplate: LongVariable,
	LongVariable: LongVariable,
	ShortEventVariableTemplate: ShortVariable,
	ShortVariable: ShortVariable,
	StringEventVariableTemplate: StringVariable,
	StringVariable: StringVariable,
	EventVariable: EventVariable,
	EventVariableTemplate: EventVariableTemplate,
});

module.exports = g_EventVariablesRuntime;
