"use strict";

const { GetModule } = require("internal/runtime");
const { CustomUserMessageCreator } = require("messages");
const { NormalizeUserMessageRecipients, SendDialogMessageDataToRecipients } = require("messages/implementation");

const g_unMaximumDialogLevel = 1024;
const g_unMaximumColorComponent = 255;
const g_DefaultColor = Object.freeze({ Red: g_unMaximumColorComponent, Green: g_unMaximumColorComponent, Blue: g_unMaximumColorComponent, Alpha: g_unMaximumColorComponent });
const g_MessagesRuntime = GetModule("messages");
const g_PlayerLanguageRuntime = GetModule("players/language");
const g_PlayersRuntime = GetModule("players");
const g_NativeDialogTypes = g_MessagesRuntime.GetDialogTypes();
const g_DialogTypes = {
	MESSAGE: g_NativeDialogTypes.Message,
	MENU: g_NativeDialogTypes.Menu,
	TEXT: g_NativeDialogTypes.Text,
	ENTRY: g_NativeDialogTypes.Entry,
};

if (Object.hasOwn(g_NativeDialogTypes, "AskConnect")) {
	g_DialogTypes.ASK_CONNECT = g_NativeDialogTypes.AskConnect;
}

Object.freeze(g_DialogTypes);

const g_mapPlayerDialogLevels = new Map();

function IsPlainObject(Value) {
	if (!Value || (typeof Value !== "object") || Array.isArray(Value)) {
		return false;
	}

	const Prototype = Object.getPrototypeOf(Value);

	return (Prototype === Object.prototype) || (Prototype === null);
}

function RequireString(strValue, strValueName) {
	if (typeof strValue !== "string") {
		throw new TypeError(`${strValueName} requires a string.`);
	}

	return strValue;
}

function RequireNonEmptyString(strValue, strValueName) {
	RequireString(strValue, strValueName);

	if (strValue.length === 0) {
		throw new TypeError(`${strValueName} requires a non-empty string.`);
	}

	return strValue;
}

function ResolveTranslationMethod(TranslatableValue, strTranslatableValueName) {
	if (typeof TranslatableValue === "string") {
		return null;
	}

	if (!TranslatableValue || (typeof TranslatableValue !== "object")) {
		throw new TypeError(`${strTranslatableValueName} requires a string or an object with GetString().`);
	}

	const TranslationMethod = TranslatableValue.GetString;
	if (typeof TranslationMethod !== "function") {
		throw new TypeError(`${strTranslatableValueName} requires a string or an object with GetString().`);
	}

	return TranslationMethod;
}

function RequireTranslatable(TranslatableValue, strTranslatableValueName) {
	ResolveTranslationMethod(TranslatableValue, strTranslatableValueName);

	return TranslatableValue;
}

function RequireInteger(nValue, strValueName, nMinimumValue = Number.MIN_SAFE_INTEGER) {
	if (!Number.isSafeInteger(nValue) || (nValue < nMinimumValue)) {
		throw new TypeError(`${strValueName} requires a safe integer greater than or equal to ${nMinimumValue}.`);
	}

	return nValue;
}

function FormatDialogTemplate(strTemplateText, TemplateFields) {
	RequireString(strTemplateText, "Dialog template");

	if (!IsPlainObject(TemplateFields)) {
		throw new TypeError("Dialog template fields require a plain object.");
	}

	return strTemplateText.replace(/\{([^}]+)\}/g, (strTemplateMatch, strFieldName) => {
		if (!Object.hasOwn(TemplateFields, strFieldName)) {
			return strTemplateMatch;
		}

		const FieldValue = TemplateFields[strFieldName];
		if ((typeof FieldValue !== "string") && (typeof FieldValue !== "number") && (typeof FieldValue !== "boolean")) {
			throw new TypeError(`Dialog template field ${strFieldName} requires a string, number, or boolean.`);
		}

		return `${FieldValue}`;
	});
}

function TranslateDialogText(TranslatableValue, strLanguageCode, TranslationTokens, strTranslatableValueName) {
	const TranslationMethod = ResolveTranslationMethod(TranslatableValue, strTranslatableValueName);
	if (!IsPlainObject(TranslationTokens)) {
		throw new TypeError(`${strTranslatableValueName} tokens require a plain object.`);
	}

	if (TranslationMethod === null) {
		return FormatDialogTemplate(TranslatableValue, TranslationTokens);
	}

	const strTranslatedText = Reflect.apply(TranslationMethod, TranslatableValue, [strLanguageCode, TranslationTokens]);

	return RequireString(strTranslatedText, `${strTranslatableValueName} translation`);
}

