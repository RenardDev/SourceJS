# `require("entities/entity")`

> Warning: this page documents both the focused entity factory module and every live method on the Entity objects it returns. Use the table of contents to jump to the relevant ownership boundary.

The `entities/entity` module lives in [the package facade](../../packages/sourcejs/entities/entity.js), which uses [the native bindings](../../src/sourcejs/modules/ModuleBindings.cpp). Use it when a plugin needs one entity by edict index without importing the root world-scan API. The returned object is native-backed and decorated in place; its getters resolve current engine state, while record-valued results are point-in-time JavaScript snapshots.

## Table of contents

- [Import and capabilities](#import-and-capabilities)
- [Exports](#exports)
- [Entity factory](#entity-factory)
- [Live fields](#live-fields)
- [Native lifecycle methods](#native-lifecycle-methods)
- [Reflection conveniences](#reflection-conveniences)
- [Inputs](#inputs)
- [Timers and sound](#timers-and-sound)
- [Models and hitboxes](#models-and-hitboxes)
- [Send-property methods](#send-property-methods)
- [Datamap methods](#datamap-methods)
- [Identity and safety](#identity-and-safety)
- [Common mistakes](#common-mistakes)

## Import and capabilities

`Entity` and the native `GetNativeEntityByIndex` factory are always present when the native `entities/entity` module is installed. `CallEntityInputFunction` requires the selected SDK's `CBaseEntity::AcceptInput`, while `GetEntityModelName` requires datamap support. Unsupported operations are omitted; SourceJS does not install a throw-only fallback.

```js
const {
	CallEntityInputFunction,
	Entity,
	GetEntityModelName,
	GetNativeEntityByIndex,
} = require("entities/entity");
const { LogInfo } = require("loggers");

const g_ReportEntityCapabilities = function ReportEntityCapabilities() {
	const nEntityIndex = 1;
	const DecoratedEntity = Entity(nEntityIndex);
	const NativeEntity = GetNativeEntityByIndex(nEntityIndex);
	if (!DecoratedEntity || !NativeEntity) {
		throw new Error("Expected entity 1 to exist.");
	}

	const EntityCapabilities = { CallEntityInputSupported: typeof CallEntityInputFunction === "function", DataMapsSupported: typeof GetEntityModelName === "function", SendPropertiesSupported: typeof DecoratedEntity.GetEntityProperty === "function", NativeClassName: NativeEntity.ClassName };
	LogInfo("ReportEntityCapabilities Result=%j", { EntityCapabilities, EntityIndex: DecoratedEntity.Index });
};

g_ReportEntityCapabilities();
```

Importing the module does not require an active map. Calling `Entity(nEntityIndex)` does require current global variables and an initialized edict list, so perform entity work on the server/game thread after the server has established map state. Returned wrappers borrow engine-owned state; they neither keep an entity alive nor reserve its index.

## Exports

| Export | Signature | Capability and result |
| --- | --- | --- |
| `Entity` | `Entity(nEntityIndex)` | Returns one decorated live Entity or `null` for an absent or free edict. |
| `CallEntityInputFunction` | `CallEntityInputFunction(EntityReference, strInputName, InputValue = undefined, flInputDelay = 0)` | Present only with `CBaseEntity::AcceptInput`; sends immediately or queues an engine input. |
| `GetNativeEntityByIndex` | `GetNativeEntityByIndex(nEntityIndex)` | Returns the undecorated native Entity wrapper or `null` for an absent or free edict. |
| `GetEntityModelName` | `GetEntityModelName(EntityReference)` | Present only with datamaps; reads the current `m_ModelName`. |

These are the exact package export names. The package does not export `entity`, `callInput`, `getModel`, or other lower-camel compatibility aliases.

The maximum selected-SDK surface therefore has four exports. A reduced SDK exposes `Entity`, `GetNativeEntityByIndex`, and only the optional operations it can implement directly.

## Entity factory

`Entity(nEntityIndex)` requires a primitive Number containing a signed 32-bit integer edict index. Omitted arguments, BigInt values, numeric strings, objects, fractions, and out-of-range Numbers throw. With initialized entity globals, negative or unavailable indexes and free edicts return `null`. A user ID or account ID is not an edict index even if its numeric representation passes validation.

```js
const { Entity } = require("entities/entity");
const { LogInfo } = require("loggers");

const g_InspectEntityFactory = function InspectEntityFactory() {
	const WorldEntity = Entity(0);
	if (!WorldEntity) {
		throw new Error("The world edict is not available yet.");
	}

	const CandidateEntity = Entity(2);
	if (!CandidateEntity) {
		throw new Error("Expected entity 2 to be occupied.");
	}

	const nOutOfRangeEntityIndex = 2_147_483_647;
	const MissingEntity = Entity(nOutOfRangeEntityIndex);
	if (MissingEntity !== null) {
		throw new Error("An out-of-range edict unexpectedly resolved.");
	}

	LogInfo("InspectEntityFactory Result=%j", { WorldAddress: `0x${WorldEntity.Address.toString(16).toUpperCase()}`, CandidateClassName: CandidateEntity.ClassName, WorldClassName: WorldEntity.ClassName });
};

g_InspectEntityFactory();
```

Every returned object receives SourceJS entity convenience methods. Native methods keep ownership of names they already define; decoration installs only missing methods.

Native lifecycle, send-property and datamap methods available in the selected SDK are initialized as own writable, enumerable, configurable data properties. Inherited setters and non-writable inherited properties cannot intercept or suppress these native methods during construction. This does not change package decoration, method availability or borrowed entity lifetime.

## Live fields

| Field | Access | Current engine value |
| --- | --- | --- |
| `Index` | read-only integer | Edict index captured by this wrapper. |
| `Valid` | read-only boolean | Whether that edict currently exists and is occupied. |
| `Free` | writable boolean | Current edict free flag. Writing it is dangerous. |
| `ClassName` | read-only string | Current engine class name, or `""` after invalidation. |
| `StateFlags` | writable integer | Current `edict_t::m_fStateFlags`. |
| `NetworkSerialNumber` | writable integer | Current edict serial number. Normally engine-owned. |
| `Edict` | read-only object or `null` | Point-in-time address record for the current `edict_t`. |
| `BaseEntity` | read-only object or `null` | Point-in-time address record for the current `CBaseEntity`. |
| `Address` | read-only `BigInt` | Native `CBaseEntity*` address, or `0n` when unavailable. |
| `BaseHandle` | read-only object or `null` | Point-in-time SDK handle record, not a live handle reference. |
| `HandleValue` | read-only integer | Packed handle value, or `-1` when unavailable. |

Only the PascalCase names in the table are installed. Lower-camel spellings are not live Entity fields.

Native wrapper creation stops if a live property cannot be installed. An existing JavaScript exception propagates unchanged; otherwise the binding reports `Failed to install Entity live properties.` No partially installed wrapper is returned.

Live reads resolve the edict on each access. If it is absent, `Index` remains the captured index, `Valid` is `false`, `Free` is `true`, `ClassName` is `""`, and the raw state/serial fields are `0`. An existing but free edict can still expose its raw state/serial fields. `Edict`, `BaseEntity`, and `BaseHandle` return `null` when unavailable; `Address` returns `0n`, and `HandleValue` returns `-1`. The three record getters create ordinary JavaScript objects on each read: saved records do not refresh, and changing them does not write native state. Returned native descriptors and addresses are borrowed snapshots, not ownership or proof that memory is mapped or still live. A C++ failure during a read or result construction becomes `Error("Entity property failed because a native C++ exception occurred.")`; an existing JavaScript exception is preserved.

Native writes resolve the edict before validating the supplied value; a missing target reports `Entity property target is unavailable.` first. `Free` requires a primitive boolean and calls the SDK's `SetFree()` or `ClearFree()`. `StateFlags` and `NetworkSerialNumber` require primitive signed 32-bit integers and assign the raw SDK fields, including negative values. Other live fields are read-only. The setter does not separately reject a free flag; availability still depends on engine lookup. A C++ failure becomes `Error("Entity property write failed because a native C++ exception occurred.")`, preserving an existing JavaScript exception. A write already performed is not rolled back and does not create ownership or a lifetime guarantee.

Read fields when needed and restore temporary writes. `StateFlags` writes require an `Int32`, so the saved value uses the signed-integer category even though the field contains flags. This example exercises all eleven fields without changing entity ownership:

```js
const { Entity } = require("entities/entity");
const { LogInfo } = require("loggers");

const g_ReportLiveEntityFields = function ReportLiveEntityFields() {
	const LiveEntity = Entity(2);
	if (!LiveEntity) {
		throw new Error("Expected entity 2 to be occupied.");
	}

	const nPreviousStateFlags = LiveEntity.StateFlags;
	const nEdictChangedStateFlag = 1; // Selected-SDK FL_EDICT_CHANGED bit.
	const nPreviousNetworkSerialNumber = LiveEntity.NetworkSerialNumber;

	try {
		LiveEntity.StateFlags = nPreviousStateFlags | nEdictChangedStateFlag;
		LiveEntity.NetworkSerialNumber = nPreviousNetworkSerialNumber;
		LogInfo("ReportLiveEntityFields Result=%j", {
			Free: LiveEntity.Free,
			Valid: LiveEntity.Valid,
			HandleValue: LiveEntity.HandleValue,
			HasBaseEntity: LiveEntity.BaseEntity !== null,
			HasBaseHandle: LiveEntity.BaseHandle !== null,
			HasEdict: LiveEntity.Edict !== null,
			Address: `0x${LiveEntity.Address.toString(16).toUpperCase()}`,
			ClassName: LiveEntity.ClassName,
			Index: LiveEntity.Index,
			NetworkSerialNumber: LiveEntity.NetworkSerialNumber,
			StateFlags: LiveEntity.StateFlags,
		});
	} finally {
		LiveEntity.NetworkSerialNumber = nPreviousNetworkSerialNumber;
		LiveEntity.StateFlags = nPreviousStateFlags;
	}
};

g_ReportLiveEntityFields();
```

Do not write `Free` in normal plugin logic. It is exposed as a real-time SDK field, but changing it bypasses the entity's normal removal lifecycle.

## Native lifecycle methods

Native Entity objects expose lifecycle methods according to selected-SDK capability:

| Method | Capability and result |
| --- | --- |
| `SlayEntity()` | Requires `CBaseEntity::AcceptInput`; attempts `SetHealth` with `"0"`, and only if that is rejected attempts `Kill`. Returns whether either input was accepted, not proof of death or removal. |
| `CallEntityInput(strInputName, InputValue = undefined, flInputDelay = 0)` | Requires `CBaseEntity::AcceptInput`; uses the same native implementation as the package's `CallEntityInputFunction` export. |
| `RemoveEntity()` | Removes the currently indexed occupied entity and returns the direct native result. |

Only the canonical PascalCase names for these native lifecycle methods are installed. The Entity object does not expose `slay`, `callInput`, or `remove` compatibility aliases.

These lifecycle callbacks and `CallEntityInputFunction()` translate native C++ exceptions into operation-specific JavaScript `Error` objects without replacing an existing JavaScript exception. This does not roll back native effects completed before the failure.

Use entities created specifically for the plugin when demonstrating destructive operations:

```js
const { CreateAndSpawnEntityByClassName } = require("entities/factories");
const { LogInfo } = require("loggers");

const g_ExerciseNativeLifecycleMethods = function ExerciseNativeLifecycleMethods() {
	const strTemporaryEntityClassName = "info_target";
	const SlainTemporaryEntity = CreateAndSpawnEntityByClassName(strTemporaryEntityClassName);
	if (!SlainTemporaryEntity) {
		throw new Error("The temporary entity for SlayEntity() was not created.");
	}

	try {
		if ((typeof SlainTemporaryEntity.CallEntityInput !== "function") || (typeof SlainTemporaryEntity.SlayEntity !== "function")) {
			throw new Error("The selected SDK does not expose the required native lifecycle methods.");
		}

		if (!SlainTemporaryEntity.CallEntityInput("AddOutput", "targetname sourcejs_entity_example")) {
			throw new Error("The temporary entity rejected AddOutput.");
		}

		if (!SlainTemporaryEntity.SlayEntity()) {
			throw new Error("The temporary entity rejected SlayEntity().");
		}
	} finally {
		if (SlainTemporaryEntity.Valid && !SlainTemporaryEntity.RemoveEntity()) {
			throw new Error("Unable to clean up the slain temporary entity.");
		}
	}

	const RemovedTemporaryEntity = CreateAndSpawnEntityByClassName(strTemporaryEntityClassName);
	if (!RemovedTemporaryEntity) {
		throw new Error("The temporary entity for RemoveEntity() was not created.");
	}

	if (!RemovedTemporaryEntity.RemoveEntity()) {
		throw new Error("Unable to remove the temporary entity.");
	}

	LogInfo("ExerciseNativeLifecycleMethods Result=%j", { Removed: !RemovedTemporaryEntity.Valid, Slain: !SlainTemporaryEntity.Valid });
};

g_ExerciseNativeLifecycleMethods();
```

Call `SlayEntity()` only on an entity class that implements the expected health or kill inputs. It is intended primarily for players and damageable entities, not arbitrary world objects.

## Reflection conveniences

Decoration adds these methods when their dependencies are available:

| Method | Result |
| --- | --- |
| `IsEntityNetworked()` | Whether a server class can be resolved. |
| `GetEntityServerClasses()` | Current server class followed by resolved base classes. |
| `GetEntityDynamicAttributes()` | One object containing `Inputs`, `KeyValues`, `Outputs`, `Properties`, and `ServerClasses`. |
| `GetEntityProperties()` | Current inherited send-property metadata. |
| `GetEntityInputs()` | Current datamap fields marked as inputs. |
| `GetEntityOutputs()` | Current datamap fields marked as outputs. |
| `GetEntityKeyValues()` | Current datamap fields marked as key fields. |
| `GetEntityInput(strInputName)` | Native input-function descriptor, or `null` for a missing/non-input field. Native lookup errors propagate. |
| `GetEntityOutput(strOutputName)` | Output field metadata or `null`. |

Only the PascalCase method names in the table are installed. The dynamic-attributes record likewise exposes only `Inputs`, `KeyValues`, `Outputs`, `Properties`, and `ServerClasses`; lower-camel compatibility aliases are not present.

The arrays and metadata records are point-in-time snapshots. Native addresses inside those records are borrowed, not live views or ownership; query again after engine metadata changes and never use an address after its native storage expires. This differs from the live Entity fields above:

```js
const { Entity } = require("entities/entity");
const { LogInfo } = require("loggers");

const g_GetEntityDataMapFieldName = function GetEntityDataMapFieldName(EntityDataMapField) {
	return EntityDataMapField.Name;
};

const g_GetServerClassName = function GetServerClassName(ServerClass) {
	return ServerClass.Name;
};

const g_GetServerClassPropertyName = function GetServerClassPropertyName(ServerClassProperty) {
	return ServerClassProperty.Name;
};

const g_ReportEntityReflection = function ReportEntityReflection() {
	const ReflectedEntity = Entity(2);
	if (!ReflectedEntity) {
		throw new Error("Expected entity 2 to be occupied.");
	}

	const vecRequiredMethodNames = [
		"GetEntityDynamicAttributes",
		"GetEntityInput",
		"GetEntityInputs",
		"GetEntityKeyValues",
		"GetEntityOutput",
		"GetEntityOutputs",
		"GetEntityProperties",
		"GetEntityServerClasses",
		"IsEntityNetworked",
	];
	for (const strMethodName of vecRequiredMethodNames) {
		if (typeof ReflectedEntity[strMethodName] !== "function") {
			throw new Error(`The selected SDK does not expose Entity.${strMethodName}().`);
		}
	}

	const EntityAttributes = ReflectedEntity.GetEntityDynamicAttributes();
	const vecEntityInputs = ReflectedEntity.GetEntityInputs();
	const vecEntityOutputs = ReflectedEntity.GetEntityOutputs();
	if ((vecEntityInputs.length === 0) || (vecEntityOutputs.length === 0)) {
		throw new Error("Entity 2 has no discoverable input/output pair.");
	}

	const EntityInput = ReflectedEntity.GetEntityInput(vecEntityInputs[0].Name);
	const EntityOutput = ReflectedEntity.GetEntityOutput(vecEntityOutputs[0].Name);
	if (!EntityInput || !EntityOutput) {
		throw new Error("The discovered input/output pair could not be resolved.");
	}

	LogInfo("ReportEntityReflection Result=%j", {
		Networked: ReflectedEntity.IsEntityNetworked(),
		Summary: {
			InputCount: EntityAttributes.Inputs.length,
			KeyValueCount: EntityAttributes.KeyValues.length,
			OutputCount: EntityAttributes.Outputs.length,
			PropertyCount: EntityAttributes.Properties.length,
			ServerClassCount: EntityAttributes.ServerClasses.length,
		},
		InputAddress: `0x${EntityInput.Address.toString(16).toUpperCase()}`,
		OutputName: EntityOutput.Name,
		KeyValueNames: ReflectedEntity.GetEntityKeyValues().map(g_GetEntityDataMapFieldName),
		PropertyNames: ReflectedEntity.GetEntityProperties().map(g_GetServerClassPropertyName),
		ServerClassNames: ReflectedEntity.GetEntityServerClasses().map(g_GetServerClassName),
	});
};

g_ReportEntityReflection();
```

Names and fields differ by game branch and entity class. Discover them from the current server rather than copying a path from another SDK.

## Inputs

### Accepted values

Both input entry points require a non-empty string `strInputName`. `InputValue` maps directly to `variant_t` and may be:

- omitted, `undefined`, or `null` for an empty variant;
- a boolean;
- a JavaScript `Int32`;
- another finite Number in the native `float` range, stored as a float;
- a string.

Objects, arrays, symbols, BigInt values, `NaN`, infinities, and Numbers outside the native `float` range are rejected instead of being stringified. Omitted, `undefined`, or `null` delays use `0`; other `flInputDelay` values must be primitive finite Numbers in the native `float` range.

String values use the SDK's null-terminated UTF-8 contract: an embedded null terminates the native value. They are inserted into the game's string pool on the game thread, not borrowed from temporary JavaScript conversion storage. Native input handlers may retain the resulting string until level shutdown. Non-empty native strings require a valid world entity and a validated SDK name field; allocation failure throws without dispatching the input. The world entity's original name is restored after insertion.

```js
const { GetEntitiesByClassName } = require("entities");
const { CallEntityInputFunction } = require("entities/entity");

const g_ExerciseEntityInputs = function ExerciseEntityInputs() {
	const [RelayEntity] = GetEntitiesByClassName("logic_relay");
	if (!RelayEntity || (typeof CallEntityInputFunction !== "function")) {
		throw new Error("This SDK or map does not expose a logic_relay with engine inputs.");
	}

	if (!CallEntityInputFunction(RelayEntity, "Enable")) {
		throw new Error("The logic_relay rejected Enable.");
	}

	if (!CallEntityInputFunction(RelayEntity.Index, "AddOutput", "targetname sourcejs_relay")) {
		throw new Error("The logic_relay rejected AddOutput.");
	}

	if (!RelayEntity.CallEntityInputFunction("Toggle")) {
		throw new Error("The logic_relay rejected Toggle.");
	}
};

g_ExerciseEntityInputs();
```

The entity argument may be an integer Number in the native `int` range or an object whose `Index` property is such a Number. The object must still resolve to an occupied entity when the native call runs; a lower-camel `index` property is not inspected.

### Immediate and delayed execution

When `flInputDelay <= 0` or engine global variables are unavailable, SourceJS calls `AcceptInput` immediately and returns its boolean result. A positive delay with global variables available queues the input for `curtime + flInputDelay` and returns `true` after queueing. An invalid entity handle or a fire time outside the finite native `float` range returns `false` without queueing.

```js
const { CallEntityInputFunction, Entity } = require("entities/entity");
const { LogInfo } = require("loggers");

const g_ExerciseImmediateAndDelayedInputs = function ExerciseImmediateAndDelayedInputs() {
	const DoorEntity = Entity(4);
	if (!DoorEntity || (typeof CallEntityInputFunction !== "function")) {
		throw new Error("The selected server does not expose entity inputs.");
	}

	const bOpenedNow = CallEntityInputFunction(DoorEntity, "Open");
	const bQueuedClose = DoorEntity.CallEntityInputFunction("Close", undefined, 2.5);
	if (!bOpenedNow || !bQueuedClose) {
		throw new Error("The door rejected an immediate or delayed input.");
	}

	LogInfo("ExerciseImmediateAndDelayedInputs Result=%j", { OpenedNow: bOpenedNow, QueuedClose: bQueuedClose });
};

g_ExerciseImmediateAndDelayedInputs();
```

The SourceJS delayed queue stores the entity index and its full native handle, including the serial number. Removed entities and reused indices are skipped at dispatch. Queued inputs are discarded at level shutdown, even while paused, and when SourceJS unloads; inputs scheduled by shutdown listeners are also discarded. This queue is separate from `listeners/tick` and is not canceled by `EntityInstance.CancelEntityTimers()`. Each pump considers only entries queued before it began. Inputs queued by a handler wait for a later pump, even when a positive delay rounds to the current 32-bit game time. Clearing the queue cancels its old pending entries; newly queued entries still wait for a later pump. Nonpositive delays and the missing-global-variables fallback remain immediate.

## Timers and sound

Decoration adds plugin-runtime conveniences independent of engine-input queue ownership:

| Method | Result |
| --- | --- |
| `DelayEntityCallback(flDelaySeconds, Callback, vecCallbackArguments = [], DelayOptions = {})` | Creates and tracks a `listeners/tick.TickDelay`. |
| `RepeatEntityCallback(Callback, vecCallbackArguments = [], RepeatOptions = {})` | Creates a stopped, tracked `listeners/tick.RepeatingTickTask`; call `StartRepeat()` explicitly. |
| `CancelEntityTimers()` | Cancels tracked Delay and Repeat objects for this entity index. |
| `EmitEntitySound(strSoundSample, SoundOptions = {})` | Creates, plays, and returns a `Sound` or `StreamSound`. |

`Callback` must be a function and is validated before timer creation. Repeats remain cancellable after stop/start or restart, including cancellation from an immediate callback. Direct tick-task methods share the same tracking; stopping, natural completion, and `CancelOnLevelEnd` cancellation release it. See the [entity timer lifecycle](entities.md#timers) for failure behavior.

Only the PascalCase method names in the table are installed. Timer options use the public `CancelOnLevelEnd` boolean; lower-camel `cancelOnLevelEnd` is not inspected. Sound options use their documented PascalCase fields, and the helper does not install lower-camel `stream`, `recipients`, or `volume` aliases.

```js
const { Entity } = require("entities/entity");
const { LogInfo } = require("loggers");

const g_CallEntityInputIfIdentityMatches = function CallEntityInputIfIdentityMatches(nExpectedHandleValue, strInputName) {
	if (!this.Valid || (this.HandleValue !== nExpectedHandleValue)) {
		return;
	}

	if (!this.CallEntityInput(strInputName)) {
		throw new Error(`Entity ${this.Index} rejected ${strInputName}.`);
	}
};

const g_ExerciseEntityTimersAndSound = function ExerciseEntityTimersAndSound() {
	const EntityInstance = Entity(2);
	if (!EntityInstance) {
		throw new Error("Expected entity 2 to be occupied.");
	}

	if (typeof EntityInstance.CallEntityInput !== "function") {
		throw new Error("The selected SDK does not expose CBaseEntity::AcceptInput.");
	}

	const nExpectedHandleValue = EntityInstance.HandleValue;
	if (nExpectedHandleValue === -1) {
		throw new Error("The entity has no valid native handle for scheduling.");
	}

	let Sound = null;

	try {
		const Delay = EntityInstance.DelayEntityCallback(0.25, g_CallEntityInputIfIdentityMatches, [nExpectedHandleValue, "Enable"], { CancelOnLevelEnd: true });
		const Repeat = EntityInstance.RepeatEntityCallback(g_CallEntityInputIfIdentityMatches, [nExpectedHandleValue, "Toggle"], { CancelOnLevelEnd: true });
		if (!Repeat.StartRepeat(1, 3, false)) {
			throw new Error("Unable to start the entity repeat.");
		}

		Sound = EntityInstance.EmitEntitySound("buttons/button17.wav", { Recipients: [1], Volume: 0.7 });
		LogInfo("ExerciseEntityTimersAndSound Result=%j", { DelayRunning: Delay.Running, SoundEntityIndex: Sound.Entity });
	} finally {
		const bTimersCanceled = EntityInstance.CancelEntityTimers();
		const bSoundStopped = !Sound || Sound.StopSound();
		if (!bTimersCanceled || !bSoundStopped) {
			throw new Error("Unable to clean up the entity timers or sound.");
		}
	}
};

g_ExerciseEntityTimersAndSound();
```

Set `SoundOptions.Stream = true` to construct `StreamSound`; otherwise `Sound` is used. The helper does not inspect `SoundOptions.stream`. Resource precaching and download ownership remain the caller's responsibility.

## Models and hitboxes

For the current world-space transform of a particular entity, use [entities/animation](entities-animation.md). This section describes the shared studio model data.

When `GetEntityModelName` is present, decoration also installs:

| API | Result |
| --- | --- |
| module `GetEntityModelName(EntityReference)` | Reads the current datamap `m_ModelName`. |
| Entity `GetEntityModelName()` | Calls the same operation for this entity. |
| Entity `GetEntityModelHeader()` | Returns a borrowed live model header and releases the temporary `FindModelHandle()` reference; another engine/cache owner must keep the model retained. |
| Entity `GetEntityHitbox(unHitboxIndex, unHitboxSet = 0)` | Returns one borrowed live studio hitbox view, or `null` for an absent hitbox/set; model lookup failures throw. |

Only the PascalCase Entity method names in the table are installed; `getModel`, `getModelHeader`, and `getHitbox` are not compatibility aliases.

Model headers and hitbox views borrow retained model-cache storage. Model-header lookup throws when releasing its temporary reference leaves no cache owner. The example below temporarily changes shared model bounds: use a controlled test model on the game thread and restore the bounds before other entity work. Validate both saved bounds before the first write: native float reads can contain non-finite values that the setters reject, so those values cannot be restored through the public API.

```js
const { Entity, GetEntityModelName } = require("entities/entity");
const { LogInfo } = require("loggers");

const g_InspectEntityModelAndHitbox = function InspectEntityModelAndHitbox() {
	const ModelEntity = Entity(2);
	if (!ModelEntity || (typeof GetEntityModelName !== "function")) {
		throw new Error("The selected SDK does not expose datamap model lookup.");
	}

	const strModelPath = GetEntityModelName(ModelEntity);
	const ModelHeader = ModelEntity.GetEntityModelHeader();
	const Hitbox = ModelEntity.GetEntityHitbox(0);
	if (!Hitbox) {
		throw new Error("The selected entity model has no hitbox at index 0.");
	}

	const flHitboxExpansion = 1;
	const flPreviousMinimumX = Hitbox.Mins.X;
	const flPreviousMaximumX = Hitbox.Maxs.X;
	if (!Number.isFinite(flPreviousMinimumX) || !Number.isFinite(flPreviousMaximumX)) {
		throw new Error("The selected hitbox has non-finite X bounds that cannot be restored.");
	}

	try {
		Hitbox.Mins.X = flPreviousMinimumX - flHitboxExpansion;
		Hitbox.Maxs.X = flPreviousMaximumX + flHitboxExpansion;
		LogInfo("InspectEntityModelAndHitbox Result=%j", { HitboxAddress: `0x${Hitbox.Address.toString(16).toUpperCase()}`, ModelHeaderAddress: `0x${ModelHeader.Address.toString(16).toUpperCase()}`, ModelPath: strModelPath, ObjectModelPath: ModelEntity.GetEntityModelName() });
	} finally {
		Hitbox.Maxs.X = flPreviousMaximumX;
		Hitbox.Mins.X = flPreviousMinimumX;
	}
};

g_InspectEntityModelAndHitbox();
```

Studio data is shared by every entity using the same model. A hitbox write affects all of them and reaches engine memory immediately. Coordinate changes with other plugins and restore temporary edits.

## Send-property methods

When the selected SDK exposes send properties, each native Entity has all of these direct methods:

- `GetEntityProperty(PropertyReference, strPropertyType?)` and `SetEntityProperty(PropertyReference, PropertyValue, strPropertyType?)`;
- `GetEntityPropertyInteger(PropertyReference)` and `SetEntityPropertyInteger(PropertyReference, nPropertyValue)`;
- `GetEntityPropertyFloat(PropertyReference)` and `SetEntityPropertyFloat(PropertyReference, flPropertyValue)`;
- `GetEntityPropertyString(PropertyReference)` and `SetEntityPropertyString(PropertyReference, strPropertyValue)`;
- `GetEntityPropertyVector(PropertyReference)` and `SetEntityPropertyVector(PropertyReference, VectorValue)`;
- `GetEntityPropertyEntity(PropertyReference)` and `SetEntityPropertyEntity(PropertyReference, EntityReference)`.

Only the PascalCase method names above are installed. Vector value objects expose and accept only `X`, `Y`, and `Z`; lower-camel method names and component aliases are not present.

`PropertyReference` accepts a supported send-property path, an integer byte offset, or an object with an integer `Offset`, including a reflected `SendProp` record. Numeric offsets and offset objects bypass metadata/class validation; generic operations default to signed 32-bit integer storage unless `strPropertyType` is supplied. The reference and type must match the live entity and selected SDK; a numeric offset can access unrelated engine memory, so prefer discovered paths or metadata. Structured values are live write-through views:

```js
const { Entity } = require("entities/entity");
const { LogInfo } = require("loggers");

const g_ExerciseEntitySendProperties = function ExerciseEntitySendProperties() {
	const PlayerEntity = Entity(1);
	if (!PlayerEntity || (typeof PlayerEntity.GetEntityProperty !== "function")) {
		throw new Error("The selected SDK does not expose Entity send properties.");
	}

	const strHealthPath = "m_iHealth";
	const strOriginPath = "m_vecOrigin";
	const strModelPath = "m_ModelName";
	const strOwnerPath = "m_hOwnerEntity";
	const strSpeedPath = "m_flLaggedMovementValue";
	const nPreviousHealth = PlayerEntity.GetEntityPropertyInteger(strHealthPath);
	const Origin = PlayerEntity.GetEntityPropertyVector(strOriginPath);
	const PreviousOrigin = { X: Origin.X, Y: Origin.Y, Z: Origin.Z };
	const strPreviousModel = PlayerEntity.GetEntityPropertyString(strModelPath);
	const PreviousOwner = PlayerEntity.GetEntityPropertyEntity(strOwnerPath);
	const flPreviousSpeed = PlayerEntity.GetEntityPropertyFloat(strSpeedPath);
	const nExampleHealth = 100;
	const nAlternateHealth = 99;
	const nTemporaryHealth = (nPreviousHealth === nExampleHealth) ? nAlternateHealth : nExampleHealth;
	const flOriginDisplacement = 1;
	const flTemporaryOriginX = Math.fround(PreviousOrigin.X + flOriginDisplacement);
	const strWriteErrorMessage = "One or more Entity send-property writes failed.";
	if (!Number.isFinite(flPreviousSpeed) || !Number.isFinite(PreviousOrigin.X) || !Number.isFinite(PreviousOrigin.Y) || !Number.isFinite(PreviousOrigin.Z)) {
		throw new Error("The selected send properties contain non-finite values that cannot be restored.");
	}

	try {
		if (!PlayerEntity.SetEntityProperty(strHealthPath, nTemporaryHealth, "int")) {
			throw new Error(strWriteErrorMessage);
		}

		if (!PlayerEntity.SetEntityPropertyInteger(strHealthPath, nTemporaryHealth)) {
			throw new Error(strWriteErrorMessage);
		}

		if (!PlayerEntity.SetEntityPropertyFloat(strSpeedPath, flPreviousSpeed)) {
			throw new Error(strWriteErrorMessage);
		}

		if (!PlayerEntity.SetEntityPropertyString(strModelPath, strPreviousModel)) {
			throw new Error(strWriteErrorMessage);
		}

		if (!PlayerEntity.SetEntityPropertyVector(strOriginPath, PreviousOrigin)) {
			throw new Error(strWriteErrorMessage);
		}

		if (!PlayerEntity.SetEntityPropertyEntity(strOwnerPath, PreviousOwner)) {
			throw new Error(strWriteErrorMessage);
		}

		Origin.X = flTemporaryOriginX;
		if ((PlayerEntity.GetEntityPropertyInteger(strHealthPath) !== nTemporaryHealth) || (PlayerEntity.GetEntityPropertyVector(strOriginPath).X !== flTemporaryOriginX)) {
			throw new Error("Entity send-property writes were not visible in native memory.");
		}

		const CurrentOrigin = PlayerEntity.GetEntityPropertyVector(strOriginPath);
		const CurrentOwner = PlayerEntity.GetEntityPropertyEntity(strOwnerPath);
		LogInfo("ExerciseEntitySendProperties Result=%j", {
			Speed: PlayerEntity.GetEntityPropertyFloat(strSpeedPath),
			GenericHealth: PlayerEntity.GetEntityProperty(strHealthPath, "int"),
			Health: PlayerEntity.GetEntityPropertyInteger(strHealthPath),
			Origin: { X: CurrentOrigin.X, Y: CurrentOrigin.Y, Z: CurrentOrigin.Z },
			OwnerIndex: CurrentOwner ? CurrentOwner.Index : null,
			Model: PlayerEntity.GetEntityPropertyString(strModelPath),
		});
	} finally {
		const bOriginRestored = PlayerEntity.SetEntityPropertyVector(strOriginPath, PreviousOrigin);
		const bOwnerRestored = PlayerEntity.SetEntityPropertyEntity(strOwnerPath, PreviousOwner);
		const bModelRestored = PlayerEntity.SetEntityPropertyString(strModelPath, strPreviousModel);
		const bSpeedRestored = PlayerEntity.SetEntityPropertyFloat(strSpeedPath, flPreviousSpeed);
		const bHealthRestored = PlayerEntity.SetEntityPropertyInteger(strHealthPath, nPreviousHealth);
		if (!bOriginRestored || !bOwnerRestored || !bModelRestored || !bSpeedRestored || !bHealthRestored) {
			throw new Error("Unable to restore one or more Entity send properties.");
		}
	}
};

g_ExerciseEntitySendProperties();
```

Paths above are representative and may differ or be absent in another branch. Discover actual paths through `EntityInstance.GetEntityProperties()` and [`entities/classes`](entities-classes.md). Native float and vector-component storage uses single precision; round planned values with `Math.fround()` before comparing readback with a JavaScript Number. Reject non-finite saved scalar or vector components before any write: getters can return them, but setters cannot restore them. Keep the entity and borrowed property views valid throughout this synchronous game-thread scope; restoration is not a transaction or a lifetime guarantee.

## Datamap methods

When datamaps are supported, each native Entity also has:

- `GetEntityDataMap()`;
- `GetEntityDataMapProperty(PropertyReference, strPropertyType?)` and `SetEntityDataMapProperty(PropertyReference, PropertyValue, strPropertyType?)`;
- `GetEntityDataMapPropertyInteger(PropertyReference)` and `SetEntityDataMapPropertyInteger(PropertyReference, nPropertyValue)`;
- `GetEntityDataMapPropertyFloat(PropertyReference)` and `SetEntityDataMapPropertyFloat(PropertyReference, flPropertyValue)`;
- `GetEntityDataMapPropertyString(PropertyReference)` and `SetEntityDataMapPropertyString(PropertyReference, strPropertyValue)`;
- `GetEntityDataMapPropertyVector(PropertyReference)` and `SetEntityDataMapPropertyVector(PropertyReference, VectorValue)`;
- `GetEntityDataMapPropertyEntity(PropertyReference)` and `SetEntityDataMapPropertyEntity(PropertyReference, EntityReference)`.

Only the PascalCase method names above are installed. Vector values expose and accept only `X`, `Y`, and `Z`; lower-camel method names and component aliases are not present.

`PropertyReference` accepts a field path/name, a non-negative byte-offset Number in the native `int` range, or a metadata object. An integer `Offset` takes precedence; otherwise the resolver reads the first string among `Path`, `Name`, and `ExternalName`. Offset selectors bypass field/type discovery and can address unrelated entity memory, so prefer discovered names or metadata appropriate to the current entity and SDK.

Use fields discovered from the current datamap and restore any engine-owned state:

```js
const { GetEntitiesByClassName } = require("entities");
const { LogInfo } = require("loggers");

const g_ExerciseEntityDataMapProperties = function ExerciseEntityDataMapProperties() {
	const [RelayEntity] = GetEntitiesByClassName("logic_relay");
	if (!RelayEntity || (typeof RelayEntity.GetEntityDataMap !== "function")) {
		throw new Error("The selected SDK or map does not expose a logic_relay with datamaps.");
	}

	const EntityDataMap = RelayEntity.GetEntityDataMap();
	if (!EntityDataMap) {
		throw new Error("The logic_relay has no datamap.");
	}

	const strDelayPath = "m_flDelay";
	const strModelPath = "m_ModelName";
	const strOriginPath = "m_vecAbsOrigin";
	const strOwnerPath = "m_hOwnerEntity";
	const strSpawnFlagsPath = "m_spawnflags";
	const flPreviousDelay = RelayEntity.GetEntityDataMapPropertyFloat(strDelayPath);
	const strPreviousModel = RelayEntity.GetEntityDataMapPropertyString(strModelPath);
	const Origin = RelayEntity.GetEntityDataMapPropertyVector(strOriginPath);
	const PreviousOrigin = { X: Origin.X, Y: Origin.Y, Z: Origin.Z };
	const PreviousOwner = RelayEntity.GetEntityDataMapPropertyEntity(strOwnerPath);
	const nPreviousSpawnFlags = RelayEntity.GetEntityDataMapPropertyInteger(strSpawnFlagsPath);
	const flDelayIncrement = 0.25;
	const flTemporaryDelay = Math.fround(flPreviousDelay + flDelayIncrement);
	const flOriginDisplacement = 1;
	const flTemporaryOriginX = Math.fround(PreviousOrigin.X + flOriginDisplacement);
	const strWriteErrorMessage = "One or more Entity datamap writes failed.";
	if (!Number.isFinite(flPreviousDelay) || !Number.isFinite(PreviousOrigin.X) || !Number.isFinite(PreviousOrigin.Y) || !Number.isFinite(PreviousOrigin.Z)) {
		throw new Error("The selected datamap properties contain non-finite values that cannot be restored.");
	}

	try {
		if (!RelayEntity.SetEntityDataMapProperty(strDelayPath, flTemporaryDelay, "float")) {
			throw new Error(strWriteErrorMessage);
		}

		if (!RelayEntity.SetEntityDataMapPropertyFloat(strDelayPath, flTemporaryDelay)) {
			throw new Error(strWriteErrorMessage);
		}

		if (!RelayEntity.SetEntityDataMapPropertyString(strModelPath, strPreviousModel)) {
			throw new Error(strWriteErrorMessage);
		}

		if (!RelayEntity.SetEntityDataMapPropertyVector(strOriginPath, PreviousOrigin)) {
			throw new Error(strWriteErrorMessage);
		}

		if (!RelayEntity.SetEntityDataMapPropertyEntity(strOwnerPath, PreviousOwner)) {
			throw new Error(strWriteErrorMessage);
		}

		if (!RelayEntity.SetEntityDataMapPropertyInteger(strSpawnFlagsPath, nPreviousSpawnFlags)) {
			throw new Error(strWriteErrorMessage);
		}

		Origin.X = flTemporaryOriginX;
		if ((RelayEntity.GetEntityDataMapPropertyFloat(strDelayPath) !== flTemporaryDelay) || (RelayEntity.GetEntityDataMapPropertyVector(strOriginPath).X !== flTemporaryOriginX)) {
			throw new Error("Entity datamap writes were not visible in native memory.");
		}

		const CurrentOrigin = RelayEntity.GetEntityDataMapPropertyVector(strOriginPath);
		const CurrentOwner = RelayEntity.GetEntityDataMapPropertyEntity(strOwnerPath);
		LogInfo("ExerciseEntityDataMapProperties Result=%j", {
			Delay: RelayEntity.GetEntityDataMapProperty(strDelayPath, "float"),
			SpawnFlags: RelayEntity.GetEntityDataMapPropertyInteger(strSpawnFlagsPath),
			Origin: { X: CurrentOrigin.X, Y: CurrentOrigin.Y, Z: CurrentOrigin.Z },
			OwnerIndex: CurrentOwner ? CurrentOwner.Index : null,
			ClassName: EntityDataMap.ClassName,
			Model: RelayEntity.GetEntityDataMapPropertyString(strModelPath),
		});
	} finally {
		const bOriginRestored = RelayEntity.SetEntityDataMapPropertyVector(strOriginPath, PreviousOrigin);
		const bOwnerRestored = RelayEntity.SetEntityDataMapPropertyEntity(strOwnerPath, PreviousOwner);
		const bModelRestored = RelayEntity.SetEntityDataMapPropertyString(strModelPath, strPreviousModel);
		const bDelayRestored = RelayEntity.SetEntityDataMapPropertyFloat(strDelayPath, flPreviousDelay);
		const bSpawnFlagsRestored = RelayEntity.SetEntityDataMapPropertyInteger(strSpawnFlagsPath, nPreviousSpawnFlags);
		if (!bOriginRestored || !bOwnerRestored || !bModelRestored || !bDelayRestored || !bSpawnFlagsRestored) {
			throw new Error("Unable to restore one or more Entity datamap values.");
		}
	}
};

g_ExerciseEntityDataMapProperties();
```

See [`entities/datamaps`](entities-datamaps.md) for field discovery, variants, intervals, input-function addresses and every typed datamap operation. Float fields and vector components also use single precision here; compute expected readback with `Math.fround()` as shown. Validate all saved float values before writing any field, and keep the entity and its borrowed views valid until restoration finishes. Non-finite native values cannot be restored through the finite-value setters, and `finally` cannot roll back other engine effects or preserve entity lifetime.

## Identity and safety

An Entity wrapper keeps an edict index, not permanent identity. The engine can remove an entity and reuse that index for another class. Before delayed work, compare a full handle or serial captured at scheduling time. `-1` is the unavailable-handle sentinel; other negative packed handles can be valid. These comparisons do not retain the entity or protect it across reentrant engine callbacks:

```js
const { Entity } = require("entities/entity");

const g_UpdateEntityIfIdentityMatches = function UpdateEntityIfIdentityMatches(nEntityIndex, nExpectedHandleValue, nExpectedSerialNumber) {
	const CurrentEntity = Entity(nEntityIndex);
	if (!CurrentEntity || (CurrentEntity.HandleValue !== nExpectedHandleValue) || (CurrentEntity.NetworkSerialNumber !== nExpectedSerialNumber)) {
		return;
	}

	if (!CurrentEntity.CallEntityInputFunction("Enable")) {
		throw new Error(`Entity ${CurrentEntity.Index} rejected Enable.`);
	}
};

const g_ScheduleIdentityCheckedUpdate = function ScheduleIdentityCheckedUpdate() {
	const EntityInstance = Entity(2);
	if (!EntityInstance) {
		throw new Error("Expected entity 2 to be occupied.");
	}

	if (typeof EntityInstance.CallEntityInputFunction !== "function") {
		throw new Error("The selected SDK does not expose CBaseEntity::AcceptInput.");
	}

	const nExpectedHandleValue = EntityInstance.HandleValue;
	if (nExpectedHandleValue === -1) {
		throw new Error("The entity has no valid native handle for scheduling.");
	}

	const vecEntityIdentityCallbackArguments = [EntityInstance.Index, nExpectedHandleValue, EntityInstance.NetworkSerialNumber];
	EntityInstance.DelayEntityCallback(1, g_UpdateEntityIfIdentityMatches, vecEntityIdentityCallbackArguments);
};

g_ScheduleIdentityCheckedUpdate();
```

This check also avoids mutating an unrelated entity after index reuse. Map transitions invalidate every retained entity, property view, datamap view, model header and hitbox view.

## Common mistakes

- Passing a player user ID, Steam account ID, numeric string, or object to `Entity(nEntityIndex)`.
- Assuming `CallEntityInputFunction` or `GetEntityModelName` exists on every SDK instead of checking the selected capability.
- Passing arbitrary objects as input values and expecting JavaScript string coercion.
- Expecting `CancelEntityTimers()` to remove positive-delay engine inputs queued by `CallEntityInputFunction()`.
- Treating `Address` as a Number or string; public addresses are JavaScript `BigInt` values (`0n` when unavailable).
- Keeping an Entity across a map transition or assuming an edict index cannot be reused.
- Writing `Free`, serials, send properties, datamaps, or studio hitboxes without restoring temporary state.
- Copying property/datamap paths from another game rather than discovering current metadata.
- Calling `SlayEntity()` or `RemoveEntity()` on an entity not owned by the plugin without an explicit lifecycle decision.
