#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strPackagePath = g_Path.resolve(__dirname, "..", "packages", "sourcejs", "events", "variable.js");
const g_strDocumentationPath = g_Path.resolve(__dirname, "..", "docs", "api", "events-variable.md");
const g_strRuntimePath = g_Path.resolve(__dirname, "..", "packages", "sourcejs", "internal", "runtime.js");
const g_OriginalModuleLoad = g_Module._load;
const g_OriginalNativeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
const g_vecDependencyPaths = [g_strPackagePath, g_strRuntimePath];
const g_mapOriginalDependencies = new Map(g_vecDependencyPaths.map((strModulePath) => [strModulePath, require.cache[strModulePath]]));
const g_nMinimumEventInteger = -2147483648;
const g_nMaximumEventInteger = 2147483647;
const g_vecExpectedExports = [
	"BooleanEventVariableTemplate",
	"BoolVariable",
	"ByteEventVariableTemplate",
	"ByteVariable",
	"CoerceEventVariable",
	"CoerceEventVariableValue",
	"CreateEventVariable",
	"CreateEventVariableDefinition",
	"EventVariable",
	"EventVariableTemplate",
	"FloatEventVariableTemplate",
	"FloatVariable",
	"GetEventVariableTypes",
	"InferEventVariable",
	"InferEventVariableType",
	"LongEventVariableTemplate",
	"LongVariable",
	"ShortEventVariableTemplate",
	"ShortVariable",
	"StringEventVariableTemplate",
	"StringVariable",
];
const g_vecDocumentedExportNames = [
	"BooleanEventVariableTemplate",
	"ByteVariable",
	"CoerceEventVariableValue",
	"CreateEventVariableDefinition",
	"EventVariable",
	"EventVariableTemplate",
	"FloatEventVariableTemplate",
	"GetEventVariableTypes",
	"InferEventVariableType",
	"LongVariable",
	"ShortEventVariableTemplate",
	"StringVariable",
];
const g_vecNativeCallLog = [];

function RequireVariableType(strType) {
	const setSupportedTypes = new Set([
		"bool",
		"byte",
		"short",
		"long",
		"float",
		"string",
		"local",
		"wstring",
	]);
	if ((typeof strType !== "string") || !setSupportedTypes.has(strType)) {
		throw new TypeError("event variable type must be canonical.");
	}

	return strType;
}

function InferVariableType(Value) {
	if (typeof Value === "boolean") {
		return "bool";
	}

	if (typeof Value === "number") {
		return (Number.isInteger(Value) && !Object.is(Value, -0) && (Value >= g_nMinimumEventInteger) && (Value <= g_nMaximumEventInteger)) ? "long" : "float";
	}

	return "string";
}

function ExtractJavaScriptBlocks(strMarkdown) {
	const vecBlocks = [];
	const Expression = /```js\r?\n([\s\S]*?)\r?\n```/g;
	let vecMatch = null;
	while ((vecMatch = Expression.exec(strMarkdown)) !== null) {
		vecBlocks.push(vecMatch[1]);
	}

	return vecBlocks;
}

function ExecuteDocumentationBlock(strSource, unBlockIndex, Modules) {
	const PluginModule = { exports: {} };
	const BlockRequire = (strModuleName) => {
		if (!Object.hasOwn(Modules, strModuleName)) {
			throw new Error(`Unexpected documentation import: ${strModuleName}`);
		}

		return Modules[strModuleName];
	};
	const RejectDocumentationConsole = () => {
		throw new Error("Event variable documentation must use the typed logger.");
	};
	const DocumentationConsole = new Proxy({}, { get: RejectDocumentationConsole });
	const Execute = new Function("require", "module", "exports", "console", `"use strict";\n${strSource}\n//# sourceURL=events-variable.md:block-${unBlockIndex + 1}`);

	Execute(BlockRequire, PluginModule, PluginModule.exports, DocumentationConsole);

	if ((PluginModule.exports !== null) && (PluginModule.exports !== undefined)) {
		g_Assert.equal(Object.hasOwn(PluginModule.exports, "unload"), false, "Documentation must use the canonical Unload lifecycle.");

		if (typeof PluginModule.exports.Unload === "function") {
			PluginModule.exports.Unload();
		}
	}
}

