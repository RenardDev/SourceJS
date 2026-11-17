"use strict";

// Load only against the loopback echo fixture on port 27391.
const { RegisterCommand } = require("commands/server");
const { LogInfo } = require("core/logger");
const { CancelRequest, Close, Connect, Receive, Send } = require("socket");

function Require(bCondition, strMessage) {
	if (!bCondition) {
		throw new Error(strMessage);
	}
}

function RunSocketProbe() {
	let nConnectionHandle = 0;
	const Result = Connect("127.0.0.1", 27391, { Blocking: true, Timeout: 2000 }, (RequestError, nHandle) => {
		if (RequestError) {
			throw RequestError;
		}

		nConnectionHandle = nHandle;
	});
	Require((Result === undefined) && (nConnectionHandle > 0), "Blocking connect did not complete inline.");

	let bMissingCallbackRejected = false;
	try {
		Receive(nConnectionHandle, 1, { Blocking: true });
	} catch (Failure) {
		bMissingCallbackRejected = true;
	}

	Require(bMissingCallbackRejected, "Blocking receive accepted a missing callback.");

	let bBlockingTimeout = false;
	Receive(nConnectionHandle, 1, { Blocking: true, Timeout: 60 }, (RequestError, Bytes) => {
		bBlockingTimeout = (Bytes === undefined) && (RequestError instanceof Error) && RequestError.message.includes("timed out");
	});
	Require(bBlockingTimeout, "Blocking receive did not deliver its timeout before returning.");
	LogInfo("Socket V8 blocking checks passed.");

	const nRequestHandle = Receive(nConnectionHandle, 1, { Timeout: 2000 }, (RequestError, Bytes) => {
		Require((Bytes === undefined) && (RequestError instanceof Error) && RequestError.message.includes("cancelled"), "Receive did not report cancellation.");
		Send(nConnectionHandle, [81], { Blocking: true, Timeout: 1000 }, (SendError, unByteCount) => {
			Require(!SendError && (unByteCount === 1), "Send failed after cancellation.");
		});
		Receive(nConnectionHandle, 1, { Timeout: 1000 }, (ReceiveError, Echo) => {
			Require(!ReceiveError && (Echo instanceof Uint8Array) && (Echo.length === 1) && (Echo[0] === 81), "Socket did not receive the echo after cancellation.");
			Close(nConnectionHandle, { Blocking: true, Timeout: 1000 }, (CloseError, bClosed) => {
				Require(!CloseError && bClosed, "Socket close failed.");
				LogInfo("Socket V8 probe passed.");
			});
		});
	});
	Require(Number.isInteger(nRequestHandle) && (nRequestHandle > 0) && CancelRequest(nRequestHandle) && !CancelRequest(nRequestHandle), "Request handle did not support single cancellation.");
}

function Load() {
	Require(RegisterCommand("sjs_socket_probe", RunSocketProbe), "Could not register the socket probe command.");
	RunSocketProbe();
}

module.exports = { Load };
