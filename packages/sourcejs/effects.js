"use strict";

const { GetModule } = require("internal/runtime");
const { CreateTemporaryEntity, TemporaryEntity } = require("effects/index");
const {
	RegisterTemporaryEntityPostCreateHook,
	RegisterTemporaryEntityPreCreateHook,
	TemporaryEntityPostCreateHook,
	TemporaryEntityPreCreateHook,
} = require("effects/hooks");
const {
	GetTemporaryEntityTemplate,
	GetTemporaryEntityTemplates,
	TEMP_ENTITY_TEMPLATES,
	TemporaryEntityTemplate,
	TemporaryEntityTemplateCollection,
} = require("effects/templates");
const { Entity } = require("entities/entity");
const { Vector } = require("mathlib");

const g_unEffectVectorCoordinateCount = 3;
const g_unMinimumPolygonPointCount = 3;
const g_unDefaultBallRingCount = 15;
const g_flBallEndRadiusOffset = 0.1;

const g_EffectsRuntime = GetModule("effects");

function GetTemporaryEntity(strTemporaryEntityName) {
	return g_EffectsRuntime.GetTempEntity(strTemporaryEntityName);
}

function GetNativeTemporaryEntityProperty(strTemporaryEntityName, strPropertyName) {
	return g_EffectsRuntime.GetProperty(strTemporaryEntityName, strPropertyName);
}

function PrecacheModel(strModelName, bPreload = false) {
	return g_EffectsRuntime.PrecacheModel(strModelName, bPreload);
}

function PrecacheGeneric(strFileName, bPreload = false) {
	return g_EffectsRuntime.PrecacheGeneric(strFileName, bPreload);
}

function PrecacheDecal(strDecalName, bPreload = false) {
	return g_EffectsRuntime.PrecacheDecal(strDecalName, bPreload);
}

function GetEntityOrigin(unEntityIndex) {
	return Entity(unEntityIndex).Origin;
}

function ResolveEffectVector(VectorInput) {
	let ResolvedVectorInput = VectorInput;
	if (Array.isArray(VectorInput)) {
		if (VectorInput.length < g_unEffectVectorCoordinateCount) {
			throw new TypeError("Effect vectors supplied as arrays require three coordinates.");
		}

		ResolvedVectorInput = { X: VectorInput[0], Y: VectorInput[1], Z: VectorInput[2] };
	}

	if (typeof ResolvedVectorInput === "number") {
		return GetEntityOrigin(ResolvedVectorInput);
	}

	if (ResolvedVectorInput && (typeof ResolvedVectorInput === "object") && ("Origin" in ResolvedVectorInput)) {
		const OriginVectorInput = ResolvedVectorInput.Origin;
		return ResolveEffectVector(OriginVectorInput);
	}

	if (!ResolvedVectorInput || (typeof ResolvedVectorInput !== "object")) {
		throw new TypeError("Effect vectors require an entity index, entity, vector object, or three-coordinate array.");
	}

	return Vector.CreateMathStructureFromValue(ResolvedVectorInput);
}

function ResolveEffectEntityIndex(EntityReference) {
	const unResolvedEntityIndex = (typeof EntityReference === "number") ? EntityReference : EntityReference?.Index;
	if (!Number.isSafeInteger(unResolvedEntityIndex) || (unResolvedEntityIndex < 0)) {
		throw new TypeError("Effect entity references require a non-negative integer index.");
	}

	return unResolvedEntityIndex;
}

function ExtractTemporaryEntityValues(EffectOptions = {}) {
	const TemporaryEntityValues = {};
	for (const strOptionName of Object.keys(EffectOptions)) {
		if ((strOptionName === "TempEntity") || (strOptionName === "EntityName") || (strOptionName === "Recipients") || (strOptionName === "Delay") || (strOptionName === "Reliable")) {
			continue;
		}

		Object.defineProperty(TemporaryEntityValues, strOptionName, { configurable: true, enumerable: true, value: EffectOptions[strOptionName], writable: true });
	}

	return TemporaryEntityValues;
}

