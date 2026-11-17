#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strProjectRoot = g_Path.resolve(__dirname, "..");
const g_strCustomDocumentationPath = g_Path.join(g_strProjectRoot, "docs", "api", "events-custom.md");
const g_strCustomPath = g_Path.join(g_strProjectRoot, "packages", "sourcejs", "events", "custom.js");
const g_strRuntimePath = g_Path.join(g_strProjectRoot, "packages", "sourcejs", "internal", "runtime.js");

const g_OriginalModuleLoad = g_Module._load;
g_Module._load = function Load(strRequestName, ParentModule, bIsMain) {
	if (strRequestName === "internal/runtime") {
		return require(g_strRuntimePath);
	}

	return g_OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
};

const g_vecExpectedExports = [
	"CreateCustomEvent",
	"CreateEventPayload",
	"CreateEventResourceText",
	"FireEvent",
];

// Controlled event/resource/payload doubles do not execute the engine or prove its ABI.
const g_nMinimumSignedInteger32 = -0x80000000;
const g_nMaximumSignedInteger32 = 0x7FFFFFFF;
const g_vecEventVariableTypes = [
	"bool",
	"byte",
	"short",
	"long",
	"float",
	"string",
	"local",
	"wstring",
];
const g_flMaximumNativeFloat = 3.4028234663852886e38;
const g_unMaximumUnsignedInteger64 = 0xFFFFFFFFFFFFFFFFn;

function RequireNonEmptyString(strValue, strOperation, bAllowEmbeddedNull = false) {
	if ((typeof strValue !== "string") || (strValue.length === 0)) {
		throw new TypeError(`${strOperation} expects a non-empty string.`);
	}

	if (!bAllowEmbeddedNull && strValue.includes("\0")) {
		throw new TypeError(strOperation + " does not accept an embedded NUL.");
	}

	return strValue;
}

function RequireObject(Value, strOperation) {
	if ((Value === null) || (typeof Value !== "object") || Array.isArray(Value)) {
		throw new TypeError(`${strOperation} expects an object.`);
	}

	return Value;
}

function RequireEventType(strType) {
	if ((typeof strType !== "string") || !g_vecEventVariableTypes.includes(strType)) {
		throw new TypeError("Event type must use an exact supported spelling.");
	}

	return strType;
}

function InferType(Value) {
	if (typeof Value === "boolean") {
		return "bool";
	}

	if (Number.isInteger(Value) && !Object.is(Value, -0) && (Value >= g_nMinimumSignedInteger32) && (Value <= g_nMaximumSignedInteger32)) {
		return "long";
	}

	if (typeof Value === "number") {
		return "float";
	}

	return "string";
}

function GetDefinitionType(Definition) {
	if (typeof Definition === "string") {
		return RequireEventType(Definition);
	}

	if ((Definition !== null) && ((typeof Definition === "object") || (typeof Definition === "function"))) {
		const Type = Definition.Type;
		if (typeof Type === "string") {
			return RequireEventType(Type);
		}

		const DefaultValue = Definition.DefaultValue;
		if (DefaultValue !== undefined) {
			return InferType(DefaultValue);
		}
	}

	return InferType(Definition);
}

function RenderResourceText(strName, Variables = {}) {
	RequireNonEmptyString(strName, "events/custom.CreateEventResourceText strName", true);
	RequireObject(Variables, "events/custom.CreateEventResourceText Variables");

	let strText = `"${strName.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"\n{\n`;

	const vecVariableNames = Object.keys(Variables);
	for (const strVariableName of vecVariableNames) {
		const Definition = Variables[strVariableName];
		const strEscapedName = strVariableName.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
		strText += `\t"${strEscapedName}"\t"${GetDefinitionType(Definition)}"\n`;
	}

	strText += "}\n";

	return strText;
}

