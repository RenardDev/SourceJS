"use strict";

const { GetModule } = require("internal/runtime");
const { DataType, RegisterObjectType } = require("memory");
const { Add, IsNull, Read, Write } = require("memory/helpers");

const g_SteamRuntime = GetModule("steam");
const g_unSteamIDSize = g_SteamRuntime.STEAM_ID_SIZE;
const g_strSteamBranch = g_SteamRuntime.STEAM_BRANCH;
const g_SteamUniverse = g_SteamRuntime.Universe;
const g_SteamAccountType = g_SteamRuntime.AccountType;
const g_bHasSteamID = Number.isSafeInteger(g_unSteamIDSize) && (g_unSteamIDSize > 0);

function IsValidAddress(unAddress) {
	return (typeof unAddress === "bigint") && (unAddress > 0n) && !IsNull(unAddress);
}

function ResolveAddress(unAddress, nAddressOffset = 0n) {
	if (!IsValidAddress(unAddress)) {
		throw new TypeError("unAddress must be a positive bigint.");
	}

	if (typeof nAddressOffset !== "bigint") {
		throw new TypeError("nAddressOffset must be a signed bigint.");
	}

	const unTargetAddress = (nAddressOffset === 0n) ? unAddress : Add(unAddress, nAddressOffset);
	if (!IsValidAddress(unTargetAddress)) {
		throw new RangeError("unAddress and nAddressOffset must resolve to a positive bigint.");
	}

	return unTargetAddress;
}

function DefineSteamIDAddress(SteamIDInstance) {
	let unAddress = 0n;

	Object.defineProperty(SteamIDInstance, "Address", {
		configurable: false,
		enumerable: true,
		get() {
			return unAddress;
		},
		set(unAddressValue) {
			if (unAddressValue === 0n) {
				unAddress = 0n;
				return;
			}

			unAddress = ResolveAddress(unAddressValue);
		},
	});
}

function NormalizeSteamIDValue(SteamValue) {
	if (SteamValue instanceof SteamID) {
		return SteamValue.ConvertSteamIDToUInt64();
	}

	return g_SteamRuntime.SteamIDNormalize(SteamValue);
}

function CompareUInt64(unLeftSteamID, unRightSteamID) {
	const unLeftNormalizedSteamID = g_SteamRuntime.SteamIDNormalize(unLeftSteamID);
	const unRightNormalizedSteamID = g_SteamRuntime.SteamIDNormalize(unRightSteamID);

	if (unLeftNormalizedSteamID === unRightNormalizedSteamID) {
		return 0;
	}

	return (unLeftNormalizedSteamID < unRightNormalizedSteamID) ? -1 : 1;
}

function ReadSteamIDFields(SteamIDInstance) {
	return g_SteamRuntime.SteamIDFields(SteamIDInstance.ConvertSteamIDToUInt64());
}

function DefineSteamIDField(FieldsView, SteamIDInstance, strFieldName) {
	Object.defineProperty(FieldsView, strFieldName, {
		configurable: false,
		enumerable: true,
		get() {
			return ReadSteamIDFields(SteamIDInstance)[strFieldName];
		},
		set(Value) {
			SteamIDInstance[strFieldName] = Value;
		},
	});
}

function CreateSteamIDFieldsView(SteamIDInstance) {
	const FieldsView = {};
	DefineSteamIDField(FieldsView, SteamIDInstance, "AccountID");
	DefineSteamIDField(FieldsView, SteamIDInstance, "AccountInstance");
	DefineSteamIDField(FieldsView, SteamIDInstance, "AccountType");
	DefineSteamIDField(FieldsView, SteamIDInstance, "Universe");

	return FieldsView;
}

