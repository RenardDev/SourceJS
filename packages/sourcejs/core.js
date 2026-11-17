"use strict";

const { DoesFileExist, ReadTextFile } = require("filesystem");
const { GetModule } = require("internal/runtime");
const { LogInfo } = require("loggers");
const { CONFIG_ROOT } = require("paths");

const g_unHexadecimalEscapeRadix = 16;
const g_unOctalEscapeRadix = 8;

const g_CoreRuntime = GetModule("core");
const g_CPRRuntime = GetModule("cpr");
const g_InterfacesRuntime = GetModule("interfaces");
const g_ListenersRuntime = GetModule("listeners");

const g_OutputReturn = Object.freeze({
	BLOCK: 0,
	CONTINUE: 1,
});

const g_MessageSeverity = Object.freeze({
	MESSAGE: 0,
	WARNING: 1,
	ASSERT: 2,
	ERROR: 3,
	LOG: 4,
});

// These lowercase keys are C-style escape syntax, not project API property names.
const g_EscapeCharacters = Object.freeze({
	a: "\x07",
	b: "\b",
	e: "\x1b",
	f: "\f",
	n: "\n",
	r: "\r",
	s: " ",
	t: "\t",
	v: "\v",
});

function NormalizeOwner(Owner) {
	return String(Owner ?? "global");
}

class AutomaticUnload {
	constructor(Owner = "global") {
		this.Owner = NormalizeOwner(Owner);
		this.AddUnloadInstance(this.Owner);
	}

	AddUnloadInstance(Owner = this.Owner) {
		const strNormalizedOwner = NormalizeOwner(Owner);
		const mapInstanceRegistry = this.constructor.Instances;
		if (!mapInstanceRegistry.has(strNormalizedOwner)) {
			mapInstanceRegistry.set(strNormalizedOwner, []);
		}

		const vecOwnerInstances = mapInstanceRegistry.get(strNormalizedOwner);
		vecOwnerInstances.push(this);

		return this;
	}

	UnloadInstance() {
		throw new Error(`${this.constructor.name}.UnloadInstance() must be implemented.`);
	}

	static UnloadOwnerInstances(Owner) {
		const strNormalizedOwner = NormalizeOwner(Owner);
		const mapInstanceRegistry = this.Instances;
		if (!mapInstanceRegistry.has(strNormalizedOwner)) {
			return 0;
		}

		const vecOwnerInstances = mapInstanceRegistry.get(strNormalizedOwner);
		if (!Array.isArray(vecOwnerInstances)) {
			throw new TypeError("AutomaticUnload owner registry entries must be arrays.");
		}

		const vecInstancesToUnload = vecOwnerInstances.slice().reverse();
		for (const Instance of vecInstancesToUnload) {
			Instance.UnloadInstance();

			if (mapInstanceRegistry.get(strNormalizedOwner) !== vecOwnerInstances) {
				continue;
			}

			const nInstanceIndex = vecOwnerInstances.lastIndexOf(Instance);
			if (nInstanceIndex >= 0) {
				vecOwnerInstances.splice(nInstanceIndex, 1);
			}
		}

		if ((mapInstanceRegistry.get(strNormalizedOwner) === vecOwnerInstances) && (vecOwnerInstances.length === 0)) {
			mapInstanceRegistry.delete(strNormalizedOwner);
		}

		return vecInstancesToUnload.length;
	}

	static ClearOwnerInstances(Owner) {
		const strNormalizedOwner = NormalizeOwner(Owner);
		const mapInstanceRegistry = this.Instances;
		if (!mapInstanceRegistry.has(strNormalizedOwner)) {
			return 0;
		}

		const vecOwnerInstances = mapInstanceRegistry.get(strNormalizedOwner);
		if (!Array.isArray(vecOwnerInstances)) {
			throw new TypeError("AutomaticUnload owner registry entries must be arrays.");
		}

		const unClearedInstanceCount = vecOwnerInstances.length;

		mapInstanceRegistry.delete(strNormalizedOwner);

		return unClearedInstanceCount;
	}
}

