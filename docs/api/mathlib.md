# `require("mathlib")`

> AI navigation: use the contents to locate the relevant API, then read its storage, validation, and selected-SDK constraints before using it.

- Implementation: [`packages/sourcejs/mathlib.js`](../../packages/sourcejs/mathlib.js)
- Native binding: [`src/sourcejs/modules/ModuleBindings.cpp`](../../src/sourcejs/modules/ModuleBindings.cpp)
- Related memory API: [`memory`](memory.md), [`memory/helpers`](memory-helpers.md), and [`memory/manager`](memory-manager.md)

The module exposes Source SDK math operations and JavaScript classes for `Vector`, `QAngle`, `Quaternion`, `RadianEuler`, `cplane_t`, `matrix3x4_t`, and `VMatrix`. Detached values live in JavaScript. Address-backed values read and write the referenced native memory on every component access.

## Contents

- [Import](#import)
- [Selected-SDK surface](#selected-sdk-surface)
- [Storage and ownership](#storage-and-ownership)
- [Shared structure API](#shared-structure-api)
- [Vector](#vector)
- [QAngle](#qangle)
- [Quaternion](#quaternion)
- [RadianEuler](#radianeuler)
- [Plane](#plane)
- [Matrix3x4](#matrix3x4)
- [VMatrix](#vmatrix)
- [Free vector functions](#free-vector-functions)
- [Free orientation functions](#free-orientation-functions)
- [Free matrix functions](#free-matrix-functions)
- [Strict inputs and errors](#strict-inputs-and-errors)

## Import

Import the classes and functions directly from their owning module:

```js
const {
	Matrix3x4,
	Plane,
	QAngle,
	Quaternion,
	RadianEuler,
	Vector,
	VMatrix,
} = require("mathlib");
```

Do not access these classes through a global `source` object. Each plugin context receives its own CommonJS module object, while address-backed instances may refer to shared engine memory.

## Selected-SDK surface

Every supported Source 1 SDK receives the mandatory package surface below. An optional operation is installed only when the selected HL2SDK branch exposes the corresponding native operation. Test an optional property before using it; SourceJS does not install a JavaScript fallback that throws later. `packages/sourcejs/mathlib.js` keeps the raw native module private and maps the public package names to the exact `ModuleBindings.cpp` names shown below.

### Constants and classes

| Export | Meaning |
| --- | --- |
| `FLOAT_SIZE` | Native `sizeof(float)` in bytes. |
| `VECTOR_SIZE` | Native `sizeof(Vector)` in bytes. |
| `QANGLE_SIZE` | Native `sizeof(QAngle)` in bytes. |
| `QUATERNION_SIZE` | Native `sizeof(Quaternion)` in bytes. |
| `RADIAN_EULER_SIZE` | Native `sizeof(RadianEuler)` in bytes. |
| `PLANE_SIZE` | Native `sizeof(cplane_t)` in bytes. |
| `MATRIX3X4_SIZE` | Native `sizeof(matrix3x4_t)` in bytes. |
| `VMATRIX_SIZE` | Native `sizeof(VMatrix)` in bytes. |
| [`Vector`](#vector) | Three-component position, direction, or velocity value. |
| [`QAngle`](#qangle) | Pitch, yaw, and roll in degrees. |
| [`Quaternion`](#quaternion) | Four-component rotation quaternion. |
| [`RadianEuler`](#radianeuler) | Euler rotation in radians. |
| [`Plane`](#plane) | Live-compatible `cplane_t` normal, distance, type, and sign bits. |
| [`Matrix3x4`](#matrix3x4) | Three-row affine transform compatible with `matrix3x4_t`. |
| [`VMatrix`](#vmatrix) | Four-row Source matrix. |

All eight size constants are positive safe integers taken from the native binding. At module loading, the seven classes expose the same size through static `TYPE_SIZE` and are registered through [`memory.RegisterObjectType()`](memory.md#registered-object-types). `TYPE_SIZE` remains writable and configurable; changing it does not change the selected SDK layout or the size already registered with the memory module. Do not mutate this metadata.

### Mandatory operations

The exported object is frozen; its constructors and their prototypes are not frozen by that operation. It owns only the documented classes, constants, and SDK-backed operations; the raw native module object remains private.

| Package export | Native binding | Contract |
| --- | --- | --- |
| `GetRandomVector(flMinimumComponent = 0, flMaximumComponent = 1)` | `CreateRandomVector` | Returns a vector record with independently randomized native components. |
| `IsVectorZero(VectorValue, flTolerance = 0.01)` | `IsVectorZero` | Uses `Vector::IsZero` with the requested tolerance. |
| `NegateVector(VectorValue)` | `NegateVector` | Returns a negated vector record. |
| `AddVector(FirstVector, SecondVector)` | `AddVectors` | Adds a vector-like or finite scalar right operand. |
| `SubtractVector(FirstVector, SecondVector)` | `SubtractVectors` | Subtracts a vector-like or finite scalar right operand. |
| `MultiplyVector(FirstVector, SecondVector)` | `MultiplyVectors` | Multiplies by a vector-like or finite scalar right operand. |
| `DivideVector(FirstVector, SecondVector)` | `DivideVectors` | Divides by a vector-like or finite scalar right operand. |
| `IsVectorLengthGreaterThan(VectorValue, flComparisonLength)` | `IsVectorLengthGreaterThan` | Uses the SDK's squared-length comparison. |
| `IsVectorLengthLessThan(VectorValue, flComparisonLength)` | `IsVectorLengthLessThan` | Uses the SDK's squared-length comparison. |

The remaining public operations use the exact package and native names below:

| Package export | Native binding | Contract |
| --- | --- | --- |
| `ConvertQAngleToVectors(QAngleValue)` | `GetDirectionVectorsFromAngle` | Returns forward, right, and up vectors for an angle value. |
| `CalculateVectorCrossProduct(FirstVector, SecondVector)` | `ComputeVectorCrossProduct` | Returns the vector cross product. |
| `CalculateVectorDistance(FirstVector, SecondVector)` / `CalculateVectorDistanceSquared(FirstVector, SecondVector)` | `ComputeVectorDistance` / `ComputeVectorDistanceSquared` | Returns three-dimensional distance or its square. |
| `CalculateVectorDotProduct(FirstVector, SecondVector)` | `ComputeVectorDotProduct` | Returns the vector dot product. |
| `GetVectorLength(VectorValue)` / `GetVectorLengthSquared(VectorValue)` | `GetVectorLength` / `GetVectorLengthSquared` | Returns three-dimensional length or its square. |
| `GetVectorLength2D(VectorValue)` / `GetVectorLength2DSquared(VectorValue)` | `GetVectorLength2D` / `GetVectorLength2DSquared` | Returns horizontal length or its square. |
| `GetMaximumVector(FirstVector, SecondVector)` / `GetMinimumVector(FirstVector, SecondVector)` | `GetVectorMaximum` / `GetVectorMinimum` | Returns component-wise maximum or minimum values. |
| `MultiplyAndAddVector(FirstVector, SecondVector, flScalar)` | `MultiplyAddVectors` | Returns `FirstVector + SecondVector * flScalar`. |
| `NormalizeVector(VectorValue)` | `NormalizeVector` | Returns normalized components and the original length. |
| `GetMatrix3x4Angles(Matrix3x4Value)` / `GetMatrix3x4Position(Matrix3x4Value)` | `GetMatrix3x4Angles` / `GetMatrix3x4Position` | Returns orientation or translation from a 3-by-4 matrix. |
| `CreateMatrix3x4FromAxes(XAxis, YAxis, ZAxis, Position)` | `CreateMatrix3x4FromAxes` | Builds a 3-by-4 matrix from its axes and position. |
| `ConvertVMatrixToMatrix3x4(VMatrixValue)` | `CreateMatrix3x4FromVMatrix` | Converts a 4-by-4 matrix to a 3-by-4 matrix. |
| `ConvertRadianEulerToQuaternion(RadianEulerValue)` | `ConvertRadianEulerToQuaternion` | Converts radians to a quaternion. |
| `ConvertQAngleToRadianEuler(QAngleValue)` / `ConvertQuaternionToRadianEuler(QuaternionValue)` | `ConvertQAngleToRadianEuler` / `ConvertQuaternionToRadianEuler` | Converts a QAngle or quaternion to radians. |
| `ConvertRadianEulerToQAngle(RadianEulerValue)` | `ConvertRadianEulerToQAngle` | Converts radians to a QAngle. |
| `GetVMatrixAngles(VMatrixValue)` / `GetVMatrixPosition(VMatrixValue)` | `GetVMatrixAngles` / `GetVMatrixPosition` | Returns orientation or translation from a 4-by-4 matrix. |
| `ConvertMatrix3x4ToVMatrix(Matrix3x4Value)` | `CreateVMatrixFromMatrix3x4` | Converts a 3-by-4 matrix to a 4-by-4 matrix. |
| `ConvertVectorToQAngle(VectorValue, PseudoUpVector = null)` | `GetAngleFromVector` | Converts a vector and optional pseudo-up vector to angles. |
| `GetVectorPerpendicularBasis(DirectionVector)` | `GetPerpendicularVectorsFromVector` | Returns perpendicular vectors for a direction. |

The table below lists the documented public member names. Named component access reads or writes live native storage when attached; detached components hold local values.

| Class | Fields and members |
| --- | --- |
| [`Vector`](#vector) | `ComponentNames`, `Address`, `Values`, `X`, `Y`, `Z`; class-specific methods are documented below. |
| [`QAngle`](#qangle) | `ComponentNames`, `Address`, `Values`, `X`, `Y`, `Z`; X is pitch, Y is yaw, and Z is roll in degrees. |
| [`RadianEuler`](#radianeuler) | `ComponentNames`, `Address`, `Values`, `X`, `Y`, `Z`; SDK order is X roll, Y pitch, and Z yaw in radians. |
| [`Quaternion`](#quaternion) | `ComponentNames`, `Address`, `Values`, `X`, `Y`, `Z`, `W`; class-specific methods are documented below. |
| [`Plane`](#plane) | `Address`, `Normal`, `Distance`, `Type`, `SignBits`; class-specific methods are documented below. |
| `Matrix3x4`, `VMatrix` | `Address`, `RowCount`, `Values`; class-specific methods are documented below. |
| `MatrixRow` | `Matrix`, `RowIndex`, `GetMatrixRowComponent()`, `SetMatrixRowComponent()`, `ConvertMatrixRowToArray()`, `[Symbol.iterator]()`. |

This startup check validates the selected SDK size metadata and then calculates a bounded velocity perturbation entirely through the native primitives:

```js
const {
	FLOAT_SIZE,
	MATRIX3X4_SIZE,
	PLANE_SIZE,
	QANGLE_SIZE,
	QUATERNION_SIZE,
	RADIAN_EULER_SIZE,
	VECTOR_SIZE,
	VMATRIX_SIZE,
	AddVector,
	DivideVector,
	GetRandomVector,
	IsVectorLengthGreaterThan,
	IsVectorLengthLessThan,
	IsVectorZero,
	MultiplyVector,
	NegateVector,
	SubtractVector,
} = require("mathlib");

const g_vecNativeLayoutSizes = [
	["float", FLOAT_SIZE],
	["Vector", VECTOR_SIZE],
	["QAngle", QANGLE_SIZE],
	["Quaternion", QUATERNION_SIZE],
	["RadianEuler", RADIAN_EULER_SIZE],
	["cplane_t", PLANE_SIZE],
	["matrix3x4_t", MATRIX3X4_SIZE],
	["VMatrix", VMATRIX_SIZE],
];

for (const [strTypeName, unNativeSize] of g_vecNativeLayoutSizes) {
	if (!Number.isSafeInteger(unNativeSize) || (unNativeSize <= 0)) {
		throw new Error(`${strTypeName} has invalid native size ${unNativeSize}.`);
	}
}

const g_CurrentVelocity = { X: 120, Y: 40, Z: 0 };
const g_RandomSpread = GetRandomVector(-1, 1);
const g_AdjustedVelocity = AddVector(g_CurrentVelocity, g_RandomSpread);
const g_VelocityDelta = SubtractVector(g_AdjustedVelocity, g_CurrentVelocity);
const g_AmplifiedVelocityDelta = MultiplyVector(g_VelocityDelta, 2);
const g_RestoredVelocityDelta = DivideVector(g_AmplifiedVelocityDelta, 2);
const g_VelocityCancellation = AddVector(g_RestoredVelocityDelta, NegateVector(g_RestoredVelocityDelta));

if (!IsVectorZero(g_VelocityCancellation, 0.01)) {
	throw new Error("Native vector operations failed to cancel the velocity delta.");
}

if (!IsVectorLengthGreaterThan(g_CurrentVelocity, 100) || !IsVectorLengthLessThan(g_CurrentVelocity, 200)) {
	throw new Error("Current velocity is outside the expected movement range.");
}
```

### Remaining mandatory free functions

| Export | Result |
| --- | --- |
| `ConvertQAngleToVectors(QAngleValue)` | `{ Forward, Right, Up }` basis vectors. |
| `CalculateVectorCrossProduct(FirstVector, SecondVector)` | Cross-product vector record. |
| `CalculateVectorDistance(FirstVector, SecondVector)` | Three-dimensional distance. |
| `CalculateVectorDistanceSquared(FirstVector, SecondVector)` | Squared three-dimensional distance. |
| `CalculateVectorDotProduct(FirstVector, SecondVector)` | Dot product. |
| `GetVectorLength(VectorValue)` | Three-dimensional vector length. |
| `GetVectorLength2D(VectorValue)` | Horizontal vector length. |
| `GetVectorLength2DSquared(VectorValue)` | Squared horizontal length. |
| `GetVectorLengthSquared(VectorValue)` | Squared three-dimensional length. |
| `GetMaximumVector(FirstVector, SecondVector)` | Component-wise maximum vector record. |
| `GetMinimumVector(FirstVector, SecondVector)` | Component-wise minimum vector record. |
| `MultiplyAndAddVector(FirstVector, SecondVector, flScalar)` | `FirstVector + SecondVector * flScalar`. |
| `NormalizeVector(VectorValue)` | `{ X, Y, Z, Length }`. |
| `ConvertVectorToQAngle(VectorValue, PseudoUpVector = null)` | QAngle-like record for a direction and optional pseudo-up vector. |
| `GetVectorPerpendicularBasis(DirectionVector)` | `{ Right, Up }` perpendicular basis. |
| `ConvertRadianEulerToQuaternion(RadianEulerValue)` | Quaternion-like record. |
| `ConvertQAngleToRadianEuler(QAngleValue)` | RadianEuler-like record. |
| `ConvertQuaternionToRadianEuler(QuaternionValue)` | RadianEuler-like record. |
| `ConvertRadianEulerToQAngle(RadianEulerValue)` | QAngle-like record. |
| `GetMatrix3x4Angles(Matrix3x4Value)` | QAngle-like record from a 3-by-4 matrix. |
| `CreateMatrix3x4FromAxes(XAxis, YAxis, ZAxis, Position)` | Nested 3-by-4 matrix array. |
| `ConvertVMatrixToMatrix3x4(VMatrixValue)` | Nested 3-by-4 matrix array. |
| `GetMatrix3x4Position(Matrix3x4Value)` | Position vector record. |
| `GetVMatrixAngles(VMatrixValue)` | QAngle-like record from a 4-by-4 matrix. |
| `ConvertMatrix3x4ToVMatrix(Matrix3x4Value)` | Nested 4-by-4 matrix array. |
| `GetVMatrixPosition(VMatrixValue)` | Position vector record. |

The free functions return plain result records, arrays, or numbers. Use the classes when a mutable value, output object, or address-backed view is needed.

### Capability-conditioned operations

| Export or member | Capability behavior |
| --- | --- |
| `IsVectorWithinBox(VectorValue, MinimumCorner, MaximumCorner)` and `Vector.prototype.IsVectorWithinBox(FirstCorner, SecondCorner)` | Omitted when the SDK lacks `Vector::WithinAABox`. |
| `InvalidateMatrix3x4(Matrix3x4Value)` and `Matrix3x4.prototype.InvalidateMatrix3x4()` | Omitted when the SDK lacks `matrix3x4_t::Invalidate`. |
| `CreateIdentityVMatrix()` and `VMatrix.prototype.SetIdentityVMatrix()` | Omitted when the SDK lacks `VMatrix::Identity`. |

```js
const { CreateIdentityVMatrix, VMatrix } = require("mathlib");

if (typeof CreateIdentityVMatrix === "function") {
	const IdentityVMatrix = new VMatrix(CreateIdentityVMatrix());
	const vecIdentityMatrixRows = IdentityVMatrix.ConvertMatrixToArray();
	for (let unRowIndex = 0; unRowIndex < vecIdentityMatrixRows.length; ++unRowIndex) {
		for (let unColumnIndex = 0; unColumnIndex < vecIdentityMatrixRows[unRowIndex].length; ++unColumnIndex) {
			const flExpectedComponentValue = (unRowIndex === unColumnIndex) ? 1 : 0;
			if (vecIdentityMatrixRows[unRowIndex][unColumnIndex] !== flExpectedComponentValue) {
				throw new Error(`Identity mismatch at [${unRowIndex}][${unColumnIndex}].`);
			}
		}
	}
}
```

## Storage and ownership

### Detached values

`new Vector(...)`, the other ordinary constructors, `CopyMathStructure()`, and arithmetic methods that return a new object use JavaScript-owned component storage. Their `Address` is `0n`, `HasMemoryAddress()` is `false`, and changing them cannot modify engine memory.

```js
const { Vector } = require("mathlib");

const g_SpawnVector = new Vector(128, -64, 32);
const g_DestinationVector = g_SpawnVector.AddVector(new Vector(0, 0, 72));
if (g_SpawnVector.HasMemoryAddress() || g_DestinationVector.HasMemoryAddress()) {
	throw new Error("Detached vector unexpectedly owns a native address.");
}

if (!g_SpawnVector.IsMathStructureEqual([128, -64, 32]) || !g_DestinationVector.IsMathStructureEqual([128, -64, 104])) {
	throw new Error("Detached vector arithmetic produced incorrect components.");
}
```

### Address-backed values

`Type.CreateFromAddress(unAddress, unAddressOffset = 0)` creates a non-owning view when the effective address is nonzero. `unAddress` must be a non-negative BigInt; `unAddressOffset` is a non-negative safe JavaScript integer byte offset. `CreateFromAddress(0n, 0)` produces a detached, zero-initialized value, not a native null view. `memory.MakeObject(ObjectTypeValue, AddressLike, nAddressOffset = 0n)` delegates to the registered constructor's address factory; its address-like input and signed BigInt offset follow the separate [`memory` contract](memory.md). Do not confuse the two offset types. Component access uses `memory/helpers` immediately; creating a view does not establish that the full target range is mapped, correctly aligned, or still owned by a live allocation.

```js
const { Allocate, Deallocate, MakeObject } = require("memory");
const { VECTOR_SIZE, Vector } = require("mathlib");

const g_unAllocatedMemoryAddress = Allocate(VECTOR_SIZE);
if ((typeof g_unAllocatedMemoryAddress !== "bigint") || (g_unAllocatedMemoryAddress <= 0n)) {
	throw new Error("Vector allocation returned an invalid address.");
}

const g_vecVectorErrors = [];
try {
	const PositionVector = Vector.CreateFromAddress(g_unAllocatedMemoryAddress);
	PositionVector.InitializeMathStructure(10, 20, 30);

	const SamePositionVector = MakeObject(Vector, g_unAllocatedMemoryAddress);
	SamePositionVector.Z += 18;
	if ((PositionVector.Address !== g_unAllocatedMemoryAddress) || (SamePositionVector.Address !== g_unAllocatedMemoryAddress) || !PositionVector.IsMathStructureEqual([10, 20, 48])) {
		throw new Error("Address-backed Vector views do not share live storage.");
	}
} catch (CaughtError) {
	g_vecVectorErrors.push(CaughtError);
} finally {
	try {
		if (!Deallocate(g_unAllocatedMemoryAddress)) {
			throw new Error("Vector allocation cleanup failed.");
		}
	} catch (CaughtError) {
		g_vecVectorErrors.push(CaughtError);
	}
}

if (g_vecVectorErrors.length === 1) {
	throw g_vecVectorErrors[0];
}

if (g_vecVectorErrors.length > 1) {
	throw new AggregateError(g_vecVectorErrors, "Vector initialization or allocation cleanup failed.");
}
```

The view never copies or frees its backing storage. Keep the complete native structure range valid and writable for the operations used, and never access a borrowed view after its entity, model, allocation, or SDK owner releases that storage. The example attempts cleanup once, preserving a sole failure unchanged or aggregating the operation failure before the cleanup failure. A failed cleanup is not proof that storage was released. After successful `Deallocate()`, the views are unusable. `Address === 0n` means detached storage for these math classes, not a native null view.

## Shared structure API

`Vector`, `QAngle`, `Quaternion`, and `RadianEuler` share the scalar-structure operations below. `Vector`, `QAngle`, and `RadianEuler` also share the vector arithmetic operations. Named components and numeric indices refer to the same live storage. Their scalar-structure backing state is private, with no public `m_*` storage fields or aliases; use the PascalCase members documented below.

### Scalar structure members

| Member | Behavior |
| --- | --- |
| `constructor.TYPE_SIZE` | Initial native byte-size metadata registered at module loading; writable/configurable, but changing it does not update the registered layout. |
| `Type.CreateMathStructureFromValue(...)` | Uses the class-specific source parameter documented below. Returns an existing instance unchanged, or creates a detached value from an array-like value with enough components or an object with named components. Missing named components default to zero. |
| `Type.CreateFromAddress(unAddress, unAddressOffset = 0)` | Creates a non-owning live view at a nonzero effective address, or a detached zero value at `0n`. |
| `Address` | Read-only getter: BigInt backing address, or `0n` for detached storage. |
| `ComponentNames` | Read-only getter returning the frozen component-name array. |
| `Values` | Read-only getter returning a mutable local backing array, not a native-memory view. Mutating that array bypasses component validation and does not write attached native storage; use named components or `SetMathStructureComponent()` for writes and `ConvertMathStructureToArray()` for snapshots. |
| `GetMemoryAddress()` | Returns `Address`. |
| `HasMemoryAddress()` | Returns whether the object is address-backed. |
| `GetMathStructureComponent(unComponentIndex)` and `SetMathStructureComponent(unComponentIndex, flComponentValue)` | Reads one component or writes a finite component. |
| `ConvertMathStructureToArray()` | Returns the current components as a new array. |
| `CopyMathStructure()` | Returns a detached copy. |
| `CopyMathStructureFrom(StructureLike)` and `CopyMathStructureTo(TargetStructureOut)` | The former converts an accepted source and copies into the receiver; the latter requires an existing instance of the same constructor and returns that target. |
| `IsMathStructureValid()` | Returns whether every component is finite. |
| `InvalidateMathStructure()` | Writes `NaN` to every component and returns the receiver. |
| `IsMathStructureEqual(StructureLike)` | Compares every component exactly. |
| `[Symbol.iterator]()` | Iterates the current components in their declared order. |

Native float components must match the host's `Float32Array` width; an incompatible SDK layout is rejected during module loading. Detached components may retain JavaScript Number precision, while native operations and address-backed float storage use native Float32 precision. Exact equality is not an approximate native-math check.

Address-backed component reads and writes pass signed BigInt byte offsets to the native memory API. `InvalidateMathStructure()` encodes native Float32 `NaN` bits and writes them as unsigned 32-bit storage, preserving the finite-only contract of ordinary `WriteFloat()` calls. Detached invalidation changes only the local component array.

Multi-component writes are sequential, not atomic. `CopyMathStructureFrom()` snapshots the source before writing, but a later validation or memory-access failure can leave earlier destination components changed. Do not assign the read-only `Address`, `ComponentNames`, or `Values` getters.

### Three-component arithmetic members

| Member | Behavior |
| --- | --- |
| `InitializeMathStructure(flX = 0, flY = 0, flZ = 0)` | Replaces all components. |
| `RandomizeMathStructure(flMinimumComponent = 0, flMaximumComponent = 1)` | Writes random components in the requested numeric range. |
| `Length` | Live three-dimensional magnitude; assigning rescales the value. |
| `LengthSquared` | Live squared magnitude. |
| `ClearMathStructure()` and `IsMathStructureZero(flTolerance = 0.01)` | Clears or tests all components. |
| `NormalizeMathStructure()` and `GetNormalizedMathStructure()` | Normalizes in place and returns the old length, or returns a detached normalized copy. |
| `NegateMathStructure()` and `GetNegativeMathStructure()` | Negates in place, or returns a detached negative copy. |
| `AddVector(Operand)` / `AddScalar(flScalar)`, `SubtractVector(Operand)` / `SubtractScalar(flScalar)`, `MultiplyVector(Operand)` / `MultiplyScalar(flScalar)`, and `DivideVector(Operand)` / `DivideScalar(flScalar)` | Returns detached results for a vector-like or finite scalar operand. |
| `AddVectorInPlace(Operand)` / `AddScalarInPlace(flScalar)`, `SubtractVectorInPlace(Operand)` / `SubtractScalarInPlace(flScalar)`, `MultiplyVectorInPlace(Operand)` / `MultiplyScalarInPlace(flScalar)`, and `DivideVectorInPlace(Operand)` / `DivideScalarInPlace(flScalar)` | Applies a vector-like or finite scalar operation to the receiver. |

## Vector

### Construction and fields

| Member | Contract |
| --- | --- |
| [`new Vector(flX = 0, flY = 0, flZ = 0, unAddress = 0n)`](#vector) | Creates a detached value unless a nonzero BigInt address is supplied internally. Prefer `Vector.CreateFromAddress()` for explicit views. |
| `Vector.TYPE_SIZE` | Initially equals `VECTOR_SIZE`; mutable metadata, not a way to change the registered native layout. |
| `Vector.CreateMathStructureFromValue(VectorLike)` | Accepts a Vector, an array-like value with at least three elements, or an object exposing `X`, `Y`, or `Z`. Missing named components default to zero. |
| `Vector.CreateFromAddress(unAddress, unAddressOffset = 0)` | Creates a non-owning live view at a nonzero effective address, or a detached zero value at `0n`. |
| `X`, `Y`, `Z`, and `[0]`, `[1]`, `[2]` | Equivalent component accessors. Ordinary writes require finite numbers; reads can expose invalidated or native non-finite values. |
| `CreateVector2DView()` | Returns a frozen view object whose writable `X` and `Y` accessors still target this Vector; `ConvertVector2DToArray()` returns its current components. |
| `Length2D` and `Length2DSquared` | Live horizontal magnitude and squared magnitude. |

`Vector` includes every scalar-structure and three-component arithmetic member described above.

### Vector-specific methods

| Method | Result or mutation |
| --- | --- |
| `IsVectorLengthGreaterThan(flComparisonLength)` and `IsVectorLengthLessThan(flComparisonLength)` | Compares the three-dimensional length with a finite threshold. |
| `CalculateVectorDistance(OtherVector)` and `CalculateVectorDistanceSquared(OtherVector)` | Returns distance to another vector-like value. |
| `SetVectorMultiplyAdd(FirstVector, SecondVector, flScalar)` | Replaces this Vector with `FirstVector + SecondVector * flScalar` and returns this Vector. |
| `CalculateVectorDotProduct(OtherVector)` | Returns the scalar dot product. |
| `CalculateVectorCrossProduct(OtherVector)` | Returns a detached perpendicular Vector. |
| `GetMinimumVector(OtherVector)` and `GetMaximumVector(OtherVector)` | Returns a detached component-wise minimum or maximum. |
| `ConvertVectorToQAngle(PseudoUpVector = null, AngleOut = null)` | Returns a QAngle or writes it into the supplied QAngle output. |
| `GetVectorPerpendicularBasis(RightVectorOut = null, UpVectorOut = null)` | Returns detached basis Vectors under `{ Right, Up }` and optionally copies them into output Vectors. |
| `IsVectorWithinBox(FirstCorner, SecondCorner)` | Optional selected-SDK point-in-AABB test using this Vector as the point. The native binding computes component-wise minimum/maximum corners, so corner order does not matter. Unlike module-level `IsVectorWithinBox(VectorValue, MinimumCorner, MaximumCorner)`, the instance method takes only the two corners. |

### Predict a moving position

Use detached results when the calculation must not change the source position or velocity. This bounded example uses a named tolerance for Float32 rounding; choose a tolerance appropriate to the magnitude and operations in your own calculation:

```js
const { Vector } = require("mathlib");

const g_CurrentPosition = new Vector(128, -64, 16);
const g_Velocity = new Vector(240, 0, 80);
const g_flFrameTime = 1 / 30;
const g_flNativeMathTolerance = 0.0001;
const g_PredictedPosition = g_CurrentPosition.AddVector(g_Velocity.MultiplyScalar(g_flFrameTime));
const g_vecExpectedPosition = [136, -64, 18.666666666666668];

if (!g_CurrentPosition.IsMathStructureEqual([128, -64, 16])) {
	throw new Error("Position prediction mutated its input.");
}

for (let unComponentIndex = 0; unComponentIndex < g_vecExpectedPosition.length; ++unComponentIndex) {
	if (Math.abs(g_PredictedPosition[unComponentIndex] - g_vecExpectedPosition[unComponentIndex]) > g_flNativeMathTolerance) {
		throw new Error(`Predicted component ${unComponentIndex} is incorrect.`);
	}
}

if ((Math.abs(g_Velocity.Length - Math.sqrt(64000)) > g_flNativeMathTolerance) || (g_Velocity.Length2D !== 240)) {
	throw new Error("Velocity magnitude is incorrect.");
}
```

### Reuse output objects

Output parameters are useful for address-backed destinations and allocation-sensitive callbacks:

```js
const { QAngle, Vector } = require("mathlib");

const g_flNativeMathTolerance = 0.0001;
const g_DirectionVector = new Vector(0, 1, 0);
const g_QAngleOutput = new QAngle();
const g_RightVectorOutput = new Vector();
const g_UpVectorOutput = new Vector();
const g_DirectionQAngle = g_DirectionVector.ConvertVectorToQAngle(null, g_QAngleOutput);
const g_PerpendicularBasis = g_DirectionVector.GetVectorPerpendicularBasis(g_RightVectorOutput, g_UpVectorOutput);
if ((g_DirectionQAngle !== g_QAngleOutput) || !g_PerpendicularBasis.Right.IsMathStructureEqual(g_RightVectorOutput) || !g_PerpendicularBasis.Up.IsMathStructureEqual(g_UpVectorOutput)) {
	throw new Error("Mathlib did not populate the requested output objects.");
}

if ((Math.abs(g_DirectionVector.CalculateVectorDotProduct(g_RightVectorOutput)) > g_flNativeMathTolerance) || (Math.abs(g_DirectionVector.CalculateVectorDotProduct(g_UpVectorOutput)) > g_flNativeMathTolerance)) {
	throw new Error("Generated basis vectors are not perpendicular to the direction.");
}
```

## QAngle

`QAngle` uses degrees in Source order: `X` is pitch, `Y` is yaw, and `Z` is roll. It includes every scalar-structure and three-component arithmetic member.

| Member | Contract |
| --- | --- |
| `new QAngle(flX = 0, flY = 0, flZ = 0, unAddress = 0n)` | Creates a detached angle unless backed internally by a BigInt address. |
| `QAngle.TYPE_SIZE` | Initially equals `QANGLE_SIZE`; mutable metadata, not a way to change the registered native layout. |
| `QAngle.CreateMathStructureFromValue(VectorLike)` | Inherited vector-like factory: accepts a QAngle, an array-like value with at least three elements, or an object exposing `X`, `Y`, or `Z`. Missing named components default to zero. |
| `QAngle.CreateFromAddress(unAddress, unAddressOffset = 0)` | Creates a non-owning live view at a nonzero effective address, or a detached zero value at `0n`. |
| `X`, `Y`, `Z`, and `[0]`, `[1]`, `[2]` | Equivalent writable components; their angle order is defined for each class above. |
| `ConvertQAngleToVectors(ForwardVectorOut = null, RightVectorOut = null, UpVectorOut = null)` | Returns detached basis Vectors under `Forward`, `Right`, and `Up`, and optionally copies each one into a Vector output. |

```js
const { QAngle } = require("mathlib");

const g_flNativeMathTolerance = 0.0001;

const g_ViewAngles = new QAngle(-10, 90, 0);
const g_AngleBasis = g_ViewAngles.ConvertQAngleToVectors();
const g_ForwardVector = g_AngleBasis.Forward;
const g_RightVector = g_AngleBasis.Right;
const g_UpVector = g_AngleBasis.Up;
for (const DirectionVector of [g_ForwardVector, g_RightVector, g_UpVector]) {
	if (Math.abs(DirectionVector.Length - 1) > g_flNativeMathTolerance) {
		throw new Error("QAngle produced a non-unit basis vector.");
	}
}

if ((Math.abs(g_ForwardVector.CalculateVectorDotProduct(g_RightVector)) > g_flNativeMathTolerance) || (Math.abs(g_ForwardVector.CalculateVectorDotProduct(g_UpVector)) > g_flNativeMathTolerance) || (Math.abs(g_RightVector.CalculateVectorDotProduct(g_UpVector)) > g_flNativeMathTolerance)) {
	throw new Error("QAngle basis vectors are not mutually perpendicular.");
}
```

## Quaternion

`Quaternion` is a four-component scalar structure. It includes the complete shared scalar-structure API, indexed and named component access, and iteration. It does not expose Vector arithmetic.

| Member | Contract |
| --- | --- |
| `new Quaternion(flX = 0, flY = 0, flZ = 0, flW = 0, unAddress = 0n)` | Creates a detached quaternion unless a nonzero BigInt address is supplied internally. Prefer `Quaternion.CreateFromAddress()` for explicit views. |
| `Quaternion.TYPE_SIZE` | Initially equals `QUATERNION_SIZE`; mutable metadata, not a way to change the registered native layout. |
| `Quaternion.CreateMathStructureFromValue(QuaternionLike)` | Accepts a Quaternion, RadianEuler, array-like value with at least four elements, or an object exposing at least one of `X`, `Y`, `Z`, or `W`. Missing named components default to zero. |
| `Quaternion.CreateFromAddress(unAddress, unAddressOffset = 0)` | Creates a non-owning live view at a nonzero effective address, or a detached zero value at `0n`. |
| `Quaternion.CreateQuaternionFromRadianEuler(RadianEulerLike)` | Creates a detached quaternion through the selected SDK conversion. |
| `X`, `Y`, `Z`, `W`, and `[0]` through `[3]` | Equivalent writable components. |

```js
const { QAngle, Quaternion, RadianEuler } = require("mathlib");

const g_flNativeMathTolerance = 0.0001;

const g_DegreeAngles = new QAngle(15, 45, 5);
const g_RadianAngles = new RadianEuler(g_DegreeAngles);
const g_RotationQuaternion = Quaternion.CreateQuaternionFromRadianEuler(g_RadianAngles);
const g_RestoredDegreeAngles = RadianEuler.CreateRadianEulerFromQuaternion(g_RotationQuaternion).ConvertRadianEulerToQAngle();
if (!g_RadianAngles.IsMathStructureValid() || !g_RotationQuaternion.IsMathStructureValid() || !g_RestoredDegreeAngles.IsMathStructureValid()) {
	throw new Error("Angle conversion produced non-finite components.");
}

for (let unComponentIndex = 0; unComponentIndex < g_DegreeAngles.ComponentNames.length; ++unComponentIndex) {
	if (Math.abs(g_RestoredDegreeAngles[unComponentIndex] - g_DegreeAngles[unComponentIndex]) > g_flNativeMathTolerance) {
		throw new Error(`Angle round trip changed component ${unComponentIndex}.`);
	}
}
```

## RadianEuler

`RadianEuler` preserves the SDK's radian order: `X` is roll, `Y` is pitch, and `Z` is yaw. This differs from `QAngle`'s degree order (`X` pitch, `Y` yaw, `Z` roll). Use the conversion methods rather than copying components by index or only multiplying each QAngle component by a degree-to-radian factor. It includes every scalar-structure and three-component arithmetic member.

| Member | Contract |
| --- | --- |
| `new RadianEuler(Value = 0, flY = 0, flZ = 0, unAddress = 0n)` | Creates a detached value unless a nonzero BigInt address is supplied internally. Passing a QAngle or Quaternion as the first argument performs a native conversion. |
| `RadianEuler.TYPE_SIZE` | Initially equals `RADIAN_EULER_SIZE`; mutable metadata, not a way to change the registered native layout. |
| `RadianEuler.CreateMathStructureFromValue(RadianEulerLike)` | Accepts a RadianEuler, QAngle, Quaternion, array-like value with at least three elements, or an object exposing `X`, `Y`, or `Z`. Missing named components default to zero. |
| `RadianEuler.CreateFromAddress(unAddress, unAddressOffset = 0)` | Creates a non-owning live view at a nonzero effective address, or a detached zero value at `0n`. |
| `RadianEuler.CreateRadianEulerFromQuaternion(QuaternionLike)` | Creates a detached RadianEuler through the selected SDK conversion. |
| `ConvertRadianEulerToQAngle()` | Returns a detached QAngle. |
| `X`, `Y`, `Z`, and `[0]`, `[1]`, `[2]` | Equivalent writable components; their angle order is defined for each class above. |

The constructor is useful when translating engine-facing degrees into a quaternion pipeline. Conversions use SDK rotation conventions; equivalent angles can wrap or change representation, and Euler components are not unique near gimbal lock. The bounded examples compare a nonsingular orientation with a tolerance rather than promising component-identical round trips for every rotation:

```js
const { QAngle, Quaternion, RadianEuler } = require("mathlib");

const g_flNativeMathTolerance = 0.0001;

const g_AimAngles = new QAngle(-5, 45, 0);
const g_RadianAngles = new RadianEuler(g_AimAngles);
const g_OrientationQuaternion = Quaternion.CreateQuaternionFromRadianEuler(g_RadianAngles);
const g_RestoredAngles = RadianEuler.CreateRadianEulerFromQuaternion(g_OrientationQuaternion).ConvertRadianEulerToQAngle();

if (!g_OrientationQuaternion.IsMathStructureValid()) {
	throw new Error("Quaternion conversion produced non-finite components.");
}

for (let unComponentIndex = 0; unComponentIndex < g_AimAngles.ComponentNames.length; ++unComponentIndex) {
	if (Math.abs(g_RestoredAngles[unComponentIndex] - g_AimAngles[unComponentIndex]) > g_flNativeMathTolerance) {
		throw new Error(`Quaternion pipeline changed angle component ${unComponentIndex}.`);
	}
}
```

## Plane

`Plane` models Source's `cplane_t`: a normal Vector, a signed distance from the origin, and two unsigned-byte classification fields. A point is in front of the plane when `Plane.Normal.CalculateVectorDotProduct(Point) - Plane.Distance` is positive.

| Member | Contract |
| --- | --- |
| `new Plane(Normal = new Vector(), flDistance = 0, unType = 0, unSignBits = 0, unAddress = 0n)` | Creates a detached plane unless backed internally by a BigInt address. `flDistance` must be finite; `unType` and `unSignBits` must be integers from 0 through 255. |
| `Plane.TYPE_SIZE` | Initially equals `PLANE_SIZE`; mutable metadata, not a way to change the registered native layout. |
| `Plane.CreateMathStructureFromValue(PlaneLike)` | Returns an existing Plane or creates one from `{ Normal, Distance, Type, SignBits }`. |
| `Plane.CreateFromAddress(unAddress, unAddressOffset = 0)` | Creates a non-owning `cplane_t` view at a nonzero effective address, or a detached zero value at `0n`; backing-range safety and lifetime remain the caller's responsibility. |
| `Address` | Read-only getter: BigInt backing address, or `0n` for detached storage. |
| `GetMemoryAddress()` and `HasMemoryAddress()` | Exposes the BigInt backing address and whether the plane is memory-backed. |
| `Normal` | Detached Vector, or a new JavaScript wrapper over the same borrowed native Vector on each attached read; no native allocation is made. Assigning a vector-like value copies its three components into the plane. |
| `Distance` | Writable float at the SDK-derived offset `VECTOR_SIZE` when attached. Ordinary assignments require a finite number; reads can expose invalidated or native non-finite values. |
| `Type` and `SignBits` | Detached or address-backed unsigned bytes after the SDK-sized Vector and distance fields. |
| `CopyPlane()` | Returns a detached Plane with the current values. |
| `CopyPlaneFrom(PlaneLike)` and `CopyPlaneTo(TargetPlaneOut)` | The former accepts a plane-like source; the latter requires an existing Plane target. Both copy the four fields and return the destination. |
| `IsPlaneValid()` | Reports whether the normal and distance are finite and both byte fields are integers from 0 through 255. |
| `InvalidatePlane()` | Writes `NaN` into the normal and distance, clears both byte fields, and returns this Plane. |
| `IsPlaneEqual(PlaneLike)` | Performs exact component and scalar comparison. |

Detached backing state is private, with no public `m_*` storage fields or aliases. Address-backed reads and writes bypass the detached values, so plugin code should use `Normal`, `Distance`, `Type`, and `SignBits`.

Native field accesses use BigInt byte offsets. `CopyPlaneFrom()` snapshots and validates the source before sequential destination writes; a later memory-write failure can leave earlier fields changed. Address-backed invalidation writes the normal and distance as native Float32 `NaN` bits through unsigned 32-bit storage, then clears the byte fields; it never passes `NaN` to the finite-only float-write API. Neither copying nor invalidation is atomic.

### Classify positions against a plane

This example classifies an origin relative to a horizontal plane at `z = 64`:

```js
const { Plane, Vector } = require("mathlib");

const g_FloorPlane = new Plane(new Vector(0, 0, 1), 64, 2, 0);
const g_PlayerOrigin = new Vector(128, -32, 80);
const g_flSignedDistance = g_FloorPlane.Normal.CalculateVectorDotProduct(g_PlayerOrigin) - g_FloorPlane.Distance;
let g_strPlaneSide = "on";
if (g_flSignedDistance > 0) {
	g_strPlaneSide = "front";
} else if (g_flSignedDistance < 0) {
	g_strPlaneSide = "back";
}

if ((g_flSignedDistance !== 16) || (g_strPlaneSide !== "front")) {
	throw new Error("Plane classification produced an incorrect side or distance.");
}
```

### Edit a native plane in place

`CreateFromAddress()` does not own the allocation. Every field write below immediately changes the same native bytes observed by the second view:

```js
const { Allocate, Deallocate } = require("memory");
const { PLANE_SIZE, Plane, Vector } = require("mathlib");

const g_unAllocatedPlaneAddress = Allocate(PLANE_SIZE);
if ((typeof g_unAllocatedPlaneAddress !== "bigint") || (g_unAllocatedPlaneAddress <= 0n)) {
	throw new Error("Plane allocation returned an invalid address.");
}

const g_vecPlaneErrors = [];
try {
	const CollisionPlane = Plane.CreateFromAddress(g_unAllocatedPlaneAddress);
	CollisionPlane.Normal = new Vector(0, 1, 0);
	CollisionPlane.Distance = 128;
	CollisionPlane.Type = 1;
	CollisionPlane.SignBits = 2;

	const ObservedPlane = Plane.CreateFromAddress(g_unAllocatedPlaneAddress);
	if (!ObservedPlane.IsPlaneEqual(new Plane(new Vector(0, 1, 0), 128, 1, 2)) || (ObservedPlane.Normal.GetMemoryAddress() !== g_unAllocatedPlaneAddress)) {
		throw new Error("Second Plane view did not observe the native writes.");
	}
} catch (CaughtError) {
	g_vecPlaneErrors.push(CaughtError);
} finally {
	try {
		if (!Deallocate(g_unAllocatedPlaneAddress)) {
			throw new Error("Plane allocation cleanup failed.");
		}
	} catch (CaughtError) {
		g_vecPlaneErrors.push(CaughtError);
	}
}

if (g_vecPlaneErrors.length === 1) {
	throw g_vecPlaneErrors[0];
}

if (g_vecPlaneErrors.length > 1) {
	throw new AggregateError(g_vecPlaneErrors, "Plane initialization or allocation cleanup failed.");
}
```

## Matrix3x4

`Matrix3x4` is Source's three-row affine transform. Each row has four float components; the fourth column carries translation. Ordinary construction and component writes require finite numbers, but reads can expose invalidated or native non-finite values. Detached matrices keep their values in JavaScript, while `CreateFromAddress()` reads and writes native memory on every component access. Both `Matrix3x4` and `VMatrix` keep their storage state private, with no public `m_*` fields or aliases; use `Address`, `RowCount`, `Values`, and the documented component methods instead.

### Construction and fields

| Member | Contract |
| --- | --- |
| [`new Matrix3x4(...vecArgumentsList)`](#matrix3x4) | Accepts no values for a detached zero matrix, one matrix-like value with exactly three rows of at least four components each or a flat sequence of at least 12 components, four axis/position objects for the selected SDK's `CreateMatrix3x4FromAxes`, or at least 12 finite row-major components. Extra flat components or row columns are ignored. |
| `Matrix3x4.TYPE_SIZE` | Initially equals `MATRIX3X4_SIZE`; mutable metadata, not a way to change the registered native layout. |
| `Matrix3x4.CreateMathStructureFromValue(MatrixLike)` | Returns a detached copy of a 3-by-4 matrix-like value. |
| `Matrix3x4.CreateFromAddress(unAddress, unAddressOffset = 0)` | Creates a non-owning `matrix3x4_t` view at a nonzero effective address, or a detached zero value at `0n`; backing-range safety and lifetime remain the caller's responsibility. |
| `Address` | Read-only getter: BigInt backing address, or `0n` for detached storage. |
| `RowCount` | Read-only getter returning `3`. |
| `GetMemoryAddress()` and `HasMemoryAddress()` | Exposes the BigInt backing address and whether the matrix is memory-backed. |
| `Values` | Read-only getter returning a mutable flat local array of 12 row-major components, not an attached-memory view. Direct mutation bypasses finite-component validation; use `SetMatrixComponent()` for writes or `ConvertMatrixToArray()` for nested snapshots. |
| `[0]`, `[1]`, `[2]` | Returns a live matrix-row view. |
| `Position` | Read-only getter returning a detached Vector extracted by the selected SDK; changing it does not write the matrix. |
| `Angles` | Read-only getter returning a detached QAngle extracted by the selected SDK; changing it does not write the matrix. |

### Matrix methods

| Method | Contract |
| --- | --- |
| `GetMatrixComponentOffset(unRowIndex, unColumnIndex)` | Validates the indexes and returns the row-major component index, not a byte offset. Native reads and writes convert the corresponding byte displacement to BigInt. |
| `GetMatrixComponent(unRowIndex, unColumnIndex)` | Reads one detached or native float component. |
| `SetMatrixComponent(unRowIndex, unColumnIndex, flComponentValue)` | Writes one finite component and returns this matrix. |
| `GetMatrix3x4Row(unRowIndex)` and inherited `GetMatrixRow(unRowIndex)` | Allocates and returns a new live row view on every call. |
| `ConvertMatrixToArray()` | Returns a detached nested 3-by-4 array. |
| `CopyMatrix3x4From(MatrixLike)` / `CopyMatrix3x4To(TargetMatrixOut)` and inherited `CopyMathStructureFrom(MatrixLike)` / `CopyMathStructureTo(TargetMatrixOut)` | Copies 12 components and returns the destination. `From` converts an accepted source. `CopyMatrix3x4To()` requires a `Matrix3x4` target; inherited `CopyMathStructureTo()` requires an instance of the receiver's constructor, which differs for subclasses. |
| `CopyMathStructure()` | Returns a detached Matrix3x4. |
| `IsMathStructureValid()` | Reports whether every component is finite. |
| `IsMatrixEqual(MatrixLike)` | Performs exact component comparison. |
| `[Symbol.iterator]()` | Iterates live matrix-row views. |
| `SetMatrix3x4Axes(XAxis, YAxis, ZAxis, Position)` | Rebuilds this matrix through the selected SDK and returns this matrix. |
| `InvalidateMatrix3x4()` | Optional selected-SDK method that invalidates all components in place and returns this matrix. Validates the SDK result before writing; attached matrices store its Float32 bit patterns through unsigned integer writes with BigInt byte offsets, preserving non-finite values rejected by ordinary float setters. |

Each call to `GetMatrix3x4Row()` or inherited `GetMatrixRow()`, and each numeric matrix-index read, creates a new row wrapper. It exposes `Matrix`, `RowIndex`, numeric indexes `[0]` through `[3]`, `GetMatrixRowComponent(unColumnIndex)`, `SetMatrixRowComponent(unColumnIndex, flComponentValue)`, `ConvertMatrixRowToArray()`, and live iteration. Its component setters write through to the referenced matrix. `Matrix` and `RowIndex` are writable metadata; changing them retargets the wrapper, so preserve them when using the original row. Keeping a row wrapper alive does not keep borrowed native memory valid.

`CopyMathStructureFrom()` snapshots and validates all source components before writing the destination sequentially. Attached copying, axis replacement, and invalidation are not atomic; a later native write can fail after earlier components changed. The read-only matrix getters cannot be replaced by assignment, and mutating a detached `Position` or `Angles` result does not update matrix storage.

### Build and edit an affine transform

```js
const { Matrix3x4, Vector } = require("mathlib");

const g_flNativeMathTolerance = 0.0001;

const g_Transform = new Matrix3x4(new Vector(1, 0, 0), new Vector(0, 1, 0), new Vector(0, 0, 1), new Vector(128, -64, 32));
g_Transform[2][3] = 48;

const g_vecExpectedRow = [0, 0, 1, 48];
const g_vecTransformRow = g_Transform.GetMatrix3x4Row(2).ConvertMatrixRowToArray();

function IsExpectedRowComponent(flComponentValue, unComponentIndex) {
	return flComponentValue === g_vecExpectedRow[unComponentIndex];
}

if (!g_Transform.Position.IsMathStructureEqual([128, -64, 48]) || !g_vecTransformRow.every(IsExpectedRowComponent)) {
	throw new Error("Affine transform position or row mutation is incorrect.");
}

if (!g_Transform.Angles.IsMathStructureZero(g_flNativeMathTolerance)) {
	throw new Error("Identity axes produced nonzero angles.");
}
```

### Write through a native `matrix3x4_t`

```js
const { Allocate, Deallocate } = require("memory");
const { MATRIX3X4_SIZE, Matrix3x4, Vector } = require("mathlib");

const g_unAllocatedMatrixAddress = Allocate(MATRIX3X4_SIZE);
if ((typeof g_unAllocatedMatrixAddress !== "bigint") || (g_unAllocatedMatrixAddress <= 0n)) {
	throw new Error("Matrix3x4 allocation returned an invalid address.");
}

const g_vecMatrixErrors = [];
try {
	const Transform = Matrix3x4.CreateFromAddress(g_unAllocatedMatrixAddress);
	const AxesResult = Transform.SetMatrix3x4Axes(new Vector(1, 0, 0), new Vector(0, 1, 0), new Vector(0, 0, 1), new Vector(16, 32, 64));
	const WriteResult = Transform.SetMatrixComponent(0, 3, 24);

	const ObservedTransform = Matrix3x4.CreateFromAddress(g_unAllocatedMatrixAddress);
	if ((AxesResult !== Transform) || (WriteResult !== Transform) || !ObservedTransform.Position.IsMathStructureEqual([24, 32, 64])) {
		throw new Error("Native Matrix3x4 write-through failed.");
	}
} catch (CaughtError) {
	g_vecMatrixErrors.push(CaughtError);
} finally {
	try {
		if (!Deallocate(g_unAllocatedMatrixAddress)) {
			throw new Error("Matrix3x4 allocation cleanup failed.");
		}
	} catch (CaughtError) {
		g_vecMatrixErrors.push(CaughtError);
	}
}

if (g_vecMatrixErrors.length === 1) {
	throw g_vecMatrixErrors[0];
}

if (g_vecMatrixErrors.length > 1) {
	throw new AggregateError(g_vecMatrixErrors, "Matrix3x4 initialization or allocation cleanup failed.");
}
```

Capability-check `InvalidateMatrix3x4()` before using it on a cross-SDK plugin:

```js
const { Matrix3x4 } = require("mathlib");

const g_Transform = new Matrix3x4();
if (typeof g_Transform.InvalidateMatrix3x4 === "function") {
	if ((g_Transform.InvalidateMatrix3x4() !== g_Transform) || g_Transform.IsMathStructureValid()) {
		throw new Error("Matrix3x4 invalidation did not update the receiver.");
	}
}
```

## VMatrix

`VMatrix` is a four-row, four-column Source transform. It shares the live component and row-view behavior of `Matrix3x4`, adding conversion between the two matrix formats.

### Construction and fields

| Member | Contract |
| --- | --- |
| [`new VMatrix(...vecArgumentsList)`](#vmatrix) | Accepts no values for a detached zero matrix, one matrix-like value with exactly four rows of at least four components each or a flat sequence of at least 16 components (a `Matrix3x4` is converted through the selected SDK), or at least 16 finite row-major components. Extra flat components or row columns are ignored. |
| `VMatrix.TYPE_SIZE` | Initially equals `VMATRIX_SIZE`; mutable metadata, not a way to change the registered native layout. |
| `VMatrix.CreateMathStructureFromValue(MatrixLike)` | Returns a detached 4-by-4 copy; a Matrix3x4 input is first converted through the selected SDK. |
| `VMatrix.CreateFromAddress(unAddress, unAddressOffset = 0)` | Creates a non-owning `VMatrix` view at a nonzero effective address, or a detached zero value at `0n`; backing-range safety and lifetime remain the caller's responsibility. |
| `Address` | Read-only getter: BigInt backing address, or `0n` for detached storage. |
| `RowCount` | Read-only getter returning `4`. |
| `GetMemoryAddress()` and `HasMemoryAddress()` | Exposes the BigInt backing address and whether the matrix is memory-backed. |
| `Values` | Read-only getter returning a mutable flat local array of 16 row-major components, not an attached-memory view. Direct mutation bypasses finite-component validation; use `SetMatrixComponent()` for writes or `ConvertMatrixToArray()` for nested snapshots. |
| `[0]` through `[3]` | Returns a live matrix-row view with four indexed components. |
| `Position` | Read-only getter returning a detached Vector extracted by the selected SDK; changing it does not write the matrix. |
| `Angles` | Read-only getter returning a detached QAngle extracted by the selected SDK; changing it does not write the matrix. |

### Matrix methods

| Method | Contract |
| --- | --- |
| `GetMatrixComponentOffset(unRowIndex, unColumnIndex)` | Validates the indexes and returns the row-major component index, not a byte offset. Native reads and writes convert the corresponding byte displacement to BigInt. |
| `GetMatrixComponent(unRowIndex, unColumnIndex)` | Reads one detached or native component. |
| `SetMatrixComponent(unRowIndex, unColumnIndex, flComponentValue)` | Writes one finite component and returns this matrix. |
| `GetVMatrixRow(unRowIndex)` and inherited `GetMatrixRow(unRowIndex)` | Allocates and returns a new live row view on every call. |
| `ConvertMatrixToArray()` | Returns a detached nested 4-by-4 array. |
| `CopyVMatrixFrom(MatrixLike)` / `CopyVMatrixTo(TargetMatrixOut)` and inherited `CopyMathStructureFrom(MatrixLike)` / `CopyMathStructureTo(TargetMatrixOut)` | Copies 16 components and returns the destination. `From` converts an accepted source. `CopyVMatrixTo()` requires a `VMatrix` target; inherited `CopyMathStructureTo()` requires an instance of the receiver's constructor, which differs for subclasses. |
| `CopyMathStructure()` | Returns a detached VMatrix. |
| `IsMathStructureValid()` | Reports whether every component is finite. |
| `IsMatrixEqual(MatrixLike)` | Performs exact component comparison. |
| `[Symbol.iterator]()` | Iterates live matrix-row views. |
| `SetVMatrixFromMatrix3x4(MatrixLike)` | Converts an affine `Matrix3x4` through the selected SDK, replaces this matrix, and returns this matrix. |
| `ConvertVMatrixToMatrix3x4()` | Returns a detached `Matrix3x4` conversion. |
| `SetIdentityVMatrix()` | Optional selected-SDK method that writes an identity matrix and returns this matrix. |

Rows expose the same `Matrix`, `RowIndex`, `[0]` through `[3]`, `GetMatrixRowComponent()`, `SetMatrixRowComponent()`, `ConvertMatrixRowToArray()`, and iterator contract described for `Matrix3x4`.

### Convert an affine transform

```js
const { Matrix3x4, VMatrix, Vector } = require("mathlib");

const g_EntityTransform = new Matrix3x4(new Vector(1, 0, 0), new Vector(0, 1, 0), new Vector(0, 0, 1), new Vector(256, 128, 32));
const g_WorldTransform = new VMatrix(g_EntityTransform);
g_WorldTransform[2][3] = 48;
const g_UpdatedEntityTransform = g_WorldTransform.ConvertVMatrixToMatrix3x4();
const g_vecBottomRow = g_WorldTransform.GetVMatrixRow(3).ConvertMatrixRowToArray();
const g_vecExpectedBottomRow = [0, 0, 0, 1];

function IsExpectedBottomRowComponent(flComponentValue, unComponentIndex) {
	return flComponentValue === g_vecExpectedBottomRow[unComponentIndex];
}

if (!g_UpdatedEntityTransform.Position.IsMathStructureEqual([256, 128, 48])) {
	throw new Error("VMatrix conversion lost the edited translation.");
}

if (!g_vecBottomRow.every(IsExpectedBottomRowComponent)) {
	throw new Error("Affine VMatrix has an invalid homogeneous row.");
}
```

### Reuse native matrix storage

```js
const { Allocate, Deallocate } = require("memory");
const { VMATRIX_SIZE, Matrix3x4, VMatrix, Vector } = require("mathlib");

const g_unAllocatedVMatrixAddress = Allocate(VMATRIX_SIZE);
if ((typeof g_unAllocatedVMatrixAddress !== "bigint") || (g_unAllocatedVMatrixAddress <= 0n)) {
	throw new Error("VMatrix allocation returned an invalid address.");
}

const g_vecVMatrixErrors = [];
try {
	const WorldTransform = VMatrix.CreateFromAddress(g_unAllocatedVMatrixAddress);
	const AffineTransform = new Matrix3x4(new Vector(1, 0, 0), new Vector(0, 1, 0), new Vector(0, 0, 1), new Vector(64, 96, 128));
	const ConversionResult = WorldTransform.SetVMatrixFromMatrix3x4(AffineTransform);
	const WriteResult = WorldTransform.SetMatrixComponent(3, 3, 1);
	const ObservedTransform = VMatrix.CreateFromAddress(g_unAllocatedVMatrixAddress);
	if ((ConversionResult !== WorldTransform) || (WriteResult !== WorldTransform) || !ObservedTransform.Position.IsMathStructureEqual([64, 96, 128])) {
		throw new Error("Native VMatrix storage did not preserve the affine transform.");
	}
} catch (CaughtError) {
	g_vecVMatrixErrors.push(CaughtError);
} finally {
	try {
		if (!Deallocate(g_unAllocatedVMatrixAddress)) {
			throw new Error("VMatrix allocation cleanup failed.");
		}
	} catch (CaughtError) {
		g_vecVMatrixErrors.push(CaughtError);
	}
}

if (g_vecVMatrixErrors.length === 1) {
	throw g_vecVMatrixErrors[0];
}

if (g_vecVMatrixErrors.length > 1) {
	throw new AggregateError(g_vecVMatrixErrors, "VMatrix initialization or allocation cleanup failed.");
}
```

Capability-check identity initialization when the same plugin targets multiple SDK branches:

```js
const { VMatrix } = require("mathlib");

const g_unMatrixColumnCount = 4;
const g_Transform = new VMatrix();
if (typeof g_Transform.SetIdentityVMatrix === "function") {
	if (g_Transform.SetIdentityVMatrix() !== g_Transform) {
		throw new Error("SetIdentityVMatrix() did not return its receiver.");
	}

	for (let unRowIndex = 0; unRowIndex < g_Transform.RowCount; ++unRowIndex) {
		for (let unColumnIndex = 0; unColumnIndex < g_unMatrixColumnCount; ++unColumnIndex) {
			const flExpectedComponentValue = (unRowIndex === unColumnIndex) ? 1 : 0;
			if (g_Transform.GetMatrixComponent(unRowIndex, unColumnIndex) !== flExpectedComponentValue) {
				throw new Error(`Identity mismatch at [${unRowIndex}][${unColumnIndex}].`);
			}
		}
	}
}
```

## Free vector functions

The free functions call the selected SDK directly. Vector-valued results are plain records with `X`, `Y`, and `Z`, not `Vector` instances. Use `Vector.CreateMathStructureFromValue(VectorLike)` when subsequent class methods or address-backed copies are needed.

The native runtime remains private. Use the documented public fields and methods rather than implementation storage or raw native objects. Public QAngle-like results use `X`/`Y`/`Z` in pitch/yaw/roll order; the package explicitly projects the native record's `Pitch`/`Yaw`/`Roll` fields at the output boundary.

| Function | Contract |
| --- | --- |
| `AddVector(FirstVector, SecondVector)` | Returns the vector or scalar sum as a vector record. |
| `SubtractVector(FirstVector, SecondVector)` | Returns the vector or scalar difference as a vector record. |
| `MultiplyVector(FirstVector, SecondVector)` | Returns the component-wise or scalar product as a vector record. |
| `DivideVector(FirstVector, SecondVector)` | Returns the component-wise or scalar quotient as a vector record. |
| `GetRandomVector(flMinimumComponent = 0, flMaximumComponent = 1)` | Returns a vector record whose components are independently randomized in the requested range. |
| `NegateVector(VectorValue)` | Returns a negated vector record. |
| `IsVectorZero(VectorValue, flTolerance = 0.01)` | Reports whether every component is within the requested tolerance of zero. |
| `IsVectorLengthGreaterThan(VectorValue, flComparisonLength)` | Compares the three-dimensional length with a finite threshold. |
| `IsVectorLengthLessThan(VectorValue, flComparisonLength)` | Compares the three-dimensional length with a finite threshold. |
| `GetVectorLength(VectorValue)` and `GetVectorLengthSquared(VectorValue)` | Returns the three-dimensional magnitude or squared magnitude. |
| `GetVectorLength2D(VectorValue)` and `GetVectorLength2DSquared(VectorValue)` | Returns the horizontal magnitude or squared magnitude. |
| `NormalizeVector(VectorValue)` | Returns normalized `X`, `Y`, and `Z` components plus the original magnitude under `Length`. |
| `CalculateVectorDotProduct(FirstVector, SecondVector)` | Returns the scalar dot product. |
| `CalculateVectorCrossProduct(FirstVector, SecondVector)` | Returns a perpendicular vector record. |
| `CalculateVectorDistance(FirstVector, SecondVector)` and `CalculateVectorDistanceSquared(FirstVector, SecondVector)` | Returns separation or squared separation. |
| `MultiplyAndAddVector(FirstVector, SecondVector, flScalar)` | Returns `FirstVector + SecondVector * flScalar`. |
| `GetMinimumVector(FirstVector, SecondVector)` and `GetMaximumVector(FirstVector, SecondVector)` | Returns the component-wise minimum or maximum record. |
| `ConvertQAngleToVectors(QAngleValue)` | Returns vector records under `Forward`, `Right`, and `Up` from a QAngle-like value. |
| `ConvertVectorToQAngle(VectorValue, PseudoUpVector = null)` | Returns a QAngle-like record for a direction, optionally preserving a pseudo-up direction. |
| `GetVectorPerpendicularBasis(DirectionVector)` | Returns perpendicular records under `Right` and `Up` for a forward direction. |
| `IsVectorWithinBox(VectorValue, MinimumCorner, MaximumCorner)` | Optional selected-SDK point-in-axis-aligned-box test. Corner order does not matter. |

### Inspect displacement and direction

```js
const {
	CalculateVectorCrossProduct,
	CalculateVectorDistance,
	CalculateVectorDistanceSquared,
	CalculateVectorDotProduct,
	GetVectorLength,
	GetVectorLength2D,
	GetVectorLength2DSquared,
	GetVectorLengthSquared,
	NormalizeVector,
	SubtractVector,
	Vector,
} = require("mathlib");

const g_flNativeMathTolerance = 0.0001;

const g_MuzzlePosition = new Vector(128, 64, 48);
const g_TargetPosition = new Vector(320, 160, 80);
const g_DisplacementRecord = SubtractVector(g_TargetPosition, g_MuzzlePosition);
const g_NormalizedDirectionRecord = NormalizeVector(g_DisplacementRecord);
const g_DirectionVector = Vector.CreateMathStructureFromValue(g_NormalizedDirectionRecord);
const g_WorldUpVector = new Vector(0, 0, 1);
const g_flSeparation = CalculateVectorDistance(g_MuzzlePosition, g_TargetPosition);
const g_flSeparationSquared = CalculateVectorDistanceSquared(g_MuzzlePosition, g_TargetPosition);
const g_flDisplacementLength = GetVectorLength(g_DisplacementRecord);
const g_flDisplacementLengthSquared = GetVectorLengthSquared(g_DisplacementRecord);
const g_flHorizontalLength = GetVectorLength2D(g_DisplacementRecord);
const g_flHorizontalLengthSquared = GetVectorLength2DSquared(g_DisplacementRecord);
const g_RightVector = Vector.CreateMathStructureFromValue(CalculateVectorCrossProduct(g_DirectionVector, g_WorldUpVector));
if ((g_flSeparationSquared !== 47104) || (g_flDisplacementLengthSquared !== 47104) || (g_flHorizontalLengthSquared !== 46080)) {
	throw new Error("Squared displacement metrics are incorrect.");
}

if ((Math.abs(g_flSeparation - g_flDisplacementLength) > g_flNativeMathTolerance) || (Math.abs(g_flDisplacementLength - g_NormalizedDirectionRecord.Length) > g_flNativeMathTolerance)) {
	throw new Error("Distance, length, and normalization disagree.");
}

if ((Math.abs(g_flHorizontalLength - Math.sqrt(46080)) > g_flNativeMathTolerance) || (Math.abs(g_DirectionVector.Length - 1) > g_flNativeMathTolerance)) {
	throw new Error("Horizontal or normalized length is incorrect.");
}

if ((Math.abs(CalculateVectorDotProduct(g_RightVector, g_DirectionVector)) > g_flNativeMathTolerance) || (Math.abs(CalculateVectorDotProduct(g_DirectionVector, g_WorldUpVector) - g_DirectionVector.Z) > g_flNativeMathTolerance)) {
	throw new Error("Dot and cross products disagree with the normalized direction.");
}
```

### Interpolate and bound a position

```js
const {
	GetMaximumVector,
	GetMinimumVector,
	MultiplyAndAddVector,
	SubtractVector,
	Vector,
} = require("mathlib");

const g_StartPosition = new Vector(-32, 16, 8);
const g_DestinationPosition = new Vector(96, 80, 72);
const g_DisplacementRecord = SubtractVector(g_DestinationPosition, g_StartPosition);
const g_HalfwayPosition = Vector.CreateMathStructureFromValue(MultiplyAndAddVector(g_StartPosition, g_DisplacementRecord, 0.5));
const g_MinimumCorner = new Vector(0, 0, 0);
const g_MaximumCorner = new Vector(64, 64, 64);
const g_BoundedPosition = Vector.CreateMathStructureFromValue(GetMaximumVector(g_MinimumCorner, GetMinimumVector(g_HalfwayPosition, g_MaximumCorner)));
if (!g_HalfwayPosition.IsMathStructureEqual([32, 48, 40]) || !g_BoundedPosition.IsMathStructureEqual([32, 48, 40])) {
	throw new Error("MultiplyAndAddVector(), GetMinimumVector(), or GetMaximumVector() produced an incorrect bounded midpoint.");
}
```

### Convert between directions and angles

```js
const {
	CalculateVectorDotProduct,
	ConvertQAngleToVectors,
	ConvertVectorToQAngle,
	GetVectorPerpendicularBasis,
	QAngle,
	Vector,
} = require("mathlib");

const g_flNativeMathTolerance = 0.0001;

const g_ViewAngles = new QAngle(-12, 135, 0);
const g_AngleBasis = ConvertQAngleToVectors(g_ViewAngles);
const g_ForwardVector = Vector.CreateMathStructureFromValue(g_AngleBasis.Forward);
const g_PerpendicularBasis = GetVectorPerpendicularBasis(g_ForwardVector);
const g_RestoredAngles = QAngle.CreateMathStructureFromValue(ConvertVectorToQAngle(g_ForwardVector, g_AngleBasis.Up));
const g_RightVector = Vector.CreateMathStructureFromValue(g_PerpendicularBasis.Right);
const g_UpVector = Vector.CreateMathStructureFromValue(g_PerpendicularBasis.Up);
if ((Math.abs(CalculateVectorDotProduct(g_ForwardVector, g_RightVector)) > g_flNativeMathTolerance) || (Math.abs(CalculateVectorDotProduct(g_ForwardVector, g_UpVector)) > g_flNativeMathTolerance)) {
	throw new Error("GetVectorPerpendicularBasis() returned a non-perpendicular basis.");
}

for (let unComponentIndex = 0; unComponentIndex < g_ViewAngles.ComponentNames.length; ++unComponentIndex) {
	if (Math.abs(g_RestoredAngles[unComponentIndex] - g_ViewAngles[unComponentIndex]) > g_flNativeMathTolerance) {
		throw new Error(`ConvertVectorToQAngle() changed component ${unComponentIndex}.`);
	}
}
```

### Check an SDK-dependent bounding box

```js
const { IsVectorWithinBox, Vector } = require("mathlib");

if (typeof IsVectorWithinBox === "function") {
	const InsidePoint = new Vector(16, 24, 32);
	const OutsidePoint = new Vector(80, 24, 32);
	const MinimumCorner = new Vector(0, 0, 0);
	const MaximumCorner = new Vector(64, 64, 64);
	if (!IsVectorWithinBox(InsidePoint, MinimumCorner, MaximumCorner) || IsVectorWithinBox(OutsidePoint, MaximumCorner, MinimumCorner)) {
		throw new Error("SDK bounding-box test classified a point incorrectly.");
	}
}
```

## Free orientation functions

These functions call the selected SDK conversion routines directly. They return plain component records so callers can either serialize them immediately or wrap them with `QAngle.CreateMathStructureFromValue()`, `Quaternion.CreateMathStructureFromValue()`, or `RadianEuler.CreateMathStructureFromValue()`.

| Function | Contract |
| --- | --- |
| `ConvertQAngleToRadianEuler(QAngleValue)` | Returns an SDK-order radian record: `X` roll, `Y` pitch, `Z` yaw. |
| `ConvertRadianEulerToQuaternion(RadianEulerValue)` | Converts a RadianEuler-like value into `X`, `Y`, `Z`, and `W`. |
| `ConvertQuaternionToRadianEuler(QuaternionValue)` | Returns an SDK-order radian record: `X` roll, `Y` pitch, `Z` yaw. |
| `ConvertRadianEulerToQAngle(RadianEulerValue)` | Returns a QAngle-like degree record with `X`, `Y`, and `Z` components. |

### Round-trip an orientation through a quaternion

```js
const {
	ConvertQAngleToRadianEuler,
	ConvertQuaternionToRadianEuler,
	ConvertRadianEulerToQAngle,
	ConvertRadianEulerToQuaternion,
	QAngle,
	Quaternion,
	RadianEuler,
} = require("mathlib");

const g_flNativeMathTolerance = 0.0001;

const g_SourceAngles = new QAngle(-15, 30, 8);
const g_RadianAngles = RadianEuler.CreateMathStructureFromValue(ConvertQAngleToRadianEuler(g_SourceAngles));
const g_QuaternionValue = Quaternion.CreateMathStructureFromValue(ConvertRadianEulerToQuaternion(g_RadianAngles));
const g_RestoredRadianAngles = RadianEuler.CreateMathStructureFromValue(ConvertQuaternionToRadianEuler(g_QuaternionValue));
const g_RestoredAngles = QAngle.CreateMathStructureFromValue(ConvertRadianEulerToQAngle(g_RestoredRadianAngles));
if (!g_RadianAngles.IsMathStructureValid() || !g_QuaternionValue.IsMathStructureValid() || !g_RestoredAngles.IsMathStructureValid()) {
	throw new Error("Free orientation conversion produced non-finite components.");
}

for (let unComponentIndex = 0; unComponentIndex < g_SourceAngles.ComponentNames.length; ++unComponentIndex) {
	if (Math.abs(g_RestoredAngles[unComponentIndex] - g_SourceAngles[unComponentIndex]) > g_flNativeMathTolerance) {
		throw new Error(`Free orientation round trip changed component ${unComponentIndex}.`);
	}
}
```

### Update an address-backed quaternion

The conversion result can be copied into existing borrowed storage without creating a second native allocation. This example creates and frees one plugin-owned allocation; do not free borrowed engine-owned storage:

```js
const { Allocate, Deallocate } = require("memory");
const { QUATERNION_SIZE, QAngle, Quaternion, RadianEuler } = require("mathlib");

const g_flNativeMathTolerance = 0.0001;

const g_unAllocatedQuaternionAddress = Allocate(QUATERNION_SIZE);
if ((typeof g_unAllocatedQuaternionAddress !== "bigint") || (g_unAllocatedQuaternionAddress <= 0n)) {
	throw new Error("Quaternion allocation returned an invalid address.");
}

const g_vecQuaternionErrors = [];
try {
	const OutputQuaternion = Quaternion.CreateFromAddress(g_unAllocatedQuaternionAddress);
	const InputAngles = new QAngle(0, 90, 0);
	const RadianAngles = new RadianEuler(InputAngles);
	const ExpectedQuaternion = Quaternion.CreateQuaternionFromRadianEuler(RadianAngles);
	if (OutputQuaternion.CopyMathStructureFrom(ExpectedQuaternion) !== OutputQuaternion) {
		throw new Error("CopyMathStructureFrom() did not return its destination.");
	}

	const ObservedQuaternion = Quaternion.CreateFromAddress(g_unAllocatedQuaternionAddress);
	for (let unComponentIndex = 0; unComponentIndex < ExpectedQuaternion.ComponentNames.length; ++unComponentIndex) {
		if (Math.abs(ObservedQuaternion[unComponentIndex] - ExpectedQuaternion[unComponentIndex]) > g_flNativeMathTolerance) {
			throw new Error(`Second Quaternion view changed component ${unComponentIndex}.`);
		}
	}
} catch (CaughtError) {
	g_vecQuaternionErrors.push(CaughtError);
} finally {
	try {
		if (!Deallocate(g_unAllocatedQuaternionAddress)) {
			throw new Error("Quaternion allocation cleanup failed.");
		}
	} catch (CaughtError) {
		g_vecQuaternionErrors.push(CaughtError);
	}
}

if (g_vecQuaternionErrors.length === 1) {
	throw g_vecQuaternionErrors[0];
}

if (g_vecQuaternionErrors.length > 1) {
	throw new AggregateError(g_vecQuaternionErrors, "Quaternion initialization or allocation cleanup failed.");
}
```

## Free matrix functions

The free matrix functions operate on nested or flat numeric arrays and return detached arrays or component records. Convert a `Matrix3x4` or `VMatrix` instance first with its inherited `ConvertMatrixToArray()` method.

| Function | Contract |
| --- | --- |
| `CreateMatrix3x4FromAxes(XAxis, YAxis, ZAxis, Position)` | Returns a detached 3-by-4 array built by the selected SDK. |
| `GetMatrix3x4Position(Matrix3x4Value)` | Extracts a position record with `X`, `Y`, and `Z` from a 3-by-4 array. |
| `GetMatrix3x4Angles(Matrix3x4Value)` | Extracts an angle record with `X`, `Y`, and `Z` components in pitch, yaw, and roll order from a 3-by-4 array. |
| `InvalidateMatrix3x4(Matrix3x4Value)` | Optional selected-SDK function returning an invalidated detached 3-by-4 array. |
| `ConvertMatrix3x4ToVMatrix(Matrix3x4Value)` | Converts a 3-by-4 array into a detached 4-by-4 array. |
| `ConvertVMatrixToMatrix3x4(VMatrixValue)` | Converts a 4-by-4 array into a detached 3-by-4 array. |
| `GetVMatrixPosition(VMatrixValue)` | Extracts a position record with `X`, `Y`, and `Z` from a 4-by-4 array. |
| `GetVMatrixAngles(VMatrixValue)` | Extracts an angle record with `X`, `Y`, and `Z` components in pitch, yaw, and roll order from a 4-by-4 array. |
| `CreateIdentityVMatrix()` | Optional selected-SDK function returning a detached 4-by-4 identity array. |

### Build and inspect a raw affine matrix

```js
const {
	CreateMatrix3x4FromAxes,
	GetMatrix3x4Angles,
	GetMatrix3x4Position,
	QAngle,
	Vector,
} = require("mathlib");

const g_flNativeMathTolerance = 0.0001;

const g_vecTransform = CreateMatrix3x4FromAxes(new Vector(1, 0, 0), new Vector(0, 1, 0), new Vector(0, 0, 1), new Vector(128, 256, 64));
const g_Position = Vector.CreateMathStructureFromValue(GetMatrix3x4Position(g_vecTransform));
const g_Angles = QAngle.CreateMathStructureFromValue(GetMatrix3x4Angles(g_vecTransform));
if (!g_Position.IsMathStructureEqual([128, 256, 64]) || !g_Angles.IsMathStructureZero(g_flNativeMathTolerance)) {
	throw new Error("Raw affine matrix has an incorrect position or orientation.");
}
```

### Convert between matrix formats

```js
const {
	ConvertMatrix3x4ToVMatrix,
	ConvertVMatrixToMatrix3x4,
	CreateMatrix3x4FromAxes,
	GetVMatrixAngles,
	GetVMatrixPosition,
	Matrix3x4,
	QAngle,
	Vector,
} = require("mathlib");

const g_flNativeMathTolerance = 0.0001;

const g_vecAffineTransform = CreateMatrix3x4FromAxes(new Vector(1, 0, 0), new Vector(0, 1, 0), new Vector(0, 0, 1), new Vector(32, 48, 96));
const g_vecWorldTransform = ConvertMatrix3x4ToVMatrix(g_vecAffineTransform);
const g_RoundTripMatrix = Matrix3x4.CreateMathStructureFromValue(ConvertVMatrixToMatrix3x4(g_vecWorldTransform));
const g_AffineMatrix = Matrix3x4.CreateMathStructureFromValue(g_vecAffineTransform);
const g_Position = Vector.CreateMathStructureFromValue(GetVMatrixPosition(g_vecWorldTransform));
const g_Angles = QAngle.CreateMathStructureFromValue(GetVMatrixAngles(g_vecWorldTransform));
if (!g_Position.IsMathStructureEqual([32, 48, 96]) || !g_Angles.IsMathStructureZero(g_flNativeMathTolerance) || !g_RoundTripMatrix.IsMatrixEqual(g_AffineMatrix)) {
	throw new Error("Matrix format round trip changed the affine transform.");
}
```

### Use optional matrix capabilities

```js
const { CreateIdentityVMatrix, InvalidateMatrix3x4, Matrix3x4, VMatrix } = require("mathlib");

function HasNaNMatrixComponent(flComponentValue) {
	return Number.isNaN(flComponentValue);
}

function HasNaNMatrixRow(vecMatrixRow) {
	return vecMatrixRow.some(HasNaNMatrixComponent);
}

if (typeof CreateIdentityVMatrix === "function") {
	const unMatrixColumnCount = 4;
	const IdentityVMatrix = VMatrix.CreateMathStructureFromValue(CreateIdentityVMatrix());
	for (let unRowIndex = 0; unRowIndex < IdentityVMatrix.RowCount; ++unRowIndex) {
		for (let unColumnIndex = 0; unColumnIndex < unMatrixColumnCount; ++unColumnIndex) {
			const flExpectedComponentValue = (unRowIndex === unColumnIndex) ? 1 : 0;
			if (IdentityVMatrix.GetMatrixComponent(unRowIndex, unColumnIndex) !== flExpectedComponentValue) {
				throw new Error(`Identity mismatch at [${unRowIndex}][${unColumnIndex}].`);
			}
		}
	}
}

if (typeof InvalidateMatrix3x4 === "function") {
	const EmptyMatrix = new Matrix3x4();
	const vecInvalidMatrix = InvalidateMatrix3x4(EmptyMatrix.ConvertMatrixToArray());
	if (!vecInvalidMatrix.some(HasNaNMatrixRow)) {
		throw new Error("InvalidateMatrix3x4() returned no NaN components.");
	}

	try {
		Matrix3x4.CreateMathStructureFromValue(vecInvalidMatrix);
		throw new Error("Matrix3x4 accepted invalidated components.");
	} catch (CaughtError) {
		if (!(CaughtError instanceof TypeError)) {
			throw CaughtError;
		}
	}
}
```

The invalidated raw array contains `NaN`, so the strict `Matrix3x4.CreateMathStructureFromValue()` factory rejects it. To invalidate a mutable class instance in place, call its optional `InvalidateMatrix3x4()` method.

## Strict inputs and errors

Class constructors, component setters, and package result validation require finite JavaScript numbers rather than coercing strings, booleans, or `BigInt` components. Named-field value factories default missing or `undefined` components to zero, but reject `null`; array-like components must be present and finite. Some free functions and SDK-backed methods forward their inputs directly to the native parsers described below, so do not assume identical coercion rules on every entry path. Native-address factories require `BigInt`, not strings, Numbers, or address wrapper objects. Invalid inputs raise the original JavaScript or native V8 error.

| Input | Requirement |
| --- | --- |
| Class constructor/setter and package-result components | Finite JavaScript numbers; named-field value factories have the missing/`undefined` defaults described above, not `null` defaults. Native-forwarded input coercion is described below. |
| Plane `Type` and `SignBits` | Integers from 0 through 255. |
| Class matrix values | Flat array-like values with at least 12 or 16 finite components, or nested array-like values with exactly the class's row count and at least four finite components per row; an object may supply either shape through `ConvertMatrixToArray()`. Native free-function parsing differs as described below. |
| Matrix and component indexes | Non-negative safe integers within the class's row/column bounds. |
| `Type.CreateFromAddress(unAddress, unAddressOffset = 0)` arguments | Addresses are non-negative `BigInt` values, never strings or Numbers; this factory's optional offsets are non-negative safe JavaScript integers. Internal native-memory byte offsets use BigInt. |
| `CopyMathStructureTo(TargetStructureOut)` for float structures / `CopyMathStructureTo(TargetMatrixOut)` for matrices | An instance compatible with the receiver's constructor. |
| Vector/QAngle output parameters | An instance of the required output class, not a plain object. |

Native vector, angle, and quaternion input parsers use JavaScript numeric conversion, unlike the package-level strict component validation. They reject non-finite values and values outside the native `float` range before narrowing; nullish object/array components retain their existing default/fallback behavior. Vector/angle objects prefer `X`/`Y`/`Z`, with `Pitch`/`Yaw`/`Roll` as fallbacks. Quaternion objects use `X`/`Y`/`Z`/`W`, or array indexes 0 through 3, and default missing components to zero. Outputs are committed only after all components succeed; getter and numeric-conversion exceptions are preserved.

Native matrix parsers require actual arrays. An outer length of at least 12 (3x4) or 16 (4x4) selects flat input first. Otherwise, the input must provide at least three or four array rows respectively, each with at least four entries; only the required rows and columns are read. Extra entries in the selected shape are ignored, but a long nested array that reaches the flat-input threshold is parsed as flat input, not as extra rows. Components use JavaScript numeric conversion and must be finite and within the native `float` range; all entries are staged before committing any output. Exceptions from row/component getters or numeric conversion are preserved.

Native Vector, QAngle, and quaternion value records have own data properties rather than invoking inherited setters: `X`/`Y`/`Z`, `Pitch`/`Yaw`/`Roll`, and `X`/`Y`/`Z`/`W`, respectively. Native normalization adds the original vector length as an own `Length` data property; direction/perpendicular results likewise define own `Forward`/`Right`/`Up` fields as applicable. Native matrix results are nested arrays with own row and component indexes, without invoking inherited index setters. These detached records do not acquire ownership of a native address.

Native callbacks for vector creation, zero checks, negation, binary operations, length/comparison, normalization, dot/cross products, distance, box tests, radian-Euler/quaternion/QAngle conversions, direction/perpendicular vectors, vector/angle conversions, and the matrix creation/conversion/position/angle/invalidation operations translate C++ exceptions into JavaScript errors. Random bounds default to 0 and 1; arithmetic retains the selected SDK's floating-point behavior. Native length comparisons compare squared values, so negative thresholds have the same magnitude semantics as positive thresholds.

Use property detection for capability-conditioned APIs. A missing API means that the selected SDK does not expose it; SourceJS does not install a throwing stub.

```js
const { Matrix3x4, Plane, Vector } = require("mathlib");

function CreateInvalidVectorAddress() {
	return Vector.CreateFromAddress("0x1234");
}

function CreateInvalidPlane() {
	return new Plane(new Vector(0, 0, 1), 64, 256, 0);
}

function SetInvalidMatrixComponent() {
	return new Matrix3x4().SetMatrixComponent(3, 0, 1);
}

function ValidateInvalidMathlibOperations() {
	const vecInvalidOperations = [
		{ ErrorType: TypeError, Operation: CreateInvalidVectorAddress },
		{ ErrorType: RangeError, Operation: CreateInvalidPlane },
		{ ErrorType: RangeError, Operation: SetInvalidMatrixComponent },
	];

	for (const { ErrorType, Operation } of vecInvalidOperations) {
		let CaughtError = null;

		try {
			Operation();
		} catch (CaughtErrorValue) {
			CaughtError = CaughtErrorValue;
		}

		if (!(CaughtError instanceof ErrorType)) {
			throw new Error(`Mathlib operation did not throw ${ErrorType.name}.`);
		}
	}
}

ValidateInvalidMathlibOperations();
```

Do not retain an address-backed object beyond the lifetime of its engine object or allocation. Only call `memory.Deallocate(unAddress)` for memory allocated by the same plugin; engine-owned addresses are non-owning views.
