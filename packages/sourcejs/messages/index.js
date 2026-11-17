"use strict";

const { GetModule } = require("internal/runtime");
const {
	NormalizeUserMessageRecipients,
	SendClientConsoleMessageToRecipients,
	SendUserMessageToRecipients,
} = require("messages/implementation");

const g_MessagesRuntime = GetModule("messages");
const g_PlayerLanguageRuntime = GetModule("players/language");
const g_PlayersRuntime = GetModule("players");
const g_NativeGetMessageBackend = (typeof g_MessagesRuntime.GetMessageBackend === "function") ? g_MessagesRuntime.GetMessageBackend.bind(g_MessagesRuntime) : null;
const g_NativeGetBaseMessageConstants = (typeof g_MessagesRuntime.GetBaseMessageConstants === "function") ? g_MessagesRuntime.GetBaseMessageConstants.bind(g_MessagesRuntime) : null;
const g_NativeGetUserMessageIndex = (typeof g_MessagesRuntime.GetUserMessageIndex === "function") ? g_MessagesRuntime.GetUserMessageIndex.bind(g_MessagesRuntime) : null;
const g_NativeGetUserMessageName = (typeof g_MessagesRuntime.GetUserMessageName === "function") ? g_MessagesRuntime.GetUserMessageName.bind(g_MessagesRuntime) : null;
const g_NativeGetUserMessageSize = (typeof g_MessagesRuntime.GetUserMessageSize === "function") ? g_MessagesRuntime.GetUserMessageSize.bind(g_MessagesRuntime) : null;
const g_NativeSendSayTextMessage = (typeof g_MessagesRuntime.SendSayTextMessage === "function") ? g_MessagesRuntime.SendSayTextMessage.bind(g_MessagesRuntime) : null;
const g_NativeSendSayText2Message = (typeof g_MessagesRuntime.SendSayText2Message === "function") ? g_MessagesRuntime.SendSayText2Message.bind(g_MessagesRuntime) : null;
const g_NativeSendUserMessage = (typeof g_MessagesRuntime.SendUserMessage === "function") ? g_MessagesRuntime.SendUserMessage.bind(g_MessagesRuntime) : null;
const g_BaseMessageConstants = (g_NativeGetBaseMessageConstants === null) ? null : g_NativeGetBaseMessageConstants();
const FADE_FLAGS = (g_BaseMessageConstants === null) ? null : g_BaseMessageConstants.FadeFlags;
const HUD_DESTINATION = (g_BaseMessageConstants === null) ? null : g_BaseMessageConstants.HUDDestination;
const SCREEN_FADE_FRACTION_BITS = (g_BaseMessageConstants === null) ? null : g_BaseMessageConstants.SCREEN_FADE_FRACTION_BITS;
const SHAKE_COMMAND = (g_BaseMessageConstants === null) ? null : g_BaseMessageConstants.ShakeCommand;

const g_unMaximumColorComponentValue = 255;
const g_unMessageIntegerBitCount = 32;
const g_nMinimumSignedMessageInteger = -0x80000000;
const g_nMaximumSignedMessageInteger = 0x7FFFFFFF;
const g_unMaximumUnsignedMessageInteger = 0xFFFFFFFF;
const g_DefaultColor = Object.freeze({ Red: g_unMaximumColorComponentValue, Green: g_unMaximumColorComponentValue, Blue: g_unMaximumColorComponentValue, Alpha: g_unMaximumColorComponentValue });

const g_unScreenFadeFactor = (g_BaseMessageConstants === null) ? null : (1 << SCREEN_FADE_FRACTION_BITS);

const g_strProtobufSetFieldKind = "SET";
const g_strProtobufAddFieldKind = "ADD";
const g_strProtobufMessageFieldKind = "MESSAGE";
const g_strProtobufAddMessageFieldKind = "ADDMESSAGE";

const g_ProtobufMethodTypes = Object.freeze({
	bool: "Bool",
	double: "Double",
	enum: "Enum",
	float: "Float",
	int32: "Int32",
	int64: "Int64",
	string: "String",
	uint32: "UInt32",
	uint64: "UInt64",
});

function RequireString(strValue, strValueName) {
	if (typeof strValue !== "string") {
		throw new TypeError(`${strValueName} requires a string.`);
	}

	return strValue;
}

function RequireNonEmptyString(strValue, strValueName) {
	const strValidatedString = RequireString(strValue, strValueName);
	if (strValidatedString.length === 0) {
		throw new TypeError(`${strValueName} requires a non-empty string.`);
	}

	return strValidatedString;
}

function RequireBoolean(bBooleanValue, strValueName) {
	if (typeof bBooleanValue !== "boolean") {
		throw new TypeError(`${strValueName} requires a boolean.`);
	}

	return bBooleanValue;
}

function FormatTemplateValue(Value, strValueName) {
	if ((typeof Value === "string") || (typeof Value === "number") || (typeof Value === "boolean")) {
		return `${Value}`;
	}

	throw new TypeError(`${strValueName} requires a string, number, or boolean.`);
}

function IsPlainObject(Value) {
	if (!Value || (typeof Value !== "object") || Array.isArray(Value)) {
		return false;
	}

	const Prototype = Object.getPrototypeOf(Value);

	return (Prototype === Object.prototype) || (Prototype === null);
}

function FormatTemplate(strTemplateText, Fields) {
	RequireString(strTemplateText, "Message template");

	if (!IsPlainObject(Fields)) {
		throw new TypeError("Message template fields require a plain object.");
	}

	return strTemplateText.replace(/\{([^}]+)\}/g, (strTemplateMatch, strFieldName) => {
		if (Object.hasOwn(Fields, strFieldName)) {
			return FormatTemplateValue(Fields[strFieldName], `Message template field ${strFieldName}`);
		}

		return strTemplateMatch;
	});
}

function RequireMessageNumber(dblValue, strValueName) {
	if ((typeof dblValue !== "number") || !Number.isFinite(dblValue)) {
		throw new TypeError(`${strValueName} requires a finite number.`);
	}

	return dblValue;
}

function NormalizeMessageNumber(dblValue, dblDefaultValue = 0) {
	if (dblValue === undefined) {
		return dblDefaultValue;
	}

	return RequireMessageNumber(dblValue, "Message numeric field");
}

function RequireMessageInteger(nValue, strValueName) {
	const nValidatedNumber = RequireMessageNumber(nValue, strValueName);
	if (!Number.isSafeInteger(nValidatedNumber)) {
		throw new TypeError(`${strValueName} requires a safe integer.`);
	}

	return nValidatedNumber;
}

function RequireMessageIntegerInRange(nValue, strValueName, nMinimumValue, nMaximumValue) {
	const nValidatedValue = RequireMessageInteger(nValue, strValueName);
	if ((nValidatedValue < nMinimumValue) || (nValidatedValue > nMaximumValue)) {
		throw new RangeError(`${strValueName} must be between ${nMinimumValue} and ${nMaximumValue}.`);
	}

	return nValidatedValue;
}

function NormalizeMessageInteger(nValue, nDefaultValue = 0) {
	const nNormalizedNumber = NormalizeMessageNumber(nValue, nDefaultValue);
	if (!Number.isSafeInteger(nNormalizedNumber)) {
		throw new TypeError("Message integer field requires a safe integer.");
	}

	return nNormalizedNumber;
}

function RequireColorComponent(nComponentValue, strComponentName, strColorValueName) {
	const nValidatedComponent = RequireMessageInteger(nComponentValue, `${strColorValueName} ${strComponentName}`);
	if ((nValidatedComponent < 0) || (nValidatedComponent > g_unMaximumColorComponentValue)) {
		throw new RangeError(`${strColorValueName} ${strComponentName} must be between 0 and ${g_unMaximumColorComponentValue}.`);
	}

	return nValidatedComponent;
}

function NormalizeMessageColor(ColorValue = g_DefaultColor, strColorValueName = "Message color") {
	if (!ColorValue || (typeof ColorValue !== "object") || Array.isArray(ColorValue)) {
		throw new TypeError(`${strColorValueName} requires an object with Red, Green, Blue, and Alpha fields.`);
	}

	return { Red: RequireColorComponent(ColorValue.Red, "Red", strColorValueName), Green: RequireColorComponent(ColorValue.Green, "Green", strColorValueName), Blue: RequireColorComponent(ColorValue.Blue, "Blue", strColorValueName), Alpha: RequireColorComponent(ColorValue.Alpha, "Alpha", strColorValueName) };
}

function CreateBitBufferField(strFieldType, FieldValue, unBitCount = null) {
	if (unBitCount === null) {
		return { Type: strFieldType, Value: FieldValue };
	}

	return { Type: strFieldType, Value: FieldValue, Bits: unBitCount };
}

function CreateProtobufScalarField(strFieldKind, strFieldType, strFieldName, FieldValue) {
	return { Kind: strFieldKind, Type: strFieldType, Name: strFieldName, Value: FieldValue };
}

function CreateProtobufSetField(strFieldType, strFieldName, FieldValue) {
	return CreateProtobufScalarField(g_strProtobufSetFieldKind, strFieldType, strFieldName, FieldValue);
}

function CreateProtobufAddField(strFieldType, strFieldName, FieldValue) {
	return CreateProtobufScalarField(g_strProtobufAddFieldKind, strFieldType, strFieldName, FieldValue);
}

function CreateProtobufMessageField(strFieldName, vecFieldValues, bRepeated = false) {
	return { Kind: bRepeated ? g_strProtobufAddMessageFieldKind : g_strProtobufMessageFieldKind, Name: strFieldName, Fields: vecFieldValues };
}

function CreateByteField(nFieldValue) {
	return CreateBitBufferField("byte", NormalizeMessageInteger(nFieldValue));
}