function BuildPayload(Variables = {}, Overrides = {}) {
	RequireObject(Variables, "events/custom.CreateEventPayload Variables");
	RequireObject(Overrides, "events/custom.CreateEventPayload Overrides");

	const Result = {};
	const vecVariableNames = Object.keys(Variables);
	for (const strName of vecVariableNames) {
		const Definition = Variables[strName];
		if ((Definition !== null) && ((typeof Definition === "object") || (typeof Definition === "function"))) {
			const DefaultValue = Definition.DefaultValue;
			if (DefaultValue !== undefined) {
				Object.defineProperty(Result, strName, { value: DefaultValue, enumerable: true, writable: true, configurable: true });
			}

		} else if (typeof Definition !== "string") {
			Object.defineProperty(Result, strName, { value: Definition, enumerable: true, writable: true, configurable: true });
		}
	}

	const vecOverrideNames = Object.keys(Overrides);
	for (const strName of vecOverrideNames) {
		Object.defineProperty(Result, strName, { value: Overrides[strName], enumerable: true, writable: true, configurable: true });
	}

	return Result;
}

function BuildValidatedEventPayload(EventPayload) {
	RequireObject(EventPayload, "events/custom.FireEvent EventPayload");

	const NativePayload = {};
	const vecNames = Object.keys(EventPayload);
	for (const strName of vecNames) {
		RequireNonEmptyString(strName, "events/custom.FireEvent EventPayload key");
		const Value = EventPayload[strName];

		if ((typeof Value === "boolean") || (typeof Value === "string")) {
			if ((typeof Value === "string") && Value.includes("\0")) {
				throw new TypeError("events/custom.FireEvent EventPayload strings must not contain an embedded NUL.");
			}

			Object.defineProperty(NativePayload, strName, { value: Value, enumerable: true, writable: true, configurable: true });
			continue;
		}

		if ((typeof Value === "number") && Number.isFinite(Value) && (Math.abs(Value) <= g_flMaximumNativeFloat)) {
			const bSignedInteger = Number.isInteger(Value) && (Value >= g_nMinimumSignedInteger32) && (Value <= g_nMaximumSignedInteger32) && !Object.is(Value, -0);
			Object.defineProperty(NativePayload, strName, { value: bSignedInteger ? Value : Math.fround(Value), enumerable: true, writable: true, configurable: true });
			continue;
		}

		if ((typeof Value === "bigint") && (Value >= 0n) && (Value <= g_unMaximumUnsignedInteger64)) {
			Object.defineProperty(NativePayload, strName, { value: Value, enumerable: true, writable: true, configurable: true });
			continue;
		}

		throw new TypeError("events/custom.FireEvent EventPayload contains an unsupported value.");
	}

	return NativePayload;
}

function CreateNativeCustomEvents(mapEventDefinitions = null) {
	const vecFiredEvents = [];
	const NativeCustomEvents = {
		CreateCustomEvent(strName, Variables = {}) {
			RequireNonEmptyString(strName, "events/custom.CreateCustomEvent strName", true);
			RequireObject(Variables, "events/custom.CreateCustomEvent Variables");

			const CustomEvent = {
				EventName: strName,
				EventVariables: Variables,
				EventResourceText: RenderResourceText(strName, Variables),
				FireEvent(Overrides = {}, bDoNotBroadcast = false) {
					RequireObject(Overrides, "Custom event fire overrides");

					if (typeof bDoNotBroadcast !== "boolean") {
						throw new TypeError("Custom event FireEvent bDoNotBroadcast expects a boolean.");
					}

					return NativeCustomEvents.FireEvent(this.EventName, BuildPayload(this.EventVariables, Overrides), bDoNotBroadcast);
				},
			};

			return CustomEvent;
		},
		FireEvent(strName, EventPayload = {}, bDoNotBroadcast = false) {
			RequireNonEmptyString(strName, "events/custom.FireEvent strName");

			if ((mapEventDefinitions !== null) && !mapEventDefinitions.has(strName)) {
				throw new Error(`The engine does not know event ${strName}; load its resource first.`);
			}

			const NativePayload = BuildValidatedEventPayload(EventPayload);

			if (typeof bDoNotBroadcast !== "boolean") {
				throw new TypeError("events/custom.FireEvent bDoNotBroadcast expects a boolean.");
			}

			vecFiredEvents.push({ DoNotBroadcast: bDoNotBroadcast, Name: strName, Payload: NativePayload });

			return true;
		},
		CreateEventPayload: BuildPayload,
		CreateEventResourceText: RenderResourceText,
	};

	return { FiredEvents: vecFiredEvents, NativeCustomEvents };
}