Object.defineProperty(AutomaticUnload, "Instances", {
	value: new Map(),
	writable: true,
	enumerable: true,
	configurable: true,
});

class WeakAutomaticUnload extends AutomaticUnload {
	AddUnloadInstance(Owner = this.Owner) {
		const strNormalizedOwner = NormalizeOwner(Owner);
		const mapInstanceRegistry = this.constructor.Instances;
		if (!mapInstanceRegistry.has(strNormalizedOwner)) {
			mapInstanceRegistry.set(strNormalizedOwner, new Map());
		}

		const mapOwnerReferences = mapInstanceRegistry.get(strNormalizedOwner);
		if (!(mapOwnerReferences instanceof Map)) {
			throw new TypeError("WeakAutomaticUnload owner registry entries must be maps.");
		}

		const ReferenceToken = Symbol();
		const WeakReference = new WeakRef(this);
		mapOwnerReferences.set(ReferenceToken, WeakReference);

		return this;
	}

	static UnloadOwnerInstances(Owner) {
		const strNormalizedOwner = NormalizeOwner(Owner);
		const mapInstanceRegistry = this.Instances;
		if (!mapInstanceRegistry.has(strNormalizedOwner)) {
			return 0;
		}

		const mapOwnerReferences = mapInstanceRegistry.get(strNormalizedOwner);
		if (!(mapOwnerReferences instanceof Map)) {
			throw new TypeError("WeakAutomaticUnload owner registry entries must be maps.");
		}

		const vecReferencesToUnload = Array.from(mapOwnerReferences.entries());
		let unUnloadedInstanceCount = 0;
		for (const [ReferenceToken, WeakReference] of vecReferencesToUnload) {
			const ReferencedInstance = WeakReference.deref();
			if (!ReferencedInstance) {
				mapOwnerReferences.delete(ReferenceToken);
				continue;
			}

			ReferencedInstance.UnloadInstance();
			mapOwnerReferences.delete(ReferenceToken);
			unUnloadedInstanceCount += 1;
		}

		if ((mapInstanceRegistry.get(strNormalizedOwner) === mapOwnerReferences) && (mapOwnerReferences.size === 0)) {
			mapInstanceRegistry.delete(strNormalizedOwner);
		}

		return unUnloadedInstanceCount;
	}

	static ClearOwnerInstances(Owner) {
		const strNormalizedOwner = NormalizeOwner(Owner);
		const mapInstanceRegistry = this.Instances;
		if (!mapInstanceRegistry.has(strNormalizedOwner)) {
			return 0;
		}

		const mapOwnerReferences = mapInstanceRegistry.get(strNormalizedOwner);
		if (!(mapOwnerReferences instanceof Map)) {
			throw new TypeError("WeakAutomaticUnload owner registry entries must be maps.");
		}

		const unClearedReferenceCount = mapOwnerReferences.size;

		mapInstanceRegistry.delete(strNormalizedOwner);

		return unClearedReferenceCount;
	}
}

Object.defineProperty(WeakAutomaticUnload, "Instances", {
	value: new Map(),
	writable: true,
	enumerable: true,
	configurable: true,
});

function CreateChecksum(strChecksumData, bIgnoreWhitespace = true) {
	if (typeof strChecksumData !== "string") {
		throw new TypeError("Checksum data must be a string.");
	}

	if (typeof bIgnoreWhitespace !== "boolean") {
		throw new TypeError("Checksum bIgnoreWhitespace must be a boolean.");
	}

	const strChecksumText = bIgnoreWhitespace ? strChecksumData.replace(/\s+/g, "") : strChecksumData;

	return g_CoreRuntime.GetChecksum(strChecksumText);
}