function CreateCharField(nFieldValue) {
	const unCharacterBitCount = 8;
	const unCharacterMask = 0xFF;

	return CreateBitBufferField("bits", NormalizeMessageInteger(nFieldValue) & unCharacterMask, unCharacterBitCount);
}

function CreateShortField(nFieldValue) {
	return CreateBitBufferField("short", NormalizeMessageInteger(nFieldValue));
}

function CreateWordField(nFieldValue) {
	const unWordBitCount = 16;
	const unWordMask = 0xFFFF;

	return CreateBitBufferField("bits", NormalizeMessageInteger(nFieldValue) & unWordMask, unWordBitCount);
}

function CreateFloatField(dblFieldValue) {
	return CreateBitBufferField("float", NormalizeMessageNumber(dblFieldValue));
}

function CreateStringField(strFieldValue) {
	return CreateBitBufferField("string", RequireString(strFieldValue, "Message string field"));
}

function CreateFormattedStringField(strTemplateText, TemplateFields) {
	return CreateStringField(FormatTemplate(strTemplateText, TemplateFields));
}

function CreateColorByteFields(ColorValue, strColorValueName = "Message color") {
	const NormalizedColor = NormalizeMessageColor(ColorValue, strColorValueName);

	return [CreateByteField(NormalizedColor.Red), CreateByteField(NormalizedColor.Green), CreateByteField(NormalizedColor.Blue), CreateByteField(NormalizedColor.Alpha)];
}

function CreateColorProtobufField(strFieldName, ColorValue, strColorValueName = "Message color") {
	const NormalizedColor = NormalizeMessageColor(ColorValue, strColorValueName);

	return CreateProtobufMessageField(strFieldName, [
		CreateProtobufSetField("int32", "r", NormalizedColor.Red),
		CreateProtobufSetField("int32", "g", NormalizedColor.Green),
		CreateProtobufSetField("int32", "b", NormalizedColor.Blue),
		CreateProtobufSetField("int32", "a", NormalizedColor.Alpha),
	]);
}

function CallMessageBufferMethod(MessageBuffer, strMethodName, ...vecArgumentsList) {
	if (!MessageBuffer || ((typeof MessageBuffer !== "object") && (typeof MessageBuffer !== "function"))) {
		throw new TypeError(`Message buffer does not implement ${strMethodName}().`);
	}

	const BufferMethod = MessageBuffer[strMethodName];
	if (typeof BufferMethod !== "function") {
		throw new TypeError(`Message buffer does not implement ${strMethodName}().`);
	}

	return Reflect.apply(BufferMethod, MessageBuffer, vecArgumentsList);
}

function WriteBitBufferField(MessageBuffer, FieldEntry) {
	const strFieldType = FieldEntry.Type;
	switch (strFieldType) {
		case "byte":
			return CallMessageBufferMethod(MessageBuffer, "WriteByte", FieldEntry.Value);

		case "char":
			return CallMessageBufferMethod(MessageBuffer, "WriteChar", FieldEntry.Value);

		case "short":
			return CallMessageBufferMethod(MessageBuffer, "WriteShort", FieldEntry.Value);

		case "word":
			return CallMessageBufferMethod(MessageBuffer, "WriteWord", FieldEntry.Value);

		case "int": {
			const nIntegerValue = RequireMessageIntegerInRange(FieldEntry.Value, "User message int field Value", g_nMinimumSignedMessageInteger, g_nMaximumSignedMessageInteger);
			return CallMessageBufferMethod(MessageBuffer, "WriteLong", nIntegerValue);
		}

		case "uint": {
			const unIntegerValue = RequireMessageIntegerInRange(FieldEntry.Value, "User message uint field Value", 0, g_unMaximumUnsignedMessageInteger);
			return CallMessageBufferMethod(MessageBuffer, "WriteUBitLong", unIntegerValue, g_unMessageIntegerBitCount);
		}

		case "float":
			return CallMessageBufferMethod(MessageBuffer, "WriteFloat", FieldEntry.Value);

		case "string":
			return CallMessageBufferMethod(MessageBuffer, "WriteString", FieldEntry.Value);

		case "bool":
			return CallMessageBufferMethod(MessageBuffer, "WriteOneBit", RequireBoolean(FieldEntry.Value, "User message bool field Value"));

		case "bits": {
			const unBitCount = RequireMessageIntegerInRange(FieldEntry.Bits, "User message bits field Bits", 0, g_unMessageIntegerBitCount);
			const unIntegerValue = RequireMessageIntegerInRange(FieldEntry.Value, "User message bits field Value", 0, g_unMaximumUnsignedMessageInteger);
			return CallMessageBufferMethod(MessageBuffer, "WriteUBitLong", unIntegerValue, unBitCount);
		}

		default:
			throw new TypeError(`Unsupported user message bit buffer field type: ${strFieldType}`);
	}
}

function WriteBitBufferFields(MessageBuffer, vecFieldEntries) {
	if (!Array.isArray(vecFieldEntries)) {
		throw new TypeError("User message bit buffer fields require an array.");
	}

	for (const FieldEntry of vecFieldEntries) {
		if (!IsPlainObject(FieldEntry)) {
			throw new TypeError("User message bit buffer entries require plain objects.");
		}

		// Live adapters retain overflow in their state; callers inspect the returned buffer.
		WriteBitBufferField(MessageBuffer, FieldEntry);
	}

	return MessageBuffer;
}

function GetProtobufMethodName(strFieldKind, strFieldType) {
	if (!Object.hasOwn(g_ProtobufMethodTypes, strFieldType)) {
		throw new TypeError(`Unsupported protobuf field type: ${strFieldType}`);
	}

	if ((strFieldKind !== g_strProtobufSetFieldKind) && (strFieldKind !== g_strProtobufAddFieldKind)) {
		throw new TypeError(`Unsupported protobuf field kind: ${strFieldKind}`);
	}

	return `${(strFieldKind === g_strProtobufAddFieldKind) ? "Add" : "Set"}${g_ProtobufMethodTypes[strFieldType]}`;
}

function GetProtobufChildBuffer(MessageBuffer, strFieldKind, strFieldName) {
	if (strFieldKind === g_strProtobufAddMessageFieldKind) {
		return CallMessageBufferMethod(MessageBuffer, "AddMessage", strFieldName);
	}

	return CallMessageBufferMethod(MessageBuffer, "GetMutableMessage", strFieldName);
}

function WriteProtobufFields(MessageBuffer, vecFieldEntries) {
	if (!Array.isArray(vecFieldEntries)) {
		throw new TypeError("User message protobuf fields require an array.");
	}

	for (const FieldEntry of vecFieldEntries) {
		if (!IsPlainObject(FieldEntry)) {
			throw new TypeError("User message protobuf entries require plain objects.");
		}

		const strFieldKind = FieldEntry.Kind;
		const strFieldName = FieldEntry.Name;
		if ((strFieldKind === g_strProtobufMessageFieldKind) || (strFieldKind === g_strProtobufAddMessageFieldKind)) {
			const ChildBuffer = GetProtobufChildBuffer(MessageBuffer, strFieldKind, strFieldName);
			WriteProtobufFields(ChildBuffer, FieldEntry.Fields);
			continue;
		}

		const strMethodName = GetProtobufMethodName(strFieldKind, FieldEntry.Type);
		CallMessageBufferMethod(MessageBuffer, strMethodName, strFieldName, FieldEntry.Value);
	}

	return MessageBuffer;
}

function TranslateMessageValue(MessageValue, strLanguageCode, TranslationTokens) {
	if ((MessageValue !== null) && (MessageValue !== undefined)) {
		const GetString = MessageValue.GetString;
		if (typeof GetString === "function") {
			const strTranslatedValue = Reflect.apply(GetString, MessageValue, [strLanguageCode, TranslationTokens]);
			return RequireString(strTranslatedValue, "Translated message value");
		}
	}

	if (typeof MessageValue === "string") {
		return FormatTemplate(MessageValue, TranslationTokens);
	}

	throw new TypeError("Translatable message fields require a string or an object with GetString().");
}

function GetPlayerLanguage(unPlayerIndex) {
	return RequireString(g_PlayerLanguageRuntime.GetClientLanguage(unPlayerIndex), "Player language");
}

function IsFakeClient(unPlayerIndex) {
	return RequireBoolean(g_PlayersRuntime.IsFakeClient(unPlayerIndex), "players.IsFakeClient() result");
}

function GroupRecipientsByLanguage(TargetReferences) {
	const mapRecipientGroups = new Map();
	for (const unPlayerIndex of NormalizeUserMessageRecipients(TargetReferences)) {
		if (IsFakeClient(unPlayerIndex)) {
			continue;
		}

		const strLanguageCode = GetPlayerLanguage(unPlayerIndex);
		let vecLanguagePlayerIndexes = mapRecipientGroups.get(strLanguageCode);
		if (vecLanguagePlayerIndexes === undefined) {
			vecLanguagePlayerIndexes = [];
			mapRecipientGroups.set(strLanguageCode, vecLanguagePlayerIndexes);
		}

		vecLanguagePlayerIndexes.push(unPlayerIndex);
	}

	return mapRecipientGroups;
}

function GetHumanRecipients(TargetReferences) {
	const vecHumanPlayerIndexes = [];
	for (const unPlayerIndex of NormalizeUserMessageRecipients(TargetReferences)) {
		if (!IsFakeClient(unPlayerIndex)) {
			vecHumanPlayerIndexes.push(unPlayerIndex);
		}
	}

	return vecHumanPlayerIndexes;
}

function RequireMessageBackend() {
	const strMessageBackend = RequireString(g_MessagesRuntime.GetMessageBackend(), "messages.GetMessageBackend() result");
	if ((strMessageBackend !== "bitbuffer") && (strMessageBackend !== "protobuf")) {
		throw new TypeError(`Unsupported messages backend: ${strMessageBackend}`);
	}

	return strMessageBackend;
}