function VerifyDocumentationExecutorContracts() {
	const State = { UnloadCount: 0 };
	const Modules = { State };
	ExecuteDocumentationBlock('module.exports.Unload = () => require("State").UnloadCount++;', 0, Modules);
	g_Assert.equal(State.UnloadCount, 1);
	ExecuteDocumentationBlock("module.exports = null;", 0, {});
	ExecuteDocumentationBlock("module.exports = undefined;", 0, {});
	g_Assert.throws(() => ExecuteDocumentationBlock('console.log("Unexpected console output");', 0, {}), /must use the typed logger/);
	g_Assert.throws(() => ExecuteDocumentationBlock("module.exports.unload = () => {};", 0, {}), /canonical Unload/);
	g_Assert.throws(() => ExecuteDocumentationBlock('require("Unknown");', 0, {}), /Unexpected documentation import/);
	g_Assert.throws(() => ExecuteDocumentationBlock('require("Inherited");', 0, Object.create({ Inherited: {} })), /Unexpected documentation import/);
}

function TrackExports(ModuleExports, setExercisedExports) {
	return new Proxy(ModuleExports, {
		get(Target, PropertyKey, Receiver) {
			const Value = Reflect.get(Target, PropertyKey, Receiver);
			if ((typeof PropertyKey !== "string") || !g_vecExpectedExports.includes(PropertyKey)) {
				return Value;
			}

			if (PropertyKey.endsWith("Template") || (PropertyKey.endsWith("Variable") && !PropertyKey.startsWith("Create") && !PropertyKey.startsWith("Infer") && !PropertyKey.startsWith("Coerce"))) {
				return new Proxy(Value, {
					construct(Constructor, vecArguments, NewTarget) {
						setExercisedExports.add(PropertyKey);

						return Reflect.construct(Constructor, vecArguments, NewTarget);
					},
				});
			}

			return (...vecArguments) => {
				setExercisedExports.add(PropertyKey);

				return Reflect.apply(Value, Target, vecArguments);
			};
		},
	});
}

function TrackTemplateMembers(Prototype, setExercisedMembers) {
	const OriginalDefineEventVariable = Prototype.DefineEventVariable;
	const OriginalSetterType = Object.getOwnPropertyDescriptor(Prototype, "SetterType");

	Prototype.DefineEventVariable = function DefineTrackedEventVariable(...vecArguments) {
		setExercisedMembers.add("DefineEventVariable");

		return Reflect.apply(OriginalDefineEventVariable, this, vecArguments);
	};
	Object.defineProperty(Prototype, "SetterType", {
		configurable: OriginalSetterType.configurable,
		enumerable: OriginalSetterType.enumerable,
		get() {
			setExercisedMembers.add("SetterType");

			return Reflect.apply(OriginalSetterType.get, this, []);
		},
	});

	return function RestoreTemplateMembers() {
		Prototype.DefineEventVariable = OriginalDefineEventVariable;
		Object.defineProperty(Prototype, "SetterType", OriginalSetterType);
	};
}

