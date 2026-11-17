"use strict";

const { ResolveConfigText } = require("config/cvar");

const g_unMinimumSectionWidth = 8;

class ConfigSectionManager {
	constructor(Name, Options = {}) {
		if ((Options === null) || (typeof Options !== "object") || Array.isArray(Options)) {
			throw new TypeError("ConfigSectionManager options must be an object.");
		}

		const strResolvedName = ResolveConfigText(Name);
		const strSeparator = Options.Separator ?? "-";
		const unSectionWidth = Options.Width ?? 79;
		if ((strResolvedName.length === 0) || (typeof strSeparator !== "string") || (strSeparator.length === 0) || !Number.isSafeInteger(unSectionWidth) || (unSectionWidth < g_unMinimumSectionWidth)) {
			throw new TypeError(`ConfigSectionManager requires a non-empty name and separator with a safe width of at least ${g_unMinimumSectionWidth}.`);
		}

		this.Name = strResolvedName;
		this.Separator = strSeparator;
		this.Width = unSectionWidth;
	}

	RenderConfigEntry(ConfigurationManager = null) {
		if ((ConfigurationManager !== null) && ((typeof ConfigurationManager !== "object") || Array.isArray(ConfigurationManager))) {
			throw new TypeError("ConfigSectionManager render manager must be an object or null.");
		}

		const strCommentPrefix = (ConfigurationManager === null) ? "//" : ConfigurationManager.CommentPrefix;
		if (typeof strCommentPrefix !== "string") {
			throw new TypeError("Config manager comment prefix must be a string.");
		}

		const strSeparatorLine = this.Separator.repeat(this.Width);

		return [
			`${strCommentPrefix} ${strSeparatorLine}`,
			`${strCommentPrefix} ${this.Name}`,
			`${strCommentPrefix} ${strSeparatorLine}`,
		];
	}
}

function CreateConfigSection(Name, Options = {}) {
	return new ConfigSectionManager(Name, Options);
}

module.exports = Object.freeze({ ConfigSectionManager, CreateConfigSection });
