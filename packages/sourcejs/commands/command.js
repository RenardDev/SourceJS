"use strict";

function NormalizeCommandNames(CommandNameOrNames) {
	const vecCommandNameList = Array.isArray(CommandNameOrNames) ? CommandNameOrNames : [CommandNameOrNames];
	const unCommandCount = vecCommandNameList.length;
	if (!Number.isSafeInteger(unCommandCount) || (unCommandCount <= 0)) {
		throw new TypeError("Command names must be non-empty strings.");
	}

	const vecNormalizedCommandNames = [];
	for (let unCommandIndex = 0; unCommandIndex < unCommandCount; ++unCommandIndex) {
		if (!Object.prototype.hasOwnProperty.call(vecCommandNameList, unCommandIndex)) {
			throw new TypeError("Command names must be non-empty strings.");
		}

		const strCommandName = vecCommandNameList[unCommandIndex];
		if (typeof strCommandName !== "string") {
			throw new TypeError("Command names must be non-empty strings.");
		}

		const strNormalizedCommandName = strCommandName.trim();
		if (strNormalizedCommandName === "") {
			throw new TypeError("Command names must be non-empty strings.");
		}

		Object.defineProperty(vecNormalizedCommandNames, unCommandIndex, { value: strNormalizedCommandName, writable: true, configurable: true, enumerable: true });
	}

	if (new Set(vecNormalizedCommandNames).size !== vecNormalizedCommandNames.length) {
		throw new TypeError("Command names must be unique.");
	}

	return vecNormalizedCommandNames;
}

class CommandRegistration {
	constructor(NativeCommandRuntime, CommandNameOrNames, CommandCallback) {
		if (!NativeCommandRuntime || (typeof NativeCommandRuntime.Register !== "function") || (typeof NativeCommandRuntime.Unregister !== "function")) {
			throw new TypeError("CommandRegistration expects a native command runtime.");
		}

		if (typeof CommandCallback !== "function") {
			throw new TypeError("CommandRegistration expects a callback function.");
		}

		this.m_Runtime = NativeCommandRuntime;
		this.m_vecNames = NormalizeCommandNames(CommandNameOrNames);
		this.m_vecRegisteredNames = [];
		this.m_Callback = CommandCallback;
		this.m_bLoaded = false;
	}

	Load() {
		if (this.m_bLoaded) {
			throw new Error("Command registration is already loaded.");
		}

		this.m_bLoaded = true;

		try {
			for (const strCommandName of this.m_vecNames) {
				if (!this.m_Runtime.Register(strCommandName, this.m_Callback)) {
					throw new Error(`Unable to register command '${strCommandName}'.`);
				}

				this.m_vecRegisteredNames.push(strCommandName);
			}
		} catch (RegistrationError) {
			try {
				this.Unload();
			} catch (CleanupError) {
				throw new AggregateError([RegistrationError, CleanupError], "Command registration failed and rollback is incomplete; retry Unload().");
			}

			throw RegistrationError;
		}

		return this;
	}

	Unload() {
		if (!this.m_bLoaded) {
			return false;
		}

		while (this.m_vecRegisteredNames.length !== 0) {
			const strCommandName = this.m_vecRegisteredNames[0];
			if (!this.m_Runtime.Unregister(strCommandName, this.m_Callback)) {
				throw new Error(`Unable to unregister command '${strCommandName}'.`);
			}

			this.m_vecRegisteredNames.shift();
		}

		this.m_bLoaded = false;

		return true;
	}

	get Names() {
		return this.m_vecNames.slice();
	}

	get Callback() {
		return this.m_Callback;
	}

	get Runtime() {
		return this.m_Runtime;
	}

	get Loaded() {
		return this.m_bLoaded;
	}
}

function RegisterCommand(NativeCommandRuntime, CommandNameOrNames, CommandCallback) {
	return new CommandRegistration(NativeCommandRuntime, CommandNameOrNames, CommandCallback).Load();
}

module.exports = {
	CommandRegistration: CommandRegistration,
	RegisterCommand: RegisterCommand,
};
