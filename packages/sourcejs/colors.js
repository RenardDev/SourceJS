"use strict";

const { GetModule } = require("internal/runtime");
const { RegisterObjectType } = require("memory");
const { Add, IsNull, Read, Write } = require("memory/helpers");

const g_unColorSize = 4;
const g_unMaximumColorComponent = 0xFF;
const g_vecComponentNames = ["Red", "Green", "Blue", "Alpha"];
const g_ColorsRuntime = GetModule("colors");

function NormalizeColorComponent(dblComponent) {
	if ((typeof dblComponent !== "number") || !Number.isFinite(dblComponent)) {
		throw new TypeError("Color components must be finite numbers.");
	}

	return Math.max(0, Math.min(g_unMaximumColorComponent, Math.trunc(dblComponent)));
}

function IsAddress(unAddress) {
	return (typeof unAddress === "bigint") && (unAddress >= 0n);
}

function GetAddressWithOffset(unAddress, nAddressOffset = 0n) {
	if (unAddress === null) {
		return null;
	}

	if (!IsAddress(unAddress)) {
		throw new TypeError("Color addresses must be non-negative BigInt values.");
	}

	if (typeof nAddressOffset !== "bigint") {
		throw new TypeError("Color address offsets must be signed 64-bit BigInt values.");
	}

	if (unAddress === 0n) {
		throw new RangeError("Color addresses must not be null.");
	}

	const unResolvedAddress = Add(unAddress, nAddressOffset);
	if (unResolvedAddress === 0n) {
		throw new RangeError("Color address offsets must not produce a null address.");
	}

	return unResolvedAddress;
}

function IsArrayLike(Candidate) {
	if (!Candidate || (typeof Candidate === "function") || (typeof Candidate === "string")) {
		return false;
	}

	return (typeof Candidate.length === "number") && Number.isFinite(Candidate.length) && (Candidate.length >= 0);
}

function ConvertByteToHex(unComponent) {
	return NormalizeColorComponent(unComponent).toString(16).toUpperCase().padStart(2, "0");
}

class Color {
	constructor(dblRed = 0, dblGreen = 0, dblBlue = 0, dblAlpha = g_unMaximumColorComponent, unAddress = null, nAddressOffset = 0n) {
		this.m_unAddress = GetAddressWithOffset(unAddress, nAddressOffset);
		this.m_vecValues = [NormalizeColorComponent(dblRed), NormalizeColorComponent(dblGreen), NormalizeColorComponent(dblBlue), NormalizeColorComponent(dblAlpha)];
		this.m_bFrozen = false;

		for (let unComponentIndex = 0; unComponentIndex < g_vecComponentNames.length; unComponentIndex += 1) {
			Object.defineProperty(this, unComponentIndex, {
				enumerable: false,
				configurable: false,
				get() {
					return this.GetColorChannel(unComponentIndex);
				},
				set(dblComponent) {
					this.SetColorChannel(unComponentIndex, dblComponent);
				},
			});
		}
	}

	static CreateColorFromAddress(unAddress, nAddressOffset = 0n) {
		if (!IsAddress(unAddress)) {
			throw new TypeError("Color.CreateColorFromAddress(unAddress, nAddressOffset?) expects a non-negative BigInt address.");
		}

		return new Color(0, 0, 0, g_unMaximumColorComponent, unAddress, nAddressOffset);
	}

	static CreateColorFromValue(ColorLike) {
		if (ColorLike instanceof Color) {
			return ColorLike;
		}

		if (IsAddress(ColorLike)) {
			return Color.CreateColorFromAddress(ColorLike);
		}

		if (Array.isArray(ColorLike) || IsArrayLike(ColorLike)) {
			return new Color(ColorLike[0], ColorLike[1], ColorLike[2], (ColorLike.length > 3) ? ColorLike[3] : g_unMaximumColorComponent);
		}

		if (ColorLike && (typeof ColorLike === "object")) {
			return new Color(ColorLike.Red ?? 0, ColorLike.Green ?? 0, ColorLike.Blue ?? 0, ColorLike.Alpha ?? g_unMaximumColorComponent);
		}

		throw new TypeError("Color.CreateColorFromValue expects a Color, address, array-like value or color object.");
	}

