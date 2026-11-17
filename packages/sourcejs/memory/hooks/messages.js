"use strict";

const { BitBufferRead, BitBufferWrite } = require("bitbuffers");
const { RecipientFilter } = require("filters/recipients");
const { GetModule } = require("internal/runtime");
const { CreateVTableHook } = require("memory/hooks");
const { GetUserMessageImplementation } = require("messages/implementation");

const g_mapBitBufferHooks = new Map();
const g_mapProtobufHooks = new Map();
const g_mapUserMessageHooks = new Map();
const g_MessagesRuntime = GetModule("messages");
const g_MessageHooksRuntime = GetModule("memory/hooks/messages");
const g_unRecipientFilterArgumentIndex = 1;
const g_unMessageIndexArgumentIndex = 2;
const g_unProtobufMessageArgumentIndex = 3;

// Failed removal can retain a native hook whose dispatch callbacks were not fully registered.
let g_BitBufferBeginHook = null;
let g_BitBufferEndHook = null;
let g_bBitBufferCallbacksRegistered = false;
let g_CurrentBitBufferMessage = null;
let g_ProtobufSendHook = null;
let g_bProtobufCallbackRegistered = false;
const g_HookStatus = {};

function RequireMessageIndex(unMessageIndexValue, strValueName) {
	if (!Number.isSafeInteger(unMessageIndexValue) || (unMessageIndexValue < 0)) {
		throw new TypeError(`${strValueName} requires a safe non-negative integer.`);
	}

	return unMessageIndexValue;
}

function RequireAddress(unAddressValue, strValueName) {
	if ((typeof unAddressValue !== "bigint") || (unAddressValue <= 0n)) {
		throw new TypeError(`${strValueName} requires a positive BigInt address.`);
	}

	return unAddressValue;
}

function GetBackend() {
	const strSelectedBackend = g_MessageHooksRuntime.Backend();
	if ((strSelectedBackend !== "bitbuffer") && (strSelectedBackend !== "protobuf")) {
		throw new TypeError(`Unsupported user-message hook backend: ${strSelectedBackend}`);
	}

	return strSelectedBackend;
}

function EnsureCallbackSet(mapCallbackStore, unMessageIndex) {
	if (!mapCallbackStore.has(unMessageIndex)) {
		mapCallbackStore.set(unMessageIndex, new Set());
	}

	return mapCallbackStore.get(unMessageIndex);
}

function HasCallbacks(mapCallbackStore, unMessageIndex) {
	const setMessageCallbacks = mapCallbackStore.get(unMessageIndex);

	return (setMessageCallbacks !== undefined) && (setMessageCallbacks.size > 0);
}

function HasAnyCallbacks(mapCallbackStore) {
	for (const setMessageCallbacks of mapCallbackStore.values()) {
		if (setMessageCallbacks.size > 0) {
			return true;
		}
	}

	return false;
}

function ResolveMessage(Message) {
	let unMessageIndex;
	if (typeof Message === "number") {
		unMessageIndex = RequireMessageIndex(Message, "User message index");

	} else if ((typeof Message === "string") && (Message.length > 0)) {
		unMessageIndex = RequireMessageIndex(g_MessagesRuntime.GetUserMessageIndex(Message), "messages.GetUserMessageIndex() result");

	} else {
		throw new TypeError("User message requires a non-empty string name or safe non-negative integer index.");
	}

	const strMessageName = g_MessagesRuntime.GetUserMessageName(unMessageIndex);
	if ((typeof strMessageName !== "string") || (strMessageName.length === 0)) {
		throw new RangeError(`User message index is not available: ${unMessageIndex}`);
	}

	return { m_unMessageIndex: unMessageIndex, m_strMessageName: strMessageName };
}

function CreateRecipientFilter(unRecipientFilterAddress) {
	RequireAddress(unRecipientFilterAddress, "User-message recipient-filter address");

	const NativeRecipientFilterInformation = g_MessageHooksRuntime.GetRecipientFilter(unRecipientFilterAddress);

	return RecipientFilter.CreateRecipientFilterFromNativeInfo({ RecipientIndexes: NativeRecipientFilterInformation.Indices, InitializationMessage: NativeRecipientFilterInformation.InitializationMessage, Reliable: NativeRecipientFilterInformation.Reliable });
}

