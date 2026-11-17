"use strict";

const { NormalizeDescription, QuoteConfigValue, ResolveConfigText } = require("config/cvar");

class CommandConfigEntry {
	constructor(NameOrText, DescriptionOrLines = "", Options = {}) {
		const strResolvedName = ResolveConfigText(NameOrText);
		if ((strResolvedName.length === 0) || /\s/.test(strResolvedName)) {
			throw new TypeError("Config command name must be a non-empty string without spaces.");
		}

		if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
			throw new TypeError("CommandConfigEntry options must be an object.");
		}

		this.Name = strResolvedName;
		this.Description = NormalizeDescription(DescriptionOrLines);
		this.Arguments = Options.Arguments ?? [];
		this.WriteEmpty = Options.WriteEmpty ?? false;

		if (!Array.isArray(this.Arguments) || (typeof this.WriteEmpty !== "boolean")) {
			throw new TypeError("CommandConfigEntry Arguments must be an array and WriteEmpty must be a boolean.");
		}
	}

	RenderConfigEntry(ConfigurationManager, mapPreviousArguments = new Map()) {
		if ((ConfigurationManager === null) || (typeof ConfigurationManager !== "object") || Array.isArray(ConfigurationManager)) {
			throw new TypeError("Config render manager must be an object.");
		}

		const strCommentPrefix = ConfigurationManager.CommentPrefix;
		if (typeof strCommentPrefix !== "string") {
			throw new TypeError("Config manager comment prefix must be a string.");
		}

		const strArgumentLine = mapPreviousArguments.has(this.Name) ? mapPreviousArguments.get(this.Name) : this.ArgumentLine;
		const vecRenderedLines = [];
		for (const strDescriptionLine of this.Description) {
			vecRenderedLines.push(`${strCommentPrefix} ${strDescriptionLine}`);
		}

		if ((strArgumentLine.length > 0) || this.WriteEmpty) {
			vecRenderedLines.push(`${this.Name}${(strArgumentLine.length > 0) ? ` ${strArgumentLine}` : ""}`);
		}

		return vecRenderedLines;
	}

	get Key() {
		return this.Name;
	}

	get ArgumentLine() {
		const vecArguments = this.Arguments;
		if (!Array.isArray(vecArguments)) {
			throw new TypeError("Config command arguments must be an array.");
		}

		const unArgumentCount = vecArguments.length;
		if (!Number.isSafeInteger(unArgumentCount) || (unArgumentCount < 0)) {
			throw new TypeError("Config command arguments must be an array.");
		}

		const vecQuotedArguments = [];
		for (let unArgumentIndex = 0; unArgumentIndex < unArgumentCount; unArgumentIndex += 1) {
			if (!Object.prototype.hasOwnProperty.call(vecArguments, unArgumentIndex)) {
				throw new TypeError("Config command arguments must be a dense array.");
			}

			const strQuotedArgument = QuoteConfigValue(vecArguments[unArgumentIndex]);
			Object.defineProperty(vecQuotedArguments, unArgumentIndex, { value: strQuotedArgument, writable: true, enumerable: true, configurable: true });
		}

		return vecQuotedArguments.join(" ");
	}
}

function CreateCommandConfigEntry(NameOrText, DescriptionOrLines = "", Options = {}) {
	return new CommandConfigEntry(NameOrText, DescriptionOrLines, Options);
}

module.exports = Object.freeze({ CommandConfigEntry, CreateCommandConfigEntry });