function ReadBooleanOption(Options, strOptionName, bDefaultValue, strOptionOwnerName) {
	if (!Object.hasOwn(Options, strOptionName)) {
		return bDefaultValue;
	}

	return RequireBoolean(Options[strOptionName], `${strOptionOwnerName} ${strOptionName}`);
}

function ReadStringOption(Options, strOptionName, strDefaultValue, strOptionOwnerName) {
	if (!Object.hasOwn(Options, strOptionName)) {
		return strDefaultValue;
	}

	return RequireString(Options[strOptionName], `${strOptionOwnerName} ${strOptionName}`);
}

function ReadMessageNumberOption(Options, strOptionName, dblDefaultValue, strOptionOwnerName) {
	if (!Object.hasOwn(Options, strOptionName)) {
		return dblDefaultValue;
	}

	return RequireMessageNumber(Options[strOptionName], `${strOptionOwnerName} ${strOptionName}`);
}

function ReadMessageIntegerOption(Options, strOptionName, nDefaultValue, strOptionOwnerName) {
	if (!Object.hasOwn(Options, strOptionName)) {
		return nDefaultValue;
	}

	return RequireMessageInteger(Options[strOptionName], `${strOptionOwnerName} ${strOptionName}`);
}

function ReadMessageColorOption(Options, strOptionName, DefaultValue, strOptionOwnerName) {
	const ColorValue = Object.hasOwn(Options, strOptionName) ? Options[strOptionName] : DefaultValue;
	NormalizeMessageColor(ColorValue, `${strOptionOwnerName} ${strOptionName}`);

	return ColorValue;
}

function GetVGUISubkeyEntries(MessageFields) {
	if (!IsPlainObject(MessageFields)) {
		throw new TypeError("VGUIMenu fields require a plain object.");
	}

	const MessageSubkeys = MessageFields.Subkeys;
	if (!IsPlainObject(MessageSubkeys)) {
		throw new TypeError("VGUIMenu Subkeys require a plain object.");
	}

	const vecSubkeyEntries = Object.entries(MessageSubkeys);
	for (const vecSubkeyEntry of vecSubkeyEntries) {
		const strSubkeyName = vecSubkeyEntry[0];
		const strSubkeyValue = vecSubkeyEntry[1];
		if (strSubkeyName.length === 0) {
			throw new TypeError("VGUIMenu subkey name requires a non-empty string.");
		}

		RequireString(strSubkeyValue, `VGUIMenu subkey ${strSubkeyName}`);
	}

	return vecSubkeyEntries;
}

class UserMessage {
	constructor(strMessageName, vecFieldEntries = [], bReliableDelivery = false) {
		const strValidatedMessageName = RequireNonEmptyString(strMessageName, "UserMessage name");

		if (!Array.isArray(vecFieldEntries)) {
			throw new TypeError("UserMessage fields require an array.");
		}

		const bValidatedReliableDelivery = RequireBoolean(bReliableDelivery, "UserMessage reliable");

		this.MessageName = strValidatedMessageName;
		this.FieldEntries = vecFieldEntries;
		this.ReliableDelivery = bValidatedReliableDelivery;
	}

	AddUserMessageField(strFieldType, FieldValue, unBitCount = null) {
		const strValidatedFieldType = RequireNonEmptyString(strFieldType, "UserMessage field type");

		if ((unBitCount !== null) && (!Number.isSafeInteger(unBitCount) || (unBitCount < 0) || (unBitCount > g_unMessageIntegerBitCount))) {
			throw new TypeError(`UserMessage field bits require an integer from 0 through ${g_unMessageIntegerBitCount} or null.`);
		}

		const vecMessageFields = this.FieldEntries;
		if (!Array.isArray(vecMessageFields)) {
			throw new TypeError("UserMessage fields require an array.");
		}

		vecMessageFields.push(CreateBitBufferField(strValidatedFieldType, FieldValue, unBitCount));

		return this;
	}

	SendUserMessage(TargetReferences) {
		const strMessageName = RequireNonEmptyString(this.MessageName, "UserMessage name");
		const vecFieldEntries = this.FieldEntries;
		if (!Array.isArray(vecFieldEntries)) {
			throw new TypeError("UserMessage fields require an array.");
		}

		const bReliableDelivery = RequireBoolean(this.ReliableDelivery, "UserMessage reliable");

		return SendUserMessageToRecipients(TargetReferences, strMessageName, vecFieldEntries, bReliableDelivery);
	}
}

class UserMessageCreator {
	constructor(MessageFields = {}, CreatorOptions = {}) {
		if (!IsPlainObject(MessageFields) || !IsPlainObject(CreatorOptions)) {
			throw new TypeError("UserMessageCreator fields and options require plain objects.");
		}

		const bReliableDelivery = ReadBooleanOption(CreatorOptions, "Reliable", false, "UserMessageCreator");
		const bStrictFields = ReadBooleanOption(CreatorOptions, "Strict", true, "UserMessageCreator");
		const setValidFieldNames = bStrictFields ? new Set() : null;
		if (bStrictFields) {
			for (const strFieldName in MessageFields) {
				if (Object.hasOwn(MessageFields, strFieldName)) {
					setValidFieldNames.add(strFieldName);
				}
			}
		}

		this.MessageFields = MessageFields;
		this.ReliableDelivery = bReliableDelivery;
		this.ValidFieldNames = setValidFieldNames;
	}

	SetUserMessageField(strFieldName, FieldValue) {
		const strValidatedFieldName = RequireNonEmptyString(strFieldName, "UserMessageCreator field name");
		const setValidFieldNames = this.ValidFieldNames;
		if ((setValidFieldNames !== null) && !(setValidFieldNames instanceof Set)) {
			throw new TypeError("UserMessageCreator valid field names require a Set or null.");
		}

		if ((setValidFieldNames !== null) && !setValidFieldNames.has(strValidatedFieldName)) {
			throw new ReferenceError(`Invalid message field "${strValidatedFieldName}".`);
		}

		const MessageFields = this.MessageFields;
		if (!IsPlainObject(MessageFields)) {
			throw new TypeError("UserMessageCreator fields require a plain object.");
		}

		if (Object.hasOwn(MessageFields, strValidatedFieldName)) {
			MessageFields[strValidatedFieldName] = FieldValue;

		} else {
			Object.defineProperty(MessageFields, strValidatedFieldName, { value: FieldValue, writable: true, enumerable: true, configurable: true });
		}

		return this;
	}

	BuildUserMessagePayload(TargetReferences, TranslationTokens = {}, strLanguageCode = null) {
		if (!IsPlainObject(TranslationTokens)) {
			throw new TypeError("UserMessageCreator payload tokens require a plain object.");
		}

		if ((strLanguageCode !== null) && (typeof strLanguageCode !== "string")) {
			throw new TypeError("UserMessageCreator payload language requires a string or null.");
		}

		const TranslatedFields = this.TranslateUserMessageFields(strLanguageCode, TranslationTokens);
		if (!IsPlainObject(TranslatedFields)) {
			throw new TypeError("UserMessageCreator translated fields require a plain object.");
		}

		const strMessageName = this.GetUserMessageName();
		const vecRecipientIndexes = NormalizeUserMessageRecipients(TargetReferences);
		const bReliableDelivery = RequireBoolean(this.ReliableDelivery, "UserMessageCreator reliable");

		return {
			MessageName: strMessageName,
			RecipientIndexes: vecRecipientIndexes,
			MessageFields: TranslatedFields,
			LanguageCode: strLanguageCode,
			TranslationTokens: TranslationTokens,
			ReliableDelivery: bReliableDelivery,
			UserMessage: this,
		};
	}

	BuildUserMessageBitBufferFields() {
		throw new TypeError(`${this.constructor.name}.BuildUserMessageBitBufferFields() is not implemented.`);
	}

	BuildUserMessageProtobufFields() {
		throw new TypeError(`${this.constructor.name}.BuildUserMessageProtobufFields() is not implemented.`);
	}

	WriteUserMessageToBitBuffer(MessageBuffer, MessageFields = this.MessageFields) {
		WriteBitBufferFields(MessageBuffer, this.BuildUserMessageBitBufferFields(MessageFields));

		return MessageBuffer;
	}

	WriteUserMessageToProtobuf(MessageBuffer, MessageFields = this.MessageFields) {
		WriteProtobufFields(MessageBuffer, this.BuildUserMessageProtobufFields(MessageFields));

		return MessageBuffer;
	}

	TranslateUserMessageFields(strLanguageCode = null, TranslationTokens = {}) {
		if ((strLanguageCode !== null) && (typeof strLanguageCode !== "string")) {
			throw new TypeError("UserMessageCreator language requires a string or null.");
		}

		if (!IsPlainObject(TranslationTokens)) {
			throw new TypeError("UserMessageCreator translation tokens require a plain object.");
		}

		const MessageFields = this.MessageFields;
		if (!IsPlainObject(MessageFields)) {
			throw new TypeError("UserMessageCreator fields require a plain object.");
		}

		const TranslatedFields = { ...MessageFields };
		const vecTranslatableFieldNames = this.GetTranslatableFields();
		for (const strFieldName of vecTranslatableFieldNames) {
			const strValidatedFieldName = RequireNonEmptyString(strFieldName, "UserMessageCreator translatable field name");
			if (!Object.hasOwn(MessageFields, strValidatedFieldName)) {
				throw new ReferenceError(`Missing translatable message field "${strValidatedFieldName}".`);
			}

			TranslatedFields[strValidatedFieldName] = TranslateMessageValue(MessageFields[strValidatedFieldName], strLanguageCode, TranslationTokens);
		}

		return TranslatedFields;
	}