function BeginBitBufferMessage(Payload) {
	if (!Payload || !Array.isArray(Payload.Arguments)) {
		throw new TypeError("UserMessageBegin hook payload requires an Arguments array.");
	}

	const unMessageIndex = RequireMessageIndex(Payload.Arguments[g_unMessageIndexArgumentIndex], "UserMessageBegin message index");
	if (!HasCallbacks(g_mapBitBufferHooks, unMessageIndex) && !HasCallbacks(g_mapUserMessageHooks, unMessageIndex)) {
		g_CurrentBitBufferMessage = null;
		return;
	}

	g_CurrentBitBufferMessage = { m_unBufferAddress: 0n, m_unMessageIndex: unMessageIndex, m_Recipients: CreateRecipientFilter(Payload.Arguments[g_unRecipientFilterArgumentIndex]) };
}

function CaptureBitBufferAddress(Payload) {
	if (g_CurrentBitBufferMessage !== null) {
		g_CurrentBitBufferMessage.m_unBufferAddress = RequireAddress(Payload.ReturnValue, "UserMessageBegin return address");
	}
}

function GetBitBufferState(Buffer) {
	return { Bytes: Buffer.Bytes, CurrentBit: Buffer.CurrentBit, DataBitCount: Buffer.DataBitCount, Overflowed: Buffer.Overflowed };
}

function DispatchBitBufferMessage() {
	const Message = g_CurrentBitBufferMessage;

	g_CurrentBitBufferMessage = null;

	if ((Message === null) || (Message.m_unBufferAddress === 0n)) {
		return;
	}

	const State = g_MessageHooksRuntime.GetBitBufferState(Message.m_unBufferAddress);
	const Writer = new BitBufferWrite(State.Bytes, State.DataBitCount);

	Writer.CurrentBit = State.CurrentBit;
	Writer.Overflowed = State.Overflowed;
	const unOriginalCurrentBit = Writer.CurrentBit;
	const setRawMessageCallbacks = g_mapBitBufferHooks.get(Message.m_unMessageIndex);
	if (setRawMessageCallbacks !== undefined) {
		for (const Callback of [...setRawMessageCallbacks]) {
			const Reader = new BitBufferRead(Writer, false);
			Reader.SeekToBit(0);
			Writer.SeekToBit(0);
			Callback(Message.m_Recipients, Reader, Writer);
		}
	}

	if (Writer.CurrentBit === 0) {
		Writer.SeekToBit(unOriginalCurrentBit);
	}

	const setUserMessageCallbacks = g_mapUserMessageHooks.get(Message.m_unMessageIndex);
	if ((setUserMessageCallbacks !== undefined) && (setUserMessageCallbacks.size > 0)) {
		const Implementation = GetUserMessageImplementation(Message.m_unMessageIndex);
		const Reader = new BitBufferRead(Writer, false);
		Reader.SeekToBit(0);
		const Data = Implementation.ReadUserMessageFromBitBuffer(Reader);
		for (const Callback of [...setUserMessageCallbacks]) {
			Callback(Message.m_Recipients, Data);
		}

		if (Data.HasUserMessageChanged()) {
			Writer.SeekToBit(0);
			Implementation.WriteUserMessageToBitBuffer(Writer, Data);
		}
	}

	g_MessageHooksRuntime.ApplyBitBufferState(Message.m_unBufferAddress, GetBitBufferState(Writer));
}

