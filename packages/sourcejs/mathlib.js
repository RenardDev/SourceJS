"use strict";

const { GetRawModule } = require("internal/runtime");
const { RegisterObjectType } = require("memory");
const { Add, Read, ReadFloat, Write, WriteFloat } = require("memory/helpers");

const g_MathlibRuntime = GetRawModule("mathlib");

function GetNativeTypeSize(strSizePropertyName) {
	const unTypeSize = g_MathlibRuntime[strSizePropertyName];
	if (!Number.isSafeInteger(unTypeSize) || (unTypeSize <= 0)) {
		throw new TypeError(`mathlib.${strSizePropertyName} must be a positive safe integer.`);
	}

	return unTypeSize;
}

const g_unFloatSize = GetNativeTypeSize("FLOAT_SIZE");
const g_unVectorSize = GetNativeTypeSize("VECTOR_SIZE");
const g_unQAngleSize = GetNativeTypeSize("QANGLE_SIZE");
const g_unQuaternionSize = GetNativeTypeSize("QUATERNION_SIZE");
const g_unRadianEulerSize = GetNativeTypeSize("RADIAN_EULER_SIZE");
const g_unPlaneSize = GetNativeTypeSize("PLANE_SIZE");
const g_unMatrix3X4Size = GetNativeTypeSize("MATRIX3X4_SIZE");
const g_unVMatrixSize = GetNativeTypeSize("VMATRIX_SIZE");
const g_unMatrixColumnCount = 4;
const g_unMatrix3X4RowCount = 3;
const g_unVMatrixRowCount = 4;
const g_unMatrix3X4ComponentCount = g_unMatrix3X4RowCount * g_unMatrixColumnCount;
const g_unVMatrixComponentCount = g_unVMatrixRowCount * g_unMatrixColumnCount;
const g_unPlaneNormalOffset = 0;
const g_unPlaneDistanceOffset = g_unVectorSize;
const g_unPlaneTypeOffset = g_unPlaneDistanceOffset + g_unFloatSize;
const g_unPlaneSignBitsOffset = g_unPlaneTypeOffset + 1;

if (g_unFloatSize !== Float32Array.BYTES_PER_ELEMENT) {
	throw new RangeError("The selected SDK float layout is incompatible with native Float32 components.");
}

if (g_unPlaneSignBitsOffset >= g_unPlaneSize) {
	throw new RangeError("The selected SDK cplane_t layout is smaller than its required fields.");
}

if (g_unMatrix3X4Size !== (g_unMatrix3X4ComponentCount * g_unFloatSize)) {
	throw new RangeError("The selected SDK matrix3x4_t layout is incompatible with a 3-by-4 float matrix.");
}

if (g_unVMatrixSize !== (g_unVMatrixComponentCount * g_unFloatSize)) {
	throw new RangeError("The selected SDK VMatrix layout is incompatible with a 4-by-4 float matrix.");
}

// Preserve the finite-only float-write contract while explicitly invalidating native Float32 storage.
const g_unInvalidFloatBits = new Uint32Array(new Float32Array([Number.NaN]).buffer)[0];

function RequireFiniteNumber(dblNumberValue, strValueName) {
	if ((typeof dblNumberValue !== "number") || !Number.isFinite(dblNumberValue)) {
		throw new TypeError(`${strValueName} must be a finite number.`);
	}

	return dblNumberValue;
}

function ResolveOptionalNumber(dblNumberValue, strValueName, dblDefaultValue = 0) {
	return (dblNumberValue === undefined) ? dblDefaultValue : RequireFiniteNumber(dblNumberValue, strValueName);
}

function RequireByteValue(unByteValue, strValueName) {
	const unMaximumByteValue = 0xFF;

	if (!Number.isInteger(unByteValue) || (unByteValue < 0) || (unByteValue > unMaximumByteValue)) {
		throw new RangeError(`${strValueName} must be an integer between 0 and ${unMaximumByteValue}.`);
	}

	return unByteValue;
}

function RequireComponentIndex(unComponentIndex, unComponentCount) {
	if (!Number.isInteger(unComponentIndex) || (unComponentIndex < 0) || (unComponentIndex >= unComponentCount)) {
		throw new RangeError(`mathlib component index must be an integer between 0 and ${unComponentCount - 1}.`);
	}

	return unComponentIndex;
}

function ResolveMemoryAddress(unAddress, unAddressOffset = 0) {
	if ((typeof unAddress !== "bigint") || (unAddress < 0n)) {
		throw new TypeError("mathlib address must be a non-negative bigint.");
	}

	if (!Number.isSafeInteger(unAddressOffset) || (unAddressOffset < 0)) {
		throw new TypeError("mathlib address offset must be a non-negative safe integer.");
	}

	return (unAddressOffset === 0) ? unAddress : Add(unAddress, BigInt(unAddressOffset));
}

function GetArrayLikeLength(ArrayLike) {
	if ((ArrayLike === null) || (typeof ArrayLike !== "object")) {
		return null;
	}

	const unArrayLength = ArrayLike.length;
	if ((typeof unArrayLength !== "number") || !Number.isSafeInteger(unArrayLength) || (unArrayLength < 0)) {
		return null;
	}

	return unArrayLength;
}

function IsArrayLike(ArrayLike) {
	return GetArrayLikeLength(ArrayLike) !== null;
}

function ResolveVectorComponents(VectorLike, strValueName) {
	if ((VectorLike === null) || (typeof VectorLike !== "object")) {
		throw new TypeError(`${strValueName} must be a vector-like object or array.`);
	}

	const bHasNamedVectorComponent = ("X" in VectorLike) || ("Y" in VectorLike) || ("Z" in VectorLike);
	if (bHasNamedVectorComponent) {
		return [ResolveOptionalNumber(VectorLike.X, `${strValueName}.X`), ResolveOptionalNumber(VectorLike.Y, `${strValueName}.Y`), ResolveOptionalNumber(VectorLike.Z, `${strValueName}.Z`)];
	}

	const unArrayLength = GetArrayLikeLength(VectorLike);
	if (unArrayLength !== null) {
		if (unArrayLength < 3) {
			throw new TypeError(`${strValueName} must contain at least three components.`);
		}

		return [RequireFiniteNumber(VectorLike[0], `${strValueName}[0]`), RequireFiniteNumber(VectorLike[1], `${strValueName}[1]`), RequireFiniteNumber(VectorLike[2], `${strValueName}[2]`)];
	}

	throw new TypeError(`${strValueName} must expose X, Y, and Z.`);
}

function ResolveQuaternionComponents(QuaternionLike, strValueName) {
	if ((QuaternionLike === null) || (typeof QuaternionLike !== "object")) {
		throw new TypeError(`${strValueName} must be a quaternion-like object or array.`);
	}

	const bHasNamedQuaternionComponent = ("X" in QuaternionLike) || ("Y" in QuaternionLike) || ("Z" in QuaternionLike) || ("W" in QuaternionLike);
	if (bHasNamedQuaternionComponent) {
		return [ResolveOptionalNumber(QuaternionLike.X, `${strValueName}.X`), ResolveOptionalNumber(QuaternionLike.Y, `${strValueName}.Y`), ResolveOptionalNumber(QuaternionLike.Z, `${strValueName}.Z`), ResolveOptionalNumber(QuaternionLike.W, `${strValueName}.W`)];
	}

	const unArrayLength = GetArrayLikeLength(QuaternionLike);
	if (unArrayLength !== null) {
		if (unArrayLength < 4) {
			throw new TypeError(`${strValueName} must contain at least four components.`);
		}

		return [RequireFiniteNumber(QuaternionLike[0], `${strValueName}[0]`), RequireFiniteNumber(QuaternionLike[1], `${strValueName}[1]`), RequireFiniteNumber(QuaternionLike[2], `${strValueName}[2]`), RequireFiniteNumber(QuaternionLike[3], `${strValueName}[3]`)];
	}

	throw new TypeError(`${strValueName} must expose X, Y, Z, and W.`);
}

function CreateVectorRecord(VectorLike, strValueName) {
	const vecComponents = ResolveVectorComponents(VectorLike, strValueName);

	return { X: vecComponents[0], Y: vecComponents[1], Z: vecComponents[2] };
}

function CreateQAngleRecord(QAngleLike, strValueName) {
	if ((QAngleLike === null) || (typeof QAngleLike !== "object")) {
		throw new TypeError(`${strValueName} must be a native QAngle record.`);
	}

	return { X: RequireFiniteNumber(QAngleLike.Pitch, `${strValueName}.Pitch`), Y: RequireFiniteNumber(QAngleLike.Yaw, `${strValueName}.Yaw`), Z: RequireFiniteNumber(QAngleLike.Roll, `${strValueName}.Roll`) };
}

function CreateQuaternionRecord(QuaternionLike, strValueName) {
	const vecComponents = ResolveQuaternionComponents(QuaternionLike, strValueName);

	return { X: vecComponents[0], Y: vecComponents[1], Z: vecComponents[2], W: vecComponents[3] };
}

