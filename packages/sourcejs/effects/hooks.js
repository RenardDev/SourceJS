"use strict";

const { TEMP_ENTITY_TEMPLATES } = require("effects/templates");

class TemporaryEntityCreateHook {
	constructor(strTemporaryEntityName, strHookPhase) {
		this.Template = TEMP_ENTITY_TEMPLATES.GetTemporaryEntityTemplate(strTemporaryEntityName);
		this.Phase = strHookPhase;
		this.Callback = null;
		this.#m_RegisteredCallback = null;
		this.#m_strRegisteredPhase = null;
		this.#m_Template = null;
	}

	RegisterTemporaryEntityHook(HookCallback) {
		if (typeof HookCallback !== "function") {
			throw new TypeError("Temporary entity hook callback must be a function.");
		}

		const strHookPhase = this.Phase;
		if ((strHookPhase !== "PreCreate") && (strHookPhase !== "PostCreate")) {
			throw new RangeError(`Unsupported temporary entity hook phase: ${String(strHookPhase)}`);
		}

		const HookTemplate = this.Template;

		if (this.#m_RegisteredCallback !== null) {
			this.UnregisterTemporaryEntityHook();
		}

		if (strHookPhase === "PreCreate") {
			HookTemplate.RegisterTemporaryEntityPreCreateHook(HookCallback);
		} else {
			HookTemplate.RegisterTemporaryEntityPostCreateHook(HookCallback);
		}

		this.#m_RegisteredCallback = HookCallback;
		this.#m_strRegisteredPhase = strHookPhase;
		this.#m_Template = HookTemplate;
		this.Callback = HookCallback;

		return HookCallback;
	}

	UnregisterTemporaryEntityHook() {
		const HookCallback = this.#m_RegisteredCallback;
		if (HookCallback === null) {
			return false;
		}

		const strHookPhase = this.#m_strRegisteredPhase;
		if ((strHookPhase !== "PreCreate") && (strHookPhase !== "PostCreate")) {
			throw new RangeError(`Unsupported temporary entity hook phase: ${String(strHookPhase)}`);
		}

		const HookTemplate = this.#m_Template;
		const bHookRemoved = (strHookPhase === "PreCreate") ? HookTemplate.UnregisterTemporaryEntityPreCreateHook(HookCallback) : HookTemplate.UnregisterTemporaryEntityPostCreateHook(HookCallback);
		if (bHookRemoved) {
			this.#m_RegisteredCallback = null;
			this.#m_strRegisteredPhase = null;
			this.#m_Template = null;
			this.Callback = null;
		}

		return bHookRemoved;
	}

	#m_RegisteredCallback;
	#m_strRegisteredPhase;
	#m_Template;
}

class TemporaryEntityPreCreateHook extends TemporaryEntityCreateHook {
	constructor(strTemporaryEntityName) {
		super(strTemporaryEntityName, "PreCreate");
	}
}

class TemporaryEntityPostCreateHook extends TemporaryEntityCreateHook {
	constructor(strTemporaryEntityName) {
		super(strTemporaryEntityName, "PostCreate");
	}
}

function RegisterTemporaryEntityPreCreateHook(strTemporaryEntityName, HookCallback) {
	const PreCreateHook = new TemporaryEntityPreCreateHook(strTemporaryEntityName);
	PreCreateHook.RegisterTemporaryEntityHook(HookCallback);

	return PreCreateHook;
}

function RegisterTemporaryEntityPostCreateHook(strTemporaryEntityName, HookCallback) {
	const PostCreateHook = new TemporaryEntityPostCreateHook(strTemporaryEntityName);
	PostCreateHook.RegisterTemporaryEntityHook(HookCallback);

	return PostCreateHook;
}

module.exports = {
	TemporaryEntityPostCreateHook,
	TemporaryEntityPreCreateHook,
	RegisterTemporaryEntityPostCreateHook,
	RegisterTemporaryEntityPreCreateHook,
};