function DispatchProtobufMessage(Payload) {
	if (!Payload || !Array.isArray(Payload.Arguments)) {
		throw new TypeError("SendUserMessage hook payload requires an Arguments array.");
	}

	const unMessageIndex = RequireMessageIndex(Payload.Arguments[g_unMessageIndexArgumentIndex], "SendUserMessage message index");
	const setRawMessageCallbacks = g_mapProtobufHooks.get(unMessageIndex);
	const setUserMessageCallbacks = g_mapUserMessageHooks.get(unMessageIndex);
	if ((!setRawMessageCallbacks || (setRawMessageCallbacks.size === 0)) && (!setUserMessageCallbacks || (setUserMessageCallbacks.size === 0))) {
		return;
	}

	const Recipients = CreateRecipientFilter(Payload.Arguments[g_unRecipientFilterArgumentIndex]);
	const Buffer = g_MessageHooksRuntime.GetProtobufMessage(RequireAddress(Payload.Arguments[g_unProtobufMessageArgumentIndex], "SendUserMessage protobuf address"));
	if (setRawMessageCallbacks !== undefined) {
		for (const Callback of [...setRawMessageCallbacks]) {
			Callback(Recipients, Buffer);
		}
	}

	if ((setUserMessageCallbacks !== undefined) && (setUserMessageCallbacks.size > 0)) {
		const Implementation = GetUserMessageImplementation(unMessageIndex);
		const Data = Implementation.ReadUserMessageFromProtobuf(Buffer);
		for (const Callback of [...setUserMessageCallbacks]) {
			Callback(Recipients, Data);
		}

		if (Data.HasUserMessageChanged()) {
			Buffer.Clear();
			Implementation.WriteUserMessageToProtobuf(Buffer, Data);
		}
	}
}

function ReleaseBitBufferHooks() {
	const vecRemovalErrors = [];

	try {
		if ((g_BitBufferBeginHook !== null) && (g_BitBufferBeginHook.Remove() === true)) {
			g_BitBufferBeginHook = null;
			g_bBitBufferCallbacksRegistered = false;
		}
	} catch (RemovalError) {
		vecRemovalErrors.push(RemovalError);
	}

	try {
		if ((g_BitBufferEndHook !== null) && (g_BitBufferEndHook.Remove() === true)) {
			g_BitBufferEndHook = null;
			g_bBitBufferCallbacksRegistered = false;
		}
	} catch (RemovalError) {
		vecRemovalErrors.push(RemovalError);
	}

	g_CurrentBitBufferMessage = null;

	if (vecRemovalErrors.length === 1) {
		throw vecRemovalErrors[0];
	}

	if (vecRemovalErrors.length > 1) {
		throw new AggregateError(vecRemovalErrors, "Removing the bitbuffer message hooks failed.");
	}
}

function ReleaseProtobufHook() {
	if ((g_ProtobufSendHook !== null) && (g_ProtobufSendHook.Remove() === true)) {
		g_ProtobufSendHook = null;
		g_bProtobufCallbackRegistered = false;
	}
}

function EnsureBitBufferHooks() {
	if (g_bBitBufferCallbacksRegistered && (g_BitBufferBeginHook !== null) && (g_BitBufferEndHook !== null)) {
		return;
	}

	ReleaseBitBufferHooks();

	if ((g_BitBufferBeginHook !== null) || (g_BitBufferEndHook !== null)) {
		throw new Error("Unable to release incomplete user-message hooks before installation.");
	}

	g_BitBufferBeginHook = CreateVTableHook(g_MessageHooksRuntime.GetUserMessageBeginHookOptions());
	try {
		if (!g_BitBufferBeginHook || (typeof g_BitBufferBeginHook.Pre !== "function") || (typeof g_BitBufferBeginHook.Post !== "function")) {
			throw new Error("Unable to install IVEngineServer::UserMessageBegin hook.");
		}

		g_BitBufferEndHook = CreateVTableHook(g_MessageHooksRuntime.GetMessageEndHookOptions());
		if (!g_BitBufferEndHook || (typeof g_BitBufferEndHook.Pre !== "function")) {
			throw new Error("Unable to install IVEngineServer::MessageEnd hook.");
		}

		if (!g_BitBufferBeginHook.Pre(BeginBitBufferMessage)) {
			throw new Error("Unable to register the UserMessageBegin pre-hook callback.");
		}

		if (!g_BitBufferBeginHook.Post(CaptureBitBufferAddress)) {
			throw new Error("Unable to register the UserMessageBegin post-hook callback.");
		}

		if (!g_BitBufferEndHook.Pre(DispatchBitBufferMessage)) {
			throw new Error("Unable to register the MessageEnd pre-hook callback.");
		}

		g_bBitBufferCallbacksRegistered = true;
	} catch (CaughtError) {
		try {
			ReleaseBitBufferHooks();
		} catch (CleanupError) {
			throw new AggregateError([CaughtError, CleanupError], "Installing and rolling back the bitbuffer message hooks both failed.");
		}

		throw CaughtError;
	}
}