function ResolveMatrixComponents(MatrixLike, unRowCount, strValueName) {
	const unComponentCount = unRowCount * g_unMatrixColumnCount;
	const setConvertedMatrixObjects = new Set();

	let ResolvedMatrixLike = MatrixLike;
	while ((ResolvedMatrixLike !== null) && (typeof ResolvedMatrixLike === "object")) {
		const MatrixToArray = ResolvedMatrixLike.ConvertMatrixToArray;
		if (typeof MatrixToArray !== "function") {
			break;
		}

		if (setConvertedMatrixObjects.has(ResolvedMatrixLike)) {
			throw new TypeError(`${strValueName}.ConvertMatrixToArray() must not produce a cyclic matrix value.`);
		}

		setConvertedMatrixObjects.add(ResolvedMatrixLike);
		ResolvedMatrixLike = MatrixToArray.call(ResolvedMatrixLike);
	}

	const unMatrixLength = GetArrayLikeLength(ResolvedMatrixLike);
	if (unMatrixLength === null) {
		throw new TypeError(`${strValueName} must be a matrix-like array.`);
	}

	if (unMatrixLength === unRowCount) {
		const FirstMatrixRow = ResolvedMatrixLike[0];
		const unFirstMatrixRowLength = GetArrayLikeLength(FirstMatrixRow);
		if (unFirstMatrixRowLength !== null) {
			const vecComponentValues = [];
			for (let unRowIndex = 0; unRowIndex < unRowCount; unRowIndex += 1) {
				const MatrixRow = (unRowIndex === 0) ? FirstMatrixRow : ResolvedMatrixLike[unRowIndex];
				const unMatrixRowLength = (unRowIndex === 0) ? unFirstMatrixRowLength : GetArrayLikeLength(MatrixRow);
				if ((unMatrixRowLength === null) || (unMatrixRowLength < g_unMatrixColumnCount)) {
					throw new TypeError(`${strValueName}[${unRowIndex}] must contain four components.`);
				}

				for (let unColumnIndex = 0; unColumnIndex < g_unMatrixColumnCount; unColumnIndex += 1) {
					vecComponentValues.push(RequireFiniteNumber(MatrixRow[unColumnIndex], `${strValueName}[${unRowIndex}][${unColumnIndex}]`));
				}
			}

			return vecComponentValues;
		}
	}

	if (unMatrixLength < unComponentCount) {
		throw new TypeError(`${strValueName} must contain ${unComponentCount} components.`);
	}

	const vecComponentValues = [];
	for (let unComponentIndex = 0; unComponentIndex < unComponentCount; unComponentIndex += 1) {
		vecComponentValues.push(RequireFiniteNumber(ResolvedMatrixLike[unComponentIndex], `${strValueName}[${unComponentIndex}]`));
	}

	return vecComponentValues;
}

function DefineIndexedComponentProperties(ComponentOwner, vecComponentNames) {
	const unComponentCount = vecComponentNames.length;
	for (let unComponentIndex = 0; unComponentIndex < unComponentCount; unComponentIndex += 1) {
		const strComponentName = vecComponentNames[unComponentIndex];
		Object.defineProperty(ComponentOwner, unComponentIndex, {
			configurable: false,
			enumerable: false,
			get() {
				return this[strComponentName];
			},
			set(flComponentValue) {
				this[strComponentName] = flComponentValue;
			},
		});
	}
}

class FloatStructure {
	constructor(vecComponentNames, vecComponentValues, unAddress = 0n) {
		if (!Array.isArray(vecComponentNames)) {
			throw new TypeError("FloatStructure vecComponentNames must be an array.");
		}

		if (!Array.isArray(vecComponentValues)) {
			throw new TypeError("FloatStructure vecComponentValues must be an array.");
		}

		const unComponentCount = vecComponentNames.length;
		if (unComponentCount === 0) {
			throw new TypeError("FloatStructure vecComponentNames must not be empty.");
		}

		const strStructureName = this.constructor.name;
		const unNormalizedAddress = ResolveMemoryAddress(unAddress);
		const vecOwnedComponentNames = [];
		const vecNormalizedComponentValues = [];
		const setKnownComponentNames = new Set();
		for (let unComponentIndex = 0; unComponentIndex < unComponentCount; unComponentIndex += 1) {
			const strComponentName = vecComponentNames[unComponentIndex];
			if ((typeof strComponentName !== "string") || (strComponentName.length === 0)) {
				throw new TypeError(`FloatStructure vecComponentNames[${unComponentIndex}] must be a non-empty string.`);
			}

			if (setKnownComponentNames.has(strComponentName)) {
				throw new TypeError(`FloatStructure component name ${strComponentName} must be unique.`);
			}

			setKnownComponentNames.add(strComponentName);
			vecOwnedComponentNames.push(strComponentName);
			vecNormalizedComponentValues.push(ResolveOptionalNumber(vecComponentValues[unComponentIndex], `${strStructureName}.${strComponentName}`));
		}

		Object.freeze(vecOwnedComponentNames);

		this.#m_vecComponentNames = vecOwnedComponentNames;
		this.#m_unAddress = unNormalizedAddress;
		this.#m_vecValues = vecNormalizedComponentValues;

		for (let unComponentIndex = 0; unComponentIndex < unComponentCount; unComponentIndex += 1) {
			const strComponentName = vecOwnedComponentNames[unComponentIndex];
			Object.defineProperty(this, strComponentName, {
				configurable: false,
				enumerable: true,
				get() {
					return this.GetMathStructureComponent(unComponentIndex);
				},
				set(flComponentValue) {
					this.SetMathStructureComponent(unComponentIndex, flComponentValue);
				},
			});
		}

		DefineIndexedComponentProperties(this, vecOwnedComponentNames);
	}

	GetMemoryAddress() {
		return ResolveMemoryAddress(this.#m_unAddress);
	}

	HasMemoryAddress() {
		return this.GetMemoryAddress() !== 0n;
	}

	GetMathStructureComponent(unComponentIndex) {
		const vecComponentNames = this.#m_vecComponentNames;
		const unNormalizedComponentIndex = RequireComponentIndex(unComponentIndex, vecComponentNames.length);
		const unAddress = this.GetMemoryAddress();
		if (unAddress !== 0n) {
			return ReadFloat(unAddress, BigInt(unNormalizedComponentIndex * g_unFloatSize));
		}

		const vecComponentValues = this.#m_vecValues;

		return vecComponentValues[unNormalizedComponentIndex];
	}

	SetMathStructureComponent(unComponentIndex, flComponentValue) {
		const vecComponentNames = this.#m_vecComponentNames;
		const unNormalizedComponentIndex = RequireComponentIndex(unComponentIndex, vecComponentNames.length);
		const flNormalizedComponentValue = RequireFiniteNumber(flComponentValue, `${this.constructor.name}[${unNormalizedComponentIndex}]`);
		const unAddress = this.GetMemoryAddress();
		if (unAddress !== 0n) {
			WriteFloat(unAddress, flNormalizedComponentValue, BigInt(unNormalizedComponentIndex * g_unFloatSize));
		} else {
			const vecComponentValues = this.#m_vecValues;
			vecComponentValues[unNormalizedComponentIndex] = flNormalizedComponentValue;
		}

		return this;
	}

	ConvertMathStructureToArray() {
		const unComponentCount = this.#m_vecComponentNames.length;
		const vecComponentValues = [];
		for (let unComponentIndex = 0; unComponentIndex < unComponentCount; unComponentIndex += 1) {
			vecComponentValues.push(this.GetMathStructureComponent(unComponentIndex));
		}

		return vecComponentValues;
	}

	CopyMathStructure() {
		return new this.constructor(...this.ConvertMathStructureToArray());
	}

	CopyMathStructureFrom(StructureLike) {
		const SourceStructure = this.constructor.CreateMathStructureFromValue(StructureLike);
		const vecSourceComponentValues = SourceStructure.ConvertMathStructureToArray();
		const unComponentCount = this.#m_vecComponentNames.length;
		for (let unComponentIndex = 0; unComponentIndex < unComponentCount; unComponentIndex += 1) {
			this.SetMathStructureComponent(unComponentIndex, vecSourceComponentValues[unComponentIndex]);
		}

		return this;
	}

	CopyMathStructureTo(TargetStructureOut) {
		const StructureConstructor = this.constructor;
		if (!(TargetStructureOut instanceof StructureConstructor)) {
			throw new TypeError(`${StructureConstructor.name}.CopyMathStructureTo(TargetStructureOut) expects another ${StructureConstructor.name}.`);
		}

		return TargetStructureOut.CopyMathStructureFrom(this);
	}

	IsMathStructureValid() {
		const unComponentCount = this.#m_vecComponentNames.length;
		for (let unComponentIndex = 0; unComponentIndex < unComponentCount; unComponentIndex += 1) {
			if (!Number.isFinite(this.GetMathStructureComponent(unComponentIndex))) {
				return false;
			}
		}

		return true;
	}

	InvalidateMathStructure() {
		const unComponentCount = this.#m_vecComponentNames.length;
		const unAddress = this.GetMemoryAddress();
		if (unAddress !== 0n) {
			for (let unComponentIndex = 0; unComponentIndex < unComponentCount; unComponentIndex += 1) {
				Write(unAddress, "uint", g_unInvalidFloatBits, BigInt(unComponentIndex * g_unFloatSize));
			}
		} else {
			const vecComponentValues = this.#m_vecValues;
			for (let unComponentIndex = 0; unComponentIndex < unComponentCount; unComponentIndex += 1) {
				vecComponentValues[unComponentIndex] = Number.NaN;
			}
		}

		return this;
	}

	IsMathStructureEqual(StructureLike) {
		const OtherStructure = this.constructor.CreateMathStructureFromValue(StructureLike);
		const unComponentCount = this.#m_vecComponentNames.length;
		for (let unComponentIndex = 0; unComponentIndex < unComponentCount; unComponentIndex += 1) {
			if (this.GetMathStructureComponent(unComponentIndex) !== OtherStructure.GetMathStructureComponent(unComponentIndex)) {
				return false;
			}
		}

		return true;
	}

	*[Symbol.iterator]() {
		const unComponentCount = this.#m_vecComponentNames.length;
		for (let unComponentIndex = 0; unComponentIndex < unComponentCount; unComponentIndex += 1) {
			yield this.GetMathStructureComponent(unComponentIndex);
		}
	}

	get ComponentNames() {
		return this.#m_vecComponentNames;
	}

	get Values() {
		return this.#m_vecValues;
	}

	get Address() {
		return this.GetMemoryAddress();
	}

	#m_vecComponentNames;
	#m_unAddress;
	#m_vecValues;
}

Object.defineProperty(FloatStructure, "TYPE_SIZE", { configurable: true, enumerable: true, value: 0, writable: true });

class VectorStructure extends FloatStructure {
	constructor(flX = 0, flY = 0, flZ = 0, unAddress = 0n) {
		super(["X", "Y", "Z"], [flX, flY, flZ], unAddress);
	}