function CreateBeamEffect(Recipients, BeamStart, BeamEnd, bParentToEntities = false, EffectOptions = {}) {
	if (typeof bParentToEntities !== "boolean") {
		throw new TypeError("Effect beam parent mode must be a boolean.");
	}

	if (!EffectOptions || (typeof EffectOptions !== "object") || Array.isArray(EffectOptions)) {
		throw new TypeError("Effect beam options must be an object.");
	}

	let TemporaryEntityInstance = EffectOptions.TempEntity;
	const flEffectDelay = EffectOptions.Delay ?? 0;
	const bReliableDelivery = EffectOptions.Reliable ?? false;

	if ((TemporaryEntityInstance === undefined) || (TemporaryEntityInstance === null)) {
		const strTemporaryEntityName = EffectOptions.EntityName ?? "BeamEntPoint";
		const TemporaryEntityValues = ExtractTemporaryEntityValues(EffectOptions);
		TemporaryEntityInstance = new TemporaryEntity(strTemporaryEntityName, TemporaryEntityValues);
	}

	if (bParentToEntities) {
		const bStartIsEntityReference = (typeof BeamStart === "number") || ((BeamStart !== null) && (typeof BeamStart === "object") && ("Index" in BeamStart));
		if (bStartIsEntityReference) {
			TemporaryEntityInstance.SetTemporaryEntityProperty("StartEntityIndex", ResolveEffectEntityIndex(BeamStart));
		} else {
			TemporaryEntityInstance.SetTemporaryEntityProperty("StartPoint", ResolveEffectVector(BeamStart));
		}

		const bEndIsEntityReference = (typeof BeamEnd === "number") || ((BeamEnd !== null) && (typeof BeamEnd === "object") && ("Index" in BeamEnd));
		if (bEndIsEntityReference) {
			TemporaryEntityInstance.SetTemporaryEntityProperty("EndEntityIndex", ResolveEffectEntityIndex(BeamEnd));
		} else {
			TemporaryEntityInstance.SetTemporaryEntityProperty("EndPoint", ResolveEffectVector(BeamEnd));
		}
	} else {
		TemporaryEntityInstance.SetTemporaryEntityProperty("StartPoint", ResolveEffectVector(BeamStart));
		TemporaryEntityInstance.SetTemporaryEntityProperty("EndPoint", ResolveEffectVector(BeamEnd));
	}

	return TemporaryEntityInstance.CreateTemporaryEntity(Recipients, flEffectDelay, undefined, bReliableDelivery);
}

function CreatePolygonEffect(Recipients, vecPolygonPoints, bParentToEntities = false, EffectOptions = {}) {
	if (!Array.isArray(vecPolygonPoints) || (vecPolygonPoints.length < g_unMinimumPolygonPointCount)) {
		throw new TypeError("CreatePolygonEffect() requires at least three points.");
	}

	if (typeof bParentToEntities !== "boolean") {
		throw new TypeError("Effect polygon parent mode must be a boolean.");
	}

	if (!EffectOptions || (typeof EffectOptions !== "object") || Array.isArray(EffectOptions)) {
		throw new TypeError("Effect polygon options must be an object.");
	}

	const unPointCount = vecPolygonPoints.length;
	const strTemporaryEntityName = EffectOptions.EntityName ?? "BeamEntPoint";
	const TemporaryEntityValues = ExtractTemporaryEntityValues(EffectOptions);
	const flEffectDelay = EffectOptions.Delay ?? 0;
	const bReliableDelivery = EffectOptions.Reliable ?? false;
	const TemporaryEntityInstance = new TemporaryEntity(strTemporaryEntityName, TemporaryEntityValues);
	const BeamOptions = { TempEntity: TemporaryEntityInstance, Delay: flEffectDelay, Reliable: bReliableDelivery };
	for (let unPointIndex = 0; unPointIndex < unPointCount; ++unPointIndex) {
		const unNextPointIndex = (unPointIndex + 1) % unPointCount;
		const StartPoint = vecPolygonPoints[unPointIndex];
		const EndPoint = vecPolygonPoints[unNextPointIndex];
		CreateBeamEffect(Recipients, StartPoint, EndPoint, bParentToEntities, BeamOptions);
	}
}