class SteamID {
	constructor(SteamValueOrAccountID, nAccountInstanceOrUniverse, nUniverseOrAccountType, nAccountType) {
		DefineSteamIDAddress(this);
		this.Value = g_SteamRuntime.SteamIDClear();

		if (arguments.length === 0) {
			return;
		}

		if (arguments.length === 1) {
			const bIsSteamID = SteamValueOrAccountID instanceof SteamID;
			const ConvertSteamValue = SteamValueOrAccountID ? SteamValueOrAccountID.ConvertSteamIDToUInt64 : undefined;
			if (bIsSteamID || (typeof ConvertSteamValue === "function")) {
				this.SetSteamIDFromUInt64(Reflect.apply(ConvertSteamValue, SteamValueOrAccountID, []));
			} else if ((typeof SteamValueOrAccountID === "string") && !/^\d+$/.test(SteamValueOrAccountID.trim())) {
				this.SetSteamIDFromUInt64(g_SteamRuntime.SteamIDParse(SteamValueOrAccountID));
			} else {
				const SteamIDValue = (typeof SteamValueOrAccountID === "string") ? BigInt(SteamValueOrAccountID.trim()) : SteamValueOrAccountID;
				this.SetSteamIDFromUInt64(SteamIDValue);
			}

			return;
		}

		if (arguments.length === 3) {
			this.Set(SteamValueOrAccountID, nAccountInstanceOrUniverse, nUniverseOrAccountType);
			return;
		}

		if (arguments.length === 4) {
			this.SetInstanced(SteamValueOrAccountID, nAccountInstanceOrUniverse, nUniverseOrAccountType, nAccountType);
			return;
		}

		throw new TypeError("SteamID constructor expects 0, 1, 3, or 4 arguments.");
	}

	static Parse(strSteamIDText) {
		return new SteamID(g_SteamRuntime.SteamIDParse(strSteamIDText));
	}

	static CreateFromAddress(unAddress, nAddressOffset = 0n) {
		const CreatedSteamID = new SteamID();
		CreatedSteamID.Address = ResolveAddress(unAddress, nAddressOffset);

		return CreatedSteamID;
	}

	static CreateFromValue(SteamValue) {
		if (SteamValue instanceof SteamID) {
			return SteamValue;
		}

		return new SteamID(SteamValue);
	}

	HasAddress() {
		return IsValidAddress(this.Address);
	}

	ReadAddressValue() {
		if (!this.HasAddress()) {
			throw new Error("SteamID is not attached to memory.");
		}

		return g_SteamRuntime.SteamIDNormalize(Read(this.Address, DataType.ULongLong, 0n));
	}

	WriteAddressValue(unSteamIDValue) {
		if (!this.HasAddress()) {
			throw new Error("SteamID is not attached to memory.");
		}

		Write(this.Address, DataType.ULongLong, g_SteamRuntime.SteamIDNormalize(unSteamIDValue), 0n);

		return this;
	}

	SetNativeValue(unSteamIDValue) {
		const unNormalizedSteamIDValue = g_SteamRuntime.SteamIDNormalize(unSteamIDValue);

		if (this.HasAddress()) {
			return this.WriteAddressValue(unNormalizedSteamIDValue);
		}

		this.Value = unNormalizedSteamIDValue;

		return this;
	}

	// The established API allocates a live field view, not a detached snapshot.
	GetSteamIDFields() {
		return CreateSteamIDFieldsView(this);
	}

	Set(unAccountID, nUniverse, nAccountType) {
		return this.SetNativeValue(g_SteamRuntime.SteamIDSet(unAccountID, nUniverse, nAccountType));
	}

	SetInstanced(unAccountID, unAccountInstance, nUniverse, nAccountType) {
		return this.SetNativeValue(g_SteamRuntime.SteamIDInstancedSet(unAccountID, unAccountInstance, nUniverse, nAccountType));
	}

	SetFull(unSteamIDIdentifier, nUniverse, nAccountType) {
		return this.SetNativeValue(g_SteamRuntime.SteamIDFullSet(unSteamIDIdentifier, nUniverse, nAccountType));
	}

	SetSteamIDFromUInt64(unSteamIDValue) {
		return this.SetNativeValue(unSteamIDValue);
	}

	ConvertSteamIDToUInt64() {
		return this.HasAddress() ? this.ReadAddressValue() : g_SteamRuntime.SteamIDNormalize(this.Value);
	}

	ConvertSteamIDToSteamID2() {
		return g_SteamRuntime.SteamIDToSteamID2(this.ConvertSteamIDToUInt64());
	}

	ConvertSteamIDToSteamID3() {
		return g_SteamRuntime.SteamIDToSteamID3(this.ConvertSteamIDToUInt64());
	}

