"use strict";

class CommandFilterRegistration {
	constructor(NativeCommandRuntime, CommandFilterCallback) {
		if (!NativeCommandRuntime || (typeof NativeCommandRuntime.RegisterFilter !== "function") || (typeof NativeCommandRuntime.UnregisterFilter !== "function")) {
			throw new TypeError("CommandFilterRegistration expects a native command runtime.");
		}

		if (typeof CommandFilterCallback !== "function") {
			throw new TypeError("CommandFilterRegistration expects a callback function.");
		}

		this.m_Runtime = NativeCommandRuntime;
		this.m_Callback = CommandFilterCallback;
		this.m_bLoaded = false;
	}

	Load() {
		if (this.m_bLoaded) {
			throw new Error("Command filter registration is already loaded.");
		}

		if (!this.m_Runtime.RegisterFilter(this.m_Callback)) {
			throw new Error("Unable to register command filter.");
		}

		this.m_bLoaded = true;

		return this;
	}

	Unload() {
		if (!this.m_bLoaded) {
			return false;
		}

		if (!this.m_Runtime.UnregisterFilter(this.m_Callback)) {
			throw new Error("Unable to unregister command filter.");
		}

		this.m_bLoaded = false;

		return true;
	}

	get Runtime() {
		return this.m_Runtime;
	}

	set Runtime(Runtime) {
		this.m_Runtime = Runtime;
	}

	get Callback() {
		return this.m_Callback;
	}

	set Callback(Callback) {
		this.m_Callback = Callback;
	}

	get Loaded() {
		return this.m_bLoaded;
	}

	set Loaded(bLoaded) {
		this.m_bLoaded = bLoaded;
	}
}

function RegisterCommandFilter(NativeCommandRuntime, CommandFilterCallback) {
	return new CommandFilterRegistration(NativeCommandRuntime, CommandFilterCallback).Load();
}

module.exports = {
	CommandFilterRegistration: CommandFilterRegistration,
	RegisterCommandFilter: RegisterCommandFilter,
};
