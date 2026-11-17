"use strict";

const { GetModule } = require("internal/runtime");

const g_EntityProperties = GetModule("entities/props");
const g_mapProxyHooks = new Map();
const g_unMaximumEntityIndex = 0x7FFFFFFF;
const g_nFloatByteCount = 4n;

function GetProxyValueLayout(Property) {
	const { ReadFloat, ReadInt, ReadUInt, WriteFloat, WriteInt, WriteUInt } = require("memory/helpers");

	switch (Property.Type) {
		case "int": {
			const unBitCount = Property.BitCount;
			if (!Number.isInteger(unBitCount) || (unBitCount < 1) || (unBitCount > 32)) {
				throw new RangeError("The SendProp does not expose a supported integer bit width.");
			}

			const bSigned = Property.Signed;
			const unExclusiveMaximum = 2 ** (bSigned ? (unBitCount - 1) : unBitCount);

			return {
				Read: bSigned ? ReadInt : ReadUInt,
				Write: bSigned ? WriteInt : WriteUInt,
				Minimum: bSigned ? -unExclusiveMaximum : 0,
				Maximum: unExclusiveMaximum - 1,
			};
		}

		case "float":
			return { ComponentCount: 1, ReadComponent: ReadFloat, WriteComponent: WriteFloat };

		case "vectorxy":
			return { ComponentCount: 2, ReadComponent: ReadFloat, WriteComponent: WriteFloat };

		case "vector":
			return { ComponentCount: 3, ReadComponent: ReadFloat, WriteComponent: WriteFloat };

		default:
			throw new TypeError("SendProp hooks support integer, float and vector values.");
	}
}

function ReadProxyValue(Layout, unOutputAddress) {
	if (Layout.Read) {
		return Layout.Read(unOutputAddress);
	}

	if (Layout.ComponentCount === 1) {
		return Layout.ReadComponent(unOutputAddress);
	}

	const vecComponents = [];
	for (let unIndex = 0; unIndex < Layout.ComponentCount; ++unIndex) {
		vecComponents.push(Layout.ReadComponent(unOutputAddress, BigInt(unIndex) * g_nFloatByteCount));
	}

	return vecComponents;
}

function WriteProxyValue(Layout, unOutputAddress, Value) {
	if (Layout.Write) {
		if (!Number.isInteger(Value) || (Value < Layout.Minimum) || (Value > Layout.Maximum)) {
			throw new RangeError("The replacement does not fit the SendProp integer encoding.");
		}

		Layout.Write(unOutputAddress, Value);
		return;
	}

	const vecValues = (Layout.ComponentCount === 1) ? [Value] : Value;
	if (!Array.isArray(vecValues) || (vecValues.length !== Layout.ComponentCount)) {
		throw new TypeError("The replacement must match the SendProp component count.");
	}

	const vecComponents = [];
	for (let unIndex = 0; unIndex < Layout.ComponentCount; ++unIndex) {
		const flComponent = vecValues[unIndex];
		if (!Number.isFinite(flComponent) || !Number.isFinite(Math.fround(flComponent))) {
			throw new TypeError("Each SendProp component must be a finite float.");
		}

		vecComponents.push(flComponent);
	}

	for (let unIndex = 0; unIndex < vecComponents.length; ++unIndex) {
		Layout.WriteComponent(unOutputAddress, vecComponents[unIndex], BigInt(unIndex) * g_nFloatByteCount);
	}
}

function AddSendPropertyHook(nEntityIndex, strPropertyName, Callback) {
	if (!Number.isInteger(nEntityIndex) || (nEntityIndex < 1) || (nEntityIndex > g_unMaximumEntityIndex) || (typeof strPropertyName !== "string") || (strPropertyName.length === 0) || (typeof Callback !== "function")) {
		throw new TypeError("AddSendPropertyHook(nEntityIndex, strPropertyName, Callback) requires a positive entity index, a property name and a callback.");
	}

	const Property = g_EntityProperties.GetEntitySendProperty(nEntityIndex, strPropertyName);
	if (!Property || (typeof Property.Address !== "bigint") || (Property.Address <= 0n) || (typeof Property.ProxyFunctionAddress !== "bigint") || (Property.ProxyFunctionAddress <= 0n)) {
		return null;
	}

	const Layout = GetProxyValueLayout(Property);
	const unPropertyAddress = Property.Address;
	const unProxyAddress = Property.ProxyFunctionAddress;
	let Hook = g_mapProxyHooks.get(unProxyAddress);
	if (!Hook) {
		Hook = g_EntityProperties.CreateSendPropertyProxyHook({
			Address: unProxyAddress,
			Convention: "cdecl",
			ReturnType: "void",
			Arguments: ["address", "address", "address", "address", "int", "int"],
		});
		if (!Hook || !Hook.Created) {
			return null;
		}

		g_mapProxyHooks.set(unProxyAddress, Hook);
	}

	const ModifyProxyResult = (Payload) => {
		// The ABI is (prop, struct base, input, DVariant output, element, object ID).
		const vecArguments = Payload.Arguments;
		const unOutputAddress = vecArguments[3];
		if ((vecArguments[0] !== unPropertyAddress) || (vecArguments[5] !== nEntityIndex) || (typeof unOutputAddress !== "bigint") || (unOutputAddress <= 0n)) {
			return;
		}

		const Value = Callback({
			EntityIndex: nEntityIndex,
			ElementIndex: vecArguments[4],
			PropertyName: strPropertyName,
			Value: ReadProxyValue(Layout, unOutputAddress),
		});
		if ((Value !== undefined) && (Value !== null)) {
			WriteProxyValue(Layout, unOutputAddress, Value);
		}
	};
	if (!Hook.Post(ModifyProxyResult)) {
		return null;
	}

	let bRegistered = true;

	return {
		Remove() {
			if (!bRegistered) {
				return true;
			}

			if (!Hook.RemovePost(ModifyProxyResult)) {
				return false;
			}

			bRegistered = false;

			return true;
		},
	};
}

g_EntityProperties.AddSendPropertyHook = AddSendPropertyHook;

module.exports = g_EntityProperties;
