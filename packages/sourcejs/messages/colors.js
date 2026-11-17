"use strict";

const { GetModule } = require("internal/runtime");

const g_MessageColorsRuntime = GetModule("messages/colors");

function RequireColorCode(strColorCode, strValueName) {
	if ((typeof strColorCode !== "string") || (strColorCode.length === 0)) {
		throw new TypeError(`${strValueName} requires a non-empty string.`);
	}

	return strColorCode;
}

class MessageColor {
	constructor(strColorCode) {
		this.ColorCode = RequireColorCode(strColorCode, "MessageColor.ColorCode");
	}

	ColorizeMessageText(strMessageText) {
		const strMessage = RequireColorCode(strMessageText, "MessageColor.ColorizeMessageText(strMessageText)");
		const strNormalColorCode = RequireColorCode(g_MessageColorsRuntime.NORMAL, "messages/colors NORMAL");

		return `${this.ColorCode}${strMessage}${strNormalColorCode}`;
	}

	toString() {
		return RequireColorCode(this.ColorCode, "MessageColor.ColorCode");
	}
}

function ColorizeMessageText(strMessageText, MessageColorValue = g_MessageColorsRuntime.NORMAL) {
	const strMessage = RequireColorCode(strMessageText, "ColorizeMessageText(strMessageText)");
	const strColorCode = (MessageColorValue instanceof MessageColor) ? MessageColorValue.ColorCode : MessageColorValue;
	const strValidatedColorCode = RequireColorCode(strColorCode, "ColorizeMessageText(MessageColorValue)");
	const strNormalColorCode = RequireColorCode(g_MessageColorsRuntime.NORMAL, "messages/colors NORMAL");

	return `${strValidatedColorCode}${strMessage}${strNormalColorCode}`;
}

function StripMessageColorCodes(strMessageText) {
	if (typeof strMessageText !== "string") {
		throw new TypeError("StripMessageColorCodes(strMessageText) requires a string.");
	}

	return strMessageText.replace(/[\x01-\x06]/g, "");
}

Object.assign(g_MessageColorsRuntime, { MessageColor: MessageColor, ColorizeMessageText: ColorizeMessageText, StripMessageColorCodes: StripMessageColorCodes });

module.exports = g_MessageColorsRuntime;
