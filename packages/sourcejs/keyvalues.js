"use strict";

const { Color } = require("colors");
const { GetModule } = require("internal/runtime");

const g_nMinimumInt32 = -2_147_483_648;
const g_nMaximumInt32 = 2_147_483_647;
const g_unMaximumColorComponent = 0xFF;
const g_unMaximumUInt64 = 0xFFFFFFFFFFFFFFFFn;

const g_KeyValuesRuntime = GetModule("keyvalues");
const g_KeyValuesType = Object.freeze(g_KeyValuesRuntime.Types());

function IsPlainObject(Value) {
	if ((Value === null) || (typeof Value !== "object")) {
		return false;
	}

	const ObjectPrototype = Object.getPrototypeOf(Value);

	return (ObjectPrototype === Object.prototype) || (ObjectPrototype === null);
}

function IsByte(unByteValue) {
	return Number.isInteger(unByteValue) && (unByteValue >= 0) && (unByteValue <= g_unMaximumColorComponent);
}

function IsColorValue(ColorValue) {
	if (ColorValue instanceof Color) {
		return true;
	}

	if (Array.isArray(ColorValue)) {
		return ((ColorValue.length === 3) || (ColorValue.length === 4)) && ColorValue.every(IsByte);
	}

	return IsPlainObject(ColorValue)
		&& Object.hasOwn(ColorValue, "Red")
		&& Object.hasOwn(ColorValue, "Green")
		&& Object.hasOwn(ColorValue, "Blue")
		&& IsByte(ColorValue.Red)
		&& IsByte(ColorValue.Green)
		&& IsByte(ColorValue.Blue)
		&& (!Object.hasOwn(ColorValue, "Alpha") || IsByte(ColorValue.Alpha));
}

function WrapHandle(hNativeHandle) {
	if (!hNativeHandle) {
		return null;
	}

	const KeyValuesWrapper = Object.create(KeyValues.prototype);
	KeyValuesWrapper.Handle = hNativeHandle;
	KeyValuesWrapper.UseEscapeSequences = false;

	return KeyValuesWrapper;
}

function GetValueType(KeyValue) {
	if (KeyValue instanceof KeyValues) {
		return g_KeyValuesType.None;
	}

	if (typeof KeyValue === "bigint") {
		if ((KeyValue < 0n) || (KeyValue > g_unMaximumUInt64)) {
			throw new RangeError("KeyValues bigint values must be in the unsigned 64-bit range.");
		}

		return g_KeyValuesType.UInt64;
	}

	if (typeof KeyValue === "number") {
		if (!Number.isFinite(KeyValue)) {
			throw new TypeError("KeyValues numeric values must be finite numbers.");
		}

		if (Number.isInteger(KeyValue)) {
			if ((KeyValue >= g_nMinimumInt32) && (KeyValue <= g_nMaximumInt32)) {
				return g_KeyValuesType.Int;
			}

			throw new RangeError("KeyValues integers outside the signed 32-bit range require a non-negative unsigned 64-bit bigint, or an explicit SetKeyValuesFloat call for floating-point storage.");
		}

		return g_KeyValuesType.Float;
	}

	if (typeof KeyValue === "boolean") {
		return g_KeyValuesType.Int;
	}

	if (IsColorValue(KeyValue)) {
		return g_KeyValuesType.Color;
	}

	if (IsPlainObject(KeyValue)) {
		return g_KeyValuesType.None;
	}

	if (typeof KeyValue === "string") {
		return g_KeyValuesType.String;
	}

	throw new TypeError("KeyValues values must be a string, boolean, number, bigint, color, KeyValues instance or plain object.");
}

function GetTypedValueForKey(KeyValuesValue, bPreserveDuplicateKeys = false) {
	switch (KeyValuesValue.GetKeyValuesType()) {
		case g_KeyValuesType.None:
			return KeyValuesValue.ConvertKeyValuesToObject(bPreserveDuplicateKeys);

		case g_KeyValuesType.Int:
			return KeyValuesValue.GetKeyValuesInteger();

		case g_KeyValuesType.Float:
			return KeyValuesValue.GetKeyValuesFloat();

		case g_KeyValuesType.UInt64:
			return KeyValuesValue.GetKeyValuesUInt64();

		case g_KeyValuesType.Color:
			return KeyValuesValue.GetKeyValuesColor();

		case g_KeyValuesType.Address:
			return KeyValuesValue.GetKeyValuesAddress();

		default:
			return KeyValuesValue.GetKeyValuesString();
	}
}