function AssertVariableValueContracts(VariableAPI) {
	const vecInferenceCases = [
		{ Value: -0, Type: "float" },
		{ Value: 0, Type: "long" },
		{ Value: g_nMinimumEventInteger, Type: "long" },
		{ Value: g_nMaximumEventInteger, Type: "long" },
		{ Value: g_nMinimumEventInteger - 1, Type: "float" },
		{ Value: g_nMaximumEventInteger + 1, Type: "float" },
		{ Value: NaN, Type: "float" },
		{ Value: Infinity, Type: "float" },
		{ Value: -Infinity, Type: "float" },
		{ Value: 1n, Type: "string" },
	];
	for (const InferenceCase of vecInferenceCases) {
		g_Assert.equal(VariableAPI.InferEventVariableType(InferenceCase.Value), InferenceCase.Type);
		const Definition = VariableAPI.CreateEventVariableDefinition("InferenceBoundary", undefined, InferenceCase.Value);
		g_Assert.equal(Definition.Type, InferenceCase.Type);
		g_Assert.equal(Object.is(Definition.DefaultValue, InferenceCase.Value), true);
	}

	g_Assert.equal(VariableAPI.InferEventVariableType, VariableAPI.InferEventVariable);
	g_Assert.equal(VariableAPI.CoerceEventVariableValue, VariableAPI.CoerceEventVariable);

	for (const ClassPair of [
		{ Canonical: "BooleanEventVariableTemplate", Established: "BoolVariable" },
		{ Canonical: "ByteEventVariableTemplate", Established: "ByteVariable" },
		{ Canonical: "ShortEventVariableTemplate", Established: "ShortVariable" },
		{ Canonical: "LongEventVariableTemplate", Established: "LongVariable" },
		{ Canonical: "FloatEventVariableTemplate", Established: "FloatVariable" },
		{ Canonical: "StringEventVariableTemplate", Established: "StringVariable" },
	]) {
		g_Assert.equal(VariableAPI[ClassPair.Canonical], VariableAPI[ClassPair.Established]);
	}

	const MutableTemplate = new VariableAPI.EventVariableTemplate("long", "Original comment", 0);
	const InitialDefinition = MutableTemplate.DefineEventVariable("Initial");
	const SharedTemplateDefault = { Enabled: true };

	MutableTemplate.Type = "float";
	MutableTemplate.Comment = "Updated comment";
	MutableTemplate.DefaultValue = SharedTemplateDefault;
	const UpdatedDefinition = MutableTemplate.DefineEventVariable("Updated");
	g_Assert.equal(MutableTemplate.SetterType, "float");
	g_Assert.equal(UpdatedDefinition.Type, "float");
	g_Assert.equal(UpdatedDefinition.DefaultValue, SharedTemplateDefault, "Template defaults must not be coerced or cloned.");
	g_Assert.equal(InitialDefinition.Type, "long");
	g_Assert.equal(InitialDefinition.DefaultValue, 0);
	g_Assert.equal(Object.hasOwn(UpdatedDefinition, "Comment"), false);

	SharedTemplateDefault.Enabled = false;
	g_Assert.equal(UpdatedDefinition.DefaultValue.Enabled, false);

	g_Assert.equal(VariableAPI.CoerceEventVariableValue(), "undefined");
	g_Assert.throws(() => VariableAPI.CoerceEventVariableValue(undefined), TypeError);
	g_Assert.throws(() => VariableAPI.CoerceEventVariableValue(null), TypeError);

	for (const strType of ["byte", "short", "long", "float"]) {
		g_Assert.throws(() => VariableAPI.CoerceEventVariableValue(strType, 1n), TypeError);
		g_Assert.throws(() => VariableAPI.CoerceEventVariableValue(strType, Symbol("NotNumeric")), TypeError);
	}

	g_Assert.throws(() => VariableAPI.CoerceEventVariableValue("string", Symbol("NotString")), TypeError);

	const dblUnroundedValue = 1.0000000001;
	g_Assert.equal(VariableAPI.CoerceEventVariableValue("float", dblUnroundedValue), dblUnroundedValue);
	g_Assert.notEqual(dblUnroundedValue, Math.fround(dblUnroundedValue));

	let unStringConversionCount = 0;
	const StringSource = {
		toString() {
			++unStringConversionCount;

			return "A\0B\uD800";
		},
	};
	g_Assert.equal(VariableAPI.CoerceEventVariableValue("string", StringSource), "A\0B\uFFFD");
	g_Assert.equal(unStringConversionCount, 1);

	const ConversionFailure = new Error("Original conversion failure.");
	const ThrowingValue = {
		[Symbol.toPrimitive]() {
			throw ConversionFailure;
		},
	};
	for (const strType of ["long", "float", "string"]) {
		g_Assert.throws(() => VariableAPI.CoerceEventVariableValue(strType, ThrowingValue), (Failure) => Failure === ConversionFailure);
	}

	const SharedDefault = { Enabled: true };
	const FirstDefinition = VariableAPI.CreateEventVariableDefinition("First", "string", SharedDefault);
	const SecondDefinition = VariableAPI.CreateEventVariableDefinition("Second", "string", SharedDefault);
	g_Assert.equal(FirstDefinition.DefaultValue, SharedDefault);
	g_Assert.equal(SecondDefinition.DefaultValue, SharedDefault);
	SharedDefault.Enabled = false;
	g_Assert.equal(FirstDefinition.DefaultValue.Enabled, false);

	const OriginalDefaultProperty = Object.getOwnPropertyDescriptor(Object.prototype, "DefaultValue");
	const vecInheritedWrites = [];
	try {
		Object.defineProperty(Object.prototype, "DefaultValue", {
			configurable: true,
			set(Value) {
				vecInheritedWrites.push(Value);
			},
		});
		const Definition = VariableAPI.CreateEventVariableDefinition("OwnDefault", "bool", true);
		g_Assert.deepEqual(Object.getOwnPropertyDescriptor(Definition, "DefaultValue"), { value: true, enumerable: true, writable: true, configurable: true });
		g_Assert.equal(vecInheritedWrites.length, 0);
	} finally {
		if (OriginalDefaultProperty === undefined) {
			delete Object.prototype.DefaultValue;
		} else {
			Object.defineProperty(Object.prototype, "DefaultValue", OriginalDefaultProperty);
		}
	}

	g_Assert.deepEqual(Object.getOwnPropertyDescriptor(Object.prototype, "DefaultValue"), OriginalDefaultProperty);
}

