"use strict";

const { GetModule } = require("internal/runtime");
const g_RecipientFiltersRuntime = require("filters/recipients");

const g_vecMessageImplementationNames = Object.freeze([
	"SayText",
	"SayText2",
	"HintText",
	"Shake",
	"ResetHud",
	"TextMsg",
	"KeyHintText",
	"Fade",
	"HudMsg",
	"ShowMenu",
	"VGUIMenu",
]);

const g_MessagesRuntime = GetModule("messages");
const g_BaseMessageConstants = (typeof g_MessagesRuntime.GetBaseMessageConstants === "function") ? g_MessagesRuntime.GetBaseMessageConstants() : null;
const g_unScreenFadeFactor = (g_BaseMessageConstants === null) ? null : (1 << g_BaseMessageConstants.SCREEN_FADE_FRACTION_BITS);
const g_unMaximumColorComponent = 255;
const g_mapUserMessageDataStates = new WeakMap();

function CallBufferMethod(MessageBuffer, strMethodName, ...vecMethodArguments) {
	if ((MessageBuffer === null) || (typeof MessageBuffer !== "object")) {
		throw new TypeError(`Buffer does not implement ${strMethodName}().`);
	}

	const BufferMethod = MessageBuffer[strMethodName];
	if (typeof BufferMethod !== "function") {
		throw new TypeError(`Buffer does not implement ${strMethodName}().`);
	}

	return Reflect.apply(BufferMethod, MessageBuffer, vecMethodArguments);
}

function NormalizeMessageInteger(nIntegerCandidate, nDefaultInteger = 0) {
	if ((nIntegerCandidate === null) || (nIntegerCandidate === undefined)) {
		return nDefaultInteger;
	}

	if (!Number.isSafeInteger(nIntegerCandidate)) {
		throw new TypeError("User message integer value must be a safe integer.");
	}

	return nIntegerCandidate;
}

function NormalizeMessageNumber(dblNumberCandidate, dblDefaultNumber = 0) {
	if ((dblNumberCandidate === null) || (dblNumberCandidate === undefined)) {
		return dblDefaultNumber;
	}

	if ((typeof dblNumberCandidate !== "number") || !Number.isFinite(dblNumberCandidate)) {
		throw new TypeError("User message numeric value must be finite.");
	}

	return dblNumberCandidate;
}

function ReadProtobufString(Buffer, strFieldName, strDefaultString = "") {
	const FieldValue = CallBufferMethod(Buffer, "GetString", strFieldName);
	if ((FieldValue === null) || (FieldValue === undefined)) {
		return strDefaultString;
	}

	if (typeof FieldValue !== "string") {
		throw new TypeError(`Protobuf field ${strFieldName} must be a string.`);
	}

	return FieldValue;
}

function ReadProtobufBool(Buffer, strFieldName, bDefaultBoolean = false) {
	const FieldValue = CallBufferMethod(Buffer, "GetBool", strFieldName);
	if ((FieldValue === null) || (FieldValue === undefined)) {
		return bDefaultBoolean;
	}

	if (typeof FieldValue !== "boolean") {
		throw new TypeError(`Protobuf field ${strFieldName} must be a boolean.`);
	}

	return FieldValue;
}

function ReadProtobufInt32(Buffer, strFieldName, nDefaultInteger = 0) {
	return NormalizeMessageInteger(CallBufferMethod(Buffer, "GetInt32", strFieldName), nDefaultInteger);
}

function ReadProtobufFloat(Buffer, strFieldName, dblDefaultNumber = 0) {
	return NormalizeMessageNumber(CallBufferMethod(Buffer, "GetFloat", strFieldName), dblDefaultNumber);
}

function ReadRepeatedProtobufString(Buffer, strFieldName, unFieldIndex, strDefaultString = "") {
	const unFieldCount = CallBufferMethod(Buffer, "GetFieldCount", strFieldName);
	if (unFieldIndex >= unFieldCount) {
		return strDefaultString;
	}

	const FieldValue = CallBufferMethod(Buffer, "GetRepeatedString", strFieldName, unFieldIndex);
	if ((FieldValue === null) || (FieldValue === undefined)) {
		return strDefaultString;
	}

	if (typeof FieldValue !== "string") {
		throw new TypeError(`Repeated protobuf field ${strFieldName} must contain strings.`);
	}

	return FieldValue;
}

function ReadProtobufFieldCount(Buffer, strFieldName) {
	return NormalizeMessageInteger(CallBufferMethod(Buffer, "GetFieldCount", strFieldName));
}

function ReadRepeatedProtobufMessage(Buffer, strFieldName, unFieldIndex) {
	return CallBufferMethod(Buffer, "GetMutableRepeatedMessage", strFieldName, unFieldIndex);
}

function ReadProtobufMessage(Buffer, strFieldName) {
	return CallBufferMethod(Buffer, "GetMutableMessage", strFieldName);
}

function SetOwnValue(TargetObject, strPropertyName, PropertyValue) {
	Object.defineProperty(TargetObject, strPropertyName, { configurable: true, enumerable: true, value: PropertyValue, writable: true });
}

function GetProtobufChildBuffer(Buffer, strFieldName, bIsRepeated = false) {
	if (bIsRepeated) {
		return CallBufferMethod(Buffer, "AddMessage", strFieldName);
	}

	return CallBufferMethod(Buffer, "GetMutableMessage", strFieldName);
}

function IsProtobufMessageBuffer(MessageBuffer) {
	if ((MessageBuffer === null) || (typeof MessageBuffer !== "object")) {
		return false;
	}

	return (typeof MessageBuffer.GetString === "function") || (typeof MessageBuffer.SetString === "function");
}

function GetNumericMessageIndex(strMessageName) {
	const nMessageIndex = g_MessagesRuntime.GetUserMessageIndex(strMessageName);
	if (!Number.isSafeInteger(nMessageIndex)) {
		throw new TypeError(`Message index for ${strMessageName} must be a safe integer.`);
	}

	return nMessageIndex;
}

function GetMessageNameFromIndex(nMessageIndex) {
	return g_MessagesRuntime.GetUserMessageName(nMessageIndex);
}

function ReadMessageDataValue(MessageData, strFieldName, DefaultFieldValue = null) {
	if ((MessageData === null) || (typeof MessageData !== "object") || Array.isArray(MessageData)) {
		throw new TypeError("User message data must be an object.");
	}

	return Object.hasOwn(MessageData, strFieldName) ? MessageData[strFieldName] : DefaultFieldValue;
}

function NormalizeMessageBoolean(bBooleanCandidate) {
	if (typeof bBooleanCandidate === "boolean") {
		return bBooleanCandidate;
	}

	if ((bBooleanCandidate === 0) || (bBooleanCandidate === 1)) {
		return bBooleanCandidate === 1;
	}

	throw new TypeError("User message boolean value must be boolean, 0, or 1.");
}

function NormalizeMessageString(strStringCandidate, strDefaultString = "") {
	if ((strStringCandidate === null) || (strStringCandidate === undefined)) {
		return strDefaultString;
	}

	if (typeof strStringCandidate !== "string") {
		throw new TypeError("User message string value must be a string.");
	}

	return strStringCandidate;
}

function NormalizeMessageColorComponent(ColorValue, strComponentName) {
	const nComponentValue = NormalizeMessageInteger(ColorValue[strComponentName], g_unMaximumColorComponent);
	if ((nComponentValue < 0) || (nComponentValue > g_unMaximumColorComponent)) {
		throw new RangeError(`User message color ${strComponentName} must be between 0 and 255.`);
	}

	return nComponentValue;
}

function NormalizeMessageColor(ColorValue = {}) {
	if ((ColorValue === null) || (typeof ColorValue !== "object") || Array.isArray(ColorValue)) {
		throw new TypeError("User message color must be an object.");
	}

	return { Red: NormalizeMessageColorComponent(ColorValue, "Red"), Green: NormalizeMessageColorComponent(ColorValue, "Green"), Blue: NormalizeMessageColorComponent(ColorValue, "Blue"), Alpha: NormalizeMessageColorComponent(ColorValue, "Alpha") };
}

