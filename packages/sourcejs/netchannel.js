"use strict";

const { GetModule } = require("internal/runtime");
const { RegisterObjectType } = require("memory");
const { BitBufferWrite } = require("bitbuffers");

function RequireFlowConstants(FlowConstants) {
	if ((FlowConstants === null) || (typeof FlowConstants !== "object") || Array.isArray(FlowConstants)) {
		throw new TypeError("netchannel.GetFlowConstants() requires a flow-constant record.");
	}

	const vecFlowValues = [FlowConstants.Outgoing, FlowConstants.Incoming, FlowConstants.InOut];
	if (vecFlowValues.some((nValue) => !Number.isSafeInteger(nValue)) || (new Set(vecFlowValues).size !== vecFlowValues.length)) {
		throw new TypeError("netchannel.GetFlowConstants() requires distinct integer Outgoing, Incoming, and InOut fields.");
	}

	return FlowConstants;
}

const g_NetChannelRuntime = GetModule("netchannel");
const g_NetChannelFlowConstants = RequireFlowConstants(g_NetChannelRuntime.GetFlowConstants());
const g_NetFlow = Object.freeze({ Outgoing: g_NetChannelFlowConstants.Outgoing, Incoming: g_NetChannelFlowConstants.Incoming, InOut: g_NetChannelFlowConstants.InOut });

function RequireAddress(unAddress) {
	if ((typeof unAddress !== "bigint") || (unAddress <= 0n)) {
		throw new TypeError("RequireAddress(unAddress) expects a positive BigInt address value.");
	}

	return unAddress;
}

function RequirePlayerIndex(unPlayerIndex) {
	if (!Number.isSafeInteger(unPlayerIndex) || (unPlayerIndex <= 0)) {
		throw new TypeError("RequirePlayerIndex(unPlayerIndex) expects a positive safe-integer player index.");
	}

	return unPlayerIndex;
}

function RequireNetChannelInformationData(unNetChannelAddress) {
	return g_NetChannelRuntime.GetRequiredInformationFromAddress(RequireAddress(unNetChannelAddress));
}

function RequireFlow(nFlow) {
	if ((nFlow !== g_NetFlow.Outgoing) && (nFlow !== g_NetFlow.Incoming)) {
		throw new RangeError("RequireFlow(nFlow) expects NET_FLOW.Outgoing or NET_FLOW.Incoming.");
	}

	return nFlow;
}

function GetFlowValue(NetChannelInformationData, nFlow, strOutgoingFieldName, strIncomingFieldName) {
	RequireFlow(nFlow);

	return NetChannelInformationData[(nFlow === g_NetFlow.Outgoing) ? strOutgoingFieldName : strIncomingFieldName];
}

function UpdateReadBuffer(NetMessageBuffer, NetMessageReadResult) {
	if ((NetMessageBuffer === null) || (typeof NetMessageBuffer !== "object") || ArrayBuffer.isView(NetMessageBuffer) || (NetMessageBuffer instanceof ArrayBuffer)) {
		return;
	}

	NetMessageBuffer.CurrentBit = NetMessageReadResult.ReadBitCount;
}

function UpdateWriteBuffer(NetMessageBuffer, NetMessageWriteResult) {
	if ((NetMessageBuffer === null) || (typeof NetMessageBuffer !== "object") || ArrayBuffer.isView(NetMessageBuffer) || (NetMessageBuffer instanceof ArrayBuffer)) {
		return;
	}

	NetMessageBuffer.Bytes = NetMessageWriteResult.Bytes;
	if (NetMessageBuffer instanceof BitBufferWrite) {
		NetMessageBuffer.CurrentBit = NetMessageWriteResult.WrittenBitCount;
		return;
	}

	NetMessageBuffer.WrittenBitCount = NetMessageWriteResult.WrittenBitCount;
}

class NetChannelAddressBackedObject {
	constructor(unAddress) {
		this.Address = RequireAddress(unAddress);
	}

