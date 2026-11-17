# `require("loggers")`

> AI agents: use the contents to locate the current logger contract, then check the package and native sink separately. Logging is synchronous on the server thread, including formatting, user-provided integer sources, and Source filesystem writes.

`loggers` provides formatted JavaScript severity helpers and a logger hierarchy with live level/area sources, printf-style formatting, and optional appends to a configured log file. The implementation lives in `packages/sourcejs/loggers.js`; `src/sourcejs/modules/ModuleBindings.cpp` installs the underlying native `LogInfo`, `LogWarning`, and `LogError` sinks. Public package helpers are not direct native-function exports.

## Contents

- [Exports](#exports)
- [Levels and areas](#levels-and-areas)
- [Top-level functions](#top-level-functions)
- [`LogInstance`](#loginstance)
- [`LogManager`](#logmanager)
- [`ROOT_LOGGER`](#root_logger)
- [Formatting](#formatting)
- [File ownership](#file-ownership)
- [Errors and common mistakes](#errors-and-common-mistakes)
- [Related modules](#related-modules)

## Exports

```js
const {
	LogArea,
	LogInstance,
	LogLevel,
	LogManager,
	ROOT_LOGGER,
	LogAtLevel,
	LogCritical,
	LogDebug,
	LogError,
	LogException,
	LogInfo,
	LogMessage,
	LogWarning,
} = require("loggers");
```

| Export | Kind | Purpose |
| --- | --- | --- |
| [`LogArea`](#logarea) | frozen object | Output destination bit mask. |
| [`LogInstance`](#loginstance) | class | Named child in a logger hierarchy. |
| [`LogLevel`](#loglevel) | frozen object | Severity and filtering values. |
| [`LogManager`](#logmanager) | class | Root logger with writable routing and format configuration. |
| [`ROOT_LOGGER`](#root_logger) | `LogManager` | Shared root used by the top-level formatted helpers. |
| `LogAtLevel` | function | Logs with an explicit level. |
| `LogCritical` | function | Logs at `LogLevel.CRITICAL`. |
| `LogDebug` | function | Logs at `LogLevel.DEBUG`. |
| `LogError` | function | Logs at `LogLevel.ERROR`. |
| `LogException` | function | Logs an error message plus an optional `Error` stack or message. |
| `LogInfo` | function | Logs a formatted root record at `LogLevel.INFO`; the package routes it through native `LogInfo`. |
| `LogMessage` | function | Logs an unfiltered ordinary message. |
| `LogWarning` | function | Logs a formatted root record at `LogLevel.WARNING`; the package routes it through native `LogWarning`. |

## Levels and areas

### `LogLevel`

| Member | Value | Native route |
| --- | ---: | --- |
| `LogLevel.DEBUG` | `10` | `LogInfo` |
| `LogLevel.INFO` | `20` | `LogInfo` |
| `LogLevel.WARNING` | `30` | `LogWarning` |
| `LogLevel.ERROR` | `40` | `LogError` |
| `LogLevel.CRITICAL` | `50` | `LogError` |
| `LogLevel.MESSAGE` | `60` | `LogInfo`; bypasses the configured minimum level |

A record is filtered when its numeric level is lower than `Logger.LogLevel`. `LogLevel.MESSAGE` is the only value that bypasses this comparison, but the configured minimum-level source is still resolved first. Any safe integer is accepted, not just an enum member: other values at least `LogLevel.ERROR` route to native `LogError`, values at least `LogLevel.WARNING` to `LogWarning`, and lower values to `LogInfo`.

### `LogArea`

| Member | Value | Behavior |
| --- | ---: | --- |
| `LogArea.CONSOLE` | `1` | Sends the record to native SourceJS output. |
| `LogArea.MAIN` | `2` | Sends the record to native SourceJS output. |
| `LogArea.SOURCEJS` | `4` | Sends the record to native SourceJS output. |
| `LogArea.SCRIPT` | `8` | Appends the formatted record to `FilePath`. |
| `LogArea.ALL` | `15` | Enables every bit above. |

The current native binding has one severity-routed output path. Combining `LogArea.CONSOLE`, `LogArea.MAIN`, and `LogArea.SOURCEJS` still produces one native line, not three duplicate lines. `LogArea.SCRIPT` is independent and can be combined with any native-output bit. Masks are safe integers interpreted with JavaScript's signed 32-bit bitwise operations; unknown bits are ignored, and a zero mask can return `true` without selecting any destination.

The underlying native `LogInfo`, `LogWarning`, and `LogError` bindings convert their first argument to a native string; an omitted argument produces an empty message. A JavaScript conversion exception propagates unchanged and prevents native output. A nonthrowing conversion/encoding failure reports `The log message could not be converted to a native string.` The conversion catch ends before the output call. JavaScript logger formatting is a separate, earlier step.

Native formatting grows its message storage for larger records rather than treating the stack buffer as a maximum; client and server sinks receive the same complete formatted record. External engine sinks may impose their own limits. Embedded NUL in a JavaScript message is rejected before output with `The log message must not contain embedded NUL characters.` Native printf formatting, embedded-NUL output, or message-storage failures produce an `[ERROR]` diagnostic beginning `FormatLogMessage failed`, not a truncated success. If only engine-line allocation fails, the complete message falls back to standard output/error and may not reach the engine or client. Native output is best effort; a JavaScript logger's routing result is not acknowledgement of sink delivery.

C++ exceptions from these native callbacks are translated to JavaScript errors identifying the callback, without exposing the original exception text. This is not recovery from fatal V8 out-of-memory termination or invalid native memory access.

When a log call runs synchronously inside a registered client-console or say-command callback's active reply scope, its native line is also mirrored to the issuing client's console. Synchronously nested calls inherit that scope; after it ends, output returns to the previous scope. Outside an active client reply scope, logs remain server-only. The server console receives the same record in either case.

Build area masks with bitwise operators:

```js
const { DoesFileExist, RemoveFile } = require("filesystem");
const { LogArea, LogLevel, LogManager } = require("loggers");

const g_AuditLogManager = new LogManager("audit", { LogLevel: LogLevel.INFO, LogAreas: LogArea.CONSOLE | LogArea.SCRIPT, FilePath: "examples/audit" });
const g_strAuditFilePath = g_AuditLogManager.FilePath;
const g_vecAuditErrors = [];
let g_bOwnAuditFile = false;

try {
	if (DoesFileExist(g_strAuditFilePath)) {
		throw new Error(`Refusing to append to existing file: ${g_strAuditFilePath}.`);
	}

	g_bOwnAuditFile = true;
	if (!g_AuditLogManager.LogInfo("Plugin audit started.")) {
		throw new Error("Audit record was unexpectedly filtered.");
	}
} catch (CaughtError) {
	g_vecAuditErrors.push(CaughtError);
} finally {
	try {
		if (!g_AuditLogManager.UnloadLogManager()) {
			throw new Error("Audit logger cleanup failed.");
		}
	} catch (CaughtError) {
		g_vecAuditErrors.push(CaughtError);
	}

	try {
		if (g_bOwnAuditFile && DoesFileExist(g_strAuditFilePath) && !RemoveFile(g_strAuditFilePath)) {
			throw new Error(`Failed to remove ${g_strAuditFilePath}.`);
		}
	} catch (CaughtError) {
		g_vecAuditErrors.push(CaughtError);
	}
}

if (g_vecAuditErrors.length === 1) {
	throw g_vecAuditErrors[0];
}

if (g_vecAuditErrors.length > 1) {
	throw new AggregateError(g_vecAuditErrors, "Audit logging or cleanup failed.");
}
```

The relative path becomes `<paths.LOG_ROOT>/examples/audit.log`, and the example removes it after the routing check. All file examples require exclusive control of their temporary path for the entire operation: the existence check is not an atomic reservation. They refuse existing files, attempt manager cleanup and owned-file removal independently, and retain the original failure before cleanup failures. Cleanup removes the file, not parent directories; it cannot undo output already delivered.

## Top-level functions

```js
LogAtLevel(LogLevel, strLogMessage, ...vecFormatArguments)
LogDebug(strMessage, ...vecFormatArguments)
LogInfo(strMessage, ...vecFormatArguments)
LogWarning(strMessage, ...vecFormatArguments)
LogError(strMessage, ...vecFormatArguments)
LogException(strMessage, ErrorValue = null, ...vecFormatArguments)
LogCritical(strMessage, ...vecFormatArguments)
LogMessage(strMessage, ...vecFormatArguments)
```

Every message must be a string when it passes through the JavaScript formatter. `LogAtLevel()` filters before message formatting or output-area resolution and returns `false` when filtered. `LogException()` first validates its message/error arguments and reads the error details before delegating, even when the eventual record will be filtered. `LogLevel` must be a safe integer, or an object/function with `GetInteger()` returning one; it is a level source, not necessarily a numeric argument. Integer sources are called synchronously with their own receiver and may throw or have side effects.

All top-level helpers use `ROOT_LOGGER`, including its live level, areas, prefix, and optional file configuration.

### Operational severity logging

```js
const {
	LogLevel,
	LogAtLevel,
	LogCritical,
	LogDebug,
	LogError,
	LogException,
	LogInfo,
	LogMessage,
	LogWarning,
} = require("loggers");
const { GetAllEntities } = require("filters/entities");
const { GetAllPlayers } = require("filters/players");
const { GetGlobalVariables } = require("globals");
const { GetAllInterfaceNames, GetInterfaceRecord } = require("interfaces");

const g_GlobalVariables = GetGlobalVariables();
const g_vecInterfaceNames = GetAllInterfaceNames();
const g_strEngineServerInterfaceName = g_vecInterfaceNames.find((strInterfaceName) => strInterfaceName.startsWith("VEngineServer"));

LogDebug("Scanned %d current entities.", GetAllEntities().length);
LogInfo("Current map: %s.", g_GlobalVariables.MapName);

if (g_GlobalVariables.AbsoluteFrameTime > (g_GlobalVariables.IntervalPerTick * 1.5)) {
	LogWarning("Frame time is %f ms.", g_GlobalVariables.AbsoluteFrameTime * 1000);
}

if (GetInterfaceRecord("SourceJSMissingDiagnosticInterface") === null) {
	LogError("Diagnostic interface lookup returned null as expected.");
}

if (g_strEngineServerInterfaceName === undefined) {
	LogCritical("Required VEngineServer interface is unavailable.");
}

LogMessage("Administrator cache refreshed.");
LogAtLevel(LogLevel.INFO, "Active players: %d.", GetAllPlayers().length);

try {
	JSON.parse("{");
} catch (CaughtError) {
	LogException("Malformed diagnostic payload was rejected.", CaughtError);
}
```

`LogException()` appends the supplied error's `stack`, or its `message` when no stack is available, before applying the ordinary formatter. Format tokens inside those details can therefore consume remaining format arguments. The second argument must be an `Error` or `null`; another value raises `TypeError`.

## `LogInstance`

### Construction

Signature: `new LogInstance(ParentLogger = null, strLoggerName = "", LoggerOptions = {})`.

A direct `LogInstance` requires a parent `LogInstance` or `LogManager`; use `LogManager` for a root. `strLoggerName` must be a string. An own `LoggerOptions.Prefix` property must be a string; when absent, the child copies its parent's prefix. Inherited option properties are ignored.

| Use | Example |
| --- | --- |
| Construct a logger with an existing parent `RootLogger`. Import `LogInstance` from `loggers`. | `const RecordsLogger = new LogInstance(RootLogger, "records");` |

Children are normally created through `ParentLogger.GetOrCreateChildLogger(strLoggerName)`, which caches one instance per exact name.

### Fields and getters

These are read-only getters on `LogInstance`; assigning them in strict mode throws. Logger backing state is private: no public `m_*` storage fields or aliases are exposed. `LogManager` overrides only its routing/file/format getters with the writable properties documented below. A read-only getter does not make its returned object immutable.

| Member | Type | Behavior |
| --- | --- | --- |
| `ParentLogger` | `LogInstance \| null` | Parent hierarchy node. The built-in `LogManager` root has `null`. |
| `LocalLoggerName` | `string` | Local hierarchy segment. |
| `ChildLoggers` | `Map<string, LogInstance>` | Read-only access to a mutable exact-name child registry. Use hierarchy methods to preserve a tree of valid logger instances. |
| `Prefix` | `string` | Read-only text prepended to runtime output. A child copies its parent's prefix when created; supply the prefix through constructor options, not assignment. |
| `LoggerName` | `string` | Dot-joined hierarchy name. |
| `RootLogManager` | `LogManager` | Computed highest parent: walks the chain and allocates a temporary `Set` to detect cycles; throws on a cycle or invalid parent. Not a constant-time raw field getter. |
| `LogAreas` | safe integer | Live value delegated to the root. |
| [`LogLevel`](#loglevel) | safe integer | Live value delegated to the root. |
| `FilePath` | `string \| null` | Normalized root file path. |
| `LogRecordFormat` | `string \| null` | Root record format. |
| `LogDateFormat` | `string \| null` | Root timestamp format. |

### Hierarchy methods

| Method | Result | Behavior |
| --- | --- | --- |
| `GetOrCreateChildLogger(strChildLoggerName)` | `LogInstance` | Returns the cached child for a non-empty exact name. |
| `DeleteChildLogger(strChildLoggerName)` | `boolean` | Recursively clears and removes one child; returns `false` when the name is absent. |
| `ClearChildLoggers()` | `undefined` | Validates the reachable child tree, then clears all descendant registries. Invalid entries, repeated nodes, or cycles throw before clearing. |

### Logging methods

| Method | Result | Behavior |
| --- | --- | --- |
| `LogAtLevel(LogLevel, strLogMessage, ...vecFormatArguments)` | `boolean` | Resolves the supplied level source; returns `false` when filtered, otherwise processes the selected areas and returns `true`. |
| `LogDebug(strMessage, ...vecFormatArguments)` | `boolean` | Uses `LogLevel.DEBUG`. |
| `LogInfo(strMessage, ...vecFormatArguments)` | `boolean` | Uses `LogLevel.INFO`. |
| `LogWarning(strMessage, ...vecFormatArguments)` | `boolean` | Uses `LogLevel.WARNING`. |
| `LogError(strMessage, ...vecFormatArguments)` | `boolean` | Uses `LogLevel.ERROR`. |
| `LogException(strMessage, ErrorValue = null, ...vecFormatArguments)` | `boolean` | Uses `LogLevel.ERROR` and appends an `Error` stack or message. |
| `LogCritical(strMessage, ...vecFormatArguments)` | `boolean` | Uses `LogLevel.CRITICAL`. |
| `LogMessage(strMessage, ...vecFormatArguments)` | `boolean` | Uses unfiltered `LogLevel.MESSAGE`. |

### Named plugin hierarchy

```js
const { LogArea, LogInfo, LogLevel, LogManager } = require("loggers");
const { GetAllPlayers } = require("filters/players");

const g_InventoryLogManager = new LogManager("inventory", { Prefix: "[Inventory] ", LogLevel: LogLevel.DEBUG, LogAreas: LogArea.CONSOLE });
const g_vecInventoryErrors = [];
try {
	const DatabaseLogInstance = g_InventoryLogManager.GetOrCreateChildLogger("database");
	const QueryLogInstance = DatabaseLogInstance.GetOrCreateChildLogger("query");
	const unCurrentPlayerCount = GetAllPlayers().length;
	if (!QueryLogInstance.LogDebug("Preparing item query for %d current players.", unCurrentPlayerCount)) {
		throw new Error("Query debug record was unexpectedly filtered.");
	}

	if (!DatabaseLogInstance.LogWarning("Database reconnect attempt %d.", 2)) {
		throw new Error("Database warning record was unexpectedly filtered.");
	}

	LogInfo(`LoggerName=${QueryLogInstance.LoggerName}.`);

	if (QueryLogInstance.RootLogManager !== g_InventoryLogManager) {
		throw new Error("Query logger resolved the wrong root.");
	}

	if (!g_InventoryLogManager.DeleteChildLogger("database")) {
		throw new Error("Database logger deletion failed.");
	}
} catch (CaughtError) {
	g_vecInventoryErrors.push(CaughtError);
} finally {
	try {
		if (!g_InventoryLogManager.UnloadLogManager()) {
			throw new Error("Inventory logger cleanup failed.");
		}
	} catch (CaughtError) {
		g_vecInventoryErrors.push(CaughtError);
	}
}

if (g_vecInventoryErrors.length === 1) {
	throw g_vecInventoryErrors[0];
}

if (g_vecInventoryErrors.length > 1) {
	throw new AggregateError(g_vecInventoryErrors, "Inventory logging or cleanup failed.");
}
```

The full query name is `inventory.database.query`. Deleting `database` clears `query` first. Removing cached children does not detach already retained child objects or change their parent links; callers holding them can still log through the original root.

## `LogManager`

### Construction

Signature: `new LogManager(strLoggerName = "sourcejs", LoggerOptions = {})`.

`LoggerOptions` must be a non-null, non-array object and reads only the following own PascalCase properties. Inherited properties and unknown keys are ignored; `m_*` backing-field names are not option aliases and are never read from this object. An absent, `undefined`, or `null` level/area option selects its default. An own `Prefix` must be a string, including when its value is `undefined`.

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `Prefix` | `string` | `""` | Runtime-output prefix. |
| [`LogLevel`](#loglevel) | safe integer or object/function with `GetInteger()` | `LogLevel.INFO` | Live minimum-level source. |
| `LogAreas` | safe integer or object/function with `GetInteger()` | `LogArea.CONSOLE` | Live area-mask source. |
| `FilePath` | `string \| null` | `null` | Absolute or log-root-relative file path. `.log` is appended when absent. |
| `LogRecordFormat` | `string \| null` | `null` | Record format; `null` selects the default. |
| `LogDateFormat` | `string \| null` | `null` | Timestamp format; `null` selects the default. |

### Writable properties and sources

| Member | Type | Behavior |
| --- | --- | --- |
| `ValueLogLevelSource` | safe integer or object/function with `GetInteger()` | Gets or sets the unresolved live level source. |
| `ValueLogAreasSource` | safe integer or object/function with `GetInteger()` | Gets or sets the unresolved live area source. |
| [`LogLevel`](#loglevel) | safe integer when read; integer/source when assigned | Stores the assigned source and resolves it on every read. |
| `LogAreas` | safe integer when read; integer/source when assigned | Stores the assigned source and resolves it on every read. |
| `FilePath` | writable `string \| null` | Normalizes extension and root on every write. |
| `LogRecordFormat` | writable `string \| null` | Stores the record format; `null` selects the default. |
| `LogDateFormat` | writable `string \| null` | Stores the timestamp format; `null` selects the default. |

Level/area sources are stored without eagerly resolving their integer values: invalid sources can fail on a later read or log call, not necessarily construction/assignment. File and format setters validate immediately. File-path normalization appends `.log` case-insensitively and roots relative paths at `LOG_ROOT`; it does not canonicalize `..` or provide a filesystem sandbox.

`UnloadLogManager()` validates and clears the child tree and returns `true`. It does not delete an existing log file, close the logger, or prevent later logging. Its cleanup can throw for a corrupted child tree.

### Live ConVar-backed threshold

A safe integer provides a fixed level or area mask. Any object or function with `GetInteger()` provides a live value. A native ConVar exposes the live `Value` property, so use an explicit adapter:

```js
const { RequireConVar } = require("cvars");
const { LogArea, LogLevel, LogManager } = require("loggers");

const g_DeveloperConVar = RequireConVar("developer");
const g_DeveloperLogLevelSource = { GetInteger: () => g_DeveloperConVar.Value };
const g_DiagnosticLogManager = new LogManager("diagnostics", { LogLevel: g_DeveloperLogLevelSource, LogAreas: LogArea.CONSOLE });
const g_vecDiagnosticErrors = [];
try {
	const nDeveloperThreshold = g_DeveloperConVar.Value;
	const bDiagnosticRecordLogged = g_DiagnosticLogManager.LogDebug("Developer threshold is %d.", nDeveloperThreshold);
	const bExpectedDiagnosticRecordLogged = LogLevel.DEBUG >= nDeveloperThreshold;
	if (bDiagnosticRecordLogged !== bExpectedDiagnosticRecordLogged) {
		throw new Error(`Debug routing disagrees with live threshold ${nDeveloperThreshold}.`);
	}
} catch (CaughtError) {
	g_vecDiagnosticErrors.push(CaughtError);
} finally {
	try {
		if (!g_DiagnosticLogManager.UnloadLogManager()) {
			throw new Error("Diagnostic logger cleanup failed.");
		}
	} catch (CaughtError) {
		g_vecDiagnosticErrors.push(CaughtError);
	}
}

if (g_vecDiagnosticErrors.length === 1) {
	throw g_vecDiagnosticErrors[0];
}

if (g_vecDiagnosticErrors.length > 1) {
	throw new AggregateError(g_vecDiagnosticErrors, "Diagnostic logging or cleanup failed.");
}
```

The logger calls `g_DeveloperLogLevelSource.GetInteger()` for each level check, so the adapter reads the current ConVar value instead of copying it. Keep adapters short and return a numeric safe integer, not `bigint`; the synchronous logger does not await promises.

### Reconfigure a manager safely

```js
const { DoesFileExist, RemoveFile } = require("filesystem");
const { GetGlobalVariables } = require("globals");
const { LogArea, LogLevel, LogManager } = require("loggers");

const g_GlobalVariables = GetGlobalVariables();
const g_RotatingLogManager = new LogManager("rounds");
const g_vecRotatingErrors = [];
let g_strRotatingFilePath = null;
let g_bOwnRotatingFile = false;
try {
	g_RotatingLogManager.LogLevel = LogLevel.WARNING;
	g_RotatingLogManager.LogAreas = LogArea.CONSOLE | LogArea.SCRIPT;
	g_RotatingLogManager.FilePath = "examples/rounds/current";
	g_RotatingLogManager.LogRecordFormat = "{Timestamp}|{LoggerName}|{LevelName}|{Message}";
	g_RotatingLogManager.LogDateFormat = "yyyy-MM-dd HH:mm:ss.SSS";
	g_strRotatingFilePath = g_RotatingLogManager.FilePath;
	if (DoesFileExist(g_strRotatingFilePath)) {
		throw new Error(`Refusing to append to existing file: ${g_strRotatingFilePath}.`);
	}

	g_bOwnRotatingFile = true;
	if (!g_RotatingLogManager.LogWarning("Map %s reached tick %d.", g_GlobalVariables.MapName, g_GlobalVariables.TickCount)) {
		throw new Error("Rotating warning was unexpectedly filtered.");
	}
} catch (CaughtError) {
	g_vecRotatingErrors.push(CaughtError);
} finally {
	try {
		if (!g_RotatingLogManager.UnloadLogManager()) {
			throw new Error("Rotating logger cleanup failed.");
		}
	} catch (CaughtError) {
		g_vecRotatingErrors.push(CaughtError);
	}

	try {
		if (g_bOwnRotatingFile && DoesFileExist(g_strRotatingFilePath) && !RemoveFile(g_strRotatingFilePath)) {
			throw new Error(`Failed to remove ${g_strRotatingFilePath}.`);
		}
	} catch (CaughtError) {
		g_vecRotatingErrors.push(CaughtError);
	}
}

if (g_vecRotatingErrors.length === 1) {
	throw g_vecRotatingErrors[0];
}

if (g_vecRotatingErrors.length > 1) {
	throw new AggregateError(g_vecRotatingErrors, "Rotating logging or cleanup failed.");
}
```

## `ROOT_LOGGER`

`ROOT_LOGGER` is a live `LogManager` named `sourcejs` with `LogLevel.DEBUG` and `LogArea.CONSOLE`. Formatted top-level helpers use this same object.

Temporary mutations must be restored because every plugin module in the same isolated context observes the same root object:

```js
const { LogArea, LogDebug, LogLevel, ROOT_LOGGER } = require("loggers");

const g_ValuePreviousLogLevelSource = ROOT_LOGGER.ValueLogLevelSource;
const g_ValuePreviousLogAreasSource = ROOT_LOGGER.ValueLogAreasSource;
const g_vecRootErrors = [];

try {
	ROOT_LOGGER.LogLevel = LogLevel.DEBUG;
	ROOT_LOGGER.LogAreas = LogArea.CONSOLE;
	if ((ROOT_LOGGER.LogLevel !== LogLevel.DEBUG) || (ROOT_LOGGER.LogAreas !== LogArea.CONSOLE) || !LogDebug("Temporary diagnostic mode enabled.")) {
		throw new Error("Temporary root logger configuration failed.");
	}
} catch (CaughtError) {
	g_vecRootErrors.push(CaughtError);
} finally {
	try {
		ROOT_LOGGER.LogLevel = g_ValuePreviousLogLevelSource;
		if (ROOT_LOGGER.ValueLogLevelSource !== g_ValuePreviousLogLevelSource) {
			throw new Error("Root logger level restoration failed.");
		}
	} catch (CaughtError) {
		g_vecRootErrors.push(CaughtError);
	}

	try {
		ROOT_LOGGER.LogAreas = g_ValuePreviousLogAreasSource;
		if (ROOT_LOGGER.ValueLogAreasSource !== g_ValuePreviousLogAreasSource) {
			throw new Error("Root logger area restoration failed.");
		}
	} catch (CaughtError) {
		g_vecRootErrors.push(CaughtError);
	}
}

if (g_vecRootErrors.length === 1) {
	throw g_vecRootErrors[0];
}

if (g_vecRootErrors.length > 1) {
	throw new AggregateError(g_vecRootErrors, "Root logging or restoration failed.");
}
```

Do not call `ROOT_LOGGER.UnloadLogManager()` from ordinary plugin code; it clears the shared child hierarchy for that plugin context.

## Formatting

Formatted calls support these tokens:

| Token | Conversion |
| --- | --- |
| `%s` | JavaScript string conversion. |
| `%d`, `%i` | Finite number truncated toward zero. |
| `%f` | Finite number without truncation. |
| `%j`, `%o`, `%O` | Strings remain unquoted; other values normally use `JSON.stringify()`, with the `Error` and `bigint` exceptions below. |
| `%%` | Literal percent sign without consuming an argument. |

Unmatched tokens remain in the text. Extra arguments use the same JSON-like conversion and are appended with spaces. For JSON-like tokens and extra arguments, an `Error` becomes its stack or message, and a primitive `bigint` becomes decimal text. If `JSON.stringify()` returns `undefined`, normal string conversion is used instead. Circular objects and objects containing `bigint` can raise a serialization error. `%s` instead applies normal JavaScript string conversion.

```js
const { GetAllPlayers } = require("filters/players");
const { GetGlobalVariables } = require("globals");
const { LogArea, LogLevel, LogManager } = require("loggers");

const g_vecCurrentPlayers = GetAllPlayers();
if (g_vecCurrentPlayers.length === 0) {
	throw new Error("Formatting example requires a connected player.");
}

const g_CurrentPlayer = g_vecCurrentPlayers[0];
const g_GlobalVariables = GetGlobalVariables();
const g_FormatLogManager = new LogManager("format", { LogLevel: LogLevel.DEBUG, LogAreas: LogArea.CONSOLE });
const g_vecFormatErrors = [];
try {
	if (!g_FormatLogManager.LogInfo("Player %s has %d health at %f ms frame time, state %j, progress 100%%.", g_CurrentPlayer.Name, g_CurrentPlayer.Health, g_GlobalVariables.AbsoluteFrameTime * 1000, { Dead: g_CurrentPlayer.Dead, FakeClient: g_CurrentPlayer.FakeClient })) {
		throw new Error("Format logger record was unexpectedly filtered.");
	}
} catch (CaughtError) {
	g_vecFormatErrors.push(CaughtError);
} finally {
	try {
		if (!g_FormatLogManager.UnloadLogManager()) {
			throw new Error("Format logger cleanup failed.");
		}
	} catch (CaughtError) {
		g_vecFormatErrors.push(CaughtError);
	}
}

if (g_vecFormatErrors.length === 1) {
	throw g_vecFormatErrors[0];
}

if (g_vecFormatErrors.length > 1) {
	throw new AggregateError(g_vecFormatErrors, "Formatting or cleanup failed.");
}
```

The default file record format is `{Timestamp} - {LoggerName}\t-\t{LevelName}\t{Message}`. Record formats accept `{Name}` and Python-style `%(Name)s` forms for `Timestamp`, `LoggerName`, `LevelName`, and `Message`. Token names are case-sensitive; lowercase and lower-camel spellings are not aliases. Only tokens in the format template are expanded: token-like text and `$` sequences inside a timestamp, logger name, level, or formatted message remain literal field data.

Date formats accept `yyyy`, `MM`, `dd`, `HH`, `mm`, `ss`, and `SSS`, plus `%Y`, `%m`, `%d`, `%H`, `%M`, and `%S`.

## File ownership

`LogArea.SCRIPT` writes through [`filesystem.SourceFile`](filesystem.md). Each record performs this lifecycle synchronously:

1. ensure the parent directory;
2. open the file in append-text mode;
3. write the UTF-8 record plus a final newline, require the returned count to equal the complete input byte count, and flush only after a complete write; retain any write or flush error;
4. independently attempt to close the handle;
5. report an operation error, close error, or both as an `AggregateError`.

A positive short write is an error, not success. Closing is still attempted, and a separate close failure is preserved alongside the write error. Already appended bytes are not rolled back. The byte-count check includes UTF-8 multibyte characters, embedded NUL characters, and the final newline; it measures the input to the filesystem API, not JavaScript UTF-16 code units or platform text-mode newline translation.

The runtime-output prefix is not included in the file record; the record uses the unprefixed formatted message. Relative paths are rooted at [`paths.LOG_ROOT`](paths.md). A `null` `FilePath` silently disables only the script-file destination.

An unfiltered call formats its record before either destination is invoked, even when file output is disabled. Native output runs before the file append: a thrown native call prevents the append, while a later file error cannot roll back a native record already emitted. Routing across destinations is not atomic, and `true` does not acknowledge delivery. Use example file paths only as caller-owned temporary files, never shared production logs.

```js
const { DoesFileExist, RemoveFile } = require("filesystem");
const { GetAllPlayers } = require("filters/players");
const { LogArea, LogLevel, LogManager } = require("loggers");
const { GetActiveWeapon } = require("players");
const { GetWeaponName } = require("weapons");

const g_vecCurrentPlayers = GetAllPlayers();
if (g_vecCurrentPlayers.length === 0) {
	throw new Error("Transaction logging example requires a connected player.");
}

const g_CurrentPlayer = g_vecCurrentPlayers[0];
const g_ActiveWeapon = GetActiveWeapon(g_CurrentPlayer);
const g_strWeaponName = (g_ActiveWeapon === null) ? "" : GetWeaponName(g_ActiveWeapon);
const g_strActiveWeaponName = (g_strWeaponName.length === 0) ? "none" : g_strWeaponName;
const g_TransactionLogManager = new LogManager("economy.transactions", { LogLevel: LogLevel.INFO, LogAreas: LogArea.SCRIPT, FilePath: "examples/economy/transactions.log", LogRecordFormat: "%(Timestamp)s|%(LevelName)s|%(Message)s", LogDateFormat: "%Y-%m-%d %H:%M:%S" });
const g_strTransactionFilePath = g_TransactionLogManager.FilePath;
const g_vecTransactionErrors = [];
let g_bOwnTransactionFile = false;

try {
	if (DoesFileExist(g_strTransactionFilePath)) {
		throw new Error(`Refusing to append to existing file: ${g_strTransactionFilePath}.`);
	}

	g_bOwnTransactionFile = true;
	if (!g_TransactionLogManager.LogInfo("Current weapon %s belongs to account %s.", g_strActiveWeaponName, g_CurrentPlayer.NetworkID)) {
		throw new Error("Transaction record was unexpectedly filtered.");
	}
} catch (CaughtError) {
	g_vecTransactionErrors.push(CaughtError);
} finally {
	try {
		if (!g_TransactionLogManager.UnloadLogManager()) {
			throw new Error("Transaction logger cleanup failed.");
		}
	} catch (CaughtError) {
		g_vecTransactionErrors.push(CaughtError);
	}

	try {
		if (g_bOwnTransactionFile && DoesFileExist(g_strTransactionFilePath) && !RemoveFile(g_strTransactionFilePath)) {
			throw new Error(`Failed to remove ${g_strTransactionFilePath}.`);
		}
	} catch (CaughtError) {
		g_vecTransactionErrors.push(CaughtError);
	}
}

if (g_vecTransactionErrors.length === 1) {
	throw g_vecTransactionErrors[0];
}

if (g_vecTransactionErrors.length > 1) {
	throw new AggregateError(g_vecTransactionErrors, "Transaction logging or cleanup failed.");
}
```

## Errors and common mistakes

- Do not instantiate `LogInstance` without a parent; use `LogManager` for roots.
- Do not pass string level names such as `"Info"`; pass `LogLevel.INFO`, another safe integer, or an object/function with `GetInteger()` returning one.
- Do not use `+` to combine areas; use bitwise `|` so intent remains clear.
- Do not expect `LogArea.MAIN` or `LogArea.SOURCEJS` to duplicate one record across separate native files; all three runtime-area bits feed the same native severity call.
- Do not pass numeric strings to `%d`, `%i`, or `%f`; numeric tokens require finite numbers.
- Do not omit `FilePath` when `LogArea.SCRIPT` output is required.
- Do not expect `UnloadLogManager()` to remove a log file; it clears child logger ownership only.
- Do not permanently mutate `ROOT_LOGGER` from a reusable module without restoring its state.
- Do not assign `Prefix` or other getter-only hierarchy members; configure a prefix at construction and change root routing through its documented setters.
- Do not mutate `ChildLoggers` into a cyclic/shared graph or insert non-logger values; hierarchy operations validate these cases and throw.
- Do not add a severity header to the message; the native sink owns its severity prefix. Context prefixes such as `[Inventory]` are separate.

## Related modules

- [`filesystem`](filesystem.md) owns the `SourceFile` handles used for script logs.
- [`paths`](paths.md) provides the live `LOG_ROOT` path.
- [`cvars`](cvars.md) provides native ConVar objects whose live `Value` can be exposed through an explicit `GetInteger()` source.