	DeliverUserMessage(MessagePayload) {
		if (!IsPlainObject(MessagePayload)) {
			throw new TypeError("UserMessageCreator payload requires a plain object.");
		}

		const PayloadFields = MessagePayload.MessageFields;
		if (!IsPlainObject(PayloadFields)) {
			throw new TypeError("UserMessageCreator payload fields require a plain object.");
		}

		const strPayloadMessageName = RequireNonEmptyString(MessagePayload.MessageName, "UserMessageCreator payload name");
		const bReliableDelivery = RequireBoolean(MessagePayload.ReliableDelivery, "UserMessageCreator payload reliable");
		const strMessageBackend = RequireMessageBackend();
		const vecFieldEntries = (strMessageBackend === "protobuf") ? this.BuildUserMessageProtobufFields(PayloadFields) : this.BuildUserMessageBitBufferFields(PayloadFields);
		if (!Array.isArray(vecFieldEntries)) {
			throw new TypeError("UserMessageCreator message fields require an array.");
		}

		if (vecFieldEntries.length === 0) {
			return false;
		}

		return SendUserMessageToRecipients(MessagePayload.RecipientIndexes, strPayloadMessageName, vecFieldEntries, bReliableDelivery);
	}

	SendUserMessage(TargetReferences, TranslationTokens = {}) {
		if (!IsPlainObject(TranslationTokens)) {
			throw new TypeError("UserMessageCreator.SendUserMessage() tokens require a plain object.");
		}

		const vecTranslatableFieldNames = this.GetTranslatableFields();
		const mapRecipientGroups = (vecTranslatableFieldNames.length > 0) ? GroupRecipientsByLanguage(TargetReferences) : new Map([[null, GetHumanRecipients(TargetReferences)]]);

		let bMessageSent = false;
		let bDeliverySucceeded = true;
		for (const vecRecipientGroup of mapRecipientGroups) {
			const strLanguageCode = vecRecipientGroup[0];
			const vecPlayerIndexes = vecRecipientGroup[1];
			const MessagePayload = this.BuildUserMessagePayload(vecPlayerIndexes, TranslationTokens, strLanguageCode);
			const bMessageDeliveryResult = RequireBoolean(this.DeliverUserMessage(MessagePayload), "UserMessageCreator delivery result");
			bMessageSent = true;
			bDeliverySucceeded = bMessageDeliveryResult && bDeliverySucceeded;
		}

		return bMessageSent && bDeliverySucceeded;
	}

	toString(MessageFields = this.MessageFields) {
		if (!IsPlainObject(MessageFields)) {
			throw new TypeError("UserMessageCreator.toString() MessageFields require a plain object.");
		}

		return FormatTemplate(RequireString(MessageFields.Message, "UserMessageCreator Message"), MessageFields);
	}

	GetUserMessageName() {
		const MessageConstructor = this.constructor;
		const strConfiguredMessageName = MessageConstructor.MessageName;
		if (strConfiguredMessageName === undefined) {
			return RequireNonEmptyString(MessageConstructor.name, "UserMessageCreator constructor name");
		}

		return RequireNonEmptyString(strConfiguredMessageName, "UserMessageCreator message name");
	}

	GetTranslatableFields() {
		const vecTranslatableFieldNames = this.constructor.TRANSLATABLE_FIELDS;
		if (!Array.isArray(vecTranslatableFieldNames)) {
			throw new TypeError("UserMessageCreator translatable fields require an array.");
		}

		return vecTranslatableFieldNames;
	}

	GetUserMessageField(strFieldName, DefaultValue = null) {
		const strValidatedFieldName = RequireNonEmptyString(strFieldName, "UserMessageCreator field name");
		const MessageFields = this.MessageFields;
		if (!IsPlainObject(MessageFields)) {
			throw new TypeError("UserMessageCreator fields require a plain object.");
		}

		return Object.hasOwn(MessageFields, strValidatedFieldName) ? MessageFields[strValidatedFieldName] : DefaultValue;
	}
}

Object.defineProperty(UserMessageCreator, "TRANSLATABLE_FIELDS", { value: Object.freeze([]), writable: true, enumerable: true, configurable: true });

class CustomUserMessageCreator extends UserMessageCreator {
	constructor(strMessageName, MessageFields = {}) {
		const strValidatedMessageName = RequireNonEmptyString(strMessageName, "Message name");
		super(MessageFields, { Strict: false });
		this.MessageName = strValidatedMessageName;
	}

	GetUserMessageName() {
		return RequireNonEmptyString(this.MessageName, "Message name");
	}
}

class TextMessage extends CustomUserMessageCreator {
	constructor(strMessageText, MessageFields = {}) {
		if (!IsPlainObject(MessageFields)) {
			throw new TypeError("TextMessage MessageFields require a plain object.");
		}

		const ConfiguredFields = { Message: strMessageText, ...MessageFields };
		ConfiguredFields.Message = RequireString(ConfiguredFields.Message, "TextMessage Message");
		super(new.target.MessageName, ConfiguredFields);
	}

	DeliverUserMessage(MessagePayload) {
		if (!IsPlainObject(MessagePayload)) {
			throw new TypeError("TextMessage payload requires a plain object.");
		}

		return SendClientConsoleMessageToRecipients(MessagePayload.RecipientIndexes, this.toString(MessagePayload.MessageFields));
	}
}

Object.defineProperty(TextMessage, "TRANSLATABLE_FIELDS", { value: Object.freeze(["Message"]), writable: true, enumerable: true, configurable: true });
Object.defineProperty(TextMessage, "MessageName", { value: "TextMessage", writable: true, enumerable: true, configurable: true });

class VGUIMenu extends UserMessageCreator {
	constructor(strMenuName, MenuSubkeys = {}, bVisible = true) {
		const strValidatedMenuName = RequireNonEmptyString(strMenuName, "VGUIMenu name");

		if (!IsPlainObject(MenuSubkeys)) {
			throw new TypeError("VGUIMenu MenuSubkeys require a plain object.");
		}

		const bValidatedVisibility = RequireBoolean(bVisible, "VGUIMenu visibility");
		super({ Name: strValidatedMenuName, Subkeys: MenuSubkeys, Show: bValidatedVisibility });
	}

	BuildUserMessageBitBufferFields(MessageFields) {
		const vecSubkeyEntries = GetVGUISubkeyEntries(MessageFields);
		const strValidatedMenuName = RequireNonEmptyString(MessageFields.Name, "VGUIMenu name");
		const vecMessageFieldEntries = [
			CreateStringField(strValidatedMenuName),
			CreateByteField(RequireBoolean(MessageFields.Show, "VGUIMenu visibility") ? 1 : 0),
			CreateByteField(vecSubkeyEntries.length),
		];
		for (const vecSubkeyEntry of vecSubkeyEntries) {
			const strSubkeyName = vecSubkeyEntry[0];
			const strSubkeyValue = vecSubkeyEntry[1];
			vecMessageFieldEntries.push(CreateStringField(strSubkeyName), CreateStringField(strSubkeyValue));
		}

		return vecMessageFieldEntries;
	}

	BuildUserMessageProtobufFields(MessageFields) {
		const vecSubkeyEntries = GetVGUISubkeyEntries(MessageFields);
		const strValidatedMenuName = RequireNonEmptyString(MessageFields.Name, "VGUIMenu name");
		const vecMessageFieldEntries = [
			CreateProtobufSetField("string", "name", strValidatedMenuName),
			CreateProtobufSetField("bool", "show", RequireBoolean(MessageFields.Show, "VGUIMenu visibility")),
		];
		for (const vecSubkeyEntry of vecSubkeyEntries) {
			const strSubkeyName = vecSubkeyEntry[0];
			const strSubkeyValue = vecSubkeyEntry[1];
			vecMessageFieldEntries.push(CreateProtobufMessageField("subkeys", [
				CreateProtobufSetField("string", "name", strSubkeyName),
				CreateProtobufSetField("string", "str", strSubkeyValue),
			], true));
		}

		return vecMessageFieldEntries;
	}
}

Object.defineProperty(VGUIMenu, "MessageName", { value: "VGUIMenu", writable: true, enumerable: true, configurable: true });

function SplitShowMenuText(strMenuText, unMaximumBytes) {
	const unTwoByteCodePointStart = 0x80;
	const unThreeByteCodePointStart = 0x800;
	const unFourByteCodePointStart = 0x10000;
	const vecChunks = [];
	let strChunk = "";
	let unChunkBytes = 0;

	for (const strCharacter of strMenuText) {
		const unCodePoint = strCharacter.codePointAt(0);
		const unCharacterBytes = (unCodePoint < unTwoByteCodePointStart) ? 1 : (unCodePoint < unThreeByteCodePointStart) ? 2 : (unCodePoint < unFourByteCodePointStart) ? 3 : 4;
		if (unCharacterBytes > unMaximumBytes) {
			throw new RangeError("ShowMenu.ChunkSize is too small for a UTF-8 character in the menu text.");
		}

		if ((unChunkBytes + unCharacterBytes) > unMaximumBytes) {
			vecChunks.push(strChunk);
			strChunk = "";
			unChunkBytes = 0;
		}

		strChunk += strCharacter;
		unChunkBytes += unCharacterBytes;
	}

	vecChunks.push(strChunk);

	return vecChunks;
}

class ShowMenu extends UserMessageCreator {
	constructor(strMenuText, unValidSlots = 0x3FF, nDisplayTime = 4) {
		const strValidatedMenuText = RequireString(strMenuText, "ShowMenu menu text");
		const unValidatedValidSlots = RequireMessageInteger(unValidSlots, "ShowMenu ValidSlots");
		const nValidatedDisplayTime = RequireMessageInteger(nDisplayTime, "ShowMenu DisplayTime");
		super({ MenuString: strValidatedMenuText, ValidSlots: unValidatedValidSlots, DisplayTime: nValidatedDisplayTime });
	}

