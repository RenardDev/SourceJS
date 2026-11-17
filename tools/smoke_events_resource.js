#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const { CreateNativePaths } = require("./native_paths_mock.js");

const g_strPackageRoot = g_Path.resolve(__dirname, "..", "packages", "sourcejs");
const g_strFilesystemPath = g_Path.join(g_strPackageRoot, "filesystem.js");
const g_strPathsPath = g_Path.join(g_strPackageRoot, "paths.js");
const g_strRuntimePath = g_Path.join(g_strPackageRoot, "internal", "runtime.js");
const g_strResourcePath = g_Path.join(g_strPackageRoot, "events", "resource.js");
const g_strResourceDocumentationPath = g_Path.resolve(__dirname, "..", "docs", "api", "events-resource.md");

const g_OriginalModuleLoad = g_Module._load;
const g_OriginalNativeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sourcejs");
const g_vecDependencyModulePaths = [g_strFilesystemPath, g_strPathsPath, g_strRuntimePath, g_strResourcePath];
const g_mapOriginalDependencies = new Map(g_vecDependencyModulePaths.map((strModulePath) => [strModulePath, require.cache[strModulePath]]));
const g_nMinimumEventInteger = -2147483648;
const g_nMaximumEventInteger = 2147483647;
const g_vecExpectedExports = [
	"BuildEventResourceLine",
	"CreateEventResourceText",
	"DescribeEventResource",
	"EventResourceFile",
	"LoadEventsFromFile",
];
const g_vecExpectedResourceFileMethods = [
	"AddEventResource",
	"ClearEventResources",
	"CreateEventResourceText",
	"DeleteEventResource",
	"Entries",
	"ForEach",
	"GetEventResource",
	"HasEventResource",
	"Keys",
	"LoadEventsFromFile",
	"SetEventResource",
	"Values",
	"WriteEventResourceFile",
	"toString",
	Symbol.iterator,
];
const g_mapWrittenFiles = new Map();
const g_vecEnsuredDirectories = [];
let g_strLoadedFilePath = null;
let g_bEnsureDirectoryResult = true;
let g_unNativeTextCallCount = 0;
let g_bWriteTextResult = true;

function VerifySingleResourcePathNormalization() {
	const unExpectedLoadedEventCount = 7;
	const unExpectedScenarioCount = 24;
	const strSource = g_FileSystem.readFileSync(g_strResourcePath, "utf8");
	const vecRoots = ["C:/game/events", "C:\\game\\events\\", "/srv/events/", "//server/share/events"];
	const vecPaths = [
		["plain", "plain"],
		["plain.res", "plain"],
		["double.res.res", "double.res"],
		["case.RES.Res", "case.RES"],
		[".res.res", ".res"],
		["folder.res/nested.res.res", "folder.res/nested.res"],
	];
	let unScenarioCount = 0;
	for (const strRoot of vecRoots) {
		const mapFiles = new Map();
		let strLoadedPath = null;
		const Native = {
			DescribeEventResource() {
				return {};
			},
			BuildEventResourceLine() {
				return "";
			},
			CreateEventResourceText() {
				return "";
			},
			LoadEventsFromFile(strPath) {
				strLoadedPath = strPath;

				return unExpectedLoadedEventCount;
			},
		};
		const ModuleRecord = { exports: {} };
		const RequireDependency = (strName) => {
			if (strName === "internal/runtime") {
				return { GetModule: () => Native };
			}

			if (strName === "paths") {
				return { EVENT_ROOT: strRoot };
			}

			g_Assert.equal(strName, "filesystem");

			return {
				EnsureDirectoryExists: () => true,
				WriteTextFile(strPath, strText) {
					mapFiles.set(strPath, strText);

					return true;
				},
			};
		};
		g_VM.runInNewContext(strSource, { module: ModuleRecord, require: RequireDependency }, { filename: g_strResourcePath });
		const strSeparator = strRoot.includes("\\") ? "\\" : "/";
		const strRootPrefix = (strRoot.endsWith("/") || strRoot.endsWith("\\")) ? strRoot : `${strRoot}${strSeparator}`;
		for (const [strInputPath, strNormalizedPath] of vecPaths) {
			const Resource = new ModuleRecord.exports.EventResourceFile(strInputPath);
			const strExpectedPath = `${strRootPrefix}${strNormalizedPath.replace(/\//g, strSeparator)}.res`;
			const strExpectedText = `"${strNormalizedPath}"\n{\n}\n`;
			g_Assert.equal(Resource.EventResourceFilePath, strNormalizedPath);
			g_Assert.equal(Resource.FullEventResourceFilePath, strExpectedPath, "Event resource paths must be normalized exactly once.");
			g_Assert.equal(Resource.CreateEventResourceText(), strExpectedText);
			g_Assert.equal(Resource.toString(), strExpectedText);
			g_Assert.equal(Resource.WriteEventResourceFile(), strExpectedPath);
			g_Assert.equal(mapFiles.get(strExpectedPath), strExpectedText);
			g_Assert.equal(Resource.LoadEventsFromFile(), unExpectedLoadedEventCount);
			g_Assert.equal(strLoadedPath, strExpectedPath);
			unScenarioCount += 1;
		}
	}

	g_Assert.equal(unScenarioCount, unExpectedScenarioCount);
	console.log(`Event resource path normalization ${unScenarioCount} profiles passed.`);
}