function DestroyKeyValuesAfterFailure(KeyValuesValue, Failure) {
	try {
		KeyValuesValue.DestroyKeyValues();
	} catch (CleanupFailure) {
		throw new AggregateError([Failure, CleanupFailure], "KeyValues initialization and cleanup failed.");
	}

	throw Failure;
}

class KeyValuesIterator {
	constructor(KeyValuesValue) {
		if (!(KeyValuesValue instanceof KeyValues)) {
			throw new TypeError("KeyValuesIterator expects a KeyValues instance.");
		}

		this.#m_NextKeyValues = KeyValuesValue.FirstSubKeyValues;
	}

	next() {
		if (!this.#m_NextKeyValues) {
			return { done: true, value: undefined };
		}

		const CurrentKeyValues = this.#m_NextKeyValues;
		let strKeyName = "";
		let NextKeyValues = null;

		try {
			strKeyName = CurrentKeyValues.Name;
			NextKeyValues = CurrentKeyValues.NextKeyValues;
		} finally {
			CurrentKeyValues.DestroyKeyValues();
			this.#m_NextKeyValues = NextKeyValues;
		}

		return { done: false, value: strKeyName };
	}

	return() {
		if (this.#m_NextKeyValues) {
			this.#m_NextKeyValues.DestroyKeyValues();
			this.#m_NextKeyValues = null;
		}

		return { done: true, value: undefined };
	}

	[Symbol.iterator]() {
		return this;
	}

	get NextKeyValues() {
		return this.#m_NextKeyValues;
	}

	#m_NextKeyValues;
}

class KeyValues {
	constructor(strKeyValuesName = "", FirstKeyNameOrObject = undefined, FirstKeyValue = undefined, strSecondKeyName = undefined, SecondKeyValue = undefined) {
		this.Handle = g_KeyValuesRuntime.Create(strKeyValuesName);
		this.UseEscapeSequences = false;

		try {
			if (IsPlainObject(FirstKeyNameOrObject) && (FirstKeyValue === undefined)) {
				this.AddKeyValuesObject(FirstKeyNameOrObject);
				return;
			}

			if (FirstKeyNameOrObject !== undefined) {
				const FirstResultKeyValues = this.SetKeyValuesValue(FirstKeyNameOrObject, FirstKeyValue);
				if (FirstResultKeyValues !== this) {
					FirstResultKeyValues.DestroyKeyValues();
				}
			}

			if (strSecondKeyName !== undefined) {
				const SecondResultKeyValues = this.SetKeyValuesValue(strSecondKeyName, SecondKeyValue);
				if (SecondResultKeyValues !== this) {
					SecondResultKeyValues.DestroyKeyValues();
				}
			}
		} catch (ErrorValue) {
			DestroyKeyValuesAfterFailure(this, ErrorValue);
		}
	}

	static CreateKeyValuesFromObject(strKeyValuesName, SourceObject) {
		const KeyValuesValue = new KeyValues(strKeyValuesName);

		try {
			KeyValuesValue.AddKeyValuesObject(SourceObject);

			return KeyValuesValue;
		} catch (ErrorValue) {
			DestroyKeyValuesAfterFailure(KeyValuesValue, ErrorValue);
		}
	}

	static CreateKeyValuesFromBuffer(strKeyValuesBuffer, bUsesEscapeSequences = false) {
		const KeyValuesValue = new KeyValues("");

		try {
			KeyValuesValue.SetKeyValuesEscapeSequencesEnabled(bUsesEscapeSequences);

			if (!KeyValuesValue.LoadKeyValuesFromBufferInPlace(strKeyValuesBuffer)) {
				throw new Error("Could not parse the KeyValues buffer.");
			}

			return KeyValuesValue;
		} catch (ErrorValue) {
			DestroyKeyValuesAfterFailure(KeyValuesValue, ErrorValue);
		}
	}

