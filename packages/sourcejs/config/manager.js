"use strict";

const { GetModule } = require("internal/runtime");
const { ExecuteCommand } = require("commands");
const { SetConVar } = require("cvars");
const { CommandConfigEntry } = require("config/command");
const { CVarConfigEntry, FormatConfigValue, NormalizeDescription, QuoteConfigValue } = require("config/cvar");
const { ConfigSectionManager } = require("config/section");

const g_ConfigurationRuntime = GetModule("config");
const g_unMinimumConfigurationLineLength = 8;
const g_WindowsAbsolutePathPattern = /^[A-Za-z]:[\\/]/;

function NormalizePathSeparators(strFilePath) {
	if ((typeof strFilePath !== "string") || (strFilePath.length === 0)) {
		throw new TypeError("Config paths must be non-empty strings.");
	}

	return strFilePath.replace(/\\/g, "/");
}

function IsAbsolutePath(strFilePath) {
	return strFilePath.startsWith("/") || g_WindowsAbsolutePathPattern.test(strFilePath);
}

function JoinConfigurationPath(strRootPath, strFilePath) {
	const strNormalizedRootPath = NormalizePathSeparators(strRootPath).replace(/\/+$/, "");
	const strNormalizedFilePath = NormalizePathSeparators(strFilePath).replace(/^\/+/, "");

	return `${strNormalizedRootPath}/${strNormalizedFilePath}`;
}

function StripComment(strConfigurationLine) {
	if (typeof strConfigurationLine !== "string") {
		throw new TypeError("Config lines must be strings.");
	}

	let bInsideQuotedString = false;
	let bEscaped = false;
	for (let unCharacterIndex = 0; unCharacterIndex < strConfigurationLine.length; ++unCharacterIndex) {
		const strCharacter = strConfigurationLine[unCharacterIndex];
		if (bEscaped) {
			bEscaped = false;
			continue;
		}

		if (strCharacter === "\\") {
			bEscaped = true;
			continue;
		}

		if (strCharacter === "\"") {
			bInsideQuotedString = !bInsideQuotedString;
			continue;
		}

		if (!bInsideQuotedString && (strCharacter === "/") && (strConfigurationLine[unCharacterIndex + 1] === "/")) {
			return strConfigurationLine.slice(0, unCharacterIndex);
		}
	}

	return strConfigurationLine;
}

function TokenizeConfigurationLine(strConfigurationLine) {
	if (typeof strConfigurationLine !== "string") {
		throw new TypeError("Config lines must be strings.");
	}

	const vecTokens = [];
	let strCurrentToken = "";
	let bInsideQuotedString = false;
	let bEscaped = false;
	let bTokenStarted = false;
	for (const strCharacter of strConfigurationLine) {
		if (bEscaped) {
			strCurrentToken += strCharacter;
			bEscaped = false;
			bTokenStarted = true;
			continue;
		}

		if (strCharacter === "\\") {
			bEscaped = true;
			bTokenStarted = true;
			continue;
		}

		if (strCharacter === "\"") {
			bInsideQuotedString = !bInsideQuotedString;
			bTokenStarted = true;
			continue;
		}

		if (!bInsideQuotedString && /\s/.test(strCharacter)) {
			if (bTokenStarted) {
				vecTokens.push(strCurrentToken);
				strCurrentToken = "";
				bTokenStarted = false;
			}

			continue;
		}

		strCurrentToken += strCharacter;
		bTokenStarted = true;
	}

	if (bEscaped) {
		strCurrentToken += "\\";
	}

	if (bTokenStarted) {
		vecTokens.push(strCurrentToken);
	}

	return vecTokens;
}

function ResolveConfigPath(strFilePath, strRootPath = g_ConfigurationRuntime.Root) {
	if ((typeof strFilePath !== "string") || (strFilePath.length === 0)) {
		throw new TypeError("Config path must be a non-empty string.");
	}

	const strNormalizedFilePath = NormalizePathSeparators(strFilePath);
	const strConfigurationFilePath = strNormalizedFilePath.toLowerCase().endsWith(".cfg") ? strNormalizedFilePath : `${strNormalizedFilePath}.cfg`;

	return IsAbsolutePath(strConfigurationFilePath) ? strConfigurationFilePath : JoinConfigurationPath(strRootPath, strConfigurationFilePath);
}