	DeliverUserMessage(MessagePayload) {
		if (!IsPlainObject(MessagePayload)) {
			throw new TypeError("ShowMenu payload requires a plain object.");
		}

		const MessageFields = MessagePayload.MessageFields;
		if (!IsPlainObject(MessageFields)) {
			throw new TypeError("ShowMenu payload fields require a plain object.");
		}

		const strPayloadMessageName = RequireNonEmptyString(MessagePayload.MessageName, "ShowMenu payload name");
		const bReliableDelivery = RequireBoolean(MessagePayload.ReliableDelivery, "ShowMenu payload reliable");
		const TargetReferences = MessagePayload.RecipientIndexes;
		const strMessageBackend = RequireMessageBackend();
		if (strMessageBackend === "protobuf") {
			return SendUserMessageToRecipients(TargetReferences, strPayloadMessageName, this.BuildUserMessageProtobufFields(MessageFields), bReliableDelivery);
		}

		const unValidSlots = RequireMessageInteger(MessageFields.ValidSlots, "ShowMenu ValidSlots");
		const nDisplayTime = RequireMessageInteger(MessageFields.DisplayTime, "ShowMenu DisplayTime");
		const unMenuChunkSize = RequireMessageInteger(ShowMenu.ChunkSize, "ShowMenu.ChunkSize");
		if (unMenuChunkSize <= 0) {
			throw new RangeError("ShowMenu.ChunkSize requires a positive integer.");
		}

		const strMenuText = RequireString(MessageFields.MenuString, "ShowMenu MenuString");
		const vecMenuChunks = SplitShowMenuText(strMenuText, unMenuChunkSize);
		let bDeliverySucceeded = true;

		for (const [unIndex, strMenuChunk] of vecMenuChunks.entries()) {
			const vecMessageFieldEntries = [
				CreateWordField(unValidSlots),
				CreateCharField(nDisplayTime),
				CreateByteField(((unIndex + 1) < vecMenuChunks.length) ? 1 : 0),
				CreateStringField(strMenuChunk),
			];

			const bNativeDeliveryResult = SendUserMessageToRecipients(TargetReferences, strPayloadMessageName, vecMessageFieldEntries, bReliableDelivery);
			const bMessageDeliveryResult = RequireBoolean(bNativeDeliveryResult, "ShowMenu delivery result");
			bDeliverySucceeded = bMessageDeliveryResult && bDeliverySucceeded;
		}

		return bDeliverySucceeded;
	}

	toString(MessageFields = this.MessageFields) {
		if (!IsPlainObject(MessageFields)) {
			throw new TypeError("ShowMenu MessageFields require a plain object.");
		}

		return FormatTemplate(RequireString(MessageFields.MenuString, "ShowMenu MenuString"), MessageFields);
	}

	BuildUserMessageProtobufFields(MessageFields) {
		if (!IsPlainObject(MessageFields)) {
			throw new TypeError("ShowMenu MessageFields require a plain object.");
		}

		const unValidSlots = RequireMessageInteger(MessageFields.ValidSlots, "ShowMenu ValidSlots");
		const nDisplayTime = RequireMessageInteger(MessageFields.DisplayTime, "ShowMenu DisplayTime");
		const strMenuText = RequireString(MessageFields.MenuString, "ShowMenu MenuString");

		return [
			CreateProtobufSetField("int32", "bits_valid_slots", unValidSlots),
			CreateProtobufSetField("int32", "display_time", nDisplayTime),
			CreateProtobufSetField("string", "menu_string", strMenuText),
		];
	}
}

Object.defineProperty(ShowMenu, "ChunkSize", { value: 62, writable: true, enumerable: true, configurable: true });
Object.defineProperty(ShowMenu, "MessageName", { value: "ShowMenu", writable: true, enumerable: true, configurable: true });

class SayText extends TextMessage {
	constructor(strMessageText, MessageOptions = {}) {
		if (!IsPlainObject(MessageOptions)) {
			throw new TypeError("SayText MessageOptions require a plain object.");
		}

		const bChatEnabled = ReadBooleanOption(MessageOptions, "Chat", false, "SayText");
		const nSenderIndex = ReadMessageIntegerOption(MessageOptions, "SenderIndex", 0, "SayText");
		const strMessageColor = Object.hasOwn(MessageOptions, "Color") ? RequireString(MessageOptions.Color, "SayText Color") : ((RequireMessageBackend() === "protobuf") ? " \x01" : "\x01");

		super(strMessageText, { Chat: bChatEnabled, Color: strMessageColor, SenderIndex: nSenderIndex });
		this.ReliableDelivery = true;
	}

	BuildUserMessageBitBufferFields(MessageFields) {
		if (!IsPlainObject(MessageFields)) {
			throw new TypeError("SayText MessageFields require a plain object.");
		}

		const nSenderIndex = RequireMessageInteger(MessageFields.SenderIndex, "SayText SenderIndex");
		const strMessageColor = RequireString(MessageFields.Color, "SayText Color");
		const strMessageText = RequireString(MessageFields.Message, "SayText Message");
		const bChatEnabled = RequireBoolean(MessageFields.Chat, "SayText Chat");

		return [
			CreateByteField(nSenderIndex),
			CreateFormattedStringField(`${strMessageColor}${strMessageText}`, MessageFields),
			CreateByteField(bChatEnabled ? 1 : 0),
		];
	}

	BuildUserMessageProtobufFields(MessageFields) {
		if (!IsPlainObject(MessageFields)) {
			throw new TypeError("SayText MessageFields require a plain object.");
		}

		const nSenderIndex = RequireMessageInteger(MessageFields.SenderIndex, "SayText SenderIndex");
		const bChatEnabled = RequireBoolean(MessageFields.Chat, "SayText Chat");
		const strMessageColor = RequireString(MessageFields.Color, "SayText Color");
		const strMessageText = RequireString(MessageFields.Message, "SayText Message");

		return [
			CreateProtobufSetField("int32", "ent_idx", nSenderIndex),
			CreateProtobufSetField("bool", "chat", bChatEnabled),
			CreateProtobufSetField("string", "text", `${strMessageColor}${FormatTemplate(strMessageText, MessageFields)}`),
		];
	}

	DeliverUserMessage(MessagePayload) {
		return UserMessageCreator.prototype.DeliverUserMessage.call(this, MessagePayload);
	}
}

Object.defineProperty(SayText, "TRANSLATABLE_FIELDS", { value: Object.freeze(["Message"]), writable: true, enumerable: true, configurable: true });
Object.defineProperty(SayText, "MessageName", { value: "SayText", writable: true, enumerable: true, configurable: true });

class SayText2 extends TextMessage {
	constructor(strMessageText, MessageOptions = {}) {
		if (!IsPlainObject(MessageOptions)) {
			throw new TypeError("SayText2 MessageOptions require a plain object.");
		}

		const bChatEnabled = ReadBooleanOption(MessageOptions, "Chat", false, "SayText2");
		const strParameter1 = ReadStringOption(MessageOptions, "Parameter1", "", "SayText2");
		const strParameter2 = ReadStringOption(MessageOptions, "Parameter2", "", "SayText2");
		const strParameter3 = ReadStringOption(MessageOptions, "Parameter3", "", "SayText2");
		const strParameter4 = ReadStringOption(MessageOptions, "Parameter4", "", "SayText2");
		const nSenderIndex = ReadMessageIntegerOption(MessageOptions, "SenderIndex", 0, "SayText2");
		const strMessageColor = Object.hasOwn(MessageOptions, "Color") ? RequireString(MessageOptions.Color, "SayText2 Color") : ((RequireMessageBackend() === "protobuf") ? " \x01" : "\x01");

		super(strMessageText, {
			Chat: bChatEnabled,
			Color: strMessageColor,
			Parameter1: strParameter1,
			Parameter2: strParameter2,
			Parameter3: strParameter3,
			Parameter4: strParameter4,
			SenderIndex: nSenderIndex,
		});

		this.ReliableDelivery = true;
	}

	BuildUserMessageBitBufferFields(MessageFields) {
		if (!IsPlainObject(MessageFields)) {
			throw new TypeError("SayText2 MessageFields require a plain object.");
		}

		const nSenderIndex = RequireMessageInteger(MessageFields.SenderIndex, "SayText2 SenderIndex");
		const bChatEnabled = RequireBoolean(MessageFields.Chat, "SayText2 Chat");
		const strMessageColor = RequireString(MessageFields.Color, "SayText2 Color");
		const strMessageText = RequireString(MessageFields.Message, "SayText2 Message");
		const strParameter1 = RequireString(MessageFields.Parameter1, "SayText2 Parameter1");
		const strParameter2 = RequireString(MessageFields.Parameter2, "SayText2 Parameter2");
		const strParameter3 = RequireString(MessageFields.Parameter3, "SayText2 Parameter3");
		const strParameter4 = RequireString(MessageFields.Parameter4, "SayText2 Parameter4");

		return [
			CreateByteField(nSenderIndex),
			CreateByteField(bChatEnabled ? 1 : 0),
			CreateFormattedStringField(`${strMessageColor}${strMessageText}`, MessageFields),
			CreateFormattedStringField(strParameter1, MessageFields),
			CreateFormattedStringField(strParameter2, MessageFields),
			CreateFormattedStringField(strParameter3, MessageFields),
			CreateFormattedStringField(strParameter4, MessageFields),
		];
	}