	static CreateKeyValuesFromFile(strFileName, LoadOptions = {}) {
		const KeyValuesValue = new KeyValues("");

		try {
			if (!KeyValuesValue.LoadKeyValuesFromFileInPlace(strFileName, LoadOptions)) {
				throw new Error("Could not load the KeyValues file.");
			}

			return KeyValuesValue;
		} catch (ErrorValue) {
			DestroyKeyValuesAfterFailure(KeyValuesValue, ErrorValue);
		}
	}

	DestroyKeyValues() {
		if (this.Handle === null) {
			return false;
		}

		const bDestroyed = g_KeyValuesRuntime.Destroy(this.Handle);
		this.Handle = null;

		return bDestroyed;
	}

	SetKeyValuesEscapeSequencesEnabled(bEscapeSequencesEnabled = true) {
		if (typeof bEscapeSequencesEnabled !== "boolean") {
			throw new TypeError("KeyValues.SetKeyValuesEscapeSequencesEnabled expects a boolean.");
		}

		this.UseEscapeSequences = bEscapeSequencesEnabled;

		return this.UseEscapeSequences;
	}

	AddKeyValuesObject(SourceObject) {
		if (!IsPlainObject(SourceObject)) {
			throw new TypeError("KeyValues.AddKeyValuesObject expects a plain object.");
		}

		for (const [strKeyName, KeyValue] of Object.entries(SourceObject)) {
			this.SetKeyValuesValue(strKeyName, KeyValue).DestroyKeyValues();
		}

		return this;
	}

	FindKeyValuesKey(strKeyName, bCreateKey = false) {
		return WrapHandle(g_KeyValuesRuntime.FindKey(this.Handle, strKeyName, bCreateKey));
	}

	FindKeyValuesKeyBySymbol(nKeySymbol) {
		return WrapHandle(g_KeyValuesRuntime.FindKeyBySymbol(this.Handle, nKeySymbol));
	}

	CreateKeyValuesKey() {
		return WrapHandle(g_KeyValuesRuntime.CreateNewKey(this.Handle));
	}

	AddKeyValuesSubKey(SubKeyValues) {
		if (!(SubKeyValues instanceof KeyValues)) {
			throw new TypeError("KeyValues.AddKeyValuesSubKey expects a KeyValues instance.");
		}

		g_KeyValuesRuntime.AddSubKey(this.Handle, SubKeyValues.Handle);

		return SubKeyValues;
	}

	RemoveKeyValuesSubKey(SubKeyValues) {
		if (!(SubKeyValues instanceof KeyValues)) {
			throw new TypeError("KeyValues.RemoveKeyValuesSubKey expects a KeyValues instance.");
		}

		return g_KeyValuesRuntime.RemoveSubKey(this.Handle, SubKeyValues.Handle);
	}

	CreateKeyValuesCopy() {
		return WrapHandle(g_KeyValuesRuntime.MakeCopy(this.Handle));
	}

	CopyKeyValuesRecursively(SourceKeyValues) {
		if (!(SourceKeyValues instanceof KeyValues)) {
			throw new TypeError("KeyValues.CopyKeyValuesRecursively expects a KeyValues instance.");
		}

		const unSourceAddress = SourceKeyValues.Address;
		const unDestinationAddress = this.Address;
		if (unSourceAddress === unDestinationAddress) {
			return this;
		}

		this.ClearKeyValues();
		g_KeyValuesRuntime.CopySubKeys(SourceKeyValues.Handle, this.Handle);

		return this;
	}

	LoadKeyValuesFromBufferInPlace(strKeyValuesBuffer) {
		return g_KeyValuesRuntime.LoadFromBuffer(this.Handle, strKeyValuesBuffer, this.UseEscapeSequences);
	}

	LoadKeyValuesFromFileInPlace(strFileName, LoadOptions = {}) {
		if (!IsPlainObject(LoadOptions)) {
			throw new TypeError("KeyValues.LoadKeyValuesFromFileInPlace LoadOptions must be an object.");
		}

		for (const OptionName of Reflect.ownKeys(LoadOptions)) {
			if (OptionName !== "UseEscapeSequences") {
				throw new TypeError(`Unknown KeyValues.LoadKeyValuesFromFileInPlace option '${String(OptionName)}'.`);
			}
		}

		if (Object.hasOwn(LoadOptions, "UseEscapeSequences")) {
			this.SetKeyValuesEscapeSequencesEnabled(LoadOptions.UseEscapeSequences);
		}

		return g_KeyValuesRuntime.LoadFromFile(this.Handle, strFileName, this.UseEscapeSequences);
	}

