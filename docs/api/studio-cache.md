# `require("studio/cache")`

> Warning: successful model lookups acquire native `IMDLCache` references. Balance each confirmed reference, treat a failed
> release as an unknown native outcome, and discard borrowed headers before attempting release.

`studio/cache` is the cache-only native module for model handles, reference counts and live `studiohdr_t` retrieval. It
omits the model/flag constants from `studio/constants` while returning the exact object installed at
`sourcejs["studio/cache"]`.

The package does not wrap callbacks, copy namespaces, add aliases or install fallback functions.

## Contents

- [Import](#import)
- [SDK Capabilities](#sdk-capabilities)
- [Exports](#exports)
- [Cache Data Types](#cache-data-types)
- [Model Records](#model-records)
- [Model Headers](#model-headers)
- [Additional References](#additional-references)
- [Errors And Lifetime](#errors-and-lifetime)
- [Related Modules](#related-modules)

## Import

```js
const {
	INVALID_MODEL_HANDLE,
	ModelCacheDataType,
	AddReference,
	FindModel,
	FindModelHandle,
	GetModelHeader,
	GetModelHeaderAddress,
	GetModelName,
	GetReferenceCount,
	Release,
	RequireModelHeader,
} = require("studio/cache");
```

## SDK Capabilities

On SDK branches built with `SOURCEJS_OLD_CONSOLE_API`, root `GetReferenceCount`, model-record `GetReferenceCount()` and
`ModelCacheDataType.DecodedAnimationBlock` are absent. Use `Object.hasOwn` for SDK-conditioned members; SourceJS does not
emulate APIs missing from the selected SDK.

Requiring this submodule returns the installed native object by identity and does not load the root `studio` package.

## Exports

| Export | Result |
| --- | --- |
| `INVALID_MODEL_HANDLE` | Selected SDK's numeric `MDLHANDLE_INVALID`. |
| `ModelCacheDataType` | Available native `MDLCacheDataType_t` values. |
| `FindModel(strModelPath)` | Calls `IMDLCache::FindMDL` and returns a model record. |
| `FindModelHandle(strModelPath)` | Calls `IMDLCache::FindMDL` and returns its handle. |
| `AddReference(hModelHandle)` | Adds one native reference and returns the native count/result. |
| `Release(hModelHandle)` | Releases one native reference and returns the native count/result. |
| `GetReferenceCount(hModelHandle)` | SDK-conditioned current native reference count. |
| `GetModelName(hModelHandle)` | Current cache model name. |
| `GetModelHeaderAddress(hModelHandle)` | Exact `studiohdr_t` address as `bigint`, or `0n`. |
| `GetModelHeader(hModelHandle)` | Live borrowed header or `null`. |
| `RequireModelHeader(hModelHandle)` | Live borrowed header or an error. |

## Cache Data Types

`ModelCacheDataType` always contains:

- `StudioHeader`;
- `StudioHardwareData`;
- `PhysicsCollision`;
- `AnimationBlock`;
- `VirtualModel`;
- `Vertices`.

`DecodedAnimationBlock` is SDK-conditioned. These values are useful when an extension forwards `IMDLCacheNotify` data types:

```js
const { ModelCacheDataType } = require("studio/cache");

function CreateCacheDataTypeClassifier() {
	const setInvalidatingTypes = new Set([
		ModelCacheDataType.StudioHeader,
		ModelCacheDataType.PhysicsCollision,
	]);

	return {
		HasDecodedAnimationBlock: Object.hasOwn(ModelCacheDataType, "DecodedAnimationBlock"),
		ShouldDiscardBorrowedViews(nDataType) {
			return setInvalidatingTypes.has(nDataType);
		},
	};
}

module.exports = { CreateCacheDataTypeClassifier };
```

## Model Records

`FindModel(strModelPath)` returns a record with `Handle`, `IsValid()` and `GetName()`. SDKs with native reference counting also
expose `GetReferenceCount()`. A successful lookup transfers one native reference to the caller; the JavaScript record does
not release it automatically. An invalid record has
`Handle === INVALID_MODEL_HANDLE`, returns `false` from `IsValid()` and owns no valid reference.

```js
const {
	INVALID_MODEL_HANDLE,
	FindModel,
	Release,
} = require("studio/cache");

function CreateCachedModel(strModelPath) {
	const Model = FindModel(strModelPath);
	const hModelHandle = Model.Handle;
	if (hModelHandle === INVALID_MODEL_HANDLE) {
		throw new Error(`Model is unavailable: ${strModelPath}`);
	}

	let bDisposed = false;

	try {
		if (!Model.IsValid()) {
			throw new Error(`Model is unavailable: ${strModelPath}`);
		}

		return {
			Handle: hModelHandle,
			Inspect() {
				if (bDisposed) {
					throw new Error("Cached model is disposed");
				}

				const Inspection = { Name: Model.GetName(), Valid: Model.IsValid() };
				if (Object.hasOwn(Model, "GetReferenceCount")) {
					Inspection.ReferenceCount = Model.GetReferenceCount();
				}

				return Inspection;
			},
			Dispose() {
				if (bDisposed) {
					return false;
				}

				bDisposed = true;
				try {
					Release(hModelHandle);
				} catch (CleanupError) {
					const Failure = new AggregateError([CleanupError], "Model release outcome is unknown.");
					Failure.ModelHandle = hModelHandle;
					Failure.UnconfirmedReleaseCount = 1;
					throw Failure;
				}

				return true;
			},
		};
	} catch (OperationError) {
		try {
			Release(hModelHandle);
		} catch (CleanupError) {
			const Failure = new AggregateError([OperationError, CleanupError], "Model setup and release failed.");
			Failure.ModelHandle = hModelHandle;
			Failure.UnconfirmedReleaseCount = 1;
			throw Failure;
		}

		throw OperationError;
	}
}

module.exports = { CreateCachedModel };
```

The native record's `Handle` is an ordinary writable own data property, not a reference owner or generation token. Keep it
unchanged and capture the acquired handle for cleanup; copying a record acquires nothing. Its methods read their receiver's
current `Handle`; `IsValid()` checks only the selected-SDK range and invalid sentinel while the cache is available, not ownership.
Discard the model record before `Dispose()`: its methods do not own an independent reference. The controller above disarms before attempting release so
reentrant inspection and repeat disposal cannot access or release potentially freed storage.

## Model Headers

`FindModelHandle(strModelPath)` also acquires one reference. `GetModelHeader(hModelHandle)` returns `null` when a valid handle has no loaded
header; `RequireModelHeader()` throws. `GetModelHeaderAddress()` returns the same borrowed `studiohdr_t` address as a
`bigint` or `0n` when absent.

```js
const {
	INVALID_MODEL_HANDLE,
	FindModelHandle,
	GetModelHeader,
	GetModelHeaderAddress,
	GetModelName,
	Release,
	RequireModelHeader,
} = require("studio/cache");

function CreateCachedModelHeader(strModelPath) {
	const hModelHandle = FindModelHandle(strModelPath);
	if (hModelHandle === INVALID_MODEL_HANDLE) {
		throw new Error(`Model is unavailable: ${strModelPath}`);
	}

	let Header;
	let NullableHeader;
	let unHeaderAddress;

	try {
		NullableHeader = GetModelHeader(hModelHandle);
		unHeaderAddress = GetModelHeaderAddress(hModelHandle);
		if ((NullableHeader === null) || (unHeaderAddress === 0n)) {
			throw new Error(`Model header is not loaded: ${strModelPath}`);
		}

		Header = RequireModelHeader(hModelHandle);
	} catch (OperationError) {
		try {
			Release(hModelHandle);
		} catch (CleanupError) {
			const Failure = new AggregateError([OperationError, CleanupError], "Model header setup and release failed.");
			Failure.ModelHandle = hModelHandle;
			Failure.UnconfirmedReleaseCount = 1;
			throw Failure;
		}

		throw OperationError;
	}

	let bDisposed = false;

	return {
		Header,
		Inspect() {
			if (bDisposed) {
				throw new Error("Cached model header is disposed");
			}

			return {
				Address: unHeaderAddress,
				NullableHeaderAddress: NullableHeader.Address,
				RequiredAddress: Header.Address,
				ModelName: GetModelName(hModelHandle),
				Name: Header.Name,
			};
		},
		Dispose() {
			if (bDisposed) {
				return false;
			}

			bDisposed = true;
			try {
				Release(hModelHandle);
			} catch (CleanupError) {
				const Failure = new AggregateError([CleanupError], "Model header release outcome is unknown.");
				Failure.ModelHandle = hModelHandle;
				Failure.UnconfirmedReleaseCount = 1;
				throw Failure;
			}

			return true;
		},
	};
}

module.exports = { CreateCachedModelHeader };
```

The full header, bone, hitbox, sequence and attachment shape is documented in [`studio`](studio.md). Call `Dispose()`
only after all objects derived from `Header` have been discarded.

## Additional References

Use `AddReference()` only when a component must retain a valid handle independently. The callback below runs while both
confirmed references are held, then attempts their cleanup even when the callback or another cleanup throws:

This workflow requires an SDK that exports `GetReferenceCount`.

`Callback` is invoked synchronously. Its result, including a Promise or thenable, is forwarded unchanged rather than awaited
or inspected. Cleanup of the confirmed references is attempted before the helper returns; asynchronous work must not retain
the borrowed handle or derived headers beyond that callback invocation.

```js
const {
	INVALID_MODEL_HANDLE,
	AddReference,
	FindModelHandle,
	GetReferenceCount,
	Release,
} = require("studio/cache");

function WithAddedCacheReference(strModelPath, Callback) {
	if (typeof Callback !== "function") {
		throw new TypeError("Callback must be a function.");
	}

	if (typeof GetReferenceCount !== "function") {
		throw new Error("WithAddedCacheReference() requires GetReferenceCount support.");
	}

	const hModelHandle = FindModelHandle(strModelPath);
	if (hModelHandle === INVALID_MODEL_HANDLE) {
		throw new Error(`Model is unavailable: ${strModelPath}`);
	}

	let bAddedReference = false;
	let bAddReferenceOutcomeUnknown = false;
	let bOperationFailed = false;
	let OperationError;
	let Result;

	try {
		bAddReferenceOutcomeUnknown = true;
		const nCountAfterAdd = AddReference(hModelHandle);
		bAddReferenceOutcomeUnknown = false;
		bAddedReference = true;
		Result = Callback({ CountAfterAdd: nCountAfterAdd, CurrentReferenceCount: GetReferenceCount(hModelHandle), Handle: hModelHandle });
	} catch (CaughtError) {
		bOperationFailed = true;
		OperationError = CaughtError;
	}

	const vecCleanupErrors = [];
	const unReleaseCount = bAddedReference ? 2 : 1;
	for (let unReferenceIndex = 0; unReferenceIndex < unReleaseCount; unReferenceIndex += 1) {
		try {
			Release(hModelHandle);
		} catch (CleanupError) {
			vecCleanupErrors.push(CleanupError);
		}
	}

	if ((vecCleanupErrors.length > 0) || bAddReferenceOutcomeUnknown) {
		const vecErrors = bOperationFailed ? [OperationError, ...vecCleanupErrors] : vecCleanupErrors;
		const Failure = new AggregateError(vecErrors, "Cache reference outcome requires investigation.");
		Failure.ModelHandle = hModelHandle;
		Failure.UnconfirmedReleaseCount = vecCleanupErrors.length;
		Failure.AddReferenceOutcomeUnknown = bAddReferenceOutcomeUnknown;
		throw Failure;
	}

	if (bOperationFailed) {
		throw OperationError;
	}

	return Result;
}

module.exports = { WithAddedCacheReference };
```

The callback must not release or transfer the borrowed handle. Once `AddReference()` returns, two cleanup attempts balance
the added and lookup references. If it throws, only the lookup reference is confirmed, so the workflow attempts one release
and reports `AddReferenceOutcomeUnknown`; the native add might already have changed the reference count.

These examples preserve original operation exceptions after successful, confirmed cleanup. Cleanup or ambiguous-add failures
produce `AggregateError.errors` in operation/cleanup order, including falsy thrown values, plus `ModelHandle`,
`UnconfirmedReleaseCount` and, for the added-reference workflow, `AddReferenceOutcomeUnknown`. A release exception does not
prove the reference remains held: the SDK may have mutated before failure. Use this metadata for SDK/lifecycle-aware investigation,
not an automatic retry count. Controllers reject further inspection/disposal after a release attempt; they do not guarantee
successful release on a native failure. Previously exposed borrowed headers must also be discarded by the caller.

## Errors And Lifetime

- Model paths must be non-empty strings without embedded NUL bytes; validation precedes the native lookup.
- Handles must be unsigned integers in the selected SDK's `MDLHandle_t` range and must not equal
  `INVALID_MODEL_HANDLE`.
- `GetModelName()` throws when `IMDLCache` returns no name.
- `GetModelHeader()` returns `null`, `GetModelHeaderAddress()` returns `0n`, and `RequireModelHeader()` throws when no
  header is loaded.
- Release once for every valid handle returned by `FindModel()` or `FindModelHandle()` and once for every successful
  `AddReference()`.
- Never retain model records, headers or addresses across cache invalidation, model reload, map transition or plugin
  unload.
- Native addresses are returned as exact JavaScript `BigInt` values. They identify borrowed native memory and are never
  strings or JavaScript-owned allocations.
- Treat every returned `Address` as read-only identity metadata. Do not assign or forge it; use only records returned
  by this module while the matching cache reference remains valid.

Cache calls are synchronous game-thread operations and require a live SDK cache. A reference does not make borrowed headers
safe across explicit cache invalidation or map transitions; `IsValid()` does not detect stale ownership or cache generations.
Do not blindly retry `AddReference()` or `Release()` after an exception or use a possibly freed handle to probe the outcome.

Cache callbacks preserve pending V8 exceptions and translate C++ exceptions at the JavaScript boundary. Lookup references
transfer to the caller only after publishing the result. If publication fails, a noncopyable owner attempts one native
`Release`; cleanup exceptions are logged without replacing the original failure. This does not roll back unrelated native
side effects or validate SDK storage lifetimes. Cache exports and data-type constants are checked own properties; they do
not invoke inherited setters, and initialization stops on a failed installation.

[`smoke_studio_cache_reference_contracts.js`](../../tools/smoke_studio_cache_reference_contracts.js) compiles the actual
reference owner against a fake SDK cache on 32- and 64-bit targets and rejects compiled cleanup regressions. It does not
exercise live V8 or an engine cache.

## Related Modules

- [`studio`](studio.md) combines this cache API with constants and full nested-record documentation.
- [`studio/constants`](studio-constants.md) exposes only model types, studio flags and index sentinels.