	static CreateMathStructureFromValue(VectorLike) {
		if (VectorLike instanceof this) {
			return VectorLike;
		}

		return new this(...ResolveVectorComponents(VectorLike, this.name));
	}

	InitializeMathStructure(flX = 0, flY = 0, flZ = 0) {
		const strStructureName = this.constructor.name;
		const flNormalizedX = ResolveOptionalNumber(flX, `${strStructureName}.X`);
		const flNormalizedY = ResolveOptionalNumber(flY, `${strStructureName}.Y`);
		const flNormalizedZ = ResolveOptionalNumber(flZ, `${strStructureName}.Z`);

		this.X = flNormalizedX;
		this.Y = flNormalizedY;
		this.Z = flNormalizedZ;

		return this;
	}

	RandomizeMathStructure(flMinimumComponent = 0, flMaximumComponent = 1) {
		const strStructureName = this.constructor.name;
		const flNormalizedMinimumComponent = RequireFiniteNumber(flMinimumComponent, `${strStructureName}.RandomizeMathStructure flMinimumComponent`);
		const flNormalizedMaximumComponent = RequireFiniteNumber(flMaximumComponent, `${strStructureName}.RandomizeMathStructure flMaximumComponent`);
		const RandomVectorValue = g_MathlibRuntime.CreateRandomVector(flNormalizedMinimumComponent, flNormalizedMaximumComponent);

		return this.CopyMathStructureFrom(CreateVectorRecord(RandomVectorValue, "mathlib.CreateRandomVector result"));
	}

	ClearMathStructure() {
		return this.InitializeMathStructure(0, 0, 0);
	}

	IsMathStructureZero(flTolerance = 0.01) {
		const flNormalizedTolerance = RequireFiniteNumber(flTolerance, `${this.constructor.name}.IsMathStructureZero flTolerance`);

		return g_MathlibRuntime.IsVectorZero(this, flNormalizedTolerance);
	}

	NormalizeMathStructure() {
		const NormalizationResult = g_MathlibRuntime.NormalizeVector(this);
		if ((NormalizationResult === null) || (typeof NormalizationResult !== "object")) {
			throw new TypeError("mathlib.NormalizeVector result must be an object.");
		}

		const NormalizedVector = CreateVectorRecord(NormalizationResult, "mathlib.NormalizeVector result");
		const flOriginalLength = RequireFiniteNumber(NormalizationResult.Length, "mathlib.NormalizeVector result.Length");

		this.InitializeMathStructure(NormalizedVector.X, NormalizedVector.Y, NormalizedVector.Z);

		return flOriginalLength;
	}

	GetNormalizedMathStructure() {
		const NormalizedVector = this.CopyMathStructure();
		NormalizedVector.NormalizeMathStructure();

		return NormalizedVector;
	}

	NegateMathStructure() {
		return this.CopyMathStructureFrom(CreateVectorRecord(g_MathlibRuntime.NegateVector(this), "mathlib.NegateVector result"));
	}

	GetNegativeMathStructure() {
		return this.CopyMathStructure().NegateMathStructure();
	}

	AddScalar(flScalar) {
		return this.constructor.CreateMathStructureFromValue(CreateVectorRecord(g_MathlibRuntime.AddVectors(this, flScalar), "mathlib.AddVectors result"));
	}

	AddVector(Operand) {
		return this.constructor.CreateMathStructureFromValue(CreateVectorRecord(g_MathlibRuntime.AddVectors(this, Operand), "mathlib.AddVectors result"));
	}

	SubtractScalar(flScalar) {
		return this.constructor.CreateMathStructureFromValue(CreateVectorRecord(g_MathlibRuntime.SubtractVectors(this, flScalar), "mathlib.SubtractVectors result"));
	}

	SubtractVector(Operand) {
		return this.constructor.CreateMathStructureFromValue(CreateVectorRecord(g_MathlibRuntime.SubtractVectors(this, Operand), "mathlib.SubtractVectors result"));
	}

	MultiplyScalar(flScalar) {
		return this.constructor.CreateMathStructureFromValue(CreateVectorRecord(g_MathlibRuntime.MultiplyVectors(this, flScalar), "mathlib.MultiplyVectors result"));
	}

	MultiplyVector(Operand) {
		return this.constructor.CreateMathStructureFromValue(CreateVectorRecord(g_MathlibRuntime.MultiplyVectors(this, Operand), "mathlib.MultiplyVectors result"));
	}

	DivideScalar(flScalar) {
		return this.constructor.CreateMathStructureFromValue(CreateVectorRecord(g_MathlibRuntime.DivideVectors(this, flScalar), "mathlib.DivideVectors result"));
	}

	DivideVector(Operand) {
		return this.constructor.CreateMathStructureFromValue(CreateVectorRecord(g_MathlibRuntime.DivideVectors(this, Operand), "mathlib.DivideVectors result"));
	}

	AddScalarInPlace(flScalar) {
		return this.CopyMathStructureFrom(this.AddScalar(flScalar));
	}

	AddVectorInPlace(Operand) {
		return this.CopyMathStructureFrom(this.AddVector(Operand));
	}

	SubtractScalarInPlace(flScalar) {
		return this.CopyMathStructureFrom(this.SubtractScalar(flScalar));
	}

	SubtractVectorInPlace(Operand) {
		return this.CopyMathStructureFrom(this.SubtractVector(Operand));
	}

	MultiplyScalarInPlace(flScalar) {
		return this.CopyMathStructureFrom(this.MultiplyScalar(flScalar));
	}

	MultiplyVectorInPlace(Operand) {
		return this.CopyMathStructureFrom(this.MultiplyVector(Operand));
	}

	DivideScalarInPlace(flScalar) {
		return this.CopyMathStructureFrom(this.DivideScalar(flScalar));
	}

	DivideVectorInPlace(Operand) {
		return this.CopyMathStructureFrom(this.DivideVector(Operand));
	}

	get Length() {
		return g_MathlibRuntime.GetVectorLength(this);
	}

	set Length(flVectorLength) {
		const strStructureName = this.constructor.name;
		const flRequestedLength = RequireFiniteNumber(flVectorLength, `${strStructureName}.Length`);
		const flCurrentLength = RequireFiniteNumber(this.Length, `${strStructureName} current length`);
		if (flCurrentLength === 0) {
			throw new RangeError(`${strStructureName}.Length cannot resize a zero-length value.`);
		}

		this.MultiplyVectorInPlace(flRequestedLength / flCurrentLength);
	}

	get LengthSquared() {
		return g_MathlibRuntime.GetVectorLengthSquared(this);
	}
}

class Vector extends VectorStructure {
	static CreateFromAddress(unAddress, unAddressOffset = 0) {
		return new Vector(0, 0, 0, ResolveMemoryAddress(unAddress, unAddressOffset));
	}

	CreateVector2DView() {
		const SourceVector = this;

		return Object.freeze({
			ConvertVector2DToArray() {
				return [SourceVector.X, SourceVector.Y];
			},
			get X() {
				return SourceVector.X;
			},
			set X(flComponentValue) {
				SourceVector.X = flComponentValue;
			},
			get Y() {
				return SourceVector.Y;
			},
			set Y(flComponentValue) {
				SourceVector.Y = flComponentValue;
			},
		});
	}

	IsVectorLengthGreaterThan(flComparisonLength) {
		const flNormalizedComparisonLength = RequireFiniteNumber(flComparisonLength, "Vector.IsVectorLengthGreaterThan flComparisonLength");

		return g_MathlibRuntime.IsVectorLengthGreaterThan(this, flNormalizedComparisonLength);
	}

	IsVectorLengthLessThan(flComparisonLength) {
		const flNormalizedComparisonLength = RequireFiniteNumber(flComparisonLength, "Vector.IsVectorLengthLessThan flComparisonLength");

		return g_MathlibRuntime.IsVectorLengthLessThan(this, flNormalizedComparisonLength);
	}

	CalculateVectorDistance(OtherVector) {
		return g_MathlibRuntime.ComputeVectorDistance(this, OtherVector);
	}

	CalculateVectorDistanceSquared(OtherVector) {
		return g_MathlibRuntime.ComputeVectorDistanceSquared(this, OtherVector);
	}

	SetVectorMultiplyAdd(FirstVector, SecondVector, flScalar) {
		const flNormalizedScalar = RequireFiniteNumber(flScalar, "Vector.SetVectorMultiplyAdd flScalar");
		const MultipliedVector = CreateVectorRecord(g_MathlibRuntime.MultiplyAddVectors(FirstVector, SecondVector, flNormalizedScalar), "mathlib.MultiplyAddVectors result");

		return this.CopyMathStructureFrom(MultipliedVector);
	}

	CalculateVectorDotProduct(OtherVector) {
		return g_MathlibRuntime.ComputeVectorDotProduct(this, OtherVector);
	}