class Tokenizer extends Array {
	constructor(strText = "", Options = {}) {
		super();

		if (typeof strText !== "string") {
			throw new TypeError("Tokenizer text must be a string.");
		}

		if (!Options || (typeof Options !== "object") || Array.isArray(Options)) {
			throw new TypeError("Tokenizer options must be an object.");
		}

		const strCommentPrefix = Options.CommentPrefix ?? null;
		if ((strCommentPrefix !== null) && ((typeof strCommentPrefix !== "string") || (strCommentPrefix.length === 0))) {
			throw new TypeError("Tokenizer CommentPrefix must be a non-empty string or null.");
		}

		this.SourceText = strText;

		let strCurrentToken = "";
		let bCurrentTokenStarted = false;
		let bInsideQuotedToken = false;
		let bEscapingCharacter = false;
		let strRetainedSourceText = "";
		for (let unCharacterIndex = 0; unCharacterIndex < strText.length; ++unCharacterIndex) {
			const strCharacter = strText[unCharacterIndex];
			if (!bInsideQuotedToken && !bCurrentTokenStarted && (strCommentPrefix !== null) && strText.startsWith(strCommentPrefix, unCharacterIndex)) {
				this.SourceText = strRetainedSourceText.trimEnd();
				break;
			}

			strRetainedSourceText += strCharacter;

			if (bEscapingCharacter) {
				strCurrentToken += strCharacter;
				bEscapingCharacter = false;
				continue;
			}

			if (bInsideQuotedToken && (strCharacter === "\\")) {
				bEscapingCharacter = true;
				continue;
			}

			if (strCharacter === "\"") {
				bInsideQuotedToken = !bInsideQuotedToken;
				bCurrentTokenStarted = true;
				continue;
			}

			if (!bInsideQuotedToken && /\s/.test(strCharacter)) {
				if (bCurrentTokenStarted) {
					this.push(strCurrentToken);
					strCurrentToken = "";
					bCurrentTokenStarted = false;
				}

				continue;
			}

			strCurrentToken += strCharacter;
			bCurrentTokenStarted = true;
		}

		if (bEscapingCharacter) {
			strCurrentToken += "\\";
		}

		if (bCurrentTokenStarted) {
			this.push(strCurrentToken);
		}
	}

	toString() {
		return this.SourceText;
	}

	GetTokenHash() {
		return CreateChecksum(this.SourceText, false);
	}

	static get [Symbol.species]() {
		return Array;
	}
}

function ResolveConfigPath(strRequestedFilePath) {
	if ((typeof strRequestedFilePath !== "string") || (strRequestedFilePath.length === 0)) {
		throw new TypeError("Config file path must be a non-empty string.");
	}

	if (DoesFileExist(strRequestedFilePath)) {
		return strRequestedFilePath;
	}

	if ((typeof CONFIG_ROOT !== "string") || (CONFIG_ROOT.length === 0)) {
		throw new Error("SourceJS config root is unavailable.");
	}

	const strPathSeparator = CONFIG_ROOT.includes("\\") ? "\\" : "/";
	const strResolvedConfigurationPath = `${CONFIG_ROOT.replace(/[\\/]+$/, "")}${strPathSeparator}${strRequestedFilePath.replace(/^[\\/]+/, "")}`;
	if (!DoesFileExist(strResolvedConfigurationPath)) {
		throw new Error(`Config file not found: ${strRequestedFilePath}`);
	}

	return strResolvedConfigurationPath;
}

function ReplaceEscapedSequences(strEscapedText) {
	if (typeof strEscapedText !== "string") {
		throw new TypeError("Escaped text must be a string.");
	}

	const ReplaceEscapeSequence = (strEscapeSequence) => {
		const strEscapeValue = strEscapeSequence.slice(1);
		if (/^[0-7]/.test(strEscapeValue)) {
			return String.fromCharCode(Number.parseInt(strEscapeValue, g_unOctalEscapeRadix));
		}

		if (strEscapeValue.startsWith("x")) {
			return String.fromCharCode(Number.parseInt(strEscapeValue.slice(1), g_unHexadecimalEscapeRadix));
		}

		return g_EscapeCharacters[strEscapeValue];
	};

	return strEscapedText.replace(/\\(?:[0-7]{1,3}|x[0-9a-fA-F]{2}|[abefnrstv])/g, ReplaceEscapeSequence);
}