function ReadBitBufferColor(BitBuffer) {
	return { Red: NormalizeMessageInteger(CallBufferMethod(BitBuffer, "ReadByte"), g_unMaximumColorComponent), Green: NormalizeMessageInteger(CallBufferMethod(BitBuffer, "ReadByte"), g_unMaximumColorComponent), Blue: NormalizeMessageInteger(CallBufferMethod(BitBuffer, "ReadByte"), g_unMaximumColorComponent), Alpha: NormalizeMessageInteger(CallBufferMethod(BitBuffer, "ReadByte"), g_unMaximumColorComponent) };
}

function WriteBitBufferColor(BitBuffer, ColorValue) {
	const NormalizedColor = NormalizeMessageColor(ColorValue);
	CallBufferMethod(BitBuffer, "WriteByte", NormalizedColor.Red);
	CallBufferMethod(BitBuffer, "WriteByte", NormalizedColor.Green);
	CallBufferMethod(BitBuffer, "WriteByte", NormalizedColor.Blue);
	CallBufferMethod(BitBuffer, "WriteByte", NormalizedColor.Alpha);
}

function ReadProtobufColor(ProtobufBuffer, strFieldName) {
	const ColorBuffer = ReadProtobufMessage(ProtobufBuffer, strFieldName);

	return { Red: ReadProtobufInt32(ColorBuffer, "r", g_unMaximumColorComponent), Green: ReadProtobufInt32(ColorBuffer, "g", g_unMaximumColorComponent), Blue: ReadProtobufInt32(ColorBuffer, "b", g_unMaximumColorComponent), Alpha: ReadProtobufInt32(ColorBuffer, "a", g_unMaximumColorComponent) };
}

function WriteProtobufColor(ProtobufBuffer, strFieldName, ColorValue) {
	const NormalizedColor = NormalizeMessageColor(ColorValue);
	const ColorBuffer = GetProtobufChildBuffer(ProtobufBuffer, strFieldName);
	CallBufferMethod(ColorBuffer, "SetInt32", "r", NormalizedColor.Red);
	CallBufferMethod(ColorBuffer, "SetInt32", "g", NormalizedColor.Green);
	CallBufferMethod(ColorBuffer, "SetInt32", "b", NormalizedColor.Blue);
	CallBufferMethod(ColorBuffer, "SetInt32", "a", NormalizedColor.Alpha);
}

function NormalizeUserMessageRecipients(TargetReferences) {
	const RecipientFilter = g_RecipientFiltersRuntime.CreateRecipientFilterFromValues(TargetReferences, true);

	return RecipientFilter.GetRecipientIndexes();
}

function RequireMessageRecipients(TargetReferences, strOperationName) {
	const vecRecipientIndexes = NormalizeUserMessageRecipients(TargetReferences);
	if (vecRecipientIndexes.length === 0) {
		throw new TypeError(`${strOperationName} requires at least one valid recipient.`);
	}

	return vecRecipientIndexes;
}

function RequireString(strCandidate, strOperationName) {
	if (typeof strCandidate !== "string") {
		throw new TypeError(`${strOperationName} requires a string.`);
	}

	return strCandidate;
}

function RequireBoolean(bCandidate, strOperationName) {
	if (typeof bCandidate !== "boolean") {
		throw new TypeError(`${strOperationName} requires a boolean.`);
	}

	return bCandidate;
}

function RequireInteger(nCandidate, strOperationName, nMinimumInteger = Number.MIN_SAFE_INTEGER) {
	if (!Number.isSafeInteger(nCandidate) || (nCandidate < nMinimumInteger)) {
		throw new TypeError(`${strOperationName} requires a safe integer greater than or equal to ${nMinimumInteger}.`);
	}

	return nCandidate;
}

function RequireNumber(dblCandidate, strOperationName, dblMinimumNumber = -Infinity) {
	if ((typeof dblCandidate !== "number") || !Number.isFinite(dblCandidate) || (dblCandidate < dblMinimumNumber)) {
		throw new TypeError(`${strOperationName} requires a finite number greater than or equal to ${dblMinimumNumber}.`);
	}

	return dblCandidate;
}

function RequirePlainObject(Value, strOperationName) {
	if ((Value === null) || (typeof Value !== "object") || Array.isArray(Value)) {
		throw new TypeError(`${strOperationName} requires an object.`);
	}

	const Prototype = Object.getPrototypeOf(Value);
	if ((Prototype !== Object.prototype) && (Prototype !== null)) {
		throw new TypeError(`${strOperationName} requires a plain object.`);
	}

	return Value;
}

function RequireUserMessageDataFieldName(strFieldName, strOperationName) {
	const strValidatedFieldName = RequireString(strFieldName, `${strOperationName} strFieldName`);
	if (strValidatedFieldName.length === 0) {
		throw new TypeError(`${strOperationName} strFieldName requires a non-empty string.`);
	}

	return strValidatedFieldName;
}

function DefineUserMessageDataField(MessageData, strFieldName, FieldValue, bHasChanged) {
	const strValidatedFieldName = RequireUserMessageDataFieldName(strFieldName, "DefineUserMessageDataField()");
	const MessageDataState = g_mapUserMessageDataStates.get(MessageData);
	Object.defineProperty(MessageData, strValidatedFieldName, {
		configurable: true,
		enumerable: true,
		get() {
			return MessageDataState.Values.get(strValidatedFieldName);
		},
		set(NextFieldValue) {
			MessageDataState.Values.set(strValidatedFieldName, NextFieldValue);
			MessageDataState.Changed = true;
		},
	});
	MessageDataState.Values.set(strValidatedFieldName, FieldValue);

	if (bHasChanged) {
		MessageDataState.Changed = true;
	}
}

function NormalizeHintTexts(MessageData, strOperationName) {
	const vecHintTexts = ReadMessageDataValue(MessageData, "Hints", []);
	if (!Array.isArray(vecHintTexts)) {
		throw new TypeError(`${strOperationName} Hints requires an array.`);
	}

	const vecNormalizedHintTexts = [];
	for (const strHintText of vecHintTexts) {
		vecNormalizedHintTexts.push(NormalizeMessageString(strHintText));
	}

	return vecNormalizedHintTexts;
}

function SendClientConsoleMessageToRecipients(TargetReferences, strMessageText) {
	const strOutputText = RequireString(strMessageText, "SendClientConsoleMessageToRecipients(strMessageText)");
	const vecRecipientIndexes = RequireMessageRecipients(TargetReferences, "SendClientConsoleMessageToRecipients(TargetReferences, strMessageText)");

	let bClientPrintResult = true;
	for (const unRecipientIndex of vecRecipientIndexes) {
		const bRecipientPrintResult = RequireBoolean(g_MessagesRuntime.SendClientConsoleMessage(unRecipientIndex, strOutputText), "SendClientConsoleMessage() result");
		bClientPrintResult = bRecipientPrintResult && bClientPrintResult;
	}

	return bClientPrintResult;
}

function SendClientCommandToRecipients(TargetReferences, strCommandLine) {
	const strValidatedCommandLine = RequireString(strCommandLine, "SendClientCommandToRecipients(strCommandLine)");
	const vecRecipientIndexes = RequireMessageRecipients(TargetReferences, "SendClientCommandToRecipients(TargetReferences, strCommandLine)");

	let bClientCommandResult = true;
	for (const unRecipientIndex of vecRecipientIndexes) {
		const bRecipientCommandResult = RequireBoolean(g_MessagesRuntime.SendClientCommand(unRecipientIndex, strValidatedCommandLine), "SendClientCommandToRecipients() result");
		bClientCommandResult = bRecipientCommandResult && bClientCommandResult;
	}

	return bClientCommandResult;
}

function SendSayTextMessageToRecipients(TargetReferences, strMessageText, unSenderIndex = 0, bSendToChat = true) {
	const strOutputText = RequireString(strMessageText, "SendSayTextMessageToRecipients(strMessageText)");
	const unValidatedSenderIndex = RequireInteger(unSenderIndex, "SendSayTextMessageToRecipients(unSenderIndex)", 0);
	const bValidatedSendToChat = RequireBoolean(bSendToChat, "SendSayTextMessageToRecipients(bSendToChat)");
	const vecRecipientIndexes = RequireMessageRecipients(TargetReferences, "SendSayTextMessageToRecipients(TargetReferences, strMessageText, unSenderIndex, bSendToChat)");

	let bSayTextResult = true;
	for (const unRecipientIndex of vecRecipientIndexes) {
		const bRecipientSayTextResult = RequireBoolean(g_MessagesRuntime.SendSayTextMessage(unRecipientIndex, strOutputText, unValidatedSenderIndex, bValidatedSendToChat), "SendSayTextMessageToRecipients() result");
		bSayTextResult = bRecipientSayTextResult && bSayTextResult;
	}

	return bSayTextResult;
}