	ConvertColorToArray() {
		return [this.Red, this.Green, this.Blue, this.Alpha];
	}

	CopyColor() {
		return new Color(this.Red, this.Green, this.Blue, this.Alpha);
	}

	CopyColorFrom(ColorLike) {
		const SourceColor = Color.CreateColorFromValue(ColorLike);
		const vecSourceComponents = [];
		for (let unComponentIndex = 0; unComponentIndex < g_vecComponentNames.length; unComponentIndex += 1) {
			vecSourceComponents.push(SourceColor.GetColorChannel(unComponentIndex));
		}

		for (let unComponentIndex = 0; unComponentIndex < g_vecComponentNames.length; unComponentIndex += 1) {
			this.SetColorChannel(unComponentIndex, vecSourceComponents[unComponentIndex]);
		}

		return this;
	}

	CopyColorTo(TargetColor) {
		if (!(TargetColor instanceof Color)) {
			throw new TypeError("CopyColorTo expects a Color target.");
		}

		TargetColor.CopyColorFrom(this);

		return TargetColor;
	}

	CreateColorWithAlpha(dblAlpha = g_unMaximumColorComponent) {
		return new Color(this.Red, this.Green, this.Blue, dblAlpha);
	}

	DoesColorEqual(ColorLike) {
		const OtherColor = Color.CreateColorFromValue(ColorLike);
		for (let unComponentIndex = 0; unComponentIndex < g_vecComponentNames.length; unComponentIndex += 1) {
			if (this.GetColorChannel(unComponentIndex) !== OtherColor.GetColorChannel(unComponentIndex)) {
				return false;
			}
		}

		return true;
	}

	FreezeColor() {
		this.m_bFrozen = true;

		return Object.freeze(this);
	}

	ConvertColorToHexString() {
		const unAlphaComponent = this.Alpha;
		const strControlPrefix = (unAlphaComponent === g_unMaximumColorComponent) ? "\x07" : "\x08";
		const strAlphaHex = (unAlphaComponent === g_unMaximumColorComponent) ? "" : ConvertByteToHex(unAlphaComponent);

		return `${strControlPrefix}${ConvertByteToHex(this.Red)}${ConvertByteToHex(this.Green)}${ConvertByteToHex(this.Blue)}${strAlphaHex}`;
	}

	toString() {
		return this.ConvertColorToHexString();
	}

	*[Symbol.iterator]() {
		for (let unComponentIndex = 0; unComponentIndex < g_vecComponentNames.length; unComponentIndex += 1) {
			yield this.GetColorChannel(unComponentIndex);
		}
	}

	GetColorAddress() {
		return this.m_unAddress;
	}

	HasColorAddress() {
		return Boolean(this.m_unAddress) && !IsNull(this.m_unAddress);
	}

	GetColorChannel(unIndex) {
		if (!Number.isInteger(unIndex) || (unIndex < 0) || (unIndex >= g_vecComponentNames.length)) {
			throw new RangeError("Index out of range.");
		}

		if (this.HasColorAddress()) {
			return Read(this.m_unAddress, "uchar", BigInt(unIndex));
		}

		return this.m_vecValues[unIndex];
	}

	SetColorChannel(unIndex, dblComponent) {
		if (!Number.isInteger(unIndex) || (unIndex < 0) || (unIndex >= g_vecComponentNames.length)) {
			throw new RangeError("Index out of range.");
		}

		if (this.m_bFrozen) {
			throw new TypeError("Cannot mutate a frozen Color.");
		}

		const unNormalizedComponent = NormalizeColorComponent(dblComponent);
		if (this.HasColorAddress()) {
			Write(this.m_unAddress, "uchar", unNormalizedComponent, BigInt(unIndex));
		} else {
			this.m_vecValues[unIndex] = unNormalizedComponent;
		}

		return this;
	}

	get Red() {
		return this.GetColorChannel(0);
	}

	set Red(dblRedComponent) {
		this.SetColorChannel(0, dblRedComponent);
	}