	CalculateVectorCrossProduct(OtherVector) {
		return Vector.CreateMathStructureFromValue(CreateVectorRecord(g_MathlibRuntime.ComputeVectorCrossProduct(this, OtherVector), "mathlib.ComputeVectorCrossProduct result"));
	}

	GetMinimumVector(OtherVector) {
		return Vector.CreateMathStructureFromValue(CreateVectorRecord(g_MathlibRuntime.GetVectorMinimum(this, OtherVector), "mathlib.GetVectorMinimum result"));
	}

	GetMaximumVector(OtherVector) {
		return Vector.CreateMathStructureFromValue(CreateVectorRecord(g_MathlibRuntime.GetVectorMaximum(this, OtherVector), "mathlib.GetVectorMaximum result"));
	}

	ConvertVectorToQAngle(PseudoUpVector = null, AngleOut = null) {
		if ((AngleOut !== null) && !(AngleOut instanceof QAngle)) {
			throw new TypeError("Vector.ConvertVectorToQAngle AngleOut must be a QAngle.");
		}

		const AngleResult = (PseudoUpVector === null) ? g_MathlibRuntime.GetAngleFromVector(this) : g_MathlibRuntime.GetAngleFromVector(this, PseudoUpVector);
		const ConvertedAngle = QAngle.CreateMathStructureFromValue(CreateQAngleRecord(AngleResult, "mathlib.GetAngleFromVector result"));

		if (AngleOut === null) {
			return ConvertedAngle;
		}

		return AngleOut.CopyMathStructureFrom(ConvertedAngle);
	}

	GetVectorPerpendicularBasis(RightVectorOut = null, UpVectorOut = null) {
		if ((RightVectorOut !== null) && !(RightVectorOut instanceof Vector)) {
			throw new TypeError("Vector.GetVectorPerpendicularBasis RightVectorOut must be a Vector.");
		}

		if ((UpVectorOut !== null) && !(UpVectorOut instanceof Vector)) {
			throw new TypeError("Vector.GetVectorPerpendicularBasis UpVectorOut must be a Vector.");
		}

		const VectorResult = g_MathlibRuntime.GetPerpendicularVectorsFromVector(this);
		if ((VectorResult === null) || (typeof VectorResult !== "object")) {
			throw new TypeError("mathlib.GetPerpendicularVectorsFromVector result must be an object.");
		}

		const RightVector = Vector.CreateMathStructureFromValue(CreateVectorRecord(VectorResult.Right, "mathlib.GetPerpendicularVectorsFromVector Right result"));
		const UpVector = Vector.CreateMathStructureFromValue(CreateVectorRecord(VectorResult.Up, "mathlib.GetPerpendicularVectorsFromVector Up result"));

		if (RightVectorOut !== null) {
			RightVectorOut.CopyMathStructureFrom(RightVector);
		}

		if (UpVectorOut !== null) {
			UpVectorOut.CopyMathStructureFrom(UpVector);
		}

		return { Right: RightVector, Up: UpVector };
	}

	get Length2D() {
		return g_MathlibRuntime.GetVectorLength2D(this);
	}

	get Length2DSquared() {
		return g_MathlibRuntime.GetVectorLength2DSquared(this);
	}
}

Object.defineProperty(Vector, "TYPE_SIZE", { configurable: true, enumerable: true, value: g_unVectorSize, writable: true });

if (typeof g_MathlibRuntime.IsVectorWithinBox === "function") {
	Object.defineProperty(Vector.prototype, "IsVectorWithinBox", {
		configurable: true,
		enumerable: false,
		value(FirstCorner, SecondCorner) {
			return g_MathlibRuntime.IsVectorWithinBox(this, FirstCorner, SecondCorner);
		},
		writable: true,
	});
}

class QAngle extends VectorStructure {
	static CreateFromAddress(unAddress, unAddressOffset = 0) {
		return new QAngle(0, 0, 0, ResolveMemoryAddress(unAddress, unAddressOffset));
	}

	ConvertQAngleToVectors(ForwardVectorOut = null, RightVectorOut = null, UpVectorOut = null) {
		if ((ForwardVectorOut !== null) && !(ForwardVectorOut instanceof Vector)) {
			throw new TypeError("QAngle.ConvertQAngleToVectors ForwardVectorOut must be a Vector.");
		}

		if ((RightVectorOut !== null) && !(RightVectorOut instanceof Vector)) {
			throw new TypeError("QAngle.ConvertQAngleToVectors RightVectorOut must be a Vector.");
		}

		if ((UpVectorOut !== null) && !(UpVectorOut instanceof Vector)) {
			throw new TypeError("QAngle.ConvertQAngleToVectors UpVectorOut must be a Vector.");
		}

		const VectorResult = g_MathlibRuntime.GetDirectionVectorsFromAngle(this);
		if ((VectorResult === null) || (typeof VectorResult !== "object")) {
			throw new TypeError("mathlib.GetDirectionVectorsFromAngle result must be an object.");
		}

		const ForwardVector = Vector.CreateMathStructureFromValue(CreateVectorRecord(VectorResult.Forward, "mathlib.GetDirectionVectorsFromAngle Forward result"));
		const RightVector = Vector.CreateMathStructureFromValue(CreateVectorRecord(VectorResult.Right, "mathlib.GetDirectionVectorsFromAngle Right result"));
		const UpVector = Vector.CreateMathStructureFromValue(CreateVectorRecord(VectorResult.Up, "mathlib.GetDirectionVectorsFromAngle Up result"));

		if (ForwardVectorOut !== null) {
			ForwardVectorOut.CopyMathStructureFrom(ForwardVector);
		}

		if (RightVectorOut !== null) {
			RightVectorOut.CopyMathStructureFrom(RightVector);
		}

		if (UpVectorOut !== null) {
			UpVectorOut.CopyMathStructureFrom(UpVector);
		}

		return { Forward: ForwardVector, Right: RightVector, Up: UpVector };
	}
}

Object.defineProperty(QAngle, "TYPE_SIZE", { configurable: true, enumerable: true, value: g_unQAngleSize, writable: true });

class Quaternion extends FloatStructure {
	constructor(flX = 0, flY = 0, flZ = 0, flW = 0, unAddress = 0n) {
		super(["X", "Y", "Z", "W"], [flX, flY, flZ, flW], unAddress);
	}

	static CreateFromAddress(unAddress, unAddressOffset = 0) {
		return new Quaternion(0, 0, 0, 0, ResolveMemoryAddress(unAddress, unAddressOffset));
	}

	static CreateMathStructureFromValue(QuaternionLike) {
		if (QuaternionLike instanceof Quaternion) {
			return QuaternionLike;
		}

		if (QuaternionLike instanceof RadianEuler) {
			return Quaternion.CreateQuaternionFromRadianEuler(QuaternionLike);
		}

		return new Quaternion(...ResolveQuaternionComponents(QuaternionLike, "Quaternion"));
	}

	static CreateQuaternionFromRadianEuler(RadianEulerLike) {
		const RadianEulerValue = RadianEuler.CreateMathStructureFromValue(RadianEulerLike);
		const QuaternionResult = g_MathlibRuntime.ConvertRadianEulerToQuaternion(RadianEulerValue);

		return Quaternion.CreateMathStructureFromValue(CreateQuaternionRecord(QuaternionResult, "mathlib.ConvertRadianEulerToQuaternion result"));
	}
}

Object.defineProperty(Quaternion, "TYPE_SIZE", { configurable: true, enumerable: true, value: g_unQuaternionSize, writable: true });

class RadianEuler extends VectorStructure {
	constructor(Value = 0, flY = 0, flZ = 0, unAddress = 0n) {
		const unNormalizedAddress = ResolveMemoryAddress(unAddress);
		if (Value instanceof QAngle) {
			const RadianEulerResult = g_MathlibRuntime.ConvertQAngleToRadianEuler(Value);
			const vecRadianComponents = ResolveVectorComponents(CreateVectorRecord(RadianEulerResult, "mathlib.ConvertQAngleToRadianEuler result"), "mathlib.ConvertQAngleToRadianEuler result");
			super(...vecRadianComponents, unNormalizedAddress);
			return;
		}

		if (Value instanceof Quaternion) {
			const RadianEulerResult = g_MathlibRuntime.ConvertQuaternionToRadianEuler(Value);
			const vecRadianComponents = ResolveVectorComponents(CreateVectorRecord(RadianEulerResult, "mathlib.ConvertQuaternionToRadianEuler result"), "mathlib.ConvertQuaternionToRadianEuler result");
			super(...vecRadianComponents, unNormalizedAddress);
			return;
		}

		super(Value, flY, flZ, unNormalizedAddress);
	}

	static CreateFromAddress(unAddress, unAddressOffset = 0) {
		return new RadianEuler(0, 0, 0, ResolveMemoryAddress(unAddress, unAddressOffset));
	}

	static CreateMathStructureFromValue(RadianEulerLike) {
		if (RadianEulerLike instanceof RadianEuler) {
			return RadianEulerLike;
		}

		if ((RadianEulerLike instanceof QAngle) || (RadianEulerLike instanceof Quaternion)) {
			return new RadianEuler(RadianEulerLike);
		}

		return new RadianEuler(...ResolveVectorComponents(RadianEulerLike, "RadianEuler"));
	}

	static CreateRadianEulerFromQuaternion(QuaternionLike) {
		const QuaternionValue = Quaternion.CreateMathStructureFromValue(QuaternionLike);
		const RadianEulerResult = g_MathlibRuntime.ConvertQuaternionToRadianEuler(QuaternionValue);

		return RadianEuler.CreateMathStructureFromValue(CreateVectorRecord(RadianEulerResult, "mathlib.ConvertQuaternionToRadianEuler result"));
	}

