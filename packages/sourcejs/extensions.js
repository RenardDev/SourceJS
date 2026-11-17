"use strict";

const { GetModule } = require("internal/runtime");

const g_NativeExtensions = GetModule("extensions");

function GetNativeFunction(strNativeName) {
	const NativeFunction = g_NativeExtensions[strNativeName];
	if (typeof NativeFunction !== "function") {
		throw new TypeError(`Native extensions module does not expose ${strNativeName}.`);
	}

	return NativeFunction.bind(g_NativeExtensions);
}

const g_DisableExtension = GetNativeFunction("Disable");
const g_EnableExtension = GetNativeFunction("Enable");
const g_GetLoadedExtensions = GetNativeFunction("List");
const g_LoadExtension = GetNativeFunction("Load");
const g_ReloadAllExtensions = GetNativeFunction("ReloadAll");
const g_ReloadExtension = GetNativeFunction("Reload");
const g_UnloadAllExtensions = GetNativeFunction("UnloadAll");
const g_UnloadExtension = GetNativeFunction("Unload");

const g_ExtensionsAPI = {
	DisableExtension: g_DisableExtension,
	EnableExtension: g_EnableExtension,
	GetLoadedExtensions: g_GetLoadedExtensions,
	LoadExtension: g_LoadExtension,
	ReloadAllExtensions: g_ReloadAllExtensions,
	ReloadExtension: g_ReloadExtension,
	UnloadAllExtensions: g_UnloadAllExtensions,
	UnloadExtension: g_UnloadExtension,
};

module.exports = g_ExtensionsAPI;
