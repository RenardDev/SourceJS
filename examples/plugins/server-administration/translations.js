"use strict";

const { CreateTranslationCatalog } = require("translations/catalog");

const { Phrase, RenderPhrase, ResetTranslations, Translate } = CreateTranslationCatalog("server-administration");

class CommandError extends Error {
	constructor(Message, strDiagnostic = RenderPhrase(null, Message)) {
		super(strDiagnostic);
		this.Phrase = Message;
	}
}

function CommandFailure(strKey, strFallback, Tokens) {
	return new CommandError(Phrase(strKey, strFallback, Tokens));
}

function CommandUsage(strSyntax) {
	return new CommandError(Phrase("CommandUsage", "Usage: {Syntax}", { Syntax: strSyntax }));
}

function GetFailureMessage(Failure, Fallback) {
	if (Failure?.Phrase) {
		return Failure.Phrase;
	}

	return (unClientIndex) => {
		const strLocalized = RenderPhrase(unClientIndex, Fallback);

		return ((typeof Failure?.message === "string") && (strLocalized === RenderPhrase(null, Fallback))) ? Failure.message : strLocalized;
	};
}

function JoinPhrases(vecMessages, strSeparator = " ") {
	return (unClientIndex) => vecMessages.map((Message) => RenderPhrase(unClientIndex, Message)).join(strSeparator);
}

function LabelValue(strKey, Value, strEnglish) {
	return (unClientIndex) => {
		const strLabel = Translate(unClientIndex, strKey, "");
		if (!strLabel) {
			return strEnglish;
		}

		const ResolvedValue = (typeof Value === "function") ? Value(unClientIndex) : Value;

		return `${strLabel}: ${ResolvedValue}`;
	};
}

function LocalizedLabel(strKey, strFallback) {
	return (unClientIndex) => Translate(unClientIndex, strKey, strFallback);
}

function FormatBanDuration(unClientIndex, unMinutes, strFallback = "") {
	if (unMinutes === 0) {
		return Translate(unClientIndex, "Permanent", strFallback || "Permanent");
	}

	const strText = Translate(unClientIndex, "Minutes", "{Count} min", { Count: unMinutes });
	if (strFallback && (strText === `${unMinutes} min`)) {
		return strFallback;
	}

	return strText;
}

function FormatEffectResult(strKey, strName, unStarted, unStopped) {
	return (unClientIndex) => Translate(unClientIndex, "EffectToggled", "{Effect}: started {Started}, cancelled {Stopped}.", {
		Effect: Translate(unClientIndex, strKey, strName),
		Started: unStarted,
		Stopped: unStopped,
	});
}

module.exports = {
	Phrase,
	RenderPhrase,
	ResetTranslations,
	Translate,
	CommandError,
	CommandFailure,
	CommandUsage,
	GetFailureMessage,
	JoinPhrases,
	LabelValue,
	LocalizedLabel,
	FormatBanDuration,
	FormatEffectResult,
};
