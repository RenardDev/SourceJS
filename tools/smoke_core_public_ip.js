"use strict";

const g_Assert = require("node:assert/strict");
const g_FileSystem = require("node:fs");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strCorePath = g_Path.join(__dirname, "../packages/sourcejs/core.js");
const g_strDefaultURL = "https://api.ipify.org/";
const g_unRequestTimeoutMilliseconds = 3_000;
const g_unHTTPLastInformationalStatusCode = 199;
const g_unHTTPOKStatusCode = 200;
const g_unHTTPNoContentStatusCode = 204;
const g_unHTTPLastSuccessStatusCode = 299;
const g_unHTTPFirstRedirectionStatusCode = 300;
const g_unHTTPServiceUnavailableStatusCode = 503;
const g_vecPendingRequests = [];
const g_RequestReturnToken = {};
let g_RequestSubmissionError = null;

function RejectUnexpectedCallback() {
	throw new Error("Invalid public IP requests must not invoke a callback.");
}

function QueueHTTPRequest(Options, Callback) {
	g_Assert.deepEqual(Object.keys(Options).sort(), ["Timeout", "URL"]);
	g_Assert.equal(Options.Timeout, g_unRequestTimeoutMilliseconds);
	g_Assert.equal(typeof Callback, "function");

	if (g_RequestSubmissionError !== null) {
		throw g_RequestSubmissionError;
	}

	g_vecPendingRequests.push({ Options, Callback });

	return g_RequestReturnToken;
}

const g_mapNativeModules = new Map([
	["core", {}],
	["cpr", { Get: QueueHTTPRequest }],
	["interfaces", {}],
	["listeners", {}],
]);

function RejectNativeOperation() {
	throw new Error("Public IP helper checks must not perform native IO.");
}

function RequireDependency(strModuleName) {
	switch (strModuleName) {
		case "filesystem":
			return { DoesFileExist: RejectNativeOperation, ReadTextFile: RejectNativeOperation };

		case "internal/runtime":
			return {
				GetModule(strNativeModuleName) {
					g_Assert.ok(g_mapNativeModules.has(strNativeModuleName), `Unexpected native module ${strNativeModuleName}`);

					return g_mapNativeModules.get(strNativeModuleName);
				},
			};

		case "loggers":
			// Keep the removed logger name only as an explicit failure trap.
			return { Info: RejectNativeOperation };

		case "paths":
			return { CONFIG_ROOT: "cfg/sourcejs" };

		default:
			throw new Error(`Unexpected dependency ${strModuleName}`);
	}
}

const g_Module = { exports: {} };
g_VM.runInNewContext(g_FileSystem.readFileSync(g_strCorePath, "utf8"), { module: g_Module, require: RequireDependency }, { filename: g_strCorePath });

const { GetPublicIPAddress } = g_Module.exports;
g_Assert.equal(GetPublicIPAddress.length, 2);

function BeginPublicIPRequest(vecArguments, strExpectedURL) {
	g_Assert.equal(g_vecPendingRequests.length, 0);

	const vecCallbackArguments = [];
	const Callback = (...vecResults) => {
		vecCallbackArguments.push(vecResults);
	};
	const Result = GetPublicIPAddress(...vecArguments, Callback);
	g_Assert.equal(Result, undefined);
	g_Assert.deepEqual(vecCallbackArguments, []);
	g_Assert.equal(g_vecPendingRequests.length, 1);

	const Request = g_vecPendingRequests.shift();
	g_Assert.equal(Request.Options.URL, strExpectedURL);

	return { Request, CallbackArguments: vecCallbackArguments };
}

// The real JS helper runs against a queued CPR double, not native networking or threads.
for (const TestCase of [
	{ Arguments: [], ExpectedURL: g_strDefaultURL, StatusCode: g_unHTTPOKStatusCode, Text: " 203.0.113.5\r\n", ExpectedAddress: "203.0.113.5" },
	{ Arguments: [undefined], ExpectedURL: g_strDefaultURL, StatusCode: g_unHTTPNoContentStatusCode, Text: " \n", ExpectedAddress: "" },
	{ Arguments: ["https://example.invalid/address"], ExpectedURL: "https://example.invalid/address", StatusCode: g_unHTTPLastSuccessStatusCode, Text: "\n2001:db8::1\n", ExpectedAddress: "2001:db8::1" },
]) {
	const PendingRequest = BeginPublicIPRequest(TestCase.Arguments, TestCase.ExpectedURL);
	PendingRequest.Request.Callback(null, { StatusCode: TestCase.StatusCode, Error: "", Text: TestCase.Text });
	g_Assert.deepEqual(PendingRequest.CallbackArguments, [[null, TestCase.ExpectedAddress]]);
}

