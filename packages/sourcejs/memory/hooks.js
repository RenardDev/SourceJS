"use strict";

const { GetRawModule } = require("internal/runtime");
const { HookBase, HookDecorator } = require("memory/hooks/index");

const g_HooksRuntime = GetRawModule("memory/hooks");
const g_HookType = g_HooksRuntime.HookType;

if ((g_HookType === null) || (typeof g_HookType !== "object") || Array.isArray(g_HookType)) {
	throw new TypeError("memory/hooks.HookType must be an object.");
}

if (!Object.hasOwn(g_HookType, "Pre") || !Object.hasOwn(g_HookType, "Post") || (g_HookType.Pre === g_HookType.Post)) {
	throw new TypeError("memory/hooks.HookType must provide distinct Pre and Post values.");
}

Object.freeze(g_HookType);

function RequireMemoryHookMethod(Hook, strMethodName) {
	if ((Hook === null) || ((typeof Hook !== "object") && (typeof Hook !== "function"))) {
		throw new TypeError("Memory hook decorators require a native hook handle.");
	}

	const HookMethod = Hook[strMethodName];
	if (typeof HookMethod !== "function") {
		throw new TypeError(`Memory hook handles must provide ${strMethodName}().`);
	}

	return HookMethod;
}

function RequireMemoryHookHandle(Hook) {
	RequireMemoryHookMethod(Hook, "Pre");
	RequireMemoryHookMethod(Hook, "Post");
	RequireMemoryHookMethod(Hook, "RemovePre");
	RequireMemoryHookMethod(Hook, "RemovePost");

	return Hook;
}

function RequireMemoryHookType(nHookType) {
	if ((nHookType !== g_HookType.Pre) && (nHookType !== g_HookType.Post)) {
		throw new RangeError("Memory hook type must be HookType.Pre or HookType.Post.");
	}

	return nHookType;
}

function GetHooksDisabledState() {
	const bHooksDisabled = g_HooksRuntime.GetHooksDisabled();
	if (typeof bHooksDisabled !== "boolean") {
		throw new TypeError("memory/hooks.GetHooksDisabled() must return a boolean.");
	}

	return bHooksDisabled;
}

function SetHooksDisabledState(bHooksDisabled) {
	const bAppliedHooksDisabled = g_HooksRuntime.SetHooksDisabled(bHooksDisabled);
	if (bAppliedHooksDisabled !== bHooksDisabled) {
		throw new Error("memory/hooks.SetHooksDisabled() did not apply the requested state.");
	}

	return bAppliedHooksDisabled;
}

function AddMemoryHookCallback(Hook, nHookType, Callback) {
	const strRegisterMethodName = (nHookType === g_HookType.Post) ? "Post" : "Pre";
	const RegisterMethod = RequireMemoryHookMethod(Hook, strRegisterMethodName);
	const bCallbackRegistered = RegisterMethod.call(Hook, Callback);
	if (typeof bCallbackRegistered !== "boolean") {
		throw new TypeError(`Memory hook ${strRegisterMethodName}() must return a boolean.`);
	}

	return bCallbackRegistered;
}

function RemoveMemoryHookCallback(Hook, nHookType, Callback) {
	const strRemoveMethodName = (nHookType === g_HookType.Post) ? "RemovePost" : "RemovePre";
	const RemoveMethod = RequireMemoryHookMethod(Hook, strRemoveMethodName);
	const bCallbackRemoved = RemoveMethod.call(Hook, Callback);
	if (typeof bCallbackRemoved !== "boolean") {
		throw new TypeError(`Memory hook ${strRemoveMethodName}() must return a boolean.`);
	}

	return bCallbackRemoved;
}

class MemoryHookDecorator {
	constructor(Hook, nHookType, Callback = null) {
		RequireMemoryHookHandle(Hook);
		RequireMemoryHookType(nHookType);

		this.#m_RegisteredCallback = null;
		this.#m_RegisteredHook = null;
		this.#m_nRegisteredHookType = null;
		this.Hook = Hook;
		this.HookType = nHookType;
		this.Callback = null;

		if (Callback !== null) {
			this.Register(Callback);
		}
	}

