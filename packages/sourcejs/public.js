"use strict";

const g_PublicNameSymbol = Symbol.for("sourcejs.public.name");
const g_PublicNamesSymbol = Symbol.for("sourcejs.public.names");

function NormalizePublicOptions(PublicOptions) {
	if (PublicOptions === undefined) {
		return {};
	}

	if ((PublicOptions !== null) && (typeof PublicOptions === "object") && !Array.isArray(PublicOptions)) {
		return PublicOptions;
	}

	throw new TypeError("Public object options must be an object.");
}

function InferPublicName(PublicValue, PublicOptions) {
	if ((PublicValue === null) || ((typeof PublicValue !== "object") && (typeof PublicValue !== "function"))) {
		throw new TypeError("Public value must be an object or function.");
	}

	let strRequestedPublicName;

	if (Object.hasOwn(PublicOptions, "Name")) {
		strRequestedPublicName = PublicOptions.Name;
	} else {
		strRequestedPublicName = PublicValue.name;
	}

	if ((typeof strRequestedPublicName !== "string") || (strRequestedPublicName.length === 0)) {
		throw new TypeError("A public object must have a name or options.Name.");
	}

	const strPublicName = strRequestedPublicName.replace(/^_+/, "");
	if (strPublicName.length === 0) {
		throw new TypeError("A public object name must contain a character after leading underscores.");
	}

	return strPublicName;
}

function GetOrCreatePublicNames(ExportTarget) {
	if ((ExportTarget === null) || ((typeof ExportTarget !== "object") && (typeof ExportTarget !== "function"))) {
		throw new TypeError("Public export target must be an object or function.");
	}

	if (!Object.hasOwn(ExportTarget, g_PublicNamesSymbol)) {
		Object.defineProperty(ExportTarget, g_PublicNamesSymbol, { configurable: true, enumerable: false, value: [], writable: true });
	}

	const vecPublicNames = ExportTarget[g_PublicNamesSymbol];
	if (!Array.isArray(vecPublicNames)) {
		throw new TypeError("Public export names must be an array.");
	}

	return vecPublicNames;
}

function SetPublicName(PublicValue, strPublicName) {
	Object.defineProperty(PublicValue, g_PublicNameSymbol, { configurable: true, enumerable: false, value: strPublicName, writable: true });
}

function MarkPublic(PublicValue, PublicOptions = undefined) {
	const NormalizedPublicOptions = NormalizePublicOptions(PublicOptions);
	const strPublicName = InferPublicName(PublicValue, NormalizedPublicOptions);
	let ExportTarget;
	let vecPublicNames;

	if (Object.hasOwn(NormalizedPublicOptions, "Target")) {
		ExportTarget = NormalizedPublicOptions.Target;
	}

	if (ExportTarget !== undefined) {
		vecPublicNames = GetOrCreatePublicNames(ExportTarget);
	}

	SetPublicName(PublicValue, strPublicName);

	if (vecPublicNames !== undefined) {
		if (!vecPublicNames.includes(strPublicName)) {
			vecPublicNames.push(strPublicName);
		}
	}

	return PublicValue;
}

function GetExportedNames(ExportTarget) {
	// The established API creates missing export metadata and returns the live array.
	return GetOrCreatePublicNames(ExportTarget);
}

function IsPublic(PublicValue, ExportTarget = null) {
	if ((PublicValue === null) || ((typeof PublicValue !== "object") && (typeof PublicValue !== "function") && (typeof PublicValue !== "string"))) {
		return false;
	}

	if (ExportTarget !== null) {
		let strRequestedPublicName;

		if (typeof PublicValue === "string") {
			strRequestedPublicName = PublicValue;
		} else if (Object.hasOwn(PublicValue, g_PublicNameSymbol)) {
			strRequestedPublicName = PublicValue[g_PublicNameSymbol];
		} else {
			strRequestedPublicName = PublicValue.name;
		}

		if (typeof strRequestedPublicName !== "string") {
			return false;
		}

		const strPublicName = strRequestedPublicName.replace(/^_+/, "");

		return (strPublicName.length > 0) && GetExportedNames(ExportTarget).includes(strPublicName);
	}

	if ((typeof PublicValue === "string") || !Object.hasOwn(PublicValue, g_PublicNameSymbol)) {
		return false;
	}

	const strPublicName = PublicValue[g_PublicNameSymbol];

	return (typeof strPublicName === "string") && (strPublicName.length > 0);
}

module.exports = {
	PUBLIC_NAME: g_PublicNameSymbol,
	PUBLIC_NAMES: g_PublicNamesSymbol,
	GetExportedNames,
	IsPublic,
	MarkPublic,
};
