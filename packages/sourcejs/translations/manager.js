"use strict";

const {
	GetDefaultLanguage,
	GetFallbackLanguage,
	GetLanguage,
	GetLanguages,
	SetDefaultLanguage,
} = require("translations");

class LanguageManager {
	GetLanguage(strLanguageName) {
		return GetLanguage(strLanguageName);
	}

	Has(strLanguageName) {
		return this.GetLanguage(strLanguageName) !== null;
	}

	get Aliases() {
		return GetLanguages().Languages;
	}

	get DefaultLanguage() {
		return GetDefaultLanguage();
	}

	set DefaultLanguage(strLanguage) {
		SetDefaultLanguage(strLanguage);
	}

	get FallbackLanguage() {
		return GetFallbackLanguage();
	}
}

const g_LanguageManager = new LanguageManager();

module.exports = { LANGUAGE_MANAGER: g_LanguageManager, LanguageManager };