	SaveKeyValuesToFile(strFileName) {
		return g_KeyValuesRuntime.SaveToFile(this.Handle, strFileName);
	}

	GetKeyValuesKeyOrDefault(strKeyName, DefaultValue = null) {
		if ((strKeyName === null) || (strKeyName === undefined)) {
			return this;
		}

		return this.FindKeyValuesKey(strKeyName) ?? DefaultValue;
	}

	GetKeyValuesValue(strKeyName) {
		const KeyValuesValue = this.GetKeyValuesKeyOrDefault(strKeyName);
		if (!KeyValuesValue) {
			throw new Error(`KeyValues.GetKeyValuesValue: key '${String(strKeyName)}' does not exist.`);
		}

		try {
			return GetTypedValueForKey(KeyValuesValue);
		} finally {
			if (KeyValuesValue !== this) {
				KeyValuesValue.DestroyKeyValues();
			}
		}
	}

	SetKeyValuesValue(strKeyName, KeyValue) {
		const unKeyValueType = GetValueType(KeyValue);
		const ChildKeyValues = this.FindKeyValuesKey(strKeyName, true);
		if (!ChildKeyValues) {
			throw new Error(`KeyValues.SetKeyValuesValue could not create key '${String(strKeyName)}'.`);
		}

		try {
			if (KeyValue instanceof KeyValues) {
				ChildKeyValues.CopyKeyValuesRecursively(KeyValue);
				return ChildKeyValues;
			}

			ChildKeyValues.ClearKeyValues();

			if (unKeyValueType === g_KeyValuesType.None) {
				ChildKeyValues.AddKeyValuesObject(KeyValue);
			} else if (unKeyValueType === g_KeyValuesType.UInt64) {
				ChildKeyValues.SetKeyValuesUInt64(null, KeyValue);
			} else if (unKeyValueType === g_KeyValuesType.Float) {
				ChildKeyValues.SetKeyValuesFloat(null, KeyValue);
			} else if (typeof KeyValue === "boolean") {
				ChildKeyValues.SetKeyValuesBoolean(null, KeyValue);
			} else if (unKeyValueType === g_KeyValuesType.Int) {
				ChildKeyValues.SetKeyValuesInteger(null, KeyValue);
			} else if (unKeyValueType === g_KeyValuesType.Color) {
				ChildKeyValues.SetKeyValuesColor(null, KeyValue);
			} else {
				ChildKeyValues.SetKeyValuesString(null, KeyValue);
			}

			return ChildKeyValues;
		} catch (ErrorValue) {
			DestroyKeyValuesAfterFailure(ChildKeyValues, ErrorValue);
		}
	}

	DeleteKeyValuesKey(strKeyName) {
		const ChildKeyValues = this.FindKeyValuesKey(strKeyName);
		if (!ChildKeyValues) {
			throw new Error(`KeyValues.DeleteKeyValuesKey: key '${String(strKeyName)}' does not exist.`);
		}

		try {
			return this.RemoveKeyValuesSubKey(ChildKeyValues);
		} finally {
			ChildKeyValues.DestroyKeyValues();
		}
	}

	HasKeyValuesKey(strKeyName) {
		const ChildKeyValues = this.FindKeyValuesKey(strKeyName);
		if (!ChildKeyValues) {
			return false;
		}

		ChildKeyValues.DestroyKeyValues();

		return true;
	}

	GetKeyValuesInteger(strKeyName = null, nDefaultValue = 0) {
		return g_KeyValuesRuntime.GetInt(this.Handle, strKeyName, nDefaultValue);
	}

	GetKeyValuesUInt64(strKeyName = null, unDefaultValue = 0n) {
		return g_KeyValuesRuntime.GetUInt64(this.Handle, strKeyName, unDefaultValue);
	}

	GetKeyValuesFloat(strKeyName = null, flDefaultValue = 0) {
		return g_KeyValuesRuntime.GetFloat(this.Handle, strKeyName, flDefaultValue);
	}

	GetKeyValuesString(strKeyName = null, strDefaultValue = "") {
		return g_KeyValuesRuntime.GetString(this.Handle, strKeyName, strDefaultValue);
	}