	CreateBlankAnonymousLogon(nUniverse) {
		return this.SetNativeValue(g_SteamRuntime.SteamIDCreateBlankAnonymousLogon(nUniverse));
	}

	CreateBlankAnonymousUserAccount(nUniverse) {
		return this.SetNativeValue(g_SteamRuntime.SteamIDCreateBlankAnonymousUserAccount(nUniverse));
	}

	Clear() {
		return this.SetNativeValue(g_SteamRuntime.SteamIDClear());
	}

	ClearIndividualInstance() {
		return this.SetNativeValue(g_SteamRuntime.SteamIDClearIndividualInstance(this.ConvertSteamIDToUInt64()));
	}

	IsBlankAnonymousAccount() {
		return g_SteamRuntime.SteamIDIsBlankAnonymousAccount(this.ConvertSteamIDToUInt64());
	}

	IsGameServerAccount() {
		return g_SteamRuntime.SteamIDIsGameServerAccount(this.ConvertSteamIDToUInt64());
	}

	IsPersistentGameServerAccount() {
		return g_SteamRuntime.SteamIDIsPersistentGameServerAccount(this.ConvertSteamIDToUInt64());
	}

	IsAnonymousGameServerAccount() {
		return g_SteamRuntime.SteamIDIsAnonymousGameServerAccount(this.ConvertSteamIDToUInt64());
	}

	IsContentServerAccount() {
		return g_SteamRuntime.SteamIDIsContentServerAccount(this.ConvertSteamIDToUInt64());
	}

	IsClanAccount() {
		return g_SteamRuntime.SteamIDIsClanAccount(this.ConvertSteamIDToUInt64());
	}

	IsChatAccount() {
		return g_SteamRuntime.SteamIDIsChatAccount(this.ConvertSteamIDToUInt64());
	}

	IsLobby() {
		return g_SteamRuntime.SteamIDIsLobby(this.ConvertSteamIDToUInt64());
	}

	IsIndividualAccount() {
		return g_SteamRuntime.SteamIDIsIndividualAccount(this.ConvertSteamIDToUInt64());
	}

	IsAnonymousAccount() {
		return g_SteamRuntime.SteamIDIsAnonymousAccount(this.ConvertSteamIDToUInt64());
	}

	IsAnonymousUserAccount() {
		return g_SteamRuntime.SteamIDIsAnonymousUserAccount(this.ConvertSteamIDToUInt64());
	}

	IsConsoleUserAccount() {
		return g_SteamRuntime.SteamIDIsConsoleUserAccount(this.ConvertSteamIDToUInt64());
	}

	HasNoIndividualInstance() {
		return g_SteamRuntime.SteamIDHasNoIndividualInstance(this.ConvertSteamIDToUInt64());
	}

	IsValid() {
		return g_SteamRuntime.SteamIDIsValid(this.ConvertSteamIDToUInt64());
	}

	AreEqual(SteamValue) {
		return this.ConvertSteamIDToUInt64() === NormalizeSteamIDValue(SteamValue);
	}

	Compare(SteamValue) {
		return CompareUInt64(this.ConvertSteamIDToUInt64(), NormalizeSteamIDValue(SteamValue));
	}

	CopySteamID() {
		return new SteamID(this.ConvertSteamIDToUInt64());
	}

	CopySteamIDFrom(SteamValue) {
		return this.SetSteamIDFromUInt64(NormalizeSteamIDValue(SteamValue));
	}

	CopySteamIDTo(TargetSteamID) {
		if (!(TargetSteamID instanceof SteamID)) {
			throw new TypeError("TargetSteamID must be a SteamID instance.");
		}

		TargetSteamID.CopySteamIDFrom(this);

		return TargetSteamID;
	}

	toString() {
		return this.ConvertSteamIDToSteamID3();
	}

	get AccountID() {
		return ReadSteamIDFields(this).AccountID;
	}

	set AccountID(unAccountID) {
		const SteamIDFields = ReadSteamIDFields(this);
		const unSteamIDValue = g_SteamRuntime.SteamIDInstancedSet(unAccountID, SteamIDFields.AccountInstance, SteamIDFields.Universe, SteamIDFields.AccountType);
		this.SetNativeValue(unSteamIDValue);
	}

