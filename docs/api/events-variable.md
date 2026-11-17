# `require("events/variable")`

> Warning: event-variable objects describe schemas and defaults; they do not clamp byte/short ranges or validate a value against the engine event at construction time. Apply application-level range checks before firing; schema type names alone do not establish those bounds.

The `events/variable` module exposes native event-type inference, exact-type validation, and explicit coercion functions plus JavaScript descriptor classes for building readable custom-event schemas.

## Contents

- [Import](#import)
- [Exports](#exports)
- [Valve event types](#valve-event-types)
- [`GetEventVariableTypes`](#geteventvariabletypes)
- [`InferEventVariableType`](#infereventvariabletype)
- [`CoerceEventVariableValue`](#coerceeventvariablevalue)
- [`CreateEventVariableDefinition`](#createeventvariabledefinition)
- [`EventVariable`](#eventvariable)
- [`EventVariableTemplate`](#eventvariabletemplate)
- [Specialized templates](#specialized-templates)
- [Custom-event schema example](#custom-event-schema-example)
- [Errors and capability rules](#errors-and-capability-rules)

## Import

```js
const {
	BooleanEventVariableTemplate,
	ByteEventVariableTemplate,
	CoerceEventVariableValue,
	CreateEventVariableDefinition,
	EventVariable,
	EventVariableTemplate,
	FloatEventVariableTemplate,
	GetEventVariableTypes,
	InferEventVariableType,
	LongEventVariableTemplate,
	ShortEventVariableTemplate,
	StringEventVariableTemplate,
} = require("events/variable");
```

The module augments the live native `events/variable` object in place, retaining its `CreateEventVariable`, `InferEventVariable`, `CoerceEventVariable`, and `GetEventVariableTypes` functions. It adds the JavaScript `CreateEventVariableDefinition` wrapper over `CreateEventVariable`, exposes the same native inference/coercion functions as `InferEventVariableType` and `CoerceEventVariableValue`, and adds eight JavaScript descriptor classes. Each `EventVariable` construction resolves the current definition function. Public exports and descriptor properties use PascalCase; no lowercase compatibility shortcuts are installed.

## Exports

| Primary export | Other export(s) | Signature | Result |
| --- | --- | --- | --- |
| [`GetEventVariableTypes`](#geteventvariabletypes) | — | `GetEventVariableTypes()` | new array of eight canonical types |
| [`InferEventVariableType`](#infereventvariabletype) | `InferEventVariable` | `InferEventVariableType(Value?)` | canonical Valve type string |
| [`CoerceEventVariableValue`](#coerceeventvariablevalue) | `CoerceEventVariable` | `CoerceEventVariableValue(strType?, Value?)` | value converted for that type |
| `CreateEventVariable` | — | `CreateEventVariable(strName, strType?, DefaultValue?)` | native definition with `Name`, `Type`, and optional `DefaultValue` fields |
| [`CreateEventVariableDefinition`](#createeventvariabledefinition) | — | `CreateEventVariableDefinition(strEventVariableName, strEventVariableType?, EventVariableDefaultValue?)` | plain definition with PascalCase fields |
| [`EventVariable`](#eventvariable) | — | `new EventVariable(strEventVariableName, strEventVariableType?, EventVariableDefaultValue?)` | named definition object with an exact type |
| [`EventVariableTemplate`](#eventvariabletemplate) | — | `new EventVariableTemplate(strEventVariableType, strEventVariableComment?, EventVariableDefaultValue?)` | reusable unnamed template |
| `BooleanEventVariableTemplate` | `BoolVariable` | `new BooleanEventVariableTemplate(strEventVariableComment?, EventVariableDefaultValue?)` | reusable `bool` template |
| `ByteEventVariableTemplate` | `ByteVariable` | `new ByteEventVariableTemplate(strEventVariableComment?, EventVariableDefaultValue?)` | reusable `byte` template |
| `ShortEventVariableTemplate` | `ShortVariable` | `new ShortEventVariableTemplate(strEventVariableComment?, EventVariableDefaultValue?)` | reusable `short` template |
| `LongEventVariableTemplate` | `LongVariable` | `new LongEventVariableTemplate(strEventVariableComment?, EventVariableDefaultValue?)` | reusable `long` template |
| `FloatEventVariableTemplate` | `FloatVariable` | `new FloatEventVariableTemplate(strEventVariableComment?, EventVariableDefaultValue?)` | reusable `float` template |
| `StringEventVariableTemplate` | `StringVariable` | `new StringEventVariableTemplate(strEventVariableComment?, EventVariableDefaultValue?)` | reusable `string` template |

The complete surface has 21 member names: seven function names, 12 specialized-class names, and two shared base-class names.

Use named imports from `events/variable`. These examples build field metadata or convert values; none fires an event.

| Use | Example |
| --- | --- |
| Infer the canonical type for a boolean value. | `const strType = InferEventVariable(true);` |
| Convert a numeric count with the native `long` conversion. | `const nCount = CoerceEventVariable("long", "12");` |
| Create a named definition with an explicit default. | `const Count = CreateEventVariable("Count", "long", 0);` |
| Create a reusable boolean template. | `const Ready = new BoolVariable("Round is ready.", false);` |
| Create a byte template for a small state identifier. | `const State = new ByteEventVariableTemplate("Round state.", 0);` |
| Create a signed short template for a score difference. | `const ScoreDelta = new ShortVariable("Score difference.", -1);` |
| Create a float template for a duration. | `const Duration = new FloatVariable("Duration in seconds.", 0.5);` |

## Valve event types

| Type | Resource meaning | Native event access |
| --- | --- | --- |
| `bool` | boolean | `GetEventBoolean`, `SetEventBoolean` |
| `byte` | small integer resource field | `GetEventInteger`, `SetEventInteger` |
| `short` | short integer resource field | `GetEventInteger`, `SetEventInteger` |
| `long` | signed integer resource field | `GetEventInteger`, `SetEventInteger` |
| `float` | floating-point value | `GetEventFloat`, `SetEventFloat` |
| `string` | narrow string | `GetEventString`, `SetEventString` |
| `local` | local-only resource string | SDK event-string access |
| `wstring` | wide resource string | SDK-specific event-string access |

Type strings are exact and shared with [`events/resource`](events-resource.md): only `bool`, `byte`, `short`, `long`, `float`, `string`, `local`, and `wstring` are accepted. Unknown spellings are rejected.

The template classes intentionally cover only `bool`, `byte`, `short`, `long`, `float`, and `string` because those six types have an unambiguous setter family. Use `CreateEventVariableDefinition` or `EventVariable` directly for `local` and `wstring`.

## `GetEventVariableTypes`

```text
GetEventVariableTypes() -> string[]
```

Every call returns a new array with own indexed data properties in this exact order; inherited array setters are not invoked:

```js
const { GetEventVariableTypes } = require("events/variable");

const g_VerifyEventVariableTypes = () => {
	const vecSupportedEventVariableTypes = GetEventVariableTypes();
	if (vecSupportedEventVariableTypes.join(",") !== "bool,byte,short,long,float,string,local,wstring") {
		throw new Error("The native event type list is incomplete.");
	}

	vecSupportedEventVariableTypes.pop();

	if (GetEventVariableTypes().length !== 8) {
		throw new Error("The type functions returned shared mutable state.");
	}
};

g_VerifyEventVariableTypes();
```

## `InferEventVariableType`

```text
InferEventVariableType(Value = undefined) -> string
```

Inference follows V8 value categories rather than JavaScript application intent:

| Value | Result |
| --- | --- |
| `undefined`, `null` | `string` |
| boolean | `bool` |
| number recognized by V8 as signed `int32` | `long` |
| other number, including negative zero, `NaN`, and infinities | `float` |
| string, `bigint`, object, array, or function | `string` |

`InferEventVariable` and `InferEventVariableType` refer to the same native function object, not separate wrappers. `CoerceEventVariable` and `CoerceEventVariableValue` have the same identity relationship.

```js
const { InferEventVariableType } = require("events/variable");

const g_VerifyEventVariableTypeInference = () => {
	const strActiveEventVariableType = InferEventVariableType(true);
	const strCountEventVariableType = InferEventVariableType(12);
	const strDurationEventVariableType = InferEventVariableType(1.25);
	const strMissingEventVariableType = InferEventVariableType();
	const strTitleEventVariableType = InferEventVariableType("finale");
	if ((strActiveEventVariableType !== "bool") || (strCountEventVariableType !== "long") || (strDurationEventVariableType !== "float")) {
		throw new Error("Numeric event type inference failed.");
	}

	if ((strMissingEventVariableType !== "string") || (strTitleEventVariableType !== "string")) {
		throw new Error("String event type inference failed.");
	}
};

g_VerifyEventVariableTypeInference();
```

Inference does not inspect object contents. Use an explicit type for schema objects and identifiers that happen to be numeric.

## `CoerceEventVariableValue`

```text
CoerceEventVariableValue(strType?, Value?) -> Value
```

`CoerceEventVariableValue` and `CoerceEventVariable` are the module's intentional conversion APIs. An omitted type selects `string`; a supplied type must be an exact canonical primitive string. Explicit `undefined`, `null`, and boxed strings are rejected rather than treated as omission. Conversion then uses V8 semantics:

| Exact type | Conversion | Result type |
| --- | --- | --- |
| `bool` | JavaScript truthiness | `boolean` |
| `byte`, `short`, or `long` | V8 `Int32Value` | signed `number` |
| `float` | V8 `NumberValue`, without float32 rounding | `number` |
| `string`, `local`, or `wstring` | V8 string conversion | `string` |

It does not clamp `byte` or `short`; all three integer schema types use a signed int32 conversion. Numeric coercion of a `bigint` or symbol throws instead of converting through `Number()`. A `float` coercion returns the converted JavaScript double without narrowing to native float32. For example, the string `"false"` is truthy and therefore coerces to `true`.

If numeric or string conversion invokes user code that throws, the original exception is propagated. String coercion performs the user conversion once, preserves embedded null characters, and replaces unpaired UTF-16 surrogates through the native UTF-8 encoding path.

```js
const { CoerceEventVariableValue } = require("events/variable");

const g_VerifyEventVariableCoercion = () => {
	const bActive = CoerceEventVariableValue("bool", 1);
	const nCount = CoerceEventVariableValue("long", "12");
	const dblDuration = CoerceEventVariableValue("float", "2.5");
	const strLabel = CoerceEventVariableValue("string", 404);
	if ((bActive !== true) || (nCount !== 12) || (dblDuration !== 2.5)) {
		throw new Error("Event values were not converted.");
	}

	if (strLabel !== "404") {
		throw new Error("String event coercion failed.");
	}
};

g_VerifyEventVariableCoercion();
```

Use ordinary application validation before `CoerceEventVariableValue` when `NaN`, wrapping 32-bit signed conversion, or truthiness is not acceptable.

## `CreateEventVariableDefinition`

```text
CreateEventVariableDefinition(strEventVariableName, strEventVariableType?, EventVariableDefaultValue?) -> object
```

The returned plain object always exposes `Name` and exact `Type` fields. It exposes `DefaultValue` only when a third argument was supplied, including an explicit `undefined`. These are own writable, enumerable, configurable data properties; inherited setters cannot intercept the wrapper's default field.

Type selection uses these rules:

1. A non-null, non-undefined second argument must be one of the exact supported types.
2. Otherwise, a supplied third argument is passed through `InferEventVariableType` for the type.
3. Without either value, the type is `string`.

The native callback requires a non-empty primitive string name. A non-nullish explicit type must also be a primitive string; `null` and `undefined` select inference instead. The name and explicit type are not coerced from other JavaScript types.

The native `CreateEventVariable()` result stores `Name`, `Type`, and any supplied `DefaultValue` as own writable, enumerable, configurable data properties; inherited setters are not invoked during its construction.

```js
const { CreateEventVariableDefinition } = require("events/variable");

const g_VerifyEventVariableDefinitions = () => {
	const UserIDEventVariableDefinition = CreateEventVariableDefinition("UserID", "short", 0);
	const DurationEventVariableDefinition = CreateEventVariableDefinition("Duration", undefined, 1.5);
	const LabelEventVariableDefinition = CreateEventVariableDefinition("Label", "string");
	if ((UserIDEventVariableDefinition.Name !== "UserID") || (UserIDEventVariableDefinition.Type !== "short") || (UserIDEventVariableDefinition.DefaultValue !== 0)) {
		throw new Error("The explicit event definition is invalid.");
	}

	if ((DurationEventVariableDefinition.Type !== "float") || (DurationEventVariableDefinition.DefaultValue !== 1.5)) {
		throw new Error("The default value was not used for inference.");
	}

	if ((LabelEventVariableDefinition.Type !== "string") || Object.hasOwn(LabelEventVariableDefinition, "DefaultValue")) {
		throw new Error("The optional default-value contract is invalid.");
	}
};

g_VerifyEventVariableDefinitions();
```

Definitions are shallow metadata snapshots: changing `Name`, `Type`, or the `DefaultValue` binding does not update another definition already created. Object-valued defaults retain their original reference, so mutations inside that shared object remain visible to every definition that uses it.

## `EventVariable`

```text
new EventVariable(strEventVariableName, strEventVariableType?, EventVariableDefaultValue?)
```

The constructor delegates to the package's `CreateEventVariableDefinition` wrapper, which calls native `CreateEventVariable`, and copies its result into a small named object.

### Fields

| Field | Type | Meaning |
| --- | --- | --- |
| `Name` | `string` | Native definition name. |
| `Type` | `string` | Canonical event type. |
| `DefaultValue` | `any`, optional | Present only when the constructor received a third argument. |

```js
const { EventVariable } = require("events/variable");

const g_VerifyNamedEventVariables = () => {
	const LocalMessageEventVariable = new EventVariable("Message", "local", "Ready");
	const WideTitleEventVariable = new EventVariable("Title", "wstring");
	if ((LocalMessageEventVariable.Name !== "Message") || (LocalMessageEventVariable.Type !== "local") || (LocalMessageEventVariable.DefaultValue !== "Ready")) {
		throw new Error("The local event variable is invalid.");
	}

	if ((WideTitleEventVariable.Type !== "wstring") || Object.hasOwn(WideTitleEventVariable, "DefaultValue")) {
		throw new Error("The optional EventVariable default is invalid.");
	}
};

g_VerifyNamedEventVariables();
```

`EventVariable` has no methods, setter binding, or live engine address. It is schema metadata.

## `EventVariableTemplate`

```text
new EventVariableTemplate(strEventVariableType, strEventVariableComment = "", EventVariableDefaultValue = undefined)
```

The base template supports the six setter-backed types only. An omitted or `undefined` default selects the built-in default for the chosen type.

### Fields and members

| Member | Type | Meaning |
| --- | --- | --- |
| `Type` | `string` | One of the six exact supported template types. |
| `Comment` | `string` | Human-authored schema metadata. |
| `DefaultValue` | `any` | Current value/reference retained by each new definition, without coercion or cloning. |
| `SetterType` | getter `string` | Native setter family: `bool`, `int`, `float`, or `string`. |
| `DefineEventVariable(strEventVariableName)` | method | Returns a named `EventVariable` with this type and default. |

```js
const { EventVariableTemplate } = require("events/variable");

const g_VerifyEventVariableTemplate = () => {
	const ScoreEventVariableTemplate = new EventVariableTemplate("long", "Round score", 0);
	const ScoreEventVariable = ScoreEventVariableTemplate.DefineEventVariable("Score");
	if (ScoreEventVariableTemplate.SetterType !== "int") {
		throw new Error("Long variables must use the integer setter family.");
	}

	if ((ScoreEventVariable.Name !== "Score") || (ScoreEventVariable.Type !== "long") || (ScoreEventVariable.DefaultValue !== 0)) {
		throw new Error("The template did not create the expected definition.");
	}

	ScoreEventVariableTemplate.DefaultValue = 5;
	const UpdatedScoreEventVariable = ScoreEventVariableTemplate.DefineEventVariable("UpdatedScore");
	if ((ScoreEventVariableTemplate.DefaultValue !== 5) || (UpdatedScoreEventVariable.DefaultValue !== 5)) {
		throw new Error("DefineEventVariable() did not read the current template default.");
	}
};

g_VerifyEventVariableTemplate();
```

The constructor requires a primitive string containing an exact supported type and a string `Comment`. It rejects objects, including boxed strings, without invoking their string conversion. It deliberately does not coerce or validate `DefaultValue`; use `CoerceEventVariableValue` first when accepting external input.

`Type`, `Comment`, and `DefaultValue` remain mutable. `SetterType` reads the current `Type`, and `DefineEventVariable()` reads the current type/default without copying `Comment`. Constructor checks are not repeated on property assignment: keep the type within the six supported template values and the comment a string. Existing definitions keep their prior field values; an object-valued default is still shared by reference.

## Specialized templates

Each specialized class extends `EventVariableTemplate` and supplies its canonical type and built-in default. Each canonical/established name pair below refers to the same constructor, not a forwarding subclass.

| Canonical class | Established class | Type | Built-in default | Setter type |
| --- | --- | --- | --- | --- |
| `BooleanEventVariableTemplate` | `BoolVariable` | `bool` | `false` | `bool` |
| `ByteEventVariableTemplate` | `ByteVariable` | `byte` | `0` | `int` |
| `ShortEventVariableTemplate` | `ShortVariable` | `short` | `0` | `int` |
| `LongEventVariableTemplate` | `LongVariable` | `long` | `0` | `int` |
| `FloatEventVariableTemplate` | `FloatVariable` | `float` | `0` | `float` |
| `StringEventVariableTemplate` | `StringVariable` | `string` | `""` | `string` |

```js
const {
	BooleanEventVariableTemplate,
	ByteVariable,
	FloatEventVariableTemplate,
	LongVariable,
	ShortEventVariableTemplate,
	StringVariable,
} = require("events/variable");

const g_VerifySpecializedEventVariableTemplates = () => {
	const vecEventVariableTemplates = [
		new BooleanEventVariableTemplate("Whether the round was successful", true),
		new ByteVariable("Winning team", 2),
		new ShortEventVariableTemplate("Player user ID", 0),
		new LongVariable("Total score", 0),
		new FloatEventVariableTemplate("Round duration", 0.0),
		new StringVariable("Display label", "unknown"),
	];
	const vecExpectedEventVariableTypes = ["bool", "byte", "short", "long", "float", "string"];
	const vecExpectedEventVariableSetterTypes = ["bool", "int", "int", "int", "float", "string"];
	for (let unIndex = 0; unIndex < vecEventVariableTemplates.length; ++unIndex) {
		const CurrentEventVariableTemplate = vecEventVariableTemplates[unIndex];
		if ((CurrentEventVariableTemplate.Type !== vecExpectedEventVariableTypes[unIndex]) || (CurrentEventVariableTemplate.SetterType !== vecExpectedEventVariableSetterTypes[unIndex])) {
			throw new Error(`Template ${unIndex} has the wrong event type mapping.`);
		}
	}
};

g_VerifySpecializedEventVariableTemplates();
```

## Custom-event schema example

Templates are directly usable as variable definitions through their PascalCase members. `CreateCustomEvent` from `events/custom` retains the live template objects in `EventVariables`; its initial `Variables` field references the same object. Reassigning either field does not synchronize the other. Pass `EventVariables` to `CreateEventPayload`.

```js
const { CreateCustomEvent, CreateEventPayload } = require("events/custom");
const {
	BooleanEventVariableTemplate,
	FloatEventVariableTemplate,
	LongEventVariableTemplate,
	StringEventVariableTemplate,
} = require("events/variable");

const g_VerifyCustomEventVariableSchema = () => {
	const RoundMetricCustomEvent = CreateCustomEvent("SourceJSRoundMetric", {
		Active: new BooleanEventVariableTemplate("Whether collection succeeded", false),
		Duration: new FloatEventVariableTemplate("Round duration in seconds", 0.0),
		Label: new StringEventVariableTemplate("Metric label", "round"),
		Score: new LongEventVariableTemplate("Combined score", 0),
	});
	const RoundMetricEventPayload = CreateEventPayload(RoundMetricCustomEvent.EventVariables, { Active: true, Duration: 83.5, Score: 12 });
	if ((RoundMetricEventPayload.Active !== true) || (RoundMetricEventPayload.Duration !== 83.5) || (RoundMetricEventPayload.Label !== "round") || (RoundMetricEventPayload.Score !== 12)) {
		throw new Error("The custom-event defaults and overrides were not composed.");
	}
};

g_VerifyCustomEventVariableSchema();
```

Native inference, coercion, and definition construction run synchronously in the plugin's JavaScript/game-thread context; coercion can invoke user conversion methods on that same thread. Descriptors do not own live engine events, and creating them does not register or load an event schema.

Define and load the corresponding resource before calling a custom descriptor's `FireEvent` method or its `Fire` PascalCase convenience alias with the composed payload. See [`events/custom`](events-custom.md) and [`events/resource`](events-resource.md) for descriptor and file lifecycle.

## Errors and capability rules

- `CreateEventVariableDefinition` throws when the name is omitted, empty, or not a string; native validation errors propagate.
- Native type strings must be exact canonical values; non-canonical and unknown spellings are rejected.
- Native definition, inference, coercion and type-list callbacks translate C++ exceptions into JavaScript errors. Type/name conversion checks complete UTF-8 input, and construction failures do not publish partial definitions or type lists. Existing user-conversion exceptions propagate unchanged; these guards do not guarantee allocator/OOM recovery.
- `CoerceEventVariableValue` defaults its type only when omitted. It uses V8 conversion and can throw for user conversion failures, symbols converted to strings or numbers, or numeric `bigint` coercion.
- `EventVariableTemplate` accepts only exact canonical `bool`, `byte`, `short`, `long`, `float`, and `string` types.
- Template comments must be strings.
- Template defaults are not range-checked or coerced automatically.
- `DefineEventVariable` calls the `CreateEventVariableDefinition` wrapper, which calls native `CreateEventVariable`; it does not mutate the template.
- `GetEventVariableTypes()` includes `local` and `wstring`, but no specialized template classes are exported for them.
- Missing native `events/variable` support causes natural `require()` failure; there is no fallback implementation.