	Register(Callback) {
		if (typeof Callback !== "function") {
			throw new TypeError("Memory hook callback must be a function.");
		}

		const Hook = this.Hook;
		const nHookType = RequireMemoryHookType(this.HookType);
		const PreviousCallback = this.#m_RegisteredCallback;
		const PreviousHook = this.#m_RegisteredHook;
		const nPreviousHookType = this.#m_nRegisteredHookType;
		const bCallbackRegistered = AddMemoryHookCallback(Hook, nHookType, Callback);
		if (!bCallbackRegistered) {
			throw new Error("Unable to register the memory hook callback.");
		}

		if (PreviousCallback !== null) {
			try {
				if (!RemoveMemoryHookCallback(PreviousHook, nPreviousHookType, PreviousCallback)) {
					throw new Error("Unable to remove the previous memory hook callback.");
				}
			} catch (PreviousRemovalError) {
				try {
					if (!RemoveMemoryHookCallback(Hook, nHookType, Callback)) {
						throw new Error("Unable to roll back the replacement memory hook callback.");
					}
				} catch (RollbackError) {
					throw new AggregateError([PreviousRemovalError, RollbackError], "Replacing and rolling back the memory hook callback both failed.");
				}

				throw PreviousRemovalError;
			}
		}

		this.#m_RegisteredCallback = Callback;
		this.#m_RegisteredHook = Hook;
		this.#m_nRegisteredHookType = nHookType;
		this.Callback = Callback;

		return Callback;
	}

	Dispose() {
		const Callback = this.#m_RegisteredCallback;
		if (Callback === null) {
			return false;
		}

		const Hook = this.#m_RegisteredHook;
		const nHookType = this.#m_nRegisteredHookType;
		const bCallbackRemoved = RemoveMemoryHookCallback(Hook, nHookType, Callback);
		if (!bCallbackRemoved) {
			return false;
		}

		this.#m_RegisteredCallback = null;
		this.#m_RegisteredHook = null;
		this.#m_nRegisteredHookType = null;
		this.Callback = null;

		return true;
	}

	#m_RegisteredCallback;
	#m_RegisteredHook;
	#m_nRegisteredHookType;
}

class PreHook extends MemoryHookDecorator {
	constructor(Hook, Callback = null) {
		super(Hook, g_HookType.Pre, Callback);
	}
}

class PostHook extends MemoryHookDecorator {
	constructor(Hook, Callback = null) {
		super(Hook, g_HookType.Post, Callback);
	}
}

function WithHooksDisabled(Callback, bHooksDisabled = true) {
	if (typeof Callback !== "function") {
		throw new TypeError("WithHooksDisabled callback must be a function.");
	}

	if (typeof bHooksDisabled !== "boolean") {
		throw new TypeError("WithHooksDisabled bHooksDisabled state must be a boolean.");
	}

	const bPreviousHooksDisabled = GetHooksDisabledState();

	try {
		SetHooksDisabledState(bHooksDisabled);
	} catch (StateApplicationError) {
		try {
			SetHooksDisabledState(bPreviousHooksDisabled);
		} catch (StateRestorationError) {
			throw new AggregateError([StateApplicationError, StateRestorationError], "Applying and restoring the memory hook callback state failed.");
		}

		throw StateApplicationError;
	}

	let CallbackResult = undefined;
	let CallbackError = undefined;
	let bCallbackFailed = false;

	try {
		CallbackResult = Callback();
	} catch (CaughtCallbackError) {
		CallbackError = CaughtCallbackError;
		bCallbackFailed = true;
	}

	let StateRestorationError = undefined;
	let bStateRestorationFailed = false;

	try {
		SetHooksDisabledState(bPreviousHooksDisabled);
	} catch (CaughtStateRestorationError) {
		StateRestorationError = CaughtStateRestorationError;
		bStateRestorationFailed = true;
	}

	if (bCallbackFailed && bStateRestorationFailed) {
		throw new AggregateError([CallbackError, StateRestorationError], "The memory hook callback and state restoration both failed.");
	}

	if (bStateRestorationFailed) {
		throw StateRestorationError;
	}

	if (bCallbackFailed) {
		throw CallbackError;
	}

	return CallbackResult;
}

Object.assign(g_HooksRuntime, {
	HookBase,
	HookDecorator,
	HookType: g_HookType,
	MemoryHookDecorator,
	PostHook,
	PreHook,
	WithHooksDisabled,
});

module.exports = g_HooksRuntime;
