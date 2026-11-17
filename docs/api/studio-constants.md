# `require("studio/constants")`

> Warning: this page is a complete reference for a small native module. Use the table of contents to locate a
> constant family or workflow without rereading the whole file.

`studio/constants` exposes the model-type values, studio-render flags, and invalid studio indexes compiled from the
selected HL2SDK branch. Use the module when code must interpret `model_t`, build model/render masks, or report the result
of a bone or attachment search without reproducing SDK numbers in JavaScript.

The package file is `packages/sourcejs/studio/constants.js`. It returns the plugin context's native
`sourcejs["studio/constants"]` object by identity. It does not connect to `IMDLCache`, acquire model references, or
provide compatibility aliases.

## Contents

- [Import](#import)
- [Exports](#exports)
- [Model Types](#model-types)
- [Studio Flags](#studio-flags)
- [Editing Header Flags](#editing-header-flags)
- [Invalid Indexes](#invalid-indexes)
- [Errors and Lifetime](#errors-and-lifetime)
- [Common Mistakes](#common-mistakes)
- [Related Modules](#related-modules)

## Import

Import only the constants needed by the current module:

```js
const {
	INVALID_ATTACHMENT_INDEX,
	INVALID_BONE_INDEX,
	ModelType,
	StudioFlags,
} = require("studio/constants");
```

All four exports, including both namespace objects, are created separately in every isolated plugin context as checked
own data properties. Namespace members are also own data properties; installation does not invoke inherited setters.
Treat them as constants even though ordinary JavaScript property reflection is available.

## Exports

| Export | Type | Result |
| --- | --- | --- |
| `INVALID_ATTACHMENT_INDEX` | `number` | `-1`, the no-match result for an attachment index. |
| `INVALID_BONE_INDEX` | `number` | `-1`, the no-match result for a bone index. |
| `ModelType` | `object` | Exact selected-SDK `modtype_t` values. |
| `StudioFlags` | `object` | Exact selected-SDK `STUDIO_*` values exposed by SourceJS. |

There is no generic lookup function, `default` export or fallback namespace. Missing SDK constants are absent properties.

## Model Types

`ModelType` has the same four members on every supported SDK:

| Member | Value | SDK value | Meaning |
| --- | ---: | --- | --- |
| `Bad` | `0` | `mod_bad` | Invalid, unknown or unresolved model. |
| `Brush` | `1` | `mod_brush` | BSP brush model. |
| `Sprite` | `2` | `mod_sprite` | Sprite model. |
| `Studio` | `3` | `mod_studio` | Studio `.mdl` model. |

Use the namespace when an extension, native call, or memory view supplies a model type. This classifier handles every
defined value and rejects an unexpected ABI value instead of silently treating it as `ModelType.Bad`:

```js
const { ModelType } = require("studio/constants");

function DescribeModelType(nModelType) {
	switch (nModelType) {
		case ModelType.Bad:
			return "bad";

		case ModelType.Brush:
			return "brush";

		case ModelType.Sprite:
			return "sprite";

		case ModelType.Studio:
			return "studio";

		default:
			throw new RangeError(`Unknown model type: ${nModelType}`);
	}
}
```

For example, `DescribeModelType(ModelType.Studio)` returns `"studio"`. Passing `27` throws because `27` is not a
selected-SDK model type.

## Studio Flags

`StudioFlags` maps the exposed `STUDIO_*` model/render macros to JavaScript Numbers. These are not the
`STUDIOHDR_FLAGS_*` metadata bits stored in `studiohdr_t.flags` and exposed as `Header.Flags`:

| Member | Value | SDK value | Availability |
| --- | ---: | --- | --- |
| `None` | `0x00000000` | `STUDIO_NONE` | Every supported SDK. |
| `Render` | `0x00000001` | `STUDIO_RENDER` | Every supported SDK. |
| `ViewTransformAttachments` | `0x00000002` | `STUDIO_VIEWXFORMATTACHMENTS` | Every supported SDK. |
| `DrawTranslucentSubmodels` | `0x00000004` | `STUDIO_DRAWTRANSLUCENTSUBMODELS` | Every supported SDK. |
| `TwoPass` | `0x00000008` | `STUDIO_TWOPASS` | Every supported SDK. |
| `StaticLighting` | `0x00000010` | `STUDIO_STATIC_LIGHTING` | Every supported SDK. |
| `Wireframe` | `0x00000020` | `STUDIO_WIREFRAME` | Every supported SDK. |
| `ItemBlink` | `0x00000040` | `STUDIO_ITEM_BLINK` | Every supported SDK. |
| `NoShadows` | `0x00000080` | `STUDIO_NOSHADOWS` | Every supported SDK. |
| `WireframePhysicsCollision` | `0x00000100` | `STUDIO_WIREFRAME_VCOLLIDE` | Absent from old-console SDK headers. |
| `ShadowDepthTexture` | `0x40000000` | `STUDIO_SHADOWDEPTHTEXTURE` | Absent from old-console SDK headers. |
| `Transparency` | `0x80000000` | `STUDIO_TRANSPARENCY` | Every supported SDK. |

JavaScript bitwise operators use signed 32-bit operands. Normalize a combined mask with `>>> 0` when the code must
preserve the unsigned Number representation of `Transparency` as `2147483648`:

```js
const { StudioFlags } = require("studio/constants");

const g_unMaximumStudioFlagMask = 0xFFFFFFFF;

function CreateStudioFlagSet(...vecFlags) {
	let unCombinedFlags = StudioFlags.None;
	for (const unFlag of vecFlags) {
		if (!Number.isInteger(unFlag) || (unFlag < 0) || (unFlag > g_unMaximumStudioFlagMask)) {
			throw new TypeError("Flags must be unsigned 32-bit integer masks.");
		}

		unCombinedFlags = (unCombinedFlags | unFlag) >>> 0;
	}

	return unCombinedFlags;
}

function HasStudioFlag(unFlags, unFlag) {
	if (!Number.isInteger(unFlags) || (unFlags < 0) || (unFlags > g_unMaximumStudioFlagMask) || !Number.isInteger(unFlag) || (unFlag < 0) || (unFlag > g_unMaximumStudioFlagMask)) {
		throw new TypeError("Flags must be unsigned 32-bit integer masks.");
	}

	return ((unFlags >>> 0) & (unFlag >>> 0)) !== 0;
}

function GetStudioFlagCapabilities() {
	return { HasShadowDepthTexture: Object.hasOwn(StudioFlags, "ShadowDepthTexture"), HasWireframePhysicsCollision: Object.hasOwn(StudioFlags, "WireframePhysicsCollision") };
}
```

`CreateStudioFlagSet(StudioFlags.Render, StudioFlags.Transparency)` returns `2147483649`. Test SDK-conditioned members
with `Object.hasOwn()` before reading or combining them; their absence is the actual old-console SDK contract.
Both mask helpers reject non-integer or out-of-range values rather than coercing an absent flag to zero.

## Editing Header Flags

`Header.Flags` is separate, signed 32-bit model metadata. Do not write `StudioFlags` values into it: for example,
`StudioFlags.Render` shares bit zero with `STUDIOHDR_FLAGS_AUTOGENERATED_HITBOX`, not a header rendering switch.
This module does not export header-flag constants. Obtain `STUDIOHDR_FLAGS_*` masks from an SDK-aware integration;
never translate a model/render flag into a header flag merely because their numbers match.

The helper below is only for integrations that establish that editing the selected header metadata bit is valid for that
cached model. Such edits change shared memory, not a draw-call option or the model file, and can violate SDK invariants.
`FindModelHandle(strModelPath)` acquires one reference. The helper validates a signed header mask, attempts to restore the
original metadata, and attempts release even when the callback or a setter throws. No unsigned `>>> 0` conversion belongs
in a `Header.Flags` write.

```js
const {
	INVALID_MODEL_HANDLE,
	FindModelHandle,
	Release,
	RequireModelHeader,
} = require("studio/cache");

const g_nMinimumHeaderFlagMask = -0x80000000;
const g_nMaximumHeaderFlagMask = 0x7FFFFFFF;

function WithTemporaryHeaderFlags(strModelPath, nAdditionalHeaderFlags, Callback) {
	if (typeof Callback !== "function") {
		throw new TypeError("Callback must be a function.");
	}

	if (!Number.isInteger(nAdditionalHeaderFlags) || (nAdditionalHeaderFlags < g_nMinimumHeaderFlagMask) || (nAdditionalHeaderFlags > g_nMaximumHeaderFlagMask)) {
		throw new TypeError("nAdditionalHeaderFlags must be a signed 32-bit header mask.");
	}

	const hModelHandle = FindModelHandle(strModelPath);
	if (hModelHandle === INVALID_MODEL_HANDLE) {
		throw new Error(`Model is unavailable: ${strModelPath}`);
	}

	let Header;
	let nOriginalFlags = 0;
	let bOriginalFlagsRead = false;
	let bOperationFailed = false;
	let OperationError;
	let Result;

	try {
		Header = RequireModelHeader(hModelHandle);
		nOriginalFlags = Header.Flags;
		bOriginalFlagsRead = true;
		Header.Flags = nOriginalFlags | nAdditionalHeaderFlags;
		Result = Callback(Header);
	} catch (CaughtError) {
		bOperationFailed = true;
		OperationError = CaughtError;
	}

	const vecCleanupErrors = [];
	let bFlagsRestoreOutcomeUnknown = false;
	if (bOriginalFlagsRead) {
		try {
			Header.Flags = nOriginalFlags;
		} catch (CleanupError) {
			bFlagsRestoreOutcomeUnknown = true;
			vecCleanupErrors.push(CleanupError);
		}
	}

	let bReleaseOutcomeUnknown = false;
	try {
		Release(hModelHandle);
	} catch (CleanupError) {
		bReleaseOutcomeUnknown = true;
		vecCleanupErrors.push(CleanupError);
	}

	if (vecCleanupErrors.length > 0) {
		const vecErrors = bOperationFailed ? [OperationError, ...vecCleanupErrors] : vecCleanupErrors;
		const Failure = new AggregateError(vecErrors, "Temporary header flag cleanup requires investigation.");
		Failure.ModelHandle = hModelHandle;
		Failure.FlagsRestoreOutcomeUnknown = bFlagsRestoreOutcomeUnknown;
		Failure.UnconfirmedReleaseCount = bReleaseOutcomeUnknown ? 1 : 0;
		throw Failure;
	}

	if (bOperationFailed) {
		throw OperationError;
	}

	return Result;
}
```

A caller with a valid SDK-specific header mask can inspect the temporary metadata with
`WithTemporaryHeaderFlags(strModelPath, nHeaderMask, Header => Header.Flags)`. The returned signed Number is safe to
retain, but it is not a `StudioFlags` mask. The borrowed `Header` object is invalid after the cache reference is released.
The callback must finish synchronously, retain no borrowed views, and neither release nor transfer the handle.

On cleanup failure the workflow reports `AggregateError.errors` in operation/restore/release order, plus `ModelHandle`,
`FlagsRestoreOutcomeUnknown` and `UnconfirmedReleaseCount`. It preserves falsy thrown values. A failed setter or release
may already have mutated native state: these fields describe unknown outcomes, not permission to retry against possibly
freed storage. When cleanup succeeds, the original operation exception or callback result is preserved exactly.

## Invalid Indexes

Both exported studio sentinels use `-1`, matching the conventional no-match result of a JavaScript index search. The
constants make the expected domain explicit and prevent a negative index from reaching native methods that require a
valid range.

This workflow acquires one model reference, searches live bone and attachment views, returns only owning JavaScript
values, and releases the reference:

```js
const {
	INVALID_ATTACHMENT_INDEX,
	INVALID_BONE_INDEX,
} = require("studio/constants");
const {
	INVALID_MODEL_HANDLE,
	FindModelHandle,
	Release,
	RequireModelHeader,
} = require("studio/cache");

function InspectStudioIndexes(strModelPath, strAttachmentName) {
	const hModelHandle = FindModelHandle(strModelPath);
	if (hModelHandle === INVALID_MODEL_HANDLE) {
		throw new Error(`Model is unavailable: ${strModelPath}`);
	}

	let bOperationFailed = false;
	let OperationError;
	let Result;

	try {
		const Header = RequireModelHeader(hModelHandle);
		const vecBones = Header.Bones();
		let nRootBoneIndex = INVALID_BONE_INDEX;
		for (let unBoneIndex = 0; unBoneIndex < vecBones.length; unBoneIndex += 1) {
			if (vecBones[unBoneIndex].Parent === INVALID_BONE_INDEX) {
				nRootBoneIndex = unBoneIndex;
				break;
			}
		}

		const vecAttachments = Header.Attachments();
		let nAttachmentIndex = INVALID_ATTACHMENT_INDEX;
		for (let unAttachmentIndex = 0; unAttachmentIndex < vecAttachments.length; unAttachmentIndex += 1) {
			if (vecAttachments[unAttachmentIndex].Name === strAttachmentName) {
				nAttachmentIndex = unAttachmentIndex;
				break;
			}
		}

		Result = { HasAttachment: nAttachmentIndex !== INVALID_ATTACHMENT_INDEX, HasRootBone: nRootBoneIndex !== INVALID_BONE_INDEX, AttachmentIndex: nAttachmentIndex, RootBoneIndex: nRootBoneIndex };
	} catch (CaughtError) {
		bOperationFailed = true;
		OperationError = CaughtError;
	}

	try {
		Release(hModelHandle);
	} catch (CleanupError) {
		const vecErrors = bOperationFailed ? [OperationError, CleanupError] : [CleanupError];
		const Failure = new AggregateError(vecErrors, "Studio index cleanup requires investigation.");
		Failure.ModelHandle = hModelHandle;
		Failure.UnconfirmedReleaseCount = 1;
		throw Failure;
	}

	if (bOperationFailed) {
		throw OperationError;
	}

	return Result;
}
```

For a model with a root bone at index `0` and an `eyes` attachment at index `0`,
`InspectStudioIndexes(strModelPath, "eyes")` returns both indexes and sets both presence fields to `true`. A missing
attachment returns `INVALID_ATTACHMENT_INDEX` and `HasAttachment: false`.
The result contains no native views. Operation and release failures use the same error-preservation and unknown-release
contract as the temporary-flags workflow; no failed release is automatically replayed.

## Errors and Lifetime

- Requiring the module without the SourceJS native runtime throws; there is no JavaScript fallback.
- Native constant installation checks property creation and preserves an existing V8 exception or termination. Native
  C++ exceptions are translated at the installation boundary; a failed installation is not reported as successful.
- An unknown `ModelType` value should be handled explicitly or rejected, as in `DescribeModelType()`.
- Reading an SDK-conditioned old-console flag without a capability check produces `undefined`; combining that value
  without validation would hide an SDK mismatch.
- `FindModelHandle(strModelPath)` can return `INVALID_MODEL_HANDLE`; do not call `Release(hModelHandle)` for that sentinel.
- `RequireModelHeader()` can throw after a valid handle was acquired. Release the handle on that path.
- A model header, bone or attachment is a borrowed live native view. Do not retain it after releasing the owning cache reference.
- Writing `Header.Flags` changes shared cached model memory immediately. Restore temporary edits before releasing the reference.
- `Header.Flags` is signed int32 header metadata from the separate `STUDIOHDR_FLAGS_*` family. Do not write
  `StudioFlags.Transparency`, `StudioFlags.Render` or another model/render mask into it.
- Cache workflows are synchronous game-thread operations requiring a live SDK cache. A reference does not protect views
  against explicit cache invalidation, model reload or map transitions; discard them before those events and plugin unload.
- Do not blindly replay failed cleanup: a native write or release may already have taken effect. Preserve all errors and
  investigate unknown outcomes without probing a potentially freed handle.

## Common Mistakes

- Do not copy numeric `STUDIO_*` or `modtype_t` values into plugin source.
- Do not use `if (StudioFlags.ShadowDepthTexture)` as a capability test. Use `Object.hasOwn()` so a valid zero-valued
  constant is not confused with absence.
- Do not compare a `Transparency` mask to a signed bitwise intermediate without normalizing with `>>> 0`.
- Do not confuse `STUDIO_*` model/render flags with `STUDIOHDR_FLAGS_*` header metadata; equal bit values do not make them interchangeable.
- Do not pass either `-1` sentinel to `GetBone()`, `GetAttachment()` or another range-checked native accessor.
- Do not mutate the namespace objects. They are the plugin context's shared constant registry, not plugin configuration.

## Related Modules

- [`studio`](studio.md) documents complete live model, header, bone, hitbox, sequence and attachment records.
- [`studio/cache`](studio-cache.md) documents model handles, reference ownership and live header lookup.
