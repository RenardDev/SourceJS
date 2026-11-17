# `require("events/resource")`

> Warning: writing a `.res` file does not load it into the engine. Call `EventResourceFile.LoadEventsFromFile()` or `LoadEventsFromFile()` explicitly, and do so before firing events declared only by that resource.

The `events/resource` module builds Valve game-event resource text, writes ordered resource files through the Source filesystem, and asks the selected SDK's `IGameEventManager2` to load them. Native serialization validates event-variable types; the JavaScript `EventResourceFile` class manages paths and owns the ordered descriptor map, not an open file handle.

## Contents

- [Import](#import)
- [Exports](#exports)
- [Variable definitions](#variable-definitions)
- [`BuildEventResourceLine`](#buildeventresourceline)
- [`CreateEventResourceText`](#createeventresourcetext)
- [`DescribeEventResource`](#describeeventresource)
- [`LoadEventsFromFile`](#loadeventsfromfile)
- [`EventResourceFile`](#eventresourcefile)
- [Descriptor collection](#descriptor-collection)
- [Rendering and writing](#rendering-and-writing)
- [Loading and lifecycle](#loading-and-lifecycle)
- [Errors and capability rules](#errors-and-capability-rules)

## Import

```js
const {
	BuildEventResourceLine,
	CreateEventResourceText,
	DescribeEventResource,
	EventResourceFile,
	LoadEventsFromFile,
} = require("events/resource");
```

Importing requires the selected build's installed native `events/resource` module and its four native functions; there is no JavaScript parser or loader fallback. Invoke native functions on the game/server thread with a live plugin context. Serialization does not query the live `IGameEventManager2` interface; `LoadEventsFromFile` requires it when loading.

## Exports

| Export and signature | Result |
| --- | --- |
| [`BuildEventResourceLine(strEventVariableName, strEventVariableType)`](#buildeventresourceline) | One escaped variable line. |
| [`CreateEventResourceText(strEventName, EventVariables?)`](#createeventresourcetext) | One complete event block `string`. |
| [`DescribeEventResource(strEventName, EventVariables?)`](#describeeventresource) | Native `{ Name, Variables, Text }` descriptor. |
| [`new EventResourceFile(strEventResourceFilePath, ...vecEventResourceDefinitions)`](#eventresourcefile) | JavaScript ordered writable resource owner. |
| [`LoadEventsFromFile(strEventResourceFilePath)`](#loadeventsfromfile) | Native loaded-event count `number`. |

The public surface has five exact names: four JavaScript wrappers around bound native functions and the JavaScript `EventResourceFile` class. The package augments and exports the same native module object in place. No lower-camel or renamed compatibility aliases are installed. The class composes those functions with `filesystem.EnsureDirectoryExists`, `filesystem.WriteTextFile`, and live `paths.EVENT_ROOT` reads.

## Variable definitions

The `EventVariables` argument is an object whose own enumerable string-key property order becomes the line order in the native resource. Non-enumerable properties, symbol keys and inherited variable entries are excluded. Each property value can use one of these forms:

| Form | Example | Type selection |
| --- | --- | --- |
| type string | `UserID: "short"` | exact string type |
| descriptor | `Count: { Type: "long", DefaultValue: 0 }` | string `Type`, otherwise inferred `DefaultValue` |
| scalar default | `Active: true` | inferred from value |

Supported output types are exactly `bool`, `byte`, `short`, `long`, `float`, `string`, `local`, and `wstring`. Other type strings are rejected. A non-string descriptor `Type` is ignored rather than coerced; type selection then uses a non-`undefined` `DefaultValue`, if present, or falls back to the definition's own value category.

Native resource generation checks property enumeration, property reads and UTF-8 conversion. A failing getter or proxy trap preserves its JavaScript exception and stops generation; no partial resource text is returned. Descriptor type selection reads only `Type` and `DefaultValue`; those properties may be inherited, and descriptor functions can supply them too. It does not continue to `DefaultValue` after a failed `Type` read. The private property, string, descriptor and resource helpers also retain a pending JavaScript exception while propagating a C++ failure. Public native resource callbacks translate C++ exceptions to JavaScript errors; this does not guarantee allocator/OOM recovery, SDK ABI compatibility or safe use of expired native objects.

Boolean defaults infer `bool`; values recognized by V8 as signed `int32` infer `long`; other JavaScript numbers, including negative zero, infer `float`; `null`, `undefined`, string defaults, `bigint` values, and other values without a recognized descriptor override infer `string`. Bare string definitions are type names, not default text: use `{ DefaultValue: "text" }` for a string default. A non-`undefined` descriptor `DefaultValue` participates in inference and is copied to the returned variable descriptor, while `.res` text contains variable names and types only.

```js
const { DescribeEventResource } = require("events/resource");

const g_VerifyEventResourceDescriptor = () => {
	const EventResourceDescriptor = DescribeEventResource("SourceJSRoundMetric", {
		Active: true,
		Count: { DefaultValue: 0 },
		Duration: { Type: "float" },
		Label: "string",
		UserID: "short",
	});
	const EventVariableTypes = {};
	const vecEventVariables = EventResourceDescriptor.Variables;
	for (const EventVariable of vecEventVariables) {
		EventVariableTypes[EventVariable.Name] = EventVariable.Type;
	}

	if ((EventResourceDescriptor.Name !== "SourceJSRoundMetric") || (typeof EventResourceDescriptor.Text !== "string")) {
		throw new Error("DescribeEventResource() returned unexpected descriptor fields.");
	}

	if ((EventVariableTypes.Active !== "bool") || (EventVariableTypes.Count !== "long") || (EventVariableTypes.Duration !== "float") || (EventVariableTypes.Label !== "string") || (EventVariableTypes.UserID !== "short")) {
		throw new Error("Event variable types were not preserved exactly.");
	}
};

g_VerifyEventResourceDescriptor();
```

## `BuildEventResourceLine`

```text
BuildEventResourceLine(strEventVariableName, strEventVariableType) -> string
```

`BuildEventResourceLine` requires non-empty variable-name and type strings. It escapes quotes and backslashes in both values, validates the exact type, and returns one tab-indented line ending in `\n`.

```js
const { BuildEventResourceLine } = require("events/resource");

const g_VerifyEventResourceVariableLines = () => {
	const strCountEventResourceLine = BuildEventResourceLine("RoundCount", "long");
	const strLabelEventResourceLine = BuildEventResourceLine("Display\\Label", "string");
	if (strCountEventResourceLine !== "\t\"RoundCount\"\t\"long\"\n") {
		throw new Error("The exact long type was not preserved.");
	}

	if (!strLabelEventResourceLine.includes("Display\\\\Label") || !strLabelEventResourceLine.endsWith("\"string\"\n")) {
		throw new Error("The resource line was not escaped.");
	}
};

g_VerifyEventResourceVariableLines();
```

## `CreateEventResourceText`

```text
CreateEventResourceText(strEventName, EventVariables = {}) -> string
```

`CreateEventResourceText` requires a non-empty event-name string and an object when variables are supplied. It returns exactly one Valve event block. The event name and rendered lines are escaped; own variable property order is preserved.

```js
const { CreateEventResourceText } = require("events/resource");

const g_VerifyCacheRefreshEventResourceText = () => {
	const strCacheRefreshEventResourceText = CreateEventResourceText("SourceJSCacheRefresh", { Reason: "string", Revision: "long" });
	if (!strCacheRefreshEventResourceText.startsWith("\"SourceJSCacheRefresh\"\n{\n")) {
		throw new Error("The event block header is invalid.");
	}

	if (strCacheRefreshEventResourceText.indexOf("\"Reason\"") > strCacheRefreshEventResourceText.indexOf("\"Revision\"")) {
		throw new Error("Variable order was not preserved.");
	}

	if (!strCacheRefreshEventResourceText.endsWith("}\n")) {
		throw new Error("The event block is not terminated.");
	}
};

g_VerifyCacheRefreshEventResourceText();
```

## `DescribeEventResource`

```text
DescribeEventResource(strEventName, EventVariables = {}) -> object
```

`DescribeEventResource` builds the variable metadata first and then renders the resource text. Both phases read the definitions; getters or proxies can run more than once, so use stable, side-effect-free definitions when metadata and text must agree.

### Result fields

| Field | Type | Meaning |
| --- | --- | --- |
| `Name` | `string` | Exact event name. |
| `Variables` | `Array<object>` | Ordered own variables with exact types. |
| `Text` | `string` | Complete resource block. |

Each variable object exposes exact `Name` and `Type` fields. It also exposes `DefaultValue` for a non-string scalar definition, including an own `DefaultValue: undefined` for a bare `undefined` definition, or for a descriptor whose `DefaultValue` is not `undefined`. Other source metadata is not copied because `.res` text contains names and types only.

The result and its variable records use own data properties; inherited setters are not invoked while those records are built. JavaScript exceptions from enumeration, definition reads, and conversion propagate without returning a partial description. A failure stops subsequent reads in the failing phase; a text-phase failure does not undo reads already completed by the metadata phase.

```js
const { DescribeEventResource } = require("events/resource");

const g_VerifyPlayerScoreEventResourceDescriptor = () => {
	const PlayerScoreEventResourceDescriptor = DescribeEventResource("SourceJSPlayerScore", { Score: { Type: "long", DefaultValue: 10 }, Team: "byte" });
	const strExpectedPlayerScoreEventResourceText = "\"SourceJSPlayerScore\"\n{\n\t\"Score\"\t\"long\"\n\t\"Team\"\t\"byte\"\n}\n";
	const vecEventVariables = PlayerScoreEventResourceDescriptor.Variables;
	let ScoreEventVariable = null;
	for (const EventVariable of vecEventVariables) {
		if (EventVariable.Name === "Score") {
			ScoreEventVariable = EventVariable;
			break;
		}
	}

	if (ScoreEventVariable === null) {
		throw new Error("The Score variable is missing.");
	}

	if ((ScoreEventVariable.Name !== "Score") || (ScoreEventVariable.Type !== "long") || (ScoreEventVariable.DefaultValue !== 10)) {
		throw new Error("The structured default was not retained.");
	}

	if (PlayerScoreEventResourceDescriptor.Text !== strExpectedPlayerScoreEventResourceText) {
		throw new Error("The descriptor text does not match its variables.");
	}
};

g_VerifyPlayerScoreEventResourceDescriptor();
```

## `LoadEventsFromFile`

```text
LoadEventsFromFile(strEventResourceFilePath) -> number
```

The path must be a non-empty string without NUL characters. SourceJS calls `IGameEventManager2::LoadEventsFromFile()` directly and returns the SDK's integer result. The function does not create, inspect, or write the file first.

Use the exact path accepted by the engine. `EventResourceFile.LoadEventsFromFile()` supplies its resolved `FullEventResourceFilePath` automatically:

```js
const { EventResourceFile, LoadEventsFromFile } = require("events/resource");

const g_VerifyDirectEventResourceLoad = () => {
	const DirectLoadEventResourceFile = new EventResourceFile("sourcejs/documentation/direct_load", { EventName: "SourceJSDirectLoadProbe", EventVariables: { Value: "long" } });
	const strWrittenEventResourceFilePath = DirectLoadEventResourceFile.WriteEventResourceFile();
	const nLoadedEventCount = LoadEventsFromFile(strWrittenEventResourceFilePath);
	if (!Number.isInteger(nLoadedEventCount) || (nLoadedEventCount <= 0)) {
		throw new Error("The engine did not return an event count.");
	}
};

g_VerifyDirectEventResourceLoad();
```

## `EventResourceFile`

```text
new EventResourceFile(strEventResourceFilePath, ...vecEventResourceDefinitions)
```

`strEventResourceFilePath` is relative to exact `paths.EVENT_ROOT`. Backslashes become forward slashes, repeated separators collapse, leading separators are removed, and one trailing `.res` extension is stripped case-insensitively during construction. Rendering and full-path resolution reuse that stored normalized name without stripping another suffix: `double.res.res` has the resource name `double.res` and the filename `double.res.res`. Use a relative path without NUL characters, quotes, line breaks, drive prefixes, or `.`/`..` traversal segments.

Each variadic event is either a non-empty name string or a descriptor with `EventName` and optional `EventVariables` fields. The established `Name`/`Variables` input fields are accepted when the corresponding canonical own fields are absent; canonical fields take precedence. Constructor insertion order becomes file order. Native `DescribeEventResource()` results are a different shape: their `Variables` field is an array, not the plain variable-definition object required here.

### Fields and getters

| Member | Type | Meaning |
| --- | --- | --- |
| `EventResourceFilePath` | `string` | Constructor-normalized relative name with at most one final `.res` suffix removed. |
| `EventResources` | `Map<string, descriptor>` | Live ordered descriptor collection. |
| `FullEventResourceFilePath` | getter `string` | Event root joined with the normalized path and `.res`. |
| `EventResourceCount` | getter `number` | Current descriptor count. |

A stored descriptor has four own fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `EventName` | `string` | Trimmed lookup and event name. |
| `EventVariables` | plain object | Live variable-definition object used on the next render. |
| `Name` | `string` | Initially the same value as `EventName`. |
| `Variables` | plain object | Initially the same object reference as `EventVariables`. |

The descriptor object is newly created when added, but its variables object is retained by reference. Mutating that object changes subsequent `CreateEventResourceText()` and `WriteEventResourceFile()` output. `Name` and `Variables` are ordinary initial mirrors, not synchronized accessors: reassigning either does not change the canonical fields or the `Map` lookup key. Use `EventName`/`EventVariables` in new code and the class mutation methods to update stored descriptors; direct map or descriptor replacement bypasses normalization. These mutations do not update an already loaded engine schema.

```js
const { EventResourceFile } = require("events/resource");

const g_VerifyRuntimeEventResourceFile = () => {
	const RuntimeNoticeEventVariables = { Message: "string", UserID: "short" };
	const RuntimeEventResourceFile = new EventResourceFile("sourcejs/runtime_events.res", { EventName: "SourceJSRuntimeNotice", EventVariables: RuntimeNoticeEventVariables });
	if ((RuntimeEventResourceFile.EventResourceFilePath !== "sourcejs/runtime_events") || !RuntimeEventResourceFile.FullEventResourceFilePath.endsWith("sourcejs/runtime_events.res")) {
		throw new Error("The resource path was not normalized.");
	}

	if (RuntimeEventResourceFile.EventResources.size !== RuntimeEventResourceFile.EventResourceCount) {
		throw new Error("The resource count does not match the live collection.");
	}

	RuntimeNoticeEventVariables.Severity = "byte";
	if (!RuntimeEventResourceFile.CreateEventResourceText().includes("\"Severity\"\t\"byte\"")) {
		throw new Error("The live variable definitions were not rendered.");
	}
};

g_VerifyRuntimeEventResourceFile();
```

## Descriptor collection

### Mutation and lookup

| Method | Result | Behavior |
| --- | --- | --- |
| `AddEventResource(EventResourceDefinition)` | this resource file | Adds or replaces a name or descriptor. |
| `SetEventResource(EventResourceDefinition, EventVariables?)` | this resource file | Adds or replaces a name or descriptor; a separate variables object is accepted only with a name. |
| `GetEventResource(strEventName)` | descriptor or `undefined` | Reads one live descriptor. |
| `HasEventResource(strEventName)` | `boolean` | Tests one exact name. |
| `DeleteEventResource(strEventName)` | `boolean` | Removes one exact name. |
| `ClearEventResources()` | `undefined` | Removes every descriptor. |

`SetEventResource` accepts the same name/descriptor forms as `AddEventResource`. With a string name, omitted variables default to an empty object; with a descriptor, a separate non-`undefined` variables argument throws before the collection is changed.

Replacing an existing `Map` key keeps its original insertion position.

```js
const { EventResourceFile } = require("events/resource");

const g_VerifyEventResourceCollection = () => {
	const CollectionEventResourceFile = new EventResourceFile("sourcejs/collection");
	CollectionEventResourceFile.AddEventResource("SourceJSEmptyEvent").SetEventResource("SourceJSRoundValue", { Value: "long" });

	if (!CollectionEventResourceFile.HasEventResource("SourceJSRoundValue")) {
		throw new Error("The event descriptor was not stored.");
	}

	const RoundValueEventResourceDescriptor = CollectionEventResourceFile.GetEventResource("SourceJSRoundValue");
	if (RoundValueEventResourceDescriptor === undefined) {
		throw new Error("The stored round-value descriptor could not be retrieved.");
	}

	RoundValueEventResourceDescriptor.EventVariables.Label = "string";
	if (!CollectionEventResourceFile.CreateEventResourceText().includes("\"Label\"\t\"string\"")) {
		throw new Error("The live descriptor mutation was not rendered.");
	}

	if (!CollectionEventResourceFile.DeleteEventResource("SourceJSEmptyEvent") || CollectionEventResourceFile.DeleteEventResource("SourceJSEmptyEvent")) {
		throw new Error("Resource deletion returned an unexpected result.");
	}
};

g_VerifyEventResourceCollection();
```

### Iteration

| Method | Result |
| --- | --- |
| `Keys()` | live `Map` key iterator |
| `Values()` | live descriptor iterator |
| `Entries()` | live `[strEventName, EventResourceDescriptor]` iterator |
| `[Symbol.iterator]()` | same result as `Entries()` |
| `ForEach(Callback, ThisArgument?)` | this resource file |

`ForEach` invokes `Callback.call(ThisArgument, EventResourceDescriptor, strEventName, EventResourceFile)` and requires an actual function.

```js
const { EventResourceFile } = require("events/resource");

const g_VerifyEventResourceIteration = () => {
	const IterationEventResourceFile = new EventResourceFile("sourcejs/iteration", { EventName: "SourceJSFirst", EventVariables: { Value: "long" } }, { EventName: "SourceJSSecond", EventVariables: { Text: "string" } });
	const vecEventResourceNames = Array.from(IterationEventResourceFile.Keys());
	const vecEventResourceDescriptors = Array.from(IterationEventResourceFile.Values());
	const vecEventResourceEntries = Array.from(IterationEventResourceFile.Entries());
	const vecIteratedEventResourceEntries = Array.from(IterationEventResourceFile);
	const IterationCallbackContext = { VisitedEventNames: [] };

	const VisitEventResourceDescriptor = function (EventResourceDescriptor, strEventName, EventResourceFile) {
		if ((EventResourceFile !== IterationEventResourceFile) || (EventResourceDescriptor.EventName !== strEventName)) {
			throw new Error("EventResourceFile.ForEach supplied inconsistent values.");
		}

		this.VisitedEventNames.push(strEventName);
	};

	if (IterationEventResourceFile.ForEach(VisitEventResourceDescriptor, IterationCallbackContext) !== IterationEventResourceFile) {
		throw new Error("EventResourceFile.ForEach() returned an unexpected value.");
	}

	if ((vecEventResourceNames.length !== 2) || (vecEventResourceDescriptors.length !== 2) || (vecEventResourceEntries.length !== 2) || (vecIteratedEventResourceEntries.length !== 2)) {
		throw new Error("Resource iteration lost an event.");
	}

	if (IterationCallbackContext.VisitedEventNames.join(",") !== "SourceJSFirst,SourceJSSecond") {
		throw new Error("EventResourceFile.ForEach() changed insertion order.");
	}
};

g_VerifyEventResourceIteration();
```

## Rendering and writing

### `CreateEventResourceText` and `toString`

`EventResourceFile.CreateEventResourceText()` wraps all native event blocks in one root block named by `EventResourceFilePath`. Every event block line is indented one additional tab. The standard `toString()` method returns the same newly rendered string.

```js
const { EventResourceFile } = require("events/resource");

const g_VerifyRenderedEventResourceText = () => {
	const RenderedEventResourceFile = new EventResourceFile("sourcejs/rendered", { EventName: "SourceJSRenderProbe", EventVariables: { Value: "long" } });
	const strRenderedEventResourceText = RenderedEventResourceFile.CreateEventResourceText();
	if (RenderedEventResourceFile.toString() !== strRenderedEventResourceText) {
		throw new Error("The resource render methods returned inconsistent text.");
	}

	if (!strRenderedEventResourceText.startsWith("\"sourcejs/rendered\"\n{\n\t\"SourceJSRenderProbe\"")) {
		throw new Error("The resource root or event indentation is invalid.");
	}
};

g_VerifyRenderedEventResourceText();
```

### `WriteEventResourceFile`

`WriteEventResourceFile()` captures `FullEventResourceFilePath` once using the normalized, read-only `EventResourceFilePath` and the live event root, ensures the parent directory, renders current text, and calls `filesystem.WriteTextFile`. It throws when `filesystem.EnsureDirectoryExists` or `filesystem.WriteTextFile` returns false and otherwise returns that captured operation path. The class provides no atomic replacement or rollback of directory/file effects when rendering or writing fails.

```js
const { EventResourceFile } = require("events/resource");

const g_VerifyWritableEventResourceFile = () => {
	const WritableEventResourceFile = new EventResourceFile("sourcejs/runtime/events", { EventName: "SourceJSRuntimeEvent", EventVariables: { Revision: "long" } });
	const strWrittenEventResourceFilePath = WritableEventResourceFile.WriteEventResourceFile();
	if (strWrittenEventResourceFilePath !== WritableEventResourceFile.FullEventResourceFilePath) {
		throw new Error("EventResourceFile.WriteEventResourceFile() returned the wrong path.");
	}
};

g_VerifyWritableEventResourceFile();
```

## Loading and lifecycle

`EventResourceFile.LoadEventsFromFile()` calls the native `LoadEventsFromFile()` function with `FullEventResourceFilePath` and returns the integer count unchanged. It does not call `WriteEventResourceFile()` automatically.

```js
const { EventResourceFile } = require("events/resource");

const g_VerifyLoadableEventResourceFile = () => {
	const LoadableEventResourceFile = new EventResourceFile("sourcejs/runtime/loadable", { EventName: "SourceJSLoadableEvent", EventVariables: { Enabled: "bool" } });
	const strWrittenEventResourceFilePath = LoadableEventResourceFile.WriteEventResourceFile();
	if (strWrittenEventResourceFilePath !== LoadableEventResourceFile.FullEventResourceFilePath) {
		throw new Error("The loadable event resource was not written to its resolved path.");
	}

	const nLoadedEventCount = LoadableEventResourceFile.LoadEventsFromFile();
	if (!Number.isInteger(nLoadedEventCount) || (nLoadedEventCount <= 0)) {
		throw new Error("EventResourceFile.LoadEventsFromFile() did not return the native count.");
	}

	if ((LoadableEventResourceFile.ClearEventResources() !== undefined) || (LoadableEventResourceFile.EventResourceCount !== 0)) {
		throw new Error("EventResourceFile.ClearEventResources() did not empty the descriptor map.");
	}
};

g_VerifyLoadableEventResourceFile();
```

Writing and loading are synchronous filesystem/engine operations on the game thread. Initialize during plugin startup and reuse the loaded definitions; do not write or load on every tick. Loading changes the engine's event schema and is not undone by clearing the JavaScript `EventResourceFile`. Treat written resource files and loaded schemas as server-lifetime resources. Use stable event names and load each final resource deliberately rather than rewriting it during active event dispatch.

## Errors and capability rules

- Native event names, type strings, and load paths must be non-empty strings. Direct `BuildEventResourceLine` calls also require a non-empty variable name; variable-object keys are serialized as provided, including an empty key.
- Native `CreateEventResourceText` and `DescribeEventResource` variables must be non-array, non-function objects when supplied.
- `EventResourceFile` paths must be strings and cannot contain NUL characters, quotes, or line breaks. `LoadEventsFromFile` also rejects NUL characters before invoking the engine.
- `EventResourceFile` event names are trimmed and must remain non-empty.
- `EventResourceFile` variables must be plain non-array objects with `Object.prototype` or a null prototype.
- Descriptor form does not accept a separate variables argument.
- `GetEventResource`, `HasEventResource`, and `DeleteEventResource` require exact non-empty string names and do not trim lookup input.
- `ForEach` requires a function.
- Native serialization escapes quotes and backslashes, not the full resource grammar; it does not validate path traversal or event naming policy. Use trusted, engine-valid event and variable names without NUL characters or line breaks; the renderers do not enforce that policy.
- A false status from directory creation or text writing throws with the operation's resolved directory/file path. Path resolution and rendering exceptions propagate without a rollback.
- Missing native `events/resource` functions cause import failure; there is no fallback. An unavailable live `IGameEventManager2` interface makes loading fail, but is not checked during import or serialization.

Use [`events/custom`](events-custom.md) to create reusable event descriptors and payload defaults, and [`events/manager`](events-manager.md) or [`events/listener`](events-listener.md) to observe loaded events.