	GetKeyValuesColor(strKeyName = null, DefaultValue = { Red: 0, Green: 0, Blue: 0, Alpha: g_unMaximumColorComponent }) {
		return Color.CreateColorFromValue(g_KeyValuesRuntime.GetColor(this.Handle, strKeyName, DefaultValue));
	}

	GetKeyValuesAddress(strKeyName = null, unDefaultValue = 0n) {
		return g_KeyValuesRuntime.GetAddress(this.Handle, strKeyName, unDefaultValue);
	}

	IsKeyValuesEmpty(strKeyName = null) {
		return g_KeyValuesRuntime.IsEmpty(this.Handle, strKeyName);
	}

	ClearKeyValues() {
		return g_KeyValuesRuntime.Clear(this.Handle);
	}

	SetKeyValuesString(strKeyName, strValue) {
		g_KeyValuesRuntime.SetString(this.Handle, strKeyName, strValue);

		return ((strKeyName === null) || (strKeyName === undefined)) ? this : this.FindKeyValuesKey(strKeyName);
	}

	SetKeyValuesInteger(strKeyName, nValue) {
		g_KeyValuesRuntime.SetInt(this.Handle, strKeyName, nValue);

		return ((strKeyName === null) || (strKeyName === undefined)) ? this : this.FindKeyValuesKey(strKeyName);
	}

	SetKeyValuesUInt64(strKeyName, unValue) {
		g_KeyValuesRuntime.SetUInt64(this.Handle, strKeyName, unValue);

		return ((strKeyName === null) || (strKeyName === undefined)) ? this : this.FindKeyValuesKey(strKeyName);
	}

	SetKeyValuesFloat(strKeyName, flValue) {
		g_KeyValuesRuntime.SetFloat(this.Handle, strKeyName, flValue);

		return ((strKeyName === null) || (strKeyName === undefined)) ? this : this.FindKeyValuesKey(strKeyName);
	}

	SetKeyValuesColor(strKeyName, ColorValue) {
		if (!IsColorValue(ColorValue)) {
			throw new TypeError("KeyValues.SetKeyValuesColor expects a Color, an RGB/RGBA byte array or a color object.");
		}

		g_KeyValuesRuntime.SetColor(this.Handle, strKeyName, Color.CreateColorFromValue(ColorValue));

		return ((strKeyName === null) || (strKeyName === undefined)) ? this : this.FindKeyValuesKey(strKeyName);
	}

	SetKeyValuesAddress(strKeyName, unAddressValue) {
		g_KeyValuesRuntime.SetAddress(this.Handle, strKeyName, unAddressValue);

		return ((strKeyName === null) || (strKeyName === undefined)) ? this : this.FindKeyValuesKey(strKeyName);
	}

	GetKeyValuesType(strKeyName = null) {
		return g_KeyValuesRuntime.DataType(this.Handle, strKeyName);
	}

	GetKeyValuesKeyNames() {
		return g_KeyValuesRuntime.Keys(this.Handle);
	}

	GetKeyValuesValueList() {
		const GetValue = (strKeyName) => this.GetKeyValuesValue(strKeyName);

		return this.GetKeyValuesKeyNames().map(GetValue);
	}

	GetKeyValuesEntries() {
		const GetEntry = (strKeyName) => [strKeyName, this.GetKeyValuesValue(strKeyName)];

		return this.GetKeyValuesKeyNames().map(GetEntry);
	}

	ConvertKeyValuesToObject(bPreserveDuplicateKeys = false) {
		if (typeof bPreserveDuplicateKeys !== "boolean") {
			throw new TypeError("KeyValues.ConvertKeyValuesToObject(bPreserveDuplicateKeys) expects a boolean.");
		}

		const KeyValuesObject = {};
		const setDuplicateKeyNames = bPreserveDuplicateKeys ? new Set() : null;
		let ChildKeyValues = this.FirstSubKeyValues;
		while (ChildKeyValues) {
			let NextChildKeyValues = null;

			try {
				const strChildKeyName = ChildKeyValues.Name;
				const ChildKeyValue = GetTypedValueForKey(ChildKeyValues, bPreserveDuplicateKeys);
				if (bPreserveDuplicateKeys && Object.hasOwn(KeyValuesObject, strChildKeyName)) {
					if (setDuplicateKeyNames.has(strChildKeyName)) {
						KeyValuesObject[strChildKeyName].push(ChildKeyValue);

					} else {
						const vecDuplicateValues = [KeyValuesObject[strChildKeyName], ChildKeyValue];
						Object.defineProperty(KeyValuesObject, strChildKeyName, { configurable: true, enumerable: true, value: vecDuplicateValues, writable: true });
						setDuplicateKeyNames.add(strChildKeyName);
					}

				} else {
					Object.defineProperty(KeyValuesObject, strChildKeyName, { configurable: true, enumerable: true, value: ChildKeyValue, writable: true });
				}

				NextChildKeyValues = ChildKeyValues.NextKeyValues;
			} finally {
				ChildKeyValues.DestroyKeyValues();
			}

			ChildKeyValues = NextChildKeyValues;
		}

		return KeyValuesObject;
	}