function ParseConfigLine(strConfigurationLine) {
	if (typeof strConfigurationLine !== "string") {
		throw new TypeError("Config lines must be strings.");
	}

	const strNormalizedLine = StripComment(strConfigurationLine).trim();
	if (strNormalizedLine.length === 0) {
		return null;
	}

	const vecTokens = TokenizeConfigurationLine(strNormalizedLine);
	if (vecTokens.length === 0) {
		return null;
	}

	const vecArguments = vecTokens.slice(1);

	return {
		ArgumentLine: vecArguments.map(QuoteConfigValue).join(" "),
		Arguments: vecArguments,
		Line: strNormalizedLine,
		Name: vecTokens[0],
		Value: (vecArguments.length === 1) ? vecArguments[0] : vecArguments.join(" "),
	};
}

function ParseConfigText(strConfigurationText) {
	if (typeof strConfigurationText !== "string") {
		throw new TypeError("Config text must be a string.");
	}

	const vecConfigurationLines = strConfigurationText.split(/\r?\n/);
	const vecEntries = [];
	const mapValues = new Map();
	const mapArgumentLines = new Map();
	for (let unLineIndex = 0; unLineIndex < vecConfigurationLines.length; ++unLineIndex) {
		const ParsedLine = ParseConfigLine(vecConfigurationLines[unLineIndex]);
		if (!ParsedLine) {
			continue;
		}

		ParsedLine.LineIndex = unLineIndex;
		vecEntries.push(ParsedLine);
		mapValues.set(ParsedLine.Name, ParsedLine.Value);
		mapArgumentLines.set(ParsedLine.Name, ParsedLine.ArgumentLine);
	}

	return { ArgumentLines: mapArgumentLines, Entries: vecEntries, Values: mapValues };
}

function GetUnusedConfigEntries(vecEntries = [], setUsedNames = new Set()) {
	const IsUnusedEntry = (Entry) => !setUsedNames.has(Entry.Name);
	const CompareEntries = (LeftEntry, RightEntry) => LeftEntry.Name.localeCompare(RightEntry.Name) || LeftEntry.LineIndex - RightEntry.LineIndex;

	return Array.from(vecEntries).filter(IsUnusedEntry).sort(CompareEntries);
}

class ConfigTextEntry {
	constructor(Text = []) {
		this.Lines = NormalizeDescription(Text);
	}

	RenderConfigEntry() {
		return this.Lines.slice();
	}
}

class ConfigManager {
	constructor(strFilePath, Options = {}) {
		if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
			throw new TypeError("ConfigManager options must be an object.");
		}

		this.RootPath = Options.RootPath ?? g_ConfigurationRuntime.Root;
		this.CVarPrefix = Options.CVarPrefix ?? "";
		this.Indentation = Options.Indentation ?? 3;
		this.MaxLineLength = Options.MaxLineLength ?? 79;
		this.Encoding = Options.Encoding ?? "utf-8";
		this.CommentPrefix = Options.CommentPrefix ?? "//";
		this.SectionSeparator = Options.SectionSeparator ?? "/";
		this.PreserveUnused = Options.PreserveUnused ?? true;

		if (
			(typeof this.RootPath !== "string") || (this.RootPath.length === 0) ||
			(typeof this.CVarPrefix !== "string") ||
			!Number.isSafeInteger(this.Indentation) || (this.Indentation < 0) ||
			!Number.isSafeInteger(this.MaxLineLength) || (this.MaxLineLength < g_unMinimumConfigurationLineLength) ||
			(typeof this.Encoding !== "string") || (this.Encoding.length === 0) ||
			(typeof this.CommentPrefix !== "string") ||
			(typeof this.SectionSeparator !== "string") || (this.SectionSeparator.length === 0) ||
			(typeof this.PreserveUnused !== "boolean")
		) {
			throw new TypeError("ConfigManager options contain invalid values.");
		}

