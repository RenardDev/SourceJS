"use strict";

const { GetModule } = require("internal/runtime");
const g_SayText2ColorsRuntime = GetModule("messages/colors/saytext2");

function RequireSayText2ColorCode(strColorCode, strValueName) {
	if ((typeof strColorCode !== "string") || (strColorCode.length === 0)) {
		throw new TypeError(`${strValueName} requires a non-empty string.`);
	}

	return strColorCode;
}

function ColorizeSayText2MessageText(strColorCode, strMessageText) {
	if (typeof strMessageText !== "string") {
		throw new TypeError("ColorizeSayText2MessageText(strColorCode, strMessageText) requires a string message.");
	}

	const strValidatedColorCode = RequireSayText2ColorCode(strColorCode, "ColorizeSayText2MessageText(strColorCode, strMessageText)");
	const strWhiteColorCode = RequireSayText2ColorCode(g_SayText2ColorsRuntime.WHITE, "messages/colors/saytext2 WHITE");

	return `${strValidatedColorCode}${strMessageText}${strWhiteColorCode}`;
}

function StripSayText2ColorCodes(strMessageText) {
	if (typeof strMessageText !== "string") {
		throw new TypeError("StripSayText2ColorCodes(strMessageText) requires a string.");
	}

	return strMessageText.replace(/[\x01-\x10]/g, "");
}

Object.assign(g_SayText2ColorsRuntime, { ColorizeSayText2MessageText: ColorizeSayText2MessageText, StripSayText2ColorCodes: StripSayText2ColorCodes });

module.exports = g_SayText2ColorsRuntime;