function EnsureProtobufHook() {
	if (g_bProtobufCallbackRegistered && (g_ProtobufSendHook !== null)) {
		return;
	}

	ReleaseProtobufHook();

	if (g_ProtobufSendHook !== null) {
		throw new Error("Unable to release an incomplete SendUserMessage hook before installation.");
	}

	g_ProtobufSendHook = CreateVTableHook(g_MessageHooksRuntime.GetSendUserMessageHookOptions());
	try {
		if (!g_ProtobufSendHook || (typeof g_ProtobufSendHook.Pre !== "function")) {
			throw new Error("Unable to install IVEngineServer::SendUserMessage hook.");
		}

		if (!g_ProtobufSendHook.Pre(DispatchProtobufMessage)) {
			throw new Error("Unable to register the SendUserMessage pre-hook callback.");
		}

		g_bProtobufCallbackRegistered = true;
	} catch (CaughtError) {
		try {
			ReleaseProtobufHook();
		} catch (CleanupError) {
			throw new AggregateError([CaughtError, CleanupError], "Installing and rolling back the protobuf message hook both failed.");
		}

		throw CaughtError;
	}
}

function EnsureNativeHooks() {
	if (GetBackend() === "bitbuffer") {
		EnsureBitBufferHooks();
		return;
	}

	EnsureProtobufHook();
}

function ReleaseUnusedHooks() {
	const strSelectedBackend = GetBackend();
	const bHasDecodedCallbacks = HasAnyCallbacks(g_mapUserMessageHooks);
	if ((strSelectedBackend === "bitbuffer") && !HasAnyCallbacks(g_mapBitBufferHooks) && !bHasDecodedCallbacks) {
		ReleaseBitBufferHooks();
	}

	if ((strSelectedBackend === "protobuf") && !HasAnyCallbacks(g_mapProtobufHooks) && !bHasDecodedCallbacks && (g_ProtobufSendHook !== null)) {
		ReleaseProtobufHook();
	}
}

Object.defineProperties(g_HookStatus, {
	Backend: { enumerable: true, get: GetBackend },
	BitBufferBeginInstalled: {
		enumerable: true,
		get() {
			return g_BitBufferBeginHook !== null;
		},
	},
	BitBufferEndInstalled: {
		enumerable: true,
		get() {
			return g_BitBufferEndHook !== null;
		},
	},
	ProtobufSendInstalled: {
		enumerable: true,
		get() {
			return g_ProtobufSendHook !== null;
		},
	},
});

class UserMessageHookBase {
	constructor(UserMessage, Callback = null) {
		const ResolvedMessage = ResolveMessage(UserMessage);
		this.MessageIndex = ResolvedMessage.m_unMessageIndex;
		this.MessageName = ResolvedMessage.m_strMessageName;
		this.Callback = null;

		if (Callback !== null) {
			this.RegisterUserMessageHook(Callback);
		}
	}