	ConvertRadianEulerToQAngle() {
		return QAngle.CreateMathStructureFromValue(CreateQAngleRecord(g_MathlibRuntime.ConvertRadianEulerToQAngle(this), "mathlib.ConvertRadianEulerToQAngle result"));
	}
}

Object.defineProperty(RadianEuler, "TYPE_SIZE", { configurable: true, enumerable: true, value: g_unRadianEulerSize, writable: true });

class Plane {
	constructor(Normal = new Vector(), flDistance = 0, unType = 0, unSignBits = 0, unAddress = 0n) {
		const unNormalizedAddress = ResolveMemoryAddress(unAddress);
		const NormalizedNormal = Vector.CreateMathStructureFromValue(Normal).CopyMathStructure();
		const flNormalizedDistance = RequireFiniteNumber(flDistance, "Plane.Distance");
		const unNormalizedType = RequireByteValue(unType, "Plane.Type");
		const unNormalizedSignBits = RequireByteValue(unSignBits, "Plane.SignBits");

		this.#m_unAddress = unNormalizedAddress;
		this.#m_LocalNormal = NormalizedNormal;
		this.#m_flLocalDistance = flNormalizedDistance;
		this.#m_unLocalType = unNormalizedType;
		this.#m_unLocalSignBits = unNormalizedSignBits;
	}

	static CreateFromAddress(unAddress, unAddressOffset = 0) {
		return new Plane(new Vector(), 0, 0, 0, ResolveMemoryAddress(unAddress, unAddressOffset));
	}

	static CreateMathStructureFromValue(PlaneLike) {
		if (PlaneLike instanceof Plane) {
			return PlaneLike;
		}

		if ((PlaneLike === null) || (typeof PlaneLike !== "object")) {
			throw new TypeError("Plane.CreateMathStructureFromValue(PlaneLike) expects a Plane-like object.");
		}

		const Normal = PlaneLike.Normal;
		const flDistance = PlaneLike.Distance;
		const unType = PlaneLike.Type;
		const unSignBits = PlaneLike.SignBits;

		return new Plane(Normal, flDistance, unType, unSignBits);
	}

	GetMemoryAddress() {
		return ResolveMemoryAddress(this.#m_unAddress);
	}

	HasMemoryAddress() {
		return this.GetMemoryAddress() !== 0n;
	}

	CopyPlane() {
		const Normal = this.Normal.CopyMathStructure();
		const flDistance = this.Distance;
		const unType = this.Type;
		const unSignBits = this.SignBits;

		return new Plane(Normal, flDistance, unType, unSignBits);
	}

	CopyPlaneFrom(PlaneLike) {
		const SourcePlane = Plane.CreateMathStructureFromValue(PlaneLike);
		const SourceNormal = SourcePlane.Normal.CopyMathStructure();
		const flSourceDistance = RequireFiniteNumber(SourcePlane.Distance, "Plane source Distance");
		const unSourceType = RequireByteValue(SourcePlane.Type, "Plane source Type");
		const unSourceSignBits = RequireByteValue(SourcePlane.SignBits, "Plane source SignBits");

		this.Normal = SourceNormal;
		this.Distance = flSourceDistance;
		this.Type = unSourceType;
		this.SignBits = unSourceSignBits;

		return this;
	}

	CopyPlaneTo(TargetPlaneOut) {
		if (!(TargetPlaneOut instanceof Plane)) {
			throw new TypeError("Plane.CopyPlaneTo(TargetPlaneOut) expects a Plane.");
		}

		return TargetPlaneOut.CopyPlaneFrom(this);
	}

	IsPlaneValid() {
		const unMaximumByteValue = 0xFF;

		const Normal = this.Normal;
		if (!Normal.IsMathStructureValid()) {
			return false;
		}

		const flDistance = this.Distance;
		if (!Number.isFinite(flDistance)) {
			return false;
		}

		const unType = this.Type;
		if (!Number.isInteger(unType) || (unType < 0) || (unType > unMaximumByteValue)) {
			return false;
		}

		const unSignBits = this.SignBits;

		return Number.isInteger(unSignBits) && (unSignBits >= 0) && (unSignBits <= unMaximumByteValue);
	}

	InvalidatePlane() {
		const unAddress = this.GetMemoryAddress();
		if (unAddress !== 0n) {
			Vector.CreateFromAddress(unAddress, g_unPlaneNormalOffset).InvalidateMathStructure();
			Write(unAddress, "uint", g_unInvalidFloatBits, BigInt(g_unPlaneDistanceOffset));
			Write(unAddress, "uchar", 0, BigInt(g_unPlaneTypeOffset));
			Write(unAddress, "uchar", 0, BigInt(g_unPlaneSignBitsOffset));
		} else {
			const LocalNormal = this.#m_LocalNormal;
			LocalNormal.InvalidateMathStructure();
			this.#m_flLocalDistance = Number.NaN;
			this.#m_unLocalType = 0;
			this.#m_unLocalSignBits = 0;
		}

		return this;
	}

	IsPlaneEqual(PlaneLike) {
		const OtherPlane = Plane.CreateMathStructureFromValue(PlaneLike);
		const Normal = this.Normal;
		const OtherNormal = OtherPlane.Normal;
		if (!Normal.IsMathStructureEqual(OtherNormal)) {
			return false;
		}

		const flDistance = this.Distance;
		const flOtherDistance = OtherPlane.Distance;
		if (flDistance !== flOtherDistance) {
			return false;
		}

		const unType = this.Type;
		const unOtherType = OtherPlane.Type;
		if (unType !== unOtherType) {
			return false;
		}

		return this.SignBits === OtherPlane.SignBits;
	}

	get Address() {
		return this.GetMemoryAddress();
	}

	get Normal() {
		// Address-backed access creates a new non-owning Vector view, not a cached raw field value.
		const unAddress = this.GetMemoryAddress();

		return (unAddress !== 0n) ? Vector.CreateFromAddress(unAddress, g_unPlaneNormalOffset) : this.#m_LocalNormal;
	}

	set Normal(NormalLike) {
		const NormalVector = Vector.CreateMathStructureFromValue(NormalLike);
		const unAddress = this.GetMemoryAddress();
		if (unAddress !== 0n) {
			Vector.CreateFromAddress(unAddress, g_unPlaneNormalOffset).CopyMathStructureFrom(NormalVector);
		} else {
			const LocalNormal = this.#m_LocalNormal;
			LocalNormal.CopyMathStructureFrom(NormalVector);
		}
	}

	get Distance() {
		const unAddress = this.GetMemoryAddress();

		return (unAddress !== 0n) ? ReadFloat(unAddress, BigInt(g_unPlaneDistanceOffset)) : this.#m_flLocalDistance;
	}

	set Distance(flDistanceValue) {
		const flNormalizedDistance = RequireFiniteNumber(flDistanceValue, "Plane.Distance");
		const unAddress = this.GetMemoryAddress();
		if (unAddress !== 0n) {
			WriteFloat(unAddress, flNormalizedDistance, BigInt(g_unPlaneDistanceOffset));
		} else {
			this.#m_flLocalDistance = flNormalizedDistance;
		}
	}

	get Type() {
		const unAddress = this.GetMemoryAddress();

		return (unAddress !== 0n) ? Read(unAddress, "uchar", BigInt(g_unPlaneTypeOffset)) : this.#m_unLocalType;
	}

	set Type(unPlaneType) {
		const unNormalizedType = RequireByteValue(unPlaneType, "Plane.Type");
		const unAddress = this.GetMemoryAddress();
		if (unAddress !== 0n) {
			Write(unAddress, "uchar", unNormalizedType, BigInt(g_unPlaneTypeOffset));
		} else {
			this.#m_unLocalType = unNormalizedType;
		}
	}

	get SignBits() {
		const unAddress = this.GetMemoryAddress();

		return (unAddress !== 0n) ? Read(unAddress, "uchar", BigInt(g_unPlaneSignBitsOffset)) : this.#m_unLocalSignBits;
	}

	set SignBits(unSignBits) {
		const unNormalizedSignBits = RequireByteValue(unSignBits, "Plane.SignBits");
		const unAddress = this.GetMemoryAddress();
		if (unAddress !== 0n) {
			Write(unAddress, "uchar", unNormalizedSignBits, BigInt(g_unPlaneSignBitsOffset));
		} else {
			this.#m_unLocalSignBits = unNormalizedSignBits;
		}
	}

	#m_unAddress;
	#m_LocalNormal;
	#m_flLocalDistance;
	#m_unLocalType;
	#m_unLocalSignBits;
}

Object.defineProperty(Plane, "TYPE_SIZE", { configurable: true, enumerable: true, value: g_unPlaneSize, writable: true });

class MatrixRow {
	constructor(MatrixOwner, unRowIndex) {
		this.Matrix = MatrixOwner;
		this.RowIndex = unRowIndex;

		for (let unColumnIndex = 0; unColumnIndex < g_unMatrixColumnCount; unColumnIndex += 1) {
			Object.defineProperty(this, unColumnIndex, {
				configurable: false,
				enumerable: false,
				get() {
					return this.GetMatrixRowComponent(unColumnIndex);
				},
				set(flComponentValue) {
					this.SetMatrixRowComponent(unColumnIndex, flComponentValue);
				},
			});
		}
	}

	GetMatrixRowComponent(unColumnIndex) {
		return this.Matrix.GetMatrixComponent(this.RowIndex, unColumnIndex);
	}

	SetMatrixRowComponent(unColumnIndex, flComponentValue) {
		this.Matrix.SetMatrixComponent(this.RowIndex, unColumnIndex, flComponentValue);

		return this;
	}