class ConfigurationFile extends Array {
	constructor(strFilePath, Options = {}) {
		super();

		if (!Options || (typeof Options !== "object") || Array.isArray(Options)) {
			throw new TypeError("ConfigurationFile options must be an object.");
		}

		const strCommentPrefix = Options.CommentPrefix ?? "//";
		const bAsStrings = Options.AsStrings ?? false;
		if ((typeof strCommentPrefix !== "string") || (strCommentPrefix.length === 0)) {
			throw new TypeError("ConfigurationFile CommentPrefix must be a non-empty string or null.");
		}

		if (typeof bAsStrings !== "boolean") {
			throw new TypeError("ConfigurationFile AsStrings must be a boolean.");
		}

		const strResolvedFilePath = ResolveConfigPath(strFilePath);
		const strConfigurationText = ReadTextFile(strResolvedFilePath);
		if (typeof strConfigurationText !== "string") {
			throw new Error(`Unable to read config file: ${strResolvedFilePath}`);
		}

		this.FilePath = strResolvedFilePath;

		for (const strConfigurationLine of strConfigurationText.split(/\r?\n/)) {
			const vecLineTokens = new Tokenizer(ReplaceEscapedSequences(strConfigurationLine), { CommentPrefix: strCommentPrefix });
			if (vecLineTokens.length === 0) {
				continue;
			}

			this.push(bAsStrings ? vecLineTokens.toString() : vecLineTokens);
		}
	}

	static get [Symbol.species]() {
		return Array;
	}
}

function SendConsoleMessage(Message) {
	const strMessageText = String(Message ?? "").replace(/\r?\n$/, "");

	return LogInfo(strMessageText);
}

function GetPublicIPAddress(URLOrCallback, Callback) {
	const strDefaultPublicIPAddressURL = "https://api.ipify.org/";
	const unRequestTimeoutMilliseconds = 3000;
	const unHTTPSuccessStatusCodeBegin = 200;
	const unHTTPSuccessStatusCodeEnd = 300;

	if ((typeof URLOrCallback === "function") && (Callback === undefined)) {
		Callback = URLOrCallback;
		URLOrCallback = undefined;
	}

	const strURL = (URLOrCallback === undefined) ? strDefaultPublicIPAddressURL : URLOrCallback;
	if ((typeof strURL !== "string") || (strURL.length === 0)) {
		throw new TypeError("Public IP request URL must be a non-empty string.");
	}

	if (typeof Callback !== "function") {
		throw new TypeError("Public IP request callback must be a function.");
	}

	g_CPRRuntime.Get({
		Timeout: unRequestTimeoutMilliseconds,
		URL: strURL,
	}, (RequestError, HTTPResponse) => {
		if (RequestError) {
			Callback(RequestError);
			return;
		}

		const unStatusCode = HTTPResponse.StatusCode;
		const strRequestError = HTTPResponse.Error;
		if (strRequestError) {
			Callback(new Error(strRequestError));
			return;
		}

		if ((unStatusCode < unHTTPSuccessStatusCodeBegin) || (unStatusCode >= unHTTPSuccessStatusCodeEnd)) {
			Callback(new Error(`HTTP ${unStatusCode} while fetching ${strURL}`));
			return;
		}

		Callback(null, HTTPResponse.Text.trim());
	});
}

function RunIgnoringUnicodeErrors(Callback, FallbackValue = "") {
	if (typeof Callback !== "function") {
		throw new TypeError("RunIgnoringUnicodeErrors callback must be a function.");
	}

	try {
		return Callback();
	} catch (ErrorValue) {
		if ((ErrorValue instanceof TypeError) || (ErrorValue instanceof URIError)) {
			return FallbackValue;
		}

		throw ErrorValue;
	}
}

function NormalizeOutputReturn(unOutputAction) {
	if (unOutputAction === g_OutputReturn.BLOCK) {
		return g_OutputReturn.BLOCK;
	}

	if (unOutputAction === g_OutputReturn.CONTINUE) {
		return g_OutputReturn.CONTINUE;
	}

	throw new TypeError("Server output action must be OutputReturn.BLOCK or OutputReturn.CONTINUE.");
}