function SendSayText2MessageToRecipients(TargetReferences, strMessageText, unSenderIndex = 0, bSendToChat = true) {
	const strOutputText = RequireString(strMessageText, "SendSayText2MessageToRecipients(strMessageText)");
	const unValidatedSenderIndex = RequireInteger(unSenderIndex, "SendSayText2MessageToRecipients(unSenderIndex)", 0);
	const bValidatedSendToChat = RequireBoolean(bSendToChat, "SendSayText2MessageToRecipients(bSendToChat)");
	const vecRecipientIndexes = RequireMessageRecipients(TargetReferences, "SendSayText2MessageToRecipients(TargetReferences, strMessageText, unSenderIndex, bSendToChat)");

	let bSayText2Result = true;
	for (const unRecipientIndex of vecRecipientIndexes) {
		const bRecipientSayText2Result = RequireBoolean(g_MessagesRuntime.SendSayText2Message(unRecipientIndex, strOutputText, unValidatedSenderIndex, bValidatedSendToChat), "SendSayText2MessageToRecipients() result");
		bSayText2Result = bRecipientSayText2Result && bSayText2Result;
	}

	return bSayText2Result;
}

function SendUserMessageToRecipients(TargetReferences, strMessageName, vecMessageFields, bReliableDelivery = false) {
	const strValidatedMessageName = RequireString(strMessageName, "SendUserMessageToRecipients(strMessageName)");

	if (!Array.isArray(vecMessageFields)) {
		throw new TypeError("SendUserMessageToRecipients(vecMessageFields) requires an array.");
	}

	const bValidatedReliableDelivery = RequireBoolean(bReliableDelivery, "SendUserMessageToRecipients(bReliableDelivery)");
	const vecRecipientIndexes = NormalizeUserMessageRecipients(TargetReferences);
	const bUserMessageResult = g_MessagesRuntime.SendUserMessage(strValidatedMessageName, vecRecipientIndexes, vecMessageFields, bValidatedReliableDelivery);

	return RequireBoolean(bUserMessageResult, "SendUserMessageToRecipients() result");
}

function SendDialogMessageDataToRecipients(TargetReferences, unDialogType, DialogValues, strDialogName = "menu") {
	const unValidatedDialogType = RequireInteger(unDialogType, "SendDialogMessageDataToRecipients(unDialogType)", 0);
	const ValidatedDialogValues = RequirePlainObject(DialogValues, "SendDialogMessageDataToRecipients(DialogValues)");
	const strValidatedDialogName = RequireString(strDialogName, "SendDialogMessageDataToRecipients(strDialogName)");
	const vecRecipientIndexes = RequireMessageRecipients(TargetReferences, "SendDialogMessageDataToRecipients(TargetReferences)");

	let bDialogDeliveryResult = true;
	for (const unRecipientIndex of vecRecipientIndexes) {
		const bRecipientDialogResult = RequireBoolean(g_MessagesRuntime.CreateDialog(unRecipientIndex, unValidatedDialogType, ValidatedDialogValues, strValidatedDialogName), "SendDialogMessageDataToRecipients() result");
		bDialogDeliveryResult = bRecipientDialogResult && bDialogDeliveryResult;
	}

	return bDialogDeliveryResult;
}

function SendDialogMessageToRecipients(TargetReferences, strDialogTitle, strDialogMessage, dblDisplayTime = 10) {
	const strValidatedDialogTitle = RequireString(strDialogTitle, "SendDialogMessageToRecipients(strDialogTitle)");
	const strValidatedDialogMessage = RequireString(strDialogMessage, "SendDialogMessageToRecipients(strDialogMessage)");
	const dblValidatedDisplayTime = RequireNumber(dblDisplayTime, "SendDialogMessageToRecipients(dblDisplayTime)", 0);

	return SendDialogMessageDataToRecipients(TargetReferences, g_MessagesRuntime.GetDialogType("Text"), { Level: 1, Msg: strValidatedDialogMessage, Time: dblValidatedDisplayTime, Title: strValidatedDialogTitle });
}

class UserMessageData {
	constructor(MessageFields = {}) {
		const ValidatedMessageFields = RequirePlainObject(MessageFields, "UserMessageData(MessageFields)");
		g_mapUserMessageDataStates.set(this, { Changed: false, Values: new Map() });

		for (const strFieldName in ValidatedMessageFields) {
			if (!Object.hasOwn(ValidatedMessageFields, strFieldName)) {
				continue;
			}

			DefineUserMessageDataField(this, strFieldName, ValidatedMessageFields[strFieldName], false);
		}
	}

	GetUserMessageField(strFieldName, DefaultFieldValue = undefined) {
		const strValidatedFieldName = RequireUserMessageDataFieldName(strFieldName, "UserMessageData.GetUserMessageField()");
		const MessageDataState = g_mapUserMessageDataStates.get(this);
		if (!MessageDataState.Values.has(strValidatedFieldName)) {
			return DefaultFieldValue;
		}

		return MessageDataState.Values.get(strValidatedFieldName);
	}

	SetUserMessageField(strFieldName, FieldValue) {
		const strValidatedFieldName = RequireUserMessageDataFieldName(strFieldName, "UserMessageData.SetUserMessageField()");
		const MessageDataState = g_mapUserMessageDataStates.get(this);
		if (MessageDataState.Values.has(strValidatedFieldName)) {
			this[strValidatedFieldName] = FieldValue;

		} else {
			DefineUserMessageDataField(this, strValidatedFieldName, FieldValue, true);
		}

		return this;
	}

	DeleteUserMessageField(strFieldName) {
		const strValidatedFieldName = RequireUserMessageDataFieldName(strFieldName, "UserMessageData.DeleteUserMessageField()");
		const MessageDataState = g_mapUserMessageDataStates.get(this);
		if (!MessageDataState.Values.has(strValidatedFieldName)) {
			return false;
		}

		if (!Reflect.deleteProperty(this, strValidatedFieldName)) {
			throw new TypeError(`UserMessageData.DeleteUserMessageField() cannot delete field ${strValidatedFieldName}.`);
		}

		MessageDataState.Values.delete(strValidatedFieldName);
		MessageDataState.Changed = true;

		return true;
	}

	HasUserMessageChanged() {
		return g_mapUserMessageDataStates.get(this).Changed;
	}

	SetUserMessageChanged(bHasChanged = true) {
		const bValidatedChangedState = RequireBoolean(bHasChanged, "UserMessageData.SetUserMessageChanged(bHasChanged)");
		g_mapUserMessageDataStates.get(this).Changed = bValidatedChangedState;

		return this;
	}
}

class UserMessageImplementation {
	static ReadUserMessageFromProtobuf() {
		throw new TypeError(`${this.name}.ReadUserMessageFromProtobuf() is not defined by this user message implementation.`);
	}

	static WriteUserMessageToProtobuf() {
		throw new TypeError(`${this.name}.WriteUserMessageToProtobuf() is not defined by this user message implementation.`);
	}

	static ReadUserMessageFromBitBuffer() {
		throw new TypeError(`${this.name}.ReadUserMessageFromBitBuffer() is not defined by this user message implementation.`);
	}

	static WriteUserMessageToBitBuffer() {
		throw new TypeError(`${this.name}.WriteUserMessageToBitBuffer() is not defined by this user message implementation.`);
	}

	static ReadUserMessage(MessageBuffer) {
		return IsProtobufMessageBuffer(MessageBuffer) ? this.ReadUserMessageFromProtobuf(MessageBuffer) : this.ReadUserMessageFromBitBuffer(MessageBuffer);
	}

	static WriteUserMessage(MessageBuffer, MessageData) {
		if (IsProtobufMessageBuffer(MessageBuffer)) {
			this.WriteUserMessageToProtobuf(MessageBuffer, MessageData);

		} else {
			this.WriteUserMessageToBitBuffer(MessageBuffer, MessageData);
		}

		return MessageBuffer;
	}
}