	BuildUserMessageProtobufFields(MessageFields) {
		if (!IsPlainObject(MessageFields)) {
			throw new TypeError("SayText2 MessageFields require a plain object.");
		}

		const nSenderIndex = RequireMessageInteger(MessageFields.SenderIndex, "SayText2 SenderIndex");
		const bChatEnabled = RequireBoolean(MessageFields.Chat, "SayText2 Chat");
		const strMessageColor = RequireString(MessageFields.Color, "SayText2 Color");
		const strMessageText = RequireString(MessageFields.Message, "SayText2 Message");
		const strParameter1 = RequireString(MessageFields.Parameter1, "SayText2 Parameter1");
		const strParameter2 = RequireString(MessageFields.Parameter2, "SayText2 Parameter2");
		const strParameter3 = RequireString(MessageFields.Parameter3, "SayText2 Parameter3");
		const strParameter4 = RequireString(MessageFields.Parameter4, "SayText2 Parameter4");

		return [
			CreateProtobufSetField("string", "msg_name", `${strMessageColor}${FormatTemplate(strMessageText, MessageFields)}`),
			CreateProtobufSetField("bool", "chat", bChatEnabled),
			CreateProtobufSetField("int32", "ent_idx", nSenderIndex),
			CreateProtobufAddField("string", "params", FormatTemplate(strParameter1, MessageFields)),
			CreateProtobufAddField("string", "params", FormatTemplate(strParameter2, MessageFields)),
			CreateProtobufAddField("string", "params", FormatTemplate(strParameter3, MessageFields)),
			CreateProtobufAddField("string", "params", FormatTemplate(strParameter4, MessageFields)),
		];
	}

	DeliverUserMessage(MessagePayload) {
		return UserMessageCreator.prototype.DeliverUserMessage.call(this, MessagePayload);
	}
}

Object.defineProperty(SayText2, "TRANSLATABLE_FIELDS", { value: Object.freeze(["Message", "Parameter1", "Parameter2", "Parameter3", "Parameter4"]), writable: true, enumerable: true, configurable: true });
Object.defineProperty(SayText2, "MessageName", { value: "SayText2", writable: true, enumerable: true, configurable: true });

class HintText extends TextMessage {
	BuildUserMessageBitBufferFields(MessageFields) {
		if (!IsPlainObject(MessageFields)) {
			throw new TypeError("HintText MessageFields require a plain object.");
		}

		const strMessageText = RequireString(MessageFields.Message, "HintText Message");

		return [CreateFormattedStringField(strMessageText, MessageFields)];
	}

	BuildUserMessageProtobufFields(MessageFields) {
		if (!IsPlainObject(MessageFields)) {
			throw new TypeError("HintText MessageFields require a plain object.");
		}

		const strMessageText = RequireString(MessageFields.Message, "HintText Message");

		return [CreateProtobufSetField("string", "text", FormatTemplate(strMessageText, MessageFields))];
	}

	DeliverUserMessage(MessagePayload) {
		return UserMessageCreator.prototype.DeliverUserMessage.call(this, MessagePayload);
	}
}

Object.defineProperty(HintText, "TRANSLATABLE_FIELDS", { value: Object.freeze(["Message"]), writable: true, enumerable: true, configurable: true });
Object.defineProperty(HintText, "MessageName", { value: "HintText", writable: true, enumerable: true, configurable: true });

class Shake extends UserMessageCreator {
	constructor(ShakeOptions) {
		if (!IsPlainObject(ShakeOptions)) {
			throw new TypeError("Shake ShakeOptions require a plain object.");
		}

		if (!Object.hasOwn(ShakeOptions, "Amplitude")) {
			throw new TypeError("Shake Amplitude requires a finite number.");
		}

		if (!Object.hasOwn(ShakeOptions, "Duration")) {
			throw new TypeError("Shake Duration requires a finite number.");
		}

		const flShakeAmplitude = RequireMessageNumber(ShakeOptions.Amplitude, "Shake Amplitude");
		const unShakeCommand = ReadMessageIntegerOption(ShakeOptions, "Command", SHAKE_COMMAND.Start, "Shake");
		const flShakeDuration = RequireMessageNumber(ShakeOptions.Duration, "Shake Duration");
		const flShakeFrequency = ReadMessageNumberOption(ShakeOptions, "Frequency", 1, "Shake");
		super({ Amplitude: flShakeAmplitude, Command: unShakeCommand, Duration: flShakeDuration, Frequency: flShakeFrequency });
	}

	BuildUserMessageBitBufferFields(MessageFields) {
		if (!IsPlainObject(MessageFields)) {
			throw new TypeError("Shake MessageFields require a plain object.");
		}

		const unShakeCommand = RequireMessageInteger(MessageFields.Command, "Shake Command");
		const flShakeAmplitude = RequireMessageNumber(MessageFields.Amplitude, "Shake Amplitude");
		const flShakeFrequency = RequireMessageNumber(MessageFields.Frequency, "Shake Frequency");
		const flShakeDuration = RequireMessageNumber(MessageFields.Duration, "Shake Duration");

		return [
			CreateByteField(unShakeCommand),
			CreateFloatField(flShakeAmplitude),
			CreateFloatField(flShakeFrequency),
			CreateFloatField(flShakeDuration),
		];
	}

	BuildUserMessageProtobufFields(MessageFields) {
		if (!IsPlainObject(MessageFields)) {
			throw new TypeError("Shake MessageFields require a plain object.");
		}

		const unShakeCommand = RequireMessageInteger(MessageFields.Command, "Shake Command");
		const flShakeAmplitude = RequireMessageNumber(MessageFields.Amplitude, "Shake Amplitude");
		const flShakeFrequency = RequireMessageNumber(MessageFields.Frequency, "Shake Frequency");
		const flShakeDuration = RequireMessageNumber(MessageFields.Duration, "Shake Duration");

		return [
			CreateProtobufSetField("int32", "command", unShakeCommand),
			CreateProtobufSetField("float", "local_amplitude", flShakeAmplitude),
			CreateProtobufSetField("float", "frequency", flShakeFrequency),
			CreateProtobufSetField("float", "duration", flShakeDuration),
		];
	}
}

Object.defineProperty(Shake, "MessageName", { value: "Shake", writable: true, enumerable: true, configurable: true });

class ResetHUD extends UserMessageCreator {
	constructor(bResetEnabled = true) {
		const bValidatedResetState = RequireBoolean(bResetEnabled, "ResetHUD Reset");
		super({ Reset: bValidatedResetState });
	}

	BuildUserMessageBitBufferFields(MessageFields) {
		if (!IsPlainObject(MessageFields)) {
			throw new TypeError("ResetHUD MessageFields require a plain object.");
		}

		const bResetEnabled = RequireBoolean(MessageFields.Reset, "ResetHUD Reset");

		return [CreateByteField(bResetEnabled ? 0x01 : 0x00)];
	}

	BuildUserMessageProtobufFields(MessageFields) {
		if (!IsPlainObject(MessageFields)) {
			throw new TypeError("ResetHUD MessageFields require a plain object.");
		}

		const bResetEnabled = RequireBoolean(MessageFields.Reset, "ResetHUD Reset");

		return [CreateProtobufSetField("bool", "reset", bResetEnabled)];
	}
}

Object.defineProperty(ResetHUD, "MessageName", { value: "ResetHud", writable: true, enumerable: true, configurable: true });

class HUDTextMessage extends UserMessageCreator {
	constructor(strMessageText, MessageOptions = {}) {
		if (!IsPlainObject(MessageOptions)) {
			throw new TypeError("HUDTextMessage MessageOptions require a plain object.");
		}

		const strValidatedMessageText = RequireString(strMessageText, "HUDTextMessage Message");
		const strParameter1 = ReadStringOption(MessageOptions, "Parameter1", "", "HUDTextMessage");
		const strParameter2 = ReadStringOption(MessageOptions, "Parameter2", "", "HUDTextMessage");
		const strParameter3 = ReadStringOption(MessageOptions, "Parameter3", "", "HUDTextMessage");
		const strParameter4 = ReadStringOption(MessageOptions, "Parameter4", "", "HUDTextMessage");
		const unMessageDestination = ReadMessageIntegerOption(MessageOptions, "Destination", HUD_DESTINATION.Center, "HUDTextMessage");

		const ConfiguredMessageFields = {
			Message: strValidatedMessageText,
			Destination: unMessageDestination,
			Parameter1: strParameter1,
			Parameter2: strParameter2,
			Parameter3: strParameter3,
			Parameter4: strParameter4,
		};
		super(ConfiguredMessageFields, { Reliable: true });
	}

	BuildUserMessageBitBufferFields(MessageFields) {
		if (!IsPlainObject(MessageFields)) {
			throw new TypeError("HUDTextMessage MessageFields require a plain object.");
		}

		const unMessageDestination = RequireMessageInteger(MessageFields.Destination, "HUDTextMessage Destination");
		const strMessageText = RequireString(MessageFields.Message, "HUDTextMessage Message");
		const strParameter1 = RequireString(MessageFields.Parameter1, "HUDTextMessage Parameter1");
		const strParameter2 = RequireString(MessageFields.Parameter2, "HUDTextMessage Parameter2");
		const strParameter3 = RequireString(MessageFields.Parameter3, "HUDTextMessage Parameter3");
		const strParameter4 = RequireString(MessageFields.Parameter4, "HUDTextMessage Parameter4");

		return [
			CreateByteField(unMessageDestination),
			CreateFormattedStringField(strMessageText, MessageFields),
			CreateFormattedStringField(strParameter1, MessageFields),
			CreateFormattedStringField(strParameter2, MessageFields),
			CreateFormattedStringField(strParameter3, MessageFields),
			CreateFormattedStringField(strParameter4, MessageFields),
		];
	}

