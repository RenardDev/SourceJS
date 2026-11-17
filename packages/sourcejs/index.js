"use strict";

const g_ModulePaths = Object.freeze({
	Auth: "auth",
	Autodoc: "autodoc",
	BitBuffers: "bitbuffers",
	Colors: "colors",
	Commands: "commands",
	Config: "config",
	Core: "core",
	CVars: "cvars",
	Effects: "effects",
	Engines: "engines",
	Entities: "entities",
	Events: "events",
	Extensions: "extensions",
	FileSystem: "filesystem",
	Filters: "filters",
	Globals: "globals",
	Interfaces: "interfaces",
	KeyValues: "keyvalues",
	Listeners: "listeners",
	Loggers: "loggers",
	MathLibrary: "mathlib",
	Memory: "memory",
	Menus: "menus",
	Messages: "messages",
	NetChannel: "netchannel",
	Paths: "paths",
	Physics: "physics",
	Players: "players",
	Plugins: "plugins",
	Public: "public",
	Settings: "settings",
	Steam: "steam",
	StringTables: "stringtables",
	Studio: "studio",
	Translations: "translations",
	Weapons: "weapons",
});

for (const [strModuleName, strModulePath] of Object.entries(g_ModulePaths)) {
	Object.defineProperty(module.exports, strModuleName, {
		configurable: false,
		enumerable: true,
		get() {
			return require(strModulePath);
		},
	});
}