	// memory.MakeObject() requires this generic factory on registered native views.
	static CreateFromAddress(unAddress) {
		return new this(unAddress);
	}
}

class NetChannelHandler extends NetChannelAddressBackedObject {
	static CreateNetChannelHandlerFromAddress(unAddress) {
		return this.CreateFromAddress(unAddress);
	}
}

class NetChannelInfo extends NetChannelAddressBackedObject {
	constructor(unAddress, unPlayerIndex = 0) {
		super(unAddress);

		if (!Number.isSafeInteger(unPlayerIndex) || (unPlayerIndex < 0)) {
			throw new TypeError("NetChannelInfo(unAddress, unPlayerIndex?) expects a non-negative safe-integer player index.");
		}

		this.PlayerIndex = unPlayerIndex;
	}

	static GetRequiredPlayerNetChannelInfo(unPlayerIndex) {
		const unValidatedPlayerIndex = RequirePlayerIndex(unPlayerIndex);
		const NetChannelInformationData = g_NetChannelRuntime.GetRequiredInformation(unValidatedPlayerIndex);

		return new NetChannelInfo(NetChannelInformationData.Address, unValidatedPlayerIndex);
	}

	static CreateNetChannelInfoFromAddress(unAddress) {
		return this.CreateFromAddress(unAddress);
	}

	IsNetChannelLoopback() {
		return RequireNetChannelInformationData(this.Address).Loopback;
	}

	IsNetChannelTimingOut() {
		return RequireNetChannelInformationData(this.Address).TimingOut;
	}

	IsNetChannelPlayback() {
		return RequireNetChannelInformationData(this.Address).Playback;
	}

	GetNetChannelLatency(nFlow) {
		return GetFlowValue(RequireNetChannelInformationData(this.Address), nFlow, "LatencyOutgoing", "LatencyIncoming");
	}

	GetNetChannelAverageLatency(nFlow) {
		return GetFlowValue(RequireNetChannelInformationData(this.Address), nFlow, "AverageLatencyOutgoing", "AverageLatencyIncoming");
	}

	GetNetChannelAveragePacketLoss(nFlow) {
		return GetFlowValue(RequireNetChannelInformationData(this.Address), nFlow, "AverageLossOutgoing", "AverageLossIncoming");
	}

	GetNetChannelAverageChoke(nFlow) {
		return GetFlowValue(RequireNetChannelInformationData(this.Address), nFlow, "AverageChokeOutgoing", "AverageChokeIncoming");
	}

	GetNetChannelAverageDataRate(nFlow) {
		return GetFlowValue(RequireNetChannelInformationData(this.Address), nFlow, "AverageDataOutgoing", "AverageDataIncoming");
	}

	GetNetChannelAveragePacketRate(nFlow) {
		return GetFlowValue(RequireNetChannelInformationData(this.Address), nFlow, "AveragePacketsOutgoing", "AveragePacketsIncoming");
	}

	GetNetChannelTotalDataBytes(nFlow) {
		return GetFlowValue(RequireNetChannelInformationData(this.Address), nFlow, "TotalDataOutgoing", "TotalDataIncoming");
	}

	GetNetChannelSequenceNumber(nFlow) {
		return GetFlowValue(RequireNetChannelInformationData(this.Address), nFlow, "SequenceOutgoing", "SequenceIncoming");
	}

	IsNetChannelPacketValid(nFlow, nFrameNumber) {
		return g_NetChannelRuntime.IsPacketValid(this.Address, RequireFlow(nFlow), nFrameNumber);
	}

	GetNetChannelPacketTime(nFlow, nFrameNumber) {
		return g_NetChannelRuntime.GetPacketTime(this.Address, RequireFlow(nFlow), nFrameNumber);
	}

	GetNetChannelPacketByteCount(nFlow, nFrameNumber, nPacketGroup) {
		return g_NetChannelRuntime.GetPacketBytes(this.Address, RequireFlow(nFlow), nFrameNumber, nPacketGroup);
	}