	get Green() {
		return this.GetColorChannel(1);
	}

	set Green(dblGreenComponent) {
		this.SetColorChannel(1, dblGreenComponent);
	}

	get Blue() {
		return this.GetColorChannel(2);
	}

	set Blue(dblBlueComponent) {
		this.SetColorChannel(2, dblBlueComponent);
	}

	get Alpha() {
		return this.GetColorChannel(3);
	}

	set Alpha(dblAlphaComponent) {
		this.SetColorChannel(3, dblAlphaComponent);
	}

	static TYPE_SIZE = g_unColorSize;
}

function CreateFrozenColor(dblRed = 0, dblGreen = 0, dblBlue = 0, dblAlpha = g_unMaximumColorComponent) {
	return new Color(dblRed, dblGreen, dblBlue, dblAlpha).FreezeColor();
}

function CreateRGBAColor(unRed = g_unMaximumColorComponent, unGreen = g_unMaximumColorComponent, unBlue = g_unMaximumColorComponent, unAlpha = g_unMaximumColorComponent) {
	const NativeColor = g_ColorsRuntime.CreateRGBAColor(unRed, unGreen, unBlue, unAlpha);

	return new Color(NativeColor.Red, NativeColor.Green, NativeColor.Blue, NativeColor.Alpha);
}

const g_Red = CreateFrozenColor(0xFF, 0x00, 0x00);
const g_LightRed = CreateFrozenColor(0xFF, 0x50, 0x50);
const g_DarkRed = CreateFrozenColor(0x80, 0x00, 0x00);
const g_Orange = CreateFrozenColor(0xFF, 0xA5, 0x00);
const g_Yellow = CreateFrozenColor(0xFF, 0xFF, 0x00);
const g_Olive = CreateFrozenColor(0x80, 0x80, 0x00);
const g_Green = CreateFrozenColor(0x00, 0xFF, 0x00);
const g_LightGreen = CreateFrozenColor(0x80, 0xFF, 0x80);
const g_DarkGreen = CreateFrozenColor(0x00, 0x80, 0x00);
const g_Cyan = CreateFrozenColor(0x00, 0xFF, 0xFF);
const g_Blue = CreateFrozenColor(0x00, 0x00, 0xFF);
const g_LightBlue = CreateFrozenColor(0x80, 0x80, 0xFF);
const g_DarkBlue = CreateFrozenColor(0x00, 0x00, 0x80);
const g_Purple = CreateFrozenColor(0xFF, 0x00, 0xFF);
const g_Brown = CreateFrozenColor(0x8B, 0x45, 0x13);
const g_White = CreateFrozenColor(0xFF, 0xFF, 0xFF);
const g_Gray = CreateFrozenColor(0x80, 0x80, 0x80);
const g_LightGray = CreateFrozenColor(0xC0, 0xC0, 0xC0);
const g_DarkGray = CreateFrozenColor(0x40, 0x40, 0x40);
const g_Black = CreateFrozenColor();

RegisterObjectType("Color", Color, { Size: Color.TYPE_SIZE });

module.exports = {
	BLACK: g_Black,
	BLUE: g_Blue,
	BROWN: g_Brown,
	COLOR_SIZE: g_unColorSize,
	CYAN: g_Cyan,
	DARK_BLUE: g_DarkBlue,
	DARK_GRAY: g_DarkGray,
	DARK_GREEN: g_DarkGreen,
	DARK_RED: g_DarkRed,
	GRAY: g_Gray,
	GREEN: g_Green,
	LIGHT_BLUE: g_LightBlue,
	LIGHT_GRAY: g_LightGray,
	LIGHT_GREEN: g_LightGreen,
	LIGHT_RED: g_LightRed,
	OLIVE: g_Olive,
	ORANGE: g_Orange,
	PURPLE: g_Purple,
	RED: g_Red,
	WHITE: g_White,
	YELLOW: g_Yellow,
	Color: Color,
	CreateFrozenColor: CreateFrozenColor,
	CreateRGBAColor: CreateRGBAColor,
};