function CreateSquareEffect(Recipients, SquareStart, SquareEnd, EffectOptions = {}) {
	if (!EffectOptions || (typeof EffectOptions !== "object") || Array.isArray(EffectOptions)) {
		throw new TypeError("Effect square options must be an object.");
	}

	const StartPoint = ResolveEffectVector(SquareStart);
	const EndPoint = ResolveEffectVector(SquareEnd);
	const UpperRightPoint = new Vector(EndPoint.X, EndPoint.Y, StartPoint.Z);
	const LowerLeftPoint = new Vector(StartPoint.X, StartPoint.Y, EndPoint.Z);
	const vecSquareEdges = [
		[StartPoint, UpperRightPoint],
		[UpperRightPoint, EndPoint],
		[EndPoint, LowerLeftPoint],
		[LowerLeftPoint, StartPoint],
	];
	const strTemporaryEntityName = EffectOptions.EntityName ?? "BeamPoints";
	const TemporaryEntityValues = ExtractTemporaryEntityValues(EffectOptions);
	const flEffectDelay = EffectOptions.Delay ?? 0;
	const bReliableDelivery = EffectOptions.Reliable ?? false;
	const TemporaryEntityInstance = new TemporaryEntity(strTemporaryEntityName, TemporaryEntityValues);
	for (const [EdgeStart, EdgeEnd] of vecSquareEdges) {
		TemporaryEntityInstance.SetTemporaryEntityProperty("StartPoint", EdgeStart);
		TemporaryEntityInstance.SetTemporaryEntityProperty("EndPoint", EdgeEnd);
		TemporaryEntityInstance.CreateTemporaryEntity(Recipients, flEffectDelay, undefined, bReliableDelivery);
	}
}

function CreateBoxEffect(Recipients, MinimumPoint, MaximumPoint, EffectOptions = {}) {
	if (!EffectOptions || (typeof EffectOptions !== "object") || Array.isArray(EffectOptions)) {
		throw new TypeError("Effect box options must be an object.");
	}

	const ResolvedMinimumPoint = ResolveEffectVector(MinimumPoint);
	const ResolvedMaximumPoint = ResolveEffectVector(MaximumPoint);
	const BottomRightFront = new Vector(ResolvedMaximumPoint.X, ResolvedMinimumPoint.Y, ResolvedMinimumPoint.Z);
	const BottomRightBack = new Vector(ResolvedMaximumPoint.X, ResolvedMinimumPoint.Y, ResolvedMaximumPoint.Z);
	const BottomLeftBack = new Vector(ResolvedMinimumPoint.X, ResolvedMinimumPoint.Y, ResolvedMaximumPoint.Z);
	const TopLeftFront = new Vector(ResolvedMinimumPoint.X, ResolvedMaximumPoint.Y, ResolvedMinimumPoint.Z);
	const TopRightFront = new Vector(ResolvedMaximumPoint.X, ResolvedMaximumPoint.Y, ResolvedMinimumPoint.Z);
	const TopLeftBack = new Vector(ResolvedMinimumPoint.X, ResolvedMaximumPoint.Y, ResolvedMaximumPoint.Z);
	const vecBoxEdges = [
		[ResolvedMinimumPoint, BottomRightFront],
		[BottomRightFront, BottomRightBack],
		[BottomRightBack, BottomLeftBack],
		[BottomLeftBack, ResolvedMinimumPoint],
		[TopLeftFront, TopRightFront],
		[TopRightFront, ResolvedMaximumPoint],
		[ResolvedMaximumPoint, TopLeftBack],
		[TopLeftBack, TopLeftFront],
		[ResolvedMinimumPoint, TopLeftFront],
		[BottomRightFront, TopRightFront],
		[BottomRightBack, ResolvedMaximumPoint],
		[BottomLeftBack, TopLeftBack],
	];
	const strTemporaryEntityName = EffectOptions.EntityName ?? "BeamPoints";
	const TemporaryEntityValues = ExtractTemporaryEntityValues(EffectOptions);
	const flEffectDelay = EffectOptions.Delay ?? 0;
	const bReliableDelivery = EffectOptions.Reliable ?? false;
	const TemporaryEntityInstance = new TemporaryEntity(strTemporaryEntityName, TemporaryEntityValues);
	for (const [EdgeStart, EdgeEnd] of vecBoxEdges) {
		TemporaryEntityInstance.SetTemporaryEntityProperty("StartPoint", EdgeStart);
		TemporaryEntityInstance.SetTemporaryEntityProperty("EndPoint", EdgeEnd);
		TemporaryEntityInstance.CreateTemporaryEntity(Recipients, flEffectDelay, undefined, bReliableDelivery);
	}
}