function CreateCustomPayload(Variables = {}, Overrides = {}) {
	const Payload = {};
	for (const [strVariableName, Definition] of Object.entries(Variables)) {
		const DefaultValue = Definition.DefaultValue;
		if (DefaultValue !== undefined) {
			Payload[strVariableName] = DefaultValue;
		}
	}

	return Object.assign(Payload, Overrides);
}

const g_NativeVariables = {
	CoerceEventVariable(strType, Value) {
		g_vecNativeCallLog.push(["CoerceEventVariable", strType, Value]);

		const strRequestedType = (arguments.length > 0) ? RequireVariableType(strType) : "string";
		if (strRequestedType === "bool") {
			return Boolean(Value);
		}

		if ((strRequestedType === "byte") || (strRequestedType === "short") || (strRequestedType === "long")) {
			return +Value | 0;
		}

		if (strRequestedType === "float") {
			return +Value;
		}

		return Buffer.from(`${Value}`, "utf8").toString("utf8");
	},
	CreateEventVariable(strName, strType, DefaultValue) {
		g_vecNativeCallLog.push(["CreateEventVariable", strName, strType, DefaultValue, arguments.length]);

		if (arguments.length === 0) {
			throw new Error("events/variable.CreateEventVariable(strName, strType?, DefaultValue?) expects a variable name.");
		}

		if ((typeof strName !== "string") || (strName.length === 0)) {
			throw new TypeError("events/variable.CreateEventVariable(strName, strType?, DefaultValue?) expects strName to be a non-empty string.");
		}

		const Definition = { Name: strName, Type: ((strType === undefined) || (strType === null)) ? InferVariableType(DefaultValue) : RequireVariableType(strType) };
		if (arguments.length > 2) {
			Object.defineProperty(Definition, "DefaultValue", { value: DefaultValue, enumerable: true, writable: true, configurable: true });
		}

		return Definition;
	},
	InferEventVariable(Value) {
		g_vecNativeCallLog.push(["InferEventVariable", Value]);

		return InferVariableType(Value);
	},
	GetEventVariableTypes() {
		g_vecNativeCallLog.push(["GetEventVariableTypes"]);

		return [
			"bool",
			"byte",
			"short",
			"long",
			"float",
			"string",
			"local",
			"wstring",
		];
	},
};

const g_CustomEvents = {
	CreateCustomEvent(strName, Variables) {
		const FireEvent = function FireEvent() {
			return true;
		};
		const strResourceText = `"${strName}"\n{\n}\n`;

		return {
			EventName: strName,
			EventVariables: Variables,
			EventResourceText: strResourceText,
			FireEvent,
			Fire: FireEvent,
			Name: strName,
			ResourceText: strResourceText,
			Variables,
		};
	},
	CreateEventPayload: CreateCustomPayload,
};