function NormalizeDialogColor(DialogColor = g_DefaultColor) {
	if (!DialogColor || (typeof DialogColor !== "object") || Array.isArray(DialogColor)) {
		throw new TypeError("Dialog color requires an object with Red, Green, Blue, and Alpha fields.");
	}

	const unRedComponent = RequireInteger(DialogColor.Red, "Dialog color Red", 0);
	const unGreenComponent = RequireInteger(DialogColor.Green, "Dialog color Green", 0);
	const unBlueComponent = RequireInteger(DialogColor.Blue, "Dialog color Blue", 0);
	const unAlphaComponent = RequireInteger(DialogColor.Alpha, "Dialog color Alpha", 0);
	if ((unRedComponent > g_unMaximumColorComponent) || (unGreenComponent > g_unMaximumColorComponent) || (unBlueComponent > g_unMaximumColorComponent) || (unAlphaComponent > g_unMaximumColorComponent)) {
		throw new RangeError("Dialog color components must be between 0 and 255.");
	}

	return { Red: unRedComponent, Green: unGreenComponent, Blue: unBlueComponent, Alpha: unAlphaComponent };
}

function GetNextPlayerDialogLevel(unPlayerIndex) {
	RequireInteger(unPlayerIndex, "Dialog player index", 1);

	const unStoredDialogLevel = g_mapPlayerDialogLevels.get(unPlayerIndex);
	const unPreviousDialogLevel = (unStoredDialogLevel === undefined) ? 0 : unStoredDialogLevel;
	const unNextDialogLevel = (unPreviousDialogLevel >= g_unMaximumDialogLevel) ? 1 : (unPreviousDialogLevel + 1);
	g_mapPlayerDialogLevels.set(unPlayerIndex, unNextDialogLevel);

	return unNextDialogLevel;
}

function GetPlayerLanguage(unPlayerIndex) {
	return RequireString(g_PlayerLanguageRuntime.GetClientLanguage(unPlayerIndex), "Dialog player language");
}

function IsFakeClient(unPlayerIndex) {
	const bFakeClientResult = g_PlayersRuntime.IsFakeClient(unPlayerIndex);
	if (typeof bFakeClientResult !== "boolean") {
		throw new TypeError("players.IsFakeClient() result requires a boolean.");
	}

	return bFakeClientResult;
}

function ValidateUniqueDialogOptionEntries(vecDialogOptionEntries) {
	const setDialogOptionKeyIdentities = new Set();
	for (const DialogOptionEntry of vecDialogOptionEntries) {
		const strDialogOptionValue = DialogOptionEntry.Value;
		if (strDialogOptionValue.includes("\x00")) {
			throw new TypeError("Dialog menu option values must not contain NUL.");
		}

		if (strDialogOptionValue.includes("/")) {
			throw new TypeError("Dialog menu option values must not contain KeyValues path separators.");
		}

		const strDialogOptionKeyIdentity = strDialogOptionValue.replace(/[A-Z]/g, strUppercaseLetter => strUppercaseLetter.toLowerCase());
		switch (strDialogOptionKeyIdentity) {
			case "level":
			case "time":
			case "title":
			case "color":
			case "msg":
				throw new TypeError("Dialog menu option values must not use reserved root field names.");
		}

		if (setDialogOptionKeyIdentities.has(strDialogOptionKeyIdentity)) {
			throw new TypeError(`Dialog menu option value ${strDialogOptionValue} is duplicated.`);
		}

		setDialogOptionKeyIdentities.add(strDialogOptionKeyIdentity);
	}

	return vecDialogOptionEntries;
}