function CreateBallEffect(Recipients, BallCenter, flBallRadius, unRingCount = g_unDefaultBallRingCount, bUpperHalf = true, bLowerHalf = true, EffectOptions = {}) {
	if ((typeof flBallRadius !== "number") || !Number.isFinite(flBallRadius) || (flBallRadius <= 0)) {
		throw new RangeError("CreateBallEffect() radius must be a positive finite number.");
	}

	if (!Number.isSafeInteger(unRingCount) || (unRingCount <= 0)) {
		throw new RangeError("CreateBallEffect() ring count must be a positive safe integer.");
	}

	if (typeof bUpperHalf !== "boolean") {
		throw new TypeError("Effect ball upper-half flag must be a boolean.");
	}

	if (typeof bLowerHalf !== "boolean") {
		throw new TypeError("Effect ball lower-half flag must be a boolean.");
	}

	if (!bUpperHalf && !bLowerHalf) {
		throw new RangeError("CreateBallEffect() requires at least one half.");
	}

	if (!EffectOptions || (typeof EffectOptions !== "object") || Array.isArray(EffectOptions)) {
		throw new TypeError("Effect ball options must be an object.");
	}

	const ResolvedCenter = ResolveEffectVector(BallCenter);
	const strTemporaryEntityName = EffectOptions.EntityName ?? "BeamRingPoint";
	const TemporaryEntityValues = ExtractTemporaryEntityValues(EffectOptions);
	const flEffectDelay = EffectOptions.Delay ?? 0;
	const bReliableDelivery = EffectOptions.Reliable ?? false;
	const TemporaryEntityInstance = new TemporaryEntity(strTemporaryEntityName, TemporaryEntityValues);
	const flRingHeightStep = flBallRadius / unRingCount;
	for (let unRingIndex = 0; unRingIndex < unRingCount; ++unRingIndex) {
		const flVerticalOffset = flRingHeightStep * unRingIndex;
		const flRingRadius = 2 * flBallRadius * Math.sqrt(1 - (unRingIndex / unRingCount) ** 2);
		const flEndRadius = flRingRadius - g_flBallEndRadiusOffset;

		if (bUpperHalf) {
			TemporaryEntityInstance.SetTemporaryEntityProperty("Center", new Vector(ResolvedCenter.X, ResolvedCenter.Y, ResolvedCenter.Z + flVerticalOffset));
			TemporaryEntityInstance.SetTemporaryEntityProperty("StartRadius", flRingRadius);
			TemporaryEntityInstance.SetTemporaryEntityProperty("EndRadius", flEndRadius);
			TemporaryEntityInstance.CreateTemporaryEntity(Recipients, flEffectDelay, undefined, bReliableDelivery);
		}

		if (bLowerHalf && ((unRingIndex > 0) || !bUpperHalf)) {
			TemporaryEntityInstance.SetTemporaryEntityProperty("Center", new Vector(ResolvedCenter.X, ResolvedCenter.Y, ResolvedCenter.Z - flVerticalOffset));
			TemporaryEntityInstance.SetTemporaryEntityProperty("StartRadius", flRingRadius);
			TemporaryEntityInstance.SetTemporaryEntityProperty("EndRadius", flEndRadius);
			TemporaryEntityInstance.CreateTemporaryEntity(Recipients, flEffectDelay, undefined, bReliableDelivery);
		}
	}
}

const g_EffectsAPI = {
	BloodColor: g_EffectsRuntime.BloodColor,
	ShatterSurface: g_EffectsRuntime.ShatterSurface,
	TEMP_ENTITY_TEMPLATES,
	TemporaryEntity,
	TemporaryEntityPostCreateHook,
	TemporaryEntityPreCreateHook,
	TemporaryEntityTemplate,
	TemporaryEntityTemplateCollection,
	CreateBallEffect,
	CreateBeamEffect,
	CreateBoxEffect,
	CreatePolygonEffect,
	CreateSquareEffect,
	CreateTemporaryEntity,
	GetNativeTemporaryEntityProperty,
	GetTemporaryEntity,
	GetTemporaryEntityTemplate,
	GetTemporaryEntityTemplates,
	PrecacheDecal,
	PrecacheGeneric,
	PrecacheModel,
	RegisterTemporaryEntityPostCreateHook,
	RegisterTemporaryEntityPreCreateHook,
};

module.exports = g_EffectsAPI;