class SayTextUserMessageImplementation extends UserMessageImplementation {
	static ReadUserMessageFromProtobuf(ProtobufBuffer) {
		return new UserMessageData({ Chat: ReadProtobufBool(ProtobufBuffer, "chat"), Message: ReadProtobufString(ProtobufBuffer, "text"), SenderIndex: ReadProtobufInt32(ProtobufBuffer, "ent_idx") });
	}

	static WriteUserMessageToProtobuf(ProtobufBuffer, MessageData) {
		const nMessageSenderIndex = NormalizeMessageInteger(ReadMessageDataValue(MessageData, "SenderIndex"));
		const bSendToChat = NormalizeMessageBoolean(ReadMessageDataValue(MessageData, "Chat", false));
		const strMessageText = NormalizeMessageString(ReadMessageDataValue(MessageData, "Message"));
		CallBufferMethod(ProtobufBuffer, "SetInt32", "ent_idx", nMessageSenderIndex);
		CallBufferMethod(ProtobufBuffer, "SetBool", "chat", bSendToChat);
		CallBufferMethod(ProtobufBuffer, "SetString", "text", strMessageText);
	}

	static ReadUserMessageFromBitBuffer(BitBuffer) {
		return new UserMessageData({ SenderIndex: NormalizeMessageInteger(CallBufferMethod(BitBuffer, "ReadByte")), Message: NormalizeMessageString(CallBufferMethod(BitBuffer, "ReadString")), Chat: NormalizeMessageBoolean(CallBufferMethod(BitBuffer, "ReadByte")) });
	}

	static WriteUserMessageToBitBuffer(BitBuffer, MessageData) {
		const nMessageSenderIndex = NormalizeMessageInteger(ReadMessageDataValue(MessageData, "SenderIndex"));
		const strMessageText = NormalizeMessageString(ReadMessageDataValue(MessageData, "Message"));
		const bSendToChat = NormalizeMessageBoolean(ReadMessageDataValue(MessageData, "Chat", false));
		CallBufferMethod(BitBuffer, "WriteByte", nMessageSenderIndex);
		CallBufferMethod(BitBuffer, "WriteString", strMessageText);
		CallBufferMethod(BitBuffer, "WriteByte", bSendToChat ? 1 : 0);
	}
}

class SayText2UserMessageImplementation extends UserMessageImplementation {
	static ReadUserMessageFromProtobuf(ProtobufBuffer) {
		return new UserMessageData({
			Chat: ReadProtobufBool(ProtobufBuffer, "chat"),
			Message: ReadProtobufString(ProtobufBuffer, "msg_name"),
			Parameter1: ReadRepeatedProtobufString(ProtobufBuffer, "params", 0, "ignore"),
			Parameter2: ReadRepeatedProtobufString(ProtobufBuffer, "params", 1, "ignore"),
			Parameter3: ReadRepeatedProtobufString(ProtobufBuffer, "params", 2),
			Parameter4: ReadRepeatedProtobufString(ProtobufBuffer, "params", 3),
			SenderIndex: ReadProtobufInt32(ProtobufBuffer, "ent_idx"),
		});
	}

	static WriteUserMessageToProtobuf(ProtobufBuffer, MessageData) {
		const strMessageText = NormalizeMessageString(ReadMessageDataValue(MessageData, "Message"));
		const bSendToChat = NormalizeMessageBoolean(ReadMessageDataValue(MessageData, "Chat", false));
		const nMessageSenderIndex = NormalizeMessageInteger(ReadMessageDataValue(MessageData, "SenderIndex"));
		const strMessageParameter1 = NormalizeMessageString(ReadMessageDataValue(MessageData, "Parameter1"));
		const strMessageParameter2 = NormalizeMessageString(ReadMessageDataValue(MessageData, "Parameter2"));
		const strMessageParameter3 = NormalizeMessageString(ReadMessageDataValue(MessageData, "Parameter3"));
		const strMessageParameter4 = NormalizeMessageString(ReadMessageDataValue(MessageData, "Parameter4"));
		CallBufferMethod(ProtobufBuffer, "SetString", "msg_name", strMessageText);
		CallBufferMethod(ProtobufBuffer, "SetBool", "chat", bSendToChat);
		CallBufferMethod(ProtobufBuffer, "SetInt32", "ent_idx", nMessageSenderIndex);
		CallBufferMethod(ProtobufBuffer, "AddString", "params", strMessageParameter1);
		CallBufferMethod(ProtobufBuffer, "AddString", "params", strMessageParameter2);
		CallBufferMethod(ProtobufBuffer, "AddString", "params", strMessageParameter3);
		CallBufferMethod(ProtobufBuffer, "AddString", "params", strMessageParameter4);
	}

	static ReadUserMessageFromBitBuffer(BitBuffer) {
		return new UserMessageData({
			SenderIndex: NormalizeMessageInteger(CallBufferMethod(BitBuffer, "ReadByte")),
			Chat: NormalizeMessageBoolean(CallBufferMethod(BitBuffer, "ReadByte")),
			Message: NormalizeMessageString(CallBufferMethod(BitBuffer, "ReadString")),
			Parameter1: NormalizeMessageString(CallBufferMethod(BitBuffer, "ReadString")),
			Parameter2: NormalizeMessageString(CallBufferMethod(BitBuffer, "ReadString")),
			Parameter3: NormalizeMessageString(CallBufferMethod(BitBuffer, "ReadString")),
			Parameter4: NormalizeMessageString(CallBufferMethod(BitBuffer, "ReadString")),
		});
	}

	static WriteUserMessageToBitBuffer(BitBuffer, MessageData) {
		const nMessageSenderIndex = NormalizeMessageInteger(ReadMessageDataValue(MessageData, "SenderIndex"));
		const bSendToChat = NormalizeMessageBoolean(ReadMessageDataValue(MessageData, "Chat", false));
		const strMessageText = NormalizeMessageString(ReadMessageDataValue(MessageData, "Message"));
		const strMessageParameter1 = NormalizeMessageString(ReadMessageDataValue(MessageData, "Parameter1"));
		const strMessageParameter2 = NormalizeMessageString(ReadMessageDataValue(MessageData, "Parameter2"));
		const strMessageParameter3 = NormalizeMessageString(ReadMessageDataValue(MessageData, "Parameter3"));
		const strMessageParameter4 = NormalizeMessageString(ReadMessageDataValue(MessageData, "Parameter4"));
		CallBufferMethod(BitBuffer, "WriteByte", nMessageSenderIndex);
		CallBufferMethod(BitBuffer, "WriteByte", bSendToChat ? 1 : 0);
		CallBufferMethod(BitBuffer, "WriteString", strMessageText);
		CallBufferMethod(BitBuffer, "WriteString", strMessageParameter1);
		CallBufferMethod(BitBuffer, "WriteString", strMessageParameter2);
		CallBufferMethod(BitBuffer, "WriteString", strMessageParameter3);
		CallBufferMethod(BitBuffer, "WriteString", strMessageParameter4);
	}
}

class HintTextUserMessageImplementation extends UserMessageImplementation {
	static ReadUserMessageFromProtobuf(ProtobufBuffer) {
		return new UserMessageData({ Message: ReadProtobufString(ProtobufBuffer, "text") });
	}

	static WriteUserMessageToProtobuf(ProtobufBuffer, MessageData) {
		const strMessageText = NormalizeMessageString(ReadMessageDataValue(MessageData, "Message"));
		CallBufferMethod(ProtobufBuffer, "SetString", "text", strMessageText);
	}

	static ReadUserMessageFromBitBuffer(BitBuffer) {
		return new UserMessageData({ Message: NormalizeMessageString(CallBufferMethod(BitBuffer, "ReadString")) });
	}

	static WriteUserMessageToBitBuffer(BitBuffer, MessageData) {
		const strMessageText = NormalizeMessageString(ReadMessageDataValue(MessageData, "Message"));
		CallBufferMethod(BitBuffer, "WriteString", strMessageText);
	}
}

