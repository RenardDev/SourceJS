# `require("core/logger")`

> This page is maintained by hand. The module is the exact native logging object.

`core/logger` forwards messages to the native SourceJS logging functions with the selected severity. It exposes no logger
construction, file-target configuration, or severity-filter configuration; use `loggers` for higher-level logging APIs.

Native records start with `[SourceJS] [INFO]`, `[SourceJS] [WARNING]`, or `[SourceJS] [ERROR]`. The same prefix reaches the engine, client-console, or fallback output sink; callers pass only the message.

## Location and purpose

The JavaScript wrapper lives in [`packages/sourcejs/core/logger.js`](../../packages/sourcejs/core/logger.js) and resolves the native
object registered in [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp). Use this module
for direct native logging when a higher-level named logger, file target, or filter is unnecessary.

## Import

```js
const { LogError, LogInfo, LogWarning } = require("core/logger");
```

## Exports

| Export | Kind | Signature / behavior |
| --- | --- | --- |
| [`LogInfo`](#loginfo) | Function | `LogInfo(Message?)`; converts the supplied value to UTF-8 text; no argument produces an empty message. |
| [`LogWarning`](#logwarning) | Function | `LogWarning(Message?)`; converts the supplied value to UTF-8 text; no argument produces an empty message. |
| [`LogError`](#logerror) | Function | `LogError(Message?)`; converts the supplied value to UTF-8 text; no argument produces an empty message. |

## Examples

### `LogError`

```js
const { LogError } = require("core/logger");

try {
	JSON.parse("{invalid plugin state}");
} catch (ParseError) {
	LogError(`Unable to parse demonstration plugin state: ${ParseError.message}`);
}
```

### `LogInfo`

```js
const { GetGlobalInfo } = require("core");
const { LogInfo } = require("core/logger");

const g_RuntimeInformation = GetGlobalInfo();
LogInfo(`Logging example on ${g_RuntimeInformation.SourceEngineBranch} with SourceJS ${g_RuntimeInformation.Version}.`);
```

### `LogWarning`

```js
const { LogWarning } = require("core/logger");
const { DoesConVarExist } = require("cvars");

if (!DoesConVarExist("sv_alltalk")) {
	LogWarning("sv_alltalk is not currently registered; this example does not change voice policy.");
}
```

## Safe use

- Each function converts only its first argument to text and forwards it to the native logger at the selected severity. Normal
  completion returns `undefined`, not a delivery or persistence status; additional arguments are ignored.
- Pass an already constructed string. Object conversion can execute user code and throw; the binding does not provide a
  transactional failure contract. Embedded NUL characters are rejected with an exception before the native logger is called.
- Omitting the message writes an empty string. Pass an explicit, contextual message instead of relying on that fallback.
- Do not log secrets, authentication material, or unbounded user-controlled text. Direct native logging has no per-caller
  severity filter or rate limit.
- Use `loggers` when code needs named logger instances, configurable outputs, or higher-level filtering.

## Related files

- [`packages/sourcejs/core/logger.js`](../../packages/sourcejs/core/logger.js) — JavaScript wrapper around the native module.
- [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp) — native callback bindings and module
  registration.
- [`loggers.md`](loggers.md) — higher-level logger instances and output configuration.