function InstallDependency(strModulePath, Dependency) {
	require.cache[strModulePath] = { exports: Dependency, filename: strModulePath, id: strModulePath, loaded: true };
}

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

function RequireResourceName(strName) {
	if ((typeof strName !== "string") || (strName.length === 0)) {
		throw new TypeError("resource name must be a non-empty string.");
	}
}

function RequireResourceVariables(Variables) {
	if ((Variables === null) || (typeof Variables !== "object") || Array.isArray(Variables)) {
		throw new TypeError("resource variables must be a non-array object.");
	}
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

function GetVariableType(Definition) {
	if (typeof Definition === "string") {
		return RequireVariableType(Definition);
	}

	if ((Definition !== null) && ((typeof Definition === "object") || (typeof Definition === "function"))) {
		const TypeValue = Definition.Type;
		if (typeof TypeValue === "string") {
			return RequireVariableType(TypeValue);
		}

		const DefaultValue = Definition.DefaultValue;
		if (DefaultValue !== undefined) {
			return InferVariableType(DefaultValue);
		}
	}

	return InferVariableType(Definition);
}

function EscapeResourceValue(strValue) {
	return strValue.replace(/(["\\])/g, "\\$1");
}

function FormatResourceVariableLine(strName, strType) {
	return `\t"${EscapeResourceValue(strName)}"\t"${EscapeResourceValue(RequireVariableType(strType))}"\n`;
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
		throw new Error("Event resource documentation must use the typed logger.");
	};
	const DocumentationConsole = new Proxy({}, { get: RejectDocumentationConsole });
	const Execute = new Function("require", "module", "exports", "console", `"use strict";\n${strSource}\n//# sourceURL=events-resource.md:block-${unBlockIndex + 1}`);

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

function AssertResourceDescriptorContracts(strDocumentation, ResourceModule) {
	for (const strSignature of [
		"BuildEventResourceLine(strEventVariableName, strEventVariableType)",
		"CreateEventResourceText(strEventName, EventVariables = {})",
		"DescribeEventResource(strEventName, EventVariables = {})",
		"LoadEventsFromFile(strEventResourceFilePath)",
	]) {
		const strFunctionName = strSignature.slice(0, strSignature.indexOf("("));
		g_Assert.ok(ResourceModule[strFunctionName].toString().startsWith(`function ${strSignature} {`), "The documented signature must match its public JavaScript wrapper.");
		g_Assert.ok(strDocumentation.includes(strSignature), "The current public signature must appear in the documentation.");
	}

	const strBindings = g_FileSystem.readFileSync(g_Path.join(g_strPackageRoot, "..", "..", "src", "sourcejs", "modules", "ModuleBindings.cpp"), "utf8");
	const nDescriptionStart = strBindings.indexOf("\tvoid DescribeEventResourceCallback(");
	const nDescriptionEnd = strBindings.indexOf("\tvoid LoadEventsFromFileCallback(", nDescriptionStart);
	g_Assert.ok((nDescriptionStart >= 0) && (nDescriptionEnd > nDescriptionStart), "Native descriptor callback markers must exist in dependency order.");

	const strNativeDescription = strBindings.slice(nDescriptionStart, nDescriptionEnd);
	g_Assert.match(strNativeDescription, /SetRecordProperty[^\n]*"Name"/);
	g_Assert.match(strNativeDescription, /SetRecordProperty[^\n]*"Variables"/);
	g_Assert.match(strNativeDescription, /SetRecordProperty[^\n]*"Text"/);
	g_Assert.doesNotMatch(strNativeDescription, /SetRecordProperty[^\n]*"(?:EventName|EventVariables|EventResourceText)"/);
	g_Assert.equal(/Native `\{ Name, Variables, Text \}`/.test(strDocumentation), true, "Documented native descriptor fields must match the export.");

	const Description = ResourceModule.DescribeEventResource("SourceJSDescriptionShape", { Value: { Type: "long", DefaultValue: 1 } });
	g_Assert.deepEqual(Object.keys(Description).sort(), ["Name", "Text", "Variables"]);
	g_Assert.equal(Array.isArray(Description.Variables), true);
	g_Assert.throws(() => new ResourceModule.EventResourceFile("examples/NativeDescription", Description), /variables must be an object/);

	const CanonicalVariables = { Value: "long" };
	const AliasVariables = { Label: "string" };
	const Resource = new ResourceModule.EventResourceFile("examples/DescriptorShape", { EventName: " SourceJSCanonicalName ", EventVariables: CanonicalVariables, Name: "SourceJSIgnoredName", Variables: AliasVariables });
	const Stored = Resource.GetEventResource("SourceJSCanonicalName");
	g_Assert.deepEqual(Object.keys(Stored).sort(), ["EventName", "EventVariables", "Name", "Variables"]);
	g_Assert.equal(Stored.EventName, "SourceJSCanonicalName");
	g_Assert.equal(Stored.Name, Stored.EventName);
	g_Assert.equal(Stored.EventVariables, CanonicalVariables);
	g_Assert.equal(Stored.Variables, CanonicalVariables);
	g_Assert.equal(Resource.HasEventResource("SourceJSIgnoredName"), false);
	Stored.Variables.Label = "string";
	g_Assert.match(Resource.CreateEventResourceText(), /"Label"\t"string"/);

	Stored.Name = "SourceJSChangedAlias";
	Stored.Variables = AliasVariables;
	g_Assert.equal(Stored.EventName, "SourceJSCanonicalName");
	g_Assert.equal(Stored.EventVariables, CanonicalVariables);
	g_Assert.equal(Resource.HasEventResource("SourceJSCanonicalName"), true);
	g_Assert.equal(Resource.HasEventResource("SourceJSChangedAlias"), false);

	const AliasResource = new ResourceModule.EventResourceFile("examples/AliasInput", { Name: " SourceJSAliasInput ", Variables: AliasVariables });
	g_Assert.equal(AliasResource.GetEventResource("SourceJSAliasInput").EventVariables, AliasVariables);

	const SetterResource = new ResourceModule.EventResourceFile("examples/SetterDescriptor");
	const ResourceDefinition = { EventName: " SourceJSSetterDescriptor ", EventVariables: CanonicalVariables };
	g_Assert.equal(SetterResource.SetEventResource(ResourceDefinition), SetterResource);
	const SetterDescriptor = SetterResource.GetEventResource("SourceJSSetterDescriptor");
	g_Assert.equal(SetterDescriptor.EventName, "SourceJSSetterDescriptor");
	g_Assert.equal(SetterDescriptor.EventVariables, CanonicalVariables);
	g_Assert.equal(SetterResource.EventResourceCount, 1);
	g_Assert.throws(() => SetterResource.SetEventResource(ResourceDefinition, {}), /separate variables argument/);
	g_Assert.equal(SetterResource.EventResourceCount, 1);
	g_Assert.equal(SetterResource.GetEventResource("SourceJSSetterDescriptor"), SetterDescriptor);

	const vecDefinitionReads = [];
	const StableDefinition = {};
	Object.defineProperties(StableDefinition, {
		Type: {
			get() {
				vecDefinitionReads.push("Type");

				return "long";
			},
		},
		DefaultValue: {
			get() {
				vecDefinitionReads.push("DefaultValue");

				return 7;
			},
		},
	});
	const StableDescription = ResourceModule.DescribeEventResource("SourceJSDefinitionOrder", { Value: StableDefinition });
	g_Assert.deepEqual(vecDefinitionReads, ["Type", "DefaultValue", "Type"]);
	g_Assert.equal(StableDescription.Variables[0].DefaultValue, 7);

	const InheritedDefinition = Object.create({ DefaultValue: true });
	const CallableDefinition = () => {
	};

	CallableDefinition.Type = "short";
	g_Assert.equal(GetVariableType(InheritedDefinition), "bool");
	g_Assert.equal(GetVariableType(CallableDefinition), "short");

	const OwnVariables = {};
	Object.defineProperty(OwnVariables, "HiddenValue", { value: "long" });
	const OwnDescription = ResourceModule.DescribeEventResource("SourceJSOwnVariable", OwnVariables);
	g_Assert.deepEqual(OwnDescription.Variables, []);
	g_Assert.equal(OwnDescription.Text, '"SourceJSOwnVariable"\n{\n}\n');

	const ReadFailure = new Error("Stop definition reads.");
	const FailingDefinition = {};
	Object.defineProperties(FailingDefinition, {
		Type: {
			get() {
				throw ReadFailure;
			},
		},
		DefaultValue: {
			get() {
				throw new Error("DefaultValue must not be read after Type fails.");
			},
		},
	});
	const FailingVariables = { First: FailingDefinition };
	Object.defineProperty(FailingVariables, "Later", {
		enumerable: true,
		get() {
			throw new Error("Later entries must not be read after failure.");
		},
	});
	const unTextCallsBeforeFailure = g_unNativeTextCallCount;
	g_Assert.throws(() => ResourceModule.DescribeEventResource("SourceJSFailedDescription", FailingVariables), (Failure) => Failure === ReadFailure);
	g_Assert.equal(g_unNativeTextCallCount, unTextCallsBeforeFailure);

	// Deliberate negative fixtures: obsolete spellings must not be consulted.
	for (const strLegacyProperty of ["type", "m_strEventVariableType", "defaultValue", "m_ValueDefault"]) {
		const LegacyDefinition = {};
		Object.defineProperty(LegacyDefinition, strLegacyProperty, {
			get() {
				throw new Error("An obsolete definition property was read.");
			},
		});
		g_Assert.equal(GetVariableType(LegacyDefinition), "string");
	}

	const OriginalDefaultProperty = Object.getOwnPropertyDescriptor(Object.prototype, "DefaultValue");
	const vecInheritedWrites = [];
	try {
		Object.defineProperty(Object.prototype, "DefaultValue", {
			configurable: true,
			set(Value) {
				vecInheritedWrites.push(Value);
			},
		});
		const DefaultDescription = ResourceModule.DescribeEventResource("SourceJSOwnDefault", { Enabled: true });
		g_Assert.equal(DefaultDescription.Variables[0].DefaultValue, true);
		g_Assert.equal(Object.hasOwn(DefaultDescription.Variables[0], "DefaultValue"), true);
		g_Assert.equal(vecInheritedWrites.length, 0, "Returned records must use own data properties.");
	} finally {
		if (OriginalDefaultProperty === undefined) {
			delete Object.prototype.DefaultValue;
		} else {
			Object.defineProperty(Object.prototype, "DefaultValue", OriginalDefaultProperty);
		}
	}

	g_Assert.deepEqual(Object.getOwnPropertyDescriptor(Object.prototype, "DefaultValue"), OriginalDefaultProperty);
}

function AssertResourceEnumerationAndPhases(ResourceModule) {
	const IgnoredReadError = new Error("Non-enumerable or symbol resource definitions must not be read.");
	const RejectIgnoredRead = () => {
		throw IgnoredReadError;
	};
	const Variables = Object.create({ Inherited: "long" });
	Variables.Visible = "long";
	Object.defineProperty(Variables, "Hidden", { get: RejectIgnoredRead });
	Object.defineProperty(Variables, Symbol("IgnoredVariable"), { enumerable: true, get: RejectIgnoredRead });
	const Description = ResourceModule.DescribeEventResource("SourceJSFilteredResource", Variables);
	g_Assert.deepEqual(Description.Variables.map(Variable => Variable.Name), ["Visible"]);
	g_Assert.equal(Description.Text, '"SourceJSFilteredResource"\n{\n\t"Visible"\t"long"\n}\n');
	g_Assert.equal(ResourceModule.CreateEventResourceText("SourceJSFilteredResource", Variables), Description.Text);
	g_Assert.equal(ResourceModule.CreateEventResourceText("SourceJSEmptyVariableName", { "": "long" }), '"SourceJSEmptyVariableName"\n{\n\t""\t"long"\n}\n');

	for (const InvalidName of ["", undefined, null, 7]) {
		g_Assert.throws(() => ResourceModule.DescribeEventResource(InvalidName), TypeError);
		g_Assert.throws(() => ResourceModule.CreateEventResourceText(InvalidName), TypeError);
		g_Assert.throws(() => ResourceModule.BuildEventResourceLine(InvalidName, "long"), TypeError);
		g_Assert.throws(() => ResourceModule.LoadEventsFromFile(InvalidName), TypeError);
	}

	for (const InvalidVariables of [null, [], () => undefined]) {
		g_Assert.throws(() => ResourceModule.DescribeEventResource("SourceJSInvalidVariables", InvalidVariables), TypeError);
		g_Assert.throws(() => ResourceModule.CreateEventResourceText("SourceJSInvalidVariables", InvalidVariables), TypeError);
	}

	const Inferred = ResourceModule.DescribeEventResource("SourceJSInferenceBoundary", {
		NegativeZero: -0,
		IntegerZero: 0,
		NonStringType: { Type: 7, DefaultValue: true },
		UndefinedDescriptor: { Type: "string", DefaultValue: undefined },
		UndefinedLiteral: undefined,
	});
	const Types = Object.fromEntries(Inferred.Variables.map(Variable => [Variable.Name, Variable.Type]));
	g_Assert.deepEqual(Types, { NegativeZero: "float", IntegerZero: "long", NonStringType: "bool", UndefinedDescriptor: "string", UndefinedLiteral: "string" });
	g_Assert.equal(Object.hasOwn(Inferred.Variables.find(Variable => Variable.Name === "UndefinedDescriptor"), "DefaultValue"), false);
	g_Assert.equal(Object.hasOwn(Inferred.Variables.find(Variable => Variable.Name === "UndefinedLiteral"), "DefaultValue"), true);

	const vecReads = [];
	let unTypeReads = 0;
	const TextPhaseError = new Error("The second type read fails in the text phase.");
	const FirstDefinition = {
		get Type() {
			unTypeReads++;
			vecReads.push(`Type${unTypeReads}`);

			if (unTypeReads === 2) {
				throw TextPhaseError;
			}

			return "long";
		},
	};
	const Definitions = {
		First: FirstDefinition,
		get Later() {
			vecReads.push("LaterMetadata");

			return "long";
		},
	};
	g_Assert.throws(() => ResourceModule.DescribeEventResource("SourceJSPhaseOrder", Definitions), ErrorValue => ErrorValue === TextPhaseError);
	g_Assert.deepEqual(vecReads, ["Type1", "LaterMetadata", "Type2"], "A text-phase failure cannot undo reads completed by the earlier metadata phase.");
}

function AssertResourceWritePhases(ResourceModule) {
	const FilesystemModule = require(g_strFilesystemPath);
	const OriginalEnsureDirectoryExists = FilesystemModule.EnsureDirectoryExists;
	const OriginalWriteTextFile = FilesystemModule.WriteTextFile;
	const ResourceFile = new ResourceModule.EventResourceFile("sourcejs/WritePhaseProbe");
	const vecPhases = [];
	const strExpectedPath = "sourcejs/WritePhaseProbe1.res";
	const RenderFailure = new Error("The render failed after directory creation.");
	let unPathReads = 0;
	let bFailRender = false;
	let bWriteResult = true;
	Object.defineProperty(ResourceFile, "FullEventResourceFilePath", {
		get() {
			unPathReads++;

			return `sourcejs/WritePhaseProbe${unPathReads}.res`;
		},
	});
	ResourceFile.CreateEventResourceText = () => {
		vecPhases.push("Render");

		if (bFailRender) {
			throw RenderFailure;
		}

		return "resource text";
	};

	try {
		FilesystemModule.EnsureDirectoryExists = strDirectoryPath => {
			g_Assert.equal(strDirectoryPath, "sourcejs");
			vecPhases.push("Directory");

			return true;
		};
		FilesystemModule.WriteTextFile = (strFilePath, strText) => {
			g_Assert.equal(strFilePath, strExpectedPath);
			g_Assert.equal(strText, "resource text");
			vecPhases.push("Write");

			return bWriteResult;
		};
		g_Assert.equal(ResourceFile.WriteEventResourceFile(), strExpectedPath);
		g_Assert.equal(unPathReads, 1, "The operation must capture its full path once.");
		g_Assert.deepEqual(vecPhases, ["Directory", "Render", "Write"]);

		vecPhases.length = 0;
		unPathReads = 0;
		bFailRender = true;
		g_Assert.throws(() => ResourceFile.WriteEventResourceFile(), Failure => Failure === RenderFailure);
		g_Assert.equal(unPathReads, 1);
		g_Assert.deepEqual(vecPhases, ["Directory", "Render"], "Rendering failure does not undo the earlier directory operation.");

		vecPhases.length = 0;
		unPathReads = 0;
		bFailRender = false;
		bWriteResult = false;
		g_Assert.throws(() => ResourceFile.WriteEventResourceFile(), Failure => Failure.message === `Unable to write event resource file: ${strExpectedPath}`);
		g_Assert.equal(unPathReads, 1);
		g_Assert.deepEqual(vecPhases, ["Directory", "Render", "Write"]);
	} finally {
		FilesystemModule.EnsureDirectoryExists = OriginalEnsureDirectoryExists;
		FilesystemModule.WriteTextFile = OriginalWriteTextFile;
	}
}

function TrackExports(ModuleExports, setExercisedExports) {
	return new Proxy(ModuleExports, {
		get(Target, PropertyName, Receiver) {
			const Value = Reflect.get(Target, PropertyName, Receiver);

			if ((typeof PropertyName !== "string") || !g_vecExpectedExports.includes(PropertyName)) {
				return Value;
			}

			if (PropertyName === "EventResourceFile") {
				return new Proxy(Value, {
					construct(Constructor, vecArguments, NewTarget) {
						setExercisedExports.add(PropertyName);

						return Reflect.construct(Constructor, vecArguments, NewTarget);
					},
				});
			}

			return function TrackedExport(...vecArguments) {
				setExercisedExports.add(PropertyName);

				return Reflect.apply(Value, Target, vecArguments);
			};
		},
	});
}

function TrackPrototypeMethods(Prototype, vecMethodNames, setExercisedMethods) {
	const mapOriginalMethods = new Map();
	for (const MethodName of vecMethodNames) {
		const OriginalMethod = Prototype[MethodName];
		mapOriginalMethods.set(MethodName, OriginalMethod);
		Prototype[MethodName] = function TrackedMethod(...vecArguments) {
			setExercisedMethods.add(MethodName);

			return Reflect.apply(OriginalMethod, this, vecArguments);
		};
	}

	return function RestorePrototypeMethods() {
		for (const [MethodName, OriginalMethod] of mapOriginalMethods) {
			Prototype[MethodName] = OriginalMethod;
		}
	};
}

const g_NativeResource = {
	DescribeEventResource(strName, Variables = {}) {
		RequireResourceName(strName);
		RequireResourceVariables(Variables);

		const vecVariables = Object.keys(Variables).map((strVariableName) => {
			const Definition = Variables[strVariableName];
			const Variable = { Name: strVariableName, Type: GetVariableType(Definition) };
			const bObjectDefinition = (Definition !== null) && ((typeof Definition === "object") || (typeof Definition === "function"));
			const DefaultValue = bObjectDefinition ? Definition.DefaultValue : Definition;
			if ((typeof Definition !== "string") && (!bObjectDefinition || (DefaultValue !== undefined))) {
				Object.defineProperty(Variable, "DefaultValue", { value: DefaultValue, enumerable: true, writable: true, configurable: true });
			}

			return Variable;
		});

		const strEventResourceText = g_NativeResource.CreateEventResourceText(strName, Variables);

		return { Name: strName, Variables: vecVariables, Text: strEventResourceText };
	},
	BuildEventResourceLine(strName, strType) {
		RequireResourceName(strName);

		return FormatResourceVariableLine(strName, strType);
	},
	LoadEventsFromFile(strFilePath) {
		RequireResourceName(strFilePath);

		if (strFilePath.includes("\0")) {
			throw new TypeError("resource path must not contain NUL.");
		}

		g_strLoadedFilePath = strFilePath;

		return 2;
	},
	CreateEventResourceText(strName, Variables = {}) {
		RequireResourceName(strName);
		RequireResourceVariables(Variables);
		g_unNativeTextCallCount += 1;

		let strResourceText = `"${EscapeResourceValue(strName)}"\n{\n`;
		const vecVariableNames = Object.keys(Variables);
		for (const strVariableName of vecVariableNames) {
			const Definition = Variables[strVariableName];
			strResourceText += FormatResourceVariableLine(strVariableName, GetVariableType(Definition));
		}

		strResourceText += "}\n";

		return strResourceText;
	},
};

const g_NativePaths = { ...CreateNativePaths({ EVENT_ROOT: "C:\\game\\mod\\resource\\events" }) };

try {
	VerifySingleResourcePathNormalization();
	VerifyDocumentationExecutorContracts();

	g_Module._load = function Load(strRequestName, ParentModule, bIsMain) {
		if (strRequestName === "internal/runtime") {
			return require(g_strRuntimePath);
		}

		if (strRequestName === "filesystem") {
			return require(g_strFilesystemPath);
		}

		if (strRequestName === "paths") {
			return require(g_strPathsPath);
		}

		return g_OriginalModuleLoad.call(this, strRequestName, ParentModule, bIsMain);
	};

	for (const strModulePath of g_vecDependencyModulePaths) {
		delete require.cache[strModulePath];
	}

	globalThis.sourcejs = { "events/resource": g_NativeResource };

	InstallDependency(g_strFilesystemPath, {
		EnsureDirectoryExists(strDirectoryPath) {
			g_vecEnsuredDirectories.push(strDirectoryPath);

			return g_bEnsureDirectoryResult;
		},
		WriteTextFile(strFilePath, strText) {
			if (!g_bWriteTextResult) {
				return false;
			}

			g_mapWrittenFiles.set(strFilePath, strText);

			return true;
		},
	});

	InstallDependency(g_strPathsPath, g_NativePaths);

	const g_Resource = require(g_strResourcePath);
	g_Assert.strictEqual(g_Resource, g_NativeResource);
	g_Assert.deepEqual(Object.keys(g_Resource).sort(), g_vecExpectedExports);

	const g_ResourceFile = new g_Resource.EventResourceFile("sourcejs/api_events.res", {
		EventName: "SourceJSAPIExample",
		EventVariables: {
			Enabled: true,
			Message: "string",
			UserID: "short",
		},
	});

	g_ResourceFile.SetEventResource("SourceJSAPIMap", { Scale: { Type: "float" } });

	g_Assert.equal(g_ResourceFile.EventResourceFilePath, "sourcejs/api_events");
	g_Assert.equal(g_ResourceFile.FullEventResourceFilePath, "C:/game/mod/resource/events/sourcejs/api_events.res");
	g_NativePaths.EVENT_ROOT = "";
	g_Assert.throws(() => g_ResourceFile.FullEventResourceFilePath, /non-empty paths\.EVENT_ROOT/);
	g_NativePaths.EVENT_ROOT = "C:/game/mod/resource/events";
	g_Assert.equal(g_ResourceFile.FullEventResourceFilePath, "C:/game/mod/resource/events/sourcejs/api_events.res");
	g_Assert.equal(g_ResourceFile.EventResourceCount, 2);
	g_Assert.equal(g_ResourceFile.HasEventResource("SourceJSAPIExample"), true);
	g_Assert.equal(g_ResourceFile.GetEventResource("SourceJSAPIMap").EventVariables.Scale.Type, "float");
	g_Assert.deepEqual(Array.from(g_ResourceFile.Keys()), ["SourceJSAPIExample", "SourceJSAPIMap"]);
	g_Assert.equal(Object.hasOwn(g_Resource, "EventResource"), false);
	g_Assert.equal(typeof g_ResourceFile.toJSON, "undefined");
	g_Assert.throws(() => g_ResourceFile.SetEventResource("SourceJSMapVariables", new Map()), /plain object/);
	g_Assert.throws(() => g_ResourceFile.SetEventResource("SourceJSNullVariables", null), /must be an object/);
	// Deliberate obsolete descriptor keys: these must not be accepted as public fields.
	g_Assert.throws(() => g_ResourceFile.AddEventResource({ eventName: "alias_event", fields: {} }), /non-empty name/);
	g_Assert.throws(() => new g_Resource.EventResourceFile("invalid\"path"), /must not contain quotes/);
	g_Assert.throws(() => new g_Resource.EventResourceFile("sourcejs/truncated\0ignored.res"), /NUL/);
	g_Assert.throws(() => g_Resource.LoadEventsFromFile("sourcejs/truncated\0ignored.res"), /NUL/);
	g_Assert.equal(g_strLoadedFilePath, null);
	g_Assert.throws(() => new g_Resource.EventResourceFile("../outside_event_root"), /traversal/);
	g_Assert.throws(() => new g_Resource.EventResourceFile("C:/outside_event_root"), /drive prefixes/);
	g_Assert.throws(() => new g_Resource.EventResourceFile(7), /string file path/);
	g_Assert.throws(() => g_ResourceFile.GetEventResource(7), /non-empty strings/);

	const g_EditableResourceFile = new g_Resource.EventResourceFile("sourcejs/original_path");
	g_Assert.throws(() => {
		g_EditableResourceFile.EventResourceFilePath = "../outside_after_construction";
	}, TypeError);
	g_Assert.equal(g_EditableResourceFile.FullEventResourceFilePath, "C:/game/mod/resource/events/sourcejs/original_path.res");

	const g_strResourceText = g_ResourceFile.CreateEventResourceText();
	g_Assert.match(g_strResourceText, /"sourcejs\/api_events"/);
	g_Assert.match(g_strResourceText, /"SourceJSAPIExample"/);
	g_Assert.match(g_strResourceText, /"UserID"\t"short"/);
	g_Assert.match(g_strResourceText, /"Scale"\t"float"/);
	g_Assert.match(g_strResourceText, /\t"SourceJSAPIExample"/);

	const g_strFullPath = g_ResourceFile.WriteEventResourceFile();
	g_Assert.equal(g_strFullPath, g_ResourceFile.FullEventResourceFilePath);
	g_Assert.equal(g_vecEnsuredDirectories[0], "C:/game/mod/resource/events/sourcejs");
	g_Assert.equal(g_mapWrittenFiles.get(g_strFullPath), g_strResourceText);
	g_Assert.equal(g_ResourceFile.LoadEventsFromFile(), 2);
	g_Assert.equal(g_strLoadedFilePath, g_strFullPath);

	const g_FailingResourceFile = new g_Resource.EventResourceFile("sourcejs/write_failure", "SourceJSFailureEvent");
	const g_unNativeTextCallsBeforeDirectoryFailure = g_unNativeTextCallCount;

	g_bEnsureDirectoryResult = false;
	g_Assert.throws(() => g_FailingResourceFile.WriteEventResourceFile(), /Unable to create event resource directory/);
	g_Assert.equal(g_unNativeTextCallCount, g_unNativeTextCallsBeforeDirectoryFailure);
	g_bEnsureDirectoryResult = true;
	g_bWriteTextResult = false;
	g_Assert.throws(() => g_FailingResourceFile.WriteEventResourceFile(), /Unable to write event resource file/);
	g_bWriteTextResult = true;

	g_ResourceFile.CreateEventResourceText();

	const g_NativeDescription = g_Resource.DescribeEventResource("SourceJSNative", { Message: "string" });
	g_Assert.equal(g_NativeDescription.Variables[0].Type, "string");
	g_Assert.equal(g_NativeDescription.Name, "SourceJSNative");
	g_Assert.equal(g_NativeDescription.Text, g_Resource.CreateEventResourceText("SourceJSNative", { Message: "string" }));
	g_Assert.deepEqual(Object.keys(g_NativeDescription).sort(), ["Name", "Text", "Variables"]);
	g_Assert.match(g_Resource.CreateEventResourceText("SourceJSNative", { Message: "string" }), /"Message"\t"string"/);
	g_Assert.equal(g_Resource.BuildEventResourceLine("UserID", "short"), "\t\"UserID\"\t\"short\"\n");
	g_Assert.throws(() => g_Resource.BuildEventResourceLine("UserID", "integer"), /canonical/);
	g_Assert.throws(() => g_Resource.CreateEventResourceText("SourceJSInvalidType", { Value: "number" }), /canonical/);

	const g_unExpectedDocumentationBlockCount = 12;
	const g_strDocumentation = g_FileSystem.readFileSync(g_strResourceDocumentationPath, "utf8");
	const g_vecDocumentationBlocks = ExtractJavaScriptBlocks(g_strDocumentation);
	const g_setExercisedExports = new Set();
	const g_setExercisedResourceFileMethods = new Set();
	const g_DocumentedResource = TrackExports(g_Resource, g_setExercisedExports);
	const g_RestoreResourceFileMethods = TrackPrototypeMethods(g_Resource.EventResourceFile.prototype, g_vecExpectedResourceFileMethods, g_setExercisedResourceFileMethods);

	try {
		g_Assert.equal(g_vecDocumentationBlocks.length, g_unExpectedDocumentationBlockCount);
		AssertResourceDescriptorContracts(g_strDocumentation, g_Resource);
		AssertResourceEnumerationAndPhases(g_Resource);
		AssertResourceWritePhases(g_Resource);
		g_Assert.doesNotMatch(g_strDocumentation, /generated by|auto-generated|example generator/i);
		g_Assert.doesNotMatch(g_strDocumentation, /moduleName|source\.events|cfg\/sourcejs\/example\.txt/);
		g_Assert.doesNotMatch(g_strDocumentation, /\bconsole\./, "Executable event-resource documentation must use typed logging.");

		for (const strSource of g_vecDocumentationBlocks) {
			new g_VM.Script(`"use strict";\n${strSource}`);
		}

		g_setExercisedExports.clear();
		g_setExercisedResourceFileMethods.clear();
		g_Assert.equal(g_setExercisedExports.size + g_setExercisedResourceFileMethods.size, 0, "Only executable documentation may populate coverage.");

		for (const [unBlockIndex, strSource] of g_vecDocumentationBlocks.entries()) {
			ExecuteDocumentationBlock(strSource, unBlockIndex, { "events/resource": g_DocumentedResource });
		}
	} finally {
		g_RestoreResourceFileMethods();
	}

	for (const strExportName of g_vecExpectedExports) {
		g_Assert.equal(g_setExercisedExports.has(strExportName), true, `Documentation did not exercise events/resource.${strExportName}.`);
	}

	for (const MethodName of g_vecExpectedResourceFileMethods) {
		g_Assert.equal(g_setExercisedResourceFileMethods.has(MethodName), true, `Documentation did not exercise EventResourceFile.${String(MethodName)}.`);
	}

	delete require.cache[g_strResourcePath];
	delete require.cache[g_strRuntimePath];
	delete globalThis.sourcejs;

	g_Assert.throws(() => require(g_strResourcePath), { name: "Error", message: /^SourceJS native runtime is not installed/ });

	console.log("[  OK  ] events/resource API and documentation contracts passed with native doubles; native SDK execution not exercised");
} finally {
	for (const strModulePath of g_vecDependencyModulePaths) {
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