	get AccountInstance() {
		return ReadSteamIDFields(this).AccountInstance;
	}

	set AccountInstance(unAccountInstance) {
		const SteamIDFields = ReadSteamIDFields(this);
		const unSteamIDValue = g_SteamRuntime.SteamIDInstancedSet(SteamIDFields.AccountID, unAccountInstance, SteamIDFields.Universe, SteamIDFields.AccountType);
		this.SetNativeValue(unSteamIDValue);
	}

	get AccountType() {
		return ReadSteamIDFields(this).AccountType;
	}

	set AccountType(nAccountType) {
		const SteamIDFields = ReadSteamIDFields(this);
		const unSteamIDValue = g_SteamRuntime.SteamIDInstancedSet(SteamIDFields.AccountID, SteamIDFields.AccountInstance, SteamIDFields.Universe, nAccountType);
		this.SetNativeValue(unSteamIDValue);
	}

	get Universe() {
		return ReadSteamIDFields(this).Universe;
	}

	set Universe(nUniverse) {
		const SteamIDFields = ReadSteamIDFields(this);
		const unSteamIDValue = g_SteamRuntime.SteamIDInstancedSet(SteamIDFields.AccountID, SteamIDFields.AccountInstance, nUniverse, SteamIDFields.AccountType);
		this.SetNativeValue(unSteamIDValue);
	}

	get StaticAccountKey() {
		return g_SteamRuntime.SteamIDStaticAccountKey(this.ConvertSteamIDToUInt64());
	}
}

SteamID.TypeSize = g_unSteamIDSize;

const g_vecOptionalSteamIDMethods = [
	["ClearIndividualInstance", "SteamIDClearIndividualInstance"],
	["HasNoIndividualInstance", "SteamIDHasNoIndividualInstance"],
	["IsAnonymousAccount", "SteamIDIsAnonymousAccount"],
	["IsAnonymousGameServerAccount", "SteamIDIsAnonymousGameServerAccount"],
	["IsAnonymousUserAccount", "SteamIDIsAnonymousUserAccount"],
	["IsBlankAnonymousAccount", "SteamIDIsBlankAnonymousAccount"],
	["IsChatAccount", "SteamIDIsChatAccount"],
	["IsClanAccount", "SteamIDIsClanAccount"],
	["IsConsoleUserAccount", "SteamIDIsConsoleUserAccount"],
	["IsContentServerAccount", "SteamIDIsContentServerAccount"],
	["IsGameServerAccount", "SteamIDIsGameServerAccount"],
	["IsIndividualAccount", "SteamIDIsIndividualAccount"],
	["IsLobby", "SteamIDIsLobby"],
	["IsPersistentGameServerAccount", "SteamIDIsPersistentGameServerAccount"],
	["IsValid", "SteamIDIsValid"],
	["ConvertSteamIDToSteamID2", "SteamIDToSteamID2"],
];

if (g_bHasSteamID) {
	for (const vecOptionalSteamIDMethod of g_vecOptionalSteamIDMethods) {
		const strMethodName = vecOptionalSteamIDMethod[0];
		const strNativeMethodName = vecOptionalSteamIDMethod[1];
		if (typeof g_SteamRuntime[strNativeMethodName] !== "function") {
			delete SteamID.prototype[strMethodName];
		}
	}

	RegisterObjectType("SteamID", SteamID, { Size: SteamID.TypeSize });
}

function GetNetworkID(nPlayerIndex) {
	return g_SteamRuntime.GetNetworkID(nPlayerIndex);
}

function GetXUID(nPlayerIndex) {
	return g_SteamRuntime.GetXUID(nPlayerIndex);
}

const g_SteamExports = {
	GetNetworkID,
	STEAM_BRANCH: g_strSteamBranch,
};

if (g_bHasSteamID) {
	Object.assign(g_SteamExports, { AccountType: g_SteamAccountType, STEAM_ID_SIZE: g_unSteamIDSize, SteamID, Universe: g_SteamUniverse });
}

if (typeof g_SteamRuntime.GetXUID === "function") {
	g_SteamExports.GetXUID = GetXUID;
}

module.exports = g_SteamExports;