	BuildUserMessageProtobufFields(MessageFields) {
		if (!IsPlainObject(MessageFields)) {
			throw new TypeError("HUDTextMessage MessageFields require a plain object.");
		}

		const unMessageDestination = RequireMessageInteger(MessageFields.Destination, "HUDTextMessage Destination");
		const strMessageText = RequireString(MessageFields.Message, "HUDTextMessage Message");
		const strParameter1 = RequireString(MessageFields.Parameter1, "HUDTextMessage Parameter1");
		const strParameter2 = RequireString(MessageFields.Parameter2, "HUDTextMessage Parameter2");
		const strParameter3 = RequireString(MessageFields.Parameter3, "HUDTextMessage Parameter3");
		const strParameter4 = RequireString(MessageFields.Parameter4, "HUDTextMessage Parameter4");

		return [
			CreateProtobufSetField("int32", "msg_dst", unMessageDestination),
			CreateProtobufAddField("string", "params", FormatTemplate(strMessageText, MessageFields)),
			CreateProtobufAddField("string", "params", FormatTemplate(strParameter1, MessageFields)),
			CreateProtobufAddField("string", "params", FormatTemplate(strParameter2, MessageFields)),
			CreateProtobufAddField("string", "params", FormatTemplate(strParameter3, MessageFields)),
			CreateProtobufAddField("string", "params", FormatTemplate(strParameter4, MessageFields)),
		];
	}
}

Object.defineProperty(HUDTextMessage, "TRANSLATABLE_FIELDS", { value: Object.freeze(["Message", "Parameter1", "Parameter2", "Parameter3", "Parameter4"]), writable: true, enumerable: true, configurable: true });
Object.defineProperty(HUDTextMessage, "MessageName", { value: "TextMsg", writable: true, enumerable: true, configurable: true });

function FormatKeyHintText(MessageFields) {
	if (!IsPlainObject(MessageFields)) {
		throw new TypeError("KeyHintText MessageFields require a plain object.");
	}

	const vecHintTexts = MessageFields.Hints;
	if (!Array.isArray(vecHintTexts)) {
		throw new TypeError("KeyHintText Hints require an array.");
	}

	const unHintCount = vecHintTexts.length;
	const vecFormattedHints = [];
	for (let unHintIndex = 0; unHintIndex < unHintCount; unHintIndex += 1) {
		const strHintText = RequireString(vecHintTexts[unHintIndex], `KeyHintText hint ${unHintIndex}`);
		vecFormattedHints.push(FormatTemplate(strHintText, MessageFields));
	}

	return vecFormattedHints.join("\n");
}

class KeyHintText extends UserMessageCreator {
	constructor(vecHints) {
		if (!Array.isArray(vecHints)) {
			throw new TypeError("KeyHintText Hints require an array.");
		}

		const unHintCount = vecHints.length;
		for (let unHintIndex = 0; unHintIndex < unHintCount; unHintIndex += 1) {
			RequireString(vecHints[unHintIndex], `KeyHintText hint ${unHintIndex}`);
		}

		super({ Hints: vecHints });
	}

	BuildUserMessageBitBufferFields(MessageFields) {
		const unHintStringCount = 1;
		const strHintText = FormatKeyHintText(MessageFields);

		return [CreateByteField(unHintStringCount), CreateStringField(strHintText)];
	}

	toString(MessageFields = this.MessageFields) {
		return FormatKeyHintText(MessageFields);
	}

	TranslateUserMessageFields(strLanguageCode = null, TranslationTokens = {}) {
		if ((strLanguageCode !== null) && (typeof strLanguageCode !== "string")) {
			throw new TypeError("KeyHintText language requires a string or null.");
		}

		if (!IsPlainObject(TranslationTokens)) {
			throw new TypeError("KeyHintText translation tokens require a plain object.");
		}

		const MessageFields = this.MessageFields;
		if (!IsPlainObject(MessageFields)) {
			throw new TypeError("KeyHintText MessageFields require a plain object.");
		}

		const TranslatedFields = { ...MessageFields };
		const vecHintTexts = TranslatedFields.Hints;
		if (!Array.isArray(vecHintTexts)) {
			throw new TypeError("KeyHintText Hints require an array.");
		}

		const unHintCount = vecHintTexts.length;
		const vecTranslatedHints = [];
		for (let unHintIndex = 0; unHintIndex < unHintCount; unHintIndex += 1) {
			const strHintText = RequireString(vecHintTexts[unHintIndex], `KeyHintText hint ${unHintIndex}`);
			vecTranslatedHints.push(TranslateMessageValue(strHintText, strLanguageCode, TranslationTokens));
		}

		TranslatedFields.Hints = vecTranslatedHints;

		return TranslatedFields;
	}

	BuildUserMessageProtobufFields(MessageFields) {
		if (!IsPlainObject(MessageFields)) {
			throw new TypeError("KeyHintText MessageFields require a plain object.");
		}

		const vecHintTexts = MessageFields.Hints;
		if (!Array.isArray(vecHintTexts)) {
			throw new TypeError("KeyHintText Hints require an array.");
		}

		const unHintCount = vecHintTexts.length;
		const vecMessageFieldEntries = [];
		for (let unHintIndex = 0; unHintIndex < unHintCount; unHintIndex += 1) {
			const strHintText = RequireString(vecHintTexts[unHintIndex], `KeyHintText hint ${unHintIndex}`);
			vecMessageFieldEntries.push(CreateProtobufAddField("string", "hints", FormatTemplate(strHintText, MessageFields)));
		}

		return vecMessageFieldEntries;
	}
}

Object.defineProperty(KeyHintText, "TRANSLATABLE_FIELDS", { value: Object.freeze(["Hints"]), writable: true, enumerable: true, configurable: true });
Object.defineProperty(KeyHintText, "MessageName", { value: "KeyHintText", writable: true, enumerable: true, configurable: true });

class Fade extends UserMessageCreator {
	constructor(FadeOptions) {
		if (!IsPlainObject(FadeOptions)) {
			throw new TypeError("Fade FadeOptions require a plain object.");
		}

		if (!Object.hasOwn(FadeOptions, "Duration")) {
			throw new TypeError("Fade Duration requires a finite number.");
		}

		if (!Object.hasOwn(FadeOptions, "HoldTime")) {
			throw new TypeError("Fade HoldTime requires a finite number.");
		}

		const flFadeDuration = RequireMessageNumber(FadeOptions.Duration, "Fade Duration");
		const flFadeHoldTime = RequireMessageNumber(FadeOptions.HoldTime, "Fade HoldTime");
		const MessageColor = ReadMessageColorOption(FadeOptions, "Color", g_DefaultColor, "Fade");
		const unFadeFlags = ReadMessageIntegerOption(FadeOptions, "Flags", FADE_FLAGS.In, "Fade");
		super({ Duration: flFadeDuration, HoldTime: flFadeHoldTime, Color: MessageColor, Flags: unFadeFlags });
	}

	BuildUserMessageBitBufferFields(MessageFields) {
		if (!IsPlainObject(MessageFields)) {
			throw new TypeError("Fade MessageFields require a plain object.");
		}

		const flFadeDuration = RequireMessageNumber(MessageFields.Duration, "Fade Duration");
		const flFadeHoldTime = RequireMessageNumber(MessageFields.HoldTime, "Fade HoldTime");
		const unFadeFlags = RequireMessageInteger(MessageFields.Flags, "Fade Flags");
		const nEncodedDuration = RequireMessageInteger(flFadeDuration * g_unScreenFadeFactor, "Fade EncodedDuration");
		const nEncodedHoldTime = RequireMessageInteger(flFadeHoldTime * g_unScreenFadeFactor, "Fade EncodedHoldTime");

		return [
			CreateShortField(nEncodedDuration),
			CreateShortField(nEncodedHoldTime),
			CreateShortField(unFadeFlags),
			...CreateColorByteFields(MessageFields.Color, "Fade Color"),
		];
	}

	BuildUserMessageProtobufFields(MessageFields) {
		if (!IsPlainObject(MessageFields)) {
			throw new TypeError("Fade MessageFields require a plain object.");
		}

		const flFadeDuration = RequireMessageNumber(MessageFields.Duration, "Fade Duration");
		const flFadeHoldTime = RequireMessageNumber(MessageFields.HoldTime, "Fade HoldTime");
		const unFadeFlags = RequireMessageInteger(MessageFields.Flags, "Fade Flags");
		const nEncodedDuration = RequireMessageInteger(flFadeDuration * g_unScreenFadeFactor, "Fade EncodedDuration");
		const nEncodedHoldTime = RequireMessageInteger(flFadeHoldTime * g_unScreenFadeFactor, "Fade EncodedHoldTime");

		return [
			CreateProtobufSetField("int32", "duration", nEncodedDuration),
			CreateProtobufSetField("int32", "hold_time", nEncodedHoldTime),
			CreateProtobufSetField("int32", "flags", unFadeFlags),
			CreateColorProtobufField("clr", MessageFields.Color, "Fade Color"),
		];
	}
}

Object.defineProperty(Fade, "MessageName", { value: "Fade", writable: true, enumerable: true, configurable: true });

class HUDMessage extends UserMessageCreator {
	constructor(strMessageText, MessageOptions = {}) {
		if (!IsPlainObject(MessageOptions)) {
			throw new TypeError("HUDMessage MessageOptions require a plain object.");
		}

		const strValidatedMessageText = RequireString(strMessageText, "HUDMessage Message");
		const unMessageChannel = ReadMessageIntegerOption(MessageOptions, "Channel", 0, "HUDMessage");
		const unMessageEffect = ReadMessageIntegerOption(MessageOptions, "Effect", 0, "HUDMessage");
		const flMessageEffectTime = ReadMessageNumberOption(MessageOptions, "EffectTime", 0, "HUDMessage");
		const flMessageFadeIn = ReadMessageNumberOption(MessageOptions, "FadeIn", 0, "HUDMessage");
		const flMessageFadeOut = ReadMessageNumberOption(MessageOptions, "FadeOut", 0, "HUDMessage");
		const flMessageHoldTime = ReadMessageNumberOption(MessageOptions, "HoldTime", 4, "HUDMessage");
		const MessagePrimaryColor = ReadMessageColorOption(MessageOptions, "PrimaryColor", g_DefaultColor, "HUDMessage");
		const MessageSecondaryColor = ReadMessageColorOption(MessageOptions, "SecondaryColor", g_DefaultColor, "HUDMessage");
		const flMessageX = ReadMessageNumberOption(MessageOptions, "X", -1, "HUDMessage");
		const flMessageY = ReadMessageNumberOption(MessageOptions, "Y", -1, "HUDMessage");
		super({
			Channel: unMessageChannel,
			Effect: unMessageEffect,
			EffectTime: flMessageEffectTime,
			FadeIn: flMessageFadeIn,
			FadeOut: flMessageFadeOut,
			HoldTime: flMessageHoldTime,
			Message: strValidatedMessageText,
			PrimaryColor: MessagePrimaryColor,
			SecondaryColor: MessageSecondaryColor,
			X: flMessageX,
			Y: flMessageY,
		});
	}