	GetNetChannelStreamProgress(nFlow) {
		return g_NetChannelRuntime.GetStreamProgress(this.Address, RequireFlow(nFlow));
	}

	get Name() {
		return RequireNetChannelInformationData(this.Address).Name;
	}

	get RemoteAddress() {
		return RequireNetChannelInformationData(this.Address).RemoteAddress;
	}

	get Time() {
		return RequireNetChannelInformationData(this.Address).Time;
	}

	get TimeConnected() {
		return RequireNetChannelInformationData(this.Address).TimeConnected;
	}

	get TimeSinceLastReceived() {
		return RequireNetChannelInformationData(this.Address).TimeSinceLastReceived;
	}

	get BufferSize() {
		return RequireNetChannelInformationData(this.Address).BufferSize;
	}

	get DataRate() {
		return RequireNetChannelInformationData(this.Address).DataRate;
	}

	set DataRate(flDataRate) {
		g_NetChannelRuntime.SetDataRate(this.NetworkChannelAddress, flDataRate);
	}

	get NetworkChannelAddress() {
		return RequireNetChannelInformationData(this.Address).NetworkChannelAddress;
	}

	get NetChannel() {
		return new NetChannel(this.NetworkChannelAddress, this.PlayerIndex);
	}
}

if (typeof g_NetChannelRuntime.GetTimeoutSeconds === "function") {
	Object.defineProperty(NetChannelInfo.prototype, "TimeoutSeconds", {
		configurable: true,
		enumerable: false,
		get() {
			return g_NetChannelRuntime.GetTimeoutSeconds(this.Address);
		},
	});
}

for (const vecMethodEntry of [
	["GetNetChannelRemoteFrameRate", "GetRemoteFrameRate"],
	["GetNetChannelTotalPacketCount", "GetTotalPackets"],
	["GetNetChannelCommandInterpolationAmount", "GetCommandInterpolationAmount"],
	["GetNetChannelPacketResponseLatency", "GetPacketResponseLatency"],
]) {
	const strMethodName = vecMethodEntry[0];
	const strRuntimeMethodName = vecMethodEntry[1];
	if (typeof g_NetChannelRuntime[strRuntimeMethodName] === "function") {
		Object.defineProperty(NetChannelInfo.prototype, strMethodName, {
			configurable: true,
			enumerable: false,
			value: function GetNetChannelOptionalMethod(nFlow, nFrameNumber) {
				const vecArguments = [this.Address];
				if (strMethodName !== "GetNetChannelRemoteFrameRate") {
					vecArguments.push(RequireFlow(nFlow));
				}

				if ((strMethodName === "GetNetChannelCommandInterpolationAmount") || (strMethodName === "GetNetChannelPacketResponseLatency")) {
					vecArguments.push(nFrameNumber);
				}

				return g_NetChannelRuntime[strRuntimeMethodName](...vecArguments);
			},
			writable: true,
		});
	}
}

class NetChannel extends NetChannelInfo {
	static GetPlayerNetChannel(unPlayerIndex) {
		const unValidatedPlayerIndex = RequirePlayerIndex(unPlayerIndex);
		const unAddress = g_NetChannelRuntime.GetChannelAddress(unValidatedPlayerIndex);

		return (unAddress === 0n) ? null : new NetChannel(unAddress, unValidatedPlayerIndex);
	}

	static CreateNetChannelFromAddress(unAddress) {
		return this.CreateFromAddress(unAddress);
	}

	SetNetChannelDataRate(flDataRate) {
		return g_NetChannelRuntime.SetDataRate(this.Address, flDataRate);
	}

	SendNetChannelFile(strFilePath, unTransferID, bIsReplayDemoFile = false) {
		return g_NetChannelRuntime.SendFile(this.Address, strFilePath, unTransferID, bIsReplayDemoFile);
	}