function CreateDocumentationResourceModule(mapEventDefinitions, ResourceOptions = {}) {
	class DocumentationEventResourceFile {
		constructor(strEventResourceFilePath, ...vecEventResources) {
			this.#m_strEventResourceFilePath = strEventResourceFilePath;
			this.#m_mapEventResources = new Map();
			this.#m_bWritten = false;

			for (const EventResource of vecEventResources) {
				RequireNonEmptyString(EventResource.EventName, "Resource event name");
				RequireObject(EventResource.EventVariables, "Resource event variables");
				this.#m_mapEventResources.set(EventResource.EventName, EventResource.EventVariables);
			}
		}

		WriteEventResourceFile() {
			if (ResourceOptions.WriteError) {
				throw ResourceOptions.WriteError;
			}

			this.#m_mapEventResources.forEach((EventVariables, strEventName) => RenderResourceText(strEventName, EventVariables));
			this.#m_bWritten = true;

			return this.#m_strEventResourceFilePath;
		}

		LoadEventsFromFile() {
			g_Assert.equal(this.#m_bWritten, true, "The event resource must be written before it is loaded.");

			if (ResourceOptions.LoadFailure) {
				return 0;
			}

			this.#m_mapEventResources.forEach((EventVariables, strEventName) => mapEventDefinitions.set(strEventName, EventVariables));

			return this.#m_mapEventResources.size;
		}

		#m_strEventResourceFilePath;
		#m_mapEventResources;
		#m_bWritten;
	}

	return { EventResourceFile: DocumentationEventResourceFile };
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
	const Context = g_VM.createContext({
		console: {
			log() {
				throw new Error("Custom event documentation must use the typed logger.");
			},
		},
		require(strModuleName) {
			if (!Object.hasOwn(Modules, strModuleName)) {
				throw new Error(`Unexpected documentation import: ${strModuleName}`);
			}

			return Modules[strModuleName];
		},
	});

	g_VM.runInContext(`"use strict";\n${strSource}`, Context, { filename: `events-custom.md:block-${unBlockIndex + 1}` });
}

function VerifyLoadedCustomEventDocumentation(vecBlocks) {
	for (const unBlockIndex of [1, 2, 3, 5]) {
		for (const strScenario of ["Loaded", "WriteFailure", "LoadFailure"]) {
			const mapEventDefinitions = new Map();
			const Fixture = CreateNativeCustomEvents(mapEventDefinitions);
			const WriteError = new Error("The event resource write failed.");
			const ResourceOptions = { WriteError: (strScenario === "WriteFailure") ? WriteError : null, LoadFailure: strScenario === "LoadFailure" };
			const WrapperModule = { exports: {} };
			const WrapperContext = g_VM.createContext({
				module: WrapperModule,
				require(strModuleName) {
					g_Assert.equal(strModuleName, "internal/runtime");

					return {
						GetModule(strNativeModuleName) {
							g_Assert.equal(strNativeModuleName, "events/custom");

							return Fixture.NativeCustomEvents;
						},
					};
				},
			});
			g_VM.runInContext(g_FileSystem.readFileSync(g_strCustomPath, "utf8"), WrapperContext, { filename: g_strCustomPath });

			const Modules = {
				"events/custom": WrapperModule.exports,
				"events/resource": CreateDocumentationResourceModule(mapEventDefinitions, ResourceOptions),
				globals: { GetGlobalVariables: () => ({ MapName: "sourcejs_test_map", MaximumClients: 8 }) },
			};
			const Run = () => ExecuteDocumentationBlock(vecBlocks[unBlockIndex], unBlockIndex, Modules);
			if (strScenario === "Loaded") {
				Run();
				g_Assert.equal(Fixture.FiredEvents.length, 1);
				g_Assert.equal(mapEventDefinitions.has(Fixture.FiredEvents[0].Name), true);

			} else if (strScenario === "WriteFailure") {
				g_Assert.throws(Run, (ErrorValue) => ErrorValue === WriteError);

			} else {
				g_Assert.throws(Run, { name: "Error", message: /Unable to load/ }, "A resource load failure must stop documented event firing.");
			}

			if (strScenario !== "Loaded") {
				g_Assert.equal(Fixture.FiredEvents.length, 0, "A write/load failure must not fire an event.");
				g_Assert.equal(mapEventDefinitions.size, 0, "A failed resource operation must not publish event definitions.");
			}
		}
	}
}

function VerifyCustomEventEnumeration(CustomEvents, Fixture) {
	const IgnoredReadError = new Error("Ignored event properties must not be read.");
	const RejectIgnoredRead = () => {
		throw IgnoredReadError;
	};
	const Variables = Object.create({ Inherited: { DefaultValue: 99 } });
	Variables.Count = { Type: "long", DefaultValue: 1 };
	Variables.Label = { Type: "string", DefaultValue: "default" };
	Variables.TypeOnly = "long";
	Object.defineProperty(Variables, "Hidden", { get: RejectIgnoredRead });
	Object.defineProperty(Variables, Symbol("IgnoredVariable"), { enumerable: true, get: RejectIgnoredRead });

	const Overrides = Object.create({ InheritedOverride: 99 });
	Overrides.Count = 2;
	Object.defineProperty(Overrides, "HiddenOverride", { get: RejectIgnoredRead });
	Object.defineProperty(Overrides, Symbol("IgnoredOverride"), { enumerable: true, get: RejectIgnoredRead });

	const Payload = CustomEvents.CreateEventPayload(Variables, Overrides);
	g_Assert.deepEqual(Payload, { Count: 2, Label: "default" });
	g_Assert.deepEqual(Reflect.ownKeys(Payload), ["Count", "Label"]);
	g_Assert.equal(CustomEvents.CreateEventResourceText("SourceJSFilteredResource", Variables), '"SourceJSFilteredResource"\n{\n\t"Count"\t"long"\n\t"Label"\t"string"\n\t"TypeOnly"\t"long"\n}\n');
	g_Assert.equal(CustomEvents.FireEvent("SourceJSFilteredPayload", Overrides), true);
	g_Assert.deepEqual(Fixture.FiredEvents.at(-1).Payload, { Count: 2 });

	const SharedValue = { Value: 7 };
	const ShallowPayload = CustomEvents.CreateEventPayload({ Shared: { DefaultValue: SharedValue }, TypeOnly: "unvalidated" });
	g_Assert.strictEqual(ShallowPayload.Shared, SharedValue);
	g_Assert.equal(Object.hasOwn(ShallowPayload, "TypeOnly"), false);
	g_Assert.deepEqual(CustomEvents.CreateEventPayload(undefined, undefined), {});
	g_Assert.equal(CustomEvents.CreateCustomEvent("SourceJSUndefinedVariables", undefined).EventName, "SourceJSUndefinedVariables");

	const strEmbeddedNullName = "SourceJSName\0Suffix";
	const Descriptor = CustomEvents.CreateCustomEvent(strEmbeddedNullName);
	g_Assert.equal(Descriptor.EventName, strEmbeddedNullName);
	g_Assert.equal(Descriptor.EventResourceText.includes(strEmbeddedNullName), true, "Rendering is not validation of an engine-safe resource name.");
	g_Assert.equal(CustomEvents.CreateEventResourceText(strEmbeddedNullName).includes(strEmbeddedNullName), true);

	const unFiredEventCount = Fixture.FiredEvents.length;
	g_Assert.throws(() => Descriptor.FireEvent(), /NUL/);
	g_Assert.throws(() => CustomEvents.FireEvent(strEmbeddedNullName), /NUL/);
	g_Assert.equal(Fixture.FiredEvents.length, unFiredEventCount);

	const DefinitionError = new Error("Stop resource type inference.");
	let unLaterDefinitionReads = 0;
	const FirstDefinition = {
		get Type() {
			throw DefinitionError;
		},
	};
	const FailingResourceVariables = {
		First: FirstDefinition,
		get Later() {
			unLaterDefinitionReads++;

			return "long";
		},
	};
	g_Assert.throws(() => CustomEvents.CreateEventResourceText("SourceJSSequentialResourceRead", FailingResourceVariables), ErrorValue => ErrorValue === DefinitionError);
	g_Assert.equal(unLaterDefinitionReads, 0, "A failed definition must stop resource getters before later values are read.");
}

function TrackExports(ModuleExports, setExercisedExports) {
	return new Proxy(ModuleExports, {
		get(Target, PropertyKey, Receiver) {
			const Value = Reflect.get(Target, PropertyKey, Receiver);

			if ((typeof PropertyKey === "string") && g_vecExpectedExports.includes(PropertyKey) && (typeof Value === "function")) {
				return function TrackedExport(...vecArguments) {
					setExercisedExports.add(PropertyKey);

					return Reflect.apply(Value, Target, vecArguments);
				};
			}

			return Value;
		},
	});
}

const g_SourceJSDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
const g_CustomCacheEntry = require.cache[g_strCustomPath];
const g_RuntimeCacheEntry = require.cache[g_strRuntimePath];

try {
	const g_CustomFixture = CreateNativeCustomEvents();

	globalThis.sourcejs = { "events/custom": g_CustomFixture.NativeCustomEvents };
	delete require.cache[g_strCustomPath];
	delete require.cache[g_strRuntimePath];

	const g_CustomEvents = require(g_strCustomPath);

	g_Assert.deepEqual(Object.keys(g_CustomEvents).sort(), g_vecExpectedExports);
	g_Assert.throws(() => ExecuteDocumentationBlock('console.log("must fail");', 0, {}), /Custom event documentation must use the typed logger\./);
	g_Assert.equal(InferType(-0), "float", "Negative zero must remain a native float type, not an Int32 value.");
	g_Assert.equal(InferType(0), "long");
	g_Assert.equal(GetDefinitionType({ DefaultValue: -0 }), "float");
	g_Assert.match(g_CustomEvents.CreateEventResourceText("SourceJSNegativeZeroResource", { Value: -0 }), /"Value"\t"float"/);

	const g_strDocumentation = g_FileSystem.readFileSync(g_strCustomDocumentationPath, "utf8");
	const g_vecDocumentationBlocks = ExtractJavaScriptBlocks(g_strDocumentation);
	const g_setExercisedExports = new Set();
	const g_DocumentedCustomEvents = TrackExports(g_CustomEvents, g_setExercisedExports);

	const g_unExpectedDocumentationBlockCount = 6;
	g_Assert.equal(g_vecDocumentationBlocks.length, g_unExpectedDocumentationBlockCount, "Custom event documentation must retain all six executable blocks.");
	VerifyLoadedCustomEventDocumentation(g_vecDocumentationBlocks);
	g_Assert.doesNotMatch(g_strDocumentation, /generated by|auto-generated|example generator/i);
	g_Assert.doesNotMatch(g_strDocumentation, /arguments: \[|moduleName|CustomEventRegistry|source\.events/);
	g_Assert.doesNotMatch(g_strDocumentation, /\bconsole\.log\(/, "Executable custom-event documentation must use the typed logger.");

	for (const strSource of g_vecDocumentationBlocks) {
		new g_VM.Script(`"use strict";\n${strSource}`);
	}

	for (const [unBlockIndex, strSource] of g_vecDocumentationBlocks.entries()) {
		ExecuteDocumentationBlock(strSource, unBlockIndex, {
			"events/custom": g_DocumentedCustomEvents,
			"events/resource": CreateDocumentationResourceModule(new Map()),
			globals: {
				GetGlobalVariables() {
					return { MapName: "sourcejs_test_map", MaximumClients: 8 };
				},
			},
		});
	}

	for (const strExportName of g_vecExpectedExports) {
		g_Assert.equal(g_setExercisedExports.has(strExportName), true, `Documentation did not call events/custom.${strExportName}.`);
	}

	g_Assert.deepEqual(g_CustomFixture.FiredEvents.map((Event) => Event.Name), [
		"SourceJSRoundSummary",
		"SourceJSPopulation",
		"SourceJSTeamSummary",
		"SourceJSCacheRebuilt",
	]);
	g_Assert.equal(g_CustomFixture.FiredEvents[1].Payload.Map, "sourcejs_test_map");
	g_Assert.equal(g_CustomFixture.FiredEvents[1].Payload.MaximumClients, 8);

	const g_Variables = { Count: { Type: "long", DefaultValue: 1 } };
	const g_Descriptor = g_CustomEvents.CreateCustomEvent("SourceJSDescriptor", g_Variables);

	g_Assert.deepEqual(Object.keys(g_Descriptor).sort(), [
		"EventName",
		"EventResourceText",
		"EventVariables",
		"Fire",
		"FireEvent",
		"Name",
		"ResourceText",
		"Variables",
	]);
	g_Assert.equal(g_Descriptor.EventName, "SourceJSDescriptor");
	g_Assert.equal(g_Descriptor.Name, g_Descriptor.EventName);
	g_Assert.strictEqual(g_Descriptor.EventVariables, g_Variables);
	g_Assert.strictEqual(g_Descriptor.Variables, g_Variables);
	g_Assert.equal(typeof g_Descriptor.EventResourceText, "string");
	g_Assert.equal(g_Descriptor.ResourceText, g_Descriptor.EventResourceText);
	g_Assert.equal(typeof g_Descriptor.FireEvent, "function");
	g_Assert.strictEqual(g_Descriptor.Fire, g_Descriptor.FireEvent);
	g_Assert.deepEqual(g_CustomEvents.CreateEventPayload(g_Variables, { Count: 2 }), { Count: 2 });
	g_Assert.equal(g_Descriptor.FireEvent({ Count: 3 }, true), true);

	const g_ReassignedConvenienceVariables = { Count: { Type: "long", DefaultValue: 11 } };
	g_Descriptor.Variables = g_ReassignedConvenienceVariables;
	g_Assert.strictEqual(g_Descriptor.EventVariables, g_Variables, "Reassigning the convenience member must not replace canonical variables.");

	const g_ReassignedCanonicalVariables = { Count: { Type: "long", DefaultValue: 19 } };
	g_Descriptor.EventVariables = g_ReassignedCanonicalVariables;
	g_Assert.strictEqual(g_Descriptor.Variables, g_ReassignedConvenienceVariables, "Reassigning canonical variables must not synchronize the convenience member.");
	g_Assert.strictEqual(g_Descriptor.EventVariables, g_ReassignedCanonicalVariables);

	g_Assert.throws(() => g_CustomEvents.CreateCustomEvent("", {}), /non-empty string/);
	g_Assert.throws(() => g_CustomEvents.CreateCustomEvent("TestEvent", []), /expects an object/);
	g_Assert.throws(() => g_CustomEvents.CreateEventPayload({}, []), /expects an object/);
	g_Assert.throws(() => g_CustomEvents.FireEvent("TestEvent", { Invalid: null }, false), /unsupported value/);
	g_Assert.throws(() => g_CustomEvents.FireEvent("TestEvent", {}, 1), /expects a boolean/);
	g_Assert.equal(Object.hasOwn(g_CustomEvents, "CustomEvent"), false);
	g_Assert.equal(Object.hasOwn(g_CustomEvents, "runtime"), false);
	g_Assert.equal(Object.hasOwn(g_CustomEvents, "moduleName"), false);
	g_Assert.equal(Object.hasOwn(g_CustomEvents, "default"), false);

	for (const strType of g_vecEventVariableTypes) {
		g_Assert.ok(g_CustomEvents.CreateEventResourceText("SourceJSTypeContract", { Value: strType }).includes('"' + strType + '"'), "Resource types must retain their exact supported spelling.");
	}

	for (const strType of [
		"Boolean",
		"boolean",
		"double",
		"int",
		"integer",
		"number",
		"str",
		"Float",
		"unknown",
	]) {
		g_Assert.throws(() => g_CustomEvents.CreateEventResourceText("SourceJSTypeContract", { Value: strType }), { name: "TypeError", message: /exact supported spelling/ }, "Obsolete type aliases must not silently normalize or fall back to string.");
	}

	// This deliberate JavaScript-boundary key is not a project-owned identifier.
	const g_PrototypeVariables = Object.create(null);
	g_PrototypeVariables.__proto__ = { DefaultValue: { Marker: true } };
	const g_PrototypePayload = g_CustomEvents.CreateEventPayload(g_PrototypeVariables);
	g_Assert.equal(Object.getPrototypeOf(g_PrototypePayload), Object.prototype, "Payload defaults must not change the result prototype.");
	g_Assert.equal(Object.hasOwn(g_PrototypePayload, "__proto__"), true, "Payload defaults must preserve own data keys.");
	g_Assert.equal(g_PrototypePayload.__proto__.Marker, true);

	const g_PrototypeOverrides = Object.create(null);
	g_PrototypeOverrides.__proto__ = { Marker: true };
	const g_OverridePayload = g_CustomEvents.CreateEventPayload({}, g_PrototypeOverrides);
	g_Assert.equal(Object.getPrototypeOf(g_OverridePayload), Object.prototype, "Payload overrides must not change the result prototype.");
	g_Assert.equal(Object.hasOwn(g_OverridePayload, "__proto__"), true, "Payload overrides must preserve own data keys.");

	const g_InheritedDefinition = Object.create({ DefaultValue: 7 });
	g_Assert.equal(g_CustomEvents.CreateEventPayload({ Value: g_InheritedDefinition }).Value, 7, "Inherited defaults must follow native property lookup.");

	const g_UndefinedDescriptorPayload = g_CustomEvents.CreateEventPayload({ Value: { Type: "long", DefaultValue: undefined } });
	g_Assert.equal(Object.hasOwn(g_UndefinedDescriptorPayload, "Value"), false, "An undefined descriptor default must not create a payload field.");

	const g_UndefinedLiteralPayload = g_CustomEvents.CreateEventPayload({ Value: undefined });
	g_Assert.equal(Object.hasOwn(g_UndefinedLiteralPayload, "Value"), true, "A literal undefined default must retain its own payload field.");
	g_Assert.equal(g_UndefinedLiteralPayload.Value, undefined);

	const g_UndefinedOverridePayload = g_CustomEvents.CreateEventPayload({ Value: { DefaultValue: 7 } }, { Value: undefined });
	g_Assert.equal(Object.hasOwn(g_UndefinedOverridePayload, "Value"), true, "An undefined override must retain its own payload field.");
	g_Assert.equal(g_UndefinedOverridePayload.Value, undefined);

	const g_FunctionDefinition = () => {};
	g_FunctionDefinition.DefaultValue = 9;
	g_Assert.equal(g_CustomEvents.CreateEventPayload({ Value: g_FunctionDefinition }).Value, 9, "Function-valued definitions must retain their defaults.");

	const g_PayloadReadError = new Error("Controlled default read failure.");
	const g_FailingDefinition = {
		get DefaultValue() {
			throw g_PayloadReadError;
		},
	};
	const g_FailingVariables = { First: g_FailingDefinition };
	Object.defineProperty(g_FailingVariables, "Later", {
		enumerable: true,
		get() {
			throw new Error("Later variables must not be read after a failed default.");
		},
	});
	g_Assert.throws(() => g_CustomEvents.CreateEventPayload(g_FailingVariables), (ErrorValue) => ErrorValue === g_PayloadReadError, "A failed default must preserve its original error before reading later variables.");

	const g_unRejectedEventCount = g_CustomFixture.FiredEvents.length;
	for (const InvalidValue of [null, undefined, {}, [], NaN, Infinity, -1n, g_unMaximumUnsignedInteger64 + 1n]) {
		g_Assert.throws(() => g_CustomEvents.FireEvent("SourceJSRejectedPayload", { Value: InvalidValue }), { name: "TypeError", message: /unsupported value/ }, "Invalid payload values must fail before an event is committed.");
		g_Assert.equal(g_CustomFixture.FiredEvents.length, g_unRejectedEventCount, "Rejected payloads must not append a fired event.");
	}

	g_Assert.throws(() => g_CustomEvents.FireEvent("SourceJSRejectedPayload", { ["Key\0Suffix"]: 1 }), { name: "TypeError", message: /NUL/ });
	g_Assert.throws(() => g_CustomEvents.FireEvent("SourceJSRejectedPayload", { Value: "Value\0Suffix" }), { name: "TypeError", message: /NUL/ });
	g_Assert.equal(g_CustomFixture.FiredEvents.length, g_unRejectedEventCount, "Rejected NUL payloads must not append a fired event.");

	for (const unValue of [0n, g_unMaximumUnsignedInteger64]) {
		g_Assert.equal(g_CustomEvents.FireEvent("SourceJSUnsignedInteger64", { Value: unValue }), true);
		g_Assert.equal(g_CustomFixture.FiredEvents.at(-1).Payload.Value, unValue, "Unsigned 64-bit payloads must retain exact BigInt identity.");
	}

	let g_unPayloadReads = 0;
	const g_NonEnumerablePayload = {};
	Object.defineProperty(g_NonEnumerablePayload, "Value", {
		get() {
			g_unPayloadReads++;

			return 0.1;
		},
	});
	g_Assert.equal(g_CustomEvents.FireEvent("SourceJSSingleRead", g_NonEnumerablePayload), true);
	g_Assert.equal(g_unPayloadReads, 0, "Native V8 default key enumeration skips non-enumerable payload properties.");
	g_Assert.deepEqual(g_CustomFixture.FiredEvents.at(-1).Payload, {});

	const g_EnumerablePayload = {
		get Value() {
			g_unPayloadReads++;

			return 0.1;
		},
	};
	g_Assert.equal(g_CustomEvents.FireEvent("SourceJSSingleEnumerableRead", g_EnumerablePayload), true);
	g_Assert.equal(g_unPayloadReads, 1, "An included payload getter must be read exactly once.");
	g_Assert.equal(g_CustomFixture.FiredEvents.at(-1).Payload.Value, Math.fround(0.1), "Event float payloads must retain single-precision conversion.");
	VerifyCustomEventEnumeration(g_CustomEvents, g_CustomFixture);

	delete require.cache[g_strCustomPath];
	delete require.cache[g_strRuntimePath];
	delete globalThis.sourcejs;

	g_Assert.throws(() => require(g_strCustomPath), { name: "Error", message: /^SourceJS native runtime is not installed/ }, "Custom events must report native absence, not a lookup or unrelated error.");

	console.log("[  OK  ] events/custom API and documentation contracts passed with native doubles; native SDK execution not exercised");
} finally {
	delete require.cache[g_strCustomPath];
	delete require.cache[g_strRuntimePath];

	if (g_CustomCacheEntry !== undefined) {
		require.cache[g_strCustomPath] = g_CustomCacheEntry;
	}

	if (g_RuntimeCacheEntry !== undefined) {
		require.cache[g_strRuntimePath] = g_RuntimeCacheEntry;
	}

	if (g_SourceJSDescriptor === undefined) {
		delete globalThis.sourcejs;

	} else {
		Object.defineProperty(globalThis, "sourcejs", g_SourceJSDescriptor);
	}

	g_Module._load = g_OriginalModuleLoad;
}
