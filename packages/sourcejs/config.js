"use strict";

const { GetModule } = require("internal/runtime");
const { CommandConfigEntry, CreateCommandConfigEntry } = require("config/command");
const { ConfigManager, ConfigTextEntry, GetUnusedConfigEntries, ParseConfigLine, ParseConfigText, ResolveConfigPath } = require("config/manager");
const { CVarConfigEntry, CVarConfigListManager, CreateCVarConfigEntry, FormatConfigValue, NormalizeDescription, QuoteConfigValue, ResolveConfigText } = require("config/cvar");
const { ConfigSectionManager, CreateConfigSection } = require("config/section");

const g_ConfigurationRuntime = GetModule("config");

Object.assign(g_ConfigurationRuntime, {
	CommandConfigEntry,
	ConfigManager,
	ConfigSectionManager,
	ConfigTextEntry,
	CVarConfigEntry,
	CVarConfigListManager,
	CreateCommandConfigEntry,
	CreateConfigSection,
	CreateCVarConfigEntry,
	FormatConfigValue,
	GetUnusedConfigEntries,
	NormalizeDescription,
	ParseConfigLine,
	ParseConfigText,
	QuoteConfigValue,
	ResolveConfigPath,
	ResolveConfigText,
});

module.exports = g_ConfigurationRuntime;
