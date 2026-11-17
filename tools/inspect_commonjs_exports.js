function MaskJavaScriptNonCode(strSourceText) {
	const vecCodeCharacters = strSourceText.split("");
	const setRegularExpressionPrefixWords = new Set([
		"await",
		"case",
		"delete",
		"do",
		"else",
		"in",
		"instanceof",
		"return",
		"throw",
		"typeof",
		"void",
		"yield",
	]);
	const setControlHeaderWords = new Set([
		"catch",
		"for",
		"if",
		"switch",
		"while",
		"with",
	]);
	const vecParenthesisContexts = [];
	const vecTemplateContexts = [];
	let strPreviousToken = "";
	let unSourceIndex = 0;

	const MaskRange = (unStartIndex, unEndIndex) => {
		for (let unMaskIndex = unStartIndex; unMaskIndex < unEndIndex; unMaskIndex += 1) {
			if ((vecCodeCharacters[unMaskIndex] !== "\n") && (vecCodeCharacters[unMaskIndex] !== "\r")) {
				vecCodeCharacters[unMaskIndex] = " ";
			}
		}
	};

	while (unSourceIndex < strSourceText.length) {
		const chCharacter = strSourceText[unSourceIndex];
		const chNextCharacter = strSourceText[unSourceIndex + 1];
		const TemplateContext = vecTemplateContexts[vecTemplateContexts.length - 1];
		if (TemplateContext && TemplateContext.bText) {
			const unTemplateTokenStart = unSourceIndex;
			unSourceIndex += 1;

			if (chCharacter === "\\") {
				unSourceIndex = Math.min(unSourceIndex + 1, strSourceText.length);

			} else if (chCharacter === "`") {
				vecTemplateContexts.pop();
				vecParenthesisContexts.length = TemplateContext.unParenthesisDepth;
				strPreviousToken = "Literal";

			} else if ((chCharacter === "$") && (chNextCharacter === "{")) {
				TemplateContext.bText = false;
				TemplateContext.unBraceDepth = 0;
				strPreviousToken = "";
				unSourceIndex += 1;
			}

			MaskRange(unTemplateTokenStart, unSourceIndex);
			continue;
		}

		if (/\s/.test(chCharacter)) {
			unSourceIndex += 1;
			continue;
		}

		const unTokenStart = unSourceIndex;
		if ((chCharacter === "/") && (chNextCharacter === "/")) {
			unSourceIndex += 2;
			while ((unSourceIndex < strSourceText.length) && (strSourceText[unSourceIndex] !== "\n") && (strSourceText[unSourceIndex] !== "\r")) {
				unSourceIndex += 1;
			}

			MaskRange(unTokenStart, unSourceIndex);
			continue;
		}

		if ((chCharacter === "/") && (chNextCharacter === "*")) {
			unSourceIndex += 2;
			while ((unSourceIndex < strSourceText.length) && !((strSourceText[unSourceIndex] === "*") && (strSourceText[unSourceIndex + 1] === "/"))) {
				unSourceIndex += 1;
			}

			unSourceIndex = Math.min(unSourceIndex + 2, strSourceText.length);
			MaskRange(unTokenStart, unSourceIndex);
			continue;
		}

		// Template literals are opaque inventory data, including nested interpolations.
		if (chCharacter === "`") {
			vecTemplateContexts.push({ bText: true, unBraceDepth: 0, unParenthesisDepth: vecParenthesisContexts.length });
			unSourceIndex += 1;
			MaskRange(unTokenStart, unSourceIndex);
			continue;
		}

		if ((chCharacter === "\"") || (chCharacter === "'")) {
			unSourceIndex += 1;
			while (unSourceIndex < strSourceText.length) {
				const chLiteralCharacter = strSourceText[unSourceIndex];
				unSourceIndex += 1;

				if (chLiteralCharacter === "\\") {
					unSourceIndex = Math.min(unSourceIndex + 1, strSourceText.length);
					continue;
				}

				if (chLiteralCharacter === chCharacter) {
					break;
				}
			}

			MaskRange(unTokenStart, unSourceIndex);
			strPreviousToken = "Literal";
			continue;
		}

		const bRegularExpressionPrefix = (strPreviousToken === "") || (strPreviousToken === "ControlHeader") || setRegularExpressionPrefixWords.has(strPreviousToken) || /^[({[=,:;!?&|+*%~^<>-]$/.test(strPreviousToken);
		if ((chCharacter === "/") && bRegularExpressionPrefix) {
			let bCharacterClass = false;
			let bClosedRegularExpression = false;
			unSourceIndex += 1;
			while (unSourceIndex < strSourceText.length) {
				const chRegularExpressionCharacter = strSourceText[unSourceIndex];
				if ((chRegularExpressionCharacter === "\n") || (chRegularExpressionCharacter === "\r")) {
					break;
				}

				unSourceIndex += 1;

				if (chRegularExpressionCharacter === "\\") {
					unSourceIndex = Math.min(unSourceIndex + 1, strSourceText.length);
					continue;
				}

				if (chRegularExpressionCharacter === "[") {
					bCharacterClass = true;

				} else if (chRegularExpressionCharacter === "]") {
					bCharacterClass = false;

				} else if ((chRegularExpressionCharacter === "/") && !bCharacterClass) {
					bClosedRegularExpression = true;

					while ((unSourceIndex < strSourceText.length) && /[A-Za-z]/.test(strSourceText[unSourceIndex])) {
						unSourceIndex += 1;
					}

					break;
				}
			}

			if (bClosedRegularExpression) {
				MaskRange(unTokenStart, unSourceIndex);
				strPreviousToken = "Literal";
				continue;
			}

			unSourceIndex = unTokenStart;
		}

		if (/[A-Za-z0-9_$]/.test(chCharacter)) {
			unSourceIndex += 1;
			while ((unSourceIndex < strSourceText.length) && /[A-Za-z0-9_$]/.test(strSourceText[unSourceIndex])) {
				unSourceIndex += 1;
			}

			strPreviousToken = (strPreviousToken === ".") ? "Identifier" : strSourceText.slice(unTokenStart, unSourceIndex);

			if (TemplateContext) {
				MaskRange(unTokenStart, unSourceIndex);
			}

			continue;
		}

		if (chCharacter === "(") {
			vecParenthesisContexts.push(setControlHeaderWords.has(strPreviousToken));

		} else if (chCharacter === ")") {
			const bControlHeader = vecParenthesisContexts.pop() === true;
			strPreviousToken = bControlHeader ? "ControlHeader" : ")";
			unSourceIndex += 1;

			if (TemplateContext) {
				MaskRange(unTokenStart, unSourceIndex);
			}

			continue;
		}

		if (TemplateContext) {
			MaskRange(unTokenStart, unSourceIndex + 1);

			if (chCharacter === "{") {
				TemplateContext.unBraceDepth += 1;

			} else if (chCharacter === "}") {
				if (TemplateContext.unBraceDepth === 0) {
					TemplateContext.bText = true;
					vecParenthesisContexts.length = TemplateContext.unParenthesisDepth;

				} else {
					TemplateContext.unBraceDepth -= 1;
				}
			}
		}

		strPreviousToken = chCharacter;
		unSourceIndex += 1;
	}

	return vecCodeCharacters.join("");
}

function GetJavaScriptBracedRange(strSourceCode, unOpeningBraceIndex) {
	if (strSourceCode[unOpeningBraceIndex] !== "{") {
		return null;
	}

	let unBraceDepth = 1;
	for (let unCodeIndex = unOpeningBraceIndex + 1; unCodeIndex < strSourceCode.length; unCodeIndex += 1) {
		const chCodeCharacter = strSourceCode[unCodeIndex];
		if (chCodeCharacter === "{") {
			unBraceDepth += 1;

		} else if (chCodeCharacter === "}") {
			unBraceDepth -= 1;
			if (unBraceDepth === 0) {
				return { Start: unOpeningBraceIndex + 1, End: unCodeIndex };
			}
		}
	}

	return null;
}

function GetCJSObjectExportNames(strExportBlock) {
	const vecExportNames = [];
	const strExportCode = MaskJavaScriptNonCode(strExportBlock);
	const ExportNamePattern = /(?:^|(?<=[,}]))[\t ]*(?:(?:async|get|set)[\t ]+)?(?:\*[\t ]*)?([A-Za-z_$][A-Za-z0-9_$]*)[\t ]*(?=[:,(]|$)/gm;
	let unCodeIndex = 0;
	let nBraceDepth = 0;
	let nParenthesisDepth = 0;
	let nBracketDepth = 0;
	let vecExportNameMatch = null;

	while ((vecExportNameMatch = ExportNamePattern.exec(strExportCode)) !== null) {
		while (unCodeIndex < vecExportNameMatch.index) {
			const chCodeCharacter = strExportCode[unCodeIndex];
			nBraceDepth += (chCodeCharacter === "{") ? 1 : ((chCodeCharacter === "}") ? -1 : 0);
			nParenthesisDepth += (chCodeCharacter === "(") ? 1 : ((chCodeCharacter === ")") ? -1 : 0);
			nBracketDepth += (chCodeCharacter === "[") ? 1 : ((chCodeCharacter === "]") ? -1 : 0);
			unCodeIndex += 1;
		}

		if ((nBraceDepth === 0) && (nParenthesisDepth === 0) && (nBracketDepth === 0)) {
			vecExportNames.push(vecExportNameMatch[1]);
		}
	}

	return vecExportNames;
}

function ExtractJavaScriptObjectMembers(strSourceText, strSourceCode, unOpeningBraceIndex) {
	const ObjectBodyRange = GetJavaScriptBracedRange(strSourceCode, unOpeningBraceIndex);
	if (!ObjectBodyRange) {
		throw new SyntaxError(`Unterminated JavaScript object at offset ${unOpeningBraceIndex}.`);
	}

	return GetCJSObjectExportNames(strSourceText.slice(ObjectBodyRange.Start, ObjectBodyRange.End));
}

function CollectCJSObjectExportNames(strSourceText) {
	const strSourceCode = MaskJavaScriptNonCode(strSourceText);
	const ExportPattern = /\bmodule\s*\.\s*exports\s*=\s*\{/g;
	const vecExportNames = [];
	let vecExportMatch = null;

	while ((vecExportMatch = ExportPattern.exec(strSourceCode)) !== null) {
		const unOpeningBraceIndex = ExportPattern.lastIndex - 1;
		for (const strExportName of ExtractJavaScriptObjectMembers(strSourceText, strSourceCode, unOpeningBraceIndex)) {
			vecExportNames.push(strExportName);
		}
	}

	return vecExportNames;
}

module.exports = { CollectCJSObjectExportNames };