class ShakeUserMessageImplementation extends UserMessageImplementation {
	static ReadUserMessageFromProtobuf(ProtobufBuffer) {
		return new UserMessageData({ ShakeCommand: ReadProtobufInt32(ProtobufBuffer, "command"), Amplitude: ReadProtobufFloat(ProtobufBuffer, "local_amplitude"), Frequency: ReadProtobufFloat(ProtobufBuffer, "frequency"), Duration: ReadProtobufFloat(ProtobufBuffer, "duration") });
	}

	static WriteUserMessageToProtobuf(ProtobufBuffer, MessageData) {
		const nShakeCommand = NormalizeMessageInteger(ReadMessageDataValue(MessageData, "ShakeCommand"));
		const flShakeAmplitude = NormalizeMessageNumber(ReadMessageDataValue(MessageData, "Amplitude"));
		const flShakeFrequency = NormalizeMessageNumber(ReadMessageDataValue(MessageData, "Frequency"));
		const flShakeDuration = NormalizeMessageNumber(ReadMessageDataValue(MessageData, "Duration"));
		CallBufferMethod(ProtobufBuffer, "SetInt32", "command", nShakeCommand);
		CallBufferMethod(ProtobufBuffer, "SetFloat", "local_amplitude", flShakeAmplitude);
		CallBufferMethod(ProtobufBuffer, "SetFloat", "frequency", flShakeFrequency);
		CallBufferMethod(ProtobufBuffer, "SetFloat", "duration", flShakeDuration);
	}

	static ReadUserMessageFromBitBuffer(BitBuffer) {
		return new UserMessageData({ ShakeCommand: NormalizeMessageInteger(CallBufferMethod(BitBuffer, "ReadByte")), Amplitude: NormalizeMessageNumber(CallBufferMethod(BitBuffer, "ReadFloat")), Frequency: NormalizeMessageNumber(CallBufferMethod(BitBuffer, "ReadFloat")), Duration: NormalizeMessageNumber(CallBufferMethod(BitBuffer, "ReadFloat")) });
	}

	static WriteUserMessageToBitBuffer(BitBuffer, MessageData) {
		const nShakeCommand = NormalizeMessageInteger(ReadMessageDataValue(MessageData, "ShakeCommand"));
		const flShakeAmplitude = NormalizeMessageNumber(ReadMessageDataValue(MessageData, "Amplitude"));
		const flShakeFrequency = NormalizeMessageNumber(ReadMessageDataValue(MessageData, "Frequency"));
		const flShakeDuration = NormalizeMessageNumber(ReadMessageDataValue(MessageData, "Duration"));
		CallBufferMethod(BitBuffer, "WriteByte", nShakeCommand);
		CallBufferMethod(BitBuffer, "WriteFloat", flShakeAmplitude);
		CallBufferMethod(BitBuffer, "WriteFloat", flShakeFrequency);
		CallBufferMethod(BitBuffer, "WriteFloat", flShakeDuration);
	}
}

class ResetHUDUserMessageImplementation extends UserMessageImplementation {
	static ReadUserMessageFromProtobuf(ProtobufBuffer) {
		return new UserMessageData({ Reset: ReadProtobufBool(ProtobufBuffer, "reset") });
	}

	static WriteUserMessageToProtobuf(ProtobufBuffer, MessageData) {
		const bShouldResetHUD = NormalizeMessageBoolean(ReadMessageDataValue(MessageData, "Reset", true));
		CallBufferMethod(ProtobufBuffer, "SetBool", "reset", bShouldResetHUD);
	}

	static ReadUserMessageFromBitBuffer(BitBuffer) {
		return new UserMessageData({ Reset: NormalizeMessageBoolean(CallBufferMethod(BitBuffer, "ReadByte")) });
	}

	static WriteUserMessageToBitBuffer(BitBuffer, MessageData) {
		const bShouldResetHUD = NormalizeMessageBoolean(ReadMessageDataValue(MessageData, "Reset", true));
		CallBufferMethod(BitBuffer, "WriteByte", bShouldResetHUD ? 1 : 0);
	}
}

class TextMessageUserMessageImplementation extends UserMessageImplementation {
	static ReadUserMessageFromProtobuf(ProtobufBuffer) {
		return new UserMessageData({
			Destination: ReadProtobufInt32(ProtobufBuffer, "msg_dst"),
			Message: ReadRepeatedProtobufString(ProtobufBuffer, "params", 0),
			Parameter1: ReadRepeatedProtobufString(ProtobufBuffer, "params", 1),
			Parameter2: ReadRepeatedProtobufString(ProtobufBuffer, "params", 2),
			Parameter3: ReadRepeatedProtobufString(ProtobufBuffer, "params", 3),
			Parameter4: ReadRepeatedProtobufString(ProtobufBuffer, "params", 4),
		});
	}

	static WriteUserMessageToProtobuf(ProtobufBuffer, MessageData) {
		const nMessageDestination = NormalizeMessageInteger(ReadMessageDataValue(MessageData, "Destination"));
		const strMessageText = NormalizeMessageString(ReadMessageDataValue(MessageData, "Message"));
		const strMessageParameter1 = NormalizeMessageString(ReadMessageDataValue(MessageData, "Parameter1"));
		const strMessageParameter2 = NormalizeMessageString(ReadMessageDataValue(MessageData, "Parameter2"));
		const strMessageParameter3 = NormalizeMessageString(ReadMessageDataValue(MessageData, "Parameter3"));
		const strMessageParameter4 = NormalizeMessageString(ReadMessageDataValue(MessageData, "Parameter4"));
		CallBufferMethod(ProtobufBuffer, "SetInt32", "msg_dst", nMessageDestination);
		CallBufferMethod(ProtobufBuffer, "AddString", "params", strMessageText);
		CallBufferMethod(ProtobufBuffer, "AddString", "params", strMessageParameter1);
		CallBufferMethod(ProtobufBuffer, "AddString", "params", strMessageParameter2);
		CallBufferMethod(ProtobufBuffer, "AddString", "params", strMessageParameter3);
		CallBufferMethod(ProtobufBuffer, "AddString", "params", strMessageParameter4);
	}

	static ReadUserMessageFromBitBuffer(BitBuffer) {
		return new UserMessageData({
			Destination: NormalizeMessageInteger(CallBufferMethod(BitBuffer, "ReadByte")),
			Message: NormalizeMessageString(CallBufferMethod(BitBuffer, "ReadString")),
			Parameter1: NormalizeMessageString(CallBufferMethod(BitBuffer, "ReadString")),
			Parameter2: NormalizeMessageString(CallBufferMethod(BitBuffer, "ReadString")),
			Parameter3: NormalizeMessageString(CallBufferMethod(BitBuffer, "ReadString")),
			Parameter4: NormalizeMessageString(CallBufferMethod(BitBuffer, "ReadString")),
		});
	}

	static WriteUserMessageToBitBuffer(BitBuffer, MessageData) {
		const nMessageDestination = NormalizeMessageInteger(ReadMessageDataValue(MessageData, "Destination"));
		const strMessageText = NormalizeMessageString(ReadMessageDataValue(MessageData, "Message"));
		const strMessageParameter1 = NormalizeMessageString(ReadMessageDataValue(MessageData, "Parameter1"));
		const strMessageParameter2 = NormalizeMessageString(ReadMessageDataValue(MessageData, "Parameter2"));
		const strMessageParameter3 = NormalizeMessageString(ReadMessageDataValue(MessageData, "Parameter3"));
		const strMessageParameter4 = NormalizeMessageString(ReadMessageDataValue(MessageData, "Parameter4"));
		CallBufferMethod(BitBuffer, "WriteByte", nMessageDestination);
		CallBufferMethod(BitBuffer, "WriteString", strMessageText);
		CallBufferMethod(BitBuffer, "WriteString", strMessageParameter1);
		CallBufferMethod(BitBuffer, "WriteString", strMessageParameter2);
		CallBufferMethod(BitBuffer, "WriteString", strMessageParameter3);
		CallBufferMethod(BitBuffer, "WriteString", strMessageParameter4);
	}
}

class KeyHintTextUserMessageImplementation extends UserMessageImplementation {
	static ReadUserMessageFromProtobuf(ProtobufBuffer) {
		const unHintCount = RequireInteger(ReadProtobufFieldCount(ProtobufBuffer, "hints"), "KeyHintTextUserMessageImplementation HintCount", 0);
		const vecHintTexts = [];
		for (let unHintIndex = 0; unHintIndex < unHintCount; unHintIndex += 1) {
			vecHintTexts.push(ReadRepeatedProtobufString(ProtobufBuffer, "hints", unHintIndex));
		}

		return new UserMessageData({ Hints: vecHintTexts });
	}

