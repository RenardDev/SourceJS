#!/usr/bin/env node

"use strict";

const g_Assert = require("node:assert/strict");
const g_ChildProcess = require("node:child_process");
const g_FileSystem = require("node:fs");
const g_Module = require("node:module");
const g_Path = require("node:path");
const g_VM = require("node:vm");

const g_strRepositoryRootPath = g_Path.resolve(__dirname, "..");
const g_strPackageRootPath = g_Path.join(g_strRepositoryRootPath, "packages", "sourcejs");
const g_strBitbuffersPath = g_Path.join(g_strPackageRootPath, "bitbuffers.js");
const g_strMessagesPath = g_Path.join(g_strPackageRootPath, "messages.js");
const g_strMessagesDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "messages.md");
const g_strMessagesBasePath = g_Path.join(g_strPackageRootPath, "messages", "index.js");
const g_strMessagesBaseDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "messages-types.md");
const g_strMessageColorsPath = g_Path.join(g_strPackageRootPath, "messages", "colors.js");
const g_strMessageColorsDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "messages-colors.md");
const g_strSayText2ColorsPath = g_Path.join(g_strPackageRootPath, "messages", "colors", "saytext2.js");
const g_strSayText2ColorsDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "messages-colors-saytext2.md");
const g_strMessagesDialogPath = g_Path.join(g_strPackageRootPath, "messages", "dialog.js");
const g_strMessagesDialogDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "messages-dialog.md");
const g_strMessagesImplementationPath = g_Path.join(g_strPackageRootPath, "messages", "implementation.js");
const g_strMessagesImplementationDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "messages-implementation.md");
const g_strMessageHooksPath = g_Path.join(g_strPackageRootPath, "memory", "hooks", "messages.js");
const g_strMessageHooksDocumentationPath = g_Path.join(g_strRepositoryRootPath, "docs", "api", "memory-hooks-messages.md");
const g_strBitbuffersMockPath = g_Path.join(g_strRepositoryRootPath, "tools", "native_bitbuffers_mock.js");
const g_unDocumentationTimeoutMilliseconds = 1000;
const g_unChildProcessTimeoutMilliseconds = 10000;

// This standalone smoke process owns its package-search configuration.
process.env.NODE_PATH = [g_strPackageRootPath, process.env.NODE_PATH].filter(Boolean).join(g_Path.delimiter);
g_Module._initPaths();

const g_vecBitbufferFieldTypes = Object.freeze([
	"bits",
	"bool",
	"byte",
	"float",
	"int",
	"short",
	"string",
	"uint",
]);

// Project-owned compact uppercase operation codes shared with the native descriptor parser.
const g_vecProtobufFieldKinds = Object.freeze([
	"ADD",
	"ADDMESSAGE",
	"MESSAGE",
	"SET",
]);
const g_vecProtobufFieldTypes = Object.freeze([
	"bool",
	"double",
	"enum",
	"float",
	"int32",
	"int64",
	"string",
	"uint32",
	"uint64",
]);

const g_nMinimumInt64Value = -(1n << 63n);
const g_nMaximumInt64Value = (1n << 63n) - 1n;
const g_unMaximumUInt64Value = (1n << 64n) - 1n;

function RunMessageDocumentationOperation(Operation, vecArguments, strScenarioLabel) {
	// Bound synchronous JavaScript, not native IO or untrusted-code capabilities.
	const Script = new g_VM.Script("Operation(...Arguments)", { filename: strScenarioLabel });

	return Script.runInNewContext({ Operation: Operation, Arguments: vecArguments }, { timeout: g_unDocumentationTimeoutMilliseconds });
}

function RestoreMessageSmokeProperty(Target, strName, Descriptor) {
	if (Descriptor === undefined) {
		delete Target[strName];
		return;
	}

	Object.defineProperty(Target, strName, Descriptor);
}

function VerifyRawMessageHookDocumentationFailures(vecDocumentationBlocks) {
	const vecSpecifications = [
		{ Index: 4, Backend: "bitbuffer" },
		{ Index: 5, Backend: "protobuf" },
	];
	const vecPrimaryValues = [
		new Error("raw message primary failure"),
		undefined,
		null,
		0,
		"",
	];
	const vecCleanupModes = [
		{ Kind: "NONE" },
		{ Kind: "NATIVESTATUS" },
		...[
			new Error("raw message cleanup failure"),
			undefined,
			null,
			0,
			"",
		].map(Value => ({ Kind: "THROW", Value })),
	];
	let unCaseCount = 0;

	const RunCase = (Specification, strBackend, strFailureStage, PrimaryValue, CleanupMode, bInitiallyInstalled = false) => {
		const bActive = Specification.Backend === strBackend;
		const vecExpectedErrors = [];
		const HookStatus = { Backend: strBackend, BitBufferBeginInstalled: false, BitBufferEndInstalled: false, ProtobufSendInstalled: false };
		let bConstructed = false;
		let bPrimaryThrown = false;
		let unDisposalCount = 0;
		let HookInstance = null;

		const SetInstalled = bInstalled => {
			HookStatus.BitBufferBeginInstalled = (strBackend === "bitbuffer") && bInstalled;
			HookStatus.BitBufferEndInstalled = (strBackend === "bitbuffer") && bInstalled;
			HookStatus.ProtobufSendInstalled = (strBackend === "protobuf") && bInstalled;
		};

		const Step = strStage => {
			if (strFailureStage === strStage) {
				bPrimaryThrown = true;
				vecExpectedErrors.push({ Value: PrimaryValue });
				throw PrimaryValue;
			}
		};

		SetInstalled(bInitiallyInstalled);

		if (bInitiallyInstalled && bActive) {
			vecExpectedErrors.push({ Message: `The ${strBackend} sending example requires an otherwise hook-free plugin context.` });
		}

		class RawHook {
			constructor(nMessageIndex, Callback = null) {
				Step("CONSTRUCT");
				g_Assert.equal(nMessageIndex, 7);
				bConstructed = true;
				HookInstance = this;
				this.MessageIndex = nMessageIndex;
				this.MessageName = "TextMsg";
				this.RequiredBackend = strBackend;
				this.Callback = null;

				if (Callback !== null) {
					this.RegisterUserMessageHook(Callback);
				}
			}

			RegisterUserMessageHook(Callback) {
				Step("INSTALL");
				SetInstalled(true);
				Step("REGISTER");
				this.Callback = Callback;

				return Callback;
			}

			DisposeUserMessageHook() {
				++unDisposalCount;

				if (CleanupMode.Kind === "THROW") {
					vecExpectedErrors.push({ Value: CleanupMode.Value });
					throw CleanupMode.Value;
				}

				const bHadCallback = this.Callback !== null;
				this.Callback = null;

				if (CleanupMode.Kind !== "NATIVESTATUS") {
					SetInstalled(false);
				}

				return bHadCallback;
			}
		}

		const HookModule = { Backend: () => strBackend, HOOK_STATUS: HookStatus };
		HookModule[(strBackend === "bitbuffer") ? "BitBufferUserMessageHook" : "ProtobufUserMessageHook"] = RawHook;

		const Messages = {
			GetBaseMessageConstants() {
				return { HUDDestination: { Console: 2 } };
			},

			GetUserMessageIndex(strName) {
				g_Assert.equal(strName, "TextMsg");

				return 7;
			},

			SendUserMessage(strName, vecRecipients, vecOperations, bReliable) {
				Step("SEND");
				g_Assert.equal(strName, "TextMsg");
				g_Assert.deepEqual(Array.from(vecRecipients), [1]);
				g_Assert.equal(vecOperations.length, 6);
				g_Assert.equal(bReliable, true);

				const Recipients = {
					get RecipientIndexes() {
						Step("CALLBACK");

						return [1];
					},
				};

				if (strBackend === "bitbuffer") {
					const vecStrings = ["Original bitbuffer message", "", "", "", ""];
					const vecWrites = [];
					let unReadIndex = 0;

					const Reader = { ReadByte: () => 2, ReadString: () => vecStrings[unReadIndex++] };
					const Writer = { WriteByte: unValue => g_Assert.equal(unValue, 2), WriteString: strValue => vecWrites.push(strValue) };

					HookInstance.Callback(Recipients, Reader, Writer);
					g_Assert.deepEqual(vecWrites, ["[SourceJS] rewritten by the bitbuffer hook\n", "", "", "", ""]);

				} else {
					let strMessage = "Original protobuf message";
					const Buffer = {
						GetInt32(strName) {
							g_Assert.equal(strName, "msg_dst");

							return 2;
						},

						GetRepeatedString(strName, unIndex) {
							g_Assert.equal(strName, "params");
							g_Assert.equal(unIndex, 0);

							return strMessage;
						},

						SetRepeatedString(strName, unIndex, strValue) {
							g_Assert.equal(strName, "params");
							g_Assert.equal(unIndex, 0);
							strMessage = strValue;
						},
					};

					HookInstance.Callback(Recipients, Buffer);
					g_Assert.equal(strMessage, "[SourceJS] rewritten by the protobuf hook\n");
				}

				Step("AFTERSEND");

				return true;
			},
		};

		const Context = g_VM.createContext({
			Error,

			require(strModuleName) {
				if (strModuleName === "memory/hooks/messages") {
					return HookModule;
				}

				if (strModuleName === "messages") {
					return Messages;
				}

				g_Assert.equal(strModuleName, "players");

				return { GetAllPlayers: () => [{ Index: 1 }] };
			},
		});

		let bCaught = false;
		let CaughtValue = undefined;

		try {
			new g_VM.Script(vecDocumentationBlocks[Specification.Index], { filename: `raw-message-cleanup-${unCaseCount}.js` }).runInContext(Context);
		} catch (CaughtError) {
			bCaught = true;
			CaughtValue = CaughtError;
		}

		const bRetained = HookStatus.BitBufferBeginInstalled || HookStatus.BitBufferEndInstalled || HookStatus.ProtobufSendInstalled || ((HookInstance !== null) && (HookInstance.Callback !== null));
		if (bConstructed && bRetained) {
			vecExpectedErrors.push({ Message: `The ${strBackend} example did not finish releasing its hooks.` });
		}

		const unExpectedDisposals = bConstructed ? ((vecExpectedErrors.length === 0) ? 2 : 1) : 0;
		g_Assert.equal(unDisposalCount, unExpectedDisposals, "raw examples dispose after registration failure, without retrying failed cleanup");
		g_Assert.equal(bPrimaryThrown, strFailureStage !== "", "raw message fixture reaches its requested primary stage");
		g_Assert.equal(bCaught, vecExpectedErrors.length > 0, "raw message example failure state");

		const vecActualErrors = (vecExpectedErrors.length > 1) ? CaughtValue.errors : [CaughtValue];
		if (vecExpectedErrors.length > 1) {
			g_Assert.ok(Array.isArray(vecActualErrors), "raw examples preserve primary and cleanup failures");
			g_Assert.equal(vecActualErrors.length, vecExpectedErrors.length);
		}

		for (const [unIndex, Expected] of vecExpectedErrors.entries()) {
			if (Object.hasOwn(Expected, "Value")) {
				g_Assert.ok(Object.is(vecActualErrors[unIndex], Expected.Value), "raw examples preserve thrown value identity and order");

			} else {
				g_Assert.equal(vecActualErrors[unIndex].message, Expected.Message);
			}
		}

		if (bInitiallyInstalled) {
			g_Assert.equal(bConstructed, false);
			g_Assert.equal(bRetained, true, "raw examples leave pre-existing hook ownership untouched");
		}

		++unCaseCount;
	};

	for (const Specification of vecSpecifications) {
		for (const strBackend of ["bitbuffer", "protobuf"]) {
			const vecStages = (strBackend === Specification.Backend) ? ["", "CONSTRUCT", "INSTALL", "REGISTER", "SEND", "CALLBACK", "AFTERSEND"] : [""];
			for (const strStage of vecStages) {
				for (const PrimaryValue of vecPrimaryValues) {
					for (const CleanupMode of vecCleanupModes) {
						RunCase(Specification, strBackend, strStage, PrimaryValue, CleanupMode);
					}
				}
			}

			if (strBackend === Specification.Backend) {
				RunCase(Specification, strBackend, "", vecPrimaryValues[0], vecCleanupModes[0], true);
			}
		}
	}

	g_Assert.equal(unCaseCount, 562, "two raw-backend cleanup matrices and pre-existing ownership guards");
}

function VerifyDecodedMessageHookDocumentationFailures(vecDocumentationBlocks) {
	const vecSpecifications = [
		{ Index: 6, Stages: ["", "CONSTRUCT", "INSTALL", "REGISTER1", "SEND", "CALLBACK", "AFTERSEND"], StatusError: "The decoded example did not finish releasing its hooks." },
		{ Index: 9, Stages: ["", "CONSTRUCT", "INSTALL", "REGISTER1", "ENSURE1", "ENSURE2"], StatusError: "Reported hook status did not return to its starting values." },
		{ Index: 10, Stages: ["", "CONSTRUCT", "INSTALL", "REGISTER1"], StatusError: "HOOK_STATUS did not return to its starting values after callback disposal." },
		{ Index: 11, Stages: ["", "CONSTRUCT", "INSTALL", "REGISTER1", "DISPOSE"], OwnerError: "The disposal example did not restore its callback ownership.", StatusError: "The disposal example left its native hooks installed." },
		{ Index: 12, Stages: ["", "CONSTRUCT", "INSTALL", "REGISTER1", "REGISTER2"], OwnerError: "The replacement example did not restore its callback ownership.", StatusError: "The replacement example left its native hooks installed." },
	];
	const vecPrimaryValues = [
		new Error("decoded hook primary failure"),
		undefined,
		null,
		0,
		"",
	];
	const vecCleanupModes = [
		{ Kind: "NONE" },
		{ Kind: "NATIVESTATUS" },
		...[
			new Error("decoded hook cleanup failure"),
			undefined,
			null,
			0,
			"",
		].map(Value => ({ Kind: "THROW", Value })),
	];
	let unCaseCount = 0;

	const RunCase = (Specification, strBackend, strFailureStage, PrimaryValue, CleanupMode, bOtherOwner = false, bInitialGuard = false) => {
		const vecExpectedErrors = [];
		const HookStatus = { Backend: strBackend, BitBufferBeginInstalled: false, BitBufferEndInstalled: false, ProtobufSendInstalled: false };
		const mapCallbacks = new Map();
		const OtherCallback = () => undefined;
		let HookInstance = null;
		let bConstructed = false;
		let bPrimaryThrown = false;
		let unRegistrations = 0;
		let unDisposals = 0;
		let unEnsures = 0;

		const SetInstalled = bInstalled => {
			HookStatus.BitBufferBeginInstalled = (strBackend === "bitbuffer") && bInstalled;
			HookStatus.BitBufferEndInstalled = (strBackend === "bitbuffer") && bInstalled;
			HookStatus.ProtobufSendInstalled = (strBackend === "protobuf") && bInstalled;
		};

		const Step = strStage => {
			if (strFailureStage === strStage) {
				bPrimaryThrown = true;
				vecExpectedErrors.push({ Value: PrimaryValue });
				throw PrimaryValue;
			}
		};

		SetInstalled(bOtherOwner || bInitialGuard);

		if (bOtherOwner) {
			mapCallbacks.set(7, new Set([OtherCallback]));
		}

		if (bInitialGuard) {
			const strRole = new Map([[6, "decoded sending"], [7, "base metadata"], [9, "installation"], [10, "status"]]).get(Specification.Index);
			vecExpectedErrors.push({ Message: `The ${strRole} example requires an otherwise hook-free plugin context.` });
		}

		class Hook {
			constructor(nMessageIndex, Callback = null) {
				Step("CONSTRUCT");
				g_Assert.equal(nMessageIndex, 7);
				bConstructed = true;
				HookInstance = this;
				this.MessageIndex = nMessageIndex;
				this.MessageName = "TextMsg";
				this.RequiredBackend = null;
				this.Callback = null;

				if (Callback !== null) {
					this.RegisterUserMessageHook(Callback);
				}
			}

			get Store() {
				return mapCallbacks;
			}

			RegisterUserMessageHook(Callback) {
				++unRegistrations;

				if (unRegistrations === 1) {
					Step("INSTALL");
					SetInstalled(true);
				}

				Step("REGISTER" + unRegistrations);

				const setCallbacks = mapCallbacks.get(7) ?? new Set();
				if (this.Callback !== null) {
					setCallbacks.delete(this.Callback);
				}

				setCallbacks.add(Callback);
				mapCallbacks.set(7, setCallbacks);
				this.Callback = Callback;

				return Callback;
			}

			DisposeUserMessageHook() {
				++unDisposals;

				if ((Specification.Index === 11) && !bPrimaryThrown) {
					Step("DISPOSE");
				}

				if (CleanupMode.Kind === "THROW") {
					vecExpectedErrors.push({ Value: CleanupMode.Value });
					throw CleanupMode.Value;
				}

				const bHadCallback = this.Callback !== null;
				const setCallbacks = mapCallbacks.get(7);
				if (bHadCallback) {
					g_Assert.ok(setCallbacks.delete(this.Callback));
					this.Callback = null;

					if (setCallbacks.size === 0) {
						mapCallbacks.delete(7);
					}
				}

				if ((mapCallbacks.size === 0) && (CleanupMode.Kind !== "NATIVESTATUS")) {
					SetInstalled(false);
				}

				return bHadCallback;
			}
		}

		const HookModule = {
			HOOK_STATUS: HookStatus,
			UserMessageHook: Hook,
			Backend: () => strBackend,

			EnsureNativeHooks() {
				++unEnsures;
				Step("ENSURE" + unEnsures);
				SetInstalled(true);
			},
		};

		const Messages = {
			GetUserMessageIndex: () => 7,
			GetBaseMessageConstants: () => ({ HUDDestination: { Console: 2 } }),

			SendUserMessage(strName, vecRecipients, vecFields, bReliable) {
				Step("SEND");
				g_Assert.equal(strName, "TextMsg");
				g_Assert.deepEqual(Array.from(vecRecipients), [1]);
				g_Assert.equal(vecFields.length, 6);
				g_Assert.equal(bReliable, true);

				const Recipients = {
					get RecipientIndexes() {
						Step("CALLBACK");

						return [1];
					},
				};

				const Data = {
					Message: "Original decoded message",

					HasUserMessageChanged() {
						return this.Message !== "Original decoded message";
					},
				};

				HookInstance.Callback(Recipients, Data);
				g_Assert.equal(Data.Message, "[SourceJS] rewritten by the decoded hook\n");
				Step("AFTERSEND");

				return true;
			},
		};

		const Context = g_VM.createContext({
			Error,
			TypeError,

			require(strModuleName) {
				if (strModuleName === "memory/hooks/messages") {
					return HookModule;
				}

				if (strModuleName === "messages") {
					return Messages;
				}

				g_Assert.equal(strModuleName, "players");

				return { GetAllPlayers: () => [{ Index: 1 }] };
			},
		});

		let bCaught = false;
		let CaughtValue = undefined;

		try {
			new g_VM.Script(vecDocumentationBlocks[Specification.Index], { filename: `decoded-message-cleanup-${unCaseCount}.js` }).runInContext(Context);
		} catch (CaughtError) {
			bCaught = true;
			CaughtValue = CaughtError;
		}

		const bNativeRetained = HookStatus.BitBufferBeginInstalled || HookStatus.BitBufferEndInstalled || HookStatus.ProtobufSendInstalled;
		if (bConstructed) {
			const bOwnCallbackRetained = HookInstance.Callback !== null;
			if (Specification.OwnerError && bOwnCallbackRetained) {
				vecExpectedErrors.push({ Message: Specification.OwnerError });

			} else if ((!Specification.OwnerError && bOwnCallbackRetained) || (!bOtherOwner && bNativeRetained)) {
				vecExpectedErrors.push({ Message: Specification.StatusError });
			}
		}

		const unExpectedDisposals = bConstructed ? (((Specification.Index === 11) && !bOtherOwner && (vecExpectedErrors.length === 0)) ? 2 : 1) : 0;
		g_Assert.equal(unDisposals, unExpectedDisposals, "decoded examples attempt cleanup without retrying a failed disposal");
		g_Assert.equal(bPrimaryThrown, strFailureStage !== "", "decoded fixture reaches its requested primary stage");
		g_Assert.equal(bCaught, vecExpectedErrors.length > 0, "decoded example failure state");

		const vecActualErrors = (vecExpectedErrors.length > 1) ? CaughtValue.errors : [CaughtValue];
		if (vecExpectedErrors.length > 1) {
			g_Assert.ok(Array.isArray(vecActualErrors), "decoded examples preserve primary and cleanup failures");
			g_Assert.equal(vecActualErrors.length, vecExpectedErrors.length);
		}

		for (const [unIndex, Expected] of vecExpectedErrors.entries()) {
			if (Object.hasOwn(Expected, "Value")) {
				g_Assert.ok(Object.is(vecActualErrors[unIndex], Expected.Value), "decoded examples preserve thrown value identity and order");

			} else {
				g_Assert.equal(vecActualErrors[unIndex].message, Expected.Message);
			}
		}

		if (bOtherOwner) {
			g_Assert.ok(mapCallbacks.get(7).has(OtherCallback), "other owners survive every example exit");
			g_Assert.equal(bNativeRetained, true);
		}

		if (bInitialGuard) {
			g_Assert.equal(bConstructed, false);
			g_Assert.equal(bNativeRetained, true, "ownership guard does not release a pre-existing installation");
		}

		++unCaseCount;
	};

	for (const Specification of vecSpecifications) {
		for (const strBackend of ["bitbuffer", "protobuf"]) {
			for (const bOtherOwner of Specification.OwnerError ? [false, true] : [false]) {
				for (const strStage of Specification.Stages) {
					for (const PrimaryValue of vecPrimaryValues) {
						for (const CleanupMode of vecCleanupModes) {
							RunCase(Specification, strBackend, strStage, PrimaryValue, CleanupMode, bOtherOwner);
						}
					}
				}
			}
		}
	}

	for (const unIndex of [6, 7, 9, 10]) {
		for (const strBackend of ["bitbuffer", "protobuf"]) {
			RunCase({ Index: unIndex }, strBackend, "", vecPrimaryValues[0], vecCleanupModes[0], false, true);
		}
	}

	g_Assert.equal(unCaseCount, 2598, "decoded/installation/status/disposal/replacement matrices and ownership guards");
}