function DecodeServerOutputPayload(ServerOutputPayload) {
	if ((ServerOutputPayload === null) || (ServerOutputPayload === undefined) || (ServerOutputPayload === "")) {
		return [];
	}

	let DecodedPayload = ServerOutputPayload;
	if (typeof ServerOutputPayload === "string") {
		const strTrimmedPayloadText = ServerOutputPayload.trim();
		if (!strTrimmedPayloadText.startsWith("{") && !strTrimmedPayloadText.startsWith("[")) {
			return [ServerOutputPayload];
		}

		DecodedPayload = JSON.parse(strTrimmedPayloadText);
	}

	if (Array.isArray(DecodedPayload)) {
		return DecodedPayload;
	}

	if (DecodedPayload) {
		const vecPayloadArguments = DecodedPayload.Arguments;
		if (Array.isArray(vecPayloadArguments)) {
			return vecPayloadArguments;
		}
	}

	return [DecodedPayload];
}

function CaptureServerOutput(unOutputAction = g_OutputReturn.CONTINUE, CaptureCallback = null) {
	const unNormalizedOutputAction = NormalizeOutputReturn(unOutputAction);

	if ((CaptureCallback !== null) && (typeof CaptureCallback !== "function")) {
		throw new TypeError("Server output callback must be a function or null.");
	}

	const vecOutputEntries = [];
	const OutputListener = (strEmittedEventName, ServerOutputPayload) => {
		if (strEmittedEventName !== "ServerOutput") {
			throw new Error(`Unexpected server output event: ${strEmittedEventName}`);
		}

		const [unMessageSeverity, strOutputMessage] = DecodeServerOutputPayload(ServerOutputPayload);
		if (!Number.isInteger(unMessageSeverity)) {
			throw new TypeError("Server output severity must be an integer.");
		}

		if ((unMessageSeverity < g_MessageSeverity.MESSAGE) || (unMessageSeverity > g_MessageSeverity.LOG)) {
			throw new RangeError("Server output severity is outside the supported range.");
		}

		if (typeof strOutputMessage !== "string") {
			throw new TypeError("Server output message must be a string.");
		}

		vecOutputEntries.push({ Message: strOutputMessage, Severity: unMessageSeverity });

		return unNormalizedOutputAction;
	};

	if (!g_ListenersRuntime.On("ServerOutput", OutputListener)) {
		throw new Error("Unable to register the server output listener.");
	}

	if (CaptureCallback !== null) {
		let CaptureResult = undefined;
		let CaptureFailure = undefined;
		let bCaptureFailed = false;
		try {
			CaptureResult = CaptureCallback(vecOutputEntries);
		} catch (CaptureError) {
			CaptureFailure = CaptureError;
			bCaptureFailed = true;
		}

		try {
			if (!g_ListenersRuntime.Off("ServerOutput", OutputListener)) {
				throw new Error("Unable to unregister the server output listener.");
			}
		} catch (CleanupError) {
			if (bCaptureFailed) {
				throw new AggregateError([CaptureFailure, CleanupError], "Server output capture and listener cleanup both failed.");
			}

			throw CleanupError;
		}

		if (bCaptureFailed) {
			throw CaptureFailure;
		}

		return CaptureResult;
	}

	let bListenerClosed = false;

	return {
		OutputEntries: vecOutputEntries,
		CloseServerOutputCapture() {
			if (bListenerClosed) {
				return false;
			}

			if (!g_ListenersRuntime.Off("ServerOutput", OutputListener)) {
				return false;
			}

			bListenerClosed = true;

			return true;
		},
	};
}

