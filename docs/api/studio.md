# `require("studio")`

> Warning: `studio` exposes borrowed, writable Source SDK model-cache memory. Keep the matching `IMDLCache` reference
> alive, restore temporary edits, and never retain a returned record across cache invalidation or a map transition.

`studio` is the direct native module for `MDLHandle_t`, `IMDLCache` reference ownership, and live `studiohdr_t` records.
Every native `Address` is returned as an exact JavaScript `bigint`, and writable accessors update the selected SDK's memory immediately.

The package exports the installed native object by identity. It provides no aliases, copied functions or fallback implementation.

## Contents

- [Import](#import)
- [SDK Capabilities](#sdk-capabilities)
- [Exports](#exports)
- [Constant Namespaces](#constant-namespaces)
- [Handles And Reference Ownership](#handles-and-reference-ownership)
- [Model Records](#model-records)
- [Model Headers](#model-headers)
- [Live Native Views](#live-native-views)
- [Bones](#bones)
- [Bone Controllers](#bone-controllers)
- [Hitbox Sets And Hitboxes](#hitbox-sets-and-hitboxes)
- [Local Sequences](#local-sequences)
- [Attachments](#attachments)
- [Errors And Safety](#errors-and-safety)
- [Related Modules](#related-modules)

## Import

```js
const {
	INVALID_ATTACHMENT_INDEX,
	INVALID_BONE_INDEX,
	INVALID_MODEL_HANDLE,
	ModelCacheDataType,
	ModelType,
	StudioFlags,
	AddReference,
	FindModel,
	FindModelHandle,
	GetModelHeader,
	GetModelHeaderAddress,
	GetModelName,
	GetReferenceCount,
	Release,
	RequireModelHeader,
} = require("studio");
```

## SDK Capabilities

SourceJS compiles the surface directly from the selected SDK. On branches built with
`SOURCEJS_OLD_CONSOLE_API`, these members are absent:

- root `GetReferenceCount(hModelHandle)`;
- model-record `GetReferenceCount()`;
- `ModelCacheDataType.DecodedAnimationBlock`;
- `StudioFlags.WireframePhysicsCollision`;
- `StudioFlags.ShadowDepthTexture`.

`SurfacePropertyLookup` is present on a bone only when the selected SDK's `mstudiobone_t` declares `surfacepropLookup`.
Test SDK-conditioned members with `typeof` or `Object.hasOwn()`; SourceJS does not synthesize unavailable SDK APIs.

## Exports

| Export | Result |
| --- | --- |
| `INVALID_MODEL_HANDLE` | Selected SDK's numeric `MDLHANDLE_INVALID`. |
| `INVALID_BONE_INDEX` | Application lookup sentinel, `-1`. |
| `INVALID_ATTACHMENT_INDEX` | Application lookup sentinel, `-1`. |
| [`ModelCacheDataType`](#modelcachedatatype) | Available native `MDLCacheDataType_t` values. |
| [`ModelType`](#modeltype) | Native `modtype_t` values. |
| [`StudioFlags`](#studioflags) | Exposed native `STUDIO_*` numeric subset documented below. |
| `FindModel(strModelPath)` | Requires a non-empty string without embedded NUL bytes, calls `IMDLCache::FindMDL`, and returns a fresh model object wrapping the resulting handle. A non-invalid handle owns one cache reference. |
| `FindModelHandle(strModelPath)` | Requires a non-empty string without embedded NUL bytes, calls `IMDLCache::FindMDL`, and returns the resulting numeric handle. A non-invalid handle owns one cache reference. |
| `AddReference(hModelHandle)` | Requires a Uint32 that fits `MDLHandle_t` and is not `INVALID_MODEL_HANDLE`, adds one cache reference, and returns the native signed reference count. |
| `Release(hModelHandle)` | Requires a Uint32 that fits `MDLHandle_t` and is not `INVALID_MODEL_HANDLE`, releases one cache reference, and returns the native signed reference count. |
| `GetReferenceCount(hModelHandle)` | Outside `SOURCEJS_OLD_CONSOLE_API` builds, requires a Uint32 that fits `MDLHandle_t` and is not `INVALID_MODEL_HANDLE`, then returns `IMDLCache::GetRef` as a signed count without changing ownership. |
| `GetModelName(hModelHandle)` | Requires a Uint32 that fits `MDLHandle_t` and is not `INVALID_MODEL_HANDLE`, then copies the current cache-owned model name into a JavaScript string. It throws when the cache returns no name. |
| `GetModelHeaderAddress(hModelHandle)` | Requires a Uint32 that fits `MDLHandle_t` and is not `INVALID_MODEL_HANDLE`, then returns the cache-owned `studiohdr_t` address as a borrowed `bigint` or `0n`. It does not extend the header lifetime. |
| `GetModelHeader(hModelHandle)` | Requires a Uint32 that fits `MDLHandle_t` and is not `INVALID_MODEL_HANDLE`; returns `null` when the cache has no header, otherwise a fresh non-owning live header view. A misaligned non-null header is rejected. |
| `RequireModelHeader(hModelHandle)` | Requires a Uint32 that fits `MDLHandle_t` and is not `INVALID_MODEL_HANDLE`, then returns a fresh non-owning live header view. It throws when the cache has no header, and rejects a misaligned non-null header. |

## Constant Namespaces

`ModelType`, `StudioFlags`, and the invalid bone/attachment indexes use the same checked own-data-property
installation as `studio/constants`; their namespace members are own properties too. Failed property creation or
native C++ exceptions stop installation. Existing V8 exceptions and termination are preserved rather than replaced.

### `ModelCacheDataType`

| Member | Native enum value |
| --- | --- |
| `StudioHeader` | Numeric `MDLCACHE_STUDIOHDR` (`0`). |
| `StudioHardwareData` | Numeric `MDLCACHE_STUDIOHWDATA` (`1`). |
| `PhysicsCollision` | Numeric `MDLCACHE_VCOLLIDE` (`2`). |
| `AnimationBlock` | Numeric `MDLCACHE_ANIMBLOCK` (`3`). |
| `VirtualModel` | Numeric `MDLCACHE_VIRTUALMODEL` (`4`). |
| `Vertices` | Numeric `MDLCACHE_VERTEXES` (`5`). |
| `DecodedAnimationBlock` | Numeric `MDLCACHE_DECODEDANIMBLOCK` (`6`); omitted when `SOURCEJS_OLD_CONSOLE_API` is defined. |

### `ModelType`

| Member | Native enum value |
| --- | --- |
| `Bad` | Numeric `mod_bad` (`0`). |
| `Brush` | Numeric `mod_brush` (`1`). |
| `Sprite` | Numeric `mod_sprite` (`2`). |
| `Studio` | Numeric `mod_studio` (`3`). |

### `StudioFlags`

| Member | Native numeric value | Availability |
| --- | --- | --- |
| `None` | `STUDIO_NONE` (`0x00000000`) | Always. |
| `Render` | `STUDIO_RENDER` (`0x00000001`) | Always. |
| `ViewTransformAttachments` | `STUDIO_VIEWXFORMATTACHMENTS` (`0x00000002`) | Always. |
| `DrawTranslucentSubmodels` | `STUDIO_DRAWTRANSLUCENTSUBMODELS` (`0x00000004`) | Always. |
| `TwoPass` | `STUDIO_TWOPASS` (`0x00000008`) | Always. |
| `StaticLighting` | `STUDIO_STATIC_LIGHTING` (`0x00000010`) | Always. |
| `Wireframe` | `STUDIO_WIREFRAME` (`0x00000020`) | Always. |
| `ItemBlink` | `STUDIO_ITEM_BLINK` (`0x00000040`) | Always. |
| `NoShadows` | `STUDIO_NOSHADOWS` (`0x00000080`) | Always. |
| `WireframePhysicsCollision` | `STUDIO_WIREFRAME_VCOLLIDE` (`0x00000100`) | Omitted when `SOURCEJS_OLD_CONSOLE_API` is defined. |
| `Transparency` | `STUDIO_TRANSPARENCY` (`0x80000000`) | Always. |
| `ShadowDepthTexture` | `STUDIO_SHADOWDEPTHTEXTURE` (`0x40000000`) | Omitted when `SOURCEJS_OLD_CONSOLE_API` is defined. |

These JavaScript Number values are model/render masks (`STUDIO_*`), not the `STUDIOHDR_FLAGS_*` metadata used by
`Header.Flags`. The example below accepts signed 32-bit render masks; a bitwise operation converts an unsigned high-bit
constant to that signed representation. Pass its result only to an API documented to accept model/render flags, never
to `Header.Flags` merely because that accessor also stores a signed 32-bit value.

```js
const {
	ModelCacheDataType,
	ModelType,
	StudioFlags,
} = require("studio");

const g_nMinimumStudioFlagMask = -0x80000000;
const g_nMaximumStudioFlagMask = 0x7FFFFFFF;

function CreateStudioClassifier() {
	const setWatchedCacheTypes = new Set([
		ModelCacheDataType.StudioHeader,
		ModelCacheDataType.PhysicsCollision,
	]);

	return {
		Capabilities: {
			HasDecodedAnimationBlock: Object.hasOwn(ModelCacheDataType, "DecodedAnimationBlock"),
			HasShadowDepthTexture: Object.hasOwn(StudioFlags, "ShadowDepthTexture"),
			HasWireframePhysicsCollision: Object.hasOwn(StudioFlags, "WireframePhysicsCollision"),
		},
		AcceptsCacheNotification(nDataType) {
			return setWatchedCacheTypes.has(nDataType);
		},
		GetModelTypeName(nModelType) {
			switch (nModelType) {
				case ModelType.Brush:
					return "brush";

				case ModelType.Sprite:
					return "sprite";

				case ModelType.Studio:
					return "studio";

				default:
					return "invalid";
			}
		},
		WithRenderFlag(nFlags) {
			if (!Number.isInteger(nFlags) || (nFlags < g_nMinimumStudioFlagMask) || (nFlags > g_nMaximumStudioFlagMask)) {
				throw new TypeError("nFlags must be a signed 32-bit integer mask.");
			}

			return nFlags | StudioFlags.Render;
		},
	};
}

module.exports = { CreateStudioClassifier };
```

## Handles And Reference Ownership

Every valid `FindModel(strModelPath)` and `FindModelHandle(strModelPath)` call invokes `FindMDL` and owns one cache reference. Calling both for
the same path owns two references and requires two matching `Release()` calls. An invalid result owns no valid reference.

`AddReference()` creates one additional reference. SourceJS does not attach automatic lifetime management to JavaScript objects.

```js
const {
	INVALID_MODEL_HANDLE,
	AddReference,
	FindModelHandle,
	GetReferenceCount,
	Release,
} = require("studio");

function WithAdditionalModelReference(strModelPath, Callback) {
	if (typeof Callback !== "function") {
		throw new TypeError("Callback must be a function.");
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

		const ReferenceInformation = { Handle: hModelHandle, CountAfterAdd: nCountAfterAdd };
		if (typeof GetReferenceCount === "function") {
			ReferenceInformation.CurrentReferenceCount = GetReferenceCount(hModelHandle);
		}

		Result = Callback(ReferenceInformation);
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
		const Failure = new AggregateError(vecErrors, "Model reference cleanup requires investigation.");
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

module.exports = { WithAdditionalModelReference };
```

Once `AddReference()` returns, the workflow attempts both confirmed releases even if one fails. If the add throws, only
the lookup reference is confirmed, so it attempts one release and reports `AddReferenceOutcomeUnknown`. An SDK operation
may mutate before throwing; neither this flag nor `UnconfirmedReleaseCount` is permission to retry a potentially freed handle.
`AggregateError.errors` preserves the original operation and all cleanup exceptions in order, including falsy thrown values.
When cleanup succeeds, the callback result or original operation exception is preserved exactly.

The callback must finish synchronously, retain no borrowed views, and neither release nor transfer the handle. Cache calls
are game-thread operations requiring a live SDK cache. If a cache flush, model reload, map transition or plugin unload
invalidates the cache, discard all borrowed records and addresses; holding a reference does not prevent explicit invalidation.

## Model Records

`FindModel(strModelPath)` returns an object with:

| Member | Result |
| --- | --- |
| `Handle` | Numeric `MDLHandle_t`, possibly `INVALID_MODEL_HANDLE`. |
| `IsValid()` | Checks the receiver's handle range and invalid sentinel while the cache is available; not ownership or cache generation. |
| `GetName()` | Current name for a valid cache handle. |
| `GetReferenceCount()` | Current count; absent on old-console SDKs. |

Model `Handle` and methods are installed as own data properties; inherited setters
cannot intercept creation. `Handle` is ordinary writable metadata, not a reference owner. Keep the originally acquired
handle for cleanup and do not overwrite it; copying the record acquires nothing. Methods read the current receiver's `Handle` as a uint32 number
fitting `MDLHandle_t`. `IsValid()` still returns `false` for the invalid sentinel;
name/reference queries reject it. The model cache is still required. Model-record
creation and methods preserve JavaScript exceptions and translate native
exceptions with operation context. These checks do not establish model lifetime.

This controller intentionally acquires two references, guards partial acquisition, and attempts both releases independently:

```js
const {
	INVALID_MODEL_HANDLE,
	FindModel,
	FindModelHandle,
	GetModelName,
	Release,
} = require("studio");

function CreateModelInspection(strModelPath) {
	const vecOwnedModelHandles = [];
	const ReleaseReferences = () => {
		const vecModelHandles = vecOwnedModelHandles.splice(0);
		const vecCleanupErrors = [];
		const vecUnconfirmedModelHandles = [];
		for (const hOwnedModelHandle of vecModelHandles) {
			try {
				Release(hOwnedModelHandle);
			} catch (CleanupError) {
				vecCleanupErrors.push(CleanupError);
				vecUnconfirmedModelHandles.push(hOwnedModelHandle);
			}
		}

		return { Errors: vecCleanupErrors, UnconfirmedModelHandles: vecUnconfirmedModelHandles };
	};

	let bDisposed = false;

	try {
		const Model = FindModel(strModelPath);
		const hModelRecordHandle = Model.Handle;
		if (hModelRecordHandle !== INVALID_MODEL_HANDLE) {
			vecOwnedModelHandles.push(hModelRecordHandle);
		}

		const hModelHandle = FindModelHandle(strModelPath);
		if (hModelHandle !== INVALID_MODEL_HANDLE) {
			vecOwnedModelHandles.push(hModelHandle);
		}

		if (!Model.IsValid() || (hModelRecordHandle === INVALID_MODEL_HANDLE) || (hModelHandle === INVALID_MODEL_HANDLE)) {
			throw new Error(`Model is unavailable: ${strModelPath}`);
		}

		return {
			Model,
			Handle: hModelHandle,
			Inspect() {
				if (bDisposed) {
					throw new Error("Model inspection is disposed");
				}

				const Inspection = { HandleMatches: Model.Handle === hModelHandle, Valid: Model.IsValid(), DirectName: GetModelName(hModelHandle), ModelName: Model.GetName() };
				if (typeof Model.GetReferenceCount === "function") {
					Inspection.ReferenceCount = Model.GetReferenceCount();
				}

				return Inspection;
			},
			Dispose() {
				if (bDisposed) {
					return false;
				}

				bDisposed = true;
				const Cleanup = ReleaseReferences();
				if (Cleanup.Errors.length > 0) {
					const Failure = new AggregateError(Cleanup.Errors, "Model inspection release outcomes are unknown.");
					Failure.UnconfirmedModelHandles = Cleanup.UnconfirmedModelHandles;
					throw Failure;
				}

				return true;
			},
		};
	} catch (OperationError) {
		const Cleanup = ReleaseReferences();
		if (Cleanup.Errors.length > 0) {
			const Failure = new AggregateError([OperationError, ...Cleanup.Errors], "Model inspection setup and cleanup failed.");
			Failure.UnconfirmedModelHandles = Cleanup.UnconfirmedModelHandles;
			throw Failure;
		}

		throw OperationError;
	}
}

module.exports = { CreateModelInspection };
```

Discard the returned model record before `Dispose()`; its methods do not own a reference independently.
The controller captures both acquired handles rather than rereading mutable `Model.Handle` during cleanup. It disarms
before release and attempts every confirmed reference once. Later `Inspect()` calls throw; repeated `Dispose()` calls return `false`. Failed
releases report ordered `AggregateError.errors` and `UnconfirmedModelHandles`; these are unknown native outcomes, not
safe retry targets. Setup failures also preserve the original exception and clean every earlier confirmed acquisition.

## Model Headers

`GetModelHeader(hModelHandle)` returns `null` for a valid handle whose header is not loaded. `RequireModelHeader(hModelHandle)` throws for that
state. `GetModelHeaderAddress(hModelHandle)` exposes the same header as a `bigint` address and returns `0n` when absent.

A header record has these members. Writable counts and offsets describe live SDK storage, not JavaScript-owned capacity;
range checks cannot prove that forged metadata or an expired address still points to a valid allocation.

| Member | Type |
| --- | --- |
| `Address` | Exact borrowed `studiohdr_t` address as `bigint`. |
| `ID`, `Version`, `Length`, `Flags` | Writable native signed 32-bit integer fields. |
| `Checksum` | Writable native signed integer; its exact C++ type and width come from the selected SDK. SDK integers up to 32 bits use an integral Number within the native range; a 64-bit SDK integer uses an exact `bigint`. |
| `Name` | Read-only string sourced from studio-cache data. |
| `EyePosition`, `IlluminationCenter` | Live vector views. |
| `HullMinimums`, `HullMaximums`, `ViewMinimums`, `ViewMaximums` | Live bound vectors. |
| `BoneCount`, `BoneOffset` | Writable native bone-table metadata. |
| `BoneControllerCount`, `BoneControllerOffset` | Writable native controller-table metadata. |
| `HitboxSetCount`, `HitboxSetOffset` | Writable native hitbox-set metadata. |
| `LocalAnimationCount`, `LocalAnimationOffset` | Writable native local-animation metadata. |
| `AttachmentCount`, `AttachmentOffset` | Writable native attachment metadata. |
| `LocalSequenceCount`, `LocalSequenceOffset` | Writable native local-sequence metadata. |
| `Mass` | Native float; the setter accepts only finite values in the native float range. |
| [`Contents`](#contents) | Writable native contents mask. |
| `GetBone(nBoneIndex)` | Requires a non-negative Int32 index; returns a live bone record or `null` when outside the bone table. |
| `GetBoneController(nBoneControllerIndex)` | Requires a non-negative Int32 index; returns a live controller record or `null` when outside the controller table. |
| `GetHitboxSet(nHitboxSetIndex)` | Requires a non-negative Int32 index; returns a live hitbox-set record or `null` when outside the hitbox-set table. |
| `GetHitbox(nHitboxIndex, nHitboxSetIndex = 0)` | Live hitbox record or `null` when either non-negative Int32 index is outside its table; requires the hitbox index, while an omitted or `undefined` hitbox-set index uses zero. |
| `GetLocalSequence(nLocalSequenceIndex)` | Requires a non-negative Int32 index; returns a live sequence record or `null` when outside the local-sequence table. |
| `GetAttachment(nAttachmentIndex)` | Requires a non-negative Int32 index; returns a live attachment record or `null` when outside the attachment table. |
| `Bones()`, `BoneControllers()`, `HitboxSets()` | Fresh arrays of live records; throw if the corresponding native count is negative. |
| `LocalSequences()`, `Attachments()` | Fresh arrays of live records; throw if the corresponding native count is negative. |

Writable header fields update the shared SDK record directly. Changing a length, count, or offset can invalidate later nested views;
assign only values that are valid for the loaded studio buffer, because the bindings cannot prove that a rewritten range remains inside
the cache allocation.

```js
const {
	INVALID_MODEL_HANDLE,
	FindModelHandle,
	GetModelHeader,
	GetModelHeaderAddress,
	Release,
	RequireModelHeader,
} = require("studio");

function CreateModelHeaderInspection(strModelPath) {
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
		Header = RequireModelHeader(hModelHandle);

		if ((NullableHeader === null) || (unHeaderAddress === 0n)) {
			throw new Error(`Model header is not loaded: ${strModelPath}`);
		}
	} catch (OperationError) {
		try {
			Release(hModelHandle);
		} catch (CleanupError) {
			const Failure = new AggregateError([OperationError, CleanupError], "Model header setup and release failed.");
			Failure.ModelHandle = hModelHandle;
			Failure.ReferenceReleaseOutcomeUnknown = true;
			throw Failure;
		}

		throw OperationError;
	}

	let bDisposed = false;

	return {
		Header,
		Inspect() {
			if (bDisposed) {
				throw new Error("Model header inspection is disposed");
			}

			return {
				Attachment: Header.GetAttachment(0),
				Bone: Header.GetBone(0),
				BoneController: Header.GetBoneController(0),
				Header,
				Hitbox: Header.GetHitbox(0, 0),
				HitboxSet: Header.GetHitboxSet(0),
				LocalSequence: Header.GetLocalSequence(0),
				Address: unHeaderAddress,
				NullableHeaderAddress: NullableHeader.Address,
				Name: Header.Name,
				Scalar: {
					Mass: Header.Mass,
					Checksum: Header.Checksum,
					AttachmentCount: Header.AttachmentCount,
					AttachmentOffset: Header.AttachmentOffset,
					BoneControllerCount: Header.BoneControllerCount,
					BoneControllerOffset: Header.BoneControllerOffset,
					BoneCount: Header.BoneCount,
					BoneOffset: Header.BoneOffset,
					Contents: Header.Contents,
					Flags: Header.Flags,
					HitboxSetCount: Header.HitboxSetCount,
					HitboxSetOffset: Header.HitboxSetOffset,
					ID: Header.ID,
					Length: Header.Length,
					LocalAnimationCount: Header.LocalAnimationCount,
					LocalAnimationOffset: Header.LocalAnimationOffset,
					LocalSequenceCount: Header.LocalSequenceCount,
					LocalSequenceOffset: Header.LocalSequenceOffset,
					Version: Header.Version,
				},
				Vectors: {
					EyePosition: Header.EyePosition,
					HullMaximums: Header.HullMaximums,
					HullMinimums: Header.HullMinimums,
					IlluminationCenter: Header.IlluminationCenter,
					ViewMaximums: Header.ViewMaximums,
					ViewMinimums: Header.ViewMinimums,
				},
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
				Failure.ReferenceReleaseOutcomeUnknown = true;
				throw Failure;
			}

			return true;
		},
	};
}

module.exports = { CreateModelHeaderInspection };
```

Each collection call returns a new array whose membership reflects that call. Its elements and every nested vector or
matrix remain direct native views. Read the collection again after changing table metadata, and call `Dispose()` only
after every object returned by `Inspect()` has been discarded.
The controller disarms before cleanup and never retries a failed release. Setup failures preserve the original exception;
if release also fails, `AggregateError.errors` contains both exceptions in order. `ReferenceReleaseOutcomeUnknown`
reports an unknown SDK outcome, not permission to retry the handle. All access requires the original live cache on the game thread.

## Live Native Views

| View | Shape |
| --- | --- |
| Vector | `{ Address: bigint, X, Y, Z }`. |
| RadianEuler | `{ Address: bigint, Pitch, Yaw, Roll }`; angles are radians. `Pitch` reads/writes SDK `y`, `Yaw` SDK `z`, and `Roll` SDK `x`, matching native `RadianEuler::ToQAngle()`. |
| Quaternion | `{ Address: bigint, X, Y, Z, W }`. |
| `matrix3x4_t` | Three array rows, four writable numbers per row and outer-array `Address: bigint`. |
| Integer array | Writable indexed numbers plus array `Address: bigint`. |

Float setters require finite values in native float range. Signed integer setters require the exact native integer
range; ordinary studio integers are signed 32-bit. Attachment `Flags` requires an unsigned 32-bit integer. Native
strings are read-only and may be `null`.

Primitive float, signed-integer and unsigned-integer property accessors check alignment and the
complete representable scalar address range before installation or access, then
read/write scalar bytes. Failed conversions stop before writing; JavaScript
exceptions are preserved and native exceptions receive operation context.
Null string addresses still return `null`; invalid accessor metadata or failed
string conversion propagates an error instead. Native `Address` is installed as
an own `bigint` data property. None of these checks proves actual storage extent,
mapping, lifetime or protection against OS faults.

Math-view constructors validate alignment and the complete representable native
record range before field access. Integer-array construction checks byte-count
overflow and nonempty byte ranges; zero elements still require a nonnull address.
Matrix rows are installed as own properties. Failed construction preserves
exceptions and does not return a partially initialized view.

Bone-controller, hitbox and attachment constructors also validate alignment and
complete representable fixed-record ranges before accessing SDK fields.
Hitbox `Mins`/`Maxs` and attachment `LocalTransform` are checked own properties;
failed child construction stops before installation. Attachment `Flags` remains
a strict unsigned 32-bit Number, validated before its scalar bytes are written.
These borrowed records still require valid live SDK storage and relative offsets.

Hitbox-set construction validates its complete aligned, representable fixed-record
range before accessing fields, then installs `GetHitbox`/`Hitboxes` as checked own
methods. Indexed model/header lookups validate non-negative signed 32-bit indexes
before calling SDK accessors; out-of-range indexes still return `null`.
`ModelHeader.GetHitbox(nHitboxIndex, nHitboxSetIndex?)` defaults the optional set to
zero and validates the nested set record before reading its hitbox count.
`HitboxSet.Hitboxes()` rejects a negative count, checks count-to-byte overflow and
the complete aligned, representable nonempty table range before iteration. Empty
sets return an empty array without resolving a first hitbox. Array entries are
checked own properties; errors stop before publishing the result. Delegated V8
errors are preserved before fallback diagnostics. These numeric checks do not
establish storage extent, mapping, lifetime or validity of SDK-relative offsets.

Header `Bones`/`BoneControllers`/`HitboxSets`/`LocalSequences`/`Attachments`
collections apply the same negative-count, byte-count-overflow and nonempty
aligned representable table checks before iteration. Empty collections do not
resolve a first record. Header methods and collection entries use checked own
properties, and failed child creation stops before publication.
`Sequence.GetAnimationIndex(nAnimationXIndex?, nAnimationYIndex?)` defaults both
indexes to zero. It checks positive grid dimensions, index and integer-arithmetic
bounds, relative-address arithmetic and the aligned representable short-table
range through the selected element before the SDK reads it.
`Sequence.GetWeight(nBoneIndex?)` defaults to zero, validates the complete aligned
header and selected float ranges, then reads the float through scalar byte copies.
These checks retain the borrowed-storage and valid SDK-relative-offset requirements.

Header/Sequence construction validates the complete aligned, representable fixed
record range before field access. Sequence model-header resolution checks signed
relative-address arithmetic before converting the result to a native header
address; the header builder then checks its complete fixed range. Vector members
and all three Sequence methods are installed as checked own properties. Failed
V8 calls stop construction and preserve the original exception before a fallback
diagnostic; no partially constructed record is returned.
Signed integer properties validate complete scalar ranges and use byte copies.
Up-to-32-bit signed values use integral Numbers; 64-bit signed values require
losslessly representable BigInts. Writes occur only after conversion succeeds.
These checks do not prove storage extent, mapping, lifetime or relative-offset validity.

Address values are exact borrowed `bigint` values. They identify native memory but do not extend its lifetime, which
belongs entirely to `IMDLCache`.

## Bones

A bone exposes:

| Member | Type |
| --- | --- |
| `Address` | Exact `mstudiobone_t` address as `bigint`. |
| `NameOffset`, `Parent`, `Flags` | Writable signed 32-bit integers. |
| `Name` | Read-only string or `null`. |
| `ProceduralType`, `ProcedureOffset` | Writable signed 32-bit procedural metadata. |
| `PhysicsBone`, `Contents` | Writable signed 32-bit physics metadata. |
| `SurfaceNameOffset`, `SurfacePropertyLookup` | Writable signed 32-bit surface metadata; lookup is SDK-conditioned. |
| `SurfaceName` | Read-only string or `null`. |
| `BoneControllerIndexes` | Six-element live signed 32-bit integer array. |
| `Position`, `PositionScale`, `RadianEulerScale` | Live vectors. |
| `Quaternion`, `Alignment` | Live quaternions. |
| `RadianEuler` | Live Euler view. |
| `PositionToBone` | Live `matrix3x4_t`. |
| `GetProcedureAddress()` | Exact procedural address as `bigint`, possibly `0n`. |

Bone nested views and `GetProcedureAddress` are installed as own properties,
without inherited-setter interception. Address extraction remains strict,
lossless BigInt and stages its output. Header/hitbox-set/sequence address
resolution checks alignment and complete representable record ranges;
`GetProcedureAddress()` checks the bone record before calling SDK code. Relative
offsets, string capacities, actual storage, mapping and lifetime remain the
caller's valid-live-SDK-data contract, not guarantees of these numeric checks.

The temporary-bone workflow below restores each attempted write independently before releasing its reference. It preserves
the operation and every cleanup exception, including falsy thrown values. Failed restoration or release is an unknown outcome;
do not replay it automatically or use the copied addresses after the matching cache reference ends.

```js
const {
	INVALID_BONE_INDEX,
	INVALID_MODEL_HANDLE,
	FindModelHandle,
	Release,
	RequireModelHeader,
} = require("studio");

function ReadBoneMatrixComponents(vecMatrixRows) {
	const vecRows = [];
	for (let unRowIndex = 0; unRowIndex < vecMatrixRows.length; unRowIndex += 1) {
		const vecRow = vecMatrixRows[unRowIndex];
		const vecComponents = [];
		for (let unComponentIndex = 0; unComponentIndex < vecRow.length; unComponentIndex += 1) {
			vecComponents.push(vecRow[unComponentIndex]);
		}

		vecRows.push(vecComponents);
	}

	return { Address: vecMatrixRows.Address, Rows: vecRows };
}

function ReadBoneQuaternionComponents(Quaternion) {
	return { W: Quaternion.W, X: Quaternion.X, Y: Quaternion.Y, Z: Quaternion.Z, Address: Quaternion.Address };
}

function ReadBoneVectorComponents(Vector) {
	return { X: Vector.X, Y: Vector.Y, Z: Vector.Z, Address: Vector.Address };
}

function ReadBoneRadianEulerComponents(RadianEuler) {
	return { Pitch: RadianEuler.Pitch, Yaw: RadianEuler.Yaw, Roll: RadianEuler.Roll, Address: RadianEuler.Address };
}

function TemporarilyOffsetRootBone(strModelPath, flOffset = 0.125) {
	if ((typeof flOffset !== "number") || !Number.isFinite(flOffset)) {
		throw new TypeError("flOffset must be a finite number.");
	}

	const hModelHandle = FindModelHandle(strModelPath);
	if (hModelHandle === INVALID_MODEL_HANDLE) {
		throw new Error(`Model is unavailable: ${strModelPath}`);
	}

	const unTranslationComponentIndex = 3;

	let Position;
	let vecMatrixRows;
	let vecMatrixRow;
	let flOriginalPositionX;
	let flOriginalMatrixX;
	let bPositionWriteAttempted = false;
	let bMatrixWriteAttempted = false;
	let bOperationFailed = false;
	let OperationError;
	let Inspection;

	try {
		const Header = RequireModelHeader(hModelHandle);
		const vecBones = Header.Bones();
		let nRootIndex = INVALID_BONE_INDEX;
		for (let unBoneIndex = 0; unBoneIndex < vecBones.length; unBoneIndex += 1) {
			if (vecBones[unBoneIndex].Parent === INVALID_BONE_INDEX) {
				nRootIndex = unBoneIndex;
				break;
			}
		}

		if (nRootIndex === INVALID_BONE_INDEX) {
			throw new Error("Model has no root bone");
		}

		const Bone = Header.GetBone(nRootIndex);
		if (Bone === null) {
			throw new Error(`Root bone is unavailable: ${nRootIndex}`);
		}

		Position = Bone.Position;
		vecMatrixRows = Bone.PositionToBone;
		vecMatrixRow = vecMatrixRows[0];
		flOriginalPositionX = Position.X;
		flOriginalMatrixX = vecMatrixRow[unTranslationComponentIndex];

		bPositionWriteAttempted = true;
		Position.X = flOriginalPositionX + flOffset;
		bMatrixWriteAttempted = true;
		vecMatrixRow[unTranslationComponentIndex] = flOriginalMatrixX + flOffset;

		const vecBoneControllerIndexes = [];
		for (const nControllerIndex of Bone.BoneControllerIndexes) {
			vecBoneControllerIndexes.push(nControllerIndex);
		}

		Inspection = {
			BoneControllerIndexes: vecBoneControllerIndexes,
			PositionToBone: ReadBoneMatrixComponents(vecMatrixRows),
			Alignment: ReadBoneQuaternionComponents(Bone.Alignment),
			Quaternion: ReadBoneQuaternionComponents(Bone.Quaternion),
			RadianEuler: ReadBoneRadianEulerComponents(Bone.RadianEuler),
			Address: Bone.Address,
			ProcedureAddress: Bone.GetProcedureAddress(),
			Name: Bone.Name,
			SurfaceName: Bone.SurfaceName,
			Contents: Bone.Contents,
			Flags: Bone.Flags,
			NameOffset: Bone.NameOffset,
			ProceduralType: Bone.ProceduralType,
			ProcedureOffset: Bone.ProcedureOffset,
			SurfaceNameOffset: Bone.SurfaceNameOffset,
			Position: ReadBoneVectorComponents(Position),
			PositionScale: ReadBoneVectorComponents(Bone.PositionScale),
			RadianEulerScale: ReadBoneVectorComponents(Bone.RadianEulerScale),
			Parent: Bone.Parent,
			PhysicsBone: Bone.PhysicsBone,
		};
		if (Object.hasOwn(Bone, "SurfacePropertyLookup")) {
			Inspection.SurfacePropertyLookup = Bone.SurfacePropertyLookup;
		}
	} catch (CaughtError) {
		bOperationFailed = true;
		OperationError = CaughtError;
	}

	const vecCleanupErrors = [];
	let bPositionRestorationOutcomeUnknown = false;
	let bMatrixRestorationOutcomeUnknown = false;
	let bReferenceReleaseOutcomeUnknown = false;
	if (bPositionWriteAttempted) {
		try {
			Position.X = flOriginalPositionX;
		} catch (CleanupError) {
			bPositionRestorationOutcomeUnknown = true;
			vecCleanupErrors.push(CleanupError);
		}
	}

	if (bMatrixWriteAttempted) {
		try {
			vecMatrixRow[unTranslationComponentIndex] = flOriginalMatrixX;
		} catch (CleanupError) {
			bMatrixRestorationOutcomeUnknown = true;
			vecCleanupErrors.push(CleanupError);
		}
	}

	try {
		Release(hModelHandle);
	} catch (CleanupError) {
		bReferenceReleaseOutcomeUnknown = true;
		vecCleanupErrors.push(CleanupError);
	}

	if (vecCleanupErrors.length > 0) {
		const vecErrors = bOperationFailed ? [OperationError, ...vecCleanupErrors] : vecCleanupErrors;
		const Failure = new AggregateError(vecErrors, "Bone inspection cleanup requires investigation.");
		Failure.ModelHandle = hModelHandle;
		Failure.PositionRestorationOutcomeUnknown = bPositionRestorationOutcomeUnknown;
		Failure.MatrixRestorationOutcomeUnknown = bMatrixRestorationOutcomeUnknown;
		Failure.ReferenceReleaseOutcomeUnknown = bReferenceReleaseOutcomeUnknown;
		throw Failure;
	}

	if (bOperationFailed) {
		throw OperationError;
	}

	return Inspection;
}

module.exports = { TemporarilyOffsetRootBone };
```

## Bone Controllers

A controller exposes:

| Member | Type |
| --- | --- |
| `Address` | Exact borrowed `mstudiobonecontroller_t` address as `bigint`. |
| `Bone`, `Type`, `Rest`, `InputField` | Writable signed 32-bit native integers. |
| `Start`, `End` | Writable finite values in native float range. |

```js
const {
	INVALID_MODEL_HANDLE,
	FindModelHandle,
	Release,
	RequireModelHeader,
} = require("studio");

function TemporarilyAdjustFirstBoneController(strModelPath, flDelta = 1) {
	if ((typeof flDelta !== "number") || !Number.isFinite(flDelta)) {
		throw new TypeError("flDelta must be a finite number.");
	}

	const hModelHandle = FindModelHandle(strModelPath);
	if (hModelHandle === INVALID_MODEL_HANDLE) {
		throw new Error(`Model is unavailable: ${strModelPath}`);
	}

	const vecRestorations = [];
	const ApplyTemporaryEdits = () => {
		const Header = RequireModelHeader(hModelHandle);
		const vecControllers = Header.BoneControllers();
		if (vecControllers.length === 0) {
			return null;
		}

		const Controller = Header.GetBoneController(0);
		if (Controller === null) {
			return null;
		}

		const flOriginalStart = Controller.Start;
		vecRestorations.push({
			PropertyName: "Start",
			Apply() {
				Controller.Start = flOriginalStart;
			},
		});
		Controller.Start = flOriginalStart + flDelta;

		return { End: Controller.End, Start: Controller.Start, Bone: Controller.Bone, Rest: Controller.Rest, Address: Controller.Address, InputField: Controller.InputField, Type: Controller.Type };
	};

	let bOperationFailed = false;
	let OperationError;
	let Result = null;

	try {
		Result = ApplyTemporaryEdits();
	} catch (CaughtError) {
		bOperationFailed = true;
		OperationError = CaughtError;
	}

	const vecCleanupErrors = [];
	const vecUnconfirmedRestorations = [];
	for (const Restoration of vecRestorations) {
		try {
			Restoration.Apply();
		} catch (CleanupError) {
			vecCleanupErrors.push(CleanupError);
			vecUnconfirmedRestorations.push(Restoration.PropertyName);
		}
	}

	let bReferenceReleaseOutcomeUnknown = false;
	try {
		Release(hModelHandle);
	} catch (CleanupError) {
		bReferenceReleaseOutcomeUnknown = true;
		vecCleanupErrors.push(CleanupError);
	}

	if (vecCleanupErrors.length > 0) {
		const vecErrors = bOperationFailed ? [OperationError, ...vecCleanupErrors] : vecCleanupErrors;
		const Failure = new AggregateError(vecErrors, "Temporary studio edit cleanup requires investigation.");
		Failure.ModelHandle = hModelHandle;
		Failure.UnconfirmedRestorations = vecUnconfirmedRestorations;
		Failure.ReferenceReleaseOutcomeUnknown = bReferenceReleaseOutcomeUnknown;
		throw Failure;
	}

	if (bOperationFailed) {
		throw OperationError;
	}

	return Result;
}

module.exports = { TemporarilyAdjustFirstBoneController };
```

## Hitbox Sets And Hitboxes

See [entities/animation](entities-animation.md) for the world positions of an entity's currently posed hitboxes and [studio/animation](studio-animation.md) for model-local clips, frames, and pose parameters.

A hitbox set exposes:

| Member | Type |
| --- | --- |
| `Address` | Exact borrowed `mstudiohitboxset_t` address as `bigint`. |
| `NameOffset`, `HitboxCount`, `HitboxOffset` | Writable native integers. |
| `Name` | Read-only string sourced from studio-cache data. |
| `GetHitbox(nHitboxIndex)` | Requires a non-negative Int32 index; returns a live hitbox view or `null` when outside the current set. |
| `Hitboxes()` | Fresh array of live hitbox views; throws if the native hitbox count is negative. |

The writable count and offset fields modify the shared SDK record directly. Assign only values that are valid for the loaded studio
buffer; the bindings cannot prove that a rewritten offset still points inside the cache allocation.

A hitbox exposes:

| Member | Type |
| --- | --- |
| `Address` | Exact borrowed `mstudiobbox_t` address as `bigint`. |
| `NameOffset`, `Bone`, `Group` | Writable native integers. |
| `Name` | Read-only string or `null`. |
| `Mins`, `Maxs` | Live Vector views; these are the current public hitbox property names. |

Header and hitbox-set lookups return views of the same cache memory.

```js
const {
	INVALID_MODEL_HANDLE,
	FindModelHandle,
	Release,
	RequireModelHeader,
} = require("studio");

const g_nMaximumStudioIndex = 0x7FFFFFFF;

function ReadHitboxVectorComponents(Vector) {
	return { X: Vector.X, Y: Vector.Y, Z: Vector.Z, Address: Vector.Address };
}

function TemporarilyExpandHitbox(strModelPath, flAmount = 2, nHitboxSetIndex = 0, nHitboxIndex = 0) {
	if ((typeof flAmount !== "number") || !Number.isFinite(flAmount)) {
		throw new TypeError("flAmount must be a finite number.");
	}

	if (!Number.isInteger(nHitboxSetIndex) || (nHitboxSetIndex < 0) || (nHitboxSetIndex > g_nMaximumStudioIndex) || !Number.isInteger(nHitboxIndex) || (nHitboxIndex < 0) || (nHitboxIndex > g_nMaximumStudioIndex)) {
		throw new TypeError("nHitboxSetIndex and nHitboxIndex must be non-negative Int32 values.");
	}

	const hModelHandle = FindModelHandle(strModelPath);
	if (hModelHandle === INVALID_MODEL_HANDLE) {
		throw new Error(`Model is unavailable: ${strModelPath}`);
	}

	const vecRestorations = [];
	const ApplyTemporaryEdits = () => {
		const Header = RequireModelHeader(hModelHandle);
		const HitboxSet = Header.GetHitboxSet(nHitboxSetIndex);
		if (HitboxSet === null) {
			return null;
		}

		const Hitbox = HitboxSet.GetHitbox(nHitboxIndex);
		const HeaderHitbox = Header.GetHitbox(nHitboxIndex, nHitboxSetIndex);
		if ((Hitbox === null) || (HeaderHitbox === null)) {
			return null;
		}

		const Minimums = Hitbox.Mins;
		const Maximums = Hitbox.Maxs;
		const flOriginalMinimumX = Minimums.X;
		const flOriginalMaximumX = Maximums.X;
		vecRestorations.push({
			PropertyName: "Mins.X",
			Apply() {
				Minimums.X = flOriginalMinimumX;
			},
		});
		Minimums.X = flOriginalMinimumX - flAmount;
		vecRestorations.push({
			PropertyName: "Maxs.X",
			Apply() {
				Maximums.X = flOriginalMaximumX;
			},
		});
		Maximums.X = flOriginalMaximumX + flAmount;

		const vecHitboxInspections = [];
		for (const Entry of HitboxSet.Hitboxes()) {
			vecHitboxInspections.push({ Bone: Entry.Bone, Group: Entry.Group, Address: Entry.Address, Name: Entry.Name });
		}

		return {
			SameAddress: Hitbox.Address === HeaderHitbox.Address,
			Bone: Hitbox.Bone,
			Group: Hitbox.Group,
			Address: Hitbox.Address,
			Name: Hitbox.Name,
			HitboxCount: HitboxSet.HitboxCount,
			HitboxOffset: HitboxSet.HitboxOffset,
			Maximums: ReadHitboxVectorComponents(Maximums),
			Minimums: ReadHitboxVectorComponents(Minimums),
			SetName: HitboxSet.Name,
			SetNameOffset: HitboxSet.NameOffset,
			SetAddress: HitboxSet.Address,
			HitboxNameOffset: Hitbox.NameOffset,
			Hitboxes: vecHitboxInspections,
		};
	};

	let bOperationFailed = false;
	let OperationError;
	let Result = null;

	try {
		Result = ApplyTemporaryEdits();
	} catch (CaughtError) {
		bOperationFailed = true;
		OperationError = CaughtError;
	}

	const vecCleanupErrors = [];
	const vecUnconfirmedRestorations = [];
	for (const Restoration of vecRestorations) {
		try {
			Restoration.Apply();
		} catch (CleanupError) {
			vecCleanupErrors.push(CleanupError);
			vecUnconfirmedRestorations.push(Restoration.PropertyName);
		}
	}

	let bReferenceReleaseOutcomeUnknown = false;
	try {
		Release(hModelHandle);
	} catch (CleanupError) {
		bReferenceReleaseOutcomeUnknown = true;
		vecCleanupErrors.push(CleanupError);
	}

	if (vecCleanupErrors.length > 0) {
		const vecErrors = bOperationFailed ? [OperationError, ...vecCleanupErrors] : vecCleanupErrors;
		const Failure = new AggregateError(vecErrors, "Temporary studio edit cleanup requires investigation.");
		Failure.ModelHandle = hModelHandle;
		Failure.UnconfirmedRestorations = vecUnconfirmedRestorations;
		Failure.ReferenceReleaseOutcomeUnknown = bReferenceReleaseOutcomeUnknown;
		throw Failure;
	}

	if (bOperationFailed) {
		throw OperationError;
	}

	return Result;
}

module.exports = { TemporarilyExpandHitbox };
```

Editing hitbox memory affects every entity that uses the cached model. Per-entity hitboxes require an engine-specific
runtime layer; `studio` edits the shared model definition.

## Local Sequences

A sequence object is a non-owning live view of one native `mstudioseqdesc_t` record:

| Member | Contract |
| --- | --- |
| `Address` | Exact borrowed native sequence-record address as `bigint`. The wrapper does not own or extend the record's lifetime. |
| `ModelHeaderOffset`, `LabelOffset`, `ActivityOffset` | Writable native relative offsets. |
| `Label`, `Activity` | Read-only strings resolved from the corresponding offsets when the wrapper is created. Writing an offset later does not retarget either existing string property. |
| `Flags`, `ActivityIndex`, `ActivityWeight`, `EventCount`, `EventOffset`, `BlendCount`, `AnimationOffset`, `MovementOffset` | Writable native integer fields. |
| `LocalEntryNode`, `LocalExitNode`, `NodeFlags`, `NextSequence`, `DeltaAnimationIndex` | Writable native integer fields. |
| `FadeInTime`, `FadeOutTime`, `EntryPhase`, `ExitPhase`, `LastFrame` | Writable native floats. Setters require a finite number within the native `float` range. |
| `Minimums`, `Maximums` | Live `Vector` views of the native bounding-box fields. |
| `GetModelHeader()` | Returns a fresh live header view resolved from the current model-header offset. It throws when the resolved header is null or misaligned. |
| `GetAnimationIndex(nAnimationXIndex = 0, nAnimationYIndex = 0)` | Accepts optional non-negative Int32 grid indexes; omission or `undefined` uses zero. Returns the native signed animation index; throws for non-positive dimensions, out-of-grid coordinates, or a linear grid index that exceeds the native `int` range. |
| `GetWeight(nBoneIndex = 0)` | Accepts an optional non-negative Int32 bone index; omission or `undefined` uses zero. Returns the native float weight; throws when the owning header or native weight storage is unavailable or misaligned, or when the bone is out of range. |

Writing these fields updates the shared SDK record directly. Recreate the sequence wrapper after changing a label or activity offset if
the corresponding string must be resolved again. Methods resolve their native addresses from the current offsets; the binding rejects
null or misaligned addresses where it can, but it cannot prove that rewritten offsets and counts stay inside the original allocation.

```js
const {
	INVALID_MODEL_HANDLE,
	FindModelHandle,
	Release,
	RequireModelHeader,
} = require("studio");

function ReadSequenceVectorComponents(Vector) {
	return { X: Vector.X, Y: Vector.Y, Z: Vector.Z, Address: Vector.Address };
}

function TemporarilyAdjustFirstSequence(strModelPath, flScale = 0.5) {
	if ((typeof flScale !== "number") || !Number.isFinite(flScale)) {
		throw new TypeError("flScale must be a finite number.");
	}

	const hModelHandle = FindModelHandle(strModelPath);
	if (hModelHandle === INVALID_MODEL_HANDLE) {
		throw new Error(`Model is unavailable: ${strModelPath}`);
	}

	const vecRestorations = [];
	const ApplyTemporaryEdits = () => {
		const Header = RequireModelHeader(hModelHandle);
		const vecSequences = Header.LocalSequences();
		if (vecSequences.length === 0) {
			return null;
		}

		const Sequence = Header.GetLocalSequence(0);
		if (Sequence === null) {
			return null;
		}

		const flOriginalFadeInTime = Sequence.FadeInTime;
		const flOriginalFadeOutTime = Sequence.FadeOutTime;
		vecRestorations.push({
			PropertyName: "FadeInTime",
			Apply() {
				Sequence.FadeInTime = flOriginalFadeInTime;
			},
		});
		Sequence.FadeInTime = flOriginalFadeInTime * flScale;
		vecRestorations.push({
			PropertyName: "FadeOutTime",
			Apply() {
				Sequence.FadeOutTime = flOriginalFadeOutTime;
			},
		});
		Sequence.FadeOutTime = flOriginalFadeOutTime * flScale;

		return {
			LocalEntryNode: Sequence.LocalEntryNode,
			LocalExitNode: Sequence.LocalExitNode,
			ModelHeaderOffset: Sequence.ModelHeaderOffset,
			NextSequence: Sequence.NextSequence,
			Address: Sequence.Address,
			Activity: Sequence.Activity,
			Label: Sequence.Label,
			ActivityOffset: Sequence.ActivityOffset,
			ActivityWeight: Sequence.ActivityWeight,
			AnimationOffset: Sequence.AnimationOffset,
			BlendCount: Sequence.BlendCount,
			EventCount: Sequence.EventCount,
			EventOffset: Sequence.EventOffset,
			Flags: Sequence.Flags,
			LabelOffset: Sequence.LabelOffset,
			MovementOffset: Sequence.MovementOffset,
			NodeFlags: Sequence.NodeFlags,
			AnimationIndex: Sequence.GetAnimationIndex(),
			HeaderAddress: Sequence.GetModelHeader().Address,
			Maximums: ReadSequenceVectorComponents(Sequence.Maximums),
			Minimums: ReadSequenceVectorComponents(Sequence.Minimums),
		};
	};

	let bOperationFailed = false;
	let OperationError;
	let Result = null;

	try {
		Result = ApplyTemporaryEdits();
	} catch (CaughtError) {
		bOperationFailed = true;
		OperationError = CaughtError;
	}

	const vecCleanupErrors = [];
	const vecUnconfirmedRestorations = [];
	for (const Restoration of vecRestorations) {
		try {
			Restoration.Apply();
		} catch (CleanupError) {
			vecCleanupErrors.push(CleanupError);
			vecUnconfirmedRestorations.push(Restoration.PropertyName);
		}
	}

	let bReferenceReleaseOutcomeUnknown = false;
	try {
		Release(hModelHandle);
	} catch (CleanupError) {
		bReferenceReleaseOutcomeUnknown = true;
		vecCleanupErrors.push(CleanupError);
	}

	if (vecCleanupErrors.length > 0) {
		const vecErrors = bOperationFailed ? [OperationError, ...vecCleanupErrors] : vecCleanupErrors;
		const Failure = new AggregateError(vecErrors, "Temporary studio edit cleanup requires investigation.");
		Failure.ModelHandle = hModelHandle;
		Failure.UnconfirmedRestorations = vecUnconfirmedRestorations;
		Failure.ReferenceReleaseOutcomeUnknown = bReferenceReleaseOutcomeUnknown;
		throw Failure;
	}

	if (bOperationFailed) {
		throw OperationError;
	}

	return Result;
}

module.exports = { TemporarilyAdjustFirstSequence };
```

## Attachments

An attachment exposes:

| Member | Type |
| --- | --- |
| `Address` | Exact borrowed `mstudioattachment_t` address as `bigint`. |
| `NameOffset`, `LocalBone` | Writable native integers. |
| `Name` | Read-only string or `null`. |
| `Flags` | Writable unsigned 32-bit integer. |
| `LocalTransform` | Live `matrix3x4_t`. |

```js
const {
	INVALID_ATTACHMENT_INDEX,
	INVALID_MODEL_HANDLE,
	FindModelHandle,
	Release,
	RequireModelHeader,
} = require("studio");

function ReadAttachmentMatrixComponents(vecMatrixRows) {
	const vecRows = [];
	for (let unRowIndex = 0; unRowIndex < vecMatrixRows.length; unRowIndex += 1) {
		const vecRow = vecMatrixRows[unRowIndex];
		const vecComponents = [];
		for (let unComponentIndex = 0; unComponentIndex < vecRow.length; unComponentIndex += 1) {
			vecComponents.push(vecRow[unComponentIndex]);
		}

		vecRows.push(vecComponents);
	}

	return { Address: vecMatrixRows.Address, Rows: vecRows };
}

function TemporarilyOffsetNamedAttachment(strModelPath, flOffset = 0.5) {
	if ((typeof flOffset !== "number") || !Number.isFinite(flOffset)) {
		throw new TypeError("flOffset must be a finite number.");
	}

	const hModelHandle = FindModelHandle(strModelPath);
	if (hModelHandle === INVALID_MODEL_HANDLE) {
		throw new Error(`Model is unavailable: ${strModelPath}`);
	}

	const unTranslationComponentIndex = 3;

	const vecRestorations = [];
	const ApplyTemporaryEdits = () => {
		const Header = RequireModelHeader(hModelHandle);
		const vecAttachments = Header.Attachments();
		let nAttachmentIndex = INVALID_ATTACHMENT_INDEX;
		for (let unAttachmentScanIndex = 0; unAttachmentScanIndex < vecAttachments.length; unAttachmentScanIndex += 1) {
			const strAttachmentName = vecAttachments[unAttachmentScanIndex].Name;
			if ((typeof strAttachmentName === "string") && (strAttachmentName.length > 0)) {
				nAttachmentIndex = unAttachmentScanIndex;
				break;
			}
		}

		if (nAttachmentIndex === INVALID_ATTACHMENT_INDEX) {
			return null;
		}

		const Attachment = Header.GetAttachment(nAttachmentIndex);
		if (Attachment === null) {
			return null;
		}

		const vecMatrixRows = Attachment.LocalTransform;
		const vecMatrixRow = vecMatrixRows[0];
		const flOriginalX = vecMatrixRow[unTranslationComponentIndex];
		vecRestorations.push({
			PropertyName: "LocalTransform[0][3]",
			Apply() {
				vecMatrixRow[unTranslationComponentIndex] = flOriginalX;
			},
		});
		vecMatrixRow[unTranslationComponentIndex] = flOriginalX + flOffset;

		return { LocalTransform: ReadAttachmentMatrixComponents(vecMatrixRows), LocalBone: Attachment.LocalBone, Address: Attachment.Address, Name: Attachment.Name, Flags: Attachment.Flags, NameOffset: Attachment.NameOffset };
	};

	let bOperationFailed = false;
	let OperationError;
	let Result = null;

	try {
		Result = ApplyTemporaryEdits();
	} catch (CaughtError) {
		bOperationFailed = true;
		OperationError = CaughtError;
	}

	const vecCleanupErrors = [];
	const vecUnconfirmedRestorations = [];
	for (const Restoration of vecRestorations) {
		try {
			Restoration.Apply();
		} catch (CleanupError) {
			vecCleanupErrors.push(CleanupError);
			vecUnconfirmedRestorations.push(Restoration.PropertyName);
		}
	}

	let bReferenceReleaseOutcomeUnknown = false;
	try {
		Release(hModelHandle);
	} catch (CleanupError) {
		bReferenceReleaseOutcomeUnknown = true;
		vecCleanupErrors.push(CleanupError);
	}

	if (vecCleanupErrors.length > 0) {
		const vecErrors = bOperationFailed ? [OperationError, ...vecCleanupErrors] : vecCleanupErrors;
		const Failure = new AggregateError(vecErrors, "Temporary studio edit cleanup requires investigation.");
		Failure.ModelHandle = hModelHandle;
		Failure.UnconfirmedRestorations = vecUnconfirmedRestorations;
		Failure.ReferenceReleaseOutcomeUnknown = bReferenceReleaseOutcomeUnknown;
		throw Failure;
	}

	if (bOperationFailed) {
		throw OperationError;
	}

	return Result;
}

module.exports = { TemporarilyOffsetNamedAttachment };
```

## Errors And Safety

- Model paths must be non-empty strings without embedded NUL bytes; validation precedes the native lookup.
- Handles must be unsigned integers representable by the selected SDK's `MDLHandle_t`; `INVALID_MODEL_HANDLE` is
  rejected by cache operations.
- Header, bone, controller, hitbox, sequence, and attachment indexes must be non-negative Int32 values. Out-of-range header
  lookups return `null`.
- Sequence blend-grid and bone-weight indexes throw when outside native ranges.
- `GetModelName()` throws when `IMDLCache` returns no name.
- `GetModelHeader(hModelHandle)` returns `null`, `GetModelHeaderAddress(hModelHandle)` returns `0n`, and `RequireModelHeader(hModelHandle)` throws when no
  header is loaded.
- Never call `Release()` more times than a handle was acquired.
- `FindModel()` and `FindModelHandle()` transfer acquired references only after publishing their result. A failed
  publication attempts one `Release`; cleanup failures are logged without replacing the original exception.
- Keep a cache reference while reading or writing any nested record.
- Restore each attempted temporary edit independently before releasing the reference; model headers, bones, hitboxes, sequences,
  and attachments are shared cache memory. The examples retain the original operation error plus every cleanup error in order,
  including falsy thrown values. `UnconfirmedRestorations` and `ReferenceReleaseOutcomeUnknown` report unknown outcomes,
  not safe retry instructions.
- Cache operations and live views require a live SDK cache on the game thread. A reference does not prevent explicit cache
  invalidation, model reload, map transitions or plugin unload; discard every borrowed view when invalidated.
- Do not write count, offset, parent, bone or index fields unless the complete selected-SDK layout invariant is known.
- Treat all addresses as borrowed native addresses, never JavaScript-owned allocations.
- Treat every `Address` as read-only identity metadata. Do not assign or forge it; address resolvers reject zero or
  type-misaligned values but cannot prove that an arbitrary address is live or readable.

## Related Modules

- [`studio/cache`](studio-cache.md) exposes only model-cache handles and header retrieval.
- [`studio/constants`](studio-constants.md) exposes only `ModelType`, `StudioFlags` and index sentinels.
- [`mathlib`](mathlib.md) provides owned and address-backed general-purpose math types; studio views are direct SDK
  records.