	ConvertKeyValuesToString() {
		return g_KeyValuesRuntime.ToString(this.Handle);
	}

	[Symbol.iterator]() {
		return new KeyValuesIterator(this);
	}

	get Address() {
		return g_KeyValuesRuntime.Address(this.Handle);
	}

	get Name() {
		return g_KeyValuesRuntime.Name(this.Handle);
	}

	set Name(strKeyName) {
		g_KeyValuesRuntime.SetName(this.Handle, strKeyName);
	}

	get KeyNameSymbol() {
		return g_KeyValuesRuntime.NameSymbol(this.Handle);
	}

	get KeyValuesType() {
		return this.GetKeyValuesType();
	}

	get KeyValuesValue() {
		return GetTypedValueForKey(this);
	}

	get DirectChildValues() {
		return this.ConvertKeyValuesToObject();
	}

	get FirstSubKeyValues() {
		return WrapHandle(g_KeyValuesRuntime.FirstSubKey(this.Handle));
	}

	get NextKeyValues() {
		return WrapHandle(g_KeyValuesRuntime.NextKey(this.Handle));
	}

	set NextKeyValues(NextKeyValues) {
		if ((NextKeyValues !== null) && !(NextKeyValues instanceof KeyValues)) {
			throw new TypeError("KeyValues.NextKeyValues expects a KeyValues instance or null.");
		}

		g_KeyValuesRuntime.SetNextKey(this.Handle, (NextKeyValues === null) ? null : NextKeyValues.Handle);
	}

	get FirstTrueSubKeyValues() {
		return WrapHandle(g_KeyValuesRuntime.FirstTrueSubKey(this.Handle));
	}

	get NextTrueSubKeyValues() {
		return WrapHandle(g_KeyValuesRuntime.NextTrueSubKey(this.Handle));
	}

	get FirstValueKeyValues() {
		return WrapHandle(g_KeyValuesRuntime.FirstValue(this.Handle));
	}

	get NextValueKeyValues() {
		return WrapHandle(g_KeyValuesRuntime.NextValue(this.Handle));
	}
}

function CreateKeyValues(strKeyValuesName, KeyValuesObject = {}) {
	return KeyValues.CreateKeyValuesFromObject(strKeyValuesName, KeyValuesObject);
}

// Keep these methods absent on SDKs without the corresponding native boolean operation.
if (typeof g_KeyValuesRuntime.GetBool === "function") {
	Object.defineProperty(KeyValues.prototype, "GetKeyValuesBoolean", {
		configurable: true,
		enumerable: false,
		writable: true,
		value: function GetKeyValuesBoolean(strKeyName = null, bDefaultValue = false) {
			return g_KeyValuesRuntime.GetBool(this.Handle, strKeyName, bDefaultValue);
		},
	});
}

if (typeof g_KeyValuesRuntime.SetBool === "function") {
	Object.defineProperty(KeyValues.prototype, "SetKeyValuesBoolean", {
		configurable: true,
		enumerable: false,
		writable: true,
		value: function SetKeyValuesBoolean(strKeyName, bValue) {
			g_KeyValuesRuntime.SetBool(this.Handle, strKeyName, bValue);

			return ((strKeyName === null) || (strKeyName === undefined)) ? this : this.FindKeyValuesKey(strKeyName);
		},
	});
}

module.exports = { KeyValuesType: g_KeyValuesType, KeyValues, KeyValuesIterator, CreateKeyValues };