function CheckInformationOutput(strInformationOutput) {
	if (typeof strInformationOutput !== "string") {
		throw new TypeError("Info output must be a string.");
	}

	const vecInformationLines = strInformationOutput.trim().split(/\r?\n/);
	let strExpectedChecksum = null;
	let unContentStartIndex = vecInformationLines.length;
	for (let unLineIndex = 0; unLineIndex < vecInformationLines.length; ++unLineIndex) {
		const strInformationLine = vecInformationLines[unLineIndex];
		if (!strInformationLine.startsWith("Checksum")) {
			continue;
		}

		const nSeparatorIndex = strInformationLine.indexOf(":");
		if (nSeparatorIndex >= 0) {
			strExpectedChecksum = strInformationLine.slice(nSeparatorIndex + 1).trim();
		}

		unContentStartIndex = unLineIndex + 1;
		break;
	}

	if (!strExpectedChecksum) {
		throw new Error("Checksum not found.");
	}

	let unContentEndIndex = vecInformationLines.length;
	if ((unContentStartIndex < unContentEndIndex) && vecInformationLines[unContentEndIndex - 1].startsWith("-")) {
		unContentEndIndex -= 1;
	}

	let strChecksumSource = "";
	for (let unLineIndex = unContentStartIndex; unLineIndex < unContentEndIndex; ++unLineIndex) {
		strChecksumSource += vecInformationLines[unLineIndex];
	}

	return CreateChecksum(strChecksumSource) !== strExpectedChecksum;
}

function GetSourceJSVersion() {
	return g_CoreRuntime.GetVersion();
}

function GetGlobalInfo() {
	const NativeInformation = g_CoreRuntime.GetInfo();

	return {
		Architecture: NativeInformation.Architecture,
		GameName: NativeInformation.GameName,
		GitCommit: NativeInformation.GitCommit,
		Platform: NativeInformation.Platform,
		Runtime: NativeInformation.Runtime,
		SDKBranch: NativeInformation.SDKBranch,
		SourceEngine: NativeInformation.SourceEngine,
		SourceEngineBranch: NativeInformation.SourceEngineBranch,
		Version: NativeInformation.Version,
	};
}

function GetCoreModules() {
	return g_CoreRuntime.GetModules();
}

function GetPublicPackages() {
	return g_CoreRuntime.GetPublicPackages();
}

function GetSourceEngineInterface(strInterfaceName) {
	return g_InterfacesRuntime.GetInterfaceRecord(strInterfaceName);
}

const g_CoreAPI = {
	AutomaticUnload: AutomaticUnload,
	CaptureServerOutput: CaptureServerOutput,
	CheckInformationOutput: CheckInformationOutput,
	ConfigurationFile: ConfigurationFile,
	CreateChecksum: CreateChecksum,
	GetCoreModules: GetCoreModules,
	GetGlobalInfo: GetGlobalInfo,
	GetPublicIPAddress: GetPublicIPAddress,
	GetPublicPackages: GetPublicPackages,
	GetSourceEngineInterface: GetSourceEngineInterface,
	GetSourceJSVersion: GetSourceJSVersion,
	MessageSeverity: g_MessageSeverity,
	OutputReturn: g_OutputReturn,
	RunIgnoringUnicodeErrors: RunIgnoringUnicodeErrors,
	ReplaceEscapedSequences: ReplaceEscapedSequences,
	SendConsoleMessage: SendConsoleMessage,
	Tokenizer: Tokenizer,
	WeakAutomaticUnload: WeakAutomaticUnload,
};

Object.defineProperties(g_CoreAPI, {
	GAME_NAME: {
		enumerable: true,
		get() {
			return GetGlobalInfo().GameName;
		},
	},
	MODULE_NAME: {
		enumerable: true,
		value: "core",
	},
	PLATFORM: {
		enumerable: true,
		get() {
			return GetGlobalInfo().Platform;
		},
	},
	SOURCE_ENGINE: {
		enumerable: true,
		get() {
			return GetGlobalInfo().SourceEngine;
		},
	},
	SOURCE_ENGINE_BRANCH: {
		enumerable: true,
		get() {
			return GetGlobalInfo().SourceEngineBranch;
		},
	},
});

module.exports = g_CoreAPI;
