"use strict";

function ResolveConfigText(ConfigurationValue) {
	if (ConfigurationValue && (typeof ConfigurationValue.GetTranslation === "function")) {
		const strTranslatedText = ConfigurationValue.GetTranslation();
		if (typeof strTranslatedText !== "string") {
			throw new TypeError("Translated config text must be a string.");
		}

		return strTranslatedText;
	}

	if (ConfigurationValue && (typeof ConfigurationValue.GetString === "function")) {
		const strTranslatedText = ConfigurationValue.GetString();
		if (typeof strTranslatedText !== "string") {
			throw new TypeError("Translated config text must be a string.");
		}

		return strTranslatedText;
	}

	if (typeof ConfigurationValue !== "string") {
		throw new TypeError("Config text must be a string or translation object.");
	}

	return ConfigurationValue;
}

function NormalizeDescription(ValueDescription) {
	if ((ValueDescription === null) || (ValueDescription === undefined) || (ValueDescription === "")) {
		return [];
	}

	if (Array.isArray(ValueDescription)) {
		const unDescriptionLineCount = ValueDescription.length;
		if (!Number.isSafeInteger(unDescriptionLineCount) || (unDescriptionLineCount < 0)) {
			throw new TypeError("Config description lines must be an array.");
		}

		const vecDescriptionLines = [];
		for (let unDescriptionLineIndex = 0; unDescriptionLineIndex < unDescriptionLineCount; unDescriptionLineIndex += 1) {
			if (!Object.prototype.hasOwnProperty.call(ValueDescription, unDescriptionLineIndex)) {
				throw new TypeError("Config description lines must form a dense array.");
			}

			const strDescriptionLine = ResolveConfigText(ValueDescription[unDescriptionLineIndex]);
			Object.defineProperty(vecDescriptionLines, unDescriptionLineIndex, { value: strDescriptionLine, writable: true, enumerable: true, configurable: true });
		}

		return vecDescriptionLines;
	}

	return ResolveConfigText(ValueDescription).split(/\r?\n/);
}

function FormatConfigValue(ConfigurationValue) {
	if ((ConfigurationValue === null) || (ConfigurationValue === undefined)) {
		return "";
	}

	if (typeof ConfigurationValue === "boolean") {
		return ConfigurationValue ? "1" : "0";
	}

	if (typeof ConfigurationValue === "string") {
		return ConfigurationValue;
	}

	if ((typeof ConfigurationValue === "number") && Number.isFinite(ConfigurationValue)) {
		return String(ConfigurationValue);
	}

	throw new TypeError("Config values must be strings, booleans, finite numbers, null or undefined.");
}