	ConvertMatrixRowToArray() {
		const vecComponentValues = [];
		for (let unColumnIndex = 0; unColumnIndex < g_unMatrixColumnCount; unColumnIndex += 1) {
			vecComponentValues.push(this.GetMatrixRowComponent(unColumnIndex));
		}

		return vecComponentValues;
	}

	*[Symbol.iterator]() {
		for (let unColumnIndex = 0; unColumnIndex < g_unMatrixColumnCount; unColumnIndex += 1) {
			yield this.GetMatrixRowComponent(unColumnIndex);
		}
	}
}

const g_mapMatrixStates = new WeakMap();

function GetMatrixState(MatrixValue) {
	const State = g_mapMatrixStates.get(MatrixValue);
	if (State === undefined) {
		throw new TypeError("Matrix storage requires a MatrixBase instance.");
	}

	return State;
}

class MatrixBase {
	constructor(unRowCount, vecComponentValues, unAddress = 0n) {
		if (!Number.isSafeInteger(unRowCount) || (unRowCount <= 0)) {
			throw new TypeError("MatrixBase unRowCount must be a positive safe integer.");
		}

		if (!Array.isArray(vecComponentValues)) {
			throw new TypeError("MatrixBase vecComponentValues must be an array.");
		}

		if (unRowCount > (Number.MAX_SAFE_INTEGER / g_unMatrixColumnCount)) {
			throw new RangeError("MatrixBase unRowCount is too large for a safe component count.");
		}

		const unComponentCount = unRowCount * g_unMatrixColumnCount;
		if (vecComponentValues.length < unComponentCount) {
			throw new TypeError(`MatrixBase vecComponentValues must contain at least ${unComponentCount} values.`);
		}

		const unNormalizedAddress = ResolveMemoryAddress(unAddress);
		const vecNormalizedComponentValues = [];
		for (let unComponentIndex = 0; unComponentIndex < unComponentCount; unComponentIndex += 1) {
			vecNormalizedComponentValues.push(RequireFiniteNumber(vecComponentValues[unComponentIndex], `MatrixBase[${unComponentIndex}]`));
		}

		g_mapMatrixStates.set(this, { RowCount: unRowCount, Address: unNormalizedAddress, Values: vecNormalizedComponentValues });

		for (let unRowIndex = 0; unRowIndex < unRowCount; unRowIndex += 1) {
			Object.defineProperty(this, unRowIndex, {
				configurable: false,
				enumerable: false,
				get() {
					return this.GetMatrixRow(unRowIndex);
				},
			});
		}
	}

	GetMemoryAddress() {
		return ResolveMemoryAddress(GetMatrixState(this).Address);
	}

	HasMemoryAddress() {
		return this.GetMemoryAddress() !== 0n;
	}

	GetMatrixComponentOffset(unRowIndex, unColumnIndex) {
		const unRowCount = GetMatrixState(this).RowCount;
		const unNormalizedRowIndex = RequireComponentIndex(unRowIndex, unRowCount);
		const unNormalizedColumnIndex = RequireComponentIndex(unColumnIndex, g_unMatrixColumnCount);

		return unNormalizedRowIndex * g_unMatrixColumnCount + unNormalizedColumnIndex;
	}

	GetMatrixComponent(unRowIndex, unColumnIndex) {
		const unComponentOffset = this.GetMatrixComponentOffset(unRowIndex, unColumnIndex);
		const unAddress = this.GetMemoryAddress();
		if (unAddress !== 0n) {
			return ReadFloat(unAddress, BigInt(unComponentOffset * g_unFloatSize));
		}

		const vecComponentValues = GetMatrixState(this).Values;

		return vecComponentValues[unComponentOffset];
	}

	SetMatrixComponent(unRowIndex, unColumnIndex, flComponentValue) {
		const unComponentOffset = this.GetMatrixComponentOffset(unRowIndex, unColumnIndex);
		const flNormalizedComponentValue = RequireFiniteNumber(flComponentValue, `${this.constructor.name}[${unRowIndex}][${unColumnIndex}]`);
		const unAddress = this.GetMemoryAddress();
		if (unAddress !== 0n) {
			WriteFloat(unAddress, flNormalizedComponentValue, BigInt(unComponentOffset * g_unFloatSize));
		} else {
			const vecComponentValues = GetMatrixState(this).Values;
			vecComponentValues[unComponentOffset] = flNormalizedComponentValue;
		}

		return this;
	}

	GetMatrixRow(unRowIndex) {
		// This established query API allocates a new live row wrapper on every call.
		return new MatrixRow(this, RequireComponentIndex(unRowIndex, GetMatrixState(this).RowCount));
	}

	ConvertMatrixToArray() {
		const vecRows = [];
		for (let unRowIndex = 0; unRowIndex < GetMatrixState(this).RowCount; unRowIndex += 1) {
			vecRows.push(this.GetMatrixRow(unRowIndex).ConvertMatrixRowToArray());
		}

		return vecRows;
	}

	CopyMathStructureFrom(MatrixLike) {
		const SourceMatrix = this.constructor.CreateMathStructureFromValue(MatrixLike);
		const strMatrixName = this.constructor.name;
		const unRowCount = GetMatrixState(this).RowCount;
		const vecSourceComponentValues = [];
		for (let unRowIndex = 0; unRowIndex < unRowCount; unRowIndex += 1) {
			for (let unColumnIndex = 0; unColumnIndex < g_unMatrixColumnCount; unColumnIndex += 1) {
				const flSourceComponentValue = SourceMatrix.GetMatrixComponent(unRowIndex, unColumnIndex);
				const strSourceComponentName = `${strMatrixName} source[${unRowIndex}][${unColumnIndex}]`;
				const flNormalizedSourceComponentValue = RequireFiniteNumber(flSourceComponentValue, strSourceComponentName);
				vecSourceComponentValues.push(flNormalizedSourceComponentValue);
			}
		}

		let unComponentIndex = 0;
		for (let unRowIndex = 0; unRowIndex < unRowCount; unRowIndex += 1) {
			for (let unColumnIndex = 0; unColumnIndex < g_unMatrixColumnCount; unColumnIndex += 1) {
				this.SetMatrixComponent(unRowIndex, unColumnIndex, vecSourceComponentValues[unComponentIndex]);
				unComponentIndex += 1;
			}
		}

		return this;
	}

	CopyMathStructureTo(TargetMatrixOut) {
		const MatrixConstructor = this.constructor;
		if (!(TargetMatrixOut instanceof MatrixConstructor)) {
			throw new TypeError(`${MatrixConstructor.name}.CopyMathStructureTo(TargetMatrixOut) expects another ${MatrixConstructor.name}.`);
		}

		return TargetMatrixOut.CopyMathStructureFrom(this);
	}

	CopyMathStructure() {
		return new this.constructor(this.ConvertMatrixToArray());
	}

	IsMathStructureValid() {
		const unRowCount = GetMatrixState(this).RowCount;
		for (let unRowIndex = 0; unRowIndex < unRowCount; unRowIndex += 1) {
			for (let unColumnIndex = 0; unColumnIndex < g_unMatrixColumnCount; unColumnIndex += 1) {
				if (!Number.isFinite(this.GetMatrixComponent(unRowIndex, unColumnIndex))) {
					return false;
				}
			}
		}

		return true;
	}

	IsMatrixEqual(MatrixLike) {
		const OtherMatrix = this.constructor.CreateMathStructureFromValue(MatrixLike);
		const unRowCount = GetMatrixState(this).RowCount;
		for (let unRowIndex = 0; unRowIndex < unRowCount; unRowIndex += 1) {
			for (let unColumnIndex = 0; unColumnIndex < g_unMatrixColumnCount; unColumnIndex += 1) {
				if (this.GetMatrixComponent(unRowIndex, unColumnIndex) !== OtherMatrix.GetMatrixComponent(unRowIndex, unColumnIndex)) {
					return false;
				}
			}
		}

		return true;
	}

	*[Symbol.iterator]() {
		const unRowCount = GetMatrixState(this).RowCount;
		for (let unRowIndex = 0; unRowIndex < unRowCount; unRowIndex += 1) {
			yield this.GetMatrixRow(unRowIndex);
		}
	}

	get Address() {
		return this.GetMemoryAddress();
	}

	get RowCount() {
		return GetMatrixState(this).RowCount;
	}

	get Values() {
		return GetMatrixState(this).Values;
	}
}

class Matrix3x4 extends MatrixBase {
	constructor(...vecArgumentsList) {
		let vecComponentValues = new Array(g_unMatrix3X4ComponentCount).fill(0);
		let bHasAxisArguments = false;
		if (vecArgumentsList.length === g_unMatrixColumnCount) {
			bHasAxisArguments = true;
			for (let unArgumentIndex = 0; unArgumentIndex < g_unMatrixColumnCount; unArgumentIndex += 1) {
				const AxisArgument = vecArgumentsList[unArgumentIndex];
				if ((AxisArgument === null) || (typeof AxisArgument !== "object")) {
					bHasAxisArguments = false;
					break;
				}
			}
		}

		if (vecArgumentsList.length === 1) {
			vecComponentValues = ResolveMatrixComponents(vecArgumentsList[0], g_unMatrix3X4RowCount, "Matrix3x4");
		} else if (bHasAxisArguments) {
			const MatrixResult = g_MathlibRuntime.CreateMatrix3x4FromAxes(...vecArgumentsList);
			vecComponentValues = ResolveMatrixComponents(MatrixResult, g_unMatrix3X4RowCount, "mathlib.CreateMatrix3x4FromAxes result");
		} else if (vecArgumentsList.length !== 0) {
			vecComponentValues = ResolveMatrixComponents(vecArgumentsList, g_unMatrix3X4RowCount, "Matrix3x4");
		}

		super(g_unMatrix3X4RowCount, vecComponentValues);
	}

