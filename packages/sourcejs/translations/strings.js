"use strict";

const {
	GetPhrase,
	GetPhraseKeys,
	GetText,
	HasPhrase,
	LoadFile,
} = require("translations");

class TranslationStrings {
	constructor(strFile, strKey, Tokens = {}) {
		const TranslationRecord = GetPhrase(strFile, strKey);
		if (!TranslationRecord) {
			throw new Error(`Translation key not found: ${strKey}`);
		}

		if (!Tokens || (typeof Tokens !== "object") || Array.isArray(Tokens)) {
			throw new TypeError("TranslationStrings Tokens must be an object.");
		}

		this.File = strFile;
		this.Key = strKey;
		this.Tokens = Tokens;
	}

	Entries() {
		return Object.entries(this.Languages);
	}

	GetString(strLanguage = undefined, Tokens = {}) {
		if (!Tokens || (typeof Tokens !== "object") || Array.isArray(Tokens)) {
			throw new TypeError("TranslationStrings.GetString() Tokens must be an object.");
		}

		const MergedTokens = { ...this.Tokens, ...Tokens };

		return GetText(this.File, this.Key, strLanguage, MergedTokens);
	}

	Has(strLanguage = undefined) {
		return HasPhrase(this.File, this.Key, strLanguage);
	}

	Keys() {
		return Object.keys(this.Languages);
	}

	Tokenized(Tokens) {
		if (!Tokens || (typeof Tokens !== "object") || Array.isArray(Tokens)) {
			throw new TypeError("TranslationStrings.Tokenized() Tokens must be an object.");
		}

		const MergedTokens = { ...this.Tokens, ...Tokens };

		return new TranslationStrings(this.File, this.Key, MergedTokens);
	}

	Values() {
		return Object.values(this.Languages);
	}

	[Symbol.iterator]() {
		return this.Entries()[Symbol.iterator]();
	}

	get DefaultLanguage() {
		return this.Record.DefaultLanguage;
	}

	get Languages() {
		return this.Record.Languages;
	}

	get Name() {
		return this.Record.Name;
	}

	get Record() {
		const TranslationRecord = GetPhrase(this.File, this.Key);
		if (!TranslationRecord) {
			throw new Error(`Translation key not found: ${this.Key}`);
		}

		return TranslationRecord;
	}

	get Size() {
		return Object.keys(this.Languages).length;
	}
}

class LangStrings {
	constructor(strFile) {
		LoadFile(strFile);
		this.File = strFile;
	}

	Entries() {
		const vecEntries = [];
		for (const strKey of this.Keys()) {
			vecEntries.push([strKey, new TranslationStrings(this.File, strKey)]);
		}

		return vecEntries;
	}

	ForEach(Callback, ThisArgument = undefined) {
		if (typeof Callback !== "function") {
			throw new TypeError("LangStrings.ForEach() Callback must be a function.");
		}

		for (const vecTranslationEntry of this.Entries()) {
			const strKey = vecTranslationEntry[0];
			const Strings = vecTranslationEntry[1];
			Reflect.apply(Callback, ThisArgument, [Strings, strKey, this]);
		}
	}

	Get(strKey) {
		return this.Has(strKey) ? new TranslationStrings(this.File, strKey) : null;
	}

	GetString(strKey, strLanguage = undefined, Tokens = {}) {
		return GetText(this.File, strKey, strLanguage, Tokens);
	}

	Has(strKey, strLanguage = undefined) {
		return HasPhrase(this.File, strKey, strLanguage);
	}

	Keys() {
		return GetPhraseKeys(this.File);
	}

	Values() {
		const vecValues = [];
		for (const strKey of this.Keys()) {
			vecValues.push(new TranslationStrings(this.File, strKey));
		}

		return vecValues;
	}

	[Symbol.iterator]() {
		return this.Entries()[Symbol.iterator]();
	}

	// The established property invokes LoadFile on every access, rather than caching a record.
	get Data() {
		return LoadFile(this.File);
	}

	get DefaultLanguage() {
		return this.Data.DefaultLanguage;
	}

	get Name() {
		return this.Data.Name;
	}

	get Path() {
		return this.Data.Path;
	}

	get ServerPath() {
		return this.Data.ServerPath;
	}

	get Size() {
		return this.Keys().length;
	}
}

module.exports = { LangStrings, TranslationStrings };
