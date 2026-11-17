"use strict";

function GetSourceJS() {
	const SourceJS = globalThis.sourcejs;
	if ((SourceJS === null) || (typeof SourceJS !== "object") || Array.isArray(SourceJS)) {
		throw new Error("SourceJS native runtime is not installed.");
	}

	return SourceJS;
}

function GetModule(strModuleName) {
	if ((typeof strModuleName !== "string") || (strModuleName.length === 0)) {
		throw new TypeError("GetModule(strModuleName) expects a non-empty module name.");
	}

	const SourceJS = GetSourceJS();
	if (!Object.hasOwn(SourceJS, strModuleName)) {
		throw new Error(`SourceJS module is not installed: ${strModuleName}`);
	}

	const SourceJSModule = SourceJS[strModuleName];
	if ((SourceJSModule === null) || (typeof SourceJSModule !== "object") || Array.isArray(SourceJSModule)) {
		throw new Error(`SourceJS module is not installed: ${strModuleName}`);
	}

	return SourceJSModule;
}

function GetRawModule(strModuleName) {
	if ((typeof strModuleName !== "string") || (strModuleName.length === 0)) {
		throw new TypeError("GetRawModule(strModuleName) expects a non-empty module name.");
	}

	const SourceJS = GetSourceJS();
	if (!Object.hasOwn(SourceJS, strModuleName)) {
		throw new Error(`SourceJS module is not installed: ${strModuleName}`);
	}

	return SourceJS[strModuleName];
}

function ListModules() {
	return Object.keys(GetSourceJS()).sort();
}

module.exports = { GetModule, GetRawModule, GetSourceJS, ListModules };