function NormalizeDialogOptionEntries(DialogOptions, NormalizeDialogOptionText = RequireTranslatable) {
	if (typeof NormalizeDialogOptionText !== "function") {
		throw new TypeError("Dialog option text normalizer requires a function.");
	}

	const bDialogOptionsArePlainObject = IsPlainObject(DialogOptions);
	const bDialogOptionsAreArray = Array.isArray(DialogOptions);
	if (!bDialogOptionsArePlainObject && !bDialogOptionsAreArray) {
		throw new TypeError("Dialog menu options require an array or plain object.");
	}

	const vecNormalizedDialogOptionEntries = [];
	if (bDialogOptionsArePlainObject) {
		for (const strDialogOptionValue in DialogOptions) {
			if (!Object.hasOwn(DialogOptions, strDialogOptionValue)) {
				continue;
			}

			const DialogOptionText = DialogOptions[strDialogOptionValue];
			const strDialogOptionTextName = `Dialog menu option ${strDialogOptionValue} text`;
			vecNormalizedDialogOptionEntries.push({ Text: NormalizeDialogOptionText(DialogOptionText, strDialogOptionTextName), Value: RequireNonEmptyString(strDialogOptionValue, "Dialog menu option value") });
		}

		return ValidateUniqueDialogOptionEntries(vecNormalizedDialogOptionEntries);
	}

	const unDialogOptionCount = DialogOptions.length;
	for (let unDialogOptionIndex = 0; unDialogOptionIndex < unDialogOptionCount; unDialogOptionIndex += 1) {
		const DialogOption = DialogOptions[unDialogOptionIndex];
		if (typeof DialogOption === "string") {
			const strDialogOptionTextName = `Dialog menu option ${unDialogOptionIndex} text`;
			vecNormalizedDialogOptionEntries.push({ Text: NormalizeDialogOptionText(DialogOption, strDialogOptionTextName), Value: RequireNonEmptyString(DialogOption, `Dialog menu option ${unDialogOptionIndex}`) });
			continue;
		}

		if (!IsPlainObject(DialogOption)) {
			throw new TypeError(`Dialog menu option ${unDialogOptionIndex} requires a string or plain object.`);
		}

		if (!Object.hasOwn(DialogOption, "Text")) {
			throw new TypeError(`Dialog menu option ${unDialogOptionIndex} requires an own Text field.`);
		}

		if (!Object.hasOwn(DialogOption, "Value")) {
			throw new TypeError(`Dialog menu option ${unDialogOptionIndex} requires an own Value field.`);
		}

		const DialogOptionText = DialogOption.Text;
		const DialogOptionValue = DialogOption.Value;
		const strDialogOptionTextName = `Dialog menu option ${unDialogOptionIndex} text`;
		vecNormalizedDialogOptionEntries.push({ Text: NormalizeDialogOptionText(DialogOptionText, strDialogOptionTextName), Value: RequireNonEmptyString(DialogOptionValue, `Dialog menu option ${unDialogOptionIndex} value`) });
	}

	return ValidateUniqueDialogOptionEntries(vecNormalizedDialogOptionEntries);
}

class DialogBase extends CustomUserMessageCreator {
	constructor(strDialogName, DialogFields) {
		super(strDialogName, DialogFields);
	}

	GetDialogType() {
		throw new TypeError(`${this.constructor.name}.GetDialogType() is not implemented.`);
	}

	GetKeyValuesName() {
		throw new TypeError(`${this.constructor.name}.GetKeyValuesName() is not implemented.`);
	}

	BuildDialogValues(unPlayerIndex, DialogFields) {
		if (!IsPlainObject(DialogFields)) {
			throw new TypeError(`${this.constructor.name}.BuildDialogValues() DialogFields requires a plain object.`);
		}

		const strDialogConstructorName = this.constructor.name;
		const unDisplayTime = RequireInteger(DialogFields.Time, `${strDialogConstructorName} Time`, 0);
		const strDialogTitle = FormatDialogTemplate(DialogFields.Title, DialogFields);
		const unDialogLevel = GetNextPlayerDialogLevel(unPlayerIndex);

		return { Level: unDialogLevel, Time: unDisplayTime, Title: strDialogTitle };
	}

	BuildMessagePayload(TargetReferences, TranslationTokens = {}, strLanguageCode = null) {
		const MessageFields = this.TranslateMessageFields(strLanguageCode, TranslationTokens);
		const unDialogType = this.GetDialogType();
		if (!Number.isSafeInteger(unDialogType) || (unDialogType < 0)) {
			throw new TypeError(`${this.constructor.name}.GetDialogType() requires a non-negative safe integer.`);
		}

		return { DialogType: unDialogType, Fields: MessageFields, RecipientIndexes: NormalizeUserMessageRecipients(TargetReferences), LanguageCode: strLanguageCode, TranslationTokens: TranslationTokens };
	}

