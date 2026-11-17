"use strict";

const { MoveType } = require("entities/constants");
const {
	FindEntityDataMapField,
	GetEntityDataMap,
	GetEntityDataMapPropertyFloat,
	GetEntityDataMapPropertyInteger,
	GetEntityDataMapPropertyUnsignedCharacter,
	SetEntityDataMapPropertyFloat,
	SetEntityDataMapPropertyInteger,
	SetEntityDataMapPropertyUnsignedCharacter,
} = require("entities/datamaps");

function FindMovementField(Player, strFieldName) {
	const DataMap = GetEntityDataMap?.(Player);
	const Field = DataMap ? FindEntityDataMapField?.(DataMap, strFieldName) : null;
	if (!Field || (Field.ElementCount !== 1) || !Number.isInteger(Field.Offset) || (Field.Offset < 0)) {
		return null;
	}

	return Field;
}

function GetMovementType(Player) {
	if (!MoveType) {
		return null;
	}

	const Field = FindMovementField(Player, "m_MoveType");
	if (!Field) {
		return null;
	}

	if (((Field.Type === "char") || (Field.Type === "uchar")) && (Field.SizeInBytes === 1)) {
		return GetEntityDataMapPropertyUnsignedCharacter(Player, Field.Path);
	}

	if ((Field.Type === "int") && (Field.SizeInBytes === 4)) {
		return GetEntityDataMapPropertyInteger(Player, Field.Path);
	}

	return null;
}

function SetMovementType(Player, unMoveType) {
	if (!Number.isInteger(unMoveType) || (unMoveType < 0) || !Object.values(MoveType ?? {}).includes(unMoveType)) {
		return false;
	}

	const Field = FindMovementField(Player, "m_MoveType");
	if (!Field) {
		return false;
	}

	if (((Field.Type === "char") || (Field.Type === "uchar")) && (Field.SizeInBytes === 1)) {
		return SetEntityDataMapPropertyUnsignedCharacter(Player, Field.Path, unMoveType);
	}

	if ((Field.Type === "int") && (Field.SizeInBytes === 4)) {
		return SetEntityDataMapPropertyInteger(Player, Field.Path, unMoveType);
	}

	return false;
}

function FindGravityField(Player) {
	const unGravityFieldByteCount = 4;
	const Field = FindMovementField(Player, "m_flGravity");

	return ((Field?.Type === "float") && (Field.SizeInBytes === unGravityFieldByteCount)) ? Field : null;
}

function GetPlayerGravity(Player) {
	const Field = FindGravityField(Player);

	return Field ? GetEntityDataMapPropertyFloat(Player, Field.Path) : null;
}

function SetPlayerGravity(Player, flMultiplier) {
	const Field = FindGravityField(Player);

	return (Field !== null) && SetEntityDataMapPropertyFloat(Player, Field.Path, flMultiplier);
}

module.exports = { GetMovementType, SetMovementType, GetPlayerGravity, SetPlayerGravity };