	DenyNetChannelFile(strFilePath, unTransferID, bIsReplayDemoFile = false) {
		return g_NetChannelRuntime.DenyFile(this.Address, strFilePath, unTransferID, bIsReplayDemoFile);
	}

	RequestNetChannelFile(strFilePath, bIsReplayDemoFile = false) {
		return g_NetChannelRuntime.RequestFile(this.Address, strFilePath, bIsReplayDemoFile);
	}

	SendNetChannelData(MessageBuffer, bReliableDelivery = true) {
		return g_NetChannelRuntime.SendData(this.Address, MessageBuffer, bReliableDelivery);
	}

	get MessageHandler() {
		const unAddress = g_NetChannelRuntime.GetMessageHandlerAddress(this.Address);

		return (unAddress === 0n) ? null : new NetChannelHandler(unAddress);
	}
}

class NetMessage extends NetChannelAddressBackedObject {
	static CreateNetMessageFromAddress(unAddress) {
		return this.CreateFromAddress(unAddress);
	}

	ProcessNetMessage() {
		return g_NetChannelRuntime.ProcessMessage(this.Address);
	}

	ReadNetMessageFromBuffer(MessageBuffer) {
		const ReadResult = g_NetChannelRuntime.ReadMessageFromBuffer(this.Address, MessageBuffer);
		UpdateReadBuffer(MessageBuffer, ReadResult);

		return ReadResult.Succeeded;
	}

	WriteNetMessageToBuffer(MessageBuffer) {
		const WriteResult = g_NetChannelRuntime.WriteMessageToBuffer(this.Address, MessageBuffer);
		UpdateWriteBuffer(MessageBuffer, WriteResult);

		return WriteResult.Succeeded;
	}

	toString() {
		return g_NetChannelRuntime.GetMessageString(this.Address);
	}

	get ReliableDelivery() {
		return g_NetChannelRuntime.IsMessageReliable(this.Address);
	}

	set ReliableDelivery(bReliableDelivery) {
		g_NetChannelRuntime.SetMessageReliable(this.Address, bReliableDelivery);
	}

	get MessageType() {
		return g_NetChannelRuntime.GetMessageType(this.Address);
	}

	get MessageGroup() {
		return g_NetChannelRuntime.GetMessageGroup(this.Address);
	}

	get MessageName() {
		return g_NetChannelRuntime.GetMessageName(this.Address);
	}

	get NetChannel() {
		const unAddress = g_NetChannelRuntime.GetMessageChannel(this.Address);

		return (unAddress === 0n) ? null : new NetChannel(unAddress);
	}

	set NetChannel(NetChannelOrAddress) {
		const unAddress = (NetChannelOrAddress instanceof NetChannel) ? NetChannelOrAddress.Address : NetChannelOrAddress;
		g_NetChannelRuntime.SetMessageChannel(this.Address, RequireAddress(unAddress));
	}
}

RegisterObjectType("NetChannelHandler", NetChannelHandler);
RegisterObjectType("NetChannelInfo", NetChannelInfo);
RegisterObjectType("NetChannel", NetChannel);
RegisterObjectType("NetMessage", NetMessage);

function GetPlayerNetChannelInfo(unPlayerIndex) {
	const unValidatedPlayerIndex = RequirePlayerIndex(unPlayerIndex);
	const NetChannelInformationData = g_NetChannelRuntime.GetInformation(unValidatedPlayerIndex);

	return (NetChannelInformationData === null) ? null : new NetChannelInfo(NetChannelInformationData.Address, unValidatedPlayerIndex);
}

const g_NetChannelExports = {
	NET_FLOW: g_NetFlow,
	NetChannel: NetChannel,
	NetChannelHandler: NetChannelHandler,
	NetChannelInfo: NetChannelInfo,
	NetMessage: NetMessage,
	GetPlayerNetChannel: NetChannel.GetPlayerNetChannel,
	GetPlayerNetChannelInfo: GetPlayerNetChannelInfo,
};

module.exports = g_NetChannelExports;