	TranslateMessageFields(strLanguageCode = null, TranslationTokens = {}) {
		return super.TranslateUserMessageFields(strLanguageCode, TranslationTokens);
	}

	SendMessage(TargetReferences, TranslationTokens = {}) {
		const vecRecipientIndexes = NormalizeUserMessageRecipients(TargetReferences);
		let bDialogDeliveryAttempted = false;
		let bAllDialogsSent = true;
		for (const unPlayerIndex of vecRecipientIndexes) {
			if (IsFakeClient(unPlayerIndex)) {
				continue;
			}

			const DialogPayload = this.BuildMessagePayload(unPlayerIndex, TranslationTokens, GetPlayerLanguage(unPlayerIndex));
			const strDialogConstructorName = this.constructor.name;
			const unDialogType = RequireInteger(DialogPayload.DialogType, `${strDialogConstructorName} dialog type`, 0);
			const strKeyValuesName = RequireString(this.GetKeyValuesName(), `${strDialogConstructorName} KeyValues name`);
			const DialogValues = this.BuildDialogValues(unPlayerIndex, DialogPayload.Fields);
			const bDialogSendResult = SendDialogMessageDataToRecipients(unPlayerIndex, unDialogType, DialogValues, strKeyValuesName);
			if (typeof bDialogSendResult !== "boolean") {
				throw new TypeError("SendDialogMessageDataToRecipients() result requires a boolean.");
			}

			bDialogDeliveryAttempted = true;
			bAllDialogsSent = bDialogSendResult && bAllDialogsSent;
		}

		return bDialogDeliveryAttempted && bAllDialogsSent;
	}
}

Object.defineProperty(DialogBase, "TRANSLATABLE_FIELDS", { value: Object.freeze([]), writable: true, enumerable: true, configurable: true });

class DialogAskConnect extends DialogBase {
	constructor(DialogTitle, unDisplayTime = 10) {
		super("DialogAskConnect", { Time: RequireInteger(unDisplayTime, "DialogAskConnect Time", 0), Title: RequireTranslatable(DialogTitle, "DialogAskConnect Title") });
	}

	GetDialogType() {
		return g_DialogTypes.ASK_CONNECT;
	}

	GetKeyValuesName() {
		return "askconnect";
	}
}

Object.defineProperty(DialogAskConnect, "TRANSLATABLE_FIELDS", { value: Object.freeze(["Title"]), writable: true, enumerable: true, configurable: true });

class DialogEntry extends DialogBase {
	constructor(DialogTitle, DialogMessage, strDialogCommand, DialogOptions = {}) {
		if (!IsPlainObject(DialogOptions)) {
			throw new TypeError("DialogEntry DialogOptions requires a plain object.");
		}

		const DialogColor = Object.hasOwn(DialogOptions, "Color") ? DialogOptions.Color : g_DefaultColor;
		const unDisplayTime = Object.hasOwn(DialogOptions, "Time") ? DialogOptions.Time : 10;
		super("DialogEntry", { Color: NormalizeDialogColor(DialogColor), Command: RequireNonEmptyString(strDialogCommand, "DialogEntry Command"), Message: RequireTranslatable(DialogMessage, "DialogEntry Message"), Time: RequireInteger(unDisplayTime, "DialogEntry Time", 0), Title: RequireTranslatable(DialogTitle, "DialogEntry Title") });
	}

	GetDialogType() {
		return g_DialogTypes.ENTRY;
	}

	GetKeyValuesName() {
		return "entry";
	}

	BuildDialogValues(unPlayerIndex, DialogFields) {
		if (!IsPlainObject(DialogFields)) {
			throw new TypeError("DialogEntry.BuildDialogValues() DialogFields requires a plain object.");
		}

		const DialogColor = NormalizeDialogColor(DialogFields.Color);
		const strDialogCommand = RequireNonEmptyString(DialogFields.Command, "DialogEntry Command");
		const strDialogMessage = FormatDialogTemplate(DialogFields.Message, DialogFields);

		return { ...super.BuildDialogValues(unPlayerIndex, DialogFields), Color: DialogColor, Command: strDialogCommand, Msg: strDialogMessage };
	}
}

