"use strict";

const { ReadTextFile } = require("filesystem");
const { TRANSLATION_ROOT } = require("paths");
const { GetClientLanguage } = require("players/language");
const { GetDefaultLanguage } = require("translations");

const g_LanguageNames = Object.freeze({
	arabic: "ar",
	bulgarian: "bg",
	schinese: "zh-cn",
	czech: "cs",
	danish: "da",
	german: "de",
	greek: "el",
	english: "en",
	spanish: "es",
	latam: "es-419",
	finnish: "fi",
	french: "fr",
	hungarian: "hu",
	indonesian: "id",
	italian: "it",
	japanese: "ja",
	korean: "ko",
	koreana: "ko",
	dutch: "nl",
	malay: "ms",
	norwegian: "no",
	polish: "pl",
	brazilian: "pt-br",
	portuguese: "pt",
	romanian: "ro",
	russian: "ru",
	swedish: "sv",
	thai: "th",
	turkish: "tr",
	ukrainian: "uk",
	vietnamese: "vi",
	tchinese: "zh-tw",
	nb: "no",
	nn: "no",
	ptbr: "pt-br",
	ptpt: "pt",
	es419: "es-419",
	zhcn: "zh-cn",
	zhhans: "zh-cn",
	zhhant: "zh-tw",
	zhhk: "zh-tw",
	zhtw: "zh-tw",
});
const g_setLanguages = new Set(Object.values(g_LanguageNames));

function ReadCatalog(strRoot, strLanguage, strSuffix = "") {
	try {
		const strContents = ReadTextFile(`${strRoot}/${strLanguage}${strSuffix}.json`);
		const Catalog = JSON.parse(strContents);

		return (Catalog && (typeof Catalog === "object") && !Array.isArray(Catalog)) ? Catalog : {};
	} catch {
		// Missing or invalid data falls back without stopping plugin startup.
		return {};
	}
}

function ResolveLanguage(strLanguage) {
	if (typeof strLanguage !== "string") {
		return null;
	}

	const strName = strLanguage.trim().toLowerCase();
	const strAlias = strName.replace(/[-_]/g, "");
	const strCode = Object.hasOwn(g_LanguageNames, strAlias) ? g_LanguageNames[strAlias] : strName.replaceAll("_", "-");
	if (g_setLanguages.has(strCode)) {
		return strCode;
	}

	const [strBaseCode] = strCode.split("-");

	return g_setLanguages.has(strBaseCode) ? strBaseCode : null;
}

function ResolveClientLanguage(unClientIndex) {
	if (unClientIndex > 0) {
		try {
			return ResolveLanguage(GetClientLanguage(unClientIndex));
		} catch {
			// A client may disconnect or not have reported a language yet.
		}
	}

	return null;
}

function Phrase(strKey, strFallback, Tokens = {}) {
	return { Key: strKey, Fallback: strFallback, Tokens };
}

function HasMatchingTokens(strText, strFallback) {
	const ReadTokenNames = (strTemplate) => [...new Set([...strTemplate.matchAll(/\{(\w+)\}/g)].map((Match) => Match[1]))].sort().join(",");

	return ReadTokenNames(strText) === ReadTokenNames(strFallback);
}

function FormatPhrase(strTemplate, Tokens) {
	return strTemplate.replace(/\{(\w+)\}/g, (strMatch, strToken) => Object.hasOwn(Tokens, strToken) ? String(Tokens[strToken]) : strMatch);
}

function RenderEnglish(Message) {
	if (typeof Message === "string") {
		return Message;
	}

	if (typeof Message === "function") {
		return Message(null);
	}

	return FormatPhrase(Message.Fallback, Message.Tokens);
}

function CreateTranslationCatalog(strDirectory) {
	if ((typeof strDirectory !== "string") || !/^[a-z][a-z0-9-]*$/.test(strDirectory)) {
		throw new TypeError("Translation catalog requires a plugin directory name.");
	}

	const strRoot = `${TRANSLATION_ROOT}/${strDirectory}`;
	const mapCatalogs = new Map();
	let strDefaultLanguage = null;

	function ReadCachedCatalog(strLanguage) {
		if (!mapCatalogs.has(strLanguage)) {
			mapCatalogs.set(strLanguage, { Base: ReadCatalog(strRoot, strLanguage), Override: ReadCatalog(strRoot, strLanguage, ".server") });
		}

		return mapCatalogs.get(strLanguage);
	}

	function ResolveServerLanguage() {
		if (strDefaultLanguage === null) {
			try {
				strDefaultLanguage = ResolveLanguage(GetDefaultLanguage()) ?? "en";
			} catch {
				strDefaultLanguage = "en";
			}
		}

		return strDefaultLanguage;
	}

	function RenderPhrase(unClientIndex, Message) {
		if (unClientIndex === null) {
			return RenderEnglish(Message);
		}

		if (typeof Message === "string") {
			return Message;
		}

		if (typeof Message === "function") {
			return Message(unClientIndex);
		}

		const { Key: strKey, Fallback: strFallback, Tokens } = Message;
		let strTemplate = strFallback;

		for (const strLanguage of new Set([ResolveClientLanguage(unClientIndex), ResolveServerLanguage(), "en"])) {
			if (strLanguage === null) {
				continue;
			}

			const { Base, Override } = ReadCachedCatalog(strLanguage);
			const vecTexts = (strLanguage === "en") ? [Override[strKey]] : [Override[strKey], Base[strKey]];
			const strText = vecTexts.find((Candidate) => (typeof Candidate === "string") && Candidate.trim() && !/[\x00-\x1F\x7F]/.test(Candidate) && HasMatchingTokens(Candidate, strFallback));
			if (strText !== undefined) {
				strTemplate = strText;
				break;
			}

			if (strLanguage === "en") {
				break;
			}
		}

		return FormatPhrase(strTemplate, Tokens);
	}

	function ResetTranslations() {
		mapCatalogs.clear();
		strDefaultLanguage = null;
	}

	function Translate(unClientIndex, strKey, strFallback, Tokens) {
		return RenderPhrase(unClientIndex, Phrase(strKey, strFallback, Tokens));
	}

	return { Phrase, RenderPhrase, ResetTranslations, Translate };
}

module.exports = { RenderEnglish, CreateTranslationCatalog };