	static CreateFromAddress(unAddress, unAddressOffset = 0) {
		const unNormalizedAddress = ResolveMemoryAddress(unAddress, unAddressOffset);
		const MatrixView = new Matrix3x4();
		GetMatrixState(MatrixView).Address = unNormalizedAddress;

		return MatrixView;
	}

	static CreateMathStructureFromValue(MatrixLike) {
		if ((MatrixLike instanceof Matrix3x4) && !MatrixLike.HasMemoryAddress()) {
			return new Matrix3x4(MatrixLike.ConvertMatrixToArray());
		}

		return new Matrix3x4(ResolveMatrixComponents(MatrixLike, g_unMatrix3X4RowCount, "Matrix3x4"));
	}

	SetMatrix3x4Axes(XAxis, YAxis, ZAxis, Position) {
		return this.CopyMatrix3x4From(g_MathlibRuntime.CreateMatrix3x4FromAxes(XAxis, YAxis, ZAxis, Position));
	}

	GetMatrix3x4Row(unRowIndex) {
		// Preserve the public query name; each call allocates a new live row wrapper.
		return new MatrixRow(this, RequireComponentIndex(unRowIndex, g_unMatrix3X4RowCount));
	}

	CopyMatrix3x4From(MatrixLike) {
		return this.CopyMathStructureFrom(MatrixLike);
	}

	CopyMatrix3x4To(TargetMatrixOut) {
		if (!(TargetMatrixOut instanceof Matrix3x4)) {
			throw new TypeError("Matrix3x4.CopyMatrix3x4To(TargetMatrixOut) expects a Matrix3x4.");
		}

		return TargetMatrixOut.CopyMatrix3x4From(this);
	}

	get Position() {
		return Vector.CreateMathStructureFromValue(CreateVectorRecord(g_MathlibRuntime.GetMatrix3x4Position(this.ConvertMatrixToArray()), "mathlib.GetMatrix3x4Position result"));
	}

	get Angles() {
		return QAngle.CreateMathStructureFromValue(CreateQAngleRecord(g_MathlibRuntime.GetMatrix3x4Angles(this.ConvertMatrixToArray()), "mathlib.GetMatrix3x4Angles result"));
	}
}

Object.defineProperty(Matrix3x4, "TYPE_SIZE", { configurable: true, enumerable: true, value: g_unMatrix3X4Size, writable: true });

if (typeof g_MathlibRuntime.InvalidateMatrix3x4 === "function") {
	Object.defineProperty(Matrix3x4.prototype, "InvalidateMatrix3x4", {
		configurable: true,
		enumerable: false,
		value() {
			const vecMatrixResult = g_MathlibRuntime.InvalidateMatrix3x4(this.ConvertMatrixToArray());
			const unMatrixLength = GetArrayLikeLength(vecMatrixResult);
			if ((unMatrixLength === null) || (unMatrixLength < g_unMatrix3X4RowCount)) {
				throw new TypeError("mathlib.InvalidateMatrix3x4 returned an invalid matrix.");
			}

			const vecComponentValues = [];
			for (let unRowIndex = 0; unRowIndex < g_unMatrix3X4RowCount; unRowIndex += 1) {
				const vecMatrixRow = vecMatrixResult[unRowIndex];
				const unMatrixRowLength = GetArrayLikeLength(vecMatrixRow);
				if ((unMatrixRowLength === null) || (unMatrixRowLength < g_unMatrixColumnCount)) {
					throw new TypeError("mathlib.InvalidateMatrix3x4 returned an invalid matrix row.");
				}

				for (let unColumnIndex = 0; unColumnIndex < g_unMatrixColumnCount; unColumnIndex += 1) {
					const flComponentValue = vecMatrixRow[unColumnIndex];
					if (typeof flComponentValue !== "number") {
						throw new TypeError("mathlib.InvalidateMatrix3x4 returned a non-numeric component.");
					}

					vecComponentValues.push(flComponentValue);
				}
			}

			const unAddress = this.GetMemoryAddress();
			if (unAddress !== 0n) {
				// Preserve every SDK-returned Float32 value, including NaN, without finite-only float writes.
				const arrComponentBits = new Uint32Array(new Float32Array(vecComponentValues).buffer);
				for (let unComponentIndex = 0; unComponentIndex < g_unMatrix3X4ComponentCount; unComponentIndex += 1) {
					Write(unAddress, "uint", arrComponentBits[unComponentIndex], BigInt(unComponentIndex * g_unFloatSize));
				}
			} else {
				const vecLocalComponentValues = GetMatrixState(this).Values;
				for (let unComponentIndex = 0; unComponentIndex < g_unMatrix3X4ComponentCount; unComponentIndex += 1) {
					vecLocalComponentValues[unComponentIndex] = vecComponentValues[unComponentIndex];
				}
			}

			return this;
		},
		writable: true,
	});
}

class VMatrix extends MatrixBase {
	constructor(...vecArgumentsList) {
		let vecComponentValues = new Array(g_unVMatrixComponentCount).fill(0);
		if ((vecArgumentsList.length === 1) && (vecArgumentsList[0] instanceof Matrix3x4)) {
			const vecMatrixResult = g_MathlibRuntime.CreateVMatrixFromMatrix3x4(vecArgumentsList[0].ConvertMatrixToArray());
			vecComponentValues = ResolveMatrixComponents(vecMatrixResult, g_unVMatrixRowCount, "mathlib.CreateVMatrixFromMatrix3x4 result");
		} else if (vecArgumentsList.length === 1) {
			vecComponentValues = ResolveMatrixComponents(vecArgumentsList[0], g_unVMatrixRowCount, "VMatrix");
		} else if (vecArgumentsList.length !== 0) {
			vecComponentValues = ResolveMatrixComponents(vecArgumentsList, g_unVMatrixRowCount, "VMatrix");
		}

		super(g_unVMatrixRowCount, vecComponentValues);
	}

	static CreateFromAddress(unAddress, unAddressOffset = 0) {
		const unNormalizedAddress = ResolveMemoryAddress(unAddress, unAddressOffset);
		const MatrixView = new VMatrix();
		GetMatrixState(MatrixView).Address = unNormalizedAddress;

		return MatrixView;
	}

	static CreateMathStructureFromValue(MatrixLike) {
		if ((MatrixLike instanceof VMatrix) && !MatrixLike.HasMemoryAddress()) {
			return new VMatrix(MatrixLike.ConvertMatrixToArray());
		}

		return new VMatrix(MatrixLike);
	}

	SetVMatrixFromMatrix3x4(MatrixLike) {
		const Matrix3x4Value = Matrix3x4.CreateMathStructureFromValue(MatrixLike);
		const vecMatrixResult = g_MathlibRuntime.CreateVMatrixFromMatrix3x4(Matrix3x4Value.ConvertMatrixToArray());

		return this.CopyVMatrixFrom(vecMatrixResult);
	}

	GetVMatrixRow(unRowIndex) {
		// Preserve the public query name; each call allocates a new live row wrapper.
		return new MatrixRow(this, RequireComponentIndex(unRowIndex, g_unVMatrixRowCount));
	}

	CopyVMatrixFrom(MatrixLike) {
		return this.CopyMathStructureFrom(MatrixLike);
	}

	CopyVMatrixTo(TargetMatrixOut) {
		if (!(TargetMatrixOut instanceof VMatrix)) {
			throw new TypeError("VMatrix.CopyVMatrixTo(TargetMatrixOut) expects a VMatrix.");
		}

		return TargetMatrixOut.CopyVMatrixFrom(this);
	}

	ConvertVMatrixToMatrix3x4() {
		return Matrix3x4.CreateMathStructureFromValue(g_MathlibRuntime.CreateMatrix3x4FromVMatrix(this.ConvertMatrixToArray()));
	}

	get Position() {
		return Vector.CreateMathStructureFromValue(CreateVectorRecord(g_MathlibRuntime.GetVMatrixPosition(this.ConvertMatrixToArray()), "mathlib.GetVMatrixPosition result"));
	}