Object.defineProperty(DialogEntry, "TRANSLATABLE_FIELDS", { value: Object.freeze(["Message", "Title"]), writable: true, enumerable: true, configurable: true });

class DialogMenu extends DialogBase {
	constructor(DialogTitle, DialogMessage, strDialogCommand, DialogOptions) {
		if (!IsPlainObject(DialogOptions)) {
			throw new TypeError("DialogMenu DialogOptions requires a plain object.");
		}

		if (!Object.hasOwn(DialogOptions, "Options")) {
			throw new TypeError("DialogMenu DialogOptions.Options requires an own field.");
		}

		const DialogColor = Object.hasOwn(DialogOptions, "Color") ? DialogOptions.Color : g_DefaultColor;
		const unDisplayTime = Object.hasOwn(DialogOptions, "Time") ? DialogOptions.Time : 10;
		const DialogOptionInput = DialogOptions.Options;
		super("DialogMenu", { Color: NormalizeDialogColor(DialogColor), Command: RequireNonEmptyString(strDialogCommand, "DialogMenu Command"), Message: RequireTranslatable(DialogMessage, "DialogMenu Message"), Options: NormalizeDialogOptionEntries(DialogOptionInput), Time: RequireInteger(unDisplayTime, "DialogMenu Time", 0), Title: RequireTranslatable(DialogTitle, "DialogMenu Title") });
	}

	GetDialogType() {
		return g_DialogTypes.MENU;
	}

	GetKeyValuesName() {
		return "menu";
	}

	TranslateMessageFields(strLanguageCode = null, TranslationTokens = {}) {
		const TranslatedDialogFields = super.TranslateMessageFields(strLanguageCode, TranslationTokens);

		const TranslateDialogOptionText = (DialogOptionText, strDialogOptionTextName) => {
			return TranslateDialogText(DialogOptionText, strLanguageCode, TranslationTokens, strDialogOptionTextName);
		};

		const vecTranslatedDialogOptionEntries = NormalizeDialogOptionEntries(TranslatedDialogFields.Options, TranslateDialogOptionText);
		TranslatedDialogFields.Options = vecTranslatedDialogOptionEntries;

		return TranslatedDialogFields;
	}

	BuildDialogValues(unPlayerIndex, DialogFields) {
		if (!IsPlainObject(DialogFields)) {
			throw new TypeError("DialogMenu.BuildDialogValues() DialogFields requires a plain object.");
		}

		const strDialogCommand = RequireNonEmptyString(DialogFields.Command, "DialogMenu Command");
		const DialogColor = NormalizeDialogColor(DialogFields.Color);
		const strDialogMessage = FormatDialogTemplate(DialogFields.Message, DialogFields);
		const FormatDialogOptionText = (DialogOptionText, strDialogOptionTextName) => {
			RequireString(DialogOptionText, strDialogOptionTextName);

			return FormatDialogTemplate(DialogOptionText, DialogFields);
		};

		const vecDialogOptionEntries = NormalizeDialogOptionEntries(DialogFields.Options, FormatDialogOptionText);
		const vecPreparedDialogOptions = [];
		for (const DialogOptionEntry of vecDialogOptionEntries) {
			const strDialogOptionValue = DialogOptionEntry.Value;
			vecPreparedDialogOptions.push({ Command: `${strDialogCommand} ${strDialogOptionValue}`, Message: DialogOptionEntry.Text, Value: strDialogOptionValue });
		}

		const DialogValues = { ...super.BuildDialogValues(unPlayerIndex, DialogFields), Color: DialogColor, Msg: strDialogMessage };
		for (const PreparedDialogOption of vecPreparedDialogOptions) {
			Object.defineProperty(DialogValues, PreparedDialogOption.Value, { configurable: true, enumerable: true, value: { Command: PreparedDialogOption.Command, Msg: PreparedDialogOption.Message }, writable: true });
		}

		return DialogValues;
	}
}

Object.defineProperty(DialogMenu, "TRANSLATABLE_FIELDS", { value: Object.freeze(["Message", "Title"]), writable: true, enumerable: true, configurable: true });

