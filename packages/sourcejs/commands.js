"use strict";

const { BLOCK, CONTINUE, CommandReturn, HANDLED, MAX_COMMAND_LENGTH, CommandsRuntime } = require("internal/commands");

const g_strInvalidPayloadFieldsErrorMessage = "Native command payload fields are invalid.";

class Command {
	constructor(NativePayload) {
		if (!NativePayload || (typeof NativePayload !== "object") || Array.isArray(NativePayload)) {
			throw new TypeError("Command expects a native command payload.");
		}

		const vecNativeArguments = NativePayload.Arguments;
		if (!Array.isArray(vecNativeArguments)) {
			throw new TypeError(g_strInvalidPayloadFieldsErrorMessage);
		}

		const strRaw = NativePayload.Raw;
		if (typeof strRaw !== "string") {
			throw new TypeError(g_strInvalidPayloadFieldsErrorMessage);
		}

		const strName = NativePayload.Name;
		if (typeof strName !== "string") {
			throw new TypeError(g_strInvalidPayloadFieldsErrorMessage);
		}

		const strKind = NativePayload.Kind;
		if (typeof strKind !== "string") {
			throw new TypeError(g_strInvalidPayloadFieldsErrorMessage);
		}

		const nIndex = NativePayload.Index;
		if (!Number.isInteger(nIndex)) {
			throw new TypeError(g_strInvalidPayloadFieldsErrorMessage);
		}

		const unArgumentCount = vecNativeArguments.length;
		if (!Number.isSafeInteger(unArgumentCount) || (unArgumentCount < 0)) {
			throw new TypeError("Native command arguments must be strings.");
		}

		const vecArguments = [];
		for (let unArgumentIndex = 0; unArgumentIndex < unArgumentCount; ++unArgumentIndex) {
			if (!Object.prototype.hasOwnProperty.call(vecNativeArguments, unArgumentIndex)) {
				throw new TypeError("Native command arguments must be strings.");
			}

			const strArgument = vecNativeArguments[unArgumentIndex];
			if (typeof strArgument !== "string") {
				throw new TypeError("Native command arguments must be strings.");
			}

			Object.defineProperty(vecArguments, unArgumentIndex, { value: strArgument, writable: true, configurable: true, enumerable: true });
		}

		const strMessage = NativePayload.Message;
		if ((strMessage !== undefined) && (typeof strMessage !== "string")) {
			throw new TypeError("Native command messages must be strings.");
		}

		const bTeamOnly = NativePayload.TeamOnly;
		if ((bTeamOnly !== undefined) && (typeof bTeamOnly !== "boolean")) {
			throw new TypeError("Native command TeamOnly must be a boolean.");
		}

		this.m_vecArguments = vecArguments;
		this.m_strName = strName;
		this.m_strRaw = strRaw;
		this.m_strKind = strKind;
		this.m_nIndex = nIndex;
		this.m_strMessage = (strMessage === undefined) ? "" : strMessage;
		this.m_bTeamOnly = (bTeamOnly === undefined) ? false : bTeamOnly;
	}

	GetArgument(nIndex) {
		if (!Number.isInteger(nIndex)) {
			throw new TypeError("Command argument indexes must be integers.");
		}

		return this.m_vecArguments[nIndex];
	}

	[Symbol.iterator]() {
		return this.m_vecArguments[Symbol.iterator]();
	}

	get Length() {
		return this.m_vecArguments.length;
	}

	get Arguments() {
		return this.m_vecArguments.slice();
	}

	get Name() {
		return this.m_strName;
	}

	get Raw() {
		return this.m_strRaw;
	}

	get Kind() {
		return this.m_strKind;
	}

	get Index() {
		return this.m_nIndex;
	}

	get Message() {
		return this.m_strMessage;
	}

	get TeamOnly() {
		return this.m_bTeamOnly;
	}

	get ArgumentString() {
		return this.m_vecArguments.slice(1).join(" ");
	}
}

Object.defineProperty(Command, "MAX_COMMAND_LENGTH", {
	configurable: true,
	enumerable: true,
	value: MAX_COMMAND_LENGTH,
	writable: true,
});

const g_CommandsAPI = {
	BLOCK: BLOCK,
	CONTINUE: CONTINUE,
	CommandReturn: CommandReturn,
	HANDLED: HANDLED,
	MAX_COMMAND_LENGTH: MAX_COMMAND_LENGTH,
	Command: Command,
	ExecuteCommand: CommandsRuntime.ExecuteServerCommand,
	RegisterCommand: CommandsRuntime.RegisterCommand,
	UnregisterCommand: CommandsRuntime.UnregisterCommand,
};
module.exports = g_CommandsAPI;