function VerifyMessageHookDocumentation(MessageHooksModule, vecVTableHookRecords) {
	const strDocumentationText = g_FileSystem.readFileSync(g_strMessageHooksDocumentationPath, "utf8");
	const vecDocumentationBlocks = [];
	for (const vecCodeBlockMatch of strDocumentationText.matchAll(/```js\r?\n([\s\S]*?)\r?\n```/g)) {
		vecDocumentationBlocks.push(vecCodeBlockMatch[1]);
	}

	g_Assert.doesNotMatch(strDocumentationText, /This page was generated/, "message-hook documentation is hand-maintained");
	g_Assert.doesNotMatch(strDocumentationText, /\bhookStatus\b/, "message-hook documentation has no lower-camel singleton alias");
	g_Assert.doesNotMatch(strDocumentationText, /\bconsole(?:\.|\[)/, "message-hook documentation has no console-only examples");
	g_Assert.equal(vecDocumentationBlocks.length, 13, "message-hook documentation JavaScript block count");
	VerifyRawMessageHookDocumentationFailures(vecDocumentationBlocks);
	VerifyDecodedMessageHookDocumentationFailures(vecDocumentationBlocks);

	for (const [unIndex, strDocumentationSource] of vecDocumentationBlocks.entries()) {
		new g_VM.Script("\"use strict\";\n" + strDocumentationSource, { filename: `${g_strMessageHooksDocumentationPath}:block-${unIndex + 1}` });
	}

	for (const vecLinkMatch of strDocumentationText.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
		const strLinkTarget = vecLinkMatch[1].split("#", 1)[0];
		if ((strLinkTarget.length > 0) && !/^[a-z]+:/i.test(strLinkTarget)) {
			const strResolvedLinkPath = g_Path.resolve(g_Path.dirname(g_strMessageHooksDocumentationPath), strLinkTarget);
			g_Assert.equal(g_FileSystem.existsSync(strResolvedLinkPath), true, `message-hook documentation link: ${strLinkTarget}`);
		}
	}

	function ExecuteBackendExamples(BackendMessageHooksModule, strSelectedBackend) {
		const bBitBufferBackend = strSelectedBackend === "bitbuffer";
		const strRawHookClassName = bBitBufferBackend ? "BitBufferUserMessageHook" : "ProtobufUserMessageHook";
		const strUnavailableHookClassName = bBitBufferBackend ? "ProtobufUserMessageHook" : "BitBufferUserMessageHook";
		const unFirstDispatchIndex = g_vecMessageDispatches.length;
		const strBackendDocumentationLabel = `message-hook documentation ${strSelectedBackend}`;

		g_Assert.equal(BackendMessageHooksModule.Backend(), strSelectedBackend, `${strBackendDocumentationLabel} backend`);
		g_Assert.equal(typeof BackendMessageHooksModule[strRawHookClassName], "function", `${strBackendDocumentationLabel} raw class`);

		const bUnavailableHookClassExposed = Object.hasOwn(BackendMessageHooksModule, strUnavailableHookClassName);
		g_Assert.equal(bUnavailableHookClassExposed, false, `${strBackendDocumentationLabel} omitted class`);

		for (const [unIndex, strDocumentationSource] of vecDocumentationBlocks.entries()) {
			const unFirstVTableHookIndex = vecVTableHookRecords.length;
			const strDocumentationBlockLabel = `${strBackendDocumentationLabel} block ${unIndex + 1}`;

			const DocumentationRequire = (strModuleName) => {
				switch (strModuleName) {
					case "memory/hooks/messages":
						return BackendMessageHooksModule;

					case "messages":
						return g_Messages;

					case "players":
						return {
							GetAllPlayers() {
								return [{ Index: 1 }];
							},
						};

					default:
						throw new Error(`Unexpected message-hook documentation dependency: ${strModuleName}`);
				}
			};

			let strDocumentationTestSource = strDocumentationSource;
			if (unIndex === (vecDocumentationBlocks.length - 1)) {
				// Registration alone cannot detect a callback that mistakes Recipients for Data.
				strDocumentationTestSource += `
					const g_CallbackRecipients = { RecipientIndexes: [1] };
					const g_CallbackData = { Message: "Original" };
					RewriteConnectionMessage(g_CallbackRecipients, g_CallbackData);

					if ((g_CallbackData.Message !== "Player connected") || Object.hasOwn(g_CallbackRecipients, "Message")) {
						throw new Error("The connection callback did not use the decoded-data argument.");
					}

					RewriteDisconnectionMessage(g_CallbackRecipients, g_CallbackData);

					if ((g_CallbackData.Message !== "Player disconnected") || Object.hasOwn(g_CallbackRecipients, "Message")) {
						throw new Error("The disconnection callback did not use the decoded-data argument.");
					}
				`;
			}

			function ObserveExistingMessage() {
			}

			const ExecuteDocumentationBlock = g_VM.compileFunction("\"use strict\";\n" + strDocumentationTestSource, ["require"], { filename: strDocumentationBlockLabel });
			const ExistingHook = ((unIndex === (vecDocumentationBlocks.length - 2)) || (unIndex === (vecDocumentationBlocks.length - 1))) ? new BackendMessageHooksModule.UserMessageHook("TextMsg", ObserveExistingMessage) : null;

			try {
				g_Assert.doesNotThrow(() => RunMessageDocumentationOperation(ExecuteDocumentationBlock, [DocumentationRequire], strDocumentationBlockLabel), strDocumentationBlockLabel);

				if (ExistingHook !== null) {
					const setRemainingCallbacks = ExistingHook.Store.get(ExistingHook.MessageIndex);
					g_Assert.equal(ExistingHook.Callback, ObserveExistingMessage, "documentation does not replace another hook's callback");
					g_Assert.ok(setRemainingCallbacks.has(ObserveExistingMessage), "documentation does not remove another hook's callback");
				}
			} finally {
				if (ExistingHook !== null) {
					g_Assert.equal(ExistingHook.DisposeUserMessageHook(), true, "unrelated registration cleanup");
				}
			}

			const HookInstallationStatus = BackendMessageHooksModule.HOOK_STATUS;
			g_Assert.equal(HookInstallationStatus.BitBufferBeginInstalled, false, `${strDocumentationBlockLabel} begin-hook cleanup`);
			g_Assert.equal(HookInstallationStatus.BitBufferEndInstalled, false, `${strDocumentationBlockLabel} end-hook cleanup`);
			g_Assert.equal(HookInstallationStatus.ProtobufSendInstalled, false, `${strDocumentationBlockLabel} protobuf-hook cleanup`);

			const DecodedHookProbe = new BackendMessageHooksModule.UserMessageHook("TextMsg");
			const RawHookProbe = new BackendMessageHooksModule[strRawHookClassName]("TextMsg");
			g_Assert.equal(DecodedHookProbe.Store.size, 0, `${strDocumentationBlockLabel} decoded callback cleanup`);
			g_Assert.equal(RawHookProbe.Store.size, 0, `${strDocumentationBlockLabel} raw callback cleanup`);

			for (let unVTableHookIndex = unFirstVTableHookIndex; unVTableHookIndex < vecVTableHookRecords.length; unVTableHookIndex += 1) {
				const VTableHookRecord = vecVTableHookRecords[unVTableHookIndex];
				g_Assert.equal(VTableHookRecord.Removed, true, `${strDocumentationBlockLabel} native-hook cleanup`);
			}
		}

		const vecBackendMessageDispatches = g_vecMessageDispatches.slice(unFirstDispatchIndex);
		const vecDispatchedBackends = [];
		const vecDispatchedMessages = [];
		const vecExpectedDispatchedMessages = bBitBufferBackend ? ["[SourceJS] rewritten by the bitbuffer hook\n", "[SourceJS] rewritten by the decoded hook\n"] : ["[SourceJS] rewritten by the protobuf hook\n", "[SourceJS] rewritten by the decoded hook\n"];
		for (const MessageDispatch of vecBackendMessageDispatches) {
			vecDispatchedBackends.push(MessageDispatch.Backend);
			vecDispatchedMessages.push(MessageDispatch.Message);
		}

		g_Assert.deepEqual(vecDispatchedBackends, [strSelectedBackend, strSelectedBackend], `${strBackendDocumentationLabel} native dispatch backends`);
		g_Assert.deepEqual(vecDispatchedMessages, vecExpectedDispatchedMessages, `${strBackendDocumentationLabel} native mutations`);
	}

	const strResolvedMessageHooksPath = require.resolve(g_strMessageHooksPath);
	const OriginalMessageHooksCacheDescriptor = Object.getOwnPropertyDescriptor(require.cache, strResolvedMessageHooksPath);
	const strOriginalMessageBackend = g_strActiveMessageBackend;

	try {
		g_strActiveMessageBackend = "bitbuffer";
		ExecuteBackendExamples(MessageHooksModule, "bitbuffer");

		delete require.cache[strResolvedMessageHooksPath];
		g_strActiveMessageBackend = "protobuf";

		const ProtobufMessageHooksModule = require(g_strMessageHooksPath);
		ExecuteBackendExamples(ProtobufMessageHooksModule, "protobuf");
	} finally {
		g_strActiveMessageBackend = strOriginalMessageBackend;
		RestoreMessageSmokeProperty(require.cache, strResolvedMessageHooksPath, OriginalMessageHooksCacheDescriptor);
	}
}

function VerifyRuntimeRequirement() {
	const strRuntimeRequirementScript = `
		const g_strMessagesPath = ${JSON.stringify(g_strMessagesPath)};
		const g_strImplementationPath = ${JSON.stringify(g_strMessagesImplementationPath)};

		delete globalThis.sourcejs;

		for (const strModulePath of [g_strMessagesPath, g_strImplementationPath]) {
			let bRuntimeErrorThrown = false;

			try {
				require(strModulePath);
			} catch (ErrorValue) {
				if (!(ErrorValue instanceof Error) || !ErrorValue.message.includes("SourceJS")) {
					throw ErrorValue;
				}

				bRuntimeErrorThrown = true;
			}

			if (!bRuntimeErrorThrown) {
				throw new Error(strModulePath + " must require the SourceJS runtime");
			}
		}
	`;

	g_ChildProcess.execFileSync(process.execPath, ["-e", strRuntimeRequirementScript], { cwd: g_strRepositoryRootPath, stdio: "inherit", timeout: g_unChildProcessTimeoutMilliseconds });
}

function CollectRecipientIndices(TargetReferences) {
	const vecRecipientIndices = [];

	function VisitRecipientValue(RecipientValue) {
		if (Array.isArray(RecipientValue)) {
			for (const NestedRecipientValue of RecipientValue) {
				VisitRecipientValue(NestedRecipientValue);
			}

			return;
		}

		if (Number.isSafeInteger(RecipientValue) && (RecipientValue > 0)) {
			if (!vecRecipientIndices.includes(RecipientValue)) {
				vecRecipientIndices.push(RecipientValue);
			}

			return;
		}

		if (RecipientValue && (typeof RecipientValue === "object") && Number.isSafeInteger(RecipientValue.Index) && (RecipientValue.Index > 0)) {
			VisitRecipientValue(RecipientValue.Index);
			return;
		}

		throw new TypeError("Invalid recipient value.");
	}

	VisitRecipientValue(TargetReferences);

	return vecRecipientIndices;
}

function ValidateUserMessageFields(strMessageBackend, vecFieldEntries) {
	const bMessageBackendSupported = (strMessageBackend === "bitbuffer") || (strMessageBackend === "protobuf");
	g_Assert.equal(bMessageBackendSupported, true, "User-message supported backend");
	g_Assert.ok(Array.isArray(vecFieldEntries), "User-message fields array");

	for (const FieldEntry of vecFieldEntries) {
		g_Assert.ok((FieldEntry !== null) && (typeof FieldEntry === "object"), "User-message field descriptor object");
		g_Assert.equal(Object.getPrototypeOf(FieldEntry), Object.prototype, "User-message plain field descriptor");

		const strFieldType = FieldEntry.Type;
		const strFieldKind = FieldEntry.Kind;
		const strFieldName = FieldEntry.Name;
		const vecNestedFields = FieldEntry.Fields;
		if (strMessageBackend === "bitbuffer") {
			g_Assert.equal(g_vecBitbufferFieldTypes.includes(strFieldType), true, `User-message bitbuffer type ${strFieldType}`);
			continue;
		}

		g_Assert.equal(g_vecProtobufFieldKinds.includes(strFieldKind), true, `User-message protobuf kind ${strFieldKind}`);
		g_Assert.equal(typeof strFieldName, "string", "User-message protobuf field name");
		g_Assert.ok(strFieldName.length > 0, "User-message protobuf non-empty field name");

		if ((strFieldKind === "MESSAGE") || (strFieldKind === "ADDMESSAGE")) {
			ValidateUserMessageFields(strMessageBackend, vecNestedFields);
			continue;
		}

		g_Assert.equal(g_vecProtobufFieldTypes.includes(strFieldType), true, `User-message protobuf type ${strFieldType}`);

		if (strFieldType === "int64") {
			g_Assert.equal(typeof FieldEntry.Value, "bigint", "User-message protobuf int64 value");
			g_Assert.ok((FieldEntry.Value >= g_nMinimumInt64Value) && (FieldEntry.Value <= g_nMaximumInt64Value), "User-message protobuf int64 range");

		} else if (strFieldType === "uint64") {
			g_Assert.equal(typeof FieldEntry.Value, "bigint", "User-message protobuf uint64 value");
			g_Assert.ok((FieldEntry.Value >= 0n) && (FieldEntry.Value <= g_unMaximumUInt64Value), "User-message protobuf uint64 range");
		}
	}
}

class ProtobufBuffer {
	constructor() {
		this.m_vecMessageChildren = [];
		this.m_mapFieldValues = new Map();
	}

	Clear() {
		this.m_vecMessageChildren.length = 0;
		this.m_mapFieldValues.clear();
	}

	AddMessage(strFieldName) {
		const ChildMessageBuffer = new ProtobufBuffer();
		this.m_vecMessageChildren.push({ FieldName: strFieldName, MessageBuffer: ChildMessageBuffer });

		return ChildMessageBuffer;
	}

	AddString(strFieldName, strStringValue) {
		g_Assert.equal(typeof strStringValue, "string", "ProtobufBuffer.AddString value type");

		let vecRepeatedStringValues = this.m_mapFieldValues.get(strFieldName);
		if (vecRepeatedStringValues === undefined) {
			vecRepeatedStringValues = [];

		} else {
			g_Assert.ok(Array.isArray(vecRepeatedStringValues), "ProtobufBuffer.AddString repeated field");
		}

		vecRepeatedStringValues.push(strStringValue);
		this.m_mapFieldValues.set(strFieldName, vecRepeatedStringValues);
	}

	GetBool(strFieldName) {
		return this.m_mapFieldValues.get(strFieldName);
	}

	GetFieldCount(strFieldName) {
		const FieldValue = this.m_mapFieldValues.get(strFieldName);
		if (Array.isArray(FieldValue)) {
			return FieldValue.length;
		}

		let unChildMessageCount = 0;
		for (const ChildMessageRecord of this.m_vecMessageChildren) {
			if (ChildMessageRecord.FieldName === strFieldName) {
				unChildMessageCount += 1;
			}
		}

		return unChildMessageCount;
	}

	GetFloat(strFieldName) {
		return this.m_mapFieldValues.get(strFieldName);
	}

	GetInt32(strFieldName, nDefaultValue = 0) {
		return this.m_mapFieldValues.has(strFieldName) ? this.m_mapFieldValues.get(strFieldName) : nDefaultValue;
	}

	GetMutableRepeatedMessage(strFieldName, unRepeatedIndex) {
		g_Assert.ok(Number.isSafeInteger(unRepeatedIndex) && (unRepeatedIndex >= 0), "ProtobufBuffer.GetMutableRepeatedMessage index");

		let unMatchingMessageIndex = 0;
		for (const ChildMessageRecord of this.m_vecMessageChildren) {
			if (ChildMessageRecord.FieldName !== strFieldName) {
				continue;
			}

			if (unMatchingMessageIndex === unRepeatedIndex) {
				return ChildMessageRecord.MessageBuffer;
			}

			unMatchingMessageIndex += 1;
		}

		return undefined;
	}

	GetRepeatedString(strFieldName, unRepeatedIndex) {
		const vecRepeatedStringValues = this.m_mapFieldValues.get(strFieldName);
		if (!Number.isSafeInteger(unRepeatedIndex) || (unRepeatedIndex < 0) || !Array.isArray(vecRepeatedStringValues) || (unRepeatedIndex >= vecRepeatedStringValues.length)) {
			throw new RangeError("Repeated protobuf field index is out of range.");
		}

		return vecRepeatedStringValues[unRepeatedIndex];
	}

	GetString(strFieldName) {
		return this.m_mapFieldValues.get(strFieldName);
	}

	GetMutableMessage(strFieldName) {
		for (const ChildMessageRecord of this.m_vecMessageChildren) {
			if (ChildMessageRecord.FieldName === strFieldName) {
				return ChildMessageRecord.MessageBuffer;
			}
		}

		const ChildMessageBuffer = new ProtobufBuffer();
		this.m_vecMessageChildren.push({ FieldName: strFieldName, MessageBuffer: ChildMessageBuffer });

		return ChildMessageBuffer;
	}

	SetBool(strFieldName, bBooleanValue) {
		g_Assert.equal(typeof bBooleanValue, "boolean", "ProtobufBuffer.SetBool value type");
		this.m_mapFieldValues.set(strFieldName, bBooleanValue);
	}

	SetFloat(strFieldName, flFloatValue) {
		g_Assert.equal(typeof flFloatValue, "number", "ProtobufBuffer.SetFloat value type");
		this.m_mapFieldValues.set(strFieldName, flFloatValue);
	}

	SetInt32(strFieldName, nIntegerValue) {
		const nMinimumInt32Value = -0x80000000;
		const nMaximumInt32Value = 0x7FFFFFFF;

		g_Assert.ok(Number.isSafeInteger(nIntegerValue), "ProtobufBuffer.SetInt32 requires a safe integer");
		g_Assert.ok((nIntegerValue >= nMinimumInt32Value) && (nIntegerValue <= nMaximumInt32Value), "ProtobufBuffer.SetInt32 requires a signed 32-bit integer");
		this.m_mapFieldValues.set(strFieldName, nIntegerValue);
	}

	SetRepeatedString(strFieldName, unRepeatedIndex, strStringValue) {
		g_Assert.ok(Number.isSafeInteger(unRepeatedIndex) && (unRepeatedIndex >= 0), "ProtobufBuffer.SetRepeatedString index");
		g_Assert.equal(typeof strStringValue, "string", "ProtobufBuffer.SetRepeatedString value type");

		const vecRepeatedStringValues = this.m_mapFieldValues.get(strFieldName);
		const bRepeatedStringExists = Array.isArray(vecRepeatedStringValues) && (unRepeatedIndex < vecRepeatedStringValues.length);
		g_Assert.ok(bRepeatedStringExists, "ProtobufBuffer.SetRepeatedString existing field");
		vecRepeatedStringValues[unRepeatedIndex] = strStringValue;
	}

	SetString(strFieldName, strStringValue) {
		g_Assert.equal(typeof strStringValue, "string", "ProtobufBuffer.SetString value type");
		this.m_mapFieldValues.set(strFieldName, strStringValue);
	}
}

function VerifyNativeProtobufContracts() {
	const strBindingsPath = g_Path.join(g_strRepositoryRootPath, "src", "sourcejs", "modules", "ModuleBindings.cpp");
	const strBindingsSource = g_FileSystem.readFileSync(strBindingsPath, "utf8");
	const vecMethodTableMatch = /MakeMessagesProtobufMessageObject\([^\n]*\{\s*constexpr char const\* kProtobufMethodNames\[\] = \{([\s\S]*?)\};/.exec(strBindingsSource);
	g_Assert.notEqual(vecMethodTableMatch, null, "native protobuf method table exists");

	const setNativeMethodNames = new Set([...vecMethodTableMatch[1].matchAll(/"([^"]+)"/g)].map((vecMethodMatch) => vecMethodMatch[1]));
	for (const strMethodName of Object.getOwnPropertyNames(ProtobufBuffer.prototype)) {
		if (strMethodName === "constructor") {
			continue;
		}

		g_Assert.ok(setNativeMethodNames.has(strMethodName), `protobuf fixture method is a real native export: ${strMethodName}`);
	}

	const strImplementationSource = g_FileSystem.readFileSync(g_strMessagesImplementationPath, "utf8");
	for (const vecMethodCallMatch of strImplementationSource.matchAll(/CallBufferMethod\((?:Buffer|ProtobufBuffer|ColorBuffer|PositionBuffer|SubkeyBuffer), "([^"]+)"/g)) {
		g_Assert.ok(setNativeMethodNames.has(vecMethodCallMatch[1]), `protobuf serializer method is a real native export: ${vecMethodCallMatch[1]}`);
	}

	const RangeProbe = new ProtobufBuffer();
	g_Assert.throws(() => RangeProbe.GetRepeatedString("params", 0), RangeError, "native repeated getters reject missing indexes");
	RangeProbe.AddString("params", "One");
	g_Assert.equal(RangeProbe.GetRepeatedString("params", 0), "One");
	g_Assert.throws(() => RangeProbe.GetRepeatedString("params", 1), RangeError, "native repeated getters reject the end index");

	for (const [strMessageName] of g_mapMessageIndices) {
		const Implementation = g_MessagesImplementation.GetUserMessageImplementation(strMessageName);
		const Data = Implementation.ReadUserMessageFromProtobuf(new ProtobufBuffer());
		const OutputBuffer = new ProtobufBuffer();
		Implementation.WriteUserMessageToProtobuf(OutputBuffer, Data);

		const RoundTripData = Implementation.ReadUserMessageFromProtobuf(OutputBuffer);
		g_Assert.deepEqual({ ...RoundTripData }, { ...Data }, `native-only protobuf methods round-trip ${strMessageName}`);
		g_Assert.equal(RoundTripData.HasUserMessageChanged(), false, "decoding does not mark fields changed");
	}
}

VerifyRuntimeRequirement();

const g_unBitBufferCapacityByteCount = 0x800;
const g_unUnsignedIntegerBitCount = 32;
const g_unEngineServerAddress = 0x64n;

const g_vecNativeCalls = [];
let g_strActiveMessageBackend = "bitbuffer";
let g_bNativeHooksDisabled = false;
const g_mapBitBufferStates = new Map();
const g_vecMessageDispatches = [];
const g_vecNativeVTableHooks = [];
const g_mapProtobufMessageStates = new Map();
const g_mapRecipientFilterStates = new Map([
	[0xC8n, {
		Indices: [1, 2],
		InitializationMessage: false,
		Reliable: true,
	}],
]);

let g_unNextBitBufferAddress = 0x1388n;
let g_unNextProtobufAddress = 0x1770n;
let g_unNextRecipientFilterAddress = 0x1B58n;

const g_mapMessageIndices = new Map([
	["SayText", 1],
	["SayText2", 2],
	["HintText", 3],
	["Shake", 4],
	["ResetHud", 5],
	["TextMsg", 6],
	["KeyHintText", 7],
	["Fade", 8],
	["HudMsg", 9],
	["ShowMenu", 10],
	["VGUIMenu", 11],
]);
const g_mapMessageSizes = new Map([
	[1, -1],
	[2, -1],
	[3, -1],
	[4, 13],
	[5, 1],
	[6, -1],
	[7, -1],
	[8, 10],
	[9, -1],
	[10, -1],
	[11, -1],
]);

// HookKind is fixture-only enum metadata, not a native hook-option field.
function GetActiveVTableHookRecords(strHookKind) {
	const vecActiveVTableHooks = [];
	for (const VTableHookRecord of g_vecNativeVTableHooks) {
		if (VTableHookRecord.Removed || (VTableHookRecord.Options.HookKind !== strHookKind)) {
			continue;
		}

		vecActiveVTableHooks.push(VTableHookRecord);
	}

	return vecActiveVTableHooks;
}

function WriteBitBufferFields(vecBitBufferFields) {
	const BitBufferWriter = new g_Bitbuffers.BitBufferWrite(g_unBitBufferCapacityByteCount);
	for (const BitBufferField of vecBitBufferFields) {
		const strFieldType = BitBufferField.Type;
		switch (strFieldType) {
			case "bits":
				BitBufferWriter.WriteUBitLong(BitBufferField.Value, BitBufferField.Bits);
				break;

			case "bool":
				BitBufferWriter.WriteOneBit(BitBufferField.Value ? 1 : 0);
				break;

			case "byte":
				BitBufferWriter.WriteByte(BitBufferField.Value);
				break;

			case "float":
				BitBufferWriter.WriteFloat(BitBufferField.Value);
				break;

			case "int":
				BitBufferWriter.WriteLong(BitBufferField.Value);
				break;

			case "short":
				BitBufferWriter.WriteShort(BitBufferField.Value);
				break;

			case "string":
				BitBufferWriter.WriteString(BitBufferField.Value);
				break;

			case "uint":
				BitBufferWriter.WriteUBitLong(BitBufferField.Value, g_unUnsignedIntegerBitCount);
				break;

			default:
				throw new TypeError(`Unsupported bitbuffer documentation field: ${strFieldType}`);
		}
	}

	return BitBufferWriter;
}

function WriteProtobufFields(vecProtobufFields) {
	const ProtobufMessageBuffer = new ProtobufBuffer();
	for (const ProtobufField of vecProtobufFields) {
		const strFieldKind = ProtobufField.Kind;
		const strFieldType = ProtobufField.Type;
		if ((strFieldKind === "ADD") && (strFieldType === "string")) {
			ProtobufMessageBuffer.AddString(ProtobufField.Name, ProtobufField.Value);
			continue;
		}

		if (strFieldKind !== "SET") {
			throw new TypeError(`Unsupported protobuf documentation field kind: ${strFieldKind}`);
		}

		switch (strFieldType) {
			case "bool":
				ProtobufMessageBuffer.SetBool(ProtobufField.Name, ProtobufField.Value);
				break;

			case "float":
				ProtobufMessageBuffer.SetFloat(ProtobufField.Name, ProtobufField.Value);
				break;

			case "int32":
				ProtobufMessageBuffer.SetInt32(ProtobufField.Name, ProtobufField.Value);
				break;

			case "string":
				ProtobufMessageBuffer.SetString(ProtobufField.Name, ProtobufField.Value);
				break;

			default:
				throw new TypeError(`Unsupported protobuf documentation field type: ${strFieldType}`);
		}
	}

	return ProtobufMessageBuffer;
}

function DispatchNativeUserMessage(strMessageName, vecRecipientIndices, vecMessageFields) {
	const nMessageIndex = g_mapMessageIndices.get(strMessageName);
	const unRecipientFilterAddress = g_unNextRecipientFilterAddress;
	const vecOwnedRecipientIndices = [];
	for (const unRecipientIndex of vecRecipientIndices) {
		vecOwnedRecipientIndices.push(unRecipientIndex);
	}

	g_unNextRecipientFilterAddress += 0x1n;
	g_mapRecipientFilterStates.set(unRecipientFilterAddress, {
		Indices: vecOwnedRecipientIndices,
		InitializationMessage: false,
		Reliable: true,
	});

	try {
		if (g_strActiveMessageBackend === "bitbuffer") {
			const vecBitBufferBeginHookRecords = GetActiveVTableHookRecords("BITBUFFERBEGIN");
			const vecBitBufferEndHookRecords = GetActiveVTableHookRecords("BITBUFFEREND");

			if ((vecBitBufferBeginHookRecords.length === 0) && (vecBitBufferEndHookRecords.length === 0)) {
				return;
			}

			g_Assert.ok(nMessageIndex !== undefined, "native bitbuffer dispatch message index");
			g_Assert.ok((vecBitBufferBeginHookRecords.length > 0) && (vecBitBufferEndHookRecords.length > 0), "native bitbuffer hook pair");

			const BitBufferWriter = WriteBitBufferFields(vecMessageFields);
			const unBitBufferAddress = g_unNextBitBufferAddress;

			g_unNextBitBufferAddress += 0x1n;
			g_mapBitBufferStates.set(unBitBufferAddress, {
				Bytes: new Uint8Array(BitBufferWriter.Bytes),
				CurrentBit: BitBufferWriter.CurrentBit,
				DataBitCount: BitBufferWriter.DataBitCount,
				Overflowed: BitBufferWriter.Overflowed,
			});

			try {
				for (const BitBufferBeginHookRecord of vecBitBufferBeginHookRecords) {
					const vecBitBufferBeginPreHookCallbacks = [...BitBufferBeginHookRecord.PreCallbacks];
					for (const PreHookCallback of vecBitBufferBeginPreHookCallbacks) {
						PreHookCallback({ Arguments: [g_unEngineServerAddress, unRecipientFilterAddress, nMessageIndex] });
					}

					const vecBitBufferBeginPostHookCallbacks = [...BitBufferBeginHookRecord.PostCallbacks];
					for (const PostHookCallback of vecBitBufferBeginPostHookCallbacks) {
						PostHookCallback({ Arguments: [g_unEngineServerAddress, unRecipientFilterAddress, nMessageIndex], ReturnValue: unBitBufferAddress });
					}
				}

				for (const BitBufferEndHookRecord of vecBitBufferEndHookRecords) {
					const vecBitBufferEndPreHookCallbacks = [...BitBufferEndHookRecord.PreCallbacks];
					for (const PreHookCallback of vecBitBufferEndPreHookCallbacks) {
						PreHookCallback({ Arguments: [g_unEngineServerAddress] });
					}
				}

				const BitBufferState = g_mapBitBufferStates.get(unBitBufferAddress);
				const BitBufferReader = new g_Bitbuffers.BitBufferRead({ Bytes: BitBufferState.Bytes, DataBitCount: BitBufferState.DataBitCount });
				const DecodedMessageData = g_MessagesImplementation.TextMessageUserMessageImplementation.ReadUserMessageFromBitBuffer(BitBufferReader);
				g_vecMessageDispatches.push({ Backend: "bitbuffer", Message: DecodedMessageData.Message });
			} finally {
				g_mapBitBufferStates.delete(unBitBufferAddress);
			}

			return;
		}

		const vecProtobufSendHookRecords = GetActiveVTableHookRecords("PROTOBUFSEND");
		if (vecProtobufSendHookRecords.length === 0) {
			return;
		}

		g_Assert.ok(nMessageIndex !== undefined, "native protobuf dispatch message index");

		const ProtobufMessageBuffer = WriteProtobufFields(vecMessageFields);
		const unProtobufAddress = g_unNextProtobufAddress;

		g_unNextProtobufAddress += 0x1n;
		g_mapProtobufMessageStates.set(unProtobufAddress, ProtobufMessageBuffer);

		try {
			for (const ProtobufSendHookRecord of vecProtobufSendHookRecords) {
				const vecProtobufSendPreHookCallbacks = [...ProtobufSendHookRecord.PreCallbacks];
				for (const PreHookCallback of vecProtobufSendPreHookCallbacks) {
					PreHookCallback({ Arguments: [g_unEngineServerAddress, unRecipientFilterAddress, nMessageIndex, unProtobufAddress] });
				}
			}

			g_vecMessageDispatches.push({ Backend: "protobuf", Message: ProtobufMessageBuffer.GetRepeatedString("params", 0) });
		} finally {
			g_mapProtobufMessageStates.delete(unProtobufAddress);
		}
	} finally {
		g_mapRecipientFilterStates.delete(unRecipientFilterAddress);
	}
}

globalThis.sourcejs = {
	"filters/recipients": {
		CreateRecipientFilterFromValues(TargetReferences, bIncludeBots) {
			g_Assert.equal(bIncludeBots, true, "messages recipient bIncludeBots");

			return { RecipientIndexes: CollectRecipientIndices(TargetReferences) };
		},
	},

	messages: {
		GetMessageBackend() {
			return g_strActiveMessageBackend;
		},

		GetBaseMessageConstants() {
			return {
				FadeFlags: {
					In: 0x1,
					Modulate: 0x4,
					Out: 0x2,
					Purge: 0x10,
					StayOut: 0x8,
				},
				HUDDestination: {
					Center: 4,
					Console: 2,
					Notify: 1,
					Talk: 3,
				},
				SCREEN_FADE_FRACTION_BITS: 9,
				ShakeCommand: {
					Amplitude: 2,
					Frequency: 3,
					Start: 0,
					StartNoRumble: 5,
					StartRumbleOnly: 4,
					Stop: 1,
				},
			};
		},

		SendClientCommand(unClientIndex, strCommandLine) {
			g_vecNativeCalls.push(["SendClientCommand", unClientIndex, strCommandLine]);

			return true;
		},

		SendClientConsoleMessage(unClientIndex, strMessageText) {
			g_vecNativeCalls.push(["SendClientConsoleMessage", unClientIndex, strMessageText]);

			return true;
		},

		CreateDialog(unClientIndex, nDialogType, DialogValues, strDialogName) {
			g_vecNativeCalls.push(["CreateDialog", unClientIndex, nDialogType, DialogValues, strDialogName]);

			return true;
		},

		GetDialogType(strDialogTypeName) {
			const DialogTypeValues = {
				AskConnect: 4,
				Entry: 3,
				Menu: 1,
				Message: 0,
				Text: 2,
			};
			if (!Object.hasOwn(DialogTypeValues, strDialogTypeName)) {
				throw new TypeError(`Unknown dialog type: ${strDialogTypeName}`);
			}

			return DialogTypeValues[strDialogTypeName];
		},

		GetDialogTypes() {
			return {
				AskConnect: 4,
				Entry: 3,
				Menu: 1,
				Message: 0,
				Text: 2,
			};
		},

		GetUserMessageIndex(strMessageName) {
			return g_mapMessageIndices.has(strMessageName) ? g_mapMessageIndices.get(strMessageName) : -1;
		},

		GetUserMessageName(nMessageIndex) {
			for (const [strMessageName, nRegisteredMessageIndex] of g_mapMessageIndices) {
				if (nRegisteredMessageIndex === nMessageIndex) {
					return strMessageName;
				}
			}

			return null;
		},

		GetUserMessageSize(nMessageIndex) {
			if (!g_mapMessageSizes.has(nMessageIndex)) {
				return -1;
			}

			return g_mapMessageSizes.get(nMessageIndex);
		},

		SendSayTextMessage(unClientIndex, strMessageText, nSenderIndex, bChatEnabled) {
			g_vecNativeCalls.push(["SendSayTextMessage", unClientIndex, strMessageText, nSenderIndex, bChatEnabled]);

			return true;
		},

		SendSayText2Message(unClientIndex, strMessageText, nSenderIndex, bChatEnabled) {
			g_vecNativeCalls.push(["SendSayText2Message", unClientIndex, strMessageText, nSenderIndex, bChatEnabled]);

			return true;
		},

		SendUserMessage(strMessageName, vecRecipientIndices, vecMessageFields, bReliableDelivery) {
			ValidateUserMessageFields(g_strActiveMessageBackend, vecMessageFields);
			g_vecNativeCalls.push(["SendUserMessage", strMessageName, vecRecipientIndices, vecMessageFields, bReliableDelivery]);
			DispatchNativeUserMessage(strMessageName, vecRecipientIndices, vecMessageFields);

			return true;
		},
	},

	"messages/colors": {
		GREEN: "\x04",
		LIGHT_GREEN: "\x06",
		NORMAL: "\x01",
		OLIVE: "\x05",
		TEAM: "\x03",
	},

	"messages/colors/saytext2": {
		BLUE: "\x0B",
		BRIGHT_GREEN: "\x04",
		DARK_BLUE: "\x0C",
		DULL_RED: "\x0F",
		GRAY: "\x08",
		GREEN: "\x06",
		LIGHT_BLUE: "\x0A",
		ORANGE: "\x10",
		PALE_GREEN: "\x05",
		PALE_RED: "\x07",
		PINK: "\x0E",
		RED: "\x02",
		TEAM: "\x03",
		WHITE: "\x01",
		YELLOW: "\x09",

		Apply(strSayText2ColorCode, strSayText2Message) {
			if ((typeof strSayText2ColorCode !== "string") || (typeof strSayText2Message !== "string")) {
				throw new Error("messages/colors/saytext2.Apply(strSayText2ColorCode, strSayText2Message) expects color-code and message strings.");
			}

			if (strSayText2ColorCode.length === 0) {
				throw new Error("messages/colors/saytext2.Apply(strSayText2ColorCode, strSayText2Message) expects strSayText2ColorCode to be a non-empty string.");
			}

			return Buffer.from(`${strSayText2ColorCode}${strSayText2Message}\x01`, "utf8").toString("utf8");
		},

		Strip(strSayText2Message) {
			if (typeof strSayText2Message !== "string") {
				throw new Error("messages/colors/saytext2.Strip(strSayText2Message) requires a message string.");
			}

			return Buffer.from(strSayText2Message, "utf8").toString("utf8").replace(/[\x01-\x10]/g, "");
		},
	},

	"memory/hooks": {
		HookType: {
			Post: 1,
			Pre: 0,
		},

		CreateVTableHook(HookOptions) {
			const VTableHookRecord = {
				Options: HookOptions,
				PostCallbacks: [],
				PreCallbacks: [],
				Removed: false,
			};
			g_vecNativeVTableHooks.push(VTableHookRecord);

			return {
				Post(PostHookCallback) {
					VTableHookRecord.PostCallbacks.push(PostHookCallback);

					return true;
				},

				Pre(PreHookCallback) {
					VTableHookRecord.PreCallbacks.push(PreHookCallback);

					return true;
				},

				Remove() {
					VTableHookRecord.Removed = true;
					VTableHookRecord.PostCallbacks.length = 0;
					VTableHookRecord.PreCallbacks.length = 0;

					return true;
				},

				RemovePost(PostHookCallback) {
					const nPostHookCallbackIndex = VTableHookRecord.PostCallbacks.indexOf(PostHookCallback);
					if (nPostHookCallbackIndex < 0) {
						return false;
					}

					VTableHookRecord.PostCallbacks.splice(nPostHookCallbackIndex, 1);

					return true;
				},

				RemovePre(PreHookCallback) {
					const nPreHookCallbackIndex = VTableHookRecord.PreCallbacks.indexOf(PreHookCallback);
					if (nPreHookCallbackIndex < 0) {
						return false;
					}

					VTableHookRecord.PreCallbacks.splice(nPreHookCallbackIndex, 1);

					return true;
				},
			};
		},

		GetDisabled() {
			return g_bNativeHooksDisabled;
		},

		SetDisabled(bHooksDisabled) {
			g_Assert.equal(typeof bHooksDisabled, "boolean", "memory/hooks.SetDisabled value type");
			g_bNativeHooksDisabled = bHooksDisabled;

			return g_bNativeHooksDisabled;
		},
	},

	"memory/hooks/messages": {
		ApplyBitBufferState(unBitBufferAddress, BitBufferState) {
			g_mapBitBufferStates.set(unBitBufferAddress, {
				Bytes: new Uint8Array(BitBufferState.Bytes),
				CurrentBit: BitBufferState.CurrentBit,
				DataBitCount: BitBufferState.DataBitCount,
				Overflowed: BitBufferState.Overflowed,
			});

			return true;
		},

		Backend() {
			return g_strActiveMessageBackend;
		},

		GetBitBufferState(unBitBufferAddress) {
			return g_mapBitBufferStates.get(unBitBufferAddress);
		},

		GetMessageEndHookOptions() {
			return {
				Arguments: ["address"],
				Convention: "thiscall",
				HookKind: "BITBUFFEREND",
				Index: 2,
				ObjectAddress: g_unEngineServerAddress,
				ReturnType: "void",
			};
		},

		GetRecipientFilter(unRecipientFilterAddress) {
			const RecipientFilterState = g_mapRecipientFilterStates.get(unRecipientFilterAddress);
			const vecRecipientIndices = [];
			g_Assert.ok(RecipientFilterState !== undefined, `message-hook recipient address ${unRecipientFilterAddress}`);

			for (const unRecipientIndex of RecipientFilterState.Indices) {
				vecRecipientIndices.push(unRecipientIndex);
			}

			return { Indices: vecRecipientIndices, InitializationMessage: RecipientFilterState.InitializationMessage, Reliable: RecipientFilterState.Reliable };
		},

		GetProtobufMessage(unProtobufAddress) {
			const ProtobufMessageBuffer = g_mapProtobufMessageStates.get(unProtobufAddress);
			g_Assert.ok(ProtobufMessageBuffer !== undefined, `message-hook protobuf address ${unProtobufAddress}`);

			return ProtobufMessageBuffer;
		},

		GetSendUserMessageHookOptions() {
			return {
				Arguments: ["address", "address", "int", "address"],
				Convention: "thiscall",
				HookKind: "PROTOBUFSEND",
				Index: 3,
				ObjectAddress: g_unEngineServerAddress,
				ReturnType: "bool",
			};
		},

		GetUserMessageBeginHookOptions() {
			return {
				Arguments: ["address", "address", "int"],
				Convention: "thiscall",
				HookKind: "BITBUFFERBEGIN",
				Index: 1,
				ObjectAddress: g_unEngineServerAddress,
				ReturnType: "address",
			};
		},
	},

	"players/language": {
		GetClientLanguage(unClientIndex) {
			return (unClientIndex === 2) ? "ru" : "en";
		},
	},

	players: {
		IsFakeClient(unClientIndex) {
			return unClientIndex === 3;
		},
	},
};

require(g_strBitbuffersMockPath).InstallBitBuffersMock();

const g_NativeMessageRuntimeExports = { ...globalThis.sourcejs.messages };
const g_vecNativeMessageExportNames = Object.keys(g_NativeMessageRuntimeExports).sort();
const g_Bitbuffers = require(g_strBitbuffersPath);
const g_Messages = require(g_strMessagesPath);
const g_MessagesBase = require(g_strMessagesBasePath);
const g_MessageColors = require(g_strMessageColorsPath);
const g_SayText2Colors = require(g_strSayText2ColorsPath);
const g_MessagesDialog = require(g_strMessagesDialogPath);
const g_MessagesImplementation = require(g_strMessagesImplementationPath);
const g_MessageHooks = require(g_strMessageHooksPath);

VerifyNativeProtobufContracts();

function CheckBitBufferFieldTypes() {
	const Message = new g_MessagesBase.SayText("Probe");
	const vecWriteCalls = [];

	const MessageBuffer = {
		WriteLong(nValue) {
			vecWriteCalls.push(["WriteLong", nValue]);

			return true;
		},

		WriteUBitLong(unValue, unBitCount) {
			vecWriteCalls.push(["WriteUBitLong", unValue, unBitCount]);

			return true;
		},

		WriteOneBit(bValue) {
			vecWriteCalls.push(["WriteOneBit", bValue]);

			return true;
		},
	};

	const vecValidFields = [
		{ Type: "int", Value: -0x80000000 },
		{ Type: "int", Value: 0x7FFFFFFF },
		{ Type: "uint", Value: 0xFFFFFFFF },
		{ Type: "bool", Value: true },
		{ Type: "bool", Value: false },
		{ Type: "bits", Value: 0xD, Bits: 4 },
		{ Type: "bits", Value: 0, Bits: 0 },
		{ Type: "bits", Value: 0xFFFFFFFF, Bits: 32 },
	];
	Message.BuildUserMessageBitBufferFields = () => vecValidFields;
	g_Assert.equal(Message.WriteUserMessageToBitBuffer(MessageBuffer), MessageBuffer);

	const vecExpectedWriteCalls = [
		["WriteLong", -0x80000000],
		["WriteLong", 0x7FFFFFFF],
		["WriteUBitLong", 0xFFFFFFFF, 32],
		["WriteOneBit", true],
		["WriteOneBit", false],
		["WriteUBitLong", 0xD, 4],
		["WriteUBitLong", 0, 0],
		["WriteUBitLong", 0xFFFFFFFF, 32],
	];
	g_Assert.deepEqual(vecWriteCalls, vecExpectedWriteCalls);

	const vecInvalidFields = [
		{ Type: "unknown", Value: 0, Bits: 8 },
		{ Type: "int", Value: -0x80000001 },
		{ Type: "int", Value: 0x80000000 },
		{ Type: "int", Value: 1.5 },
		{ Type: "uint", Value: -1 },
		{ Type: "uint", Value: 0x100000000 },
		{ Type: "bool", Value: 1 },
		{ Type: "bits", Value: 0 },
		{ Type: "bits", Value: 0, Bits: null },
		{ Type: "bits", Value: 0, Bits: -1 },
		{ Type: "bits", Value: 0, Bits: 33 },
		{ Type: "bits", Value: 0, Bits: 1.5 },
		{ Type: "bits", Value: -1, Bits: 1 },
		{ Type: "bits", Value: 0x100000000, Bits: 32 },
	];
	for (const FieldEntry of vecInvalidFields) {
		const unPreviousWriteCount = vecWriteCalls.length;
		Message.BuildUserMessageBitBufferFields = () => [FieldEntry];
		g_Assert.throws(() => Message.WriteUserMessageToBitBuffer(MessageBuffer), /User message (int|uint|bool|bits) field|Unsupported user message bit buffer field type:/);
		g_Assert.equal(vecWriteCalls.length, unPreviousWriteCount, "invalid bitbuffer descriptors fail before writing their field");
	}

	const OverflowedBuffer = {
		Overflowed: false,

		WriteLong() {
			this.Overflowed = true;

			return false;
		},
	};

	Message.BuildUserMessageBitBufferFields = () => [{ Type: "int", Value: 1 }];
	g_Assert.equal(Message.WriteUserMessageToBitBuffer(OverflowedBuffer), OverflowedBuffer);
	g_Assert.equal(OverflowedBuffer.Overflowed, true, "callers inspect the returned adapter's overflow state");
}

function CheckProtobufFieldKinds() {
	const Message = new g_MessagesBase.SayText("Probe");
	let unBufferWriteCount = 0;

	const MessageBuffer = {
		SetString(strFieldName, strFieldValue) {
			g_Assert.equal(strFieldName, "text");
			g_Assert.equal(strFieldValue, "Probe");
			unBufferWriteCount += 1;
		},
	};
	for (const strFieldKind of [
		"invalid",
		"set",
		"add",
		"message",
		"addMessage",
		"Set",
		"Add",
		"Message",
		"AddMessage",
	]) {
		Message.BuildUserMessageProtobufFields = () => [{ Kind: strFieldKind, Name: "text", Type: "string", Value: "Probe" }];
		g_Assert.throws(() => Message.WriteUserMessageToProtobuf(MessageBuffer), /Unsupported protobuf field kind:/, `protobuf rejects the unsupported field kind ${strFieldKind}`);
	}

	g_Assert.equal(unBufferWriteCount, 0, "unsupported protobuf field kinds do not write their field");
	Message.BuildUserMessageProtobufFields = () => [{ Kind: "SET", Name: "text", Type: "string", Value: "Probe" }];
	g_Assert.equal(Message.WriteUserMessageToProtobuf(MessageBuffer), MessageBuffer);
	g_Assert.equal(unBufferWriteCount, 1, "the valid field reaches the real native SetString method shape");
}

function VerifyInvalidMessageBackend() {
	const strOriginalMessageBackend = g_strActiveMessageBackend;
	const vecMessages = [
		new g_MessagesBase.HintText("Backend validation"),
		new g_MessagesBase.ShowMenu("Backend validation"),
	];
	const unOriginalNativeCallCount = g_vecNativeCalls.length;

	try {
		for (const BackendValue of ["unsupported", null]) {
			// Deliberately break the native result contract; creators must reject it before delivery.
			g_strActiveMessageBackend = BackendValue;

			const strExpectedErrorMessage = (typeof BackendValue === "string") ? `Unsupported messages backend: ${BackendValue}` : "messages.GetMessageBackend() result requires a string.";
			const ExpectedError = { name: "TypeError", message: strExpectedErrorMessage };
			g_Assert.throws(() => new g_MessagesBase.SayText("Backend validation"), ExpectedError);
			g_Assert.throws(() => new g_MessagesBase.SayText2("Backend validation"), ExpectedError);
			g_Assert.equal(new g_MessagesBase.SayText("Explicit color", { Color: "\x02" }).MessageFields.Color, "\x02", "SayText explicit color does not query the default backend");
			g_Assert.equal(new g_MessagesBase.SayText2("Explicit color", { Color: "\x02" }).MessageFields.Color, "\x02", "SayText2 explicit color does not query the default backend");
			g_Assert.equal(g_MessagesBase.GetMessageBackend(), BackendValue, "the public getter still forwards the native result");

			for (const Message of vecMessages) {
				const MessagePayload = Message.BuildUserMessagePayload([1]);
				g_Assert.throws(() => Message.DeliverUserMessage(MessagePayload), ExpectedError);
			}
		}

		g_Assert.equal(g_vecNativeCalls.length, unOriginalNativeCallCount, "an invalid backend must not reach the native sender");
	} finally {
		g_strActiveMessageBackend = strOriginalMessageBackend;
	}
}

function VerifyUnsupportedRegisteredMessage() {
	const strUnsupportedMessageName = "UnsupportedMessage";
	const unUnsupportedMessageIndex = Math.max(...g_mapMessageIndices.values()) + 1;
	g_Assert.equal(g_mapMessageIndices.has(strUnsupportedMessageName), false, "the unsupported registry fixture has a unique name");
	g_mapMessageIndices.set(strUnsupportedMessageName, unUnsupportedMessageIndex);

	try {
		const ExpectedIndexError = { name: "TypeError", message: `User message ${unUnsupportedMessageIndex} has no supported SourceJS serializer.` };
		g_Assert.throws(() => g_MessagesImplementation.GetUserMessageImplementation(unUnsupportedMessageIndex), ExpectedIndexError, "a registered unsupported index is not a type error in the lookup argument");

		const ExpectedNameError = { name: "TypeError", message: `User message ${strUnsupportedMessageName} has no supported SourceJS serializer.` };
		g_Assert.throws(() => g_MessagesImplementation.GetUserMessageImplementation(strUnsupportedMessageName), ExpectedNameError, "unsupported names and indexes have consistent diagnostics");
	} finally {
		g_Assert.equal(g_mapMessageIndices.delete(strUnsupportedMessageName), true, "the unsupported registry fixture is removed");
	}
}

CheckBitBufferFieldTypes();
CheckProtobufFieldKinds();
VerifyInvalidMessageBackend();

function VerifyMissingBaseMessageConstants() {
	const vecConstantDependentExportNames = [
		"FADE_FLAGS",
		"Fade",
		"GetBaseMessageConstants",
		"HUD_DESTINATION",
		"HUDTextMessage",
		"SCREEN_FADE_FRACTION_BITS",
		"SHAKE_COMMAND",
		"Shake",
	];
	const vecModuleCacheRecords = [g_strMessagesBasePath, g_strMessagesPath, g_strMessagesImplementationPath, g_strMessagesDialogPath].map((strModulePath) => {
		const strResolvedModulePath = require.resolve(strModulePath);

		return { Path: strResolvedModulePath, Descriptor: Object.getOwnPropertyDescriptor(require.cache, strResolvedModulePath) };
	});

	const OriginalNativeMessagesDescriptor = Object.getOwnPropertyDescriptor(globalThis.sourcejs, "messages");
	const NativeMessagesWithoutConstants = { ...g_NativeMessageRuntimeExports };
	const unOriginalNativeCallCount = g_vecNativeCalls.length;

	delete NativeMessagesWithoutConstants.GetBaseMessageConstants;

	try {
		Object.defineProperty(globalThis.sourcejs, "messages", { configurable: true, enumerable: OriginalNativeMessagesDescriptor.enumerable, writable: true, value: NativeMessagesWithoutConstants });

		for (const ModuleCacheRecord of vecModuleCacheRecords) {
			delete require.cache[ModuleCacheRecord.Path];
		}

		const MessagesBaseWithoutConstants = require(g_strMessagesBasePath);
		const MessagesRootWithoutConstants = require(g_strMessagesPath);
		const DialogsWithoutConstants = require(g_strMessagesDialogPath);
		g_Assert.equal(MessagesRootWithoutConstants, NativeMessagesWithoutConstants, "messages missing-constants SDK preserves the native object");
		g_Assert.equal(MessagesRootWithoutConstants.GetMessageBackend(), g_strActiveMessageBackend, "messages missing-constants SDK preserves the backend");
		g_Assert.equal(typeof MessagesBaseWithoutConstants.HintText, "function", "messages missing-constants SDK keeps independent message classes");
		g_Assert.equal(MessagesRootWithoutConstants.SendClientConsoleMessage(1, "without SDK constants"), true, "messages missing-constants SDK keeps transport methods");

		g_Assert.equal(typeof DialogsWithoutConstants.DialogText, "function", "Independent dialogs load without base-message constants");

		const DialogWithoutConstants = new DialogsWithoutConstants.DialogText("No constants", "Independent dialog");
		g_Assert.equal(DialogWithoutConstants.GetDialogType(), NativeMessagesWithoutConstants.GetDialogTypes().Text, "Independent dialogs keep the selected SDK dialog type without message constants");

		for (const MessageAPI of [MessagesBaseWithoutConstants, MessagesRootWithoutConstants]) {
			for (const strExportName of vecConstantDependentExportNames) {
				g_Assert.equal(Object.hasOwn(MessageAPI, strExportName), false, `messages missing-constants SDK omits ${strExportName}`);
			}
		}
	} finally {
		RestoreMessageSmokeProperty(globalThis.sourcejs, "messages", OriginalNativeMessagesDescriptor);
		g_vecNativeCalls.length = unOriginalNativeCallCount;

		for (const ModuleCacheRecord of vecModuleCacheRecords) {
			RestoreMessageSmokeProperty(require.cache, ModuleCacheRecord.Path, ModuleCacheRecord.Descriptor);
		}
	}
}

VerifyMissingBaseMessageConstants();

g_Assert.equal(g_Messages, globalThis.sourcejs.messages, "messages exact native object");
g_Assert.equal(g_MessageColors, globalThis.sourcejs["messages/colors"], "messages/colors exact native object");
g_Assert.equal(g_SayText2Colors, globalThis.sourcejs["messages/colors/saytext2"], "messages/colors/saytext2 exact native object");

function VerifyMessagesCapabilityProfiles() {
	const OriginalNativeMessages = globalThis.sourcejs.messages;
	const OriginalNativeMessagesDescriptor = Object.getOwnPropertyDescriptor(globalThis.sourcejs, "messages");
	const strOriginalBackend = g_strActiveMessageBackend;
	const unOriginalNativeCallCount = g_vecNativeCalls.length;
	const vecNativeNames = [
		"CreateDialog",
		"GetBaseMessageConstants",
		"GetDialogType",
		"GetDialogTypes",
		"GetMessageBackend",
		"GetUserMessageIndex",
		"GetUserMessageName",
		"GetUserMessageSize",
		"SendClientCommand",
		"SendClientConsoleMessage",
		"SendSayTextMessage",
		"SendSayText2Message",
		"SendUserMessage",
	];
	const vecModulePaths = [g_strMessagesPath, g_strMessagesBasePath, g_strMessagesImplementationPath];
	const mapOriginalCacheDescriptors = new Map(vecModulePaths.map((strPath) => [strPath, Object.getOwnPropertyDescriptor(require.cache, strPath)]));

	try {
		for (const strBackend of ["bitbuffer", "protobuf", "source2"]) {
			for (const bHasConstants of [false, true]) {
				const NativeProfile = {};
				for (const strName of vecNativeNames) {
					if (Object.hasOwn(OriginalNativeMessages, strName)) {
						NativeProfile[strName] = OriginalNativeMessages[strName];
					}
				}

				if (!bHasConstants) {
					delete NativeProfile.GetBaseMessageConstants;
				}

				if (strBackend !== "bitbuffer") {
					delete NativeProfile.SendSayTextMessage;
					delete NativeProfile.SendSayText2Message;
					delete NativeProfile.GetUserMessageSize;
				}

				if (strBackend === "source2") {
					delete NativeProfile.GetUserMessageIndex;
					delete NativeProfile.GetUserMessageName;
					delete NativeProfile.SendUserMessage;
				}

				for (const strPath of vecModulePaths) {
					delete require.cache[strPath];
				}

				Object.defineProperty(globalThis.sourcejs, "messages", { configurable: true, enumerable: OriginalNativeMessagesDescriptor.enumerable, writable: true, value: NativeProfile });
				g_strActiveMessageBackend = strBackend;

				const FreshMessages = require(g_strMessagesPath);
				const FreshImplementation = require(g_strMessagesImplementationPath);
				g_Assert.equal(FreshMessages, NativeProfile, "The root package augments the selected native message object");
				g_Assert.equal(FreshMessages.GetMessageBackend(), strBackend, "The root package preserves the selected backend");

				for (const strName of [
					"Fade",
					"Shake",
					"HUDTextMessage",
					"FADE_FLAGS",
					"HUD_DESTINATION",
					"SHAKE_COMMAND",
					"SCREEN_FADE_FRACTION_BITS",
					"GetBaseMessageConstants",
				]) {
					g_Assert.equal(Object.hasOwn(FreshMessages, strName), bHasConstants, `${strBackend}: ${strName} follows constant capability`);
				}

				g_Assert.equal(typeof FreshMessages.HintText, "function", "Other typed creators load without SDK constants");
				g_Assert.equal(typeof FreshImplementation.HintTextUserMessageImplementation, "function", "Other decoded codecs load without SDK constants");
				g_Assert.equal(typeof FreshImplementation.FadeUserMessageImplementation, "function", "The established Fade codec export is preserved");

				if (!bHasConstants) {
					let unBufferAccessCount = 0;

					const RejectAccess = () => {
						unBufferAccessCount++;
						throw new Error("Unsupported Fade touched a buffer or field");
					};

					const Buffer = new Proxy({}, { get: RejectAccess });
					const Fields = new Proxy({}, { get: RejectAccess });
					for (const strMethod of ["ReadUserMessageFromBitBuffer", "WriteUserMessageToBitBuffer", "ReadUserMessageFromProtobuf", "WriteUserMessageToProtobuf"]) {
						g_Assert.throws(() => FreshImplementation.FadeUserMessageImplementation[strMethod](Buffer, Fields), { name: "TypeError", message: /SCREEN_FADE_FRACTION_BITS/ }, `${strBackend}: ${strMethod} rejects missing SDK scale`);
					}

					g_Assert.equal(unBufferAccessCount, 0, "Unsupported Fade is rejected before any buffer or field access");
				}
			}
		}

		for (const strPath of vecModulePaths) {
			delete require.cache[strPath];
		}

		const ConstantFailure = new Error("Selected-SDK constant getter failed");
		Object.defineProperty(globalThis.sourcejs, "messages", {
			configurable: true,
			enumerable: OriginalNativeMessagesDescriptor.enumerable,
			writable: true,
			value: {
				GetBaseMessageConstants() {
					throw ConstantFailure;
				},
			},
		});

		g_Assert.throws(() => require(g_strMessagesImplementationPath), (ErrorValue) => ErrorValue === ConstantFailure, "The codec dependency preserves a present SDK constant getter failure");
		g_Assert.throws(() => require(g_strMessagesPath), (ErrorValue) => ErrorValue === ConstantFailure, "A present SDK constant getter failure propagates unchanged");
	} finally {
		RestoreMessageSmokeProperty(globalThis.sourcejs, "messages", OriginalNativeMessagesDescriptor);
		g_strActiveMessageBackend = strOriginalBackend;
		g_vecNativeCalls.length = unOriginalNativeCallCount;

		for (const strPath of vecModulePaths) {
			RestoreMessageSmokeProperty(require.cache, strPath, mapOriginalCacheDescriptors.get(strPath));
		}
	}
}

VerifyMessagesCapabilityProfiles();

const g_strMessagesDocumentation = g_FileSystem.readFileSync(g_strMessagesDocumentationPath, "utf8");
const g_vecMessagesDocumentationJavaScriptBlocks = [];
for (const vecDocumentationBlockMatch of g_strMessagesDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)) {
	g_vecMessagesDocumentationJavaScriptBlocks.push(vecDocumentationBlockMatch[1]);
}

const g_vecMessagesExportSectionMatch = g_strMessagesDocumentation.match(/## Exports\r?\n([\s\S]*?)\r?\n## /);
const g_bMessagesDocumentationUsesConsole = g_strMessagesDocumentation.includes("console.");

g_Assert.notEqual(g_vecMessagesExportSectionMatch, null, "messages documentation export section");
g_Assert.equal(g_strMessagesDocumentation.includes("Generated by"), false, "messages documentation generated marker");
g_Assert.equal(g_bMessagesDocumentationUsesConsole, false, "messages documentation examples verify results instead of printing them");
g_Assert.equal(g_vecMessagesDocumentationJavaScriptBlocks.length, 10, "messages documentation JavaScript block count");

const g_vecDocumentedMessageExportNames = [];
for (const vecMessageExportMatch of g_vecMessagesExportSectionMatch[1].matchAll(/^\| (?:\[)?`([^`]+)`(?:\]\(#[^)]*\))? \|/gm)) {
	g_vecDocumentedMessageExportNames.push(vecMessageExportMatch[1]);
}

g_vecDocumentedMessageExportNames.sort();

g_Assert.deepEqual(g_vecDocumentedMessageExportNames, g_vecNativeMessageExportNames, "messages documented export inventory");
g_Assert.deepEqual(Object.keys(g_Messages).sort(), [...new Set([...g_vecNativeMessageExportNames, ...Object.keys(g_MessagesBase)])].sort(), "messages root combined export inventory");

for (const vecDocumentationLinkMatch of g_strMessagesDocumentation.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
	const strDocumentationLinkTarget = vecDocumentationLinkMatch[1].split("#", 1)[0];
	if ((strDocumentationLinkTarget.length > 0) && !/^[a-z]+:/i.test(strDocumentationLinkTarget)) {
		const strResolvedDocumentationLinkPath = g_Path.resolve(g_Path.dirname(g_strMessagesDocumentationPath), strDocumentationLinkTarget);
		g_Assert.equal(g_FileSystem.existsSync(strResolvedDocumentationLinkPath), true, `messages documentation link: ${strDocumentationLinkTarget}`);
	}
}

const g_strMessagesDocumentationSource = g_vecMessagesDocumentationJavaScriptBlocks.join("\n");
for (const strMessageExportName of g_vecNativeMessageExportNames) {
	g_Assert.match(g_strMessagesDocumentationSource, new RegExp(`\\b${strMessageExportName}\\b`), `messages example for ${strMessageExportName}`);
}

for (const [unDocumentationBlockIndex, strDocumentationBlock] of g_vecMessagesDocumentationJavaScriptBlocks.entries()) {
	const strDocumentationBlockLabel = `messages documentation block ${unDocumentationBlockIndex + 1}`;

	const CompileDocumentationBlock = () => g_VM.compileFunction("\"use strict\";\n" + strDocumentationBlock, ["require"], { filename: strDocumentationBlockLabel });

	g_Assert.doesNotThrow(CompileDocumentationBlock, `${strDocumentationBlockLabel} syntax`);
}

function ExecuteMessagesDocumentationBlock(strDocumentationBlock, strDocumentationBlockLabel) {
	const DocumentationRequire = (strModuleName) => {
		switch (strModuleName) {
			case "messages":
				return g_Messages;

			case "messages/colors":
				return g_MessageColors;

			default:
				throw new Error(`Unexpected messages documentation dependency: ${strModuleName}`);
		}
	};

	const ExecuteDocumentationBlock = g_VM.compileFunction("\"use strict\";\n" + strDocumentationBlock, ["require"], { filename: strDocumentationBlockLabel });
	RunMessageDocumentationOperation(ExecuteDocumentationBlock, [DocumentationRequire], strDocumentationBlockLabel);
}

const g_unMessagesDocumentationCallIndex = g_vecNativeCalls.length;

for (const [unDocumentationBlockIndex, strDocumentationBlock] of g_vecMessagesDocumentationJavaScriptBlocks.entries()) {
	const strDocumentationBlockLabel = `messages documentation block ${unDocumentationBlockIndex + 1}`;

	const ExecuteDocumentationBlock = () => ExecuteMessagesDocumentationBlock(strDocumentationBlock, strDocumentationBlockLabel);

	g_Assert.doesNotThrow(ExecuteDocumentationBlock, `${strDocumentationBlockLabel} execution`);
}

const g_vecMessagesDocumentationNativeCalls = g_vecNativeCalls.slice(g_unMessagesDocumentationCallIndex);

let g_bClientConsoleMessageDocumentationCallFound = false;
let g_bClientCommandDocumentationCallFound = false;
let g_bCreateDialogDocumentationCallFound = false;
let g_bSayTextDocumentationCallFound = false;
let g_bSayText2DocumentationCallFound = false;
let g_bBitBufferUserMessageDocumentationCallFound = false;
for (const vecMessageNativeCall of g_vecMessagesDocumentationNativeCalls) {
	switch (vecMessageNativeCall[0]) {
		case "SendClientCommand":
			if (vecMessageNativeCall[2] === "echo SourceJS message transport ready") {
				g_bClientCommandDocumentationCallFound = true;
			}

			break;

		case "SendClientConsoleMessage":
			if (vecMessageNativeCall[1] === 1) {
				g_bClientConsoleMessageDocumentationCallFound = true;
			}

			break;

		case "CreateDialog":
			if ((vecMessageNativeCall[2] === 1) && (vecMessageNativeCall[3].Title === "SourceJS menu")) {
				g_bCreateDialogDocumentationCallFound = true;
			}

			break;

		case "SendSayTextMessage":
			g_bSayTextDocumentationCallFound = true;
			break;

		case "SendSayText2Message":
			g_bSayText2DocumentationCallFound = true;
			break;

		case "SendUserMessage":
			if (vecMessageNativeCall[3][0].Type === "byte") {
				g_Assert.deepEqual(vecMessageNativeCall[3], [
					{ Type: "byte", Value: 0x01 },
					{ Type: "byte", Value: 0x01 },
					{ Type: "string", Value: "Raw bitbuffer message" },
					{ Type: "string", Value: "" },
					{ Type: "string", Value: "" },
					{ Type: "string", Value: "" },
					{ Type: "string", Value: "" },
				], "Raw SayText2 documentation includes all four parameter strings");
				g_bBitBufferUserMessageDocumentationCallFound = true;
			}

			break;
	}
}

g_Assert.ok(g_bClientConsoleMessageDocumentationCallFound, "messages.SendClientConsoleMessage() documentation call");
g_Assert.ok(g_bClientCommandDocumentationCallFound, "messages.SendClientCommand() documentation call");
g_Assert.ok(g_bCreateDialogDocumentationCallFound, "messages.CreateDialog() documentation call");
g_Assert.ok(g_bSayTextDocumentationCallFound, "messages.SendSayTextMessage() documentation call");
g_Assert.ok(g_bSayText2DocumentationCallFound, "messages.SendSayText2Message() documentation call");
g_Assert.ok(g_bBitBufferUserMessageDocumentationCallFound, "messages.SendUserMessage() bitbuffer documentation call");

const g_strBackendBeforeProtobufDocumentation = g_strActiveMessageBackend;
g_strActiveMessageBackend = "protobuf";

try {
	const strProtobufDocumentationBlock = g_vecMessagesDocumentationJavaScriptBlocks.at(-1);

	const ExecuteProtobufDocumentationBlock = () => ExecuteMessagesDocumentationBlock(strProtobufDocumentationBlock, "messages protobuf documentation");

	g_Assert.doesNotThrow(ExecuteProtobufDocumentationBlock, "messages protobuf documentation execution");
	g_Assert.deepEqual(g_vecNativeCalls.at(-1), [
		"SendUserMessage",
		"SayText2",
		[1],
		[
			{ Kind: "SET", Name: "ent_idx", Type: "int32", Value: 1 },
			{ Kind: "SET", Name: "chat", Type: "bool", Value: true },
			{ Kind: "SET", Name: "msg_name", Type: "string", Value: "Raw protobuf message" },
			{ Kind: "ADD", Name: "params", Type: "string", Value: "" },
			{ Kind: "ADD", Name: "params", Type: "string", Value: "" },
			{ Kind: "ADD", Name: "params", Type: "string", Value: "" },
			{ Kind: "ADD", Name: "params", Type: "string", Value: "" },
		],
		true,
	], "messages.SendUserMessage() protobuf documentation call");
} finally {
	g_strActiveMessageBackend = g_strBackendBeforeProtobufDocumentation;
}

g_vecNativeCalls.length = g_unMessagesDocumentationCallIndex;

const g_strMessagesBaseDocumentation = g_FileSystem.readFileSync(g_strMessagesBaseDocumentationPath, "utf8");
const g_vecMessagesBaseDocumentationJavaScriptBlocks = [];
for (const vecDocumentationBlockMatch of g_strMessagesBaseDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)) {
	g_vecMessagesBaseDocumentationJavaScriptBlocks.push(vecDocumentationBlockMatch[1]);
}

const g_vecMessagesBaseExportSectionMatch = g_strMessagesBaseDocumentation.match(/## Exports\r?\n([\s\S]*?)\r?\n## /);
const g_bMessagesBaseDocumentationGenerated = g_strMessagesBaseDocumentation.includes("Generated by");
const g_bMessagesBaseDocumentationUsesConsole = g_strMessagesBaseDocumentation.includes("console.");

g_Assert.notEqual(g_vecMessagesBaseExportSectionMatch, null, "messages documentation export section");

const g_vecMessagesBaseDocumentedExportNames = [];
for (const vecDocumentedExportMatch of g_vecMessagesBaseExportSectionMatch[1].matchAll(/^\| (?:\[)?`([^`]+)`(?:\]\(#[^)]*\))? \|/gm)) {
	g_vecMessagesBaseDocumentedExportNames.push(vecDocumentedExportMatch[1]);
}

const g_vecMessagesBaseNativeExportNames = Object.keys(g_MessagesBase).sort();

g_vecMessagesBaseDocumentedExportNames.sort();

g_Assert.equal(g_bMessagesBaseDocumentationGenerated, false, "messages documentation generated marker");
g_Assert.equal(g_bMessagesBaseDocumentationUsesConsole, false, "messages documentation examples verify results instead of printing them");
g_Assert.equal(g_vecMessagesBaseDocumentationJavaScriptBlocks.length, 19, "messages documentation JavaScript block count");
g_Assert.deepEqual(g_vecMessagesBaseDocumentedExportNames, g_vecMessagesBaseNativeExportNames, "messages documented export inventory");

for (const vecDocumentationLinkMatch of g_strMessagesBaseDocumentation.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
	const strDocumentationLinkTarget = vecDocumentationLinkMatch[1].split("#", 1)[0];
	if ((strDocumentationLinkTarget.length > 0) && !/^[a-z]+:/i.test(strDocumentationLinkTarget)) {
		const strResolvedDocumentationLinkPath = g_Path.resolve(g_Path.dirname(g_strMessagesBaseDocumentationPath), strDocumentationLinkTarget);
		g_Assert.equal(g_FileSystem.existsSync(strResolvedDocumentationLinkPath), true, `messages documentation link: ${strDocumentationLinkTarget}`);
	}
}

const g_strMessagesBaseDocumentationSource = g_vecMessagesBaseDocumentationJavaScriptBlocks.join("\n");
for (const strMessagesBaseExportName of g_vecMessagesBaseNativeExportNames) {
	g_Assert.match(g_strMessagesBaseDocumentationSource, new RegExp(`\\b${strMessagesBaseExportName}\\b`), `messages example for ${strMessagesBaseExportName}`);
}

for (const [unDocumentationBlockIndex, strDocumentationBlock] of g_vecMessagesBaseDocumentationJavaScriptBlocks.entries()) {
	const strDocumentationLabel = `messages-types.md:block-${unDocumentationBlockIndex + 1}`;

	const CompileMessagesBaseDocumentationBlock = () => g_VM.compileFunction("\"use strict\";\n" + strDocumentationBlock, ["require", "exports"], { filename: strDocumentationLabel });

	g_Assert.doesNotThrow(CompileMessagesBaseDocumentationBlock, `messages documentation block ${unDocumentationBlockIndex + 1} syntax`);
}

const g_RequireMessagesBaseDocumentation = (strModuleName) => {
	switch (strModuleName) {
		case "bitbuffers":
			return g_Bitbuffers;

		case "memory/hooks/messages":
			return g_MessageHooks;

		case "messages":
			return g_Messages;

		case "messages/colors":
			return g_MessageColors;

		default:
			throw new Error(`Unexpected messages documentation dependency: ${strModuleName}`);
	}
};

const g_unMessagesBaseDocumentationCallIndex = g_vecNativeCalls.length;

for (const [unDocumentationBlockIndex, strDocumentationBlock] of g_vecMessagesBaseDocumentationJavaScriptBlocks.entries()) {
	const strDocumentationLabel = `messages-types.md:block-${unDocumentationBlockIndex + 1}`;
	const MessagesBaseDocumentationBlock = g_VM.compileFunction("\"use strict\";\n" + strDocumentationBlock, ["require", "exports"], { filename: strDocumentationLabel });
	const DocumentationExports = {};

	const ExecuteMessagesBaseDocumentationBlock = () => RunMessageDocumentationOperation(MessagesBaseDocumentationBlock, [g_RequireMessagesBaseDocumentation, DocumentationExports], strDocumentationLabel);

	try {
		g_Assert.doesNotThrow(ExecuteMessagesBaseDocumentationBlock, `${strDocumentationLabel} execution`);
		g_Assert.equal(Object.hasOwn(DocumentationExports, "unload"), false, "Typed-message documentation must not export the obsolete lowercase lifecycle.");
	} finally {
		if (typeof DocumentationExports.Unload === "function") {
			RunMessageDocumentationOperation(() => DocumentationExports.Unload(), [], strDocumentationLabel + ":cleanup");
		}
	}
}

const g_vecMessagesBaseDocumentationNativeCalls = g_vecNativeCalls.slice(g_unMessagesBaseDocumentationCallIndex);
const g_setMessagesBaseDocumentedUserMessageNames = new Set();
let g_bMessagesBaseTextMessageDocumentationCallFound = false;
for (const vecMessagesBaseDocumentationNativeCall of g_vecMessagesBaseDocumentationNativeCalls) {
	if (vecMessagesBaseDocumentationNativeCall[0] === "SendUserMessage") {
		g_setMessagesBaseDocumentedUserMessageNames.add(vecMessagesBaseDocumentationNativeCall[1]);
	}

	if (vecMessagesBaseDocumentationNativeCall[0] === "SendClientConsoleMessage") {
		g_bMessagesBaseTextMessageDocumentationCallFound = true;
	}
}

g_Assert.equal(g_bMessagesBaseTextMessageDocumentationCallFound, true, "messages TextMessage documentation call");

const g_vecMessagesBaseDocumentedUserMessageNames = Object.freeze([
	"Fade",
	"HintText",
	"HudMsg",
	"KeyHintText",
	"ResetHud",
	"SayText",
	"SayText2",
	"Shake",
	"ShowMenu",
	"TextMsg",
	"VGUIMenu",
]);
for (const strDocumentedUserMessageName of g_vecMessagesBaseDocumentedUserMessageNames) {
	g_Assert.equal(g_setMessagesBaseDocumentedUserMessageNames.has(strDocumentedUserMessageName), true, `messages documentation send ${strDocumentedUserMessageName}`);
}

function VerifyTypedCreatorBaseContracts() {
	const vecRawBlocks = g_vecMessagesBaseDocumentationJavaScriptBlocks.filter((strBlock) => strBlock.includes("Raw SourceJS chat"));
	g_Assert.equal(vecRawBlocks.length, 1, "The raw UserMessage example is unique");

	const vecRawBitBufferCalls = g_vecMessagesBaseDocumentationNativeCalls.filter((vecCall) => (vecCall[0] === "SendUserMessage") && vecCall[3].some((Field) => Field.Value === "Raw SourceJS chat"));
	g_Assert.equal(vecRawBitBufferCalls.length, 1, "The raw UserMessage bitbuffer example dispatches once");
	g_Assert.deepEqual(vecRawBitBufferCalls[0], [
		"SendUserMessage",
		"SayText2",
		[1],
		[
			{ Type: "byte", Value: 0x01 },
			{ Type: "byte", Value: 0x01 },
			{ Type: "string", Value: "Raw SourceJS chat" },
			{ Type: "string", Value: "" },
			{ Type: "string", Value: "" },
			{ Type: "string", Value: "" },
			{ Type: "string", Value: "" },
		],
		true,
	], "The raw UserMessage bitbuffer example contains the complete SayText2 body");

	const strOriginalBackend = g_strActiveMessageBackend;
	const unOriginalCallCount = g_vecNativeCalls.length;

	try {
		g_strActiveMessageBackend = "protobuf";

		const RawDocumentationBlock = g_VM.compileFunction("\"use strict\";\n" + vecRawBlocks[0], ["require"], { filename: "messages-types.md:raw-protobuf" });
		RunMessageDocumentationOperation(RawDocumentationBlock, [g_RequireMessagesBaseDocumentation], "messages-types.md:raw-protobuf");

		const vecRawProtobufCalls = g_vecNativeCalls.slice(unOriginalCallCount).filter((vecCall) => vecCall[0] === "SendUserMessage");
		g_Assert.deepEqual(vecRawProtobufCalls, [
			[
				"SendUserMessage",
				"SayText2",
				[1],
				[
					{ Kind: "SET", Name: "ent_idx", Type: "int32", Value: 1 },
					{ Kind: "SET", Name: "chat", Type: "bool", Value: true },
					{ Kind: "SET", Name: "msg_name", Type: "string", Value: "Raw SourceJS chat" },
					{ Kind: "ADD", Name: "params", Type: "string", Value: "" },
					{ Kind: "ADD", Name: "params", Type: "string", Value: "" },
					{ Kind: "ADD", Name: "params", Type: "string", Value: "" },
					{ Kind: "ADD", Name: "params", Type: "string", Value: "" },
				],
				true,
			],
		], "The raw UserMessage protobuf example contains all four parameters");
	} finally {
		g_strActiveMessageBackend = strOriginalBackend;
		g_vecNativeCalls.length = unOriginalCallCount;
	}

	const vecFields = [{ Type: "string", Value: "initial" }];
	const Raw = new g_MessagesBase.UserMessage("HintText", vecFields);
	g_Assert.equal(Raw.FieldEntries, vecFields, "Raw descriptors are retained by reference");
	vecFields[0].Value = "changed";
	g_Assert.equal(Raw.FieldEntries[0].Value, "changed", "Raw descriptor mutation remains live");
	g_Assert.equal(Raw.AddUserMessageField("unrecognized", {}), Raw, "Raw descriptor type and value validation is deferred");
	g_Assert.throws(() => Raw.AddUserMessageField("bits", 0, 33), TypeError, "Supplied bit count is checked immediately");

	const Nested = {};
	const Fields = Object.assign(Object.create(null), { Message: "{Word} {Missing}", Nested, Word: "ready" });
	const Creator = new g_MessagesBase.UserMessageCreator(Fields);
	g_Assert.equal(Creator.MessageFields, Fields, "Creator fields are retained by reference");
	g_Assert.equal(Creator.ReliableDelivery, false, "Creator reliability defaults to false");
	g_Assert.equal(Creator.ValidFieldNames.has("Message"), true, "Strict fields default to the initial own inventory");

	const Copy = Creator.TranslateUserMessageFields();
	g_Assert.notEqual(Copy, Fields, "Translated fields are a new shallow record");
	g_Assert.equal(Copy.Nested, Nested, "Nested non-translated fields remain shared");
	g_Assert.equal(Creator.toString(), "ready {Missing}", "Unknown placeholders stay in the formatted string");
	Fields.Added = 1;
	g_Assert.equal(Creator.GetUserMessageField("Added"), 1, "Direct field mutation is observable");
	g_Assert.throws(() => Creator.SetUserMessageField("Added", 2), ReferenceError, "Strict setter inventory does not grow implicitly");
	Creator.ValidFieldNames.add("Added");
	g_Assert.equal(Creator.SetUserMessageField("Added", 2), Creator, "The public field-name set remains mutable");

	const Options = Object.assign(Object.create(null), { Strict: false, Reliable: true });
	const LooseCreator = new g_MessagesBase.UserMessageCreator({}, Options);
	g_Assert.equal(LooseCreator.ValidFieldNames, null, "Null-prototype options can disable strictness");
	g_Assert.equal(LooseCreator.ReliableDelivery, true, "Explicit reliability is retained");
	g_Assert.equal(LooseCreator.SetUserMessageField("Added", 1), LooseCreator, "Non-strict setter accepts new fields");

	g_Assert.equal(new g_MessagesBase.HintText("{toString} {Word} {Missing}").TranslateUserMessageFields("en", { Word: "ready" }).Message, "{toString} ready {Missing}", "Inherited token names are not substituted");

	const Tokens = Object.assign(Object.create(null), { Word: "ready" });
	const Translator = {
		GetString(strLanguageCode, TranslationTokens) {
			g_Assert.equal(this, Translator, "Translation preserves the GetString receiver");
			g_Assert.equal(TranslationTokens, Tokens, "Translation passes the supplied token record");

			return `${TranslationTokens.Word}:${strLanguageCode}`;
		},
	};

	const Notice = new g_MessagesBase.HintText("initial", { Nested });
	Notice.SetUserMessageField("Message", Translator);
	const Payload = Notice.BuildUserMessagePayload([1, 3], Tokens, "en");
	g_Assert.equal(Payload.MessageFields.Message, "ready:en", "Callable translation produces a string");
	g_Assert.equal(Payload.MessageFields.Nested, Nested, "Payload field copy is shallow");
	g_Assert.equal(Payload.TranslationTokens, Tokens, "Payload tokens are retained by reference");
	g_Assert.equal(Payload.UserMessage, Notice, "Payload retains its creator");
	g_Assert.deepEqual(Payload.RecipientIndexes, [1, 3], "Low-level payload preparation does not exclude fake clients");

	Notice.SetUserMessageField("Message", {
		GetString() {
			return 17;
		},
	});
	g_Assert.throws(() => Notice.TranslateUserMessageFields("en", Tokens), TypeError, "A non-string translation result is rejected");

	const TranslationFailure = new Error("Translation getter failed");
	Notice.SetUserMessageField("Message", Object.defineProperty({}, "GetString", {
		get() {
			throw TranslationFailure;
		},
	}));
	g_Assert.throws(() => Notice.TranslateUserMessageFields("en", Tokens), (ErrorValue) => ErrorValue === TranslationFailure, "Translation getter failures propagate unchanged");

	Notice.SetUserMessageField("Message", "{Word}");
	g_Assert.throws(() => Notice.TranslateUserMessageFields("en", { Word: {} }), TypeError, "Used non-scalar template tokens are rejected");

	const vecPayloads = [];
	const vecResults = [false, true];

	class DeliveryProbe extends g_MessagesBase.HintText {
		DeliverUserMessage(MessagePayload) {
			vecPayloads.push(MessagePayload);

			const Result = vecResults[vecPayloads.length - 1];
			if (Result instanceof Error) {
				throw Result;
			}

			return Result;
		}
	}

	const GroupedNotice = new DeliveryProbe("ready");
	g_Assert.equal(GroupedNotice.SendUserMessage([1, 3, 2, 1]), false, "A false delivery contributes to the aggregate");
	g_Assert.deepEqual(vecPayloads.map((Payload) => [Payload.LanguageCode, Payload.RecipientIndexes]), [["en", [1]], ["ru", [2]]], "False continues later languages; fake clients and duplicates are excluded");
	vecPayloads.length = 0;
	g_Assert.equal(GroupedNotice.SendUserMessage([3]), false, "No human language group returns false");
	g_Assert.equal(vecPayloads.length, 0, "No human language group performs no delivery");

	const DeliveryFailure = new Error("Delivery failed");
	vecResults[0] = DeliveryFailure;
	g_Assert.throws(() => GroupedNotice.SendUserMessage([1, 2]), (ErrorValue) => ErrorValue === DeliveryFailure, "Delivery exception identity is preserved");
	g_Assert.equal(vecPayloads.length, 1, "A thrown delivery prevents later language groups");

	const vecEmptyPayloads = [];

	class UntranslatedProbe extends g_MessagesBase.UserMessageCreator {
		DeliverUserMessage(MessagePayload) {
			vecEmptyPayloads.push(MessagePayload);

			return false;
		}
	}

	g_Assert.equal(new UntranslatedProbe().SendUserMessage([3]), false, "A non-translated creator still prepares its empty group");
	g_Assert.equal(vecEmptyPayloads.length, 1, "Non-translated empty recipients are not silently skipped");
	g_Assert.deepEqual(vecEmptyPayloads[0].RecipientIndexes, [], "The prepared group retains its empty recipient array");
}

VerifyTypedCreatorBaseContracts();

const g_strWriteProtobufDocumentationBlock = g_vecMessagesBaseDocumentationJavaScriptBlocks.find((strDocumentationBlock) => strDocumentationBlock.includes("ProtobufUserMessageHook"));
g_Assert.notEqual(g_strWriteProtobufDocumentationBlock, undefined, "messages.WriteUserMessageToProtobuf() documentation block");

function VerifyProtobufWriterDocumentation() {
	const OriginalHookCacheDescriptor = Object.getOwnPropertyDescriptor(require.cache, g_strMessageHooksPath);
	const strOriginalBackend = g_strActiveMessageBackend;
	const unOriginalNativeCallCount = g_vecNativeCalls.length;
	const DocumentationExports = {};
	const strDocumentationLabel = "messages-types.md:protobuf-writer";
	let bPrimaryThrown = false;
	let PrimaryError = undefined;

	try {
		g_strActiveMessageBackend = "protobuf";
		delete require.cache[g_strMessageHooksPath];

		const ProtobufDocumentationMessageHooksModule = require(g_strMessageHooksPath);

		const RequireMessagesBaseProtobufDocumentation = (strModuleName) => {
			switch (strModuleName) {
				case "memory/hooks/messages":
					return ProtobufDocumentationMessageHooksModule;

				case "messages":
					return g_MessagesBase;

				default:
					throw new Error(`Unexpected messages protobuf documentation dependency: ${strModuleName}`);
			}
		};

		const WriteProtobufDocumentationBlock = g_VM.compileFunction("\"use strict\";\n" + g_strWriteProtobufDocumentationBlock, ["require", "exports"], { filename: strDocumentationLabel });

		const ExecuteWriteProtobufDocumentationBlock = () => RunMessageDocumentationOperation(WriteProtobufDocumentationBlock, [RequireMessagesBaseProtobufDocumentation, DocumentationExports], strDocumentationLabel);

		g_Assert.doesNotThrow(ExecuteWriteProtobufDocumentationBlock, "messages.WriteUserMessageToProtobuf() documentation execution");
		g_Assert.equal(Object.hasOwn(DocumentationExports, "unload"), false, "Messages writer documentation must not export the obsolete lowercase lifecycle.");
		g_Assert.equal(typeof DocumentationExports.Unload, "function", "messages writer documentation publishes cleanup");
		g_Assert.equal(RunMessageDocumentationOperation(() => DocumentationExports.Unload(), [], strDocumentationLabel + ":cleanup"), true, "messages writer documentation cleanup is idempotent");
		g_Assert.equal(ProtobufDocumentationMessageHooksModule.HOOK_STATUS.ProtobufSendInstalled, false, "messages protobuf writer documentation hook cleanup");
		g_Assert.equal(g_vecNativeVTableHooks.at(-1).Removed, true, "messages.WriteUserMessageToProtobuf() native hook release");
	} catch (CaughtError) {
		bPrimaryThrown = true;
		PrimaryError = CaughtError;
		throw CaughtError;
	} finally {
		try {
			if (typeof DocumentationExports.Unload === "function") {
				RunMessageDocumentationOperation(() => DocumentationExports.Unload(), [], strDocumentationLabel + ":final-cleanup");
			}
		} catch (CleanupError) {
			if (bPrimaryThrown) {
				throw new AggregateError([PrimaryError, CleanupError], "Protobuf writer verification and cleanup both failed.");
			}

			throw CleanupError;
		} finally {
			RestoreMessageSmokeProperty(require.cache, g_strMessageHooksPath, OriginalHookCacheDescriptor);
			g_strActiveMessageBackend = strOriginalBackend;
			g_vecNativeCalls.length = unOriginalNativeCallCount;
		}
	}
}

VerifyProtobufWriterDocumentation();

g_vecNativeCalls.length = g_unMessagesBaseDocumentationCallIndex;

const g_strMessageColorsDocumentation = g_FileSystem.readFileSync(g_strMessageColorsDocumentationPath, "utf8");
const g_vecMessageColorsDocumentationJavaScriptBlocks = [];
for (const vecDocumentationBlockMatch of g_strMessageColorsDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)) {
	g_vecMessageColorsDocumentationJavaScriptBlocks.push(vecDocumentationBlockMatch[1]);
}

const g_vecMessageColorsExportSectionMatch = g_strMessageColorsDocumentation.match(/## Exports\r?\n([\s\S]*?)\r?\n## /);
const g_bMessageColorsDocumentationGenerated = g_strMessageColorsDocumentation.includes("Generated by");
const g_bMessageColorsDocumentationUsesConsole = g_strMessageColorsDocumentation.includes("console.");

g_Assert.notEqual(g_vecMessageColorsExportSectionMatch, null, "messages/colors documentation export section");

const g_vecMessageColorsDocumentedExportNames = [];
for (const vecDocumentedExportMatch of g_vecMessageColorsExportSectionMatch[1].matchAll(/^\| (?:\[)?`([^`]+)`(?:\]\(#[^)]*\))? \|/gm)) {
	g_vecMessageColorsDocumentedExportNames.push(vecDocumentedExportMatch[1]);
}

const g_vecMessageColorsNativeExportNames = Object.keys(g_MessageColors);

g_vecMessageColorsDocumentedExportNames.sort();
g_vecMessageColorsNativeExportNames.sort();

g_Assert.equal(g_bMessageColorsDocumentationGenerated, false, "messages/colors documentation generated marker");
g_Assert.equal(g_bMessageColorsDocumentationUsesConsole, false, "messages/colors documentation avoids console-only examples");
g_Assert.equal(g_vecMessageColorsDocumentationJavaScriptBlocks.length, 8, "messages/colors documentation JavaScript block count");
g_Assert.deepEqual(g_vecMessageColorsDocumentedExportNames, g_vecMessageColorsNativeExportNames, "messages/colors documented export inventory");

for (const vecDocumentationLinkMatch of g_strMessageColorsDocumentation.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
	const strDocumentationLinkTarget = vecDocumentationLinkMatch[1].split("#", 1)[0];
	if ((strDocumentationLinkTarget.length > 0) && !/^[a-z]+:/i.test(strDocumentationLinkTarget)) {
		const strResolvedDocumentationLinkPath = g_Path.resolve(g_Path.dirname(g_strMessageColorsDocumentationPath), strDocumentationLinkTarget);
		g_Assert.equal(g_FileSystem.existsSync(strResolvedDocumentationLinkPath), true, `messages/colors documentation link: ${strDocumentationLinkTarget}`);
	}
}

const g_strMessageColorsDocumentationSource = g_vecMessageColorsDocumentationJavaScriptBlocks.join("\n");
for (const strMessageColorsExportName of g_vecMessageColorsNativeExportNames) {
	g_Assert.match(g_strMessageColorsDocumentationSource, new RegExp(`\\b${strMessageColorsExportName}\\b`), `messages/colors example for ${strMessageColorsExportName}`);
}

for (const strColorMemberName of Object.getOwnPropertyNames(g_MessageColors.MessageColor.prototype)) {
	if (strColorMemberName !== "constructor") {
		g_Assert.match(g_strMessageColorsDocumentation, new RegExp(`\\b${strColorMemberName}\\b`), `messages/colors documentation member MessageColor.${strColorMemberName}`);
	}
}

const g_RequireMessageColorsDocumentation = (strModuleName) => {
	switch (strModuleName) {
		case "messages":
			return g_MessagesBase;

		case "messages/colors":
			return g_MessageColors;

		default:
			throw new Error(`Unexpected messages/colors documentation dependency: ${strModuleName}`);
	}
};

const g_unMessageColorsDocumentationCallIndex = g_vecNativeCalls.length;

for (const [unDocumentationBlockIndex, strDocumentationBlock] of g_vecMessageColorsDocumentationJavaScriptBlocks.entries()) {
	const strDocumentationLabel = `messages-colors.md:block-${unDocumentationBlockIndex + 1}`;
	const MessageColorsDocumentationBlock = g_VM.compileFunction("\"use strict\";\n" + strDocumentationBlock, ["require"], { filename: strDocumentationLabel });

	const ExecuteMessageColorsDocumentationBlock = () => RunMessageDocumentationOperation(MessageColorsDocumentationBlock, [g_RequireMessageColorsDocumentation], strDocumentationLabel);

	g_Assert.doesNotThrow(ExecuteMessageColorsDocumentationBlock, `messages/colors documentation block ${unDocumentationBlockIndex + 1} execution`);
}

const g_vecMessageColorsDocumentationNativeCalls = g_vecNativeCalls.slice(g_unMessageColorsDocumentationCallIndex);
const g_vecMessageColorsDocumentationSayText2Calls = [];
const g_vecMessageColorsDocumentationRecipientIndexes = [];
for (const vecMessageColorsDocumentationNativeCall of g_vecMessageColorsDocumentationNativeCalls) {
	if ((vecMessageColorsDocumentationNativeCall[0] === "SendUserMessage") && (vecMessageColorsDocumentationNativeCall[1] === "SayText2")) {
		g_vecMessageColorsDocumentationSayText2Calls.push(vecMessageColorsDocumentationNativeCall);

		for (const unRecipientIndex of vecMessageColorsDocumentationNativeCall[2]) {
			g_vecMessageColorsDocumentationRecipientIndexes.push(unRecipientIndex);
		}
	}
}

g_vecMessageColorsDocumentationRecipientIndexes.sort();

g_Assert.equal(g_vecMessageColorsDocumentationNativeCalls.length, 2, "messages/colors documentation native call count");
g_Assert.equal(g_vecMessageColorsDocumentationSayText2Calls.length, 2, "messages/colors documentation language-grouped SayText2 send count");
g_Assert.deepEqual(g_vecMessageColorsDocumentationRecipientIndexes, [1, 2], "messages/colors documentation SayText2 recipients");

for (const vecMessageColorsDocumentationSayText2Call of g_vecMessageColorsDocumentationSayText2Calls) {
	g_Assert.deepEqual(vecMessageColorsDocumentationSayText2Call[3][0], { Type: "byte", Value: 0x01 }, "messages/colors documentation SenderIndex");
	g_Assert.deepEqual(vecMessageColorsDocumentationSayText2Call[3][1], { Type: "byte", Value: 0x01 }, "messages/colors documentation Chat");
	g_Assert.equal(vecMessageColorsDocumentationSayText2Call[3][2].Value, "\x01\x04[Join]\x01 \x03Ren\x01 connected.", "messages/colors documentation SayText2 body");
	g_Assert.equal(vecMessageColorsDocumentationSayText2Call[4], true, "messages/colors documentation SayText2 reliability");
}

g_Assert.equal(Object.hasOwn(g_MessageColors, "saytext2"), false, "messages/colors has no submodule alias");

function VerifyMessageColorPaletteDocumentation(strExample, ColorModule) {
	const ExecutePalette = g_VM.compileFunction("\"use strict\";\n" + strExample, ["require"]);
	const vecColorNames = ["GREEN", "LIGHT_GREEN", "NORMAL", "OLIVE", "TEAM"];

	const RunPalette = Palette => {
		const RequireColors = strName => {
			g_Assert.equal(strName, "messages/colors");

			return Palette;
		};

		return RunMessageDocumentationOperation(ExecutePalette, [RequireColors], "Common color palette documentation");
	};

	let unCaseCount = 1;

	RunPalette(ColorModule);

	for (const strColorName of vecColorNames) {
		for (const strOtherColorName of vecColorNames) {
			if (strColorName === strOtherColorName) {
				continue;
			}

			const Palette = { ...ColorModule, [strColorName]: ColorModule[strOtherColorName] };
			g_Assert.throws(() => RunPalette(Palette), Error, "palette example checks every export even when two values collide");
			unCaseCount++;
		}

		for (const InvalidColorCode of [
			undefined,
			null,
			0,
			false,
			"",
			"X",
			"\x00",
			"\x02",
			"\x07",
		]) {
			const Palette = { ...ColorModule, [strColorName]: InvalidColorCode };
			g_Assert.throws(() => RunPalette(Palette), Error, "palette example rejects invalid export values");
			unCaseCount++;
		}
	}

	g_Assert.equal(unCaseCount, 66);

	return unCaseCount;
}

g_Assert.equal(VerifyMessageColorPaletteDocumentation(g_vecMessageColorsDocumentationJavaScriptBlocks[1], g_MessageColors), 66);

function VerifyMessageColorImplementationContracts(ColorModule) {
	const { ColorizeMessageText, GREEN, MessageColor, StripMessageColorCodes } = ColorModule;
	const NormalDescriptor = Object.getOwnPropertyDescriptor(ColorModule, "NORMAL");
	g_Assert.equal(ColorModule, globalThis.sourcejs["messages/colors"], "package augments the same live runtime object");

	try {
		Object.defineProperty(ColorModule, "NORMAL", { configurable: true, enumerable: NormalDescriptor.enumerable, writable: true, value: "\x03" });
		g_Assert.equal(ColorizeMessageText("Text", GREEN), `${GREEN}Text\x03`, "module helper reads live NORMAL");
		g_Assert.equal(ColorizeMessageText("Text"), "\x03Text\x03", "default prefix reads live NORMAL");
		g_Assert.equal(new MessageColor(GREEN).ColorizeMessageText("Text"), `${GREEN}Text\x03`, "instance helper reads live NORMAL");

		const vecInvalidNormalValues = [
			undefined,
			null,
			"",
			false,
			0,
			0n,
			[],
			{},
		];
		for (const InvalidNormal of vecInvalidNormalValues) {
			ColorModule.NORMAL = InvalidNormal;
			g_Assert.throws(() => ColorizeMessageText("Text", GREEN), (CaughtError) => CaughtError.constructor === TypeError, "module helper validates reset");
			g_Assert.throws(() => ColorizeMessageText("Text"), (CaughtError) => CaughtError.constructor === TypeError, "module helper validates default prefix");
			g_Assert.throws(() => new MessageColor(GREEN).ColorizeMessageText("Text"), (CaughtError) => CaughtError.constructor === TypeError, "instance helper validates reset");
		}

		let unNormalReadCount = 0;
		Object.defineProperty(ColorModule, "NORMAL", {
			configurable: true,
			enumerable: NormalDescriptor.enumerable,

			get() {
				unNormalReadCount += 1;

				return (unNormalReadCount === 1) ? "\x03" : "\x04";
			},
		});

		g_Assert.equal(ColorizeMessageText("Text"), "\x03Text\x04", "default prefix and reset are separate reads");
		g_Assert.equal(unNormalReadCount, 2, "default prefix and reset each read NORMAL once");

		unNormalReadCount = 0;
		g_Assert.equal(ColorizeMessageText("Text", GREEN), `${GREEN}Text\x03`, "explicit prefix does not read NORMAL for a default");
		g_Assert.equal(unNormalReadCount, 1, "explicit prefix only reads the reset");
	} finally {
		Object.defineProperty(ColorModule, "NORMAL", NormalDescriptor);
	}

	const MutableMessageColor = new MessageColor(GREEN);
	MutableMessageColor.ColorCode = "Prefix\x03\x04";
	g_Assert.equal(MutableMessageColor.toString(), "Prefix\x03\x04", "toString reads the updated arbitrary non-empty prefix");
	g_Assert.equal(MutableMessageColor.ColorizeMessageText("Text"), "Prefix\x03\x04Text\x01", "instance reads updated prefix");
	g_Assert.equal(ColorizeMessageText("Text", MutableMessageColor), "Prefix\x03\x04Text\x01", "module helper reads updated prefix");

	const vecInvalidColorValues = [
		undefined,
		null,
		"",
		false,
		0,
		0n,
		[],
		{},
	];
	for (const InvalidColorCode of vecInvalidColorValues) {
		MutableMessageColor.ColorCode = InvalidColorCode;
		g_Assert.throws(() => MutableMessageColor.toString(), (CaughtError) => CaughtError.constructor === TypeError, "toString validates current ColorCode");
		g_Assert.throws(() => ColorizeMessageText("Text", MutableMessageColor), (CaughtError) => CaughtError.constructor === TypeError, "module helper validates current ColorCode");
		g_Assert.equal(MutableMessageColor.ColorizeMessageText("Text"), `${InvalidColorCode}Text\x01`, "instance interpolation does not revalidate ColorCode");
		g_Assert.throws(() => new MessageColor(InvalidColorCode), (CaughtError) => CaughtError.constructor === TypeError, "constructor requires a non-empty prefix");
	}

	const vecInvalidMessageValues = [
		undefined,
		null,
		"",
		false,
		0,
		0n,
		[],
		{},
	];
	for (const InvalidMessageText of vecInvalidMessageValues) {
		g_Assert.throws(() => ColorizeMessageText(InvalidMessageText, GREEN), (CaughtError) => CaughtError.constructor === TypeError, "module colorization requires non-empty message text");
		g_Assert.throws(() => new MessageColor(GREEN).ColorizeMessageText(InvalidMessageText), (CaughtError) => CaughtError.constructor === TypeError, "instance colorization requires non-empty message text");

		if (InvalidMessageText !== "") {
			g_Assert.throws(() => StripMessageColorCodes(InvalidMessageText), (CaughtError) => CaughtError.constructor === TypeError, "strip rejects non-string input");
		}
	}

	let strControlRange = "";
	for (let unControlCode = 0x01; unControlCode <= 0x06; unControlCode += 1) {
		strControlRange += String.fromCharCode(unControlCode);
	}

	const strTextWithControls = "A\x00" + strControlRange + "Ω🎮\x07\n\r\tZ";
	g_Assert.equal(StripMessageColorCodes(strTextWithControls), "A\x00Ω🎮\x07\n\r\tZ", "strip removes all six controls and preserves NUL/Unicode/outside range");
	g_Assert.equal(StripMessageColorCodes(""), "", "strip accepts empty text");
	g_Assert.deepEqual(Object.getOwnPropertyDescriptor(ColorModule, "NORMAL"), NormalDescriptor, "live palette descriptor restored after focused contract tests");
}

VerifyMessageColorImplementationContracts(g_MessageColors);

g_vecNativeCalls.length = g_unMessageColorsDocumentationCallIndex;

const g_strSayText2ColorsDocumentation = g_FileSystem.readFileSync(g_strSayText2ColorsDocumentationPath, "utf8");
const g_vecSayText2ColorsDocumentationJavaScriptBlocks = [];
for (const vecDocumentationBlockMatch of g_strSayText2ColorsDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)) {
	g_vecSayText2ColorsDocumentationJavaScriptBlocks.push(vecDocumentationBlockMatch[1]);
}

const g_vecSayText2ColorsExportSectionMatch = g_strSayText2ColorsDocumentation.match(/## Exports\r?\n([\s\S]*?)\r?\n## /);
const g_bSayText2ColorsDocumentationGenerated = g_strSayText2ColorsDocumentation.includes("Generated by");
const g_bSayText2ColorsDocumentationUsesConsole = g_strSayText2ColorsDocumentation.includes("console.");

g_Assert.notEqual(g_vecSayText2ColorsExportSectionMatch, null, "messages/colors/saytext2 documentation export section");

const g_vecSayText2ColorsDocumentedExportNames = [];
for (const vecDocumentedExportMatch of g_vecSayText2ColorsExportSectionMatch[1].matchAll(/^\| (?:\[)?`([^`]+)`(?:\]\(#[^)]*\))? \|/gm)) {
	g_vecSayText2ColorsDocumentedExportNames.push(vecDocumentedExportMatch[1]);
}

const g_vecSayText2ColorsNativeExportNames = Object.keys(g_SayText2Colors);

g_vecSayText2ColorsDocumentedExportNames.sort();
g_vecSayText2ColorsNativeExportNames.sort();

g_Assert.equal(g_bSayText2ColorsDocumentationGenerated, false, "messages/colors/saytext2 documentation generated marker");
g_Assert.equal(g_bSayText2ColorsDocumentationUsesConsole, false, "messages/colors/saytext2 documentation avoids console-only examples");
g_Assert.equal(g_vecSayText2ColorsDocumentationJavaScriptBlocks.length, 7, "messages/colors/saytext2 documentation JavaScript block count");
g_Assert.deepEqual(g_vecSayText2ColorsDocumentedExportNames, g_vecSayText2ColorsNativeExportNames, "messages/colors/saytext2 documented export inventory");

for (const vecDocumentationLinkMatch of g_strSayText2ColorsDocumentation.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
	const strDocumentationLinkTarget = vecDocumentationLinkMatch[1].split("#", 1)[0];
	if ((strDocumentationLinkTarget.length > 0) && !/^[a-z]+:/i.test(strDocumentationLinkTarget)) {
		const strResolvedDocumentationLinkPath = g_Path.resolve(g_Path.dirname(g_strSayText2ColorsDocumentationPath), strDocumentationLinkTarget);
		g_Assert.equal(g_FileSystem.existsSync(strResolvedDocumentationLinkPath), true, `messages/colors/saytext2 documentation link: ${strDocumentationLinkTarget}`);
	}
}

const g_strSayText2ColorsDocumentationSource = g_vecSayText2ColorsDocumentationJavaScriptBlocks.join("\n");
for (const strSayText2ColorsExportName of g_vecSayText2ColorsNativeExportNames) {
	g_Assert.match(g_strSayText2ColorsDocumentationSource, new RegExp(`\\b${strSayText2ColorsExportName}\\b`), `messages/colors/saytext2 example for ${strSayText2ColorsExportName}`);
}

const g_RequireSayText2ColorsDocumentation = (strModuleName) => {
	switch (strModuleName) {
		case "messages":
			return g_MessagesBase;

		case "messages/colors/saytext2":
			return g_SayText2Colors;

		default:
			throw new Error(`Unexpected messages/colors/saytext2 documentation dependency: ${strModuleName}`);
	}
};

const g_unSayText2ColorsDocumentationCallIndex = g_vecNativeCalls.length;

for (const [unDocumentationBlockIndex, strDocumentationBlock] of g_vecSayText2ColorsDocumentationJavaScriptBlocks.entries()) {
	const strDocumentationLabel = `messages-colors-saytext2.md:block-${unDocumentationBlockIndex + 1}`;
	const SayText2ColorsDocumentationBlock = g_VM.compileFunction("\"use strict\";\n" + strDocumentationBlock, ["require"], { filename: strDocumentationLabel });

	const ExecuteSayText2ColorsDocumentationBlock = () => RunMessageDocumentationOperation(SayText2ColorsDocumentationBlock, [g_RequireSayText2ColorsDocumentation], strDocumentationLabel);

	g_Assert.doesNotThrow(ExecuteSayText2ColorsDocumentationBlock, `messages/colors/saytext2 documentation block ${unDocumentationBlockIndex + 1} execution`);
}

const g_vecSayText2ColorsDocumentationNativeCalls = g_vecNativeCalls.slice(g_unSayText2ColorsDocumentationCallIndex);
const g_vecSayText2ColorsDocumentationSayText2Calls = [];
const g_vecSayText2ColorsDocumentationRecipientIndexes = [];
for (const vecSayText2ColorsDocumentationNativeCall of g_vecSayText2ColorsDocumentationNativeCalls) {
	if ((vecSayText2ColorsDocumentationNativeCall[0] === "SendUserMessage") && (vecSayText2ColorsDocumentationNativeCall[1] === "SayText2")) {
		g_vecSayText2ColorsDocumentationSayText2Calls.push(vecSayText2ColorsDocumentationNativeCall);

		for (const unRecipientIndex of vecSayText2ColorsDocumentationNativeCall[2]) {
			g_vecSayText2ColorsDocumentationRecipientIndexes.push(unRecipientIndex);
		}
	}
}

g_vecSayText2ColorsDocumentationRecipientIndexes.sort();

g_Assert.equal(g_vecSayText2ColorsDocumentationNativeCalls.length, 2, "messages/colors/saytext2 documentation native call count");
g_Assert.equal(g_vecSayText2ColorsDocumentationSayText2Calls.length, 2, "messages/colors/saytext2 documentation language-grouped send count");
g_Assert.deepEqual(g_vecSayText2ColorsDocumentationRecipientIndexes, [1, 2], "messages/colors/saytext2 documentation recipients");

for (const vecSayText2ColorsDocumentationSayText2Call of g_vecSayText2ColorsDocumentationSayText2Calls) {
	g_Assert.deepEqual(vecSayText2ColorsDocumentationSayText2Call[3][0], { Type: "byte", Value: 0x01 }, "messages/colors/saytext2 documentation SenderIndex");
	g_Assert.deepEqual(vecSayText2ColorsDocumentationSayText2Call[3][1], { Type: "byte", Value: 0x01 }, "messages/colors/saytext2 documentation Chat");
	g_Assert.equal(vecSayText2ColorsDocumentationSayText2Call[3][2].Value, "\x01\x04[Status]\x01 \x03Ren\x01: \x10ready\x01", "messages/colors/saytext2 documentation body");
	g_Assert.equal(vecSayText2ColorsDocumentationSayText2Call[4], true, "messages/colors/saytext2 documentation reliability");
}

function VerifySayText2ColorImplementationContracts(ColorModule) {
	const { Apply, ColorizeSayText2MessageText, Strip, StripSayText2ColorCodes } = ColorModule;
	const WhiteDescriptor = Object.getOwnPropertyDescriptor(ColorModule, "WHITE");
	g_Assert.equal(ColorModule, globalThis.sourcejs["messages/colors/saytext2"], "package augments the same live runtime object");

	try {
		Object.defineProperty(ColorModule, "WHITE", { configurable: true, enumerable: WhiteDescriptor.enumerable, writable: true, value: "\x03" });
		g_Assert.equal(ColorizeSayText2MessageText("Prefix", "Text"), "PrefixText\x03", "JavaScript helper reads live WHITE");
		g_Assert.equal(Apply("Prefix", "Text"), "PrefixText\x01", "native fixture uses compiled reset");

		const vecInvalidWhiteValues = [
			undefined,
			null,
			"",
			false,
			0,
			0n,
			[],
			{},
		];
		for (const InvalidWhite of vecInvalidWhiteValues) {
			ColorModule.WHITE = InvalidWhite;
			g_Assert.throws(() => ColorizeSayText2MessageText("Prefix", "Text"), (CaughtError) => CaughtError.constructor === TypeError, "JavaScript helper validates live WHITE");
			g_Assert.equal(Apply("Prefix", "Text"), "PrefixText\x01", "native fixture does not depend on live WHITE");
		}
	} finally {
		RestoreMessageSmokeProperty(ColorModule, "WHITE", WhiteDescriptor);
	}

	let strControlRange = "";
	for (let unControlCode = 0x01; unControlCode <= 0x10; unControlCode += 1) {
		strControlRange += String.fromCharCode(unControlCode);
	}

	const strTextWithControls = "A\x00" + strControlRange + "Ω🎮\x11\x7FZ";
	const strExpectedText = "A\x00Ω🎮\x11\x7FZ";
	g_Assert.equal(StripSayText2ColorCodes(strTextWithControls), strExpectedText, "JavaScript strips all sixteen controls and preserves NUL/Unicode/outside range");
	g_Assert.equal(Strip(strTextWithControls), strExpectedText, "native fixture strips all sixteen controls and preserves NUL/Unicode/outside range");
	g_Assert.equal(Apply("\x04\x10", "Ω🎮\x00"), "\x04\x10Ω🎮\x00\x01", "native fixture preserves composed prefix and explicit-length text");

	const vecInvalidCalls = [
		[() => ColorizeSayText2MessageText("", "Text"), TypeError],
		[() => ColorizeSayText2MessageText("Prefix", null), TypeError],
		[() => StripSayText2ColorCodes(null), TypeError],
		[() => Apply("", "Text"), Error],
		[() => Apply("Prefix", null), Error],
		[() => Strip(null), Error],
	];
	for (const vecInvalidCall of vecInvalidCalls) {
		const Call = vecInvalidCall[0];
		const ErrorType = vecInvalidCall[1];
		g_Assert.throws(Call, (CaughtError) => CaughtError.constructor === ErrorType, "JavaScript and native argument errors retain their distinct classes");
	}

	g_Assert.deepEqual(Object.getOwnPropertyDescriptor(ColorModule, "WHITE"), WhiteDescriptor, "live palette descriptor restored after focused contract tests");
}

VerifySayText2ColorImplementationContracts(g_SayText2Colors);

g_vecNativeCalls.length = g_unSayText2ColorsDocumentationCallIndex;

const g_strMessagesDialogDocumentation = g_FileSystem.readFileSync(g_strMessagesDialogDocumentationPath, "utf8");
const g_vecMessagesDialogDocumentationJavaScriptBlocks = [];
for (const vecDocumentationBlockMatch of g_strMessagesDialogDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)) {
	g_vecMessagesDialogDocumentationJavaScriptBlocks.push(vecDocumentationBlockMatch[1]);
}

const g_vecMessagesDialogExportSectionMatch = g_strMessagesDialogDocumentation.match(/## Exports\r?\n([\s\S]*?)\r?\n## /);
const g_bMessagesDialogDocumentationGenerated = g_strMessagesDialogDocumentation.includes("Generated by");
const g_bMessagesDialogDocumentationUsesConsole = g_strMessagesDialogDocumentation.includes("console.");

g_Assert.notEqual(g_vecMessagesDialogExportSectionMatch, null, "messages/dialog documentation export section");

const g_vecMessagesDialogDocumentedExportNames = [];
for (const vecDocumentedExportMatch of g_vecMessagesDialogExportSectionMatch[1].matchAll(/^\| (?:\[)?`([^`]+)`(?:\]\(#[^)]*\))? \|/gm)) {
	g_vecMessagesDialogDocumentedExportNames.push(vecDocumentedExportMatch[1]);
}

const g_vecMessagesDialogNativeExportNames = Object.keys(g_MessagesDialog);

g_vecMessagesDialogDocumentedExportNames.sort();
g_vecMessagesDialogNativeExportNames.sort();

g_Assert.equal(g_bMessagesDialogDocumentationGenerated, false, "messages/dialog documentation generated marker");
g_Assert.equal(g_bMessagesDialogDocumentationUsesConsole, false, "messages/dialog documentation avoids console-only examples");
g_Assert.equal(g_vecMessagesDialogDocumentationJavaScriptBlocks.length, 10, "messages/dialog documentation JavaScript block count");
g_Assert.deepEqual(g_vecMessagesDialogDocumentedExportNames, g_vecMessagesDialogNativeExportNames, "messages/dialog documented export inventory");

for (const vecDocumentationLinkMatch of g_strMessagesDialogDocumentation.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
	const strDocumentationLinkTarget = vecDocumentationLinkMatch[1].split("#", 1)[0];
	if ((strDocumentationLinkTarget.length > 0) && !/^[a-z]+:/i.test(strDocumentationLinkTarget)) {
		const strResolvedDocumentationLinkPath = g_Path.resolve(g_Path.dirname(g_strMessagesDialogDocumentationPath), strDocumentationLinkTarget);
		g_Assert.equal(g_FileSystem.existsSync(strResolvedDocumentationLinkPath), true, `messages/dialog documentation link: ${strDocumentationLinkTarget}`);
	}
}

const g_strMessagesDialogDocumentationSource = g_vecMessagesDialogDocumentationJavaScriptBlocks.join("\n");
for (const strMessagesDialogExportName of g_vecMessagesDialogNativeExportNames) {
	g_Assert.match(g_strMessagesDialogDocumentationSource, new RegExp(`\\b${strMessagesDialogExportName}\\b`), `messages/dialog example for ${strMessagesDialogExportName}`);
}

const g_vecMessagesDialogConstructorNames = Object.freeze([
	"DialogAskConnect",
	"DialogBase",
	"DialogEntry",
	"DialogMenu",
	"DialogNotification",
	"DialogText",
]);
for (const strDialogConstructorName of g_vecMessagesDialogConstructorNames) {
	const DialogPrototype = g_MessagesDialog[strDialogConstructorName].prototype;
	for (const strDialogMemberName of Object.getOwnPropertyNames(DialogPrototype)) {
		if (strDialogMemberName !== "constructor") {
			g_Assert.match(g_strMessagesDialogDocumentation, new RegExp(`\\b${strDialogMemberName}\\b`), `messages/dialog documentation member ${strDialogConstructorName}.${strDialogMemberName}`);
		}
	}
}

const g_mapMessagesDialogDocumentationCommandCallbacks = new Map();
const g_MessagesDialogCommandsDocumentationModule = {
	HANDLED: 1,
};

class DocumentationCommand {
	constructor(NativePayload) {
		this.m_vecArguments = NativePayload.Arguments.slice();
		this.m_nIndex = NativePayload.Index;
	}

	get Arguments() {
		return this.m_vecArguments.slice();
	}

	get Index() {
		return this.m_nIndex;
	}

	GetArgument(unIndex) {
		return this.m_vecArguments[unIndex];
	}
}

g_MessagesDialogCommandsDocumentationModule.Command = DocumentationCommand;

const g_MessagesDialogClientCommandsDocumentationModule = {
	RegisterCommand(strCommandName, CommandCallback) {
		g_Assert.equal(typeof strCommandName, "string", "messages/dialog documentation command name");
		g_Assert.equal(typeof CommandCallback, "function", "messages/dialog documentation command callback");
		g_Assert.equal(g_mapMessagesDialogDocumentationCommandCallbacks.has(strCommandName), false, `messages/dialog duplicate documentation command ${strCommandName}`);

		g_mapMessagesDialogDocumentationCommandCallbacks.set(strCommandName, CommandCallback);

		return true;
	},

	UnregisterCommand(strCommandName, CommandCallback = null) {
		if (!g_mapMessagesDialogDocumentationCommandCallbacks.has(strCommandName)) {
			return false;
		}

		const RegisteredCommandCallback = g_mapMessagesDialogDocumentationCommandCallbacks.get(strCommandName);
		if ((CommandCallback !== null) && (RegisteredCommandCallback !== CommandCallback)) {
			return false;
		}

		g_mapMessagesDialogDocumentationCommandCallbacks.delete(strCommandName);

		return true;
	},
};

const g_RequireMessagesDialogDocumentation = (strModuleName) => {
	switch (strModuleName) {
		case "commands":
			return g_MessagesDialogCommandsDocumentationModule;

		case "commands/client":
			return g_MessagesDialogClientCommandsDocumentationModule;

		case "messages/dialog":
			return g_MessagesDialog;

		default:
			throw new Error(`Unexpected messages/dialog documentation dependency: ${strModuleName}`);
	}
};

const g_unMessagesDialogDocumentationCallIndex = g_vecNativeCalls.length;

function RunMessageDocumentationScenario(Operation, Cleanup, strScenarioLabel) {
	let bPrimaryThrown = false;
	let PrimaryError = undefined;

	try {
		return RunMessageDocumentationOperation(Operation, [], strScenarioLabel);
	} catch (CaughtError) {
		bPrimaryThrown = true;
		PrimaryError = CaughtError;
		throw CaughtError;
	} finally {
		try {
			RunMessageDocumentationOperation(Cleanup, [], strScenarioLabel + ":cleanup");
		} catch (CleanupError) {
			if (bPrimaryThrown) {
				throw new AggregateError([PrimaryError, CleanupError], "Message documentation verification and cleanup both failed.");
			}

			throw CleanupError;
		}
	}
}

function SetMessageSmokeProperty(Target, strName, Value) {
	const Descriptor = Object.getOwnPropertyDescriptor(Target, strName);
	Object.defineProperty(Target, strName, { configurable: true, enumerable: Descriptor?.enumerable ?? true, writable: true, value: Value });
}

let g_unMessagesDialogDocumentationValidCommandInvocations = 0;

for (const [unDocumentationBlockIndex, strDocumentationBlock] of g_vecMessagesDialogDocumentationJavaScriptBlocks.entries()) {
	const strDocumentationLabel = `messages-dialog.md:block-${unDocumentationBlockIndex + 1}`;
	const strCommandStateInspection = 'return { LoadoutNames: (typeof g_mapLoadoutNames === "undefined") ? null : g_mapLoadoutNames, SelectedLoadouts: (typeof g_mapSelectedLoadouts === "undefined") ? null : g_mapSelectedLoadouts, SelectedWeapons: (typeof g_mapSelectedWeapons === "undefined") ? null : g_mapSelectedWeapons };';
	const MessagesDialogDocumentationBlock = g_VM.compileFunction("\"use strict\";\n" + [strDocumentationBlock, strCommandStateInspection].join("\n"), ["require", "exports"], { filename: strDocumentationLabel });
	const MessagesDialogDocumentationExports = {};

	const ExecuteMessagesDialogDocumentationBlock = () => {
		const CommandState = MessagesDialogDocumentationBlock(g_RequireMessagesDialogDocumentation, MessagesDialogDocumentationExports);
		g_Assert.equal(Object.hasOwn(MessagesDialogDocumentationExports, "unload"), false, "Dialog documentation must not export the obsolete lowercase lifecycle.");

		if (g_mapMessagesDialogDocumentationCommandCallbacks.size > 0) {
			g_Assert.equal(typeof MessagesDialogDocumentationExports.Unload, "function", "Interactive dialog documentation must publish canonical cleanup.");
		}

		for (const [strCommandName, CommandCallback] of g_mapMessagesDialogDocumentationCommandCallbacks) {
			const strCommandArgument = ((strCommandName === "sjs_choose_loadout") || (strCommandName === "sjs_choose_weapon")) ? "rifle" : "Assault";
			const mapCommandValues = (strCommandName === "sjs_choose_loadout") ? CommandState.SelectedLoadouts : ((strCommandName === "sjs_choose_weapon") ? CommandState.SelectedWeapons : CommandState.LoadoutNames);
			g_Assert.ok(mapCommandValues instanceof Map, `messages/dialog documentation command state ${strCommandName}`);

			for (const nInvalidClientIndex of [-1, 0, 1.5]) {
				const InvalidClientCommand = { Arguments: [strCommandName, strCommandArgument], Index: nInvalidClientIndex, Kind: "client", Message: "", Name: strCommandName, Raw: `${strCommandName} ${strCommandArgument}`, TeamOnly: false };
				g_Assert.equal(CommandCallback(InvalidClientCommand), g_MessagesDialogCommandsDocumentationModule.HANDLED, `messages/dialog documentation rejects client index ${nInvalidClientIndex}`);
				g_Assert.equal(mapCommandValues.has(nInvalidClientIndex), false, `messages/dialog documentation does not store invalid client index ${nInvalidClientIndex}`);
			}

			const unValidClientIndex = 1;
			const ClientCommand = { Arguments: [strCommandName, strCommandArgument], Index: unValidClientIndex, Kind: "client", Message: "", Name: strCommandName, Raw: `${strCommandName} ${strCommandArgument}`, TeamOnly: false };
			g_Assert.equal(CommandCallback(ClientCommand), g_MessagesDialogCommandsDocumentationModule.HANDLED, `messages/dialog documentation command result ${strCommandName}`);
			g_Assert.equal(mapCommandValues.get(unValidClientIndex), strCommandArgument, `messages/dialog documentation stores the valid client command ${strCommandName}`);
			g_unMessagesDialogDocumentationValidCommandInvocations += 1;
		}

		if (typeof MessagesDialogDocumentationExports.Unload === "function") {
			g_Assert.equal(MessagesDialogDocumentationExports.Unload(), true, `messages/dialog documentation command cleanup ${unDocumentationBlockIndex + 1}`);

			for (const State of Object.values(CommandState)) {
				if (State instanceof Map) {
					g_Assert.equal(State.size, 0, "interactive documentation state cleared on unload");
				}
			}

			g_Assert.equal(MessagesDialogDocumentationExports.Unload(), true, "interactive documentation unload is idempotent");
		}
	};

	const CleanupMessagesDialogDocumentation = () => {
		if (typeof MessagesDialogDocumentationExports.Unload === "function") {
			MessagesDialogDocumentationExports.Unload();
		}
	};

	g_Assert.doesNotThrow(() => RunMessageDocumentationScenario(ExecuteMessagesDialogDocumentationBlock, CleanupMessagesDialogDocumentation, strDocumentationLabel), `${strDocumentationLabel} execution`);
}

const g_vecMessagesDialogDocumentationNativeCalls = g_vecNativeCalls.slice(g_unMessagesDialogDocumentationCallIndex);
const g_vecMessagesDialogDocumentationCreateCalls = [];
let g_unMessagesDialogDocumentationLocalizedCreateCallCount = 0;
let g_vecMessagesDialogDocumentationLoadoutCreateCall = undefined;
let g_vecMessagesDialogDocumentationEnglishLocalizedCreateCall = undefined;
let g_vecMessagesDialogDocumentationRussianLocalizedCreateCall = undefined;
let g_bMessagesDialogDocumentationFakeClientCallFound = false;
let g_bMessagesDialogDocumentationCustomPayloadCallFound = false;
let g_bMessagesDialogDocumentationAskConnectPayloadCallFound = false;
for (const vecMessagesDialogDocumentationNativeCall of g_vecMessagesDialogDocumentationNativeCalls) {
	if (vecMessagesDialogDocumentationNativeCall[0] !== "CreateDialog") {
		continue;
	}

	g_vecMessagesDialogDocumentationCreateCalls.push(vecMessagesDialogDocumentationNativeCall);

	const unDialogClientIndex = vecMessagesDialogDocumentationNativeCall[1];
	const DialogPayload = vecMessagesDialogDocumentationNativeCall[3];
	const strDialogType = vecMessagesDialogDocumentationNativeCall[4];
	const strDialogTitle = DialogPayload.Title;
	g_Assert.ok(Number.isSafeInteger(DialogPayload.Time) && (DialogPayload.Time >= 10) && (DialogPayload.Time <= 200), "dialog examples use the documented SDK display-time range");

	if (unDialogClientIndex === 3) {
		g_bMessagesDialogDocumentationFakeClientCallFound = true;
	}

	if ((strDialogTitle === "Wave 6") || (strDialogTitle === "Volna 6")) {
		g_unMessagesDialogDocumentationLocalizedCreateCallCount += 1;

		if ((unDialogClientIndex === 1) && (g_vecMessagesDialogDocumentationEnglishLocalizedCreateCall === undefined)) {
			g_vecMessagesDialogDocumentationEnglishLocalizedCreateCall = vecMessagesDialogDocumentationNativeCall;
		}

		if ((unDialogClientIndex === 2) && (g_vecMessagesDialogDocumentationRussianLocalizedCreateCall === undefined)) {
			g_vecMessagesDialogDocumentationRussianLocalizedCreateCall = vecMessagesDialogDocumentationNativeCall;
		}
	}

	if ((strDialogTitle === "Choose loadout") && (g_vecMessagesDialogDocumentationLoadoutCreateCall === undefined)) {
		g_vecMessagesDialogDocumentationLoadoutCreateCall = vecMessagesDialogDocumentationNativeCall;
	}

	if ((strDialogType === "objective") && (DialogPayload.Msg === "Reach the extraction point")) {
		g_bMessagesDialogDocumentationCustomPayloadCallFound = true;
	}

	if ((strDialogType === "askconnect") && (strDialogTitle === "203.0.113.10:27015")) {
		g_bMessagesDialogDocumentationAskConnectPayloadCallFound = true;
	}
}

g_Assert.equal(g_mapMessagesDialogDocumentationCommandCallbacks.size, 0, "messages/dialog documentation command registrations cleaned");
g_Assert.equal(g_unMessagesDialogDocumentationValidCommandInvocations, 3, "messages/dialog documentation valid command invocation count");
g_Assert.equal(g_vecMessagesDialogDocumentationNativeCalls.length, 10, "messages/dialog documentation native call count");
g_Assert.equal(g_vecMessagesDialogDocumentationCreateCalls.length, 10, "messages/dialog documentation CreateDialog call count");
g_Assert.equal(g_bMessagesDialogDocumentationFakeClientCallFound, false, "messages/dialog documentation skips fake clients");
g_Assert.equal(g_unMessagesDialogDocumentationLocalizedCreateCallCount, 2, "messages/dialog documentation per-language send count");
g_Assert.notEqual(g_vecMessagesDialogDocumentationEnglishLocalizedCreateCall, undefined, "messages/dialog English menu call");
g_Assert.notEqual(g_vecMessagesDialogDocumentationRussianLocalizedCreateCall, undefined, "messages/dialog Russian menu call");
g_Assert.notEqual(g_vecMessagesDialogDocumentationLoadoutCreateCall, undefined, "messages/dialog client command call");
g_Assert.equal(g_vecMessagesDialogDocumentationEnglishLocalizedCreateCall[3].rifle.Msg, "Rifle", "messages/dialog English menu option");
g_Assert.equal(g_vecMessagesDialogDocumentationRussianLocalizedCreateCall[3].rifle.Msg, "Vintovka", "messages/dialog Russian menu option");
g_Assert.equal(g_vecMessagesDialogDocumentationLoadoutCreateCall[3].rifle.Command, "sjs_choose_loadout rifle", "messages/dialog client command payload");
g_Assert.equal(g_bMessagesDialogDocumentationCustomPayloadCallFound, true, "messages/dialog custom payload");
g_Assert.equal(g_bMessagesDialogDocumentationAskConnectPayloadCallFound, true, "messages/dialog AskConnect payload");

function VerifyDialogDocumentationStartupOwnership(vecDocumentationBlocks) {
	const NativeMessages = globalThis.sourcejs.messages;
	const CreateDialogDescriptor = Object.getOwnPropertyDescriptor(NativeMessages, "CreateDialog");
	const CreateDialog = NativeMessages.CreateDialog;
	const mapOriginalCommandCallbacks = new Map(g_mapMessagesDialogDocumentationCommandCallbacks);
	const unOriginalCallCount = g_vecNativeCalls.length;
	const vecScenarios = [
		{ ClassName: "DialogEntry", CommandName: "sjs_loadout_name", FlagName: "g_bLoadoutNameCommandRegistered", MapName: "g_mapLoadoutNames" },
		{ ClassName: "DialogMenu", CommandName: "sjs_choose_loadout", FlagName: "g_bLoadoutSelectionCommandRegistered", MapName: "g_mapSelectedLoadouts" },
		{ ClassName: "DialogMenu", CommandName: "sjs_choose_weapon", FlagName: "g_bWeaponCommandRegistered", MapName: "g_mapSelectedWeapons" },
	];
	const vecFailureModes = [
		"CONSTRUCTOR",
		"TRANSLATION",
		"BUILD",
		"FALSE",
		"THROW",
		"UNREGISTERFALSE",
		"UNREGISTERTHROW",
		"REGISTERFALSE",
		"REGISTERTHROW",
	];

	try {
		for (const Scenario of vecScenarios) {
			const strRegistrationMarker = `if (RegisterCommand("${Scenario.CommandName}",`;
			const vecMatchingBlocks = vecDocumentationBlocks.filter((strBlock) => strBlock.includes(strRegistrationMarker));
			g_Assert.equal(vecMatchingBlocks.length, 1, "one owned interactive example per command");

			const strBlock = vecMatchingBlocks[0];
			const unRegistrationOffset = strBlock.indexOf(strRegistrationMarker);
			// Preserve example bytes inside the observation wrapper; reindenting arbitrary source could change multiline literals.
			const strObservedBlock = strBlock.slice(0, unRegistrationOffset) + "\ntry {\n" + strBlock.slice(unRegistrationOffset) + `\n} finally {\nObserveState({ Registered: ${Scenario.FlagName}, State: ${Scenario.MapName} });\n}\n`;
			const strDocumentationLabel = `messages-dialog.md:startup-${Scenario.CommandName}`;

			const Execute = g_VM.compileFunction("\"use strict\";\n" + strObservedBlock, ["require", "exports", "ObserveState"], { filename: strDocumentationLabel });
			const DialogClass = g_MessagesDialog[Scenario.ClassName];

			for (const strFailureMode of vecFailureModes) {
				const FailureError = new Error("dialog startup failure " + strFailureMode);
				const CleanupError = new Error("dialog cleanup failure");
				const ExistingCallback = () => g_MessagesDialogCommandsDocumentationModule.HANDLED;
				const PluginExports = {};
				let ObservedState = null;
				let ReceivedError = null;
				let unNativeAttempts = 0;
				let unCleanupAttempts = 0;
				let bRetryCleanup = false;
				const bRegisterFailure = strFailureMode.startsWith("REGISTER");
				const bCleanupFailure = strFailureMode.startsWith("UNREGISTER");

				class FailureDialog extends DialogClass {
					constructor(...vecArguments) {
						super(...vecArguments);

						if (strFailureMode === "CONSTRUCTOR") {
							throw FailureError;
						}
					}

					TranslateMessageFields(strLanguageCode = null, TranslationTokens = {}) {
						if (strFailureMode === "TRANSLATION") {
							throw FailureError;
						}

						return super.TranslateMessageFields(strLanguageCode, TranslationTokens);
					}

					BuildDialogValues(unPlayerIndex, DialogFields) {
						if (strFailureMode === "BUILD") {
							throw FailureError;
						}

						return super.BuildDialogValues(unPlayerIndex, DialogFields);
					}
				}

				const DialogFacade = { ...g_MessagesDialog, [Scenario.ClassName]: FailureDialog };
				const Commands = {
					RegisterCommand(strCommandName, Callback) {
						if (strFailureMode === "REGISTERFALSE") {
							g_mapMessagesDialogDocumentationCommandCallbacks.set(strCommandName, ExistingCallback);
							return false;
						}

						if (strFailureMode === "REGISTERTHROW") {
							throw FailureError;
						}

						const bRegistered = g_MessagesDialogClientCommandsDocumentationModule.RegisterCommand(strCommandName, Callback);
						const strArgument = (strCommandName === "sjs_loadout_name") ? "Assault" : "rifle";
						// Populate owned state so a later startup failure must actually clear it.
						g_Assert.equal(Callback({ Arguments: [strCommandName, strArgument], Index: 1 }), g_MessagesDialogCommandsDocumentationModule.HANDLED, "registered callback populates owned state");

						return bRegistered;
					},

					UnregisterCommand(strCommandName, Callback) {
						unCleanupAttempts += 1;

						if (!bRetryCleanup && (strFailureMode === "UNREGISTERFALSE")) {
							return false;
						}

						if (!bRetryCleanup && (strFailureMode === "UNREGISTERTHROW")) {
							throw CleanupError;
						}

						return g_MessagesDialogClientCommandsDocumentationModule.UnregisterCommand(strCommandName, Callback);
					},
				};

				const Require = (strModuleName) => {
					if (strModuleName === "messages/dialog") {
						return DialogFacade;
					}

					if (strModuleName === "commands/client") {
						return Commands;
					}

					return g_RequireMessagesDialogDocumentation(strModuleName);
				};

				const ObserveState = (State) => {
					ObservedState = State;
				};

				SetMessageSmokeProperty(NativeMessages, "CreateDialog", (...vecArguments) => {
					unNativeAttempts += 1;

					if (strFailureMode === "THROW") {
						throw FailureError;
					}

					Reflect.apply(CreateDialog, NativeMessages, vecArguments);

					return false;
				});

				const VerifyStartupFailure = () => {
					try {
						RunMessageDocumentationOperation(Execute, [Require, PluginExports, ObserveState], strDocumentationLabel + ":" + strFailureMode);
					} catch (CaughtError) {
						ReceivedError = CaughtError;
					}

					g_Assert.ok(ReceivedError instanceof Error, "failed startup propagates an error");
					g_Assert.equal(Object.hasOwn(PluginExports, "unload"), false, "Failed dialog startup must not retain the obsolete lowercase lifecycle.");
					g_Assert.equal(typeof PluginExports.Unload, "function", "Failed dialog startup must retain canonical cleanup.");
					g_Assert.notEqual(ObservedState, null, "observe the actual example's state");
					g_Assert.equal(ObservedState.State.size, 0, "failed startup leaves no selection state");

					if (bCleanupFailure) {
						g_Assert.equal(ReceivedError.constructor, AggregateError, "preserve startup and cleanup errors");
						g_Assert.equal(ReceivedError.errors.length, 2, "both failures retained");
						g_Assert.match(ReceivedError.errors[0].message, /SendMessage/);

						if (strFailureMode === "UNREGISTERTHROW") {
							g_Assert.equal(ReceivedError.errors[1], CleanupError, "cleanup error identity");
						}

						g_Assert.equal(ObservedState.Registered, true, "failed unregister retains retry ownership");
						g_Assert.equal(g_mapMessagesDialogDocumentationCommandCallbacks.size, 1, "failed unregister keeps callback");

					} else {
						g_Assert.equal(ObservedState.Registered, false, "failed startup no longer owns a command");
						g_Assert.equal(g_mapMessagesDialogDocumentationCommandCallbacks.size, (strFailureMode === "REGISTERFALSE") ? 1 : 0, "registered callback cleanup");
					}

					if (["CONSTRUCTOR", "TRANSLATION", "BUILD", "THROW", "REGISTERTHROW"].includes(strFailureMode)) {
						g_Assert.equal(ReceivedError, FailureError, "original startup error identity");
					}

					const unExpectedNativeAttempts = (strFailureMode === "THROW") ? 1 : (((strFailureMode === "FALSE") || bCleanupFailure) ? ((Scenario.CommandName === "sjs_choose_weapon") ? 2 : 1) : 0);
					g_Assert.equal(unNativeAttempts, unExpectedNativeAttempts, "false continues human recipients; throw stops; earlier failures never send");
					g_Assert.equal(unCleanupAttempts, bRegisterFailure ? 0 : 1, "only an acquired command is cleaned");
					bRetryCleanup = true;
					g_Assert.equal(RunMessageDocumentationOperation(() => PluginExports.Unload(), [], strDocumentationLabel + ":retry-cleanup"), true, "retry or idempotent unload succeeds");

					const unCleanupAttemptsAfterUnload = unCleanupAttempts;
					g_Assert.equal(RunMessageDocumentationOperation(() => PluginExports.Unload(), [], strDocumentationLabel + ":repeat-cleanup"), true, "second unload is harmless");
					g_Assert.equal(unCleanupAttempts, unCleanupAttemptsAfterUnload, "successful cleanup never unregisters twice");

					if (strFailureMode === "REGISTERFALSE") {
						g_Assert.equal(g_mapMessagesDialogDocumentationCommandCallbacks.get(Scenario.CommandName), ExistingCallback, "unacquired existing callback is preserved");

					} else {
						g_Assert.equal(g_mapMessagesDialogDocumentationCommandCallbacks.size, 0, "all acquired callbacks removed");
					}

					g_mapMessagesDialogDocumentationCommandCallbacks.clear();
				};

				const CleanupStartupFailure = () => {
					bRetryCleanup = true;

					if (typeof PluginExports.Unload === "function") {
						PluginExports.Unload();
					}
				};

				RunMessageDocumentationScenario(VerifyStartupFailure, CleanupStartupFailure, strDocumentationLabel + ":" + strFailureMode);
			}
		}
	} finally {
		RestoreMessageSmokeProperty(NativeMessages, "CreateDialog", CreateDialogDescriptor);
		g_mapMessagesDialogDocumentationCommandCallbacks.clear();
		for (const [strCommandName, Callback] of mapOriginalCommandCallbacks) {
			g_mapMessagesDialogDocumentationCommandCallbacks.set(strCommandName, Callback);
		}

		g_vecNativeCalls.length = unOriginalCallCount;
	}
}

VerifyDialogDocumentationStartupOwnership(g_vecMessagesDialogDocumentationJavaScriptBlocks);

function VerifyDialogMenuOptionKeyContracts() {
	const strModuleSource = g_FileSystem.readFileSync(g_strMessagesDialogPath, "utf8");

	const ExecuteModule = g_VM.compileFunction("\"use strict\";\n" + strModuleSource, ["require", "module", "exports"]);
	const ModuleOutput = { exports: {} };
	RunMessageDocumentationOperation(ExecuteModule, [require, ModuleOutput, ModuleOutput.exports], "Dialog option key contract module");

	const { DialogMenu } = ModuleOutput.exports;
	const unMaximumDialogLevel = 1024;
	const unDefaultDisplayTime = 10;
	const unDefaultColorComponent = 0xFF;
	const vecInvalidKeys = [
		"Level",
		"Time",
		"Title",
		"Color",
		"Msg",
		"\x00rifle",
		"rifle\x00",
		"rifle\x00suffix",
		"\x00",
		"/",
		"rifle/primary",
		"Title/Choice",
		"safe/",
		`${"a".repeat(256)}/rifle`,
		`${"Ω".repeat(128)}/rifle`,
		"level",
		"LEVEL",
		"lEvEl",
		"time",
		"TIME",
		"tImE",
		"title",
		"TITLE",
		"tItLe",
		"color",
		"COLOR",
		"cOlOr",
		"msg",
		"MSG",
		"mSg",
	];
	const vecValidKeys = [
		"rifle",
		"constructor",
		"__proto__",
		"toString",
		"Levelled",
		"TimeTrial",
		"TitleChoice",
		"ColorChoice",
		"MsgChoice",
		"rifle.primary",
		"rifle\\primary",
		"Ωrifle",
	];
	const unNativeCallCount = g_vecNativeCalls.length;

	const MakeOptions = (KeyReferences, strShape) => {
		const vecKeys = Array.isArray(KeyReferences) ? [...KeyReferences] : [KeyReferences];
		if (strShape === "MAP") {
			return Object.fromEntries(vecKeys.map(strKey => [strKey, "Option"]));
		}

		return (strShape === "STRINGS") ? vecKeys : vecKeys.map(strKey => ({ Text: "Option", Value: strKey }));
	};

	const PreviewDialog = new ModuleOutput.exports.DialogNotification("Preview");
	const PreviewFields = PreviewDialog.TranslateMessageFields("en");

	const ReadPreviewLevel = () => RunMessageDocumentationOperation(() => PreviewDialog.BuildDialogValues(1, PreviewFields).Level, [], "Dialog option key level preview");

	let unCaseCount = 0;
	for (const strShape of ["MAP", "STRINGS", "RECORDS"]) {
		for (const strKey of vecInvalidKeys) {
			for (const strPhase of ["CONSTRUCTOR", "TRANSLATE", "BUILD"]) {
				const DialogOptions = MakeOptions(strKey, strShape);

				const Operation = () => {
					if (strPhase === "CONSTRUCTOR") {
						return new DialogMenu("Options", "Choose", "sjs_option_key", { Options: DialogOptions });
					}

					const Dialog = new DialogMenu("Options", "Choose", "sjs_option_key", { Options: ["safe"] });
					if (strPhase === "TRANSLATE") {
						Dialog.MessageFields.Options = DialogOptions;
						return Dialog.TranslateMessageFields("en");
					}

					const Fields = Dialog.TranslateMessageFields("en");
					Fields.Options = DialogOptions;

					return Dialog.BuildDialogValues(1, Fields);
				};

				const unLevelBefore = ReadPreviewLevel();
				g_Assert.throws(() => RunMessageDocumentationOperation(Operation, [], "Invalid dialog option key"), CaughtError => (CaughtError.constructor === TypeError) && /reserved|NUL|path/.test(CaughtError.message), "invalid dialog option keys must be rejected before payload commit");
				g_Assert.equal(ReadPreviewLevel(), unLevelBefore % unMaximumDialogLevel + 1, "invalid option keys do not consume a dialog level");
				unCaseCount++;
			}
		}

		for (const vecDuplicateKeys of [["Rifle", "rifle"], ["FOO", "foo"], ["__PROTO__", "__proto__"]]) {
			for (const strPhase of ["CONSTRUCTOR", "TRANSLATE", "BUILD"]) {
				const DialogOptions = MakeOptions(vecDuplicateKeys, strShape);

				const Operation = () => {
					if (strPhase === "CONSTRUCTOR") {
						return new DialogMenu("Options", "Choose", "sjs_option_key", { Options: DialogOptions });
					}

					const Dialog = new DialogMenu("Options", "Choose", "sjs_option_key", { Options: ["safe"] });
					if (strPhase === "TRANSLATE") {
						Dialog.MessageFields.Options = DialogOptions;
						return Dialog.TranslateMessageFields("en");
					}

					const Fields = Dialog.TranslateMessageFields("en");
					Fields.Options = DialogOptions;

					return Dialog.BuildDialogValues(1, Fields);
				};

				const unLevelBefore = ReadPreviewLevel();
				g_Assert.throws(() => RunMessageDocumentationOperation(Operation, [], "ASCII duplicate dialog option keys"), CaughtError => (CaughtError.constructor === TypeError) && /duplicated/.test(CaughtError.message));
				g_Assert.equal(ReadPreviewLevel(), unLevelBefore % unMaximumDialogLevel + 1, "ASCII duplicates do not consume a dialog level");
				unCaseCount++;
			}
		}

		for (const vecDistinctKeys of [["Ω", "ω"], ["K", "k"]]) {
			const Dialog = new DialogMenu("Options", "Choose", "sjs_option_key", { Options: MakeOptions(vecDistinctKeys, strShape) });
			const Values = Dialog.BuildDialogValues(1, Dialog.TranslateMessageFields("en"));
			for (const strKey of vecDistinctKeys) {
				g_Assert(Object.hasOwn(Values, strKey), "Non-ASCII distinctions and original spelling remain intact");
				g_Assert.equal(Values[strKey].Command, `sjs_option_key ${strKey}`);
			}

			unCaseCount++;
		}

		for (const strKey of vecValidKeys) {
			const Dialog = new DialogMenu("Options", "Choose", "sjs_option_key", { Options: MakeOptions(strKey, strShape) });
			const Fields = Dialog.TranslateMessageFields("en");
			const Values = RunMessageDocumentationOperation(() => Dialog.BuildDialogValues(1, Fields), [], "Valid dialog option key");
			g_Assert(Object.hasOwn(Values, strKey), "valid spelling and own-property option key are preserved");
			g_Assert.equal(Object.getPrototypeOf(Values), Object.prototype);
			g_Assert.equal(Values[strKey].Command, `sjs_option_key ${strKey}`);
			g_Assert.equal(Values[strKey].Msg, (strShape === "STRINGS") ? strKey : "Option");
			g_Assert.equal(Values.Title, "Options");
			g_Assert.equal(Values.Msg, "Choose");
			g_Assert.equal(Values.Time, unDefaultDisplayTime);
			g_Assert(Number.isSafeInteger(Values.Level) && (Values.Level > 0) && (Values.Level <= unMaximumDialogLevel));
			g_Assert.deepEqual(Values.Color, { Red: unDefaultColorComponent, Green: unDefaultColorComponent, Blue: unDefaultColorComponent, Alpha: unDefaultColorComponent });
			unCaseCount++;
		}
	}

	g_Assert.equal(g_vecNativeCalls.length, unNativeCallCount, "validation and payload previews do not dispatch native UI");
	g_Assert.equal(unCaseCount, 339);

	return unCaseCount;
}

g_Assert.equal(RunMessageDocumentationOperation(VerifyDialogMenuOptionKeyContracts, [], "Dialog option key contract matrix"), 339);

function VerifyDialogCapabilityAndLevelContracts(vecDocumentationBlocks) {
	const NativeMessages = globalThis.sourcejs.messages;
	const GetDialogTypesDescriptor = Object.getOwnPropertyDescriptor(NativeMessages, "GetDialogTypes");
	const CreateDialogDescriptor = Object.getOwnPropertyDescriptor(NativeMessages, "CreateDialog");
	const GetDialogTypes = NativeMessages.GetDialogTypes;
	const CreateDialog = NativeMessages.CreateDialog;
	const unOriginalCallCount = g_vecNativeCalls.length;
	const unMaximumDialogLevel = 1024;
	const strModuleSource = g_FileSystem.readFileSync(g_strMessagesDialogPath, "utf8");
	const ExecuteModule = g_VM.compileFunction("\"use strict\";\n" + strModuleSource, ["require", "module", "exports"], { filename: g_strMessagesDialogPath });

	try {
		for (const bAskConnectAvailable of [true, false]) {
			SetMessageSmokeProperty(NativeMessages, "GetDialogTypes", () => {
				const Types = { ...Reflect.apply(GetDialogTypes, NativeMessages, []) };
				if (!bAskConnectAvailable) {
					delete Types.AskConnect;
				}

				return Types;
			});

			SetMessageSmokeProperty(NativeMessages, "CreateDialog", CreateDialog);

			const ModuleOutput = { exports: {} };
			RunMessageDocumentationOperation(ExecuteModule, [require, ModuleOutput, ModuleOutput.exports], "messages/dialog:capability-module");

			const DialogModule = ModuleOutput.exports;
			g_Assert.equal(Object.hasOwn(DialogModule, "DialogAskConnect"), bAskConnectAvailable, "actual package capability-conditioned class");
			g_Assert.equal(Object.hasOwn(DialogModule.DIALOG_TYPE, "ASK_CONNECT"), bAskConnectAvailable, "actual package capability-conditioned enum");
			g_Assert.equal(Object.isFrozen(DialogModule.DIALOG_TYPE), true, "selected SDK enum snapshot frozen");

			const RequireDialog = (strModuleName) => {
				g_Assert.equal(strModuleName, "messages/dialog", "capability examples use only their documented module");

				return DialogModule;
			};

			for (const unBlockIndex of [0, 1, 8]) {
				const strDocumentationLabel = `messages-dialog.md:capability-${unBlockIndex + 1}`;
				const ExecuteExample = g_VM.compileFunction("\"use strict\";\n" + vecDocumentationBlocks[unBlockIndex], ["require"], { filename: strDocumentationLabel });
				RunMessageDocumentationOperation(ExecuteExample, [RequireDialog], strDocumentationLabel);
			}

			const PreviewDialog = new DialogModule.DialogNotification("Preview", { Time: 10 });
			const DialogFields = PreviewDialog.TranslateMessageFields("en");
			for (let unPreviewIndex = 1; unPreviewIndex <= (unMaximumDialogLevel + 1); unPreviewIndex += 1) {
				const DialogValues = PreviewDialog.BuildDialogValues(17, DialogFields);
				const unExpectedLevel = (unPreviewIndex - 1) % unMaximumDialogLevel + 1;
				g_Assert.equal(DialogValues.Level, unExpectedLevel, "previews consume and wrap per-player levels");
			}

			const unLevelBeforeFailure = PreviewDialog.BuildDialogValues(1, DialogFields).Level;
			let unNativeAttempts = 0;

			NativeMessages.CreateDialog = () => {
				unNativeAttempts += 1;

				return false;
			};

			g_Assert.equal(PreviewDialog.SendMessage([1, 2, 3]), false, "false result after all humans; fake client skipped");
			g_Assert.equal(unNativeAttempts, 2, "native false does not skip later humans");

			const unLevelAfterFailure = PreviewDialog.BuildDialogValues(1, DialogFields).Level;
			const unExpectedLevelAfterFailure = (unLevelBeforeFailure + 1) % unMaximumDialogLevel + 1;
			g_Assert.equal(unLevelAfterFailure, unExpectedLevelAfterFailure, "failed send consumes a level without rollback");

			NativeMessages.CreateDialog = () => undefined;
			g_Assert.throws(() => PreviewDialog.SendMessage(1), (CaughtError) => CaughtError.constructor === TypeError, "non-boolean native result propagates");
			g_Assert.equal(PreviewDialog.SendMessage(3), false, "fake-only target does not invoke native delivery");
		}
	} finally {
		RestoreMessageSmokeProperty(NativeMessages, "GetDialogTypes", GetDialogTypesDescriptor);
		RestoreMessageSmokeProperty(NativeMessages, "CreateDialog", CreateDialogDescriptor);
		g_vecNativeCalls.length = unOriginalCallCount;
	}
}

VerifyDialogCapabilityAndLevelContracts(g_vecMessagesDialogDocumentationJavaScriptBlocks);

g_vecNativeCalls.length = g_unMessagesDialogDocumentationCallIndex;

function VerifyImplementationWrapperAndDataContracts() {
	const NativeMessages = globalThis.sourcejs.messages;
	const vecWrapperCases = [
		{ NativeMethod: "SendClientConsoleMessage", Execute: (TargetReferences) => g_MessagesImplementation.SendClientConsoleMessageToRecipients(TargetReferences, "message") },
		{ NativeMethod: "SendClientCommand", Execute: (TargetReferences) => g_MessagesImplementation.SendClientCommandToRecipients(TargetReferences, "echo message") },
		{ NativeMethod: "SendSayTextMessage", Execute: (TargetReferences) => g_MessagesImplementation.SendSayTextMessageToRecipients(TargetReferences, "message", 0, true) },
		{ NativeMethod: "SendSayText2Message", Execute: (TargetReferences) => g_MessagesImplementation.SendSayText2MessageToRecipients(TargetReferences, "message", 0, true) },
		{ NativeMethod: "CreateDialog", Execute: (TargetReferences) => g_MessagesImplementation.SendDialogMessageDataToRecipients(TargetReferences, 2, { Level: 1, Time: 10, Title: "title", Msg: "message" }) },
	];
	for (const WrapperCase of vecWrapperCases) {
		const NativeOperationDescriptor = Object.getOwnPropertyDescriptor(NativeMessages, WrapperCase.NativeMethod);
		const vecRecipientAttempts = [];
		const OperationError = new Error("Implementation wrapper native failure");

		try {
			SetMessageSmokeProperty(NativeMessages, WrapperCase.NativeMethod, (unRecipientIndex) => {
				vecRecipientAttempts.push(unRecipientIndex);

				return unRecipientIndex !== 1;
			});

			g_Assert.equal(WrapperCase.Execute([1, 2]), false, `${WrapperCase.NativeMethod} false is aggregated`);
			g_Assert.deepEqual(vecRecipientAttempts, [1, 2], `${WrapperCase.NativeMethod} false does not skip later recipients`);

			vecRecipientAttempts.length = 0;
			SetMessageSmokeProperty(NativeMessages, WrapperCase.NativeMethod, (unRecipientIndex) => {
				vecRecipientAttempts.push(unRecipientIndex);
				throw OperationError;
			});

			g_Assert.throws(() => WrapperCase.Execute([1, 2]), (CaughtError) => CaughtError === OperationError, `${WrapperCase.NativeMethod} exception identity`);
			g_Assert.deepEqual(vecRecipientAttempts, [1], `${WrapperCase.NativeMethod} exception stops later recipients`);

			vecRecipientAttempts.length = 0;
			SetMessageSmokeProperty(NativeMessages, WrapperCase.NativeMethod, (unRecipientIndex) => {
				vecRecipientAttempts.push(unRecipientIndex);

				return undefined;
			});

			g_Assert.throws(() => WrapperCase.Execute([1, 2]), TypeError, `${WrapperCase.NativeMethod} rejects a non-boolean native result`);
			g_Assert.deepEqual(vecRecipientAttempts, [1], `${WrapperCase.NativeMethod} non-boolean result stops later recipients`);

			vecRecipientAttempts.length = 0;
			g_Assert.throws(() => WrapperCase.Execute([]), TypeError, `${WrapperCase.NativeMethod} requires recipients before native code`);
			g_Assert.deepEqual(vecRecipientAttempts, [], `${WrapperCase.NativeMethod} empty recipients do not call native code`);
		} finally {
			RestoreMessageSmokeProperty(NativeMessages, WrapperCase.NativeMethod, NativeOperationDescriptor);
		}
	}

	const SendUserMessageDescriptor = Object.getOwnPropertyDescriptor(NativeMessages, "SendUserMessage");
	let vecGenericRecipientIndexes = null;

	try {
		SetMessageSmokeProperty(NativeMessages, "SendUserMessage", (strMessageName, vecRecipientIndexes) => {
			g_Assert.equal(strMessageName, "HintText", "Generic send forwards the exact message name");
			vecGenericRecipientIndexes = vecRecipientIndexes;

			return true;
		});

		g_Assert.equal(g_MessagesImplementation.SendUserMessageToRecipients([], "HintText", [], false), true, "Generic send delegates empty recipients to native validation");
		g_Assert.deepEqual(vecGenericRecipientIndexes, [], "Generic send preserves the empty recipient array");

		SetMessageSmokeProperty(NativeMessages, "SendUserMessage", () => undefined);
		g_Assert.throws(() => g_MessagesImplementation.SendUserMessageToRecipients(1, "HintText", [], false), TypeError, "Generic send rejects a non-boolean native result");
	} finally {
		RestoreMessageSmokeProperty(NativeMessages, "SendUserMessage", SendUserMessageDescriptor);
	}

	const Payload = { Value: 1 };
	const MessageData = new g_MessagesImplementation.UserMessageData({ Payload, Message: "unchanged" });
	g_Assert.equal(MessageData.Payload, Payload, "Tracked fields retain the original object identity");
	g_Assert.equal(MessageData.HasUserMessageChanged(), false, "Construction leaves change tracking clear");

	Payload.Value = 2;
	g_Assert.equal(MessageData.Payload.Value, 2, "Nested mutation is visible through the retained object");
	g_Assert.equal(MessageData.HasUserMessageChanged(), false, "Nested mutation is not automatically tracked");
	g_Assert.equal(MessageData.DeleteUserMessageField("Missing"), false, "Missing tracked field deletion returns false");
	g_Assert.equal(MessageData.HasUserMessageChanged(), false, "Missing field deletion does not set the change flag");

	MessageData.Message = "unchanged";
	g_Assert.equal(MessageData.HasUserMessageChanged(), true, "An equal-value setter still tracks an assignment");
	MessageData.SetUserMessageChanged(false);
	g_Assert.equal(MessageData.Message, "unchanged", "Clearing the change flag does not revert field values");

	const NullPrototypeFields = Object.create(null);
	NullPrototypeFields.Value = 0x07;
	const NullPrototypeData = new g_MessagesImplementation.UserMessageData(NullPrototypeFields);
	g_Assert.equal(NullPrototypeData.Value, 0x07, "Null-prototype initial fields are accepted");
	g_Assert.equal(NullPrototypeData.HasUserMessageChanged(), false, "Null-prototype construction leaves change tracking clear");
	g_Assert.throws(() => new g_MessagesImplementation.UserMessageData([]), TypeError, "Initial field arrays are not plain objects");
	g_Assert.throws(() => new g_MessagesImplementation.UserMessageData(null), TypeError, "Null is not an initial field object");
	g_Assert.throws(() => MessageData.SetUserMessageField("", 1), TypeError, "Tracked field names must not be empty");

	class DispatchProbe extends g_MessagesImplementation.UserMessageImplementation {
		static ReadUserMessageFromBitBuffer() {
			return "bitbuffer";
		}

		static ReadUserMessageFromProtobuf() {
			return "protobuf";
		}

		static WriteUserMessageToBitBuffer(MessageBuffer) {
			MessageBuffer.SelectedBackend = "bitbuffer";
		}

		static WriteUserMessageToProtobuf(MessageBuffer) {
			MessageBuffer.SelectedBackend = "protobuf";
		}
	}

	const vecDispatchCases = [
		{ Buffer: {}, ExpectedBackend: "bitbuffer" },
		{ Buffer: { GetString: true, SetString: true }, ExpectedBackend: "bitbuffer" },
		{ Buffer: { GetString: () => "" }, ExpectedBackend: "protobuf" },
		{ Buffer: { SetString: () => undefined }, ExpectedBackend: "protobuf" },
	];
	for (const DispatchCase of vecDispatchCases) {
		g_Assert.equal(DispatchProbe.ReadUserMessage(DispatchCase.Buffer), DispatchCase.ExpectedBackend, "Dispatch uses either callable Protobuf string method");
		g_Assert.equal(DispatchProbe.WriteUserMessage(DispatchCase.Buffer, {}), DispatchCase.Buffer, "Dispatch returns the original buffer");
		g_Assert.equal(DispatchCase.Buffer.SelectedBackend, DispatchCase.ExpectedBackend, "Writer uses the same structural backend selection");
	}
}

VerifyImplementationWrapperAndDataContracts();

const g_strMessagesImplementationDocumentation = g_FileSystem.readFileSync(g_strMessagesImplementationDocumentationPath, "utf8");
const g_vecMessagesImplementationDocumentationJavaScriptBlocks = [];
for (const vecMessagesImplementationDocumentationBlockMatch of g_strMessagesImplementationDocumentation.matchAll(/```js\r?\n([\s\S]*?)```/g)) {
	g_vecMessagesImplementationDocumentationJavaScriptBlocks.push(vecMessagesImplementationDocumentationBlockMatch[1]);
}

const g_vecMessagesImplementationExportSectionMatch = g_strMessagesImplementationDocumentation.match(/## Exports\r?\n([\s\S]*?)\r?\n## /);
const g_bMessagesImplementationDocumentationGenerated = g_strMessagesImplementationDocumentation.includes("Generated by");
const g_bMessagesImplementationDocumentationUsesConsole = g_strMessagesImplementationDocumentation.includes("console.");

g_Assert.notEqual(g_vecMessagesImplementationExportSectionMatch, null, "messages/implementation documentation export section");

const g_vecMessagesImplementationDocumentedExportNames = [];
for (const vecMessagesImplementationDocumentedExportMatch of g_vecMessagesImplementationExportSectionMatch[1].matchAll(/^\| (?:\[)?`([^`]+)`(?:\]\(#[^)]*\))? \|/gm)) {
	g_vecMessagesImplementationDocumentedExportNames.push(vecMessagesImplementationDocumentedExportMatch[1]);
}

const g_vecMessagesImplementationActualExportNames = Object.keys(g_MessagesImplementation);

g_vecMessagesImplementationDocumentedExportNames.sort();
g_vecMessagesImplementationActualExportNames.sort();

g_Assert.equal(g_bMessagesImplementationDocumentationGenerated, false, "messages/implementation documentation generated marker");
g_Assert.equal(g_bMessagesImplementationDocumentationUsesConsole, false, "messages/implementation documentation avoids console-only examples");
g_Assert.equal(g_vecMessagesImplementationDocumentationJavaScriptBlocks.length, 15, "messages/implementation documentation JavaScript block count");
g_Assert.deepEqual(g_vecMessagesImplementationDocumentedExportNames, g_vecMessagesImplementationActualExportNames, "messages/implementation documented export inventory");

for (const vecMessagesImplementationDocumentationLinkMatch of g_strMessagesImplementationDocumentation.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
	const strMessagesImplementationDocumentationLink = vecMessagesImplementationDocumentationLinkMatch[1];
	const nMessagesImplementationDocumentationFragmentIndex = strMessagesImplementationDocumentationLink.indexOf("#");

	let strMessagesImplementationDocumentationLinkTarget = strMessagesImplementationDocumentationLink;
	if (nMessagesImplementationDocumentationFragmentIndex >= 0) {
		strMessagesImplementationDocumentationLinkTarget = strMessagesImplementationDocumentationLink.slice(0, nMessagesImplementationDocumentationFragmentIndex);
	}

	if ((strMessagesImplementationDocumentationLinkTarget.length > 0) && !/^[a-z]+:/i.test(strMessagesImplementationDocumentationLinkTarget)) {
		const strMessagesImplementationDocumentationLinkPath = g_Path.resolve(g_Path.dirname(g_strMessagesImplementationDocumentationPath), strMessagesImplementationDocumentationLinkTarget);
		g_Assert.equal(g_FileSystem.existsSync(strMessagesImplementationDocumentationLinkPath), true, `messages/implementation documentation link: ${strMessagesImplementationDocumentationLinkTarget}`);
	}
}

const g_strMessagesImplementationDocumentationSource = g_vecMessagesImplementationDocumentationJavaScriptBlocks.join("\n");
for (const strMessagesImplementationExportName of g_vecMessagesImplementationActualExportNames) {
	g_Assert.match(g_strMessagesImplementationDocumentationSource, new RegExp(`\\b${strMessagesImplementationExportName}\\b`), `messages/implementation example for ${strMessagesImplementationExportName}`);
}

for (const strUserMessageDataMemberName of Object.getOwnPropertyNames(g_MessagesImplementation.UserMessageData.prototype)) {
	if (strUserMessageDataMemberName !== "constructor") {
		g_Assert.match(g_strMessagesImplementationDocumentation, new RegExp(`\\b${strUserMessageDataMemberName}\\b`), `messages/implementation documentation member UserMessageData.${strUserMessageDataMemberName}`);
	}
}

const g_vecMessagesImplementationConstructorNames = Object.freeze([
	"FadeUserMessageImplementation",
	"HintTextUserMessageImplementation",
	"HUDMessageUserMessageImplementation",
	"KeyHintTextUserMessageImplementation",
	"ResetHUDUserMessageImplementation",
	"SayTextUserMessageImplementation",
	"SayText2UserMessageImplementation",
	"ShakeUserMessageImplementation",
	"ShowMenuUserMessageImplementation",
	"TextMessageUserMessageImplementation",
	"UserMessageImplementation",
	"VGUIMenuUserMessageImplementation",
]);

const g_unStandardMessageBitBufferCapacityByteCount = 0x100;
const g_unSmallMessageBitBufferCapacityByteCount = 0x80;
const g_dblMessageNumberTolerance = 0.000001;

for (const strMessagesImplementationConstructorName of g_vecMessagesImplementationConstructorNames) {
	for (const strMessagesImplementationStaticMemberName of Object.getOwnPropertyNames(g_MessagesImplementation[strMessagesImplementationConstructorName])) {
		if ((strMessagesImplementationStaticMemberName !== "length") && (strMessagesImplementationStaticMemberName !== "name") && (strMessagesImplementationStaticMemberName !== "prototype")) {
			g_Assert.match(g_strMessagesImplementationDocumentation, new RegExp(`\\b${strMessagesImplementationStaticMemberName}\\b`), `messages/implementation documentation static member ${strMessagesImplementationConstructorName}.${strMessagesImplementationStaticMemberName}`);
		}
	}
}

const g_RequireMessagesImplementationDocumentation = (strRequestedModuleName) => {
	switch (strRequestedModuleName) {
		case "bitbuffers":
			return g_Bitbuffers;

		case "memory/hooks/messages":
			return g_MessageHooks;

		case "messages":
			return g_Messages;

		case "messages/implementation":
			return g_MessagesImplementation;

		default:
			throw new Error(`Unexpected messages/implementation documentation dependency: ${strRequestedModuleName}`);
	}
};

const g_unMessagesImplementationDocumentationNativeCallStartIndex = g_vecNativeCalls.length;
let g_unMessagesImplementationDataStateExamples = 0;

for (const [unMessagesImplementationDocumentationBlockIndex, strMessagesImplementationDocumentationBlock] of g_vecMessagesImplementationDocumentationJavaScriptBlocks.entries()) {
	const strDocumentationLabel = `messages-implementation.md:block-${unMessagesImplementationDocumentationBlockIndex + 1}`;
	const strMessageDataInspection = 'return (typeof g_UserMessageDataValue === "undefined") ? null : g_UserMessageDataValue;';
	const MessagesImplementationDocumentationBlock = g_VM.compileFunction("\"use strict\";\n" + [strMessagesImplementationDocumentationBlock, strMessageDataInspection].join("\n"), ["require", "exports"], { filename: strDocumentationLabel });
	const DocumentationExports = {};

	const ExecuteMessagesImplementationDocumentationBlock = () => {
		const DocumentedMessageData = MessagesImplementationDocumentationBlock(g_RequireMessagesImplementationDocumentation, DocumentationExports);
		g_Assert.equal(Object.hasOwn(DocumentationExports, "unload"), false, "Message implementation documentation must not export the obsolete lowercase lifecycle.");

		if (DocumentedMessageData !== null) {
			g_Assert.equal(DocumentedMessageData instanceof g_MessagesImplementation.UserMessageData, true, "messages/implementation documentation tracked data type");
			g_Assert.equal(DocumentedMessageData.Message, "Changed through live field", "messages/implementation documentation PascalCase Message field");
			g_Assert.equal(DocumentedMessageData.SenderIndex, 1, "messages/implementation documentation PascalCase SenderIndex field");
			g_Assert.equal(Object.hasOwn(DocumentedMessageData, "Chat"), false, "messages/implementation documentation deleted Chat field");
			g_Assert.equal(DocumentedMessageData.Untracked, "metadata", "messages/implementation documentation untracked metadata");
			g_Assert.equal(DocumentedMessageData.HasUserMessageChanged(), false, "messages/implementation documentation explicit change-state reset");
			g_unMessagesImplementationDataStateExamples++;
		}
	};

	const CleanupMessagesImplementationDocumentation = () => {
		if (typeof DocumentationExports.Unload === "function") {
			DocumentationExports.Unload();
		}
	};

	g_Assert.doesNotThrow(() => RunMessageDocumentationScenario(ExecuteMessagesImplementationDocumentationBlock, CleanupMessagesImplementationDocumentation, strDocumentationLabel), `${strDocumentationLabel} execution`);
}

g_Assert.equal(g_unMessagesImplementationDataStateExamples, 1, "messages/implementation documentation tracked-state example count");

const g_vecMessagesImplementationDocumentationNativeCalls = g_vecNativeCalls.slice(g_unMessagesImplementationDocumentationNativeCallStartIndex);
const g_vecMessagesImplementationClientPrintCalls = [];
const g_vecMessagesImplementationClientCommandCalls = [];
const g_vecMessagesImplementationSayTextCalls = [];
const g_vecMessagesImplementationSayText2Calls = [];
const g_vecMessagesImplementationUserMessageCalls = [];
const g_vecMessagesImplementationCreateDialogCalls = [];
let g_bMessagesImplementationNestedDialogPayloadFound = false;
for (const vecMessagesImplementationDocumentationNativeCall of g_vecMessagesImplementationDocumentationNativeCalls) {
	switch (vecMessagesImplementationDocumentationNativeCall[0]) {
		case "SendClientConsoleMessage":
			g_vecMessagesImplementationClientPrintCalls.push(vecMessagesImplementationDocumentationNativeCall);
			break;

		case "SendClientCommand":
			g_vecMessagesImplementationClientCommandCalls.push(vecMessagesImplementationDocumentationNativeCall);
			break;

		case "SendSayTextMessage":
			g_vecMessagesImplementationSayTextCalls.push(vecMessagesImplementationDocumentationNativeCall);
			break;

		case "SendSayText2Message":
			g_vecMessagesImplementationSayText2Calls.push(vecMessagesImplementationDocumentationNativeCall);
			break;

		case "SendUserMessage":
			g_vecMessagesImplementationUserMessageCalls.push(vecMessagesImplementationDocumentationNativeCall);
			break;

		case "CreateDialog": {
			g_vecMessagesImplementationCreateDialogCalls.push(vecMessagesImplementationDocumentationNativeCall);

			const DialogPayload = vecMessagesImplementationDocumentationNativeCall[3];
			const strMessagesImplementationDialogType = vecMessagesImplementationDocumentationNativeCall[4];
			if ((strMessagesImplementationDialogType === "menu") && Object.hasOwn(DialogPayload, "rifle")) {
				const RifleDialogPayload = DialogPayload.rifle;
				if ((typeof RifleDialogPayload === "object") && (RifleDialogPayload !== null) && (RifleDialogPayload.Command === "echo SourceJS rifle loadout")) {
					g_bMessagesImplementationNestedDialogPayloadFound = true;
				}
			}

			break;
		}

		default:
			throw new Error(`Unexpected messages/implementation documentation native call: ${vecMessagesImplementationDocumentationNativeCall[0]}`);
	}
}

function VerifyImplementationRegistryDocumentationOwnership(vecDocumentationBlocks) {
	const strRegistryBlock = vecDocumentationBlocks.find((strBlock) => strBlock.includes('IMPLEMENTED_USER_MESSAGES.set("CustomHint"'));
	g_Assert.notEqual(strRegistryBlock, undefined, "Registry ownership documentation block");

	const mapRegistry = g_MessagesImplementation.IMPLEMENTED_USER_MESSAGES;

	const ForeignCodec = class ForeignCodec {
	};

	const LookupError = new Error("Controlled registry lookup failure");
	const bOriginalEntryPresent = mapRegistry.has("CustomHint");
	const OriginalCodec = mapRegistry.get("CustomHint");
	const ExecuteRegistryBlock = g_VM.compileFunction("\"use strict\";\n" + strRegistryBlock, ["require"], { filename: "messages-implementation.md:registry" });

	try {
		mapRegistry.set("CustomHint", ForeignCodec);

		const ExecuteExistingEntry = () => RunMessageDocumentationOperation(ExecuteRegistryBlock, [g_RequireMessagesImplementationDocumentation], "messages-implementation.md:existing-registry");

		g_Assert.throws(ExecuteExistingEntry, /already owns CustomHint/, "Registry fragment rejects an existing foreign registration");
		g_Assert.equal(mapRegistry.get("CustomHint"), ForeignCodec, "Registry fragment preserves the existing foreign codec");

		for (const bReplaceDuringLookup of [true, false]) {
			mapRegistry.delete("CustomHint");

			const RequireControlledRegistry = (strModuleName) => {
				if (strModuleName !== "messages/implementation") {
					return g_RequireMessagesImplementationDocumentation(strModuleName);
				}

				return {
					...g_MessagesImplementation,

					GetUserMessageImplementation: (MessageNameOrIndex) => {
						const Codec = g_MessagesImplementation.GetUserMessageImplementation(MessageNameOrIndex);
						if (MessageNameOrIndex === "CustomHint") {
							if (!bReplaceDuringLookup) {
								throw LookupError;
							}

							mapRegistry.set("CustomHint", ForeignCodec);
						}

						return Codec;
					},
				};
			};

			const ExecuteRegistry = () => RunMessageDocumentationOperation(ExecuteRegistryBlock, [RequireControlledRegistry], "messages-implementation.md:controlled-registry");
			if (bReplaceDuringLookup) {
				g_Assert.doesNotThrow(ExecuteRegistry, "Registry fragment tolerates a later owner's replacement");
				g_Assert.equal(mapRegistry.get("CustomHint"), ForeignCodec, "Registry cleanup does not delete a foreign replacement");

			} else {
				g_Assert.throws(ExecuteRegistry, (CaughtError) => CaughtError === LookupError, "Registry startup failure keeps its original error");
				g_Assert.equal(mapRegistry.has("CustomHint"), false, "Registry startup failure removes its owned temporary entry");
			}
		}
	} finally {
		if (bOriginalEntryPresent) {
			mapRegistry.set("CustomHint", OriginalCodec);

		} else {
			mapRegistry.delete("CustomHint");
		}
	}
}

VerifyImplementationRegistryDocumentationOwnership(g_vecMessagesImplementationDocumentationJavaScriptBlocks);

g_Assert.equal(g_MessagesImplementation.IMPLEMENTED_USER_MESSAGES.has("CustomHint"), false, "messages/implementation documentation custom registry cleanup");
g_Assert.equal(g_vecMessagesImplementationDocumentationNativeCalls.length, 10, "messages/implementation documentation native call count");
g_Assert.equal(g_vecMessagesImplementationClientPrintCalls.length, 2, "messages/implementation documentation SendClientConsoleMessage send count");
g_Assert.equal(g_vecMessagesImplementationClientCommandCalls.length, 1, "messages/implementation documentation SendClientCommand send count");
g_Assert.equal(g_vecMessagesImplementationClientCommandCalls[0][2], "echo SourceJS client command", "messages/implementation documentation client command line");
g_Assert.equal(g_vecMessagesImplementationSayTextCalls.length, 2, "messages/implementation documentation SayText send count");
g_Assert.equal(g_vecMessagesImplementationSayText2Calls.length, 2, "messages/implementation documentation SayText2 send count");
g_Assert.equal(g_vecMessagesImplementationUserMessageCalls.length, 1, "messages/implementation documentation raw user message send count");
g_Assert.equal(g_vecMessagesImplementationUserMessageCalls[0][1], "HintText", "messages/implementation documentation raw user message name");
g_Assert.equal(g_vecMessagesImplementationCreateDialogCalls.length, 2, "messages/implementation documentation dialog send count");
g_Assert.equal(g_bMessagesImplementationNestedDialogPayloadFound, true, "messages/implementation documentation nested dialog payload");

function VerifyProtobufDocumentationCleanupContracts(strDocumentationBlock, RequireDocumentation, HookModule) {
	const MessagesModule = RequireDocumentation("messages");
	const vecModes = [
		"CONSTRUCTORTHROW",
		"STARTUPFALSE",
		"STARTUPTHROW",
		"REGISTRATIONTHROW",
		"DISPOSEFALSE",
		"DISPOSETHROW",
		"STARTUPANDDISPOSEFALSE",
		"STARTUPANDDISPOSETHROW",
		"CLEANUPAFTERREMOVALTHROW",
	];
	const unNativeCallCount = g_vecNativeCalls.length;
	for (const strMode of vecModes) {
		const StartupError = new Error("Controlled Protobuf startup failure");
		const CleanupError = new Error("Controlled Protobuf cleanup failure");
		const DocumentationExports = {};
		let bFailCleanup = strMode.includes("DISPOSE") || (strMode === "CLEANUPAFTERREMOVALTHROW");
		let OwnedHook = null;

		class ControlledHook extends HookModule.ProtobufUserMessageHook {
			constructor(strMessageName, Callback = null) {
				super(strMessageName, Callback);

				OwnedHook = this;

				if (strMode === "CONSTRUCTORTHROW") {
					throw StartupError;
				}
			}

			RegisterUserMessageHook(Callback) {
				OwnedHook = this;

				if (strMode === "REGISTRATIONTHROW") {
					throw StartupError;
				}

				return super.RegisterUserMessageHook(Callback);
			}

			DisposeUserMessageHook() {
				if (bFailCleanup) {
					if (strMode === "CLEANUPAFTERREMOVALTHROW") {
						g_Assert.equal(super.DisposeUserMessageHook(), true, "Controlled cleanup removes the callback before reporting a native cleanup failure");
						throw CleanupError;
					}

					if (strMode.endsWith("FALSE")) {
						return false;
					}

					throw CleanupError;
				}

				return super.DisposeUserMessageHook();
			}
		}

		class ControlledSayText2 extends MessagesModule.SayText2 {
			SendUserMessage(TargetReferences) {
				if (strMode === "STARTUPFALSE") {
					return false;
				}

				if (strMode.startsWith("STARTUP")) {
					throw StartupError;
				}

				return super.SendUserMessage(TargetReferences);
			}
		}

		const RequireControlledDocumentation = (strModuleName) => {
			if (strModuleName === "memory/hooks/messages") {
				return { ...HookModule, ProtobufUserMessageHook: ControlledHook };
			}

			if (strModuleName === "messages") {
				return { ...MessagesModule, SayText2: ControlledSayText2 };
			}

			return RequireDocumentation(strModuleName);
		};

		const strDocumentationLabel = `messages:protobuf-cleanup-${strMode}`;
		const DocumentationBlock = g_VM.compileFunction("\"use strict\";\n" + strDocumentationBlock, ["require", "exports"], { filename: strDocumentationLabel });

		const ExecuteDocumentation = () => RunMessageDocumentationOperation(DocumentationBlock, [RequireControlledDocumentation, DocumentationExports], strDocumentationLabel);

		const VerifyDocumentation = () => {
			g_Assert.throws(ExecuteDocumentation, (CaughtError) => {
				if (strMode.startsWith("STARTUPAND")) {
					g_Assert.equal(CaughtError instanceof AggregateError, true, `${strMode} preserves both errors`);
					g_Assert.equal(CaughtError.errors[0], StartupError, `${strMode} preserves startup error identity`);

					if (strMode.endsWith("THROW")) {
						g_Assert.equal(CaughtError.errors[1], CleanupError, `${strMode} preserves cleanup error identity`);

					} else {
						g_Assert.match(CaughtError.errors[1].message, /could not release its callback/, `${strMode} reports failed disposal`);
					}

				} else if ((strMode === "CONSTRUCTORTHROW") || (strMode === "STARTUPTHROW") || (strMode === "REGISTRATIONTHROW")) {
					g_Assert.equal(CaughtError, StartupError, `${strMode} preserves startup error identity`);

				} else if ((strMode === "DISPOSETHROW") || (strMode === "CLEANUPAFTERREMOVALTHROW")) {
					g_Assert.equal(CaughtError, CleanupError, `${strMode} preserves cleanup error identity`);

				} else {
					g_Assert.match(CaughtError.message, (strMode === "STARTUPFALSE") ? /did not rewrite SayText2/ : /could not release its callback/, `${strMode} reports its failed operation`);
				}

				return true;
			}, `${strMode} rejects failed startup or cleanup`);
			g_Assert.equal(Object.hasOwn(DocumentationExports, "unload"), false, `${strMode} must not retain the obsolete lowercase lifecycle`);
			g_Assert.equal(typeof DocumentationExports.Unload, "function", `${strMode} retains accessible cleanup`);
			g_Assert.notEqual(OwnedHook, null, `${strMode} captured the actual hook owner`);

			const bCallbackExpected = bFailCleanup && (strMode !== "CLEANUPAFTERREMOVALTHROW");
			g_Assert.equal(OwnedHook.Callback !== null, bCallbackExpected, `${strMode} retains callback ownership only when removal failed`);

			bFailCleanup = false;
			g_Assert.equal(DocumentationExports.Unload(), true, `${strMode} permits cleanup retry`);
			g_Assert.equal(DocumentationExports.Unload(), true, `${strMode} cleanup is idempotent`);
			g_Assert.equal(OwnedHook.Callback, null, `${strMode} releases its callback`);
			g_Assert.equal(HookModule.HOOK_STATUS.ProtobufSendInstalled, false, `${strMode} releases unused native hooks`);
		};

		const CleanupDocumentation = () => {
			bFailCleanup = false;
			const vecCleanupErrors = [];

			try {
				if (typeof DocumentationExports.Unload === "function") {
					DocumentationExports.Unload();
				}
			} catch (CleanupError) {
				vecCleanupErrors.push(CleanupError);
			}

			try {
				if (OwnedHook !== null) {
					// Retry native cleanup even after callback removal or an interrupted constructor.
					const bHadCallback = OwnedHook.Callback !== null;
					const bDisposed = OwnedHook.DisposeUserMessageHook();
					if (bHadCallback) {
						g_Assert.equal(bDisposed, true, "Protobuf cleanup fixture releases any remaining owned callback");
					}
				}
			} catch (CleanupError) {
				vecCleanupErrors.push(CleanupError);
			}

			if (vecCleanupErrors.length === 1) {
				throw vecCleanupErrors[0];
			}

			if (vecCleanupErrors.length > 1) {
				throw new AggregateError(vecCleanupErrors, "Protobuf documentation unload and fallback cleanup both failed.");
			}
		};

		try {
			RunMessageDocumentationScenario(VerifyDocumentation, CleanupDocumentation, strDocumentationLabel + ":scenario");
		} finally {
			g_vecNativeCalls.length = unNativeCallCount;
		}
	}
}

const g_strMessagesImplementationProtobufDocumentationBlock = g_vecMessagesImplementationDocumentationJavaScriptBlocks.find((strBlock) => strBlock.includes("ProtobufUserMessageHook"));
g_Assert.notEqual(g_strMessagesImplementationProtobufDocumentationBlock, undefined, "messages/implementation protobuf documentation block");

function VerifyImplementationProtobufDocumentation() {
	const OriginalHookCacheDescriptor = Object.getOwnPropertyDescriptor(require.cache, g_strMessageHooksPath);
	const strOriginalBackend = g_strActiveMessageBackend;
	const unOriginalNativeCallCount = g_vecNativeCalls.length;
	const DocumentationExports = {};
	const strDocumentationLabel = "messages-implementation.md:protobuf-writer";

	const VerifyDocumentation = () => {
		g_strActiveMessageBackend = "protobuf";
		delete require.cache[g_strMessageHooksPath];

		const HookModule = require(g_strMessageHooksPath);

		const RequireDocumentation = (strRequestedModuleName) => {
			switch (strRequestedModuleName) {
				case "memory/hooks/messages":
					return HookModule;

				case "messages":
					return g_MessagesBase;

				case "messages/implementation":
					return g_MessagesImplementation;

				default:
					throw new Error(`Unexpected messages/implementation protobuf documentation dependency: ${strRequestedModuleName}`);
			}
		};

		const DocumentationBlock = g_VM.compileFunction("\"use strict\";\n" + g_strMessagesImplementationProtobufDocumentationBlock, ["require", "exports"], { filename: strDocumentationLabel });

		const ExecuteDocumentation = () => RunMessageDocumentationOperation(DocumentationBlock, [RequireDocumentation, DocumentationExports], strDocumentationLabel);

		g_Assert.doesNotThrow(ExecuteDocumentation, "messages/implementation protobuf documentation execution");
		g_Assert.equal(Object.hasOwn(DocumentationExports, "unload"), false, "Protobuf documentation must not export the obsolete lowercase lifecycle.");
		g_Assert.equal(typeof DocumentationExports.Unload, "function", "Protobuf documentation publishes its owned cleanup");
		g_Assert.equal(DocumentationExports.Unload(), true, "Protobuf documentation cleanup is idempotent");
		g_Assert.equal(HookModule.HOOK_STATUS.ProtobufSendInstalled, false, "messages/implementation protobuf documentation hook cleanup");

		const VTableHookRecord = g_vecNativeVTableHooks.at(-1);
		g_Assert.notEqual(VTableHookRecord, undefined, "messages/implementation protobuf native hook record");
		g_Assert.equal(VTableHookRecord.Removed, true, "messages/implementation protobuf native hook release");

		let unSayText2CallCount = 0;
		for (const vecNativeCall of g_vecNativeCalls.slice(unOriginalNativeCallCount)) {
			if ((vecNativeCall[0] === "SendUserMessage") && (vecNativeCall[1] === "SayText2")) {
				unSayText2CallCount += 1;
			}
		}

		g_Assert.equal(unSayText2CallCount, 1, "messages/implementation protobuf fixture send count");

		VerifyProtobufDocumentationCleanupContracts(g_strMessagesImplementationProtobufDocumentationBlock, RequireDocumentation, HookModule);
		VerifyProtobufDocumentationCleanupContracts(g_strWriteProtobufDocumentationBlock, RequireDocumentation, HookModule);
	};

	const CleanupDocumentation = () => {
		if (typeof DocumentationExports.Unload === "function") {
			DocumentationExports.Unload();
		}
	};

	try {
		RunMessageDocumentationScenario(VerifyDocumentation, CleanupDocumentation, strDocumentationLabel + ":scenario");
	} finally {
		RestoreMessageSmokeProperty(require.cache, g_strMessageHooksPath, OriginalHookCacheDescriptor);
		g_strActiveMessageBackend = strOriginalBackend;
		g_vecNativeCalls.length = unOriginalNativeCallCount;
	}
}

VerifyImplementationProtobufDocumentation();

g_vecNativeCalls.length = g_unMessagesImplementationDocumentationNativeCallStartIndex;

g_Assert.deepEqual(g_MessagesImplementation.NormalizeUserMessageRecipients([1, { Index: 2 }, 1]), [1, 2], "NormalizeUserMessageRecipients");
g_Assert.throws(() => g_MessagesImplementation.NormalizeUserMessageRecipients("1"), "NormalizeUserMessageRecipients rejects strings");

g_Assert.equal(g_MessagesImplementation.SendClientConsoleMessageToRecipients(1, "print"), true, "SendClientConsoleMessageToRecipients result");
g_Assert.deepEqual(g_vecNativeCalls.at(-1), ["SendClientConsoleMessage", 1, "print"], "SendClientConsoleMessageToRecipients call");
g_Assert.equal(g_MessagesImplementation.SendClientCommandToRecipients(1, "jointeam 2"), true, "SendClientCommandToRecipients result");
g_Assert.deepEqual(g_vecNativeCalls.at(-1), ["SendClientCommand", 1, "jointeam 2"], "SendClientCommandToRecipients call");
g_Assert.equal(g_MessagesImplementation.SendSayTextMessageToRecipients([1, 2], "hello", 3, true), true, "SendSayTextMessageToRecipients result");
g_Assert.deepEqual(g_vecNativeCalls.at(-2), ["SendSayTextMessage", 1, "hello", 3, true], "SendSayTextMessageToRecipients first call");
g_Assert.deepEqual(g_vecNativeCalls.at(-1), ["SendSayTextMessage", 2, "hello", 3, true], "SendSayTextMessageToRecipients second call");
g_Assert.equal(g_MessagesImplementation.SendSayText2MessageToRecipients(2, "hello2", 4, false), true, "SendSayText2MessageToRecipients result");
g_Assert.deepEqual(g_vecNativeCalls.at(-1), ["SendSayText2Message", 2, "hello2", 4, false], "SendSayText2MessageToRecipients call");
g_Assert.equal(g_MessagesImplementation.SendUserMessageToRecipients(1, "Custom", [{ Type: "byte", Value: 0x07 }], true), true, "SendUserMessageToRecipients result");
g_Assert.deepEqual(g_vecNativeCalls.at(-1), ["SendUserMessage", "Custom", [1], [{ Type: "byte", Value: 0x07 }], true], "SendUserMessageToRecipients call");
g_Assert.equal(g_MessagesImplementation.SendDialogMessageToRecipients(1, "Title", "Body", 5), true, "SendDialogMessageToRecipients result");
g_Assert.deepEqual(g_vecNativeCalls.at(-1), ["CreateDialog", 1, 2, { Level: 1, Msg: "Body", Time: 5, Title: "Title" }, "menu"], "SendDialogMessageToRecipients call");

g_Assert.throws(() => g_MessagesImplementation.SendClientConsoleMessageToRecipients([], "print"), "SendClientConsoleMessageToRecipients rejects empty recipients");
g_Assert.throws(() => g_MessagesImplementation.SendClientConsoleMessageToRecipients(1, 7), "SendClientConsoleMessageToRecipients rejects non-string messages");
g_Assert.throws(() => g_MessagesImplementation.SendSayTextMessageToRecipients(1, "hello", 0, 1), "SendSayTextMessageToRecipients rejects non-boolean chat");
g_Assert.throws(() => g_MessagesImplementation.SendUserMessageToRecipients(1, "Custom", {}, false), "SendUserMessageToRecipients rejects non-array fields");
g_Assert.throws(() => g_MessagesImplementation.SendDialogMessageDataToRecipients(1, 2, new Map()), "SendDialogMessageDataToRecipients rejects non-plain values");

const g_UserMessageDataValue = new g_MessagesImplementation.UserMessageData({ Message: "original" });
const g_UserMessageDataPropertyDescriptor = Object.getOwnPropertyDescriptor(g_UserMessageDataValue, "Message");
g_Assert.notEqual(g_UserMessageDataPropertyDescriptor, undefined, "UserMessageData message descriptor");
g_Assert.equal(typeof g_UserMessageDataPropertyDescriptor.get, "function", "UserMessageData getter");
g_Assert.equal(typeof g_UserMessageDataPropertyDescriptor.set, "function", "UserMessageData setter");
g_Assert.equal(g_UserMessageDataValue.HasUserMessageChanged(), false, "UserMessageData initial state");
g_UserMessageDataValue.Message = "changed";
g_Assert.equal(g_UserMessageDataValue.HasUserMessageChanged(), true, "UserMessageData direct write state");
g_UserMessageDataValue.SetUserMessageChanged(false);
g_UserMessageDataValue.SetUserMessageField("Parameter1", "one");
g_Assert.equal(g_UserMessageDataValue.Parameter1, "one", "UserMessageData explicit set");
g_Assert.equal(g_UserMessageDataValue.DeleteUserMessageField("Parameter1"), true, "UserMessageData explicit delete");
g_Assert.equal(g_UserMessageDataValue.DeleteUserMessageField("Parameter1"), false, "UserMessageData missing delete");
g_Assert.equal(typeof g_UserMessageDataValue.toJSON, "undefined", "UserMessageData has no snapshot method");
g_Assert.throws(() => g_UserMessageDataValue.SetUserMessageChanged(1), "UserMessageData rejects non-boolean change state");

const g_SayTextBitBuffer = new g_Bitbuffers.BitBufferWrite(g_unStandardMessageBitBufferCapacityByteCount);
g_MessagesImplementation.SayTextUserMessageImplementation.WriteUserMessageToBitBuffer(g_SayTextBitBuffer, { Chat: true, Message: "SayText order", SenderIndex: 4 });

const g_SayTextMessageData = g_MessagesImplementation.SayTextUserMessageImplementation.ReadUserMessageFromBitBuffer(new g_Bitbuffers.BitBufferRead(g_SayTextBitBuffer));
g_Assert.equal(g_SayTextMessageData.SenderIndex, 4, "SayTextImplementation SenderIndex");
g_Assert.equal(g_SayTextMessageData.Message, "SayText order", "SayTextImplementation Message field order");
g_Assert.equal(g_SayTextMessageData.Chat, true, "SayTextImplementation Chat field order");

g_SayTextBitBuffer.ResetBuffer();

g_MessagesImplementation.SayText2UserMessageImplementation.WriteUserMessageToBitBuffer(g_SayTextBitBuffer, {
	Chat: true,
	Message: "Hello",
	Parameter1: "one",
	Parameter2: "two",
	Parameter3: "three",
	Parameter4: "four",
	SenderIndex: 3,
});

const g_SayText2MessageData = g_MessagesImplementation.SayText2UserMessageImplementation.ReadUserMessageFromBitBuffer(new g_Bitbuffers.BitBufferRead(g_SayTextBitBuffer));
g_Assert.equal(g_SayText2MessageData.SenderIndex, 3, "SayText2Implementation SenderIndex");
g_Assert.equal(g_SayText2MessageData.Chat, true, "SayText2Implementation Chat");
g_Assert.equal(g_SayText2MessageData.Parameter4, "four", "SayText2Implementation Parameter4");

const g_TextMessageBitBuffer = new g_Bitbuffers.BitBufferWrite(g_unStandardMessageBitBufferCapacityByteCount);
g_MessagesImplementation.TextMessageUserMessageImplementation.WriteUserMessageToBitBuffer(g_TextMessageBitBuffer, {
	Destination: 4,
	Message: "Center",
	Parameter1: "one",
	Parameter2: "two",
	Parameter3: "three",
	Parameter4: "four",
});

const g_TextMessageData = g_MessagesImplementation.TextMessageUserMessageImplementation.ReadUserMessageFromBitBuffer(new g_Bitbuffers.BitBufferRead(g_TextMessageBitBuffer));
g_Assert.equal(g_TextMessageData.Destination, 4, "TextMessageImplementation Destination");
g_Assert.equal(g_TextMessageData.Parameter4, "four", "TextMessageImplementation Parameter4");

const g_FadeBitBuffer = new g_Bitbuffers.BitBufferWrite(g_unSmallMessageBitBufferCapacityByteCount);
g_MessagesImplementation.FadeUserMessageImplementation.WriteUserMessageToBitBuffer(g_FadeBitBuffer, { Color: { Red: 0x0A, Green: 0x14, Blue: 0x1E, Alpha: 0x28 }, Duration: 1, Flags: 0x02, HoldTime: 2 });

const g_FadeMessageData = g_MessagesImplementation.FadeUserMessageImplementation.ReadUserMessageFromBitBuffer(new g_Bitbuffers.BitBufferRead(g_FadeBitBuffer));
g_Assert.equal(g_FadeMessageData.Duration, 1, "FadeImplementation Duration");
g_Assert.equal(g_FadeMessageData.Color.Blue, 0x1E, "FadeImplementation Color");
g_Assert.throws(() => g_MessagesImplementation.FadeUserMessageImplementation.WriteUserMessageToBitBuffer(new g_Bitbuffers.BitBufferWrite(g_unSmallMessageBitBufferCapacityByteCount), { Color: [0x0A, 0x14, 0x1E, 0x28], Duration: 1, Flags: 0x02, HoldTime: 2 }), "FadeImplementation rejects color arrays");

const g_HUDMessageBitBuffer = new g_Bitbuffers.BitBufferWrite(g_unStandardMessageBitBufferCapacityByteCount);
g_MessagesImplementation.HUDMessageUserMessageImplementation.WriteUserMessageToBitBuffer(g_HUDMessageBitBuffer, {
	Channel: 9,
	Color1: { Red: 0x01, Green: 0x02, Blue: 0x03, Alpha: 0x04 },
	Color2: { Red: 0x05, Green: 0x06, Blue: 0x07, Alpha: 0x08 },
	Effect: 1,
	EffectTime: 0.4,
	FadeIn: 0.1,
	FadeOut: 0.2,
	HoldTime: 3,
	Message: "HUD",
	X: 0.2,
	Y: 0.3,
});

const g_HUDMessageData = g_MessagesImplementation.HUDMessageUserMessageImplementation.ReadUserMessageFromBitBuffer(new g_Bitbuffers.BitBufferRead(g_HUDMessageBitBuffer));
g_Assert.equal(g_HUDMessageData.Channel, 9, "HUDMessageImplementation Channel");
g_Assert.equal(Math.abs(g_HUDMessageData.EffectTime - 0.4) <= g_dblMessageNumberTolerance, true, "HUDMessageImplementation EffectTime");
g_Assert.equal(g_HUDMessageData.Color2.Alpha, 0x08, "HUDMessageImplementation Color2");

const g_VGUIMenuBitBuffer = new g_Bitbuffers.BitBufferWrite(g_unSmallMessageBitBufferCapacityByteCount);
g_MessagesImplementation.VGUIMenuUserMessageImplementation.WriteUserMessageToBitBuffer(g_VGUIMenuBitBuffer, { Name: "menu", Show: true, Subkeys: { title: "SourceJS" } });

const g_VGUIMenuMessageData = g_MessagesImplementation.VGUIMenuUserMessageImplementation.ReadUserMessageFromBitBuffer(new g_Bitbuffers.BitBufferRead(g_VGUIMenuBitBuffer));
g_Assert.equal(g_VGUIMenuMessageData.Name, "menu", "VGUIMenuImplementation Name");
g_Assert.equal(g_VGUIMenuMessageData.Subkeys.title, "SourceJS", "VGUIMenuImplementation Subkey");

const g_VGUIMenuSubkeysWithPrototypeProperty = {};
Object.defineProperty(g_VGUIMenuSubkeysWithPrototypeProperty, "__proto__", { configurable: true, enumerable: true, value: "preserved", writable: true });

const g_VGUIMenuPrototypePropertyBitBuffer = new g_Bitbuffers.BitBufferWrite(g_unSmallMessageBitBufferCapacityByteCount);
g_MessagesImplementation.VGUIMenuUserMessageImplementation.WriteUserMessageToBitBuffer(g_VGUIMenuPrototypePropertyBitBuffer, { Name: "info", Show: true, Subkeys: g_VGUIMenuSubkeysWithPrototypeProperty });

const g_VGUIMenuPrototypePropertyMessageData = g_MessagesImplementation.VGUIMenuUserMessageImplementation.ReadUserMessageFromBitBuffer(new g_Bitbuffers.BitBufferRead(g_VGUIMenuPrototypePropertyBitBuffer));
const g_VGUIMenuSubkeysPrototype = Object.getPrototypeOf(g_VGUIMenuPrototypePropertyMessageData.Subkeys);
g_Assert.equal(g_VGUIMenuSubkeysPrototype, Object.prototype, "VGUIMenuImplementation preserves the subkeys prototype");
g_Assert.equal(Object.hasOwn(g_VGUIMenuPrototypePropertyMessageData.Subkeys, "__proto__"), true, "VGUIMenuImplementation preserves __proto__ as an own Subkey");
g_Assert.equal(g_VGUIMenuPrototypePropertyMessageData.Subkeys["__proto__"], "preserved", "VGUIMenuImplementation __proto__ Subkey value");

const g_SayText2ProtobufBuffer = new ProtobufBuffer();
g_MessagesImplementation.SayText2UserMessageImplementation.WriteUserMessageToProtobuf(g_SayText2ProtobufBuffer, {
	Chat: false,
	Message: "Proto",
	Parameter1: "p1",
	Parameter2: "p2",
	Parameter3: "p3",
	Parameter4: "p4",
	SenderIndex: 4,
});

const g_SayText2ProtobufData = g_MessagesImplementation.SayText2UserMessageImplementation.ReadUserMessageFromProtobuf(g_SayText2ProtobufBuffer);
g_Assert.equal(g_SayText2ProtobufData.SenderIndex, 4, "SayText2Implementation protobuf SenderIndex");
g_Assert.equal(g_SayText2ProtobufData.Parameter2, "p2", "SayText2Implementation protobuf Parameter2");

const g_strMessagesImplementationProtobufSendPreviousMessageBackend = g_strActiveMessageBackend;

try {
	g_strActiveMessageBackend = "protobuf";

	const SayText2ProtobufMessage = new g_MessagesBase.SayText2("Protobuf {Name}", {
		Chat: true,
		Parameter1: "{Name}",
		SenderIndex: 2,
	});

	g_Assert.equal(SayText2ProtobufMessage.SendUserMessage(1, { Name: "Ren" }), true, "SayText2 protobuf send");
	g_Assert.deepEqual(g_vecNativeCalls.at(-1)[3], [
		{ Kind: "SET", Name: "msg_name", Type: "string", Value: " \x01Protobuf Ren" },
		{ Kind: "SET", Name: "chat", Type: "bool", Value: true },
		{ Kind: "SET", Name: "ent_idx", Type: "int32", Value: 2 },
		{ Kind: "ADD", Name: "params", Type: "string", Value: "Ren" },
		{ Kind: "ADD", Name: "params", Type: "string", Value: "" },
		{ Kind: "ADD", Name: "params", Type: "string", Value: "" },
		{ Kind: "ADD", Name: "params", Type: "string", Value: "" },
	], "SayText2 protobuf native descriptors");

	const ShowMenuProtobufMessage = new g_MessagesBase.ShowMenu("1. Continue", 0x01, 8);
	g_Assert.equal(ShowMenuProtobufMessage.SendUserMessage([1, 3]), true, "ShowMenu protobuf send");
	g_Assert.deepEqual(g_vecNativeCalls.at(-1), [
		"SendUserMessage",
		"ShowMenu",
		[1],
		[
			{ Kind: "SET", Name: "bits_valid_slots", Type: "int32", Value: 0x01 },
			{ Kind: "SET", Name: "display_time", Type: "int32", Value: 8 },
			{ Kind: "SET", Name: "menu_string", Type: "string", Value: "1. Continue" },
		],
		false,
	], "ShowMenu protobuf native descriptors and human recipients");
} finally {
	g_strActiveMessageBackend = g_strMessagesImplementationProtobufSendPreviousMessageBackend;
}

g_Assert.equal(g_MessagesImplementation.GetUserMessageImplementation("TextMsg"), g_MessagesImplementation.TextMessageUserMessageImplementation, "TextMsg registry name");
g_Assert.equal(g_MessagesImplementation.GetUserMessageImplementation(6), g_MessagesImplementation.TextMessageUserMessageImplementation, "TextMsg registry index");
g_Assert.throws(() => g_MessagesImplementation.GetUserMessageImplementation({}), "registry rejects object lookup");
VerifyUnsupportedRegisteredMessage();

const g_InvalidUserMessageRegistryKey = {};
g_MessagesImplementation.IMPLEMENTED_USER_MESSAGES.set(g_InvalidUserMessageRegistryKey, g_MessagesImplementation.HintTextUserMessageImplementation);

try {
	g_Assert.throws(() => g_MessagesImplementation.GetUserMessageImplementation(g_InvalidUserMessageRegistryKey), "registry rejects owned non-name keys");
} finally {
	g_Assert.equal(g_MessagesImplementation.IMPLEMENTED_USER_MESSAGES.delete(g_InvalidUserMessageRegistryKey), true, "IMPLEMENTED_USER_MESSAGES cleanup");
}

g_Assert.equal(Object.hasOwn(g_MessagesImplementation, "implementation"), false, "messages/implementation has no implementation snapshot");
g_Assert.equal(Object.hasOwn(g_MessagesImplementation, "TextMsgImpl"), false, "messages/implementation has no abbreviated class alias");
g_Assert.equal(Object.hasOwn(g_MessagesImplementation, "HudMsgImpl"), false, "messages/implementation has no HUD class alias");
g_Assert.equal(Object.hasOwn(g_MessagesImplementation, "VguiMenuImpl"), false, "messages/implementation has no VGUI class alias");

g_Assert.equal(g_MessagesBase.SCREEN_FADE_FRACTION_BITS, 9, "messages screen fade bits");
g_Assert.equal(g_MessagesBase.HUD_DESTINATION.Center, 4, "messages HUD destination");
g_Assert.equal(g_MessagesBase.SHAKE_COMMAND.Amplitude, 2, "messages shake command");
g_Assert.equal(g_MessagesBase.FADE_FLAGS.StayOut, 0x08, "messages fade flags");

const g_RawUserMessage = new g_MessagesBase.UserMessage("RawMessage");

g_Assert.throws(() => new g_MessagesBase.UserMessage(""), /non-empty/, "UserMessage rejects empty names");
g_Assert.throws(() => g_RawUserMessage.AddUserMessageField("", 7), /non-empty/, "UserMessage rejects empty field types");

g_RawUserMessage.AddUserMessageField("byte", 0x07).AddUserMessageField("string", "payload");

g_Assert.equal(g_RawUserMessage.SendUserMessage([1, 2]), true, "UserMessage send");
g_Assert.deepEqual(g_vecNativeCalls.at(-1), [
	"SendUserMessage",
	"RawMessage",
	[1, 2],
	[
		{ Type: "byte", Value: 0x07 },
		{ Type: "string", Value: "payload" },
	],
	false,
], "UserMessage payload");

const g_vecRawUserMessageFields = g_RawUserMessage.FieldEntries;
let g_unRawUserMessageFieldReadCount = 0;

Object.defineProperty(g_RawUserMessage, "FieldEntries", {
	configurable: true,

	get() {
		g_unRawUserMessageFieldReadCount += 1;

		return g_vecRawUserMessageFields;
	},
});

g_RawUserMessage.AddUserMessageField("byte", 0x08);

g_Assert.equal(g_unRawUserMessageFieldReadCount, 1, "UserMessage add reads live fields once");

const g_UserMessageCreatorFields = { Payload: "value" };
const g_UserMessageCreatorValue = new g_MessagesBase.UserMessageCreator(g_UserMessageCreatorFields);
let g_unUserMessageCreatorFieldReadCount = 0;

Object.defineProperty(g_UserMessageCreatorValue, "MessageFields", {
	configurable: true,

	get() {
		g_unUserMessageCreatorFieldReadCount += 1;

		return g_UserMessageCreatorFields;
	},
});

g_Assert.equal(g_UserMessageCreatorValue.GetUserMessageField("Payload"), "value", "UserMessageCreator.GetUserMessageField reads a field");
g_Assert.equal(g_unUserMessageCreatorFieldReadCount, 1, "UserMessageCreator.GetUserMessageField reads live fields once");

g_unUserMessageCreatorFieldReadCount = 0;
g_UserMessageCreatorValue.SetUserMessageField("Payload", "updated");

g_Assert.equal(g_unUserMessageCreatorFieldReadCount, 1, "UserMessageCreator.SetUserMessageField reads live fields once");
g_Assert.throws(() => g_UserMessageCreatorValue.GetUserMessageField(""), /non-empty/, "UserMessageCreator.GetUserMessageField rejects empty names");

const g_CustomMessageFields = {};
const g_CustomMessageCreator = new g_MessagesBase.CustomUserMessageCreator("Custom", g_CustomMessageFields);
const g_PrototypeFieldValue = { Payload: "not a prototype" };
g_Assert.equal(g_CustomMessageCreator.SetUserMessageField("__proto__", g_PrototypeFieldValue), g_CustomMessageCreator, "Custom creator field setter returns its creator");
g_Assert.equal(Object.getPrototypeOf(g_CustomMessageFields), Object.prototype, "Custom creator fields preserve their prototype");
g_Assert.deepEqual(Object.getOwnPropertyDescriptor(g_CustomMessageFields, "__proto__"), { value: g_PrototypeFieldValue, writable: true, enumerable: true, configurable: true }, "Custom creator stores prototype-like names as own fields");
g_Assert.equal(g_CustomMessageCreator.GetUserMessageField("__proto__"), g_PrototypeFieldValue, "Custom creator reads a prototype-like own field");
g_Assert.equal(g_CustomMessageCreator.BuildUserMessagePayload([]).MessageFields.__proto__, g_PrototypeFieldValue, "Custom creator payload preserves a prototype-like own field");

let g_unCreatorSetterCallCount = 0;
let g_CreatorSetterValue = null;
const g_CreatorAccessorFields = {};
Object.defineProperty(g_CreatorAccessorFields, "Payload", {
	enumerable: true,

	set(FieldValue) {
		g_unCreatorSetterCallCount += 1;
		g_CreatorSetterValue = FieldValue;
	},
});

const g_AccessorMessageCreator = new g_MessagesBase.UserMessageCreator(g_CreatorAccessorFields);
g_AccessorMessageCreator.SetUserMessageField("Payload", "updated");

g_Assert.equal(g_unCreatorSetterCallCount, 1, "Creator field updates retain existing setters");
g_Assert.equal(g_CreatorSetterValue, "updated", "Creator field updates pass the original value to existing setters");
g_Assert.throws(() => g_AccessorMessageCreator.SetUserMessageField("Unknown", "value"), /Invalid message field/, "Strict creator still rejects unknown fields");
g_Assert.equal(Object.hasOwn(g_CreatorAccessorFields, "Unknown"), false, "Strict creator does not add rejected fields");

for (const MessageConstructor of [
	g_MessagesBase.UserMessageCreator,
	g_MessagesBase.TextMessage,
	g_MessagesBase.SayText,
	g_MessagesBase.SayText2,
	g_MessagesBase.HintText,
	g_MessagesBase.HUDTextMessage,
	g_MessagesBase.KeyHintText,
	g_MessagesBase.HUDMessage,
]) {
	g_Assert.deepEqual(Object.getOwnPropertyDescriptor(MessageConstructor, "TRANSLATABLE_FIELDS"), { value: MessageConstructor.TRANSLATABLE_FIELDS, writable: true, enumerable: true, configurable: true }, `${MessageConstructor.name} retains its own static field descriptor`);
	g_Assert.equal(Object.isFrozen(MessageConstructor.TRANSLATABLE_FIELDS), true, `${MessageConstructor.name} translated field defaults are frozen`);
}

g_Assert.deepEqual(g_MessagesBase.UserMessageCreator.TRANSLATABLE_FIELDS, [], "Base creator retains empty translated field defaults");
g_Assert.deepEqual(g_MessagesBase.TextMessage.TRANSLATABLE_FIELDS, ["Message"], "Text message retains its translated field defaults");
g_Assert.deepEqual(Object.getOwnPropertyDescriptor(g_MessagesBase.TextMessage, "MessageName"), { value: "TextMessage", writable: true, enumerable: true, configurable: true }, "Text message retains its own static message name descriptor");
g_Assert.deepEqual(Object.keys(g_MessagesBase.TextMessage), ["TRANSLATABLE_FIELDS", "MessageName"], "Text message retains its static field definition order");

for (const MessageConstructor of [
	g_MessagesBase.VGUIMenu,
	g_MessagesBase.ShowMenu,
	g_MessagesBase.SayText,
	g_MessagesBase.SayText2,
	g_MessagesBase.HintText,
	g_MessagesBase.Shake,
	g_MessagesBase.ResetHUD,
]) {
	const strExpectedMessageName = (MessageConstructor === g_MessagesBase.ResetHUD) ? "ResetHud" : MessageConstructor.name;
	g_Assert.deepEqual(Object.getOwnPropertyDescriptor(MessageConstructor, "MessageName"), { value: strExpectedMessageName, writable: true, enumerable: true, configurable: true }, `${MessageConstructor.name} retains its own static message name descriptor`);
}

g_Assert.deepEqual(Object.getOwnPropertyDescriptor(g_MessagesBase.ShowMenu, "ChunkSize"), { value: 0x3E, writable: true, enumerable: true, configurable: true }, "ShowMenu retains its own static chunk size descriptor");
g_Assert.deepEqual(Object.keys(g_MessagesBase.ShowMenu), ["ChunkSize", "MessageName"], "ShowMenu retains its static field definition order");

for (const MessageType of [
	{ Constructor: g_MessagesBase.HUDTextMessage, MessageName: "TextMsg", TranslatableFields: ["Message", "Parameter1", "Parameter2", "Parameter3", "Parameter4"] },
	{ Constructor: g_MessagesBase.KeyHintText, MessageName: "KeyHintText", TranslatableFields: ["Hints"] },
	{ Constructor: g_MessagesBase.HUDMessage, MessageName: "HudMsg", TranslatableFields: ["Message"] },
]) {
	g_Assert.deepEqual(Object.getOwnPropertyDescriptor(MessageType.Constructor, "MessageName"), { value: MessageType.MessageName, writable: true, enumerable: true, configurable: true }, `${MessageType.Constructor.name} retains its own static message name descriptor`);
	g_Assert.deepEqual(MessageType.Constructor.TRANSLATABLE_FIELDS, MessageType.TranslatableFields, `${MessageType.Constructor.name} retains its translated field defaults`);
	g_Assert.deepEqual(Object.keys(MessageType.Constructor), ["TRANSLATABLE_FIELDS", "MessageName"], `${MessageType.Constructor.name} retains its static field definition order`);
}

g_Assert.deepEqual(Object.getOwnPropertyDescriptor(g_MessagesBase.Fade, "MessageName"), { value: "Fade", writable: true, enumerable: true, configurable: true }, "Fade retains its own static message name descriptor");

class EmptyMessageNameUserMessageCreator extends g_MessagesBase.UserMessageCreator {
}

Object.defineProperty(EmptyMessageNameUserMessageCreator, "MessageName", { configurable: true, enumerable: true, writable: true, value: "" });

class EmptyTranslatableFieldUserMessageCreator extends g_MessagesBase.UserMessageCreator {
}

Object.defineProperty(EmptyTranslatableFieldUserMessageCreator, "TRANSLATABLE_FIELDS", { configurable: true, enumerable: true, writable: true, value: Object.freeze([""]) });

g_Assert.throws(() => new EmptyMessageNameUserMessageCreator().BuildUserMessagePayload([]), /non-empty/, "UserMessageCreator empty name");
g_Assert.throws(() => new EmptyTranslatableFieldUserMessageCreator({ Payload: "value" }).TranslateUserMessageFields(), /non-empty/, "UserMessageCreator rejects empty translatable field names");

const g_TextMessage = new g_MessagesBase.TextMessage("Hello {Name}", { Name: "Ren" });
let g_unTextMessageFieldReadCount = 0;

const g_GetterBackedTextMessage = new g_MessagesBase.TextMessage("Fallback", {
	get Message() {
		g_unTextMessageFieldReadCount += 1;

		return "Getter message";
	},
});

g_Assert.equal(g_TextMessage.SendUserMessage(1, { Name: "Ren" }), true, "TextMessage send");
g_Assert.deepEqual(g_vecNativeCalls.at(-1), ["SendClientConsoleMessage", 1, "Hello Ren"], "TextMessage native call");
g_Assert.equal(g_GetterBackedTextMessage.MessageFields.Message, "Getter message", "TextMessage keeps getter value");
g_Assert.equal(g_unTextMessageFieldReadCount, 1, "TextMessage reads message getter once");

const g_bLiteralTextSendResult = g_MessagesBase.SendUserMessageValue(1, "Hello {Name}", { Message: "Override", Name: "Ren" });
g_Assert.equal(g_bLiteralTextSendResult, true, "SendUserMessageValue sends literal text");
g_Assert.deepEqual(g_vecNativeCalls.at(-1), ["SendClientConsoleMessage", 1, "Hello Ren"], "SendUserMessageValue tokens cannot replace literal text");

const g_SayTextMessage = new g_MessagesBase.SayText("Hello {Name}", { Chat: true, Color: "\x04", SenderIndex: 2 });
g_Assert.equal(g_SayTextMessage.SendUserMessage(1, { Name: "Ren" }), true, "SayText send");
g_Assert.deepEqual(g_vecNativeCalls.at(-1), [
	"SendUserMessage",
	"SayText",
	[1],
	[
		{ Type: "byte", Value: 0x02 },
		{ Type: "string", Value: "\x04Hello Ren" },
		{ Type: "byte", Value: 0x01 },
	],
	true,
], "SayText native fields");
g_Assert.equal(Object.isFrozen(g_MessagesBase.SayText.TRANSLATABLE_FIELDS), true, "SayText translatable fields frozen");
g_Assert.throws(() => new g_MessagesBase.SayText("Hello", { Chat: null }), /boolean/, "SayText rejects null chat option");
g_Assert.throws(() => new g_MessagesBase.SayText("Hello", { SenderIndex: undefined }), /SenderIndex/, "SayText SenderIndex validation");

const g_SayText2Message = new g_MessagesBase.SayText2("Hello {Name}", { Chat: true, Color: "\x04", Parameter1: "{Name}", Parameter2: "two", SenderIndex: 2 });
const g_unSayText2NativeCallStartIndex = g_vecNativeCalls.length;

g_Assert.equal(g_SayText2Message.SendUserMessage([1, 2], { Name: "Ren" }), true, "SayText2 send");

const g_unSayText2NativeCallEndIndex = g_vecNativeCalls.length;
let g_vecFirstSayText2NativeCall = undefined;
let g_unSayText2NativeCallCount = 0;
let g_unSayText2NativeCallIndex = g_unSayText2NativeCallStartIndex;
while (g_unSayText2NativeCallIndex < g_unSayText2NativeCallEndIndex) {
	const vecSayText2NativeCall = g_vecNativeCalls[g_unSayText2NativeCallIndex];

	g_unSayText2NativeCallIndex += 1;

	if ((vecSayText2NativeCall[0] !== "SendUserMessage") || (vecSayText2NativeCall[1] !== "SayText2")) {
		continue;
	}

	if (g_vecFirstSayText2NativeCall === undefined) {
		g_vecFirstSayText2NativeCall = vecSayText2NativeCall;
	}

	g_unSayText2NativeCallCount += 1;
}

g_Assert.equal(g_unSayText2NativeCallCount, 2, "SayText2 language groups");
g_Assert.equal(g_vecFirstSayText2NativeCall[3][0].Value, 2, "SayText2 sender index");
g_Assert.equal(g_vecFirstSayText2NativeCall[3][3].Value, "Ren", "SayText2 translated parameter");
g_Assert.equal(Object.isFrozen(g_MessagesBase.SayText2.TRANSLATABLE_FIELDS), true, "SayText2 translatable fields frozen");
g_Assert.throws(() => new g_MessagesBase.SayText2("Hello", { Parameter1: null }), /string/, "SayText2 rejects null parameter option");
g_Assert.throws(() => new g_MessagesBase.SayText2("Hello", { SenderIndex: undefined }), /SenderIndex/, "SayText2 SenderIndex");

const g_VGUIMenuMessage = new g_MessagesBase.VGUIMenu("info", { title: "SourceJS" }, true);
const g_vecVGUIMenuFields = g_VGUIMenuMessage.BuildUserMessageBitBufferFields(g_VGUIMenuMessage.MessageFields);
g_Assert.equal(g_vecVGUIMenuFields[0].Value, "info", "VGUIMenu name");
g_Assert.equal(g_vecVGUIMenuFields[2].Value, 1, "VGUIMenu Subkey count");
g_Assert.throws(() => new g_MessagesBase.VGUIMenu("info", [], true), "VGUIMenu rejects array Subkeys");

const g_unShowMenuValidSlotsBitCount = 16;
const g_unShowMenuDisplayTimeBitCount = 8;
const g_ShowMenuMessage = new g_MessagesBase.ShowMenu("x".repeat(70), 0x7F, 5);
const g_unShowMenuNativeCallStartIndex = g_vecNativeCalls.length;

g_Assert.equal(g_ShowMenuMessage.SendUserMessage(1), true, "ShowMenu send");
g_Assert.equal(g_vecNativeCalls.length - g_unShowMenuNativeCallStartIndex, 2, "ShowMenu chunk count");
g_Assert.equal(g_MessagesBase.ShowMenu.ChunkSize, 0x3E, "ShowMenu chunk size");

const g_vecFirstShowMenuNativeCall = g_vecNativeCalls[g_unShowMenuNativeCallStartIndex];
const g_vecFinalShowMenuNativeCall = g_vecNativeCalls[g_unShowMenuNativeCallStartIndex + 1];
const g_vecFirstShowMenuBitBufferFields = g_vecFirstShowMenuNativeCall[3];
const g_vecFinalShowMenuBitBufferFields = g_vecFinalShowMenuNativeCall[3];
g_Assert.equal(g_vecFirstShowMenuBitBufferFields.length, 4, "ShowMenu bitbuffer field count");
g_Assert.equal(g_vecFirstShowMenuBitBufferFields[0].Type, "bits", "ShowMenu valid-slot field type");
g_Assert.equal(g_vecFirstShowMenuBitBufferFields[0].Bits, g_unShowMenuValidSlotsBitCount, "ShowMenu valid-slot field width");
g_Assert.equal(g_vecFirstShowMenuBitBufferFields[1].Type, "bits", "ShowMenu display-time field type");
g_Assert.equal(g_vecFirstShowMenuBitBufferFields[1].Bits, g_unShowMenuDisplayTimeBitCount, "ShowMenu display-time field width");
g_Assert.equal(g_vecFirstShowMenuBitBufferFields[2].Type, "byte", "ShowMenu continuation field type");
g_Assert.equal(g_vecFirstShowMenuBitBufferFields[3].Type, "string", "ShowMenu text field type");
g_Assert.equal(g_vecFirstShowMenuBitBufferFields[2].Value, 0x01, "ShowMenu first chunk continuation flag");
g_Assert.equal(g_vecFinalShowMenuBitBufferFields[2].Value, 0x00, "ShowMenu final chunk continuation flag");

const g_strShowMenuASCIIPrefix = "x".repeat(61);
const g_strLocalizedShowMenu = `${g_strShowMenuASCIIPrefix}🎮 ${"Выбор карты・地図を選ぶ ".repeat(5)}`;
const g_unLocalizedShowMenuStart = g_vecNativeCalls.length;
g_Assert.equal(new g_MessagesBase.ShowMenu(g_strLocalizedShowMenu).SendUserMessage(1), true, "ShowMenu localized send");
const g_vecLocalizedShowMenuFields = g_vecNativeCalls.slice(g_unLocalizedShowMenuStart).map((Call) => Call[3]);
g_Assert.equal(g_vecLocalizedShowMenuFields[0][3].Value, g_strShowMenuASCIIPrefix, "ShowMenu puts the entire emoji in the next chunk");
let g_strReassembledMenu = "";
for (const [unIndex, vecFields] of g_vecLocalizedShowMenuFields.entries()) {
	const strChunk = vecFields[3].Value;
	g_Assert.ok(Buffer.byteLength(strChunk, "utf8") <= g_MessagesBase.ShowMenu.ChunkSize, "ShowMenu chunk fits the UTF-8 byte limit");
	g_Assert.equal(Buffer.from(strChunk).toString("utf8"), strChunk, "ShowMenu does not split UTF-16 surrogate pairs");
	g_Assert.equal(vecFields[2].Value, ((unIndex + 1) < g_vecLocalizedShowMenuFields.length) ? 1 : 0, "ShowMenu localized continuation flag");
	g_strReassembledMenu += strChunk;
}

g_Assert.equal(g_strReassembledMenu, g_strLocalizedShowMenu, "ShowMenu preserves localized text across chunks");

const g_unMaximumShowMenuValidSlots = 0xFFFF;
const g_nIndefiniteShowMenuDisplayTime = -1;
const g_unIndefiniteShowMenuDisplayTimeByte = 0xFF;
const g_ShowMenuBoundaryMessage = new g_MessagesBase.ShowMenu("Boundary", g_unMaximumShowMenuValidSlots, g_nIndefiniteShowMenuDisplayTime);
g_Assert.equal(g_ShowMenuBoundaryMessage.SendUserMessage(1), true, "ShowMenu boundary send");

const g_vecShowMenuBoundaryFields = g_vecNativeCalls.at(-1)[3];
ValidateUserMessageFields("bitbuffer", g_vecShowMenuBoundaryFields);
g_Assert.equal(g_vecShowMenuBoundaryFields[0].Value, g_unMaximumShowMenuValidSlots, "ShowMenu preserves the maximum valid-slot mask");
g_Assert.equal(g_vecShowMenuBoundaryFields[1].Value, g_unIndefiniteShowMenuDisplayTimeByte, "ShowMenu preserves the signed display-time byte");

const g_ShowMenuBoundaryBitBuffer = WriteBitBufferFields(g_vecShowMenuBoundaryFields);
const g_ShowMenuReferenceBitBuffer = new g_Bitbuffers.BitBufferWrite(g_unSmallMessageBitBufferCapacityByteCount);
g_ShowMenuReferenceBitBuffer.WriteWord(g_unMaximumShowMenuValidSlots);
g_ShowMenuReferenceBitBuffer.WriteChar(g_nIndefiniteShowMenuDisplayTime);
g_ShowMenuReferenceBitBuffer.WriteByte(0x00);
g_ShowMenuReferenceBitBuffer.WriteString("Boundary");

g_Assert.equal(g_ShowMenuBoundaryBitBuffer.CurrentBit, g_ShowMenuReferenceBitBuffer.CurrentBit, "ShowMenu bit descriptors preserve the wire length");
g_Assert.deepEqual(g_ShowMenuBoundaryBitBuffer.Bytes.slice(0, Math.ceil(g_ShowMenuBoundaryBitBuffer.CurrentBit / g_unShowMenuDisplayTimeBitCount)), g_ShowMenuReferenceBitBuffer.Bytes.slice(0, Math.ceil(g_ShowMenuReferenceBitBuffer.CurrentBit / g_unShowMenuDisplayTimeBitCount)), "ShowMenu bit descriptors preserve the wire bytes");

const g_ShowMenuMessageFields = g_ShowMenuMessage.MessageFields;
g_ShowMenuMessageFields.ValidSlots = undefined;

g_Assert.throws(() => g_ShowMenuMessage.SendUserMessage(1), /ValidSlots/, "ShowMenu rejects missing live valid slots");
g_Assert.throws(() => g_ShowMenuMessage.BuildUserMessageProtobufFields(g_ShowMenuMessageFields), /ValidSlots/, "ShowMenu protobuf live ValidSlots");

g_ShowMenuMessageFields.ValidSlots = 0x7F;

const g_ShakeMessage = new g_MessagesBase.Shake({ Amplitude: 2.5, Command: g_MessagesBase.SHAKE_COMMAND.Amplitude, Duration: 4, Frequency: 3 });
g_Assert.equal(g_ShakeMessage.BuildUserMessageBitBufferFields(g_ShakeMessage.MessageFields)[0].Value, g_MessagesBase.SHAKE_COMMAND.Amplitude, "Shake command");
g_Assert.throws(() => new g_MessagesBase.Shake({ Duration: 1 }), /Amplitude/, "Shake requires Amplitude");
g_Assert.throws(() => new g_MessagesBase.Shake({ Amplitude: 1 }), /Duration/, "Shake requires Duration");
g_Assert.throws(() => new g_MessagesBase.Shake({ Amplitude: 1, Command: null, Duration: 1 }), /Command/, "Shake rejects null Command");

const g_ResetHUDMessage = new g_MessagesBase.ResetHUD(false);
g_Assert.equal(g_ResetHUDMessage.BuildUserMessageBitBufferFields(g_ResetHUDMessage.MessageFields)[0].Value, 0x00, "ResetHUD value");
g_Assert.equal(g_ResetHUDMessage.GetUserMessageName(), "ResetHud", "ResetHUD engine message name");
g_Assert.throws(() => g_ResetHUDMessage.BuildUserMessageBitBufferFields({ Reset: null }), /boolean/, "ResetHUD rejects null live reset state");

const g_HUDTextMessage = new g_MessagesBase.HUDTextMessage("Center {Name}", { Destination: g_MessagesBase.HUD_DESTINATION.Center, Parameter1: "one" });
const g_HUDTextMessageFields = g_HUDTextMessage.MessageFields;
g_HUDTextMessageFields.Name = "Ren";

const g_vecTranslatedHUDTextMessageFields = g_HUDTextMessage.BuildUserMessageBitBufferFields(g_HUDTextMessageFields);
g_Assert.equal(g_HUDTextMessage.GetUserMessageName(), "TextMsg", "HUDTextMessage engine message name");
g_Assert.equal(g_vecTranslatedHUDTextMessageFields[1].Value, "Center Ren", "HUDTextMessage formatted message");
g_Assert.equal(Object.isFrozen(g_MessagesBase.HUDTextMessage.TRANSLATABLE_FIELDS), true, "HUDTextMessage translatable fields frozen");
g_Assert.throws(() => new g_MessagesBase.HUDTextMessage(null), /string/, "HUDTextMessage requires string message");
g_Assert.throws(() => new g_MessagesBase.HUDTextMessage("Center", { Parameter1: null }), /string/, "HUDTextMessage rejects null parameter option");

function VerifyKeyHintTextWireContracts() {
	const unExpectedStringCount = 0x01;
	const unByteCapacity = 0x100;
	const vecHintTemplates = ["Use {Key}", "Reload"];
	const Message = new g_MessagesBase.KeyHintText(vecHintTemplates);
	const MessageFields = Message.TranslateUserMessageFields("en", { Key: "E" });
	const strExpectedHintText = "Use E\nReload";
	const vecExpectedFields = [{ Type: "byte", Value: unExpectedStringCount }, { Type: "string", Value: strExpectedHintText }];
	g_Assert.equal(Message.MessageFields.Hints, vecHintTemplates, "KeyHintText retains the public hint array");
	g_Assert.deepEqual(Message.BuildUserMessageBitBufferFields(MessageFields), vecExpectedFields, "KeyHintText emits one newline-joined wire string");

	const CreatorWriter = new g_Bitbuffers.BitBufferWrite(unByteCapacity);
	Message.WriteUserMessageToBitBuffer(CreatorWriter, MessageFields);

	// Mirror the selected TF2 client's header/string consumption, not a live engine test.
	const CreatorReader = new g_Bitbuffers.BitBufferRead(CreatorWriter);
	g_Assert.equal(CreatorReader.ReadByte(), unExpectedStringCount, "KeyHintText creator writes the SDK-required count of one");
	g_Assert.equal(CreatorReader.ReadString(), strExpectedHintText, "KeyHintText creator writes the complete display text");

	const CodecWriter = new g_Bitbuffers.BitBufferWrite(unByteCapacity);
	g_MessagesImplementation.KeyHintTextUserMessageImplementation.WriteUserMessageToBitBuffer(CodecWriter, MessageFields);

	const CodecReader = new g_Bitbuffers.BitBufferRead(CodecWriter);
	g_Assert.equal(CodecReader.ReadByte(), unExpectedStringCount, "KeyHintText codec writes the SDK-required count of one");
	g_Assert.equal(CodecReader.ReadString(), strExpectedHintText, "KeyHintText codec writes the complete display text");

	const DecodedData = g_MessagesImplementation.KeyHintTextUserMessageImplementation.ReadUserMessageFromBitBuffer(new g_Bitbuffers.BitBufferRead(CodecWriter));
	g_Assert.deepEqual(DecodedData.Hints, [strExpectedHintText], "KeyHintText decoder exposes the single wire string without inventing array boundaries");

	for (const vecHints of [[], ["A\nB", "C"]]) {
		const HintMessage = new g_MessagesBase.KeyHintText(vecHints);
		const strExpectedText = vecHints.join("\n");
		g_Assert.deepEqual(HintMessage.BuildUserMessageBitBufferFields(HintMessage.MessageFields), [{ Type: "byte", Value: unExpectedStringCount }, { Type: "string", Value: strExpectedText }], "KeyHintText creator preserves empty clears and embedded newlines");

		const Writer = new g_Bitbuffers.BitBufferWrite(unByteCapacity);
		g_MessagesImplementation.KeyHintTextUserMessageImplementation.WriteUserMessageToBitBuffer(Writer, { Hints: vecHints });

		const Reader = new g_Bitbuffers.BitBufferRead(Writer);
		g_Assert.equal(Reader.ReadByte(), unExpectedStringCount, "KeyHintText empty/multiline codec header");
		g_Assert.equal(Reader.ReadString(), strExpectedText, "KeyHintText empty/multiline codec body");

		const MessageData = g_MessagesImplementation.KeyHintTextUserMessageImplementation.ReadUserMessageFromBitBuffer(new g_Bitbuffers.BitBufferRead(Writer));
		g_Assert.deepEqual(MessageData.Hints, [strExpectedText], "KeyHintText empty/multiline decoding retains one wire string");
	}

	for (const unInvalidStringCount of [0, 2]) {
		let unStringReadCount = 0;
		const InvalidReader = {
			ReadByte() {
				return unInvalidStringCount;
			},

			ReadString() {
				unStringReadCount += 1;

				return "Unexpected";
			},
		};
		g_Assert.throws(() => g_MessagesImplementation.KeyHintTextUserMessageImplementation.ReadUserMessageFromBitBuffer(InvalidReader), /exactly one bitbuffer string/, "KeyHintText rejects malformed counts");
		g_Assert.equal(unStringReadCount, 0, "KeyHintText rejects malformed counts before consuming a string");
	}

	const ProtobufWriter = new ProtobufBuffer();
	g_MessagesImplementation.KeyHintTextUserMessageImplementation.WriteUserMessageToProtobuf(ProtobufWriter, MessageFields);

	const ProtobufData = g_MessagesImplementation.KeyHintTextUserMessageImplementation.ReadUserMessageFromProtobuf(ProtobufWriter);
	g_Assert.deepEqual(ProtobufData.Hints, ["Use E", "Reload"], "KeyHintText protobuf retains separate hints");
	g_Assert.deepEqual(Message.BuildUserMessageProtobufFields(MessageFields), [{ Kind: "ADD", Name: "hints", Type: "string", Value: "Use E" }, { Kind: "ADD", Name: "hints", Type: "string", Value: "Reload" }], "KeyHintText creator uses ADD operations for each hint");
	g_Assert.deepEqual(vecHintTemplates, ["Use {Key}", "Reload"], "KeyHintText wire builders do not mutate the source hints");

	const EmptyProtobufWriter = new ProtobufBuffer();
	g_MessagesImplementation.KeyHintTextUserMessageImplementation.WriteUserMessageToProtobuf(EmptyProtobufWriter, { Hints: [] });

	const EmptyProtobufData = g_MessagesImplementation.KeyHintTextUserMessageImplementation.ReadUserMessageFromProtobuf(EmptyProtobufWriter);
	g_Assert.deepEqual(EmptyProtobufData.Hints, [], "KeyHintText protobuf preserves an empty repeated field");
}

VerifyKeyHintTextWireContracts();

const g_KeyHintTextMessage = new g_MessagesBase.KeyHintText(["Use {Key}", "Reload"]);
g_Assert.equal(g_KeyHintTextMessage.toString({ Hints: ["Use E", "Reload"] }), "Use E\nReload", "KeyHintText text");
g_Assert.throws(() => new g_MessagesBase.KeyHintText("Use"), "KeyHintText rejects scalar hints");
g_Assert.throws(() => new g_MessagesBase.KeyHintText(["Use", null]), /string/, "KeyHintText rejects non-string hint");
g_Assert.equal(Object.isFrozen(g_MessagesBase.KeyHintText.TRANSLATABLE_FIELDS), true, "KeyHintText translatable fields frozen");

g_KeyHintTextMessage.MessageFields.Hints.push("Open");

g_Assert.equal(g_KeyHintTextMessage.toString(), "Use {Key}\nReload\nOpen", "KeyHintText reads live hint array");

const g_vecKeyHintTextLiveHints = g_KeyHintTextMessage.MessageFields.Hints;
let g_unKeyHintTextHintReadCount = 0;

Object.defineProperty(g_KeyHintTextMessage.MessageFields, "Hints", {
	configurable: true,

	get() {
		g_unKeyHintTextHintReadCount += 1;

		return g_vecKeyHintTextLiveHints;
	},
});

g_KeyHintTextMessage.TranslateUserMessageFields();

g_Assert.equal(g_unKeyHintTextHintReadCount, 1, "KeyHintText translation reads hints once");

function VerifyTypedScreenEffectContracts() {
	const unFadeFactor = 0x01 << g_MessagesBase.SCREEN_FADE_FRACTION_BITS;
	const Color = { Red: 0x0A, Green: 0x14, Blue: 0x1E, Alpha: 0x28 };
	const FadeMessage = new g_MessagesBase.Fade({ Duration: 1, HoldTime: 2, Color });
	g_Assert.equal(FadeMessage.MessageFields.Flags, g_MessagesBase.FADE_FLAGS.In, "Fade uses the selected SDK's default flag");
	g_Assert.equal(FadeMessage.MessageFields.Color, Color, "Fade retains the option color");
	g_Assert.deepEqual(FadeMessage.BuildUserMessageBitBufferFields(FadeMessage.MessageFields).slice(0, 3), [{ Type: "short", Value: unFadeFactor }, { Type: "short", Value: 2 * unFadeFactor }, { Type: "short", Value: g_MessagesBase.FADE_FLAGS.In }], "Fade writes three encoded short fields");

	const DefaultFade = new g_MessagesBase.Fade({ Duration: 0, HoldTime: 0 });
	g_Assert.deepEqual(DefaultFade.MessageFields.Color, { Red: 0xFF, Green: 0xFF, Blue: 0xFF, Alpha: 0xFF }, "Fade defaults to opaque white");

	for (const strMethodName of ["BuildUserMessageBitBufferFields", "BuildUserMessageProtobufFields"]) {
		const FractionalFade = new g_MessagesBase.Fade({ Duration: 0.1, HoldTime: 0 });
		g_Assert.throws(() => FractionalFade[strMethodName](FractionalFade.MessageFields), /safe integer/, "Fade never rounds fractional fixed-point values");

		const NegativeFade = new g_MessagesBase.Fade({ Duration: -1, HoldTime: -2 });
		const vecNegativeFields = NegativeFade[strMethodName](NegativeFade.MessageFields);
		g_Assert.equal(vecNegativeFields[0].Value, -unFadeFactor, "Fade normalizer does not reject negative duration");
		g_Assert.equal(vecNegativeFields[1].Value, -2 * unFadeFactor, "Fade normalizer does not reject negative hold time");
	}

	const DefaultHUD = new g_MessagesBase.HUDMessage("Defaults");
	g_Assert.deepEqual(DefaultHUD.MessageFields, {
		Channel: 0,
		Effect: 0,
		EffectTime: 0,
		FadeIn: 0,
		FadeOut: 0,
		HoldTime: 4,
		Message: "Defaults",
		PrimaryColor: { Red: 0xFF, Green: 0xFF, Blue: 0xFF, Alpha: 0xFF },
		SecondaryColor: { Red: 0xFF, Green: 0xFF, Blue: 0xFF, Alpha: 0xFF },
		X: -1,
		Y: -1,
	}, "HUDMessage default fields match documentation");

	const HUDMessage = new g_MessagesBase.HUDMessage("Live color", { Channel: 0x12C, Effect: 0x12C, FadeIn: -1, PrimaryColor: Color });
	g_Assert.equal(HUDMessage.MessageFields.PrimaryColor, Color, "HUDMessage retains the option color");

	Color.Red = 0x0B;

	const vecHUDFields = HUDMessage.BuildUserMessageBitBufferFields(HUDMessage.MessageFields);
	g_Assert.equal(FadeMessage.BuildUserMessageBitBufferFields(FadeMessage.MessageFields)[3].Value, 0x0B, "Fade re-reads live color components");
	g_Assert.equal(vecHUDFields[3].Value, 0x0B, "HUDMessage re-reads live color components");
	g_Assert.equal(vecHUDFields[0].Value, 0x12C, "HUDMessage builder does not enforce a channel byte range");
	g_Assert.equal(vecHUDFields[11].Value, 0x12C, "HUDMessage builder does not enforce an effect byte range");
	g_Assert.equal(vecHUDFields[12].Value, -1, "HUDMessage normalizer does not reject negative timing");

	for (const bResetEnabled of [true, false]) {
		const ResetMessage = new g_MessagesBase.ResetHUD(bResetEnabled);
		const unExpectedByte = bResetEnabled ? 0x01 : 0x00;
		g_Assert.deepEqual(ResetMessage.BuildUserMessageBitBufferFields(ResetMessage.MessageFields), [{ Type: "byte", Value: unExpectedByte }], "ResetHUD emits one boolean byte");
		g_Assert.deepEqual(ResetMessage.BuildUserMessageProtobufFields(ResetMessage.MessageFields), [{ Kind: "SET", Name: "reset", Type: "bool", Value: bResetEnabled }], "ResetHUD preserves its external protobuf boolean");
		g_Assert.equal(ResetMessage.GetUserMessageName(), "ResetHud", "ResetHUD preserves the exact engine registry name");
	}

	g_Assert.equal(new g_MessagesBase.ResetHUD().MessageFields.Reset, true, "ResetHUD defaults to true");
}

VerifyTypedScreenEffectContracts();

const g_FadeMessage = new g_MessagesBase.Fade({ Color: { Red: 0x0A, Green: 0x14, Blue: 0x1E, Alpha: 0x28 }, Duration: 1, Flags: g_MessagesBase.FADE_FLAGS.Out, HoldTime: 2 });
const g_FadeMessageFields = g_FadeMessage.MessageFields;
const g_vecFadeMessageWireFields = g_FadeMessage.BuildUserMessageBitBufferFields(g_FadeMessageFields);
g_Assert.equal(g_vecFadeMessageWireFields[0].Value, 0x0200, "Fade duration");
g_Assert.equal(g_vecFadeMessageWireFields[5].Value, 0x1E, "Fade blue component");
g_Assert.throws(() => new g_MessagesBase.Fade({ HoldTime: 1 }), /Duration/, "Fade requires Duration");
g_Assert.throws(() => new g_MessagesBase.Fade({ Duration: 1 }), /HoldTime/, "Fade requires HoldTime");
g_Assert.throws(() => new g_MessagesBase.Fade({ Color: { Red: 0x0A, Green: 0x14, Blue: 0x1E }, Duration: 1, HoldTime: 2 }), /Fade Color Alpha/, "Fade requires every Color component");

g_FadeMessageFields.Color = { Red: 0x0A, Green: 0x14, Blue: 0x1E };

g_Assert.throws(() => g_FadeMessage.BuildUserMessageBitBufferFields(g_FadeMessageFields), /Fade Color Alpha/, "Fade rejects incomplete live colors");

g_FadeMessageFields.Color = { Red: 0x0A, Green: 0x14, Blue: 0x1E, Alpha: 0x28 };

const g_HUDMessagePrimaryColor = { Red: 0x01, Green: 0x02, Blue: 0x03, Alpha: 0x04 };
const g_HUDMessage = new g_MessagesBase.HUDMessage("HUD", { Channel: 9, EffectTime: 0.4, PrimaryColor: g_HUDMessagePrimaryColor, SecondaryColor: { Red: 0x05, Green: 0x06, Blue: 0x07, Alpha: 0x08 } });
const g_HUDMessageFields = g_HUDMessage.MessageFields;
const g_vecHUDMessageWireFields = g_HUDMessage.BuildUserMessageBitBufferFields(g_HUDMessageFields);
const g_vecHUDMessageProtobufFields = g_HUDMessage.BuildUserMessageProtobufFields(g_HUDMessageFields);
g_Assert.equal(g_HUDMessage.GetUserMessageName(), "HudMsg", "HUDMessage engine message name");
g_Assert.equal(g_vecHUDMessageWireFields[0].Value, 9, "HUDMessage channel");
g_Assert.equal(g_vecHUDMessageProtobufFields[8].Value, 0.4, "HUDMessage effect time");
g_Assert.equal(Object.isFrozen(g_MessagesBase.HUDMessage.TRANSLATABLE_FIELDS), true, "HUDMessage translatable fields frozen");
g_Assert.throws(() => new g_MessagesBase.HUDMessage(null), /string/, "HUDMessage requires string message");
g_Assert.throws(() => new g_MessagesBase.HUDMessage("HUD", { EffectTime: null }), /EffectTime/, "HUDMessage rejects null EffectTime");

g_HUDMessagePrimaryColor.Red = 0x0B;

g_Assert.equal(g_HUDMessage.BuildUserMessageBitBufferFields(g_HUDMessageFields)[3].Value, 0x0B, "HUDMessage retains live option Color");

g_HUDMessageFields.PrimaryColor = { Red: 0x01, Green: 0x02, Blue: 0x03 };

g_Assert.throws(() => g_HUDMessage.BuildUserMessageBitBufferFields(g_HUDMessageFields), /HUDMessage PrimaryColor Alpha/, "HUDMessage bitbuffer rejects incomplete live primary color");
g_Assert.throws(() => g_HUDMessage.BuildUserMessageProtobufFields(g_HUDMessageFields), /HUDMessage PrimaryColor Alpha/, "HUDMessage protobuf rejects incomplete live primary color");

g_HUDMessageFields.PrimaryColor = { Red: 0x01, Green: 0x02, Blue: 0x03, Alpha: 0x04 };

const g_HUDMessageProtobufBuffer = new ProtobufBuffer();

ValidateUserMessageFields("protobuf", g_HUDMessage.BuildUserMessageProtobufFields(g_HUDMessageFields));
g_HUDMessage.WriteUserMessageToProtobuf(g_HUDMessageProtobufBuffer);

g_Assert.equal(g_HUDMessageProtobufBuffer.GetInt32("channel"), 9, "HUDMessage protobuf channel write");
g_Assert.equal(g_HUDMessageProtobufBuffer.GetMutableMessage("pos").GetFloat("x"), -1, "HUDMessage protobuf nested position write");
g_Assert.equal(g_HUDMessageProtobufBuffer.GetMutableMessage("clr2").GetInt32("a"), 0x08, "HUDMessage protobuf nested color write");

g_Assert.throws(() => new g_MessagesBase.UserMessageCreator({}).BuildUserMessageBitBufferFields({}), "UserMessageCreator abstract bitbuffer fields");
g_Assert.equal(Object.hasOwn(g_MessagesBase, "ResetHud"), false, "messages has no ResetHud alias");
g_Assert.equal(Object.hasOwn(g_MessagesBase, "TextMsg"), false, "messages has no TextMsg alias");
g_Assert.equal(Object.hasOwn(g_MessagesBase, "HudMsg"), false, "messages has no HudMsg alias");
g_Assert.equal(Object.hasOwn(g_MessagesBase, "VguiMenu"), false, "messages has no VguiMenu alias");
g_Assert.equal(Object.hasOwn(g_MessagesBase, "screenFadeFracBits"), false, "messages has no lower-camel constant alias");

const g_GreenMessageColor = new g_MessageColors.MessageColor(g_MessageColors.GREEN);
const g_OriginalNormalMessageColorDescriptor = Object.getOwnPropertyDescriptor(g_MessageColors, "NORMAL");

try {
	SetMessageSmokeProperty(g_MessageColors, "NORMAL", "\x02");
	g_Assert.equal(g_GreenMessageColor.ColorizeMessageText("Live"), "\x04Live\x02", "messages/colors ColorizeMessageText live NORMAL");
	g_Assert.equal(g_MessageColors.ColorizeMessageText("Live"), "\x02Live\x02", "messages/colors ColorizeMessageText live NORMAL");
} finally {
	RestoreMessageSmokeProperty(g_MessageColors, "NORMAL", g_OriginalNormalMessageColorDescriptor);
}

try {
	SetMessageSmokeProperty(g_MessageColors, "NORMAL", "");
	g_Assert.throws(() => g_GreenMessageColor.ColorizeMessageText("Invalid"), /non-empty/, "messages/colors MessageColor.ColorizeMessageText rejects invalid live NORMAL");
	g_Assert.throws(() => g_MessageColors.ColorizeMessageText("Invalid"), /non-empty/, "messages/colors colorize rejects invalid live NORMAL");
} finally {
	RestoreMessageSmokeProperty(g_MessageColors, "NORMAL", g_OriginalNormalMessageColorDescriptor);
}

g_Assert.equal(g_GreenMessageColor.ColorizeMessageText("SourceJS"), "\x04SourceJS\x01", "messages/colors ColorizeMessageText");
g_Assert.equal(g_MessageColors.ColorizeMessageText("SourceJS", g_MessageColors.OLIVE), "\x05SourceJS\x01", "messages/colors ColorizeMessageText");
g_Assert.equal(g_MessageColors.StripMessageColorCodes("\x04SourceJS\x01"), "SourceJS", "messages/colors StripMessageColorCodes");
g_Assert.equal(g_SayText2Colors.ColorizeSayText2MessageText(g_SayText2Colors.RED, "SourceJS"), "\x02SourceJS\x01", "saytext2 ColorizeSayText2MessageText");
g_Assert.equal(g_SayText2Colors.StripSayText2ColorCodes("\x02SourceJS\x01"), "SourceJS", "saytext2 StripSayText2ColorCodes");
g_Assert.throws(() => g_MessageColors.ColorizeMessageText(7, g_MessageColors.GREEN), "messages/colors rejects non-string MessageText");
g_Assert.throws(() => g_SayText2Colors.ColorizeSayText2MessageText(g_SayText2Colors.RED), "saytext2 requires message");

g_Assert.equal(g_MessagesDialog.DIALOG_TYPE.TEXT, 2, "messages/dialog text type");
g_Assert.equal(Object.isFrozen(g_MessagesDialog.DIALOG_TYPE), true, "messages/dialog DIALOG_TYPE is immutable");

const g_vecTranslatableDialogConstructors = [
	g_MessagesDialog.DialogEntry,
	g_MessagesDialog.DialogMenu,
	g_MessagesDialog.DialogNotification,
	g_MessagesDialog.DialogText,
];

if (Object.hasOwn(g_MessagesDialog, "DialogAskConnect")) {
	const DialogAskConnectConstructor = g_MessagesDialog.DialogAskConnect;
	const DialogAskConnectMessage = new DialogAskConnectConstructor("Connect");
	g_Assert.equal(DialogAskConnectMessage.GetDialogType(), 4, "DialogAskConnect type");
	g_vecTranslatableDialogConstructors.push(DialogAskConnectConstructor);
}

for (const TranslatableDialogConstructor of [Object.getPrototypeOf(g_MessagesDialog.DialogEntry), ...g_vecTranslatableDialogConstructors]) {
	const TranslatableFieldsDescriptor = Object.getOwnPropertyDescriptor(TranslatableDialogConstructor, "TRANSLATABLE_FIELDS");
	g_Assert.deepEqual(TranslatableFieldsDescriptor, { value: TranslatableDialogConstructor.TRANSLATABLE_FIELDS, writable: true, enumerable: true, configurable: true }, `${TranslatableDialogConstructor.name} owns its translatable field descriptor`);
	g_Assert.equal(Object.isFrozen(TranslatableDialogConstructor.TRANSLATABLE_FIELDS), true, `${TranslatableDialogConstructor.name} translatable fields frozen`);
}

const g_unMaximumDialogLevel = 1024;
const g_DialogTextMessage = new g_MessagesDialog.DialogText("Title {Name}", "Message {Name}", { Color: { Red: 0x0A, Green: 0x14, Blue: 0x1E, Alpha: 0x28 }, Time: 7 });

const g_bDialogTextSendResult = g_DialogTextMessage.SendMessage(1, { Name: "Ren" });
const g_vecDialogTextNativeCall = g_vecNativeCalls.at(-1);
const g_DialogTextNativeValues = g_vecDialogTextNativeCall[3];
const g_unDialogTextNativeLevel = g_DialogTextNativeValues.Level;
const g_bDialogTextNativeLevelIsSafeInteger = Number.isSafeInteger(g_unDialogTextNativeLevel);
const g_bDialogTextNativeLevelIsInRange = (g_unDialogTextNativeLevel >= 1) && (g_unDialogTextNativeLevel <= g_unMaximumDialogLevel);
const g_vecDialogTextNativeValueNames = Object.keys(g_DialogTextNativeValues).sort();
g_Assert.equal(g_bDialogTextSendResult, true, "DialogText send");
g_Assert.equal(g_vecDialogTextNativeCall[0], "CreateDialog", "DialogText native operation");
g_Assert.equal(g_vecDialogTextNativeCall[1], 1, "DialogText native recipient");
g_Assert.equal(g_vecDialogTextNativeCall[2], 2, "DialogText native type");
g_Assert.equal(g_bDialogTextNativeLevelIsSafeInteger, true, "DialogText native level integer");
g_Assert.equal(g_bDialogTextNativeLevelIsInRange, true, "DialogText native level range");
g_Assert.deepEqual(g_vecDialogTextNativeValueNames, ["Color", "Level", "Msg", "Time", "Title"], "DialogText native value names");
g_Assert.equal(g_DialogTextNativeValues.Time, 7, "DialogText native time");
g_Assert.equal(g_DialogTextNativeValues.Title, "Title Ren", "DialogText native title");
g_Assert.deepEqual(g_DialogTextNativeValues.Color, { Alpha: 0x28, Blue: 0x1E, Green: 0x14, Red: 0x0A }, "DialogText native color");
g_Assert.equal(g_DialogTextNativeValues.Msg, "Message Ren", "DialogText native message");
g_Assert.equal(g_vecDialogTextNativeCall[4], "text", "DialogText native KeyValues name");

const g_ValidDialogTextFields = g_DialogTextMessage.TranslateMessageFields("en", { Name: "Ren" });
const g_ValidDialogTextColor = g_ValidDialogTextFields.Color;

g_ValidDialogTextFields.Color = [];

try {
	g_Assert.throws(() => g_DialogTextMessage.BuildDialogValues(99, g_ValidDialogTextFields), "DialogText rejects invalid values before level update");
} finally {
	g_ValidDialogTextFields.Color = g_ValidDialogTextColor;
}

const g_FirstValidDialogTextValues = g_DialogTextMessage.BuildDialogValues(99, g_ValidDialogTextFields);
g_Assert.equal(g_FirstValidDialogTextValues.Level, 1, "DialogText invalid values preserve the next player level");

const g_DialogMenuMessage = new g_MessagesDialog.DialogMenu("Menu", "Choose", "select", {
	Options: [
		{ Text: "First", Value: "one" },
		{ Text: "Second", Value: "two" },
	],
});

const g_bDialogMenuSendResult = g_DialogMenuMessage.SendMessage(1);
const g_vecDialogMenuNativeCall = g_vecNativeCalls.at(-1);
const g_DialogMenuNativeValues = g_vecDialogMenuNativeCall[3];
g_Assert.equal(g_bDialogMenuSendResult, true, "DialogMenu send");
g_Assert.equal(g_DialogMenuNativeValues.one.Command, "select one", "DialogMenu option command");
g_Assert.equal(g_DialogMenuNativeValues.two.Msg, "Second", "DialogMenu option text");

const g_StringOptionDialogMenuMessage = new g_MessagesDialog.DialogMenu("Loadout", "Choose", "select", { Options: ["rifle", "shotgun"] });
const g_StringOptionDialogMenuFields = g_StringOptionDialogMenuMessage.TranslateMessageFields("en", {});
const g_StringOptionDialogMenuValues = g_StringOptionDialogMenuMessage.BuildDialogValues(1, g_StringOptionDialogMenuFields);
g_Assert.equal(g_StringOptionDialogMenuValues.rifle.Command, "select rifle", "DialogMenu string option command");
g_Assert.equal(g_StringOptionDialogMenuValues.shotgun.Msg, "shotgun", "DialogMenu string option text");

let g_unDialogMenuOptionTranslationMethodReadCount = 0;

const g_TranslatableDialogMenuOptionText = {
	get GetString() {
		g_unDialogMenuOptionTranslationMethodReadCount += 1;

		return function GetDialogOptionText(strLanguageCode, TranslationTokens) {
			g_Assert.equal(this, g_TranslatableDialogMenuOptionText, "DialogMenu option translation receiver");

			return `${TranslationTokens.Prefix} ${strLanguageCode}`;
		};
	},
};
const g_TranslatableOptionDialogMenuMessage = new g_MessagesDialog.DialogMenu("Loadout", "Choose", "select", { Options: [{ Text: g_TranslatableDialogMenuOptionText, Value: "translated" }] });

g_Assert.equal(g_unDialogMenuOptionTranslationMethodReadCount, 1, "DialogMenu constructor reads option translation method once");

g_unDialogMenuOptionTranslationMethodReadCount = 0;

const g_TranslatedOptionDialogMenuFields = g_TranslatableOptionDialogMenuMessage.TranslateMessageFields("ru", { Prefix: "Translated" });
g_Assert.equal(g_unDialogMenuOptionTranslationMethodReadCount, 1, "DialogMenu translate reads option translation method once");
g_Assert.equal(g_TranslatedOptionDialogMenuFields.Options[0].Text, "Translated ru", "DialogMenu translated option text");

const g_OneReadFieldsDialogMenuMessage = new g_MessagesDialog.DialogMenu("Loadout", "Choose", "select", { Options: [{ Text: "Original", Value: "original" }] });
const g_OneReadDialogMenuFields = g_OneReadFieldsDialogMenuMessage.MessageFields;
let g_unDialogMenuFieldsReadCount = 0;

Object.defineProperty(g_OneReadFieldsDialogMenuMessage, "MessageFields", {
	configurable: true,

	get() {
		g_unDialogMenuFieldsReadCount += 1;

		if (g_unDialogMenuFieldsReadCount > 1) {
			throw new Error("DialogMenu translation read fields more than once.");
		}

		return g_OneReadDialogMenuFields;
	},
});

const g_OneReadTranslatedDialogMenuFields = g_OneReadFieldsDialogMenuMessage.TranslateMessageFields("en", {});
g_Assert.equal(g_unDialogMenuFieldsReadCount, 1, "DialogMenu translate reads fields once");
g_Assert.equal(g_OneReadTranslatedDialogMenuFields.Options[0].Text, "Original", "DialogMenu translated owned options");

const g_PrototypeOptionDialogMenuMessage = new g_MessagesDialog.DialogMenu("Loadout", "Choose", "select", { Options: [{ Text: "Prototype", Value: "__proto__" }] });
const g_PrototypeOptionDialogMenuFields = g_PrototypeOptionDialogMenuMessage.TranslateMessageFields("en", {});
const g_PrototypeOptionDialogMenuValues = g_PrototypeOptionDialogMenuMessage.BuildDialogValues(1, g_PrototypeOptionDialogMenuFields);
g_Assert.equal(Object.getPrototypeOf(g_PrototypeOptionDialogMenuValues), Object.prototype, "DialogMenu values prototype");
g_Assert.equal(Object.hasOwn(g_PrototypeOptionDialogMenuValues, "__proto__"), true, "DialogMenu owns __proto__ option");
g_Assert.equal(g_PrototypeOptionDialogMenuValues["__proto__"].Command, "select __proto__", "DialogMenu __proto__ command");
g_Assert.throws(
	() => new g_MessagesDialog.DialogMenu("Loadout", "Choose", "select", {
		Options: [
			{ Text: "First", Value: "same" },
			{ Text: "Second", Value: "same" },
		],
	}),
	"DialogMenu rejects duplicate option values");

let g_unDialogMenuNonOwnOptionFieldReadCount = 0;

const g_DialogMenuOptionWithoutOwnFields = new Proxy({}, {
	get(DialogOptionTarget, strPropertyName, Receiver) {
		if ((strPropertyName === "Text") || (strPropertyName === "Value")) {
			g_unDialogMenuNonOwnOptionFieldReadCount += 1;
			return strPropertyName;
		}

		return Reflect.get(DialogOptionTarget, strPropertyName, Receiver);
	},
});

g_Assert.throws(() => new g_MessagesDialog.DialogMenu("Loadout", "Choose", "select", { Options: [g_DialogMenuOptionWithoutOwnFields] }), /requires an own Text field/, "DialogMenu rejects non-own option fields");
g_Assert.equal(g_unDialogMenuNonOwnOptionFieldReadCount, 0, "DialogMenu does not read non-own option fields");
g_Assert.throws(() => new g_MessagesDialog.DialogEntry("Entry", "Value", ""), "DialogEntry rejects an empty command");

const g_unFakeTargetDialogNativeCallCount = g_vecNativeCalls.length;
const g_FakeTargetDialogNotificationMessage = new g_MessagesDialog.DialogNotification("Bots do not need UI");
const g_bFakeTargetDialogNotificationSendResult = g_FakeTargetDialogNotificationMessage.SendMessage(3);
g_Assert.equal(g_bFakeTargetDialogNotificationSendResult, false, "DialogNotification skips a fake-only target");
g_Assert.equal(g_vecNativeCalls.length, g_unFakeTargetDialogNativeCallCount, "DialogNotification fake target native calls");

const g_DialogNotificationMessage = new g_MessagesDialog.DialogNotification("Notice", { Time: 3 });
const g_bDialogNotificationSendResult = g_DialogNotificationMessage.SendMessage(1);
const g_vecDialogNotificationNativeCall = g_vecNativeCalls.at(-1);
g_Assert.equal(g_bDialogNotificationSendResult, true, "DialogNotification send");
g_Assert.equal(g_vecDialogNotificationNativeCall[2], g_MessagesDialog.DIALOG_TYPE.MESSAGE, "DialogNotification type");

const g_OriginalMessagesCreateDialogDescriptor = Object.getOwnPropertyDescriptor(g_Messages, "CreateDialog");

try {
	SetMessageSmokeProperty(g_Messages, "CreateDialog", () => null);
	g_Assert.throws(() => g_DialogNotificationMessage.SendMessage(1), /SendDialogMessageDataToRecipients\(\) result requires a boolean/, "DialogNotification rejects a non-boolean native result");
} finally {
	RestoreMessageSmokeProperty(g_Messages, "CreateDialog", g_OriginalMessagesCreateDialogDescriptor);
}

g_Assert.throws(() => new g_MessagesDialog.DialogMenu("Menu", "Choose", "select", {}), "DialogMenu requires options");
g_Assert.throws(() => new g_MessagesDialog.DialogText("Title", "Message", { Color: [0x01, 0x02, 0x03, 0x04] }), "DialogText rejects color arrays");
g_Assert.equal(Object.hasOwn(g_MessagesDialog, "DialogMsg"), false, "messages/dialog has no DialogMsg alias");
g_Assert.equal(Object.hasOwn(g_MessagesDialog, "DialogMessage"), false, "messages/dialog has no DialogMessage alias");
g_Assert.equal(Object.hasOwn(g_MessagesDialog, "TextDialog"), false, "messages/dialog has no TextDialog alias");
g_Assert.equal(Object.hasOwn(g_MessagesDialog, "sendTextDialog"), false, "messages/dialog has no duplicate send helper");

g_Assert.equal(g_MessageHooks.Backend(), "bitbuffer", "message-hook backend");
g_Assert.equal(Object.hasOwn(g_MessageHooks, "BitBufferUserMessageHook"), true, "bit-buffer hook capability");
g_Assert.equal(Object.hasOwn(g_MessageHooks, "ProtobufUserMessageHook"), false, "protobuf hook capability omission");
g_Assert.equal(g_MessageHooks.HOOK_STATUS.BitBufferBeginInstalled, false, "initial begin-hook status");

function VerifyDecodedSayText2Hook() {
	const unMessageHookNativeVTableHookStartIndex = g_vecNativeVTableHooks.length;
	const unHookedSayText2BitBufferAddress = 0x1F4n;
	const bOriginalStatePresent = g_mapBitBufferStates.has(unHookedSayText2BitBufferAddress);
	const OriginalState = g_mapBitBufferStates.get(unHookedSayText2BitBufferAddress);
	let DecodedSayText2UserMessageHook = null;
	let bPrimaryThrown = false;
	let PrimaryError = undefined;

	try {
		DecodedSayText2UserMessageHook = new g_MessageHooks.UserMessageHook("SayText2", (RecipientFilter, UserMessageData) => {
			g_Assert.deepEqual(RecipientFilter.GetRecipientIndexes(), [1, 2], "message-hook recipients");

			UserMessageData.Message = "Changed by hook";
		});

		const MessageBeginNativeVTableHook = g_vecNativeVTableHooks[unMessageHookNativeVTableHookStartIndex];
		const MessageEndNativeVTableHook = g_vecNativeVTableHooks[unMessageHookNativeVTableHookStartIndex + 1];

		g_Assert.equal(g_vecNativeVTableHooks.length, unMessageHookNativeVTableHookStartIndex + 2, "message hooks install begin/end vtable hooks");
		g_Assert.equal(typeof MessageBeginNativeVTableHook.Options.ObjectAddress, "bigint", "message-hook object address type");
		g_Assert.equal(Array.isArray(MessageBeginNativeVTableHook.Options.Arguments), true, "message-hook argument types");
		g_Assert.equal(g_MessageHooks.HOOK_STATUS.BitBufferBeginInstalled, true, "live begin-hook status");

		const unHookedSayText2RecipientFilterAddress = 0xC8n;
		const nHookedSayText2MessageIndex = 2;
		const HookedSayText2BitBufferWriter = new g_Bitbuffers.BitBufferWrite(g_unStandardMessageBitBufferCapacityByteCount);
		g_MessagesImplementation.SayText2UserMessageImplementation.WriteUserMessageToBitBuffer(HookedSayText2BitBufferWriter, {
			Chat: true,
			Message: "Original",
			Parameter1: "one",
			Parameter2: "two",
			Parameter3: "three",
			Parameter4: "four",
			SenderIndex: 2,
		});

		g_mapBitBufferStates.set(unHookedSayText2BitBufferAddress, {
			Bytes: new Uint8Array(HookedSayText2BitBufferWriter.Bytes),
			CurrentBit: HookedSayText2BitBufferWriter.CurrentBit,
			DataBitCount: HookedSayText2BitBufferWriter.DataBitCount,
			Overflowed: HookedSayText2BitBufferWriter.Overflowed,
		});

		for (const MessageBeginPreCallback of MessageBeginNativeVTableHook.PreCallbacks) {
			MessageBeginPreCallback({ Arguments: [g_unEngineServerAddress, unHookedSayText2RecipientFilterAddress, nHookedSayText2MessageIndex] });
		}

		for (const MessageBeginPostCallback of MessageBeginNativeVTableHook.PostCallbacks) {
			MessageBeginPostCallback({ Arguments: [g_unEngineServerAddress, unHookedSayText2RecipientFilterAddress, nHookedSayText2MessageIndex], ReturnValue: unHookedSayText2BitBufferAddress });
		}

		for (const MessageEndPreCallback of MessageEndNativeVTableHook.PreCallbacks) {
			MessageEndPreCallback({ Arguments: [g_unEngineServerAddress] });
		}

		const HookedSayText2BitBufferState = g_mapBitBufferStates.get(unHookedSayText2BitBufferAddress);
		g_Assert.notEqual(HookedSayText2BitBufferState, undefined, "message hook bitbuffer state");

		const HookedSayText2BitBufferReader = new g_Bitbuffers.BitBufferRead({ Bytes: HookedSayText2BitBufferState.Bytes, DataBitCount: HookedSayText2BitBufferState.DataBitCount });
		const HookedSayText2UserMessageData = g_MessagesImplementation.SayText2UserMessageImplementation.ReadUserMessageFromBitBuffer(HookedSayText2BitBufferReader);
		const bHookedSayText2BitBufferStateDeleteResult = g_mapBitBufferStates.delete(unHookedSayText2BitBufferAddress);
		g_Assert.equal(HookedSayText2UserMessageData.Message, "Changed by hook", "message hook writes changed data");
		g_Assert.equal(bHookedSayText2BitBufferStateDeleteResult, true, "message hook bitbuffer state cleanup");

		const bDecodedSayText2UserMessageHookDisposeResult = DecodedSayText2UserMessageHook.DisposeUserMessageHook();
		g_Assert.equal(bDecodedSayText2UserMessageHookDisposeResult, true, "message hook dispose");
		g_Assert.equal(MessageBeginNativeVTableHook.Removed, true, "message begin hook released");
		g_Assert.equal(MessageEndNativeVTableHook.Removed, true, "message end hook released");
		g_Assert.equal(g_MessageHooks.HOOK_STATUS.BitBufferBeginInstalled, false, "released begin-hook status");
		g_Assert.equal(Object.hasOwn(g_MessageHooks, "hookStatus"), false, "message hooks have no lower-camel singleton alias");
		g_Assert.equal(Object.hasOwn(g_MessageHooks, "moduleName"), false, "message hooks have no moduleName alias");
	} catch (CaughtError) {
		bPrimaryThrown = true;
		PrimaryError = CaughtError;
		throw CaughtError;
	} finally {
		try {
			if (DecodedSayText2UserMessageHook !== null) {
				const bHadCallback = DecodedSayText2UserMessageHook.Callback !== null;
				const bDisposed = DecodedSayText2UserMessageHook.DisposeUserMessageHook();
				if (bHadCallback) {
					g_Assert.equal(bDisposed, true, "decoded-hook fixture releases its owned callback after a failed assertion");
				}
			}
		} catch (CleanupError) {
			if (bPrimaryThrown) {
				throw new AggregateError([PrimaryError, CleanupError], "Decoded-hook verification and cleanup both failed.");
			}

			throw CleanupError;
		} finally {
			if (bOriginalStatePresent) {
				g_mapBitBufferStates.set(unHookedSayText2BitBufferAddress, OriginalState);

			} else {
				g_mapBitBufferStates.delete(unHookedSayText2BitBufferAddress);
			}
		}
	}
}

VerifyDecodedSayText2Hook();

VerifyMessageHookDocumentation(g_MessageHooks, g_vecNativeVTableHooks);

console.log("[smoke_messages] ok");
