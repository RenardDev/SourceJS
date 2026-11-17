# `require("entities/collisions")`

> Warning: this page documents live entity collision state. Use the table of contents to navigate directly to constant groups, scalar state, bounds, or `CollisionRules`.

The [`entities/collisions` package](../../packages/sourcejs/entities/collisions.js) extends the native module in [`ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp) and reads and writes the selected SDK's collision sendprops. It exposes collision groups, solid types, solid flags, live bounding vectors, and one entity-bound convenience class.

The native module is omitted when the selected SDK does not expose sendprops; requiring the package then throws because its native module is not installed. Package initialization also requires the three constant getters, installed only with `SOURCEJS_HAS_CONST_H`: without them, loading fails rather than providing a partial module. SourceJS does not install a JavaScript fallback. A map must be running before an ordinary entity index can be resolved.

## Table of contents

- [Module contract](#module-contract)
- [Constant groups](#constant-groups)
- [Inspecting collision state](#inspecting-collision-state)
- [Collision groups](#collision-groups)
- [Solid types and flags](#solid-types-and-flags)
- [Collision enabled state](#collision-enabled-state)
- [Live bounds](#live-bounds)
- [CollisionRules](#collisionrules)
- [Lifecycle and common mistakes](#lifecycle-and-common-mistakes)
- [Export reference](#export-reference)

## Module contract

When package initialization succeeds, the complete module has exactly 24 exports:

```js
const g_Collisions = require("entities/collisions");
const { LogInfo } = require("loggers");

const g_vecExpectedExports = [
	"GetCollisionGroupConstants",
	"GetSolidFlagConstants",
	"GetSolidTypeConstants",
	"AddEntitySolidFlags",
	"CollisionGroup",
	"CollisionRules",
	"GetEntityCollisionBounds",
	"GetEntityCollisionGroup",
	"GetEntityCollisionMaximums",
	"GetEntityCollisionMinimums",
	"GetEntitySolidFlags",
	"GetEntitySolidType",
	"HasEntitySolidFlags",
	"IsEntityCollisionEnabled",
	"RemoveEntitySolidFlags",
	"SetEntityCollisionBounds",
	"SetEntityCollisionEnabled",
	"SetEntityCollisionGroup",
	"SetEntityCollisionMaximums",
	"SetEntityCollisionMinimums",
	"SetEntitySolidFlags",
	"SetEntitySolidType",
	"SolidFlags",
	"SolidType",
];
const g_vecActualExports = Object.keys(g_Collisions).sort();
if (g_vecActualExports.length !== g_vecExpectedExports.length) {
	throw new Error(`Unexpected entities/collisions export count: ${g_vecActualExports.length}.`);
}

g_vecExpectedExports.sort();
for (let unExportIndex = 0; unExportIndex < g_vecExpectedExports.length; ++unExportIndex) {
	if (g_vecActualExports[unExportIndex] !== g_vecExpectedExports[unExportIndex]) {
		throw new Error(`Unexpected entities/collisions export at index ${unExportIndex}: ${g_vecActualExports[unExportIndex]}.`);
	}
}

LogInfo("%j", { Operation: "InspectCollisionExports", ExportCount: g_vecActualExports.length, Exports: g_vecActualExports });
```

The whole-object import is intentional only for this exact export-surface audit. Operational examples below import the functions and constants they use directly.

Each entity API accepts an `EntityReference` in one of these forms: a signed-32-bit integer JavaScript `Number` entity index, an object whose `Index` is a signed-32-bit integer `Number`, or a non-negative `BigInt` containing an edict/`CBaseEntity` address that fits `uintptr_t`. `Number` values are never interpreted as raw addresses. Prefer current native Entity objects obtained through `entities/entity`, `entities`, or an entity iterator. A numeric index and its range do not establish that a valid live entity exists. Never supply fabricated or stale addresses. A removed entity or reused index must be resolved again before another operation; an existing wrapper does not preserve the old entity's identity.

The scalar setters require integer `Number` or `BigInt` values within the selected native field's range: collision groups use signed 32-bit `int`, solid types use unsigned 8-bit storage (`0`–`255`), and solid flags use unsigned 16-bit storage (`0`–`65535`). Reads and writes use that field's width, not a shared 32-bit width. An invalid value or failed entity selection leaves the native field unchanged. Entity getter errors retain their original JavaScript identity even when a native C++ exception also unwinds resolution.

`SetEntityCollisionEnabled()` requires an actual boolean. Vector setters accept an array or an object with `X`, `Y`, and `Z` components; `Pitch`, `Yaw`, and `Roll` are fallback names, and omitted components become zero when at least one component is present. Returned live-vector views expose the PascalCase components directly. Present components undergo JavaScript numeric conversion and must produce finite values within the native `float` range; numeric strings and booleans can therefore be converted. Failed conversion or range validation raises an error. Prefer actual finite numeric components rather than relying on coercion.

## Constant groups

### `CollisionGroup`

`CollisionGroup` maps selected SDK collision categories to their numeric `COLLISION_GROUP_*` values.

| Canonical member | Engine constant |
| --- | --- |
| `NONE` | `COLLISION_GROUP_NONE` |
| `DEBRIS` | `COLLISION_GROUP_DEBRIS` |
| `DEBRIS_TRIGGER` | `COLLISION_GROUP_DEBRIS_TRIGGER` |
| `INTERACTIVE_DEBRIS` | `COLLISION_GROUP_INTERACTIVE_DEBRIS` |
| `INTERACTIVE` | `COLLISION_GROUP_INTERACTIVE` |
| `PLAYER` | `COLLISION_GROUP_PLAYER` |
| `BREAKABLE_GLASS` | `COLLISION_GROUP_BREAKABLE_GLASS` |
| `VEHICLE` | `COLLISION_GROUP_VEHICLE` |
| `PLAYER_MOVEMENT` | `COLLISION_GROUP_PLAYER_MOVEMENT` |
| `NPC` | `COLLISION_GROUP_NPC` |
| `IN_VEHICLE` | `COLLISION_GROUP_IN_VEHICLE` |
| `WEAPON` | `COLLISION_GROUP_WEAPON` |
| `VEHICLE_CLIP` | `COLLISION_GROUP_VEHICLE_CLIP` |
| `PROJECTILE` | `COLLISION_GROUP_PROJECTILE` |
| `DOOR_BLOCKER` | `COLLISION_GROUP_DOOR_BLOCKER` |
| `PASSABLE_DOOR` | `COLLISION_GROUP_PASSABLE_DOOR` |
| `DISSOLVING` | `COLLISION_GROUP_DISSOLVING` |
| `PUSH_AWAY` | `COLLISION_GROUP_PUSHAWAY` |
| `NPC_ACTOR` | `COLLISION_GROUP_NPC_ACTOR` |
| `NPC_SCRIPTED` | `COLLISION_GROUP_NPC_SCRIPTED`, when present |

### `SolidType`

| Canonical member | Engine constant |
| --- | --- |
| `NONE` | `SOLID_NONE` |
| `BSP` | `SOLID_BSP` |
| `BOUNDING_BOX` | `SOLID_BBOX` |
| `OBB` | `SOLID_OBB` |
| `OBB_YAW` | `SOLID_OBB_YAW` |
| `CUSTOM` | `SOLID_CUSTOM` |
| `VPHYSICS` | `SOLID_VPHYSICS` |

### `SolidFlags`

| Canonical member | Engine constant |
| --- | --- |
| `CUSTOM_RAY_TEST` | `FSOLID_CUSTOMRAYTEST` |
| `CUSTOM_BOX_TEST` | `FSOLID_CUSTOMBOXTEST` |
| `NOT_SOLID` | `FSOLID_NOT_SOLID` |
| `TRIGGER` | `FSOLID_TRIGGER` |
| `NOT_STANDABLE` | `FSOLID_NOT_STANDABLE` |
| `VOLUME_CONTENTS` | `FSOLID_VOLUME_CONTENTS` |
| `FORCE_WORLD_ALIGNED` | `FSOLID_FORCE_WORLD_ALIGNED` |
| `USE_TRIGGER_BOUNDS` | `FSOLID_USE_TRIGGER_BOUNDS` |
| `ROOT_PARENT_ALIGNED` | `FSOLID_ROOT_PARENT_ALIGNED` |
| `TRIGGER_TOUCH_DEBRIS` | `FSOLID_TRIGGER_TOUCH_DEBRIS`, when present |

The objects are built from the selected SDK. Do not assume optional members exist on every branch. Each native key remains available, and the package adds the canonical `UPPER_SNAKE_CASE` members listed above. It also retains historical letter-split aliases when acronym runs generate a second spelling: `N_P_C`, `N_P_C_ACTOR`, optional `N_P_C_SCRIPTED`, `B_S_P`, `O_B_B`, and `O_B_B_YAW`. Use the canonical names in new code.

Generated aliases are own writable/configurable, non-enumerable properties added only when the name is absent. `Object.keys()` therefore lists enumerable native entries, not every alias. The package constant getters return these same shared objects, not fresh snapshots. Treat them as read-only by convention; they are not frozen, and changing them can also change helpers that read `SolidFlags.NOT_SOLID`.

```js
const { CollisionGroup, GetCollisionGroupConstants, GetSolidFlagConstants, GetSolidTypeConstants, SolidFlags, SolidType } = require("entities/collisions");
const { LogInfo } = require("loggers");

const g_CollisionGroupConstants = GetCollisionGroupConstants();
const g_SolidFlagConstants = GetSolidFlagConstants();
const g_SolidTypeConstants = GetSolidTypeConstants();

const g_vecRequiredMembers = [g_CollisionGroupConstants.PLAYER, g_SolidFlagConstants.NOT_SOLID, g_SolidFlagConstants.TRIGGER, g_SolidTypeConstants.BOUNDING_BOX, g_SolidTypeConstants.VPHYSICS];
if (!g_vecRequiredMembers.every(Number.isInteger)) {
	throw new Error("The selected SDK has an incomplete collision constant surface.");
}

LogInfo("%j", { Operation: "InspectCollisionConstants", CollisionGroups: Object.keys(CollisionGroup), SolidTypes: Object.keys(SolidType), SolidFlags: Object.keys(SolidFlags) });
```

## Inspecting collision state

The five scalar/vector getters read the entity's current backing properties:

- `GetEntityCollisionGroup(EntityReference)` returns a collision-group integer;
- `GetEntitySolidType(EntityReference)` returns a solid-type integer;
- `GetEntitySolidFlags(EntityReference)` returns a bit mask;
- `GetEntityCollisionMinimums(EntityReference)` returns the live minimum-bounds vector;
- `GetEntityCollisionMaximums(EntityReference)` returns the live maximum-bounds vector.

Each native getter or setter resolves the entity, its send table, and the first available SDK property name on every call. An unresolved entity, missing send table, or absence of every supported property name raises an error instead of returning a synthesized default. Integer and vector accessors preserve getter-thrown JavaScript errors during entity resolution instead of replacing them with lookup errors; native C++ failures become JavaScript errors. Constant dictionaries define own entries without invoking inherited setters.

A checked native property-name or live-view construction failure can leave a native getter without a result (`undefined`) even when no exception is pending. Validate saved scalar and vector values before any temporary mutation. No result check makes a stale native reference safe.

`GetEntityCollisionBounds(EntityReference)` returns `{ Minimums, Maximums }` with the same two live-vector shapes. Each vector exposes `Address` as a `BigInt` and `X`, `Y`, and `Z` as numeric properties. Treat `Address` as an opaque borrowed process-local address snapshot. Component assignment writes directly to entity memory.

```js
const { GetEntityCollisionBounds, GetEntityCollisionGroup, GetEntitySolidFlags, GetEntitySolidType } = require("entities/collisions");
const { Entity } = require("entities/entity");
const { LogInfo } = require("loggers");

const g_EntityReference = Entity(1);
if (!g_EntityReference) {
	throw new Error("Expected entity 1 to exist.");
}

const g_Bounds = GetEntityCollisionBounds(g_EntityReference);
if (!g_Bounds || !g_Bounds.Minimums || !g_Bounds.Maximums || (typeof g_Bounds.Minimums.Address !== "bigint") || (typeof g_Bounds.Maximums.Address !== "bigint")) {
	throw new Error("Collision bounds must expose native addresses as BigInt.");
}

LogInfo("%j", {
	Operation: "InspectEntityCollision",
	Maximums: [g_Bounds.Maximums.X, g_Bounds.Maximums.Y, g_Bounds.Maximums.Z],
	Minimums: [g_Bounds.Minimums.X, g_Bounds.Minimums.Y, g_Bounds.Minimums.Z],
	CollisionGroup: GetEntityCollisionGroup(g_EntityReference),
	SolidType: GetEntitySolidType(g_EntityReference),
	EntityIndex: g_EntityReference.Index,
	SolidFlags: GetEntitySolidFlags(g_EntityReference),
});
```

## Collision groups

### `GetEntityCollisionGroup(EntityReference)` and `SetEntityCollisionGroup(EntityReference, nCollisionGroup)`

Collision groups influence the game's collision-pair rules. They do not merely label an entity. Changing a player, projectile, door, or vehicle to an unrelated group can alter traces, touches, movement, and damage behavior.

Use a selected SDK constant and restore temporary changes:

```js
const { CollisionGroup, GetEntityCollisionGroup, SetEntityCollisionGroup } = require("entities/collisions");
const { Entity } = require("entities/entity");
const { LogInfo } = require("loggers");

const g_EntityReference = Entity(1);
if (!g_EntityReference) {
	throw new Error("Expected entity 1 to exist.");
}

const g_nPreviousCollisionGroup = GetEntityCollisionGroup(g_EntityReference);
if (!Number.isInteger(g_nPreviousCollisionGroup)) {
	throw new Error("Unable to read the current collision group.");
}

try {
	if (!SetEntityCollisionGroup(g_EntityReference, CollisionGroup.PLAYER_MOVEMENT)) {
		throw new Error("The collision group write failed.");
	}

	LogInfo("%j", { Operation: "InspectTemporaryCollisionGroup", CollisionGroup: GetEntityCollisionGroup(g_EntityReference) });
} finally {
	if (!SetEntityCollisionGroup(g_EntityReference, g_nPreviousCollisionGroup)) {
		throw new Error("The collision group restore failed.");
	}
}
```

## Solid types and flags

### `GetEntitySolidType(EntityReference)` and `SetEntitySolidType(EntityReference, unSolidType)`

The solid type selects the collision representation. Pass a numeric `SolidType` member, never a type-name string.

### `GetEntitySolidFlags(EntityReference)` and `SetEntitySolidFlags(EntityReference, unSolidFlags)`

The solid flags form a bit mask. `SetEntitySolidFlags()` replaces the complete mask. The helpers modify or test selected bits:

- `AddEntitySolidFlags(EntityReference, nSolidFlags)` uses bitwise OR;
- `RemoveEntitySolidFlags(EntityReference, nSolidFlags)` clears the supplied bits;
- `HasEntitySolidFlags(EntityReference, nSolidFlags)` is true only when every supplied bit is set.

```js
const { AddEntitySolidFlags, GetEntitySolidFlags, GetEntitySolidType, HasEntitySolidFlags, RemoveEntitySolidFlags, SetEntitySolidFlags, SetEntitySolidType, SolidFlags, SolidType } = require("entities/collisions");
const { Entity } = require("entities/entity");
const { LogInfo } = require("loggers");

const g_EntityReference = Entity(1);
if (!g_EntityReference) {
	throw new Error("Expected entity 1 to exist.");
}

const g_unPreviousSolidFlags = GetEntitySolidFlags(g_EntityReference);
const g_unPreviousSolidType = GetEntitySolidType(g_EntityReference);
if (!Number.isInteger(g_unPreviousSolidFlags) || !Number.isInteger(g_unPreviousSolidType)) {
	throw new Error("Unable to read the current solid collision state.");
}

try {
	if (!SetEntitySolidType(g_EntityReference, SolidType.BOUNDING_BOX)) {
		throw new Error("The solid type write failed.");
	}

	if (!SetEntitySolidFlags(g_EntityReference, g_unPreviousSolidFlags & ~SolidFlags.NOT_SOLID)) {
		throw new Error("The solid flags write failed.");
	}

	if (!AddEntitySolidFlags(g_EntityReference, SolidFlags.TRIGGER | SolidFlags.USE_TRIGGER_BOUNDS)) {
		throw new Error("The trigger flags write failed.");
	}

	if (!HasEntitySolidFlags(g_EntityReference, SolidFlags.TRIGGER | SolidFlags.USE_TRIGGER_BOUNDS)) {
		throw new Error("The trigger flags were not applied.");
	}

	if (!RemoveEntitySolidFlags(g_EntityReference, SolidFlags.USE_TRIGGER_BOUNDS)) {
		throw new Error("The trigger-bounds flag removal failed.");
	}

	LogInfo("%j", { Operation: "InspectTemporarySolidFlags", SolidFlags: GetEntitySolidFlags(g_EntityReference) });
} finally {
	const bFlagsRestored = SetEntitySolidFlags(g_EntityReference, g_unPreviousSolidFlags);
	const bTypeRestored = SetEntitySolidType(g_EntityReference, g_unPreviousSolidType);
	if (!bFlagsRestored || !bTypeRestored) {
		throw new Error("The solid collision state restore failed.");
	}
}
```

These three bit helpers require integer `Number` values and reject `BigInt`. JavaScript bitwise operations use signed 32-bit integers. The Source solid-flag masks fit that representation, but do not mix these helpers with unrelated wider numeric masks.

After validating the supplied mask, each helper reads the current flags once and requires an integer `Number` in `0`–`65535` before bitwise work. A missing or invalid native result raises a `TypeError` before any write. Native getter/setter errors propagate unchanged, and mutating helpers forward the native setter result without coercion. This does not pin the entity or make a multi-call update transactional.

## Collision enabled state

### `IsEntityCollisionEnabled(EntityReference)` and `SetEntityCollisionEnabled(EntityReference, bCollisionEnabled)`

SourceJS defines collision as enabled when `SolidFlags.NOT_SOLID` is absent. `SetEntityCollisionEnabled()` changes only that flag and preserves every other solid flag. Both operations use the checked flag-read contract above.

```js
const { GetEntitySolidFlags, IsEntityCollisionEnabled, SetEntityCollisionEnabled, SetEntitySolidFlags } = require("entities/collisions");
const { Entity } = require("entities/entity");
const { LogInfo } = require("loggers");

const g_EntityReference = Entity(1);
if (!g_EntityReference) {
	throw new Error("Expected entity 1 to exist.");
}

const g_unPreviousSolidFlags = GetEntitySolidFlags(g_EntityReference);
if (!Number.isInteger(g_unPreviousSolidFlags)) {
	throw new Error("Unable to read the current solid flags.");
}

try {
	if (!SetEntityCollisionEnabled(g_EntityReference, false)) {
		throw new Error("Unable to disable collision.");
	}

	if (IsEntityCollisionEnabled(g_EntityReference)) {
		throw new Error("The entity should be non-solid.");
	}

	if (!SetEntityCollisionEnabled(g_EntityReference, true)) {
		throw new Error("Unable to enable collision.");
	}

	if (!IsEntityCollisionEnabled(g_EntityReference)) {
		throw new Error("The entity should be solid.");
	}

	LogInfo("%j", { Operation: "VerifyCollisionEnabledToggle", EntityIndex: g_EntityReference.Index });
} finally {
	if (!SetEntitySolidFlags(g_EntityReference, g_unPreviousSolidFlags)) {
		throw new Error("Unable to restore the collision flags.");
	}
}
```

This helper does not change `SolidType`. An entity can therefore have a non-`NONE` solid type while `NOT_SOLID` disables ordinary collision.

## Live bounds

### `GetEntityCollisionMinimums(EntityReference)`, `GetEntityCollisionMaximums(EntityReference)`, `SetEntityCollisionMinimums(EntityReference, MinimumBounds)`, and `SetEntityCollisionMaximums(EntityReference, MaximumBounds)`

`ModuleBindings.cpp` exposes the backing native operations as `GetMinimumBounds`, `GetMaximumBounds`, `SetMinimumBounds`, and `SetMaximumBounds`. Package adapters must bind those exact names; the historical `GetMinimums`, `GetMaximums`, `SetMinimums`, and `SetMaximums` names are not native exports.

The getter results are live views with `X`, `Y`, and `Z` component properties. Assigning a component immediately edits the backing vector. Copy component values before a temporary mutation; retaining the view itself does not preserve the old values.

At package level, `GetEntityCollisionBounds()` reads the maximum vector and then the minimum vector. The individual `GetEntityCollisionMinimums()` and `GetEntityCollisionMaximums()` adapters both use that combined read, so both native properties must be available even when requesting only one result.

Native setter inputs use array indexes `0`–`2` or object properties `X`, `Y`, and `Z`, with `Pitch`, `Yaw`, and `Roll` as fallbacks. At least one non-nullish component must be present. Component getters are read normally, so returned live views and `mathlib.Vector` instances are accepted while their backing storage remains valid. Copy components when you need a stable snapshot for later restoration; copying is not a prerequisite for setter input and does not make a stale view safe to read.

Component getters, `Index` getters, and numeric-conversion hooks must not invalidate borrowed vector storage during an operation. Native whole-vector setters snapshot the destination entity's handle and serial before converting components, then revalidate that identity and its base address before writing. A removed or replaced entity raises an error without writing, including replacement at the same address; input getters are not repeated for revalidation. These checks do not pin the entity or source-vector storage, make a stale view safe, or make a multi-call bounds update atomic. Prefer stable references and plain numeric input snapshots when callbacks could mutate entity state.

### `SetEntityCollisionBounds(EntityReference, MinimumBounds, MaximumBounds)`

Attempts `SetMinimumBounds` and then `SetMaximumBounds`, including the maximum write when the minimum write reports failure. Returns `true` only when both writes report success. The operation is not transactional: a `false` result can still leave either bound changed. A thrown minimum-setter error aborts before the maximum call; an exception does not roll back completed writes.

The individual `SetEntityCollisionMinimums()` and `SetEntityCollisionMaximums()` adapters first copy the opposite bound's components, then call this two-write operation with that preserved snapshot. They can therefore rewrite both bounds and return `false` after a partial update; they are not single-native-field writes. Failure while reading the preserved bound happens before those writes.

These bound setters write backing sendprop vector storage directly. They do not call an engine-level bounds-rebuild or network-state notification routine; success alone does not establish that derived collision caches or replicated state were refreshed.

```js
const { GetEntityCollisionMaximums, GetEntityCollisionMinimums, SetEntityCollisionBounds, SetEntityCollisionMaximums, SetEntityCollisionMinimums } = require("entities/collisions");
const { Entity } = require("entities/entity");
const { LogInfo } = require("loggers");
const { Vector } = require("mathlib");

const g_flXExpansionDistance = 4;

const g_EntityReference = Entity(1);
if (!g_EntityReference) {
	throw new Error("Expected entity 1 to exist.");
}

const g_LiveMinimums = GetEntityCollisionMinimums(g_EntityReference);
const g_LiveMaximums = GetEntityCollisionMaximums(g_EntityReference);
if (!g_LiveMinimums || !g_LiveMaximums) {
	throw new Error("Unable to read the live collision bounds.");
}

const g_vecPreviousMinimums = [g_LiveMinimums.X, g_LiveMinimums.Y, g_LiveMinimums.Z];
const g_vecPreviousMaximums = [g_LiveMaximums.X, g_LiveMaximums.Y, g_LiveMaximums.Z];
if (!g_vecPreviousMinimums.every(Number.isFinite) || !g_vecPreviousMaximums.every(Number.isFinite)) {
	throw new Error("Unable to snapshot finite collision bounds.");
}

try {
	g_LiveMinimums.X -= g_flXExpansionDistance;
	g_LiveMaximums.X += g_flXExpansionDistance;

	if (!SetEntityCollisionMinimums(g_EntityReference, [-20, -20, 0])) {
		throw new Error("The collision minimums write failed.");
	}

	if (!SetEntityCollisionMaximums(g_EntityReference, [20, 20, 72])) {
		throw new Error("The collision maximums write failed.");
	}

	if (!SetEntityCollisionBounds(g_EntityReference, g_LiveMinimums, g_LiveMaximums)) {
		throw new Error("The live collision-bound inputs were rejected.");
	}

	const MinimumBounds = new Vector(-24, -24, 0);
	const MaximumBounds = new Vector(24, 24, 84);
	if (!SetEntityCollisionBounds(g_EntityReference, MinimumBounds, MaximumBounds)) {
		throw new Error("The collision bounds write failed.");
	}

	LogInfo("%j", { Operation: "InspectTemporaryCollisionBounds", Height: GetEntityCollisionMaximums(g_EntityReference).Z - GetEntityCollisionMinimums(g_EntityReference).Z });
} finally {
	if (!SetEntityCollisionBounds(g_EntityReference, g_vecPreviousMinimums, g_vecPreviousMaximums)) {
		throw new Error("The collision bounds restore failed.");
	}
}
```

Collision bounds are entity collision properties. They are separate from shared model hitbox definitions documented by [`studio`](studio.md). Changing one does not automatically rewrite the other.

## `CollisionRules`

`new CollisionRules(EntityReference)` binds the same operations to one entity. The constructor stores the supplied `EntityReference` unchanged in the public field `Entity`; validation and resolution occur when an operation uses it.

### Live properties

| Property | Read | Write |
| --- | --- | --- |
| `Entity` | Current target `EntityReference` | Retargets later operations |
| [`CollisionGroup`](#collisiongroup) | `GetEntityCollisionGroup(Entity)` | `SetEntityCollisionGroup(Entity, nCollisionGroup)` |
| [`SolidType`](#solidtype) | `GetEntitySolidType(Entity)` | `SetEntitySolidType(Entity, unSolidType)` |
| [`SolidFlags`](#solidflags) | `GetEntitySolidFlags(Entity)` | `SetEntitySolidFlags(Entity, unSolidFlags)` |
| `CollisionEnabled` | `IsEntityCollisionEnabled(Entity)` | `SetEntityCollisionEnabled(Entity, bCollisionEnabled)` |

JavaScript property assignment does not expose the native setter's boolean result. Read the property back when a write must be verified, as the example does below.

### Methods

| Method | Behavior |
| --- | --- |
| `AddSolidFlags(nSolidFlags)` | Adds solid-flag bits |
| `RemoveSolidFlags(nSolidFlags)` | Removes solid-flag bits |
| `HasSolidFlags(nSolidFlags)` | Tests whether every bit is set |
| `GetEntityCollisionBounds()` | Returns live `{ Minimums, Maximums }` views |
| [`SetEntityCollisionBounds(MinimumBounds, MaximumBounds)`](#setentitycollisionboundsentityreference-minimumbounds-maximumbounds) | Attempts both collision-bound writes and returns their combined status |

The bounds method uses the setter input and nontransactional rules from the preceding section. Arrays, accepted `X/Y/Z` objects, valid returned live views, and valid `mathlib.Vector` instances may be passed directly; snapshot components separately when rollback requires the old values.

```js
const { CollisionGroup, CollisionRules, SolidFlags, SolidType } = require("entities/collisions");
const { Entity } = require("entities/entity");
const { LogInfo } = require("loggers");

const g_EntityReference = Entity(1);
if (!g_EntityReference) {
	throw new Error("Expected entity 1 to exist.");
}

const g_Rules = new CollisionRules(g_EntityReference);
const g_LiveBounds = g_Rules.GetEntityCollisionBounds();
if (!g_LiveBounds || !g_LiveBounds.Minimums || !g_LiveBounds.Maximums) {
	throw new Error("Unable to read the current CollisionRules bounds.");
}

const g_vecPreviousMinimums = [g_LiveBounds.Minimums.X, g_LiveBounds.Minimums.Y, g_LiveBounds.Minimums.Z];
const g_vecPreviousMaximums = [g_LiveBounds.Maximums.X, g_LiveBounds.Maximums.Y, g_LiveBounds.Maximums.Z];
if (!g_vecPreviousMinimums.every(Number.isFinite) || !g_vecPreviousMaximums.every(Number.isFinite)) {
	throw new Error("Unable to snapshot finite CollisionRules bounds.");
}

const g_PreviousState = { CollisionEnabled: g_Rules.CollisionEnabled, CollisionGroup: g_Rules.CollisionGroup, SolidType: g_Rules.SolidType, SolidFlags: g_Rules.SolidFlags };
if (!Number.isInteger(g_PreviousState.CollisionGroup) || !Number.isInteger(g_PreviousState.SolidType) || !Number.isInteger(g_PreviousState.SolidFlags)) {
	throw new Error("Unable to read the current CollisionRules state.");
}

try {
	g_Rules.CollisionGroup = CollisionGroup.INTERACTIVE;
	g_Rules.SolidType = SolidType.BOUNDING_BOX;
	g_Rules.SolidFlags = g_PreviousState.SolidFlags;
	g_Rules.CollisionEnabled = true;

	if ((g_Rules.CollisionGroup !== CollisionGroup.INTERACTIVE) || (g_Rules.SolidType !== SolidType.BOUNDING_BOX) || !g_Rules.CollisionEnabled) {
		throw new Error("CollisionRules property writes were not visible in native state.");
	}

	if (!g_Rules.AddSolidFlags(SolidFlags.TRIGGER)) {
		throw new Error("CollisionRules could not add the trigger flag.");
	}

	if (!g_Rules.HasSolidFlags(SolidFlags.TRIGGER)) {
		throw new Error("CollisionRules did not retain the trigger flag.");
	}

	if (!g_Rules.RemoveSolidFlags(SolidFlags.TRIGGER)) {
		throw new Error("CollisionRules could not remove the trigger flag.");
	}

	if (!g_Rules.SetEntityCollisionBounds([-12, -12, 0], [12, 12, 32])) {
		throw new Error("CollisionRules could not write the bounds.");
	}

	LogInfo("%j", { Operation: "VerifyTemporaryCollisionRules", EntityIndex: g_EntityReference.Index });
} finally {
	const bBoundsRestored = g_Rules.SetEntityCollisionBounds(g_vecPreviousMinimums, g_vecPreviousMaximums);

	g_Rules.SolidFlags = g_PreviousState.SolidFlags;
	g_Rules.SolidType = g_PreviousState.SolidType;
	g_Rules.CollisionGroup = g_PreviousState.CollisionGroup;
	g_Rules.CollisionEnabled = g_PreviousState.CollisionEnabled;

	const RestoredBounds = g_Rules.GetEntityCollisionBounds();
	if (!RestoredBounds || !RestoredBounds.Minimums || !RestoredBounds.Maximums) {
		throw new Error("Unable to read the restored CollisionRules bounds.");
	}

	const bScalarStateRestored = (g_Rules.SolidFlags === g_PreviousState.SolidFlags) && (g_Rules.SolidType === g_PreviousState.SolidType) && (g_Rules.CollisionGroup === g_PreviousState.CollisionGroup) && (g_Rules.CollisionEnabled === g_PreviousState.CollisionEnabled);
	const bMinimumsRestored = (RestoredBounds.Minimums.X === g_vecPreviousMinimums[0]) && (RestoredBounds.Minimums.Y === g_vecPreviousMinimums[1]) && (RestoredBounds.Minimums.Z === g_vecPreviousMinimums[2]);
	const bMaximumsRestored = (RestoredBounds.Maximums.X === g_vecPreviousMaximums[0]) && (RestoredBounds.Maximums.Y === g_vecPreviousMaximums[1]) && (RestoredBounds.Maximums.Z === g_vecPreviousMaximums[2]);

	if (!bBoundsRestored || !bScalarStateRestored || !bMinimumsRestored || !bMaximumsRestored) {
		throw new Error("CollisionRules did not restore the native collision state.");
	}
}
```

`CollisionRules` does not own the entity represented by `Entity`. It does not observe deletion or protect against index or address reuse. Replace the instance or its `Entity` field after resolving a new `EntityReference`.

## Lifecycle and common mistakes

- Run live collision queries and writes on the server thread, not arbitrary worker threads.
- Resolve an `EntityReference` only after a map has created the target. Main-menu code can import the module but cannot resolve an ordinary world entity.
- Treat `CollisionGroup`, `SolidType`, and `SolidFlags` as selected-SDK objects. Optional members may be absent.
- Pass numeric enum values to setters. Strings such as `"int"`, `"player"`, or `"bbox"` are invalid.
- Preserve complete flag masks before temporary changes. Clearing only one helper-added bit is not equivalent when another plugin changed the entity meanwhile.
- Copy live vector components before mutation. Keeping the original vector object keeps a view of current memory, not a snapshot.
- Pass collision-bound setter values as arrays or objects with valid components. Returned `X/Y/Z` live views and `mathlib.Vector` instances are accepted directly while their backing storage is valid; do not confuse a live input with a stable rollback snapshot.
- `SetEntityCollisionBounds()` attempts the minimum and maximum writes in order even when the first reports failure. Snapshot both bounds before the call because a `false` result can accompany a partial update.
- Collision bounds and studio hitboxes solve different problems. See [`studio`](studio.md) for shared model hitboxes.
- Treat live-view `Address` values and address-form `EntityReference` inputs as borrowed addresses, not ownership or stable identity.
- Collision writes affect active engine state. Restore temporary changes only while the same entity is still valid, including on plugin unload and before releasing owned entities.
- See [`entities/props`](entities-props.md) when you need the underlying sendprop metadata or another collision-related property.

## Export reference

These are the 24 public package exports. The package consumes the exact native names documented above and hides those lower-level bindings after creating this surface.

| Export | Signature | Result |
| --- | --- | --- |
| `AddEntitySolidFlags` | `AddEntitySolidFlags(EntityReference, nSolidFlags)` | Native solid-flag setter result |
| [`CollisionGroup`](#collisiongroup) | Constant object | Selected-SDK collision-group integers |
| [`CollisionRules`](#collisionrules) | `new CollisionRules(EntityReference)` | Entity-bound live collision view |
| `GetCollisionGroupConstants` | `GetCollisionGroupConstants()` | Shared selected-SDK collision-group object |
| `GetEntityCollisionBounds` | `GetEntityCollisionBounds(EntityReference)` | `{ Minimums, Maximums }` live views |
| [`GetEntityCollisionGroup`](#getentitycollisiongroupentityreference-and-setentitycollisiongroupentityreference-ncollisiongroup) | `GetEntityCollisionGroup(EntityReference)` | Integer collision group |
| `GetEntityCollisionMaximums` | `GetEntityCollisionMaximums(EntityReference)` | Live maximum-bounds view |
| [`GetEntityCollisionMinimums`](#getentitycollisionminimumsentityreference-getentitycollisionmaximumsentityreference-setentitycollisionminimumsentityreference-minimumbounds-and-setentitycollisionmaximumsentityreference-maximumbounds) | `GetEntityCollisionMinimums(EntityReference)` | Live minimum-bounds view |
| [`GetEntitySolidFlags`](#getentitysolidflagsentityreference-and-setentitysolidflagsentityreference-unsolidflags) | `GetEntitySolidFlags(EntityReference)` | Integer solid-flag mask |
| [`GetEntitySolidType`](#getentitysolidtypeentityreference-and-setentitysolidtypeentityreference-unsolidtype) | `GetEntitySolidType(EntityReference)` | Integer solid type |
| `GetSolidFlagConstants` | `GetSolidFlagConstants()` | Shared selected-SDK solid-flag object |
| `GetSolidTypeConstants` | `GetSolidTypeConstants()` | Shared selected-SDK solid-type object |
| `HasEntitySolidFlags` | `HasEntitySolidFlags(EntityReference, nSolidFlags)` | Whether every requested bit is set |
| [`IsEntityCollisionEnabled`](#isentitycollisionenabledentityreference-and-setentitycollisionenabledentityreference-bcollisionenabled) | `IsEntityCollisionEnabled(EntityReference)` | Whether `NOT_SOLID` is absent |
| `RemoveEntitySolidFlags` | `RemoveEntitySolidFlags(EntityReference, nSolidFlags)` | Native solid-flag setter result |
| [`SetEntityCollisionBounds`](#setentitycollisionboundsentityreference-minimumbounds-maximumbounds) | `SetEntityCollisionBounds(EntityReference, MinimumBounds, MaximumBounds)` | Combined status after both writes are attempted |
| `SetEntityCollisionEnabled` | `SetEntityCollisionEnabled(EntityReference, bCollisionEnabled)` | Native solid-flag setter result |
| `SetEntityCollisionGroup` | `SetEntityCollisionGroup(EntityReference, nCollisionGroup)` | Native collision-group setter result |
| `SetEntityCollisionMaximums` | `SetEntityCollisionMaximums(EntityReference, MaximumBounds)` | Combined preserved-minimum and maximum write status |
| `SetEntityCollisionMinimums` | `SetEntityCollisionMinimums(EntityReference, MinimumBounds)` | Combined minimum and preserved-maximum write status |
| `SetEntitySolidFlags` | `SetEntitySolidFlags(EntityReference, unSolidFlags)` | Native solid-flag setter result |
| `SetEntitySolidType` | `SetEntitySolidType(EntityReference, unSolidType)` | Native solid-type setter result |
| [`SolidFlags`](#solidflags) | Constant object | Selected-SDK `FSOLID_*` mask values |
| [`SolidType`](#solidtype) | Constant object | Selected-SDK `SOLID_*` values |