class DialogNotification extends DialogBase {
	constructor(DialogTitle, DialogOptions = {}) {
		if (!IsPlainObject(DialogOptions)) {
			throw new TypeError("DialogNotification DialogOptions requires a plain object.");
		}

		const DialogColor = Object.hasOwn(DialogOptions, "Color") ? DialogOptions.Color : g_DefaultColor;
		const unDisplayTime = Object.hasOwn(DialogOptions, "Time") ? DialogOptions.Time : 10;
		super("DialogNotification", { Color: NormalizeDialogColor(DialogColor), Time: RequireInteger(unDisplayTime, "DialogNotification Time", 0), Title: RequireTranslatable(DialogTitle, "DialogNotification Title") });
	}

	GetDialogType() {
		return g_DialogTypes.MESSAGE;
	}

	GetKeyValuesName() {
		return "msg";
	}

	BuildDialogValues(unPlayerIndex, DialogFields) {
		if (!IsPlainObject(DialogFields)) {
			throw new TypeError("DialogNotification.BuildDialogValues() DialogFields requires a plain object.");
		}

		const DialogColor = NormalizeDialogColor(DialogFields.Color);

		return { ...super.BuildDialogValues(unPlayerIndex, DialogFields), Color: { Red: DialogColor.Red, Green: DialogColor.Green, Blue: DialogColor.Blue, Alpha: DialogColor.Alpha } };
	}
}

Object.defineProperty(DialogNotification, "TRANSLATABLE_FIELDS", { value: Object.freeze(["Title"]), writable: true, enumerable: true, configurable: true });

class DialogText extends DialogBase {
	constructor(DialogTitle, DialogMessage, DialogOptions = {}) {
		if (!IsPlainObject(DialogOptions)) {
			throw new TypeError("DialogText DialogOptions requires a plain object.");
		}

		const CustomDialogFields = Object.hasOwn(DialogOptions, "Fields") ? DialogOptions.Fields : {};
		if (!IsPlainObject(CustomDialogFields)) {
			throw new TypeError("DialogText DialogOptions.Fields requires a plain object.");
		}

		const DialogColor = Object.hasOwn(DialogOptions, "Color") ? DialogOptions.Color : g_DefaultColor;
		const unDisplayTime = Object.hasOwn(DialogOptions, "Time") ? DialogOptions.Time : 10;
		super("DialogText", { ...CustomDialogFields, Color: NormalizeDialogColor(DialogColor), Message: RequireTranslatable(DialogMessage, "DialogText Message"), Time: RequireInteger(unDisplayTime, "DialogText Time", 0), Title: RequireTranslatable(DialogTitle, "DialogText Title") });
	}

	GetDialogType() {
		return g_DialogTypes.TEXT;
	}

	GetKeyValuesName() {
		return "text";
	}

	BuildDialogValues(unPlayerIndex, DialogFields) {
		if (!IsPlainObject(DialogFields)) {
			throw new TypeError("DialogText.BuildDialogValues() DialogFields requires a plain object.");
		}

		const DialogColor = NormalizeDialogColor(DialogFields.Color);
		const strDialogMessage = FormatDialogTemplate(DialogFields.Message, DialogFields);

		return { ...super.BuildDialogValues(unPlayerIndex, DialogFields), Color: { Red: DialogColor.Red, Green: DialogColor.Green, Blue: DialogColor.Blue, Alpha: DialogColor.Alpha }, Msg: strDialogMessage };
	}
}

Object.defineProperty(DialogText, "TRANSLATABLE_FIELDS", { value: Object.freeze(["Message", "Title"]), writable: true, enumerable: true, configurable: true });

function SendDialogMessage(TargetReferences, DialogTitle, DialogMessage, DialogOptions = {}) {
	return new DialogText(DialogTitle, DialogMessage, DialogOptions).SendMessage(TargetReferences);
}

const g_DialogExports = {
	DIALOG_TYPE: g_DialogTypes,
	DialogBase: DialogBase,
	DialogEntry: DialogEntry,
	DialogMenu: DialogMenu,
	DialogNotification: DialogNotification,
	DialogText: DialogText,
	SendDialogMessage: SendDialogMessage,
};

if (Object.hasOwn(g_DialogTypes, "ASK_CONNECT")) {
	g_DialogExports.DialogAskConnect = DialogAskConnect;
}

module.exports = g_DialogExports;