	static WriteUserMessageToProtobuf(ProtobufBuffer, MessageData) {
		const vecNormalizedHintTexts = NormalizeHintTexts(MessageData, "KeyHintTextUserMessageImplementation.WriteUserMessageToProtobuf()");
		for (const strHintText of vecNormalizedHintTexts) {
			CallBufferMethod(ProtobufBuffer, "AddString", "hints", strHintText);
		}
	}

	static ReadUserMessageFromBitBuffer(BitBuffer) {
		const unExpectedStringCount = 1;
		const unStringCount = RequireInteger(CallBufferMethod(BitBuffer, "ReadByte"), "KeyHintTextUserMessageImplementation StringCount", 0);
		if (unStringCount !== unExpectedStringCount) {
			throw new RangeError("KeyHintTextUserMessageImplementation requires exactly one bitbuffer string.");
		}

		const strHintText = NormalizeMessageString(CallBufferMethod(BitBuffer, "ReadString"));

		return new UserMessageData({ Hints: [strHintText] });
	}

	static WriteUserMessageToBitBuffer(BitBuffer, MessageData) {
		const unHintStringCount = 1;
		const vecNormalizedHintTexts = NormalizeHintTexts(MessageData, "KeyHintTextUserMessageImplementation.WriteUserMessageToBitBuffer()");
		CallBufferMethod(BitBuffer, "WriteByte", unHintStringCount);
		CallBufferMethod(BitBuffer, "WriteString", vecNormalizedHintTexts.join("\n"));
	}
}

function RequireScreenFadeFactor() {
	if (g_unScreenFadeFactor === null) {
		throw new TypeError("FadeUserMessageImplementation requires selected-SDK SCREEN_FADE_FRACTION_BITS.");
	}

	return g_unScreenFadeFactor;
}

class FadeUserMessageImplementation extends UserMessageImplementation {
	static ReadUserMessageFromProtobuf(ProtobufBuffer) {
		const unScreenFadeFactor = RequireScreenFadeFactor();

		return new UserMessageData({ Duration: ReadProtobufInt32(ProtobufBuffer, "duration") / unScreenFadeFactor, HoldTime: ReadProtobufInt32(ProtobufBuffer, "hold_time") / unScreenFadeFactor, Flags: ReadProtobufInt32(ProtobufBuffer, "flags"), Color: ReadProtobufColor(ProtobufBuffer, "clr") });
	}

	static WriteUserMessageToProtobuf(ProtobufBuffer, MessageData) {
		const unScreenFadeFactor = RequireScreenFadeFactor();
		const flFadeDuration = NormalizeMessageNumber(ReadMessageDataValue(MessageData, "Duration"));
		const flFadeHoldTime = NormalizeMessageNumber(ReadMessageDataValue(MessageData, "HoldTime"));
		const nFadeFlags = NormalizeMessageInteger(ReadMessageDataValue(MessageData, "Flags"));
		const FadeColor = NormalizeMessageColor(ReadMessageDataValue(MessageData, "Color"));
		const nEncodedDuration = NormalizeMessageInteger(flFadeDuration * unScreenFadeFactor);
		const nEncodedHoldTime = NormalizeMessageInteger(flFadeHoldTime * unScreenFadeFactor);
		CallBufferMethod(ProtobufBuffer, "SetInt32", "duration", nEncodedDuration);
		CallBufferMethod(ProtobufBuffer, "SetInt32", "hold_time", nEncodedHoldTime);
		CallBufferMethod(ProtobufBuffer, "SetInt32", "flags", nFadeFlags);
		WriteProtobufColor(ProtobufBuffer, "clr", FadeColor);
	}

	static ReadUserMessageFromBitBuffer(BitBuffer) {
		const unScreenFadeFactor = RequireScreenFadeFactor();

		return new UserMessageData({ Duration: NormalizeMessageNumber(CallBufferMethod(BitBuffer, "ReadShort")) / unScreenFadeFactor, HoldTime: NormalizeMessageNumber(CallBufferMethod(BitBuffer, "ReadShort")) / unScreenFadeFactor, Flags: NormalizeMessageInteger(CallBufferMethod(BitBuffer, "ReadShort")), Color: ReadBitBufferColor(BitBuffer) });
	}

	static WriteUserMessageToBitBuffer(BitBuffer, MessageData) {
		const unScreenFadeFactor = RequireScreenFadeFactor();
		const flFadeDuration = NormalizeMessageNumber(ReadMessageDataValue(MessageData, "Duration"));
		const flFadeHoldTime = NormalizeMessageNumber(ReadMessageDataValue(MessageData, "HoldTime"));
		const nFadeFlags = NormalizeMessageInteger(ReadMessageDataValue(MessageData, "Flags"));
		const FadeColor = NormalizeMessageColor(ReadMessageDataValue(MessageData, "Color"));
		const nEncodedDuration = NormalizeMessageInteger(flFadeDuration * unScreenFadeFactor);
		const nEncodedHoldTime = NormalizeMessageInteger(flFadeHoldTime * unScreenFadeFactor);
		CallBufferMethod(BitBuffer, "WriteShort", nEncodedDuration);
		CallBufferMethod(BitBuffer, "WriteShort", nEncodedHoldTime);
		CallBufferMethod(BitBuffer, "WriteShort", nFadeFlags);
		WriteBitBufferColor(BitBuffer, FadeColor);
	}
}

class HUDMessageUserMessageImplementation extends UserMessageImplementation {
	static ReadUserMessageFromProtobuf(ProtobufBuffer) {
		const PositionBuffer = ReadProtobufMessage(ProtobufBuffer, "pos");

		return new UserMessageData({
			Channel: ReadProtobufInt32(ProtobufBuffer, "channel"),
			X: ReadProtobufFloat(PositionBuffer, "x", -1),
			Y: ReadProtobufFloat(PositionBuffer, "y", -1),
			Color1: ReadProtobufColor(ProtobufBuffer, "clr1"),
			Color2: ReadProtobufColor(ProtobufBuffer, "clr2"),
			Effect: ReadProtobufInt32(ProtobufBuffer, "effect"),
			FadeIn: ReadProtobufFloat(ProtobufBuffer, "fade_in_time"),
			FadeOut: ReadProtobufFloat(ProtobufBuffer, "fade_out_time"),
			HoldTime: ReadProtobufFloat(ProtobufBuffer, "hold_time"),
			EffectTime: ReadProtobufFloat(ProtobufBuffer, "fx_time"),
			Message: ReadProtobufString(ProtobufBuffer, "text"),
		});
	}

	static WriteUserMessageToProtobuf(ProtobufBuffer, MessageData) {
		const nMessageChannel = NormalizeMessageInteger(ReadMessageDataValue(MessageData, "Channel"));
		const flXPosition = NormalizeMessageNumber(ReadMessageDataValue(MessageData, "X", -1));
		const flYPosition = NormalizeMessageNumber(ReadMessageDataValue(MessageData, "Y", -1));
		const PrimaryColor = NormalizeMessageColor(ReadMessageDataValue(MessageData, "Color1"));
		const SecondaryColor = NormalizeMessageColor(ReadMessageDataValue(MessageData, "Color2"));
		const nMessageEffect = NormalizeMessageInteger(ReadMessageDataValue(MessageData, "Effect"));
		const flFadeInTime = NormalizeMessageNumber(ReadMessageDataValue(MessageData, "FadeIn"));
		const flFadeOutTime = NormalizeMessageNumber(ReadMessageDataValue(MessageData, "FadeOut"));
		const flHoldTime = NormalizeMessageNumber(ReadMessageDataValue(MessageData, "HoldTime"));
		const flEffectTime = NormalizeMessageNumber(ReadMessageDataValue(MessageData, "EffectTime"));
		const strMessageText = NormalizeMessageString(ReadMessageDataValue(MessageData, "Message"));
		const PositionBuffer = GetProtobufChildBuffer(ProtobufBuffer, "pos");
		CallBufferMethod(ProtobufBuffer, "SetInt32", "channel", nMessageChannel);
		CallBufferMethod(PositionBuffer, "SetFloat", "x", flXPosition);
		CallBufferMethod(PositionBuffer, "SetFloat", "y", flYPosition);
		WriteProtobufColor(ProtobufBuffer, "clr1", PrimaryColor);
		WriteProtobufColor(ProtobufBuffer, "clr2", SecondaryColor);
		CallBufferMethod(ProtobufBuffer, "SetInt32", "effect", nMessageEffect);
		CallBufferMethod(ProtobufBuffer, "SetFloat", "fade_in_time", flFadeInTime);
		CallBufferMethod(ProtobufBuffer, "SetFloat", "fade_out_time", flFadeOutTime);
		CallBufferMethod(ProtobufBuffer, "SetFloat", "hold_time", flHoldTime);
		CallBufferMethod(ProtobufBuffer, "SetFloat", "fx_time", flEffectTime);
		CallBufferMethod(ProtobufBuffer, "SetString", "text", strMessageText);
	}