function QuoteConfigValue(ConfigurationValue) {
	const strConfigurationValue = FormatConfigValue(ConfigurationValue);

	return `"${strConfigurationValue.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

function FormatLimit(ValueLimit) {
	return ((ValueLimit === null) || (ValueLimit === undefined)) ? "unbounded" : FormatConfigValue(ValueLimit);
}

function ResolveConfigurationCommentPrefix(ConfigurationManager) {
	if ((ConfigurationManager === null) || (typeof ConfigurationManager !== "object") || Array.isArray(ConfigurationManager)) {
		throw new TypeError("Config render manager must be an object.");
	}

	const strCommentPrefix = ConfigurationManager.CommentPrefix;
	if (typeof strCommentPrefix !== "string") {
		throw new TypeError("Config manager comment prefix must be a string.");
	}

	return strCommentPrefix;
}

class CVarConfigListManager {
	constructor(Name, Options = {}) {
		if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
			throw new TypeError("CVarConfigListManager options must be an object.");
		}

		this.Name = ResolveConfigText(Name);
		this.ItemMarker = Options.ItemMarker ?? "  * ";
		this.Indent = Options.Indent ?? 9;
		this.Items = [];

		if ((typeof this.ItemMarker !== "string") || !Number.isSafeInteger(this.Indent) || (this.Indent < 0)) {
			throw new TypeError("CVarConfigListManager ItemMarker must be a string and Indent must be a non-negative safe integer.");
		}
	}

	AppendListItem(Text) {
		this.Items.push(ResolveConfigText(Text));

		return this;
	}

	ExtendListItems(vecLines = []) {
		if (!Array.isArray(vecLines)) {
			throw new TypeError("CVarConfigListManager.ExtendListItems expects an array.");
		}

		for (const Line of vecLines) {
			this.AppendListItem(Line);
		}

		return this;
	}

	RenderList(ConfigurationManager) {
		const strCommentPrefix = ResolveConfigurationCommentPrefix(ConfigurationManager);
		const vecRenderedLines = [`${strCommentPrefix} ${this.Name}`];
		for (const strItem of this.Items) {
			vecRenderedLines.push(`${strCommentPrefix} ${" ".repeat(Math.max(0, this.Indent))}${this.ItemMarker}${strItem}`);
		}

		return vecRenderedLines;
	}

	[Symbol.iterator]() {
		return this.Items[Symbol.iterator]();
	}
}

class CVarConfigEntry {
	constructor(strName, DefaultValue, Description = "", Options = {}) {
		if ((typeof strName !== "string") || (strName.length === 0) || /\s/.test(strName)) {
			throw new TypeError("Config cvar name must be a non-empty string without spaces.");
		}

		if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
			throw new TypeError("CVarConfigEntry options must be an object.");
		}

		this.Name = strName;
		this.DefaultValue = DefaultValue;
		this.Description = NormalizeDescription(Description);
		this.Flags = Options.Flags ?? null;
		this.Minimum = Options.ValueMinimum ?? null;
		this.Maximum = Options.ValueMaximum ?? null;
		this.ShowDefault = Options.ShowDefault ?? true;
		this.HelpEntries = [];
	}

	AddHelpText(HelpText = []) {
		for (const strHelpLine of NormalizeDescription(HelpText)) {
			this.HelpEntries.push(strHelpLine);
		}

		return this;
	}

	CreateHelpList(Name, Options = {}) {
		const ListManager = new CVarConfigListManager(Name, Options);
		this.HelpEntries.push(ListManager);

		return ListManager;
	}

	GetHelpLines(ConfigurationManager) {
		const strCommentPrefix = ResolveConfigurationCommentPrefix(ConfigurationManager);
		const vecRenderedLines = [];
		for (const ValueHelpEntry of this.HelpEntries) {
			if (ValueHelpEntry instanceof CVarConfigListManager) {
				for (const strHelpLine of ValueHelpEntry.RenderList(ConfigurationManager)) {
					vecRenderedLines.push(strHelpLine);
				}
			} else {
				vecRenderedLines.push(`${strCommentPrefix} ${ValueHelpEntry}`);
			}
		}

		return vecRenderedLines;
	}

	RenderConfigEntry(ConfigurationManager, mapPreviousValues = new Map()) {
		const strCommentPrefix = ResolveConfigurationCommentPrefix(ConfigurationManager);
		const ConfigurationValue = mapPreviousValues.has(this.Name) ? mapPreviousValues.get(this.Name) : this.DefaultValue;
		const vecRenderedLines = [];
		for (const strDescriptionLine of this.Description) {
			vecRenderedLines.push(`${strCommentPrefix} ${strDescriptionLine}`);
		}

		if (this.ShowDefault) {
			vecRenderedLines.push(`${strCommentPrefix} Default: ${FormatConfigValue(this.DefaultValue)}`);
		}

		if ((this.Minimum !== null) || (this.Maximum !== null)) {
			vecRenderedLines.push(`${strCommentPrefix} Range: ${FormatLimit(this.Minimum)} to ${FormatLimit(this.Maximum)}`);
		}

		if (this.Flags !== null) {
			vecRenderedLines.push(`${strCommentPrefix} Flags: ${this.Flags}`);
		}

		for (const strHelpLine of this.GetHelpLines(ConfigurationManager)) {
			vecRenderedLines.push(strHelpLine);
		}

		vecRenderedLines.push(`${this.Name} ${QuoteConfigValue(ConfigurationValue)}`);

		return vecRenderedLines;
	}

	get Key() {
		return this.Name;
	}
}

function CreateCVarConfigEntry(strName, DefaultValue, Description = "", Options = {}) {
	return new CVarConfigEntry(strName, DefaultValue, Description, Options);
}

module.exports = Object.freeze({
	CVarConfigEntry,
	CVarConfigListManager,
	CreateCVarConfigEntry,
	FormatConfigValue,
	NormalizeDescription,
	QuoteConfigValue,
	ResolveConfigText,
});