	RegisterUserMessageHook(Callback) {
		if (typeof Callback !== "function") {
			throw new TypeError("User-message hook callback requires a function.");
		}

		if (this.Callback === Callback) {
			throw new Error(`Callback is already registered for user message ${this.MessageName}.`);
		}

		const strSelectedBackend = GetBackend();
		if ((this.RequiredBackend !== null) && (strSelectedBackend !== this.RequiredBackend)) {
			throw new TypeError(`${this.constructor.name} requires the ${this.RequiredBackend} backend; selected backend is ${strSelectedBackend}.`);
		}

		const PreviousCallback = this.Callback;
		const mapCallbackStore = this.Store;
		const setExistingCallbacks = mapCallbackStore.get(this.MessageIndex);
		if ((PreviousCallback !== null) && ((setExistingCallbacks === undefined) || !setExistingCallbacks.has(PreviousCallback))) {
			throw new Error(`Unable to release the previous callback for user message ${this.MessageName}.`);
		}

		if ((setExistingCallbacks !== undefined) && setExistingCallbacks.has(Callback)) {
			throw new Error(`Callback is already registered for user message ${this.MessageName}.`);
		}

		EnsureNativeHooks();

		const setMessageCallbacks = EnsureCallbackSet(mapCallbackStore, this.MessageIndex);
		setMessageCallbacks.add(Callback);
		try {
			if ((PreviousCallback !== null) && !this.DisposeUserMessageHook()) {
				throw new Error(`Unable to release the previous callback for user message ${this.MessageName}.`);
			}
		} catch (ReplacementError) {
			const vecRollbackErrors = [];
			try {
				setMessageCallbacks.add(PreviousCallback);
				this.Callback = PreviousCallback;
			} catch (RestorationError) {
				vecRollbackErrors.push(RestorationError);
			}

			try {
				if (!setMessageCallbacks.delete(Callback)) {
					throw new Error(`Unable to roll back the replacement callback for user message ${this.MessageName}.`);
				}
			} catch (RemovalError) {
				vecRollbackErrors.push(RemovalError);
			}

			if (vecRollbackErrors.length > 0) {
				throw new AggregateError([ReplacementError, ...vecRollbackErrors], "Replacing and rolling back the user-message callback both failed.");
			}

			throw ReplacementError;
		}

		this.Callback = Callback;

		return Callback;
	}

	DisposeUserMessageHook() {
		if (this.Callback === null) {
			ReleaseUnusedHooks();
			return false;
		}

		const setMessageCallbacks = this.Store.get(this.MessageIndex);
		const bRemoved = (setMessageCallbacks !== undefined) && setMessageCallbacks.delete(this.Callback);

		if ((setMessageCallbacks !== undefined) && (setMessageCallbacks.size === 0)) {
			this.Store.delete(this.MessageIndex);
		}

		if (bRemoved) {
			this.Callback = null;
			ReleaseUnusedHooks();
		}

		return bRemoved;
	}

	get Store() {
		throw new TypeError(`${this.constructor.name}.Store is not implemented.`);
	}

	get RequiredBackend() {
		return null;
	}
}

class BitBufferUserMessageHook extends UserMessageHookBase {
	get Store() {
		return g_mapBitBufferHooks;
	}

	get RequiredBackend() {
		return "bitbuffer";
	}
}

class ProtobufUserMessageHook extends UserMessageHookBase {
	get Store() {
		return g_mapProtobufHooks;
	}

	get RequiredBackend() {
		return "protobuf";
	}
}

class UserMessageHook extends UserMessageHookBase {
	constructor(UserMessage, Callback = null) {
		super(UserMessage);
		GetUserMessageImplementation(this.MessageIndex);

		if (Callback !== null) {
			this.RegisterUserMessageHook(Callback);
		}
	}

	get Store() {
		return g_mapUserMessageHooks;
	}
}

const g_MessageHookExports = {
	UserMessageHook: UserMessageHook,
	UserMessageHookBase: UserMessageHookBase,
	HOOK_STATUS: g_HookStatus,
	Backend: GetBackend,
	EnsureNativeHooks: EnsureNativeHooks,
};

if (GetBackend() === "bitbuffer") {
	g_MessageHookExports.BitBufferUserMessageHook = BitBufferUserMessageHook;

} else {
	g_MessageHookExports.ProtobufUserMessageHook = ProtobufUserMessageHook;
}

module.exports = g_MessageHookExports;