	static ReadUserMessageFromBitBuffer(BitBuffer) {
		return new UserMessageData({
			Channel: NormalizeMessageInteger(CallBufferMethod(BitBuffer, "ReadByte")),
			X: NormalizeMessageNumber(CallBufferMethod(BitBuffer, "ReadFloat")),
			Y: NormalizeMessageNumber(CallBufferMethod(BitBuffer, "ReadFloat")),
			Color1: ReadBitBufferColor(BitBuffer),
			Color2: ReadBitBufferColor(BitBuffer),
			Effect: NormalizeMessageInteger(CallBufferMethod(BitBuffer, "ReadByte")),
			FadeIn: NormalizeMessageNumber(CallBufferMethod(BitBuffer, "ReadFloat")),
			FadeOut: NormalizeMessageNumber(CallBufferMethod(BitBuffer, "ReadFloat")),
			HoldTime: NormalizeMessageNumber(CallBufferMethod(BitBuffer, "ReadFloat")),
			EffectTime: NormalizeMessageNumber(CallBufferMethod(BitBuffer, "ReadFloat")),
			Message: NormalizeMessageString(CallBufferMethod(BitBuffer, "ReadString")),
		});
	}

	static WriteUserMessageToBitBuffer(BitBuffer, MessageData) {
		const nMessageChannel = NormalizeMessageInteger(ReadMessageDataValue(MessageData, "Channel"));
		const flXPosition = NormalizeMessageNumber(ReadMessageDataValue(MessageData, "X", -1));
		const flYPosition = NormalizeMessageNumber(ReadMessageDataValue(MessageData, "Y", -1));
		const PrimaryColor = NormalizeMessageColor(ReadMessageDataValue(MessageData, "Color1"));
		const SecondaryColor = NormalizeMessageColor(ReadMessageDataValue(MessageData, "Color2"));
		const nMessageEffect = NormalizeMessageInteger(ReadMessageDataValue(MessageData, "Effect"));
		const flFadeInTime = NormalizeMessageNumber(ReadMessageDataValue(MessageData, "FadeIn"));
		const flFadeOutTime = NormalizeMessageNumber(ReadMessageDataValue(MessageData, "FadeOut"));
		const flHoldTime = NormalizeMessageNumber(ReadMessageDataValue(MessageData, "HoldTime"));
		const flEffectTime = NormalizeMessageNumber(ReadMessageDataValue(MessageData, "EffectTime"));
		const strMessageText = NormalizeMessageString(ReadMessageDataValue(MessageData, "Message"));
		CallBufferMethod(BitBuffer, "WriteByte", nMessageChannel);
		CallBufferMethod(BitBuffer, "WriteFloat", flXPosition);
		CallBufferMethod(BitBuffer, "WriteFloat", flYPosition);
		WriteBitBufferColor(BitBuffer, PrimaryColor);
		WriteBitBufferColor(BitBuffer, SecondaryColor);
		CallBufferMethod(BitBuffer, "WriteByte", nMessageEffect);
		CallBufferMethod(BitBuffer, "WriteFloat", flFadeInTime);
		CallBufferMethod(BitBuffer, "WriteFloat", flFadeOutTime);
		CallBufferMethod(BitBuffer, "WriteFloat", flHoldTime);
		CallBufferMethod(BitBuffer, "WriteFloat", flEffectTime);
		CallBufferMethod(BitBuffer, "WriteString", strMessageText);
	}
}

class ShowMenuUserMessageImplementation extends UserMessageImplementation {
	static ReadUserMessageFromProtobuf(ProtobufBuffer) {
		return new UserMessageData({ ValidSlots: NormalizeMessageInteger(CallBufferMethod(ProtobufBuffer, "GetInt32", "bits_valid_slots")), DisplayTime: NormalizeMessageInteger(CallBufferMethod(ProtobufBuffer, "GetInt32", "display_time")), MenuString: ReadProtobufString(ProtobufBuffer, "menu_string") });
	}

	static WriteUserMessageToProtobuf(ProtobufBuffer, MessageData) {
		const nValidSlots = NormalizeMessageInteger(ReadMessageDataValue(MessageData, "ValidSlots"));
		const nDisplayTime = NormalizeMessageInteger(ReadMessageDataValue(MessageData, "DisplayTime"));
		const strMenuString = NormalizeMessageString(ReadMessageDataValue(MessageData, "MenuString"));
		CallBufferMethod(ProtobufBuffer, "SetInt32", "bits_valid_slots", nValidSlots);
		CallBufferMethod(ProtobufBuffer, "SetInt32", "display_time", nDisplayTime);
		CallBufferMethod(ProtobufBuffer, "SetString", "menu_string", strMenuString);
	}

	static ReadUserMessageFromBitBuffer(BitBuffer) {
		return new UserMessageData({ ValidSlots: NormalizeMessageInteger(CallBufferMethod(BitBuffer, "ReadWord")), DisplayTime: NormalizeMessageInteger(CallBufferMethod(BitBuffer, "ReadChar")), Chunked: NormalizeMessageBoolean(CallBufferMethod(BitBuffer, "ReadByte")), MenuString: NormalizeMessageString(CallBufferMethod(BitBuffer, "ReadString")) });
	}

	static WriteUserMessageToBitBuffer(BitBuffer, MessageData) {
		const nValidSlots = NormalizeMessageInteger(ReadMessageDataValue(MessageData, "ValidSlots"));
		const nDisplayTime = NormalizeMessageInteger(ReadMessageDataValue(MessageData, "DisplayTime"));
		const bMenuIsChunked = NormalizeMessageBoolean(ReadMessageDataValue(MessageData, "Chunked", false));
		const strMenuString = NormalizeMessageString(ReadMessageDataValue(MessageData, "MenuString"));
		CallBufferMethod(BitBuffer, "WriteWord", nValidSlots);
		CallBufferMethod(BitBuffer, "WriteChar", nDisplayTime);
		CallBufferMethod(BitBuffer, "WriteByte", bMenuIsChunked ? 1 : 0);
		CallBufferMethod(BitBuffer, "WriteString", strMenuString);
	}
}

function NormalizeVGUIMenuSubkeys(MessageData, strOperationName) {
	const SubkeyValues = RequirePlainObject(ReadMessageDataValue(MessageData, "Subkeys", {}), `${strOperationName} Subkeys`);
	const vecNormalizedSubkeys = [];
	for (const strSubkeyName in SubkeyValues) {
		if (!Object.hasOwn(SubkeyValues, strSubkeyName)) {
			continue;
		}

		const strSubkeyValue = NormalizeMessageString(SubkeyValues[strSubkeyName]);
		vecNormalizedSubkeys.push({ SubkeyName: strSubkeyName, SubkeyValue: strSubkeyValue });
	}

	return vecNormalizedSubkeys;
}