	get Angles() {
		return QAngle.CreateMathStructureFromValue(CreateQAngleRecord(g_MathlibRuntime.GetVMatrixAngles(this.ConvertMatrixToArray()), "mathlib.GetVMatrixAngles result"));
	}
}

Object.defineProperty(VMatrix, "TYPE_SIZE", { configurable: true, enumerable: true, value: g_unVMatrixSize, writable: true });

if (typeof g_MathlibRuntime.CreateIdentityVMatrix === "function") {
	Object.defineProperty(VMatrix.prototype, "SetIdentityVMatrix", {
		configurable: true,
		enumerable: false,
		value() {
			return this.CopyVMatrixFrom(g_MathlibRuntime.CreateIdentityVMatrix());
		},
		writable: true,
	});
}

for (const [strObjectTypeName, ObjectTypeConstructor] of [
	["Vector", Vector],
	["QAngle", QAngle],
	["Quaternion", Quaternion],
	["RadianEuler", RadianEuler],
	["Plane", Plane],
	["Matrix3x4", Matrix3x4],
	["VMatrix", VMatrix],
]) {
	const bRegistrationResult = RegisterObjectType(strObjectTypeName, ObjectTypeConstructor, { Size: ObjectTypeConstructor.TYPE_SIZE });
	if (!bRegistrationResult) {
		throw new Error(`Unable to register the ${strObjectTypeName} mathlib object type.`);
	}
}

const g_Mathlib = {
	FLOAT_SIZE: g_unFloatSize,
	MATRIX3X4_SIZE: g_unMatrix3X4Size,
	PLANE_SIZE: g_unPlaneSize,
	QANGLE_SIZE: g_unQAngleSize,
	QUATERNION_SIZE: g_unQuaternionSize,
	RADIAN_EULER_SIZE: g_unRadianEulerSize,
	VECTOR_SIZE: g_unVectorSize,
	VMATRIX_SIZE: g_unVMatrixSize,
	Matrix3x4,
	Plane,
	QAngle,
	Quaternion,
	RadianEuler,
	Vector,
	VMatrix,
	AddVector(FirstVector, SecondVector) {
		return CreateVectorRecord(g_MathlibRuntime.AddVectors(FirstVector, SecondVector), "mathlib.AddVectors result");
	},
	SubtractVector(FirstVector, SecondVector) {
		return CreateVectorRecord(g_MathlibRuntime.SubtractVectors(FirstVector, SecondVector), "mathlib.SubtractVectors result");
	},
	MultiplyVector(FirstVector, SecondVector) {
		return CreateVectorRecord(g_MathlibRuntime.MultiplyVectors(FirstVector, SecondVector), "mathlib.MultiplyVectors result");
	},
	DivideVector(FirstVector, SecondVector) {
		return CreateVectorRecord(g_MathlibRuntime.DivideVectors(FirstVector, SecondVector), "mathlib.DivideVectors result");
	},
	GetRandomVector(flMinimumComponent = 0, flMaximumComponent = 1) {
		return CreateVectorRecord(g_MathlibRuntime.CreateRandomVector(flMinimumComponent, flMaximumComponent), "mathlib.CreateRandomVector result");
	},
	NegateVector(VectorValue) {
		return CreateVectorRecord(g_MathlibRuntime.NegateVector(VectorValue), "mathlib.NegateVector result");
	},
	IsVectorZero(VectorValue, flTolerance = 0.01) {
		return g_MathlibRuntime.IsVectorZero(VectorValue, flTolerance);
	},
	IsVectorLengthGreaterThan(VectorValue, flComparisonLength) {
		return g_MathlibRuntime.IsVectorLengthGreaterThan(VectorValue, flComparisonLength);
	},
	IsVectorLengthLessThan(VectorValue, flComparisonLength) {
		return g_MathlibRuntime.IsVectorLengthLessThan(VectorValue, flComparisonLength);
	},
	GetVectorLength(VectorValue) {
		return g_MathlibRuntime.GetVectorLength(VectorValue);
	},
	GetVectorLengthSquared(VectorValue) {
		return g_MathlibRuntime.GetVectorLengthSquared(VectorValue);
	},
	GetVectorLength2D(VectorValue) {
		return g_MathlibRuntime.GetVectorLength2D(VectorValue);
	},
	GetVectorLength2DSquared(VectorValue) {
		return g_MathlibRuntime.GetVectorLength2DSquared(VectorValue);
	},
	NormalizeVector(VectorValue) {
		const NormalizedResult = g_MathlibRuntime.NormalizeVector(VectorValue);
		const NormalizedVector = CreateVectorRecord(NormalizedResult, "mathlib.NormalizeVector result");

		return { X: NormalizedVector.X, Y: NormalizedVector.Y, Z: NormalizedVector.Z, Length: RequireFiniteNumber(NormalizedResult.Length, "mathlib.NormalizeVector result.Length") };
	},
	CalculateVectorDotProduct(FirstVector, SecondVector) {
		return g_MathlibRuntime.ComputeVectorDotProduct(FirstVector, SecondVector);
	},
	CalculateVectorCrossProduct(FirstVector, SecondVector) {
		return CreateVectorRecord(g_MathlibRuntime.ComputeVectorCrossProduct(FirstVector, SecondVector), "mathlib.ComputeVectorCrossProduct result");
	},
	CalculateVectorDistance(FirstVector, SecondVector) {
		return g_MathlibRuntime.ComputeVectorDistance(FirstVector, SecondVector);
	},
	CalculateVectorDistanceSquared(FirstVector, SecondVector) {
		return g_MathlibRuntime.ComputeVectorDistanceSquared(FirstVector, SecondVector);
	},
	MultiplyAndAddVector(FirstVector, SecondVector, flScalar) {
		return CreateVectorRecord(g_MathlibRuntime.MultiplyAddVectors(FirstVector, SecondVector, flScalar), "mathlib.MultiplyAddVectors result");
	},
	GetMinimumVector(FirstVector, SecondVector) {
		return CreateVectorRecord(g_MathlibRuntime.GetVectorMinimum(FirstVector, SecondVector), "mathlib.GetVectorMinimum result");
	},
	GetMaximumVector(FirstVector, SecondVector) {
		return CreateVectorRecord(g_MathlibRuntime.GetVectorMaximum(FirstVector, SecondVector), "mathlib.GetVectorMaximum result");
	},
	ConvertQAngleToVectors(QAngleValue) {
		const VectorResult = g_MathlibRuntime.GetDirectionVectorsFromAngle(QAngleValue);

		return { Forward: CreateVectorRecord(VectorResult.Forward, "mathlib.GetDirectionVectorsFromAngle Forward result"), Right: CreateVectorRecord(VectorResult.Right, "mathlib.GetDirectionVectorsFromAngle Right result"), Up: CreateVectorRecord(VectorResult.Up, "mathlib.GetDirectionVectorsFromAngle Up result") };
	},
	ConvertVectorToQAngle(VectorValue, PseudoUpVector = null) {
		const AngleResult = (PseudoUpVector === null) ? g_MathlibRuntime.GetAngleFromVector(VectorValue) : g_MathlibRuntime.GetAngleFromVector(VectorValue, PseudoUpVector);

		return CreateQAngleRecord(AngleResult, "mathlib.GetAngleFromVector result");
	},
	GetVectorPerpendicularBasis(DirectionVector) {
		const VectorResult = g_MathlibRuntime.GetPerpendicularVectorsFromVector(DirectionVector);

		return { Right: CreateVectorRecord(VectorResult.Right, "mathlib.GetPerpendicularVectorsFromVector Right result"), Up: CreateVectorRecord(VectorResult.Up, "mathlib.GetPerpendicularVectorsFromVector Up result") };
	},
	ConvertRadianEulerToQuaternion(RadianEulerValue) {
		return CreateQuaternionRecord(g_MathlibRuntime.ConvertRadianEulerToQuaternion(RadianEulerValue), "mathlib.ConvertRadianEulerToQuaternion result");
	},
	ConvertQAngleToRadianEuler(QAngleValue) {
		return CreateVectorRecord(g_MathlibRuntime.ConvertQAngleToRadianEuler(QAngleValue), "mathlib.ConvertQAngleToRadianEuler result");
	},
	ConvertQuaternionToRadianEuler(QuaternionValue) {
		return CreateVectorRecord(g_MathlibRuntime.ConvertQuaternionToRadianEuler(QuaternionValue), "mathlib.ConvertQuaternionToRadianEuler result");
	},
	ConvertRadianEulerToQAngle(RadianEulerValue) {
		return CreateQAngleRecord(g_MathlibRuntime.ConvertRadianEulerToQAngle(RadianEulerValue), "mathlib.ConvertRadianEulerToQAngle result");
	},
	CreateMatrix3x4FromAxes(XAxis, YAxis, ZAxis, Position) {
		return g_MathlibRuntime.CreateMatrix3x4FromAxes(XAxis, YAxis, ZAxis, Position);
	},
	GetMatrix3x4Position(Matrix3x4Value) {
		return CreateVectorRecord(g_MathlibRuntime.GetMatrix3x4Position(Matrix3x4Value), "mathlib.GetMatrix3x4Position result");
	},
	GetMatrix3x4Angles(Matrix3x4Value) {
		return CreateQAngleRecord(g_MathlibRuntime.GetMatrix3x4Angles(Matrix3x4Value), "mathlib.GetMatrix3x4Angles result");
	},
	ConvertMatrix3x4ToVMatrix(Matrix3x4Value) {
		return g_MathlibRuntime.CreateVMatrixFromMatrix3x4(Matrix3x4Value);
	},
	ConvertVMatrixToMatrix3x4(VMatrixValue) {
		return g_MathlibRuntime.CreateMatrix3x4FromVMatrix(VMatrixValue);
	},
	GetVMatrixPosition(VMatrixValue) {
		return CreateVectorRecord(g_MathlibRuntime.GetVMatrixPosition(VMatrixValue), "mathlib.GetVMatrixPosition result");
	},
	GetVMatrixAngles(VMatrixValue) {
		return CreateQAngleRecord(g_MathlibRuntime.GetVMatrixAngles(VMatrixValue), "mathlib.GetVMatrixAngles result");
	},
};

if (typeof g_MathlibRuntime.IsVectorWithinBox === "function") {
	g_Mathlib.IsVectorWithinBox = function IsVectorWithinBox(VectorValue, MinimumCorner, MaximumCorner) {
		return g_MathlibRuntime.IsVectorWithinBox(VectorValue, MinimumCorner, MaximumCorner);
	};
}

if (typeof g_MathlibRuntime.InvalidateMatrix3x4 === "function") {
	g_Mathlib.InvalidateMatrix3x4 = function InvalidateMatrix3x4(Matrix3x4Value) {
		return g_MathlibRuntime.InvalidateMatrix3x4(Matrix3x4Value);
	};
}

if (typeof g_MathlibRuntime.CreateIdentityVMatrix === "function") {
	g_Mathlib.CreateIdentityVMatrix = function CreateIdentityVMatrix() {
		return g_MathlibRuntime.CreateIdentityVMatrix();
	};
}

module.exports = Object.freeze(g_Mathlib);
