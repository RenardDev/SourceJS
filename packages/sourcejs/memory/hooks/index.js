"use strict";

class HookBase extends Array {
	Append(Callback) {
		if (typeof Callback !== "function") {
			throw new TypeError(`Callback ${String(Callback)} is not callable.`);
		}

		if (this.includes(Callback)) {
			throw new Error(`Callback ${Callback.name || "<anonymous>"} is already registered to ${this.ClassName}.`);
		}

		super.push(Callback);

		return Callback;
	}

	Remove(Callback) {
		const nIndex = this.indexOf(Callback);
		if (nIndex === -1) {
			throw new Error(`Callback ${(Callback && Callback.name) ? Callback.name : "<anonymous>"} is not registered to ${this.ClassName}.`);
		}

		super.splice(nIndex, 1);

		return Callback;
	}

	Clear() {
		super.splice(0, this.length);
	}

	get ClassName() {
		return this.constructor.name;
	}
}

class HookDecorator {
	constructor(Callback, ClassInstance = new.target.ClassInstance) {
		if (!ClassInstance || (typeof ClassInstance.Append !== "function")) {
			throw new TypeError(`${new.target.name} requires a HookBase instance.`);
		}

		this.Callback = Callback;
		this.ClassInstance = ClassInstance;
		this.ClassInstance.Append(this.Callback);
	}

	Call(...vecCallbackArguments) {
		return this.Callback(...vecCallbackArguments);
	}

	Dispose() {
		this.ClassInstance.Remove(this.Callback);

		return this.Callback;
	}
}

module.exports = {
	HookBase,
	HookDecorator,
};