class VGUIMenuUserMessageImplementation extends UserMessageImplementation {
	static ReadUserMessageFromProtobuf(ProtobufBuffer) {
		const unSubkeyCount = RequireInteger(ReadProtobufFieldCount(ProtobufBuffer, "subkeys"), "VGUIMenuUserMessageImplementation SubkeyCount", 0);
		const SubkeyValues = {};
		for (let unSubkeyIndex = 0; unSubkeyIndex < unSubkeyCount; unSubkeyIndex += 1) {
			const SubkeyBuffer = ReadRepeatedProtobufMessage(ProtobufBuffer, "subkeys", unSubkeyIndex);
			const strSubkeyName = ReadProtobufString(SubkeyBuffer, "name");
			const strSubkeyValue = ReadProtobufString(SubkeyBuffer, "str");
			SetOwnValue(SubkeyValues, strSubkeyName, strSubkeyValue);
		}

		return new UserMessageData({ Name: ReadProtobufString(ProtobufBuffer, "name"), Show: ReadProtobufBool(ProtobufBuffer, "show"), Subkeys: SubkeyValues });
	}

	static WriteUserMessageToProtobuf(ProtobufBuffer, MessageData) {
		const strMenuName = NormalizeMessageString(ReadMessageDataValue(MessageData, "Name"));
		const bShowMenu = NormalizeMessageBoolean(ReadMessageDataValue(MessageData, "Show", true));
		const vecNormalizedSubkeys = NormalizeVGUIMenuSubkeys(MessageData, "VGUIMenuUserMessageImplementation.WriteUserMessageToProtobuf()");
		CallBufferMethod(ProtobufBuffer, "SetString", "name", strMenuName);
		CallBufferMethod(ProtobufBuffer, "SetBool", "show", bShowMenu);

		for (const NormalizedSubkey of vecNormalizedSubkeys) {
			const SubkeyBuffer = GetProtobufChildBuffer(ProtobufBuffer, "subkeys", true);
			CallBufferMethod(SubkeyBuffer, "SetString", "name", NormalizedSubkey.SubkeyName);
			CallBufferMethod(SubkeyBuffer, "SetString", "str", NormalizedSubkey.SubkeyValue);
		}
	}

	static ReadUserMessageFromBitBuffer(BitBuffer) {
		const strMenuName = NormalizeMessageString(CallBufferMethod(BitBuffer, "ReadString"));
		const bShowMenu = NormalizeMessageBoolean(CallBufferMethod(BitBuffer, "ReadByte"));
		const unSubkeyCount = RequireInteger(CallBufferMethod(BitBuffer, "ReadByte"), "VGUIMenuUserMessageImplementation SubkeyCount", 0);
		const SubkeyValues = {};
		for (let unSubkeyIndex = 0; unSubkeyIndex < unSubkeyCount; unSubkeyIndex += 1) {
			const strSubkeyName = NormalizeMessageString(CallBufferMethod(BitBuffer, "ReadString"));
			const strSubkeyValue = NormalizeMessageString(CallBufferMethod(BitBuffer, "ReadString"));
			SetOwnValue(SubkeyValues, strSubkeyName, strSubkeyValue);
		}

		return new UserMessageData({ Name: strMenuName, Show: bShowMenu, Subkeys: SubkeyValues });
	}

	static WriteUserMessageToBitBuffer(BitBuffer, MessageData) {
		const strMenuName = NormalizeMessageString(ReadMessageDataValue(MessageData, "Name"));
		const bShowMenu = NormalizeMessageBoolean(ReadMessageDataValue(MessageData, "Show", true));
		const vecNormalizedSubkeys = NormalizeVGUIMenuSubkeys(MessageData, "VGUIMenuUserMessageImplementation.WriteUserMessageToBitBuffer()");
		const unSubkeyCount = RequireInteger(vecNormalizedSubkeys.length, "VGUIMenuUserMessageImplementation SubkeyCount", 0);
		CallBufferMethod(BitBuffer, "WriteString", strMenuName);
		CallBufferMethod(BitBuffer, "WriteByte", bShowMenu ? 1 : 0);
		CallBufferMethod(BitBuffer, "WriteByte", unSubkeyCount);

		for (const NormalizedSubkey of vecNormalizedSubkeys) {
			CallBufferMethod(BitBuffer, "WriteString", NormalizedSubkey.SubkeyName);
			CallBufferMethod(BitBuffer, "WriteString", NormalizedSubkey.SubkeyValue);
		}
	}
}

const g_mapImplementedUserMessages = new Map([
	["SayText", SayTextUserMessageImplementation],
	["SayText2", SayText2UserMessageImplementation],
	["HintText", HintTextUserMessageImplementation],
	["Shake", ShakeUserMessageImplementation],
	["ResetHud", ResetHUDUserMessageImplementation],
	["TextMsg", TextMessageUserMessageImplementation],
	["KeyHintText", KeyHintTextUserMessageImplementation],
	["Fade", FadeUserMessageImplementation],
	["HudMsg", HUDMessageUserMessageImplementation],
	["ShowMenu", ShowMenuUserMessageImplementation],
	["VGUIMenu", VGUIMenuUserMessageImplementation],
]);

function RefreshImplementedUserMessages() {
	for (const strMessageName of g_vecMessageImplementationNames) {
		const nMessageIndex = GetNumericMessageIndex(strMessageName);
		if (nMessageIndex >= 0) {
			g_mapImplementedUserMessages.set(nMessageIndex, g_mapImplementedUserMessages.get(strMessageName));
		}
	}

	return g_mapImplementedUserMessages;
}

function GetUserMessageImplementation(MessageNameOrIndex) {
	if (typeof MessageNameOrIndex === "number") {
		const unMessageIndex = RequireInteger(MessageNameOrIndex, "GetUserMessageImplementation() MessageNameOrIndex", 0);
		if (g_mapImplementedUserMessages.has(unMessageIndex)) {
			return g_mapImplementedUserMessages.get(unMessageIndex);
		}

		RefreshImplementedUserMessages();

		if (g_mapImplementedUserMessages.has(unMessageIndex)) {
			return g_mapImplementedUserMessages.get(unMessageIndex);
		}

		const strMessageName = GetMessageNameFromIndex(unMessageIndex);
		if (g_mapImplementedUserMessages.has(strMessageName)) {
			return g_mapImplementedUserMessages.get(strMessageName);
		}

		throw new TypeError(`User message ${MessageNameOrIndex} has no supported SourceJS serializer.`);
	}

	if (typeof MessageNameOrIndex !== "string") {
		throw new TypeError("GetUserMessageImplementation() MessageNameOrIndex requires a string name or a safe non-negative integer index.");
	}

	if (g_mapImplementedUserMessages.has(MessageNameOrIndex)) {
		return g_mapImplementedUserMessages.get(MessageNameOrIndex);
	}

	throw new TypeError(`User message ${MessageNameOrIndex} has no supported SourceJS serializer.`);
}

module.exports = {
	FadeUserMessageImplementation: FadeUserMessageImplementation,
	HintTextUserMessageImplementation: HintTextUserMessageImplementation,
	HUDMessageUserMessageImplementation: HUDMessageUserMessageImplementation,
	KeyHintTextUserMessageImplementation: KeyHintTextUserMessageImplementation,
	ResetHUDUserMessageImplementation: ResetHUDUserMessageImplementation,
	SayTextUserMessageImplementation: SayTextUserMessageImplementation,
	SayText2UserMessageImplementation: SayText2UserMessageImplementation,
	ShakeUserMessageImplementation: ShakeUserMessageImplementation,
	ShowMenuUserMessageImplementation: ShowMenuUserMessageImplementation,
	TextMessageUserMessageImplementation: TextMessageUserMessageImplementation,
	UserMessageData: UserMessageData,
	UserMessageImplementation: UserMessageImplementation,
	VGUIMenuUserMessageImplementation: VGUIMenuUserMessageImplementation,
	GetUserMessageImplementation: GetUserMessageImplementation,
	IMPLEMENTED_USER_MESSAGES: g_mapImplementedUserMessages,
	NormalizeUserMessageRecipients: NormalizeUserMessageRecipients,
	RefreshImplementedUserMessages: RefreshImplementedUserMessages,
	SendClientCommandToRecipients: SendClientCommandToRecipients,
	SendClientConsoleMessageToRecipients: SendClientConsoleMessageToRecipients,
	SendSayTextMessageToRecipients: SendSayTextMessageToRecipients,
	SendSayText2MessageToRecipients: SendSayText2MessageToRecipients,
	SendDialogMessageToRecipients: SendDialogMessageToRecipients,
	SendDialogMessageDataToRecipients: SendDialogMessageDataToRecipients,
	SendUserMessageToRecipients: SendUserMessageToRecipients,
};