const g_TransportRequest = BeginPublicIPRequest([], g_strDefaultURL);
const g_TransportError = new Error("Transport failure");
g_TransportRequest.Request.Callback(g_TransportError, undefined);
g_Assert.deepEqual(g_TransportRequest.CallbackArguments, [[g_TransportError]]);

const g_NativeErrorRequest = BeginPublicIPRequest([], g_strDefaultURL);
g_NativeErrorRequest.Request.Callback(null, { StatusCode: 0, Error: "Connection refused", Text: "" });
g_Assert.equal(g_NativeErrorRequest.CallbackArguments.length, 1);
g_Assert.equal(g_NativeErrorRequest.CallbackArguments[0].length, 1);
g_Assert.equal(g_NativeErrorRequest.CallbackArguments[0][0].name, "Error");
g_Assert.equal(g_NativeErrorRequest.CallbackArguments[0][0].message, "Connection refused");

for (const unStatusCode of [g_unHTTPOKStatusCode, g_unHTTPNoContentStatusCode, g_unHTTPLastSuccessStatusCode, g_unHTTPServiceUnavailableStatusCode]) {
	const PendingRequest = BeginPublicIPRequest([], g_strDefaultURL);
	PendingRequest.Request.Callback(null, { StatusCode: unStatusCode, Error: "Transfer interrupted", Text: "Partial response" });
	g_Assert.equal(PendingRequest.CallbackArguments.length, 1);
	g_Assert.equal(PendingRequest.CallbackArguments[0].length, 1);
	g_Assert.equal(PendingRequest.CallbackArguments[0][0].name, "Error");
	g_Assert.equal(PendingRequest.CallbackArguments[0][0].message, "Transfer interrupted");
}

for (const unStatusCode of [0, g_unHTTPLastInformationalStatusCode, g_unHTTPFirstRedirectionStatusCode, g_unHTTPServiceUnavailableStatusCode]) {
	const strURL = "https://example.invalid/failure";
	const PendingRequest = BeginPublicIPRequest([strURL], strURL);
	PendingRequest.Request.Callback(null, { StatusCode: unStatusCode, Error: "", Text: "Not an address" });
	g_Assert.equal(PendingRequest.CallbackArguments.length, 1);
	g_Assert.equal(PendingRequest.CallbackArguments[0].length, 1);
	g_Assert.equal(PendingRequest.CallbackArguments[0][0].name, "Error");
	g_Assert.equal(PendingRequest.CallbackArguments[0][0].message, `HTTP ${unStatusCode} while fetching ${strURL}`);
}

for (const URLValue of [null, "", 0, false, {}, [], RejectUnexpectedCallback]) {
	g_Assert.throws(() => GetPublicIPAddress(URLValue, RejectUnexpectedCallback), (ErrorValue) => (ErrorValue.name === "TypeError") && (ErrorValue.message === "Public IP request URL must be a non-empty string."));
	g_Assert.equal(g_vecPendingRequests.length, 0);
}

for (const CallbackValue of [undefined, null, false, 0, "callback", {}, []]) {
	g_Assert.throws(() => GetPublicIPAddress(undefined, CallbackValue), (ErrorValue) => (ErrorValue.name === "TypeError") && (ErrorValue.message === "Public IP request callback must be a function."));
	g_Assert.equal(g_vecPendingRequests.length, 0);
}

g_Assert.throws(() => GetPublicIPAddress(null, null), (ErrorValue) => ErrorValue.message === "Public IP request URL must be a non-empty string.");

const g_CallbackError = new Error("Callback failure");
GetPublicIPAddress(() => {
	throw g_CallbackError;
});

g_Assert.equal(g_vecPendingRequests.length, 1);

const g_ThrowingCallbackRequest = g_vecPendingRequests.shift();
g_Assert.throws(() => g_ThrowingCallbackRequest.Callback(null, { StatusCode: g_unHTTPOKStatusCode, Error: "", Text: "203.0.113.5" }), (ErrorValue) => ErrorValue === g_CallbackError);

g_RequestSubmissionError = new Error("Submission failure");
g_Assert.throws(() => GetPublicIPAddress(RejectUnexpectedCallback), (ErrorValue) => ErrorValue === g_RequestSubmissionError);
g_Assert.equal(g_vecPendingRequests.length, 0);

console.log("Core public IP helper smoke checks passed (queued CPR double; no native IO).");
