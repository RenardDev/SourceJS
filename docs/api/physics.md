# `require("physics")`

> AI navigation: read the API tables for accepted values and lifetimes, then the relevant checked example. These are borrowed native views, not memory-safety or physical-validity checks.

The `physics` module provides JavaScript facades over the selected Source SDK's VPhysics interfaces. Use it to inspect active physics environments, change world gravity and air density, resolve an entity's `IPhysicsObject`, and mutate object state without cached JavaScript copies.

The JavaScript facade lives in [`packages/sourcejs/physics.js`](../../packages/sourcejs/physics.js), while the V8 callbacks bind the selected HL2SDK's `vphysics_interface.h` directly. Related live entity and vector types are documented in [`entities/entity`](entities-entity.md) and [`mathlib`](mathlib.md).

The facade preserves descriptive public exports while delegating to the compact native runtime API:

| Public facade | Native runtime |
| --- | --- |
| `PHYSICS_INTERFACE` | `Interface` |
| `GetServerGravityConVarValue()` | `Gravity()` |
| `CreatePhysicsInterfaceFromAddress()` | `InterfaceFromAddress()` |
| `GetActivePhysicsEnvironmentByIndex()` | `GetActiveEnvironmentByIndex()` |
| `CreatePhysicsEnvironmentFromAddress()` | `EnvironmentFromAddress()` |
| `ResolvePhysicsObject()` | `Object()` |
| `CreatePhysicsObjectFromAddress()` | `ObjectFromAddress()` |
| `GetEntityPhysicsObject()` | `ObjectByEntity()` |
| `GetEntityPhysicsObjects()` | `ObjectsByEntity()` |

The module is available only when the selected SDK provides VPhysics. Methods that do not exist in that SDK are omitted instead of being replaced by fallback functions.

## Contents