		this.FilePath = ResolveConfigPath(strFilePath, this.RootPath);
		this.Entries = [];
		this.HeaderLines = [];
	}

	ApplyCVarPrefix(strName) {
		if ((typeof strName !== "string") || (strName.length === 0)) {
			throw new TypeError("Config cvar names must be non-empty strings.");
		}

		return (!this.CVarPrefix || strName.startsWith(this.CVarPrefix)) ? strName : `${this.CVarPrefix}${strName}`;
	}

	AddCommandConfigEntry(NameOrText, Description = "", Options = {}) {
		const Entry = new CommandConfigEntry(NameOrText, Description, Options);
		this.Entries.push(Entry);

		return Entry;
	}

	AddCVarConfigEntry(strName, DefaultValue, Description = "", Options = {}) {
		const Entry = new CVarConfigEntry(this.ApplyCVarPrefix(strName), DefaultValue, Description, Options);
		this.Entries.push(Entry);

		return Entry;
	}

	AddConfigSection(Name, Options = {}) {
		const SectionOptions = { Separator: Options.Separator ?? this.SectionSeparator, Width: Options.Width ?? this.MaxLineLength };
		const Entry = new ConfigSectionManager(Name, SectionOptions);
		this.Entries.push(Entry);

		return Entry;
	}

	AddConfigTextEntry(Text = []) {
		const Entry = new ConfigTextEntry(Text);
		this.Entries.push(Entry);

		return Entry;
	}

	SetHeaderLines(HeaderText) {
		this.HeaderLines = NormalizeDescription(HeaderText);

		return this;
	}

	ReadConfigText() {
		return g_ConfigurationRuntime.ReadTextFile(this.FilePath);
	}

	RenderConfig() {
		const PreviousConfiguration = ParseConfigText(this.ReadConfigText() ?? "");
		const vecRenderedLines = [];
		const setUsedNames = new Set();

		for (const strHeaderLine of this.HeaderLines) {
			vecRenderedLines.push(`${this.CommentPrefix} ${strHeaderLine}`);
		}

		if ((vecRenderedLines.length > 0) && (this.Entries.length > 0)) {
			vecRenderedLines.push("");
		}

		for (const Entry of this.Entries) {
			const bTrackedConfigurationEntry = (Entry instanceof CommandConfigEntry) || (Entry instanceof CVarConfigEntry);
			if (bTrackedConfigurationEntry) {
				setUsedNames.add(Entry.Key);
			}

			const mapPreviousValues = (Entry instanceof CommandConfigEntry) ? PreviousConfiguration.ArgumentLines : PreviousConfiguration.Values;
			const vecEntryLines = Entry.RenderConfigEntry(this, mapPreviousValues);
			if (vecEntryLines.length === 0) {
				continue;
			}

			if ((vecRenderedLines.length > 0) && (vecRenderedLines.at(-1) !== "")) {
				vecRenderedLines.push("");
			}

			for (const strEntryLine of vecEntryLines) {
				vecRenderedLines.push(strEntryLine);
			}
		}

		if (this.PreserveUnused) {
			const vecUnusedEntries = GetUnusedConfigEntries(PreviousConfiguration.Entries, setUsedNames);
			if (vecUnusedEntries.length > 0) {
				if ((vecRenderedLines.length > 0) && (vecRenderedLines.at(-1) !== "")) {
					vecRenderedLines.push("");
				}

				for (const UnusedEntry of vecUnusedEntries) {
					vecRenderedLines.push(`${this.CommentPrefix} ${UnusedEntry.Line}`);
				}
			}
		}

		return `${vecRenderedLines.join("\n")}\n`;
	}

	WriteConfig() {
		const strConfigurationText = this.RenderConfig();
		if (!g_ConfigurationRuntime.WriteTextFile(this.FilePath, strConfigurationText)) {
			throw new Error(`Unable to write config file: ${this.FilePath}`);
		}

		return this.FilePath;
	}

	ExecuteConfig() {
		if (!g_ConfigurationRuntime.DoesFileExist(this.FilePath)) {
			this.WriteConfig();
		}

		const ConfigurationState = ParseConfigText(this.ReadConfigText() ?? "");
		const vecExecutionResults = [];
		for (const Entry of this.Entries) {
			if (Entry instanceof CVarConfigEntry) {
				const strValue = ConfigurationState.Values.has(Entry.Key) ? ConfigurationState.Values.get(Entry.Key) : FormatConfigValue(Entry.DefaultValue);
				const bSuccess = SetConVar(Entry.Key, strValue);
				vecExecutionResults.push({ Kind: "cvar", Name: Entry.Key, Value: strValue, Success: bSuccess });
				continue;
			}

			if (Entry instanceof CommandConfigEntry) {
				const strArgumentLine = ConfigurationState.ArgumentLines.has(Entry.Key) ? ConfigurationState.ArgumentLines.get(Entry.Key) : Entry.ArgumentLine;
				if ((strArgumentLine.length === 0) && !Entry.WriteEmpty) {
					continue;
				}

				const strCommand = `${Entry.Name}${(strArgumentLine.length > 0) ? ` ${strArgumentLine}` : ""}`;
				const bSuccess = ExecuteCommand(strCommand);
				vecExecutionResults.push({ Command: strCommand, Kind: "command", Name: Entry.Name, Success: bSuccess });
			}
		}

		return vecExecutionResults;
	}

	[Symbol.iterator]() {
		return this.Entries[Symbol.iterator]();
	}
}

module.exports = Object.freeze({
	ConfigManager,
	ConfigTextEntry,
	GetUnusedConfigEntries,
	ParseConfigLine,
	ParseConfigText,
	ResolveConfigPath,
});
