"use strict";

const { CommandRegistration } = require("commands/command");

class CommandRegistrationManager {
	constructor(NativeCommandRuntime) {
		if (!NativeCommandRuntime || (typeof NativeCommandRuntime.Register !== "function") || (typeof NativeCommandRuntime.Unregister !== "function")) {
			throw new TypeError("CommandRegistrationManager expects a native command runtime.");
		}

		this.Runtime = NativeCommandRuntime;
		this.Registrations = new Set();
	}

	Register(CommandNameOrNames, CommandCallback) {
		const Registration = new CommandRegistration(this.Runtime, CommandNameOrNames, CommandCallback);
		this.Registrations.add(Registration);

		try {
			Registration.Load();
		} catch (RegistrationError) {
			if (!Registration.Loaded) {
				this.Registrations.delete(Registration);
			}

			throw RegistrationError;
		}

		return Registration;
	}

	Unregister(Registration) {
		if (!(Registration instanceof CommandRegistration) || !this.Registrations.has(Registration)) {
			throw new TypeError("Command registration is not owned by this manager.");
		}

		if (!Registration.Unload()) {
			throw new Error("Command registration is not loaded.");
		}

		this.Registrations.delete(Registration);

		return true;
	}

	UnloadAll() {
		for (const Registration of this.Registrations) {
			if (!Registration.Unload()) {
				throw new Error("Managed command registration is not loaded.");
			}

			this.Registrations.delete(Registration);
		}

		return true;
	}
}

module.exports = {
	CommandRegistrationManager: CommandRegistrationManager,
};