try {
	VerifyDocumentationExecutorContracts();

	g_Module._load = function Load(strRequestName, ParentModule, bIsMain) {
		if (strRequestName === "internal/runtime") {
			return require(g_strRuntimePath);
		}

		return g_OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
	};

	globalThis.sourcejs = { "events/variable": g_NativeVariables };

	for (const strModulePath of g_vecDependencyPaths) {
		delete require.cache[strModulePath];
	}

	const g_VariableAPI = require(g_strPackagePath);
	g_Assert.strictEqual(g_VariableAPI, g_NativeVariables);
	g_Assert.deepEqual(Object.keys(g_VariableAPI).sort(), g_vecExpectedExports.slice().sort());
	g_Assert.strictEqual(g_VariableAPI.CreateEventVariableDefinition, g_NativeVariables.CreateEventVariableDefinition);
	g_Assert.strictEqual(g_VariableAPI.InferEventVariableType, g_NativeVariables.InferEventVariableType);
	g_Assert.strictEqual(g_VariableAPI.CoerceEventVariableValue, g_NativeVariables.CoerceEventVariableValue);
	g_Assert.strictEqual(g_VariableAPI.GetEventVariableTypes, g_NativeVariables.GetEventVariableTypes);

	const g_ValueWithoutDefault = new g_VariableAPI.EventVariable("Message", "string");
	const g_ValueWithDefault = new g_VariableAPI.EventVariable("UserID", "short", 7);
	g_Assert.deepEqual(Object.keys(g_ValueWithoutDefault).sort(), ["Name", "Type"]);
	g_Assert.deepEqual(Object.keys(g_ValueWithDefault).sort(), ["DefaultValue", "Name", "Type"]);
	g_Assert.equal(Object.hasOwn(g_ValueWithoutDefault, "DefaultValue"), false);
	g_Assert.equal(g_ValueWithDefault.DefaultValue, 7);
	g_Assert.equal(g_ValueWithDefault.Name, "UserID");
	g_Assert.equal(g_ValueWithDefault.Type, "short");
	g_Assert.equal(typeof g_ValueWithDefault.toJSON, "undefined");

	const g_CreateNativeEventVariableDefinition = g_NativeVariables.CreateEventVariableDefinition;
	let g_unReplacementCreateCallCount = 0;
	g_NativeVariables.CreateEventVariableDefinition = (...vecArguments) => {
		g_unReplacementCreateCallCount += 1;

		return g_CreateNativeEventVariableDefinition(...vecArguments);
	};
	try {
		new g_VariableAPI.EventVariable("LiveCreate", "long", 1);
		g_Assert.equal(g_unReplacementCreateCallCount, 1);
	} finally {
		g_NativeVariables.CreateEventVariableDefinition = g_CreateNativeEventVariableDefinition;
	}

	const g_BooleanVariable = new g_VariableAPI.BooleanEventVariableTemplate("enabled flag", true);
	const g_ByteVariable = new g_VariableAPI.ByteEventVariableTemplate("byte value", 3);
	const g_FloatVariable = new g_VariableAPI.FloatEventVariableTemplate("float value", 1.25);
	const g_UndefinedDefaultTemplate = new g_VariableAPI.EventVariableTemplate("bool", "explicit undefined", undefined);
	g_Assert.equal(g_BooleanVariable.Type, "bool");
	g_Assert.equal(g_BooleanVariable.SetterType, "bool");
	g_Assert.equal(g_ByteVariable.Type, "byte");
	g_Assert.equal(g_ByteVariable.SetterType, "int");
	g_Assert.equal(g_FloatVariable.Type, "float");
	g_Assert.equal(g_FloatVariable.SetterType, "float");
	g_Assert.equal(g_UndefinedDefaultTemplate.DefaultValue, false);
	g_Assert.equal(typeof g_BooleanVariable.Name, "undefined");
	// Deliberate obsolete public fields: these must remain absent.
	g_Assert.equal(typeof g_BooleanVariable.method, "undefined");
	g_Assert.equal(typeof g_BooleanVariable.toJSON, "undefined");
	g_Assert.throws(() => new g_VariableAPI.EventVariableTemplate("unknown"), /Unsupported event variable type/);

	let g_unTypeCoercionCount = 0;
	const g_CoercibleEventVariableType = {
		[Symbol.toPrimitive]() {
			g_unTypeCoercionCount += 1;

			return "bool";
		},
	};
	g_Assert.throws(() => new g_VariableAPI.EventVariableTemplate(g_CoercibleEventVariableType), /types must be strings/);
	g_Assert.equal(g_unTypeCoercionCount, 0);

	for (const InvalidEventVariableType of [null, undefined, false, 1, Symbol("bool"), new String("bool")]) {
		g_Assert.throws(() => new g_VariableAPI.EventVariableTemplate(InvalidEventVariableType), /types must be strings/);
	}

	const g_NegativeByteVariable = new g_VariableAPI.ByteVariable("Unclamped default", -1);
	g_Assert.equal(g_NegativeByteVariable.DefaultValue, -1);

	g_Assert.throws(() => new g_VariableAPI.BooleanEventVariableTemplate(7), /comments must be strings/);

	const g_DefinedVariable = g_BooleanVariable.DefineEventVariable("Enabled");
	g_Assert.equal(g_DefinedVariable instanceof g_VariableAPI.EventVariable, true);
	g_Assert.equal(g_DefinedVariable.Name, "Enabled");
	g_Assert.equal(g_DefinedVariable.DefaultValue, true);
	g_Assert.deepEqual(g_CustomEvents.CreateEventPayload({ Enabled: g_BooleanVariable }), { Enabled: true });
	g_Assert.equal(g_VariableAPI.InferEventVariableType(true), "bool");
	g_Assert.equal(g_VariableAPI.CoerceEventVariableValue("long", "12"), 12);
	g_Assert.throws(() => g_VariableAPI.CoerceEventVariableValue("integer", "12"), /canonical/);
	g_Assert.throws(() => g_VariableAPI.CreateEventVariableDefinition("InvalidType", "number"), /canonical/);
	g_Assert.throws(() => g_VariableAPI.CreateEventVariableDefinition("", "string"), /non-empty string/);
	g_Assert.throws(() => g_VariableAPI.CreateEventVariableDefinition(7, "string"), /non-empty string/);
	g_Assert.deepEqual(g_VariableAPI.GetEventVariableTypes(), [
		"bool",
		"byte",
		"short",
		"long",
		"float",
		"string",
		"local",
		"wstring",
	]);
	g_Assert.equal(Object.hasOwn(g_VariableAPI, "moduleName"), false);
	g_Assert.equal(Object.hasOwn(g_VariableAPI, "default"), false);
	const g_unMinimumNativeCallCount = 6;
	g_Assert.equal(g_vecNativeCallLog.length >= g_unMinimumNativeCallCount, true);

	const g_unExpectedDocumentationBlockCount = 9;
	const g_strDocumentation = g_FileSystem.readFileSync(g_strDocumentationPath, "utf8");
	const g_vecDocumentationBlocks = ExtractJavaScriptBlocks(g_strDocumentation);
	const g_setExercisedExports = new Set();
	const g_setExercisedTemplateMembers = new Set();
	const g_DocumentedVariables = TrackExports(g_VariableAPI, g_setExercisedExports);
	const g_RestoreTemplateMembers = TrackTemplateMembers(g_VariableAPI.EventVariableTemplate.prototype, g_setExercisedTemplateMembers);

	try {
		g_Assert.equal(g_vecDocumentationBlocks.length, g_unExpectedDocumentationBlockCount);
		AssertVariableValueContracts(g_VariableAPI);
		g_Assert.doesNotMatch(g_strDocumentation, /generated by|auto-generated|example generator/i);
		g_Assert.doesNotMatch(g_strDocumentation, /moduleName|toJSON|source\.events|\bintVariable\b/);
		g_Assert.doesNotMatch(g_strDocumentation, /\bconsole\./, "Executable event-variable documentation must use typed logging.");

		for (const strSource of g_vecDocumentationBlocks) {
			new g_VM.Script(`"use strict";\n${strSource}`);
		}

		g_setExercisedExports.clear();
		g_setExercisedTemplateMembers.clear();
		g_Assert.equal(g_setExercisedExports.size + g_setExercisedTemplateMembers.size, 0, "Only executable documentation may populate coverage.");

		for (const [unBlockIndex, strSource] of g_vecDocumentationBlocks.entries()) {
			ExecuteDocumentationBlock(strSource, unBlockIndex, { "events/custom": g_CustomEvents, "events/variable": g_DocumentedVariables });
		}
	} finally {
		g_RestoreTemplateMembers();
	}

	for (const strExportName of g_vecDocumentedExportNames) {
		g_Assert.equal(g_setExercisedExports.has(strExportName), true, `Documentation did not exercise events/variable.${strExportName}.`);
	}

	for (const strMemberName of ["DefineEventVariable", "SetterType"]) {
		g_Assert.equal(g_setExercisedTemplateMembers.has(strMemberName), true, `Documentation did not exercise EventVariableTemplate.${strMemberName}.`);
	}

	delete require.cache[g_strPackagePath];
	delete require.cache[g_strRuntimePath];
	delete globalThis.sourcejs;

	g_Assert.throws(() => require(g_strPackagePath), { name: "Error", message: /^SourceJS native runtime is not installed/ });

	console.log("[smoke_events_variable] package and documentation passed with native doubles; native SDK execution not exercised");
} finally {
	for (const strModulePath of g_vecDependencyPaths) {
		const OriginalDependency = g_mapOriginalDependencies.get(strModulePath);
		if (OriginalDependency === undefined) {
			delete require.cache[strModulePath];
		} else {
			require.cache[strModulePath] = OriginalDependency;
		}
	}

	if (g_OriginalNativeDescriptor === undefined) {
		delete globalThis.sourcejs;
	} else {
		Object.defineProperty(globalThis, "sourcejs", g_OriginalNativeDescriptor);
	}

	g_Module._load = g_OriginalModuleLoad;
}