- [Import](#import)
- [Module API](#module-api)
- [Physics interface](#physics-interface)
- [Physics environment](#physics-environment)
- [Physics object](#physics-object)
- [Environment gravity](#environment-gravity)
- [Air density and simulation](#air-density-and-simulation)
- [Resolving entity objects](#resolving-entity-objects)
- [Object state](#object-state)
- [Mass, inertia, and flags](#mass-inertia-and-flags)
- [Position and velocity](#position-and-velocity)
- [Forces and coordinate transforms](#forces-and-coordinate-transforms)
- [Collision, motion, and contacts](#collision-motion-and-contacts)
- [Address and constructor interop](#address-and-constructor-interop)
- [Errors](#errors)
- [Lifecycle](#lifecycle)
- [Related modules](#related-modules)

## Import

```js
const {
	PHYSICS_INTERFACE,
	PhysicsEnvironment,
	PhysicsInterface,
	PhysicsObject,
	CreatePhysicsEnvironmentFromAddress,
	CreatePhysicsInterfaceFromAddress,
	CreatePhysicsObjectFromAddress,
	GetActivePhysicsEnvironmentByIndex,
	GetEntityPhysicsObject,
	GetEntityPhysicsObjects,
	GetServerGravityConVarValue,
	ResolvePhysicsObject,
} = require("physics");

const g_vecPhysicsClasses = [PhysicsEnvironment, PhysicsInterface, PhysicsObject];
const g_vecPhysicsFunctions = [
	CreatePhysicsEnvironmentFromAddress,
	CreatePhysicsInterfaceFromAddress,
	CreatePhysicsObjectFromAddress,
	GetActivePhysicsEnvironmentByIndex,
	GetEntityPhysicsObject,
	GetEntityPhysicsObjects,
	GetServerGravityConVarValue,
	ResolvePhysicsObject,
];
const g_bHasInvalidPhysicsClass = g_vecPhysicsClasses.some((PhysicsClass) => typeof PhysicsClass !== "function");
const g_bHasInvalidPhysicsFunction = g_vecPhysicsFunctions.some((PhysicsFunction) => typeof PhysicsFunction !== "function");
if (g_bHasInvalidPhysicsClass || g_bHasInvalidPhysicsFunction) {
	throw new Error("The physics module did not expose its complete public API.");
}

const g_bHasPhysicsInterfaceObject = (PHYSICS_INTERFACE !== null) && (typeof PHYSICS_INTERFACE === "object");
const g_bHasValidPhysicsInterfaceAddress = g_bHasPhysicsInterfaceObject && (typeof PHYSICS_INTERFACE.Address === "bigint") && (PHYSICS_INTERFACE.Address > 0n);
if (!g_bHasValidPhysicsInterfaceAddress) {
	throw new Error("PHYSICS_INTERFACE did not expose a valid live IPhysics address.");
}
```

The module exports a JavaScript facade over the native runtime. Its class and function properties are writable and configurable; `PHYSICS_INTERFACE` is an enumerable, configurable getter with no setter. Address-backed wrappers are borrowed live views whose `Address` fields are positive JavaScript `bigint` values. Vector inputs require finite native-`float` components; results expose numeric `X`, `Y`, and `Z` components with liveness described per member. Native results are not automatically sanitized.

Call these interfaces on the game thread while their native owners remain alive. A positive, aligned, native-width BigInt is only an address representation check: it does not prove allocation, object type, a valid vtable, or lifetime. Stale or arbitrary addresses can crash the native process; wrappers do not own, pin, or synchronize native storage. No unit conversion is performed by these wrappers. In the bundled L4D2 SDK, coordinates are inches, angles are degrees, mass is kilograms, volume is cubic inches, acceleration is inches/s², linear velocity is inches/s, and density is kg/m³; use the selected SDK's native conventions.

## Module API

| Export | Result | Purpose |
| --- | --- | --- |
| `PHYSICS_INTERFACE` | `PhysicsInterface` | Every read returns a fresh borrowed live `IPhysics` wrapper. The property is read-only and throws natively when the live VPhysics interface is unavailable; the wrapper remains usable only while the interface stays connected. |
| `GetServerGravityConVarValue()` | `number` | Returns the current native float value of `sv_gravity`. It throws when the CVar interface or `sv_gravity` is unavailable; this is not the environment gravity vector. |
| `GetActivePhysicsEnvironmentByIndex(unEnvironmentIndex = 0, bRequired = false)` | `PhysicsEnvironment \| null` | Requires a non-negative signed-32-bit integer index and a boolean required flag. Resolves one active VPhysics environment; with `bRequired = true`, a missing environment throws instead of returning `null`. |
| `CreatePhysicsInterfaceFromAddress(unAddress)` | `PhysicsInterface` | Requires a non-zero, correctly aligned BigInt `IPhysics*` address, then returns a borrowed wrapper that remains usable only while the native interface lives. |
| `CreatePhysicsEnvironmentFromAddress(unAddress, nEnvironmentIndex = -1)` | `PhysicsEnvironment` | Requires a non-zero, correctly aligned BigInt `IPhysicsEnvironment*` address and a signed-32-bit integer index, then returns a borrowed live wrapper. It throws when the physics interface or either argument is invalid. |
| `ResolvePhysicsObject(PhysicsObject, bRequired = false)` | `PhysicsObject \| null` | Requires the physics interface and a value to resolve. A wrapper with a BigInt `Address`, or a direct BigInt, is treated as an aligned native `IPhysicsObject*` address; other values use entity lookup. Do not pass an entity wrapper with a BigInt `Address` here: use `GetEntityPhysicsObject()` instead. Returns `null` when no object resolves, including a supplied `null`/`undefined`; with boolean `bRequired = true`, it throws instead. A returned wrapper is borrowed and remains usable only while the native object lives. |
| `CreatePhysicsObjectFromAddress(unAddress)` | `PhysicsObject` | Requires the physics interface and a non-zero, correctly aligned BigInt `IPhysicsObject*` address, then returns a borrowed wrapper that remains usable only while the native object lives. |
| `GetEntityPhysicsObject(Entity, unPhysicsObjectListIndex = 0)` | `PhysicsObject \| null` | Requires the physics interface, a valid entity, and a non-negative signed-32-bit integer list index. Returns `null` when that zero-based entry is absent from the active-object scan described below; otherwise returns a borrowed wrapper that remains usable only while the native object lives. The list index is not a stable object identifier. |
| `GetEntityPhysicsObjects(Entity)` | `PhysicsObject[]` | Requires the physics interface and a valid entity, then returns a fresh array of borrowed wrappers from the active-object scan described below, not a complete entity-ownership registry. It rejects a collected list that exceeds the native JavaScript array limit and checks each entry for null before wrapping it; each wrapper remains usable only while its native object lives. |
| `PhysicsInterface` | class | Constructor facade for `PHYSICS_INTERFACE`; also provides `PhysicsInterface.CreatePhysicsInterfaceFromAddress(unAddress)`. |
| `PhysicsEnvironment` | class | Constructor facade for `GetActivePhysicsEnvironmentByIndex()`; also provides `PhysicsEnvironment.CreatePhysicsEnvironmentFromAddress(unAddress)`. |
| `PhysicsObject` | class | Constructor facade for `ResolvePhysicsObject()`; also provides `PhysicsObject.CreatePhysicsObjectFromAddress(unAddress)`. |

All three constructors implement `CreateFromAddress(unAddress)` for the factory protocol called by `memory.MakeObject()`. It delegates to the corresponding class-specific address factory, preserving its argument checks and borrowed lifetime. Application code uses the class-specific `CreatePhysics*FromAddress()` methods.

Use `GetEntityPhysicsObject()` for entity wrappers, especially when an entity owns multiple objects and the list index matters. Entity lookup scans active environment indices `0` through `15`, collecting non-null active objects whose `GetGameData()` equals the native entity address; non-positive active-object counts are skipped. Objects outside those snapshots are not discovered, and list indices follow the current scan order. `ResolvePhysicsObject(PhysicsObject)` reads an object's `Address` before attempting entity lookup; a BigInt there is interpreted as a physics-object address, not a base-entity address. Its entity fallback selects the first object from that scan. The same address-first behavior applies to `new PhysicsObject(PhysicsObject)`; neither path distinguishes native object types from a numeric address.

The direct lookup functions remain nullable because an entity or environment index can legitimately have no physics object. Synchronous getters and setters propagate JavaScript accessor errors; successful setters report completion of the native call, not a validated or accepted physical configuration. `new PhysicsEnvironment(unEnvironmentIndex)` and `new PhysicsObject(PhysicsObject)` require the corresponding native object and propagate a V8 error when resolution fails; they do not manufacture an empty JavaScript wrapper.

## Physics interface

`physics.PHYSICS_INTERFACE`, `new PhysicsInterface()`, and `PhysicsInterface.CreatePhysicsInterfaceFromAddress(unAddress)` return an object with:

| Member | Type or signature |
| --- | --- |
| `Address` | BigInt containing the borrowed `IPhysics*` address; the value and wrapper remain usable only while the live physics interface stays connected. |
| `GetActivePhysicsEnvironmentByIndex(unEnvironmentIndex = 0)` | Returns `PhysicsEnvironment \| null`; unlike the module-level lookup, this facade method does not accept `bRequired`. |

## Physics environment

`GetActivePhysicsEnvironmentByIndex()`, `new PhysicsEnvironment()`, and `CreatePhysicsEnvironmentFromAddress()` return a live environment object.

Native environment methods resolve the receiver through its public `Address` property, not by interpreting the
JavaScript object itself as an address. The value must be a nonzero, aligned, native-width BigInt. An `Address`
getter failure is preserved and stops resolution; it is not replaced by the ordinary invalid-handle diagnostic.

| Member | Type or signature |
| --- | --- |
| `Index` | Signed-32-bit environment index; address factories default to `-1` when no index was supplied and do not verify that a supplied index matches the environment. |
| `Address` | BigInt containing the borrowed `IPhysicsEnvironment*` address; the value and wrapper remain usable only while the native environment lives. |
| `Gravity` | Live writable `{ X, Y, Z }` view. Reads fetch the current native gravity; assigning one component requires a finite number in the native `float` range, preserves the other components, and calls `IPhysicsEnvironment::SetGravity()`. |
| `GetGravity()` | Returns a fresh live writable gravity wrapper whose reads and finite native-`float` component writes target the borrowed environment; the wrapper remains usable only while that environment lives. |
| `SetGravity(PhysicsEnvironmentGravityVector)` | Requires finite native-`float` `X`, `Y`, and `Z` fields, replaces all native gravity components, and returns `true` after the native call. |
| `GetAirDensity()` | Returns the current native air density as a JavaScript `number`. |
| `SetAirDensity(flPhysicsEnvironmentAirDensity)` | Requires a finite number in the native `float` range, writes the native air density, and returns `true` after the native call. |
| `GetActiveObjectCount()` | Returns the current native active-object count as an integer-valued JavaScript `number`. |
| `ActiveObjects()` | Returns a fresh array of borrowed wrappers for the current native active objects. It throws for a negative SDK count or null SDK entry; each wrapper remains usable only while its native object lives. |
| `GetActiveObjectByEntity(PhysicsEntityOrIndex)` | Requires a non-negative signed-32-bit entity index or entity object. Returns `null` when no active object matches; otherwise returns a fresh borrowed wrapper that remains usable only while the native physics object lives. |
| `IsInSimulation()` | Returns whether the native environment is currently simulating. |
| `GetSimulationTime()` | Returns the native accumulated simulation-time value as a JavaScript `number`. |
| `GetSimulationTimestep()` | Returns the native simulation-timestep value as a JavaScript `number`. |
| `GetNextFrameTime()` | When provided by the selected SDK, returns the native next-frame-time value as a JavaScript `number`. |

## Physics object

Every JavaScript physics-object wrapper exposes these native-backed fields. The wrapper owns no native storage and remains usable only while its underlying `IPhysicsObject` lives:

| Member | Type and behavior |
| --- | --- |
| `Address` | Borrowed native `IPhysicsObject*` address encoded as a positive JavaScript `bigint`. |
| `Position.Position` | Live writable `{ X, Y, Z }` world position. |
| `Position.Angles` | Live writable `{ Pitch, Yaw, Roll }` world angles. |
| `Velocity.LinearVelocity` | Live writable `{ X, Y, Z }` linear velocity. |
| `Velocity.AngularVelocity` | Live writable `{ X, Y, Z }` angular velocity. |
| `Inertia` | Live writable `{ X, Y, Z }` inertia. |
| `InverseInertia` | Live read-only `{ X, Y, Z }` inverse inertia. |
| `MassCenterLocalSpace` | Live read-only `{ X, Y, Z }` mass center. |

The methods below call the selected SDK's `IPhysicsObject` directly.

| Method | Result or effect |
| --- | --- |
| `IsStatic()` | Returns whether the object is static. |
| `IsAsleep()` | Returns whether the object is sleeping. |
| `IsTrigger()` | Returns whether the object is a trigger. |
| `IsFluid()` | Returns whether the object is a fluid controller. |
| `IsHinged()` | Returns whether the object is hinged. |
| `IsCollisionEnabled()` | Returns collision state when provided by the selected SDK. |
| `IsGravityEnabled()` | Returns gravity state when provided by the selected SDK. |
| `IsDragEnabled()` | Returns drag state when provided by the selected SDK. |
| `IsMotionEnabled()` | Returns motion state when provided by the selected SDK. |
| `IsMoveable()` | Returns whether the object can move. |
| `IsAttachedToConstraint(bPhysicsConstraintExternalOnly = false)` | Returns whether the object is attached to a constraint; `true` restricts the native check to external constraints. The optional argument must be a boolean. |
| `GetName()` | Returns a JavaScript string copied from the native SDK object name. |
| `EnableCollisions(bPhysicsObjectBooleanSetterEnabled = true)` | Enables or disables collisions and returns `true`; the optional argument must be a boolean. |
| `EnableGravity(bPhysicsObjectBooleanSetterEnabled = true)` | Enables or disables gravity and returns `true`; the optional argument must be a boolean. |
| `EnableDrag(bPhysicsObjectBooleanSetterEnabled = true)` | Enables or disables drag and returns `true`; the optional argument must be a boolean. |
| `EnableMotion(bPhysicsObjectBooleanSetterEnabled = true)` | Enables or disables motion and returns `true`; the optional argument must be a boolean. |
| `SetAsleep(bPhysicsObjectBooleanSetterEnabled = true)` | Sleeps the object, or wakes it when `false`, and returns `true`; the optional argument must be a boolean. |
| `GetGameData()` / `SetGameData(unPhysicsObjectGameDataAddress)` | The getter returns the borrowed game-data address as a JavaScript `bigint` (`0n` for null). The setter requires a non-negative `bigint` that fits `uintptr_t` (`0n` sets null), passes the borrowed address to the native object, and returns `true`. No ownership is transferred; the address is usable only while its native storage remains valid. |
| `GetGameFlags()` / `SetGameFlags(unPhysicsObjectGameFlags)` | Reads game flags; the setter requires an unsigned 16-bit integer, writes it, and returns `true`. |
| `GetGameIndex()` / `SetGameIndex(unPhysicsObjectGameIndex)` | Reads the game index; the setter requires an unsigned 16-bit integer, writes it, and returns `true`. |
| `GetCallbackFlags()` / `SetCallbackFlags(unPhysicsObjectCallbackFlags)` | Reads callback flags; the setter requires an unsigned 16-bit integer, writes it, and returns `true`. |
| `GetMass()` / `SetMass(flPhysicsObjectMass)` | Reads mass; the setter requires a finite number in the native `float` range, writes it, and returns `true`. |
| `GetInverseMass()` | Returns the native inverse mass as a JavaScript `number`. |
| `GetMaterialIndex()` / `SetMaterialIndex(nPhysicsObjectMaterialIndex)` | Reads the material index; the setter requires a signed 32-bit integer, writes it, and returns `true`. |
| `GetContents()` / `SetContents(unPhysicsObjectContents)` | Reads the contents mask; the setter requires an unsigned 32-bit integer, writes it, and returns `true`. |
| `GetSphereRadius()` | Returns the collision sphere radius. |
| `SetSphereRadius(flPhysicsObjectSphereRadius)` | When provided by the selected SDK, requires one finite number in the native `float` range, sets the sphere radius, and returns `true`. |
| `GetEnergy()` | Returns the current native kinetic-energy value as a JavaScript `number`. |
| `GetInertia()` / `SetInertia(InertiaVector)` | The getter returns a fresh live inertia wrapper whose component reads and finite native-`float` writes target the borrowed native object; the wrapper remains usable only while that object lives. The bulk setter requires finite native-`float` `X`, `Y`, and `Z` fields, replaces the vector, and returns `true` after the native call. |
| `GetInverseInertia()` | Returns a live read-only inverse-inertia vector. |
| `GetMassCenterLocalSpace()` | Returns a live read-only local mass center. |
| `GetPosition()` | Returns a fresh `{ Position, Angles }` wrapper whose component reads and finite native-`float` writes target the borrowed native object; the wrapper remains usable only while that object lives. |
| `SetPosition(PhysicsObjectPositionVector, PhysicsObjectAngleValue?, bPhysicsObjectTeleport = false)` | Requires finite native-`float` `X`, `Y`, and `Z` position fields. Optional angles require finite `Pitch`, `Yaw`, and `Roll` fields and otherwise preserve the current angles; teleport must be boolean and defaults to `false`. An options object with `Position`, `Angles`, and `Teleport` is also accepted. Named fields are read and checked first, even when overridden later; a non-nullish second argument overrides named angles, and a supplied third argument overrides named teleport but must be boolean. Returns `true` after the native call. |
| `GetVelocity()` | Returns a fresh `{ LinearVelocity, AngularVelocity }` wrapper whose component reads and finite native-`float` writes target the borrowed native object; the wrapper remains usable only while that object lives. |
| `SetVelocity(PhysicsLinearVelocityValue?, PhysicsAngularVelocityValue?)` | Requires at least one non-nullish vector whose `X`, `Y`, and `Z` fields are finite native-`float` values. An object with `LinearVelocity` and `AngularVelocity` fields is also accepted; named vectors are read and checked first, even when overridden later, and only a non-nullish second positional argument replaces the named angular value. Returns `true` after the native call. |
| `SetVelocityInstantaneous(PhysicsLinearVelocityValue?, PhysicsAngularVelocityValue?)` | Immediately replaces one or both velocities. Uses the same non-nullish, finite native-`float`, options-object, and positional-precedence contract as `SetVelocity()`, then returns `true` after the native call. |
| `AddVelocity(PhysicsLinearVelocityValue?, PhysicsAngularVelocityValue?)` | Adds one or both velocities. Uses the same non-nullish, finite native-`float`, options-object, and positional-precedence contract as `SetVelocity()`, then returns `true` after the native call. |
| `ApplyForceCenter(PhysicsForceVector)` | Requires finite native-`float` `X`, `Y`, and `Z` fields, applies the world-space linear impulse at the center of mass, and returns `true` after the native call. |
| `ApplyForceOffset(PhysicsForceVector, PhysicsWorldPositionVector)` | Requires two vectors with finite native-`float` `X`, `Y`, and `Z` fields, applies the linear impulse at the supplied world-space point, and returns `true` after the native call. |
| `ApplyTorqueCenter(PhysicsTorqueImpulse)` | Requires finite native-`float` `X`, `Y`, and `Z` fields, applies the angular impulse at the center, and returns `true` after the native call. |
| `LocalToWorld(PhysicsObjectVectorTransformInput)` | Requires finite native-`float` `X`, `Y`, and `Z` fields and returns a fresh detached world-space point. |
| `WorldToLocal(PhysicsObjectVectorTransformInput)` | Requires finite native-`float` `X`, `Y`, and `Z` fields and returns a fresh detached local-space point. |
| `LocalToWorldVector(PhysicsObjectVectorTransformInput)` | Requires finite native-`float` `X`, `Y`, and `Z` fields and returns a fresh detached world-space direction without translation. |
| `WorldToLocalVector(PhysicsObjectVectorTransformInput)` | Requires finite native-`float` `X`, `Y`, and `Z` fields and returns a fresh detached local-space direction without translation. |
| `RecheckCollisionFilter()` | Re-evaluates the native collision filter and returns `true` after the native call. |
| `RecheckContactPoints()` | Rechecks the native contact points and returns `true` after the native call. |
| `GetContactPoint()` | Returns a fresh `{ Hit, Point, Object }` result. `Point` is detached; `Object` is `null` when there is no hit or the SDK supplies no contacted object; otherwise it is a borrowed physics-object wrapper usable only while the contacted native object lives. |
| `GetCollide()` | Returns the borrowed `CPhysCollide*` address as a non-negative JavaScript `bigint`, or `0n` for `nullptr`. It transfers no ownership and remains valid only while the native collide/object lifetime permits. |
| `SetTrigger(bPhysicsObjectTriggerEnabled = true)` | Requires a boolean when supplied, adds or removes native trigger behavior, and returns `true` after the native call. |
| `SetHinged(PhysicsObjectHingedAxisOrEnabledArgument = 0)` | Requires a signed-32-bit integer axis or boolean when supplied; `false` removes the native hinge, while `true` or omission hinges on axis `0`, and a successful native call returns `true`. |
| `OutputDebugInfo()` | Writes native SDK physics diagnostics to the engine console and returns `true` after the native call. |

## Environment gravity

`GetServerGravityConVarValue()` reads `sv_gravity`. `PhysicsEnvironment.SetGravity()` changes the vector used by VPhysics. They are related engine settings, but they are not the same API or value shape.

```js
const { GetActivePhysicsEnvironmentByIndex, GetServerGravityConVarValue } = require("physics");

function ReadPhysicsGravityState() {
	const PhysicsEnvironment = GetActivePhysicsEnvironmentByIndex(0, true);
	const WorldGravityVector = PhysicsEnvironment.GetGravity();
	const GravityState = {
		ServerGravityConVarValue: GetServerGravityConVarValue(),
		VPhysicsGravityVector: {
			X: WorldGravityVector.X,
			Y: WorldGravityVector.Y,
			Z: WorldGravityVector.Z,
		},
	};
	const vecPhysicsGravityValues = [
		GravityState.ServerGravityConVarValue,
		GravityState.VPhysicsGravityVector.X,
		GravityState.VPhysicsGravityVector.Y,
		GravityState.VPhysicsGravityVector.Z,
	];
	const bHasInvalidPhysicsGravityValue = vecPhysicsGravityValues.some((flPhysicsGravityValue) => !Number.isFinite(flPhysicsGravityValue));
	if (bHasInvalidPhysicsGravityValue) {
		throw new Error("The engine returned an invalid gravity value.");
	}

	return GravityState;
}

ReadPhysicsGravityState();

module.exports = { ReadPhysicsGravityState };
```

Run the mutation examples only while the environment remains alive and exclusively under your control. They save and restore state but do not coordinate with other writers. This plugin lowers gravity while loaded and restores the exact previous vector through `UnloadPlugin()`, exported under the runtime's exact `Unload` key; a failed rollback preserves both errors rather than hiding the initialization failure:

```js
const { GetActivePhysicsEnvironmentByIndex } = require("physics");

const g_PhysicsEnvironment = GetActivePhysicsEnvironmentByIndex(0, true);
const g_PreviousPhysicsGravityVector = {
	X: g_PhysicsEnvironment.Gravity.X,
	Y: g_PhysicsEnvironment.Gravity.Y,
	Z: g_PhysicsEnvironment.Gravity.Z,
};

try {
	if (!g_PhysicsEnvironment.SetGravity({ X: 0, Y: 0, Z: -300 }) || (g_PhysicsEnvironment.Gravity.Z !== -300)) {
		throw new Error("The low-gravity setting was not applied.");
	}
} catch (PhysicsInitializationError) {
	try {
		if (!g_PhysicsEnvironment.SetGravity(g_PreviousPhysicsGravityVector)) {
			throw new Error("The original gravity vector could not be restored after initialization failed.");
		}
	} catch (PhysicsRestorationError) {
		throw new AggregateError([PhysicsInitializationError, PhysicsRestorationError], "Gravity initialization and restoration both failed.");
	}

	throw PhysicsInitializationError;
}

function UnloadPlugin() {
	if (!g_PhysicsEnvironment.SetGravity(g_PreviousPhysicsGravityVector)) {
		throw new Error("The original gravity vector could not be restored.");
	}
}

module.exports = { Unload: UnloadPlugin };
```

Each gravity component is also a live write-through property. Cleanup errors are retained alongside the original operation error, even when JavaScript throws `null`:

```js
const { PhysicsEnvironment } = require("physics");

const g_PhysicsEnvironmentValue = new PhysicsEnvironment(0);
const g_flPreviousPhysicsGravityZ = g_PhysicsEnvironmentValue.Gravity.Z;
let g_bGravityOperationFailed = false;
let g_GravityOperationErrorValue = null;

try {
	g_PhysicsEnvironmentValue.Gravity.Z = -200;

	if (g_PhysicsEnvironmentValue.GetGravity().Z !== -200) {
		throw new Error("The live gravity property did not write through to VPhysics.");
	}
} catch (PhysicsOperationError) {
	g_bGravityOperationFailed = true;
	g_GravityOperationErrorValue = PhysicsOperationError;
	throw PhysicsOperationError;
} finally {
	try {
		g_PhysicsEnvironmentValue.Gravity.Z = g_flPreviousPhysicsGravityZ;
	} catch (PhysicsRestorationError) {
		if (g_bGravityOperationFailed) {
			throw new AggregateError([g_GravityOperationErrorValue, PhysicsRestorationError], "Gravity operation and restoration both failed.");
		}

		throw PhysicsRestorationError;
	}
}
```

## Air density and simulation

Air density is stored as native `float`. Round the requested temporary value with `Math.fround()` before comparing readback, including subnormal values; no physical-validity or concurrent-writer guarantee follows from a successful setter.

```js
const { GetActivePhysicsEnvironmentByIndex } = require("physics");

const g_PhysicsEnvironment = GetActivePhysicsEnvironmentByIndex(0, true);
const g_flPreviousPhysicsAirDensity = g_PhysicsEnvironment.GetAirDensity();
const g_flTemporaryPhysicsAirDensity = Math.fround(g_flPreviousPhysicsAirDensity * 0.5);
let g_bAirDensityOperationFailed = false;
let g_AirDensityOperationErrorValue = null;

try {
	if (!g_PhysicsEnvironment.SetAirDensity(g_flTemporaryPhysicsAirDensity) || (g_PhysicsEnvironment.GetAirDensity() !== g_flTemporaryPhysicsAirDensity)) {
		throw new Error("The temporary air density was not applied.");
	}

	const vecActivePhysicsObjects = g_PhysicsEnvironment.ActiveObjects();
	const vecPhysicsSimulationValues = [g_PhysicsEnvironment.GetSimulationTime(), g_PhysicsEnvironment.GetSimulationTimestep()];
	const bHasMatchingActivePhysicsObjectCount = vecActivePhysicsObjects.length === g_PhysicsEnvironment.GetActiveObjectCount();
	const bHasInvalidPhysicsSimulationValue = vecPhysicsSimulationValues.some((flPhysicsSimulationValue) => !Number.isFinite(flPhysicsSimulationValue));
	if (!bHasMatchingActivePhysicsObjectCount || bHasInvalidPhysicsSimulationValue) {
		throw new Error("The active physics environment returned inconsistent simulation state.");
	}

	const bCanGetPhysicsEnvironmentNextFrameTime = typeof g_PhysicsEnvironment.GetNextFrameTime === "function";
	if (bCanGetPhysicsEnvironmentNextFrameTime) {
		const flPhysicsEnvironmentNextFrameTime = g_PhysicsEnvironment.GetNextFrameTime();
		if (!Number.isFinite(flPhysicsEnvironmentNextFrameTime)) {
			throw new Error("The selected SDK returned an invalid next-frame time.");
		}
	}
} catch (PhysicsOperationError) {
	g_bAirDensityOperationFailed = true;
	g_AirDensityOperationErrorValue = PhysicsOperationError;
	throw PhysicsOperationError;
} finally {
	try {
		if (!g_PhysicsEnvironment.SetAirDensity(g_flPreviousPhysicsAirDensity)) {
			throw new Error("The original air density could not be restored.");
		}
	} catch (PhysicsRestorationError) {
		if (g_bAirDensityOperationFailed) {
			throw new AggregateError([g_AirDensityOperationErrorValue, PhysicsRestorationError], "Air-density operation and restoration both failed.");
		}

		throw PhysicsRestorationError;
	}
}
```

## Resolving entity objects

Use `GetEntityPhysicsObject(Entity, unPhysicsObjectListIndex)` to select one object by its zero-based position in the current active-object scan. Use `GetEntityPhysicsObjects(Entity)` to inspect that scan's matches when a compound entity has several active objects. This is not a complete ownership list: only matching objects in the active snapshots of environment indices `0` through `15` are discovered, and scan positions can change between calls.

```js
const { GetActivePhysicsEnvironmentByIndex, GetEntityPhysicsObject, GetEntityPhysicsObjects } = require("physics");
const { Entity } = require("entities/entity");

function ReadEntityPhysicsState(Entity) {
	const vecPhysicsObjects = GetEntityPhysicsObjects(Entity);
	const PhysicsObject = GetEntityPhysicsObject(Entity, 0);
	if (vecPhysicsObjects.length === 0) {
		if (PhysicsObject !== null) {
			throw new Error("GetEntityPhysicsObject() disagrees with GetEntityPhysicsObjects().");
		}

		return null;
	}

	const bHasPrimaryPhysicsObject = PhysicsObject !== null;
	const bHasMatchingPrimaryPhysicsObject = bHasPrimaryPhysicsObject && (PhysicsObject.Address === vecPhysicsObjects[0].Address);
	if (!bHasMatchingPrimaryPhysicsObject) {
		throw new Error("The primary physics object does not match list index zero.");
	}

	const PhysicsEnvironment = GetActivePhysicsEnvironmentByIndex(0);
	const EnvironmentPhysicsObject = (PhysicsEnvironment === null) ? null : PhysicsEnvironment.GetActiveObjectByEntity(Entity);
	const EntityPhysicsState = {
		PhysicsObjectAddress: PhysicsObject.Address,
		PhysicsObjectName: PhysicsObject.GetName(),
		PhysicsObjectCount: vecPhysicsObjects.length,
		IsPrimaryPhysicsEnvironmentObject: EnvironmentPhysicsObject?.Address === PhysicsObject.Address,
	};
	const bHasValidPhysicsObjectAddress = (typeof EntityPhysicsState.PhysicsObjectAddress === "bigint") && (EntityPhysicsState.PhysicsObjectAddress > 0n);
	const bHasValidPhysicsObjectName = typeof EntityPhysicsState.PhysicsObjectName === "string";
	if (!bHasValidPhysicsObjectAddress || !bHasValidPhysicsObjectName) {
		throw new Error("The entity returned an invalid physics-object descriptor.");
	}

	return EntityPhysicsState;
}

ReadEntityPhysicsState(Entity(1));

module.exports = { ReadEntityPhysicsState };
```

## Object state

The helper below reads every state query on demand, then returns detached scalar values. The individual calls are not an atomic snapshot; call it again when current state is required.

```js
const { Entity } = require("entities/entity");
const { GetEntityPhysicsObject } = require("physics");

function ReadObjectState(Entity) {
	const PhysicsObject = GetEntityPhysicsObject(Entity);
	if (PhysicsObject === null) {
		return null;
	}

	const OptionalState = {};
	for (const strMethodName of ["IsCollisionEnabled", "IsGravityEnabled", "IsDragEnabled", "IsMotionEnabled"]) {
		if (typeof PhysicsObject[strMethodName] === "function") {
			OptionalState[strMethodName] = PhysicsObject[strMethodName]();
		}
	}

	const State = {
		Name: PhysicsObject.GetName(),
		Static: PhysicsObject.IsStatic(),
		Asleep: PhysicsObject.IsAsleep(),
		Trigger: PhysicsObject.IsTrigger(),
		Fluid: PhysicsObject.IsFluid(),
		Hinged: PhysicsObject.IsHinged(),
		Moveable: PhysicsObject.IsMoveable(),
		Constrained: PhysicsObject.IsAttachedToConstraint(false),
		ExternallyConstrained: PhysicsObject.IsAttachedToConstraint(true),
		Mass: PhysicsObject.GetMass(),
		InverseMass: PhysicsObject.GetInverseMass(),
		Energy: PhysicsObject.GetEnergy(),
		MaterialIndex: PhysicsObject.GetMaterialIndex(),
		Contents: PhysicsObject.GetContents(),
		SphereRadius: PhysicsObject.GetSphereRadius(),
		GameFlags: PhysicsObject.GetGameFlags(),
		GameIndex: PhysicsObject.GetGameIndex(),
		CallbackFlags: PhysicsObject.GetCallbackFlags(),
		GameDataAddress: PhysicsObject.GetGameData(),
		CollideAddress: PhysicsObject.GetCollide(),
		...OptionalState,
	};
	const vecBooleanValues = [
		State.Static,
		State.Asleep,
		State.Trigger,
		State.Fluid,
		State.Hinged,
		State.Moveable,
		State.Constrained,
		State.ExternallyConstrained,
		...Object.values(OptionalState),
	];
	const vecNumericValues = [
		State.Mass,
		State.InverseMass,
		State.Energy,
		State.MaterialIndex,
		State.Contents,
		State.SphereRadius,
		State.GameFlags,
		State.GameIndex,
		State.CallbackFlags,
	];
	const bHasValidStateName = typeof State.Name === "string";
	const bHasValidBooleanValues = vecBooleanValues.every((bStateValue) => typeof bStateValue === "boolean");
	const bHasValidNumericValues = vecNumericValues.every(Number.isFinite);
	const bHasValidPhysicsAddressValues = (typeof State.GameDataAddress === "bigint") && (State.GameDataAddress >= 0n) && (typeof State.CollideAddress === "bigint") && (State.CollideAddress >= 0n);
	if (!bHasValidStateName || !bHasValidBooleanValues || !bHasValidNumericValues || !bHasValidPhysicsAddressValues) {
		throw new Error("The physics object returned invalid state.");
	}

	return State;
}

ReadObjectState(Entity(1));

module.exports = { ReadObjectState };
```

## Mass, inertia, and flags

Use a controlled test entity with exclusive access to its live physics object. These examples restore the listed fields, not every simulation, collision, or wake/sleep side effect, and cannot guarantee rollback if the SDK fails. Every saved-field restoration is attempted independently; combined errors retain the original operation first.

```js
const { Entity } = require("entities/entity");
const { GetEntityPhysicsObject } = require("physics");

const g_PhysicsObject = GetEntityPhysicsObject(Entity(1));
if (g_PhysicsObject === null) {
	throw new Error("Entity 1 has no active physics object.");
}

const g_flPreviousMass = g_PhysicsObject.GetMass();
const g_nPreviousMaterialIndex = g_PhysicsObject.GetMaterialIndex();
const g_unPreviousContents = g_PhysicsObject.GetContents();
const g_unPreviousGameFlags = g_PhysicsObject.GetGameFlags();
const g_unPreviousGameIndex = g_PhysicsObject.GetGameIndex();
const g_unPreviousCallbackFlags = g_PhysicsObject.GetCallbackFlags();
const g_unPreviousGameDataAddress = g_PhysicsObject.GetGameData();
const g_PhysicsInertia = g_PhysicsObject.GetInertia();
const g_PreviousInertia = { X: g_PhysicsInertia.X, Y: g_PhysicsInertia.Y, Z: g_PhysicsInertia.Z };
const g_ChangedInertia = {
	X: Math.fround(g_PreviousInertia.X * 1.25),
	Y: Math.fround(g_PreviousInertia.Y * 1.25),
	Z: Math.fround(g_PreviousInertia.Z * 1.25),
};

const g_flChangedMass = Math.fround(g_flPreviousMass * 1.5);
const g_dblFloatComparisonTolerance = 0.0001;
const g_IsClose = (flLeft, flRight) => Math.abs(flLeft - flRight) <= g_dblFloatComparisonTolerance;
let g_bObjectOperationFailed = false;
let g_ObjectOperationErrorValue = null;

const g_vecPropertyUpdates = [
	{ Name: "Mass", Apply: () => g_PhysicsObject.SetMass(g_flChangedMass), Restore: () => g_PhysicsObject.SetMass(g_flPreviousMass) },
	{ Name: "MaterialIndex", Apply: () => g_PhysicsObject.SetMaterialIndex(g_nPreviousMaterialIndex), Restore: () => g_PhysicsObject.SetMaterialIndex(g_nPreviousMaterialIndex) },
	{ Name: "Contents", Apply: () => g_PhysicsObject.SetContents(g_unPreviousContents), Restore: () => g_PhysicsObject.SetContents(g_unPreviousContents) },
	{ Name: "GameFlags", Apply: () => g_PhysicsObject.SetGameFlags(g_unPreviousGameFlags), Restore: () => g_PhysicsObject.SetGameFlags(g_unPreviousGameFlags) },
	{ Name: "GameIndex", Apply: () => g_PhysicsObject.SetGameIndex(g_unPreviousGameIndex), Restore: () => g_PhysicsObject.SetGameIndex(g_unPreviousGameIndex) },
	{ Name: "CallbackFlags", Apply: () => g_PhysicsObject.SetCallbackFlags(g_unPreviousCallbackFlags), Restore: () => g_PhysicsObject.SetCallbackFlags(g_unPreviousCallbackFlags) },
	{ Name: "GameData", Apply: () => g_PhysicsObject.SetGameData(g_unPreviousGameDataAddress), Restore: () => g_PhysicsObject.SetGameData(g_unPreviousGameDataAddress) },
	{ Name: "Inertia", Apply: () => g_PhysicsObject.SetInertia(g_ChangedInertia), Restore: () => g_PhysicsObject.SetInertia(g_PreviousInertia) },
];

try {
	for (const PropertyUpdate of g_vecPropertyUpdates) {
		if (PropertyUpdate.Apply() !== true) {
			throw new Error(`The ${PropertyUpdate.Name} property could not be updated.`);
		}
	}

	const CurrentInertia = g_PhysicsObject.GetInertia();
	const bMassMatches = g_IsClose(g_PhysicsObject.GetMass(), g_flChangedMass);
	const bInertiaXMatches = g_IsClose(CurrentInertia.X, g_ChangedInertia.X);
	const bInertiaYMatches = g_IsClose(CurrentInertia.Y, g_ChangedInertia.Y);
	const bInertiaZMatches = g_IsClose(CurrentInertia.Z, g_ChangedInertia.Z);
	if (!bMassMatches || !bInertiaXMatches || !bInertiaYMatches || !bInertiaZMatches) {
		throw new Error("Mass or inertia did not change as requested.");
	}

	if (typeof g_PhysicsObject.SetSphereRadius === "function") {
		const flPreviousRadius = g_PhysicsObject.GetSphereRadius();
		if (!g_PhysicsObject.SetSphereRadius(flPreviousRadius)) {
			throw new Error("The selected SDK rejected the existing sphere radius.");
		}
	}

	for (const DerivedVector of [g_PhysicsObject.GetInverseInertia(), g_PhysicsObject.GetMassCenterLocalSpace()]) {
		if (![DerivedVector.X, DerivedVector.Y, DerivedVector.Z].every(Number.isFinite)) {
			throw new Error("The physics object returned an invalid derived vector.");
		}
	}
} catch (PhysicsOperationError) {
	g_bObjectOperationFailed = true;
	g_ObjectOperationErrorValue = PhysicsOperationError;
	throw PhysicsOperationError;
} finally {
	const vecRestorationErrors = [];
	for (const Restoration of g_vecPropertyUpdates) {
		try {
			if (Restoration.Restore() !== true) {
				throw new Error(`The original ${Restoration.Name} property could not be restored.`);
			}
		} catch (PhysicsRestorationError) {
			vecRestorationErrors.push(PhysicsRestorationError);
		}
	}

	if (vecRestorationErrors.length > 0) {
		if (g_bObjectOperationFailed) {
			vecRestorationErrors.unshift(g_ObjectOperationErrorValue);
		}

		throw new AggregateError(vecRestorationErrors, "Physics-object operation or restoration failed.");
	}
}
```

## Position and velocity

The nested position and velocity objects are live. Assigning one component immediately calls the native setter while retaining the other components. Readback uses native-`float` rounding; cleanup attempts both saved components even when the first assignment throws:

```js
const { Entity } = require("entities/entity");
const { GetEntityPhysicsObject } = require("physics");

const g_PhysicsObject = GetEntityPhysicsObject(Entity(1));
if (g_PhysicsObject === null) {
	throw new Error("Entity 1 has no active physics object.");
}

const g_flPreviousPositionZ = g_PhysicsObject.Position.Position.Z;
const g_flPreviousLinearZ = g_PhysicsObject.Velocity.LinearVelocity.Z;
const g_flChangedPositionZ = Math.fround(g_flPreviousPositionZ + 16);
let g_bTransformOperationFailed = false;
let g_TransformOperationErrorValue = null;

try {
	g_PhysicsObject.Position.Position.Z = g_flChangedPositionZ;
	g_PhysicsObject.Velocity.LinearVelocity.Z = 250;

	const bPositionZMatches = g_PhysicsObject.GetPosition().Position.Z === g_flChangedPositionZ;
	const bLinearVelocityZMatches = g_PhysicsObject.GetVelocity().LinearVelocity.Z === 250;
	if (!bPositionZMatches || !bLinearVelocityZMatches) {
		throw new Error("The live transform properties did not write through.");
	}
} catch (PhysicsOperationError) {
	g_bTransformOperationFailed = true;
	g_TransformOperationErrorValue = PhysicsOperationError;
	throw PhysicsOperationError;
} finally {
	const vecRestorationErrors = [];
	try {
		g_PhysicsObject.Position.Position.Z = g_flPreviousPositionZ;
	} catch (PhysicsRestorationError) {
		vecRestorationErrors.push(PhysicsRestorationError);
	}

	try {
		g_PhysicsObject.Velocity.LinearVelocity.Z = g_flPreviousLinearZ;
	} catch (PhysicsRestorationError) {
		vecRestorationErrors.push(PhysicsRestorationError);
	}

	if (vecRestorationErrors.length > 0) {
		if (g_bTransformOperationFailed) {
			vecRestorationErrors.unshift(g_TransformOperationErrorValue);
		}

		throw new AggregateError(vecRestorationErrors, "Transform operation or component restoration failed.");
	}
}
```

Use an explicit vector method when several components must change in one native call. Multiple calls below are still not a transaction; restoration may fail, but a failed velocity restoration must not prevent the position attempt:

```js
const { Entity } = require("entities/entity");
const { GetEntityPhysicsObject } = require("physics");

const g_PhysicsObject = GetEntityPhysicsObject(Entity(1));
if (g_PhysicsObject === null) {
	throw new Error("Entity 1 has no active physics object.");
}

const g_CurrentTransform = g_PhysicsObject.GetPosition();
const g_CurrentVelocity = g_PhysicsObject.GetVelocity();
const g_PreviousPosition = { X: g_CurrentTransform.Position.X, Y: g_CurrentTransform.Position.Y, Z: g_CurrentTransform.Position.Z };
const g_PreviousAngles = { Pitch: g_CurrentTransform.Angles.Pitch, Yaw: g_CurrentTransform.Angles.Yaw, Roll: g_CurrentTransform.Angles.Roll };
const g_PreviousLinearVelocity = { X: g_CurrentVelocity.LinearVelocity.X, Y: g_CurrentVelocity.LinearVelocity.Y, Z: g_CurrentVelocity.LinearVelocity.Z };
const g_PreviousAngularVelocity = { X: g_CurrentVelocity.AngularVelocity.X, Y: g_CurrentVelocity.AngularVelocity.Y, Z: g_CurrentVelocity.AngularVelocity.Z };
let g_bTransformOperationFailed = false;
let g_TransformOperationErrorValue = null;

try {
	if (!g_PhysicsObject.SetPosition({ X: g_PreviousPosition.X, Y: g_PreviousPosition.Y, Z: g_PreviousPosition.Z + 32 }, g_PreviousAngles, true)) {
		throw new Error("The physics-object position could not be changed.");
	}

	if (!g_PhysicsObject.SetVelocity({ X: 0, Y: 0, Z: 300 }, { X: 0, Y: 90, Z: 0 }) || !g_PhysicsObject.AddVelocity({ X: 25, Y: 0, Z: 0 })) {
		throw new Error("The physics-object velocity could not be changed.");
	}

	const ChangedVelocity = g_PhysicsObject.GetVelocity();
	if ((ChangedVelocity.LinearVelocity.X !== 25) || (ChangedVelocity.LinearVelocity.Z !== 300) || (ChangedVelocity.AngularVelocity.Y !== 90)) {
		throw new Error("The physics-object velocity did not match the requested values.");
	}

	if (!g_PhysicsObject.SetVelocityInstantaneous({ X: 0, Y: 0, Z: 0 }, { X: 0, Y: 0, Z: 0 })) {
		throw new Error("The instantaneous velocity update failed.");
	}
} catch (PhysicsOperationError) {
	g_bTransformOperationFailed = true;
	g_TransformOperationErrorValue = PhysicsOperationError;
	throw PhysicsOperationError;
} finally {
	const vecRestorationErrors = [];
	try {
		if (!g_PhysicsObject.SetVelocityInstantaneous(g_PreviousLinearVelocity, g_PreviousAngularVelocity)) {
			throw new Error("The original physics-object velocity could not be restored.");
		}
	} catch (PhysicsRestorationError) {
		vecRestorationErrors.push(PhysicsRestorationError);
	}

	try {
		if (!g_PhysicsObject.SetPosition(g_PreviousPosition, g_PreviousAngles, true)) {
			throw new Error("The original physics-object position could not be restored.");
		}
	} catch (PhysicsRestorationError) {
		vecRestorationErrors.push(PhysicsRestorationError);
	}

	if (vecRestorationErrors.length > 0) {
		if (g_bTransformOperationFailed) {
			vecRestorationErrors.unshift(g_TransformOperationErrorValue);
		}

		throw new AggregateError(vecRestorationErrors, "Transform operation or restoration failed.");
	}
}
```

## Forces and coordinate transforms

Use a disposable, controlled test object: these calls apply impulses and can alter the simulation beyond the listed fields. They are not a rollback demonstration. The selected SDK describes linear impulse in kg·in/s and angular impulse in kg·degrees/s, with its native axes. These are not continuously applied forces. Check every call immediately; later failure cannot undo an earlier impulse.

```js
const { GetEntityPhysicsObject } = require("physics");

// Pass an entity owning a disposable test physics object; already-applied impulses are not undone.
function ApplyForcesToTestPhysicsObject(Entity) {
	const PhysicsObject = GetEntityPhysicsObject(Entity);
	if (PhysicsObject === null) {
		throw new Error("The supplied entity has no active physics object.");
	}

	const Transform = PhysicsObject.GetPosition();
	const Center = { X: Transform.Position.X, Y: Transform.Position.Y, Z: Transform.Position.Z };
	const LocalPoint = PhysicsObject.WorldToLocal(Center);
	const WorldPoint = PhysicsObject.LocalToWorld(LocalPoint);
	const LocalUp = PhysicsObject.WorldToLocalVector({ X: 0, Y: 0, Z: 1 });
	const WorldUp = PhysicsObject.LocalToWorldVector(LocalUp);
	const dblTransformComparisonTolerance = 0.0001;
	const IsClose = (flLeft, flRight) => Math.abs(flLeft - flRight) <= dblTransformComparisonTolerance;
	const bWorldPointMatches = ["X", "Y", "Z"].every((strComponentName) => IsClose(WorldPoint[strComponentName], Center[strComponentName]));
	const bWorldUpMatches = ["X", "Y", "Z"].every((strComponentName) => IsClose(WorldUp[strComponentName], (strComponentName === "Z") ? 1 : 0));
	if (!bWorldPointMatches || !bWorldUpMatches) {
		throw new Error("The local/world coordinate transforms did not round-trip.");
	}

	const vecImpulseActions = [
		{ Name: "ApplyForceCenter", Apply: () => PhysicsObject.ApplyForceCenter({ X: 0, Y: 0, Z: 5000 }) },
		{ Name: "ApplyForceOffset", Apply: () => PhysicsObject.ApplyForceOffset({ X: 1000, Y: 0, Z: 0 }, { X: Center.X, Y: Center.Y, Z: Center.Z + 16 }) },
		{ Name: "ApplyTorqueCenter", Apply: () => PhysicsObject.ApplyTorqueCenter({ X: 0, Y: 0, Z: 200 }) },
	];
	for (const ImpulseAction of vecImpulseActions) {
		if (ImpulseAction.Apply() !== true) {
			throw new Error(`${ImpulseAction.Name}() failed; an earlier impulse may already have been applied.`);
		}
	}
}
```

## Collision, motion, and contacts

Older SDK interfaces can expose the four `Enable*()` operations without matching `Is*Enabled()` queries. The example changes only states whose previous boolean value can be read. Use exclusive control of a live test object: restoring flags does not undo every wake/sleep, simulation, collision-filter, or contact-cache side effect. Every saved-state restoration is attempted even after another fails.

```js
const { Entity } = require("entities/entity");
const { GetEntityPhysicsObject } = require("physics");

const g_PhysicsObject = GetEntityPhysicsObject(Entity(1));
if (g_PhysicsObject === null) {
	throw new Error("Entity 1 has no active physics object.");
}

const g_bPreviousAsleep = g_PhysicsObject.IsAsleep();
if (typeof g_bPreviousAsleep !== "boolean") {
	throw new Error("The previous sleep state is not a boolean.");
}

const g_vecOptionalStates = [];
for (const vecMethodNames of [
	["IsCollisionEnabled", "EnableCollisions"],
	["IsGravityEnabled", "EnableGravity"],
	["IsDragEnabled", "EnableDrag"],
	["IsMotionEnabled", "EnableMotion"],
]) {
	const strGetterName = vecMethodNames[0];
	const strSetterName = vecMethodNames[1];
	const bHasGetter = typeof g_PhysicsObject[strGetterName] === "function";
	const bHasSetter = typeof g_PhysicsObject[strSetterName] === "function";
	if (!bHasSetter) {
		throw new Error(`The selected SDK does not expose the required ${strSetterName}() operation.`);
	}

	if (!bHasGetter) {
		continue;
	}

	const bStateValue = g_PhysicsObject[strGetterName]();
	if (typeof bStateValue !== "boolean") {
		throw new Error(`The previous ${strGetterName}() state is not a boolean.`);
	}

	g_vecOptionalStates.push({ GetterName: strGetterName, SetterName: strSetterName, StateValue: bStateValue });
}

let g_bCollisionOperationFailed = false;
let g_CollisionOperationErrorValue = null;

try {
	for (const OptionalState of g_vecOptionalStates) {
		const strGetterName = OptionalState.GetterName;
		const strSetterName = OptionalState.SetterName;
		if (!g_PhysicsObject[strSetterName](true) || (g_PhysicsObject[strGetterName]() !== true)) {
			throw new Error(`${strSetterName}(true) failed.`);
		}
	}

	if (!g_PhysicsObject.SetAsleep(false) || g_PhysicsObject.IsAsleep()) {
		throw new Error("The physics object could not be awakened.");
	}

	if (!g_PhysicsObject.RecheckCollisionFilter() || !g_PhysicsObject.RecheckContactPoints()) {
		throw new Error("The physics object could not refresh its collision state.");
	}

	const Contact = g_PhysicsObject.GetContactPoint();
	if (!Contact || (typeof Contact.Hit !== "boolean")) {
		throw new Error("GetContactPoint() returned an invalid result.");
	}

	if (Contact.Hit) {
		if (!Contact.Point || ![Contact.Point.X, Contact.Point.Y, Contact.Point.Z].every(Number.isFinite)) {
			throw new Error("The contact point is not a finite vector.");
		}

		if ((Contact.Object !== null) && ((typeof Contact.Object.Address !== "bigint") || (Contact.Object.Address <= 0n))) {
			throw new Error("The contact object has an invalid address.");
		}
	}
} catch (PhysicsOperationError) {
	g_bCollisionOperationFailed = true;
	g_CollisionOperationErrorValue = PhysicsOperationError;
	throw PhysicsOperationError;
} finally {
	const vecRestorationErrors = [];
	for (const OptionalState of g_vecOptionalStates) {
		const strGetterName = OptionalState.GetterName;
		const strSetterName = OptionalState.SetterName;
		const bStateValue = OptionalState.StateValue;
		try {
			if (!g_PhysicsObject[strSetterName](bStateValue) || (g_PhysicsObject[strGetterName]() !== bStateValue)) {
				throw new Error(`The original ${strSetterName}() state could not be restored.`);
			}
		} catch (PhysicsRestorationError) {
			vecRestorationErrors.push(PhysicsRestorationError);
		}
	}

	try {
		if (!g_PhysicsObject.SetAsleep(g_bPreviousAsleep) || (g_PhysicsObject.IsAsleep() !== g_bPreviousAsleep)) {
			throw new Error("The original sleep state could not be restored.");
		}
	} catch (PhysicsRestorationError) {
		vecRestorationErrors.push(PhysicsRestorationError);
	}

	if (vecRestorationErrors.length > 0) {
		if (g_bCollisionOperationFailed) {
			vecRestorationErrors.unshift(g_CollisionOperationErrorValue);
		}

		throw new AggregateError(vecRestorationErrors, "Collision operation or state restoration failed.");
	}
}
```

Trigger and hinge state are direct SDK mutations. Use a controlled test object and apply them only when game logic permits it. This example leaves an existing hinge untouched because its original axis is not queried; a newly applied hinge uses local axis `2` and is removed on exit. Trigger restoration and new-hinge removal are independent attempts, not a complete reversal of native side effects:

```js
const { Entity } = require("entities/entity");
const { GetEntityPhysicsObject } = require("physics");

const g_PhysicsObject = GetEntityPhysicsObject(Entity(1));
if (g_PhysicsObject === null) {
	throw new Error("Entity 1 has no active physics object.");
}

const g_bWasTrigger = g_PhysicsObject.IsTrigger();
const g_bWasHinged = g_PhysicsObject.IsHinged();
if ((typeof g_bWasTrigger !== "boolean") || (typeof g_bWasHinged !== "boolean")) {
	throw new Error("The previous trigger and hinge states must be booleans.");
}

let g_bTriggerOperationFailed = false;
let g_TriggerOperationErrorValue = null;

try {
	const bTemporaryTrigger = !g_bWasTrigger;
	if (!g_PhysicsObject.SetTrigger(bTemporaryTrigger) || (g_PhysicsObject.IsTrigger() !== bTemporaryTrigger)) {
		throw new Error("The temporary trigger state was not applied.");
	}

	if (!g_bWasHinged && (!g_PhysicsObject.SetHinged(2) || !g_PhysicsObject.IsHinged())) {
		throw new Error("The temporary hinge was not applied on axis 2.");
	}

	if (!g_PhysicsObject.OutputDebugInfo()) {
		throw new Error("The SDK physics diagnostics could not be emitted.");
	}
} catch (PhysicsOperationError) {
	g_bTriggerOperationFailed = true;
	g_TriggerOperationErrorValue = PhysicsOperationError;
	throw PhysicsOperationError;
} finally {
	const vecRestorationErrors = [];
	try {
		if (!g_PhysicsObject.SetTrigger(g_bWasTrigger) || (g_PhysicsObject.IsTrigger() !== g_bWasTrigger)) {
			throw new Error("The original trigger state could not be restored.");
		}
	} catch (PhysicsRestorationError) {
		vecRestorationErrors.push(PhysicsRestorationError);
	}

	if (!g_bWasHinged) {
		try {
			if (!g_PhysicsObject.SetHinged(false) || g_PhysicsObject.IsHinged()) {
				throw new Error("The temporary hinge could not be removed.");
			}
		} catch (PhysicsRestorationError) {
			vecRestorationErrors.push(PhysicsRestorationError);
		}
	}

	if (vecRestorationErrors.length > 0) {
		if (g_bTriggerOperationFailed) {
			vecRestorationErrors.unshift(g_TriggerOperationErrorValue);
		}

		throw new AggregateError(vecRestorationErrors, "Trigger/hinge operation or restoration failed.");
	}
}
```

## Address and constructor interop

Address factories wrap existing engine objects. They do not allocate or validate the lifetime/type of the native object, and every address must fit the native width and satisfy the target type's alignment. Constructors return decorated native wrappers; matching addresses do not establish JavaScript object identity, `instanceof`, or valid native lifetime. `Address` and an environment's `Index` are writable JavaScript metadata, not safe retargeting operations. Do not overwrite them: environment/object methods can resolve a changed `Address`, while live component views keep the native object captured when constructed. Interface environment lookups use the runtime's connected `IPhysics`, not an arbitrary address recorded by an interface factory. Pass a physics wrapper or an `IPhysicsObject*` address to `ResolvePhysicsObject()`/`new PhysicsObject()`, never a base-entity `Address`; resolve entities with `GetEntityPhysicsObject()` first.

```js
const {
	CreatePhysicsEnvironmentFromAddress,
	CreatePhysicsInterfaceFromAddress,
	CreatePhysicsObjectFromAddress,
	GetEntityPhysicsObject,
	PhysicsEnvironment,
	PhysicsInterface,
	PhysicsObject,
	PHYSICS_INTERFACE,
	ResolvePhysicsObject,
} = require("physics");
const { Entity } = require("entities/entity");

const g_PhysicsInterfaceInstance = new PhysicsInterface();
const g_SameInterface = CreatePhysicsInterfaceFromAddress(PHYSICS_INTERFACE.Address);
const g_SameInterfaceFromClass = PhysicsInterface.CreatePhysicsInterfaceFromAddress(g_PhysicsInterfaceInstance.Address);

const g_Environment = new PhysicsEnvironment(0);
const g_SameEnvironment = CreatePhysicsEnvironmentFromAddress(g_Environment.Address, g_Environment.Index);
const g_SameEnvironmentFromClass = PhysicsEnvironment.CreatePhysicsEnvironmentFromAddress(g_Environment.Address);

const g_EntityPhysicsObject = GetEntityPhysicsObject(Entity(1));
if (g_EntityPhysicsObject === null) {
	throw new Error("Entity 1 has no active physics object.");
}

const g_NormalizedPhysicsObject = ResolvePhysicsObject(g_EntityPhysicsObject, true);
const g_NormalizedObjectFromAddress = ResolvePhysicsObject(g_EntityPhysicsObject.Address, true);
const g_SameObject = CreatePhysicsObjectFromAddress(g_EntityPhysicsObject.Address);
const g_SameObjectFromClass = PhysicsObject.CreatePhysicsObjectFromAddress(g_EntityPhysicsObject.Address);
const g_ConstructedObject = new PhysicsObject(g_EntityPhysicsObject.Address);
const g_vecInterfaces = [g_PhysicsInterfaceInstance, g_SameInterface, g_SameInterfaceFromClass];
const g_vecEnvironments = [g_Environment, g_SameEnvironment, g_SameEnvironmentFromClass];
const g_vecPhysicsObjects = [
	g_EntityPhysicsObject,
	g_NormalizedPhysicsObject,
	g_NormalizedObjectFromAddress,
	g_SameObject,
	g_SameObjectFromClass,
	g_ConstructedObject,
];

if (!g_vecInterfaces.every((PhysicsInterfaceValue) => PhysicsInterfaceValue.Address === PHYSICS_INTERFACE.Address)) {
	throw new Error("The IPhysics address factories did not preserve address identity.");
}

if (!g_vecEnvironments.every((PhysicsEnvironmentValue) => PhysicsEnvironmentValue.Address === g_Environment.Address)) {
	throw new Error("The IPhysicsEnvironment address factories did not preserve address identity.");
}

if (!g_vecPhysicsObjects.every((PhysicsObjectValue) => PhysicsObjectValue.Address === g_EntityPhysicsObject.Address)) {
	throw new Error("The IPhysicsObject factories did not preserve address identity.");
}
```

## Errors

- Loading the module fails when SourceJS did not install the native `physics` object for the selected SDK.
- Reading `PHYSICS_INTERFACE` throws when the live VPhysics interface is disconnected.
- Address factories reject zero, negative, non-BigInt, out-of-range, and incorrectly aligned addresses. They cannot prove that an otherwise valid BigInt still names a live SDK object.
- Native address/entity/receiver resolution and the `sv_gravity` lookup preserve V8 exceptions and termination and
  translate native C++ exceptions. A failing object `Address` getter stops resolution rather than falling back to an
  entity lookup; ordinary missing-object results remain nullable.
- The module-level `GetActivePhysicsEnvironmentByIndex()` and `ResolvePhysicsObject()` lookups return `null` when nothing is present. Pass their `bRequired = true` argument or use the corresponding constructor when absence must throw. Entity-list lookups remain nullable and do not accept `bRequired`.
- Mutators check the supplied receiver and vector/scalar types and ranges before the mutating SDK call. Ordinary
  unresolved lookups can instead return `null` or an empty array. Representation checks do not prove native memory
  validity. A setter may query current state to preserve omitted components; `SetPosition()` reads the current pose.
- Vector/angle and scalar conversion boundaries preserve getter/V8 failures and translate native C++ exceptions.
  All required components or the strict scalar type/range are checked before committing the converted output;
  booleans, signed/unsigned 32-bit values, UInt16 values and finite native-range floats retain their existing contracts.
- Live position, angle, velocity, inertia, inverse-inertia and mass-center component getters translate native C++
  exceptions and stop before publishing an SDK result when V8 reports an exception or termination. They still borrow
  the native physics object; these failure boundaries do not validate its lifetime or memory.
- Live component setters validate finite native-range floats before reading/updating the SDK object. Position/angle
  edits preserve the other transform components and do not teleport; velocity edits preserve the other velocity
  components. Inverse inertia and mass center remain read-only. V8 failures and native C++ exceptions stop the
  operation, but cannot roll back an SDK mutation already performed.
- Vector, position, velocity, inertia, inverse-inertia and mass-center record construction checks allocation,
  component accessor installation and own-property publication before returning a completed record. Snapshot components
  and nested records use own data properties rather than invoking inherited setters. These boundaries preserve V8
  failures/termination and translate native C++ exceptions; they do not extend the borrowed physics object's lifetime.
- Boolean/numeric state and constraint-attachment queries, boolean/numeric setters and the optional sphere-radius
  setter also contain V8/C++ failure boundaries. Queries stage SDK results before V8 allocation/publication; setters
  report success only after the SDK call completes without a reported failure. Existing argument defaults, strict
  numeric validation and internal callback-operation bounds are enforced; this is not physical-validity validation
  or a documented legal-axis check for `SetHinged()`. SDK-specific methods remain absent when unsupported.
- Game-data address queries/updates and inertia, inverse-inertia, mass-center, position and velocity record queries
  also preserve V8 failures/termination and translate C++ exceptions. Game-data addresses remain strict native-width
  non-negative BigInt values; `0n` represents/sets null user data, not a missing physics object.
- `SetPosition()` stops after the first failing options getter. Successful reads retain `Position`, `Angles`, then
  `Teleport` order. Named values are validated before overrides; only non-nullish positional angles and a supplied boolean teleport override them. Teleport otherwise keeps its named value or defaults to `false`.
- Velocity argument parsing stops after a failing getter/conversion and stages both values before committing
  caller-owned outputs. Nullish positional vectors remain omitted; named vectors are validated before any non-nullish
  positional angular override. Ordinary invalid/missing vector results retain the caller's argument diagnostic. These boundaries
  neither validate borrowed native memory nor roll back an SDK mutation already performed.
- Velocity updates, force/torque application, vector transforms and collision/contact rechecks also preserve V8
  failures/termination and translate C++ exceptions. A failed parser's original exception is not replaced by a generic
  argument diagnostic; mutators report success only after the SDK call completes without a reported failure.
- Contact-point queries check the SDK result, record allocation, contact-object wrapping and own `Hit`, `Point`,
  `Object` property installation before returning the record, without invoking inherited setters. `Point` remains an
  `X`/`Y`/`Z` snapshot; `Object` stays `null` when no hit or no contact object is supplied. The wrapped object still borrows
  native storage, and these checks neither prove its validity/lifetime nor roll back an SDK mutation.
- SDK-dependent methods are absent when the selected interface does not declare the operation. Check the concrete function before using an optional capability.
- Collide-address, name, inverse-mass and energy queries, trigger/hinge updates and debug output also preserve V8
  failures/termination and translate C++ exceptions. `GetCollide()` returns a native-width BigInt, including `0n` for
  a null collide object. `SetTrigger()` defaults to enabled; `SetHinged()` keeps the omitted/`true` default axis, the
  `false` removal path and strict integer-axis input. SDK mutations already performed cannot be rolled back here.
- Physics-object construction checks each nested view and installs its six fields and all available methods as own
  data properties, without invoking inherited setters. Method creation, callback metadata and installation failures
  stop construction; optional sphere-radius support and registration order remain SDK-dependent and unchanged.
  The completed wrapper still borrows the native object and does not validate or extend its lifetime.
- Environment live-gravity metadata, accessors and record construction, gravity/air-density queries and setters,
  active-object count/list queries and entity-index lookup preserve V8 failures/termination and translate C++
  exceptions. A live gravity-component edit validates the value, reads the current vector and updates only that
  component; selected-SDK gravity call signatures remain unchanged. Native mutations are not rolled back.
- `ActiveObjects()` rejects a negative SDK count or a null list entry and publishes only a completed array, using
  own indexed properties rather than inherited setters. Zero active objects produce an empty array. Entity-index
  lookup skips null entries and stays nullable for no match. Counts/lists must remain stable during enumeration;
  these wrappers do not validate native storage or extend its lifetime.
- Environment simulation-state/time/timestep queries and the SDK-conditional next-frame-time query preserve V8
  failures/termination and translate C++ exceptions before publishing a result. Active-environment and entity-object
  lookups retain their ordinary nullable results; a reported conversion, SDK or wrapper-construction failure is not treated
  as a missing object. Required-environment lookup still throws when no environment exists.
- Environment construction checks creation of its native-width BigInt address, gravity view and available methods before
  returning the wrapper. `Index`, `Address`, `Gravity` and methods are own data properties, without invoking inherited
  setters. Registration order, SDK availability and borrowed native lifetime remain unchanged; address factories
  require valid live storage and do not establish ownership or validate foreign memory.
- Entity-object queries, object/interface address factories and live-interface access preserve V8 failures/termination
  and translate C++ exceptions before publishing a result. `ObjectByEntity()` defaults to list index `0`; `Object()`
  defaults to non-required lookup. A reported failure is not converted to `null`; required unresolved lookup throws.
- `ObjectsByEntity()` checks the collected count before narrowing, rejects null entries and installs own indexed
  properties before publishing the completed array. No matches still produce an empty array; collection is limited to active snapshots in environment slots `0..15`, skipping non-positive counts and null SDK entries.
- Interface construction checks its native-width BigInt `Address` and method creation/own-property installation.
  `GetActiveEnvironmentByIndex()` continues to resolve through the live SDK interface, not a foreign wrapper address.
  `Interface` remains read-only; strict non-zero/aligned BigInt address factories do not validate native lifetime.
- Module installation also preserves V8 failures/termination and translates C++ exceptions. `Gravity` and the seven
  ordinary functions are checked own data properties; live `Interface` accessor installation is checked separately.
  Callback data, registration order and SDK availability are unchanged. Failed installation is not transactional.

## Lifecycle

Physics wrappers are non-owning and require no explicit disposal. Do not retain them across map changes unless the owning SDK object is documented to survive them. Resolve environments and entity physics objects again after level shutdown, entity deletion or an extension-owned native object's destruction.

Access the wrappers on the game thread through the JavaScript runtime; they call the live engine interfaces directly and do not provide worker-thread synchronization.

Entity-object enumeration stages matching native objects before committing its output. Reported query failures or
allocation failures leave that output unchanged. The native active-object count and list must remain stable during each
snapshot; staging does not validate borrowed native storage or extend any SDK object's lifetime.

Mutations are immediate. A plugin that changes gravity, density, transforms, velocities, flags, collision state or object state is responsible for its saved-state restoration while the native owner remains valid, including unload. Never use a stale wrapper for rollback. Attempt independent restorations even after one fails, retain the original error with cleanup errors, and do not promise a transaction or reversal of every native side effect; applied impulses are not undone by these examples.

## Related modules

- [`entities/entity`](entities-entity.md) resolves the entity whose `IPhysicsObject` is required.
- [`mathlib`](mathlib.md) provides richer vector and angle classes for calculations before passing plain vector-shaped values to VPhysics.
- [`memory`](memory.md) registers the three physics constructors for address-backed `MakeObject()` interop.
- [`cvars`](cvars.md) reads or changes `sv_gravity`; that ConVar is separate from an environment's gravity vector.