	BuildUserMessageBitBufferFields(MessageFields) {
		if (!IsPlainObject(MessageFields)) {
			throw new TypeError("HUDMessage MessageFields require a plain object.");
		}

		const unMessageChannel = RequireMessageInteger(MessageFields.Channel, "HUDMessage Channel");
		const flMessageX = RequireMessageNumber(MessageFields.X, "HUDMessage X");
		const flMessageY = RequireMessageNumber(MessageFields.Y, "HUDMessage Y");
		const MessagePrimaryColor = MessageFields.PrimaryColor;
		const MessageSecondaryColor = MessageFields.SecondaryColor;
		const unMessageEffect = RequireMessageInteger(MessageFields.Effect, "HUDMessage Effect");
		const flMessageFadeIn = RequireMessageNumber(MessageFields.FadeIn, "HUDMessage FadeIn");
		const flMessageFadeOut = RequireMessageNumber(MessageFields.FadeOut, "HUDMessage FadeOut");
		const flMessageHoldTime = RequireMessageNumber(MessageFields.HoldTime, "HUDMessage HoldTime");
		const flMessageEffectTime = RequireMessageNumber(MessageFields.EffectTime, "HUDMessage EffectTime");
		const strMessageText = RequireString(MessageFields.Message, "HUDMessage Message");

		return [
			CreateByteField(unMessageChannel),
			CreateFloatField(flMessageX),
			CreateFloatField(flMessageY),
			...CreateColorByteFields(MessagePrimaryColor, "HUDMessage PrimaryColor"),
			...CreateColorByteFields(MessageSecondaryColor, "HUDMessage SecondaryColor"),
			CreateByteField(unMessageEffect),
			CreateFloatField(flMessageFadeIn),
			CreateFloatField(flMessageFadeOut),
			CreateFloatField(flMessageHoldTime),
			CreateFloatField(flMessageEffectTime),
			CreateFormattedStringField(strMessageText, MessageFields),
		];
	}

	toString(MessageFields = this.MessageFields) {
		if (!IsPlainObject(MessageFields)) {
			throw new TypeError("HUDMessage MessageFields require a plain object.");
		}

		return FormatTemplate(RequireString(MessageFields.Message, "HUDMessage Message"), MessageFields);
	}

	BuildUserMessageProtobufFields(MessageFields) {
		if (!IsPlainObject(MessageFields)) {
			throw new TypeError("HUDMessage MessageFields require a plain object.");
		}

		const unMessageChannel = RequireMessageInteger(MessageFields.Channel, "HUDMessage Channel");
		const flMessageX = RequireMessageNumber(MessageFields.X, "HUDMessage X");
		const flMessageY = RequireMessageNumber(MessageFields.Y, "HUDMessage Y");
		const MessagePrimaryColor = MessageFields.PrimaryColor;
		const MessageSecondaryColor = MessageFields.SecondaryColor;
		const unMessageEffect = RequireMessageInteger(MessageFields.Effect, "HUDMessage Effect");
		const flMessageFadeIn = RequireMessageNumber(MessageFields.FadeIn, "HUDMessage FadeIn");
		const flMessageFadeOut = RequireMessageNumber(MessageFields.FadeOut, "HUDMessage FadeOut");
		const flMessageHoldTime = RequireMessageNumber(MessageFields.HoldTime, "HUDMessage HoldTime");
		const flMessageEffectTime = RequireMessageNumber(MessageFields.EffectTime, "HUDMessage EffectTime");
		const strMessageText = RequireString(MessageFields.Message, "HUDMessage Message");

		return [
			CreateProtobufSetField("int32", "channel", unMessageChannel),
			CreateProtobufMessageField("pos", [
				CreateProtobufSetField("float", "x", flMessageX),
				CreateProtobufSetField("float", "y", flMessageY),
			]),
			CreateColorProtobufField("clr1", MessagePrimaryColor, "HUDMessage PrimaryColor"),
			CreateColorProtobufField("clr2", MessageSecondaryColor, "HUDMessage SecondaryColor"),
			CreateProtobufSetField("int32", "effect", unMessageEffect),
			CreateProtobufSetField("float", "fade_in_time", flMessageFadeIn),
			CreateProtobufSetField("float", "fade_out_time", flMessageFadeOut),
			CreateProtobufSetField("float", "hold_time", flMessageHoldTime),
			CreateProtobufSetField("float", "fx_time", flMessageEffectTime),
			CreateProtobufSetField("string", "text", FormatTemplate(strMessageText, MessageFields)),
		];
	}
}

Object.defineProperty(HUDMessage, "TRANSLATABLE_FIELDS", { value: Object.freeze(["Message"]), writable: true, enumerable: true, configurable: true });
Object.defineProperty(HUDMessage, "MessageName", { value: "HudMsg", writable: true, enumerable: true, configurable: true });

function SendUserMessageValue(TargetReferences, MessageValue, TranslationTokens = {}) {
	if (!IsPlainObject(TranslationTokens)) {
		throw new TypeError("SendUserMessageValue() tokens require a plain object.");
	}

	if (MessageValue instanceof UserMessage) {
		return MessageValue.SendUserMessage(TargetReferences);
	}

	if (MessageValue instanceof UserMessageCreator) {
		return MessageValue.SendUserMessage(TargetReferences, TranslationTokens);
	}

	const strMessageText = RequireString(MessageValue, "SendUserMessageValue() MessageValue");
	const MessageFields = { ...TranslationTokens, Message: strMessageText };
	const TextMessageInstance = new TextMessage(strMessageText, MessageFields);

	return TextMessageInstance.SendUserMessage(TargetReferences, TranslationTokens);
}

function GetMessageBackend() {
	return g_NativeGetMessageBackend();
}

function GetBaseMessageConstants() {
	return g_NativeGetBaseMessageConstants();
}

function GetUserMessageIndex(strMessageName) {
	return g_NativeGetUserMessageIndex(strMessageName);
}

function GetUserMessageName(nMessageIndex) {
	return g_NativeGetUserMessageName(nMessageIndex);
}

function GetUserMessageSize(nMessageIndex) {
	return g_NativeGetUserMessageSize(nMessageIndex);
}

function SendSayTextMessage(PlayerOrIndex, strMessageText, SenderOrIndex = 0, bChatEnabled = true) {
	return g_NativeSendSayTextMessage(PlayerOrIndex, strMessageText, SenderOrIndex, bChatEnabled);
}

function SendSayText2Message(PlayerOrIndex, strMessageText, SenderOrIndex = 0, bChatEnabled = true) {
	return g_NativeSendSayText2Message(PlayerOrIndex, strMessageText, SenderOrIndex, bChatEnabled);
}

function SendUserMessage(strMessageName, TargetReferences, vecMessageFields, bReliableDelivery = false) {
	return g_NativeSendUserMessage(strMessageName, TargetReferences, vecMessageFields, bReliableDelivery);
}

const g_MessagesExports = {
	HintText: HintText,
	HUDMessage: HUDMessage,
	KeyHintText: KeyHintText,
	CustomUserMessageCreator: CustomUserMessageCreator,
	ResetHUD: ResetHUD,
	SayText: SayText,
	SayText2: SayText2,
	ShowMenu: ShowMenu,
	TextMessage: TextMessage,
	UserMessage: UserMessage,
	UserMessageCreator: UserMessageCreator,
	VGUIMenu: VGUIMenu,
	SendUserMessageValue: SendUserMessageValue,
};

if (g_NativeGetBaseMessageConstants !== null) {
	g_MessagesExports.GetBaseMessageConstants = GetBaseMessageConstants;
	g_MessagesExports.SCREEN_FADE_FRACTION_BITS = SCREEN_FADE_FRACTION_BITS;
	g_MessagesExports.Fade = Fade;
	g_MessagesExports.FADE_FLAGS = FADE_FLAGS;
	g_MessagesExports.HUDTextMessage = HUDTextMessage;
	g_MessagesExports.HUD_DESTINATION = HUD_DESTINATION;
	g_MessagesExports.Shake = Shake;
	g_MessagesExports.SHAKE_COMMAND = SHAKE_COMMAND;
}

if (g_NativeGetMessageBackend !== null) {
	g_MessagesExports.GetMessageBackend = GetMessageBackend;
}

if (g_NativeGetUserMessageIndex !== null) {
	g_MessagesExports.GetUserMessageIndex = GetUserMessageIndex;
}

if (g_NativeGetUserMessageName !== null) {
	g_MessagesExports.GetUserMessageName = GetUserMessageName;
}

if (g_NativeGetUserMessageSize !== null) {
	g_MessagesExports.GetUserMessageSize = GetUserMessageSize;
}

if (g_NativeSendSayTextMessage !== null) {
	g_MessagesExports.SendSayTextMessage = SendSayTextMessage;
}

if (g_NativeSendSayText2Message !== null) {
	g_MessagesExports.SendSayText2Message = SendSayText2Message;
}

if (g_NativeSendUserMessage !== null) {
	g_MessagesExports.SendUserMessage = SendUserMessage;
}

module.exports = g_MessagesExports;
